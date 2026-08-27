/**
 * Reads a drawable scene back out of one answer set.
 *
 * The generated program has always *described* the picture — `node/1`,
 * `kind/2`, `child/2`, `order/2`, `frame/3`, `rendered/3`, `visible/1` — but
 * only the decisions were shown, so every renderer so far has walked the
 * TypeScript document and applied the picks to it. That works exactly as long
 * as the document and the answer set agree about the picture, which is to say
 * exactly as long as no rule touches the scene predicates. This reader is the
 * other direction: the answer set is the description, and the document is only
 * where it came from.
 *
 * The canvas is what consumes it. It is pure, so it can be tested against the
 * real solver without a canvas anywhere near it — and because it needs the
 * scene predicates to say anything at all, an answer set that was asked for
 * without them reads as an empty document rather than as an error. That is why
 * a solve is only allowed to skip the picture where the result is a
 * {@link Candidate} and not a `Universe`; see explore.ts.
 *
 * A machine's states arrive through the same door, and they are the reason the
 * door is worth having. Every state of every instance is in the *same* answer
 * set — that is the invariant the whole feature turns on, see machines.ts — so
 * what comes back is not one picture but one picture plus every other picture
 * the same document could be showing. {@link ModelScene.states} is that second
 * half, and it is deliberately kept out of {@link ModelScene.byId}: a state copy
 * is not a `node/1`, must never be drawn as one, and the two readers that want
 * it — the export, which turns states into classes, and the studio's playback,
 * which draws one instead of the shown one without solving again — both ask for
 * it by name.
 */
import { parseAtom, unquote } from "./atoms.ts";
import { parseInstancePart } from "./components.ts";
import type { Frame } from "./geometry.ts";
import { parseStatePart, statePart } from "./machines.ts";
import { type Emu, wholeEmu } from "./units.ts";
import {
	KINDS,
	type NodeKind,
	PROP_NAMES,
	PROPS,
	type PropName,
	sharedPropsOfKinds,
} from "./scene.ts";

export interface ModelNode {
	id: string;
	kind: NodeKind;
	/** Where it sits among its siblings, 1-based — the paint order. */
	order: number;
	/**
	 * Relative to the parent, as in the document, with anything the solver
	 * worked out winning over the stored frame. Same precedence as
	 * `placedNodes`, so a consumer can walk this tree the same way.
	 */
	frame: Frame;
	/** What it draws with: final text per property, tokens already followed. */
	rendered: Partial<Record<PropName, string>>;
	children: ModelNode[];
}

/** A node wearing a style the document does not say it wears. */
export interface ModelWearer {
	/** The node id, which may be an instance part — `inst(i,label)`. */
	node: string;
	/** Which of the style's properties it takes from it, in table order. */
	props: PropName[];
}

/** One alternative of a variable a rule minted. */
export interface ModelAlternative {
	/**
	 * The solver's own index for it — what `pick/2` carries and what a pin
	 * assumes. A rule numbers its alternatives however it likes, so this is not
	 * the position in the list.
	 */
	index: number;
	/** What it says, with the literal table already followed. */
	text: string;
}

/**
 * One state copy — instance `I`'s part `N` as state `S` has it — read out of
 * the same answer set as the picture.
 *
 * Where it is and what it draws with, as a {@link ModelNode} carries them, and
 * then everything that would make it drawable is gone. No kind, because the copy
 * has none: what it is is decided by the definition part, which is a node of the
 * picture and already says so. No children, because the copies do not form a
 * tree — they hang off
 * the instance's parts in `child/2` only so that a geometric constraint naming
 * one gets a world chain, and a consumer that wants the shape of a state walks
 * the instance's tree and looks each part up here. No `order`, for the same
 * reason: a state changes what a part looks like, never where it sits among its
 * siblings.
 */
