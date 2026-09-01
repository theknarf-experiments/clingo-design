import { resolveAsset } from "../projects/store";
import { useImage } from "./useImage";
import {
	type CSSProperties,
	type ReactNode,
	Suspense,
	lazy,
	memo,
	useMemo,
} from "react";
import {
	type Frame,
	type Machine,
	type ModelNode,
	type ModelScene,
	type NodeKind,
	type PropName,
	type ResolveContext,
	type Scene,
	type SceneNode,
	type SolvedKeyframe,
	type Spatial,
	type StatePart,
	type Turn,
	type Universe,
	DOCUMENT_BASE,
	KINDS,
	arrowHead,
	diagonalRun,
	emuOf,
	findState,
	findTimeline,
	flatten,
	frameOf,
	instanceNodes,
	keyValueVar,
	machineForNode,
	machineLayers,
	mdegOf,
	paintOf,
	parseInstancePart,
	pathData,
	propVar,
	resolveValue,
	sampleTimeline,
	scalePoints,
	statePart,
	trackTerm,
} from "@clingo-design/design-core";

import type { GizmoMode, SpatialEdit } from "@clingo-design/canvas-3d";

import styles from "./Artboard.module.css";
import { canvasRect } from "./viewport";

/**
 * The 3D renderer, loaded only by a document that has a viewport in it.
 *
 * **This `lazy` is a requirement rather than a nicety.** `@clingo-design/canvas-3d`
 * pulls in three.js and React Three Fiber — a megabyte and a half before
 * compression — and the studio's promise is that a document with no viewport
 * pays for none of it. A static import at the top of this file would put the
 * whole of three into the studio's main chunk, where every business card and
 * every poster would download it in order to draw rectangles. Vite splits a
 * dynamic import into its own chunk, so the request is made the first time a
 * live viewport is actually mounted and never otherwise.
 *
 * The `.then` unwrapping is because `lazy` wants a module with a default export
 * and the package deliberately has none: it exports a dozen named things and a
 * default would have to pick one of them.
 *
 * Nothing else in `packages/app` may import this package, and nothing does —
 * three is not in the app's own `package.json` dependencies, so an accidental
 * `import { Mesh } from "three"` anywhere in the studio is a resolution error
 * rather than a code review. That is the boundary `canvas-3d`'s own header
 * argues for, kept from this side.
 */
const ViewportCanvas = lazy(async () => ({
	default: (await import("@clingo-design/canvas-3d")).ViewportCanvas,
}));

/**
 * The two things the answer set does not carry, with the box they were authored
 * against.
 *
 * A path's vertices are stored relative to the frame the node was *drawn* at,
 * and that frame is a value now — so the number to scale them from has to be
 * resolved in this universe rather than read off the document as a plain
 * rectangle.
 */
interface DocShape {
	node: SceneNode;
	/**
	 * The frame the vertices were authored against, in this universe — and in
	 * the document's own EMU, like the vertices themselves. See {@link Plot}: it
	 * is the `from` of the one scaling that turns both into pixels.
	 */
	authored: Frame;
}

/**
 * What a `viewport` node's content function is handed beyond the usual three.
 *
 * `docs/merged-plan.md`'s M18 row gives this argument as
 * `{ model, assets, onPickNode, live, scale }`. **`assets` is not here**, and
 * the absence is reported rather than stubbed: `design-core/src/assets.ts` and
 * the `AssetStore` it was to define do not exist in the tree, so there is
 * nothing to hand one through and no interface to code an app-side
 * implementation against. A `model` node consequently draws its bounding box
 * rather than its geometry — `canvas-3d/src/Model.tsx` is the whole story — and
 * inventing the store's shape here, in the one file that merely passes it along,
 * is exactly the kind of quiet redesign this work was told not to do.
 */
interface ViewportContext {
	/** The whole model of this universe, for `looks/2` and the state copies. */
	model: ModelScene;
	/** True where this view may hold a WebGL context — see {@link ArtboardProps.live}. */
	live: boolean;
	/** The canvas's CSS scale, so the drawing buffer matches the pixels on screen. */
	scale?: number;
	/** The editor's selection, so a picked mesh gets an outline. */
	selection?: ReadonlySet<string>;
	/** A click in the scene, reporting the node id the raycaster landed on. */
	onPickNode?: (id: string | null, event: PointerEvent) => void;
	/** Whether the editor has entered this view and may orbit inside it. */
	orbit?: boolean;
	/** Offer a transform gizmo in this mode, on the one selected object. */
	gizmo?: GizmoMode;
	/** Where a drag on that gizmo ends up — see `canvas-3d/src/edits3.ts`. */
	onEdit?: (edit: SpatialEdit) => void;
	/** The first frame this view drew, as a data URL, for whoever wants a still. */
	onPoster?: (dataUrl: string) => void;
}

/**
 * What each kind draws *inside* its box.
 *
 * How a box is painted is no longer here: that mapping is shared with the
 * exporter and lives in design-core's `paint.ts`, because a second copy of
 * "a fill is a background" is a copy that drifts from the canvas. What stays is
 * the markup, which is React on this side and a string on the other and has
 * nothing to factor out.
 *
 * `node` is the answer set's account of it; `doc` is the document node it came
 * from, present only for the vertices and the lean — see {@link Artboard}.
 * `view` is present only for a `viewport`, which is the one kind whose content
 * is not markup at all.
 */
