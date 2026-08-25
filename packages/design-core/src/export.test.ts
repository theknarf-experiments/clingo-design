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
import { explore } from "./explore.ts";
import {
	EXPORT_TARGET_NAMES,
	collapseSpace,
	exportSpace,
	exportUniverse,
} from "./export.ts";
import {
	KINDS,
	RULES_HEADER,
	type Scene,
	makeLayout,
	starterTokens,
} from "./scene.ts";
import { TEMPLATES } from "./templates/index.ts";
import { card } from "./templates/card.ts";
import { pair } from "./templates/pair.ts";
import { places } from "./templates/places.ts";
import { rail } from "./templates/rail.ts";
import { frame, rect, text, withToken } from "./templates/shared.ts";
import { lit, ref, single } from "./values.ts";

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
	assert.match(out.text, new RegExp(`top: ${column.model.byId.b.frame.y}px;`));
	assert.match(media[2], new RegExp(`left: ${row.model.byId.b.frame.x}px;`));
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
