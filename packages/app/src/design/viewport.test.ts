import assert from "node:assert/strict";
import { test } from "node:test";

import { EMU_PER_PX } from "@clingo-design/design-core";

import {
	canvasPoint,
	canvasPx,
	canvasRect,
	documentLength,
	documentPoint,
	documentRange,
	documentSpan,
	screenPx,
} from "./viewport.ts";

/**
 * The pointer end of the unit system.
 *
 * Everything the editor touches below this seam is EMU and everything above it
 * is a CSS pixel, and the two are both a plain `number` — so what is pinned here
 * is which direction each function goes, which of them the camera is allowed to
 * affect, and that a gesture lands exactly where it was aimed.
 */

/** A surface at the top-left of the window, to keep the arithmetic readable. */
const AT_ORIGIN = { left: 0, top: 0 };

test("the surface's own corner is the origin it was given", () => {
	// The definition of `origin`: the document point the top-left corner shows.
	const origin = { x: 100 * EMU_PER_PX, y: 40 * EMU_PER_PX };
	assert.deepEqual(
		documentPoint({ clientX: 0, clientY: 0 }, AT_ORIGIN, 1, origin),
		origin,
	);
	// And the surface being somewhere else in the window is subtracted, not
	// added to the design.
	assert.deepEqual(
		documentPoint({ clientX: 320, clientY: 96 }, { left: 320, top: 96 }, 1, origin),
		origin,
	);
});

test("a screen pixel is worth less of the design the further you zoom in", () => {
	const origin = { x: 0, y: 0 };
	const at = (scale: number) =>
		documentPoint({ clientX: 100, clientY: 50 }, AT_ORIGIN, scale, origin);
	assert.deepEqual(at(1), { x: 100 * EMU_PER_PX, y: 50 * EMU_PER_PX });
	assert.deepEqual(at(2), { x: 50 * EMU_PER_PX, y: 25 * EMU_PER_PX });
	assert.deepEqual(at(0.5), { x: 200 * EMU_PER_PX, y: 100 * EMU_PER_PX });
});

test("a drag moves the design by what the hand moved, whatever the camera", () => {
	// The law every gesture in Editor.tsx rests on: it subtracts two of these
	// and adds the difference to a frame. Neither the origin nor the surface's
	// place in the window may survive that subtraction.
	const origin = { x: 7 * EMU_PER_PX, y: -3 * EMU_PER_PX };
	const surface = { left: 41, top: 17 };
	for (const scale of [1, 2, 0.25, 1.5]) {
		const from = documentPoint({ clientX: 200, clientY: 200 }, surface, scale, origin);
		const to = documentPoint({ clientX: 260, clientY: 180 }, surface, scale, origin);
		assert.equal(to.x - from.x, (60 / scale) * EMU_PER_PX);
		assert.equal(to.y - from.y, (-20 / scale) * EMU_PER_PX);
	}
});

test("a pointer position is whole EMU, because a gesture writes it", () => {
	// `emuFromCssPx` quantizes; a third of a pixel at 3x zoom must not arrive as
	// 3175.0000000000005 and travel into a stored frame.
	const point = documentPoint({ clientX: 1, clientY: 7 }, AT_ORIGIN, 3, {
		x: 0,
		y: 0,
	});
	assert.equal(point.x, Math.round(point.x));
	assert.equal(point.y, Math.round(point.y));
	assert.equal(point.x, 3175);
});

test("a tolerance shrinks with the zoom and knows nothing about the origin", () => {
	// This is the whole reason `documentSpan` exists beside `documentPoint`:
	// ten pixels of aim is ten pixels of screen at every zoom, so it covers less
	// of the design as the design gets bigger under the cursor.
	assert.equal(documentSpan(10, 1), 10 * EMU_PER_PX);
	assert.equal(documentSpan(10, 2), 5 * EMU_PER_PX);
	assert.equal(documentSpan(10, 0.5), 20 * EMU_PER_PX);
});

test("what is drawn is where the pointer said, at every zoom", () => {
	// Out and back: a point picked up from the screen and drawn again lands on
	// the same canvas pixel, which is what stops an anchor dot from sitting a
	// hair away from the vertex it belongs to.
	const origin = { x: 12 * EMU_PER_PX, y: 34 * EMU_PER_PX };
	for (const scale of [1, 2, 0.5]) {
		const point = documentPoint({ clientX: 256, clientY: 128 }, AT_ORIGIN, scale, origin);
		const drawn = canvasPoint(point);
		// The overlay is offset by the origin, so the corner is where 0 lands.
		assert.equal(drawn.x - canvasPx(origin.x), 256 / scale);
		assert.equal(drawn.y - canvasPx(origin.y), 128 / scale);
	}
});

test("a frame crosses whole, and a page-sized one stays page-sized", () => {
	// A4 in EMU, which is the magnitude that matters: read as pixels it would be
	// a mile wide, and read as EMU with a pixel-shaped constant beside it the
	// constant would vanish.
	const a4 = { x: 0, y: 0, width: 7560000, height: 10692000 };
	assert.deepEqual(canvasRect(a4), {
		x: 0,
		y: 0,
		width: 7560000 / EMU_PER_PX,
		height: 10692000 / EMU_PER_PX,
	});
	assert.equal(Math.round(canvasRect(a4).width), 794);
});

test("a camera coordinate crosses without the zoom, a window measurement with it", () => {
	// The ruler's whole arithmetic, and the mistake it is easy to make: the
	// camera's x is already in the canvas's plane, so the zoom has nothing to do
	// with it, while the width of the window is screen and everything to do with
	// it. Confuse the two and the ruler is right at 100% and wrong everywhere.
	assert.equal(documentLength(100), 100 * EMU_PER_PX);
	assert.deepEqual(documentRange(100, 800, 1), {
		from: 100 * EMU_PER_PX,
		to: 900 * EMU_PER_PX,
	});
	assert.deepEqual(documentRange(100, 800, 2), {
		from: 100 * EMU_PER_PX,
		to: 500 * EMU_PER_PX,
	});
	// And it is the exact inverse of the way out, which is what lets a tick be
	// computed in the design and drawn on the screen without drifting.
	assert.equal(documentLength(canvasPx(123 * EMU_PER_PX)), 123 * EMU_PER_PX);
});

test("a tick lands where the camera is looking", () => {
	// The near edge of the viewport shows the camera's own coordinate, so a tick
	// there is at zero pixels along; one a hundred design pixels further along is
	// a hundred screen pixels at 100% and two hundred at 200%.
	for (const scale of [1, 2, 0.25]) {
		assert.equal(screenPx(documentLength(40), 40, scale), 0);
		assert.equal(screenPx(documentLength(40) + 100 * EMU_PER_PX, 40, scale), 100 * scale);
	}
});

test("nothing here rounds on the way out", () => {
	// `canvasPx` is a divide and only a divide. A value the design can hold and
	// no pixel lattice can spell — half a pixel is 4762.5 EMU and 9525 is odd,
	// so the design cannot hold that either, but a third of a pixel it can —
	// must reach the DOM as the fraction it is rather than as a jump.
	assert.equal(canvasPx(3175), 1 / 3);
	assert.equal(canvasPx(-9525), -1);
	assert.equal(canvasPx(0), 0);
});
