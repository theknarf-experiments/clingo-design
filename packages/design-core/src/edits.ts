/**
 * Document edits.
 *
 * Every operation is a pure `Scene -> Scene` function, so the editor's
 * behaviour is testable without a DOM and undo is just a stack of previous
 * documents.
 *
 * Frames are relative to their parent, so an operation on a node needs to say
 * nothing about its descendants: they come along on their own.
 */
import {
	componentDef,
	componentDefs,
	holdsInstancePart,
	instanceVariable,
	isDefinition,
	isInstance,
	openVariables,
} from "./components.ts";
import {
	findMachine,
	holdsStateCopy,
	machineForRoot,
} from "./machines.ts";
import {
	DEFAULT_UNIT,
	EMU_PER_PX,
	type Emu,
	type Unit,
	quantizeGesture,
} from "./units.ts";
import {
	type Frame,
	MIN_NODE_SIZE,
	type PathPoint,
	type Point,
	normaliseFrame,
	pathBounds,
	scalePoints,
} from "./geometry.ts";
import {
	type AutoLayout,
	type ChildProp,
	CONSTRAINT_KINDS,
	type Constraint,
	type ConstraintKind,
	type ConstraintSpec,
	DIMENSIONS,
	type Diagonal,
	type Dimension,
	EDGES,
	type Edge,
	type Guide,
	type GuideProp,
	KINDS,
	type Machine,
	type MachineState,
	type NodeKind,
	PROPS,
	type PropName,
	type Scene,
	type SceneNode,
	type Sizing,
	type StatePart,
	type Style,
	type StyleVariant,
	type SurfaceGuides,
	TRIGGERS,
	type Transition,
	type Trigger,
	dimension,
	edgeOn,
	findGuide,
	findStyle,
	frameDim,
	frameOf,
	guideLines,
	holdsDatum,
	nextGuideId,
	withGuideAt,
	isConstraintTerm,
	makeFrame,
	makeLayout,
	rangesOverGroup,
	sceneContext,
	sharedPropsOfKinds,
	stateTouches,
	styleProps,
	uniqueName,
	withFrame,
	wornProps,
	wrapsChildren,
} from "./scene.ts";
import {
	type Picks,
	type ResolveContext,
	type Term,
	type Token,
	VALUE_TYPES,
	type Value,
	type ValueType,
	activeIndex,
	constraintVar,
	frameVar,
	lit,
	propVar,
	resolveValue,
	single,
	styleVar,
	tokenVar,
	wordOf,
	wouldCycle,
} from "./values.ts";
import {
	edgeAt,
	findInTree,
	frameAt,
	flatten,
	groupFrame,
	locate,
	mapTree,
	placedNodes,
	refreshGroups,
	subtreeIds,
	worldOrigin,
} from "./tree.ts";

let counter = 0;

/** Ids only need to be unique within a document. */
export function newNodeId(): string {
	counter += 1;
	const random = globalThis.crypto?.randomUUID?.().slice(0, 8);
	return random ? `n_${random}` : `n_${counter}`;
}

/**
 * A fresh node of `kind` occupying `frame`.
 *
 * Options that only some kinds carry are dropped for the rest, so a caller can
 * pass whatever the gesture happened to know without asking what it is drawing.
 */
export function makeNode(
	kind: NodeKind,
	frame: Frame,
	options: {
		id?: string;
		name?: string;
		text?: string;
		diagonal?: Diagonal;
		points?: readonly Point[];
		closed?: boolean;
	} = {},
): SceneNode {
	const spec = KINDS[kind];
	return {
		id: options.id ?? newNodeId(),
		kind,
		name: options.name ?? spec.label,
		frame: makeFrame(normaliseFrame(frame)),
		...(spec.diagonal ? { diagonal: options.diagonal ?? "down" } : {}),
		...(spec.plotted
			? { points: [...(options.points ?? [])], closed: options.closed ?? false }
			: {}),
		props:
			options.text === undefined
				? { ...spec.defaults }
				: { ...spec.defaults, text: single(options.text) },
		...(spec.container ? { children: [] } : {}),
	};
}

/**
 * A path through `points`, given in whatever space the pointer produced them.
 *
 * The frame becomes their bounding box and the points are stored relative to
 * it, which is the invariant everything else relies on: `Plot` scales the
 * vertices out of the box they were authored in and into the one the node is
 * drawn at, so a frame that is not their bounding box squashes the shape and
 * slides it off the anchors the designer clicked.
 *
 * Two things keep that invariant, and they are not the same thing. The anchors
 * are quantized because a stored frame lands on a whole pixel whatever it is
 * handed — `writeLength` quantizes every dimension a gesture writes — so
 * vertices off the pixel grid give a bounding box the document cannot keep.
 * That used to read `Math.round`, which said exactly this while a vertex was a
 * pixel count; in EMU the same call rounds a number that is already whole and
 * quietly does nothing.
 *
 * And the points are shifted into the box the node is *stored* at rather than
 * into the raw bounding box, because quantizing the anchors is not enough on its
 * own: `pathBounds` includes the extremes of every bezier, and a curve reaches
 * its widest wherever the arithmetic puts it, whole-pixel anchors or not. A
 * `normaliseFrame` that then moved the box out from under the points would offset
 * the whole shape by up to half a pixel — which is the same disagreement, arrived
 * at from the other end.
 */
export function makePath(
	points: readonly PathPoint[],
	closed: boolean,
	options: { id?: string; name?: string } = {},
): SceneNode {
	// Anchors go to whole pixels so frame and points agree; handles are
	// offsets and stay exactly as drawn, since quantizing them would visibly
	// kink a shallow curve.
	const whole: PathPoint[] = points.map((p) => ({
		...p,
		x: quantizeGesture(p.x),
		y: quantizeGesture(p.y),
	}));
	const bounds = pathBounds(whole, closed) ?? {
		x: 0,
		y: 0,
		...KINDS.path.defaultSize,
	};
	// The box the node will be stored at — `makeNode` runs the frame through
	// this too, and it is idempotent, so asking for it early costs nothing and
	// is the only way the shift below can be against the frame that survives.
	const box = normaliseFrame(bounds);
	return makeNode("path", box, {
		...options,
		closed,
		points: whole.map((p) => ({ ...p, x: p.x - box.x, y: p.y - box.y })),
	});
}

/**
 * Rewrites a path's vertices and re-derives its frame from them.
 *
 * The points arrive relative to the node's *current* frame origin; the new
 * bounding box is then subtracted back out, so the frame moves under the
 * shape rather than the shape moving inside the frame. Everything that edits
 * a path goes through here, because getting that subtraction wrong is how the
 * outline and the drawing come apart.
 */
export function setPathPoints(
	scene: Scene,
	id: string,
	points: readonly PathPoint[],
	closed?: boolean,
	picks: Picks = {},
): Scene {
	const context = sceneContext(scene, picks);
	return {
		...scene,
		nodes: refreshGroups(
			mapTree(scene.nodes, (node) => {
				if (node.id !== id || !node.points) return node;
				const shut = closed ?? node.closed ?? false;
				const bounds = pathBounds(points, shut);
				if (!bounds) return node;
				const shift = (p: Point) => ({ x: p.x - bounds.x, y: p.y - bounds.y });
				return withFrame(
					{
						...node,
						closed: shut,
						// Handles are offsets from their anchor, so they survive the
						// shift untouched — only the anchors move.
						points: points.map((p) => ({ ...p, ...shift(p) })),
					},
					{
						x: frameDim(node, "x", context) + bounds.x,
						y: frameDim(node, "y", context) + bounds.y,
						width: Math.max(MIN_NODE_SIZE, bounds.width),
						height: Math.max(MIN_NODE_SIZE, bounds.height),
					},
					context,
				);
			}),
			context,
		),
	};
}

/** Moves one vertex, carrying its handles. */
export function movePathPoint(
	scene: Scene,
	id: string,
	index: number,
	to: Point,
	picks: Picks = {},
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node?.points?.[index]) return scene;
	const next = node.points.map((p, i) => (i === index ? { ...p, ...to } : p));
	return setPathPoints(scene, id, next, undefined, picks);
}

/**
 * Sets one side of a vertex's curve.
 *
 * `mirror` keeps the other side opposite and equal, which is what makes a
 * point smooth: the curve passes through without a crease.
 */
export function setPathHandle(
	scene: Scene,
	id: string,
	index: number,
	side: "in" | "out",
	offset: Point | undefined,
	mirror: boolean,
	picks: Picks = {},
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node?.points?.[index]) return scene;
	const other = side === "in" ? "out" : "in";
	const next = node.points.map((p, i) => {
		if (i !== index) return p;
		const point: PathPoint = { x: p.x, y: p.y, in: p.in, out: p.out };
		point[side] = offset;
		if (mirror) {
			point[other] = offset && { x: -offset.x, y: -offset.y };
		}
		if (!point.in) delete point.in;
		if (!point.out) delete point.out;
		return point;
	});
	return setPathPoints(scene, id, next, undefined, picks);
}

/** Drops a vertex. A path needs two, so the last pair is kept. */
export function removePathPoint(
	scene: Scene,
	id: string,
	index: number,
	picks: Picks = {},
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node?.points || node.points.length <= 2) return scene;
	return setPathPoints(
		scene,
		id,
		node.points.filter((_, i) => i !== index),
		undefined,
		picks,
	);
}

/** Corner <-> smooth. A smooth point gets handles along its neighbours' line. */
export function togglePathSmooth(
	scene: Scene,
	id: string,
	index: number,
	picks: Picks = {},
): Scene {
	const node = findInTree(scene.nodes, id);
	const point = node?.points?.[index];
	if (!node?.points || !point) return scene;
	if (point.in || point.out) {
		return setPathHandle(scene, id, index, "out", undefined, true, picks);
	}
	const n = node.points.length;
	const before = node.points[(index - 1 + n) % n];
	const after = node.points[(index + 1) % n];
	// A quarter of the way along the neighbours' chord is the usual guess and
	// looks like a curve rather than a spike.
	const offset = {
		x: (after.x - before.x) / 4,
		y: (after.y - before.y) / 4,
	};
	return setPathHandle(scene, id, index, "out", offset, true, picks);
}

/**
 * Adds a node inside `parentId`, or at the top level when it is null.
 *
 * `frame` arrives in canvas coordinates — that is what the pointer produces —
 * and is rebased into the parent's space here, so callers never have to think
 * about the conversion.
 */
export function addNodeTo(
	scene: Scene,
	parentId: string | null,
	node: SceneNode,
	picks: Picks = {},
): Scene {
	if (!parentId) return addNode(scene, node);
	const context = sceneContext(scene, picks);
	const origin = worldOrigin(scene.nodes, parentId, context);
	const parent = findInTree(scene.nodes, parentId);
	if (!parent) return addNode(scene, node);

	const at = frameOf(node, context);
	const local: SceneNode = withFrame(
		node,
		{
			x: at.x - (origin.x + frameDim(parent, "x", context)),
			y: at.y - (origin.y + frameDim(parent, "y", context)),
		},
		context,
	);
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === parentId ? { ...n, children: [...(n.children ?? []), local] } : n,
		),
	};
}

export function addNode(scene: Scene, node: SceneNode): Scene {
	return { ...scene, nodes: [...scene.nodes, node] };
}

/**
 * Removes the named nodes and everything beneath them.
 *
 * The two prunes run in this order and the order is a decision.
 * {@link pruneConstraints} asks {@link holdsStateCopy} whether a cross-state
 * member is still real, and that question is answered through the machine — so
 * running {@link pruneMachines} first means a rule about a component whose whole
 * definition has just been deleted is dropped along with it, rather than left
 * ranging over a ghost until the next unrelated edit noticed. Which is the
 * sentence `pruneConstraints` opens with, applied one link further out.
 */
export function deleteNodes(
	scene: Scene,
	ids: readonly string[],
	picks: Picks = {},
): Scene {
	const drop = new Set(ids);
	return pruneConstraints(
		pruneMachines({
			...scene,
			nodes: refreshGroups(
				mapTree(scene.nodes, (node) => (drop.has(node.id) ? null : node)),
				sceneContext(scene, picks),
			),
		}),
	);
}

/**
 * Translates the named nodes.
 *
 * Children are relative to their parent, so they come along without being
 * touched — moving a frame moves everything in it for free.
 */
export function moveNodes(
	scene: Scene,
	ids: readonly string[],
	dx: number,
	dy: number,
	picks: Picks = {},
): Scene {
	const touch = new Set(ids);
	const context = sceneContext(scene, picks);
	return {
		...scene,
		nodes: refreshGroups(
			mapTree(scene.nodes, (node) =>
				touch.has(node.id)
					? withFrame(
							node,
							{
								x: frameDim(node, "x", context) + dx,
								y: frameDim(node, "y", context) + dy,
							},
							context,
						)
					: node,
			),
			context,
		),
	};
}

