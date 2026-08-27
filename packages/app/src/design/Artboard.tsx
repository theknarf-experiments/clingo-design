import { type CSSProperties, type ReactNode, memo, useMemo } from "react";
import {
	type Frame,
	type ModelNode,
	type ModelState,
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
	parseInstancePart,
	pathData,
	propVar,
	scalePoints,
	statePart,
} from "@clingo-design/design-core";

import styles from "./Artboard.module.css";
import { canvasRect } from "./viewport";

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
	/**
	 * The frame the vertices were authored against, in this universe — and in
	 * the document's own EMU, like the vertices themselves. See {@link Plot}: it
	 * is the `from` of the one scaling that turns both into pixels.
	 */
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
 *
 * That one step is also the unit crossing, exactly as it is in the exporter: the
 * vertices are in the document's own EMU, `authored` is the EMU box they were
 * drawn in, and `frame` is the box this node is being painted at, in canvas
 * pixels. Converting them separately afterwards would be a second place for the
 * two to disagree about the same shape.
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
	/**
	 * Instance node id -> a state to draw instead of the one the answer set
	 * shows. Read out of `universe.model.states`, so it costs no solve — the
	 * copies are already in the answer set beside the picture.
	 */
	playing?: Readonly<Record<string, string>>;
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
 * What it draws is the design and *only* the design. The margins, the column
 * grid and the guides a designer drew rule a design without being part of it —
 * the same line the exporter draws, and for the same reason — so they are a
 * sibling of this component rather than something inside it: whoever places an
 * artboard places a `Guides` beside it in the same plane.
 *
 * Frames are positioned relative to their parent, which is exactly what nested
 * absolutely-positioned elements already do — so the render is a plain
 * recursion with no coordinate maths.
 *
 * That plane is **canvas pixels**, and it is where the document's EMU stops.
 * Everything from `design-core` is EMU; a browser lays out in CSS pixels and
 * cannot be talked out of it; so the crossing is one call in {@link render} and
 * one inside {@link Plot}, and nothing else in the file converts.
 *
 * One thing it draws that is *not* in `universe.model.roots`: a state machine's
 * other states. `playing` names, per instance, a state to draw instead of the
 * one the answer set shows, and the values come out of `universe.model.states`
 * — the same answer set, read one key over. So playing a machine on the canvas
 * costs no solve at all, and the renderer learns exactly one thing about states:
 * where to look up a part's other self. It learns nothing about triggers, edges
 * or time, all of which are the editor's business above it.
 *
 * How fast a played change moves is *also* not here. The transition is declared
 * in this component's stylesheet against three custom properties, and whoever
 * is running the machine sets them on an ancestor — see `Editor.tsx`. That way
 * the artboard states that it animates and the editor states how, which is the
 * same division CSS itself makes and the same one the export makes between a
 * rule and the `transition:` on it. With the properties unset the duration is
 * zero, so nothing on a canvas nobody is previewing ever animates: a drag must
 * never lag behind the pointer.
 *
 * Memoised because the editor above it re-renders on every pointermove, and
 * most gestures (marquee, draw) do not touch the document at all.
 */
