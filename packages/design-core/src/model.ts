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
 */
import { parseAtom, unquote } from "./atoms.ts";
import type { Frame } from "./geometry.ts";
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
		}
	}
	return facts;
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

/** Paint order, with the id as a tie-break so a reading is never arbitrary. */
function byOrder(a: ModelNode, b: ModelNode): number {
	return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The scene one answer set describes.
 *
 * Solved geometry is folded in, so `frame` is where the node actually is
 * rather than where the document last stored it. Nodes that are not drawn —
 * hidden, or of a kind nothing knows how to draw — are absent along with
 * their subtrees, which is why this is a *renderable* scene rather than a
 * transcription of the atoms.
 */
export function readModel(atoms: readonly string[]): ModelScene {
	const facts = collect(atoms);
	const solved = readSolved(atoms);

	const byId: Record<string, ModelNode> = {};
	for (const id of facts.nodes) {
		if (!drawn(id, facts)) continue;
		const kind = facts.kind.get(id);
		if (!kind) continue;
		const rendered: Partial<Record<PropName, string>> = {};
		for (const [prop, literal] of facts.rendered.get(id) ?? []) {
			// The generated program always names an interned literal, so the id
			// is a constant and the table has it. A hand-written rule may spell
			// the text out instead — `rendered(cell(1,1),fill,"#38bdf8")` — and a
			// quoted term can never be an id, so there is no ambiguity to resolve.
			const text = literal.startsWith('"')
				? unquote(literal)
				: facts.literal.get(literal);
			// A literal with no text is a dangling id, not an empty string.
			if (text !== undefined) rendered[prop] = text;
		}
		byId[id] = {
			id,
			kind,
			order: facts.order.get(id) ?? 1,
			frame: {
				x: 0,
				y: 0,
				width: 0,
				height: 0,
				...facts.frame.get(id),
				...solved[id],
			},
			rendered,
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
				const text = literal.startsWith('"')
					? unquote(literal)
					: facts.literal.get(literal);
				return text === undefined ? [] : [{ index, text }];
			});
	}

	// In table order rather than in the order the atoms arrived, so a class's
	// declarations come out in the same order for a rule's wearer as for the
	// document's.
	const wears: Record<string, ModelWearer[]> = {};
	for (const [style, nodes] of facts.wears) {
		wears[style] = [...nodes]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([node, props]) => ({
				node,
				props: PROP_NAMES.filter((prop) => props.has(prop)),
			}));
	}

	return { roots, byId, groups, variables, wears };
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
