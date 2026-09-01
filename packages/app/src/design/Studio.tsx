import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type RawHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import { putNamedAsset } from "../projects/store";
import {
	CONSTRAINT_KINDS,
	DEFAULT_EASING,
	DEFAULT_UNIT,
	DUPLICATE_OFFSET,
	EASINGS,
	EMU_PER_PX,
	LAYOUT_PROPS,
	MOTION_PROPS,
	type LayoutProp,
	DRAW_KINDS,
	type Edge,
	KINDS,
	type Point,
	type NodeKind,
	type PropName,
	SHAPE_KINDS,
	type Frame,
	type Relaxation,
	type ReorderTo,
	type RuledLine,
	ruledLines,
	type Scene,
	type Universe,
	addConstraint,
	addInstance,
	addImage,
	addImport,
	addPivot,
	defineComponent,
	deleteNodes,
	distributeNodes,
	duplicateNodes,
	groupNodes,
	moveNodes,
	collapseToPicks,
	derivedNodes,
	describeCosts,
	describeExplanation,
	documentBounds,
	datumLabel,
	partLabel,
	FRAME_DIMS,
	GUIDE_PROPS,
	type GuideProp,
	guideAtIn,
	type Dimension,
	findStyle,
	variantLabel,
	drawGuideAt,
	flatten,
	layerOf,
	machineForNode,
	machineLayers,
	machineTable,
	motionLabel,
	parentOf,
	parseStatePart,
	parseVariable,
	placedNodes,
	reachableAlternatives,
	frameAt,
	sceneContext,
	shownState,
	shownStates,
	keyframeCopyIds,
	stateCopyIds,
	stateLabel,
	stateVarLabel,
	takesMembers,
	variableCounts,
	reorderNodes,
	ungroupNodes,
	varyingVariables,
	updateConstraint,
	unreadVariables,
	varyingVars,
	msOf,
	type Machine,
	type ModelScene,
	type Transition,
	type Trigger,
	wrapInLayout,
	wrapsChildren,
} from "@clingo-design/design-core";
import {
	type CanvasApi,
	InfiniteCanvas,
	createCameraStore,
} from "@clingo-design/canvas";

import { AlignTools } from "./AlignTools";
import { Artboard } from "./Artboard";
import { Constraints } from "./Constraints";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { Editor, type Tool } from "./Editor";
import { Guides } from "./Guides";
import { Inspector } from "./Inspector";
import { LayerList } from "./LayerList";
import { Machines } from "./Machines";
import { ProgramPanel } from "./ProgramPanel";
import { PanelResizer, usePanelWidth } from "./PanelResizer";
import { Rulers } from "./Rulers";
import { ShapePicker } from "./ShapePicker";
import { StatusLine } from "./StatusLine";
import { ToolIcon } from "./ToolIcon";
import { Variables } from "./Variables";
import { ViewSwitcher } from "./ViewSwitcher";
import { cx } from "./cx";
import { layoutArtboards } from "./layout";
import { measureScene } from "./measureText";
import { useCulling } from "./useCulling";
import { useExploration } from "./useExploration";
import { firstLayerOf, layerHolding, useMachinePlayback } from "./useMachinePlayback";
import { canvasPx, canvasRect } from "./viewport";
import styles from "./Studio.module.css";
import tabStyles from "./tabs.module.css";

const LIMIT = 24;

/** Shared, so "no universe yet" is one object rather than a new one per render. */
const NO_PICKS: Readonly<Record<string, number>> = {};

/** Choices a multiverse caption names before it gives up and counts. */
const CAPTION_PARTS = 3;

/**
 * How far past the document the editable surface reaches, so new frames can be
 * drawn well beside the existing ones.
 *
 * Two thousand *pixels* of the design, spelled that way round because that is
 * the number worth reading. It is added to the document's own bounds, which are
 * EMU, and a bare 2000 there would be a fifth of a pixel of elbow room.
 */
const PAD = 2000 * EMU_PER_PX;

/** Hotkeys, by toolbar slot. The shapes share one, which also cycles them. */
const TOOL_KEY: Record<string, string> = {
	select: "V",
	frame: "F",
	shape: "R",
	path: "P",
	text: "T",
	// The 3D view has had a slot in this bar since `KINDS.viewport.tool` became
	// true, and until now it had no key and no glyph — which is a button nobody
	// can find and a shortcut that renders as an empty `<kbd>`. `3` rather than a
	// letter because every initial worth having is taken and because it is what
	// the thing is called.
	viewport: "3",
};

const VIEWS = [
	{
		id: "design",
		label: "Design",
		hint: "Edit, with what varies marked in place",
	},
	{
		id: "multiverse",
		label: "Multiverse",
		hint: "One artboard per legal design",
	},
] as const;

type View = (typeof VIEWS)[number]["id"];

const PANELS = [
	{ id: "properties", label: "Properties" },
	{ id: "variables", label: "Variables" },
	// "States" rather than "Machines", and the tab is where the difference is
	// worth insisting on: a state is a thing a designer draws, a machine is the
	// bookkeeping that connects them. The panel edits both; the tab is named for
	// the half somebody goes looking for.
	{ id: "machines", label: "States" },
	{ id: "constraints", label: "Rules" },
] as const;

type Panel = (typeof PANELS)[number]["id"];

/**
 * How far below the document the state strip hangs, in the document's units.
 *
 * A pixel count times `EMU_PER_PX`, like every other statement about a hand
 * rather than about a design — `PAD` above, `NUDGE` below, `DUPLICATE_OFFSET`
 * in design-core. Written bare it would be a five-thousandth of a pixel and the
 * strip would sit exactly on top of the design it is about.
 */
const STRIP_GAP = 56 * EMU_PER_PX;

/** The gutter between two states of the strip, same units and same argument. */
const STRIP_STEP = 24 * EMU_PER_PX;

/**
 * What a transition is paced at when nothing in this universe answers.
 *
 * Read out of `MOTION_PROPS` through `msOf`, which is the same table and the
 * same reader the compiler emits `mdefdur/1` from — so the canvas and the
 * program cannot hold two different opinions about what "no duration" means.
 * A table entry no unit spells reads as nothing here and emits no default
 * there, which is a table to fix rather than a number to invent, so the `?? 0`
 * is a type obligation rather than a second policy.
 */
const MOTION_FALLBACK = {
	duration: msOf(MOTION_PROPS.duration.fallback) ?? 0,
	delay: msOf(MOTION_PROPS.delay.fallback) ?? 0,
};

/**
 * The toolbar's slots, in the order the kinds are declared.
 *
 * Every drawable kind gets one, except that the shapes collapse into a single
 * slot with a menu — the bar floats over the canvas and cannot grow a button
 * per shape. The slot takes the place of the first shape, so adding a shape
 * changes what is in the menu and nothing else.
 */
const TOOLS: Array<{ id: Tool; label: string; key: string; shapes?: true }> = [
	{ id: "select", label: "Select", key: TOOL_KEY.select },
	...DRAW_KINDS.flatMap((kind) =>
		!KINDS[kind].shape
			? [{ id: kind as Tool, label: KINDS[kind].label, key: TOOL_KEY[kind] }]
			: kind === SHAPE_KINDS[0]
				? [{ id: kind as Tool, label: "Shape", key: TOOL_KEY.shape, shapes: true as const }]
				: [],
	),
];

/** Brackets move the selection through its siblings; Shift takes it all the way. */
const ORDER: Record<string, [near: ReorderTo, far: ReorderTo]> = {
	"[": ["backward", "back"],
	"]": ["forward", "front"],
};

/**
 * Arrows nudge by a pixel, Shift by eight — as EMU, like every other statement
 * about a hand rather than about a document (`MIN_NODE_SIZE`, `SNAP_THRESHOLD`,
 * `DUPLICATE_OFFSET`).
 *
 * The factor is not decoration. `moveNodes` adds these to a coordinate in EMU,
 * and a bare 1 would be a ten-thousandth of a pixel — under the whole-pixel
 * quantum `withFrame` writes on, so the sum would round straight back to the
 * value already stored and the guard there would skip the dimension entirely.
 * Not a nudge too small to see: no edit at all, and no error either.
 */
const NUDGE: Record<string, [x: number, y: number]> = {
	ArrowLeft: [-EMU_PER_PX, 0],
	ArrowRight: [EMU_PER_PX, 0],
	ArrowUp: [0, -EMU_PER_PX],
	ArrowDown: [0, EMU_PER_PX],
};

/**
 * The same shortcut under ⌘ and under Ctrl.
 *
 * `Mod` would resolve to one or the other by platform, but the studio has
 * always taken either, so both are registered.
 */
const accel = (key: string, callback: () => void, shift = false) =>
	[{ key, meta: true, shift }, { key, ctrl: true, shift }].map(
		(hotkey: RawHotkey) => ({ hotkey, callback }),
	);

export interface StudioProps {
	scene: Scene;
	onSceneChange: (next: Scene | ((prev: Scene) => Scene), coalesce?: string) => void;
	projectName: string;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
}

