/**
 * Diversity against ranking, through the real solver.
 *
 * A ranked document's shown designs used to be "sort the pool by cost and take
 * the first two dozen", and on a document where two dozen is a small slice of
 * one *tie group* that is a sample by search order — the exact bias the diverse
 * strategy exists to undo, reintroduced by the ranked path. The claims here are
 * that it is undone, and that undoing it cost the ranking nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { addConstraint, addNode, makeNode, setProp, updateConstraint } from "./edits.ts";
import { type Candidate, type Exploration, explore } from "./explore.ts";
import { compareCosts, distance, selectDiverse, selectSpread } from "./sampling.ts";
import { emptyScene, type Scene } from "./scene.ts";
import { ranked } from "./templates/ranked.ts";
import { lit } from "./values.ts";

/** n rectangles, each free to take any of three fills. */
function boxes(n: number): Scene {
	let scene = emptyScene();
	const palette = [lit("#ff0000"), lit("#00ff00"), lit("#0000ff")];
	for (let i = 0; i < n; i++) {
		const id = String.fromCharCode(97 + i);
		scene = addNode(
			scene,
			makeNode("rect", { x: i * 50, y: 0, width: 40, height: 40 }, { id }),
		);
		scene = setProp(scene, [id], "fill", palette);
	}
	return scene;
}

/** Six boxes and one soft rule: 729 designs, 243 of them tied at the optimum. */
function wideTie(): Scene {
	const { scene, id } = addConstraint(boxes(6), "match", ["a", "b"], "fill");
	return updateConstraint(scene, id, { strength: "prefer" });
}

/** How spread out a set of designs is: mean pairwise distance. */
function meanDistance(universes: readonly Candidate[]): number {
	let sum = 0;
	let pairs = 0;
	for (let i = 0; i < universes.length; i++) {
		for (let j = i + 1; j < universes.length; j++) {
			sum += distance(universes[i], universes[j]);
			pairs++;
		}
	}
	return pairs === 0 ? 0 : sum / pairs;
}

/** Which alternatives each variable takes across the shown designs. */
function shownValues(exploration: Exploration): Map<string, Set<number>> {
	const values = new Map<string, Set<number>>();
	for (const universe of exploration.universes) {
		for (const [variable, index] of Object.entries(universe.pick)) {
			let seen = values.get(variable);
			if (!seen) values.set(variable, (seen = new Set()));
			seen.add(index);
		}
	}
	return values;
}

/** A bare candidate with the given cost and picks. */
function candidate(costs: number[], pick: Record<string, number>): Candidate {
	return { pick, visible: new Set(), costs };
}

test("selectSpread fills the cheap tiers first and never shows a worse design", () => {
	const pool: Candidate[] = [
		candidate([2], { v: 0 }),
		candidate([0], { v: 0, w: 0 }),
		candidate([0], { v: 0, w: 1 }),
		candidate([0], { v: 1, w: 1 }),
		candidate([1], { v: 0 }),
		candidate([1], { v: 1 }),
	];
	// The guarantee: the same multiset of costs a sort-and-slice would show.
	for (const k of [1, 2, 3, 4, 5, 6, 7]) {
		const spread = selectSpread(pool, k).map((c) => c.costs[0]);
		const sliced = [...pool]
			.sort((a, b) => compareCosts(a.costs, b.costs))
			.slice(0, k)
			.map((c) => c.costs[0]);
		assert.deepEqual([...spread].sort(), [...sliced].sort(), `k=${k}`);
		// And in order, so the first artboard is still the best design.
		for (let i = 1; i < spread.length; i++) assert.ok(spread[i - 1] <= spread[i]);
	}
	// Inside the tier that overflows, the choice is the diverse one rather than
	// the pool's order: two of the three cost-0 designs, the two furthest apart.
	const two = selectSpread(pool, 2);
	assert.deepEqual(
		two.map((c) => c.pick),
		[
			{ v: 0, w: 0 },
			{ v: 1, w: 1 },
		],
	);
});

test("with nothing to rank, selectSpread is farthest-point selection", () => {
	// Every cost vector empty is what an unranked document looks like, and the
	// two paths must not disagree about which designs earn a slot.
	const pool: Candidate[] = [];
	for (let i = 0; i < 12; i++) {
		pool.push(candidate([], { a: i % 3, b: (i * 5) % 4, c: i % 2 }));
	}
	for (const k of [1, 3, 6, 12]) {
		assert.deepEqual(selectSpread(pool, k), selectDiverse(pool, k));
	}
});

