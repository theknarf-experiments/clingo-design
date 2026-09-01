import { EASINGS, bezierOf, springOf, writePermille } from "@clingo-design/design-core";

import styles from "./CurveField.module.css";
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
 * **It writes one literal through the caller's own `onChange`**, which is the
 * same `onChange` the {@link ValueEditor} above it writes through. So a custom
 * curve is an alternative of the same `easing` {@link Value} as every menu word:
 * it can be pinned, it can sit beside a second alternative, it can be undone,
 * and the panel's own why-probe can be asked about it. A second storage path —
 * four fields on the transition, or a `curve` record beside the value — was the
 * obvious shape and is exactly the shape that would make all four of those stop
 * working, for one control.
 *
 * The numbers are typed as **decimals** and stored as **thousandths**, and the
 * translation happens here and nowhere else. `cubicBezier(200,0,0,1000)` is what
 * reaches the program, because a lowerCamel functor with four integer arguments
 * is a term a rule can name and `cubic-bezier(0.2, 0, 0, 1)` is a minus sign and
 * three non-integers; `0.20` is what a person who has ever used another motion
 * tool expects to type. Neither of those facts is negotiable and this is the one
 * place they meet.
 *
 * **Rejected: a free text field where the designer types
 * `cubic-bezier(.2,0,0,1)`.** It would either demand thousandths of a person — a
 * typo `bezierOf` refuses in silence, leaving a curve that reads as no curve at
 * all and eases out instead — or accept CSS and translate, which is a second
 * dialect and a second place the document and the program can disagree about
 * what is playing.
 */
export function CurveField({
	/** The curve the row resolved to: a menu word, or a `cubicBezier(…)` literal. */
	value,
	/** Write a custom curve, as the literal text `cubicBezier(X1,Y1,X2,Y2)`. */
	onChange,
	testId,
}: {
	value: string;
	onChange: (text: string) => void;
	testId?: string;
}) {
	const points = bezierOf(value);
	const spring = springOf(value);
	// What the picture draws when the value is a menu word: the same four numbers
	// CSS's own keywords are defined as, so `ease` really is the curve a browser
	// plays. A spring is not a bezier at all and gets its `linear()` sampled
	// instead, which is why `path` is chosen by what the value *is* rather than by
	// converting everything to control points first.
	const shown = points ?? KEYWORD_POINTS[value];

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
				<path className={styles.path} d={pathOf(shown, spring ? value : undefined)} />
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
					<label key={label} className={styles.field} title={POINT_TITLES[i]}>
						<span className={styles.name}>{label}</span>
						<input
							className={cx(styles.number, points === undefined && styles.inactive)}
							data-role={`curve-${label}`}
							type="number"
							step={0.01}
							value={(points?.[i] ?? DEFAULT_POINTS[i]) / 1000}
							onChange={(e) => {
								const next = [...(points ?? DEFAULT_POINTS)] as [
									number,
									number,
									number,
									number,
								];
								// Rounded here rather than refused, because this is the one
								// place a person is typing a *decimal* at a field whose
								// storage is integral: `0.335` is a number somebody meant, and
								// `bezierOf` would read `cubicBezier(335.0,…)` as no curve at
								// all and silently ease out instead.
								next[i] = Math.round((Number(e.target.value) || 0) * 1000);
								onChange(`cubicBezier(${next.join(",")})`);
							}}
						/>
					</label>
				))}
			</div>

			<p className={styles.note} data-role="curve-note">
				{spring ? (
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
				) : (
					<>
						{EASINGS[value as keyof typeof EASINGS]?.label ?? value}. Typing into
						the four fields writes a custom curve into this row, as one more
						alternative of the same value.
					</>
				)}
			</p>
		</div>
	);
}

/** The four control points, as CSS would spell them. */
const cssOf = (points: readonly [number, number, number, number]): string =>
	`cubic-bezier(${points.map((n) => writePermille(n)).join(", ")})`;

const POINT_LABELS = ["x1", "y1", "x2", "y2"] as const;
const POINT_TITLES = [
	"Where the first handle sits along time. Refused outside 0–1: a control point off the time axis is a curve that runs backwards rather than a slow one.",
	"How far the first handle reaches. Free in both directions — below 0 is undershoot and above 1 is overshoot, which is what a bespoke curve is usually for.",
	"Where the second handle sits along time. Refused outside 0–1 for the same reason as the first.",
	"How far the second handle reaches. Free in both directions.",
] as const;

/**
 * What the four fields start at when the row is holding a menu word.
 *
 * `ease-in-out`'s own points, so the first keystroke into any one field leaves a
 * curve somebody could have meant rather than a straight line through the
 * origin. Nothing is written until a keystroke, so a row showing `easeOut` and a
 * row showing this are the same document.
 */
const DEFAULT_POINTS: [number, number, number, number] = [420, 0, 580, 1000];

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
const KEYWORD_POINTS: Record<string, [number, number, number, number]> = {
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
