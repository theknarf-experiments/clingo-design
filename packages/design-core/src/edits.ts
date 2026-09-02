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
	findInput,
	findMachine,
	findTimeline,
	holdsKeyCopy,
	holdsStateCopy,
	machineForNode,
	machineForRoot,
	machineLayers,
	trackTerm,
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
	type AssetInfo,
	type AutoLayout,
	type Axis3,
	BLEND_KINDS,
	type Blend,
	type BlendStop,
	COMPARE_OPS,
	CONSTRAINT_KINDS,
	CONSTRAINT_NAMES,
	type ChildProp,
	type Condition,
	type Constraint,
	type ConstraintKind,
	type ConstraintSpec,
	DIMENSIONS,
	DIMENSIONS_3D,
	type Diagonal,
	type Dimension,
	EDGES,
	type Edge,
	type FontFile,
	type Guide,
	type GuideProp,
	INPUT_KINDS,
	type InputKind,
	KINDS,
	type Keyframe,
	type LoopMode,
	type Machine,
	type MachineInput,
	type MachineLayer,
	type MachineState,
	type ImageRef,
	type MeshRef,
	type NodeKind,
	PROPS,
	type PropName,
	SPATIALS,
	type Scene,
	type SceneNode,
	type Sizing,
	type Spatial,
	type SpatialValue,
	type StatePart,
	type Style,
	type StyleVariant,
	type SurfaceGuides,
	TIMELINE_CLOCKS,
	TRIGGERS,
	TURNS,
	type Timeline,
	type TimelineClock,
	type Track,
	type Transition,
	type Trigger,
	type Turn,
	type TurnValue,
	dimension,
	edgeOn,
	edgeOptions,
	findGuide,
	findStyle,
	frameDim,
	frameFrozen,
	frameOf,
	guideLines,
	holdsDatum,
	nextGuideId,
	withGuideAt,
	isConstraintTerm,
	makeFrame,
	makeLayout,
	makeSpatial,
	rangesOverGroup,
	sceneContext,
	sharedPropsOfKinds,
	spatialDim,
	spatialFrozen,
	stateTouches,
	styleProps,
	uniqueName,
	withFrame,
	withSpatial,
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
	msOf,
	optionLabel,
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

/**
 * Place an imported picture on the canvas.
 *
 * At its own size, not at a size this file invented: a photograph is 3024×4032
 * or 800×600, and a designer who wants it smaller resizes it and can see what
 * they did. The intrinsic dimensions are pixels as the decoder reported them, so
 * they cross into EMU here — the one conversion an import makes.
 *
 * Centred on `at`, because the gesture that produces one is a drop or a menu
 * command rather than a drag, and neither of those draws a box. Where a picture
 * would land off the artboard entirely that is the caller's business: this
 * places it where it was asked to.
 *
 * The bytes are already in the tree by the time this runs — the file is written
 * first, then the node references it — so a node made here always points at
 * something. The reverse order would leave a picture nobody could draw.
 */
export function addImage(
	scene: Scene,
	parentId: string | null,
	image: ImageRef,
	at: Point,
	name: string,
	picks: Picks = {},
): Scene {
	// Pixels as the decoder reported them, crossing into EMU — the one
	// conversion an import makes.
	const width = image.width * EMU_PER_PX;
	const height = image.height * EMU_PER_PX;
	const node: SceneNode = {
		...makeNode(
			"image",
			{ x: at.x - width / 2, y: at.y - height / 2, width, height },
			{ name: name.trim() || KINDS.image.label },
		),
		image,
	};
	return addNodeTo(scene, parentId, node, picks);
}

/**
 * Place an instance of a component that lives in its own document.
 *
 * The twin of {@link addInstance}, which places beside the definition because
 * the definition is a subtree of the same page. A definition kept in its own
 * document is on nobody's page — it is spliced in hidden — so there is nothing
 * to place beside, and the instance goes where the person is looking instead.
 *
 * `instanceOf` is the **path**, not the id the composition derives. The document
 * stores which component this is; the id is a fact about one composed scene and
 * would be a reference that broke the moment the file was renamed.
 *
 * Sized from the definition's own box, so an instance arrives the size the
 * component is rather than a size this file invented — the same rule an imported
 * image and an imported mesh follow.
 */
