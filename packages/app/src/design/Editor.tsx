/**
 * The pointer's half of the studio: what a drag, a resize, a marquee and a pen
 * do to the document, and the outlines and guides that say so while they happen.
 *
 * It also reads the lines the design is *ruled* with — the margins, the column
 * and row grid, the guides somebody pulled off a ruler — hands them to
 * {@link Guides} to draw, and lets a drag catch on them. (Drawing them is that
 * component's because every copy on the canvas needs the same picture and only
 * this one needs the gestures.) Those are not decoration and they are not a
 * second snapping system:
 * every one of them is a datum with a name (`cg(page,3,left)`), read out of the
 * answer set like any other geometry, and catching on one is the beginning of a
 * rule rather than the end of a nudge. Which is why the release offers to write
 * it: see {@link offer}. Hiding them is this component's business and never the
 * document's — a design that changed when you hid the guides would be a bug.
 *
 * **Two units meet in this file and they are both `number`.** Everything the
 * document says and everything `design-core` answers with is EMU; everything
 * that reaches the DOM is CSS pixels, because that is what a browser lays out
 * in. Between them sits a factor of 9525 and no type error.
 *
 * So the rule here is that the crossing happens at the edges and nowhere in
 * between. A pointer event becomes a document point in {@link toDocument}, once,
 * and from that line on every coordinate in this module — every gesture origin,
 * every delta, every preview frame, every pen vertex, every snap guide — is EMU
 * and is handed straight to `design-core`, which is EMU too. On the way back out
 * every number that becomes a `left`, a `top`, an `x1` or a `points` attribute
 * goes through `viewport.ts`, and nothing else in the file converts.
 *
 * That leaves the handful of constants below, which are the part worth being
 * careful about, because a screen pixel and a canvas pixel are not the same
 * thing either. A tolerance about *aim* — how near a click has to land to close
 * a path — divides by the camera scale, so the target stays the same size under
 * the cursor at every zoom. Everything else is furniture fixed in the document's
 * own plane and is a pixel count times `EMU_PER_PX`. `geometry.ts` makes the
 * same distinction about its own three constants and for the same reason: left
 * as bare 2s and 4s they would still typecheck and would silently stop guarding
 * anything at all, because two EMU is a five-thousandth of a pixel and every
 * tremor of a hand clears it. Every click of the pen would leave a curve behind
 * it and every drag that went nowhere would write an undo entry, and nothing
 * anywhere would say why.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
	EMU_PER_PX,
	type Annotation,
	type DerivedNode,
	type Edge,
	EDGES,
	type Frame,
	type Freedom,
	HANDLES,
	HANDLE_CURSOR,
	type Handle,
	KINDS,
	type NodeKind,
	type PathPoint,
	type Placed,
	type Point,
	type ResolveContext,
	type RuledLine,
	type Picks,
	type Scene,
	type SnapGuide,
	type Trigger,
	type Universe,
	addNodeTo,
	addViewport,
	flatten,
	annotate,
	boundsOf,
	clampTo,
	datumLabel,
	derivedAt,
	dropTargetAt,
	edgeOn,
	frameAncestorOf,
	frameAt,
	frameDim,
	frameContains,
	frameFromPoints,
	frameOf,
	framesIntersect,
	handleEdges,
	hitTestTree,
	isDrawable,
	isPartOf,
	isPlaced,
	isSurface,
	makeNode,
	makePath,
	managedNodes,
	moveGuide,
	narrow,
	normaliseFrame,
	paintedOver,
	parentMap,
	findInTree,
	movePathPoint,
	pinToDatum,
	pinnedTo,
	removeGuide,
	ruledLines,
	setGuideLocked,
	setPathHandle,
	removePathPoint,
	snapLines,
	togglePathSmooth,
	worldOrigin,
	placedNodes,
	pathBounds,
	reparent,
	resizeFrame,
	resizeSubtree,
	sceneContext,
	selectionTargetOf,
	setFrames,
	snapFrame,
	travelFrom,
	viewportOf,
	viewports,
	wrapsChildren,
} from "@clingo-design/design-core";

import { Annotations } from "./Annotations";
import { Artboard } from "./Artboard";
import { cx } from "./cx";
import { Guides } from "./Guides";
import type { GizmoMode, SpatialEdit } from "@clingo-design/canvas-3d";

import styles from "./Editor.module.css";
import {
	canvasPoint,
	canvasPx,
	canvasRect,
	documentPoint,
	documentSpan,
} from "./viewport";

export type Tool = "select" | NodeKind;

/**
 * How near the first point a click must land to close a path, in screen
 * pixels — divided by the scale, so zooming does not change the target. The
 * only constant here that is about aim, and so the only one that goes through
 * {@link documentSpan}.
 */
const CLOSE_RADIUS = 10;

/**
 * How far the pointer must leave a just-placed point before the pen bends it
 * into a curve: two canvas pixels, as EMU.
 *
 * A hand on a mouse is never quite still, and without a floor every click of
 * the pen would leave a bezier behind it. Not scaled by the camera, because
 * what it guards against is the shake, not the aim.
 */
const PEN_PULL = 2 * EMU_PER_PX;

/**
 * How far a drag has to have carried the selection before it counts as an edit:
 * half a canvas pixel, as EMU.
 *
 * It is measured on the *allowed* movement, so a drag that went nowhere because
 * the constraints left nowhere to go writes nothing and puts nothing in the undo
 * stack. Half a pixel is well under the whole-pixel quantum a gesture is written
 * at, so anything that survives this test is something that will visibly move.
 */
const MOVED = EMU_PER_PX / 2;

/**
 * A draw gesture narrower or shorter than this in either direction was a click
 * rather than a drag, and places a default-sized node: four canvas pixels, as
 * EMU.
 *
 * The same number as `MIN_NODE_SIZE` and not the same statement — that one is
 * the smallest a node may be dragged *down* to, this one is the smallest drag
 * that counts as one at all — so they are written twice on purpose.
 */
const CLICK_SIZE = 4 * EMU_PER_PX;

/**
 * How far a travel mark reaches when the constraints never stop it: two hundred
 * canvas pixels, as EMU. A line to infinity is not a drawing, and the point
 * being made is "this end is open", which a long line with no tick already
 * makes.
 */
const OPEN = 200 * EMU_PER_PX;

/**
 * Half the length of the tick drawn across a travel mark's closed end, in
 * canvas pixels. Applied after the mark's ends have crossed into the canvas,
 * because it is a mark on the drawing rather than a distance in the design.
 */
const TICK = 4;

/**
 * What the pointer is currently doing.
 *
 * Deliberately holds only what is fixed for the whole drag — the live pointer
 * position lives in {@link current} instead. That keeps a gesture's identity
 * stable, so the window listeners are attached once per gesture rather than
 * torn down and rebuilt on every pointermove.
 */
type Gesture =
	| { kind: "none" }
	| {
			kind: "move";
			origin: Point;
			/** Absolute frames at gesture start, keyed by node. */
			start: Map<string, Frame>;
	  }
	| { kind: "resize"; handle: Handle; origin: Point; start: Frame; id: string }
	| { kind: "marquee"; origin: Point }
	/** Dragging away from a point the pen has just placed, to curve it. */
	| { kind: "penPull"; origin: Point }
	/** Dragging a line somebody drew, along the axis it is not on. */
	| { kind: "guide"; surface: string; guide: string; axis: "x" | "y" }
	/** Dragging one of a selected path's vertices. */
	| { kind: "anchor"; id: string; index: number }
	/** Dragging a vertex's curve handle. `mirror` keeps the far side opposite. */
	| {
			kind: "handle";
			id: string;
			index: number;
			side: "in" | "out";
			mirror: boolean;
	  }
	| { kind: "draw"; nodeKind: NodeKind; origin: Point };

