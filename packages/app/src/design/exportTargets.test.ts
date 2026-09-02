/**
 * The conformance suite: what must be true of *every* target.
 *
 * Here rather than in any target's package, and the refactor is what surfaced
 * it. These tests iterate the targets — "no template loses its grid quietly", "a
 * surface clips, in both" — so they belong to the *set* rather than to any
 * member of it, and the set is composed at the composition root. This is that
 * root; `ExportPanel` builds the same list.
 *
 * A target added to `TARGETS` is a target these run against, which is the
 * property worth having: plugins only ever tested one at a time are plugins with
 * no shared meaning.
 */
import { htmlTarget } from "@clingo-design/export-html";
import { svgTarget } from "@clingo-design/export-svg";

/**
 * The targets this studio composes, which is the list `ExportPanel` builds.
 *
 * Two entries, and glTF deliberately not among them: it needs three.js, and a
 * headless suite that pulled a renderer in to assert a sentence about grids
 * would be paying exactly the cost this architecture exists to avoid.
 */
const TARGETS = [htmlTarget, svgTarget];

import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "@clingo-design/design-core";
import { makeNode } from "@clingo-design/design-core";
import { explore } from "@clingo-design/design-core";
import {
	type ExportOptions,
	exportUniverse,
} from "@clingo-design/export-core";
import type { ModelScene } from "@clingo-design/design-core";
import {
	KINDS,
	type Machine,
	PROPS,
	type PropName,
	RULES_HEADER,
	type Scene,
	type SceneNode,
	type StatePart,
	type Transition,
	makeGuides,
	starterTokens,
	trackDatum,
} from "@clingo-design/design-core";
import { TEMPLATES, findTemplate } from "@clingo-design/design-core";
import { card } from "@clingo-design/design-core/templates";
import { typography } from "@clingo-design/design-core/templates";
import { at, frame, rect, text } from "@clingo-design/design-core/templates";
import { findInTree } from "@clingo-design/design-core";
import {
	EMU_PER_PX,
	type Unit,
	emuOf,
	formatLength,
} from "@clingo-design/design-core";
import {
	type Value,
	isLengthType,
	lit,
	ref,
	single,
} from "@clingo-design/design-core";


/* ------------------------------------------------------------------ */
/* Faces in the file                                                   */
/* ------------------------------------------------------------------ */






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




/* ------------------------------------------------------------------ */
/* The space as one artefact                                           */
/* ------------------------------------------------------------------ */






/* ------------------------------------------------------------------ */
/* A style is a class                                                  */
/* ------------------------------------------------------------------ */


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
		out: await exportUniverse(scene, universe, htmlTarget, { title: "m", ...options }),
	};
}

















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









/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

/** A one-pixel PNG, as the bytes a file would actually hold. */
const PNG = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
	0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
	0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
]);

const SRC = "/assets/hero.png";

/** One artboard with one picture on it, sized as the decoder reported it. */
function withPicture(fit?: Value): Scene {
	const picture: SceneNode = {
		...makeNode("image", { x: 0, y: 0, width: 800 * EMU_PER_PX, height: 600 * EMU_PER_PX }, {
			id: "hero",
			name: "Hero",
		}),
		image: { src: SRC, mimeType: "image/png", width: 800, height: 600 },
		...(fit ? { props: { fit } } : {}),
	};
	return {
		...card(),
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: 800 * EMU_PER_PX, height: 600 * EMU_PER_PX }, {
					id: "page",
					name: "Page",
				}),
				children: [picture],
			},
		],
	};
}




/* ------------------------------------------------------------------ */
/* The paint layer                                                     */
/* ------------------------------------------------------------------ */


/** One rectangle, painted however the caller asks, on a page of its own. */
function painted(props: SceneNode["props"]): Scene {
	return {
		styles: [],
		machines: [],
		tokens: starterTokens(),
		constraints: [],
		rules: RULES_HEADER,
		nodes: [
			frame("page", "Page", [0, 0, 300, 200], { fill: [ref("surface")] }, [
				rect("chip", "Chip", [20, 20, 160, 80], props),
			]),
		],
	};
}












