import type { SketchReport } from "@clingo-design/design-core";

/**
 * What a finished drag is allowed to write, when the second solver is involved.
 *
 * §4.4 of docs/planegcs-spec.md gives the gesture its shape: a node the sketch
 * layer places cannot be dragged in the ordinary way, because a drag writes
 * `frame`, the next solve overrules it, and the node springs back. So the drag
 * writes the node's *aim* instead — `sketchSeed`, where the solver starts
 * looking — and the design snaps to whichever branch that aim is in.
 *
 * Which leaves one question per node, and the whole of this file is that it is
 * really two questions and they have different answers:
 *
 * | question                                   | field    | what it decides |
 * | ------------------------------------------ | -------- | --------------- |
 * | may the sketch layer speak for this?       | `owned`  | the aim write   |
 * | did it speak for it, in the universe shown? | `placed` | the frame write |
 *
 * `owned` is a fact about the document — no linear rule decided this coordinate
 * — and it does not change when a solve fails. `placed` is a fact about the
 * solve, and an `adrift` or `conflicted` universe applies nothing, so it is
 * empty and the node on screen is at the frame the document stores.
 *
 * Reading `owned` for both is the bug this file was lifted out to hold shut. It
 * made the drag a dead gesture on precisely the documents where dragging is the
 * only move left: two rules that cannot both hold, or a solve that ran out of
 * steps, and the node shows as settling, is withheld its frame write because
 * something else was supposed to place it, and nothing else does. It moved
 * nowhere and said nothing.
 *
 * The honest reading writes both halves on such a drag, and they agree rather
 * than compete: **the aim says start here, the frame says sit here until you
 * do.** The frame is not overruled — nothing is placing the node but the frame
 * — and the aim is the new starting point the next solve most needs, which is
 * the affordance §0's third hazard exists for. A node the sketch *did* place
 * keeps the old behaviour exactly: the aim moves and the frame is left alone on
 * every axis that was placed, so one gesture is never in the document twice.
 *
 * Lifted out of `Editor.tsx` rather than left inline because it is a policy
 * with two fields, three cases and a hazard, sitting in the middle of a pointer
 * handler where none of that can be read or tested. The handler now asks it a
 * question and applies the answer.
 */
export interface SketchDrag {
	/**
	 * Nodes whose aim this drag moves, with the axes the sketch layer owns.
	 *
	 * The seed itself is a whole point — an axis the sketch does not own is
	 * simply never read back out of it — so the axes are carried for the caller's
	 * bookkeeping and not for the write.
	 */
	readonly aim: ReadonlyMap<string, readonly ("x" | "y")[]>;
	/**
	 * Coordinates this drag must not write as a frame, because the sketch put a
	 * value of its own there and the next solve will do so again.
	 *
	 * Always a subset of {@link aim}'s keys, per axis: a coordinate cannot be
	 * placed by a layer that does not own it.
	 */
	readonly held: ReadonlyMap<string, readonly ("x" | "y")[]>;
}

/**
 * Split the moved nodes into what this drag aims and what it must not place.
 *
 * `sketch` is `undefined` on every document with no sketch rule in it, and on
 * one the answer is two empty maps — which is the ordinary frame drag, reached
 * without the caller having to ask whether the feature is in play.
 */
export function sketchDrag(
	sketch: SketchReport | null | undefined,
	moved: Iterable<string>,
): SketchDrag {
	const aim = new Map<string, readonly ("x" | "y")[]>();
	const held = new Map<string, readonly ("x" | "y")[]>();
	if (!sketch) return { aim, held };
	for (const id of moved) {
		const owned = sketch.owned[id];
		if (owned && owned.length > 0) aim.set(id, owned);
		const placed = sketch.placed[id];
		if (placed && placed.length > 0) held.set(id, placed);
	}
	return { aim, held };
}