export interface ModelState {
	/** The instance node id. */
	instance: string;
	/** The state id. */
	state: string;
	/** The definition part id — which may itself be a term, for a nested instance. */
	part: string;
	/**
	 * Relative to the parent, as {@link ModelNode.frame} is, with solved geometry
	 * folded in — by the same lines, because it is the same question.
	 */
	frame: Frame;
	/** What it draws with in this state: final text per property, tokens followed. */
	rendered: Partial<Record<PropName, string>>;
	/**
	 * True where this state takes the part out of the picture — `mhidden/3`.
	 *
	 * Per copy and not closed downward, deliberately. Both readers close it
	 * themselves and close it in their own medium: the export writes
	 * `display: none` on the one node and CSS takes the subtree with it, and the
	 * canvas stops walking, exactly as {@link drawn} stops walking for a hidden
	 * node. Closing it here would say the same thing twice and would make "this
	 * state hides this part" — which is what a panel wants to show and what the
	 * document actually said — unaskable.
	 */
	hidden: boolean;
}

/**
 * What one answer set says about one machine.
 *
 * Two different kinds of thing, and they are together because they have the
 * same source and the same audience. The four health lists are the program's
 * own answers to the four questions `machineHealth` answers off the document in
 * machines.ts — deliberately duplicated, because a panel has to be able to say
 * "nothing reaches this state" while the document is unsatisfiable and there is
 * no answer set at all, and a rule has to be able to say it as a `viol/1` that
 * lands in a core with a name. The three motion maps are the other kind: a
 * duration is a *value*, so which milliseconds a transition runs for is a thing
 * this universe decided rather than a thing the document holds, and the export
 * cannot write `transition:` without asking.
 *
 * A machine the answer set says nothing about is absent rather than empty. That
 * is not the same claim as "this machine is healthy": a solve asked for without
 * `scenery` shows none of these, so a reader that wants to *report* health has
 * to have asked for the picture, and one that only wants a number should treat
 * a missing machine as a missing answer.
 */
export interface ModelMachine {
	/** States `mreach/2` does not reach — `munreached/2`. */
	unreachable: string[];
	/** States nothing leaves — `mdeadend/2`. */
	deadEnds: string[];
	/** `[state, trigger]` pairs where one trigger leaves a state twice — `mnondet/3`. */
	nondeterministic: Array<[string, string]>;
	/** Transitions naming a state the machine has not got — `mdangling/2`. */
	dangling: string[];
	/** Transition id -> the milliseconds this universe resolved it to. */
	duration: Record<string, number>;
	delay: Record<string, number>;
	stagger: Record<string, number>;
}

export interface ModelScene {
	/** Top-level nodes, in paint order. */
	roots: ModelNode[];
	/** Every node in the tree, by id. */
	byId: Record<string, ModelNode>;
	/**
	 * Sets a rule named, with their members: `group/1` and `member/2`.
	 *
	 * A constraint can be pointed at one instead of listing ids, which is the
	 * only way to constrain nine nodes a rule brought into being. The editor
	 * offers these where it offers node ids; see {@link Constraint.group}.
	 */
	groups: Record<string, string[]>;
	/**
	 * Variables a rule minted, by key, with their alternatives in index order.
	 *
	 * `alt/2` is derivable, so a document is not the only thing that can create
	 * a choice. The document knows its own variables' alternatives; these are
	 * the ones it cannot know, and without them a derived node's property row
	 * would have nothing to offer, dim or pin.
	 */
	variables: Record<string, ModelAlternative[]>;
	/**
	 * Wearing the answer set knows about and the document does not, by style id —
	 * `sty_derived/3`.
	 *
	 * Two ways to be in here, and the reading is the same for both: an
	 * instance's copy of a definition part that wears a style, and a node a
	 * hand-written rule dressed. Only this half is shown, because the document's
	 * own wearing is already in the document — the same argument as
	 * {@link variables}.
	 *
	 * Read by the export, which cannot otherwise share the class with a wearer
	 * the document never named, and by the studio, which measures text from the
	 * document *before* this solve and so has to admit which boxes it sized in
	 * the wrong font.
	 */
	wears: Record<string, ModelWearer[]>;
	/**
	 * Every state copy, by its whole `stt(I,S,N)` term.
	 *
	 * Not folded into {@link byId}, because a state copy is not a node and must
	 * never be drawn as one: this is the *other* states, sitting beside the
	 * picture rather than in it. Keyed by the term rather than nested
	 * instance-by-state-by-part because that is how every reader arrives — with a
	 * term a rule named, or with one it built from {@link statePart} — and a
	 * three-level map would make the common lookup three lookups and the
	 * uncommon one an impossibility.
	 *
	 * In term order, so that two readings of one answer set are the same reading.
	 */
	states: Record<string, ModelState>;
	/**
	 * Which state each instance is drawn in — `shown/2`, by instance node id.
	 *
	 * This is what makes {@link states} usable as a diff: the shown copy is the
	 * one already folded into {@link byId} through the alias rules, so the export
	 * asks what *changed* by comparing the other copies against this one.
	 *
	 * It is also read *while* {@link byId} is being built, which is the one place
	 * this reader does more than transcribe. The program's alias carries the shown
	 * copy's `frame/3` onto `inst(I,N)` and cannot carry its solved geometry,
	 * because that is a theory answer rather than an atom a rule can restate — so
	 * where a geometric rule placed the shown copy, the drawn part takes the copy's
	 * offset from here. See `solvedView`.
	 */
	shown: Record<string, string>;
	/** What the answer set says about each machine, by machine id. */
	machines: Record<string, ModelMachine>;
}

