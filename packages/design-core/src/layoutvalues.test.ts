/**
 * A layout's settings are values.
 *
 * Every case goes through the real solver, because the claim is not about the
 * document: it is that a document holding two directions comes back as two
 * *arrangements*, which only the equations and the projection can decide.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile, variableCounts } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { addNode, addNodeTo, makeNode, setChildLayout } from "./edits.ts";
import { type Universe, explore } from "./explore.ts";
import { naturalSize } from "./measure.ts";
import {
	type ContainerProp,
	type Scene,
	emptyScene,
	layoutWord,
	makeLayout,
} from "./scene.ts";
import { findInTree, mapTree } from "./tree.ts";
import { type Token, type Value, lit, ref, single } from "./values.ts";

/** A hugging row of two rects, whose settings the caller supplies. */
function row(
	settings: Partial<Record<ContainerProp, Value>>,
	tokens: Token[] = [],
): Scene {
	let scene: Scene = { ...emptyScene(), tokens, nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 400, height: 300 }, { id: "box" }),
	);
	for (const [id, w, h] of [
		["a", 100, 40],
		["b", 60, 20],
	] as const) {
		scene = addNodeTo(
			scene,
			"box",
			makeNode("rect", { x: 0, y: 0, width: w, height: h }, { id }),
		);
	}
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === "box"
				? { ...n, layout: { ...makeLayout({ gap: 10, padding: 10 }), ...settings } }
				: n,
		),
	};
}

const universes = async (scene: Scene): Promise<Universe[]> => {
	const result = await explore(scene, directSolver, { sample: "first" });
	return result.universes;
};

const one = async (scene: Scene) => {
	const list = await universes(scene);
	assert.equal(list.length, 1, "expected a settled document");
	return list[0].solved;
};

/** Each universe's arrangement, as a comparable string. */
const shapes = (list: Universe[]): string[] =>
	list
		.map((u) =>
			["box", "a", "b"]
				.map((id) => {
					const f = u.solved[id] ?? {};
					return `${id}:${f.x},${f.y},${f.width},${f.height}`;
				})
				.join(" "),
		)
		.sort();

test("a settled layout still solves to one arrangement", async () => {
	const solved = await one(row({}));
	assert.equal(solved.a.x, 10);
	assert.equal(solved.b.x, 120, "10 padding + 100 wide + 10 gap");
	assert.equal(solved.box.width, 190, "hugging: 10 + 100 + 10 + 60 + 10");
});

test("a direction with two alternatives is two designs, not one", async () => {
	// The sharp case: a row and a column differ in nothing but geometry, and
	// geometry cannot appear in an answer set. Without l_value/3 in the
	// projection these collapse into a single universe.
	const list = await universes(
		row({ direction: [lit("row"), lit("column")] }),
	);
	assert.equal(list.length, 2, "a row and a column are different designs");
	const [asColumn, asRow] = shapes(list);
	assert.notEqual(asRow, asColumn);
	const widths = list.map((u) => u.solved.box.width).sort((x, y) => (x ?? 0) - (y ?? 0));
	assert.deepEqual(widths, [120, 190], "one runs across, one runs down");
	const heights = list.map((u) => u.solved.box.height).sort((x, y) => (x ?? 0) - (y ?? 0));
	assert.deepEqual(heights, [60, 90]);
});

test("a gap that names a token is a spacing scale", async () => {
	const tokens: Token[] = [
		{
			id: "space",
			name: "space",
			type: "length",
			value: [lit("4px"), lit("24px")],
		},
	];
	const list = await universes(row({ gap: [ref("space")] }, tokens));
	assert.equal(list.length, 2, "compact and comfortable");
	const widths = list.map((u) => u.solved.box.width).sort((x, y) => (x ?? 0) - (y ?? 0));
	assert.deepEqual(widths, [184, 204], "180 of children and padding, plus the gap");
});

test("one token drives the gap of several containers at once", async () => {
	const tokens: Token[] = [
		{ id: "space", name: "space", type: "length", value: single("6px") },
	];
	const solved = await one(row({ gap: [ref("space")], padding: [ref("space")] }, tokens));
	assert.equal(solved.a.x, 6);
	assert.equal(solved.b.x, 112, "6 + 100 + 6");
	assert.equal(solved.box.width, 178);
});

test("hugging or not is itself a choice the document can hold", async () => {
	const list = await universes(row({ sizing: [lit("hug"), lit("fixed")] }));
	assert.equal(list.length, 2);
	const widths = list.map((u) => u.solved.box.width).sort((x, y) => (x ?? 0) - (y ?? 0));
	assert.deepEqual(widths, [190, 400], "hugged, or the frame it was drawn at");
});

test("justification varies like anything else", async () => {
	const list = await universes(
		row({ sizing: single("fixed"), justify: [lit("start"), lit("end")] }),
	);
	assert.equal(list.length, 2);
	const first = list.map((u) => u.solved.a.x).sort((x, y) => (x ?? 0) - (y ?? 0));
	assert.deepEqual(first, [10, 220], "against the near padding, or the far one");
});

