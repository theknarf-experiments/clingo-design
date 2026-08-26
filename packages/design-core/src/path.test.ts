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
import {
	type Frame,
	type PathPoint,
	pathBounds,
	pathData,
	pointsBounds,
	scalePoints,
} from "./geometry.ts";
import { normalizeScene } from "./project.ts";
import { KINDS, type Scene, emptyScene, frameOf, isPlotted } from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { findInTree, worldFrame } from "./tree.ts";

/**
 * A vertex is a length like any other, so a path is EMU throughout.
 *
 * Which half of this file has to say so is a useful split. `pathData`,
 * `pathBounds` and `scalePoints` are shape arithmetic — a cubic's extremes are
 * where they are in any unit — and those cases are left in bare numbers,
 * because scaling them would add noise and check nothing extra. Everything that
 * goes through a *document* does have to say so: `makePath` and `setFrame` run
 * a frame through `normaliseFrame`, which quantizes to a whole pixel and
 * enforces a four-pixel minimum, and a square 100 EMU across would come back
 * clamped to nothing.
 */
const P = EMU_PER_PX;

const box = (x: number, y: number, width: number, height: number): Frame => ({
	x: x * P,
	y: y * P,
	width: width * P,
	height: height * P,
});

const at = (x: number, y: number): PathPoint => ({ x: x * P, y: y * P });

/** A closed square drawn at (100,100), as the pen would hand it over. */
const SQUARE = [at(100, 100), at(200, 100), at(200, 180), at(100, 180)];

test("a path is drawn point by point and is not a shape-menu shape", () => {
	assert.equal(KINDS.path.plotted, true);
	assert.equal(KINDS.path.drawable, true);
	// It owns a toolbar slot, so it must not also sit behind the shape menu.
	assert.equal(KINDS.path.shape, false);
	assert.equal(isPlotted(makePath(SQUARE, true)), true);
	assert.equal(isPlotted(makeNode("rect", box(0, 0, 4, 4))), false);
});

test("the frame is the bounding box and the points are relative to it", () => {
	const node = makePath(SQUARE, true);
	assert.deepEqual(frameOf(node), box(100, 100, 100, 80));
	assert.deepEqual(node.points, [at(0, 0), at(100, 0), at(100, 80), at(0, 80)]);
	assert.equal(node.closed, true);
	assert.equal(makePath(SQUARE, false).closed, false);
});

test("a path drawn off the pixel grid still has its own bounding box", () => {
	// `SQUARE` is whole pixels, so it cannot tell whether the invariant survives
	// the quantum — and a pen does not draw on whole pixels. These vertices are
	// 100000 and 200000 EMU, which is 10.499… and 20.997… pixels: nothing about
	// them lands where `writeLength` would put a stored dimension.
	//
	// The failure this is here to catch is silent and visible at the same time.
	// `Plot` scales the vertices out of the frame they were authored in and into
	// the one the node is drawn at, so a frame that is not their bounding box
	// squashes the shape by the ratio between the two and slides it off the
	// anchors — while the editor draws its handles at the unscaled points, so the
	// dots and the curve disagree on screen with nothing to say why.
	const node = makePath(
		[
			{ x: 100000, y: 100000 },
			{ x: 200000, y: 100000 },
			{ x: 200000, y: 200000 },
		],
		true,
	);
	const frame = frameOf(node);
	assert.deepEqual(pointsBounds(node.points ?? []), {
		x: 0,
		y: 0,
		width: frame.width,
		height: frame.height,
	});
	// And the box really is quantized, so the agreement above is the anchors
	// having moved to meet it rather than the quantum having been skipped.
	assert.deepEqual([frame.x, frame.y], [10 * P, 10 * P]);
});

test("a curve that reaches past its anchors is shifted into the stored box", () => {
	// The other half, and it is a different failure with the same symptom.
	// Quantizing the anchors is not enough on its own: `pathBounds` includes the
	// extremes of every bezier, and a curve reaches its widest wherever the
	// arithmetic puts it. Here the handles pull the curve left of the first
	// anchor, so the bounding box begins at a fraction of a pixel — and shifting
	// the points against that raw box rather than against the one `normaliseFrame`
	// stores would offset the whole shape by up to half a pixel.
	const node = makePath(
		[
			{ x: 100 * P, y: 0, out: { x: -40 * P, y: 0 } },
			{ x: 110 * P, y: 0, in: { x: 40 * P, y: 0 } },
		],
		false,
	);
	const frame = frameOf(node);
	const first = node.points?.[0];
	assert.ok(first);
	// The box is on the grid, and the curve's own extreme is not — which is the
	// condition the case needs, since a raw box that happened to be whole would
	// make either shift give the same answer.
	assert.equal(frame.x % P, 0);
	const bounds = pathBounds(node.points ?? [], node.closed ?? false);
	assert.ok(bounds && bounds.x !== 0, "the curve reaches inside the stored box");
	// The assertion: an anchor is still where it was clicked, to the EMU. Shifting
	// against the raw bounding box instead would leave this short by the fraction
	// of a pixel the quantum moved the box.
	assert.equal(frame.x + first.x, 100 * P);
});

