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
import { instanceVariable } from "./components.ts";
import { statePart, statePropVar } from "./machines.ts";
import {
	MEASURE_BUDGET,
	type Measured,
	type Measurements,
	type Size,
	askedAxes,
	askedSize,
	autoSizes,
	capAxes,
	fontString,
	lineHeightEmu,
	lineHeightPx,
	measureAxes,
	measuredSize,
	naturalSize,
	oneSize,
	rowCount,
	rowIndex,
	rowPicks,
	sizeFromCssPx,
	sizingOf,
	stateBudget,
	stateMeasures,
	toMeasure,
} from "./measure.ts";
import {
	PROPS,
	type Machine,
	type MachineState,
	type Scene,
	type SceneNode,
	type StatePart,
	type Style,
	emptyScene,
	makeLayout,
} from "./scene.ts";
import { findInTree, mapTree, propValues } from "./tree.ts";
import { EMU_PER_PX, type Emu, cssPxFromEmu, emuOf } from "./units.ts";

/**
 * A length in whole CSS pixels, as the EMU the model holds.
 *
 * Every box in this file is stated in pixels because that is the unit anybody
 * reading it thinks in — a heading is 231 wide, not 2,200,275 — and every one
 * of them crosses here. The same convention `geometry.test.ts` uses, and it is
 * a helper rather than a literal so that a test asserting `px(230)` against a
 * solved value is comparing two numbers with the same name for their unit.
 */
const px = (n: number): Emu => n * EMU_PER_PX;

/** A box drawn in pixels. */
const box = (x: number, y: number, width: number, height: number) => ({
	x: px(x),
	y: px(y),
	width: px(width),
	height: px(height),
});

/** A measured size in pixels — what the host's `measureText` hands back. */
const size = (width: number, height: number): Size => ({
	width: px(width),
	height: px(height),
});

/** A hugging row holding one text node and one plain rectangle. */
function row(): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", box(0, 0, 10, 10), { id: "box" }),
	);
	scene = addNodeTo(
		scene,
		"box",
		makeNode("text", box(0, 0, 160, 28), { id: "t" }),
	);
	scene = addNodeTo(
		scene,
		"box",
		makeNode("rect", box(0, 0, 40, 40), { id: "r" }),
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
	type Token,
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
	const text = makeNode("text", box(0, 0, 160, 28));
	const rect = makeNode("rect", box(0, 0, 160, 28));
	assert.equal(sizingOf(text), "hug");
	assert.equal(autoSizes(text), true);
	assert.equal(sizingOf(rect), "fixed", "a rectangle is the box it was drawn at");
	assert.equal(autoSizes(rect), false);
});

test("a measurement wins over the frame, but only where it applies", () => {
	const scene = row();
	const measurements = {
		t: oneSize(size(231, 22)),
		r: oneSize(size(9, 9)),
	};
	const text = findInTree(scene.nodes, "t");
	const rect = findInTree(scene.nodes, "r");
	assert.ok(text && rect);
	assert.deepEqual(askedSize(text, measurements), size(231, 22));
	assert.deepEqual(
		askedSize(rect, measurements),
		size(40, 40),
		"a rectangle never asks for anything but its frame",
	);
	assert.deepEqual(
		askedSize(text),
		size(160, 28),
		"unmeasured, it falls back to the box it was drawn at",
	);
});

