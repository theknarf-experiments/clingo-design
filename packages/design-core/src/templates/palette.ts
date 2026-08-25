import { frame, rect, text } from "./shared.ts";
import { RULES_HEADER, starterTokens, type Scene, type SceneNode } from "../scene.ts";
import { derive, lit, propVar, ref, single, type Value } from "../values.ts";

/**
 * Three buttons that must not share a colour, each label's ink *computed* from
 * the button under it.
 *
 * The two ideas the solver is actually for: a constraint cuts 27 combinations
 * down to the 6 legal ones, and the ink is inferred rather than chosen, so it
 * stays readable in every one of them without adding a single design.
 */
export function palette(): Scene {
	// One pale swatch on purpose: the derived ink has to flip to stay readable,
	// and it does so in whichever universe that colour lands in.
	const fills: Value = [lit("#1d4ed8"), lit("#fde047"), lit("#b91c1c")];
	const button = (id: string, label: string, x: number): SceneNode[] => [
		rect(id, label, [x, 96, 168, 52], { fill: fills, radius: [ref("radius")] }),
		text(`${id}Label`, `${label} label`, [x + 16, 112, 136, 22], label, {
			// Not a colour anyone picked: whatever reads on this button's fill.
			ink: [derive("contrast", propVar(id, "fill"))],
			size: single("14px"),
			weight: single("550"),
		}),
	];

	return {
		tokens: starterTokens(),
		styles: [],
		nodes: [
			frame("page", "Page", [0, 0, 680, 260], { fill: [ref("surface")] }, [
				text("heading", "Heading", [32, 36, 400, 30], "Pick a plan", {
					ink: [ref("ink")],
					size: single("22px"),
					weight: single("700"),
				}),
				...button("one", "Starter", 32),
				...button("two", "Team", 224),
				...button("three", "Scale", 416),
			]),
		],
		constraints: [
			{
				id: "k_distinct",
				kind: "differ",
				prop: "fill",
				nodes: ["one", "two", "three"],
				enabled: true,
			},
		],
		rules: RULES_HEADER,
	};
}
