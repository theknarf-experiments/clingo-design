/**
 * Rectangle maths for the canvas: hit testing, resize handles and snapping.
 *
 * Pure and framework-free, so the tricky parts — which are the ones that make
 * dragging feel right or wrong — are testable without a browser.
 *
 * **Every number in this file is EMU** — see `units.ts`. Nothing here converts:
 * a {@link Frame} arrives from `frameOf` in EMU and leaves in EMU, and the
 * pointer deltas a gesture adds to one crossed over from float CSS pixels once,
 * at the canvas edge, through `emuFromCssPx`.
 *
 * That makes the three plain numbers below the whole risk of the move. Each is a
 * statement about a hand and an eye rather than about a document — four pixels
 * is the smallest thing worth dragging, six is how near your aim has to come —
 * so each is a pixel count *times* {@link EMU_PER_PX} and none of them is
 * allowed to stay a bare 4, 6 or 8. Left alone they would have failed silently
 * and in the worst direction: a minimum size of 4 EMU is four ten-thousandths of
 * a pixel, so it stops existing, and a snap threshold of 6 EMU is never met by
 * anything, so object snapping simply never fires again and nobody gets an
 * error to read.
 */
import { EMU_PER_PX, quantizeGesture, wholeEmu } from "./units.ts";

export interface Point {
	x: number;
	y: number;
}

