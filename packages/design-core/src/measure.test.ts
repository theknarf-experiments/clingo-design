import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import {
	addNode,
	addNodeTo,
	makeNode,
	setLayout,
	setProp,
	setSizing,
	setStyle,
} from "./edits.ts";
import { explore } from "./explore.ts";
import {
	type Measurements,
	askedSize,
	autoSizes,
	capAxes,
	fontString,
	lineHeightPx,
	measureAxes,
	naturalSize,
	oneSize,
	rowCount,
	rowIndex,
	rowPicks,
	sizingOf,
	toMeasure,
} from "./measure.ts";
import {
	type Scene,
	type SceneNode,
	type Style,
	emptyScene,
	makeLayout,
} from "./scene.ts";
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
import {
	type Value,
	frameVar,
	layoutVar,
	lit,
	propVar,
	ref,
	resolveValue,
	single,
	styleVar,
	tokenVar,
} from "./values.ts";

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
	const measurements = {
		t: oneSize({ width: 231, height: 22 }),
		r: oneSize({ width: 9, height: 9 }),
	};
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
	assert.deepEqual(askedSize(text, { t: oneSize({ width: 231, height: 22 }) }), {
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
		measurements: { t: oneSize({ width: 231.4, height: 21.6 }) },
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
	const solved = async (measurements?: Measurements) => {
		const result = await explore(scene, directSolver, {
			sample: "first",
			measurements,
		});
		assert.equal(result.count, 1, "measuring must not multiply the universes");
		return result.universes[0].solved;
	};

	const dragged = await solved();
	assert.equal(dragged.box.width, 230, "10 + 160 + 10 + 40 + 10");

	const fitted = await solved({ t: oneSize({ width: 231, height: 22 }) });
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
		naturalSize(box, { t: oneSize({ width: 231, height: 22 }) }),
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
				// One row per wording, keyed by the pick that chooses it.
				measurements: {
					t: {
						axes: [{ variable: propVar("t", "text"), count: 2 }],
						sizes: [
							{ width: 50, height: 20 },
							{ width: 130, height: 20 },
						],
					},
				},
			});
			return r.universes[0].solved.row?.width;
		}),
	);
	assert.deepEqual(widths, [70, 150], "50 + 20 padding, then 130 + 20");
});

/* ------------------------------------------------------------------ */
/* The measurement table                                               */
/* ------------------------------------------------------------------ */

/**
 * The bill this file pays.
 *
 * `measureText` sizes a text node by measuring what it says — and a style
 * changes the font family, the size, the weight and the line height, every one
 * of which changes the box. So a measured size is a function of a *tuple* of
 * picks, not of one alternative, and the table has to be indexed by all of them.
 * The tests below are about that index: what belongs in it, what must not
 * multiply it, and that the solver reads exactly one row of it per universe.
 */

/**
 * A hugging row holding one text node, which may wear a style.
 *
 * The node states nothing about its own treatment. `makeNode` gives a text node
 * a size and a weight of its own, and a node that states its own value keeps it
 * — see `wornProps` — so a scaffold that left them there would be testing the
 * precedence rule rather than the measurement.
 */
function styled(scene: Partial<Scene> & { styles: Style[] }): Scene {
	let out: Scene = { ...emptyScene(), nodes: [], ...scene };
	out = addNode(
		out,
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "box" }),
	);
	out = addNodeTo(out, "box", {
		...makeNode("text", { x: 0, y: 0, width: 60, height: 20 }, { id: "t" }),
		props: { text: single("Text") },
	});
	out = setLayout(out, "box", makeLayout({ gap: 0, padding: 10 }));
	return setStyle(out, ["t"], out.styles[0]?.id);
}

const heading = (variants: Style["variants"]): Style => ({
	id: "head",
	name: "Heading",
	variants,
});

const textOf = (scene: Scene): SceneNode => {
	const node = findInTree(scene.nodes, "t");
	assert.ok(node);
	return node;
};

test("a style that decides nothing the measurement reads multiplies nothing", () => {
	// The degenerate case that matters most, because it is the common one: a
	// style is a treatment, and most of a treatment is colour. Two variants,
	// two designs, and still one box.
	const scene = styled({
		styles: [
			heading([
				{ name: "Blue", parts: { ink: lit("#0000ff") } },
				{ name: "Red", parts: { ink: lit("#ff0000") } },
			]),
		],
	});
	assert.deepEqual(measureAxes(scene, textOf(scene)), []);
});