/**
 * A theory value, as EMU: `"320/3"` is 107.
 *
 * clingo-lpx answers in exact rationals, and it has to — three children sharing
 * a container's leftover space is a third of something, and simplex has no way
 * to say that in integers. Every length in the program is EMU, so what arrives
 * is a *rational number of EMU*, and `320/3` is not one.
 *
 * So this is the one place the solver's answer is quantized, and it is worth
 * being plain about rather than calling it a conversion. It is not that EMU
 * absorbs the rationals — it is that a third of an EMU is a thirty-millionth of
 * an inch, four decimal orders below what any output medium can hold, so the
 * discarded remainder cannot reach a pixel, a printer or an export. Before EMU
 * the same divide threw away a third of a *pixel*, which very much could.
 *
 * {@link wholeEmu} rather than a bare `Math.round`, so this rounding breaks its
 * ties the same way every other rounding in the codebase does — away from zero
 * — and so that the name says a quantization happened.
 */
function emuFromRational(text: string): Emu | undefined {
	const slash = text.indexOf("/");
	const n =
		slash === -1
			? Number(text)
			: Number(text.slice(0, slash)) / Number(text.slice(slash + 1));
	return Number.isFinite(n) ? wholeEmu(n) : undefined;
}

const AXIS = { x: "x", y: "y", width: "width", height: "height" } as const;

/**
 * Pulls `__lpx(lv(n,x),"114300")` and `__lpx(lsz(n,width),"762000")` out of a
 * model, in EMU.
 *
 * Parsed rather than matched, because a node id is no longer always a plain
 * constant: a rule that brings nodes into being names them with terms, and
 * `lv(cell(1,1),x)` has two commas that are not argument separators.
 */
export function readSolved(
	atoms: readonly string[],
): Record<string, Partial<Frame>> {
	const out: Record<string, Partial<Frame>> = {};
	for (const text of atoms) {
		if (!text.startsWith("__lpx(")) continue;
		const outer = parseAtom(text);
		if (!outer || outer.name !== "__lpx" || outer.args.length !== 2) continue;
		const variable = parseAtom(outer.args[0]);
		if (!variable || variable.args.length !== 2) continue;
		if (variable.name !== "lv" && variable.name !== "lsz") continue;
		const axis = AXIS[variable.args[1] as keyof typeof AXIS];
		const value = emuFromRational(unquote(outer.args[1]));
		if (axis === undefined || value === undefined) continue;
		(out[variable.args[0]] ??= {})[axis] = value;
	}
	return out;
}

/** Everything one pass over the atoms picks up, before any of it is a tree. */
interface Facts {
	nodes: Set<string>;
	kind: Map<string, NodeKind>;
	order: Map<string, number>;
	frame: Map<string, Partial<Frame>>;
	parent: Map<string, string>;
	rendered: Map<string, Map<PropName, string>>;
	literal: Map<string, string>;
	visible: Set<string>;
	groups: Map<string, string[]>;
	/** variable key -> solver index -> literal id */
	variables: Map<string, Map<number, string>>;
	/** style id -> node id -> the properties it takes from that style */
	wears: Map<string, Map<string, Set<PropName>>>;
	/** instance id -> the state it is drawn in */
	shown: Map<string, string>;
	/** the `stt(I,S,N)` terms `mhidden/3` takes out of the picture */
	stateHidden: Set<string>;
	/**
	 * machine id -> its health and its motion, filled in as the atoms arrive.
	 *
	 * The result type, mutated in place rather than a parallel one accumulated
	 * and converted: seven predicates land in its seven fields and not one of
	 * them needs anything the interface has not got. Ordering is the only thing
	 * that is not final here, and {@link readModel} sorts it at the end.
	 */
	machines: Map<string, ModelMachine>;
}

