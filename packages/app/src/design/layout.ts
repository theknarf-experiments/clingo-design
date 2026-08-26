/**
 * Where each copy of the document sits when the canvas shows more than one.
 *
 * The two numbers below are the only ones in the file, and they are the reason
 * it needed touching at all when geometry became EMU. Neither is part of any
 * design: the space between two copies and the room under one for its caption
 * are chrome, decided by what is comfortable to look at, and they were written
 * as the pixel counts they are. But the plane they are added to is the
 * document's plane — {@link layoutArtboards} is handed the size of the design
 * and returns coordinates in the same units it was given — and that plane is now
 * EMU. So each is stated as the pixel count it has always been, times
 * {@link EMU_PER_PX}, converted once here rather than being a bare 48 that would
 * quietly become a two-hundredth of a pixel and tile every artboard on top of
 * its neighbour.
 *
 * The multiplication is exact and the constants stay readable as what they mean,
 * which is why it is written this way round rather than as 457200.
 */
import { EMU_PER_PX } from "@clingo-design/design-core";

/** Gap between artboards: 48 canvas pixels, in the document's own units. */
export const GAP = 48 * EMU_PER_PX;
/** Room under each artboard for its caption: 26 canvas pixels, likewise. */
export const CAPTION = 26 * EMU_PER_PX;

export interface Placement {
	x: number;
	y: number;
}

export interface Layout {
	placements: Placement[];
	bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Arranges N artboards into a roughly square grid on the infinite canvas.
 * Square-ish beats a fixed column count here: the universe count swings by
 * orders of magnitude as alternatives are added, and a wide-and-short strip is
 * much harder to fit into view than a compact block.
 *
 * `size` is how much room one copy of the document needs, in EMU, and every
 * number that comes back is EMU too — this is arithmetic *in* the document's
 * plane, not a crossing into the canvas's. The crossing happens once, above,
 * where the grid is finally positioned as DOM.
 */
export function layoutArtboards(
	count: number,
	size: { width: number; height: number },
): Layout {
	if (count <= 0) {
		return { placements: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };
	}

	const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
	const rows = Math.ceil(count / cols);
	const stepX = size.width + GAP;
	const stepY = size.height + CAPTION + GAP;

	const placements = Array.from({ length: count }, (_, i) => ({
		x: (i % cols) * stepX,
		y: Math.floor(i / cols) * stepY,
	}));

	return {
		placements,
		bounds: {
			x: 0,
			y: 0,
			width: cols * stepX - GAP,
			height: rows * stepY - GAP,
		},
	};
}
