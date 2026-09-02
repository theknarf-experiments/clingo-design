/**
 * Page ids, the rewrite a rename makes, and the outward walk a link is.
 *
 * Three claims, and the first two are the ones that would fail silently. A page
 * id reaches the program as `page(<id>)` and `link(N,<id>)`, so it has to be a
 * legal ASP constant and it has to be injective — sanitising is neither, and two
 * pages under one id would be one page with the other's links pointing at it.
 * And `componentIdOf`'s arithmetic moved into `aspConstant` this step, which is
 * a refactor of a function whose output is in generated programs already: the
 * frozen literal below is the whole check that it did not move.
 *
 * The third is the one that would fail *visibly* and is asserted anyway, because
 * "the whole card is clickable" is the sentence a hotspot tool exists to make
 * hard: `linkAt` walks outward, and a label lying across a linked card must not
 * put a hole in it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { componentIdOf } from "./components.ts";
import { makeNode } from "./edits.ts";
import type { ModelNode, ModelScene } from "./model.ts";
import {
	aspConstant,
	linkAt,
	pageIdOf,
	pageIndexOf,
	pageName,
	pagePath,
	repointLinks,
	repointedLinks,
} from "./pages.ts";
import { type Scene, emptyScene } from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";

const px = (n: number): number => n * EMU_PER_PX;

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

test("a page id is a legal ASP constant, whatever the page is called", () => {
	// `[a-z][A-Za-z0-9_]*`, which is what a grounder takes and what `page(P)`
	// needs. The prefix is what makes the leading-digit case structurally
	// impossible rather than accidentally fine: `2024` sanitises to `2024` and
	// then never appears first.
	for (const path of [
		pagePath("About us"),
		pagePath("2024"),
		pagePath("!!!"),
		pagePath(""),
		pagePath("Ünicode — dashes/slashes"),
	]) {
		const id = pageIdOf(path);
		assert.match(id, /^pg_[a-z0-9_]*[0-9a-z]+$/, path);
		assert.match(id, /^[a-z][A-Za-z0-9_]*$/, path);
	}
	// A name that sanitises to nothing still has a stem, because `pg__1k3z9` is a
	// legal constant that reads like a bug.
	assert.match(pageIdOf(pagePath("!!!")), /^pg_c_/);
});

test("a page id is injective where sanitising is not", () => {
	// The whole reason there is a hash on the end. Two pages under one id would be
	// one page, and the links into the second would silently reach the first.
	assert.notEqual(pageIdOf(pagePath("my page")), pageIdOf(pagePath("my-page")));
	assert.notEqual(pageIdOf(pagePath("A")), pageIdOf(pagePath("a")));
	assert.equal(pageIdOf(pagePath("Home")), pageIdOf(pagePath("Home")));
});

test("a page id and a component id can never collide", () => {
	// Structurally, by prefix, rather than by hoping the hashes miss. `cmp_` and
	// `pg_` keep the families apart however the stems land — which is what lets one
	// function compute both.
	const paths = [
		"Home",
		"About us",
		"Button",
		"2024",
		"!!!",
		"a",
		"A",
		"my page",
		"my-page",
		"Checkout",
		"Nav bar",
		"x",
	];
	const pages = new Set(paths.map((n) => pageIdOf(pagePath(n))));
	const components = new Set(
		paths.map((n) => componentIdOf(`/components/${n}.component`)),
	);
	assert.equal(pages.size, paths.length, "and injective within the family");
	assert.equal(components.size, paths.length);
	for (const id of pages) assert.equal(components.has(id), false, id);
});

test("componentIdOf did not move", () => {
	// A frozen literal, because this id is already in generated programs: a
	// definition is spliced into a page under it, an instance names it, and an
	// unsat core prints it. The arithmetic was lifted into `aspConstant`
	// byte-for-byte this step, and "byte-for-byte" is a claim a test makes or
	// nobody does.
	assert.equal(
		componentIdOf("/components/Button.component"),
		"cmp_button_eivxja",
	);
	assert.equal(aspConstant("cmp", "Button", "/components/Button.component"), "cmp_button_eivxja");
});

test("a path and its name are each other's inverse", () => {
	for (const name of ["Home", "About us", "2024", "a.scene"]) {
		assert.equal(pageName(pagePath(name)), name);
	}
	// And the index is the inverse of the id, which is the only way back: a hash
	// does not run backwards, so the app computes the ids of the pages it has and
	// looks the answer up.
	const paths = [pagePath("Home"), pagePath("About us")];
	const index = pageIndexOf(paths);
	assert.equal(index[pageIdOf(paths[0])], paths[0]);
	assert.equal(index[pageIdOf(paths[1])], paths[1]);
	assert.equal(Object.keys(index).length, 2);
});

/* ------------------------------------------------------------------ */
/* A rename repoints                                                   */
/* ------------------------------------------------------------------ */

