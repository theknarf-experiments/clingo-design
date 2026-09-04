/**
 * The two solvers as a sequence: an answer set, then a sketch pass over it.
 *
 * Through the real clingo and the real PlaneGCS, because every claim here is
 * about what the pair does and none of them survives a stub of either. What a
 * stub *is* good for is the opposite direction — an outcome the real library
 * will not produce on demand — so the two failure tests below drive a
 * hand-written {@link Sketcher} and the four success tests drive the wasm.
 *
 * The four things this file exists to pin, in the order they matter:
 *
 * 1. **The pass terminates, in one solve per drawn universe.** There is no
 *    release loop and no re-solve; a conflict is a conflict.
 * 2. **A conflict is named in the document's own currency** — `Constraint.id`
 *    for a rule and `<node>:<axis>` for a coordinate the linear layer had
 *    already decided — so the Rules panel can redden a row it already draws.
 * 3. **A numeric failure teaches the program nothing.** No nogood, no integrity
 *    constraint, no re-ground, no lost universe. Turning "the iteration ran out
 *    of steps" into `:- active(c1), active(c2).` would delete from the
 *    multiverse every design in which those rules coexist, silently.
 * 4. **A picture is reproducible.** A solve is a pure function of the document,
 *    the picks and the starting aim, and the aim is document state — so a round
 *    trip through the reader gives the same design back, which re-deriving it
 *    does not.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type SketchOutcome,
	type SketchRequest,
	type Sketcher,
	openSketcher,
} from "@clingo-design/planegcs";

import { directSolver } from "./directSolver.ts";
import { setProp } from "./edits.ts";
import { Explorer, type Exploration, type Universe } from "./explore.ts";
import type { Frame } from "./geometry.ts";
import { normalizeScene } from "./project.ts";
import {
	type Constraint,
	type Scene,
	type SceneNode,
	angleValue,
	dimension,
	emptyScene,
	makeFrame,
	makeLayout,
} from "./scene.ts";
import { refusedMembers, spellSeed } from "./sketch.ts";
import { orbit } from "./templates/orbit.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, propVar, single } from "./values.ts";

const P = EMU_PER_PX;
const px = (n: number): number => n * P;

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

const at = (
	id: string,
	box: { x: number; y: number; w: number; h: number },
	extra: Partial<SceneNode> = {},
): SceneNode => ({
	id,
	kind: "rect",
	name: id,
	frame: makeFrame({
		x: px(box.x),
		y: px(box.y),
		width: px(box.w),
		height: px(box.h),
	}),
	props: {},
	...extra,
});

const scened = (nodes: SceneNode[], constraints: Constraint[]): Scene => ({
	...emptyScene(),
	nodes,
	constraints,
});

const rule = (
	c: Partial<Constraint> & Pick<Constraint, "id" | "kind">,
): Constraint => ({ prop: "fill", nodes: [], enabled: true, ...c });

/** Two boxes a hand put down, which is the case a sketch rule is *for*. */
const twoBoxes = (): SceneNode[] => [
	at("card", { x: 0, y: 0, w: 100, h: 60 }),
	at("badge", { x: 200, y: 40, w: 40, h: 40 }),
];

const apart = (value = px(120)): Constraint =>
	rule({
		id: "apart",
		kind: "distance",
		nodes: ["card", "badge"],
		value: dimension(value),
	});

/* ------------------------------------------------------------------ */
/* Running one                                                         */
/* ------------------------------------------------------------------ */

/** One sketcher for the whole file: a module holds no solver state. */
const real = await openSketcher();

/** Counts the solves, so "one per drawn universe" is a number and not a hope. */
function counted(inner: Sketcher): { sketcher: Sketcher; solves: () => number } {
	let solves = 0;
	return {
		sketcher: {
			solve(request) {
				solves++;
				return inner.solve(request);
			},
			close() {},
		},
		solves: () => solves,
	};
}

/** A sketcher that always answers the same way, whatever it is asked. */
const always = (outcome: SketchOutcome): Sketcher => ({
	solve: () => outcome,
	close() {},
});

