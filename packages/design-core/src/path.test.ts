import assert from "node:assert/strict";
import { test } from "node:test";

import {
	addNode,
	addNodeTo,
	makeNode,
	makePath,
	movePathPoint,
	removePathPoint,
	setFrame,
	togglePathSmooth,
} from "./edits.ts";
import { pathBounds, pathData, pointsBounds, scalePoints } from "./geometry.ts";
import { normalizeScene } from "./project.ts";
import { KINDS, type Scene, emptyScene, isPlotted } from "./scene.ts";
import { findInTree, worldFrame } from "./tree.ts";

/** A closed square drawn at (100,100), as the pen would hand it over. */
const SQUARE = [
	{ x: 100, y: 100 },
	{ x: 200, y: 100 },
	{ x: 200, y: 180 },
	{ x: 100, y: 180 },
];

test("a path is drawn point by point and is not a shape-menu shape", () => {
	assert.equal(KINDS.path.plotted, true);
	assert.equal(KINDS.path.drawable, true);
	// It owns a toolbar slot, so it must not also sit behind the shape menu.
	assert.equal(KINDS.path.shape, false);
	assert.equal(isPlotted(makePath(SQUARE, true)), true);
	assert.equal(isPlotted(makeNode("rect", { x: 0, y: 0, width: 4, height: 4 })), false);
});

test("the frame is the bounding box and the points are relative to it", () => {
	const node = makePath(SQUARE, true);
	assert.deepEqual(node.frame, { x: 100, y: 100, width: 100, height: 80 });
	assert.deepEqual(node.points, [
		{ x: 0, y: 0 },
		{ x: 100, y: 0 },
		{ x: 100, y: 80 },
		{ x: 0, y: 80 },
	]);
	assert.equal(node.closed, true);
	assert.equal(makePath(SQUARE, false).closed, false);
});

test("only a plotted kind carries points", () => {
	const rect = makeNode(
		"rect",
		{ x: 0, y: 0, width: 40, height: 40 },
		{ points: SQUARE, closed: true },
	);
	assert.ok(!("points" in rect));
	assert.ok(!("closed" in rect));
});

test("resizing a path scales its points, so the two keep describing one shape", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, { ...makePath(SQUARE, true), id: "p1" });

	scene = setFrame(scene, "p1", { x: 100, y: 100, width: 200, height: 40 });
	const node = findInTree(scene.nodes, "p1");
	assert.deepEqual(node?.points, [
		{ x: 0, y: 0 },
		{ x: 200, y: 0 },
		{ x: 200, y: 40 },
		{ x: 0, y: 40 },
	]);
	// The invariant: the frame is still exactly the points' bounding box.
	assert.deepEqual(pointsBounds(node?.points ?? []), {
		x: 0,
		y: 0,
		width: 200,
		height: 40,
	});
});

test("moving a path leaves its points alone", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, { ...makePath(SQUARE, false), id: "p1" });
	const before = findInTree(scene.nodes, "p1")?.points;

	scene = setFrame(scene, "p1", { x: 300, y: 40, width: 100, height: 80 });
	assert.deepEqual(findInTree(scene.nodes, "p1")?.points, before);
});

test("a path lands inside a frame with its points untouched", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 60, y: 20, width: 400, height: 300 }, { id: "f1" }),
	);
	scene = addNodeTo(scene, "f1", { ...makePath(SQUARE, true), id: "p1" });

	const node = findInTree(scene.nodes, "p1");
	// The frame is rebased into the parent; the geometry is the path's own
	// business and must not move with it.
	assert.deepEqual(node?.frame, { x: 40, y: 80, width: 100, height: 80 });
	assert.deepEqual(node?.points?.[1], { x: 100, y: 0 });
	assert.deepEqual(worldFrame(scene.nodes, "p1"), {
		x: 100,
		y: 100,
		width: 100,
		height: 80,
	});
});

test("points scale into whatever box they are rendered in", () => {
	const points = [
		{ x: 0, y: 0 },
		{ x: 50, y: 20 },
	];
	assert.deepEqual(
		scalePoints(points, { width: 50, height: 20 }, { width: 100, height: 10 }),
		[
			{ x: 0, y: 0 },
			{ x: 100, y: 10 },
		],
	);
	// A flat path has no height to stretch: dividing by it would be a NaN
	// where the honest answer is "leave that axis alone".
	assert.deepEqual(
		scalePoints(
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
			],
			{ width: 10, height: 0 },
			{ width: 20, height: 4 },
		),
		[
			{ x: 0, y: 0 },
			{ x: 20, y: 0 },
		],
	);
});

test("a single point is a bounding box of nothing", () => {
	assert.equal(pointsBounds([]), null);
	assert.deepEqual(pointsBounds([{ x: 7, y: 9 }]), {
		x: 7,
		y: 9,
		width: 0,
		height: 0,
	});
});

test("a stored path keeps its points and its closed flag", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, { ...makePath(SQUARE, true), id: "p1" });

	const back = normalizeScene(JSON.parse(JSON.stringify(scene)));
	const node = back.nodes[0];
	assert.equal(node?.closed, true);
	assert.deepEqual(node?.points?.[2], { x: 100, y: 80 });
});

