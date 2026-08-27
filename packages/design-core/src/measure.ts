/**
 * The size a node asks for when its own content decides, not its box.
 *
 * Nothing here measures anything. Measuring text needs a font engine, and the
 * only one available is the browser's canvas — so the host measures and hands
 * the numbers in, and this side is arithmetic over them. That is what keeps the
 * compiler pure and testable in Node, where no canvas exists.
 *
 * **Where the float gets in.** A font engine measures in CSS pixels and cannot
 * be asked to do otherwise: an advance width is a fraction the shaper worked
 * out, not a document quantity. Everything downstream of here — `naturalSize`,
 * `lask/3`, the layout equations — is EMU. So this file is the one seam in the
 * tree where the two meet, and it is deliberately narrow: three functions carry
 * a `Px` in their name ({@link lineHeightPx}, {@link sizeFromCssPx}, and the
 * host's own `measureText`), everything else is EMU, and the crossing happens
 * once per measured box rather than wherever a number happens to be handy. A
 * second crossing anywhere would be undetectable — pixels and EMU are both
 * `number`, and a box 9525 times too small still lays out.
 *
 * What a node asks to be is not one number, it is a **table**. A text node's
 * box depends on its wording, and — since a style is one variable whose
 * alternatives are whole records — on which treatment it is wearing, and on any
 * token those name. Every one of those is a pick the solver makes, so the
 * measured size is a function of a *tuple* of picks rather than of a single
 * alternative. {@link MeasureAxis} is one place in that tuple, {@link Measured}
 * is the table, and the solver selects a row from it through `lrowif/4`. See
 * `emitAsked` in compile.ts for the other half.
 *
 * **And a state is not a pick.** A machine's states are all true at once in one
 * answer set — that is the invariant the whole feature is built on — so a state
 * that changes a font size, a weight, a family or the words themselves has a box
 * of its own that no axis of that table could ever address. It gets a table of
 * its own instead, filed under the copy's `stt(I,S,N)` term rather than under a
 * node id, because a state copy is deliberately not a `node/1` and there is no
 * node anywhere to hang one off. {@link stateMeasures} is that pass,
 * {@link stateBudget} is what it costs, and {@link measuredSize} is the one row
 * lookup both kinds of table are read by.
 */
import { componentDef, instanceNodes, instanceVariable } from "./components.ts";
import {
	machineForNode,
	materializedParts,
	statePart,
	statePropVar,
} from "./machines.ts";
import type { ModelScene } from "./model.ts";
import {
	KINDS,
	type MachineState,
	type PropName,
	PROPS,
	type Scene,
	type SceneNode,
	type Sizing,
	findStyle,
	frameOf,
	isLaidOut,
	layoutLength,
	layoutValueOf,
	layoutWord,
	propValueOf,
	styleOf,
	wornProps,
} from "./scene.ts";
import { findInTree, flatten, propValues } from "./tree.ts";
import {
	EMU_PER_PX,
	type Emu,
	cssPxFromEmu,
	emuFromCssPx,
	emuOf,
} from "./units.ts";
import {
	type Picks,
	type ResolveContext,
	type Term,
	type Token,
	type Value,
	findToken,
	frameVar,
	layoutVar,
	numeralOf,
	propVar,
	referencedTokens,
	resolveValue,
	stylePartVar,
	styleVar,
	tokenVar,
	varies,
} from "./values.ts";

/**
 * A box, in EMU — like every other length in the model.
 *
 * A measured size arrives from the font engine in float CSS pixels and crosses
 * at {@link sizeFromCssPx}; from there it is added to gaps and paddings that
 * are EMU, and it reaches the program as `lask/3`. Nothing between the two is
 * allowed to be pixels.
 */
