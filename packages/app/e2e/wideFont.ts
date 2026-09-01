/**
 * A font fixture, built rather than checked in.
 *
 * The e2e claim this exists for is the one thing about imported fonts that
 * cannot be asserted headlessly: that a face added through the panel reaches
 * **pretext's module-scope `OffscreenCanvas`** and changes the widths the solver
 * fits boxes to. `document.fonts.add()` reaching an `OffscreenCanvas` created in
 * a Window context is a specification detail two layers away from any code in
 * this repo, and if it were false the whole of the measurement design would be
 * silently wrong in exactly the way it was written to prevent — a box measured
 * in the fallback, cached under the real family's key, for the life of the page.
 *
 * So the assertion has to be a width **inequality against a threshold**, and it
 * needs a face whose metrics differ from `system-ui` by more than a rounding.
 * The spec asks for "a condensed or monospace face, chosen and not grabbed".
 * This goes one better and *constructs* one, for three reasons:
 *
 *   - **The inequality cannot pass vacuously.** Every glyph here is exactly one
 *     em wide, so a string of *n* characters is *n* × the font size, which is
 *     roughly twice what any system sans gives. The threshold is not a guess
 *     about a foundry's metrics; it is arithmetic.
 *   - **No licence and no kilobytes.** A real family in the repo is a
 *     redistribution decision made on somebody's behalf — which is the same
 *     argument §8 of the fonts spec makes against a Google Fonts fetcher — and
 *     several hundred kilobytes in a repository that has never carried a binary.
 *   - **It is the same file on every machine.** A fixture that is "whatever
 *     monospace CI has" is a test whose threshold drifts with the runner.
 *
 * What it is *not* is a usable typeface: one glyph, a filled box, drawn for
 * every printable ASCII character. That is enough, because what is under test is
 * an advance width and not a shape — and it is honest about it, because a
 * fixture that looked like a typeface would invite somebody to assert something
 * about how it reads.
 *
 * The tables are the ten a browser's sanitiser insists on, written in the order
 * the specification numbers them and emitted in the order the table directory
 * requires (tag ascending, which puts `OS/2` in front of the lower-case nine).
 */

/** One em, and the advance every glyph in this face has. */
const EM = 1000;

/** A byte writer with just enough of a `DataView` to keep the offsets honest. */
class Bytes {
	private readonly out: number[] = [];

	u8(value: number): this {
		this.out.push(value & 0xff);
		return this;
	}
	u16(value: number): this {
		return this.u8(value >> 8).u8(value);
	}
	i16(value: number): this {
		return this.u16(value < 0 ? value + 0x10000 : value);
	}
	u32(value: number): this {
		return this.u16(value >>> 16).u16(value & 0xffff);
	}
	tag(text: string): this {
		for (const char of text) this.u8(char.charCodeAt(0));
		return this;
	}
	/** UTF-16BE, which is the only encoding the `name` table is read in here. */
	utf16(text: string): this {
		for (const char of text) this.u16(char.charCodeAt(0));
		return this;
	}
	zeros(count: number): this {
		for (let i = 0; i < count; i++) this.u8(0);
		return this;
	}
	get bytes(): Uint8Array {
		return new Uint8Array(this.out);
	}
}

/** A table's length rounded up to the four-byte boundary the format wants. */
const padded = (length: number): number => (length + 3) & ~3;

/** The sum of a table's big-endian uint32s, which is what a table record holds. */
function checksum(bytes: Uint8Array): number {
	let sum = 0;
	for (let at = 0; at < padded(bytes.length); at += 4) {
		const word =
			((bytes[at] ?? 0) << 24) |
			((bytes[at + 1] ?? 0) << 16) |
			((bytes[at + 2] ?? 0) << 8) |
			(bytes[at + 3] ?? 0);
		sum = (sum + (word >>> 0)) >>> 0;
	}
	return sum;
}

/** `head`, with the checksum adjustment left at zero until the file is whole. */
function head(): Uint8Array {
	return new Bytes()
		.u32(0x00010000) // version
		.u32(0x00010000) // fontRevision
		.u32(0) // checkSumAdjustment, patched once the file exists
		.u32(0x5f0f3cf5) // magicNumber
		.u16(0x000b) // flags
		.u16(EM) // unitsPerEm
		.zeros(8) // created
		.zeros(8) // modified
		.i16(0)
		.i16(0)
		.i16(EM)
		.i16(EM) // bounding box
		.u16(0) // macStyle
		.u16(8) // lowestRecPPEM
		.i16(2) // fontDirectionHint
		.i16(0) // indexToLocFormat: short
		.i16(0) // glyphDataFormat
		.bytes;
}