/* ------------------------------------------------------------------ */
/* The face travels in the file                                        */
/* ------------------------------------------------------------------ */









/**
 * The paint properties and a spring, in one state, on one node.
 *
 * The seam test between two features written a week apart. The gradient, the two
 * blurs and the blend mode arrived as ordinary members of {@link PROPS}, and
 * {@link StatePart.props} spans all of `PROPS` — so a hover that repaints a
 * gradient is a sentence the document could always write, and nothing in the
 * exporter was ever asked whether it could write it back out. Every machine
 * fixture above moves exactly one property, which is the one width at which the
 * `transition` shorthand's two spellings are the same characters.
 *
 * Six keys is also the point rather than a flourish: the defect this test was
 * written to hold down was invisible at one and unmistakable at six.
 */


for (const template of TEMPLATES) {
	test(`${template.id}: the export holds every node the answer set drew`, async () => {
		const scene = template.create();
		const exploration = await explore(scene, directSolver, { limit: 4 });
		const universe = exploration.universes[0];
		assert.ok(universe, "expected at least one universe");

		for (const target of TARGETS) {
			const out = await exportUniverse(scene, universe, target, { title: template.id });
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
		for (const target of TARGETS) {
			const named = await exportUniverse(scene, universe, target, { title: template.id });
			const plain = await exportUniverse(scene, universe, target, {
				title: template.id,
				tokens: false,
			});
			assert.equal(
				inline(named.text),
				plain.text,
				`${target.id}: a token stands for something other than what was drawn`,
			);
		}
	});
}

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

	const html = (await exportUniverse(scene, universe, htmlTarget, {})).text;
	// A diagonal leans the way the document says, and the answer set does not
	// carry the lean — so this is the one thing read from the document.
	assert.match(html, /data-node="l"[^>]*><svg class="s"[^>]*><line x1="0" y1="60"/);
	assert.match(html, /data-node="ar"[^>]*><svg class="s"[^>]*><line x1="0" y1="0"/);
	assert.match(html, /<polyline points="/, "an arrow has a head");
	assert.match(html, /<path d="M/, "a path has its vertices");
	assert.match(html, /border-radius: 50%/, "an ellipse is a fully rounded box");
	assert.match(html, /Two\nlines/);

	const svg = (await exportUniverse(scene, universe, svgTarget, {})).text;
	assert.match(svg, /<ellipse cx="30" cy="30" rx="30" ry="30"/);
	assert.match(svg, /<line x1="0" y1="60" x2="100" y2="0"/);
	assert.match(svg, /<polyline points="/);
	assert.match(svg, /<path d="M/);
	// Two lines of text are two tspans, because SVG does not wrap.
	assert.equal(svg.match(/<tspan /g)?.length, 2);
});

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

	for (const target of TARGETS) {
		const out = await exportUniverse(held, a, target, { title: "page" });
		assert.equal(
			out.text,
			(await exportUniverse(settled, b, target, { title: "page" })).text,
			`${target.id}: the grid left a mark on the file`,
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
	for (const target of TARGETS) {
		const note = grid(await exportUniverse(held, a, target, {}));
		assert.equal(note.length, 1, `${target}: expected the grid to be named once`);
		// It has to say the second half too: the grid is gone, what it *decided* is
		// not, and a designer who read only the first clause would go looking for a
		// coordinate that is right there.
		assert.match(note[0], /coordinates/);
	}

	const settled = ruledPage(false);
	assert.deepEqual(
		grid(await exportUniverse(settled, await onlyUniverse(settled), htmlTarget, {})),
		[],
	);
});

test("a style comes out as a class, and only overrides stay on the node", async () => {
	const scene = typography();
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const out = await exportUniverse(scene, exploration.universes[0], htmlTarget, {
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
	const svg = await exportUniverse(scene, exploration.universes[0], svgTarget, {});
	assert.doesNotMatch(svg.text, /class="prose"/);
	assert.equal(svg.text.match(/font-size: 15px/g)?.length, 4);
	assert.ok(
		svg.lost.some((line) => /A style is not a class here/.test(line)),
		"SVG has to say that it inlined the treatment",
	);
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
	// `clip` and not `hidden`, and the word is the assertion rather than an
	// incidental spelling: the two paint the same picture and only one of them
	// makes the frame a scroll container. See `paint.ts`'s `CLIP` — with `hidden`,
	// a scroll-clocked timeline anywhere under this frame resolves its `view()`
	// against the frame instead of the page and never advances at all.
	assert.match(
		(await exportUniverse(scene, universe, htmlTarget, {})).text,
		/overflow: clip;/,
	);
	assert.match(
		(await exportUniverse(scene, universe, svgTarget, {})).text,
		/<clipPath id="clip0">/,
	);
});

test("a document in whole pixels comes out in whole pixels", async () => {
	// The promise EMU is allowed to make: geometry is 1/914400 of an inch on the
	// inside and the file is unchanged on the outside. Every number below is the
	// one the document states, and none of them acquired a fraction on the way
	// through the solver, the answer set and two emitters.
	const scene = inPixels();
	const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];

	const html = (await exportUniverse(scene, universe, htmlTarget, {})).text;
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

	const svg = (await exportUniverse(scene, universe, svgTarget, {})).text;
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

	for (const target of TARGETS) {
		const [a, b] = await Promise.all(
			[pixels, points].map(async (scene) => {
				const universe = (await explore(scene, directSolver, { limit: 1 }))
					.universes[0];
				return (await exportUniverse(scene, universe, target, { title: "units" })).text;
			}),
		);
		assert.equal(a, b, `${target}: the unit a designer typed reached the file`);
	}
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
	for (const target of TARGETS) {
		const [a, b] = await Promise.all(
			[bare, inert].map(async (scene) => {
				const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];
				return (await exportUniverse(scene, universe, target, { title: "m" })).text;
			}),
		);
		assert.equal(a, b, `${target}: a machine that says nothing changed the file`);
	}
	const { out } = await exported(bare);
	assert.doesNotMatch(out.text, /<script/);
	assert.doesNotMatch(out.text, /transition:/);
	assert.doesNotMatch(out.text, /data-state/);
});

test("a picture comes out inlined, in both targets", async () => {
	const scene = withPicture();
	const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];

	const html = await exportUniverse(scene, universe, htmlTarget, {
				images: { [SRC]: PNG },
	});
	// An `<img>`, not a background: an image is content, it takes the box's own
	// border-radius, and a page it is pasted into keeps an element to select.
	assert.match(html.text, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="" draggable="false"\/>/);
	// The media type is read off the path's extension, and the bytes round-trip.
	const encoded = html.text.match(/base64,([A-Za-z0-9+/=]+)"/)?.[1];
	assert.ok(encoded);
	assert.deepEqual(
		Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
		PNG,
	);

	const svg = await exportUniverse(scene, universe, svgTarget, {
				images: { [SRC]: PNG },
	});
	assert.match(svg.text, /<image [^>]*href="data:image\/png;base64,/);
	// Neither target reports a loss when the bytes were there.
	assert.equal(
		[...html.lost, ...svg.lost].some((l) => l.includes(SRC)),
		false,
	);
});

test("fit maps onto the two targets' own words for it", async () => {
	const universe = async (fit: Value) => {
		const scene = withPicture(fit);
		const u = (await explore(scene, directSolver, { limit: 1 })).universes[0];
		return {
			html: (await exportUniverse(scene, u, htmlTarget, { images: { [SRC]: PNG } })).text,
			svg: (await exportUniverse(scene, u, svgTarget, { images: { [SRC]: PNG } })).text,
		};
	};
	// The mapping is exact rather than nearly: slice crops to fill, meet
	// letterboxes, none stretches — so the two files show the same picture.
	const cover = await universe(single("cover"));
	assert.match(cover.html, /object-fit: cover/);
	assert.match(cover.svg, /preserveAspectRatio="xMidYMid slice"/);

	const contain = await universe(single("contain"));
	assert.match(contain.html, /object-fit: contain/);
	assert.match(contain.svg, /preserveAspectRatio="xMidYMid meet"/);

	// `stretch` is the designer's word; CSS calls it `fill` and SVG calls it
	// `none`, and neither of those is a word anybody would pick from a menu.
	const stretch = await universe(single("stretch"));
	assert.match(stretch.html, /object-fit: fill/);
	assert.match(stretch.svg, /preserveAspectRatio="none"/);
});

test("the document isolates itself", async () => {
	// A mix mode blends against everything painted below it in the nearest
	// isolation group, and without one that group is whatever page the file was
	// pasted into. Both targets carry it and both carry it unconditionally: a
	// document with no mix mode in it composites identically either way, and a
	// declaration that appeared only sometimes would be a file whose shape
	// depended on a property nobody can see in it.
	const scene = painted({ fill: single("#abcdef"), mix: single("multiply") });
	const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];

	const html = (await exportUniverse(scene, universe, htmlTarget, {})).text;
	assert.match(block(html, ".design") ?? "", /isolation: isolate;/);

	const svg = (await exportUniverse(scene, universe, svgTarget, {})).text;
	assert.match(svg, /<svg [^>]*style="isolation: isolate"/);
});

test("the SVG target says what it dropped", () => {
	const svg = svgTarget.spec.loses;
	assert.equal(svg.filter((l) => /[Gg]radients are flattened/.test(l)).length, 1);
	assert.equal(svg.filter((l) => /[Bb]lur is dropped/.test(l)).length, 1);
	// And the HTML target gained nothing, because it carries all four features
	// exactly. A loss list that pads itself is one nobody finishes reading.
	assert.equal(
		htmlTarget.spec.loses.some((l) => /gradient|blur|blend/i.test(l)),
		false,
	);
});

test("a 3D view exports as its own box, and the page exports around it", async () => {
	const scene = spatial();
	const { out } = await exported(scene);

	// The box is there, with its own fill, and it is selectable like anything else.
	const view = className(out.text, "view");
	assert.match(out.text, new RegExp(`<div class="${view}" data-node="view" data-kind="viewport">`));
	assert.match(block(out.text, `.${view}`) ?? "", /background-color: #0b1020;/);
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
	const flat = await exportUniverse(scene, (await explore(scene, directSolver, { limit: 1 })).universes[0], svgTarget, {
				title: "s",
	});
	assert.match(flat.text, /data-node="view"/);
	assert.doesNotMatch(flat.text, /data-node="cube"/);
	assert.ok(flat.lost.some((line) => line.startsWith("Three dimensions.")));
	assert.ok(flat.lost.some((line) => line.startsWith("Inputs, guards and timelines.")));
});


/* ------------------------------------------------------------------ */
/* Whole templates, through whichever target they are about            */
/* ------------------------------------------------------------------ */

/*
 * These came out of `design-core/src/templates.test.ts` with the split. They
 * assert that a shipped template leaves as a *file* — the button as a stylesheet
 * with its states in it, the deck's script carrying its guards, the page
 * exporting around a 3D view — so they are about a target rather than about the
 * document, and `design-core` no longer has a target to be about.
 */
test("the button leaves as a stylesheet with the states in it", async () => {
	const scene = findTemplate("machine")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const html = await exportUniverse(scene, out.universes[0], htmlTarget, {
				title: "machine",
	});

	// `pressed` is entered and left by a pointer down and up *from hover* rather
	// than from the initial state, so it is not a pseudo-class state and the file
	// carries the table-driven runtime instead. The rest/hover pair on its own
	// would have collapsed to `:hover` and emitted no script at all.
	assert.match(html.text, /\[data-state="pressed"\]/);
	assert.match(html.text, /<script>/);
	// Paced from the answer set rather than from a number in the emitter.
	assert.match(html.text, /transition:[^;]*160ms/);

	// And what it cannot carry, it says: the second use is drawn in a state other
	// than the machine's initial one, so the file starts there and every state is
	// a data-state rule.
	assert.ok(
		html.lost.some((entry) => entry.includes("Hovering")),
		"the export names the state it starts in",
	);

	// SVG has no states at all, and says so rather than shipping a still frame
	// that looks like the whole design.
	const svg = await exportUniverse(scene, out.universes[0], svgTarget, {
				title: "machine",
	});
	assert.ok(svg.lost.some((entry) => entry.startsWith("Behaviour.")));
});

test("the deck leaves as a file whose script holds the guards and the debounce", async () => {
	const scene = findTemplate("deck")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const html = await exportUniverse(scene, out.universes[0], htmlTarget, { title: "deck" });

	// The second layer writes its own attribute, which is the twin of
	// `attributeOf` in the runtime: plain `data-state` for the first layer and
	// `data-state-<layer>` after it, so the CSS cascade settles a fight the way
	// `mwriter/4` does.
	assert.match(html.text, /data-state-meter/);
	// The guards ride the table rather than the stylesheet, because a guard is a
	// comparison a script makes and CSS has no word for one.
	assert.match(html.text, /"input":"armed"/);
	assert.match(html.text, /"op":"gt","value":500/, "a number guard is thousandths");
	assert.match(html.text, /"op":"fired"/);
	// And the debounce is in the file, at the number the token resolved to. This
	// is the regression guard for a real defect: built without the universe's
	// context, the table dropped a token-paced exit time as a zero while this
	// same file's losses announced the wait.
	assert.match(html.text, /"exit":180/);
});

test("the page exports around the view, and the view says what it could not carry", async () => {
	const scene = findTemplate("solids")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });

	for (const target of TARGETS) {
		const file = await exportUniverse(scene, out.universes[0], target, { title: "solids" });
		// The rest of the page is there, and so is the view's own box — it is a
		// rectangle with a fill and a radius, and everything above the seam was
		// always able to draw one.
		assert.match(file.text, /data-node="swatch"/);
		assert.match(file.text, /data-node="stage"/);
		// What is inside it is not, in either target, because neither has a word
		// for geometry, a camera, a light or a material.
		for (const id of ["cube", "ball", "post", "floor", "ring", "eye"]) {
			assert.doesNotMatch(file.text, new RegExp(`data-node="${id}"`), `${id} in ${target}`);
		}
		// And it is a stated loss rather than a subtree that went quiet.
		assert.ok(
			file.lost.some((entry) => entry.includes("view")),
			`${target} drops a subtree with nothing said`,
		);
	}

	// The two targets say it differently, and the difference is honest rather
	// than an oversight. HTML *can* place and turn a flat box and does, so its
	// loss is specifically the geometry: eight objects, counted off the model
	// rather than off the document, with glTF named as the way out. SVG is flat
	// full stop — it has no transform story to half-tell — so it says so once,
	// unconditionally, alongside its other blanket sentences.
	const html = await exportUniverse(scene, out.universes[0], htmlTarget, { title: "solids" });
	assert.ok(
		html.lost.some((entry) => entry.includes("8 objects inside this view")),
		"HTML does not count what it dropped",
	);
	assert.ok(html.lost.some((entry) => entry.includes("glTF")), "the way out is named");

	const svg = await exportUniverse(scene, out.universes[0], svgTarget, { title: "solids" });
	assert.ok(
		svg.lost.some((entry) => entry.startsWith("Three dimensions.")),
		"SVG does not say it is flat",
	);
});
