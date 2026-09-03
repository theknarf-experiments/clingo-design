import assert from "node:assert/strict";
import { before, test } from "node:test";

import { GcsWrapper, SolveStatus } from "@salusoft89/planegcs";

import {
	type SketchOutcome,
	type SketchRequest,
	type Sketcher,
	openSketcher,
} from "./index.ts";

/**
 * One module for the whole file. A module holds no solver state — every solve
 * builds and destroys its own system — so sharing one is not sharing anything,
 * and the cross-instance half of the determinism gate opens its own second one
 * precisely because that is the thing it is testing.
 */
let sketcher: Sketcher;

before(async () => {
	sketcher = await openSketcher();
});

/** Two nodes at the origin and at (10,10), the shape most of these start from. */
function pair(): SketchRequest["points"] {
	return [
		{ node: "card", x: 0, y: 0 },
		{ node: "badge", x: 10, y: 10 },
	];
}

/** `card` nailed where it stands, which is what `skheld/2` produces. */
function heldCard(): SketchRequest["pinned"] {
	return [
		{ node: "card", axis: "x", tag: "held(card,x)" },
		{ node: "card", axis: "y", tag: "held(card,y)" },
	];
}

function settled(
	outcome: SketchOutcome,
): Extract<SketchOutcome, { status: "settled" }> {
	assert.equal(outcome.status, "settled");
	return outcome;
}

test("hands back the ids it was given, in the currency an unsat core speaks", () => {
	// The tags are shaped like the ASP terms they will be: `Constraint.id` is
	// both the term `constraint(C)` and the name a core blames, so a conflict
	// that came back as an index, or as a mangled string, would need a second
	// naming scheme and a translation table between two solvers.
	const outcome = sketcher.solve({
		points: pair(),
		pinned: heldCard(),
		rules: [
			{ tag: "c_dist(card,badge,100)", kind: "distance", a: "card", b: "badge", px: 100 },
			{ tag: "c_dist(card,badge,50)", kind: "distance", a: "card", b: "badge", px: 50 },
		],
	});

	assert.equal(outcome.status, "conflicted");
	assert.deepEqual(
		[...(outcome.status === "conflicted" ? outcome.tags : [])].sort(),
		["c_dist(card,badge,100)", "c_dist(card,badge,50)"],
	);
});

