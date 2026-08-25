/**
 * Compiles a {@link Scene} into an ASP program.
 *
 * Every place that holds alternatives — a node's property, or a token's own
 * definition — becomes one *variable*, and the solver picks an alternative for
 * each. Variables are named as ASP terms (`prop(n1,fill)`, `tok(accent)`) so
 * the same string identifies them in the program, in the answer sets, and in
 * the renderer.
 *
 * Token references are resolved inside ASP rather than only in TypeScript, so
 * rules can compare final values:
 *
 *     :- resolved(prop(a,fill), C), resolved(prop(b,fill), C).
 *
 * Geometry goes in as facts wherever the document holds one number per
 * dimension, and as an ordinary variable wherever it holds a choice. Either way
 * the program reads `frame/3`: what is never choosable is the *coordinate*, only
 * the handful of alternatives somebody wrote down, so nothing here grounds a
 * domain of thousands. Where a coordinate genuinely has to be worked out it is
 * not a choice either — it is a variable of the simplex solver, which costs one
 * unknown rather than a domain.
 */
import { componentDefs, instanceNodes } from "./components.ts";
import {
	askedAxes,
	naturalSize,
	rowCount,
	rowPicks,
	type Measurements,
	type Size,
} from "./measure.ts";
import {
	CHILD_PROPS,
	CONSTRAINT_KINDS,
	CONSTRAINT_NAMES,
	CONTAINER_PROPS,
	DIMENSIONS,
	EDGES,
	EDGE_NAMES,
	LAYOUT_PROPS,
	LAYOUT_PROP_NAMES,
	NODE_KINDS,
	STYLE_PROPS,
	constrainsProp,
	dimension,
	frameDim,
	isLaidOut,
	layoutValueOf,
	levelOf,
	rangesOverGroup,
	type Scene,
	type SceneNode,
	weightOf,
	wornProps,
} from "./scene.ts";
import {
	DERIVATIONS,
	type Derivation,
	type ResolveContext,
	type Term,
	VALUE_TYPES,
	constraintVar,
	frameVar,
	layoutVar,
	numeralOf,
	propVar,
	referencedTokens,
	stylePartVar,
	styleVar,
	tokenVar,
	type Value,
	wordOf,
} from "./values.ts";
import { flatten, parentMap } from "./tree.ts";

/** The switch a constraint is compiled behind — see {@link compile}. */
export const guardAtom = (constraintId: string): string =>
	`active(${constraintId})`;

/**
 * Names of the solver's layout unknowns.
 *
 * Unlike everything else in a document these are not facts: they are theory
 * variables the simplex solver assigns, so a layout can be under-determined
 * and still have an answer.
 */
export const posVar = (nodeId: string, axis: "x" | "y"): string =>
	`lv(${nodeId},${axis})`;
export const sizeVar = (nodeId: string, axis: "width" | "height"): string =>
	`lsz(${nodeId},${axis})`;

/**
 * A node's position in the *canvas*, rather than inside its parent.
 *
 * Frames are parent-relative, so two nodes under different parents have
 * nothing to compare. This is that comparison, and it stays linear: a chain of
 * additions down the tree — see the geometry rules.
 */
export const worldVar = (nodeId: string, axis: "x" | "y"): string =>
	`wv(${nodeId},${axis})`;

/**
 * The switch that puts the pull-toward-the-stored-frame objective on.
 *
 * Assumed on every ordinary solve. It exists so a *probe* can take it off:
 * asking how far a coordinate could travel is a question about the equations
 * alone, and an objective that drags everything home would answer it with the
 * point the designer already has. See {@link probeAtom}.
 */
export const PULL_ATOM = "gpull";

/**
 * The switch that puts the *picture* in the answer set.
 *
 * The scene predicates are shown behind it — `#show node(N) : node(N),
 * scenery.` and its siblings — so a solve that only wants to know which
 * alternatives were picked can assume it false and get the 32 atoms the
 * program showed before the whole scene went into the output, instead of the
 * ~120 it shows now. That is not a saving on one solve; it is a saving on the
 * hundred-odd sampling and consequence solves an exploration fires, none of
 * which reads anything but `pick/2` and `visible/1`.
 *
 * A `{ scenery }.` choice rather than an `#external`, for the reason recorded
 * throughout this file: an unassigned external is fixed false in
 * preprocessing. The gate atom is not in any `#project` signature, so
 * projection absorbs it and the number of answer sets is unchanged.
 */
export const SCENERY_ATOM = "scenery";

/** The switch that asks the solver for one coordinate's extreme. */
export const probeAtom = (
	nodeId: string,
	axis: string,
	direction: "min" | "max",
): string => `gprobe(${nodeId},${axis},${direction})`;

/**
 * What a node asks to be, when what it says can vary.
 *
 * `lask/3` is one number per axis, and for a great many nodes it is a plain
 * fact. Where it is not — a headline with three wordings, a heading wearing a
 * two-variant style, a hugging row whose gap names a spacing scale — it is a
 * *table*, because the size is a function of a tuple of picks rather than of one
 * alternative. The rows are measured or computed before the solve; which row
 * this universe reads is the solver's own business, and these four rules are the
 * whole of how it decides.
 *
 * A row declares the picks it holds for, one `lrowif/4` each, and applies where
 * none of them is contradicted. That keeps the *program* generic while the table
 * is data: a document that crosses copy against a style changes the facts, not
 * the shape of a rule. An index built as a compound term — `lrow(N,m(I,J),...)`
 * — would need a join written per document, which is the one thing this compiler
 * does not do.
 *
 * `laskdef/3` is the row nothing matched. It cannot normally happen: the axes
 * are the full product, so exactly one row applies. It happens when the budget
 * refused an axis, and when a hand-written rule mints an alternative the
 * measurement pass never saw — `alt(prop(N,text),D)` is a legal thing to write.
 * Without it such a node has no size equation at all and simplex puts it
 * anywhere legal; with it the box is merely approximate, which is a design that
 * looks wrong rather than a design that is arbitrary.
 */
const ASKED_RULES = [
	"#defined lrow/4.",
	"#defined lrowif/4.",
	"#defined laskdef/3.",
	"lrowout(N,I) :- lrowif(N,I,V,A), not pick(V,A).",
	"lask(N,S,Z) :- lrow(N,I,S,Z), not lrowout(N,I).",
	"lrowany(N,S) :- lrow(N,I,S,_), not lrowout(N,I).",
	"lask(N,S,Z) :- laskdef(N,S,Z), not lrowany(N,S).",
]

/**
 * The layout system, as rules over the facts a laid-out container emits.
 *
 * Written once and generically: `main`/`cross` swap the axes so a column is
 * the same equations as a row, and the conditional sum is the flexbox
 * identity — children plus gaps plus padding fill the container exactly.
 */
