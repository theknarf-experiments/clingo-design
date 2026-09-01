import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEFAULT_EASING,
	EASINGS,
	EASING_NAMES,
	MAX_MDEG,
	MAX_MS,
	MAX_PERMILLE,
	MAX_TALLY,
	SPRING_STOPS,
	VALUE_TYPES,
	VALUE_TYPE_NAMES,
	activeTerm,
	bezierOf,
	cssEasing,
	curveOf,
	keyEaseVar,
	sampleSpring,
	springOf,
	angleUnitOf,
	guideAtIn,
	guideAtVar,
	guideVar,
	isAngleType,
	isLengthType,
	isRatioType,
	isTimeType,
	keyTimeVar,
	keyValueVar,
	layoutVar,
	lit,
	mdegOf,
	motionVar,
	msOf,
	nearestMdeg,
	nearestMs,
	nearestPermille,
	numeralOf,
	parseVariable,
	permilleOf,
	propVar,
	ref,
	referencedTokens,
	resolveToken,
	resolveValue,
	rotateVar,
	single,
	tallyOf,
	termLabel,
	timelineLenVar,
	tokenVar,
	varies,
	wordOf,
	wouldCycle,
	writeAngle,
	writePermille,
	type Token,
	type ValueType,
} from "./values.ts";
import { emuOf } from "./units.ts";

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
	assert.equal(isTimeType("angle"), false, "a turn is not a duration");
	assert.equal(isAngleType("angle"), true);
	assert.equal(isAngleType("number"), false, "1.35 is not 1.35 degrees");
	assert.equal(isAngleType("duration"), false);
	assert.equal(isRatioType("number"), true);
	assert.equal(isRatioType("weight"), true, "400 is a bare number, whatever it means");
	assert.equal(isRatioType("count"), false, "a count is whole and a ratio is not");
	assert.equal(isRatioType("angle"), false);
	assert.equal(VALUE_TYPES.count.fallback, "1");
	assert.equal(VALUE_TYPES.duration.fallback, "200ms");
	assert.equal(VALUE_TYPES.angle.fallback, "0deg");
	// A quantity is one of the five readers, and a closed menu never has one:
	// the options are words, and words are read by wordOf. `solid` and `lamp` are
	// menus, which is what keeps them out of this list.
	for (const type of VALUE_TYPE_NAMES) {
		const { quantity, options } = VALUE_TYPES[type];
		if (quantity === undefined) continue;
		assert.ok(
			["length", "ratio", "count", "time", "angle"].includes(quantity),
			type,
		);
		assert.equal(options, undefined, `${type} is a quantity, not a menu`);
	}
	// Every fallback has to be readable by its own quantity's reader, or an empty
	// assignment of that type says nothing to the program that reads it. This is
	// the assertion the `angle` quantity arrived without a reader behind: the
	// table said "angle" and nothing in the module could read one.
	const readers: Record<string, (text: string) => number | undefined> = {
		length: emuOf,
		ratio: numeralOf,
		count: tallyOf,
		time: msOf,
		angle: mdegOf,
	};
	for (const type of VALUE_TYPE_NAMES) {
		const { quantity, fallback } = VALUE_TYPES[type];
		if (quantity === undefined) continue;
		const read = readers[quantity];
		assert.ok(read, `the ${quantity} quantity has a reader behind it`);
		assert.equal(
			typeof read(fallback),
			"number",
			`${type}'s fallback must read as a ${quantity}`,
		);
	}
});

