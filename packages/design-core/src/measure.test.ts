import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { addNode, addNodeTo, makeNode, setLayout, setProp, setSizing } from "./edits.ts";
import { explore } from "./explore.ts";
import {
	askedSize,
	autoSizes,
	fontString,
	lineHeightPx,
	naturalSize,
	sizingOf,
	toMeasure,
} from "./measure.ts";
import { type Scene, emptyScene, makeLayout } from "./scene.ts";
import { findInTree, mapTree, propValues } from "./tree.ts";

/** A hugging row holding one text node and one plain rectangle. */
function row(): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "box" }),
	);
	scene = addNodeTo(
		scene,
		"box",
		makeNode("text", { x: 0, y: 0, width: 160, height: 28 }, { id: "t" }),
	);
	scene = addNodeTo(
		scene,
		"box",
		makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id: "r" }),
	);
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === "box"
				? {
						...n,
						layout: makeLayout({ gap: 10, padding: 10 }),
					}
				: n,
		),
	};
}
import { lit, propVar, resolveValue, single } from "./values.ts";

test("only the measured kinds size themselves, and by default they do", () => {
	const text = makeNode("text", { x: 0, y: 0, width: 160, height: 28 });
	const rect = makeNode("rect", { x: 0, y: 0, width: 160, height: 28 });
	assert.equal(sizingOf(text), "hug");
	assert.equal(autoSizes(text), true);
	assert.equal(sizingOf(rect), "fixed", "a rectangle is the box it was drawn at");
	assert.equal(autoSizes(rect), false);
});

test("a measurement wins over the frame, but only where it applies", () => {
	const scene = row();
	const measurements = { t: [{ width: 231, height: 22 }], r: [{ width: 9, height: 9 }] };
	const text = findInTree(scene.nodes, "t");
	const rect = findInTree(scene.nodes, "r");
	assert.ok(text && rect);
	assert.deepEqual(askedSize(text, measurements), { width: 231, height: 22 });
	assert.deepEqual(
		askedSize(rect, measurements),
		{ width: 40, height: 40 },
		"a rectangle never asks for anything but its frame",
	);
	assert.deepEqual(
		askedSize(text),
		{ width: 160, height: 28 },
		"unmeasured, it falls back to the box it was drawn at",
	);
});

test("fixing a text node's size takes it out of the measuring", () => {
	const scene = setSizing(row(), ["t"], "fixed");
	assert.deepEqual(toMeasure(scene.nodes), []);
	const text = findInTree(scene.nodes, "t");
	assert.ok(text);
	assert.equal(sizingOf(text), "fixed");
	assert.deepEqual(askedSize(text, { t: [{ width: 231, height: 22 }] }), {
		width: 160,
		height: 28,
	});
	// Back to automatic, and the document carries no trace of the detour.
	const back = findInTree(setSizing(scene, ["t"], "hug").nodes, "t");
	assert.equal(back && "sizing" in back, false);
});

test("only the auto-sized nodes are handed out for measuring", () => {
	assert.deepEqual(
		toMeasure(row().nodes).map((n) => n.id),
		["t"],
	);
});

test("the measured size is what reaches the layout facts", () => {
	const scene = row();
	assert.ok(compile(scene).program.includes("lask(t,width,160)."));
	const measured = compile(scene, {
		measurements: { t: [{ width: 231.4, height: 21.6 }] },
	});
	assert.ok(measured.program.includes("lask(t,width,231)."));
	assert.ok(measured.program.includes("lask(t,height,22)."));
	assert.ok(
		measured.program.includes("lask(r,width,40)."),
		"an unmeasured sibling is untouched",
	);
});

