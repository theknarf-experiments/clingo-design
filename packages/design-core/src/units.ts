/**
 * Lengths: what one is, and the units a designer is allowed to type.
 *
 * A length in this system is an integer count of **EMU** — English Metric
 * Units, 1/914400 of an inch, the unit OOXML measures a document in. The
 * number was chosen by Microsoft for exactly the reason it is chosen here:
 * 914400 is divisible by every absolute unit CSS defines, because CSS itself
 * fixes 1in = 96px = 72pt = 6pc = 25.4mm. So the conversion table below is not
 * an approximation of CSS — it *is* CSS's absolute-unit table, scaled by
 * 914400/96 — and every factor in it is a whole number. **No unit conversion
 * in this codebase rounds.**
 *
 * That is the whole point. Geometry leaves here for ASP, and clingo facts must
 * be integers: `numeral/2`, `frame/3` and the `&sum` theory atoms all want
 * integer constants and integer coefficients. Until now the integrality was
 * bought by rounding at the boundary — three `Math.round` calls in the
 * compiler and two writers in `scene.ts` — which meant the canvas (drawing the
 * document) and the solver (reading the rounded fact) could disagree by a
 * sub-pixel, and meant nothing finer than a whole pixel could be said at all.
 * With an integer EMU the integrality is a property of the *parser*, so all of
 * that rounding is deleted rather than moved.
 *
 * What EMU does not buy is a decimal a person typed. `1.5px` is 14287.5 EMU,
 * and 9525 is odd, so half a pixel is not a length — the same answer
 * {@link emuOf} already gives `50%`. That is not a unit conversion failing; it
 * is 0.1-in-binary wearing a different hat. Rounding is therefore an editorial
 * act with a name and a caller — {@link nearestEmu} at the keyboard,
 * {@link snapToUnit} on the way in from an older document — and never
 * something a conversion does behind anyone's back.
 *
 * Two functions cross between EMU and float CSS pixels, and only two:
 * {@link cssPxFromEmu} on the way out to a stylesheet or a canvas, and
 * {@link emuFromCssPx} on the way in from the text measurer and from pointer
 * deltas. The naming carries the discipline the type system deliberately does
 * not: anything holding float CSS pixels has a `Px` in its name.
 *
 * The cost, stated plainly: gringo's integers are 32-bit, and the widest
 * derived quantity in the generated program is `4*V`, so the usable range is
 * about 2^31/4 EMU — roughly 56,000 px, or a 48-foot artboard. That is a
 * narrower ceiling than the ~536M px of before and it is still far past any
 * document anyone will draw.
 */

/**
 * A length, as an integer count of 1/914400 in.
 *
 * A documentation alias rather than a branded type. A brand would demand a
 * re-cast at every `frameDim(node,"x") + dx` in `edits.ts`, `tree.ts` and
 * `geometry.ts` — TypeScript hands `number` back from adding two branded
 * numbers — and it would catch nothing those files get wrong, since both
 * operands of every one of those sums are already the same unit. The mistake
 * worth catching is mixing EMU with CSS pixels, and that one the `Px` suffix
 * makes visible at the call site.
 *
 * **Integral where stored.** Every value this module parses or writes is a
 * whole number of EMU. In flight it need not be: `edgesOf` halves a width to
 * find a centre, and clingo-lpx answers in rationals. {@link wholeEmu} is where
 * such a value becomes storable again.
 */
export type Emu = number;

export type Unit = "px" | "pt" | "pc" | "mm" | "cm" | "in" | "emu";

export interface UnitSpec {
	/** What the inspector's unit menu calls it. */
	label: string;
	/**
	 * The suffix as written in a document — `"pt"`.
	 *
	 * Equal to the key for all seven rows today, and a column anyway because one
	 * of the two is a TypeScript identifier and the other is document text.
	 * {@link formatLength} writes the symbol; nothing should be tempted to write
	 * a key.
	 */
	symbol: string;
	/** EMU in one of them. Exact, always, for the reason in the module note. */
	per: Emu;
	/**
	 * The smallest positive EMU this unit can spell exactly, and hence the
	 * lattice of values it can spell at all: `e` is exactly spellable in `u`
	 * exactly when `e % UNITS[u].step === 0`.
	 *
	 * Why that works: `e/per` has a terminating decimal expansion exactly when
	 * the reduced denominator is 2^a·5^b, so strip every 2 and 5 out of `per`
	 * and whatever is left must divide `e`. 9525 = 3·5²·127 leaves 381, so a
	 * pixel is spellable on a 0.04px lattice; 12700 = 2²·5²·127 leaves 127, so
	 * a point is spellable on a 0.01pt one — which is why a value nudged in
	 * pixels usually still writes cleanly as points. The six numbers are
	 * written down rather than factored at load: a loop nobody can read
	 * guarding six constants anyone can check is a worse trade than a comment.
	 *
	 * This is *not* the quantum a gesture writes on — see
	 * {@link quantizeGesture} for why the two must stay apart.
	 */
	step: Emu;
	/**
	 * How many decimals the inspector shows, and the one editorial column here.
	 *
	 * `per` and `step` are arithmetic and cannot be argued with; this is a
	 * judgement about what a person reading that unit wants to see, and it is
	 * allowed to be one because display never decides what is stored — that is
	 * {@link formatLength}'s job, and it works from `step`.
	 */
	decimals: number;
	/**
	 * Whether the spelling is legal CSS. False only for `emu`, which exists so
	 * that {@link formatLength} always has an exact escape: no CSS unit spells
	 * every EMU, and a document must never hold a value it cannot read back.
	 */
	css: boolean;
}

