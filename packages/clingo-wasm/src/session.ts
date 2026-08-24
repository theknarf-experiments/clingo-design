/**
 * Persistent solving sessions.
 *
 * A {@link Session} grounds a program once and then answers many solves under
 * different assumptions. That is the difference between re-solving a design
 * from scratch on every interaction and just flipping a literal.
 */
import { ClingoError, ExitCode, load, withOutput } from "./runtime.ts";

/**
 * `auto` enumerates answer sets, `brave`/`cautious` compute consequences, and
 * `optN` enumerates only proven optima of the program's weak constraints.
 */
export type EnumMode = "auto" | "brave" | "cautious" | "optN";

/** A signed literal to assume: `pick(tok(accent),1)` held true or false. */
export interface Assumption {
	atom: string;
	/** Defaults to true. */
	sign?: boolean;
}

export interface SolveOutcome {
	result: "SATISFIABLE" | "UNSATISFIABLE" | "UNKNOWN";
	/** Answer sets, as shown atoms. Empty when counting. */
	models: string[][];
	/** Models seen, even when symbols were not collected. */
	count: number;
	/** True when the search space was exhausted rather than capped. */
	exhausted: boolean;
	/** True when the last model is a proven optimum. */
	optimal: boolean;
	/**
	 * The last model's cost vector, one entry per priority level the program
	 * uses, *highest level first*. Empty unless the solve was asked to rank.
	 */
	costs: number[];
	/**
	 * The same, per returned model and in the same order as {@link models}.
	 *
	 * A bounded enumeration does not come back best-first — clingo returns the
	 * models within the bound in search order and the optimum is often last — so
	 * this is what a caller sorts by. Empty vectors when nothing was ranked.
	 */
	modelCosts: number[][];
	/**
	 * On UNSATISFIABLE: the subset of the supplied assumptions that conflict,
	 * in the exact form they were passed. Empty when the program itself is
	 * unsatisfiable regardless of assumptions.
	 */
	core: string[];
	/** Anything clingo wrote to stderr — warnings, info messages. */
	stderr: string;
}

export interface SolveRequest {
	mode?: EnumMode;
	/** 0 enumerates everything. */
	models?: number;
	assumptions?: readonly Assumption[];
	/** Skip collecting symbols; only `count` is filled in. */
	countOnly?: boolean;
	/**
	 * A lexicographic ceiling on the cost vector: every model at or under it is
	 * an answer, and each comes back with its own cost. Highest priority level
	 * first, and a level left off the end is unbounded.
	 *
	 * This is the answer to "show me every design within a whisker of the best"
	 * — which is a different question from `optN`, and the only one worth asking
	 * of a program that is meant to hold several designs at once. Without it the
	 * program's weak constraints are *ignored*: they cost nothing, restrict
	 * nothing, and every model is an equal answer.
	 */
	bound?: readonly number[];
}

/**
 * Signed terms, newline separated — the wire format the C shim reads.
 *
 * Newlines rather than semicolons: an ASP string literal may contain ';' but
 * never a raw newline, so this cannot be ambiguous.
 */
function encode(
	literals: ReadonlyArray<{ atom: string; sign?: boolean }>,
): string {
	return literals
		.map((a) => (a.sign === false ? `-${a.atom}` : `+${a.atom}`))
		.join("\n");
}

/**
 * Reads the JSON envelope every entry point writes to stdout.
 *
 * A non-parseable stdout means the module died before it could report, so
 * stderr carries the only detail there is.
 */
function envelope(
	stdout: string,
	stderr: string,
	whenSilent: string,
): RawOutcome {
	let parsed: RawOutcome;
	try {
		parsed = JSON.parse(stdout) as RawOutcome;
	} catch {
		throw new ClingoError(stderr.trim() || whenSilent, {
			code: ExitCode.ERROR,
			stdout,
			stderr,
		});
	}
	if (parsed.error) {
		throw new ClingoError(parsed.error, {
			code: ExitCode.ERROR,
			stdout,
			stderr,
		});
	}
	return parsed;
}

interface RawOutcome {
	error?: string;
	result?: SolveOutcome["result"];
	models?: string[][];
	count?: number;
	exhausted?: boolean;
	optimal?: boolean;
	costs?: number[];
	modelCosts?: number[][];
	core?: string[];
}

