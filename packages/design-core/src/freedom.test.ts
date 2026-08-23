/**
 * What is still free.
 *
 * Every case goes through the real solver: the whole claim is that clingo-lpx
 * reports an exact extreme for one coordinate, and a hand-computed range would
 * be testing the arithmetic in this file rather than the one in the solver.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import {
	addConstraint,
	addNode,
	addNodeTo,
	makeNode,
	setLayout,
} from "./edits.ts";
import { Explorer } from "./explore.ts";
import {
	type Freedom,
	clampTo,
	degreesOfFreedom,
	isPinned,
	isPlaced,
	narrow,
	travelFrom,
} from "./freedom.ts";
import { type Scene, emptyScene, makeLayout } from "./scene.ts";
import { managedNodes } from "./tree.ts";
import { single } from "./values.ts";

const empty = (): Scene => ({ ...emptyScene(), nodes: [] });

/** Loose rects on the canvas. */
function loose(...boxes: Array<[string, number, number, number, number]>): Scene {
	let scene = empty();
	for (const [id, x, y, width, height] of boxes) {
		scene = addNode(scene, makeNode("rect", { x, y, width, height }, { id }));
	}
	return scene;
}

/** Solves, then probes the named nodes on the same grounding. */
async function freedomOf(
	scene: Scene,
	ids: readonly string[],
): Promise<{ freedom: Freedom; solved: Record<string, Record<string, number>> }> {
	const explorer = new Explorer(directSolver);
	try {
		const result = await explorer.explore(scene, { sample: "first" });
		assert.equal(result.count, 1, "probing must not multiply the universes");
		const solved = result.universes[0].solved;
		const freedom = await explorer.probe(solved, ids);
		return { freedom, solved: solved as Record<string, Record<string, number>> };
	} finally {
		await explorer.close();
	}
}

/* ------------------------------------------------------------------ */
/* the probe                                                           */
/* ------------------------------------------------------------------ */

test("a pinned edge leaves that coordinate one legal value", async () => {
	const scene = addConstraint(
		loose(["a", 40, 60, 40, 20]),
		"pin",
		["a"],
		undefined,
		"left",
	).scene;
	const { freedom } = await freedomOf(scene, ["a"]);
	assert.deepEqual(freedom.a.x, { min: 40, max: 40 }, "left is pinned to 40");
	assert.ok(isPinned(freedom.a.x), "and reads as pinned");
	assert.deepEqual(
		freedom.a.y,
		{ min: null, max: null },
		"the other axis was never mentioned, so it runs either way for ever",
	);
	assert.ok(!isPinned(freedom.a.y));
});

test("pinning both sides pins the width between them", async () => {
	let scene = loose(["a", 0, 0, 40, 20]);
	scene = addConstraint(scene, "pin", ["a"], undefined, "left").scene;
	scene = addConstraint(scene, "pin", ["a"], undefined, "right").scene;
	const { freedom, solved } = await freedomOf(scene, ["a"]);
	assert.ok(isPinned(freedom.a.x), "x is pinned");
	assert.ok(isPinned(freedom.a.width), "and so is the span between the two");
	assert.equal(freedom.a.width?.max, solved.a.width);
	assert.ok(!isPinned(freedom.a.height), "height was never spoken about");
});

test("aligned nodes slide together, so both stay free", async () => {
	// align says the two left edges are the same number, not what the number is.
	const scene = addConstraint(
		loose(["a", 0, 0, 40, 20], ["b", 100, 60, 80, 20]),
		"align",
		["a", "b"],
		undefined,
		"left",
	).scene;
	const { freedom } = await freedomOf(scene, ["a", "b"]);
	assert.deepEqual(freedom.a.x, { min: null, max: null });
	assert.deepEqual(freedom.b.x, { min: null, max: null });
	assert.equal(degreesOfFreedom(freedom.a).length, 4, "nothing is settled");
});

test("aligning against something pinned settles the whole group", async () => {
	let scene = loose(["a", 0, 0, 40, 20], ["b", 100, 60, 80, 20]);
	scene = addConstraint(scene, "pin", ["a"], undefined, "left").scene;
	scene = addConstraint(scene, "align", ["a", "b"], undefined, "left").scene;
	const { freedom } = await freedomOf(scene, ["a", "b"]);
	assert.deepEqual(freedom.b.x, { min: 0, max: 0 }, "b inherits a's pin");
	assert.ok(!isPinned(freedom.b.y), "but only on the axis the rule names");
	assert.ok(!isPlaced(freedom.b), "so it can still be dragged, on one axis");
});

test("pinning both axes leaves the node nowhere to go", async () => {
	let scene = loose(["a", 40, 60, 40, 20]);
	scene = addConstraint(scene, "pin", ["a"], undefined, "left").scene;
	scene = addConstraint(scene, "pin", ["a"], undefined, "top").scene;
	const { freedom } = await freedomOf(scene, ["a"]);
	assert.ok(isPlaced(freedom.a));
	// Its size was never mentioned, so the node is placed without being
	// wholly determined — two different statements, and the UI makes both.
	assert.deepEqual(degreesOfFreedom(freedom.a), ["width", "height"]);
});

test("a gap fixes the distance, not the pair's place on the canvas", async () => {
	let scene = loose(["a", 0, 0, 40, 20], ["b", 100, 0, 40, 20]);
	scene = addConstraint(scene, "gap", ["a", "b"], undefined, "x").scene;
	const { freedom } = await freedomOf(scene, ["a", "b"]);
	assert.deepEqual(freedom.a.x, { min: null, max: null });
	assert.deepEqual(freedom.b.x, { min: null, max: null });
});