/**
 * A node's frame replaced, carrying a plotted kind's points with it.
 *
 * The frame *is* the bounding box of those points, so a resize that left them
 * where they were would leave the two describing different shapes.
 */
function refit(
	node: SceneNode,
	frame: Frame,
	context: ResolveContext,
): SceneNode {
	const next = normaliseFrame(frame);
	if (!node.points) return withFrame(node, next, context);
	return withFrame(
		{ ...node, points: scalePoints(node.points, frameOf(node, context), next) },
		next,
		context,
	);
}

/**
 * Replaces frames wholesale — what a drag or resize commits.
 *
 * `picks` is the universe on screen, and it is what makes this safe on a node
 * with two positions: the write lands on the alternative that universe chose
 * and the others are untouched, so a drag moves the one you can see rather than
 * collapsing the node to a single place. See {@link withFrame}.
 */
export function setFrames(
	scene: Scene,
	frames: ReadonlyMap<string, Frame>,
	picks: Picks = {},
): Scene {
	const context = sceneContext(scene, picks);
	return {
		...scene,
		nodes: refreshGroups(
			mapTree(scene.nodes, (node) => {
				const next = frames.get(node.id);
				return next ? refit(node, next, context) : node;
			}),
			context,
		),
	};
}

export function setFrame(
	scene: Scene,
	id: string,
	frame: Frame,
	picks: Picks = {},
): Scene {
	return setFrames(scene, new Map([[id, frame]]), picks);
}

/**
 * Replaces one dimension's whole list of alternatives.
 *
 * The counterpart of {@link setProp} for geometry, and the only edit that
 * changes how *many* positions a node has: giving x a second value is what
 * makes the document hold two designs, and taking one away is what collapses
 * them back. A drag never comes through here — see {@link withFrame}.
 */
export function setFrameValue(
	scene: Scene,
	ids: readonly string[],
	dim: Dimension,
	value: Value,
): Scene {
	if (value.length === 0) return scene;
	return mapSelected(scene, ids, (node) => ({
		...node,
		frame: { ...node.frame, [dim]: value },
	}));
}

/**
 * Resizing a node scales what is inside it, so the contents keep their
 * relative layout instead of drifting out of the frame.
 */
export function resizeSubtree(
	scene: Scene,
	id: string,
	next: Frame,
	picks: Picks = {},
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node) return scene;
	if (!node.children || node.children.length === 0) {
		return setFrame(scene, id, next, picks);
	}

	const context = sceneContext(scene, picks);
	const from = frameOf(node, context);
	const target = normaliseFrame(next);
	const sx = from.width === 0 ? 1 : target.width / from.width;
	const sy = from.height === 0 ? 1 : target.height / from.height;

	// Children are already relative to this node, so scaling is a plain
	// multiply — no origin to subtract.
	const frames = new Map<string, Frame>([[id, target]]);
	for (const child of flatten(node.children ?? [])) {
		const box = frameOf(child, context);
		frames.set(child.id, {
			x: box.x * sx,
			y: box.y * sy,
			width: box.width * sx,
			height: box.height * sy,
		});
	}
	return setFrames(scene, frames, picks);
}

function mapSelected(
	scene: Scene,
	ids: readonly string[],
	fn: (node: SceneNode) => SceneNode,
): Scene {
	const touch = new Set(ids);
	return {
		...scene,
		nodes: mapTree(scene.nodes, (node) => (touch.has(node.id) ? fn(node) : node)),
	};
}

export function setProp(
	scene: Scene,
	ids: readonly string[],
	prop: PropName,
	value: Value | undefined,
): Scene {
	return mapSelected(scene, ids, (node) => {
		const props = { ...node.props };
		if (value === undefined) delete props[prop];
		else props[prop] = value;
		return { ...node, props };
	});
}

/**
 * Rewrites a text node's first alternative.
 *
 * Content is an ordinary property now, so the general editor handles the rest —
 * this only exists for the callers that type into one box and mean one string.
 */
export function setText(scene: Scene, id: string, text: string): Scene {
	const node = findInTree(scene.nodes, id);
	const rest = node?.props.text?.slice(1) ?? [];
	return setProp(scene, [id], "text", [lit(text), ...rest]);
}

export function renameNode(scene: Scene, id: string, name: string): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return mapSelected(scene, [id], (node) => ({ ...node, name: trimmed }));
}

export type ReorderTo = "front" | "back" | "forward" | "backward";

/** Reorders within the node's own sibling list; z-order is scoped to a parent. */
export function reorderNodes(
	scene: Scene,
	ids: readonly string[],
	to: ReorderTo,
): Scene {
	const move = new Set(ids);

	const reorder = (list: readonly SceneNode[]): SceneNode[] => {
		const nodes = list.map((n) =>
			n.children ? { ...n, children: reorder(n.children) } : n,
		);
		if (!nodes.some((n) => move.has(n.id))) return nodes;

		const moving = nodes.filter((n) => move.has(n.id));
		const rest = nodes.filter((n) => !move.has(n.id));
		if (to === "front") return [...rest, ...moving];
		if (to === "back") return [...moving, ...rest];

		const indices = nodes
			.map((n, i) => (move.has(n.id) ? i : -1))
			.filter((i) => i >= 0);
		const order = to === "forward" ? [...indices].reverse() : indices;
		for (const index of order) {
			const swap = to === "forward" ? index + 1 : index - 1;
			if (swap < 0 || swap >= nodes.length) continue;
			if (move.has(nodes[swap].id)) continue;
			[nodes[index], nodes[swap]] = [nodes[swap], nodes[index]];
		}
		return nodes;
	};

	return { ...scene, nodes: reorder(scene.nodes) };
}

/**
 * Moves a node anywhere in the tree.
 *
 * The node keeps the place it visibly occupies: its frame is snapshotted from
 * where it actually *is* — which under an automatic layout is where the solver
 * put it, not what the document stored — and rebased into the new parent. So
 * dragging something out of a layout leaves it exactly where it looked, and
 * dragging it in hands its position over to the container, which was going to
 * decide it anyway.
 *
 * `solved` is the geometry from the current universe. Without it a node leaving
 * a layout would jump back to whatever stale frame it was carrying.
 */
export function reparent(
	scene: Scene,
	id: string,
	parentId: string | null,
	index: number,
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	picks: Picks = {},
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node || parentId === id) return scene;
	// A node cannot be moved inside itself.
	if (parentId && subtreeIds(node).includes(parentId)) return scene;

	const context = sceneContext(scene, picks);
	const placed = placedNodes(scene.nodes, solved, context);
	const self = placed.find((p) => p.node.id === id);
	if (!self) return scene;

	let originX = 0;
	let originY = 0;
	if (parentId) {
		const parent = placed.find((p) => p.node.id === parentId);
		if (!parent || !KINDS[parent.node.kind].container) return scene;
		originX = parent.world.x;
		originY = parent.world.y;
	}

	const moved: SceneNode = withFrame(
		node,
		{
			x: self.world.x - originX,
			y: self.world.y - originY,
			width: self.world.width,
			height: self.world.height,
		},
		context,
	);

	const insert = (list: readonly SceneNode[]): SceneNode[] => {
		const out = [...list];
		out.splice(Math.max(0, Math.min(index, out.length)), 0, moved);
		return out;
	};

	const without = mapTree(scene.nodes, (n) => (n.id === id ? null : n));
	const nodes = parentId
		? mapTree(without, (n) =>
				n.id === parentId ? { ...n, children: insert(n.children ?? []) } : n,
			)
		: insert(without);

	return pruneConstraints({
		...scene,
		nodes: refreshGroups(nodes, context),
	});
}

/** Reorders within a node's own sibling list — a {@link reparent} that stays put. */
export function moveWithinParent(
	scene: Scene,
	id: string,
	index: number,
	picks: Picks = {},
): Scene {
	const found = locate(scene.nodes, id);
	if (!found) return scene;
	return reparent(scene, id, found.parent?.id ?? null, index, {}, picks);
}

function deepCopy(
	node: SceneNode,
	offset: number,
	context: ResolveContext,
): SceneNode {
	// The copy keeps every alternative the original had — a node with two
	// positions duplicates into a node with two positions — and only the one on
	// screen is nudged, so the offset lands where the eye can see it.
	//
	// Nudged *before* the id changes: which alternative a universe picked is
	// recorded against the original's variable key, and a fresh id has no pick
	// of its own, so writing after the rename would always land on the first.
	const nudged = withFrame(
		node,
		{
			x: frameDim(node, "x", context) + offset,
			y: frameDim(node, "y", context) + offset,
		},
		context,
	);
	return {
		...nudged,
		id: newNodeId(),
		props: { ...node.props },
		...(node.points ? { points: node.points.map((p) => ({ ...p })) } : {}),
		...(node.children
			? { children: node.children.map((c) => deepCopy(c, offset, context)) }
			: {}),
	};
}

/**
 * How far a copy is nudged off its original: sixteen pixels, as EMU.
 *
 * A statement about an eye rather than about a document — far enough that the
 * copy is visibly a second thing, near enough that it is obviously the same
 * thing — so it is a pixel count times {@link EMU_PER_PX}, like the hand-and-eye
 * constants in `geometry.ts`. Left as a bare 16 it would have been sixteen
 * ten-thousandths of a pixel, and duplicating would have looked like nothing
 * happening at all.
 */
export const DUPLICATE_OFFSET = 16 * EMU_PER_PX;

/** Copies subtrees, offset so the copies are visible, and reports their ids. */
export function duplicateNodes(
	scene: Scene,
	ids: readonly string[],
	offset = DUPLICATE_OFFSET,
	picks: Picks = {},
): { scene: Scene; ids: string[] } {
	const copy = new Set(ids);
	const created: string[] = [];
	const context = sceneContext(scene, picks);

	const walk = (list: readonly SceneNode[]): SceneNode[] => {
		const out: SceneNode[] = [];
		for (const node of list) {
			out.push(node.children ? { ...node, children: walk(node.children) } : node);
			if (copy.has(node.id)) {
				const clone = deepCopy(node, offset, context);
				created.push(clone.id);
				out.push(clone);
			}
		}
		return out;
	};

	return { scene: { ...scene, nodes: walk(scene.nodes) }, ids: created };
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/**
 * Wraps the selection in a new group.
 *
 * Only siblings can be grouped — a selection spanning different parents has no
 * single place to put the result — so the nodes sharing the frontmost node's
 * parent are taken and the rest are left alone. The group lands at the
 * frontmost member's position so grouping does not change what is on top.
 */
export function groupNodes(
	scene: Scene,
	ids: readonly string[],
	name = "Group",
	picks: Picks = {},
): { scene: Scene; id: string | null } {
	const wanted = new Set(ids);
	if (wanted.size < 1) return { scene, id: null };
	const context = sceneContext(scene, picks);

	// Pick the sibling list containing the frontmost selected node.
	let host: readonly SceneNode[] | null = null;
	let hostIndex = -1;
	for (const id of wanted) {
		const found = locate(scene.nodes, id);
		if (!found) continue;
		if (!host || found.index > hostIndex) {
			host = found.siblings;
			hostIndex = found.index;
		}
	}
	if (!host) return { scene, id: null };

	const members = host.filter((n) => wanted.has(n.id));
	if (members.length === 0) return { scene, id: null };

	const bounds = groupFrame(members, context);
	const group: SceneNode = {
		id: newNodeId(),
		kind: "group",
		name,
		frame: makeFrame(bounds),
		props: {},
		// Members become relative to the group's origin.
		children: members.map((m) =>
			withFrame(
				m,
				{
					x: frameDim(m, "x", context) - bounds.x,
					y: frameDim(m, "y", context) - bounds.y,
				},
				context,
			),
		),
	};

	const rebuild = (list: readonly SceneNode[]): SceneNode[] => {
		if (list === host) {
			const out: SceneNode[] = [];
			for (const node of list) {
				if (wanted.has(node.id)) continue;
				out.push(node.children ? { ...node, children: rebuild(node.children) } : node);
			}
			// Insert where the frontmost member was, counting only survivors.
			const before = list
				.slice(0, hostIndex)
				.filter((n) => !wanted.has(n.id)).length;
			out.splice(before, 0, group);
			return out;
		}
		return list.map((n) =>
			n.children ? { ...n, children: rebuild(n.children) } : n,
		);
	};

	return { scene: { ...scene, nodes: rebuild(scene.nodes) }, id: group.id };
}

/** Dissolves wrappers, splicing their children into the wrapper's place. */
export function ungroupNodes(
	scene: Scene,
	ids: readonly string[],
	picks: Picks = {},
): { scene: Scene; ids: string[] } {
	const wanted = new Set(ids);
	const freed: string[] = [];
	const context = sceneContext(scene, picks);

	const walk = (list: readonly SceneNode[]): SceneNode[] => {
		const out: SceneNode[] = [];
		for (const node of list) {
			const children = node.children ? walk(node.children) : undefined;
			if (wrapsChildren(node) && wanted.has(node.id) && children) {
				// Lift the children back into the wrapper's own coordinate space.
				for (const child of children) {
					out.push(
						withFrame(
							child,
							{
								x: frameDim(child, "x", context) + frameDim(node, "x", context),
								y: frameDim(child, "y", context) + frameDim(node, "y", context),
							},
							context,
						),
					);
					freed.push(child.id);
				}
				continue;
			}
			out.push(children ? { ...node, children } : node);
		}
		return out;
	};

	const nodes = refreshGroups(walk(scene.nodes), context);
	return { scene: { ...scene, nodes }, ids: freed };
}

/* ------------------------------------------------------------------ */
/* Automatic layout                                                    */
/* ------------------------------------------------------------------ */

/** Turns a container's children over to the solver, or takes them back. */
export function setLayout(
	scene: Scene,
	id: string,
	layout: AutoLayout | undefined,
): Scene {
	return {
		...scene,
		nodes: mapTree(scene.nodes, (node) => {
			if (node.id !== id) return node;
			if (!layout) {
				const { layout: _dropped, ...rest } = node;
				return rest;
			}
			return { ...node, layout };
		}),
	};
}

export function updateLayout(
	scene: Scene,
	id: string,
	patch: Partial<AutoLayout>,
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node?.layout) return scene;
	return setLayout(scene, id, { ...node.layout, ...patch });
}

