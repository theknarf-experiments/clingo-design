/**
 * A guide, once it reaches the solver.
 *
 * `guides.test.ts` is about what the document holds; this is about what clingo
 * does with it, and every case goes through the real solver, because the whole
 * claim of the feature is that a column line is a quantity the *existing*
 * geometric machinery can name. An assertion against arithmetic done in
 * TypeScript would be a test of a second implementation, which is precisely the
 * thing the design refused to build.
 *
 * The case the feature exists for is the first one: pin a card to column three,
 * change the count from four columns to six, and the card moves — with no edit
 * to the card, no edit to the rule, and nothing recomputing a position on this
 * side. Everything after it is the ways that must keep being true.
 *
 * Written in pixels at both ends and EMU in the middle, the same seam
 * `geometric.test.ts` names: a 960-wide page cut into four is unreadable at
 * 9525 times the size, and a whole pixel is an exact whole multiple of 9525 in
 * either direction, so nothing here is rounded to make an assertion fit.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { makeNode } from "./edits.ts";
import { explore } from "./explore.ts";
import type { Frame } from "./geometry.ts";
import {
	type Constraint,
	type Guide,
	type GuideProp,
	type Scene,
	type SceneNode,
	emptyScene,
	makeGuides,
	trackDatum,
} from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { type Token, lit, ref, single } from "./values.ts";

const P = EMU_PER_PX;
const px = (n: number): number => n * P;

type Solved = Readonly<Record<string, Partial<Frame>>>;

/** A solved coordinate, back in the pixels the case was written in. */
const at = (s: Solved, id: string, dim: keyof Frame): number =>
	(s[id][dim] ?? 0) / P;

const empty = (): Scene => ({ ...emptyScene(), nodes: [], constraints: [] });

const box = (
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	extra: Partial<SceneNode> = {},
): SceneNode => ({
	...makeNode("rect", { x: px(x), y: px(y), width: px(width), height: px(height) }, { id }),
	...extra,
});

/** A surface, optionally ruled with a grid and carrying hand-drawn lines. */
const page = (
	spec: {
		id?: string;
		box?: [number, number, number, number];
		grid?: Partial<Record<GuideProp, string | number>>;
		lines?: Guide[];
		children?: SceneNode[];
	} = {},
): SceneNode => {
	const [x, y, w, h] = spec.box ?? [0, 0, 960, 640];
	return {
		...makeNode("frame", { x: px(x), y: px(y), width: px(w), height: px(h) }, {
			id: spec.id ?? "page",
		}),
		children: spec.children ?? [],
		...(spec.grid ? { guides: makeGuides(spec.grid) } : {}),
		...(spec.lines ? { lines: spec.lines } : {}),
	};
};

const rule = (
	id: string,
	kind: Constraint["kind"],
	nodes: string[],
	edge: Constraint["edge"],
): Constraint => ({ id, kind, prop: "fill", nodes, edge, enabled: true });

const scened = (nodes: SceneNode[], constraints: Constraint[] = [], tokens: Token[] = []): Scene => ({
	...empty(),
	nodes,
	constraints,
	tokens,
});

const solveAll = async (scene: Scene) => {
	const result = await explore(scene, directSolver);
	assert.equal(result.optimized, false, "a theory objective is not #minimize");
	return result;
};

const solve = async (scene: Scene): Promise<Solved> => {
	const result = await solveAll(scene);
	assert.equal(result.count, 1, "a fixed grid must not multiply the universes");
	return result.universes[0].solved;
};

/* ------------------------------------------------------------------ */
/* The whole point                                                     */
/* ------------------------------------------------------------------ */

