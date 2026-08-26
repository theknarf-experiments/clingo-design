/**
 * The lines a design is ruled with, where the canvas can draw them and the
 * pointer can catch them.
 *
 * Margins, column and row lines, and the guides a designer pulled out of a
 * ruler are all one thing by the time they get here: a datum, standing at one
 * coordinate in the canvas's own space, with a name a rule can be written
 * about. That is the point of the whole feature — a snap that lands on one of
 * these can become an `align` over `[card, cg(page,3,left)]`, with a switch and
 * a place in an unsat core, rather than a nudge nobody can see afterwards.
 *
 * **Where a line falls is read out of the answer set and nowhere else.** The
 * document holds the grid's *settings* — four margins, a count, a gutter, each
 * of them a value that may name a token and may hold alternatives — and where
 * the lines then fall is an equation the generated program solves in the
 * surface's own `wv`/`lsz`. So the line the overlay draws, the line the pointer
 * snaps to and the line a rule names are literally the same `lv(D,A)` coming
 * back from one solve. Working them out here instead would be a second
 * implementation of the track arithmetic — the exact thing the design refused to
 * build, because two answers to one question drift, and because a grid on a
 * hugging surface has no width on this side to divide.
 *
 * Exactly one thing is asked of the document instead, and {@link trackCount} is
 * where and why: how many tracks there *are* is a setting, and the answer set
 * cannot be asked it.
 *
 * {@link ruledTracks} is the one thing here that is not a line, and it is not a
 * second answer either: a track is the space between two lines that already came
 * back, so pairing them is arithmetic on the solver's own numbers rather than a
 * new source of them. It exists because the bands are what say which gaps are
 * columns and which are gutters, and lines alone cannot.
 *
 * The cost of that is honest and small: a document nobody has solved yet is a
 * document with no lines to snap to. That is the truthful report — where the
 * third of twelve columns falls is genuinely not known until the solver says —
 * and it is the same bargain `annotate.ts` strikes for its datum marks.
 */
import { type Frame, type SnapLine } from "./geometry.ts";
import {
	type Scene,
	type SceneNode,
	countOn,
	edgeOn,
	guideCount,
	guideLines,
	isGridded,
	lineDatum,
	trackDatum,
} from "./scene.ts";
import { type Placed, placedNodes } from "./tree.ts";
import type { Emu } from "./units.ts";
import type { ResolveContext } from "./values.ts";

/**
 * One line, in canvas coordinates.
 *
 * `at` is the coordinate the line stands on and `from`/`to` is the band it is
 * drawn across — the surface's own extent on the other axis, which is the same
 * choice `annotate.ts` makes for a datum mark and for the same reason: a column
 * line drawn the height of its page reads as a column line, and one drawn the
 * height of the card beside it reads as a coincidence. The two must not
 * disagree, so if one ever changes its mind the other follows.
 */
export interface RuledLine {
	/** The datum term — what a constraint stores, and what the answer set says. */
	term: string;
	/** The node it belongs to; a guide moves and duplicates with its surface. */
	surface: string;
	axis: "x" | "y";
	at: Emu;
	from: Emu;
	to: Emu;
	/**
	 * What kind of line it is, which is to say who decided where it goes.
	 *
	 * A `margin` is the outermost line of the grid on its axis, and it is called
	 * out rather than left as another track because that is the name a designer
	 * uses for it — nobody says "the lead line of the first column", they say
	 * "the left margin". It is not a different quantity: the first track's near
	 * line *is* the near margin, which is what makes both come out of one
	 * equation and neither need a special case in the program.
	 */
	role: "guide" | "margin" | "track";
	/** Which line of a hand-drawn pair; absent for the grid's own lines. */
	guide?: string;
	/** Which track, 1-based, as `1..N` grounds it; absent for a hand-drawn line. */
	index?: number;
	/** Which of the track's three lines; absent for a hand-drawn line. */
	place?: "lead" | "mid" | "trail";
	/**
	 * True when no gesture may move it. A hand-drawn line says so for itself;
	 * every line of the grid is locked, because where it falls is the answer to
	 * the settings rather than a thing to be dragged — pulling a column edge
	 * sideways is a question the arithmetic has no way to answer, since it could
	 * mean a different margin, a different gutter or a different count.
	 */
	locked: boolean;
}

/** The two ends of a frame on one axis, and the two on the other. */
const along = (frame: Frame, axis: "x" | "y") =>
	axis === "x"
		? { start: frame.x, size: frame.width }
		: { start: frame.y, size: frame.height };

const across = (frame: Frame, axis: "x" | "y") =>
	along(frame, axis === "x" ? "y" : "x");