/* ------------------------------------------------------------------ */
/* Curves                                                              */
/* ------------------------------------------------------------------ */

test("a path with no handles is straight lines", () => {
	const pts = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
	];
	assert.equal(pathData(pts, false), "M 0 0 L 10 0 L 10 10");
	assert.equal(pathData(pts, true), "M 0 0 L 10 0 L 10 10 Z");
	assert.deepEqual(pathBounds(pts), { x: 0, y: 0, width: 10, height: 10 });
});

test("a handle turns its segment into a cubic", () => {
	const pts = [
		{ x: 0, y: 0, out: { x: 10, y: 0 } },
		{ x: 20, y: 0, in: { x: -10, y: 0 } },
	];
	assert.equal(pathData(pts), "M 0 0 C 10 0, 10 0, 20 0");
});

test("bounds follow the curve, not the control hull", () => {
	// Both handles pull straight down 30, but a cubic only reaches three
	// quarters of the way there. Bounding by the controls would say 30.
	const pts = [
		{ x: 0, y: 0, out: { x: 0, y: 30 } },
		{ x: 40, y: 0, in: { x: 0, y: 30 } },
	];
	const box = pathBounds(pts);
	assert.equal(box?.width, 40);
	assert.ok(
		Math.abs((box?.height ?? 0) - 22.5) < 0.001,
		`peak of this cubic is 22.5, got ${box?.height}`,
	);
});

test("a curve that bulges outside its anchors is still contained", () => {
	const pts = [
		{ x: 0, y: 0, out: { x: -40, y: 0 } },
		{ x: 10, y: 0, in: { x: 40, y: 0 } },
	];
	const box = pathBounds(pts);
	assert.ok((box?.x ?? 0) < 0, "reaches left of the first anchor");
	assert.ok((box?.x ?? 0) + (box?.width ?? 0) > 10, "and right of the second");
});

test("editing a point re-derives the frame under the shape", () => {
	let scene = addNode(
		emptyScene(),
		makePath(
			[
				{ x: 100, y: 100 },
				{ x: 140, y: 100 },
				{ x: 140, y: 140 },
			],
			true,
			{ id: "p" },
		),
	);
	const before = findInTree(scene.nodes, "p");
	assert.deepEqual(before?.frame, { x: 100, y: 100, width: 40, height: 40 });

	// Drag the first vertex up and left, beyond the old box.
	scene = movePathPoint(scene, "p", 0, { x: -20, y: -20 });
	const after = findInTree(scene.nodes, "p");
	assert.deepEqual(
		after?.frame,
		{ x: 80, y: 80, width: 60, height: 60 },
		"the frame follows the points rather than clipping them",
	);
	// Every point stays inside its own frame.
	for (const p of after?.points ?? []) {
		assert.ok(p.x >= 0 && p.y >= 0, `point ${JSON.stringify(p)} is inside`);
	}
	assert.equal(worldFrame(scene.nodes, "p")?.x, 80);
});

test("smoothing a corner gives it mirrored handles, and un-smoothing removes them", () => {
	let scene = addNode(
		emptyScene(),
		makePath(
			[
				{ x: 0, y: 0 },
				{ x: 50, y: 0 },
				{ x: 100, y: 0 },
			],
			false,
			{ id: "p" },
		),
	);
	scene = togglePathSmooth(scene, "p", 1);
	const smooth = findInTree(scene.nodes, "p")?.points?.[1];
	assert.ok(smooth?.in && smooth?.out, "both sides");
	assert.deepEqual(
		{ x: -(smooth?.in?.x ?? 0), y: -(smooth?.in?.y ?? 0) },
		smooth?.out,
		"opposite and equal",
	);

	scene = togglePathSmooth(scene, "p", 1);
	const corner = findInTree(scene.nodes, "p")?.points?.[1];
	assert.equal(corner?.in, undefined);
	assert.equal(corner?.out, undefined);
});

test("resizing scales the handles with the anchors", () => {
	let scene = addNode(
		emptyScene(),
		makePath(
			[
				{ x: 0, y: 0, out: { x: 10, y: 0 } },
				{ x: 40, y: 40 },
			],
			false,
			{ id: "p" },
		),
	);
	scene = setFrame(scene, "p", { x: 0, y: 0, width: 80, height: 40 });
	const out = findInTree(scene.nodes, "p")?.points?.[0]?.out;
	assert.equal(out?.x, 20, "doubled with the width");
	assert.equal(out?.y, 0);
});

test("a path keeps at least two points", () => {
	let scene = addNode(
		emptyScene(),
		makePath(
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
			],
			false,
			{ id: "p" },
		),
	);
	scene = removePathPoint(scene, "p", 0);
	assert.equal(findInTree(scene.nodes, "p")?.points?.length, 2);
	scene = removePathPoint(scene, "p", 0);
	assert.equal(findInTree(scene.nodes, "p")?.points?.length, 2, "refused");
});