const linked = (to: string): Scene => ({
	...emptyScene(),
	nodes: [
		{
			...makeNode("frame", { x: 0, y: 0, width: px(400), height: px(300) }, {
				id: "page",
				name: "Page",
			}),
			children: [
				{
					...makeNode("rect", { x: 0, y: 0, width: px(80), height: px(40) }, {
						id: "card",
						name: "Card",
					}),
					link: { to },
				},
				makeNode("rect", { x: px(100), y: 0, width: px(80), height: px(40) }, {
					id: "plain",
					name: "Plain",
				}),
			],
		},
	],
});

test("a rename repoints a link and leaves every other one alone", () => {
	const scene = linked(pagePath("About"));
	const moved = repointedLinks(scene, pagePath("About"), pagePath("About us"));
	assert.equal(moved.nodes[0].children?.[0].link?.to, pagePath("About us"));
	// A link naming a different page is untouched, and a node with no link is not
	// given one.
	assert.equal(moved.nodes[0].children?.[1].link, undefined);

	const elsewhere = repointedLinks(scene, pagePath("Pricing"), pagePath("Plans"));
	assert.equal(
		elsewhere,
		scene,
		"nothing matched, so the same scene object comes back",
	);
});

test("repointLinks writes in place and says whether it wrote", () => {
	// The draft-mutating twin, which is what the store calls inside
	// `handle.change`. Assign only where it differs, so a page holding no such link
	// produces no change at all — no `updatedAt` bump and no entry in anybody's
	// undo history for a rename on a page they were not looking at.
	const draft = {
		nodes: [
			{ link: { to: pagePath("About") }, children: [{ link: { to: pagePath("Home") } }] },
			{},
		],
	};
	assert.equal(repointLinks(draft, pagePath("About"), pagePath("About us")), true);
	assert.equal(draft.nodes[0].link?.to, pagePath("About us"));
	assert.equal(
		(draft.nodes[0] as { children: Array<{ link: { to: string } }> }).children[0].link.to,
		pagePath("Home"),
		"a nested link naming another page is untouched",
	);
	assert.equal(
		repointLinks(draft, pagePath("Nothing"), pagePath("Else")),
		false,
		"and a page with no such link reports no write",
	);
	assert.equal(repointLinks(undefined, "a", "b"), false, "as does a scene that is not there");
});

/* ------------------------------------------------------------------ */
/* linkAt walks outward                                                */
/* ------------------------------------------------------------------ */

const box = (
	id: string,
	frame: { x: number; y: number; width: number; height: number },
	extra: Partial<ModelNode> = {},
): ModelNode => ({
	id,
	kind: "rect",
	order: 1,
	frame,
	rendered: {},
	children: [],
	...extra,
});

const model = (roots: ModelNode[]): ModelScene => {
	const byId: Record<string, ModelNode> = {};
	const walk = (node: ModelNode): void => {
		byId[node.id] = node;
		for (const child of node.children) walk(child);
	};
	for (const root of roots) walk(root);
	return {
		roots,
		byId,
		groups: {},
		variables: {},
		wears: {},
		states: {},
		shown: {},
		shownByLayer: {},
		keyframes: {},
		machines: {},
		fightsAt: {},
		triangles: {},
		assets: {},
		looks: {},
		links: {},
		goes: [],
	};
};

