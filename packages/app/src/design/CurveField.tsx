import {
	EASINGS,
	type Value,
	bezierOf,
	bezierPoints,
	curveOf,
	springOf,
} from "@clingo-design/design-core";
import { useEffect, useRef, useState } from "react";

import styles from "./CurveField.module.css";
import {
	type CurvePoints,
	curveTarget,
	placeCurve,
	shownPoint,
	typedPoint,
	writeCurve,
} from "./curveFields.ts";
import { cx } from "./cx";

/**
 * A curve, drawn, and — where it is a custom one — four handles to move.
 *
 * Two callers, `Transitions.tsx` and `Timeline.tsx`, which is the whole reason
 * this is a component rather than forty lines inline: a transition's easing and
 * a keyframe's outgoing easing are the same question asked of two records, and
 * the day the two pictures disagree about what `springBouncy` looks like is the
 * day a designer stops trusting either of them.
 *
 * **It writes one alternative of the caller's own {@link Value}**, through the
 * same `onChange` the {@link ValueEditor} above it writes through. So a custom
 * curve is an alternative of the same `easing` value as every menu word: it can
 * be pinned, it can sit beside a second alternative, it can be undone, and the
 * panel's own why-probe can be asked about it. A second storage path — four
 * fields on the transition, or a `curve` record beside the value — was the
 * obvious shape and is exactly the shape that would make all four of those stop
 * working, for one control.
 *
 * That sentence used to be a promise the code did not keep: it wrote
 * `[lit(text)]`, which is the *list* and not one term of it, so a row holding two
 * feels lost one of them to a nudged handle. `curveFields.ts` carries the laws
 * that fix it and the account of how they were found, which was by typing into
 * this panel in a browser and not by reading any of it.
 *
 * The numbers are typed as **decimals** and stored as **thousandths**, and the
 * translation happens in `curveFields.ts` and nowhere else.
 * `cubicBezier(200,0,0,1000)` is what reaches the program, because a lowerCamel
 * functor with four integer arguments is a term a rule can name and
 * `cubic-bezier(0.2, 0, 0, 1)` is a minus sign and three non-integers; `0.20` is
 * what a person who has ever used another motion tool expects to type. Neither of
 * those facts is negotiable and this is the one place they meet.
 *
 * **Rejected: a free text field where the designer types
 * `cubic-bezier(.2,0,0,1)`.** It would either demand thousandths of a person — a
 * typo `bezierOf` refuses in silence, leaving a curve that reads as no curve at
 * all and eases out instead — or accept CSS and translate, which is a second
 * dialect and a second place the document and the program can disagree about
 * what is playing.
 */
