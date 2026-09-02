/**
 * What an HTML export loses about *this* document.
 *
 * Computed rather than stated: unlike the sentences in the plugin's
 * `TargetSpec.loses`, every one of these is about something a particular
 * document turned out to hold — a viewport with no poster, an image whose bytes
 * never arrived, a link to a page that is not in the map. They were in the
 * shared file while there was only one shared file, and nothing outside the
 * HTML target ever read one.
 */
import type {
	ModelNode,
	ModelScene,
} from "@clingo-design/design-core";

import type {
	DocIndex,
} from "@clingo-design/export-core";
import {
	GRID_LOST,
} from "@clingo-design/export-core";
import { nodeLabel } from "./states.ts";

export function viewportLost(index: DocIndex, node: ModelNode, inside: number, poster: boolean): string {
	const objects =
		inside === 0
			? "nothing is inside it yet"
			: `the ${inside} object${inside === 1 ? "" : "s"} inside this view ${inside === 1 ? "is" : "are"} not in it`;
	return (
		`The ${nodeLabel(index, node.id)}. HTML and CSS can position and turn a flat box, and this file does — but they have no word for geometry, a camera, a light or a material, so ${objects}. ` +
		`What is here is the view's own box${poster ? ", with the frame the canvas last drew as its background" : ""}. ` +
		"Choose glTF in this panel to write the scene itself — the geometry, the camera, the lights and the materials, as a file another 3D tool can open."
	);
}

/**
 * Pictures the caller did not hand over, one sentence each.
 *
 * An image whose bytes were not supplied comes out as an empty box — the node
 * is still there, at its size, with its corners and its opacity — and that is
 * the right picture for a design whose file has not arrived. What it must not be
 * is silent: an export taken while a shared project was still syncing its assets
 * is a file with holes in it, and the difference between that and a design that
 * genuinely has an empty box is exactly this list.
 *
 * Named by the path rather than the node, because the path is the thing to go
 * and find.
 */
export function missingImages(
	index: DocIndex,
	model: ModelScene,
	images: Readonly<Record<string, Uint8Array>>,
): string[] {
	const out: string[] = [];
	for (const node of Object.values(model.byId)) {
		if (node.kind !== "image") continue;
		const path = node.asset;
		if (path !== undefined && images[path] !== undefined) continue;
		out.push(
			`The ${nodeLabel(index, node.id)} draws ${path === undefined ? "no file at all" : `“${path}”`}, and those bytes were not available when this file was written — so its box is here and its picture is not. A project still syncing its assets, or opened without them, exports this way.`,
		);
	}
	return out;
}

/**
 * The one thing a `transform` costs, said once for the whole document.
 *
 * Not a loss of information — the transform is exact, and this is the one place
 * in the 3D work where the flat target loses *nothing* — but a loss of
 * behaviour, and it is the browser's rather than this file's: a turned box is
 * painted through its transform and hit-tested through it too, but the *layout*
 * box it displaces is still the untransformed rectangle, so a click near the
 * corner of a card leaned 30° away lands where nothing is drawn.
 *
 * Said because it is true on the canvas as well, and a designer who meets it in
 * the exported page and not in the studio would reasonably think the export
 * broke it. It is one sentence for the document rather than one per node: the
 * fact is about what a transform *is*, and repeating it per card would be a list
 * nobody finishes.
 */
export const TURNED_LOST =
	"A turned box is drawn by the browser through its transform and laid out by its untransformed rectangle, here and on the canvas both — so a click near a corner of something leaned away may land on it where there is nothing drawn.";

/**
 * Where a document links out and the export is one file.
 *
 * Conditional, like {@link GRID_LOST} and for its reason: a document with no
 * link loses no page, and a list of losses that pads itself is one nobody
 * finishes reading.
 *
 * The second sentence is the way out, and it is a real one rather than a
 * consolation: `about-us.html` is *already* the right string for a folder of
 * pages, so exporting every page under its own name into one directory makes the
 * links work with nothing about this emitter changing. Multi-file export is a zip
 * or a directory picker and is a different artefact; until somebody writes that
 * loop, this sentence is how a person does it by hand.
 *
 * The third is the honest cost of the fonts step meeting this one, and it is not
 * fixable inside either: every face is inlined per file, once per family, so a
 * folder of five pages carrying one variable `.ttf` is five copies of it. No
 * browser can share them, because each `data:` URI is a separate document's
 * private bytes with no cache key.
 */
export const LINKED_LOST =
	"Other pages. A link leads to the file its page exports as — “about-us.html” beside this one — and this is one file. Export every page under its own name into one folder and the links work; until then they lead to a file that is not there. Each page carries its own copy of every font it uses, so a five-page prototype carrying one family is five copies of it: nothing is fetched and nothing is shared, so the files work offline and they are large.";

/** Where a link's page is gone, or was never handed over. */
export const DEAD_LINK_LOST = (n: number): string =>
	`${n} link${n === 1 ? "" : "s"} point at a page this project no longer has. They come out as ordinary boxes rather than as anchors to a file that is never going to exist.`;

