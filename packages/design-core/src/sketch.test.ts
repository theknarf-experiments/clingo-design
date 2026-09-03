/**
 * Reading the sketch layer off an answer set, and writing its answer back.
 *
 * Every claim here is about a boundary rather than about a computation, which is
 * why the file is mostly arithmetic and sentences:
 *
 * - **The EMU boundary**, asserted as the property it is rather than as a spot
 *   check. A coordinate the sketch layer does not move must come back
 *   bit-identical, and the whole reason the system is built in CSS pixels is that
 *   PlaneGCS's convergence threshold and its trust radius are absolute numbers
 *   tuned in a plane where a shape is tens of units across.
 * - **The world chain.** `readSolved` is parent-local and a Euclidean distance
 *   between two numbers in two different parents is not a distance, so the chain
 *   is summed on the way in and subtracted on the way out — and the two have to
 *   be inverses to the EMU.
 * - **The refusals**, in the words the panel shows. `refusedAnchor` is the
 *   TypeScript twin of `sknopoint/1` and of the `sknode/1` whitelist, and one of
 *   its four cases — the turned box — has no other reader at all: `inertMembers`
 *   returns `[]` the moment a constraint has no edge, which is every sketch kind.
 *   That is asserted here rather than assumed, because it is the reason this
 *   function has to carry the sentence — and `refusedMembers` is asserted beside
 *   it, because a sentence with no list to render it in is a sentence nobody
 *   reads.
 *
 * Written in pixels at the document end and EMU in the middle, the seam
 * `spatialprogram.test.ts` and `geometric.test.ts` both name.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { openSketcher } from "@clingo-design/planegcs";

import {
	ASP_EMU_CEILING,
	PULL_ATOM,
	SCENERY_ATOM,
	compile,
	guardAtom,
} from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { materializedParts } from "./machines.ts";
import { readSolved } from "./model.ts";
import {
	ANCHOR_NAMES,
	CONSTRAINT_KINDS,
	type Constraint,
	type Scene,
	type SceneNode,
	dimension,
	emptyScene,
	makeFrame,
} from "./scene.ts";
import {
	anchorPoint,
	heldTag,
	readHeldTag,
	readSketchFacts,
	refusedAnchor,
	refusedMembers,
	seedOf,
	sketchOwned,
	sketchPlacers,
	sketchRequest,
	sketchSolved,
	spellSeed,
} from "./sketch.ts";
import { crossesViewport, inertMembers } from "./spatial.ts";
import { EMU_PER_PX, cssPxFromEmu, emuFromCssPx } from "./units.ts";
import { single } from "./values.ts";

const P = EMU_PER_PX;
const px = (n: number): number => n * P;

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

const scened = (nodes: SceneNode[], constraints: Constraint[] = []): Scene => ({
	...emptyScene(),
	nodes,
	constraints,
});

const rule = (
	c: Partial<Constraint> & Pick<Constraint, "id" | "kind">,
): Constraint => ({ prop: "fill", nodes: [], enabled: true, ...c });

const NO_CONTEXT = { tokens: [], picks: {} };

/**
 * One answer set of one document, the way the studio asks for one — with the
 * option of holding a rule's switch *off*, which is what a universe looks like
 * once a rule has been relaxed out of a core or lost a preference.
 */
async function answer(
	scene: Scene,
	off: readonly string[] = [],
): Promise<string[]> {
	const { program, guards } = compile(scene);
	const silenced = new Set(off.map(guardAtom));
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: 1,
			assumptions: [
				...guards.map((atom) => ({ atom, sign: !silenced.has(atom) })),
				...[PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
			],
		});
		assert.equal(out.result, "SATISFIABLE", "expected a design");
		return out.models[0] ?? [];
	} finally {
		await session.close();
	}
}

/* ------------------------------------------------------------------ */
/* 1. The EMU boundary                                                 */
/* ------------------------------------------------------------------ */

test("every whole EMU survives a trip through the pixel plane, exactly", () => {
	// The guarantee the whole feature's exactness rests on: a coordinate the
	// sketch layer does not move comes back the number simplex decided. Provable
	// rather than hoped for — `cssPxFromEmu` is one IEEE-754 division, so the
	// quotient is within half an ulp, multiplying back is within about 2⁻⁵²·|e|,
	// which for |e| ≤ 2³¹/4 is under 1.2 × 10⁻⁷ EMU, and `wholeEmu` recovers it.
	const edges = [
		0,
		1,
		-1,
		P,
		-P,
		ASP_EMU_CEILING,
		-ASP_EMU_CEILING,
		ASP_EMU_CEILING - 1,
		9524,
		9526,
	];
	for (const e of edges) {
		assert.equal(emuFromCssPx(cssPxFromEmu(e)), e, `${e}`);
	}
	// And a sweep, because the boundary values are the ones a bug would be written
	// around. A fixed generator rather than `Math.random`, so a failure here names
	// a number somebody can go and look at.
	let seed = 20240917;
	for (let i = 0; i < 20000; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		const e = (seed % (ASP_EMU_CEILING + 1)) * (i % 2 === 0 ? 1 : -1);
		assert.equal(emuFromCssPx(cssPxFromEmu(e)), e, `${e}`);
	}
});

/* ------------------------------------------------------------------ */
/* 2. Reading the atoms                                                */
/* ------------------------------------------------------------------ */

