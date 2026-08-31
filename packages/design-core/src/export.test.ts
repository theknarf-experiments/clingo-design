/**
 * The way out, held against the answer set it came from.
 *
 * Everything here runs through the real solver, because an export is only worth
 * anything if it agrees with the picture the solver described — not with the
 * document, and not with what the exporter believes the document says. The two
 * assertions that carry the weight are:
 *
 *   - every node the model draws appears in the output, in paint order;
 *   - substituting every `var(--name)` back into the token export produces the
 *     export that had no tokens in it at all. That is the whole of the promise
 *     in "a fill that names accent comes out as var(--accent)": the name is a
 *     name for the value the answer set rendered, and not for something else.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { makeNode } from "./edits.ts";
import { explore } from "./explore.ts";
import {
	EXPORT_TARGET_NAMES,
	type ExportOptions,
	collapseSpace,
	exportMachines,
	exportSpace,
	exportUniverse,
} from "./export.ts";
import { machineTable, stepMachine } from "./machines.ts";
import type { ModelScene } from "./model.ts";
import { evalRuntime } from "./runtime.ts";
import { DOCUMENT_BASE, PAINT, cssName, paintOf } from "./paint.ts";
import {
	KINDS,
	type LoopMode,
	type Machine,
	PROPS,
	PROP_NAMES,
	type PropName,
	RULES_HEADER,
	type Scene,
	type SceneNode,
	type StatePart,
	type Style,
	type Track,
	type Transition,
	makeGuides,
	makeLayout,
	starterTokens,
	trackDatum,
} from "./scene.ts";
import { TEMPLATES } from "./templates/index.ts";
import { card } from "./templates/card.ts";
import { pair } from "./templates/pair.ts";
import { places } from "./templates/places.ts";
import { rail } from "./templates/rail.ts";
import { typography } from "./templates/typography.ts";
import { at, frame, rect, text, wearing, withToken } from "./templates/shared.ts";
import { findInTree } from "./tree.ts";
import {
	EMU_PER_PX,
	type Unit,
	cssPxFromEmu,
	emuOf,
	formatLength,
	nearestEmu,
} from "./units.ts";
import { type Value, isLengthType, lit, ref, single } from "./values.ts";

/** A document whose universes differ only by a container's direction. */
function flow(): Scene {
	return {
		styles: [],
		machines: [],
		tokens: starterTokens(),
		nodes: [
			frame("page", "Page", [0, 0, 520, 360], { fill: [ref("muted")] }, [
				{
					...frame("bar", "Bar", [24, 24, 300, 120], { fill: [ref("surface")] }, [
						rect("a", "A", [0, 0, 120, 64], { fill: [ref("accent")] }),
						rect("b", "B", [0, 0, 120, 64], { fill: [ref("ink")] }),
						rect("c", "C", [0, 0, 120, 64], { fill: [ref("subtle")] }),
					]),
					layout: {
						...makeLayout({ gap: 12, padding: 16 }),
						direction: [lit("row"), lit("column")],
					},
				},
			]),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
}

/** A document whose panel's width is a token, so a dimension is parametric. */
function parametric(): Scene {
	const tokens = withToken(
		[
			...starterTokens(),
			{ id: "panelW", name: "panel width", type: "length", value: single("180px") },
		],
		"accent",
		[lit("#3b82f6")],
	);
	return {
		styles: [],
		machines: [],
		tokens,
		nodes: [
			frame("page", "Page", [0, 0, 400, 240], { fill: [ref("muted")] }, [
				{
					...rect("panel", "Panel", [20, 20, 180, 200], { fill: [ref("accent")] }),
					frame: {
						x: single("20px"),
						y: single("20px"),
						width: [ref("panelW")],
						height: single("200px"),
					},
				},
			]),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
}

/**
 * The token export with every `var(--name)` put back, and the definitions
 * removed — which should leave exactly the export that never used a name.
 */
function inline(text: string): string {
	const values = new Map<string, string>();
	for (const [, name, value] of text.matchAll(/^\t(--[A-Za-z0-9_-]+): (.+);$/gm)) {
		values.set(name, value);
	}
	return text
		.replace(/^\t--[A-Za-z0-9_-]+: .+;\n/gm, "")
		// The block that held nothing but definitions goes with them.
		.replace(/^:root \{\n\}\n/gm, "")
		.replace(/^svg \{\n\}\n/gm, "")
		.replace(/var\((--[A-Za-z0-9_-]+)\)/g, (whole, name: string) =>
			values.get(name) ?? whole,
		);
}

/**
 * Every node the export is expected to draw, in the order it must draw them.
 *
 * The model's own pre-order — a parent before its children, siblings back to
 * front — with **one stop**, and the stop is stated here rather than tolerated
 * in the assertion below. `KINDS[kind].opaque` is a viewport, whose box the file
 * draws and whose contents it does not: a mesh is geometry, and the honest thing
 * for a DOM exporter to do with a cylinder is to say it cannot carry one rather
 * than to emit a `<div>` with the silhouette of its bounding box. So the walk
 * that predicts the export makes the same single lookup the export makes, in
 * `stopsHere` — one table consulted twice rather than two lists that can drift.
 *
 * Deliberately not "and skip whatever is missing". Written that way, a bug that
 * dropped a rectangle from a flat page would pass here as easily as the seam
 * does. Written this way, the seam is asserted to be in exactly the one place
 * the kind table puts it.
 */
function drawnByExport(roots: ModelScene["roots"]): string[] {
	const order: string[] = [];
	const walk = (nodes: ModelScene["roots"]) => {
		for (const node of nodes) {
			order.push(node.id);
			if (!KINDS[node.kind].opaque) walk(node.children);
		}
	};
	walk(roots);
	return order;
}

for (const template of TEMPLATES) {
	test(`${template.id}: the export holds every node the answer set drew`, async () => {
		const scene = template.create();
		const exploration = await explore(scene, directSolver, { limit: 4 });
		const universe = exploration.universes[0];
		assert.ok(universe, "expected at least one universe");

		for (const target of EXPORT_TARGET_NAMES) {
			const out = exportUniverse(scene, universe, { target, title: template.id });
			const drawn = [...out.text.matchAll(/data-node="([^"]*)"/g)].map((m) =>
				m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
			);
			const order = drawnByExport(universe.model.roots);
			assert.deepEqual(
				drawn.slice().sort(),
				order.slice().sort(),
				`${target}: the export and the model draw different nodes`,
			);
			assert.deepEqual(drawn, order, `${target}: painted out of order`);
			assert.ok(out.lost.length > 0, "an export that loses nothing is a lie");

			// And what it stopped at, it *said*. A subtree that goes missing with no
			// sentence about it is indistinguishable from a subtree that was dropped
			// by accident, which is the whole reason `lost` exists.
			const held = new Set(order);
			const inside = Object.keys(universe.model.byId).filter((id) => !held.has(id));
			if (inside.length > 0) {
				assert.ok(
					out.lost.some((entry) => entry.includes("view")),
					`${target}: ${inside.length} nodes went missing with nothing said`,
				);
			}
		}
	});

	test(`${template.id}: a token export is the plain export with names put in`, async () => {
		const scene = template.create();
		const exploration = await explore(scene, directSolver, { limit: 4 });
		const universe = exploration.universes[0];
		for (const target of EXPORT_TARGET_NAMES) {
			const named = exportUniverse(scene, universe, { target, title: template.id });
			const plain = exportUniverse(scene, universe, {
				target,
				title: template.id,
				tokens: false,
			});
			assert.equal(
				inline(named.text),
				plain.text,
				`${target}: a token stands for something other than what was drawn`,
			);
		}
	});
}

test("a fill that names accent comes out as var(--accent)", async () => {
	const scene = card();
	const exploration = await explore(scene, directSolver, { limit: 1 });
	const universe = exploration.universes[0];
	const out = exportUniverse(scene, universe, { target: "html", title: "card" });
	assert.match(out.text, /background: var\(--accent\);/);
	// And the definition is the colour the answer set actually rendered.
	const drawn = universe.model.byId.badge?.rendered.fill;
	assert.ok(drawn);
	assert.match(out.text, new RegExp(`--accent: ${drawn};`));
	// Off, it is the hex and nothing else.
	const plain = exportUniverse(scene, universe, {
		target: "html",
		tokens: false,
	});
	assert.doesNotMatch(plain.text, /var\(--/);
	assert.match(plain.text, new RegExp(`background: ${drawn};`));
});

test("a dimension driven by a token comes out as the token", async () => {
	const scene = parametric();
	const exploration = await explore(scene, directSolver, { limit: 1 });
	const out = exportUniverse(scene, exploration.universes[0], { target: "html" });
	assert.match(out.text, /width: var\(--panel-width\);/);
	assert.match(out.text, /--panel-width: 180px;/);
});

test("every kind the studio can draw reaches both targets", async () => {
	// Not a template: the templates between them do not use a path, a line or
	// an arrow, and a target that silently drops one of them would pass every
	// other test in this file.
	const scene: Scene = {
		styles: [],
		machines: [],
		tokens: starterTokens(),
		nodes: [
			frame("page", "Page", [0, 0, 400, 300], { fill: [ref("surface")] }, [
				rect("r", "Rect", [10, 10, 60, 40], { fill: [ref("accent")] }),
				{ ...rect("e", "Ellipse", [80, 10, 60, 60], { fill: [ref("ink")] }), kind: "ellipse" },
				{
					...rect("l", "Line", [10, 90, 100, 60], {
						stroke: [ref("ink")],
						strokeWidth: single("3px"),
					}),
					kind: "line",
					diagonal: "up",
				},
				{
					...rect("ar", "Arrow", [130, 90, 100, 60], {
						stroke: [ref("accent")],
						strokeWidth: single("4px"),
					}),
					kind: "arrow",
					diagonal: "down",
				},
				{
					...rect("p", "Path", [240, 90, 80, 80], {
						fill: [ref("muted")],
						stroke: [ref("ink")],
						strokeWidth: single("2px"),
					}),
					kind: "path",
					points: [
						{ x: 0, y: 0 },
						{ x: 80, y: 20 },
						{ x: 40, y: 80 },
					],
					closed: true,
				},
				text("t", "Text", [10, 200, 200, 60], "Two\nlines", {
					ink: [ref("subtle")],
					size: single("14px"),
				}),
			]),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
	const exploration = await explore(scene, directSolver, { limit: 1 });
	const universe = exploration.universes[0];

	const html = exportUniverse(scene, universe, { target: "html" }).text;
	// A diagonal leans the way the document says, and the answer set does not
	// carry the lean — so this is the one thing read from the document.
	assert.match(html, /data-node="l"[^>]*><svg class="s"[^>]*><line x1="0" y1="60"/);
	assert.match(html, /data-node="ar"[^>]*><svg class="s"[^>]*><line x1="0" y1="0"/);
	assert.match(html, /<polyline points="/, "an arrow has a head");
	assert.match(html, /<path d="M/, "a path has its vertices");
	assert.match(html, /border-radius: 50%/, "an ellipse is a fully rounded box");
	assert.match(html, /Two\nlines/);

	const svg = exportUniverse(scene, universe, { target: "svg" }).text;
	assert.match(svg, /<ellipse cx="30" cy="30" rx="30" ry="30"/);
	assert.match(svg, /<line x1="0" y1="60" x2="100" y2="0"/);
	assert.match(svg, /<polyline points="/);
	assert.match(svg, /<path d="M/);
	// Two lines of text are two tspans, because SVG does not wrap.
	assert.equal(svg.match(/<tspan /g)?.length, 2);
});

/* ------------------------------------------------------------------ */
/* Furniture does not come out                                         */
/* ------------------------------------------------------------------ */

/**
 * The same page said two ways.
 *
 * `held` is ruled into four columns, carries a hand-drawn line, and holds its
 * card to column three with a rule. `settled` has no grid, no line and no rule,
 * and its card simply sits at 480 — which is where the grid put the other one.
 *
 * They are the same *design*, and an export that carried any of the furniture
 * would be the one place that could tell them apart.
 */
function ruledPage(held: boolean): Scene {
	const card = rect("card", "Card", [held ? 0 : 480, 40, 120, 100], {
		fill: [ref("accent")],
	});
	const page = frame("page", "Page", [0, 0, 960, 640], { fill: [ref("surface")] }, [
		card,
	]);
	return {
		styles: [],
		machines: [],
		tokens: starterTokens(),
		nodes: [
			held
				? {
						...page,
						guides: makeGuides({
							columns: 4,
							gutter: 0,
							marginLeft: 0,
							marginRight: 0,
						}),
						lines: [{ id: "g1", axis: "y", at: single("220px") }],
					}
				: page,
		],
		constraints: held
			? [
					{
						id: "third",
						kind: "align",
						prop: "fill",
						nodes: ["card", trackDatum("page", 3, "left")],
						edge: "left",
						enabled: true,
					},
				]
			: [],
		rules: RULES_HEADER,
	};
}

const onlyUniverse = async (scene: Scene) => {
	const exploration = await explore(scene, directSolver, { limit: 4 });
	assert.equal(exploration.universes.length, 1);
	return exploration.universes[0];
};

test("a page ruled into columns exports the design, not the grid", async () => {
	// The strongest form the promise has: the ruled document and the settled one
	// are the same *file*, byte for byte, in both targets. Nothing about a margin,
	// a column, a guide or the rule that read them survives — and the coordinate
	// they decided does, because that is the design.
	const held = ruledPage(true);
	const settled = ruledPage(false);
	const a = await onlyUniverse(held);
	const b = await onlyUniverse(settled);
	assert.equal(a.model.byId.card.frame.x, 480 * EMU_PER_PX, "the grid placed it");

	for (const target of EXPORT_TARGET_NAMES) {
		const out = exportUniverse(held, a, { target, title: "page" });
		assert.equal(
			out.text,
			exportUniverse(settled, b, { target, title: "page" }).text,
			`${target}: the grid left a mark on the file`,
		);
		// Said again directly, because the equality above would also hold if both
		// files carried the same furniture. `220px` is the hand-drawn line's own
		// place and is a number nothing else in this design has.
		assert.doesNotMatch(out.text, /cg\(|gl\(|220px/);
		// One target says `left: 480px` and the other `translate(480,40)`, so the
		// claim is about the number: what the grid decided is in the file.
		assert.match(out.text, /480/);
	}
});

test("an export says it left the grid behind, and only where there was one", async () => {
	// The one loss in the list that is a decision rather than a limitation, so it
	// is the one that has to be said out loud. Conditional, because a list of
	// losses that pads itself is one nobody finishes reading.
	const grid = (out: { lost: string[] }) => out.lost.filter((l) => /^The grid\./.test(l));

	const held = ruledPage(true);
	const a = await onlyUniverse(held);
	for (const target of EXPORT_TARGET_NAMES) {
		const note = grid(exportUniverse(held, a, { target }));
		assert.equal(note.length, 1, `${target}: expected the grid to be named once`);
		// It has to say the second half too: the grid is gone, what it *decided* is
		// not, and a designer who read only the first clause would go looking for a
		// coordinate that is right there.
		assert.match(note[0], /coordinates/);
	}

	const settled = ruledPage(false);
	assert.deepEqual(
		grid(exportUniverse(settled, await onlyUniverse(settled), { target: "html" })),
		[],
	);
});

test("a grid on something that is not a surface is not a grid to lose", async () => {
	// The same question `compile()` asks before it emits `ggrid/1`: a grid stored
	// on a rectangle is read rather than corrected on the way in, and says nothing
	// to anybody. An export claiming to have dropped it would be claiming to have
	// dropped something the document never had.
	const scene = ruledPage(false);
	const page = scene.nodes[0];
	scene.nodes = [
		{
			...page,
			children: [
				{ ...page.children![0], guides: makeGuides({ columns: 12 }) },
			],
		},
	];
	const out = exportUniverse(scene, await onlyUniverse(scene), { target: "html" });
	assert.equal(
		out.lost.some((l) => /^The grid\./.test(l)),
		false,
	);
});

/* ------------------------------------------------------------------ */
/* The space as one artefact                                           */
/* ------------------------------------------------------------------ */

test("universes that differ only by a colour token are one themed artefact", async () => {
	const scene = pair();
	const exploration = await explore(scene, directSolver, { limit: 24 });
	assert.equal(exploration.universes.length, 3);
	const verdict = collapseSpace(scene, exploration.universes);
	assert.ok(!("reason" in verdict), "expected the space to collapse");
	assert.equal(verdict.kind, "theme");
	assert.equal(verdict.label, "accent");

	const out = exportSpace(scene, exploration.universes, {
		target: "html",
		title: "pair",
	});
	// One artefact: every accent the space holds is in it, and each is a single
	// custom-property redefinition rather than a second copy of the design.
	const accents = exploration.universes.map((u) => u.model.byId.mHero?.rendered.fill);
	for (const accent of accents) {
		assert.ok(accent);
		assert.match(out.text, new RegExp(`--accent: ${accent};`));
	}
	assert.equal(out.text.match(/data-node="mHero"/g)?.length, 1);
	// Nothing but the accent moved, so nothing but the accent is overridden.
	for (const block of out.text.matchAll(/\[data-theme="[^"]+"\] \{\n([^}]*)\}/g)) {
		assert.match(block[1].trim(), /^--accent: #[0-9a-f]{6};$/);
	}
});

test("two colours are light and dark; three are named themes", async () => {
	// Two is the case a target has a convention for, so it gets one — and the
	// attribute as well, because a preference is a default and not a decision.
	const scene = withToken(pair().tokens, "accent", [lit("#3b82f6"), lit("#0b1220")]);
	const two = { ...pair(), tokens: scene };
	const exploration = await explore(two, directSolver, { limit: 24 });
	assert.equal(exploration.universes.length, 2);
	const out = exportSpace(two, exploration.universes, { target: "html" });
	assert.match(out.note, /prefers-color-scheme: dark/);
	assert.match(out.text, /@media \(prefers-color-scheme: dark\) \{\n\t:root \{\n\t\t--accent: /);
	assert.match(out.text, /\[data-theme="dark"\] \{\n\t--accent: /);
	// Three colours have no light and dark to be, so no media query is claimed.
	const three = await explore(pair(), directSolver, { limit: 24 });
	const named = exportSpace(pair(), three.universes, { target: "html" });
	assert.doesNotMatch(named.text, /prefers-color-scheme/);
	assert.match(named.text, /\[data-theme="alt-1"\]/);
	assert.match(named.text, /\[data-theme="alt-2"\]/);
});

test("universes that differ only by direction are one artefact with a breakpoint", async () => {
	const scene = flow();
	const exploration = await explore(scene, directSolver, { limit: 24 });
	assert.equal(exploration.universes.length, 2);
	const verdict = collapseSpace(scene, exploration.universes);
	assert.ok(!("reason" in verdict), "expected the space to collapse");
	assert.equal(verdict.kind, "breakpoint");

	const out = exportSpace(scene, exploration.universes, { target: "html" });
	const media = /@media \(min-width: (\d+)px\) \{\n([\s\S]*?)\n\}/.exec(out.text);
	assert.ok(media, "expected a media query");

	// Mobile first: the base is the column, and the query holds the row.
	const column = exploration.universes.find(
		(u) => u.model.byId.b.frame.x === u.model.byId.a.frame.x,
	);
	const row = exploration.universes.find(
		(u) => u.model.byId.b.frame.x !== u.model.byId.a.frame.x,
	);
	assert.ok(column && row);
	// The model is EMU and the stylesheet is pixels, so the two are held against
	// each other through the one conversion. This used to compare a coordinate
	// with itself, which was true of the numbers and said nothing about them.
	assert.match(
		out.text,
		new RegExp(`top: ${cssPxFromEmu(column.model.byId.b.frame.y)}px;`),
	);
	assert.match(
		media[2],
		new RegExp(`left: ${cssPxFromEmu(row.model.byId.b.frame.x)}px;`),
	);
	// The DOM is shared: one element per node, whatever the viewport.
	assert.equal(out.text.match(/data-node="b"/g)?.length, 1);
});

test("a space with no single meaning exports one design and says why", async () => {
	for (const [make, expected] of [
		// Two positions for one panel: nothing in the document says which of
		// them is the narrow screen.
		[places, /no target has a mechanism/],
		// A length token moves things; a stylesheet cannot re-derive a layout.
		[rail, /Only a colour token exports as a theme/],
		// Two variables at once.
		[card, /2 variables differ/],
	] as const) {
		const scene = make();
		const exploration = await explore(scene, directSolver, { limit: 24 });
		const verdict = collapseSpace(scene, exploration.universes);
		assert.ok("reason" in verdict, "expected a refusal");
		assert.match(verdict.reason, expected);
		// And it still exports: one design, with the reason attached.
		const out = exportSpace(scene, exploration.universes, { target: "html" });
		assert.equal(out.note, verdict.reason);
		assert.match(out.text, /<div class="design">/);
		assert.doesNotMatch(out.text, /@media/);
	}
});

test("a collapsible space still exports as one design in SVG", async () => {
	const scene = pair();
	const exploration = await explore(scene, directSolver, { limit: 24 });
	const out = exportSpace(scene, exploration.universes, { target: "svg" });
	assert.match(out.note, /no media queries/);
	assert.equal(out.text.match(/data-node="mHero"/g)?.length, 1);
});

/* ------------------------------------------------------------------ */
/* A style is a class                                                  */
/* ------------------------------------------------------------------ */

/** A document whose style is worn by two nodes of the given kind. */
function dressed(
	variants: readonly Style["variants"][number][],
	boxes = false,
): Scene {
	const style: Style = { id: "panel", name: "Panel", variants: [...variants] };
	const worn = boxes
		? [
				wearing(rect("a", "A", [20, 20, 80, 40], {}), style.id),
				wearing(rect("b", "B", [20, 80, 80, 40], {}), style.id),
			]
		: [
				wearing(text("a", "A", [20, 20, 200, 24], "Alpha", {}), style.id),
				wearing(text("b", "B", [20, 60, 200, 24], "Beta", {}), style.id),
			];
	return {
		styles: [style],
		machines: [],
		tokens: starterTokens(),
		nodes: [
			frame("page", "Page", [0, 0, 400, 200], { fill: [ref("surface")] }, worn),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
}

/**
 * The generated class one node came out under — `n5`, without the dot.
 *
 * Read out of the markup rather than counted, because the numbering is a
 * pre-order over the model and a test that hard-coded `.n5` would break the day
 * somebody added a node to a fixture, in a way that says nothing about what went
 * wrong. Asking the file which class `data-node="inst(b1,label)"` carries is the
 * same question the exporter answered, asked back.
 */
function className(text: string, nodeId: string): string {
	const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, "&quot;");
	const found = new RegExp(`class="([^" ]+)[^"]*" data-node="${escaped}"`).exec(text);
	assert.ok(found, `no element for ${nodeId}`);
	return found[1];
}

/** The body of one CSS rule in the export, or undefined where it has none. */
function block(text: string, selector: string): string | undefined {
	const at = text.indexOf(`\n${selector} {\n`);
	if (at === -1) return undefined;
	const from = at + selector.length + 4;
	return text.slice(from, text.indexOf("\n}", from));
}

test("a style comes out as a class, and only overrides stay on the node", async () => {
	const scene = typography();
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const out = exportUniverse(scene, exploration.universes[0], {
		target: "html",
		title: "typography",
	});

	// The class is the style, under the style's own name.
	const prose = block(out.text, ":where(.prose)");
	assert.ok(prose, "expected a .prose rule");
	assert.match(prose, /font-family: system-ui/);
	assert.match(prose, /font-size: 15px;/);
	assert.match(prose, /font-weight: 450;/);
	assert.match(prose, /line-height: 1.3;/);

	// Every wearer points at it, and the class name is on the element beside its
	// own — which is what makes the file editable rather than merely smaller.
	assert.equal(out.text.match(/ prose"/g)?.length, 6);

	// The title states its own size and weight, so those two declarations are on
	// its rule and nowhere else. The paragraphs state nothing, so their rules
	// hold no type at all.
	const title = [...out.text.matchAll(/\.(n\d+) \{\n([^}]*)\}/g)];
	const of = (id: string): string => {
		const cls = new RegExp(`class="(n\\d+) prose" data-node="${id}"`).exec(out.text);
		assert.ok(cls, `no element for ${id}`);
		return title.find((m) => m[1] === cls[1])?.[2] ?? "";
	};
	assert.match(of("title"), /font-size: 34px;/);
	assert.match(of("title"), /font-weight: 700;/);
	assert.doesNotMatch(of("title"), /font-family|line-height/);
	assert.doesNotMatch(of("deck"), /font-size|font-weight|font-family|line-height/);

	// And SVG keeps inlining, which is the honest half of the same feature.
	const svg = exportUniverse(scene, exploration.universes[0], { target: "svg" });
	assert.doesNotMatch(svg.text, /class="prose"/);
	assert.equal(svg.text.match(/font-size: 15px/g)?.length, 4);
	assert.ok(
		svg.lost.some((line) => /A style is not a class here/.test(line)),
		"SVG has to say that it inlined the treatment",
	);
});

test("a class holds the token a variant named, not the hex", async () => {
	const scene = dressed([{ name: "Loud", parts: { ink: [ref("accent")][0] } }]);
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const universe = exploration.universes[0];
	const out = exportUniverse(scene, universe, { target: "html" });
	assert.equal(block(out.text, ":where(.panel)"), "\tcolor: var(--accent);");
	// The name stands for what the answer set drew, and for nothing else.
	assert.match(out.text, new RegExp(`--accent: ${universe.model.byId.a.rendered.ink};`));
});

test("a class carries only what every wearer draws", async () => {
	// A rectangle has corners and an ellipse has not, so a style holding a fill
	// and a radius shares the fill and leaves the radius on the rectangle. A
	// shared radius would round the ellipse's box, which the canvas does not.
	const style: Style = {
		id: "both",
		name: "Both",
		variants: [{ parts: { fill: lit("#abcdef"), radius: lit("12px") } }],
	};
	const scene: Scene = {
		styles: [style],
		machines: [],
		tokens: starterTokens(),
		nodes: [
			frame("page", "Page", [0, 0, 400, 200], { fill: [ref("surface")] }, [
				wearing(rect("r", "R", [20, 20, 80, 40], {}), style.id),
				wearing(
					{ ...rect("e", "E", [20, 80, 80, 40], {}), kind: "ellipse" },
					style.id,
				),
			]),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const out = exportUniverse(scene, exploration.universes[0], { target: "html" });
	assert.equal(block(out.text, ":where(.both)"), "\tbackground: #abcdef;");
	assert.equal(out.text.match(/background: #abcdef;/g)?.length, 1, "the fill is shared");
	assert.equal(out.text.match(/border-radius: 12px;/g)?.length, 1, "the radius is not");
	assert.match(out.text, /border-radius: 50%;/, "and the ellipse is still an ellipse");

	// Two kinds with no styleable property in common share nothing, so there is
	// no class at all rather than an empty one.
	const apart: Scene = {
		...scene,
		styles: [{ ...style, id: "apart", name: "Apart" }],
		nodes: [
			frame("page", "Page", [0, 0, 400, 200], { fill: [ref("surface")] }, [
				wearing(text("t", "T", [20, 20, 200, 24], "Alpha", {}), "apart"),
				wearing(rect("r", "R", [20, 60, 80, 40], {}), "apart"),
			]),
		],
	};
	const second = await explore(apart, directSolver, { limit: 4 });
	const bare = exportUniverse(apart, second.universes[0], { target: "html" });
	assert.equal(block(bare.text, ":where(.apart)"), undefined);
	assert.doesNotMatch(bare.text, / apart"/);
	assert.match(bare.text, /background: #abcdef;/, "the rectangle still takes its fill");
});

test("a wearer only the answer set names shares the class too", async () => {
	// Wearing has two sources — `sty_doc/3` and anything a rule derives — and a
	// class with one user was the old reading of the second. The document dresses
	// two nodes; a rule dresses a third, and all three point at one block.
	const base = dressed([{ parts: { ink: ref("accent"), size: lit("22px") } }]);
	const scene: Scene = {
		...base,
		nodes: [
			{
				...base.nodes[0],
				children: [
					...(base.nodes[0].children ?? []),
					text("c", "C", [20, 100, 200, 24], "Gamma", {}),
				],
			},
		],
		rules: `${RULES_HEADER}\nsty_wears(c,panel,ink). sty_wears(c,panel,size).\n`,
	};
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const out = exportUniverse(scene, exploration.universes[0], { target: "html" });

	// One block, three elements pointing at it, and the token name survives
	// because a wearer the document holds is the one that named it.
	assert.equal(block(out.text, ":where(.panel)"), "\tcolor: var(--accent);\n\tfont-size: 22px;");
	assert.equal(out.text.match(/ panel"/g)?.length, 3);
	assert.equal(out.text.match(/font-size: 22px;/g)?.length, 1, "and it is shared, not repeated");
	// The class is all the derived wearer's type: its own rule holds none of it.
	const cls = /class="(n\d+) panel" data-node="c"/.exec(out.text);
	assert.ok(cls, "the rule's wearer carries the class");
	assert.doesNotMatch(block(out.text, `.${cls[1]}`) ?? "", /font-size|color:/);
	assert.ok(
		out.lost.some((line) => /Token names under \.panel/.test(line)),
		"what a derived wearer cannot bring is the name, and the list says so",
	);
});

test("universes that differ only by a style are one artefact with a breakpoint", async () => {
	const scene = typography();
	const exploration = await explore(scene, directSolver, { limit: 8 });
	assert.equal(exploration.universes.length, 2);
	const verdict = collapseSpace(scene, exploration.universes);
	assert.ok(!("reason" in verdict), "expected the space to collapse");
	assert.equal(verdict.kind, "breakpoint");
	assert.equal(verdict.label, "Prose");
	// Mobile first: the tighter treatment is the base, and the variants' own
	// names are what the file calls them.
	assert.match(verdict.note, /Compact below \d+px and Comfortable at or above it/);

	const out = exportSpace(scene, exploration.universes, {
		target: "html",
		title: "typography",
	});
	const media = /@media \(min-width: (\d+)px\) \{\n([\s\S]*?)\n\}/.exec(out.text);
	assert.ok(media, "expected a media query");
	// One class redefinition is the whole of the switch — that is the claim.
	assert.match(media[2], /:where\(\.prose\) \{/);
	assert.match(media[2], /font-size: 18px;/);
	assert.match(media[2], /font-weight: 400;/);
	assert.match(media[2], /Georgia/);
	// The DOM is shared, and a node that overrides the style does not move with
	// the breakpoint: its own declaration is outside the query.
	assert.equal(out.text.match(/data-node="title"/g)?.length, 1);
	assert.doesNotMatch(media[2], /font-size: 34px/);
	assert.ok(
		out.lost.some((line) => /Every variant but two/.test(line)),
		"a collapsed style holds both treatments, and the list has to say so",
	);
});

test("a style that varies only in colour is a theme instead", async () => {
	const scene = dressed([
		{ name: "Day", parts: { ink: lit("#0f172a") } },
		{ name: "Night", parts: { ink: lit("#f8fafc") } },
	]);
	const exploration = await explore(scene, directSolver, { limit: 8 });
	assert.equal(exploration.universes.length, 2);
	const verdict = collapseSpace(scene, exploration.universes);
	assert.ok(!("reason" in verdict), "expected the space to collapse");
	assert.equal(verdict.kind, "theme");
	const out = exportSpace(scene, exploration.universes, { target: "html" });
	// The light treatment is the base whatever order the solver enumerated in,
	// and the dark one is the class under the preference.
	assert.match(block(out.text, ":where(.panel)") ?? "", /color: #0f172a;/);
	assert.match(
		out.text,
		/@media \(prefers-color-scheme: dark\) \{\n\t:where\(\.panel\) \{\n\t\tcolor: #f8fafc;/,
	);
	// Scoped, and still weightless: a node that overrode the treatment has to
	// keep its own colour in the dark theme too.
	assert.match(
		out.text,
		/:where\(\[data-theme="dark"\] \.panel\) \{\n\tcolor: #f8fafc;/,
	);
});

test("a style with no size, or with sizes that disagree, is refused", async () => {
	for (const [variants, expected, boxes] of [
		// A weight is not a distance: nothing says which of two is the narrow
		// screen, so this is the same refusal a bare token gets.
		[
			[
				{ name: "Book", parts: { weight: lit("400") } },
				{ name: "Bold", parts: { weight: lit("700") } },
			],
			/none of that is a size/,
			false,
		],
		// One length grows where the other shrinks, so neither treatment is the
		// tighter one.
		[
			[
				{ name: "A", parts: { radius: lit("4px"), strokeWidth: lit("4px") } },
				{ name: "B", parts: { radius: lit("8px"), strokeWidth: lit("2px") } },
			],
			/disagree about which treatment is the tighter one/,
			true,
		],
	] as const) {
		const scene = dressed(variants, boxes);
		const exploration = await explore(scene, directSolver, { limit: 8 });
		assert.equal(exploration.universes.length, 2);
		const verdict = collapseSpace(scene, exploration.universes);
		assert.ok("reason" in verdict, "expected a refusal");
		assert.match(verdict.reason, expected);
		// And it still exports one design, with the reason attached.
		const out = exportSpace(scene, exploration.universes, { target: "html" });
		assert.equal(out.note, verdict.reason);
		assert.doesNotMatch(out.text, /@media/);
	}
});

test("a line height is ordered by the leading it comes to, not by the ratio", async () => {
	// The real responsive ramp: bigger type, tighter leading. Read as written,
	// 1.5 -> 1.2 shrinks where 16px -> 24px grows, and the collapse would refuse
	// a document that is the textbook case. Read as room on the page, 24px of
	// leading becomes 28.8px and the two agree.
	const ramp = dressed([
		{ name: "Body", parts: { size: lit("16px"), lineHeight: lit("1.5") } },
		{ name: "Display", parts: { size: lit("24px"), lineHeight: lit("1.2") } },
	]);
	const two = await explore(ramp, directSolver, { limit: 8 });
	assert.equal(two.universes.length, 2);
	const verdict = collapseSpace(ramp, two.universes);
	assert.ok(!("reason" in verdict), `expected a collapse, got: ${JSON.stringify(verdict)}`);
	assert.equal(verdict.kind, "breakpoint");
	assert.match(verdict.note, /Body below \d+px and Display at or above it/);

	// And a treatment whose only difference is the leading is orderable at all,
	// which is the case the type table used to get wrong on its own: line height
	// is a `number`, so nothing about it was a length.
	const leading = dressed([
		{ name: "Tight", parts: { lineHeight: lit("1.2") } },
		{ name: "Airy", parts: { lineHeight: lit("1.8") } },
	]);
	const pair = await explore(leading, directSolver, { limit: 8 });
	assert.equal(pair.universes.length, 2);
	const collapsed = collapseSpace(leading, pair.universes);
	assert.ok(!("reason" in collapsed), "a leading ramp is a ramp");
	assert.match(collapsed.note, /Tight below \d+px and Airy at or above it/);
	const out = exportSpace(leading, pair.universes, { target: "html" });
	const media = /@media \(min-width: \d+px\) \{\n([\s\S]*?)\n\}/.exec(out.text);
	assert.ok(media, "expected a media query");
	assert.match(media[1], /line-height: 1.8;/);
});

test("a surface clips, in both targets", async () => {
	// The child hangs over the frame's right edge, which the canvas clips.
	const scene: Scene = {
		styles: [],
		machines: [],
		tokens: starterTokens(),
		nodes: [
			frame("page", "Page", [0, 0, 200, 100], { fill: [ref("surface")] }, [
				rect("over", "Over", [150, 10, 200, 40], { fill: [ref("accent")] }),
			]),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
	assert.ok(KINDS.frame.surface);
	const exploration = await explore(scene, directSolver, { limit: 1 });
	const universe = exploration.universes[0];
	assert.match(
		exportUniverse(scene, universe, { target: "html" }).text,
		/overflow: hidden;/,
	);
	assert.match(
		exportUniverse(scene, universe, { target: "svg" }).text,
		/<clipPath id="clip0">/,
	);
});

test("a document declares every property it would otherwise inherit", async () => {
	// The claim DOCUMENT_BASE exists to make: a design looks the same wherever it
	// is drawn, so nothing about its appearance may be left to the page around
	// it. Read off the table rather than listed here, which is what would have
	// caught line-height — declared by every text kind, and so invisible on the
	// canvas, while an exported file took the browser's `normal`.
	const inherited = PROP_NAMES.filter((prop) => PROPS[prop].inherited);
	assert.ok(inherited.length > 0);
	for (const prop of inherited) {
		const paint = PAINT[prop];
		assert.ok(paint, `${prop} inherits but paints nothing`);
		for (const key of Object.keys(paint(PROPS[prop].fallback))) {
			assert.ok(
				key in DOCUMENT_BASE,
				`${prop} reaches CSS as ${key}, which inherits, so the document has to say it`,
			);
		}
	}
	// And the other half: what it declares is what an exported file carries.
	const scene: Scene = {
		styles: [],
		machines: [],
		tokens: starterTokens(),
		nodes: [frame("page", "Page", [0, 0, 200, 100], {}, [])],
		constraints: [],
		rules: RULES_HEADER,
	};
	const exploration = await explore(scene, directSolver, { limit: 1 });
	const design = block(
		exportUniverse(scene, exploration.universes[0], { target: "html" }).text,
		".design",
	);
	assert.ok(design, "expected a .design rule");
	for (const [key, value] of Object.entries(DOCUMENT_BASE)) {
		assert.ok(
			design.includes(`${cssName(key)}: ${value};`),
			`.design is missing ${cssName(key)}`,
		);
	}
});

/* ------------------------------------------------------------------ */
/* EMU stays inside                                                    */
/* ------------------------------------------------------------------ */

/**
 * A document with a length of every kind it can hold: a coordinate, a size, a
 * radius, a stroke width, a font size, a length token, and — the one that must
 * *not* be a length — a line height.
 *
 * Written as literals rather than through the geometry helpers on purpose. What
 * these two tests are about is the spelling in the document, so the document
 * has to say it out loud; a frame built from numbers would be testing whichever
 * unit `makeFrame` happens to write in.
 */
function inPixels(): Scene {
	const said = (
		node: SceneNode,
		box: [number, number, number, number],
	): SceneNode => ({
		...node,
		frame: {
			x: single(`${box[0]}px`),
			y: single(`${box[1]}px`),
			width: single(`${box[2]}px`),
			height: single(`${box[3]}px`),
		},
	});
	// The frame handed to `makeNode` is thrown away by `said`; only the kind's
	// own defaults survive, which is what these nodes are here for.
	const bare = { x: 0, y: 0, width: 0, height: 0 };
	const panel = said(makeNode("rect", bare, { id: "panel", name: "Panel" }), [
		24, 12, 300, 120,
	]);
	const headline = said(
		makeNode("text", bare, { id: "headline", name: "Headline", text: "Hello" }),
		[24, 156, 300, 48],
	);
	const rule = said(makeNode("line", bare, { id: "rule", name: "Rule" }), [
		24, 228, 300, 24,
	]);
	return {
		styles: [],
		machines: [],
		tokens: [
			...starterTokens(),
			{ id: "gutter", name: "gutter", type: "length", value: single("24px") },
		],
		nodes: [
			said(makeNode("frame", bare, { id: "page", name: "Page" }), [
				0, 0, 480, 300,
			]),
		].map((page) => ({
			...page,
			props: { fill: [ref("muted")] },
			children: [
				{
					...panel,
					props: {
						fill: [ref("accent")],
						radius: [ref("gutter")],
						stroke: [lit("#0f172a")],
						strokeWidth: [lit("6px")],
					},
				},
				{
					...headline,
					props: {
						...headline.props,
						size: single("24px"),
						lineHeight: single("1.35"),
					},
				},
				{ ...rule, props: { ...rule.props, strokeWidth: single("3px") } },
			],
		})),
		constraints: [],
		rules: RULES_HEADER,
	};
}

/**
 * The same document with every length respelled in `unit`.
 *
 * Length-typed only, and the table says which: a `weight` of `"400"` and a
 * `lineHeight` of `"1.35"` are bare numbers that `emuOf` would happily read as
 * pixels, and respelling either would be this helper inventing a design rather
 * than restating one. That is the same distinction the exporter's own
 * {@link cssValue} turns on, so the two agreeing is part of what is being
 * tested.
 */
function respelled(scene: Scene, unit: Unit): Scene {
	const say = (value: Value): Value =>
		value.map((term) => {
			if (term.kind !== "literal") return term;
			const emu = emuOf(term.value);
			return emu === undefined ? term : lit(formatLength(emu, unit));
		});
	const walk = (node: SceneNode): SceneNode => ({
		...node,
		frame: {
			x: say(node.frame.x),
			y: say(node.frame.y),
			width: say(node.frame.width),
			height: say(node.frame.height),
		},
		props: Object.fromEntries(
			Object.entries(node.props).map(([prop, value]) => [
				prop,
				isLengthType(PROPS[prop as PropName].type) ? say(value) : value,
			]),
		),
		...(node.children ? { children: node.children.map(walk) } : {}),
	});
	return {
		...scene,
		nodes: scene.nodes.map(walk),
		tokens: scene.tokens.map((token) =>
			isLengthType(token.type) ? { ...token, value: say(token.value) } : token,
		),
	};
}

test("a document in whole pixels comes out in whole pixels", async () => {
	// The promise EMU is allowed to make: geometry is 1/914400 of an inch on the
	// inside and the file is unchanged on the outside. Every number below is the
	// one the document states, and none of them acquired a fraction on the way
	// through the solver, the answer set and two emitters.
	const scene = inPixels();
	const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];

	const html = exportUniverse(scene, universe, { target: "html" }).text;
	assert.ok(block(html, ".n1")?.includes("left: 24px;"));
	assert.ok(block(html, ".n1")?.includes("top: 12px;"));
	assert.ok(block(html, ".n1")?.includes("width: 300px;"));
	assert.ok(block(html, ".n1")?.includes("height: 120px;"));
	// A length that names a token is the token, and the definition is pixels.
	assert.ok(block(html, ".n1")?.includes("border-radius: var(--gutter);"));
	assert.ok(block(html, ":root")?.includes("--gutter: 24px;"));
	assert.ok(block(html, ".n1")?.includes("border-width: 6px;"));
	assert.ok(block(html, ".n2")?.includes("font-size: 24px;"));
	// The design's own box, which is the bounds of every root — and `block`
	// would find BASE_CSS's `.design` first, so this one is matched whole.
	assert.match(html, /\n\.design \{\n\twidth: 480px;\n\theight: 300px;\n\}/);

	const svg = exportUniverse(scene, universe, { target: "svg" }).text;
	assert.match(svg, /viewBox="0 0 480 300"/);
	assert.match(svg, /<g transform="translate\(24,12\)" data-node="panel"/);
	assert.match(svg, /<rect width="300" height="120"/);
	// A diagonal's own arithmetic is in pixels too, barbs and all.
	assert.match(svg, /data-node="rule"[\s\S]*?<line x1="0" y1="0" x2="300" y2="24"/);

	// And the whole of it, rather than the numbers anyone thought to name: a
	// fraction anywhere is a conversion that leaked.
	for (const text of [html, svg]) {
		for (const [, n] of text.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
			assert.ok(Number.isInteger(Number(n)), `${n}px is not a whole pixel`);
		}
	}
});

test("the same design said in points is the same file", async () => {
	// The other half of the same promise, and the sharper half. A document holds
	// the unit its designer typed — 18pt stays 18pt on disk, which is the whole
	// reason the storage form kept its suffixes — and an export must carry none
	// of that: the file is the picture, the picture is identical, so the bytes
	// are identical. Points because every whole pixel is exactly 0.75 of one, so
	// the two documents can say the same design with nothing rounded.
	const pixels = inPixels();
	const points = respelled(pixels, "pt");
	assert.notDeepEqual(points.nodes, pixels.nodes, "the documents differ, as they must");
	assert.deepEqual(
		findInTree(points.nodes, "panel")?.frame.x[0],
		lit("18pt"),
		"24px, in the unit the designer typed",
	);
	assert.deepEqual(
		findInTree(points.nodes, "headline")?.props.lineHeight,
		single("1.35"),
		"a ratio is not a length and is left alone",
	);

	for (const target of EXPORT_TARGET_NAMES) {
		const [a, b] = await Promise.all(
			[pixels, points].map(async (scene) => {
				const universe = (await explore(scene, directSolver, { limit: 1 }))
					.universes[0];
				return exportUniverse(scene, universe, { target, title: "units" }).text;
			}),
		);
		assert.equal(a, b, `${target}: the unit a designer typed reached the file`);
	}
});

test("a length no CSS unit spells reaches the canvas as pixels too", async () => {
	// The literal `formatLength` falls back on when nothing says a value exactly.
	// Typing `12.5` into a Radius field gives 119063 EMU — half a thousandth of a
	// pixel off twelve and a half, and no CSS unit spells it — so the document
	// records `"119063emu"`, which is a real spelling and not a corrupt one.
	//
	// `emu` is not CSS, and a browser drops a declaration it cannot parse in
	// silence. Handed straight to the canvas the corner would simply not round,
	// while the exporter converted and wrote the radius correctly: a property
	// that paints differently in the two renderers, which is the one thing
	// `paint.ts` exists to prevent. So both renderers are asked here, in one
	// test, because the claim is about the two of them agreeing.
	const emu = nearestEmu("12.5px");
	assert.ok(emu !== undefined);
	const radius = formatLength(emu, "px");
	assert.equal(radius, "119063emu", "no CSS unit spells this value exactly");

	assert.deepEqual(paintOf({ kind: "rect", rendered: { radius } }), {
		borderRadius: "12.5001px",
	});

	const scene = inPixels();
	const panel = findInTree(scene.nodes, "panel");
	assert.ok(panel);
	panel.props.radius = single(radius);
	const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];
	const html = exportUniverse(scene, universe, { target: "html" }).text;
	assert.ok(block(html, ".n1")?.includes("border-radius: 12.5001px;"));
});

/* ------------------------------------------------------------------ */
/* State machines, as selectors                                        */
/* ------------------------------------------------------------------ */

/**
 * The way out for behaviour, and the claim it is held to.
 *
 * Everything below runs through the real solver for the reason the rest of this
 * file does, plus one that is particular to states: a state copy's `frame/3` and
 * `rendered/3` are things the *program* derives — through the shared-variable
 * inherit rule, the `mshadow` guard and the alias — and a hand-written model of
 * them would be a test of what this file believes the encoding does rather than
 * of what it does. The whole point of `stt(I,S,N)` being in the same answer set
 * as the picture is that the exporter can read the two side by side, so that is
 * how they are read here.
 *
 * The load-bearing assertion is the first one: **a hover pair leaves as a
 * stylesheet with no behaviour in it.** That is not a nicety. It is the reason
 * `TRIGGERS` carries a `css` column at all, and a file that shipped a script to
 * do what `:hover` does would be a worse artefact than the one this tool
 * replaced.
 */

/** A transition, with the defaults that make one legal without saying anything. */
const edge = (
	spec: Partial<Transition> & { id: string; from: string; to: string },
): Transition => ({ trigger: "pointerenter", enabled: true, ...spec });

/**
 * A button definition, some uses of it, and a machine over it.
 *
 * Three parts under the root — a hugging label, a panel and an arrow inside the
 * panel — because the losses this file has to be honest about are per part: the
 * arrow is the `drawnGeometry` case, the label is the wording case, and the panel
 * is the one a state can hide. A fixture with one rectangle in it would pass
 * every test here and prove none of them.
 */
function machined(spec: {
	machines: Machine[];
	uses?: Array<{ id: string; state?: string }>;
	tokens?: Scene["tokens"];
}): Scene {
	const definition: SceneNode = {
		...frame(
			"btn",
			"Button",
			[20, 20, 160, 150],
			{ fill: [ref("accent")], radius: single("8px") },
			[
				text("label", "Label", [12, 14, 136, 20], "Go", {
					ink: single("#ffffff"),
					size: single("14px"),
				}),
				frame("panel", "Panel", [0, 52, 160, 90], { fill: single("#0f172a") }, [
					{
						...rect("mark", "Mark", [8, 8, 60, 40], {
							stroke: single("#ffffff"),
							strokeWidth: single("3px"),
						}),
						kind: "arrow",
						diagonal: "down",
					},
				]),
			],
		),
		component: true,
	};
	return {
		styles: [],
		machines: spec.machines,
		tokens: spec.tokens ?? starterTokens(),
		constraints: [],
		rules: RULES_HEADER,
		nodes: [
			frame("page", "Page", [0, 0, 600, 400], { fill: [ref("surface")] }, [
				definition,
				...(spec.uses ?? [{ id: "b1" }]).map((use, i) => ({
					...makeNode(
						"instance",
						at([300, 20 + i * 180, 160, 150]),
						{ id: use.id, name: use.id },
					),
					instanceOf: "btn",
					...(use.state === undefined ? {} : { state: use.state }),
				})),
			]),
		],
	};
}

/** The one universe of a document, exported to HTML. */
async function exported(scene: Scene, options: Partial<ExportOptions> = {}) {
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const universe = exploration.universes[0];
	assert.ok(universe, "expected at least one universe");
	return {
		universe,
		out: exportUniverse(scene, universe, { target: "html", title: "m", ...options }),
	};
}

/** A machine whose hover state is the whole of what it does. */
const hoverMachine = (delta: Record<string, StatePart>): Machine => ({
	id: "m1",
	name: "Button",
	root: "btn",
	states: [
		{ id: "rest", name: "Rest", parts: {} },
		{ id: "hover", name: "Hover", parts: delta },
	],
	transitions: [
		edge({ id: "in", from: "rest", to: "hover", trigger: "pointerenter" }),
		edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
	],
});

test("a hover pair is a pseudo-class and no script at all", async () => {
	const scene = machined({
		machines: [hoverMachine({ btn: { props: { fill: single("#1d4ed8") } } })],
	});
	const { out } = await exported(scene);

	// The instance's element is `.n4`; its copy of the definition root is `.n5`.
	// Read out of the file rather than assumed, so the test says what it means
	// even if the numbering moves.
	const host = className(out.text, "b1");
	const part = className(out.text, "inst(b1,btn)");
	const state = block(out.text, `.${host}:hover .${part}`);
	assert.ok(state, "expected a :hover rule on the instance");
	assert.match(state, /background: #1d4ed8;/);

	assert.doesNotMatch(out.text, /<script/, "a hover pair needs no behaviour");
	assert.doesNotMatch(out.text, /data-state/, "and no attribute either");

	// And the base rule is what paces it, so the move works in both directions.
	const base = block(out.text, `.${part}`);
	assert.ok(base);
	assert.match(base, /transition: background 200ms ease-out 0ms;/);
});

test("a click toggle drives data-state, and the runtime comes with it", async () => {
	const scene = machined({
		machines: [
			{
				id: "m2",
				name: "Dropdown",
				root: "btn",
				states: [
					{ id: "closed", name: "Closed", parts: {} },
					{
						id: "open",
						name: "Open",
						parts: { panel: { props: { fill: single("#f8fafc") } } },
					},
				],
				transitions: [
					edge({ id: "t1", from: "closed", to: "open", trigger: "click" }),
					edge({ id: "t2", from: "open", to: "closed", trigger: "click" }),
				],
			},
		],
	});
	const { out } = await exported(scene);

	const host = className(out.text, "b1");
	const panel = className(out.text, "inst(b1,panel)");
	const state = block(out.text, `.${host}[data-state="open"] .${panel}`);
	assert.ok(state, "expected a data-state rule");
	assert.match(state, /background: #f8fafc;/);

	// The script is in the file, and it is the table the studio steps.
	assert.match(out.text, /<script>/);
	const script = out.text.slice(out.text.indexOf("<script>") + 8, out.text.indexOf("</script>"));
	const table = machineTable(scene);
	assert.equal(
		stepMachine(table, "b1", "closed", "click"),
		"open",
		"the fixture really is a toggle",
	);
	assert.ok(script.includes('"edges"'), "the emitted table is in the script");
	// Evaluated, and asked the same question the CSS answers, so "the file and the
	// studio behave the same" is checked on the text that actually shipped.
	const runtime = evalRuntime(table);
	assert.equal(runtime.step("b1", "closed", "click"), "open");
});

test("the transition names only what changes, and takes the duration it resolved to", async () => {
	const scene = machined({
		machines: [
			{
				...hoverMachine({
					label: { props: { ink: single("#facc15"), size: single("18px") } },
				}),
				transitions: [
					edge({
						id: "in",
						from: "rest",
						to: "hover",
						trigger: "pointerenter",
						duration: single("0.12s"),
						easing: "easeInOut",
					}),
					edge({
						id: "out",
						from: "hover",
						to: "rest",
						trigger: "pointerleave",
						duration: single("0.12s"),
						easing: "easeInOut",
					}),
				],
			},
		],
	});
	const { out } = await exported(scene);
	const label = className(out.text, "inst(b1,label)");
	const base = block(out.text, `.${label}`);
	assert.ok(base);
	// Both properties, in the order they changed, and seconds read as whole
	// milliseconds — the same reading `msOf` gives and the program's `mdur/3`
	// carries.
	assert.match(base, /transition: color, font-size 120ms ease-in-out 0ms;/);
	// And nothing that did not change: the button's own fill is untouched here.
	const part = className(out.text, "inst(b1,btn)");
	assert.doesNotMatch(block(out.text, `.${part}`) ?? "", /transition:/);
});

test("only narrows what is tweened", async () => {
	const scene = machined({
		machines: [
			{
				...hoverMachine({
					label: { props: { ink: single("#facc15"), size: single("18px") } },
				}),
				transitions: [
					edge({
						id: "in",
						from: "rest",
						to: "hover",
						trigger: "pointerenter",
						only: ["ink"],
					}),
					edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
				],
			},
		],
	});
	const { out } = await exported(scene);
	const base = block(out.text, `.${className(out.text, "inst(b1,label)")}`);
	assert.ok(base);
	assert.match(base, /transition: color 200ms ease-out 0ms;/);
	assert.doesNotMatch(base, /font-size 200ms/, "the size was told to snap");
	// The size still changes; it simply changes at once.
	const state = block(
		out.text,
		`.${className(out.text, "b1")}:hover .${className(out.text, "inst(b1,label)")}`,
	);
	assert.match(state ?? "", /font-size: 18px;/);
});

test("a stagger arrives as increasing delays, in paint order", async () => {
	const scene = machined({
		machines: [
			{
				...hoverMachine({
					btn: { props: { fill: single("#1d4ed8") } },
					label: { props: { ink: single("#facc15") } },
					panel: { props: { fill: single("#f8fafc") } },
				}),
				transitions: [
					edge({
						id: "in",
						from: "rest",
						to: "hover",
						trigger: "pointerenter",
						delay: single("40ms"),
						stagger: single("60ms"),
					}),
					edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
				],
			},
		],
	});
	const { out } = await exported(scene);
	const delays = ["inst(b1,btn)", "inst(b1,label)", "inst(b1,panel)"].map((id) => {
		const body = block(out.text, `.${className(out.text, id)}`) ?? "";
		return /transition: [^;]* (\d+)ms;/.exec(body)?.[1];
	});
	// The root first, then its children in paint order: the delay is the rhythm
	// `order/2` states, not the order a map happened to be built in.
	assert.deepEqual(delays, ["40", "100", "160"]);
});

test("a state that moves a node translates it, so the move runs on the compositor", async () => {
	const scene = machined({
		machines: [hoverMachine({ label: { frame: { y: single("6px") } } })],
	});
	const { out } = await exported(scene);
	const state = block(
		out.text,
		`.${className(out.text, "b1")}:hover .${className(out.text, "inst(b1,label)")}`,
	);
	assert.ok(state, "expected the label to move on hover");
	// The label sits at y = 14px at rest, so the state is eight pixels up — a
	// translation, and not a second absolute `top` for the browser to lay out.
	assert.match(state, /transform: translate\(0px, -8px\);/);
	assert.doesNotMatch(state, /top:/);
	// And the base rule paces the transform rather than a coordinate.
	const base = block(out.text, `.${className(out.text, "inst(b1,label)")}`);
	assert.match(base ?? "", /transition: transform 200ms/);
});

test("a state that hides a part says display:none, and says what that costs", async () => {
	// Drawn in `open`, so the panel is in the markup and `closed` can take it
	// away. The other way round there is no element for a selector to reach: a
	// class can restyle markup and cannot write it, which the losses also say.
	const scene = machined({
		machines: [
			{
				id: "m3",
				name: "Dropdown",
				root: "btn",
				states: [
					{ id: "closed", name: "Closed", parts: { panel: { hidden: true } } },
					{ id: "open", name: "Open", parts: {} },
				],
				transitions: [
					edge({ id: "t1", from: "closed", to: "open", trigger: "click" }),
					edge({ id: "t2", from: "open", to: "closed", trigger: "click" }),
				],
			},
		],
		uses: [{ id: "b1", state: "open" }],
	});
	const { out } = await exported(scene);
	const state = block(
		out.text,
		`.${className(out.text, "b1")}[data-state="closed"] .${className(out.text, "inst(b1,panel)")}`,
	);
	assert.equal(state?.trim(), "display: none;");
	assert.ok(
		out.lost.some((line) => /takes .* out of the picture/.test(line)),
		"the structural change is named",
	);
	assert.ok(
		out.lost.some((line) => /data-state rule rather than a pseudo-class/.test(line)),
		"and so is the base this file had to be",
	);
	// `display` is never in a transition: there is nothing between shown and not
	// shown to interpolate, so naming it would be a declaration a browser ignores.
	assert.doesNotMatch(out.text, /transition:[^;]*display/);
});

test("a dropdown drawn closed exports inert, and the loss says how to fix it", async () => {
	// The same machine as above, drawn in its *initial* state — which is what a
	// person gets by doing nothing — and it is the spec's own headline example.
	// The panel is hidden in `closed`, so it is not in the markup; `open` therefore
	// finds nothing to restyle and the whole machine leaves as a picture with no
	// behaviour in it. The file is honest either way, but "your dropdown does not
	// open" deserves more than a statement of fact, because the fix is one click
	// and is exactly the one the test above takes.
	const scene = machined({
		machines: [
			{
				id: "m3",
				name: "Dropdown",
				root: "btn",
				states: [
					{ id: "closed", name: "Closed", parts: { panel: { hidden: true } } },
					{ id: "open", name: "Open", parts: {} },
				],
				transitions: [
					edge({ id: "t1", from: "closed", to: "open", trigger: "click" }),
					edge({ id: "t2", from: "open", to: "closed", trigger: "click" }),
				],
			},
		],
		uses: [{ id: "b1" }],
	});
	const { out } = await exported(scene);
	assert.doesNotMatch(out.text, /<script/, "nothing to switch, so no runtime");
	assert.doesNotMatch(out.text, /data-state/);
	const line = out.lost.find((l) => /which this design is not drawing/.test(l));
	assert.ok(line, "the missing part is named");
	assert.match(line, /Closed — the state this use is drawn in — takes it out/);
	assert.match(line, /Draw this use in a state that shows “panel”/);
});

test("a state that moves a drawn-geometry node is named as a loss, not emitted", async () => {
	const scene = machined({
		machines: [hoverMachine({ mark: { frame: { x: single("30px") } } })],
	});
	const { out } = await exported(scene);
	assert.ok(
		out.lost.some((line) => /draw their own geometry inside their box/.test(line)),
		"an arrow a state moves is named",
	);
	// And the class it could not move is not in the file pretending otherwise.
	assert.doesNotMatch(out.text, /:hover .* \{\n\ttransform/);
	const state = block(
		out.text,
		`.${className(out.text, "b1")}:hover .${className(out.text, "inst(b1,mark)")}`,
	);
	assert.equal(state, undefined, "no broken class for a shape that cannot move");
});

test("a document with no machine exports exactly what it did before", async () => {
	// Byte identity against the same document with a machine that says nothing:
	// an empty state materialises no part, so the program derives no copy and the
	// file has nowhere to put one. This is the assertion that the feature costs a
	// machine-less document nothing at all.
	const bare = machined({ machines: [] });
	const inert = machined({
		machines: [
			{
				id: "m4",
				name: "Quiet",
				root: "btn",
				states: [
					{ id: "rest", name: "Rest", parts: {} },
					{ id: "other", name: "Other", parts: {} },
				],
				transitions: [edge({ id: "t1", from: "rest", to: "other" })],
			},
		],
	});
	for (const target of EXPORT_TARGET_NAMES) {
		const [a, b] = await Promise.all(
			[bare, inert].map(async (scene) => {
				const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];
				return exportUniverse(scene, universe, { target, title: "m" }).text;
			}),
		);
		assert.equal(a, b, `${target}: a machine that says nothing changed the file`);
	}
	const { out } = await exported(bare);
	assert.doesNotMatch(out.text, /<script/);
	assert.doesNotMatch(out.text, /transition:/);
	assert.doesNotMatch(out.text, /data-state/);
});

test("the SVG target says it carries no behaviour, and carries the drawn state", async () => {
	const scene = machined({
		machines: [hoverMachine({ btn: { props: { fill: single("#1d4ed8") } } })],
	});
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const out = exportUniverse(scene, exploration.universes[0], {
		target: "svg",
		title: "m",
	});
	assert.ok(
		out.lost.some((line) => /^Behaviour\. An SVG has no states/.test(line)),
		"the format's own loss is unconditional",
	);
	// The rest colour, and nothing of the hover one anywhere in the file.
	assert.doesNotMatch(out.text, /#1d4ed8/);
	assert.doesNotMatch(out.text, /<script/);
});

test("a theme and a machine compose, and neither eats the other", async () => {
	// One colour token with two values is a theme; a hover pair is a state. They
	// are separate mechanisms on purpose — see the note above `StateLayer` — and
	// the proof is that both survive in one file.
	const scene = machined({
		machines: [hoverMachine({ label: { props: { ink: single("#facc15") } } })],
		tokens: withToken(starterTokens(), "accent", [lit("#eff6ff"), lit("#1e3a8a")]),
	});
	const exploration = await explore(scene, directSolver, { limit: 4 });
	assert.equal(exploration.universes.length, 2, "two colours, and the machine adds none");
	const out = exportSpace(scene, exploration.universes, { target: "html", title: "m" });
	assert.match(out.text, /@media \(prefers-color-scheme: dark\)/, "the theme survived");
	assert.match(out.text, /:hover \./, "and so did the state");
	// The transition on the base rule must not be unsaid inside the media query:
	// a `diff` that saw it there would emit `transition: unset` and the dark
	// design would stop moving.
	assert.doesNotMatch(out.text, /transition: unset/);
});

test("exportMachines reads the states without building a file", async () => {
	const scene = machined({
		machines: [hoverMachine({ btn: { props: { fill: single("#1d4ed8") } } })],
	});
	const { universe } = await exported(scene);
	const machines = exportMachines(scene, {
		universe,
		media: null,
		under: null,
		label: "The design",
	});
	assert.equal(machines.layers.length, 1);
	const [layer] = machines.layers;
	assert.equal(layer.on, ":hover");
	assert.equal(layer.instance, "b1");
	assert.equal(layer.state, "hover");
	assert.deepEqual([...layer.changed.keys()], ["inst(b1,btn)"]);
	assert.equal(machines.runtime, null, "a pseudo-class needs no script");
});

test("press and focus have their own pseudo-classes, read off the trigger table", async () => {
	// Not three copies of the hover test: the point is that nothing in `export.ts`
	// names a trigger. `TRIGGERS[g].css` and `.pair` decide, so a machine built on
	// pointerdown/pointerup collapses for exactly the same reason hover does, and
	// a sixth trigger with a pseudo-class would need no change here at all.
	for (const [into, back, expected] of [
		["pointerdown", "pointerup", ":active"],
		["focus", "blur", ":focus-visible"],
	] as const) {
		const scene = machined({
			machines: [
				{
					...hoverMachine({ btn: { props: { fill: single("#1d4ed8") } } }),
					transitions: [
						edge({ id: "in", from: "rest", to: "hover", trigger: into }),
						edge({ id: "out", from: "hover", to: "rest", trigger: back }),
					],
				},
			],
		});
		const { out } = await exported(scene);
		const state = block(
			out.text,
			`.${className(out.text, "b1")}${expected} .${className(out.text, "inst(b1,btn)")}`,
		);
		assert.ok(state, `expected ${expected} for ${into}/${back}`);
		assert.match(state, /background: #1d4ed8;/);
		assert.doesNotMatch(out.text, /<script/, `${expected} needs no behaviour`);
	}
});

test("a pair CSS has no name for, or a state with a way out CSS cannot see, keeps the script", async () => {
	// Each half of §8.1's test, on its own minimal machine. The first enters on a
	// pseudo-class trigger and leaves on one CSS cannot express; the second is a
	// clean hover pair with one extra edge out. Both are behaviour a `:hover` rule
	// would silently drop, so both keep the attribute and the runtime.
	for (const extra of [
		[
			edge({ id: "in", from: "rest", to: "hover", trigger: "pointerenter" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "click" }),
		],
		[
			edge({ id: "in", from: "rest", to: "hover", trigger: "pointerenter" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			edge({ id: "away", from: "hover", to: "rest", trigger: "blur" }),
		],
	]) {
		const scene = machined({
			machines: [
				{
					...hoverMachine({ btn: { props: { fill: single("#1d4ed8") } } }),
					transitions: extra,
				},
			],
		});
		const { out } = await exported(scene);
		assert.match(out.text, /\[data-state="hover"\]/);
		assert.match(out.text, /<script>/);
	}
});

/* ------------------------------------------------------------------ */
/* The ladder: layers, timelines and blends                            */
/* ------------------------------------------------------------------ */

/**
 * The rungs above a plain two-state machine, and the one thing they must not
 * cost.
 *
 * Everything below runs through the real solver for the reason the states above
 * it do, and one more: a layer's composite is a *rule* — `mwriter/4` decides
 * which layer owns a property when two of them paint it — so "the cascade
 * resolves a fight the same way the program does" is a claim about two
 * mechanisms neither of which this file implements. Asserting it against a
 * hand-built model would assert what the exporter believes about the encoding.
 *
 * The load-bearing assertion is still the first one in this file: **a hover pair
 * leaves as a stylesheet with no behaviour in it.** Nothing here may make a
 * document that needed no script need one, and the last test in this block is
 * that promise held against a document with a second layer in it.
 */

/** A machine with two layers, each a rest state and one that paints the root. */
function layered(spec: {
	second: Value;
	first?: Value;
	states?: Record<string, string>;
}): Machine {
	return {
		id: "m3",
		name: "Stack",
		root: "btn",
		layers: [
			{ id: "press", name: "Press" },
			{ id: "glow", name: "Glow" },
		],
		states: [
			{ id: "rest", name: "Rest", parts: {}, layer: "press" },
			{
				id: "down",
				name: "Down",
				parts: { btn: { props: { fill: spec.first ?? single("#111111") } } },
				layer: "press",
			},
			{ id: "dark", name: "Dark", parts: {}, layer: "glow" },
			{
				id: "lit",
				name: "Lit",
				parts: { btn: { props: { fill: spec.second } } },
				layer: "glow",
			},
		],
		transitions: [
			// A click toggle rather than a press pair, deliberately: a pointerdown /
			// pointerup pair collapses to `:active` and this test is about the
			// attribute the *first* layer writes when it needs one.
			edge({ id: "d1", from: "rest", to: "down", trigger: "click" }),
			edge({ id: "d2", from: "down", to: "rest", trigger: "click" }),
			edge({ id: "g1", from: "dark", to: "lit", trigger: "click" }),
			edge({ id: "g2", from: "lit", to: "dark", trigger: "click" }),
		],
	};
}

test("a second layer switches on its own attribute, and the first still switches on data-state", async () => {
	const scene = machined({ machines: [layered({ second: single("#22c55e") })] });
	const { out } = await exported(scene);

	const host = className(out.text, "b1");
	const part = className(out.text, "inst(b1,btn)");
	// The press layer is first, so it writes what a one-layer machine has always
	// written; the glow layer writes its own attribute, which is exactly what
	// `attributeOf` in the emitted runtime does.
	assert.ok(
		block(out.text, `.${host}[data-state="down"] .${part}`),
		"the first layer keeps plain data-state",
	);
	assert.ok(
		block(out.text, `.${host}[data-state-glow="lit"] .${part}`),
		"a further layer writes data-state-<layer>",
	);
	// And the emitted runtime is the one that writes them.
	assert.match(out.text, /data-state-/);
	const script = out.text.slice(out.text.indexOf("<script>") + 8, out.text.indexOf("</script>"));
	assert.ok(script.includes('"layers"'), "the layered table is in the script");
});

test("two layers that paint one part are resolved by the cascade the way mwriter resolves them", async () => {
	// Drawn in both layers' painting states, so the answer set has to compose
	// them: `inst(b1,btn)` carries one fill, decided by `mwriter/4`, which is the
	// *last* layer that owns the property.
	const drawn = machined({
		machines: [layered({ first: single("#111111"), second: single("#22c55e") })],
		uses: [{ id: "b1" }],
	});
	const use = findInTree(drawn.nodes, "b1");
	assert.ok(use);
	use.states = { press: "down", glow: "lit" };
	const { out, universe } = await exported(drawn);
	const composed = universe.model.byId["inst(b1,btn)"]?.rendered.fill;
	assert.equal(composed, "#22c55e", "the later layer owns the fill in the answer set");
	const base = block(out.text, `.${className(out.text, "inst(b1,btn)")}`);
	assert.ok(base);
	assert.match(base, /background: #22c55e;/, "and the file draws what the answer set said");

	// The same fight as two selectors: both rules match when both layers are in
	// their painting state, so the one that wins is the one written later — and
	// the layers are written in document order, which is the order `mwriter`
	// reads them in.
	const rest = machined({
		machines: [layered({ first: single("#111111"), second: single("#22c55e") })],
	});
	const plain = (await exported(rest)).out.text;
	const host = className(plain, "b1");
	const part = className(plain, "inst(b1,btn)");
	const firstAt = plain.indexOf(`.${host}[data-state="down"] .${part}`);
	const secondAt = plain.indexOf(`.${host}[data-state-glow="lit"] .${part}`);
	assert.ok(firstAt !== -1 && secondAt !== -1);
	assert.ok(secondAt > firstAt, "the later layer's rule is later in the file");
});

test("a second layer that is a clean hover pair still needs no script", async () => {
	// The whole promise, held one rung up. Two layers, both of which CSS has a
	// name for, is still a stylesheet and nothing else.
	const scene = machined({
		machines: [
			{
				id: "m4",
				name: "Two",
				root: "btn",
				layers: [
					{ id: "over", name: "Over" },
					{ id: "focus", name: "Focus" },
				],
				states: [
					{ id: "rest", name: "Rest", parts: {}, layer: "over" },
					{
						id: "hover",
						name: "Hover",
						parts: { btn: { props: { fill: single("#1d4ed8") } } },
						layer: "over",
					},
					{ id: "blur", name: "Blur", parts: {}, layer: "focus" },
					{
						id: "ring",
						name: "Ring",
						parts: { btn: { props: { stroke: single("#f59e0b") } } },
						layer: "focus",
					},
				],
				transitions: [
					edge({ id: "h1", from: "rest", to: "hover", trigger: "pointerenter" }),
					edge({ id: "h2", from: "hover", to: "rest", trigger: "pointerleave" }),
					edge({ id: "f1", from: "blur", to: "ring", trigger: "focus" }),
					edge({ id: "f2", from: "ring", to: "blur", trigger: "blur" }),
				],
			},
		],
	});
	const { out } = await exported(scene);
	const host = className(out.text, "b1");
	const part = className(out.text, "inst(b1,btn)");
	assert.ok(block(out.text, `.${host}:hover .${part}`));
	assert.ok(block(out.text, `.${host}:focus-visible .${part}`));
	assert.doesNotMatch(out.text, /<script/, "two pseudo-classes are still no behaviour");
	assert.doesNotMatch(out.text, /data-state/, "and no attribute either");
});

/** A machine whose `spin` state plays a timeline over the panel. */
function timelined(spec: {
	tracks: Track[];
	length?: Value;
	loop?: LoopMode;
	drawnIn?: string;
	exit?: Value;
}): Machine {
	return {
		id: "m5",
		name: "Player",
		root: "btn",
		timelines: [
			{
				id: "w1",
				name: "Sweep",
				tracks: spec.tracks,
				...(spec.length === undefined ? {} : { length: spec.length }),
				...(spec.loop === undefined ? {} : { loop: spec.loop }),
			},
		],
		states: [
			{ id: "still", name: "Still", parts: {} },
			{ id: "spin", name: "Spin", parts: {}, timeline: "w1" },
		],
		transitions: [
			edge({
				id: "go",
				from: "still",
				to: "spin",
				trigger: "click",
				...(spec.exit === undefined ? {} : { exit: spec.exit }),
			}),
			edge({ id: "stop", from: "spin", to: "still", trigger: "click" }),
		],
	};
}

test("a timeline comes out as @keyframes, and the state that plays it turns it on", async () => {
	const scene = machined({
		machines: [
			timelined({
				length: single("600ms"),
				tracks: [
					{
						part: "panel",
						prop: "opacity",
						keys: [
							{ at: single("0ms"), value: single("0.2") },
							{ at: single("300ms"), value: single("1") },
							{ at: single("600ms"), value: single("0.2") },
						],
					},
				],
			}),
		],
	});
	const { out } = await exported(scene);
	const host = className(out.text, "b1");
	const panel = className(out.text, "inst(b1,panel)");

	// One block, named after the instance, the timeline and the part, because a
	// `@keyframes` block is applied to an element and a timeline may animate
	// several.
	const name = "k-b1-w1-panel";
	assert.ok(out.text.includes(`@keyframes ${name} {`), "the block is in the file");
	assert.match(out.text, /\n\t0% \{\n\t\topacity: 0.2;/);
	assert.match(out.text, /\n\t50% \{\n\t\topacity: 1;/);
	assert.match(out.text, /\n\t100% \{\n\t\topacity: 0.2;/);

	// And the state that plays it is where the animation is switched on, since a
	// timeline plays *in* a state and this file's rules are the other state.
	const state = block(out.text, `.${host}[data-state="spin"] .${panel}`);
	assert.ok(state, "expected a rule for the state that plays it");
	assert.match(state, new RegExp(`animation: ${name} 600ms linear 0ms 1 normal both;`));
});

test("a loop and a ping-pong reach animation-iteration-count and animation-direction", async () => {
	for (const [loop, expected] of [
		["loop", "infinite normal"],
		["pingPong", "infinite alternate"],
	] as const) {
		const scene = machined({
			machines: [
				timelined({
					loop,
					length: single("400ms"),
					tracks: [
						{
							part: "panel",
							prop: "opacity",
							keys: [
								{ at: single("0ms"), value: single("1") },
								{ at: single("400ms"), value: single("0.4") },
							],
						},
					],
				}),
			],
		});
		const { out } = await exported(scene);
		assert.match(out.text, new RegExp(`animation: k-b1-w1-panel 400ms linear 0ms ${expected} both;`));
	}
});

test("a timeline the picture is already in plays from the base rule, not from a selector", async () => {
	const scene = machined({
		machines: [
			timelined({
				length: single("500ms"),
				tracks: [
					{
						part: "panel",
						prop: "opacity",
						keys: [
							{ at: single("0ms"), value: single("1") },
							{ at: single("500ms"), value: single("0.3") },
						],
					},
				],
			}),
		],
		uses: [{ id: "b1", state: "spin" }],
	});
	const { out } = await exported(scene);
	const base = block(out.text, `.${className(out.text, "inst(b1,panel)")}`);
	assert.ok(base, "expected the panel's own rule");
	assert.match(
		base,
		/animation: k-b1-w1-panel 500ms linear 0ms 1 normal both;/,
		"a timeline that is running when the file opens is on the base rule",
	);
});

test("a track on a dimension and a track on a rotation share one transform", async () => {
	const scene = machined({
		machines: [
			timelined({
				length: single("400ms"),
				tracks: [
					{
						part: "panel",
						dim: "x",
						keys: [
							{ at: single("0ms"), value: single("0px") },
							{ at: single("400ms"), value: single("40px") },
						],
					},
					{
						part: "panel",
						turn: "rotateZ",
						keys: [
							{ at: single("0ms"), value: single("0deg") },
							{ at: single("400ms"), value: single("90deg") },
						],
					},
				],
			}),
		],
	});
	const { out } = await exported(scene);
	// One declaration per stop, holding both halves — a `transform` is a single
	// CSS value and two declarations would be one declaration.
	assert.match(out.text, /\n\t100% \{\n\t\ttransform: translate\(40px, 0px\) rotateZ\(90deg\);/);
	assert.doesNotMatch(
		out.text,
		/transform:[^;]*\n\t\ttransform:/,
		"never two transforms in one stop",
	);
});

test("a blend carries one stop and says which", async () => {
	const scene = machined({
		machines: [
			{
				id: "m6",
				name: "Blender",
				root: "btn",
				inputs: [{ id: "mix", name: "Mix", kind: "number", initial: "0" }],
				timelines: [
					{
						id: "low",
						name: "Low",
						tracks: [
							{
								part: "panel",
								prop: "opacity",
								keys: [
									{ at: single("0ms"), value: single("0.2") },
									{ at: single("200ms"), value: single("0.4") },
								],
							},
						],
					},
					{
						id: "high",
						name: "High",
						tracks: [
							{
								part: "panel",
								prop: "opacity",
								keys: [
									{ at: single("0ms"), value: single("0.8") },
									{ at: single("200ms"), value: single("1") },
								],
							},
						],
					},
				],
				states: [
					{ id: "flat", name: "Flat", parts: {} },
					{
						id: "mixed",
						name: "Mixed",
						parts: {},
						blend: {
							kind: "oneD",
							input: "mix",
							stops: [
								{ timeline: "low", at: "0" },
								{ timeline: "high", at: "1000" },
							],
						},
					},
				],
				transitions: [
					edge({ id: "b1t", from: "flat", to: "mixed", trigger: "click" }),
					edge({ id: "b2t", from: "mixed", to: "flat", trigger: "click" }),
				],
			},
		],
	});
	const { out } = await exported(scene);
	// The stop the blend is at when the page opens — the input's own initial —
	// and only that one.
	assert.ok(out.text.includes("@keyframes k-b1-low-panel {"), "the stop it starts at is in");
	assert.ok(!out.text.includes("@keyframes k-b1-high-panel {"), "and the other one is not");
	assert.ok(
		out.lost.some((line) => line.includes("The mix in Mixed of “Blender”")),
		`expected the blend loss, got ${JSON.stringify(out.lost)}`,
	);
});

test("an exit time is in the script and says it is not in the CSS", async () => {
	const scene = machined({
		machines: [
			timelined({
				exit: single("300ms"),
				length: single("200ms"),
				tracks: [
					{
						part: "panel",
						prop: "opacity",
						keys: [
							{ at: single("0ms"), value: single("1") },
							{ at: single("200ms"), value: single("0.5") },
						],
					},
				],
			}),
		],
	});
	const { out } = await exported(scene);
	assert.ok(
		out.lost.some((line) => line.includes("300ms") && line.includes("exit time")),
		`expected the exit-time loss, got ${JSON.stringify(out.lost)}`,
	);
	// And it really is in the file, as a number the runtime gates on.
	const script = out.text.slice(out.text.indexOf("<script>") + 8, out.text.indexOf("</script>"));
	assert.ok(script.includes('"exit":300'), "the gate is in the emitted table");
});

/* ------------------------------------------------------------------ */
/* The third axis: what CSS answers exactly, and what it cannot answer */
/* ------------------------------------------------------------------ */

/**
 * Two claims, and they are opposite claims about the same feature.
 *
 * A flat box with a z and a lean is something CSS draws **exactly** — same
 * origin, same order, same numbers as the canvas and the solver — so the test
 * for it is an equality against the document's own arithmetic rather than a
 * "looks about right". A *scene* is something CSS cannot draw at all, so the
 * test for that one is that the emitter stops, that the rest of the page still
 * comes out, and that the file says where to go instead.
 *
 * Both run through the real solver, because a `frame(N,z,V)` and a `turn(N,R,V)`
 * are things the *program* derives — a node is only in the third axis where the
 * gate opened, which is a property of the document as a whole — and a
 * hand-written model would be a test of what this file believes about that gate.
 */

/** A page with a leaning card outside a 3D view, and a mesh inside one. */
function spatial(): Scene {
	return {
		styles: [],
		machines: [],
		tokens: starterTokens(),
		constraints: [],
		rules: RULES_HEADER,
		nodes: [
			frame(
				"page",
				"Page",
				[0, 0, 600, 400],
				{ fill: single("#ffffff"), perspective: single("900px") },
				[
					{
						...frame("stack", "Stack", [10, 10, 300, 200], {}, [
							{
								...rect("card", "Card", [20, 20, 120, 80], { fill: single("#3b82f6") }),
								spatial: { z: single("24px"), depth: single("0px") },
								turn: { rotateZ: single("15deg"), rotateY: single("30deg") },
							},
						]),
						kind: "group" as const,
					},
					{
						...frame("view", "Hero", [200, 20, 320, 240], { fill: single("#0b1020") }, [
							{
								...makeNode("mesh", at([0, 0, 100, 100]), { id: "cube", name: "Cube" }),
								props: { solid: single("box"), fill: single("#ef4444") },
							},
							{
								...makeNode("light", at([0, 0, 10, 10]), { id: "sun", name: "Sun" }),
								props: { lamp: single("directional") },
							},
						]),
						kind: "viewport" as const,
					},
				],
			),
		],
	};
}

test("a flat box with a z and a lean exports as a real CSS 3D transform", async () => {
	const scene = spatial();
	const { out } = await exported(scene);

	const card = block(out.text, `.${className(out.text, "card")}`);
	assert.ok(card, "expected the card's own rule");
	// `rotateX rotateY rotateZ`, left to right, which is CSS's own spelling of
	// "rotateZ, then rotateY, then rotateX" — the order §2.3 fixes and the order
	// `spatial.ts`'s `rotationMatrix` is `Rx · Ry · Rz` for. A zero term is left
	// out because it is the identity.
	assert.match(
		card,
		/transform: translate3d\(0px, 0px, 24px\) rotateY\(30deg\) rotateZ\(15deg\);/,
	);
	assert.match(card, /transform-origin: center center;/);
	// The box itself is still where it was: a transform is *beside* the four
	// numbers, never instead of them.
	assert.match(card, /left: 20px;/);
	assert.match(card, /top: 20px;/);

	// The two declarations that belong to the ancestors rather than to the card.
	const surface = block(out.text, `.${className(out.text, "page")}`);
	assert.ok(surface);
	assert.match(surface, /perspective: 900px;/, "the nearest surface is where the eye is");
	const between = block(out.text, `.${className(out.text, "stack")}`);
	assert.ok(between);
	assert.match(
		between,
		/transform-style: preserve-3d;/,
		"a flat ancestor would collapse the subtree before the perspective saw it",
	);
	// And the sentence about what a transform costs, which is the browser's
	// behaviour rather than this file's loss.
	assert.ok(out.lost.some((line) => line.includes("laid out by its untransformed rectangle")));
});

test("a rotation in the plane needs no perspective and no preserve-3d", async () => {
	const scene = spatial();
	const card = findInTree(scene.nodes, "card");
	assert.ok(card);
	card.spatial = undefined;
	card.turn = { rotateZ: single("15deg") };
	const { out } = await exported(scene);

	const rule = block(out.text, `.${className(out.text, "card")}`);
	assert.ok(rule);
	assert.match(rule, /transform: rotateZ\(15deg\);/, "still an exact transform");
	assert.doesNotMatch(
		block(out.text, `.${className(out.text, "stack")}`) ?? "",
		/preserve-3d/,
		"a rotation in the plane has worked since before preserve-3d existed",
	);
	assert.doesNotMatch(block(out.text, `.${className(out.text, "page")}`) ?? "", /perspective/);
});

test("a 3D view exports as its own box, and the page exports around it", async () => {
	const scene = spatial();
	const { out } = await exported(scene);

	// The box is there, with its own fill, and it is selectable like anything else.
	const view = className(out.text, "view");
	assert.match(out.text, new RegExp(`<div class="${view}" data-node="view" data-kind="viewport">`));
	assert.match(block(out.text, `.${view}`) ?? "", /background: #0b1020;/);
	// And nothing inside it is markup, because a subtree of empty divs is not a
	// partial answer to a scene.
	assert.doesNotMatch(out.text, /data-node="cube"/);
	assert.doesNotMatch(out.text, /data-node="sun"/);
	// The rest of the page is unaffected — this is the "exports around it" half.
	assert.match(out.text, /data-node="card"/);

	const said = out.lost.find((line) => line.includes("3D view “Hero”"));
	assert.ok(said, `expected a loss naming the view, got ${JSON.stringify(out.lost)}`);
	assert.match(said, /the 2 objects inside this view are not in it/);
	// And the way out is named, and it names *where*. This assertion is worth
	// more than it looks: `ExportTarget` is "html" | "svg" and there is no glTF
	// target in this package, so a sentence reading "export the viewport as glTF"
	// pointed a designer at a menu entry the tool did not have. The writer lives
	// in `canvas-3d` and the export panel offers it as a third format, which is
	// what the sentence now says.
	assert.match(said, /Choose glTF in this panel/);

	// SVG says it once, about the format, and draws the same rectangle.
	const flat = exportUniverse(scene, (await explore(scene, directSolver, { limit: 1 })).universes[0], {
		target: "svg",
		title: "s",
	});
	assert.match(flat.text, /data-node="view"/);
	assert.doesNotMatch(flat.text, /data-node="cube"/);
	assert.ok(flat.lost.some((line) => line.startsWith("Three dimensions.")));
	assert.ok(flat.lost.some((line) => line.startsWith("Inputs, guards and timelines.")));
});

test("a poster puts the frame the canvas drew behind the view's own fill", async () => {
	const scene = spatial();
	const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];
	const url = "data:image/png;base64,iVBORw0KGgo=";
	const out = exportUniverse(scene, universe, {
		target: "html",
		title: "p",
		posters: { view: url },
	});
	const view = block(out.text, `.${className(out.text, "view")}`);
	assert.ok(view);
	// The shorthand first and the image after it, so the fill shows through a
	// scene rendered against nothing.
	assert.ok(view.indexOf("background: #0b1020;") < view.indexOf("background-image:"));
	assert.match(view, /background-image: url\("data:image\/png;base64,iVBORw0KGgo="\);/);
	assert.match(view, /background-size: cover;/);
	assert.ok(
		out.lost.some((line) => line.includes("with the frame the canvas last drew as its background")),
		"the loss says a poster is a photograph rather than a scene",
	);
});

test("a state that turns a card outside a view is an animated transform, with no new emitter", async () => {
	// merged-plan §6.7's claim, held: the machine half diffs declarations and the
	// third-axis half writes one more declaration, so a hover that leans a card
	// composes out of the two with nothing in between.
	const scene = machined({
		machines: [
			hoverMachine({
				btn: {
					turn: { rotateY: single("20deg") },
					frame: { z: single("40px") },
				},
			}),
		],
	});
	// A view somewhere else on the artboard, which is what opens the third axis
	// for the *document* — see `isSpatialScene`. Without one the state's `z` is
	// not in the program at all and only the rotation survives; that asymmetry is
	// the compiler's gate rather than this file's, and it is asserted below.
	const page = findInTree(scene.nodes, "page");
	assert.ok(page);
	page.children = [
		...(page.children ?? []),
		{
			...makeNode("viewport", at([420, 260, 160, 120]), { id: "view", name: "Hero" }),
		},
	];
	const { out } = await exported(scene);
	const host = className(out.text, "b1");
	const part = className(out.text, "inst(b1,btn)");
	const state = block(out.text, `.${host}:hover .${part}`);
	assert.ok(state, "expected a :hover rule");
	assert.match(state, /transform: translate3d\(0px, 0px, 40px\) rotateY\(20deg\);/);
	// And it is paced like any other property, by the same `transition:` line.
	const base = block(out.text, `.${part}`);
	assert.ok(base);
	assert.match(base, /transition: transform 200ms ease-out 0ms;/);
});

test("a state that puts a leaning part back flat says so, rather than leaving it leaning", async () => {
	// `transform` is one value, so a state's rule replaces the base's outright:
	// a state whose pose is the identity has to say `none` or the base's lean
	// survives into a state that was drawn without one.
	const scene = machined({
		machines: [
			{
				id: "m7",
				name: "Flatten",
				root: "btn",
				states: [
					{
						id: "leaning",
						name: "Leaning",
						parts: { btn: { turn: { rotateY: single("25deg") } } },
					},
					{ id: "flat", name: "Flat", parts: {} },
				],
				transitions: [
					edge({ id: "f1", from: "leaning", to: "flat", trigger: "pointerenter" }),
					edge({ id: "f2", from: "flat", to: "leaning", trigger: "pointerleave" }),
				],
			},
		],
	});
	const { out } = await exported(scene);
	const host = className(out.text, "b1");
	const part = className(out.text, "inst(b1,btn)");
	assert.match(block(out.text, `.${part}`) ?? "", /transform: rotateY\(25deg\);/);
	assert.match(block(out.text, `.${host}:hover .${part}`) ?? "", /transform: none;/);
});

test("a state's z opens the third axis for the part it lifts, and reaches the file", async () => {
	// **This pinned an asymmetry and now pins its repair.** `isSpatialScene` —
	// the TypeScript twin of the compiler's `spatial.` gate — used to count a
	// `viewport` node and a `spatial` or `turn` on a *node* and to ignore both on
	// a machine *state's* delta. So a state that leaned a part still leaned it,
	// because `turn/3` is derived outside the gate, while a state that lifted one
	// in z produced no `frame(stt,z,V)` at all: a designer could open the depth
	// rows on a flat part, type a number, and get silence.
	//
	// `thirdAxisParts` is the repair, and it is a repair at the encoding rather
	// than at the reading: a delta that names z, depth or a turn makes the *part*
	// `zstated`, so the part has six numbers in every state, the copy inherits
	// `s3` through `child/2`, and the state that says nothing about z falls to the
	// default of 0 rather than to nothing at all. Both halves are asserted below,
	// because the second is what makes the first a design and not an artefact.
	const scene = machined({
		machines: [
			hoverMachine({
				btn: { turn: { rotateY: single("20deg") }, frame: { z: single("40px") } },
			}),
		],
	});
	const { out, universe } = await exported(scene);
	assert.deepEqual(
		universe.model.states["stt(b1,hover,btn)"]?.spatial,
		{ z: 40 * EMU_PER_PX, depth: 0 },
		"the copy is lifted, and has a depth rather than no third axis at all",
	);
	const state = block(out.text, `.${className(out.text, "b1")}:hover .${className(out.text, "inst(b1,btn)")}`);
	assert.ok(state);
	assert.match(state, /rotateY\(20deg\)/);
	assert.match(state, /translate3d\([^)]*40px\)/);
});

test("a keyframe past the end of its timeline is held at the end, and the file says so", async () => {
	const scene = machined({
		machines: [
			timelined({
				// Stated, and shorter than the last key — which is legal and means what
				// it says: the tail is not played.
				length: single("200ms"),
				tracks: [
					{
						part: "panel",
						prop: "opacity",
						keys: [
							{ at: single("0ms"), value: single("1") },
							{ at: single("200ms"), value: single("0.5") },
							{ at: single("900ms"), value: single("0") },
						],
					},
				],
			}),
		],
	});
	const { out } = await exported(scene);
	// The key past the end lands on the same stop as the one at the end, and the
	// later one wins — which is what the canvas draws too.
	assert.match(out.text, /\n\t100% \{\n\t\topacity: 0;/);
	assert.ok(
		out.lost.some((line) => line.includes("is past the end of it")),
		`expected the past-the-end loss, got ${JSON.stringify(out.lost)}`,
	);
	assert.ok(out.lost.some((line) => line.includes("land on the same whole percentage")));
});
