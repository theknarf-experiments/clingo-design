import assert from "node:assert/strict";
import { test } from "node:test";

import { EMU_PER_PX } from "@clingo-design/design-core";

import { CAPTION, GAP, layoutArtboards } from "./layout.ts";

/**
 * The multiverse grid.
 *
 * The arithmetic never changed; what changed is the plane it happens in. These
 * pin that the two chrome constants are still worth the pixels they were
 * written as, and that a real document — pages are millions of EMU across —
 * still tiles with daylight between the copies.
 */

/** A4, in EMU, because that is the size the old constants would have drowned in. */
const A4 = { width: 7560000, height: 10692000 };

test("one artboard sits at the origin, with room under it for its name", () => {
	const { placements, bounds } = layoutArtboards(1, A4);
	assert.deepEqual(placements, [{ x: 0, y: 0 }]);
	// The caption is part of what has to be fitted into view, so it is inside
	// the bounds even when there is only one copy and nothing to separate.
	assert.deepEqual(bounds, {
		x: 0,
		y: 0,
		width: A4.width,
		height: A4.height + CAPTION,
	});
});

test("no artboards is an empty layout rather than a degenerate one", () => {
	for (const count of [0, -1]) {
		assert.deepEqual(layoutArtboards(count, A4), {
			placements: [],
			bounds: { x: 0, y: 0, width: 0, height: 0 },
		});
	}
});

test("the grid stays square-ish as the universe count grows", () => {
	const cols = (count: number) => {
		const { placements } = layoutArtboards(count, A4);
		return new Set(placements.map((p) => p.x)).size;
	};
	assert.equal(cols(2), 2);
	assert.equal(cols(4), 2);
	assert.equal(cols(5), 3);
	assert.equal(cols(9), 3);
	assert.equal(cols(10), 4);
});

test("the space between two copies is forty-eight pixels of it", () => {
	// The regression the EMU move would have caused: left as a bare 48, the gap
	// between two page-sized artboards would be a two-hundredth of a pixel and
	// every copy would sit edge to edge with its neighbour.
	assert.equal(GAP, 48 * EMU_PER_PX);
	assert.equal(CAPTION, 26 * EMU_PER_PX);
	const { placements } = layoutArtboards(2, A4);
	assert.equal(placements[1].x - placements[0].x - A4.width, 48 * EMU_PER_PX);
});

test("the caption's room is under a row, not beside a column", () => {
	// A caption sits below its artboard, so only the vertical step carries it —
	// the two steps differing by exactly CAPTION is what says so.
	const square = { width: A4.width, height: A4.width };
	const { placements } = layoutArtboards(4, square);
	const stepX = placements[1].x - placements[0].x;
	const stepY = placements[2].y - placements[0].y;
	assert.equal(stepY - stepX, CAPTION);
});

test("the bounds are the grid and not a gap more", () => {
	// What `canvas.fit` is handed. A trailing gap would leave the whole block
	// framed off-centre, by half a gap, every time.
	const { placements, bounds } = layoutArtboards(6, A4);
	const right = Math.max(...placements.map((p) => p.x)) + A4.width;
	const bottom = Math.max(...placements.map((p) => p.y)) + A4.height + CAPTION;
	assert.equal(bounds.width, right);
	assert.equal(bounds.height, bottom);
});
