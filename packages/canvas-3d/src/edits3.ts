/**
 * What a gizmo drag *asks the document to do*, and the one function that does
 * it.
 *
 * ## This file is the exception to the rule the rest of the package keeps
 *
 * Every other module here reads a `ModelScene` — one universe of the answer set
 * — and has never heard of a `Scene`, a `Value`, a token or a pick.
 * `ViewportCanvas.tsx`'s header argues that at length and the argument stands:
 * a *renderer* that read the document would draw a mesh where the document last
 * stored it while the panel beside it showed where a rule had actually put it.
 *
 * An **editor** is the other half of that sentence and needs the other half of
 * the information. A drag has to end in a document, so something has to take
 * one. What this file does is keep the two apart by a module boundary rather
 * than by discipline: there is no React in here, no three.js, nothing that can
 * be mounted, and `TransformGizmo.tsx` — the part that *is* mounted — imports
 * only the {@link SpatialEdit} type from it. The gizmo emits a description of an
 * edit; this applies it; nothing mutates anything anywhere.
 *
 * ## Why the edit is a delta and not a destination
 *
 * A drag knows where it started on screen and how far the pointer has come. It
 * does **not** know where the node "should" end up in the document, and the
 * difference is the whole reason this system exists: the number in the file may
 * be a starting point that a geometric rule then overrode, so a gesture that
 * wrote an absolute position would be writing down the solver's answer as if a
 * designer had typed it. A delta is added to whatever the document actually
 * says, which is exactly what `moveNodes` already does for a 2D drag, and which
 * leaves a constrained node's own number the designer's and the rule's answer
 * the rule's.
 *
 * The deltas are cumulative-since-the-last-one rather than since-the-drag-began,
 * so a caller may apply every edit it is handed, in order, and arrive at the
 * right place. That is the only shape that survives the document being re-solved
 * mid-drag — which it is, on every pointer move, because that is what makes the
 * picture true.
 *
 * ## What a caller does with the phase
 *
 * {@link SpatialEdit.phase} is the undo story and it is deliberately the
 * caller's to tell. Apply every edit; open a history group on `"start"`, close
 * it on `"end"`; the fifty edits between them collapse into one entry called
 * "Move". A package that pushed history itself would be a package that knew
 * about the app's undo stack, which it must not.
 *
 * ## The one thing this refuses
 *
 * **An instance's part cannot be dragged.** The model id for one is the term
 * `inst(i1,label)`, which is not a document node at all — the node it stands for
 * lives inside a component definition, and moving it would move it in every
 * instance of that component at once. That is a real edit and a designer may
 * well want it, but it is a different edit from "move this one", it belongs to
 * the component-editing gesture, and doing it silently from a drag on a copy is
 * the kind of surprise this codebase is written to avoid. So it is refused, by
 * name, in {@link editableNode}, and `TransformGizmo` does not draw a gizmo on
 * one — see {@link gizmoRefusal}, which is the sentence a panel shows.
 */
import {
	type AngleUnit,
	type Picks,
	type Scene,
	type SceneNode,
	type Turn,
	type Value,
	activeIndex,
	angleUnitOf,
	findInTree,
	lit,
	mdegOf,
	moveNodes,
	parseInstancePart,
	rotateVar,
	sceneContext,
	setSpatialValue,
	setTurnValue,
	single,
	spatialDim,
	withSpatial,
	writeAngle,
} from "@clingo-design/design-core";

/**
 * Where in a drag one edit falls.
 *
 * Three values rather than a boolean, because "the drag ended" and "the drag is
 * still going" are not the two states a history stack cares about — it cares
 * about the boundary at each end. A `"start"` edit always carries zero movement
 * and exists solely so a caller can open its group before anything has changed,
 * which is what makes the undo entry restore the pose the drag began from rather
 * than the pose after the first pointer move.
 */
export type EditPhase = "start" | "drag" | "end";

/**
 * One thing a gizmo asks for: a translation, or a turn about one axis.
 *
 * The numbers are **deltas since the previous edit of the same drag**, in the
 * document's own units — EMU for a move, thousandths of a degree for a turn —
 * because those are the units `withSpatial` and `writeAngle` take and because a
 * float would be a rounding the document could not spell.
 *
 * A move carries all three axes at once and a turn carries exactly one, and that
 * asymmetry is the shape of the underlying document rather than an oversight: a
 * translation is a vector and its three components are one gesture, while the
 * three rotations are three separate stored values applied in a fixed order, so
 * a drag that turned two at once would be a drag with no single answer for what
 * it did. See `TransformGizmo.tsx` on why one ring turns exactly one number.
 */