export function placeInstance(
	scene: Scene,
	path: string,
	definition: SceneNode,
	at: Point,
	parentId: string | null,
	picks: Picks = {},
): { scene: Scene; id: string } {
	const box = frameOf(definition, sceneContext(scene, picks));
	const node: SceneNode = {
		...makeNode(
			"instance",
			{
				x: at.x - box.width / 2,
				y: at.y - box.height / 2,
				width: box.width,
				height: box.height,
			},
			{ name: definition.name },
		),
		instanceOf: path,
	};
	return { scene: addNodeTo(scene, parentId, node, picks), id: node.id };
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
 *
 * {@link pruneAssets} runs last and its position says nothing, because it reads
 * the nodes and nothing else — no constraint and no machine has ever named an
 * asset. It is here rather than at the gesture that deleted the model for
 * {@link pruneMachines}' reason exactly: the index is a cache of what the
 * document references, and a reference can go through any of the paths into this
 * function.
 */
export function deleteNodes(
	scene: Scene,
	ids: readonly string[],
	picks: Picks = {},
): Scene {
	const drop = new Set(ids);
	return pruneAssets(
		pruneConstraints(
			pruneMachines({
				...scene,
				nodes: refreshGroups(
					mapTree(scene.nodes, (node) => (drop.has(node.id) ? null : node)),
					sceneContext(scene, picks),
				),
			}),
		),
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
 *
 * **Ranged over `edgeOptions` and not over `spec.edges`, and that is not a
 * refinement — it is what keeps the third axis from taking every default.** Two
 * flat rectangles agree *perfectly* about their front faces: both are at z 0
 * with no depth, so the spread is zero, and zero beats every planar answer.
 * Without the narrowing, "align these two cards" would have started defaulting
 * to `Front face` the day `EDGES` grew its z rows — a rule about a quantity
 * neither member has, which the program then refuses through `gnoedge/2`, which
 * is a rule that quietly does nothing chosen *by the tool* rather than by a
 * person. `edgeOptions` offers the third axis only where every member is in it,
 * so this now compares like with like.
 *
 * The fallback when nothing is offered is `spec.edges[0]`, which is the planar
 * lead of the kind: a menu with nothing in it is not a state this can be asked
 * to answer for, and the shipped default is the honest thing to return.
 */
function quietestEdge(
	scene: Scene,
	spec: ConstraintSpec,
	nodes: readonly string[],
): Edge {
	const offered = edgeOptions(scene, kindOf(spec), nodes);
	let best = offered[0] ?? spec.edges[0];
	let least = Number.POSITIVE_INFINITY;
	for (const edge of offered) {
		const spread = spreadOf(scene, nodes, edge);
		if (spread < least) {
			least = spread;
			best = edge;
		}
	}
	return best;
}

/**
 * Which kind a spec is, for the one reader that has the spec and needs the name.
 *
 * `edgeOptions` takes a {@link ConstraintKind} because that is what a panel has;
 * `quietestEdge` takes a {@link ConstraintSpec} because that is what its callers
 * have. Identity over the table rather than a second argument threaded through
 * two call sites, and `align` as the fallback for a spec that is not in the
 * table at all — which nothing constructs and a test could.
 */
function kindOf(spec: ConstraintSpec): ConstraintKind {
	return (
		CONSTRAINT_NAMES.find((name) => CONSTRAINT_KINDS[name] === spec) ?? "align"
	);
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
 *
 * A **keyframe copy** — `kfr(c1,open,trkd(panel,y),3)` — is the fifth, and it is
 * the same hole a fifth time. It is neither a node, nor a datum, nor a state
 * copy, nor an instance part, so without {@link holdsKeyCopy} the first
 * unrelated delete after somebody wrote a rule about a moment of an animation
 * would strip the rule of its members and then delete it for falling below
 * `minNodes`. And here the loss is worse than elsewhere, because the rule is
 * **the only thing that makes the copy exist at all**: `keyframeParts` is seeded
 * from `scene.constraints`, so deleting the rule un-mints the copy, and there is
 * nothing left in the document to say what was lost.
 *
 * `holdsKeyCopy` is blunt about the track and sharp about the index, and the
 * asymmetry is its own: a track that has lost its third key really has lost it,
 * and no edit brings that moment back the way re-adding a delta brings a
 * materialised part back.
 *
 * **A 3D node needs no clause and that is the invariant paying for itself.** A
 * mesh, a camera and a light are `node/1` with a `kind/2`, they are in the tree,
 * so they are in `alive` — the whole of what this function has to know about the
 * third axis is nothing. `edits.test.ts` asserts it rather than assuming it,
 * because "nothing had to change" is a claim like any other.
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
				holdsInstancePart(scene, id) ||
				holdsKeyCopy(scene, id),
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
 * The same for one of the **six** dimensions, in the part's own
 * *parent-relative* coordinates.
 *
 * Which is what makes the materialisation analysis affordable rather than being
 * a detail of storage: a state that moves a container moves everything inside it
 * with no copy for any of them, so the analysis closes upward only and the usual
 * "the whole card lifts on hover" costs exactly one state copy.
 *
 * **Six and not four**, following {@link StatePart.frame} where the third axis
 * widened it. A state that lifts a mesh 40px in z is the same kind of claim as
 * one that moves a button two pixels down, `sfval(I,S,N,D)` takes any of the six
 * and `mbase/4` carries all six, and narrowing the *edit* to four would have left
 * the one thing `docs/merged-plan.md` §6.1 spends a page making work — a state
 * that moves a mesh on the third axis — with no way to author it. A caller
 * holding a {@link Dimension} needs no change: the four are a subset of the six,
 * and a document with no third axis is unable to tell the difference.
 */
export function setStateFrame(
	scene: Scene,
	machineId: string,
	stateId: string,
	part: string,
	dim: Axis3,
	value: Value | undefined,
): Scene {
	if (!DIMENSIONS_3D.includes(dim)) return scene;
	return writeDelta(scene, machineId, stateId, part, (delta) => {
		const frame = { ...delta.frame };
		if (value === undefined || value.length === 0) delete frame[dim];
		else frame[dim] = value;
		return { ...delta, frame };
	});
}

/**
 * What one state says about one rotation of one definition part.
 *
 * The third of the three writers into a delta, beside {@link setStateProp} and
 * {@link setStateFrame}, and it exists for the reason {@link stateTouches} reads
 * `turn` at all: a state whose only delta is a rotation materialises no copy
 * without it, so `turn(stt(I,S,N),R,V)` has nothing to be about and a hover that
 * spins a card does nothing in a document that solves cleanly and reports
 * nothing.
 *
 * Not in the merged plan's list of edits, and added here rather than deferred
 * because `StatePart.turn` shipped in M3 and `srval(I,S,N,R)` shipped in M5 and
 * M8 — a document field with a compiler behind it and no way to write it is a
 * feature that exists everywhere except where a person could reach it.
 */
export function setStateTurn(
	scene: Scene,
	machineId: string,
	stateId: string,
	part: string,
	turn: Turn,
	value: Value | undefined,
): Scene {
	if (!Object.hasOwn(TURNS, turn)) return scene;
	return writeDelta(scene, machineId, stateId, part, (delta) => {
		const turns = { ...delta.turn };
		if (value === undefined || value.length === 0) delete turns[turn];
		else turns[turn] = value;
		return { ...delta, turn: turns };
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
	// The four gestures, and their verbs follow the press/release pattern above
	// rather than the trigger's own name for the reason the whole table exists:
	// `dragbegin` describes the hand and `grab` describes the card. Added here
	// because `Record<Trigger, string>` does not compile without them — the same
	// one-line departure from an ownership row that widening `Transition.easing`
	// forced one step ago, and stated rather than quietly made.
	viewenter: "reveal",
	viewleave: "hide",
	dragbegin: "grab",
	dragend: "drop",
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

/* ------------------------------------------------------------------ */
/* Three dimensions                                                    */
/* ------------------------------------------------------------------ */

/*
 * **A 3D object is an ordinary scene node**, so every edit in this section
 * builds a {@link SceneNode} and hands it to the same `mapTree` the rectangle
 * tool uses. There is no second document here: a mesh is `node/1` with a
 * `kind/2`, a `child/2`, an `order/2` and a `frame/3` like everything else, it
 * appears in the layer list, a rule can name it, and `deleteNodes` takes it away
 * with no case of its own. What is new is three fields — `spatial`, `turn` and
 * `mesh` — and every one of them is optional and sparse, so a flat document
 * holds none of them and costs exactly nothing.
 *
 * The one thing this section has to be careful about is *where* a fresh node
 * goes. A child's frame is relative to its parent's origin — the near-top-left
 * corner — so a mesh added to a viewport is placed in the **viewport's own model
 * space** and never in canvas coordinates. {@link addNodeTo} exists to do the
 * canvas-to-parent conversion for a pointer, and is exactly what these must not
 * use: there is no pointer here, and rebasing a number that was already local
 * would put the mesh an artboard's width away from the view it was added to.
 */

/**
 * Where a zero-sized node's frame goes so that its **centre** lands on `at`.
 *
 * A camera and a light have no size — `KINDS.camera.defaultSize` is 0×0 — and
 * yet `makeNode` stores {@link MIN_NODE_SIZE}, because a node the pointer cannot
 * grab is a node nobody can select. Everything that draws or measures one of
 * these reads its *centre* (`transformOf` is `origin + size/2`, and that is the
 * decision rotation rests on), so the two facts together mean a camera placed at
 * its eye position would sit two pixels off it. Half the minimum, subtracted
 * once, here, rather than at four call sites that could each get it wrong.
 */
const markerOrigin = (at: number): number => at - MIN_NODE_SIZE / 2;

/**
 * A fresh node of a 3D kind, with the sparse third axis it needs and no more.
 *
 * Only the dimensions the caller names are written, which is
 * {@link makeSpatial}'s rule and the whole of the no-regression story: absent is
 * z 0 and depth 0, so a camera that sits on the origin plane holds no `spatial`
 * at all rather than holding `{ z: "0px" }`. Two spellings of "flat" is the one
 * thing the third axis was designed not to have.
 */
function spatialNode(
	kind: NodeKind,
	frame: Frame,
	spatial: Partial<Record<Spatial, number>>,
	name: string,
): SceneNode {
	const node = makeNode(kind, frame, { name });
	const written = makeSpatial(spatial);
	return Object.keys(written).length > 0 ? { ...node, spatial: written } : node;
}

/**
 * Appends a node to a parent's children **without touching its frame**.
 *
 * The counterpart of {@link addNodeTo} and deliberately not a variant of it. That
 * one takes canvas coordinates because a pointer produces them; this one is for
 * a node whose frame is already stated in the parent's space, which is every 3D
 * node a menu creates — you cannot drag a box out in three dimensions with a
 * two-dimensional pointer and mean anything by it, so nothing here comes from a
 * gesture and nothing here has a canvas coordinate to convert.
 */
function appendChild(scene: Scene, parentId: string, node: SceneNode): Scene {
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === parentId ? { ...n, children: [...(n.children ?? []), node] } : n,
		),
	};
}

/** A record with one key taken away, when it holds it — never an explicit `undefined`. */
function without<T extends object, K extends keyof T>(record: T, key: K): T {
	if (!Object.hasOwn(record, key)) return record;
	const next = { ...record };
	delete next[key];
	return next;
}

/**
 * A record with one optional list written, or the key **taken away** when the
 * list is empty.
 *
 * "This machine has no layers" has one spelling — no key — and this is what keeps
 * it that way, for {@link writeDelta}'s reason one level up: `machineLayers`
 * reads an empty array and an absent field alike, so the two would never
 * disagree about behaviour, but a document that could hold either would diff
 * against itself and `normalizeScene` would drop one of them on the next read.
 */
function withList<T extends object, K extends keyof T & string>(
	record: T,
	key: K,
	list: readonly unknown[],
): T {
	if (list.length > 0) return { ...record, [key]: list } as T;
	return without(record, key);
}

/**
 * The same for an optional *record* — {@link SceneNode.states} is the only one
 * today, and it is the reason this is not {@link withList} with a looser type.
 *
 * The two look interchangeable and are not, which is a mistake this file made
 * once and is written down here so it cannot be made twice: handing
 * `Object.entries(...)` to `withList` typechecks, because the parameter is
 * `readonly unknown[]` and the return is a cast, and it writes an *array of
 * pairs* into a field every reader indexes by layer id. The document then holds
 * `states: [["glow","on"]]`, `shownStates` finds nothing under any layer, and
 * the instance silently falls back to every layer's initial state — a wrong
 * picture with no error anywhere. A record has its own front door for that
 * reason and for no other.
 */
function withRecord<T extends object, K extends keyof T & string>(
	record: T,
	key: K,
	entries: Record<string, unknown>,
): T {
	if (Object.keys(entries).length > 0) return { ...record, [key]: entries } as T;
	return without(record, key);
}

/**
 * A 3D view on the page, with the two things a scene cannot be looked at
 * without: one camera and one light.
 *
 * **Two, and not none**, which is the opposite call to {@link addMachine}'s one
 * state and {@link addStyle}'s one variant, and the difference is what an empty
 * one would look like. An empty machine still draws the component; an empty
 * style still leaves the nodes painted; a viewport with no camera and no light
 * is a black rectangle, and every question a person then asks — "is it broken?",
 * "did the mesh go in?" — is a question about the tool rather than the design.
 * So the view arrives able to show something, and both of them are ordinary
 * nodes in the layer list that can be moved, hidden or deleted.
 *
 * The camera sits one viewport-height back on the near side (**−z is toward the
 * viewer**, §2.4) and looks down the axis. With `PROPS.fov`'s 50° that frames
 * about one viewport height at the origin plane, which is where {@link addMesh}
 * puts a solid — so the first mesh somebody adds is in shot, at a sensible size,
 * with no camera work at all. The light is up, forward and to the left of it,
 * which is where a key light goes.
 *
 * `frame` is in **canvas coordinates** — this is the one thing here a pointer
 * really does draw out — so it goes through {@link addNodeTo} like any other
 * drawn node. Its contents do not: they are already in the view's own space.
 */
export function addViewport(
	scene: Scene,
	parent: string | null,
	frame: Frame,
	picks: Picks = {},
): Scene {
	const box = normaliseFrame(frame);
	const camera = spatialNode(
		"camera",
		{
			x: markerOrigin(box.width / 2),
			y: markerOrigin(box.height / 2),
			width: 0,
			height: 0,
		},
		{ z: -box.height },
		"Camera",
	);
	const light = spatialNode(
		"light",
		{
			x: markerOrigin(box.width / 4),
			y: markerOrigin(-box.height / 4),
			width: 0,
			height: 0,
		},
		{ z: -box.height / 2 },
		"Key light",
	);
	const view: SceneNode = {
		...makeNode("viewport", box),
		camera: camera.id,
		children: [camera, light],
	};
	return addNodeTo(scene, parent, view, picks);
}

/**
 * The point at the middle of a viewport's origin plane, in its own model space
 * — where a fresh object goes.
 *
 * The origin of that space is the view's near-top-left corner, so the middle is
 * half the width across and half the height down, at z 0. Nothing here is
 * clever; it is written down once because four functions want it and because
 * getting it wrong puts a new mesh in a corner nobody is looking at.
 */
function viewCentre(
	scene: Scene,
	viewport: SceneNode,
	picks: Picks,
): { x: number; y: number } {
	const box = frameOf(viewport, sceneContext(scene, picks));
	return { x: box.width / 2, y: box.height / 2 };
}

/**
 * The viewport a 3D add-edit was aimed at, or nothing.
 *
 * Strict: a `pivot` is not a viewport and neither is a frame. Adding is *into a
 * view*, and putting a mesh further down the tree is {@link reparent}, which
 * already exists and is the general gesture — a second, subtly different
 * insertion path would be a second set of coordinate rules to get wrong.
 */
function viewportNode(scene: Scene, id: string): SceneNode | undefined {
	const node = findInTree(scene.nodes, id);
	return node?.kind === "viewport" ? node : undefined;
}

/**
 * One of the six primitives, in the middle of the view and in front of its
 * camera.
 *
 * The size is `KINDS.mesh.defaultSize` on all three axes — a cube rather than a
 * card, because a `plane` is one of the six and a solid that arrived flat would
 * be indistinguishable from one. `depth` is therefore the one spatial entry it
 * is born with; `z` stays absent, which reads as zero and means the solid
 * straddles nothing and sits on the origin plane.
 *
 * The primitive is a {@link Value} on the `solid` property and not a field, which
 * is `PROPS.solid`'s own argument: `[box, sphere]` is a real design question with
 * two answers, and a field would have put that variation outside the multiverse.
 * An unknown word is kept rather than repaired — `tessellate` falls back to a box
 * the way a dangling anything else falls back — and only an empty one takes the
 * table's fallback, because a property with no value at all decides nothing.
 */
export function addMesh(scene: Scene, viewport: string, solid: string): Scene {
	const view = viewportNode(scene, viewport);
	if (!view) return scene;
	const centre = viewCentre(scene, view, {});
	const size = KINDS.mesh.defaultSize;
	const word = solid.trim() || VALUE_TYPES.solid.fallback;
	const node = spatialNode(
		"mesh",
		{
			x: centre.x - size.width / 2,
			y: centre.y - size.height / 2,
			width: size.width,
			height: size.height,
		},
		{ depth: size.width },
		optionLabel("solid", word),
	);
	return appendChild(scene, viewport, {
		...node,
		props: { ...node.props, solid: single(word) },
	});
}

/**
 * Another eye, where the first one is.
 *
 * It becomes the view's own camera **only when the view has not got one**, which
 * is the difference between helping and overruling: the first camera somebody
 * adds is obviously the one to look through, and the third is obviously not. A
 * dangling `camera` counts as having one, for `normalizeScene`'s reason — it is
 * kept on read precisely so that deleting a camera leaves a repairable document,
 * and silently re-pointing it here would repair it behind the designer's back.
 */
export function addCamera(scene: Scene, viewport: string): Scene {
	const view = viewportNode(scene, viewport);
	if (!view) return scene;
	const centre = viewCentre(scene, view, {});
	const box = frameOf(view, sceneContext(scene, {}));
	const camera = spatialNode(
		"camera",
		{
			x: markerOrigin(centre.x),
			y: markerOrigin(centre.y),
			width: 0,
			height: 0,
		},
		{ z: -box.height },
		"Camera",
	);
	const next = appendChild(scene, viewport, camera);
	if (view.camera !== undefined) return next;
	return mapSelected(next, [viewport], (n) => ({ ...n, camera: camera.id }));
}

/**
 * A lamp of one of the four kinds — see `PROPS.lamp`.
 *
 * Its colour is `ink`, "the colour the thing itself is", so a brand palette
 * lights the scene with nothing wired up; its kind is a `Value` for
 * {@link addMesh}'s reason exactly. Where the light *is* matters for two of the
 * four kinds and not for the other two, and it is placed as though it mattered
 * for all of them: an `ambient` lamp with a position is a position nothing reads,
 * which costs nothing, and a lamp somebody switches to `directional` afterwards
 * is then already somewhere sensible instead of inside the subject.
 */
export function addLight(scene: Scene, viewport: string, lamp: string): Scene {
	const view = viewportNode(scene, viewport);
	if (!view) return scene;
	const box = frameOf(view, sceneContext(scene, {}));
	const word = lamp.trim() || VALUE_TYPES.lamp.fallback;
	const node = spatialNode(
		"light",
		{
			x: markerOrigin(box.width / 4),
			y: markerOrigin(-box.height / 4),
			width: 0,
			height: 0,
		},
		{ z: -box.height / 2 },
		optionLabel("lamp", word),
	);
	return appendChild(scene, viewport, {
		...node,
		props: { ...node.props, lamp: single(word) },
	});
}

/**
 * Imported geometry, and the entry in the index that says what it is.
 *
 * **The bytes are not here.** The caller has already written the file into the
 * project's tree and hands over the path, the part and the metadata. The
 * document holds a reference for the reason every other big thing in it is held
 * by reference: a glTF is megabytes, the document is edited by two people at
 * once, and a payload in the document is a payload in every diff, every undo
 * entry and every sync message. That is now exactly the `path` precedent an
 * `image` follows rather than a departure from it, which it was when the
 * reference was a content hash — see `docs/model-files.md` §0.
 *
 * The ordering that implies is not a detail and is enforced by the signature
 * taking a finished {@link MeshRef}: the file must be *written first*, because
 * only the write knows the final path — `putNamedAsset` resolves a collision by
 * suffixing, so a second `chair.glb` lands at `chair-2.glb` and a ref built
 * before the write would point at the first person's chair. `Studio.tsx` does
 * write, then import, then call this.
 *
 * The doc comment used to carry a paragraph here explaining that this verb was
 * reachable from nothing but its own test, because there was no store to put
 * bytes in and a model minted against a hash nothing could load would draw a
 * bounding box and export an empty mesh. That paragraph is gone because the
 * condition is: the tree is the store, `Studio.tsx` calls the import path from
 * the viewport's own menu, and a browser has been shown a file going in and a
 * node coming out with the path on it.
 *
 * The node's box is the model's own bounds, centred in the view, so an import
 * arrives at the size it really is rather than at a size this file invented — a
 * chair modelled a metre tall is a metre tall, and a designer who wants it
 * smaller resizes it and can see what they did. Bounds that say nothing fall back
 * to `KINDS.model.defaultSize`, because a box of nothing is not a thing anybody
 * can grab and drag out to the size they meant.
 */
export function addModel(
	scene: Scene,
	viewport: string,
	ref: MeshRef,
	info: AssetInfo,
	/**
	 * The file's material as ordinary props — `fill`, `roughness`, `metalness`,
	 * `opacity` — or nothing where the caller has none.
	 *
	 * **Optional and last, and it was found missing in a browser rather than in a
	 * test.** `importGltf` turns a glTF material into exactly these four props on
	 * the node it mints, which is the whole reason an imported chair is a chair a
	 * designer can recolour with a token. {@link addImport} short-circuits a
	 * one-part file to this verb, and this verb built its node from `ref` and
	 * `info` alone — so a file holding a single mesh arrived **grey**, wearing
	 * `Model.tsx`'s stand-in colour, while the same file with two meshes in it
	 * came in wearing its own. One import path painted and the other did not, and
	 * the difference was how many meshes the person happened to have modelled.
	 *
	 * Nothing headless caught it: the props were on a node the shortcut threw
	 * away, so every assertion about materials was made against the multi-part
	 * path that keeps them. It took looking at a viewport.
	 *
	 * A parameter rather than a `SceneNode` argument, because everything else the
	 * imported node carries is something this verb deliberately decides for
	 * itself: the name comes from `info`, and the frame is the view's centre and
	 * the model's own bounds. The material is the one thing that belongs to the
	 * file and to nobody else.
	 */
	props?: Partial<Record<PropName, Value>>,
): Scene {
	const view = viewportNode(scene, viewport);
	if (!view) return scene;
	const centre = viewCentre(scene, view, {});
	const fallback = KINDS.model.defaultSize;
	const width = ref.bounds?.width > 0 ? ref.bounds.width : fallback.width;
	const height = ref.bounds?.height > 0 ? ref.bounds.height : fallback.height;
	const depth = ref.bounds?.depth > 0 ? ref.bounds.depth : fallback.width;
	const node = spatialNode(
		"model",
		{
			x: centre.x - width / 2,
			y: centre.y - height / 2,
			width,
			height,
		},
		{ depth },
		info.name.trim() || KINDS.model.label,
	);
	const placed = appendChild(scene, viewport, {
		...node,
		// Merged over the kind's defaults rather than replacing them, which is what
		// `spatialNode` already put in `props` and what every other add verb
		// leaves alone. `KINDS.model` states no `fill` default on purpose — an
		// imported material is the file's — so in practice there is nothing under
		// these to overwrite, and spelling it as a merge is what keeps that a fact
		// about the table rather than a thing this line depends on.
		props: { ...node.props, ...props },
		mesh: ref,
	});
	// Keyed by the file's path, which is one entry per *file* and not one per
	// primitive: a chair whose six parts became six nodes has one index entry
	// with one byte count, so `assetTotalBytes` totals what would actually be
	// downloaded. See `assets.ts`, which argues that this is the whole of what
	// re-keying the index bought.
	return { ...placed, assets: { ...placed.assets, [ref.src]: info } };
}

/**
 * A whole glTF import, landed in one view — the edit half of `importGltf`.
 *
 * The importer hands back a subtree whose leaves reference one file by path; the
 * file itself was written to the project's tree before the importer ran, which
 * is the caller's business because it is I/O, and this is everything else: the
 * nodes into the tree and the metadata into `Scene.assets`, in one edit so that
 * one ⌘Z takes the whole chair back out.
 *
 * The ⌘Z is worth a second sentence now that the bytes are a file. Undoing this
 * removes the nodes and the index entry and **leaves the file in the tree**,
 * which is deliberate: an import a person took back is an arrangement they did
 * not want, not a download they want to do again, and the next import of the
 * same name would collide with it and land at `chair-2.glb`. That is the
 * behaviour a person who re-imports actually wants to notice, and it is cheaper
 * to notice than to have silently lost the bytes.
 *
 * **One primitive is centred; several keep their arrangement.** A file holding a
 * single mesh has no arrangement to preserve — its origin is wherever the person
 * who exported it left it, which is as likely to be a metre off in z as not — so
 * it goes through {@link addModel} and lands in shot, the same as a cube from the
 * add row. A file holding several *is* an arrangement: a chair is a seat, a back
 * and four legs whose whole meaning is where they are relative to each other, and
 * re-centring each one would deliver a pile of parts. The importer has already
 * put those frames in the view's space, so they are appended as they came.
 *
 * A viewport this document does not hold leaves the scene alone, like every other
 * verb here — an import whose target was deleted while the file was being read is
 * a no-op rather than a throw.
 */
export function addImport(
	scene: Scene,
	viewport: string,
	nodes: readonly SceneNode[],
	assets: Readonly<Record<string, AssetInfo>>,
): Scene {
	if (!viewportNode(scene, viewport) || nodes.length === 0) return scene;
	const [only] = nodes;
	if (nodes.length === 1 && only.mesh && !only.children?.length) {
		const info = assets[only.mesh.src];
		// `only.props` and not `{}`: the file's material is on the node the
		// importer minted, and dropping it here is what made a one-mesh file arrive
		// grey while a two-mesh one arrived painted. See {@link addModel}'s fifth
		// parameter, which is where that whole story is written down.
		if (info) return addModel(scene, viewport, only.mesh, info, only.props);
	}
	let next = scene;
	for (const node of nodes) next = appendChild(next, viewport, node);
	// Merged rather than replaced: another model in another view may already
	// reference the path this import writes, and the later entry wins because it
	// describes the file that is at that path *now*. Under content addressing the
	// two entries were guaranteed to describe identical bytes and the merge
	// direction did not matter; under paths it does, and this is the direction
	// that matches "replacing the file replaces the picture".
	return { ...next, assets: { ...next.assets, ...assets } };
}

/**
 * Which camera a view looks through, or `null` for none.
 *
 * The camera has to be a camera **and inside this view**, which is `vcam/2`'s own
 * three conditions and `cameraOf`'s: a view that named a rectangle, or a camera
 * belonging to the view next to it, would be a view whose picture the document
 * and the renderer disagree about. A name that fails them is refused at the edit
 * rather than kept and ignored, because unlike a `camera` that has gone dangling
 * — which is a deletion to repair — this one is a choice being made now, and
 * there is nothing yet to lose by saying no.
 *
 * `null` **removes the field** rather than writing an empty string. An empty
 * constant is not a node id and `vcam/2` would derive nothing from it either way,
 * so the two behave alike in the program and differ everywhere a person looks: a
 * `camera: ""` shows up in a diff, in a JSON file and in an inspector as a
 * setting somebody made.
 */
export function setViewportCamera(
	scene: Scene,
	viewport: string,
	camera: string | null,
): Scene {
	const view = viewportNode(scene, viewport);
	if (!view) return scene;
	if (camera !== null) {
		const target = flatten(view.children ?? []).find((n) => n.id === camera);
		if (target?.kind !== "camera") return scene;
	}
	if ((view.camera ?? null) === camera) return scene;
	return mapSelected(scene, [viewport], (n) =>
		camera === null ? without(n, "camera") : { ...n, camera },
	);
}

/**
 * Replaces one spatial dimension's whole list of alternatives — the twin of
 * {@link setFrameValue}, one axis over.
 *
 * Like that one, this is the only edit that changes how *many* positions a node
 * has on the third axis, and a drag never comes through here — `withSpatial` is
 * the gesture writer and it writes to the alternative the visible universe
 * picked.
 *
 * Offered on **every kind**, and that is the invariant rather than an oversight.
 * A `rect` with a `z` and a `rotateY` on a plain artboard is exactly what the
 * CSS-3D half of the export is for; the document decides what is in the third
 * axis, not the kind — which is what `zstated/1` says in the program and what
 * `isSpatialNode` says in TypeScript.
 *
 * An empty {@link Value} is {@link clearSpatial}, so that "this node says nothing
 * about z" keeps having one spelling however it was arrived at.
 */
export function setSpatialValue(
	scene: Scene,
	id: string,
	dim: Spatial,
	value: Value,
): Scene {
	if (!SPATIALS.includes(dim)) return scene;
	if (value.length === 0) return clearSpatial(scene, id, dim);
	return mapSelected(scene, [id], (node) => ({
		...node,
		spatial: { ...node.spatial, [dim]: value },
	}));
}

/** The same for one rotation, in whatever angle unit it is spelled in. */
export function setTurnValue(
	scene: Scene,
	id: string,
	turn: Turn,
	value: Value,
): Scene {
	if (!Object.hasOwn(TURNS, turn)) return scene;
	if (value.length === 0) return clearTurn(scene, id, turn);
	return mapSelected(scene, [id], (node) => ({
		...node,
		turn: { ...node.turn, [turn]: value },
	}));
}

/**
 * "This node is not lifted", said in one gesture — and the record goes with the
 * last entry.
 *
 * {@link writeDelta}'s rule, applied to a node instead of to a delta and for the
 * same reason: `spatial: {}` and no `spatial` are the same claim, `isSpatialNode`
 * and the compiler's gate both read them alike, and a document that could hold
 * either would put a viewport-free file into three dimensions the moment somebody
 * lifted a rectangle and put it back.
 */
export function clearSpatial(scene: Scene, id: string, dim: Spatial): Scene {
	const node = findInTree(scene.nodes, id);
	if (node?.spatial?.[dim] === undefined) return scene;
	return mapSelected(scene, [id], (n) => {
		const spatial: SpatialValue = without(n.spatial ?? {}, dim);
		return Object.keys(spatial).length > 0
			? { ...n, spatial }
			: without(n, "spatial");
	});
}

/** The same for one rotation. */
export function clearTurn(scene: Scene, id: string, turn: Turn): Scene {
	const node = findInTree(scene.nodes, id);
	if (node?.turn?.[turn] === undefined) return scene;
	return mapSelected(scene, [id], (n) => {
		const turns: TurnValue = without(n.turn ?? {}, turn);
		return Object.keys(turns).length > 0 ? { ...n, turn: turns } : without(n, "turn");
	});
}

/**
 * Puts the named nodes under a fresh pivot, at their middle, without moving any
 * of them.
 *
 * A pivot rather than a group, and the difference is the one `KINDS.pivot` states:
 * a group is `wrapsChildren` and re-fits to its children's 2D bounding box, which
 * inside a view is meaningless — the bounding box of rotated solids is exactly
 * the trigonometry a linear solver cannot do. A pivot is a place and a rotation
 * and has nothing to re-fit.
 *
 * **At their middle**, because a pivot turns about its own centre and that centre
 * is the whole reason to make one. So the children are rebased by however far the
 * pivot moved, which keeps the picture identical — and it is the one thing here
 * that can fail. `withFrame` and `withSpatial` will not overwrite an alternative
 * that is a token or a derivation: that number is the token's to decide, and
 * unwiring it would silently break a link the designer set up. A child whose x is
 * a link therefore *cannot* be rebased, and grouping it would move it by the
 * pivot's offset — so the whole edit is refused instead, exactly as the editor
 * refuses to drag such an axis and hides the resize handles. The panel greys the
 * button using `frameFrozen` and says why.
 *
 * The middle is the middle of the **boxes the document holds**, not of the shapes
 * on screen: a turned child occupies a region whose extent is
 * `|w·cos θ| + |h·sin θ|`, which is irrational for all but a handful of angles,
 * and `axisBounds` refuses to return a box for it rather than return a rounded
 * lie. Averaging one here would be that same lie with a friendlier name.
 */
export function addPivot(
	scene: Scene,
	viewport: string,
	children: readonly string[],
	picks: Picks = {},
): Scene {
	const view = viewportNode(scene, viewport);
	if (!view) return scene;
	const wanted = new Set(children);
	const moving = (view.children ?? []).filter((n) => wanted.has(n.id));
	if (moving.length === 0) return scene;

	const context = sceneContext(scene, picks);
	let low = { x: Infinity, y: Infinity, z: Infinity };
	let high = { x: -Infinity, y: -Infinity, z: -Infinity };
	for (const child of moving) {
		const box = frameOf(child, context);
		const z = spatialDim(child, "z", context);
		const depth = spatialDim(child, "depth", context);
		low = {
			x: Math.min(low.x, box.x),
			y: Math.min(low.y, box.y),
			z: Math.min(low.z, z),
		};
		high = {
			x: Math.max(high.x, box.x + box.width),
			y: Math.max(high.y, box.y + box.height),
			z: Math.max(high.z, z + depth),
		};
	}
	const pivot = spatialNode(
		"pivot",
		{
			x: markerOrigin((low.x + high.x) / 2),
			y: markerOrigin((low.y + high.y) / 2),
			width: 0,
			height: 0,
		},
		{ z: (low.z + high.z) / 2 },
		KINDS.pivot.label,
	);
	// What the document actually stored, rather than what was asked for:
	// `makeNode` quantizes every length a gesture writes onto the pixel grid, so
	// the offset the children are shifted by has to be read back off the node or
	// the group drifts by up to half a pixel on each axis.
	const at = frameOf(pivot);
	const origin = { x: at.x, y: at.y, z: spatialDim(pivot, "z") };

	const stuck = moving.some(
		(child) =>
			(origin.x !== 0 && frameFrozen(child, "x", context)) ||
			(origin.y !== 0 && frameFrozen(child, "y", context)) ||
			(origin.z !== 0 && spatialFrozen(child, "z", context)),
	);
	if (stuck) return scene;

	const inside = moving.map((child) => {
		const box = frameOf(child, context);
		const shifted = withFrame(
			child,
			{ x: box.x - origin.x, y: box.y - origin.y },
			context,
		);
		return origin.z === 0
			? shifted
			: withSpatial(
					shifted,
					{ z: spatialDim(child, "z", context) - origin.z },
					context,
				);
	});
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === viewport
				? {
						...n,
						children: [
							...(n.children ?? []).filter((c) => !wanted.has(c.id)),
							{ ...pivot, children: inside },
						],
					}
				: n,
		),
	};
}

/**
 * Assets nothing references any more, dropped from the index.
 *
 * The counterpart of `normalizeScene`'s deliberate hoarding, and the two are a
 * pair rather than a disagreement: **an unreferenced asset is kept on read**,
 * because a paste may be about to reference one and opening a file must not be a
 * destructive act, and dropped on an **edit**, because by then the document has
 * been changed by somebody who was looking at it. Undo is a stack of documents,
 * so the entry comes back with the model it belonged to.
 *
 * Called by {@link deleteNodes} and by nothing else, for the reason
 * {@link pruneMachines} is: a reference disappears when a node does, and every
 * path that deletes a node goes through there.
 *
 * **It drops the index entry and never the file.** That was invisible when the
 * index was keyed by content hash and the payloads lived in a store nothing in
 * the tree implemented; it is a real choice now that the key is a path into a
 * tree a person can open. Deleting the last chair in a document does not delete
 * `/assets/chair.glb`, because the file is a thing the person put in their
 * project and the index is a thing this document remembers about it. Garbage
 * collecting the tree is a decision for a person looking at a file browser, and
 * an edit that quietly deleted megabytes on a ⌫ would be the kind of helpfulness
 * nobody can undo.
 *
 * **And it still does not touch `node.image.src`**, which is deliberate rather
 * than an oversight even now that both kinds are paths. An image's intrinsic
 * size is on its own ref, no panel totals photographs, and there is no
 * `AssetInfo` for one to prune. Widening the index to both kinds is a separate
 * change with its own argument to make.
 */
export function pruneAssets(scene: Scene): Scene {
	if (scene.assets === undefined) return scene;
	const used = new Set(
		flatten(scene.nodes)
			.map((node) => node.mesh?.src)
			.filter((src): src is string => src !== undefined),
	);
	const kept = Object.entries(scene.assets).filter(([src]) => used.has(src));
	if (kept.length === Object.keys(scene.assets).length) return scene;
	return kept.length > 0
		? { ...scene, assets: Object.fromEntries(kept) }
		: without(scene, "assets");
}

/* ------------------------------------------------------------------ */
/* Fonts                                                               */
/* ------------------------------------------------------------------ */

/*
 * **A font declaration is not a design-space one.** Neither edit below can add a
 * universe, and — unlike an input, which had to be argued into that shape — this
 * one is structural: `Scene.fonts` is a list of records the compiler never
 * opens. A `font` *token* holding two families is two universes and always was,
 * which is the value system working and is the only way fonts branch the space.
 */

/**
 * Declare a face this page may set text in.
 *
 * Idempotent on `src`: adding the same file twice replaces the declaration
 * rather than doubling it, because the second add is either the panel's "add to
 * this page" pressed twice or an upload that landed on a path the page already
 * names, and two entries for one file would emit two `@font-face` rules and
 * total the bytes twice. Replacing rather than ignoring is what makes the panel's
 * descriptor fields writable through this one door.
 *
 * The declaration goes in **last**, in the order faces were added, and the panel
 * sorts for display. Two faces of one family therefore keep the order somebody
 * uploaded them in, which is the order the `@font-face` rules come out in and so
 * the order a browser resolves a tie in — a fact worth having be the designer's
 * rather than a sort's.
 */
export function addFont(scene: Scene, file: FontFile): Scene {
	const before = scene.fonts ?? [];
	const at = before.findIndex((f) => f.src === file.src);
	const fonts =
		at === -1
			? [...before, file]
			: before.map((f, i) => (i === at ? file : f));
	return { ...scene, fonts };
}

/**
 * Stop declaring the face at one path.
 *
 * **It does not delete the file**, and that is the whole difference between this
 * and every other removal in this module. Another page may declare the same
 * bytes — that is the mitigation for the roster being per page — and
 * `putNamedAsset` has no counterpart that removes anyway. So "remove from page"
 * is what the button says and what this does.
 *
 * Nor does it repair the values that named the family, which `deleteToken` would
 * have done. A `fontFamily` is a CSS stack with a real fallback tail behind it,
 * so a value whose face has gone paints the rest of its stack — which is exactly
 * what a collaborator without the assets already sees, and is a design that is
 * different rather than broken. Rewriting every stack in the document on a
 * removal would be an edit nobody asked for, in return for a state the tool has
 * to handle correctly regardless.
 *
 * The key goes away rather than becoming `[]`, so "this document declares no
 * fonts" keeps one spelling — see {@link Scene.fonts}.
 */
export function removeFont(scene: Scene, src: string): Scene {
	const before = scene.fonts ?? [];
	const fonts = before.filter((f) => f.src !== src);
	if (fonts.length === before.length) return scene;
	return fonts.length > 0 ? { ...scene, fonts } : without(scene, "fonts");
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/*
 * **An input is a runtime value and never a design-space one.** Nothing in this
 * section can add a universe, and that is not a happy accident: every field an
 * input holds is a plain string rather than a {@link Value}, so there is nowhere
 * for an alternative to go. A document with three inputs has exactly the universe
 * count of the same document with none — see {@link MachineInput}, which argues
 * it at length, and `machineprogram.test.ts`, which asserts it.
 */

/** Replaces one input of one machine, if it holds it. */
function mapInput(
	scene: Scene,
	machineId: string,
	inputId: string,
	fn: (input: MachineInput) => MachineInput,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const before = machine.inputs ?? [];
		const inputs = before.map((x) => (x.id === inputId ? fn(x) : x));
		return inputs.some((x, i) => x !== before[i]) ? { ...machine, inputs } : machine;
	});
}

/**
 * An input, with the resting value its kind implies and no range at all.
 *
 * **No range**, and it is the one field worth arguing about: absent is *open*,
 * not zero. A designer who has not said how far the drawer opens has not said it
 * does not open, and an edit that wrote `min: "0"` here would have the two checks
 * that read a range reporting violations against a claim nobody made — a guard
 * greyed out as impossible because of a number this function invented.
 *
 * The id is derived from the name rather than generated, which is
 * {@link addState}'s call and it applies here for the same three reasons: an
 * input id is read in `minput(m1,open)` in the program panel, typed into a
 * condition row, and handed to `MachineTable`'s runtime by a host page. `x_3f2a`
 * in all three places would be a machine nobody could drive.
 */
export function addInput(
	scene: Scene,
	machineId: string,
	kind: InputKind = "boolean",
	name?: string,
): { scene: Scene; id: string } {
	const machine = findMachine(scene.machines, machineId);
	if (!machine) return { scene, id: "" };
	if (!Object.hasOwn(INPUT_KINDS, kind)) return { scene, id: "" };
	const existing = machine.inputs ?? [];
	const label = name?.trim() || "";
	const id = uniqueConstant(existing.map((x) => x.id), constantFrom(label) ?? "input");
	const input: MachineInput = {
		id,
		name: uniqueName(existing.map((x) => x.name), label || "Input", " "),
		kind,
		...(INPUT_KINDS[kind].fallback ? { initial: INPUT_KINDS[kind].fallback } : {}),
	};
	return {
		scene: mapMachine(scene, machineId, (m) => ({ ...m, inputs: [...existing, input] })),
		id,
	};
}

/**
 * Renames an input. **The name, never the id** — {@link renameState}'s argument,
 * one rung along: the id is in every `mcondin/4` the guards ground, in
 * `mblendin/3`, and in the `InputValues` record a host page hands the runtime.
 * Renaming through to the id would silently unwire every guard that reads it and
 * the failure would only show up when somebody pressed something.
 */
export function renameInput(
	scene: Scene,
	machineId: string,
	inputId: string,
	name: string,
): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return mapInput(scene, machineId, inputId, (input) =>
		input.name === trimmed ? input : { ...input, name: trimmed },
	);
}

/**
 * Changes what kind of thing an input is.
 *
 * **Nothing else is repaired**, and that is the interesting half. A boolean
 * turned into a number leaves `initial: "false"`, which `permilleOf` reads as
 * nothing, so `inputInitial` falls to the kind's own fallback and the program
 * gains no `minnum/3`; the conditions that compared it with `is` are still
 * conditions, and `mcbad/3` reports every one of them. That is the whole of the
 * design: the mistake is *shown* rather than tidied away, in the panel, on the
 * rows it is about — and one undo puts every field back, which a repair that
 * rewrote four comparands could not offer.
 */
export function setInputKind(
	scene: Scene,
	machineId: string,
	inputId: string,
	kind: InputKind,
): Scene {
	if (!Object.hasOwn(INPUT_KINDS, kind)) return scene;
	return mapInput(scene, machineId, inputId, (input) =>
		input.kind === kind ? input : { ...input, kind },
	);
}

/**
 * What an input holds before anybody drives it — `null` for "whatever the kind
 * starts at".
 *
 * Not in the merged plan's list and added for {@link setStateTurn}'s reason:
 * `MachineInput.initial` is a document field the compiler emits as `minbool/3`
 * and `minnum/3`, and a field with a compiler behind it and no writer is a
 * feature nobody can reach. A trigger has no resting value — "not fired" is the
 * absence of one — so the field is dropped rather than stored on one.
 */
export function setInputInitial(
	scene: Scene,
	machineId: string,
	inputId: string,
	initial: string | null,
): Scene {
	return mapInput(scene, machineId, inputId, (input) => {
		const wanted = input.kind === "trigger" ? null : initial;
		if ((input.initial ?? null) === wanted) return input;
		return wanted === null ? without(input, "initial") : { ...input, initial: wanted };
	});
}

/**
 * The closed ends of a number input's range — `null` at either end is **open**.
 *
 * Two explicit arguments rather than a patch, because the two states this has to
 * distinguish are "leave it alone" and "there is no minimum", and a patch of
 * `{ min: undefined }` spells both. The distinction is the whole meaning of the
 * field: a range is what the checks judge a guard and a blend threshold against,
 * so an end that quietly became zero would make `mguardnever` and `mstopout`
 * report against a claim nobody made.
 *
 * Stored as typed, whatever it says. `permilleOf` reads it or does not, and a
 * range that reads as nothing is a range the checks stay silent about — which is
 * the same answer an absent one gets, arrived at honestly rather than by
 * repairing the text somebody typed while they were still typing it.
 */
export function setInputRange(
	scene: Scene,
	machineId: string,
	inputId: string,
	min: string | null,
	max: string | null,
): Scene {
	return mapInput(scene, machineId, inputId, (input) => {
		let next = input;
		if ((next.min ?? null) !== min) {
			next = min === null ? without(next, "min") : { ...next, min };
		}
		if ((next.max ?? null) !== max) {
			next = max === null ? without(next, "max") : { ...next, max };
		}
		return next;
	});
}

/**
 * Takes an input away, and every condition that was about it.
 *
 * The conditions go, and this is {@link deleteState}'s judgement rather than
 * {@link deleteMachine}'s. The line between the two is what the leftover would
 * *derive*: an edge with a missing end derives `mdangling/2` and a condition with
 * a missing input derives `mcbad/3` — violations in the panel that the designer
 * did not write and cannot read the cause of — whereas a state naming a deleted
 * timeline derives nothing at all, and silence is a thing undo can put right.
 * So a leftover that would accuse somebody is removed, and a leftover that would
 * merely wait is kept.
 *
 * A guard is a conjunction, so removing one conjunct leaves an edge that fires
 * more often. That is the honest consequence of deleting the input it was about,
 * and the alternative — deleting the whole transition — would take away edges
 * that had three other conditions on them.
 *
 * A **blend state** that blends along this input is left exactly as it is. It
 * derives nothing: `mstopout/3` and `mstopgap/2` join `minlow`/`minhigh` and
 * find nobody, so the checks go quiet rather than wrong, and the blend is still
 * a blend with its stops and its timelines. Un-wiring it here would lose a
 * mixture somebody built in order to tidy a field they could set again in one
 * click.
 */
export function deleteInput(scene: Scene, machineId: string, inputId: string): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const before = machine.inputs ?? [];
		const inputs = before.filter((x) => x.id !== inputId);
		if (inputs.length === before.length) return machine;
		const transitions = machine.transitions.map((t) => {
			if (!t.conditions?.some((c) => c.input === inputId)) return t;
			return withList(t, "conditions", t.conditions.filter((c) => c.input !== inputId));
		});
		const kept = withList(machine, "inputs", inputs);
		return transitions.some((t, i) => t !== machine.transitions[i])
			? { ...kept, transitions }
			: kept;
	});
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

