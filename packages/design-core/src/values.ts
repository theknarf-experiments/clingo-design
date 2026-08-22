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

/** One option: either a concrete value or a reference to a token. */
export type Term =
	| { kind: "literal"; value: string }
	| { kind: "token"; token: string };

/** One or more alternatives. More than one means this assignment varies. */
export type Value = Term[];

export const lit = (value: string): Term => ({ kind: "literal", value });
export const ref = (token: string): Term => ({ kind: "token", token });

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

/** Resolve a token by id, for previews and the variables panel. */
export function resolveToken(
	context: ResolveContext,
	tokenId: string,
): string | undefined {
	const token = findToken(context.tokens, tokenId);
	if (!token) return undefined;
	return resolveValue(context, token.value, tokenVar(token.id));
}

/** Token ids a value references, directly or through other tokens. */
export function referencedTokens(
	tokens: readonly Token[],
	value: Value | undefined,
	seen: Set<string> = new Set(),
): Set<string> {
	for (const term of value ?? []) {
		if (term.kind !== "token" || seen.has(term.token)) continue;
		seen.add(term.token);
		const token = findToken(tokens, term.token);
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

/** A short label for a term, for the property rows. */
export function termLabel(
	tokens: readonly Token[],
	term: Term,
): string {
	if (term.kind === "literal") return term.value;
	return findToken(tokens, term.token)?.name ?? term.token;
}
