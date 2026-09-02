import assert from "node:assert/strict";
import { test } from "node:test";

import { derive, lit, ref } from "@clingo-design/design-core";

import { curveTarget, placeCurve, shownPoint, typedPoint, writeCurve } from "./curveFields.ts";

/**
 * The keyboard end of a bespoke curve.
 *
 * Every assertion here is a bug that shipped and that no test in the repository
 * could see, because both of them live between a `<input>` and a `Value` and the
 * app's suite has no DOM. They were found by typing into the panel in a browser;
 * they are pinned here so that finding them again costs a `node --test`.
 */

test("a control point is a ratio, and the half-typed states are not numbers yet", () => {
	// Thousandths, through the same bridge a range end and a blend threshold
	// reach the program by — `Number(text) * 1000` was what shipped, and it reads
	// three things no document literal may hold.
	assert.equal(typedPoint("0.42"), 420);
	assert.equal(typedPoint("1"), 1000);
	assert.equal(typedPoint("-0.2"), -200);
	assert.equal(typedPoint("1.4"), 1400, "out of range is a curve the document keeps and refuses");
	// The nearest reader and not the exact one, because this is a field somebody
	// is typing into: `permilleOf` would blank the row on a half-thousandth.
	assert.equal(typedPoint("0.3335"), 334);

	// **The bug.** Every one of these is a keystroke on the way to a number, and
	// every one of them must leave the document alone — `Number("-") || 0` made
	// the first of them a zero, the controlled field snapped back over the minus
	// sign, and `-0.2` typed one key at a time arrived as `2`.
	for (const half of ["", "-", "0.", "-0.", ".", "-."]) {
		assert.equal(typedPoint(half), undefined, JSON.stringify(half));
	}
	// And the things `Number` would have taken and a literal cannot hold.
	for (const wrong of ["1e3", "Infinity", "0x10", "50%"]) {
		assert.equal(typedPoint(wrong), undefined, wrong);
	}
});

test("a point is spelled back the way a person typed it", () => {
	assert.equal(shownPoint(420), "0.42");
	assert.equal(shownPoint(1000), "1");
	assert.equal(shownPoint(-200), "-0.2");
	// Never "-0", which is what a field that showed a sign for a magnitude that
	// rounds to nothing would say.
	assert.equal(shownPoint(0), "0");
	assert.equal(writeCurve([200, 0, 0, 1000]), "cubicBezier(200,0,0,1000)");
});

test("four keystrokes land in one alternative and leave the rest alone", () => {
	// **The second bug.** The field wrote `[lit(text)]`, so a row holding the two
	// feels this whole feature exists for — the crisp reading and the playful one
	// — collapsed to one curve and the space halved the moment a handle moved.
	const feel = [lit("easeOut"), lit("springBouncy")];
	assert.deepEqual(placeCurve(feel, 0, "cubicBezier(200,0,0,1000)"), [
		lit("cubicBezier(200,0,0,1000)"),
		lit("springBouncy"),
	]);
	assert.deepEqual(placeCurve(feel, 1, "cubicBezier(200,0,0,1000)"), [
		lit("easeOut"),
		lit("cubicBezier(200,0,0,1000)"),
	]);
	// A transition that says nothing about its curve takes the default, and the
	// first keystroke is what mints the one alternative that holds what was typed.
	assert.deepEqual(placeCurve([], 0, "cubicBezier(200,0,0,1000)"), [
		lit("cubicBezier(200,0,0,1000)"),
	]);
});

test("the fields write into the alternative this universe is using", () => {
	const feel = [lit("easeOut"), lit("springBouncy")];
	// The one the drawing beside the fields is drawing, so a handle moved on the
	// second feel does not land in the first.
	assert.equal(curveTarget(feel, 1), 1);
	// No answer set in hand yet, and the position is the index for a document
	// value — which is what `ValueEditor` says where it defines `at`.
	assert.equal(curveTarget(feel, undefined), 0);
	// A pick that is not a position of this value cannot be trusted to index it.
	assert.equal(curveTarget(feel, 7), 0);
	assert.equal(curveTarget([], undefined), 0, "nothing stored is still editable");
});

test("a token is not typed over", () => {
	// The third thing the old field did quietly: a row following a `curve` token
	// had the reference overwritten by one keystroke, so a feel a design system
	// decided once became a number typed on one edge. `ValueEditor` disables the
	// literal box for exactly this term one row up.
	assert.equal(curveTarget([ref("curve")], 0), undefined);
	assert.equal(curveTarget([derive("contrast", "curve")], 0), undefined);
	// And only for the alternative it applies to: the literal beside it is still
	// a curve somebody may type.
	assert.equal(curveTarget([ref("curve"), lit("easeOut")], 1), 1);
});
