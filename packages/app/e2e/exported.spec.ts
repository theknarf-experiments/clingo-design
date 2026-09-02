import { writeFile } from "node:fs/promises";

import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

import { BASE_URL } from "./server.ts";
import { wideFont } from "./wideFont.ts";

/**
 * One document with all five features in it, exported, and the export opened.
 *
 * ## Why a second spec rather than another leg of the walk
 *
 * `studio.spec.ts` holds each of the five on its own — a gradient paints, a face
 * changes a box, a curve is a value, a drag moves a machine, a link is walked —
 * and it holds them *in the studio*, which is where a designer works and where a
 * broken one is visible. This is the other side of the same document: the file
 * somebody hands to a developer, opened as a file, with nothing of this
 * repository running inside it.
 *
 * That boundary has now cost two shipped features, and both times the studio was
 * perfect and the file was wrong:
 *
 *   - `overflow: hidden` made every frame a scroll container, so
 *     `animation-timeline: view()` resolved against a scrollport that never
 *     moves. Five correct declarations on a box that cannot move. The `@supports`
 *     matched, `animationTimeline` computed to `view()`, and nothing moved.
 *
 *   - `transition: color, font-size 120ms ease-out` is *two* transitions, of
 *     which the first takes the initial `0s ease`. Every state that changed more
 *     than one thing snapped on all of them but the last. There was a unit test
 *     over it; its expected string was the defect, written down.
 *
 * Neither is visible in the stylesheet, neither raises a console error, and
 * neither is reachable by reading the document. What they have in common is that
 * a browser will tell you immediately if you ask it the right question — so this
 * spec's job is to be the thing that asks. Its assertions are what a browser
 * *computed*, and deliberately not substrings of the CSS: `transitionDuration`
 * reading `0s, 0.16s` and `overflow` computing to `hidden` are the two answers,
 * and neither is a string you can grep the file for.
 *
 * ## Why all five in one document
 *
 * Because the five were written apart, over five commits, and they share
 * `scene.ts`, `values.ts`, `paint.ts`, `export.ts` and `compile.ts`. A text node
 * in an uploaded font, with a gradient fill and a blur, that a spring-eased
 * machine moves, on a page that links to another page: that sentence is one
 * document, and every table the five extended has to still be right for all of
 * its neighbours for the sentence to come out the other end. Five thin documents
 * would prove five things that were already proved one file over.
 *
 * ## Why the drawn state gets the blur
 *
 * The machine template's hover moves the button two pixels and changes nothing
 * else, so its transition names one property — and one property is the single
 * width at which the broken `transition` spelling and the correct one are the
 * same characters. Blurring the state the document *draws* makes entering hover
 * un-blur as well as move, which is two, which is the narrowest document that can
 * see the bug. It is a real thing to write, not a probe: a design that sharpens
 * on hover is an ordinary design.
 */

/** Everything the page said that a person should never have to see. */
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

/** What one element's paint and pacing come to, as the browser computed them. */
const painted = (page: Page, selector: string) =>
	page
		.locator(selector)
		.first()
		.evaluate((el) => {
			const style = getComputedStyle(el);
			return {
				backgroundImage: style.backgroundImage,
				fontFamily: style.fontFamily,
				filter: style.filter,
				transitionProperty: style.transitionProperty,
				transitionDuration: style.transitionDuration,
				transitionTimingFunction: style.transitionTimingFunction,
			};
		});

/**
 * Assert every entry of a `transition` is paced.
 *
 * The whole of the second bug, asked of the browser rather than of the text.
 * `transitionProperty` and `transitionDuration` are equal-length lists once the
 * shorthand is parsed, so a property the declaration meant to pace and did not is
 * a `0s` sitting beside a name — which is what `a, b 200ms` computes to, and what
 * no amount of reading the stylesheet will tell you. Asserted against the
 * property list rather than against a count, so the failure names the property
 * that snapped.
 */
async function expectEveryPropertyIsPaced(page: Page, selector: string): Promise<void> {
	const paced = await page
		.locator(selector)
		.first()
		.evaluate((el) => {
			const style = getComputedStyle(el);
			const names = style.transitionProperty.split(", ");
			const durations = style.transitionDuration.split(", ");
			return names.map((name, i) => `${name} ${durations[i] ?? "?"}`);
		});
	expect(paced.length, `${selector} transitions nothing`).toBeGreaterThan(1);
	expect(paced.filter((entry) => / 0s$/.test(entry)), selector).toEqual([]);
}

