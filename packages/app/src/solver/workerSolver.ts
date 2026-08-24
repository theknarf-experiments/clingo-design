/**
 * A {@link Solver} backed by the solver worker.
 *
 * One worker serves the whole app; sessions inside it are addressed by handle.
 * The worker is created lazily so the 2 MB module is not fetched until the
 * first document is opened.
 */
import type {
	SolveOutcome,
	SolveRequest,
	Solver,
	SolverSession,
} from "@clingo-design/design-core";

import type { SolverRequest, SolverResponse, WithoutId } from "./protocol";

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
	if (worker) return worker;
	const created = new Worker(new URL("./worker.ts", import.meta.url), {
		type: "module",
		name: "clingo-solver",
	});
	created.onmessage = (event: MessageEvent<SolverResponse>) => {
		const message = event.data;
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.ok) entry.resolve(message.value);
		else entry.reject(new Error(message.error));
	};
	created.onerror = (event) => {
		// A worker-level failure strands every in-flight call.
		const error = new Error(event.message || "solver worker failed");
		for (const entry of pending.values()) entry.reject(error);
		pending.clear();
		worker = null;
	};
	worker = created;
	return created;
}

function send<T>(request: WithoutId<SolverRequest>): Promise<T> {
	const target = ensureWorker();
	const id = nextId++;
	return new Promise<T>((resolve, reject) => {
		pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
		target.postMessage({ ...request, id } as SolverRequest);
	});
}

export const workerSolver: Solver = {
	async open(program: string, options = ""): Promise<SolverSession> {
		const { handle, diagnostics } = await send<{
			handle: number;
			diagnostics: string;
		}>({ op: "open", program, options });
		return {
			solve: (request: SolveRequest = {}) =>
				send<SolveOutcome>({ op: "solve", session: handle, request }),
			close: () =>
				send<null>({ op: "close", session: handle }).then(() => undefined),
			diagnostics,
		};
	},
};
