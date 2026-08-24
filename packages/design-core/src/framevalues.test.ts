/**
 * A node's four dimensions are values.
 *
 * The last leaf, and the one with the most to go wrong: a document holding two
 * positions has to come back as two *pictures*, a drag has to land on the
 * alternative the visible universe picked without shortening the list, and the
 * number the canvas paints has to be the number hit testing reads — to the
 * pixel, because those two now travel by different routes.
 *
 * Every claim about the space goes through the real solver, since none of them
 * are claims about the document.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, compile, variableCounts } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import {
	addConstraint,
	addNode,
	addNodeTo,
	duplicateNodes,
	makeNode,
	moveNodes,
	setFrameValue,
	setFrames,
	updateConstraint,
} from "./edits.ts";
import { type Universe, explore } from "./explore.ts";
import { readModel } from "./model.ts";
import {
	DIMENSIONS,
	type Dimension,
	type Scene,
	emptyScene,
	frameOf,
	frameFrozen,
	makeLayout,
	sceneContext,
	withFrame,
} from "./scene.ts";
import { findInTree, mapTree, placedNodes } from "./tree.ts";
import { PANEL_PLACES, places } from "./templates/places.ts";
import { TEMPLATES } from "./templates/index.ts";
import { type Token, type Value, frameVar, lit, ref, single } from "./values.ts";

/** A frame holding one rect, whose geometry the caller supplies. */
function board(
	frame: Partial<Record<Dimension, Value>>,
	tokens: Token[] = [],
): Scene {
	let scene: Scene = { ...emptyScene(), tokens, nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 400, height: 300 }, { id: "page" }),
	);
	scene = addNodeTo(
		scene,
		"page",
		makeNode("rect", { x: 20, y: 20, width: 60, height: 40 }, { id: "card" }),
	);
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === "card" ? { ...n, frame: { ...n.frame, ...frame } } : n,
		),
	};
}

const universes = async (scene: Scene): Promise<Universe[]> => {
	const result = await explore(scene, directSolver, { sample: "first", limit: 64 });
	return result.universes;
};

/** Where `card` is drawn, per universe, sorted so the set is comparable. */
const drawnAt = (list: Universe[], dim: Dimension = "x"): number[] =>
	list
		.map((u) => u.model.byId.card?.frame[dim] ?? Number.NaN)
		.sort((a, b) => a - b);

/* ------------------------------------------------------------------ */
/* Two positions are two designs                                       */
/* ------------------------------------------------------------------ */

test("a settled frame is still one design", async () => {
	const list = await universes(board({}));
	assert.equal(list.length, 1);
	assert.deepEqual(list[0].model.byId.card?.frame, {
		x: 20,
		y: 20,
		width: 60,
		height: 40,
	});
});

test("two positions are two universes, and both of them render", async () => {
	// The whole point of the phase: this used to be two documents. Geometry
	// cannot appear in an answer set, so without f_value/3 in the projection the
	// two collapse into one universe drawn in one place.
	const list = await universes(board({ x: [lit("20px"), lit("300px")] }));
	assert.equal(list.length, 2, "here on desktop, there on mobile");
	assert.deepEqual(drawnAt(list), [20, 300]);
	// And nothing else moved: one dimension branching is one decision.
	for (const u of list) assert.equal(u.model.byId.card?.frame.y, 20);
});

test("a size varies the same way a position does", async () => {
	const list = await universes(board({ width: [lit("60px"), lit("200px")] }));
	assert.equal(list.length, 2);
	assert.deepEqual(drawnAt(list, "width"), [60, 200]);
});

test("a dimension that names a token is a position driven by a parameter", async () => {
	const tokens: Token[] = [
		{
			id: "inset",
			name: "inset",
			type: "length",
			value: [lit("12px"), lit("48px")],
		},
	];
	const list = await universes(board({ x: [ref("inset")] }, tokens));
	assert.equal(list.length, 2);
	assert.deepEqual(drawnAt(list), [12, 48]);
});

test("two dimensions branch independently, and the space is the product", async () => {
	const list = await universes(
		board({
			x: [lit("20px"), lit("300px")],
			y: [lit("20px"), lit("200px")],
		}),
	);
	assert.equal(list.length, 4, "2 x 2 — a varying frame is a real multiplier");
});