test("a document with all five in it is exported, and the exported file is the design", async () => {
	// A persistent profile for `studio.spec.ts`'s reason: the app's real storage
	// path is IndexedDB, and a context that throws its database away exercises the
	// one case where opening one always works. One pass rather than two — the
	// returning-browser question is that spec's, and asking it twice would double
	// the slowest test in the repository to prove nothing new.
	const profile = test.info().outputPath("browser-profile");
	const context: BrowserContext = await chromium.launchPersistentContext(profile);
	try {
		const page = await context.newPage();
		const trouble = watchForTrouble(page);

		/* ---------------------------------------------------------------- */
		/* The document                                                      */
		/* ---------------------------------------------------------------- */

		// The Machine template, because a machine is the one of the five that cannot
		// be added to a document in a couple of clicks, and because its two states
		// and three transitions are what the easing and the trigger have to be about.
		await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
		await page.locator('[data-template="machine"]').click();
		await page.waitForURL(/\/p\//);
		const status = page.locator('[data-role="status"]');
		await expect(status).toContainText(/\d+ universes/);
		// Remembered now, and asserted again at the end. Everything this test does
		// after this line is a state, a delta, a curve and a link — and not one of
		// them is an `alt/2`, so not one of them may branch the space. A document
		// that gained a universe from a hover would be the invariant breaking, and
		// it would break silently: the file would still export, and it would export
		// one arbitrary point of a space that had quietly doubled.
		//
		// The size of the space and nothing else: the status bar also prints how long
		// the solve took and how much is selected, and neither is a fact about the
		// document. Comparing the whole line would make this a flake about
		// milliseconds rather than an assertion about universes.
		const spaceSize = async (): Promise<string> =>
			/^\d+ universes · \d+ variables varying/.exec((await status.textContent()) ?? "")?.[0] ??
			"";
		const universes = await spaceSize();
		expect(universes, "the status bar stopped saying how big the space is").not.toBe("");

		// A face the machine this test runs on does not have, so "the words came out
		// in it" is a statement about the bytes travelling rather than about a font
		// stack resolving to something the reader happened to own.
		await page.locator('[data-panel="fonts"]').click();
		await page.locator('[data-role="add-font"]').setInputFiles({
			name: "WideFixture.ttf",
			mimeType: "font/ttf",
			buffer: Buffer.from(wideFont()),
		});
		await expect(page.locator('[data-role="font"]')).toHaveCount(1);
		await expect(page.locator('[data-role="font-waiting"]')).toHaveCount(0);

		// The label wears it, and is blurred. Both on the *definition*, so both have
		// to survive being copied into the instance the machine drives — which is the
		// seam between the paint properties and components, and it is not the one
		// this test is named for.
		await page.locator('[data-panel="properties"]').click();
		await page.locator('[data-layer="label"]').click();
		await page
			.locator('[data-prop="fontFamily"] select[data-role="literal"]')
			.selectOption({ label: "Wide Fixture" });
		const blur = page.locator('[data-prop="blur"] input[data-role="literal"]');
		await blur.fill("2px");
		await blur.press("Enter");

		// A gradient over the button's fill. `background-image` rather than
		// `background`, which is the one word that could have wiped every fill in the
		// document, so it is read back off the element below rather than trusted.
		await page.locator('[data-layer="button"]').click();
		await page
			.locator('[data-prop="gradient"] select[data-role="literal"]')
			.selectOption({ label: "Linear, down" });

		// A spring on the way in. The note is asserted because a curve that resolved
		// to nothing still renders a select with a word in it; "Settles" is written
		// from the sampled physics, so it is only there if the spring was understood.
		await page.locator('[data-panel="machines"]').click();
		const enter = page.locator('[data-role="transition-easing"][data-transition="enter"]');
		await expect(enter).toHaveCount(1);
		await enter
			.locator('[data-prop="transition-easing"] select[data-role="literal"]')
			.selectOption({ label: "Spring — bouncy" });
		await expect(enter.locator('[data-role="curve-note"]')).toContainText("Settles");

		// And the second property, on the state the document draws — see the note at
		// the top for why this one line is the point of the whole spec.
		await page
			.locator('select[data-role="add-delta"]')
			.first()
			.selectOption({ label: "Layer blur" });
		await expect(
			page.locator('[data-role="state-delta"][data-part="button"][data-field="blur"]'),
		).toHaveCount(1);
		// Waited for on the *canvas*, and the wait is an assertion rather than
		// patience. A delta is a document edit, and what the artboard draws is an
		// answer set — so the blur is on screen only once the edit has been compiled,
		// solved and read back, and everything below this line is about a file
		// written from that same model. Polling the picture rather than sleeping also
		// says the thing worth saying: the state the document draws is blurred and
		// the state it moves to is not, which is the design, and the two lines below
		// are the studio's half of the agreement the exported file has to keep.
		const canvasFilter = (node: string) =>
			page
				.locator(`[data-artboard] [data-node="${node}"]`)
				.first()
				.evaluate((el) => getComputedStyle(el).filter);
		await expect
			.poll(() => canvasFilter("inst(resting,button)"), {
				message: "the delta never reached the canvas",
			})
			.toBe("blur(8px)");
		expect(await canvasFilter("inst(hovering,button)")).toBe("none");

		// Somewhere to go, and the thing that goes there.
		await page.locator('[data-role="add-page"]').click();
		await expect(page.locator('[data-page="Page"]')).toHaveCount(1);
		await page.locator('[data-page="main"] button').first().click();
		await expect(status).toContainText(/\d+ universes/);
		await page.locator('[data-panel="properties"]').click();
		await page.locator('[data-layer="resting"]').click();
		await page.locator('[data-role="link-to"]').selectOption({ label: "Page" });
		await expect(page.locator('[data-role="link-badge"]')).toHaveCount(1);

		// The invariant, now that every one of the five is in the document.
		await expect.poll(spaceSize, { message: "a state or a link branched the space" }).toBe(
			universes,
		);

		/* ---------------------------------------------------------------- */
		/* The export                                                        */
		/* ---------------------------------------------------------------- */

		await page.locator('[data-panel="constraints"]').click();
		await page.locator('[data-tab="export"]').click();
		const pre = page.locator('[data-role="export-text"]');
		// **Polled, and on the anchor rather than on the doctype.** The panel is a
		// view of the last answer set, not of the document: an edit reaches it only
		// once the scene has been compiled, solved and read back, so a `textContent()`
		// taken the instant the tab opens is a file written from the document as it
		// was one edit ago. It has a doctype in it either way, which is what makes
		// that the wrong thing to wait for. The href is the last edit this test made,
		// so an export that names it is an export that has caught up with all of them
		// — and it is also the assertion that the link left the studio at all: a
		// linked node exports as an ordinary `<div>` when the pages map does not hold
		// its target, silently and by design, because an `<a href>` that 404s is worse
		// than a box.
		await expect(pre).toContainText('href="Page.html"');
		const html = (await pre.textContent()) ?? "";

		// Every transition in the file, before a browser is asked about any of them.
		// The computed-style check below is the one that matters, but it can only ask
		// about the elements this document happens to draw; this asks about all of
		// them, and it is the assertion that fails first and most legibly.
		const declarations = [...html.matchAll(/transition: ([^;]*);/g)].map((m) => m[1]);
		expect(declarations.length, "the machine paced nothing at all").toBeGreaterThan(0);
		for (const declaration of declarations) {
			for (const entry of declaration.split(", ")) {
				expect(entry, `“${entry}” is not a whole transition`).toMatch(
					/^\S+ \d+ms \S+ -?\d+ms$/,
				);
			}
		}
		// And at least one of them names more than one property, or the check above
		// held nothing down. This is the line that fails if a template changes under
		// the test rather than the exporter breaking.
		expect(
			declarations.some((d) => d.includes(", ")),
			"no state changed two things, so nothing here was tested",
		).toBe(true);

		const file = test.info().outputPath("exported.html");
		await writeFile(file, html, "utf8");

		/* ---------------------------------------------------------------- */
		/* The exported file, as a file                                      */
		/* ---------------------------------------------------------------- */

		// A `file://` url, deliberately: an export promises to need no network at
		// all, and a page served over `http` from the dev server could satisfy a
		// fetch this file must never make. Nothing here is same-origin with anything.
		const opened = await context.newPage();
		const openedTrouble = watchForTrouble(opened);
		await opened.goto(`file://${file}`, { waitUntil: "load" });

		// The font travelled. Asserted through `document.fonts` rather than through
		// the computed family, because a `font-family` naming a face the file never
		// carried computes to exactly the same string and draws in the fallback.
		await expect
			.poll(() =>
				opened.evaluate(() => [...document.fonts].map((face) => face.family)),
			)
			.toContain("Wide Fixture");

		const label = await painted(opened, '[data-node="inst(resting,label)"]');
		expect(label.fontFamily.startsWith('"Wide Fixture"'), label.fontFamily).toBe(true);
		expect(label.filter).toBe("blur(2px)");

		const button = await painted(opened, '[data-node="inst(resting,button)"]');
		expect(button.backgroundImage).toContain("linear-gradient");
		// The other half of the agreement: the canvas drew the drawn state blurred at
		// eight pixels a few dozen lines up, and this is the same box in the file.
		expect(button.filter).toBe("blur(8px)");
		// The gradient sits *over* the fill rather than instead of it, which is what
		// `background-image` buys and what `background` would have cost.
		await expect(
			opened.locator('[data-node="inst(resting,button)"]').first(),
		).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

		// The spring resolved to the sampled curve rather than to the `cubic-bezier`
		// the `@supports` block exists to be upgraded from. Chromium parses
		// `linear()`, so seeing the fallback here means the upgrade did not apply.
		expect(button.transitionTimingFunction).toContain("linear(");

		// The bug this spec is named for, asked of the browser.
		await expectEveryPropertyIsPaced(opened, '[data-node="inst(resting,button)"]');

		// No box in the file is a scroll container. `overflow: clip` cuts off what
		// `hidden` cuts off and is not a scrollport, which is what leaves
		// `animation-timeline: view()` resolving against the document.
		expect(
			await opened.evaluate(
				() =>
					[...document.querySelectorAll("*")].filter(
						(el) => getComputedStyle(el).overflow === "hidden",
					).length,
			),
			"a surface that clips with `hidden` is a scrollport",
		).toBe(0);

		// The link is an anchor to the file the other page exports as — the losses
		// say so, and a prototype whose pages are separate files is what that means.
		await expect(opened.locator("a[href]")).not.toHaveCount(0);

		expect(openedTrouble, "the exported file logged errors").toEqual([]);
		expect(trouble, "the studio logged errors").toEqual([]);
	} finally {
		await context.close();
	}
});