/*
 * A condition has **no id**, and these three take an index instead. That is a
 * decision the type makes rather than one this file makes: a guard is a
 * conjunction in document order, the program numbers the conjuncts `1..n` as it
 * emits them (`mcond(M,T,K)`), and `mcbad(M,T,K)` and `viol` name a condition by
 * that number — so an id here would be a second name for a thing the panel, the
 * program and the violation already agree how to point at.
 *
 * **One-based**, matching what the compiler emits and therefore what a person
 * reads in a violation. Every index in this half of the file is: conditions,
 * keyframes and blend stops all reach the program as `K = index + 1`, and an
 * editor counting from zero beside a panel counting from one is the oldest
 * off-by-one there is.
 */

/** Replaces one transition of one machine, if it holds it. */
function mapTransition(
	scene: Scene,
	machineId: string,
	transitionId: string,
	fn: (transition: Transition) => Transition,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const transitions = machine.transitions.map((t) =>
			t.id === transitionId ? fn(t) : t,
		);
		return transitions.some((t, i) => t !== machine.transitions[i])
			? { ...machine, transitions }
			: machine;
	});
}

/**
 * A conjunct on an edge's guard, about one input.
 *
 * The comparand starts at the input's **own resting value**, through
 * `INPUT_KINDS`, so a fresh row says something true and harmless — "while `open`
 * is false" — rather than something this file invented. A trigger takes `fired`
 * and no comparand, because "the trigger happened" is the whole of what there is
 * to say about a moment.
 *
 * **Refused where the machine has no inputs at all.** A condition names an input;
 * one that named nothing would be `mcbad/3` at the instant it was created, which
 * is an accusation the designer earned by pressing a button. The panel disables
 * the control instead, which is where a person can see why.
 */
