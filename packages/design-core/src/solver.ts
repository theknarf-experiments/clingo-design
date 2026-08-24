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
	/**
	 * A lexicographic ceiling on the cost vector, highest priority level first:
	 * every model at or under it is an answer, each with its own cost. A level
	 * left off the end is unbounded.
	 *
	 * Absent, the program's weak constraints are *ignored* — they cost nothing
	 * and rule nothing out. That is the default on purpose: a tool whose point is
	 * holding several designs at once must not turn into one that shows the
	 * single best design the moment a preference is written down. See
	 * `rankedBound` in explore.ts for where the number comes from.
	 */
	bound?: readonly number[];
}

export interface SolveOutcome {
	result: "SATISFIABLE" | "UNSATISFIABLE" | "UNKNOWN";
	models: string[][];
	count: number;
	exhausted: boolean;
	optimal: boolean;
	/** The last model's cost, one entry per level, highest level first. */
	costs: number[];
	/**
	 * The same, per returned model and in `models` order.
	 *
	 * A bounded enumeration comes back in search order, not best first — the
	 * optimum is often the last model of the run — so this is what a caller
	 * sorts by. Empty vectors when nothing was ranked.
	 */
	modelCosts: number[][];
	/** On UNSAT: which of the supplied assumptions conflict. */
	core: string[];
	stderr: string;
}

/** A program that has been grounded once and can be solved repeatedly. */
export interface SolverSession {
	solve(request?: SolveRequest): Promise<SolveOutcome>;
	close(): Promise<void>;
	/**
	 * What clingo said about the program while grounding it, and nothing about
	 * any one solve — an atom in a body no rule derives, a `#show` for a
	 * predicate that is not there.
	 *
	 * Grounding-time, so it belongs to the program rather than to an answer: a
	 * session grounds once and solves many times. These are not errors; the
	 * program ran. They are what makes a typo in a hand-written rule visible
	 * instead of silent, which is the whole reason the channel is here.
	 */
	readonly diagnostics: string;
}

export interface Solver {
	/**
	 * Grounds `program`. Rejects if it does not ground.
	 * `options` are clingo command-line flags, space separated.
	 */
	open(program: string, options?: string): Promise<SolverSession>;
}