test("a point in a linked frame finds the frame", () => {
	const scene = model([
		box("card", { x: 0, y: 0, width: 100, height: 100 }, {
			link: { to: "pg_about_x", on: "click" },
		}),
	]);
	assert.deepEqual(linkAt(scene, { x: 50, y: 50 }), {
		id: "card",
		to: "pg_about_x",
		on: "click",
		world: { x: 0, y: 0, width: 100, height: 100 },
	});
	assert.equal(linkAt(scene, { x: 500, y: 500 }), undefined);
});

test("a point in an unlinked child of a linked frame finds the parent", () => {
	// Which is exactly what a browser does with a `<span>` inside an `<a>`, and it
	// is what a designer means by "the whole card is clickable". A child's frame is
	// parent-relative, so this also pins that `linkAt` adds the offsets up: the
	// label sits at (10,10) inside a card at (40,40), so a point at (55,55) is
	// inside both.
	const label = box("label", { x: 10, y: 10, width: 40, height: 20 });
	const card = box("card", { x: 40, y: 40, width: 100, height: 100 }, {
		link: { to: "pg_detail_x", on: "click" },
		children: [label],
	});
	const scene = model([card]);
	// And the box handed back is the *card's*, not the label's: an outline drawn
	// around the thing the pointer touched rather than around the thing that
	// leads somewhere would be an outline around the wrong object.
	assert.deepEqual(linkAt(scene, { x: 55, y: 55 }), {
		id: "card",
		to: "pg_detail_x",
		on: "click",
		world: { x: 40, y: 40, width: 100, height: 100 },
	});
	// ...and a point inside the card but outside the label is the same answer, so
	// nothing about this depends on the label being there.
	assert.equal(linkAt(scene, { x: 130, y: 130 })?.id, "card");
});

test("an unlinked sibling drawn across a linked card does not put a hole in it", () => {
	// The annotation case: a label lying *over* a card rather than inside it. It is
	// found first, in paint order, has no link of its own and no linked ancestor —
	// so the walk moves on to the next node under the point, which is the card.
	const card = box("card", { x: 0, y: 0, width: 100, height: 100 }, {
		link: { to: "pg_detail_x", on: "click" },
	});
	const note = box("note", { x: 20, y: 20, width: 40, height: 20 });
	const scene = model([card, note]);
	assert.equal(linkAt(scene, { x: 30, y: 30 })?.id, "card");
});

test("two overlapping linked nodes settle on the later one", () => {
	// Paint order, backwards, which is the arbiter `hitTestTree` and `instanceAt`
	// already use: what is drawn last is what the pointer gets.
	const under = box("under", { x: 0, y: 0, width: 100, height: 100 }, {
		link: { to: "pg_one_x", on: "click" },
	});
	const over = box("over", { x: 0, y: 0, width: 100, height: 100 }, {
		link: { to: "pg_two_x", on: "pointerenter" },
	});
	const scene = model([under, over]);
	assert.deepEqual(linkAt(scene, { x: 10, y: 10 }), {
		id: "over",
		to: "pg_two_x",
		on: "pointerenter",
		world: { x: 0, y: 0, width: 100, height: 100 },
	});
});

test("a linked part of an instance is reachable, which the document is not", () => {
	// The other half of "over the model and not over the document": a component's
	// linked part is `inst(I,N)` and `scene.nodes` does not contain it at all. A
	// navigation bar placed as an instance has its link on a derived node, and the
	// answer set is the only place that node has a box.
	const part = box("inst(nav1,logo)", { x: 4, y: 4, width: 40, height: 20 }, {
		link: { to: "pg_home_x", on: "click" },
	});
	const scene = model([box("nav1", { x: 0, y: 0, width: 300, height: 40 }, { children: [part] })]);
	assert.equal(linkAt(scene, { x: 10, y: 10 })?.id, "inst(nav1,logo)");
});
