import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DUPLICATE_OFFSET,
	addNode,
	deleteNodes,
	duplicateNodes,
	makeNode,
	moveNodes,
	renameNode,
	reorderNodes,
	setFrame,
	setFrames,
	setProp,
	setText,
} from "./edits.ts";
import { type Frame, MIN_NODE_SIZE } from "./geometry.ts";
import { type Scene, emptyScene, frameOf } from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, propVar, ref, resolveValue, single } from "./values.ts";

/**
 * Cases are stated in pixels and frames are read in EMU, so the two helpers
 * below do the multiplying. Nothing an edit does cares which unit it is in —
 * the arithmetic would be the same in furlongs — but a document's minimum size
 * and a gesture's quantum are both pixel counts, so the cases that are *about*
 * those two have to be written in a unit that can express them.
 */
const P = EMU_PER_PX;

const box = (x: number, y: number, width: number, height: number): Frame => ({
	x: x * P,
	y: y * P,
	width: width * P,
	height: height * P,
});

function withBoxes(n: number): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	for (let i = 0; i < n; i++) {
		scene = addNode(
			scene,
			makeNode("rect", box(i * 50, 0, 40, 40), {
				id: `b${i}`,
				name: `Box ${i}`,
			}),
		);
	}
	return scene;
}

const ids = (scene: Scene) => scene.nodes.map((n) => n.id);

test("makeNode gives a rect sensible defaults", () => {
	const node = makeNode("rect", box(5.4, 5.6, 100, 80));
	assert.equal(node.kind, "rect");
	// The fractional pixels are gone: a frame arrives from a gesture, and a
	// gesture means a whole pixel however finely the pointer reports it.
	assert.deepEqual(frameOf(node), box(5, 6, 100, 80));
	assert.equal(node.props.fill?.[0]?.kind, "literal");
	assert.ok(node.id.length > 0);
});

test("makeNode gives a text node content", () => {
	const node = makeNode("text", box(0, 0, 100, 20));
	assert.equal(node.kind, "text");
	// Content is a property now, so a new text node arrives with one alternative.
	assert.equal(node.props.text?.length, 1);
	assert.equal(node.props.text?.[0].kind, "literal");
});

test("new node ids are unique", () => {
	const seen = new Set(
		Array.from({ length: 200 }, () => makeNode("rect", box(0, 0, 1, 1)).id),
	);
	assert.equal(seen.size, 200);
});

test("add and delete", () => {
	const scene = withBoxes(3);
	assert.deepEqual(ids(scene), ["b0", "b1", "b2"]);
	assert.deepEqual(ids(deleteNodes(scene, ["b1"])), ["b0", "b2"]);
	assert.deepEqual(ids(deleteNodes(scene, ["b0", "b2"])), ["b1"]);
	assert.deepEqual(ids(deleteNodes(scene, ["nope"])), ["b0", "b1", "b2"]);
});

test("moveNodes translates only the named nodes", () => {
	const moved = moveNodes(withBoxes(3), ["b0", "b2"], 10 * P, -5 * P);
	assert.deepEqual(frameOf(moved.nodes[0]), box(10, -5, 40, 40));
	assert.deepEqual(frameOf(moved.nodes[1]), box(50, 0, 40, 40));
	assert.deepEqual(frameOf(moved.nodes[2]), box(110, -5, 40, 40));
});

test("moveNodes rounds to whole pixels", () => {
	// Still whole pixels, and now for the only reason left: a hand means a
	// pixel, and a shared document should not fill up with sub-pixel diffs. The
	// compiler no longer needs it — see `normaliseFrame`.
	const moved = moveNodes(withBoxes(1), ["b0"], 0.4 * P, 0.6 * P);
	assert.deepEqual(frameOf(moved.nodes[0]), box(0, 1, 40, 40));
});

test("setFrame and setFrames enforce the minimum size", () => {
	const one = setFrame(withBoxes(1), "b0", box(0, 0, 0, 0));
	assert.ok(frameOf(one.nodes[0]).width >= MIN_NODE_SIZE);

	const many = setFrames(withBoxes(2), new Map([["b1", box(9, 9, 11, 12)]]));
	assert.deepEqual(frameOf(many.nodes[1]), box(9, 9, 11, 12));
	assert.deepEqual(frameOf(many.nodes[0]), box(0, 0, 40, 40));
});

