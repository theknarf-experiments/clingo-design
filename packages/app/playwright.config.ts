import { defineConfig } from "@playwright/test";

import { BASE_URL, PORT } from "./e2e/server.ts";

/**
 * The browser lane.
 *
 * ## Why this exists at all
 *
 * Everything else in this repo is tested by calling a function, and that is the
 * right default: the solver, the scene model and the machines are pure, so a
 * `node:test` beside the source is faster, more precise and cheaper to keep than
 * anything driving a browser could be. This lane is not here to duplicate that.
 * It is here for the class of failure those tests are structurally blind to —
 * the ones that need a *page*, with a module graph resolved by Vite, a wasm
 * instance, a real IndexedDB and a real Worker.
 *
 * Two of them shipped in one week, and both were one page load from obvious:
 *
 *   - `@automerge/automerge` resolved to two different builds, so the page
 *     called into a wasm glue nobody had initialised. Blank screen, and
 *     `Cannot read properties of undefined (reading '__wbindgen_externrefs')`
 *     in the console. `vite.config.ts` now carries an alias and a long comment
 *     about it; nothing but a browser can tell you the alias is still working.
 *
 *   - the storage adapter opened an existing IndexedDB at a *lower* version than
 *     it had been left at, which throws. Clean profile: fine. Every browser that
 *     had ever run the app: broken.
 *
 * `tsc --noEmit` passed for both. 1446 unit tests passed for both. `vite build`
 * succeeded for both. That is the gap this file covers, and the reason it is one
 * test rather than a suite: the value is entirely in *loading the app*, and the
 * second, third and tenth walk through the UI add far less than they cost.
 *
 * ## Why it is not part of `turbo run test`
 *
 * Because it needs a Chromium and a dev server, and a unit-test lane that
 * silently requires both is a lane that goes red in CI for a reason that has
 * nothing to do with the change under test. It has its own script and its own
 * turbo task:
 *
 * ```
 *   pnpm --filter @clingo-design/app exec playwright install chromium   # once
 *   pnpm --filter @clingo-design/app test:e2e                           # run it
 *   pnpm turbo run test:e2e                                             # or via turbo
 *   pnpm --filter @clingo-design/app test:e2e -- --headed               # watch it
 * ```
 *
 * ## Why the dev server and not a production build
 *
 * The rejected alternative was `vite build && vite preview`, which is a truer
 * picture of what a user downloads. It was rejected because the two bugs this
 * lane is built around are both *resolution and storage* failures, which the dev
 * server reproduces exactly, and because `pnpm dev` is what a person here runs
 * fifty times a day — a check that guards the command nobody types is a check
 * that fails late. If a rollup-only regression ever bites, this is the file to
 * add a second project to, and the test itself would not need to change.
 */
export default defineConfig({
	testDir: "./e2e",

	// The one walk needs a wasm compile, a repo open, a document write and a
	// solve, on a machine that may also be building something else. Playwright's
	// 30s default times out on a cold Vite dependency-optimisation pass and the
	// failure it prints is a timeout, which says nothing about the app.
	timeout: 120_000,
	expect: { timeout: 30_000 },

	// One worker, and no parallelism. The test launches its own persistent
	// browser profile and cares which order things happened in — that is the
	// whole point of it — so a second worker sharing the dev server and the
	// profile directory would be racing over the state under test.
	fullyParallel: false,
	workers: 1,

	// Locally a flake is worth seeing rather than papering over; in CI a retry
	// is cheaper than a human re-running the job to find out.
	retries: process.env.CI ? 1 : 0,
	forbidOnly: !!process.env.CI,

	// `list`, and no HTML report. The HTML reporter opens a server when a run
	// fails, which is exactly the wrong behaviour for a lane that will mostly be
	// run non-interactively; the trace below is the thing worth having and
	// `playwright show-trace` opens it on demand.
	reporter: [["list"]],

	/**
	 * Artefacts go under `node_modules`, which is not where Playwright puts them
	 * by default and is worth a sentence.
	 *
	 * The default is `test-results/` in the package, and the repo's `.gitignore`
	 * does not mention it — so a failed run would leave a directory of traces and
	 * videos sitting in `git status`, which is how they end up committed. The
	 * honest fix is a line in `.gitignore`; this lane does not own that file, so
	 * it puts its scratch where every other tool in a node repo puts scratch. If
	 * `test-results/` is ever ignored, delete this line and take the default back.
	 */
	outputDir: "node_modules/.playwright",

	use: {
		baseURL: BASE_URL,
		// The artefacts are only written for a failure, and a failure here is
		// almost always visual — a blank page. A trace and a screenshot answer
		// "what did the user see" without a second run, and both were checked to
		// actually appear: the test builds its own browser context rather than
		// taking the `page` fixture, and only the `chromium` re-exported from
		// `@playwright/test` is instrumented to collect artefacts from one.
		//
		// `video` is deliberately absent. It is not recorded for a hand-launched
		// persistent context, and a setting that quietly does nothing is worse
		// than no setting: the next person to debug a failure would go looking
		// for a file that was never going to exist.
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},

	webServer: {
		// `vite` directly rather than `pnpm dev`, so the port and host are ours
		// and not whatever `vite.config.ts` pins for the human dev server. See
		// `e2e/server.ts` for why the origin has to be pinned rather than merely
		// reachable.
		command: `pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`,
		url: BASE_URL,
		// Reuse whatever is already listening when a person is iterating, but
		// never in CI, where "already listening" means a stale process and a
		// green run against last week's code.
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		stdout: "pipe",
		stderr: "pipe",
	},
});
