/**
 * Values, alternatives and tokens.
 *
 * The unit of variation is an *assignment*, not a token. Any value — a node's
 * fill, or a token's own definition — is a list of alternatives; a list longer
 * than one is what makes the design branch. That inverts the earlier model,
 * where a fixed roster of tokens each carried their own multiplicity.
 *
 * A token is then exactly a CSS custom property: a name bound to a value, that
 * any number of places can reference. It has no special powers; it is just a
 * value that happens to be shared.
 */
import { parseAtom } from "./atoms.ts";

export type ValueType =
	| "color"
	| "length"
	| "number"
	| "count"
	| "duration"
	| "angle"
	| "weight"
	| "font"
	| "align"
	| "shadow"
	| "text"
	| "direction"
	| "placement"
	| "justify"
	| "sizing"
	| "fit"
	| "growth"
	| "solid"
	| "lamp"
	// The paint layer above a fill — see `docs/framer-paint-spec.md` §2.1.
	// Neither is a {@link Quantity}: a gradient recipe is a CSS string and a mix
	// mode is a word, and neither has a reader that turns it into a number. The
	// literal bridges are therefore untouched by this pair, which is what lets
	// the whole feature land without a line of `compile.ts`.
	| "gradient"
	| "mix";

/** One entry of a closed menu — see {@link ValueTypeSpec.options}. */
export interface ValueOption {
	/** Stored in the document, and what the renderer receives. */
	value: string;
	/** What the menu calls it. */
	label: string;
}

/**
 * The numeric quantities a literal can be, and hence the readers that turn one
 * into a number. There is exactly one reader per name, and that is the whole
 * test for whether a name belongs here — see {@link ValueTypeSpec.quantity}.
 *
 * `length` is EMU and is read by `emuOf`, which is exact or nothing. `ratio` is
 * a bare decimal with no unit — a line height, an opacity — and is read by
 * {@link numeralOf}. `count` is a whole number of things and is read by
 * {@link tallyOf}. They are names rather than "the numeric-looking ones"
 * because the sweep that turned every length into EMU had to be certain it was
 * not turning 1.35 into 12350.
 *
 * `time` is the fourth, and the first that is not a distance, a proportion or a
 * tally of things: a whole number of milliseconds, read by {@link msOf}. It is
 * a quantity of its own rather than a `count` of milliseconds because the two
 * readers disagree about the text — a count refuses a suffix and `time` demands
 * one, `"200"` is two hundred columns and no duration at all, and `"0.2s"` is
 * two hundred milliseconds and no count. Filing time under count would make
 * `"200"` a fifth of a second on a machine and two hundred tracks on a grid,
 * decided by which caller happened to ask.
 *
 * `angle` is the fifth, and it passes exactly the test `time` passed. Its reader
 * is {@link mdegOf}, which accepts text no other reader here accepts (`"45deg"`,
 * `"0.25turn"`, `"50grad"`) and refuses text every one of them takes: `"45"` is
 * forty-five columns to {@link tallyOf} and forty-five thousandths of nothing to
 * a rotation, so it reads as no angle at all. Filing a rotation under `ratio`
 * would make a bare `45` mean a turn on a mesh and a line height on a text,
 * decided — again — by which caller happened to ask.
 *
 * **A quantity is a question, not a boundary.** That distinction is worth
 * writing down here because the thing added to this file beside `angle` looked
 * like a sixth quantity and is not one: {@link permilleOf} reads a `ratio` as a
 * whole number of thousandths, so a ratio can reach a program that has no floats
 * in it. It is to {@link numeralOf} what `emuOf` is to a float count of pixels —
 * the integer boundary reader for a quantity that has been here since the
 * beginning — and a `Quantity` member for it would be a name that changed no
 * answer, which is the same trap the `weight` note above steps around.
 *
 * The count that *does* go up with it is the count of **literal bridges** — the
 * facts a literal reaches the program as. There are six: `numeral`, `tally`,
 * `word`, `millis`, `permille` and `mdeg`. Five quantities and six bridges is
 * not an off-by-one; it is `ratio` having two readers and every other quantity
 * having one.
 */
export type Quantity = "length" | "ratio" | "count" | "time" | "angle";

export interface ValueTypeSpec {
	label: string;
	/** What an empty assignment of this type starts at, and falls back to. */
	fallback: string;
	/**
	 * What kind of number this type holds, where it holds one at all.
	 *
	 * Absent for the enumerated and text types: a direction is a word and a
	 * headline is prose, and neither is read as a quantity by anything. The
	 * column is here rather than at the four call sites that used to ask
	 * `type === "length"` by hand, because a table gets edited once and four
	 * conditionals drift.
	 *
	 * A `weight` is filed under `ratio`, which it is not — 400 is an index into
	 * a font family, not a proportion of anything. But "a bare number with no
	 * unit, compared and interpolated as itself" is exactly what the ratio
	 * reader does, and a quantity naming one type and calling {@link numeralOf}
	 * would be a column that changed no answer.
	 *
	 * The test is therefore a *reader*, never a count of inhabitants. `time` has
	 * one inhabitant too — `duration` — and it earns its column anyway, because
	 * {@link msOf} reads text no other reader accepts and refuses text they all
	 * take: `"200ms"` is a duration and nothing else, `"200"` is a count and no
	 * duration at all. A weight has no such text of its own.
	 */
	quantity?: Quantity;
	/**
	 * A closed set of choices. The editor offers a menu for these rather than a
	 * text field, and the stored value is still the literal CSS the renderer
	 * wants — a label is only what the menu calls it. So an enumerated type
	 * costs the renderer nothing: there is no name-to-declaration table on the
	 * other side, and a value typed before the list existed still paints.
	 */
	options?: readonly ValueOption[];
	/**
	 * Edited in a box that takes more than a line. Copy is the only value here
	 * that is prose rather than a token-sized quantity, and typing a paragraph
	 * into a one-line field is the difference between an editor and a form.
	 */
	multiline?: boolean;
}

/**
 * No webfonts are available offline, so the roster is system stacks — a small
 * curated set rather than a free text field nobody can spell correctly.
 */
const FONTS: ValueOption[] = [
	{
		value: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
		label: "Sans",
	},
	{
		value: 'Georgia, Cambria, "Times New Roman", Times, serif',
		label: "Serif",
	},
	{
		value: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
		label: "Mono",
	},
	{
		value:
			'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", system-ui, sans-serif',
		label: "Rounded",
	},
];

/**
 * An elevation ramp rather than an offset/blur/colour triple.
 *
 * A shadow that is four coupled numbers is four rows in the inspector and four
 * ways to make something that looks wrong; every design tool ships a ladder
 * instead. Storing the whole declaration keeps it one variable, so "either of
 * these two elevations" branches the space exactly like a fill does.
 */
const SHADOWS: ValueOption[] = [
	{ value: "none", label: "None" },
	{ value: "0 1px 2px rgba(15,23,42,0.10)", label: "Subtle" },
	{ value: "0 2px 8px rgba(15,23,42,0.14)", label: "Soft" },
	{ value: "0 8px 24px rgba(15,23,42,0.18)", label: "Raised" },
	{ value: "0 20px 48px rgba(15,23,42,0.24)", label: "Floating" },
];

/**
 * What a gradient is made of when nobody has said.
 *
 * Exported and named rather than typed out, because the same pair of colours has
 * to be spelled in three places that cannot be allowed to disagree: the `var()`
 * fallbacks inside every recipe in {@link GRADIENTS}, the `fallback` of
 * `PROPS.gradientFrom` and `PROPS.gradientTo` — which is what the inspector row
 * shows before anybody types — and the `initial-value` of the registered custom
 * properties in `CUSTOM_PROPERTY_RULES`. Three copies of `#ffffff` is a design
 * where the row says one colour and the box paints another, and nothing about
 * that failure looks like a bug: it looks like the picture.
 *
 * White to slate, because a gradient a designer has only chosen the *direction*
 * of should read as a gradient at a glance — a pair that differed by a hair
 * would look like a rendering fault, and a pair that differed by a hue would be
 * an opinion about somebody's palette.
 */
export const GRADIENT_FROM = "#ffffff";
export const GRADIENT_TO = "#94a3b8";

/** Both ends, as the two `var()`s every recipe below shares. */
const STOPS = `var(--gfrom, ${GRADIENT_FROM}), var(--gto, ${GRADIENT_TO})`;