const LAYOUT_RULES = [
	"#defined word/2.",
	"#defined numeral/2.",
	"% ---- the settings, per universe ----",
	"% A layout's inputs are values like any other: picked per universe, and",
	"% free to name a token. So the facts the equations read are *derived* from",
	"% the pick rather than written down, exactly as c_value/2 is — which is what",
	"% makes a row at one breakpoint and a column at another one document.",
	"l_value(N,F,L) :- resolved(lval(N,F),L).",
	"lcontainer(C) :- lslot(C,_,_).",
	"% A word only counts where the setting offers it: point a direction at a",
	"% colour and nothing is derived.",
	"l_word(N,F,W) :- l_value(N,F,L), word(L,W), lopt(F,W).",
	"% What the container then goes by. A setting that resolves to nothing usable",
	"% takes the table's default rather than falling silent, because silence here",
	"% is not a relation left unstated — it is a container with no equations at",
	"% all, whose children come back at nothing by nothing. The editor's own",
	"% reading of a layout falls back the same way; see `layoutWord`.",
	"lword(C,F,W) :- lcontainer(C), l_word(C,F,W).",
	"lword(C,F,W) :- lcontainer(C), ldefword(F,W), not l_word(C,F,_).",
	"lnumber(C,F,V) :- lcontainer(C), l_value(C,F,L), numeral(L,V), V >= 0.",
	"% A negative gap or padding is not an arrangement, it is a typo.",
	"lnumber(C,F,0) :- lcontainer(C), l_value(C,F,L), numeral(L,V), V < 0.",
	"lreads(C,F) :- lcontainer(C), l_value(C,F,L), numeral(L,_).",
	"lnumber(C,F,V) :- lcontainer(C), ldefnum(F,V), not lreads(C,F).",
	"layout(C,D) :- lword(C,direction,D).",
	"lalign(C,A) :- lword(C,align,A).",
	"ljustify(C,J) :- lword(C,justify,J).",
	"lhug(C) :- lword(C,sizing,hug).",
	"lgap(C,V) :- lnumber(C,gap,V).",
	"lpad(C,V) :- lnumber(C,padding,V).",
	"% A child's own say does not default: saying nothing is what following the",
	"% container is, and not growing is what not growing is.",
	"lgrow(N) :- l_word(N,grow,grow).",
	"lalignself(N,A) :- l_word(N,alignSelf,A).",
	"",
	"#defined lslot/3.",
	...ASKED_RULES,
	"% Which axis is which, so one set of equations covers both directions.",
	"lmain(C,x) :- layout(C,row).",
	"lmain(C,y) :- layout(C,column).",
	"lcross(C,y) :- layout(C,row).",
	"lcross(C,x) :- layout(C,column).",
	"lmainsz(C,width) :- layout(C,row).",
	"lmainsz(C,height) :- layout(C,column).",
	"lcrosssz(C,height) :- layout(C,row).",
	"lcrosssz(C,width) :- layout(C,column).",
	"laxis(C,S) :- lmainsz(C,S).",
	"laxis(C,S) :- lcrosssz(C,S).",
	"lnext(C,A,B) :- lslot(C,A,I), lslot(C,B,J), J = I+1.",
	"lcount(C,K) :- layout(C,_), K = #count{ X : lslot(C,X,_) }.",
	"llast(C,Z) :- lslot(C,Z,K), lcount(C,K).",
	"% What a child sits by on the cross axis: its own say if it has one,",
	"% otherwise the container's.",
	"lca(C,N,A) :- lslot(C,N,_), lalignself(N,A).",
	"lca(C,N,A) :- lslot(C,N,_), lalign(C,A), not lalignself(N,_).",
	"% A size a parent forces on a child settles that axis for it, so the child's",
	"% own hug no longer has a say there — the way `align-self: stretch` beats a",
	"% height of `auto`.",
	"lstretched(N,S) :- lca(C,N,stretch), lcrosssz(C,S).",
	"",
	"% ---- the container's own size ----",
	"% Fixed: whatever the document says.",
	"&sum{ lsz(C,S) } = Z :- layout(C,_), not lhug(C), laxis(C,S), lask(C,S,Z).",
	"% Hugging along the main axis: children, gaps and padding, exactly. The",
	"% container is in the same sum as its children, so a child that hugs in",
	"% turn simply contributes its own solved size.",
	"&sum{ lsz(C,S); -lsz(X,S) : lslot(C,X,_) } = T :- lhug(C), lmainsz(C,S),",
	"    not lstretched(C,S), lgap(C,G), lpad(C,P), lcount(C,K),",
	"    T = 2*P + (K-1)*G.",
	"% Hugging across it: the largest child plus padding. A maximum is not",
	"% something a simplex solver can express, so it is taken here, over the",
	"% sizes the children ask for — which for a child that hugs in turn is the",
	"% size its own contents come to, computed bottom-up before compiling.",
	"lbiggest(C,M) :- lhug(C), lcrosssz(C,S), M = #max{ Z : lslot(C,X,_), lask(X,S,Z) }.",
	"&sum{ lsz(C,S) } = T :- lhug(C), lcrosssz(C,S), not lstretched(C,S),",
	"    lbiggest(C,M), lpad(C,P), T = M + 2*P.",
	"",
	"% ---- children, along the main axis ----",
	"% A child keeps the size it asks for unless it grows into the leftover",
	"% space — and a container with nothing to divide has no leftover, so in a",
	"% hugging parent a grower is just its own size.",
	"lfixed(C,N) :- lslot(C,N,_), not lgrow(N).",
	"lfixed(C,N) :- lslot(C,N,_), lgrow(N), lhug(C).",
	"&sum{ lsz(N,S) } = Z :- lfixed(C,N), lmainsz(C,S), not lhug(N), lask(N,S,Z).",
	"% Growers share equally.",
	"&sum{ lsz(A,S); -lsz(B,S) } = 0 :- lgrow(A), lgrow(B), lslot(C,A,_),",
	"                                   lslot(C,B,_), lmainsz(C,S).",
	"% ...and together take up exactly what the container leaves them. Applied",
	"% only when something can actually stretch: with every child a fixed size",
	"% this would be an over-constrained system rather than a layout.",
	"lslack(C) :- lslot(C,N,_), lgrow(N), not lhug(C).",
	"&sum{ lsz(X,S) : lslot(C,X,_); -lsz(C,S) } = T :- lslack(C), lmainsz(C,S),",
	"    lgap(C,G), lpad(C,P), lcount(C,K), T = -2*P - (K-1)*G.",
	"% Laid end to end. Where the run begins, and how wide the gaps between the",
	"% children are, is the whole of what justification decides — and each mode",
	"% is one more linear relation between the offsets, the children's sizes and",
	"% the container's, so none of them costs the solver anything.",
	"&sum{ lv(A,M) } = P :- lslot(C,A,1), ljustify(C,J), J != center, J != end,",
	"                       lmain(C,M), lpad(C,P).",
	"% Centred: the run is centred in the container, which is the same statement",
	"% as half the leftover leading it — the padding cancels either way.",
	"&sum{ 2*lv(A,M); lsz(X,S) : lslot(C,X,_); -lsz(C,S) } = T :- lslot(C,A,1),",
	"    ljustify(C,center), lmain(C,M), lmainsz(C,S), lgap(C,G), lcount(C,K),",
	"    T = (1-K)*G.",
	"% Trailing: the run ends against the far padding.",
	"&sum{ lv(A,M); lsz(X,S) : lslot(C,X,_); -lsz(C,S) } = T :- lslot(C,A,1),",
	"    ljustify(C,end), lmain(C,M), lmainsz(C,S), lgap(C,G), lpad(C,P),",
	"    lcount(C,K), T = (1-K)*G - P.",
	"&sum{ lv(B,M); -lv(A,M); -lsz(A,S) } = G :- lnext(C,A,B), lmain(C,M),",
	"    lmainsz(C,S), lgap(C,G), ljustify(C,J), J != spaceBetween.",
	"% Spread out: the gap is itself an unknown, the same one between every pair,",
	"% and the last child ends flush. With a single child there is nothing to",
	"% spread, so it simply starts at the padding like any other.",
	"&sum{ lv(B,M); -lv(A,M); -lsz(A,S); -lgs(C) } = 0 :- lnext(C,A,B),",
	"    ljustify(C,spaceBetween), lmain(C,M), lmainsz(C,S).",
	"&sum{ lv(Z,M); lsz(Z,S); -lsz(C,S) } = T :- llast(C,Z), lcount(C,K), K > 1,",
	"    ljustify(C,spaceBetween), lmain(C,M), lmainsz(C,S), lpad(C,P), T = -P.",
	"",
	"% ---- children, across it ----",
	"&sum{ lsz(N,S); -lsz(C,S) } = T :- lca(C,N,stretch),",
	"                                   lcrosssz(C,S), lpad(C,P), T = -2*P.",
	"&sum{ lsz(N,S) } = Z :- lca(C,N,A), A != stretch,",
	"                        lcrosssz(C,S), not lhug(N), lask(N,S,Z).",
	"&sum{ lv(N,X) } = P :- lca(C,N,A), A != center, A != end,",
	"                       lcross(C,X), lpad(C,P).",
	"% Centred: twice the offset plus the size spans the container.",
	"&sum{ 2*lv(N,X); lsz(N,S); -lsz(C,S) } = 0 :- lca(C,N,center),",
	"                                              lcross(C,X), lcrosssz(C,S).",
	"&sum{ lv(N,X); lsz(N,S); -lsz(C,S) } = T :- lca(C,N,end),",
	"                                            lcross(C,X), lcrosssz(C,S),",
	"                                            lpad(C,P), T = -P.",
	"% `lv/2` and `lsz/2` are theory variables, never atoms: their values reach a",
	"% model through clingo-lpx as `__lpx(lv(n,x),\"12\")` and arrive under",
	"% `ShowType::Theory` rather than as shown atoms. So they are declared, not",
	"% shown — a `#show` of a signature nothing grounds is an info message in the",
	"% diagnostics panel on every document that has a layout.",
	"#defined lv/2.",
	"#defined lsz/2.",
]

/**
 * Solved geometry: the same `lv`/`lsz` unknowns, for nodes no layout places.
 *
 * A node is the solver's to place when a geometric constraint names it, or
 * when its parent lays it out. The two paths differ only in what they add: a
 * layout writes the equations itself, while a geometric constraint leaves the
 * system under-determined and simplex would then return an arbitrary point —
 * so being named by one also adds a pull back toward the stored frame.
 *
 * That pull is `|v - stored|`, which is not linear but is LP-encodable: a
 * spare variable bounded below by both differences, minimised. All of them
 * share one objective, so the answer is the *nearest* legal arrangement rather
 * than merely a legal one. It is a theory `&minimize`, not `#minimize`: it
 * ranks the points inside one answer set, not the answer sets, so it does not
 * make the program an optimising one — see `isOptimizing` in explore.ts.
 */
const GEOMETRY_RULES = [
	"#defined gsolved/1.",
	"#defined lslot/3.",
	"#defined child/2.",
	"#defined frame/3.",
	"#defined constraint/1.",
	"#defined c_kind/2.",
	"#defined c_node/2.",
	"#defined gkind/1.",
	"gaxis(x). gaxis(y).",
	"gspan(width). gspan(height).",
	"% Naming a node in a geometric constraint is what hands it over. The",
	"% switch is deliberately not consulted: which unknowns exist must not",
	"% depend on which constraints are assumed, and a node the solver places",
	"% with nothing to say about it lands on its stored frame anyway.",
	"gsolved(N) :- constraint(C), c_kind(C,K), gkind(K), c_node(C,N).",
	"gpos(N,A) :- gsolved(N), gaxis(A).",
	"gsize(N,S) :- gsolved(N), gspan(S).",
	"",
	"% ---- nearest to where the document put it ----",
	"&sum{ lv(N,A); -gd(N,A) } <= V :- gpos(N,A), frame(N,A,V).",
	"&sum{ lv(N,A); gd(N,A) } >= V :- gpos(N,A), frame(N,A,V).",
	"&sum{ lsz(N,S); -gd(N,S) } <= V :- gsize(N,S), frame(N,S,V).",
	"&sum{ lsz(N,S); gd(N,S) } >= V :- gsize(N,S), frame(N,S,V).",
	"% Resizing is dearer than moving, because to a designer they are not the",
	"% same concession: asked to line two boxes up by their bottoms, simplex",
	"% can meet the demand by dragging one down or by *growing* it, and at equal",
	"% cost it would pick either. The weight settles that tie the way a design",
	"% tool has to. It does not forbid a resize — `equalSize` and a pin on a",
	"% width have no other way to be satisfied, and still are.",
	"% Behind a switch so a probe can take it off; see the freedom rules below.",
	"&minimize{ gd(N,A) : gpos(N,A), gpull; 4*gd(N,S) : gsize(N,S), gpull }.",
	"",
	"% ---- world coordinates ----",
	"% Only along the chains that need one: a solved node and its ancestors.",
	"gworld(N,A) :- gsolved(N), gaxis(A).",
	"gworld(P,A) :- gworld(N,A), child(P,N).",
	"% An offset that is the solver's — a laid-out child's, or a solved node's",
	"% — enters as the unknown; anything else enters as the number the document",
	"% stores, which is what keeps a deep tree cheap.",
	"gmoved(N,A) :- gpos(N,A).",
	"gmoved(N,A) :- lslot(_,N,_), gaxis(A).",
	"&sum{ wv(N,A); -wv(P,A); -lv(N,A) } = 0 :- gworld(N,A), child(P,N), gmoved(N,A).",
	"&sum{ wv(N,A); -wv(P,A) } = V :- gworld(N,A), child(P,N), not gmoved(N,A),",
	"                                 frame(N,A,V).",
	"&sum{ wv(N,A); -lv(N,A) } = 0 :- gworld(N,A), not child(_,N), gmoved(N,A).",
	"&sum{ wv(N,A) } = V :- gworld(N,A), not child(_,N), not gmoved(N,A),",
	"                       frame(N,A,V).",
	"% A box narrower than nothing is not a compromise, it is a wrong answer.",
	"% Without this, two demands that can only be met by turning a node inside",
	"% out come back as a negative width rather than as a conflict.",
	"&sum{ lsz(N,S) } >= 0 :- gsize(N,S).",
	"",
	"% ---- edges, each as one linear quantity ----",
	"% `ge(N,E)` is twice the coordinate of edge E on node N. Doubled because a",
	"% centre is otherwise a half, and the guard side of a &sum takes a single",
	"% bound term rather than arithmetic — so every relation between edges is a",
	"% sum of whole multiples and an integer bound.",
	"#defined gedgeof/2.",
	"glead(A,E) :- gedge(E,A,pos), gplace(E,lead).",
	"gmid(A,E) :- gedge(E,A,pos), gplace(E,mid).",
	"gtrail(A,E) :- gedge(E,A,pos), gplace(E,trail).",
	"gspanof(A,E) :- gedge(E,A,span).",
	"% How much of the node's own size lies before the edge, doubled to match.",
	"goff(E,0) :- gplace(E,lead).",
	"goff(E,1) :- gplace(E,mid).",
	"goff(E,2) :- gplace(E,trail).",
	"&sum{ ge(N,E); -2*wv(N,A); -K*lsz(N,S) } = 0 :- gedgeof(N,E), gedge(E,A,pos),",
	"    goff(E,K), gspanof(A,S).",
	"&sum{ ge(N,E); -2*lsz(N,E) } = 0 :- gedgeof(N,E), gedge(E,_,span).",
]

