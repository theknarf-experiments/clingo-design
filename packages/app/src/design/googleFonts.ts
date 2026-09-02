/**
 * Google Fonts, fetched into the project as bytes.
 *
 * ## What this is, and why it is not what was rejected
 *
 * `docs/framer-parity-plan.md` §9 turned a Google Fonts fetcher down, and the
 * reason was sound about the thing it was describing: *"a fetched family is a
 * family a collaborator on a train does not have, and because measurement
 * follows what is loaded, that is genuinely two different designs with two
 * different answer sets."* Every word of that is true of a font referenced by
 * URL — a `<link>` to `fonts.googleapis.com`, a family named in a stack and
 * resolved at paint time by whoever happens to be online.
 *
 * **This is not that.** What is fetched here are the *bytes*, and they go
 * straight into the project's own tree through `putNamedAsset`, exactly where an
 * uploaded file goes. One second after the fetch the project is indistinguishable
 * from one in which somebody dropped the `.woff2` on the panel: the file is in
 * `/assets`, it is a `FontFile` in the document, it syncs through Automerge like
 * every other document, and the collaborator on the train has it because they
 * have the project. Nothing in the document, the compiler, the export or the
 * measurement path can tell where the bytes came from, and that is the whole
 * design — this file is a *source of bytes* and not a new kind of font
 * reference. The picker is online; the font is not.
 *
 * So the objection survives, narrowed to what it was always really about: a
 * family that is only ever *linked* is a design nobody can reproduce. A family
 * that is fetched once and stored is a file.
 *
 * ## Three endpoints, two of which a browser may read
 *
 * Checked against the live service rather than assumed, because all three
 * answers decide something here:
 *
 *   - `fonts.google.com/metadata/fonts` — the catalogue. Answers 200 with 2.7 MB
 *     of JSON and **no `access-control-allow-origin` header at all**, so a
 *     browser cannot read it under any circumstances. That is why the family list
 *     is a generated snapshot in the bundle; see `googleCatalog.ts`.
 *   - `fonts.googleapis.com/css2` — the stylesheet naming the files. Answers
 *     `access-control-allow-origin: *`. Readable, and it is the authority on what
 *     exists: an unknown family is a 400.
 *   - `fonts.gstatic.com` — the bytes. Answers `access-control-allow-origin: *`.
 *
 * Which means the fetch is two round trips and no proxy, no API key and no
 * server of ours: ask css2 what the files are, then take one.
 *
 * ## What comes across, and what is left behind on purpose
 *
 * A css2 response is one `@font-face` per *subset* per weight — Inter is eight
 * subsets, so "download Inter" could mean eight files and a quarter of a
 * megabyte for a design with three words of English in it. Bringing all of them
 * would put the cost of every script in the world into every project.
 *
 * So one subset comes across, Latin by default, and everything else is reported
 * through the panel's existing "what the last import could not bring across"
 * channel — the same sentence a `.glb` gets when its textures are dropped. That
 * is the honest shape: a designer setting Devanagari finds out in the panel that
 * they got Latin, rather than finding out in the export.
 *
 * Italics are left behind for the same reason and reported the same way. A
 * family's italic is a second file with a second `font-style`, and the `weight`
 * descriptor essay on {@link FontFile.weight} explains why an unasked-for face
 * is worse than a missing one: a real italic and a synthesised slant are hard to
 * tell apart in a panel and easy to tell apart in print.
 */
import type { FontDescription } from "./fontFiles.ts";
import { FONT_CATEGORIES, GOOGLE_CATALOG } from "./googleCatalog.ts";

export type FontCategory = (typeof FONT_CATEGORIES)[number];

/** One family as the bundled snapshot holds it. */
export interface GoogleFamily {
	name: string;
	category: FontCategory;
	/** The static instances Google publishes, ascending. Never empty. */
	weights: number[];
	/** Whether the family has italics at all. They are not fetched — see above. */
	italic: boolean;
	/** The `wght` axis, on the families that have one. */
	variable?: { min: number; max: number };
}

/**
 * The snapshot, parsed once.
 *
 * Lazily and memoised rather than at module scope: two thousand lines is a
 * millisecond, but it is a millisecond nobody should spend on the studio's first
 * paint when the fonts panel may never be opened.
 */
let parsed: GoogleFamily[] | undefined;

export function googleFamilies(): GoogleFamily[] {
	if (parsed) return parsed;
	parsed = GOOGLE_CATALOG.trim()
		.split("\n")
		.map((line) => {
			const [name, category, weights, italic, range] = line.split("|");
			const [min, max] = range ? range.split("..").map(Number) : [];
			return {
				name,
				category: FONT_CATEGORIES[Number(category)] ?? FONT_CATEGORIES[0],
				weights: weights ? weights.split(",").map(Number) : [400],
				italic: italic === "1",
				...(range ? { variable: { min, max } } : {}),
			};
		});
	return parsed;
}