test("a card pinned to column three moves when the column count changes", async () => {
	// 960 wide, no margins and no gutters, so the arithmetic is visible: four
	// columns of 240, and column three begins at 480.
	const design = (columns: number): Scene =>
		scened(
			[
				page({
					grid: { columns, gutter: 0, marginLeft: 0, marginRight: 0 },
					children: [box("card", 0, 40, 100, 100)],
				}),
			],
			[rule("pin_to_col", "align", ["card", trackDatum("page", 3, "left")], "left")],
		);

	const four = await solve(design(4));
	assert.equal(at(four, "card", "x"), 480, "column three of four begins at 480");

	// The only edit is the count. Nothing on this side recomputed a position,
	// nothing touched the card, nothing touched the rule.
	const six = await solve(design(6));
	assert.equal(at(six, "card", "x"), 320, "column three of six begins at 320");

	// And the card really did move rather than merely being read differently:
	// its stored frame says 0 in both documents, and the pull objective would
	// have left it there if the grid had said nothing.
	assert.notEqual(at(four, "card", "x"), at(six, "card", "x"));
});

test("the line a rule names is the line the answer reports", async () => {
	// The datum's own coordinate comes back as lv/2 under its own term, in the
	// surface's local coordinates — the same space a child's frame is in. That
	// is what lets an overlay draw the line, snapping measure to it and a rule
	// name it without three answers to one question.
	const solved = await solve(
		scened(
			[
				page({
					grid: { columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 },
					children: [box("card", 0, 40, 100, 100)],
				}),
			],
			[rule("pin_to_col", "align", ["card", trackDatum("page", 3, "left")], "left")],
		),
	);
	const datum = trackDatum("page", 3, "left");
	assert.equal(at(solved, datum, "x"), 480);
	// A zero-size box, which is what lets all six of its edges coincide and the
	// generic edge equation produce them for nothing.
	assert.equal(at(solved, datum, "width"), 0);
	assert.equal(at(solved, "card", "x"), at(solved, datum, "x"));
});

/* ------------------------------------------------------------------ */
/* The track equation                                                  */
/* ------------------------------------------------------------------ */

test("margins and gutters are part of the equation, not decoration", async () => {
	// 960 wide, 60 either side, four tracks with 20 between them:
	//   4w + 3*20 = 960 - 120  ->  w = 195
	// so column three begins at 60 + 2*(195+20) = 490 and ends at 685.
	const scene = scened(
		[
			page({
				grid: { columns: 4, gutter: 20, marginLeft: 60, marginRight: 60 },
				children: [box("a", 0, 0, 50, 50), box("b", 0, 0, 50, 50)],
			}),
		],
		[
			rule("left3", "align", ["a", trackDatum("page", 3, "left")], "left"),
			rule("right3", "align", ["b", trackDatum("page", 3, "right")], "left"),
		],
	);
	const solved = await solve(scene);
	assert.equal(at(solved, "a", "x"), 490);
	assert.equal(at(solved, "b", "x"), 685);
	// The track's own width, read out of the answer rather than out of a second
	// implementation: right minus left of the same track is what a column is.
	assert.equal(at(solved, "b", "x") - at(solved, "a", "x"), 195);
});

test("a track has three lines, so a card can be centred in a column", async () => {
	// The second thing anybody does with a grid, and it needs no rule of its own:
	// `align` forces the *same* edge on both members, and the datum answers the
	// same number whichever edge is named — so centerX against a track's centre
	// line is a card centred in the column.
	const solved = await solve(
		scened(
			[
				page({
					grid: { columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 },
					children: [box("card", 0, 0, 80, 40)],
				}),
			],
			[
				rule(
					"centred",
					"align",
					["card", trackDatum("page", 2, "centerX")],
					"centerX",
				),
			],
		),
	);
	// Column two of four spans 240..480, so its centre is 360 and an 80-wide
	// card centred on it starts at 320.
	assert.equal(at(solved, "card", "x"), 320);
	assert.equal(at(solved, "card", "x") + at(solved, "card", "width") / 2, 360);
});

test("a row grid is the column rule with a different fact", async () => {
	// Nothing in the equations names an axis: the settings table carries one and
	// the rule is written over it, which is what made rows worth having from the
	// start rather than "later".
	const solved = await solve(
		scened(
			[
				page({
					box: [0, 0, 960, 600],
					grid: { rows: 3, rowGutter: 0, marginTop: 0, marginBottom: 0 },
					children: [box("band", 0, 0, 100, 40)],
				}),
			],
			[rule("second_row", "align", ["band", trackDatum("page", 2, "top")], "top")],
		),
	);
	assert.equal(at(solved, "band", "y"), 200, "row two of three begins at 200");
});

