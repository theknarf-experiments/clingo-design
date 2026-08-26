/**
 * The boundary where a length becomes an ASP fact, and comes back.
 *
 * Everything inside design-core measures in EMU — an integer 1/914400 of an
 * inch — and everything inside clingo measures in whatever the facts say. This
 * file is the seam between those two claims, and it exists because the seam
 * used to be held together by three `Math.round` calls: a clingo fact has to be
 * an integer, so the compiler rounded whatever the document said and the canvas
 * kept the unrounded number. That is why a box could be drawn at one place and
 * hit-tested at another.
 *
 * Four things are asserted here, and they are the four halves of the claim:
 *
 *   - the number that goes in is the number the document holds, exactly, in
 *     whatever unit a designer typed it in;
 *   - the number that comes back out is exact too, including where simplex
 *     answers in thirds;
 *   - a hand-written rule can still say "fifty pixels", because `emupx` is
 *     declared for it;
 *   - and the ceiling this buys is *real*, so it is grounded rather than
 *     asserted — gringo's integers are 32-bit and they wrap in total silence.
 *
 * Page-sized magnitudes throughout, because that is where the old arithmetic
 * was worst and where the new arithmetic has the most room to be wrong: A4 is
 * 210 mm, which is 7,560,000 EMU and 793.7 CSS pixels, so nothing in this file
 * would have survived a whole-pixel document.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ASP_EMU_CEILING, aspLayoutCeiling, compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { explore } from "./explore.ts";
import { readSolved } from "./model.ts";
import {
	type Constraint,
	type Scene,
	type SceneNode,
	emptyScene,
} from "./scene.ts";
import { makeNode } from "./edits.ts";
import { EMU_PER_PX } from "./units.ts";
import { single } from "./values.ts";

/** One millimetre, and one point, as the exact integers the table promises. */
const MM = 36000;
const PT = 12700;

const empty = (): Scene => ({ ...emptyScene(), nodes: [], constraints: [] });

/**
 * A rectangle whose four dimensions are *typed*, not dragged.
 *
 * `makeNode` runs its frame through `normaliseFrame`, which quantizes a gesture
 * to a whole pixel — right for a pointer and wrong for a page, since 210 mm is
 * not a whole number of pixels and never will be. So the frame is written on
 * afterwards as the literals a person would have entered, which is also the
 * only way to get a document that says `"210mm"` rather than a document that
 * says the nearest pixel to it.
 */
function box(id: string, x: string, y: string, w: string, h: string): SceneNode {
	return {
		...makeNode("rect", { x: 0, y: 0, width: EMU_PER_PX, height: EMU_PER_PX }, { id }),
		frame: { x: single(x), y: single(y), width: single(w), height: single(h) },
	};
}

const scened = (...nodes: SceneNode[]): Scene => ({ ...empty(), nodes });

const ruled = (scene: Scene, ...constraints: Constraint[]): Scene => ({
	...scene,
	constraints: [...scene.constraints, ...constraints],
});

const geometric = (
	id: string,
	kind: Constraint["kind"],
	nodes: string[],
	edge: Constraint["edge"],
	value?: string,
): Constraint => ({
	id,
	kind,
	prop: "fill",
	nodes,
	edge,
	enabled: true,
	...(value === undefined ? {} : { value: single(value) }),
});

const solve = async (scene: Scene) => {
	const result = await explore(scene, directSolver, { sample: "first" });
	return result.universes[0].solved;
};

/* ------------------------------------------------------------------ */
/* What crosses in                                                     */
/* ------------------------------------------------------------------ */

/**
 * The facts one literal produced, by the text it was interned under.
 *
 * Read out of the program rather than out of a mock, because the whole question
 * is what clingo is handed: the literal table is a level of indirection and a
 * test that skipped it would be testing `emuOf` a second time.
 */
function bridges(scene: Scene): Map<string, Record<string, number | string>> {
	const program = compile(scene).generated;
	const byId = new Map<string, string>();
	for (const [, id, text] of program.matchAll(/^literal\((l\d+),"(.*)"\)\.$/gm)) {
		byId.set(id, text);
	}
	const out = new Map<string, Record<string, number | string>>();
	for (const text of byId.values()) out.set(text, {});
	for (const [, name, id, value] of program.matchAll(
		/^(numeral|tally|word)\((l\d+),(.+)\)\.$/gm,
	)) {
		const text = byId.get(id);
		if (text === undefined) continue;
		out.get(text)![name] = name === "word" ? value : Number(value);
	}
	return out;
}

