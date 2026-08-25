/**
 * How a node's properties become CSS — the one table, shared by everything
 * that paints.
 *
 * It used to live in `Artboard.tsx`, which was fine while the canvas was the
 * only renderer. Export is a second one, and a second copy of "a fill is a
 * background, a stroke on a box is a border" would be a copy that drifts: the
 * whole promise of an export is that it looks like what was on screen. So the
 * mapping moved here, framework-free, and the canvas reads it like anyone else.
 *
 * Declarations are camelCase because that is what React takes directly; the
 * exporters hyphenate on the way out with {@link cssText}. What did *not* move
 * is the markup a kind draws inside its box — that is React on one side and a
 * string on the other, and there is nothing shared to factor out. What moved is
 * everything that decides how a box looks.
 */
import type { Frame } from "./geometry.ts";
import { KINDS, type Kinded, type NodeKind, PROPS, type PropName } from "./scene.ts";

/** CSS declarations, keyed the way the DOM keys them: `borderRadius`. */
export type Declarations = Record<string, string>;

/**
 * The ground a document sits on, wherever it is drawn.
 *
 * A design defines its own appearance and must never inherit the host's — the
 * studio's 14px would otherwise become the size of every text node that did not
 * set one, and the same document exported to a plain page would come out at the
 * browser's 16px instead. So the inherited properties are declared here, once,
 * and both the canvas and the exporter apply them.
 *
 * Which properties belong here is not a judgement call: it is every property
 * CSS *inherits*, because those and only those are the ones a node that says
 * nothing about them takes from its surroundings. `PROPS[p].inherited` says
 * which, and a test walks the table and insists each one is declared — line
 * height used to be missing, which drew nothing on the canvas only because
 * every text kind sets its own, and came out as the browser's `normal` in an
 * exported file.
 *
 * The values are `PROPS[...].fallback` rather than numbers typed twice: they are
 * exactly what a node with nothing said about them means. The font stack is the
 * exception and deliberately so — it is the *artboard's* stack, mirrored by
 * `ARTBOARD_FONT` in the studio's text measurement, and measuring against one
 * list while painting with another would be off by whole characters.
 */
export const DOCUMENT_BASE: Declarations = {
	color: PROPS.ink.fallback,
	fontFamily: "system-ui, -apple-system, \"Segoe UI\", sans-serif",
	fontSize: PROPS.size.fallback,
	fontWeight: PROPS.weight.fallback,
	lineHeight: PROPS.lineHeight.fallback,
	textAlign: PROPS.align.fallback,
};

/**
 * How each property reaches CSS.
 *
 * Keyed by property rather than by node kind, so a renderer follows
 * `KINDS[kind].props` and a new kind needs no change here at all.
 */
export const PAINT: Partial<Record<PropName, (value: string) => Declarations>> = {
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
	align: (value) => ({ textAlign: value }),
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

export interface ShapePaint {
	/** Merged into the box before the node's own properties paint over it. */
	box?: Declarations;
	/** Overrides {@link PAINT} where a kind takes a property somewhere else. */
	paint?: Partial<Record<PropName, (value: string) => Declarations>>;
}

/**
 * What each kind does to its box beyond taking a colour.
 *
 * One table, for the same reason `KINDS` is one: a kind that paints unusually
 * gets an entry, and everything else falls through to the plain box.
 */
export const SHAPE_PAINT: Partial<Record<NodeKind, ShapePaint>> = {
	text: {
		box: {
			lineHeight: PROPS.lineHeight.fallback,
			overflow: "hidden",
			whiteSpace: "pre-wrap",
		},
	},
	// Fully rounded corners *are* an ellipse; an SVG for it would only add a
	// second way to size the same box.
	ellipse: { box: { borderRadius: "50%" } },
	line: { paint: INHERITED_STROKE },
	arrow: { paint: INHERITED_STROKE },
	path: {
		// A path's fill belongs to the polygon, not to the box around it: the box
		// is only the vertices' bounding rectangle and painting it would show a
		// shape the document does not contain.
		paint: { ...INHERITED_STROKE, fill: (value) => ({ fill: value }) },
	},
};

/**
 * A surface is something you put things on: it has a ground, and it clips
 * whatever hangs over the edge. Read off `KINDS[kind].surface` rather than
 * named here, so a new surface kind needs no entry.
 */
export const SURFACE_BOX: Declarations = {
	background: "#ffffff",
	overflow: "hidden",
};

/**
 * Which function turns one property into declarations for one kind, if any.
 *
 * **The single answer to "what does this property paint?"** Three callers ask
 * it and they must agree, or the export contradicts the canvas: the renderer
 * ({@link paintOf}), the token-preserving walk that writes a wearer's own rule,
 * and the filter that decides which of a style's properties may go in a shared
 * class at all. That last one is why this is a lookup rather than a loop — it
 * asks the question about a (kind, property) pair with no node in hand, to find
 * out whether two wearers of different kinds would paint the property the same
 * way.
 *
 * Nothing is decided here that the tables do not already say: a kind paints the
 * properties its `KINDS` entry lists, through its own `SHAPE_PAINT` override
 * where it has one and through {@link PAINT} otherwise.
 */
export function paintFor(
	kind: NodeKind,
	prop: PropName,
): ((value: string) => Declarations) | undefined {
	if (!KINDS[kind].props.includes(prop)) return undefined;
	return SHAPE_PAINT[kind]?.paint?.[prop] ?? PAINT[prop];
}

/** Everything but the geometry: the ground, the kind's own box, the paint. */
export function paintOf(
	node: Kinded & { rendered: Partial<Record<PropName, string>> },
): Declarations {
	const box: Declarations = {};
	if (KINDS[node.kind].surface) Object.assign(box, SURFACE_BOX);
	const shape = SHAPE_PAINT[node.kind];
	if (shape?.box) Object.assign(box, shape.box);
	// `rendered/3` carries every property the node holds; a kind paints the ones
	// its table entry lists and leaves the rest alone.
	for (const prop of KINDS[node.kind].props) {
		const value = node.rendered[prop];
		if (value === undefined) continue;
		const paint = paintFor(node.kind, prop);
		if (paint) Object.assign(box, paint(value));
	}
	return box;
}

/** `borderRadius` -> `border-radius`, and a `--custom` left alone. */
export const cssName = (key: string): string =>
	key.startsWith("--") ? key : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Declarations as a CSS block body, one per line at the given indent. */
export function cssText(declarations: Declarations, indent = ""): string {
	return Object.entries(declarations)
		.map(([key, value]) => `${indent}${cssName(key)}: ${value};`)
		.join("\n");
}

/**
 * The two barbs at the far end of an arrow, as a polyline's points.
 *
 * A `<marker>` would be the textbook answer, but a marker needs an id per node
 * and does not inherit the stroke it is attached to; two more stroked segments
 * take the colour and thickness from the same place the line does.
 */
export function arrowHead(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): string {
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

/** Which corner-to-corner run a diagonal kind draws, as two y coordinates. */
export function diagonalRun(
	frame: Frame,
	lean: "down" | "up" | undefined,
): { y1: number; y2: number } {
	return lean === "up"
		? { y1: frame.height, y2: 0 }
		: { y1: 0, y2: frame.height };
}
