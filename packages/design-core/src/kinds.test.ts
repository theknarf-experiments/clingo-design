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
import { EMU_PER_PX } from "./units.ts";

/** A frame is EMU, and the sizes below are the pixel counts a person says. */
const px = (n: number): number => n * EMU_PER_PX;

test("the toolbar holds exactly the kinds a pointer can draw out", () => {
	for (const kind of NODE_KINDS) {
		assert.equal(DRAW_KINDS.includes(kind), KINDS[kind].tool);
		// Nothing without pixels can be drawn out: there would be nothing to
		// drag a box around.
		if (KINDS[kind].tool) assert.ok(KINDS[kind].drawable, `${kind} needs pixels`);
	}
	// A group only ever comes from a selection, and an instance only ever from a
	// definition, so neither has a slot.
	assert.equal(KINDS.group.drawable, false);
	assert.equal(KINDS.group.tool, false);
	// An instance *is* clickable and snappable — the pixels inside it are real —
	// it just is not something you draw.
	assert.equal(KINDS.instance.drawable, true);
	assert.equal(KINDS.instance.tool, false);
	for (const kind of ["group", "instance"] as const) {
		assert.ok(!DRAW_KINDS.includes(kind));
	}
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
	const node = makeNode("ellipse", { x: 0, y: 0, width: px(60), height: px(40) });
	assert.equal(node.props.fill?.[0]?.kind, "literal");
	assert.equal(node.props.radius, undefined);
	assert.equal(node.diagonal, undefined);
});

test("a line is a box plus which way it leans", () => {
	const down = makeNode("line", {
		x: px(10),
		y: px(20),
		width: px(100),
		height: px(60),
	});
	assert.equal(down.diagonal, "down");
	assert.deepEqual(frameOf(down), {
		x: px(10),
		y: px(20),
		width: px(100),
		height: px(60),
	});
	assert.equal(down.props.stroke?.[0]?.kind, "literal");
	assert.equal(down.props.strokeWidth?.[0]?.kind, "literal");

	const up = makeNode(
		"arrow",
		{ x: 0, y: 0, width: px(80), height: px(40) },
		{ diagonal: "up" },
	);
	assert.equal(up.diagonal, "up");
});

test("a diagonal is only carried by the kinds that lean", () => {
	const rect = makeNode(
		"rect",
		{ x: 0, y: 0, width: px(40), height: px(40) },
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