test("a style that decides the font is one axis, however many fields it moves", () => {
	// The whole point of a style: size AND weight AND line height together. One
	// pick decides them, so it is one axis and two measurements — not the eight
	// that three independent two-alternative properties would be.
	const scene = styled({
		styles: [
			heading([
				{ name: "Compact", parts: { size: lit("16px"), weight: lit("400"), lineHeight: lit("1.2") } },
				{ name: "Comfortable", parts: { size: lit("32px"), weight: lit("700"), lineHeight: lit("1.6") } },
			]),
		],
	});
	assert.deepEqual(measureAxes(scene, textOf(scene)), [
		{ variable: styleVar("head"), count: 2 },
	]);
});

test("copy and treatment cross, and the table is the product", () => {
	let scene = styled({
		styles: [
			heading([
				{ parts: { size: lit("16px") } },
				{ parts: { size: lit("32px") } },
			]),
		],
	});
	scene = setProp(scene, ["t"], "text", [lit("one"), lit("two"), lit("three")]);
	const axes = measureAxes(scene, textOf(scene));
	assert.deepEqual(axes, [
		{ variable: propVar("t", "text"), count: 3 },
		{ variable: styleVar("head"), count: 2 },
	]);
	assert.equal(rowCount(axes), 6, "three wordings under two treatments is six boxes");
	// The index is an odometer, and the two directions of it agree.
	for (let row = 0; row < 6; row++) {
		assert.equal(rowIndex(axes, rowPicks(axes, row)), row);
	}
	assert.deepEqual(rowPicks(axes, 3), {
		[propVar("t", "text")]: 1,
		[styleVar("head")]: 1,
	});
});

test("a node's own value beats the style, and then the style is not an axis", () => {
	// The same precedence `wornProps` applies: a node that states its own size
	// does not get the style's, so the style cannot change its box.
	let scene = styled({
		styles: [
			heading([{ parts: { size: lit("16px") } }, { parts: { size: lit("32px") } }]),
		],
	});
	scene = setProp(scene, ["t"], "size", single("20px"));
	assert.deepEqual(measureAxes(scene, textOf(scene)), []);
});

test("a token a variant names brings its own alternatives in", () => {
	// A style part is a value in every sense but branching, so it can name a
	// token — and the token's alternatives are then picks the box depends on
	// just as much as the variant is.
	const scene = styled({
		styles: [heading([{ parts: { size: ref("step") } }])],
		tokens: [
			...emptyScene().tokens,
			{ id: "step", name: "step", type: "length", value: [lit("16px"), lit("24px")] },
		],
	});
	assert.deepEqual(measureAxes(scene, textOf(scene)), [
		{ variable: tokenVar("step"), count: 2 },
	]);
});

test("a size that names a varying token is two boxes, style or no style", () => {
	// This was already wrong before styles existed: the measurement pass read
	// the first alternative of every token, so a type scale with two steps was
	// measured at one of them. The axis is the same axis.
	let scene = styled({ styles: [] });
	scene = {
		...scene,
		tokens: [
			...scene.tokens,
			{ id: "step", name: "step", type: "length", value: [lit("16px"), lit("24px")] },
		],
	};
	scene = setProp(scene, ["t"], "size", [ref("step")]);
	assert.deepEqual(measureAxes(scene, textOf(scene)), [
		{ variable: tokenVar("step"), count: 2 },
	]);
});

test("the solver reads exactly one row, and it is the right one", async () => {
	let scene = styled({
		styles: [
			heading([
				{ name: "Compact", parts: { size: lit("16px") } },
				{ name: "Comfortable", parts: { size: lit("32px") } },
			]),
		],
	});
	scene = setProp(scene, ["t"], "text", [lit("short"), lit("much longer")]);
	const axes = measureAxes(scene, textOf(scene));
	// What a canvas would have handed back: 40 per word, doubled by the big
	// treatment. The point is only that all four differ.
	const measurements: Measurements = {
		t: {
			axes,
			sizes: [
				{ width: 40, height: 20 },
				{ width: 80, height: 40 },
				{ width: 100, height: 20 },
				{ width: 200, height: 40 },
			],
		},
	};
	const widths: number[] = [];
	for (const wording of [0, 1]) {
		for (const variant of [0, 1]) {
			const out = await explore(scene, directSolver, {
				sample: "first",
				measurements,
				pins: {
					[propVar("t", "text")]: wording,
					[styleVar("head")]: variant,
				},
			});
			assert.equal(out.count, 1, "a pin on both leaves one universe");
			widths.push(out.universes[0].solved.box?.width ?? 0);
		}
	}
	// 20 of padding around each measured box, in odometer order.
	assert.deepEqual(widths, [60, 100, 120, 220]);
});

