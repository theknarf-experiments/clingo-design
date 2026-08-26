/**
 * How the settings of a grid are laid out in a panel, and what each one is
 * called there.
 *
 * The whole of it is read off `GUIDE_PROPS`, and that is the point. The table
 * already says what every setting *is* — which part of the track equation it
 * plays, which axis it divides, which end of that axis a margin is measured
 * from — so a panel that listed `["columns", "gutter", "rows", "rowGutter"]`
 * would be the one place in the tree where a row grid and a column grid were two
 * different things that happened to look alike, and the first setting anybody
 * added would be a setting with nowhere to be typed.
 *
 * It is a module of its own rather than four constants at the top of
 * `Inspector.tsx` so that the laws below can be tested: the app's suite is
 * `node --test` with no DOM, so anything inside a `.tsx` is out of its reach,
 * and "every setting is editable somewhere" is exactly the kind of claim that
 * quietly stops being true.
 */
import {
	type Edge,
	type GuideProp,
	GUIDE_PROPS,
	GUIDE_PROP_NAMES,
	countOn,
	edgeOn,
	gutterOn,
} from "@clingo-design/design-core";

/**
 * The four margins, in the order the table declares them — which is the order
 * CSS says a margin in, top then right then bottom then left, and therefore the
 * order every designer already reads four numbers in.
 */
export const MARGIN_FIELDS: GuideProp[] = GUIDE_PROP_NAMES.filter(
	(prop) => GUIDE_PROPS[prop].role === "margin",
);

/**
 * The tracks, an axis at a time: how many, then how far apart.
 *
 * Two per axis and in that order, so that in a two-column panel each line of
 * fields reads as a sentence — twelve columns with a twenty gutter, then three
 * rows with a twenty-four one.
 */
export const TRACK_FIELDS: GuideProp[] = (["x", "y"] as const).flatMap(
	(axis) => [countOn(axis), gutterOn(axis)],
);

/**
 * The one word a setting goes by in a compact field.
 *
 * A margin's word is its **edge's**. `marginLeft` and the `left` edge are the
 * same end of the same axis — which is what the `axis` and `place` columns of
 * `GUIDE_PROPS` say, and the claim the datum rules in the compiler are written
 * on — so the word is looked up rather than written down. The gain is not
 * brevity for its own sake: four fields labelled "Left margin", "Right margin",
 * "Top margin" and "Bottom margin" are four labels that all begin with the same
 * word, and the eye has to read to the end of each to tell them apart.
 *
 * Everything else keeps the table's own label, because a count and a gutter are
 * already one word and because the axis is what distinguishes them: "Gutter" and
 * "Row gutter" have to stay different, since they are different settings and a
 * panel that called both of them "gutter" would have two fields with one name.
 */
export function guideFieldLabel(prop: GuideProp): string {
	const spec = GUIDE_PROPS[prop];
	return spec.role === "margin" && spec.place
		? (edgeOn(spec.axis, spec.place) as Edge)
		: spec.label;
}
