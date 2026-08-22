import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
	DRAW_KINDS,
	KINDS,
	type Scene,
	type Universe,
	deleteNodes,
	duplicateNodes,
	groupNodes,
	moveNodes,
	collapseToPicks,
	documentBounds,
	flatten,
	parseVariable,
	variableCounts,
	reorderNodes,
	ungroupNodes,
	varyingVariables,
	wrapInLayout,
	wrapsChildren,
} from "@clingo-design/design-core";
import {
	type CanvasApi,
	InfiniteCanvas,
	createCameraStore,
} from "@clingo-design/canvas";

import { Artboard } from "./Artboard";
import { Constraints } from "./Constraints";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { Editor, type Tool } from "./Editor";
import { Inspector } from "./Inspector";
import { LayerList } from "./LayerList";
import { ProgramPanel } from "./ProgramPanel";
import { StatusLine } from "./StatusLine";
import { Variables } from "./Variables";
import { ViewSwitcher } from "./ViewSwitcher";
import { cx } from "./cx";
import { layoutArtboards } from "./layout";
import { useExploration } from "./useExploration";
import styles from "./Studio.module.css";
import tabStyles from "./tabs.module.css";

const LIMIT = 24;

/**
 * How far past the document the editable surface reaches, so new frames can be
 * drawn well beside the existing ones.
 */
const PAD = 2000;