/**
 * A child's own say in the layout above it — whether it grows, and where it
 * sits on the cross axis — or `undefined` to follow the container.
 *
 * Stored as nothing at all when it follows, so a document only carries the
 * children somebody deliberately singled out. One function for both because
 * they differ only by which entry of `LAYOUT_PROPS` they are.
 */
export function setChildLayout(
	scene: Scene,
	ids: readonly string[],
	prop: ChildProp,
	value: Value | undefined,
): Scene {
	const touch = new Set(ids);
	return {
		...scene,
		nodes: mapTree(scene.nodes, (node) => {
			if (!touch.has(node.id)) return node;
			if (!value || value.length === 0) {
				const { [prop]: _dropped, ...rest } = node;
				return rest;
			}
			return { ...node, [prop]: value };
		}),
	};
}

/**
 * Whether a node sizes itself to its content — see `measure.ts`.
 *
 * Automatic is the default and is stored as nothing at all, so a document only
 * carries the boxes somebody deliberately pinned.
 */
export function setSizing(
	scene: Scene,
	ids: readonly string[],
	sizing: Sizing,
): Scene {
	const touch = new Set(ids);
	return {
		...scene,
		nodes: mapTree(scene.nodes, (node) => {
			if (!touch.has(node.id)) return node;
			if (sizing !== "fixed") {
				const { sizing: _dropped, ...rest } = node;
				return rest;
			}
			return { ...node, sizing };
		}),
	};
}

/**
 * Wraps a selection in a frame that lays them out.
 *
 * The frame takes the selection's bounds, so the result starts where the
 * loose objects already were and only then begins arranging them.
 */
export function wrapInLayout(
	scene: Scene,
	ids: readonly string[],
	picks: Picks = {},
): { scene: Scene; id: string | null } {
	const grouped = groupNodes(scene, ids, "Layout", picks);
	if (!grouped.id) return { scene, id: null };
	const withLayout = mapTree(grouped.scene.nodes, (node) =>
		node.id !== grouped.id
			? node
			: {
					...node,
					kind: "frame" as const,
					name: "Layout",
					props: { ...KINDS.frame.defaults },
					layout: makeLayout(),
				},
	);
	return { scene: { ...grouped.scene, nodes: withLayout }, id: grouped.id };
}

/* ------------------------------------------------------------------ */
/* Guides: the grid a surface is ruled with, and the lines drawn on it */
/* ------------------------------------------------------------------ */

/**
 * Rules a surface with a grid, or takes the grid away.
 *
 * The twin of {@link setLayout}, down to the shape of the argument, because
 * absence means the same thing in both: a node with no `guides` has no grid at
 * all rather than a grid of one track, and there is no flag to keep in step.
 *
 * Taking one away prunes, and that is the half worth naming. A column line is a
 * constraint member that lives nowhere in the tree, so a rule holding a card to
 * `cg(page,3,left)` is left pointing at a line that no longer exists — the same
 * ghost {@link deleteNodes} refuses to leave behind, reached from the other
 * direction. See {@link holdsDatum}, which is the question the prune asks.
 */
export function setGuides(
	scene: Scene,
	id: string,
	guides: SurfaceGuides | undefined,
): Scene {
	return pruneConstraints({
		...scene,
		nodes: mapTree(scene.nodes, (node) => {
			if (node.id !== id) return node;
			if (!guides) {
				const { guides: _dropped, ...rest } = node;
				return rest;
			}
			return { ...node, guides };
		}),
	});
}

/** One or more grid settings replaced, on a surface that already has a grid. */
export function updateGuides(
	scene: Scene,
	id: string,
	patch: Partial<SurfaceGuides>,
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node?.guides) return scene;
	return setGuides(scene, id, { ...node.guides, ...patch });
}

/**
 * One setting's whole list of alternatives — the panel's edit, and the one that
 * makes a grid responsive.
 *
 * {@link setFrameValue} for a guide setting, and it is the only edit here that
 * changes how *many* grids the document holds: giving `columns` a second
 * alternative is what makes twelve-wide and six-wide one document rather than
 * two.
 */
export function setGuideValue(
	scene: Scene,
	id: string,
	prop: GuideProp,
	value: Value,
): Scene {
	if (value.length === 0) return scene;
	return updateGuides(scene, id, { [prop]: value });
}

/**
 * One node in the tree replaced, if the document holds it — and the document
 * itself back untouched when the replacement is the node it replaces.
 *
 * The identity is load-bearing for the gestures below in the way it is for
 * `withFrame`: a drag that ended where it began must not write an edit, and the
 * cheapest way to be sure of that is for "nothing changed" to be answerable by
 * `===` all the way up.
 */
function mapNode(
	scene: Scene,
	id: string,
	fn: (node: SceneNode) => SceneNode,
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node) return scene;
	const next = fn(node);
	if (next === node) return scene;
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) => (n.id === id ? next : n)),
	};
}

/** The lines of one surface rewritten; an empty list is stored as no list. */
function withLines(node: SceneNode, lines: readonly Guide[]): SceneNode {
	if (lines.length === 0) {
		const { lines: _dropped, ...rest } = node;
		return rest;
	}
	return { ...node, lines: [...lines] };
}

/**
 * Draws a line on a surface, at `at` in that surface's own coordinates.
 *
 * A gesture, so the position goes through {@link dimension} — quantized to a
 * whole pixel and spelled in the document's display unit, exactly as a drag
 * writes a frame. This is one of the few writers that *can* honour
 * {@link Scene.unit} for a brand-new length, because unlike `makeFrame` it has
 * the document in hand: a guide pulled onto a millimetre page is written in
 * millimetres.
 *
 * The id comes from {@link nextGuideId} rather than from a counter here, because
 * what a guide id has to be — spellable as an ASP constant, unused *on this
 * surface* — are facts about the document rather than about this edit.
 *
 * Nothing at all for a node that is not a surface: a guide is a line on a page,
 * and hanging one off a rectangle would put a datum in the document that the
 * compiler declines to emit and the overlay declines to draw.
 */
export function addGuide(
	scene: Scene,
	surface: string,
	axis: "x" | "y",
	at: Emu,
): { scene: Scene; id: string | null } {
	const node = findInTree(scene.nodes, surface);
	if (!node || !KINDS[node.kind].surface) return { scene, id: null };
	const id = nextGuideId(node);
	const guide: Guide = {
		id,
		axis,
		at: dimension(at, scene.unit ?? DEFAULT_UNIT),
	};
	return {
		scene: mapNode(scene, surface, (n) =>
			withLines(n, [...guideLines(n), guide]),
		),
		id,
	};
}

/**
 * A line dropped on the design, at a point in **canvas** coordinates.
 *
 * What a ruler's drag ends in. The ruler knows where the pointer is and nothing
 * about what is under it, and this is the half that is a question about the
 * document: which page the line belongs to, and where on that page. `frameAt`
 * answers the first — the innermost surface under the drop, the same answer a
 * newly drawn node gets — and the second is then the drop less that surface's
 * own origin.
 *
 * Dropped where there is no surface, nothing is drawn. A guide has to belong to
 * something: in world coordinates it would be the one piece of geometry that did
 * not move when the artboard beside it moved, and "the guide I put on this page"
 * is what a designer means every time. That is the pasteboard guide of a
 * page-layout tool, and it is deliberately absent until there is a page model
 * for one to be beside.
 */
export function drawGuideAt(
	scene: Scene,
	axis: "x" | "y",
	at: Point,
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	picks: Picks = {},
): { scene: Scene; id: string | null } {
	const host = frameAt(scene.nodes, at, solved, sceneContext(scene, picks));
	if (!host) return { scene, id: null };
	return addGuide(
		scene,
		host.node.id,
		axis,
		axis === "x" ? at.x - host.world.x : at.y - host.world.y,
	);
}

/**
 * A line dragged somewhere else, in its surface's own coordinates.
 *
 * `picks` is the universe on screen, for the reason {@link setFrames} takes one:
 * a guide's position is a value like any other, so the write lands on the
 * alternative that universe chose. The refusals — a locked line, a position that
 * is a link to a token — are {@link withGuideAt}'s, so that every road to moving
 * a guide passes the same gate.
 */
export function moveGuide(
	scene: Scene,
	surface: string,
	guide: string,
	at: Emu,
	picks: Picks = {},
): Scene {
	const context = sceneContext(scene, picks);
	return mapNode(scene, surface, (node) => {
		const line = findGuide(node, guide);
		if (!line) return node;
		const next = withGuideAt(node, line, at, context);
		return next === line
			? node
			: withLines(
					node,
					guideLines(node).map((g) => (g.id === guide ? next : g)),
				);
	});
}

/**
 * A line's whole list of positions — what a typed number or a link to a token
 * writes, where {@link moveGuide} is what a hand writes.
 *
 * The same split {@link setFrameValue} and `withFrame` make, and the same
 * reason: a value typed into a field is a statement about every universe, and a
 * drag is an adjustment to the one on screen.
 */
export function setGuideAt(
	scene: Scene,
	surface: string,
	guide: string,
	value: Value,
): Scene {
	if (value.length === 0) return scene;
	return mapNode(scene, surface, (node) =>
		withLines(
			node,
			guideLines(node).map((g) => (g.id === guide ? { ...g, at: value } : g)),
		),
	);
}

/**
 * Whether a gesture may move this line.
 *
 * Stored as nothing at all when it may, so a document only carries the lines
 * somebody deliberately pinned down — the same shape {@link setSizing} and
 * {@link setChildLayout} use for their defaults.
 *
 * A lock is a decision about the *guide* and so it lives in the document and
 * reaches a collaborator; whether guides are *shown* is a decision about the
 * person looking and never gets near here.
 */
export function setGuideLocked(
	scene: Scene,
	surface: string,
	guide: string,
	locked: boolean,
): Scene {
	return mapNode(scene, surface, (node) =>
		withLines(
			node,
			guideLines(node).map((g) => {
				if (g.id !== guide) return g;
				if (!locked) {
					const { locked: _dropped, ...rest } = g;
					return rest;
				}
				return { ...g, locked: true };
			}),
		),
	);
}

/**
 * Rubs a line out, and with it any rule that was only holding something to it.
 *
 * The prune is the same one {@link setGuides} runs and for the same reason: a
 * datum is a constraint member with nothing in the tree behind it, so deleting
 * the line is the only moment anything can notice that a rule naming it has
 * been left pointing at nothing.
 */
export function removeGuide(
	scene: Scene,
	surface: string,
	guide: string,
): Scene {
	return pruneConstraints(
		mapNode(scene, surface, (node) =>
			withLines(
				node,
				guideLines(node).filter((g) => g.id !== guide),
			),
		),
	);
}

/* ------------------------------------------------------------------ */
/* Constraints                                                         */
/* ------------------------------------------------------------------ */

/**
 * Adds a constraint over the given nodes.
 *
 * The property defaults to one the nodes actually have, because a constraint
 * on a property nothing exposes is silently vacuous — the sort of thing that
 * looks like a solver bug from the outside. A geometric one defaults to the
 * number the design is already at, for the same reason in reverse: adding a
 * rule should say what is true, not yank the layout somewhere new.
 */
export function addConstraint(
	scene: Scene,
	kind: ConstraintKind,
	nodes: readonly string[],
	prop?: PropName,
	edge?: Edge,
	/** A set a rule named, ranged over instead of `nodes`. */
	group?: string,
): { scene: Scene; id: string } {
	const constraint: Constraint = {
		id: newNodeId().replace("n_", "k_"),
		enabled: true,
		...shapeFor(scene, kind, nodes, {
			prop: prop ?? sharedProps(scene, nodes)[0] ?? "fill",
			edge,
			group,
		}),
	};
	return {
		scene: { ...scene, constraints: [...scene.constraints, constraint] },
		id: constraint.id,
	};
}