export function addCondition(
	scene: Scene,
	machineId: string,
	transitionId: string,
	input?: string,
): Scene {
	const machine = findMachine(scene.machines, machineId);
	if (!machine) return scene;
	const chosen = findInput(machine, input) ?? (machine.inputs ?? [])[0];
	if (!chosen) return scene;
	const condition: Condition =
		chosen.kind === "trigger"
			? { input: chosen.id, op: "fired" }
			: {
					input: chosen.id,
					op: "eq",
					value: chosen.initial ?? INPUT_KINDS[chosen.kind].fallback,
				};
	return mapTransition(scene, machineId, transitionId, (t) => ({
		...t,
		conditions: [...(t.conditions ?? []), condition],
	}));
}

/**
 * Changes one conjunct — its input, its operator, its comparand.
 *
 * One patch rather than three setters, {@link updateTransition}'s shape and its
 * reason: a condition is one row of one panel with three controls on it.
 *
 * An operator the table has not got is refused, because it would reach the
 * program as a term no rule reads; an operator the input's *kind* does not take
 * is **kept**, because that is a mistake with a name — `mcbad/3` — and a row the
 * panel greys and explains. The line between the two is the line the whole
 * feature keeps: a syntax error is refused, and a wrong statement is reported.
 */
export function updateCondition(
	scene: Scene,
	machineId: string,
	transitionId: string,
	index: number,
	patch: Partial<Condition>,
): Scene {
	if (patch.op !== undefined && !Object.hasOwn(COMPARE_OPS, patch.op)) return scene;
	if (patch.input !== undefined && wordOf(patch.input) !== patch.input) return scene;
	return mapTransition(scene, machineId, transitionId, (t) => {
		const before = t.conditions ?? [];
		if (index < 1 || index > before.length) return t;
		const conditions = before.map((condition, i) => {
			if (i !== index - 1) return condition;
			const next: Condition = { ...condition, ...patch };
			// A comparand set to nothing leaves as a key rather than as an explicit
			// `undefined`, so that a condition on a `fired` and a condition whose
			// value somebody cleared are the same object shape — `Object.hasOwn` is
			// what `normalizeConditions` asks, and a diff is what a person reads.
			const written = next.value === undefined ? without(next, "value") : next;
			const keys = Object.keys(patch) as Array<keyof Condition>;
			return keys.every((key) => Object.is(condition[key], written[key]))
				? condition
				: written;
		});
		return conditions.some((c, i) => c !== before[i]) ? { ...t, conditions } : t;
	});
}