/**
 * Every unit, in one place.
 *
 * Derived from the CSS absolute-unit identities and nothing else:
 * 1in = 96px = 72pt = 6pc = 25.4mm = 2.54cm, times 914400 EMU per inch. The
 * `px` row is 96dpi because that is what CSS means by a pixel; it has nothing
 * to do with the screen this is running on.
 */
export const UNITS: Record<Unit, UnitSpec> = {
	px: { label: "Pixels", symbol: "px", per: 9525, step: 381, decimals: 2, css: true },
	pt: { label: "Points", symbol: "pt", per: 12700, step: 127, decimals: 2, css: true },
	pc: { label: "Picas", symbol: "pc", per: 152400, step: 381, decimals: 4, css: true },
	mm: {
		label: "Millimetres",
		symbol: "mm",
		per: 36000,
		step: 9,
		decimals: 5,
		css: true,
	},
	cm: {
		label: "Centimetres",
		symbol: "cm",
		per: 360000,
		step: 9,
		decimals: 5,
		css: true,
	},
	in: { label: "Inches", symbol: "in", per: 914400, step: 1143, decimals: 7, css: true },
	emu: { label: "EMU", symbol: "emu", per: 1, step: 1, decimals: 0, css: false },
};

export const UNIT_NAMES = Object.keys(UNITS) as Unit[];

/** The units a designer may be offered. `emu` is a writer's escape, not a choice. */
export const CSS_UNITS = UNIT_NAMES.filter((u) => UNITS[u].css);

/**
 * What a bare number means, what a gesture writes, and what a document without
 * a stated unit is in. Every legacy document is in pixels, so this is also the
 * migration's assumption.
 */
export const DEFAULT_UNIT: Unit = "px";

/** Read off the table, never typed twice. */
export const EMU_PER_PX = UNITS.px.per;

export const isUnit = (text: string): text is Unit => Object.hasOwn(UNITS, text);

/** True when `unit` can write `emu` exactly — see {@link UnitSpec.step}. */
export const spellsExactly = (emu: Emu, unit: Unit): boolean =>
	Number.isInteger(emu) && emu % UNITS[unit].step === 0;

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * A number with an optional unit. The space before the suffix is tolerated
 * because a person types `24 px` and means it; everything else — a percentage,
 * a `calc()`, an exponent, a colour — falls off the end of the regex and reads
 * as no length at all, which is what lets a dimension driven by it say nothing
 * instead of quietly meaning something else.
 */
const LENGTH = /^\s*([+-]?)(\d+)(?:\.(\d+))?\s*([A-Za-z]*)\s*$/;

/**
 * The exact value of a literal, as the fraction `emu / scale` EMU.
 *
 * Kept as a fraction rather than evaluated, because whether it is a length at
 * all is the question `emu % scale` answers, and a float divide throws that
 * away before anyone can ask.
 */
interface Rational {
	emu: bigint;
	scale: bigint;
}

/**
 * The suffix a literal wore, as a unit. A missing one is {@link DEFAULT_UNIT},
 * which is what every bare number and every legacy document means.
 *
 * CSS units are case-insensitive, and a document written by hand says `PX` often
 * enough that reading it as no length would be a bug report.
 */
const unitIn = (suffix: string): Unit | undefined => {
	const name = suffix === "" ? DEFAULT_UNIT : suffix.toLowerCase();
	return isUnit(name) ? name : undefined;
};

function parseLength(text: string): Rational | undefined {
	const m = LENGTH.exec(text);
	if (!m) return undefined;
	const [, sign, whole, fraction = "", suffix] = m;
	const unit = unitIn(suffix);
	if (unit === undefined) return undefined;
	const digits = BigInt(whole + fraction) * BigInt(UNITS[unit].per);
	return {
		emu: sign === "-" ? -digits : digits,
		scale: 10n ** BigInt(fraction.length),
	};
}