export const Artboard = memo(function Artboard({
	scene,
	universe,
	preview,
	varying,
	playing,
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

	/**
	 * The state copy to draw a node from, where the canvas is playing one.
	 *
	 * This is the whole of playback on the canvas, and it is three lookups
	 * because the answer set did the work. A node of the picture that belongs to
	 * an instance is `inst(I,N)`; the state copies of that same part are
	 * `stt(I,S,N)`, sitting in `model.states` beside the picture rather than in
	 * it — deliberately not `node/1`, so they never reach `roots`, `byId`, the
	 * layer list or hit testing. So "draw this instance in `hover`" is: read the
	 * term back, look the copy up, and use its frame and its rendered text in
	 * place of the ones the shown state left here.
	 *
	 * **Nothing solves.** Every state is true at once in the one answer set, so
	 * the copy being asked for is already in hand. That is what makes hovering a
	 * button on the canvas cost a lookup rather than a grounding, and it is the
	 * reason `shown/2` is a fact rather than a choice — see the machine section
	 * of the generated program.
	 *
	 * A part with **no copy** falls back to the node's own values, and that is
	 * correct rather than a hole: the materialisation analysis only mints copies
	 * for the parts some state touches plus their ancestors, so a part no state
	 * has an opinion about has nothing to say and the picture already draws what
	 * it would have said. Treating a missing copy as an error would make the
	 * analysis — the thing that keeps grounding affordable — into a bug.
	 *
	 * Rebuilt only when the played states or the answer set change, because this
	 * is called once per node per render and the editor re-renders on every
	 * pointermove.
	 */
	const playedOf = useMemo(() => {
		const states = universe.model.states;
		if (!playing || Object.keys(playing).length === 0) {
			return (_id: string): ModelState | undefined => undefined;
		}
		return (id: string): ModelState | undefined => {
			const part = parseInstancePart(id);
			if (!part) return undefined;
			const state = playing[part.instance];
			if (state === undefined) return undefined;
			return states[statePart(part.instance, state, part.node)];
		};
	}, [playing, universe.model.states]);

	function render(node: ModelNode) {
		/**
		 * A state that hides a part takes its subtree with it, exactly as
		 * `readModel`'s own `drawn` filter does for the shown state — closing the
		 * hiding downward is the reader's job in its own medium, which for a DOM
		 * is not descending, and for the exported stylesheet is `display: none`
		 * and CSS nesting.
		 *
		 * The converse does not hold and cannot: a part the *shown* state hides is
		 * not in the model at all, so playing a state that shows it again has
		 * nothing to draw. That is a real limitation of drawing the picture the
		 * answer set describes, it bites the same way in the export, and the way
		 * round it is to draw the instance in the state that shows the most —
		 * which is what `SceneNode.state` is for.
		 */
		const played = playedOf(node.id);
		if (played?.hidden) return null;
		// The solver has not seen an uncommitted drag, so the one thing that
		// still overrides the answer set is the frame the pointer is holding.
		//
		// Converted here and once, the way the exporter's `framePx` does it and
		// for the same reason: everything below this line is a browser's business
		// — a `left`, an SVG user unit, an arrowhead clamped between 8 and 24 —
		// and every one of those numbers was written in pixels. What arrives is
		// EMU, because that is what the document says and what the answer set
		// carries, and the two are both `number` with a factor of 9525 between
		// them, so a frame that reached the DOM unconverted would draw a business
		// card nine miles wide.
		//
		// A drag beats a played state, and the order is not arbitrary: a pointer
		// holding a frame is the most recent thing anybody said, and the two never
		// happen together anyway — the editor takes the canvas out of edit mode
		// before it will play anything.
		const frame = canvasRect(preview?.get(node.id) ?? played?.frame ?? node.frame);
		/**
		 * The node as this state has it: same id, same kind, same children, other
		 * paint.
		 *
		 * A fresh object rather than a mutation, because `node` is the answer
		 * set's own account of the picture and is shared with the layer list, the
		 * inspector and the exporter. Only the two fields a state may change are
		 * replaced — geometry and rendered text — which is the same list `StatePart`
		 * offers, and it is a list rather than a spread because a state that could
		 * change a node's *kind* or its children would be a second document per
		 * state, which is the design this feature exists not to be.
		 */
		const drawn: ModelNode = played
			? { ...node, frame: played.frame, rendered: played.rendered }
			: node;
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
			...(paintOf(drawn) as CSSProperties),
		};

		return (
			<div
				key={node.id}
				data-node={node.id}
				data-kind={node.kind}
				// The same attribute the exported file switches on, carrying the same
				// state id — so what a screenshot of the canvas shows and what the
				// stylesheet selects are visibly the same claim.
				data-state={played?.state}
				data-varies={unsettled ? "" : undefined}
				className={unsettled ? `${styles.node} ${styles.varies}` : styles.node}
				style={box}
				title={unsettled ? "This property has more than one value" : undefined}
			>
				{CONTENT[node.kind]?.(drawn, frame, docNodes.get(node.id))}
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
