/**
 * A design in the address bar, round-tripped and narrowed.
 *
 * The two failure modes this file exists for are both invisible in a
 * presentation, which is the mode with no panel to report anything in.
 *
 * A key holding a `~` that got split at the wrong place becomes a pin on a
 * variable that does not exist; a pin on a variable that does not exist makes
 * every solve unsatisfiable; an unsatisfiable presentation is a blank screen
 * somebody was handed a link to. So the decoder drops what it cannot read, and
 * `holdable` drops what this document cannot hold — and both are asserted here
 * rather than trusted, because neither has a symptom short of nothing on screen.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { type Scene, emptyScene, makeNode, variableCounts } from "@clingo-design/design-core";
import { lit, ref } from "@clingo-design/design-core";

import { carried, decodeDesign, encodeDesign, holdable } from "./design-param.ts";

test("a design round-trips through the address", () => {
	const picks = { "tok(accent)": 1, "prop(card,fill)": 0 };
	assert.deepEqual(decodeDesign(encodeDesign(picks)), picks);
});

test("a key holding commas and parentheses survives", () => {
	// `prop(inst(i1,label),text)` is the realistic worst case and it is not a
	// contrived one: a component's part is exactly what a presentation carries a
	// choice about, because that is the thing a designer varies between pages.
	const picks = {
		"prop(inst(i1,label),text)": 3,
		"kfr(m1,tl1,prop(inst(i1,label),fill),2)": 1,
	};
	assert.deepEqual(decodeDesign(encodeDesign(picks)), picks);
});

test("the address is the same address for the same design", () => {
	// Sorted, because a record's key order is not a fact about the design and the
	// browser's history compares urls as strings. Two readings of one design that
	// produced two addresses would make the back stack depend on iteration order.
	assert.equal(
		encodeDesign({ b: 1, a: 0 }),
		encodeDesign({ a: 0, b: 1 }),
	);
	assert.equal(encodeDesign({}), "");
	assert.deepEqual(decodeDesign(""), {});
	assert.deepEqual(decodeDesign(null), {});
	assert.deepEqual(decodeDesign(undefined), {});
});

test("a malformed pair is dropped and the rest survive", () => {
	// A person handed a link cannot fix it, and a design that is nearly what the
	// sender meant beats a blank screen. Refusing the whole address would let one
	// stale variable throw away four good ones.
	assert.deepEqual(decodeDesign("tok(accent)~1;rubbish;tok(ink)~0"), {
		"tok(accent)": 1,
		"tok(ink)": 0,
	});
	assert.deepEqual(decodeDesign("a~1;;b~2"), { a: 1, b: 2 });
	assert.doesNotThrow(() => decodeDesign("~~~;;;~"));
});

test("a key containing a tilde is dropped rather than split", () => {
	// The one thing the separator was chosen to make impossible, asserted anyway:
	// splitting at the first tilde would turn `we~ird` into a pin on `we`, which is
	// a variable no document has — and a pin on a variable no document has is an
	// assumption on an atom that was never grounded, which is UNSAT for a reason
	// nobody can see.
	assert.deepEqual(decodeDesign("we~ird~2;ok~1"), { ok: 1 });
});

test("an index that is not a whole non-negative number is dropped", () => {
	// It indexes an alternative list. `Number("")` is 0 and `Number("1.5")` is 1.5,
	// so both are checked rather than either being assumed.
	assert.deepEqual(decodeDesign("a~;b~1.5;c~-1;d~x;e~2"), { e: 2 });
});

/* ------------------------------------------------------------------ */
/* Narrowing                                                           */
/* ------------------------------------------------------------------ */

function twoColours(): Scene {
	return {
		...emptyScene(),
		tokens: [
			{ id: "accent", name: "Accent", type: "color", value: [lit("#111111"), lit("#222222")] },
		],
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: 9525 * 100, height: 9525 * 100 }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: [ref("accent")] },
			},
		],
	};
}

test("holdable drops a variable the scene does not have", () => {
	const scene = twoColours();
	assert.equal("tok(accent)" in variableCounts(scene), true, "the fixture is the fixture");
	assert.deepEqual(
		holdable(scene, { "tok(accent)": 1, "tok(gone)": 0 }),
		{ "tok(accent)": 1 },
	);
});

test("holdable drops an index past the end of a list it does have", () => {
	// The other half of the same failure: the variable is still there and the
	// alternative it was pinned to has been deleted, which is what editing a token
	// down from three colours to two does to a link somebody sent yesterday.
	const scene = twoColours();
	assert.deepEqual(holdable(scene, { "tok(accent)": 2 }), {});
	assert.deepEqual(holdable(scene, { "tok(accent)": 1 }), { "tok(accent)": 1 });
});

test("the design accumulates rather than being replaced", () => {
	// A choice made on the first page has to survive a second page that has never
	// heard of it, or a five-page walk would forget the theme at the first page
	// that does not offer one. And only what was still open here is added: a
	// variable the rules settled needs no pin, and a pin per variable would make
	// the address unreadable.
	const incoming = { "tok(accent)": 1, "tok(gone-from-here)": 0 };
	const pick = { "tok(accent)": 0, "prop(card,fill)": 2, "tok(settled)": 0 };
	assert.deepEqual(carried(incoming, pick, ["prop(card,fill)", "tok(accent)"]), {
		"tok(accent)": 0,
		"tok(gone-from-here)": 0,
		"prop(card,fill)": 2,
	});
	// A varying key the answer set does not carry adds nothing rather than
	// `undefined`, which would encode as the string "undefined" and decode as
	// nothing at all — one round trip later.
	assert.deepEqual(carried({}, {}, ["missing"]), {});
});
