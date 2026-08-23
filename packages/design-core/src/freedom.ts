/**
 * How much of a node's geometry is still free.
 *
 * The discrete half of this document already tells the designer what is left:
 * brave consequences say which alternatives a property can still take, and the
 * rows that cannot are greyed out. Geometry is the continuous half of the same
 * question — a coordinate is *pinned* when its least and greatest legal values
 * coincide, and free by exactly the difference when they do not.
 *
 * clingo-lpx answers it directly, one coordinate at a time. That restriction is
 * not fastidiousness: the objective is a single number, so a probe naming
 * several coordinates optimises their *sum*, and because a coordinate nothing
 * constrains runs to infinity, one unbounded term makes the whole objective
 * unbounded — at which point the simplex solver stops optimising and hands back
 * whatever feasible point it already had. Measured on a document with 54 solver
 * coordinates, the two-solves-total approximation found *none* of them free for
 * that reason. Per-coordinate it is exact, and `__lpx_objective` reports
 * whether the extreme it found was bounded at all.
 */
import { PULL_ATOM, probeAtom } from "./compile.ts";
import type { Assumption, SolverSession } from "./solver.ts";

/** The four numbers a frame is made of. */
export type FrameAxis = "x" | "y" | "width" | "height";

export const FRAME_AXES: readonly FrameAxis[] = ["x", "y", "width", "height"];

/**
 * The values one coordinate may take. `null` at either end means the
 * constraints never stop it going that way — an ordinary unpinned node.
 */
export interface Travel {
	min: number | null;
	max: number | null;
}

/** Per axis, for the coordinates the solver owns. Others are simply absent. */
export type NodeFreedom = Partial<Record<FrameAxis, Travel>>;

/** Node id -> what the solver left free. */
export type Freedom = Readonly<Record<string, NodeFreedom>>;

/**
 * Exact rationals come back as `"320/3"`. Compared as floats they would need a
 * tolerance; the pinned test below is what needs one.
 */
const EPS = 1e-9;

/** No room to move at all: one legal value, and the solver named it twice. */
export function isPinned(travel: Travel | undefined): boolean {
	return (
		travel !== undefined &&
		travel.min !== null &&
		travel.max !== null &&
		Math.abs(travel.max - travel.min) < EPS
	);
}

/**
 * Nowhere left to put it.
 *
 * Deliberately about the two position coordinates only: a node whose place is
 * settled but whose size is not cannot be dragged, and a selection outline is
 * a statement about where something is.
 */
export function isPlaced(freedom: NodeFreedom | undefined): boolean {
	return isPinned(freedom?.x) && isPinned(freedom?.y);
}

/**
 * How far a coordinate sitting at `at` may be dragged, as a delta window.
 * `null` at an end is no limit in that direction.
 *
 * An axis the solver does not own is not in the map at all, and that is the
 * ordinary case — a hand-placed frame is a number in the document, free by
 * construction.
 */
export function travelFrom(
	travel: Travel | undefined,
	at: number,
): { lo: number | null; hi: number | null } {
	if (!travel) return { lo: null, hi: null };
	return {
		lo: travel.min === null ? null : travel.min - at,
		hi: travel.max === null ? null : travel.max - at,
	};
}

/** Intersection of two delta windows; `null` is the unbounded end. */
export function narrow(
	a: { lo: number | null; hi: number | null },
	b: { lo: number | null; hi: number | null },
): { lo: number | null; hi: number | null } {
	return {
		lo: a.lo === null ? b.lo : b.lo === null ? a.lo : Math.max(a.lo, b.lo),
		hi: a.hi === null ? b.hi : b.hi === null ? a.hi : Math.min(a.hi, b.hi),
	};
}

/** A delta clamped into a window. */
export function clampTo(
	delta: number,
	window: { lo: number | null; hi: number | null },
): number {
	let out = delta;
	if (window.lo !== null && out < window.lo) out = window.lo;
	if (window.hi !== null && out > window.hi) out = window.hi;
	return out;
}

/**
 * The axes a node can still be changed on, counting the ones the solver never
 * took charge of. Four for an ordinary node, none for one a layout owns
 * outright.
 */
export function degreesOfFreedom(freedom: NodeFreedom | undefined): FrameAxis[] {
	return FRAME_AXES.filter((axis) => !isPinned(freedom?.[axis]));
}

/**
 * `__lpx_objective("V",Bounded)` — the value of the objective and whether it
 * was an optimum at all. Unbounded means the coordinate runs off for ever, and
 * then `V` is only wherever the tableau happened to sit.
 */
function readObjective(
	atoms: readonly string[],
): { value: number; bounded: boolean } | null {
	for (const text of atoms) {
		const m = /^__lpx_objective\("([^"]*)",(\d+)\)$/.exec(text);
		if (!m) continue;
		const slash = m[1].indexOf("/");
		const value =
			slash === -1
				? Number(m[1])
				: Number(m[1].slice(0, slash)) / Number(m[1].slice(slash + 1));
		if (!Number.isFinite(value)) return null;
		return { value, bounded: m[2] !== "0" };
	}
	return null;
}

/**
 * Least and greatest legal value of one coordinate, as two solves on an
 * already-grounded session.
 *
 * `assumptions` must be the same ones the exploration used — the constraint
 * switches and any pins — or the answer would be about a different document.
 * The pull is forced off, so what comes back is the equations' own verdict.
 */
export async function probeCoordinate(
	session: SolverSession,
	assumptions: readonly Assumption[],
	nodeId: string,
	axis: FrameAxis,
): Promise<Travel> {
	const ends = await Promise.all(
		(["min", "max"] as const).map(async (direction) => {
			const outcome = await session.solve({
				models: 1,
				assumptions: [
					...assumptions.filter((a) => a.atom !== PULL_ATOM),
					{ atom: PULL_ATOM, sign: false },
					{ atom: probeAtom(nodeId, axis, direction) },
				],
			});
			const objective = readObjective(outcome.models[0] ?? []);
			if (!objective || !objective.bounded) return null;
			// A minimum is asked for as the maximum of the negated coordinate,
			// because clingo-lpx has one objective and it goes one way. Written
			// as a subtraction so a zero minimum does not come back as -0.
			return direction === "min" ? 0 - objective.value : objective.value;
		}),
	);
	return { min: ends[0], max: ends[1] };
}

/**
 * Probes every coordinate the solver owns for the given nodes.
 *
 * Which coordinates those are is read off the solved geometry rather than
 * asked for: a coordinate is in `solved` exactly when the solver decided it.
 * Two solves each, so this is an on-demand question about the selection, not
 * something to run over a whole document per keystroke.
 */
export async function probeFreedom(
	session: SolverSession,
	assumptions: readonly Assumption[],
	solved: Readonly<Record<string, Partial<Record<FrameAxis, number>>>>,
	nodeIds: readonly string[],
): Promise<Freedom> {
	const out: Record<string, NodeFreedom> = {};
	for (const id of nodeIds) {
		const owned = solved[id];
		if (!owned) continue;
		const axes = FRAME_AXES.filter((axis) => owned[axis] !== undefined);
		const travels = await Promise.all(
			axes.map((axis) => probeCoordinate(session, assumptions, id, axis)),
		);
		if (axes.length === 0) continue;
		out[id] = Object.fromEntries(axes.map((axis, i) => [axis, travels[i]]));
	}
	return out;
}
