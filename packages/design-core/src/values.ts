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
	| "weight"
	| "font"
	| "align"
	| "shadow"
	| "text"
	| "direction"
	| "placement"
	| "justify"
	| "sizing"
	| "growth";

/** One entry of a closed menu — see {@link ValueTypeSpec.options}. */
export interface ValueOption {
	/** Stored in the document, and what the renderer receives. */
	value: string;
	/** What the menu calls it. */
	label: string;
}

/**
 * The three numeric quantities a literal can be, and hence the three readers
 * that turn one into a number.
 *
 * `length` is EMU and is read by `emuOf`, which is exact or nothing. `ratio` is
 * a bare decimal with no unit — a line height, an opacity — and is read by
 * {@link numeralOf}. `count` is a whole number of things and is read by
 * {@link tallyOf}. They are three names rather than "the numeric-looking ones"
 * because the sweep that turned every length into EMU had to be certain it was
 * not turning 1.35 into 12350.
 */
export type Quantity = "length" | "ratio" | "count";

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
	 * reader does, and a fourth quantity naming one type would be a column with
	 * a single inhabitant and no reader of its own.
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
const GROWTH: ValueOption[] = [
	{ value: "fixed", label: "Keep its size" },
	{ value: "grow", label: "Fill the leftover space" },
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
	growth: { label: "Growth", fallback: GROWTH[0].value, options: GROWTH },
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
 * The inverse of {@link tokenVar} / {@link propVar} / {@link constraintVar} /
 * {@link layoutVar} / {@link guideVar} / {@link frameVar} / {@link styleVar}.
 *
 * {@link stylePartVar} is deliberately absent. A part holds one alternative, so
 * it is never unsettled, never pinned and never shown — the callers that read a
 * variable key back are all asking about something a designer can choose, and a
 * sixth case none of them could act on would be a case they all had to handle.
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
