/**
 * What a font file says about itself, and what a menu calls the families a page
 * has.
 *
 * Two jobs, and they are here together because they are the two halves of the
 * same seam: `design-core` owns everything answerable from a `Scene`, and this
 * file owns everything answerable only from *bytes* and from *the project on
 * screen*. Neither of those is a document, so neither belongs in a pure package.
 *
 * ## Reading the file, and the decision not to try very hard
 *
 * `.ttf` and `.otf` are raw SFNT, so walking the table directory to `fvar`,
 * `OS/2` and `name` is arithmetic over a `DataView` with no dependency —
 * and Google Fonts' variable downloads are `.ttf`, so it is the common case for
 * somebody uploading a variable font. `.woff` is per-table zlib and `.woff2` is
 * Brotli, which no web API decompresses; reading a `.woff2`'s tables would mean
 * carrying a Brotli decoder in the bundle.
 *
 * **So: parse SFNT, do not carry a decoder, and do not ask a modal.** A `.woff2`
 * gets its family from the filename stem, its weight from a filename heuristic
 * and its style from a trailing `Italic`, and lands in the panel with all of it
 * editable beside a preview strip. The reason that costs nothing that matters is
 * the one stated on {@link FontFile.family}: **the family name is ours.** `new
 * FontFace(name, bytes)` names the face whatever we say, so a misread `name`
 * table cannot produce a design that does not paint — only a label a designer
 * corrects. The one field where being wrong has a consequence is `weight`, and
 * that is exactly the field the preview strip sits under.
 *
 * *Rejected: a modal on upload that asks for the family and the range.* It is a
 * form in front of a drag-and-drop, it asks a question most people cannot answer
 * about a `.woff2` they downloaded, and the answer is visible in the panel a
 * second later anyway.
 */
import {
	type FontAxis,
	type FontFile,
	SYSTEM_FONTS,
	type Scene,
	type ValueOption,
	type ValueType,
	fontFamilies,
	fontStack,
} from "@clingo-design/design-core";

/** The four the tree already knows a MIME for, and the four CSS can load. */
export const FONT_EXTENSIONS = ["woff2", "woff", "ttf", "otf"] as const;

/** What the file input offers, and what the project listing filters by. */
export const FONT_ACCEPT = ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf";

/** The extension of a path, lower-cased, or "". */
const extensionOf = (path: string): string =>
	path.slice(path.lastIndexOf(".") + 1).toLowerCase();

/** Whether a path in the tree is one of the four this panel can offer. */
export const isFontPath = (path: string): boolean =>
	(FONT_EXTENSIONS as readonly string[]).includes(extensionOf(path));

/** `/assets/InterVariable.woff2` → `InterVariable`. */
export const stemOf = (path: string): string =>
	path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/**
 * The menu a `font`-typed row offers in this project: the page's own families
 * first, then the four system stacks.
 *
 * The page's fonts come **first**, because a designer who uploaded a font did it
 * to use it. Merged here rather than in `VALUE_TYPES` because a table that
 * varied per project is a table `compile.ts`, `scene.ts`, `edits.ts` and four
 * components would each have to be handed — `LAYOUT_OPTIONS` writes `VALUE_TYPES`
 * into the generated program at module scope — and because a menu is a
 * presentation concern. The stored value is still an ordinary CSS stack, which
 * is what keeps a document that names a family it has no bytes for painting the
 * rest of its stack instead of nothing at all.
 *
 * **The tail is the sans system stack, for every uploaded family**, and that is a
 * decision rather than an oversight. What the tail is for is the moment before a
 * face has loaded, the page that never got the file, and the SVG export that
 * carries no faces at all — three cases a reader sees for a frame, or sees
 * because something is missing. Making it a fifth editable descriptor would put a
 * field in the panel whose only observable effect is a fallback nobody looks at
 * once the face lands; a designer who wants a different tail writes the stack
 * they want, and `ValueEditor` keeps a value the menu has never seen selectable
 * for exactly that reason.
 */
export function fontOptions(scene: Scene): ValueOption[] {
	const tail = SYSTEM_FONTS[0].value;
	return [
		...[...fontFamilies(scene).keys()]
			.sort()
			.map((family) => ({ value: fontStack(family, tail), label: family })),
		...SYSTEM_FONTS,
	];
}

/**
 * The `options` prop for a value row of any type — the project's font menu for a
 * `font`, and nothing at all for everything else.
 *
 * A helper rather than a ternary at each of the five call sites, and the reason
 * is the one `optionLabel`'s fourth parameter has: `ValueEditor` is shared by
 * five panels, and five copies of "is this a font row" is five chances for one
 * of them to be written `spec.type === "fonts"` and go quietly back to showing
 * the system stacks only. Undefined means the type's own list, which is what
 * `ValueEditor` already does with a missing prop, so a row that forgets to call
 * this is a row that regresses rather than one that breaks — which is precisely
 * why the question is asked in one place.
 */