test("an answer set with no sketch rule in it reads as no sketch at all", () => {
	const facts = readSketchFacts([
		"node(card)",
		"frame(card,x,0)",
		'__lpx(lv(card,x),"9525")',
	]);
	assert.deepEqual(facts.rules, []);
	assert.equal(facts.members.size, 0);
	assert.equal(facts.solved.size, 0);
	assert.equal(facts.held.size, 0);
});

test("the seven predicates, off a real answer set, in slot order", async () => {
	const scene = scened(
		[
			at("card", { x: 0, y: 0, w: 100, h: 60 }),
			at("badge", { x: 200, y: 40, w: 40, h: 40 }),
			at("tag", { x: 400, y: 80, w: 30, h: 30 }),
		],
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				anchor: "topLeft",
				value: dimension(px(120)),
			}),
			rule({ id: "row", kind: "collinear", nodes: ["tag", "card", "badge"] }),
			rule({ id: "lean", kind: "bearing", nodes: ["card", "tag"], value: single("30deg") }),
		],
	);
	const facts = readSketchFacts(await answer(scene));
	assert.deepEqual(facts.rules, ["apart", "lean", "row"], "in id order");
	// Slot order is the document's member order, restored rather than trusted:
	// clingo prints atoms in whatever order it likes, and the first two members of
	// a `collinear` are the line the rest fall on.
	assert.deepEqual(facts.members.get("row"), ["tag", "card", "badge"]);
	assert.deepEqual(facts.members.get("apart"), ["card", "badge"]);
	assert.equal(facts.anchors.get("apart"), "topLeft");
	assert.equal(facts.anchors.get("row"), "center", "the default, stated");
	// Two units that cannot be got from each other, so two predicates.
	assert.equal(facts.lengths.get("apart"), px(120));
	assert.equal(facts.lengths.get("lean"), undefined);
	assert.equal(facts.angles.get("lean"), 30000);
	assert.deepEqual([...facts.solved].sort(), ["badge", "card", "tag"]);
	assert.deepEqual([...facts.held], []);
});

test("a held coordinate is a node and an axis, joined the way the program spells it", async () => {
	const scene = scened(
		[
			at("card", { x: 0, y: 0, w: 100, h: 60 }),
			at("badge", { x: 200, y: 40, w: 40, h: 40 }),
		],
		[
			rule({ id: "flush", kind: "align", nodes: ["card", "badge"], edge: "left" }),
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				value: dimension(px(120)),
			}),
		],
	);
	const facts = readSketchFacts(await answer(scene));
	assert.deepEqual([...facts.held].sort(), [
		"badge:x",
		"badge:y",
		"card:x",
		"card:y",
	]);
	// Nothing is left for the sketch to place, which is the intended answer for
	// this pair rather than a bug — and `owned` says so by being empty.
	assert.deepEqual(sketchOwned(facts), {});
});

test("a pin's tag is a term, so it can never be mistaken for a rule", () => {
	// A `Constraint.id` is an ASP constant; `held(card,x)` is not one, so the two
	// halves of a conflicting set come apart again with no second list to check
	// against.
	assert.equal(heldTag("card", "x"), "held(card,x)");
	assert.equal(readHeldTag("held(card,x)"), "card:x");
	assert.equal(readHeldTag("held(cell(1,1),y)"), "cell(1,1):y");
	assert.equal(readHeldTag("apart"), undefined);
	assert.equal(readHeldTag("held(card,z)"), undefined, "the sketch plane is x and y");
});

/* ------------------------------------------------------------------ */
/* 3. Anchors, and the aim                                             */
/* ------------------------------------------------------------------ */

test("an anchor is arithmetic on a frame, and there are exactly nine of them", () => {
	const frame = { x: 100, y: 200, width: 40, height: 60 };
	assert.deepEqual(anchorPoint(frame, "topLeft"), { x: 100, y: 200 });
	assert.deepEqual(anchorPoint(frame, "center"), { x: 120, y: 230 });
	assert.deepEqual(anchorPoint(frame, "bottomRight"), { x: 140, y: 260 });
	assert.deepEqual(anchorPoint(frame, "top"), { x: 120, y: 200 });
	assert.deepEqual(anchorPoint(frame, "left"), { x: 100, y: 230 });
	// Every one of the nine lands inside the box, which is the only thing all nine
	// have in common and the one thing a wrong table would break.
	for (const anchor of ANCHOR_NAMES) {
		const point = anchorPoint(frame, anchor);
		assert.ok(point.x >= 100 && point.x <= 140, anchor);
		assert.ok(point.y >= 200 && point.y <= 260, anchor);
	}
});

