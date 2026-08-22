/** Gap between artboards on the canvas, in canvas units. */
export const GAP = 48;
/** Room under each artboard for its caption. */
export const CAPTION = 26;

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
