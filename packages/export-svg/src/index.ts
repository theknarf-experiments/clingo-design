/**
 * The SVG target.
 *
 * A picture to paste into a deck, a README or an issue — which is the whole of
 * what the loss list below is arguing about. It carries the geometry and the
 * paint and none of the behaviour, and it says so once about the format rather
 * than once per machine in the document.
 *
 * The list moved here from `EXPORT_TARGETS.svg` in `design-core`, unchanged. It
 * belongs beside the emitter it describes: every sentence in it is a claim about
 * what *this* package does, and it used to sit in a record two packages away
 * from the code that made it true.
 */
import type { ExportPlugin } from "@clingo-design/export-core";

/** What an SVG cannot carry, over and above what every export loses. */
const LOSES = [
		"A style is not a class here. An SVG is read by things that apply the presentation attributes and skip the stylesheet, so every wearer carries the treatment inlined: the correlation is in the picture, but it is not in the file.",
		"Shadows are dropped — SVG needs a filter per elevation, and a filter is not the declaration a designer wrote.",
		// Two sentences and no third: a mix mode is *carried* here, because CSS
		// Compositing applies to SVG, and saying it was lost would be the same
		// lie as dropping it.
		"Gradients are flattened to the colour they start from. An SVG shape has no background, and carrying the gradient would mean a gradient definition per node, built by reading the recipe back into an angle and two stops — a second description of the same picture.",
		"Blur is dropped. A blur here is a CSS `filter`, and the CSS filter functions are not SVG filters: a browser opening this file would blur, and a rasteriser reading the same attribute would not, which makes the file two pictures depending on who opened it. A backdrop blur has no SVG reading at all — an element here has no backdrop to reach behind.",
		// Unconditional, like its neighbours, and the trade is stated rather than
		// made silently: a third of a megabyte of base64 per family, in a format
		// whose selling point is that it is small and text, is not what this
		// target is for — it exists to be pasted into a deck, a README or an
		// issue. And it would only sometimes work: an SVG loaded as a document or
		// inlined into HTML honours `@font-face`, while one used as `<img src>`
		// is in a resource-restricted mode whose treatment of `data:` font
		// sources differs between engines. A feature that works in the paste and
		// not in the `<img>` is worse than one that is absent and documented.
		"A font you imported is not in this file. An SVG names the family and leaves the face to whatever opens it, so text set in a font of yours is drawn in the rest of its stack — and because the geometry here was measured in the real face, the words will not fill the box they were fitted to. Export HTML if the typography is the point, or outline the text in a vector editor.",
		"Text does not wrap. Each line of the document's own text becomes a tspan; a line the canvas broke because the box was narrow comes out unbroken.",
		"A text baseline is computed from the font size rather than measured, so a face with unusual metrics sits a pixel or two off.",
		// Unconditional, unlike the machine losses the HTML target adds, and the
		// asymmetry is the point: HTML *can* carry a state and names the ones it
		// could not, while SVG carries none of them and would say the same
		// sentence about every machine in the document. One sentence about the
		// format beats N about the documents it cannot hold.
		"Behaviour. An SVG has no states: what is here is the one state each instance is drawn in, and the transitions, the triggers and the other states are not in the file.",
		// The second half of the same asymmetry, and it is the ladder's. HTML
		// carries an input as a value in a script and a timeline as `@keyframes`;
		// an SVG has neither a host to be handed a value by nor a clock to play
		// against, so it loses all three of them at once and says so once.
		"Inputs, guards and timelines. An SVG has no clock and no host to set a value from.",
		// And the third: the flat target meeting the third axis. Unconditional
		// like its neighbours, because what it loses about one turned box it
		// loses about every one, and because the sentence has to be true of a
		// document with no z in it at all — where it is, vacuously, and costs a
		// reader one line.
		"Three dimensions. An SVG is flat: a node with a z or a turn is drawn in the place its untransformed box occupies, and a 3D view is drawn as its own rectangle.",
		// Unconditional, like its neighbours, and the same asymmetry this table
		// already argues for: HTML *can* carry a link and names the ones it could
		// not, SVG carries none and says so once about the format.
		"Links. An SVG is a picture: a node that leads to another page is drawn and does not lead anywhere.",
];

export const svgTarget: ExportPlugin = {
	id: "svg",
	collapses: false,
	single:
		"SVG has no media queries and no theming convention, so a collapsed space only reaches HTML.",
	needs: ["image"],
	usesTokens: true,
	spec: {
		label: "SVG",
		extension: "svg",
		mime: "image/svg+xml",
		language: "svg",
		loses: LOSES,
	},
	// The one target whose emitter costs nothing to load — it is text, like the
	// core — and it still arrives through a promise, because a contract where the
	// cheap targets are synchronous is a contract with the special case moved
	// rather than removed. See the essay on `ExportPlugin`.
	load: async () => (await import("./svg.ts")).svgExport,
};
