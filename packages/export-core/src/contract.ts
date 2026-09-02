/**
 * What a target is, as something a package can be.
 *
 * ## Why this stopped being a union
 *
 * `ExportTarget` was `"html" | "svg"`, `EXPORT_TARGETS` was a record keyed by
 * it, and `emit` chose an emitter with a ternary. That was honest while there
 * were two targets and it had already stopped being true: there were **three**.
 * The glTF writer needs three.js's geometry constructors to tessellate a
 * sphere, so it could not live in a package whose whole discipline is that it
 * has no rendering dependency — and it ended up in the studio's export panel as
 * `type PanelTarget = ExportTarget | "gltf"`, a dynamic import, a branch that
 * built a different result shape, a rule of its own about which universe it may
 * have, and a label lookup with a fallback. Five special cases, all of them
 * saying "this is a target too", none of them able to say it in the type.
 *
 * So a target is a **plugin**: a spec anybody can read cheaply, and an emitter
 * behind a `load()`. The three that ship are three packages — `export-html`,
 * `export-svg`, `export-gltf` — and the studio composes them into a list. The
 * word for what that bought is *deletion*: the panel's five special cases are
 * gone, and `exportSpace` no longer names a target to decide whether the space
 * may collapse.
 *
 * ## Why `load()` is a promise, when two of the three need nothing
 *
 * HTML and SVG are pure text and could be plain functions. glTF is not: reaching
 * `@clingo-design/canvas-3d` pulls three.js, and the studio's promise is that a
 * document with no 3D in it pays for none of it. A contract where the cheap
 * targets are synchronous and the expensive one is not is a contract with the
 * special case moved rather than removed — the caller would still have to know
 * which kind it was holding.
 *
 * So every emitter arrives through a promise, and the cost of that is one
 * `await` in the one place that emits. What it buys is that the *next* heavy
 * target — a PDF writer, a zip of a folder of pages, a rasteriser — is a package
 * and a line in a list, with no change here and none in the panel.
 *
 * ## What a plugin may not do
 *
 * A plugin returns text. That is a real limit rather than an oversight, and it
 * is worth pricing where somebody will look for it: a binary target — a PNG, a
 * `.riv`, a zip of a multi-page export — needs {@link Emitted} to carry bytes,
 * {@link ExportResult} to carry them too, and the panel's download and clipboard
 * paths to branch on which it got. Three places, none of them deep. It is not
 * built because nothing needs it yet, and a `bytes?: Uint8Array` that every
 * shipped plugin leaves undefined is dead weight in the one part of a system
 * where dead weight is invisible.
 */
import type { PropName } from "@clingo-design/design-core";

import type { DocIndex, Layer } from "./document.ts";
import type { ExportOptions } from "./options.ts";

/**
 * A target's name, and the string a {@link ExportResult} reports.
 *
 * A plain string rather than a union, which is the point of the refactor: the
 * set of targets is decided by what the caller composes, not by a type in this
 * package that every new target would have to be added to. The ids that ship
 * are `html`, `svg` and `gltf`.
 */
export type TargetId = string;

export interface TargetSpec {
	label: string;
	extension: string;
	mime: string;
	/**
	 * Syntax name, for the panel's highlighting.
	 *
	 * Widened from `"html" | "svg"` when glTF became an ordinary target: a glTF
	 * is JSON, and it used to reach the panel through a branch that never asked
	 * this question.
	 */
	language: "html" | "svg" | "json" | "text";
	/** What this target cannot carry, over and above what every export loses. */
	loses: string[];
}

/**
 * A style the output shared between its wearers, as a class.
 *
 * Here rather than beside the emitter that builds one, because {@link Emitted}
 * carries them and {@link emit} reads them: a class is the one thing an export
 * does *not* flatten, so the driver has a sentence to write about what a class
 * loses, and that sentence is the same whichever target made it.
 */