export function CurveField({
	/**
	 * The curve the row resolved to in *this* universe: a menu word, or a
	 * `cubicBezier(…)` literal. What the drawing draws and what the note describes.
	 */
	curve,
	/** The stored alternatives, so a keystroke can replace one and keep the rest. */
	value,
	/** Which alternative this universe is using — {@link curveTarget}'s `active`. */
	active,
	/** The whole next value, exactly as the row's own `ValueEditor` hands it over. */
	onChange,
	testId,
}: {
	curve: string;
	value: Value;
	active?: number;
	onChange: (next: Value) => void;
	testId?: string;
}) {
	const points = bezierOf(curve);
	const spring = springOf(curve);
	// What the picture draws when the value is a menu word: the same four numbers
	// CSS's own keywords are defined as, so `ease` really is the curve a browser
	// plays. A spring is not a bezier at all and gets its `linear()` sampled
	// instead, which is why `path` is chosen by what the value *is* rather than by
	// converting everything to control points first.
	const shown = points ?? KEYWORD_POINTS[curve];
	// Which alternative four keystrokes land in, and whether they may land at all.
	const target = curveTarget(value, active);
	/**
	 * The literal the row is actually holding, where it is holding one.
	 *
	 * Read so the note can tell "this row eases out" from "this row holds
	 * something that reads as no curve, so it eases out" — which are the same
	 * picture and very different documents. `normalizeTransitions` deliberately
	 * *keeps* a word the menu has not got and an `x` outside 0..1000 rather than
	 * dropping either, because a document should not lose what somebody typed
	 * because a menu shrank; the cost of keeping it is that some panel has to say
	 * so out loud, and this is that panel.
	 */
	const term = target !== undefined ? value[target] : undefined;
	const stored = term?.kind === "literal" ? term.value : undefined;
	const unreadable = stored !== undefined && curveOf(stored) === undefined;
	/**
	 * What the four boxes say, which is **what is written** and not what plays.
	 *
	 * The two are the same literal every time the row holds a curve at all, and
	 * they part company on exactly one document: a control point outside 0..1 on
	 * the time axis, which `bezierOf` refuses and the document keeps. Reading the
	 * played curve there would blank the three points that were fine along with
	 * the one that was not, and a designer correcting an `x` of 1.4 would find the
	 * overshoot they had typed into `y1` gone — a field that punishes a typo by
	 * deleting the work beside it.
	 */
	const typed = (stored !== undefined ? bezierPoints(stored) : undefined) ?? points;
	const boxes = typed ?? KEYWORD_POINTS[curve] ?? DEFAULT_POINTS;

	const commit = (i: number, permille: number) => {
		const next = [...boxes] as CurvePoints;
		next[i] = permille;
		if (target !== undefined) onChange(placeCurve(value, target, writeCurve(next)));
	};

	return (
		<div className={styles.curve} data-role="curve-field" data-prop={testId}>
			<svg
				className={styles.preview}
				viewBox="-8 -24 80 112"
				width={64}
				height={64}
				aria-hidden="true"
			>
				{/* The unit box the curve runs across. Drawn because a bezier whose y
				    leaves 0..1 — which is the whole reason somebody writes one — is
				    only legible against the ends it overshoots. */}
				<rect className={styles.box} x={0} y={0} width={64} height={64} />
				<path className={styles.path} d={pathOf(shown, spring ? curve : undefined)} />
				{points ? (
					<g className={styles.handles}>
						<line x1={0} y1={64} x2={points[0] * 0.064} y2={64 - points[1] * 0.064} />
						<line x1={64} y1={0} x2={points[2] * 0.064} y2={64 - points[3] * 0.064} />
						<circle cx={points[0] * 0.064} cy={64 - points[1] * 0.064} r={3} />
						<circle cx={points[2] * 0.064} cy={64 - points[3] * 0.064} r={3} />
					</g>
				) : null}
			</svg>

			<div className={styles.fields}>
				{POINT_LABELS.map((label, i) => (
					<PointField
						key={label}
						label={label}
						title={target === undefined ? FOLLOWS_SOMETHING_ELSE : POINT_TITLES[i]}
						value={shownPoint(boxes[i])}
						inactive={typed === undefined}
						disabled={target === undefined}
						onCommit={(permille) => commit(i, permille)}
					/>
				))}
			</div>

			<p className={styles.note} data-role="curve-note">
				{unreadable ? (
					<>
						This row holds <code>{stored}</code>, which reads as no curve — so both
						the panel and the program fall back to{" "}
						{EASINGS[curve as keyof typeof EASINGS]?.label ?? curve}. A control point
						off 0–1 on the time axis is refused rather than clamped, because it is a
						curve that runs backwards in time rather than a slow one.
					</>
				) : spring ? (
					<>
						Stiffness {spring.stiffness}, damping {spring.damping}, mass{" "}
						{spring.mass}. Settles naturally in {spring.natural}ms — what paces it
						here is the duration, because a duration is the one number every row,
						every check and every exported declaration in this document is written
						around.
					</>
				) : points ? (
					<>
						A custom curve: {cssOf(points)}. Written as whole thousandths so it
						reaches the program as a term a rule can name.
					</>
				) : target === undefined ? (
					<>
						{EASINGS[curve as keyof typeof EASINGS]?.label ?? curve}, and this
						alternative follows something else — a token or a derivation — so the
						four fields are inert. Change what it follows on the row above.
					</>
				) : (
					<>
						{EASINGS[curve as keyof typeof EASINGS]?.label ?? curve}. Typing into
						the four fields writes a custom curve into this alternative, leaving
						every other alternative of the row alone.
					</>
				)}
			</p>
		</div>
	);
}

/**
 * One control point, held while it is being typed into and committed the moment
 * it reads as a number.
 *
 * `type="text"` and not `type="number"`, and that is the whole of the fix rather
 * than a preference. A number input's `value` is the **empty string** whenever
 * what is in the box is not a valid floating-point number, and `"-"` and `"0."`
 * are both invalid — so a controlled field reading back off the document snapped
 * to the last committed number under the caret and `-0.2`, typed one key at a
 * time, arrived as `2`. Every ratio field in this app is a text field for exactly
 * this reason; `Inputs.tsx`'s `Field` is the same component one panel over.
 *
 * The draft is abandoned when **somebody else** changes the value — an undo, a
 * token, the solver landing on another universe — and not when the field's own
 * keystroke comes back through the document. That distinction is load-bearing
 * and `Inputs.tsx`'s cruder version would not survive it: `"-0"` reads as zero
 * and `writePermille` spells zero `"0"`, so a draft cleared on any change at all
 * would eat the minus sign on the second keystroke of every negative number.
 */
