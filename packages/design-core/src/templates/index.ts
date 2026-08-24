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
import { pair } from "./pair.ts";
import { palette } from "./palette.ts";
import { places } from "./places.ts";
import { rail } from "./rail.ts";
import { sudoku } from "./sudoku.ts";

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
		id: "rail",
		name: "Design table",
		description:
			"A row of plates whose spacing is a variable, so the multiverse shows every size.",
		create: rail,
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
		id: "pair",
		name: "Two frames",
		description: "Two artboards side by side, sharing one accent variable.",
		create: pair,
	},
];

export function findTemplate(id: string): Template | undefined {
	return TEMPLATES.find((t) => t.id === id);
}
