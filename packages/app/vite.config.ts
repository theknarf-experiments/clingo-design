import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

/**
 * **One wasm instance per Rust crate.**
 *
 * `@automerge/automerge` ships two builds: the default entry, which bundles its
 * own wasm and initialises it for you, and `/slim`, which takes a wasm url and
 * is initialised by hand. `@clingo-design/vfs` uses `/slim` — it has to, because
 * that is the build `automerge-repo` imports internally, and it inits it once
 * with an explicit url.
 *
 * Anything importing the bare specifier gets the *other* build, and then there
 * are two glues in the page: two `__wbindgen` tables, two sets of classes, and
 * a document created by one that the other does not recognise. The symptom is
 * not a version warning. It is a blank screen and
 *
 *     Cannot read properties of undefined (reading '__wbindgen_externrefs')
 *
 * from whichever copy nobody initialised — which is exactly what this app did
 * until this alias existed. Nothing in our own source imports the bare
 * specifier; `automerge-repo` does, internally, which is why an alias is the fix
 * rather than a lint.
 *
 * `vite-plugin-wasm` loads the `.wasm` the slim build is pointed at, and
 * `esnext` gives it the top-level await its init needs.
 *
 * This is a runtime-only failure: it typechecks, it bundles, and every headless
 * test passes, because none of them loads a page. It is the reason this file has
 * a comment this long.
 */
export default defineConfig({
	plugins: [react(), wasm()],
	resolve: {
		alias: [
			{ find: /^@automerge\/automerge$/, replacement: "@automerge/automerge/slim" },
		],
		// One React. A second copy means two hook dispatchers — react-dom renders
		// with one while a hook resolves against the other — and the symptom is
		// again a blank page rather than anything that names the cause.
		dedupe: ["react", "react-dom", "react/jsx-runtime"],
	},
	/**
	 * PlaneGCS is reached through `@clingo-design/planegcs`, a linked workspace
	 * package, and a linked package is not pre-bundled — so the registry
	 * dependency behind it is discovered by the scanner crawling into that
	 * source rather than by being named anywhere the optimizer looks first.
	 * Naming it makes the discovery a decision instead of a consequence: the
	 * failure mode of a dep found late is a mid-session re-optimize and a full
	 * page reload, which reads as the studio blinking and losing its selection
	 * for no reason the user did anything to cause.
	 *
	 * What this does *not* fix is where the wasm went, and it is worth saying so
	 * here because this is the entry somebody will come to when it 404s.
	 * Pre-bundling rewrites the `new URL("planegcs.wasm", import.meta.url)`
	 * inside the emscripten glue to a path in `node_modules/.vite/deps`, and no
	 * wasm is copied there — by either setting. The fix for that is a `?url`
	 * import handed to the module as `locateFile`, and it lives in
	 * `src/sketch/sketcher.ts`.
	 */
	optimizeDeps: {
		include: ["@salusoft89/planegcs"],
	},
	server: {
		port: 5173,
	},
	build: {
		outDir: "dist",
		target: "esnext",
	},
	worker: { format: "es" },
});