test("fixing a text node's size takes it out of the measuring", () => {
	const scene = setSizing(row(), ["t"], "fixed");
	assert.deepEqual(toMeasure(scene.nodes), []);
	const text = findInTree(scene.nodes, "t");
	assert.ok(text);
	assert.equal(sizingOf(text), "fixed");
	assert.deepEqual(askedSize(text, { t: oneSize(size(231, 22)) }), size(160, 28));
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
	assert.ok(compile(scene).program.includes(`lask(t,width,${px(160)}).`));
	// Half a pixel is 4762.5 EMU, and 9525 is odd, so a box measured at one is
	// the case `emitAsked` quantizes: the fact is whole EMU, ties away from
	// zero. Before EMU this test rounded to a whole *pixel* and could not have
	// said anything finer.
	const measured = compile(scene, {
		measurements: { t: oneSize({ width: px(231.5), height: px(21.5) }) },
	});
	assert.ok(measured.program.includes(`lask(t,width,${px(231) + 4763}).`));
	assert.ok(measured.program.includes(`lask(t,height,${px(21) + 4763}).`));
	assert.ok(
		measured.program.includes(`lask(r,width,${px(40)}).`),
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
	assert.equal(dragged.box.width, px(230), "10 + 160 + 10 + 40 + 10");

	const fitted = await solved({ t: oneSize(size(231, 22)) });
	assert.equal(fitted.box.width, px(301), "10 + 231 + 10 + 40 + 10");
	assert.equal(fitted.t.width, px(231));
	assert.equal(fitted.r.x, px(251), "the sibling moves along with it");
});

test("a hugging container asks for what its contents come to, not its frame", () => {
	const box = findInTree(row().nodes, "box");
	assert.ok(box);
	assert.deepEqual(
		askedSize(box),
		size(10, 10),
		"its stored frame is stale by construction — the solver owns its size",
	);
	assert.deepEqual(naturalSize(box), size(230, 60));
	assert.deepEqual(
		naturalSize(box, { t: oneSize(size(231, 22)) }),
		size(301, 60),
		"measurements reach all the way down",
	);
});

test("a natural size stops at a container that is not hugging", () => {
	const fixed = mapTree(row().nodes, (n) =>
		n.layout ? { ...n, layout: { ...n.layout, sizing: single("fixed") } } : n,
	);
	const box = findInTree(fixed, "box");
	assert.ok(box);
	assert.deepEqual(naturalSize(box), size(10, 10));
});

/* ------------------------------------------------------------------ */
/* The font engine's boundary                                          */
/* ------------------------------------------------------------------ */

test("a font shorthand is what a canvas asks for", () => {
	const georgia = 'Georgia, "Times New Roman", serif';
	assert.equal(
		fontString({ family: georgia, size: "18px", weight: "600" }),
		`600 18px ${georgia}`,
	);
	// The three spellings of one size, and the canvas is told the same thing by
	// all of them. A shorthand takes `pt` and would have measured 18 pixels of
	// type as 24, silently, in the one path the whole document's hugging hangs
	// off; `emu` is not CSS at all and would have thrown the font away entirely.
	for (const said of ["13.5pt", "0.1875in", "171450emu"]) {
		assert.equal(
			fontString({ family: georgia, size: said, weight: "600" }),
			`600 18px ${georgia}`,
			`${said} is 18px`,
		);
	}
	// And a size that is no length falls back to what a node saying nothing means.
	assert.equal(
		fontString({ family: georgia, size: "large", weight: "600" }),
		`600 ${PROPS.size.fallback} ${georgia}`,
	);
});

test("line height is a multiple of the font size unless it carries a unit", () => {
	assert.equal(lineHeightPx("20px", "1.5"), 30);
	assert.equal(lineHeightPx("20px", "24px"), 24);
	// Nothing said: the document's own default ratio, against the default size.
	assert.equal(lineHeightPx(undefined, undefined), 16 * 1.35);
	// The reader underneath it, which is the one the exporter orders a type ramp
	// by. The ratio must stay a ratio: 1.5 of 20px is 30px and not 1.5 EMU,
	// which is the confusion the split of `numeralOf` and `emuOf` exists to
	// prevent, and it is the same number said either way.
	assert.equal(lineHeightEmu("20px", "1.5"), px(30));
	assert.equal(lineHeightEmu("15pt", "1.5"), px(30), "the same type, in points");
	assert.equal(lineHeightEmu("20px", "0.25in"), px(24));
});

test("a measured box crosses into EMU once, and lands on a whole one", () => {
	// The one float this module lets in. Whole pixels are exact both ways.
	assert.deepEqual(sizeFromCssPx({ width: 231, height: 22 }), size(231, 22));
	assert.equal(cssPxFromEmu(sizeFromCssPx({ width: 231, height: 22 }).width), 231);
	// A fraction the shaper actually produces is kept, to a hundred-thousandth
	// of it: a whole pixel is 9525 EMU, so there is room for the tail that a
	// whole-pixel model had to throw away.
	assert.equal(sizeFromCssPx({ width: 231.4, height: 0 }).width, px(231) + 3810);
	// Half a pixel is 4762.5 EMU and 9525 is odd, so this is the one place the
	// crossing rounds — by name, ties away from zero.
	assert.equal(sizeFromCssPx({ width: 231.5, height: 0 }).width, px(231) + 4763);
	assert.ok(
		Number.isInteger(sizeFromCssPx({ width: 1 / 3, height: 1 / 7 }).height),
		"a measured box is stored, so it is a whole EMU",
	);
});

test("a size no unit spells falls back to the default, never to zero", () => {
	// The exact-or-nothing contract, seen from this side: `emuOf` is what every
	// reader in this file goes through, so the fallbacks below are the fallbacks
	// a document out of an older tool gets — a definite default, never a zero.
	assert.equal(emuOf("20.5px"), undefined);
	assert.equal(lineHeightEmu("20.5px", "1.5"), px(16) * 1.5, "the default size");
});

test("copy is a value, so a headline can branch the space", async () => {
	let scene = emptyScene();
	scene = addNodeTo(
		scene,
		"frame1",
		makeNode("text", box(0, 0, 100, 20), { id: "t" }),
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
		makeNode("frame", box(0, 0, 10, 10), { id: "row" }),
	);
	scene = addNodeTo(
		scene,
		"row",
		makeNode("text", box(0, 0, 10, 10), { id: "t" }),
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
							size(50, 20),
							size(130, 20),
						],
					},
				},
			});
			return r.universes[0].solved.row?.width;
		}),
	);
	assert.deepEqual(widths, [px(70), px(150)], "50 + 20 padding, then 130 + 20");
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
		makeNode("frame", box(0, 0, 10, 10), { id: "box" }),
	);
	out = addNodeTo(out, "box", {
		...makeNode("text", box(0, 0, 60, 20), { id: "t" }),
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
				size(40, 20),
				size(80, 40),
				size(100, 20),
				size(200, 40),
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
	assert.deepEqual(widths, [px(60), px(100), px(120), px(220)]);
});