export interface Size {
	width: Emu;
	height: Emu;
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
	/**
	 * Most significant first — the wording before the treatment. See
	 * {@link capAxes} for what the order decides, and {@link rowIndex} for why
	 * the position of an axis is also part of how a row is addressed.
	 */
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
 *
 * Which makes the order the whole of the decision, and it has two answers
 * because the two callers know different things. A leaf's axes are in
 * {@link MEASURED_PROPS} order, declared: the host is choosing what to *measure*
 * and cannot know what it would have found. A container's are sorted by
 * {@link byInfluence} first, because by then every child has been measured and
 * "which of these matters least" is a question with a number in it.
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
 *
 * `overridden` is the properties something later in the precedence chain has
 * already answered, and it exists for exactly one caller: a **state copy**,
 * where a delta saying `weight: bold` means the style's disagreement about the
 * weight no longer reaches the box. Without it a hover state that pins down
 * every property the style moves would still carry the style as an axis, and
 * the copy would be measured twice to produce the same two rows. Empty for a
 * document node, which is the only reason {@link measureAxes} is unchanged.
 */
function styleAffectsSize(
	scene: Scene,
	node: SceneNode,
	overridden: ReadonlySet<PropName> = new Set(),
): boolean {
	const style = styleOf(scene, node);
	if (!style || style.variants.length < 2) return false;
	const worn = wornProps(scene, node);
	return MEASURED_PROPS.some((prop) => {
		if (overridden.has(prop) || !worn.includes(prop)) return false;
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
 * One property answered by something ahead of the node in the precedence chain
 * — a state's delta, and nothing else today.
 *
 * Carries the variable as well as the value because the two come apart exactly
 * where a copy does: what a hover state says about the wording is the
 * definition's part `label` and the instance's `sprop(i1,hover,label,text)`, and
 * an axis has to be keyed by the variable the *program* branches on or the
 * `lrowif/4` it becomes matches no `pick/2` at all.
 */
interface Override {
	value: Value;
	variable: string;
}

/** Nothing overrides anything: the document node's own case. */
const NO_OVERRIDE = (): Override | undefined => undefined;

/**
 * Every pick that can change the box the host measures for this node, over one
 * namespace of variables.
 *
 * This is the honest indexing, and it is honest by construction rather than by
 * enumeration: for each property the measurement reads, whatever holds it
 * contributes its own alternatives — the node's value, or the style's variant
 * list, plus any token either names. So the degenerate cases cost nothing
 * without being special-cased. A node with a style but one wording and one
 * variant has no axes at all; a node with three wordings and no style has the
 * one axis it always had.
 *
 * Two of the three sources are parameters rather than fixtures because a state
 * copy reads the same document through different variables — see
 * {@link stateMeasures}. `ownVar` is where the node's own value branches
 * (`prop(t,text)` for a document node, `prop(inst(i1,label),text)` for an
 * instance's copy of a definition part) and `override` is what a delta says
 * instead. The **style** axes are not parameterised, and that is a claim rather
 * than an omission: `sty(S)` is one variable for the whole document — the
 * component rules re-mint a definition's *property* variables per instance and
 * deliberately not its wearing — so every copy of every instance in every state
 * reads the same treatment pick, and a second key would be a second answer to a
 * question with one.
 */
function typeAxes(
	scene: Scene,
	node: SceneNode,
	ownVar: (prop: PropName) => string,
	override: (prop: PropName) => Override | undefined = NO_OVERRIDE,
): MeasureAxis[] {
	const style = styleOf(scene, node);
	const worn = style ? wornProps(scene, node) : [];
	const overridden = new Set(MEASURED_PROPS.filter((p) => override(p) !== undefined));
	const styleMatters = styleAffectsSize(scene, node, overridden);
	const out: MeasureAxis[] = [];
	for (const prop of MEASURED_PROPS) {
		const said = override(prop);
		if (said) {
			out.push(...valueAxes(scene.tokens, said.value, said.variable));
			continue;
		}
		const own = node.props[prop];
		if (own && own.length > 0) {
			out.push(...valueAxes(scene.tokens, own, ownVar(prop)));
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

/** Every pick that can change the box the host measures for this node. */
export function measureAxes(scene: Scene, node: SceneNode): MeasureAxis[] {
	if (!autoSizes(node)) return [];
	return typeAxes(scene, node, (prop) => propVar(node.id, prop));
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
 *
 * Where the union is over the budget, {@link byInfluence} decides the order the
 * cap eats through, and only then: a table nothing is dropped from is the same
 * table whatever order it is written in, so a document under the budget — which
 * is nearly all of them — gets exactly the program it got before.
 */
export function askedAxes(
	scene: Scene,
	node: SceneNode,
	measured?: Measurements,
): { axes: MeasureAxis[]; dropped: string[] } {
	const raw = dedupe(rawAskedAxes(scene, node, measured));
	const capped = capAxes(
		rowCount(raw) > MEASURE_BUDGET ? byInfluence(scene, node, raw, measured) : raw,
	);
	const already = measuredTable(node, measured)?.dropped ?? [];
	return already.length === 0
		? capped
		: { axes: capped.axes, dropped: [...already, ...capped.dropped] };
}

/**
 * How far this axis alone moves what the node asks to be.
 *
 * The one number the drop order needs, and it is measured rather than guessed:
 * `naturalSize` is exactly the arithmetic the rows are made of, so this asks the
 * real question — take this variable through its alternatives, leave everything
 * else where the table would read it, and see how much the box travels. Which
 * makes it honest about the container's own arithmetic for free: a wording
 * inside a fixed-size child moves nothing, and neither does one whose width is
 * never the widest on the cross axis.
 *
 * Both dimensions, added, because a column's direction may itself be one of the
 * picks and there is then no one axis to call the interesting one.
 *
 * First-order, and deliberately: it holds the other axes at their first
 * alternative rather than crossing them, which is the same convention
 * {@link rowIndex} reads a dropped axis at, and it costs one evaluation per
 * alternative instead of the product this exists to avoid.
 */
function influence(
	node: SceneNode,
	axis: MeasureAxis,
	measured: Measurements | undefined,
	context: ResolveContext,
): number {
	let low = Number.POSITIVE_INFINITY;
	let high = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < axis.count; i++) {
		const size = naturalSize(node, measured, {
			...context,
			picks: { ...context.picks, [axis.variable]: i },
		});
		const total = size.width + size.height;
		low = Math.min(low, total);
		high = Math.max(high, total);
	}
	return high - low;
}

/**
 * The axes most worth keeping first — the ones whose alternatives disagree most
 * about the box.
 *
 * The cap drops off the tail, so the tail is what this decides. Before it, the
 * order was discovery order, which for a container is *tree* order: a column of
 * eight three-wording headings is 6561 combinations capped to 27 rows, and which
 * five children lost their wordings was whichever five came later in the
 * document. Measured on exactly that document — the four quiet headings first
 * and the four that move by hundreds of pixels last — tree order left a mean
 * error of 268px and a worst case of 428px against the exact size, and this
 * order leaves 1.75px and 90px. Same rows, same budget, same arithmetic; only
 * which axes survive it differs.
 *
 * Ties keep discovery order, so a document whose axes all matter equally is
 * still written in the order it is read in.
 */
function byInfluence(
	scene: Scene,
	node: SceneNode,
	axes: readonly MeasureAxis[],
	measured: Measurements | undefined,
): MeasureAxis[] {
	// The context `emitAsked` measures its rows in, so an axis is weighed in the
	// arithmetic it will be read in — a gap that names a spacing token above all,
	// which without the tokens here would look like an axis that moves nothing.
	const context: ResolveContext = { tokens: scene.tokens, picks: {} };
	const ranked = axes.map((axis, at) => ({
		axis,
		at,
		moves: influence(node, axis, measured, context),
	}));
	ranked.sort((a, b) => b.moves - a.moves || a.at - b.at);
	return ranked.map((entry) => entry.axis);
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
 * The row of a table one universe reads, or nothing where there is no table.
 *
 * Split out of {@link askedSize} so that the one thing that knows how a table is
 * addressed is reachable without a {@link SceneNode} — which is what a **state
 * copy** is: `stt(i1,hover,label)` has a table of its own and no node anywhere
 * to hang it off, because a copy is deliberately not a `node/1`. Both readers
 * therefore land on the same row for the same picks, which is the only reason a
 * copy's box and its instance's box can be compared at all.
 *
 * Out of range falls back to the first row: an alternative can be deleted
 * between a measurement and the solve that reads it.
 */
export function measuredSize(
	table: Measured | undefined,
	context?: ResolveContext,
): Size | undefined {
	if (!table) return undefined;
	return table.sizes[rowIndex(table.axes, context?.picks)] ?? table.sizes[0];
}

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
	const size = measuredSize(measuredTable(node, measured), context);
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

/* ------------------------------------------------------------------ */
/* The same words, in another state's typography                       */
/* ------------------------------------------------------------------ */

/**
 * What one state copy asks the font engine for, in one universe: the words, and
 * the four fields that decide the box they need.
 *
 * Strings rather than {@link Value}s because every pick has already been made by
 * the time one of these exists — a row *is* a combination — and strings rather
 * than a {@link FontSpec} because the fallbacks are the host's to supply and not
 * this side's to guess. `undefined` here means the document says nothing about
 * that field, which is a different claim from the empty string: the artboard's
 * own family is a fact about the canvas the text will be painted on, and it
 * lives beside the canvas.
 *
 * `text` is the one field with a floor, and only because a measurement of no
 * words is still a measurement — a state that clears a label is a state whose
 * box is empty, not one with no box.
 */
export interface TextRow {
	text: string;
	family?: string;
	size?: string;
	weight?: string;
	lineHeight?: string;
}

/**
 * One state copy the host should measure, and everything it needs to do it.
 *
 * Not a {@link SceneNode}, and the absence is the design rather than an
 * inconvenience. A state copy is not a `node/1` — the canvas, the layer list,
 * hit-testing and both export renderers must never see one — so handing the host
 * a synthetic node with a `stt(i1,hover,label)` id would be handing every reader
 * of `scene.nodes` a thing this whole feature exists to keep out of them. The
 * host does not need a node: it needs a key to file the table under, the axes to
 * key the rows by, and the strings to measure. That is exactly this.
 *
 * The `id` is the copy's term, so the table lands in {@link Measurements} beside
 * the document's own tables and is read back by {@link measuredSize} with the
 * same arithmetic.
 */
export interface StateMeasure {
	/** The key the table goes under: `stt(i1,hover,label)`. */
	id: string;
	/** The instance node the copy belongs to. */
	instance: string;
	state: string;
	/** The definition part being measured. */
	part: string;
	axes: MeasureAxis[];
	/** Variables left out of `axes` to stay inside the budget — see {@link stateBudget}. */
	dropped: string[];
	/** One per combination of `axes`, in {@link rowPicks} order. */
	rows: TextRow[];
}

/**
 * How many rows one *copy* of a part may have, given how many copies of it there
 * are to measure.
 *
 * {@link MEASURE_BUDGET} is a budget per table, and a machine does not make one
 * table bigger — it makes more tables. So the extension is not a second budget
 * with a second number to justify; it is the same budget, asked the one question
 * states introduce: **who pays for the copies.** Two answers, and both of them
 * are the invariant, one level down from where it is usually stated.
 *
 * **The document's own node keeps its budget whole.** `askedAxes` for a document
 * node is what it was, to the row, whatever machines the document holds. This is
 * the measurement-side of "adding a four-state machine must not change the
 * document": if a hover state could cost the base node an axis, adding a state
 * would move a box in the *rest* state — the picture the designer is actually
 * looking at — and a feature that repaints what it was not asked to change is
 * not a feature, it is a bug with a panel.
 *
 * **The copies share one budget between them.** All the copies of one part get
 * `MEASURE_BUDGET` rows between them, so a part measured in two states gets 16
 * rows each and one measured in four gets 8. Which bounds the whole feature's
 * measurement cost at **twice** a machine-less document's — the same shape of
 * promise the universe count makes, in milliseconds instead of designs.
 *
 * The floor is one row, and it is where that bound stops being exactly twice.
 * Past thirty-two copies of a single part there is nothing left to divide, and a
 * copy with no rows is not a cheap copy, it is a copy with no box: the row lookup
 * would fall through to a frame the definition drew before any state existed. So
 * a machine with more states than the budget has rows costs one measurement per
 * state, which is the least anybody could have meant by measuring them, and it is
 * linear rather than a cliff.
 *
 * Evenly, and not weighted toward the state the instance is drawn in, though
 * that copy is the one whose box is on screen. Which state is shown is an
 * *edit*, so a budget that favoured it would re-measure the document every time
 * somebody clicked along the state strip — and playing a state costing nothing
 * is the whole reason the strip works. A budget that changes with a selection is
 * a budget that makes the tool feel broken in exactly the interaction it was
 * added for.
 *
 * What gets dropped *within* a copy is not decided here and needs no new rule:
 * {@link capAxes} keeps the first axis whatever it costs and eats the tail, and
 * the axes arrive in {@link MEASURED_PROPS} order — so the **wording survives
 * and the treatment goes first**, in a copy for the same reason and by the same
 * line as in the node it is a copy of. Ordering by {@link byInfluence} instead
 * would need the boxes to have been measured already, and this is the pass that
 * measures them; that ordering is the compiler's, where the numbers exist.
 */
export const stateBudget = (copies: number, budget = MEASURE_BUDGET): number =>
	copies <= 1 ? budget : Math.max(1, Math.floor(budget / copies));

/**
 * Whether this state says anything about this part that changes the box.
 *
 * The strongest lever in the whole budget, and it is the shared-variable
 * economy again rather than a new idea: what a state does not touch, it shares.
 * A four-state machine whose hover delta is a fill mints **no** tables at all,
 * and a machine whose `pressed` state moves a badge two pixels down mints none
 * either — geometry is not typography, and a copy whose words and font are the
 * instance's has the instance's box by construction. Only a delta that reaches
 * one of {@link MEASURED_PROPS} is worth a row.
 *
 * A hidden copy is worth none: a state that takes a part out of the picture is a
 * state with no box to be wrong about, and measuring it would be measuring
 * something nobody can see in a font nobody sees it in.
 */
function stateChangesType(state: MachineState, part: string): boolean {
	const delta = state.parts[part];
	if (!delta || delta.hidden === true) return false;
	return MEASURED_PROPS.some((prop) => (delta.props?.[prop]?.length ?? 0) > 0);
}

/**
 * Every state copy in the document whose box is not its instance's, with the
 * rows the host should measure for it.
 *
 * **Why this exists at all.** Text is measured in TypeScript, before the solve,
 * from the document — that is what keeps the compiler pure and testable in Node,
 * and it is stated at the top of this file. The measurement table is keyed by
 * *picks*: `lask/3`, `lrow/4` and an `lrowif/4` per axis, where a row holds in
 * the universes that picked a given alternative. **A state is not a pick** — that
 * is the one invariant the whole machine feature is built to keep — so a state
 * cannot ride that mechanism, cannot be an axis, and must not become one. What it
 * can be is what it already is everywhere else in the feature: its own term, with
 * its own table, keyed by the picks that really are picks.
 *
 * So a copy's axes are the same three sources any node's are, read through the
 * variables the *program* actually branches on:
 *
 *   - a property the state's delta answers is the delta's own variable,
 *     `sprop(I,S,N,P)`, and branches only where the designer wrote alternatives
 *     inside the delta — which is a design decision like any other;
 *   - a property the state says nothing about is the **instance's** one shared
 *     variable, `prop(inst(I,N),P)`, exactly as the program's inherit rule reads
 *     it. This is the invariant paying for itself in measurements: a headline
 *     with three wordings under a four-state machine is three boxes per copy, not
 *     3⁴, because the copies read one variable rather than four;
 *   - a property the part's **style** decides is `sty(S)`, which is one variable
 *     for the whole document and is therefore not re-keyed per copy at all.
 *
 * Per instance, and not per (machine, state, part), because the values are the
 * instance's: two uses of one button hover to whatever their own held picks say,
 * exactly as they rest at whatever their own held picks say. Bounded the same way
 * the grounding is — only {@link materializedParts}, only what
 * {@link stateChangesType} says is worth a row — so the usual button contributes
 * nothing and a machine that restyles a label contributes one table per state
 * that restyles it.
 *
 * **What this does not do**, so that nobody reads a promise into it. It measures
 * *leaves*: a part that hugs its own content. It does not lay a copy out and it
 * does not compute a container copy's natural size, because an instance's copy of
 * a laid-out definition does not re-solve its layout in the first place — there
 * is no `lask/3` for `inst(I,N)` today, so there is nothing for a per-state
 * container arithmetic to be the second half of. A state that changes the wording
 * of a hugging text node still does not resize the frame around it, and that
 * remains a named exclusion rather than a silence.
 *
 * **And nothing calls it yet.** This is the analysis half of a pass whose other
 * half — a host that runs a canvas over these rows, and a compiler that turns the
 * answers into `lask/3` for a `stt(I,S,N)` term — is not written, so no exported
 * file and no canvas is any different for its existence. It is recorded here
 * rather than left for a reader to discover, because a function this size that is
 * exported from the package index reads as shipped behaviour and is not: the
 * spec's §3.6 excludes per-state measurement outright, both the exporter and the
 * Machines panel say so to the designer in as many words, and this exists as the
 * proof that the exclusion is a wiring job rather than a consequence of the
 * encoding — the invariant survives it, which is the part that was worth settling
 * before anyone builds the rest.
 */
export function stateMeasures(
	scene: Scene,
	budget = MEASURE_BUDGET,
): StateMeasure[] {
	const out: StateMeasure[] = [];
	// The context the rows resolve in: the tokens, and every node property by
	// variable key so a delta written as a derivation can read one. The same
	// context the host builds for the document's own nodes, because a copy that
	// resolved its values differently would be measured for a design that is not
	// in the answer set.
	const base: ResolveContext = {
		tokens: scene.tokens,
		picks: {},
		props: propValues(scene.nodes),
	};
	/**
	 * One analysis per machine rather than one per instance — the parts and the
	 * states that touch them are facts about the *definition*, and the instances
	 * multiply them for nothing. The same split the program makes, where `mpart/2`
	 * is emitted once per machine and `mcopy/3` derives the instances from it.
	 */
	const cache = new Map<string, Array<{ node: SceneNode; states: MachineState[] }>>();

	for (const instance of instanceNodes(scene)) {
		const machine = machineForNode(scene, instance);
		if (!machine) continue;
		let plan = cache.get(machine.id);
		if (plan === undefined) {
			const def = componentDef(scene, machine.root);
			const materialised = materializedParts(scene, machine);
			plan = (def?.parts ?? [])
				.filter((part) => materialised.has(part.id) && autoSizes(part))
				.map((node) => ({
					node,
					states: machine.states.filter((state) => stateChangesType(state, node.id)),
				}))
				.filter((entry) => entry.states.length > 0);
			cache.set(machine.id, plan);
		}
		for (const { node, states } of plan) {
			const share = stateBudget(states.length, budget);
			for (const state of states) {
				const override = (prop: PropName): Override | undefined => {
					const value = state.parts[node.id]?.props?.[prop];
					return value && value.length > 0
						? {
								value,
								variable: statePropVar(instance.id, state.id, node.id, prop),
							}
						: undefined;
				};
				const { axes, dropped } = capAxes(
					typeAxes(
						scene,
						node,
						(prop) => instanceVariable(instance.id, node.id, prop),
						override,
					),
					share,
				);
				const rows: TextRow[] = [];
				for (let row = 0; row < rowCount(axes); row++) {
					const picks = rowPicks(axes, row);
					const at = { ...base, picks };
					/**
					 * The delta first, then the part as the document dresses it — its
					 * own value or its style's, at this row's variant, through
					 * `propValueOf` and so by the same precedence the program applies.
					 *
					 * A delta that resolves to nothing — a dangling token, a cycle —
					 * falls through to the base rather than to the empty string,
					 * because that is what the program does: `msprop/4` is derived from
					 * `resolved(sprop(...),_)`, so an override nothing can resolve is an
					 * override the copy never takes. The base is then read at whatever
					 * this row says, which for a property the delta answered is its
					 * first alternative — the same convention {@link rowIndex} reads a
					 * dropped axis at, and a dangling reference is a document being
					 * repaired rather than a design being described.
					 */
					const read = (prop: PropName): string | undefined => {
						const said = override(prop);
						if (said) {
							const resolved = resolveValue(at, said.value, said.variable);
							if (resolved !== undefined) return resolved;
						}
						return resolveValue(
							at,
							propValueOf(scene, node, prop, picks),
							instanceVariable(instance.id, node.id, prop),
						);
					};
					rows.push({
						text: read("text") ?? "",
						family: read("fontFamily"),
						size: read("size"),
						weight: read("weight"),
						lineHeight: read("lineHeight"),
					});
				}
				out.push({
					id: statePart(instance.id, state.id, node.id),
					instance: instance.id,
					state: state.id,
					part: node.id,
					axes,
					dropped,
					rows,
				});
			}
		}
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* The one approximation that cannot report itself                     */
/* ------------------------------------------------------------------ */

/** How many wearers a note names before it starts counting them instead. */
const NAMED = 4;

/**
 * Boxes measured in a font the answer set does not use.
 *
 * Every other approximation in this file announces itself where the arithmetic
 * happens: a dropped axis is a variable this table left out, and `emitAsked`
 * writes it into the generated program as a comment. This one has nothing to
 * drop. A rule that asserts `sty_wears/3` dresses a node the measurement pass
 * has already measured — that pass runs before the solve and reads the
 * *document*, where no such wearing exists — so there was no axis to give up and
 * nothing was rounded off. The box is simply the wrong box, quietly, and the
 * only place the condition exists at all is the answer set: `sty_derived/3` is
 * precisely "wearing the document does not know about".
 *
 * So the signal is read back rather than derived here, and it costs no atoms on
 * a document nobody dressed by hand. Three things have to be true before a word
 * is said, and each removes a way of crying wolf:
 *
 *   - the node's size came from a **measurement** — a table the host filled in.
 *     Where nothing measured it there is no measurement to be wrong;
 *   - the wearing covers a property the measurement **reads**. A rule that hands
 *     a heading a fill changes no box;
 *   - and the node is one the **document** holds. An instance's copy is in
 *     `sty_derived/3` too and is never measured: its size comes from the
 *     definition's own table, which the document did measure, style included.
 *
 * Worded as clingo words a remark about a program that ran anyway, `info:` and
 * all, because that is what this is and because it shares the panel's band and
 * its count with the ones clingo writes — see `countDiagnostics`.
 */
export function measurementNotes(
	scene: Scene,
	models: readonly Pick<ModelScene, "wears">[],
	measured?: Measurements,
): string[] {
	/** One note per style and property set; the nodes are what accumulates. */
	const grouped = new Map<string, { style: string; props: PropName[]; nodes: string[] }>();
	for (const model of models) {
		for (const [style, wearers] of Object.entries(model.wears)) {
			for (const wearer of wearers) {
				const node = findInTree(scene.nodes, wearer.node);
				if (!node || !measuredTable(node, measured)) continue;
				const props = MEASURED_PROPS.filter((prop) => wearer.props.includes(prop));
				if (props.length === 0) continue;
				const key = `${style}\u0000${props.join(",")}`;
				const at = grouped.get(key);
				if (!at) grouped.set(key, { style, props, nodes: [wearer.node] });
				else if (!at.nodes.includes(wearer.node)) at.nodes.push(wearer.node);
			}
		}
	}
	return [...grouped.values()].map(({ style, props, nodes }) => {
		const named = findStyle(scene.styles, style)?.name ?? style;
		const rest = nodes.length - NAMED;
		const one = nodes.length === 1;
		return (
			`info: a rule dresses ${nodes.slice(0, NAMED).join(", ")}` +
			`${rest > 0 ? ` and ${rest} more` : ""} in “${named}”, which the` +
			" document does not say. Text is measured before the solve and from" +
			` the document, so ${one ? "that box hugs" : "those boxes hug"} the ` +
			props.map((prop) => PROPS[prop].label.toLowerCase()).join(" and ") +
			` the document gives ${one ? "it" : "them"}, not the treatment's.`
		);
	});
}

/* ------------------------------------------------------------------ */
/* The font engine's boundary                                          */
/* ------------------------------------------------------------------ */

export interface FontSpec {
	/** A CSS font-family list, as stored. */
	family: string;
	/** A length as the document stores it — `"16px"`, `"12pt"`, `"14288emu"`. */
	size: string;
	weight: string;
}

/**
 * A CSS `font` shorthand — the one string a canvas 2D context understands, and
 * the form pretext wants. Order is fixed by CSS: weight, then size, then the
 * family list.
 *
 * The size is converted rather than passed through, and both halves of that
 * matter. A canvas *would* accept `12pt` — CSS units are legal in the shorthand
 * — and would then measure at 16px while anything reading the same literal with
 * a parser of its own got 12, which is precisely the silent, wrong-direction
 * disagreement this module's single boundary exists to prevent. And the `emu`
 * spelling is not CSS at all (see `UnitSpec.css`), so a document holding one
 * would make the whole shorthand unparseable and the engine would quietly
 * measure in the default font — a box wrong by whole characters, with nothing
 * anywhere saying so. A size that is not a length falls back to the document's
 * own default, which is what a node that says nothing means.
 */
export function fontString(spec: FontSpec): string {
	return `${spec.weight} ${cssPxFromEmu(fontSizeEmu(spec.size))}px ${spec.family}`;
}

/**
 * The font size a measurement reads, in EMU: what was said, or what a node
 * saying nothing means.
 *
 * The second fallback is belt and braces and stays: `PROPS.size.fallback` is
 * exact today and this file would rather measure at 16px than at zero if
 * someone ever writes a fallback no unit spells.
 */
const fontSizeEmu = (value: string | undefined): Emu =>
	emuOf(value ?? "") ?? emuOf(PROPS.size.fallback) ?? 16 * EMU_PER_PX;

/**
 * How tall one line is, in EMU.
 *
 * CSS reads a unitless line-height as a multiple of the font size and a length
 * as itself; the inspector offers the former, but a document may hold either.
 * Which is why the two readers are tried in that order rather than merged: a
 * bare `1.5` is a *ratio* and would otherwise read as 1.5 pixels, and `numeralOf`
 * refusing a suffix is what keeps the two apart.
 *
 * The product of a ratio and an EMU is not generally an integer, and that is
 * fine — a leading is in flight, never stored, and `Emu` is integral only where
 * it is stored. Rounding it here would be a quantization with no caller asking
 * for one.
 */
export function lineHeightEmu(
	fontSize: string | undefined,
	lineHeight: string | undefined,
): Emu {
	const size = fontSizeEmu(fontSize);
	const raw = (lineHeight ?? "").trim();
	const ratio = numeralOf(raw);
	if (ratio !== undefined) return size * ratio;
	const length = emuOf(raw);
	if (length !== undefined) return length;
	return size * (numeralOf(PROPS.lineHeight.fallback) ?? 1.35);
}

/**
 * The same leading in float CSS pixels, for the line walker that lays glyphs
 * out — one of the two directions across this file's seam, and named for it.
 */
export const lineHeightPx = (
	fontSize: string | undefined,
	lineHeight: string | undefined,
): number => cssPxFromEmu(lineHeightEmu(fontSize, lineHeight));

/**
 * A box the font engine measured, as a length the model can hold.
 *
 * The one place in the tree where a float legitimately becomes EMU by way of
 * text — the host calls it on `measureText`'s return, and the row it stores in
 * a {@link Measured} table is EMU from then on. Whole EMU, because a measured
 * box *is* stored: it travels to the compiler and reaches `lask/3`, which is a
 * clingo fact and must be an integer. The quantization is 1/914400 of an inch,
 * four decimal orders below anything the shaper could have meant.
 *
 * Deliberately not doing the rounding-up the host does: how much slack a
 * measured box needs is a question about wrapping, which belongs beside the
 * line walker, and this is only the conversion.
 */
export const sizeFromCssPx = (size: { width: number; height: number }): Size => ({
	width: emuFromCssPx(size.width),
	height: emuFromCssPx(size.height),
});