/**
 * A direction, not a picture.
 *
 * This is the half of a gradient that genuinely *is* a closed menu, and
 * separating it from the half that is not is the whole design. Which way a
 * gradient runs is a small, finite, colour-free decision — the same kind of
 * thing {@link FITS} and {@link PLACEMENTS} are — while what colours it runs
 * between is the design's own palette, and belongs to two `color` properties
 * that can name a token. A roster of complete gradient strings would have been
 * the {@link SHADOWS} move, and it fails here for the reason it succeeds there:
 * a shadow is colourless and a gradient is nothing *but* colour. A frozen roster
 * would be somebody else's palette, unable to name a token, unable to branch,
 * unable to follow a style variant or be repainted by a machine state — every
 * single thing this document model is for, switched off for the one property
 * where a designer most wants it.
 *
 * Every entry names both `--gfrom` and `--gto` with a literal fallback, so a
 * node that has chosen a direction and nothing else still paints a gradient
 * rather than nothing at all. A missing custom property makes the whole
 * declaration invalid at computed-value time, which in CSS means the gradient
 * silently disappears — the exact failure a `var()` fallback exists to prevent.
 *
 * `none` first and as the fallback, unlike {@link SHADOWS}, whose fallback is
 * its second entry: a shadow is an elevation and "no shadow" is a rung on that
 * ladder, while a gradient is a flourish and the great majority of boxes do not
 * want one. A new alternative on this row should start at "no gradient".
 *
 * Rejected: an eighth `gradientAngle` property, so the angle could name an
 * `angle` token. It was the closest thing to being in, and it is out because the
 * row would be live for a third of this menu and inert for the rest — a radial
 * and a conic gradient do not read an angle the way a linear one does — and the
 * inspector has no mechanism for a row that greys itself out on another row's
 * *value*. `PropSpec.needs` tests presence, not content, deliberately.
 */
const GRADIENTS: ValueOption[] = [
	{ value: "none", label: "None" },
	{ value: `linear-gradient(180deg, ${STOPS})`, label: "Linear, down" },
	{ value: `linear-gradient(0deg, ${STOPS})`, label: "Linear, up" },
	{ value: `linear-gradient(90deg, ${STOPS})`, label: "Linear, right" },
	{
		value: `linear-gradient(135deg, ${STOPS})`,
		label: "Linear, down and right",
	},
	{
		value: `radial-gradient(circle at 50% 50%, ${STOPS})`,
		label: "Radial, from the centre",
	},
	{
		value: `radial-gradient(circle at 0% 0%, ${STOPS})`,
		label: "Radial, from the corner",
	},
	{ value: `conic-gradient(from 180deg at 50% 50%, ${STOPS})`, label: "Conic" },
];

/**
 * How a layer's colours meet what is painted behind it — CSS `mix-blend-mode`.
 *
 * **Every value here is one lower-case word, and that is a constraint rather
 * than a coincidence.** {@link wordOf} accepts `/^[a-z][A-Za-z0-9_]*$/` and
 * nothing else, so a value with a dash in it reaches the program as a quoted
 * string and emits no `word/2` beside it. That is perfectly legal — a colour and
 * a shadow are exactly that — but it would make this the first *enumerated*
 * roster in the file where half the entries carry a word and half do not, and a
 * rule that reads `word(L,multiply)` and finds nothing for `soft-light` is a
 * rule that is right about eight modes and quietly wrong about four.
 *
 * So the four CSS modes whose names are hyphenated — `color-dodge`,
 * `color-burn`, `hard-light` and `soft-light` — are **out**, and this is the one
 * place in this feature where something real is given up. Soft light in
 * particular is a mode designers reach for. Two things make it bearable: a
 * curated roster is what this file already does everywhere (four font stacks out
 * of thousands, five elevations out of infinity), and the alternative — storing
 * `softLight` and translating it in `PAINT` the way `fit` translates `stretch`
 * to `fill` — buys the four modes at the price of the rule that an enumerated
 * value *is* the CSS it paints with, which is what makes an enumerated type cost
 * the renderer nothing and what makes a value written before the menu existed
 * still paint. `fit` is the exception because `fill` was already taken in this
 * vocabulary by the colour a box is painted; there is no such collision here,
 * only a hyphen. Four modes is a cheaper thing to lose than that rule.
 *
 * `normal` first and as the fallback, because it is CSS's initial value: a row
 * that has never been touched must mean "composite the ordinary way".
 */
const MIXES: ValueOption[] = [
	{ value: "normal", label: "Normal" },
	{ value: "multiply", label: "Multiply" },
	{ value: "screen", label: "Screen" },
	{ value: "overlay", label: "Overlay" },
	{ value: "darken", label: "Darken" },
	{ value: "lighten", label: "Lighten" },
	{ value: "difference", label: "Difference" },
	{ value: "exclusion", label: "Exclusion" },
	{ value: "hue", label: "Hue" },
	{ value: "saturation", label: "Saturation" },
	{ value: "color", label: "Colour" },
	{ value: "luminosity", label: "Luminosity" },
];

const ALIGNS: ValueOption[] = [
	{ value: "left", label: "Left" },
	{ value: "center", label: "Centre" },
	{ value: "right", label: "Right" },
];

/*
 * The layout vocabulary. These reach ASP as bare constants rather than as CSS
 * — nothing renders them, the solver reads them — so each stored value is
 * already the word the generated program wants; see {@link wordOf}.
 */

const DIRECTIONS: ValueOption[] = [
	{ value: "row", label: "Row" },
	{ value: "column", label: "Column" },
];

/** Where a child sits on the axis it is not stacked along. */
const PLACEMENTS: ValueOption[] = [
	{ value: "start", label: "Start" },
	{ value: "center", label: "Centre" },
	{ value: "end", label: "End" },
	{ value: "stretch", label: "Stretch" },
];

const JUSTIFICATIONS: ValueOption[] = [
	{ value: "start", label: "Start" },
	{ value: "center", label: "Centre" },
	{ value: "end", label: "End" },
	{ value: "spaceBetween", label: "Space between" },
];

const SIZINGS: ValueOption[] = [
	{ value: "hug", label: "Hug contents" },
	{ value: "fixed", label: "Fixed" },
];

/**
 * Whether a child takes a share of the leftover space.
 *
 * Two named options rather than a boolean value kind: the whole point of the
 * value system is that an assignment can hold alternatives, name a token and
 * be resolved per universe, and a second kind of leaf — one that is true or
 * false rather than a string — would need all of that machinery again for one
 * field. A closed menu of two already is a boolean, spelled the way every
 * other value is.
 */
/**
 * How a picture sits in a box that is not its shape.
 *
 * The three CSS `object-fit` values worth offering, under the names a designer
 * would use rather than the ones the property uses: a box is almost never the
 * aspect of the photograph put in it, and which of the three you want is a
 * design decision made per image rather than a default anybody could pick.
 *
 * `cover` first, because it is the answer for the case that brought this here —
 * a photograph filling a card — and a first alternative is what a value that
 * says nothing comes to.
 */
const FITS: ValueOption[] = [
	{ value: "cover", label: "Fill the box, cropping" },
	{ value: "contain", label: "Fit inside, letterboxed" },
	{ value: "stretch", label: "Stretch to the box" },
];

const GROWTH: ValueOption[] = [
	{ value: "fixed", label: "Keep its size" },
	{ value: "grow", label: "Fill the leftover space" },
];

/*
 * The two 3D vocabularies. Both are closed menus for {@link GROWTH}'s reason and
 * for one more: which primitive a mesh is, and which kind of lamp a light is,
 * are *design decisions* — `[box, sphere]` is a real question with two answers,
 * and a `solid` token six meshes point at is a family that changes shape
 * together. A field on the node would have made that a second kind of variation
 * with a second editor and no token link.
 *
 * The stored `value`s are ASP constants and reach the program as themselves, the
 * way `spaceBetween` and `row` do — see {@link wordOf}. Nothing renders them as
 * CSS, so unlike a shadow or a font stack there is no declaration hiding in the
 * string.
 */
const SOLIDS: ValueOption[] = [
	{ value: "box", label: "Box" },
	{ value: "sphere", label: "Sphere" },
	{ value: "cylinder", label: "Cylinder" },
	{ value: "cone", label: "Cone" },
	{ value: "plane", label: "Plane" },
	{ value: "torus", label: "Torus" },
];

const LAMPS: ValueOption[] = [
	{ value: "ambient", label: "Ambient" },
	{ value: "directional", label: "Directional" },
	{ value: "point", label: "Point" },
	{ value: "spot", label: "Spot" },
];

/**
 * What each type of value is, in one place: its name, what an empty one starts
 * at, and whether it is a closed set of choices.
 */
