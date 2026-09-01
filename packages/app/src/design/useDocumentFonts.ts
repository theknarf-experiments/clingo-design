/**
 * Puts the document's declared faces into the browser, and says which ones
 * arrived.
 *
 * The uploader, in the tab they uploaded in, has no gap at all: the upload flow
 * validates, writes, registers and *then* declares, in that order, so the first
 * render in which any value can name the family is a render in which the face is
 * already in `document.fonts`. This hook is for everybody else — a collaborator
 * opening the synced project, the uploader after a reload, a template that ships
 * with a font — where the document already declares `Inter Var`, the bytes are in
 * the tree, and nothing is loaded.
 *
 * **What it returns is the loaded set, and that is the whole interface.** It is
 * handed to `measureScene`, which strips every declared family that is *not* in
 * it out of every font string before asking the engine anything — see
 * `paintedStack` and `docs/framer-fonts-spec.md` §5. So during the gap the
 * browser paints the fallback, the canvas measures the fallback, and the solver
 * places boxes fitted to the fallback: the picture, the measurement and the
 * answer set all agree. The design is *different* from the finished one, in
 * exactly the way it would be different if a designer had not chosen the font
 * yet, and when the face lands the set changes, the strings change, neither cache
 * can serve the old widths, and the exploration re-solves. That is a re-layout,
 * not a repair — which is why an unsat during the gap is a true statement about
 * the design as painted and nothing here suppresses one.
 */
import { useEffect, useState } from "react";
import {
	type FontFile,
	type Scene,
	abandonedFaces,
	namedFamilies,
} from "@clingo-design/design-core";

import { resolveAsset } from "../projects/store";

/**
 * A declaration, as much of one as a `FontFace` is built from.
 *
 * The descriptors and not just the family, which is the omission this file is
 * shaped to make impossible and is worth a type rather than a comment. `new
 * FontFace(family, bytes)` with no third argument does not mean "whatever the
 * file says": it means `weight: "normal"`, `style: "normal"`, `stretch:
 * "normal"`, because the descriptors are what the *document* claims about a face
 * and the constructor has no opinion of its own. So a variable file registered
 * that way is pinned to its default instance and every other weight the design
 * asks for is a synthesised faux bold — while the exported HTML, which writes
 * {@link FontFile.weight} into its `@font-face` verbatim, gets the real cut.
 * That is two different pictures from one document, and the one on screen is the
 * wrong one.
 */
export type FaceDeclaration = Pick<
	FontFile,
	"family" | "src" | "weight" | "style" | "stretch"
>;

/**
 * What this page has put in `document.fonts`, by family and path, and under
 * which descriptors.
 *
 * Module-level, because `document.fonts` is: a per-component map would re-add
 * every face on every remount, and a `FontFace` constructed twice over the same
 * bytes is two faces the browser has to choose between. Keyed by family and path
 * because either can change without the other — a designer renaming a family
 * needs the new name registered, and a file replaced at the same path needs the
 * new bytes — and *not* by the descriptors, which are a property of the entry
 * rather than part of its identity: correcting a weight has to replace the face
 * in the document, never add a second one beside it.
 */
const attempts = new Map<string, Registration>();

interface Registration {
	/** The descriptors this attempt was made with — see {@link sigOf}. */
	sig: string;
	/** Whether the browser can paint the family now. */
	done: Promise<boolean>;
}

/**
 * The face each slot actually has in `document.fonts` — the truth, as against
 * what the latest attempt was trying to achieve.
 *
 * A second map rather than a field on {@link Registration}, and the reason is a
 * failure this file had and a browser found. An attempt can fail *after* an
 * earlier one succeeded — a descriptor somebody is halfway through typing is the
 * everyday case, and Chrome rejects it in `load()` rather than in the
 * constructor, which is late. Reading "what should I replace" off the previous
 * attempt then reads it off the attempt that failed, which holds no face, so the
 * face before it is never removed and the next success adds a second one beside
 * it: two faces of one family at overlapping weights, which is a tie the browser
 * breaks and one of the two answers is nobody's. This map is written only where
 * `document.fonts.add` is called, so what it says is what the document holds.
 */
