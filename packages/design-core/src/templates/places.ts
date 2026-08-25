import { frame, rect, spread, text } from "./shared.ts";
import { RULES_HEADER, starterTokens, type Scene } from "../scene.ts";
import { lit, ref, single } from "../values.ts";

const PAGE = { width: 640, height: 380 };
const PANEL = { width: 180, height: 212 };
const GUTTER = 24;

/** Where the panel sits in each design: against the near edge, or the far one. */
export const PANEL_PLACES = [
	GUTTER + 16,
	PAGE.width - PANEL.width - GUTTER - 16,
] as const;

/**
 * One drawing, with the panel on either side of the page.
 *
 * This used to be two documents. A node's x, y, width and height are values
 * now, so "the panel is on the left here and on the right there" is a list of
 * two numbers on one dimension — one variable, and therefore two universes that
 * differ in nothing but geometry.
 *
 * Nothing else about the document varies. Every other frame here is a single
 * number, because multiplicity is something a designer asks for rather than
 * something every rectangle is born with: four dimensions on every node would
 * multiply the space past usefulness before anyone had made a decision.
 *
 * The three things worth trying on it:
 *
 *   - both designs are in the multiverse, and pinning either one shows it
 *     alone;
 *   - dragging the panel moves *the alternative on screen* and leaves the other
 *     where it was, so the document still holds two positions afterwards;
 *   - a `pin` on the panel's left edge overrides both of them, because a rule
 *     outranks a stored frame exactly as it always did.
 */
export function places(): Scene {
	return {
		tokens: starterTokens(),
		styles: [],
		nodes: [
			frame("page", "Page", [0, 0, PAGE.width, PAGE.height], { fill: [ref("muted")] }, [
				rect("header", "Header", [GUTTER, GUTTER, PAGE.width - GUTTER * 2, 56], {
					fill: [ref("surface")],
					radius: [ref("radius")],
				}),
				text(
					"heading",
					"Heading",
					[GUTTER + 20, GUTTER + 17, 380, 24],
					"Two places, one document",
					{ ink: [ref("ink")], size: single("16px"), weight: single("700") },
				),
				rect("body", "Body", [GUTTER, 104, PAGE.width - GUTTER * 2, 252], {
					fill: [ref("surface")],
					radius: [ref("radius")],
				}),
				text(
					"note",
					"Note",
					[GUTTER + 20, 124, 240, 60],
					"Drag the panel. The design you are not looking at keeps its own position.",
					{ ink: [ref("subtle")], size: single("13px"), weight: single("400") },
				),
				// The whole of the new idea: one dimension, two numbers.
				spread(
					rect("panel", "Panel", [PANEL_PLACES[0], 124, PANEL.width, PANEL.height], {
						fill: [ref("accent")],
						radius: [ref("radius")],
						shadow: single("0 8px 24px rgba(15,23,42,0.18)"),
					}),
					"x",
					PANEL_PLACES.map((at) => lit(`${at}px`)),
				),
			]),
		],
		constraints: [],
		rules: `${RULES_HEADER}
% The panel's x holds two numbers, so this document is two designs that differ
% in nothing but geometry. f_value/3 is projected, which is what makes that a
% branch rather than one universe drawn twice.
%
% Hold one of them still without editing anything:
%   :- f_value(panel,x,L), literal(L,"${PANEL_PLACES[1]}px").
%
% Or hand the position to the solver, and it will honour whichever alternative
% this universe picked while obeying the rule:
%   gsolved(panel).  &sum{ wv(panel,x) } >= 300.
`,
	};
}