test("an axis over the budget is dropped, not truncated", () => {
	const axes = [
		{ variable: propVar("t", "text"), count: 3 },
		{ variable: styleVar("head"), count: 2 },
		{ variable: tokenVar("step"), count: 5 },
	];
	const capped = capAxes(axes, 8);
	assert.deepEqual(capped.axes, axes.slice(0, 2), "six fits, thirty does not");
	assert.deepEqual(capped.dropped, [tokenVar("step")]);
	// Whatever the budget, the first axis survives it: forty wordings is a
	// document that wants forty measurements, and today it gets them.
	const many = [{ variable: propVar("t", "text"), count: 40 }];
	assert.deepEqual(capAxes(many, 8), { axes: many, dropped: [] });
});

test("a dropped axis is written into the program, not swallowed", async () => {
	let scene = styled({
		styles: [
			heading([{ parts: { size: lit("16px") } }, { parts: { size: lit("32px") } }]),
		],
	});
	scene = setProp(scene, ["t"], "text", [lit("a"), lit("b"), lit("c")]);
	// A table the host capped: it measured the wordings and gave up on the
	// treatment, which is exactly what `capAxes` with a budget of 3 would do.
	const measurements: Measurements = {
		t: {
			axes: [{ variable: propVar("t", "text"), count: 3 }],
			sizes: [
				{ width: 10, height: 20 },
				{ width: 20, height: 20 },
				{ width: 30, height: 20 },
			],
			dropped: [styleVar("head")],
		},
	};
	const { program } = compile(scene, { measurements });
	// Three rows, and every universe still lands on one of them: the treatment
	// is simply not in the index any more.
	assert.equal((program.match(/lrow\(t,\d+,width,/g) ?? []).length, 3);
	assert.ok(
		program.includes("lrowif(t,0,prop(t,text),0)."),
		"the row says which pick it holds for",
	);
	assert.ok(
		!program.includes("lrowif(t,0,sty(head),0)."),
		"and says nothing about the axis the host declined",
	);
	assert.ok(
		program.includes(
			"% t: 3 rows, and sty(head) read at its first alternative — over the measurement budget.",
		),
		"the program says so where it is read, rather than absorbing it",
	);
	// Both treatments still solve, and both get the same box — wrong for one of
	// them, and that is what the budget bought.
	const boxes = await Promise.all(
		[0, 1].map(async (variant) => {
			const out = await explore(scene, directSolver, {
				sample: "first",
				measurements,
				pins: { [propVar("t", "text")]: 2, [styleVar("head")]: variant },
			});
			return out.universes[0].solved.box?.width;
		}),
	);
	assert.deepEqual(boxes, [50, 50]);
});

test("an alternative no measurement covers still gets a definite box", async () => {
	// `alt/2` is derivable, so a hand-written rule can mint a wording the
	// measurement pass never saw. Without `laskdef/3` such a universe has no
	// size equation at all and simplex puts the node anywhere legal.
	let scene = styled({ styles: [] });
	scene = setProp(scene, ["t"], "text", [lit("a"), lit("b")]);
	scene = {
		...scene,
		rules: `${scene.rules}
alt(prop(t,text),2).
alt_literal(prop(t,text),2,minted).
literal(minted,"minted").
`,
	};
	const measurements: Measurements = {
		t: {
			axes: [{ variable: propVar("t", "text"), count: 2 }],
			sizes: [
				{ width: 40, height: 20 },
				{ width: 90, height: 20 },
			],
		},
	};
	const out = await explore(scene, directSolver, {
		sample: "first",
		measurements,
		pins: { [propVar("t", "text")]: 2 },
	});
	assert.equal(out.count, 1);
	assert.equal(
		out.universes[0].solved.box?.width,
		60,
		"the first row's box plus the padding, rather than an arbitrary point",
	);
});

/* ---- the deferred half: a container's own arithmetic ---------------- */

/** A hugging column wrapping a hugging row. `inner` gets the row's settings. */
function nested(inner: Partial<Record<"gap" | "padding", Value>>): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "outer" }),
	);
	scene = addNodeTo(
		scene,
		"outer",
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "inner" }),
	);
	for (const id of ["a", "b"]) {
		scene = addNodeTo(
			scene,
			"inner",
			makeNode("rect", { x: 0, y: 0, width: 40, height: 20 }, { id }),
		);
	}
	scene = setLayout(scene, "outer", makeLayout({ direction: "column", gap: 0, padding: 0 }));
	scene = setLayout(scene, "inner", {
		...makeLayout({ direction: "row", gap: 0, padding: 0 }),
		...inner,
	});
	return scene;
}