test("blames a pin by the tag the caller put on it", () => {
	// The other half of a conflict, and after the release loop was removed it is
	// the common half: a sketch rule aimed at a node the linear layer already
	// placed contradicts the placement, and the pin has to be nameable for the
	// panel to be able to say which layout rule to turn off.
	const outcome = sketcher.solve({
		points: [
			{ node: "card", x: 0, y: 0 },
			{ node: "badge", x: 40, y: 0 },
		],
		pinned: [
			...heldCard(),
			{ node: "badge", axis: "x", tag: "held(badge,x)" },
			{ node: "badge", axis: "y", tag: "held(badge,y)" },
		],
		rules: [
			{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
		],
	});

	assert.equal(outcome.status, "conflicted");
	const tags = outcome.status === "conflicted" ? outcome.tags : [];
	assert.ok(tags.includes("c1"), `expected the rule in ${JSON.stringify(tags)}`);
	assert.ok(
		tags.some((t) => t.startsWith("held(")),
		`expected a pin in ${JSON.stringify(tags)}`,
	);
});

test("a refused solve does not touch the caller's geometry", () => {
	// Hazard 2. The library leaves plausible wrong coordinates behind on a
	// `Failed` solve, and the request is an object the caller still holds — the
	// same array `sketchRequest` built out of `Universe.solved`. So the check is
	// two-sided: nothing in the request moved, and the outcome carries no
	// coordinates at all for anybody to merge.
	const request: SketchRequest = {
		points: pair(),
		pinned: heldCard(),
		rules: [
			{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
			{ tag: "c2", kind: "distance", a: "card", b: "badge", px: 50 },
		],
	};
	const before = structuredClone(request);

	const outcome = sketcher.solve(request);

	assert.equal(outcome.status, "conflicted");
	assert.deepEqual(request, before);
	assert.equal("points" in outcome, false);
});

test("tells a redundancy from a contradiction", () => {
	// The same distance twice says nothing new and is not an error; two different
	// distances cannot both hold and is. Both come back `Failed`-adjacent in the
	// library's vocabulary and the panel has two quite different sentences for
	// them, so the distinction is made here rather than left to a caller.
	const outcome = sketcher.solve({
		points: pair(),
		pinned: heldCard(),
		rules: [
			{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
			{ tag: "c2", kind: "distance", a: "card", b: "badge", px: 100 },
		],
	});

	const answer = settled(outcome);
	assert.deepEqual(answer.redundant, ["c2"]);
});

test("reports the freedom an under-constrained sketch has left", () => {
	// Hazard 3, surfaced. One distance about one free point leaves a circle of
	// answers; this is one of them, and a studio that cannot say so tells the
	// designer their design is settled when it is a coin toss.
	const loose = settled(
		sketcher.solve({
			points: pair(),
			pinned: heldCard(),
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
			],
		}),
	);
	assert.equal(loose.dof, 1);

	// Add the bearing and the point is fixed exactly, which is the sentence the
	// Rules panel warns about when a third rule is added on top.
	const tight = settled(
		sketcher.solve({
			points: pair(),
			pinned: heldCard(),
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
				{ tag: "c2", kind: "bearing", a: "card", b: "badge", deg: 30 },
			],
		}),
	);
	assert.equal(tight.dof, 0);
});

test("solves a Euclidean distance and a bearing that clingo-lpx cannot write down", () => {
	// √(Δx² + Δy²) = 100 and atan2(Δy, Δx) = 30° — a quadratic and an
	// irrational-coefficient linear form, neither of which has an integer-
	// coefficient `&sum` encoding. The numbers are checked against the closed
	// form rather than against a previous run, because the point of the whole
	// track is that these are the right answers and not merely stable ones.
	const answer = settled(
		sketcher.solve({
			points: pair(),
			pinned: heldCard(),
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
				{ tag: "c2", kind: "bearing", a: "card", b: "badge", deg: 30 },
			],
		}),
	);

	const badge = answer.points["badge"];
	assert.ok(badge !== undefined);
	// Clockwise from straight right in a plane whose y grows downwards, so a
	// positive bearing is down and to the right.
	assert.ok(Math.abs(badge.x! - 100 * Math.cos(Math.PI / 6)) < 1e-6, `x was ${badge.x}`);
	assert.ok(Math.abs(badge.y! - 100 * Math.sin(Math.PI / 6)) < 1e-6, `y was ${badge.y}`);
	assert.ok(
		Math.abs(Math.hypot(badge.x!, badge.y!) - 100) < 1e-9,
		"the distance is the distance",
	);
});

test("a link is a constant vector, in the direction it is written in", () => {
	// `to = from + (dx, dy)`, and the sign is the whole of it: reversed, every
	// anchor point in `design-core` would land on the far side of its box and the
	// solve would be exactly as wrong as it was before there were links, only in a
	// new direction. Asserted against the closed form and not against a run.
	const answer = settled(
		sketcher.solve({
			points: [...pair(), { node: "corner", x: -10, y: -20 }],
			pinned: heldCard(),
			links: [{ tag: "l1", from: "badge", to: "corner", dx: -20, dy: -30 }],
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "corner", px: 100 },
				{ tag: "c2", kind: "bearing", a: "card", b: "corner", deg: 30 },
			],
		}),
	);
	const badge = answer.points["badge"];
	const corner = answer.points["corner"];
	assert.ok(badge !== undefined && corner !== undefined);
	// The rules are about `corner`, so `corner` is where they put it — 100px from
	// the pinned `card` at 30° — and `badge` is wherever the link says it must be
	// for that to be true. Which is the whole trick: the rule names one point of a
	// rigid thing and the thing moves.
	assert.ok(Math.abs(corner.x! - 100 * Math.cos(Math.PI / 6)) < 1e-6, `x was ${corner.x}`);
	assert.ok(Math.abs(corner.y! - 100 * Math.sin(Math.PI / 6)) < 1e-6, `y was ${corner.y}`);
	assert.ok(Math.abs(corner.x! - (badge.x! - 20)) < 1e-6, `link x was ${corner.x! - badge.x!}`);
	assert.ok(Math.abs(corner.y! - (badge.y! - 30)) < 1e-6, `link y was ${corner.y! - badge.y!}`);
});

test("a link costs no freedom, so dof still counts the design", () => {
	// Two coordinates and two equations. If a linked point were counted as an
	// unknown the studio would report a settled design as having room to move, and
	// the Rules panel's "one of infinitely many" warning would fire on every
	// document that measured a corner.
	const bare = settled(
		sketcher.solve({
			points: pair(),
			pinned: heldCard(),
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
				{ tag: "c2", kind: "bearing", a: "card", b: "badge", deg: 30 },
			],
		}),
	);
	const linked = settled(
		sketcher.solve({
			points: [...pair(), { node: "corner", x: 30, y: 30 }],
			pinned: heldCard(),
			links: [{ tag: "l1", from: "badge", to: "corner", dx: 20, dy: 20 }],
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
				{ tag: "c2", kind: "bearing", a: "card", b: "corner", deg: 30 },
			],
		}),
	);
	assert.equal(bare.dof, 0);
	assert.equal(linked.dof, 0);
});

