import { type CSSProperties, type ReactNode, memo, useMemo } from "react";
import {
	type Frame,
	type ModelNode,
	type NodeKind,
	type Scene,
	type SceneNode,
	type Universe,
	DOCUMENT_BASE,
	arrowHead,
	diagonalRun,
	flatten,
	frameOf,
	paintOf,
	pathData,
	propVar,
	scalePoints,
} from "@clingo-design/design-core";

import styles from "./Artboard.module.css";

/**
 * The two things the answer set does not carry, with the box they were authored
 * against.
 *
 * A path's vertices are stored relative to the frame the node was *drawn* at,
 * and that frame is a value now — so the number to scale them from has to be
 * resolved in this universe rather than read off the document as a plain
 * rectangle.
 */
interface DocShape {
	node: SceneNode;
	/** The frame the vertices were authored against, in this universe. */
	authored: Frame;
}

/**
 * What each kind draws *inside* its box.
 *
 * How a box is painted is no longer here: that mapping is shared with the
 * exporter and lives in design-core's `paint.ts`, because a second copy of
 * "a fill is a background" is a copy that drifts from the canvas. What stays is
 * the markup, which is React on this side and a string on the other and has
 * nothing to factor out.
 *
 * `node` is the answer set's account of it; `doc` is the document node it came
 * from, present only for the vertices and the lean — see {@link Artboard}.
 */
const CONTENT: Partial<
	Record<
		NodeKind,
		(node: ModelNode, frame: Frame, doc: DocShape | undefined) => ReactNode
	>
> = {
	// Content is a property like any other, so it arrives resolved for this
	// universe with everything else — which is what lets a headline differ
	// between them.
	text: (node) => node.rendered.text,
	line: (_node, frame, doc) => <Stroke frame={frame} doc={doc} />,
	arrow: (_node, frame, doc) => <Stroke frame={frame} doc={doc} head />,
	path: (_node, frame, doc) => <Plot frame={frame} doc={doc} />,
};

/**
 * A line across the node's box, optionally with a head.
 *
 * Drawn in the box's own pixel units rather than a scaled viewBox, so a
 * stretched frame does not stretch the stroke with it.
 */
function Stroke({
	frame,
	doc,
	head,
}: { frame: Frame; doc: DocShape | undefined; head?: boolean }) {
	const { y1, y2 } = diagonalRun(frame, doc?.node.diagonal);
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
function Plot({ frame, doc }: { frame: Frame; doc: DocShape | undefined }) {
	if (!doc) return null;
	const d = pathData(
		scalePoints(doc.node.points ?? [], doc.authored, frame),
		doc.node.closed,
	);
	if (!d) return null;
	return (
		<svg className={styles.stroke} aria-hidden="true">
			<path
				d={d}
				// An open run of segments is a stroke, not a shape: filling
				// across the gap between its ends would draw an edge that is
				// not there. Inline, so it beats the inherited fill.
				style={doc.node.closed ? undefined : { fill: "none" }}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export interface ArtboardProps {
	/**
	 * The document. Only the vertices of a plotted node and the lean of a
	 * diagonal one are read from it — see {@link Artboard}.
	 */
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
 * What it draws is `universe.model`: the tree, the paint order, the frames and
 * the final text of every property, read straight out of the answer set. The
 * document is still what you select, drag and inspect, but it is no longer
 * what you see — so a rule that moves a node or repaints it shows up on the
 * canvas without the renderer knowing such a rule exists. That is why there is
 * no `resolveValue` here any more, and no picks: the solver has done it.
 *
 * Two things are still read from the document, because the answer set does not
 * carry them: a plotted node's vertices and a diagonal node's lean. Both are
 * structure rather than value — no rule can change them today — and putting a
 * bezier into ASP is a phase of its own. Everything the picture is *made of*
 * comes from the atoms.
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
	// The vertices and the lean, by id. Memoised on the tree: the editor
	// re-renders on every pointermove and this is a walk of the whole document.
	const docNodes = useMemo(() => {
		const context = { tokens: scene.tokens, picks: universe.pick };
		const byId = new Map<string, DocShape>();
		for (const node of flatten(scene.nodes)) {
			byId.set(node.id, { node, authored: frameOf(node, context) });
		}
		return byId;
	}, [scene.nodes, scene.tokens, universe.pick]);

	function render(node: ModelNode) {
		// The solver has not seen an uncommitted drag, so the one thing that
		// still overrides the answer set is the frame the pointer is holding.
		const frame = preview?.get(node.id) ?? node.frame;
		const unsettled =
			varying !== undefined &&
			Object.keys(node.rendered).some((prop) =>
				varying.has(propVar(node.id, prop)),
			);

		const box: CSSProperties = {
			position: "absolute",
			left: frame.x,
			top: frame.y,
			width: frame.width,
			height: frame.height,
			boxSizing: "border-box",
			// The ground, the kind's own box and every property it paints, from
			// the one table the exporter reads too.
			...(paintOf(node) as CSSProperties),
		};

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
				{CONTENT[node.kind]?.(node, frame, docNodes.get(node.id))}
				{node.children.map(render)}
			</div>
		);
	}

	return (
		<div
			className={className ? `${styles.artboard} ${className}` : styles.artboard}
			style={{ ...(DOCUMENT_BASE as CSSProperties), ...style }}
			data-artboard=""
		>
			{universe.model.roots.map(render)}
		</div>
	);
});
