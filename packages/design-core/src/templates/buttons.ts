import { frame, rect, text } from "./shared.ts";
import { RULES_HEADER, starterTokens, type Scene, type SceneNode } from "../scene.ts";
import { lit, ref, single, type Value } from "../values.ts";

/**
 * Three buttons whose fills vary *independently* — the alternatives live on
 * each assignment rather than on a shared token.
 */
export function buttons(): Scene {
	const palette: Value = [lit("#3b82f6"), lit("#10b981"), lit("#f43f5e")];
	const button = (
		id: string,
		label: string,
		x: number,
		labelX: number,
		labelWidth: number,
	): SceneNode[] => [
		rect(id, label, [x, 108, 150, 48], {
			fill: palette,
			radius: [ref("radius")],
		}),
		text(`${id}Label`, `${label} label`, [labelX, 122, labelWidth, 20], label, {
			ink: single("#ffffff"),
			size: single("13px"),
			weight: single("550"),
		}),
	];

	return {
		tokens: starterTokens(),
		nodes: [
			frame("page", "Page", [0, 0, 640, 260], { fill: [ref("muted")] }, [
				...button("one", "Primary", 64, 96, 90),
				...button("two", "Secondary", 238, 262, 104),
				...button("three", "Ghost", 412, 452, 70),
			]),
		],
		constraints: [],
		rules: `${RULES_HEADER}
% Each button picks independently: 3 x 3 x 3 = 27 designs.
% Insist two of them differ:
% :- resolved(prop(one,fill),C), resolved(prop(two,fill),C).
`,
	};
}