test("an aim is two whole EMU under one scalar key, and anything else is nothing", () => {
	// A string rather than an object, because `reconcile.ts`'s `assign` recurses
	// into any object-vs-object pair: a nested `{x, y}` merges per axis, so two
	// peers aiming one node would produce peer A's x beside peer B's y — an aim
	// neither of them had, selecting a branch neither of them meant.
	assert.equal(spellSeed({ x: 9525, y: -3175 }), "9525,-3175");
	assert.equal(spellSeed({ x: 0.4, y: -0.5 }), "0,-1", "ties away from zero");
	const node = at("card", { x: 0, y: 0, w: 10, h: 10 });
	assert.deepEqual(seedOf({ ...node, sketchSeed: "9525,-3175" }), {
		x: 9525,
		y: -3175,
	});
	assert.equal(seedOf(node), undefined);
	for (const bad of ["", "9525", "9525,", ",9525", "a,b", "1.5,2", "1e3,2", "1,2,3"]) {
		assert.equal(seedOf({ ...node, sketchSeed: bad }), undefined, bad);
	}
	// The round trip, which is what `pruneNodes` leans on when it decides whether
	// to keep one.
	for (const point of [{ x: 0, y: 0 }, { x: -1, y: 1 }, { x: px(400), y: px(-9) }]) {
		assert.deepEqual(seedOf({ ...node, sketchSeed: spellSeed(point) }), point);
	}
});

/* ------------------------------------------------------------------ */
/* 4. The world chain, in and out                                      */
/* ------------------------------------------------------------------ */

/** A card inside a frame, so the world sum is not the identity. */
const nested = (): Scene =>
	scened(
		[
			at("art", { x: 40, y: 25, w: 600, h: 400 }, {
				kind: "frame",
				children: [at("card", { x: 10, y: 20, w: 100, h: 60 })],
			}),
			at("badge", { x: 300, y: 200, w: 40, h: 40 }),
		],
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				value: dimension(px(120)),
			}),
		],
	);

test("the system is built in world coordinates, in CSS pixels", async () => {
	// Off local coordinates this rule would be a distance between two numbers in
	// two different parents, which is not a distance: PlaneGCS would report
	// `Success` at `dof = 0` on a design that is visibly wrong by the frame's
	// offset, and writing the answer back as an `lv` would move the node by that
	// offset again.
	const scene = nested();
	const atoms = await answer(scene);
	const facts = readSketchFacts(atoms);
	const request = sketchRequest(scene, facts, readSolved(atoms), NO_CONTEXT);
	assert.ok(request);
	// `card` is at (10,20) inside a frame at (40,25), so its centre is at
	// (40+10+50, 25+20+30) on the canvas.
	assert.deepEqual(request.points, [
		{ node: "badge", x: 320, y: 220 },
		{ node: "card", x: 100, y: 75 },
	]);
	assert.deepEqual(request.pinned, []);
	assert.deepEqual(request.rules, [
		{ tag: "apart", kind: "distance", a: "card", b: "badge", px: 120 },
	]);
});

test("and the answer comes back local, exactly where it went in", async () => {
	// The two directions have to be inverses to the EMU or a node drifts by its
	// parent's offset every time it is solved. Asserted by feeding the request's
	// own points back as if the solver had not moved them.
	const scene = nested();
	const atoms = await answer(scene);
	const facts = readSketchFacts(atoms);
	const solved = readSolved(atoms);
	const request = sketchRequest(scene, facts, solved, NO_CONTEXT);
	assert.ok(request);
	const unmoved = Object.fromEntries(
		request.points.map((p) => [p.node, { x: p.x, y: p.y }]),
	);
	const back = sketchSolved(
		{ status: "settled", points: unmoved, dof: 0, approximate: false, redundant: [] },
		facts,
		scene,
		solved,
		NO_CONTEXT,
	);
	assert.deepEqual(back, {
		badge: { x: px(300), y: px(200) },
		card: { x: px(10), y: px(20) },
	});
});

test("a document with no sketch rule builds no system at all", async () => {
	const scene = scened(
		[at("card", { x: 0, y: 0, w: 100, h: 60 })],
		[rule({ id: "flush", kind: "align", nodes: ["card"], edge: "left" })],
	);
	const atoms = await answer(scene);
	const facts = readSketchFacts(atoms);
	assert.equal(sketchRequest(scene, facts, readSolved(atoms), NO_CONTEXT), undefined);
});

test("a held coordinate is pushed where simplex put it, and tagged so it can be blamed", async () => {
	const scene = scened(
		[
			at("card", { x: 0, y: 0, w: 100, h: 60 }),
			at("badge", { x: 200, y: 40, w: 40, h: 40 }),
		],
		[
			rule({ id: "flush", kind: "align", nodes: ["card", "badge"], edge: "left" }),
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				value: dimension(px(120)),
			}),
		],
	);
	const atoms = await answer(scene);
	const facts = readSketchFacts(atoms);
	const solved = readSolved(atoms);
	const request = sketchRequest(scene, facts, solved, NO_CONTEXT);
	assert.ok(request);
	assert.deepEqual(request.pinned, [
		{ node: "badge", axis: "x", tag: "held(badge,x)" },
		{ node: "badge", axis: "y", tag: "held(badge,y)" },
		{ node: "card", axis: "x", tag: "held(card,x)" },
		{ node: "card", axis: "y", tag: "held(card,y)" },
	]);
	// A pin is one constraint per axis carrying the caller's tag rather than a
	// `fixed: true` point: a fixed point is not a variable at all, so it could
	// never appear in a conflicting set, and "this rule contradicts the placement
	// the layout already decided" is the sentence that has to reach the panel.
	for (const point of request.points) {
		const solvedAt = solved[point.node];
		assert.equal(point.x * P, (solvedAt.x ?? 0) + (point.node === "card" ? px(50) : px(20)));
	}
});