export const VALUE_TYPES: Record<ValueType, ValueTypeSpec> = {
	color: { label: "Colour", fallback: "#94a3b8" },
	length: { label: "Length", fallback: "8px", quantity: "length" },
	number: { label: "Number", fallback: "1", quantity: "ratio" },
	/**
	 * How many of something — columns in a grid, rows in one.
	 *
	 * Not `number`, whose fallback is `"1"` and whose inhabitants are 1.35 line
	 * heights: a count of 1.35 is a typo rather than a design, and a rule that
	 * grounds `1..N` over one needs a whole number or it needs nothing.
	 */
	count: { label: "Count", fallback: "1", quantity: "count" },
	/**
	 * How long something takes — the fourth quantity, and the first one that is
	 * not a distance, a proportion or a tally of things.
	 *
	 * A duration is a value like any other, which is the whole reason it is a
	 * type rather than a number on a transition: a `duration` token holding
	 * `["120ms", "240ms"]` *is* a motion scale, one place that decides how
	 * quickly the whole design moves, and pointing every transition at it is the
	 * same act as pointing every gap at a spacing token. Nothing else in the
	 * system had to learn a word for that to be true.
	 *
	 * Read by {@link msOf}, which is exact or nothing for the same reason
	 * `emuOf` is: a duration reaches ASP as an integer count of milliseconds,
	 * and a fact has to be an integer.
	 */
	duration: { label: "Duration", fallback: "200ms", quantity: "time" },
	/**
	 * How far something is turned — the fifth quantity, and the first that is
	 * periodic.
	 *
	 * A type rather than a `number` for `duration`'s reason exactly: an `angle`
	 * token holding `["0deg", "12deg"]` *is* a decision about how lively a design
	 * is, one place that tilts every card wearing it, and pointing six rotations
	 * at it is the same act as pointing every gap at a spacing token. A camera's
	 * field of view is the same value type, which is what lets "wide and long" be
	 * two universes of one scene rather than two documents.
	 *
	 * Read by {@link mdegOf} in thousandths of a degree, exact or nothing, for
	 * the reason `emuOf` and `msOf` are: an angle reaches ASP as an integer and a
	 * fact has to be one.
	 *
	 * **Periodic, and deliberately not normalised.** `"720deg"` is two full
	 * turns and stays two full turns; nothing here reduces it modulo a circle,
	 * and nothing reads `-90deg` as `270deg`. Both are decisions rather than
	 * omissions, and the reason is that neither reader is the last word: an
	 * animation from `0deg` to `720deg` spins twice and one to `-90deg` spins the
	 * other way, so a normalising reader would quietly delete the difference
	 * between three different designs. What bounds an angle is {@link MAX_MDEG},
	 * which refuses a typo rather than folding one.
	 */
	angle: { label: "Angle", fallback: "0deg", quantity: "angle" },
	weight: { label: "Weight", fallback: "400", quantity: "ratio" },
	font: { label: "Font", fallback: FONTS[0].value, options: FONTS },
	align: { label: "Alignment", fallback: ALIGNS[0].value, options: ALIGNS },
	shadow: { label: "Shadow", fallback: SHADOWS[1].value, options: SHADOWS },
	text: { label: "Text", fallback: "Text", multiline: true },
	direction: {
		label: "Direction",
		fallback: DIRECTIONS[0].value,
		options: DIRECTIONS,
	},
	placement: {
		label: "Placement",
		fallback: PLACEMENTS[0].value,
		options: PLACEMENTS,
	},
	justify: {
		label: "Justification",
		fallback: JUSTIFICATIONS[0].value,
		options: JUSTIFICATIONS,
	},
	sizing: { label: "Sizing", fallback: SIZINGS[0].value, options: SIZINGS },
	fit: { label: "Fit", fallback: FITS[0].value, options: FITS },
	growth: { label: "Growth", fallback: GROWTH[0].value, options: GROWTH },
	solid: { label: "Solid", fallback: SOLIDS[0].value, options: SOLIDS },
	lamp: { label: "Lamp", fallback: LAMPS[1].value, options: LAMPS },
	/**
	 * Which way a gradient runs, as the whole `background-image` it becomes.
	 *
	 * An enumerated type with no quantity, so no reader turns it into a number
	 * and no literal bridge carries it: a recipe has parentheses, commas and
	 * hashes in it, all of which {@link wordOf} refuses, so it reaches the
	 * program as a quoted string and nothing else — the same company a colour and
	 * a `box-shadow` already keep. A rule that wants to say something about
	 * gradients compares literal identity, which is how `differ` and `match`
	 * already work on a fill.
	 */
	gradient: {
		label: "Gradient",
		fallback: GRADIENTS[0].value,
		options: GRADIENTS,
	},
	/**
	 * How a node's colours meet what is painted behind it.
	 *
	 * Every inhabitant is a legal ASP constant, which is the payoff of the roster
	 * decision in {@link MIXES}: `mword(N,M) :- rendered(N,mix,L), word(L,M).`
	 * grounds, and a rule can reason about the mode by name with nothing added to
	 * the compiler.
	 */
	mix: { label: "Mix", fallback: MIXES[0].value, options: MIXES },
};

export const VALUE_TYPE_NAMES = Object.keys(VALUE_TYPES) as ValueType[];

/** What a menu calls a stored value, or the value itself if it is not on one. */
export function optionLabel(type: ValueType, value: string): string {
	return (
		VALUE_TYPES[type].options?.find((o) => o.value === value)?.label ?? value
	);
}

/**
 * One option: a concrete value, a reference to another variable's value, or a
 * value *computed* from one.
 *
 * A derived term is the one kind the editor cannot evaluate on its own — it
 * depends on what the source resolved to in a particular universe, which is
 * the solver's answer, not the document's.
 */
export type Term =
	| { kind: "literal"; value: string }
	| { kind: "token"; token: string }
	| { kind: "derived"; via: Derivation; from: string };

/** One or more alternatives. More than one means this assignment varies. */
export type Value = Term[];

export const lit = (value: string): Term => ({ kind: "literal", value });
export const ref = (token: string): Term => ({ kind: "token", token });
export const derive = (via: Derivation, from: string): Term => ({
	kind: "derived",
	via,
	from,
});

export const single = (value: string): Value => [lit(value)];

/**
 * The bare number a literal reads as: `"1.35"` is 1.35, `"400"` is 400.
 *
 * The reader for the `ratio` quantity, which is what this has quietly been all
 * along — a line height, an opacity, a weight. It used to tolerate a `px`
 * suffix and read `"24px"` as 24, because a length in this document was always
 * pixels and always a float. It is not either any more: a length is EMU and is
 * read by `emuOf`, which is exact or nothing, and the suffix is gone from this
 * regex so that no length can reach a ratio's caller wearing its own numerals.
 * The failure that guards against is quiet and total — an opacity of 0.5 read
 * as a length is 4762 EMU, and read back as a ratio it is opaque.
 *
 * Anything else — a percentage, a calc, a colour — reads as nothing rather than
 * as its leading digits, so a value driven by it says nothing instead of
 * quietly meaning something else.
 */
export function numeralOf(text: string): number | undefined {
	const m = /^\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
	return m ? Number(m[1]) : undefined;
}

/* ------------------------------------------------------------------ */
/* Exact decimals, once                                                */
/* ------------------------------------------------------------------ */

function gcd(a: bigint, b: bigint): bigint {
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}

/**
 * `value / per`, written with the fewest decimals that say it exactly.
 *
 * The reduced denominator is 2^a·5^b — which is what every caller here has
 * already established, each by its own `step` — and max(a,b) is then the number
 * of decimals, and also the fewest, since the fraction is in lowest terms.
 *
 * A near-copy of the private `spell` in `units.ts`, and the duplication is
 * deliberate rather than an oversight. That one is welded to `UnitSpec`: it
 * looks its divisor up in `UNITS` and appends a `Unit`'s symbol, so a permille —
 * which has no unit at all and writes `"0.5"` — could not call it without a row
 * in a table of *lengths*. `units.ts` is also a file this work is forbidden to
 * touch, so exporting the shared half was not on offer; and the shared half is
 * eleven lines of arithmetic with no policy in it, where the policy — which
 * unit, which fallback, which suffix — is what each caller keeps for itself.
 */
