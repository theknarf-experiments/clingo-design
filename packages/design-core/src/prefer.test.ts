/**
 * Soft rules, through the real solver.
 *
 * Every claim here is one the design rests on and none of them is obvious from
 * the ASP: that a preference costs instead of forbidding, that the tiers are a
 * lexicographic order rather than a scale, that a bounded enumeration still
 * *holds several designs* — which is the whole point — and that the weak
 * constraints and the simplex objective do not fight over the geometry.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import {
	addConstraint,
	addNode,
	makeNode,
	setProp,
	updateConstraint,
} from "./edits.ts";
import {
	type Exploration,
	describeCosts,
	explore,
	rankedBound,
} from "./explore.ts";
import { compareCosts } from "./sampling.ts";
import { STRENGTHS, emptyScene, type Scene } from "./scene.ts";
import { lit, single } from "./values.ts";

/** Three rectangles in a frame, each free to take any of three fills. */
function threeBoxes(): Scene {
	let scene = emptyScene();
	const palette = [lit("#ff0000"), lit("#00ff00"), lit("#0000ff")];
	for (const id of ["a", "b", "c"]) {
		scene = addNode(
			scene,
			makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id }),
		);
		scene = setProp(scene, [id], "fill", palette);
	}
	return scene;
}

const run = (scene: Scene, limit = 200): Promise<Exploration> =>
	explore(scene, directSolver, { limit, sample: "first" });

/** Every fill the shown designs assign, per node. */
const fills = (exploration: Exploration) =>
	exploration.universes.map((u) =>
		["a", "b", "c"].map((id) => u.model.byId[id]?.rendered.fill),
	);

test("a hard rule forbids, a soft rule of the same kind costs", async () => {
	const { scene, id } = addConstraint(threeBoxes(), "match", ["a", "b"], "fill");
	// Hard: the 18 designs where a and b differ are gone.
	const hard = await run(scene);
	assert.equal(hard.count, 9);
	assert.equal(hard.optimized, false);
	assert.deepEqual(hard.costs, []);

	// Soft: the same relation, over the same members, ranked. The best designs
	// still satisfy it — cost 0 — and they are the ones shown.
	const soft = await run(updateConstraint(scene, id, { strength: "prefer" }));
	assert.equal(soft.optimized, true);
	assert.deepEqual(soft.costs, [0]);
	assert.ok(soft.count > 1, "a ranked document still holds several designs");
	// Every design that pays nothing satisfies it; the ones that do not are the
	// ones that paid, and they are shown too — best first, with the price on
	// them. That is the whole difference from a prohibition.
	for (const u of soft.universes) {
		const [a, b] = ["a", "b"].map((id) => u.model.byId[id]?.rendered.fill);
		assert.equal(a === b, u.costs[0] === 0);
	}
});

test("a soft rule the design cannot satisfy is paid for, not refused", async () => {
	// `differ` over three boxes with three colours is satisfiable; over three
	// boxes with *one* colour it is not, and hard that is UNSAT. Soft, the
	// document still has designs and they cost a point.
	let scene = emptyScene();
	for (const id of ["a", "b", "c"]) {
		scene = addNode(
			scene,
			makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id }),
		);
		scene = setProp(scene, [id], "fill", [lit("#ff0000")]);
	}
	const { scene: withRule, id } = addConstraint(scene, "differ", ["a", "b"], "fill");
	await assert.rejects(() => run(withRule), /cannot hold/);

	const soft = await run(updateConstraint(withRule, id, { strength: "prefer" }));
	assert.equal(soft.count, 1);
	assert.deepEqual(soft.costs, [1], "one violated preference, weight 1");
});

test("weight is what a violation costs, and it reaches the cost vector", async () => {
	const { scene, id } = addConstraint(threeBoxes(), "match", ["a", "b"], "fill");
	// Pinning both boxes apart makes the preference unsatisfiable, so the cost
	// is the weight itself rather than zero.
	const soft = updateConstraint(scene, id, { strength: "prefer", weight: 7 });
	const out = await explore(soft, directSolver, {
		limit: 4,
		sample: "first",
		pins: { "prop(a,fill)": 0, "prop(b,fill)": 1 },
	});
	assert.deepEqual(out.costs, [7]);
});