/** Drops one conjunct. The edge keeps the rest, and fires more often for it. */
export function deleteCondition(
	scene: Scene,
	machineId: string,
	transitionId: string,
	index: number,
): Scene {
	return mapTransition(scene, machineId, transitionId, (t) => {
		const before = t.conditions ?? [];
		if (index < 1 || index > before.length) return t;
		return withList(t, "conditions", before.filter((_, i) => i !== index - 1));
	});
}

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

/** Replaces one layer of one machine, if it holds it. */
function mapLayer(
	scene: Scene,
	machineId: string,
	layerId: string,
	fn: (layer: MachineLayer) => MachineLayer,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const before = machine.layers ?? [];
		const layers = before.map((l) => (l.id === layerId ? fn(l) : l));
		return layers.some((l, i) => l !== before[i]) ? { ...machine, layers } : machine;
	});
}

/**
 * A layer, and — the first time — **the one that was already there**.
 *
 * This is the load-bearing line in the whole rung and it is one word long:
 * `machineLayers` rather than `machine.layers`. A machine that says nothing
 * about layers has exactly one, called `base`, minted by the reader; its states
 * carry no `layer` field, and `layerOf` reads an absent one as *the first layer*.
 * So appending to `machine.layers ?? []` would make the new layer the first one,
 * and every state in the machine would silently move into it — a four-state
 * button whose states all landed on the glow layer, in one click, with nothing
 * saying so. Writing the implicit layer down before appending is what keeps
 * "absent is first" true through the edit that stops it being absent.
 *
 * Appended, so the new layer is **last**, and later layers win. That is the
 * useful default — a glow you are adding goes over the button, not under it —
 * and it is the one insertion that cannot change what any existing state writes.
 * {@link reorderLayer} is how somebody changes their mind about that.
 */