/** A scene whose only job is to intern the given texts as literals. */
const literals = (...texts: string[]): Scene => ({
	...empty(),
	tokens: texts.map((text, i) => ({
		id: `t${i}`,
		name: `t${i}`,
		type: "length" as const,
		value: single(text),
	})),
});

test("a length reaches ASP as EMU, in whichever unit it was written", () => {
	const facts = bridges(literals("24px", "0.25in", "18pt", "6mm", "1pc"));
	// All five are the same length said five ways — a quarter of an inch — and
	// the point of EMU is that they are the *same integer*, not five roundings
	// that happen to agree.
	assert.equal(facts.get("24px")!.numeral, 228600);
	assert.equal(facts.get("0.25in")!.numeral, 228600);
	assert.equal(facts.get("18pt")!.numeral, 228600);
	// And a metric length, which no pixel count can say: 6 mm is 22.677... px.
	assert.equal(facts.get("6mm")!.numeral, 6 * MM);
	assert.equal(facts.get("1pc")!.numeral, 152400);
});

test("a ratio is not a length and emits no numeral at all", () => {
	const facts = bridges(literals("1.35", "0.5", "400"));
	// This is the failure the split exists to prevent. `numeralOf` used to read
	// "1.35" as 1.35 and the emitter rounded it to `numeral(l,1)` — a line height
	// silently declaring itself one pixel tall. Now a line height reads as no
	// length, so no fact is emitted and no rule can mistake it for one.
	assert.equal(facts.get("1.35")!.numeral, undefined);
	assert.equal(facts.get("0.5")!.numeral, undefined);
	// "400" is a weight, and it *is* a whole number of pixels as far as the
	// parser can tell, so it does emit one. That is deliberate noise: a literal
	// has no type, so the only alternative is to guess. No rule reads it.
	assert.equal(facts.get("400")!.numeral, 400 * EMU_PER_PX);
});

test("a count crosses on its own family, because the grounder reads it", () => {
	const facts = bridges(literals("12", "3.5", "-4"));
	// `1..N` off numeral/2 would ground 114300 tracks for a twelve-column grid.
	assert.equal(facts.get("12")!.tally, 12);
	assert.equal(facts.get("12")!.numeral, 12 * EMU_PER_PX, "and a length too");
	// A count cannot be fractional or negative, and neither can be a tally.
	assert.equal(facts.get("3.5")!.tally, undefined);
	assert.equal(facts.get("-4")!.tally, undefined);
});

test("a length no EMU spells says nothing, rather than saying nearly", () => {
	// Half a CSS pixel is 4762.5 EMU and 9525 is odd, so this is not a length.
	// Reading it as 14288 would be a rounding nobody asked for and nobody could
	// see; `frameDim` falls back in exactly the same place, so the two sides of
	// the document still agree — which is the property the old code bought with
	// two roundings that had to be kept in step by hand.
	const facts = bridges(literals("1.5px", "50%", "calc(2px)", "#3b82f6"));
	for (const text of ["1.5px", "50%", "calc(2px)", "#3b82f6"]) {
		assert.equal(facts.get(text)!.numeral, undefined, text);
	}
});

test("nothing the compiler emits carries a fraction", () => {
	// The law the three deleted `Math.round`s used to enforce by force. Quoted
	// text is exempt — "1.35" is a literal a rule may compare, not a number —
	// so the strings come out first and what is left is arithmetic.
	const scene = ruled(
		scened(
			box("page", "0mm", "0mm", "210mm", "297mm"),
			box("a", "20mm", "30mm", "60.5mm", "40mm"),
		),
		geometric("k_pin", "pin", ["a"], "left", "20.5mm"),
	);
	const arithmetic = compile(scene).generated.replace(/"(?:[^"\\]|\\.)*"/g, '""');
	const fraction = /\d\.\d/.exec(arithmetic);
	assert.equal(fraction, null, `a fraction reached the program: ${fraction?.[0]}`);
});

