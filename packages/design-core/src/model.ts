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
 * Nothing consumes it yet. It is pure, so it can be tested against the real
 * solver without a canvas anywhere near it.
 */
import { parseAtom, unquote } from "./atoms.ts";
import type { Frame } from "./geometry.ts";
import { KINDS, type NodeKind, PROPS, type PropName } from "./scene.ts";

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

export interface ModelScene {
	/** Top-level nodes, in paint order. */
	roots: ModelNode[];
	/** Every node in the tree, by id. */
	byId: Record<string, ModelNode>;
}

/**
 * Theory values arrive as exact rationals — `"320/3"` rather than `106.667`.
 * Only a renderer needs a float, so the conversion happens here and as late as
 * possible.
 */
function rational(text: string): number | undefined {
	const slash = text.indexOf("/");
	const n =
		slash === -1
			? Number(text)
			: Number(text.slice(0, slash)) / Number(text.slice(slash + 1));
	return Number.isFinite(n) ? n : undefined;
}

const AXIS = { x: "x", y: "y", width: "width", height: "height" } as const;

/**
 * Pulls `__lpx(lv(n,x),"12")` and `__lpx(lsz(n,width),"80")` out of a model.
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
		const value = rational(unquote(outer.args[1]));
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

	return { roots, byId };
}
