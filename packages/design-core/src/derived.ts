/**
 * Nodes that exist because a rule said so, rather than because the document
 * holds them.
 *
 * `node/1` is a derivable predicate: `node(cell(R,C)) :- pos(R), pos(C).`
 * puts nine cells on the canvas that no layer, no drag and no undo entry ever
 * touched. Since the renderer already draws the answer set, that costs the
 * canvas nothing — but it costs the *editor* something, because a derived node
 * has nothing in the document to change.
 *
 * The honest analogy is a spreadsheet: a typed cell and a formula cell look
 * alike and behave completely differently, and the only thing that makes that
 * bearable is that you can always tell which is which. So the studio lists
 * derived nodes, marks them, and shows what they resolved to — read-only, with
 * the reason. Writing an edit back into the rule that produced one is a
 * research problem and is deliberately not attempted.
 *
 * Everything here is a pure reading of a {@link ModelScene}, so it is testable
 * against the real solver with no canvas anywhere near it.
 */
import { type Frame, type Point, frameContains } from "./geometry.ts";
import type { ModelNode, ModelScene } from "./model.ts";
import type { Scene } from "./scene.ts";
import { flatten } from "./tree.ts";

/** Every id the document itself holds. */
export function documentIds(scene: Scene): Set<string> {
	return new Set(flatten(scene.nodes).map((node) => node.id));
}

/** One node of the answer set that the document does not contain. */
export interface DerivedNode {
	/** The answer set's whole account of it: kind, frame, rendered text. */
	node: ModelNode;
	/** Its parent in the model tree — a document node, or another derived one. */
	parent: string | null;
	/** How deep it sits in the model tree, roots at zero. */
	depth: number;
	/** Its frame on the canvas rather than inside its parent. */
	world: Frame;
}

/**
 * The derived nodes of one universe, in paint order — a parent before its
 * children, and siblings back to front.
 *
 * Reading them off the model tree rather than off the atoms is what gives them
 * a place: a derived node's frame is relative to whatever `child/2` hung it
 * from, and the panel wants to show it under that same parent.
 */
export function derivedNodes(
	model: ModelScene,
	document: ReadonlySet<string>,
): DerivedNode[] {
	const out: DerivedNode[] = [];
	const walk = (
		node: ModelNode,
		parent: string | null,
		depth: number,
		at: Point,
	): void => {
		const world = {
			x: at.x + node.frame.x,
			y: at.y + node.frame.y,
			width: node.frame.width,
			height: node.frame.height,
		};
		if (!document.has(node.id)) out.push({ node, parent, depth, world });
		for (const child of node.children) {
			walk(child, node.id, depth + 1, { x: world.x, y: world.y });
		}
	};
	for (const root of model.roots) walk(root, null, 0, { x: 0, y: 0 });
	return out;
}

/**
 * The topmost derived node under a point, or null.
 *
 * Later in the list is later in the paint order, so the search runs backwards:
 * what the eye sees on top is what the pointer gets.
 */
export function derivedAt(
	nodes: readonly DerivedNode[],
	at: Point,
): DerivedNode | null {
	for (let i = nodes.length - 1; i >= 0; i--) {
		if (frameContains(nodes[i].world, at)) return nodes[i];
	}
	return null;
}

/**
 * Whether `ancestor` is at or above `id` in the model tree.
 *
 * The canvas needs this to settle a two-tree hit test: the document's own hit
 * testing knows nothing of derived nodes, so a click on one currently lands on
 * whichever document node encloses it. Preferring the derived node exactly
 * when that is the relationship keeps every existing gesture untouched.
 */
export function encloses(
	nodes: readonly DerivedNode[],
	ancestor: string,
	id: string,
): boolean {
	const parents = new Map(nodes.map((d) => [d.node.id, d.parent] as const));
	const seen = new Set<string>();
	for (let at: string | null = id; at !== null; at = parents.get(at) ?? null) {
		if (at === ancestor) return true;
		if (seen.has(at)) return false;
		seen.add(at);
		// The chain stops at the first node the document owns, whose own parent
		// this reading does not carry — but a document node *is* the answer.
		if (!parents.has(at)) return false;
	}
	return false;
}
