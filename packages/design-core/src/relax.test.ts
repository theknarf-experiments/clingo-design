/**
 * Ways out of a contradiction, through the real solver.
 *
 * Nothing here is checkable against a hand-written atom list: every claim is
 * about what the solver does with a set of assumptions, and the interesting
 * ones — that two different relaxations are offered when two exist, that each
 * comes back with a *drawable* design, that a pin is preferred to a rule — are
 * claims about search order and satisfiability rather than about text.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, SCENERY_ATOM, compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import {
	addConstraint,
	addNode,
	makeNode,
	setProp,
	updateConstraint,
} from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import { findWays } from "./relax.ts";
import { dimension, emptyScene, type Scene } from "./scene.ts";
import { lit, propVar } from "./values.ts";

/** Boxes that may each take any of `palette`. */
function boxes(ids: string[], palette = ["#ff0000", "#00ff00", "#0000ff"]): Scene {
	let scene = emptyScene();
	for (const id of ids) {
		scene = addNode(
			scene,
			makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id }),
		);
		scene = setProp(scene, [id], "fill", palette.map(lit));
	}
	return scene;
}

/** Explores, expecting failure, and hands back the error. */
async function impossible(
	scene: Scene,
	pins: Record<string, number> = {},
): Promise<UnsatisfiableError> {
	const error = await explore(scene, directSolver, { pins }).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError, "expected an unsatisfiable answer");
	return error;
}

test("both ways out are offered when both are equally cheap", async () => {
	let scene = boxes(["a", "b", "c"]);
	const differ = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = differ.scene;
	const match = addConstraint(scene, "match", ["a", "b"], "fill");
	scene = match.scene;
	// An innocent third rule, which must be offered by neither.
	scene = addConstraint(scene, "differ", ["b", "c"], "fill").scene;

	const error = await impossible(scene);
	assert.deepEqual(
		error.relaxations.map((r) => r.rules).sort(),
		[[differ.id], [match.id]].sort(),
		"one rule off, either one — the choice is the designer's",
	);
	assert.ok(error.exhaustive, "the search proved these are all of them");
	for (const relaxation of error.relaxations) {
		assert.deepEqual(relaxation.pins, []);
		assert.equal(relaxation.free, false, "switching a rule off is an edit");
	}
});

test("every way out arrives with a design that can be drawn", async () => {
	let scene = boxes(["a", "b"]);
	scene = addConstraint(scene, "differ", ["a", "b"], "fill").scene;
	scene = addConstraint(scene, "match", ["a", "b"], "fill").scene;

	const error = await impossible(scene);
	assert.equal(error.relaxations.length, 2);
	for (const { universe } of error.relaxations) {
		// A picture, not a set of decisions: this is the whole reason the search
		// asks for `scenery` rather than proving satisfiability the cheap way.
		assert.ok(universe.model.byId.a, "the drawn tree has to be in there");
		assert.ok(universe.model.byId.b);
		assert.ok(universe.model.byId.a.rendered.fill?.startsWith("#"));
		assert.ok(universe.visible.has("a"));
	}
	// And the two designs actually differ: one has a and b the same colour, the
	// other has them different. Which *is* the choice being offered.
	const same = error.relaxations.map(
		({ universe }) =>
			universe.model.byId.a.rendered.fill === universe.model.byId.b.rendered.fill,
	);
	assert.deepEqual(same.sort(), [false, true]);
});

test("applying a way out makes the document satisfiable", async () => {
	let scene = boxes(["a", "b"]);
	scene = addConstraint(scene, "differ", ["a", "b"], "fill").scene;
	scene = addConstraint(scene, "match", ["a", "b"], "fill").scene;

	const error = await impossible(scene);
	for (const relaxation of error.relaxations) {
		const relaxed = relaxation.rules.reduce(
			(s, id) => updateConstraint(s, id, { enabled: false }),
			scene,
		);
		const exploration = await explore(relaxed, directSolver, { limit: 20 });
		assert.ok(exploration.count > 0, `${relaxation.rules} left nothing behind`);
	}
});

