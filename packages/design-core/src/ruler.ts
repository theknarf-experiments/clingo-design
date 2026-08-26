/**
 * A ruler's ticks: where they fall, what they read, and how fine they get.
 *
 * A ruler looks like chrome and is arithmetic. The chrome — two strips down the
 * canvas's edges, a corner to drag the zero point out of — is a browser
 * question and belongs to the app. What is *marked* is a document question: it
 * depends on the unit the document is set to and on where the designer put
 * zero, and neither of those is something a generic pan/zoom canvas may be
 * taught. So the arithmetic is here, pure, with no notion of a strip, a pixel
 * of chrome or a DOM node, and `packages/canvas` learns nothing.
 *
 * The whole problem is choosing a step, and it has two halves that pull against
 * each other. The labels must not collide, which is a claim about screen pixels
 * and therefore about the camera. And the step must be a number a person reads
 * without arithmetic — 20mm, a quarter of an inch, 100px — which is a claim
 * about the unit and nothing else. A single "round to a nice number" rule
 * cannot serve both, because **the inch does not divide by ten**: a decimal
 * ladder run over inches marks fifths, which no ruler on any desk has ever
 * done. So {@link RULER_STEPS} is a ladder per unit, in the KINDS/PROPS idiom,
 * and choosing a step is a lookup: the finest rung whose marks are still
 * {@link RULER_LABEL_GAP} apart on screen.
 *
 * The ladders are finite, and they are allowed to be. The step depends only on
 * the camera's scale, the camera clamps its scale (`DEFAULT_LIMITS` in
 * canvas-core, 0.1 to 3), so the set of steps that can ever be asked for is
 * bounded — which is a claim a test can make rather than a hope. They carry a
 * rung or two past the coarse end of that range on purpose, so that pulling the
 * camera's limit further out makes the ruler coarser rather than silently
 * making the labels collide. The fine end is not headroom but a wall: half a
 * pixel is 4762.5 EMU and 9525 is odd, so a pixel ladder cannot go below one
 * pixel without marking a place no document could hold.
 *
 * The unlabelled marks between the labels are derived from the same ladder
 * rather than given a column of their own: the finest rung that divides the
 * step and still leaves the marks {@link RULER_MINOR_GAP} apart. That one
 * sentence is what makes an inch ruler mark sixteenths at 100% and a pixel
 * ruler mark tens, and a column of hand-tuned division counts is a column that
 * would disagree with the ladder above it the first time a rung was added.
 *
 * One property is worth stating because it is free and would be missed: every
 * rung is a whole number of EMU that its own unit can spell exactly, because
 * `914400` is divisible by every subdivision written below. A tick therefore
 * always falls on a coordinate the document could really hold — the ruler never
 * marks a place a node could not be put.
 */
import { type Emu, type Unit, UNITS, cssPxFromEmu } from "./units.ts";

/**
 * The unit-sized quantities the ladders are written in. Spelled out here so a
 * rung reads as `IN / 16` rather than as `57150`, which is the same number and
 * a worse sentence.
 */
const PX = UNITS.px.per;
const PT = UNITS.pt.per;
const PC = UNITS.pc.per;
const MM = UNITS.mm.per;
const CM = UNITS.cm.per;
const IN = UNITS.in.per;

/**
 * The steps each unit is read in, finest first.
 *
 * Decimal where the unit is decimal, and not where it is not. Pixels, points
 * and millimetres run 1-2-5 through the decades because that is how anyone
 * reads them; a pica is twelve points, so it runs 1-2-6-12; an inch halves
 * downward and counts upward by threes and sixes, because a foot is twelve
 * inches and a yard is thirty-six, and past a yard it simply doubles. The
 * centimetre's fine rungs are millimetres, which is not a coincidence to be
 * factored out — it is what a centimetre ruler is marked in.
 *
 * `emu` has a row because the table is total, which is the point of a table:
 * a unit cannot be added to {@link UNITS} without someone deciding how it is
 * read. A document set to EMU is a document being debugged, and it gets a
 * decimal ladder because there is nothing else EMU could mean.
 */
