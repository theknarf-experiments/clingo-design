/**
 * A {@link Solver} that runs clingo in the current thread.
 *
 * Used by tests and any non-browser caller. The app uses a worker-backed
 * solver instead so a long solve cannot block rendering.
 */
import { Session } from "@clingo-design/clingo-wasm";

import type { Solver, SolverSession } from "./solver.ts";

export const directSolver: Solver = {
	async open(program: string, options = ""): Promise<SolverSession> {
		const session = await Session.open(program, options);
		return {
			solve: (request = {}) => session.solve(request),
			close: () => session.close(),
		};
	},
};