async function run(scene: Scene, sketcher?: Sketcher): Promise<Exploration> {
	const explorer = new Explorer(directSolver, sketcher);
	try {
		return await explorer.explore(scene, { limit: 8, sample: "first" });
	} finally {
		await explorer.close();
	}
}

/** Where a node's centre is on the canvas, out of the drawn model. */
function centre(universe: Universe, id: string): { x: number; y: number } {
	const frame = universe.model.byId[id].frame;
	return { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
}

const between = (universe: Universe, a: string, b: string): number => {
	const p = centre(universe, a);
	const q = centre(universe, b);
	return Math.hypot(q.x - p.x, q.y - p.y);
};

/* ------------------------------------------------------------------ */
/* 1. The pass, and its bound                                          */
/* ------------------------------------------------------------------ */

test("a document with no sketch rule never reaches the second solver", async () => {
	// Promise 3 of the no-regression list, at the pipeline rather than at the
	// program: `sketchRequest` answers nothing before a system is built, so the
	// wasm is not merely unused, it is never asked.
	const { sketcher, solves } = counted(real);
	const out = await run(
		scened(twoBoxes(), [
			rule({ id: "flush", kind: "align", nodes: ["card", "badge"], edge: "left" }),
		]),
		sketcher,
	);
	assert.equal(solves(), 0);
	for (const universe of out.universes) assert.equal(universe.sketch, undefined);
});

test("one solve per drawn universe, and the pass has no second round", async () => {
	// The bound, and the whole of it. There is no release loop: a `held` pin can
	// be fixed by a hard `&sum` equality, so releasing one would break an `align`
	// the Rules panel still shows green. One solve, and a conflict is a conflict.
	const scene = setProp(
		scened(twoBoxes(), [apart()]),
		["badge"],
		"fill",
		[lit("#f00"), lit("#0f0"), lit("#00f")],
	);
	const { sketcher, solves } = counted(real);
	const out = await run(scene, sketcher);
	assert.equal(out.count, 3, "three fills, three designs");
	assert.equal(solves(), out.universes.length);
	for (const universe of out.universes) {
		assert.equal(universe.sketch?.status, "settled");
	}
	// And the three designs differ in the fill and agree about the geometry: the
	// sketch is a function of the answer set, and the answer sets agree here.
	const picked = out.universes.map((u) => u.pick[propVar("badge", "fill")]);
	assert.deepEqual([...picked].sort(), [0, 1, 2]);
	for (const universe of out.universes) {
		assert.deepEqual(universe.solved.card, out.universes[0].solved.card);
	}
});

test("a distance settles, moves both members, and draws one design twice", async () => {
	const out = await run(scened(twoBoxes(), [apart()]), real);
	const universe = out.universes[0];
	assert.equal(universe.sketch?.status, "settled");
	// Four unknowns, one relation: a continuum of placements satisfies it and this
	// is one of them. That is the normal case, not an error, and it is why the
	// aim is stored — see the round trip below.
	assert.equal(universe.sketch?.dof, 3);
	assert.equal(universe.sketch?.approximate, false);
	assert.deepEqual(universe.sketch?.conflict, []);
	assert.deepEqual(universe.sketch?.pinned, []);
	assert.deepEqual(universe.sketch?.owned, {
		badge: ["x", "y"],
		card: ["x", "y"],
	});
	// ...and it placed all of them, which is what makes the drag on either node an
	// aim rather than a frame. See the pair of tests at the end of section 3 for
	// the universes where those two records differ.
	assert.deepEqual(universe.sketch?.placed, universe.sketch?.owned);
	// The rule holds, to within the EMU the answer is quantized to.
	assert.ok(
		Math.abs(between(universe, "card", "badge") - px(120)) < 100,
		`${between(universe, "card", "badge") / P}px apart`,
	);
	// Checklist 11: the editable canvas and the multiverse grid draw the same
	// design. `Editor.tsx` reads `universe.solved` and `Artboard.tsx` draws
	// `universe.model`, and they only agree because `readModel` takes the
	// override.
	for (const id of ["card", "badge"]) {
		assert.equal(universe.model.byId[id].frame.x, universe.solved[id].x);
		assert.equal(universe.model.byId[id].frame.y, universe.solved[id].y);
	}
	// And nothing but the two positions moved: the widths are the answer set's.
	assert.equal(universe.solved.card.width, undefined);
	assert.equal(universe.model.byId.card.frame.width, px(100));
});

test("a coordinate the linear layer decided comes out exactly as it went in", async () => {
	// A child of an automatic layout is `skheld` on both axes — through `gcoord/2`
	// and emphatically not `gpos/2`, which a laid-out node never reaches — so the
	// sketch has one free node to move and the row keeps its slot. Bit-identical,
	// not close: the pin is not read back out of the system at all.
	const scene = scened(
		[
			at("row", { x: 0, y: 0, w: 400, h: 120 }, {
				kind: "frame",
				layout: makeLayout({ direction: "row" }),
				children: [
					at("one", { x: 0, y: 0, w: 60, h: 60 }),
					at("two", { x: 0, y: 0, w: 60, h: 60 }),
				],
			}),
			at("badge", { x: 300, y: 300, w: 40, h: 40 }),
		],
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["one", "badge"],
				value: dimension(px(120)),
			}),
		],
	);
	const linear = (await run(scene)).universes[0];
	const sketched = (await run(scene, real)).universes[0];
	assert.equal(sketched.sketch?.status, "settled");
	assert.deepEqual(sketched.sketch?.owned, { badge: ["x", "y"] });
	// A pinned coordinate is answered by the sketch too — identically, by
	// construction — and is still not the sketch's to be reported as placed: a
	// caller that withholds a write for what the sketch places would otherwise
	// withhold it from the layer that is actually holding the value.
	assert.deepEqual(sketched.sketch?.placed, { badge: ["x", "y"] });
	for (const id of ["one", "two", "row"]) {
		assert.deepEqual(
			sketched.solved[id],
			linear.solved[id],
			`${id} was placed by the layout and the sketch must not have touched it`,
		);
	}
	assert.notDeepEqual(sketched.solved.badge, linear.solved.badge);
});