test("gap measures from a column line as readily as from a node", async () => {
	// The claim the whole design rests on is that a datum supplies a quantity and
	// *nothing else changes*, so it has to be true of more than the one kind the
	// feature was demonstrated with. `gap` reads the first member's trailing edge
	// and the second member's leading one; both of a datum's are the line.
	const solved = await solve(
		scened(
			[
				page({
					grid: { columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 },
					children: [box("card", 0, 0, 60, 60)],
				}),
			],
			[
				{
					...rule("clear_of_col", "gap", [trackDatum("page", 2, "right"), "card"], "x"),
					value: single("16px"),
				},
			],
		),
	);
	// Column two of four ends at 480, and the card begins sixteen past it.
	assert.equal(at(solved, "card", "x"), 496);
});

test("a grid on a nested surface lands in the right place on the canvas", async () => {
	// A guide is in its surface's own local coordinates — the invariant the whole
	// document runs on — while `align` relates *world* edges. So the chain from
	// the datum up through its surface's ancestors has to be there, and it is the
	// one the geometry rules already build; the guide rules only seed it, because
	// gworld/2 is otherwise derived from gsolved alone and an unnamed surface has
	// none.
	const solved = await solve(
		scened(
			[
				page({
					id: "outer",
					box: [100, 0, 960, 640],
					children: [
						page({
							id: "inner",
							box: [40, 0, 480, 400],
							grid: { columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 },
						}),
						box("card", 0, 0, 60, 60),
					],
				}),
			],
			[rule("third", "align", ["card", trackDatum("inner", 3, "left")], "left")],
		),
	);
	// Four columns of 120 inside a surface 40 along, so the line is 280 into the
	// outer page — and the card, which is the outer page's child, agrees.
	assert.equal(at(solved, trackDatum("inner", 3, "left"), "x"), 240);
	assert.equal(at(solved, "card", "x"), 280);
});

test("a grid on a surface the solver placed follows the size it solved for", async () => {
	// The reason the arithmetic is in the theory rather than on this side. The
	// surface's width is an unknown here — a `pin` decides it — so a grid
	// computed from the stored frame would be a grid of the wrong page.
	const scene = scened(
		[
			page({
				box: [0, 0, 400, 400],
				grid: { columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 },
				children: [box("card", 0, 0, 50, 50)],
			}),
		],
		[
			{
				...rule("wide", "pin", ["page"], "width"),
				value: single(`${800}px`),
			},
			rule("third", "align", ["card", trackDatum("page", 3, "left")], "left"),
		],
	);
	const solved = await solve(scene);
	assert.equal(at(solved, "page", "width"), 800, "the pin decided the page");
	// Four columns of 200, not of the 100 the stored frame would have given.
	assert.equal(at(solved, "card", "x"), 400);
});

/* ------------------------------------------------------------------ */
/* Lines drawn by hand                                                 */
/* ------------------------------------------------------------------ */

test("a hand-drawn guide is a datum too, and it moves with its token", async () => {
	// A guide's place is a Value like a frame dimension, so it can name a token
	// — and then dragging the guide edits the token and everything pinned to the
	// guide follows. This is that claim, with the pick doing the dragging.
	const scene = scened(
		[
			page({
				lines: [{ id: "g1", axis: "x", at: [ref("fold")] }],
				children: [box("card", 0, 0, 60, 60)],
			}),
		],
		[rule("to_fold", "align", ["card", "gl(page,g1)"], "left")],
		[{ id: "fold", name: "Fold", type: "length", value: [lit("240px"), lit("360px")] }],
	);
	const result = await solveAll(scene);
	assert.equal(result.count, 2, "a token with two lengths is two designs");
	const places = result.universes
		.map((u) => (u.solved.card.x ?? 0) / P)
		.sort((a, b) => a - b);
	assert.deepEqual(places, [240, 360]);
});

