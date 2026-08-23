import { type CSSProperties, type ReactNode, memo, useMemo } from "react";
import {
	type Frame,
	KINDS,
	type ModelNode,
	type NodeKind,
	type PropName,
	type Scene,
	type SceneNode,
	type Universe,
	flatten,
	isSurface,
	pathData,
	propVar,
	scalePoints,
} from "@clingo-design/design-core";

import styles from "./Artboard.module.css";

/**
 * How each property reaches CSS.
 *
 * Keyed by property rather than by node kind, so the renderer follows
 * `KINDS[kind].props` and a new kind needs no change here at all.
 */
const PAINT: Partial<Record<PropName, (value: string) => CSSProperties>> = {
	fill: (value) => ({ background: value }),
	radius: (value) => ({ borderRadius: value }),
	// A stroke on a box is a border. The stroked kinds draw an SVG instead and
	// override this — see {@link INHERITED_STROKE}. Both halves declare the
	// style so setting either one alone still shows an edge.
	stroke: (value) => ({ borderColor: value, borderStyle: "solid" }),
	strokeWidth: (value) => ({ borderWidth: value, borderStyle: "solid" }),
	shadow: (value) => ({ boxShadow: value }),
	opacity: (value) => ({ opacity: value }),
	ink: (value) => ({ color: value }),
	fontFamily: (value) => ({ fontFamily: value }),
	size: (value) => ({ fontSize: value }),
	weight: (value) => ({ fontWeight: value }),
	lineHeight: (value) => ({ lineHeight: value }),
	align: (value) => ({ textAlign: value as CSSProperties["textAlign"] }),
};

/**
 * Stroke as SVG paints it, for the kinds whose content is an `<svg>`.
 *
 * Both properties inherit in CSS, so the shape inside picks them up from the
 * box on its own rather than being handed them.
 */
const INHERITED_STROKE = {
	stroke: (value: string) => ({ stroke: value }),
	strokeWidth: (value: string) => ({ strokeWidth: value }),
};

interface ShapeSpec {
	/** Merged into the box before the node's own properties paint over it. */
	box?: CSSProperties;
	/** Overrides {@link PAINT} where a kind takes a property somewhere else. */
	paint?: Partial<Record<PropName, (value: string) => CSSProperties>>;
	/**
	 * Drawn inside the box.
	 *
	 * `node` is the answer set's account of it; `doc` is the document node it
	 * came from, present only for the vertices and the lean — see
	 * {@link Artboard}.
	 */
	content?: (
		node: ModelNode,
		frame: Frame,
		doc: SceneNode | undefined,
	) => ReactNode;
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
		// Content is a property like any other, so it arrives resolved for this
		// universe with everything else — which is what lets a headline differ
		// between them.
		content: (node) => node.rendered.text,
	},
	// Fully rounded corners *are* an ellipse; an SVG for it would only add a
	// second way to size the same box.
	ellipse: { box: { borderRadius: "50%" } },
	line: {
		paint: INHERITED_STROKE,
		content: (_node, frame, doc) => <Stroke frame={frame} doc={doc} />,
	},
	arrow: {
		paint: INHERITED_STROKE,
		content: (_node, frame, doc) => <Stroke frame={frame} doc={doc} head />,
	},
	path: {
		// A path's fill belongs to the polygon, not to the box around it: the
		// box is only the vertices' bounding rectangle and painting it would
		// show a shape the document does not contain.
		paint: { ...INHERITED_STROKE, fill: (value) => ({ fill: value }) },
		content: (_node, frame, doc) => <Plot frame={frame} doc={doc} />,
	},
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
}: { frame: Frame; doc: SceneNode | undefined; head?: boolean }) {
	const up = doc?.diagonal === "up";
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
function Plot({ frame, doc }: { frame: Frame; doc: SceneNode | undefined }) {
	if (!doc) return null;
	const d = pathData(scalePoints(doc.points ?? [], doc.frame, frame), doc.closed);
	if (!d) return null;
	return (
		<svg className={styles.stroke} aria-hidden="true">
			<path
				d={d}
				// An open run of segments is a stroke, not a shape: filling
				// across the gap between its ends would draw an edge that is
				// not there. Inline, so it beats the inherited fill.
				style={doc.closed ? undefined : { fill: "none" }}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
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
		const byId = new Map<string, SceneNode>();
		for (const node of flatten(scene.nodes)) byId.set(node.id, node);
		return byId;
	}, [scene.nodes]);

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
		};

		// A surface is something you put things on: it has a ground, and it
		// clips whatever hangs over the edge.
		if (isSurface(node)) {
			box.background = "#ffffff";
			box.overflow = "hidden";
		}
		const shape = SHAPES[node.kind];
		if (shape?.box) Object.assign(box, shape.box);

		// `rendered/3` carries every property the node holds; a kind paints the
		// ones its table entry lists and leaves the rest alone.
		for (const prop of KINDS[node.kind].props) {
			const value = node.rendered[prop];
			if (value === undefined) continue;
			// Content is not something CSS paints; it is what goes inside.
			const paint = shape?.paint?.[prop] ?? PAINT[prop];
			if (paint) Object.assign(box, paint(value));
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
				{shape?.content?.(node, frame, docNodes.get(node.id))}
				{node.children.map(render)}
			</div>
		);
	}

	return (
		<div
			className={className ? `${styles.artboard} ${className}` : styles.artboard}
			style={style}
			data-artboard=""
		>
			{universe.model.roots.map(render)}
		</div>
	);
});