/**
 * The rule that already holds this node's edge to this line, if the document
 * has one.
 *
 * Switched off counts as said. A rule that is off is not why the node is where
 * it is — but the answer to "you have already written this one, it is turned
 * off" is to turn it back on in the Rules panel, and a second identical rule
 * beside the first is the worse of the two outcomes by a distance.
 */
export function pinnedTo(
	scene: Scene,
	node: string,
	term: string,
	edge: Edge,
): string | undefined {
	return scene.constraints.find(
		(c) =>
			c.kind === "align" &&
			c.edge === edge &&
			c.group === undefined &&
			c.nodes.length === 2 &&
			c.nodes.includes(node) &&
			c.nodes.includes(term),
	)?.id;
}

/**
 * **Turns a snap into a rule**, which is the whole reason a column line is a
 * datum rather than a hint drawn on the glass.
 *
 * Dropping a card against column three lines it up once. Saying so makes it
 * stay lined up: the count changes, a token moves, a whole responsive
 * alternative is chosen, and the card is still on column three — and the rule
 * has a name, a switch, a place in an unsat core and a sentence in the why
 * panel, because it is an ordinary `align` and nothing about it is special.
 *
 * `align` is the kind because `align` forces the *same* edge on both members,
 * and a datum's six edges coincide — so an align on `left` puts the card's left
 * edge on the line and one on `centerX` puts its centre there, off the same
 * number. Which of those it is comes from the edge the gesture actually caught,
 * so what gets written is what the designer just did rather than a guess.
 *
 * Already said is left alone, and the existing rule's id comes back: a drag that
 * lands on the same line twice is one rule, not a pile of them.
 */
export function pinToDatum(
	scene: Scene,
	node: string,
	term: string,
	edge: Edge,
): { scene: Scene; id: string | null } {
	const already = pinnedTo(scene, node, term, edge);
	if (already) return { scene, id: already };
	if (!holdsDatum(scene, term) || !findInTree(scene.nodes, node)) {
		return { scene, id: null };
	}
	return addConstraint(scene, "align", [node, term], undefined, edge);
}

/**
 * Why `name` cannot be a constraint id, in words, or nothing if it can.
 *
 * A constraint id is not an opaque handle — see {@link Constraint.id} — and for
 * a `custom` rule it is the term the user writes in `viol(...)`, so the two
 * things that must hold are that ASP can spell it and that no other rule has
 * claimed it. Returned as a message rather than a boolean because both refusals
 * are things a person has to be told.
 */
export function constraintTermError(
	scene: Scene,
	name: string,
	/** The constraint being renamed, which is allowed to keep its own name. */
	self?: string,
): string | undefined {
	if (!isConstraintTerm(name)) {
		return "A rule name must start with a lowercase letter and use only letters, digits and underscores.";
	}
	if (scene.constraints.some((c) => c.id === name && c.id !== self)) {
		return `Another rule is already called ${name}.`;
	}
	return undefined;
}

/**
 * Adds a rule whose condition the user writes themselves.
 *
 * The name is the whole of the argument list because it is the whole of the
 * constraint: no members, no property, no edge — see
 * `CONSTRAINT_KINDS.custom` — and the id is what the hand-written
 * `viol(...)` has to say. Null when the name cannot be used, with the document
 * untouched; ask {@link constraintTermError} first to say why.
 */
export function addCustomConstraint(
	scene: Scene,
	name?: string,
): { scene: Scene; id: string | null } {
	const term =
		name ??
		// `rule`, `rule_2`, … — readable, because this one is read: it is what
		// the user types into their own rule and what a core blames.
		uniqueName(scene.constraints.map((c) => c.id), "rule", "_");
	if (constraintTermError(scene, term) !== undefined) return { scene, id: null };
	const added = addConstraint(scene, "custom", []);
	// Added under a generated id and renamed, rather than minted with the term:
	// one place owns what a legal id is and what happens to the rules that
	// mention the old one — here there are none, so nothing is rewritten.
	return { scene: renameConstraint(added.scene, added.id, term).scene, id: term };
}

/**
 * Changes the term a constraint reaches ASP as, carrying the user's rules with
 * it.
 *
 * This is the one edit that can break something the document does not contain.
 * A `custom` rule's condition lives in the Rules panel as `viol(old_name) :-
 * ...`, and renaming the constraint without touching that text would leave a
 * rule that still grounds, still has a head, and is simply never guarded again
 * — a switch that quietly stopped doing anything. So the rename rewrites
 * `viol(old)` to `viol(new)` wherever the rules say it, and reports how many it
 * changed.
 *
 * `rewritten` is the signal, and 0 is worth showing: either the rule has not
 * been written yet, or the name is reached some other way — `viol(C) :-
 * mine(C).` — and that indirection is now pointing at a name nothing holds.
 *
 * `active(old)` moves too, because a rule may read its own switch in a *body*
 * to keep itself from grounding at all when it is off — which is what the map
 * template does, and how an unused requirement costs nothing there. Left
 * behind, that one is worse than an orphaned `viol`: the rule under it never
 * grounds, so the requirement is not broken but *vacuously satisfied*, and a
 * generator quietly stops generating what you asked for.
 *
 * Deliberately narrow either way: only the argument of a `viol/1` or an
 * `active/1`, not every occurrence of the word. A whole-token substitution
 * across arbitrary ASP would also rewrite a predicate or a constant that
 * happened to share the name, and corrupting the user's rules is worse than
 * leaving a comment out of date.
 */
export function renameConstraint(
	scene: Scene,
	id: string,
	name: string,
): { scene: Scene; rewritten: number } {
	if (name === id) return { scene, rewritten: 0 };
	if (!scene.constraints.some((c) => c.id === id)) return { scene, rewritten: 0 };
	if (constraintTermError(scene, name, id) !== undefined) {
		return { scene, rewritten: 0 };
	}
	let rewritten = 0;
	const rules = scene.rules.replace(mentionPattern(id), (_, head: string) => {
		rewritten += 1;
		return `${head}(${name})`;
	});
	return {
		scene: {
			...scene,
			rules,
			constraints: scene.constraints.map((c) =>
				c.id === id ? { ...c, id: name } : c,
			),
		},
		rewritten,
	};
}

/**
 * Where the user's rules name a constraint, with the whitespace a person types.
 *
 * Two predicates take a constraint's own term as an argument: `viol/1`, the
 * violation condition, and `active/1`, the switch — which a rule may read in a
 * body to stay unground while it is off. One definition for both, because a
 * rename has to carry both.
 *
 * The lookbehind is the whole reason this is a function and not a literal:
 * without it `inactive(gap)` would read as a mention of `gap`'s switch.
 */
const mentionPattern = (id: string, of = "viol|active"): RegExp =>
	new RegExp(`(?<![A-Za-z0-9_])(${of})\\(\\s*${escapeTerm(id)}\\s*\\)`, "g");

/**
 * How many times the user's rules say `viol(id)`.
 *
 * The cheapest honest answer to "has this rule been written yet?": a substring
 * search rather than a solve, and honest only about what it measures. A rule
 * reached indirectly — `viol(C) :- mine(C).` — counts zero here and still
 * fires, so zero means "nothing here names it", never "it is broken". Which is
 * the same thing `renameConstraint`'s `rewritten: 0` is warning about.
 *
 * Only `viol/1`, where the rename carries `active/1` as well: reading a switch
 * is not writing a rule, so a document that guards on `active(gap)` and never
 * says `viol(gap)` has not written that rule yet and the panel should say so.
 * The two sets may differ, but only in the safe direction — what the rename
 * moves is a superset of what the panel calls written, so the panel can never
 * call a rule written that the rename would then orphan.
 */
export const violRefs = (rules: string, id: string): number =>
	rules.match(mentionPattern(id, "viol"))?.length ?? 0;

/**
 * A legal id needs no escaping, but an id from a document nobody validated
 * might, and a stray metacharacter must not turn the rewrite into a wildcard.
 */
const escapeTerm = (term: string): string =>
	term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Even gaps down a run of nodes.
 *
 * Every other tool distributes by *moving* things once; this one states the
 * relation and leaves it stated, so the run stays even when one of them is
 * later resized. It is a gap between each neighbouring pair rather than a kind
 * of its own: n-1 ordinary constraints, each editable, each nameable in a core.
 *
 * The distance is the average of the gaps already there, so the run neither
 * grows nor shrinks the moment it is evened up.
 */
export function distributeNodes(
	scene: Scene,
	nodes: readonly string[],
	axis?: "x" | "y",
): { scene: Scene; ids: string[] } {
	const on =
		axis ?? EDGES[quietestEdge(scene, CONSTRAINT_KINDS.gap, nodes)].axis;
	const lead = edgeOn(on, "lead");
	const trail = edgeOn(on, "trail");
	// Tokens resolved, picks not: seeding runs before any universe is chosen, so
	// a dimension with alternatives is measured at its first — the same
	// approximation `naturalSize` already makes for a varying gap.
	const context = sceneContext(scene);
	const at = (id: string, edge: Edge) =>
		edgeAt(scene.nodes, id, edge, context) ?? 0;
	const order = nodes
		.filter((id) => findInTree(scene.nodes, id) !== undefined)
		.sort((a, b) => at(a, lead) - at(b, lead));
	// Two nodes have one gap, and one gap is already even.
	if (order.length < 3) return { scene, ids: [] };

	let total = 0;
	for (let i = 1; i < order.length; i++) {
		total += at(order[i], lead) - at(order[i - 1], trail);
	}
	const value = Math.round(total / (order.length - 1));

	let next = scene;
	const ids: string[] = [];
	for (let i = 1; i < order.length; i++) {
		const added = addConstraint(
			next,
			"gap",
			[order[i - 1], order[i]],
			undefined,
			on,
		);
		next = updateConstraint(added.scene, added.id, { value: dimension(value) });
		ids.push(added.id);
	}
	return { scene: next, ids };
}

/**
 * Changes what a constraint is *about*, re-seeding whatever the new shape
 * needs.
 *
 * Not `updateConstraint`, because these two fields decide which of the others
 * mean anything: a `differ` turned into a `pin` has no edge and no value yet,
 * and defaulting them silently would slam the node to zero. A change of edge
 * re-seeds for the same reason — 24px of horizontal gap says nothing about a
 * vertical one.
 */
export function retargetConstraint(
	scene: Scene,
	id: string,
	/**
	 * `group` present and undefined means "back to the listed members"; absent
	 * means "leave whichever it ranges over alone".
	 */
	patch: { kind?: ConstraintKind; edge?: Edge; group?: string },
): Scene {
	const current = scene.constraints.find((c) => c.id === id);
	if (!current) return scene;
	const next: Constraint = {
		id: current.id,
		enabled: current.enabled,
		// Kept, like the switch and for the same reason: how firmly a rule holds
		// is a fact about that rule, not about its kind. Turning "these must
		// differ" into "these must line up" is a change of subject, and losing
		// "prefer" on the way through would be a silent change of strength.
		...(current.strength === undefined ? {} : { strength: current.strength }),
		...(current.weight === undefined ? {} : { weight: current.weight }),
		// Rebuilt rather than patched, so a field the new kind never reads is
		// gone from the document instead of lingering as dead data.
		...shapeFor(scene, patch.kind ?? current.kind, current.nodes, {
			prop: current.prop,
			edge: patch.edge ?? current.edge,
			limit: current.limit,
			group: "group" in patch ? patch.group : current.group,
		}),
	};
	return {
		...scene,
		constraints: scene.constraints.map((c) => (c.id === id ? next : c)),
	};
}

/** Everything about a constraint that follows from its kind. */
function shapeFor(
	scene: Scene,
	kind: ConstraintKind,
	nodes: readonly string[],
	from: { prop: PropName; edge?: Edge; limit?: number; group?: string },
): Omit<Constraint, "id" | "enabled"> {
	const spec = CONSTRAINT_KINDS[kind];
	// Extra members would have nowhere to go: a gap has two sides, a pin one
	// subject.
	const members = nodes.slice(0, spec.maxNodes);
	const kept = from.edge && spec.edges.includes(from.edge) ? from.edge : undefined;
	const edge = kept ?? quietestEdge(scene, spec, members);
	// A kind that reads its members by position cannot take a set, so becoming
	// one drops the group rather than keeping it as dead data — and the listed
	// members, which were never thrown away, are what it falls back to.
	const group = from.group !== undefined && rangesOverGroup(kind) ? from.group : undefined;
	return {
		kind,
		prop: from.prop,
		nodes: [...members],
		...(group === undefined ? {} : { group }),
		...(spec.counted ? { limit: from.limit ?? 1 } : {}),
		...(spec.geometric ? { edge } : {}),
		...(spec.valueType
			? { value: dimension(currentValue(scene, spec, members, edge)) }
			: {}),
	};
}