/** Hotkeys, by the kind each tool draws. */
const TOOL_KEY: Record<string, string> = {
	select: "V",
	frame: "F",
	rect: "R",
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

const TOOLS: Array<{ id: Tool; label: string; key: string }> = [
	{ id: "select", label: "Select", key: TOOL_KEY.select },
	...DRAW_KINDS.map((kind) => ({
		id: kind as Tool,
		label: KINDS[kind].label,
		key: TOOL_KEY[kind],
	})),
];

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
	const { exploration, generated, error, conflict, pinConflict, solving } =
		useExploration(scene, LIMIT, seed, pins);
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

	// A pin on a variable the document no longer has — or on an alternative
	// that has since been deleted — would make every solve unsatisfiable for a
	// reason the user cannot see.
	useEffect(() => {
		const counts = variableCounts(scene);
		setPins((prev) => {
			const next = Object.fromEntries(
				Object.entries(prev).filter(([v, i]) => i < (counts[v] ?? 0)),
			);
			return Object.keys(next).length === Object.keys(prev).length ? prev : next;
		});
	}, [scene]);
	const canvas = useRef<CanvasApi | null>(null);
	const host = useRef<HTMLElement | null>(null);

	// 100% and fixed: the camera belongs to the user, so nothing the document
	// does may move it. The offset clears the floating toolbar.
	const camera = useMemo(
		() => createCameraStore({ x: -32, y: -72, scale: 1 }),
		[],
	);

	/**
	 * Which assignments hold more than one value.
	 *
	 * Read from the document rather than from the answer sets: projection
	 * collapses universes that render alike, so an assignment can legitimately
	 * be multi-valued while the solver only ever shows one outcome for it. The
	 * panel should still say so.
	 */
	const varying = useMemo(() => new Set(varyingVariables(scene)), [scene]);

	const universes = exploration?.universes ?? [];
	const primary = universes[0];

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

	// Selection must never point at a node that has been deleted. Nested nodes
	// count, so this walks the whole tree rather than the roots.
	useEffect(() => {
		setSelection((prev) => {
			const next = [...prev].filter((id) => byId.has(id));
			return next.length === prev.size ? prev : new Set(next);
		});
	}, [byId]);

	const fit = useCallback(() => {
		if (layout.bounds.width > 0) canvas.current?.fit(layout.bounds, 0.06);
	}, [layout]);

	/**
	 * Hold a whole universe still, without writing it into the document.
	 *
	 * Clicking a design used to collapse the document onto it, which threw the
	 * other designs away on what is really just a click to look closer. Pinning
	 * shows the same thing and is undone by clearing.
	 */
	function pinUniverse(universe: Universe) {
		const varyingOnly = Object.fromEntries(
			Object.entries(universe.pick).filter(([variable]) => varying.has(variable)),
		);
		setPins(varyingOnly);
		setView("design");
	}

	/** Write the pinned alternatives into the document, discarding the rest. */
	function keepPinned() {
		onSceneChange((prev) => collapseToPicks(prev, pins));
		setPins({});
	}

	// Keyboard: tools, delete, nudge, duplicate, z-order, undo/redo.
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			// Never steal keys from a field the user is typing in.
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				return;
			}

			const meta = event.metaKey || event.ctrlKey;
			if (meta && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) redo();
				else undo();
				return;
			}
			if (meta && event.key.toLowerCase() === "g") {
				event.preventDefault();
				if (event.shiftKey) ungroup();
				else group();
				return;
			}
			if (meta && event.key.toLowerCase() === "d") {
				event.preventDefault();
				duplicate();
				return;
			}
			if (meta) return;

			if (event.shiftKey && event.key.toLowerCase() === "a") {
				event.preventDefault();
				autoLayout();
				return;
			}
			if (event.key === "Escape") {
				setSelection(new Set());
				setTool("select");
				return;
			}
			if (event.key === "Delete" || event.key === "Backspace") {
				if (selection.size === 0) return;
				event.preventDefault();
				onSceneChange((prev) => deleteNodes(prev, [...selection]));
				setSelection(new Set());
				return;
			}
			if (event.key === "]" || event.key === "[") {
				if (selection.size === 0) return;
				event.preventDefault();
				onSceneChange((prev) =>
					reorderNodes(
						prev,
						[...selection],
						event.key === "]"
							? event.shiftKey
								? "front"
								: "forward"
							: event.shiftKey
								? "back"
								: "backward",
					),
				);
				return;
			}

			const arrows: Record<string, [number, number]> = {
				ArrowLeft: [-1, 0],
				ArrowRight: [1, 0],
				ArrowUp: [0, -1],
				ArrowDown: [0, 1],
			};
			const delta = arrows[event.key];
			if (delta && selection.size > 0) {
				event.preventDefault();
				const step = event.shiftKey ? 8 : 1;
				onSceneChange(
					(prev) => moveNodes(prev, [...selection], delta[0] * step, delta[1] * step),
					"nudge",
				);
				return;
			}

			const shortcut = TOOLS.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
			if (shortcut) setTool(shortcut.id);
		}

		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selection, onSceneChange, undo, redo]);

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
		const has = selection.size > 0;
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
				disabled: !has,
				run: () => onSceneChange((p) => reorderNodes(p, [...selection], "front")),
			},
			{
				id: "forward",
				label: "Bring forward",
				hint: "]",
				disabled: !has,
				run: () => onSceneChange((p) => reorderNodes(p, [...selection], "forward")),
			},
			{
				id: "backward",
				label: "Send backward",
				hint: "[",
				disabled: !has,
				run: () => onSceneChange((p) => reorderNodes(p, [...selection], "backward")),
			},
			{
				id: "back",
				label: "Send to back",
				hint: "⇧[",
				disabled: !has,
				run: () => onSceneChange((p) => reorderNodes(p, [...selection], "back")),
			},
			"separator",
			{
				id: "duplicate",
				label: "Duplicate",
				hint: "⌘D",
				disabled: !has,
				run: duplicate,
			},
			{
				id: "delete",
				label: "Delete",
				hint: "⌫",
				disabled: !has,
				run: () => {
					onSceneChange((prev) => deleteNodes(prev, [...selection]));
					setSelection(new Set());
				},
			},
		];
	}

	/** A short description of what this universe chose, for the grid caption. */
	function captionFor(universe: Universe) {
		const parts = [...varying]
			.map((variable) => {
				const index = universe.pick[variable];
				return index === undefined
					? null
					: `${labels.get(variable) ?? variable} ${index + 1}`;
			})
			.filter(Boolean);
		return parts.join(" · ") || "settled";
	}

	/** `prop(card,fill)` reads better as `card fill`. */
	const labels = useMemo(() => {
		const out = new Map<string, string>();
		for (const key of varying) {
			const parsed = parseVariable(key);
			if (!parsed) out.set(key, key);
			else if (parsed.kind === "prop") {
				out.set(key, `${byId.get(parsed.node)?.name ?? parsed.node} ${parsed.prop}`);
			} else {
				const token = scene.tokens.find((t) => t.id === parsed.token);
				out.set(key, token?.name ?? parsed.token);
			}
		}
		return out;
	}, [varying, byId, scene.tokens]);

	return (
		<div className={styles.studio}>
			<div className={styles.body}>
				<aside className={cx(styles.side, styles.left)}>
					<LayerList
						scene={scene}
						selection={selection}
						onSelectionChange={selectionIds}
						onSceneChange={onSceneChange}
						solved={primary?.solved}
						onContextMenu={(at, nodeId) => {
							// Right-clicking a layer outside the selection retargets it,
							// the way the canvas does.
							if (!selection.has(nodeId)) setSelection(new Set([nodeId]));
							const box = host.current?.getBoundingClientRect();
							setMenu({ x: at.x - (box?.left ?? 0), y: at.y - (box?.top ?? 0) });
						}}
					/>
				</aside>

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
							const place = layout.placements[i] ?? { x: 0, y: 0 };
							const editable = view === "design" && i === 0;
							const box = editable
								? region
								: {
										x: place.x,
										y: place.y,
										width: bounds.width,
										height: bounds.height,
									};
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
											varying={varying}
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
								{TOOLS.map((t) => (
									<button
										key={t.id}
										type="button"
										data-tool={t.id}
										className={cx(styles.tool, tool === t.id && styles.toolActive)}
										title={`${t.label} (${t.key})`}
										onClick={() => setTool(t.id)}
									>
										{t.label}
									</button>
								))}
							</div>
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
								pins={pins}
								onPin={pin}
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
							varyingCount={varying.size}
							selectionCount={selection.size}
						/>
					}
				/>
			</footer>
		</div>
	);
}