/**
 * Families matching what has been typed, best first.
 *
 * Prefix before substring, because somebody typing "rob" wants Roboto above
 * Frijole, and within each the catalogue's own alphabetical order — which is
 * stable, so the list does not reshuffle under a cursor as a fourth letter
 * arrives.
 *
 * No fuzzy matching. A typo here costs one backspace, and a fuzzy list that puts
 * a family somebody did not ask for at the top of a menu they are about to click
 * is a font in a design nobody chose.
 */
export function searchGoogle(query: string, limit = 40): GoogleFamily[] {
	const q = query.trim().toLowerCase();
	if (!q) return googleFamilies().slice(0, limit);
	const starts: GoogleFamily[] = [];
	const has: GoogleFamily[] = [];
	for (const f of googleFamilies()) {
		const name = f.name.toLowerCase();
		if (name.startsWith(q)) starts.push(f);
		else if (name.includes(q)) has.push(f);
		if (starts.length >= limit) break;
	}
	return [...starts, ...has].slice(0, limit);
}

/**
 * Which weights to ask for, and it is at most two.
 *
 * A variable family is one file covering its whole range, which is the case this
 * is easy in: one request, one file, and the `weight` property moves along a real
 * axis. A static family is one file *per weight*, so "the whole family" would be
 * nine downloads to get a heading and a paragraph — hence regular and bold, the
 * two a document actually sets text in, and the rest reported as left behind.
 *
 * Regular is whatever the family calls regular: 400 where it exists, and
 * otherwise the lightest weight published, because a display face whose only
 * instance is 700 should still arrive rather than be declared unavailable.
 */
export function weightsToFetch(family: GoogleFamily): number[] {
	if (family.variable) return [];
	const regular = family.weights.includes(400) ? 400 : family.weights[0];
	const bold = family.weights.includes(700) ? 700 : undefined;
	return bold && bold !== regular ? [regular, bold] : [regular];
}

/**
 * The css2 url for a family.
 *
 * `family=` takes the name with spaces as `+`, and the axis tuple decides what
 * comes back. Nothing here is escaped by hand: `URL` and `URLSearchParams` would
 * percent-encode the `@` and the `..` that css2 requires literally, so the query
 * is built as text — which is safe precisely because the only interpolated value
 * is a family name out of a generated catalogue or a field this function's caller
 * has already matched against one.
 */
export function cssUrl(family: GoogleFamily): string {
	const name = family.name.replace(/ /g, "+");
	const axis = family.variable
		? `:wght@${family.variable.min}..${family.variable.max}`
		: `:wght@${weightsToFetch(family).join(";")}`;
	return `https://fonts.googleapis.com/css2?family=${name}${axis}`;
}

/** One `@font-face` block of a css2 response. */
export interface FaceBlock {
	/** The subset named in the comment above the block — `latin`, `greek`. */
	subset?: string;
	family: string;
	/** The descriptor verbatim: `400`, or `100 900` for a variable face. */
	weight: string;
	style: string;
	url: string;
	unicodeRange?: string;
}

/**
 * Every `@font-face` in a css2 response, in order.
 *
 * A real CSS parser was not needed and would not have been better: this is one
 * generator's output in one shape, and the shape is `/* subset *\/` then a block
 * of five declarations. Matching that directly means the subset comment — which
 * is not CSS and which a parser would throw away — survives, and it is the field
 * this whole flow turns on.
 */
