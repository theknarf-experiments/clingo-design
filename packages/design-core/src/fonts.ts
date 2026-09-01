/**
 * What a document says about the typefaces it sets text in.
 *
 * The twin of `assets.ts`, and it takes that file's opening claim verbatim:
 * **nothing here does any I/O.** Every function is a pure reading of a `Scene`,
 * which is what keeps this file in a package whose tsconfig `lib` has no "dom" —
 * and what makes the one genuinely interesting question, "which of these
 * families can the host actually paint", testable headlessly, because the answer
 * is a string transform and not a database.
 *
 * ## Three things that reference each other, and only one of them is a path
 *
 * A `fontFamily` value is a CSS stack and stays one: `'"Inter Var", system-ui,
 * sans-serif'`. It names a **family**. {@link FontFile.family} is the same name,
 * and {@link FontFile.src} is the **path** to the bytes. So the reference from
 * the design to the face is by name and the reference from the name to the bytes
 * is by path, and there is exactly one kind of address for bytes in this project
 * — the same one `ImageRef.src`, `MeshRef.src` and `instanceOf` use — appearing
 * exactly once, in the declaration.
 *
 * *Rejected: putting the path in the value*, which is literally what `instanceOf`
 * does and is wrong here three times over. A `fontFamily` value is CSS that four
 * things write straight through — `PAINT.fontFamily` is `(value) => ({ fontFamily:
 * value })`, called by the canvas, by both exporters and by `fontString` — and
 * `paint.ts` has no scene in scope and must not gain one. It would break the
 * property `ValueTypeSpec.options` is documented for, that "a value typed before
 * the list existed still paints": a document opened without its `fonts` would
 * paint nothing at all where today it paints the stack it holds. And a path names
 * a *file* while a family is a *set* of them — Regular and Bold are two files and
 * one thing a designer chose, which is what `weight` moves between.
 *
 * ## The measurement problem, in one function
 *
 * {@link paintedStack} is the whole of `docs/framer-fonts-spec.md` §5 and the
 * reason this module exists at all rather than being four lines in the panel. A
 * box measured in a face the host has not loaded is wrong *geometry* — it reaches
 * `lask/3` and the layout equations and can go unsat — and it is sticky, because
 * both the app's `prepareCached` and pretext's own `segmentMetricCaches` key on
 * the font string, and the second of those is not on that package's export
 * surface and cannot be cleared. So the fix is not a cache flush; it is making
 * the key a function of the font set, which it always should have been.
 */
import type { FontFile, Scene } from "./scene.ts";
import type { ModelScene } from "./model.ts";

/**
 * Every family this page declares, by name, with the files that make it.
 *
 * A `Map` keyed by family rather than a `Record`, because a family name is
 * whatever a designer typed and a `Record` would put `"constructor"` on
 * `Object.prototype`'s shoulders. In document order within a family, which is
 * the order the `@font-face` rules come out in and therefore the order a browser
 * resolves a tie in.
 */
export function fontFamilies(scene: Scene): Map<string, FontFile[]> {
	const out = new Map<string, FontFile[]>();
	for (const file of scene.fonts ?? []) {
		const at = out.get(file.family);
		if (at) at.push(file);
		else out.set(file.family, [file]);
	}
	return out;
}

/**
 * Every family a CSS font stack names, in order, unquoted.
 *
 * A parse rather than a split on commas, because a family name may contain one
 * inside quotes — `'"Goudy, Old Style", serif'` is two families and a naive
 * split says three. This is the *whole* of the CSS this file parses, and that is
 * deliberate: a `fontFamily` value is a declaration the renderers write through,
 * and anything here that understood more of it would be a second CSS engine to
 * keep in step with the browser's.
 *
 * Whitespace is trimmed and empty entries are dropped, so a trailing comma or a
 * double one is a stack with one fewer family rather than a family called "".
 */
export function familiesOf(stack: string): string[] {
	const out: string[] = [];
	let current = "";
	let quote: string | undefined;
	for (const char of stack) {
		if (quote !== undefined) {
			if (char === quote) quote = undefined;
			else current += char;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === ",") {
			const name = current.trim();
			if (name !== "") out.push(name);
			current = "";
			continue;
		}
		current += char;
	}
	const last = current.trim();
	if (last !== "") out.push(last);
	return out;
}

/**
 * The first family a CSS font stack names, unquoted — `'"Inter Var", serif'` is
 * `Inter Var`.
 *
 * Nothing for a stack that is empty or unreadable, so a caller falls back rather
 * than treating `""` as a family.
 */
export const familyOf = (stack: string): string | undefined => familiesOf(stack)[0];

