import assert from "node:assert/strict";
import { test } from "node:test";

import {
	MAX_MS,
	MAX_TALLY,
	VALUE_TYPES,
	VALUE_TYPE_NAMES,
	activeTerm,
	guideAtIn,
	guideAtVar,
	guideVar,
	isLengthType,
	isTimeType,
	layoutVar,
	lit,
	motionVar,
	msOf,
	nearestMs,
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
	assert.equal(isLengthType("duration"), false, "200ms is not 200 EMU");
	assert.equal(isTimeType("duration"), true);
	assert.equal(isTimeType("count"), false, "a count of milliseconds is not one");
	assert.equal(isTimeType("length"), false);
	assert.equal(VALUE_TYPES.count.fallback, "1");
	assert.equal(VALUE_TYPES.duration.fallback, "200ms");
	// A quantity is one of the four readers, and a closed menu never has one:
	// the options are words, and words are read by wordOf.
	for (const type of VALUE_TYPE_NAMES) {
		const { quantity, options } = VALUE_TYPES[type];
		if (quantity === undefined) continue;
		assert.ok(["length", "ratio", "count", "time"].includes(quantity), type);
		assert.equal(options, undefined, `${type} is a quantity, not a menu`);
	}
	// Every fallback has to be readable by its own quantity's reader, or an empty
	// assignment of that type says nothing to the program that reads it.
	for (const type of VALUE_TYPE_NAMES) {
		if (!isTimeType(type)) continue;
		assert.equal(
			typeof msOf(VALUE_TYPES[type].fallback),
			"number",
			`${type}'s fallback must read as a duration`,
		);
	}
});

test("msOf reads a duration exactly, in whole milliseconds", () => {
	assert.equal(msOf("200ms"), 200);
	assert.equal(msOf("0.2s"), 200);
	assert.equal(msOf("1s"), 1000);
	assert.equal(msOf("0"), 0, "zero needs no unit: both readings agree");
	assert.equal(msOf("0ms"), 0);
	assert.equal(msOf("0s"), 0);
	assert.equal(msOf("0.001s"), 1, "a millisecond spelled in seconds");
	assert.equal(msOf(" 200 ms "), 200, "a person types the space and means it");
	assert.equal(msOf("200MS"), 200, "CSS units are case-insensitive");
	assert.equal(msOf("0.2S"), 200);
	// The one case a float multiply gets wrong: 1.005 * 1000 is
	// 1004.9999999999999 in binary, so evaluating before asking whether it is a
	// whole millisecond would refuse a duration that is exact.
	assert.equal(msOf("1.005s"), 1005);
	assert.equal(msOf("2.675s"), 2675);
});

test("msOf refuses a unitless number that is not zero", () => {
	// 200 is ambiguous between two units a thousand apart, and guessing would
	// make a design that animates for three minutes look like a browser bug.
	assert.equal(msOf("200"), undefined);
	assert.equal(msOf("1.5"), undefined);
	assert.equal(msOf("-4"), undefined);
	// And a suffix that is not one of the two CSS time units is not a unit this
	// module has not heard of; it is a typo.
	assert.equal(msOf("200px"), undefined);
	assert.equal(msOf("200sec"), undefined);
	assert.equal(msOf("200m"), undefined, "minutes are not a CSS time unit");
	assert.equal(msOf("200 m s"), undefined);
});

test("msOf is exact or nothing, exactly as emuOf is", () => {
	assert.equal(msOf("1.5ms"), undefined, "half a millisecond is not a duration");
	assert.equal(msOf("0.25ms"), undefined);
	assert.equal(msOf("0.0001s"), undefined, "a tenth of a millisecond");
	assert.equal(msOf("0.0005s"), undefined);
	// Not rounded down to nothing, not rounded up to one: nothing at all, which
	// is what the callers already handle.
	assert.notEqual(msOf("1.5ms"), 1);
	assert.notEqual(msOf("1.5ms"), 2);
});

test("msOf reads a negative duration, because a delay may be one", () => {
	// The clamp lives at the reading — duration and stagger clamp at zero, delay
	// does not — so one reader serves all three.
	assert.equal(msOf("-150ms"), -150);
	assert.equal(msOf("-0.2s"), -200);
	assert.equal(msOf("-0"), 0);
	assert.equal(msOf("-0.0ms"), 0, "negative zero is zero, not -0");
	assert.ok(Object.is(msOf("-0ms"), 0));
	assert.equal(msOf("+200ms"), undefined, "nothing writes a leading plus");
});

