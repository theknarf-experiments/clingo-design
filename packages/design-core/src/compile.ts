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
 * Geometry goes in as plain facts. Four atoms per node costs nothing; a
 * choosable coordinate would ground a domain of thousands. Where a coordinate
 * genuinely has to be worked out it is not a choice either — it is a variable
 * of the simplex solver, which costs one unknown rather than a domain.
 */
import { type Measurements, naturalSize } from "./measure.ts";
import {
	type AutoLayout,
	CONSTRAINT_KINDS,
	NODE_KINDS,
	type Scene,
	isLaidOut,
} from "./scene.ts";
import {
	DERIVATIONS,
	type Derivation,
	type Term,
	propVar,
	tokenVar,
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
 * The layout system, as rules over the facts a laid-out container emits.
 *
 * Written once and generically: `main`/`cross` swap the axes so a column is
 * the same equations as a row, and the conditional sum is the flexbox
 * identity — children plus gaps plus padding fill the container exactly.
 */
const LAYOUT_RULES = [
	"#defined layout/2.",
	"#defined lslot/3.",
	"#defined lgrow/1.",
	"#defined lhug/1.",
	"#defined lalignself/2.",
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
	"#show lv/2.",
	"#show lsz/2.",
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
	"gdisp(N,A) :- gpos(N,A).",
	"gdisp(N,S) :- gsize(N,S).",
	"&sum{ lv(N,A); -gd(N,A) } <= V :- gpos(N,A), frame(N,A,V).",
	"&sum{ lv(N,A); gd(N,A) } >= V :- gpos(N,A), frame(N,A,V).",
	"&sum{ lsz(N,S); -gd(N,S) } <= V :- gsize(N,S), frame(N,S,V).",
	"&sum{ lsz(N,S); gd(N,S) } >= V :- gsize(N,S), frame(N,S,V).",
	"&minimize{ gd(N,A) : gdisp(N,A) }.",
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
]

/**
 * Which constraint kinds place their nodes. Read off the one table that says
 * what a kind is, so a geometric kind never needs a case here.
 */
const GEOMETRIC_KINDS = Object.entries(CONSTRAINT_KINDS)
	.filter(([, spec]) => spec.geometric)
	.map(([kind]) => `gkind(${kind}).`)

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
%   viol(C)                     constraint C is violated
%   active(C)                   C is switched on (assumed while solving)
%   rendered(Node, Prop, Lit)   what a node actually draws with
%   literal(Lit, "text")        the text a literal id stands for
%
% Variables are named after where they live:
%   prop(Node, Property)        a node's property
%   tok(Token)                  a token's own definition
%
% Scene:
%   node(N)  kind(N, ${NODE_KINDS.join("|")})  child(Parent, Child)
%   frame(N, x|y|width|height, Pixels)   <- relative to the parent, if any
%   hidden(N)                   assert to remove a node
%   visible(N)                  derived: node(N), not hidden(N)
%
% Geometry the solver decides, rather than the document:
%
%   gsolved(N)                  assert to hand N's frame to the solver
%   lv(N, x|y)                  its offset inside its parent
%   lsz(N, width|height)        its size
%   wv(N, x|y)                  where it lands on the canvas
%
% Those three are theory variables, not atoms. A solved node with nothing
% said about it lands exactly on its stored frame; say something, and it
% moves as little as it can to satisfy you.
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
% Examples:
%   :- resolved(prop(card,fill), C), resolved(prop(badge,fill), C).
%   :- frame(A,x,X), frame(B,x,X), child(P,A), child(P,B), A != B.
%   gsolved(badge).  &sum{ wv(badge,x); -wv(card,x) } >= 24.`;

function atom(name: string, ...args: Array<string | number>): string {
	return `${name}(${args.join(",")}).`;
}

function section(title: string, lines: string[]): string {
	if (lines.length === 0) return "";
	return `% ---- ${title} ----\n${lines.join("\n")}\n`;
}

/** ASP string literals need their quotes and backslashes escaped. */
function quote(text: string): string {
	return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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

	const nodeLines: string[] = [];
	// Facts describing every automatic layout. The rules that interpret them
	// are generic, so a document never changes the shape of the program.
	const layoutLines: string[] = [];
	let laidOut = false;
	// One pass for every parent, rather than a tree search per node.
	const parents = parentMap(scene.nodes);
	for (const node of flatten(scene.nodes)) {
		nodeLines.push(atom("node", node.id));
		nodeLines.push(atom("kind", node.id, node.kind));
		nodeLines.push(atom("frame", node.id, "x", Math.round(node.frame.x)));
		nodeLines.push(atom("frame", node.id, "y", Math.round(node.frame.y)));
		nodeLines.push(atom("frame", node.id, "width", Math.round(node.frame.width)));
		nodeLines.push(
			atom("frame", node.id, "height", Math.round(node.frame.height)),
		);
		const parent = parents.get(node.id);
		if (parent) nodeLines.push(atom("child", parent.id, node.id));

		if (isLaidOut(node)) {
			laidOut = true;
			const spec = node.layout as AutoLayout;
			layoutLines.push(atom("layout", node.id, spec.direction));
			layoutLines.push(atom("lgap", node.id, Math.max(0, Math.round(spec.gap))));
			layoutLines.push(atom("lpad", node.id, Math.max(0, Math.round(spec.padding))));
			layoutLines.push(atom("lalign", node.id, spec.align));
			layoutLines.push(atom("ljustify", node.id, spec.justify));
			if (spec.sizing === "hug") layoutLines.push(atom("lhug", node.id));
			// The size the container asks for. Ignored when it hugs, and the
			// stored frame is then only what it falls back to.
			const own = naturalSize(node, options.measurements);
			layoutLines.push(atom("lask", node.id, "width", Math.round(own.width)));
			layoutLines.push(atom("lask", node.id, "height", Math.round(own.height)));
			(node.children ?? []).forEach((child, index) => {
				layoutLines.push(atom("lslot", node.id, child.id, index + 1));
				// What the child would like to be, when it is not stretched — its
				// content's size for a node that sizes itself, its frame otherwise,
				// and for a hugging container of its own, whatever it hugs to.
				const want = naturalSize(child, options.measurements);
				layoutLines.push(atom("lask", child.id, "width", Math.round(want.width)));
				layoutLines.push(
					atom("lask", child.id, "height", Math.round(want.height)),
				);
				if (child.grow) layoutLines.push(atom("lgrow", child.id));
				if (child.alignSelf) {
					layoutLines.push(atom("lalignself", child.id, child.alignSelf));
				}
			});
		}
		for (const [prop, value] of Object.entries(node.props)) {
			if (value) emitValue(propVar(node.id, prop), value);
		}
	}

	// Constraints are facts; the rules that interpret them are generic, so a
	// document never changes the *shape* of the program, only its data.
	const constraintLines: string[] = [];
	const guards: string[] = [];
	for (const c of scene.constraints ?? []) {
		if (!c.enabled || c.nodes.length < CONSTRAINT_KINDS[c.kind].minNodes) continue;
		constraintLines.push(atom("constraint", c.id));
		constraintLines.push(atom("c_kind", c.id, c.kind));
		constraintLines.push(atom("c_prop", c.id, c.prop));
		if (CONSTRAINT_KINDS[c.kind].counted) {
			constraintLines.push(atom("c_limit", c.id, Math.max(1, c.limit ?? 1)));
		}
		for (const node of c.nodes) constraintLines.push(atom("c_node", c.id, node));
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

	const generated = [
		section("tokens", tokenLines),
		section("scene", nodeLines),
		section("values", [...literals.facts(), ...valueLines]),
		section("choices", [
			"var(V) :- alt(V,_).",
			"1 { pick(V,I) : alt(V,I) } 1 :- var(V).",
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
		section("derivations", derivedLines),
		section("layout", layoutLines),
		laidOut ? section("layout rules", LAYOUT_RULES) : "",
		// Always emitted, unlike the layout rules: `gsolved(N)` is something a
		// hand-written rule may assert, and a contract that quietly does nothing
		// on some documents is not one.
		section("geometry rules", [...GEOMETRIC_KINDS, ...GEOMETRY_RULES]),
		section("constraints", constraintLines),
		constraintLines.length === 0
			? ""
			: section("constraint rules", [
					"% Each constraint is compiled behind its own switch. Every switch is",
					"% assumed true when solving, so an unsatisfiable answer comes back",
					"% with a *core*: the smallest set of them that cannot hold together.",
					"{ active(C) } :- constraint(C).",
					":- viol(C), active(C).",
					"",
					"viol(C) :- c_kind(C,differ), c_prop(C,P), c_node(C,A), c_node(C,B), A<B,",
					"           rendered(A,P,L), rendered(B,P,L).",
					"viol(C) :- c_kind(C,match), c_prop(C,P), c_node(C,A), c_node(C,B),",
					"           rendered(A,P,LA), rendered(B,P,LB), LA != LB.",
					"c_used(C,L) :- c_kind(C,atMost), c_prop(C,P), c_node(C,A), rendered(A,P,L).",
					"viol(C) :- c_kind(C,atMost), c_limit(C,K), #count{ L : c_used(C,L) } > K.",
				]),
		section("visibility", [
			"#defined hidden/1.",
			"visible(N) :- node(N), not hidden(N).",
		]),
		section("output", [
			"#show pick/2.",
			"#show visible/1.",
			"% Projection is on what is *rendered*, not on which alternative was",
			"% picked. Two ways to spell the same colour are one design, and a",
			"% token nothing references does not create designs at all.",
			"#project rendered/3.",
			"#project visible/1.",
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
	};
}

/** Every variable in the document, and how many alternatives it holds. */
export function variableCounts(scene: Scene): Record<string, number> {
	const out: Record<string, number> = {};
	for (const token of scene.tokens) {
		if (token.value.length > 0) out[tokenVar(token.id)] = token.value.length;
	}
	for (const node of flatten(scene.nodes)) {
		for (const [prop, value] of Object.entries(node.props)) {
			if (value && value.length > 0) out[propVar(node.id, prop)] = value.length;
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
