import {
	type Picks,
	type Scene,
	type SceneNode,
	constraintMemberNode,
	refusedMembers,
	seedOf,
} from "@clingo-design/design-core";

// The extension is node's, which opens the file the specifier names when it runs
// the test beside this one. Vite resolves the same string.
import { documentUnit, shownEmu } from "./lengths.ts";

/**
 * What the Inspector reads about the sketch layer for one selected node.
 *
 * Two readers, both pure, both lifted out of `Inspector.tsx` for the reason
 * `seedDrag.ts` was lifted out of `Editor.tsx`: the panel is a `.tsx` file and
 * the suite is `node --test "src/**\/*.test.ts"`, so a rule that lives inside
 * JSX is a rule no test can hold. Both of these are exactly the kind that had
 * already gone wrong once by being unwatched.
 *
 * They answer two different questions about the same node and neither can stand
 * in for the other:
 *
 * | question                                   | reader             |
 * | ------------------------------------------ | ------------------ |
 * | where does the sketch start looking?       | {@link seedRow}    |
 * | which rules hold no point for this node?   | {@link sketchRefusals} |
 */

/* ------------------------------------------------------------------ */
/* The starting point                                                  */
/* ------------------------------------------------------------------ */

/** The aim, spelled for a panel: two read-only numbers in the document's unit. */
export interface SeedRow {
	x: string;
	y: string;
}

/**
 * The aim this node carries, or nothing where it carries none.
 *
 * **Off `seedOf` and off nothing else**, and that is the whole decision this
 * function makes. A seed is *document state*: it is written by a drag, it
 * survives a save, it survives a solve that never used it, and it goes on
 * picking the branch every subsequent solve lands in. So it is shown whenever it
 * is stored — not when the sketch owns this node, and not when this universe's
 * solve placed it. Gating on either would hide the aim on precisely the
 * documents where it is doing the most damage: a drag on a node whose sketch has
 * never once settled writes a seed (see `seedDrag.ts`), and a designer who then
 * deletes the rule is left with a pinned starting point, no rule explaining it,
 * and no way to see or remove it. That is the defect this file exists for.
 *
 * The two numbers are the node's **world origin**, which is what the seed
 * stores — not the anchor point any one rule is measured about, because a node
 * has one place and may be named by rules about two different corners of it.
 * Read out in the document's unit like every other length in the panel, and
 * read-only: a seed is a gesture's record, and a field that let a person type
 * one would be a second way to aim with no drag behind it.
 */
export function seedRow(
	scene: Pick<Scene, "unit">,
	node: SceneNode,
): SeedRow | undefined {
	const at = seedOf(node);
	if (!at) return undefined;
	const unit = documentUnit(scene);
	return { x: shownEmu(at.x, unit), y: shownEmu(at.y, unit) };
}

/* ------------------------------------------------------------------ */
/* The rules that hold no point                                        */
/* ------------------------------------------------------------------ */

/**
 * One rule that names this node and holds no point for one of its members.
 *
 * **A separate type from the Inspector's `InertRule`, deliberately.** The two
 * render through one block — to a designer "this rule says nothing about this
 * member" is one fact and not two — but they are derived from different twins:
 * an inert rule is `gnoedge/2` read through `inertConstraints`, and this is
 * `sknopoint/1` read through `refusedAnchor`. Widening either shape to hold the
 * other's fields would put an optional `edge` on a kind that has none, which is
 * the trap §2.3 catches for the compiler and the panels keep re-learning.
 */
export interface SketchRefusal {
	/** The constraint's own term — what an unsat core would blame. */
	constraint: string;
	/** The member the rule holds no point for, reduced to a node where it is one. */
	culprit: string;
	why: string;
}

/**
 * Every enabled sketch rule that names this node and has been left saying
 * nothing about one of its members.
 *
 * **The Inspector's half of the four refusal sentences.** `inertMembers` cannot
 * answer this: it returns `[]` on its first line for any constraint with no
 * `edge`, which is every sketch kind, so the panel's shipped `inertRules` was
 * structurally blind to a distance on a turned box's corner. The rule was green,
 * un-inert, switched on, and governing nothing.
 *
 * **Every member, not only the selection**, for `inertRules`'s reason and it is
 * sharper here: a `distance` is between two points, so one refused member leaves
 * the rule with a single point and `sketchRequest` builds no `p2p_distance` at
 * all. The node that does not move is then the node nobody touched — the
 * untouched member of a rule whose *other* member is turned — and a reader that
 * only asked about the selection would be silent exactly there.
 *
 * The reduction is `constraintMemberNode`'s, which is looser than
 * `sketchPlacers`'s and is the right one for this question. That function
 * answers "which rule *placed* this node" and must not credit a rule naming a
 * copy; this one answers "why is nothing happening to the thing I have
 * selected", and a rule naming `stt(b1,hover,label)` is the answer to that
 * question when `label` is selected — its refusal sentence is the instruction
 * for fixing it.
 *
 * The switch is asked here rather than inside `refusedMembers`, as that
 * function's own comment requires: an off rule is not inert, it is off.
 */
export function sketchRefusals(
	scene: Scene,
	node: SceneNode,
	picks: Picks = {},
): SketchRefusal[] {
	const out: SketchRefusal[] = [];
	for (const constraint of scene.constraints) {
		if (!constraint.enabled) continue;
		// Asked of every kind rather than filtered by engine first, because
		// `refusedAnchor` asks the table the same question on its own first line
		// and a second copy of that test here is a second place to get it wrong.
		const refused = refusedMembers(scene, constraint, picks);
		if (refused.length === 0) continue;
		const names = constraint.nodes.some(
			(member) => constraintMemberNode(scene, member)?.id === node.id,
		);
		if (!names) continue;
		for (const found of refused) {
			out.push({
				constraint: found.constraint,
				culprit: constraintMemberNode(scene, found.member)?.id ?? found.member,
				why: found.why,
			});
		}
	}
	return out;
}