const live = new Map<string, FontFace>();

/**
 * The keys that came back false, so a later look at the tree can retry them.
 *
 * A face whose file was not there when the page opened is the *normal* state of
 * a project that is still syncing, and caching that "no" forever would mean a
 * font arriving over the wire never paints until somebody reloads. So a failure
 * is forgotten when the set of files in the project changes, and only then:
 * retrying on every render would hammer the store for a file that is not coming.
 */
const failures = new Set<string>();

// A separator no family name and no path can contain, written as the escape
// rather than as the byte — a raw NUL makes git and grep classify the whole file
// as binary, which `219bcd1` found twice. A space would not do: a family is
// called "Inter Var".
const keyOf = (family: string, src: string): string => `${family}\x00${src}`;

/**
 * The three descriptors, as one string, so "is this still the same declaration"
 * is a comparison rather than a walk.
 *
 * An absent `stretch` and an explicit `"normal"` sign the same, and that is
 * correct rather than sloppy: they are the same claim about the file, and a
 * signature that told them apart would tear down a loaded face to build an
 * identical one.
 */
const sigOf = (file: FaceDeclaration): string =>
	`${file.weight}\x00${file.style}\x00${file.stretch ?? "normal"}`;

/**
 * A declaration as one line, and back again — the encoding the hook's effect
 * key is written in.
 *
 * A pair rather than a single key plus a lookup, because the alternative is
 * holding the roster array itself across the effect boundary and reaching into
 * it by index, which is the same bug as an index into a list that resorted. The
 * line *is* the declaration, so nothing the effect reads can disagree with what
 * the key was computed from.
 */
const rowOf = (file: FaceDeclaration): string =>
	`${keyOf(file.family, file.src)}\x00${sigOf(file)}`;

function declarationOf(row: string): FaceDeclaration {
	const [family, src, weight, style, stretch] = row.split("\x00");
	return {
		family,
		src,
		weight,
		style,
		// `"normal"` is what {@link sigOf} writes for a file with no width axis, so
		// it comes back out as the absence it went in as.
		...(stretch === "normal" ? {} : { stretch }),
	};
}

/**
 * Load one face and add it, answering whether the browser can now paint with it.
 *
 * Exported so the Fonts panel can do step 3 of the upload flow through *this*
 * map rather than beside it. The order the panel keeps is validate, write,
 * register, declare — and if it called `document.fonts.add` itself, the hook
 * below would come along a render later, find no attempt recorded, and construct
 * a second `FontFace` over the same bytes. Two faces of one family is a tie the
 * browser has to break, and one of the two answers is the one nobody meant. One
 * map, one registration, one place that knows a face is in the document.
 *
 * `document.fonts.add` happens **after `load()` resolves and never before**,
 * which is the single most important line in this file. A `FontFace` added while
 * still loading is in the set and not yet usable for rendering, so a measurement
 * taken in that window would ask for the real family and get the fallback's
 * widths — under the real family's cache key, where they would stay for the life
 * of the page. Adding only loaded faces removes the window entirely: a family in
 * `document.fonts` is a family that measures as itself.
 *
 * **The whole declaration is registered, not just the family**, and the reason is
 * on {@link FaceDeclaration}: the descriptors a `FontFace` is built without are
 * `normal`, not "whatever the file says", so a studio that passed only the family
 * would paint and measure a design its own export does not write. A descriptor
 * somebody corrects afterwards therefore has to reach the browser too, which is
 * why an entry whose signature no longer matches is registered again rather than
 * reused: {@link live} first, `delete` second, `add` third, so a family never
 * holds two faces at overlapping weights for the browser to break the tie
 * between.
 *
 * **A failed attempt leaves the face that works where it is**, and answers what
 * is true of the document rather than what it managed itself. The panel writes a
 * descriptor on every keystroke, so the way from `400` to `100 900` runs through
 * strings that are not weights; those reject, and reporting the family as
 * unloaded would strip it from every font string and re-measure and re-solve the
 * whole document in the fallback for the frame between two keystrokes. The
 * picture and the measurement have to agree, and what the picture shows is the
 * face still in {@link live}.
 *
 * **What a re-registration does not do is re-measure**, and it is the one gap
 * left here on purpose. `prepareCached` and pretext's own `segmentMetricCaches`
 * both key on the font shorthand, and correcting a descriptor changes which face
 * answers that shorthand without changing the shorthand — so a document that was
 * measured while a variable file was declared static keeps those widths until the
 * page is reloaded. Fixing our half alone was considered and refused for
 * `paintedStack`'s own reason: pretext's cache is not on its export surface, so
 * an eviction here would re-prepare, get the same stale segment metrics back, and
 * look repaired. A descriptor corrected after the fact is rare; a fix that only
 * appears to work is not rare enough.
 *
 * Nothing is ever taken *out* of `document.fonts`, and that is the same gap wearing
 * different clothes rather than an oversight. A face this page has loaded stays
 * loaded for the life of the tab, so removing a font in the panel leaves the
 * design painting and measuring in it until a reload — where the family is no
 * longer declared, no longer loaded, and the boxes hug the fallback instead.
 * Sweeping the face on removal was written and then taken back out: it makes the
 * picture change and leaves the *box* at the width the face was measured at,
 * because the font shorthand did not move and neither cache can be told. One tab
 * that is internally consistent and stale beats one that paints a fallback into a
 * box fitted to a face, which is precisely the artefact `font-display: block` and
 * `paintedStack` exist to prevent everywhere else.
 */
