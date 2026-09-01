import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

import { BASE_URL } from "./server.ts";

/**
 * The one walk.
 *
 * ## Why this walk and no other
 *
 * The lane is deliberately a single test, so it had to be the single most
 * expensive path in the app to get wrong: *create a project from a template and
 * arrive in the studio with the canvas drawn.* Nothing else in the app touches
 * as much per click. Following it end to end, the page has to
 *
 *   1. resolve and initialise the Automerge wasm — one instance, from the one
 *      build `vite.config.ts` aliases to;
 *   2. open a repo on IndexedDB, at whatever version that database is already
 *      at on this machine;
 *   3. create a directory document and write a scene document into it;
 *   4. read it back through the store hooks and render a layer list;
 *   5. hand the scene to the clingo worker, get an answer set back, and paint
 *      the chosen values onto the artboard.
 *
 * Both of the bugs this lane exists for live in steps 1 and 2, and every
 * assertion below is downstream of them: you cannot get a layer named "Badge"
 * onto the screen without a working document, and you cannot get an accent
 * colour onto that badge without a working solve. So the test asserts on what a
 * person sees rather than on the machinery, and gets the machinery for free.
 *
 * ## Why the Card template
 *
 * Blank would load the page without proving anything came back from the solver;
 * Three dimensions would drag three.js and a WebGL context into a check that is
 * not about either, and a headless GPU is its own source of flakes. Card is the
 * cheapest template that still has a nested tree, several nodes, and two tokens
 * holding more than one value — so a successful solve is *visible*, as a fill
 * that could only have been chosen by the solver.
 *
 * ## Why one profile, walked twice
 *
 * This is the part that would have caught the second bug, and it is worth being
 * explicit that the obvious version of this test could not have. A fresh browser
 * context — Playwright's default, and what every example writes — starts with an
 * empty IndexedDB, which is precisely the one case where opening a database at
 * the wrong version *works*. The bug shipped because it only appears on the
 * second visit.
 *
 * So the walk runs twice against one persistent profile: once as a browser that
 * has never seen the app, then again, in a new browser session, against the
 * databases the first pass left behind. The second pass also opens the project
 * the first pass made, which is the strongest single statement this file can
 * make — the document survived a browser restart and was read back — and it is a
 * statement no fresh context can make at all.
 *
 * The two passes are one `test()` rather than two, because they are not
 * independent: the second is meaningless without the first having run and
 * written. Splitting them would let the reporter show a green "returning
 * browser" for a run in which nothing was ever stored.
 */

/** What `card()` puts in the scene, as the layer list spells it for a person. */
const CARD_LAYERS = [
	"Page",
	"Card",
	"Badge",
	"Badge label",
	"Title",
	"Body",
	"Primary button",
	"Primary label",
	"Secondary button",
	"Secondary label",
];

/**
 * Everything the page said that a person should never have to see.
 *
 * Collected rather than asserted at the point of failure, because the failure we
 * are hunting is not raised by anything the test does — the page throws while
 * mounting, the screen goes blank, and every later `waitFor` fails with a
 * timeout that names the wrong thing. Gathering them and asserting at the end
 * means the report says `__wbindgen_externrefs` instead of "locator not found".
 *
 * `console.warning` is not collected. React and Vite both warn in development
 * for reasons that are not defects, and a check that has to be muted to pass is
 * a check nobody reads. Errors and uncaught exceptions were what both of the
 * shipped bugs produced, and neither of them has a benign source here.
 */
function watchForTrouble(page: Page): string[] {
	const trouble: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") trouble.push(`console.error: ${message.text()}`);
	});
	page.on("pageerror", (error) => {
		trouble.push(`pageerror: ${error.message}`);
	});
	return trouble;
}

/**
 * Assert the studio is *drawn*, not merely mounted.
 *
 * The distinction is the whole reason this lane exists. A studio that mounted
 * with a broken document renders its chrome perfectly well — the panels, the
 * toolbar and an empty canvas — and a test that waited for the toolbar would
 * have passed through both of the bugs above. So every assertion here is about
 * something that can only be true if the document opened *and* the solver
 * answered.
 */
