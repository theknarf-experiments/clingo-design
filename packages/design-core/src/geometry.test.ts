import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type Frame,
	MIN_NODE_SIZE,
	SNAP_GRID,
	SNAP_THRESHOLD,
	type SnapLine,
	type SnapRank,
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
import { EMU_PER_PX } from "./units.ts";

const f = (x: number, y: number, width: number, height: number): Frame => ({
	x,
	y,
	width,
	height,
});

/**
 * The same, written in pixels.
 *
 * Half this file is pure rectangle arithmetic and does not care what a number
 * means — a bounding box is a bounding box in any unit — and half of it is about
 * how near is near enough, which is a claim about pixels that has to be spelled
 * in EMU to be tested at all. The second half uses this, and the numbers in it
 * read as the pixel counts a person would say.
 */
const px = (x: number, y: number, width: number, height: number): Frame =>
	f(x * EMU_PER_PX, y * EMU_PER_PX, width * EMU_PER_PX, height * EMU_PER_PX);

const P = EMU_PER_PX;

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

/* ------------------------------------------------------------------ */
/* The constants are pixels, and they have to be said in EMU           */
/* ------------------------------------------------------------------ */

test("the hand-and-eye constants are pixel counts, not bare numbers", () => {
	// The whole failure mode of the move to EMU: left at 4, 6 and 8 these would
	// still typecheck, still run, and quietly stop meaning anything — four
	// ten-thousandths of a pixel is not a minimum size.
	assert.equal(MIN_NODE_SIZE, 4 * P);
	assert.equal(SNAP_THRESHOLD, 6 * P);
	assert.equal(SNAP_GRID, 8 * P);
});

test("normaliseFrame puts a gesture on a whole pixel", () => {
	assert.deepEqual(
		normaliseFrame(f(10.4 * P, 20.6 * P, 30.2 * P, 40.8 * P)),
		px(10, 21, 30, 41),
	);
	// Half a pixel goes away from zero, the one tie rule units.ts uses.
	assert.deepEqual(normaliseFrame(f(0.5 * P, -0.5 * P, 10 * P, 10 * P)), px(1, -1, 10, 10));
});

test("normaliseFrame enforces a minimum size a person can still grab", () => {
	const tiny = normaliseFrame(f(0, 0, 0, 0));
	assert.deepEqual([tiny.width, tiny.height], [4 * P, 4 * P]);
});

test("handleEdges reports which sides a grip drags", () => {
	assert.deepEqual(handleEdges("nw"), { left: true, right: false, top: true, bottom: false });
	assert.deepEqual(handleEdges("e"), { left: false, right: true, top: false, bottom: false });
	assert.deepEqual(handleEdges("s"), { left: false, right: false, top: false, bottom: true });
});

const container: Frame = px(0, 0, 400, 300);

test("snapping aligns to a neighbour's edge", () => {
	// Same width, so left/centre/right all agree on the same 3px nudge — and 3px
	// is 28575 EMU, which a threshold left at a bare 6 would never have caught.
	const target = px(100, 0, 40, 40);
	const { frame, guides } = snapFrame(px(103, 200, 40, 40), {
		targets: [target],
		container,
	});

	assert.equal(frame.x, 100 * P, "left edge lands on the neighbour's left edge");
	assert.ok(guides.some((g) => g.axis === "x" && g.at === 100 * P));
});

test("snapping lets go of something genuinely far away", () => {
	// The target's edges are at 100, 120 and 140; ours are at 200, 220 and 240,
	// so every pair is 60px apart and past the threshold. The grid takes it
	// instead, and 200 is already a multiple of 8.
	const { frame, guides } = snapFrame(px(200, 200, 40, 40), {
		targets: [px(100, 0, 40, 40)],
	});
	assert.equal(frame.x, 200 * P);
	assert.deepEqual(guides, []);
});

test("snapping prefers centre alignment when it is nearer", () => {
	// Own centre 123 is 2px from the target centre 125; the left edges are 3px
	// apart. The closer match should win.
	const { frame } = snapFrame(px(103, 200, 40, 40), {
		targets: [px(100, 0, 50, 50)],
		container,
	});
	assert.equal(frame.x, 105 * P);
});

test("snapping prefers a neighbour over the grid", () => {
	// x=99 is 1px from a neighbour edge and 1px from the 8px grid at 96/104.
	const target = px(99, 0, 50, 50);
	const { frame } = snapFrame(px(100, 200, 40, 40), {
		targets: [target],
		container,
		grid: SNAP_GRID,
	});
	assert.equal(frame.x, 99 * P, "object snapping wins");
});

test("snapping falls back to the grid when nothing is near", () => {
	const { frame, guides } = snapFrame(px(101, 203, 40, 40), {
		targets: [],
		container,
		grid: SNAP_GRID,
	});
	// 101 -> 104 and 203 -> 200, each to the nearest multiple of 8.
	assert.deepEqual([frame.x, frame.y], [104 * P, 200 * P]);
	assert.deepEqual(guides, [], "the grid does not draw guides");
});

test("the grid breaks a tie away from zero, on both sides of it", () => {
	// Exactly half a step out on each axis, and the two must not disagree about
	// which way half goes just because one of them is negative.
	const { frame } = snapFrame(px(-4, 100, 40, 40), { targets: [] });
	assert.deepEqual([frame.x, frame.y], [-8 * P, 104 * P]);
});