test("over the budget, a container drops the axes that move it least", () => {
	// The claim, as a measurement: the drop order is worth deciding, and this is
	// the one it is decided by. A column of eight three-wording headings is 6561
	// combinations capped to 27 rows, so five children lose their wordings — and
	// which five used to be whichever five came later in the document.
	const spreads = [
		[100, 101, 102],
		[100, 100, 103],
		[100, 102, 101],
		[100, 101, 100],
		[100, 180, 260],
		[100, 300, 500],
		[100, 140, 190],
		[100, 220, 340],
	];
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", box(0, 0, 10, 10), { id: "col" }),
	);
	const measurements: Record<string, Measured> = {};
	spreads.forEach((widths, i) => {
		scene = addNodeTo(scene, "col", {
			...makeNode("text", box(0, 0, 100, 20), { id: `t${i}` }),
			props: { text: [lit("a"), lit("b"), lit("c")] },
		});
		measurements[`t${i}`] = {
			axes: [{ variable: propVar(`t${i}`, "text"), count: 3 }],
			sizes: widths.map((width) => size(width, 20)),
		};
	});
	scene = setLayout(
		scene,
		"col",
		makeLayout({ direction: "column", gap: 8, padding: 12 }),
	);
	const col = findInTree(scene.nodes, "col");
	assert.ok(col);

	const { axes, dropped } = askedAxes(scene, col, measurements);
	assert.equal(rowCount(axes), 27, "three axes of three, inside the budget of 32");
	assert.deepEqual(
		axes.map((axis) => axis.variable),
		[propVar("t5", "text"), propVar("t7", "text"), propVar("t4", "text")],
		"the three whose wordings move the column most, biggest first",
	);
	assert.equal(dropped.length, 5);

	// And the cost of the approximation, over every universe there is. The same
	// budget in tree order leaves a mean error of 268px and a worst case of 428.
	const context = { tokens: scene.tokens, picks: {} };
	const rows = new Map<number, ReturnType<typeof naturalSize>>();
	for (let row = 0; row < rowCount(axes); row++) {
		rows.set(row, naturalSize(col, measurements, { ...context, picks: rowPicks(axes, row) }));
	}
	let total = 0;
	let worst = 0;
	let universes = 0;
	for (let n = 0; n < 3 ** 8; n++) {
		const picks: Record<string, number> = {};
		let rest = n;
		for (let i = 7; i >= 0; i--) {
			picks[propVar(`t${i}`, "text")] = rest % 3;
			rest = Math.floor(rest / 3);
		}
		const exact = naturalSize(col, measurements, { ...context, picks });
		const got = rows.get(rowIndex(axes, picks));
		assert.ok(got);
		// In pixels, because the claim is about how wrong a picture looks and a
		// reader cannot see 17,000 EMU. The arithmetic above is all EMU.
		const off = cssPxFromEmu(
			Math.abs(got.width - exact.width) + Math.abs(got.height - exact.height),
		);
		total += off;
		worst = Math.max(worst, off);
		universes++;
	}
	assert.equal(universes, 6561);
	assert.ok(total / universes < 2, `mean error ${total / universes}px`);
	assert.ok(worst <= 90, `worst error ${worst}px`);
});