test("a dimension that reads as no number is nothing, not zero-by-accident", async () => {
	// A dangling reference derives no f_value, so `frame/3` falls to the
	// program's own default of 0 — and the editor's reading has to agree, which
	// is the whole of why frameOf falls back to 0 rather than to a table value.
	const scene = board({ x: [ref("nope")] });
	const list = await universes(scene);
	assert.equal(list.length, 1);
	assert.equal(list[0].model.byId.card?.frame.x, 0);
	const card = findInTree(scene.nodes, "card");
	assert.ok(card);
	assert.equal(frameOf(card, sceneContext(scene)).x, 0);
});

/* ------------------------------------------------------------------ */
/* The canvas and the pointer read the same number                     */
/* ------------------------------------------------------------------ */

test("what the canvas paints is what hit testing reads, to the pixel", async () => {
	// The canvas draws `frame/3`, which arrives through `numeral/2`; the pointer
	// reads the document through `frameOf`. Both round, so the two are equal —
	// and if either side ever stops rounding, this is where it shows up as a
	// sub-pixel disagreement rather than as a mystery half-pixel drag.
	for (const template of TEMPLATES) {
		const scene = template.create();
		const list = await universes(scene);
		for (const universe of list.slice(0, 2)) {
			const context = sceneContext(scene, universe.pick);
			for (const placed of placedNodes(scene.nodes, universe.solved, context)) {
				const read = universe.model.byId[placed.node.id];
				if (!read) continue;
				const stored = frameOf(placed.node, context);
				for (const dim of DIMENSIONS) {
					if (universe.solved[placed.node.id]?.[dim] !== undefined) continue;
					assert.equal(
						stored[dim],
						read.frame[dim],
						`${template.id}/${placed.node.id} ${dim}`,
					);
				}
			}
		}
	}
});

test("a fractional length rounds the same on both sides", async () => {
	const tokens: Token[] = [
		{ id: "half", name: "half", type: "length", value: single("20.5px") },
	];
	const scene = board({ x: [ref("half")] }, tokens);
	const list = await universes(scene);
	const card = findInTree(scene.nodes, "card");
	assert.ok(card);
	assert.equal(frameOf(card, sceneContext(scene)).x, 21);
	assert.equal(list[0].model.byId.card?.frame.x, 21, "the same 21, not 20.5");
});

test("every write lands on a whole pixel", () => {
	const scene = setFrames(
		board({}),
		new Map([["card", { x: 10.4, y: -0.4, width: 33.6, height: 40 }]]),
	);
	const card = findInTree(scene.nodes, "card");
	assert.ok(card);
	assert.deepEqual(frameOf(card), { x: 10, y: 0, width: 34, height: 40 });
	assert.deepEqual(card.frame.x, [lit("10px")]);
});

/* ------------------------------------------------------------------ */
/* What a drag does                                                    */
/* ------------------------------------------------------------------ */

test("a drag moves the alternative the visible universe picked", () => {
	const scene = board({ x: [lit("20px"), lit("300px")] });
	// Universe 1 is the one showing 300; dragging it 10 to the right must move
	// that alternative and leave the other exactly as it was.
	const moved = moveNodes(scene, ["card"], 10, 0, { "fval(card,x)": 1 });
	const card = findInTree(moved.nodes, "card");
	assert.ok(card);
	assert.deepEqual(card.frame.x, [lit("20px"), lit("310px")]);
});

test("a drag never collapses a two-position node to one position", () => {
	const scene = board({ x: [lit("20px"), lit("300px")] });
	const cases: Array<Record<string, number>> = [
		{},
		{ "fval(card,x)": 0 },
		{ "fval(card,x)": 1 },
	];
	for (const picks of cases) {
		const moved = moveNodes(scene, ["card"], 7, 3, picks);
		const card = findInTree(moved.nodes, "card");
		assert.equal(card?.frame.x.length, 2, "both positions survive the drag");
		assert.equal(card?.frame.y.length, 1);
	}
});

test("with no pick at all, a drag moves the first alternative", () => {
	const moved = moveNodes(board({ x: [lit("20px"), lit("300px")] }), ["card"], 5, 0);
	assert.deepEqual(findInTree(moved.nodes, "card")?.frame.x, [
		lit("25px"),
		lit("300px"),
	]);
});

