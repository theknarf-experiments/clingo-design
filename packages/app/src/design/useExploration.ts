import { useEffect, useRef, useState } from "react";
import {
	type Exploration,
	Explorer,
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
}

/**
 * Re-explores whenever the document changes.
 *
 * One {@link Explorer} lives for the life of the editor, so an edit that does
 * not change the compiled program — a rename, a text tweak — costs a solve
 * rather than a re-grounding. Solves run in a worker, so a slow one does not
 * freeze the canvas.
 */
export function useExploration(
	scene: Scene,
	limit = 24,
	seed = 1,
	pins: Readonly<Record<string, number>> = {},
): ExplorationState {
	const [state, setState] = useState<ExplorationState>({
		exploration: null,
		generated: "",
		error: null,
		conflict: [],
		pinConflict: [],
		solving: true,
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
				const exploration = await current.explore(scene, { limit, seed, pins });
				if (generation !== run.current) return;
				setState({
					exploration,
					generated: exploration.generated,
					error: null,
					conflict: [],
					pinConflict: [],
					solving: false,
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
				}));
			}
		}, 150);

		return () => clearTimeout(timer);
	}, [scene, limit, seed, pins]);

	return state;
}