/* ------------------------------------------------------------------ */
/* 2. A conflict, in the document's currency                           */
/* ------------------------------------------------------------------ */

test("a rule the layout already answered is blamed by name, and so are the pins", async () => {
	// `align [a,b] on left` makes both members `gsolved`, which gives them `gpos`
	// on both planar axes, so all four coordinates are held and the distance has
	// nothing left to move. That is the intended answer rather than a bug: the two
	// rules genuinely are a contradiction unless something gives.
	const scene = scened(twoBoxes(), [
		rule({ id: "flush", kind: "align", nodes: ["card", "badge"], edge: "left" }),
		apart(),
	]);
	const linear = (await run(scene)).universes[0];
	const universe = (await run(scene, real)).universes[0];
	const report = universe.sketch;
	assert.equal(report?.status, "conflicted");

	// The currency: every blamed rule is a row in the document, spelled exactly as
	// `constraint(C)`, `active(C)` and an unsat core spell it.
	const ids = new Set(scene.constraints.map((c) => c.id));
	assert.ok(report && report.conflict.length > 0);
	for (const blamed of report.conflict) {
		assert.ok(ids.has(blamed), `${blamed} is not a rule in this document`);
	}
	assert.ok(report.conflict.includes("apart"));
	// ...and the other half, which is not a rule and cannot be switched off, so it
	// is reported apart from the rules and never merged into them. The same split
	// `UnsatisfiableError` already makes between `conflict` and `pinned`.
	assert.deepEqual([...report.pinned].sort(), [
		"badge:x",
		"badge:y",
		"card:x",
		"card:y",
	]);
	assert.deepEqual(report.owned, {}, "nothing is left for the sketch to place");
	assert.deepEqual(report.placed, {}, "and so nothing was placed");

	// Checklist 5: a refused solve writes no geometry. `apply_solution()` is not
	// reached, so the design on screen is the linear one, exactly.
	assert.deepEqual(universe.solved, linear.solved);
	assert.equal(universe.model.byId.card.frame.x, linear.model.byId.card.frame.x);
	// And the clingo core is untouched: the document is satisfiable, there are
	// designs on screen, and a sketch conflict is per universe rather than per
	// document.
	assert.equal(universe.violated.size, 0);
});

