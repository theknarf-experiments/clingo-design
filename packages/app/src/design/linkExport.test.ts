/**
 * A link in the file it exports to.
 *
 * Two of these assertions are about something that is *not* there, and both of
 * them are the point. A `click` link emits **no script**, because an anchor
 * navigates natively and that is the whole reason for choosing an anchor over a
 * handler; and the stylesheet's neutraliser must not repaint the design, which
 * is a claim about specificity that no amount of reading the CSS out loud
 * settles — so it is asserted against the emitted text.
 *
 * Everything runs through the real solver, like `export.test.ts`: an export is
 * only worth anything if it agrees with the picture the solver described, and a
 * link a *rule* asserted is exactly the case a test reading the document would
 * pass while the emitter did nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "@clingo-design/design-core";
import { makeNode, setLink } from "@clingo-design/design-core";
import { explore } from "@clingo-design/design-core";
import {
	type ExportOptions,
	type ExportPlugin,
	exportUniverse,
} from "@clingo-design/export-core";
import { htmlTarget } from "@clingo-design/export-html";
import { svgTarget } from "@clingo-design/export-svg";
import { pageIdOf, pagePath } from "@clingo-design/design-core";
import { type Scene, type SceneNode, emptyScene } from "@clingo-design/design-core";
import { EMU_PER_PX } from "@clingo-design/design-core";
import { lit } from "@clingo-design/design-core";

const px = (n: number): number => n * EMU_PER_PX;

const HOME = pagePath("Home");
const ABOUT = pagePath("About us");
const GONE = pagePath("Deleted");

/** page id -> page name, which is what the exporter takes and turns into an href. */
const PAGES = {
	[pageIdOf(HOME)]: "Home",
	[pageIdOf(ABOUT)]: "About us",
};

function page(children: SceneNode[]): Scene {
	return {
		...emptyScene(),
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(400), height: px(200) }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: [lit("#ffffff")] },
				children,
			},
		],
	};
}

const card = (id: string): SceneNode => ({
	...makeNode("rect", { x: px(20), y: px(20), width: px(120), height: px(60) }, {
		id,
		name: id,
	}),
	props: { fill: [lit("#2563eb")] },
});

async function exported(
	scene: Scene,
	plugin: ExportPlugin = htmlTarget,
	options: Partial<ExportOptions> = {},
) {
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const universe = exploration.universes[0];
	assert.ok(universe, "expected at least one universe");
	return await exportUniverse(scene, universe, plugin, {
		title: "Home",
		pages: PAGES,
		...options,
	});
}

/* ------------------------------------------------------------------ */
/* The markup                                                          */
/* ------------------------------------------------------------------ */

test("a linked node is an anchor and an unlinked sibling is not", async () => {
	// One tag swapped and one attribute added; the class, the data attributes and
	// the rule in the stylesheet are the ones a `<div>` would have carried. A link
	// that is not an `<a>` is not a link — it is not in the tab order, middle-click
	// does not open it in a tab, and a screen reader does not announce it as one.
	const scene = setLink(page([card("one"), card("two")]), ["one"], { to: ABOUT });
	const out = await exported(scene);
	assert.match(out.text, /<a class="[^"]*" data-node="one" data-kind="rect" href="About-us.html">/);
	assert.match(out.text, /<div class="[^"]*" data-node="two" data-kind="rect">/);
	assert.equal(out.text.includes("</a>"), true, "and it closes as one");
	// The class is the same class: the anchor is the node's own box and nothing
	// about the paint changed.
	const anchor = /<a class="([^"]*)" data-node="one"/.exec(out.text)?.[1];
	const div = /<div class="([^"]*)" data-node="two"/.exec(out.text)?.[1];
	assert.equal(typeof anchor, "string");
	assert.equal(anchor?.split(" ").length, div?.split(" ").length);
});

test("the href is the filename the page exports under", async () => {
	// Computed by the same `slug` that computes `ExportResult.filename`, so a page
	// exported under its own name and a link to that page produce the same string
	// by construction rather than by the caller remembering to match them.
	const scene = setLink(page([card("one")]), ["one"], { to: ABOUT });
	const out = await exported(scene);
	const target = await exported(page([card("x")]), htmlTarget, { title: "About us" });
	assert.equal(target.filename, "About-us.html");
	assert.match(out.text, /href="About-us\.html"/);
});