/**
 * The edge a new constraint should be about, if nobody said.
 *
 * The one that moves the design least, which for the kinds that name a place
 * or a size is the quantity the members already agree on most closely: two
 * boxes side by side get their tops aligned, not their left edges yanked
 * together. A valued kind seeds itself instead, so any of its edges changes
 * nothing and the axis is chosen for legibility — the one the members are
 * actually strung out along.
 */
function quietestEdge(
	scene: Scene,
	spec: ConstraintSpec,
	nodes: readonly string[],
): Edge {
	let best = spec.edges[0];
	let least = Number.POSITIVE_INFINITY;
	for (const edge of spec.edges) {
		const spread = spreadOf(scene, nodes, edge);
		if (spread < least) {
			least = spread;
			best = edge;
		}
	}
	return best;
}

/**
 * How far apart the members are on one edge.
 *
 * Negated for a whole axis, where being strung out along it is exactly what
 * makes it the right one to measure: a gap belongs on the axis the boxes are
 * separated on, not the one they overlap on.
 */
function spreadOf(scene: Scene, nodes: readonly string[], edge: Edge): number {
	const spec = EDGES[edge];
	const of = spec.role === "axis" ? edgeOn(spec.axis, "mid") : edge;
	const values = nodes
		.map((id) => edgeAt(scene.nodes, id, of, sceneContext(scene)))
		.filter((v): v is number => v !== undefined);
	if (values.length < 2) return 0;
	const spread = Math.max(...values) - Math.min(...values);
	return spec.role === "axis" ? -spread : spread;
}

/**
 * What a valued geometric kind measures right now, so it starts satisfied.
 *
 * The weighted sum comes out of the kind's own table entry, so a new kind
 * seeds itself by describing what it measures rather than by adding a case.
 */
function currentValue(
	scene: Scene,
	spec: ConstraintSpec,
	nodes: readonly string[],
	edge: Edge,
): number {
	const axis = EDGES[edge].axis;
	let total = 0;
	for (const term of spec.seed) {
		const id = nodes[term.slot - 1];
		const at =
			id === undefined
				? undefined
				: edgeAt(
						scene.nodes,
						id,
						term.place === "self" ? edge : edgeOn(axis, term.place),
						sceneContext(scene),
					);
		if (at === undefined) return 0;
		total += term.weight * at;
	}
	return total;
}

export function updateConstraint(
	scene: Scene,
	id: string,
	patch: Partial<Omit<Constraint, "id">>,
): Scene {
	return {
		...scene,
		constraints: scene.constraints.map((c) =>
			c.id === id ? { ...c, ...patch } : c,
		),
	};
}

export function deleteConstraint(scene: Scene, id: string): Scene {
	return { ...scene, constraints: scene.constraints.filter((c) => c.id !== id) };
}

/** Properties every one of `nodes` exposes — the ones worth constraining. */
export function sharedProps(
	scene: Scene,
	nodes: readonly string[],
): PropName[] {
	const found = nodes
		.map((id) => findInTree(scene.nodes, id))
		.filter((n): n is SceneNode => n !== undefined);
	return sharedPropsOfKinds(found.map((n) => n.kind));
}

/**
 * Drops constraints that no longer refer to enough live nodes.
 *
 * Deleting a node must not leave a constraint quietly ranging over a ghost:
 * it would either do nothing or, worse, still be listed as the reason a design
 * is impossible.
 *
 * A member is not necessarily a node. A guide and a column line are {@link
 * holdsDatum} members with no entry in the tree — so the live set is the nodes
 * *or* a datum the document still holds, and without the second half the first
 * node anybody deleted would strip every datum out of every rule, taking the
 * whole rule with it wherever that dropped it below `minNodes`.
 *
 * A **state copy** is the third such member, and it had to be added here for
 * exactly the same reason with a sharper edge. `stt(b1,hover,label)` is neither
 * a node nor a datum, so without {@link holdsStateCopy} the next call to this —
 * from `deleteNodes`, `groupNodes`, `setGuides` or `removeGuide`, none of which
 * has anything to do with the machine — would quietly strip every cross-state
 * rule of its members and then delete the rule for falling below `minNodes`. "The
 * label does not jump when you hover" would disappear because somebody deleted
 * an unrelated rectangle.
 *
 * `holdsStateCopy` is blunt on purpose, as `holdsDatum` is about a track index:
 * it asks whether the instance exists and its machine has that state, not whether
 * the *copy* currently exists. Asking the sharper question would delete the rule
 * the moment a designer cleared the delta that made the part materialise, and
 * getting it back would mean retyping the rule rather than the delta.
 *
 * An **instance part** — `inst(b1,label)` — is the fourth, and it is the oldest
 * hole of the four: it was never a node either, and a rule naming one has always
 * been stripped and then deleted by the next unrelated delete. Nothing hit it
 * because nothing offered such a member; the canvas selects an instance, not its
 * parts. States are what made it reachable — `materializedParts` treats the part,
 * the instance's copy and one state's copy as three spellings of the same
 * request, so the two spellings a designer is now offered side by side had better
 * survive a delete side by side. {@link holdsInstancePart} is blunt in the same
 * way its three siblings are.
 */
export function pruneConstraints(scene: Scene): Scene {
	const alive = new Set(flatten(scene.nodes).map((n) => n.id));
	const next: Constraint[] = [];
	for (const c of scene.constraints) {
		const nodes = c.nodes.filter(
			(id) =>
				alive.has(id) ||
				holdsDatum(scene, id) ||
				holdsStateCopy(scene, id) ||
				holdsInstancePart(scene, id),
		);
		// A group's members are the rule's business: deleting a document node
		// says nothing about them, and a constraint over one is never a ghost.
		if (c.group === undefined && nodes.length < CONSTRAINT_KINDS[c.kind].minNodes) {
			continue;
		}
		next.push(nodes.length === c.nodes.length ? c : { ...c, nodes });
	}
	return next.length === scene.constraints.length &&
		next.every((c, i) => c === scene.constraints[i])
		? scene
		: { ...scene, constraints: next };
}

/* ------------------------------------------------------------------ */
/* The document's unit                                                 */
/* ------------------------------------------------------------------ */

/**
 * What this document is measured in — see {@link Scene.unit}.
 *
 * A display setting, so this changes nothing about what any stored length
 * *means*: `"16px"` is 152400 EMU in a millimetre document exactly as it is in
 * a pixel one. What it changes is what the inspector reads values out in, what
 * a number typed with no suffix beside it means, and what a length nobody has
 * spelled yet is written in.
 *
 * The only writer besides `normalizeScene`, and unlike that one it can never
 * take the field away: an absent unit is the marker that says a document
 * predates EMU and its path vertices are still pixels, and a document that
 * could lose the stamp is a document that gets migrated twice.
 */
export function setUnit(scene: Scene, unit: Unit): Scene {
	return scene.unit === unit ? scene : { ...scene, unit };
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

export function addToken(scene: Scene, type: ValueType, value?: Value): {
	scene: Scene;
	id: string;
} {
	const token: Token = {
		id: newNodeId().replace("n_", "t_"),
		// Names must be unique within the document, so references stay readable.
		name: uniqueName(scene.tokens.map((t) => t.name), type, "-"),
		type,
		value: value ?? [lit(VALUE_TYPES[type].fallback)],
	};
	return { scene: { ...scene, tokens: [...scene.tokens, token] }, id: token.id };
}

export function renameToken(scene: Scene, id: string, name: string): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return {
		...scene,
		tokens: scene.tokens.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
	};
}

/**
 * Replaces a token's value.
 *
 * A value that would make the token reference itself is rejected, so a cycle
 * can never be stored — resolution would silently yield nothing.
 */
export function setTokenValue(scene: Scene, id: string, value: Value): Scene {
	if (value.length === 0) return scene;
	if (wouldCycle(scene.tokens, id, value)) return scene;
	return {
		...scene,
		tokens: scene.tokens.map((t) => (t.id === id ? { ...t, value } : t)),
	};
}

/**
 * Deletes a token and repairs anything that referenced it, substituting the
 * literal it currently resolves to so the design does not visibly change.
 */
export function deleteToken(scene: Scene, id: string): Scene {
	const token = scene.tokens.find((t) => t.id === id);
	if (!token) return scene;
	const frozen = resolveValue({ tokens: scene.tokens, picks: {} }, token.value, tokenVar(id));

	const repair = (value: Value): Value =>
		value.map((term) =>
			term.kind === "token" && term.token === id
				? lit(frozen ?? VALUE_TYPES[token.type].fallback)
				: term,
		);

	return {
		...scene,
		tokens: scene.tokens
			.filter((t) => t.id !== id)
			.map((t) => ({ ...t, value: repair(t.value) })),
		nodes: mapTree(scene.nodes, (node) => {
			const props: SceneNode["props"] = {};
			for (const [prop, value] of Object.entries(node.props)) {
				if (value) props[prop as PropName] = repair(value);
			}
			// A dimension is a value, so it can hold the reference too — a
			// position driven by a `length` token is the whole point of one.
			const frame = { ...node.frame };
			for (const dim of DIMENSIONS) frame[dim] = repair(frame[dim]);
			return { ...node, props, frame };
		}),
	};
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

/**
 * A fresh style, with one empty variant.
 *
 * One rather than two, and empty rather than seeded: a style begins as the
 * ordinary named bundle every other tool has, and becomes a design space the
 * moment somebody adds a second variant. Starting with two would be asserting a
 * correlation nobody has stated yet.
 *
 * The id has to be spellable as an ASP constant, because `sty(S)` is a term in
 * the generated program and in every answer set. Generated rather than typed,
 * so unlike a constraint id there is nothing for the user to get wrong; the
 * *name* is what they type, and it is unique for the same reason a token's is.
 */
export function addStyle(
	scene: Scene,
	options: { name?: string; variants?: StyleVariant[] } = {},
): { scene: Scene; id: string } {
	const style: Style = {
		id: newNodeId().replace("n_", "s_"),
		name: uniqueName(
			scene.styles.map((s) => s.name),
			options.name?.trim() || "style",
			"-",
		),
		variants:
			options.variants && options.variants.length > 0
				? options.variants
				: [{ parts: {} }],
	};
	return { scene: { ...scene, styles: [...scene.styles, style] }, id: style.id };
}

/** Replaces one style, if the document holds it. */
function mapStyle(scene: Scene, id: string, fn: (style: Style) => Style): Scene {
	const styles = scene.styles.map((s) => (s.id === id ? fn(s) : s));
	return styles.some((s, i) => s !== scene.styles[i]) ? { ...scene, styles } : scene;
}

export function renameStyle(scene: Scene, id: string, name: string): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return mapStyle(scene, id, (s) => ({ ...s, name: trimmed }));
}

/**
 * Sets — or clears — one field of one variant.
 *
 * A {@link Term} rather than a {@link Value}, and that is the type doing the
 * arguing: a variant is *one* answer per property, because a list of
 * alternatives here would branch on its own and reintroduce the cross product
 * the style exists to collapse. Somebody who wants a size that varies
 * independently of the weight already has tokens for that.
 *
 * Clearing is how a variant says nothing about a property, which is not the
 * same as saying the fallback: the wearer then keeps whatever it holds itself.
 */
export function setStylePart(
	scene: Scene,
	id: string,
	variant: number,
	prop: PropName,
	term: Term | undefined,
): Scene {
	if (!PROPS[prop].styleable) return scene;
	return mapStyle(scene, id, (style) => {
		if (variant < 0 || variant >= style.variants.length) return style;
		const current = style.variants[variant];
		if (current.parts[prop] === term) return style;
		const parts = { ...current.parts };
		if (term === undefined) delete parts[prop];
		else parts[prop] = term;
		return {
			...style,
			variants: style.variants.map((v, i) =>
				i === variant ? { ...v, parts } : v,
			),
		};
	});
}

export function renameStyleVariant(
	scene: Scene,
	id: string,
	variant: number,
	name: string,
): Scene {
	return mapStyle(scene, id, (style) =>
		variant < 0 || variant >= style.variants.length
			? style
			: {
					...style,
					variants: style.variants.map((v, i) =>
						i === variant ? { ...v, name: name.trim() } : v,
					),
				},
	);
}

/**
 * Adds a variant, copied from an existing one.
 *
 * A copy rather than a blank, because that is how the correlation gets stated:
 * you duplicate the treatment you have and change the two fields that differ.
 * A blank second variant would mean "or say nothing at all", which is a real
 * thing to want and one clearing every field of the copy expresses.
 */
export function addStyleVariant(scene: Scene, id: string, from?: number): Scene {
	return mapStyle(scene, id, (style) => {
		const source =
			style.variants[from ?? style.variants.length - 1] ?? { parts: {} };
		return {
			...style,
			variants: [
				...style.variants,
				{ parts: { ...source.parts } },
			],
		};
	});
}

