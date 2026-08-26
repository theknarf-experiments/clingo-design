/**
 * The lines a design is ruled with, as the canvas gets them.
 *
 * Every case goes through the real solver, because that is the claim the module
 * makes: the line an overlay draws and the line a rule names are one number,
 * read back out of one answer set. A fixture that handed `ruledLines` a
 * pre-baked `solved` would be testing a hand-written column equation, which is
 * the second implementation the whole design exists to not have.
 *
 * Written in pixels at both ends, as `datums.test.ts` is and for the same
 * reason: a 960-wide page cut into four is unreadable at 9525 times the size,
 * and every whole pixel is an exact multiple of 9525 in either direction, so
 * nothing here is rounded to make an assertion fit.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { addGuide, makeNode, pinToDatum } from "./edits.ts";
import { explore } from "./explore.ts";
import { snapFrame } from "./geometry.ts";
import {
	type RuledLine,
	type RuledTrack,
	findLine,
	ruledLines,
	ruledTracks,
	snapLines,
} from "./lines.ts";
import {
	type Guide,
	type GuideProp,
	type Scene,
	type SceneNode,
	edgeOn,
	emptyScene,
	lineDatum,
	makeGuides,
	sceneContext,
	trackDatum,
} from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, ref, single } from "./values.ts";

const P = EMU_PER_PX;
const px = (n: number): number => n * P;

const empty = (): Scene => ({ ...emptyScene(), nodes: [], constraints: [] });

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
		...makeNode(
			"frame",
			{ x: px(x), y: px(y), width: px(w), height: px(h) },
			{ id: spec.id ?? "page" },
		),
		children: spec.children ?? [],
		...(spec.grid ? { guides: makeGuides(spec.grid) } : {}),
		...(spec.lines ? { lines: spec.lines } : {}),
	};
};

const solve = async (scene: Scene) => {
	const result = await explore(scene, directSolver);
	return result.universes[0].solved;
};

/** Every line of a solved document, in the pixels the case is written in. */
const linesOf = async (scene: Scene): Promise<RuledLine[]> =>
	ruledLines(scene, await solve(scene));

const at = (lines: readonly RuledLine[], term: string): number => {
	const found = lines.find((l) => l.term === term);
	assert.ok(found, `no line for ${term}`);
	return found.at / P;
};

/* ------------------------------------------------------------------ */
/* What comes back                                                     */
/* ------------------------------------------------------------------ */

test("a four-column grid gives every line of every track", async () => {
	// 960 wide, no margins, no gutters: four columns of 240.
	const lines = await linesOf({
		...empty(),
		nodes: [page({ grid: { columns: 4, gutter: 0 } })],
	});
	const across = lines.filter((l) => l.axis === "x");
	assert.equal(across.length, 12, "three lines on each of four tracks");
	assert.equal(at(lines, trackDatum("page", 1, "left")), 0);
	assert.equal(at(lines, trackDatum("page", 3, "left")), 480);
	assert.equal(at(lines, trackDatum("page", 3, "centerX")), 600);
	assert.equal(at(lines, trackDatum("page", 4, "right")), 960);
});

test("the outermost lines are the margins, and are named so", async () => {
	const lines = await linesOf({
		...empty(),
		nodes: [
			page({
				grid: { columns: 3, gutter: 20, marginLeft: 60, marginRight: 40, marginTop: 30 },
			}),
		],
	});
	// (960 - 60 - 40 - 2*20) / 3 = 273 1/3, so the ends are the numbers worth
	// asserting on and the middles are the solver's business.
	assert.equal(at(lines, trackDatum("page", 1, "left")), 60);
	assert.equal(at(lines, trackDatum("page", 3, "right")), 920);
	assert.equal(at(lines, trackDatum("page", 1, "top")), 30);

	const roles = new Map(lines.map((l) => [l.term, l.role]));
	assert.equal(roles.get(trackDatum("page", 1, "left")), "margin");
	assert.equal(roles.get(trackDatum("page", 3, "right")), "margin");
	assert.equal(roles.get(trackDatum("page", 2, "left")), "track");
	assert.equal(roles.get(trackDatum("page", 1, "centerX")), "track");
	// A row grid nobody set is one row, so its two lines are exactly the top and
	// bottom margins — which is why a margin needs no equation of its own.
	assert.equal(roles.get(trackDatum("page", 1, "top")), "margin");
	assert.equal(roles.get(trackDatum("page", 1, "bottom")), "margin");
});

