import assert from "node:assert/strict";
import { test } from "node:test";

import {
	activeTerm,
	lit,
	propVar,
	ref,
	referencedTokens,
	resolveToken,
	resolveValue,
	single,
	termLabel,
	tokenVar,
	varies,
	wouldCycle,
	type Token,
} from "./values.ts";

const tokens: Token[] = [
	{ id: "accent", name: "accent", type: "color", value: [lit("#f00"), lit("#0f0")] },
	{ id: "brand", name: "brand", type: "color", value: [ref("accent")] },
	{ id: "deep", name: "deep", type: "color", value: [ref("brand")] },
];

test("varies is about the assignment, not the token", () => {
	assert.equal(varies(single("#fff")), false);
	assert.equal(varies([lit("a"), lit("b")]), true);
	assert.equal(varies(undefined), false);
	assert.equal(varies([]), false);
});

test("activeTerm follows the pick, and falls back to the first", () => {
	const value = [lit("a"), lit("b"), lit("c")];
	assert.deepEqual(activeTerm(value, "v", { v: 2 }), lit("c"));
	// No pick yet — an unsolved preview still renders.
	assert.deepEqual(activeTerm(value, "v", {}), lit("a"));
	// An out-of-range pick must not produce undefined.
	assert.deepEqual(activeTerm(value, "v", { v: 9 }), lit("a"));
});

test("resolveValue follows a chain of token references", () => {
	const ctx = { tokens, picks: { [tokenVar("accent")]: 1 } };
	assert.equal(resolveToken(ctx, "accent"), "#0f0");
	assert.equal(resolveToken(ctx, "brand"), "#0f0");
	assert.equal(resolveToken(ctx, "deep"), "#0f0", "two hops");
});

test("a property picks independently of the token it links to", () => {
	const value = [lit("#111"), ref("accent")];
	const key = propVar("n1", "fill");

	assert.equal(
		resolveValue({ tokens, picks: { [key]: 0 } }, value, key),
		"#111",
	);
	assert.equal(
		resolveValue(
			{ tokens, picks: { [key]: 1, [tokenVar("accent")]: 1 } },
			value,
			key,
		),
		"#0f0",
	);
});

test("a dangling reference resolves to nothing rather than throwing", () => {
	const ctx = { tokens, picks: {} };
	assert.equal(resolveValue(ctx, [ref("missing")], "v"), undefined);
	assert.equal(resolveValue(ctx, [], "v"), undefined);
	assert.equal(resolveValue(ctx, undefined, "v"), undefined);
});

test("a reference cycle resolves to nothing rather than hanging", () => {
	const cyclic: Token[] = [
		{ id: "a", name: "a", type: "color", value: [ref("b")] },
		{ id: "b", name: "b", type: "color", value: [ref("a")] },
	];
	assert.equal(resolveToken({ tokens: cyclic, picks: {} }, "a"), undefined);
});

test("referencedTokens walks transitively", () => {
	assert.deepEqual([...referencedTokens(tokens, [ref("deep")])].sort(), [
		"accent",
		"brand",
		"deep",
	]);
	assert.deepEqual([...referencedTokens(tokens, [lit("#fff")])], []);
});

test("wouldCycle catches direct and indirect self-reference", () => {
	assert.equal(wouldCycle(tokens, "accent", [ref("accent")]), true);
	assert.equal(wouldCycle(tokens, "accent", [ref("brand")]), true, "brand -> accent");
	assert.equal(wouldCycle(tokens, "accent", [lit("#fff")]), false);
	assert.equal(wouldCycle(tokens, "accent", [ref("missing")]), false);
});

test("termLabel shows a token's name, not its id", () => {
	assert.equal(termLabel(tokens, lit("#abc")), "#abc");
	assert.equal(termLabel(tokens, ref("accent")), "accent");
	assert.equal(termLabel(tokens, ref("gone")), "gone");
});

test("variable keys are stable ASP terms", () => {
	assert.equal(tokenVar("accent"), "tok(accent)");
	assert.equal(propVar("n1", "fill"), "prop(n1,fill)");
});