/** What a menu calls a stack that is on no list: its first family, or itself. */
export const familyLabel = (stack: string): string => familyOf(stack) ?? stack;

/**
 * A family name as CSS wants it written: quoted unless it is a single
 * identifier.
 *
 * Exported, which the design for this module did not intend and the emitter
 * settled: the `@font-face` writer lives in `export.ts` and has to spell the
 * same name the same way {@link fontStack} does, and two functions that quote a
 * family are two chances for a rule to declare `"Inter Var"` and a stack to ask
 * for `Inter Var` — one of which the browser matches and one of which it does
 * not, depending on which end got it wrong.
 *
 * Quoted whenever the name has anything in it but letters, digits and hyphens,
 * or begins with a digit or a hyphen. That is stricter than CSS — an escaped
 * identifier is legal and unquoted — and stricter is the right direction here: a
 * quoted family name is always valid, so the failure mode of over-quoting is
 * nothing at all, and the failure mode of under-quoting is a declaration the
 * browser drops on the floor without a word.
 */
export const quoteFamily = (family: string): string =>
	/^[A-Za-z_][A-Za-z0-9_-]*$/.test(family)
		? family
		: `"${family.replace(/["\\]/g, "\\$&")}"`;

/**
 * The stack a designer's chosen family becomes when it is put in a value.
 *
 * The tail is a real CSS fallback and is chosen in the panel from the four
 * system stacks, because it is what gets painted while the face loads, what gets
 * painted if the file never arrives, and what an SVG export paints always. A
 * stack with nothing behind the uploaded name would make all three of those the
 * browser's default serif — which is a decision nobody made, taken on behalf of
 * every document that ever imports a font.
 */
export const fontStack = (family: string, fallback: string): string =>
	`${quoteFamily(family)}, ${fallback}`;

/**
 * The same stack with every family this document declares and the host has not
 * loaded taken out of it.
 *
 * **This is the measurement fix, and it is a string transform rather than a flag
 * for a reason that is worth the paragraph.** The browser already skips a family
 * that is not in `document.fonts`, so this changes no pixel the canvas draws and
 * no width the engine reports. What it changes is the *key* those widths are
 * cached under — ours in `prepareCached` and pretext's in `segmentMetricCaches`,
 * which we cannot clear — so a width measured before a face landed can never be
 * served after it lands. Re-measuring in the real family and hoping is the naive
 * implementation and it is the poisoning case: the second pass has the same key,
 * gets the same cached wrong widths, and looks correct.
 *
 * Only families the *document declares* are eligible to be dropped, which is
 * what `unloaded` is expected to hold. `Georgia` stays whether or not it is
 * installed, because whether it is installed is not knowable and never was —
 * that is the pre-existing situation and this does not pretend to improve it.
 *
 * Every occurrence, not just a leading one: `'"Inter", Georgia, "Fraunces",
 * serif'` with Fraunces unloaded has to key differently from the same stack with
 * Fraunces loaded, or the middle of a stack is a hole in the invariant.
 *
 * **A stack the strip empties comes back as `serif`**, and that is the one guess
 * in this file. The alternative is `""`, which makes the whole `font` shorthand
 * unparseable — and a canvas handed an unparseable shorthand keeps whatever font
 * it had, which for a fresh context is `10px sans-serif`. That is a box wrong by
 * a factor rather than by a face, and it would be wrong *silently*, which is the
 * exact failure this function exists to remove. `serif` is also the honest
 * answer: a browser asked to paint a family it does not have falls back to its
 * standard font, and every engine's standard font is a serif.
 */
export function paintedStack(stack: string, unloaded: ReadonlySet<string>): string {
	if (unloaded.size === 0) return stack;
	const kept = familiesOf(stack).filter((family) => !unloaded.has(family));
	if (kept.length === 0) return "serif";
	return kept.map(quoteFamily).join(", ");
}

/**
 * Families this page declares whose file `held` does not have — the relink list,
 * and {@link missingAssets}'s twin down to the sorted return.
 *
 * `held` is whatever the caller can answer for: the paths in the project's tree,
 * or one subset of them. Sorted by path, so a panel listing them twice lists them
 * in the same order twice, and a test can assert the list rather than the set.
 */
export function missingFonts(scene: Scene, held: Iterable<string>): FontFile[] {
	const have = held instanceof Set ? held : new Set(held);
	return (scene.fonts ?? [])
		.filter((file) => !have.has(file.src))
		.sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : 0));
}

/**
 * Where the declared faces live, deduplicated and sorted — what an export panel
 * has to fetch before it can inline anything.
 *
 * Sorted for {@link missingFonts}'s reason and for one more: the app keys an
 * effect on the joined list, and an order that followed the document would
 * re-fetch every face whenever somebody reordered the roster.
 */