export interface EditorProps {
	scene: Scene;
	universe: Universe;
	selection: ReadonlySet<string>;
	onSelectionChange: (ids: string[]) => void;
	/** `coalesce` groups a gesture's updates into one undo entry. */
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/**
	 * The first frame each live 3D view draws, as a PNG data URL, by viewport id.
	 *
	 * Passed straight through to {@link Artboard} — the editor has no use for a
	 * poster and never looks at one. It is here because the editable copy is the
	 * only `Artboard` in the studio that mounts a live view somebody is looking
	 * at, and the export panel is where the picture ends up. Absent means no
	 * poster and no preserved drawing buffer.
	 */
	onPoster?: (viewport: string, dataUrl: string) => void;
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	/**
	 * A node every new node must land inside, when the canvas is showing one
	 * document that *is* one object.
	 *
	 * Set only while a component is open. A component document holds one
	 * definition, and `libraryOf` reads exactly that one root — so a node drawn
	 * beside it rather than inside it is saved, kept, listed in the layer list,
	 * and part of no component. Not lost, not used, and nothing saying which.
	 *
	 * So the host is not a question here: it is this, always. A surface drawn on a
	 * page becomes a root; a surface drawn in a component becomes a child of the
	 * definition like everything else, because a component with two roots is not a
	 * thing this document model has.
	 */
	confineTo?: string;
	/** Camera scale, so a screen distance converts to a canvas one. */
	getScale: () => number;
	/**
	 * The document point this surface's top-left corner shows, in EMU. Content
	 * is drawn translated by its negation, so a node at document x always lands
	 * at document x on screen no matter where the surface itself sits.
	 */
	origin: Point;
	/** Variable keys that are not settled, for the in-place overlay. */
	varying?: ReadonlySet<string>;
	/**
	 * How far the selection's solver-owned coordinates can still travel. A node
	 * absent from it has not been probed; an axis absent from a node it has is
	 * the document's own number and free by construction.
	 */
	freedom?: Freedom;
	/**
	 * Nodes the answer set has that the document does not — see `derived.ts`.
	 *
	 * The canvas draws them like anything else, so the pointer has to be able to
	 * reach them; what it may then do with one is select it and nothing more.
	 */
	derived?: readonly DerivedNode[];
	/**
	 * Whether the margins, the grid and the hand-drawn lines are on show.
	 *
	 * Editor state, never the document's, and it reaches no solve — a design that
	 * changed when you hid the guides would be a bug. It does govern *snapping*,
	 * though, and deliberately: catching on a line nobody can see is the drag
	 * mysteriously refusing to go where it was aimed, which is exactly what "get
	 * these off my screen" was asking to stop.
	 */
	showGuides?: boolean;
	/**
	 * Whether the surface is running the document's machines instead of editing
	 * it.
	 *
	 * **An explicit mode, and it has to be one.** The triggers a machine listens
	 * for are `pointerenter`, `pointerdown` and `click` — which are, to the
	 * letter, the events a drag is made of. A canvas that fired them while
	 * somebody was moving a button would hover it on the way past, press it on
	 * the way down and click it on the way up, and the designer would never once
	 * have asked to see the machine run. The alternatives are worse: firing only
	 * on some modifier hides the feature, and firing only when nothing is
	 * selected makes the same gesture mean two things depending on state nobody
	 * is looking at. So it is a toggle, it is off by default, and while it is on
	 * there is nothing to edit — see the stylesheet, which takes the whole
	 * editing overlay off the screen rather than leaving handles somebody can
	 * pull on a design that is mid-transition.
	 */
	previewing?: boolean;
	/**
	 * Instance node id -> layer id -> the state to draw that layer in, handed
	 * straight to the artboard. Editor state; the document knows nothing about it.
	 *
	 * Nested since layers, because a machine is in one state per layer all at
	 * once. Nothing in this file reads it — it is passed through — which is why
	 * the widening cost one type and no logic.
	 */
	playing?: Readonly<Record<string, Readonly<Record<string, string>>>>;
	/**
	 * Instance node id -> where its timeline scrubber is, in milliseconds. Passed
	 * through to the artboard for the same reason {@link playing} is.
	 */
	scrub?: Readonly<Record<string, number>>;
	/**
	 * A real pointer event at a real instance, in the machine's own vocabulary.
	 *
	 * The editor says *what happened where* and nothing else: which state that
	 * takes the instance to is `stepMachine`'s answer, one level up, and it is
	 * the same answer the exported file's runtime gives because it is the same
	 * lookup over the same table. Keeping the decision out of here is what stops
	 * the studio and the file being two implementations of one machine.
	 */
	onTrigger?: (instance: string, trigger: Trigger) => void;
	/**
	 * How the transition that just fired is paced, in the universe on screen.
	 *
	 * Written onto the content wrapper as custom properties, where the artboard's
	 * own stylesheet reads them — see `Artboard.module.css`. It arrives from
	 * above rather than being worked out here because the numbers are a *value*:
	 * a duration may name a token, so which milliseconds a transition runs for is
	 * something this universe decided and only the model can answer.
	 *
	 * Absent is no animation, which is the state of every canvas that is not
	 * previewing.
	 */
	motion?: { duration: number; delay: number; easing: string };
	/** Right-click, in client coordinates. */
	onContextMenu?: (at: { x: number; y: number }) => void;
}

/**
 * How many viewports on the editable copy may hold a live WebGL context at once.
 *
 * Browsers cap live contexts somewhere around sixteen and silently drop the
 * oldest past that — which shows up as a scene that was there a moment ago going
 * black for no reason a designer can act on. Eight is half the usual cap, on the
 * grounds that the studio is not the only thing on the page and a lost context
 * is a worse failure than a still.
 *
 * The ones over the line draw {@link Still} instead, which is not a placeholder
 * for a missing feature: it is what twenty simultaneous 3D views have to be. The
 * views that get the budget are the first in paint order, which is stable, which
 * means the same document opened twice shows the same views live.
 *
 * `docs/merged-plan.md` M17 puts this in a `useViewportBudget.ts` of its own.
 * That file is not one this step owns, and a hook whose whole body is "take the
 * first eight of a memoised list" is not worth claiming another step's filename
 * for — so it is a constant and a `slice` here, and when that file lands this is
 * the line it replaces.
 */
const LIVE_VIEWS = 8;

/**
 * The editing surface laid over the document.
 *
 * Node frames are relative to their parent, but a pointer knows nothing about
 * anyone's parent, so the editor works in absolute frames throughout and
 * converts back into each node's own space once, on commit. Keeping that
 * conversion at one boundary is what stops coordinate bugs leaking into the
 * drag maths — and it is the same bargain the file header strikes for the other
 * conversion, the one between the design's units and the screen's.
 *
 * It has a second mode, and it is the opposite of everything above. Under
 * {@link EditorProps.previewing} the surface stops being an editor and becomes
 * the design *running*: a pointer over an instance is a `pointerenter`, a press
 * is a `pointerdown`, and each of them is handed up as a trigger rather than
 * turned into a gesture. Nothing here decides what a trigger does — that is one
 * lookup in the same table the exported file ships, so the studio cannot follow
 * an edge a browser would not — and nothing here writes to the document, so
 * watching a machine run costs no edit, no undo entry and no solve at all.
 *
 * The two modes are a toggle rather than a heuristic because the events they
 * are built from are the same events. Every argument for guessing between them
 * ends with a drag that hovers the thing it is dragging.
 */