export function Studio({
	scene,
	onSceneChange,
	projectName,
	undo,
	redo,
	canUndo,
	canRedo,
}: StudioProps) {
	const [view, setView] = useState<View>("design");
	const [tool, setTool] = useState<Tool>("select");
	/** Which shape the toolbar's shape slot currently stands for. */
	const [shape, setShape] = useState<NodeKind>(SHAPE_KINDS[0]);
	const [seed, setSeed] = useState(1);
	const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
	// Deliberately not switched automatically by selection: the tab is the
	// user's choice, and yanking them out of the variables mid-edit is worse
	// than making them click back.
	const [panel, setPanel] = useState<Panel>("properties");
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	/**
	 * Alternatives the user is holding fixed while they look around.
	 *
	 * Deliberately *not* part of the document: a pin is a question ("show me
	 * the designs where this holds"), not an edit. It reaches the solver as an
	 * assumption, so it costs a solve rather than a re-grounding, leaves undo
	 * alone, and is undone by forgetting it.
	 */
	const [pins, setPins] = useState<Readonly<Record<string, number>>>({});
	/**
	 * Where the rulers measure from, in the document's own coordinates.
	 *
	 * Editor state, beside the pinned universe and for the same reason. The
	 * guides design draws the line at "is this a decision about the design, or
	 * about the person looking at it" — a guide's lock is a decision and lives in
	 * the document, whether guides are *shown* is not and does not. A zero point
	 * is plainly the second kind: moving it changes no geometry, reaches no
	 * solve, alters no export, and two people looking at the same document may
	 * hold it in two places without disagreeing about anything. Putting it in the
	 * document would mean opening a file and finding every number on both rulers
	 * measured from a corner somebody else chose.
	 *
	 * The document's own origin is where it starts, which is what makes the
	 * rulers read as the coordinates the inspector shows until somebody asks for
	 * something else.
	 */
	const [zero, setZero] = useState<Point>({ x: 0, y: 0 });
	/**
	 * Whether the margins, the grid and the guides are on show.
	 *
	 * The other half of the same line the zero point sits on, and the design says
	 * exactly where it falls: a guide's *lock* is a decision about that guide, is
	 * worth persisting and should reach a collaborator; whether guides are
	 * *shown* is about the person looking, and a document that carried it would
	 * mean opening a file and not being able to see why your layout will not
	 * move. It reaches no solve and no export either — a design that changed when
	 * you hid the guides would be a bug, not a feature.
	 */
	const [showGuides, setShowGuides] = useState(true);
	/**
	 * Whether the canvas is running the document's machines instead of editing
	 * it.
	 *
	 * The third member of the family the zero point and the guides toggle belong
	 * to — editor state, never the document's, reaching no solve and no export —
	 * and the one with the sharpest reason for being explicit rather than
	 * inferred. A machine's triggers are `pointerenter`, `pointerdown` and
	 * `click`, which are the events a drag is made of; a canvas that fired them
	 * while somebody was moving a button would hover it on the way past and click
	 * it on release, and the design would appear to be moving on its own. So it
	 * is a mode, it is off, and while it is on there is nothing to edit.
	 *
	 * It is deliberately not a third entry in the view switcher — see the toolbar
	 * below, and the note on {@link ViewSwitcher}.
	 */
	const [previewing, setPreviewing] = useState(false);
	/**
	 * Which layer of a machine the States panel's strips are showing.
	 *
	 * Editor state, held here rather than inside the panel because it outlives a
	 * re-render of the panel and because the same answer will be wanted by the
	 * canvas strip the day that one grows a layer selector. Undefined is "the
	 * first", which is what a one-layer machine — every machine in every document
	 * today — always means.
	 */
	const [machineLayer, setMachineLayer] = useState<string | undefined>(undefined);
	/**
	 * Which state each instance is being played in, and the four ways to change
	 * it.
	 *
	 * **Playback costs no solve.** Every state of every instance is already in
	 * the one answer set — the invariant the whole feature turns on — so drawing
	 * a different one is the canvas reading a different key out of
	 * `ModelScene.states`. Nothing recompiles, nothing re-grounds, nothing lands
	 * in undo. The act that *does* all three is `SceneNode.state`, which is a
	 * different verb with a different button, and the panels say so in words.
	 */
	const playback = useMachinePlayback(scene);
	/**
	 * The flattened machines, memoised, because four things below ask it
	 * questions and it is a walk of the whole document.
	 *
	 * The same table the playback hook builds and the export ships, so the
	 * studio's projections and the studio's steps cannot disagree about which
	 * layer a state is in.
	 */
	const table = useMemo(() => machineTable(scene), [scene]);
	/**
	 * The played states as a flat record — instance to state — for the panels that
	 * have not learned about layers.
	 *
	 * `Machines`, `StateStrip`, `Transitions` and `Inspector` all take
	 * `Record<instance, state>` and `onPlay(instance, state | null)`, and all four
	 * belong to steps this one may not edit (`docs/merged-plan.md` M20 and M23).
	 * So the projection happens here, at the four call sites, rather than the hook
	 * carrying a second shape for their benefit — and it is the *first* layer,
	 * which is what `SceneNode.state` means, what `MachineTable.instances[].initial`
	 * carries and what the export writes as plain `data-state`.
	 *
	 * When those steps land they take `playback.playing` directly and these two
	 * bindings go.
	 */
	const playingFlat = useMemo(
		() => firstLayerOf(table, playback.playing),
		[table, playback.playing],
	);
	const playFlat = useCallback(
		(instance: string, state: string | null) => {
			if (state === null) {
				// Handing back "the state" from a flat panel hands back the layer that
				// flat answer came from, which is the first. A panel that can only see
				// one layer must not be able to silently stop the other two.
				const first = table.machines[table.instances[instance]?.machine ?? ""]
					?.layers?.[0];
				if (first) playback.play(instance, first.id, null);
				return;
			}
			const layer = layerHolding(table, instance, state);
			if (layer !== undefined) playback.play(instance, layer, state);
		},
		[table, playback],
	);
	/**
	 * How the transition that fired most recently is paced, for the canvas.
	 *
	 * Held rather than derived because it is a fact about an *event*: which edge
	 * was taken is not recoverable from where the machine ended up — two edges
	 * may arrive at the same state and be paced quite differently — so it is
	 * recorded when the edge is followed and read on the render that follows.
	 *
	 * The stagger is deliberately not here. `mstagger` delays each *changed part*
	 * by its position in `order/2` sequence, which the exporter works out because
	 * it is writing one rule per node and knows which nodes it wrote; the canvas
	 * paces every node with one inherited declaration, and giving each its own
	 * delay would mean a second account of which parts a state changes, living
	 * here rather than in the answer set. So a staggered transition plays on the
	 * canvas as an unstaggered one of the same duration, and the exported file is
	 * where the rhythm is. Named rather than silently dropped, because the two
	 * *do* differ and a designer comparing them deserves to know which is which.
	 */
	const [motion, setMotion] = useState<
		{ duration: number; delay: number; easing: string } | undefined
	>(undefined);
	const [leftWidth, setLeftWidth] = usePanelWidth("clingo-design.panel.left", 190);
	const [rightWidth, setRightWidth] = usePanelWidth("clingo-design.panel.right", 260);
	// Text sizes itself, and only something with a canvas can say how big it
	// is. Measuring here rather than in the compiler is what keeps design-core
	// runnable outside a browser.
	const measurements = useMemo(() => measureScene(scene), [scene]);
	// Sorted so the same selection reached two different ways is the same
	// question, and the probe is not repeated for it.
	const probeIds = useMemo(() => [...selection].sort(), [selection]);
	const {
		exploration,
		generated,
		error,
		conflict,
		pinConflict,
		relaxations,
		exhaustive,
		solving,
		freedom,
		probing,
		why,
		onWhy,
	} = useExploration(scene, LIMIT, seed, pins, measurements, probeIds);
	const blamed = useMemo(() => new Set(conflict), [conflict]);
	const badPins = useMemo(() => new Set(pinConflict), [pinConflict]);
	/**
	 * Which alternatives are still reachable, per variable.
	 *
	 * Filtered rather than taken raw: projection collapses the universes that
	 * differ only in a variable nothing consults, so brave consequences report
	 * one alternative for an unreferenced token and every row downstream would
	 * grey the others and blame a rule. `reachableAlternatives` drops those
	 * entries, which is what lets six rows and two panels read an absent entry as
	 * "no answer about this" rather than each having to know why.
	 */
	const unread = useMemo(() => unreadVariables(scene), [scene]);
	const reach = useMemo(
		() => reachableAlternatives(scene, exploration?.brave.pick),
		[scene, exploration],
	);

	const pin = useCallback((variable: string, index: number | null) => {
		setPins((prev) => {
			if (index === null) {
				if (!(variable in prev)) return prev;
				const { [variable]: _dropped, ...rest } = prev;
				return rest;
			}
			return prev[variable] === index ? prev : { ...prev, [variable]: index };
		});
	}, []);

	const clearPins = useCallback(() => setPins({}), []);
	const pinCount = Object.keys(pins).length;

	// A pin on a variable that no longer exists — or on an alternative that has
	// since been deleted — would make every solve unsatisfiable for a reason the
	// user cannot see.
	//
	// The document is no longer the only thing that names variables: a rule can
	// mint one, and the only place its existence is recorded is the last answer.
	// So a pin survives if the document offers it *or* the solver last said it
	// was there — and while there is no answer at all, nothing is dropped, since
	// an unsatisfiable set of pins is exactly the state the user has to be able
	// to see in order to clear it.
	useEffect(() => {
		const counts = variableCounts(scene);
		const answered = exploration?.brave.pick;
		if (!answered) return;
		setPins((prev) => {
			const next = Object.fromEntries(
				Object.entries(prev).filter(
					([v, i]) => i < (counts[v] ?? 0) || v in answered,
				),
			);
			return Object.keys(next).length === Object.keys(prev).length ? prev : next;
		});
	}, [scene, exploration]);
	const canvas = useRef<CanvasApi | null>(null);
	const host = useRef<HTMLElement | null>(null);

	// 100% and fixed: the camera belongs to the user, so nothing the document
	// does may move it. The offset is margin, not clearance — the toolbar is at
	// the bottom now and no longer sits over the document's top-left corner.
	const camera = useMemo(
		() => createCameraStore({ x: -32, y: -32, scale: 1 }),
		[],
	);

	/**
	 * Which assignments hold more than one value.
	 *
	 * Read from the document rather than from the answer sets: projection
	 * collapses universes that render alike, so an assignment can legitimately
	 * be multi-valued while the solver only ever shows one outcome for it. The
	 * panel should still say so — a row that offers two colours and gets one is
	 * something you wrote, and hiding that would be hiding the document.
	 */
	const varying = useMemo(() => new Set(varyingVariables(scene)), [scene]);

	/**
	 * Which assignments the *solver* left a choice about.
	 *
	 * The other reading of the same question, and the right one for a mark drawn
	 * on the canvas: what is dashed there is a claim about the design in front of
	 * you, and "you typed two values here" is not that claim. On a settled
	 * document — a sudoku with one answer — the document's reading marks all 51
	 * open cells and the solver's marks none, which is correct, because there is
	 * exactly one picture and nothing in it could be otherwise.
	 *
	 * It follows the pins too: hold a value and what depended on it stops being
	 * marked, which is the same statement one step narrower. Until the first
	 * answer is in, the document's coarser reading stands in rather than the
	 * marks blinking out.
	 */
	const unsettled = useMemo(
		() => (exploration ? new Set(varyingVars(exploration)) : varying),
		[exploration, varying],
	);

	const universes = exploration?.universes ?? [];
	const primary = universes[0];
	/**
	 * Soft rules the design on screen breaks.
	 *
	 * The other half of a conflict, and the newly reachable one: a preference
	 * costs points instead of forbidding, so a document full of them is
	 * satisfiable and merely disappointing. That state has to look different from
	 * an impossible one — nothing here needs fixing, and offering a way out of it
	 * would be offering to solve a problem the user does not have.
	 *
	 * Read off the universe actually drawn rather than the whole space, because
	 * that is the claim worth making: *this* design gave this up.
	 */
	const broken = useMemo(
		() => primary?.violated ?? new Set<string>(),
		[primary],
	);
	/**
	 * The universe on screen, as something a frame can be resolved against.
	 *
	 * Geometry is a value now, so "where is this node" has no answer without a
	 * universe: every edit that moves something writes to the alternative *this*
	 * one picked, which is what keeps a node with two positions holding both.
	 */
	// Memoised on the universe, not spelled inline: `{}` is a fresh object every
	// render, and everything downstream of the resolve context — the document's
	// bounds, the artboard boxes, the culling — is memoised on its identity. An
	// unstable one here is an infinite render loop, not merely wasted work.
	const picks = useMemo(() => primary?.pick ?? NO_PICKS, [primary]);
	const context = useMemo(() => sceneContext(scene, picks), [scene, picks]);
	/**
	 * Variables a rule minted, and sets a rule named.
	 *
	 * The document has no account of either, so the inspector's property rows and
	 * the Rules panel's member lists read them out of the universe on screen.
	 */
	const minted = primary?.model.variables ?? {};
	/**
	 * The last answer that existed, so the panels keep their footing when the
	 * document momentarily has none.
	 *
	 * A set a rule named only exists in an answer set, and an unsatisfiable
	 * document has no answer set at all — which is exactly the moment the Rules
	 * panel has to be readable, because it is where the core is reported. Naming
	 * nine members as zero while the user reads why they cannot hold would be the
	 * panel going blank at the only interesting moment.
	 */
	const [remembered, setRemembered] = useState<ModelScene | undefined>(undefined);
	useEffect(() => {
		if (primary) setRemembered(primary.model);
	}, [primary]);
	const answer = primary?.model ?? remembered;

	/**
	 * True when the canvas is showing the ways *out* of a conflict rather than
	 * the designs the document admits.
	 *
	 * A contradiction used to leave an empty canvas and a sentence in a panel.
	 * The complement of a core is a set of designs, so it can be drawn — and
	 * "switch this off and you get this" is the only form of the answer a
	 * designer can act on. So the grid stays full and changes what it means,
	 * which is also why it ignores the view toggle: there is nothing to edit
	 * until one of these is taken.
	 */
	const showingWays = universes.length === 0 && relaxations.length > 0;
	// Design shows one concrete universe to edit; multiverse shows the space;
	// an impossible document shows its ways out.
	const shown = showingWays
		? relaxations.map((r) => r.universe)
		: view === "multiverse"
			? universes
			: primary
				? [primary]
				: [];
	// Copies of the document are laid out by how much space it occupies.
	const bounds = useMemo(() => documentBounds(scene, context), [scene, context]);
	const region = useMemo(
		() => ({
			x: bounds.x - PAD,
			y: bounds.y - PAD,
			width: bounds.width + PAD * 2,
			height: bounds.height + PAD * 2,
		}),
		[bounds],
	);
	const layout = useMemo(
		() => layoutArtboards(shown.length, bounds),
		[shown.length, bounds],
	);
	/**
	 * Where each copy sits on the canvas. The one being edited gets the whole
	 * padded surface, so that drawing a frame beside the document still has
	 * somewhere to land.
	 *
	 * This is where the design's plane becomes the canvas's, and it is the only
	 * place in this file that crosses: `region` and `layout` are EMU, because
	 * they are arithmetic over the document's own geometry, while a `left` in a
	 * style and a rectangle handed to the culler are CSS pixels, because that is
	 * what a browser lays out and what the camera is scaled in. The consequence
	 * worth knowing is that document coordinate `d` lands at canvas coordinate
	 * `canvasPx(d)` exactly — the editable surface's own content offset cancels
	 * its box's position — which is what lets the rulers below read the canvas
	 * as if it were the document.
	 */
	const boxes = useMemo<Frame[]>(
		() =>
			Array.from({ length: shown.length }, (_, i) =>
				canvasRect(
					view === "design" && i === 0 && !showingWays
						? region
						: {
								x: layout.placements[i]?.x ?? 0,
								y: layout.placements[i]?.y ?? 0,
								width: bounds.width,
								height: bounds.height,
							},
				),
			),
		[shown.length, view, showingWays, region, layout, bounds],
	);
	// Two dozen artboards is two dozen full copies of the document; the ones
	// nowhere near the viewport get no DOM at all.
	const onscreen = useCulling(camera, host, boxes);

	/**
	 * The lines a copy is ruled with, per universe.
	 *
	 * Per universe rather than once for the document, because a grid is a value
	 * like everything else: a column count holding twelve and six is two grids,
	 * and seeing the two side by side is most of the reason the multiverse view
	 * exists. Reading them off a single universe would draw one design's grid over
	 * another design's nodes.
	 *
	 * Cached against the universe object rather than memoised on `shown`, which is
	 * a fresh array every render — a universe is solved once and then looked at
	 * many times, so this walks the document once per copy per solve. The editable
	 * copy is not in here: the editor reads its own, because it needs them for
	 * snapping as well as for drawing.
	 */
	const ruledFor = useMemo(() => {
		const cache = new WeakMap<Universe, readonly RuledLine[]>();
		return (universe: Universe): readonly RuledLine[] => {
			let found = cache.get(universe);
			if (!found) {
				found = ruledLines(
					scene,
					universe.solved,
					sceneContext(scene, universe.pick),
				);
				cache.set(universe, found);
			}
			return found;
		};
	}, [scene]);

	const selectionIds = useCallback((ids: string[]) => setSelection(new Set(ids)), []);

	/**
	 * Every node by id. Several things below need to look nodes up — selection
	 * pruning, the group menu, the multiverse captions — and doing that with a
	 * tree search each would be quadratic on every render.
	 */
	const byId = useMemo(
		() => new Map(flatten(scene.nodes).map((n) => [n.id, n] as const)),
		[scene.nodes],
	);

	/**
	 * Nodes the answer set has that the document does not.
	 *
	 * A rule may derive `node/1`, so the picture can hold things no layer
	 * accounts for. These are what the layers panel lists as derived, what the
	 * inspector explains, and what the canvas lets you select but not move.
	 *
	 * Derived means "on the canvas and not in the document", which is exactly
	 * what it says even in the ~200ms after a delete, while the canvas is still
	 * drawing the last answer set: the node really is still on screen and really
	 * is no longer in the document. It stops being listed the moment the solver
	 * answers for the edit.
	 */
	const derived = useMemo(
		() =>
			primary
				? derivedNodes(primary.model, new Set(byId.keys())).filter(
						/**
						 * **A state copy is never a layer.**
						 *
						 * Of the two ways out — leave them out, or nest them under their
						 * state — this is the first, and the argument is that the second
						 * is answering a question nobody asked. A layer list is the
						 * document's structure: what is in the design, in paint order,
						 * selectable and draggable. A state copy is none of those. It is
						 * not in the document, it is not painted (only the *shown* one is,
						 * through the `inst(I,N)` alias), it cannot be dragged, and there
						 * are `states × parts` of them per instance — so nesting a
						 * four-state button's copies under headings would quadruple the
						 * list to say four times over what one row already says. Where the
						 * other states *are* readable is the Machines panel and the strip
						 * on the canvas, both of which show them as pictures rather than
						 * as rows, which is what somebody comparing two states is actually
						 * looking at.
						 *
						 * Almost always this filter removes nothing, because a state copy
						 * is deliberately not a `node/1` and so never reaches `byId`,
						 * `roots` or `derivedNodes` at all. Almost. `node/1` is a
						 * derivable predicate — that is the whole reason `derivedNodes`
						 * exists — so a hand-written rule may perfectly well assert
						 * `node(stt(i1,hover,label))`, and then a four-state machine on a
						 * twelve-part definition floods this panel with 48 rows that
						 * cannot be selected into anything. The structural guarantee is
						 * about what the *compiler* emits; this is about what a document
						 * may say. Both are needed, and this is the cheap one.
						 */
						(d) => parseStatePart(d.node.id) === null,
					)
				: [],
		[primary, byId],
	);
	/**
	 * The rule for a multiverse whose members differ in *structure*.
	 *
	 * `visible/1` is projected, so a node one design has and another does not
	 * makes two universes rather than one. The panels then need a stance, and
	 * this is it: what is *listed* is the universe on screen, and what the
	 * selection is held against is the union over every universe — so stepping
	 * between designs, or a re-solve that drops a node from the one in front,
	 * does not silently throw the selection away. A derived node the design on
	 * screen lacks stays selected and says so; only one no universe has at all
	 * is dropped. `everywhere` is the intersection, which is what marks a node
	 * as coming and going.
	 */
	const known = exploration?.brave.visible;
	const everywhere = exploration?.cautious.visible;

	// Selection must never point at a node that has been deleted. Nested nodes
	// count, so this walks the whole tree rather than the roots. Held until an
	// exploration is in hand: while the first solve is out nothing is known
	// about the derived half, and dropping a selection on every keystroke is
	// worse than holding a stale one for a beat.
	useEffect(() => {
		if (!known) return;
		setSelection((prev) => {
			const next = [...prev].filter((id) => byId.has(id) || known.has(id));
			return next.length === prev.size ? prev : new Set(next);
		});
	}, [byId, known]);

	const fit = useCallback(() => {
		// `fit` frames a rectangle in the *canvas's* coordinates — it divides by
		// the viewport's pixel size to work out a scale — so the grid's bounds
		// cross on the way in like everything else that reaches the camera.
		if (layout.bounds.width > 0) canvas.current?.fit(canvasRect(layout.bounds), 0.06);
	}, [layout]);

	/**
	 * Hold a whole universe still, without writing it into the document.
	 *
	 * Clicking a design used to collapse the document onto it, which threw the
	 * other designs away on what is really just a click to look closer. Pinning
	 * shows the same thing and is undone by clearing.
	 *
	 * What is held is every choice that is still open, which is the solver's list
	 * and not the document's. Filtering by the document's used to make this a dead
	 * click on any multiverse whose members differ only by something a rule chose
	 * — there was nothing to pin, so the click pinned nothing.
	 */
	function pinUniverse(universe: Universe) {
		setPins(
			Object.fromEntries(
				Object.entries(universe.pick).filter(([variable]) =>
					unsettled.has(variable),
				),
			),
		);
		setView("design");
	}

	/** Write the pinned alternatives into the document, discarding the rest. */
	function keepPinned() {
		onSceneChange((prev) => collapseToPicks(prev, pins));
		setPins({});
	}

	/**
	 * What a variable is called, for anywhere its key would otherwise show:
	 * `prop(card,fill)` reads better as `card fill`.
	 *
	 * One function rather than a lookup table, because the two readers want
	 * different sets of keys — the multiverse captions want the ones the solver
	 * left open, a relaxation wants whichever pins it proposes releasing — and a
	 * table built for one of them answers "undefined" for the other.
	 */
	const labelFor = useCallback(
		(key: string): string => {
			/**
			 * What to call the node a variable belongs to.
			 *
			 * A component instance's parts are derived, so the document has no name
			 * for `inst(primary,buttonLabel)` — but the definition does, and a
			 * caption reading an ASP term is a caption nobody reads.
			 *
			 * Four readings, tried in order, each for a term the document itself
			 * cannot name: a component part, a datum, and now a state copy. A
			 * variable a state's delta minted belongs to `stt(b1,hover,label)`, and
			 * "Label · Hover — Button 1 fill" is the sentence; the raw term in the
			 * middle of a caption is where a reader stops reading.
			 */
			const nameOf = (id: string) =>
				byId.get(id)?.name ??
				partLabel(scene, id) ??
				datumLabel(scene, id) ??
				stateLabel(scene, id) ??
				id;
			/**
			 * The two keys `parseVariable` deliberately refuses, asked first.
			 *
			 * `sprop`, `sfval` and `mval` join `spart` in the set that never parses
			 * back, and the reason is recorded there: every caller that reads a key
			 * back is asking about something the *inspector's generic rows* can act
			 * on, and three cases none of them could act on would be three cases all
			 * of them had to handle. But this caller is not asking what to *do* with
			 * a variable — it is asking what to call one — and there the answer
			 * exists and lives in `machines.ts`, beside the grammar that mints the
			 * key. So the two labellers are tried here rather than the parser being
			 * widened for one reader.
			 *
			 * Without them a caption over a hovered fill read `sprop(b1,hover,label,fill)`,
			 * which is a receipt rather than a sentence — and this is the one place
			 * the multiverse explains itself to somebody.
			 */
			const machineName = stateVarLabel(scene, key) ?? motionLabel(scene, key);
			if (machineName !== undefined) return machineName;

			const parsed = parseVariable(key);
			if (!parsed) return key;
			if (parsed.kind === "prop") {
				return `${nameOf(parsed.node)} ${parsed.prop}`;
			}
			if (parsed.kind === "constraint") {
				const c = scene.constraints.find((k) => k.id === parsed.constraint);
				return c ? `${CONSTRAINT_KINDS[c.kind].label} value` : key;
			}
			if (parsed.kind === "layout") {
				return `${nameOf(parsed.node)} ${LAYOUT_PROPS[parsed.field as LayoutProp].label}`;
			}
			if (parsed.kind === "guide") {
				// A hand-drawn guide's field is `at(g1)`, which is on no settings
				// table — so it is captioned by the surface it belongs to, which is
				// the only name it has.
				const line = guideAtIn(parsed.field);
				return line === undefined
					? `${nameOf(parsed.node)} ${GUIDE_PROPS[parsed.field as GuideProp].label}`
					: `${nameOf(parsed.node)} guide`;
			}
			if (parsed.kind === "frame") {
				return `${nameOf(parsed.node)} ${FRAME_DIMS[parsed.dim as Dimension].label}`;
			}
			if (parsed.kind === "style") {
				// The style's own name. Which *variant* is showing is what the
				// caption is about, and a variant has a name of its own — see
				// `variantLabel`, and the caption below reads it.
				return findStyle(scene.styles, parsed.style)?.name ?? parsed.style;
			}
			return scene.tokens.find((t) => t.id === parsed.token)?.name ?? parsed.token;
		},
		[byId, scene],
	);

	/**
	 * A rule, in the words the panel uses for it — and with what it ranges over,
	 * because two rules of the same kind are the *usual* conflict.
	 *
	 * "Switch off All different" beside "Switch off All different" is two
	 * identical offers with different consequences, which is worse than an ASP
	 * term. A rule with no members is its own name already, so it gets nothing
	 * added.
	 *
	 * A member is not always a node: a rule that holds a card to a column line
	 * names a *datum*, and `cg(page,3,left)` in the middle of a sentence about why
	 * the card is where it is undoes the sentence. `datumLabel` is the third
	 * reading, after the document's own name and a component part's, and it is why
	 * the why-panel can answer "Align on Card, Column 3 left — Page forces this".
	 */
	const ruleLabel = useCallback(
		(id: string): string => {
			const c = scene.constraints.find((k) => k.id === id);
			if (!c) return id;
			if (!takesMembers(c.kind)) return c.id;
			const over =
				c.group ??
				`${c.nodes
					.slice(0, 2)
					.map(
						(n) =>
							byId.get(n)?.name ??
							partLabel(scene, n) ??
							datumLabel(scene, n) ??
							// A rule that says "the label does not jump when you hover" is
							// an ordinary `align` over two state copies, so this is the
							// fourth reading and the last: it is what makes the why panel
							// able to answer "Align on Label · Rest — Button 1, Label ·
							// Hover — Button 1" instead of naming two ASP terms.
							stateLabel(scene, n) ??
							n,
					)
					.join(", ")}${c.nodes.length > 2 ? "…" : ""}`;
			const label = CONSTRAINT_KINDS[c.kind].label;
			return over ? `${label} on ${over}` : label;
		},
		[byId, scene],
	);

	/**
	 * Take a way out of a conflict: release its pins, switch off its rules.
	 *
	 * Both halves in one call and in that order, because the two are different
	 * kinds of act and the cheap one must not be lost behind the dear one. A pin
	 * release is not an edit at all — no undo entry, nothing written down — so a
	 * relaxation made only of pins costs the document nothing, which is why those
	 * are offered first.
	 */
	const applyRelaxation = useCallback(
		(relaxation: Relaxation) => {
			if (relaxation.pins.length > 0) {
				setPins((prev) => {
					const next = { ...prev };
					for (const variable of relaxation.pins) delete next[variable];
					return next;
				});
			}
			if (relaxation.rules.length > 0) {
				// One edit, not one per rule: taking a way out is a single decision
				// and a single ⌘Z has to undo the whole of it.
				onSceneChange((prev) =>
					relaxation.rules.reduce(
						(s, id) => updateConstraint(s, id, { enabled: false }),
						prev,
					),
				);
			}
		},
		[onSceneChange],
	);

	/**
	 * What a way out reads as: "Switch off Fill all different", "Release card
	 * fill".
	 *
	 * The rule's own words rather than its ASP term, and the variable's name
	 * rather than its key — a relaxation is a sentence somebody has to agree
	 * with, and neither `k_675e3ee2` nor `prop(card,fill)` is one.
	 */
	const describeRelaxation = useCallback(
		(relaxation: Relaxation): string => {
			const parts: string[] = [];
			if (relaxation.pins.length > 0) {
				parts.push(
					`Release ${relaxation.pins.map((v) => labelFor(v)).join(" and ")}`,
				);
			}
			if (relaxation.rules.length > 0) {
				parts.push(`Switch off ${relaxation.rules.map(ruleLabel).join(" and ")}`);
			}
			return parts.join(", ") || "Change nothing";
		},
		[labelFor, ruleLabel],
	);

	/**
	 * The why-probe, as one row of the panel sees it.
	 *
	 * One question is outstanding at a time, so this hands the answer to the row
	 * whose variable it was about and `undefined`-shaped nothing to every other
	 * — the row still gets its ask button, because the button is what makes the
	 * question possible in the first place.
	 *
	 * The sentence is built in design-core, which is where the honesty lives; all
	 * that happens here is supplying the document's own names for the rules and
	 * pins it mentions, since `k_distinct` and `prop(one,fill)` are not words
	 * anybody reads.
	 */
	const whyFor = useCallback(
		(variable: string) => ({
			ask: (index: number | null) =>
				onWhy(
					index === null
						? null
						: {
								// A value the design is not using is asked about the other
								// way round: "why can it not be this" rather than "what
								// made it this".
								kind: picks[variable] === index ? "value" : "alternative",
								variable,
								index,
							},
				),
			at: why?.question.variable === variable ? why.question.index : null,
			answer:
				why?.question.variable === variable && why.answer
					? describeExplanation(why.question, why.answer, {
							rule: ruleLabel,
							pin: labelFor,
						})
					: null,
			verdict:
				why?.question.variable === variable ? (why.answer?.verdict ?? null) : null,
			solves:
				why?.question.variable === variable ? (why.answer?.solves ?? null) : null,
		}),
		[why, onWhy, picks, ruleLabel, labelFor],
	);

	const hasSelection = selection.size > 0;

	// Tools, delete, nudge, duplicate, z-order, undo/redo.
	//
	// `ignoreInputs` is spelled out for the whole set because the library only
	// assumes it for unmodified keys: ⌘Z must not undo the document out from
	// under someone typing in the rules panel. The rows that need a selection
	// are disabled rather than guarded inside the callback, so that with
	// nothing selected the key keeps its default meaning.
	useHotkeys(
		[
			...TOOLS.map((t) => ({
				hotkey: { key: t.key },
				callback: () => (t.shapes ? cycleShape() : setTool(t.id)),
			})),
			...accel("Z", undo),
			...accel("Z", redo, true),
			...accel("G", group),
			...accel("G", ungroup, true),
			...accel("D", duplicate),
			// The universal hide-guides shortcut, and it hides them for the person
			// pressing it and nobody else.
			...accel(";", () => setShowGuides((on) => !on)),
			{ hotkey: { key: "A", shift: true }, callback: autoLayout },
			{
				hotkey: { key: "Escape" },
				callback: () => {
					setSelection(new Set());
					setTool("select");
				},
			},
			...["Delete", "Backspace"].map((key) => ({
				hotkey: { key },
				callback: remove,
				options: { enabled: hasSelection },
			})),
			...Object.entries(ORDER).flatMap(([key, [near, far]]) => [
				{
					hotkey: { key },
					callback: () => reorder(near),
					options: { enabled: hasSelection },
				},
				{
					hotkey: { key, shift: true },
					callback: () => reorder(far),
					options: { enabled: hasSelection },
				},
			]),
			...Object.entries(NUDGE).flatMap(([key, [x, y]]) => [
				{
					hotkey: { key },
					callback: () => nudge(x, y),
					options: { enabled: hasSelection },
				},
				{
					hotkey: { key, shift: true },
					callback: () => nudge(x * 8, y * 8),
					options: { enabled: hasSelection },
				},
			]),
		],
		{ ignoreInputs: true },
	);

	/** Choosing a shape picks up its tool and re-labels the slot with it. */
	function pickShape(kind: NodeKind) {
		setShape(kind);
		setTool(kind);
	}

	/**
	 * The shape key reaches for the slot; pressing it again walks to the next
	 * shape, so one key covers all of them without opening the menu.
	 */
	function cycleShape() {
		const at = SHAPE_KINDS.indexOf(shape);
		pickShape(tool === shape ? SHAPE_KINDS[(at + 1) % SHAPE_KINDS.length] : shape);
	}

	function remove() {
		if (selection.size === 0) return;
		onSceneChange((prev) => deleteNodes(prev, [...selection], picks));
		setSelection(new Set());
	}

	function reorder(to: ReorderTo) {
		if (selection.size === 0) return;
		onSceneChange((prev) => reorderNodes(prev, [...selection], to));
	}

	function nudge(x: number, y: number) {
		onSceneChange((prev) => moveNodes(prev, [...selection], x, y, picks), "nudge");
	}

	/**
	 * A line pulled off a ruler and dropped on the design.
	 *
	 * The ruler's half of the gesture is pixels and this is the document's: which
	 * page the line belongs to and where on it, both of which `drawGuideAt`
	 * answers — including the case where the answer is "nowhere", since a guide
	 * has to belong to a surface. Dropped against the universe on screen, like
	 * every other gesture, because a solved artboard is where the eye sees it
	 * rather than where the document stores it.
	 */
	function drawGuide(axis: "x" | "y", at: Point) {
		onSceneChange(
			(prev) => drawGuideAt(prev, axis, at, primary?.solved ?? {}, picks).scene,
		);
	}

	function autoLayout() {
		if (selection.size < 1) return;
		let created: string | null = null;
		onSceneChange((prev) => {
			const result = wrapInLayout(prev, [...selection], picks);
			created = result.id;
			return result.scene;
		});
		if (created) setSelection(new Set([created]));
	}

	/** Copy the selection and select the copies. */
	function duplicate() {
		if (selection.size === 0) return;
		let created: string[] = [];
		onSceneChange((prev) => {
			// The offset is `DUPLICATE_OFFSET` rather than a 16 written here,
			// because sixteen of *what* is the whole question: sixteen EMU is a
			// six-thousandth of a pixel, and the copy would land under the original
			// where nothing but the layer list could find it.
			const result = duplicateNodes(prev, [...selection], DUPLICATE_OFFSET, picks);
			created = result.ids;
			return result.scene;
		});
		if (created.length) setSelection(new Set(created));
	}

	/**
	 * The toolbar's alignments. They state a rule rather than moving anything
	 * themselves: the solver does the moving, and it keeps doing it.
	 *
	 * The Rules panel is opened at the same time, because a press that has a
	 * lasting consequence should show where that consequence now lives.
	 */
	function align(edge: Edge) {
		if (selection.size < 2) return;
		const ids = [...selection];
		onSceneChange(
			(prev) => addConstraint(prev, "align", ids, undefined, edge).scene,
		);
		setPanel("constraints");
	}

	function distribute() {
		if (selection.size < 3) return;
		onSceneChange((prev) => distributeNodes(prev, [...selection]).scene);
		setPanel("constraints");
	}

	/**
	 * The one viewport every selected node is a **direct child** of, or nothing.
	 *
	 * Direct children because that is what `addPivot` re-parents: it rebases the
	 * ones it takes by however far the pivot moved, and a node three levels down
	 * is already rebased by its own ancestors. Nothing where the selection spans
	 * two views or straddles the seam — a pivot is a transform inside one model
	 * space, and there is no honest answer for a selection that is half on the
	 * page.
	 */
	function sharedView(): string | undefined {
		if (selection.size < 1) return undefined;
		let view: string | undefined;
		for (const id of selection) {
			const parent = parentOf(scene.nodes, id);
			if (parent?.kind !== "viewport") return undefined;
			if (view !== undefined && view !== parent.id) return undefined;
			view = parent.id;
		}
		return view;
	}

	/**
	 * Group — and inside a 3D view that means a **pivot**, not a group.
	 *
	 * The same gesture for both because it is the same request, and the different
	 * answer because a group is the wrong shape below the seam: `wrapsChildren` is
	 * true of a group, so it re-fits to its children's 2D bounding box — and the
	 * bounding box of rotated solids is exactly the trigonometry a linear solver
	 * cannot do. A pivot is a place and a rotation with nothing to re-fit, which
	 * is `KINDS.pivot`'s whole argument, and ⌘G is where a designer goes looking
	 * for it.
	 *
	 * `addPivot` can refuse — a child whose x is driven by a token cannot be
	 * rebased without unwiring the link, and it declines rather than doing that —
	 * in which case the scene comes back unchanged and so does the selection,
	 * which is the same silence every other refused edit in this studio gives.
	 */
	function group() {
		if (selection.size === 0) return;
		const view = sharedView();
		if (view !== undefined) {
			const before = new Set(flatten(scene.nodes).map((n) => n.id));
			const next = addPivot(scene, view, [...selection], picks);
			const made = flatten(next.nodes).find(
				(n) => n.kind === "pivot" && !before.has(n.id),
			);
			onSceneChange(() => next);
			if (made) setSelection(new Set([made.id]));
			return;
		}
		let created: string | null = null;
		onSceneChange((prev) => {
			const result = groupNodes(prev, [...selection], "Group", picks);
			created = result.id;
			return result.scene;
		});
		if (created) setSelection(new Set([created]));
	}

	/**
	 * What the last import could not bring across, shown once and dismissed.
	 *
	 * An import's loss list is the mirror of an export's and is worth exactly as
	 * much: a designer who imports a rigged, animated, textured character and gets
	 * a static grey one is owed the difference in sentences rather than in
	 * silence. Session state, never the document — it is a fact about a thing that
	 * just happened, not about the design.
	 */
	const [imported, setImported] = useState<{ name: string; lost: string[] } | null>(
		null,
	);

	/**
	 * Bring a glTF into a view: pick a file, parse it, put it in the tree, make
	 * the nodes.
	 *
	 * Here rather than in the inspector because every step but the last is
	 * something a panel should not be holding — a file the person chooses, a
	 * parser that pulls in three.js and therefore has to stay behind a dynamic
	 * import so a flat document never downloads it, and a write to the project's
	 * tree. What the inspector gets is a button and a viewport id.
	 *
	 * **The four steps are in this order and the order is the error story.**
	 * Parse, write, import, place:
	 *
	 *  - `parseGltfFile` is the only one of them that throws, and it throws
	 *    *before* anything is written. Someone who drops a PDF on a viewport gets
	 *    a sentence and a tree that never heard of it. That is the same shape the
	 *    picture import has, where `createImageBitmap` validates before
	 *    `putNamedAsset` writes, and it is why the importer takes a parsed file
	 *    rather than bytes: the ordering is structural rather than remembered.
	 *  - The file goes in **before** the document is touched, so a refused write
	 *    cannot leave a `model` node pointing at a path nothing holds. The
	 *    reverse — a file with no node — is harmless and self-correcting, since
	 *    `pruneAssets` drops the index entry and nothing ever asks for it.
	 *  - `importGltf` cannot run before the write, because `src` is not knowable
	 *    until it has happened: `putNamedAsset` resolves a collision by renaming,
	 *    so only it knows whether this chair became `chair.glb` or `chair-2.glb`,
	 *    and every `MeshRef` the import mints is stamped with the answer.
	 *
	 * One index entry per **file**, not per part: `bytes` is the length of what
	 * the person actually imported and `triangles` is the file's total, which is
	 * the pair a project overview wants and which the per-primitive index could
	 * not express. Each part's own count stays on its `MeshRef`, which is what
	 * `tris/2` emits.
	 */
	const importModel = useCallback(
		(viewport: string) => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".glb,.gltf,model/gltf-binary,model/gltf+json";
			input.onchange = () => {
				const file = input.files?.[0];
				if (!file) return;
				void (async () => {
					try {
						const [bytes, mod] = await Promise.all([
							file.arrayBuffer().then((b) => new Uint8Array(b)),
							import("@clingo-design/canvas-3d"),
						]);
						const parsed = mod.parseGltfFile(bytes);
						const src = await putNamedAsset(file.name, bytes);
						const name = file.name.replace(/\.(glb|gltf)$/i, "");
						const result = mod.importGltf(parsed, { src, name });
						const landed = new Set(result.nodes.map((n) => n.id));
						onSceneChange((prev) =>
							addImport(prev, viewport, result.nodes, {
								[src]: {
									// From the name, which is the same reading `MeshRef.format`
									// takes and has to be: nothing downstream is deceived by it
									// (`parseGltfFile` sniffs the magic number and ignores the
									// extension), so `format` is a *label* — what the tree shows
									// and what a relink dialog offers — and there the name the
									// person gave the file is the answer they mean.
									format: src.toLowerCase().endsWith(".glb") ? "glb" : "gltf",
									bytes: bytes.length,
									triangles: result.triangles,
									name: file.name,
								},
							}),
						);
						setSelection(landed);
						setImported({ name: file.name, lost: result.lost });
					} catch (error) {
						// A file that is not a glTF at all is the only thing this flow
						// throws for — `parseGltfFile` refuses it and `importGltf` never
						// refuses anything — and it is a thing a person does by accident.
						// It reports through the same channel as a loss, because from where
						// they are standing "this did not come in" and "this came in
						// without its animation" are the same question.
						setImported({
							name: file.name,
							lost: [
								error instanceof Error
									? error.message
									: "This file could not be read as glTF.",
							],
						});
					}
				})();
			};
			input.click();
		},
		[onSceneChange],
	);

	/**
	 * Bring a picture in: choose a file, put it in the tree, place a node.
	 *
	 * The file goes in **before** the node, which is the same order the glTF
	 * import uses and for the same reason: a node that referenced a path nothing
	 * had written yet would be a picture the canvas could never draw, while a
	 * file with no node is inert and gets swept by `pruneAssets`.
	 *
	 * The intrinsic size is decoded here rather than guessed, because it is what
	 * the node's box becomes — a photograph arrives at the size it really is, and
	 * a designer who wants it smaller resizes it and can see what they did.
	 * `createImageBitmap` rather than an `<img>` and a load event: it reports the
	 * dimensions without attaching anything to the document, and it rejects on a
	 * file that is not an image, which is the check this needs anyway.
	 */
	const importImage = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) return;
			void (async () => {
				try {
					const bytes = new Uint8Array(await file.arrayBuffer());
					const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: file.type }));
					const { width, height } = bitmap;
					// Freed at once: it was decoded to be measured, and the picture the
					// canvas draws comes from the file in the tree.
					bitmap.close();
					const src = await putNamedAsset(file.name, bytes);
					const centre = {
						x: region.x + region.width / 2,
						y: region.y + region.height / 2,
					};
					onSceneChange((prev) =>
						addImage(
							prev,
							// The artboard under the middle of the view, exactly as the
							// drawing tools choose a host — an image dropped into a frame
							// belongs to it, and one placed over empty canvas is a root.
							frameAt(prev.nodes, centre, primary?.solved ?? {}, context)?.node.id ??
								null,
							{ src, mimeType: file.type || "image/png", width, height },
							centre,
							file.name.replace(/\.[^.]+$/, ""),
							picks,
						),
					);
					setImported({ name: file.name, lost: [] });
				} catch {
					setImported({
						name: file.name,
						lost: ["This file could not be read as an image."],
					});
				}
			})();
		};
		input.click();
	}, [onSceneChange, picks, region, context, primary?.solved]);

	const selectedGroups = [...selection].filter((id) => {
		const node = byId.get(id);
		return node !== undefined && wrapsChildren(node);
	});

	function ungroup() {
		if (selectedGroups.length === 0) return;
		let freed: string[] = [];
		onSceneChange((prev) => {
			const result = ungroupNodes(prev, selectedGroups, picks);
			freed = result.ids;
			return result.scene;
		});
		if (freed.length) setSelection(new Set(freed));
	}

	/**
	 * The one node a component action can be about: a lone selected container.
	 *
	 * A component is a subtree, so a multi-selection has no single root to be
	 * one, and a leaf has nothing to hold.
	 */
	const componentTarget =
		selection.size === 1
			? byId.get([...selection][0])
			: undefined;
	const canDefine =
		componentTarget !== undefined &&
		KINDS[componentTarget.kind].container &&
		!componentTarget.component;

	function makeComponent() {
		if (!componentTarget) return;
		onSceneChange((prev) => defineComponent(prev, componentTarget.id));
	}

	function menuItems(): Array<MenuItem | "separator"> {
		return [
			{
				id: "make-component",
				label: "Make a component",
				disabled: !canDefine,
				run: makeComponent,
			},
			{
				id: "place-instance",
				label: "Place an instance",
				disabled: componentTarget?.component !== true,
				run: () => {
					if (!componentTarget) return;
					let created: string | null = null;
					onSceneChange((prev) => {
						const result = addInstance(prev, componentTarget.id, picks);
						created = result.id;
						return result.scene;
					});
					if (created) setSelection(new Set([created]));
				},
			},
			"separator",
			{
				id: "group",
				label: "Group selection",
				hint: "⌘G",
				disabled: selection.size < 1,
				run: group,
			},
			{
				id: "auto-layout",
				label: "Wrap in auto layout",
				hint: "⇧A",
				disabled: selection.size < 1,
				run: autoLayout,
			},
			{
				id: "ungroup",
				label: "Ungroup",
				hint: "⇧⌘G",
				disabled: selectedGroups.length === 0,
				run: ungroup,
			},
			"separator",
			{
				id: "front",
				label: "Bring to front",
				hint: "⇧]",
				disabled: !hasSelection,
				run: () => reorder("front"),
			},
			{
				id: "forward",
				label: "Bring forward",
				hint: "]",
				disabled: !hasSelection,
				run: () => reorder("forward"),
			},
			{
				id: "backward",
				label: "Send backward",
				hint: "[",
				disabled: !hasSelection,
				run: () => reorder("backward"),
			},
			{
				id: "back",
				label: "Send to back",
				hint: "⇧[",
				disabled: !hasSelection,
				run: () => reorder("back"),
			},
			"separator",
			{
				id: "duplicate",
				label: "Duplicate",
				hint: "⌘D",
				disabled: !hasSelection,
				run: duplicate,
			},
			{
				id: "delete",
				label: "Delete",
				hint: "⌫",
				disabled: !hasSelection,
				run: remove,
			},
		];
	}

	/**
	 * A short description of what this universe chose, for the grid caption.
	 *
	 * Over what the *solver* left open, not what the document typed: on a sudoku
	 * whose cells are a rule's own choice the document has nothing to list, and
	 * five plainly different boards captioned "settled" is a caption that lies.
	 * The two readings agree on every template that has no such rule.
	 *
	 * Capped, because a rule can open dozens of choices at once and a caption is
	 * a caption. What a rule-minted choice shows is the text it actually drew
	 * with, since its alternatives are numbered by the rule rather than by a list
	 * anyone could count along.
	 */
	function captionFor(universe: Universe) {
		const parts: string[] = [];
		let more = 0;
		// What this design cost, first, because in a ranked document it is the
		// reason it is in this position. A ranking nobody can see is a ranking
		// nobody trusts, and the grid is where the comparison actually happens.
		if (universe.costs.length > 0) {
			// A design that gave up nothing is not "nothing", it is the best one —
			// the grid is where that comparison is made, so it says so.
			parts.push(
				universe.costs.every((cost) => cost === 0)
					? "best"
					: describeCosts(universe.costs, exploration?.levels ?? []),
			);
		}
		for (const variable of unsettled) {
			const index = universe.pick[variable];
			if (index === undefined) continue;
			if (parts.length === CAPTION_PARTS) {
				more++;
				continue;
			}
			const parsed = parseVariable(variable);
			const drawn =
				parsed?.kind === "prop" && !byId.has(parsed.node)
					? universe.model.byId[parsed.node]?.rendered[parsed.prop as PropName]
					: undefined;
			// A style's alternatives are whole records, so there is no value to
			// print — but a variant has a name, and "Prose Comfortable" is the
			// caption somebody can act on where "Prose 2" is not.
			const style =
				parsed?.kind === "style" ? findStyle(scene.styles, parsed.style) : undefined;
			const shown = style ? variantLabel(style, index) : (drawn ?? index + 1);
			parts.push(`${labels.get(variable) ?? variable} ${shown}`);
		}
		if (more > 0) parts.push(`+${more} more`);
		return parts.join(" · ") || "settled";
	}

	/** The same, for the choices the solver left open — one lookup each. */
	const labels = useMemo(
		() => new Map([...unsettled].map((key) => [key, labelFor(key)] as const)),
		[unsettled, labelFor],
	);

	/* ---------------------------------------------------------------- */
	/* State machines                                                    */
	/* ---------------------------------------------------------------- */

	/**
	 * State copies a rule may name, offered in the Rules panel's member picker
	 * beside the node ids and the datums.
	 *
	 * A cross-state rule — "the label does not jump when you hover" — is an
	 * ordinary `align` with an unusual member, and this is the only place in the
	 * studio that has to know such a member exists: `c_node/2` takes the term
	 * exactly where it takes a node id, and the geometric rules relate it through
	 * a frame and a world chain it already has.
	 */
	const stateMembers = useMemo(() => stateCopyIds(scene), [scene]);

	/**
	 * The last frame each 3D view drew, as a PNG data URL, by viewport node id.
	 *
	 * **Session state and deliberately not the document.** A poster is a
	 * photograph of one moment of one camera in one universe: it is not something
	 * the design says, it must not reach a solve or an undo entry, and a data URL
	 * in the file would be a hundred kilobytes in every diff and every sync
	 * message. It exists so that {@link ExportPanel} can hand `exportUniverse` a
	 * picture of what was inside a view, because HTML has no word for geometry and
	 * `design-core` has no renderer to take one with.
	 *
	 * Written once per mounted view, when the renderer hands the first frame back
	 * — see `ViewportCanvas`'s `Poster`. Re-encoding a PNG every frame would cost
	 * more than the rendering, and what an export wants is what the view looked
	 * like rather than what it looks like this instant.
	 */
	const [posters, setPosters] = useState<Record<string, string>>({});
	const keepPoster = useCallback((viewport: string, dataUrl: string) => {
		setPosters((was) =>
			was[viewport] === dataUrl ? was : { ...was, [viewport]: dataUrl },
		);
	}, []);

	/**
	 * Keyframe copies a rule may name, offered in the same picker.
	 *
	 * The twin of {@link stateMembers}, and the *only* way one of these terms
	 * gets into a document: `compile()` mints `kfr(I,W,R,K)` where a rule already
	 * names one and nowhere else, so a mechanism with no menu in front of it is a
	 * mechanism nobody can start using.
	 */
	const keyMembers = useMemo(() => keyframeCopyIds(scene), [scene]);

	/**
	 * The edge a trigger takes at an instance right now, or nothing.
	 *
	 * A second reading of what `stepMachine` answers, and the duplication is
	 * deliberate and narrow: the step decides *where the machine goes*, which
	 * must have exactly one answer shared with the exported file, while this
	 * decides *how the move is paced*, which the file gets from the same document
	 * by a different route. The two are kept in step by being written to the same
	 * three conditions `machineTable` filters on — enabled, both ends real, first
	 * in document order — so the transition found here is the transition the
	 * table's edge came from.
	 */
	function edgeAt(
		instance: string,
		trigger: Trigger,
	): { machine: Machine; transition: Transition } | undefined {
		const node = byId.get(instance);
		if (!node) return undefined;
		const machine = machineForNode(scene, node);
		if (!machine) return undefined;
		// Where every layer is: what is being played, over what the document draws.
		// Layers made "where the machine is" plural, so the edge that fired is the
		// first one leaving *any* layer's current state — which is what
		// `stepInstance` walks, in the same layer order, and the same reason this
		// is a second reading rather than a second decision.
		const at = { ...shownStates(machine, node), ...playback.playing[instance] };
		const ids = new Set(machine.states.map((s) => s.id));
		for (const layer of machineLayers(machine)) {
			const from = at[layer.id];
			if (from === undefined) continue;
			const transition = machine.transitions.find(
				(t) =>
					t.enabled &&
					t.trigger === trigger &&
					t.from === from &&
					ids.has(t.from) &&
					ids.has(t.to),
			);
			if (transition) return { machine, transition };
		}
		return undefined;
	}

	/**
	 * A trigger the canvas saw, followed.
	 *
	 * Two acts in one, and the order matters: the pacing is recorded *before* the
	 * state changes, so that the render which draws the new state is the same
	 * render that carries the duration it should get there in. React batches both
	 * updates out of one event handler, so the browser never sees the new frames
	 * with the old transition on them — which, when it was the other way round,
	 * showed up as the first hover of a session snapping and every one after it
	 * easing.
	 *
	 * Where the machine ends up is entirely `stepMachine`'s answer, through the
	 * playback hook. Nothing here can move a machine somewhere the exported file
	 * would not.
	 */
	function onTrigger(instance: string, trigger: Trigger) {
		const edge = edgeAt(instance, trigger);
		if (edge) {
			const timing = answer?.machines[edge.machine.id];
			setMotion({
				duration: timing?.duration[edge.transition.id] ?? MOTION_FALLBACK.duration,
				delay: timing?.delay[edge.transition.id] ?? MOTION_FALLBACK.delay,
				easing: EASINGS[edge.transition.easing ?? DEFAULT_EASING].css,
			});
		}
		playback.fire(instance, trigger);
	}

	/**
	 * Switching preview on starts every machine, the way loading the exported
	 * page would.
	 *
	 * A `load` trigger has no event: it fires once, when a runtime starts, and it
	 * is how a machine says "settle into this state" rather than "wait to be
	 * poked". The chain is followed to the end — a→b, b→c ends at c, because
	 * stopping one edge short is an arbitrary place to stop — and a cycle stops
	 * *before* going round rather than after, so the machine ends in the last
	 * state it had not already been in. `MACHINE_RUNTIME` settles the same chains
	 * by the same rule; a state strip that disagreed with the exported file about
	 * where a machine starts would be the one disagreement this whole design is
	 * arranged to prevent.
	 *
	 * Note that no health check catches a load cycle: a two-state one is
	 * reachable, leaves both states and is deterministic. This loop is what
	 * stands between a designer and a preview that spins.
	 */
	useEffect(() => {
		if (!previewing) return;
		for (const instance of Object.keys(machineTable(scene).instances)) {
			/**
			 * Where each layer has already been, so a cycle stops *before* going
			 * round rather than after.
			 *
			 * Per layer since the ladder, because the chain is per layer: the press
			 * layer may settle in one step while the glow layer takes three, and a
			 * single set of state ids would let one layer's arrival stop the other's
			 * walk. The runtime's `settle` keeps its `seen` per layer for exactly
			 * this reason, and the two must not differ about where a machine starts.
			 */
			const seen = new Map<string, Set<string>>();
			for (;;) {
				const at = playback.fire(instance, "load");
				if (at === null) break;
				let fresh = false;
				for (const [layer, state] of Object.entries(at)) {
					const walked = seen.get(layer) ?? new Set<string>();
					seen.set(layer, walked);
					if (walked.has(state)) continue;
					walked.add(state);
					fresh = true;
				}
				// Every layer answered with somewhere it had already been, so the next
				// pass would answer the same thing. That is the fixpoint, and it is
				// also where a load cycle is caught.
				if (!fresh) break;
			}
		}
		// Keyed on the toggle and deliberately on nothing else, `scene` and
		// `playback` included. Re-running it whenever the document changed would
		// restart every machine each time a colour was nudged, which is not what a
		// load edge means and would yank the design out from under whoever was
		// pointing at it. `playback.fire` reads the machine's current state from a
		// ref rather than from this closure, so a stale one here cannot make the
		// chain start from the wrong place.
	}, [previewing]);

	/**
	 * The subject of the canvas state strip: one instance, and the machine
	 * driving it.
	 *
	 * Read off the selection rather than chosen in a panel, so the strip is a
	 * view on what is selected in the same way the inspector is — select a
	 * button, see its states; select something else, the strip goes away.
	 *
	 * **Selecting the definition borrows an instance of it, and it has to.** A
	 * definition on the canvas is always its rest state, because a definition
	 * part's frame is a *fact* the compiler emits and every instance inherits it
	 * — drawing the definition in another state would move the component itself.
	 * The state copies exist per instance, so the strip draws a use of the
	 * definition and says as much by putting that instance's name on it. A
	 * definition with a machine and no instances anywhere gets no strip: there
	 * would be nothing in the answer set to draw, and inventing something is how
	 * a preview starts lying.
	 */
	const stateStrip = useMemo(() => {
		if (selection.size !== 1) return undefined;
		const id = [...selection][0];
		const node = byId.get(id);
		if (!node) return undefined;
		const machine = machineForNode(scene, node);
		if (!machine || machine.states.length === 0) return undefined;
		const subject =
			node.instanceOf !== undefined
				? node
				: flatten(scene.nodes).find((n) => n.instanceOf === machine.root);
		if (!subject) return undefined;
		const world = placedNodes(scene.nodes, primary?.solved ?? {}, context).find(
			(p) => p.node.id === subject.id,
		)?.world;
		if (!world || world.width <= 0 || world.height <= 0) return undefined;
		return {
			machine,
			instance: subject.id,
			name: subject.name,
			world,
			drawn: shownState(machine, subject),
			// Built here rather than inline in the render so each cell hands the
			// artboard the *same object* on every render: `Artboard` is memoised,
			// and a fresh `{ [id]: { [layer]: state } }` per render would re-render
			// every copy in the strip on every pointermove over the canvas.
			//
			// One cell plays exactly one layer, and the layer is the state's own.
			// Every other layer is left as the answer set drew it, which is what
			// makes a cell a picture of *this state* rather than a picture of this
			// state on top of whatever the other layers happen to be doing — the
			// strip is where two states get compared, and a second variable in the
			// comparison would ruin it.
			cells: machine.states.map((state) => ({
				state,
				layer: layerOf(machine, state),
				playing: {
					[subject.id]: { [layerOf(machine, state)]: state.id },
				} as Readonly<Record<string, Readonly<Record<string, string>>>>,
			})),
		};
	}, [selection, byId, scene, primary, context]);

	return (
		<div className={styles.studio}>
			<div
				className={styles.body}
				style={{
					gridTemplateColumns: `${leftWidth}px 6px minmax(0, 1fr) 6px ${rightWidth}px`,
				}}
			>
				<aside className={styles.side}>
					<LayerList
						scene={scene}
						selection={selection}
						onSelectionChange={selectionIds}
						onSceneChange={onSceneChange}
						solved={primary?.solved}
						derived={derived}
						everywhere={everywhere}
						onContextMenu={(at, nodeId) => {
							// Right-clicking a layer outside the selection retargets it,
							// the way the canvas does.
							if (!selection.has(nodeId)) setSelection(new Set([nodeId]));
							const box = host.current?.getBoundingClientRect();
							setMenu({ x: at.x - (box?.left ?? 0), y: at.y - (box?.top ?? 0) });
						}}
					/>
				</aside>

				<PanelResizer
					side="left"
					width={leftWidth}
					onResize={setLeftWidth}
					label="Resize the layers panel"
				/>

				<main className={styles.main} data-role="canvas-host" ref={host}>
					<InfiniteCanvas
						apiRef={canvas}
						cameraStore={camera}
						onFit={fit}
						onCanvasPointerDown={() => {
							// Empty canvas: the editor stops propagation for anything
							// it owns, so reaching here means nothing was hit.
							setSelection(new Set());
							setMenu(null);
						}}
					>
						{shown.map((universe, i) => {
							if (onscreen && !onscreen.has(i)) return null;
							const editable = view === "design" && i === 0 && !showingWays;
							const way = showingWays ? relaxations[i] : undefined;
							const box = boxes[i];
							return (
								<div
									key={i}
									className={styles.placed}
									data-universe={i}
									style={{
										left: box.x,
										top: box.y,
										width: box.width,
										height: box.height,
									}}
									onPointerDown={
										view === "multiverse" && !showingWays
											? (e) => {
													e.stopPropagation();
													pinUniverse(universe);
												}
											: undefined
									}
								>
									{editable ? (
										<Editor
											scene={scene}
											universe={universe}
											selection={selection}
											onSelectionChange={selectionIds}
											onSceneChange={onSceneChange}
											tool={tool}
											onToolChange={setTool}
											getScale={() => camera.get().scale}
											origin={{ x: region.x, y: region.y }}
											varying={unsettled}
											freedom={freedom}
											derived={derived}
											showGuides={showGuides}
											previewing={previewing}
											playing={playback.playing}
											scrub={playback.scrub}
											onTrigger={onTrigger}
											motion={motion}
											onPoster={keepPoster}
											onContextMenu={(at) => {
												const box = host.current?.getBoundingClientRect();
												setMenu({
													x: at.x - (box?.left ?? 0),
													y: at.y - (box?.top ?? 0),
												});
											}}
										/>
									) : (
										// Read-only copies pack against the document's own
										// top-left, so a document not at the origin still
										// tiles neatly.
										<div
											className={styles.copy}
											style={{ left: -canvasPx(bounds.x), top: -canvasPx(bounds.y) }}
										>
											<Artboard scene={scene} universe={universe} />
											{/* Beside the artboard rather than inside it, because a
											    grid rules a design without being part of it — the
											    same line the exporter draws. Inert here: there is
											    nothing to drag on a copy you are not editing, and
											    hiding them is the person's business and never the
											    document's. */}
											{showGuides ? (
												<Guides scene={scene} lines={ruledFor(universe)} />
											) : null}
										</div>
									)}
									{way ? (
										// A way out is not a design to browse, it is an offer to
										// take, so its caption is the button rather than sitting
										// beside one. Marked free when it asks nothing of the
										// document — releasing a pin is not an edit.
										<button
											type="button"
											className={cx(styles.caption, styles.wayButton)}
											data-role="way"
											data-way={i}
											data-free={way.free ? "" : undefined}
											title={
												way.free
													? "Let go of these held values — not an edit, nothing to undo"
													: "Switch these rules off in the document"
											}
											onPointerDown={(e) => e.stopPropagation()}
											onClick={() => applyRelaxation(way)}
										>
											{describeRelaxation(way)}
											<span className={styles.wayTag}>
												{way.free ? "free" : "edit"}
											</span>
										</button>
									) : view === "multiverse" ? (
										<div className={styles.caption} data-role="caption">
											{captionFor(universe)}
										</div>
									) : null}
								</div>
							);
						})}

						{/*
						 * The state strip: the subject drawn once per state, side by side,
						 * under the design it belongs to.
						 *
						 * **On the canvas rather than in a third view, and that is the
						 * answer to the view switcher's argument.** `ViewSwitcher` says a
						 * toggle with three states is a menu, and it is right; the mistake
						 * would be to conclude that the strip therefore has to be a menu
						 * entry. It is not a *view* of the document at all — a view is what
						 * the whole canvas shows and there are two of those, the one design
						 * you edit and the space it came from. A strip of one component's
						 * states is an annotation on the design in front of you, appearing
						 * because something is selected and going away when nothing is,
						 * which is exactly what `AlignTools` and the rulers already do.
						 * Putting it here also keeps the one property that makes it worth
						 * having: it is in the design's own coordinates, at the design's
						 * own scale, so zooming in to compare two states is the same
						 * gesture as zooming in on anything else.
						 *
						 * Every cell costs one lookup and no solve. All of these states are
						 * in the same answer set as the picture above them — that is the
						 * invariant — so this is `Artboard` reading `model.states` five
						 * times rather than five solves, and a machine with eight states is
						 * as cheap as one with two.
						 */}
						{view === "design" && !showingWays && primary && stateStrip ? (
							<div
								className={styles.strip}
								data-role="state-strip"
								data-machine={stateStrip.machine.id}
								data-instance={stateStrip.instance}
								style={{
									left: canvasPx(bounds.x),
									top: canvasPx(bounds.y + bounds.height + STRIP_GAP),
								}}
								// The strip is furniture on the canvas, so a press on it must
								// not also start a pan — the same stop the multiverse's
								// clickable copies make.
								onPointerDown={(e) => e.stopPropagation()}
							>
								<div className={styles.stripName}>
									{stateStrip.machine.name || stateStrip.machine.id} ·{" "}
									{stateStrip.name}
								</div>
								{stateStrip.cells.map(({ state, layer, playing }, at) => {
									const live =
										playback.playing[stateStrip.instance]?.[layer] === state.id;
									return (
										<div
											key={state.id}
											className={styles.stateCell}
											data-role="state-preview"
											data-state={state.id}
											data-drawn={state.id === stateStrip.drawn ? "" : undefined}
											data-playing={live ? "" : undefined}
											style={{
												left: at * (canvasPx(stateStrip.world.width) + canvasPx(STRIP_STEP)),
												width: canvasPx(stateStrip.world.width),
												height: canvasPx(stateStrip.world.height),
											}}
										>
											<span className={styles.stateName}>
												{state.name || state.id}
											</span>
											<span className={styles.stateInk}>
												{/* Packed against the subject's own top-left, the way a
												    read-only copy of the whole document is: the artboard
												    draws the entire design and the cell shows the one
												    box worth looking at. Cheaper than building a second
												    renderer that knows how to draw a subtree, and — more
												    to the point — it is the *same* renderer, so a state
												    cell cannot draw a component differently from the
												    canvas above it. */}
												<span
													className={styles.copy}
													style={{
														left: -canvasPx(stateStrip.world.x),
														top: -canvasPx(stateStrip.world.y),
													}}
												>
													<Artboard
														scene={scene}
														universe={primary}
														playing={playing}
													/>
												</span>
											</span>
											{/* The whole cell is the target, as an element of its own
											    rather than a `<button>` wrapped round the drawing: an
											    artboard is divs, a button may only hold phrasing
											    content, and a picture nested illegally inside a control
											    is a picture assistive technology reads as the control's
											    name. */}
											<button
												type="button"
												className={styles.stateHit}
												data-role="play-state"
												data-state={state.id}
												aria-pressed={live}
												title={
													live
														? `Stop playing “${state.name || state.id}” — hand the canvas back to the document`
														: `Play “${state.name || state.id}” on the canvas. Nothing is written down and nothing solves.`
												}
												onClick={() =>
													playback.play(
														stateStrip.instance,
														layer,
														live ? null : state.id,
													)
												}
											>
												<span className={styles.hidden}>
													{state.name || state.id}
												</span>
											</button>
										</div>
									);
								})}
							</div>
						) : null}
					</InfiniteCanvas>

					{/* Only over the design, and that is a claim about coordinates
					    rather than about clutter. The editable copy is the one whose
					    box is the padded `region` and whose content is offset back by
					    the same amount, so a document coordinate lands at exactly
					    `canvasPx` of itself and a ruler reading the canvas is reading
					    the document. Every other copy is packed against the grid's own
					    origin, so the same reading would be off by wherever that copy
					    happened to be tiled — a ruler that is wrong is worse than no
					    ruler, and there is nothing to measure in a wall of thumbnails
					    anyway. */}
					{view === "design" && !showingWays ? (
						<Rulers
							camera={camera}
							unit={scene.unit ?? DEFAULT_UNIT}
							zero={zero}
							onZeroChange={setZero}
							onDrawGuide={drawGuide}
						/>
					) : null}

					<div className={styles.toolbar}>
						<Link className={styles.back} to="/" title="Back to projects">
							<span aria-hidden="true">←</span>
							<span className={styles.projectName}>{projectName}</span>
						</Link>
						<ViewSwitcher options={VIEWS} value={view} onChange={setView} />
						{view === "design" ? (
							<div className={styles.tools}>
								{TOOLS.map((t) =>
									t.shapes ? (
										<ShapePicker
											key={t.id}
											shapes={SHAPE_KINDS}
											value={shape}
											active={tool === shape}
											shortcut={t.key}
											onPick={pickShape}
										/>
									) : (
										<button
											key={t.id}
											type="button"
											data-tool={t.id}
											aria-label={t.label}
											className={cx(
												styles.tool,
												styles.iconTool,
												tool === t.id && styles.toolActive,
											)}
											onClick={() => setTool(t.id)}
										>
											<ToolIcon tool={t.id} />
											<span className={styles.tip} role="tooltip" aria-hidden="true">
												{t.label}
												<kbd className={styles.tipKey}>{t.key}</kbd>
											</span>
										</button>
									),
								)}
								{/* Not a tool, and it sits at the end of the row rather than
								    among them for that reason: every other entry here arms a
								    drag, and this one opens a file picker. An image cannot be
								    drawn — there is a file to choose first, and its own
								    dimensions are what the box should be. */}
								<button
									type="button"
									data-role="import-image"
									aria-label="Place an image"
									className={cx(styles.tool, styles.iconTool)}
									onClick={importImage}
								>
									<span aria-hidden="true">▨</span>
									<span className={styles.tip} role="tooltip" aria-hidden="true">
										Place an image
										<span className={styles.tipHint}>
											arrives at its own size, in the artboard under the view
										</span>
									</span>
								</button>
							</div>
						) : null}
						{view === "design" ? (
							<AlignTools
								count={selection.size}
								onAlign={align}
								onDistribute={distribute}
							/>
						) : null}
						{view === "design" ? (
							<div className={styles.tools}>
								<button
									type="button"
									className={cx(styles.tool, showGuides && styles.toolActive)}
									data-role="guides"
									data-active={showGuides ? "" : undefined}
									title="Show the margins, the grid and the guides (⌘;)"
									onClick={() => setShowGuides((on) => !on)}
								>
									Guides
								</button>
								{/*
								 * Running the document, rather than a third view of it.
								 *
								 * A mode and not a guess: the triggers a machine listens for
								 * are the events a drag is made of, so a canvas that fired
								 * them all the time would hover every button somebody dragged
								 * past. Beside Guides because it is the same kind of switch —
								 * a decision about the person looking, not about the design,
								 * reaching no solve, no export and no undo entry.
								 *
								 * Offered only where there is something to run. A toggle that
								 * does nothing on most documents is a toggle people learn to
								 * ignore on all of them.
								 */}
								{scene.machines.length > 0 ? (
									<button
										type="button"
										className={cx(styles.tool, previewing && styles.toolActive)}
										data-role="preview"
										data-active={previewing ? "" : undefined}
										title={
											previewing
												? "Stop running the machines and go back to editing"
												: "Run the machines: hover and click the design and watch it move. Nothing is written down."
										}
										onClick={() =>
											setPreviewing((on) => {
												if (on) {
													// Leaving hands the canvas back to the document in
													// one act: the played states go, and so does the
													// pacing, or the next edit would ease into place.
													playback.clear();
													setMotion(undefined);
												}
												return !on;
											})
										}
									>
										Preview
									</button>
								) : null}
								<button
									type="button"
									className={styles.tool}
									data-role="undo"
									disabled={!canUndo}
									title="Undo (⌘Z)"
									onClick={undo}
								>
									Undo
								</button>
								<button
									type="button"
									className={styles.tool}
									data-role="redo"
									disabled={!canRedo}
									title="Redo (⇧⌘Z)"
									onClick={redo}
								>
									Redo
								</button>
							</div>
						) : null}
						{pinCount > 0 ? (
							<div className={styles.tools} data-role="pins">
								<span className={cx(styles.pinCount, badPins.size > 0 && styles.pinBad)}>
									{pinCount} pinned
								</span>
								<button
									type="button"
									className={styles.tool}
									data-role="keep-pinned"
									title="Write the pinned values into the document"
									onClick={keepPinned}
								>
									Keep
								</button>
								<button
									type="button"
									className={styles.tool}
									data-role="clear-pins"
									title="Release every pinned value"
									onClick={clearPins}
								>
									Clear
								</button>
							</div>
						) : null}
						{/* Offered wherever anything was sampled, ranked or not. A ranked
						    space used to be excluded on the argument that the designs
						    shown are simply the best ones — but a cost is a tier, not a
						    place in a queue, and which of the designs tied at a tier get
						    the slots is exactly what a reshuffle changes. */}
						{exploration?.sampling.sampled && view === "multiverse" ? (
							<button
								type="button"
								className={styles.tool}
								data-role="shuffle"
								title="Draw a different sample of this space"
								onClick={() => setSeed((s) => s + 1)}
							>
								Shuffle
							</button>
						) : null}
					</div>

					{menu ? (
						<ContextMenu
							at={menu}
							items={menuItems()}
							onClose={() => setMenu(null)}
						/>
					) : null}

					{showingWays ? (
						// Said over the canvas rather than only in the panel: the
						// artboards below are not designs the document admits, and
						// somebody arriving at this screen has to be told that before
						// they read anything off them.
						<div className={styles.ways} data-role="ways">
							<strong>{error ?? "No design satisfies these rules."}</strong>{" "}
							{exhaustive
								? "Each is drawn below — click one to take it."
								: "Some of them are drawn below — click one to take it."}
						</div>
					) : null}

					{shown.length === 0 ? (
						<div className={styles.empty} data-role="empty">
							{badPins.size > 0
								? "The pinned values cannot hold — clear them to look again."
								: blamed.size > 0
									? `${blamed.size} rule${blamed.size === 1 ? "" : "s"} conflict${blamed.size === 1 ? "s" : ""} — see the Rules panel.`
									: error || exploration
										? "No universes."
										: "Solving…"}
						</div>
					) : null}
				</main>

				<PanelResizer
					side="right"
					width={rightWidth}
					onResize={setRightWidth}
					label="Resize the properties panel"
				/>

				<aside className={cx(styles.side, styles.right)}>
					<div className={cx(tabStyles.bar, styles.sideTabs)}>
						{PANELS.map((p) => {
							const count =
								p.id === "properties"
									? selection.size
									: p.id === "variables"
										? // Both sections: the panel holds tokens and styles, and a
											// document whose only variable was a style read "Variables"
											// with no badge at all.
											scene.tokens.length + scene.styles.length
										: p.id === "machines"
											? // Machines, not states: the badge counts the records the
												// panel lists, the way the Rules badge counts rules
												// rather than the members they range over. Summing the
												// states would make one four-state button read the same
												// as four machines.
												scene.machines.length
											: scene.constraints.length;
							return (
								<button
									key={p.id}
									type="button"
									data-panel={p.id}
									className={cx(
										tabStyles.button,
										panel === p.id && tabStyles.active,
									)}
									onClick={() => setPanel(p.id)}
								>
									{p.label}
									{count > 0 ? (
										<span
											className={cx(
												styles.badge,
												p.id === "constraints" && blamed.size > 0 && styles.badgeBad,
											)}
										>
											{count}
										</span>
									) : null}
								</button>
							);
						})}
					</div>

					<div className={styles.sidePanel}>
						{panel === "properties" ? (
							<Inspector
								scene={scene}
								selection={selection}
								onSceneChange={onSceneChange}
								picks={picks}
								varying={varying}
								solved={primary?.solved}
								reach={reach}
								freedom={freedom}
								pins={pins}
								onPin={pin}
								why={whyFor}
								derived={derived}
								known={known}
								everywhere={everywhere}
								variables={minted}
								onSelectionChange={selectionIds}
								playing={playingFlat}
								onPlay={playFlat}
								onImportModel={importModel}
							/>
						) : panel === "variables" ? (
							<Variables
								scene={scene}
								onSceneChange={onSceneChange}
								picks={picks}
								varying={varying}
								reach={reach}
								unread={unread}
								pins={pins}
								onPin={pin}
								why={whyFor}
								onSelectionChange={selectionIds}
								derivedWears={answer?.wears}
							/>
						) : panel === "machines" ? (
							/*
							 * The machines, edited where the styles and the rules are edited.
							 *
							 * It takes the same six props every panel that holds values takes
							 * — picks, varying, reach, pins, onPin, why — and that is the
							 * point rather than an accident: a state's delta and a
							 * transition's duration are `Value`s like any other, so they
							 * vary, grey, pin, take a token and answer a why-question through
							 * exactly the rows the rest of the studio already has. Nothing
							 * about a machine needed a second kind of variable, because
							 * nothing about a machine is a design-space choice.
							 */
							<Machines
								scene={scene}
								onSceneChange={onSceneChange}
								picks={picks}
								varying={varying}
								reach={reach}
								pins={pins}
								onPin={pin}
								why={whyFor}
								selection={selection}
								onSelectionChange={selectionIds}
								playing={playback.playing}
								onPlay={playback.play}
								inputs={playback.inputs}
								onSetInput={playback.setInput}
								onFireInput={playback.fireInput}
								scrub={playback.scrub}
								onScrub={playback.setScrub}
								layer={machineLayer}
								onLayerChange={setMachineLayer}
								health={answer?.machines}
								broken={broken}
								conflict={blamed}
							/>
						) : (
							<Constraints
								scene={scene}
								onSceneChange={onSceneChange}
								selection={selection}
								conflict={blamed}
								broken={broken}
								relaxations={relaxations}
								exhaustive={exhaustive}
								describeRelaxation={describeRelaxation}
								onRelax={applyRelaxation}
								onSelectionChange={selectionIds}
									model={answer}
								stateMembers={stateMembers}
								keyMembers={keyMembers}
								picks={primary?.pick}
							/>
						)}
					</div>
				</aside>
			</div>

			{/* What the last import flattened, said once. Dismissible and never
			    stored: it is a fact about a thing that just happened, and a
			    document that carried it would re-announce a two-week-old import
			    every time it was opened. A file that came in whole says so and
			    goes, so the common case is one line rather than a panel to
			    close. */}
			{imported ? (
				<div className={styles.importNotice} data-role="import-notice" role="status">
					<div className={styles.importName}>
						{imported.lost.length === 0
							? `${imported.name} came in whole.`
							: `${imported.name} — what did not come across:`}
					</div>
					{imported.lost.length > 0 ? (
						<ul className={styles.importLost}>
							{imported.lost.map((line) => (
								<li key={line}>{line}</li>
							))}
						</ul>
					) : null}
					<button
						type="button"
						className={styles.importDismiss}
						data-role="import-dismiss"
						aria-label="Dismiss import report"
						onClick={() => setImported(null)}
					>
						Dismiss
					</button>
				</div>
			) : null}

			<footer className={styles.foot}>
				<ProgramPanel
					scene={scene}
					generated={generated}
					onChange={(next) => onSceneChange(() => next)}
					error={error}
					diagnostics={exploration?.diagnostics ?? ""}
					approximations={exploration?.approximations ?? []}
					universes={universes}
					projectName={projectName}
					posters={posters}
					status={
						<StatusLine
							exploration={exploration}
							error={error}
							solving={solving}
							varyingCount={unsettled.size}
							selectionCount={selection.size}
							freedom={freedom}
							probing={probing}
						/>
					}
				/>
			</footer>
		</div>
	);
}