test("a guide whose place reads as no length takes the origin", async () => {
	// The same answer `frame/3` defaults to and the same answer `guideAt` gives,
	// so the line the overlay draws and the line a rule names stay the same line.
	// "1.5px" is 14287.5 EMU and 9525 is odd, so it is not a length at all.
	const solved = await solve(
		scened(
			[
				page({
					lines: [{ id: "g1", axis: "y", at: single("1.5px") }],
					children: [box("card", 0, 300, 60, 60)],
				}),
			],
			[rule("to_line", "align", ["card", "gl(page,g1)"], "top")],
		),
	);
	assert.equal(at(solved, "card", "y"), 0);
});

/* ------------------------------------------------------------------ */
/* What must not happen                                                */
/* ------------------------------------------------------------------ */

test("a datum is never handed to the solver as a node", async () => {
	// The failure this guard exists for: `gsolved` fires on any member of a
	// geometric constraint, and a datum has no frame/3 — so its gd(D,A) would
	// enter the shared &minimize with nothing bounding it from below, and an
	// unbounded objective is not a wrong picture, it is no answer at all.
	const datum = trackDatum("page", 2, "left");
	const scene = scened(
		[
			page({
				grid: { columns: 2, gutter: 0, marginLeft: 0, marginRight: 0 },
				children: [box("card", 0, 0, 60, 60)],
			}),
		],
		[rule("half", "align", ["card", datum], "left")],
	);
	// It solves at all, which is the assertion.
	const solved = await solve(scene);
	assert.equal(at(solved, "card", "x"), 480);
	// And it is stated in the program rather than left to luck.
	const program = compile(scene).generated;
	assert.match(program, /gsolved\(N\) :- constraint\(C\)[\s\S]*not gdatum\(N\)\./);
});

test("a datum past the end of the grid says nothing rather than breaking", async () => {
	// `holdsDatum` keeps such a rule in the document on purpose: deleting it the
	// moment somebody typed a smaller count would mean retyping the rule instead
	// of the count. So the program has to answer for it, and the answer is
	// silence — the card stays where the document put it.
	const solved = await solve(
		scened(
			[
				page({
					grid: { columns: 3, gutter: 0, marginLeft: 0, marginRight: 0 },
					children: [box("card", 200, 0, 60, 60)],
				}),
			],
			[rule("far", "align", ["card", trackDatum("page", 9, "left")], "left")],
		),
	);
	assert.equal(at(solved, "card", "x"), 200, "the pull put it back where it was");
});

test("a size rule against a column line states nothing rather than zero", async () => {
	// The loud half of the refusal `gdaxis/2` makes quietly on the other axis. A
	// datum is a zero-size box — `lsz(D,Z) = 0` is what makes all six of its edges
	// the same line — so without `gnoedge` the generic span equation would give
	// ge(D,width) = 0 and `equalSize` would propagate a width of nothing onto the
	// real member, with nothing refusing it and nothing saying it happened.
	//
	// Two clicks from the feature's own headline, which is why it is a case: the
	// canvas offers `align [card, cg(page,3,left)]`, and the rule panel's kind
	// menu retargets that same rule to `equalSize`, whose default edge is `width`.
	const scene = scened(
		[
			page({
				grid: { columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 },
				children: [box("card", 0, 0, 80, 40)],
			}),
		],
		[rule("same", "equalSize", ["card", trackDatum("page", 3, "left")], "width")],
	);
	const solved = await solve(scene);
	assert.equal(at(solved, "card", "width"), 80, "the card keeps the size it had");
	// Said in the program rather than left to the arithmetic happening to work
	// out: the edge is refused for the datum, so ge(D,width) is never equated to
	// anything and the pairwise rule has one member.
	assert.match(compile(scene).generated, /^gnoedge\(N,E\) :- gdatum\(N\), gedge\(E,_,span\)\.$/m);
});