const PLACES = ["lead", "mid", "trail"] as const;

/**
 * How many tracks this surface is cut into on this axis, in the universe being
 * read.
 *
 * **The answer set cannot be asked this**, which is worth knowing before
 * anybody tries. A responsive grid holds two counts, so the ground program
 * carries the equations for every track either of them can have, guarded by the
 * pick — but clingo-lpx reports a value for every theory variable in the
 * program whether or not this answer set constrained it. So in the two-column
 * universe `lv(cg(page,4,left))` comes back all the same, at zero, which is a
 * line lying on top of the near margin and belonging to nothing. Counting the
 * `cg` terms that came back would draw it.
 *
 * A count is a *setting* rather than a derived position, so asking the document
 * is not the second implementation this module refuses to have: it is the same
 * `resolveValue` walk the compiler's own `g_value/3` does, given the same picks.
 * Where the lines then *fall* is still the solver's answer and nothing else's.
 */
function trackCount(
	node: SceneNode,
	axis: "x" | "y",
	context: ResolveContext | undefined,
): number {
	return guideCount(node, countOn(axis), context);
}

/** Where a datum stands on the canvas, given its surface's placement. */
function lineAt(
	term: string,
	on: Placed,
	axis: "x" | "y",
	solved: Readonly<Record<string, Partial<Frame>>>,
): Omit<RuledLine, "term" | "surface" | "role" | "locked"> | undefined {
	// `lv(D,A)` — the datum's place in its surface's own coordinates, the same
	// space a child's frame is in, so the surface's world origin is all it takes
	// to put it on the canvas.
	const local = solved[term]?.[axis];
	if (local === undefined) return undefined;
	const band = across(on.world, axis);
	return {
		axis,
		at: along(on.world, axis).start + local,
		from: band.start,
		to: band.start + band.size,
	};
}

/**
 * Every line the document is ruled with, in paint order: each surface's column
 * lines, then its row lines, then the guides drawn on it.
 *
 * Ordered by walking the document rather than by walking the answer set, so the
 * result is stable — an overlay that redrew its lines in a different order every
 * solve would flicker, and a test that asserted on one would be asserting on
 * clingo's atom order.
 *
 * `context` is the universe on screen, and it is not optional in spirit even
 * though it is in the signature: it is what says how many tracks this grid has
 * here — see {@link trackCount} — so a caller drawing one universe while
 * resolving another gets that universe's grid. Without one the first
 * alternative of each setting is read, which is right for an unsolved preview
 * and nothing else.
 *
 * A node whose id happens to parse as a datum term keeps its own geometry: this
 * only ever asks the answer set about terms it built itself out of the
 * document's grids and lines, so there is nothing here for such a node to
 * collide with.
 */
export function ruledLines(
	scene: Scene,
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	context?: ResolveContext,
): RuledLine[] {
	const out: RuledLine[] = [];
	for (const on of placedNodes(scene.nodes, solved, context)) {
		const node: SceneNode = on.node;
		if (isGridded(node)) {
			for (const axis of ["x", "y"] as const) {
				const count = trackCount(node, axis, context);
				for (let index = 1; index <= count; index++) {
					for (const place of PLACES) {
						const term = trackDatum(node.id, index, edgeOn(axis, place));
						const found = lineAt(term, on, axis, solved);
						if (!found) continue;
						out.push({
							...found,
							term,
							surface: node.id,
							// The outermost lines of the grid are the margins, and
							// there is nothing to compute: the first track's near line
							// and the last track's far line are exactly where the two
							// margins put them.
							role:
								(index === 1 && place === "lead") ||
								(index === count && place === "trail")
									? "margin"
									: "track",
							index,
							place,
							locked: true,
						});
					}
				}
			}
		}
		for (const guide of guideLines(node)) {
			const term = lineDatum(node.id, guide.id);
			const found = lineAt(term, on, guide.axis, solved);
			if (!found) continue;
			out.push({
				...found,
				term,
				surface: node.id,
				role: "guide",
				guide: guide.id,
				locked: guide.locked === true,
			});
		}
	}
	return out;
}

/**
 * One track of a grid, as the rectangle it covers.
 *
 * A track is the space between two of the lines above and nothing more, which
 * is why this is derived from them rather than emitted beside them: the near and
 * far line of column three *are* where column three begins and ends, so pairing
 * them cannot disagree with what is drawn, and there is still exactly one place
 * the arithmetic happens and it is the solver.
 *
 * It exists because a fence of identical lines does not say which gaps are
 * columns and which are gutters — the one thing a designer needs from a grid at
 * a glance. Twelve columns is twelve bands and eleven gutters, and with lines
 * alone that is twenty-three indistinguishable stripes.
 */