/* ------------------------------------------------------------------ */
/* What comes back                                                     */
/* ------------------------------------------------------------------ */

test("a page-sized document solves exactly, in millimetres", async () => {
	// A4, and two boxes on it, all of it in millimetres — which is to say none
	// of it on the pixel grid: 90 mm is 340.157... px, so every number this test
	// asserts was unrepresentable in the document before EMU.
	const scene = ruled(
		scened(
			box("page", "0mm", "0mm", "210mm", "297mm"),
			box("a", "20mm", "30mm", "60mm", "40mm"),
			box("b", "130mm", "30mm", "60mm", "40mm"),
		),
		geometric("k_pin", "pin", ["a"], "left", "20mm"),
		geometric("k_gap", "gap", ["a", "b"], "x", "10mm"),
	);
	const solved = await solve(scene);
	assert.equal(solved.a.x, 20 * MM, "the pin holds a where it was typed");
	// 20 + 60 + 10, and the assertion is on the integer rather than on a
	// tolerance: an exact answer is the entire claim.
	assert.equal(solved.b.x, 90 * MM);
	assert.ok(Number.isInteger(solved.b.x), "and an integer count of EMU");
});

test("units may be mixed in one document and still come out exact", async () => {
	// A designer sets type in points and rules the page in millimetres, and the
	// two meet in a gap that is neither. 40 mm is 113.385...pt: there is no unit
	// in which every number here is round, which is the case EMU is for.
	const scene = ruled(
		scened(
			box("a", "0mm", "0mm", "40mm", "12pt"),
			box("b", "100mm", "0mm", "40mm", "12pt"),
		),
		geometric("k_pin", "pin", ["a"], "left", "0mm"),
		geometric("k_gap", "gap", ["a", "b"], "x", "36pt"),
	);
	const solved = await solve(scene);
	assert.equal(solved.a.height, 12 * PT);
	assert.equal(solved.b.x, 40 * MM + 36 * PT, "millimetres plus points, exactly");
});

test("a coordinate simplex answers in thirds becomes a whole EMU", () => {
	// clingo-lpx answers with exact rationals and has to: three children sharing
	// a leftover is a third of something. `readSolved` is the one place that is
	// quantized, and at 1/914400 in the remainder cannot reach any output medium
	// — which was not true when the same divide threw away a third of a pixel.
	const solved = readSolved([
		'__lpx(lv(n,x),"320/3")',
		'__lpx(lv(n,y),"-320/3")',
		'__lpx(lsz(n,width),"7560000")',
	]);
	assert.equal(solved.n.x, 107, "106.66... rounds up");
	assert.equal(solved.n.y, -107, "and ties break away from zero on both sides");
	assert.equal(solved.n.width, 7560000, "an exact answer is left alone");
	for (const v of Object.values(solved.n)) assert.ok(Number.isInteger(v));
});

/* ------------------------------------------------------------------ */
/* What a hand-written rule can still say                              */
/* ------------------------------------------------------------------ */

