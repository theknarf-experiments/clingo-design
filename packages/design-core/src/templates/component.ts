import { frame, rect, text } from "./shared.ts";
import { makeNode } from "../edits.ts";
import {
	RULES_HEADER,
	starterTokens,
	type Scene,
	type SceneNode,
} from "../scene.ts";
import { derive, lit, propVar, ref, single } from "../values.ts";

/**
 * A button component, used three times.
 *
 * The point of the template is that nothing here is a component *feature*. The
 * definition is an ordinary frame with an ordinary text node in it; what makes
 * it a component is one flag. Its fill holds two alternatives and its label
 * holds two, so the definition is four designs — and those four designs are its
 * variants. There is no variant table, because there is nothing a variant table
 * would say that the alternatives do not.
 *
 * Each instance re-mints those two variables as its own, so each is its own
 * point in the same space. Two of the three have held both of theirs, which is
 * what an override is here: a pin the document remembers. The third has held
 * nothing, so it is still four designs — and the multiverse shows it being all
 * four while its neighbours stay put.
 *
 * The label's colour is `contrast` of the button's fill, which is the sharpest
 * demonstration that an instance is not a copy: the derivation is written once,
 * against the definition's own fill, and each instance's label follows *its*
 * fill rather than the definition's.
 */
export function component(): Scene {
	/** The definition. Two open choices, so four variants. */
	const definition: SceneNode = {
		...frame(
			"button",
			"Button",
			[48, 96, 176, 48],
			{
				fill: [ref("accent"), ref("muted")],
				radius: [ref("radius")],
			},
			[
				text(
					"buttonLabel",
					"Label",
					[16, 15, 144, 20],
					[lit("Get started"), lit("Learn more")],
					{
						// Readable on either fill, worked out per instance rather than
						// once for the definition — see the component rules.
						ink: [derive("contrast", propVar("button", "fill"))],
						size: single("14px"),
						weight: single("600"),
						align: single("center"),
					},
				),
			],
		),
		component: true,
	};

	/** One use of it, optionally with its mind made up. */
	const use = (
		id: string,
		name: string,
		y: number,
		holds?: Record<string, number>,
	): SceneNode => ({
		...makeNode("instance", { x: 328, y, width: 176, height: 48 }, { id, name }),
		instanceOf: "button",
		...(holds ? { holds } : {}),
	});

	const FILL = propVar("button", "fill");
	const LABEL = propVar("buttonLabel", "text");

	return {
		tokens: starterTokens(),
		styles: [],
		nodes: [
			frame("page", "Page", [0, 0, 560, 340], { fill: [ref("surface")] }, [
				text("title", "Title", [48, 36, 464, 26], "One button, four variants", {
					ink: [ref("ink")],
					size: single("20px"),
					weight: single("700"),
				}),
				text(
					"caption",
					"Caption",
					[48, 62, 464, 18],
					"The definition on the left is a space. Each use on the right is a point in it.",
					{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
				),
				// The frame the definition sits in, so it reads as a swatch rather
				// than as another button on the page.
				rect("bench", "Bench", [32, 80, 208, 80], {
					fill: [ref("muted")],
					radius: single("12px"),
					opacity: single("0.45"),
				}),
				definition,
				// Both choices held: this one is exactly one design.
				use("primary", "Primary", 96, { [FILL]: 0, [LABEL]: 0 }),
				// Both held the other way.
				use("secondary", "Secondary", 160, { [FILL]: 1, [LABEL]: 1 }),
				// Nothing held: still four designs, and the multiverse shows it.
				use("undecided", "Undecided", 224),
			]),
		],
		constraints: [],
		rules: `${RULES_HEADER}
% Nothing here is needed for the component to work — it is compiled from four
% kinds of fact, all of them generated. Things worth trying:
%
%   - Select the Button frame and give its fill a third value. Every instance
%     gains a third choice, and the two that held theirs keep it.
%   - Select "Undecided" and hold one of its choices in the Properties panel.
%     Watch the multiverse halve.
%   - :- rendered(inst(primary,button),fill,C),
%        rendered(inst(secondary,button),fill,C).
%     Two instances that must not look alike — an ordinary rule over derived
%     nodes, because that is all an instance's parts are.
`,
	};
}