/* ------------------------------------------------------------------ */
/* 3. What a failure must not teach                                    */
/* ------------------------------------------------------------------ */

/**
 * The same document explored twice — once plain, once with a sketcher that
 * always fails — so that "nothing was learned" is an equality rather than an
 * absence somebody has to notice.
 */
async function compare(
	scene: Scene,
	outcome: SketchOutcome,
): Promise<{ plain: Exploration; failed: Exploration }> {
	const plain = await run(scene);
	const failed = await run(scene, always(outcome));
	return { plain, failed };
}

test("a numeric failure is adrift: no rule blamed, no design lost, no rule learned", async () => {
	// PlaneGCS returns `Failed` for two quite different reasons and reports them
	// the same way. An empty conflicting set is non-convergence — the iteration ran
	// out of steps, or started too far from any root — which is a statement about
	// the arithmetic and not about the rules. The tempting move is to forbid this
	// combination and ask for another design; it would remove from the multiverse
	// every design in which those rules coexist, including the ones that converge
	// perfectly from a different aim, with no error and no way to find out why.
	const scene = setProp(
		scened(twoBoxes(), [apart()]),
		["badge"],
		"fill",
		[lit("#f00"), lit("#0f0")],
	);
	const { plain, failed } = await compare(scene, { status: "adrift" });

	// The program is the program. No integrity constraint, no `#external`, no
	// second grounding — this is the assertion the section exists for.
	assert.equal(failed.generated, plain.generated);
	assert.equal(failed.solves, plain.solves, "and no re-solve either");

	// Every design survives, whole, showing the linear geometry — which is a real,
	// exact answer to every rule the linear layer owns.
	assert.equal(failed.count, plain.count);
	assert.equal(failed.total, plain.total);
	for (let i = 0; i < failed.universes.length; i++) {
		const universe = failed.universes[i];
		assert.equal(universe.sketch?.status, "adrift");
		// No row is reddened, because no row is at fault.
		assert.deepEqual(universe.sketch?.conflict, []);
		assert.deepEqual(universe.sketch?.pinned, []);
		assert.deepEqual(universe.sketch?.redundant, []);
		assert.deepEqual(universe.solved, plain.universes[i].solved);
		assert.deepEqual(universe.pick, plain.universes[i].pick);
	}
	// ...and the members are still named as the sketch layer's, so the Inspector
	// can say the sketch did not settle *here* rather than saying nothing.
	assert.deepEqual(failed.universes[0].sketch?.owned, {
		badge: ["x", "y"],
		card: ["x", "y"],
	});
});

test("an adrift universe keeps the linear geometry and claims no freedom", async () => {
	// The stub hands this package an outcome that is *already* `adrift`, so what
	// is pinned here is this package's half of it: the linear answer survives
	// untouched, and the report carries no `dof`, because a degrees-of-freedom
	// count is a fact about a solve that happened.
	//
	// Which library statuses become `adrift` is the other package's question, and
	// `SuccessfulSolutionInvalid` is the one no request can be written to produce
	// — so it is pinned in `packages/planegcs/src/index.test.ts`, where the status
	// can be forced and `apply_solution()` can be watched. This test used to carry
	// that claim in its name while exercising nothing that could produce it.
	const scene = scened(twoBoxes(), [apart()]);
	const { plain, failed } = await compare(scene, { status: "adrift" });
	assert.deepEqual(failed.universes[0].solved, plain.universes[0].solved);
	assert.equal(failed.universes[0].sketch?.dof, undefined);
});

test("even a real conflict learns nothing: it is reported, never fed back", async () => {
	// The sharper version. Even a *non-empty* conflicting set is not a sound nogood
	// over answer sets: `sk_length(C,V)` depends on the pick vector, so a
	// contradiction at 40px says nothing about the same rules at 80px, while a
	// learned constraint over `active(C)` atoms is pick-blind by construction.
	const scene = setProp(
		scened(twoBoxes(), [apart()]),
		["badge"],
		"fill",
		[lit("#f00"), lit("#0f0")],
	);
	const { plain, failed } = await compare(scene, {
		status: "conflicted",
		tags: ["apart"],
	});
	assert.equal(failed.generated, plain.generated);
	assert.equal(failed.count, plain.count);
	assert.equal(failed.solves, plain.solves);
	for (let i = 0; i < failed.universes.length; i++) {
		assert.deepEqual(failed.universes[i].sketch?.conflict, ["apart"]);
		assert.deepEqual(failed.universes[i].solved, plain.universes[i].solved);
	}
});

