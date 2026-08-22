/**
 * One-shot solving: grounds and solves in a single call.
 *
 * Kept for scripting and for programs that are solved once. Anything that
 * re-solves the same program — new assumptions, a different enumeration mode —
 * should use a {@link Session} instead, which grounds only once.
 */
import { ClingoError, ExitCode, load, withOutput } from "./runtime.ts";

/** Raw result of invoking the clingo binary. */
export interface ClingoRunResult {
	/** clingo's exit code — see {@link ExitCode}. */
	code: number;
	/** Everything written to stdout. */
	stdout: string;
	/** Everything written to stderr (warnings, parse errors). */
	stderr: string;
}

/** One answer set, as returned by clingo's JSON output. */
export interface ClingoWitness {
	Value: string[];
	Costs?: number[];
}

/** clingo's `--outf=2` JSON document. */
export interface ClingoSolveResult {
	Result:
		| "SATISFIABLE"
		| "UNSATISFIABLE"
		| "OPTIMUM FOUND"
		| "UNKNOWN"
		| (string & {});
	Models: {
		Number: number;
		More: "yes" | "no";
		Optimal?: number;
	};
	Call: Array<{ Witnesses?: ClingoWitness[] }>;
	Solver?: string;
	Input?: string[];
	Time?: Record<string, number>;
}

export interface SolveOptions {
	/**
	 * How many models to enumerate. `0` means all of them.
	 * Ignored when `args` already contains `--models`/`-n`.
	 * @default 1
	 */
	models?: number;
	/** Extra command-line arguments passed straight through to clingo. */
	args?: string[];
}

/**
 * Runs clingo over `program` with the given command-line arguments and returns
 * its raw output.
 */
export async function run(
	program: string,
	args: readonly string[] = [],
): Promise<ClingoRunResult> {
	const mod = await load();
	const { value: code, stdout, stderr } = await withOutput(() =>
		mod.ccall(
			"run",
			"number",
			["string", "string"],
			[program, args.join(" ")],
		),
	);
	return { code, stdout, stderr };
}

/**
 * Solves an ASP program and returns clingo's parsed JSON output.
 *
 * @throws {ClingoError} if clingo fails or emits unparseable output.
 */
export async function solve(
	program: string,
	options: SolveOptions = {},
): Promise<ClingoSolveResult> {
	const { models = 1, args = [] } = options;

	const hasModels = args.some(
		(a) => a === "-n" || a.startsWith("--models") || /^-n\d/.test(a),
	);
	const hasOutf = args.some((a) => a.startsWith("--outf"));

	const argv = [
		...(hasModels ? [] : [`--models=${models}`]),
		// JSON output; the wrapper's contract is a parsed document.
		...(hasOutf ? [] : ["--outf=2"]),
		...args,
	];

	const result = await run(program, argv);

	if (result.code === ExitCode.ERROR || result.code === ExitCode.NO_RUN) {
		throw new ClingoError(
			result.stderr.trim() || `clingo exited with code ${result.code}`,
			result,
		);
	}

	try {
		return JSON.parse(result.stdout) as ClingoSolveResult;
	} catch {
		throw new ClingoError(
			result.stderr.trim() || "clingo produced no parseable JSON output",
			result,
		);
	}
}

/**
 * Convenience accessor for the answer sets of a solve result, each one a list
 * of the shown atoms.
 */
export function answerSets(result: ClingoSolveResult): string[][] {
	return result.Call.flatMap((call) =>
		(call.Witnesses ?? []).map((witness) => witness.Value),
	);
}