function PointField({
	label,
	title,
	value,
	inactive,
	disabled,
	onCommit,
}: {
	label: string;
	title: string;
	/** The committed point, spelled the way {@link shownPoint} spells it. */
	value: string;
	/** The row is showing a menu word, so these numbers are a starting point. */
	inactive: boolean;
	/** The alternative follows a token, so there is no literal to type into. */
	disabled: boolean;
	onCommit: (permille: number) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const written = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (written.current === value) return;
		written.current = undefined;
		setDraft(null);
	}, [value]);
	return (
		<label className={styles.field} title={title}>
			<span className={styles.name}>{label}</span>
			<input
				className={cx(styles.number, inactive && styles.inactive)}
				data-role={`curve-${label}`}
				type="text"
				inputMode="decimal"
				disabled={disabled}
				value={draft ?? value}
				onChange={(e) => {
					setDraft(e.target.value);
					const permille = typedPoint(e.target.value);
					// The keystroke that reads as nothing leaves the document alone, which
					// is what lets the box go on saying `-0.` while the document goes on
					// holding the last curve that was readable.
					if (permille === undefined) return;
					written.current = shownPoint(permille);
					onCommit(permille);
				}}
				onBlur={() => setDraft(null)}
			/>
		</label>
	);
}

/** The four control points, as CSS would spell them. */
const cssOf = (points: readonly [number, number, number, number]): string =>
	`cubic-bezier(${points.map((n) => shownPoint(n)).join(", ")})`;

const POINT_LABELS = ["x1", "y1", "x2", "y2"] as const;
const POINT_TITLES = [
	"Where the first handle sits along time. Refused outside 0–1: a control point off the time axis is a curve that runs backwards rather than a slow one.",
	"How far the first handle reaches. Free in both directions — below 0 is undershoot and above 1 is overshoot, which is what a bespoke curve is usually for.",
	"Where the second handle sits along time. Refused outside 0–1 for the same reason as the first.",
	"How far the second handle reaches. Free in both directions.",
] as const;

/** What the four fields say when the alternative they would edit is not a literal. */
const FOLLOWS_SOMETHING_ELSE =
	"This alternative follows a token or a derivation rather than holding a curve of its own, so there is no literal here to type into. Change what it follows on the row above.";

/**
 * The last resort: what the four fields start at when the row holds neither a
 * bezier nor one of the five plain words — which is a spring, or a curve from a
 * vocabulary this build has not got.
 *
 * `ease-in-out`'s own points, so the first keystroke into any one field leaves a
 * curve somebody could have meant rather than a straight line through the origin.
 * Nothing is written until a keystroke, so a row showing `springBouncy` and a row
 * showing this are the same document.
 *
 * A **plain** menu word takes {@link KEYWORD_POINTS} instead, and that is not
 * tidying: the fields used to say `0.42, 0, 0.58, 1` beside a drawing of
 * `easeOut`, so the picture and the numbers described two different curves, and
 * the first keystroke wrote the one nobody was looking at.
 */
const DEFAULT_POINTS: CurvePoints = [420, 0, 580, 1000];

/**
 * The five plain menu words as control points, so the picture is the browser's
 * curve rather than an artist's impression of it.
 *
 * These are CSS's own definitions and they are duplicated here on purpose:
 * `EasingSpec.css` is the string a browser is handed and must stay the string a
 * browser is handed — `ease` is a keyword and not a bezier as far as a
 * declaration is concerned — so a table that stored points instead would make
 * every exported file say `cubic-bezier(0.25, 0.1, 0.25, 1)` where it says
 * `ease` today, for the sake of one drawing.
 */
const KEYWORD_POINTS: Record<string, CurvePoints> = {
	linear: [0, 0, 1000, 1000],
	ease: [250, 100, 250, 1000],
	easeIn: [420, 0, 1000, 1000],
	easeOut: [0, 0, 580, 1000],
	easeInOut: [420, 0, 580, 1000],
};

/**
 * The path, in the 64×64 box, with y up.
 *
 * A spring is sampled rather than curved, because a spring *is* a polyline as
 * far as the browser is concerned — `linear()` interpolates between its stops —
 * so drawing it as anything smoother would be drawing a curve the file does not
 * play. The stops come out of the checked-in string rather than out of
 * `sampleSpring`, for the same reason the string is checked in at all: what is
 * drawn should be what is shipped.
 */
function pathOf(
	points: readonly [number, number, number, number] | undefined,
	spring: string | undefined,
): string {
	if (spring !== undefined) {
		const stops = (EASINGS[spring as keyof typeof EASINGS]?.css.match(/-?\d*\.?\d+/g) ?? []).map(
			Number,
		);
		if (stops.length > 1) {
			return stops
				.map((y, i) => `${i === 0 ? "M" : "L"} ${(i / (stops.length - 1)) * 64} ${64 - y * 64}`)
				.join(" ");
		}
	}
	const p = points ?? [0, 0, 1000, 1000];
	return `M 0 64 C ${p[0] * 0.064} ${64 - p[1] * 0.064}, ${p[2] * 0.064} ${64 - p[3] * 0.064}, 64 0`;
}