export type SpatialEdit =
	| {
			kind: "move";
			/** The model node's id — which must be a document node. See the header. */
			id: string;
			phase: EditPhase;
			/** EMU, in the node's parent's origin space. */
			dx: number;
			dy: number;
			dz: number;
	  }
	| {
			kind: "turn";
			id: string;
			phase: EditPhase;
			turn: Turn;
			/** Thousandths of a degree, added to whatever the document holds. */
			mdeg: number;
	  };

/** True when this edit would change nothing, whatever the document says. */
export const isEmptyEdit = (edit: SpatialEdit): boolean =>
	edit.kind === "move"
		? edit.dx === 0 && edit.dy === 0 && edit.dz === 0
		: edit.mdeg === 0;

/**
 * The document node an edit is about, or `undefined` when there is not one.
 *
 * Two ways there is not one, and they are different in kind. An `inst(I,N)` term
 * is a *copy*, and the header says why a drag on one is refused. An id the tree
 * simply does not hold is a node that has been deleted since the drag began —
 * which really happens, because a drag survives a re-solve — and the answer to
 * it is the same silence every other edit in this codebase gives an id it cannot
 * find.
 */
export function editableNode(scene: Scene, id: string): SceneNode | undefined {
	if (parseInstancePart(id) !== null) return undefined;
	return findInTree(scene.nodes, id);
}

/**
 * Why a node cannot be dragged in the view, in the words a panel shows — or
 * `undefined` when it can.
 *
 * The twin of `spatial.ts`'s `refusedBounds` and written in its voice: the
 * silence is made visible in the editor rather than left as a handle that does
 * nothing. `TransformGizmo` asks this before it draws, so a part of an instance
 * gets no arrows at all rather than arrows that quietly refuse.
 */
export function gizmoRefusal(scene: Scene, id: string): string | undefined {
	const part = parseInstancePart(id);
	if (part) {
		return `Part of an instance. Move ${part.node} inside the component, or move the whole instance.`;
	}
	return findInTree(scene.nodes, id) ? undefined : "No such node.";
}

/**
 * One edit, applied. Returns the scene unchanged when it cannot be.
 *
 * Unchanged rather than thrown, for the reason every edit in `edits.ts` gives:
 * a gesture arriving at a document that has moved on underneath it is ordinary,
 * not exceptional, and a studio that threw would take the whole canvas down
 * because somebody deleted a mesh mid-drag.
 *
 * `picks` is the universe on screen and it is what makes this safe on a node
 * with two positions: the write lands on the alternative that universe chose and
 * the others are untouched, so dragging a mesh that is in two places moves the
 * one you can see. Exactly `setFrames`'s contract, one axis over.
 */
export function applySpatialEdit(
	scene: Scene,
	edit: SpatialEdit,
	picks: Picks = {},
): Scene {
	if (isEmptyEdit(edit)) return scene;
	if (!editableNode(scene, edit.id)) return scene;
	return edit.kind === "move"
		? applyMove(scene, edit.id, edit.dx, edit.dy, edit.dz, picks)
		: applyTurn(scene, edit.id, edit.turn, edit.mdeg, picks);
}

/** A whole drag's worth, in order. */
export function applySpatialEdits(
	scene: Scene,
	edits: readonly SpatialEdit[],
	picks: Picks = {},
): Scene {
	return edits.reduce((at, edit) => applySpatialEdit(at, edit, picks), scene);
}

/**
 * A translation, split at the seam the document itself is split at.
 *
 * The planar half goes through `moveNodes`, which is the *same* function the 2D
 * drag uses — so a mesh dragged sideways in a viewport and a rectangle dragged
 * sideways on an artboard are literally one code path, with one answer about
 * units, about frozen axes and about which alternative gets written. That was
 * worth more than the symmetry of writing all three axes here would have been.
 *
 * The third axis has no `moveNodes` of its own and this is the nearest correct
 * thing rather than a second implementation of one: `withSpatial` is
 * `design-core`'s drag writer for `z`, stated in `scene.ts` beside `withFrame`
 * and obeying the same three rules, and `setSpatialValue` is `edits.ts`'s way of
 * putting a value into a tree. Composing them applies the drag rule once, in the
 * place that owns it, and leaves this file holding no policy at all.
 *
 * **A `moveNodesInDepth` in `edits.ts` would be better and is not this step's
 * file to write.** It would be four lines — `moveNodes`'s body with `spatialDim`
 * and `withSpatial` swapped in — it would pick up `refreshGroups` for free, and
 * it would put the third axis's drag beside the other two where a reader looks
 * for it. Reported rather than reached for.
 */
