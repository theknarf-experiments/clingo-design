/**
 * The marks a geometric constraint puts on the canvas.
 *
 * Mostly plain geometry, so mostly plain assertions — but the claim that a
 * mark says where the design *ended up* rather than where the document stores
 * it only holds if it reads the solver's answer, so the last case goes through
 * the real solver.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { annotate } from "./annotate.ts";
import { directSolver } from "./directSolver.ts";
import { addConstraint, addNode, makeNode, updateConstraint } from "./edits.ts";
import { explore } from "./explore.ts";
import { type Scene, emptyScene } from "./scene.ts";

const loose = (...boxes: Array<[string, number, number, number, number]>): Scene => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	for (const [id, x, y, width, height] of boxes) {
		scene = addNode(scene, makeNode("rect", { x, y, width, height }, { id }));
	}
	return scene;
};

const on = (ids: string[]) => new Set(ids);

test("an alignment draws one line across everything it holds together", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 0, 100, 60, 20]);
	const marks = annotate(
		addConstraint(scene, "align", ["a", "b"], undefined, "left").scene,
		on(["a"]),
	);
	assert.equal(marks.length, 1);
	assert.deepEqual(marks[0], {
		constraint: marks[0].constraint,
		kind: "align",
		shape: "line",
		axis: "x",
		at: 0,
		// A shade past both boxes, so the line is not lost under the selection
		// outline it happens to lie along.
		from: -8,
		to: 128,
	});
});

test("a gap draws the distance it holds, between the two it holds apart", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 100, 0, 40, 20]);
	const marks = annotate(
		addConstraint(scene, "gap", ["a", "b"], undefined, "x").scene,
		on(["b"]),
	);
	assert.deepEqual(marks, [
		{
			constraint: marks[0].constraint,
			kind: "gap",
			shape: "span",
			axis: "x",
			at: 10,
			from: 40,
			to: 100,
			label: "60",
		},
	]);
});

test("a size rule marks each member, because a size is each member's own", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 200, 0, 40, 60]);
	const marks = annotate(
		addConstraint(scene, "equalSize", ["a", "b"], undefined, "width").scene,
		on(["a"]),
	);
	assert.equal(marks.length, 2);
	assert.deepEqual(
		marks.map((m) => [m.shape, m.from, m.to, m.label]),
		[
			["span", 0, 40, "40"],
			["span", 200, 240, "40"],
		],
	);
});

test("a pin says which coordinate it is holding", () => {
	const scene = loose(["a", 30, 0, 40, 20]);
	const marks = annotate(
		addConstraint(scene, "pin", ["a"], undefined, "left").scene,
		on(["a"]),
	);
	assert.equal(marks[0].label, "30", "the number is the whole point of a pin");
	assert.equal(marks[0].at, 30);
});

test("a mirror is drawn where the members balance, not where the number says", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 300, 0, 60, 20]);
	const added = addConstraint(scene, "symmetric", ["a", "b"], undefined, "x");
	// Move the line without solving: the mark still reports the design as it
	// stands, which is what stops it lying about an unsolved document.
	const moved = updateConstraint(added.scene, added.id, { value: 500 });
	const marks = annotate(moved, on(["a"]));
	assert.equal(marks[0].shape, "line");
	assert.equal(marks[0].at, 175, "halfway between the two centres");
});

test("nothing is drawn for a rule nobody is looking at, or a rule switched off", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 0, 100, 40, 20], ["c", 0, 200, 40, 20]);
	const added = addConstraint(scene, "align", ["a", "b"], undefined, "left");
	assert.deepEqual(annotate(added.scene, on(["c"])), [], "not a member");
	assert.deepEqual(annotate(added.scene, on([])), [], "nothing selected");
	const off = updateConstraint(added.scene, added.id, { enabled: false });
	assert.deepEqual(annotate(off, on(["a"])), [], "switched off");
});

test("a colour rule has nothing to draw", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 0, 100, 40, 20]);
	const matched = addConstraint(scene, "match", ["a", "b"], "fill").scene;
	assert.deepEqual(annotate(matched, on(["a"])), []);
});

test("the mark follows the solved geometry, not the stored frame", async () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 100, 100, 40, 20]);
	// Pinned so there is one answer rather than a whole face of them: both
	// left edges end up at 55, which is neither node's stored x.
	const pinned = addConstraint(scene, "pin", ["a"], undefined, "left");
	const held = updateConstraint(pinned.scene, pinned.id, { value: 55 });
	const constrained = addConstraint(held, "align", ["a", "b"], undefined, "left").scene;

	const result = await explore(constrained, directSolver, { sample: "first" });
	const solved = result.universes[0].solved;
	const line = annotate(constrained, on(["a"]), solved).find(
		(m) => m.kind === "align",
	);
	assert.equal(solved.a.x, 55);
	assert.equal(line?.at, 55, "where the solver put them, not where they were");
});