test("setProp replaces the whole list of alternatives", () => {
	let scene = withBoxes(1);
	scene = setProp(scene, ["b0"], "fill", [ref("accent")]);
	assert.deepEqual(scene.nodes[0].props.fill, [{ kind: "token", token: "accent" }]);

	scene = setProp(scene, ["b0"], "fill", [lit("#ff0000"), lit("#00ff00")]);
	assert.equal(scene.nodes[0].props.fill?.length, 2);

	scene = setProp(scene, ["b0"], "fill", undefined);
	assert.equal(scene.nodes[0].props.fill, undefined);
});

test("a linked property follows its token, a literal does not", () => {
	let scene = withBoxes(1);
	scene = setProp(scene, ["b0"], "fill", [ref("accent")]);
	const key = propVar("b0", "fill");
	const ctx = (picks: Record<string, number>) => ({ tokens: scene.tokens, picks });

	// The starter accent has one value, so it resolves the same either way.
	assert.equal(resolveValue(ctx({}), scene.nodes[0].props.fill, key), "#3b82f6");

	const withLiteral = setProp(scene, ["b0"], "fill", single("#123456"));
	assert.equal(
		resolveValue(
			{ tokens: withLiteral.tokens, picks: {} },
			withLiteral.nodes[0].props.fill,
			key,
		),
		"#123456",
	);
});

test("setText and renameNode", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("text", { x: 0, y: 0, width: 80, height: 20 }, { id: "t" }),
	);
	scene = setText(scene, "t", "Hello");
	assert.deepEqual(scene.nodes[0].props.text, [{ kind: "literal", value: "Hello" }]);
	scene = renameNode(scene, "t", "  Heading  ");
	assert.equal(scene.nodes[0].name, "Heading");
	// A blank name is rejected rather than leaving an unlabelled layer.
	scene = renameNode(scene, "t", "   ");
	assert.equal(scene.nodes[0].name, "Heading");
});

test("reorder to front and back", () => {
	const scene = withBoxes(4);
	assert.deepEqual(ids(reorderNodes(scene, ["b0"], "front")), ["b1", "b2", "b3", "b0"]);
	assert.deepEqual(ids(reorderNodes(scene, ["b3"], "back")), ["b3", "b0", "b1", "b2"]);
	// A multi-selection keeps its relative order.
	assert.deepEqual(
		ids(reorderNodes(scene, ["b0", "b1"], "front")),
		["b2", "b3", "b0", "b1"],
	);
});

test("reorder one step at a time", () => {
	const scene = withBoxes(4);
	assert.deepEqual(ids(reorderNodes(scene, ["b1"], "forward")), ["b0", "b2", "b1", "b3"]);
	assert.deepEqual(ids(reorderNodes(scene, ["b1"], "backward")), ["b1", "b0", "b2", "b3"]);
	// Already at the edge: nothing moves, and nothing is lost.
	assert.deepEqual(ids(reorderNodes(scene, ["b3"], "forward")), ["b0", "b1", "b2", "b3"]);
	assert.deepEqual(ids(reorderNodes(scene, ["b0"], "backward")), ["b0", "b1", "b2", "b3"]);
});

test("duplicate offsets the copies and reports their ids", () => {
	const scene = withBoxes(2);
	const { scene: next, ids: created } = duplicateNodes(
		scene,
		["b0"],
		DUPLICATE_OFFSET,
	);

	assert.equal(next.nodes.length, 3);
	assert.equal(created.length, 1);
	// The copy lands directly above its original, the way every editor does.
	assert.deepEqual(ids(next), ["b0", created[0], "b1"]);

	const byId = (s: Scene, id: string) => s.nodes.find((n) => n.id === id);
	const copy = byId(next, created[0]);
	assert.ok(copy);
	assert.deepEqual(frameOf(copy), box(16, 16, 40, 40));
	assert.notEqual(created[0], "b0");

	// The copy is independent of the original.
	const edited = setProp(next, [created[0]], "fill", single("#000000"));
	assert.notDeepEqual(
		byId(edited, "b0")?.props.fill,
		byId(edited, created[0])?.props.fill,
	);
});

test("edits never mutate the input scene", () => {
	const scene = withBoxes(2);
	const snapshot = JSON.stringify(scene);
	moveNodes(scene, ["b0"], 10 * P, 10 * P);
	deleteNodes(scene, ["b0"]);
	setProp(scene, ["b0"], "fill", single("#fff"));
	reorderNodes(scene, ["b0"], "front");
	duplicateNodes(scene, ["b0"]);
	assert.equal(JSON.stringify(scene), snapshot, "undo relies on immutability");
});
