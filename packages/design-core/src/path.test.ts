import assert from "node:assert/strict";
import { test } from "node:test";

import { addNode, addNodeTo, makeNode, makePath, setFrame } from "./edits.ts";
import { pointsBounds, scalePoints } from "./geometry.ts";
import { normalizeScene, parseLegacyProjects } from "./project.ts";
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

test("a path whose points did not survive is dropped rather than shown blank", () => {
	const broken = JSON.stringify({
		version: 1,
		projects: [
			{
				id: "p",
				name: "Broken",
				createdAt: 0,
				updatedAt: 0,
				scene: {
					tokens: [],
					constraints: [],
					rules: "",
					nodes: [
						{
							id: "p1",
							kind: "path",
							name: "Path",
							frame: { x: 0, y: 0, width: 10, height: 10 },
							props: {},
							points: ["nonsense"],
						},
					],
				},
			},
		],
	});
	assert.equal(parseLegacyProjects(broken)[0]?.scene.nodes.length, 1);
	assert.equal(parseLegacyProjects(broken)[0]?.scene.nodes[0]?.kind, "frame");
});