test("the aim moves the starting point, and only on the axes nobody else owns", async () => {
	const base = scened(
		[
			at("card", { x: 0, y: 0, w: 100, h: 60 }),
			at("badge", { x: 200, y: 40, w: 40, h: 40 }),
		],
		[
			rule({ id: "flush", kind: "align", nodes: ["card", "badge"], edge: "left" }),
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				value: dimension(px(120)),
			}),
		],
	);
	const scene: Scene = {
		...base,
		nodes: base.nodes.map((n) =>
			n.id === "card" ? { ...n, sketchSeed: spellSeed({ x: px(700), y: px(700) }) } : n,
		),
	};
	const atoms = await answer(scene);
	const facts = readSketchFacts(atoms);
	const request = sketchRequest(scene, facts, readSolved(atoms), NO_CONTEXT);
	assert.ok(request);
	// Both of `card`'s coordinates are held here, so the aim is ignored on both:
	// a held coordinate starts where the linear layer put it and is pinned there,
	// and only a free one starts at the document's aim.
	const card = request.points.find((p) => p.node === "card");
	assert.notEqual(card?.x, 700 + 50);
});

test("a rule that is switched off does not decide where an active one is measured", async () => {
	// `skmember/3` heads off `skcon/1`, so the members of every sketch rule the
	// document holds are in the answer set whether the rule is switched on or
	// not — deliberately, for `sksolved/1`'s reason: which unknowns exist must
	// not depend on which rules are assumed. An *anchor* is the opposite
	// question. `aim` builds nothing in this universe, and if it were still
	// allowed to claim the corner then `apart` would be solved corner-to-corner
	// while the Rules panel and the canvas overlay both say centre, with no rule
	// anywhere the designer could switch off to explain the picture.
	const scene = scened(
		[
			at("card", { x: 0, y: 0, w: 100, h: 60 }),
			at("badge", { x: 200, y: 40, w: 40, h: 40 }),
		],
		[
			// Sorts first, which is what makes this the losing race rather than a
			// coincidence: the anchor is the lowest-id rule's, and `aim` < `apart`.
			rule({
				id: "aim",
				kind: "bearing",
				nodes: ["card", "badge"],
				anchor: "topLeft",
				value: single("30deg"),
			}),
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				value: dimension(px(120)),
			}),
		],
	);
	const atoms = await answer(scene, ["aim"]);
	const facts = readSketchFacts(atoms);
	// The answer set really is the awkward one: the off rule's members and its
	// anchor are both in it, and only its switch is missing.
	assert.deepEqual(facts.rules, ["apart"]);
	assert.deepEqual(facts.members.get("aim"), ["card", "badge"]);
	assert.equal(facts.anchors.get("aim"), "topLeft");

	const request = sketchRequest(scene, facts, readSolved(atoms), NO_CONTEXT);
	assert.ok(request);
	// Centres, which is what the one rule that is built asked for — and not the
	// (0,0) and (200,40) top-left corners `aim` would have imposed.
	assert.deepEqual(request.points, [
		{ node: "badge", x: 220, y: 60 },
		{ node: "card", x: 50, y: 30 },
	]);
	assert.deepEqual(request.rules, [
		{ tag: "apart", kind: "distance", a: "card", b: "badge", px: 120 },
	]);
	// ...and the way back out is measured about the same point, or a node would
	// jump by half its own size the first time it was solved.
	const back = sketchSolved(
		{
			status: "settled",
			points: { card: { x: 50, y: 30 }, badge: { x: 220, y: 60 } },
			dof: 0,
			approximate: false,
			redundant: [],
		},
		facts,
		scene,
		readSolved(atoms),
		NO_CONTEXT,
	);
	assert.deepEqual(back, {
		badge: { x: px(200), y: px(40) },
		card: { x: px(0), y: px(0) },
	});
});

/* ------------------------------------------------------------------ */
/* 4b. Two anchors over one pair                                       */
/* ------------------------------------------------------------------ */

/**
 * The reviewer's document, and the shape of the bug it caught.
 *
 * `a` is 40×40 at the origin and `b` is 100×120 at (30,40), so the two top-left
 * corners are a 3-4-5 triangle apart — 50px — while the two centres are 100px
 * apart on a different bearing entirely. A rule about each is therefore a rule
 * about a visibly different pair of places, which is what makes the pair worth
 * measuring twice.
 *
 * `c1` sorts before `c2`, which is what used to decide the whole document: the
 * lowest-id rule's anchor became the only anchor, so `c2` was solved centre to
 * centre while the panel and the overlay both said corners.
 */
const twoAnchors = (): Scene =>
	scened(
		[at("a", { x: 0, y: 0, w: 40, h: 40 }), at("b", { x: 30, y: 40, w: 100, h: 120 })],
		[
			rule({
				id: "c1",
				kind: "bearing",
				nodes: ["a", "b"],
				anchor: "center",
				value: single("90deg"),
			}),
			rule({
				id: "c2",
				kind: "distance",
				nodes: ["a", "b"],
				anchor: "topLeft",
				value: dimension(px(50)),
			}),
		],
	);

