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

export type ValueType = "color" | "length" | "number" | "weight";

export const VALUE_TYPE_LABEL: Record<ValueType, string> = {
	color: "Colour",
	length: "Length",
	number: "Number",
	weight: "Weight",
};

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

/** True when this assignment contributes a choice to the solver. */
export const varies = (value: Value | undefined): boolean =>
	(value?.length ?? 0) > 1;

/** What an empty assignment of each type starts at, and falls back to. */
export const FALLBACK: Record<ValueType, string> = {
	color: "#94a3b8",
	length: "8px",
	number: "1",
	weight: "400",
};

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

/** Perceived luminance, for picking readable text over an arbitrary fill. */
function luminance(hex: string): number | undefined {
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

/** The inverse of {@link tokenVar} / {@link propVar}. */
export type Variable =
	| { kind: "token"; token: string }
	| { kind: "prop"; node: string; prop: string };

export function parseVariable(key: string): Variable | null {
	const prop = /^prop\(([^,]+),([^)]+)\)$/.exec(key);
	if (prop) return { kind: "prop", node: prop[1], prop: prop[2] };
	const token = /^tok\(([^)]+)\)$/.exec(key);
	if (token) return { kind: "token", token: token[1] };
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

/** The alternative currently active for a variable. */
export function activeTerm(
	value: Value,
	variable: string,
	picks: Picks,
): Term | undefined {
	if (value.length === 0) return undefined;
	const index = picks[variable];
	// With no pick — an unsolved preview, say — the first alternative stands in.
	return value[index !== undefined && index < value.length ? index : 0];
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