test("only a plotted kind carries points", () => {
	const rect = makeNode("rect", box(0, 0, 40, 40), {
		points: SQUARE,
		closed: true,
	});
	assert.ok(!("points" in rect));
	assert.ok(!("closed" in rect));
});

test("resizing a path scales its points, so the two keep describing one shape", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, { ...makePath(SQUARE, true), id: "p1" });

	scene = setFrame(scene, "p1", box(100, 100, 200, 40));
	const node = findInTree(scene.nodes, "p1");
	assert.deepEqual(node?.points, [at(0, 0), at(200, 0), at(200, 40), at(0, 40)]);
	// The invariant: the frame is still exactly the points' bounding box.
	assert.deepEqual(pointsBounds(node?.points ?? []), box(0, 0, 200, 40));
});

test("moving a path leaves its points alone", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, { ...makePath(SQUARE, false), id: "p1" });
	const before = findInTree(scene.nodes, "p1")?.points;

	scene = setFrame(scene, "p1", box(300, 40, 100, 80));
	assert.deepEqual(findInTree(scene.nodes, "p1")?.points, before);
});

test("a path lands inside a frame with its points untouched", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", box(60, 20, 400, 300), { id: "f1" }),
	);
	scene = addNodeTo(scene, "f1", { ...makePath(SQUARE, true), id: "p1" });

	const node = findInTree(scene.nodes, "p1");
	// The frame is rebased into the parent; the geometry is the path's own
	// business and must not move with it.
	assert.deepEqual(node && frameOf(node), box(40, 80, 100, 80));
	assert.deepEqual(node?.points?.[1], at(100, 0));
	assert.deepEqual(worldFrame(scene.nodes, "p1"), box(100, 100, 100, 80));
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
	assert.deepEqual(node?.points?.[2], at(100, 80));
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
		makePath([at(100, 100), at(140, 100), at(140, 140)], true, { id: "p" }),
	);
	const before = findInTree(scene.nodes, "p");
	assert.deepEqual(before && frameOf(before), box(100, 100, 40, 40));

	// Drag the first vertex up and left, beyond the old box.
	scene = movePathPoint(scene, "p", 0, at(-20, -20));
	const after = findInTree(scene.nodes, "p");
	assert.deepEqual(
		after && frameOf(after),
		box(80, 80, 60, 60),
		"the frame follows the points rather than clipping them",
	);
	// Every point stays inside its own frame.
	for (const p of after?.points ?? []) {
		assert.ok(p.x >= 0 && p.y >= 0, `point ${JSON.stringify(p)} is inside`);
	}
	assert.equal(worldFrame(scene.nodes, "p")?.x, 80 * P);
});

test("smoothing a corner gives it mirrored handles, and un-smoothing removes them", () => {
	let scene = addNode(
		emptyScene(),
		makePath([at(0, 0), at(50, 0), at(100, 0)], false, { id: "p" }),
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
		makePath([{ ...at(0, 0), out: at(10, 0) }, at(40, 40)], false, { id: "p" }),
	);
	scene = setFrame(scene, "p", box(0, 0, 80, 40));
	const out = findInTree(scene.nodes, "p")?.points?.[0]?.out;
	assert.equal(out?.x, 20 * P, "doubled with the width");
	assert.equal(out?.y, 0);
});

test("a path keeps at least two points", () => {
	let scene = addNode(
		emptyScene(),
		makePath([at(0, 0), at(10, 0), at(10, 10)], false, { id: "p" }),
	);
	scene = removePathPoint(scene, "p", 0);
	assert.equal(findInTree(scene.nodes, "p")?.points?.length, 2);
	scene = removePathPoint(scene, "p", 0);
	assert.equal(findInTree(scene.nodes, "p")?.points?.length, 2, "refused");
});