export const RULER_STEPS: Record<Unit, readonly Emu[]> = {
	px: [PX, 2 * PX, 5 * PX, 10 * PX, 20 * PX, 50 * PX, 100 * PX, 200 * PX, 500 * PX, 1000 * PX, 2000 * PX, 5000 * PX],
	pt: [PT, 2 * PT, 5 * PT, 10 * PT, 20 * PT, 50 * PT, 100 * PT, 200 * PT, 500 * PT, 1000 * PT, 2000 * PT, 5000 * PT],
	pc: [PC, 2 * PC, 6 * PC, 12 * PC, 24 * PC, 60 * PC, 120 * PC, 240 * PC, 600 * PC],
	mm: [MM, 2 * MM, 5 * MM, 10 * MM, 20 * MM, 50 * MM, 100 * MM, 200 * MM, 500 * MM, 1000 * MM],
	cm: [CM / 10, CM / 5, CM / 2, CM, 2 * CM, 5 * CM, 10 * CM, 20 * CM, 50 * CM, 100 * CM],
	in: [IN / 16, IN / 8, IN / 4, IN / 2, IN, 2 * IN, 3 * IN, 6 * IN, 12 * IN, 24 * IN, 36 * IN, 72 * IN, 144 * IN],
	emu: [1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7],
};

/**
 * How much screen a labelled tick is given, in CSS pixels.
 *
 * Wide enough for the longest label a ladder can produce — `-25000`, or the
 * `0.0625` an inch ruler would show if a camera could zoom that far — with air
 * either side, because two labels that touch are two labels nobody reads.
 */
export const RULER_LABEL_GAP = 72;

/**
 * And how much an unlabelled one is given. Small: a mark is a hairline, and the
 * eye counts them rather than reading them. Below about this they close up into
 * a grey band, which is a texture rather than a ruler.
 */
export const RULER_MINOR_GAP = 6;

/**
 * A tick a ruler draws, in the document's own coordinates rather than anywhere
 * on a screen — placing it is the app's half of the job, and it needs the
 * camera to do it.
 */
export interface RulerTick {
	/** Where it falls, in the document's coordinates. */
	at: Emu;
	/**
	 * What it reads: the distance from the zero point, in the display unit, as
	 * a bare number. The unit is said once on the ruler's corner rather than
	 * thirty times down its length.
	 */
	label: string;
}

export interface Ruler {
	/** How far apart the labelled ticks are. */
	step: Emu;
	/**
	 * How far apart the unlabelled ones are, which divides {@link step}. Equal
	 * to `step` when the ladder has nothing fine enough to offer, which is the
	 * honest spelling of "no minor ticks".
	 */
	minor: Emu;
	/** The labelled ticks across the span asked for, in ascending order. */
	ticks: readonly RulerTick[];
}

export interface RulerSpan {
	/** The document coordinate at one end of the ruler… */
	from: Emu;
	/** …and at the other. Either order; a ruler has no direction. */
	to: Emu;
	/**
	 * Where the designer put zero, in the document's own coordinates. Every
	 * label is a distance from here, and every tick is a whole number of steps
	 * from here — so moving it moves the marks and not merely their captions.
	 */
	zero: Emu;
	/** What the ticks are read in: the document's display unit. */
	unit: Unit;
	/**
	 * The camera's zoom — CSS pixels of screen per CSS pixel of document. The
	 * only thing about the camera this module knows, and all it needs: where the
	 * camera is looking arrives as {@link from} and {@link to}.
	 */
	scale: number;
}

/**
 * A ceiling on how many ticks come back.
 *
 * Unreachable through the camera — its scale is clamped, so the step is never
 * more than a few times finer than the span being asked about — and here
 * because a caller that has not clamped anything (a scale of zero, a span of a
 * mile) should get a coarse ruler rather than a hung tab.
 */
