/**
 * The keyboard end of a bespoke curve: what a half-typed control point reads as,
 * and which alternative of the row four keystrokes land in.
 *
 * A module of its own for `guideFields.ts`' reason exactly — the app's suite is
 * `node --test` with no DOM, so anything inside a `.tsx` is out of its reach —
 * and it is here rather than inline because both of the laws below shipped
 * wrong and neither was visible from any test in the repository. Driving the
 * panel in a browser is what found them:
 *
 *   - **A control point could not be typed.** The four fields were
 *     `<input type="number">` written straight through to the document on every
 *     keystroke. A number input's `value` is the empty string whenever what is in
 *     the box is not a valid floating-point number, and `"-"` and `"0."` are both
 *     invalid — so the controlled value snapped back under the caret and typing
 *     `-0.2` into `y1`, one key at a time, left `cubicBezier(420,2000,580,1000)`
 *     in the document: the wrong sign and ten times the magnitude. `y` being free
 *     in both directions is the *stated reason a bespoke curve exists at all*, and
 *     undershoot was the one thing the control could not say.
 *   - **Four keystrokes deleted the other alternatives.** The field wrote
 *     `[lit(text)]` — the whole value, not one of its terms — so a row holding
 *     `["easeOut", "springBouncy"]`, which is the feel token this entire feature
 *     was built for, collapsed to one curve and the space halved from sixteen
 *     universes to eight the moment somebody nudged a handle. The note under the
 *     field said "as one more alternative of the same value" while it happened.
 *
 * Both fixes are the house pattern one panel over: a draft held while the text
 * is unreadable (`Inputs.tsx`'s `Field`, `LayerStrip`'s `Chip`), and a write that
 * replaces one term of a {@link Value} rather than the list (`ValueEditor`'s
 * `replace`).
 */
import {
	type Term,
	type Value,
	lit,
	nearestPermille,
	writePermille,
} from "@clingo-design/design-core";

/**
 * The four control points, in **thousandths** — `cubicBezier(200,0,0,1000)`.
 *
 * The document's dialect and not CSS's, for the reason `bezierOf` gives: a
 * lowerCamel functor with four integer arguments is a term a rule can name, and
 * `cubic-bezier(0.2, 0, 0, 1)` is a minus sign and three things the grounder
 * cannot hold. What a person types is a decimal; the translation happens here
 * and in no other file.
 */
export type CurvePoints = [number, number, number, number];

/**
 * What a control-point field's text reads as, in thousandths, or nothing while
 * it is still on its way to being a number.
 *
 * {@link nearestPermille} and not `Number(text) * 1000`, which is what shipped.
 * The bridge is the same one `Inputs.tsx` reads a range end through and the same
 * one the `ratio` quantity reaches the program through, so a control point and a
 * blend threshold are one arithmetic rather than two — and it is the *nearest*
 * reader rather than the exact one for that module's stated reason: this is a
 * field a person is typing into, and `permilleOf` being exact-or-nothing would
 * blank the row on a half-thousandth. `Number` would have read `"1e3"`,
 * `" 12 "` and `"Infinity"` as numbers that no document literal may hold.
 *
 * `""`, `"-"`, `"0."` and `"-0."` are the half-typed states, and every one of
 * them reads as **nothing** rather than as zero. That is the whole of the first
 * bug: a keystroke that reads as nothing must leave the document alone, so the
 * box can go on saying `-0.` while the document goes on holding the last curve
 * that was readable.
 */
export const typedPoint = (text: string): number | undefined => nearestPermille(text);

/** A stored control point as a person reads it: `420` is `"0.42"`, `-200` is `"-0.2"`. */
export const shownPoint = (permille: number): string => writePermille(permille);

/** The four points, spelled as the literal a document stores. */
export const writeCurve = (points: CurvePoints): string =>
	`cubicBezier(${points.join(",")})`;

/**
 * Which alternative of the row the four fields write into, or nothing where they
 * must not write at all.
 *
 * The alternative **this universe is using**, because that is the curve the
 * picture beside the fields is drawing: a row holding two feels shows one of them
 * at a time, and a handle dragged on the drawing of the first must not land in
 * the second. `active` is the solver's index for it, and the position *is* that
 * index for a document value — `ValueEditor` says so where it defines `at` — which
 * is why neither caller has to hand over an `indices` map it does not have.
 *
 * **Nothing where the alternative is a token or a derivation**, and that is the
 * third thing the old field got wrong, quietly: a row pointing at a `curve` token
 * would have had the reference overwritten with a literal by one keystroke, so a
 * feel a design system decided once became a number typed on one edge, with
 * nothing on screen to say the link had gone. `ValueEditor` disables the literal
 * box for exactly this term one row up (`term.kind !== "literal"`), and this is
 * that rule applied to the same term through a second control.
 *
 * An **empty** value is editable and answers `0`: a transition that says nothing
 * about its curve takes `DEFAULT_EASING`, and the first keystroke is what mints
 * the one alternative that will hold what was typed.
 */
export function curveTarget(value: Value, active: number | undefined): number | undefined {
	if (value.length === 0) return 0;
	const at = active !== undefined && active >= 0 && active < value.length ? active : 0;
	return value[at]?.kind === "literal" ? at : undefined;
}

/**
 * The row's value with one alternative holding the given curve, and every other
 * alternative left exactly as it was.
 *
 * `value.map` and not `[lit(text)]`, which is the second bug in one line. A
 * `Value` is `Term[]` and the list means *alternatives*, so writing a fresh
 * single-element list is not "writing a curve into this row", it is deleting
 * every other design the row was holding — and doing it through a control whose
 * own caption promises the opposite.
 */
export function placeCurve(value: Value, at: number, text: string): Value {
	const term: Term = lit(text);
	return value.length === 0 ? [term] : value.map((t, i) => (i === at ? term : t));
}