test("releasing a pin is offered before switching a rule off, and is free", async () => {
	let scene = boxes(["a", "b"]);
	scene = addConstraint(scene, "differ", ["a", "b"], "fill").scene;
	// Both boxes pinned to red, against a rule that says they must differ.
	const pins = { [propVar("a", "fill")]: 0, [propVar("b", "fill")]: 0 };

	const error = await impossible(scene, pins);
	assert.ok(error.relaxations.length > 0);
	for (const relaxation of error.relaxations) {
		assert.deepEqual(
			relaxation.rules,
			[],
			"a pin costs nothing to drop, so no rule should be on offer",
		);
		assert.equal(relaxation.free, true);
		assert.equal(relaxation.pins.length, 1);
	}
	assert.deepEqual(
		error.relaxations.map((r) => r.pins[0]).sort(),
		[propVar("a", "fill"), propVar("b", "fill")].sort(),
	);
	// The core still names the rule — it is genuinely part of the contradiction.
	assert.equal(error.conflict.length, 1);
	assert.equal(error.pinned.length, 2);
});

test("a pin the rules cannot accommodate at all falls back to the rule", async () => {
	// One colour to go round and a rule demanding two: no pin release helps.
	let scene = boxes(["a", "b"], ["#ff0000"]);
	const differ = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = differ.scene;
	const error = await impossible(scene, { [propVar("a", "fill")]: 0 });
	assert.deepEqual(
		error.relaxations.map((r) => r.rules),
		[[differ.id]],
	);
	assert.equal(error.relaxations[0].free, false);
});

test("two rules have to go, and every minimal pair is offered", async () => {
	// Four boxes, three rules: two must go and there are three ways to choose.
	let scene = boxes(["a", "b", "c", "d"], ["#ff0000"]);
	const ab = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = ab.scene;
	const cd = addConstraint(scene, "differ", ["c", "d"], "fill");
	scene = cd.scene;
	const error = await impossible(scene);
	// Each rule is independently impossible with one colour, so both have to go
	// — a single relaxation naming both.
	assert.equal(error.relaxations.length, 1);
	assert.deepEqual(error.relaxations[0].rules.sort(), [ab.id, cd.id].sort());
	const relaxed = error.relaxations[0].rules.reduce(
		(s, id) => updateConstraint(s, id, { enabled: false }),
		scene,
	);
	assert.ok((await explore(relaxed, directSolver)).count > 0);
});

test("a geometric contradiction is relaxed the same way a colour one is", async () => {
	let scene = boxes(["a", "b"]);
	const near = addConstraint(scene, "gap", ["a", "b"], undefined, "left");
	scene = updateConstraint(near.scene, near.id, { value: dimension(20) });
	const far = addConstraint(scene, "gap", ["a", "b"], undefined, "left");
	scene = updateConstraint(far.scene, far.id, { value: dimension(500) });

	const error = await impossible(scene);
	assert.deepEqual(
		error.relaxations.map((r) => r.rules).sort(),
		[[near.id], [far.id]].sort(),
	);
	// The surviving rule is honoured in the preview, which is only true because
	// the relaxed solve keeps `gpull` on and reads the simplex answer.
	for (const relaxation of error.relaxations) {
		const kept = relaxation.rules[0] === near.id ? 500 : 20;
		const { a, b } = relaxation.universe.solved;
		assert.ok(a || b, "the geometry the solver decided has to come back");
		const frames = relaxation.universe.model.byId;
		const left = frames.a.frame.x + frames.a.frame.width;
		assert.equal(frames.b.frame.x - left, kept);
	}
});

test("a contradiction nobody has a switch for offers no way out", async () => {
	const scene = { ...boxes(["a"]), rules: ":- node(a).\n" };
	const error = await impossible(scene);
	assert.deepEqual(error.conflict, []);
	assert.deepEqual(error.relaxations, []);
	assert.ok(error.exhaustive, "there is provably nothing to offer, not a timeout");
	assert.equal(error.message, "No design satisfies these rules.");
});

