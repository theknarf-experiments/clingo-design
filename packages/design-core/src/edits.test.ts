import assert from "node:assert/strict";
import { test } from "node:test";

import {
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
import { type Scene, emptyScene } from "./scene.ts";
import { lit, propVar, ref, resolveValue, single } from "./values.ts";

function withBoxes(n: number): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	for (let i = 0; i < n; i++) {
		scene = addNode(
			scene,
			makeNode("rect", { x: i * 50, y: 0, width: 40, height: 40 }, {
				id: `b${i}`,
				name: `Box ${i}`,
			}),
		);
	}
	return scene;
}

const ids = (scene: Scene) => scene.nodes.map((n) => n.id);

test("makeNode gives a rect sensible defaults", () => {
	const node = makeNode("rect", { x: 5.4, y: 5.6, width: 100, height: 80 });
	assert.equal(node.kind, "rect");
	assert.deepEqual(node.frame, { x: 5, y: 6, width: 100, height: 80 });
	assert.equal(node.props.fill?.[0]?.kind, "literal");
	assert.ok(node.id.length > 0);
});

test("makeNode gives a text node content", () => {
	const node = makeNode("text", { x: 0, y: 0, width: 100, height: 20 });
	assert.equal(node.kind, "text");
	assert.equal(typeof node.text, "string");
	assert.ok((node.text ?? "").length > 0);
});

test("new node ids are unique", () => {
	const seen = new Set(
		Array.from({ length: 200 }, () => makeNode("rect", { x: 0, y: 0, width: 1, height: 1 }).id),
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
	const moved = moveNodes(withBoxes(3), ["b0", "b2"], 10, -5);
	assert.deepEqual(moved.nodes[0].frame, { x: 10, y: -5, width: 40, height: 40 });
	assert.deepEqual(moved.nodes[1].frame, { x: 50, y: 0, width: 40, height: 40 });
	assert.deepEqual(moved.nodes[2].frame, { x: 110, y: -5, width: 40, height: 40 });
});

test("moveNodes rounds to whole pixels", () => {
	const moved = moveNodes(withBoxes(1), ["b0"], 0.4, 0.6);
	assert.deepEqual(moved.nodes[0].frame, { x: 0, y: 1, width: 40, height: 40 });
});

test("setFrame and setFrames enforce the minimum size", () => {
	const one = setFrame(withBoxes(1), "b0", { x: 0, y: 0, width: 0, height: 0 });
	assert.ok(one.nodes[0].frame.width >= 4);

	const many = setFrames(
		withBoxes(2),
		new Map([["b1", { x: 9, y: 9, width: 11, height: 12 }]]),
	);
	assert.deepEqual(many.nodes[1].frame, { x: 9, y: 9, width: 11, height: 12 });
	assert.deepEqual(many.nodes[0].frame, { x: 0, y: 0, width: 40, height: 40 });
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
	assert.equal(scene.nodes[0].text, "Hello");
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
	const { scene: next, ids: created } = duplicateNodes(scene, ["b0"], 16);

	assert.equal(next.nodes.length, 3);
	assert.equal(created.length, 1);
	// The copy lands directly above its original, the way every editor does.
	assert.deepEqual(ids(next), ["b0", created[0], "b1"]);

	const byId = (s: Scene, id: string) => s.nodes.find((n) => n.id === id);
	assert.deepEqual(byId(next, created[0])?.frame, { x: 16, y: 16, width: 40, height: 40 });
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
	moveNodes(scene, ["b0"], 10, 10);
	deleteNodes(scene, ["b0"]);
	setProp(scene, ["b0"], "fill", single("#fff"));
	reorderNodes(scene, ["b0"], "front");
	duplicateNodes(scene, ["b0"]);
	assert.equal(JSON.stringify(scene), snapshot, "undo relies on immutability");
});
