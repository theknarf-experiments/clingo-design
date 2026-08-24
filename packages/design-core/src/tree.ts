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
import {
	type Edge,
	EDGES,
	type SceneNode,
	frameDim,
	frameOf,
	isDrawable,
	isLaidOut,
	isSurface,
	layoutWord,
	withFrame,
	wrapsChildren,
} from "./scene.ts";
import { type ResolveContext, type Value, propVar } from "./values.ts";

/**
 * What a frame resolves against when the caller has no universe in mind — the
 * first alternative of every dimension, which is what an unsolved preview
 * shows. Every entry point here takes a real one; this is the default.
 */
const NO_CONTEXT: ResolveContext = { tokens: [], picks: {} };

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

/**
 * Where a node's parent sits on the canvas.
 *
 * `context` is the universe being looked at: a dimension is a value now, so an
 * ancestor may sit in one place in one design and elsewhere in another, and an
 * absolute coordinate only means anything relative to one of them.
 */
export function worldOrigin(
	nodes: readonly SceneNode[],
	id: string,
	context: ResolveContext = NO_CONTEXT,
): Point {
	let x = 0;
	let y = 0;
	for (const ancestor of ancestorsOf(nodes, id)) {
		x += frameDim(ancestor, "x", context);
		y += frameDim(ancestor, "y", context);
	}
	return { x, y };
}

/** A node's frame in canvas coordinates. */
export function worldFrame(
	nodes: readonly SceneNode[],
	id: string,
	context: ResolveContext = NO_CONTEXT,
): Frame | undefined {
	const node = findInTree(nodes, id);
	if (!node) return undefined;
	const origin = worldOrigin(nodes, id, context);
	const frame = frameOf(node, context);
	return {
		x: origin.x + frame.x,
		y: origin.y + frame.y,
		width: frame.width,
		height: frame.height,
	};
}

/**
 * What a geometric constraint measures, read off the document.
 *
 * The same quantity the solver calls `ge(N,E)`, but undoubled and from the
 * stored frames — which is how a new `pin` or `gap` can start at the number
 * that changes nothing. Undefined for the whole-axis edges, which are a
 * direction rather than a place.
 */
export function edgeAt(
	nodes: readonly SceneNode[],
	id: string,
	edge: Edge,
	context: ResolveContext = NO_CONTEXT,
): number | undefined {
	const frame = worldFrame(nodes, id, context);
	if (!frame) return undefined;
	const spec = EDGES[edge];
	const size = spec.axis === "x" ? frame.width : frame.height;
	if (spec.role === "span") return size;
	if (spec.role === "axis") return undefined;
	const start = spec.axis === "x" ? frame.x : frame.y;
	return start + size * (spec.place === "lead" ? 0 : spec.place === "mid" ? 0.5 : 1);
}

export interface Placed {
	node: SceneNode;
	/** Absolute frame, for hit testing and snapping. */
	world: Frame;
}

/**
 * Every node with its absolute frame, in paint order.
 *
 * `solved` overrides whatever the solver worked out for a node under an
 * automatic layout. Hit testing, snapping and the selection outlines all go
 * through here, so passing it is what keeps the editor pointing at where
 * things actually are rather than where they are stored.
 *
 * `context` is the universe on screen. A node's four dimensions are values, so
 * without one this reads the first alternative of each — which is right for an
 * unsolved preview and wrong for a click, because the pointer has to land on
 * the design the eye is looking at.
 */
