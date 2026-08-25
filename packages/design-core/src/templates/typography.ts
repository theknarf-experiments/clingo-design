import { frame, text, wearing } from "./shared.ts";
import {
	RULES_HEADER,
	makeLayout,
	starterTokens,
	type Scene,
	type SceneNode,
	type Style,
} from "../scene.ts";
import { VALUE_TYPES, lit, ref, single } from "../values.ts";

/**
 * A page whose entire typography is **one variable**, and the argument for why
 * that is not the same thing as four tokens.
 *
 * Link a heading's size to one token and its weight to another and the solver
 * picks them *independently*. Four tokens of two values each — size, weight,
 * family, leading — is sixteen designs, and fourteen of them are nobody's:
 * 19px set on a 1.25 leading puts the lines on top of each other, 15px serif on
 * a 1.75 leading is a paragraph of air. Correlation between properties is the
 * one thing the scalar token model cannot express; you would need a `match`
 * constraint per pair, which is unwritable.
 *
 * So this document has one style with two variants. One pick decides size AND
 * weight AND family AND leading together, which collapses that cross product
 * into a correlation: **two designs, both coherent by construction.** Open the
 * multiverse and there are two artboards, not sixteen — and the one thing to
 * try is the Variables panel, where the two variants sit side by side and what
 * they differ in is the whole of what is on screen.
 *
 * The page reflows, rather than merely restyling, because the column is an
 * automatic layout over text that hugs its words: a measured box is a function
 * of the picks that change the font, and the style is one of them.
 *
 * Two nodes deliberately state some of it themselves. The heading is 34px at
 * weight 700 in every design — a headline is not body copy — and it still takes
 * the family and the leading from the style. That is the ordinary case, and the
 * inspector says so: a property the style decides reads as styled, a property
 * the node states reads as an override with a way back.
 */
export function typography(): Scene {
	/** A stack from the font menu, named rather than spelled out twice. */
	const font = (label: string): string =>
		VALUE_TYPES.font.options?.find((o) => o.label === label)?.value ??
		VALUE_TYPES.font.fallback;

	/**
	 * The whole design space of this document: two records, four fields each.
	 *
	 * Every field is one term, never a list — branching is what the *variants*
	 * are for. Read down a column and it is a treatment; read across a row and
	 * it is what the two treatments disagree about.
	 */
	const prose: Style = {
		id: "prose",
		name: "Prose",
		variants: [
			{
				name: "Compact",
				parts: {
					fontFamily: lit(font("Sans")),
					size: lit("15px"),
					weight: lit("450"),
					lineHeight: lit("1.3"),
				},
			},
			{
				name: "Comfortable",
				parts: {
					fontFamily: lit(font("Serif")),
					size: lit("18px"),
					weight: lit("400"),
					lineHeight: lit("1.75"),
				},
			},
		],
	};

	/** Body copy: everything about how it is set comes from the style. */
	const para = (
		id: string,
		name: string,
		y: number,
		copy: string,
		colour = "ink",
	): SceneNode =>
		wearing(
			text(id, name, [44, y, 560, 60], copy, { ink: [ref(colour)] }),
			prose.id,
		);

	return {
		tokens: starterTokens(),
		styles: [prose],
		nodes: [
			{
				...frame(
					"page",
					"Page",
					[0, 0, 720, 620],
					{ fill: [ref("surface")] },
					[
						wearing(
							text("eyebrow", "Eyebrow", [44, 44, 300, 18], "ONE VARIABLE", {
								ink: [ref("subtle")],
								// Its own, in every design: a label is a label at either
								// density. The family and the leading still follow.
								size: single("12px"),
								weight: single("650"),
							}),
							prose.id,
						),
						wearing(
							text(
								"title",
								"Title",
								[44, 76, 560, 44],
								"Compact or comfortable",
								{
									ink: [ref("ink")],
									size: single("34px"),
									weight: single("700"),
								},
							),
							prose.id,
						),
						para(
							"deck",
							"Deck",
							132,
							"Every word on this page takes its size, its weight, its\nfamily and its leading from one variable. Two variants,\nand nothing in between.",
						),
						para(
							"first",
							"First paragraph",
							216,
							"Link a size to one token and a weight to another and the\nsolver picks them independently: two two-value tokens are\nfour designs, and two of the four set a display size at a\nbody weight.",
						),
						para(
							"second",
							"Second paragraph",
							320,
							"A style is one variable whose alternatives are whole\nrecords. One pick decides size and weight and family and\nleading together, so this page is two designs — and both\nof them are coherent.",
						),
						para(
							"footnote",
							"Footnote",
							424,
							"Four tokens holding two values each would be sixteen\ncombinations. Fourteen of them are nobody's.",
							"subtle",
						),
					],
				),
				// A column, so the page reflows rather than restyling: comfortable
				// prose is taller prose, and the stack below it moves down.
				layout: makeLayout({
					direction: "column",
					padding: 44,
					gap: 20,
					sizing: "fixed",
				}),
			},
		],
		constraints: [],
		rules: `${RULES_HEADER}
% One variable, and it is the whole typography:
%
%   pick(sty(prose),0)  Compact      15px / 450 / sans  / 1.3
%   pick(sty(prose),1)  Comfortable  18px / 400 / serif / 1.75
%
% Pin either one in the Variables panel to hold the page at it. A rule can
% name it like any other variable — \`:- pick(sty(prose),1).\` leaves one
% design — because nothing downstream can tell a record from a colour.
`,
	};
}