test("a count of nothing is one track, not a division by zero", async () => {
	// Zero columns is not an empty grid, it is an equation with no solution. One
	// track spanning what the margins leave is what "no grid" already means, so
	// the degenerate case answers itself — the same clamp `guideCount` makes.
	const solved = await solve(
		scened(
			[
				page({
					grid: { columns: 0, gutter: 0, marginLeft: 40, marginRight: 0 },
					children: [box("card", 0, 0, 60, 60)],
				}),
			],
			[rule("only", "align", ["card", trackDatum("page", 1, "left")], "left")],
		),
	);
	assert.equal(at(solved, "card", "x"), 40);
});

/* ------------------------------------------------------------------ */
/* What the program says with nobody looking                           */
/* ------------------------------------------------------------------ */

test("the grid is compiled whether or not any rule names it", async () => {
	// A design that changes when the guides are hidden is a bug, so view state
	// can never be an input to compile(). Emitting always is also what buys the
	// invariant that matters: the coordinate the overlay draws, the coordinate
	// snapping uses and the coordinate a rule names are one number from one
	// solve.
	const solved = await solve(
		scened([
			page({ grid: { columns: 4, gutter: 0, marginLeft: 0, marginRight: 0 } }),
		]),
	);
	assert.equal(at(solved, trackDatum("page", 2, "left"), "x"), 240);
	assert.equal(at(solved, trackDatum("page", 4, "right"), "x"), 960);
});

test("a document with no guides is the same program it always was", () => {
	// The rules are emitted always, like the geometry and component rules, so a
	// hand-written rule can assert ggrid/1. What must not follow is a document
	// that pays for it: with no facts, none of it grounds.
	const plain = compile(scened([box("a", 0, 0, 40, 40)])).generated;
	assert.equal(/^ggrid\(/m.test(plain), false, "no grid was asserted");
	assert.equal(/^gline\(/m.test(plain), false, "no line was drawn");
	// The vocabulary is there for a rule that wants it, and the guard that keeps
	// a datum out of the objective is there whatever the document holds.
	assert.match(plain, /^gcountof\(x,columns\)\.$/m);
	assert.match(plain, /^gdatum\(cg\(S,K,E\)\) :- c_node\(_,cg\(S,K,E\)\)\.$/m);
});

test("a grid stored on a shape that is not a surface says nothing", () => {
	// Read, not corrected: a stored document keeps whatever it holds, and the
	// compiler asks KINDS the same question the editor does.
	const scene = scened([
		box("r", 0, 0, 100, 100, { guides: makeGuides({ columns: 4 }) }),
	]);
	assert.equal(/^ggrid\(/m.test(compile(scene).generated), false);
});

test("a responsive grid is two designs, because its settings are projected", async () => {
	// Twelve columns wide and six narrow differ in nothing but geometry, and
	// geometry is theory variables — so without projecting the settings the two
	// would collapse into one universe and the document would be claiming a
	// choice it could not show. The same argument l_value/3 and f_value/3 make.
	const scene = scened(
		[
			page({
				grid: { gutter: 0, marginLeft: 0, marginRight: 0 },
				children: [box("card", 0, 0, 60, 60)],
			}),
		],
		[rule("third", "align", ["card", trackDatum("page", 3, "left")], "left")],
	);
	scene.nodes[0].guides = {
		...scene.nodes[0].guides!,
		columns: [lit("4"), lit("6")],
	};
	const result = await solveAll(scene);
	assert.equal(result.count, 2, "two counts are two grids and two designs");
	const places = result.universes
		.map((u) => (u.solved.card.x ?? 0) / P)
		.sort((a, b) => a - b);
	assert.deepEqual(places, [320, 480]);
});

test("a count crosses on tally/2, so a grid is columns and not a length", () => {
	// The failure the tally/2 family was built for: read as a length, twelve
	// columns is 114300 EMU and the `1..N` below it grounds 114300 tracks. The
	// setting is a `count` in the table, so the rule that reads it asks for the
	// count reader by name.
	const program = compile(
		scened([page({ grid: { columns: 12 } })]),
	).generated;
	assert.match(program, /^gcount\(S,F,N\) :- ggrid\(S\), g_value\(S,F,L\), tally\(L,N\), N >= 1\.$/m);
	assert.equal(
		/gcount\(S,F,N\) :- .*numeral/.test(program),
		false,
		"a count must never be read as a length",
	);
});
