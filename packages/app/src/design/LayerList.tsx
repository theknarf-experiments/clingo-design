import type { Scene, SceneNode } from "@clingo-design/design-core";

import styles from "./LayerList.module.css";
import { cx } from "./cx";

export interface LayerListProps {
	scene: Scene;
	selection: ReadonlySet<string>;
	onSelectionChange: (ids: string[]) => void;
}

const GLYPH: Record<SceneNode["kind"], string> = {
	frame: "⬚",
	rect: "▭",
	text: "T",
	group: "▣",
};

/**
 * The document tree, topmost first.
 *
 * Paint order runs bottom-to-top, so the list is reversed at every level to
 * match what the eye sees on the canvas.
 */
export function LayerList({
	scene,
	selection,
	onSelectionChange,
}: LayerListProps) {
	function rows(nodes: readonly SceneNode[], depth: number): React.ReactNode[] {
		return [...nodes].reverse().flatMap((node) => [
			<li key={node.id}>
				<button
					type="button"
					data-layer={node.id}
					data-depth={depth}
					className={cx(styles.layer, selection.has(node.id) && styles.selected)}
					style={{ paddingLeft: `${0.4 + depth * 0.75}rem` }}
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
				</button>
			</li>,
			...(node.children?.length ? rows(node.children, depth + 1) : []),
		]);
	}

	return (
		<div className={styles.layers} data-role="layers">
			<h2>Layers</h2>
			{scene.nodes.length === 0 ? (
				<p className={styles.empty}>Nothing yet.</p>
			) : (
				<ul className={styles.list}>{rows(scene.nodes, 0)}</ul>
			)}
		</div>
	);
}
