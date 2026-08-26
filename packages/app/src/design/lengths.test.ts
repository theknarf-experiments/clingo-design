import assert from "node:assert/strict";
import { test } from "node:test";

import {
	CSS_UNITS,
	UNITS,
	type Unit,
	emuOf,
	formatLength,
} from "@clingo-design/design-core";

import { documentUnit, shownEmu, shownLength, typedLength } from "./lengths.ts";

/**
 * The keyboard end of the unit system.
 *
 * Everything below the editor is EMU and exact; this is the seam where a person
 * types `210` into a field labelled `mm` and where a value stored as `"12pt"`
 * has to appear on a screen whose document is measured in something else. The
 * two directions round differently on purpose, so what is pinned here is which
 * one rounds, by how much, and what survives the trip back.
 */

test("a bare number means the unit the field is labelled with", () => {
	// The one place this disagrees with `emuOf`, which reads a bare number as
	// pixels because that is what every legacy literal in every document meant.
	assert.deepEqual(typedLength("210", "mm"), { emu: 7560000, text: "210mm" });
	assert.deepEqual(typedLength("210", "px"), { emu: 2000250, text: "210px" });
	assert.deepEqual(typedLength("8", "pt"), { emu: 101600, text: "8pt" });
});

test("a unit the person typed wins over the document's", () => {
	// Twelve points is twelve points in a millimetre document, and it is stored
	// saying so — a designer who spells a unit is not corrected.
	assert.deepEqual(typedLength("12pt", "mm"), { emu: 152400, text: "12pt" });
	assert.deepEqual(typedLength("0.25in", "px"), { emu: 228600, text: "0.25in" });
	// Case and the space a person leaves before the suffix, both tolerated here
	// because they are tolerated by the reader every stored length goes through.
	assert.deepEqual(typedLength("1 PX", "mm"), { emu: 9525, text: "1px" });
});

test("text that is not a length yet is not a length", () => {
	// The half-typed states a field passes through on the way to a number. Each
	// leaves the document alone, which is what lets the field commit per
	// keystroke without half a number reaching anyone else's screen.
	for (const input of ["", "-", "12.", ".5", "50%", "12q", "calc(1px)"]) {
		assert.equal(typedLength(input, "px"), undefined, input);
	}
});

test("a field reads in the document's unit, whatever the value is stored as", () => {
	assert.equal(shownLength("24px", "mm"), "6.35mm");
	assert.equal(shownLength("12pt", "px"), "16px");
	assert.equal(shownLength("210mm", "mm"), "210mm");
	// And rounds where the two units do not meet on a round number. 25px is
	// 6.6145833…mm; the field says five decimals of it, and the document goes
	// on holding the exact pixel until somebody types over it.
	assert.equal(shownLength("25px", "mm"), "6.61458mm");
});

test("a stored value that is not a length shows itself", () => {
	// Not a hole to plug. A field answering "0mm" would be claiming the document
	// says something it does not — the value may be a percentage, or may predate
	// the migration that put every length on the EMU lattice.
	assert.equal(shownLength("50%", "px"), "50%");
	assert.equal(shownLength("20.5px", "px"), "20.5px");
});

test("typing half a pixel keeps the number and admits the spelling", () => {
	// The one rounding a field is allowed: to the nearest EMU, not to the
	// nearest anything a designer chose. Half a CSS pixel is 4762.5 EMU and 9525
	// is odd, so the value that lands is 4763 — and no CSS unit spells it, which
	// is why the document says `emu` out loud rather than quietly saying 0.52px.
	assert.deepEqual(typedLength("0.5px", "px"), { emu: 4763, text: "4763emu" });
	assert.equal(shownEmu(4763, "px"), "0.5px");
});

test("a field may move a value once, and never again", () => {
	/*
	 * The whole promise of a field that rewrites itself. Editing a value the
	 * document's unit cannot say exactly is a rounding — `210mm` read in a pixel
	 * document displays as `793.7px`, and typing over that is agreeing to
	 * 793.7px — so the first pass is allowed to move it. Every pass after that
	 * must not: a value that drifted a little each time it was touched would be
	 * a value nobody could leave alone.
	 */
	for (const start of ["0.5px", "24px", "210mm", "12pt", "1.0001in"]) {
		const once = typedLength(start, "px");
		assert.ok(once, start);
		const twice = typedLength(shownLength(once.text, "px"), "px");
		assert.ok(twice, start);
		const thrice = typedLength(shownLength(twice.text, "px"), "px");
		assert.deepEqual(thrice, twice, start);
	}
	// And where the field is reading the unit the value is in, even the first
	// pass leaves it alone — which is every value in a document nobody has
	// changed the unit of.
	const mm = typedLength("210mm", "mm");
	assert.deepEqual(mm, { emu: 7560000, text: "210mm" });
	assert.deepEqual(typedLength(shownLength("210mm", "mm"), "mm"), mm);
	// A second edit is also where a value's *spelling* catches up with the
	// document, the number having been exact all along: twelve points read in a
	// pixel document is sixteen pixels, and typing over it stores it that way.
	assert.deepEqual(typedLength(shownLength("12pt", "px"), "px"), {
		emu: 152400,
		text: "16px",
	});
});

test("a whole number of any unit survives being shown and typed back", () => {
	// The round-trip law, at the panel: display rounds, so this holds where the
	// field is reading the unit the value was written in — which is the case
	// every document is in until somebody changes the document's unit.
	for (const unit of CSS_UNITS) {
		for (const n of [1, 3, 12, 210, 1000]) {
			const emu = n * UNITS[unit].per;
			const shown = shownLength(formatLength(emu, unit), unit);
			assert.deepEqual(
				typedLength(shown, unit),
				{ emu, text: formatLength(emu, unit) },
				`${n}${unit}`,
			);
		}
	}
});

test("nothing a field writes is a length the document cannot read back", () => {
	// The field is a writer, and every writer in this codebase owes `emuOf` a
	// value it can return exactly — otherwise the node it belongs to reads as
	// zero and goes to the origin.
	for (const unit of CSS_UNITS) {
		for (const input of ["0", "1", "-4", "7.5", "0.125", "999.999"]) {
			const typed = typedLength(input, unit);
			if (!typed) continue;
			assert.equal(emuOf(typed.text), typed.emu, `${input} in ${unit}`);
		}
	}
});

test("zero and negatives are lengths like any other", () => {
	assert.deepEqual(typedLength("0", "mm"), { emu: 0, text: "0mm" });
	assert.deepEqual(typedLength("-4", "px"), { emu: -38100, text: "-4px" });
	assert.equal(shownEmu(-9525, "px"), "-1px");
	// A hair below zero reads as zero rather than as "-0", which is true and
	// silly. `displayLength` is where that is decided; this is the field's stake
	// in it.
	assert.equal(shownEmu(-1, "px"), "0px");
});

test("a document with no unit is in pixels", () => {
	// Its absence is the pre-EMU format marker, so this is the same assumption
	// the migration makes, read from the other end.
	assert.equal(documentUnit({}), "px");
	assert.equal(documentUnit({ unit: "mm" }), "mm");
	for (const unit of CSS_UNITS) {
		assert.equal(documentUnit({ unit: unit as Unit }), unit);
	}
});
