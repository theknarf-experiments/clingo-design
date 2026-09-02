import { DRAG_SLOP_PX, type Trigger, TRIGGERS } from "@clingo-design/design-core";

/**
 * A drag, recognised — the studio's half of what the exported runtime's
 * `bindDrag` does.
 *
 * **Lifted out of `Editor.tsx` because present mode needs it too**, which is the
 * same argument `instanceAt` and `linkAt` are lifted on: a machine whose whole
 * point is a gesture would do nothing in the presentation and everything in the
 * file, and a second implementation of "is this a drag yet" is a thing that can
 * disagree with the first. There are already two readers of that sentence — this
 * one and the emitted interpreter, which `runtime.test.ts` holds to the same
 * table — and a third would be one too many.
 *
 * A tiny mutable object rather than a hook, deliberately: a slop test is a fact
 * about the previous event, nothing about it is drawn, and re-rendering a canvas
 * on every pixel of a drag while a transition is mid-flight is the stutter that
 * gets blamed on the design. Both callers hold one in a ref.
 *
 * **Client coordinates and never document ones**, which is {@link DRAG_SLOP_PX}'s
 * own instruction: a canvas that pans and zooms would otherwise make three
 * document pixels under one pixel of finger travel at 25% and twelve at 400% —
 * a gesture that behaved differently depending on how closely somebody was
 * looking, and differently from the exported file, which has no zoom to be at.
 * So this takes raw `clientX`/`clientY` and converts nothing.
 */
export interface Gestures {
	/**
	 * A pointer went down on something. Nothing is a drag yet — the threshold IS
	 * the gesture, and a drag with no slop is `pointerdown` under another name.
	 */
	down: (on: string, at: { clientX: number; clientY: number }) => void;
	/**
	 * The pointer moved. Answers the trigger to fire, or nothing.
	 *
	 * Fires `dragbegin` **once**, on the first crossing, and never again until the
	 * pointer comes up — which is what makes it a beginning rather than a stream.
	 * A `dragbegin` per pixel would take a second edge out of the state the first
	 * one arrived in.
	 */
	move: (at: { clientX: number; clientY: number }) => Trigger | undefined;
	/**
	 * The gesture is over, however it ended: the pointer came up, it was
	 * cancelled, or it left the surface. All of them fire `dragend` where one had
	 * begun, because a gesture that stopped reporting is a gesture that ended and
	 * a machine left in its dragging state would be a machine stuck there.
	 */
	end: () => { on: string; trigger: Trigger } | undefined;
	/**
	 * Whether the click that follows should be swallowed, consuming the arm.
	 *
	 * Read off `TRIGGERS[...].suppresses` rather than tested against `"click"`, for
	 * the reason the emitted runtime does the same: "a drag is not also a click" is
	 * one sentence and it cannot be true for one reader and false for the other.
	 * The studio synthesises its own click — the DOM's would land on an overlay —
	 * so here the swallow is a click this side declines to *send*, where in the
	 * file it is one a capture listener declines to let through.
	 */
	swallows: (trigger: Trigger) => boolean;
	/** Forget everything, without firing. Leaving a mode is not a gesture ending. */
	clear: () => void;
}

export function gestures(): Gestures {
	let on: string | null = null;
	let from: { x: number; y: number } | null = null;
	let dragging = false;
	let armed: Trigger | undefined;

	return {
		down(id, at) {
			on = id;
			from = { x: at.clientX, y: at.clientY };
			dragging = false;
		},
		move(at) {
			if (from === null || on === null || dragging) return undefined;
			const dx = at.clientX - from.x;
			const dy = at.clientY - from.y;
			// Squared, so there is no square root and no floating-point comparison
			// against a threshold that is a whole number of pixels — the same shape
			// the emitted runtime uses, because it is the same test.
			if (dx * dx + dy * dy < DRAG_SLOP_PX * DRAG_SLOP_PX) return undefined;
			dragging = true;
			return "dragbegin";
		},
		end() {
			const was = on;
			from = null;
			on = null;
			if (!dragging) return undefined;
			dragging = false;
			armed = TRIGGERS.dragend.suppresses;
			return was === null ? undefined : { on: was, trigger: "dragend" };
		},
		swallows(trigger) {
			const eat = armed === trigger;
			// Consumed by the very next one, whatever it is, so the gesture after a
			// drag is ordinary again — and so a swallow left armed cannot eat the
			// first click of something entirely unrelated.
			armed = undefined;
			return eat;
		},
		clear() {
			on = null;
			from = null;
			dragging = false;
			armed = undefined;
		},
	};
}