export function register(file: FaceDeclaration): Promise<boolean> {
	const key = keyOf(file.family, file.src);
	const sig = sigOf(file);
	const before = attempts.get(key);
	if (before && before.sig === sig) return before.done;
	const entry: Registration = { sig, done: Promise.resolve(false) };
	entry.done = (async () => {
		try {
			const bytes = await resolveAsset(file.src);
			if (!bytes || bytes.length === 0) {
				failures.add(key);
				return live.has(key);
			}
			// A copy, because the bytes come out of the project's own storage and a
			// `FontFace` holds the buffer it was handed.
			const face = new FontFace(file.family, bytes.slice().buffer as ArrayBuffer, {
				weight: file.weight,
				style: file.style,
				// Omitted rather than sent as `"normal"` where the file has no width
				// axis, so that "this file has no width axis" has the one spelling it
				// has everywhere else — see {@link FontFile.stretch}.
				...(file.stretch === undefined ? {} : { stretch: file.stretch }),
			});
			await face.load();
			// A later declaration overtook this one while the bytes were parsing, so
			// this face is not the one the document should hold. Dropped rather than
			// added-then-deleted: the window in which both are in the set is exactly
			// the tie this whole arrangement exists to avoid.
			if (attempts.get(key) !== entry) return live.has(key);
			const previous = live.get(key);
			if (previous) document.fonts.delete(previous);
			document.fonts.add(face);
			live.set(key, face);
			return true;
		} catch {
			// A file that is not a font, or one the browser refuses — including a
			// descriptor string that is not a descriptor, which is a thing the panel
			// lets somebody type on the way to one that is. Chrome rejects that in
			// `load()` rather than in the constructor, so this arrives *after* a
			// working face may already be in the document: what is reported is
			// whether the family is paintable, which is {@link live}, and not whether
			// this attempt achieved anything. A family with no face at all is
			// stripped from every measurement and the design is set in the fallback —
			// correct, and reported by `fontNotes` where the file is simply absent.
			failures.add(key);
			return live.has(key);
		}
	})();
	attempts.set(key, entry);
	return entry.done;
}