test("garbage reads as no duration rather than as its leading digits", () => {
	for (const text of [
		"",
		"   ",
		"abc",
		"#3b82f6",
		"calc(1s + 2s)",
		"1e3ms",
		".5s",
		"1..5s",
		"200ms 300ms",
		"NaN",
		"Infinity",
		"1,5s",
		"--fast",
	]) {
		assert.equal(msOf(text), undefined, `msOf(${JSON.stringify(text)})`);
		assert.equal(nearestMs(text), undefined, `nearestMs(${JSON.stringify(text)})`);
	}
});

test("a duration past the ceiling reads as nothing", () => {
	assert.equal(msOf(`${MAX_MS}ms`), MAX_MS);
	assert.equal(msOf(`${MAX_MS + 1}ms`), undefined);
	assert.equal(msOf(`-${MAX_MS}ms`), -MAX_MS);
	assert.equal(msOf(`-${MAX_MS + 1}ms`), undefined);
	// A mistyped `200000s` is a typo, not a transition. gringo's integers are
	// 32-bit and a stagger is multiplied by a sibling index.
	assert.equal(msOf("200000s"), undefined);
	assert.equal(msOf("600s"), MAX_MS, "ten minutes exactly is still legal");
	assert.equal(nearestMs("600001ms"), undefined);
});

test("nearestMs rounds, and is the only reader allowed to", () => {
	// The field a person is typing into: msOf would go blank at "1.5", and the
	// row would blank with it.
	assert.equal(nearestMs("1.5ms"), 2);
	assert.equal(nearestMs("1.4ms"), 1);
	assert.equal(nearestMs("0.0004s"), 0);
	assert.equal(nearestMs("0.0006s"), 1);
	assert.equal(nearestMs("200ms"), 200, "an exact one is left alone");
	assert.equal(nearestMs("0.2s"), 200);
	assert.equal(nearestMs("0"), 0);
	// Ties go away from zero, the convention nearestEmu, snapToUnit and wholeEmu
	// all use — and it keeps a negative half from coming back as a negative zero.
	assert.equal(nearestMs("-1.5ms"), -2);
	assert.equal(nearestMs("-0.5ms"), -1);
	assert.ok(Object.is(nearestMs("-0.4ms"), 0), "and never -0");
	// It rounds; it does not invent a unit. Unitless is still refused, because
	// the ambiguity a rounding cannot resolve is which unit was meant.
	assert.equal(nearestMs("200"), undefined);
	assert.equal(nearestMs("1.5"), undefined);
});

test("a duration round-trips through a token, alternatives and all", () => {
	// The point of the type: a `duration` token holding two alternatives is a
	// motion scale, and the brisk design and the considered one are two
	// universes of the same document rather than two documents.
	const motion: Token[] = [
		{
			id: "pace",
			name: "pace",
			type: "duration",
			value: [lit("120ms"), lit("0.24s")],
		},
		{ id: "quick", name: "quick", type: "duration", value: [ref("pace")] },
	];
	const brisk = { tokens: motion, picks: {} };
	const considered = { tokens: motion, picks: { [tokenVar("pace")]: 1 } };

	assert.equal(resolveToken(brisk, "pace"), "120ms");
	assert.equal(msOf(resolveToken(brisk, "pace") ?? ""), 120);
	// Stored as typed — "0.24s" is not normalised to "240ms" on the way through —
	// and read as the same integer either way.
	assert.equal(resolveToken(considered, "pace"), "0.24s");
	assert.equal(msOf(resolveToken(considered, "pace") ?? ""), 240);
	assert.equal(msOf(resolveToken(considered, "quick") ?? ""), 240, "one hop");

	// A transition pointed at a dangling token has no duration rather than a
	// wrong one, which is what lets the program fall back to its default.
	const dangling = resolveValue(brisk, [ref("gone")], motionVar("m1", "t1", "duration"));
	assert.equal(dangling, undefined);
});

test("a motion setting is a variable, and deliberately does not read back", () => {
	assert.equal(motionVar("m1", "press", "duration"), "mval(m1,press,duration)");
	assert.equal(motionVar("m1", "press", "delay"), "mval(m1,press,delay)");
	// Machine-scoped, because `press` is what every machine calls that
	// transition: two machines' durations must not be one variable.
	assert.notEqual(
		motionVar("m1", "press", "duration"),
		motionVar("m2", "press", "duration"),
	);
	// Absent from parseVariable on purpose — see the note there. The generic
	// readers could not act on it, and the panel that mints it already knows.
	assert.equal(parseVariable(motionVar("m1", "press", "duration")), null);
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
