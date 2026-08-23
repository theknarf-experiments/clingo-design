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
	dropTargetAt,
	frameAncestorOf,
	frameAt,
	frameFromPoints,
	framesIntersect,
	handleEdges,
	hitTestTree,
	isDrawable,
	isSurface,
	makeNode,
	makePath,
	managedNodes,
	normaliseFrame,
	parentMap,
	placedNodes,
	pointsBounds,
	reparent,
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
 * How near the first point a click must land to close a path, in screen
 * pixels — divided by the scale, so zooming does not change the target.
 */
const CLOSE_RADIUS = 10;

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
	/** Live pointer position, for the marquee, draw and pen rubber bands. */
	const [current, setCurrent] = useState<Point | null>(null);
	const [guides, setGuides] = useState<SnapGuide[]>([]);
	/**
	 * The container a move gesture would drop into, while it is live. Null both
	 * when there is no gesture and when the drop would change nothing.
	 */
	const [dropTarget, setDropTarget] = useState<string | null>(null);
	/**
	 * Points the pen has placed, in canvas coordinates. Null when it is not
	 * drawing — a path is several clicks, so unlike every other tool it has a
	 * state that outlives the pointer being down.
	 */
	const [pen, setPen] = useState<Point[] | null>(null);

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
			const world = placed.byId.get(id)?.world;
			if (world) start.set(id, { ...world });
		}
		if (start.size === 0) return;
		setGesture({ kind: "move", origin: point, start });
	}

	function targetFor(nodeId: string): string {
		return selectionTargetOf(scene.nodes, nodeId)?.id ?? nodeId;
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
				CLOSE_RADIUS / getScale()
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
	function finishPath(points: readonly Point[], closed: boolean) {
		setPen(null);
		setCurrent(null);
		onToolChange("select");
		// One point is a click, not a path.
		if (points.length < 2) return;

		const node = makePath(points, closed);
		const bounds = pointsBounds(points);
		// Like any other new node: it lands inside whichever surface it was
		// drawn over, judged by where its middle fell. Read through the ref
		// because a keypress can end a path several renders after the last one
		// this closure saw.
		const now = live.current;
		const host = bounds
			? (frameAt(
					now.scene.nodes,
					{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
					now.universe.solved,
				)?.node.id ?? null)
			: null;
		onSceneChange((prev) => addNodeTo(prev, host, node));
		onSelectionChange([node.id]);
	}

	function onPointerDown(event: React.PointerEvent) {
		if (event.button !== 0) return;
		// The canvas pans on empty space; anything the editor claims must not
		// also start a pan.
		event.stopPropagation();
		const point = toCanvas(event);

		if (tool !== "select") {
			if (KINDS[tool].plotted) placePoint(point);
			else {
				setGesture({ kind: "draw", nodeKind: tool, origin: point });
				setCurrent(point);
			}
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
		managed,
		toCanvas,
		targetFor,
	});
	live.current = {
		scene,
		selection,
		placed,
		preview,
		universe,
		managed,
		toCanvas,
		targetFor,
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
			);

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
				// Only worth showing when letting go would actually move the
				// nodes somewhere else in the tree.
				const drop = dropAt(point);
				setDropTarget(
					[...moving].some((id) => homeOf(id) !== drop.id) ? drop.id : null,
				);
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
					const at = originOf(now.placed.byId.get(id), now.universe.solved[id]);
					out.set(id, { ...world, x: world.x - at.x, y: world.y - at.y });
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
					let next = staying.size > 0 ? setFrames(prev, staying) : prev;
					let index = drop.index;
					for (const id of rehomed) {
						next = reparent(next, id, drop.id, index++, dropped);
					}
					return next;
				}, "geometry");
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

				// A drag up-right or down-left runs along the other diagonal of
				// the same box: the frame alone cannot say which, so the
				// direction of the gesture is what settles it.
				const node = makeNode(gesture.nodeKind, frame, {
					diagonal:
						(point.x - gesture.origin.x) * (point.y - gesture.origin.y) < 0
							? "up"
							: "down",
				});
				onSceneChange((prev) => addNodeTo(prev, host, node));
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

	/** Preview frames are absolute; the renderer wants each node's own space. */
	const renderPreview = useMemo(() => {
		if (!preview) return undefined;
		const out = new Map<string, Frame>();
		for (const [id, world] of preview) {
			const at = originOf(placed.byId.get(id), universe.solved[id]);
			out.set(id, { ...world, x: world.x - at.x, y: world.y - at.y });
		}
		return out;
	}, [preview, placed, universe.solved]);

	/** Top-level surfaces get a name tag, the way an artboard is labelled. */
	const topFrames = scene.nodes.filter(isSurface);

	return (
		<div
			ref={surface}
			className={styles.surface}
			data-role="editor"
			data-tool={tool}
			onPointerDown={onPointerDown}
			// Only while the pen is mid-path: every other tool tracks the
			// pointer from the window, and only once a button is down.
			onPointerMove={pen ? (e) => setCurrent(toCanvas(e)) : undefined}
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

			{dropHighlight ? (
				<div
					className={styles.dropTarget}
					data-drop-target={dropTarget}
					style={rectStyle(dropHighlight)}
				/>
			) : null}

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

			{pen ? (
				<svg className={styles.pen} aria-hidden="true">
					<polyline
						className={styles.penLine}
						points={[...pen, ...(current ? [current] : [])]
							.map((p) => `${p.x},${p.y}`)
							.join(" ")}
					/>
					{pen.map((p, i) => (
						<circle
							key={`${p.x},${p.y},${i}`}
							className={styles.penPoint}
							cx={p.x}
							cy={p.y}
							// The first point is the target that closes the path, so it
							// is the one worth aiming at.
							r={i === 0 ? 4 : 2.5}
						/>
					))}
				</svg>
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

/**
 * Where a node's parent sits, recovered from the placement.
 *
 * A placement is the parent's origin plus the frame the node was placed with —
 * and for a node the solver owns that is the *solved* frame, not the stored
 * one. Subtracting the stored frame instead would leave the difference between
 * the two folded into the origin, which is exactly how far a node dragged out
 * of a layout would land from where it was dropped.
 */
function originOf(placed: Placed | undefined, solved: Partial<Frame> | undefined): Point {
	if (!placed) return { x: 0, y: 0 };
	return {
		x: placed.world.x - (solved?.x ?? placed.node.frame.x),
		y: placed.world.y - (solved?.y ?? placed.node.frame.y),
	};
}

function rectStyle(frame: Frame) {
	return {
		left: frame.x,
		top: frame.y,
		width: frame.width,
		height: frame.height,
	};
}
