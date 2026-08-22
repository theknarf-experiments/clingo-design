/**
 * Walking the node tree.
 *
 * A node's frame is **relative to its parent's origin**. That is what a
 * designer expects — moving a frame carries its contents, and the inspector
 * shows a position within the frame rather than a global coordinate — and it
 * makes rendering a plain nested layout with no transform maths at all.
 *
 * The cost is that hit testing and snapping need absolute positions, so those
 * go through {@link worldOrigin} / {@link placedNodes}.
 */
import { type Frame, type Point, boundsOf, frameContains } from "./geometry.ts";
import { type SceneNode, isDrawable, isSurface, wrapsChildren } from "./scene.ts";
import { type Value, propVar } from "./values.ts";

/** Depth-first, parents before children — the order nodes are painted in. */
export function flatten(nodes: readonly SceneNode[]): SceneNode[] {
	const out: SceneNode[] = [];
	const walk = (list: readonly SceneNode[]) => {
		for (const node of list) {
			out.push(node);
			if (node.children) walk(node.children);
		}
	};
	walk(nodes);
	return out;
}

export function findInTree(
	nodes: readonly SceneNode[],
	id: string,
): SceneNode | undefined {
	return flatten(nodes).find((n) => n.id === id);
}

/**
 * Ancestors of `id`, outermost first, excluding the node itself.
 *
 * The trail is one mutable array pushed and popped as the walk descends: this
 * runs once per node in {@link parentOf}-style loops, so copying it at every
 * level would make those loops quadratic in allocations as well as in visits.
 */
export function ancestorsOf(
	nodes: readonly SceneNode[],
	id: string,
): SceneNode[] {
	const trail: SceneNode[] = [];
	const walk = (list: readonly SceneNode[]): boolean => {
		for (const node of list) {
			if (node.id === id) return true;
			if (!node.children) continue;
			trail.push(node);
			if (walk(node.children)) return true;
			trail.pop();
		}
		return false;
	};
	return walk(nodes) ? trail : [];
}

export function parentOf(
	nodes: readonly SceneNode[],
	id: string,
): SceneNode | undefined {
	return ancestorsOf(nodes, id).at(-1);
}

/** Every node's parent, in one pass — for callers that need more than one. */
export function parentMap(
	nodes: readonly SceneNode[],
): Map<string, SceneNode> {
	const out = new Map<string, SceneNode>();
	const walk = (list: readonly SceneNode[], parent?: SceneNode) => {
		for (const node of list) {
			if (parent) out.set(node.id, parent);
			if (node.children) walk(node.children, node);
		}
	};
	walk(nodes);
	return out;
}

/* ------------------------------------------------------------------ */
/* Absolute positions                                                  */
/* ------------------------------------------------------------------ */

/** Where a node's parent sits on the canvas. */
export function worldOrigin(nodes: readonly SceneNode[], id: string): Point {
	let x = 0;
	let y = 0;
	for (const ancestor of ancestorsOf(nodes, id)) {
		x += ancestor.frame.x;
		y += ancestor.frame.y;
	}
	return { x, y };
}

/** A node's frame in canvas coordinates. */
export function worldFrame(
	nodes: readonly SceneNode[],
	id: string,
): Frame | undefined {
	const node = findInTree(nodes, id);
	if (!node) return undefined;
	const origin = worldOrigin(nodes, id);
	return {
		x: origin.x + node.frame.x,
		y: origin.y + node.frame.y,
		width: node.frame.width,
		height: node.frame.height,
	};
}

export interface Placed {
	node: SceneNode;
	/** Absolute frame, for hit testing and snapping. */
	world: Frame;
}

/** Every node with its absolute frame, in paint order. */
export function placedNodes(nodes: readonly SceneNode[]): Placed[] {
	const out: Placed[] = [];
	const walk = (list: readonly SceneNode[], ox: number, oy: number) => {
		for (const node of list) {
			const world = {
				x: ox + node.frame.x,
				y: oy + node.frame.y,
				width: node.frame.width,
				height: node.frame.height,
			};
			out.push({ node, world });
			if (node.children) walk(node.children, world.x, world.y);
		}
	};
	walk(nodes, 0, 0);
	return out;
}

/**
 * Topmost drawable node under a canvas point.
 *
 * Wrappers are skipped — they are structure, not surface — so a click always
 * lands on something with pixels, and {@link selectionTargetOf} decides what
 * that means for the selection.
 */
export function hitTestTree(
	nodes: readonly SceneNode[],
	point: Point,
): Placed | undefined {
	const placed = placedNodes(nodes).filter((p) => isDrawable(p.node));
	for (let i = placed.length - 1; i >= 0; i--) {
		if (frameContains(placed[i].world, point)) return placed[i];
	}
	return undefined;
}