test("a hand-drawn line comes back beside the grid's own", async () => {
	const lines = await linesOf({
		...empty(),
		nodes: [
			page({
				grid: { columns: 2 },
				lines: [{ id: "g1", axis: "y", at: single("200px") }],
			}),
		],
	});
	const drawn = lines.find((l) => l.role === "guide");
	assert.ok(drawn);
	assert.deepEqual(
		[drawn.term, drawn.axis, drawn.at / P, drawn.guide, drawn.locked],
		[lineDatum("page", "g1"), "y", 200, "g1", false],
	);
});

test("a line is drawn across the whole surface it belongs to", async () => {
	const lines = await linesOf({
		...empty(),
		nodes: [page({ box: [40, 25, 400, 300], grid: { columns: 2, gutter: 0 } })],
	});
	const column = lines.find((l) => l.term === trackDatum("page", 2, "left"));
	assert.ok(column);
	// The page sits at (40,25): the line stands at 40+200 and runs the page's
	// own height, which is what says what it is a line *of*.
	assert.deepEqual([column.at / P, column.from / P, column.to / P], [240, 25, 325]);
});

test("a grid on a nested surface lands where the surface is", async () => {
	const lines = await linesOf({
		...empty(),
		nodes: [
			page({
				id: "outer",
				box: [100, 100, 800, 600],
				children: [
					page({ id: "inner", box: [50, 20, 400, 200], grid: { columns: 2, gutter: 0 } }),
				],
			}),
		],
	});
	// The datum answers in its surface's own coordinates — 200 — and the world
	// origin of that surface is 100 + 50.
	assert.equal(at(lines, trackDatum("inner", 2, "left")), 350);
});

test("a guide follows the token its position names", async () => {
	const scene: Scene = {
		...empty(),
		nodes: [
			page({ lines: [{ id: "g1", axis: "x", at: [ref("t_side")] }] }),
		],
		tokens: [
			{ id: "t_side", name: "Side", type: "length", value: single("120px") },
		],
	};
	assert.equal(at(await linesOf(scene), lineDatum("page", "g1")), 120);
});

/* ------------------------------------------------------------------ */
/* What does not come back                                             */
/* ------------------------------------------------------------------ */

test("a document nobody has solved has no lines to draw", () => {
	// The honest report rather than a gap: where the third of twelve columns
	// falls is not known until the solver says, and guessing here would be the
	// second implementation of the equation.
	const scene: Scene = {
		...empty(),
		nodes: [
			page({
				grid: { columns: 4 },
				lines: [{ id: "g1", axis: "x", at: single("120px") }],
			}),
		],
	};
	assert.deepEqual(ruledLines(scene), []);
});

test("a grid stored on a rectangle rules nothing", async () => {
	const rect: SceneNode = {
		...makeNode("rect", { x: 0, y: 0, width: px(400), height: px(300) }, { id: "r1" }),
		guides: makeGuides({ columns: 4 }),
	};
	assert.deepEqual(await linesOf({ ...empty(), nodes: [rect] }), []);
});

test("a grid with alternatives rules the universe it is read in", async () => {
	const base = page({ grid: { gutter: 0 } });
	const responsive: Scene = {
		...empty(),
		nodes: [
			{
				...base,
				guides: { ...makeGuides({ gutter: 0 }), columns: [lit("2"), lit("4")] },
			},
		],
	};
	const result = await explore(responsive, directSolver);
	assert.equal(result.count, 2, "a count with two alternatives is two designs");

	const read = result.universes.map((u) =>
		ruledLines(responsive, u.solved, sceneContext(responsive, u.pick)).filter(
			(l) => l.axis === "x",
		),
	);
	// Three lines per track, so two tracks and four tracks.
	assert.deepEqual(
		read.map((lines) => lines.length).sort((a, b) => a - b),
		[6, 12],
	);
	// And the point of reading the count out of the *document* rather than out of
	// the answer set: clingo-lpx hands back a value for `lv(cg(page,4,left))` in
	// the two-column universe too, because it is a theory variable of the same
	// ground program. It is zero, so counting the terms that came back would draw
	// a fourth column line lying on the near margin.
	const narrow = read.find((lines) => lines.length === 6);
	assert.ok(narrow);
	assert.equal(narrow.some((l) => l.index === 4), false);
});