/** Position and size in EMU, relative to whatever the node is placed in. */
export interface Frame {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Smallest a node may be dragged down to: four pixels, as EMU. */
export const MIN_NODE_SIZE = 4 * EMU_PER_PX;

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

/**
 * The frame grown by `by` EMU on every side. Negative shrinks, never past zero.
 */
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

/**
 * The SVG `d` for a path's points, in whatever unit the points are in.
 *
 * Which is EMU, like everything else here — so a caller drawing this into a
 * browser has to hand over points already crossed to CSS pixels, exactly as it
 * does for every other coordinate it paints. This module does not convert; it
 * would be the one place that did.
 */
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

/**
 * Puts a gesture on a whole pixel and enforces a minimum size.
 *
 * The rounding used to be load-bearing for a different reason: `frame/3` reached
 * ASP through a `Math.round`, so a fractional number in the document would have
 * put the canvas and the solver a sub-pixel apart. That reason is gone — EMU are
 * integers by the time the parser is done with them — and this is what is left,
 * which is a claim about the pointer rather than about the compiler. A hand
 * moving a mouse means a pixel; without a quantum here every drag would write a
 * length like `10.4px` into a shared document and fill its history with
 * sub-pixel noise. See `quantizeGesture`, which is deliberately not the same
 * thing as a unit's spellability lattice.
 */
export function normaliseFrame(frame: Frame): Frame {
	return {
		x: quantizeGesture(frame.x),
		y: quantizeGesture(frame.y),
		width: Math.max(MIN_NODE_SIZE, quantizeGesture(frame.width)),
		height: Math.max(MIN_NODE_SIZE, quantizeGesture(frame.height)),
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
	/**
	 * What was caught, when the thing caught had a name — see {@link SnapLine}.
	 *
	 * Absent for an ordinary edge, because there is nothing to say about it: two
	 * boxes lining up is a fact about where they happen to be. A line has an
	 * identity in the document, so a caller holding this can turn what the hand
	 * just did into something the document says. That is the whole reason the
	 * snapping knows about lines at all.
	 */
	id?: string;
	/**
	 * Which of the moved frame's own places landed on it: its near edge, its
	 * middle or its far edge. Named the way {@link SnapLine} is rather than as an
	 * `Edge`, because this module knows nothing about `EDGES` — but the words are
	 * the same words, so `edgeOn(guide.axis, guide.place)` is the rule a caller
	 * would write.
	 */
	place?: "lead" | "mid" | "trail";
}

/**
 * **What may catch a dragged edge, strongest first.**
 *
 * The order is the point, and it is not a tie-break rule — a stronger line wins
 * even when a weaker one is *nearer*. What separates the tiers is how much
 * somebody meant it:
 *
 * | rank     | what it is                        | who said so                        |
 * | -------- | --------------------------------- | ---------------------------------- |
 * | `drawn`  | a line a designer pulled out       | a person, for this exact purpose   |
 * | `ruled`  | a margin or a column line          | the document, as a grid setting    |
 * | `object` | another node's edge or centre      | nobody — it is where things landed |
 *
 * A hand-drawn guide beats a column line because pulling one out is a thing you
 * do *when the grid is not what you want*; both beat an object edge because a
 * card that happens to line up with the card above it is a coincidence, and a
 * coincidence a pixel nearer should not steal the drop from the column the
 * designer was aiming at. Below all three sits the fallback grid, which is not a
 * rank at all: it only fires when nothing was caught, because aligning to
 * something always beats aligning to nothing.
 */
export type SnapRank = "drawn" | "ruled" | "object";

const RANKS: Record<SnapRank, number> = { drawn: 3, ruled: 2, object: 1 };

/**
 * One line to snap against — a hand-drawn guide, a margin, a column edge.
 *
 * In the same absolute coordinates the frames are, because that is where the
 * pointer is. `id` is what the caller gets back on {@link SnapGuide} when this
 * line is the one that caught, and in this codebase it is a datum term.
 */
export interface SnapLine {
	axis: "x" | "y";
	at: number;
	rank: SnapRank;
	id?: string;
}

export interface SnapResult {
	frame: Frame;
	guides: SnapGuide[];
}

/**
 * How near an edge has to come before it is caught: six pixels, as EMU.
 *
 * A tolerance is about aim, not about the design, which is why it is stated in
 * pixels and why it is *not* scaled by the camera — zoom in far enough and six
 * canvas pixels is a hair on screen. That was already true before EMU and is
 * left alone here deliberately: the fix is to divide by the camera scale at the
 * one call site that has a camera, and doing it inside a pure module would mean
 * passing one in.
 */
export const SNAP_THRESHOLD = 6 * EMU_PER_PX;

/** The lattice a gesture falls back to when nothing is near: eight pixels, as EMU. */
export const SNAP_GRID = 8 * EMU_PER_PX;

export interface SnapOptions {
	/** Frames to align against — everything except what is being dragged. */
	targets: readonly Frame[];
	/**
	 * The enclosing frame, so its edges and centre attract too. Omitted when
	 * a node sits directly on the canvas.
	 */
	container?: Frame;
	/**
	 * Lines to align against, over and above the frames — see {@link SnapLine}.
	 *
	 * Separate from `targets` rather than folded in as a zero-width frame, and
	 * that is worth a sentence: a frame contributes three candidates on each of
	 * two axes and has no name, while a line contributes one on one axis and has
	 * one. Squeezing a line into a frame would mean six candidates where one was
	 * meant, five of them on quantities the line has no opinion about.
	 */
	lines?: readonly SnapLine[];
	/** Screen-independent tolerance in EMU — {@link SNAP_THRESHOLD} by default. */
	threshold?: number;
	/** Fall back to this grid when nothing else is near, in EMU. 0 disables. */
	grid?: number;
}

/** One thing a dragged edge may land on, with how much it was meant. */
interface Candidate {
	at: number;
	rank: SnapRank;
	id?: string;
}

function edgesOf(frame: Frame) {
	return {
		x: [frame.x, frame.x + frame.width / 2, frame.x + frame.width],
		y: [frame.y, frame.y + frame.height / 2, frame.y + frame.height],
	};
}

/**
 * Nudges `frame` onto nearby lines, edges and centres.
 *
 * Everything in range is tried first and only falls back to the grid when
 * nothing is, so aligning to something always beats aligning to nothing. Among
 * the things in range it is {@link SnapRank} that decides, and only then the
 * distance — a line somebody drew outranks a box that happens to be a pixel
 * nearer. `moving` controls which of the frame's own edges may be snapped: when
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
	const threshold = options.threshold ?? SNAP_THRESHOLD;
	const grid = options.grid ?? SNAP_GRID;
	const guides: SnapGuide[] = [];

	const candidatesX: Candidate[] = [];
	const candidatesY: Candidate[] = [];
	if (options.container) {
		const c = options.container;
		for (const at of [c.x, c.x + c.width / 2, c.x + c.width]) {
			candidatesX.push({ at, rank: "object" });
		}
		for (const at of [c.y, c.y + c.height / 2, c.y + c.height]) {
			candidatesY.push({ at, rank: "object" });
		}
	}
	for (const target of options.targets) {
		const e = edgesOf(target);
		for (const at of e.x) candidatesX.push({ at, rank: "object" });
		for (const at of e.y) candidatesY.push({ at, rank: "object" });
	}
	for (const line of options.lines ?? []) {
		const into = line.axis === "x" ? candidatesX : candidatesY;
		into.push({ at: line.at, rank: line.rank, id: line.id });
	}

	const own = edgesOf(frame);
	// Which of our own edges are eligible, as [value, offsetFromFrameOrigin], and
	// which place on the node each of them is — the third field is what lets a
	// caught line say *what* landed on it, which is the difference between "these
	// two numbers agree" and "this card's centre is on column three".
	type Own = [number, number, "lead" | "mid" | "trail"];
	const ownX: Own[] = [];
	if (moving.left !== false) ownX.push([own.x[0], 0, "lead"]);
	if (moving.left !== false && moving.right !== false)
		ownX.push([own.x[1], frame.width / 2, "mid"]);
	if (moving.right !== false) ownX.push([own.x[2], frame.width, "trail"]);

	const ownY: Own[] = [];
	if (moving.top !== false) ownY.push([own.y[0], 0, "lead"]);
	if (moving.top !== false && moving.bottom !== false)
		ownY.push([own.y[1], frame.height / 2, "mid"]);
	if (moving.bottom !== false) ownY.push([own.y[2], frame.height, "trail"]);

	interface Hit {
		delta: number;
		at: number;
		id?: string;
		place: "lead" | "mid" | "trail";
		rank: SnapRank;
	}

	/**
	 * The strongest thing in range, and among equals the nearest.
	 *
	 * Written as a comparison rather than as a filtered pass per rank because a
	 * rank that catches nothing must not stop a weaker one that does: "the
	 * nearest of the strongest that caught anything" is one loop, and "the
	 * strongest rank, then the nearest within it" is two loops with a bug in the
	 * empty case.
	 */
	function best(edges: readonly Own[], candidates: readonly Candidate[]): Hit | null {
		let found: Hit | null = null;
		for (const [value, , place] of edges) {
			for (const candidate of candidates) {
				const delta = candidate.at - value;
				if (Math.abs(delta) > threshold) continue;
				const better =
					!found ||
					RANKS[candidate.rank] > RANKS[found.rank] ||
					(RANKS[candidate.rank] === RANKS[found.rank] &&
						Math.abs(delta) < Math.abs(found.delta));
				if (better) {
					found = {
						delta,
						at: candidate.at,
						id: candidate.id,
						place,
						rank: candidate.rank,
					};
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
			id: snapX.id,
			place: snapX.place,
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
			id: snapY.id,
			place: snapY.place,
		});
	} else if (grid > 0) {
		applyDelta(next, "y", roundTo(next.y, grid) - next.y, moving);
	}

	return { frame: next, guides };
}

/**
 * The nearest multiple of `step` — how the fallback grid catches a value.
 *
 * `wholeEmu` does the rounding, and what it is rounding is a count of grid steps
 * rather than a length. It is here anyway because the tie rule is the whole
 * question at exactly half a step out, and the tree should hold one of those:
 * `units.ts` breaks ties away from zero, so a frame nudged onto the grid and the
 * same frame written into the document agree about which way half goes.
 */
function roundTo(value: number, step: number): number {
	return wholeEmu(value / step) * step;
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
