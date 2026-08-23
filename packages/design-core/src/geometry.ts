/**
 * Rectangle maths for the canvas: hit testing, resize handles and snapping.
 *
 * Pure and framework-free, so the tricky parts — which are the ones that make
 * dragging feel right or wrong — are testable without a browser.
 */
export interface Point {
	x: number;
	y: number;
}

/** Position and size, relative to whatever the node is placed in. */
export interface Frame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Smallest a node may be dragged down to, in canvas pixels. */
export const MIN_NODE_SIZE = 4;

/** The eight resize grips, plus the body for moving. */
export type Handle =
	| "nw"
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "sw"
	| "w";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export const HANDLE_CURSOR: Record<Handle, string> = {
	nw: "nwse-resize",
	n: "ns-resize",
	ne: "nesw-resize",
	e: "ew-resize",
	se: "nwse-resize",
	s: "ns-resize",
	sw: "nesw-resize",
	w: "ew-resize",
};

export function frameContains(frame: Frame, point: Point): boolean {
	return (
		point.x >= frame.x &&
		point.x <= frame.x + frame.width &&
		point.y >= frame.y &&
		point.y <= frame.y + frame.height
	);
}

export function framesIntersect(a: Frame, b: Frame): boolean {
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

/** The frame grown by `by` on every side. Negative shrinks, never past zero. */
export function expandFrame(frame: Frame, by: number): Frame {
	return {
		x: frame.x - by,
		y: frame.y - by,
		width: Math.max(0, frame.width + by * 2),
		height: Math.max(0, frame.height + by * 2),
	};
}

/** Smallest frame containing all of `frames`, or null when there are none. */
export function boundsOf(frames: readonly Frame[]): Frame | null {
	if (frames.length === 0) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const f of frames) {
		minX = Math.min(minX, f.x);
		minY = Math.min(minY, f.y);
		maxX = Math.max(maxX, f.x + f.width);
		maxY = Math.max(maxY, f.y + f.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A path vertex, with optional cubic control offsets.
 *
 * `in` and `out` are relative to the anchor, so moving a point carries its
 * curve with it. A point with neither is a corner, and a segment between two
 * corners is a straight line — which is why a path drawn with plain clicks
 * needs no handles stored at all.
 */
export interface PathPoint extends Point {
	in?: Point;
	out?: Point;
}

const add = (a: Point, b?: Point): Point =>
	b ? { x: a.x + b.x, y: a.y + b.y } : { ...a };

/** The two control points of the segment from `a` to `b`. */
export function controlsOf(a: PathPoint, b: PathPoint): [Point, Point] {
	return [add(a, a.out), add(b, b.in)];
}

export const isCurved = (a: PathPoint, b: PathPoint): boolean =>
	a.out !== undefined || b.in !== undefined;

/**
 * Where a cubic reaches its extremes on one axis.
 *
 * Only the anchors are guaranteed to be *on* the curve — a control point pulls
 * it without being reached — so bounding a curve by its control hull would
 * draw a selection box visibly larger than the shape. The real extremes are
 * the roots of the derivative, which is a quadratic.
 */
function cubicExtremes(p0: number, c1: number, c2: number, p3: number): number[] {
	const out = [p0, p3];
	const a = -p0 + 3 * c1 - 3 * c2 + p3;
	const b = 2 * (p0 - 2 * c1 + c2);
	const c = c1 - p0;
	const at = (t: number) => {
		const u = 1 - t;
		return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3;
	};
	const consider = (t: number) => {
		if (t > 0 && t < 1) out.push(at(t));
	};
	if (Math.abs(a) < 1e-9) {
		if (Math.abs(b) > 1e-9) consider(-c / b);
	} else {
		const disc = b * b - 4 * a * c;
		if (disc >= 0) {
			const root = Math.sqrt(disc);
			consider((-b + root) / (2 * a));
			consider((-b - root) / (2 * a));
		}
	}
	return out;
}

/** The exact box a path occupies, curves included. */
export function pathBounds(
	points: readonly PathPoint[],
	closed = false,
): Frame | null {
	if (points.length === 0) return null;
	const xs: number[] = [];
	const ys: number[] = [];
	for (const p of points) {
		xs.push(p.x);
		ys.push(p.y);
	}
	const last = closed ? points.length : points.length - 1;
	for (let i = 0; i < last; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		if (!isCurved(a, b)) continue;
		const [c1, c2] = controlsOf(a, b);
		xs.push(...cubicExtremes(a.x, c1.x, c2.x, b.x));
		ys.push(...cubicExtremes(a.y, c1.y, c2.y, b.y));
	}
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** The SVG `d` for a path's points. */
export function pathData(
	points: readonly PathPoint[],
	closed = false,
): string {
	if (points.length === 0) return "";
	let d = `M ${points[0].x} ${points[0].y}`;
	const last = closed ? points.length : points.length - 1;
	for (let i = 0; i < last; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		const closing = closed && i === points.length - 1;
		if (!isCurved(a, b)) {
			// Z already draws the straight segment home; a line to the start
			// followed by Z is the same edge twice, which shows up as a doubled
			// join under a thick stroke.
			if (!closing) d += ` L ${b.x} ${b.y}`;
			continue;
		}
		const [c1, c2] = controlsOf(a, b);
		d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
	}
	return closed ? `${d} Z` : d;
}

/** Smallest frame containing every point, or null when there are none. */
export function pointsBounds(points: readonly Point[]): Frame | null {
	if (points.length === 0) return null;
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Points authored in a box of size `from`, re-expressed in a box of size `to`.
 *
 * This is what keeps a path's vertices and its frame describing the same
 * shape: the frame is the vertices' bounding box, so a resize that left them
 * alone would make the two disagree. An axis with no extent has nothing to
 * scale — every point sits on one line — and is carried across untouched
 * rather than divided by zero.
 */
export function scalePoints(
	points: readonly PathPoint[],
	from: { width: number; height: number },
	to: { width: number; height: number },
): PathPoint[] {
	const sx = from.width === 0 ? 1 : to.width / from.width;
	const sy = from.height === 0 ? 1 : to.height / from.height;
	if (sx === 1 && sy === 1) return [...points];
	const scale = (p: Point | undefined) =>
		p === undefined ? undefined : { x: p.x * sx, y: p.y * sy };
	return points.map((p) => {
		const next: PathPoint = { x: p.x * sx, y: p.y * sy };
		// Handles are offsets, so they stretch with the shape rather than
		// staying put and flattening the curve they describe.
		const i = scale((p as PathPoint).in);
		const o = scale((p as PathPoint).out);
		if (i) next.in = i;
		if (o) next.out = o;
		return next;
	});
}

/** Normalises a drag between two corners into a positive-size frame. */
export function frameFromPoints(a: Point, b: Point): Frame {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(b.x - a.x),
		height: Math.abs(b.y - a.y),
	};
}

/**
 * Applies a resize by dragging `handle` by (dx, dy).
 *
 * Dragging a side past its opposite flips the frame rather than producing a
 * negative size, which is what every direct-manipulation tool does.
 */
export function resizeFrame(
	start: Frame,
	handle: Handle,
	dx: number,
	dy: number,
): Frame {
	let { x, y, width, height } = start;

	if (handle.includes("w")) {
		x = start.x + dx;
		width = start.width - dx;
	}
	if (handle.includes("e")) {
		width = start.width + dx;
	}
	if (handle.includes("n")) {
		y = start.y + dy;
		height = start.height - dy;
	}
	if (handle.includes("s")) {
		height = start.height + dy;
	}

	if (width < 0) {
		x += width;
		width = -width;
	}
	if (height < 0) {
		y += height;
		height = -height;
	}
	return { x, y, width, height };
}

/** Rounds to whole pixels and enforces a minimum size. */
export function normaliseFrame(frame: Frame): Frame {
	return {
		x: Math.round(frame.x),
		y: Math.round(frame.y),
		width: Math.max(MIN_NODE_SIZE, Math.round(frame.width)),
		height: Math.max(MIN_NODE_SIZE, Math.round(frame.height)),
	};
}

/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */

export interface SnapGuide {
	axis: "x" | "y";
	/** Canvas coordinate the guide sits on. */
	at: number;
	/** Span to draw, so the guide reaches both the moved and matched edges. */
	from: number;
	to: number;
}

export interface SnapResult {
	frame: Frame;
	guides: SnapGuide[];
}

export interface SnapOptions {
	/** Frames to align against — everything except what is being dragged. */
	targets: readonly Frame[];
	/**
	 * The enclosing frame, so its edges and centre attract too. Omitted when
	 * a node sits directly on the canvas.
	 */
	container?: Frame;
	/** Screen-independent tolerance, in canvas pixels. */
	threshold?: number;
	/** Fall back to this grid when nothing else is near. 0 disables. */
	grid?: number;
}

function edgesOf(frame: Frame) {
	return {
		x: [frame.x, frame.x + frame.width / 2, frame.x + frame.width],
		y: [frame.y, frame.y + frame.height / 2, frame.y + frame.height],
	};
}

/**
 * Nudges `frame` onto nearby edges and centres.
 *
 * Object snapping is tried first and only falls back to the grid when nothing
 * is in range, so aligning to a neighbour always beats aligning to nothing.
 * `moving` controls which of the frame's own edges may be snapped: when
 * resizing, only the dragged side should move.
 */
export function snapFrame(
	frame: Frame,
	options: SnapOptions,
	moving: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean } = {
		left: true,
		right: true,
		top: true,
		bottom: true,
	},
): SnapResult {
	const threshold = options.threshold ?? 6;
	const grid = options.grid ?? 8;
	const guides: SnapGuide[] = [];

	const candidatesX: number[] = [];
	const candidatesY: number[] = [];
	if (options.container) {
		const c = options.container;
		candidatesX.push(c.x, c.x + c.width / 2, c.x + c.width);
		candidatesY.push(c.y, c.y + c.height / 2, c.y + c.height);
	}
	for (const target of options.targets) {
		const e = edgesOf(target);
		candidatesX.push(...e.x);
		candidatesY.push(...e.y);
	}

	const own = edgesOf(frame);
	// Which of our own edges are eligible, as [value, offsetFromFrameOrigin].
	const ownX: Array<[number, number]> = [];
	if (moving.left !== false) ownX.push([own.x[0], 0]);
	if (moving.left !== false && moving.right !== false)
		ownX.push([own.x[1], frame.width / 2]);
	if (moving.right !== false) ownX.push([own.x[2], frame.width]);

	const ownY: Array<[number, number]> = [];
	if (moving.top !== false) ownY.push([own.y[0], 0]);
	if (moving.top !== false && moving.bottom !== false)
		ownY.push([own.y[1], frame.height / 2]);
	if (moving.bottom !== false) ownY.push([own.y[2], frame.height]);

	function best(
		edges: ReadonlyArray<[number, number]>,
		candidates: readonly number[],
	): { delta: number; at: number } | null {
		let found: { delta: number; at: number } | null = null;
		for (const [value] of edges) {
			for (const candidate of candidates) {
				const delta = candidate - value;
				if (Math.abs(delta) > threshold) continue;
				if (!found || Math.abs(delta) < Math.abs(found.delta)) {
					found = { delta, at: candidate };
				}
			}
		}
		return found;
	}

	const next = { ...frame };
	const snapX = best(ownX, candidatesX);
	const snapY = best(ownY, candidatesY);

	if (snapX) {
		applyDelta(next, "x", snapX.delta, moving);
		const span = options.container;
		guides.push({
			axis: "x",
			at: snapX.at,
			from: Math.min(next.y, span?.y ?? next.y),
			to: Math.max(next.y + next.height, span ? span.y + span.height : next.y + next.height),
		});
	} else if (grid > 0) {
		applyDelta(next, "x", roundTo(next.x, grid) - next.x, moving);
	}

	if (snapY) {
		applyDelta(next, "y", snapY.delta, moving);
		const span = options.container;
		guides.push({
			axis: "y",
			at: snapY.at,
			from: Math.min(next.x, span?.x ?? next.x),
			to: Math.max(next.x + next.width, span ? span.x + span.width : next.x + next.width),
		});
	} else if (grid > 0) {
		applyDelta(next, "y", roundTo(next.y, grid) - next.y, moving);
	}

	return { frame: next, guides };
}

function roundTo(value: number, step: number): number {
	return Math.round(value / step) * step;
}

/** Moving both edges translates; moving one edge resizes. */
function applyDelta(
	frame: Frame,
	axis: "x" | "y",
	delta: number,
	moving: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean },
): void {
	if (delta === 0) return;
	if (axis === "x") {
		const both = moving.left !== false && moving.right !== false;
		if (both) frame.x += delta;
		else if (moving.left !== false) {
			frame.x += delta;
			frame.width -= delta;
		} else if (moving.right !== false) {
			frame.width += delta;
		}
	} else {
		const both = moving.top !== false && moving.bottom !== false;
		if (both) frame.y += delta;
		else if (moving.top !== false) {
			frame.y += delta;
			frame.height -= delta;
		} else if (moving.bottom !== false) {
			frame.height += delta;
		}
	}
}

/** Which frame edges a handle drags, for {@link snapFrame}. */
export function handleEdges(handle: Handle) {
	return {
		left: handle.includes("w"),
		right: handle.includes("e"),
		top: handle.includes("n"),
		bottom: handle.includes("s"),
	};
}
