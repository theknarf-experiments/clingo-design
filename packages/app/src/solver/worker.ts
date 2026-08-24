/// <reference lib="webworker" />
/**
 * Hosts clingo off the main thread.
 *
 * The WebAssembly module and every grounded program live here, so a solve that
 * takes a second scrolls and pans as smoothly as one that takes a millisecond.
 */
import { Session } from "@clingo-design/clingo-wasm";

import type { SolverRequest, SolverResponse } from "./protocol";

const sessions = new Map<number, Session>();
let nextSession = 1;

function reply(message: SolverResponse): void {
	self.postMessage(message);
}

async function handle(request: SolverRequest): Promise<number | unknown> {
	switch (request.op) {
		case "open": {
			const session = await Session.open(request.program, request.options ?? "");
			const handle = nextSession++;
			sessions.set(handle, session);
			// The diagnostics cross with the handle rather than being fetched
			// later: they are settled the moment the program grounds, and the
			// session they describe lives on this side of the boundary.
			return { handle, diagnostics: session.diagnostics };
		}
		case "solve": {
			const session = sessions.get(request.session);
			if (!session) throw new Error("no such session");
			return await session.solve(request.request);
		}
		case "close": {
			const session = sessions.get(request.session);
			sessions.delete(request.session);
			if (session) await session.close();
			return null;
		}
	}
}

self.onmessage = (event: MessageEvent<SolverRequest>) => {
	const request = event.data;
	handle(request).then(
		(value) =>
			reply({ id: request.id, ok: true, value: value as number | null }),
		(err: unknown) =>
			reply({
				id: request.id,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			}),
	);
};