test("a conflicting set naming neither a rule nor a pin is adrift rather than blank", async () => {
	// A tag the caller never supplied cannot be attributed to anything, and a
	// conflict headline reading "these 0 rules cannot both hold" is worse than
	// saying the sketch did not settle.
	const out = await run(
		scened(twoBoxes(), [apart()]),
		always({ status: "conflicted", tags: ["something_else"] }),
	);
	assert.equal(out.universes[0].sketch?.status, "adrift");
	assert.deepEqual(out.universes[0].sketch?.conflict, []);
});

test("a solve that did not settle owns coordinates it did not place, and says so", async () => {
	// The two questions one report answers about one coordinate, and the universes
	// where they part company.
	//
	// `owned` is about the *document*: no linear rule decided this coordinate, so
	// the sketch layer is the only thing that could ever speak for it. It stays
	// populated on a failure, deliberately — the test above depends on that, so
	// the Inspector can say the sketch did not settle *here* rather than saying
	// nothing. `placed` is about the *solve*: nothing was applied, so it is empty,
	// and the node on screen is at the frame the document stores.
	//
	// Which matters because something withholds a write on the strength of it. The
	// Editor's seed drag does not write `frame` for a coordinate the sketch places,
	// since the next solve would overrule it — and read off `owned` that withheld
	// the write here too, where no solved coordinate exists and the stored frame is
	// the only thing placing the node. The node showed as settling and then did not
	// move, on the two universes where the design is already in trouble and moving
	// something is the whole of what a designer can do about it.
	const scene = scened(twoBoxes(), [apart()]);
	const outcomes: SketchOutcome[] = [
		{ status: "adrift" },
		{ status: "conflicted", tags: ["apart"] },
		// A solver that never loaded reaches the picture the same way the other two
		// do — the report is a report, and the withheld write is withheld — but it
		// is a fourth status and not a spelling of the first. `adrift` invites the
		// designer to drag a member and start the iteration somewhere else, which
		// is a remedy for a numeric failure and a false promise about a module that
		// is not there.
		{ status: "unavailable" },
	];
	for (const outcome of outcomes) {
		const universe = (await run(scene, always(outcome))).universes[0];
		assert.equal(universe.sketch?.status, outcome.status);
		assert.deepEqual(universe.sketch?.owned, {
			badge: ["x", "y"],
			card: ["x", "y"],
		});
		assert.deepEqual(
			universe.sketch?.placed,
			{},
			`${outcome.status}: nothing was applied, so nothing was placed`,
		);
		// And the record the field describes agrees with it: no sketch coordinate
		// reached the picture, which is the same statement from the other end.
		assert.deepEqual(
			universe.solved,
			(await run(scene)).universes[0].solved,
			`${outcome.status}: the linear geometry, untouched`,
		);
	}
});

/* ------------------------------------------------------------------ */
/* 4. The aim is document state, so the picture comes back             */
/* ------------------------------------------------------------------ */

/** The same node, with somewhere else for the sketch to start looking. */
function aimed(scene: Scene, id: string, at: { x: number; y: number }): Scene {
	return {
		...scene,
		nodes: scene.nodes.map((node) =>
			node.id === id ? { ...node, sketchSeed: spellSeed(at) } : node,
		),
	};
}

const placement = (universe: Universe): Record<string, Partial<Frame>> =>
	universe.solved;