export class Session {
	#id: number;
	#closed = false;
	#diagnostics: string;

	private constructor(id: number, diagnostics: string) {
		this.#id = id;
		this.#diagnostics = diagnostics;
	}

	/**
	 * What clingo said about the program while grounding it — an unsafe
	 * variable, a `#show` for a predicate nothing derives, an atom in a body
	 * that no rule ever puts in a head. Empty for a program it had nothing to
	 * say about.
	 *
	 * A property of the *program* rather than of a solve, which is why it is
	 * captured once here: these arise while grounding, and a session grounds
	 * once and then solves many times. Not an error — every one of these
	 * programs ran. They are the difference between a typo that is silent and
	 * one the panel can point at.
	 */
	get diagnostics(): string {
		return this.#diagnostics;
	}

	/**
	 * Grounds `program` and keeps it. `options` are clingo command-line flags
	 * applied to the underlying control (space separated).
	 *
	 * @throws {ClingoError} if the program does not ground.
	 */
	static async open(program: string, options = ""): Promise<Session> {
		const mod = await load();
		const { value: id, stdout, stderr } = await withOutput(() =>
			mod.ccall(
				"cd_open",
				"number",
				["string", "string"],
				[program, options],
			),
		);
		if (id < 0) {
			let message = stderr.trim();
			try {
				const parsed = JSON.parse(stdout) as RawOutcome;
				if (parsed.error) message = message || parsed.error;
			} catch {
				// stdout was not the error envelope; stderr already has the detail.
			}
			throw new ClingoError(message || "clingo failed to ground the program", {
				code: ExitCode.ERROR,
				stdout,
				stderr,
			});
		}
		// Whatever clingo said while grounding a program it nonetheless accepted.
		return new Session(id, stderr.trim());
	}

	get closed(): boolean {
		return this.#closed;
	}

	async solve(request: SolveRequest = {}): Promise<SolveOutcome> {
		if (this.#closed) throw new Error("session is closed");
		const mod = await load();
		const mode = request.countOnly ? "count" : (request.mode ?? "auto");
		const { stdout, stderr } = await withOutput(() =>
			mod.ccall(
				"cd_solve",
				"number",
				["number", "string", "number", "string", "string"],
				[
					this.#id,
					mode,
					request.models ?? 0,
					encode(request.assumptions ?? []),
					(request.bound ?? []).map((n) => Math.round(n)).join(","),
				],
			),
		);

		const parsed = envelope(stdout, stderr, "clingo produced no parseable output");

		return {
			result: parsed.result ?? "UNKNOWN",
			models: parsed.models ?? [],
			count: parsed.count ?? parsed.models?.length ?? 0,
			exhausted: parsed.exhausted ?? false,
			optimal: parsed.optimal ?? false,
			costs: parsed.costs ?? [],
			modelCosts: parsed.modelCosts ?? [],
			core: parsed.core ?? [],
			stderr,
		};
	}

	/**
	 * Sets the truth of `#external` atoms on the grounded program.
	 *
	 * Unlike assumptions, externals persist until changed, so this is the
	 * mechanism for state a program should keep between solves rather than for
	 * a transient what-if query. Omit `sign` to release an atom back to free.
	 */
	async setExternals(
		externals: ReadonlyArray<{ atom: string; sign?: boolean }>,
	): Promise<void> {
		if (this.#closed) throw new Error("session is closed");
		if (externals.length === 0) return;
		const mod = await load();
		const { stdout, stderr } = await withOutput(() =>
			mod.ccall(
				"cd_externals",
				"number",
				["number", "string"],
				[this.#id, encode(externals)],
			),
		);
		envelope(stdout, stderr, "clingo produced no output");
	}

	/** Releases the grounded program. Safe to call twice. */
	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		const mod = await load();
		mod.ccall("cd_close", null, ["number"], [this.#id]);
	}
}

/** Live session count — exposed so tests can catch leaks. */
export async function sessionCount(): Promise<number> {
	const mod = await load();
	return mod.ccall("cd_session_count", "number", [], []);
}
