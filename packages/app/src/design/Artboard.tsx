import { type CSSProperties, type ReactNode, memo, useMemo } from "react";
import {
	type Frame,
	KINDS,
	type NodeKind,
	type PropName,
	type Scene,
	type SceneNode,
	type Universe,
	isSurface,
	propValues,
	propVar,
	resolveValue,
	scalePoints,
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
	// Both inherit in CSS, so an SVG inside the box picks them up on its own
	// rather than being handed them.
	stroke: (value) => ({ stroke: value }),
	strokeWidth: (value) => ({ strokeWidth: value }),
	ink: (value) => ({ color: value }),
	size: (value) => ({ fontSize: value }),
	weight: (value) => ({ fontWeight: value }),
};

interface ShapeSpec {
	/** Merged into the box before the node's own properties paint over it. */
	box?: CSSProperties;
	/** Overrides {@link PAINT} where a kind takes a property somewhere else. */
	paint?: Partial<Record<PropName, (value: string) => CSSProperties>>;
	/** Drawn inside the box. */
	content?: (node: SceneNode, frame: Frame) => ReactNode;
}

/**
 * What each kind draws beyond a coloured box.
 *
 * One table, for the same reason `KINDS` is one: a kind that needs its own
 * markup gets an entry, and everything else falls through to the plain box.
 */
const SHAPES: Partial<Record<NodeKind, ShapeSpec>> = {
	text: {
		box: { lineHeight: 1.35, overflow: "hidden", whiteSpace: "pre-wrap" },
		content: (node) => node.text,
	},
	// Fully rounded corners *are* an ellipse; an SVG for it would only add a
	// second way to size the same box.
	ellipse: { box: { borderRadius: "50%" } },
	line: { content: (node, frame) => <Stroke node={node} frame={frame} /> },
	arrow: {
		content: (node, frame) => <Stroke node={node} frame={frame} head />,
	},
	path: {
		// A path's fill belongs to the polygon, not to the box around it: the
		// box is only the vertices' bounding rectangle and painting it would
		// show a shape the document does not contain.
		paint: { fill: (value) => ({ fill: value }) },
		content: (node, frame) => <Plot node={node} frame={frame} />,
	},
};

/**
 * A line across the node's box, optionally with a head.
 *
 * Drawn in the box's own pixel units rather than a scaled viewBox, so a
 * stretched frame does not stretch the stroke with it.
 */
function Stroke({
	node,
	frame,
	head,
}: { node: SceneNode; frame: Frame; head?: boolean }) {
	const up = node.diagonal === "up";
	const y1 = up ? frame.height : 0;
	const y2 = up ? 0 : frame.height;
	return (
		<svg className={styles.stroke} aria-hidden="true">
			<line
				x1={0}
				y1={y1}
				x2={frame.width}
				y2={y2}
				strokeLinecap="round"
				fill="none"
			/>
			{head ? (
				<polyline
						points={arrowHead(0, y1, frame.width, y2)}
					strokeLinecap="round"
					strokeLinejoin="round"
					fill="none"
				/>
			) : null}
		</svg>
	);
}

/**
 * A path's vertices, joined up.
 *
 * They are stored against the frame the node was drawn at, but the frame it is
 * *rendered* at can differ — a live resize, or a stretch under an automatic
 * layout — so they are scaled into whichever one arrived here.
 */
function Plot({ node, frame }: { node: SceneNode; frame: Frame }) {
	const points = scalePoints(node.points ?? [], node.frame, frame)
		.map((p) => `${p.x},${p.y}`)
		.join(" ");
	if (!points) return null;
	return (
		<svg className={styles.stroke} aria-hidden="true">
			{node.closed ? (
				<polygon points={points} strokeLinejoin="round" />
			) : (
				// An open run of segments is a stroke, not a shape: filling
				// across the gap between its ends would draw an edge that is
				// not there. Inline, so it beats the inherited fill.
				<polyline
					points={points}
					style={{ fill: "none" }}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
		</svg>
	);
}

/**
 * The two barbs at the far end of an arrow, as a polyline.
 *
 * A `<marker>` would be the textbook answer, but a marker needs an id per node
 * and does not inherit the stroke it is attached to; two more stroked segments
 * take the colour and thickness from the same place the line does.
 */
function arrowHead(x1: number, y1: number, x2: number, y2: number): string {
	const length = Math.hypot(x2 - x1, y2 - y1);
	if (length === 0) return "";
	const ux = (x2 - x1) / length;
	const uy = (y2 - y1) / length;
	const back = Math.min(Math.max(length * 0.3, 8), 24);
	const half = back * 0.45;
	// The tip is the line's far end; the barbs sit back along it, either side.
	const bx = x2 - ux * back;
	const by = y2 - uy * back;
	return `${bx - uy * half},${by + ux * half} ${x2},${y2} ${bx + uy * half},${by - ux * half}`;
}

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
		// Solved geometry wins over the stored frame; a live drag wins over both.
		const solved = universe.solved[node.id];
		const frame =
			preview?.get(node.id) ??
			(solved ? { ...node.frame, ...solved } : node.frame);
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
		const shape = SHAPES[node.kind];
		if (shape?.box) Object.assign(box, shape.box);

		for (const prop of KINDS[node.kind].props) {
			const value = resolveValue(context, node.props[prop], propVar(node.id, prop));
			const paint = shape?.paint?.[prop] ?? PAINT[prop];
			if (value !== undefined) Object.assign(box, paint(value));
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
				{shape?.content?.(node, frame)}
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