test("the starting aim picks the design, and a round trip gives the same one back", async () => {
	// The whole argument for storing the aim rather than the answer. At `dof > 0`
	// the solve lands somewhere in a continuum and *where* is decided by where it
	// started; name that, store it, and the solve is a pure function of (document,
	// picks, aim) again. Store the output instead and two peers merging per key
	// produce peer A's x beside peer B's y — a point that is a solution of neither.
	const scene = scened(twoBoxes(), [apart()]);
	const asIs = placement((await run(scene, real)).universes[0]);

	// Aimed somewhere else entirely, which is what dragging a sketched node does.
	const seeded = aimed(scene, "card", { x: px(0), y: px(400) });
	const aimedAt = placement((await run(seeded, real)).universes[0]);
	assert.notDeepEqual(aimedAt, asIs, "the aim has to matter, or storing it is idle");

	// The round trip that is the point of the field: through JSON and the reader
	// the studio actually opens documents with.
	const round = normalizeScene(JSON.parse(JSON.stringify(seeded)));
	assert.equal(round.nodes[0].sketchSeed, seeded.nodes[0].sketchSeed);
	assert.deepEqual(
		placement((await run(round, real)).universes[0]),
		aimedAt,
		"same document, same aim, same design",
	);

	// And the contrast, which is what makes the assertion above worth making: a
	// document that lost the aim re-derives a *different* picture from the same
	// rules. Re-deriving is not reproducing.
	const forgotten = normalizeScene(
		JSON.parse(JSON.stringify(aimed(scene, "card", { x: px(0), y: px(400) }))),
	);
	assert.notDeepEqual(placement((await run(scene, real)).universes[0]), aimedAt);
	assert.deepEqual(placement((await run(forgotten, real)).universes[0]), aimedAt);
});

test("an aim the reader cannot read degrades to absence, not to a failure", async () => {
	// `pruneNodes` drops a `sketchSeed` that is not two whole EMU, and a dropped
	// aim is a node that starts where it sits — which is exactly what absence
	// already means, so a corrupt one costs the design nothing.
	const scene = scened(twoBoxes(), [apart()]);
	const asIs = placement((await run(scene, real)).universes[0]);
	const corrupt = normalizeScene(
		JSON.parse(
			JSON.stringify({
				...scene,
				nodes: scene.nodes.map((node) =>
					node.id === "card" ? { ...node, sketchSeed: "over there" } : node,
				),
			}),
		),
	);
	assert.equal(corrupt.nodes[0].sketchSeed, undefined);
	assert.deepEqual(placement((await run(corrupt, real)).universes[0]), asIs);
});

test("no solve writes to the document", async () => {
	// Checklist 7. A repair on read makes looking at a project an edit that syncs,
	// and auto-persisting solver output is that pattern with a different subject:
	// every solve would be an undo entry, an `updatedAt` bump and a sync round trip
	// for a value the next solve recomputes anyway.
	const scene = aimed(scened(twoBoxes(), [apart()]), "card", {
		x: px(10),
		y: px(20),
	});
	const before = JSON.stringify(scene);
	await run(scene, real);
	assert.equal(JSON.stringify(scene), before);
});

test("a bearing is measured clockwise from straight right, in the document's plane", async () => {
	// The one kind whose value is not a length. The document's y grows downwards,
	// which is the plane the library's own `p2p_angle` is already in, so the
	// degrees are converted and not negated.
	const scene = scened(twoBoxes(), [
		rule({
			id: "lean",
			kind: "bearing",
			nodes: ["card", "badge"],
			value: single("30deg"),
		}),
	]);
	const universe = (await run(scene, real)).universes[0];
	assert.equal(universe.sketch?.status, "settled");
	const a = centre(universe, "card");
	const b = centre(universe, "badge");
	const degrees = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
	assert.ok(Math.abs(degrees - 30) < 0.01, `${degrees}°`);
});

test("three boxes fall on one line at an angle Align could never have said", async () => {
	const scene = scened(
		[...twoBoxes(), at("tag", { x: 400, y: 300, w: 30, h: 30 })],
		[rule({ id: "row", kind: "collinear", nodes: ["card", "badge", "tag"] })],
	);
	const universe = (await run(scene, real)).universes[0];
	assert.equal(universe.sketch?.status, "settled");
	const [a, b, c] = ["card", "badge", "tag"].map((id) => centre(universe, id));
	// The determinant, which is what a collinearity *is*, normalised by the two
	// lengths so the tolerance is an angle rather than an area.
	const cross =
		(b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
	const scale = Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - a.x, c.y - a.y);
	assert.ok(Math.abs(cross / scale) < 1e-6, `${cross / scale}`);
	// ...and the line is genuinely diagonal, which is the whole point: `align` is
	// one coordinate on one axis and can only ever be horizontal or vertical.
	assert.notEqual(Math.round(a.x), Math.round(b.x));
	assert.notEqual(Math.round(a.y), Math.round(b.y));
});

