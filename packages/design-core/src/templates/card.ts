import { frame, rect, text, withToken } from "./shared.ts";
import { RULES_HEADER, starterTokens, type Scene } from "../scene.ts";
import { lit, ref, single } from "../values.ts";

/**
 * A card. The accent token holds five alternatives and the radius three, so
 * every place referencing them varies together — the CSS-variable behaviour.
 */
export function card(): Scene {
	let tokens = starterTokens();
	tokens = withToken(tokens, "accent", [
		lit("#3b82f6"),
		lit("#10b981"),
		lit("#f59e0b"),
		lit("#f43f5e"),
		lit("#8b5cf6"),
	]);
	tokens = withToken(tokens, "radius", [lit("0px"), lit("8px"), lit("18px")]);

	return {
		tokens,
		styles: [],
		machines: [],
		nodes: [
			frame("page", "Page", [0, 0, 720, 480], { fill: [ref("muted")] }, [
				frame(
					"card",
					"Card",
					[120, 80, 480, 320],
					{ fill: [ref("surface")], radius: [ref("radius")] },
					[
						rect("badge", "Badge", [40, 40, 64, 26], {
							fill: [ref("accent")],
							radius: [ref("radius")],
						}),
						text("badgeLabel", "Badge label", [52, 45, 44, 18], "New", {
							ink: single("#ffffff"),
							size: single("13px"),
							weight: single("550"),
						}),
						text("title", "Title", [40, 88, 400, 40], "Aurora", {
							ink: [ref("ink")],
							size: single("26px"),
							weight: single("700"),
						}),
						text(
							"body",
							"Body",
							[40, 136, 400, 60],
							"A design that exists in several states at once.",
							{ ink: [ref("subtle")], size: single("15px"), weight: single("400") },
						),
						rect("primary", "Primary button", [40, 224, 148, 44], {
							fill: [ref("accent")],
							radius: [ref("radius")],
						}),
						text(
							"primaryLabel",
							"Primary label",
							[60, 237, 108, 20],
							"Get started",
							{ ink: single("#ffffff"), size: single("13px"), weight: single("550") },
						),
						rect("secondary", "Secondary button", [204, 224, 132, 44], {
							fill: [ref("muted")],
							radius: [ref("radius")],
						}),
						text(
							"secondaryLabel",
							"Secondary label",
							[226, 237, 96, 20],
							"Learn more",
							{ ink: [ref("ink")], size: single("13px"), weight: single("550") },
						),
					],
				),
			]),
		],
		constraints: [],
		rules: RULES_HEADER,
	};
}
