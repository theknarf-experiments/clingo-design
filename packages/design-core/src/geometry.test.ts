import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type Frame,
	boundsOf,
	expandFrame,
	frameContains,
	frameFromPoints,
	framesIntersect,
	handleEdges,
	normaliseFrame,
	resizeFrame,
	snapFrame,
} from "./geometry.ts";


const f = (x: number, y: number, width: number, height: number): Frame => ({
	x,
	y,
	width,
	height,
});

test("frameContains uses inclusive edges", () => {
	const r = f(10, 10, 100, 50);
	assert.equal(frameContains(r, { x: 10, y: 10 }), true);
	assert.equal(frameContains(r, { x: 110, y: 60 }), true);
	assert.equal(frameContains(r, { x: 9, y: 30 }), false);
	assert.equal(frameContains(r, { x: 60, y: 61 }), false);
});

test("framesIntersect ignores mere touching", () => {
	assert.equal(framesIntersect(f(0, 0, 10, 10), f(5, 5, 10, 10)), true);
	assert.equal(framesIntersect(f(0, 0, 10, 10), f(10, 0, 10, 10)), false);
	assert.equal(framesIntersect(f(0, 0, 10, 10), f(20, 20, 5, 5)), false);
});

test("expandFrame grows on every side and never inverts", () => {
	assert.deepEqual(expandFrame(f(10, 20, 30, 40), 5), f(5, 15, 40, 50));
	assert.deepEqual(expandFrame(f(10, 20, 30, 40), 0), f(10, 20, 30, 40));
	// Shrinking past the middle would otherwise give a negative size, which
	// framesIntersect reads as a rectangle turned inside out.
	assert.deepEqual(expandFrame(f(10, 20, 30, 40), -100), f(110, 120, 0, 0));
});

test("a margin is what keeps a frame just off screen in play", () => {
	const view = f(0, 0, 100, 100);
	const offscreen = f(140, 0, 20, 20);
	assert.equal(framesIntersect(view, offscreen), false);
	assert.equal(framesIntersect(expandFrame(view, 50), offscreen), true);
});

test("boundsOf covers every frame", () => {
	assert.equal(boundsOf([]), null);
	assert.deepEqual(boundsOf([f(10, 20, 30, 40)]), f(10, 20, 30, 40));
	assert.deepEqual(
		boundsOf([f(10, 10, 10, 10), f(50, 30, 20, 20)]),
		f(10, 10, 60, 40),
	);
});

test("frameFromPoints normalises a drag in any direction", () => {
	assert.deepEqual(frameFromPoints({ x: 10, y: 10 }, { x: 50, y: 40 }), f(10, 10, 40, 30));
	// Dragging up and to the left gives the same rectangle.
	assert.deepEqual(frameFromPoints({ x: 50, y: 40 }, { x: 10, y: 10 }), f(10, 10, 40, 30));
});

test("resizeFrame moves only the dragged edges", () => {
	const start = f(100, 100, 200, 100);
	assert.deepEqual(resizeFrame(start, "e", 50, 0), f(100, 100, 250, 100));
	assert.deepEqual(resizeFrame(start, "w", 50, 0), f(150, 100, 150, 100));
	assert.deepEqual(resizeFrame(start, "n", 0, 20), f(100, 120, 200, 80));
	assert.deepEqual(resizeFrame(start, "s", 0, 20), f(100, 100, 200, 120));
	assert.deepEqual(resizeFrame(start, "se", 10, 10), f(100, 100, 210, 110));
	assert.deepEqual(resizeFrame(start, "nw", 10, 10), f(110, 110, 190, 90));
});

test("resizeFrame flips rather than going negative", () => {
	// Dragging the east edge past the west one mirrors the rectangle.
	const flipped = resizeFrame(f(100, 100, 50, 50), "e", -80, 0);
	assert.deepEqual(flipped, f(70, 100, 30, 50));
	assert.ok(flipped.width > 0);
});

test("normaliseFrame rounds and enforces a minimum size", () => {
	assert.deepEqual(normaliseFrame(f(10.4, 20.6, 30.2, 40.8)), f(10, 21, 30, 41));
	const tiny = normaliseFrame(f(0, 0, 0, 0));
	assert.ok(tiny.width >= 4 && tiny.height >= 4);
});

test("handleEdges reports which sides a grip drags", () => {
	assert.deepEqual(handleEdges("nw"), { left: true, right: false, top: true, bottom: false });
	assert.deepEqual(handleEdges("e"), { left: false, right: true, top: false, bottom: false });
	assert.deepEqual(handleEdges("s"), { left: false, right: false, top: false, bottom: true });
});

const container: Frame = { x: 0, y: 0, width: 400, height: 300 };

test("snapping aligns to a neighbour's edge", () => {
	// Same width, so left/centre/right all agree on the same 3px nudge.
	const target = f(100, 0, 40, 40);
	const { frame, guides } = snapFrame(f(103, 200, 40, 40), {
		targets: [target],
		container,
	});

	assert.equal(frame.x, 100, "left edge lands on the neighbour's left edge");
	assert.ok(guides.some((g) => g.axis === "x" && g.at === 100));
});

test("snapping prefers centre alignment when it is nearer", () => {
	// Own centre 123 is 2px from the target centre 125; the left edges are 3px
	// apart. The closer match should win.
	const { frame } = snapFrame(f(103, 200, 40, 40), {
		targets: [f(100, 0, 50, 50)],
		container,
	});
	assert.equal(frame.x, 105);
});

test("snapping prefers a neighbour over the grid", () => {
	// x=99 is 1px from a neighbour edge and 1px from the 8px grid at 96/104.
	const target = f(99, 0, 50, 50);
	const { frame } = snapFrame(f(100, 200, 40, 40), {
		targets: [target],
		container,
		grid: 8,
	});
	assert.equal(frame.x, 99, "object snapping wins");
});

test("snapping falls back to the grid when nothing is near", () => {
	const { frame, guides } = snapFrame(f(101, 203, 40, 40), {
		targets: [],
		container,
		grid: 8,
	});
	// 101 -> 104 and 203 -> 200, each to the nearest multiple of 8.
	assert.deepEqual([frame.x, frame.y], [104, 200]);
	assert.deepEqual(guides, [], "the grid does not draw guides");
});

test("snapping catches the container's edges and centre", () => {
	assert.equal(snapFrame(f(2, 100, 40, 40), { targets: [], container }).frame.x, 0);
	const centred = snapFrame(f(178, 100, 40, 40), { targets: [], container });
	// Centre of a 40-wide box at x=180 sits on the container centre, 200.
	assert.equal(centred.frame.x, 180);
});

test("resizing snaps only the dragged edge", () => {
	const target = f(300, 0, 50, 50);
	// Dragging the east edge: the left edge must stay put.
	const { frame } = snapFrame(
		f(100, 100, 197, 40),
		{ targets: [target], container },
		handleEdges("e"),
	);
	assert.equal(frame.x, 100, "left edge is not being dragged");
	assert.equal(frame.x + frame.width, 300, "right edge snapped to the neighbour");
});

test("snapping is a no-op when the frame is already aligned", () => {
	const target = f(100, 0, 50, 50);
	const already = f(100, 200, 40, 40);
	assert.deepEqual(snapFrame(already, { targets: [target], container }).frame, already);
});
