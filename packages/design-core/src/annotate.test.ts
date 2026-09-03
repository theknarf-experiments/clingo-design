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

import {
	type Annotation,
	type AxialAnnotation,
	type RayAnnotation,
	annotate,
} from "./annotate.ts";
import { directSolver } from "./directSolver.ts";
import { addConstraint, addNode, makeNode, updateConstraint } from "./edits.ts";
import { explore } from "./explore.ts";
import type { Frame } from "./geometry.ts";
import {
	type Constraint,
	type Guide,
	type GuideProp,
	type Scene,
	type SceneNode,
	dimension,
	emptyScene,
	lineDatum,
	makeGuides,
	sceneContext,
	trackDatum,
} from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, single } from "./values.ts";

/**
 * A mark's coordinates are EMU, so the numbers a person would say have to be
 * multiplied to be asserted at all. Written this way round — `128 * P` rather
 * than 1219200 — because what is being checked is the pixel arithmetic, and a
 * seven-digit constant nobody can divide in their head would hide it.
 */
const P = EMU_PER_PX;

/** Boxes given in pixels, since that is how the cases below read. */
const loose = (...boxes: Array<[string, number, number, number, number]>): Scene => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	for (const [id, x, y, width, height] of boxes) {
		scene = addNode(
			scene,
			makeNode(
				"rect",
				{ x: x * P, y: y * P, width: width * P, height: height * P },
				{ id },
			),
		);
	}
	return scene;
};

const on = (ids: string[]) => new Set(ids);

/**
 * The mark this case is about, narrowed to the two shapes that are about an
 * axis.
 *
 * Every assertion in the linear half reads `at`, `from` or `to`, and a ray has
 * none of them — which is the whole point of the union. Saying so here makes
 * the narrowing an assertion in its own right: a case that starts drawing rays
 * fails on the line that says what it expected rather than a dozen lines later
 * against an `undefined`.
 */
const axial = (note: Annotation | undefined): AxialAnnotation => {
	assert.ok(note, "there is a mark to read");
	if (note.shape === "ray") assert.fail(`expected an axial mark, got a ray`);
	return note;
};

/** The same, for a case that expects the sketch layer's one shape. */
const ray = (note: Annotation | undefined): RayAnnotation => {
	assert.ok(note, "there is a mark to read");
	if (note.shape !== "ray") assert.fail(`a sketch rule draws a ray, not a ${note.shape}`);
	return note;
};

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
		from: -8 * P,
		to: 128 * P,
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
			at: 10 * P,
			from: 40 * P,
			to: 100 * P,
			label: "60px",
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
		marks.map(axial).map((m) => [m.shape, m.from, m.to, m.label]),
		[
			["span", 0, 40 * P, "40px"],
			["span", 200 * P, 240 * P, "40px"],
		],
	);
});

test("a pin says which coordinate it is holding", () => {
	const scene = loose(["a", 30, 0, 40, 20]);
	const marks = annotate(
		addConstraint(scene, "pin", ["a"], undefined, "left").scene,
		on(["a"]),
	);
	assert.equal(marks[0].label, "30px", "the number is the whole point of a pin");
	assert.equal(axial(marks[0]).at, 30 * P);
});

test("a mirror is drawn where the members balance, not where the number says", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 300, 0, 60, 20]);
	const added = addConstraint(scene, "symmetric", ["a", "b"], undefined, "x");
	// Move the line without solving: the mark still reports the design as it
	// stands, which is what stops it lying about an unsolved document.
	const moved = updateConstraint(added.scene, added.id, {
		value: dimension(500 * P),
	});
	const marks = annotate(moved, on(["a"]));
	assert.equal(marks[0].shape, "line");
	assert.equal(axial(marks[0]).at, 175 * P, "halfway between the two centres");
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
	const held = updateConstraint(pinned.scene, pinned.id, {
		value: dimension(55 * P),
	});
	const constrained = addConstraint(held, "align", ["a", "b"], undefined, "left").scene;

	const result = await explore(constrained, directSolver, { sample: "first" });
	const solved = result.universes[0].solved;
	const line = annotate(constrained, on(["a"]), solved).find(
		(m) => m.kind === "align",
	);
	assert.equal(solved.a.x, 55 * P);
	assert.equal(axial(line).at, 55 * P, "where the solver put them, not where they were");
});

/* ------------------------------------------------------------------ */
/* Marks about a line nobody drew                                      */
/* ------------------------------------------------------------------ */