function hhea(): Uint8Array {
	return new Bytes()
		.u32(0x00010000)
		.i16(800) // ascender
		.i16(-200) // descender
		.i16(0) // lineGap
		.u16(EM) // advanceWidthMax
		.i16(0) // minLeftSideBearing
		.i16(0) // minRightSideBearing
		.i16(EM) // xMaxExtent
		.i16(1) // caretSlopeRise
		.i16(0) // caretSlopeRun
		.i16(0) // caretOffset
		.zeros(8) // four reserved
		.i16(0) // metricDataFormat
		.u16(2) // numberOfHMetrics
		.bytes;
}

function maxp(): Uint8Array {
	return new Bytes()
		.u32(0x00010000)
		.u16(2) // numGlyphs
		.u16(4) // maxPoints
		.u16(1) // maxContours
		.u16(0)
		.u16(0)
		.u16(2) // maxZones
		.u16(0)
		.u16(0)
		.u16(0)
		.u16(0)
		.u16(0)
		.u16(0)
		.u16(0)
		.u16(0)
		.bytes;
}

/** Both glyphs one em wide, which is the whole point of the fixture. */
function hmtx(): Uint8Array {
	return new Bytes().u16(EM).i16(0).u16(EM).i16(0).bytes;
}

/**
 * Every printable ASCII character mapped to the one drawn glyph, format 4.
 *
 * Two segments: `0x20`–`0x7e`, and the `0xffff` terminator the format requires,
 * whose delta of 1 wraps back to `.notdef`.
 *
 * The printable range goes through **`idRangeOffset` and a glyph array** rather
 * than through an `idDelta`, and the difference is the whole reason this
 * function has a comment. A delta maps a *run* — `c + delta` — so one delta over
 * ninety-five characters is ninety-five consecutive glyph ids, and a font with
 * two glyphs is rejected outright by the browser's sanitiser for referring to
 * glyph 95. What is wanted here is the opposite of a run: every character on the
 * one glyph, which is exactly what an explicit array says.
 */
function cmap(): Uint8Array {
	const first = 0x20;
	const last = 0x7e;
	const glyphs = last - first + 1;
	// From `&idRangeOffset[0]` to the start of the glyph array: two entries of
	// two bytes. The format measures this offset from the field itself, which is
	// what makes an array that follows the segments addressable at all.
	const toArray = 2 * 2;
	const subtable = new Bytes()
		.u16(4) // format
		.u16(32 + glyphs * 2) // length
		.u16(0) // language
		.u16(4) // segCountX2
		.u16(4) // searchRange
		.u16(1) // entrySelector
		.u16(0) // rangeShift
		.u16(last)
		.u16(0xffff) // endCode
		.u16(0) // reservedPad
		.u16(first)
		.u16(0xffff) // startCode
		.u16(0)
		.u16(1) // idDelta: none for the array segment, wrap for the terminator
		.u16(toArray)
		.u16(0); // idRangeOffset
	for (let i = 0; i < glyphs; i++) subtable.u16(1);
	const table = subtable.bytes;
	const head = new Bytes()
		.u16(0) // version
		.u16(1) // numTables
		.u16(3) // platformID: Windows
		.u16(1) // encodingID: Unicode BMP
		.u32(12) // offset
		.bytes;
	return new Uint8Array([...head, ...table]);
}

/**
 * `.notdef`, empty, and one filled box that fills most of the em.
 *
 * The box is drawn rather than left blank so that a person looking at a failing
 * run sees black rectangles where the words were and knows at once that the face
 * arrived. Simple coordinates, no short vectors and no instructions: this is a
 * fixture and legibility of the *bytes* is worth more here than their size.
 */
function glyf(): Uint8Array {
	const box = new Bytes()
		.i16(1) // numberOfContours
		.i16(60)
		.i16(0)
		.i16(940)
		.i16(700) // bounds
		.u16(3) // endPtsOfContours
		.u16(0) // instructionLength
		.u8(0x01)
		.u8(0x01)
		.u8(0x01)
		.u8(0x01) // four on-curve points
		.i16(60)
		.i16(880)
		.i16(0)
		.i16(-880) // x deltas
		.i16(0)
		.i16(0)
		.i16(700)
		.i16(0) // y deltas
		.bytes;
	const out = new Uint8Array(padded(box.length));
	out.set(box, 0);
	return out;
}

/** Short format, so every offset is halved — see `head.indexToLocFormat`. */
function loca(glyphLength: number): Uint8Array {
	return new Bytes().u16(0).u16(0).u16(glyphLength / 2).bytes;
}

/** Four Windows-platform names, which is the set a sanitiser looks for. */
function name(family: string): Uint8Array {
	const records: Array<{ id: number; text: string }> = [
		{ id: 1, text: family },
		{ id: 2, text: "Regular" },
		{ id: 4, text: family },
		{ id: 6, text: family.replace(/\s+/g, "") },
	];
	const strings = records.map((record) => new Bytes().utf16(record.text).bytes);
	const head = 6 + records.length * 12;
	const table = new Bytes().u16(0).u16(records.length).u16(head);
	let at = 0;
	records.forEach((record, i) => {
		table
			.u16(3) // platformID
			.u16(1) // encodingID
			.u16(0x0409) // languageID
			.u16(record.id)
			.u16(strings[i].length)
			.u16(at);
		at += strings[i].length;
	});
	const written = table.bytes;
	const out = new Uint8Array(written.length + at);
	out.set(written, 0);
	let cursor = written.length;
	for (const string of strings) {
		out.set(string, cursor);
		cursor += string.length;
	}
	return out;
}

