import { at, frame, rect, text, wearing } from "./shared.ts";
import { makeNode } from "../edits.ts";
import {
	RULES_HEADER,
	starterTokens,
	type Scene,
	type SceneNode,
	type Style,
} from "../scene.ts";
import { derive, lit, propVar, ref, single } from "../values.ts";

/**
 * A button component, used three times, wearing a style.
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
 *
 * And its type comes from a **style**, which is the other half of that sentence.
 * A property the definition leaves open is minted again per instance, so two
 * instances may differ in it; a style is the *document's* one variable, so the
 * copies take the same pick and cannot disagree about the treatment however many
 * variants it grows. Nothing enforces either half — they are what the two shapes
 * are — and the definition's own part wears it too, so the label on the bench and
 * the labels on the three uses are one class in the exported HTML.
 */
export function component(): Scene {
	/**
	 * How a button's label is set. One variant, because this is the ordinary
	 * kind of style — a named treatment, not a design space — and the point here
	 * is *where* it is worn rather than what it holds.
	 */
	const labelStyle: Style = {
		id: "buttonText",
		name: "Button text",
		variants: [
			{
				name: "Default",
				parts: { size: lit("14px"), weight: lit("600"), align: lit("center") },
			},
		],
	};

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
				wearing(
					text(
						"buttonLabel",
						"Label",
						[16, 15, 144, 20],
						[lit("Get started"), lit("Learn more")],
						{
							// Readable on either fill, worked out per instance rather than
							// once for the definition — see the component rules.
							ink: [derive("contrast", propVar("button", "fill"))],
						},
					),
					labelStyle.id,
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
		// Through `at` like every other box in the folder: `makeNode` takes EMU,
		// and the one place a template's pixels become EMU is that helper.
		...makeNode("instance", at([328, y, 176, 48]), { id, name }),
		instanceOf: "button",
		...(holds ? { holds } : {}),
	});

	const FILL = propVar("button", "fill");
	const LABEL = propVar("buttonLabel", "text");

	return {
		tokens: starterTokens(),
		styles: [labelStyle],
		machines: [],
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
%   - Add a variant to "Button text" in the Variables panel. Every label
%     follows it together — the definition's and all three instances' — because
%     a style is one variable the whole document shares, unlike the fill each
%     instance mints for itself.
%   - :- rendered(inst(primary,button),fill,C),
%        rendered(inst(secondary,button),fill,C).
%     Two instances that must not look alike — an ordinary rule over derived
%     nodes, because that is all an instance's parts are.
`,
	};
}