export const fontPaths = (scene: Scene): string[] =>
	[...new Set((scene.fonts ?? []).map((file) => file.src))].sort();

/**
 * What this page's declared fonts weigh, without loading a byte.
 *
 * Per distinct **file**, not per declaration: two pages declaring one file is
 * one download, and — since this is asked about one scene — a roster that
 * somehow held the same `src` twice would still be one payload.
 */
export function fontTotalBytes(scene: Scene): number {
	const seen = new Set<string>();
	let total = 0;
	for (const file of scene.fonts ?? []) {
		if (seen.has(file.src)) continue;
		seen.add(file.src);
		total += file.bytes;
	}
	return total;
}

/**
 * Of the faces a host has loaded, the ones nothing can reach any more.
 *
 * A host that loads a face has to decide, at some point, when to take it back
 * out, and that decision is the reason this function is here rather than in the
 * one file that owns a `document.fonts`: it is a pure question about a roster
 * and a set of names, it is the exact inverse of {@link paintedStack}'s, and it
 * got the app wrong in a way only a browser showed. Renaming a family writes on
 * every keystroke, so retyping a twelve-character name over a 250 kB face left
 * twelve faces loaded, twelve copies of the bytes and twelve font parses —
 * `Wide`, `Wid`, `Wi`, `W`, names that lived for sixty milliseconds each.
 *
 * A face is abandoned when **its file is still declared, under some other
 * family, and no value in the document names the family it was loaded as**. Both
 * clauses are load-bearing and each one is holding a different decision up:
 *
 *   - *The file has to still be declared.* A file that has left the roster is a
 *     font somebody **removed**, and its face stays: unloading a face the design
 *     still names swaps a stale box for a mismatched one — the picture falls back
 *     while the box keeps the width the face was measured at, which is precisely
 *     the artefact `paintedStack` and `font-display: block` exist to prevent. It
 *     is also what keeps a multi-page project honest, since {@link Scene.fonts}
 *     is per page: a font declared on `main` is simply absent from `about`'s
 *     roster, and opening `about` must not unload it.
 *   - *No value may name the family.* Same decision, for the rename that
 *     abandons a name the design is still wearing. What is left over is exactly
 *     the garbage — a name typed through on the way to another one, which nothing
 *     in the document mentions and nothing ever will.
 *
 * `named` is a parameter rather than a walk done here because the walk lives in
 * `measure.ts` beside `fontNotes`, which asks the same question of the same
 * document and must get the same answer — see `namedFamilies`. Two spellings of
 * "nothing names this" would be a sentence and a sweep disagreeing about one
 * document.
 */
export function abandonedFaces<T extends { family: string; src: string }>(
	loaded: Iterable<T>,
	scene: Scene,
	named: ReadonlySet<string>,
): T[] {
	const declaredBy = new Map((scene.fonts ?? []).map((file) => [file.src, file.family]));
	const out: T[] = [];
	for (const face of loaded) {
		const now = declaredBy.get(face.src);
		if (now === undefined || now === face.family) continue;
		if (named.has(face.family)) continue;
		out.push(face);
	}
	return out;
}

/**
 * The families a *rendered* scene actually sets text in.
 *
 * Off `ModelNode.rendered.fontFamily` and therefore off the answer set, which is
 * the rule this repo keeps for everything drawn: a rule that mints a text node
 * and gives it a family is a design that uses that family, and a walk of the
 * document would miss it. The state copies and the keyframe copies are read too,
 * because a hover that changes the typeface is a face the exported file needs and
 * the picture on screen does not show.
 *
 * **Every family in each stack, not just the first**, and the join at the call
 * site is what makes that safe: the exporter intersects this with what the
 * document declares, so a system tail contributes nothing, and a design whose
 * uploaded family sits *behind* another one — which is what a designer writes
 * when they want a fallback of their own — still carries the face it would fall
 * back to. Returning only the leading family would make that document export a
 * file whose second choice is missing, which is precisely the case where nobody
 * looks.
 */
export function usedFamilies(model: ModelScene): Set<string> {
	const out = new Set<string>();
	const read = (stack: string | undefined): void => {
		if (stack === undefined) return;
		for (const family of familiesOf(stack)) out.add(family);
	};
	for (const node of Object.values(model.byId)) read(node.rendered.fontFamily);
	for (const state of Object.values(model.states)) read(state.rendered.fontFamily);
	for (const key of Object.values(model.keyframes)) read(key.rendered.fontFamily);
	return out;
}
