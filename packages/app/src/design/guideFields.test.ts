import assert from "node:assert/strict";
import { test } from "node:test";

import {
	GUIDE_PROPS,
	GUIDE_PROP_NAMES,
	countOn,
	gutterOn,
	marginOn,
} from "@clingo-design/design-core";

import {
	MARGIN_FIELDS,
	TRACK_FIELDS,
	guideFieldLabel,
} from "./guideFields.ts";

/**
 * How a grid's settings reach a panel.
 *
 * The laws worth pinning are all of the shape "the panel and the table still
 * agree": everything the document can hold is somewhere a person can type it,
 * nothing is offered twice, and the words the fields go by are the table's own.
 * Every one of them stops being true the moment somebody adds a setting, which
 * is exactly when nobody is looking at this file.
 */

test("every setting of a grid is editable, and none of them twice", () => {
	// The one that matters: a setting `GUIDE_PROPS` gains but no field offers is
	// a setting a document can hold and a designer cannot reach. The panel falls
	// back to a full value row only for a setting that has stopped being one
	// number, so a new plain setting missing from both lists would simply not
	// appear anywhere.
	const offered = [...MARGIN_FIELDS, ...TRACK_FIELDS];
	assert.deepEqual(
		[...offered].sort(),
		[...GUIDE_PROP_NAMES].sort(),
		"every guide setting has a field",
	);
	assert.equal(new Set(offered).size, offered.length, "and only one");
});

test("the margins read in the order a margin is said in", () => {
	// Top, right, bottom, left — CSS's order, which is the order four margin
	// numbers are written in everywhere a designer has ever met them.
	assert.deepEqual(MARGIN_FIELDS, [
		marginOn("y", "lead"),
		marginOn("x", "trail"),
		marginOn("y", "trail"),
		marginOn("x", "lead"),
	]);
	assert.deepEqual(MARGIN_FIELDS.map(guideFieldLabel), [
		"top",
		"right",
		"bottom",
		"left",
	]);
});

test("a margin goes by its edge's name, because it is that edge", () => {
	// Not an abbreviation of the label: `marginLeft` and the `left` edge are the
	// same end of the same axis, which is the claim `GUIDE_PROPS`' axis and place
	// columns exist to make and the datum rules are written on. Renaming the
	// setting would not change this word, and it should not.
	for (const axis of ["x", "y"] as const) {
		for (const place of ["lead", "trail"] as const) {
			const prop = marginOn(axis, place);
			const spec = GUIDE_PROPS[prop];
			assert.equal(spec.axis, axis);
			assert.equal(spec.place, place);
			// One word, and a different one for each of the four.
			assert.ok(/^[a-z]+$/.test(guideFieldLabel(prop)));
		}
	}
	assert.equal(new Set(MARGIN_FIELDS.map(guideFieldLabel)).size, 4);
});

test("the tracks come out an axis at a time, count then gutter", () => {
	// Each pair is one line of a two-column panel, so it reads as a sentence:
	// twelve columns with a twenty gutter, then three rows with a twenty-four
	// one. Read through the table's own lookups, so a row grid is the column
	// grid on the other axis rather than a second list.
	assert.deepEqual(TRACK_FIELDS, [
		countOn("x"),
		gutterOn("x"),
		countOn("y"),
		gutterOn("y"),
	]);
	assert.deepEqual(
		TRACK_FIELDS.map((prop) => GUIDE_PROPS[prop].role),
		["count", "gutter", "count", "gutter"],
	);
});

test("a count and a gutter keep the table's own label", () => {
	// They are one word already, and the axis is what tells them apart — so the
	// two gutters must not collapse to one word, or the panel would show two
	// different settings under one name.
	assert.equal(guideFieldLabel(countOn("x")), GUIDE_PROPS[countOn("x")].label);
	assert.notEqual(
		guideFieldLabel(gutterOn("x")),
		guideFieldLabel(gutterOn("y")),
	);
	assert.equal(
		new Set(GUIDE_PROP_NAMES.map(guideFieldLabel)).size,
		GUIDE_PROP_NAMES.length,
		"no two fields go by one name",
	);
});

test("a count is not a length, which is what gives it its own control", () => {
	// The panel picks a spinner off `role === "count"`; that this is the same
	// division as the value type is what makes the choice honest rather than a
	// coincidence two tables happen to share.
	for (const prop of TRACK_FIELDS) {
		const spec = GUIDE_PROPS[prop];
		assert.equal(spec.type, spec.role === "count" ? "count" : "length");
	}
	for (const prop of MARGIN_FIELDS) {
		assert.equal(GUIDE_PROPS[prop].type, "length");
	}
});
