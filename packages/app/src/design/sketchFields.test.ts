/**
 * What the Inspector can say about the sketch layer, for one selected node.
 *
 * Two claims, and both of them are about a thing that was reachable from the
 * barrel and reachable from nowhere else:
 *
 * - **A stored aim is visible and removable.** `setSketchSeed` shipped with a
 *   caller, `clearSketchSeed` shipped with none outside its own unit test, and
 *   `seedOf` had no reader in the app at all. A designer who dragged a sketched
 *   node once had permanently pinned which branch every later solve lands in,
 *   with nothing on screen saying the aim existed and nothing able to forget it.
 *   The round trip is asserted here — written, read out, forgotten — because it
 *   is the round trip that was broken, not any one of its three steps.
 * - **A sketch rule that holds no point says so in the panel.** `inertMembers`
 *   returns `[]` for every edgeless kind, so the shipped `inertRules` was
 *   structurally incapable of reporting a refused sketch rule and the four
 *   sentences in `sketch.ts` had no reader in this component. The turned-box
 *   case is the one asserted, because it is the case with no other carrier.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type Constraint,
	type Scene,
	type SceneNode,
	clearSketchSeed,
	emptyScene,
	makeFrame,
	setSketchSeed,
	single,
} from "@clingo-design/design-core";

import { seedRow, sketchRefusals } from "./sketchFields.ts";

const PX = 9525;

const box = (
	id: string,
	x: number,
	y: number,
	extra: Partial<SceneNode> = {},
): SceneNode => ({
	id,
	kind: "rect",
	name: id,
	frame: makeFrame({ x: x * PX, y: y * PX, width: 40 * PX, height: 40 * PX }),
	props: {},
	children: [],
	...extra,
});

const scene = (nodes: SceneNode[], constraints: Constraint[] = []): Scene => ({
	...emptyScene(),
	nodes,
	constraints,
});

const nodeOf = (s: Scene, id: string): SceneNode => {
	const found = s.nodes.find((n) => n.id === id);
	assert.ok(found, `${id} is in the scene`);
	return found;
};

/* ------------------------------------------------------------------ */
/* The aim                                                             */
/* ------------------------------------------------------------------ */

test("a node with no aim has no seed row", () => {
	const s = scene([box("card", 0, 0)]);
	assert.equal(seedRow(s, nodeOf(s, "card")), undefined);
});

test("a dragged aim is readable, and forgetting it takes it away", () => {
	// The finding, in one gesture. Every step of this already existed and no two
	// of them were joined up: the drag wrote, nothing read, nothing cleared.
	const start = scene([box("card", 0, 0)]);
	const aimed = setSketchSeed(start, "card", { x: 24 * PX, y: 60 * PX });

	const row = seedRow(aimed, nodeOf(aimed, "card"));
	assert.deepEqual(row, { x: "24px", y: "60px" });

	const forgotten = clearSketchSeed(aimed, "card");
	assert.equal(seedRow(forgotten, nodeOf(forgotten, "card")), undefined);
	// And forgotten means absent, not blanked — a document with the aim removed
	// is indistinguishable from one that never met a sketch rule.
	assert.equal(nodeOf(forgotten, "card").sketchSeed, undefined);
});

test("the aim is read out in the document's unit, not in EMU", () => {
	const start = { ...scene([box("card", 0, 0)]), unit: "mm" as const };
	const aimed = setSketchSeed(start, "card", { x: 3600000, y: 0 });
	assert.deepEqual(seedRow(aimed, nodeOf(aimed, "card")), {
		x: "100mm",
		y: "0mm",
	});
});

test("the aim shows with no sketch rule in the document at all", () => {
	// Deliberate, and the reason `seedRow` takes no report. A seed outlives the
	// rule that prompted the drag, goes on picking the branch, and is exactly the
	// state a designer most needs shown when there is no rule left to explain it.
	const start = scene([box("card", 0, 0)]);
	const aimed = setSketchSeed(start, "card", { x: 8 * PX, y: 8 * PX });
	assert.deepEqual(seedRow(aimed, nodeOf(aimed, "card")), {
		x: "8px",
		y: "8px",
	});
});

/* ------------------------------------------------------------------ */
/* The refusals                                                        */
/* ------------------------------------------------------------------ */

const distance = (extra: Partial<Constraint> = {}): Constraint => ({
	id: "c1",
	kind: "distance",
	prop: "fill",
	nodes: ["card", "badge"],
	value: single("100px"),
	enabled: true,
	anchor: "topLeft",
	...extra,
});

test("an ordinary sketch rule between two untouched boxes refuses nobody", () => {
	const s = scene([box("card", 0, 0), box("badge", 80, 0)], [distance()]);
	assert.deepEqual(sketchRefusals(s, nodeOf(s, "card")), []);
});

test("a turned member's corner is refused, and the untouched member hears about it", () => {
	// The case with no other carrier at all. `inertMembers` returns `[]` for a
	// kind with no edge, so before this the rule sat green in both panels while
	// governing nothing — and the node that visibly fails to move is `badge`,
	// which is not the one that was turned.
	const s = scene(
		[
			box("card", 0, 0, { turn: { rotateZ: single("30deg") } }),
			box("badge", 80, 0),
		],
		[distance()],
	);
	const heard = sketchRefusals(s, nodeOf(s, "badge"));
	assert.equal(heard.length, 1);
	assert.equal(heard[0].constraint, "c1");
	assert.equal(heard[0].culprit, "card");
	assert.match(heard[0].why, /corner/i);
});

test("an off rule is not refused, it is off", () => {
	const s = scene(
		[
			box("card", 0, 0, { turn: { rotateZ: single("30deg") } }),
			box("badge", 80, 0),
		],
		[distance({ enabled: false })],
	);
	assert.deepEqual(sketchRefusals(s, nodeOf(s, "badge")), []);
});

test("a rule that does not name this node says nothing to it", () => {
	const s = scene(
		[
			box("card", 0, 0, { turn: { rotateZ: single("30deg") } }),
			box("badge", 80, 0),
			box("other", 200, 0),
		],
		[distance()],
	);
	assert.deepEqual(sketchRefusals(s, nodeOf(s, "other")), []);
});
