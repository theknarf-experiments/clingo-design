import { frame, rect, text } from "./shared.ts";
import {
	RULES_HEADER,
	angleValue,
	starterTokens,
	type Scene,
	type SceneNode,
} from "../scene.ts";
import { lit, ref, single, type Token } from "../values.ts";

/**
 * Three satellites a fixed distance from a hub, at three fixed bearings.
 *
 * This is the first template whose geometry the linear layer cannot express at
 * all, and that is the whole point of it. `align`, `gap` and `pin` are
 * relations between *coordinates*, which is why clingo-lpx can answer a page
 * full of them exactly: every one of them is a sum. "160px away" is not a sum —
 * it is `sqrt(dx² + dy²)` — and "at 30°" is not one either. A rail of plates can
 * be a `gap` because a row only ever moves along one axis; a satellite cannot,
 * because the direction is the thing being said.
 *
 * So these six rules are `engine: "sketch"`. They compile to `sk*` facts rather
 * than to `&sum` theory atoms, clingo decides which of them hold, and PlaneGCS
 * solves the geometry for the ones it chose. Drag a satellite and it slides
 * around the circle; it cannot leave it.
 *
 * What makes it a *design* table rather than a diagram is the same trick
 * `rail.ts` plays one relation over: `reach` is a token holding three lengths,
 * and a sketch rule's dimension follows a token exactly as a `gap`'s does. So
 * this document is three orbits, and the multiverse holds all three at once.
 *
 * The row of markers underneath is the third kind. `collinear` is the one
 * relation with no number in it — three points on a line, and nothing about
 * where the line is. Its two ends are held by ordinary linear `pin`s, which is
 * what makes it worth looking at: `skheld/2` hands the sketch layer the
 * coordinates the simplex layer already decided, so PlaneGCS is not free to
 * move them and has exactly one marker left to place. The two solvers are a
 * sequence, not a race.
 */
