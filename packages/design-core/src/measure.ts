/**
 * The size a node asks for when its own content decides, not its box.
 *
 * Nothing here measures anything. Measuring text needs a font engine, and the
 * only one available is the browser's canvas — so the host measures and hands
 * the numbers in as plain pixels, and this side is arithmetic over them. That
 * is what keeps the compiler pure and testable in Node, where no canvas exists.
 *
 * What a node asks to be is not one number, it is a **table**. A text node's
 * box depends on its wording, and — since a style is one variable whose
 * alternatives are whole records — on which treatment it is wearing, and on any
 * token those name. Every one of those is a pick the solver makes, so the
 * measured size is a function of a *tuple* of picks rather than of a single
 * alternative. {@link MeasureAxis} is one place in that tuple, {@link Measured}
 * is the table, and the solver selects a row from it through `lrowif/4`. See
 * `emitAsked` in compile.ts for the other half.
 */
import {
	KINDS,
	type PropName,
	PROPS,
	type Scene,
	type SceneNode,
	type Sizing,
	frameOf,
	isLaidOut,
	layoutLength,
	layoutValueOf,
	layoutWord,
	styleOf,
	wornProps,
} from "./scene.ts";
import { flatten } from "./tree.ts";
import {
	type Picks,
	type ResolveContext,
	type Term,
	type Token,
	type Value,
	findToken,
	frameVar,
	layoutVar,
	propVar,
	referencedTokens,
	stylePartVar,
	styleVar,
	tokenVar,
	varies,
} from "./values.ts";

export interface Size {
	width: number;
	height: number;
}

/**
 * One place in the tuple of picks a node's size depends on: a variable, and how
 * many alternatives it has.
 *
 * Always more than one. An axis of one alternative multiplies the table without
 * changing a single row of it, and the degenerate cases — a style with one
 * variant, a headline with one wording — are exactly the ones that must not
 * cost anything.
 */
export interface MeasureAxis {
	/** A variable key, in the form {@link parseVariable} reads. */
	variable: string;
	count: number;
}

/**
 * What a node may ask to be, over every combination of the picks that change it.
 *
 * `sizes` is a dense odometer over `axes` — the last axis varies fastest — so a
 * row is an index and no combination has to be written down. {@link rowIndex}
 * and {@link rowPicks} are the two directions of that mapping, and they are the
 * only places that know the encoding.
 */
export interface Measured {
	/** Most significant first; see {@link capAxes} for what that decides. */
	axes: readonly MeasureAxis[];
	/** One per combination: `rowCount(axes)` of them. */
	sizes: readonly Size[];
	/**
	 * Variables that belonged in `axes` and were left out to stay inside the
	 * budget. Their picks are read at the first alternative, so a universe that
	 * chose otherwise gets a box measured for a different one — which is why
	 * this is reported rather than silently absorbed.
	 */
	dropped?: readonly string[];
}

/** Measured sizes, per node. */
export type Measurements = Readonly<Record<string, Measured>>;

/** A table with one row: the size a node asks for in every universe. */
export const oneSize = (size: Size): Measured => ({ axes: [], sizes: [size] });

/** Has content whose size can be measured. */
export const isMeasured = (node: SceneNode): boolean =>
	KINDS[node.kind].measured;

/**
 * Whether a node takes its size from its content.
 *
 * Automatic is the default, for the same reason a layout hugs by default: the
 * box a text node happened to be dragged out at says nothing about the words
 * that ended up in it.
 */
export function autoSizes(node: SceneNode): boolean {
	return isMeasured(node) && sizingOf(node) === "hug";
}

/** How a node decides its own size. Only the measured kinds have a say. */
export function sizingOf(node: SceneNode): Sizing {
	if (!isMeasured(node)) return "fixed";
	return node.sizing === "fixed" ? "fixed" : "hug";
}

/* ------------------------------------------------------------------ */
/* The table's index                                                   */
/* ------------------------------------------------------------------ */