test("puts three points on one line at an angle no Align can name", () => {
	// `align` is `ge(A,E) = ge(B,E)` — one coordinate on one axis, so always
	// horizontal or vertical. This is the relation it was never able to state.
	const answer = settled(
		sketcher.solve({
			points: [
				{ node: "one", x: 0, y: 0 },
				{ node: "three", x: 200, y: 130 },
				{ node: "two", x: 100, y: 50 },
			],
			pinned: [
				{ node: "one", axis: "x", tag: "held(one,x)" },
				{ node: "one", axis: "y", tag: "held(one,y)" },
				{ node: "two", axis: "x", tag: "held(two,x)" },
				{ node: "two", axis: "y", tag: "held(two,y)" },
				{ node: "three", axis: "x", tag: "held(three,x)" },
			],
			rules: [
				{ tag: "c1", kind: "collinear", members: ["one", "two", "three"] },
			],
		}),
	);

	// One and two are pinned on the 26.57° line through (0,0) and (100,50);
	// three keeps its pinned x of 200 and its y is dragged onto that line.
	assert.equal(answer.points["one"], undefined);
	assert.equal(answer.points["two"], undefined);
	const three = answer.points["three"];
	assert.ok(three !== undefined);
	assert.equal(three.x, undefined);
	assert.ok(Math.abs(three.y! - 100) < 1e-9, `y was ${three.y}`);
});

test("names a many-membered collinearity once, however many constraints it took", () => {
	// Four members is two `point_on_line_ppp` constraints under one tag, and a
	// conflict that reported the tag twice would be reporting this package's
	// implementation rather than the rule the designer wrote.
	const outcome = sketcher.solve({
		points: [
			{ node: "one", x: 0, y: 0 },
			{ node: "two", x: 100, y: 0 },
			{ node: "three", x: 200, y: 40 },
			{ node: "four", x: 300, y: 90 },
		],
		pinned: [
			{ node: "one", axis: "x", tag: "held(one,x)" },
			{ node: "one", axis: "y", tag: "held(one,y)" },
			{ node: "two", axis: "x", tag: "held(two,x)" },
			{ node: "two", axis: "y", tag: "held(two,y)" },
			{ node: "three", axis: "x", tag: "held(three,x)" },
			{ node: "three", axis: "y", tag: "held(three,y)" },
			{ node: "four", axis: "x", tag: "held(four,x)" },
			{ node: "four", axis: "y", tag: "held(four,y)" },
		],
		rules: [
			{ tag: "c_line", kind: "collinear", members: ["one", "two", "three", "four"] },
		],
	});

	assert.equal(outcome.status, "conflicted");
	const tags = outcome.status === "conflicted" ? outcome.tags : [];
	assert.equal(tags.filter((t) => t === "c_line").length, 1);
});

test("a pinned coordinate never comes back out", () => {
	// §3.2 made structural. `coordinate_x` is a constraint whose residual is
	// driven toward zero and not a substitution, so the parameter behind a pin is
	// still a variable and can come back displaced. It is not returned at all, so
	// there is no residual for anybody to quantize into a number simplex decided
	// exactly.
	const answer = settled(
		sketcher.solve({
			points: [
				{ node: "card", x: 0, y: 0 },
				{ node: "badge", x: 10, y: 10 },
				{ node: "mark", x: 5, y: 5 },
			],
			pinned: [
				...heldCard(),
				// One axis only, which is what a node an `align` touches looks like.
				{ node: "mark", axis: "y", tag: "held(mark,y)" },
			],
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
			],
		}),
	);

	assert.equal(answer.points["card"], undefined);
	assert.deepEqual(Object.keys(answer.points).sort(), ["badge", "mark"]);
	assert.equal(answer.points["mark"]!.y, undefined);
	assert.equal(answer.points["mark"]!.x, 5);
});

