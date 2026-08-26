/**
 * What the document says a length is, and what it writes one down as.
 *
 * The seam between `units.ts`, which knows how to read and spell a length, and
 * the tables in `scene.ts` that hold them. Everything here is pure — no
 * grounding, no solver — because the claims are about the document alone: a
 * frame read in EMU, a frame written back in the unit it came in, and a table of
 * truth whose length fallbacks are all lengths.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_NODE_SIZE } from "./geometry.ts";
import {
	DEFAULT_FRAME,
	type Dimension,
	FRAME_DIMS,
	KINDS,
	LAYOUT_PROPS,
	LAYOUT_PROP_NAMES,
	NODE_KINDS,
	PROPS,
	PROP_NAMES,
	type SceneNode,
	constraintValue,
	dimension,
	emptyScene,
	frameDim,
	frameOf,
	layoutLength,
	makeFrame,
	makeLayout,
	starterTokens,
	withFrame,
	writeLength,
} from "./scene.ts";
import { EMU_PER_PX, emuOf, formatLength } from "./units.ts";
import { type Value, isLengthType, lit, ref, single } from "./values.ts";

const P = EMU_PER_PX;

const node = (frame: Partial<Record<Dimension, Value>> = {}): SceneNode => ({
	id: "n",
	kind: "rect",
	name: "Node",
	frame: {
		x: single("0px"),
		y: single("0px"),
		width: single("0px"),
		height: single("0px"),
		...frame,
	},
	props: {},
});

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

test("a frame reads in EMU, whatever unit it was written in", () => {
	// Every one of these is the same distance said five ways, and the point of
	// EMU is that they come back as one number rather than five roundings.
	for (const spelling of ["24px", "18pt", "1.5pc", "0.25in", "6.35mm"]) {
		assert.equal(
			frameDim(node({ x: single(spelling) }), "x"),
			228600,
			spelling,
		);
	}
	// A bare number is pixels, which is what every document written before units
	// existed meant by one.
	assert.equal(frameDim(node({ x: single("24") }), "x"), 24 * P);
});

test("a dimension that is not a length reads as nothing, which is zero", () => {
	// The program's own default rule says `frame(N,A,0)`, so this side has to say
	// the same. What is new is which values fall in here: "20.5px" is 195262.5
	// EMU and so is not a length at all, where it used to be 20.5 and rounded to
	// 21. Catching that on the way in is `normalizeScene`'s job — a stored value
	// this cannot read is a document that has not been migrated.
	assert.equal(frameDim(node({ x: single("50%") }), "x"), 0);
	assert.equal(frameDim(node({ x: single("20.5px") }), "x"), 0);
});

test("frameOf reads all four", () => {
	const n = node({
		x: single("10px"),
		y: single("0.5in"),
		width: single("36pt"),
		height: single("2mm"),
	});
	assert.deepEqual(frameOf(n), {
		x: 10 * P,
		y: 457200,
		width: 457200,
		height: 72000,
	});
});

test("a layout length reads in EMU and falls back to its own table", () => {
	const laid = { ...node(), layout: makeLayout({ gap: 24 }) };
	assert.equal(layoutLength(laid, "gap"), 24 * P);
	// Unstated is the table's fallback, read through the same reader.
	assert.equal(layoutLength(node(), "padding"), emuOf(LAYOUT_PROPS.padding.fallback));
	// A gap of minus eight is not a design, and the layout rules would read it
	// as one.
	const negative = { ...node(), layout: makeLayout({ gap: -8 }) };
	assert.equal(layoutLength(negative, "gap"), 0);
});

test("a constraint's value reads in EMU, or says nothing", () => {
	const scene = emptyScene();
	const rule = {
		id: "r",
		kind: "gap" as const,
		prop: "fill" as const,
		nodes: ["a", "b"],
		value: single("12pt"),
		enabled: true,
	};
	assert.equal(constraintValue(scene, rule), 152400);
	assert.equal(
		constraintValue(scene, { ...rule, value: single("50%") }),
		undefined,
		"a row with no distance to show must not print a zero",
	);
});

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

test("a gesture is written on a whole pixel", () => {
	// The document is no longer rounded for the compiler's sake — it is quantized
	// for the pointer's, which is a different claim about a different number.
	const made = makeFrame({ x: 10.4 * P, y: -0.4 * P, width: 33.6 * P, height: 40 * P });
	assert.deepEqual(made.x, [lit("10px")]);
	assert.deepEqual(made.y, [lit("0px")]);
	assert.deepEqual(made.width, [lit("34px")]);
	assert.deepEqual(frameOf({ ...node(), frame: made }), {
		x: 10 * P,
		y: 0,
		width: 34 * P,
		height: 40 * P,
	});
});

test("an edit keeps the unit the value was written in", () => {
	// 12pt nudged one pixel to the right is 22225 EMU, and that is exactly
	// 12.75pt — so a design drawn in points is still in points afterwards.
	const moved = withFrame(node({ x: single("12pt") }), { x: 152400 + P });
	assert.deepEqual(moved.frame.x, [lit("12.75pt")]);
});

test("a patch that repeats what is stored is not an edit", () => {
	// A drag that ends where it began patches every dimension with what it read.
	// Without this, the quantum in `writeLength` would drag an exact 12.5pt onto
	// the pixel grid on the way past and call it a move.
	const before = node({ x: single("12.5pt") });
	const after = withFrame(before, { x: frameDim(before, "x") });
	assert.equal(after, before, "the node itself, not a copy of it");
});

test("an edit never shrinks a node past grabbing", () => {
	const shrunk = withFrame(node({ width: single("100px") }), { width: 12 });
	assert.deepEqual(shrunk.frame.width, [lit(formatLength(MIN_NODE_SIZE))]);
	assert.equal(frameDim(shrunk, "width"), 4 * P);
});

test("an edit leaves a linked dimension to its token", () => {
	const linked = node({ x: [ref("gutter")] });
	assert.equal(withFrame(linked, { x: 99 * P }), linked);
});

test("dimension writes the Value a constraint stores", () => {
	assert.deepEqual(dimension(0), single("0px"));
	assert.deepEqual(dimension(24 * P), single("24px"));
	assert.deepEqual(dimension(152400, "pt"), single("12pt"));
});

test("writing and reading a length are inverses across the units", () => {
	// The law the whole file rests on: what this module writes, `emuOf` reads
	// back as the same number. Whole pixels because that is what a gesture is;
	// the finer round trip is `units.test.ts`'s.
	for (const px of [0, 1, 7, 16, 720, -3]) {
		for (const unit of ["px", "pt", "pc", "in", "mm", "cm", "emu"] as const) {
			const text = writeLength(px * P, unit);
			assert.equal(emuOf(text), px * P, `${px}px as ${unit} came back as ${text}`);
		}
	}
});

/* ------------------------------------------------------------------ */
/* The tables of truth                                                 */
/* ------------------------------------------------------------------ */

