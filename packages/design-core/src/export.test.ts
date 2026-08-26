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
	collapseSpace,
	exportSpace,
	exportUniverse,
} from "./export.ts";
import { DOCUMENT_BASE, PAINT, cssName, paintOf } from "./paint.ts";
import {
	KINDS,
	PROPS,
	PROP_NAMES,
	type PropName,
	RULES_HEADER,
	type Scene,
	type SceneNode,
	type Style,
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
import { frame, rect, text, wearing, withToken } from "./templates/shared.ts";
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
			assert.deepEqual(
				drawn.slice().sort(),
				Object.keys(universe.model.byId).sort(),
				`${target}: the export and the model draw different nodes`,
			);
			// Paint order: a parent before its children, siblings back to front.
			// The model's own pre-order is the order the canvas emits.
			const order: string[] = [];
			const walk = (nodes: typeof universe.model.roots) => {
				for (const node of nodes) {
					order.push(node.id);
					walk(node.children);
				}
			};
			walk(universe.model.roots);
			assert.deepEqual(drawn, order, `${target}: painted out of order`);
			assert.ok(out.lost.length > 0, "an export that loses nothing is a lie");
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
		tokens: starterTokens(),
		nodes: [
			frame("page", "Page", [0, 0, 400, 200], { fill: [ref("surface")] }, worn),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
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
