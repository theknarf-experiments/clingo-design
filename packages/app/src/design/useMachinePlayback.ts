import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Scene,
	type Trigger,
	machineTable,
	stepMachine,
} from "@clingo-design/design-core";

/**
 * What the canvas is pretending about, while the document goes on saying
 * something else.
 *
 * See {@link useMachinePlayback} for why that sentence is the whole design.
 */
export interface Playback {
	/** Instance node id -> the state the canvas is drawing. */
	playing: Readonly<Record<string, string>>;
	/** Drive one instance to a state; null hands it back to the document. */
	play: (instance: string, state: string | null) => void;
	/**
	 * Feed a trigger at an instance and follow the edge, if there is one.
	 * Returns the state it landed in, or null if nothing moved.
	 *
	 * This is what the canvas calls on a real pointer event, and it is the same
	 * `stepMachine` the exported runtime interprets — so watching it in the
	 * studio and clicking it in a browser cannot disagree.
	 */
	fire: (instance: string, trigger: Trigger) => string | null;
	clear: () => void;
}

/**
 * Nothing is being played, spelled once.
 *
 * A shared object rather than a fresh `{}`, because {@link Playback.playing} is
 * handed straight to `Artboard`, which is memoised: a new empty object every
 * render would re-render every artboard on the canvas on every pointermove, for
 * a change that is not a change. The same argument `NO_PICKS` in Studio.tsx
 * makes, one prop over.
 */
const NOTHING: Readonly<Record<string, string>> = {};

/**
 * Playing a machine on the canvas, without touching the document.
 *
 * **This costs no solve, and that is the whole reason it can exist at all.**
 * Every state of every instance is already in the one answer set — that is the
 * invariant the feature turns on — so `ModelScene.states` holds `hover` and
 * `pressed` and `open` sitting beside the picture, and drawing one of them is
 * the canvas reading a different entry out of a model it already has. Nothing
 * recompiles, nothing re-grounds, nothing lands in undo. Compare the thing this
 * is *not*: `SceneNode.state` — which state the document draws an instance in —
 * is an edit, is a fact the compiler emits, re-grounds, and does land in undo.
 * Two acts that look identical on screen and are opposite in kind, which is why
 * they have different names in the panels ("Play" against "Draw this in…").
 *
 * The state lives here, in the editor, beside the pins and the zero point and
 * for the same reason those do: it is a decision about the person looking
 * rather than about the design. Two people may watch the same document's button
 * in two different states without disagreeing about anything, and a document
 * that carried it would mean opening a file and finding somebody else's pointer
 * still resting on the button.
 *
 * ### Why the current state is a ref as well as a state
 *
 * `fire` has to read where the machine *is* and write where it lands, and it is
 * called from a pointer handler that may run more than once before React
 * re-renders — a `pointerup` and the `click` that follows it, or the chain of
 * `load` edges the studio walks when preview is switched on. Reading `playing`
 * out of the closure would make the second call in such a run read the state
 * from before the first, so a two-step chain would take one step and a load
 * chain would stop after its first edge. The ref is the authority and the React
 * state is its shadow, committed together, so the two can never be seen apart.
 *
 * ### What it deliberately does not do
 *
 * There is no timer here and no animation clock. What paces a transition on the
 * canvas is CSS, exactly as in the exported file: the studio hands the artboard
 * a duration and an easing and the browser's compositor does the moving. A
 * script that also waited before switching state would apply every delay twice.
 * `runtime.ts` makes the same argument about the emitted runtime, and it is the
 * same argument because it is the same design.
 *
 * And there is no validation of `trigger` against what the machine listens for:
 * {@link stepMachine} answers `undefined` for a trigger no edge takes, which is
 * the same answer as "no edge from here", which is the same answer the exported
 * runtime gives. One lookup, one answer, three callers.
 */
export function useMachinePlayback(scene: Scene): Playback {
	/**
	 * The flattened machines, and the only thing here that reads the document.
	 *
	 * The same table the export ships in its `<script>` — see `machineTable` —
	 * so the studio cannot follow an edge the file would not, or refuse one it
	 * would. Memoised on the whole scene rather than on `scene.machines`,
	 * because which instances a machine drives depends on the nodes too.
	 */
	const table = useMemo(() => machineTable(scene), [scene]);

	const live = useRef<Readonly<Record<string, string>>>(NOTHING);
	const [playing, setPlaying] = useState<Readonly<Record<string, string>>>(NOTHING);

	/** Write both halves at once, so nothing can read one without the other. */
	const commit = useCallback((next: Readonly<Record<string, string>>) => {
		live.current = next;
		setPlaying(next);
	}, []);

	/**
	 * Forget a played state the document no longer admits.
	 *
	 * A machine deleted, a state deleted, an instance deleted, a definition that
	 * stopped being one: any of those leaves an entry pointing at a state copy
	 * that is not in the answer set any more, and the canvas would quietly go on
	 * drawing the instance's own picture while a panel said it was playing
	 * something. Dropping the entry is the honest reading — the machine is not
	 * where it was, so it is nowhere — and it is the same shape as the studio's
	 * pin pruning, which drops a pin on an alternative that has since gone.
	 *
	 * Against the table rather than against the document directly, so that the
	 * one place that decides which states an instance may be in is the one place
	 * that decides which states it may be *played* in.
	 */
	useEffect(() => {
		const at = live.current;
		const kept = Object.entries(at).filter(([instance, state]) => {
			const driven = table.instances[instance];
			return (
				driven !== undefined &&
				(table.machines[driven.machine]?.states.includes(state) ?? false)
			);
		});
		if (kept.length === Object.keys(at).length) return;
		commit(kept.length === 0 ? NOTHING : Object.fromEntries(kept));
	}, [table, commit]);

	const play = useCallback(
		(instance: string, state: string | null) => {
			const at = live.current;
			if (state === null) {
				if (!(instance in at)) return;
				const { [instance]: _handedBack, ...rest } = at;
				commit(Object.keys(rest).length === 0 ? NOTHING : rest);
				return;
			}
			// A state the machine has not got is not played and not reported as an
			// error either. The panels build their buttons out of `machine.states`,
			// so the only way to get here with a bad id is a document edited under a
			// panel that has not re-rendered yet — and drawing nothing at all for a
			// beat is better than drawing a state copy that is not in the answer set.
			const driven = table.instances[instance];
			if (!driven) return;
			if (!table.machines[driven.machine]?.states.includes(state)) return;
			if (at[instance] === state) return;
			commit({ ...at, [instance]: state });
		},
		[table, commit],
	);

	const fire = useCallback(
		(instance: string, trigger: Trigger): string | null => {
			const driven = table.instances[instance];
			if (!driven) return null;
			// Where the machine is: what it is being played in, or — having been
			// played in nothing — the state the document draws it in. `initial` on
			// the table is per instance and is exactly `shownState`, so an instance
			// the document draws in `open` starts its playback in `open` rather than
			// jumping to the machine's first state the moment a pointer touches it.
			const from = live.current[instance] ?? driven.initial;
			const to = stepMachine(table, instance, from, trigger);
			if (to === undefined) return null;
			// A self-edge counts as a move and reports where it landed, which is the
			// same answer `MACHINE_RUNTIME.fire` gives: "this trigger did something
			// here" is a different claim from "the picture changed", and only the
			// first one is a question about the machine.
			commit({ ...live.current, [instance]: to });
			return to;
		},
		[table, commit],
	);

	const clear = useCallback(() => {
		if (Object.keys(live.current).length === 0) return;
		commit(NOTHING);
	}, [commit]);

	return { playing, play, fire, clear };
}