test("a dimension that names a token is the token's to change", () => {
	// Dragging would have to overwrite the link with a number, which silently
	// unwires the parameter. So the axis is frozen and the editor says so.
	const tokens: Token[] = [
		{ id: "inset", name: "inset", type: "length", value: single("12px") },
	];
	const scene = board({ x: [ref("inset")] }, tokens);
	const card = findInTree(scene.nodes, "card");
	assert.ok(card);
	assert.equal(frameFrozen(card, "x", sceneContext(scene)), true);
	assert.equal(frameFrozen(card, "y", sceneContext(scene)), false);

	const moved = moveNodes(scene, ["card"], 40, 40, {});
	const after = findInTree(moved.nodes, "card");
	assert.deepEqual(after?.frame.x, [ref("inset")], "the link is untouched");
	assert.equal(frameOf(after ?? card, sceneContext(moved)).y, 60, "y still moved");
});

test("duplicating carries every alternative, and nudges the visible one", () => {
	const scene = board({ x: [lit("20px"), lit("300px")] });
	const { scene: next, ids } = duplicateNodes(scene, ["card"], 16, {
		"fval(card,x)": 1,
	});
	const clone = findInTree(next.nodes, ids[0]);
	assert.deepEqual(clone?.frame.x, [lit("20px"), lit("316px")]);
});

test("withFrame is a no-op where nothing changed", () => {
	const scene = board({});
	const card = findInTree(scene.nodes, "card");
	assert.ok(card);
	assert.equal(withFrame(card, frameOf(card)), card, "same object, no churn");
});

/* ------------------------------------------------------------------ */
/* The rules still win                                                 */
/* ------------------------------------------------------------------ */

test("a pin holds a position whatever the document says", async () => {
	let scene = board({ x: [lit("20px"), lit("300px")] });
	const added = addConstraint(scene, "pin", ["card"], undefined, "left");
	scene = updateConstraint(added.scene, added.id, { value: single("120px") });
	const list = await universes(scene);
	// Both universes survive — the document really does hold two positions — but
	// the rule is what decides where the box ends up in each of them.
	assert.equal(list.length, 2);
	for (const u of list) {
		assert.equal(u.solved.card?.x, 120, "the pin, not either stored x");
	}
});

test("the layout still owns the frames of the children it places", async () => {
	let scene = board({ x: [lit("20px"), lit("300px")] });
	scene = {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === "page"
				? { ...n, layout: makeLayout({ gap: 10, padding: 10 }) }
				: n,
		),
	};
	const list = await universes(scene);
	// Two universes, because the document holds two x values and they are
	// projected; one arrangement, because the container decides where its child
	// goes and does not consult either of them.
	assert.equal(list.length, 2);
	for (const u of list) assert.equal(u.solved.card?.x, 10, "the padding");
});

test("a varying frame still pulls a solved node toward the universe on screen", async () => {
	// `gsolved` geometry reads `frame/3`, which is derived per universe now — so
	// the pull has to follow the pick rather than one arbitrary alternative.
	let scene = board({ x: [lit("20px"), lit("300px")] });
	const added = addConstraint(scene, "align", ["card", "page"], undefined, "top");
	scene = added.scene;
	const list = await universes(scene);
	assert.equal(list.length, 2);
	assert.deepEqual(
		list.map((u) => u.solved.card?.x).sort((a, b) => (a ?? 0) - (b ?? 0)),
		[20, 300],
		"each universe lands on its own stored x",
	);
});

/* ------------------------------------------------------------------ */
/* The template                                                        */
/* ------------------------------------------------------------------ */

test("the two-places template really is two places", async () => {
	const scene = places();
	const list = await universes(scene);
	assert.equal(list.length, 2, "one drawing, two designs");
	assert.deepEqual(
		list.map((u) => u.model.byId.panel?.frame.x).sort((a, b) => (a ?? 0) - (b ?? 0)),
		[...PANEL_PLACES],
	);
	// Everything else is the same picture in both, which is what makes the
	// difference legible as a decision rather than as noise.
	for (const id of ["header", "body", "note"]) {
		const boxes = new Set(list.map((u) => JSON.stringify(u.model.byId[id]?.frame)));
		assert.equal(boxes.size, 1, `${id} moved`);
	}
});

