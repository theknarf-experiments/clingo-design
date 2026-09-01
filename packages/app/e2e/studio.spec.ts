import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

import { BASE_URL } from "./server.ts";
import { wideFont } from "./wideFont.ts";

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

/**
 * Paint a gradient from the inspector, and watch it arrive on the canvas.
 *
 * The one thing this walk gains for the paint layer, and it is here rather than
 * in a `node --test` because **every** step of it is unavailable headless. A
 * gradient is three ordinary properties and the file that proves that is
 * `props.test.ts`; what no test in `design-core` can reach is the two ends of
 * the chain those properties hang between:
 *
 *   - **React writing `--gfrom` out of a style object.** `PAINT.gradientFrom`
 *     returns `{ "--gfrom": … }`, which is a key no `Declarations` had before
 *     and which React writes only because it starts with two dashes. A unit test
 *     asserts the object; only a browser asserts the attribute.
 *   - **`@property` reaching the page.** The registration is a string in
 *     `paint.ts`, rendered into a `<style>` at the *app* root — not the studio's,
 *     because a presentation is a different route — and the whole failure mode is
 *     invisible: a gradient still paints without it, because every recipe carries
 *     `var()` fallbacks. So it is checked the one way that tells the difference,
 *     by reading `--gfrom` back off the element. A registered custom property
 *     computes to its `initial-value`; an unregistered one computes to nothing at
 *     all, and the picture is identical either way.
 *
 * The inspector half rides along for free and is worth the three lines: the two
 * colour rows are absent until the node holds a direction, present the moment it
 * does, and — the part a `PropSpec.needs` that tested *resolution* rather than
 * *presence* would get wrong — still present when the direction goes back to
 * None, because a designer flipping between directions must not have rows
 * blinking out from under the cursor.
 *
 * It leaves the gradient on, deliberately: the returning visit reads this very
 * document back out of IndexedDB, so a property invented after the store was
 * written is a property the store is proved to carry.
 */
async function expectAGradientPaints(page: Page): Promise<void> {
	// The badge is a rect, so its Appearance list offers all six of the paint
	// properties; it is also the node the walk already watches the solver paint.
	await page.locator('[data-layer="badge"]').click();
	const direction = page.locator('[data-prop="gradient"] select[data-role="literal"]');
	await expect(direction).toHaveCount(1);
	await expect(page.locator('[data-prop="gradientFrom"]')).toHaveCount(0);
	await expect(page.locator('[data-prop="gradientTo"]')).toHaveCount(0);
	// "Layer blur" rather than "Blur", because `blur` is also a trigger and the
	// two words would otherwise be one screen apart.
	await expect(page.locator('[data-prop="blur"]')).toContainText("Layer blur");
	await expect(page.locator('[data-prop="mix"] select[data-role="literal"]')).toHaveCount(1);

	await direction.selectOption({ label: "Linear, down" });
	await expect(page.locator('[data-prop="gradientFrom"]')).toHaveCount(1);
	await expect(page.locator('[data-prop="gradientTo"]')).toHaveCount(1);

	// Retried rather than read once: choosing a direction is a document edit, and
	// what the canvas paints is whatever the *next* answer set renders.
	const badge = page.locator('[data-artboard] [data-node="badge"]');
	await expect(badge).toHaveCSS("background-image", /linear-gradient/);
	const registered = await badge.evaluate((element) =>
		getComputedStyle(element).getPropertyValue("--gfrom").trim(),
	);
	expect(registered, "--gfrom computed to nothing, so @property never reached the page").not.toBe(
		"",
	);

	await direction.selectOption({ label: "None" });
	await expect(page.locator('[data-prop="gradientFrom"]')).toHaveCount(1);
	await direction.selectOption({ label: "Linear, down" });
}

