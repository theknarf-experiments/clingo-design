/**
 * The seam between the document layer and clingo.
 *
 * `design-core` never imports the WebAssembly module directly: it talks to a
 * {@link Solver}. That keeps the package testable in Node against a direct
 * in-process session, while the app supplies a worker-backed implementation
 * so a slow solve cannot freeze the UI.
 */

export type EnumMode = "auto" | "brave" | "cautious" | "optN";

export interface Assumption {
	atom: string;
	/** Defaults to true. */
	sign?: boolean;
}

export interface SolveRequest {
	mode?: EnumMode;
	/** 0 enumerates everything. */
	models?: number;
	assumptions?: readonly Assumption[];
	/** Skip collecting symbols; only `count` is filled in. */
	countOnly?: boolean;
}

export interface SolveOutcome {
	result: "SATISFIABLE" | "UNSATISFIABLE" | "UNKNOWN";
	models: string[][];
	count: number;
	exhausted: boolean;
	optimal: boolean;
	costs: number[];
	/** On UNSAT: which of the supplied assumptions conflict. */
	core: string[];
	stderr: string;
}

/** A program that has been grounded once and can be solved repeatedly. */
export interface SolverSession {
	solve(request?: SolveRequest): Promise<SolveOutcome>;
	close(): Promise<void>;
}

export interface Solver {
	/**
	 * Grounds `program`. Rejects if it does not ground.
	 * `options` are clingo command-line flags, space separated.
	 */
	open(program: string, options?: string): Promise<SolverSession>;
}