test("dragging in one design does not disturb the other", async () => {
	const scene = places();
	const list = await universes(scene);
	const right = list.find(
		(u) => u.model.byId.panel?.frame.x === PANEL_PLACES[1],
	);
	assert.ok(right, "expected a design with the panel on the right");
	// Move it 12 further right in the universe that shows it there.
	const moved = moveNodes(scene, ["panel"], 12, 0, right.pick);
	const after = await universes(moved);
	assert.deepEqual(
		after.map((u) => u.model.byId.panel?.frame.x).sort((a, b) => (a ?? 0) - (b ?? 0)),
		[PANEL_PLACES[0], PANEL_PLACES[1] + 12],
		"the design that was not on screen is untouched",
	);
});

/* ------------------------------------------------------------------ */
/* The document side                                                   */
/* ------------------------------------------------------------------ */

test("the default frame is one alternative and costs no variable", () => {
	const scene = board({});
	const keys = Object.keys(variableCounts(scene)).filter((k) =>
		k.startsWith("fval("),
	);
	assert.deepEqual(keys, [], "nobody asked for a choice");
	const { generated } = compile(scene);
	assert.match(generated, /^frame\(card,x,20\)\.$/m, "a plain fact, as before");
	assert.doesNotMatch(generated, /alt\(fval\(card,x\)/);
});

test("a dimension that branches is a variable the studio knows about", () => {
	const scene = board({ x: [lit("20px"), lit("300px")], y: [ref("inset")] });
	const counts = variableCounts(scene);
	assert.equal(counts[frameVar("card", "x")], 2);
	assert.equal(counts[frameVar("card", "y")], 1, "a link is not a fact");
	assert.equal(counts[frameVar("card", "width")], undefined);
	const { generated, variables } = compile(scene);
	assert.equal(variables[frameVar("card", "x")], 2);
	assert.doesNotMatch(
		generated,
		/^frame\(card,x,\d+\)\.$/m,
		"derived from the pick, never stated",
	);
	assert.match(generated, /^frame\(card,width,60\)\.$/m, "and the rest still are");
});

test("setFrameValue is the one edit that changes how many positions there are", () => {
	let scene = board({});
	scene = setFrameValue(scene, ["card"], "x", [lit("20px"), lit("300px")]);
	assert.equal(findInTree(scene.nodes, "card")?.frame.x.length, 2);
	// And back again: collapsing is the same edit in reverse.
	scene = setFrameValue(scene, ["card"], "x", [lit("300px")]);
	assert.deepEqual(findInTree(scene.nodes, "card")?.frame.x, [lit("300px")]);
	// An empty list is not a position; it is refused rather than stored.
	scene = setFrameValue(scene, ["card"], "x", []);
	assert.deepEqual(findInTree(scene.nodes, "card")?.frame.x, [lit("300px")]);
});

test("frameOf reads the universe it is given", () => {
	const scene = board({ x: [lit("20px"), lit("300px")] });
	const card = findInTree(scene.nodes, "card");
	assert.ok(card);
	assert.equal(frameOf(card).x, 20, "the first, with no pick");
	assert.equal(
		frameOf(card, { tokens: [], picks: { [frameVar("card", "x")]: 1 } }).x,
		300,
	);
});

test("placedNodes places a nested node in the universe it is asked about", () => {
	const scene = board({ x: [lit("20px"), lit("300px")] });
	const at = (index: number) =>
		placedNodes(scene.nodes, {}, {
			tokens: [],
			picks: { [frameVar("card", "x")]: index },
		}).find((p) => p.node.id === "card")?.world.x;
	assert.equal(at(0), 20);
	assert.equal(at(1), 300);
});

test("the geometry rules read a derived frame like any other", async () => {
	// Held directly against the solver rather than through `explore`, so the
	// claim is about the atoms: `frame/3` is one predicate whichever route it
	// arrived by, and `#show frame/3` reports both.
	const scene = board({ x: [lit("20px"), lit("300px")] });
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: 0,
			assumptions: [...guards, PULL_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(out.result, "SATISFIABLE");
		assert.equal(out.models.length, 2);
		const xs = out.models
			.map((m) => readModel(m).byId.card?.frame.x)
			.sort((a, b) => (a ?? 0) - (b ?? 0));
		assert.deepEqual(xs, [20, 300]);
	} finally {
		await session.close();
	}
});