test("a rule about a corner and a rule about a centre are two rules, and each gets its own point", async () => {
	const scene = twoAnchors();
	const atoms = await answer(scene);
	const facts = readSketchFacts(atoms);
	assert.deepEqual(facts.rules, ["c1", "c2"]);
	assert.equal(facts.anchors.get("c1"), "center");
	assert.equal(facts.anchors.get("c2"), "topLeft");

	const request = sketchRequest(scene, facts, readSolved(atoms), NO_CONTEXT);
	assert.ok(request);
	// `c1` is the lowest-id rule, so each node's *home* point — the one that
	// carries its frame and the one a pin would nail — is its centre. The corners
	// `c2` asks about are points of their own, and they are where the corners
	// actually are rather than where the centres are.
	assert.deepEqual(request.points, [
		{ node: "#anchor(a,topLeft)", x: 0, y: 0 },
		{ node: "#anchor(b,topLeft)", x: 30, y: 40 },
		{ node: "a", x: 20, y: 20 },
		{ node: "b", x: 80, y: 100 },
	]);
	// Held to their nodes by the node's own size, which is a constant: the linear
	// layer decided the box, so half of it is arithmetic and not an unknown.
	assert.deepEqual(request.links, [
		{ tag: "#link(a,topLeft)", from: "a", to: "#anchor(a,topLeft)", dx: -20, dy: -20 },
		{ tag: "#link(b,topLeft)", from: "b", to: "#anchor(b,topLeft)", dx: -50, dy: -60 },
	]);
	// And each rule reads the points it asked for. This is the assertion the old
	// encoding failed: `c2` named `a` and `b`, the centres.
	assert.deepEqual(request.rules, [
		{ tag: "c1", kind: "bearing", a: "a", b: "b", deg: 90 },
		{
			tag: "c2",
			kind: "distance",
			a: "#anchor(a,topLeft)",
			b: "#anchor(b,topLeft)",
			px: 50,
		},
	]);
});

test("...and PlaneGCS then solves both, each about its own anchor", async () => {
	// Through the real library, because the claim is about what comes out and not
	// about what goes in. The document starts satisfying `c2` and not `c1`, so a
	// solve that changed nothing would pass the corner assertion by luck.
	const scene = twoAnchors();
	const atoms = await answer(scene);
	const facts = readSketchFacts(atoms);
	const solved = readSolved(atoms);
	const request = sketchRequest(scene, facts, solved, NO_CONTEXT);
	assert.ok(request);

	const sketcher = await openSketcher();
	const outcome = sketcher.solve(request);
	sketcher.close();
	assert.equal(outcome.status, "settled");
	if (outcome.status !== "settled") return;

	const back = sketchSolved(outcome, facts, scene, solved, NO_CONTEXT);
	// The extra points are the same node said twice, so they never reach the
	// document: a key here is a node the design contains.
	assert.deepEqual(Object.keys(back).sort(), ["a", "b"]);

	// Neither node is nested, so local is world and the frames can be measured
	// straight off. Sizes are the document's, which is the point: the sketch layer
	// moves a box and never resizes one.
	const boxOf = (id: string, w: number, h: number) => ({
		x: back[id].x ?? 0,
		y: back[id].y ?? 0,
		width: px(w),
		height: px(h),
	});
	const a = boxOf("a", 40, 40);
	const b = boxOf("b", 100, 120);

	// `c2`, about the corners: 50px apart, the length it asked for.
	const corner = {
		x: anchorPoint(b, "topLeft").x - anchorPoint(a, "topLeft").x,
		y: anchorPoint(b, "topLeft").y - anchorPoint(a, "topLeft").y,
	};
	assert.ok(
		Math.abs(Math.hypot(corner.x, corner.y) / P - 50) < 0.01,
		`corners ${Math.hypot(corner.x, corner.y) / P}px apart, wanted 50`,
	);

	// `c1`, about the centres: straight down, the bearing it asked for. Under the
	// old encoding both rules were measured here, and the corners came out 95px
	// apart — a document nobody asked for, with both rows green.
	const middle = {
		x: anchorPoint(b, "center").x - anchorPoint(a, "center").x,
		y: anchorPoint(b, "center").y - anchorPoint(a, "center").y,
	};
	assert.ok(Math.abs(middle.x) / P < 0.01, `centres ${middle.x / P}px off the vertical`);
	assert.ok(middle.y > 0, "and below rather than above");
});

/* ------------------------------------------------------------------ */
/* 5. Why a rule cannot be about a member                              */
/* ------------------------------------------------------------------ */

const distanceTo = (member: string, extra: Partial<Constraint> = {}): Constraint =>
	rule({
		id: "apart",
		kind: "distance",
		nodes: ["card", member],
		value: dimension(px(40)),
		...extra,
	});

test("a datum is a line, so it is not a point", () => {
	const scene = scened([at("card", { x: 0, y: 0, w: 100, h: 60 })]);
	const why = refusedAnchor(scene, distanceTo("cg(page,3,left)"), "cg(page,3,left)");
	assert.ok(why);
	assert.match(why, /is a line on the canvas, not a box/);
	// Named off the kind's own label rather than spelled once for all three, so a
	// `bearing` or an `In a line` about a column line does not report itself as a
	// distance.
	assert.match(why, /Distance is measured between points/);
	assert.match(
		refusedAnchor(
			scene,
			rule({ id: "way", kind: "bearing", nodes: ["card", "cg(page,3,left)"] }),
			"cg(page,3,left)",
		) ?? "",
		/Bearing is measured between points/,
	);
});