/**
 * How much of the geometry is still free — the same question the brave
 * consequences answer for properties, asked of a continuous quantity.
 *
 * A coordinate is pinned when its least and greatest legal values coincide,
 * and clingo-lpx will report either on request. What it will not do is report
 * both at once: the objective is one number, so a probe that names several
 * coordinates gets their *sum*, and a single unbounded one poisons the lot —
 * measured, and the reason there is no cheap whole-document map here. So the
 * probe names one coordinate and one direction, and the answer is exact.
 *
 * Both switches are ordinary atoms the caller assumes, so probing costs a
 * solve on the grounding that is already open rather than a re-grounding. The
 * pull has to come off while probing — with it on, every extreme would be the
 * point the document already has — so the probe choice only exists when it is
 * off, and an ordinary solve turns them all off by assuming the pull.
 */
const FREEDOM_RULES = [
	"",
	"% ---- what is still free ----",
	"#defined layout/2.",
	// The same four rules as the layout section, which is not emitted at all for
	// a document with no layout in it — and a hand-written rule may still assert
	// `lslot/3`. Stating a rule twice is stating it once.
	...ASKED_RULES,
	"% Every coordinate the solver decides rather than reads off the document.",
	"gcoord(N,A) :- gpos(N,A).",
	"gcoord(N,S) :- gsize(N,S).",
	"gcoord(N,A) :- lslot(_,N,_), gaxis(A).",
	"gcoord(N,S) :- lslot(_,N,_), gspan(S).",
	"gcoord(C,S) :- layout(C,_), gspan(S).",
	"gdir(min). gdir(max).",
	"{ gpull }.",
	"% One coordinate, one direction, and only with the pull off — anything more",
	"% in the objective and the answer stops being about that coordinate.",
	"{ gprobe(N,A,D) : gcoord(N,A), gdir(D) } 1 :- not gpull.",
	"&maximize{ lv(N,A) : gprobe(N,A,max), gaxis(A);",
	"           -lv(N,A) : gprobe(N,A,min), gaxis(A);",
	"           lsz(N,S) : gprobe(N,S,max), gspan(S);",
	"           -lsz(N,S) : gprobe(N,S,min), gspan(S) }.",
]

/**
 * What a node that no fact describes still amounts to.
 *
 * `node/1` is no longer only a fact: a rule may bring nodes into being, and
 * `node(cell(R,C)) :- pos(R), pos(C).` is a grid the document does not contain.
 * A node so derived has exactly what its rule said and nothing else, and the
 * renderer needs a kind before it will draw anything at all — so rather than
 * demanding all five predicates of anyone who writes such a rule, each one the
 * picture needs defaults here.
 *
 * The defaults matter beyond the renderer: the geometry rules read `frame/3`
 * for the pull toward the stored frame and for the world-coordinate chain, so
 * without one a derived node handed to `gsolved` would land on an arbitrary
 * legal point rather than on the origin.
 *
 * Each is written so that it cannot unsay itself. `kinded/1` deliberately does
 * not count `frame`, the default kind: were it to, supplying the default would
 * be the reason the default no longer applies, and the pair would have no
 * stable model at all rather than the obvious one. Same for `order` and 1, and
 * for `frame` and 0.
 */
const SCENE_DEFAULT_RULES = [
	"#defined node/1.",
	"#defined kind/2.",
	"#defined order/2.",
	"#defined frame/3.",
	"#defined numeral/2.",
	"% ---- geometry, per universe ----",
	"% A dimension is a value like any other: picked per universe, and free to",
	"% name a token. So `frame/3` is *derived* from the pick wherever a document",
	"% wrote alternatives — which is what makes \"here on desktop, there on",
	"% mobile\" one document — and stays a plain fact wherever it wrote one",
	"% number, which is every rectangle nobody has asked to vary.",
	"f_value(N,D,L) :- resolved(fval(N,D),L).",
	"% Through numeral/2, so the number here is the same number the editor reads",
	"% off the document: both round, so the canvas and hit testing agree exactly.",
	"% A dimension that reads as no number at all derives nothing and falls to",
	"% the default below, rather than meaning zero by accident.",
	"frame(N,D,V) :- f_value(N,D,L), numeral(L,V).",
	"kinded(N) :- kind(N,K), K != frame.",
	"kind(N,frame) :- node(N), not kinded(N).",
	"ordered(N) :- order(N,I), I != 1.",
	"order(N,1) :- node(N), not ordered(N).",
	"framed(N,A) :- frame(N,A,V), V != 0.",
	"frame(N,A,0) :- node(N), gaxis(A), not framed(N,A).",
	"frame(N,S,0) :- node(N), gspan(S), not framed(N,S).",
]

/**
 * Components, as rules over the facts a definition and an instance emit.
 *
 * The whole feature is here, and it is short because nothing about it is new
 * machinery: a definition is a subtree, and an instance is that subtree's
 * *variables minted again*. Everything downstream — the choice rule, `resolved`,
 * `rendered`, projection, the reachability marks, pinning — then applies to an
 * instance's properties because they are ordinary variables and it cannot tell
 * the difference.
 *
 * Two consequences worth naming, because they are the reason for doing it this
 * way rather than by copying a subtree into the document:
 *
 *   - Editing the definition changes every instance, with nothing to propagate.
 *     The instances were never a copy; they are derived from the definition on
 *     every solve.
 *   - Two instances can differ, because each has its own `pick/2` over the same
 *     alternatives — and they can differ *only* where the definition wrote more
 *     than one alternative, because that is the only place there is a pick to
 *     make. Neither of those is enforced anywhere. They are what the shape is.
 *
 * The definition's own subtree is compiled and drawn like any other, so what is
 * on the canvas beside the instances is a real point in the component's space,
 * not a preview of one.
 */
const COMPONENT_RULES = [
	"#defined component/1.",
	"#defined cpart/2.",
	"#defined cinner/2.",
	"#defined instance/2.",
	"#defined alt_token/3.",
	"#defined alt_derived/4.",
	"% ---- the instance's copy of the definition's tree ----",
	"% Derived, not copied into the document: one place stays the truth. `cpart`",
	"% is the definition root and everything under it, `cinner` the same without",
	"% the root, which is the only part whose geometry differs — the root copy",
	"% fills the instance's own box, and everything inside sits where the",
	"% definition put it.",
	"node(inst(I,N)) :- instance(I,R), cpart(R,N).",
	"kind(inst(I,N),K) :- instance(I,R), cpart(R,N), kind(N,K).",
	"order(inst(I,N),O) :- instance(I,R), cinner(R,N), order(N,O).",
	"child(I,inst(I,R)) :- instance(I,R).",
	"child(inst(I,P),inst(I,N)) :- instance(I,R), cinner(R,N), child(P,N), cpart(R,P).",
	"frame(inst(I,N),D,V) :- instance(I,R), cinner(R,N), frame(N,D,V).",
	"% The root copy takes the instance's size and sits at its origin, so an",
	"% instance is resizable the way a placement should be, while what is inside",
	"% it stays the definition's arrangement. Its x and y are left to the scene",
	"% defaults, which is what puts them at zero.",
	"frame(inst(I,R),S,V) :- instance(I,R), gspan(S), frame(I,S,V).",
	"",
	"% ---- the definition's variables, minted once per instance ----",
	"% This is what makes an instance a *point* in the component's space rather",
	"% than a picture of it. Same alternatives, its own pick.",
	"alt(prop(inst(I,N),P),K) :- instance(I,R), cpart(R,N), alt(prop(N,P),K).",
	"alt_literal(prop(inst(I,N),P),K,L) :- instance(I,R), cpart(R,N),",
	"                                      alt_literal(prop(N,P),K,L).",
	"% A token is the document's, shared by everyone, so a link is copied as it is.",
	"alt_token(prop(inst(I,N),P),K,T) :- instance(I,R), cpart(R,N),",
	"                                    alt_token(prop(N,P),K,T).",
	"% A derivation that reads another part of the *same* definition has to read",
	"% this instance's copy of that part, or every instance's computed ink would",
	"% follow the definition's fill instead of its own. Anything else — a token, a",
	"% node outside the definition — is copied unchanged.",
	"cpartvar(R,prop(S,Q)) :- cpart(R,S), alt(prop(S,Q),_).",
	"alt_derived(prop(inst(I,N),P),K,Via,prop(inst(I,S),Q)) :- instance(I,R),",
	"    cpart(R,N), alt_derived(prop(N,P),K,Via,prop(S,Q)), cpartvar(R,prop(S,Q)).",
	"alt_derived(prop(inst(I,N),P),K,Via,S) :- instance(I,R), cpart(R,N),",
	"    alt_derived(prop(N,P),K,Via,S), not cpartvar(R,S).",
]

/**
 * Styles, as two rules over the facts a style and its wearers emit.
 *
 * Short, because a style is not new machinery: it is one more variable, and its
 * alternatives happen to be records. `sty(S)` picks exactly like `tok(T)` does,
 * and everything downstream — pinning, brave and cautious reachability, being
 * named by a rule, projection — applies to it because none of them can tell the
 * difference.
 *
 * What is new is only the join, and it is the second rule. A style's variant
 * decides several properties *at once*, so the pick lands on a whole record
 * rather than on a literal, and one pick then writes into several
 * `resolved(prop(N,P))`. That is the entire content of the feature: it turns a
 * cross product into a correlation. Two two-alternative tokens linked to size
 * and weight give four designs of which two are incoherent; one two-variant
 * style gives two, and both are coherent by construction.
 *
 * Emitted always, like the geometry and component rules and for the same
 * reason: `sty_wears/3` and `alt(sty(S),I)` are things a hand-written rule may
 * assert — "every node in this row wears the compact treatment" is one rule —
 * and a contract that quietly does nothing on some documents is not one.
 */
const STYLE_RULES = [
	"#defined sty_wears/3.",
	"% What one variant says about one property, in this universe.",
	"%",
	"% A part is a value in every sense but one — it holds a single alternative,",
	"% because branching is what the *list of variants* is for — so it resolves",
	"% through the same rules a fill does, token links and derivations included.",
	"% `sty_lit/4` is a plain fact wherever the document wrote a bare literal and",
	"% a resolved variable wherever it wrote a link, exactly as `frame/3` is: the",
	"% split is a cost decision and only that, and no rule can tell which it was.",
	"sty_lit(S,I,P,L) :- resolved(spart(S,I,P),L).",
	"% The join. `sty_wears/3` is per node *per property*, which is where",
	"% precedence lives: a node that states its own value for a property is",
	"% simply not in it, so there is nothing to prefer here and no negation to",
	"% write. See `wornProps`, which also drops a property the node's kind has",
	"% nowhere to put — a text style worn by a rectangle decides nothing about",
	"% the rectangle.",
	"resolved(prop(N,P),L) :- sty_wears(N,S,P), pick(sty(S),I), sty_lit(S,I,P,L).",
]

/**
 * The geometric vocabulary, as facts. Written out of the one table that says
 * what an edge is, so no rule ever names an edge.
 */
const EDGE_FACTS = EDGE_NAMES.flatMap((edge) => {
	const spec = EDGES[edge]
	return [
		atom("gedge", edge, spec.axis, spec.role),
		...(spec.place ? [atom("gplace", edge, spec.place)] : []),
	]
})

/**
 * The geometric constraint kinds, as relations between edges.
 *
 * Each is behind the same `active(C)` switch as a property constraint, so a
 * pair that cannot both hold comes back as a core naming exactly those two —
 * the theory propagator reports its conflicts through the same assumptions.
 * A geometric kind is one entry in `CONSTRAINT_KINDS` plus one rule here.
 */
