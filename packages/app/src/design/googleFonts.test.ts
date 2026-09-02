/**
 * The fetcher, tested without a network.
 *
 * The stylesheets below are **real** css2 responses, trimmed to the blocks each
 * test is about. That matters more here than it usually does: the whole feature
 * rests on a claim about somebody else's server — that a subset comment sits
 * above each block, that a variable face states its range as `100 900`, that the
 * `src` is a bare `url(...)` — and a fixture written from memory would test this
 * module against my idea of Google rather than against Google.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type GoogleFamily,
	chooseSubset,
	cssUrl,
	fetchGoogleFamily,
	fileNameFor,
	googleFamilies,
	parseFaceCss,
	searchGoogle,
	weightsToFetch,
} from "./googleFonts.ts";

/** Inter, a variable family, as css2 actually answers — three of its subsets. */
const INTER_CSS = `/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/inter/v20/cyrillic.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}
/* greek */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/inter/v20/greek.woff2) format('woff2');
  unicode-range: U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/inter/v20/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122, U+FFFD;
}`;

const inter = (): GoogleFamily =>
	googleFamilies().find((f) => f.name === "Inter") ?? assert.fail("no Inter");

test("the bundled catalogue parses into families", () => {
	const all = googleFamilies();
	assert.ok(all.length > 1000, `only ${all.length} families`);
	const f = inter();
	assert.equal(f.category, "Sans Serif");
	assert.deepEqual(f.variable, { min: 100, max: 900 });
	assert.equal(f.italic, true);
	assert.ok(f.weights.includes(400) && f.weights.includes(900));
});

test("a static family has no variable range", () => {
	const lobster = googleFamilies().find((f) => f.name === "Lobster");
	assert.ok(lobster);
	assert.equal(lobster.variable, undefined);
	assert.deepEqual(lobster.weights, [400]);
});

test("search puts a prefix above a substring", () => {
	const hits = searchGoogle("rob", 20).map((f) => f.name);
	assert.ok(hits.includes("Roboto"));
	// `Frijole` contains no "rob"; `Robot`-prefixed families must come first, so
	// the first hit is a prefix match rather than something merely containing it.
	assert.ok(hits[0].toLowerCase().startsWith("rob"), `got ${hits[0]}`);
});

test("an empty query is the head of the catalogue rather than nothing", () => {
	assert.equal(searchGoogle("", 5).length, 5);
});

test("a variable family is asked for as a range, a static one as weights", () => {
	assert.equal(cssUrl(inter()), "https://fonts.googleapis.com/css2?family=Inter:wght@100..900");
	const lobster = googleFamilies().find((f) => f.name === "Lobster");
	assert.ok(lobster);
	assert.equal(cssUrl(lobster), "https://fonts.googleapis.com/css2?family=Lobster:wght@400");
});

test("a two-word family becomes a plus, and the axis is not percent-encoded", () => {
	const playfair = googleFamilies().find((f) => f.name === "Playfair Display");
	assert.ok(playfair);
	const url = cssUrl(playfair);
	assert.ok(url.includes("family=Playfair+Display"), url);
	assert.ok(url.includes("@"), `the axis was escaped: ${url}`);
});

test("regular and bold, and never nine downloads", () => {
	assert.deepEqual(weightsToFetch({ ...inter(), variable: undefined }), [400, 700]);
	// A display face with one instance arrives rather than being refused.
	assert.deepEqual(
		weightsToFetch({ name: "x", category: "Display", weights: [700], italic: false }),
		[700],
	);
	// A variable family is one file for the whole range.
	assert.deepEqual(weightsToFetch(inter()), []);
});

test("every @font-face of a real response is read, comment and all", () => {
	const blocks = parseFaceCss(INTER_CSS);
	assert.equal(blocks.length, 3);
	assert.deepEqual(
		blocks.map((b) => b.subset),
		["cyrillic", "greek", "latin"],
	);
	assert.equal(blocks[2].family, "Inter");
	assert.equal(blocks[2].weight, "100 900");
	assert.equal(blocks[2].style, "normal");
	assert.equal(blocks[2].url, "https://fonts.gstatic.com/s/inter/v20/latin.woff2");
});

test("latin is chosen and the rest are named", () => {
	const { subset, dropped } = chooseSubset(parseFaceCss(INTER_CSS));
	assert.equal(subset, "latin");
	assert.deepEqual(dropped, ["cyrillic", "greek"]);
});

test("a family with no latin block falls back to the range that covers it", () => {
	const css = INTER_CSS.replace("/* latin */", "/* devanagari */");
	const { subset } = chooseSubset(parseFaceCss(css));
	// Named `devanagari` but carrying U+0000-00FF, which is the block a Latin
	// design needs; the name is Google's label and the range is the fact.
	assert.equal(subset, "devanagari");
});

test("a fetch brings one subset across and says what it did not", async () => {
	const bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32]);
	const seen: string[] = [];
	const load = (async (url: string) => {
		seen.push(String(url));
		return String(url).endsWith(".woff2")
			? { ok: true, status: 200, arrayBuffer: async () => bytes.buffer }
			: { ok: true, status: 200, text: async () => INTER_CSS };
	}) as unknown as typeof fetch;

	const { faces, lost } = await fetchGoogleFamily(inter(), load);

	assert.equal(faces.length, 1, "one subset, not three");
	assert.equal(faces[0].name, "Inter-Variable.woff2");
	assert.equal(faces[0].describe.family, "Inter");
	// Known from the stylesheet rather than guessed from the filename, which is
	// the one thing a fetch does better than an upload.
	assert.equal(faces[0].describe.weight, "100 900");
	assert.deepEqual(faces[0].describe.axes, [
		{ tag: "wght", min: 100, max: 900, def: 400 },
	]);
	assert.equal(seen[0], "https://fonts.googleapis.com/css2?family=Inter:wght@100..900");
	assert.equal(seen[1], "https://fonts.gstatic.com/s/inter/v20/latin.woff2");

	assert.equal(lost.length, 2, lost.join(" | "));
	assert.ok(lost[0].includes("cyrillic, greek"), lost[0]);
	assert.ok(lost[1].startsWith("Italics"), lost[1]);
});

test("a family Google does not serve says so in the designer's words", async () => {
	const load = (async () => ({ ok: false, status: 400 })) as unknown as typeof fetch;
	await assert.rejects(
		fetchGoogleFamily({ name: "Nope", category: "Serif", weights: [400], italic: false }, load),
		/does not serve a family called/,
	);
});

test("a static family's other weights are reported, not silently dropped", async () => {
	const css = `/* latin */
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/roboto/400.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;
	const load = (async (url: string) =>
		String(url).endsWith(".woff2")
			? { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1]).buffer }
			: { ok: true, status: 200, text: async () => css }) as unknown as typeof fetch;

	const { lost } = await fetchGoogleFamily(
		{ name: "Roboto", category: "Sans Serif", weights: [100, 400, 700], italic: false },
		load,
	);
	const weights = lost.find((l) => l.includes("weight"));
	assert.ok(weights, lost.join(" | "));
	assert.ok(weights.includes("100, 700"), weights);
});

test("a file is named after the family and the weight", () => {
	const playfair = googleFamilies().find((f) => f.name === "Playfair Display");
	assert.ok(playfair);
	assert.equal(fileNameFor(playfair, "700"), "PlayfairDisplay-700.woff2");
	assert.equal(fileNameFor(playfair, "400 900"), "PlayfairDisplay-Variable.woff2");
});