/**
 * Removes a variant. The last one stays: a style with none is a variable with
 * no alternatives, which is not a degenerate design space but an impossible
 * document — see `compile`, which drops such a style rather than emit it.
 *
 * Deleting from the middle renumbers everything after it, and indices are what
 * a pin and an instance's held picks are counted in. Nothing is repaired here,
 * for the same reason nothing is repaired when an alternative is deleted from a
 * token: a pin is a question about the universe on screen, not a reference.
 */
export function deleteStyleVariant(
	scene: Scene,
	id: string,
	variant: number,
): Scene {
	return mapStyle(scene, id, (style) =>
		style.variants.length <= 1 || variant < 0 || variant >= style.variants.length
			? style
			: { ...style, variants: style.variants.filter((_, i) => i !== variant) },
	);
}

/**
 * Puts a style on some nodes, or takes it off with `undefined`.
 *
 * Nothing is copied into the nodes and nothing is copied out. Wearing a style
 * means the properties it decides are *derived* per universe from the style's
 * pick — so editing the style changes every wearer with nothing to propagate,
 * and taking it off leaves the node with exactly what it always held itself.
 * A node that wants to keep the look wants {@link deleteStyle}'s baking, or its
 * own values.
 */
export function setStyle(
	scene: Scene,
	ids: readonly string[],
	styleId: string | undefined,
): Scene {
	if (styleId !== undefined && !findStyle(scene.styles, styleId)) return scene;
	return mapSelected(scene, ids, (node) => {
		if (node.style === styleId) return node;
		if (styleId === undefined) {
			const { style: _gone, ...rest } = node;
			return rest as SceneNode;
		}
		return { ...node, style: styleId };
	});
}

/**
 * Wearing a style the way *applying* one means it: the treatment wins.
 *
 * {@link setStyle} is the assignment on its own, and precedence being per
 * property means a node that states its own size keeps it. That is right for the
 * document — it is how a heading takes a family and a leading while stating its
 * own size — and wrong for the gesture: select four paragraphs, wear Prose, and
 * every one of them already states a size and a weight, so the visible result of
 * applying a style is *nothing at all*, with four silent overrides to hunt down.
 *
 * So the panel calls this, and the property the style decides is cleared from
 * the node. Which makes an override mean something: everything left overriding
 * after this was overridden on purpose, by pressing the button that says so.
 * Nothing is lost that undo will not bring back, and nothing is *copied* either
 * — the node ends up with no opinion, and the treatment is still derived from
 * the style's pick per universe.
 */
export function wearStyle(
	scene: Scene,
	ids: readonly string[],
	styleId: string | undefined,
): Scene {
	const worn = setStyle(scene, ids, styleId);
	const style = findStyle(worn.styles, styleId);
	if (!style) return worn;
	const decides = styleProps(style);
	if (decides.length === 0) return worn;
	const chosen = new Set(ids);

	return {
		...worn,
		nodes: mapTree(worn.nodes, (node) => {
			if (!chosen.has(node.id) || node.style !== style.id) return node;
			const props = { ...node.props };
			let cleared = false;
			for (const prop of decides) {
				// Only what this node would actually take: a property its kind
				// cannot draw was never worn, so clearing it would be an edit to
				// something nobody can see.
				if (!KINDS[node.kind].props.includes(prop)) continue;
				if (props[prop] === undefined) continue;
				delete props[prop];
				cleared = true;
			}
			return cleared ? { ...node, props } : node;
		}),
	};
}

/**
 * Deletes a style and bakes it into its wearers, so the design does not
 * visibly change.
 *
 * The same bargain {@link deleteToken} strikes, and the same caveat: a style
 * with two variants *is* two designs, and one document cannot hold both once
 * the variable is gone. So `picks` decides which one survives — the universe on
 * screen, if the caller has one — and without it the first variant does, which
 * is what an unsolved preview was showing anyway.
 *
 * A part that names a token is baked as the link, not as the colour it
 * currently resolves to: the token is not going anywhere, so freezing it would
 * unwire a parameter for nothing.
 */
export function deleteStyle(
	scene: Scene,
	id: string,
	picks: Picks = {},
): Scene {
	const style = findStyle(scene.styles, id);
	if (!style) return scene;
	const index = activeIndex(style.variants, styleVar(id), picks);
	const baked = index === -1 ? {} : style.variants[index].parts;

	return {
		...scene,
		styles: scene.styles.filter((s) => s.id !== id),
		nodes: mapTree(scene.nodes, (node) => {
			if (node.style !== id) return node;
			const props = { ...node.props };
			// Only what the node was actually taking from it: a property it
			// already stated is untouched, and one its kind cannot draw was never
			// worn in the first place.
			for (const prop of wornProps(scene, node)) {
				const term = baked[prop];
				if (term) props[prop] = [term];
			}
			const { style: _gone, ...rest } = node;
			return { ...rest, props } as SceneNode;
		}),
	};
}

/**
 * Held picks after a collapse, or undefined to leave the node alone.
 *
 * Kept out of {@link collapseToPicks} because it is the one part of that walk
 * that is not "shorten this list": a component's variables are minted once per
 * instance and the document holds no list of *those*, so what a pick collapses
 * to is a hold.
 *
 * Both ends of the relationship come through here. An instance holds the
 * definition's variables under its own copies' picks; a definition root holds
 * them under its own. Which is the whole of why a definition's lists survive a
 * collapse — see the note at the call site.
 */
function collapseHolds(
	scene: Scene,
	node: SceneNode,
	picks: Readonly<Record<string, number>>,
): Record<string, number> | undefined {
	const def = node.component
		? componentDef(scene, node.id)
		: componentDef(scene, node.instanceOf);
	if (!def) return undefined;
	const own = def.root.id === node.id;
	const holds = { ...node.holds };
	let changed = false;
	for (const v of openVariables(def)) {
		const index =
			picks[own ? v.variable : instanceVariable(node.id, v.node.id, v.prop)];
		if (index === undefined || holds[v.variable] === index) continue;
		holds[v.variable] = index;
		changed = true;
	}
	return changed ? holds : undefined;
}

/** Reduces every varying assignment to the alternative this universe chose. */
export function collapseToPicks(
	scene: Scene,
	picks: Readonly<Record<string, number>>,
): Scene {
	// Deliberately *not* `activeTerm`: that falls back to the first alternative
	// when there is no pick, which is right for rendering but would silently
	// rewrite the document here. A missing pick leaves the assignment alone.
	const pickOne = (value: Value, variable: string): Value => {
		if (value.length <= 1) return value;
		const index = picks[variable];
		return index !== undefined && index < value.length ? [value[index]] : value;
	};

	/**
	 * Nodes inside a component definition, whose property lists survive this.
	 *
	 * A definition's property list is not only its own design: it is the space
	 * every instance of it indexes into, and an instance's override *is* an index
	 * into it. Shortening it to the alternative the definition took therefore
	 * destroyed the choice the instances were making — so Keep wrote each
	 * instance's override and, in the same pass, deleted the list that gave it
	 * meaning. Every override it recorded was dead on arrival, and a universe in
	 * which an instance differed from its definition came back as a different
	 * design than the one on screen.
	 *
	 * So the lists stay, and the definition records its own pick the way its
	 * instances record theirs. The document is still one design afterwards —
	 * every one of those variables is held — and it is still a component, which
	 * pressing Keep has no business taking away.
	 */
	const inDefinition = new Set(
		componentDefs(scene).flatMap((def) => def.parts.map((part) => part.id)),
	);

	return {
		...scene,
		tokens: scene.tokens.map((t) => ({
			...t,
			value: pickOne(t.value, tokenVar(t.id)),
		})),
		// A style's variants are a list of alternatives like any other, so
		// collapsing has to shorten it too — otherwise Keep would leave a
		// document that still branches on the decision it just recorded.
		styles: scene.styles.map((s) => {
			if (s.variants.length <= 1) return s;
			const index = picks[styleVar(s.id)];
			return index !== undefined && index < s.variants.length
				? { ...s, variants: [s.variants[index]] }
				: s;
		}),
		nodes: mapTree(scene.nodes, (node) => {
			const keep = inDefinition.has(node.id);
			const props: SceneNode["props"] = {};
			for (const [prop, value] of Object.entries(node.props)) {
				if (value) {
					props[prop as PropName] = keep
						? value
						: pickOne(value, propVar(node.id, prop));
				}
			}
			// Geometry too: a collapsed document that kept two positions would
			// still be two designs after being reduced to one. A definition's
			// geometry is not re-minted per instance, so it collapses like anyone's.
			const frame = { ...node.frame };
			for (const dim of DIMENSIONS) {
				frame[dim] = pickOne(frame[dim], frameVar(node.id, dim));
			}
			// A component's variables live nowhere in the document as a list this
			// pass could shorten — an instance's are minted per instance, and a
			// definition's have to survive for those to mean anything — but there
			// is somewhere for the decision to go, and it is the same place an
			// override goes. This is what makes pinning a universe in the
			// multiverse and pressing Keep leave the definition and every instance
			// showing exactly the variant they were showing.
			const holds = collapseHolds(scene, node, picks);
			return holds ? { ...node, props, frame, holds } : { ...node, props, frame };
		}),
		// A dimension is an assignment too, so collapsing has to reach it or the
		// document would keep alternatives this universe already decided between.
		constraints: scene.constraints.map((c) =>
			c.value ? { ...c, value: pickOne(c.value, constraintVar(c.id)) } : c,
		),
	};
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

/**
 * Turns a subtree into a component definition.
 *
 * Nothing moves and nothing is copied: the subtree stays exactly where it is,
 * and the flag is the whole of the change. What it means is in `components.ts`
 * — from here on the compiler mints the subtree's property variables once per
 * instance, so the subtree stops being one design and becomes a space.
 *
 * Only a container is worth defining: a component whose whole content is a
 * single rectangle is a rectangle.
 */
export function defineComponent(scene: Scene, id: string): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node || !KINDS[node.kind].container) return scene;
	return mapSelected(scene, [id], (n) => ({ ...n, component: true }));
}

/**
 * Stops treating a subtree as a definition.
 *
 * Instances of it are deliberately left alone rather than deleted: they hold
 * the name of a node that still exists, so marking it again brings them back.
 * Until then they derive nothing and draw as the empty boxes they are.
 */
export function releaseComponent(scene: Scene, id: string): Scene {
	return mapSelected(scene, [id], ({ component: _dropped, ...rest }) => rest);
}

/**
 * Places a use of a definition beside it.
 *
 * Beside rather than wherever the pointer is, because an instance is created
 * from a list rather than drawn out: it has no gesture to take a position from,
 * and landing next to the thing it is a use of is the one placement that needs
 * no explanation. Successive instances stack downwards.
 *
 * It is created at the definition's size. That size is the instance's own from
 * then on — the copy inside fills whatever box the instance has — so resizing
 * one is a placement decision and not a departure from the definition.
 *
 * The forty-pixel aisle and the sixteen-pixel stacking gap below are claims
 * about what reads as "beside" and "under", so like {@link DUPLICATE_OFFSET}
 * they are pixel counts written in EMU. As bare numbers they would have put
 * every instance on top of the definition and on top of each other.
 */
export function addInstance(
	scene: Scene,
	rootId: string,
	picks: Picks = {},
): { scene: Scene; id: string } {
	const found = locate(scene.nodes, rootId);
	const root = found?.siblings[found.index];
	if (!found || !root || root.component !== true) return { scene, id: rootId };
	const context = sceneContext(scene, picks);
	const box = frameOf(root, context);
	const taken = found.siblings.filter((n) => n.instanceOf === rootId).length;
	const node: SceneNode = {
		...makeNode(
			"instance",
			{
				x: box.x + box.width + 40 * EMU_PER_PX,
				y: box.y + taken * (box.height + 16 * EMU_PER_PX),
				width: box.width,
				height: box.height,
			},
			{ name: root.name },
		),
		instanceOf: rootId,
	};
	const parent = found.parent;
	return {
		scene: parent
			? {
					...scene,
					nodes: mapTree(scene.nodes, (n) =>
						n.id === parent.id
							? { ...n, children: [...(n.children ?? []), node] }
							: n,
					),
				}
			: { ...scene, nodes: [...scene.nodes, node] },
		id: node.id,
	};
}

/**
 * Holds — or releases — one of the choices a definition left an instance.
 *
 * `variable` is in the *definition's* space, so the same call means the same
 * thing on every instance. Releasing is what makes the choice the solver's
 * again, which is not the same as choosing the definition's value: an
 * unheld variable is a variable that still branches.
 */
export function setHold(
	scene: Scene,
	instanceId: string,
	variable: string,
	index: number | null,
): Scene {
	return mapSelected(scene, [instanceId], (node) => {
		const holds = { ...node.holds };
		if (index === null) delete holds[variable];
		else holds[variable] = index;
		return Object.keys(holds).length === 0
			? ({ ...node, holds: undefined } as SceneNode)
			: { ...node, holds };
	});
}