/** How many combinations a set of axes has. */
export const rowCount = (axes: readonly MeasureAxis[]): number =>
	axes.reduce((n, axis) => n * axis.count, 1);

/** Which picks row `row` stands for. */
export function rowPicks(
	axes: readonly MeasureAxis[],
	row: number,
): Record<string, number> {
	const picks: Record<string, number> = {};
	let rest = row;
	for (let i = axes.length - 1; i >= 0; i--) {
		picks[axes[i].variable] = rest % axes[i].count;
		rest = Math.floor(rest / axes[i].count);
	}
	return picks;
}

/**
 * Which row a universe reads.
 *
 * A pick this table has no axis for is ignored, and an axis the universe says
 * nothing about reads as its first alternative — which is what makes a table
 * that dropped an axis still answer every universe, with the box it measured
 * for the first of the ones it dropped.
 */
export function rowIndex(
	axes: readonly MeasureAxis[],
	picks: Picks = {},
): number {
	let row = 0;
	for (const axis of axes) {
		const pick = picks[axis.variable] ?? 0;
		row = row * axis.count + (pick >= 0 && pick < axis.count ? pick : 0);
	}
	return row;
}

/**
 * How many rows one node's table may have.
 *
 * The product is the honest domain and the product is also what explodes: a
 * headline with three wordings under a two-variant style is six measurements,
 * and six is fine, but every axis multiplies.
 *
 * Measured in Chrome against the real canvas: ~50µs a row for a heading, ~150µs
 * for a six-line paragraph, and no cache to help — every row is a different
 * string or a different font, which is exactly what pretext keys on. So 32 rows
 * is 1.6ms for the worst heading in a document and 5ms for the worst paragraph,
 * and 48 rows across eight styled headings measured in 2.5ms all told. The
 * budget is where a page of them starts to cost a frame, not where one node
 * does.
 */
export const MEASURE_BUDGET = 32;

/**
 * As many axes as fit the budget, and the names of the ones that did not.
 *
 * Dropping an axis is an approximation with teeth — the node is measured with
 * that variable at its first alternative and the box is then wrong in every
 * universe that chose otherwise — so it degrades in the one direction that can
 * be reported: the caller is told which variables it lost, and `emitAsked`
 * writes them into the generated program as a comment.
 *
 * The first axis is kept whatever it costs. It is the most significant one, and
 * for a text node it is the wording — a headline with forty alternatives is a
 * document that wants forty measurements, and refusing them all would be a
 * regression rather than a budget.
 */
export function capAxes(
	axes: readonly MeasureAxis[],
	budget = MEASURE_BUDGET,
): { axes: MeasureAxis[]; dropped: string[] } {
	const kept: MeasureAxis[] = [];
	const dropped: string[] = [];
	let rows = 1;
	for (const axis of axes) {
		if (kept.length === 0 || rows * axis.count <= budget) {
			kept.push(axis);
			rows *= axis.count;
		} else {
			dropped.push(axis.variable);
		}
	}
	return { axes: kept, dropped };
}

/* ------------------------------------------------------------------ */
/* What a node's size depends on                                       */
/* ------------------------------------------------------------------ */

/**
 * The axes one value contributes: itself where it branches, and every varying
 * token it can reach.
 *
 * A token counts because a size that names one is a size the token's
 * alternatives decide — `size: ref("step")` over a two-alternative scale is two
 * different boxes, and measuring only the first was the same silent wrongness a
 * style variant would have been.
 */
function valueAxes(
	tokens: readonly Token[],
	value: Value | undefined,
	variable: string,
): MeasureAxis[] {
	if (!value || value.length === 0) return [];
	const out: MeasureAxis[] = [];
	if (value.length > 1) out.push({ variable, count: value.length });
	for (const id of referencedTokens(tokens, value)) {
		const token = findToken(tokens, id);
		if (token && token.value.length > 1) {
			out.push({ variable: tokenVar(id), count: token.value.length });
		}
	}
	return out;
}

