/**
 * Starting points for a new project.
 *
 * A template is just a {@link Scene}, so nothing here is privileged. They
 * differ mainly in how many assignments carry more than one alternative, since
 * that is what decides how big the initial space is.
 *
 * One file each: they are literal data, they only grow, and a reader after a
 * particular one should not have to scroll past five others to reach it.
 */
import type { Scene } from "../scene.ts";
import { blank } from "./blank.ts";
import { buttons } from "./buttons.ts";
import { card } from "./card.ts";
import { component } from "./component.ts";
import { deck } from "./deck.ts";
import { machine } from "./machine.ts";
import { map } from "./map.ts";
import { orbit } from "./orbit.ts";
import { pair } from "./pair.ts";
import { palette } from "./palette.ts";
import { places } from "./places.ts";
import { rail } from "./rail.ts";
import { ranked } from "./ranked.ts";
import { solids } from "./solids.ts";
import { sudoku } from "./sudoku.ts";
import { typography } from "./typography.ts";

export interface Template {
	id: string;
	name: string;
	description: string;
	create(): Scene;
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
		id: "component",
		name: "Component",
		description:
			"A button whose four variants are its universes, used three times — two of them decided.",
		create: component,
	},
	{
		id: "machine",
		name: "States",
		description:
			"A button with rest, hover and pressed — and exactly as many designs as the same button with no machine at all.",
		create: machine,
	},
	{
		id: "deck",
		name: "Inputs and layers",
		description:
			"Three inputs, three guarded edges and two layers on screen at once — and the same two designs as the same bar with no machine at all.",
		create: deck,
	},
	{
		id: "solids",
		name: "Three dimensions",
		description:
			"A row of solids a rule lines up, painting from the page's own accent — a 3D view joins the design space instead of multiplying it.",
		create: solids,
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
		id: "typography",
		name: "Two typographies",
		description:
			"One variable decides size, weight, family and leading together — two designs, both coherent, where four tokens would give sixteen.",
		create: typography,
	},
	{
		id: "ranked",
		name: "Preference",
		description:
			"Variety against restraint: two rules that cannot both hold, ranked instead of enforced.",
		create: ranked,
	},
	{
		id: "rail",
		name: "Design table",
		description:
			"A row of plates whose spacing is a variable, so the multiverse shows every size.",
		create: rail,
	},
	{
		id: "orbit",
		name: "Orbit",
		description:
			"Satellites a fixed distance and bearing from a hub — geometry the linear solver cannot state, answered by PlaneGCS.",
		create: orbit,
	},
	{
		id: "places",
		name: "Two places",
		description:
			"One drawing whose panel sits on either side — a frame with two positions.",
		create: places,
	},
	{
		id: "sudoku",
		name: "Sudoku",
		description:
			"81 cells of nine digits and 27 all-different rules: one document, one answer.",
		create: sudoku,
	},
	{
		id: "map",
		name: "Map generation",
		description:
			"121 tiles and four requirements: every artboard is a level that obeys them.",
		create: map,
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