/* ------------------------------------------------------------------ */
/* The bands between the lines                                         */
/* ------------------------------------------------------------------ */

/** Every track of a solved document, in the pixels the case is written in. */
const tracksOf = async (scene: Scene): Promise<RuledTrack[]> =>
	ruledTracks(await linesOf(scene)).map((t) => ({
		...t,
		area: {
			x: t.area.x / P,
			y: t.area.y / P,
			width: t.area.width / P,
			height: t.area.height / P,
		},
	}));

test("a track is the space between its own two lines", async () => {
	// 960 wide with a 24 gutter and no margins: four columns of 222, so the
	// bands begin at 0, 246, 492 and 738 — and the 24 between them is gutter,
	// which is the whole thing a band says that a line cannot.
	const tracks = await tracksOf({
		...empty(),
		nodes: [page({ grid: { columns: 4, gutter: 24 } })],
	});
	const columns = tracks.filter((t) => t.axis === "x");
	assert.deepEqual(
		columns.map((t) => [t.index, t.area.x, t.area.width]),
		[
			[1, 0, 222],
			[2, 246, 222],
			[3, 492, 222],
			[4, 738, 222],
		],
	);
	// Drawn down the whole page, from the very lines that bound it.
	assert.deepEqual([columns[0].area.y, columns[0].area.height], [0, 640]);
	assert.ok(columns.every((t) => t.count === 4));
});

test("a track begins at the margin, because the margin is its own line", async () => {
	const tracks = await tracksOf({
		...empty(),
		nodes: [
			page({
				grid: { columns: 2, gutter: 0, marginLeft: 60, marginRight: 40 },
			}),
		],
	});
	const columns = tracks.filter((t) => t.axis === "x");
	// (960 - 60 - 40) / 2 = 430.
	assert.deepEqual(
		columns.map((t) => [t.area.x, t.area.width]),
		[
			[60, 430],
			[490, 430],
		],
	);
});

test("rows are tracks on their own axis, with nothing said twice", async () => {
	const tracks = await tracksOf({
		...empty(),
		nodes: [
			page({ box: [0, 0, 900, 600], grid: { columns: 3, rows: 2, gutter: 0, rowGutter: 0 } }),
		],
	});
	// Columns and rows in that order — the order `ruledLines` walks in, so an
	// overlay's bands do not shuffle between solves.
	assert.deepEqual(
		tracks.map((t) => [t.axis, t.index]),
		[
			["x", 1],
			["x", 2],
			["x", 3],
			["y", 1],
			["y", 2],
		],
	);
	const rows = tracks.filter((t) => t.axis === "y");
	// A row runs the page's whole width and half its height, and knows it is one
	// of two.
	assert.deepEqual(rows.map((t) => [t.area.x, t.area.width, t.area.y, t.area.height]), [
		[0, 900, 0, 300],
		[0, 900, 300, 300],
	]);
	assert.ok(rows.every((t) => t.count === 2));
});

test("one track is the live area, and says so", async () => {
	// The default on the other axis, and the case an overlay must be able to tell
	// apart: a grid that divides nothing is not a band to shade, it is the page
	// inside its margins, which the margin lines already draw.
	const tracks = await tracksOf({
		...empty(),
		nodes: [page({ grid: { columns: 1, marginTop: 40, marginBottom: 20 } })],
	});
	assert.ok(tracks.every((t) => t.count === 1));
	const row = tracks.find((t) => t.axis === "y");
	assert.deepEqual([row?.area.y, row?.area.height], [40, 580]);
});

test("a hand-drawn line is not a track, and an unsolved document has none", async () => {
	const scene: Scene = {
		...empty(),
		nodes: [
			page({
				grid: { columns: 2, gutter: 0 },
				lines: [{ id: "g1", axis: "x", at: single("300px") }],
			}),
		],
	};
	// A guide is one line rather than a pair of them: there is no space it names.
	assert.equal(ruledTracks(await linesOf(scene)).filter((t) => t.axis === "x").length, 2);
	assert.deepEqual(ruledTracks(ruledLines(scene)), []);
});

/* ------------------------------------------------------------------ */
/* What a drag may land on                                             */
/* ------------------------------------------------------------------ */