const CONTENT: Partial<
	Record<
		NodeKind,
		(
			node: ModelNode,
			frame: Frame,
			doc: DocShape | undefined,
			view: ViewportContext | undefined,
		) => ReactNode
	>
> = {
	// Content is a property like any other, so it arrives resolved for this
	// universe with everything else — which is what lets a headline differ
	// between them.
	text: (node) => node.rendered.text,
	line: (_node, frame, doc) => <Stroke frame={frame} doc={doc} />,
	arrow: (_node, frame, doc) => <Stroke frame={frame} doc={doc} head />,
	path: (_node, frame, doc) => <Plot frame={frame} doc={doc} />,
	viewport: (node, _frame, _doc, view) => (view ? <View node={node} view={view} /> : null),
	image: (node) => <Picture node={node} />,
};

/**
 * An image node's picture.
 *
 * The file it draws comes off the **answer set** — `asset/2`, read into
 * `ModelScene.assets` — and not off the document, which is the same rule every
 * other thing on this canvas is drawn by. So a rule that mints an image node and
 * states its own `asset/2` gets a picture, exactly as a rule that mints a rect
 * gets a fill.
 *
 * The box is the node's, always. `object-fit` decides what the picture does
 * inside it, which is what makes a photograph in a card a design decision rather
 * than an accident of the file's aspect — and it is why the node keeps its size
 * while the bytes are still arriving instead of reflowing when they land.
 */
function Picture({ node }: { node: ModelNode }) {
	const src = useImage(node.asset);
	if (!src) return null;
	// No inline `object-fit`. The box already carries it — `fit` is a property
	// like any other and the paint table put it there — and the stylesheet below
	// inherits it onto the picture. Setting it here as well would be a second
	// answer that a token or a state override could silently disagree with.
	return <img className={styles.picture} src={src} alt="" draggable={false} />;
}

/**
 * A line across the node's box, optionally with a head.
 *
 * Drawn in the box's own pixel units rather than a scaled viewBox, so a
 * stretched frame does not stretch the stroke with it.
 */
function Stroke({
	frame,
	doc,
	head,
}: { frame: Frame; doc: DocShape | undefined; head?: boolean }) {
	const { y1, y2 } = diagonalRun(frame, doc?.node.diagonal);
	return (
		<svg className={styles.stroke} aria-hidden="true">
			<line
				x1={0}
				y1={y1}
				x2={frame.width}
				y2={y2}
				strokeLinecap="round"
				fill="none"
			/>
			{head ? (
				<polyline
					points={arrowHead(0, y1, frame.width, y2)}
					strokeLinecap="round"
					strokeLinejoin="round"
					fill="none"
				/>
			) : null}
		</svg>
	);
}

/**
 * A path's vertices, joined up.
 *
 * They are stored against the frame the node was drawn at, but the frame it is
 * *rendered* at can differ — a live resize, or a stretch under an automatic
 * layout — so they are scaled into whichever one arrived here.
 *
 * That one step is also the unit crossing, exactly as it is in the exporter: the
 * vertices are in the document's own EMU, `authored` is the EMU box they were
 * drawn in, and `frame` is the box this node is being painted at, in canvas
 * pixels. Converting them separately afterwards would be a second place for the
 * two to disagree about the same shape.
 */