test("snapping catches the container's edges and centre", () => {
	assert.equal(snapFrame(px(2, 100, 40, 40), { targets: [], container }).frame.x, 0);
	const centred = snapFrame(px(178, 100, 40, 40), { targets: [], container });
	// Centre of a 40-wide box at x=180 sits on the container centre, 200.
	assert.equal(centred.frame.x, 180 * P);
});

test("resizing snaps only the dragged edge", () => {
	const target = px(300, 0, 50, 50);
	// Dragging the east edge: the left edge must stay put.
	const { frame } = snapFrame(
		px(100, 100, 197, 40),
		{ targets: [target], container },
		handleEdges("e"),
	);
	assert.equal(frame.x, 100 * P, "left edge is not being dragged");
	assert.equal(frame.x + frame.width, 300 * P, "right edge snapped to the neighbour");
});

test("snapping is a no-op when the frame is already aligned", () => {
	const target = px(100, 0, 50, 50);
	const already = px(100, 200, 40, 40);
	assert.deepEqual(snapFrame(already, { targets: [target], container }).frame, already);
});

/* ------------------------------------------------------------------ */
/* Lines, and which of them wins                                       */
/* ------------------------------------------------------------------ */

/** A line to catch on, in the pixels the cases are written in. */
const line = (
	axis: "x" | "y",
	at: number,
	rank: SnapRank,
	id?: string,
): SnapLine => ({ axis, at: at * P, rank, id });

test("a line catches an edge the way another node's edge does", () => {
	const { frame, guides } = snapFrame(px(103, 200, 40, 40), {
		targets: [],
		lines: [line("x", 100, "ruled", "cg(page,2,left)")],
	});
	assert.equal(frame.x, 100 * P);
	assert.deepEqual(
		guides.map((g) => [g.axis, g.at, g.id, g.place]),
		[["x", 100 * P, "cg(page,2,left)", "lead"]],
	);
});

test("a column line beats a neighbour that is nearer", () => {
	// The neighbour's left edge is a pixel away and the column line is three, so
	// distance alone would take the neighbour. It does not: a column is a thing
	// the document states and a neighbour is where something happens to be.
	const { frame, guides } = snapFrame(px(103, 200, 40, 40), {
		targets: [px(102, 0, 40, 40)],
		lines: [line("x", 100, "ruled", "cg(page,2,left)")],
	});
	assert.equal(frame.x, 100 * P);
	assert.equal(guides[0].id, "cg(page,2,left)");
});

test("a line somebody drew beats a column line that is nearer", () => {
	const { frame, guides } = snapFrame(px(103, 200, 40, 40), {
		targets: [],
		lines: [
			line("x", 102, "ruled", "cg(page,2,left)"),
			line("x", 99, "drawn", "gl(page,g1)"),
		],
	});
	assert.equal(frame.x, 99 * P);
	assert.equal(guides[0].id, "gl(page,g1)");
});

test("among equals it is still the nearest that catches", () => {
	const { frame, guides } = snapFrame(px(103, 200, 40, 40), {
		targets: [],
		lines: [
			line("x", 100, "ruled", "cg(page,2,left)"),
			line("x", 105, "ruled", "cg(page,2,right)"),
		],
	});
	assert.equal(frame.x, 105 * P);
	assert.equal(guides[0].id, "cg(page,2,right)");
});

test("a stronger line out of range does not shut the weaker ones out", () => {
	// The whole risk of ranking: a rank that caught nothing must not be allowed
	// to beat one that did.
	const { frame } = snapFrame(px(103, 200, 40, 40), {
		targets: [],
		lines: [
			line("x", 900, "drawn", "gl(page,g1)"),
			line("x", 100, "ruled", "cg(page,2,left)"),
		],
	});
	assert.equal(frame.x, 100 * P);
});

test("which of the node's own places landed on the line is reported", () => {
	// A 40-wide box whose centre is at 123 — put its centre on the column's
	// middle at 125, and say that is what happened, because "this card's centre
	// is on column two" is a rule and "these numbers agree" is not.
	const { frame, guides } = snapFrame(px(103, 200, 40, 40), {
		targets: [],
		lines: [line("x", 125, "ruled", "cg(page,2,centerX)")],
	});
	assert.equal(frame.x, 105 * P);
	assert.deepEqual([guides[0].place, guides[0].id], ["mid", "cg(page,2,centerX)"]);
});

test("a line on the other axis is not a candidate on this one", () => {
	const { frame, guides } = snapFrame(px(103, 203, 40, 40), {
		targets: [],
		lines: [line("y", 100, "ruled", "cg(page,1,top)")],
		grid: 0,
	});
	assert.deepEqual([frame.x, frame.y], [103 * P, 203 * P]);
	assert.deepEqual(guides, []);
});

test("resizing catches a line with the dragged edge only", () => {
	const { frame, guides } = snapFrame(
		px(100, 100, 197, 40),
		{ targets: [], lines: [line("x", 300, "ruled", "cg(page,3,right)")] },
		handleEdges("e"),
	);
	assert.equal(frame.x, 100 * P);
	assert.equal(frame.x + frame.width, 300 * P);
	assert.deepEqual([guides[0].id, guides[0].place], ["cg(page,3,right)", "trail"]);
});

test("an ordinary edge says nothing about itself", () => {
	// The absence is the statement: there is nothing to write down about two
	// boxes that happen to line up, so nothing offers to.
	const { guides } = snapFrame(px(103, 200, 40, 40), {
		targets: [px(100, 0, 40, 40)],
		container,
	});
	assert.equal(guides[0].id, undefined);
	assert.equal(guides[0].place, "lead");
});