test("a hugging container's contribution follows a varying gap", async () => {
	// The bill the layout-values phase deferred. A hugging container's size is
	// solved exactly — the equations read `lgap` per universe — but what its
	// *parent* reads for it is `lask`, computed on this side before any pick
	// exists. So the column used to be 88 wide around a row that was 104,
	// which is a child hanging out of its parent.
	const scene = nested({ gap: [lit("8px"), lit("24px")] });
	const widths: number[] = [];
	for (const pick of [0, 1]) {
		const out = await explore(scene, directSolver, {
			sample: "first",
			pins: { [layoutVar("inner", "gap")]: pick },
		});
		assert.equal(out.count, 1);
		widths.push(out.universes[0].solved.outer?.width ?? 0);
		assert.equal(
			out.universes[0].solved.inner?.width,
			widths[widths.length - 1],
			"and the parent is exactly as wide as the child it hugs",
		);
	}
	assert.deepEqual(widths, [88, 104], "40 + gap + 40");
});

test("a hugging container's contribution follows its child's treatment", async () => {
	// The same union, one level down: the column's table is crossed over the
	// picks of everything under it, and a styled headline's box is one of them.
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "outer" }),
	);
	scene = addNodeTo(
		scene,
		"outer",
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "inner" }),
	);
	scene = addNodeTo(scene, "inner", {
		...makeNode("text", { x: 0, y: 0, width: 10, height: 10 }, { id: "t" }),
		props: { text: single("Text") },
	});
	scene = setLayout(scene, "outer", makeLayout({ direction: "column", gap: 0, padding: 0 }));
	scene = setLayout(scene, "inner", makeLayout({ direction: "row", gap: 0, padding: 5 }));
	scene = {
		...scene,
		styles: [
			heading([
				{ name: "Compact", parts: { size: lit("16px") } },
				{ name: "Comfortable", parts: { size: lit("32px") } },
			]),
		],
	};
	scene = setStyle(scene, ["t"], "head");
	const measurements: Measurements = {
		t: {
			axes: measureAxes(scene, textOf(scene)),
			sizes: [
				{ width: 100, height: 20 },
				{ width: 200, height: 40 },
			],
		},
	};
	const widths: number[] = [];
	for (const variant of [0, 1]) {
		const out = await explore(scene, directSolver, {
			sample: "first",
			measurements,
			pins: { [styleVar("head")]: variant },
		});
		widths.push(out.universes[0].solved.outer?.width ?? 0);
	}
	assert.deepEqual(widths, [110, 210], "the measured box plus 10 of padding");
});

test("a laid-out child with two widths is both of them", async () => {
	// Not a text node and not a style: the same table, over `fval`. A child's
	// asked size came from its frame read at the first alternative, so a rect
	// with two widths was drawn at the first one in *both* universes while
	// `frame/3` said otherwise — the answer set contradicting the picture.
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "box" }),
	);
	scene = addNodeTo(
		scene,
		"box",
		makeNode("rect", { x: 0, y: 0, width: 100, height: 20 }, { id: "r" }),
	);
	scene = setLayout(scene, "box", makeLayout({ gap: 0, padding: 10 }));
	scene = {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === "r"
				? { ...n, frame: { ...n.frame, width: [lit("100px"), lit("200px")] } }
				: n,
		),
	};
	const widths: number[] = [];
	for (const pick of [0, 1]) {
		const out = await explore(scene, directSolver, {
			sample: "first",
			pins: { [frameVar("r", "width")]: pick },
		});
		assert.equal(out.count, 1);
		widths.push(out.universes[0].solved.r?.width ?? 0);
	}
	assert.deepEqual(widths, [100, 200]);
});