test("a link a rule asserted exports too", async () => {
	// `render` reads `node.link` off the `ModelNode`, which came from the answer
	// set — so a document with forty cards and one rule linking each to its detail
	// page exports forty anchors. A reader that took the link off the *document*
	// would emit none of them, and nothing on the page would say why.
	const scene: Scene = {
		...page([card("one")]),
		rules: `link(one,${pageIdOf(ABOUT)}).`,
	};
	const out = await exported(scene);
	assert.match(out.text, /<a [^>]*data-node="one"[^>]*href="About-us.html"/);
});

/* ------------------------------------------------------------------ */
/* The stylesheet                                                      */
/* ------------------------------------------------------------------ */

test("the link rule never repaints the design", async () => {
	// The specificity claim, which is the one that reads correct and is wrong.
	// `.design a[data-node]` is (0,2,1); a node's own rule is a bare class at
	// (0,1,0); a style's is inside `:where()` and weighs nothing. And `ink` writes
	// `color`. So the unwrapped selector deletes the ink of every text node that
	// leads somewhere — the exact opposite of the sentence its comment makes.
	const words: SceneNode = {
		...makeNode("text", { x: px(20), y: px(20), width: px(200), height: px(40) }, {
			id: "label",
			name: "Label",
		}),
		props: { text: [lit("Read more")], ink: [lit("#ff0000")] },
		link: { to: ABOUT },
	};
	const out = await exported(page([words]));

	assert.equal(
		out.text.includes(":where(.design a[data-node])"),
		true,
		"wrapped, so it weighs nothing at all",
	);
	assert.equal(
		out.text.split(":where(.design a[data-node])").length - 1,
		1,
		"and exactly once",
	);
	// Never as a bare selector at the start of a line, which is the only place it
	// could be one: it appears once more inside the block's own comment, quoted,
	// explaining exactly why it is not written that way.
	assert.equal(
		/(^|\n)\.design a\[data-node\]/.test(out.text),
		false,
		"and never unwrapped",
	);
	// And the design's own colour is still in the file, on the node's own class.
	assert.match(out.text, /color: #ff0000/);
});

/* ------------------------------------------------------------------ */
/* The script, and its absence                                         */
/* ------------------------------------------------------------------ */

test("a click link emits no script at all", async () => {
	// The absence assertion, in `runtime.test.ts`'s shape. An anchor navigates on
	// click natively, so the common document — every link a click — carries no
	// `<script>` from this feature and no attribute for one to read.
	const scene = setLink(page([card("one")]), ["one"], { to: ABOUT });
	const out = await exported(scene);
	assert.equal(out.text.includes("data-link-on"), false);
	assert.equal(out.text.includes("addEventListener"), false);
	assert.equal(out.text.includes("<script>"), false);
});

test("a pointerenter link emits the attribute and the script", async () => {
	// And the attribute carries the DOM *event*, not the trigger id: `TRIGGERS` is
	// the one table that says what a trigger is to a browser, and a script reading
	// a trigger name would be a second statement of it.
	const scene = setLink(page([card("one")]), ["one"], {
		to: ABOUT,
		on: "pointerenter",
	});
	const out = await exported(scene);
	assert.match(out.text, /data-link-on="pointerenter"/);
	assert.equal(out.text.includes("<script>"), true);
	assert.equal(out.text.includes('querySelectorAll("a[data-link-on]")'), true);
	// No timers, which is the whole file's standing claim and is worth re-running
	// over a text that just grew a second script.
	for (const banned of ["setTimeout", "setInterval", "requestAnimationFrame"]) {
		assert.equal(out.text.includes(banned), false, banned);
	}
});

test("a pointerdown link's script parses", async () => {
	// The cheapest possible check and the one that catches the most: a syntax error
	// in an emitted script takes the behaviour of somebody's whole page with it,
	// and it would never show up in a type check because the text has no types.
	const scene = setLink(page([card("one")]), ["one"], {
		to: ABOUT,
		on: "pointerdown",
	});
	const out = await exported(scene);
	const body = /<script>\n([\s\S]*?)\n<\/script>/.exec(out.text)?.[1];
	assert.equal(typeof body, "string");
	assert.doesNotThrow(() => new Function(body as string));
});

/* ------------------------------------------------------------------ */
/* Losses                                                              */
/* ------------------------------------------------------------------ */

test("lost holds the other-pages sentence exactly once, however many links", async () => {
	// A list of losses that pads itself is one nobody finishes reading: the fact is
	// about the *file* being one file, so it is said once for the document rather
	// than once per anchor.
	let scene = page([card("one"), card("two"), card("three"), card("four")]);
	for (const id of ["one", "two", "three", "four"]) {
		scene = setLink(scene, [id], { to: ABOUT });
	}
	const out = await exported(scene);
	const said = out.lost.filter((line) => line.startsWith("Other pages."));
	assert.equal(said.length, 1);
	// And it names the font cost, because a folder of pages is a folder of copies
	// of every face and nothing can share them.
	assert.match(said[0], /copies of it/);
});

test("a document with no link says nothing about pages", async () => {
	const out = await exported(page([card("one")]));
	assert.equal(out.lost.some((line) => line.startsWith("Other pages.")), false);
	assert.equal(out.lost.some((line) => line.includes("point at a page")), false);
});

test("a link whose page is gone exports as a box and says so", async () => {
	// An `<a href>` that 404s is worse than a box, because the box is honest about
	// leading nowhere. Both halves are asserted, because either alone would pass
	// against a version that emitted a broken anchor and named it in `lost`.
	const scene = setLink(page([card("one")]), ["one"], { to: GONE });
	const out = await exported(scene);
	assert.match(out.text, /<div class="[^"]*" data-node="one"/);
	assert.equal(out.text.includes("<a "), false);
	assert.equal(
		out.lost.some((line) => line.startsWith("1 link point")),
		true,
		out.lost.join("\n"),
	);
	assert.equal(
		out.lost.some((line) => line.startsWith("Other pages.")),
		false,
		"and there is no other page to have lost",
	);
});

test("a caller that hands over no page list gets boxes, not broken anchors", async () => {
	// Which is the SVG panel's case and the bare-test case at once: `pages` is
	// optional, and the honest reading of "I do not know what this project holds"
	// is the same as "that page is gone".
	const scene = setLink(page([card("one")]), ["one"], { to: ABOUT });
	const out = await exported(scene, htmlTarget, { pages: undefined });
	assert.equal(out.text.includes("<a "), false);
	assert.equal(out.lost.some((line) => line.includes("point at a page")), true);
});

test("the SVG target emits no anchor and says so once about the format", async () => {
	// The asymmetry `EXPORT_TARGETS` already argues for: HTML *can* carry a link
	// and names the ones it could not, SVG carries none and says so once.
	const scene = setLink(page([card("one")]), ["one"], { to: ABOUT });
	const out = await exported(scene, svgTarget);
	assert.equal(out.text.includes("<a "), false);
	assert.equal(
		svgTarget.spec.loses.filter((line) => line.startsWith("Links.")).length,
		1,
	);
	assert.equal(out.lost.filter((line) => line.startsWith("Links.")).length, 1);
});

/* ------------------------------------------------------------------ */
/* A link on a node a rule hid                                         */
/* ------------------------------------------------------------------ */

test("a link on a node no design draws is neither an anchor nor a loss", async () => {
	// `link/2` is shown for a hidden node too, because a rule may want to reason
	// about an edge the design does not offer. What the file emits is what it drew
	// — so a link on a node no slot holds is not in this file at all, and naming it
	// in `lost` would be reporting a page the reader never had.
	const scene: Scene = {
		...setLink(page([card("one")]), ["one"], { to: ABOUT }),
		rules: "hidden(one).",
	};
	const out = await exported(scene);
	assert.equal(out.text.includes('data-node="one"'), false);
	assert.equal(out.lost.some((line) => line.startsWith("Other pages.")), false);
});