/** The record for one machine, minted by whichever of its atoms arrives first. */
function machineFacts(facts: Facts, id: string): ModelMachine {
	let machine = facts.machines.get(id);
	if (!machine) {
		machine = {
			unreachable: [],
			deadEnds: [],
			nondeterministic: [],
			dangling: [],
			duration: {},
			delay: {},
			stagger: {},
		};
		facts.machines.set(id, machine);
	}
	return machine;
}

function collect(atoms: readonly string[]): Facts {
	const facts: Facts = {
		nodes: new Set(),
		kind: new Map(),
		order: new Map(),
		frame: new Map(),
		parent: new Map(),
		rendered: new Map(),
		literal: new Map(),
		visible: new Set(),
		groups: new Map(),
		variables: new Map(),
		wears: new Map(),
		shown: new Map(),
		stateHidden: new Set(),
		machines: new Map(),
	};
	for (const text of atoms) {
		const atom = parseAtom(text);
		if (!atom) continue;
		const [a, b, c] = atom.args;
		switch (`${atom.name}/${atom.args.length}`) {
			case "node/1":
				facts.nodes.add(a);
				break;
			case "kind/2":
				// A kind the table does not know is not drawable by anything here.
				if (b in KINDS) facts.kind.set(a, b as NodeKind);
				break;
			case "order/2": {
				const n = Number(b);
				if (Number.isFinite(n)) facts.order.set(a, n);
				break;
			}
			case "child/2":
				// First parent wins, so a rule that gives a node two of them gets a
				// tree rather than a crash.
				if (!facts.parent.has(b)) facts.parent.set(b, a);
				break;
			case "frame/3": {
				const axis = AXIS[b as keyof typeof AXIS];
				const value = Number(c);
				if (axis === undefined || !Number.isFinite(value)) break;
				let box = facts.frame.get(a);
				if (!box) facts.frame.set(a, (box = {}));
				box[axis] = value;
				break;
			}
			case "rendered/3": {
				if (!(b in PROPS)) break;
				let props = facts.rendered.get(a);
				if (!props) facts.rendered.set(a, (props = new Map()));
				props.set(b as PropName, c);
				break;
			}
			case "literal/2":
				facts.literal.set(a, unquote(b));
				break;
			case "visible/1":
				facts.visible.add(a);
				break;
			case "group/1":
				// A group with no members is still a group: it is offered, and a
				// constraint over it simply says nothing yet.
				if (!facts.groups.has(a)) facts.groups.set(a, []);
				break;
			case "member/2": {
				const members = facts.groups.get(a);
				if (members) members.push(b);
				else facts.groups.set(a, [b]);
				break;
			}
			// A variable no document value named. Its alternatives are worth
			// collecting for exactly one reason: the editor cannot look them up
			// anywhere else.
			case "dvar/1":
				if (!facts.variables.has(a)) facts.variables.set(a, new Map());
				break;
			case "dalt/3": {
				const index = Number(b);
				if (!Number.isFinite(index)) break;
				let alts = facts.variables.get(a);
				if (!alts) facts.variables.set(a, (alts = new Map()));
				alts.set(index, c);
				break;
			}
			// Wearing the document did not state. Keyed by the style, because both
			// readers ask "who wears this one" rather than "what does this node
			// wear" — though a rule may well answer the second with two.
			case "sty_derived/3": {
				if (!(c in PROPS)) break;
				let nodes = facts.wears.get(b);
				if (!nodes) facts.wears.set(b, (nodes = new Map()));
				let props = nodes.get(a);
				if (!props) nodes.set(a, (props = new Set()));
				props.add(c as PropName);
				break;
			}
			// ---- state machines ----
			// A state copy's own frame/3 and rendered/3 need no case of their own:
			// both are already collected for whatever id they name, and
			// `stt(i1,hover,label)` is an id like any other. What is left is the
			// handful of predicates carrying something no other predicate does.
			case "shown/2": {
				// One instance is drawn in one state, and the program says so:
				// `shown/2` is a fact rather than a choice precisely so that states
				// do not multiply universes. A hand-written rule can still assert a
				// second one, which is two pictures on top of each other and which
				// the program reports as `mtwoshown/1` — so this keeps the lower
				// state id rather than whichever atom happened to arrive first, so
				// that reading one answer set twice cannot give two different
				// pictures. `mtwoshown` is how a caller learns it happened; choosing
				// arbitrarily here is how it would not.
				const at = facts.shown.get(a);
				if (at === undefined || b < at) facts.shown.set(a, b);
				break;
			}
			case "mhidden/3":
				// Rebuilt into the term rather than kept as three arguments, because
				// the term is the key everything downstream holds a copy by.
				facts.stateHidden.add(statePart(a, b, c));
				break;
			case "munreached/2":
				machineFacts(facts, a).unreachable.push(b);
				break;
			case "mdeadend/2":
				machineFacts(facts, a).deadEnds.push(b);
				break;
			case "mnondet/3":
				machineFacts(facts, a).nondeterministic.push([b, c]);
				break;
			case "mdangling/2":
				machineFacts(facts, a).dangling.push(b);
				break;
			// The three motion tables. Whole milliseconds by construction — the
			// `millis/2` bridge is exact-or-nothing and the program clamps the two
			// that must not go negative — so a value that is not a number at all
			// came from a hand-written atom, and it is dropped exactly as a
			// non-numeric `order/2` is.
			case "mdur/3":
			case "mdelay/3":
			case "mstagger/3": {
				const ms = Number(c);
				if (!Number.isFinite(ms)) break;
				const field =
					atom.name === "mdur" ? "duration" : atom.name === "mdelay" ? "delay" : "stagger";
				machineFacts(facts, a)[field][b] = ms;
				break;
			}
		}
	}
	return facts;
}

