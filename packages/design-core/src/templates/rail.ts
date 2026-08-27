import { frame, rect, text } from "./shared.ts";
import { RULES_HEADER, starterTokens, type Scene, type SceneNode } from "../scene.ts";
import { lit, ref, single , type Token } from "../values.ts";

/**
 * A row of plates whose spacing is a variable — a design table.
 *
 * Nothing here is a new feature. The two gaps and the pin are ordinary
 * geometric constraints; what makes them parametric is that their *dimension*
 * names a token instead of holding a number, and a token is already a value
 * with alternatives. So `spacing` carrying three lengths shows the same
 * drawing at all three, and dragging `margin` in the Variables panel slides
 * the whole run across the page.
 */
export function rail(): Scene {
	const tokens: Token[] = [
		...starterTokens(),
		// Where the run starts. One value: a parameter need not vary to be one.
		{ id: "margin", name: "margin", type: "length", value: single("60px") },
		// Three, and therefore three designs.
		{
			id: "spacing",
			name: "spacing",
			type: "length",
			value: [lit("16px"), lit("56px"), lit("112px")],
		},
	];
	const plate = (id: string, x: number): SceneNode =>
		rect(id, id, [x, 132, 120, 168], {
			fill: [ref("accent")],
			radius: [ref("radius")],
		});

	return {
		tokens,
		styles: [],
		machines: [],
		// Drawn at the first spacing, so the document reads the same as the
		// universe it opens on. The solver owns these coordinates either way.
		nodes: [
			frame("page", "Page", [0, 0, 720, 400], { fill: [ref("surface")] }, [
				text("caption", "Caption", [60, 56, 560, 30], "Three plates, one gap", {
					ink: [ref("ink")],
					size: single("22px"),
					weight: single("700"),
				}),
				plate("one", 60),
				plate("two", 196),
				plate("three", 332),
			]),
		],
		constraints: [
			{
				id: "k_margin",
				kind: "pin",
				prop: "fill",
				nodes: ["one"],
				edge: "left",
				value: [ref("margin")],
				enabled: true,
			},
			{
				id: "k_gap1",
				kind: "gap",
				prop: "fill",
				nodes: ["one", "two"],
				edge: "x",
				value: [ref("spacing")],
				enabled: true,
			},
			{
				id: "k_gap2",
				kind: "gap",
				prop: "fill",
				nodes: ["two", "three"],
				edge: "x",
				value: [ref("spacing")],
				enabled: true,
			},
		],
		rules: `${RULES_HEADER}
% The spacing token holds three lengths, so this document is three designs
% that differ only in geometry. Edit it in the Variables panel — or add a
% fourth value there and watch a fourth universe appear.
`,
	};
}