test("a copy has nowhere to keep a starting point", () => {
	const scene = scened([
		at("def", { x: 0, y: 0, w: 200, h: 200 }, {
			kind: "frame",
			children: [at("label", { x: 0, y: 0, w: 40, h: 20 })],
		}),
	]);
	for (const member of [
		"stt(b1,hover,label)",
		"kfr(b1,slide,trkd(label,y),2)",
		"inst(b1,label)",
	]) {
		const why = refusedAnchor(scene, distanceTo(member), member);
		assert.ok(why, member);
		assert.match(why, /a sketch rule starts from a point you can drag/);
		assert.match(why, /“label”/, "and it names the part rather than the term");
	}
});

test("a rule whose member is a copy of this node placed none of it", () => {
	// The Inspector's "Placed by a sketch rule" rows name the rules that decided a
	// coordinate, and a rule that named `stt(b1,hover,label)` decided none of
	// `label`'s: that member is `sknopoint/1`, it holds no point, and the panel
	// crediting it would send a designer to edit a rule they could edit forever
	// without moving the layer. The reduction `constraintMemberNode` performs is
	// right for a linear rule and wrong for this one, which is why the question is
	// asked through `refusedAnchor`'s twin rather than through the reduction.
	const label = at("label", { x: 0, y: 0, w: 40, h: 20 });
	const card = at("card", { x: 300, y: 0, w: 100, h: 60 });
	const def = at("def", { x: 0, y: 0, w: 200, h: 200 }, {
		kind: "frame",
		children: [label],
	});
	const withMembers = (nodes: string[], extra: Partial<Constraint> = {}): Scene =>
		scened([def, card], [
			rule({
				id: "apart",
				kind: "distance",
				nodes,
				value: dimension(px(40)),
				...extra,
			}),
		]);

	for (const copy of [
		"stt(b1,hover,label)",
		"kfr(b1,slide,trkd(label,y),2)",
		"inst(b1,label)",
	]) {
		const scene = withMembers(["card", copy]);
		assert.deepEqual(sketchPlacers(scene, label), [], copy);
		// ...while the member that *is* a node still is one, so the rule is not
		// simply being dropped.
		assert.deepEqual(
			sketchPlacers(scene, card).map((c) => c.id),
			["apart"],
			copy,
		);
	}

	// The other refusal with a member that *is* the node: a turned box asked for a
	// corner is `skoffcentre/1`, so the program holds no point for it and the rule
	// placed nothing here either. The same rule about the centre did.
	const spun = at("card", { x: 300, y: 0, w: 100, h: 60 }, {
		turn: { rotateZ: single("30deg") },
	});
	const cornered = scened([spun], [
		rule({
			id: "apart",
			kind: "distance",
			nodes: ["card", "label"],
			anchor: "topLeft",
			value: dimension(px(40)),
		}),
	]);
	assert.deepEqual(sketchPlacers(cornered, spun), []);
	assert.deepEqual(
		sketchPlacers(
			{
				...cornered,
				constraints: cornered.constraints.map((c) => ({ ...c, anchor: "center" as const })),
			},
			spun,
		).map((c) => c.id),
		["apart"],
	);

	// The rest of the filter, in the same breath: a switched-off rule places
	// nothing, and neither does a kind the other solver decides.
	assert.deepEqual(
		sketchPlacers(withMembers(["card", "label"], { enabled: false }), card),
		[],
	);
	const linear = scened([def, card], [
		rule({ id: "flush", kind: "align", nodes: ["card", "label"], edge: "left" }),
	]);
	assert.deepEqual(sketchPlacers(linear, card), []);
});

test("a node a rule invented is refused by the whitelist, not by a list of shapes", () => {
	// The door an enumeration cannot close. `node(cell(R,C)) :- pos(R), pos(C).` is
	// a documented thing to write, and such a node has no layer to drag and nowhere
	// to keep an aim — so it is a node and it is not a point.
	const scene = scened([at("card", { x: 0, y: 0, w: 100, h: 60 })]);
	const why = refusedAnchor(scene, distanceTo("cell(1,1)"), "cell(1,1)");
	assert.ok(why);
	assert.match(why, /comes from a rule rather than from the document/);
});

test("a turned box keeps its centre and loses its corners", () => {
	// The refusal with no other reader anywhere: `inertMembers` returns `[]` for an
	// edgeless kind, so without this a `distance` on `topLeft` between a card
	// turned 30° and another node would hold a point the picture does not contain —
	// the rule satisfied, the drawing disagreeing, and no mark or sentence at all.
	const scene = scened([
		at("card", { x: 0, y: 0, w: 100, h: 60 }, { turn: { rotateZ: single("30deg") } }),
		at("badge", { x: 200, y: 40, w: 40, h: 40 }),
	]);
	const corner = distanceTo("badge", { anchor: "topLeft" });
	const why = refusedAnchor(scene, corner, "card");
	assert.ok(why);
	assert.match(why, /turned 30° about Z/);
	assert.match(why, /has no top-left corner where the design says it has one/);
	assert.match(why, /Move them all to the centre, or take the turn off/);
	// The other member is not turned, so it is not refused...
	assert.equal(refusedAnchor(scene, corner, "badge"), undefined);
	// ...and a document holding *only* the centre rule keeps both, because a turn
	// about the centre moves no linear quantity. That is the decision the whole
	// rotation feature rests on.
	const middle = distanceTo("badge", { anchor: "center" });
	assert.equal(refusedAnchor(scene, middle, "card"), undefined);
	assert.equal(refusedAnchor(scene, distanceTo("badge"), "card"), undefined);
});