/**
 * Holds every one of a definition's open choices at once, or releases them all.
 *
 * Which is what choosing a variant *is*: a variant is a point in the
 * definition's space, and an instance showing it is an instance that has held
 * every coordinate of that point. Passing null hands the instance back to the
 * solver, and it goes back to being several designs.
 */
export function setVariant(
	scene: Scene,
	instanceId: string,
	picks: Readonly<Record<string, number>> | null,
): Scene {
	return mapSelected(scene, [instanceId], (node) =>
		picks === null
			? ({ ...node, holds: undefined } as SceneNode)
			: { ...node, holds: { ...picks } },
	);
}

/* ------------------------------------------------------------------ */
/* State machines                                                      */
/* ------------------------------------------------------------------ */

/**
 * Every edit below writes a record whose *identifiers* reach the generated
 * program as terms — `machine(m1)`, `mstate(m1,hover)`, `mtrans(m1,press)`,
 * `stt(b1,hover,label)` — which is what makes this section different from the
 * styles above it, where only the id of the style itself is a term.
 *
 * Two consequences run through all of it.
 *
 * **Every id these mint is checked against `wordOf` before it is used.** Not as
 * defensive tidiness: `normalizeScene` drops a machine, a state or a transition
 * whose id is not an ASP constant, so an id these functions minted badly would
 * survive in memory, be edited against, and then vanish the next time the
 * document was read back — a loss with no error and no place to look. Minting
 * one that can never be dropped is the only way to keep the round trip honest.
 *
 * **A name is not an id and renaming never touches one.** A state id is inside
 * every `stt(I,S,N)` term a cross-state rule names, inside every `sprop`/`sfval`
 * variable key a pin refers to, and inside every `data-state` an exported file
 * switches on. Renaming a state therefore changes what a person reads and
 * nothing else — which is the same split {@link renameNode} keeps, one register
 * louder, because here the id is visible in somebody else's browser.
 */

/** Replaces one machine, if the document holds it — the twin of `mapStyle`. */
function mapMachine(
	scene: Scene,
	id: string,
	fn: (machine: Machine) => Machine,
): Scene {
	const machines = scene.machines.map((m) => (m.id === id ? fn(m) : m));
	return machines.some((m, i) => m !== scene.machines[i])
		? { ...scene, machines }
		: scene;
}

/** Replaces one state of one machine, if it holds it. */
function mapState(
	scene: Scene,
	machineId: string,
	stateId: string,
	fn: (state: MachineState) => MachineState,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const states = machine.states.map((s) => (s.id === stateId ? fn(s) : s));
		return states.some((s, i) => s !== machine.states[i])
			? { ...machine, states }
			: machine;
	});
}

/**
 * The bare constant a typed name reduces to, or nothing where it reduces to
 * nothing readable.
 *
 * A state's id is derived from its name rather than generated, and that is the
 * opposite of what {@link addStyle} does with a style's id. The difference is
 * who reads it. A style's id appears in `sty(s_3f2a)` and in a pin key, and
 * nobody is ever shown it; a state's id appears in `[data-state="hover"]` in
 * the stylesheet this tool exports, in `stt(b1,hover,label)` in a rule a
 * designer types, and in a `mstate(m1,hover)` fact they read in the program
 * panel. `s_3f2a` in all three places would be a machine nobody could write a
 * rule about.
 *
 * Camel case is the spelling ASP takes and this document already uses for its
 * multi-word constants (`spaceBetween`, `easeInOut`), so "Pointer Down" becomes
 * `pointerDown` rather than `pointer_down`: one house spelling, and it is the
 * one the enumerated values are already written in.
 */
function constantFrom(name: string): string | undefined {
	const words = name
		.trim()
		.split(/[^A-Za-z0-9]+/)
		.filter((word) => word.length > 0);
	if (words.length === 0) return undefined;
	const head = words[0].toLowerCase();
	const rest = words
		.slice(1)
		.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
	return wordOf(head + rest.join(""));
}

/**
 * `base`, `base2`, `base3`, … — the first spelling this machine has not taken.
 *
 * {@link uniqueName} with no separator, because the result is a term rather
 * than a sentence: `hover-2` is not a constant, and `hover_2` would be the one
 * place in this feature spelled with an underscore. The names people read go
 * through `uniqueName` proper; this is only for the ids underneath them.
 */
function uniqueConstant(taken: Iterable<string>, base: string): string {
	return uniqueName(taken, base, "");
}

/**
 * A fresh machine on a definition, with the one state it cannot do without.
 *
 * **One state, not two.** A machine begins as a description of what the
 * component already is — its rest state, whose delta is empty because the
 * definition *is* that delta — and becomes behaviour the moment somebody adds a
 * second state and an edge between them. Starting with a rest/hover pair would
 * be asserting a behaviour nobody has stated yet, which is `addStyle`'s
 * argument for one variant word for word.
 *
 * The empty delta is load-bearing rather than a placeholder. `stateTouches`
 * reads it as saying nothing, so `materializedParts` returns the empty set, so
 * the program gains no `mpart/2`, no `mcopy/3` and not one state copy: a
 * document that has just gained a machine grounds to exactly what it grounded
 * to a moment ago. The feature costs nothing until it is used.
 *
 * **Refused on a node that is not a definition**, unlike {@link machineForRoot}
 * which answers for one anyway. The two are asymmetric on purpose: a machine
 * whose root was *released* is a record worth keeping and repairing, and both
 * panels are built to show one, but a machine created on a rectangle is a
 * mistake at the moment it is made and there is nothing yet to lose by saying
 * so.
 *
 * **One machine per root.** The compiler's `machineForRoot` takes the first and
 * the exporter, the canvas and the inspector all follow it, so a second machine
 * on one definition is a record nothing reads pretending to be a behaviour. The
 * existing one's id comes back instead, which is what a panel that just asked
 * for "the machine for this component" wanted.
 */
export function addMachine(
	scene: Scene,
	root: string,
	name?: string,
): { scene: Scene; id: string } {
	const existing = machineForRoot(scene, root);
	if (existing) return { scene, id: existing.id };
	const node = findInTree(scene.nodes, root);
	if (!node || !isDefinition(node)) return { scene, id: "" };
	const machine: Machine = {
		// Generated rather than derived from the name, which is the one id in
		// this section that is: a machine's id is never typed into a rule and
		// never exported — every predicate carries it as an argument the panel
		// supplies — so there is nothing for a readable one to buy.
		id: uniqueConstant(
			scene.machines.map((m) => m.id),
			newNodeId().replace("n_", "m_"),
		),
		name: uniqueName(
			scene.machines.map((m) => m.name),
			name?.trim() || node.name || "states",
			" ",
		),
		root,
		states: [{ id: "rest", name: "Rest", parts: {} }],
		transitions: [],
	};
	return { scene: { ...scene, machines: [...scene.machines, machine] }, id: machine.id };
}

/**
 * Takes the machine away. The instances keep their `state`.
 *
 * Nothing is repaired on the way out, exactly as nothing is repaired on the way
 * in: an instance drawn in `hover` still says so, `shownState` reads it as the
 * initial state of a machine that is not there, and undo puts every one of them
 * back where it was. Stripping the field would make deleting a machine
 * destructive in a way undo could not reach, and it would do it silently, to
 * nodes the person deleting the machine was not looking at.
 *
 * Cross-state rules are left alone for the same reason and one stronger: a
 * constraint naming `stt(b1,hover,label)` simply stops holding — `mcopy/3`
 * derives nothing, so the member says nothing — and it comes back word for word
 * when the machine does. Deleting the rule would make undo restore the machine
 * and not the sentence about it.
 */
export function deleteMachine(scene: Scene, id: string): Scene {
	const machines = scene.machines.filter((m) => m.id !== id);
	return machines.length === scene.machines.length ? scene : { ...scene, machines };
}

export function renameMachine(scene: Scene, id: string, name: string): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return mapMachine(scene, id, (m) => (m.name === trimmed ? m : { ...m, name: trimmed }));
}

/**
 * A state, with an empty delta and an id derived from what it is called.
 *
 * The delta is empty because a state is a *diff*: a new one that copied the
 * rest state's values would be a state that says everything and means nothing,
 * and the first edit anybody made to the component would have to be made twice.
 * This is where {@link StatePart}'s absent-is-inherit pays for itself — an empty
 * state is the same picture as the initial one, costs no copy, and becomes a
 * state the moment one field is written.
 *
 * Placed at the end, which is what keeps the initial state where it was:
 * `initialState` is `states[0]` and there is no flag, so appending is the only
 * insertion that cannot change what every instance of the definition draws.
 * {@link reorderState} is how somebody changes it on purpose.
 */
export function addState(
	scene: Scene,
	machineId: string,
	name?: string,
): { scene: Scene; id: string } {
	const machine = findMachine(scene.machines, machineId);
	if (!machine) return { scene, id: "" };
	const taken = machine.states.map((s) => s.id);
	const label = name?.trim() || "";
	const id = uniqueConstant(taken, constantFrom(label) ?? "state");
	const state: MachineState = {
		id,
		name: uniqueName(machine.states.map((s) => s.name), label || "State", " "),
		parts: {},
	};
	return {
		scene: mapMachine(scene, machineId, (m) => ({ ...m, states: [...m.states, state] })),
		id,
	};
}

/**
 * Renames a state. **The name, never the id.**
 *
 * The id is in every `stt(I,S,N)` a cross-state rule names, in every
 * `sprop`/`sfval` key a pin is recorded under, and in every `data-state` the
 * exported file switches on. Renaming through to the id was considered and
 * rejected on the strength of the third of those: an exported page and the
 * document that produced it would silently stop agreeing, and the failure would
 * only show up in a browser. Rules were the second reason and pins the third,
 * and any one of them is enough.
 *
 * A state whose name a person has never touched reads as its id, which is why
 * `hover` is a perfectly good name to leave alone.
 */
export function renameState(
	scene: Scene,
	machineId: string,
	stateId: string,
	name: string,
): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return mapState(scene, machineId, stateId, (s) =>
		s.name === trimmed ? s : { ...s, name: trimmed },
	);
}

/**
 * Removes a state, and every transition that had an end in it.
 *
 * The transitions go because an edge with one end missing is not a dangling
 * reference, it is half an edge: `mdangling/2` exists to report the *document's*
 * mistakes back to the person who made them, and an edge this edit orphaned is
 * not one of those. Keeping it would put a violation in the panel that the
 * designer did not write and cannot read the cause of.
 *
 * The last state stays, for the reason {@link deleteStyleVariant} keeps the last
 * variant: `initialState` is `states[0]`, so a machine with none has no state to
 * draw an instance in, and `normalizeScene` would drop the whole record the next
 * time the document was read. Somebody who wants the machine gone deletes the
 * machine.
 *
 * Deleting the initial state promotes the next one, and that falls out of the
 * order being the answer rather than being arranged for here. Every instance of
 * the definition then draws the new first state, which is the honest consequence
 * of deleting the state they were drawing.
 */
export function deleteState(scene: Scene, machineId: string, stateId: string): Scene {
	return mapMachine(scene, machineId, (machine) => {
		if (machine.states.length <= 1) return machine;
		if (!machine.states.some((s) => s.id === stateId)) return machine;
		return {
			...machine,
			states: machine.states.filter((s) => s.id !== stateId),
			transitions: machine.transitions.filter(
				(t) => t.from !== stateId && t.to !== stateId,
			),
		};
	});
}

/**
 * Moves a state to a position in the list — which, for position 0, is how the
 * machine's initial state changes.
 *
 * One edit rather than two, and that is the whole reason there is no `initial`
 * flag to set: a flag and an order can disagree, and the shape that disagrees is
 * a machine whose panel shows one state first and whose instances draw another.
 *
 * `to` is clamped rather than refused. This is a drag, and a drag past the end
 * of a list means the end of the list in every other reorder in this file.
 */
export function reorderState(
	scene: Scene,
	machineId: string,
	stateId: string,
	to: number,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const from = machine.states.findIndex((s) => s.id === stateId);
		if (from === -1) return machine;
		const target = Math.max(0, Math.min(machine.states.length - 1, Math.trunc(to)));
		if (target === from) return machine;
		const states = [...machine.states];
		const [moved] = states.splice(from, 1);
		states.splice(target, 0, moved);
		return { ...machine, states };
	});
}

/**
 * Writes one field of one state's delta, and takes the delta away when the last
 * field goes.
 *
 * "This state changes nothing about this part" has **one** spelling — no entry —
 * and this is the function that keeps it that way. An entry left behind holding
 * `{ props: {} }` would be a second spelling of the same claim, and the two
 * would drift: `stateTouches` reads them alike, so nothing downstream can tell
 * them apart, but a panel listing "what this state changes" would list a part it
 * changes nothing about, and a diff between two documents would show an edit
 * that changed no design.
 *
 * Deliberately the opposite judgement to `normalizeStateParts`, which keeps an
 * empty entry it is handed. The difference is who is speaking: an edit is a
 * person saying something, and a reader is being handed a file it has no
 * business rewriting.
 */