test("tiers are lexicographic: no amount of the lower one buys the higher", async () => {
	// Two preferences that cannot both hold: a and b the same (strong), a and b
	// different (slight). The strong one wins in every shown design, whatever
	// the other costs.
	const one = addConstraint(threeBoxes(), "match", ["a", "b"], "fill");
	const two = addConstraint(one.scene, "differ", ["a", "b"], "fill");
	let scene = updateConstraint(two.scene, one.id, {
		strength: "strong",
		weight: 1,
	});
	scene = updateConstraint(scene, two.id, { strength: "slight", weight: 20 });

	const out = await run(scene);
	assert.deepEqual(out.levels, [
		STRENGTHS.strong.level,
		STRENGTHS.slight.level,
	]);
	assert.deepEqual(out.costs, [0, 20], "the strong tier is satisfied, at any price");
	// The best design keeps the strong preference and pays 20 for it. Twenty
	// points of the lower tier do not buy one point of the higher, which is what
	// a lexicographic order *is* — a single weighted sum would have gone the
	// other way here.
	const [a, b] = fills(out)[0];
	assert.equal(a, b);
});

test("swapping the tiers swaps the answer, with the same weights", async () => {
	const one = addConstraint(threeBoxes(), "match", ["a", "b"], "fill");
	const two = addConstraint(one.scene, "differ", ["a", "b"], "fill");
	let scene = updateConstraint(two.scene, one.id, {
		strength: "slight",
		weight: 20,
	});
	scene = updateConstraint(scene, two.id, { strength: "strong", weight: 1 });

	const out = await run(scene);
	assert.deepEqual(out.costs, [0, 20]);
	const [a, b] = fills(out)[0];
	assert.notEqual(a, b);
});

test("the designs shown are the near-optimal ones, best first", async () => {
	// A preference that costs 0 in some designs and 1 in others, with room for
	// both inside the bound.
	const { scene, id } = addConstraint(threeBoxes(), "match", ["a", "b"], "fill");
	const out = await run(updateConstraint(scene, id, { strength: "prefer" }));
	const costs = out.universes.map((u) => u.costs);
	assert.ok(costs.length > 1);
	// Every universe carries its own cost, and they are in order.
	for (const c of costs) assert.equal(c.length, 1);
	for (let i = 1; i < costs.length; i++) {
		assert.ok(compareCosts(costs[i - 1], costs[i]) <= 0, "ordered best first");
	}
	assert.deepEqual(costs[0], out.costs, "the best design is the first one");
	// And nothing worse than the bound got in.
	for (const c of costs) assert.ok(compareCosts(c, out.bound) <= 0);
	assert.deepEqual(out.bound, rankedBound(out.costs, 2));
});

test("a tighter bound shows fewer designs; a looser one more", async () => {
	const { scene, id } = addConstraint(threeBoxes(), "match", ["a", "b"], "fill");
	const soft = updateConstraint(scene, id, { strength: "prefer", weight: 4 });
	const tight = await explore(soft, directSolver, { limit: 200, slack: 0 });
	const loose = await explore(soft, directSolver, { limit: 200, slack: 4 });
	// A weight of four needs four points of slack before a design is allowed to
	// give the preference up, which is what a heavier preference *means*.
	assert.deepEqual(tight.bound, [1]);
	assert.deepEqual(loose.bound, [4]);
	assert.ok(
		loose.count > tight.count,
		`expected slack to widen the space, got ${tight.count} then ${loose.count}`,
	);
	assert.equal(tight.count, 9, "only the designs that pay nothing");
	assert.equal(loose.count, 27, "and now the ones that pay four");
});