/**
 * A datum is the one member a designer cannot point at, so these are the marks
 * that carry the most and every one of them goes through the real solver. There
 * is no other honest way: the line a column stands on is in the answer set and
 * in nothing else, and working it out here would be the second implementation of
 * the track arithmetic that `annotate` refuses to hold.
 */

/** A page ruled into `columns`, with one card inside it. */
const ruled = (
	grid: Partial<Record<GuideProp, string | number>>,
	card: [number, number, number, number] = [0, 40, 100, 100],
	lines?: Guide[],
): Scene => {
	const [x, y, width, height] = card;
	const inside: SceneNode = makeNode(
		"rect",
		{ x: x * P, y: y * P, width: width * P, height: height * P },
		{ id: "card" },
	);
	const page: SceneNode = {
		...makeNode("frame", { x: 0, y: 0, width: 960 * P, height: 640 * P }, {
			id: "page",
		}),
		children: [inside],
		guides: makeGuides(grid),
		...(lines ? { lines } : {}),
	};
	return { ...emptyScene(), nodes: [page], constraints: [] };
};

/** The same rule shape the datum tests use: a member list with a datum in it. */
const holding = (
	scene: Scene,
	kind: Constraint["kind"],
	nodes: string[],
	edge: Constraint["edge"],
	value?: Constraint["value"],
): Scene => ({
	...scene,
	constraints: [
		{ id: "held", kind, prop: "fill", nodes, edge, enabled: true, ...(value ? { value } : {}) },
	],
});

const solveOnce = async (scene: Scene): Promise<Record<string, Partial<Frame>>> => {
	const result = await explore(scene, directSolver, { sample: "first" });
	return result.universes[0].solved;
};

test("a card held to a column draws the column, the length of the page", async () => {
	// The mark this whole section exists for. Four columns of 240 across a 960
	// page, so column three begins at 480 — and with nothing beside it, a card at
	// 480 looks like a card somebody dragged there.
	const scene = holding(
		ruled({ columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 }),
		"align",
		["card", trackDatum("page", 3, "left")],
		"left",
	);
	const solved = await solveOnce(scene);
	const marks = annotate(scene, on(["card"]), solved);
	assert.deepEqual(marks, [
		{
			constraint: "held",
			kind: "align",
			shape: "line",
			axis: "x",
			at: 480 * P,
			// Across the page rather than across the card: the band is what says
			// this is a line of the page, and a line the height of the card beside
			// it would read as a coincidence.
			from: -8 * P,
			to: 648 * P,
		},
	]);
});

test("the line drawn is the line the answer set reported, to the EMU", async () => {
	// The invariant the feature rests on: the coordinate the overlay draws, the
	// coordinate a rule names and the coordinate the solver returned are one
	// number from one solve. So the mark is checked against `solved` itself rather
	// than against 490 worked out on this side.
	const scene = holding(
		// 960 less 60 either side, four tracks with 20 between them: w = 195, so
		// column three begins at 60 + 2*215 = 490.
		ruled({ columns: 4, gutter: 20, marginLeft: 60, marginRight: 60 }),
		"align",
		["card", trackDatum("page", 3, "left")],
		"left",
	);
	const solved = await solveOnce(scene);
	const datum = solved[trackDatum("page", 3, "left")];
	assert.equal(datum.x, 490 * P, "the solver's own answer, not a recomputation");
	assert.equal(axial(annotate(scene, on(["card"]), solved)[0]).at, datum.x);
});

test("a gap from a column line measures from the line", async () => {
	const scene = holding(
		ruled({ columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 }, [0, 0, 60, 60]),
		"gap",
		[trackDatum("page", 2, "right"), "card"],
		"x",
		single("16px"),
	);
	const solved = await solveOnce(scene);
	const marks = annotate(scene, on(["card"]), solved);
	assert.equal(marks.length, 1);
	const mark = axial(marks[0]);
	assert.deepEqual(
		[mark.shape, mark.from, mark.to, mark.label],
		// Column two of four ends at 480, and the card begins sixteen past it.
		["span", 480 * P, 496 * P, "16px"],
	);
	// Between the two centres, and one of those centres is the page's, because a
	// column line is as tall as the page it rules.
	assert.equal(mark.at, ((320 + 30) / 2) * P);
});

