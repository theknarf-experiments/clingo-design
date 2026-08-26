import assert from "node:assert/strict";
import { test } from "node:test";

import {
	CSS_UNITS,
	DEFAULT_UNIT,
	EMU_PER_PX,
	UNITS,
	UNIT_NAMES,
	cssPxFromEmu,
	displayLength,
	emuFromCssPx,
	emuOf,
	formatLength,
	nearestEmu,
	quantizeGesture,
	snapToUnit,
	spellsExactly,
	unitOf,
	wholeEmu,
} from "./units.ts";

test("the table is CSS's own absolute-unit table, scaled", () => {
	// 1in = 96px = 72pt = 6pc = 25.4mm = 2.54cm, and 914400 EMU is an inch.
	// If any of these stopped holding, a conversion somewhere would round.
	assert.equal(UNITS.in.per, 914400);
	assert.equal(UNITS.in.per, 96 * UNITS.px.per);
	assert.equal(UNITS.in.per, 72 * UNITS.pt.per);
	assert.equal(UNITS.in.per, 6 * UNITS.pc.per);
	assert.equal(10 * UNITS.in.per, 254 * UNITS.mm.per);
	assert.equal(UNITS.cm.per, 10 * UNITS.mm.per);
	assert.equal(UNITS.emu.per, 1);
	assert.equal(EMU_PER_PX, UNITS.px.per, "read off the table, not typed twice");
	assert.equal(DEFAULT_UNIT, "px");
	assert.deepEqual(CSS_UNITS, ["px", "pt", "pc", "mm", "cm", "in"], "not emu");
});

test("step is the least EMU a unit can spell, and nothing below it", () => {
	for (const unit of UNIT_NAMES) {
		const { step } = UNITS[unit];
		for (let e = 1; e < step; e++) {
			assert.equal(
				spellsExactly(e, unit),
				false,
				`${e}emu should not be spellable in ${unit}`,
			);
			assert.equal(
				formatLength(e, unit).endsWith(UNITS[unit].symbol),
				unit === "emu",
				`${e}emu should fall back rather than be written in ${unit}`,
			);
		}
		assert.equal(spellsExactly(step, unit), true);
		assert.equal(
			emuOf(formatLength(step, unit)),
			step,
			`${unit}'s own lattice step must survive the round trip`,
		);
		assert.match(formatLength(step, unit), new RegExp(`${unit}$`));
	}
});

test("every unit round-trips exactly, for every value it can spell", () => {
	// The law the whole module exists for: emuOf(formatLength(e, u)) === e.
	// Spread across signs, magnitudes and lattice offsets rather than a run of
	// small integers, since the interesting failures are in the decimals.
	for (const unit of UNIT_NAMES) {
		const { step, per } = UNITS[unit];
		const values = [
			0,
			step,
			-step,
			per,
			7 * per,
			-3 * per,
			step * 17,
			per + step,
			per * 1000 + step * 3,
			-(per * 41 + step * 5),
		];
		for (const e of values) {
			const written = formatLength(e, unit);
			assert.equal(emuOf(written), e, `${e} written as ${written} in ${unit}`);
		}
	}
});

test("a length reads as the exact number of EMU it is", () => {
	assert.equal(emuOf("24px"), 228600);
	assert.equal(emuOf("24"), 228600, "a bare number is pixels");
	assert.equal(emuOf("0"), 0);
	assert.equal(emuOf("1in"), 914400);
	assert.equal(emuOf("12pt"), 152400);
	assert.equal(emuOf("1pc"), 152400, "a pica is twelve points");
	assert.equal(emuOf("25.4mm"), 914400);
	assert.equal(emuOf("2.54cm"), 914400);
	assert.equal(emuOf("0.1mm"), 3600, "a tenth of a millimetre is exact");
	assert.equal(emuOf("0.25in"), 228600);
	assert.equal(emuOf("-0.5in"), -457200);
	assert.equal(emuOf("+24px"), 228600);
	assert.equal(emuOf("24 px"), 228600, "a typed space is not a mistake");
	assert.equal(emuOf("24PX"), 228600, "CSS units are case-insensitive");
	assert.equal(emuOf("228600emu"), 228600);
});

test("a value no unit can hold reads as no length at all", () => {
	// Half a CSS pixel is 14287.5 EMU and 9525 is odd, so it is not a length.
	assert.equal(emuOf("1.5px"), undefined);
	assert.equal(emuOf("20.5px"), undefined);
	assert.equal(emuOf("0.5px"), undefined);
	// The pre-existing contract, unchanged: anything that is not a number with
	// a unit says nothing rather than its leading digits.
	assert.equal(emuOf("50%"), undefined);
	assert.equal(emuOf("calc(1px + 2px)"), undefined);
	assert.equal(emuOf("auto"), undefined);
	assert.equal(emuOf("1e3px"), undefined);
	assert.equal(emuOf("12rem"), undefined, "a relative unit is not absolute");
	assert.equal(emuOf(""), undefined);
	// Past 2^53 the integer would not survive being a `number`.
	assert.equal(emuOf("99999999999999999999px"), undefined);
});