function applyMove(
	scene: Scene,
	id: string,
	dx: number,
	dy: number,
	dz: number,
	picks: Picks,
): Scene {
	let next = dx !== 0 || dy !== 0 ? moveNodes(scene, [id], dx, dy, picks) : scene;
	if (dz === 0) return next;
	const node = editableNode(next, id);
	if (!node) return next;
	const context = sceneContext(next, picks);
	const lifted = withSpatial(node, { z: spatialDim(node, "z", context) + dz }, context);
	const value = lifted.spatial?.z;
	// `withSpatial` returns the node it was handed when the write was refused —
	// a `z` that resolves through a token, a delta that rounds to the number
	// already stored — and refusing is its answer rather than an error. So the
	// test is identity, not truthiness: a node that came back unchanged has a
	// perfectly good `spatial.z` that must not be written over itself.
	if (lifted === node || value === undefined) return next;
	next = setSpatialValue(next, id, "z", value);
	return next;
}

/**
 * A turn about one axis, added to whatever the document holds.
 *
 * `setTurnValue` is `edits.ts`'s, and the value handed to it comes from
 * {@link turnWritten} below.
 */
function applyTurn(
	scene: Scene,
	id: string,
	turn: Turn,
	mdeg: number,
	picks: Picks,
): Scene {
	const node = editableNode(scene, id);
	if (!node) return scene;
	const value = turnWritten(node, turn, mdeg, picks);
	return value ? setTurnValue(scene, id, turn, value) : scene;
}

/**
 * A rotation nudged by a delta, as the value to store — **`withTurn`, written in
 * the wrong package, and saying so.**
 *
 * `design-core/src/scene.ts` has `withFrame` and it has `withSpatial`, the two
 * drag writers, each stating the same three rules: the write lands on *the
 * alternative the visible universe picked*, an alternative that is a token
 * reference or a derivation is left exactly as it is, and the number is written
 * back **in the unit it was already spelled in**. There is no `withTurn`. That is
 * a gap rather than a decision, and the evidence is upstream: `angleUnitOf`'s own
 * comment in `values.ts` says it exists because "a rotation nudged by a drag
 * reads the angle, adds a delta and writes the sum back, and it is this that lets
 * it write `0.3turn` rather than `108deg`" — the exact sentence, for the exact
 * function that was then not written.
 *
 * So this is that function, put here because `scene.ts` is not this step's file
 * to touch, written to be deleted: the day `withTurn(node, patch, context)` lands
 * upstream, this body becomes a call to it and this comment becomes a line in a
 * changelog. It follows `withSpatial` clause for clause, including the one place
 * the two agree and `withFrame` does not — a dimension the node **does not hold
 * at all** is written as a fresh literal rather than skipped, because the third
 * axis and the rotations are both sparse, absence there is *silence* rather than
 * a link, and there is no other way to state a rotation for the first time.
 *
 * The one clause it does not share is the clamp. `withFrame` pushes a span up to
 * `MIN_NODE_SIZE` and `withSpatial` deliberately does not clamp `depth`; an angle
 * has no minimum and no maximum at all. It is also **not wrapped into
 * `[0, 360)`**, and that is deliberate rather than forgotten: 370° and 10° are
 * the same pose and different numbers, a designer who dragged a ring twice round
 * meant the second turn, and an animation between two states that reads `350deg`
 * and `370deg` takes the short way where one that reads `350deg` and `10deg`
 * takes the long way. Wrapping would silently change what a machine does.
 *
 * Returns `undefined` for "no edit", which covers a refused write, a delta of
 * zero, and a delta so small it rounds to the angle already stored.
 */
export function turnWritten(
	node: SceneNode,
	turn: Turn,
	mdeg: number,
	picks: Picks = {},
): Value | undefined {
	const value = node.turn?.[turn];
	if (value === undefined || value.length === 0) {
		// Silence, written for the first time. `writeAngle`'s default unit is
		// `deg`, which is the unit every other angle in this codebase is born in.
		return mdeg === 0 ? undefined : single(writeAngle(mdeg));
	}
	const index = activeIndex(value, rotateVar(node.id, turn), picks);
	const term = index === -1 ? undefined : value[index];
	if (term?.kind !== "literal") return undefined;
	const current = mdegOf(term.value);
	// A literal that is not an angle at all — a colour, a stray word, a token's
	// name typed by hand. Left exactly as it is, on `normalizeScene`'s principle
	// that a stored document is read rather than repaired.
	if (current === undefined) return undefined;
	const unit: AngleUnit = angleUnitOf(term.value) ?? "deg";
	const written = writeAngle(current + mdeg, unit);
	if (written === term.value) return undefined;
	return value.map((t, i) => (i === index ? lit(written) : t));
}