export function Editor({
	scene,
	universe,
	selection,
	onSelectionChange,
	onSceneChange,
	tool,
	onToolChange,
	confineTo,
	getScale,
	origin,
	varying,
	freedom = {},
	derived = [],
	showGuides = true,
	previewing = false,
	playing,
	scrub,
	onTrigger,
	motion,
	onContextMenu,
	onPoster,
}: EditorProps) {
	const surface = useRef<HTMLDivElement>(null);
	const [gesture, setGesture] = useState<Gesture>({ kind: "none" });
	/** Absolute frames while a gesture is live. */
	const [preview, setPreview] = useState<Map<string, Frame> | null>(null);
	/**
	 * Frames the document has but the answer set has not caught up with, in
	 * each node's own space.
	 *
	 * The canvas draws the last answer set, and the next one is a debounce and
	 * a solve away — so between letting go of a drag and the solver speaking,
	 * the node would otherwise snap back to where it started and jump forward
	 * again. This carries the released frames across that gap. It is dropped
	 * the moment a fresh universe arrives, whatever that universe says: if a
	 * rule put the node somewhere else, that is the answer.
	 */
	const [settling, setSettling] = useState<ReadonlyMap<string, Frame> | null>(
		null,
	);
	useEffect(() => setSettling(null), [universe]);
	/** Live pointer position, for the marquee, draw and pen rubber bands. */
	const [current, setCurrent] = useState<Point | null>(null);
	const [guides, setGuides] = useState<SnapGuide[]>([]);
	/**
	 * The container a move gesture would drop into, while it is live. Null both
	 * when there is no gesture and when the drop would change nothing.
	 */
	const [dropTarget, setDropTarget] = useState<string | null>(null);
	/**
	 * Points the pen has placed, in the document's coordinates — these are the
	 * vertices `makePath` will store, so they are EMU from the moment the click
	 * lands rather than pixels converted at the end. Null when it is not
	 * drawing — a path is several clicks, so unlike every other tool it has a
	 * state that outlives the pointer being down.
	 */
	const [pen, setPen] = useState<PathPoint[] | null>(null);
	/**
	 * The viewport the editor has stepped *inside*, if any.
	 *
	 * A `viewport` is opaque: it is a rectangle on the page that you move, resize
	 * and align like any other, and the pointer stops at its edge. That is what
	 * makes a scene something you can lay out rather than something that swallows
	 * every gesture near it — and it is also what makes selecting the mesh inside
	 * one need a way in. The way in is a double-click, which is the gesture that
	 * already means "reach through this" for a group and for a frame.
	 *
	 * While a view is entered its canvas takes pointer events, so orbiting and
	 * picking happen in the scene and the 2D gestures never see those pixels;
	 * Escape steps back out. Editor state, of course: which view somebody has
	 * their nose in is a fact about the person and reaches no solve, no export and
	 * no undo entry, exactly like the zero point and the guides toggle.
	 */
	const [entered, setEntered] = useState<string | null>(null);
	/**
	 * Leaving preview, or a document that no longer has the view in it, steps out.
	 *
	 * The second half matters more than it looks: a viewport deleted while the
	 * editor was inside it would leave `entered` naming a node that is gone, and
	 * every gesture would go on being routed round a hole in the document.
	 */
	useEffect(() => {
		if (entered === null) return;
		if (previewing || findInTree(scene.nodes, entered) === undefined) setEntered(null);
	}, [previewing, scene.nodes, entered]);
	// Escape steps out of a view before it does anything else. Capture phase and
	// stopped there, because the studio's own Escape would otherwise clear the
	// selection in the same keystroke that left the scene — two things happening
	// for one press, only one of which was asked for. The same arrangement the
	// pen's Enter/Escape already has, one effect below.
	useEffect(() => {
		if (entered === null) return;
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			setEntered(null);
		};
		window.addEventListener("keydown", key, true);
		return () => window.removeEventListener("keydown", key, true);
	}, [entered]);

	/**
	 * Every viewport in the document, and which of them may draw for real.
	 *
	 * `undefined` where the document has none, which is not the same as an empty
	 * set and is the case worth being exact about: `Artboard` only imports
	 * `@clingo-design/canvas-3d` when it actually mounts a live view, so a
	 * document with no viewport never downloads three.js, never opens a WebGL
	 * context, and pays for none of this. That promise is kept by these two lines
	 * and by the `lazy` in `Artboard.tsx`, and nothing else has to know.
	 */
	const views = useMemo(() => viewports(scene).map((node) => node.id), [scene]);
	const liveViews = useMemo(() => {
		if (views.length === 0) return undefined;
		// The view somebody has stepped into goes to the front of the queue. It is
		// the one being pointed at, and a still cannot be picked in or orbited —
		// entering a view past the budget and finding it inert would look exactly
		// like the gesture not working.
		const ordered =
			entered === null ? views : [entered, ...views.filter((id) => id !== entered)];
		return new Set(ordered.slice(0, LIVE_VIEWS));
	}, [views, entered]);
	/** The one view the pointer is inside, as the set the artboard takes. */
	const orbiting = useMemo(
		() => (entered === null ? undefined : new Set([entered])),
		[entered],
	);

	/**
	 * Which handles the entered view offers: arrows, or rings.
	 *
	 * Two modes and no third, because the gizmo has two — a translation is a
	 * vector and its three components are one gesture, while the three rotations
	 * are three stored numbers applied in a fixed order, so a scale mode would
	 * need a third answer that `geometry.ts` does not have. Editor state like
	 * `entered` itself: which handle somebody is holding is a fact about the
	 * person and reaches no solve, no export and no undo entry.
	 */
	const [gizmo, setGizmo] = useState<GizmoMode>("move");

	/**
	 * `applySpatialEdit`, fetched when a view is entered and not before.
	 *
	 * It lives in `canvas-3d`, whose barrel pulls three.js, so a static import
	 * here would put a megabyte and a half into the studio's main chunk in order
	 * to hold one pure function — which is precisely the promise `Artboard`'s
	 * `lazy` keeps and this must not break. The chunk is the same one the renderer
	 * is in, so by the time a gizmo can be dragged the import has already
	 * resolved; the state exists so that the handler is synchronous when it runs,
	 * because a drag that awaited a module between two pointermoves would apply
	 * its deltas out of order.
	 *
	 * No gizmo until it arrives, which is a fraction of a second in which the view
	 * orbits and picks exactly as it did before.
	 */
	const [spatialEdits, setSpatialEdits] = useState<{
		apply: (scene: Scene, edit: SpatialEdit, picks: Picks) => Scene;
	} | null>(null);
	useEffect(() => {
		if (entered === null || spatialEdits !== null) return;
		let alive = true;
		void import("@clingo-design/canvas-3d").then((mod) => {
			if (alive) setSpatialEdits({ apply: mod.applySpatialEdit });
		});
		return () => {
			alive = false;
		};
	}, [entered, spatialEdits]);

	/**
	 * A drag on the gizmo, applied.
	 *
	 * One coalesce key for the whole drag, keyed on the node, so ⌘Z takes the
	 * pose back to where the drag began rather than to the last pointermove —
	 * which is what the `"start"` phase is for: it carries zero movement and
	 * exists so the group opens before anything has changed. `applySpatialEdit`
	 * refuses an empty edit and an id the document no longer holds by returning
	 * the scene unchanged, so both are handled by not being special cases.
	 *
	 * The universe's picks go in because a mesh that is in two places is two
	 * designs: the write lands on the alternative *this* universe chose and the
	 * others are untouched, which is `setFrames`' contract one axis over.
	 */
	const onSpatialEdit = useMemo(() => {
		if (!spatialEdits) return undefined;
		return (edit: SpatialEdit) => {
			onSceneChange(
				(prev) => spatialEdits.apply(prev, edit, live.current.universe.pick),
				`spatial-${edit.id}`,
			);
		};
	}, [spatialEdits, onSceneChange]);

	/**
	 * Where the pointer stops on its way into a viewport.
	 *
	 * `KINDS.viewport.opaque` says the pointer does not go inside, and this is
	 * where the editor keeps that promise. It has to be kept *here* rather than in
	 * `hitTestTree`, and the reason is ownership rather than design: `tree.ts` is
	 * `docs/merged-plan.md`'s M17 and not this step's file, so `hitTestTree`,
	 * `frameAt` and `dropTargetAt` still walk straight into a viewport's subtree
	 * and answer with the mesh they find. Left alone, a click near a cube would
	 * select the cube by its *model-space* box drawn as if it were on the page,
	 * which is a rectangle nowhere near where the cube appears.
	 *
	 * So every hit is folded back out to the outermost viewport the editor has not
	 * entered. Inside the one it *has* entered the fold stops, because in there
	 * the nodes really are what you are pointing at — though in practice the
	 * canvas has already taken the event, and this is the answer for the pixels
	 * of the view the scene does not cover.
	 *
	 * **This is a stand-in for the real fix, and it is narrower than the real
	 * fix.** A marquee still collects a mesh through `targetFor`, and a *drop*
	 * still lands inside a viewport because `dropTargetAt` is asked directly. Both
	 * want the same one condition in `tree.ts`.
	 */
	function outOfView(id: string): string {
		const view = viewportOf(scene, id);
		if (!view || view.id === entered) return id;
		return outOfView(view.id);
	}

	/**
	 * Every node's absolute frame, indexed by id.
	 *
	 * Memoised on the tree rather than recomputed per render: the editor
	 * re-renders on every pointermove, and both the drag maths and the commit
	 * conversion look up nodes by id, which would otherwise be a tree walk each.
	 */
	/**
	 * The universe on screen, as something a frame resolves against.
	 *
	 * A dimension is a value, so the document alone does not say where anything
	 * is: hit testing, snapping and the outlines all have to read the design the
	 * eye is looking at, and every gesture writes back into the alternative it
	 * picked.
	 */
	const context = useMemo<ResolveContext>(
		() => ({ tokens: scene.tokens, picks: universe.pick }),
		[scene.tokens, universe.pick],
	);

	const placed = useMemo(() => {
		const list = placedNodes(scene.nodes, universe.solved, context);
		return { list, byId: new Map(list.map((p) => [p.node.id, p])) };
	}, [scene.nodes, universe.solved, context]);

	/**
	 * The geometric rules the selection is subject to, as marks.
	 *
	 * Read off the solved geometry rather than the preview: a rule says where
	 * a node *will* be allowed to sit, and the answer to that only exists once
	 * the drag has been committed and the solver has spoken.
	 */
	const notes = useMemo<Annotation[]>(
		() => annotate(scene, selection, universe.solved, context),
		[scene, selection, universe.solved, context],
	);

	/** Nodes an automatic layout owns, which the pointer must not move. */
	const managed = useMemo(() => managedNodes(scene.nodes), [scene.nodes]);

	/**
	 * Every line the design is ruled with, in canvas coordinates.
	 *
	 * Read out of the *answer set* — see `lines.ts` — so a document nobody has
	 * solved yet has none, and the line drawn here is the same number a rule that
	 * names it will hold something to.
	 */
	const lines = useMemo<RuledLine[]>(
		() => (showGuides ? ruledLines(scene, universe.solved, context) : []),
		[showGuides, scene, universe.solved, context],
	);
	const catchable = useMemo(() => snapLines(lines), [lines]);

	/**
	 * What the last drag could be made to say, and has not been asked to yet.
	 *
	 * **This is what the whole feature is for.** Dropping a card against column
	 * three lines it up once; saying so keeps it lined up when the count changes,
	 * when a token moves, when a responsive alternative is chosen. So the moment
	 * a gesture catches a line, the editor offers to write the rule — one button,
	 * on the line, gone as soon as anything else happens, because a drop that was
	 * only ever a drop must cost nothing to walk away from.
	 */
	const [offer, setOffer] = useState<{
		node: string;
		term: string;
		edge: Edge;
		at: Point;
	} | null>(null);
	// A different selection is a different subject, and an offer about the node
	// you just stopped looking at is noise.
	useEffect(() => setOffer(null), [selection]);

	/**
	 * How far a set of nodes may be dragged along one axis, as a delta window.
	 *
	 * Three things narrow it, and the order matters. A node a layout places is
	 * pinned by the document itself — knowable without asking anyone, which is
	 * what lets the drag be limited from its very first frame. A coordinate the
	 * solver decides is limited by whatever the probe found. Everything else is
	 * a number in the document, and a number is free.
	 */
	function windowFor(ids: Iterable<string>, axis: "x" | "y") {
		let out: { lo: number | null; hi: number | null } = { lo: null, hi: null };
		for (const id of ids) {
			if (managed.has(id)) return { lo: 0, hi: 0 };
			const at = universe.solved[id]?.[axis];
			if (at === undefined) continue;
			out = narrow(out, travelFrom(freedom[id]?.[axis], at));
		}
		return out;
	}

	/**
	 * Pointer position in the document's own coordinates.
	 *
	 * The one place in the editor where a screen pixel becomes an EMU — see the
	 * file header. Everything downstream of this call, in this file and in
	 * `design-core`, is the document's unit.
	 */
	function toDocument(event: { clientX: number; clientY: number }): Point {
		const rect = surface.current?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return documentPoint(event, rect, getScale(), origin);
	}

	const selected = [...selection]
		.map((id) => placed.byId.get(id))
		.filter((p): p is Placed => p !== undefined);

	/**
	 * The path whose vertices are on show.
	 *
	 * One selected path and the select tool: any other selection is about
	 * whole nodes, and putting anchor dots on top of it would invite dragging
	 * the wrong thing.
	 */
	const editing =
		tool === "select" && selected.length === 1 && selected[0].node.points
			? selected[0]
			: null;

	function beginMove(point: Point, ids: ReadonlySet<string>) {
		const start = new Map<string, Frame>();
		for (const id of ids) {
			const world = placed.byId.get(id)?.world;
			if (world) start.set(id, { ...world });
		}
		if (start.size === 0) return;
		setGesture({ kind: "move", origin: point, start });
	}

	/**
	 * A canvas point in a node's own coordinates.
	 *
	 * Recomputed from the scene on every move rather than captured at gesture
	 * start: editing a vertex moves the frame under it, so an origin taken
	 * once would drift by exactly the amount the shape grew.
	 */
	function intoPath(prev: Scene, id: string, at: Point): Point | null {
		const node = findInTree(prev.nodes, id);
		if (!node) return null;
		const now = sceneContext(prev, universe.pick);
		const parent = worldOrigin(prev.nodes, id, now);
		return {
			x: at.x - parent.x - frameDim(node, "x", now),
			y: at.y - parent.y - frameDim(node, "y", now),
		};
	}

	function targetFor(nodeId: string): string {
		const stopped = outOfView(nodeId);
		return selectionTargetOf(scene.nodes, stopped)?.id ?? stopped;
	}

	/**
	 * The derived node a click should go to, if any.
	 *
	 * Two hit tests that cannot see each other's nodes, settled by paint order:
	 * whichever is drawn on top is the thing you clicked. A document node over a
	 * derived one still wins, which is what keeps every existing gesture
	 * untouched.
	 */
	function derivedUnder(point: Point, documentHit: string | null): string | null {
		if (derived.length === 0) return null;
		const found = derivedAt(derived, point);
		if (!found) return null;
		// One exception to paint order, and it is the one case where the derived
		// node *belongs* to the document node under it: a component instance's
		// copy is drawn inside the instance, so letting it win would make the only
		// draggable half of an instance unclickable. See `isPartOf`.
		if (documentHit !== null && isPartOf(found.node.id, documentHit)) return null;
		if (
			documentHit !== null &&
			!paintedOver(universe.model, found.node.id, documentHit)
		) {
			return null;
		}
		return found.node.id;
	}

	/**
	 * The pen's clicks. Each one extends the run; landing back on the first
	 * point closes it, which is the only way to get a filled path.
	 */
	function placePoint(point: Point) {
		const points = pen ?? [];
		const first = points[0];
		if (
			points.length > 2 &&
			Math.hypot(point.x - first.x, point.y - first.y) <
				documentSpan(CLOSE_RADIUS, getScale())
		) {
			finishPath(points, true);
			return;
		}
		setPen([...points, point]);
		setCurrent(point);
	}

	/**
	 * Commits what the pen has, and hands the canvas back to the select tool
	 * the way every other drawing gesture does.
	 */
	function finishPath(points: readonly PathPoint[], closed: boolean) {
		setPen(null);
		setCurrent(null);
		onToolChange("select");
		// One point is a click, not a path.
		if (points.length < 2) return;

		const node = makePath(points, closed);
		const bounds = pathBounds(points, closed);
		// Like any other new node: it lands inside whichever surface it was
		// drawn over, judged by where its middle fell. Read through the ref
		// because a keypress can end a path several renders after the last one
		// this closure saw.
		const now = live.current;
		const host =
			confineTo ??
			(bounds
				? (frameAt(
						now.scene.nodes,
						{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
						now.universe.solved,
						now.context,
					)?.node.id ?? null)
				: null);
		onSceneChange((prev) => addNodeTo(prev, host, node, universe.pick));
		onSelectionChange([node.id]);
	}

	/* ---------------------------------------------------------------- */
	/* Preview: the same surface, running the document instead of editing it */
	/* ---------------------------------------------------------------- */

	/**
	 * Which instance the pointer is over, and which one it went down on.
	 *
	 * Refs rather than state because neither is drawn: they exist so that a
	 * `pointerleave` can be sent to the instance the pointer has *just left*,
	 * which is a fact about the previous event and not about the current render.
	 * Re-rendering the whole canvas on every pixel of a hover — while a
	 * transition is mid-flight — is also exactly the thing that would make the
	 * preview stutter, and the stutter would be blamed on the design.
	 */
	const hovering = useRef<string | null>(null);
	const pressed = useRef<string | null>(null);

	/**
	 * Leaving preview forgets where the pointer was.
	 *
	 * Without this the next preview would open holding a `pointerenter` it never
	 * sent, and the first move would fire a `pointerleave` at an instance the
	 * pointer is nowhere near — an edge taken for a reason no one could see.
	 */
	useEffect(() => {
		if (previewing) return;
		hovering.current = null;
		pressed.current = null;
	}, [previewing]);

	/**
	 * The topmost instance under a canvas point, or null.
	 *
	 * Deliberately *not* `hitTestTree`: that answers "what did the pointer hit",
	 * and what a running machine needs to know is "which instance is the pointer
	 * in", which is a different question wherever something is drawn over one. A
	 * label lying across a button is the ordinary case — a designer annotating a
	 * component — and a hover that stopped working because of it would read as
	 * the machine being broken rather than as the annotation being in the way.
	 *
	 * Paint order still settles overlapping *instances*, backwards through the
	 * placement list, which is the same arbiter `derivedAt` and `hitTestTree`
	 * use: what is drawn last is what the pointer gets.
	 *
	 * An instance that no machine drives is answered like any other, and the step
	 * above turns it into nothing — one lookup deciding what is driven, rather
	 * than two that can disagree about it.
	 */
	function instanceUnder(point: Point): string | null {
		const placed = placedNodes(scene.nodes, universe.solved, context);
		for (let i = placed.length - 1; i >= 0; i--) {
			const at = placed[i];
			if (at.node.kind !== "instance") continue;
			if (frameContains(at.world, point)) return at.node.id;
		}
		return null;
	}

	/**
	 * The pointer crossing from one instance to another, as the two events a
	 * machine is written against.
	 *
	 * A crossing is a leave *and* an enter, in that order, because that is what a
	 * browser does and what a machine's author will have assumed: the rest→hover
	 * pair on the button being left has to run before the one on the button being
	 * entered, or two buttons are hovered at once for a frame.
	 */
	function onPreviewMove(event: React.PointerEvent) {
		const now = instanceUnder(toDocument(event));
		if (now === hovering.current) return;
		if (hovering.current !== null) onTrigger?.(hovering.current, "pointerleave");
		hovering.current = now;
		if (now !== null) onTrigger?.(now, "pointerenter");
	}

	/**
	 * A press on an instance is the machine's; a press on empty canvas is still
	 * the canvas's, so the camera keeps working while the document is running.
	 * That is the one thing preview does not take away, and it is the difference
	 * between watching a design and being trapped in it.
	 */
	function onPreviewDown(event: React.PointerEvent) {
		if (event.button !== 0) return;
		const id = instanceUnder(toDocument(event));
		pressed.current = id;
		if (id === null) return;
		event.stopPropagation();
		onTrigger?.(id, "pointerdown");
	}

	/**
	 * Release, and then a click if the release landed where the press did.
	 *
	 * Synthesised rather than taken from the DOM's own `click`, because the DOM
	 * would fire it at whatever element is under the pointer and the editor's
	 * overlay is what is under the pointer. Two events for one release is also
	 * what a browser does with a real button, and a machine written against
	 * `click` and one written against `pointerup` must both work — which they do
	 * only if both are sent, in this order.
	 *
	 * `focus` and `blur` are not sent from here at all. The canvas has no focus
	 * to give: an instance is a div in an artboard rather than a control, nothing
	 * is tabbable, and firing a focus trigger off a click would make the studio
	 * disagree with the exported file about the one thing the two are supposed to
	 * agree on. A focus state is authored and exported and read in the panel; it
	 * is played from the state strip rather than pointed at.
	 */
	function onPreviewUp(event: React.PointerEvent) {
		const was = pressed.current;
		pressed.current = null;
		if (was === null) return;
		onTrigger?.(was, "pointerup");
		if (instanceUnder(toDocument(event)) === was) onTrigger?.(was, "click");
	}

	/** The pointer leaving the surface leaves whatever it was over. */
	function onPreviewLeave() {
		if (hovering.current !== null) onTrigger?.(hovering.current, "pointerleave");
		hovering.current = null;
		pressed.current = null;
	}

	function onPointerDown(event: React.PointerEvent) {
		if (event.button !== 0) return;
		// The canvas pans on empty space; anything the editor claims must not
		// also start a pan.
		event.stopPropagation();
		// Whatever happens next, the last drop's offer has been declined by doing
		// something else — which is how declining it should feel.
		setOffer(null);
		const point = toDocument(event);

		if (tool !== "select") {
			if (KINDS[tool].plotted) {
				placePoint(point);
				// Holding and dragging off the point curves it, the way a pen
				// works everywhere else. Released without moving, it stays a
				// corner and nothing is written.
				setGesture({ kind: "penPull", origin: point });
			}
			else {
				setGesture({ kind: "draw", nodeKind: tool, origin: point });
				setCurrent(point);
			}
			return;
		}

		const hit = hitTestTree(scene.nodes, point, universe.solved, context);
		// A derived node is drawn but is not in the document, so the document's
		// own hit testing cannot see it and the click would land on whatever it
		// is drawn over. Paint order settles that, and the gesture then stops
		// there, because there is nothing in the document to move. Same rule a
		// fully constrained node already follows: selectable, immovable.
		const under = derivedUnder(point, hit?.node.id ?? null);
		if (under) {
			onSelectionChange([under]);
			return;
		}
		if (!hit) {
			if (!event.shiftKey) onSelectionChange([]);
			setGesture({ kind: "marquee", origin: point });
			setCurrent(point);
			return;
		}

		const targetId = targetFor(hit.node.id);

		if (event.shiftKey) {
			const next = new Set(selection);
			if (next.has(targetId)) next.delete(targetId);
			else next.add(targetId);
			onSelectionChange([...next]);
			beginMove(point, next);
			return;
		}

		const ids = selection.has(targetId) ? selection : new Set([targetId]);
		if (!selection.has(targetId)) onSelectionChange([targetId]);
		beginMove(point, ids);
	}

	/**
	 * Double-click reaches through a group or into a frame, to the leaf — and
	 * *into* a viewport, which is the one case where reaching through changes
	 * which pointer owns the pixels.
	 *
	 * The same gesture for both because it is the same request: "the thing I want
	 * is inside this one". For a group that is one more level of selection; for a
	 * view it is a mode, because what is inside a view is not reachable by the 2D
	 * pointer at all and the way to point at it is to let the scene's own
	 * raycaster answer. Entering also turns orbiting on, since a camera you cannot
	 * move is a scene you can only look at from wherever it was left.
	 */
	function onDoubleClick(event: React.MouseEvent) {
		if (tool !== "select") return;
		const hit = hitTestTree(scene.nodes, toDocument(event), universe.solved, context);
		if (!hit) return;
		event.stopPropagation();
		// The outermost view the editor is not already inside, which is what
		// `outOfView` answers and which is exactly the node the last click
		// selected — so a double-click is "select it, then step into it".
		const stopped = outOfView(hit.node.id);
		if (findInTree(scene.nodes, stopped)?.kind === "viewport") {
			setEntered(stopped);
			onSelectionChange([stopped]);
			return;
		}
		onSelectionChange([hit.node.id]);
	}

	/**
	 * A click inside an entered view, with the node the raycaster landed on.
	 *
	 * **The whole of routing 3D picking into the studio's selection**, and it is
	 * three lines because a mesh is an ordinary node: the id that comes back is
	 * the id the layer list uses, the inspector inspects and a rule can name —
	 * `inst(I,label)` for an instance's part, a plain node id otherwise — so there
	 * is nothing to translate. The converse direction needed no code at all: the
	 * layer list already selects any node, and `ViewportCanvas` takes the same
	 * `selection` set and outlines whatever of it is in the scene.
	 *
	 * Shift extends, exactly as it does on the 2D canvas, so multi-selecting a
	 * mesh and a rectangle together is one gesture with one meaning. Null is the
	 * ray hitting nothing, which clears — the same answer clicking empty canvas
	 * gives, and the reason `ViewportCanvas` reports it rather than swallowing it.
	 */
	function onPickInScene(id: string | null, event: PointerEvent) {
		if (id === null) {
			if (!event.shiftKey) onSelectionChange([]);
			return;
		}
		if (!event.shiftKey) {
			onSelectionChange([id]);
			return;
		}
		const next = new Set(selection);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		onSelectionChange([...next]);
	}

	function onContext(event: React.MouseEvent) {
		if (!onContextMenu) return;
		event.preventDefault();
		event.stopPropagation();
		const point = toDocument(event);
		const hit = hitTestTree(scene.nodes, point, universe.solved, context);
		const targetId = hit ? targetFor(hit.node.id) : null;
		// A derived node is not something the menu's edits can act on, but
		// clearing the selection out from under one because the document cannot
		// see it would be a lie about what is selected.
		if (derivedUnder(point, hit?.node.id ?? null)) {
			onContextMenu({ x: event.clientX, y: event.clientY });
			return;
		}
		// Right-clicking outside the selection retargets it, the way every
		// editor does; right-clicking inside keeps the multi-selection.
		if (targetId && !selection.has(targetId)) onSelectionChange([targetId]);
		if (!targetId && selection.size > 0) onSelectionChange([]);
		onContextMenu({ x: event.clientX, y: event.clientY });
	}

	function onHandleDown(event: React.PointerEvent, handle: Handle) {
		event.stopPropagation();
		if (selected.length !== 1) return;
		const id = selected[0].node.id;
		if (managed.has(id) || universe.solved[id] !== undefined) return;
		setGesture({
			kind: "resize",
			handle,
			origin: toDocument(event),
			start: { ...selected[0].world },
			id: selected[0].node.id,
		});
	}

	// Enter and Escape end an open path. Taken in the capture phase and
	// stopped there, because the studio's own Escape would otherwise clear the
	// selection this is about to make.
	useEffect(() => {
		if (!pen) return;
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Enter" && event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			finishPath(pen, false);
		};
		window.addEventListener("keydown", key, true);
		return () => window.removeEventListener("keydown", key, true);
	}, [pen]);

	/**
	 * Everything the gesture handlers read but must not re-subscribe for.
	 *
	 * Only `up` needs these, and only once, so keeping them in a ref is what
	 * lets the effect below depend on the gesture alone.
	 */
	const live = useRef({
		scene,
		selection,
		placed,
		preview,
		universe,
		context,
		managed,
		catchable,
		toDocument,
		targetFor,
		windowFor,
	});
	live.current = {
		scene,
		selection,
		placed,
		preview,
		universe,
		context,
		managed,
		catchable,
		toDocument,
		targetFor,
		windowFor,
	};

	// A gesture owns the window until release, so the pointer can leave the
	// document mid-drag without stranding it.
	useEffect(() => {
		if (gesture.kind === "none") return;

		/**
		 * Snapping candidates are fixed for the whole gesture — the document
		 * cannot change mid-drag — so they are built once here rather than
		 * rebuilt from `placed` on every pointermove.
		 */
		const moving = new Set<string>(
			gesture.kind === "move"
				? gesture.start.keys()
				: gesture.kind === "resize"
					? [gesture.id]
					: [],
		);
		const list = live.current.placed.list;
		const targets = list
			.filter((p) => isDrawable(p.node) && !moving.has(p.node.id))
			.map((p) => p.world);
		const first = [...moving][0];
		const container = first
			? live.current.placed.byId.get(
					frameAncestorOf(live.current.scene.nodes, first)?.id ?? "",
				)?.world
			: undefined;
		/** Where each dragged node started out, to tell a reparent from a move. */
		const parents = parentMap(live.current.scene.nodes);
		const homeOf = (id: string) => parents.get(id)?.id ?? null;
		/** The container the pointer is over, and where in it a drop would land. */
		const dropAt = (point: Point) =>
			dropTargetAt(
				live.current.scene.nodes,
				point,
				moving,
				live.current.universe.solved,
				// Which way a layout runs is a value, so where a drop lands is a
				// question about the universe on screen.
				{
					tokens: live.current.scene.tokens,
					picks: live.current.universe.pick,
				},
			);
		/**
		 * What the constraints leave this gesture, per axis. Fixed for the whole
		 * drag for the same reason the snapping targets are: the document cannot
		 * change under a pointer that is already down.
		 */
		const room = {
			x: live.current.windowFor(moving, "x"),
			y: live.current.windowFor(moving, "y"),
		};
		/**
		 * The lines this gesture may catch on, fixed for its whole life like the
		 * frames are — and for a stronger reason than they have: a drag that
		 * caught a column line moves the card, the card moves nothing else, so
		 * re-reading the lines mid-drag could only ever hand back the same
		 * numbers. Except while a *guide* is being dragged, where they would
		 * genuinely change, which is why a guide never snaps to anything.
		 */
		const catchable = live.current.catchable;

		let moved = false;
		/** What the last move caught, so the release can offer to say it. */
		let caught: SnapGuide[] = [];

		const move = (event: PointerEvent) => {
			const point = live.current.toDocument(event);

			if (gesture.kind === "move") {
				// Where letting go would put them, worked out before the offset
				// is: a drag that carries the nodes out of their container is not
				// held to the constraints of the container it is leaving.
				const drop = dropAt(point);
				const rehoming = [...moving].some((id) => homeOf(id) !== drop.id);

				let dx = point.x - gesture.origin.x;
				let dy = point.y - gesture.origin.y;
				// Snap the selection as a block, using its bounds. Folded into the
				// offset rather than applied after it, so the limit below has the
				// last word — a snap may not pull a node somewhere it cannot go.
				const bounds = boundsOf([...gesture.start.values()]);
				let snapped: SnapGuide[] = [];
				if (bounds && !event.altKey) {
					const from = { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
					const result = snapFrame(from, {
						targets,
						container,
						lines: catchable,
					});
					dx += result.frame.x - from.x;
					dy += result.frame.y - from.y;
					snapped = result.guides;
				}
				if (!rehoming) {
					dx = clampTo(dx, room.x);
					dy = clampTo(dy, room.y);
				}

				const next = new Map<string, Frame>();
				for (const [id, frame] of gesture.start) {
					next.set(
						id,
						normaliseFrame({ ...frame, x: frame.x + dx, y: frame.y + dy }),
					);
				}
				setPreview(next);
				setGuides(snapped);
				caught = snapped;
				// Only worth showing when letting go would actually move the
				// nodes somewhere else in the tree.
				setDropTarget(rehoming ? drop.id : null);
				// The *allowed* movement, so a drag that went nowhere because
				// nowhere was left does not write an edit.
				if (Math.abs(dx) > MOVED || Math.abs(dy) > MOVED) moved = true;
				return;
			}

			if (gesture.kind === "penPull") {
				const pull = { x: point.x - gesture.origin.x, y: point.y - gesture.origin.y };
				if (Math.hypot(pull.x, pull.y) < PEN_PULL) return;
				setPen((run) => {
					if (!run?.length) return run;
					const last = run.length - 1;
					return run.map((p, i) =>
						i === last
							? { ...p, out: pull, in: { x: -pull.x, y: -pull.y } }
							: p,
					);
				});
				setCurrent(point);
				return;
			}

			if (gesture.kind === "guide") {
				// A guide is stored in its surface's own coordinates, the same space
				// a child's frame is in, so the surface's world origin is the whole
				// conversion. Written on every move rather than on release, under one
				// coalesce key, so the design reflows under the line as it is dragged
				// — which is the only way to see what moving it does.
				const on = live.current.placed.byId.get(gesture.surface);
				if (!on) return;
				const local =
					gesture.axis === "x" ? point.x - on.world.x : point.y - on.world.y;
				onSceneChange(
					(prev) =>
						moveGuide(
							prev,
							gesture.surface,
							gesture.guide,
							local,
							universe.pick,
						),
					`guide-${gesture.surface}-${gesture.guide}`,
				);
				return;
			}

			if (gesture.kind === "anchor") {
				const { id, index } = gesture;
				onSceneChange((prev) => {
					const local = intoPath(prev, id, point);
					return local
						? movePathPoint(prev, id, index, local, universe.pick)
						: prev;
				}, `path-${id}`);
				return;
			}

			if (gesture.kind === "handle") {
				const { id, index, side, mirror } = gesture;
				onSceneChange((prev) => {
					const node = findInTree(prev.nodes, id);
					const anchor = node?.points?.[index];
					const local = intoPath(prev, id, point);
					if (!anchor || !local) return prev;
					// A handle is an offset from its anchor, not a position.
					const offset = { x: local.x - anchor.x, y: local.y - anchor.y };
					return setPathHandle(
						prev,
						id,
						index,
						side,
						offset,
						mirror,
						universe.pick,
					);
				}, `path-${id}`);
				return;
			}

			if (gesture.kind === "resize") {
				const dx = point.x - gesture.origin.x;
				const dy = point.y - gesture.origin.y;
				let frame = resizeFrame(gesture.start, gesture.handle, dx, dy);
				let snapped: SnapGuide[] = [];
				if (!event.altKey) {
					const result = snapFrame(
						frame,
						{ targets, container, lines: catchable },
						handleEdges(gesture.handle),
					);
					frame = result.frame;
					snapped = result.guides;
				}
				setPreview(new Map([[gesture.id, normaliseFrame(frame)]]));
				setGuides(snapped);
				caught = snapped;
				return;
			}

			setCurrent(point);
		};

		const up = (event: PointerEvent) => {
			const now = live.current;
			const point = now.toDocument(event);
			const preview = now.preview;

			/** Absolute frames back into each node's own parent space. */
			const toLocal = (frames: ReadonlyMap<string, Frame>) => {
				const out = new Map<string, Frame>();
				for (const [id, world] of frames) {
					const at = originOf(
						now.placed.byId.get(id),
						now.universe.solved[id],
						now.context,
					);
					out.set(id, { ...world, x: world.x - at.x, y: world.y - at.y });
				}
				return out;
			};

			/**
			 * What this gesture could be asked to say, if it caught a line.
			 *
			 * One node only. The snapping works on the selection's *bounds*, so
			 * with several nodes moving there is no single edge that landed on the
			 * line — three cards whose left edges differ all read as one box
			 * touching column three, and the rule would move two of them.
			 */
			const offered = (id: string | undefined) => {
				if (!id) return;
				const line = caught.find((g) => g.id !== undefined && g.place !== undefined);
				if (!line?.id || !line.place) return;
				const edge = edgeOn(line.axis, line.place);
				if (pinnedTo(now.scene, id, line.id, edge)) return;
				const box = now.preview?.get(id) ?? now.placed.byId.get(id)?.world;
				if (!box) return;
				setOffer({
					node: id,
					term: line.id,
					edge,
					// On the line, beside the thing that landed on it.
					at:
						line.axis === "x"
							? { x: line.at, y: box.y + box.height / 2 }
							: { x: box.x + box.width / 2, y: line.at },
				});
			};

			if (gesture.kind === "resize" && preview) {
				const next = preview.get(gesture.id);
				const frame = next
					? toLocal(new Map([[gesture.id, next]])).get(gesture.id)
					: undefined;
				if (frame) {
					setSettling(new Map([[gesture.id, frame]]));
					onSceneChange(
						(prev) => resizeSubtree(prev, gesture.id, frame, now.universe.pick),
						"geometry",
					);
					offered(gesture.id);
				}
			} else if (gesture.kind === "move" && preview && moved) {
				const local = toLocal(preview);
				setSettling(local);
				const drop = dropAt(point);
				const rehomed = [...local.keys()].filter((id) => homeOf(id) !== drop.id);
				// A reparent snapshots where a node visibly is, so it has to see
				// where the drag left it rather than where it started — otherwise
				// something dragged out of a layout lands back at the layout.
				const dropped = { ...now.universe.solved, ...Object.fromEntries(local) };

				onSceneChange((prev) => {
					// A node the solver places has no frame of its own worth
					// writing: its stored one is what it *asks* for, and
					// overwriting that with what it was given loses the request.
					const staying = new Map(
						[...local].filter(
							([id]) => !rehomed.includes(id) && !now.managed.has(id),
						),
					);
					let next =
						staying.size > 0
							? setFrames(prev, staying, now.universe.pick)
							: prev;
					let index = drop.index;
					for (const id of rehomed) {
						next = reparent(
							next,
							id,
							drop.id,
							index++,
							dropped,
							now.universe.pick,
						);
					}
					return next;
				}, "geometry");
				// A node that stayed where it is in the tree and landed on a line.
				// Not one that was just reparented: it has a new home to settle into
				// and a rule pinning it to a line of the old one would fight that.
				if (moving.size === 1 && rehomed.length === 0) offered([...moving][0]);
			} else if (gesture.kind === "marquee") {
				const box = frameFromPoints(gesture.origin, point);
				// Marquee selects whole groups, not the leaves inside them.
				const hits = [
					...new Set(
						now.placed.list
							.filter((p) => isDrawable(p.node) && framesIntersect(p.world, box))
							.map((p) => now.targetFor(p.node.id)),
					),
				];
				onSelectionChange(
					event.shiftKey ? [...new Set([...now.selection, ...hits])] : hits,
				);
			} else if (gesture.kind === "draw") {
				let frame = frameFromPoints(gesture.origin, point);
				// A click with no drag places a default-sized node.
				if (frame.width < CLICK_SIZE || frame.height < CLICK_SIZE) {
					frame = {
						x: gesture.origin.x,
						y: gesture.origin.y,
						...KINDS[gesture.nodeKind].defaultSize,
					};
				}
				if (!event.altKey) {
					// A new node lands on the grid as readily as an old one moves onto
					// it: drawing a card inside column three is the commonest way of
					// putting one there.
					frame = snapFrame(frame, { targets, lines: catchable }).frame;
				}

				// A surface is drawn on the canvas; anything else lands inside
				// whichever surface it was drawn over.
				const host =
					confineTo ??
					(KINDS[gesture.nodeKind].surface
						? null
						: (frameAt(
								now.scene.nodes,
								{ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
								now.universe.solved,
								now.context,
							)?.node.id ?? null));

				/**
				 * A 3D view is drawn like any other rectangle and arrives with a
				 * camera and a light in it, which is why it does not go through
				 * `makeNode`.
				 *
				 * `addViewport` is the verb, and routing the gesture through it is
				 * the difference between a working view and a black box: a viewport
				 * with no camera and no light draws nothing at all, and every
				 * question a person then asks — "is it broken?", "did it not take?"
				 * — is a question about the tool rather than about the design. The
				 * frame is in canvas coordinates and the two nodes it brings are in
				 * the view's own space, which is exactly the split that verb owns.
				 *
				 * The id comes back by diffing the trees rather than by being
				 * returned, because `addViewport` returns a `Scene` like every other
				 * edit in that file and changing its signature for one caller's
				 * convenience would be the wrong end to fix this from.
				 */
				if (gesture.nodeKind === "viewport") {
					// Applied to the scene in hand and handed over whole, rather than
					// as an updater, because the id of the node that was just made is
					// only knowable by looking at the result — and an updater that
					// reported its answer through a side effect would be an updater
					// React is free to run twice. `live.current` is this render's
					// document, which is exactly what the updater would have been
					// given: the gesture that ends here began on it.
					const before = new Set(flatten(now.scene.nodes).map((n) => n.id));
					const next = addViewport(now.scene, host, frame, now.universe.pick);
					const made = flatten(next.nodes).find(
						(n) => n.kind === "viewport" && !before.has(n.id),
					);
					onSceneChange(() => next);
					if (made) onSelectionChange([made.id]);
					onToolChange("select");
					setGesture({ kind: "none" });
					setPreview(null);
					setCurrent(null);
					return;
				}

				// A drag up-right or down-left runs along the other diagonal of
				// the same box: the frame alone cannot say which, so the
				// direction of the gesture is what settles it.
				const node = makeNode(gesture.nodeKind, frame, {
					diagonal:
						(point.x - gesture.origin.x) * (point.y - gesture.origin.y) < 0
							? "up"
							: "down",
				});
				onSceneChange((prev) => addNodeTo(prev, host, node, now.universe.pick));
				onSelectionChange([node.id]);
				onToolChange("select");
			}

			setGesture({ kind: "none" });
			setPreview(null);
			setCurrent(null);
			setGuides([]);
			setDropTarget(null);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
		};
	}, [gesture]);

	const marquee =
		current && (gesture.kind === "marquee" || gesture.kind === "draw")
			? frameFromPoints(gesture.origin, current)
			: null;

	const shownBounds = boundsOf(
		selected.map((p) => preview?.get(p.node.id) ?? p.world),
	);

	const dropHighlight = dropTarget
		? placed.byId.get(dropTarget)?.world
		: undefined;

	/** Where the entered view sits, in the design, for the chip that marks it. */
	const enteredBox = entered ? placed.byId.get(entered)?.world : undefined;

	/**
	 * Which lines the live gesture is caught on, so they can say so.
	 *
	 * Memoised on the snap guides rather than rebuilt per render, because it is
	 * one of `Guides`' props and a fresh `Set` every render would re-render the
	 * whole grid on every pointermove — which is the cost that component is
	 * memoised to avoid.
	 */
	const heldBy = useMemo(
		() =>
			new Set(
				guides.map((g) => g.id).filter((id): id is string => id !== undefined),
			),
		[guides],
	);

	/**
	 * The selection's remaining travel, drawn where it would travel.
	 *
	 * Only for coordinates the solver decides. An ordinary frame is a number in
	 * the document and free by construction, and saying so would put a cross
	 * through every rectangle on the canvas; a pinned axis gets no mark either,
	 * because its absence is the whole statement. So the marks appear exactly
	 * where a rule has been written and has left something over.
	 */
	const travelMarks = selected.flatMap((p) => {
		const travel = freedom[p.node.id];
		if (!travel) return [];
		const frame = preview?.get(p.node.id) ?? p.world;
		const centre = {
			x: frame.x + frame.width / 2,
			y: frame.y + frame.height / 2,
		};
		return (["x", "y"] as const).flatMap((axis) => {
			const at = universe.solved[p.node.id]?.[axis];
			if (at === undefined) return [];
			const { lo, hi } = travelFrom(travel[axis], at);
			if (lo === 0 && hi === 0) return [];
			return [
				{
					id: p.node.id,
					axis,
					across: axis === "x" ? centre.y : centre.x,
					from: centre[axis] + (lo ?? -OPEN),
					to: centre[axis] + (hi ?? OPEN),
					open: [lo === null, hi === null] as const,
				},
			];
		});
	});

	/**
	 * What the canvas draws instead of the answer set, in each node's own
	 * space: the live gesture while there is one, and otherwise whatever the
	 * last gesture committed that the solver has not answered for yet.
	 */
	const renderPreview = useMemo(() => {
		if (!preview) return settling ?? undefined;
		const out = new Map<string, Frame>();
		for (const [id, world] of preview) {
			const at = originOf(placed.byId.get(id), universe.solved[id], context);
			out.set(id, { ...world, x: world.x - at.x, y: world.y - at.y });
		}
		return out;
	}, [preview, settling, placed, universe.solved, context]);

	/** Top-level surfaces get a name tag, the way an artboard is labelled. */
	const topFrames = scene.nodes.filter(isSurface);

	return (
		<div
			ref={surface}
			className={styles.surface}
			data-role="editor"
			data-tool={tool}
			// The stylesheet reads this and takes the whole editing overlay off
			// the screen — outlines, handles, guides, vertices, annotations. One
			// attribute rather than a condition around each of them, because
			// "while the document is running there is nothing to edit" is one
			// statement and deserves to be written once.
			data-previewing={previewing ? "" : undefined}
			onPointerDown={previewing ? onPreviewDown : onPointerDown}
			// Only while the pen is mid-path: every other tool tracks the
			// pointer from the window, and only once a button is down. Preview is
			// the exception — a hover is a trigger, so it has to be watched
			// whether or not anything is held down.
			onPointerMove={
				previewing
					? onPreviewMove
					: pen
						? (e) => setCurrent(toDocument(e))
						: undefined
			}
			onPointerUp={previewing ? onPreviewUp : undefined}
			onPointerLeave={previewing ? onPreviewLeave : undefined}
			onDoubleClick={previewing ? undefined : onDoubleClick}
			onContextMenu={previewing ? undefined : onContext}
		>
			{/* The whole overlay is drawn in canvas pixels inside here, which is
			    why this offset crosses: `origin` is a point in the design. */}
			<div
				className={styles.content}
				style={
					{
						left: -canvasPx(origin.x),
						top: -canvasPx(origin.y),
						// Custom properties rather than a prop on the artboard, so that
						// the component that knows *what* moves declares the transition
						// and the component that knows *how fast* sets the numbers.
						// They inherit, so this one declaration paces every node under
						// it; unset — which is every canvas nobody is previewing — the
						// artboard's own fallback is zero milliseconds and nothing
						// animates at all. The cast is React's type for `style` not
						// admitting custom properties, which is a gap in the typings
						// rather than a claim about CSS.
						...(motion
							? {
									"--dc-play-duration": `${motion.duration}ms`,
									"--dc-play-delay": `${motion.delay}ms`,
									"--dc-play-easing": motion.easing,
								}
							: {}),
					} as React.CSSProperties
				}
			>
			<Artboard
				scene={scene}
				universe={universe}
				preview={renderPreview}
				varying={varying}
				playing={playing}
				scrub={scrub}
				live={liveViews}
				selection={selection}
				orbit={orbiting}
				// Only an entered view answers the pointer. Without this the canvas
				// would take every event over its rectangle and the marquee, the
				// drag and the context menu would stop working over a scene —
				// `ViewportCanvas` defaults to `pointerEvents: none` for exactly
				// this reason and turns them on when it is given a handler.
				onPickNode={entered === null ? undefined : onPickInScene}
				gizmo={entered === null ? undefined : gizmo}
				onSpatialEdit={entered === null ? undefined : onSpatialEdit}
				onPoster={onPoster}
			/>

			{topFrames.map((node) => {
				const at = canvasPoint(
					preview?.get(node.id) ??
						placed.byId.get(node.id)?.world ??
						frameOf(node, context),
				);
				return (
					<button
						key={`label-${node.id}`}
						type="button"
						className={styles.frameLabel}
						data-frame-label={node.id}
						data-selected={selection.has(node.id) ? "" : undefined}
						style={{ left: at.x, top: at.y }}
						onPointerDown={(e) => {
							e.stopPropagation();
							onSelectionChange([node.id]);
							beginMove(toDocument(e), new Set([node.id]));
						}}
					>
						{node.name}
					</button>
				);
			})}

			{/* Which view the pointer is inside, and the way out. Drawn on the
			    view's own top-left corner, and only while the answer set still
			    places the node — a viewport a rule has hidden has no box to hang
			    it on and the effect above has already stepped out. */}
			{enteredBox ? (
				<div
					className={styles.enteredBar}
					style={{ left: canvasPx(enteredBox.x), top: canvasPx(enteredBox.y) }}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<button
						type="button"
						className={styles.entered}
						data-role="entered-view"
						data-view={entered}
						title="Leave this 3D view and go back to editing the page"
						onClick={() => setEntered(null)}
					>
						Inside this view — Esc to leave
					</button>
					{/* Which handles the one selected object wears. Beside the way out
					    rather than in the toolbar, because it is true of this view and
					    only while somebody is in it — a mode switch in the main bar
					    would be a control that does nothing almost all the time.

					    Two buttons and no third: the gizmo translates and turns, and a
					    scale mode would need an answer `geometry.ts` has not got. */}
					{(["move", "turn"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							className={styles.entered}
							data-role="gizmo-mode"
							data-mode={mode}
							aria-pressed={gizmo === mode}
							title={
								mode === "move"
									? "Drag an axis to move the selected object in the scene"
									: "Drag a ring to turn the selected object about one axis"
							}
							onClick={() => setGizmo(mode)}
						>
							{mode === "move" ? "Move" : "Turn"}
						</button>
					))}
				</div>
			) : null}

			{dropHighlight ? (
				<div
					className={styles.dropTarget}
					data-drop-target={dropTarget}
					style={rectStyle(dropHighlight)}
				/>
			) : null}

			{/* The margins, the grid and the hand-drawn lines — the same component
			    every other copy on the canvas draws them with, handed the gestures
			    that only the editable one has. A line only answers the pointer
			    under the select tool, for the reason a path's vertices only appear
			    under it: with the rectangle tool in hand, a press on a guide means
			    "start a rectangle here", and a guide that swallowed it would be a
			    hole in the canvas. */}
			<Guides
				scene={scene}
				lines={lines}
				held={heldBy}
				editable={tool === "select"}
				onGrab={(line, guide) =>
					setGesture({
						kind: "guide",
						surface: line.surface,
						guide,
						axis: line.axis,
					})
				}
				onLock={(line, guide) =>
					onSceneChange((prev) =>
						setGuideLocked(prev, line.surface, guide, !line.locked),
					)
				}
				onRemove={(line, guide) =>
					onSceneChange((prev) => removeGuide(prev, line.surface, guide))
				}
			/>


			{/* A selected path's vertices. Drag one to move it, drag its dot to
			    bend the curve, double-click to switch between corner and
			    smooth, alt-click to remove it. */}
			{editing?.node.points?.map((pt, index) => {
				const id = editing.node.id;
				const ox = editing.world.x;
				const oy = editing.world.y;
				// The vertex and its handles are in the document's units, like the
				// frame they hang off; the dots that show them are DOM.
				const at = canvasPoint({ x: ox + pt.x, y: oy + pt.y });
				const sides = (["in", "out"] as const).filter((s) => pt[s]);
				return (
					<div key={`pt-${id}-${index}`}>
						{sides.map((side) => {
							const h = canvasPoint(pt[side] as Point);
							const to = { x: at.x + h.x, y: at.y + h.y };
							return (
								<div key={side}>
									<svg className={styles.handleLine} aria-hidden="true">
										<line x1={at.x} y1={at.y} x2={to.x} y2={to.y} />
									</svg>
									<div
										className={styles.control}
										data-control={`${index}-${side}`}
										style={{ left: to.x, top: to.y }}
										onPointerDown={(e) => {
											e.stopPropagation();
											setGesture({
												kind: "handle",
												id,
												index,
												side,
												// Alt breaks the symmetry, so one side can be
												// moved without dragging the other with it.
												mirror: !e.altKey,
											});
										}}
									/>
								</div>
							);
						})}
						<div
							className={cx(styles.anchor, pt.in || pt.out ? styles.smooth : null)}
							data-anchor={index}
							title="Drag to move · double-click for a curve · alt-click to remove"
							style={{ left: at.x, top: at.y }}
							onDoubleClick={(e) => {
								e.stopPropagation();
								onSceneChange((prev) => togglePathSmooth(prev, id, index));
							}}
							onPointerDown={(e) => {
								e.stopPropagation();
								if (e.altKey) {
									onSceneChange((prev) =>
										removePathPoint(prev, id, index, universe.pick),
									);
									return;
								}
								setGesture({ kind: "anchor", id, index });
							}}
						/>
					</div>
				);
			})}

			<Annotations notes={notes} />

			{/* What the selection may still be dragged along. End ticks where
			    something stops it; an open end where nothing does.

			    `data-role=travel`, not `freedom`: that role is the status line's
			    readout of the same thing, and this sat earlier in document order,
			    so a bare querySelector('[data-role=freedom]') found this
			    decorative svg and read its empty textContent. A regression script
			    asserted blank for however long that had been true. */}
			{travelMarks.length > 0 ? (
				<svg className={styles.travel} data-role="travel" aria-hidden="true">
					{travelMarks.map((mark) => {
						const horizontal = mark.axis === "x";
						// A mark says how far the design may still move, so it is
						// measured in the design and drawn on the canvas; only the
						// end tick below is a pixel count either way.
						const a = canvasPoint(
							horizontal
								? { x: mark.from, y: mark.across }
								: { x: mark.across, y: mark.from },
						);
						const b = canvasPoint(
							horizontal
								? { x: mark.to, y: mark.across }
								: { x: mark.across, y: mark.to },
						);
						return (
							<g
								key={`${mark.id}-${mark.axis}`}
								className={styles.travelMark}
								data-freedom={`${mark.id}-${mark.axis}`}
							>
								<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
								{[a, b].map((end, i) =>
									mark.open[i] ? null : (
										<line
											key={`${end.x},${end.y}`}
											className={styles.travelEnd}
											x1={horizontal ? end.x : end.x - TICK}
											y1={horizontal ? end.y - TICK : end.y}
											x2={horizontal ? end.x : end.x + TICK}
											y2={horizontal ? end.y + TICK : end.y}
										/>
									),
								)}
							</g>
						);
					})}
				</svg>
			) : null}

			{guides.map((guide, i) => {
				// `snapFrame` answers in the design's units, because that is where
				// the edges it matched live.
				const at = canvasPx(guide.at);
				const from = canvasPx(guide.from);
				const span = canvasPx(guide.to - guide.from);
				return (
					<div
						key={i}
						className={styles.guide}
						data-guide={guide.axis}
						style={
							guide.axis === "x"
								? { left: at, top: from, height: span }
								: { top: at, left: from, width: span }
						}
					/>
				);
			})}

			{/* An outline says "this is selected". A *placed* outline says the
			    rules have answered the question the outline is about — there is
			    nowhere left to drag this — and retreats into grey to say so, the
			    way a property row with nothing left to choose does. */}
			{selected.map((p) => {
				const placed = isPlaced(freedom[p.node.id]) || managed.has(p.node.id);
				return (
					<div
						key={p.node.id}
						className={cx(
							styles.outline,
							wrapsChildren(p.node) && styles.groupOutline,
							placed && styles.determined,
						)}
						data-outline={p.node.id}
						data-determined={placed ? "" : undefined}
						style={rectStyle(preview?.get(p.node.id) ?? p.world)}
					/>
				);
			})}

			{/* A selected derived node gets an outline too, dashed: the same
			    statement the grey outline makes about a fully constrained node,
			    made about a node with nothing in the document behind it. */}
			{derived
				.filter((d) => selection.has(d.node.id))
				.map((d) => (
					<div
						key={`derived-${d.node.id}`}
						className={cx(styles.outline, styles.derivedOutline)}
						data-derived-outline={d.node.id}
						style={rectStyle(d.world)}
					/>
				))}

			{shownBounds && tool === "select" && gesture.kind !== "marquee" ? (
				<div className={styles.handles} style={rectStyle(shownBounds)}>
					{selected.length === 1 &&
					!managed.has(selected[0].node.id) &&
					universe.solved[selected[0].node.id] === undefined
						? HANDLES.map((handle) => (
								<div
									key={handle}
									data-handle={handle}
									className={`${styles.handle} ${styles[handle]}`}
									style={{ cursor: HANDLE_CURSOR[handle] }}
									onPointerDown={(e) => onHandleDown(e, handle)}
								/>
							))
						: null}
				</div>
			) : null}

			{pen ? (
				<svg className={styles.pen} aria-hidden="true">
					{/* The run so far is already in the document's units — these are
					    the vertices `makePath` will store — so the rubber band
					    crosses on its way to the attribute. */}
					<polyline
						className={styles.penLine}
						points={[...pen, ...(current ? [current] : [])]
							.map(canvasPoint)
							.map((p) => `${p.x},${p.y}`)
							.join(" ")}
					/>
					{pen.map((p, i) => {
						const at = canvasPoint(p);
						return (
							<circle
								key={`${p.x},${p.y},${i}`}
								className={styles.penPoint}
								cx={at.x}
								cy={at.y}
								// The first point is the target that closes the path, so it
								// is the one worth aiming at.
								r={i === 0 ? 4 : 2.5}
							/>
						);
					})}
				</svg>
			) : null}

			{marquee ? (
				<div
					className={gesture.kind === "draw" ? styles.drawing : styles.marquee}
					style={rectStyle(marquee)}
				/>
			) : null}

			{/* The offer. A drop against a column is a coincidence until somebody
			    says otherwise, and this is the somebody-says-otherwise: one click
			    and it is an `align` with a name, a switch, a sentence in the why
			    panel and a place in an unsat core. Declining costs nothing — the
			    next thing the pointer does takes it away. */}
			{offer ? (
				<button
					type="button"
					className={styles.pinOffer}
					data-role="pin-offer"
					data-datum={offer.term}
					data-edge={offer.edge}
					title={`Align on ${EDGES[offer.edge].label} — a rule with a name, and a switch to turn it off again`}
					style={{
						left: canvasPx(offer.at.x),
						top: canvasPx(offer.at.y),
					}}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => {
						onSceneChange((prev) =>
							pinToDatum(prev, offer.node, offer.term, offer.edge).scene,
						);
						setOffer(null);
					}}
				>
					Pin to {datumLabel(scene, offer.term) ?? offer.term}
				</button>
			) : null}
			</div>
		</div>
	);
}

/**
 * Where a node's parent sits, recovered from the placement.
 *
 * A placement is the parent's origin plus the frame the node was placed with —
 * and for a node the solver owns that is the *solved* frame, not the stored
 * one. Subtracting the stored frame instead would leave the difference between
 * the two folded into the origin, which is exactly how far a node dragged out
 * of a layout would land from where it was dropped.
 */
function originOf(
	placed: Placed | undefined,
	solved: Partial<Frame> | undefined,
	context: ResolveContext,
): Point {
	if (!placed) return { x: 0, y: 0 };
	return {
		x: placed.world.x - (solved?.x ?? frameDim(placed.node, "x", context)),
		y: placed.world.y - (solved?.y ?? frameDim(placed.node, "y", context)),
	};
}

/**
 * A frame in the design, as the four numbers that draw a box over it.
 *
 * Every outline, highlight, marquee and handle box in the file goes through
 * here, which is what makes it one of the two places the editor leaves the
 * document's units — the frames it is handed come from `placedNodes`,
 * `boundsOf` and `frameFromPoints`, all of which answer in EMU.
 */
function rectStyle(frame: Frame) {
	const box = canvasRect(frame);
	return {
		left: box.x,
		top: box.y,
		width: box.width,
		height: box.height,
	};
}
