import { useEffect, useMemo, useRef, useState } from "react";
import {
	type Frame,
	HANDLES,
	HANDLE_CURSOR,
	type Handle,
	KINDS,
	type NodeKind,
	type Placed,
	type Point,
	type Scene,
	type SnapGuide,
	type Universe,
	addNodeTo,
	boundsOf,
	frameAncestorOf,
	frameAt,
	frameFromPoints,
	framesIntersect,
	handleEdges,
	hitTestTree,
	isDrawable,
	isSurface,
	makeNode,
	managedNodes,
	normaliseFrame,
	placedNodes,
	resizeFrame,
	resizeSubtree,
	selectionTargetOf,
	setFrames,
	snapFrame,
	wrapsChildren,
} from "@clingo-design/design-core";

import { Artboard } from "./Artboard";
import styles from "./Editor.module.css";

export type Tool = "select" | NodeKind;

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
	| { kind: "draw"; nodeKind: NodeKind; origin: Point };

export interface EditorProps {
	scene: Scene;
	universe: Universe;
	selection: ReadonlySet<string>;
	onSelectionChange: (ids: string[]) => void;
	/** `coalesce` groups a gesture's updates into one undo entry. */
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	tool: Tool;
	onToolChange: (tool: Tool) => void;
	/** Canvas scale, so pointer deltas convert to document units. */
	getScale: () => number;
	/**
	 * Canvas coordinate of this surface's top-left corner. Content is drawn
	 * translated by its negation, so a node at document x always lands at
	 * document x on screen no matter where the surface itself sits.
	 */
	origin: Point;
	/** Variable keys that are not settled, for the in-place overlay. */
	varying?: ReadonlySet<string>;
	/** Right-click, in client coordinates. */
	onContextMenu?: (at: { x: number; y: number }) => void;
}

/**
 * The editing surface laid over the document.
 *
 * Node frames are relative to their parent, but every pointer gesture happens
 * in canvas space, so the editor works in absolute frames throughout and
 * converts back once, on commit. Keeping the conversion at that one boundary
 * is what stops coordinate bugs leaking into the drag maths.
 */
