/**
 * What every export loses, whatever the target.
 *
 * The sentences here are the driver's, so they are the ones true of an export
 * as such: the space, the rules, solved geometry, token chains, instances. A
 * loss that belongs to one target's *format* is in that target's
 * `TargetSpec.loses`, and a loss that belongs to one target's reading of one
 * document is computed by that target's package.
 */
import type {
	ModelScene,
	Scene,
} from "@clingo-design/design-core";
import {
	flatten,
	guideLines,
	isGridded,
} from "@clingo-design/design-core";


/** What every export loses, whatever the target. */
export const ALWAYS_LOST = [
	"The space. An export is one point in it; the other universes are not in this file.",
	"The rules. Constraints, the generated program and your own ASP do not come along — nothing re-solves when you edit the output.",
	"Solved geometry becomes literal pixels. An automatic layout, a gap and a pin all arrive as the coordinates they worked out to.",
	"Token chains are flattened: a token that names another token exports as the value at the end of the chain, under the first name.",
	"Component instances are flattened into ordinary elements; the definition they came from is not in the output.",
];

/**
 * The one loss worth naming only for the documents that have it.
 *
 * Margins, a column grid and the lines a designer drew are **furniture**: they
 * are drawn on the design and never *by* it. Nothing here had to be taught to
 * skip them — a datum is not a `node/1`, so it never reaches a {@link ModelScene},
 * and `guides`/`lines` are fields of the document this file never opens — so
 * this is a claim about the output rather than a filter over it, and the tests
 * beside this file assert it in both targets.
 *
 * Which is exactly why it has to be said out loud. Every other entry in the list
 * is something the exporter *could not* carry; this one is something it
 * deliberately did not, and a designer who ruled a page into twelve columns and
 * finds no grid in the file is owed the difference. The second sentence is the
 * substance: a grid that decided a coordinate is *in* the file, as that
 * coordinate. What is gone is the ability to move the line and have the design
 * follow — the same loss the rules take one entry above.
 *
 * Conditional, unlike its neighbours, because a document with no grid loses no
 * grid, and a list of losses that pads itself is one nobody finishes reading.
 */
export const GRID_LOST =
	"The grid. Margins, columns and the guides you drew are drawing aids: they rule the design in the editor and are not in the file. What they decided is here, as the coordinates the nodes they held came out at.";

/**
 * True when the document holds a grid or a line that means anything.
 *
 * The same two questions `compile()` asks before it emits `ggrid/1` and
 * `gline/3`, so the note appears for exactly the documents whose program has
 * guides in it: {@link isGridded} for the grid, because one stored on a
 * rectangle is read rather than corrected and says nothing to anybody, and a
 * plain count for the lines, which are drawn on whatever they are drawn on.
 */
export function isRuled(scene: Scene): boolean {
	return flatten(scene.nodes).some(
		(node) => isGridded(node) || guideLines(node).length > 0,
	);
}

/**
 * What a page cannot say about a 3D view, per view, in {@link GRID_LOST}'s
 * manner.
 *
 * Conditional and per viewport rather than one sentence about the format,
 * unlike the SVG target's, and the asymmetry is the same one the machine losses
 * already draw: HTML *can* carry a rotated flat box — it does, exactly, in
 * {@link transformOf} — so what it cannot carry is this particular view, with
 * this many objects in it, and a reader is owed the number. A document with no
 * viewport says none of this and pays nothing.
 *
 * The second half is the important one and it is why the sentence names glTF.
 * Every other entry in the list is a loss with no way out: the space is gone,
 * the rules are gone, the layout is literal pixels. This one has an answer that
 * is not a consolation — a glTF *is* the scene, with the geometry, the camera,
 * the lights and the materials in it — so leaving it unnamed would be telling a
 * designer their 3D work does not export when what is true is that it does not
 * export *here*.
 *
 * **It names the panel and not the format, and the difference is the one thing
 * about this sentence worth checking before changing it.** `ExportTarget` is
 * `"html" | "svg"`, and it stays that way: a glTF writer needs three.js's
 * geometry constructors to tessellate a sphere, which is a dependency this
 * package does not take. The writer lives in `canvas-3d` and the *export panel*
 * offers it as a third format on any document with a view in it. So the way out
 * is real and reachable, and the sentence says where — which is what it must
 * do, because a loss list that points at a feature the tool has not got is the
 * one place in a whole export where the product lies to the person reading it.
 *
 * The brace is the poster clause. A poster is a photograph rather than a scene,
 * and the sentence says so in the same breath as saying it is there, because a
 * page that looks right and cannot be lit or turned is exactly the artefact a
 * person would otherwise mistake for a working one.
 */