test("every length a table falls back to is a length", () => {
	// A fallback is read by `emuOf`, which is exact or nothing: an entry no unit
	// spells exactly — "8.5px" — would not read as 8.5, it would read as nothing
	// at all, and the property would silently say nothing. This is the test that
	// makes writing them through `writeLength` worth doing rather than trusting.
	const entries: Array<[string, string]> = [];
	for (const dim of Object.keys(FRAME_DIMS) as Dimension[]) {
		entries.push([`FRAME_DIMS.${dim}`, FRAME_DIMS[dim].fallback]);
	}
	for (const prop of PROP_NAMES) {
		if (isLengthType(PROPS[prop].type)) entries.push([`PROPS.${prop}`, PROPS[prop].fallback]);
	}
	for (const prop of LAYOUT_PROP_NAMES) {
		if (isLengthType(LAYOUT_PROPS[prop].type)) {
			entries.push([`LAYOUT_PROPS.${prop}`, LAYOUT_PROPS[prop].fallback]);
		}
	}
	for (const kind of NODE_KINDS) {
		for (const [prop, value] of Object.entries(KINDS[kind].defaults)) {
			if (!isLengthType(PROPS[prop as keyof typeof PROPS].type)) continue;
			for (const term of value) {
				if (term.kind === "literal") entries.push([`KINDS.${kind}.${prop}`, term.value]);
			}
		}
	}
	for (const token of starterTokens()) {
		if (!isLengthType(token.type)) continue;
		for (const term of token.value) {
			if (term.kind === "literal") entries.push([`token ${token.id}`, term.value]);
		}
	}

	assert.ok(entries.length >= 8, "the sweep found the tables");
	for (const [where, text] of entries) {
		assert.notEqual(emuOf(text), undefined, `${where} falls back to "${text}"`);
	}
});

test("every size a table starts a node at is a whole number of pixels", () => {
	// These are EMU now, not pixel counts — a default size left at 480 would draw
	// a frame a twentieth of a pixel wide, which is a shape nobody can find.
	for (const kind of NODE_KINDS) {
		const { width, height } = KINDS[kind].defaultSize;
		for (const [axis, size] of [["width", width], ["height", height]] as const) {
			assert.equal(size % P, 0, `${kind} ${axis} is not a whole pixel`);
			assert.ok(size === 0 || size >= MIN_NODE_SIZE, `${kind} ${axis} is unusably small`);
		}
	}
	assert.deepEqual(DEFAULT_FRAME, { width: 720 * P, height: 480 * P });
});

test("the document a new file starts with is where it says it is", () => {
	const scene = emptyScene();
	assert.deepEqual(frameOf(scene.nodes[0]), {
		x: 0,
		y: 0,
		width: 720 * P,
		height: 480 * P,
	});
});
