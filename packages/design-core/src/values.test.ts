import assert from "node:assert/strict";
import { test } from "node:test";

import {
	MAX_TALLY,
	VALUE_TYPES,
	VALUE_TYPE_NAMES,
	activeTerm,
	guideAtIn,
	guideAtVar,
	guideVar,
	isLengthType,
	layoutVar,
	lit,
	numeralOf,
	parseVariable,
	propVar,
	ref,
	referencedTokens,
	resolveToken,
	resolveValue,
	single,
	tallyOf,
	termLabel,
	tokenVar,
	varies,
	wordOf,
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

test("a variable on a node a rule named reads back", () => {
	// Node ids are terms, so a key can hold commas that are not argument
	// separators. Reading one back with a regex over the argument list makes it
	// no variable at all, and everything that captions or labels a variable then
	// falls back to the raw key.
	const key = propVar("cell(1,1)", "text");
	assert.equal(key, "prop(cell(1,1),text)");
	assert.deepEqual(parseVariable(key), {
		kind: "prop",
		node: "cell(1,1)",
		prop: "text",
	});
	assert.deepEqual(parseVariable(layoutVar("row(3)", "gap")), {
		kind: "layout",
		node: "row(3)",
		field: "gap",
	});
	assert.equal(parseVariable("prop(a)"), null, "wrong arity is not a variable");
	assert.equal(parseVariable("nonsense(a,b)"), null);
});

test("wordOf reads the constant a literal stands for", () => {
	assert.equal(wordOf("row"), "row");
	assert.equal(wordOf("spaceBetween"), "spaceBetween");
	assert.equal(wordOf("#3b82f6"), undefined, "a colour is not a constant");
	assert.equal(wordOf("16px"), undefined, "nor is a length");
	assert.equal(wordOf("Row"), undefined, "an ASP constant starts lower case");
	assert.equal(wordOf("a b"), undefined);
});

test("numeralOf reads a ratio, and no longer reads a length", () => {
	assert.equal(numeralOf("1.35"), 1.35);
	assert.equal(numeralOf("400"), 400);
	assert.equal(numeralOf("0.5"), 0.5);
	assert.equal(numeralOf("-2"), -2);
	// The px suffix is gone on purpose: a length is EMU now and goes through
	// emuOf. Reading "24px" as 24 here is how a length would arrive at a ratio's
	// caller wearing its own numerals.
	assert.equal(numeralOf("24px"), undefined);
	assert.equal(numeralOf("12pt"), undefined);
	assert.equal(numeralOf("50%"), undefined, "as before, not its leading digits");
	assert.equal(numeralOf("#3b82f6"), undefined);
});

test("tallyOf reads a count, and refuses what a count cannot be", () => {
	assert.equal(tallyOf("12"), 12);
	assert.equal(tallyOf("0"), 0);
	assert.equal(tallyOf(" 3 "), 3);
	assert.equal(tallyOf("1.35"), undefined, "there are no 1.35 columns");
	assert.equal(tallyOf("-1"), undefined);
	assert.equal(tallyOf("12px"), undefined);
	assert.equal(tallyOf(String(MAX_TALLY)), MAX_TALLY);
	// Past the ceiling reads as nothing rather than grounding 1..100000.
	assert.equal(tallyOf(String(MAX_TALLY + 1)), undefined);
});

test("the quantity column says which reader a type belongs to", () => {
	assert.equal(isLengthType("length"), true);
	assert.equal(isLengthType("number"), false, "a line height is a ratio");
	assert.equal(isLengthType("count"), false);
	assert.equal(isLengthType("color"), false);
	assert.equal(VALUE_TYPES.count.fallback, "1");
	// A quantity is one of the three readers, and a closed menu never has one:
	// the options are words, and words are read by wordOf.
	for (const type of VALUE_TYPE_NAMES) {
		const { quantity, options } = VALUE_TYPES[type];
		if (quantity === undefined) continue;
		assert.ok(["length", "ratio", "count"].includes(quantity), type);
		assert.equal(options, undefined, `${type} is a quantity, not a menu`);
	}
});

test("a layout setting is a variable like any other", () => {
	assert.equal(layoutVar("box", "gap"), "lval(box,gap)");
	assert.deepEqual(parseVariable("lval(box,gap)"), {
		kind: "layout",
		node: "box",
		field: "gap",
	});
});

test("a guide setting and a guide are one variable family, and cannot collide", () => {
	assert.equal(guideVar("page", "columns"), "gval(page,columns)");
	assert.equal(guideAtVar("page", "g1"), "gval(page,at(g1))");
	assert.deepEqual(parseVariable("gval(page,at(g1))"), {
		kind: "guide",
		node: "page",
		field: "at(g1)",
	});

	// The wrapping is what keeps one family safe for both halves: a line named
	// `columns` would otherwise be the column count, and both of them resolve to
	// a length, so nothing downstream would have noticed.
	assert.equal(guideAtIn("at(g1)"), "g1");
	assert.equal(guideAtIn("columns"), undefined);
	assert.notEqual(guideAtVar("page", "columns"), guideVar("page", "columns"));
});