async function expectDrawnStudio(page: Page): Promise<void> {
	// The layer list is the document, made visible. Nodes with these names exist
	// only if the scene document was written, read back and normalised.
	const layers = page.locator('[data-role="layers"] [data-layer]');
	await expect(layers).toHaveCount(CARD_LAYERS.length);
	// Compared as sets: the list paints back-to-front, so the order on screen is
	// the reverse of the order in the template, and pinning it here would make
	// this test fail for a z-order change that is nobody's bug.
	const names = (await layers.allInnerTexts()).map((text) =>
		// Each row is a kind glyph and then the name, on two lines.
		text.split("\n").at(-1)?.trim(),
	);
	expect(new Set(names)).toEqual(new Set(CARD_LAYERS));

	// The status line is the solver, made visible. It reads "solving…" until an
	// answer set comes back and only then counts universes, so this waiting is
	// the assertion that the clingo worker loaded its own wasm and replied.
	const status = page.locator('[data-role="status"]');
	await expect(status).toContainText(/\d+ universes/);
	await expect(page.locator('[data-role="status"] [data-role="error"]')).toHaveCount(0);

	// And the canvas is both of them at once. `badge`'s fill is `ref("accent")`,
	// a token the template gives five values, so a painted, opaque background on
	// a box with a real size is a value that *the solver chose* arriving in the
	// DOM. An unstyled or unmounted node is `rgba(0, 0, 0, 0)`, which is exactly
	// what the assertion excludes; the specific colour is not pinned because
	// which of the five is showing is the app's freedom, not its contract.
	const badge = page.locator('[data-artboard] [data-node="badge"]');
	await expect(badge).toBeVisible();
	const painted = await badge.evaluate((element) => {
		const box = element.getBoundingClientRect();
		return {
			width: box.width,
			height: box.height,
			background: getComputedStyle(element).backgroundColor,
		};
	});
	expect(painted.width).toBeGreaterThan(0);
	expect(painted.height).toBeGreaterThan(0);
	expect(painted.background).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
}

/** Make a project from the Card template and wait for the studio it opens. */
async function createFromTemplate(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
	// The landing page renders its list from localStorage before any repo is
	// open, so seeing the template button proves nothing yet — clicking it is
	// what forces the wasm and the repo.
	await page.locator('[data-template="card"]').click();
	await page.waitForURL(/\/p\//);
}

test("a template becomes a drawn studio, first on a clean profile and then on a returning one", async () => {
	// One directory for both passes. `outputPath` puts it under the run's own
	// test-results folder, so it is fresh for every `pnpm test:e2e` — the first
	// pass has to genuinely be a first visit — and it is kept alongside the trace
	// when the test fails, which is worth having when the question is what was in
	// the database.
	const profile = test.info().outputPath("browser-profile");

	// A named project, so the second pass can prove it is looking at the very
	// document the first pass wrote rather than at any studio that happens to
	// open. The app derives the name from the template and disambiguates, so this
	// is what a first Card project in an empty list is called.
	const projectName = "Card";

	const firstVisit = async (): Promise<void> => {
		// `launchPersistentContext` rather than `browser.newContext()`, and this
		// is the single most important line in the file: a Playwright context is
		// storage-isolated and thrown away, so the default fixture can only ever
		// test the clean-profile case. See the note at the top.
		const context: BrowserContext = await chromium.launchPersistentContext(profile);
		try {
			const page = await context.newPage();
			const trouble = watchForTrouble(page);
			await createFromTemplate(page);
			await expectDrawnStudio(page);
			expect(trouble, "the first visit logged errors").toEqual([]);
		} finally {
			// Closed, not merely navigated away from. The database has to be
			// released and flushed by a browser that is going away, because that
			// is the state the next launch will find it in — and the shape of the
			// bug being guarded against is entirely about what the *next* open
			// sees.
			await context.close();
		}
	};

	const returningVisit = async (): Promise<void> => {
		const context: BrowserContext = await chromium.launchPersistentContext(profile);
		try {
			const page = await context.newPage();
			const trouble = watchForTrouble(page);
			await page.goto(`${BASE_URL}/`, { waitUntil: "load" });

			// The list survived, which is localStorage; opening it is what asks
			// the storage adapter to reopen a database it has already written to.
			const saved = page.locator('[data-project] [data-role="open"]', {
				hasText: projectName,
			});
			await expect(saved).toHaveCount(1);
			await saved.click();
			await page.waitForURL(/\/p\//);

			// The same assertions, and they mean more here: these nodes are being
			// read back out of storage rather than created in memory a moment ago.
			await expectDrawnStudio(page);
			expect(trouble, "the returning visit logged errors").toEqual([]);
		} finally {
			await context.close();
		}
	};

	await firstVisit();
	await returningVisit();
});