export function addLayer(
	scene: Scene,
	machineId: string,
	name?: string,
): { scene: Scene; id: string } {
	const machine = findMachine(scene.machines, machineId);
	if (!machine) return { scene, id: "" };
	const existing = machineLayers(machine);
	const label = name?.trim() || "";
	const id = uniqueConstant(existing.map((l) => l.id), constantFrom(label) ?? "layer");
	const layer: MachineLayer = {
		id,
		name: uniqueName(existing.map((l) => l.name), label || "Layer", " "),
	};
	return {
		scene: mapMachine(scene, machineId, (m) => ({ ...m, layers: [...existing, layer] })),
		id,
	};
}

/** Renames a layer. The name, never the id — it is in `mlayer/2` and `mslayer/3`. */
export function renameLayer(
	scene: Scene,
	machineId: string,
	layerId: string,
	name: string,
): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return mapLayer(scene, machineId, layerId, (layer) =>
		layer.name === trimmed ? layer : { ...layer, name: trimmed },
	);
}

/**
 * Takes a layer away. **Its states stay.**
 *
 * They stay because `layerOf` already knows what to do with a state naming a
 * layer the machine has not got — it reads as the first layer, exactly as a
 * `SceneNode.state` naming a deleted state reads as the initial one — so the
 * document is legal the instant this returns, nothing derives a violation, and
 * undo brings the layer back with all four states still on it. Deleting them
 * would be deleting a designer's work to tidy up a list.
 *
 * Deleting the last one leaves no `layers` key at all, which is a one-layer
 * machine: `machineLayers` mints `base` again and every state falls into it,
 * which is what every machine written before layers existed already means. There
 * is no state in which a machine has *no* layer, because every state belongs to
 * one.
 */
export function deleteLayer(scene: Scene, machineId: string, layerId: string): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const before = machine.layers ?? [];
		const layers = before.filter((l) => l.id !== layerId);
		return layers.length === before.length
			? machine
			: withList(machine, "layers", layers);
	});
}

/**
 * Moves a layer in the list — which is how a designer changes who wins.
 *
 * The order *is* the priority, the same way `states[0]` is the initial state and
 * `order/2` is the paint order: `mlindex/3` numbers this list and `mfwriter/4`
 * takes the highest index that writes a given property. So a glow that should
 * sit under the press goes there by being moved, and there is no second field to
 * disagree with the arrangement.
 *
 * `to` is clamped rather than refused, like every other reorder in this file: a
 * drag past the end of a list means the end of the list.
 *
 * A machine whose layers are implicit has nothing to reorder and is left alone —
 * there is exactly one layer and it is already first.
 */
export function reorderLayer(
	scene: Scene,
	machineId: string,
	layerId: string,
	to: number,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const before = machine.layers ?? [];
		const from = before.findIndex((l) => l.id === layerId);
		if (from === -1) return machine;
		const target = Math.max(0, Math.min(before.length - 1, Math.trunc(to)));
		if (target === from) return machine;
		const layers = [...before];
		const [moved] = layers.splice(from, 1);
		layers.splice(target, 0, moved);
		return { ...machine, layers };
	});
}

/**
 * Which layer a state belongs to, or `null` for the first.
 *
 * **Not checked against the machine's layers**, which is {@link setNodeState}'s
 * judgement and it holds here for the same reason: `layerOf` falls back to the
 * first layer, so a state naming a layer somebody deleted is legal, and undoing
 * the deletion puts the state back where it was rather than leaving it on the
 * base layer with the name it used to carry gone. What *is* checked is that the
 * id is spellable as a constant, because `mslayer(m1,hover,Not A Layer)` is a
 * syntax error rather than a mistake.
 */
export function setStateLayer(
	scene: Scene,
	machineId: string,
	stateId: string,
	layer: string | null,
): Scene {
	if (layer !== null && wordOf(layer) !== layer) return scene;
	return mapState(scene, machineId, stateId, (state) => {
		if ((state.layer ?? null) === layer) return state;
		return layer === null ? without(state, "layer") : { ...state, layer };
	});
}

/**
 * Which state of one *layer* this instance is drawn in — the twin of
 * {@link setNodeState}, and for the first layer it **is** that function.
 *
 * `SceneNode.state` says the first layer's state and `SceneNode.states` says any
 * layer's, with an entry in the record winning where a document holds both. Two
 * fields for one idea is a smell that is being paid for on purpose — every
 * instance that exists today says its state in one string — and this is where the
 * bill comes due: an edit that wrote `states.base` beside a `state` would leave
 * two spellings of one claim in one node, agreeing today and diverging at the
 * next edit that touched only one of them. So writing the first layer writes the
 * string and clears the record entry, and a one-layer document goes on looking
 * exactly like the one-layer documents that already exist.
 *
 * `null` hands the layer back to the machine: `shownStates` falls to that layer's
 * own initial state. Nothing is checked against the machine, for
 * {@link setNodeState}'s reason exactly.
 */
export function setNodeLayerState(
	scene: Scene,
	nodeId: string,
	layer: string,
	state: string | null,
): Scene {
	const node = findInTree(scene.nodes, nodeId);
	if (!node || !isInstance(node)) return scene;
	if (state !== null && wordOf(state) !== state) return scene;
	const machine = machineForNode(scene, node);
	const first = machine ? machineLayers(machine)[0].id : undefined;
	if (layer === first) {
		const cleared =
			node.states?.[layer] === undefined
				? scene
				: mapSelected(scene, [nodeId], (n) =>
						withRecord(n, "states", without(n.states ?? {}, layer)),
					);
		return setNodeState(cleared, nodeId, state);
	}
	if ((node.states?.[layer] ?? null) === state) return scene;
	return mapSelected(scene, [nodeId], (n) => {
		const states = { ...n.states };
		if (state === null) delete states[layer];
		else states[layer] = state;
		return withRecord(n, "states", states);
	});
}

/* ------------------------------------------------------------------ */
/* Timelines, tracks and keyframes                                     */
/* ------------------------------------------------------------------ */

/*
 * **A timeline is a shape, not a schedule.** Nothing in this section writes a
 * frame rate, a sample count or a step, and there is nowhere for one to go: a
 * track is a list of moments, each a time and a value, and everything between
 * two of them is interpolated by a compositor rather than solved. A timeline
 * with nine keyframes costs the same whether it plays over 100ms or ten seconds.
 *
 * What that buys is the thing this section has to keep true. A keyframe's time
 * and its value are ordinary {@link Value}s, so they may name a token, follow a
 * motion scale, and hold alternatives — and two alternatives inside a keyframe
 * really are two designs, exactly as two fills in a delta are. What it costs is
 * that "time order" is a fact about a *universe* rather than about the document,
 * which is why {@link placeKeys} is careful in a way an ordinary insert would
 * not be: a track whose times are all literals is kept sorted here, and one that
 * names a token is left in the order the designer typed it, because sorting on
 * the first alternative would rearrange somebody's animation on the strength of
 * a design they are not looking at. `normalizeScene` draws that line in
 * `orderKeys` and this file draws it in the same place, so a document is the
 * same before and after a round trip.
 *
 * **A timeline adds no universes by existing.** It mints `2·keyframes + 1`
 * variables however many instances play it, and it mints a keyframe *copy* only
 * where a rule named one — `keyframeParts` is seeded from `scene.constraints`
 * and from nothing else. So the whole of this section is inside invariant 1: a
 * timeline is not a choice, and a state that plays one is still one state, true
 * at once with all the others.
 */

/** The millisecond a key sits at, where the document says so in a bare literal. */
const keyMs = (key: Keyframe): number | undefined =>
	key.at.length === 1 && key.at[0].kind === "literal"
		? msOf(key.at[0].value)
		: undefined;

/**
 * A track's keys with one more in it, in time order — or **nothing**, when the
 * time asked for is already taken.
 *
 * Three behaviours in one small function, and each of them is a rule from
 * somewhere else in the document rather than a choice made here.
 *
 * *Sorted where it can be.* `orderKeys` sorts a track on read whenever every
 * time is a literal it can read, so an edit that appended would produce a
 * document that rearranged itself the next time somebody opened it — the panel
 * showing one order, the file another, and a rule naming `kfr(…,3)` pointing at
 * two different moments on the two sides of a save.
 *
 * *Left alone where it cannot be.* One unreadable time — a token, a derivation,
 * two alternatives — and the reader keeps document order, so this does too.
 * Appending is then not a compromise: it is what the reader will decide, and the
 * two agreeing is the whole requirement.
 *
 * *Refused onto an occupied moment.* Two keys at one time collapse to the first
 * on read, so writing one would be writing a keyframe the next read deletes —
 * a silent loss of exactly the kind this file exists to avoid. The caller gets
 * the same scene back and the panel says the moment is taken; moving the key
 * that is already there is {@link updateKeyframe}, which is what was meant.
 */
function placeKeys(
	keys: readonly Keyframe[],
	key: Keyframe,
): Keyframe[] | undefined {
	const ms = keyMs(key);
	const times = keys.map(keyMs);
	if (ms === undefined || times.some((t) => t === undefined)) return [...keys, key];
	if (times.includes(ms)) return undefined;
	const at = times.findIndex((t) => (t as number) > ms);
	const out = [...keys];
	out.splice(at === -1 ? out.length : at, 0, key);
	return out;
}

/** Replaces one timeline of one machine, if it holds it. */
function mapTimeline(
	scene: Scene,
	machineId: string,
	timelineId: string,
	fn: (timeline: Timeline) => Timeline,
): Scene {
	return mapMachine(scene, machineId, (machine) => {
		const before = machine.timelines ?? [];
		const timelines = before.map((w) => (w.id === timelineId ? fn(w) : w));
		return timelines.some((w, i) => w !== before[i])
			? { ...machine, timelines }
			: machine;
	});
}

/**
 * Replaces one track, named by its **term** rather than by its index.
 *
 * A track has no id and does not need one, because it already has a name every
 * layer of this system agrees on: `trkd(panel,y)` is what the program calls it
 * in `mtrack/3`, what a keyframe copy carries in `kfr(c1,open,trkd(panel,y),3)`,
 * and what `keyframeParts` matches a rule's member against. An index would be a
 * second name for that, and the two would part company the first time somebody
 * deleted a track above it — quietly, in every rule that named a copy.
 *
 * Conditions and keyframes take an index instead, and the difference is not an
 * inconsistency: a condition and a keyframe are *positions* in an ordered list,
 * and the program numbers them `1..n` for exactly that reason. A track is not
 * ordered and never was.
 */
function mapTrack(
	scene: Scene,
	machineId: string,
	timelineId: string,
	track: string,
	fn: (track: Track) => Track,
): Scene {
	return mapTimeline(scene, machineId, timelineId, (timeline) => {
		const tracks = timeline.tracks.map((t) =>
			trackTerm(t) === track ? fn(t) : t,
		);
		return tracks.some((t, i) => t !== timeline.tracks[i])
			? { ...timeline, tracks }
			: timeline;
	});
}

/**
 * What a track animates: exactly one of a property, one of the six axes, or one
 * of the three rotations.
 *
 * A tagged union rather than three optional arguments, because "exactly one" is
 * the whole of {@link Track}'s identity — a track that named two would be two
 * tracks sharing a keyframe list, and the moment somebody moved a key on one of
 * them it would be two tracks anyway. The type says it once so no caller has to
 * remember it.
 */
export type TrackField = { prop: PropName } | { dim: Axis3 } | { turn: Turn };

