/**
 * Parametric dimensions: a `gap` or a `pin` whose number is a token.
 *
 * Two claims are being made, and both go through the real solver. One, the
 * geometry follows the token — the value is resolved per universe, not baked
 * into a fact. Two, a token with several lengths makes several *universes*,
 * which is not free: geometry lives in theory variables that no answer set can
 * differ by, so the dimension itself has to be part of the projection.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { addConstraint, addNode, makeNode, updateConstraint } from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import { type Scene, dimension, emptyScene } from "./scene.ts";
import { findTemplate } from "./templates/index.ts";
import { EMU_PER_PX } from "./units.ts";
import { type Value, lit, ref, single, tokenVar } from "./values.ts";

/**
 * The token values here are `px` strings and the solver's answers are EMU, so
 * the assertions carry the factor. The cases are left in pixels because what
 * each of them is about is a token holding 20, 90 or 160 — three numbers a
 * reader recognises as three rows of a design table.
 */
const P = EMU_PER_PX;

const px = (n: number): number => n * P;

/** Two loose rects and one `length` token, which is the whole apparatus. */
function scene(token: Value): Scene {
	let out: Scene = {
		...emptyScene(),
		nodes: [],
		tokens: [{ id: "size", name: "size", type: "length", value: token }],
	};
	for (const [id, x] of [
		["a", 0],
		["b", 200],
	] as const) {
		out = addNode(
			out,
			makeNode("rect", { x: px(x), y: 0, width: px(40), height: px(20) }, { id }),
		);
	}
	return out;
}

/** A pin on a's left edge, holding whatever `value` comes to. */
function pinned(token: Value, value: Value): Scene {
	const added = addConstraint(scene(token), "pin", ["a"], undefined, "left");
	return updateConstraint(added.scene, added.id, { value });
}

const explored = (s: Scene) => explore(s, directSolver, { sample: "first" });

test("a dimension that names a token takes the token's value", async () => {
	const near = await explored(pinned(single("40px"), [ref("size")]));
	assert.equal(near.count, 1, "one length is one design");
	assert.equal(near.universes[0].solved.a.x, px(40));

	// The only edit is to the token, and the geometry moves with it.
	const far = await explored(pinned(single("175px"), [ref("size")]));
	assert.equal(far.universes[0].solved.a.x, px(175));
});

test("three lengths on one token are three universes, at three places", async () => {
	const result = await explored(
		pinned([lit("20px"), lit("90px"), lit("160px")], [ref("size")]),
	);
	assert.equal(result.count, 3, "a design table has a row per value");
	assert.deepEqual(
		result.universes.map((u) => u.solved.a.x ?? 0).sort((p, q) => p - q),
		[px(20), px(90), px(160)],
	);
	// Each universe still says which alternative it took, so the grid can
	// caption itself and the Variables panel can pin one.
	assert.deepEqual(
		new Set(result.universes.map((u) => u.pick[tokenVar("size")])),
		new Set([0, 1, 2]),
	);
});

test("a dimension typed in as a number is still one universe", async () => {
	// The guard on the trade-off: projecting the dimension must not turn a
	// document that never asked for alternatives into several designs.
	const result = await explored(pinned(single("40px"), dimension(px(90))));
	assert.equal(result.count, 1);
	assert.equal(result.universes[0].solved.a.x, px(90));
});

test("two constraints driven by one token move together", async () => {
	const added = addConstraint(
		pinned([lit("30px"), lit("120px")], [ref("size")]),
		"gap",
		["a", "b"],
		undefined,
		"x",
	);
	const result = await explored(
		updateConstraint(added.scene, added.id, { value: [ref("size")] }),
	);
	assert.equal(result.count, 2, "one token, one dimension, two designs");
	for (const u of result.universes) {
		const left = u.solved.a.x ?? 0;
		const gap = (u.solved.b.x ?? 0) - (left + (u.solved.a.width ?? 0));
		assert.equal(gap, left, "the same token drove the pin and the gap");
	}
});

test("a value that is not a number leaves the relation unstated", async () => {
	// A dangling reference, a percentage, a colour: the dimension resolves to
	// no number, so the constraint says nothing rather than meaning zero — and
	// the node stays exactly where the document put it.
	const result = await explored(pinned(single("auto"), [ref("size")]));
	assert.equal(result.count, 1);
	assert.equal(result.universes[0].solved.a.x, 0, "left where it was drawn");
});

test("a token-driven rule is named in the core like any other", async () => {
	const one = addConstraint(
		pinned(single("40px"), [ref("size")]),
		"pin",
		["a"],
		undefined,
		"left",
	);
	const both = updateConstraint(one.scene, one.id, { value: dimension(300) });
	const error = await explore(both, directSolver).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError);
	assert.equal(error.conflict.length, 2, "both pins are blamed, not neither");
});

test("the design-table template shows its three configurations", async () => {
	const result = await explore(findTemplate("rail")?.create() as Scene, directSolver, {
		sample: "first",
	});
	assert.equal(result.count, 3);
	const gaps = result.universes
		.map((u) => (u.solved.two.x ?? 0) - ((u.solved.one.x ?? 0) + px(120)))
		.sort((p, q) => p - q);
	assert.deepEqual(gaps, [px(16), px(56), px(112)]);
	// The margin is a token too, and it holds in every one of them.
	for (const u of result.universes) assert.equal(u.solved.one.x, px(60));
});