function writeDelta(
	scene: Scene,
	machineId: string,
	stateId: string,
	part: string,
	fn: (delta: StatePart) => StatePart,
): Scene {
	return mapState(scene, machineId, stateId, (state) => {
		const current = state.parts[part] ?? {};
		const next = fn(current);
		// Nothing usable left in it is the same claim as no entry at all, so it
		// leaves as an entry rather than as an empty one.
		const keep = stateTouches(next);
		if (!keep && state.parts[part] === undefined) return state;
		const parts = { ...state.parts };
		if (keep) parts[part] = next;
		else delete parts[part];
		return { ...state, parts };
	});
}

/**
 * What one state says about one property of one definition part.
 *
 * A whole {@link Value} rather than a {@link Term}, which is where this parts
 * company with {@link setStylePart} and the reason is the invariant. A style
 * variant holds one answer per property because a list there would branch on its
 * own and reintroduce the cross product the style exists to collapse. A state's
 * delta may hold alternatives, because the branching a state can legitimately
 * cause is *exactly* this: two fills written inside one delta is a design
 * decision like any other and mints one `sprop(I,S,N,P)` variable with two
 * alternatives, which is two designs. What it is not is a state branching — the
 * state is still one state, true at once with all the others.
 *
 * `undefined` clears the property, which is not the same as writing the
 * definition's value into the delta: cleared, the state reads `prop(inst(I,N),P)`
 * — the instance's one shared variable — and follows it wherever it goes. A
 * delta holding a copy of today's answer would stop following it, silently, at
 * the moment the definition changed.
 */
export function setStateProp(
	scene: Scene,
	machineId: string,
	stateId: string,
	part: string,
	prop: PropName,
	value: Value | undefined,
): Scene {
	if (!Object.hasOwn(PROPS, prop)) return scene;
	return writeDelta(scene, machineId, stateId, part, (delta) => {
		const props = { ...delta.props };
		if (value === undefined || value.length === 0) delete props[prop];
		else props[prop] = value;
		return { ...delta, props };
	});
}

/**
 * The same for one of the four dimensions, in the part's own *parent-relative*
 * coordinates.
 *
 * Which is what makes the materialisation analysis affordable rather than being
 * a detail of storage: a state that moves a container moves everything inside it
 * with no copy for any of them, so the analysis closes upward only and the usual
 * "the whole card lifts on hover" costs exactly one state copy.
 */
export function setStateFrame(
	scene: Scene,
	machineId: string,
	stateId: string,
	part: string,
	dim: Dimension,
	value: Value | undefined,
): Scene {
	if (!DIMENSIONS.includes(dim)) return scene;
	return writeDelta(scene, machineId, stateId, part, (delta) => {
		const frame = { ...delta.frame };
		if (value === undefined || value.length === 0) delete frame[dim];
		else frame[dim] = value;
		return { ...delta, frame };
	});
}

/**
 * Takes a part out of the picture in this state, or puts it back.
 *
 * `true` or absent with no `false`, matching {@link StatePart.hidden}: a part is
 * drawn unless a state says otherwise, so "shown" needs no spelling and storing
 * one would give the document two ways to say the same thing. Unhiding is
 * therefore a delete, and where it was the only thing the delta said the whole
 * entry goes with it — which is {@link writeDelta}'s rule, applied here without
 * a case of its own.
 */
export function setStateHidden(
	scene: Scene,
	machineId: string,
	stateId: string,
	part: string,
	hidden: boolean,
): Scene {
	return writeDelta(scene, machineId, stateId, part, (delta) => {
		if (hidden) return { ...delta, hidden: true };
		const { hidden: _shown, ...rest } = delta;
		return rest;
	});
}

/**
 * "This state changes nothing about this part", said in one gesture.
 *
 * The entry goes rather than being emptied, for {@link writeDelta}'s reason, and
 * this is the function that name is a promise about: a Clear button that left
 * `{}` behind would leave the part listed in a panel whose heading is what this
 * state changes.
 */
export function clearStatePart(
	scene: Scene,
	machineId: string,
	stateId: string,
	part: string,
): Scene {
	return mapState(scene, machineId, stateId, (state) => {
		if (state.parts[part] === undefined) return state;
		const parts = { ...state.parts };
		delete parts[part];
		return { ...state, parts };
	});
}

/**
 * The word a fresh transition is called, taken from what makes it fire.
 *
 * A transition carries no `name` field — an edge is not a thing a designer names
 * twice — so its id is the only word anybody reads it by: it is what
 * `motionLabel` capitalises into "Press · Duration" on a motion row, and what a
 * `why` sentence says when a duration token is the reason. `t_9f31` in those two
 * places would be a receipt rather than a sentence.
 *
 * A verb rather than the trigger itself, because the trigger is the *input* and
 * the id is read as the *move*: "Pointerdown · Duration" describes the mouse and
 * "Press · Duration" describes the button. Where a machine has two edges on one
 * trigger they come out `press` and `press2`, which is a machine
 * `mnondet/3` is about to have something to say about anyway.
 */
const TRANSITION_VERBS: Record<Trigger, string> = {
	pointerenter: "enter",
	pointerleave: "leave",
	pointerdown: "press",
	pointerup: "release",
	focus: "focus",
	blur: "blur",
	click: "click",
	load: "load",
};

/**
 * An edge, from a state to a state, on a trigger.
 *
 * Nothing about the pacing is written down: absent `duration`, `delay`,
 * `stagger` and `easing` are the point rather than an omission. A transition
 * that says nothing falls to `mdefdur/1` in the program and to `MOTION_PROPS`
 * in the panel — one number, in one place, that every unpaced transition in the
 * document follows — so a designer who wants everything a little slower changes
 * one thing. Seeding `200ms` into each edge would make that same change N edits,
 * and would do it by writing a number nobody typed.
 *
 * `from` and `to` are **not** checked against the machine's states. That looks
 * like a missing guard and is the same judgement `normalizeTransitions` makes
 * one line at a time: a dangling edge is the one broken thing this document is
 * built to *report*, `mdangling/2` derives it, the Machines panel offers a
 * one-click rule that forbids it by name, and an edit that refused to make one
 * would take away the symptom along with any way of finding out. What is checked
 * is that both ends are spellable as constants, because `mto(m1,t1,Not A State)`
 * is a syntax error rather than a mistake.
 */
export function addTransition(
	scene: Scene,
	machineId: string,
	from: string,
	to: string,
	trigger: Trigger,
): { scene: Scene; id: string } {
	const machine = findMachine(scene.machines, machineId);
	if (!machine) return { scene, id: "" };
	if (!Object.hasOwn(TRIGGERS, trigger)) return { scene, id: "" };
	if (wordOf(from) !== from || wordOf(to) !== to) return { scene, id: "" };
	const id = uniqueConstant(
		machine.transitions.map((t) => t.id),
		TRANSITION_VERBS[trigger],
	);
	const transition: Transition = { id, from, to, trigger, enabled: true };
	return {
		scene: mapMachine(scene, machineId, (m) => ({
			...m,
			transitions: [...m.transitions, transition],
		})),
		id,
	};
}

/**
 * Changes an edge — its ends, its trigger, its pacing, its switch.
 *
 * One function with a patch rather than eight setters, which is
 * {@link updateLayout}'s shape and it earns it for the same reason: every field
 * of a transition is edited from one row of one panel, and a row that had to
 * know which of eight functions to call for each of its controls would be eight
 * places to get a coalescing key wrong.
 *
 * The **id is not patchable**, which is why the type says `Omit<…, "id">`. It is
 * a term in `mtrans/2`, in three `mval` variable keys and therefore in any pin
 * on a motion setting; changing it would silently drop the pins and leave the
 * panel showing a duration nobody chose. Somebody who wants a differently named
 * edge deletes this one and adds one, which is one gesture more and loses
 * nothing that was not about to be lost anyway.
 */
export function updateTransition(
	scene: Scene,
	machineId: string,
	transitionId: string,
	patch: Partial<Omit<Transition, "id">>,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const transitions = machine.transitions.map((t) => {
			if (t.id !== transitionId) return t;
			const next: Transition = { ...t, ...patch };
			// The same three checks `normalizeTransitions` makes, in the one other
			// place a transition can be written: an end that is not a constant or a
			// trigger the table has not got would reach the program as a syntax
			// error or as a fact no rule matches, and this is the edit that would
			// have put it there.
			if (wordOf(next.from) !== next.from) return t;
			if (wordOf(next.to) !== next.to) return t;
			if (!Object.hasOwn(TRIGGERS, next.trigger)) return t;
			// A patch that says what the transition already said is not an edit.
			// Spread alone would mint a new object every time, and the house rule
			// this file keeps is that an edit which changed nothing returns the
			// same scene — undo is a stack of documents and React's memos are
			// identity comparisons, so a new object is a change to both of them.
			// Compared with `Object.is`, so a caller handing over a freshly built
			// `Value` is writing even where the alternatives read the same: that is
			// a value the panel just resolved, and pretending otherwise would make
			// the one case where the identity matters the one case we got wrong.
			const keys = Object.keys(patch) as Array<keyof Omit<Transition, "id">>;
			return keys.every((key) => Object.is(t[key], next[key])) ? t : next;
		});
		return transitions.some((t, i) => t !== machine.transitions[i])
			? { ...machine, transitions }
			: machine;
	});
}

export function deleteTransition(
	scene: Scene,
	machineId: string,
	transitionId: string,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const transitions = machine.transitions.filter((t) => t.id !== transitionId);
		return transitions.length === machine.transitions.length
			? machine
			: { ...machine, transitions };
	});
}

/**
 * Which state this instance is drawn in, or `null` to follow the machine.
 *
 * The twin of {@link setHold} and structurally its exact match: both record a
 * decision about *one use* of a shared definition, both name something the
 * definition owns, and both leave every other use alone. The difference is which
 * way the decision cuts — a hold narrows the design space, a state selects one of
 * the behaviours — and the two are orthogonal, so an instance may hold a variant
 * and be drawn in a state, and the pair is a cell of a matrix rather than a point
 * in a product of universes.
 *
 * **Read on an instance and nowhere else**, so this refuses everything else
 * rather than writing a field that would never be read. A definition on the
 * canvas is always its rest state: a definition part's frame is a *fact* the
 * compiler emits, a fact cannot be un-said by a rule, and every instance of the
 * definition inherits it — so drawing the definition in another state would move
 * the component itself, for everyone, because of an editor-ish field. The
 * Machines panel plays a state on the canvas instead, which touches no document
 * at all.
 *
 * The state is **not** checked against the machine. `shownState` falls back to
 * the initial one, so a machine edited down leaves its instances legal, and a
 * name kept through a state's deletion and undone comes back meaning what it
 * meant. Checking here would make undo restore the state and not the instances
 * that were drawn in it.
 */
export function setNodeState(
	scene: Scene,
	nodeId: string,
	state: string | null,
): Scene {
	const node = findInTree(scene.nodes, nodeId);
	if (!node || !isInstance(node)) return scene;
	if ((node.state ?? null) === state) return scene;
	return mapSelected(scene, [nodeId], (n) =>
		state === null
			? ({ ...n, state: undefined } as SceneNode)
			: { ...n, state },
	);
}

/**
 * Drops machines whose root is no longer in the document.
 *
 * The counterpart of {@link pruneConstraints}, and deliberately narrower than
 * it: a machine is dropped when the node it names has been **deleted**, and not
 * when that node has merely stopped being a definition.
 *
 * The distinction is the difference between a record that can be repaired and
 * one that cannot. A released definition is still a subtree sitting on the
 * canvas — {@link releaseComponent} keeps its instances alive for exactly this
 * reason, "so marking it again brings them back" — and the machine on it is in
 * the same position: it says nothing to the program, because `machine_of(M,R)`
 * joins `instance(I,R)` and finds nobody, and the inspector has a sentence for
 * that state which offers the repair ("mark that subtree as a component again
 * and they come back"). Deleting the machine there would take away every state,
 * every delta and every transition on the strength of one click that a second
 * click undoes, and it would make that sentence a lie.
 *
 * A deleted root is different in kind. There is no subtree to mark again, no
 * gesture that brings the definition back other than undo — which restores the
 * machine along with it — and the record left behind names nothing at all.
 */
export function pruneMachines(scene: Scene): Scene {
	if (scene.machines.length === 0) return scene;
	const alive = new Set(flatten(scene.nodes).map((n) => n.id));
	const machines = scene.machines.filter((m) => alive.has(m.root));
	return machines.length === scene.machines.length ? scene : { ...scene, machines };
}