const dedupe = (axes: readonly MeasureAxis[]): MeasureAxis[] => {
	const seen = new Map<string, MeasureAxis>();
	for (const axis of axes) if (!seen.has(axis.variable)) seen.set(axis.variable, axis);
	return [...seen.values()];
};

/**
 * The properties whose value changes the box the words need, most significant
 * first.
 *
 * `align` is deliberately absent though a style may decide it: the natural width
 * is the longest line's, and where the lines sit inside that width does not
 * change it. Everything else here feeds either the font string or the line
 * height, and so feeds the measurement.
 */
export const MEASURED_PROPS: readonly PropName[] = [
	"text",
	"fontFamily",
	"size",
	"weight",
	"lineHeight",
];

/**
 * Whether picking a different variant of this node's style could change its box.
 *
 * A style that decides only a fill is worn by a text node without multiplying
 * anything: the variants agree on every property the measurement reads, so
 * there is nothing for an axis to range over. Compared term by term rather than
 * resolved, because two variants holding the same token link are the same
 * treatment as far as the box is concerned however the token is defined.
 */
function styleAffectsSize(scene: Scene, node: SceneNode): boolean {
	const style = styleOf(scene, node);
	if (!style || style.variants.length < 2) return false;
	const worn = wornProps(scene, node);
	return MEASURED_PROPS.some((prop) => {
		if (!worn.includes(prop)) return false;
		const first = termKey(style.variants[0].parts[prop]);
		return style.variants.some((v) => termKey(v.parts[prop]) !== first);
	});
}

/** Enough of a term to tell two apart. Not a hash, and not order-sensitive. */
const termKey = (term: Term | undefined): string =>
	term === undefined
		? "-"
		: term.kind === "literal"
			? `l:${term.value}`
			: term.kind === "token"
				? `t:${term.token}`
				: `d:${term.via}:${term.from}`;

/**
 * Every pick that can change the box the host measures for this node.
 *
 * This is the honest indexing, and it is honest by construction rather than by
 * enumeration: for each property the measurement reads, whatever holds it
 * contributes its own alternatives — the node's value, or the style's variant
 * list, plus any token either names. So the degenerate cases cost nothing
 * without being special-cased. A node with a style but one wording and one
 * variant has no axes at all; a node with three wordings and no style has the
 * one axis it always had.
 */
export function measureAxes(scene: Scene, node: SceneNode): MeasureAxis[] {
	if (!autoSizes(node)) return [];
	const style = styleOf(scene, node);
	const worn = style ? wornProps(scene, node) : [];
	const styleMatters = styleAffectsSize(scene, node);
	const out: MeasureAxis[] = [];
	for (const prop of MEASURED_PROPS) {
		const own = node.props[prop];
		if (own && own.length > 0) {
			out.push(...valueAxes(scene.tokens, own, propVar(node.id, prop)));
			continue;
		}
		if (!style || !worn.includes(prop)) continue;
		// One axis for the whole style, wherever the first of its properties
		// turns up. That is the point of a style: one pick, several properties.
		if (styleMatters) {
			out.push({ variable: styleVar(style.id), count: style.variants.length });
		}
		style.variants.forEach((variant, i) => {
			const term = variant.parts[prop];
			if (!term) return;
			out.push(
				...valueAxes(scene.tokens, [term], stylePartVar(style.id, i, prop)),
			);
		});
	}
	return dedupe(out);
}

/** The measured table for a node, if the host supplied one that applies. */
export const measuredTable = (
	node: SceneNode,
	measured?: Measurements,
): Measured | undefined =>
	autoSizes(node) ? measured?.[node.id] : undefined;

/** The axes a node's own four dimensions contribute — a frame can vary too. */
const frameAxes = (scene: Scene, node: SceneNode): MeasureAxis[] => [
	...valueAxes(scene.tokens, node.frame.width, frameVar(node.id, "width")),
	...valueAxes(scene.tokens, node.frame.height, frameVar(node.id, "height")),
];

