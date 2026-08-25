import { frame, rect, text, withToken } from "./shared.ts";
import { RULES_HEADER, starterTokens, type Scene, type SceneNode } from "../scene.ts";
import { lit, ref, single } from "../values.ts";

/** Two frames side by side, to show that a document can hold several. */
export function pair(): Scene {
	const tokens = withToken(starterTokens(), "accent", [
		lit("#3b82f6"),
		lit("#10b981"),
		lit("#f43f5e"),
	]);
	const contents = (prefix: string, label: string): SceneNode[] => [
		rect(`${prefix}Hero`, "Hero", [32, 32, 256, 120], {
			fill: [ref("accent")],
			radius: [ref("radius")],
		}),
		text(`${prefix}Title`, "Title", [32, 172, 256, 30], label, {
			ink: [ref("ink")],
			size: single("22px"),
			weight: single("700"),
		}),
		text(
			`${prefix}Body`,
			"Body",
			[32, 210, 256, 48],
			"Both frames share one accent.",
			{ ink: [ref("subtle")], size: single("14px"), weight: single("400") },
		),
	];

	return {
		tokens,
		styles: [],
		nodes: [
			frame(
				"mobile",
				"Mobile",
				[0, 0, 320, 300],
				{ fill: [ref("surface")] },
				contents("m", "Mobile"),
			),
			frame(
				"desktop",
				"Desktop",
				[380, 0, 320, 300],
				{ fill: [ref("surface")] },
				contents("d", "Desktop"),
			),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
}