const GEOMETRIC_CONSTRAINT_RULES = [
	"#defined c_edge/2.",
	"#defined c_slot/3.",
	"#defined numeral/2.",
	"gcon(C) :- constraint(C), c_kind(C,K), gkind(K).",
	"% The dimension, per universe. It is not a fact: a constraint's value is a",
	"% variable like any other, so pointing it at a token makes the token's",
	"% alternatives drive the geometry. A value that reads as no number at all —",
	"% a dangling reference, a percentage — derives nothing, and the relation",
	"% below then simply goes unstated rather than meaning zero.",
	"c_value(C,V) :- resolved(cval(C),L), numeral(L,V).",
	"% Which edges the members actually need a variable for. Deriving it rather",
	"% than giving every solved node all eight keeps the simplex tableau to the",
	"% quantities the document mentions.",
	"gaxial(C,A) :- gcon(C), c_edge(C,E), gedge(E,A,axis).",
	"gneed(C,E) :- gcon(C), c_edge(C,E), gedge(E,_,R), R != axis.",
	"gneed(C,E) :- gaxial(C,A), glead(A,E).",
	"gneed(C,E) :- gaxial(C,A), gtrail(A,E).",
	"gneed(C,E) :- gaxial(C,A), gmid(A,E).",
	"gedgeof(N,E) :- gcon(C), c_node(C,N), gneed(C,E).",
	"% The switch, exactly as the property kinds use it.",
	"gon(C,K) :- gcon(C), c_kind(C,K), active(C).",
	"",
	"% align: every member shares the quantity, so the relation is pairwise.",
	"&sum{ ge(A,E); -ge(B,E) } = 0 :- gon(C,align), c_edge(C,E),",
	"                                 c_node(C,A), c_node(C,B), A<B.",
	"% equalSize: the same statement, about a size rather than a place.",
	"&sum{ ge(A,E); -ge(B,E) } = 0 :- gon(C,equalSize), c_edge(C,E),",
	"                                 c_node(C,A), c_node(C,B), A<B.",
	"% gap: edge to edge along one axis, from the first member to the second.",
	"&sum{ ge(B,L); -ge(A,T) } = D :- gon(C,gap), gaxial(C,X), glead(X,L),",
	"    gtrail(X,T), c_slot(C,A,1), c_slot(C,B,2), c_value(C,V), D = 2*V.",
	"% symmetric: two members either side of a third's centre...",
	"gmirror(C) :- c_slot(C,_,3).",
	"&sum{ ge(A,M); ge(B,M); -2*ge(K,M) } = 0 :- gon(C,symmetric), gaxial(C,X),",
	"    gmid(X,M), c_slot(C,A,1), c_slot(C,B,2), c_slot(C,K,3).",
	"% ...or of a line on the canvas, when there is no third member to be it.",
	"&sum{ ge(A,M); ge(B,M) } = D :- gon(C,symmetric), gaxial(C,X), gmid(X,M),",
	"    c_slot(C,A,1), c_slot(C,B,2), not gmirror(C), c_value(C,V), D = 4*V.",
	"% pin: the escape hatch — one quantity, one number, no freedom left.",
	"&sum{ ge(N,E) } = D :- gon(C,pin), c_edge(C,E), c_node(C,N), c_value(C,V),",
	"                       D = 2*V.",
]

/**
 * Which constraint kinds place their nodes. Read off the one table that says
 * what a kind is, so a geometric kind never needs a case here.
 */
const GEOMETRIC_KINDS = Object.entries(CONSTRAINT_KINDS)
	.filter(([, spec]) => spec.geometric)
	.map(([kind]) => `gkind(${kind}).`)

/**
 * What each layout setting may say, as facts — written out of the one table
 * that says what a setting is, so no rule ever spells a menu out.
 *
 * It is the guard on the derivation: a direction that resolves to something
 * that is not `row` or `column` says nothing, rather than laying the container
 * out along an axis that does not exist.
 */
const LAYOUT_OPTIONS = LAYOUT_PROP_NAMES.flatMap((prop) => {
	const spec = LAYOUT_PROPS[prop]
	const options = VALUE_TYPES[spec.type].options
	const facts = (options ?? []).map((o) => atom("lopt", prop, o.value))
	// Only the container's settings default; a child's absence is a statement.
	if (spec.on !== "container") return facts
	if (options) return [...facts, atom("ldefword", prop, spec.fallback)]
	const n = numeralOf(spec.fallback)
	return n === undefined ? facts : [atom("ldefnum", prop, Math.round(n))]
})