export const fontMenu = (
	scene: Scene,
	type: ValueType,
): readonly ValueOption[] | undefined =>
	type === "font" ? fontOptions(scene) : undefined;

/* ------------------------------------------------------------------ */
/* Reading a file                                                      */
/* ------------------------------------------------------------------ */

/** Everything a `FontFile` holds that is not the path or the byte count. */
export type FontDescription = Pick<
	FontFile,
	"family" | "weight" | "style" | "stretch" | "axes"
>;

/**
 * What this file appears to be, read as far as the format allows.
 *
 * Never throws and never returns nothing: every field has an honest default, and
 * the panel makes all of them editable. A file that is not a font at all does
 * not reach here — the upload flow constructs a `FontFace` over the bytes and
 * awaits `load()` first, which is this flow's `parseGltfFile`: the check that has
 * to happen anyway, done before anything is written.
 */
export function describeFont(name: string, bytes: Uint8Array): FontDescription {
	const stem = name.replace(/\.[^.]+$/, "");
	const sfnt = extensionOf(name) === "ttf" || extensionOf(name) === "otf"
		? readSfnt(bytes)
		: undefined;
	if (sfnt) return sfnt;
	return {
		family: prettyStem(stem),
		weight: weightFromName(stem),
		style: /italic|oblique/i.test(stem) ? "italic" : "normal",
	};
}

/**
 * A filename stem as a family label — `Inter-Variable_wght` → `Inter Variable`.
 *
 * Separators become spaces and the words that are descriptors rather than names
 * are dropped from the end, because "Inter Variable Regular" is not what anybody
 * calls the typeface. Conservative: only a trailing run of them goes, so a family
 * genuinely called "Black" survives being called Black.
 */
function prettyStem(stem: string): string {
	const words = stem
		.replace(/\[[^\]]*\]/g, " ")
		.replace(/[_-]+/g, " ")
		// `InterVariable` → `Inter Variable`, which is how these files are named.
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/\s+/)
		.filter(Boolean);
	while (words.length > 1 && DESCRIPTOR_WORDS.has(words[words.length - 1].toLowerCase())) {
		words.pop();
	}
	return words.join(" ") || stem;
}

const DESCRIPTOR_WORDS = new Set([
	"variable",
	"vf",
	"regular",
	"italic",
	"oblique",
	"thin",
	"extralight",
	"ultralight",
	"light",
	"book",
	"medium",
	"semibold",
	"demibold",
	"bold",
	"extrabold",
	"black",
	"heavy",
	"subset",
	"webfont",
]);

/** What a static face's filename usually means by a weight word. */
const WEIGHT_WORDS: Record<string, string> = {
	thin: "100",
	extralight: "200",
	ultralight: "200",
	light: "300",
	regular: "400",
	book: "400",
	normal: "400",
	medium: "500",
	semibold: "600",
	demibold: "600",
	bold: "700",
	extrabold: "800",
	black: "900",
	heavy: "900",
};

/**
 * The weight descriptor a filename suggests.
 *
 * A range wins over a word, because a file that says it is variable is variable
 * whatever else its name claims, and declaring a variable face as a single number
 * clamps it to its default instance — the failure that comes out as a synthesised
 * faux bold. `"400"` is the answer for a name that says nothing, which is what a
 * face with no descriptor means to CSS anyway.
 */
function weightFromName(stem: string): string {
	if (/\[|\bvariable\b|\bvf\b|\bwght\b/i.test(stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2"))) {
		return "100 900";
	}
	const words = stem.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_-]+/);
	for (let at = words.length - 1; at >= 0; at--) {
		const found = WEIGHT_WORDS[words[at].toLowerCase()];
		if (found) return found;
	}
	return "400";
}

/* ------------------------------------------------------------------ */
/* SFNT                                                                */
/* ------------------------------------------------------------------ */

/** A 16.16 fixed-point number, as `fvar` writes every axis bound. */
const fixed = (view: DataView, at: number): number =>
	Math.round((view.getInt32(at) / 65536) * 1000) / 1000;

/**
 * The three tables that answer the three questions, or nothing.
 *
 * Wrapped in one try/catch rather than bounds-checked field by field: a
 * truncated or hostile file is a file whose descriptors are guessed from its
 * name, which is the same answer a `.woff2` gets and is a state the panel is
 * already built to show. The bytes themselves are validated by `FontFace.load()`
 * before any of this runs, so what is being defended against here is a font the
 * browser accepts and this reader does not understand — which is a label to
 * correct, never a design that fails to paint.
 */