test("a drawn line outranks the grid, and the grid is never dragged", async () => {
	const scene: Scene = {
		...empty(),
		nodes: [
			page({
				grid: { columns: 2, gutter: 0 },
				lines: [{ id: "g1", axis: "x", at: single("300px") }],
			}),
		],
	};
	const lines = await linesOf(scene);
	const ranks = new Map(snapLines(lines).map((l) => [l.id, l.rank]));
	assert.equal(ranks.get(lineDatum("page", "g1")), "drawn");
	assert.equal(ranks.get(trackDatum("page", 2, "left")), "ruled");
	assert.equal(ranks.get(trackDatum("page", 1, "left")), "ruled", "a margin ranks with the grid");
	// Where a column line falls is the answer to the settings, so there is
	// nothing for a hand to pull: dragging one could mean a new margin, a new
	// gutter or a new count, and the arithmetic cannot say which.
	assert.ok(lines.filter((l) => l.role !== "guide").every((l) => l.locked));
});

test("a locked guide is a line that still catches a drag", async () => {
	// Lock says "do not move it", not "do not use it" — the whole reason to lock
	// a guide is that you are lining things up against it.
	const scene: Scene = {
		...empty(),
		nodes: [
			page({ lines: [{ id: "g1", axis: "x", at: single("300px"), locked: true }] }),
		],
	};
	const lines = await linesOf(scene);
	assert.equal(lines[0].locked, true);
	assert.deepEqual(snapLines(lines), [
		{ axis: "x", at: px(300), rank: "drawn", id: lineDatum("page", "g1") },
	]);
});

test("a guide drawn by the editor reads back at the pixel it was drawn on", async () => {
	const drawn = addGuide(
		{ ...empty(), nodes: [page({})] },
		"page",
		"x",
		px(137),
	);
	assert.equal(drawn.id, "g1");
	assert.equal(at(await linesOf(drawn.scene), lineDatum("page", "g1")), 137);
});

/* ------------------------------------------------------------------ */
/* The whole point: a drop that becomes a rule                         */
/* ------------------------------------------------------------------ */

test("a card dropped against a column stays on it when the grid changes", async () => {
	// The stage end to end, with nothing between the steps that a person does
	// not do: rule a page into four columns, drag a card until it catches, say
	// so, then change the grid and let the solver move the card.
	// 960 wide with a 24 gutter: four columns of 222, so column three begins at
	// 492; six columns of 140, and it begins at 328. A real gutter rather than
	// none, because with no gutter column two's far line and column three's near
	// line are the same coordinate — two truthful names for one line, and which
	// of them a drop is called is then a coin toss nobody should be asserting on.
	const design = (columns: string): Scene => ({
		...empty(),
		nodes: [
			page({
				grid: { columns, gutter: 24 },
				children: [
					makeNode(
						"rect",
						{ x: px(488), y: px(40), width: px(200), height: px(120) },
						{ id: "card" },
					),
				],
			}),
		],
	});

	const four = design("4");
	const lines = ruledLines(four, await solve(four));

	// The drag: four pixels short of column three, inside the six-pixel
	// tolerance, so the card lands on 492 and the catch says what caught it.
	const dropped = snapFrame(
		{ x: px(488), y: px(40), width: px(200), height: px(120) },
		{ targets: [], lines: snapLines(lines) },
	);
	assert.equal(dropped.frame.x / P, 492);
	const caught = dropped.guides.find((g) => g.axis === "x");
	assert.ok(caught?.id);
	assert.equal(caught.id, trackDatum("page", 3, "left"));
	assert.deepEqual([findLine(lines, caught.id)?.role, caught.place], ["track", "lead"]);

	// Saying it out loud. The edge comes from what the gesture caught rather than
	// from a guess, so a drop on the middle line would have written `centerX`.
	const said = pinToDatum(four, "card", caught.id, edgeOn(caught.axis, caught.place ?? "lead"));
	assert.ok(said.id);
	const held = await solve(said.scene);
	assert.equal((held.card?.x ?? 0) / P, 492, "the rule holds what the hand did");

	// And the payoff: six columns instead of four, no edit to the card and no
	// edit to the rule, and the card is where column three now begins.
	const widened: Scene = {
		...said.scene,
		nodes: [
			{
				...said.scene.nodes[0],
				guides: { ...makeGuides({ columns: 6, gutter: 24 }) },
			},
		],
	};
	const after = await solve(widened);
	assert.equal((after.card?.x ?? 0) / P, 328);
});