test("a hand-drawn guide draws itself the same way a column does", async () => {
	// Nothing in the mark knows which of the two it is looking at, which is the
	// point of a datum being one thing: `gl(page,g1)` and `cg(page,3,left)` are
	// both a place on an axis and both come back under their own term.
	const scene = holding(
		ruled({}, [0, 0, 60, 60], [{ id: "g1", axis: "y", at: single("220px") }]),
		"align",
		["card", lineDatum("page", "g1")],
		"top",
	);
	const solved = await solveOnce(scene);
	const marks = annotate(scene, on(["card"]), solved);
	assert.equal(marks.length, 1);
	const mark = axial(marks[0]);
	assert.equal(mark.axis, "y");
	assert.equal(mark.at, 220 * P);
	// Across the page's width this time — the band is the surface's extent on
	// whichever axis the datum is not about, and no axis is named to get there.
	assert.deepEqual([mark.from, mark.to], [-8 * P, 968 * P]);
});

test("nothing is drawn for a column nobody has placed yet", async () => {
	// The document holds the grid's *settings*, not its lines, so an unsolved
	// document has no line to draw and says so by drawing none. Working one out
	// here would be a second implementation of the track equation, and two answers
	// to one question drift — which is exactly the thing the feature was shaped
	// around not having.
	const scene = holding(
		ruled({ columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 }),
		"align",
		["card", trackDatum("page", 3, "left")],
		"left",
	);
	assert.deepEqual(annotate(scene, on(["card"]), {}), []);
	// And with an answer in hand it draws, so the emptiness above is about the
	// answer and not about the member.
	assert.equal(annotate(scene, on(["card"]), await solveOnce(scene)).length, 1);
});

test("a rule about the other axis draws nothing, because it states nothing", async () => {
	// A column line has equations on one axis. An `align` on `top` against one
	// grounds a free variable, so the rule says nothing at all — and a mark for it
	// would be the canvas claiming a rule is doing work that it is not.
	const scene = holding(
		ruled({ columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 }),
		"align",
		["card", trackDatum("page", 3, "left")],
		"top",
	);
	const solved = await solveOnce(scene);
	assert.ok(solved[trackDatum("page", 3, "left")], "the line itself was placed");
	assert.deepEqual(annotate(scene, on(["card"]), solved), []);
});

test("a column that exists in the other universe is not drawn in this one", async () => {
	// The trap `lines.ts` names, asked of the *other* reader. clingo-lpx reports
	// a value for every theory variable in the ground program, so in the
	// four-column universe of a responsive grid `lv(cg(page,5,left))` comes back
	// all the same — at zero, because nothing constrained it. Reading `solved`
	// for the term would draw an alignment mark on the near margin for a rule
	// that correctly moved nothing, which is the canvas inventing a design.
	//
	// Both halves are asserted from one document, because "draws nothing" is only
	// the right answer if the same call draws the mark where the column is real.
	const grid = { gutter: 0, marginLeft: 0, marginRight: 0 };
	const base = ruled(grid, [700, 0, 60, 60]);
	const scene = holding(
		{
			...base,
			nodes: [
				{
					...base.nodes[0],
					guides: { ...makeGuides(grid), columns: [lit("4"), lit("6")] },
				},
			],
		},
		"align",
		["card", trackDatum("page", 5, "left")],
		"left",
	);
	const result = await explore(scene, directSolver);
	assert.equal(result.count, 2, "two counts are two grids and two designs");

	const drawn = result.universes.map((u) => ({
		card: (u.solved.card.x ?? 0) / P,
		marks: annotate(scene, on(["card"]), u.solved, sceneContext(scene, u.pick)),
	}));

	const narrow = drawn.find((d) => d.card === 700);
	assert.ok(narrow, "four columns leave the card where the document put it");
	assert.equal(
		(result.universes.find((u) => (u.solved.card.x ?? 0) / P === 700)?.solved[
			trackDatum("page", 5, "left")
		]?.x ?? -1),
		0,
		"the phantom really is in the answer set, sitting at the origin",
	);
	assert.deepEqual(narrow.marks, [], "and no mark is made out of it");

	const wide = drawn.find((d) => d.card === 640);
	assert.ok(wide, "six columns pull the card onto column five, at 640");
	assert.equal(wide.marks.length, 1);
	assert.equal(axial(wide.marks[0]).at, 640 * P);
});

test("a datum on a surface the document no longer holds draws nothing", () => {
	// `holdsDatum` keeps such a rule rather than deleting it, so annotate is where
	// it has to come to nothing — the same silence a rule whose nodes were deleted
	// already draws.
	const scene = holding(
		ruled({ columns: 4 }),
		"align",
		["card", trackDatum("gone", 3, "left")],
		"left",
	);
	assert.deepEqual(annotate(scene, on(["card"]), { "cg(gone,3,left)": { x: 0 } }), []);
});

/* ------------------------------------------------------------------ */
/* Marks for the rules the second solver decides                       */
/* ------------------------------------------------------------------ */

