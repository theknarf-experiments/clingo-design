/**
 * Starting points for a new project.
 *
 * A template is just a {@link Scene}, so nothing here is privileged. They
 * differ mainly in how many assignments carry more than one alternative, since
 * that is what decides how big the initial space is.
 *
 * Child coordinates are relative to the enclosing frame, so a frame can be
 * moved on the canvas without touching anything inside it.
 */
import { makeNode } from "./edits.ts";
import {
	RULES_HEADER,
	type Scene,
	type SceneNode,
	emptyScene,
	starterTokens,
} from "./scene.ts";
import {
	type Token,
	type Value,
	derive,
	lit,
	propVar,
	ref,
	single,
} from "./values.ts";

export interface Template {
	id: string;
	name: string;
	description: string;
	create(): Scene;
}

type Box = [x: number, y: number, width: number, height: number];

const at = ([x, y, width, height]: Box) => ({ x, y, width, height });

/**
 * Templates go through {@link makeNode} like any other node, so per-kind
 * construction rules live in exactly one place; `props` overrides rather than
 * adds to the kind's defaults, since a template states its whole appearance.
 */
function frame(
	id: string,
	name: string,
	box: Box,
	props: SceneNode["props"],
	children: SceneNode[],
): SceneNode {
	return { ...makeNode("frame", at(box), { id, name }), props, children };
}

function rect(
	id: string,
	name: string,
	box: Box,
	props: SceneNode["props"],
): SceneNode {
	return { ...makeNode("rect", at(box), { id, name }), props };
}

function text(
	id: string,
	name: string,
	box: Box,
	content: string,
	props: SceneNode["props"],
): SceneNode {
	return { ...makeNode("text", at(box), { id, name, text: content }), props };
}

/** Replace one starter token's value. */
function withToken(tokens: Token[], id: string, value: Value): Token[] {
	return tokens.map((t) => (t.id === id ? { ...t, value } : t));
}

/* ------------------------------------------------------------------ */

function blank(): Scene {
	return emptyScene();
}

/**
 * A card. The accent token holds five alternatives and the radius three, so
 * every place referencing them varies together — the CSS-variable behaviour.
 */
function card(): Scene {
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

/**
 * Three buttons whose fills vary *independently* — the alternatives live on
 * each assignment rather than on a shared token.
 */
function buttons(): Scene {
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

/** Two frames side by side, to show that a document can hold several. */
function pair(): Scene {
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

/**
 * Three buttons that must not share a colour, each label's ink *computed* from
 * the button under it.
 *
 * The two ideas the solver is actually for: a constraint cuts 27 combinations
 * down to the 6 legal ones, and the ink is inferred rather than chosen, so it
 * stays readable in every one of them without adding a single design.
 */
function palette(): Scene {
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

export const TEMPLATES: Template[] = [
	{
		id: "blank",
		name: "Blank",
		description: "One empty frame. Draw a rectangle to begin.",
		create: blank,
	},
	{
		id: "card",
		name: "Card",
		description: "A card whose accent and radius tokens each hold several values.",
		create: card,
	},
	{
		id: "buttons",
		name: "Button set",
		description: "Three buttons whose fills vary independently of each other.",
		create: buttons,
	},
	{
		id: "palette",
		name: "Constrained palette",
		description:
			"Three buttons that must all differ, with ink computed to stay readable.",
		create: palette,
	},
	{
		id: "pair",
		name: "Two frames",
		description: "Two artboards side by side, sharing one accent variable.",
		create: pair,
	},
];

export function findTemplate(id: string): Template | undefined {
	return TEMPLATES.find((t) => t.id === id);
}