/** Predicates the generated program exposes to user rules. */
export const CONTRACT = `% Predicates you can rely on:
%
%   var(V)                      every variable the solver picks for
%   alt(V, I)                   alternative I exists for V
%   pick(V, I)                  the chosen alternative   <- exactly one per var
%   alt_literal(V, I, Lit)      alternative I is the literal Lit
%   alt_token(V, I, Token)      alternative I links to a token
%   alt_derived(V, I, Via, Src) alternative I is computed from Src
%   derived_of(Via, Src, Lit)   what Via turns Src into
%   resolved(V, Lit)            V's final literal, following links and
%                               derivations
%   dvar(V)                     derived: V is a variable no *document* value
%                               named — see below
%   viol(C)                     constraint C is violated. Yours to derive as
%                               well — see the \`custom\` kind below
%   active(C)                   C is switched on (assumed while solving).
%                               Readable in a body, which is how a rule stays
%                               unground while its switch is off
%   rendered(Node, Prop, Lit)   what a node actually draws with
%   literal(Lit, "text")        the text a literal id stands for
%   numeral(Lit, N)             the number a literal reads as: "24px" is 24
%   word(Lit, W)                the constant one reads as: "row" is row
%
% Variables are named after where they live:
%   prop(Node, Property)        a node's property
%   tok(Token)                  a token's own definition
%   cval(C)                     the dimension a geometric constraint holds to
%   lval(Node, Setting)         one input to an automatic layout
%   fval(Node, x|y|width|height)  one of a node's own four dimensions
%   sty(Style)                  which treatment a style is wearing — the one
%                               variable whose alternatives are whole records
%
% Styles. One pick decides several properties together, which is the one thing
% linking each property to its own token cannot express: two 2-alternative
% tokens are four designs, of which half pair a display size with a body
% weight. A style is a variable over *variants*, and a variant is a complete
% answer for every property it mentions.
%
%   style(S)  style_name(S, "name")
%   alt(sty(S), I)              variant I exists. No alt_literal beside it: a
%                               variant is a record, not a literal, so
%                               resolved(sty(S),_) is never derived
%   sty_lit(S, I, Prop, Lit)    what variant I says about Prop, this universe.
%                               A fact where the document wrote a literal;
%                               derived from resolved(spart(S,I,Prop)) where it
%                               wrote a token link or a derivation
%   sty_wears(N, S, Prop)       N takes Prop from S. Per property, because a
%                               node that states its own value keeps it — assert
%                               it yourself to dress nodes your rules created
%
% A style is the one variable the way out keeps as a variable: the HTML export
% writes it as a CSS class, so the properties every wearer takes from it are one
% shared block under the style's own name and a wearer's rule holds only what it
% overrides. Two consequences worth knowing when you write rules over one:
%
%   - a class can only say what every wearer *draws*, so a style holding both a
%     fill and a size, worn by a rectangle and by some text, shares neither. Two
%     styles is the way to say that, and it is also what it means;
%   - wearing is read from the document. A node your rule dressed by asserting
%     sty_wears/3 is exported with the properties inlined and shares no class,
%     the same way a rule-minted node's token link exports as the literal.
%
% Where the *only* thing a document's universes disagree about is sty(S), that
% export is one file with both treatments in it: a media query where the
% variants differ in lengths — the tighter type scale is the narrow screen — and
% prefers-color-scheme where they differ only in colour. A style may do that and
% a loose length token may not, because a property is never a coordinate: no
% class can end up standing in for a \`left\` that the solver worked out.
%
% alt/2 is a derivable predicate too, so a rule can mint a variable the
% document never named, and it then picks, resolves, renders, greys and pins
% exactly like a property row. Give it a key the studio can read back — the
% four forms above — and the inspector will show it as a row on the node it
% belongs to:
%
%   alt(prop(cell(R,C),text), D) :- open(R,C), digit(D).
%   alt_literal(prop(cell(R,C),text), D, dig(D)) :- alt(prop(cell(R,C),text),D).
%   literal(dig(1),"1"). ... literal(dig(9),"9").
%
% Indices are yours: any integer, dense or not. What is offered as a row is
% dvar/1 with its dalt/3 alternatives, both projected out of the answer set, so
% only the alternatives a rule minted cost anything to report. An alternative
% that links to a token or computes itself from one is reported as the literal it
% comes to *in this universe*, which is the only literal it has — what the row
% loses is the name it named, not the alternative.
%
% Scene. These are ordinary predicates, not a fixed table: the document
% supplies facts for them and your rules may derive more. A node the document
% does not hold is a *derived* node — it draws, it lists in Layers marked as
% such, and it has nothing to drag or type into, the way a fully constrained
% node has nowhere left to be dragged to.
%
%   node(N)  kind(N, ${NODE_KINDS.join("|")})  child(Parent, Child)
%   order(N, I)                 where N sits among its siblings, 1-based —
%                               child/2 is a set, so this is the paint order
%   frame(N, x|y|width|height, Pixels)   <- relative to the parent, if any.
%                               A fact where the document holds one number for
%                               a dimension; derived from f_value/3 where it
%                               holds a choice, so a node can sit in one place
%                               in one universe and elsewhere in another
%   f_value(N, D, Lit)          derived: resolved(fval(N,D)) — projected, so
%                               two positions really are two designs
%   rendered(N, Prop, Lit)      what it draws with — an interned literal id, or
%                               the text itself in quotes
%   hidden(N)                   assert to remove a node
%   visible(N)                  derived: node(N), not hidden(N)
%
% Only node/1 has to be said. The rest default, so a rule need state just the
% parts it cares about:
%
%   kind(N,_)      frame            order(N,_)   1
%   frame(N,_,_)   0                child(_,N)   nothing: it is a root
%   rendered(N,_)  nothing: an unpainted box
%
% A node id may be any term, so a family of them can be indexed. Worked
% example — a three-by-three grid inside the frame 'board', in one universe or
% in several:
%
%   pos(1..3).
%   node(cell(R,C)) :- pos(R), pos(C).
%   kind(cell(R,C),rect) :- pos(R), pos(C).
%   child(board,cell(R,C)) :- pos(R), pos(C).
%   frame(cell(R,C),x,X) :- pos(R), pos(C), X = 20 + (C-1)*70.
%   frame(cell(R,C),y,Y) :- pos(R), pos(C), Y = 20 + (R-1)*70.
%   frame(cell(R,C),width,50) :- pos(R), pos(C).
%   frame(cell(R,C),height,50) :- pos(R), pos(C).
%   rendered(cell(R,C),fill,"#38bdf8") :- pos(R), pos(C).
%
% Universes may now differ in *structure*, not only in values — hide a cell on
% the diagonal in some designs and not others and the two are different
% pictures. visible/1 is projected, so that really is two universes.
%
% Constraints, as facts. The geometric ones speak of edges rather than
% properties, and their dimension is resolved per universe, not stored:
%
%   constraint(C)  c_kind(C, ${CONSTRAINT_NAMES.join("|")})
%   c_node(C, N)                a member    c_slot(C, N, I)  which one
%   c_group(C, G)               range over a set instead of listing members:
%                               c_node(C,N) :- c_group(C,G), member(G,N)
%   group(G)  member(G, N)      yours to derive. Every group/1 instance is
%                               offered in the Rules panel as something a
%                               constraint can be pointed at, so a rule that
%                               builds nine cells can name the row they are in
%                               and the rule that constrains it needs no ASP
%   c_prop(C, Prop)             what a property rule is about
%   c_edge(C, E)                what a geometric one is about
%   c_level(C, L)  c_weight(C, W)   present only for a *soft* rule: violating it
%                               costs W at priority L instead of being forbidden
%   c_soft(C)                   derived: C is ranked rather than prohibited
%   c_value(C, Pixels)          derived: numeral(resolved(cval(C)))
%   gkind(K)                    K places its nodes rather than colours them
%   gedge(E, x|y, pos|span|axis)   what an edge is
%   gplace(E, lead|mid|trail)      and where on the node it sits
%
% viol/1 is a derivable predicate too, and that is what the kind \`custom\` is
% for. It has no members, no property and no edge, and the generated program
% derives no viol/1 for it — a rule of yours does, against the term the document
% gave it. Add one in the Rules panel, name it, and write the condition:
%
%   viol(no_wide_gaps) :- lgap(row,G), G > 24.
%
% That is a plain \`:- ...\` with two things added, and they are the two things a
% bare integrity constraint can never have: an enable checkbox, and a name in
% the core when the document turns out to have no design at all. A viol/1 whose
% term is not a constraint in the document is never guarded and so does nothing
% — which is what a renamed or mistyped id leaves behind.
%
% Set that same rule's strength to a preference and nothing about the line you
% wrote changes: the viol/1 it derives is *ranked* instead of forbidden, and the
% cost it carries shows on the design that paid it. That is the whole of soft
% custom rules — a preference you can phrase in ASP, with a name, a switch, and
% a price.
%
% Preference in general. Levels are lexicographic — no amount of cost at a lower
% level outweighs a point at a higher one — and only designs within a bound of
% the best are shown, so a document that ranks its designs still holds several.
% You can write your own weak constraint too, and it composes with the document's:
%
%   :~ rendered(N,fill,L), pale(L). [1@1, N]
%
% Two things to know. Priorities 1 to 3 are the tiers the rules panel offers, so
% level 0 is the one that ranks below all of them; and a cost vector reports one
% entry per level in the program, highest first, so adding a level of your own
% shifts what the status line can name.
%
% The theory objective is a different mechanism entirely and does not interact
% with this: &minimize ranks the *points* simplex may return inside one answer
% set, while a weak constraint ranks the answer sets. Both are live at once —
% solved geometry still lands where it should in a ranked document.
%
% Reading your own switch is allowed and is worth knowing about, because a
% constraint that is off emits no constraint/1 fact: active(...) then has
% nothing to derive it from, so a rule whose body says it is discarded at
% grounding rather than merely turning out false. That is how a requirement you
% are not using costs nothing —
%
%   deep(N,D) :- active(no_deep_nesting), depth(N,D), D > 3.
%   viol(no_deep_nesting) :- deep(_,_).
%
% — and it is why renaming a rule rewrites active(old) alongside viol(old).
%
% Components. A definition is a subtree; an instance is that subtree's
% variables minted again, so an instance is a *point* in the component's space
% rather than a copy of one:
%
%   component(R)                R's subtree is a definition
%   cpart(R, N)                 N is part of it — R included
%   cinner(R, N)                the same without R, whose copy takes the
%                               instance's own box
%   instance(I, R)              I is a use of R. Derivable: one rule can put a
%                               dozen instances on the canvas
%
% Everything under an instance is derived from those:
%
%   node(inst(I,N))  kind  order  child  frame        the copy of the tree
%   alt(prop(inst(I,N),P), K)                         its own choices, over the
%                                                     definition's alternatives
%
% So two instances differ exactly where the definition wrote more than one
% alternative, and nowhere else. An *override* is not a predicate: it is
% pick(prop(inst(I,N),P),K) assumed, which is the same thing a pin is.
%
% Automatic layout. The settings are values, so the predicates the equations
% read are derived per universe rather than stated:
%
%   lslot(C, N, I)              N is the Ith child C arranges
%   lopt(Setting, Word)         what a setting may say; Setting is one of
%                               ${LAYOUT_PROP_NAMES.join(", ")}
%   l_value(N, Setting, Lit)    derived: resolved(lval(N,Setting))
%   layout(C, row|column)  lgap(C, Px)  lpad(C, Px)  lhug(C)
%   lalign(C, A)  ljustify(C, J)  lgrow(N)  lalignself(N, A)
%                               derived from those, and what the equations use
%
% What a node asks to be is a *table*, because a measured box is a function of
% a tuple of picks: what it says, which treatment it wears, which step of a
% scale that treatment names. Nothing about the rows is per document — a row
% declares the picks it holds for and the join is one generic rule:
%
%   lask(N, width|height, Px)   derived: what N asks to be with nothing pushing
%                               on it. A plain fact where the document settles
%                               it, which is most nodes
%   lrow(N, I, width|height, Px)   one row of the table, where it does not
%   lrowif(N, I, Var, Alt)      row I holds only in universes where Var picked
%                               Alt. A row with no lrowif holds in all of them
%   laskdef(N, width|height, Px)   what N asks when no row holds at all: a
%                               measurement budget that dropped an axis, or an
%                               alternative a rule of yours minted. Without it
%                               such a node has no size equation and simplex
%                               puts it anywhere legal
%
% Geometry the solver decides, rather than the document:
%
%   gsolved(N)                  assert to hand N's frame to the solver
%   lv(N, x|y)                  its offset inside its parent
%   lsz(N, width|height)        its size
%   wv(N, x|y)                  where it lands on the canvas — the parent's
%                               world coordinate plus this node's own offset,
%                               chained to the root, so two nodes under
%                               different parents are finally comparable
%   ge(N, ${EDGE_NAMES.filter((e) => EDGES[e].role !== "axis").join("|")})
%                               twice one of its edges, in world coordinates
%                               — assert gedgeof(N,E) to bring one into being
%
% Those are theory variables, not atoms. A solved node with nothing said
% about it lands exactly on its stored frame; say something, and it moves as
% little as it can to satisfy you. Edges are doubled so a centre is whole.
% Being theory variables, they can never make two answer sets differ: what
% makes one geometry a *different design* from another is what the document
% names — a constraint's dimension, a layout's settings — which is why
% c_value/2 and l_value/3 are projected alongside rendered/3.
%
% Linear arithmetic (clingo-lpx) is available too. Variables here are not
% atoms: they take values from a simplex solver, reported as __lpx(V,"N").
% Values are exact rationals, and a constraint may relate any number of them —
% &sum{ 2*c; -l; -r } = 0 centres c between l and r whatever their width.
%
%   &sum{ x; -y } >= 16.        x is at least 16 past y
%   &dom{ 0..960 } = x.         bound a variable
%   &minimize{ x }.             rank models by it; each model then also
%                               reports __lpx_objective("N",Bounded)
%
% There is only ever one theory objective, and the studio already uses it
% twice: to keep solved nodes near where you drew them, and to ask how far a
% coordinate could travel. Writing your own adds to it, which will skew both.
% Inequalities on lv/lsz are the way to say "no further than this", and the
% freedom readout picks them up.
%
% Examples:
%   :- resolved(prop(card,fill), C), resolved(prop(badge,fill), C).
%   :- frame(A,x,X), frame(B,x,X), child(P,A), child(P,B), A != B.
%   gsolved(badge).  &sum{ wv(badge,x); -wv(card,x) } >= 24.
%   node(shadow). child(card,shadow). frame(shadow,width,120).`;

function atom(name: string, ...args: Array<string | number>): string {
	return `${name}(${args.join(",")}).`;
}

function section(title: string, lines: string[]): string {
	if (lines.length === 0) return "";
	return `% ---- ${title} ----\n${lines.join("\n")}\n`;
}

/**
 * ASP string literals need their quotes and backslashes escaped — and their
 * line breaks, which a clingo string cannot hold at all. Text is a property
 * like any other and the editor gives it a box you can type a paragraph into,
 * so a raw newline reaching the lexer is an ordinary document, not an edge
 * case. `unquote` puts it back.
 */
function quote(text: string): string {
	return `"${text
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\r?\n/g, "\\n")}"`;
}

export interface CompileResult {
	/** The full program handed to clingo. */
	program: string;
	/** Just the generated half, for display in the power panel. */
	generated: string;
	/**
	 * 1-based line in `program` where the user's rules begin, so clingo's
	 * diagnostics can be reported against what the user actually typed.
	 */
	userRulesLine: number;
	/** Variable key -> how many alternatives it has. */
	variables: Record<string, number>;
	/**
	 * One switch atom per enabled constraint. Assume them all when solving; on
	 * UNSAT the solver returns the conflicting subset.
	 */
	guards: string[];
	/**
	 * Priority levels the document's soft rules use, highest first — empty when
	 * every rule is a prohibition.
	 *
	 * The key to reading a cost vector: clingo reports one entry per level
	 * *present in the program*, in descending order, so `costs[i]` is what a
	 * design gave up at `levels[i]`. Reported from here rather than read off the
	 * document because this is the code that decides which constraints made it
	 * into the program at all — a rule with too few members emits nothing and so
	 * contributes no level either.
	 *
	 * It is the document's levels only. A `:~` in the Rules panel adds its own,
	 * which shifts the vector, and nothing here can see that — hence the length
	 * check wherever a cost is labelled.
	 */
	levels: number[];
}

/**
 * Distinct literals are interned so rules can compare them by identity.
 * Two `#3b82f6`s anywhere in the document become the same `l0`.
 */
class LiteralTable {
	#ids = new Map<string, string>();

	id(text: string): string {
		const existing = this.#ids.get(text);
		if (existing) return existing;
		const id = `l${this.#ids.size}`;
		this.#ids.set(text, id);
		return id;
	}