function Plot({ frame, doc }: { frame: Frame; doc: DocShape | undefined }) {
	if (!doc) return null;
	const d = pathData(
		scalePoints(doc.node.points ?? [], doc.authored, frame),
		doc.node.closed,
	);
	if (!d) return null;
	return (
		<svg className={styles.stroke} aria-hidden="true">
			<path
				d={d}
				// An open run of segments is a stroke, not a shape: filling
				// across the gap between its ends would draw an edge that is
				// not there. Inline, so it beats the inherited fill.
				style={doc.node.closed ? undefined : { fill: "none" }}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

/**
 * A viewport's scene, drawn where the rectangle is.
 *
 * The `<canvas>` goes inside the same absolutely-positioned div every other node
 * gets, at the same converted pixel frame, inside the same transformed subtree —
 * so pan, zoom, culling and paint order all work for nothing, exactly as
 * `ViewportCanvas`' own header claims. Nothing in this file knows what a mesh is.
 *
 * **A view that is not live draws no canvas and loads no renderer.** Browsers
 * cap live WebGL contexts around sixteen and drop the oldest past that, so a
 * multiverse of twenty universes each holding a viewport cannot have twenty
 * contexts; `live` is granted from outside — see {@link ArtboardProps.live} —
 * and everything else gets the still below. The still is drawn *here*, in plain
 * DOM, rather than by the package's own `ViewportStill`, and that is deliberate:
 * `ViewportStill` lives in `canvas-3d`, so rendering it would download three.js
 * in order to draw a caption on a box that is already painted by `paintOf`.
 *
 * The Suspense fallback is the same still, for the same reason and one moment
 * earlier — between the first live viewport mounting and its chunk arriving,
 * what is on screen is the viewport's own fill with a label on it, rather than
 * an empty hole where a design used to be.
 */
function View({ node, view }: { node: ModelNode; view: ViewportContext }) {
	if (!view.live) return <Still node={node} />;
	return (
		<Suspense fallback={<Still node={node} />}>
			<ViewportCanvas
				viewport={node}
				model={view.model}
				selection={view.selection}
				onPickNode={view.onPickNode}
				orbit={view.orbit}
				gizmo={view.gizmo}
				onEdit={view.onEdit}
				onPoster={view.onPoster}
				live
				scale={view.scale}
				resolve={resolveAsset}
			/>
		</Suspense>
	);
}

/** What a viewport shows when it has no context: its own paint, and what is in it. */
function Still({ node }: { node: ModelNode }) {
	const count = countNodes(node.children);
	return (
		<div className={styles.still} data-role="viewport-still">
			<span className={styles.stillLabel}>
				{count === 1 ? "3D view · 1 object" : `3D view · ${count} objects`}
			</span>
		</div>
	);
}

const countNodes = (nodes: readonly ModelNode[]): number =>
	nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);

/* ------------------------------------------------------------------ */
/* Playback: what the canvas is pretending, per layer and per moment   */
/* ------------------------------------------------------------------ */

/**
 * What a played machine makes of one part: the same six fields a node carries,
 * and none of them unless something said so.
 *
 * Deliberately **sparse**. A pose is a diff against the picture the answer set
 * already draws, so a field that no played layer and no sampled track has an
 * opinion about is absent and the drawn value stands — which is what keeps a
 * three-layer machine from repainting a part none of its layers mention.
 */
interface Pose {
	frame?: Partial<Frame>;
	spatial?: Partial<Record<Spatial, number>>;
	turn?: Partial<Record<Turn, number>>;
	rendered?: Partial<Record<PropName, string>>;
	hidden?: boolean;
	/** The first layer's state, for `data-state` — the export's own attribute. */
	state?: string;
	/** Every layer's state, for `data-state-<layer>` — the runtime's own attributes. */
	states?: Record<string, string>;
}

/** The four dimensions a flat box has, and the two it does not. */
const PLANAR = ["x", "y", "width", "height"] as const;
const SPATIAL = ["z", "depth"] as const;
const TURNS = ["rotateX", "rotateY", "rotateZ"] as const;

/**
 * Which layer's opinion of a field wins, decided the way `mwriter/4` decides it.
 *
 * **The last layer that states a value.** That is the program's own rule, it is
 * the rule `export.ts`'s `drawnStateValue` follows for the same question, and it
 * is the rule the exported stylesheet enforces by ordering the later layer's
 * block after the earlier one's. Taking each layer's copy wholesale — which is
 * what the one-layer canvas used to do, correctly — would make a later layer
 * that only repaints a fill also reassert the earlier layer's geometry from its
 * own copy, and a glow layer would quietly undo a press.
 *
 * A field counts as *stated* two ways, and the union is what makes this exact on
 * one layer:
 *
 *   - the layer's state names it in its `StatePart` delta, which is what the
 *     document says and what `mfshadow/3` is emitted from; **or**
 *   - the copy's value differs from the drawn part's, which catches the field
 *     the document never typed. A state that rewords a hugging label changes its
 *     *width* through `lask/3` without touching `frame` — the compile step found
 *     exactly this and had to add two rules for it — and a canvas that only read
 *     the delta would draw the new words in the old box.
 *
 * On a one-layer machine the union is every field that differs from the picture,
 * so overlaying it is byte-for-byte what taking the copy wholesale was: the
 * fields left out are the ones already equal. That equivalence is the reason
 * this could be changed under every existing document without changing one of
 * them.
 */
function statesField(
	delta: StatePart | undefined,
	which: "props" | "frame" | "turn",
	field: string,
	copyValue: unknown,
	drawnValue: unknown,
): boolean {
	if (copyValue === undefined) return false;
	if (copyValue !== drawnValue) return true;
	const named = delta?.[which] as Record<string, unknown> | undefined;
	return named !== undefined && named[field] !== undefined;
}

export interface ArtboardProps {
	/**
	 * The document. Read for the vertices of a plotted node, the lean of a
	 * diagonal one, and — since layers and timelines — for which layer writes
	 * which field of a played part and what a keyframe's value is. See
	 * {@link Artboard} and {@link statesField}.
	 */
	scene: Scene;
	universe: Universe;
	/** Overrides live geometry during a drag, before it is committed. */
	preview?: ReadonlyMap<string, Frame>;
	/** Variable keys the solver reports as unsettled, for the in-place marks. */
	varying?: ReadonlySet<string>;
	/**
	 * Instance node id -> layer id -> a state to draw that layer in instead of
	 * the one the answer set shows.
	 *
	 * **Nested where it used to be flat**, because a machine is in one state per
	 * layer all at once. Read out of `universe.model.states`, so it still costs no
	 * solve — every one of those copies is already in the answer set beside the
	 * picture, three layers included, which is the invariant the whole feature
	 * turns on.
	 */
	playing?: Readonly<Record<string, Readonly<Record<string, string>>>>;
	/**
	 * Instance node id -> where its timeline scrubber is, in milliseconds.
	 *
	 * The canvas samples the timeline the played state plays and interpolates
	 * between the two keyframes either side — out of the same answer set, so
	 * scrubbing costs no solve either. An instance with no entry is not being
	 * scrubbed and its parts sit at whatever the state settles at, which is the
	 * timeline's own end.
	 */
	scrub?: Readonly<Record<string, number>>;
	/**
	 * Viewport node ids that may hold a live WebGL context.
	 *
	 * Absent means **none**, and that default is the one that keeps the promise:
	 * a read-only copy in the multiverse, a state-strip cell and a thumbnail all
	 * render this component and none of them should open a WebGL context or
	 * download three.js. The editable copy grants the ones it can afford.
	 */
	live?: ReadonlySet<string>;
	/** The editor's selection, so a picked object in a 3D view gets an outline. */
	selection?: ReadonlySet<string>;
	/**
	 * A click inside a 3D view, with the node id the raycaster landed on — the
	 * *same id* the layer list uses, which for an instance's part is
	 * `inst(I,label)`, and null where the ray hit nothing.
	 *
	 * Absent means the view takes no pointer events at all, which is what keeps
	 * the 2D editor's marquee, drag and context menu working over a viewport that
	 * nobody has entered.
	 */
	onPickNode?: (id: string | null, event: PointerEvent) => void;
	/** Whether the editor has entered a view and may orbit inside it. */
	orbit?: ReadonlySet<string>;
	/**
	 * Offer a transform gizmo inside an entered view, in this mode.
	 *
	 * Absent means no gizmo anywhere, which is the default and which is what
	 * every read-only copy in the multiverse, every state-strip cell and every
	 * thumbnail gets: handles on a design you are not editing are handles that
	 * lie. `ViewportCanvas` draws one only where this *and* {@link onSpatialEdit}
	 * are present and exactly one node is selected — a gizmo on several nodes has
	 * to decide where it stands, and both honest answers are wrong.
	 */
	gizmo?: GizmoMode;
	/**
	 * Where a drag on that gizmo ends up: a translation in EMU or a turn in
	 * thousandths of a degree, as a delta since the previous edit of the same
	 * drag.
	 *
	 * Nothing in this file applies one. The canvas reports the gesture and the
	 * editor above it owns the document — which is the same division every other
	 * gesture in the studio makes, and the reason `canvas-3d` exports
	 * `applySpatialEdit` separately from the component that emits the edit.
	 */
	onSpatialEdit?: (edit: SpatialEdit) => void;
	/**
	 * The first frame each live view draws, handed back as a PNG data URL with
	 * the viewport's node id.
	 *
	 * **What it is for is the export and nothing on this canvas.** HTML and CSS
	 * have no word for geometry, so a viewport exports as a coloured rectangle
	 * unless somebody hands `exportUniverse` a picture of what was inside it —
	 * and `design-core` cannot take that picture, because a renderer in there is
	 * the one dependency that package does not have. A WebGL canvas can, and this
	 * is the only place in the studio that holds one.
	 *
	 * Absent means no poster is taken **and no drawing buffer is preserved**,
	 * which is the reason this is a prop rather than something the canvas always
	 * does: `preserveDrawingBuffer` costs a copy of every frame, and it is paid
	 * for only by the views somebody asked a picture of.
	 */
	onPoster?: (viewport: string, dataUrl: string) => void;
	/** The camera's scale, so a canvas under a CSS zoom is redrawn rather than resampled. */
	scale?: number;
	className?: string;
	style?: CSSProperties;
}

/**
 * Renders one universe of the document.
 *
 * What it draws is `universe.model`: the tree, the paint order, the frames and
 * the final text of every property, read straight out of the answer set. The
 * document is still what you select, drag and inspect, but it is no longer
 * what you see — so a rule that moves a node or repaints it shows up on the
 * canvas without the renderer knowing such a rule exists. That is why there is
 * no `resolveValue` here for a *property*, and no picks in the geometry: the
 * solver has done it.
 *
 * Three things are still read from the document, because the answer set does not
 * carry them: a plotted node's vertices, a diagonal node's lean, and — added
 * with the layers — which layer of a machine *writes* a given field, plus what a
 * keyframe's value is. The first two are structure rather than value; the third
 * is `mwriter/4`'s rule restated, see {@link statesField}; the fourth is a
 * `Value` and does go through `resolveValue`, against this universe's own picks,
 * exactly as `export.ts` does it. Everything the picture is *made of* still
 * comes from the atoms.
 *
 * What it draws is the design and *only* the design. The margins, the column
 * grid and the guides a designer drew rule a design without being part of it —
 * the same line the exporter draws, and for the same reason — so they are a
 * sibling of this component rather than something inside it: whoever places an
 * artboard places a `Guides` beside it in the same plane.
 *
 * Frames are positioned relative to their parent, which is exactly what nested
 * absolutely-positioned elements already do — so the render is a plain
 * recursion with no coordinate maths.
 *
 * That plane is **canvas pixels**, and it is where the document's EMU stops.
 * Everything from `design-core` is EMU; a browser lays out in CSS pixels and
 * cannot be talked out of it; so the crossing is one call in {@link render} and
 * one inside {@link Plot}, and nothing else in the file converts.
 *
 * ## The third axis
 *
 * A `viewport` is an ordinary rectangle on the page — placed, sized, snapped and
 * painted like any other — and what is *inside* one is three-dimensional. So the
 * recursion stops at it: `KINDS.viewport.opaque` is true, the div is drawn with
 * its own fill and radius, and its subtree becomes a `<canvas>` rather than
 * nested divs. Nothing about that is a special case in the walk — `opaque` is a
 * lookup, and `export.ts`'s four walks make the same one — and a mesh is still an
 * ordinary node everywhere else: it is in the layer list, it is selectable, a
 * rule can name it, and it takes part in the multiverse.
 *
 * ## Playing a machine
 *
 * One thing it draws that is *not* in `universe.model.roots`: a state machine's
 * other states. `playing` names, per instance **and per layer**, a state to draw
 * instead of the one the answer set shows, and the values come out of
 * `universe.model.states` — the same answer set, read one key over. So playing a
 * machine on the canvas costs no solve at all, and the renderer learns exactly
 * two things about states: where to look up a part's other self, and which
 * layer's opinion wins. It learns nothing about triggers, edges, inputs or time,
 * all of which are the editor's business above it.
 *
 * How fast a played change moves is *also* not here. The transition is declared
 * in this component's stylesheet against three custom properties, and whoever
 * is running the machine sets them on an ancestor — see `Editor.tsx`. That way
 * the artboard states that it animates and the editor states how, which is the
 * same division CSS itself makes and the same one the export makes between a
 * rule and the `transition:` on it. With the properties unset the duration is
 * zero, so nothing on a canvas nobody is previewing ever animates: a drag must
 * never lag behind the pointer.
 *
 * Memoised because the editor above it re-renders on every pointermove, and
 * most gestures (marquee, draw) do not touch the document at all.
 */
export const Artboard = memo(function Artboard({
	scene,
	universe,
	preview,
	varying,
	playing,
	scrub,
	live,
	selection,
	onPickNode,
	orbit,
	gizmo,
	onSpatialEdit,
	onPoster,
	scale,
	className,
	style,
}: ArtboardProps) {
	// The vertices and the lean, by id. Memoised on the tree: the editor
	// re-renders on every pointermove and this is a walk of the whole document.
	const docNodes = useMemo(() => {
		const context = { tokens: scene.tokens, picks: universe.pick };
		const byId = new Map<string, DocShape>();
		for (const node of flatten(scene.nodes)) {
			byId.set(node.id, { node, authored: frameOf(node, context) });
		}
		return byId;
	}, [scene.nodes, scene.tokens, universe.pick]);

	/**
	 * The pose to draw a node in, where the canvas is playing one.
	 *
	 * This is the whole of playback on the canvas, and it is still lookups
	 * because the answer set did the work. A node of the picture that belongs to
	 * an instance is `inst(I,N)`; the state copies of that same part are
	 * `stt(I,S,N)`, sitting in `model.states` beside the picture rather than in
	 * it — deliberately not `node/1`, so they never reach `roots`, `byId`, the
	 * layer list or hit testing. So "draw this instance's press layer in `down`"
	 * is: read the term back, look the copy up, and take the fields that layer
	 * writes.
	 *
	 * **Nothing solves.** Every state of every layer is true at once in the one
	 * answer set, so every copy being asked for is already in hand. That is what
	 * makes hovering a button on the canvas cost a lookup rather than a grounding,
	 * and it is the reason `shown/2` is a fact rather than a choice — see the
	 * machine section of the generated program. It is also why *three* layers cost
	 * three lookups rather than twelve universes.
	 *
	 * A part with **no copy** falls back to the node's own values, and that is
	 * correct rather than a hole: the materialisation analysis only mints copies
	 * for the parts some state touches plus their ancestors, so a part no state
	 * has an opinion about has nothing to say and the picture already draws what
	 * it would have said. Treating a missing copy as an error would make the
	 * analysis — the thing that keeps grounding affordable — into a bug.
	 *
	 * Rebuilt only when the played states, the scrubber or the answer set change,
	 * because it is called once per node per render and the editor re-renders on
	 * every pointermove. The per-node answers are cached inside it for the same
	 * reason: a deep tree asks about every node, and a part of an instance is
	 * asked about once per artboard on the canvas.
	 */
	const poseOf = useMemo(
		() => posesFor(scene, universe, playing, scrub),
		[scene, universe, playing, scrub],
	);

	function render(node: ModelNode) {
		/**
		 * A state that hides a part takes its subtree with it, exactly as
		 * `readModel`'s own `drawn` filter does for the shown state — closing the
		 * hiding downward is the reader's job in its own medium, which for a DOM
		 * is not descending, and for the exported stylesheet is `display: none`
		 * and CSS nesting.
		 *
		 * The converse does not hold and cannot: a part the *shown* state hides is
		 * not in the model at all, so playing a state that shows it again has
		 * nothing to draw. That is a real limitation of drawing the picture the
		 * answer set describes, it bites the same way in the export, and the way
		 * round it is to draw the instance in the state that shows the most —
		 * which is what `SceneNode.state` is for.
		 */
		const pose = poseOf(node.id);
		if (pose?.hidden) return null;
		// The solver has not seen an uncommitted drag, so the one thing that
		// still overrides the answer set is the frame the pointer is holding.
		//
		// Converted here and once, the way the exporter's `framePx` does it and
		// for the same reason: everything below this line is a browser's business
		// — a `left`, an SVG user unit, an arrowhead clamped between 8 and 24 —
		// and every one of those numbers was written in pixels. What arrives is
		// EMU, because that is what the document says and what the answer set
		// carries, and the two are both `number` with a factor of 9525 between
		// them, so a frame that reached the DOM unconverted would draw a business
		// card nine miles wide.
		//
		// A drag beats a played state, and the order is not arbitrary: a pointer
		// holding a frame is the most recent thing anybody said, and the two never
		// happen together anyway — the editor takes the canvas out of edit mode
		// before it will play anything.
		const drawn = posed(node, pose);
		const frame = canvasRect(preview?.get(node.id) ?? drawn.frame);
		const unsettled =
			varying !== undefined &&
			Object.keys(node.rendered).some((prop) =>
				varying.has(propVar(node.id, prop)),
			);

		const box: CSSProperties = {
			position: "absolute",
			left: frame.x,
			top: frame.y,
			width: frame.width,
			height: frame.height,
			boxSizing: "border-box",
			// The ground, the kind's own box and every property it paints, from
			// the one table the exporter reads too.
			...(paintOf(drawn) as CSSProperties),
		};

		/**
		 * A viewport is where the pointer stops and where the markup stops.
		 *
		 * One lookup — `KINDS[kind].opaque` — and it is the same lookup `export.ts`
		 * makes in each of its four walks, so what the canvas draws and what the
		 * file contains cannot disagree about where a scene begins. The subtree is
		 * *not* absent: it is in the layer list, in the multiverse, in the answer
		 * set and in `node.children` right here, and the renderer hands the whole
		 * of it to `ViewportCanvas` rather than turning it into divs.
		 */
		const stops = KINDS[node.kind].opaque;

		return (
			<div
				key={node.id}
				data-node={node.id}
				data-kind={node.kind}
				// The same attribute the exported file switches on, carrying the same
				// state id — so what a screenshot of the canvas shows and what the
				// stylesheet selects are visibly the same claim. The first layer is
				// plain `data-state` and every further one is `data-state-<layer>`,
				// which is `attributeOf` in `runtime.ts` and `StateLayer` in
				// `export.ts` to the letter.
				data-state={pose?.state}
				{...layerAttributes(pose)}
				data-varies={unsettled ? "" : undefined}
				className={unsettled ? `${styles.node} ${styles.varies}` : styles.node}
				style={box}
				title={unsettled ? "This property has more than one value" : undefined}
			>
				{CONTENT[node.kind]?.(
					drawn,
					frame,
					docNodes.get(node.id),
					node.kind === "viewport"
						? {
								model: universe.model,
								live: live?.has(node.id) ?? false,
								scale,
								selection,
								onPickNode,
								orbit: orbit?.has(node.id) ?? false,
								// The gizmo goes only to the view the editor is inside,
								// which is the same set `orbit` names and for the same
								// reason: handles in a view nobody has entered would take
								// the pointer away from the 2D marquee that runs over it.
								gizmo: orbit?.has(node.id) ? gizmo : undefined,
								onEdit: orbit?.has(node.id) ? onSpatialEdit : undefined,
								// Bound to this view's own id here, so the caller gets a
								// poster it can key rather than a data URL with no idea
								// which rectangle it is a picture of.
								onPoster: onPoster
									? (url: string) => onPoster(node.id, url)
									: undefined,
							}
						: undefined,
				)}
				{stops ? null : node.children.map(render)}
			</div>
		);
	}

	return (
		<div
			className={className ? `${styles.artboard} ${className}` : styles.artboard}
			style={{ ...(DOCUMENT_BASE as CSSProperties), ...style }}
			data-artboard=""
		>
			{universe.model.roots.map(render)}
		</div>
	);
});

/**
 * `data-state-<layer>` for every layer after the first.
 *
 * A spread rather than a loop in the JSX because React has no other way to write
 * a computed attribute name, and the *first* layer is left out on purpose: it
 * writes plain `data-state` above, which is what a one-layer document has always
 * had and what must go on meaning exactly what it meant. `runtime.ts`'s
 * `attributeOf` makes the same split in the emitted script and `export.ts`'s
 * `StateLayer` makes it in the emitted stylesheet, so all three agree that a
 * machine with no layers never mentions the word `base` anywhere a person can
 * see it.
 */
function layerAttributes(pose: Pose | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [layer, state] of Object.entries(pose?.states ?? {})) {
		if (state === pose?.state) continue;
		out[`data-state-${layer}`] = state;
	}
	return out;
}