/**
 * Take back out the faces this page loaded under a family that has moved on.
 *
 * **The rename leak, found by typing in the panel rather than by reading it.**
 * The family field writes through on every keystroke and a family is half of a
 * {@link keyOf} — deliberately, because renaming has to get the new name into the
 * browser. What nothing did was take the *old* one out, so retyping a twelve
 * character family name over a 250 kB face left twelve faces in `document.fonts`,
 * twelve copies of the bytes alive for the life of the tab, and twelve full font
 * parses on the way.
 *
 * Which of them are garbage is `abandonedFaces`' question and is answered in
 * design-core, where it is a pure reading of a roster and can be tested against a
 * real document; both of its clauses are argued there, and the second of them is
 * what keeps this from undoing the decision two paragraphs of {@link register}
 * defend. What is left here is the half only a browser has, which is the deleting.
 *
 * {@link attempts} and {@link failures} go with it, because they are this file's
 * record of what the document holds: a resolved `true` left behind for a face
 * that is no longer in the set is how the hook would go on reporting a family as
 * loaded, `paintedStack` would go on not stripping it, and a box would end up
 * measured in a face the browser cannot paint — the exact failure the whole
 * arrangement exists to make unreachable.
 */
function sweep(scene: Scene, named: ReadonlySet<string>): void {
	const loaded = [...live].map(([key, face]) => {
		const at = key.indexOf("\x00");
		return { key, face, family: key.slice(0, at), src: key.slice(at + 1) };
	});
	for (const gone of abandonedFaces(loaded, scene, named)) {
		document.fonts.delete(gone.face);
		live.delete(gone.key);
		attempts.delete(gone.key);
		failures.delete(gone.key);
	}
}

/** Two sets with the same members, so a render is not forced for nothing. */
const same = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
	a.size === b.size && [...a].every((x) => b.has(x));

/**
 * The families of `scene.fonts` the browser has loaded, in this document, now.
 *
 * `held` is the project's own file list, and it is a dependency rather than a
 * convenience: it is what tells this hook that a file which was not there a
 * moment ago has arrived, which is the one event that makes a failed load worth
 * trying again.
 */
export function useDocumentFonts(
	scene: Scene,
	held?: readonly string[],
): ReadonlySet<string> {
	const [ready, setReady] = useState<ReadonlySet<string>>(() => new Set());
	// Keyed on the roster's own content rather than on the array, because the
	// scene object is new on every keystroke and the fonts in it almost never are.
	//
	// The whole declaration goes into the key and not only its identity, so that
	// correcting a weight in the panel re-registers the face rather than leaving
	// the browser holding the descriptors the file was guessed to have. Written as
	// a joined string and split back apart below because an effect's dependencies
	// have to be values a render can compare, and a roster is an array of records.
	const roster = (scene.fonts ?? []).map(rowOf).sort().join("\n");
	const heldKey = (held ?? []).join("\n");

	useEffect(() => {
		const wanted = roster === "" ? [] : roster.split("\n");
		if (wanted.length === 0) {
			setReady((prev) => (prev.size === 0 ? prev : new Set()));
			return;
		}
		const declarations = wanted.map(declarationOf);
		// Before registering, not after: the whole point is that a slot never holds
		// two faces at once, and sweeping afterwards would leave the window this
		// exists to close. `scene` is read here and is not in the dependency list,
		// which is honest rather than an oversight — this is a collection and not a
		// gate. It can only ever find something when a slot's family has just
		// moved, and a slot's family moving *is* a change to `roster`.
		sweep(scene, namedFamilies(scene));
		// The tree changed under us, so anything that failed for want of a file is
		// worth one more try. See {@link failures}.
		for (const file of declarations) {
			const key = keyOf(file.family, file.src);
			if (failures.has(key)) {
				failures.delete(key);
				attempts.delete(key);
			}
		}
		let alive = true;
		void Promise.all(
			declarations.map(async (file) =>
				(await register(file)) ? file.family : undefined,
			),
		).then((names) => {
			if (!alive) return;
			const next = new Set(names.filter((n): n is string => n !== undefined));
			setReady((prev) => (same(prev, next) ? prev : next));
		});
		return () => {
			alive = false;
		};
	}, [roster, heldKey]);

	return ready;
}