test("a child's grow is two named options rather than a checkbox", async () => {
	const scene = setChildLayout(
		row({ sizing: single("fixed") }),
		["b"],
		"grow",
		[lit("fixed"), lit("grow")],
	);
	const list = await universes(scene);
	assert.equal(list.length, 2);
	const widths = list.map((u) => u.solved.b.width).sort((x, y) => (x ?? 0) - (y ?? 0));
	assert.deepEqual(widths, [60, 270], "its own size, or all that is left");
});

test("a child's alignment can vary, and absence still follows the container", async () => {
	const scene = setChildLayout(
		row({ sizing: single("fixed"), align: single("start") }),
		["b"],
		"alignSelf",
		[lit("start"), lit("end")],
	);
	const list = await universes(scene);
	assert.equal(list.length, 2);
	const ys = list.map((u) => u.solved.b.y).sort((x, y) => (x ?? 0) - (y ?? 0));
	assert.deepEqual(ys, [10, 270], "with its siblings, or against the far edge");
	for (const u of list) assert.equal(u.solved.a.y, 10, "a said nothing");
});

test("giving a child's say back leaves the container in charge", async () => {
	const scene = setChildLayout(
		setChildLayout(row({ sizing: single("fixed") }), ["b"], "alignSelf", single("end")),
		["b"],
		"alignSelf",
		undefined,
	);
	assert.equal(findInTree(scene.nodes, "b")?.alignSelf, undefined);
	const solved = await one(scene);
	assert.equal(solved.b.y, 10, "back with its siblings");
});

test("a setting that resolves to nothing usable takes the default", async () => {
	// Point a direction at a colour and `word/2` derives nothing. The container
	// must still be arranged: a layout with no equations at all is not a silent
	// no-op, it is children solved to nothing by nothing.
	const solved = await one(row({ direction: single("#3b82f6") }));
	assert.equal(solved.a.width, 100, "still a rect, not a point");
	assert.equal(solved.b.x, 120, "laid out as a row, the table's default");
});

test("a word the setting does not offer is refused too", async () => {
	const solved = await one(row({ direction: single("sideways") }));
	assert.equal(solved.b.x, 120);
});

test("a gap that reads as no number falls back rather than vanishing", async () => {
	const solved = await one(row({ gap: single("thin") }));
	assert.equal(solved.b.x, 126, "10 padding + 100 wide + the default 16");
});

test("a negative gap clamps rather than turning the row inside out", async () => {
	const solved = await one(row({ gap: single("-40px") }));
	assert.equal(solved.b.x, 110, "10 padding + 100 wide, no gap at all");
	assert.equal(solved.box.width, 180);
});

/* ------------------------------------------------------------------ */
/* The document side                                                   */
/* ------------------------------------------------------------------ */

test("a layout's settings are variables the studio knows about", () => {
	const scene = setChildLayout(
		row({ direction: [lit("row"), lit("column")] }),
		["a"],
		"grow",
		single("grow"),
	);
	const counts = variableCounts(scene);
	assert.equal(counts["lval(box,direction)"], 2);
	assert.equal(counts["lval(box,gap)"], 1);
	assert.equal(counts["lval(a,grow)"], 1);
	assert.equal(counts["lval(b,grow)"], undefined, "b says nothing");
});

test("a layout nobody can see is not a variable", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 100, height: 100 }, { id: "empty" }),
	);
	scene = {
		...scene,
		nodes: mapTree(scene.nodes, (n) => ({ ...n, layout: makeLayout() })),
	};
	const layoutKeys = Object.keys(variableCounts(scene)).filter((k) =>
		k.startsWith("lval("),
	);
	assert.deepEqual(layoutKeys, [], "nothing to arrange");
});

test("the words a setting may say are compiled out of the table", () => {
	const { generated } = compile(row({}));
	assert.match(generated, /lopt\(direction,row\)\./);
	assert.match(generated, /lopt\(justify,spaceBetween\)\./);
	assert.match(generated, /lopt\(alignSelf,stretch\)\./);
	assert.match(generated, /word\(l\d+,row\)\./, "the string-to-constant bridge");
	assert.doesNotMatch(
		generated,
		/^layout\(box,row\)\.$/m,
		"derived from the pick, never stated",
	);
});

test("measuring a hug follows a gap through the token it names", () => {
	const tokens: Token[] = [
		{ id: "space", name: "space", type: "length", value: single("30px") },
	];
	const scene = row({ gap: [ref("space")], padding: single("0px") }, tokens);
	const box = findInTree(scene.nodes, "box");
	assert.ok(box);
	assert.deepEqual(
		naturalSize(box, undefined, { tokens, picks: {} }),
		{ width: 190, height: 40 },
		"100 + 30 + 60",
	);
	assert.deepEqual(
		naturalSize(box),
		{ width: 176, height: 40 },
		"with no tokens to follow, the fallback gap of 16",
	);
});

test("layoutWord reads the universe it is given", () => {
	const scene = row({ direction: [lit("row"), lit("column")] });
	const box = findInTree(scene.nodes, "box");
	assert.ok(box);
	assert.equal(layoutWord(box, "direction"), "row", "the first, with no pick");
	assert.equal(
		layoutWord(box, "direction", {
			tokens: [],
			picks: { "lval(box,direction)": 1 },
		}),
		"column",
	);
	assert.equal(
		layoutWord(box, "align"),
		"start",
		"a setting that says nothing takes the table's default",
	);
});