/**
 * What a `rendered/3` or an alternative's third argument actually says.
 *
 * The generated program always names an interned literal, so the id is a
 * constant and the table has it. A hand-written rule may spell the text out
 * instead — `rendered(cell(1,1),fill,"#38bdf8")` — and a quoted term can never
 * be an id, so there is no ambiguity to resolve.
 *
 * `undefined` for a literal id the table has not got: that is a dangling id, not
 * an empty string, and every caller drops it rather than rendering nothing as
 * if it were something.
 */
function textOf(literal: string, facts: Facts): string | undefined {
	return literal.startsWith('"') ? unquote(literal) : facts.literal.get(literal);
}

/**
 * Everything one term draws with, as final text.
 *
 * One function for a node and for a state copy because it is one question: the
 * program says `rendered/3` about both and means the same thing by it, and the
 * only difference between the two is which term is being asked about. A second
 * copy of this loop for states is how the two would drift.
 */
function renderedTexts(id: string, facts: Facts): Partial<Record<PropName, string>> {
	const rendered: Partial<Record<PropName, string>> = {};
	for (const [prop, literal] of facts.rendered.get(id) ?? []) {
		const text = textOf(literal, facts);
		if (text !== undefined) rendered[prop] = text;
	}
	return rendered;
}

/**
 * What simplex worked out for a term — **and the other half of the shown-state
 * alias**, which is here rather than in the program because it has to be.
 *
 * The program says `inst(I,N)` is a view of the shown state's copy, and it says
 * it in the only place a rule can: `frame(inst(I,N),D,V) :- frame(stt(I,S,N),D,V),
 * shown(I,S)`. That carries the *stated* geometry across and cannot carry the
 * solved geometry, because solved geometry is not in `frame/3` at all — it is a
 * theory answer, `__lpx(lv(stt(i1,rest,label),y),"1714500")`, and a theory atom
 * is not something an ASP rule can read and re-state under another term. So the
 * alias is written twice: once as a rule over `frame/3`, and once here, over the
 * layer the rule cannot reach.
 *
 * Without this, a `pin` on `stt(b1,rest,label)` in a document whose instance is
 * drawn in `rest` moves the copy and leaves the drawn element where the
 * definition put it — one state and two pictures, on the canvas, in the layer
 * list's geometry and in the exported stylesheet. Spec §1's promise that
 * `gsolved/1` and `ge/2` not needing `node/1` is "exactly what lets a rule place
 * two states" is only true if placing the shown one also places what is drawn.
 *
 * The instance part's *own* solved geometry still wins where it has any, and the
 * asymmetry is deliberate: a rule that names `inst(I,N)` in a geometric
 * constraint is talking about the drawn element directly, while one that names
 * the copy is talking about a state that happens to be the one on show. Where
 * both are named the picture can only be one of them, and the nearer claim wins.
 * Per dimension rather than per node, for the reason the `mfshadow/3` guard is:
 * a rule that pins the copy's `top` leaves its width to whoever else has an
 * opinion about it.
 */