test("a style a rule handed a measured node is reported, since nothing was dropped", async () => {
	// The one approximation with no axis to give up: the pass that measured this
	// node ran before the solve and read the document, where the wearing does
	// not exist. So there is no comment to write into the program and the signal
	// has to come back out of the answer set.
	let scene = styled({
		styles: [heading([{ parts: { size: lit("40px"), weight: lit("800") } }])],
	});
	// Nobody wears it in the document; a rule dresses the one measured node.
	scene = setStyle(scene, ["t"], undefined);
	scene = { ...scene, rules: "sty_wears(t,head,size). sty_wears(t,head,weight).\n" };
	const measurements: Measurements = { t: oneSize(size(60, 20)) };

	const out = await explore(scene, directSolver, { sample: "first", measurements });
	assert.equal(out.diagnostics, "", "clingo has nothing to say: the rules are fine");
	assert.deepEqual(out.approximations, [
		"info: a rule dresses t in “Heading”, which the document does not say." +
			" Text is measured before the solve and from the document, so that box" +
			" hugs the size and weight the document gives it, not the treatment's.",
	]);
	// It is a remark, not a refusal: the design is still there, and the box is
	// still the one the measurement gave.
	assert.equal(out.universes[0].model.byId.t.rendered.size, "40px");
	assert.equal(out.universes[0].solved.t?.width, px(60));

	// And the three ways of not being worth a word.
	const quiet = async (scene: Scene, measured?: Measurements) =>
		(await explore(scene, directSolver, { sample: "first", measurements: measured }))
			.approximations;
	assert.deepEqual(
		await quiet(scene),
		[],
		"nothing measured it, so there is no measurement to be wrong",
	);
	assert.deepEqual(
		await quiet(
			{ ...scene, rules: "sty_wears(t,head,ink).\n", styles: [heading([{ parts: { ink: lit("#ff0000") } }])] },
			measurements,
		),
		[],
		"a treatment the measurement does not read changes no box",
	);
	assert.deepEqual(
		await quiet({ ...setStyle(scene, ["t"], "head"), rules: "" }, measurements),
		[],
		"and the document's own wearing was measured with the style, as always",
	);
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
				size(10, 20),
				size(20, 20),
				size(30, 20),
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
	assert.deepEqual(boxes, [px(50), px(50)]);
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
				size(40, 20),
				size(90, 20),
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
		px(60),
		"the first row's box plus the padding, rather than an arbitrary point",
	);
});

/* ---- the deferred half: a container's own arithmetic ---------------- */