test("the message counts the ways out so a status line can say so", async () => {
	let scene = boxes(["a", "b"]);
	scene = addConstraint(scene, "differ", ["a", "b"], "fill").scene;
	scene = addConstraint(scene, "match", ["a", "b"], "fill").scene;
	const error = await impossible(scene);
	assert.equal(error.message, "2 rules cannot hold together. 2 ways out.");
});

test("a soft rule is never a way out, because it can never be the problem", async () => {
	let scene = boxes(["a", "b"]);
	const differ = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = differ.scene;
	const match = addConstraint(scene, "match", ["a", "b"], "fill");
	scene = updateConstraint(match.scene, match.id, { strength: "prefer" });
	// Satisfiable now: the preference costs a point instead of forbidding.
	const exploration = await explore(scene, directSolver, { limit: 20 });
	assert.ok(exploration.count > 0);
	assert.ok(exploration.optimized);
	assert.deepEqual(exploration.costs, [1]);
	// And the design says *which* rule it disappointed, not only by how much.
	for (const universe of exploration.universes) {
		assert.deepEqual([...universe.violated], [match.id]);
	}
});

test("a hard rule that holds is never reported as violated", async () => {
	let scene = boxes(["a", "b"]);
	const differ = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = differ.scene;
	const exploration = await explore(scene, directSolver, { limit: 20 });
	assert.ok(exploration.count > 0);
	for (const universe of exploration.universes) {
		assert.deepEqual([...universe.violated], []);
	}
});

test("a soft rule that is switched off is not blamed for its violation", async () => {
	let scene = boxes(["a", "b"]);
	const match = addConstraint(scene, "match", ["a", "b"], "fill");
	scene = updateConstraint(match.scene, match.id, {
		strength: "prefer",
		enabled: false,
	});
	const exploration = await explore(scene, directSolver, { limit: 20 });
	assert.equal(exploration.optimized, false);
	for (const universe of exploration.universes) {
		assert.deepEqual([...universe.violated], []);
	}
});

test("a search that runs out of budget says so instead of claiming completeness", async () => {
	let scene = boxes(["a", "b"]);
	scene = addConstraint(scene, "differ", ["a", "b"], "fill").scene;
	scene = addConstraint(scene, "match", ["a", "b"], "fill").scene;
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const base = [
			...guards.map((atom) => ({ atom })),
			{ atom: PULL_ATOM },
			{ atom: SCENERY_ATOM },
		];
		const first = await session.solve({ models: 1, assumptions: base });
		assert.equal(first.result, "UNSATISFIABLE");
		const owned = guards.map((atom) => ({
			atom,
			id: atom.slice("active(".length, -1),
			free: false,
		}));
		// Two ways out exist; one solve is not enough to have looked for both.
		const stingy = await findWays(session, {
			base,
			owned,
			core: first.core,
			budget: 1,
		});
		assert.equal(stingy.solves, 1);
		assert.equal(stingy.ways.length, 1);
		assert.equal(stingy.complete, false, "one solve cannot prove there is one way");
		const full = await findWays(session, { base, owned, core: first.core });
		assert.equal(full.ways.length, 2);
		assert.equal(full.complete, true);
	} finally {
		await session.close();
	}
});

test("a document whose only conflict is soft is possible, merely disappointing", async () => {
	// Three boxes, one colour, and two preferences that cannot both hold.
	let scene = boxes(["a", "b"], ["#ff0000"]);
	const differ = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = updateConstraint(differ.scene, differ.id, { strength: "strong" });
	const match = addConstraint(scene, "match", ["a", "b"], "fill");
	scene = updateConstraint(match.scene, match.id, { strength: "slight" });

	const exploration = await explore(scene, directSolver, { limit: 20 });
	assert.ok(exploration.count > 0, "a soft conflict is not an impossibility");
	// The strong one wins its tier: differ is broken (one colour to go round)
	// and match is kept, so the cost is at the strong level only.
	for (const universe of exploration.universes) {
		assert.deepEqual([...universe.violated], [differ.id]);
	}
});