function solvedView(
	id: string,
	facts: Facts,
	solved: Record<string, Partial<Frame>>,
): Partial<Frame> | undefined {
	const own = solved[id];
	// Only an instance part can be a view of a copy. A state copy asking this
	// about itself would be asking about `stt(I,S,stt(...))`, which is nothing.
	const part = parseInstancePart(id);
	if (!part) return own;
	const state = facts.shown.get(part.instance);
	if (state === undefined) return own;
	const copy = solved[statePart(part.instance, state, part.node)];
	if (copy === undefined) return own;
	return own === undefined ? copy : { ...copy, ...own };
}

/**
 * Where one term is: the stated frame, with anything simplex worked out on top.
 *
 * The same precedence for a state copy as for a node, and the same lines, which
 * is the point of it being a function. A copy reaches `gsolved/1` exactly as a
 * node does — a geometric constraint may name one, which is the whole reason
 * `stt/3` is not a `node/1` — so `__lpx(lv(stt(i1,hover,label),x),…)` has to
 * beat the copy's own `frame/3` for the same reason a node's does.
 */
function boxOf(id: string, facts: Facts, solved: Record<string, Partial<Frame>>): Frame {
	return {
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		...facts.frame.get(id),
		...solvedView(id, facts, solved),
	};
}

/**
 * Whether a node is drawn: it has to be visible itself, and so does everything
 * it hangs from. Hiding a frame hides what is inside it, which is what the
 * editor already does and what anyone asserting `hidden/1` means.
 */
function drawn(id: string, facts: Facts): boolean {
	// A cycle in child/2 is only reachable from a hand-written rule, but it is
	// reachable, and an unguarded walk up would not come back.
	const seen = new Set<string>();
	for (let at: string | undefined = id; at !== undefined; at = facts.parent.get(at)) {
		if (seen.has(at)) return false;
		seen.add(at);
		if (!facts.visible.has(at)) return false;
		if (!facts.kind.has(at)) return false;
	}
	return true;
}

/** String order, spelled once so that a sort by it reads as the sort it is. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Paint order, with the id as a tie-break so a reading is never arbitrary. */
function byOrder(a: ModelNode, b: ModelNode): number {
	return a.order - b.order || cmp(a.id, b.id);
}

/**
 * The scene one answer set describes.
 *
 * Solved geometry is folded in, so `frame` is where the node actually is
 * rather than where the document last stored it. Nodes that are not drawn —
 * hidden, or of a kind nothing knows how to draw — are absent along with
 * their subtrees, which is why this is a *renderable* scene rather than a
 * transcription of the atoms.
 *
 * The state material is the one part that is *not* filtered that way, and the
 * asymmetry is deliberate. A state copy is never drawn, so there is no such
 * thing as one being drawn or not: a state that hides a part still has that
 * part in {@link ModelScene.states} with `hidden: true`, because "this state
 * takes the panel away" is exactly what its two readers need to be told. What a
 * hidden part *looks* like where it is not hidden is still there to be read,
 * which is what lets the export write one rule and the canvas swap back.
 *
 * An answer set asked for without `scenery` has none of these predicates in it,
 * so it reads as no states, no shown instances and no machines — the same
 * reading it already gives for the picture, and for the same reason: absence is
 * a question that was not asked, not an error.
 */