/**
 * A {@link Track} for a part and a field, or nothing where the field is not one
 * this document knows.
 *
 * Refused rather than carried, which is the judgement `normalizeTracks` makes on
 * the same three lookups: a track's field is what gives it a *term*, so a track
 * over `wobble` has no `trkp/2` to be, no `mtrack/3`, and its keyframes would be
 * values keyed by nothing. That is a syntax error rather than a mistake, and
 * this file refuses those.
 */
function trackOf(part: string, field: TrackField): Track | undefined {
	if ("prop" in field) {
		return Object.hasOwn(PROPS, field.prop)
			? { part, prop: field.prop, keys: [] }
			: undefined;
	}
	if ("dim" in field) {
		return DIMENSIONS_3D.includes(field.dim)
			? { part, dim: field.dim, keys: [] }
			: undefined;
	}
	return Object.hasOwn(TURNS, field.turn)
		? { part, turn: field.turn, keys: [] }
		: undefined;
}

/**
 * A timeline on a machine, with no tracks and no stated length.
 *
 * **No length**, and it is the same argument {@link addInput} makes about a
 * range: absent is *derived*, not zero. A timeline's length is the last
 * keyframe's time unless the document says otherwise, so a fresh one that stored
 * `0ms` would be a timeline that plays nothing and that disagrees with its own
 * contents the moment a key is added — and `timelineLength` would believe it.
 * **No loop** for the same reason one rung along: absent is `none`, and writing
 * the word down would be a second spelling of the default that a later change to
 * the default could not reach.
 *
 * The id is derived from the name, which is {@link addState}'s call for
 * {@link addState}'s reasons: it is read in `mtimeline(m1,open)` in the program
 * panel, and it is typed into a rule by anybody naming a keyframe copy —
 * `kfr(c1,open,trkd(panel,y),3)` has it in the middle. `w_3f2a` there would be a
 * moment nobody could write a rule about.
 *
 * On the **machine** rather than on a state, because two states routinely play
 * one animation and a blend state plays several. A timeline nothing plays is
 * legal, costs no copies, and is how somebody works on one before wiring it up.
 */
export function addTimeline(
	scene: Scene,
	machineId: string,
	name?: string,
): { scene: Scene; id: string } {
	const machine = findMachine(scene.machines, machineId);
	if (!machine) return { scene, id: "" };
	const existing = machine.timelines ?? [];
	const label = name?.trim() || "";
	const id = uniqueConstant(
		existing.map((w) => w.id),
		constantFrom(label) ?? "timeline",
	);
	const timeline: Timeline = {
		id,
		name: uniqueName(existing.map((w) => w.name), label || "Timeline", " "),
		tracks: [],
	};
	return {
		scene: mapMachine(scene, machineId, (m) => ({
			...m,
			timelines: [...existing, timeline],
		})),
		id,
	};
}

/**
 * Renames a timeline. **The name, never the id** — {@link renameState}'s
 * argument, and here the id is not merely in the program but in the middle of
 * every `kfr(…)` term a designer has typed into a rule.
 */
export function renameTimeline(
	scene: Scene,
	machineId: string,
	timelineId: string,
	name: string,
): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return mapTimeline(scene, machineId, timelineId, (w) =>
		w.name === trimmed ? w : { ...w, name: trimmed },
	);
}

/**
 * How long the timeline is, or `null` for **as long as its contents**.
 *
 * The two are different claims and the difference is worth the explicit `null`.
 * Absent is derived — the last keyframe's time — so a timeline cannot disagree
 * with itself, and moving that key makes the animation longer with no second
 * edit. Present is a statement, and a stated length *shorter* than the last
 * keyframe is legal and means what it says: the tail is not played. Neither is
 * repaired into the other.
 *
 * An empty {@link Value} is `null`, so "say nothing about the length" keeps
 * having one spelling however a panel arrived at it.
 */
export function setTimelineLength(
	scene: Scene,
	machineId: string,
	timelineId: string,
	length: Value | null,
): Scene {
	const wanted = length === null || length.length === 0 ? null : length;
	return mapTimeline(scene, machineId, timelineId, (w) => {
		if (wanted === null) return without(w, "length");
		return Object.is(w.length, wanted) ? w : { ...w, length: wanted };
	});
}

/**
 * How it repeats. `none` **takes the key away** rather than storing the word.
 *
 * {@link withList}'s rule, applied to a scalar: absent and `"none"` are read
 * alike by `timelinePosition` and by the export, so a document that could hold
 * either would diff against itself, and the two spellings would only ever be
 * told apart by a reader that had no business telling them apart.
 */
export function setTimelineLoop(
	scene: Scene,
	machineId: string,
	timelineId: string,
	loop: LoopMode,
): Scene {
	if (loop !== "none" && loop !== "loop" && loop !== "pingPong") return scene;
	return mapTimeline(scene, machineId, timelineId, (w) => {
		if (loop === "none") return without(w, "loop");
		return w.loop === loop ? w : { ...w, loop };
	});
}

/**
 * Takes a timeline away — and, unlike almost everything else in this file,
 * **prunes the rules that were about it**.
 *
 * The exception needs the argument, because every other delete here leaves the
 * dangling reference alone: an instance keeps its `state` when the machine goes,
 * a state keeps its `layer` when the layer goes, and a blend keeps its stops when
 * the input goes. Those are all cases where the leftover *says nothing* — the
 * reader falls back, nothing derives, and undo puts it back word for word.
 *
 * A rule naming `kfr(c1,open,trkd(panel,y),3)` is not one of those. `holdsKeyCopy`
 * is sharp about the timeline and the track on purpose, so once this timeline is
 * gone the member is held by nothing — and it would then be stripped, silently,
 * by whichever unrelated `deleteNodes` or `setGuides` happened next, taking the
 * rule with it if that dropped it below `minNodes`. Between losing the rule
 * *here*, in the gesture that caused it, where the panel can say so and one undo
 * restores both — and losing it later, somewhere else, for no visible reason —
 * the first is the only defensible one. The same goes for {@link deleteTrack} and
 * {@link deleteKeyframe}, which un-hold the same terms one grain finer.
 *
 * The **states** that played it are left exactly as they were, which is the
 * ordinary rule again: `statePlays` finds no timeline, `mtplays/3` derives
 * nothing, the state is a state with no animation, and undo brings the wiring
 * back with the timeline.
 */
export function deleteTimeline(
	scene: Scene,
	machineId: string,
	timelineId: string,
): Scene {
	const next = mapMachine(scene, machineId, (machine) => {
		const before = machine.timelines ?? [];
		const timelines = before.filter((w) => w.id !== timelineId);
		return timelines.length === before.length
			? machine
			: withList(machine, "timelines", timelines);
	});
	return next === scene ? scene : pruneConstraints(next);
}

/**
 * A track on a timeline, over one property, dimension or rotation of one part.
 *
 * **No keyframes.** A track begins empty for {@link addState}'s reason: a track
 * seeded with the part's current value at time zero would be a claim the
 * designer did not make, and it would be *wrong* the moment the definition
 * changed, because a copied value stops following the thing it was copied from.
 * `trackTerm` and `normalizeTracks` both already know what a track with no keys
 * is — a row somebody is part way through building — and it materialises
 * nothing until it says something.
 *
 * **One track per term, and asking again returns the one that is there.** Two
 * tracks with one term would be one track as far as `mtrack/3`, `mkey/4` and
 * every `kfr(…)` member are concerned, with the second's keyframes reachable by
 * nothing. Returning the existing term rather than refusing is {@link addMachine}'s
 * call: a panel that asked for "the track for `panel`'s `y`" wanted that track,
 * and it now has it.
 *
 * The part is **not** checked against the definition, exactly as a delta's key is
 * not: a part deleted and drawn again should find its animation waiting rather
 * than gone.
 */
export function addTrack(
	scene: Scene,
	machineId: string,
	timelineId: string,
	part: string,
	field: TrackField,
): { scene: Scene; track: string } {
	const machine = findMachine(scene.machines, machineId);
	const timeline = machine ? findTimeline(machine, timelineId) : undefined;
	if (!timeline || !part) return { scene, track: "" };
	const track = trackOf(part, field);
	const term = track && trackTerm(track);
	if (!track || term === undefined) return { scene, track: "" };
	if (timeline.tracks.some((t) => trackTerm(t) === term)) {
		return { scene, track: term };
	}
	return {
		scene: mapTimeline(scene, machineId, timelineId, (w) => ({
			...w,
			tracks: [...w.tracks, track],
		})),
		track: term,
	};
}

/** Takes a track away, with its keyframes and the rules that named them. */
export function deleteTrack(
	scene: Scene,
	machineId: string,
	timelineId: string,
	track: string,
): Scene {
	const next = mapTimeline(scene, machineId, timelineId, (timeline) => {
		const tracks = timeline.tracks.filter((t) => trackTerm(t) !== track);
		return tracks.length === timeline.tracks.length
			? timeline
			: { ...timeline, tracks };
	});
	return next === scene ? scene : pruneConstraints(next);
}

/**
 * A moment on a track: a time and a value, both whole {@link Value}s.
 *
 * Both are required, and this is the one place a half-written thing is refused
 * rather than kept. A track may have no field yet and a machine may have no
 * layers yet, because those are rows being built; a keyframe with no time or no
 * value is not a keyframe that says something odd, it is half a segment — the
 * program mints `kat` and `kval` *per key* and the export interpolates between
 * two of them, so one with neither end is a stretch of animation with nowhere to
 * start. `normalizeKeyframes` drops exactly this shape, so writing one would be
 * writing something the next read deletes.
 *
 * Where it lands, and when it is refused, is {@link placeKeys}.
 */
export function addKeyframe(
	scene: Scene,
	machineId: string,
	timelineId: string,
	track: string,
	at: Value,
	value: Value,
	easing?: Value,
): Scene {
	if (at.length === 0 || value.length === 0) return scene;
	const key: Keyframe = {
		at,
		value,
		// An empty curve is absent rather than an empty list, the reading every
		// optional Value on a keyframe gets: absent takes `mdefease` in the program
		// and `DEFAULT_EASING` in the panel, and a `[]` would mint a variable with
		// no alternatives. The curve is no longer checked against the menu here —
		// it is a Value, so the word it holds may be one a token supplies in one
		// universe and not in another, and both readers fall back on their own.
		...(easing !== undefined && easing.length > 0 ? { easing } : {}),
	};
	return mapTrack(scene, machineId, timelineId, track, (t) => {
		const keys = placeKeys(t.keys, key);
		return keys === undefined ? t : { ...t, keys };
	});
}

/**
 * Moves a keyframe, or changes what it says, or how it leaves.
 *
 * One patch rather than three setters, {@link updateTransition}'s shape and its
 * reason: a keyframe is one row of one motion panel with three controls on it.
 *
 * `index` is **1-based**, matching `mkey(M,W,R,K)` and therefore matching the
 * number a person reads in a violation and types inside a `kfr(…)` member. Every
 * index in this half of the file is.
 *
 * **The list is re-sorted, and the indices really do move.** That is the honest
 * consequence of dragging a key past its neighbour rather than a wrinkle to hide:
 * `orderKeys` would do it on the next read anyway, so not doing it here would
 * only mean the document and the panel disagreed until somebody saved. A rule
 * naming `kfr(…,3)` then names whichever moment is third, which is what "the
 * third keyframe" has meant all along.
 *
 * An easing is no longer checked against the menu on the way in, and that is the
 * one thing about this function that changed when a curve became a {@link Value}:
 * what a curve resolves to is a question about a universe, so a token holding a
 * word the menu has not got could not be refused here without refusing the token
 * everywhere. Both readers fall back instead — `measeopt/1` in the program and
 * `curveOf` in `machines.ts` — which is where a fallback has to live if the file
 * and the program are to agree about which curve is playing. A time that lands on
 * another key's moment is still refused, for {@link placeKeys}' reason.
 */