/** A hugging column wrapping a hugging row. `inner` gets the row's settings. */
function nested(inner: Partial<Record<"gap" | "padding", Value>>): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", box(0, 0, 10, 10), { id: "outer" }),
	);
	scene = addNodeTo(
		scene,
		"outer",
		makeNode("frame", box(0, 0, 10, 10), { id: "inner" }),
	);
	for (const id of ["a", "b"]) {
		scene = addNodeTo(
			scene,
			"inner",
			makeNode("rect", box(0, 0, 40, 20), { id }),
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
	assert.deepEqual(widths, [px(88), px(104)], "40 + gap + 40");
});

test("a hugging container's contribution follows its child's treatment", async () => {
	// The same union, one level down: the column's table is crossed over the
	// picks of everything under it, and a styled headline's box is one of them.
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", box(0, 0, 10, 10), { id: "outer" }),
	);
	scene = addNodeTo(
		scene,
		"outer",
		makeNode("frame", box(0, 0, 10, 10), { id: "inner" }),
	);
	scene = addNodeTo(scene, "inner", {
		...makeNode("text", box(0, 0, 10, 10), { id: "t" }),
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
				size(100, 20),
				size(200, 40),
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
	assert.deepEqual(widths, [px(110), px(210)], "the measured box plus 10 of padding");
});

test("a laid-out child with two widths is both of them", async () => {
	// Not a text node and not a style: the same table, over `fval`. A child's
	// asked size came from its frame read at the first alternative, so a rect
	// with two widths was drawn at the first one in *both* universes while
	// `frame/3` said otherwise — the answer set contradicting the picture.
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", box(0, 0, 10, 10), { id: "box" }),
	);
	scene = addNodeTo(
		scene,
		"box",
		makeNode("rect", box(0, 0, 100, 20), { id: "r" }),
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
	assert.deepEqual(widths, [px(100), px(200)]);
});

/* ------------------------------------------------------------------ */
/* States: the same words, in another typography                       */
/* ------------------------------------------------------------------ */

/**
 * The other half of the bill, and the reason it could not be paid the way the
 * first half was.
 *
 * A measurement table is indexed by *picks* — `lrow/4` with an `lrowif/4` per
 * axis, where a row holds in the universes that chose a given alternative. **A
 * state is not a pick.** All states of a machine are true at once in one answer
 * set; that is the invariant the whole feature is built on, and it means a state
 * cannot be an axis of anything. So a state copy takes a table of its own,
 * keyed by its own term, indexed by the variables the program really does
 * branch on: the delta's `sprop(I,S,N,P)` where the state has an opinion, and
 * the instance's one shared `prop(inst(I,N),P)` where it does not.
 *
 * The tests below are about that table: when it exists, what indexes it, what it
 * costs, and — first and last — that nothing about it reaches the node it is a
 * copy of.
 */

/**
 * A component definition holding one hugging text label, some uses of it, and
 * optionally a machine over it.
 *
 * The label is a leaf on purpose. Per-state measurement is a claim about text,
 * and a container copy is deliberately outside it: an instance's copy of a
 * laid-out definition does not re-solve its layout in the first place, so there
 * is no `lask(inst(I,N))` for a per-state container arithmetic to be the second
 * half of.
 */
function component(
	spec: {
		/** What the label says about itself. */
		label?: SceneNode["props"];
		/** The style it wears, if any. */
		style?: string;
		styles?: Style[];
		tokens?: Token[];
		/** In order; the first is the initial state. No machine at all if absent. */
		states?: Array<{ id: string; parts?: Record<string, StatePart> }>;
		/** Instance node ids. One called `b1` unless said otherwise. */
		uses?: string[];
	} = {},
): Scene {
	const label: SceneNode = {
		...makeNode("text", box(12, 14, 136, 20), { id: "label", name: "Label" }),
		props: spec.label ?? {
			text: single("Go"),
			size: single("14px"),
			weight: single("400"),
		},
		...(spec.style ? { style: spec.style } : {}),
	};
	const definition: SceneNode = {
		...makeNode("frame", box(20, 20, 160, 48), { id: "btn", name: "Button" }),
		children: [label],
		component: true,
	};
	const machine: Machine | undefined = spec.states && {
		id: "m1",
		name: "Button states",
		root: "btn",
		states: spec.states.map(
			(state): MachineState => ({
				id: state.id,
				name: state.id,
				parts: state.parts ?? {},
			}),
		),
		transitions: [],
	};
	const empty = emptyScene();
	return {
		...empty,
		styles: spec.styles ?? [],
		tokens: [...empty.tokens, ...(spec.tokens ?? [])],
		machines: machine ? [machine] : [],
		nodes: [
			{
				...makeNode("frame", box(0, 0, 600, 400), { id: "page", name: "Page" }),
				children: [
					definition,
					...(spec.uses ?? ["b1"]).map((id, i) => ({
						...makeNode("instance", box(300, 20 + i * 120, 160, 48), {
							id,
							name: id,
						}),
						instanceOf: "btn",
					})),
				],
			},
		],
	};
}

test("a state that changes the type is measured as itself", () => {
	// The claim in one line: hover is bold, so hover's box is not rest's box —
	// and today nothing between the document and the solver would have noticed,
	// because the measurement pass reads the document and the delta is not in it.
	const scene = component({
		states: [
			{ id: "rest" },
			{ id: "hover", parts: { label: { props: { weight: single("700") } } } },
		],
	});
	const measures = stateMeasures(scene);
	assert.deepEqual(
		measures.map((m) => m.id),
		[statePart("b1", "hover", "label")],
		"one table, for the one state with an opinion about the type",
	);
	const [hover] = measures;
	assert.deepEqual(hover.axes, [], "nothing branches, so it is one row");
	assert.equal(hover.rows.length, 1);
	assert.equal(hover.rows[0].weight, "700", "the delta's, not the document's 400");
	assert.equal(hover.rows[0].text, "Go", "and everything else is the instance's");
	assert.equal(hover.rows[0].size, "14px");
	assert.deepEqual(
		{ instance: hover.instance, state: hover.state, part: hover.part },
		{ instance: "b1", state: "hover", part: "label" },
		"the copy knows which three things it is a copy of",
	);
});

test("a state that changes nothing the measurement reads mints no rows", () => {
	// The strongest lever in the budget, and it is the shared-variable economy
	// rather than a special case: what a state does not touch, it shares — so the
	// copy's box *is* the instance's box and there is nothing to measure.
	const nothing = (parts: Record<string, StatePart>): Scene =>
		component({ states: [{ id: "rest" }, { id: "hover", parts }] });
	assert.deepEqual(stateMeasures(nothing({})), []);
	assert.deepEqual(
		stateMeasures(nothing({ label: { props: { ink: single("#ff0000") } } })),
		[],
		"a colour is not a typeface",
	);
	assert.deepEqual(
		stateMeasures(nothing({ label: { frame: { y: single("10px") } } })),
		[],
		"and geometry is not typography: a label that moves is the same words",
	);
	assert.deepEqual(
		stateMeasures(
			nothing({ label: { hidden: true, props: { text: single("Gone") } } }),
		),
		[],
		"a hidden copy has no box to be wrong about",
	);
	assert.deepEqual(
		stateMeasures(component({ states: [{ id: "rest" }, { id: "hover" }] })),
		[],
		"and a machine whose states are all silent costs nothing at all",
	);
});

test("a state copy is indexed by the program's variables, never by the state", () => {
	// Two sources, and the difference between them is the whole invariant. The
	// wording is the *instance's* one shared variable, read alike by every state —
	// which is what makes four states four boxes and not 3^4. The size is the
	// delta's own, and it branches because the designer wrote two alternatives
	// inside a state, which is a design decision like any other.
	const scene = component({
		label: { text: [lit("Go"), lit("Get started")], size: single("14px") },
		states: [
			{ id: "rest" },
			{
				id: "hover",
				parts: { label: { props: { size: [lit("16px"), lit("20px")] } } },
			},
		],
	});
	const [hover, ...rest] = stateMeasures(scene);
	assert.deepEqual(rest, [], "rest says nothing, so rest has no table");
	assert.deepEqual(hover.axes, [
		{ variable: instanceVariable("b1", "label", "text"), count: 2 },
		{ variable: statePropVar("b1", "hover", "label", "size"), count: 2 },
	]);
	// The odometer, in MEASURED_PROPS order: the wording varies slowest.
	assert.deepEqual(
		hover.rows.map((row) => `${row.text}/${row.size}`),
		["Go/16px", "Go/20px", "Get started/16px", "Get started/20px"],
	);
	// And the negative, which is the one that would catch a state quietly becoming
	// an alternative. No axis is keyed by a copy — a copy has a table, it is not a
	// place in one — and a state id appears in a key only inside a delta's own
	// variable, where what branches is the two sizes a designer wrote and not the
	// two states they sit in.
	for (const measure of stateMeasures(scene)) {
		for (const axis of measure.axes) {
			assert.ok(!axis.variable.includes("stt("), `${axis.variable} keys a copy`);
			if (axis.variable.includes("hover")) {
				assert.ok(
					axis.variable.startsWith("sprop("),
					`${axis.variable} names a state and is not a delta`,
				);
			}
		}
	}
});

test("two uses of one button are two sets of tables", () => {
	// Per instance, because the values are the instance's: the program re-mints a
	// definition's property variables per use, and a delta resolves against the
	// instance's own picks exactly as the rest state does.
	const scene = component({
		uses: ["b1", "b2"],
		states: [
			{ id: "rest" },
			{ id: "hover", parts: { label: { props: { text: single("Now") } } } },
		],
	});
	assert.deepEqual(
		stateMeasures(scene).map((m) => m.id),
		[statePart("b1", "hover", "label"), statePart("b2", "hover", "label")],
	);
});

test("a delta a style would have decided drops the style as an axis", () => {
	// The precedence, seen from the copy: a state that pins the weight down means
	// the treatment's disagreement about the weight no longer reaches this box, so
	// carrying `sty(head)` would be measuring the same row twice.
	const styles: Style[] = [
		{
			id: "head",
			name: "Heading",
			variants: [
				{ name: "Compact", parts: { weight: lit("400") } },
				{ name: "Comfortable", parts: { weight: lit("800") } },
			],
		},
	];
	const worn = component({
		label: { text: single("Go") },
		style: "head",
		styles,
		states: [
			{ id: "rest" },
			{ id: "hover", parts: { label: { props: { weight: single("700") } } } },
		],
	});
	const [hover] = stateMeasures(worn);
	assert.deepEqual(hover.axes, [], "the state answered the only thing the style moved");
	assert.equal(hover.rows[0].weight, "700");
	// And the control: a state that answers something else leaves the treatment
	// exactly where it was — one axis, two boxes, and the copy reads the same
	// document-wide `sty(S)` every other reader does.
	const elsewhere = component({
		label: { text: single("Go") },
		style: "head",
		styles,
		states: [
			{ id: "rest" },
			{ id: "hover", parts: { label: { props: { text: single("Now") } } } },
		],
	});
	const [other] = stateMeasures(elsewhere);
	assert.deepEqual(other.axes, [{ variable: styleVar("head"), count: 2 }]);
	assert.deepEqual(
		other.rows.map((row) => `${row.text}/${row.weight}`),
		["Now/400", "Now/800"],
	);
});

test("the copies share one budget, and the node they copy keeps its own whole", () => {
	// The budget under states, as the two rules it is: the document's own node is
	// untouched however many states there are, and the copies divide one budget
	// between them. Which bounds the feature at twice a machine-less document's
	// measurement cost, whatever anybody adds — the same shape of promise the
	// universe count makes, in milliseconds instead of designs.
	assert.deepEqual(
		[1, 2, 4, 64].map((n) => stateBudget(n)),
		[MEASURE_BUDGET, 16, 8, 1],
		"one copy pays nothing; sixty-four still get a row each",
	);

	const step: Token = {
		id: "step",
		name: "step",
		type: "length",
		value: ["12px", "14px", "16px", "20px", "24px"].map(lit),
	};
	const wordings = [lit("a"), lit("bb"), lit("ccc")];
	const label = { text: wordings, size: [ref("step")] };
	const hover = (id: string) => ({
		id,
		parts: { label: { props: { text: wordings } } },
	});

	// Three wordings across a five-step scale is fifteen rows: inside the budget
	// of thirty-two for one copy, over the eight that four copies leave each.
	const one = component({ label, tokens: [step], states: [{ id: "rest" }, hover("h1")] });
	const [alone] = stateMeasures(one);
	assert.equal(rowCount(alone.axes), 15);
	assert.deepEqual(alone.dropped, [], "one copy gets the whole budget");

	const four = component({
		label,
		tokens: [step],
		states: [hover("h1"), hover("h2"), hover("h3"), hover("h4")],
	});
	const many = stateMeasures(four);
	assert.equal(many.length, 4);
	for (const copy of many) {
		assert.equal(rowCount(copy.axes), 3, "the wording survives, three rows each");
		assert.deepEqual(
			copy.axes.map((axis) => axis.variable),
			[statePropVar("b1", copy.state, "label", "text")],
		);
		assert.deepEqual(
			copy.dropped,
			[tokenVar("step")],
			"and the type scale is reported, not absorbed",
		);
	}

	// The half that must not move: the label's own table is what it was before
	// anybody wrote a machine. A budget that took rows from here would repaint the
	// rest state — the picture on screen — because somebody added a hover.
	const base = findInTree(four.nodes, "label");
	assert.ok(base);
	assert.deepEqual(capAxes(measureAxes(four, base)), {
		axes: [
			{ variable: propVar("label", "text"), count: 3 },
			{ variable: tokenVar("step"), count: 5 },
		],
		dropped: [],
	});
});

test("adding a machine changes no measurement fact about the document's own nodes", () => {
	// The invariant, one level down from where it is usually stated, and asserted
	// against the real compiler rather than against this file's arithmetic: a
	// document with a four-state machine emits exactly the `lask`/`lrow`/`lrowif`
	// the same document with no machine does. A state is a copy beside the
	// picture, never a change to it.
	const label = { text: [lit("a"), lit("bb"), lit("ccc")], size: single("14px") };
	const measurements: Measurements = {
		label: {
			axes: [{ variable: propVar("label", "text"), count: 3 }],
			sizes: [size(10, 20), size(40, 20), size(90, 20)],
		},
	};
	const asked = (scene: Scene): string[] =>
		compile(scene, { measurements })
			.program.split("\n")
			.filter((line) => /^(lask|lrow|lrowif|laskdef)\(/.test(line));

	const plain = component({ label });
	const machined = component({
		label,
		states: [
			{ id: "rest" },
			{ id: "hover", parts: { label: { props: { weight: single("700") } } } },
			{ id: "pressed", parts: { label: { props: { text: single("…") } } } },
			{ id: "off", parts: { label: { hidden: true } } },
		],
	});
	assert.deepEqual(asked(machined), asked(plain));
	assert.ok(asked(plain).length > 0, "and there was something there to compare");
	// The copies are real, though: two of the four states change the type.
	assert.deepEqual(
		stateMeasures(machined).map((m) => m.id),
		[statePart("b1", "hover", "label"), statePart("b1", "pressed", "label")],
	);
});

test("a state copy's table is read back by the same arithmetic as a node's", () => {
	// A copy is not a `node/1` and never will be, so it has no `SceneNode` to hang
	// a table off — which is exactly why the row lookup is reachable without one.
	// Both readers land on the same row for the same picks, and that is the only
	// reason a copy's box and its instance's box can be compared at all.
	const scene = component({
		label: { text: single("Go"), size: single("14px") },
		states: [
			{ id: "rest" },
			{
				id: "hover",
				parts: { label: { props: { text: [lit("Go"), lit("Get started")] } } },
			},
		],
	});
	const [hover] = stateMeasures(scene);
	const measured: Measured = {
		axes: hover.axes,
		sizes: [size(30, 20), size(120, 20)],
	};
	const context = { tokens: scene.tokens, picks: {} };
	assert.deepEqual(measuredSize(measured, context), size(30, 20));
	assert.deepEqual(
		measuredSize(measured, {
			...context,
			picks: { [statePropVar("b1", "hover", "label", "text")]: 1 },
		}),
		size(120, 20),
	);
	assert.equal(measuredSize(undefined, context), undefined, "no table, no box");
});