function decimalOf(value: bigint, per: bigint): string {
	const negative = value < 0n;
	const magnitude = negative ? -value : value;
	const common = gcd(magnitude, per);
	const numerator = magnitude / common;
	const denominator = per / common;

	let rest = denominator;
	let twos = 0;
	let fives = 0;
	while (rest % 2n === 0n) {
		rest /= 2n;
		twos++;
	}
	while (rest % 5n === 0n) {
		rest /= 5n;
		fives++;
	}
	const decimals = Math.max(twos, fives);
	const scaled = ((numerator * 10n ** BigInt(decimals)) / denominator).toString();
	const padded = scaled.padStart(decimals + 1, "0");
	const body =
		decimals === 0
			? padded
			: `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
	// A magnitude that rounds to nothing must not come back wearing a sign: "-0"
	// is a true statement and a silly thing to put in a document.
	return `${negative && magnitude !== 0n ? "-" : ""}${body}`;
}

/** Ties away from zero, the convention every rounding in this codebase uses. */
const roundAway = (value: number): number =>
	value < 0 ? -Math.round(-value) : Math.round(value);

/**
 * What a literal is worth, as the fraction `units / scale` of the quantity's own
 * integer unit — thousandths, milliseconds, or thousandths of a degree.
 *
 * Kept as a fraction rather than evaluated, for exactly the reason `units.ts`
 * keeps a length as one: whether the text is a whole unit *at all* is the
 * question `units % scale` answers, and a float multiply throws that away before
 * anyone can ask. `1.005 * 1000` is 1004.9999999999999 in binary floating point
 * and 1.005s is one thousand and five milliseconds in every other sense — so
 * evaluating first would refuse a value that is exact, silently, on a text
 * nobody could look at and see the problem in.
 *
 * One shape for three quantities, and one pair of readers over it
 * ({@link exactly} and {@link nearest}), because the two boundary rules are not
 * per-quantity policy: "exact or nothing" and "ties away from zero" are promises
 * this whole codebase makes, and three private copies of them are three places a
 * half could start rounding toward positive infinity. What stays per quantity is
 * the *grammar* — which suffixes exist, what a bare number means — which is the
 * only part the three readers actually disagree about.
 */
interface Scaled {
	units: bigint;
	scale: bigint;
}

/**
 * The exact whole number a {@link Scaled} holds, or nothing where the division
 * is not exact or the result is past `ceiling` in either direction.
 *
 * This is the "exact or nothing" `emuOf` promises, in the one place all three of
 * {@link msOf}, {@link permilleOf} and {@link mdegOf} get it from. Nothing is a
 * better answer than a plausible wrong number: a caller handed `undefined` falls
 * back or stays silent, and every caller here already does.
 */
function exactly(q: Scaled, ceiling: number): number | undefined {
	if (q.units % q.scale !== 0n) return undefined;
	return within(q.units / q.scale, ceiling);
}

/**
 * The nearest whole unit a {@link Scaled} holds, ties away from zero — the
 * rounding {@link nearestMs}, {@link nearestPermille} and {@link nearestMdeg}
 * all perform, and the reason none of them can drift from `nearestEmu`.
 */
function nearest(q: Scaled, ceiling: number): number | undefined {
	const whole = q.units / q.scale; // BigInt division truncates toward zero
	const rest = q.units % q.scale; // and leaves a remainder of the same sign
	const magnitude = rest < 0n ? -rest : rest;
	const away = rest < 0n ? -1n : 1n;
	return within(2n * magnitude >= q.scale ? whole + away : whole, ceiling);
}

function within(n: bigint, ceiling: number): number | undefined {
	const limit = BigInt(ceiling);
	return n > limit || n < -limit ? undefined : Number(n);
}

/* ------------------------------------------------------------------ */
/* The ratio's integer boundary                                        */
/* ------------------------------------------------------------------ */

/**
 * The largest magnitude a ratio may reach the program as, in thousandths.
 *
 * A thousand units either way. The argument is {@link MAX_TALLY}'s and
 * {@link MAX_MS}': gringo's integers are 32-bit and wrap in silence, the widest
 * arithmetic a permille reaches is a comparison against another permille, and a
 * blend axis a thousand units long is already past every input anybody has
 * declared. A mistyped `1e9` is a typo, and reading it as no number at all is
 * what every caller here already handles.
 */
export const MAX_PERMILLE = 1_000_000;

/**
 * A bare decimal, and nothing else. {@link numeralOf}'s grammar, kept as a
 * separate regex because this one has to know where the fraction ended: the
 * number of digits after the point *is* the scale, and `Number("0.0005")` has
 * thrown that away before anyone can ask whether it is a whole thousandth.
 *
 * No leading `+`, matching {@link msOf} and the angle reader below: nothing in
 * this codebase writes one, so a text wearing one came from somewhere else and
 * is better read as nothing than as a number it half agrees with.
 */
const RATIO = /^\s*(-?)(\d+)(?:\.(\d+))?\s*$/;

const PERMILLE_PER_RATIO = 1000n;

interface Scaled {
	units: bigint;
	scale: bigint;
}

function parseRatio(text: string): Scaled | undefined {
	const m = RATIO.exec(text);
	if (!m) return undefined;
	const [, sign, whole, fraction = ""] = m;
	const digits = BigInt(whole + fraction) * PERMILLE_PER_RATIO;
	return {
		units: sign === "-" ? -digits : digits,
		scale: 10n ** BigInt(fraction.length),
	};
}

/**
 * The whole number of thousandths a text reads as: `"0.5"` is 500, `"1"` is
 * 1000, `"-2.25"` is -2250.
 *
 * The ASP-side reader for the `ratio` quantity, and the fifth member of the
 * family `emuOf`, `msOf`, `tallyOf` and `wordOf` are in. It is a *different*
 * function from {@link numeralOf}, which is the TypeScript-side reader and
 * returns a float, and the two are not merged for the reason `emuOf` and
 * `numeralOf` are not: a fact has to be an integer, and the exactness rule
 * belongs to the boundary rather than to the quantity. `"0.5"` is a ratio in
 * both readings; `"0.0005"` is a ratio to {@link numeralOf} and **nothing at
 * all** here, because half a thousandth is not a whole thousandth and rounding
 * it would put a number in the program that nobody typed.
 *
 * **This adds no `Quantity`.** It is a second reader for a quantity that has
 * been here since the beginning, exactly as `emuOf` is the integer boundary
 * reader for the float pixels `numeralOf` used to hand back — see the note on
 * {@link Quantity}. A `Quantity` member for it would be a name that changed no
 * answer.
 *
 * Unitless only. A percentage is refused rather than divided by a hundred:
 * `"50%"` and `"0.5"` are the same quantity written two ways, and a document
 * that could say it either way would be a document where a blend threshold and
 * an input range could silently be off by a factor of a hundred from each other.
 * A designer who wants percentages declares the input's range as 0..100, and
 * then every number in the machine is in the same units.
 */
export function permilleOf(text: string): number | undefined {
	const q = parseRatio(text);
	return q && exactly(q, MAX_PERMILLE);
}

/**
 * The nearest whole thousandth, for the one caller allowed to round: a field a
 * person is typing into. The twin of {@link nearestMs} and `nearestEmu`, and it
 * exists for the twin reason — {@link permilleOf} is exact or nothing, so a
 * half-thousandth typed into the inspector would read as no number and the row
 * would go blank while the user was still typing.
 */
export function nearestPermille(text: string): number | undefined {
	const q = parseRatio(text);
	return q && nearest(q, MAX_PERMILLE);
}

/**
 * A whole number of thousandths, spelled back. `500` is `"0.5"`, `1000` is
 * `"1"`, `1` is `"0.001"`.
 *
 * No unit to keep, so unlike `formatLength` and {@link writeAngle} there is no
 * chain of candidates here: a thousandth of a ratio is exactly three decimals,
 * and {@link decimalOf} writes the fewest that say it.
 */
export function writePermille(permille: number): string {
	return decimalOf(BigInt(roundAway(permille)), PERMILLE_PER_RATIO);
}

/**
 * A count of things past which nobody is describing a grid.
 *
 * A count is the one quantity the *grounder* reads: a track rule grounds
 * `1..N`, so N facts exist before anything is solved, and a mistyped 100000
 * would hang clingo rather than draw a wrong picture. A thousand tracks is
 * already past every grid anyone has ruled; refusing beyond it turns a typo
 * into a value that reads as nothing, which every caller already handles.
 */
export const MAX_TALLY = 1000;

/**
 * The whole number of things a literal counts: `"12"` is 12, `"0"` is 0.
 *
 * The reader for the `count` quantity. Deliberately narrower than
 * {@link numeralOf} in three directions, each of which is a thing a count
 * cannot be: fractional (there is no such thing as 1.35 columns), negative, or
 * larger than {@link MAX_TALLY}. Each reads as no count at all, so a rule that
 * wanted one goes unstated rather than grounding something absurd.
 */
export function tallyOf(text: string): number | undefined {
	const m = /^\s*(\d+)\s*$/.exec(text);
	if (!m) return undefined;
	const n = Number(m[1]);
	return n <= MAX_TALLY ? n : undefined;
}

/**
 * The longest duration a document may name, in milliseconds.
 *
 * Ten minutes. Not a limit anybody will meet on purpose — the argument is
 * {@link MAX_TALLY}'s, one step weaker: nothing grounds a range over a duration,
 * but a stagger is multiplied by a sibling index on a right-hand side, and
 * gringo's integers are 32-bit and wrap in silence. A mistyped `200000s` is a
 * typo, not a transition, and reading it as no duration at all is what every
 * caller already handles.
 */
export const MAX_MS = 600_000;

/**
 * A number, optionally fractional, optionally carrying `ms` or `s`.
 *
 * Narrower than `units.ts`'s `LENGTH` in two ways that are both deliberate. No
 * leading `+`, because nothing writes one and a duration is not a delta. And a
 * closed set of two suffixes rather than any word, because the unit table a
 * length consults does not exist here: CSS defines exactly two time units, and
 * a third spelling is a typo rather than a unit this module has not heard of.
 * Everything else — `"200px"`, `"1e3ms"`, `".5s"` — falls off the end and reads
 * as no duration at all.
 */
const DURATION = /^\s*(-?)(\d+)(?:\.(\d+))?\s*(ms|s)?\s*$/i;

function parseDuration(text: string): Scaled | undefined {
	const m = DURATION.exec(text);
	if (!m) return undefined;
	const [, sign, whole, fraction = "", suffix = ""] = m;
	const unit = suffix === "" ? undefined : suffix.toLowerCase();
	const digits = BigInt(whole + fraction);
	// Unitless is refused except for zero, which is what CSS does and for the
	// same reason: `200` is ambiguous between two units that differ by a factor
	// of a thousand, and guessing would make a design that animates for three
	// minutes look like a bug in the browser. `0` needs no unit because both
	// readings agree.
	if (unit === undefined && digits !== 0n) return undefined;
	const scaled = (unit === "s" ? 1000n : 1n) * digits;
	return {
		units: sign === "-" ? -scaled : scaled,
		scale: 10n ** BigInt(fraction.length),
	};
}

/**
 * The whole number of milliseconds a literal reads as: `"200ms"` is 200,
 * `"0.2s"` is 200, `"0"` is 0.
 *
 * The reader for the `time` quantity, and it is exact or nothing, exactly as
 * `emuOf` is. `"1.5ms"` is not a whole millisecond, so it reads as no duration
 * at all rather than as 1 or as 2 — a caller that wanted a rounding asks for
 * one by name ({@link nearestMs}), and the fact the compiler emits is never a
 * number nobody typed.
 *
 * The suffix is matched case-insensitively because CSS units are, and a
 * designer who types `200MS` has typed a duration. The *number* is not
 * normalised anywhere: what the document stores is what was typed, exactly as a
 * length keeps its own unit across an edit.
 *
 * Negative is read and returned as negative. Only a transition's delay may use
 * one — a negative delay starts the move partway through, which is a real thing
 * to ask for — and duration and stagger clamp at zero where they are read. The
 * clamp is at the reading, not here, so that one reader serves all three.
 */
export function msOf(text: string): number | undefined {
	const q = parseDuration(text);
	return q && exactly(q, MAX_MS);
}

/**
 * The nearest whole millisecond a text reads as, for the one caller that is
 * allowed to round: a field a person is typing into.
 *
 * The twin of `nearestEmu`, and it exists for the twin reason — {@link msOf} is
 * exact or nothing, so a half-millisecond typed into the inspector would read
 * as no duration and the row would go blank while the user was still typing.
 * This is an editorial act with a name and a caller, never something a
 * conversion does behind anyone's back.
 *
 * Ties go away from zero, which is the rounding convention `nearestEmu`,
 * `snapToUnit` and `wholeEmu` all use — one rule to remember rather than a
 * fifth place where a half rounds toward positive infinity and `-0.5ms` comes
 * back as a negative zero. It is now one *implementation* as well as one rule:
 * this, {@link nearestPermille} and {@link nearestMdeg} are the same three lines
 * over {@link Scaled}, so the three cannot drift apart the way three copies
 * would.
 */
export function nearestMs(text: string): number | undefined {
	const q = parseDuration(text);
	return q && nearest(q, MAX_MS);
}

/* ------------------------------------------------------------------ */
/* Angles                                                              */
/* ------------------------------------------------------------------ */

/**
 * The furthest a document may turn something: ten full turns, in thousandths of
 * a degree.
 *
 * {@link MAX_MS}'s argument, one quantity over, and one step weaker still:
 * nothing grounds a range over an angle and nothing multiplies one, so this
 * exists only because gringo's integers are 32-bit and a mistyped `3600000deg`
 * should read as a typo rather than wrap into a small negative rotation nobody
 * can explain.
 *
 * A *ceiling*, not a fold. Nothing here reduces an angle modulo a circle — see
 * the note on `VALUE_TYPES.angle` — so this refuses a typo where normalising
 * would quietly delete the difference between three different designs.
 */
export const MAX_MDEG = 3_600_000;

/** The three units an angle may be written in — see {@link mdegOf}. */
export type AngleUnit = "deg" | "turn" | "grad";

interface AngleUnitSpec {
	/** Thousandths of a degree in one of them. Whole, which is why all three exist. */
	per: bigint;
	/**
	 * The smallest positive angle this unit can spell exactly, in thousandths —
	 * `UnitSpec.step`'s idea, and computed the same way: strip every 2 and 5 out
	 * of `per`, because `mdeg/per` terminates exactly when the reduced
	 * denominator is 2^a·5^b. 360000 = 2^5·3^2·5^4 and 900 = 2^2·3^2·5^2 both
	 * leave 9, so a turn and a gradian are spellable on the same nine-thousandth
	 * lattice; a degree is 1000 = 2^3·5^3, leaves 1, and spells every angle there
	 * is. That last fact is why {@link writeAngle} needs no `emu`-style escape
	 * hatch and {@link formatLength} does.
	 */
	step: number;
}

const ANGLE_UNITS: Record<AngleUnit, AngleUnitSpec> = {
	deg: { per: 1000n, step: 1 },
	turn: { per: 360_000n, step: 9 },
	grad: { per: 900n, step: 9 },
};

const isAngleUnit = (name: string): name is AngleUnit =>
	Object.hasOwn(ANGLE_UNITS, name);

/**
 * A number with an optional word after it. Deliberately open where
 * {@link DURATION} is closed — `(ms|s)?` there, any word here — because the
 * refusals an angle has to make are *about the word*: `rad` and a bare number
 * are both legal spellings of zero and of nothing else, and a regex that had
 * already dropped them could not tell the difference between `"1rad"` and
 * `"1px"` when saying so.
 */
const ANGLE = /^\s*(-?)(\d+)(?:\.(\d+))?\s*([A-Za-z]*)\s*$/;

function parseAngle(text: string): Scaled | undefined {
	const m = ANGLE.exec(text);
	if (!m) return undefined;
	const [, sign, whole, fraction = "", suffix] = m;
	// CSS units are case-insensitive, and a designer who types `45DEG` has typed
	// an angle — the same courtesy `msOf` and `emuOf` extend.
	const unit = suffix.toLowerCase();
	const digits = BigInt(whole + fraction);
	if (!isAngleUnit(unit)) {
		// The two spellings that are legal for zero and for nothing else. `rad`
		// because π is irrational — `"1rad"` is 57295.779… thousandths and there is
		// no exact reading, so rounding it here would put a number in the document
		// that no conversion in this codebase has ever put there. Unitless for
		// `msOf`'s reason: `"45"` is a count of forty-five things everywhere else in
		// this system, and guessing would make a grid of forty-five columns and a
		// rotation of forty-five degrees the same text. Both read as zero at zero,
		// because every unit agrees about zero.
		return digits === 0n && (unit === "" || unit === "rad")
			? { units: 0n, scale: 1n }
			: undefined;
	}
	const scaled = digits * ANGLE_UNITS[unit].per;
	return {
		units: sign === "-" ? -scaled : scaled,
		scale: 10n ** BigInt(fraction.length),
	};
}

/**
 * The whole number of **thousandths of a degree** a literal reads as: `"45deg"`
 * is 45000, `"0.5deg"` is 500, `"0.25turn"` is 90000.
 *
 * The reader for the `angle` quantity, and the sixth literal bridge — `numeral`,
 * `tally`, `word`, `millis`, `permille`, and now this.
 *
 * Thousandths rather than whole degrees because a fact has to be an integer and
 * a designer will type `22.5deg` on the first day. A thousandth of a degree is
 * an arcsecond and a bit, four orders finer than anything a screen resolves, so
 * the granularity is invisible in the same way an EMU is.
 *
 * **Exact or nothing**, exactly as `emuOf` and {@link msOf} are. `"1.0005deg"`
 * is 1000.5 thousandths, so it reads as no angle at all rather than as 1000 or
 * as 1001 — a caller that wanted a rounding asks for one by name
 * ({@link nearestMdeg}), and the fact the compiler emits is never a number
 * nobody typed.
 *
 * Three units, and the two refusals are decisions rather than oversights; both
 * are argued in {@link parseAngle}, which is where a reader looking at a
 * surprising `undefined` will go. `mdeg` is deliberately *not* a fourth unit:
 * CSS defines four angle units and this reads three of them, and a spelling CSS
 * has never heard of is a typo rather than a unit this module has not met — the
 * argument {@link DURATION} makes about `"200sec"`. Nothing needs it, either,
 * because `deg` spells every angle exactly (see {@link AngleUnitSpec.step}), so
 * unlike a length there is no value here that no legal unit can write down.
 *
 * Negative is read and returned as negative: a rotation has two directions and
 * both are things to ask for. Nothing clamps it and nothing folds it — `"720deg"`
 * is two full turns and stays two, because an animation from `0deg` to `720deg`
 * spins twice and one to `-90deg` spins the other way.
 */
export function mdegOf(text: string): number | undefined {
	const q = parseAngle(text);
	return q && exactly(q, MAX_MDEG);
}

/**
 * The nearest thousandth of a degree, for the one caller allowed to round: a
 * field a person is typing into. The twin of {@link nearestMs} and `nearestEmu`,
 * and it exists for the twin reason — {@link mdegOf} is exact or nothing, so
 * `22.50005deg` typed into the inspector would read as no angle and the row
 * would go blank while the user was still typing.
 *
 * It reads exactly the units {@link mdegOf} reads, and that includes refusing
 * `"1rad"`. A rounding reader *could* answer 57296 there, since the unit is
 * known and only the arithmetic is irrational — but then the two readers would
 * disagree about what an angle is, which is a worse thing to own than a unit
 * this codebase does not offer. A field that rewrote `1rad` to `57.296deg` would
 * also be answering in a unit the designer did not type, where every other
 * rounding here keeps the spelling it was handed.
 */
export function nearestMdeg(text: string): number | undefined {
	const q = parseAngle(text);
	return q && nearest(q, MAX_MDEG);
}

/**
 * Which unit a stored angle was written in, or nothing when it is not an angle
 * at all. Zero spelled bare or as `"0rad"` is `deg`, which is what
 * {@link writeAngle} would write it in anyway.
 *
 * `unitOf`'s twin, and it exists for `unitOf`'s reason: an edit must keep a
 * designer's units. A rotation nudged by a drag reads the angle, adds a delta
 * and writes the sum back, and it is this that lets it write `"0.3turn"` rather
 * than `"108deg"`. Deliberately separate from {@link mdegOf} — a caller wants
 * the number *or* the spelling, never both.
 *
 * **Beyond the frozen spec.** `writeAngle` is specified as writing "in the unit
 * it was already written in" and nothing in the frozen list could tell it which
 * that was; this is the missing half, named after `unitOf` so the pair reads as
 * a pair.
 */
export function angleUnitOf(text: string): AngleUnit | undefined {
	const m = ANGLE.exec(text);
	if (!m || parseAngle(text) === undefined) return undefined;
	const unit = m[4].toLowerCase();
	return isAngleUnit(unit) ? unit : "deg";
}

/**
 * How an angle is written back: the requested unit if it can say the value
 * exactly, otherwise degrees. The twin of `formatLength`, and shorter by one
 * link, because `deg` spells every angle there is — so where a length needs the
 * `emu` escape to stay honest, an angle never runs out of units.
 *
 * The requested unit is the unit the value was already written in, which is what
 * makes an edit keep a designer's units: `"0.25turn"` nudged by a whole degree
 * is 91000 thousandths, which is not a multiple of nine and so comes back as
 * `"91deg"` rather than as a turn with six decimals. The chain is short and it
 * is visible; a value silently rewritten in gradians would not be.
 *
 * A non-integer `mdeg` is rounded on the way in, ties away from zero, exactly as
 * `formatLength` sends its argument through `wholeEmu` — the only sources of one
 * are arithmetic that halves and a solver that answers in rationals, and both
 * are invisible at a thousandth of a degree.
 */
export function writeAngle(mdeg: number, unit: AngleUnit = "deg"): string {
	const whole = roundAway(mdeg);
	for (const candidate of [unit, "deg" as AngleUnit]) {
		if (whole % ANGLE_UNITS[candidate].step === 0) {
			return `${decimalOf(BigInt(whole), ANGLE_UNITS[candidate].per)}${candidate}`;
		}
	}
	// Unreachable: `deg` has step 1 and divides every integer. Kept as the answer
	// rather than a throw, for `formatLength`'s reason — an angle that cannot be
	// written is a worse failure than one written in a unit nobody asked for.
	return `${decimalOf(BigInt(whole), ANGLE_UNITS.deg.per)}deg`;
}

/**
 * Whether values of this type are lengths — and so whether a literal of it is
 * read as EMU, migrated with the rest of the document's geometry, and ordered
 * against its siblings by how much room it asks for.
 *
 * A lookup rather than `type === "length"`, so the day a second length-shaped
 * type appears there is one place that has to hear about it.
 */
export const isLengthType = (type: ValueType): boolean =>
	VALUE_TYPES[type].quantity === "length";

/**
 * True when values of this type are durations — the twin of
 * {@link isLengthType}, and a lookup for the same reason: the day a second
 * time-shaped type appears there is one place that has to hear about it.
 */
export const isTimeType = (type: ValueType): boolean =>
	VALUE_TYPES[type].quantity === "time";

/**
 * True when values of this type are angles, and so are read by {@link mdegOf}
 * and written by {@link writeAngle}. The twin of {@link isTimeType}.
 */
export const isAngleType = (type: ValueType): boolean =>
	VALUE_TYPES[type].quantity === "angle";

/**
 * True when values of this type are bare proportions — a line height, an
 * opacity, a blend threshold, and (see the note on `VALUE_TYPES.weight`) a font
 * weight.
 *
 * The fourth of these lookups, and the only one whose quantity has *two*
 * readers: {@link numeralOf} on the TypeScript side and {@link permilleOf} at
 * the boundary with a program that has no floats. Which one a caller wants is
 * decided by which side of that boundary it is standing on, never by the type,
 * so this answers the type question alone and leaves the reader to the caller.
 */
export const isRatioType = (type: ValueType): boolean =>
	VALUE_TYPES[type].quantity === "ratio";

/**
 * The bare ASP constant a literal reads as: `"row"` is `row`.
 *
 * The counterpart of {@link numeralOf} for the enumerated types. A layout is
 * described in words rather than in numbers, and a word only reaches a rule as
 * itself — `layout(C,row)` — so the string has to be spellable as a constant.
 * Anything else, a colour or a font stack, reads as no word at all, and the
 * rule that wanted one then simply goes unstated.
 */
export function wordOf(text: string): string | undefined {
	return /^[a-z][A-Za-z0-9_]*$/.test(text) ? text : undefined;
}

/** True when this assignment contributes a choice to the solver. */
export const varies = (value: Value | undefined): boolean =>
	(value?.length ?? 0) > 1;

/* ------------------------------------------------------------------ */
/* Derivations                                                         */
/* ------------------------------------------------------------------ */

export type Derivation = "contrast";

export interface DerivationSpec {
	label: string;
	/** Both what it reads and what it produces. */
	type: ValueType;
	/** Result for a concrete source value, or undefined where it does not apply. */
	of(source: string): string | undefined;
}

const INK_DARK = "#0f172a";
const INK_LIGHT = "#ffffff";

/**
 * Perceived luminance, for picking readable text over an arbitrary fill — and
 * for deciding which of two colours is the dark one, which is the only thing
 * `prefers-color-scheme` is actually about. Nothing for a colour it cannot
 * read, so a caller falls back rather than treating a font stack as black.
 */
export function luminance(hex: string): number | undefined {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return undefined;
	const n = Number.parseInt(m[1], 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The derivations a value can be computed by.
 *
 * One definition, two consumers: {@link resolveValue} evaluates it directly for
 * the editor's own preview, and the compiler turns the same function into
 * `derived_of/3` facts so ASP can follow it per universe. Adding a derivation
 * is an entry here and nothing else — the generated program has one generic
 * rule that covers them all.
 */
export const DERIVATIONS: Record<Derivation, DerivationSpec> = {
	contrast: {
		label: "Contrast with",
		type: "color",
		of(source) {
			const l = luminance(source);
			return l === undefined ? undefined : l > 0.45 ? INK_DARK : INK_LIGHT;
		},
	},
};

export interface Token {
	id: string;
	/** User-facing, like a CSS custom property name. */
	name: string;
	type: ValueType;
	value: Value;
}

/* ------------------------------------------------------------------ */
/* Variable keys                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every place that holds alternatives is a *variable* the solver picks for.
 * Keys are written as ASP terms so the same string identifies the variable in
 * the program, in the answer sets, and in this code.
 */
export const tokenVar = (tokenId: string): string => `tok(${tokenId})`;
export const propVar = (nodeId: string, prop: string): string =>
	`prop(${nodeId},${prop})`;
/**
 * A dimension a geometric constraint holds to — the number in "24 apart".
 *
 * It is a variable like any other, which is the whole of what makes a
 * dimension parametric: point it at a token and the token's alternatives drive
 * the geometry, with no second kind of parameter anywhere in the system.
 */
export const constraintVar = (constraintId: string): string =>
	`cval(${constraintId})`;
/**
 * One setting of an automatic layout — its direction, its gap, or a child's
 * say in it.
 *
 * A layout is not a node's appearance, so these are not properties; but they
 * are leaves the solver reads, so they are variables, on the same footing as
 * a fill or a constraint's dimension. That is what makes "a row here and a
 * column there" a design the document can hold rather than two documents.
 */
export const layoutVar = (nodeId: string, field: string): string =>
	`lval(${nodeId},${field})`;
/**
 * One setting of a surface's guides: a margin, a track count, a gutter — or,
 * spelled `at(g1)`, where one hand-drawn guide sits.
 *
 * The same argument {@link layoutVar} makes, about the settings that rule a page
 * rather than the ones that stack its children: a margin that names a `length`
 * token *is* the page's spacing scale, and a column count with two alternatives
 * is a responsive grid held in one document. So they are variables, picked and
 * resolved per universe like anything else.
 *
 * One family for both halves of the guides — the grid's settings and the lines
 * — because both are the same kind of thing to everything downstream: a value on
 * a surface that resolves to a length. They cannot collide, because a line's
 * field is wrapped: `gval(page,columns)` is a setting and `gval(page,at(g1))` is
 * a line, and no {@link GuideProp} is spelled with brackets. Wrapping rather
 * than a seventh variable key, so that the compiler emitting a surface's guides
 * is one loop and the panel showing them is one list.
 */
export const guideVar = (nodeId: string, field: string): string =>
	`gval(${nodeId},${field})`;
/** Where one hand-drawn guide sits — see {@link guideVar}. */
export const guideAtVar = (nodeId: string, guideId: string): string =>
	guideVar(nodeId, `at(${guideId})`);
/**
 * The guide a {@link guideVar} field names, or nothing where the field is one of
 * the grid's own settings. The inverse of {@link guideAtVar}'s wrapping, kept
 * beside it so the spelling exists once.
 */
export function guideAtIn(field: string): string | undefined {
	const atom = parseAtom(field);
	return atom?.name === "at" && atom.args.length === 1 ? atom.args[0] : undefined;
}
/**
 * One of a node's four geometric dimensions — where it sits and how big it is.
 *
 * The last leaf to become a variable, and the one that turns "this sits here on
 * desktop and there on mobile" into a universe rather than two documents. It is
 * an ordinary variable in every respect: it picks, it resolves, it can name a
 * token, and it is projected — so two positions really are two designs.
 */
export const frameVar = (nodeId: string, dim: string): string =>
	`fval(${nodeId},${dim})`;
/**
 * One rotation of one node, as the variable it is: `rval(n7,rotateY)`.
 *
 * {@link frameVar}'s twin about the other half of a placement. A rotation is a
 * design decision in exactly the way a position is — an `angle` token with two
 * alternatives tilts every card wearing it, and "upright here, leaning there" is
 * one document with two universes rather than two documents — so it is an
 * ordinary variable: it picks, it resolves, it may name a token, and it is
 * projected.
 *
 * Separate from `frameVar` rather than a seventh dimension of it, because the
 * two are different quantities. A dimension is a length read by `emuOf`; a
 * rotation is an angle read by {@link mdegOf}, which refuses every text `emuOf`
 * accepts. One family would have meant one reader guessing from the field name.
 */
export const rotateVar = (nodeId: string, turn: string): string =>
	`rval(${nodeId},${turn})`;
/**
 * Which *treatment* a style is wearing — the fifth variable key, and the only
 * one whose alternatives are not values.
 *
 * Every other variable picks between literals: one string, one property. This
 * one picks between whole records, and that is the whole of what a style is for.
 * A size token and a weight token are picked independently and give the cross
 * product, of which half is incoherent — 32px at weight 300. One `sty(S)` pick
 * decides size *and* weight *and* line height together, so two coherent
 * treatments are two designs rather than four combinations. See
 * {@link stylePartVar} for where the record's fields live.
 */
export const styleVar = (styleId: string): string => `sty(${styleId})`;
/**
 * One field of one variant of a style: `spart(heading,0,size)`.
 *
 * A variable rather than a fact so that a part can name a token or be derived
 * and *resolve* like anything else — `size: ref("lg")` keeps one source of
 * truth for a scale. It holds exactly one alternative, so it is never a choice
 * anyone makes; the choice is `sty(S)`, and the generated program joins the two.
 * Only emitted where the part is not a plain literal, exactly as a frame
 * dimension is a fact where the document wrote one number.
 */
export const stylePartVar = (
	styleId: string,
	variant: number,
	prop: string,
): string => `spart(${styleId},${variant},${prop})`;
/**
 * One motion setting of one transition: `mval(m1,press,duration)`.
 *
 * A variable rather than a number for the reason a constraint's dimension is
 * one: point it at a `duration` token and the token's alternatives drive every
 * transition wearing it, with no second kind of parameter anywhere.
 *
 * Machine-scoped in its first argument, and that is not decoration. A state id
 * and a transition id are unique within their own machine only — `hover` is
 * what every machine in the document calls that state — so a key that named the
 * transition alone would collide the moment a document held two machines, and
 * collide silently, because both halves resolve to a duration.
 */
export const motionVar = (
	machineId: string,
	transitionId: string,
	field: string,
): string => `mval(${machineId},${transitionId},${field})`;

/**
 * The three variables a timeline mints: when a keyframe is, what it is, and how
 * long the whole timeline runs.
 *
 * `kat(m1,open,trkd(panel,y),3)` — machine, timeline, track, index. A keyframe's
 * time is a `duration` Value and its value is an ordinary one, and both are
 * variables rather than numbers for {@link motionVar}'s reason: point a keyframe
 * at a `duration` token and every timeline wearing it retimes together, with no
 * second kind of parameter anywhere in the system.
 *
 * Machine-scoped in the first argument, and for {@link motionVar}'s reason
 * exactly: a timeline id is unique within its own machine only, `open` is what
 * half the machines in a document call that timeline, and a key that named the
 * timeline alone would collide the moment a document held two — silently,
 * because both halves resolve to a duration.
 *
 * The track is a whole term (`trkd(panel,y)` or `trkp(panel,fill)`), which is
 * why nothing here splits on commas and why the reader that takes these keys
 * apart lives in `machines.ts`, beside the grammar that mints a track.
 */
export const keyTimeVar = (
	machineId: string,
	timelineId: string,
	track: string,
	index: number,
): string => `kat(${machineId},${timelineId},${track},${index})`;
/** What a keyframe holds — see {@link keyTimeVar}. */
export const keyValueVar = (
	machineId: string,
	timelineId: string,
	track: string,
	index: number,
): string => `kval(${machineId},${timelineId},${track},${index})`;
/**
 * How long a timeline runs, where the document said so at all — see
 * {@link keyTimeVar}. Absent, the program takes the last keyframe's time, which
 * is the length a timeline has whether or not anybody typed one.
 */
export const timelineLenVar = (machineId: string, timelineId: string): string =>
	`tlen(${machineId},${timelineId})`;

/**
 * The inverse of {@link tokenVar} / {@link propVar} / {@link constraintVar} /
 * {@link layoutVar} / {@link guideVar} / {@link frameVar} / {@link styleVar}.
 *
 * {@link stylePartVar} is deliberately absent. A part holds one alternative, so
 * it is never unsettled, never pinned and never shown — the callers that read a
 * variable key back are all asking about something a designer can choose, and a
 * sixth case none of them could act on would be a case they all had to handle.
 *
 * {@link motionVar} is absent for the same reason, and so are the two keys a
 * state's delta mints in `machines.ts`. A motion setting *is* something a
 * designer chooses, so the first half of that argument does not apply to it;
 * the second half decides it anyway. Every caller that reads a key back is
 * asking a question the inspector's generic rows can act on — pin this, unsettle
 * that, caption the other — and the panel that owns a transition builds its own
 * keys and already knows what they are. Three cases none of the generic readers
 * could act on would be three cases all of them had to handle, in exchange for
 * a label the Machines panel can write without asking.
 *
 * {@link keyTimeVar}, {@link keyValueVar} and {@link timelineLenVar} are absent
 * on the same test and fail it the same way: a keyframe is edited on a timeline,
 * by a panel that minted its key and knows the track, the index and the machine
 * it belongs to, and `kat(m1,open,trkd(panel,y),3)` is a receipt rather than
 * something a generic row could offer to pin.
 *
 * {@link rotateVar} is the one key here that *ought* to read back and does not
 * yet, and the reason is worth recording because it is not the reason all the
 * others have. A rotation passes the test they fail — it is one number, of one
 * type, on one node, with alternatives and a token link, which is precisely what
 * the inspector's generic rows are for. What stops it is that `describe` in
 * `export.ts` narrows this union by *elimination*, reaching `parsed.constraint`
 * with no `kind` check of its own, so a member added here becomes a type error
 * over there. An eighth tag lands the day that one line grows the guard the
 * other seven have.
 */
export type Variable =
	| { kind: "token"; token: string }
	| { kind: "prop"; node: string; prop: string }
	| { kind: "constraint"; constraint: string }
	| { kind: "layout"; node: string; field: string }
	| { kind: "guide"; node: string; field: string }
	| { kind: "frame"; node: string; dim: string }
	| { kind: "style"; style: string };

export function parseVariable(key: string): Variable | null {
	// Parsed rather than matched: a node id may be a term, and `prop(cell(1,1),
	// text)` has two commas of which only one separates arguments. A rule that
	// mints a variable names it that way, and a regex over the argument list
	// would read it as no variable at all.
	const atom = parseAtom(key);
	if (!atom) return null;
	const [a, b] = atom.args;
	const arity = atom.args.length;
	if (atom.name === "prop" && arity === 2) return { kind: "prop", node: a, prop: b };
	if (atom.name === "tok" && arity === 1) return { kind: "token", token: a };
	if (atom.name === "cval" && arity === 1) {
		return { kind: "constraint", constraint: a };
	}
	if (atom.name === "lval" && arity === 2) {
		return { kind: "layout", node: a, field: b };
	}
	if (atom.name === "gval" && arity === 2) {
		return { kind: "guide", node: a, field: b };
	}
	if (atom.name === "fval" && arity === 2) {
		return { kind: "frame", node: a, dim: b };
	}
	if (atom.name === "sty" && arity === 1) return { kind: "style", style: a };
	return null;
}

/** Which alternative is active, keyed by variable. */
export type Picks = Readonly<Record<string, number>>;

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export interface ResolveContext {
	tokens: readonly Token[];
	picks: Picks;
	/**
	 * Every node property by variable key, so a derived term can read one.
	 * Optional: without it a derivation from a property resolves to nothing and
	 * the caller falls back, which is what a half-built context should do.
	 */
	props?: Readonly<Record<string, Value>>;
}

export function findToken(
	tokens: readonly Token[],
	id: string,
): Token | undefined {
	return tokens.find((t) => t.id === id);
}

/**
 * Which alternative of a value the given universe is using, as a position in
 * the list. -1 for a value with no alternatives at all.
 *
 * With no pick — an unsolved preview, say — the first alternative stands in.
 * Separate from {@link activeTerm} because an *edit* needs the position, not
 * the term: writing a drag back has to replace one alternative and leave the
 * rest of the list alone.
 */
export function activeIndex(
	/**
	 * Any list of alternatives. Only its length is read, so a style's variants
	 * are indexed by exactly this function rather than by a copy of it — which
	 * is the whole claim about `sty(S)` being an ordinary variable, made in the
	 * one place that could have said otherwise.
	 */
	value: readonly unknown[],
	variable: string,
	picks: Picks,
): number {
	if (value.length === 0) return -1;
	const index = picks[variable];
	return index !== undefined && index >= 0 && index < value.length ? index : 0;
}

/** The alternative currently active for a variable. */
export function activeTerm(
	value: Value,
	variable: string,
	picks: Picks,
): Term | undefined {
	const index = activeIndex(value, variable, picks);
	return index === -1 ? undefined : value[index];
}

/**
 * Follows a value to a concrete literal, walking token references.
 *
 * Returns undefined for a dangling or cyclic reference rather than throwing:
 * a half-edited document should render, not crash.
 */
export function resolveValue(
	context: ResolveContext,
	value: Value | undefined,
	variable: string,
	seen: ReadonlySet<string> = new Set(),
): string | undefined {
	if (!value || value.length === 0) return undefined;
	const term = activeTerm(value, variable, context.picks);
	if (!term) return undefined;
	if (term.kind === "literal") return term.value;

	if (term.kind === "derived") {
		const source = resolveVariable(context, term.from, seen);
		return source === undefined
			? undefined
			: DERIVATIONS[term.via].of(source);
	}

	if (seen.has(term.token)) return undefined; // reference cycle
	const token = findToken(context.tokens, term.token);
	if (!token) return undefined;
	return resolveValue(
		context,
		token.value,
		tokenVar(token.id),
		new Set([...seen, term.token]),
	);
}

/**
 * Resolves whatever a variable key names — a token's definition or a node's
 * property. This is the one place that has to turn a key back into a value, so
 * derived terms can point at either.
 */
export function resolveVariable(
	context: ResolveContext,
	variable: string,
	seen: ReadonlySet<string> = new Set(),
): string | undefined {
	if (seen.has(variable)) return undefined; // derivation cycle
	const next = new Set([...seen, variable]);
	const parsed = parseVariable(variable);
	if (!parsed) return undefined;

	if (parsed.kind === "token") {
		const token = findToken(context.tokens, parsed.token);
		return token && resolveValue(context, token.value, variable, next);
	}
	const value = context.props?.[variable];
	return value && resolveValue(context, value, variable, next);
}

/** Resolve a token by id, for previews and the variables panel. */
export function resolveToken(
	context: ResolveContext,
	tokenId: string,
): string | undefined {
	const token = findToken(context.tokens, tokenId);
	if (!token) return undefined;
	return resolveValue(context, token.value, tokenVar(token.id));
}

/**
 * Token ids a value references, directly or through other tokens.
 *
 * A derived term counts as a reference to its source: `contrast(surface)`
 * depends on `surface` exactly as a link would, and a cycle through one hangs
 * resolution just the same.
 */
export function referencedTokens(
	tokens: readonly Token[],
	value: Value | undefined,
	seen: Set<string> = new Set(),
): Set<string> {
	for (const term of value ?? []) {
		let id: string | undefined;
		if (term.kind === "token") id = term.token;
		else if (term.kind === "derived") {
			const parsed = parseVariable(term.from);
			if (parsed?.kind === "token") id = parsed.token;
		}
		if (id === undefined || seen.has(id)) continue;
		seen.add(id);
		const token = findToken(tokens, id);
		if (token) referencedTokens(tokens, token.value, seen);
	}
	return seen;
}

/**
 * True when `tokenId` would end up referencing itself through `value` —
 * checked before an edit is applied, so a cycle can never be stored.
 */
export function wouldCycle(
	tokens: readonly Token[],
	tokenId: string,
	value: Value,
): boolean {
	return referencedTokens(tokens, value).has(tokenId);
}

/**
 * A short label for a term, for the property rows.
 *
 * `names` maps node ids to layer names; without it a derivation from another
 * node's property falls back to the raw id, which is readable only by accident.
 */
export function termLabel(
	tokens: readonly Token[],
	term: Term,
	names: Readonly<Record<string, string>> = {},
): string {
	if (term.kind === "literal") return term.value;
	if (term.kind === "token") {
		return findToken(tokens, term.token)?.name ?? term.token;
	}
	const parsed = parseVariable(term.from);
	const source =
		parsed?.kind === "token"
			? (findToken(tokens, parsed.token)?.name ?? parsed.token)
			: parsed?.kind === "prop"
				? `${names[parsed.node] ?? parsed.node} ${parsed.prop}`
				: term.from;
	return `${DERIVATIONS[term.via].label} ${source}`;
}