/**
 * The node as this pose has it: same id, same kind, same children, other
 * numbers.
 *
 * A fresh object rather than a mutation, because `node` is the answer set's own
 * account of the picture and is shared with the layer list, the inspector and
 * the exporter. Only the fields a state may change are replaced — geometry, the
 * two spatial numbers, the three angles, and rendered text — which is the same
 * list `StatePart` offers, and it is a list rather than a spread because a state
 * that could change a node's *kind* or its children would be a second document
 * per state, which is the design this feature exists not to be.
 *
 * The three-dimensional half is here and not only in the flat path because a
 * pose has to reach the renderer too: a state that lifts a mesh 40px forward is
 * a state whose copy differs from the picture in `z` and in nothing else, and a
 * viewport handed the unposed node would draw the machine's rest pose while the
 * div beside it showed the played one.
 */
function posed(node: ModelNode, pose: Pose | undefined): ModelNode {
	if (!pose) return node;
	const out: ModelNode = { ...node };
	if (pose.frame) out.frame = { ...node.frame, ...pose.frame };
	if (pose.rendered) out.rendered = { ...node.rendered, ...pose.rendered };
	// Absent stays absent. `ModelNode.spatial` being undefined is a claim — "this
	// is a flat thing in a flat place" — and inventing `{ z: 0 }` for a pose that
	// only turned something would put a rect on a plain artboard into the third
	// axis, which is the narrowing merged-plan §4 exists to protect.
	if (pose.spatial && node.spatial) out.spatial = { ...node.spatial, ...pose.spatial };
	if (pose.turn && node.turn) out.turn = { ...node.turn, ...pose.turn };
	return out;
}