test("switching a constraint off gives the freedom back", async () => {
	const added = addConstraint(
		loose(["a", 40, 0, 40, 20]),
		"pin",
		["a"],
		undefined,
		"left",
	);
	const pinned = await freedomOf(added.scene, ["a"]);
	assert.ok(isPinned(pinned.freedom.a.x));

	const off = {
		...added.scene,
		constraints: added.scene.constraints.map((c) => ({ ...c, enabled: false })),
	};
	// With nothing geometric left the solver owns no coordinates at all, which
	// is the strongest form of free: the frame is just a number again.
	const { freedom, solved } = await freedomOf(off, ["a"]);
	assert.deepEqual(solved, {}, "no coordinate is the solver's any more");
	assert.deepEqual(freedom, {});
	assert.equal(degreesOfFreedom(freedom.a).length, 4);
});

test("a node no rule names has no probe to answer", async () => {
	let scene = loose(["a", 0, 0, 40, 20], ["b", 200, 0, 40, 20]);
	scene = addConstraint(scene, "pin", ["a"], undefined, "left").scene;
	const { freedom } = await freedomOf(scene, ["a", "b"]);
	assert.ok(freedom.a, "a was handed to the solver");
	assert.equal(freedom.b, undefined, "b was not, so there is nothing to say");
});

test("a rule that bounds a coordinate reports the room it left", async () => {
	// The geometric kinds are all equalities, so a range with two finite ends
	// can only come from a hand-written inequality — which is exactly the case
	// the drag limit has to get right, and the only one that draws end ticks.
	let scene = addConstraint(
		loose(["a", 40, 0, 40, 20]),
		"pin",
		["a"],
		undefined,
		"top",
	).scene;
	scene = { ...scene, rules: "&sum{ lv(a,x) } >= 20.\n&sum{ lv(a,x) } <= 90." };
	const { freedom, solved } = await freedomOf(scene, ["a"]);
	assert.deepEqual(freedom.a.x, { min: 20, max: 90 }, "that far and no further");
	assert.ok(!isPinned(freedom.a.x));
	assert.equal(solved.a.x, 40, "and the design still sits where it was drawn");
	assert.deepEqual(travelFrom(freedom.a.x, solved.a.x), { lo: -20, hi: 50 });
});

/* ------------------------------------------------------------------ */
/* auto layout                                                         */
/* ------------------------------------------------------------------ */

/** A row of three, the arrangement the rest of the suite calls a layout. */
function laidOut(): Scene {
	let scene = addNode(
		empty(),
		makeNode("frame", { x: 0, y: 0, width: 400, height: 100 }, { id: "box" }),
	);
	for (const id of ["c1", "c2", "c3"]) {
		scene = addNodeTo(
			scene,
			"box",
			makeNode("rect", { x: 0, y: 0, width: 50, height: 30 }, { id }),
		);
	}
	return setLayout(
		scene,
		"box",
		makeLayout({ gap: 10, padding: 10, sizing: "fixed" }),
	);
}

test("a laid-out child has no freedom left, which is why it cannot be dragged", async () => {
	const scene = laidOut();
	const managed = [...managedNodes(scene.nodes)];
	assert.deepEqual(managed.sort(), ["c1", "c2", "c3"]);

	const { freedom, solved } = await freedomOf(scene, managed);
	for (const id of managed) {
		for (const axis of ["x", "y", "width", "height"] as const) {
			assert.ok(
				isPinned(freedom[id][axis]),
				`${id}.${axis} should be pinned by the layout`,
			);
			assert.equal(freedom[id][axis]?.min, solved[id][axis]);
		}
		assert.deepEqual(
			degreesOfFreedom(freedom[id]),
			[],
			`${id} has nowhere to go`,
		);
	}
});

test("a growing child is still pinned — the container decides its size", async () => {
	let scene = laidOut();
	scene = {
		...scene,
		nodes: scene.nodes.map((n) =>
			n.id === "box"
				? {
						...n,
						children: (n.children ?? []).map((c) =>
							c.id === "c2" ? { ...c, grow: single("grow") } : c,
						),
					}
				: n,
		),
	};
	const { freedom } = await freedomOf(scene, ["c2"]);
	assert.deepEqual(degreesOfFreedom(freedom.c2), []);
});

/* ------------------------------------------------------------------ */
/* the arithmetic a drag does with it                                  */
/* ------------------------------------------------------------------ */

test("travel is measured from where the coordinate currently sits", () => {
	assert.deepEqual(travelFrom({ min: 10, max: 90 }, 40), { lo: -30, hi: 50 });
	assert.deepEqual(travelFrom({ min: 40, max: 40 }, 40), { lo: 0, hi: 0 });
	assert.deepEqual(travelFrom({ min: null, max: 90 }, 40), { lo: null, hi: 50 });
	assert.deepEqual(
		travelFrom(undefined, 40),
		{ lo: null, hi: null },
		"a coordinate the solver never took is not limited by it",
	);
});

test("a selection is only as free as its least free member", () => {
	assert.deepEqual(
		narrow({ lo: -30, hi: 50 }, { lo: null, hi: 20 }),
		{ lo: -30, hi: 20 },
	);
	assert.deepEqual(
		narrow({ lo: null, hi: null }, { lo: 0, hi: 0 }),
		{ lo: 0, hi: 0 },
	);
});

test("a drag is clamped into what is left, unbounded ends and all", () => {
	assert.equal(clampTo(100, { lo: -30, hi: 50 }), 50);
	assert.equal(clampTo(-100, { lo: -30, hi: 50 }), -30);
	assert.equal(clampTo(10, { lo: 0, hi: 0 }), 0);
	assert.equal(clampTo(1e6, { lo: null, hi: null }), 1e6);
});