test("the starting point is an input, and moving it moves the answer", () => {
	// Hazard 3 as the designer meets it. Same rules, same pins, two aims: at
	// `dof = 0` the aim picks which of finitely many branches the design lands
	// in, and that is the whole user-facing story of the seed drag.
	const rules: SketchRequest["rules"] = [
		{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
		{ tag: "c2", kind: "collinear", members: ["card", "badge", "mark"] },
	];
	const aim = (y: number): SketchOutcome =>
		sketcher.solve({
			points: [
				{ node: "card", x: 0, y: 0 },
				{ node: "badge", x: 10, y },
				{ node: "mark", x: 60, y },
			],
			pinned: [
				...heldCard(),
				{ node: "mark", axis: "x", tag: "held(mark,x)" },
				{ node: "mark", axis: "y", tag: "held(mark,y)" },
			],
			rules,
		});

	// The circle of radius 100 about `card` meets the line through `card` and
	// `mark` in two places, and both solves are exact: `dof` is 0 and the answer
	// is the branch the aim was nearest to.
	const up = settled(aim(-80));
	const down = settled(aim(80));
	assert.equal(up.dof, 0);
	assert.equal(down.dof, 0);
	assert.deepEqual(up.points["badge"], { x: 60, y: -80 });
	assert.deepEqual(down.points["badge"], { x: 60, y: 80 });
});

test("a numeric failure with nothing to blame comes back adrift", () => {
	// §5.4, and it is the case that must never become a learned constraint. The
	// library returns `Failed` for two quite different reasons and reports them
	// the same way: a genuine over-determination comes with a conflicting set,
	// and an iteration that could not find a root comes with an empty one. The
	// second is a statement about the arithmetic, so no rule is named — a
	// nogood built from it would delete designs that converge perfectly from a
	// different seed.
	const outcome = sketcher.solve({
		points: pair(),
		pinned: heldCard(),
		rules: [
			// No placement has a negative separation, so the residual has no root
			// and the iteration runs out of steps with nothing over-determined.
			{ tag: "c1", kind: "distance", a: "card", b: "badge", px: -100 },
		],
	});

	assert.deepEqual(outcome, { status: "adrift" });
});

test("a solution the library cannot vouch for is not applied and is not a fact", () => {
	// The fourth status, and the only one no request can be written to produce:
	// `SuccessfulSolutionInvalid` is the library saying it reached a solution it
	// cannot stand behind, and it arrives from inside the C++ solver rather than
	// from anything about the system pushed into it. So the status is forced,
	// which is the one thing this file mocks and it mocks exactly one method: the
	// system is real, the request is a real solvable one, and everything the gate
	// does afterwards is the code under test.
	//
	// Without this the gate reads `!== Success && !== Converged` and nothing at
	// all asserts the third clause of it — narrowing it to `=== Failed` would
	// leave every test green while a solution the library disowns was written
	// into the geometry through `apply_solution()` and handed back as `settled`.
	const realSolve = GcsWrapper.prototype.solve;
	const realApply = GcsWrapper.prototype.apply_solution;
	let applied = 0;
	GcsWrapper.prototype.solve = function invalid(
		this: GcsWrapper,
		...args: Parameters<GcsWrapper["solve"]>
	): SolveStatus {
		realSolve.apply(this, args);
		return SolveStatus.SuccessfulSolutionInvalid;
	};
	GcsWrapper.prototype.apply_solution = function counted(
		this: GcsWrapper,
	): void {
		applied++;
		realApply.call(this);
	};
	try {
		const outcome = sketcher.solve({
			points: pair(),
			pinned: heldCard(),
			// A request that settles perfectly when the library is telling the truth
			// — see the bearing test above — so the only thing refusing it is the
			// status.
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
				{ tag: "c2", kind: "bearing", a: "card", b: "badge", deg: 30 },
			],
		});

		assert.notEqual(outcome.status, "settled");
		assert.equal("points" in outcome, false);
		assert.equal(applied, 0, "and the geometry was never written");
	} finally {
		GcsWrapper.prototype.solve = realSolve;
		GcsWrapper.prototype.apply_solution = realApply;
	}

	// ...and the patch really is off again, or every test after this one would be
	// asserting about a lie.
	assert.equal(
		settled(
			sketcher.solve({
				points: pair(),
				pinned: heldCard(),
				rules: [{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 }],
			}),
		).dof,
		1,
	);
});

