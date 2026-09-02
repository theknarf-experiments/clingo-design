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
 *
 * The unit crossing for a *property* is here for the same reason: a document's
 * lengths are EMU and CSS wants pixels, and a stored literal can be spelled in
 * a unit no browser reads. {@link cssValue} is that one step, and both renderers
 * take it — see the note there. Geometry crosses separately in each renderer,
 * because a frame is arithmetic each of them does its own way.
 */
import type { Frame } from "./geometry.ts";
import { KINDS, type Kinded, type NodeKind, PROPS, type PropName } from "./scene.ts";
import { type Emu, cssPxFromEmu, emuOf } from "./units.ts";
import { GRADIENT_FROM, GRADIENT_TO, isLengthType } from "./values.ts";

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
 * A blur radius on its way into a filter function, never negative.
 *
 * `blur(-4px)` is not a length the function accepts, and an unparsable argument
 * invalidates the *whole* declaration — so a designer who typed a minus sign
 * would lose the blur rather than get none of it, which are two different
 * pictures and only one of them is explicable. Clamping to zero says "no blur",
 * which is what a negative radius means if it means anything.
 *
 * It arrives here already through {@link cssValue}, so it is pixels or it is a
 * `var()`. A `var()` is passed through untouched and deliberately: what a token
 * holds is not known here, it is resolved by the browser at computed-value time,
 * and a wrapper that tried to guard it would have to invent a second
 * substitution engine. A `length` token holding a negative number costs exactly
 * this one declaration, on one node, and nothing else.
 *
 * The empty string is a caller and not a mistake: `tweenedKeys` calls every
 * paint function with `""` purely to read back which CSS keys it writes, and
 * `blur()` is a perfectly good nonsense value to throw away.
 */
const blurFilter = (value: string): string => {
	if (value.startsWith("var(")) return value;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) && n < 0 ? "0px" : value;
};

/**
 * The two custom properties a gradient is made of, registered.
 *
 * Three things follow from `@property` and every one of them is load-bearing:
 *
 *   - **`inherits: false`.** An unregistered custom property inherits, which
 *     would make a frame's gradient colour the starting colour of every gradient
 *     inside it — a leak with no symptom, since the picture would simply be a
 *     colour nobody chose. It is also what makes `PROPS.gradientFrom.inherited`
 *     an honest `false` rather than a claim the table makes and the CSS breaks.
 *   - **`initial-value`.** `diff` writes `unset` for a declaration a state layer
 *     does not make, and `unset` on an *inheriting* custom property means
 *     inherit — so without a registration, a state that stopped saying anything
 *     about a gradient colour would take its parent's rather than the default's.
 *   - **`syntax: "<color>"`.** Only a registered property with a real syntax can
 *     be interpolated, so this is the line that makes a gradient's colours
 *     genuinely *tween* through a transition or a `@keyframes` instead of
 *     snapping at the halfway point. Its direction cannot, which is the loss the
 *     export says out loud.
 *
 * A string rather than a rule in each renderer's stylesheet, for
 * {@link DOCUMENT_BASE}'s reason exactly: the exporter needs these declarations
 * and a CSS module is not somewhere it can read them from. The app renders it
 * into a `<style>` at its *root* — not the studio's, because a presentation is a
 * different route and would otherwise paint a gradient nobody chose — and the
 * exporter concatenates it into `BASE_CSS`. One copy of the two initial colours,
 * in `values.ts`, read by both.
 */
export const CUSTOM_PROPERTY_RULES = `@property --gfrom {
	syntax: "<color>";
	inherits: false;
	initial-value: ${GRADIENT_FROM};
}
@property --gto {
	syntax: "<color>";
	inherits: false;
	initial-value: ${GRADIENT_TO};
}`;

/**
 * How each property reaches CSS.
 *
 * Keyed by property rather than by node kind, so a renderer follows
 * `KINDS[kind].props` and a new kind needs no change here at all.
 */
