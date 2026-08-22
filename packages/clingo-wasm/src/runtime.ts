/**
 * Shared plumbing for both entry points: the WebAssembly instance, output
 * capture and call serialisation.
 *
 * The instance is created once and reused — instantiating the 2 MB module per
 * call would dominate the cost of a small solve — and every call goes through
 * one queue, because clingo is single-threaded here and its output is captured
 * through shared buffers.
 */
import createClingo, { type ClingoModule } from "../wasm/clingo.mjs";

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

export interface ClingoStreams {
	code: number;
	stdout: string;
	stderr: string;
}

/** Thrown when clingo reports an error rather than a solve outcome. */
export class ClingoError extends Error {
	readonly code: number;
	readonly stdout: string;
	readonly stderr: string;

	constructor(message: string, streams: ClingoStreams) {
		super(message);
		this.name = "ClingoError";
		this.code = streams.code;
		this.stdout = streams.stdout;
		this.stderr = streams.stderr;
	}
}

let modulePromise: Promise<ClingoModule> | undefined;
let stdout: string[] = [];
let stderr: string[] = [];

export function load(): Promise<ClingoModule> {
	const existing = modulePromise;
	if (existing !== undefined) return existing;

	const created = createClingo({
		print: (line) => stdout.push(line),
		printErr: (line) => stderr.push(line),
	});
	modulePromise = created;
	return created;
}

/**
 * Releases the cached WebAssembly instance. Any open {@link Session} becomes
 * invalid, since its grounded state lived in that instance.
 */
export function reset(): void {
	modulePromise = undefined;
}

/** Eagerly instantiate the module, e.g. to warm it up behind a loading state. */
export async function init(): Promise<void> {
	await load();
}

let queue: Promise<unknown> = Promise.resolve();

export interface Captured<T> {
	value: T;
	stdout: string;
	stderr: string;
}

/**
 * Runs `call` with exclusive access to the instance and returns whatever it
 * printed. Calls are serialised: overlapping runs would interleave output.
 */
export function withOutput<T>(call: () => T): Promise<Captured<T>> {
	const result = queue.then(() => {
		stdout = [];
		stderr = [];
		try {
			const value = call();
			return { value, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
		} finally {
			stdout = [];
			stderr = [];
		}
	});
	// Keep the chain alive even if this call rejects.
	queue = result.catch(() => undefined);
	return result;
}
