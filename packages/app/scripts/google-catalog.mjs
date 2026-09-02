/**
 * Regenerates `src/design/googleCatalog.ts` from Google's own font metadata.
 *
 *     node scripts/google-catalog.mjs
 *
 * Run it when the snapshot has aged enough to matter. Nothing in the build runs
 * it, and that is deliberate: a build step that reaches the network is a build
 * that fails on a train, and the whole point of this feature is that the tool
 * does not need Google to be reachable in order to work.
 *
 * ## Why there is a snapshot at all
 *
 * `https://fonts.google.com/metadata/fonts` answers 200 with the whole catalogue
 * and **sends no `access-control-allow-origin` header**, so a browser cannot read
 * it — not from the studio, not from a published artefact, not with any amount of
 * fetch options. That is a fact about Google's server, checked rather than
 * assumed, and it is what decides the shape of this feature: the *list* of
 * families ships with the app, and only the *bytes* of a chosen face are fetched,
 * from `fonts.googleapis.com` and `fonts.gstatic.com`, which both answer
 * `access-control-allow-origin: *`.
 *
 * The snapshot going stale is a soft failure by construction. A family added to
 * Google after this file was generated is missing from the search list and still
 * fetches correctly if somebody types its exact name, because the request is
 * built from the name and the css2 endpoint is the authority on what exists.
 *
 * ## What is kept, and what is thrown away
 *
 * The upstream document is 2.7 MB, nearly all of it per-weight typographic
 * measurements (`thickness`, `slant`, `width`, `lineHeight`) for rendering
 * Google's own specimen pages. What a picker needs is the name to search, the
 * category to group by, which weights exist, whether there are italics, and the
 * `wght` range if the family is variable — five fields that compress to 63 kB of
 * text, 14 kB over the wire.
 *
 * Subsets are **not** kept, though the metadata has them. The css2 response names
 * the subsets it is actually serving, in comments, at the moment of the fetch —
 * so keeping a second copy here would be a second answer to a question that has
 * an authoritative one, and the two would disagree the first time Google added a
 * script to a family.
 */

const CATEGORIES = ["Sans Serif", "Serif", "Display", "Handwriting", "Monospace"];

const res = await fetch("https://fonts.google.com/metadata/fonts");
if (!res.ok) throw new Error(`metadata: ${res.status}`);
const { familyMetadataList: families } = await res.json();

const rows = families.map((f) => {
	const faces = f.fonts ?? {};
	const weights = [
		...new Set(
			Object.keys(faces)
				.map((k) => k.replace(/i$/, ""))
				.filter((k) => /^\d+$/.test(k))
				.map(Number),
		),
	].sort((a, b) => a - b);
	const italic = Object.keys(faces).some((k) => k.endsWith("i"));
	const wght = (f.axes ?? []).find((a) => a.tag === "wght");
	const range = wght ? `${Math.round(wght.min)}..${Math.round(wght.max)}` : "";
	const category = Math.max(0, CATEGORIES.indexOf(f.category));
	return `${f.family}|${category}|${weights.join(",")}|${italic ? 1 : 0}|${range}`;
});

const header = `/**
 * Every family Google Fonts served on the day this file was generated, as the
 * five fields a picker needs.
 *
 * **Generated — do not edit.** \`node scripts/google-catalog.mjs\` rewrites it,
 * and the essay at the top of that script is where this file's reasons live:
 * why the catalogue is a snapshot in the bundle rather than a fetch (Google's
 * metadata endpoint sends no CORS header and a browser cannot read it at all),
 * why going stale is a soft failure (the name is what builds the request, and
 * css2 is the authority on what exists), and why subsets are left out.
 *
 * One line per family, because ${rows.length} objects is ${rows.length} objects to parse
 * before the panel can draw and this is read once and cached:
 *
 *     name | category | weights | italic | variable wght range
 *
 * Category is an index into {@link FONT_CATEGORIES}. Weights are the static
 * instances Google publishes, comma-separated. The range is empty for a family
 * with no \`wght\` axis, which is most of them.
 */

/** The five buckets Google files a family under, in its own order. */
export const FONT_CATEGORIES = [
	"Sans Serif",
	"Serif",
	"Display",
	"Handwriting",
	"Monospace",
] as const;

/** Generated ${new Date().toISOString().slice(0, 10)} from https://fonts.google.com/metadata/fonts — ${rows.length} families. */
export const GOOGLE_CATALOG = \`
`;

const out = `${header}${rows.join("\n")}
\`;
`;

const path = new URL("../src/design/googleCatalog.ts", import.meta.url);
await (await import("node:fs/promises")).writeFile(path, out);
console.log(`${rows.length} families -> ${path.pathname}`);
