/**
 * Geometric constraints, as marks on the canvas.
 *
 * A rule the eye cannot see is a rule the designer will fight: something moves
 * and nothing on screen says why. So a selected node's constraints draw
 * themselves — the line its edges share, the distance it holds, the mirror it
 * balances across.
 *
 * Everything here is measured off the *solved* geometry rather than off the
 * constraint's stored number, so a mark always says where the design actually
 * ended up. Which mark a kind gets is one field in `CONSTRAINT_KINDS`, so a new
 * kind picks a shape instead of growing this file a case.
 */
import type { Frame } from "./geometry.ts";
import {
	CONSTRAINT_KINDS,
	type Constraint,
	type ConstraintKind,
	EDGES,
	type Edge,
	type Scene,
} from "./scene.ts";
import { placedNodes } from "./tree.ts";
import type { ResolveContext } from "./values.ts";

/**
 * One mark, in canvas coordinates.
 *
 * A `line` stands across the design at `at` on its axis and runs from `from`
 * to `to` down the other one; a `span` measures along its axis from `from` to
 * `to` and sits at `at` on the other. In both, `at` is the coordinate that
 * does not move and `axis` is the axis the constraint talks about.
 */
export interface Annotation {
	/** The constraint this draws, so a blamed rule can be picked out. */
	constraint: string;
	kind: ConstraintKind;
	shape: "line" | "span";
	axis: "x" | "y";
	at: number;
	from: number;
	to: number;
	/** A number worth reading — a distance, a size, a pinned coordinate. */
	label?: string;
}

/**
 * How far a line reaches past the members it crosses.
 *
 * Without it, a rule about a selected node's own edge would run exactly under
 * that node's selection outline and be invisible — a pin especially, which has
 * only the one member to span.
 */
const OVERHANG = 8;

/** Half a pixel is noise; a whole one is a position. */
const round = (v: number): number => Math.round(v * 10) / 10;

/** How much of a node's own size lies before an edge. */
const OFFSET = { lead: 0, mid: 0.5, trail: 1 } as const;

/** A frame's extent along one axis: where it starts, and how long it is. */
const along = (frame: Frame, axis: "x" | "y") =>
	axis === "x"
		? { start: frame.x, size: frame.width }
		: { start: frame.y, size: frame.height };

/** The same, across the axis — which is where a mark for it is drawn. */
const across = (frame: Frame, axis: "x" | "y") =>
	along(frame, axis === "x" ? "y" : "x");

/** What the solver calls `ge(N,E)`, halved: one edge of one placed node. */
function edgeOf(frame: Frame, edge: Edge): number {
	const spec = EDGES[edge];
	const { start, size } = along(frame, spec.axis);
	if (spec.role === "span") return size;
	return start + size * OFFSET[spec.place ?? "lead"];
}

/**
 * Every mark the selection earns.
 *
 * A constraint draws only while one of its members is selected: the point is
 * to explain the thing being looked at, not to turn the canvas into a
 * blueprint. Disabled rules draw nothing, because they do nothing.
 */
export function annotate(
	scene: Scene,
	selection: ReadonlySet<string>,
	solved: Readonly<Record<string, Partial<Frame>>> = {},
	context?: ResolveContext,
): Annotation[] {
	if (selection.size === 0) return [];
	const world = new Map(
		placedNodes(scene.nodes, solved, context).map((p) => [p.node.id, p.world]),
	);
	const out: Annotation[] = [];
	for (const c of scene.constraints ?? []) {
		const spec = CONSTRAINT_KINDS[c.kind];
		if (spec.annotation === "none" || !c.enabled) continue;
		if (!c.nodes.some((id) => selection.has(id))) continue;
		const frames = c.nodes
			.map((id) => world.get(id))
			.filter((f): f is Frame => f !== undefined);
		if (frames.length < spec.minNodes) continue;
		out.push(...marksFor(c, frames));
	}
	return out;
}

function marksFor(c: Constraint, frames: readonly Frame[]): Annotation[] {
	const spec = CONSTRAINT_KINDS[c.kind];
	const edge = c.edge ?? spec.edges[0];
	if (!edge) return [];
	const axis = EDGES[edge].axis;
	const of = { constraint: c.id, kind: c.kind, axis } as const;

	/** The band a line has to cross to touch every member. */
	const band = () => {
		const starts = frames.map((f) => across(f, axis).start);
		const ends = frames.map((f) => across(f, axis).start + across(f, axis).size);
		return {
			from: round(Math.min(...starts) - OVERHANG),
			to: round(Math.max(...ends) + OVERHANG),
		};
	};

	if (spec.annotation === "between") {
		const [a, b] = frames;
		const lead = along(b, axis).start;
		const trail = along(a, axis).start + along(a, axis).size;
		return [
			{
				...of,
				shape: "span",
				// Between the two centres, so the dimension reads as belonging to
				// both rather than sitting on either.
				at: round(
					(across(a, axis).start +
						across(a, axis).size / 2 +
						across(b, axis).start +
						across(b, axis).size / 2) /
						2,
				),
				from: round(trail),
				to: round(lead),
				label: `${round(lead - trail)}`,
			},
		];
	}

	if (spec.annotation === "mirror") {
		// Read off the two members rather than off the stored value: with a
		// third member the mirror *is* that node's centre, and either way this
		// is where the design settled.
		const mid = (f: Frame) => along(f, axis).start + along(f, axis).size / 2;
		const at = round((mid(frames[0]) + mid(frames[1])) / 2);
		return [{ ...of, shape: "line", at, ...band(), label: `${at}` }];
	}

	// "edges": a size is a thing each member has of its own, so it draws one
	// mark per member; a place is one they share, so it draws one line.
	if (EDGES[edge].role === "span") {
		return frames.map((f) => ({
			...of,
			shape: "span" as const,
			at: round(across(f, axis).start + across(f, axis).size / 2),
			from: round(along(f, axis).start),
			to: round(along(f, axis).start + along(f, axis).size),
			label: `${round(along(f, axis).size)}`,
		}));
	}
	const at = round(edgeOf(frames[0], edge));
	return [
		{
			...of,
			shape: "line",
			at,
			...band(),
			// Only where the number is the point: an alignment is about the
			// edges meeting, not about which coordinate they met at.
			...(spec.valueType ? { label: `${at}` } : {}),
		},
	];
}