test("a ranked document shows a spread of the designs tied at the top", async () => {
	const out = await explore(wideTie(), directSolver, { limit: 24 });
	assert.equal(out.optimized, true);
	assert.equal(out.sampling.strategy, "ranked");
	assert.ok(out.sampling.sampled, "a region that does not fit the grid is sampled");
	assert.equal(out.count, 24);

	// Nothing was traded away for the spread: every design shown is tied at the
	// optimum, which is what it was before too.
	for (const universe of out.universes) {
		assert.deepEqual(universe.costs, out.costs);
	}

	// And every fill that varies takes *every* one of its values somewhere on the
	// grid. Sorting the bounded enumeration and slicing it left two of the six at
	// a single value, because 24 of 243 equally-good designs were being chosen by
	// search order.
	const shown = shownValues(out);
	for (const id of ["a", "b", "c", "d", "e", "f"]) {
		const key = `prop(${id},fill)`;
		assert.equal(
			shown.get(key)?.size,
			3,
			`${key} did not take all three of its values`,
		);
	}
	// Measured: 2.26 before, 4.00 after, against a maximum of 6.
	const mean = meanDistance(out.universes);
	assert.ok(mean > 3, `expected a spread, got mean pairwise distance ${mean}`);
});

test("a ranked document's consequences are asked of the whole bounded region", async () => {
	// Not read off the pool. The bounded enumeration is capped at 200 models of a
	// region with 729 in it, and a union over those 200 reported `a` as settled —
	// "every good design paints it red" — when all three of its values occur in
	// designs that cost exactly the same. Brave and cautious under the cost
	// ceiling is the honest answer, and this build honours the bound for both.
	const out = await explore(wideTie(), directSolver, { limit: 24 });
	assert.equal(out.brave.pick["prop(a,fill)"]?.size, 3);
	for (const id of ["a", "b", "c", "d", "e", "f"]) {
		assert.equal(out.brave.pick[`prop(${id},fill)`]?.size, 3);
		assert.equal(
			out.cautious.pick[`prop(${id},fill)`],
			undefined,
			"nothing is settled across the good designs here",
		);
	}
	// Counting honours it too, so the status line's "24 of N" is the size of the
	// near-optimal region rather than the size of the pool that happened to fit.
	assert.equal(out.total, 729, "the whole space is within two points here");
	assert.equal(out.truncated, true);
});

test("a bound that really narrows the space is counted, not sampled", async () => {
	// Zero slack keeps only the designs that pay nothing: a third of the space,
	// and an exact count of it.
	const out = await explore(wideTie(), directSolver, { limit: 24, slack: 0 });
	assert.deepEqual(out.bound, [1]);
	assert.equal(out.total, 729, "a weight of one still admits the whole space");

	// A heavier preference is one the grid stops offering to give up.
	const { scene, id } = addConstraint(boxes(6), "match", ["a", "b"], "fill");
	const heavy = updateConstraint(scene, id, { strength: "prefer", weight: 4 });
	const tight = await explore(heavy, directSolver, { limit: 24, slack: 0 });
	assert.deepEqual(tight.bound, [1]);
	assert.equal(tight.total, 243, "only the designs that satisfy the preference");
	for (const universe of tight.universes) assert.deepEqual(universe.costs, [0]);
});

test("a near-optimal region that fits the grid samples nothing", async () => {
	// The cheap case, and it has to stay cheap: sampling a region already in hand
	// would be two dozen solves spent to reorder nine designs. The `ranked`
	// template is nine designs on purpose.
	const out = await explore(ranked(), directSolver, { limit: 24 });
	assert.equal(out.optimized, true);
	assert.equal(out.count, 9);
	assert.equal(out.total, 9);
	assert.equal(out.truncated, false);
	assert.equal(out.sampling.sampled, false, "nothing to sample");
	// Two solves plus one picture each, and no more.
	assert.ok(out.solves <= 2 + out.count, `${out.solves} solves for nine designs`);
	for (let i = 1; i < out.universes.length; i++) {
		assert.ok(
			compareCosts(out.universes[i - 1].costs, out.universes[i].costs) <= 0,
			"still best first",
		);
	}
});