/**
 * The width of Typography's headline, in CSS pixels.
 *
 * **On that document rather than on Card, for a reason a failed run found.** A
 * measured size reaches a frame only through a layout's own equations —
 * `lask/3` is consumed by `&sum{ lsz(C,S) }` under `layout(C,_)` and by nothing
 * else — so a text node sitting at absolute coordinates keeps the box it was
 * drawn at however it is set, and an assertion against Card's title would have
 * read 400 whatever the font engine did. Typography's page *is* a column, its
 * children hug, and its whole stated point is that "the page reflows, rather
 * than merely restyling, because the column is an automatic layout over text
 * that hugs its words". A hugging child of a column takes its width from the
 * cross-axis equation, which is `lask`, which is `measureScene`, which is a
 * canvas measuring a string in a font string this app built. So this one number
 * reads the whole chain.
 */
async function headlineWidth(page: Page): Promise<number> {
	return page
		.locator('[data-artboard] [data-node="title"]')
		.evaluate((element) => element.getBoundingClientRect().width);
}

/** Open a project from the landing page by the name the app gave it. */
async function openProject(page: Page, name: string): Promise<void> {
	await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
	const saved = page.locator('[data-project] [data-role="open"]', { hasText: name });
	await expect(saved).toHaveCount(1);
	await saved.click();
	await page.waitForURL(/\/p\//);
	await expect(page.locator('[data-role="status"]')).toContainText(/\d+ universes/);
}

/**
 * Upload a font, set text in it, and watch the solver refit the box.
 *
 * **This is the one claim about imported fonts that cannot be made headlessly**,
 * and it is the reason the fonts step could not be finished without a browser.
 * pretext measures against `new OffscreenCanvas(1,1).getContext('2d')`, built at
 * module scope; an `OffscreenCanvas` created in a Window context is specified to
 * take its font source from the associated document, so `document.fonts.add()`
 * reaches it. That is two layers away from any code in this repo, and if it were
 * false every box in the studio would be measured in the fallback under the real
 * family's cache key — where it would stay for the life of the page, because
 * pretext's own per-font cache is not on its export surface and cannot be
 * cleared. The design answers that with `paintedStack`, which makes the font
 * string a function of the loaded set so a stale width is unservable rather than
 * merely unlikely; this asserts the premise the whole arrangement rests on.
 *
 * The assertion is a **width inequality against a threshold**, never a snapshot,
 * and the fixture is built rather than grabbed so that the threshold is
 * arithmetic instead of a guess about somebody's metrics: every glyph in it is
 * exactly one em, so "Compact or comfortable" at 34px is twenty-two ems — 748
 * pixels, and the run reads 748 — against 385 for whatever this machine calls
 * `system-ui` at the same size and weight. The threshold sits between them with
 * room on both sides, because the number on the left is a fact about the runner
 * and the number on the right is arithmetic. See `wideFont.ts`.
 *
 * It also proves the four steps of the upload flow happened in the order they
 * have to: the row appears only if the bytes were written *and* the declaration
 * followed, and the box only moves if the face was registered before anything
 * measured. A run in which `document.fonts.add` came before `load()` resolved
 * would leave the family named, unusable, and measured in the fallback — the
 * failure the ordering exists to remove — and it would show up here as a box
 * that never moved.
 */
async function expectAFontChangesTheBox(page: Page): Promise<void> {
	const before = await headlineWidth(page);
	// Not pinned as a number — which face the machine calls `system-ui` is not
	// this repo's business — but it has to be clear of the threshold below, or
	// the inequality afterwards would say nothing at all.
	expect(before, "the fixture has to be wider than whatever system-ui is here").toBeLessThan(
		480,
	);

	await page.locator('[data-panel="fonts"]').click();
	await expect(page.locator('[data-role="font-tally"]')).toContainText("no families declared");
	await page.locator('[data-role="add-font"]').setInputFiles({
		name: "WideFixture.ttf",
		mimeType: "font/ttf",
		buffer: Buffer.from(wideFont()),
	});
	// The row is the declaration, and the declaration is written last, so its
	// arrival is the whole flow having succeeded rather than a file having been
	// chosen.
	const row = page.locator('[data-role="font"]');
	await expect(row).toHaveCount(1);
	// Read out of the file's own `name` table, which is a label and only a label:
	// the family the studio uses is the one in this field, and `FontFace` takes it
	// as an argument.
	await expect(row.locator('[data-role="font-family"]')).toHaveValue("Wide Fixture");
	// The class its `OS/2` declares. A `.ttf` with an `fvar` would have printed a
	// range here instead, which is the difference between a weight the type
	// designer drew and one the browser faked.
	await expect(row.locator('[data-role="font-weight"]')).toHaveValue("400");
	// Registered, not merely declared: the "not loaded" tag is what a face whose
	// bytes never parsed would keep wearing.
	await expect(row.locator('[data-role="font-waiting"]')).toHaveCount(0);
	// **Registered with the descriptors the document declares**, which is the one
	// thing about this flow no headless test can see and which was wrong the first
	// time it was written. `new FontFace(family, bytes)` with no third argument
	// does not mean "whatever the file says": it means `weight: normal`, so a
	// variable face registered that way is pinned to its default instance and every
	// other weight the design asks for is a synthesised faux bold — while the
	// exported HTML, which writes the declaration verbatim into its `@font-face`,
	// gets the real cut. Two pictures from one document, and the one on screen is
	// the wrong one. So: what the panel says, and what the browser holds, once.
	const faces = () =>
		page.evaluate(() =>
			[...document.fonts].map((f) => `${f.family} ${f.weight} ${f.style}`),
		);
	await expect.poll(faces).toEqual(["Wide Fixture 400 normal"]);
	// A descriptor corrected afterwards reaches the browser too, and **replaces**
	// the face rather than joining it. The single-element expectation is the whole
	// assertion: two faces of one family at overlapping weights is a tie the
	// browser breaks, and one of the two answers is the one nobody meant.
	const weight = row.locator('[data-role="font-weight"]');
	await weight.fill("100 900");
	await expect.poll(faces).toEqual(["Wide Fixture 100 900 normal"]);

	// The panel writes on every keystroke, so the way to a descriptor runs through
	// strings that are not one — and Chrome rejects those in `load()` rather than
	// in the constructor, which is *after* a working face is already in the
	// document. A failed attempt therefore has to leave that face alone and go on
	// reporting the family as paintable, or the design would be stripped to its
	// fallback and re-solved for the frame between two keystrokes. This is the run
	// that first came back with two faces in the set.
	await weight.fill("nonsense");
	await expect.poll(faces).toEqual(["Wide Fixture 100 900 normal"]);
	await weight.fill("400");
	await expect.poll(faces).toEqual(["Wide Fixture 400 normal"]);

	// Now use it. Every node on this page takes its family from the Prose style,
	// so the row on the headline is the *styled* twin — read-only, showing what
	// each variant holds — and giving the node its own family is the override
	// button beside it. Both halves are `font`-typed rows and both had to learn
	// the project's menu.
	await page.locator('[data-panel="properties"]').click();
	await page.locator('[data-layer="title"]').click();
	await expect(
		page.locator('[data-prop="fontFamily"] select[data-role="literal"]'),
	).toHaveCount(0);
	await page.locator('[data-role="override-fontFamily"]').click();
	const family = page.locator('[data-prop="fontFamily"] select[data-role="literal"]');
	await expect(family).toHaveCount(1);
	// The page's own families come first, because a designer who uploaded a font
	// did it to use it.
	await expect(family.locator("option").first()).toHaveText("Wide Fixture");
	await family.selectOption({ label: "Wide Fixture" });

	// Polled rather than read once: choosing a family is a document edit, it
	// re-measures, and the box is whatever the *next* answer set fits.
	await expect
		.poll(() => headlineWidth(page), {
			message: "the box never grew, so the face never reached the measuring canvas",
		})
		.toBeGreaterThan(560);

	// And the panel now says so about the design rather than about the document:
	// one family declared, one of them worn by the universe on screen. That count
	// is read off the answer set, which is what makes it true of a family a rule
	// put on a node the document never mentions.
	await page.locator('[data-panel="fonts"]').click();
	await expect(page.locator('[data-role="font-tally"]')).toContainText(
		"1 family declared · 1 in the design on screen",
	);
}

/**
 * Make a curve a value: pick a spring, read its physics, and branch the space.
 *
 * The three claims of this rung that a `node --test` cannot reach, in one walk
 * on the one template that has a machine in it:
 *
 *   - **The row is a `ValueEditor` and not a `<select>` any more.** It varies,
 *     greys, pins and takes a token exactly as the three duration rows beside it
 *     do, and the way to check that is to use the machinery that only exists on
 *     a value row: add a second alternative, and watch the status line count the
 *     universes it made. `machineprogram.test.ts` asserts that `#project
 *     measing/3.` splits the space; this asserts that the panel a designer
 *     actually touches is wired to the same variable.
 *   - **A spring adds none of them.** Three fixed members of a menu and no
 *     parameters is the decision the whole feature turns on, and the count not
 *     moving when the curve becomes `springBouncy` is what that decision looks
 *     like from a person's chair.
 *   - **The physics is printed rather than hidden.** `SpringSpec.natural` is a
 *     hint and never a duration — what paces the move is the duration field on
 *     the same row — so the panel has to say the number out loud or a designer
 *     who wants the physical spring has nothing to type.
 *   - **The canvas plays it.** `--dc-play-easing` carries a spring's whole
 *     sixty-five-stop `linear()` and `Artboard.module.css` puts that custom
 *     property straight into `transition-timing-function`, so the claim is not
 *     that a string reached an attribute: it is that the *engine parsed it*. A
 *     browser that cannot rejects the declaration and computes `ease`, and the
 *     only way to know which happened is to ask the browser, which is what
 *     `getComputedStyle` here does. Reading the code says nothing about it.
 */
async function expectACurveIsAValue(page: Page): Promise<void> {
	// `textContent` rather than `innerText`, which is the difference between what
	// the element says and what is laid out: the status line is the last row of a
	// flex column and can be scrolled out of the viewport, and `innerText` on an
	// element that is not being rendered comes back empty.
	const universes = async (): Promise<number> => {
		const text = (await page.locator('[data-role="status"]').textContent()) ?? "";
		return Number(/(\d+)\s*universes?/.exec(text)?.[1] ?? 0);
	};
	await expect
		.poll(universes, { message: "the machine template has a space to begin with" })
		.toBeGreaterThan(0);
	const before = await universes();

	await page.locator('[data-panel="machines"]').click();
	const row = page.locator('[data-role="transition-easing"][data-transition="enter"]');
	const curve = row.locator('[data-prop="transition-easing"] select[data-role="literal"]');
	await expect(curve).toHaveCount(1);

	// A spring is a word where `easeOut` is a word, so choosing one is one
	// alternative and no branch.
	await curve.selectOption({ label: "Spring — bouncy" });
	await expect
		.poll(universes, { message: "a spring branched the space, which it must never do" })
		.toBe(before);
	// And the panel says what it is made of, which is the accommodation
	// `Transition.duration` winning is paid for with.
	await expect(row.locator('[data-role="curve-note"]')).toContainText("Settles naturally in 606ms");

	// Now the half that could not exist while an easing was a word: a second
	// alternative, which is one document holding the crisp reading and the playful
	// one, and which the solver has to answer twice.
	await row.locator('[data-role="add-alt"]').click();
	const alternatives = row.locator('[data-prop="transition-easing"] select[data-role="literal"]');
	await expect(alternatives).toHaveCount(2);
	await alternatives.nth(1).selectOption({ label: "Ease in" });
	await expect
		.poll(universes, {
			message: "the second curve made no universe, so #project measing/3 never reached the page",
		})
		.toBe(before * 2);

	// Leave it as one curve again, so the returning visit reads back a document
	// this walk can still recognise — and so that the count it asserts elsewhere
	// is the template's own. The bouncy spring is what is left on the row, which
	// is what the next paragraph plays.
	await row.locator('[data-role="remove-alt"]').nth(1).click();
	await expect
		.poll(universes)
		.toBe(before);

	// And now play it. Preview on, then the pointer onto the *instance* rather
	// than onto the definition — the machine is worn by the two instances at the
	// right of the artboard, and hovering the component the states were authored
	// on fires nothing, which is the shape of probe that reports this broken while
	// it works.
	await page.locator('[data-role="preview"]').click();
	const instance = page.locator('[data-node="resting"]');
	await expect(instance).toHaveCount(1);
	const box = await instance.boundingBox();
	// Measured before it is aimed at, because the artboard is drawn inside a
	// transformed, absolutely positioned overlay and a node that measured 0×0
	// would send the pointer somewhere nobody can see — which is how a previous
	// walk in this file came to click at a negative coordinate and conclude a
	// working feature was broken.
	expect(box?.width ?? 0).toBeGreaterThan(8);
	expect(box?.height ?? 0).toBeGreaterThan(8);
	// `mouse.move` and not `hover()`, and the difference is not style. `hover()`
	// waits for the element to *receive* pointer events, and every node on this
	// canvas sits under the editor's own full-bleed overlay — which is what reads
	// the pointer and fires the machine. So the actionability check can never pass
	// here, and the honest instruction is "put the pointer at this point", which is
	// what a person does.
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2, { steps: 4 });
	// The computed value, not the declared one: `linear()` is Baseline 2023 and a
	// browser that cannot parse it drops the declaration and computes something
	// else, so the assertion is that the engine took the sample rather than that a
	// string arrived. A prefix match, because pinning the whole 508-character
	// constant would be a snapshot of `values.ts` written in a second file — and
	// because a browser re-serialises `linear()` with a percentage per stop.
	await expect
		.poll(
			async () =>
				instance.evaluate((el) => getComputedStyle(el).transitionTimingFunction.slice(0, 8)),
			{ message: "the canvas did not play the spring; the browser computed something else" },
		)
		.toBe("linear(0");
	await page.locator('[data-role="preview"]').click();
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

/** Make a project from the Machine template and wait for its studio. */
async function createMachine(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
	await page.locator('[data-template="machine"]').click();
	await page.waitForURL(/\/p\//);
	await expect(page.locator('[data-role="status"]')).toContainText(/\d+ universes/);
}

/**
 * Make a second project from the Typography template and wait for its studio.
 *
 * The landing page is reached by navigating rather than by a back button, so
 * this is also the one place the walk leaves a studio and returns to the app
 * root — which is what the `@property` registrations being mounted there rather
 * than in the studio is about.
 */
async function createTypography(page: Page): Promise<void> {
	await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
	await page.locator('[data-template="typography"]').click();
	await page.waitForURL(/\/p\//);
	await expect(page.locator('[data-role="status"]')).toContainText(/\d+ universes/);
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
	/**
	 * A second project, for the one assertion Card cannot carry.
	 *
	 * A measured box reaches the frame only through a layout's own equations, and
	 * Card places every node at absolute coordinates — so the font check has to be
	 * on the one template that reflows. It is a second document rather than a
	 * layout wrapped around Card's title mid-walk, because wrapping is a studio
	 * action with its own failure modes and this test is not about that one.
	 */
	const typographyProject = "Two typographies";

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
			await expectAGradientPaints(page);
			await createTypography(page);
			await expectAFontChangesTheBox(page);
			await createMachine(page);
			await expectACurveIsAValue(page);
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

			// And the typography survived, which is a stronger statement than the
			// nodes surviving. Nothing about this box is in the document: the face
			// had to come back out of the project's tree, be loaded and registered
			// by `useDocumentFonts` — the half of the story the uploader's own tab
			// never exercises, because there the upload flow had already done it —
			// and be measured in before the solver could fit the headline to it. A
			// studio that opened with the declaration and without the bytes would
			// draw this on one line and look entirely healthy doing it.
			await openProject(page, typographyProject);
			await page.locator('[data-panel="fonts"]').click();
			await expect(page.locator('[data-role="font"]')).toHaveCount(1);
			await expect(page.locator('[data-role="font-waiting"]')).toHaveCount(0);
			await expect
				.poll(() => headlineWidth(page), {
					message: "the face did not come back out of the project",
				})
				.toBeGreaterThan(560);

			expect(trouble, "the returning visit logged errors").toEqual([]);
		} finally {
			await context.close();
		}
	};

	await firstVisit();
	await returningVisit();
});