export function parseFaceCss(css: string): FaceBlock[] {
	const blocks: FaceBlock[] = [];
	const re = /(?:\/\*\s*([^*]+?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
	for (const [, subset, body] of css.matchAll(re)) {
		const read = (prop: string): string | undefined =>
			body.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim();
		const url = body.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, "");
		const family = read("font-family")?.replace(/['"]/g, "");
		if (!url || !family) continue;
		blocks.push({
			...(subset ? { subset } : {}),
			family,
			weight: read("font-weight") ?? "400",
			style: read("font-style") ?? "normal",
			url,
			...(read("unicode-range") ? { unicodeRange: read("unicode-range") } : {}),
		});
	}
	return blocks;
}

/**
 * The subset to bring across, and the ones being left.
 *
 * Latin by name first. Where a family has no block called `latin` — a
 * Devanagari or Thai face that Google publishes without one — the fallback is the
 * block whose `unicode-range` covers Basic Latin, and after that the first block
 * there is, because arriving with the wrong subset and a sentence saying so beats
 * refusing a family that exists.
 */
export function chooseSubset(blocks: FaceBlock[]): {
	subset: string | undefined;
	dropped: string[];
} {
	const named = blocks.find((b) => b.subset === "latin");
	const covering = blocks.find((b) => /U\+0000-00FF/i.test(b.unicodeRange ?? ""));
	const subset = (named ?? covering ?? blocks[0])?.subset;
	const dropped = [
		...new Set(
			blocks
				.map((b) => b.subset)
				.filter((s): s is string => s !== undefined && s !== subset),
		),
	];
	return { subset, dropped };
}

/** `Playfair Display` at 700 → `PlayfairDisplay-700.woff2`. */
export function fileNameFor(family: GoogleFamily, weight: string): string {
	const stem = family.name.replace(/[^A-Za-z0-9]/g, "");
	const tail = weight.includes(" ") ? "Variable" : weight;
	return `${stem}-${tail}.woff2`;
}

/**
 * The files a fetch of this family would write, by name.
 *
 * So the picker can say "in project" against a family whose bytes are already
 * here rather than fetching them twice — `putNamedAsset` would suffix the second
 * copy to `Inter-Variable-2.woff2` and the project would carry the same face
 * under two paths, with the panel listing both and nothing saying which is which.
 *
 * Derived from the same two functions the fetch itself uses, so the question and
 * the answer cannot drift apart.
 */
export function fetchedFileNames(family: GoogleFamily): string[] {
	return family.variable
		? [fileNameFor(family, `${family.variable.min} ${family.variable.max}`)]
		: weightsToFetch(family).map((w) => fileNameFor(family, String(w)));
}

/** One face, fetched and ready for the panel's own `adopt`. */
export interface FetchedFace {
	name: string;
	bytes: Uint8Array;
	describe: FontDescription;
}

/**
 * What a family's fetch produced, and what it did not.
 *
 * `lost` is the panel's existing channel and carries the same kind of sentence
 * an imported `.glb` gets: what was dropped, in the designer's terms, at the
 * moment they can still do something about it.
 */
export interface FetchedFamily {
	faces: FetchedFace[];
	lost: string[];
}

/**
 * Fetch one family's chosen subset, as bytes.
 *
 * `load` is injectable so the whole of this module is testable without a
 * network, and so the one place that touches `fetch` is a parameter rather than
 * a global — the same reason `design-core` takes a solver rather than importing
 * one.
 */
export async function fetchGoogleFamily(
	family: GoogleFamily,
	load: typeof fetch = fetch,
): Promise<FetchedFamily> {
	const res = await load(cssUrl(family));
	if (!res.ok) {
		throw new Error(
			res.status === 400
				? `Google Fonts does not serve a family called “${family.name}”.`
				: `Google Fonts answered ${res.status}.`,
		);
	}
	const blocks = parseFaceCss(await res.text());
	if (blocks.length === 0) throw new Error("That stylesheet named no font files.");

	const { subset, dropped } = chooseSubset(blocks);
	const wanted = blocks.filter((b) => b.subset === subset);
	const faces: FetchedFace[] = [];
	for (const block of wanted) {
		const file = await load(block.url);
		if (!file.ok) throw new Error(`That font file answered ${file.status}.`);
		faces.push({
			name: fileNameFor(family, block.weight),
			bytes: new Uint8Array(await file.arrayBuffer()),
			// Known rather than guessed, which is the one way a fetch beats an
			// upload: `describeFont` reads a filename stem and a weight heuristic
			// because a `.woff2`'s tables are Brotli, while css2 states the family,
			// the descriptor and the style outright.
			describe: {
				family: family.name,
				weight: block.weight,
				style: block.style,
				...(family.variable
					? { axes: [{ tag: "wght", min: family.variable.min, max: family.variable.max, def: 400 }] }
					: {}),
			},
		});
	}

	const lost: string[] = [];
	if (dropped.length > 0) {
		lost.push(
			`${dropped.length} other ${dropped.length === 1 ? "subset" : "subsets"} — ${dropped.join(", ")}. Only ${subset ?? "one subset"} came across, because a family's every script is a file each and a page that sets three words of English should not carry Cyrillic. Add the others by hand if you need them.`,
		);
	}
	if (family.italic) {
		lost.push(
			"Italics. A real italic is a second file with its own font-style, and one that arrives unasked-for is hard to tell from a synthesised slant in a panel and easy to tell apart in print.",
		);
	}
	const got = new Set(faces.map((f) => f.describe.weight));
	const missed = family.variable
		? []
		: family.weights.filter((w) => !got.has(String(w)));
	if (missed.length > 0) {
		lost.push(
			`${missed.length} other weight${missed.length === 1 ? "" : "s"} — ${missed.join(", ")}. A static family is one file per weight, so regular and bold come across and the rest are a download each.`,
		);
	}
	return { faces, lost };
}