test("a custom rule can be soft, and that is the same one weak constraint", async () => {
	// The user's own violation condition, ranked instead of forbidden. Nothing
	// about the rule they wrote changes.
	const { scene, id } = addConstraint(threeBoxes(), "custom", []);
	const withRule: Scene = {
		...updateConstraint(scene, id, { strength: "prefer" }),
		rules: `viol(${id}) :- rendered(a,fill,L), rendered(b,fill,L).`,
	};
	const out = await run(withRule);
	assert.equal(out.optimized, true);
	assert.deepEqual(out.costs, [0]);
	// The best designs are exactly the ones the rule does not object to...
	assert.notEqual(fills(out)[0][0], fills(out)[0][1]);
	// ...and the ones it does object to are still designs, at a cost.
	assert.ok(out.universes.some((u) => compareCosts(u.costs, [0]) > 0));

	// Hard, the same rule and the same text forbids instead.
	const hard = await run({
		...updateConstraint(withRule, id, { strength: "must" }),
		rules: withRule.rules,
	});
	assert.equal(hard.optimized, false);
	assert.equal(hard.count, 18);
});

test("a soft rule that is switched off ranks nothing", async () => {
	const { scene, id } = addConstraint(threeBoxes(), "match", ["a", "b"], "fill");
	const soft = updateConstraint(scene, id, { strength: "prefer" });
	const off = updateConstraint(soft, id, { enabled: false });
	assert.equal(compile(off).levels.length, 0);
	const out = await run(off);
	assert.equal(out.optimized, false);
	assert.equal(out.count, 27);
});

test("solved geometry lands where it should in a ranked document", async () => {
	// The two objectives at once: clasp ranking the answer sets by a weak
	// constraint, clingo-lpx pulling `b` back toward the frame it was drawn at.
	// A gap of 20 with a soft colour preference must still place b exactly.
	let scene = emptyScene();
	for (const id of ["a", "b"]) {
		scene = addNode(
			scene,
			makeNode("rect", { x: id === "a" ? 0 : 100, y: 0, width: 40, height: 40 }, { id }),
		);
		scene = setProp(scene, [id], "fill", [lit("#ff0000"), lit("#00ff00")]);
	}
	const gap = addConstraint(scene, "gap", ["a", "b"], undefined, "x");
	scene = updateConstraint(gap.scene, gap.id, { value: single("20px") });
	const differ = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = updateConstraint(differ.scene, differ.id, { strength: "prefer" });

	const out = await run(scene);
	assert.equal(out.optimized, true);
	assert.deepEqual(out.costs, [0]);
	for (const u of out.universes) {
		// a stays where it was drawn; b sits exactly 20 past its right edge.
		assert.equal(u.model.byId.a?.frame.x, 0);
		assert.equal(u.model.byId.b?.frame.x, 60);
	}
});

test("rankedBound loosens every level, and never by less than a point", () => {
	assert.deepEqual(rankedBound([0], 2), [2]);
	assert.deepEqual(rankedBound([10, 4], 3), [13, 7]);
	// Zero slack is still a point: a bound *at* the optimum is optN by another
	// name, and that is the one answer this feature refuses to give.
	assert.deepEqual(rankedBound([10], 0), [11]);
	assert.deepEqual(rankedBound([], 2), []);
});

test("a cost is described by the tier that charged it", () => {
	const levels = [STRENGTHS.strong.level!, STRENGTHS.prefer.level!];
	assert.equal(describeCosts([0, 0], levels), "nothing");
	assert.equal(describeCosts([0, 2], levels), "Prefer 2");
	assert.equal(describeCosts([1, 2], levels), "Strongly prefer 1 · Prefer 2");
	assert.equal(describeCosts([], []), "");
	// A `:~` written by hand adds a level nothing here knows the name of, and an
	// unlabelled number beats a number labelled with the wrong tier.
	assert.equal(describeCosts([1, 2, 3], levels), "cost 1, 2, 3");
});

test("compareCosts is lexicographic and pads the shorter vector", () => {
	assert.ok(compareCosts([1, 9], [2, 0]) < 0);
	assert.ok(compareCosts([2], [2, 1]) < 0);
	assert.equal(compareCosts([2, 0], [2]), 0);
});