test("emupx lets a rule go on writing pixels, and gringo folds it", async () => {
	const program = compile(empty()).generated;
	assert.match(program, /^#const emupx = 9525\.$/m);

	// End to end: the rule says fifty pixels, the answer set holds the EMU. This
	// is what keeps the sudoku and map templates readable — and what keeps every
	// rule anyone has already written in the power panel one edit from correct
	// rather than silently a twentieth of its intended size.
	const scene: Scene = {
		...empty(),
		rules: [
			"node(cell). kind(cell,rect).",
			"frame(cell,x,20*emupx). frame(cell,width,50*emupx).",
		].join("\n"),
	};
	const result = await explore(scene, directSolver, { sample: "first" });
	const model = result.universes[0].model;
	assert.equal(model?.byId.cell?.frame.x, 20 * EMU_PER_PX);
	assert.equal(model?.byId.cell?.frame.width, 50 * EMU_PER_PX);
});

/* ------------------------------------------------------------------ */
/* The ceiling                                                         */
/* ------------------------------------------------------------------ */

/** Grounds one arithmetic rule and reports what clingo made of it. */
async function grounds(expression: string): Promise<number> {
	const session = await directSolver.open(`a(X) :- X = ${expression}.\n#show a/1.`);
	try {
		const model = (await session.solve({ models: 1 })).models[0] ?? [];
		const m = /^a\((-?\d+)\)$/.exec(model[0] ?? "");
		assert.ok(m, `no answer for ${expression}: ${model.join(" ")}`);
		return Number(m[1]);
	} finally {
		await session.close();
	}
}

test("gringo's integers are 32-bit and overflow without a word", async () => {
	// The reason ASP_EMU_CEILING is a number and not a shrug. The widest term in
	// the generated program is `D = 4*V` — an edge is doubled so a centre is
	// whole, and a mirrorless `symmetric` has two of them — so the largest EMU a
	// document may name is bounded by whatever gringo does with four of it.
	//
	// What it does is wrap, quietly, with an empty diagnostics channel: there is
	// no error and no warning, so a document that went over would simply be
	// drawn inside out. That is exactly the kind of claim that rots if it is
	// only written down, hence this test.
	assert.equal(await grounds(`4*${ASP_EMU_CEILING}`), 2 ** 31 - 4);
	assert.equal(await grounds(`4*${ASP_EMU_CEILING + 1}`), -(2 ** 31));

	// And what the ceiling comes to in the units a person thinks in: a hair over
	// 56,000 px, or 48 feet of artboard. Narrower than the ~536M px of the
	// pixel-counting document that came before, and still some hundreds of times
	// anything anyone has drawn.
	assert.equal(ASP_EMU_CEILING, 536870911);
	assert.equal(Math.floor(ASP_EMU_CEILING / EMU_PER_PX), 56364);
	assert.equal(Math.floor(ASP_EMU_CEILING / (25.4 * MM)), 587, "inches");
});

test("a wide row wraps long before a constraint does", async () => {
	// The claim ASP_EMU_CEILING used to make alone — that `4*V` is the widest
	// arithmetic anywhere in the program — is false, and the hugging layout rule
	// is what falsifies it: it grounds `2*P + (K-1)*G`, and `K` is a child count
	// nothing in a document bounds. Four children already beat four.
	//
	// Below that the child count is not what binds, so the two agree.
	assert.equal(aspLayoutCeiling(1), ASP_EMU_CEILING);
	assert.equal(aspLayoutCeiling(3), ASP_EMU_CEILING);
	assert.ok(aspLayoutCeiling(4) < ASP_EMU_CEILING, "four children bind");

	// And the fall is steep: a row of a hundred is held to a fortieth of it.
	const wide = aspLayoutCeiling(100);
	assert.ok(wide < ASP_EMU_CEILING / 20);
	assert.equal(Math.floor(wide / EMU_PER_PX), 2232, "px of gap");

	// Ground the rule's own right-hand side at the boundary and one step past
	// it, the same way the constant above is checked rather than believed. With
	// padding and gap both at the ceiling the sum is `(K+1)` of them.
	assert.equal(await grounds(`2*${wide} + 99*${wide}`), 101 * wide);
	assert.ok(
		(await grounds(`2*${wide + 1} + 99*${wide + 1}`)) < 0,
		"one EMU more and it wraps, silently, into a negative width",
	);
});

test("a document at the far edge of the ceiling still solves exactly", async () => {
	// Ten metres of artboard — a trade-show wall, and about a fifth of the way
	// to the ceiling — with a mirror line down the middle. `symmetric` about a
	// line is the `4*V` rule, so this is the one that would wrap first.
	const half = 5000 * MM;
	const scene = ruled(
		scened(
			box("a", "0mm", "0mm", "500mm", "500mm"),
			box("b", "9000mm", "0mm", "500mm", "500mm"),
		),
		geometric("k_pin", "pin", ["a"], "left", "0mm"),
		geometric("k_mirror", "symmetric", ["a", "b"], "x", "5000mm"),
	);
	const solved = await solve(scene);
	assert.equal(solved.a.x, 0);
	// a's centre is 250 mm; b's must be 9750 mm, so its left edge is 9500 mm.
	assert.equal(solved.b.x, 9500 * MM);
	assert.ok(4 * half < 2 ** 31, "and the widest term stayed inside the ceiling");
});
