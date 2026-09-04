import { expect, test, type Page } from "@playwright/test";

import { BASE_URL } from "./server.ts";

/**
 * The sketch layer, in a browser.
 *
 * `sketchsolve.test.ts` already asserts the Orbit template's geometry to four
 * decimal places, and it does it in a tenth of the time this takes. What it
 * cannot do is load a second wasm module through Vite.
 *
 * That is the whole reason this file exists, and it is the same reason the
 * config gives for the lane: `@salusoft89/planegcs` is an ordinary registry
 * dependency, so Vite pre-bundles it and rewrites the `new URL("planegcs.wasm",
 * import.meta.url)` inside its glue to a path in `node_modules/.vite/deps` where
 * no wasm was ever copied. `packages/app/src/sketch/sketcher.ts` answers that
 * with a `?url` import. A `?url` import that stops resolving typechecks
 * perfectly, passes all 1400 unit tests, and leaves every sketch rule in the
 * product silently unsolved — `Sketcher.solve` returns `adrift`, the canvas
 * draws the stored frames, and nothing anywhere says the solver never ran.
 *
 * So the assertion is not about geometry. It is that a real page, having
 * fetched a real 508 KB wasm, reports a sketch that *settled*.
 */
test("the Orbit template's sketch solves in the browser", async ({
	page,
}: {
	page: Page;
}) => {
	const broken: string[] = [];
	page.on("pageerror", (e) => broken.push(String(e)));
	page.on("console", (m) => {
		if (m.type() === "error") broken.push(m.text());
	});

	await page.goto(`${BASE_URL}/`, { waitUntil: "load" });
	await page.locator('[data-template="orbit"]').click();
	await page.waitForURL(/\/p\//);

	const status = page.locator('[data-role="status"]');
	await expect(status).toContainText(/\d+ universes/, { timeout: 30_000 });
	// Three reaches, three orbits. The count comes from the token, so a sketch
	// that never ran would still say three — which is why it is not the assertion.
	await expect(status).toContainText("3");

	// This is the assertion. `1 free` is `SketchReport.dof`, and a dof at all
	// means PlaneGCS answered: the cold-start façade returns `adrift`, which the
	// pill spells differently, and a document whose sketch never reached the
	// Explorer has no pill at all.
	const pill = page.locator('[data-role="sketch"]');
	await expect(pill).toHaveCount(1);
	await expect(pill).toHaveText(/1 free/i);
	// ...and it says the honest thing about what one free placement means.
	await expect(pill).toHaveAttribute("title", /one of infinitely many/i);

	// Thirteen rules: two pins on the hub, six sketch rules, four on the row's
	// ends, and the collinear. A template that lost its constraints in a
	// normalisation would still draw, so the count is worth holding. The sidebar's
	// tab strip is clipped at the default width, hence the resize.
	await page.setViewportSize({ width: 1800, height: 1000 });
	await expect(page.getByRole("button", { name: /^Rules/ })).toContainText("13");

	expect(broken, `the page logged: ${broken.join(" | ")}`).toEqual([]);
});