test("unitOf reads the spelling, where emuOf reads the number", () => {
	// What an edit needs in order to give a designer their own units back: the
	// suffix, without the value, and with a bare number meaning what it has always
	// meant here.
	assert.equal(unitOf("12pt"), "pt");
	assert.equal(unitOf("0.25IN"), "in");
	assert.equal(unitOf("24"), DEFAULT_UNIT);
	assert.equal(unitOf("228600emu"), "emu");
	// Not a length, so there is no unit to keep — the caller writes in px, which
	// is what it would have done anyway.
	assert.equal(unitOf("50%"), undefined);
	assert.equal(unitOf("12rem"), undefined);
	// A value emuOf refuses still has a spelling: refusing is about the number.
	assert.equal(emuOf("1.5px"), undefined);
	assert.equal(unitOf("1.5px"), "px");
});

test("a lattice value in one unit is usually still exact in another", () => {
	// This is what keeps the fallback chain from firing: a point nudged by a
	// pixel is 22225 EMU, which is exactly 1.75pt.
	assert.equal(emuOf("1pt"), 12700);
	assert.equal(12700 + EMU_PER_PX, 22225);
	assert.equal(formatLength(22225, "pt"), "1.75pt");
	assert.equal(emuOf("1.75pt"), 22225);
});

test("formatLength keeps the unit it was asked for, then falls back", () => {
	assert.equal(formatLength(228600, "px"), "24px");
	assert.equal(formatLength(228600, "in"), "0.25in");
	assert.equal(formatLength(381, "px"), "0.04px", "the finest a pixel can say");
	assert.equal(formatLength(0, "mm"), "0mm");
	assert.equal(formatLength(-228600, "pt"), "-18pt");
	// 14288 is off every CSS lattice, so it says so out loud rather than lying.
	assert.equal(formatLength(14288, "px"), "14288emu");
	assert.equal(emuOf(formatLength(14288, "px")), 14288);
	// Off the requested unit's lattice but on the pixel one: pixels, not emu.
	assert.equal(formatLength(381, "in"), "0.04px");
	// And a whole number of pixels is still exact in inches, which is why the
	// chain so rarely gets past its first link.
	assert.equal(formatLength(3 * EMU_PER_PX, "in"), "0.03125in");
});

test("nearestEmu rounds where emuOf refuses, ties away from zero", () => {
	assert.equal(nearestEmu("1.5px"), 14288, "14287.5 goes away from zero");
	assert.equal(nearestEmu("-1.5px"), -14288);
	assert.equal(nearestEmu("24px"), 228600, "an exact value is untouched");
	assert.equal(nearestEmu("20.5px"), 195263);
	assert.equal(nearestEmu("50%"), undefined, "still not a length");
});

test("snapping is spellability; quantizing a gesture is one whole unit", () => {
	// The two must not be the same number. 20.5px is off the pixel lattice, and
	// snapping puts it on the nearest thing a pixel can spell — 0.04px apart —
	// where a gesture would have written a whole pixel.
	assert.equal(snapToUnit(195262.5, "px"), 195453);
	assert.equal(formatLength(195453, "px"), "20.52px");
	assert.equal(quantizeGesture(195262.5, "px"), 21 * EMU_PER_PX);
	assert.equal(formatLength(quantizeGesture(195262.5, "px"), "px"), "21px");
	// A hair is neither a pixel nor a lattice step away from where it started.
	assert.equal(quantizeGesture(228700, "px"), 228600);
	assert.equal(snapToUnit(228700, "px"), 228600);
	// A snapped value is spellable, which is the whole of what snapping means.
	for (const unit of CSS_UNITS) {
		for (const raw of [195262.5, -3.7, 1_000_000.25]) {
			assert.equal(spellsExactly(snapToUnit(raw, unit), unit), true);
			assert.equal(emuOf(formatLength(snapToUnit(raw, unit), unit)) !== undefined, true);
		}
	}
});

test("snapping is idempotent, so migrating twice changes nothing", () => {
	const once = snapToUnit(195262.5, "px");
	assert.equal(snapToUnit(once, "px"), once);
	assert.equal(quantizeGesture(quantizeGesture(195262.5, "px"), "px"), 200025);
});

test("wholeEmu names the quantization of a rational", () => {
	// clingo-lpx answers 320/3, and a third of an EMU is not storable.
	assert.equal(wholeEmu(320 / 3), 107);
	assert.equal(wholeEmu(-0.5), -1, "ties away from zero, like everything here");
	assert.equal(wholeEmu(0.5), 1);
	assert.equal(wholeEmu(228600), 228600);
});

test("the two float crossings agree with each other", () => {
	assert.equal(cssPxFromEmu(228600), 24);
	assert.equal(emuFromCssPx(24), 228600);
	assert.equal(cssPxFromEmu(emuFromCssPx(24)), 24);
	// The font engine hands back a float; it quantizes here and only here.
	assert.equal(emuFromCssPx(12.5), 119063);
	assert.equal(emuFromCssPx(0), 0);
});

test("displayLength reads a value without deciding how it is kept", () => {
	assert.equal(displayLength(228600, "px"), "24px");
	assert.equal(displayLength(228600, "in"), "0.25in");
	assert.equal(displayLength(14288, "px"), "1.5px", "rounded for the eye");
	assert.equal(displayLength(0, "px"), "0px");
	assert.equal(displayLength(-1, "px"), "0px", "not '-0px'");
	// Displaying is not storing: the rounded reading is not what goes on disk.
	assert.notEqual(displayLength(14288, "px"), formatLength(14288, "px"));
});