export function orbit(): Scene {
	const tokens: Token[] = [
		...starterTokens(),
		// Three radii, and therefore three designs. A length like any other:
		// nothing here knows it is about to be read by a different solver.
		//
		// Named `reach` and not `radius` because `starterTokens()` already ships a
		// `radius` — the corner rounding every rect here refers to. Two tokens of
		// one id are one variable holding the union of their alternatives, so the
		// first draft of this file drew an orbit 8px across in one universe and
		// square corners in another.
		{
			id: "reach",
			name: "reach",
			type: "length",
			value: [lit("120px"), lit("160px"), lit("208px")],
		},
	];

	const HUB = { x: 320, y: 200, w: 80, h: 80 };
	// Drawn at the *first* radius, so the document reads the same as the universe
	// it opens on — rail.ts's convention, and for its reason. The solver owns
	// these coordinates the moment the sketch runs either way; what they buy is a
	// sensible picture before it has, and a starting point that does not send the
	// solver round the long way. See `SceneNode.sketchSeed`: which of the two
	// solutions of a distance you land on is decided by where you started.
	const spot = (deg: number, size: number): [number, number, number, number] => {
		const r = 120;
		const t = (deg * Math.PI) / 180;
		const cx = HUB.x + HUB.w / 2 + r * Math.cos(t);
		const cy = HUB.y + HUB.h / 2 + r * Math.sin(t);
		return [Math.round(cx - size / 2), Math.round(cy - size / 2), size, size];
	};

	const satellite = (id: string, deg: number): SceneNode =>
		rect(id, id, spot(deg, 56), {
			fill: [ref("accent")],
			radius: [ref("radius")],
		});

	const marker = (id: string, x: number, y: number): SceneNode =>
		rect(id, id, [x, y, 20, 20], { fill: [ref("subtle")], radius: [ref("radius")] });

	return {
		tokens,
		styles: [],
		machines: [],
		nodes: [
			frame("page", "Page", [0, 0, 720, 480], { fill: [ref("surface")] }, [
				text("caption", "Caption", [40, 32, 640, 30], "Three at one radius", {
					ink: [ref("ink")],
					size: single("22px"),
					weight: single("700"),
				}),
				rect("hub", "hub", [HUB.x, HUB.y, HUB.w, HUB.h], {
					fill: [ref("ink")],
					radius: [ref("radius")],
				}),
				satellite("east", 30),
				satellite("west", 150),
				satellite("north", 270),
				// Deliberately not on a line. The rule below straightens them, and
				// seeing it happen on open is the demonstration.
				marker("m1", 140, 410),
				marker("m2", 350, 428),
				marker("m3", 560, 396),
			]),
		],
		constraints: [
			// The hub, held by the linear layer. Nothing in the six rules below says
			// where the constellation *is* — a distance and a bearing are both
			// relations between two points, so the whole thing is free to drift and
			// the picture would not be the same twice. Two pins is the cheapest
			// answer and it is the linear layer's kind of question anyway.
			{
				id: "p_hub_x",
				kind: "pin",
				prop: "fill",
				nodes: ["hub"],
				edge: "left",
				value: single(`${HUB.x}px`),
				enabled: true,
			},
			{
				id: "p_hub_y",
				kind: "pin",
				prop: "fill",
				nodes: ["hub"],
				edge: "top",
				value: single(`${HUB.y}px`),
				enabled: true,
			},
			// One pair per satellite: how far, and which way. Both about the centre,
			// which is the anchor a turn would leave alone if any of these were
			// turned — see `refusedAnchor`.
			...[
				["east", 30],
				["west", 150],
				["north", 270],
			].flatMap(([id, deg]) => [
				{
					id: `r_${id}`,
					kind: "distance" as const,
					prop: "fill" as const,
					nodes: ["hub", id as string],
					anchor: "center" as const,
					value: [ref("reach")],
					enabled: true,
				},
				{
					id: `b_${id}`,
					kind: "bearing" as const,
					prop: "fill" as const,
					nodes: ["hub", id as string],
					anchor: "center" as const,
					value: angleValue((deg as number) * 1000),
					enabled: true,
				},
			]),
			// The two ends of the row, held by the linear layer — ordinary pins, whose
			// answer the sketch layer reads through `skheld/2` and must not write.
			// Both axes of both ends, so the line itself is the linear layer's answer
			// and the sketch has exactly one marker left to place. It is then free to
			// slide along that line and nowhere else, which is `collinear` stated as a
			// number: the status pill reads one free.
			...[
				["m1", 140, 410],
				["m3", 560, 396],
			].flatMap(([id, x, y]) => [
				{
					id: `p_${id}_x`,
					kind: "pin" as const,
					prop: "fill" as const,
					nodes: [id as string],
					edge: "left" as const,
					value: single(`${x}px`),
					enabled: true,
				},
				{
					id: `p_${id}_y`,
					kind: "pin" as const,
					prop: "fill" as const,
					nodes: [id as string],
					edge: "top" as const,
					value: single(`${y}px`),
					enabled: true,
				},
			]),
			// ...and the one relation with no number in it.
			{
				id: "straight",
				kind: "collinear",
				prop: "fill",
				nodes: ["m1", "m2", "m3"],
				anchor: "center",
				enabled: true,
			},
		],
		rules: `${RULES_HEADER}
% The reach token holds three lengths, so this document is three orbits. The
% Rules panel's status pill says how many placements are left over once the
% sketch has run — a sketch that still has freedom in it is one of many, not
% the answer, and dragging a satellite picks a different one.
%
% Pin an orbit without editing anything:
%   :- f_value(reach,value,L), literal(L,"208px").
%
% Or ask for something the linear layer could never have said — the two side
% satellites exactly as far apart as they each are from the hub:
%   (add a Distance between east and west in the Rules panel, and set it to the
%   radius token; three of them at one length is an equilateral triangle, and
%   the solver will find it or say the rules conflict.)
`,
	};
}