	/** Every literal interned so far. Snapshotted: `id` may extend the table. */
	texts(): string[] {
		return [...this.#ids.keys()];
	}

	facts(): string[] {
		return [...this.#ids].map(([text, id]) => atom("literal", id, quote(text)));
	}
}

export interface CompileOptions {
	/**
	 * Natural sizes for the nodes that size themselves to their content. They
	 * arrive from outside because measuring text needs a canvas; see
	 * `measure.ts`. Absent, every node asks for the frame it was drawn at.
	 */
	measurements?: Measurements;
}

/**
 * A node's asked size, as either one fact or a table the picks select from.
 *
 * Both would be two equations for one unknown, so it is one or the other. Which
 * it is falls out of {@link askedAxes}: no axes is a node whose size the
 * document settles once, and the great majority of nodes are that.
 *
 * The rows are `naturalSize` evaluated per combination, which is measured
 * arithmetic for a leaf and a bottom-up sum for a hugging container — so a
 * container crossed over its subtree's choices costs grounding rather than a
 * canvas. A dropped axis is written into the program as a comment: the box is
 * then wrong in the universes that chose otherwise, and a wrong box is a
 * visibly wrong design, so it says so where the generated program is read.
 */
function emitAsked(
	lines: string[],
	scene: Scene,
	node: SceneNode,
	context: ResolveContext,
	measurements: Measurements | undefined,
): void {
	const { axes, dropped } = askedAxes(scene, node, measurements);
	const say = (name: string, size: Size, ...before: Array<string | number>) => {
		lines.push(atom(name, node.id, ...before, "width", Math.round(size.width)));
		lines.push(atom(name, node.id, ...before, "height", Math.round(size.height)));
	};
	if (axes.length === 0) {
		say("lask", naturalSize(node, measurements, context));
		return;
	}
	if (dropped.length > 0) {
		lines.push(
			`% ${node.id}: ${rowCount(axes)} rows, and ${dropped.join(", ")} read at` +
				" its first alternative — over the measurement budget.",
		);
	}
	const rows = rowCount(axes);
	for (let row = 0; row < rows; row++) {
		const picks = rowPicks(axes, row);
		say("lrow", naturalSize(node, measurements, { ...context, picks }), row);
		for (const axis of axes) {
			lines.push(atom("lrowif", node.id, row, axis.variable, picks[axis.variable]));
		}
	}
	// What it asks for when no row applies at all — see ASKED_RULES.
	say("laskdef", naturalSize(node, measurements, context));
}

export function compile(
	scene: Scene,
	options: CompileOptions = {},
): CompileResult {
	const literals = new LiteralTable();
	const variables: Record<string, number> = {};
	const valueLines: string[] = [];
	const used = new Set<Derivation>();

	/** Emits the alternatives of one variable. */
	function emitValue(variable: string, terms: readonly Term[]): void {
		if (terms.length === 0) return;
		variables[variable] = terms.length;
		terms.forEach((term, index) => {
			valueLines.push(atom("alt", variable, index));
			if (term.kind === "literal") {
				valueLines.push(
					atom("alt_literal", variable, index, literals.id(term.value)),
				);
			} else if (term.kind === "token") {
				valueLines.push(atom("alt_token", variable, index, term.token));
			} else {
				used.add(term.via);
				valueLines.push(
					atom("alt_derived", variable, index, term.via, term.from),
				);
			}
		});
	}

	const tokenLines: string[] = [];
	for (const token of scene.tokens) {
		tokenLines.push(atom("token", token.id, token.type));
		tokenLines.push(atom("token_name", token.id, quote(token.name)));
		emitValue(tokenVar(token.id), token.value);
	}

	/**
	 * Styles: the one variable whose alternatives are whole records.
	 *
	 * A style with no variants emits nothing at all rather than a variable the
	 * choice rule would demand a pick for and find none of — which is the one
	 * degenerate shape that is not merely uninteresting but unsatisfiable.
	 */
	const styleLines: string[] = [];
	for (const style of scene.styles ?? []) {
		if (style.variants.length === 0) continue;
		styleLines.push(atom("style", style.id));
		styleLines.push(atom("style_name", style.id, quote(style.name)));
		// Not `emitValue`: the alternatives are records, not terms, so there is
		// no `alt_literal` to write beside them and `resolved(sty(S),_)` is
		// never derived. That is the whole of how a style differs from every
		// other variable, and nothing reads it — what the pick decides is read
		// through `sty_lit/4`. Recorded in `variables` all the same, so it is a
		// `docvar` and not mistaken for a choice a rule minted.
		variables[styleVar(style.id)] = style.variants.length;
		style.variants.forEach((variant, index) => {
			styleLines.push(atom("alt", styleVar(style.id), index));
			for (const prop of STYLE_PROPS) {
				const term = variant.parts[prop];
				if (term === undefined) continue;
				// A bare literal is a fact, a link is a variable — the same trade
				// a frame dimension makes, for the same reason. A part holds one
				// alternative either way, so nobody ever picks between them; the
				// variable exists only so that `resolved/2` will follow a token
				// reference or compute a derivation for it.
				if (term.kind === "literal") {
					styleLines.push(
						atom("sty_lit", style.id, index, prop, literals.id(term.value)),
					);
					continue;
				}
				emitValue(stylePartVar(style.id, index, prop), [term]);
			}
		});
	}
	/**
	 * Which properties each wearer actually takes from its style.
	 *
	 * Per node per property, not per node: precedence is resolved here rather
	 * than in the program, so a node wearing a heading style but with its own
	 * colour is simply absent from the `ink` row. See {@link wornProps}.
	 */
	const wearLines: string[] = [];

	const nodeLines: string[] = [];
	// Facts describing every automatic layout. The rules that interpret them
	// are generic, so a document never changes the shape of the program.
	const layoutLines: string[] = [];
	let laidOut = false;
	/**
	 * What a hugging container comes to has to be worked out on this side —
	 * a maximum over its children is not a linear constraint — and that
	 * arithmetic reads values rather than numbers, so it needs the tokens.
	 *
	 * No picks, because this is the context for the *one-row* case, where there
	 * is nothing to pick between. Where a node's size does depend on a pick,
	 * `emitAsked` supplies one context per row and the arithmetic is exact in
	 * each — which is how a varying gap stopped being read at its first
	 * alternative.
	 */
	const measureContext = { tokens: scene.tokens, picks: {} };
	/**
	 * A node's asked size, once. A nested container is both a container and its
	 * parent's child, so it is reached twice; a table is many lines, and stating
	 * the same one twice would double it for nothing.
	 */
	const askedFor = new Set<string>();
	const asked = (node: SceneNode): void => {
		if (askedFor.has(node.id)) return;
		askedFor.add(node.id);
		emitAsked(layoutLines, scene, node, measureContext, options.measurements);
	};
	// One pass for every parent, rather than a tree search per node.
	const parents = parentMap(scene.nodes);
	/**
	 * Where each node sits among its siblings, 1-based.
	 *
	 * `child/2` is a set, and a set has no paint order — so a reader working
	 * from the answer set alone would have to guess which of two overlapping
	 * rectangles is on top. One fact per node is what makes the ASP description
	 * of the picture complete rather than nearly complete.
	 */
	const order = new Map<string, number>();
	const rank = (list: readonly SceneNode[]): void => {
		list.forEach((node, index) => {
			order.set(node.id, index + 1);
			if (node.children) rank(node.children);
		});
	};
	rank(scene.nodes);
	for (const node of flatten(scene.nodes)) {
		nodeLines.push(atom("node", node.id));
		nodeLines.push(atom("kind", node.id, node.kind));
		nodeLines.push(atom("order", node.id, order.get(node.id) ?? 1));
		// Geometry, as a fact where the document holds one number and as a
		// variable where it holds a choice.
		//
		// Both reach the same `frame/3`, so no rule and no reader ever learns
		// which it was. The split is a cost decision and only that: a variable
		// costs a `pick`, a projected `f_value` and a grounding of every
		// dependent theory constraint per alternative, and paying that for the
		// four dimensions of every rectangle in a document — none of which
		// anyone asked to vary — would multiply the program for nothing.
		for (const dim of DIMENSIONS) {
			const value = node.frame[dim];
			if (value.length === 1 && value[0].kind === "literal") {
				nodeLines.push(atom("frame", node.id, dim, frameDim(node, dim)));
				continue;
			}
			emitValue(frameVar(node.id, dim), value);
		}
		const parent = parents.get(node.id);
		if (parent) nodeLines.push(atom("child", parent.id, node.id));

		if (isLaidOut(node)) {
			laidOut = true;
			// Every setting goes in as a variable, not a fact — the same
			// machinery a fill uses, so a direction or a gap can hold two
			// alternatives or name a token, and `layout/2` and friends are then
			// derived per universe. See LAYOUT_RULES.
			for (const prop of CONTAINER_PROPS) {
				emitValue(layoutVar(node.id, prop), layoutValueOf(node, prop) ?? []);
			}
			// The size the container asks for. Ignored when it hugs, and the
			// stored frame is then only what it falls back to.
			asked(node);
			(node.children ?? []).forEach((child, index) => {
				layoutLines.push(atom("lslot", node.id, child.id, index + 1));
				// What the child would like to be, when it is not stretched — its
				// content's size for a node that sizes itself, its frame otherwise,
				// and for a hugging container of its own, whatever it hugs to.
				asked(child);
				for (const prop of CHILD_PROPS) {
					const value = layoutValueOf(child, prop);
					if (value) emitValue(layoutVar(child.id, prop), value);
				}
			});
		}
		for (const [prop, value] of Object.entries(node.props)) {
			if (value) emitValue(propVar(node.id, prop), value);
		}
		// After the node's own properties, which is also the order the argument
		// runs in: what the style contributes is what is left over.
		if (node.style !== undefined) {
			for (const prop of wornProps(scene, node)) {
				wearLines.push(atom("sty_wears", node.id, node.style, prop));
			}
		}
	}

	/**
	 * Components: which subtrees are definitions, and which nodes use them.
	 *
	 * Facts only — the rules that interpret them are generic, so a document with
	 * a component in it is the same *program* as one without, with more data.
	 * An instance naming a definition the document no longer holds emits
	 * nothing, which leaves an empty box on the canvas rather than a program
	 * that will not ground.
	 */
	const componentLines: string[] = [];
	const definitions = new Set<string>();
	for (const def of componentDefs(scene)) {
		definitions.add(def.root.id);
		componentLines.push(atom("component", def.root.id));
		for (const part of def.parts) {
			componentLines.push(atom("cpart", def.root.id, part.id));
			if (part.id !== def.root.id) {
				componentLines.push(atom("cinner", def.root.id, part.id));
			}
		}
	}
	for (const node of instanceNodes(scene)) {
		if (node.instanceOf === undefined) continue;
		if (!definitions.has(node.instanceOf)) continue;
		componentLines.push(atom("instance", node.id, node.instanceOf));
	}

	// Constraints are facts; the rules that interpret them are generic, so a
	// document never changes the *shape* of the program, only its data.
	const constraintLines: string[] = [];
	const guards: string[] = [];
	let geometric = false;
	/** Priority levels the soft rules use, so a cost vector can be read back. */
	const levels = new Set<number>();
	let grouped = false;
	for (const c of scene.constraints ?? []) {
		const spec = CONSTRAINT_KINDS[c.kind];
		// A group only means anything to a kind that reads its members as a set.
		const group = c.group !== undefined && rangesOverGroup(c.kind) ? c.group : undefined;
		if (!c.enabled) continue;
		// How many members a group has is the rule's business, not the document's,
		// so only a listed constraint can be too small to say anything.
		if (group === undefined && c.nodes.length < spec.minNodes) continue;
		if (group !== undefined) grouped = true;
		constraintLines.push(atom("constraint", c.id));
		constraintLines.push(atom("c_kind", c.id, c.kind));
		// A group is the members, so it replaces them rather than adding to them:
		// `c_node/2` is then *derived* from `member/2` by the generic rule below,
		// which is what lets one constraint cover nine cells it never named.
		if (group) constraintLines.push(atom("c_group", c.id, group));
		// A geometric kind — or a custom one, which has no members to compare —
		// carries a property in the document only so that turning it back into a
		// colour rule remembers one; the program has no use for it.
		if (constrainsProp(c.kind)) {
			constraintLines.push(atom("c_prop", c.id, c.prop));
		}
		if (spec.counted) {
			constraintLines.push(atom("c_limit", c.id, Math.max(1, c.limit ?? 1)));
		}
		// Soft or hard is one fact, not two kinds. A hard rule emits nothing here
		// and the guard below reads its absence, so every document written before
		// preference existed compiles to exactly the program it did before.
		const level = levelOf(c.strength);
		if (level !== undefined) {
			levels.add(level);
			constraintLines.push(atom("c_level", c.id, level));
			constraintLines.push(atom("c_weight", c.id, weightOf(c)));
		}
		if (spec.geometric) {
			geometric = true;
			constraintLines.push(atom("c_edge", c.id, c.edge ?? spec.edges[0]));
			// The dimension goes in as a variable, not a fact — the same
			// machinery a fill uses, so it can name a token and vary with it.
			if (spec.valueType) {
				emitValue(constraintVar(c.id), c.value ?? dimension(0));
			}
		}
		// Order matters to the kinds that read one member differently from
		// another — which side of a gap, which node is the mirror. A group has no
		// order to write down, and the kinds that could read one cannot take a
		// group at all.
		if (group === undefined) {
			c.nodes.forEach((node, index) => {
				constraintLines.push(atom("c_node", c.id, node));
				constraintLines.push(atom("c_slot", c.id, node, index + 1));
			});
		}
		guards.push(guardAtom(c.id));
	}

	/**
	 * A derivation becomes a lookup table over the literals actually in the
	 * document: `derived_of(contrast, l3, l0)`. Computing it here rather than in
	 * ASP keeps arithmetic out of the program while still letting a rule follow
	 * it per universe.
	 */
	const derivedLines: string[] = [];
	for (const via of used) {
		const spec = DERIVATIONS[via];
		for (const source of literals.texts()) {
			const result = spec.of(source);
			if (result === undefined) continue;
			derivedLines.push(
				atom("derived_of", via, literals.id(source), literals.id(result)),
			);
		}
	}

	/**
	 * What each literal reads as, where it reads as a number at all.
	 *
	 * The bridge between the value system, which is all strings, and the
	 * geometry, which is all arithmetic: `"24px"` is text to a fill and 24 to a
	 * gap. Emitted for every literal rather than only the ones a dimension uses,
	 * because which literal a dimension resolves to is the solver's answer, not
	 * something known here.
	 */
	const numeralLines: string[] = [];
	for (const text of literals.texts()) {
		const n = numeralOf(text);
		if (n !== undefined) {
			numeralLines.push(atom("numeral", literals.id(text), Math.round(n)));
		}
		// The same bridge for the words: a layout is described in `row` and
		// `hug`, and a rule can only read one of those as a constant.
		const word = wordOf(text);
		if (word !== undefined) {
			numeralLines.push(atom("word", literals.id(text), word));
		}
	}

	const generated = [
		section("tokens", tokenLines),
		section("scene", nodeLines),
		section("values", [...literals.facts(), ...valueLines, ...numeralLines]),
		section("choices", [
			"var(V) :- alt(V,_).",
			"1 { pick(V,I) : alt(V,I) } 1 :- var(V).",
			"% Which variables the *document* named. alt/2 is derivable, so a rule",
			"% can mint a variable of its own — `alt(prop(cell(R,C),text),D)` is 81",
			"% pencil-mark cells — and it then picks, resolves, renders and pins",
			"% exactly like a property row. The editor needs to know its",
			"% alternatives to offer them, and it cannot read them off a document",
			"% that does not hold them; see dvar/1 and dalt/3 in the output.",
			...Object.keys(variables).map((key) => atom("docvar", key)),
			"% Follow token links to a final literal. A dangling or cyclic",
			"% reference simply derives nothing, so the renderer falls back.",
			"resolved(V,L) :- pick(V,I), alt_literal(V,I,L).",
			"resolved(V,L) :- pick(V,I), alt_token(V,I,T), resolved(tok(T),L).",
			"% A derived alternative is computed from whatever its source resolved",
			"% to *in this universe*, so it follows the source everywhere it varies.",
			"#defined derived_of/3.",
			"resolved(V,L) :- pick(V,I), alt_derived(V,I,Via,S), resolved(S,Src),",
			"                 derived_of(Via,Src,L).",
			"% What a node actually draws with — the only thing an onlooker sees.",
			"rendered(N,P,L) :- resolved(prop(N,P),L).",
		]),
		section("styles", [...styleLines, ...wearLines]),
		// Always emitted, like the geometry and component rules: a hand-written
		// rule may dress nodes it brought into being. After the choice rules,
		// which is where `resolved/2` is said.
		section("style rules", STYLE_RULES),
		section("derivations", derivedLines),
		section("layout", laidOut ? [...LAYOUT_OPTIONS, ...layoutLines] : layoutLines),
		laidOut ? section("layout rules", LAYOUT_RULES) : "",
		// Always emitted, unlike the layout rules: `gsolved(N)` is something a
		// hand-written rule may assert, and a contract that quietly does nothing
		// on some documents is not one.
		section("geometry rules", [
			...GEOMETRIC_KINDS,
			...EDGE_FACTS,
			...GEOMETRY_RULES,
			...FREEDOM_RULES,
		]),
		section("components", componentLines),
		// Always emitted, like the geometry rules and for the same reason:
		// `instance/2` is something a hand-written rule may assert — a row of
		// twelve instances is one rule — and a contract that quietly does nothing
		// on some documents is not one. With no facts, none of it grounds.
		//
		// After the geometry rules, which is where `gspan` is said.
		section("component rules", COMPONENT_RULES),
		// After the component rules, so a node an instance derived defaults the
		// same way a node a hand-written rule derived does.
		section("scene defaults", SCENE_DEFAULT_RULES),
		section("constraints", constraintLines),
		constraintLines.length === 0
			? ""
			: section("constraint rules", [
					"% Each constraint is compiled behind its own switch. Every switch is",
					"% assumed true when solving, so an unsatisfiable answer comes back",
					"% with a *core*: the smallest set of them that cannot hold together.",
					"{ active(C) } :- constraint(C).",
					"% Hard or soft is one fact about the rule, so this is one guard with",
					"% one exception rather than two families of kind. A rule with no",
					"% c_level/2 is a prohibition, which is what every rule was.",
					"#defined c_level/2.",
					"#defined c_weight/2.",
					"c_soft(C) :- c_level(C,_).",
					":- viol(C), active(C), not c_soft(C).",
					...(levels.size === 0
						? []
						: [
								"% ---- preference ----",
								"% The same viol/1 the hard rules derive, ranked instead of",
								"% forbidden. One weak constraint covers every soft rule at every",
								"% tier because the weight and the level are *terms*: the document",
								"% changes the facts, never the shape of the program.",
								"%",
								"% The tuple ends in C so two rules violated at the same tier cost",
								"% their weights separately rather than collapsing into one.",
								":~ viol(C), active(C), c_level(C,L), c_weight(C,W). [W@L,C]",
							]),
					// The rules below are generic while the facts are per-document,
					// so a document with no `atMost` emits no c_limit/2 and one whose
					// every rule is geometric or custom emits no c_prop/2. Declared
					// rather than left absent because clingo remarks on a body atom
					// no rule heads — correctly, and it is now surfaced in the panel,
					// where "c_limit(C,K) does not occur" is noise about a predicate
					// the reader never wrote.
					"#defined c_prop/2.",
					"#defined c_limit/2.",
					...(grouped
						? [
								"",
								"% ---- members a rule named rather than the document ----",
								"% A group is a set the document points at instead of listing:",
								"% one constraint, nine members it never enumerated, and still",
								"% one switch the core can name. Everything below reads c_node/2",
								"% and so does not care which way the members arrived.",
								"#defined c_group/2.",
								"#defined member/2.",
								"c_node(C,N) :- c_group(C,G), member(G,N).",
							]
						: []),
					"",
					"% ---- a rule the user wrote ----",
					"% A `custom` constraint derives no viol/1 of its own: the rule in the",
					"% Rules panel is the violation condition, written against its id —",
					"% `viol(no_wide_gaps) :- ...`. So there is nothing to emit here, and",
					"% that is the point: the switch above and the core below are what the",
					"% kind is for, and a bare `:- ...` in the panel has neither.",
					"%",
					"% One consequence worth knowing: a viol/1 whose term is not a",
					"% constraint in the document — a renamed rule, a typo — is simply",
					"% never guarded, so it does nothing at all rather than failing.",
					"%",
					"% The choice rule above is also readable from a body, and that is",
					"% not the same question as truth. A constraint that is switched off",
					"% emits no constraint/1 fact, so `active(C)` cannot be derived and",
					"% a rule whose body asks for it never grounds — which is how a",
					"% requirement you are not using costs nothing. See the map template.",
					"",
					"% ---- over a property ----",
					"viol(C) :- c_kind(C,differ), c_prop(C,P), c_node(C,A), c_node(C,B), A<B,",
					"           rendered(A,P,L), rendered(B,P,L).",
					"viol(C) :- c_kind(C,match), c_prop(C,P), c_node(C,A), c_node(C,B),",
					"           rendered(A,P,LA), rendered(B,P,LB), LA != LB.",
					"c_used(C,L) :- c_kind(C,atMost), c_prop(C,P), c_node(C,A), rendered(A,P,L).",
					"viol(C) :- c_kind(C,atMost), c_limit(C,K), #count{ L : c_used(C,L) } > K.",
					// A geometric kind has no `viol`: a linear relation is either
					// stated or it is not, and the simplex solver is what finds the
					// contradiction. Only asserted when one is actually in the
					// document — the rules below would otherwise ground `ge` terms
					// for nothing.
					...(geometric ? ["", "% ---- over geometry ----", ...GEOMETRIC_CONSTRAINT_RULES] : []),
				]),
		section("visibility", [
			"#defined hidden/1.",
			"visible(N) :- node(N), not hidden(N).",
		]),
		section("output", [
			"#show pick/2.",
			"#show visible/1.",
			"% The picture itself, so an answer set *is* a drawable scene rather",
			"% than a set of decisions someone else has to apply to the document.",
			"% All of it, including the parts that are plain facts today: what makes",
			"% this worth paying for is that a rule can change any of them, and a",
			"% reader that took the tree from the TypeScript document would then be",
			"% reading a different design from the one the solver answered with.",
			"% Measured on `card`: 45 atoms a model becomes 176, 18 KB crossing the",
			"% worker boundary becomes 67 KB, and an exploration goes 20ms -> 34ms.",
			"%",
			"% All of it behind one switch, because most solves do not want a picture:",
			"% an exploration of `buttons` fires 116 solves and reads 24 pictures. A",
			"% solve that assumes `scenery` false gets exactly the atoms this program",
			"% showed before the scene went in. See SCENERY_ATOM, and `#hydrate` in",
			"% explore.ts for who turns it back on.",
			"{ scenery }.",
			"#defined node/1.",
			"#defined kind/2.",
			"#defined order/2.",
			"#defined literal/2.",
			"#defined child/2.",
			"#defined frame/3.",
			"#defined rendered/3.",
			"#show node(N) : node(N), scenery.",
			"#show kind(N,K) : kind(N,K), scenery.",
			"#show order(N,I) : order(N,I), scenery.",
			"#show child(P,C) : child(P,C), scenery.",
			"#show frame(N,D,V) : frame(N,D,V), scenery.",
			"% Literal ids rather than the text, with the table alongside. Inlining",
			"% the text instead is within a tenth either way — cheaper on a document",
			"% with many distinct literals, dearer on a wide one that repeats a few —",
			"% and ids are what makes \"these two share a colour\" a comparison rather",
			"% than a string match.",
			"#show rendered(N,P,L) : rendered(N,P,L), scenery.",
			"#show literal(I,T) : literal(I,T), scenery.",
			"% Variables a rule minted, and what they may say. A document variable's",
			"% alternatives are already in the document, so only the others are worth",
			"% the bytes: on a document with no such rule these two show nothing at",
			"% all, and on the sudoku they are ~540 atoms that turn 51 derived cells",
			"% into 51 pencil-mark rows the inspector can dim and pin.",
			"#defined docvar/1.",
			"dvar(V) :- var(V), not docvar(V).",
			"dalt(V,I,L) :- dvar(V), alt_literal(V,I,L).",
			"% An alternative that *links* rather than states, reported as what it",
			"% comes to in this universe. Three rules where one would do, because a",
			"% row that showed only the literal alternatives showed an incomplete",
			"% list and said nothing about it: a component instance whose definition",
			"% links a fill to a token is the ordinary case, and its property row had",
			"% one alternative in it where the space has two. `pick/2` is deliberately",
			"% absent from all three — the question is what the alternatives *are*,",
			"% not which one this design took, and the answer follows the token or the",
			"% source wherever it varies exactly as `resolved/2` does.",
			"dalt(V,I,L) :- dvar(V), alt_token(V,I,T), resolved(tok(T),L).",
			"dalt(V,I,L) :- dvar(V), alt_derived(V,I,Via,S), resolved(S,Src),",
			"               derived_of(Via,Src,L).",
			"#show dvar(V) : dvar(V), scenery.",
			"#show dalt(V,I,L) : dalt(V,I,L), scenery.",
			"% Sets a rule named, so a constraint can be pointed at one without the",
			"% document enumerating what is in it — and so the Rules panel can offer",
			"% the groups that actually exist rather than asking for an ASP term.",
			"#defined group/1.",
			"#defined member/2.",
			"#show group(G) : group(G), scenery.",
			"#show member(G,N) : member(G,N), scenery.",
			"% Which rules this design breaks. Only a soft one can be here — a hard",
			"% rule that is on and violated is not a design at all — so this is how",
			"% \"legal but disappointing\" stops being a number and becomes a name.",
			"% Behind active/1 as well as scenery, because a switch that is off has",
			"% no opinion: viol/1 is derived from the document's facts either way,",
			"% and blaming a rule nobody turned on would be a lie.",
			"#defined viol/1.",
			"#defined active/1.",
			"#show viol(C) : viol(C), active(C), scenery.",
			"% Projection is on what is *rendered*, not on which alternative was",
			"% picked. Two ways to spell the same colour are one design, and a",
			"% token nothing references does not create designs at all.",
			"#project rendered/3.",
			"#project visible/1.",
			"% Geometry is not in that list and cannot be: coordinates are theory",
			"% variables, not atoms, so no answer set differs by them. Projecting",
			"% the *dimensions the document names* instead is what makes a token",
			"% with three lengths show as three designs, while the arbitrarily many",
			"% points simplex could return for one layout stay one design — which",
			"% is the right side of that trade, because a difference nobody asked",
			"% for is not a design decision.",
			"#defined c_value/2.",
			"#project c_value/2.",
			"% A layout's settings for the same reason, and it is the sharper case:",
			"% a row and a column differ in nothing *but* geometry, so without this",
			"% the two collapse into one universe and the multiverse shows a single",
			"% arrangement for a document that plainly holds two.",
			"#defined l_value/3.",
			"#project l_value/3.",
			"% And a node's own four dimensions, which is the same case again and the",
			"% one a designer meets first: a card at one position on a wide screen and",
			"% another on a narrow one differs in nothing but geometry, so without this",
			"% the two collapse into a single universe. Only the dimensions a document",
			"% wrote a *choice* for produce any instances at all, so a document nobody",
			"% has asked to vary pays nothing here.",
			"#defined f_value/3.",
			"#project f_value/3.",
		]),
	]
		.filter(Boolean)
		.join("\n");

	const prefix = `${generated}\n% ---- user rules ----\n`;
	const program = `${prefix}${scene.rules}\n`;
	return {
		program,
		generated,
		userRulesLine: prefix.split("\n").length,
		variables,
		guards,
		levels: [...levels].sort((a, b) => b - a),
	};
}

/** Every variable in the document, and how many alternatives it holds. */
export function variableCounts(scene: Scene): Record<string, number> {
	const out: Record<string, number> = {};
	for (const token of scene.tokens) {
		if (token.value.length > 0) out[tokenVar(token.id)] = token.value.length;
	}
	// A style's variants, and only those. Its *parts* are variables in the
	// program too, but each holds exactly one alternative — a variable nobody can
	// pick between is not a variable anyone should be shown, which is the same
	// line a single-literal frame dimension is on.
	for (const style of scene.styles ?? []) {
		if (style.variants.length > 0) {
			out[styleVar(style.id)] = style.variants.length;
		}
	}
	for (const node of flatten(scene.nodes)) {
		for (const [prop, value] of Object.entries(node.props)) {
			if (value && value.length > 0) out[propVar(node.id, prop)] = value.length;
		}
		// Only where the document wrote a choice, matching what `compile` emits:
		// a lone literal is a fact there, and a variable nobody can pick between
		// is not a variable anyone should be shown.
		for (const dim of DIMENSIONS) {
			const value = node.frame[dim];
			if (value.length === 1 && value[0].kind === "literal") continue;
			if (value.length > 0) out[frameVar(node.id, dim)] = value.length;
		}
		// A layout's settings only branch anything while the layout is on and
		// has something to arrange, so an abandoned one is not a variable.
		if (isLaidOut(node)) {
			for (const prop of CONTAINER_PROPS) {
				const value = layoutValueOf(node, prop);
				if (value && value.length > 0) {
					out[layoutVar(node.id, prop)] = value.length;
				}
			}
			for (const child of node.children ?? []) {
				for (const prop of CHILD_PROPS) {
					const value = layoutValueOf(child, prop);
					if (value && value.length > 0) {
						out[layoutVar(child.id, prop)] = value.length;
					}
				}
			}
		}
	}
	for (const c of scene.constraints ?? []) {
		const value = c.value;
		if (CONSTRAINT_KINDS[c.kind].valueType && value && value.length > 0) {
			out[constraintVar(c.id)] = value.length;
		}
	}
	return out;
}

/** Variables that actually branch, for the "what varies" annotations. */
export function varyingVariables(scene: Scene): string[] {
	return Object.entries(variableCounts(scene))
		.filter(([, count]) => count > 1)
		.map(([variable]) => variable);
}

/**
 * Variables the document holds that no design consults — so the solver's answer
 * about them is arithmetic rather than news.
 *
 * **Projection makes an unconsulted variable look ruled out.** The program
 * projects on what a design *renders*, which is the whole reason two spellings
 * of one colour are one universe. A variable nothing reads changes nothing that
 * is projected, so every universe that differs only in its pick collapses into
 * one, and brave consequences come back naming exactly one reachable
 * alternative. An inspector row that greys the rest is then making a claim
 * nothing supports: no rule forbade them, nothing asked.
 *
 * Two things in a document can be held without being consulted, and they are
 * the two the document declares centrally rather than on a node:
 *
 *   - a **token** nothing links to. Transitively: a token referenced only from
 *     an unworn style, or only from a switched-off rule, is not read either.
 *   - a **style** nothing wears. Precisely: nothing takes any of its properties
 *     *from* it, which is not the same as nothing naming it — a node that
 *     wears a style and then states every property the style mentions decides
 *     the lot itself, and the style is left deciding nothing. `wornProps` is the
 *     same precedence the compiler applies.
 *
 * Everything else is consulted by construction. A node's properties and frame
 * reach `rendered/3` and `frame/3`, which is what a design *is*; and the
 * compiler already declines to emit a variable for a layout nobody arranges or
 * for a constraint with too few members to say anything, so those never reach a
 * panel to be greyed in the first place — measured, not assumed.
 *
 * Over-reporting is the dangerous direction: calling a variable unread when
 * something reads it hides a real ban. So every uncertain case counts as read —
 * a mention anywhere in the user's rules included, since a hand-written rule may
 * consult `tok(accent)` or `sty_wears(N,body,size)` and nothing here can know
 * what for.
 */
export function unreadVariables(scene: Scene): Set<string> {
	const out = new Set<string>();
	/** Ids the user's own rules name, which is enough to count as read. */
	const named = (id: string): boolean =>
		new RegExp(`(^|[^0-9A-Z_a-z])${id}([^0-9A-Z_a-z]|$)`).test(scene.rules ?? "");

	// Which styles decide something, and the values every reader holds. One walk:
	// a token is read when a read value references it, and the styles are exactly
	// the readers whose own readership is in question.
	const worn = new Set<string>();
	const read: Array<Value | undefined> = [];
	for (const node of flatten(scene.nodes)) {
		if (node.style !== undefined && wornProps(scene, node).length > 0) {
			worn.add(node.style);
		}
		read.push(...Object.values(node.props), ...DIMENSIONS.map((d) => node.frame[d]));
		if (isLaidOut(node)) {
			read.push(...CONTAINER_PROPS.map((p) => layoutValueOf(node, p)));
			for (const child of node.children ?? []) {
				read.push(...CHILD_PROPS.map((p) => layoutValueOf(child, p)));
			}
		}
	}
	// A switched-off constraint is out of the program, so what it links to is not
	// read *through it* — the same reading the compiler applies by not emitting it.
	for (const c of scene.constraints ?? []) {
		if (c.enabled) read.push(c.value);
	}
	for (const style of scene.styles ?? []) {
		if (!worn.has(style.id) && !named(style.id)) {
			out.add(styleVar(style.id));
			continue;
		}
		for (const variant of style.variants) {
			read.push(...Object.values(variant.parts).map((term) => term && [term]));
		}
	}
	// Transitive by construction: `referencedTokens` walks through the value of
	// every token it reaches, so a token read only by another read token is read.
	const seen = new Set<string>();
	for (const value of read) referencedTokens(scene.tokens, value, seen);
	for (const token of scene.tokens) {
		if (!seen.has(token.id) && !named(token.id)) out.add(tokenVar(token.id));
	}
	return out;
}

/**
 * Brave consequences with the unconsulted variables taken out, so a panel can
 * read `reach[variable] === undefined` as "the answer says nothing about this"
 * and never as "everything but one is impossible".
 *
 * Here rather than in each panel because it was in one panel — `Styles` gated on
 * having wearers and the rest did not, so an unreferenced token greyed its own
 * alternatives and blamed a rule for it. One question, one answer, six rows that
 * ask it.
 */
export function reachableAlternatives(
	scene: Scene,
	brave: Readonly<Record<string, Set<number>>> | undefined,
): Readonly<Record<string, Set<number>>> | undefined {
	if (!brave) return undefined;
	const unread = unreadVariables(scene);
	if (unread.size === 0) return brave;
	return Object.fromEntries(
		Object.entries(brave).filter(([variable]) => !unread.has(variable)),
	);
}
