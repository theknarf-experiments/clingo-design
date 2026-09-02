/**
 * The SVG target.
 *
 * Small, and honestly so: an SVG carries the geometry and the paint, and says
 * once about the format that it carries none of the behaviour. Most of what the
 * old shared file asserted about SVG it asserted about both targets at once, and
 * that half is the conformance suite.
 */
import { svgTarget } from "./index.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "@clingo-design/design-core";
import { makeNode } from "@clingo-design/design-core";
import { explore } from "@clingo-design/design-core";
import {
	type ExportOptions,
	exportSpace,
	exportUniverse,
} from "@clingo-design/export-core";
import {
	type Machine,
	PROPS,
	RULES_HEADER,
	type Scene,
	type SceneNode,
	type StatePart,
	type Transition,
	starterTokens,
} from "@clingo-design/design-core";
import { pair } from "@clingo-design/design-core/templates";
import { at, frame, rect, text } from "@clingo-design/design-core/templates";
import {
	VALUE_TYPES,
	ref,
	single,
} from "@clingo-design/design-core";


/* ------------------------------------------------------------------ */
/* Faces in the file                                                   */
/* ------------------------------------------------------------------ */

/** The stack a designer's uploaded family becomes in a value. */
const INTER = '"Inter Var", system-ui, sans-serif';

/** One declared face, and enough bytes to be inlined. */
const INTER_FILE = {
	src: "/assets/InterVariable.woff2",
	family: "Inter Var",
	weight: "100 900",
	style: "normal",
	bytes: 4,
	name: "InterVariable.woff2",
};

/** Bytes that are not a font and do not have to be: the emitter never looks. */
const FACE = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);

/** A page whose headline is set in an uploaded family. */
function typeset(props: SceneNode["props"] = { fontFamily: single(INTER) }): Scene {
	return {
		styles: [],
		machines: [],
		tokens: starterTokens(),
		fonts: [INTER_FILE],
		nodes: [
			frame("page", "Page", [0, 0, 520, 360], { fill: [ref("surface")] }, [
				text("head", "Head", [24, 24, 400, 40], "Typography", props),
			]),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
}








/* ------------------------------------------------------------------ */
/* Furniture does not come out                                         */
/* ------------------------------------------------------------------ */






/* ------------------------------------------------------------------ */
/* The space as one artefact                                           */
/* ------------------------------------------------------------------ */






/* ------------------------------------------------------------------ */
/* A style is a class                                                  */
/* ------------------------------------------------------------------ */














/* ------------------------------------------------------------------ */
/* EMU stays inside                                                    */
/* ------------------------------------------------------------------ */






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
		out: await exportUniverse(scene, universe, svgTarget, { title: "m", ...options }),
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










/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */







/* ------------------------------------------------------------------ */
/* The paint layer                                                     */
/* ------------------------------------------------------------------ */

/**
 * The direction a gradient runs, as the whole `background-image` it becomes.
 *
 * Read off the menu rather than typed out, because the recipe strings name
 * `--gfrom` and `--gto` with fallbacks and there is exactly one place in this
 * repo those two colours are spelled. A literal here would be a fourth spelling
 * of white, and the failure it caused would look like the picture rather than
 * like a bug.
 */
const LINEAR_DOWN = VALUE_TYPES.gradient.options?.[1].value ?? "none";

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


test("a collapsible space still exports as one design in SVG", async () => {
	const scene = pair();
	const exploration = await explore(scene, directSolver, { limit: 24 });
	const out = await exportSpace(scene, exploration.universes, svgTarget, {});
	assert.match(out.note, /no media queries/);
	assert.equal(out.text.match(/data-node="mHero"/g)?.length, 1);
});

test("the SVG target says it carries no behaviour, and carries the drawn state", async () => {
	const scene = machined({
		machines: [hoverMachine({ btn: { props: { fill: single("#1d4ed8") } } })],
	});
	const exploration = await explore(scene, directSolver, { limit: 4 });
	const out = await exportUniverse(scene, exploration.universes[0], svgTarget, {
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

test("an SVG keeps a mix mode", async () => {
	// Carried rather than dropped, because CSS Compositing applies to SVG and the
	// rasterisers this target is written for implement it. Dropping something
	// that works would be the same lie as approximating something that does not,
	// in the other direction — which is why `svg.loses` has no sentence about it.
	const scene = painted({ fill: single("#abcdef"), mix: single("multiply") });
	const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];
	const out = await exportUniverse(scene, universe, svgTarget, {});
	assert.match(out.text, /mix-blend-mode: multiply/);
	assert.equal(
		out.lost.some((l) => /blend/i.test(l)),
		false,
		"nothing was lost, so nothing is claimed to have been",
	);
});

test("an SVG flattens a gradient rather than losing the shape", async () => {
	// **The guard against a black rectangle.** A rect whose fill has been cleared
	// and whose whole paint is a gradient would, if the gradient were simply
	// dropped, emit no `fill` at all — and an SVG shape with no fill is black.
	// That is not a loss, it is a wrong picture, and it is the class of failure
	// this repo has already paid for once.
	const scene = painted({
		gradient: single(LINEAR_DOWN),
		gradientFrom: single("#7c3aed"),
		gradientTo: single("#0f172a"),
		blur: single("6px"),
		backdropBlur: single("10px"),
	});
	const universe = (await explore(scene, directSolver, { limit: 1 })).universes[0];
	const svg = (await exportUniverse(scene, universe, svgTarget, {})).text;

	assert.match(svg, /fill: #7c3aed/, "flattened to the colour it starts from");
	assert.doesNotMatch(svg, /linear-gradient/);
	assert.doesNotMatch(svg, /filter:/);
	assert.doesNotMatch(svg, /backdrop-filter:/);

	// And a direction set back to None leaves the flat fill alone, which is what
	// the canvas shows: the guard is on the recipe, not on the colours.
	const off = painted({
		fill: single("#abcdef"),
		gradient: single("none"),
		gradientFrom: single("#7c3aed"),
	});
	const flat = (await explore(off, directSolver, { limit: 1 })).universes[0];
	assert.match(
		(await exportUniverse(off, flat, svgTarget, {})).text,
		/fill: #abcdef/,
	);

	// And a gradient whose first colour names a token flattens to the colour
	// rather than to the token, which makes it the one value in this target
	// written as what the answer set drew instead of as what the document said.
	// The difference is not tidiness: naming the token here would claim the file
	// carries a gradient, and what it carries is a flat fill.
	const named = painted({
		gradient: single(LINEAR_DOWN),
		gradientFrom: [ref("accent")],
	});
	const chosen = (await explore(named, directSolver, { limit: 1 })).universes[0];
	const drawn = chosen.model.byId.chip?.rendered.gradientFrom;
	assert.ok(drawn, "expected the answer set to have chosen a colour");
	const svgNamed = (await exportUniverse(named, chosen, svgTarget, {})).text;
	assert.match(svgNamed, new RegExp(`fill: ${drawn}`));
	assert.doesNotMatch(svgNamed, /fill: var\(--accent\)/);
});

test("an SVG names the family and carries no face", async () => {
	const { out } = await exported(typeset(), {
				fonts: { [INTER_FILE.src]: FACE },
	});
	assert.doesNotMatch(out.text, /@font-face/);
	assert.doesNotMatch(out.text, /base64/);
	assert.match(out.text, /Inter Var/, "the family is named; the face is not here");
	assert.ok(
		out.lost.some((line) => line.startsWith("A font you imported is not in this file.")),
		"the format's own sentence, unconditional like its neighbours",
	);
});