export function updateKeyframe(
	scene: Scene,
	machineId: string,
	timelineId: string,
	track: string,
	index: number,
	patch: Partial<Keyframe>,
): Scene {
	if (patch.at !== undefined && patch.at.length === 0) return scene;
	if (patch.value !== undefined && patch.value.length === 0) return scene;
	return mapTrack(scene, machineId, timelineId, track, (t) => {
		if (index < 1 || index > t.keys.length) return t;
		const before = t.keys[index - 1];
		const next: Keyframe = { ...before, ...patch };
		const keys = (Object.keys(patch) as Array<keyof Keyframe>).every((key) =>
			Object.is(before[key], next[key]),
		)
			? undefined
			: placeKeys(
					t.keys.filter((_, i) => i !== index - 1),
					next,
				);
		return keys === undefined ? t : { ...t, keys };
	});
}

/**
 * Drops a moment. The track stays, even when it was the last one.
 *
 * A track with no keys is a track being built, which is exactly what
 * {@link addTrack} makes and what `normalizeTracks` keeps — so emptying one is
 * not a reason to take away the row the designer is working in. Somebody who
 * wants the track gone deletes the track.
 */
export function deleteKeyframe(
	scene: Scene,
	machineId: string,
	timelineId: string,
	track: string,
	index: number,
): Scene {
	const next = mapTrack(scene, machineId, timelineId, track, (t) =>
		index < 1 || index > t.keys.length
			? t
			: { ...t, keys: t.keys.filter((_, i) => i !== index - 1) },
	);
	return next === scene ? scene : pruneConstraints(next);
}

/* ------------------------------------------------------------------ */
/* What a state plays                                                  */
/* ------------------------------------------------------------------ */

/**
 * Which timeline this state plays, or `null` for none.
 *
 * A state that plays a timeline still has its `parts` delta and the two compose:
 * the timeline decides what it has a track for and the delta decides the rest.
 * The state's **settled pose** — what `stt(I,S,N)` is, what the canvas draws,
 * what a cross-state rule compares — is the timeline's value at its own length,
 * derived rather than stored, so moving the last keyframe moves the pose.
 *
 * **A blend on the same state is left exactly where it is**, and that is the one
 * decision here worth arguing, because it deliberately creates a shape a check
 * reports. {@link MachineState.blend} settles it: a state holding both a timeline
 * and a blend is "a mistake a person should see rather than one a reader should
 * quietly pick a side in" — `mtwosource/2` derives it and names the state. An
 * edit that cleared the blend to keep the document tidy would be deleting a
 * mixture somebody built, on the strength of a click, in order to avoid showing
 * them a sentence they could act on. That is the same trade `deleteLayer` and
 * `deleteInput` refuse, and it is refused here for the same reason.
 *
 * Not checked against the machine's timelines, for {@link setNodeState}'s reason:
 * `statePlays` finds nothing and the state plays nothing, so a timeline deleted
 * and undone comes back wired up.
 */
export function setStateTimeline(
	scene: Scene,
	machineId: string,
	stateId: string,
	timeline: string | null,
): Scene {
	if (timeline !== null && wordOf(timeline) !== timeline) return scene;
	return mapState(scene, machineId, stateId, (state) => {
		if ((state.timeline ?? null) === timeline) return state;
		return timeline === null
			? without(state, "timeline")
			: { ...state, timeline };
	});
}

/**
 * What advances the timeline this state plays: wall time, or a scroll position.
 *
 * `null` is `time`, written as **absence**, and not as the word: absent-is-time
 * is what every document written before this rung means, and a writer that filled
 * the field in with `"time"` would change nothing today and would put a word in
 * every state of every document for a setting almost none of them make.
 *
 * The word **is** checked, unlike the timeline id above it, and the asymmetry is
 * the same one the document reader makes: a timeline id is a *reference* and may
 * legitimately be waiting for something to come back, while a clock is one of
 * three constants that reach the program as themselves. A fourth would be a
 * `mclock/3` no rule can match, which silently disables the exit-time narrowing
 * rather than changing it — the failure mode a syntax error would at least be
 * loud about.
 *
 * **Left alone where the state plays nothing.** A clock with no timeline is read
 * by nothing, and clearing it would lose what somebody typed the moment they
 * unhooked an animation to try another one.
 *
 * Written here rather than in a panel, and it is the second of two edits this
 * step added to a file its ownership row does not give it — the first being four
 * verbs `Record<Trigger, string>` would not compile without. The reason is the
 * same both times: a field a document can hold and no edit can write is a feature
 * no panel can reach.
 */
export function setStateClock(
	scene: Scene,
	machineId: string,
	stateId: string,
	clock: TimelineClock | null,
): Scene {
	if (clock !== null && !Object.hasOwn(TIMELINE_CLOCKS, clock)) return scene;
	return mapState(scene, machineId, stateId, (state) => {
		const now = clock === "time" ? null : clock;
		if ((state.clock ?? null) === now) return state;
		return now === null ? without(state, "clock") : { ...state, clock: now };
	});
}

/**
 * Makes a state a blend of several timelines, or stops it being one.
 *
 * The **kind is checked and nothing else is**, which is this file's line drawn
 * once more: `mblend(M,S,Kind)` carries the word into the program, and a third
 * word would be a mixing rule nothing implements — a syntax error. Everything
 * else a blend can get wrong has a name and a report. A stop naming a timeline
 * the machine has not got is the shape `mstop/4` finds no `mtimeline/2` for; a
 * threshold outside the input's declared range is `mstopout/3`; an axis that
 * extends past the outermost stop is `mstopgap/2`; a `oneD` blend with no input
 * is a blend whose stops sit on no axis. All four are things a designer can read
 * and fix, and `normalizeBlend` keeps every one of them for exactly that reason.
 *
 * `null` takes the field away rather than writing `{ stops: [] }`, so "this state
 * is not a blend" has one spelling.
 */
export function setStateBlend(
	scene: Scene,
	machineId: string,
	stateId: string,
	blend: Blend | null,
): Scene {
	if (blend !== null && !Object.hasOwn(BLEND_KINDS, blend.kind)) return scene;
	return mapState(scene, machineId, stateId, (state) => {
		if (blend === null) return without(state, "blend");
		return Object.is(state.blend, blend) ? state : { ...state, blend };
	});
}

/**
 * Which number input a 1D blend is laid out along, or `null` for none.
 *
 * On the blend rather than on the stops, because a 1D blend is one axis with
 * several places on it — that is what makes it one-dimensional — and an input per
 * stop is what `direct` already is. A `direct` blend keeps the field if it has
 * one and nothing reads it, which is {@link setInputKind}'s judgement: the
 * leftover is shown rather than tidied away, and one undo puts it back.
 *
 * Refused on a state that is not a blend, because there is nothing to be the
 * input *of* — {@link setStateBlend} is how a state becomes one.
 */
export function setBlendInput(
	scene: Scene,
	machineId: string,
	stateId: string,
	input: string | null,
): Scene {
	if (input !== null && wordOf(input) !== input) return scene;
	return mapState(scene, machineId, stateId, (state) => {
		const blend = state.blend;
		if (blend === undefined) return state;
		if ((blend.input ?? null) === input) return state;
		return {
			...state,
			blend: input === null ? without(blend, "input") : { ...blend, input },
		};
	});
}

/**
 * One more timeline in the mixture, at a place on the axis.
 *
 * `at` and `by` are **plain strings kept as typed**, which is {@link MachineInput}'s
 * shape and its argument: a threshold is a runtime number rather than a design
 * decision, there is no universe in which the drawer is 40% open and 60% open at
 * once, and a {@link Value} here would have put a runtime reading inside the
 * multiverse. So a threshold that reads as no number states nothing — the stop
 * has no place on the axis rather than a place at zero — and `mstopout/3` and
 * `mstopgap/2` say so in the panel rather than this function repairing text
 * somebody is still typing.
 *
 * Both are optional and neither is invented. A `oneD` stop with no `at` is a stop
 * waiting to be placed, which is what a designer has just made by pressing "add";
 * seeding `0` would put two stops on top of each other and call it a mixture.
 *
 * Appended, so the stops are in the order they were added and `mstop(M,S,J,W)`
 * numbers them that way. The order is not the axis — `at` is — so appending
 * cannot change what any existing stop means.
 *
 * Refused on a state that is not a blend, for {@link setBlendInput}'s reason.
 */
export function addBlendStop(
	scene: Scene,
	machineId: string,
	stateId: string,
	timeline: string,
	at?: string,
	by?: string,
): Scene {
	if (!timeline) return scene;
	return mapState(scene, machineId, stateId, (state) => {
		const blend = state.blend;
		if (blend === undefined) return state;
		const stop: BlendStop = {
			timeline,
			...(at !== undefined ? { at } : {}),
			...(by !== undefined ? { by } : {}),
		};
		return { ...state, blend: { ...blend, stops: [...blend.stops, stop] } };
	});
}

/**
 * Changes one stop — which timeline it plays, where it sits, what weighs it.
 *
 * **1-based**, like every other index here, because `mstop(M,S,J,W)` and
 * `mstopout(M,S,J)` number the stops from one and that is the number a violation
 * shows. A patch field set to `null` takes the key away, where `undefined` leaves
 * it alone — {@link setInputRange}'s distinction, needed here for the same reason
 * it is needed there: "unplace this stop" and "say nothing about its place" are
 * two different edits and a single `undefined` spells both.
 */
export function updateBlendStop(
	scene: Scene,
	machineId: string,
	stateId: string,
	index: number,
	patch: { timeline?: string; at?: string | null; by?: string | null },
): Scene {
	if (patch.timeline !== undefined && !patch.timeline) return scene;
	return mapState(scene, machineId, stateId, (state) => {
		const blend = state.blend;
		if (blend === undefined) return state;
		if (index < 1 || index > blend.stops.length) return state;
		const before = blend.stops[index - 1];
		let next: BlendStop = before;
		if (patch.timeline !== undefined && patch.timeline !== before.timeline) {
			next = { ...next, timeline: patch.timeline };
		}
		if (patch.at !== undefined && (before.at ?? null) !== patch.at) {
			next = patch.at === null ? without(next, "at") : { ...next, at: patch.at };
		}
		if (patch.by !== undefined && (before.by ?? null) !== patch.by) {
			next = patch.by === null ? without(next, "by") : { ...next, by: patch.by };
		}
		if (next === before) return state;
		return {
			...state,
			blend: {
				...blend,
				stops: blend.stops.map((s, i) => (i === index - 1 ? next : s)),
			},
		};
	});
}

/**
 * Drops one stop. The blend stays, even when it was the last one.
 *
 * {@link deleteKeyframe}'s judgement: a blend with no stops is a blend being
 * built, `normalizeBlend` keeps one, and it mixes nothing rather than being
 * broken. Somebody who wants the state to stop being a blend says so with
 * {@link setStateBlend}.
 */
export function deleteBlendStop(
	scene: Scene,
	machineId: string,
	stateId: string,
	index: number,
): Scene {
	return mapState(scene, machineId, stateId, (state) => {
		const blend = state.blend;
		if (blend === undefined) return state;
		if (index < 1 || index > blend.stops.length) return state;
		return {
			...state,
			blend: {
				...blend,
				stops: blend.stops.filter((_, i) => i !== index - 1),
			},
		};
	});
}