const MAX_EMU = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Nothing above 2^53 EMU, because past there `number` cannot hold the integer
 * and the round trip this module promises would quietly stop holding. That is
 * 150,000 miles; the gringo ceiling bites at 48 feet, long before this does.
 */
function exactNumber(n: bigint): Emu | undefined {
	return n > MAX_EMU || n < -MAX_EMU ? undefined : Number(n);
}

/**
 * The length a literal reads as, in EMU: `"24px"` is 228600, `"0.1mm"` is 3600,
 * `"12pt"` is 152400. A bare number is pixels.
 *
 * **Exact or nothing, and never rounds.** `"1.5px"` is 14287.5 EMU, so it is
 * not a length and reads as `undefined` — the same answer this has always
 * given `"50%"`, and for the same reason: a caller that gets nothing falls back
 * or stays silent, where a caller handed a plausible wrong number does not.
 * Everything this codebase writes is exact by construction (see
 * {@link formatLength}), so in practice this is total over documents it made;
 * what it is not total over is a document from before EMU, which is what the
 * migration is for.
 */
export function emuOf(text: string): Emu | undefined {
	const q = parseLength(text);
	if (!q || q.emu % q.scale !== 0n) return undefined;
	return exactNumber(q.emu / q.scale);
}

/**
 * Which unit a stored literal was written in, or nothing when it is not a
 * length at all. A bare number is {@link DEFAULT_UNIT} — see {@link emuOf}.
 *
 * Its reason for existing is that an edit must keep a designer's units: a drag
 * reads a node's x, adds a delta and writes the sum back, and it is this that
 * lets it write `"12.75pt"` rather than pixels. Deliberately separate from
 * {@link emuOf} — a caller wants the number *or* the spelling, never both, and
 * a reader that returned a pair would be answering a question nobody asked.
 */
export function unitOf(text: string): Unit | undefined {
	const m = LENGTH.exec(text);
	return m ? unitIn(m[4]) : undefined;
}

/**
 * The nearest EMU to a literal, whether or not it is one exactly.
 *
 * One of the two places rounding is allowed, and it is an editorial act rather
 * than a model operation: it belongs to the inspector's length field, where a
 * person typing `1.5px` gets 14288 EMU — the nearest storable neighbour — and
 * sees the field rewrite itself to say so. Not called by anything that reads
 * the document: a stored value is exact, or it is being migrated.
 *
 * Ties go away from zero, the same rule {@link snapToUnit} and
 * {@link wholeEmu} use, so there is one rounding convention to remember.
 */