/** The layout settings {@link naturalSize} reads, in the order it reads them. */
const NATURAL_SETTINGS = ["sizing", "direction", "gap", "padding"] as const;

/**
 * Whether some universe could have this container hugging.
 *
 * A container that never hugs asks for its frame and nothing below it matters;
 * one that hugs in *some* universe needs its contents' axes in every row, since
 * which branch a row takes is itself one of the picks.
 */
function couldHug(scene: Scene, node: SceneNode): boolean {
	if (!isLaidOut(node)) return false;
	const value = layoutValueOf(node, "sizing");
	const key = layoutVar(node.id, "sizing");
	const count = value?.length ?? 0;
	if (count < 2) {
		return layoutWord(node, "sizing", { tokens: scene.tokens, picks: {} }) === "hug";
	}
	for (let i = 0; i < count; i++) {
		const word = layoutWord(node, "sizing", {
			tokens: scene.tokens,
			picks: { [key]: i },
		});
		if (word === "hug") return true;
	}
	return false;
}

/**
 * Every pick that can change what this node asks to be, its contents included.
 *
 * The compiler's side of {@link measureAxes}. For a measured leaf it is
 * whatever the host actually measured — the host's cap is authoritative, since
 * no row exists for an axis it declined — and for a hugging container it is the
 * union of its subtree's, plus the settings its own arithmetic reads. That
 * union is free: a container's size is computed here rather than measured, so
 * crossing it costs grounding and not a canvas.
 *
 * `dropped` gathers both budgets — the host's, from the table, and this side's,
 * from the union — so whatever the program says about a node names every
 * variable its box ignores, wherever it was given up.
 */
export function askedAxes(
	scene: Scene,
	node: SceneNode,
	measured?: Measurements,
): { axes: MeasureAxis[]; dropped: string[] } {
	const capped = capAxes(dedupe(rawAskedAxes(scene, node, measured)));
	const already = measuredTable(node, measured)?.dropped ?? [];
	return already.length === 0
		? capped
		: { axes: capped.axes, dropped: [...already, ...capped.dropped] };
}