/** Version 4, ninety-six bytes, monospaced and regular. */
function os2(): Uint8Array {
	return new Bytes()
		.u16(4) // version
		.i16(EM) // xAvgCharWidth
		.u16(400) // usWeightClass
		.u16(5) // usWidthClass
		.u16(0) // fsType: installable
		.i16(650)
		.i16(700)
		.i16(0)
		.i16(0) // subscript
		.i16(650)
		.i16(700)
		.i16(0)
		.i16(480) // superscript
		.i16(50)
		.i16(300) // strikeout
		.i16(8) // sFamilyClass
		// PANOSE, and the third byte is the one that matters: 9 is "monospaced",
		// which is what tells a renderer not to try to be clever about the widths.
		.u8(2)
		.u8(0)
		.u8(5)
		.u8(9)
		.zeros(6)
		.u32(1)
		.u32(0)
		.u32(0)
		.u32(0) // unicode ranges: basic latin
		.tag("DCFX") // achVendID
		.u16(0x0040) // fsSelection: regular
		.u16(0x20) // usFirstCharIndex
		.u16(0x7e) // usLastCharIndex
		.i16(800) // sTypoAscender
		.i16(-200) // sTypoDescender
		.i16(0) // sTypoLineGap
		.u16(800) // usWinAscent
		.u16(200) // usWinDescent
		.u32(1)
		.u32(0) // code page ranges: latin 1
		.i16(500) // sxHeight
		.i16(700) // sCapHeight
		.u16(0x20) // usDefaultChar
		.u16(0x20) // usBreakChar
		.u16(1) // usMaxContext
		.bytes;
}

/** Version 3.0: no glyph names, which is what a fixture wants. */
function post(): Uint8Array {
	return new Bytes()
		.u32(0x00030000)
		.u32(0) // italicAngle
		.i16(-100) // underlinePosition
		.i16(50) // underlineThickness
		.u32(1) // isFixedPitch
		.u32(0)
		.u32(0)
		.u32(0)
		.u32(0)
		.bytes;
}

/**
 * The fixture, as the bytes of a `.ttf`.
 *
 * The name is a caller's argument rather than a constant here for one reason
 * worth stating: the family the studio ends up calling this face is **ours**,
 * taken from the `name` table only as a suggested label, so a test that wants to
 * assert what the panel put in the field has to know what it wrote in the file.
 */
export function wideFont(family = "Wide Fixture"): Uint8Array {
	const glyphs = glyf();
	const tables: Array<{ tag: string; body: Uint8Array }> = [
		{ tag: "OS/2", body: os2() },
		{ tag: "cmap", body: cmap() },
		{ tag: "glyf", body: glyphs },
		{ tag: "head", body: head() },
		{ tag: "hhea", body: hhea() },
		{ tag: "hmtx", body: hmtx() },
		{ tag: "loca", body: loca(glyphs.length) },
		{ tag: "maxp", body: maxp() },
		{ tag: "name", body: name(family) },
		{ tag: "post", body: post() },
	];

	const count = tables.length;
	// The binary-search hints in the offset table. Wrong ones are tolerated by
	// every engine and are written correctly anyway, because a fixture that is
	// almost a font is the kind of thing a sanitiser rejects for a reason nobody
	// can find.
	const power = 2 ** Math.floor(Math.log2(count));
	const directory = new Bytes()
		.u32(0x00010000)
		.u16(count)
		.u16(power * 16)
		.u16(Math.log2(power))
		.u16(count * 16 - power * 16);

	let at = 12 + count * 16;
	const offsets: number[] = [];
	for (const table of tables) {
		offsets.push(at);
		directory
			.tag(table.tag)
			.u32(checksum(table.body))
			.u32(at)
			.u32(table.body.length);
		at += padded(table.body.length);
	}

	const file = new Uint8Array(at);
	file.set(directory.bytes, 0);
	tables.forEach((table, i) => file.set(table.body, offsets[i]));

	// `head.checkSumAdjustment` is defined as the amount that makes the whole
	// file sum to a magic constant, which cannot be known until the file exists —
	// so it is written last, into the table that was emitted with a zero there.
	const view = new DataView(file.buffer);
	const headAt = offsets[tables.findIndex((t) => t.tag === "head")];
	view.setUint32(headAt + 8, (0xb1b0afba - checksum(file)) >>> 0);
	return file;
}
