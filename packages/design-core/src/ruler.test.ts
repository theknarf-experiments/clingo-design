import assert from "node:assert/strict";
import { test } from "node:test";

import {
	RULER_LABEL_GAP,
	RULER_MINOR_GAP,
	RULER_STEPS,
	rulerFor,
	rulerStep,
} from "./ruler.ts";
import {
	CSS_UNITS,
	EMU_PER_PX,
	UNITS,
	UNIT_NAMES,
	type Unit,
	cssPxFromEmu,
	spellsExactly,
} from "./units.ts";

/**
 * The ruler.
 *
 * Two claims carry the whole module and both are checked here rather than
 * argued in a comment: that a tick is a place a node could really be put, and
 * that no zoom the camera allows makes the labels collide or the ladder run
 * out.
 */

/** The zoom the camera clamps to — `DEFAULT_LIMITS` in canvas-core. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

/** Every zoom worth asking about, walked finely enough to catch a gap. */
const ZOOMS = Array.from({ length: 60 }, (_, i) => MIN_SCALE * (MAX_SCALE / MIN_SCALE) ** (i / 59));

const px = (n: number) => n * EMU_PER_PX;

test("every rung is a whole EMU its own unit can spell", () => {
	// The free property worth pinning: a tick never marks a place a node could
	// not be put. It holds because 914400 is divisible by every subdivision the
	// ladders are written with — and it would stop holding the moment somebody
	// added a rung of a third of an inch.
	for (const unit of UNIT_NAMES) {
		for (const rung of RULER_STEPS[unit]) {
			assert.ok(Number.isInteger(rung), `${unit} rung ${rung} is not a whole EMU`);
			assert.ok(rung > 0, `${unit} rung ${rung} is not positive`);
			assert.ok(spellsExactly(rung, unit), `${unit} cannot spell its own rung ${rung}`);
		}
	}
});

test("every ladder ascends, strictly", () => {
	// `rulerStep` takes the first rung that is wide enough and `minorFor` walks
	// up until it passes the step; both read the order as a guarantee.
	for (const unit of UNIT_NAMES) {
		const ladder = RULER_STEPS[unit];
		for (let i = 1; i < ladder.length; i++) {
			assert.ok(ladder[i] > ladder[i - 1], `${unit} rung ${i} does not rise`);
		}
	}
});

test("no zoom the camera allows runs the ladder out at either end", () => {
	// The claim the finite ladders rest on. Clamping at the coarse end means
	// labels that collide; clamping at the fine end means a ruler needlessly
	// coarser than the zoom deserves. Neither may happen inside the camera's
	// own limits — outside them, clamping is exactly the intended answer.
	for (const unit of CSS_UNITS) {
		const ladder = RULER_STEPS[unit];
		for (const scale of ZOOMS) {
			const { step } = rulerStep(unit, scale);
			assert.notEqual(
				step,
				ladder[ladder.length - 1],
				`${unit} at ${scale}× reached the top of its ladder`,
			);
			assert.notEqual(step, ladder[0], `${unit} at ${scale}× reached the bottom of its ladder`);
		}
	}
});

test("labels never close up, at any zoom or in any unit", () => {
	for (const unit of CSS_UNITS) {
		for (const scale of ZOOMS) {
			const { step } = rulerStep(unit, scale);
			assert.ok(
				cssPxFromEmu(step) * scale >= RULER_LABEL_GAP,
				`${unit} at ${scale}× labels ${cssPxFromEmu(step) * scale}px apart`,
			);
		}
	}
});

test("the minor marks divide the step and stay apart", () => {
	for (const unit of CSS_UNITS) {
		for (const scale of ZOOMS) {
			const { step, minor } = rulerStep(unit, scale);
			assert.equal(step % minor, 0, `${unit} at ${scale}×: ${minor} does not divide ${step}`);
			assert.ok(minor <= step);
			if (minor < step) {
				assert.ok(
					cssPxFromEmu(minor) * scale >= RULER_MINOR_GAP,
					`${unit} at ${scale}× marks ${cssPxFromEmu(minor) * scale}px apart`,
				);
			}
		}
	}
});

test("an inch ruler at 100% is marked in sixteenths", () => {
	// The sentence the derived minor exists for. A ladder read with a decimal
	// rule would offer fifths of an inch here, and a hand-written division
	// count would have had to guess.
	const { step, minor } = rulerStep("in", 1);
	assert.equal(step, UNITS.in.per);
	assert.equal(minor, UNITS.in.per / 16);
});

