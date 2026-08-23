import { useEffect, useRef, useState } from "react";
import {
	type Exploration,
	Explorer,
	type Freedom,
	type Measurements,
	type Scene,
	UnsatisfiableError,
} from "@clingo-design/design-core";

import { workerSolver } from "../solver/workerSolver";

export interface ExplorationState {
	exploration: Exploration | null;
	generated: string;
	error: string | null;
	/**
	 * Constraint ids the solver blamed when the document admits no design.
	 * Empty for every other kind of failure, including a bad hand-written rule,
	 * which the solver cannot attribute to anything the UI owns.
	 */
	conflict: string[];
	/** Pinned variables the solver blamed, when the pins are what conflict. */
	pinConflict: string[];
	solving: boolean;
	/** How far the probed nodes' solver-owned coordinates can still travel. */
	freedom: Freedom;
	/** True while the probe is out, so the UI can wait rather than guess. */
	probing: boolean;
}

/**
 * Re-explores whenever the document changes.
 *
 * One {@link Explorer} lives for the life of the editor, so an edit that does
 * not change the compiled program — a rename, a text tweak outside a layout —
 * costs a solve rather than a re-grounding. Solves run in a worker, so a slow
 * one does not freeze the canvas.
 *
 * `measurements` must be referentially stable across renders that do not
 * change it: it is an effect dependency, and a fresh object every render would
 * re-solve forever.
 */
export function useExploration(
	scene: Scene,
	limit = 24,
	seed = 1,
	pins: Readonly<Record<string, number>> = {},
	measurements: Measurements = {},
	probeIds: readonly string[] = [],
): ExplorationState {
	const [state, setState] = useState<ExplorationState>({
		exploration: null,
		generated: "",
		error: null,
		conflict: [],
		pinConflict: [],
		solving: true,
		freedom: {},
		probing: false,
	});

	const explorer = useRef<Explorer | null>(null);
	if (explorer.current === null) explorer.current = new Explorer(workerSolver);

	// Release the grounding when the editor goes away; it lives in the wasm heap.
	useEffect(() => {
		const owned = explorer.current;
		return () => {
			void owned?.close();
			explorer.current = null;
		};
	}, []);

	const run = useRef(0);

	useEffect(() => {
		const generation = ++run.current;
		setState((s) => ({ ...s, solving: true }));

		const timer = setTimeout(async () => {
			try {
				const current = explorer.current;
				if (!current) return;
				// `explore` compiles once and hands the generated half back, so
				// the power panel does not pay for a second compile.
				const exploration = await current.explore(scene, {
					limit,
					seed,
					pins,
					measurements,
				});
				if (generation !== run.current) return;
				setState({
					exploration,
					generated: exploration.generated,
					error: null,
					conflict: [],
					pinConflict: [],
					solving: false,
					// Whatever was probed last was probed against another document.
					freedom: {},
					probing: false,
				});
			} catch (err) {
				if (generation !== run.current) return;
				setState((s) => ({
					exploration: null,
					generated: s.generated,
					error: err instanceof Error ? err.message : String(err),
					conflict: err instanceof UnsatisfiableError ? err.conflict : [],
					pinConflict: err instanceof UnsatisfiableError ? err.pinned : [],
					solving: false,
					freedom: {},
					probing: false,
				}));
			}
		}, 150);

		return () => clearTimeout(timer);
	}, [scene, limit, seed, pins, measurements]);

	/**
	 * Asks how far the probed nodes can still travel, once the design they
	 * would be measured against is on screen.
	 *
	 * A second pass on purpose: two solves per coordinate comes to about what a
	 * whole exploration costs, so this must not sit between an edit and the
	 * design appearing. It runs on the grounding the exploration left open, so
	 * it is solves and nothing else — and it is skipped entirely for a
	 * selection whose geometry is the document's own, which is most of them.
	 */
	const { exploration } = state;
	const solved = exploration?.universes[0]?.solved;
	// The ids as a value, so a fresh array of the same selection is not a
	// reason to spend eight solves again.
	const probeKey = probeIds.join(" ");
	useEffect(() => {
		if (!solved) return;
		const wanted = probeKey
			.split(" ")
			.filter((id) => id.length > 0 && solved[id] !== undefined);
		// Nothing here is the solver's, so there is nothing to say — and saying
		// the last selection's answer about this one would be a lie.
		if (wanted.length === 0) {
			setState((s) =>
				s.probing || Object.keys(s.freedom).length > 0
					? { ...s, freedom: {}, probing: false }
					: s,
			);
			return;
		}
		let live = true;
		setState((s) => ({ ...s, freedom: {}, probing: true }));
		void explorer.current?.probe(solved, wanted).then(
			(freedom) => {
				if (live) setState((s) => ({ ...s, freedom, probing: false }));
			},
			// A probe that raced a re-grounding lost its session; the exploration
			// that overtook it will start another one.
			() => {
				if (live) setState((s) => ({ ...s, probing: false }));
			},
		);
		return () => {
			live = false;
		};
	}, [solved, probeKey]);

	return state;
}