export function placedNodes(
	nodes: readonly SceneNode[],
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	context: ResolveContext = NO_CONTEXT,
): Placed[] {
	const out: Placed[] = [];
	const walk = (list: readonly SceneNode[], ox: number, oy: number) => {
		for (const node of list) {
			const fixed = solved[node.id];
			const stored = frameOf(node, context);
			const frame = fixed ? { ...stored, ...fixed } : stored;
			const world = {
				x: ox + frame.x,
				y: oy + frame.y,
				width: frame.width,
				height: frame.height,
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
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	context: ResolveContext = NO_CONTEXT,
): Placed | undefined {
	const placed = placedNodes(nodes, solved, context).filter((p) =>
		isDrawable(p.node),
	);
	for (let i = placed.length - 1; i >= 0; i--) {
		if (frameContains(placed[i].world, point)) return placed[i];
	}
	return undefined;
}

/** The innermost surface containing a canvas point — where a new node lands. */
export function frameAt(
	nodes: readonly SceneNode[],
	point: Point,
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	context: ResolveContext = NO_CONTEXT,
): Placed | undefined {
	let found: Placed | undefined;
	for (const placed of placedNodes(nodes, solved, context)) {
		if (!isSurface(placed.node)) continue;
		if (frameContains(placed.world, point)) found = placed;
	}
	return found;
}

/** Where a drag would land: a container, or the canvas, and a place in it. */
export interface DropTarget {
	/** Null for the top level. */
	id: string | null;
	/** Index among the target's children *after* the dragged nodes are lifted out. */
	index: number;
}

/**
 * Where dropping at `point` should put the nodes in `moving`.
 *
 * The host is the innermost surface under the pointer, the same rule that
 * decides where a newly drawn node lands — a group is structure rather than a
 * place, and dropping into one you cannot see the edges of is a surprise.
 * Nothing being dragged, or inside something being dragged, can be the host.
 *
 * The index only means anything under an automatic layout, where it is the
 * arrangement order: it falls where the pointer fell along the main axis.
 * Anywhere else a drop is a plain move and the node goes on top.
 *
 * Which axis that is is a value now, so `context` is the universe on screen —
 * the same document can be a row in one and a column in another, and a drop
 * has to mean what the designer is looking at.
 */
export function dropTargetAt(
	nodes: readonly SceneNode[],
	point: Point,
	moving: ReadonlySet<string> = new Set(),
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	context: ResolveContext = NO_CONTEXT,
): DropTarget {
	const placed = placedNodes(nodes, solved, context);
	const lifted = new Set<string>();
	for (const p of placed) {
		if (moving.has(p.node.id)) for (const id of subtreeIds(p.node)) lifted.add(id);
	}

	let host: Placed | undefined;
	for (const p of placed) {
		if (!isSurface(p.node) || lifted.has(p.node.id)) continue;
		if (frameContains(p.world, point)) host = p;
	}
	if (!host) {
		return { id: null, index: nodes.filter((n) => !lifted.has(n.id)).length };
	}

	const staying = (host.node.children ?? []).filter((c) => !lifted.has(c.id));
	if (!isLaidOut(host.node)) {
		return { id: host.node.id, index: staying.length };
	}

	const row = layoutWord(host.node, "direction", context) === "row";
	const at = row ? point.x : point.y;
	let index = 0;
	for (const child of staying) {
		const frame = { ...frameOf(child, context), ...solved[child.id] };
		const middle = row
			? host.world.x + frame.x + frame.width / 2
			: host.world.y + frame.y + frame.height / 2;
		if (at <= middle) break;
		index++;
	}
	return { id: host.node.id, index };
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

/**
 * Nodes whose position their parent decides.
 *
 * They can be selected and styled like anything else, but dragging or resizing
 * one would be a lie: the next solve puts it straight back.
 */
export function managedNodes(nodes: readonly SceneNode[]): Set<string> {
	const out = new Set<string>();
	for (const node of flatten(nodes)) {
		if (!isLaidOut(node)) continue;
		for (const child of node.children ?? []) out.add(child.id);
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
export function groupFrame(
	children: readonly SceneNode[],
	context: ResolveContext = NO_CONTEXT,
): Frame {
	return (
		boundsOf(children.map((c) => frameOf(c, context))) ?? {
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
 *
 * Both the reading and the writing happen in one universe — `context` — for the
 * same reason a drag does: a group around a child that sits in two places has
 * two honest bounding boxes, and the one worth re-fitting is the one on screen.
 */
export function refreshGroups(
	nodes: readonly SceneNode[],
	context: ResolveContext = NO_CONTEXT,
): SceneNode[] {
	return nodes.map((node) => {
		if (!node.children) return node;
		const children = refreshGroups(node.children, context);
		if (!wrapsChildren(node) || children.length === 0) {
			return { ...node, children };
		}

		const bounds = groupFrame(children, context);
		// Children are relative to the group, so moving the group's own origin
		// has to re-base them by the same amount.
		return withFrame(
			{
				...node,
				children: children.map((child) =>
					withFrame(
						child,
						{
							x: frameDim(child, "x", context) - bounds.x,
							y: frameDim(child, "y", context) - bounds.y,
						},
						context,
					),
				),
			},
			{
				x: frameDim(node, "x", context) + bounds.x,
				y: frameDim(node, "y", context) + bounds.y,
				width: bounds.width,
				height: bounds.height,
			},
			context,
		);
	});
}