export function readModel(atoms: readonly string[]): ModelScene {
	const facts = collect(atoms);
	const solved = readSolved(atoms);

	const byId: Record<string, ModelNode> = {};
	for (const id of facts.nodes) {
		if (!drawn(id, facts)) continue;
		const kind = facts.kind.get(id);
		if (!kind) continue;
		byId[id] = {
			id,
			kind,
			order: facts.order.get(id) ?? 1,
			frame: boxOf(id, facts, solved),
			rendered: renderedTexts(id, facts),
			children: [],
		};
	}

	const roots: ModelNode[] = [];
	for (const node of Object.values(byId)) {
		const parent = facts.parent.get(node.id);
		const under = parent === undefined ? undefined : byId[parent];
		if (under) under.children.push(node);
		else roots.push(node);
	}
	roots.sort(byOrder);
	for (const node of Object.values(byId)) node.children.sort(byOrder);

	const groups: Record<string, string[]> = {};
	for (const [id, members] of facts.groups) groups[id] = members.sort();
	const variables: Record<string, ModelAlternative[]> = {};
	for (const [key, alts] of facts.variables) {
		variables[key] = [...alts]
			.sort(([a], [b]) => a - b)
			// A dangling literal id is not an empty alternative; drop it, the way
			// a rendered property with no text is dropped above.
			.flatMap(([index, literal]) => {
				const text = textOf(literal, facts);
				return text === undefined ? [] : [{ index, text }];
			});
	}

	// In table order rather than in the order the atoms arrived, so a class's
	// declarations come out in the same order for a rule's wearer as for the
	// document's.
	const wears: Record<string, ModelWearer[]> = {};
	for (const [style, nodes] of facts.wears) {
		wears[style] = [...nodes]
			.sort(([a], [b]) => cmp(a, b))
			.map(([node, props]) => ({
				node,
				props: PROP_NAMES.filter((prop) => props.has(prop)),
			}));
	}

	// Every state copy the answer set mentions, whichever predicate mentioned it.
	//
	// Enumerated from the atoms rather than from a list of copies, because there
	// is no such list to read: `mcopy/3` is not shown, and it would not be enough
	// if it were — a hand-written rule may state `frame(stt(i1,hover,label),x,10)`
	// about a copy the compiler never minted, and that copy is as real as any
	// other. So the question asked is the one the reader actually cares about:
	// which terms in this answer set parse as a state copy. Four sources, because
	// a copy may have geometry, appearance, solved geometry or nothing but its
	// absence, and any one of those is enough to have something to say about it.
	//
	// Sorted, so that `Object.keys(states)` is a property of the answer set and
	// not of the order clingo happened to print it in.
	const states: Record<string, ModelState> = {};
	const copies = new Set([
		...facts.frame.keys(),
		...facts.rendered.keys(),
		...facts.stateHidden,
		...Object.keys(solved),
	]);
	for (const id of [...copies].sort()) {
		const parsed = parseStatePart(id);
		if (!parsed) continue;
		states[id] = {
			instance: parsed.instance,
			state: parsed.state,
			part: parsed.node,
			frame: boxOf(id, facts, solved),
			rendered: renderedTexts(id, facts),
			hidden: facts.stateHidden.has(id),
		};
	}

	const shown: Record<string, string> = {};
	for (const [instance, state] of facts.shown) shown[instance] = state;

	// Sorted for the same reason the copies are, and by the same argument that
	// puts `wears` in table order: two readings of one answer set have to be the
	// same reading, and a panel listing three unreachable states should not
	// reorder them because a solve came back differently.
	const machines: Record<string, ModelMachine> = {};
	for (const [id, machine] of facts.machines) {
		machines[id] = {
			unreachable: machine.unreachable.sort(),
			deadEnds: machine.deadEnds.sort(),
			nondeterministic: machine.nondeterministic.sort(
				([s1, g1], [s2, g2]) => cmp(s1, s2) || cmp(g1, g2),
			),
			dangling: machine.dangling.sort(),
			duration: machine.duration,
			delay: machine.delay,
			stagger: machine.stagger,
		};
	}

	return { roots, byId, groups, variables, wears, states, shown, machines };
}

/**
 * Properties every member of a group holds — what a rule over it may be about.
 *
 * The group's members are nodes of the answer set rather than of the document,
 * so the question is the same one {@link sharedProps} answers and the source of
 * the kinds is the only difference.
 */
export function groupProps(
	model: ModelScene,
	members: readonly string[],
): PropName[] {
	const kinds = members.flatMap((id) => {
		const node = model.byId[id];
		return node ? [node.kind] : [];
	});
	return sharedPropsOfKinds(kinds);
}