/**
 * Every pose the canvas is currently pretending about, as a function from node
 * id.
 *
 * Built once per (document, universe, played states, scrubber) and cached per
 * node inside, because the caller asks about every node of every copy on the
 * canvas on every render. The empty case short-circuits to a function that
 * answers nothing at all, which is what every artboard that is not being played
 * — the multiverse copies, the state-strip cells, a thumbnail — gets.
 */
function posesFor(
	scene: Scene,
	universe: Universe,
	playing: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined,
	scrub: Readonly<Record<string, number>> | undefined,
): (id: string) => Pose | undefined {
	if (!playing || Object.keys(playing).length === 0) return () => undefined;

	const context: ResolveContext = { tokens: scene.tokens, picks: universe.pick };
	const model = universe.model;
	/**
	 * The machine driving each played instance, looked up once.
	 *
	 * Through the document rather than the answer set, because which machine an
	 * instance belongs to is a fact about the document — `minstance/2` is shown by
	 * nothing, and `model.ts` says so where it has to join through `shown/2`
	 * instead. Here the document is in hand, so the direct question is the right
	 * one.
	 */
	const machines = new Map<string, Machine>();
	for (const node of instanceNodes(scene)) {
		if (playing[node.id] === undefined) continue;
		const machine = machineForNode(scene, node);
		if (machine) machines.set(node.id, machine);
	}
	if (machines.size === 0) return () => undefined;

	const cache = new Map<string, Pose | undefined>();
	return (id: string): Pose | undefined => {
		if (cache.has(id)) return cache.get(id);
		const answer = poseFor(id);
		cache.set(id, answer);
		return answer;
	};

	function poseFor(id: string): Pose | undefined {
		const part = parseInstancePart(id);
		if (!part) return undefined;
		const machine = machines.get(part.instance);
		const byLayer = playing?.[part.instance];
		if (!machine || !byLayer) return undefined;
		const drawn = model.byId[id];

		const pose: Pose = {};
		const states: Record<string, string> = {};
		let first = true;
		for (const layer of machineLayers(machine)) {
			const stateId = byLayer[layer.id];
			// A layer nobody is playing is left exactly as the answer set drew it,
			// which is the whole of what "hand this layer back to the document"
			// means. Its state is not written into `data-state-<layer>` either, so
			// the attribute says what is being pretended and nothing else.
			if (stateId === undefined) {
				first = false;
				continue;
			}
			states[layer.id] = stateId;
			if (first) pose.state = stateId;
			first = false;

			const copy = model.states[statePart(part.instance, stateId, part.node)];
			if (!copy) continue;
			if (copy.hidden) pose.hidden = true;
			const delta = findState(machine, stateId)?.parts[part.node];

			for (const dim of PLANAR) {
				if (statesField(delta, "frame", dim, copy.frame[dim], drawn?.frame[dim])) {
					(pose.frame ??= {})[dim] = copy.frame[dim];
				}
			}
			for (const dim of SPATIAL) {
				const value = copy.spatial?.[dim];
				if (statesField(delta, "frame", dim, value, drawn?.spatial?.[dim])) {
					(pose.spatial ??= {})[dim] = value as number;
				}
			}
			for (const axis of TURNS) {
				const value = copy.turn?.[axis];
				if (statesField(delta, "turn", axis, value, drawn?.turn?.[axis])) {
					(pose.turn ??= {})[axis] = value as number;
				}
			}
			for (const [prop, value] of Object.entries(copy.rendered)) {
				if (
					statesField(delta, "props", prop, value, drawn?.rendered[prop as PropName])
				) {
					(pose.rendered ??= {})[prop as PropName] = value;
				}
			}

			// What the state is passing *through*, where somebody is dragging the
			// scrubber. Applied after the settled pose and over the top of it, which
			// is the right order: a state's settled pose is its timeline's value at
			// its own end, so a scrubber at the end changes nothing and a scrubber
			// anywhere else is the thing being asked about.
			const at = scrub?.[part.instance];
			if (at !== undefined) {
				sampleInto(pose, machine, stateId, part.node, at, context);
			}
		}

		if (Object.keys(states).length > 0) pose.states = states;
		return Object.keys(pose).length === 0 ? undefined : pose;
	}
}