export interface RuledTrack {
	/** The node whose grid this is a track of. */
	surface: string;
	/** The axis it is cut along: a column divides `x`, a row divides `y`. */
	axis: "x" | "y";
	/** Which track, 1-based, as `1..N` grounds it. */
	index: number;
	/**
	 * How many tracks this axis is cut into — so a caller can tell a division
	 * from the absence of one without counting the list. A count of one is the
	 * live area itself rather than a column of it, and an overlay that shaded it
	 * would wash the whole page for a grid that divides nothing.
	 */
	count: number;
	/**
	 * The rectangle it covers, in canvas coordinates: the track's own extent
	 * along its axis, and the surface's whole extent across it — the same band
	 * {@link RuledLine} is drawn across, taken from the very lines that bound it.
	 */
	area: Frame;
}

/** A track's two ends, while they are being collected. */
interface Ends {
	lead?: RuledLine;
	trail?: RuledLine;
}

/** The rectangle with this extent along `axis` and that one across it. */
const areaOf = (
	axis: "x" | "y",
	along: { from: Emu; to: Emu },
	across: { from: Emu; to: Emu },
): Frame =>
	axis === "x"
		? {
				x: along.from,
				y: across.from,
				width: along.to - along.from,
				height: across.to - across.from,
			}
		: {
				x: across.from,
				y: along.from,
				width: across.to - across.from,
				height: along.to - along.from,
			};

/**
 * Every track of every grid, out of a set of lines already read.
 *
 * In {@link ruledLines}' own order — each surface's columns, then its rows — and
 * for the same reason: an overlay that reordered its bands every solve would
 * flicker, and the order it reorders to would be clingo's.
 *
 * A track only comes back when both of its lines did. That is not defensive
 * tidiness: it is what makes a half-read answer set draw nothing rather than
 * draw a column running from a real line to the origin.
 */
export function ruledTracks(lines: readonly RuledLine[]): RuledTrack[] {
	// Surface, then axis, then index — nested rather than keyed on a joined
	// string, because a surface id is an ASP term and may hold any punctuation a
	// separator could have been.
	const found = new Map<string, Map<"x" | "y", Map<number, Ends>>>();
	for (const line of lines) {
		if (line.index === undefined) continue;
		if (line.place !== "lead" && line.place !== "trail") continue;
		let axes = found.get(line.surface);
		if (!axes) found.set(line.surface, (axes = new Map()));
		let ends = axes.get(line.axis);
		if (!ends) axes.set(line.axis, (ends = new Map()));
		ends.set(line.index, { ...ends.get(line.index), [line.place]: line });
	}

	const out: RuledTrack[] = [];
	for (const [surface, axes] of found) {
		for (const [axis, ends] of axes) {
			const whole: Omit<RuledTrack, "count">[] = [];
			for (const index of [...ends.keys()].sort((a, b) => a - b)) {
				const { lead, trail } = ends.get(index) as Ends;
				if (!lead || !trail) continue;
				whole.push({
					surface,
					axis,
					index,
					// The band across comes off the lines themselves: a line on `x` is
					// drawn down the surface's `y`, so the pair that bounds a column
					// already carries the height the column is drawn at.
					area: areaOf(axis, { from: lead.at, to: trail.at }, lead),
				});
			}
			// Counted after the pairing rather than off the indices, so `count` is
			// always the number of tracks in this list and a caller can trust
			// `index of count` to be a sentence about what it is holding.
			for (const track of whole) out.push({ ...track, count: whole.length });
		}
	}
	return out;
}

/**
 * The same lines, as things a drag may land on.
 *
 * The rank is decided here rather than in `geometry.ts` because it is a
 * statement about *guides* — a line somebody pulled out by hand outranks one the
 * grid settings implied — and `geometry.ts` knows about rectangles and nothing
 * else. See {@link SnapRank} for what the order buys.
 *
 * A grid line and a margin rank alike. They are the same equation seen from two
 * ends, and a designer aiming at the left margin is aiming at exactly the line
 * that column one begins on, so preferring one over the other would be picking a
 * winner between two names for one number.
 */
export const snapLines = (lines: readonly RuledLine[]): SnapLine[] =>
	lines.map((line) => ({
		axis: line.axis,
		at: line.at,
		rank: line.role === "guide" ? "drawn" : "ruled",
		id: line.term,
	}));

/**
 * The line a term names, out of a set already read — what the editor asks after
 * a snap, to say what was caught.
 */
export const findLine = (
	lines: readonly RuledLine[],
	term: string | undefined,
): RuledLine | undefined =>
	term === undefined ? undefined : lines.find((l) => l.term === term);