function rawAskedAxes(
	scene: Scene,
	node: SceneNode,
	measured: Measurements | undefined,
): MeasureAxis[] {
	const table = measuredTable(node, measured);
	if (table) return [...table.axes];
	if (!couldHug(scene, node)) return frameAxes(scene, node);
	const out: MeasureAxis[] = [];
	// Its own settings first: a row and a column are not the same size, and a
	// gap that names a spacing scale is the deferred half of this bill.
	for (const prop of NATURAL_SETTINGS) {
		out.push(
			...valueAxes(
				scene.tokens,
				layoutValueOf(node, prop),
				layoutVar(node.id, prop),
			),
		);
	}
	// The frame is what it asks for in the universes where it does not hug.
	if (varies(layoutValueOf(node, "sizing"))) out.push(...frameAxes(scene, node));
	for (const child of node.children ?? []) {
		out.push(...rawAskedAxes(scene, child, measured));
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* Reading a table                                                     */
/* ------------------------------------------------------------------ */

/**
 * What a node asks to be: its measurement if it has one, otherwise its frame.
 *
 * `context.picks` is the universe being asked about, and it selects the row —
 * the same picks the frame resolves against, so a node whose measurement was
 * capped and whose frame varies cannot answer for two different universes at
 * once. A measurement the host did not supply is not an error: the first render
 * happens before anything has been measured, and a headless solve has no canvas
 * at all, so the frame is always there to fall back to.
 */
export function askedSize(
	node: SceneNode,
	measured?: Measurements,
	context?: ResolveContext,
): Size {
	const table = measuredTable(node, measured);
	// Out of range falls back to the first: an alternative can be deleted
	// between a measurement and the solve that reads it.
	const size = table
		? (table.sizes[rowIndex(table.axes, context?.picks)] ?? table.sizes[0])
		: undefined;
	if (size) return size;
	const frame = frameOf(node, context);
	return { width: frame.width, height: frame.height };
}

/**
 * What a node would be with nothing pushing on it, its contents included.
 *
 * A hugging container's stored frame is stale by construction — the solver owns
 * its size — so a parent needing to know how big such a child is cannot read it
 * off the document. Nor can it ask the solver for it: the cross axis takes a
 * *maximum* over the children, and a maximum over solved values is not a linear
 * constraint. So it is a bottom-up pass here, over exactly the arithmetic the
 * layout rules use, and the answer goes in as that node's `lask` fact.
 *
 * `context` carries both the tokens and the universe, so it is exact where the
 * caller knows the picks — which, since `askedAxes` puts every setting this
 * reads into the table's axes, is every row `emitAsked` writes. A caller with no
 * picks gets the first alternative of everything, which is what an unsolved
 * preview should show.
 */
export function naturalSize(
	node: SceneNode,
	measured?: Measurements,
	context?: ResolveContext,
): Size {
	// A container whose sizing is itself a choice has no one natural size unless
	// the universe says which it is: with the pick in hand this follows it, and
	// without one it asks for the frame it was drawn at, because that is exactly
	// what the fixed alternative means and the hugging one works its own size
	// out from the equations and never reads this.
	const settled =
		!varies(layoutValueOf(node, "sizing")) ||
		context?.picks?.[layoutVar(node.id, "sizing")] !== undefined;
	if (
		!isLaidOut(node) ||
		!settled ||
		layoutWord(node, "sizing", context) !== "hug"
	) {
		return askedSize(node, measured, context);
	}
	const children = (node.children ?? []).map((c) =>
		naturalSize(c, measured, context),
	);
	const pad = layoutLength(node, "padding", context);
	const gap = layoutLength(node, "gap", context);
	const row = layoutWord(node, "direction", context) === "row";
	const main = (s: Size) => (row ? s.width : s.height);
	const cross = (s: Size) => (row ? s.height : s.width);
	const along =
		children.reduce((total, s) => total + main(s), 0) +
		gap * (children.length - 1) +
		2 * pad;
	const across = Math.max(...children.map(cross)) + 2 * pad;
	return row
		? { width: along, height: across }
		: { width: across, height: along };
}

/** The nodes the host should measure, at any depth. */
export function toMeasure(nodes: readonly SceneNode[]): SceneNode[] {
	return flatten(nodes).filter(autoSizes);
}

export interface FontSpec {
	/** A CSS font-family list, as stored. */
	family: string;
	/** A CSS length. */
	size: string;
	weight: string;
}

/**
 * A CSS `font` shorthand — the one string a canvas 2D context understands, and
 * the form pretext wants. Order is fixed by CSS: weight, then size, then the
 * family list.
 */
export function fontString(spec: FontSpec): string {
	return `${spec.weight} ${spec.size} ${spec.family}`;
}

/** A CSS length in pixels. Only px and bare numbers occur in this model. */
export function pixels(value: string | undefined, fallback: number): number {
	const n = Number.parseFloat(value ?? "");
	return Number.isFinite(n) ? n : fallback;
}

/**
 * How tall one line is, in pixels.
 *
 * CSS reads a unitless line-height as a multiple of the font size and a length
 * as itself; the inspector offers the former, but a document may hold either.
 */
export function lineHeightPx(
	fontSize: string | undefined,
	lineHeight: string | undefined,
): number {
	const size = pixels(fontSize, pixels(PROPS.size.fallback, 16));
	const raw = (lineHeight ?? "").trim();
	const ratio = Number(raw);
	if (raw !== "" && Number.isFinite(ratio)) return size * ratio;
	if (raw.endsWith("px")) return pixels(raw, size);
	return size * Number(PROPS.lineHeight.fallback);
}
