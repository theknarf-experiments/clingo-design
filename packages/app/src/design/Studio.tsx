import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type RawHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import {
	CONSTRAINT_KINDS,
	LAYOUT_PROPS,
	type LayoutProp,
	DRAW_KINDS,
	type Edge,
	KINDS,
	type NodeKind,
	type PropName,
	SHAPE_KINDS,
	type Frame,
	type ReorderTo,
	type Scene,
	type Universe,
	addConstraint,
	deleteNodes,
	distributeNodes,
	duplicateNodes,
	groupNodes,
	moveNodes,
	collapseToPicks,
	derivedNodes,
	documentBounds,
	flatten,
	parseVariable,
	variableCounts,
	reorderNodes,
	ungroupNodes,
	varyingVariables,
	varyingVars,
	type ModelScene,
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
import { Inspector } from "./Inspector";
import { LayerList } from "./LayerList";
import { ProgramPanel } from "./ProgramPanel";
import { PanelResizer, usePanelWidth } from "./PanelResizer";
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
import styles from "./Studio.module.css";
import tabStyles from "./tabs.module.css";

const LIMIT = 24;

/** Choices a multiverse caption names before it gives up and counts. */
const CAPTION_PARTS = 3;

/**
 * How far past the document the editable surface reaches, so new frames can be
 * drawn well beside the existing ones.
 */
const PAD = 2000;

/** Hotkeys, by toolbar slot. The shapes share one, which also cycles them. */
const TOOL_KEY: Record<string, string> = {
	select: "V",
	frame: "F",
	shape: "R",
	path: "P",
	text: "T",
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
	{ id: "constraints", label: "Rules" },
] as const;

type Panel = (typeof PANELS)[number]["id"];

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

/** Arrows nudge by a pixel, Shift by eight. */
const NUDGE: Record<string, [x: number, y: number]> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
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
		solving,
		freedom,
		probing,
	} = useExploration(scene, LIMIT, seed, pins, measurements, probeIds);
	const blamed = useMemo(() => new Set(conflict), [conflict]);
	const badPins = useMemo(() => new Set(pinConflict), [pinConflict]);
	/** Which alternatives are still reachable, per variable. */
	const reach = exploration?.brave.pick;

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

	// Design shows one concrete universe to edit; multiverse shows the space.
	const shown = view === "multiverse" ? universes : primary ? [primary] : [];
	// Copies of the document are laid out by how much space it occupies.
	const bounds = useMemo(() => documentBounds(scene), [scene]);
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
	 */
	const boxes = useMemo<Frame[]>(
		() =>
			Array.from({ length: shown.length }, (_, i) =>
				view === "design" && i === 0
					? region
					: {
							x: layout.placements[i]?.x ?? 0,
							y: layout.placements[i]?.y ?? 0,
							width: bounds.width,
							height: bounds.height,
						},
			),
		[shown.length, view, region, layout, bounds],
	);
	// Two dozen artboards is two dozen full copies of the document; the ones
	// nowhere near the viewport get no DOM at all.
	const onscreen = useCulling(camera, host, boxes);

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
		() => (primary ? derivedNodes(primary.model, new Set(byId.keys())) : []),
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
		if (layout.bounds.width > 0) canvas.current?.fit(layout.bounds, 0.06);
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
		onSceneChange((prev) => deleteNodes(prev, [...selection]));
		setSelection(new Set());
	}

	function reorder(to: ReorderTo) {
		if (selection.size === 0) return;
		onSceneChange((prev) => reorderNodes(prev, [...selection], to));
	}

	function nudge(x: number, y: number) {
		onSceneChange((prev) => moveNodes(prev, [...selection], x, y), "nudge");
	}

	function autoLayout() {
		if (selection.size < 1) return;
		let created: string | null = null;
		onSceneChange((prev) => {
			const result = wrapInLayout(prev, [...selection]);
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
			const result = duplicateNodes(prev, [...selection]);
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

	function group() {
		if (selection.size === 0) return;
		let created: string | null = null;
		onSceneChange((prev) => {
			const result = groupNodes(prev, [...selection]);
			created = result.id;
			return result.scene;
		});
		if (created) setSelection(new Set([created]));
	}

	const selectedGroups = [...selection].filter((id) => {
		const node = byId.get(id);
		return node !== undefined && wrapsChildren(node);
	});

	function ungroup() {
		if (selectedGroups.length === 0) return;
		let freed: string[] = [];
		onSceneChange((prev) => {
			const result = ungroupNodes(prev, selectedGroups);
			freed = result.ids;
			return result.scene;
		});
		if (freed.length) setSelection(new Set(freed));
	}

	function menuItems(): Array<MenuItem | "separator"> {
		return [
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
			parts.push(`${labels.get(variable) ?? variable} ${drawn ?? index + 1}`);
		}
		if (more > 0) parts.push(`+${more} more`);
		return parts.join(" · ") || "settled";
	}

	/** `prop(card,fill)` reads better as `card fill`. */
	const labels = useMemo(() => {
		const out = new Map<string, string>();
		for (const key of unsettled) {
			const parsed = parseVariable(key);
			if (!parsed) out.set(key, key);
			else if (parsed.kind === "prop") {
				out.set(key, `${byId.get(parsed.node)?.name ?? parsed.node} ${parsed.prop}`);
			} else if (parsed.kind === "constraint") {
				const c = scene.constraints.find((k) => k.id === parsed.constraint);
				out.set(key, c ? `${CONSTRAINT_KINDS[c.kind].label} value` : key);
			} else if (parsed.kind === "layout") {
				const name = byId.get(parsed.node)?.name ?? parsed.node;
				out.set(key, `${name} ${LAYOUT_PROPS[parsed.field as LayoutProp].label}`);
			} else {
				const token = scene.tokens.find((t) => t.id === parsed.token);
				out.set(key, token?.name ?? parsed.token);
			}
		}
		return out;
	}, [unsettled, byId, scene.tokens, scene.constraints]);

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
							const editable = view === "design" && i === 0;
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
										view === "multiverse"
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
											style={{ left: -bounds.x, top: -bounds.y }}
										>
											<Artboard scene={scene} universe={universe} />
										</div>
									)}
									{view === "multiverse" ? (
										<div className={styles.caption}>{captionFor(universe)}</div>
									) : null}
								</div>
							);
						})}
					</InfiniteCanvas>

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
										? scene.tokens.length
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
								picks={primary?.pick ?? {}}
								varying={varying}
								solved={primary?.solved}
								reach={reach}
								freedom={freedom}
								pins={pins}
								onPin={pin}
								derived={derived}
								known={known}
								everywhere={everywhere}
								variables={minted}
							/>
						) : panel === "variables" ? (
							<Variables
								scene={scene}
								onSceneChange={onSceneChange}
								picks={primary?.pick ?? {}}
								varying={varying}
								reach={reach}
								pins={pins}
								onPin={pin}
							/>
						) : (
							<Constraints
								scene={scene}
								onSceneChange={onSceneChange}
								selection={selection}
								conflict={blamed}
								onSelectionChange={selectionIds}
									model={answer}
							/>
						)}
					</div>
				</aside>
			</div>

			<footer className={styles.foot}>
				<ProgramPanel
					scene={scene}
					generated={generated}
					onChange={(next) => onSceneChange(() => next)}
					error={error}
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
