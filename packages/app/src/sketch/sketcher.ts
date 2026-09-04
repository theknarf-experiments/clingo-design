/**
 * The page's PlaneGCS, and the one place in the app that knows where its wasm
 * lives.
 *
 * `@clingo-design/planegcs` takes the url rather than resolving it, for the
 * reason its own comment gives: `@salusoft89/planegcs` is an ordinary registry
 * dependency, so Vite pre-bundles it and rewrites the `new URL("planegcs.wasm",
 * import.meta.url)` inside its glue to a path in `node_modules/.vite/deps`,
 * where no wasm was ever copied. The `?url` import below is the answer, and it
 * lives here rather than in that package so that every module of it stays
 * loadable under `node --test` — exactly the split `packages/vfs` draws for
 * Automerge.
 *
 * **Main thread, no worker, no protocol op.** `Sketcher.solve` is synchronous
 * by contract because it is called from inside `interpret`, which is a plain
 * function with three call sites, one of them inside a `ways.map`. A worker hop
 * is a `postMessage` round trip and therefore a `Promise`, and the two cannot
 * both be true. The pass is 0.53 ms against an exploration measured in seconds,
 * so it rides the thread that already waits.
 *
 * ## Why this is a façade and not the module itself
 *
 * The `Explorer` is constructed synchronously, once, in a `useRef` initialiser,
 * and it holds its `Sketcher` for the life of the editor. Instantiating wasm is
 * asynchronous. So something synchronous has to stand in the constructor's
 * argument slot on the render that opens a document, and the thing that stands
 * there is this object: a stable identity whose `solve` forwards to the real
 * sketcher the moment there is one.
 *
 * The window in which there is not one is opened by {@link sketcher} itself —
 * the first call starts the fetch — and it is closed by the four things that
 * have to happen before anything asks a question: React has to render the
 * studio, the exploration effect has to wait out its 150 ms debounce, the
 * solver worker has to fetch and instantiate a 2 MB clingo, and clingo has to
 * ground and solve. A 508 KB fetch started before all of that is finished
 * before all of that. It is not, however, *guaranteed* to be, which is why
 * `solve` has an answer for the cold case rather than a `throw` or an
 * assertion — a throw inside `interpret` is a design that does not draw.
 *
 * That answer is `adrift`, and it is the honest one rather than a placeholder:
 * `adrift` means the sketch did not settle and blames nothing for it, the
 * design on screen is real, and it is simply not moored to the sketch rules.
 * All three are true of a solver that has not loaded. Nothing is applied to
 * `Universe.solved` on that status and nothing is learned from it, so the worst
 * a lost race costs is one exploration's worth of sketch, recovered by the next
 * edit. The alternatives are worse in kind and not in degree: `settled` would
 * be a claim, and an error would take the canvas down.
 */

import { openSketcher, type Sketcher } from "@clingo-design/planegcs";
import wasmUrl from "@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url";

/**
 * The real one, once it exists. Read on every solve rather than captured,
 * because the whole point of the façade is that this field changes underneath
 * a caller who is holding the object that reads it.
 */
let live: Sketcher | null = null;

/** In flight, so a second caller joins the first fetch instead of starting a
 *  second wasm instance. */
let opening: Promise<Sketcher> | undefined;

/** Set by {@link Sketcher.close}, and it survives `live` being nulled — a
 *  sketcher that was closed before the module arrived must not come alive when
 *  it does. */
let closed = false;

/**
 * Starts the fetch, or joins one already running.
 *
 * The `catch` is the whole of the difference between an idempotent warm-up and
 * a permanent failure. `opening ??=` caches whatever the first call produced,
 * and a *rejected* promise is something it produced: without clearing the slot,
 * one refused fetch — a cold start on a flaky connection, a service worker
 * mid-update — meant every later call joined the same dead promise and the
 * studio solved no sketch rule again for the life of the tab.
 *
 * Clearing it makes the retry the comment in `solve` always claimed. It does
 * not make it a loop: nothing retries on a timer, only the next solve does, so
 * a genuinely missing asset costs one fetch per exploration and not a spin.
 */
function warm(): Promise<Sketcher> {
	return (opening ??= openSketcher({ wasmUrl })
		.then((opened) => {
			if (closed) opened.close();
			else live = opened;
			return opened;
		})
		.catch((reason: unknown) => {
			opening = undefined;
			throw reason;
		}));
}

const facade: Sketcher = {
	solve(request) {
		if (closed) throw new Error("sketcher is closed");
		const ready = live;
		// The cold path. `warm()` joins a fetch that is still running and starts a
		// new one where the last was refused, so this is both the first request and
		// the repair.
		//
		// `unavailable` and emphatically not `adrift`: adrift is a claim about the
		// *design* — the solver looked from where these nodes are and ran out of
		// steps — and the studio answers it by inviting a drag to start it
		// somewhere else. There is no aim that fixes a module which has not
		// arrived, so saying so would be a false sentence with a useless remedy
		// attached, for the whole life of a tab whose wasm 404s.
		if (!ready) {
			void warm().catch(() => {
				// Swallowed rather than unhandled: the status is the report, the next
				// solve retries, and an uncaught rejection here would be a red console
				// on every exploration until the asset came back.
			});
			return { status: "unavailable" };
		}
		return ready.solve(request);
	},
	close() {
		closed = true;
		const ready = live;
		live = null;
		ready?.close();
	},
};

/**
 * The app's one sketcher, opening the wasm module the first time it is asked
 * for.
 *
 * A function rather than a `const` so that the fetch starts when an editor is
 * opened rather than when the bundle is evaluated: the routes are statically
 * imported, so a module-scope `openSketcher()` would put half a megabyte of
 * geometry solver in front of the project list, which never draws a design.
 *
 * Idempotent, and the same object every time — the `Explorer` keeps what it is
 * handed for the life of the editor, and a studio remounted by StrictMode must
 * not get a second wasm instance.
 */
export function sketcher(): Sketcher {
	void warm();
	return facade;
}