test("the five quantity readers do not overlap where they must not", () => {
	// A literal has no type: the reader is chosen by what the value *is*, so the
	// only thing keeping a rotation from being read as a count is that the two
	// readers refuse each other's text. Asserted rather than assumed, because the
	// failure is silent — 45 columns and 45 degrees are the same characters.
	const readers = {
		length: emuOf,
		ratio: numeralOf,
		count: tallyOf,
		time: msOf,
		angle: mdegOf,
	} as const;
	const only = (text: string, ...kinds: (keyof typeof readers)[]) => {
		for (const [kind, read] of Object.entries(readers)) {
			const wanted = kinds.includes(kind as keyof typeof readers);
			assert.equal(
				read(text) !== undefined,
				wanted,
				`${JSON.stringify(text)} ${wanted ? "must" : "must not"} read as a ${kind}`,
			);
		}
	};

	only("200px", "length");
	only("200ms", "time");
	only("45deg", "angle");
	only("0.25turn", "angle");
	only("50grad", "angle");
	only("1.35", "ratio");
	// The two documented overlaps, and they are the whole list. A bare integer is
	// a count, a ratio and — because a bare number is pixels — a length; nothing
	// disambiguates it, and nothing needs to, because every reader in the program
	// asks by name.
	only("200", "length", "ratio", "count");
	only("12", "length", "ratio", "count");
	// And `permilleOf` is the *same* quantity as numeralOf, so it agrees with it
	// about which texts are ratios at all, and differs only about exactness.
	assert.equal(permilleOf("1.35"), 1350);
	assert.equal(permilleOf("45deg"), undefined);
	assert.equal(permilleOf("200ms"), undefined);
	assert.equal(permilleOf("200px"), undefined);
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

/* ------------------------------------------------------------------ */
/* Angles                                                              */
/* ------------------------------------------------------------------ */

test("mdegOf reads every row of the angle table", () => {
	// The table in the spec, as one parameterised test: input, what it reads as,
	// and why — the "why" left in the message so a failure names the decision it
	// broke rather than two integers.
	const rows: [string, number | undefined, string][] = [
		["45deg", 45_000, "thousandths, so 22.5deg is an integer on the first day"],
		["22.5deg", 22_500, "the half degree a designer types"],
		["-90deg", -90_000, "both directions are real"],
		["0.25turn", 90_000, "360000 × 0.25, whole"],
		["1turn", 360_000, ""],
		["50grad", 45_000, "900 × 50"],
		["0", 0, "every unit agrees about zero"],
		["0deg", 0, ""],
		["0rad", 0, "rad is legal at zero and nowhere else"],
		["0.0rad", 0, ""],
		["45", undefined, "that is a count of forty-five things everywhere else"],
		["1rad", undefined, "57295.779… — π is irrational, so there is no reading"],
		["1.0005deg", undefined, "not a whole thousandth"],
		["45DEG", 45_000, "CSS units are case-insensitive"],
		["  45 deg ", 45_000, "the three places emuOf tolerates space"],
		["3601deg", undefined, "past MAX_MDEG"],
		["3600001mdeg", undefined, "mdeg is not a unit CSS defines, so it is a typo"],
		["45px", undefined, ""],
		["", undefined, ""],
		["deg", undefined, ""],
		["+45deg", undefined, "nothing writes a leading plus"],
		["1e3deg", undefined, ""],
		[".5deg", undefined, ""],
		["45 deg 90deg", undefined, ""],
	];
	for (const [text, expected, why] of rows) {
		assert.equal(mdegOf(text), expected, `mdegOf(${JSON.stringify(text)}) ${why}`);
	}
});

test("mdegOf is exact or nothing, and nearestMdeg is the one that rounds", () => {
	// The same split emuOf/nearestEmu and msOf/nearestMs make: the parser never
	// invents a number, and the field a person is typing into asks for a rounding
	// by name rather than going blank at the third decimal.
	assert.equal(mdegOf("1.0005deg"), undefined);
	assert.equal(nearestMdeg("1.0005deg"), 1001);
	assert.equal(nearestMdeg("1.0004deg"), 1000);
	assert.equal(nearestMdeg("45deg"), 45_000, "an exact one is left alone");
	// Ties away from zero, the convention nearestEmu, nearestMs and wholeEmu all
	// use — and it keeps a negative half from coming back as a negative zero.
	assert.equal(nearestMdeg("-1.0005deg"), -1001);
	assert.ok(Object.is(nearestMdeg("-0.0004deg"), 0), "and never -0");
	// It rounds; it does not invent a unit. A radian is still refused, because
	// two readers that disagreed about what an angle is would be a worse thing to
	// own than a unit this codebase does not offer.
	assert.equal(nearestMdeg("45"), undefined);
	assert.equal(nearestMdeg("1rad"), undefined);
	assert.equal(nearestMdeg("45px"), undefined);
});

test("an angle past the ceiling reads as nothing, in both signs", () => {
	assert.equal(mdegOf(`${MAX_MDEG / 1000}deg`), MAX_MDEG, "ten turns exactly is legal");
	assert.equal(mdegOf("10turn"), MAX_MDEG);
	assert.equal(mdegOf("3600.001deg"), undefined);
	assert.equal(mdegOf("-3600.001deg"), undefined);
	assert.equal(mdegOf("-3600deg"), -MAX_MDEG);
	assert.equal(nearestMdeg("3600.0006deg"), undefined);
});

test("nothing folds an angle into a circle", () => {
	// A ceiling, not a normalisation. An animation from 0deg to 720deg spins
	// twice and one to -90deg spins the other way, so a reader that reduced
	// modulo a circle would quietly delete the difference between three designs.
	assert.equal(mdegOf("720deg"), 720_000);
	assert.notEqual(mdegOf("720deg"), mdegOf("0deg"));
	assert.equal(mdegOf("-90deg"), -90_000);
	assert.notEqual(mdegOf("-90deg"), mdegOf("270deg"));
	assert.equal(writeAngle(720_000), "720deg", "and writing it back keeps both turns");
});

test("an angle keeps its unit across an edit, exactly as a length does", () => {
	assert.equal(writeAngle(mdegOf("0.25turn") ?? 0, "turn"), "0.25turn");
	assert.equal(writeAngle(45_000), "45deg");
	assert.equal(writeAngle(22_500), "22.5deg");
	assert.equal(writeAngle(500), "0.5deg");
	assert.equal(writeAngle(1), "0.001deg", "a degree spells every angle there is");
	assert.equal(writeAngle(45_000, "grad"), "50grad");
	assert.equal(writeAngle(360_000, "turn"), "1turn");
	assert.equal(writeAngle(-90_000, "deg"), "-90deg");
	assert.equal(writeAngle(0, "turn"), "0turn");
	// A turn and a gradian are spellable on a nine-thousandth lattice, so an angle
	// they cannot say falls back to degrees rather than to six decimals of a turn.
	assert.equal(writeAngle(91_000, "turn"), "91deg");
	assert.equal(writeAngle(1, "grad"), "0.001deg");
	// A non-integer is rounded on the way in, ties away from zero, exactly as
	// formatLength sends its argument through wholeEmu.
	assert.equal(writeAngle(45_000.5), "45.001deg");
	assert.equal(writeAngle(-45_000.5), "-45.001deg");
	assert.ok(!writeAngle(-0.4).startsWith("-"), "and a rounded-away sign is not kept");

	// Every row of the angle table that reads as something round-trips.
	for (const text of ["45deg", "22.5deg", "-90deg", "0.25turn", "1turn", "50grad"]) {
		const unit = angleUnitOf(text);
		assert.ok(unit, `angleUnitOf(${text})`);
		assert.equal(mdegOf(writeAngle(mdegOf(text) ?? 0, unit)), mdegOf(text));
	}
});

test("angleUnitOf reports the spelling, so an edit can keep it", () => {
	assert.equal(angleUnitOf("45deg"), "deg");
	assert.equal(angleUnitOf("0.25turn"), "turn");
	assert.equal(angleUnitOf("50GRAD"), "grad", "case-insensitive, like the reader");
	// Zero wears no unit, or wears the one unit that is legal only at zero; both
	// are degrees to a writer, which is what writeAngle would say anyway.
	assert.equal(angleUnitOf("0"), "deg");
	assert.equal(angleUnitOf("0rad"), "deg");
	// It agrees with mdegOf about what is an angle at all — one parser, one table.
	assert.equal(angleUnitOf("1rad"), undefined);
	assert.equal(angleUnitOf("45"), undefined);
	assert.equal(angleUnitOf("45px"), undefined);
	assert.equal(angleUnitOf("1.0005deg"), "deg", "unreadable is not unspelled");
});

test("an angle round-trips through a token, alternatives and all", () => {
	// The point of the type: an `angle` token holding two alternatives is a
	// decision about how lively a design is, and the upright one and the tilted
	// one are two universes of the same document rather than two documents.
	const angles: Token[] = [
		{ id: "tilt", name: "tilt", type: "angle", value: [lit("0deg"), lit("0.25turn")] },
		{ id: "lean", name: "lean", type: "angle", value: [ref("tilt")] },
	];
	const upright = { tokens: angles, picks: {} };
	const tilted = { tokens: angles, picks: { [tokenVar("tilt")]: 1 } };

	assert.equal(mdegOf(resolveToken(upright, "tilt") ?? ""), 0);
	// Stored as typed — "0.25turn" is not normalised to "90deg" on the way
	// through — and read as the same integer either way.
	assert.equal(resolveToken(tilted, "tilt"), "0.25turn");
	assert.equal(mdegOf(resolveToken(tilted, "tilt") ?? ""), 90_000);
	assert.equal(mdegOf(resolveToken(tilted, "lean") ?? ""), 90_000, "one hop");
	// A rotation pointed at a dangling token has no angle rather than a wrong
	// one, which is what lets the program leave the node unturned.
	assert.equal(resolveValue(upright, [ref("gone")], rotateVar("n7", "rotateY")), undefined);
});

/* ------------------------------------------------------------------ */
/* The ratio's integer boundary                                        */
/* ------------------------------------------------------------------ */

test("permilleOf reads a ratio as whole thousandths", () => {
	assert.equal(permilleOf("0.5"), 500);
	assert.equal(permilleOf("1"), 1000);
	assert.equal(permilleOf("12"), 12_000);
	assert.equal(permilleOf("-2.25"), -2250);
	assert.equal(permilleOf("0"), 0);
	assert.equal(permilleOf("0.001"), 1);
	assert.equal(permilleOf(" 0.5 "), 500);
	assert.ok(Object.is(permilleOf("-0"), 0), "and never -0");
	// The one case a float multiply gets wrong: 1.005 * 1000 is
	// 1004.9999999999999 in binary, so evaluating before asking whether it is a
	// whole thousandth would refuse a ratio that is exact.
	assert.equal(permilleOf("1.005"), 1005);
	assert.equal(permilleOf("2.675"), 2675);
});

test("permilleOf reads nothing from what is not a bare decimal", () => {
	for (const text of [
		"0.0005", // exact or nothing: half a thousandth is not a thousandth
		"50%", // refused rather than divided by a hundred — see the note
		"1e3",
		"200px",
		"200ms",
		"45deg",
		"",
		"   ",
		"+1",
		".5",
		"1,5",
		"NaN",
	]) {
		assert.equal(permilleOf(text), undefined, `permilleOf(${JSON.stringify(text)})`);
	}
	// The rounding has a caller and the parser does not do it.
	assert.equal(nearestPermille("0.0005"), 1);
	assert.equal(nearestPermille("0.0004"), 0);
	assert.equal(nearestPermille("-0.0005"), -1, "ties away from zero");
	assert.ok(Object.is(nearestPermille("-0.0004"), 0));
	assert.equal(nearestPermille("50%"), undefined, "it rounds; it does not guess");
});

test("a ratio past the ceiling reads as nothing, in both signs", () => {
	assert.equal(permilleOf(String(MAX_PERMILLE / 1000)), MAX_PERMILLE);
	assert.equal(permilleOf(String(MAX_PERMILLE / 1000 + 1)), undefined);
	assert.equal(permilleOf(`-${MAX_PERMILLE / 1000}`), -MAX_PERMILLE);
	assert.equal(permilleOf(`-${MAX_PERMILLE / 1000 + 1}`), undefined);
	assert.equal(nearestPermille("1000000000"), undefined);
});

test("writePermille spells a thousandth back, and round-trips", () => {
	assert.equal(writePermille(500), "0.5");
	assert.equal(writePermille(1000), "1");
	assert.equal(writePermille(12_000), "12");
	assert.equal(writePermille(-2250), "-2.25");
	assert.equal(writePermille(0), "0");
	assert.equal(writePermille(1), "0.001");
	assert.ok(!writePermille(-0.4).startsWith("-"), "a rounded-away sign is not kept");
	for (const text of ["0.5", "1", "12", "-2.25", "0", "1.005"]) {
		assert.equal(
			permilleOf(writePermille(permilleOf(text) ?? 0)),
			permilleOf(text),
			`round trip through ${text}`,
		);
	}
});

test("a rotation is a variable, and a timeline mints three of its own", () => {
	assert.equal(rotateVar("n7", "rotateY"), "rval(n7,rotateY)");
	// A node id may be a term, so the key can hold commas that are not argument
	// separators — the property `parseAtom` exists to keep.
	assert.equal(rotateVar("cell(1,1)", "rotateZ"), "rval(cell(1,1),rotateZ)");
	// Separate from fval, because a dimension is a length and a rotation is an
	// angle, and the two readers refuse each other's text.
	assert.notEqual(rotateVar("n7", "rotateY"), "fval(n7,rotateY)");

	assert.equal(
		keyTimeVar("m1", "open", "trkd(panel,y)", 3),
		"kat(m1,open,trkd(panel,y),3)",
	);
	assert.equal(
		keyValueVar("m1", "open", "trkp(panel,fill)", 0),
		"kval(m1,open,trkp(panel,fill),0)",
	);
	assert.equal(timelineLenVar("m1", "open"), "tlen(m1,open)");
	// Machine-scoped, because `open` is what half the machines in a document call
	// that timeline: two machines' lengths must not be one variable.
	assert.notEqual(timelineLenVar("m1", "open"), timelineLenVar("m2", "open"));
	// Absent from parseVariable on purpose — see the note there. A keyframe is
	// edited on a timeline by the panel that minted its key, and
	// `kat(m1,open,trkd(panel,y),3)` is a receipt rather than a row to pin.
	assert.equal(parseVariable(keyTimeVar("m1", "open", "trkd(p,y)", 3)), null);
	assert.equal(parseVariable(keyValueVar("m1", "open", "trkd(p,y)", 3)), null);
	assert.equal(parseVariable(timelineLenVar("m1", "open")), null);
	// And `rval` does not read back *yet*, which is the one entry on that list
	// that is a debt rather than a decision — see the note on `Variable`.
	assert.equal(parseVariable(rotateVar("n7", "rotateY")), null);
});

test("the 3D vocabularies are closed menus, not free text", () => {
	// Which primitive a mesh is and which kind of lamp a light is are design
	// decisions — `[box, sphere]` is a real question with two answers — so they
	// are values with alternatives and a token link, not fields on a node.
	for (const type of ["solid", "lamp"] as ValueType[]) {
		const { options, fallback, quantity } = VALUE_TYPES[type];
		assert.ok(options && options.length > 0, `${type} has a menu`);
		assert.equal(quantity, undefined, `${type} is a menu, not a quantity`);
		assert.ok(
			options.some((o) => o.value === fallback),
			`${type}'s fallback is on its own menu`,
		);
		// The stored values are ASP constants and reach the program as themselves,
		// the way `row` and `spaceBetween` do. Nothing renders them as CSS, so
		// unlike a shadow there is no declaration hiding in the string.
		for (const option of options) {
			assert.equal(wordOf(option.value), option.value, `${type} ${option.value}`);
		}
	}
	assert.equal(VALUE_TYPES.solid.fallback, "box");
	assert.equal(VALUE_TYPES.lamp.fallback, "directional");
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


/* ------------------------------------------------------------------ */
/* Curves                                                              */
/* ------------------------------------------------------------------ */

test("one default, two tables", () => {
	// `VALUE_TYPES.easing.fallback` and `DEFAULT_EASING` are one string written
	// twice, which is what a `ValueTypeSpec` and a document reader each need. A
	// document that fell back to `ease` in the editor and `easeOut` in the program
	// would be a document nobody could debug, so the two are held equal here
	// rather than by anybody remembering.
	assert.equal(VALUE_TYPES.easing.fallback, DEFAULT_EASING);
	assert.equal(DEFAULT_EASING, "easeOut", "and it did not move when the springs arrived");
	// The menu is the table, in table order, so a ninth curve is one entry and no
	// edit anywhere else — including in `compile.ts`, which generates its
	// `measeopt/1` facts from this list.
	assert.deepEqual(
		VALUE_TYPES.easing.options?.map((o) => o.value),
		EASING_NAMES,
	);
	assert.equal(VALUE_TYPES.easing.quantity, undefined, "a curve is not a number");
	// The arithmetic in the comment above the row, counted rather than believed.
	// It has been wrong twice — the motion spec says the tenth of nineteen, the
	// parity plan says the twelfth of twenty-two — because both were written
	// against a tree that had not landed yet, and a comment that carries a number
	// nothing checks is a comment that is wrong the first time somebody adds a
	// type.
	const enumerated = VALUE_TYPE_NAMES.filter((name) => VALUE_TYPES[name].options !== undefined);
	assert.equal(VALUE_TYPE_NAMES.length, 22, "twenty-two value types");
	assert.equal(enumerated.length, 14, "fourteen of them are menus");
	assert.equal(enumerated.indexOf("easing") + 1, 14, "and the curve is the last of them");
	// Every word is a legal ASP constant, because it reaches `measing/3` as
	// itself. This is the check `oneD` exists because of.
	for (const id of EASING_NAMES) {
		assert.match(id, /^[a-z][A-Za-z0-9]*$/, id);
		assert.equal(wordOf(id), id, `${id} has to read as a word`);
	}
});

test("every spring's checked-in linear() is what its physics gives", () => {
	// The strings are constants of the universe and are written down rather than
	// computed on every export — the export runs once per keystroke in the studio,
	// and a checked-in string is a thing a reviewer can read in a diff while a
	// number produced at run time is a thing nobody ever looks at. This is what
	// makes them **checkable**: regenerate from the physics and compare.
	for (const id of EASING_NAMES) {
		const spec = EASINGS[id].spring;
		if (spec === undefined) continue;
		const stops = sampleSpring(spec).join(", ");
		assert.equal(EASINGS[id].css, `linear(${stops})`, id);
	}
	// Three springs and five plain curves, and the springs are the ones with the
	// physics on them — a plain curve with a `spring` record would be a row whose
	// panel copy says "settles naturally in" about a keyword.
	assert.deepEqual(
		EASING_NAMES.filter((id) => EASINGS[id].spring !== undefined),
		["springGentle", "springSnappy", "springBouncy"],
	);
	assert.equal(springOf("springSnappy")?.stiffness, 400);
	assert.equal(springOf("easeOut"), undefined);
	assert.equal(springOf("cubicBezier(200,0,0,1000)"), undefined);
});

test("a sampled spring is pinned at both ends and never runs backwards in time", () => {
	for (const id of EASING_NAMES) {
		const spec = EASINGS[id].spring;
		if (spec === undefined) continue;
		const stops = sampleSpring(spec);
		assert.equal(stops.length, SPRING_STOPS, id);
		// Pinned rather than taken from the formula. At `natural` the spring is
		// within half a percent of rest and not *at* rest, and a `linear()` whose
		// last stop is 0.996 leaves every animated property four thousandths short
		// of the value the state's own rule says it has — a border that never quite
		// arrives at its colour, and a box that stops one pixel out of a
		// two-hundred-pixel move.
		assert.equal(stops[0], 0, id);
		assert.equal(stops[stops.length - 1], 1, id);
		// Time is what runs forwards; travel is emphatically not, and must not be
		// asserted to be — `springBouncy` overshoots by about fifteen percent and
		// comes back, which is the whole of what "bouncy" means.
		assert.ok(stops.every((x) => Number.isFinite(x)), id);
	}
	// And the overshoot is real rather than a rounding artefact, because a spring
	// menu whose bouncy entry did not bounce would be three names for one curve.
	assert.ok(Math.max(...sampleSpring(EASINGS.springBouncy.spring!)) > 1.1);
	assert.ok(Math.max(...sampleSpring(EASINGS.springGentle.spring!)) <= 1);
});

test("bezierOf is exact or nothing", () => {
	// The dialect is the document's and not CSS's, for the reason `msOf` refuses
	// `"1.5ms"`: a bezier reaches the program as four integers and a fact has to
	// be an integer.
	assert.deepEqual(bezierOf("cubicBezier(200,0,0,1000)"), [200, 0, 0, 1000]);
	assert.deepEqual(
		bezierOf("cubicBezier(340, 1560, 640, 1000)"),
		[340, 1560, 640, 1000],
		"whitespace after the commas, and y overshoots on purpose",
	);
	// `x` is refused rather than clamped: a control point off the time axis is a
	// curve that runs backwards in time rather than a slow one, which CSS refuses
	// too and which is a typo rather than a design.
	assert.equal(bezierOf("cubicBezier(1200,0,0,0)"), undefined);
	assert.equal(bezierOf("cubicBezier(-1,0,0,1000)"), undefined);
	// A decimal anywhere reads as no curve at all: `cubicBezier(0.2,…)` is
	// two-tenths of a thousandth, ambiguous by a factor of a thousand, and
	// rounding it behind the designer's back would put a curve in the file no
	// panel agrees with.
	assert.equal(bezierOf("cubicBezier(0.2,0,0,1)"), undefined);
	// And CSS's own spelling is not the dialect. A hyphen is a minus sign to the
	// grounder, which is why the document does not store it.
	assert.equal(bezierOf("cubic-bezier(0.2,0,0,1)"), undefined);
	assert.equal(bezierOf("easeOut"), undefined);
});

test("cssEasing writes CSS for all eight words and for a bezier, and nothing else", () => {
	// The one function allowed to read `EasingSpec.css`, because there is exactly
	// one place in the system where the document's dialect becomes a browser's.
	for (const id of EASING_NAMES) {
		assert.equal(cssEasing(id), EASINGS[id].css, id);
	}
	assert.equal(cssEasing("easeInOut"), "ease-in-out", "the hyphen lives here and nowhere else");
	assert.equal(
		cssEasing("cubicBezier(200,0,0,1000)"),
		"cubic-bezier(0.2, 0, 0, 1)",
		"thousandths on the way in, decimals on the way out",
	);
	assert.ok(cssEasing("springSnappy")?.startsWith("linear("), "a spring is its whole sample");
	// Nothing else at all, so a caller that got `undefined` knows to write the
	// default — which is the same answer `not mreadsease(M,T)` gives in ASP.
	assert.equal(cssEasing("wobble"), undefined);
	assert.equal(cssEasing(""), undefined);
	// And the reader both sides share, which is what makes those two answers one
	// answer rather than two that happen to agree today.
	assert.equal(curveOf("springBouncy"), "springBouncy");
	assert.equal(curveOf("cubicBezier(200,0,0,1000)"), "cubicBezier(200,0,0,1000)");
	assert.equal(curveOf("wobble"), undefined);
	assert.equal(curveOf(undefined), undefined);
});

test("a keyframe's curve is its own variable, and cannot collide with its time", () => {
	assert.equal(keyEaseVar("m1", "open", "trkd(label,y)", 3), "keas(m1,open,trkd(label,y),3)");
	assert.notEqual(keyEaseVar("m1", "open", "x", 1), keyTimeVar("m1", "open", "x", 1));
	assert.notEqual(keyEaseVar("m1", "open", "x", 1), keyValueVar("m1", "open", "x", 1));
});