/**
 * A timeline, sampled at one moment, folded into a pose.
 *
 * **This costs no solve either.** Every keyframe's time is `mkat/5` in the answer
 * set and every keyframe's value is a `Value` resolved against this universe's
 * own picks through `keyValueVar` — the same two readings `export.ts` makes when
 * it writes a `@keyframes` block, so what the scrubber shows at 40% and what the
 * exported file draws at 40% come from the same numbers. `sampleTimeline` says
 * which two keyframes a moment sits between and how far; this says what is
 * between them, which is the split that file's header argues for and the reason
 * the answer comes back as a pair rather than a value.
 *
 * **Linearly, and the easing is ignored.** `export.ts`'s own `sampleAt` makes
 * exactly this compromise for exactly this reason — a curve between two
 * keyframes is the compositor's job in the file, and a canvas that applied the
 * curve here while the file applied it there would be two animations of one
 * document. It is named in the export's losses; it is named here.
 *
 * A value that is not a quantity does not interpolate at all and **steps**: a
 * word is a word, a colour would need a colour space this file has no business
 * knowing about, and holding the keyframe you are past is what `animation-fill-mode`
 * does at the ends and what a step function does in between. A colour that snapped
 * halfway is a worse lie than one that snaps at the keyframe.
 */
function sampleInto(
	pose: Pose,
	machine: Machine,
	stateId: string,
	part: string,
	ms: number,
	context: ResolveContext,
): void {
	const state = findState(machine, stateId);
	const timeline = state?.timeline
		? findTimeline(machine, state.timeline)
		: undefined;
	if (!timeline) return;
	const samples = sampleTimeline(machine, timeline, ms, context);
	for (const track of timeline.tracks) {
		if (track.part !== part) continue;
		const term = trackTerm(track);
		if (term === undefined) continue;
		const sample = samples[term];
		if (sample === undefined) continue;

		/** One end of the segment, as this universe resolved it. */
		const read = (key: SolvedKeyframe | undefined): string | undefined =>
			key === undefined
				? undefined
				: resolveValue(
						context,
						key.key.value,
						keyValueVar(machine.id, timeline.id, term, key.index),
					);
		const from = read(sample.from);
		const to = read(sample.to);
		if (from === undefined) continue;

		// A quantity is interpolated and everything else is held. The reader is
		// chosen by what the *track* animates rather than by what the text looks
		// like — `emuOf` for the six dimensions, `mdegOf` for the three angles —
		// so a length that happens to parse as an angle cannot be mixed as one.
		if (track.dim !== undefined) {
			const at = lerp(emuOf(from), to === undefined ? undefined : emuOf(to), sample.t);
			if (at === undefined) continue;
			if (track.dim === "z" || track.dim === "depth") {
				(pose.spatial ??= {})[track.dim] = at;
			} else {
				(pose.frame ??= {})[track.dim] = at;
			}
		} else if (track.turn !== undefined) {
			const at = lerp(mdegOf(from), to === undefined ? undefined : mdegOf(to), sample.t);
			if (at !== undefined) (pose.turn ??= {})[track.turn] = at;
		} else if (track.prop !== undefined) {
			// A property steps. A word is a word; a colour would need a colour space
			// this file has no business knowing about; and holding the keyframe you
			// are past is what `animation-fill-mode: both` does at the ends of the
			// exported animation and what a step function does in between. A colour
			// that snapped halfway would be a worse lie than one that snaps on the
			// key.
			(pose.rendered ??= {})[track.prop] = from;
		}
	}
}

/**
 * Two numbers, `t` of the way between — or the first alone where there is no
 * second.
 *
 * Nothing crosses a unit here, which is the point of doing the arithmetic on
 * numbers rather than on text: `emuOf` and `mdegOf` have already turned the two
 * keyframes into the units the answer set and the model use, and a pose is
 * assigned in exactly those. A version that mixed the strings would have had to
 * write a length back out as `px`, which is a second unit crossing in a file
 * whose header promises there is one.
 */
function lerp(from: number | undefined, to: number | undefined, t: number): number | undefined {
	if (from === undefined) return undefined;
	if (to === undefined) return from;
	return from + (to - from) * t;
}
