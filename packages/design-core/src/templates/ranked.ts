import { frame, rect, text } from "./shared.ts";
import { RULES_HEADER, starterTokens, type Scene, type SceneNode } from "../scene.ts";
import { derive, propVar, ref, single, type Token, type Value } from "../values.ts";

/**
 * Two preferences that cannot both hold, at two different tiers.
 *
 * Every other template states rules the design must obey; this one states rules
 * it would *rather* obey, which is most of what a designer actually has to say.
 * Variety and restraint are the pair everybody knows — "these should all look
 * different" against "this should use as few colours as it can" — and they are
 * flatly incompatible over three cards. As prohibitions they would be an
 * unsatisfiable document and a core naming both. As preferences they are a
 * ranking, and the ranking is the thing to look at: every design is legal, and
 * each one says on its caption what it gave up to be here.
 *
 * The tiers are what settle it. Variety is the stronger, so the best designs
 * are the all-different ones and they pay a point of restraint for it — and
 * because levels are lexicographic rather than a weighted sum, no amount of
 * restraint ever buys back that point. Swap the two tiers in the Rules panel
 * and the whole grid reorders: same document, same space, other winner. That is
 * the demonstration.
 *
 * The third rule is a soft `custom` one, which is nearly free and the most
 * powerful shape this has: the ASP a designer writes in the panel derives the
 * same `viol/1` a built-in rule derives, so setting it to a preference *ranks*
 * their own condition instead of forbidding it. It sits at the lowest tier and
 * does nothing but break ties inside the two groups above — which is exactly
 * what a mild preference is for.
 */
export function ranked(): Scene {
	const tokens: Token[] = [
		...starterTokens(),
		{ id: "brand", name: "brand", type: "color", value: single("#1d4ed8") },
		{ id: "warm", name: "warm", type: "color", value: single("#f59e0b") },
		{ id: "cool", name: "cool", type: "color", value: single("#0d9488") },
	];
	/** What the first two cards may be. The third is brand, so the space is nine. */
	const palette: Value = [ref("brand"), ref("warm"), ref("cool")];

	const card = (id: string, label: string, x: number, fill: Value): SceneNode[] => [
		rect(id, label, [x, 120, 192, 200], { fill, radius: [ref("radius")] }),
		text(`${id}Label`, `${label} label`, [x + 20, 140, 152, 24], label, {
			// Computed from the card under it, so a legible label costs no designs.
			ink: [derive("contrast", propVar(id, "fill"))],
			size: single("15px"),
			weight: single("600"),
		}),
	];

	return {
		tokens,
		styles: [],
		machines: [],
		nodes: [
			frame("page", "Page", [0, 0, 720, 400], { fill: [ref("surface")] }, [
				text("heading", "Heading", [32, 40, 560, 32], "Variety or restraint", {
					ink: [ref("ink")],
					size: single("24px"),
					weight: single("700"),
				}),
				text(
					"caption",
					"Caption",
					[32, 78, 620, 22],
					"Both rules are preferences. The best design pays the cheaper one.",
					{ ink: [ref("subtle")], size: single("14px"), weight: single("450") },
				),
				...card("one", "First", 32, palette),
				...card("two", "Second", 248, palette),
				// Fixed, so the space is nine designs and the whole of it fits on the
				// grid — a ranking you have to scroll is a ranking nobody checks.
				...card("three", "Third", 464, [ref("brand")]),
			]),
		],
		constraints: [
			{
				id: "variety",
				kind: "differ",
				prop: "fill",
				nodes: ["one", "two", "three"],
				// The stronger of the two, and the reason the all-different designs
				// come first. Move it down a tier and they stop.
				strength: "strong",
				enabled: true,
			},
			{
				id: "restraint",
				kind: "atMost",
				prop: "fill",
				nodes: ["one", "two", "three"],
				limit: 2,
				strength: "prefer",
				enabled: true,
			},
			{
				// A rule whose condition is ASP in the panel below, ranked rather than
				// forbidden. Nothing about the line changes; only its strength does.
				id: "calm_first",
				kind: "custom",
				prop: "fill",
				nodes: [],
				strength: "slight",
				enabled: true,
			},
		],
		rules: `${RULES_HEADER}
% ---- the third rule, and the cheapest thing preference buys you ----
% This is an ordinary hand-written violation condition. What makes it a
% *preference* is one field on the rule in the panel above: a design that trips
% it is not thrown away, it is charged one point at the lowest tier. So this
% orders the designs the two rules above have already tied, and nothing more.
viol(calm_first) :- rendered(one,fill,L), resolved(tok(warm),L).

% Costs come back one number per tier, strongest first, and the caption under
% each artboard shows them. Things worth trying:
%
%   * Swap the tiers on "variety" and "restraint". The grid reorders and the
%     winner changes, with no other edit.
%   * Set "variety" back to Must. The two rules can no longer both hold, and the
%     document becomes an impossible one with both names in the core.
%   * Raise the weight on "restraint". Weights are points inside a tier; only
%     designs within a couple of points of the best are shown at all, so a heavy
%     preference is one the grid stops offering to give up.
`,
	};
}