test("a value that reads as no number leaves the rule out of the system", async () => {
	// A percentage is not a length. The rule still exists, is still switched on and
	// is still nameable; it simply carries nothing, and it is dropped here rather
	// than asserting a distance of zero — which would collapse two nodes onto one
	// point and look exactly like a bug in the layout.
	const scene = scened(twoBoxes(), [
		rule({
			id: "apart",
			kind: "distance",
			nodes: ["card", "badge"],
			value: single("50%"),
		}),
	]);
	const universe = (await run(scene, real)).universes[0];
	assert.equal(universe.sketch?.status, "settled");
	// Four unknowns and no relation at all.
	assert.equal(universe.sketch?.dof, 4);
	assert.ok(Math.abs(between(universe, "card", "badge") - px(172.63)) < px(0.1));
});

test("the request a document builds is the request it builds again", async () => {
	// Canonical order is the builder's, but the *inputs* are this file's, and a
	// request that differed between two explorations of one document would make
	// every determinism claim above vacuous.
	const scene = scened(twoBoxes(), [apart()]);
	const seen: SketchRequest[] = [];
	const recording: Sketcher = {
		solve(request) {
			seen.push(request);
			return real.solve(request);
		},
		close() {},
	};
	await run(scene, recording);
	await run(scene, recording);
	assert.equal(seen.length, 2);
	assert.deepEqual(seen[0], seen[1]);
	// And it says what it should: two points in pixels, nothing pinned, one rule.
	assert.deepEqual(seen[0].points, [
		{ node: "badge", x: 220, y: 60 },
		{ node: "card", x: 50, y: 30 },
	]);
	assert.deepEqual(seen[0].pinned, []);
	assert.deepEqual(seen[0].rules, [
		{ tag: "apart", kind: "distance", a: "card", b: "badge", px: 120 },
	]);
});

/* ------------------------------------------------------------------ */
/* The template, which is the only document in the tree a user opens   */
/* ------------------------------------------------------------------ */

/**
 * `orbit` is the demonstration, so it is also the one document whose *numbers*
 * are worth asserting rather than whose mechanism is.
 *
 * Everything above builds its scene inline and checks one relation at a time.
 * This checks the picture: three satellites at one radius and three bearings,
 * over all three universes, plus the row the linear layer pins and the sketch
 * layer straightens. It is a slow test by this file's standards and it earns it
 * — the first draft of the template named its radius token `radius`, colliding
 * with the `radius` every rect uses for its corners, and drew an orbit eight
 * pixels across in one universe out of three. Nothing else in the suite looked
 * at a template's geometry, so nothing else noticed.
 */