/**
 * The half the sentence above used to get wrong, and it got it wrong in the
 * direction that leaves no mark at all.
 *
 * `skoffcentre(N) :- grotated(N), skcon(C), c_node(C,N), c_anchor(C,A), A !=
 * center.` quantifies C existentially, so the corner rule withholds `card`'s
 * point from *every* sketch rule naming it. The centre rule beside it is dead
 * too — and it used to be told it was fine, which is the one answer worse than
 * silence, because the panel then showed it green while it governed nothing.
 */
test("one corner rule takes the centre rule down with it", () => {
	const corner = distanceTo("badge", { id: "corner", anchor: "topLeft" });
	const middle = distanceTo("badge", { id: "middle", anchor: "center" });
	const nodes = [
		at("card", { x: 0, y: 0, w: 100, h: 60 }, { turn: { rotateZ: single("30deg") } }),
		at("badge", { x: 200, y: 40, w: 40, h: 40 }),
	];

	// The centre rule alone: nothing is refused, exactly as before.
	assert.equal(refusedAnchor(scened(nodes, [middle]), middle, "card"), undefined);

	// The two together: the centre rule is refused, and the sentence names the
	// rule actually responsible rather than blaming the one being asked about.
	const both = scened(nodes, [corner, middle]);
	const why = refusedAnchor(both, middle, "card");
	assert.ok(why);
	assert.match(why, /this rule asks about its centre/);
	assert.match(why, /“corner” asks for its top-left corner/);
	assert.match(why, /Move “corner” to the centre, or take the turn off/);
	// `badge` is not turned, so neither rule refuses it either way.
	assert.equal(refusedAnchor(both, middle, "badge"), undefined);
});

test("every refusal reaches a list a panel row can render", () => {
	// The gap this closes: `refusedAnchor` answers about one member, which is the
	// question `sketchPlacers` asks, and a Rules row asks the other one — what does
	// this rule fail to say, and about whom. Until `refusedMembers` existed the
	// only caller used the sentence as a boolean and threw the string away, so all
	// four of these were reachable code that no reader could ever reach.
	const scene = scened([
		at("card", { x: 0, y: 0, w: 100, h: 60 }, { turn: { rotateZ: single("30deg") } }),
		at("badge", { x: 200, y: 40, w: 40, h: 40 }),
		at("def", { x: 0, y: 300, w: 200, h: 200 }, {
			kind: "frame",
			children: [at("label", { x: 0, y: 0, w: 40, h: 20 })],
		}),
	]);
	const said = (c: Constraint) =>
		refusedMembers(scene, c).map((found) => [found.constraint, found.member]);

	// The turn, which is the case with no other reader in the tree at all.
	assert.deepEqual(said(distanceTo("badge", { anchor: "topLeft" })), [
		["apart", "card"],
	]);
	// ...and the three the whitelist and the copy terms account for. `card` is
	// turned and every one of these asks for the default anchor, so the only
	// refusal in each is the member under test.
	assert.deepEqual(said(distanceTo("cg(page,3,left)")), [
		["apart", "cg(page,3,left)"],
	]);
	assert.deepEqual(said(distanceTo("stt(b1,hover,label)")), [
		["apart", "stt(b1,hover,label)"],
	]);
	assert.deepEqual(said(distanceTo("cell(1,1)")), [["apart", "cell(1,1)"]]);

	// The sentence itself is carried through rather than replaced, because it is
	// the whole point of the exercise: the row shows what `refusedAnchor` wrote.
	const corner = distanceTo("badge", { anchor: "topLeft" });
	assert.equal(
		refusedMembers(scene, corner)[0].why,
		refusedAnchor(scene, corner, "card"),
	);

	// Two refused members are two sentences, for `inertMembers`'s reason: two
	// members turned two different ways are two different reasons and one line
	// would have to pick one.
	assert.equal(
		refusedMembers(
			scene,
			rule({
				id: "row",
				kind: "collinear",
				nodes: ["card", "cg(page,3,left)", "badge"],
				anchor: "topLeft",
			}),
		).length,
		2,
	);
	// A member named twice is one refusal, though: the reason is about the member
	// and it has not changed between the two slots.
	assert.deepEqual(said(distanceTo("card", { anchor: "topLeft" })), [
		["apart", "card"],
	]);

	// And nothing where nothing is refused — a row with no note on it, which is
	// every well-formed sketch rule and every linear rule ever written.
	assert.deepEqual(refusedMembers(scene, distanceTo("badge")), []);
	assert.deepEqual(
		refusedMembers(
			scene,
			rule({ id: "flush", kind: "align", nodes: ["card", "badge"], edge: "left" }),
		),
		[],
	);
});

