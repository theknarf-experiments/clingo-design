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
 * Which of two nodes the eye sees on top.
 *
 * The canvas has two hit tests that do not know about each other: the
 * document's, which cannot see a derived node at all, and {@link derivedAt}.
 * Something has to settle which answer wins, and paint order is the only honest
 * arbiter — what is drawn last is what the pointer gets, whichever tree it came
 * from.
 *
 * The model tree is where that order lives: a pre-order walk of it is exactly
 * the order the renderer emits, so a child always comes after its parent and a
 * later sibling's whole subtree after an earlier one's. That subsumes the
 * enclosing case this used to test — a derived node under a document node is
 * painted after it — and also answers the case it got wrong, where a derived
 * node is drawn over a document node that is not its ancestor.
 *
 * Unknown ids are not on top of anything.
 */
export function paintedOver(model: ModelScene, over: string, under: string): boolean {
	if (over === under) return false;
	let rank = 0;
	let overAt = -1;
	let underAt = -1;
	const walk = (node: ModelNode): void => {
		const at = rank++;
		if (node.id === over) overAt = at;
		else if (node.id === under) underAt = at;
		for (const child of node.children) walk(child);
	};
	for (const root of model.roots) walk(root);
	return overAt >= 0 && underAt >= 0 && overAt > underAt;
}