test("the orbit template draws three radii, three bearings and one straight row", async () => {
	const explorer = new Explorer(directSolver, real);
	const ex = await explorer.explore(normalizeScene(orbit()), { limit: 8 });
	try {
		assert.equal(ex.universes.length, 3, "one universe per reach alternative");

		const SIZE: Record<string, number> = {
			hub: 80, east: 56, west: 56, north: 56, m1: 20, m2: 20, m3: 20,
		};
		const centre = (u: Universe, id: string): { x: number; y: number } => {
			const at = u.solved?.[id];
			assert.ok(at?.x !== undefined && at?.y !== undefined, `${id} is placed`);
			return { x: at.x / P + SIZE[id] / 2, y: at.y / P + SIZE[id] / 2 };
		};

		const radii = new Set<number>();
		for (const u of ex.universes) {
			assert.equal(u.sketch?.status, "settled");
			assert.deepEqual(u.sketch?.conflict, [], "no rule conflicts with another");
			assert.deepEqual(u.sketch?.redundant, [], "and none of them is spare");
			// One: the middle marker, free to slide along the line and nowhere
			// else. The hub's two pins are what stop the constellation drifting.
			assert.equal(u.sketch?.dof, 1);

			const hub = centre(u, "hub");
			const seen: number[] = [];
			for (const [id, want] of [["east", 30], ["west", 150], ["north", 270]] as const) {
				const p = centre(u, id);
				const dx = p.x - hub.x;
				const dy = p.y - hub.y;
				seen.push(Math.hypot(dx, dy));
				const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
				assert.ok(
					Math.abs(deg - want) < 0.01,
					`${id} sits at ${deg.toFixed(3)}°, not ${want}°`,
				);
			}
			// All three at one radius, which is what makes it an orbit rather than
			// three unrelated placements.
			assert.ok(Math.max(...seen) - Math.min(...seen) < 0.01, JSON.stringify(seen));
			radii.add(Math.round(seen[0]));

			// The row: two ends held by `pin`, the middle one straightened onto the
			// line between them. Twice the area of the triangle they make, which is
			// zero exactly when the three are collinear.
			const [a, b, c] = [centre(u, "m1"), centre(u, "m2"), centre(u, "m3")];
			const twiceArea = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
			assert.ok(Math.abs(twiceArea) < 0.5, `markers are bent: ${twiceArea}`);
			// ...and the held ends really are where the linear layer put them.
			assert.ok(Math.abs(a.x - 150) < 0.01 && Math.abs(a.y - 420) < 0.01);
			assert.ok(Math.abs(c.x - 570) < 0.01 && Math.abs(c.y - 406) < 0.01);
		}

		// The three the token holds, and no eight-pixel orbit among them.
		assert.deepEqual([...radii].sort((x, y) => x - y), [120, 160, 208]);
	} finally {
		await explorer.close();
	}
});

/**
 * A turned box loses the corner it cannot compute and keeps the centre it can.
 *
 * `sketchprogram.test.ts` asserts the predicates; this asserts that the solver
 * is actually handed the surviving rule and answers it. It is the end-to-end
 * form of the reason `skoffcentre/2` is per anchor: while it was per node, the
 * `corner` rule below withheld `card`'s point from `middle` as well, the bearing
 * went unstated, and the picture came back as the linear layer had left it with
 * nothing anywhere saying a rule had been dropped.
 */
test("a corner rule on a turned box drops, and the centre rule beside it holds", async () => {
	const nodes = [
		at("card", { x: 0, y: 0, w: 100, h: 60 }, {
			turn: { rotateZ: single("30deg") },
		}),
		at("badge", { x: 200, y: 40, w: 40, h: 40 }),
	];
	const corner = rule({
		id: "corner",
		kind: "distance",
		nodes: ["card", "badge"],
		anchor: "topLeft",
		value: dimension(px(120)),
	});
	const middle = rule({
		id: "middle",
		kind: "bearing",
		nodes: ["card", "badge"],
		anchor: "center",
		value: angleValue(45_000),
	});

	const universe = (await run(scened(nodes, [corner, middle]), real)).universes[0];
	assert.equal(universe.sketch?.status, "settled");
	// The bearing held, between the centres, to the degree it asked for.
	const a = centre(universe, "card");
	const b = centre(universe, "badge");
	const deg = ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360;
	assert.ok(Math.abs(deg - 45) < 0.01, `bearing came out ${deg.toFixed(4)}°`);
	// The distance did not: `card` has no `topLeft` point, so the rule was left
	// under its two members and never became a `p2p_distance`. Asserted as the
	// separation *not* being what it asked for, because a rule that quietly held
	// anyway would be the bug this test is named after.
	const apartPx = Math.hypot(b.x - a.x, b.y - a.y) / P;
	assert.ok(
		Math.abs(apartPx - 120) > 1,
		`the corner rule should not have been solved, but the gap is ${apartPx.toFixed(2)}px`,
	);
	// And the panel can say why, for the member it was refused about and no other.
	const refused = refusedMembers(scened(nodes, [corner, middle]), corner);
	assert.deepEqual(refused.map((r) => r.member), ["card"]);
	assert.match(refused[0].why, /has no top-left corner/);
	assert.deepEqual(refusedMembers(scened(nodes, [corner, middle]), middle), []);
});