/** The innermost surface containing a canvas point — where a new node lands. */
export function frameAt(
	nodes: readonly SceneNode[],
	point: Point,
): Placed | undefined {
	let found: Placed | undefined;
	for (const placed of placedNodes(nodes)) {
		if (!isSurface(placed.node)) continue;
		if (frameContains(placed.world, point)) found = placed;
	}
	return found;
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

/**
 * What a plain click on `id` should select.
 *
 * A wrapper behaves as one object, so the outermost enclosing one wins. A
 * surface does *not*: it is a container you work inside, so the search resets
 * at one — clicking a rectangle in a frame selects the rectangle.
 */
export function selectionTargetOf(
	nodes: readonly SceneNode[],
	id: string,
): SceneNode | undefined {
	let target: SceneNode | undefined;
	for (const ancestor of ancestorsOf(nodes, id)) {
		if (isSurface(ancestor)) target = undefined;
		else if (wrapsChildren(ancestor) && !target) target = ancestor;
	}
	return target ?? findInTree(nodes, id);
}

/** The nearest enclosing surface, which bounds snapping and new children. */
export function frameAncestorOf(
	nodes: readonly SceneNode[],
	id: string,
): SceneNode | undefined {
	const trail = ancestorsOf(nodes, id);
	for (let i = trail.length - 1; i >= 0; i--) {
		if (isSurface(trail[i])) return trail[i];
	}
	return undefined;
}

/**
 * Every node property keyed by its variable name.
 *
 * This is what lets a derived term read another node's property rather than
 * only a token: resolution works over variable keys, and this is the map from
 * the prop half of that namespace back into the document.
 */
export function propValues(
	nodes: readonly SceneNode[],
): Record<string, Value> {
	const out: Record<string, Value> = {};
	for (const node of flatten(nodes)) {
		for (const [prop, value] of Object.entries(node.props)) {
			if (value) out[propVar(node.id, prop)] = value;
		}
	}
	return out;
}

/** Layer names by id, for anywhere a variable key has to be shown to a human. */
export function nodeNames(
	nodes: readonly SceneNode[],
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const node of flatten(nodes)) out[node.id] = node.name;
	return out;
}

/** A node and everything beneath it. */
export function subtreeIds(node: SceneNode): string[] {
	const out = [node.id];
	for (const child of node.children ?? []) out.push(...subtreeIds(child));
	return out;
}

/** Rebuild every node in the tree, dropping any the mapper returns null for. */
export function mapTree(
	nodes: readonly SceneNode[],
	fn: (node: SceneNode) => SceneNode | null,
): SceneNode[] {
	const out: SceneNode[] = [];
	for (const node of nodes) {
		const mapped = fn(node);
		if (!mapped) continue;
		out.push(
			mapped.children
				? { ...mapped, children: mapTree(mapped.children, fn) }
				: mapped,
		);
	}
	return out;
}

/** The list of siblings that contains `id`, and the index within it. */
export function locate(
	nodes: readonly SceneNode[],
	id: string,
): { siblings: readonly SceneNode[]; index: number; parent?: SceneNode } | null {
	const index = nodes.findIndex((n) => n.id === id);
	if (index >= 0) return { siblings: nodes, index };
	for (const node of nodes) {
		if (!node.children) continue;
		const found = locate(node.children, id);
		if (found) return { ...found, parent: found.parent ?? node };
	}
	return null;
}

/** A wrapper's frame in its parent's space: whatever its children occupy. */
export function groupFrame(children: readonly SceneNode[]): Frame {
	return (
		boundsOf(children.map((c) => c.frame)) ?? {
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		}
	);
}

/**
 * Re-fits every wrapper around its children, bottom-up.
 *
 * Surfaces are deliberately excluded: an artboard is a fixed thing, and having
 * it resize itself whenever something moved inside would be maddening.
 */
export function refreshGroups(nodes: readonly SceneNode[]): SceneNode[] {
	return nodes.map((node) => {
		if (!node.children) return node;
		const children = refreshGroups(node.children);
		if (!wrapsChildren(node) || children.length === 0) {
			return { ...node, children };
		}

		const bounds = groupFrame(children);
		// Children are relative to the group, so moving the group's own origin
		// has to re-base them by the same amount.
		return {
			...node,
			frame: {
				x: node.frame.x + bounds.x,
				y: node.frame.y + bounds.y,
				width: bounds.width,
				height: bounds.height,
			},
			children: children.map((child) => ({
				...child,
				frame: {
					...child.frame,
					x: child.frame.x - bounds.x,
					y: child.frame.y - bounds.y,
				},
			})),
		};
	});
}
