import { type CSSProperties, memo, useMemo } from "react";
import {
	type Frame,
	KINDS,
	type PropName,
	type Scene,
	type SceneNode,
	type Universe,
	isSurface,
	propValues,
	propVar,
	resolveValue,
} from "@clingo-design/design-core";

import styles from "./Artboard.module.css";

/**
 * How each property reaches CSS.
 *
 * Keyed by property rather than by node kind, so the renderer follows
 * `KINDS[kind].props` and a new kind needs no change here at all.
 */
const PAINT: Record<PropName, (value: string) => CSSProperties> = {
	fill: (value) => ({ background: value }),
	radius: (value) => ({ borderRadius: value }),
	ink: (value) => ({ color: value }),
	size: (value) => ({ fontSize: value }),
	weight: (value) => ({ fontWeight: value }),
};

export interface ArtboardProps {
	scene: Scene;
	universe: Universe;
	/** Overrides live geometry during a drag, before it is committed. */
	preview?: ReadonlyMap<string, Frame>;
	/** Variable keys the solver reports as unsettled, for the in-place marks. */
	varying?: ReadonlySet<string>;
	className?: string;
	style?: CSSProperties;
}

/**
 * Renders one universe of the document.
 *
 * Frames are positioned relative to their parent, which is exactly what nested
 * absolutely-positioned elements already do — so the render is a plain
 * recursion with no coordinate maths.
 *
 * Memoised because the editor above it re-renders on every pointermove, and
 * most gestures (marquee, draw) do not touch the document at all.
 */
export const Artboard = memo(function Artboard({
	scene,
	universe,
	preview,
	varying,
	className,
	style,
}: ArtboardProps) {
	// Derived values may read another node's property, so resolution needs the
	// whole document, not just the tokens.
	const context = useMemo(
		() => ({
			tokens: scene.tokens,
			picks: universe.pick,
			props: propValues(scene.nodes),
		}),
		[scene.tokens, scene.nodes, universe.pick],
	);

	function render(node: SceneNode) {
		const frame = preview?.get(node.id) ?? node.frame;
		const unsettled =
			varying !== undefined &&
			Object.keys(node.props).some((prop) => varying.has(propVar(node.id, prop)));

		const box: CSSProperties = {
			position: "absolute",
			left: frame.x,
			top: frame.y,
			width: frame.width,
			height: frame.height,
			boxSizing: "border-box",
		};

		// A surface is something you put things on: it has a ground, and it
		// clips whatever hangs over the edge.
		if (isSurface(node)) {
			box.background = "#ffffff";
			box.overflow = "hidden";
		}
		if (node.kind === "text") {
			box.lineHeight = 1.35;
			box.overflow = "hidden";
			box.whiteSpace = "pre-wrap";
		}

		for (const prop of KINDS[node.kind].props) {
			const value = resolveValue(context, node.props[prop], propVar(node.id, prop));
			if (value !== undefined) Object.assign(box, PAINT[prop](value));
		}

		return (
			<div
				key={node.id}
				data-node={node.id}
				data-kind={node.kind}
				data-varies={unsettled ? "" : undefined}
				className={unsettled ? `${styles.node} ${styles.varies}` : styles.node}
				style={box}
				title={unsettled ? "This property has more than one value" : undefined}
			>
				{node.kind === "text" ? node.text : null}
				{node.children?.map((child) =>
					universe.visible.has(child.id) ? render(child) : null,
				)}
			</div>
		);
	}

	return (
		<div
			className={className ? `${styles.artboard} ${className}` : styles.artboard}
			style={style}
			data-artboard=""
		>
			{scene.nodes.map((node) =>
				universe.visible.has(node.id) ? render(node) : null,
			)}
		</div>
	);
});