function readSfnt(bytes: Uint8Array): FontDescription | undefined {
	try {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const tag = view.getUint32(0);
		// `0x00010000` is TrueType outlines and `OTTO` is CFF; both are SFNT and
		// both carry the same three tables. A collection (`ttcf`) is refused rather
		// than having its first font taken: a file holding four faces is not one
		// face, and `FontFace` will not load it either.
		if (tag !== 0x00010000 && tag !== 0x4f54544f) return undefined;
		const count = view.getUint16(4);
		const tables = new Map<string, { at: number; length: number }>();
		for (let i = 0; i < count; i++) {
			const record = 12 + i * 16;
			const name = String.fromCharCode(
				view.getUint8(record),
				view.getUint8(record + 1),
				view.getUint8(record + 2),
				view.getUint8(record + 3),
			);
			tables.set(name, { at: view.getUint32(record + 8), length: view.getUint32(record + 12) });
		}

		const axes = readAxes(view, tables.get("fvar")?.at);
		const wght = axes?.find((a) => a.tag === "wght");
		const wdth = axes?.find((a) => a.tag === "wdth");
		const os2 = tables.get("OS/2")?.at;
		const italic =
			os2 !== undefined
				? (view.getUint16(os2 + 62) & 0x01) === 1
				: false;
		return {
			family: readName(view, tables.get("name")) ?? "Imported",
			// The range where the file has one, and the class where it does not —
			// which is the whole of variable-weight support and is one descriptor
			// written from one reading.
			weight: wght
				? `${wght.min} ${wght.max}`
				: os2 !== undefined
					? String(view.getUint16(os2 + 4))
					: "400",
			style: italic ? "italic" : "normal",
			...(wdth ? { stretch: `${wdth.min}% ${wdth.max}%` } : {}),
			...(axes && axes.length > 0 ? { axes } : {}),
		};
	} catch {
		return undefined;
	}
}

/** The `fvar` axis records, which is the only thing anything reads `fvar` for. */
function readAxes(view: DataView, at: number | undefined): FontAxis[] | undefined {
	if (at === undefined) return undefined;
	const array = at + view.getUint16(at + 4);
	const count = view.getUint16(at + 8);
	const size = view.getUint16(at + 10);
	const out: FontAxis[] = [];
	for (let i = 0; i < count; i++) {
		const record = array + i * size;
		out.push({
			tag: String.fromCharCode(
				view.getUint8(record),
				view.getUint8(record + 1),
				view.getUint8(record + 2),
				view.getUint8(record + 3),
			),
			min: fixed(view, record + 4),
			def: fixed(view, record + 8),
			max: fixed(view, record + 12),
		});
	}
	return out;
}

/**
 * The typographic family name, or the family name, or nothing.
 *
 * nameID 16 before nameID 1, which is the difference between "Inter" and "Inter
 * SemiBold" on a static face: the legacy family name is capped at four styles, so
 * a large family splits itself across several of them and only the typographic
 * name says what the typeface is. A label, and only a label — see the note at the
 * top of this file about the name being ours.
 */
function readName(
	view: DataView,
	table: { at: number; length: number } | undefined,
): string | undefined {
	if (!table) return undefined;
	const count = view.getUint16(table.at + 2);
	const strings = table.at + view.getUint16(table.at + 4);
	let fallback: string | undefined;
	for (let i = 0; i < count; i++) {
		const record = table.at + 6 + i * 12;
		const platform = view.getUint16(record);
		const nameId = view.getUint16(record + 6);
		if (nameId !== 16 && nameId !== 1) continue;
		const length = view.getUint16(record + 8);
		const offset = strings + view.getUint16(record + 10);
		if (offset + length > table.at + table.length) continue;
		// Platform 3 is Windows and its strings are UTF-16BE; platform 1 is
		// Macintosh and its are single-byte. Nothing else is decoded, because
		// nothing else is written by a font anybody uploads.
		let text = "";
		if (platform === 3) {
			for (let b = 0; b + 1 < length; b += 2) {
				text += String.fromCharCode(view.getUint16(offset + b));
			}
		} else if (platform === 1) {
			for (let b = 0; b < length; b++) text += String.fromCharCode(view.getUint8(offset + b));
		} else {
			continue;
		}
		text = text.trim();
		if (text === "") continue;
		if (nameId === 16) return text;
		fallback ??= text;
	}
	return fallback;
}