test("a refused member really does silence the rule, which is what earns the row its mark", async () => {
	// The claim the panel makes by marking the row inert, checked against the
	// program rather than asserted: `sknopoint/1` withholds the point, the member
	// never reaches `sksolved/1`, `sketchRequest` filters it out of the rule's
	// members, and a `distance` left holding one member builds no `p2p_distance`
	// at all. So the rule governs nothing — and before this fix it said so
	// nowhere, because `inertMembers` has no edge to key the sentence by.
	const scene = scened(
		[
			at("card", { x: 0, y: 0, w: 100, h: 60 }, { turn: { rotateZ: single("30deg") } }),
			at("badge", { x: 200, y: 40, w: 40, h: 40 }),
		],
		[
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["card", "badge"],
				anchor: "topLeft",
				value: dimension(px(120)),
			}),
		],
	);
	const atoms = await answer(scene);
	const facts = readSketchFacts(atoms);
	assert.ok(facts.rules.includes("apart"), "the rule is on");
	assert.ok(!facts.solved.has("card"), "and holds no point for the turned member");
	const request = sketchRequest(scene, facts, readSolved(atoms), NO_CONTEXT);
	assert.deepEqual(request?.rules ?? [], [], "so nothing is asked of PlaneGCS");

	// The two halves of the panel's one block: the linear reader has nothing, and
	// the sketch reader has the sentence.
	assert.deepEqual(inertMembers(scene, scene.constraints[0]), []);
	const refused = refusedMembers(scene, scene.constraints[0]);
	assert.equal(refused.length, 1);
	assert.equal(refused[0].member, "card");
	assert.match(refused[0].why, /turned 30° about Z/);
});

test("a linear kind is refused nothing here, because it reads an edge and not a point", () => {
	const scene = scened([
		at("card", { x: 0, y: 0, w: 100, h: 60 }, { turn: { rotateZ: single("30deg") } }),
	]);
	const align = rule({
		id: "flush",
		kind: "align",
		nodes: ["card"],
		edge: "left",
	});
	assert.equal(refusedAnchor(scene, align, "card"), undefined);
	// The table decides, not the flag: exactly one of `edges` and `anchors` is
	// non-empty on every kind that has a subject at all.
	assert.equal(CONSTRAINT_KINDS.align.anchors.length, 0);
	assert.ok(CONSTRAINT_KINDS.distance.anchors.length > 0);
});

/* ------------------------------------------------------------------ */
/* 6. What shipped already, verified rather than edited                */
/* ------------------------------------------------------------------ */

test("inertMembers says nothing about an edgeless kind, which is why refusedAnchor exists", () => {
	// `spatial.ts` returns `[]` the moment `constraint.edge` is undefined, and a
	// sketch kind has `edges: []` so it never has one. That early return is cited
	// as the reason `spatial.ts` needs no edit, which is true of the *edge* refusal
	// and false of the *turn* refusal — so it is checked here rather than believed.
	const scene = scened([
		at("card", { x: 0, y: 0, w: 100, h: 60 }, { turn: { rotateZ: single("30deg") } }),
		at("badge", { x: 200, y: 40, w: 40, h: 40 }),
	]);
	assert.deepEqual(
		inertMembers(scene, distanceTo("badge", { anchor: "topLeft" })),
		[],
	);
	// ...while the same turned node under a linear kind is still reported, so the
	// emptiness above is about the kind and not about the document.
	assert.equal(
		inertMembers(
			scene,
			rule({ id: "flush", kind: "align", nodes: ["card", "badge"], edge: "left" }),
		).length,
		1,
	);
});

test("a rule across a viewport wall is warned about, whatever kind it is", () => {
	// `crossesViewport` reads members and not an edge, so it answers for a sketch
	// rule with no edit at all — which is the whole of this track's claim on that
	// file.
	const scene = scened([
		at("art", { x: 0, y: 0, w: 600, h: 400 }, {
			kind: "frame",
			children: [
				at("hero", { x: 0, y: 0, w: 300, h: 300 }, {
					kind: "viewport",
					name: "Hero",
					children: [at("cube", { x: 0, y: 0, w: 50, h: 50 }, { kind: "mesh" })],
				}),
				at("card", { x: 320, y: 0, w: 100, h: 60 }, { name: "Card" }),
			],
		}),
	]);
	const across = crossesViewport(scene, ["card", "cube"]);
	assert.ok(across);
	assert.match(across, /inside the 3D view “Hero”/);
	assert.equal(crossesViewport(scene, ["card"]), undefined);
});

test("a sketch rule pins a definition part, exactly as a linear one does", () => {
	// `machines.ts` filters on `spec.geometric`, which is true of both engines —
	// and it is correct unchanged, because naming a part in a sketch rule is still
	// what hands its place over and a part whose place is decided per state still
	// needs a copy per state.
	const scene: Scene = {
		...scened([
			at("def", { x: 0, y: 0, w: 200, h: 200 }, {
				kind: "frame",
				component: true,
				children: [at("label", { x: 0, y: 0, w: 40, h: 20 })],
			}),
		]),
		machines: [
			{
				id: "m1",
				name: "M",
				root: "def",
				states: [{ id: "rest", name: "Rest", parts: {} }],
				transitions: [],
			},
		],
	};
	const geometric: Scene = {
		...scene,
		constraints: [
			rule({
				id: "apart",
				kind: "distance",
				nodes: ["label", "def"],
				value: dimension(px(40)),
			}),
		],
	};
	assert.ok(
		materializedParts(geometric, geometric.machines[0]).has("label"),
		"a part a sketch rule names has to be placeable per state",
	);
});
