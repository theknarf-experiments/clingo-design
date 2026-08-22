import { useRef, useState } from "react";
import {
	type Scene,
	type SceneNode,
	isLaidOut,
	moveWithinParent,
} from "@clingo-design/design-core";

import styles from "./LayerList.module.css";
import { cx } from "./cx";

export interface LayerListProps {
	scene: Scene;
	selection: ReadonlySet<string>;
	onSelectionChange: (ids: string[]) => void;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
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

/** Where a drop would land: before or after a row, in *document* order. */
interface Drop {
	parent: string | null;
	index: number;
	/** The row the indicator is drawn against, and which edge. */
	rowId: string;
	edge: "above" | "below";
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
	onContextMenu,
}: LayerListProps) {
	const [dragging, setDragging] = useState<string | null>(null);
	const [drop, setDrop] = useState<Drop | null>(null);
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

	/** The drop the pointer is currently over, if it is a legal one. */
	function dropAt(clientY: number, sourceId: string): Drop | null {
		const source = rowOf(sourceId);
		if (!source) return null;
		const elements = list.current?.querySelectorAll("[data-layer]") ?? [];
		for (const element of elements) {
			const id = (element as HTMLElement).dataset.layer as string;
			const row = rowOf(id);
			// Only among its own siblings: moving between parents would have to
			// rebase coordinates, which a list of names cannot show.
			if (!row || row.parent !== source.parent || id === sourceId) continue;
			const box = element.getBoundingClientRect();
			if (clientY < box.top || clientY > box.bottom) continue;
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
			setDrop(dropAt(e.clientY, id));
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			if (started) {
				// Read the target off state at commit time: `drop` in this
				// closure is whatever it was when the drag began.
				setDrop((target) => {
					if (target) {
						onSceneChange((prev) => moveWithinParent(prev, id, target.index));
					}
					return null;
				});
			}
			setDragging(null);
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
