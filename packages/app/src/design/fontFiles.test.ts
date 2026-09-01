/**
 * What a font file says about itself, and what a menu calls what it says.
 *
 * The reader in `fontFiles.ts` is two hundred lines of arithmetic over a
 * `DataView`, and the one field where being wrong has a consequence is
 * `weight`: declared as a single number, a variable face is clamped by the
 * browser to its default instance and every other weight comes out as a
 * synthesised faux bold; declared as a range, a static face claims weights it
 * does not have and 700 renders as Regular with no synthesis at all. Both
 * failures are silent, they are in opposite directions, and neither is visible
 * anywhere but a preview strip a person has to look at. So the reader is pinned
 * here, on bytes this file builds, rather than on a checked-in typeface — a
 * fixture whose licence and whose four hundred kilobytes would both be paid for
 * one assertion about a table directory.
 *
 * The family *name* deliberately gets a lighter test than the weight, and the
 * asymmetry is the design's: the name is ours, `new FontFace(name, bytes)` takes
 * it as an argument, and a misread `name` table is a field a designer corrects
 * rather than a design that does not paint.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { type Scene, emptyScene } from "@clingo-design/design-core";

import {
	describeFont,
	fontMenu,
	fontOptions,
	isFontPath,
	stemOf,
} from "./fontFiles.ts";

/* ------------------------------------------------------------------ */
/* A very small SFNT                                                   */
/* ------------------------------------------------------------------ */

/**
 * An SFNT holding exactly the tables the reader looks at.
 *
 * Not a valid font — no `glyf`, no `cmap`, nothing a rasteriser could use — and
 * that is on purpose: what is under test is the walk of the table directory, and
 * the bytes never reach a font engine, because the upload flow validates with
 * `FontFace.load()` *before* this reader runs and a file the browser refuses
 * never gets here at all.
 */
function sfnt(tables: Array<{ tag: string; body: Uint8Array }>): Uint8Array {
	const head = 12 + tables.length * 16;
	const total = tables.reduce((sum, t) => sum + t.body.length, head);
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x00010000);
	view.setUint16(4, tables.length);
	let at = head;
	tables.forEach((table, i) => {
		const record = 12 + i * 16;
		for (let c = 0; c < 4; c++) out[record + c] = table.tag.charCodeAt(c);
		view.setUint32(record + 8, at);
		view.setUint32(record + 12, table.body.length);
		out.set(table.body, at);
		at += table.body.length;
	});
	return out;
}

/** An `fvar` table with one axis per entry, in the layout the spec gives. */
function fvar(axes: Array<{ tag: string; min: number; def: number; max: number }>): Uint8Array {
	const body = new Uint8Array(16 + axes.length * 20);
	const view = new DataView(body.buffer);
	view.setUint16(0, 1); // major version
	view.setUint16(4, 16); // offset to the axis array
	view.setUint16(8, axes.length);
	view.setUint16(10, 20); // one axis record's size
	axes.forEach((axis, i) => {
		const at = 16 + i * 20;
		for (let c = 0; c < 4; c++) body[at + c] = axis.tag.charCodeAt(c);
		view.setInt32(at + 4, axis.min * 65536);
		view.setInt32(at + 8, axis.def * 65536);
		view.setInt32(at + 12, axis.max * 65536);
	});
	return body;
}

/** An `OS/2` big enough to hold `usWeightClass` and the italic bit. */
function os2(weightClass: number, italic: boolean): Uint8Array {
	const body = new Uint8Array(78);
	const view = new DataView(body.buffer);
	view.setUint16(4, weightClass);
	view.setUint16(62, italic ? 1 : 0);
	return body;
}

/** A `name` table with one Windows UTF-16BE string per entry. */
function nameTable(entries: Array<{ id: number; text: string }>): Uint8Array {
	const strings = entries.map((e) => {
		const bytes = new Uint8Array(e.text.length * 2);
		const view = new DataView(bytes.buffer);
		for (let c = 0; c < e.text.length; c++) view.setUint16(c * 2, e.text.charCodeAt(c));
		return bytes;
	});
	const head = 6 + entries.length * 12;
	const size = strings.reduce((sum, s) => sum + s.length, head);
	const body = new Uint8Array(size);
	const view = new DataView(body.buffer);
	view.setUint16(0, 0);
	view.setUint16(2, entries.length);
	view.setUint16(4, head);
	let at = head;
	entries.forEach((entry, i) => {
		const record = 6 + i * 12;
		view.setUint16(record, 3); // Windows
		view.setUint16(record + 6, entry.id);
		view.setUint16(record + 8, strings[i].length);
		view.setUint16(record + 10, at - head);
		body.set(strings[i], at);
		at += strings[i].length;
	});
	return body;
}

/* ------------------------------------------------------------------ */
/* Reading one                                                         */
/* ------------------------------------------------------------------ */

test("a variable face declares its range, so a weight the designer asked for is one the type designer drew", () => {
	const bytes = sfnt([
		{ tag: "OS/2", body: os2(400, false) },
		{ tag: "fvar", body: fvar([{ tag: "wght", min: 100, def: 400, max: 900 }]) },
		{ tag: "name", body: nameTable([{ id: 16, text: "Inter" }]) },
	]);
	const found = describeFont("InterVariable.ttf", bytes);
	// The range and not the class, which is the whole of variable-weight support:
	// `usWeightClass` is 400 on this file and declaring that would clamp the face
	// to its default instance and fake every other weight.
	assert.equal(found.weight, "100 900");
	assert.equal(found.family, "Inter");
	assert.equal(found.style, "normal");
	assert.deepEqual(found.axes, [{ tag: "wght", min: 100, def: 400, max: 900 }]);
});