export const PAINT: Partial<Record<PropName, (value: string) => Declarations>> = {
	/**
	 * A longhand, and it used to be the `background` shorthand.
	 *
	 * That was harmless for exactly as long as nothing else wrote a
	 * `background-image`, because a shorthand resets every longhand it covers. A
	 * gradient writes one, and the reset then has three ways to erase it, only
	 * the first of which an ordering could fix: `paintOf` walks
	 * `KINDS[kind].props` so the fill lands before the image and the gradient
	 * survives — until somebody sorts the list — but `diff` and `copyPaint`
	 * cannot be fixed that way at all. A machine state that repaints *only* the
	 * fill emits the single declaration `background: #1d4ed8`, it cascades after
	 * the base rule, and the card's sheen vanishes on hover and comes back on the
	 * way out. Nothing about that reads as a shorthand.
	 *
	 * Nothing was lost with it: no entry in this table ever set a background
	 * position, repeat or size, and `transition: background-color` is what a
	 * browser wants to interpolate anyway.
	 */
	fill: (value) => ({ backgroundColor: value }),
	// The gradient's three parts. `background-image` over the fill's
	// `background-color` is CSS's own layering, and it is the whole of "two
	// fills" this tool offers — `docs/framer-paint-spec.md` §9 recommends against
	// the general case and says what this buys instead.
	gradient: (value) => ({ backgroundImage: value }),
	// A custom property, because CSS has no name for "the second colour of the
	// background image". {@link cssName} already leaves a `--custom` alone and
	// React already writes one out of a style object, so this needed nothing
	// built — and `--gfrom: var(--brand)` is the design system reaching the file
	// rather than a number that used to be one.
	gradientFrom: (value) => ({ "--gfrom": value }),
	gradientTo: (value) => ({ "--gto": value }),
	radius: (value) => ({ borderRadius: value }),
	// A stroke on a box is a border. The stroked kinds draw an SVG instead and
	// override this — see {@link INHERITED_STROKE}. Both halves declare the
	// style so setting either one alone still shows an edge.
	stroke: (value) => ({ borderColor: value, borderStyle: "solid" }),
	strokeWidth: (value) => ({ borderWidth: value, borderStyle: "solid" }),
	shadow: (value) => ({ boxShadow: value }),
	// The two blurs. The clamp is inside {@link blurFilter} rather than at each
	// call site for `roughness`' reason: two clamps is two answers, and only one
	// of them can be checked headless.
	blur: (value) => ({ filter: `blur(${blurFilter(value)})` }),
	backdropBlur: (value) => ({ backdropFilter: `blur(${blurFilter(value)})` }),
	mix: (value) => ({ mixBlendMode: value }),
	opacity: (value) => ({ opacity: value }),
	ink: (value) => ({ color: value }),
	fontFamily: (value) => ({ fontFamily: value }),
	size: (value) => ({ fontSize: value }),
	weight: (value) => ({ fontWeight: value }),
	lineHeight: (value) => ({ lineHeight: value }),
	align: (value) => ({ textAlign: value }),
	// `stretch` is the designer's word and CSS's is `fill`, which is already
	// taken in this vocabulary by the colour a box is painted. Translated here,
	// in the one place both targets read, so the menu can say what it means
	// without the stylesheet meaning something else.
	fit: (value) => ({ objectFit: value === "stretch" ? "fill" : value }),
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
 * How a box cuts off what hangs over its edge: **`clip`, and never `hidden`.**
 *
 * The two paint the same picture. They differ in one invisible way, and that way
 * decided whether a whole feature worked: `overflow: hidden` makes the element a
 * **scroll container** — a box that happens to have nothing to scroll — where
 * `overflow: clip` makes it a box that clips and nothing else.
 *
 * Every ancestor of every node in this document is a surface, and a surface
 * clips. So with `hidden`, the nearest scroll container of anything on a page is
 * the frame immediately around it, and `animation-timeline: view()` — which is
 * *this element's pass through its nearest scrollport* — resolves against a
 * scrollport that never moves. A scroll-clocked timeline sat frozen at whatever
 * progress the frame put it at, in every exported file, and the CSS was
 * otherwise perfect: the `@supports` matched, the custom property carried the
 * name, `animation-timeline` computed to `view()`, and the element did not move.
 * Nothing in a stylesheet says that out loud, which is why it took driving one in
 * a browser and reading `getAnimations()[0].timeline.source` to see it — that
 * property named `inst(resting,button)` where it had to name the document.
 *
 * **What was rejected.** Emitting `clip` only on the ancestors of a node that
 * plays a scroll-clocked timeline: it would make two identical frames clip by two
 * different mechanisms depending on an animation somewhere below them, for no
 * visible difference at all, since the picture is the same either way. And
 * leaving `hidden` on the canvas while the export said `clip`: the canvas and the
 * exported file agreeing about every CSS property is the promise this table
 * exists to keep, and a divergence nobody could see is the worst kind to have.
 *
 * The cost is the one thing `hidden` still has over `clip`: a browser too old to
 * parse `clip` drops the declaration and clips nothing, where the two-declaration
 * fallback that fixes that cannot be written here — {@link Declarations} is one
 * key per property and `overflow` is one key. It is Chrome and Edge 90, Firefox
 * 81 and Safari 16, which is older than `linear()`, older than `@property` and
 * older than the `animation-timeline` this exists for, so the file already needs
 * a newer browser than this line does.
 */
const CLIP = "clip";

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
			overflow: CLIP,
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
	// A longhand for {@link PAINT}'s `fill` reason and one more of its own: a
	// surface's ground has to sit *under* a gradient rather than reset it, and
	// the shorthand would have wiped the `background-image` of every surface that
	// paints one before the node's own properties ever ran.
	backgroundColor: "#ffffff",
	overflow: CLIP,
};

