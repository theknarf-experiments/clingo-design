/**
 * The contract, tested with a target that does not exist.
 *
 * Every other test in this repository exercises the driver through a real
 * emitter — `export-html` has sixty-nine and they all go through `emit`. This
 * file is the other direction: a fake plugin that records what it was asked and
 * returns a fixed string, so that what is asserted is the *driver's* half of the
 * bargain rather than any target's.
 *
 * That is the test a plugin architecture is actually owed. The question "does
 * HTML export a gradient" is `export-html`'s; the question "does a target that
 * says it cannot collapse get one layer" belongs to nobody's package but this
 * one, and before the split there was no way to ask it without naming `"svg"`.
 *
 * It also found something. A target's `single` reason is *not* always the note:
 * where the space would not have collapsed anyway, `collapseSpace`'s own reason
 * is the more specific answer and wins. That ordering was implicit in the code
 * and is now written down twice — here, and in the test below that names it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { type Scene, emptyScene } from "@clingo-design/design-core";

import type { Emitter, ExportPlugin } from "./contract.ts";
import { targetFor } from "./contract.ts";
import { exportSpace, exportUniverse } from "./emit.ts";
import type { ExportUniverse } from "./options.ts";

/** An answer set with nothing drawn in it, which is all the driver needs. */
const universe = (): ExportUniverse => ({
	pick: {},
	model: { roots: [], byId: {}, looks: {}, shown: {}, wears: {} } as never,
});

const scene = (): Scene => emptyScene();

/** A target that records what the driver handed it. */
function fake(over: Partial<ExportPlugin> = {}) {
	const seen: { layers: number; loads: number } = { layers: 0, loads: 0 };
	const emit: Emitter = (_index, layers) => {
		seen.layers = layers.length;
		return { text: "FILE", classes: [], lost: ["what this document lost"] };
	};
	const plugin: ExportPlugin = {
		id: "fake",
		collapses: true,
		needs: [],
		usesTokens: true,
		spec: {
			label: "Fake",
			extension: "fake",
			mime: "text/plain",
			language: "text",
			loses: ["what this format loses"],
		},
		load: async () => {
			seen.loads += 1;
			return emit;
		},
		...over,
	};
	return { plugin, seen };
}

test("a target's own name and extension decide what comes back", async () => {
	const { plugin } = fake();
	const out = await exportUniverse(scene(), universe(), plugin, { title: "A page" });
	assert.equal(out.target, "fake");
	assert.equal(out.filename, "A-page.fake");
	assert.equal(out.text, "FILE");
});

test("a target may name its own file, and two of the three do not", async () => {
	// glTF is the one that does: a glTF is a scene, so a document with two
	// viewports has two files, and naming both after the page would put one name
	// on two artefacts.
	const { plugin } = fake({ filename: (base) => `${base}-view` });
	const out = await exportUniverse(scene(), universe(), plugin, { title: "A page" });
	assert.equal(out.filename, "A-page-view.fake");
	const plain = await exportUniverse(scene(), universe(), fake().plugin, { title: "A page" });
	assert.equal(plain.filename, "A-page.fake");
});

test("the driver's losses come first, then the format's, then the document's", async () => {
	const { plugin } = fake();
	const out = await exportUniverse(scene(), universe(), plugin, {});
	// The order is the argument: what is true of every export, then what is true
	// of this format, then what is true of this document. A reader goes from the
	// general to the particular without being told which is which.
	assert.match(out.lost[0], /^The space\./);
	assert.ok(out.lost.includes("what this format loses"));
	assert.ok(out.lost.includes("what this document lost"));
	assert.ok(
		out.lost.indexOf("what this format loses") < out.lost.indexOf("what this document lost"),
	);
});

test("a target that cannot collapse is handed one layer, whatever it was asked for", async () => {
	const { plugin, seen } = fake({
		collapses: false,
		single: "A fake holds one design, because it is fake.",
	});
	const out = await exportSpace(scene(), [universe(), universe()], plugin, {});
	assert.equal(seen.layers, 1, "one layer, whatever was asked for");
	// And a sentence saying so, never an empty note: the panel prints this.
	assert.ok(out.note.length > 0);
});

test("the document's reason outranks the target's, and that is the right way round", async () => {
	// Two universes that make the same decisions do not collapse for a reason that
	// has nothing to do with any target, and `collapseSpace` says so in words. A
	// target that also cannot collapse must not overwrite that with "SVG has no
	// media queries", which would answer a question the person did not ask.
	//
	// Which means `ExportPlugin.single` is only reached where the space *would*
	// have collapsed — the case `export-svg`'s "a collapsible space still exports
	// as one design in SVG" covers, with a real document and a real solver.
	const { plugin } = fake({ collapses: false, single: "A fake holds one design." });
	const out = await exportSpace(scene(), [universe(), universe()], plugin, {});
	assert.match(out.note, /same decisions/);
	assert.doesNotMatch(out.note, /A fake holds one design\./);
});

test("an empty document never loads a target's code", async () => {
	// The reason this is worth a test rather than a comment: `load()` is where the
	// heavy target reaches for three.js, and a panel opened on a project with
	// nothing in it should not fetch a renderer to be told there is nothing to
	// write.
	const { plugin, seen } = fake();
	const out = await exportSpace(scene(), [], plugin, {});
	assert.equal(seen.loads, 0, "the emitter was never asked for");
	assert.equal(out.text, "");
	assert.equal(out.note, "There is no design to export.");
});

test("the emitter is loaded once per export and not before", async () => {
	const { plugin, seen } = fake();
	assert.equal(seen.loads, 0, "composing a plugin loads nothing");
	await exportUniverse(scene(), universe(), plugin, {});
	assert.equal(seen.loads, 1);
});

test("targetFor picks out of the list a caller composed", () => {
	const a = fake({ id: "a" }).plugin;
	const b = fake({ id: "b" }).plugin;
	assert.equal(targetFor([a, b], "b"), b);
	assert.equal(targetFor([a, b], "nope"), undefined);
	// The whole point of the id being a plain string: a target this package has
	// never heard of resolves exactly like the two that ship.
	assert.equal(targetFor([a, b], "a")?.spec.label, "Fake");
});