export interface StyleClass {
	/** The class name — `prose`, from the style's own name. */
	name: string;
	/** The properties the class carries, in table order. */
	props: PropName[];
	/**
	 * Wearers drawn in this universe, by node id: the document's first, in
	 * document order, then the ones only the answer set names.
	 *
	 * The order is load-bearing, not tidiness — the rule builder reads the
	 * class's value off the first wearer that takes each property, and only a
	 * wearer the document holds can say which token it named.
	 */
	wearers: string[];
	/** Per wearer, the properties it takes from the style rather than states. */
	worn: Map<string, Set<PropName>>;
	/** Which of them the document has no account of — see `ModelScene.wears`. */
	derived: string[];
}

/** What an emitter produces, before the driver adds what every export loses. */
export interface Emitted {
	text: string;
	/** The styles that came out as classes. */
	classes: StyleClass[];
	/** What this target could not carry about *this* document, if anything. */
	lost: string[];
}

/**
 * The whole of what a target has to be able to do.
 *
 * One function, and the shape it already had: the two shipped emitters were
 * `(index, layers, options) => Emitted` before any of this, which is what made
 * the seam a refactor rather than a redesign. `layers` is one entry for one
 * universe and several for a collapsed space; a target that cannot collapse
 * never sees more than one, because {@link ExportPlugin.collapses} said so.
 */
export type Emitter = (
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
) => Emitted;

export interface ExportPlugin {
	/** Unique among the targets a caller composes. */
	id: TargetId;
	spec: TargetSpec;
	/**
	 * Whether several designs may be written into this target as one artefact.
	 *
	 * This used to be `options.target !== "html"` inside `exportSpace`, which is
	 * the shape of thing this refactor exists to delete: a fact about a target,
	 * asserted in the driver, by naming the target. HTML collapses because it has
	 * media queries and custom properties; SVG has neither a media query a
	 * designer would trust nor a theming convention; a glTF holds one arrangement
	 * of one set of objects and has no equivalent of either.
	 */
	collapses: boolean;
	/**
	 * Why this target writes one design where the caller asked for the space.
	 *
	 * Required when {@link collapses} is false, because the panel shows it: a
	 * person who asked for the whole space and got one design is owed the reason,
	 * and the reason is the target's to give.
	 */
	single?: string;
	/**
	 * Which payloads this target can actually write, by the kind `assetPaths`
	 * takes.
	 *
	 * The caller resolves bytes out of the project's document store, and reading
	 * them is I/O: a chair is megabytes, an HTML export has no use for one, and a
	 * face is a megabyte an SVG will never carry. So a panel asks the target what
	 * it needs and fetches only that — which used to be three string comparisons
	 * against target names in the studio, in the file furthest from the code that
	 * knew the answer.
	 */
	needs: readonly ("image" | "mesh" | "font")[];
	/**
	 * Whether `ExportOptions.tokens` means anything here.
	 *
	 * A token name is a CSS idea. A glTF has no custom properties and no cascade,
	 * so a "keep token names" switch on it is a control that does nothing, and the
	 * panel hides it rather than showing one.
	 */
	usesTokens: boolean;
	/**
	 * What to call the file, where the page's own name is not enough.
	 *
	 * The driver names a file after the page — `about-us.html` — because that is
	 * what every target wants and what a link between two pages depends on. glTF
	 * is the exception: a glTF is *a scene*, so a document with two viewports has
	 * two files to write, and naming both after the page would put the same name
	 * on two different artefacts.
	 *
	 * Optional, and one plugin sets it. `base` is the slug of the title, without
	 * the extension.
	 */
	filename?: (base: string) => string;
	/**
	 * The emitter, loaded when somebody actually asks for this target.
	 *
	 * See the essay above for why every target pays this and not only the heavy
	 * one.
	 */
	load: () => Promise<Emitter>;
}

/** The plugin with this id, out of the ones a caller composed. */
export function targetFor(
	plugins: readonly ExportPlugin[],
	id: TargetId,
): ExportPlugin | undefined {
	return plugins.find((p) => p.id === id);
}
