import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { addNode, makeNode } from "./edits.ts";
import { normalizeScene } from "./project.ts";
import {
	DRAW_KINDS,
	KINDS,
	NODE_KINDS,
	SHAPE_KINDS,
	type Scene,
	emptyScene,
	frameOf,
	propVar,
} from "./index.ts";

test("every drawable kind is a tool, and no wrapper is", () => {
	for (const kind of NODE_KINDS) {
		assert.equal(DRAW_KINDS.includes(kind), KINDS[kind].drawable);
	}
	// A group only ever comes from a selection, so it must never be drawable.
	assert.equal(KINDS.group.drawable, false);
	assert.ok(!DRAW_KINDS.includes("group"));
	for (const kind of ["rect", "ellipse", "line", "arrow"] as const) {
		assert.ok(DRAW_KINDS.includes(kind), `${kind} should be drawable`);
	}
});

test("the shape slot holds the shapes, in declaration order", () => {
	assert.deepEqual(SHAPE_KINDS, ["rect", "ellipse", "line", "arrow"]);
	for (const kind of SHAPE_KINDS) assert.ok(KINDS[kind].drawable);
	// The shapes are leaves: nothing lands inside one.
	for (const kind of SHAPE_KINDS) assert.equal(KINDS[kind].container, false);
});

test("an ellipse has a fill and nothing that needs corners", () => {
	assert.ok(!KINDS.ellipse.props.includes("radius"));
	const node = makeNode("ellipse", { x: 0, y: 0, width: 60, height: 40 });
	assert.equal(node.props.fill?.[0]?.kind, "literal");
	assert.equal(node.props.radius, undefined);
	assert.equal(node.diagonal, undefined);
});

test("a line is a box plus which way it leans", () => {
	const down = makeNode("line", { x: 10, y: 20, width: 100, height: 60 });
	assert.equal(down.diagonal, "down");
	assert.deepEqual(frameOf(down), { x: 10, y: 20, width: 100, height: 60 });
	assert.equal(down.props.stroke?.[0]?.kind, "literal");
	assert.equal(down.props.strokeWidth?.[0]?.kind, "literal");

	const up = makeNode(
		"arrow",
		{ x: 0, y: 0, width: 80, height: 40 },
		{ diagonal: "up" },
	);
	assert.equal(up.diagonal, "up");
});

test("a diagonal is only carried by the kinds that lean", () => {
	const rect = makeNode(
		"rect",
		{ x: 0, y: 0, width: 40, height: 40 },
		{ diagonal: "up" },
	);
	assert.ok(!("diagonal" in rect));
});

test("the new kinds compile to facts like any other", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("arrow", { x: 0, y: 0, width: 40, height: 40 }, { id: "a1" }),
	);
	scene = addNode(
		scene,
		makeNode("ellipse", { x: 0, y: 0, width: 40, height: 40 }, { id: "e1" }),
	);

	const result = compile(scene);
	assert.ok(result.program.includes("kind(a1,arrow)."));
	assert.ok(result.program.includes("kind(e1,ellipse)."));
	// Stroke is an ordinary variable: one alternative, so it does not branch.
	assert.equal(result.variables[propVar("a1", "stroke")], 1);
	assert.equal(result.variables[propVar("e1", "fill")], 1);
});

test("a stored line keeps the diagonal it was drawn with", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode(
			"line",
			{ x: 0, y: 0, width: 40, height: 40 },
			{ id: "l1", diagonal: "up" },
		),
	);
	const back = normalizeScene(JSON.parse(JSON.stringify(scene)));
	assert.equal(back.nodes[0]?.diagonal, "up");
});