/**
 * The sketch layer has no edge, so it has no axis, no `at` and no band — and
 * the reason these cases exist at all is that the loop above would have thrown
 * every one of them away at `if (!edge) continue`, silently, while still
 * typechecking. Each of them asserts a mark comes back before it asserts
 * anything about the mark.
 */

/** A sketch rule over the given nodes, with an anchor if one is named. */
const sketch = (
	scene: Scene,
	kind: Constraint["kind"],
	nodes: string[],
	anchor?: Constraint["anchor"],
): Scene => {
	const added = addConstraint(scene, kind, nodes);
	return anchor ? updateConstraint(added.scene, added.id, { anchor }) : added.scene;
};

test("a distance draws the line it measures, between the two points it is about", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 100, 0, 40, 20]);
	const marks = annotate(sketch(scene, "distance", ["a", "b"]), on(["a"]));
	assert.equal(marks.length, 1, "an edgeless kind is not dropped for having no edge");
	const drawn = ray(marks[0]);
	// Centre to centre, because `center` is the anchor a rule means when nobody
	// said — and a hundred pixels apart, which is the number on the mark.
	assert.deepEqual([drawn.a, drawn.b], [
		{ x: 20 * P, y: 10 * P },
		{ x: 120 * P, y: 10 * P },
	]);
	assert.equal(drawn.label, "100px");
});

test("the ray is drawn between the anchors the rule names, not between the centres", () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 100, 0, 40, 20]);
	const drawn = ray(annotate(sketch(scene, "distance", ["a", "b"], "topLeft"), on(["a"]))[0]);
	assert.deepEqual([drawn.a, drawn.b], [
		{ x: 0, y: 0 },
		{ x: 100 * P, y: 0 },
	]);
	// The corners are a hundred apart the same way the centres were, which is
	// what makes this case about the anchor and not about the arithmetic.
	assert.equal(drawn.label, "100px");
});

test("a bearing says which way, in degrees, and not how far", () => {
	// Straight down the page. Clockwise from due east with y growing downwards,
	// that is 90 degrees — the same convention the seed is written in, so an
	// untouched rule and its mark agree.
	const scene = loose(["a", 0, 0, 40, 20], ["b", 0, 100, 40, 20]);
	const drawn = ray(annotate(sketch(scene, "bearing", ["a", "b"]), on(["b"]))[0]);
	assert.equal(drawn.label, "90deg");
	assert.deepEqual([drawn.a, drawn.b], [
		{ x: 20 * P, y: 10 * P },
		{ x: 20 * P, y: 110 * P },
	]);
});

test("a line of three draws one ray, from the first point to the last", () => {
	// The line it asserts is the line it shows: a chain of segments would draw
	// the members' current zig-zag, which is the thing the rule is there to
	// deny. And no label, because three points being in a line is not a
	// quantity — there is no number to put on it.
	const scene = loose(["a", 0, 0, 40, 20], ["b", 100, 40, 40, 20], ["c", 200, 100, 40, 20]);
	const marks = annotate(sketch(scene, "collinear", ["a", "b", "c"]), on(["b"]));
	assert.equal(marks.length, 1);
	const drawn = ray(marks[0]);
	assert.deepEqual([drawn.a, drawn.b], [
		{ x: 20 * P, y: 10 * P },
		{ x: 220 * P, y: 110 * P },
	]);
	assert.equal(drawn.label, undefined);
});

test("a sketch rule a member short of saying anything draws nothing", () => {
	// The same `minNodes` silence the linear half keeps, reached the same way: a
	// member the tree does not hold simply does not arrive.
	const scene = loose(["a", 0, 0, 40, 20], ["b", 100, 0, 40, 20], ["c", 200, 0, 40, 20]);
	const three = sketch(scene, "collinear", ["a", "b", "c"]);
	const gone: Scene = { ...three, nodes: three.nodes.filter((n) => n.id !== "c") };
	assert.deepEqual(annotate(gone, on(["a"])), []);
	assert.equal(annotate(three, on(["a"])).length, 1, "and draws once all three are there");
});

test("a ray follows the solved geometry, like every other mark here", () => {
	// The claim in this file's header, asked of the shape that was added last:
	// the second solver moves a point and the mark is at the point it moved to,
	// not at the one the document still stores.
	const scene = sketch(loose(["a", 0, 0, 40, 20], ["b", 100, 0, 40, 20]), "distance", [
		"a",
		"b",
	]);
	const drawn = ray(annotate(scene, on(["a"]), { b: { x: 300 * P, y: 0 } })[0]);
	assert.equal(drawn.b.x, 320 * P);
	assert.equal(drawn.label, "300px");
});