/* ------------------------------------------------------------------ */
/* EMU in, CSS pixels out                                              */
/* ------------------------------------------------------------------ */

/**
 * Four places, which is well past a pixel and short of the noise.
 *
 * Coordinates are exact rationals upstream and a pixel is 9525 EMU, so a solved
 * value that is a third of a box divides into something with a long tail. Four
 * decimals is a hundredth of the thinnest hairline anyone can draw, and cutting
 * it there is what keeps a diff between two exports readable.
 */
export const cssRound = (n: number): number => Math.round(n * 10000) / 10000;

/** A length on its way out of the model, as a number a stylesheet can hold. */
export const cssPx = (emu: Emu): number => cssRound(cssPxFromEmu(emu));

/**
 * A stored length literal as CSS: `"0.25in"` and `"24px"` both come out `24px`.
 *
 * It lives here beside the table rather than in the exporter because it is not
 * the exporter's question. A document's lengths are EMU and its *literals* are
 * spelled in whatever unit the designer typed, `"119063emu"` included — the
 * escape `formatLength` falls back on when no CSS unit says a value exactly.
 * `emu` is not CSS at all, and a browser silently drops a declaration it cannot
 * parse, so a radius typed as `12.5` would have rounded no corner and said
 * nothing about it, on the canvas, while the export drew it correctly. A
 * property that paints differently in the two renderers is exactly what this
 * module exists to prevent.
 *
 * Two smaller reasons, both about the exporter. A document written in points or
 * millimetres would otherwise come out with its own units intact, which is
 * defensible until a *class* holds one wearer's `pt` beside a node's own `px`
 * and the two ramps stop being comparable. And a file that is the same picture
 * ought to be the same file however the designer spelled it, which is the
 * property the export test pins.
 *
 * A literal no unit spells — a `"20.5px"` from a document older than EMU —
 * passes through untouched. It is already CSS and the browser reads it exactly;
 * inventing a number for it here would be an opinion about a migration that
 * belongs upstream.
 */
export const cssLength = (literal: string): string => {
	const emu = emuOf(literal);
	return emu === undefined ? literal : `${cssPx(emu)}px`;
};

/**
 * One rendered property on its way into a declaration.
 *
 * Which properties are lengths is asked of the value-type table rather than
 * named here, so a new length-shaped property is converted the day it is added
 * and a line height — a ratio, and famously not a length — never is.
 */
export const cssValue = (prop: PropName, value: string): string =>
	isLengthType(PROPS[prop].type) ? cssLength(value) : value;

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
		// Through {@link cssValue}, for the same reason the exporter's walk goes
		// through it: what the document stores is a length, and what CSS takes is
		// pixels. The exporter cannot share this loop — it has a token to write as
		// a `var()` before any of this — but it must not part company with it over
		// the conversion, which is why the conversion is one function and not two.
		if (paint) Object.assign(box, paint(cssValue(prop, value)));
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
