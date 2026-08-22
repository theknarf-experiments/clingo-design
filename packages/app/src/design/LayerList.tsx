import { useRef, useState } from "react";
import {
	type Frame,
	KINDS,
	type Scene,
	type SceneNode,
	isLaidOut,
	reparent,
} from "@clingo-design/design-core";

import styles from "./LayerList.module.css";
import { cx } from "./cx";

export interface LayerListProps {
	scene: Scene;
	selection: ReadonlySet<string>;
	onSelectionChange: (ids: string[]) => void;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/**
	 * Geometry from the current universe. A node dragged out of an automatic
	 * layout keeps where the solver put it, which is only knowable from here.
	 */
	solved?: Readonly<Record<string, Partial<Frame>>>;
	/** Right-click, in client coordinates, on the node under the pointer. */
	onContextMenu?: (at: { x: number; y: number }, nodeId: string) => void;
}

const GLYPH: Record<SceneNode["kind"], string> = {
	frame: "⬚",
	rect: "▭",
	text: "T",
	group: "▣",
};

interface Row {
	node: SceneNode;
	depth: number;
	/** Null at the top level. */
	parent: string | null;
	/** Position among its siblings, in paint order. */
	index: number;
}

/**
 * Where a drop would land.
 *
 * The middle of a container means *into* it and the edges mean beside the row,
 * which is the usual tree-drag bargain: one gesture that can both reorder and
 * reparent, distinguished by where in the row you let go.
 */
interface Drop {
	parent: string | null;
	index: number;
	rowId: string;
	edge: "above" | "below" | "inside";
}

/**
 * The document tree, topmost first.
 *
 * Paint order runs bottom-to-top, so the list is reversed at every level to
 * match what the eye sees on the canvas — which is also why a drag upwards
 * here is a move *later* in the sibling list.
 */
export function LayerList({
	scene,
	selection,
	onSelectionChange,
	onSceneChange,
	solved,
	onContextMenu,
}: LayerListProps) {
	const [dragging, setDragging] = useState<string | null>(null);
	const [drop, setDrop] = useState<Drop | null>(null);
	/**
	 * The same target as `drop`, for the commit to read.
	 *
	 * Not read out of state with an updater: React may call one twice, and a
	 * second `reparent` would apply the now-stale solved geometry to a node it
	 * has already moved.
	 */
	const target = useRef<Drop | null>(null);
	const list = useRef<HTMLUListElement>(null);

	const rows: Row[] = [];
	const collect = (
		nodes: readonly SceneNode[],
		depth: number,
		parent: string | null,
	) => {
		[...nodes].reverse().forEach((node) => {
			rows.push({ node, depth, parent, index: nodes.indexOf(node) });
			if (node.children?.length) collect(node.children, depth + 1, node.id);
		});
	};
	collect(scene.nodes, 0, null);

	const rowOf = (id: string) => rows.find((r) => r.node.id === id);

	/** Ids the dragged node contains, which it cannot be dropped into. */
	function subtreeOf(id: string): Set<string> {
		const out = new Set<string>();
		const walk = (node: SceneNode) => {
			out.add(node.id);
			for (const child of node.children ?? []) walk(child);
		};
		const row = rowOf(id);
		if (row) walk(row.node);
		return out;
	}

	/** The drop the pointer is currently over, if it is a legal one. */
	function dropAt(clientY: number, sourceId: string): Drop | null {
		const forbidden = subtreeOf(sourceId);
		const elements = list.current?.querySelectorAll("[data-layer]") ?? [];
		for (const element of elements) {
			const id = (element as HTMLElement).dataset.layer as string;
			const row = rowOf(id);
			if (!row) continue;
			const box = element.getBoundingClientRect();
			if (clientY < box.top || clientY > box.bottom) continue;

			// Dropping into a container: the middle half of its row, as long as
			// it is not the dragged node or something inside it.
			const container = KINDS[row.node.kind].container;
			const edge = box.height * (container ? 0.28 : 0.5);
			if (container && !forbidden.has(id)) {
				if (clientY > box.top + edge && clientY < box.bottom - edge) {
					return {
						parent: id,
						index: row.node.children?.length ?? 0,
						rowId: id,
						edge: "inside",
					};
				}
			}

			// Otherwise beside it — but never beside a node inside the one being
			// dragged, which would be a move into itself.
			if (forbidden.has(id) || (row.parent && forbidden.has(row.parent))) {
				continue;
			}
			const above = clientY < box.top + box.height / 2;
			return {
				parent: row.parent,
				// Displayed order is reversed, so dropping above a row puts the
				// node *after* it in paint order.
				index: above ? row.index + 1 : row.index,
				rowId: id,
				edge: above ? "above" : "below",
			};
		}
		return null;
	}

	function onPointerDown(event: React.PointerEvent, id: string) {
		if (event.button !== 0) return;
		const startY = event.clientY;
		let started = false;

		const move = (e: PointerEvent) => {
			if (!started && Math.abs(e.clientY - startY) < 4) return;
			if (!started) {
				started = true;
				setDragging(id);
			}
			const found = dropAt(e.clientY, id);
			target.current = found;
			setDrop(found);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			const landing = target.current;
			target.current = null;
			setDrop(null);
			setDragging(null);
			if (started && landing) {
				onSceneChange((prev) =>
					reparent(prev, id, landing.parent, landing.index, solved),
				);
			}
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}

	return (
		<div className={styles.layers} data-role="layers">
			<h2>Layers</h2>
			{scene.nodes.length === 0 ? (
				<p className={styles.empty}>Nothing yet.</p>
			) : (
				<ul className={styles.list} ref={list}>
					{rows.map(({ node, depth }) => (
						<li key={node.id}>
							<button
								type="button"
								data-layer={node.id}
								data-depth={depth}
								data-dragging={dragging === node.id ? "" : undefined}
								data-drop={
									drop?.rowId === node.id ? drop.edge : undefined
								}
								className={cx(
									styles.layer,
									selection.has(node.id) && styles.selected,
									dragging === node.id && styles.dragging,
									drop?.rowId === node.id && drop.edge === "above" && styles.dropAbove,
									drop?.rowId === node.id && drop.edge === "below" && styles.dropBelow,
									drop?.rowId === node.id && drop.edge === "inside" && styles.dropInside,
								)}
								style={{ paddingLeft: `${0.4 + depth * 0.75}rem` }}
								onPointerDown={(e) => onPointerDown(e, node.id)}
								onContextMenu={(e) => {
									if (!onContextMenu) return;
									e.preventDefault();
									onContextMenu({ x: e.clientX, y: e.clientY }, node.id);
								}}
								onClick={(e) => {
									if (e.shiftKey) {
										const next = new Set(selection);
										if (next.has(node.id)) next.delete(node.id);
										else next.add(node.id);
										onSelectionChange([...next]);
									} else {
										onSelectionChange([node.id]);
									}
								}}
							>
								<span className={styles.kind} aria-hidden="true">
									{GLYPH[node.kind]}
								</span>
								<span className={styles.label}>{node.name}</span>
								{isLaidOut(node) ? (
									<span
										className={styles.badge}
										title="Children are arranged automatically"
									>
										auto
									</span>
								) : null}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
