import createClingo, { type ClingoModule } from "../wasm/clingo.mjs";

/** Raw result of invoking the clingo binary. */
export interface ClingoRunResult {
	/** clingo's exit code — see {@link ExitCode}. */
	code: number;
	/** Everything written to stdout. */
	stdout: string;
	/** Everything written to stderr (warnings, parse errors). */
	stderr: string;
}

/**
 * clingo exit codes, which are a bit field. A satisfiable run that also
 * exhausted the search space returns `SATISFIABLE | EXHAUSTED` (30).
 */
export const ExitCode = {
	UNKNOWN: 0,
	INTERRUPTED: 1,
	SATISFIABLE: 10,
	EXHAUSTED: 20,
	OUT_OF_MEMORY: 33,
	ERROR: 65,
	NO_RUN: 128,
} as const;

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

/** Thrown when clingo reports an error rather than a solve outcome. */
export class ClingoError extends Error {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;

	constructor(message: string, result: ClingoRunResult) {
		super(message);
		this.name = "ClingoError";
		this.code = result.code;
		this.stdout = result.stdout;
		this.stderr = result.stderr;
	}
}

let modulePromise: Promise<ClingoModule> | undefined;
let stdout: string[] = [];
let stderr: string[] = [];

function loadModule(): Promise<ClingoModule> {
	const existing = modulePromise;
	if (existing !== undefined) return existing;

	// The Emscripten instance is created once and reused: instantiating the
	// 2 MB module per call would dominate the cost of a small solve. The
	// print callbacks read the module-level buffers, which `run` swaps out
	// around each invocation.
	const created = createClingo({
		print: (line) => stdout.push(line),
		printErr: (line) => stderr.push(line),
	});
	modulePromise = created;
	return created;
}

/**
 * Releases the cached WebAssembly instance. The next call re-instantiates it.
 * Mainly useful for reclaiming memory after a run that grew the heap.
 */
export function reset(): void {
	modulePromise = undefined;
}

/** Eagerly instantiate the module, e.g. to warm it up behind a loading state. */
export async function init(): Promise<void> {
	await loadModule();
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs clingo over `program` with the given command-line arguments and returns
 * its raw output.
 *
 * Calls are serialised: the underlying instance is single-threaded and its
 * output is captured through shared buffers, so overlapping runs would
 * interleave.
 */
export function run(
	program: string,
	args: readonly string[] = [],
): Promise<ClingoRunResult> {
	const result = queue.then(() => runExclusive(program, args));
	// Keep the chain alive even if this call rejects.
	queue = result.catch(() => undefined);
	return result;
}

async function runExclusive(
	program: string,
	args: readonly string[],
): Promise<ClingoRunResult> {
	const mod = await loadModule();
	stdout = [];
	stderr = [];
	try {
		const code = mod.ccall(
			"run",
			"number",
			["string", "string"],
			[program, args.join(" ")],
		);
		return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
	} finally {
		stdout = [];
		stderr = [];
	}
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
