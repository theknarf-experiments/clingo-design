/**
 * What a caller hands an export, and what it gets back.
 *
 * Unchanged from when these lived beside the two emitters, with one field
 * gone: `ExportOptions.target` named the target that was about to be chosen by
 * a ternary. A plugin is passed now, so the options stopped carrying the thing
 * that selected the code path — the one change here that is a simplification
 * rather than a move.
 */
import type { Frame, ModelScene, Picks } from "@clingo-design/design-core";
import type { TargetId } from "./contract.ts";

export interface ExportResult {
	target: TargetId;
	filename: string;
	text: string;
	/** Everything this artefact does not carry, named. */
	lost: string[];
	/**
	 * How the space was handled: one universe, or one artefact standing for
	 * several — see {@link collapseSpace}.
	 */
	note: string;
}

export interface ExportOptions {
	/**
	 * The bytes behind every image the design draws, by the tree path `asset/2`
	 * names.
	 *
	 * Handed in for the same reason {@link ExportOptions.posters} is: the
	 * payloads live in the project's document store, reaching one is I/O, and
	 * this package does not do I/O — it turns an answer set into a file. The
	 * caller resolves what it needs and passes it.
	 *
	 * A path with no entry is a picture that does not come out, and it is named
	 * in `lost` rather than left as a silently empty box. That covers the real
	 * case as well as the careless one: a project opened without its assets, or
	 * shared before they finished syncing, is a design whose images are still
	 * arriving — and an export taken at that moment should say which ones were
	 * not in it.
	 */
	images?: Readonly<Record<string, Uint8Array>>;
	/**
	 * The bytes behind every font the design sets text in, by the tree path
	 * {@link FontFile.src} names.
	 *
	 * A second map beside {@link ExportOptions.images} rather than one merged
	 * one, for the reason `assetPaths(scene, kind)` takes a kind: the panel knows
	 * which target is selected and therefore which payloads that target can
	 * possibly use, and the SVG target wants the pictures and none of the faces.
	 * One map would make choosing the light target fetch a megabyte of type.
	 *
	 * A family whose bytes are absent is a design that comes out in its fallback
	 * stack, named in `lost` rather than left to be discovered by a reader whose
	 * headline does not fit.
	 */
	fonts?: Readonly<Record<string, Uint8Array>>;
	/**
	 * Emit `var(--accent)` where a value named a token, with the definitions at
	 * the top. Off inlines the literal everywhere, which is what a paste into
	 * something with its own variables wants.
	 * @default true
	 */
	tokens?: boolean;
	/** Names the document in the output. */
	title?: string;
	/**
	 * The last frame each viewport rendered, as a data URL, by viewport node id.
	 *
	 * HTML and CSS cannot draw a scene — see {@link VIEWPORT_LOST} — so the box a
	 * viewport exports as is a coloured rectangle unless somebody hands this file
	 * a picture of what was inside it. The canvas can, because it has a WebGL
	 * context and a `preserveDrawingBuffer`; design-core cannot, and it must not
	 * try: a renderer in here is the one dependency this package does not take.
	 *
	 * So it arrives as an option rather than being read off anything, and its
	 * absence is not a failure — a poster is a *photograph* of one moment of one
	 * camera, and a file with none of them is exactly as honest, just less
	 * pretty. The loss sentence says which of the two happened.
	 */
	posters?: Record<string, string>;
	/**
	 * The project's pages, as page id -> that page's **name**.
	 *
	 * A name and not a filename, so the two cannot disagree: the href is
	 * `${slug(name)}.html`, computed by the same `slug` that computes
	 * {@link ExportResult.filename}, so a page exported under its own name and a
	 * link to that page produce the same string by construction rather than by the
	 * caller remembering to match them.
	 *
	 * Handed in for {@link images}' reason exactly — the pages are documents in a
	 * tree and this package does not do I/O — and a second map beside it rather
	 * than one merged one, because the panel knows which target is selected and
	 * the SVG target wants the pictures and none of this.
	 *
	 * A link whose target is not in here — a page deleted out from under it, or a
	 * caller that passed no map at all — exports as an ordinary box rather than as
	 * an anchor to a file that is not going to exist, and says so in `lost`. An
	 * `<a href>` that 404s is worse than a box, because the box is honest about
	 * leading nowhere.
	 */
	pages?: Readonly<Record<string, string>>;
}

/* ------------------------------------------------------------------ */
/* One universe, as the exporter sees it                               */
/* ------------------------------------------------------------------ */

/**
 * The parts of a `Universe` an export reads.
 *
 * Structural rather than the interface itself, so design-core's exporter does
 * not depend on the exploration machinery and a test can hand it a model it
 * read out of atoms directly.
 */
export interface ExportUniverse {
	pick: Picks;
	model: ModelScene;
	/** Coordinates the solver owns; a dimension in here is not the token's. */
	solved?: Readonly<Record<string, Partial<Frame>>>;
}