test("the same request solves to the same coordinates a hundred times over", () => {
	// The gate. A design tool whose canvas differs between two people looking at
	// one document has failed at the only thing it does, and the failure this is
	// written against is a measured one: two runs with byte-identical parameter
	// vectors landing at radius 39.256568 and 108.456660, both reporting success.
	// So the assertion is over the coordinates that come back and not over the
	// numbers that went in — a gate over the input would have gone green on
	// exactly the evidence that motivated it.
	const determined: SketchRequest = {
		points: pair(),
		pinned: heldCard(),
		rules: [
			{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
			{ tag: "c2", kind: "bearing", a: "card", b: "badge", deg: 37 },
		],
	};
	const loose: SketchRequest = {
		points: pair(),
		pinned: heldCard(),
		rules: [{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 }],
	};

	for (const request of [determined, loose]) {
		const first = settled(sketcher.solve(request));
		for (let i = 0; i < 99; i++) {
			const again = settled(sketcher.solve(request));
			assert.deepEqual(again.points, first.points);
			assert.equal(again.dof, first.dof);
		}
	}
});

test("two modules from two instantiations agree, at dof 0 and above it", async () => {
	// The other half of the gate. One wasm instance being reproducible is not the
	// claim; the claim is that two people's browsers draw one document the same
	// way, and each of those is its own `init_planegcs_module()`.
	const other = await openSketcher();
	try {
		for (const rules of [
			[
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
				{ tag: "c2", kind: "bearing", a: "card", b: "badge", deg: 37 },
			] satisfies SketchRequest["rules"],
			[
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
			] satisfies SketchRequest["rules"],
		]) {
			const request: SketchRequest = {
				points: pair(),
				pinned: heldCard(),
				rules,
			};
			const mine = settled(sketcher.solve(request));
			const theirs = settled(other.solve(request));
			assert.deepEqual(theirs.points, mine.points);
			assert.equal(theirs.dof, mine.dof);
		}
	} finally {
		other.close();
	}
});

test("canonical order, not caller order", () => {
	// The request declares itself to be in canonical order and the builder sorts
	// it anyway, because a parameter vector that depends on a `Map`'s insertion
	// history is a picture that depends on the order somebody wrote two rules in.
	const forwards = settled(
		sketcher.solve({
			points: [
				{ node: "card", x: 0, y: 0 },
				{ node: "badge", x: 10, y: 10 },
			],
			pinned: heldCard(),
			rules: [
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
				{ tag: "c2", kind: "bearing", a: "card", b: "badge", deg: 37 },
			],
		}),
	);
	const backwards = settled(
		sketcher.solve({
			points: [
				{ node: "badge", x: 10, y: 10 },
				{ node: "card", x: 0, y: 0 },
			],
			pinned: [...heldCard()].reverse(),
			rules: [
				{ tag: "c2", kind: "bearing", a: "card", b: "badge", deg: 37 },
				{ tag: "c1", kind: "distance", a: "card", b: "badge", px: 100 },
			],
		}),
	);

	assert.deepEqual(backwards.points, forwards.points);
});

test("a document with no sketch rule in it costs nothing", () => {
	// Promise 3 of the no-regression section, at this end of the seam: an empty
	// rule list is a system with no constraints, which settles at whatever
	// freedom the points have and moves nothing.
	const answer = settled(
		sketcher.solve({ points: pair(), pinned: [], rules: [] }),
	);
	assert.deepEqual(answer.points, {
		card: { x: 0, y: 0 },
		badge: { x: 10, y: 10 },
	});
	assert.equal(answer.dof, 4);
	assert.equal(answer.approximate, false);
	assert.deepEqual(answer.redundant, []);
});

test("the wasm url reaches the glue", async () => {
	// P10 hands this in from a `?url` import, because Vite pre-bundles the
	// dependency and rewrites the `new URL("planegcs.wasm", import.meta.url)`
	// inside the glue to a path in `node_modules/.vite/deps` where no wasm was
	// copied. Under Node the fallback finds the file on its own, so the positive
	// case proves nothing by itself — the refusal is what proves the option is
	// consulted rather than quietly ignored.
	const wasmUrl = import.meta.resolve(
		"@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm",
	);
	const located = await openSketcher({ wasmUrl });
	try {
		assert.equal(
			located.solve({ points: [{ node: "a", x: 0, y: 0 }], pinned: [], rules: [] })
				.status,
			"settled",
		);
	} finally {
		located.close();
	}

	await assert.rejects(
		openSketcher({ wasmUrl: new URL("./nowhere.wasm", import.meta.url).href }),
	);
});

test("a closed sketcher refuses to solve", () => {
	const closing = { points: pair(), pinned: [], rules: [] } satisfies SketchRequest;
	const spare = openSketcher().then((s) => {
		s.close();
		return s;
	});
	return spare.then((s) => {
		assert.throws(() => s.solve(closing), /closed/);
	});
});
