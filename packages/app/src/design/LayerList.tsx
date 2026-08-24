import { useRef, useState } from "react";
import {
	type ComponentDef,
	type DerivedNode,
	type Frame,
	KINDS,
	type Scene,
	type SceneNode,
	addInstance,
	componentDefs,
	isLaidOut,
	partLabel,
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
	/**
	 * Nodes the answer set has that the document does not — see `derived.ts`.
	 *
	 * They are listed because a picture with things in it that no layer accounts
	 * for is a picture you cannot read. They are not draggable, not reorderable
	 * and not drop targets, because there is nothing in the document to move.
	 */
	derived?: readonly DerivedNode[];
	/**
	 * Derived ids that every universe has. One that is absent is marked, since
	 * a node that comes and goes with the design is a different thing from one
	 * that is simply there.
	 */
	everywhere?: ReadonlySet<string>;
	/** Right-click, in client coordinates, on the node under the pointer. */
	onContextMenu?: (at: { x: number; y: number }, nodeId: string) => void;
}

const GLYPH: Record<SceneNode["kind"], string> = {
	frame: "⬚",
	rect: "▭",
	ellipse: "◯",
	line: "╱",
	arrow: "↗",
	path: "∿",
	text: "T",
	group: "▣",
	instance: "◈",
};

interface DocRow {
	kind: "doc";
	node: SceneNode;
	depth: number;
	/** Null at the top level. */
	parent: string | null;
	/** Position among its siblings, in paint order. */
	index: number;
}

/** A row for something only a rule says exists. */
interface DerivedRow {
	kind: "derived";
	derived: DerivedNode;
	depth: number;
}

type Row = DocRow | DerivedRow;

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
	derived = [],
	everywhere,
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

	/**
	 * Derived nodes by the parent they hang from, so each one appears under
	 * whatever `child/2` put it in rather than in a heap at the bottom.
	 */
	const derivedUnder = new Map<string | null, DerivedNode[]>();
	for (const node of derived) {
		const siblings = derivedUnder.get(node.parent);
		if (siblings) siblings.push(node);
		else derivedUnder.set(node.parent, [node]);
	}

	const rows: Row[] = [];
	/**
	 * A derived subtree, under whatever it hangs from.
	 *
	 * Not reversed the way the document rows are: paint order among derived
	 * siblings is `order/2`, which nothing in this panel can change, so
	 * presenting them in the order the rule produced them reads better than
	 * presenting them upside down.
	 */
	const collectDerived = (parent: string | null, depth: number) => {
		for (const node of derivedUnder.get(parent) ?? []) {
			rows.push({ kind: "derived", derived: node, depth });
			collectDerived(node.node.id, depth + 1);
		}
	};
	const collect = (
		nodes: readonly SceneNode[],
		depth: number,
		parent: string | null,
	) => {
		[...nodes].reverse().forEach((node) => {
			rows.push({ kind: "doc", node, depth, parent, index: nodes.indexOf(node) });
			if (node.children?.length) collect(node.children, depth + 1, node.id);
			collectDerived(node.id, depth + 1);
		});
	};
	collect(scene.nodes, 0, null);
	collectDerived(null, 0);

	const defs = componentDefs(scene);
	const defNames = new Map(defs.map((d) => [d.root.id, d.name] as const));

	const rowOf = (id: string): DocRow | undefined =>
		rows.find((r): r is DocRow => r.kind === "doc" && r.node.id === id);

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

	/**
	 * A row for a node only a rule says exists.
	 *
	 * Selectable, so the inspector can show what it resolved to, and nothing
	 * else: no pointerdown drag, and no `data-layer`, which is what keeps it out
	 * of the drop search above without that search having to know about it.
	 */
	function derivedRow({ derived: node, depth }: DerivedRow) {
		const id = node.node.id;
		const sometimes = everywhere !== undefined && !everywhere.has(id);
		// A part of a component instance is derived like anything else, but its
		// id is `inst(one,label)` and nobody reads that. It has a name in the
		// definition, and that is what to show.
		const part = partLabel(scene, id);
		return (
			<li key={id}>
				<button
					type="button"
					data-derived-layer={id}
					data-depth={depth}
					className={cx(
						styles.layer,
						styles.derived,
						selection.has(id) && styles.selected,
					)}
					style={{ paddingLeft: `${0.4 + depth * 0.75}rem` }}
					title={
						part
							? `From the component definition — ${id}`
							: `Derived by a rule — ${id}`
					}
					onClick={() => onSelectionChange([id])}
				>
					<span className={styles.kind} aria-hidden="true">
						{GLYPH[node.node.kind]}
					</span>
					<span className={styles.label}>{part ?? id}</span>
					<span
						className={styles.badge}
						title={
							sometimes
								? "A rule derives this node, and not in every design"
								: part
									? "The definition produces this node; the document does not hold it"
									: "A rule derives this node; the document does not hold it"
						}
					>
						{sometimes ? "sometimes" : part ? "from definition" : "derived"}
					</span>
				</button>
			</li>
		);
	}

	/**
	 * The components the document defines, with a way to place one.
	 *
	 * A definition is an ordinary subtree, so it is already in the list above —
	 * but scrolling a tree looking for the thing you want a second copy of is
	 * not how anyone works. This is the shelf.
	 */
	function shelf(defs: readonly ComponentDef[]) {
		return (
			<div className={styles.shelf} data-role="components">
				<h2>Components</h2>
				<ul className={styles.list}>
					{defs.map((def) => (
						<li key={def.root.id} className={styles.shelfRow}>
							<button
								type="button"
								data-component={def.root.id}
								className={cx(
									styles.layer,
									selection.has(def.root.id) && styles.selected,
								)}
								title="Select the definition"
								onClick={() => onSelectionChange([def.root.id])}
							>
								<span className={styles.kind} aria-hidden="true">
									◈
								</span>
								<span className={styles.label}>{def.name}</span>
							</button>
							<button
								type="button"
								className={styles.place}
								data-place={def.root.id}
								title={`Place an instance of ${def.name}`}
								onClick={() => {
									let created: string | null = null;
									onSceneChange((prev) => {
										const result = addInstance(prev, def.root.id);
										created = result.id;
										return result.scene;
									});
									if (created) onSelectionChange([created]);
								}}
							>
								+
							</button>
						</li>
					))}
				</ul>
			</div>
		);
	}

	return (
		<div className={styles.layers} data-role="layers">
			<h2>Layers</h2>
			{rows.length === 0 ? (
				<p className={styles.empty}>Nothing yet.</p>
			) : (
				<ul className={styles.list} ref={list}>
					{rows.map((row) => {
						if (row.kind === "derived") return derivedRow(row);
						const { node, depth } = row;
						return (
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
									{/* What a row *is* comes before what it does: an instance
									    that reads as a plain frame is the one thing that
									    makes a component unreadable. */}
									{node.instanceOf !== undefined ? (
										<span
											className={styles.badge}
											data-role="instance-badge"
											title={`An instance of ${defNames.get(node.instanceOf) ?? node.instanceOf}`}
										>
											{defNames.has(node.instanceOf)
												? `of ${defNames.get(node.instanceOf)}`
												: "orphan"}
										</span>
									) : node.component ? (
										<span
											className={styles.badge}
											data-role="component-badge"
											title="A component definition: this subtree is a design space, and every instance is a point in it"
										>
											component
										</span>
									) : isLaidOut(node) ? (
										<span
											className={styles.badge}
											title="Children are arranged automatically"
										>
											auto
										</span>
									) : null}
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{defs.length > 0 ? shelf(defs) : null}
		</div>
	);
}