export function nearestEmu(text: string): Emu | undefined {
	const q = parseLength(text);
	if (!q) return undefined;
	const whole = q.emu / q.scale; // BigInt division truncates toward zero
	const rest = q.emu % q.scale; // and leaves a remainder of the same sign
	const magnitude = rest < 0n ? -rest : rest;
	const away = rest < 0n ? -1n : 1n;
	return exactNumber(2n * magnitude >= q.scale ? whole + away : whole);
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

function gcd(a: bigint, b: bigint): bigint {
	while (b !== 0n) [a, b] = [b, a % b];
	return a;
}

/**
 * Writes `emu` in `unit` with the fewest decimals that say it exactly. The
 * caller has already established that it can be said — see {@link spellsExactly}.
 */
function spell(emu: Emu, unit: Unit): string {
	const spec = UNITS[unit];
	const magnitude = BigInt(Math.abs(emu));
	const divisor = BigInt(spec.per);
	const common = gcd(magnitude, divisor);
	const numerator = magnitude / common;
	const denominator = divisor / common;

	// The reduced denominator is 2^a·5^b — that is exactly what checking `step`
	// established — and max(a,b) is then the number of decimals, which is also
	// the fewest, since the fraction is already in lowest terms.
	let rest = denominator;
	let twos = 0;
	let fives = 0;
	while (rest % 2n === 0n) {
		rest /= 2n;
		twos++;
	}
	while (rest % 5n === 0n) {
		rest /= 5n;
		fives++;
	}
	const decimals = Math.max(twos, fives);
	const scaled = ((numerator * 10n ** BigInt(decimals)) / denominator).toString();
	const padded = scaled.padStart(decimals + 1, "0");
	const body =
		decimals === 0
			? padded
			: `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
	return `${emu < 0 ? "-" : ""}${body}${spec.symbol}`;
}

/**
 * How a length is written down: the requested unit if it can say the value
 * exactly, otherwise pixels, otherwise `emu`.
 *
 * The requested unit is the unit the value was already written in, which is
 * what makes an edit keep a designer's units: drag a node whose x is `"12pt"`
 * and it stays in points, because a point nudged by a pixel is 22225 EMU and
 * that is exactly 1.75pt. The chain almost never gets past its first link.
 *
 * `emu` is the last resort and it is honest rather than lossy — half a CSS
 * pixel is 4762.5 EMU, so no CSS unit spells it and `"14288emu"` at least says
 * so out loud. A longer chain through every unit in the table was rejected: a
 * value silently rewritten in millimetres inside a document drawn in pixels is
 * a stranger surprise than a suffix nobody has seen before.
 */
export function formatLength(emu: Emu, unit: Unit = DEFAULT_UNIT): string {
	const whole = wholeEmu(emu);
	for (const candidate of [unit, DEFAULT_UNIT, "emu" as Unit]) {
		if (spellsExactly(whole, candidate)) return spell(whole, candidate);
	}
	// Unreachable: `emu` has step 1 and divides every integer. Kept as the
	// answer rather than a throw, because a document that cannot be written is
	// a worse failure than one written in a unit the caller did not ask for.
	return spell(whole, "emu");
}

/**
 * What the inspector shows: rounded to the unit's own comfortable number of
 * decimals, trailing zeros gone. Never stored — {@link formatLength} is what
 * reaches the document, and the difference between the two is the difference
 * between reading a value and keeping it.
 */
export function displayLength(emu: Emu, unit: Unit = DEFAULT_UNIT): string {
	const spec = UNITS[unit];
	const fixed = (emu / spec.per).toFixed(spec.decimals);
	const trimmed = spec.decimals === 0 ? fixed : fixed.replace(/\.?0+$/, "");
	// A value a hair below zero rounds to "-0", which is a true statement and a
	// silly thing to put in a field.
	return `${trimmed === "-0" ? "0" : trimmed}${spec.symbol}`;
}

/* ------------------------------------------------------------------ */
/* Rounding, named                                                     */
/* ------------------------------------------------------------------ */

/** Ties away from zero, everywhere in this module. `Math.round` breaks them upward. */
const roundAway = (value: number): number =>
	value < 0 ? -Math.round(-value) : Math.round(value);

/**
 * The nearest storable EMU to a quantity that is not one yet.
 *
 * There are exactly two sources of a fractional EMU: arithmetic that halves —
 * a centre, a `symmetric` seed — and clingo-lpx, which answers in rationals
 * (`320/3` EMU is not an integer). Quantizing either is invisible at 1/914400
 * of an inch, but it *is* a quantization, so it has a name and this comment
 * rather than a bare `Math.round` at the call site.
 */
export const wholeEmu = (value: number): Emu => roundAway(value);

/**
 * The nearest value `unit` can spell exactly — the second of the two places
 * rounding is allowed.
 *
 * Its caller is the migration: every document predating EMU stores pixels that
 * may be off the lattice, and `"20.5px"` has to become something rather than
 * nothing, because `emuOf` returning `undefined` would send the node to the
 * origin. Snapping it once, visibly, on the way in is a rewrite a designer can
 * see; a silent zero is not.
 */
export function snapToUnit(value: number, unit: Unit = DEFAULT_UNIT): Emu {
	const { step } = UNITS[unit];
	return roundAway(value / step) * step;
}

/**
 * The nearest whole `unit` — what a drag, a resize or a marquee writes.
 *
 * Deliberately *not* {@link UnitSpec.step}. Spellability and gesture quantum
 * are different questions that both look like "round to a multiple of
 * something": the lattice says what can be written down at all (0.04px), while
 * this says what a pointer is allowed to mean. Without it, deleting the old
 * whole-pixel rounding would fill every Automerge diff with `"10.4px"` where a
 * drag used to write `"10px"` — sub-pixel noise in a shared document, in
 * exchange for precision no hand has. Nothing here is a unit conversion, so
 * quantizing a gesture does not violate the promise the module opens with.
 */
export function quantizeGesture(value: number, unit: Unit = DEFAULT_UNIT): Emu {
	const { per } = UNITS[unit];
	return roundAway(value / per) * per;
}

/* ------------------------------------------------------------------ */
/* The float boundary                                                  */
/* ------------------------------------------------------------------ */

/**
 * EMU out to float CSS pixels — for a stylesheet, an SVG attribute, or a
 * canvas call. Exported HTML and SVG are unchanged in appearance by any of
 * this: EMU is internal, and `px` is what a browser is told.
 */
export const cssPxFromEmu = (emu: Emu): number => emu / EMU_PER_PX;

/**
 * Float CSS pixels in to EMU, at the two places a real float legitimately
 * enters: the font engine, which measures text in pixels and cannot be asked
 * to do otherwise, and pointer deltas, which arrive from the canvas in screen
 * pixels divided by a camera scale. Both quantize here, once, by name.
 */
export const emuFromCssPx = (px: number): Emu => wholeEmu(px * EMU_PER_PX);