const TICK_LIMIT = 512;

/** How wide a length is on screen, in CSS pixels, at this zoom. */
const onScreen = (emu: Emu, scale: number): number => cssPxFromEmu(emu) * scale;

/**
 * The step this unit is read in at this zoom, and the finer marks under it.
 *
 * The finest rung whose labels still clear {@link RULER_LABEL_GAP}, falling
 * back to the coarsest rung the ladder has when nothing does — that is the
 * clamp the ladders are sized to avoid, and a test pins that it never fires
 * inside the camera's own limits. A scale that is zero, negative or not a
 * number lands there too, which is why the fallback is the coarse end rather
 * than the fine one: a ruler nobody can read is better than a million ticks.
 */
export function rulerStep(unit: Unit, scale: number): { step: Emu; minor: Emu } {
	const ladder = RULER_STEPS[unit];
	const step =
		ladder.find((rung) => onScreen(rung, scale) >= RULER_LABEL_GAP) ??
		ladder[ladder.length - 1];
	return { step, minor: minorFor(ladder, step, scale) };
}

/**
 * The finest rung that divides the step and is still worth drawing.
 *
 * Divides, because a mark that does not land on the next label is a mark that
 * lies about where the label is: 20px under a 50px step would put ticks at 20
 * and 40 and then a label at 50. Finest rather than coarsest, because that is
 * the difference between an inch ruler marked in halves and one marked in
 * sixteenths, and the sixteenths are the reason anyone looks at an inch ruler.
 */
function minorFor(ladder: readonly Emu[], step: Emu, scale: number): Emu {
	for (const rung of ladder) {
		if (rung >= step) break;
		if (onScreen(rung, scale) >= RULER_MINOR_GAP && step % rung === 0) return rung;
	}
	return step;
}

/**
 * How many decimals a label needs, which is a property of the step and of
 * nothing else.
 *
 * The smallest number of them that writes the step exactly: a quarter-inch
 * ladder needs two, a millimetre ladder none, and a step of 1/16in — which no
 * camera this canvas allows can reach, but the ladder carries — needs four.
 * Derived rather than a column on the table for the usual reason: a column
 * would be a second statement of the same fact, free to disagree with the rung
 * beside it.
 */
function labelDecimals(step: Emu, unit: Unit): number {
	const { per } = UNITS[unit];
	for (let decimals = 0, scaled = step; decimals <= 4; decimals++, scaled *= 10) {
		if (scaled % per === 0) return decimals;
	}
	return 4;
}

/** A tick's caption: its distance from zero, in the unit, without the suffix. */
function labelAt(offset: Emu, unit: Unit, decimals: number): string {
	const fixed = (offset / UNITS[unit].per).toFixed(decimals);
	const trimmed = decimals === 0 ? fixed : fixed.replace(/\.?0+$/, "");
	// A tick a hair below zero rounds to "-0", which is true and not a caption.
	return trimmed === "-0" ? "0" : trimmed;
}

/**
 * The ruler along one axis: what to label, what to mark, and how far apart.
 *
 * One axis at a time, because the two rulers on a canvas are two rulers — they
 * see different spans of the document and, on a window that is wider than it is
 * tall, legitimately settle on different steps.
 */
export function rulerFor(span: RulerSpan): Ruler {
	const { unit, scale, zero } = span;
	const from = Math.min(span.from, span.to);
	const to = Math.max(span.from, span.to);
	const { step, minor } = rulerStep(unit, scale);
	const decimals = labelDecimals(step, unit);
	const ticks: RulerTick[] = [];
	const first = Math.ceil((from - zero) / step);
	const last = Math.floor((to - zero) / step);
	for (let k = first; k <= last && ticks.length < TICK_LIMIT; k++) {
		ticks.push({ at: zero + k * step, label: labelAt(k * step, unit, decimals) });
	}
	return { step, minor, ticks };
}