export function Editor({
	scene,
	universe,
	selection,
	onSelectionChange,
	onSceneChange,
	tool,
	onToolChange,
	getScale,
	origin,
	varying,
	onContextMenu,
}: EditorProps) {
	const surface = useRef<HTMLDivElement>(null);
	const [gesture, setGesture] = useState<Gesture>({ kind: "none" });
	/** Absolute frames while a gesture is live. */
	const [preview, setPreview] = useState<Map<string, Frame> | null>(null);
	/** Live pointer position, for the marquee and draw rubber bands. */
	const [current, setCurrent] = useState<Point | null>(null);
	const [guides, setGuides] = useState<SnapGuide[]>([]);

	/**
	 * Every node's absolute frame, indexed by id.
	 *
	 * Memoised on the tree rather than recomputed per render: the editor
	 * re-renders on every pointermove, and both the drag maths and the commit
	 * conversion look up nodes by id, which would otherwise be a tree walk each.
	 */
	const placed = useMemo(() => {
		const list = placedNodes(scene.nodes, universe.solved);
		return { list, byId: new Map(list.map((p) => [p.node.id, p])) };
	}, [scene.nodes, universe.solved]);

	/** Nodes an automatic layout owns, which the pointer must not move. */
	const managed = useMemo(() => managedNodes(scene.nodes), [scene.nodes]);

	/** Pointer position in canvas coordinates. */
	function toCanvas(event: { clientX: number; clientY: number }): Point {
		const rect = surface.current?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		const scale = getScale();
		return {
			x: (event.clientX - rect.left) / scale + origin.x,
			y: (event.clientY - rect.top) / scale + origin.y,
		};
	}

	const selected = [...selection]
		.map((id) => placed.byId.get(id))
		.filter((p): p is Placed => p !== undefined);

	function beginMove(point: Point, ids: ReadonlySet<string>) {
		const start = new Map<string, Frame>();
		for (const id of ids) {
			// A laid-out node would spring back on the next solve, so dragging
			// it is not a thing the editor offers.
			if (managed.has(id)) continue;
			const world = placed.byId.get(id)?.world;
			if (world) start.set(id, { ...world });
		}
		if (start.size === 0) return;
		setGesture({ kind: "move", origin: point, start });
	}

	function targetFor(nodeId: string): string {
		return selectionTargetOf(scene.nodes, nodeId)?.id ?? nodeId;
	}

	function onPointerDown(event: React.PointerEvent) {
		if (event.button !== 0) return;
		// The canvas pans on empty space; anything the editor claims must not
		// also start a pan.
		event.stopPropagation();
		const point = toCanvas(event);

		if (tool !== "select") {
			setGesture({ kind: "draw", nodeKind: tool, origin: point });
			setCurrent(point);
			return;
		}

		const hit = hitTestTree(scene.nodes, point, universe.solved);
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

	/** Double-click reaches through a group or into a frame, to the leaf. */
	function onDoubleClick(event: React.MouseEvent) {
		if (tool !== "select") return;
		const hit = hitTestTree(scene.nodes, toCanvas(event), universe.solved);
		if (!hit) return;
		event.stopPropagation();
		onSelectionChange([hit.node.id]);
	}

	function onContext(event: React.MouseEvent) {
		if (!onContextMenu) return;
		event.preventDefault();
		event.stopPropagation();
		const hit = hitTestTree(scene.nodes, toCanvas(event), universe.solved);
		const targetId = hit ? targetFor(hit.node.id) : null;
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
			origin: toCanvas(event),
			start: { ...selected[0].world },
			id: selected[0].node.id,
		});
	}

	/**
	 * Everything the gesture handlers read but must not re-subscribe for.
	 *
	 * Only `up` needs these, and only once, so keeping them in a ref is what
	 * lets the effect below depend on the gesture alone.
	 */
	const live = useRef({ scene, selection, placed, preview, universe, toCanvas, targetFor });
	live.current = { scene, selection, placed, preview, universe, toCanvas, targetFor };

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

		let moved = false;

		const move = (event: PointerEvent) => {
			const point = live.current.toCanvas(event);

			if (gesture.kind === "move") {
				const dx = point.x - gesture.origin.x;
				const dy = point.y - gesture.origin.y;
				const next = new Map<string, Frame>();
				for (const [id, frame] of gesture.start) {
					next.set(id, { ...frame, x: frame.x + dx, y: frame.y + dy });
				}
				// Snap the selection as a block, using its bounds.
				const bounds = boundsOf([...next.values()]);
				let snapped: SnapGuide[] = [];
				if (bounds && !event.altKey) {
					const result = snapFrame(bounds, { targets, container });
					const ddx = result.frame.x - bounds.x;
					const ddy = result.frame.y - bounds.y;
					for (const [id, frame] of next) {
						next.set(id, { ...frame, x: frame.x + ddx, y: frame.y + ddy });
					}
					snapped = result.guides;
				}
				for (const [id, frame] of next) next.set(id, normaliseFrame(frame));
				setPreview(next);
				setGuides(snapped);
				if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved = true;
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
						{ targets, container },
						handleEdges(gesture.handle),
					);
					frame = result.frame;
					snapped = result.guides;
				}
				setPreview(new Map([[gesture.id, normaliseFrame(frame)]]));
				setGuides(snapped);
				return;
			}

			setCurrent(point);
		};

		const up = (event: PointerEvent) => {
			const now = live.current;
			const point = now.toCanvas(event);
			const preview = now.preview;

			/** Absolute frames back into each node's own parent space. */
			const toLocal = (frames: ReadonlyMap<string, Frame>) => {
				const out = new Map<string, Frame>();
				for (const [id, world] of frames) {
					// The parent's origin is already implied by the placement: a
					// node's own frame is its world position minus that origin.
					const from = now.placed.byId.get(id);
					const ox = from ? from.world.x - from.node.frame.x : 0;
					const oy = from ? from.world.y - from.node.frame.y : 0;
					out.set(id, { ...world, x: world.x - ox, y: world.y - oy });
				}
				return out;
			};

			if (gesture.kind === "resize" && preview) {
				const next = preview.get(gesture.id);
				const frame = next
					? toLocal(new Map([[gesture.id, next]])).get(gesture.id)
					: undefined;
				if (frame) {
					onSceneChange(
						(prev) => resizeSubtree(prev, gesture.id, frame),
						"geometry",
					);
				}
			} else if (gesture.kind === "move" && preview && moved) {
				const local = toLocal(preview);
				onSceneChange((prev) => setFrames(prev, local), "geometry");
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
				if (frame.width < 4 || frame.height < 4) {
					frame = {
						x: gesture.origin.x,
						y: gesture.origin.y,
						...KINDS[gesture.nodeKind].defaultSize,
					};
				}
				if (!event.altKey) {
					frame = snapFrame(frame, { targets }).frame;
				}

				// A surface is drawn on the canvas; anything else lands inside
				// whichever surface it was drawn over.
				const host = KINDS[gesture.nodeKind].surface
					? null
					: (frameAt(
							now.scene.nodes,
							{ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
							now.universe.solved,
						)?.node.id ?? null);

				const node = makeNode(gesture.nodeKind, frame);
				onSceneChange((prev) => addNodeTo(prev, host, node));
				onSelectionChange([node.id]);
				onToolChange("select");
			}

			setGesture({ kind: "none" });
			setPreview(null);
			setCurrent(null);
			setGuides([]);
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

	/** Preview frames are absolute; the renderer wants each node's own space. */
	const renderPreview = useMemo(() => {
		if (!preview) return undefined;
		const out = new Map<string, Frame>();
		for (const [id, world] of preview) {
			const from = placed.byId.get(id);
			const ox = from ? from.world.x - from.node.frame.x : 0;
			const oy = from ? from.world.y - from.node.frame.y : 0;
			out.set(id, { ...world, x: world.x - ox, y: world.y - oy });
		}
		return out;
	}, [preview, placed]);

	/** Top-level surfaces get a name tag, the way an artboard is labelled. */
	const topFrames = scene.nodes.filter(isSurface);

	return (
		<div
			ref={surface}
			className={styles.surface}
			data-role="editor"
			data-tool={tool}
			onPointerDown={onPointerDown}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContext}
		>
			<div
				className={styles.content}
				style={{ left: -origin.x, top: -origin.y }}
			>
			<Artboard
				scene={scene}
				universe={universe}
				preview={renderPreview}
				varying={varying}
			/>

			{topFrames.map((node) => (
				<button
					key={`label-${node.id}`}
					type="button"
					className={styles.frameLabel}
					data-frame-label={node.id}
					data-selected={selection.has(node.id) ? "" : undefined}
					style={{
						left: (preview?.get(node.id) ?? placed.byId.get(node.id)?.world ?? node.frame).x,
						top: (preview?.get(node.id) ?? placed.byId.get(node.id)?.world ?? node.frame).y,
					}}
					onPointerDown={(e) => {
						e.stopPropagation();
						onSelectionChange([node.id]);
						beginMove(toCanvas(e), new Set([node.id]));
					}}
				>
					{node.name}
				</button>
			))}

			{guides.map((guide, i) => (
				<div
					key={i}
					className={styles.guide}
					data-guide={guide.axis}
					style={
						guide.axis === "x"
							? { left: guide.at, top: guide.from, height: guide.to - guide.from }
							: { top: guide.at, left: guide.from, width: guide.to - guide.from }
					}
				/>
			))}

			{selected.map((p) => (
				<div
					key={p.node.id}
					className={
						wrapsChildren(p.node)
							? `${styles.outline} ${styles.groupOutline}`
							: styles.outline
					}
					data-outline={p.node.id}
					style={rectStyle(preview?.get(p.node.id) ?? p.world)}
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

			{marquee ? (
				<div
					className={gesture.kind === "draw" ? styles.drawing : styles.marquee}
					style={rectStyle(marquee)}
				/>
			) : null}
			</div>
		</div>
	);
}

function rectStyle(frame: Frame) {
	return {
		left: frame.x,
		top: frame.y,
		width: frame.width,
		height: frame.height,
	};
}