test("a pixel ruler at 100% counts in hundreds and marks tens", () => {
	const { step, minor } = rulerStep("px", 1);
	assert.equal(step, px(100));
	assert.equal(minor, px(10));
});

test("a centimetre ruler is marked in millimetres, once they fit", () => {
	// Not a coincidence to be factored out of the table: millimetres are what a
	// centimetre ruler is marked in, and the ladder says so on its own line. At
	// 100% a millimetre is under four screen pixels, so the marks stand off at
	// two; lean in and they arrive.
	assert.equal(rulerStep("cm", 1).minor, 2 * UNITS.mm.per);
	assert.equal(rulerStep("cm", 2).minor, UNITS.mm.per);
});

test("the ticks are whole steps from the zero point, not from the origin", () => {
	// The difference between a ruler with a movable zero and one with a movable
	// caption: the marks themselves move.
	const zero = px(37);
	const { ticks, step } = rulerFor({
		from: px(-500),
		to: px(500),
		zero,
		unit: "px",
		scale: 1,
	});
	assert.ok(ticks.length > 0);
	// `=== 0` rather than `assert.equal(…, 0)`: a tick left of zero leaves a
	// remainder of negative zero, which is the same place and a different value.
	for (const tick of ticks) assert.ok((tick.at - zero) % step === 0);
	const home = ticks.find((t) => t.at === zero);
	assert.equal(home?.label, "0");
});

test("labels read in the display unit, and count both ways from zero", () => {
	const { ticks } = rulerFor({ from: px(-250), to: px(250), zero: 0, unit: "px", scale: 1 });
	assert.deepEqual(
		ticks.map((t) => t.label),
		["-200", "-100", "0", "100", "200"],
	);
	// The same span said in millimetres: 250px is 66mm, so it is read in
	// twenties rather than hundreds, and by the same arithmetic.
	const mm = rulerFor({ from: px(-250), to: px(250), zero: 0, unit: "mm", scale: 1 });
	assert.deepEqual(
		mm.ticks.map((t) => t.label),
		["-60", "-40", "-20", "0", "20", "40", "60"],
	);
});

test("a label carries only the decimals its own step needs", () => {
	// Quarter inches say "0.25"; the whole inches among them say "1", not
	// "1.00". Zoomed out to whole inches, nothing carries a point at all.
	const quarters = rulerFor({ from: 0, to: UNITS.in.per, zero: 0, unit: "in", scale: 3 });
	assert.equal(quarters.step, UNITS.in.per / 4);
	assert.deepEqual(
		quarters.ticks.map((t) => t.label),
		["0", "0.25", "0.5", "0.75", "1"],
	);
	const inches = rulerFor({ from: 0, to: 4 * UNITS.in.per, zero: 0, unit: "in", scale: 1 });
	assert.deepEqual(
		inches.ticks.map((t) => t.label),
		["0", "1", "2", "3", "4"],
	);
});

test("a ruler has no direction", () => {
	const forward = rulerFor({ from: 0, to: px(400), zero: 0, unit: "px", scale: 1 });
	const backward = rulerFor({ from: px(400), to: 0, zero: 0, unit: "px", scale: 1 });
	assert.deepEqual(backward, forward);
});

test("zooming out coarsens the ruler and never reverses it", () => {
	// Monotonicity is what stops the marks flickering between two steps as the
	// camera moves: pull back and the ruler can only get coarser.
	for (const unit of CSS_UNITS) {
		let previous = 0;
		for (const scale of [...ZOOMS].reverse()) {
			const { step } = rulerStep(unit, scale);
			assert.ok(step >= previous, `${unit} got finer on the way out at ${scale}×`);
			previous = step;
		}
	}
});

test("a camera nobody clamped gets a coarse ruler rather than a hung tab", () => {
	// Not reachable through the canvas, which clamps its own scale — but a
	// division by a zero step or a loop over a mile of ticks is the kind of
	// failure that takes the whole editor with it.
	for (const scale of [0, -1, Number.NaN, 1e-9]) {
		const { step, minor } = rulerStep("px", scale);
		assert.equal(step, RULER_STEPS.px[RULER_STEPS.px.length - 1]);
		assert.equal(minor, step);
	}
	const huge = rulerFor({ from: 0, to: px(1e9), zero: 0, unit: "px", scale: 1 });
	assert.ok(huge.ticks.length <= 512);
});

test("every unit has a ladder, including the one nobody draws in", () => {
	// The table is total on purpose: a unit added to UNITS cannot reach a ruler
	// without somebody deciding how it is read.
	for (const unit of UNIT_NAMES) {
		assert.ok(RULER_STEPS[unit as Unit].length > 0);
	}
});