test("a hugging container grows to the text it actually holds", async () => {
	const scene = row();
	const solved = async (measurements?: Record<string, { width: number; height: number }[]>) => {
		const result = await explore(scene, directSolver, {
			sample: "first",
			measurements,
		});
		assert.equal(result.count, 1, "measuring must not multiply the universes");
		return result.universes[0].solved;
	};

	const dragged = await solved();
	assert.equal(dragged.box.width, 230, "10 + 160 + 10 + 40 + 10");

	const fitted = await solved({ t: [{ width: 231, height: 22 }] });
	assert.equal(fitted.box.width, 301, "10 + 231 + 10 + 40 + 10");
	assert.equal(fitted.t.width, 231);
	assert.equal(fitted.r.x, 251, "the sibling moves along with it");
});

test("a hugging container asks for what its contents come to, not its frame", () => {
	const box = findInTree(row().nodes, "box");
	assert.ok(box);
	assert.deepEqual(
		askedSize(box),
		{ width: 10, height: 10 },
		"its stored frame is stale by construction — the solver owns its size",
	);
	assert.deepEqual(naturalSize(box), { width: 230, height: 60 });
	assert.deepEqual(
		naturalSize(box, { t: [{ width: 231, height: 22 }] }),
		{ width: 301, height: 60 },
		"measurements reach all the way down",
	);
});

test("a natural size stops at a container that is not hugging", () => {
	const fixed = mapTree(row().nodes, (n) =>
		n.layout ? { ...n, layout: { ...n.layout, sizing: single("fixed") } } : n,
	);
	const box = findInTree(fixed, "box");
	assert.ok(box);
	assert.deepEqual(naturalSize(box), { width: 10, height: 10 });
});

test("a font shorthand is what a canvas asks for", () => {
	assert.equal(
		fontString({ family: 'Georgia, "Times New Roman", serif', size: "18px", weight: "600" }),
		'600 18px Georgia, "Times New Roman", serif',
	);
});

test("line height is a multiple of the font size unless it carries a unit", () => {
	assert.equal(lineHeightPx("20px", "1.5"), 30);
	assert.equal(lineHeightPx("20px", "24px"), 24);
	// Nothing said: the document's own default ratio, against the default size.
	assert.equal(lineHeightPx(undefined, undefined), 16 * 1.35);
});

test("copy is a value, so a headline can branch the space", async () => {
	let scene = emptyScene();
	scene = addNodeTo(
		scene,
		"frame1",
		makeNode("text", { x: 0, y: 0, width: 100, height: 20 }, { id: "t" }),
	);
	scene = setProp(scene, ["t"], "text", [lit("Sign up"), lit("Get started")]);

	const result = await explore(scene, directSolver, { sample: "first" });
	assert.equal(result.count, 2, "two wordings are two designs");

	const context = { tokens: scene.tokens, picks: {}, props: propValues(scene.nodes) };
	const said = result.universes
		.map((u) =>
			resolveValue(
				{ ...context, picks: u.pick },
				findInTree(scene.nodes, "t")?.props.text,
				propVar("t", "text"),
			),
		)
		.sort();
	assert.deepEqual(said, ["Get started", "Sign up"]);
});

test("a hugging row follows whichever wording won", async () => {
	// The two strings are measured separately, so the container is not the
	// same width in both universes — which is the whole reason the measurement
	// is per alternative rather than per node.
	let scene = emptyScene();
	scene = addNodeTo(
		scene,
		"frame1",
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "row" }),
	);
	scene = addNodeTo(
		scene,
		"row",
		makeNode("text", { x: 0, y: 0, width: 10, height: 10 }, { id: "t" }),
	);
	scene = setProp(scene, ["t"], "text", [lit("short"), lit("much longer")]);
	scene = setLayout(scene, "row", makeLayout({ gap: 0, padding: 10 }));

	const widths = await Promise.all(
		[0, 1].map(async (i) => {
			const r = await explore(scene, directSolver, {
				sample: "first",
				pins: { [propVar("t", "text")]: i },
				// One measurement per alternative, as the host supplies them.
				measurements: { t: [{ width: 50, height: 20 }, { width: 130, height: 20 }] },
			});
			return r.universes[0].solved.row?.width;
		}),
	);
	assert.deepEqual(widths, [70, 150], "50 + 20 padding, then 130 + 20");
});