test("a static face declares the one weight it has, and its italic bit is read", () => {
	const bytes = sfnt([
		{ tag: "OS/2", body: os2(700, true) },
		{ tag: "name", body: nameTable([{ id: 1, text: "Studio Mono Bold" }]) },
	]);
	const found = describeFont("Mono-BoldItalic.otf", bytes);
	// A range here would claim weights the file does not have, and 700 would come
	// out as Regular with no synthesis at all — the opposite failure, equally
	// silent.
	assert.equal(found.weight, "700");
	assert.equal(found.style, "italic");
	assert.equal(found.axes, undefined);
});

test("a width axis becomes a stretch descriptor, and only where there is one", () => {
	const wide = describeFont(
		"Recursive.ttf",
		sfnt([
			{ tag: "OS/2", body: os2(400, false) },
			{
				tag: "fvar",
				body: fvar([
					{ tag: "wght", min: 300, def: 400, max: 1000 },
					{ tag: "wdth", min: 75, def: 100, max: 125 },
				]),
			},
		]),
	);
	assert.equal(wide.stretch, "75% 125%");
	// Absent rather than "100%", so "this file has no width axis" has one
	// spelling — see {@link FontFile.stretch}.
	const plain = describeFont(
		"Plain.ttf",
		sfnt([{ tag: "OS/2", body: os2(400, false) }]),
	);
	assert.equal(plain.stretch, undefined);
});

test("nameID 16 beats nameID 1, which is the difference between Inter and Inter SemiBold", () => {
	const bytes = sfnt([
		{ tag: "OS/2", body: os2(600, false) },
		{
			tag: "name",
			body: nameTable([
				{ id: 1, text: "Inter SemiBold" },
				{ id: 16, text: "Inter" },
			]),
		},
	]);
	// The legacy family name is capped at four styles, so a large family splits
	// itself across several of them and only the typographic name says what the
	// typeface is.
	assert.equal(describeFont("Inter-SemiBold.ttf", bytes).family, "Inter");
});

test("a file the reader cannot walk is described from its name and never refused", () => {
	// A `.woff2` is Brotli and no web API decompresses it, so this is the common
	// case rather than the damaged one — and it has to land in the panel with
	// editable fields rather than as an error, because the family name is ours and
	// a wrong label is a field to correct.
	const guessed = describeFont("Fraunces[SOFT,WONK,opsz,wght].woff2", new Uint8Array(8));
	assert.equal(guessed.family, "Fraunces");
	// A file that says it is variable is variable whatever else its name claims.
	assert.equal(guessed.weight, "100 900");
	assert.equal(guessed.style, "normal");

	const bold = describeFont("SourceSerif-BoldItalic.woff", new Uint8Array(8));
	assert.equal(bold.family, "Source Serif");
	assert.equal(bold.weight, "700");
	assert.equal(bold.style, "italic");

	// Truncated bytes with an SFNT extension: the reader gives up and the
	// filename answers, which is the same answer a woff2 gets.
	const broken = describeFont("Nothing-Light.ttf", new Uint8Array([0, 1, 0, 0, 0, 9]));
	assert.equal(broken.weight, "300");
	assert.equal(broken.family, "Nothing");
});

/* ------------------------------------------------------------------ */
/* What a menu offers                                                  */
/* ------------------------------------------------------------------ */

test("a path is a font by its extension, and a stem is what a person named it", () => {
	assert.equal(isFontPath("/assets/InterVariable.woff2"), true);
	assert.equal(isFontPath("/assets/Fraunces.TTF"), true);
	assert.equal(isFontPath("/assets/hero.png"), false);
	assert.equal(isFontPath("/assets/chair.glb"), false);
	assert.equal(stemOf("/assets/InterVariable.woff2"), "InterVariable");
});

test("the page's own families come first, and the four system stacks stay underneath", () => {
	const scene: Scene = {
		...emptyScene(),
		fonts: [
			{
				src: "/assets/InterVariable.woff2",
				family: "Inter Var",
				weight: "100 900",
				style: "normal",
				bytes: 253_000,
				name: "InterVariable.woff2",
			},
		],
	};
	const menu = fontOptions(scene);
	assert.equal(menu[0].label, "Inter Var");
	// The stored value is an ordinary CSS stack with a real tail behind it, which
	// is what paints while the face loads, what paints if the file never arrives,
	// and what an SVG export paints always.
	assert.match(menu[0].value, /^"Inter Var", /);
	assert.ok(menu.length > 1, "the system stacks are always offered underneath");
	// And the merge is a `font` question only: every other row keeps the type's
	// own list, which `ValueEditor` reads from a missing prop.
	assert.equal(fontMenu(scene, "font")?.length, menu.length);
	assert.equal(fontMenu(scene, "color"), undefined);
	assert.equal(fontMenu(emptyScene(), "font")?.[0].label, fontOptions(emptyScene())[0].label);
});

test("a document that declares no fonts offers exactly what it always offered", () => {
	// The regression that keeps the four system stacks where they were: the
	// roster is a *declaration*, so a page with none is a page whose menu is the
	// one it had before this feature existed.
	assert.deepEqual(fontOptions(emptyScene()), [
		...fontOptions({ ...emptyScene(), fonts: [] }),
	]);
});
