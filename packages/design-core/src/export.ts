/**
 * The way out.
 *
 * A design space is only interesting if you can eventually leave it with
 * something. {@link ModelScene} is already the right thing to leave with: a
 * resolved tree, per universe, with the frames and the painted properties
 * settled by the solver. So an export is a second renderer over the same
 * reading the canvas uses, and it inherits the same guarantee — what comes out
 * is what the answer set said, not what the document happened to store.
 *
 * Two targets, both of which fall almost directly out of `ModelScene` and the
 * paint tables: HTML+CSS and SVG. A React component was considered and
 * dropped; see {@link EXPORT_TARGETS}.
 *
 * Three things are read from the *document* rather than from the answer set,
 * and each for a reason the answer set cannot fix:
 *
 *   - a plotted node's vertices and a diagonal node's lean, which the atoms do
 *     not carry at all — the canvas reads them from the document for the same
 *     reason;
 *   - which token a value *named*. The program interns literals, so by the time
 *     a colour reaches `rendered/3` it is `#3b82f6` and the name is gone. The
 *     name is the one thing the document knew that the picture does not, and
 *     throwing it away would turn a design system into a pile of hex codes.
 *
 * A rule-minted node that links to a token is therefore exported with the
 * literal rather than the name; the document has no account of it to read. That
 * is the only place tokens do not survive, and it is named in {@link ExportResult.lost}.
 *
 * **Everything leaves in CSS pixels.** Internally a length is EMU — 1/914400 of
 * an inch, so that nothing a designer types has to be rounded — and none of
 * that is any of a stylesheet's business: `px` is the unit CSS was given, an
 * exported file must open in a browser and look like the canvas did, and a
 * document in whole pixels must come out byte for byte what it came out
 * before. So the conversion sits at this file's edge, in {@link cssPx} and the
 * three helpers beside it, and every number that reaches the output goes
 * through one of them. There is a test for exactly that promise, in both
 * directions: a document in whole pixels comes out in whole pixels, and the
 * same design written in points comes out the same file.
 *
 * **Nothing that is furniture comes out.** Margins, the column grid and the
 * guides a designer drew rule the design in the editor and are not part of it,
 * so they reach neither target — and that costs no code at all, because a datum
 * is not a node and this file never opens the fields they live in. It is still
 * a promise rather than an accident, so it is asserted in the tests and named in
 * {@link ExportResult.lost}; see {@link GRID_LOST}.
 *
 * A style is the one thing here that is not a translation but an *identity*: a
 * style is a shared bundle of declarations under a name, and so is a CSS class.
 * So it comes out as one — see {@link styleClasses} — and a wearer's rule holds
 * only what it says for itself. That is the whole of why the HTML target got
 * smaller and readable at the same time; nothing else in this file changed.
 *
 * **Behaviour leaves as three different things, and which one is not a
 * preference.** A state CSS has a name for is a pseudo-class and no script at
 * all — that promise is the reason `TRIGGERS` carries a `css` column, and a file
 * that shipped JavaScript to do what `:hover` does would be a worse artefact
 * than the one this tool replaces. A state it has no name for is a
 * `data-state` attribute and the interpreter in `runtime.ts`, one table read by
 * the studio and the file so the two cannot drift. A **timeline** is neither: it
 * is `@keyframes`, played by the compositor, because the browser is a better
 * animator than anything this file could emit and because a script that also
 * paced the motion would apply every delay twice. Layers stack on top of all
 * three without changing any of them — a machine is in one state per layer, so
 * an element carries one attribute per layer, and the first layer's is the plain
 * `data-state` a one-layer document has always had.
 *
 * **The third axis leaves as two answers, and the line between them is the
 * `viewport` kind.** A flat box with a z and a lean is something CSS draws
 * *exactly* — `translate3d`, the three rotation functions, `preserve-3d` on the
 * ancestors and a `perspective` on the surface — so it is written and nothing is
 * lost; see {@link transformOf}. A *scene* is geometry projected through a
 * camera, which neither HTML nor SVG has any word for, so the walk stops at the
 * box, the box is drawn, and {@link ExportResult.lost} names glTF as the way
 * out. Deciding that per node was the alternative and there is no honest way to
 * do it: "is the flat answer good enough here" is a question about a whole
 * subtree, which is what the kind is.
 */
import type { Frame } from "./geometry.ts";
import { pathData, scalePoints } from "./geometry.ts";
import { instanceNodes, instancePart, parseInstancePart } from "./components.ts";
import {
	MEASURED_PROPS,
	autoSizes,
	lineHeightEmu,
} from "./measure.ts";
import {
	blendWeights,
	findState,
	keyEasing,
	layerOf,
	layerInitial,
	layerStates,
	machineForNode,
	machineLayers,
	machineTable,
	solvedKeys,
	stateName,
	statePart,
	statePropVar,
	statePlays,
	shownState,
	shownStates,
	timelineLength,
	trackTerm,
	transitionExit,
} from "./machines.ts";
import { fontFamilies, quoteFamily, usedFamilies } from "./fonts.ts";
import type { ModelNode, ModelScene, ModelState } from "./model.ts";
import {
	CUSTOM_PROPERTY_RULES,
	DOCUMENT_BASE,
	PAINT,
	SHAPE_PAINT,
	SURFACE_BOX,
	arrowHead,
	cssLength,
	cssName,
	cssPx,
	cssRound,
	cssText,
	cssValue,
	type Declarations,
	diagonalRun,
	paintFor,
} from "./paint.ts";
import {
	DEFAULT_EASING,
	type Dimension,
	type Easing,
	DIMENSIONS,
	EASINGS,
	FRAME_DIMS,
	GUIDE_PROPS,
	type GuideProp,
	KINDS,
	LAYOUT_PROPS,
	type LayoutProp,
	type LoopMode,
	type Machine,
	type MachineState,
	type NodeKind,
	PROP_NAMES,
	PROPS,
	type PropName,
	type Scene,
	type SceneNode,
	type Spatial,
	type StatePart,
	type Style,
	TRIGGERS,
	TURNS,
	TURN_NAMES,
	type Timeline,
	type Track,
	type Transition,
	type Turn,
	drawsWords,
	findStyle,
	frameOf,
	guideLines,
	isDiagonal,
	isGridded,
	isPlotted,
	motionMs,
	propValueOf,
	styleProps,
	variantLabel,
	wornProps,
} from "./scene.ts";
import { runtimeScript } from "./runtime.ts";
import { flatten } from "./tree.ts";
import { type Emu, cssPxFromEmu, emuOf } from "./units.ts";
import {
	type Picks,
	type Token,
	type Value,
	activeTerm,
	findToken,
	frameVar,
	guideAtIn,
	isLengthType,
	keyValueVar,
	layoutVar,
	luminance,
	mdegOf,
	parseVariable,
	propVar,
	resolveValue,
	tokenVar,
	writeAngle,
} from "./values.ts";

/* ------------------------------------------------------------------ */
/* What a target is                                                    */
/* ------------------------------------------------------------------ */

export type ExportTarget = "html" | "svg";

export interface TargetSpec {
	label: string;
	extension: string;
	mime: string;
	/** Syntax name, for the panel's highlighting. */
	language: "html" | "svg";
	/** What this target cannot carry, over and above what every export loses. */
	loses: string[];
}

/**
 * The targets, in one place.
 *
 * **Two, not three.** A React component was the obvious third and it is not
 * here on purpose: it is the HTML target with different quoting, so it would
 * carry exactly the same information and cost a third emitter to keep in step.
 * The one thing a component could add that HTML cannot — props for the
 * variables that vary — is already expressed by {@link collapseSpace}, in CSS
 * custom properties and media queries, which the browser understands with no
 * build step. A third mediocre target instead of two good ones was the
 * explicit thing to avoid.
 */
export const EXPORT_TARGETS: Record<ExportTarget, TargetSpec> = {
	html: {
		label: "HTML + CSS",
		extension: "html",
		mime: "text/html",
		language: "html",
		loses: [
			// Was one sentence ending "…and will re-wrap if a font is missing." That
			// is no longer true of a font this project holds — it is *in* the file —
			// and it is still true of a family the design only names. The sentence is
			// split along exactly that line, because "which of my fonts travel" is
			// the question a designer opening this panel is actually asking.
			"Text is placed in a fixed box: it wraps the way the canvas measured it. A font you imported travels in this file, so it wraps the same everywhere; a system family — Georgia, system-ui — is whatever the reader's machine has, and text set in one re-wraps where it differs.",
			"A font you imported is written into this file as base64, which is a third larger than the file itself: a 250 kB woff2 adds about 330 kB, and a variable .ttf of 800 kB adds about 1.1 MB. Once per family, however many nodes wear it, and nothing is fetched — the file needs no network at all.",
		],
	},
	svg: {
		label: "SVG",
		extension: "svg",
		mime: "image/svg+xml",
		language: "svg",
		loses: [
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
		],
	},
};

export const EXPORT_TARGET_NAMES = Object.keys(EXPORT_TARGETS) as ExportTarget[];

/** What every export loses, whatever the target. */
const ALWAYS_LOST = [
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
const GRID_LOST =
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
function isRuled(scene: Scene): boolean {
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
function viewportLost(index: DocIndex, node: ModelNode, inside: number, poster: boolean): string {
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
function missingImages(
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
const TURNED_LOST =
	"A turned box is drawn by the browser through its transform and laid out by its untransformed rectangle, here and on the canvas both — so a click near a corner of something leaned away may land on it where there is nothing drawn.";

export interface ExportResult {
	target: ExportTarget;
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
	target: ExportTarget;
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

/* ------------------------------------------------------------------ */
/* Token names                                                         */
/* ------------------------------------------------------------------ */

/** `Brand blue` -> `brand-blue`, and never something CSS cannot parse. */
function slug(name: string): string {
	const cleaned = name
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (cleaned === "") return "t";
	return /^[0-9]/.test(cleaned) ? `t-${cleaned}` : cleaned;
}

/** Custom-property names for every token, distinct even where the names collide. */
function customNames(tokens: readonly Token[]): Map<string, string> {
	const out = new Map<string, string>();
	const taken = new Set<string>();
	for (const token of tokens) {
		let name = slug(token.name || token.id);
		for (let n = 2; taken.has(name); n++) name = `${slug(token.name || token.id)}-${n}`;
		taken.add(name);
		out.set(token.id, name);
	}
	return out;
}

/** Class names the output uses for itself, which a style may not take. */
const RESERVED_CLASSES = new Set(["design", "s"]);

/**
 * Class names for every style: `Prose` becomes `.prose`.
 *
 * The user's own name, because that is the point — a class called `.prose` is
 * what makes the stylesheet editable afterwards, and `.s7` would not be. Kept
 * clear of the generated names as well as of each other: a node's rule is
 * `.n3`, so a style called "n3" gets `n3-2` rather than quietly restyling the
 * fourth node in the document.
 */
function styleClassNames(styles: readonly Style[]): Map<string, string> {
	const out = new Map<string, string>();
	const taken = new Set<string>();
	for (const style of styles) {
		// Lower case, unlike a token's custom property: a class is read as CSS a
		// person writes, and `.prose` is what they would have written.
		const base = slug(style.name || style.id).toLowerCase();
		let name = base;
		for (let n = 2; taken.has(name) || RESERVED_CLASSES.has(name) || /^n\d+$/.test(name); n++) {
			name = `${base}-${n}`;
		}
		taken.add(name);
		out.set(style.id, name);
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* Reading the document for what the atoms do not carry                */
/* ------------------------------------------------------------------ */

/** Everything one export needs to know that is not in the model. */
interface DocIndex {
	scene: Scene;
	byId: Map<string, SceneNode>;
	custom: Map<string, string>;
	/** Class name per style id — see {@link styleClassNames}. */
	styleClass: Map<string, string>;
}

function indexDocument(scene: Scene): DocIndex {
	return {
		scene,
		byId: new Map(flatten(scene.nodes).map((n) => [n.id, n] as const)),
		custom: customNames(scene.tokens),
		styleClass: styleClassNames(scene.styles ?? []),
	};
}

/**
 * The document node a model node came from.
 *
 * An instance's parts are `inst(i1,label)` and are derived, so the document has
 * no node under that id — but it has the definition part the copy was made
 * from, and the vertices, the lean and the token links are all the same there.
 */
function docNode(index: DocIndex, id: string): SceneNode | undefined {
	const direct = index.byId.get(id);
	if (direct) return direct;
	const part = parseInstancePart(id);
	return part ? index.byId.get(part.node) : undefined;
}

/**
 * Whatever the document stores for a variable, if it stores anything.
 *
 * A property goes through {@link propValueOf} rather than straight to
 * `node.props`, so a property a *style* decides is read from the variant the
 * universe picked. Without that a styled fill naming `accent` would come out as
 * the hex — the one thing this file exists to avoid — and it would be a class
 * full of hex codes, which is worse than an inline one.
 *
 * Five of `parseVariable`'s seven tags fall through to `undefined`, and only one
 * of those is a hole worth watching. Measured before believing it: every caller
 * passes a `propVar` or a `frameVar` — nothing constructs a layout, guide,
 * constraint or style variable and asks this — so the fall-through is
 * unreachable rather than lossy. That is not an accident of the callers:
 *
 *   * `layout` (`lval(N,gap)`) and `constraint` (`cval(C)`) both drive
 *     *geometry*, and this exporter is positioned. A gap becomes solved
 *     coordinates and lands as `left`/`top` in literal pixels, so there is no
 *     declaration for a token name to survive into. THIS IS THE ONE TO
 *     REVISIT: a flow-layout emitter would write a real `gap`, and then a gap
 *     naming a length token wants `var(--spacing)` and would silently get the
 *     number instead.
 *   * `guide` (`gval(S,columns)`) drives geometry too, and less directly still:
 *     a margin decides where a datum sits, a rule pins a node to the datum, and
 *     what reaches the file is the node's own solved coordinate. Nothing a grid
 *     says is ever a declaration, so there is nothing here to preserve.
 *   * `style` (`sty(S)`) has no `Value` to return at all — a style's
 *     alternatives are whole records, not terms. A style's *parts* are read
 *     through the `prop` branch above, which is why a styled fill keeps its
 *     token name; the part keys `spart(S,I,P)` are deliberately absent from
 *     `parseVariable` for the same reason.
 */
function documentValue(
	index: DocIndex,
	variable: string,
	picks: Picks,
): Value | undefined {
	const parsed = parseVariable(variable);
	if (!parsed) return undefined;
	if (parsed.kind === "token") {
		return findToken(index.scene.tokens, parsed.token)?.value;
	}
	if (parsed.kind === "prop") {
		const node = docNode(index, parsed.node);
		return node
			? propValueOf(index.scene, node, parsed.prop as PropName, picks)
			: undefined;
	}
	if (parsed.kind === "frame") {
		return docNode(index, parsed.node)?.frame[parsed.dim as Dimension];
	}
	return undefined;
}

/**
 * Which token a variable *named* in this universe, if it named one.
 *
 * The nearest link, not the end of the chain: `var(--accent)` is what a
 * designer wrote and what they want back, even where accent itself points at
 * something else.
 */
function tokenNamed(
	index: DocIndex,
	picks: Picks,
	variable: string,
): Token | undefined {
	return valueNamed(index, picks, documentValue(index, variable, picks), variable);
}

/**
 * The same question asked of a {@link Value} somebody already has in hand.
 *
 * Split out of {@link tokenNamed} for the one caller that cannot go through
 * `parseVariable`: a state's delta is stored under `sprop(I,S,N,P)`, and that key
 * is deliberately absent from `parseVariable` — see the note in `machines.ts`, and
 * `spart(S,I,P)` before it, which is absent for exactly the same reason. The
 * *value* is right there in the document all the same, so the walk that turns a
 * link into `var(--accent)` works perfectly well when it is handed the value
 * rather than asked to find one. Which is the whole difference between a hole in
 * the design system and a lookup with two front doors.
 */
function valueNamed(
	index: DocIndex,
	picks: Picks,
	value: Value | undefined,
	variable: string,
): Token | undefined {
	if (!value || value.length === 0) return undefined;
	const term = activeTerm(value, variable, picks);
	return term?.kind === "token"
		? findToken(index.scene.tokens, term.token)
		: undefined;
}

/**
 * The `--name: value` block for every token this layer ended up naming.
 *
 * One function rather than the two near-copies the two targets used to hold —
 * they differed only in where the block is written, `:root` for a page and
 * `svg` for a file that may be pasted into one. A length token is converted
 * like any other length: it is the definition a `width` or a `font-size` will
 * dereference, so it has to be legal CSS at the point of *use*, where nothing
 * knows any more that a token was involved.
 */
function customProperties(
	index: DocIndex,
	picks: Picks,
	used: ReadonlySet<string>,
): Declarations {
	const out: Declarations = {};
	for (const token of index.scene.tokens) {
		if (!used.has(token.id)) continue;
		const value = resolveValue(
			{ tokens: index.scene.tokens, picks },
			token.value,
			tokenVar(token.id),
		);
		if (value === undefined) continue;
		out[`--${index.custom.get(token.id)}`] = isLengthType(token.type)
			? cssLength(value)
			: value;
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* One layer of the output                                             */
/* ------------------------------------------------------------------ */

/**
 * One universe, and where in the stylesheet it belongs.
 *
 * A plain export has a single layer with no condition. A collapsed space has a
 * base layer and one conditional layer per remaining universe — see
 * {@link collapseSpace}.
 */
export interface Layer {
	universe: ExportUniverse;
	/** `@media` condition, or null. */
	media: string | null;
	/** Extra selector the whole layer sits under, or null. */
	under: string | null;
	/** What to call it in a comment. */
	label: string;
}

/** A node of the output: its class, its id, and where it sits. */
interface Slot {
	id: string;
	className: string;
	kind: NodeKind;
	depth: number;
}

/**
 * Where every emitter in this file stops walking, and the one condition the 3D
 * half of the export costs the 2D half.
 *
 * True for exactly one kind, `viewport`, and read off `KINDS` rather than named
 * here so that it stays the same question `hitTestTree` and the canvas ask. A
 * viewport's children are meshes, cameras and lights: geometry projected through
 * a camera, which HTML has no word for and SVG has no word for either. **A
 * subtree of empty divs with `preserve-3d` on them is not a partial answer to a
 * scene, it is a wrong one** — the boxes would be the meshes' axis-aligned
 * bounding rectangles, in the document's own coordinates, with no camera and no
 * projection anywhere near them, and they would look like a design somebody made
 * rather than like a picture that is missing.
 *
 * So the walk stops at the box, the box is drawn — it is a real rectangle with a
 * real fill, radius, stroke and opacity, and it is exactly what shows behind a
 * transparent scene — and {@link VIEWPORT_LOST} says what is not in the file and
 * how to get it. That is the whole of the decision, and it is one condition in
 * four walks rather than a judgement made per node, which is the second reason
 * the `viewport` kind earns its place: there is no honest way to decide "is the
 * flat answer good enough here" one mesh at a time.
 */
const stopsHere = (kind: NodeKind): boolean => KINDS[kind].opaque;

/** Pre-order over the model, which is also paint order — down to a viewport. */
function slotsOf(model: ModelScene): Slot[] {
	const out: Slot[] = [];
	const walk = (node: ModelNode, depth: number): void => {
		out.push({ id: node.id, className: `n${out.length}`, kind: node.kind, depth });
		if (stopsHere(node.kind)) return;
		for (const child of node.children) walk(child, depth + 1);
	};
	for (const root of model.roots) walk(root, 0);
	return out;
}

/**
 * Every viewport the picture draws, in paint order, with how much is inside it.
 *
 * The count is off the *model* rather than off the document, and that is the
 * difference between a true sentence and a plausible one: a rule can mint a mesh,
 * a state can hide one, an instance can place a whole scene twice, and what the
 * loss has to say is how many objects this universe put in this view.
 *
 * Counted down the whole subtree rather than one level, because "the 24 objects
 * inside this view" is what a designer sees in the layer list, and a pivot's
 * children are objects in the view exactly as its siblings are.
 */
function viewportsIn(model: ModelScene): Array<{ node: ModelNode; inside: number }> {
	const out: Array<{ node: ModelNode; inside: number }> = [];
	const count = (node: ModelNode): number =>
		node.children.reduce((n, child) => n + 1 + count(child), 0);
	const walk = (node: ModelNode): void => {
		if (stopsHere(node.kind)) {
			out.push({ node, inside: count(node) });
			return;
		}
		for (const child of node.children) walk(child);
	};
	for (const root of model.roots) walk(root);
	return out;
}

/**
 * The picture of a scene a caller handed us, as a background on the box.
 *
 * `background-image` rather than an `<img>`, and over the box's own fill rather
 * than replacing it, because a poster is a *photograph of a moment* and the box
 * is a real rectangle with real properties: a scene rendered against a
 * transparent background wants the fill showing through it, and the radius, the
 * stroke and the opacity all still apply to the element they are declared on.
 * `cover` for the reason a poster is not guaranteed to have been captured at the
 * box's own aspect ratio — the canvas's viewport is scaled by the infinite
 * canvas's zoom, and cropping is a better answer than stretching.
 *
 * Only for a kind the walk stops at, so a poster keyed to a node that is not a
 * viewport is quietly nothing rather than a background on a rectangle. The
 * quotes are escaped because a data URL is a string somebody else produced, and
 * an unescaped `"` inside `url("...")` would end the value early and take the
 * rest of the rule with it.
 */
function posterFor(options: ExportOptions, node: ModelNode): Declarations {
	if (!stopsHere(node.kind)) return {};
	const url = options.posters?.[node.id];
	if (url === undefined || url === "") return {};
	return {
		backgroundImage: `url("${url.replace(/["\\]/g, "\\$&")}")`,
		backgroundSize: "cover",
		backgroundPosition: "center",
	};
}

/**
 * The box every root sits inside, so a document away from the origin still
 * tiles. In EMU, like the frames it is taken over; its callers convert.
 */
function modelBounds(model: ModelScene): Frame {
	if (model.roots.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	let left = Number.POSITIVE_INFINITY;
	let top = Number.POSITIVE_INFINITY;
	let right = Number.NEGATIVE_INFINITY;
	let bottom = Number.NEGATIVE_INFINITY;
	for (const root of model.roots) {
		left = Math.min(left, root.frame.x);
		top = Math.min(top, root.frame.y);
		right = Math.max(right, root.frame.x + root.frame.width);
		bottom = Math.max(bottom, root.frame.y + root.frame.height);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/* ------------------------------------------------------------------ */
/* EMU in, CSS pixels out                                              */
/* ------------------------------------------------------------------ */

/**
 * The rounding, the conversion and the literal reader are `paint.ts`'s, taken
 * here under this file's own names.
 *
 * They used to live here, which was defensible while the exporter was the only
 * thing that turned a stored length into CSS. It is not: the canvas paints the
 * same properties out of the same table, and a second copy of "an `emu`
 * literal is not CSS" is a copy that drifts — which it did, and the corner of a
 * rectangle exported rounded and drew square. So the conversion moved next to
 * the table, and what stays here is the SVG target's arithmetic, which is about
 * numbers that have already crossed.
 */
const round = cssRound;

/** A length as a CSS declaration takes it. */
const px = (emu: Emu): string => `${cssPx(emu)}px`;

/**
 * A box in float CSS pixels, converted once at the top of whatever draws it.
 *
 * The SVG target does real arithmetic on a frame — a centre, a diagonal's run,
 * an arrowhead's barbs — and every bit of it was written in pixels and has
 * pixel constants inside it (`arrowHead` clamps its barbs between 8 and 24).
 * Converting the box once and leaving that arithmetic alone is both the smaller
 * change and the honest one: those constants are about what a picture looks
 * like, not about what a document holds, and rewriting them in EMU would move
 * the decision out of the file that owns it.
 */
const framePx = (frame: Frame): Frame => ({
	x: cssPxFromEmu(frame.x),
	y: cssPxFromEmu(frame.y),
	width: cssPxFromEmu(frame.width),
	height: cssPxFromEmu(frame.height),
});

/* ------------------------------------------------------------------ */
/* The third axis, where CSS is a complete answer                      */
/* ------------------------------------------------------------------ */

/**
 * A place and a rotation, as one `transform`.
 *
 * **This is the half of the third axis the flat targets get exactly right, and
 * it is worth being clear that it is exact rather than approximate.** A `rect`
 * with a `z` and a `rotateY` is a flat box in space, and `translate3d` plus the
 * three rotation functions is precisely what a flat box in space is in CSS —
 * same origin, same order, same numbers. Nothing is dropped, nothing is
 * projected by hand, and the browser's compositor does the projection the canvas
 * does. What CSS has no word for is *geometry*, which is why the line falls at
 * the `viewport` kind and nowhere else — see {@link stopsHere}.
 *
 * **The order is `rotateX rotateY rotateZ`, and it is not §10.4's example.** The
 * frozen spec's §2.3 fixes the order of *application* as rotateZ, then rotateY,
 * then rotateX, and says in the same paragraph that this is "CSS's own order for
 * `rotateX(..) rotateY(..) rotateZ(..)` read left to right" — because CSS
 * composes a transform list left to right and so applies the **rightmost**
 * function to the point first. `spatial.ts`'s {@link rotationMatrix} is `Rx · Ry
 * · Rz` for the same reason and says so. §10.4's illustration writes the three in
 * the other order, which contradicts both, and following the illustration would
 * have exported a rotation the canvas and the solver do not agree with. So the
 * normative sentence wins and the example is treated as the typo it is; this is
 * called out in the step's return value rather than quietly reversed.
 *
 * A zero term is omitted rather than written as `rotateX(0deg)`. It is the
 * identity, so the picture is the same either way, and the reason to leave it
 * out is that this string is also what a *state* rule writes — a whole `transform`
 * replaces a whole `transform`, so every rule that writes one writes the complete
 * pose — and a file where every card carries three rotations it does not have is
 * a file nobody reads. Where the pose is entirely flat and unmoved this answers
 * `undefined`, and the document that has never heard of the third axis gets the
 * bytes it got before, which is invariant 4 in one line.
 *
 * The translation is `translate3d` only where there is a z, and plain
 * `translate` otherwise, for that same reason: a 2D document's state move has
 * always come out as `translate(12px, 0px)` and still does.
 */
function transformOf(
	dx: Emu,
	dy: Emu,
	z: Emu,
	turn: Readonly<Record<Turn, number>> | undefined,
): string | undefined {
	const parts: string[] = [];
	if (z !== 0) parts.push(`translate3d(${cssPx(dx)}px, ${cssPx(dy)}px, ${cssPx(z)}px)`);
	else if (dx !== 0 || dy !== 0) parts.push(`translate(${cssPx(dx)}px, ${cssPx(dy)}px)`);
	for (const name of TURN_NAMES) {
		const mdeg = turn?.[name] ?? 0;
		if (mdeg !== 0) parts.push(`${TURNS[name].css}(${writeAngle(mdeg)})`);
	}
	return parts.length === 0 ? undefined : parts.join(" ");
}

/** A pose, as the two callers that have one hold it. */
interface Posed {
	spatial?: Readonly<Record<Spatial, number>>;
	turn?: Readonly<Record<Turn, number>>;
}

/** How far forward something is, with "the answer set said nothing" read as zero. */
const liftOf = (posed: Posed): Emu => posed.spatial?.z ?? 0;

/**
 * True where a pose needs a 3D rendering context around it rather than just a
 * transform on it.
 *
 * A `rotateZ` is a rotation *in the plane*: it needs no `perspective` and no
 * `preserve-3d`, it has worked in every browser since before either existed, and
 * putting a perspective on its parent would change nothing about it. A `z` or a
 * lean about x or y is the other thing, and without the context above it the
 * browser flattens it — which is a picture that is silently, subtly wrong rather
 * than obviously missing, and is the failure this test exists to prevent.
 */
const needsDepth = (posed: Posed): boolean =>
	liftOf(posed) !== 0 ||
	(posed.turn?.rotateX ?? 0) !== 0 ||
	(posed.turn?.rotateY ?? 0) !== 0;

/**
 * Which elements have to be told the scene is three dimensional, and where the
 * eye stands.
 *
 * Two declarations, and neither of them belongs to the node that is actually
 * turned: `perspective` goes on the surface the turned things sit *on*, because
 * that is the choice of where the viewer is and it is one choice for everything
 * standing on that surface; `transform-style: preserve-3d` goes on every element
 * between the two, because the default is `flat` and a flat ancestor collapses
 * its whole subtree back into the plane before the perspective ever sees it.
 *
 * The nearest {@link KindSpec.surface} ancestor is the perspective root, which is
 * `PROPS.perspective`'s own claim — it is offered on `frame` and on nothing else
 * — and a turned node with no surface above it puts the perspective on `.design`,
 * the element this file wraps the whole document in. That is the honest answer
 * rather than a refusal: the document *is* the surface then, and a card leaning
 * off the top level with no perspective anywhere would be drawn flat.
 *
 * Nothing here is emitted for a `rotateZ` alone — see {@link needsDepth} — and
 * nothing at all is emitted for a document with no third axis in it, which is
 * every document that shipped before this. The walk stops at a viewport like
 * every other walk here.
 */
interface Depth {
	/** Node ids that need `transform-style: preserve-3d`. */
	preserve: Set<string>;
	/** Node id -> the `perspective` length its children are seen through. */
	perspective: Map<string, string>;
	/** The same, for the wrapper, where a turned node has no surface above it. */
	onDocument?: string;
	/** True where anything outside a viewport is turned at all — for the loss. */
	turned: boolean;
}

function depthOf(model: ModelScene): Depth {
	const out: Depth = { preserve: new Set(), perspective: new Map(), turned: false };
	const eye = (node: ModelNode): string =>
		cssLength(node.rendered.perspective ?? PROPS.perspective.fallback);
	const walk = (node: ModelNode, chain: ModelNode[]): void => {
		if (transformOf(0, 0, liftOf(node), node.turn) !== undefined) out.turned = true;
		if (needsDepth(node)) {
			// Outwards from the node's own parent until a surface answers. The
			// surface takes the perspective and stops the walk; everything passed on
			// the way there has to keep the subtree unflattened.
			let seated = false;
			for (let i = chain.length - 1; i >= 0; i--) {
				const up = chain[i];
				if (KINDS[up.kind].surface) {
					out.perspective.set(up.id, eye(up));
					seated = true;
					break;
				}
				out.preserve.add(up.id);
			}
			if (!seated) out.onDocument = cssLength(PROPS.perspective.fallback);
		}
		if (stopsHere(node.kind)) return;
		for (const child of node.children) walk(child, [...chain, node]);
	};
	for (const root of model.roots) walk(root, []);
	return out;
}

/* ------------------------------------------------------------------ */
/* A style, as a class                                                 */
/* ------------------------------------------------------------------ */

/**
 * One style, and the class it comes out as.
 *
 * Not every property a style holds can go in the class, and the three filters
 * in {@link styleClasses} are why this is a record rather than the style
 * itself: what a class may say is a question about the *wearers*, and the
 * answer is a subset.
 */
interface StyleClass {
	/** The class name — `prose`, from the style's own name. */
	name: string;
	/** The properties the class carries, in table order. */
	props: PropName[];
	/**
	 * Wearers drawn in this universe, by node id: the document's first, in
	 * document order, then the ones only the answer set names.
	 *
	 * The order is load-bearing, not tidiness — {@link classRule} reads the
	 * class's value off the first wearer that takes each property, and only a
	 * wearer the document holds can say which token it named.
	 */
	wearers: string[];
	/** Per wearer, the properties it takes from the style rather than states. */
	worn: Map<string, Set<PropName>>;
	/** Which of them the document has no account of — see `ModelScene.wears`. */
	derived: string[];
}

/**
 * The document's styles, as the classes the output shares between wearers.
 *
 * A style *is* a class: a named bundle of declarations several elements point
 * at. So the translation is an identity rather than an approximation, and the
 * only real work is deciding which of the style's properties may go in the
 * shared block. Three filters, and each rules out a way the class could paint
 * something the answer set did not:
 *
 *   - **every wearer draws it, the same way.** A text style that also holds a
 *     fill, worn by a text node, must not put a background on the text: the
 *     canvas paints only what `KINDS[kind].props` lists. A property two wearers
 *     of different kinds take to *different* declarations — a stroke is a
 *     border on a box and a `stroke` on a line — is out for the same reason.
 *   - **every wearer draws it in this universe.** A field one variant fills in
 *     and another leaves out is still one of the style's properties, and in the
 *     universe that picked the silent variant there is nothing to say.
 *   - **the wearers that take it agree about what it says.** They always do —
 *     one pick, one variant, one literal — but a hand-written rule may derive
 *     `resolved(prop(N,P))` for one node and not another, and then the shared
 *     block would be a claim about both.
 *
 * A wearer that states its own value for a property is *not* excluded: it keeps
 * that one declaration in its own rule, and its own rule beats the class —
 * see the `:where()` in `readLayer`. That is exactly what an override is, and
 * writing it as the cascade rather than as an absence is what makes the output
 * editable: change `.prose` and everything that did not override follows.
 *
 * Wearing comes from both places it can come from. The document is one, and
 * the answer set is the other: `ModelScene.wears` is the wearing no
 * `sty_doc/3` states — an instance's copy of a definition that wears a style,
 * and a node a hand-written rule dressed — and a wearer is a wearer however the
 * program came to know it. Reading only the document was a smaller output that
 * was also a wrong one: every instance of a styled component repeated the
 * treatment inline, and the class the definition's own part carried was a class
 * with one user.
 *
 * What a derived wearer does not bring is the token a value *named*: the
 * document has no account of it, so the class holds `var(--lg)` only when a
 * document wearer put it there — which is why the document's wearers are first
 * in the list {@link classRule} reads from. Named in {@link ExportResult.lost}.
 */
function styleClasses(index: DocIndex, base: Layer): StyleClass[] {
	const model = base.universe.model;
	const out: StyleClass[] = [];
	for (const style of index.scene.styles ?? []) {
		const worn = new Map<string, Set<PropName>>();
		const wearers: string[] = [];
		for (const node of flatten(index.scene.nodes)) {
			if (node.style !== style.id || !model.byId[node.id]) continue;
			wearers.push(node.id);
			worn.set(node.id, new Set(wornProps(index.scene, node)));
		}
		// Then the wearers only this universe knows about. A property the node
		// draws for itself is not in the atom, so `wornProps`' precedence has
		// already been applied by the join that derived it.
		const derived: string[] = [];
		for (const wearer of model.wears[style.id] ?? []) {
			if (!model.byId[wearer.node] || worn.has(wearer.node)) continue;
			wearers.push(wearer.node);
			derived.push(wearer.node);
			worn.set(wearer.node, new Set(wearer.props));
		}
		if (wearers.length === 0) continue;
		const props = styleProps(style).filter((prop) => {
			const paints = new Set(wearers.map((id) => paintFor(model.byId[id].kind, prop)));
			if (paints.size !== 1 || paints.has(undefined)) return false;
			if (wearers.some((id) => model.byId[id].rendered[prop] === undefined)) return false;
			const said = new Set(
				wearers
					.filter((id) => worn.get(id)?.has(prop))
					.map((id) => model.byId[id].rendered[prop]),
			);
			return said.size === 1;
		});
		if (props.length === 0) continue;
		out.push({
			name: index.styleClass.get(style.id) ?? slug(style.id),
			props,
			wearers,
			worn,
			derived,
		});
	}
	return out;
}

/** One class's declarations in one layer, and which keys each property wrote. */
interface ClassRule {
	declarations: Declarations;
	keys: Map<PropName, string[]>;
}

/**
 * What a class says in one layer.
 *
 * The value comes from a wearer that actually *takes* the property from the
 * style, and through the same `tokenNamed` walk a node's own declaration takes
 * — so a variant that says `size: ref("lg")` reaches the class as
 * `var(--lg)`, and the class is a design system rather than a pile of numbers.
 *
 * The property set is decided once, on the base layer, and every layer answers
 * for exactly that set. A layer that hoisted a different set would emit
 * `unset` on a wearer's own rule *after* the class it was meant to defer to,
 * and the cascade would then drop a declaration the picture needs.
 */
function classRule(
	index: DocIndex,
	layer: Layer,
	cls: StyleClass,
	useTokens: boolean,
	used: Set<string>,
): ClassRule {
	const declarations: Declarations = {};
	const keys = new Map<PropName, string[]>();
	for (const prop of cls.props) {
		const from = cls.wearers.find((id) => cls.worn.get(id)?.has(prop));
		const node = from === undefined ? undefined : layer.universe.model.byId[from];
		const value = node?.rendered[prop];
		if (node === undefined || value === undefined) continue;
		const paint = paintFor(node.kind, prop);
		if (!paint) continue;
		const token = useTokens
			? tokenNamed(index, layer.universe.pick, propVar(node.id, prop))
			: undefined;
		if (token) used.add(token.id);
		const said = paint(
			token ? `var(--${index.custom.get(token.id)})` : cssValue(prop, value),
		);
		Object.assign(declarations, said);
		keys.set(prop, Object.keys(said));
	}
	return { declarations, keys };
}

/* ------------------------------------------------------------------ */
/* HTML + CSS                                                          */
/* ------------------------------------------------------------------ */

function escapeText(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const escapeAttr = (text: string): string => escapeText(text).replace(/"/g, "&quot;");

/**
 * A node's geometry, with a dimension the document parameterised left as its
 * token.
 *
 * Only where the solver did *not* decide the coordinate: a laid-out child sits
 * where the equations put it, and dressing that number up as `var(--gap)` would
 * be a lie about which number it is. Roots are excluded too — they are
 * re-seated against the document's own top-left, so their stored x and y are
 * not what comes out.
 */
function geometry(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
	root: boolean,
	origin: Frame,
	useTokens: boolean,
	used: Set<string>,
): Declarations {
	const solved = layer.universe.solved?.[node.id];
	const out: Declarations = {};
	for (const dim of DIMENSIONS) {
		const literal =
			root && FRAME_DIMS[dim].role === "pos"
				? node.frame[dim] - (dim === "x" ? origin.x : origin.y)
				: node.frame[dim];
		const parameterised =
			useTokens && !root && solved?.[dim] === undefined
				? tokenNamed(index, layer.universe.pick, frameVar(node.id, dim))
				: undefined;
		const key = dim === "x" ? "left" : dim === "y" ? "top" : dim;
		if (parameterised) used.add(parameterised.id);
		out[key] = parameterised
			? `var(--${index.custom.get(parameterised.id)})`
			: px(literal);
	}
	// The third axis and the rotation, beside the four numbers rather than
	// instead of them: `left` and `top` are still where the box is, and the
	// transform is what happens to it there. Written here, in the one function
	// that already knows a node's geometry, which is what makes the machine half
	// of this file compose with it for free — a state's `diff()` picks a
	// `transform` up exactly as it picks a `background` up, and the `transition:`
	// declaration names it exactly as it names any other property.
	//
	// `transform-origin` is only written where there is a transform, and it is
	// written because the rotation the solver and the canvas agreed about is
	// about the box's own centre. CSS's default already is `50% 50%`, so this is
	// a statement rather than a correction — and stating it is what stops a
	// stylesheet somebody pastes this into from silently re-hanging every card
	// off its top-left corner.
	const transform = transformOf(0, 0, liftOf(node), node.turn);
	if (transform !== undefined) {
		out.transform = transform;
		out.transformOrigin = "center center";
	}
	return out;
}

/**
 * The delta the *drawn* state states for one property of an instance's part, and
 * the variable it is stored under.
 *
 * A hole this file had before layers and which layers walk straight into. A
 * property's token name is read back out of the document, because the program
 * interns literals — and the reading went to the definition's own stored value,
 * which is the right answer exactly while the instance is drawn in a state that
 * says nothing about that property. Where the drawn state *repaints* it, the
 * answer set renders the state's colour and the document's value names a
 * different token, so the file wrote `var(--accent)` beside a picture the solver
 * said was green. Rare before — it needs a `SceneNode.state` pointing at a
 * non-initial state — and ordinary now, because a layered instance is drawn in
 * one state per layer and any of them may repaint.
 *
 * The **last** layer that states a value wins, walked in layer order, which is
 * `mwriter/4`'s own rule and the same order {@link composeStates} composes in.
 * Deliberately not `composeStates` itself: that answers with a merged
 * {@link StatePart} and this needs to know *which state* stated it, because the
 * variable key a value's alternatives are picked under is `sprop(I,S,N,P)` and a
 * merged record has no S in it.
 */
function drawnStateValue(
	index: DocIndex,
	model: ModelScene,
	nodeId: string,
	prop: PropName,
): { value: Value; variable: string } | undefined {
	const part = parseInstancePart(nodeId);
	if (!part) return undefined;
	const use = index.byId.get(part.instance);
	if (!use) return undefined;
	const machine = machineForNode(index.scene, use);
	if (!machine) return undefined;
	const stack = machineLayers(machine);
	const drawn = drawnStates(model, machine, use, stack[0].id);
	let found: { value: Value; variable: string } | undefined;
	for (const stratum of stack) {
		const state = findState(machine, drawn[stratum.id]);
		// A state has to be a state of *this* layer, for `composeStates`' reason: a
		// record naming layer two's state under layer one would compose one layer's
		// pose twice.
		if (!state || layerOf(machine, state) !== stratum.id) continue;
		const value = state.parts[part.node]?.props?.[prop];
		if ((value?.length ?? 0) > 0) {
			found = {
				value: value as Value,
				variable: statePropVar(use.id, state.id, part.node, prop),
			};
		}
	}
	return found;
}

/** Everything a node paints, with token links kept as `var(--name)`. */
function declarationsFor(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
	useTokens: boolean,
	used: Set<string>,
): Declarations {
	// The same walk `paintOf` does — the canvas's — with two differences, and the
	// second is why this no longer takes `paintOf`'s shortcut when there are no
	// token names to keep. One: the token's name stands in for the literal
	// wherever the document named one. Two: a length is converted on the way in.
	// Turning names off must change only what a declaration *reads as*, never
	// what it means, so both paths have to convert or neither does — the
	// round-trip test that inlines every `var()` and expects the plain export
	// back is exactly the assertion that they agree.
	const box: Declarations = {};
	if (KINDS[node.kind].surface) Object.assign(box, SURFACE_BOX);
	const shape = SHAPE_PAINT[node.kind];
	if (shape?.box) Object.assign(box, shape.box);
	for (const prop of KINDS[node.kind].props) {
		const value = node.rendered[prop];
		if (value === undefined) continue;
		const paint = paintFor(node.kind, prop);
		if (!paint) continue;
		// Two front doors, exactly as `copyPaint` has two and for the same reason:
		// a property the drawn state answers has its own variable and its own
		// stored value, and a property it says nothing about is the instance's
		// shared one. See {@link drawnStateValue}.
		const said = useTokens ? drawnStateValue(index, layer.universe.model, node.id, prop) : undefined;
		const token = !useTokens
			? undefined
			: said !== undefined
				? valueNamed(index, layer.universe.pick, said.value, said.variable)
				: tokenNamed(index, layer.universe.pick, propVar(node.id, prop));
		if (token) {
			used.add(token.id);
			Object.assign(box, paint(`var(--${index.custom.get(token.id)})`));
		} else {
			Object.assign(box, paint(cssValue(prop, value)));
		}
	}
	return box;
}

/**
 * A payload as a `data:` url, or nothing where the caller did not supply it.
 *
 * Base64 through `btoa`, which both a browser and Node have as a global — this
 * package has no DOM in its `lib` and must not gain one for an encoder. Built
 * in chunks because `String.fromCharCode(...bytes)` spreads the whole array
 * into an argument list, and a four-megabyte photograph is four million
 * arguments and a stack overflow.
 *
 * The media type comes from the extension rather than from the document,
 * because what the exporter has is a path. A type it does not recognise is left
 * to the browser to sniff, which is what `application/octet-stream` would
 * prevent.
 */
function dataUrl(
	payloads: Readonly<Record<string, Uint8Array>>,
	path: string,
	unknown = "image/png",
): string | undefined {
	const bytes = payloads[path];
	if (!bytes || bytes.length === 0) return undefined;
	let binary = "";
	const CHUNK = 0x8000;
	for (let at = 0; at < bytes.length; at += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
	}
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	const type = MEDIA_TYPES[ext];
	return `data:${type ?? unknown};base64,${btoa(binary)}`;
}

/**
 * What an extension means, for the handful a design tool actually places.
 *
 * The four font types are here rather than in a table of their own, and a second
 * `fontDataUrl` beside `dataUrl` was rejected for the reason `store.ts`
 * congratulates itself on: two functions that turn a path and some bytes into a
 * data URI are two answers to "what is at this path". What is *not* shared is
 * the guess for an extension neither table knows — "an unknown extension is a
 * PNG" is a reasonable thing to assume about a picture and a nonsense one about
 * a face — which is why the fallback became a parameter above.
 */
const MEDIA_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
	woff2: "font/woff2",
	woff: "font/woff",
	ttf: "font/ttf",
	otf: "font/otf",
};

/**
 * What `src: url(…) format(…)` should say, per extension.
 *
 * The `format()` hint is what browsers actually dispatch on, and it is why a
 * wrong MIME in a `data:` URI is survivable. An extension not in this table gets
 * the data URI with `application/octet-stream` and **no** `format()` clause at
 * all, so the browser sniffs rather than being told something false — which is
 * the same call `dataUrl` makes one function up about an unknown picture.
 */
const FONT_FORMATS: Record<string, string> = {
	woff2: "woff2",
	woff: "woff",
	ttf: "truetype",
	otf: "opentype",
};

/**
 * The `@font-face` rules an artefact needs, one per declared file the design
 * actually sets text in.
 *
 * Unshifted before `BASE_CSS` by the caller, so a face is declared before
 * `.design` sets a family on anything.
 *
 * **The join is `usedFamilies` ∩ `scene.fonts`, and both halves earn their
 * place.** The used set is read off the *answer set* — a rule that mints a text
 * node and gives it a family is a design that uses that family, and a walk of
 * the document would miss it — unioned over every layer the artefact carries, so
 * a `collapseSpace` export holding three universes carries the faces all three
 * need and no more. The declared side is what turns a family name into bytes,
 * and it is why a system stack contributes nothing: `Georgia` is in no roster,
 * so no rule is written for it and the reader's own copy is used, which is what
 * naming a system family has always meant.
 *
 * A family whose bytes the caller did not hand over gets **no rule at all**
 * rather than a rule with an empty `src`, and is named in `lost` by
 * {@link missingFaces} instead. An `@font-face` pointing at nothing is worse
 * than none: it is a declaration the browser spends a moment on and then falls
 * back from, with `font-display: block` making that moment visible.
 */
export function fontFaces(
	scene: Scene,
	families: ReadonlySet<string>,
	fonts: Readonly<Record<string, Uint8Array>>,
): string[] {
	const out: string[] = [];
	for (const [family, files] of fontFamilies(scene)) {
		if (!families.has(family)) continue;
		for (const file of files) {
			const url = dataUrl(fonts, file.src, "application/octet-stream");
			if (url === undefined) continue;
			const ext = file.src.slice(file.src.lastIndexOf(".") + 1).toLowerCase();
			const format = FONT_FORMATS[ext];
			const lines = [
				`\tfont-family: ${quoteFamily(family)};`,
				`\tsrc: url(${url})${format ? ` format("${format}")` : ""};`,
				`\tfont-weight: ${file.weight};`,
				`\tfont-style: ${file.style};`,
			];
			if (file.stretch !== undefined) lines.push(`\tfont-stretch: ${file.stretch};`);
			// `block`, not `swap`, and it is the one non-obvious descriptor here. The
			// geometry in an exported file is literal pixels measured in the real
			// face — `ALWAYS_LOST` says so — and `swap` paints the fallback into boxes
			// fitted to Inter, which overflows them, and then reflows. `block` shows
			// nothing for a moment and then shows the design. The face is a data URI
			// in this same file, so "a moment" is a parse and not a round trip: an
			// export is a picture of a design, not a page with a paint budget, and a
			// picture that is briefly blank beats one that is briefly wrong.
			lines.push("\tfont-display: block;");
			out.push(`@font-face {\n${lines.join("\n")}\n}`);
		}
	}
	return out;
}

/**
 * Faces the caller did not hand over, one sentence each — `missingImages`'
 * typographic twin, and the second clause is what earns it a sentence of its
 * own.
 *
 * For an image, a missing payload is an empty box at the right size. For a font
 * it is text at the *wrong* size in a box that does not fit it, because the
 * geometry was measured for the face and the words come out in the rest of their
 * stack — a worse artefact and a much harder one to diagnose from the file.
 *
 * Named by family and by path, once per family however many nodes wear it, for
 * the reason `missingImages` names a path: it is the thing a person can go and
 * find.
 */
function missingFaces(
	scene: Scene,
	families: ReadonlySet<string>,
	fonts: Readonly<Record<string, Uint8Array>>,
): string[] {
	const out: string[] = [];
	for (const [family, files] of fontFamilies(scene)) {
		if (!families.has(family)) continue;
		const absent = files.filter((f) => {
			const bytes = fonts[f.src];
			return bytes === undefined || bytes.length === 0;
		});
		if (absent.length === 0) continue;
		out.push(
			`This design sets text in “${family}”, and ${absent.length === files.length ? "those bytes were" : `the bytes behind ${absent.map((f) => `“${f.src}”`).join(", ")} were`} not available when this file was written — so the words come out in the rest of their stack, in a box that was measured for the face. A project still syncing its assets, or opened without them, exports this way.`,
		);
	}
	return out;
}

/** A byte count as a person reads it, for a sentence about a file's weight. */
const kb = (bytes: number): string => `${Math.round(bytes / 1024)} kB`;

/**
 * What the faces in this file weigh, said about *this document* rather than
 * about the format.
 *
 * The asymmetry is the file's own — `EXPORT_TARGETS` carries the unconditional
 * sentences and `GRID_LOST`/`missingImages` carry the conditional ones — and
 * here both halves have something different to say, so both are said: the target
 * sentence is true of every HTML export of every design with an uploaded font,
 * and this one names the families and the kilobytes a designer is actually
 * about to send somebody.
 *
 * Base64 is four characters per three bytes, so the inlined size is a third
 * larger than the payload. Reported as the payload plus that third rather than
 * as the payload, because the question being answered is "how big is this file".
 */
function fontWeightNote(
	scene: Scene,
	families: ReadonlySet<string>,
	fonts: Readonly<Record<string, Uint8Array>>,
): string[] {
	const named: string[] = [];
	let total = 0;
	for (const [family, files] of fontFamilies(scene)) {
		if (!families.has(family)) continue;
		let sum = 0;
		for (const file of files) {
			const bytes = fonts[file.src];
			if (bytes && bytes.length > 0) sum += bytes.length;
		}
		if (sum === 0) continue;
		total += sum;
		named.push(`“${family}” (${kb(sum)})`);
	}
	if (named.length === 0) return [];
	return [
		`The fonts are in this file. ${named.join(" and ")} ${named.length === 1 ? "is" : "are"} inlined as base64, which is about ${kb(Math.round(total * 4 / 3))} of it.`,
	];
}

/** The markup a kind draws inside its box, as a string. */
function htmlContent(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
	images: Readonly<Record<string, Uint8Array>> = {},
): string {
	// A picture, inlined. `<img>` rather than a CSS background, because an image
	// is content: it takes the box's own `border-radius`, it honours `object-fit`
	// as a declaration the stylesheet already carries, and a file somebody pastes
	// into a page keeps an element they can select and label.
	//
	// The alt is deliberately empty. The document has no field for a description,
	// and inventing one from the filename would read "hero-final-2" to a screen
	// reader — worse than saying nothing. An empty alt means decorative, which is
	// the honest default until the document can say otherwise.
	if (node.kind === "image") {
		const url = node.asset === undefined ? undefined : dataUrl(images, node.asset);
		return url === undefined
			? ""
			: `<img src="${escapeAttr(url)}" alt="" draggable="false"/>`;
	}
	// How a kind draws what is inside its box: its words, a stroke along a
	// diagonal, a plotted outline, or nothing — a plain shape is all box. Every
	// test reads the one table rather than naming a kind, so `svgNode` below
	// answers the same three questions the same way.
	if (drawsWords(node)) return escapeText(node.rendered.text ?? "");
	const doc = docNode(index, node.id);
	// Pixels from here down. The inner `<svg class="s">` has no viewBox, so its
	// user units are the box's CSS pixels — see BASE_CSS.
	const frame = framePx(node.frame);
	if (isDiagonal(node)) {
		const { y1, y2 } = diagonalRun(frame, doc?.diagonal);
		const head =
			node.kind === "arrow"
				? `<polyline points="${escapeAttr(arrowHead(0, y1, frame.width, y2))}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
				: "";
		// Rounded, unlike before: a coordinate used to arrive as a float the
		// solver had already settled, and now it arrives one division by 9525
		// later, which is where `12.340000000000002` comes from.
		return `<svg class="s" aria-hidden="true"><line x1="0" y1="${round(y1)}" x2="${round(frame.width)}" y2="${round(y2)}" stroke-linecap="round" fill="none"/>${head}</svg>`;
	}
	if (isPlotted(node)) {
		if (!doc) return "";
		const context = { tokens: index.scene.tokens, picks: layer.universe.pick };
		// The scale is a ratio, so handing it the box in the unit we want out
		// converts and resizes in one step: the vertices are in the document's
		// own EMU, `from` is the EMU box they were authored in, and `to` is that
		// box in pixels. A separate conversion afterwards would be a second
		// place for the two to disagree.
		const d = pathData(
			scalePoints(doc.points ?? [], frameOf(doc, context), frame),
			doc.closed,
		);
		if (!d) return "";
		const fill = doc.closed ? "" : ' style="fill:none"';
		return `<svg class="s" aria-hidden="true"><path d="${escapeAttr(d)}"${fill} stroke-linecap="round" stroke-linejoin="round"/></svg>`;
	}
	return "";
}

/** `.n3 { ... }`, skipping a block with nothing in it. */
function rule(selector: string, declarations: Declarations, indent: string): string {
	const body = cssText(declarations, `${indent}\t`);
	return body === "" ? "" : `${indent}${selector} {\n${body}\n${indent}}`;
}

/**
 * One selector, as a layer under an extra one writes it.
 *
 * Three cases, and each is a different question. `:root` is where the custom
 * properties live, so a scoped layer *replaces* it with its own selector rather
 * than redefining the document's. A style's class is wrapped in `:where()` and
 * has to stay wrapped, or the scoping would give the theme's copy more weight
 * than a node that overrode the style. Everything else is a plain descendant.
 */
function scope(selector: string, under: string | null): string {
	if (under === null) return selector;
	if (selector === ":root") return under;
	const inner = /^:where\((.*)\)$/.exec(selector);
	return inner ? `:where(${under} ${inner[1]})` : `${under} ${selector}`;
}

/** Everything in `next` that `base` does not already say. */
function diff(base: Declarations, next: Declarations): Declarations {
	const out: Declarations = {};
	for (const [key, value] of Object.entries(next)) {
		if (base[key] !== value) out[key] = value;
	}
	// A declaration the base makes and this layer does not has to be unsaid, or
	// the base's value leaks into a layer that never asked for it. `unset` is
	// the closest CSS has to "this layer is silent here".
	for (const key of Object.keys(base)) {
		if (!(key in next)) out[key] = "unset";
	}
	return out;
}

const BASE_CSS = `${CUSTOM_PROPERTY_RULES}
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: #f1f5f9; }
.design {
	position: relative;
	/* A mix mode blends against everything painted below it in the nearest
	   isolation group, and without one that group is the page this file was
	   pasted into. A design defines its own appearance and never borrows the
	   host's — the same sentence DOCUMENT_BASE makes about inheritance, made
	   about compositing. Not *in* DOCUMENT_BASE, which is by its own definition
	   the properties CSS inherits, and isolation is not one of them. */
	isolation: isolate;
	/* A document defines its own appearance; it never inherits the page's —
	   the same declarations the canvas puts on an artboard. */
${cssText(DOCUMENT_BASE, "\t")}
}
.design [data-node] { position: absolute; }
/* A line, an arrow or a path, drawn across its own box. Overflow is visible so
   a thick stroke is not clipped in half along the frame's edge. */
.design .s { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
/* An image fills its node's box, and takes the box's own object-fit — which is
   where the \`fit\` property painted it, so a token or a variant still drives it.
   Inherited explicitly because object-fit does not inherit on its own, and the
   declaration has to live on the box for the property table to reach it. The
   radius likewise, so a rounded image is rounded rather than square pixels
   overflowing a rounded box. */
.design [data-kind="image"] > img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: inherit;
	border-radius: inherit;
}`;

/**
 * True when a kind renders the whitespace between its tags.
 *
 * Read off the paint table rather than named, because the answer is exactly
 * whichever kind was given `white-space: pre-wrap`. Anything under one is
 * emitted on a single line: only a rule can put a child inside a text node, but
 * a rule can, and the pretty-printing would show up as blank lines in the copy.
 */
const keepsWhitespace = (kind: NodeKind): boolean =>
	SHAPE_PAINT[kind]?.box?.whiteSpace?.startsWith("pre") === true;

function htmlBody(
	index: DocIndex,
	slots: readonly Slot[],
	layer: Layer,
	/** The style class each wearer carries beside its own, if any. */
	wearing: Map<string, string>,
	images: Readonly<Record<string, Uint8Array>> = {},
): string {
	const byId = new Map(slots.map((s) => [s.id, s] as const));
	const render = (node: ModelNode, depth: number, pretty: boolean): string => {
		const slot = byId.get(node.id);
		if (!slot) return "";
		const pad = pretty ? "\t".repeat(depth + 2) : "";
		const worn = wearing.get(node.id);
		const names = worn === undefined ? slot.className : `${slot.className} ${worn}`;
		const open = `${pad}<div class="${names}" data-node="${escapeAttr(node.id)}" data-kind="${node.kind}">`;
		const content = htmlContent(index, layer, node, images);
		// A viewport's box is markup and its contents are not — see `stopsHere`.
		// The element is still emitted, still carries its id and its kind, and is
		// still selectable and rule-able by anything the page is pasted into; what
		// stops is the recursion.
		const inside = stopsHere(node.kind) ? [] : node.children;
		const nested = !keepsWhitespace(node.kind) && inside.length > 0;
		const kids = inside
			.map((child) => render(child, depth + 1, nested))
			.filter((markup) => markup !== "");
		if (!nested) return `${open}${content}${kids.join("")}</div>`;
		return [content === "" ? open : `${open}${content}`, ...kids, `${pad}</div>`].join(
			"\n",
		);
	};
	return layer.universe.model.roots
		.map((root) => render(root, 0, true))
		.filter((markup) => markup !== "")
		.join("\n");
}

/** The file, and what it turned out to hold — see {@link ExportResult.lost}. */
interface Emitted {
	text: string;
	/** The styles that came out as classes. */
	classes: StyleClass[];
	/** What this target could not carry about *this* document, if anything. */
	lost: string[];
}

function htmlExport(
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
): Emitted {
	const useTokens = options.tokens !== false;
	const base = layers[0];
	const slots = slotsOf(base.universe.model);
	const slotOf = new Map(slots.map((s) => [s.id, s] as const));
	const used = new Set<string>();
	// Before the layers are read, because a state that names a token has to have
	// added it to `used` by the time `readLayer` writes the `:root` block — that
	// block is built at the end of the base layer's own walk, and a token collected
	// after it would have a `var()` in the file and no definition for it.
	const machines = planMachines(index, base, useTokens, used);
	const classes = styleClasses(index, base);
	/** Which class a wearer carries, for the markup. */
	const wearing = new Map<string, string>();
	for (const cls of classes) {
		for (const id of cls.wearers) wearing.set(id, cls.name);
	}

	/** Every declaration one layer makes, keyed by selector. */
	const readLayer = (layer: Layer): Map<string, Declarations> => {
		const out = new Map<string, Declarations>();
		const origin = modelBounds(layer.universe.model);
		// Per layer, not once, and that is not caution: a breakpoint layer really
		// can lean a card the base does not, because a state and a universe are
		// different questions and the second one re-reads every number.
		const depth = depthOf(layer.universe.model);
		out.set(".design", {
			width: px(origin.width),
			height: px(origin.height),
			...(depth.onDocument === undefined ? {} : { perspective: depth.onDocument }),
		});
		// `:where()`, so a class weighs nothing at all.
		//
		// Source order would be enough for one layer — put the classes first and a
		// wearer's own rule wins — and it is *not* enough for two: a class
		// redefined inside a media query sits after every node's rule, and would
		// beat the node that overrode it above the breakpoint. Zero specificity
		// makes "the node's own value wins" true by construction, in every layer
		// and in both directions, which is what an override has to mean.
		const shared = new Map<string, Set<string>>();
		for (const cls of classes) {
			const rule = classRule(index, layer, cls, useTokens, used);
			out.set(`:where(.${cls.name})`, rule.declarations);
			for (const id of cls.wearers) {
				const taken = new Set<string>();
				for (const prop of cls.worn.get(id) ?? []) {
					for (const key of rule.keys.get(prop) ?? []) taken.add(key);
				}
				shared.set(id, taken);
			}
		}
		const walk = (node: ModelNode, root: boolean): void => {
			const slot = slotOf.get(node.id);
			if (slot) {
				const own: Declarations = {
					...geometry(index, layer, node, root, origin, useTokens, used),
					...declarationsFor(index, layer, node, useTokens, used),
					// The two declarations a turned *descendant* needs from its
					// ancestors — see `depthOf`. Merged after the node's own paint
					// because `perspective` is a `PropName` this file writes itself:
					// nothing in `PAINT` carries it, deliberately, since it means
					// nothing on the canvas and nothing in the program.
					...(depth.preserve.has(node.id) ? { transformStyle: "preserve-3d" } : {}),
					...(depth.perspective.has(node.id)
						? { perspective: depth.perspective.get(node.id) as string }
						: {}),
					// A viewport with a poster shows the frame the canvas last drew,
					// over its own fill rather than instead of it — a poster with
					// transparency is a scene with nothing behind it, and the box's fill
					// is what was behind it on the canvas.
					...posterFor(options, node),
				};
				// Whatever the class already says for a property this node takes
				// from it. Decided by which property it is rather than by comparing
				// the two values, so that turning token names off cannot change the
				// shape of the output — only what the declarations read as.
				for (const key of shared.get(node.id) ?? []) delete own[key];
				out.set(`.${slot.className}`, own);
			}
			if (stopsHere(node.kind)) return;
			for (const child of node.children) walk(child, false);
		};
		for (const root of layer.universe.model.roots) walk(root, true);
		// Custom properties are a layer's own, so a theme is one block of them.
		const custom = customProperties(index, layer.universe.pick, used);
		if (Object.keys(custom).length > 0) out.set(":root", custom);
		return out;
	};

	const baseRules = readLayer(base);

	// The `transition:` a machine wants on a node's base rule, by selector.
	//
	// Kept *beside* `baseRules` rather than merged into it, which looks like
	// bookkeeping and is load-bearing: every collapsed layer below is a `diff`
	// against `baseRules`, and `diff` unsays anything the base holds that the layer
	// does not. A transition merged in before that loop would come out as
	// `transition: unset` in every theme and every breakpoint — the machine and the
	// collapse would eat each other, which is exactly the composition this file
	// promises they do not.
	const paced = new Map<string, Declarations>();
	for (const layer of machines.layers) {
		for (const [id, declarations] of layer.transitions) {
			const slot = slotOf.get(id);
			if (!slot) continue;
			// First state to ask for it wins, in document order. A node two states
			// both move is one element with one base rule, and two `transition`
			// declarations in it would be one declaration: the later one.
			if (!paced.has(`.${slot.className}`)) paced.set(`.${slot.className}`, declarations);
		}
	}
	// The same treatment for a timeline the *drawn* state plays: it has to be
	// running when the file opens, so it goes on the base rule rather than under a
	// `data-state` no runtime has written yet.
	for (const [id, declarations] of machines.playing) {
		const slot = slotOf.get(id);
		if (!slot) continue;
		const selector = `.${slot.className}`;
		paced.set(selector, { ...(paced.get(selector) ?? {}), ...declarations });
	}

	// Every family every layer sets text in, which is more than the base layer's:
	// a collapsed space is one file standing for several designs, and a family
	// only the dark theme uses is a face the file still has to carry. Collected
	// during the walk that is happening anyway rather than by a scan afterwards.
	const families = new Set<string>();
	for (const layer of layers) {
		for (const family of usedFamilies(layer.universe.model)) families.add(family);
	}
	// Unshifted before everything, so a face is declared before `.design` sets a
	// family on anything — see the stylesheet order in `docs/framer-parity-plan.md`
	// §5.6. An `@font-face` is not a rule and takes no part in the cascade, so its
	// position is legibility rather than correctness; a reader looking for what
	// this file weighs finds it at the top, which is where the weight is.
	const css: string[] = [
		...fontFaces(index.scene, families, options.fonts ?? {}),
		BASE_CSS,
	];
	for (const [selector, declarations] of baseRules) {
		const extra = paced.get(selector);
		const block = rule(selector, extra ? { ...declarations, ...extra } : declarations, "");
		if (block) css.push(block);
	}

	for (const layer of layers.slice(1)) {
		const rules = readLayer(layer);
		const inner: string[] = [];
		const indent = layer.media ? "\t" : "";
		for (const [selector, declarations] of rules) {
			const changed = diff(baseRules.get(selector) ?? {}, declarations);
			if (Object.keys(changed).length === 0) continue;
			const block = rule(scope(selector, layer.under), changed, indent);
			if (block) inner.push(block);
		}
		if (inner.length === 0) continue;
		css.push(`/* ${layer.label} */`);
		css.push(
			layer.media ? `@media ${layer.media} {\n${inner.join("\n")}\n}` : inner.join("\n"),
		);
	}

	// Last in the file, and the only rules here with any selector weight at all.
	//
	// A state is meant to beat the picture — that is what "this is what it looks
	// like on hover" means — which is the exact opposite of a style class, whose
	// `:where()` makes it lose to every wearer that overrode it. So these are
	// written plainly, after everything else, and a state under a theme wins over
	// both because it is more specific than the node's own rule and later than the
	// media query.
	for (const layer of machines.layers) {
		const host = slotOf.get(layer.instance);
		if (!host) continue;
		const blocks: string[] = [];
		for (const [id, declarations] of layer.changed) {
			const slot = slotOf.get(id);
			if (!slot) continue;
			const block = rule(`.${host.className}${layer.on} .${slot.className}`, declarations, "");
			if (block) blocks.push(block);
		}
		if (blocks.length === 0) continue;
		css.push(`/* ${layer.label} */`);
		css.push(blocks.join("\n"));
	}

	// After the rules, because a `@keyframes` block is not a rule and does not
	// take part in the cascade at all — it is a named sequence the `animation`
	// declarations above point at, and where it sits in the file changes nothing
	// but where a reader finds it. At the end is where a reader looks for it.
	for (const block of machines.keyframes) css.push(block);

	// The one loss the 3D half of this file owes a document per view, and the one
	// it owes the document once. Collected here rather than in `planMachines`
	// because they are facts about the *picture* — how many objects this universe
	// put in this view, whether anything outside one is turned — and the base
	// layer's model is the picture.
	const spatialLost: string[] = [];
	for (const { node, inside } of viewportsIn(base.universe.model)) {
		spatialLost.push(
			viewportLost(index, node, inside, options.posters?.[node.id] !== undefined),
		);
	}
	if (depthOf(base.universe.model).turned) spatialLost.push(TURNED_LOST);
	spatialLost.push(...missingImages(index, base.universe.model, options.images ?? {}));
	// The typographic pair, in the order a designer reads them: what did not come
	// out, then what did and what it cost. Both are facts about this document
	// rather than about the format, which is why neither is in `EXPORT_TARGETS`.
	spatialLost.push(...missingFaces(index.scene, families, options.fonts ?? {}));
	spatialLost.push(...fontWeightNote(index.scene, families, options.fonts ?? {}));

	const title = escapeText(options.title ?? "Design");
	// At the end of the body, where a script that reads the document has to be:
	// the runtime's first act is one `querySelectorAll("[data-node]")` pass, and in
	// the head it would find nothing. `defer` would work too and would be a second
	// thing to be right about — see `runtime.ts`, which is deliberately a plain
	// ES5 body with no dependency on when it runs beyond the elements existing.
	const script =
		machines.runtime === null ? "" : `\n<script>\n${machines.runtime}\n</script>`;
	return {
		classes,
		lost: [...spatialLost, ...machines.lost],
		text: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${css.join("\n")}
</style>
</head>
<body>
\t<div class="design">
${htmlBody(index, slots, base, wearing, options.images ?? {})}
\t</div>${script}
</body>
</html>
`,
	};
}

/* ------------------------------------------------------------------ */
/* SVG                                                                 */
/* ------------------------------------------------------------------ */

/** Where a text anchor sits for each alignment the document offers. */
const ANCHOR: Record<string, "start" | "middle" | "end"> = {
	left: "start",
	center: "middle",
	right: "end",
};

/**
 * How each property reaches SVG.
 *
 * The second paint table, and the reason there are two: SVG colours a shape
 * with `fill` and text with the same `fill`, has no box to put a background or
 * a border on, and expresses a corner radius as a geometric property of the
 * rectangle. Same shape as {@link PAINT}, keyed the same way, so a new property
 * is one entry here and one there.
 */
const SVG_PAINT: Partial<Record<PropName, (value: string) => Declarations>> = {
	fill: (value) => ({ fill: value }),
	radius: (value) => ({ rx: value, ry: value }),
	stroke: (value) => ({ stroke: value }),
	strokeWidth: (value) => ({ strokeWidth: value }),
	opacity: (value) => ({ opacity: value }),
	ink: (value) => ({ fill: value }),
	fontFamily: (value) => ({ fontFamily: value }),
	size: (value) => ({ fontSize: value }),
	weight: (value) => ({ fontWeight: value }),
	align: (value) => ({ textAnchor: ANCHOR[value] ?? "start" }),
	// SVG has compositing: `mix-blend-mode` is a CSS Compositing property that
	// applies to SVG elements and that the rasterisers this target is written for
	// implement, unlike the CSS filter functions. Carried rather than dropped,
	// because dropping something that works would be the same lie in the other
	// direction, and it is why the svg.loses list has no sentence about mixing.
	mix: (value) => ({ mixBlendMode: value }),
	// shadow: an SVG shadow is a filter, and a filter is not the declaration
	// anyone wrote. Named in EXPORT_TARGETS.svg.loses rather than approximated.
	//
	// blur and backdropBlur: absent for the same reason and a sharper one. A CSS
	// `filter: blur()` is not an SVG filter, so a browser opening this file would
	// blur and a rasteriser reading the same attribute would not — one file, two
	// pictures, decided by who opened it. A backdrop has no SVG reading at all.
	//
	// gradient, gradientFrom, gradientTo: absent from the table and handled after
	// the loop in {@link svgPaint}, because dropping them outright is the one
	// omission in this target that would produce a *wrong* picture rather than a
	// simpler one.
};

/** A shape's own attributes, before anything is painted on it. */
const SVG_SHAPES: Partial<Record<NodeKind, (frame: Frame) => string>> = {
	frame: (f) => `<rect width="${round(f.width)}" height="${round(f.height)}"/>`,
	rect: (f) => `<rect width="${round(f.width)}" height="${round(f.height)}"/>`,
	// A 3D view is a rectangle here and nothing else, which is the same answer
	// the HTML target gives and for the same reason — see `stopsHere`. It is in
	// this table rather than special-cased in `svgNode` because that is what the
	// table is for: a kind whose whole appearance is its own box gets a row.
	viewport: (f) => `<rect width="${round(f.width)}" height="${round(f.height)}"/>`,
	ellipse: (f) =>
		`<ellipse cx="${round(f.width / 2)}" cy="${round(f.height / 2)}" rx="${round(f.width / 2)}" ry="${round(f.height / 2)}"/>`,
};

function svgPaint(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
	useTokens: boolean,
	used: Set<string>,
): Declarations {
	const box: Declarations = {};
	if (KINDS[node.kind].surface) box.fill = "#ffffff";
	for (const prop of KINDS[node.kind].props) {
		const value = node.rendered[prop];
		if (value === undefined) continue;
		const paint = SVG_PAINT[prop];
		if (!paint) continue;
		// The same two front doors {@link declarationsFor} has, and for the same
		// reason — see {@link drawnStateValue}. This twin was left reading the
		// definition's stored value when that hole was closed on the HTML side, so
		// an instance drawn in a state that *repaints* a property named one token in
		// the file and drew a different colour in the picture: `var(--muted)` beside
		// a `#f43f5e` the answer set had already decided. The round-trip test is
		// what catches it, because inlining the var is what makes the two readings
		// comparable at all — and it needed a template whose drawn state repaints
		// something before there was a document to catch it on.
		const said = useTokens
			? drawnStateValue(index, layer.universe.model, node.id, prop)
			: undefined;
		const token = !useTokens
			? undefined
			: said !== undefined
				? valueNamed(index, layer.universe.pick, said.value, said.variable)
				: tokenNamed(index, layer.universe.pick, propVar(node.id, prop));
		if (token) used.add(token.id);
		Object.assign(
			box,
			paint(token ? `var(--${index.custom.get(token.id)})` : cssValue(prop, value)),
		);
	}
	// A gradient flattens to the colour it starts from.
	//
	// An SVG shape has no background, so the CSS `background-image` a gradient
	// becomes says nothing here. Carrying it properly would mean a
	// `<linearGradient>` def per node, built by reading the recipe the designer
	// chose back into an angle and two stops — a second description of the same
	// picture, in a file whose whole promise is that the file *is* the picture,
	// and two descriptions drift the day somebody adds a recipe and forgets the
	// twin.
	//
	// Flattened rather than dropped, and the difference is not tidiness: a node
	// whose fill was cleared and whose paint is entirely a gradient would leave
	// this element with no `fill` at all, and an SVG shape with no fill is
	// **black**. A recognisably wrong colour is a worse answer than a
	// recognisably simpler one, and the loss list says which happened.
	//
	// After the loop, so it beats the node's own fill — the gradient is what you
	// see — and guarded on the recipe, so a node carrying gradient colours with
	// its direction set back to `none` paints its flat fill, which is what the
	// canvas shows.
	//
	// Written as the colour rather than as the `var()` the document named, and it
	// is the one value in this target that is: this is a *flattening* rather than
	// a translation, and naming the token here would claim the file carries a
	// gradient the picture has not got.
	//
	// Guarded on the *kind* as well as on the recipe, which the property loop
	// above gets for free and this does not: `rendered/3` is whatever the answer
	// set says, and a rule or a style variant may put a `gradient` on a text node
	// that has no such row. The loop skips it because it walks
	// `KINDS[kind].props`; here the same list has to be asked, or a paragraph
	// would flatten its ink to a colour it never painted with.
	const recipe = node.rendered.gradient;
	if (
		recipe !== undefined &&
		recipe !== "none" &&
		KINDS[node.kind].props.includes("gradient")
	) {
		const from = node.rendered.gradientFrom;
		if (from !== undefined) box.fill = cssValue("gradientFrom", from);
	}
	return box;
}

/**
 * The number a line height reads as, for the em maths a tspan needs.
 *
 * A ratio, so it is read as itself and never as a length: `1.35` here means
 * 1.35 of the font size, exactly as CSS reads a unitless line-height. A
 * document that stated its leading as a *length* falls back to the default
 * rather than being converted, which is a hole this predates and does not
 * widen — see {@link lineHeightEmu} for the reader that handles both.
 */
function lineHeightOf(node: ModelNode): number {
	const n = Number(node.rendered.lineHeight);
	return Number.isFinite(n) && n > 0 ? n : 1.35;
}

/** `frame` is the node's box in CSS pixels — see {@link svgNode}. */
function svgText(node: ModelNode, frame: Frame, style: string): string {
	const align = node.rendered.align ?? "left";
	const x = align === "center" ? frame.width / 2 : align === "right" ? frame.width : 0;
	const lh = lineHeightOf(node);
	// The first baseline sits half the leading below the top, plus the ascent.
	// In em, so a font size that is itself a custom property still works out.
	const first = (lh - 1) / 2 + 0.8;
	const lines = (node.rendered.text ?? "").split("\n");
	const spans = lines
		.map(
			(line, i) =>
				`<tspan x="${round(x)}" dy="${round(i === 0 ? first : lh)}em">${escapeText(line)}</tspan>`,
		)
		.join("");
	return `<text${style}>${spans}</text>`;
}

function svgNode(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
	useTokens: boolean,
	used: Set<string>,
	depth: number,
	images: Readonly<Record<string, Uint8Array>>,
	clips: string[],
): string {
	const pad = "\t".repeat(depth + 1);
	// The whole of this function is CSS pixels: an SVG user unit is one, given
	// the viewBox `svgExport` writes. Converted here, once, rather than at the
	// eight attributes below.
	const frame = framePx(node.frame);
	const declarations = svgPaint(index, layer, node, useTokens, used);
	const style =
		Object.keys(declarations).length === 0
			? ""
			: ` style="${escapeAttr(cssText(declarations).replace(/\n/g, " "))}"`;

	let own = "";
	const doc = docNode(index, node.id);
	if (node.kind === "image") {
		// `preserveAspectRatio` is SVG's spelling of `object-fit`: slice crops to
		// fill, meet letterboxes inside, and `none` stretches. The mapping is
		// exact, so the two targets show the same picture rather than nearly.
		const url = node.asset === undefined ? undefined : dataUrl(images, node.asset);
		const fit = node.rendered.fit ?? "cover";
		const ratio =
			fit === "stretch"
				? "none"
				: fit === "contain"
					? "xMidYMid meet"
					: "xMidYMid slice";
		own =
			url === undefined
				? ""
				: `<image x="0" y="0" width="${round(frame.width)}" height="${round(frame.height)}" preserveAspectRatio="${ratio}" href="${escapeAttr(url)}"${style}/>`;
	} else if (drawsWords(node)) {
		own = svgText(node, frame, style);
	} else if (isDiagonal(node)) {
		const { y1, y2 } = diagonalRun(frame, doc?.diagonal);
		const head =
			node.kind === "arrow"
				? `<polyline points="${escapeAttr(arrowHead(0, y1, frame.width, y2))}" fill="none" stroke-linecap="round" stroke-linejoin="round"${style}/>`
				: "";
		own = `<line x1="0" y1="${round(y1)}" x2="${round(frame.width)}" y2="${round(y2)}" fill="none" stroke-linecap="round"${style}/>${head}`;
	} else if (isPlotted(node)) {
		const context = { tokens: index.scene.tokens, picks: layer.universe.pick };
		// Scaled straight into pixels, for the reason `htmlContent` gives.
		const d = doc
			? pathData(scalePoints(doc.points ?? [], frameOf(doc, context), frame), doc.closed)
			: "";
		if (d) {
			const closed = doc?.closed ? "" : ' fill="none"';
			own = `<path d="${escapeAttr(d)}"${closed} stroke-linecap="round" stroke-linejoin="round"${style}/>`;
		}
	} else {
		const shape = SVG_SHAPES[node.kind];
		if (shape) own = shape(frame).replace("/>", `${style}/>`);
	}

	// A surface clips what hangs over its edge, exactly as the canvas does —
	// including the rounding, which is why the corner radius comes along and
	// nothing else does.
	let clip = "";
	if (KINDS[node.kind].surface && node.children.length > 0) {
		const id = `clip${clips.length}`;
		const corners: Declarations = {};
		if (declarations.rx !== undefined) {
			corners.rx = declarations.rx;
			corners.ry = declarations.ry ?? declarations.rx;
		}
		const rounded =
			Object.keys(corners).length === 0
				? ""
				: ` style="${escapeAttr(cssText(corners).replace(/\n/g, " "))}"`;
		clips.push(
			`<clipPath id="${id}"><rect width="${round(frame.width)}" height="${round(frame.height)}"${rounded}/></clipPath>`,
		);
		clip = ` clip-path="url(#${id})"`;
	}

	// The same stop the HTML target makes, in the flat target that has even less
	// to say about a scene than a page does.
	const inside = (stopsHere(node.kind) ? [] : node.children).map((child) =>
		svgNode(index, layer, child, useTokens, used, depth + 1, images, clips),
	);
	const kids =
		inside.length === 0 ? "" : `\n${pad}\t<g${clip}>\n${inside.join("\n")}\n${pad}\t</g>`;
	return `${pad}<g transform="translate(${round(frame.x)},${round(frame.y)})" data-node="${escapeAttr(node.id)}" data-kind="${node.kind}">${own}${kids}\n${pad}</g>`;
}

/**
 * SVG, with everything on the element.
 *
 * **A style stays inlined here, and it is not an oversight.** SVG has the
 * cascade — a `<style>` element and a `class` attribute both work in a browser —
 * but an SVG file is read by more than browsers, and the moment one of them
 * (an editor, a rasteriser, a paste into another document) applies the
 * presentation attributes and skips the stylesheet, a class is the difference
 * between a picture and a wireframe. This target's promise is that the file
 * *is* the picture, which is why a shadow is dropped rather than approximated
 * with a filter; a class that might not be applied is the same bargain the
 * other way round. So a style's properties are written onto every element that
 * wears it, the correlation is in the picture and not in the file, and
 * {@link EXPORT_TARGETS} says so out loud.
 */
function svgExport(
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
): Emitted {
	const useTokens = options.tokens !== false;
	const base = layers[0];
	const bounds = modelBounds(base.universe.model);
	const used = new Set<string>();
	const clips: string[] = [];
	const body = base.universe.model.roots
		.map((root) =>
			svgNode(
				index,
				base,
				{ ...root, frame: { ...root.frame, x: root.frame.x - bounds.x, y: root.frame.y - bounds.y } },
				useTokens,
				used,
				0,
				options.images ?? {},
				clips,
			),
		)
		.join("\n");

	const custom = customProperties(index, base.universe.pick, used);
	// `svg` rather than `:root`, so the definitions hold both in a standalone
	// file and when this markup is pasted into an HTML page.
	const definitions =
		Object.keys(custom).length === 0 ? "" : `svg {\n${cssText(custom, "\t")}\n}\n`;
	const style = `\n<style>\n${definitions}text { white-space: pre; }\n</style>`;
	const defs = clips.length === 0 ? "" : `\n<defs>\n\t${clips.join("\n\t")}\n</defs>`;
	const title = options.title ? `\n<title>${escapeText(options.title)}</title>` : "";

	// The viewBox is what makes a user unit a CSS pixel for everything inside.
	const w = cssPx(bounds.width);
	const h = cssPx(bounds.height);
	return {
		classes: [],
		// Nothing conditional: what this target loses about a machine it loses about
		// every machine, so it is one unconditional sentence in `EXPORT_TARGETS`
		// rather than a list assembled per document.
		lost: [],
		// `isolation: isolate` unconditionally, and on the root for the reason
		// `.design` carries it: a multiply near the top of the picture must blend
		// against the design and not against whatever this file was pasted over.
		// Unconditional because a document with no mix mode in it is isolated from
		// a page it composites identically with either way, and a rule that
		// appeared only sometimes would be a file whose shape depended on a
		// property nobody can see in it.
		text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif" fill="#0f172a" style="isolation: isolate">${title}${style}${defs}
${body}
</svg>
`,
	};
}

/* ------------------------------------------------------------------ */
/* The space as one artefact                                           */
/* ------------------------------------------------------------------ */

export type CollapseKind = "theme" | "breakpoint";

export interface Collapse {
	kind: CollapseKind;
	/** The one variable the universes differ by. */
	variable: string;
	/** What to call it. */
	label: string;
	/** The universes, in the order the target wants them. */
	layers: Layer[];
	/** One line explaining what the output is. */
	note: string;
}

export interface NotCollapsible {
	reason: string;
}

/**
 * Where two models disagree about anything but a frame.
 *
 * The id lists are joined on NUL because a node id may be a term with commas in
 * it — `inst(primary,button)` — so any printable separator could make two
 * different lists compare equal. Written as the escape rather than as the byte
 * itself: a raw NUL makes grep treat the whole file as binary and report *no
 * matches* rather than skipping it loudly, which hid this file from every
 * search run across the source.
 */
function sameStructure(a: ModelScene, b: ModelScene): boolean {
	const ids = Object.keys(a.byId).sort();
	if (ids.join("\u0000") !== Object.keys(b.byId).sort().join("\u0000")) return false;
	for (const id of ids) {
		const x = a.byId[id];
		const y = b.byId[id];
		if (x.kind !== y.kind || x.order !== y.order) return false;
		if (x.children.length !== y.children.length) return false;
		for (let i = 0; i < x.children.length; i++) {
			if (x.children[i].id !== y.children[i].id) return false;
		}
		// Content is markup, not CSS, so a layer cannot override it.
		if (x.rendered.text !== y.rendered.text) return false;
	}
	return a.roots.map((r) => r.id).join() === b.roots.map((r) => r.id).join();
}

/** True when every node sits in exactly the same box in both. */
function sameGeometry(a: ModelScene, b: ModelScene): boolean {
	return Object.keys(a.byId).every((id) =>
		DIMENSIONS.every((dim) => a.byId[id].frame[dim] === b.byId[id].frame[dim]),
	);
}

/** The variables the universes do not agree about. */
function disagreements(universes: readonly ExportUniverse[]): string[] {
	const first = universes[0].pick;
	const keys = new Set(universes.flatMap((u) => Object.keys(u.pick)));
	return [...keys].filter((key) =>
		universes.some((u) => u.pick[key] !== first[key]),
	);
}

/**
 * Where the markup itself carries geometry, and so cannot be shared.
 *
 * A line, an arrow and a path draw *inside* their box: the numbers are in the
 * `<line>`'s coordinates and the `<path>`'s `d`, not in a declaration. The
 * markup is emitted once, from the base layer, so a layer that moved one of
 * these would show the base's shape in this layer's frame. Read off
 * `KINDS` — `diagonal` and `plotted` are exactly the two kinds of "its real
 * geometry is not its frame" — so a new kind of either sort is covered without
 * an entry here.
 */
function drawnGeometry(model: ModelScene): ModelNode[] {
	return Object.values(model.byId).filter(
		(node) => KINDS[node.kind].diagonal || KINDS[node.kind].plotted,
	);
}

/**
 * One artefact, themed: the base plus one conditional layer per remaining
 * universe.
 *
 * Two universes are light and dark, because that is the one thing
 * `prefers-color-scheme` asks for, and the caller has already put the lighter
 * one first. More than two has no light and dark to be, so they are named
 * themes instead — calling the third one "dark" would be a lie.
 *
 * Shared by a colour token and a colour-only style, which are the same artefact
 * with the declarations in a different place: a custom property for the token,
 * a class for the style. Both are switched by exactly this selector.
 */
function themeCollapse(
	variable: string,
	label: string,
	ordered: readonly ExportUniverse[],
	subject: string,
): Collapse {
	if (ordered.length === 2) {
		const [light, dark] = ordered;
		return {
			kind: "theme",
			variable,
			label,
			// The preference is a *default*, so it goes on the media query alone;
			// the attribute is the same universe again, so that a page can force
			// either way whatever the browser says.
			layers: [
				{ universe: light, media: null, under: null, label: `${label}: the light value` },
				{
					universe: dark,
					media: "(prefers-color-scheme: dark)",
					under: null,
					label: `${label}: the darker value, when the reader prefers a dark scheme`,
				},
				{
					universe: dark,
					media: null,
					under: '[data-theme="dark"]',
					label: `${label}: the darker value, forced`,
				},
			],
			note: `One artefact, themed on ${subject}: the darker value under prefers-color-scheme: dark, or forced with data-theme="dark".`,
		};
	}
	return {
		kind: "theme",
		variable,
		label,
		layers: ordered.map((universe, i) => ({
			universe,
			media: null,
			under: i === 0 ? null : `[data-theme="alt-${i}"]`,
			label: i === 0 ? `${label}: the default` : `${label}: [data-theme="alt-${i}"]`,
		})),
		note: `One artefact with ${ordered.length} themes on ${subject}, selected with data-theme.`,
	};
}

/**
 * One artefact with a breakpoint: mobile first, the wide design under a query.
 *
 * The width is the one the wide design actually occupies, which is the only
 * number in the document that means anything here — and the same number the
 * direction collapse uses, because it is the same question.
 */
function breakpointCollapse(
	variable: string,
	label: string,
	narrow: ExportUniverse,
	wide: ExportUniverse,
	narrowLabel: string,
	wideLabel: string,
): Collapse {
	// A media query is a statement about the viewport, so this one is in CSS
	// pixels like every other number that leaves this file, and rounded up: at
	// exactly the design's own width the wide layer should already hold.
	const width = Math.ceil(cssPx(modelBounds(wide.model).width));
	return {
		kind: "breakpoint",
		variable,
		label,
		layers: [
			{
				universe: narrow,
				media: null,
				under: null,
				label: `${narrowLabel}: the narrow design, and the base`,
			},
			{
				universe: wide,
				media: `(min-width: ${width}px)`,
				under: null,
				label: `${wideLabel}: from ${width}px, the width the wide design actually needs`,
			},
		],
		note: `One artefact with a breakpoint on ${label}: ${narrowLabel} below ${width}px and ${wideLabel} at or above it.`,
	};
}

/**
 * Whether this space is one artefact rather than N designs.
 *
 * The claim being tested is narrow and worth stating exactly. A document whose
 * universes differ only by layout `direction` *is* a media query; one whose
 * universes differ only by colour *is* a theme; one whose universes differ only
 * by a *style* is whichever of the two the treatment says — see
 * {@link styleCollapse}. All are true, and all stop being true the moment
 * anything else differs — so the test is:
 *
 *   1. the universes differ in exactly one variable;
 *   2. that variable has a meaning the target understands, which today means
 *      a colour token (a theme), a container's direction (a breakpoint), or a
 *      style (either, depending on what its variants disagree about);
 *   3. everything the target cannot express as a variable is identical: the
 *      tree, the paint order, and the text.
 *
 * The second condition is the one that does the work, and it is not a
 * formality. A frame variable — "the panel sits here or there" — passes (1) and
 * (3) and is still *not* soundly one artefact, because nothing in the document
 * says which of the two positions is the narrow screen. Direction is different
 * precisely because `column` means narrow to every designer and every target
 * that has ever had a breakpoint. Where that meaning is missing, this returns
 * the reason instead of guessing, and the caller exports one universe.
 *
 * A colour theme additionally has to leave the geometry alone. It always does —
 * a colour moves nothing — but it is checked rather than assumed, because the
 * check is three lines and the failure mode is an export that silently drops
 * half the positions.
 *
 * A breakpoint, by contrast, is *expected* to move things, and that is sound
 * because every layer re-emits its own boxes: what a layer holds is the diff
 * against the base, so a node that moved arrives as the coordinates the solver
 * worked out for that layer. The one thing a layer cannot re-emit is markup,
 * which is why {@link drawnGeometry} is checked for every collapse.
 */
export function collapseSpace(
	scene: Scene,
	universes: readonly ExportUniverse[],
): Collapse | NotCollapsible {
	if (universes.length < 2) {
		return { reason: "There is only one design here; nothing to collapse." };
	}
	const varying = disagreements(universes);
	if (varying.length === 0) {
		return { reason: "These universes make the same decisions." };
	}
	if (varying.length > 1) {
		return {
			reason: `${varying.length} variables differ across these designs. One artefact can stand for a space only where a single variable separates it — a theme, or a breakpoint — so this exports as one design at a time.`,
		};
	}
	const variable = varying[0];
	const parsed = parseVariable(variable);
	const base = universes[0];

	for (const other of universes.slice(1)) {
		if (!sameStructure(base.model, other.model)) {
			return {
				reason:
					"These designs are different pictures, not one picture in two states — the tree or the text differs, and CSS cannot switch that.",
			};
		}
	}
	for (const node of drawnGeometry(base.model)) {
		const moved = universes
			.slice(1)
			.some((u) =>
				DIMENSIONS.some((dim) => u.model.byId[node.id]?.frame[dim] !== node.frame[dim]),
			);
		if (moved) {
			return {
				reason: `${KINDS[node.kind].label} “${node.id}” is a different size in these designs, and it draws its own geometry inside its box — that markup is written once, so one file cannot hold both. Export a single design instead.`,
			};
		}
	}

	if (parsed?.kind === "token") {
		const token = findToken(scene.tokens, parsed.token);
		if (!token) {
			return { reason: "The varying token is no longer in the document." };
		}
		if (token.type !== "color") {
			return {
				reason: `Only a colour token exports as a theme; “${token.name}” is a ${token.type}. A length that varies changes where things sit, and a stylesheet cannot re-derive the layout from it.`,
			};
		}
		if (universes.slice(1).some((u) => !sameGeometry(base.model, u.model))) {
			return {
				reason: `“${token.name}” moves things as well as colouring them, so the designs are not one artefact in two states.`,
			};
		}
		// Two colours are light and dark, and which is which is not the solver's
		// enumeration order — it is which one is darker, because that is the whole
		// of what `prefers-color-scheme: dark` asks for.
		return themeCollapse(
			variable,
			token.name,
			universes.length === 2 ? byBrightness(scene, universes, parsed.token) : universes,
			`“${token.name}”`,
		);
	}

	if (parsed?.kind === "layout" && parsed.field === "direction") {
		if (universes.length !== 2) {
			return {
				reason:
					"A direction has two values and this space has more than two designs, so there is no pair of breakpoints to map them onto.",
			};
		}
		const words = universes.map((u) => directionOf(scene, u, parsed.node));
		const narrow = words.indexOf("column");
		const wide = words.indexOf("row");
		if (narrow === -1 || wide === -1) {
			return {
				reason:
					"These two designs do not lay out one as a row and the other as a column, so which is the narrow screen is not something the document says.",
			};
		}
		// Mobile first: the column is the base, and the row arrives at the width
		// it actually needs.
		return breakpointCollapse(
			variable,
			LAYOUT_PROPS.direction.label,
			universes[narrow],
			universes[wide],
			"Column",
			"Row",
		);
	}

	if (parsed?.kind === "style") {
		return styleCollapse(scene, parsed.style, variable, universes);
	}

	return {
		reason: `These designs differ only in ${describe(scene, variable)}, and no target has a mechanism for that — a stylesheet has no way to know which of the values is the narrow screen, or the dark one. Export a single design instead.`,
	};
}

/** One property a style's variants disagree about, as the answer sets rendered it. */
interface StyleChange {
	prop: PropName;
	/** The node the reading came from — one that takes this property from the style. */
	node: string;
	/** What it drew with, per universe, in the order they came in. */
	values: string[];
	/**
	 * Everything that node drew with, per universe.
	 *
	 * Kept beside the values because one property cannot always be read on its
	 * own: a line height of 1.35 is a *multiple*, and how much room it asks for
	 * is a fact about the size it multiplies — which the same style may be
	 * changing. See {@link ROOMINESS}.
	 */
	drawn: Array<Partial<Record<PropName, string>>>;
}

/**
 * How much room a property's value asks for — bigger is roomier — or nothing
 * where two of its values cannot be put in that order at all.
 *
 * This is the table the breakpoint collapse turns on, and it is a table rather
 * than a type test because `PROPS[p].type` gets one property wrong and the
 * wrongness is not the type's fault. Every `length` is its own answer: 15px is
 * tighter than 18px, and that is what a type ramp means. A **line height** is
 * typed `number` because it is a ratio and it genuinely is one — making it a
 * length would put `8px` in the inspector's placeholder and let a token of
 * lengths link to it — but the ratio is not the quantity: 1.2 of 24px is 28.8px
 * of leading and 1.5 of 16px is 24px, so the tighter *number* is the roomier
 * *line*. Ordering by what is written is how a real responsive ramp — bigger
 * type, tighter leading — comes out as "the lengths disagree" and refuses.
 *
 * So the entry reads the leading as a length, which is the same arithmetic the
 * text measurement uses, and both halves of such a ramp then agree.
 *
 * Everything here is EMU, and only the *sign* of a difference is ever read —
 * see {@link room} — so the unit matters solely in that all the entries share
 * one. Reading a length with `emuOf` rather than a bare-number parser is what
 * makes `18px` and `0.25in` comparable at all, which a type ramp written in
 * points beside a margin written in pixels needs.
 *
 * Everything else stays out and stays out on purpose: no stylesheet can know
 * which of two weights, two families or two alignments belongs on a narrow
 * screen, and a table with an entry for them would be a guess wearing a number.
 */
const ROOMINESS: Partial<
	Record<PropName, (drawn: Partial<Record<PropName, string>>) => Emu | undefined>
> = {
	...Object.fromEntries(
		PROP_NAMES.filter((prop) => isLengthType(PROPS[prop].type)).map((prop) => [
			prop,
			(drawn: Partial<Record<PropName, string>>) => emuOf(drawn[prop] ?? ""),
		]),
	),
	lineHeight: (drawn) =>
		drawn.lineHeight === undefined
			? undefined
			: lineHeightEmu(drawn.size, drawn.lineHeight),
};

/** How much room one universe's reading asks for, if the property is orderable. */
const roomOf = (change: StyleChange, universe: number): number | undefined =>
	ROOMINESS[change.prop]?.(change.drawn[universe]);

/**
 * What the variants of one style actually disagree about, read off the answer
 * sets rather than off the document.
 *
 * A variant's field is a {@link Term}: it may name a token, or be derived, and
 * two variants naming two tokens that resolve to the same colour do not
 * disagree about anything. `rendered/3` has already settled all of that, so the
 * comparison is between what was *drawn* — and it is taken from a node that
 * takes the property from the style, because a node that overrides it draws its
 * own value and would report no change at all.
 */
function styleChanges(
	scene: Scene,
	style: Style,
	universes: readonly ExportUniverse[],
): StyleChange[] {
	const wearers = flatten(scene.nodes).filter((n) => n.style === style.id);
	const out: StyleChange[] = [];
	for (const prop of styleProps(style)) {
		for (const node of wearers) {
			if (!wornProps(scene, node).includes(prop)) continue;
			const drawn = universes.map((u) => u.model.byId[node.id]?.rendered ?? {});
			const values = drawn.map((rendered) => rendered[prop]);
			if (values.some((v) => v === undefined)) continue;
			const said = values as string[];
			if (new Set(said).size > 1) {
				out.push({ prop, node: node.id, values: said, drawn });
			}
			break;
		}
	}
	return out;
}

/**
 * A style as one artefact — the interesting half of this file.
 *
 * A bare length token is refused as a collapse, and a style whose variants
 * differ in lengths is admitted. That is not a double standard, and the three
 * reasons are worth stating because each of them is checkable:
 *
 *   1. **A style cannot be a coordinate.** `STYLE_PROPS` is the styleable
 *      *properties*, and a property is never a frame dimension nor a layout
 *      setting — so the variable that varies here appears in the output only
 *      inside a class's declarations, never inside a `left`, a `top` or a
 *      `width`. A token can be all of those: point one at a dimension and the
 *      stylesheet would have to re-derive a solved layout from a custom
 *      property, which is exactly the thing CSS cannot do. Every coordinate in
 *      every layer of a style collapse is a literal pixel the solver worked out
 *      *for that layer*.
 *   2. **The treatment is complete.** A variant is one record naming every
 *      field it decides, so both sides of the breakpoint are designs somebody
 *      authored, and the switch is one class redefinition plus the boxes that
 *      moved. Switching one loose length gives a design nobody wrote down.
 *   3. **The document states the order.** One variant asks for less room than
 *      the other everywhere, and the tighter type scale is the narrow screen —
 *      which is what every responsive type ramp there has ever been means. Where
 *      they disagree about which variant is the tighter one, there is no narrow
 *      design to pick and this refuses. How much room a value asks for is
 *      {@link ROOMINESS}, and it is a table because one property's number is not
 *      its size: a line height is a *multiple* of a size the same style may be
 *      changing, so the textbook ramp — bigger type, tighter leading — reads as
 *      a contradiction until the leading is counted in pixels.
 *
 * And where the variants differ only in colour, the same argument makes it a
 * theme instead, ordered by the ground it paints.
 *
 * The limits, all of them:
 *
 *   - two variants for a breakpoint. A third has no pair of screens to be, the
 *     same way a third direction would not;
 *   - at least one *size* has to differ, and the sizes have to agree. A style
 *     that varies only its weight, its family or its alignment carries no claim
 *     about screen width, and is refused rather than guessed at;
 *   - the breakpoint is the width the wide design occupies, so a treatment that
 *     changes only the leading — which moves a column's height and not its
 *     width — comes out as a query at the design's own width. Coarse, and the
 *     same coarseness a radius ramp has always had;
 *   - a wearer that states its own value for a property does not change across
 *     the breakpoint. That is what an override means, and it is visible in the
 *     output: the declaration sits in the node's own rule, not in the class;
 *   - HTML only, like every collapse — see {@link exportSpace}.
 */
function styleCollapse(
	scene: Scene,
	styleId: string,
	variable: string,
	universes: readonly ExportUniverse[],
): Collapse | NotCollapsible {
	const style = findStyle(scene.styles, styleId);
	if (!style) {
		return { reason: "The varying style is no longer in the document." };
	}
	const changes = styleChanges(scene, style, universes);
	if (changes.length === 0) {
		return {
			reason: `Nothing drawn takes anything from “${style.name}” that its variants disagree about, so these designs differ in a decision no stylesheet can see.`,
		};
	}
	const subject = `the style “${style.name}”`;

	// Colour only: a treatment that changes nothing but colour is a theme, and it
	// is the class that is themed rather than a custom property.
	if (changes.every((change) => PROPS[change.prop].type === "color")) {
		if (universes.slice(1).some((u) => !sameGeometry(universes[0].model, u.model))) {
			return {
				reason: `“${style.name}” moves things as well as colouring them, so the designs are not one artefact in two states.`,
			};
		}
		return themeCollapse(
			variable,
			style.name,
			universes.length === 2 ? byTreatment(changes, universes) : universes,
			subject,
		);
	}

	// Otherwise the sizes decide, if they agree.
	const lengths = changes.filter(readable);
	if (lengths.length === 0) {
		const named = changes
			.map((change) => PROPS[change.prop].label.toLowerCase())
			.join(", ");
		return {
			reason: `The variants of “${style.name}” differ in ${named}, and none of that is a size. A stylesheet has no way to know which of two weights or two families is the narrow screen, so this exports as one design at a time.`,
		};
	}
	if (universes.length !== 2) {
		return {
			reason: `“${style.name}” has ${universes.length} treatments in play and a breakpoint has two sides, so there is no pair of screens to map them onto.`,
		};
	}
	const ways = new Set(
		lengths.map((change) => Math.sign(room(change, 1) - room(change, 0))),
	);
	if (ways.size !== 1) {
		return {
			reason: `The sizes in “${style.name}” disagree about which treatment is the tighter one — one of them grows where another shrinks — so neither variant is the narrow screen.`,
		};
	}
	const [narrow, wide] = ways.has(1) ? [0, 1] : [1, 0];
	return breakpointCollapse(
		variable,
		style.name,
		universes[narrow],
		universes[wide],
		variantLabel(style, universes[narrow].pick[variable] ?? 0),
		variantLabel(style, universes[wide].pick[variable] ?? 0),
	);
}

/** How much room a reading asks for, and 0 where it asks for nothing legible. */
const room = (change: StyleChange, universe: number): number =>
	roomOf(change, universe) ?? 0;

/** True where every universe's reading of this property is an amount of room. */
const readable = (change: StyleChange): boolean =>
	change.drawn.every((_, universe) => roomOf(change, universe) !== undefined);

/**
 * Two universes, the lighter treatment first.
 *
 * The *ground* decides where the treatment paints one, and which property is
 * the ground is read off the paint table rather than named here: it is
 * whichever one becomes a `background`. Absent a ground the ink decides, and it
 * reads the other way round — a dark theme is dark behind *light* text, so the
 * variant with the brighter ink is the dark one. Getting that inversion wrong
 * would put the light design under `prefers-color-scheme: dark`, which is the
 * one failure this function exists to prevent.
 */
function byTreatment(
	changes: readonly StyleChange[],
	universes: readonly ExportUniverse[],
): readonly ExportUniverse[] {
	const ground = changes.find((change) => {
		const paint = PAINT[change.prop];
		return paint !== undefined && "background" in paint("");
	});
	const [a, b] = (ground ?? changes[0]).values.map(luminance);
	if (a === undefined || b === undefined) return universes;
	const brighter = b > a ? [universes[1], universes[0]] : universes;
	return ground ? brighter : [brighter[1], brighter[0]];
}

/**
 * Two universes, lighter first.
 *
 * Which of two colours belongs in the dark branch is a question about the
 * colours and not about the order the solver happened to enumerate them in. A
 * value nothing can read a luminance from keeps the order it came in, because
 * guessing would be worse than the arbitrary answer.
 */
function byBrightness(
	scene: Scene,
	universes: readonly ExportUniverse[],
	tokenId: string,
): readonly ExportUniverse[] {
	const shade = (u: ExportUniverse): number | undefined => {
		const value = resolveValue(
			{ tokens: scene.tokens, picks: u.pick },
			findToken(scene.tokens, tokenId)?.value,
			tokenVar(tokenId),
		);
		return value === undefined ? undefined : luminance(value);
	};
	const [a, b] = [shade(universes[0]), shade(universes[1])];
	if (a === undefined || b === undefined) return universes;
	return b > a ? [universes[1], universes[0]] : universes;
}

/** Which way a container flows in one universe, read the way the program does. */
function directionOf(
	scene: Scene,
	universe: ExportUniverse,
	nodeId: string,
): string | undefined {
	const node = flatten(scene.nodes).find((n) => n.id === nodeId);
	const value = node?.layout?.direction;
	return resolveValue(
		{ tokens: scene.tokens, picks: universe.pick },
		value,
		layoutVar(nodeId, "direction"),
	);
}

/** A phrase for a variable, for the refusals. */
function describe(scene: Scene, variable: string): string {
	const parsed = parseVariable(variable);
	if (!parsed) return variable;
	if (parsed.kind === "token") {
		return `the token “${findToken(scene.tokens, parsed.token)?.name ?? parsed.token}”`;
	}
	if (parsed.kind === "prop") {
		return `${parsed.node}’s ${PROPS[parsed.prop as PropName]?.label.toLowerCase() ?? parsed.prop}`;
	}
	if (parsed.kind === "frame") {
		return `where ${parsed.node} sits (${FRAME_DIMS[parsed.dim as Dimension]?.label ?? parsed.dim})`;
	}
	if (parsed.kind === "layout") {
		return `${parsed.node}’s ${LAYOUT_PROPS[parsed.field as LayoutProp]?.label.toLowerCase() ?? parsed.field}`;
	}
	if (parsed.kind === "guide") {
		// A line's field is `at(g1)`, which names no row of the settings table; the
		// phrase then falls back to the guide's own name, which is what a refusal
		// about it should say anyway.
		const guide = guideAtIn(parsed.field);
		return guide === undefined
			? `${parsed.node}’s ${GUIDE_PROPS[parsed.field as GuideProp]?.label.toLowerCase() ?? parsed.field}`
			: `${parsed.node}’s guide ${guide}`;
	}
	if (parsed.kind === "style") {
		return `the style “${findStyle(scene.styles, parsed.style)?.name ?? parsed.style}”`;
	}
	return `the value of rule ${parsed.constraint}`;
}

/* ------------------------------------------------------------------ */
/* A state, as a selector                                              */
/* ------------------------------------------------------------------ */

/*
 * **Why this is not `collapseSpace`, and must never be routed through it.**
 *
 * The two mechanisms both end up emitting extra CSS rules on top of a base
 * layer, which is the whole of what they have in common, and it is a coincidence
 * of the medium rather than a shared idea. Collapsing a space takes N *universes*
 * — N different answers to a question the document asked, each a complete design
 * — and folds them into one file under a condition the browser evaluates
 * (`prefers-color-scheme`, a width). It is allowed to do that only where the
 * document says which universe is which, which is why `collapseSpace` spends most
 * of its length refusing.
 *
 * A machine's states are not universes and there is nothing to refuse. Every
 * state of every instance is already in the *one* answer set beside the picture —
 * that is the invariant the whole feature is built on, see `machines.ts` — so
 * there is no choice being folded, no variable being switched, and no question
 * about which state is "the narrow one". The states of an instance are a matrix
 * cell beside its variant, not a point in a product of universes, and the two
 * compose exactly because they are separate: a themed export of a document with a
 * hover state has a media query *and* a `:hover` rule, and neither eats the
 * other.
 *
 * Stretching one mechanism over both would have broken the honest half. A state
 * routed through `collapseSpace` would have to pass `disagreements()`, which
 * compares `pick`s — and a state changes no pick at all, so every state would
 * read as "these universes make the same decisions" and collapse to nothing. Made
 * to pass, it would then have to be *refused* wherever the space is genuinely not
 * collapsible, which would mean a document that cannot be themed also cannot
 * hover. There is no version of one function that is right about both.
 *
 * So: two mechanisms, one file, and the layering below is deliberate. The base
 * rules are the picture. The collapse's layers, if any, are conditional
 * *redefinitions* of that picture. The state rules come last and are the only
 * thing in the file with real selector weight, because a state is meant to win
 * over whatever the picture currently says — which is the exact opposite of what
 * a style class is for, and why they are wrapped in `:where()` and these are not.
 */

/**
 * One state of one machine, as the selector a stylesheet switches on.
 *
 * Not a {@link Layer}: a layer is a whole universe under a media query, and a
 * state is the same universe under a different selector on one element.
 */
export interface StateLayer {
	machine: string;
	/** The instance's node id, whose element carries the selector. */
	instance: string;
	state: string;
	/**
	 * Which layer of the machine this state belongs to.
	 *
	 * A machine is in one state **per layer**, all at once, so an instance's
	 * element carries one attribute per layer and a state's selector has to say
	 * which one it is switching on. A machine the document gave no layers has
	 * exactly one, called `base`, which {@link machineLayers} mints — so this
	 * field is never empty and a one-layer document reads as the un-layered one
	 * it is.
	 */
	layer: string;
	/**
	 * What is appended to the instance's own class selector: `":hover"`,
	 * `":active"`, `":focus-visible"`, `'[data-state="open"]'`, or
	 * `'[data-state-glow="lit"]'` for a layer that is not the first.
	 *
	 * The first layer writes plain `data-state` and every further one writes
	 * `data-state-<layer>`, which is exactly what the emitted runtime does — and
	 * the asymmetry is the whole reason it does: a one-layer file is byte
	 * identical to the one that shipped before layers existed.
	 */
	on: string;
	/** Per node id, only what this state changes from the base. */
	changed: Map<string, Declarations>;
	/** `transition:` to put on each changed node's *base* rule. */
	transitions: Map<string, Declarations>;
	label: string;
}

export interface MachineExport {
	layers: StateLayer[];
	/**
	 * The `@keyframes` blocks a timeline came out as, ready to be written into
	 * the stylesheet — one per (instance, timeline, part).
	 *
	 * Beside {@link layers} rather than inside one, because a `@keyframes` block
	 * is not a rule and has no selector: it is a *named* thing the `animation`
	 * declaration on a state's rule points at, and it has to be written once at
	 * the top level however many states or layers reference it.
	 */
	keyframes: string[];
	/**
	 * `animation:` for a node the *drawn* state animates, by node id.
	 *
	 * Beside {@link layers} for the reason {@link StateLayer.transitions} is: it
	 * belongs on the node's own base rule, and merging it into the base
	 * declarations before the collapse's `diff()` runs would have every theme and
	 * every breakpoint say `animation: unset` — the machine and the collapse
	 * eating each other, which is exactly the composition this file promises they
	 * do not.
	 */
	playing: Map<string, Declarations>;
	/** The `<script>` body, or null where every state is a pseudo-class. */
	runtime: string | null;
	/** What the file does not carry — appended to {@link ExportResult.lost}. */
	lost: string[];
}

/**
 * Which pseudo-class a state collapses to, or nothing where it needs the script.
 *
 * The test is deliberately strict, and every clause of it is protecting the same
 * claim: that `.n6:hover .n7 { … }` is *the whole behaviour*, with nothing left
 * over that a reader of the file would have to be told about. CSS has no memory,
 * so a pseudo-class can only stand for a state the browser is already tracking
 * for us — which means the state has to be entered exactly one way, left exactly
 * one way, and the two ways have to be the two halves of one condition.
 *
 *   - **exactly one enabled edge in, from the base state, on a trigger CSS has a
 *     name for.** Two ways in means the state is reached from somewhere the
 *     pseudo-class knows nothing about.
 *   - **exactly one enabled edge out, back to the base state, on that trigger's
 *     pair.** `pointerenter` in and `click` out is a state you enter by hovering
 *     and leave by clicking, and `:hover` would leave it the moment the pointer
 *     did — which is a different machine from the one that was drawn.
 *   - **nothing else touches it.** Any other edge is behaviour the file would be
 *     silently dropping.
 *
 * `TRIGGERS[g].css` and `.pair` are read off the table rather than decided here,
 * so a new trigger with a pseudo-class is one entry in `scene.ts` and no change
 * at all in this file.
 */
function pseudoClassFor(
	machine: Machine,
	layer: string,
	base: string,
	state: string,
): string | null {
	// This layer's own edges, and only its own. A cross-layer edge is a thing the
	// program reports (`mcrosslayer/2`) and the runtime table leaves out, so
	// counting one here would refuse a collapse on the strength of an edge that
	// cannot fire — and on a one-layer machine the filter is the identity, which
	// is why every existing file is byte for byte what it was.
	const own = layerStates(machine, layer).map((s) => s.id);
	const enabled = machine.transitions.filter(
		(t) => t.enabled && own.includes(t.from) && own.includes(t.to),
	);
	const into = enabled.filter((t) => t.to === state);
	const outOf = enabled.filter((t) => t.from === state);
	if (into.length !== 1 || outOf.length !== 1) return null;
	const [enter] = into;
	const [leave] = outOf;
	if (enter.from !== base || leave.to !== base) return null;
	const spec = TRIGGERS[enter.trigger];
	if (spec.css === null || spec.pair !== leave.trigger) return null;
	return `:${spec.css}`;
}

/**
 * Everything one state copy paints, with a token the document named kept as one.
 *
 * The twin of {@link declarationsFor}, over a {@link ModelState} instead of a
 * {@link ModelNode}, and it is a second function rather than a shared one for a
 * reason that is not laziness: a state copy has no kind of its own — the copy is
 * a parallel *description*, and what it is is decided by the definition part,
 * which is a node of the picture and already says so — and it looks its token
 * names up in two places rather than one.
 *
 * Those two places are the whole of the invariant, showing through at the export:
 *
 *   - a property the state's delta answers has its own variable,
 *     `sprop(I,S,N,P)`, and the name is read from the delta's own {@link Value};
 *   - a property the state says nothing about is read from the *instance's* one
 *     shared `prop(inst(I,N),P)` — the same variable every other state of the
 *     same instance reads, which is why four states of a two-alternative fill are
 *     two designs and not sixteen.
 *
 * Getting that order wrong in either direction is a wrong file rather than an
 * untidy one: reading the instance's variable for a property the state overrode
 * would name the token the *base* wears while writing the state's colour beside
 * it, which is a stylesheet that lies about its own design system.
 *
 * The kind's constant furniture — {@link SURFACE_BOX}, a shape's `box` — is
 * deliberately absent. Every copy of one part has the same kind and so the same
 * furniture, so it is identical on both sides of every diff this feeds and would
 * cancel; and the base rule the state sits on top of already carries it.
 */
function copyPaint(
	index: DocIndex,
	layer: Layer,
	kind: NodeKind,
	instance: string,
	part: string,
	state: string,
	delta: StatePart | undefined,
	copy: ModelState,
	useTokens: boolean,
	used: Set<string>,
): Declarations {
	const out: Declarations = {};
	for (const prop of KINDS[kind].props) {
		const value = copy.rendered[prop];
		if (value === undefined) continue;
		const paint = paintFor(kind, prop);
		if (!paint) continue;
		const said = delta?.props?.[prop];
		const token = !useTokens
			? undefined
			: said !== undefined && said.length > 0
				? valueNamed(
						index,
						layer.universe.pick,
						said,
						statePropVar(instance, state, part, prop),
					)
				: tokenNamed(
						index,
						layer.universe.pick,
						propVar(instancePart(instance, part), prop),
					);
		if (token) {
			used.add(token.id);
			Object.assign(out, paint(`var(--${index.custom.get(token.id)})`));
		} else {
			Object.assign(out, paint(cssValue(prop, value)));
		}
	}
	return out;
}

/**
 * Which CSS properties a transition names, filtered by the transition's `only`.
 *
 * `display` is struck out unconditionally and that is not a filter, it is the
 * truth: there is nothing between shown and not shown to interpolate, so naming
 * it would produce a `transition` declaration a browser ignores and a reader
 * believes. The loss says so out loud instead.
 *
 * An `only` list is {@link PropName}s and the changed set is CSS keys, so the
 * translation goes through {@link paintFor} — the same table the declarations
 * came out of, asked the same question — rather than through a second mapping
 * that could disagree with the first. Geometry survives no `only` list at all,
 * because a frame dimension is not a `PropName` and never will be: "only tween
 * the fill" is a sentence about paint, and a designer who wrote it did not mean
 * to keep the box moving.
 */
function tweenedKeys(
	kind: NodeKind,
	only: readonly PropName[] | undefined,
	changed: Declarations,
): string[] {
	// `animation` is struck out beside `display` and for a sibling reason: it is
	// not a value between two states, it is a *schedule*, and `transition:
	// animation` is a declaration a browser ignores and a reader believes. What
	// paces a timeline is the timeline.
	//
	// `background-image` is the third, and it is the gradient's own limitation:
	// CSS does not interpolate one background image into another, it swaps them
	// at the halfway point however long the transition says. Naming it would be a
	// declaration a browser accepts, does nothing visible with, and a reader
	// believes — `display`'s reason exactly. The gradient's two *colours* are not
	// struck out, because they are registered custom properties with a `<color>`
	// syntax and genuinely tween: a change of colour is smooth and a change of
	// direction is a cut, which is what the loss beside this says out loud.
	const keys = Object.keys(changed).filter(
		(key) => key !== "display" && key !== "animation" && key !== "backgroundImage",
	);
	if (only === undefined) return keys.map(cssName);
	const allowed = new Set<string>();
	for (const prop of only) {
		const paint = paintFor(kind, prop);
		if (paint) for (const key of Object.keys(paint(""))) allowed.add(key);
	}
	return keys.filter((key) => allowed.has(key)).map(cssName);
}

/** A whole number of milliseconds as CSS writes one. */
const ms = (n: number): string => `${Math.round(n)}ms`;

/**
 * How long a transition takes in *this* universe, and how it is paced.
 *
 * The answer set first, the document second, and the order matters: a duration
 * is a {@link Value}, so it may name a `duration` token whose alternatives the
 * solver picked between, and `mdur/3` is that pick resolved. The document reader
 * is the fallback for an answer set that was asked for without `scenery` — the
 * same reading, arrived at without the solver — rather than a second opinion.
 */
function pacing(
	model: ModelScene,
	machine: Machine,
	transition: Transition,
	picks: Picks,
	tokens: readonly Token[],
): { duration: number; delay: number; stagger: number; easing: string } {
	const said = model.machines[machine.id];
	const context = { tokens, picks };
	const read = (prop: "duration" | "delay" | "stagger"): number =>
		said?.[prop][transition.id] ?? motionMs(machine, transition, prop, context);
	return {
		duration: read("duration"),
		delay: read("delay"),
		stagger: read("stagger"),
		easing: EASINGS[transition.easing ?? DEFAULT_EASING].css,
	};
}

/**
 * The edge a state is entered by, which is the one whose pacing the file writes.
 *
 * Preferring the edge from the base state because that is the move a reader of
 * the exported page will actually make: the base is what the file draws, so
 * "going into hover" is the transition being described. Anything else entering
 * the state is a fallback so that a state reached only from elsewhere still gets
 * paced rather than snapping.
 */
function entryEdge(
	machine: Machine,
	base: string,
	state: string,
): Transition | undefined {
	const enabled = machine.transitions.filter((t) => t.enabled && t.to === state);
	return enabled.find((t) => t.from === base) ?? enabled[0];
}

/** True where a kind draws its real geometry inside its box — see {@link drawnGeometry}. */
const drawsOwnGeometry = (kind: NodeKind): boolean =>
	KINDS[kind].diagonal || KINDS[kind].plotted;

/** A phrase for a node in the losses: its name where the document has one. */
function nodeLabel(index: DocIndex, id: string): string {
	const doc = docNode(index, id);
	return doc ? `${KINDS[doc.kind].label} “${doc.name}”` : `“${id}”`;
}

/**
 * Every machine in the document, as selectors over the base layer.
 *
 * The signature this file's callers use is {@link exportMachines}; this is the
 * same work with the two things the HTML emitter has and a bare caller does not —
 * whether token names are wanted, and the set of tokens the file has ended up
 * using, which a state naming one has to be able to add to. Splitting them is
 * what keeps `used` a single set: a `duration` token pointed at by a hover state
 * has to reach `:root` like any other, and a second collection reconciled
 * afterwards is how one would go missing.
 */
function planMachines(
	index: DocIndex,
	base: Layer,
	useTokens: boolean,
	used: Set<string>,
): MachineExport {
	const model = base.universe.model;
	const layers: StateLayer[] = [];
	const played: Played = { keyframes: [], playing: new Map(), names: new Set() };
	const lost: string[] = [];
	const say = (line: string): void => {
		if (!lost.includes(line)) lost.push(line);
	};
	let scripted = false;
	const context = { tokens: index.scene.tokens, picks: base.universe.pick };

	for (const node of instanceNodes(index.scene)) {
		const machine = machineForNode(index.scene, node);
		if (!machine || machine.states.length === 0) continue;
		if (!model.byId[node.id]) continue;
		const stack = machineLayers(machine);
		const drawn = drawnStates(model, machine, node, stack[0].id);

		for (const [index_, stratum] of stack.entries()) {
			const drawnIn = drawn[stratum.id];
			// A layer with no states at all is a layer somebody has just added. There
			// is nothing to draw it in and nothing to switch to, and `shownStates`
			// says so by leaving it out rather than by naming nothing.
			if (drawnIn === undefined) continue;
			const first = index_ === 0;
			const init = layerInitial(machine, stratum.id)?.id;
			// The state the *picture* is in, which is the state this file's own rules
			// are. §8.1 of the spec asks for the machine's initial state instead and
			// re-seated base rules to get there; this does the nearer-correct thing and
			// says so. Two reasons, and the second is the one that decided it. A file
			// whose base is a state the runtime immediately writes over shows the wrong
			// design until the script runs, which is a flash of the wrong colour on
			// every load. And where the two differ the collapse to a pseudo-class is not
			// available anyway — `:hover` can add a state to what is drawn, never
			// subtract one — so re-seating would have bought a flash and nothing else.
			// Where the instance is drawn in the initial state, which is every document
			// that does not say otherwise, the two readings are the same reading.
			if (init !== undefined && drawnIn !== init) {
				say(
					`“${node.name}” is drawn in ${stateName(machine, drawnIn)}, so that is the state this file's own rules are and the one it starts in. Every other state of “${machine.name}” — the machine's initial one included — is a data-state rule rather than a pseudo-class, because a selector can add to what is drawn and cannot subtract from it.`,
				);
			}

			for (const state of layerStates(machine, stratum.id)) {
				// The timeline first, because what it comes to is an `animation`
				// declaration on the same elements the delta paints — so it is one more
				// thing this state changes, and a state that changes *only* an
				// animation is still a state the file has to be able to select.
				const played_ = playTimelines(base, machine, node, state, context, played, say);
				if (state.id === drawnIn) {
					// The state the picture is in has no selector of its own — it is what
					// the base rules are — so an animation it plays goes on the base rule
					// and is running the moment the file opens.
					for (const [id, declarations] of played_) {
						played.playing.set(id, { ...(played.playing.get(id) ?? {}), ...declarations });
					}
					continue;
				}
				const layer = stateLayerFor(
					index,
					base,
					machine,
					node,
					stratum.id,
					first,
					drawnIn,
					state,
					useTokens,
					used,
					say,
					played_,
				);
				if (!layer) continue;
				if (!layer.on.startsWith(":")) scripted = true;
				layers.push(layer);
			}
		}
	}

	return {
		layers,
		keyframes: played.keyframes,
		playing: played.playing,
		// One script for the whole document, or none at all. The table already holds
		// every machine, so a second data-state layer costs nothing; and a document
		// whose states all collapsed to pseudo-classes gets no `<script>` tag,
		// which is the case the pseudo-class rules exist to produce.
		//
		// **The universe's own context**, and it is the same `context` the exit-time
		// sentence a few lines up already reads with. Built without one, the table's
		// only resolved number — an edge's exit time — silently became zero wherever
		// a document paced its debounce with a `duration` token, so this file
		// announced a wait in its losses and shipped a runtime that did not wait.
		// One reading, one answer.
		runtime: scripted ? runtimeScript(machineTable(index.scene, context)) : null,
		lost,
	};
}

/**
 * Which state each layer of one instance is drawn in.
 *
 * Three sources, and the order is the whole of what makes a layered document and
 * a document that has never heard of layers both come out right.
 * `ModelScene.shownByLayer` is the answer set's own per-layer record and wins
 * outright where it is there — it is what `mslayer/3` and `shown/2` came to
 * together, and it is the only one of the three that can report a machine whose
 * layers a *rule* moved. Where it is not — a caller holding a model it wrote out
 * by hand, or one read before layers existed — the document's own
 * {@link shownStates} stands in, with `ModelScene.shown` laid over the first
 * layer because that is the field every reader written before layers is asking
 * about and the one the alias rules actually folded into the picture.
 *
 * Deliberately not a merge of all three: a `shown` that disagreed with a
 * `shownByLayer` would be one answer set contradicting itself, and picking
 * through it here would hide that rather than let a reader see it.
 */
function drawnStates(
	model: ModelScene,
	machine: Machine,
	node: SceneNode,
	first: string,
): Record<string, string> {
	const byLayer = model.shownByLayer?.[node.id];
	if (byLayer !== undefined && Object.keys(byLayer).length > 0) return byLayer;
	const drawn = shownStates(machine, node);
	const shown = model.shown[node.id] ?? shownState(machine, node);
	return { ...drawn, [first]: shown };
}

/** One instance in one state, or nothing where the state changes nothing at all. */
function stateLayerFor(
	index: DocIndex,
	base: Layer,
	machine: Machine,
	instance: SceneNode,
	stratum: string,
	first: boolean,
	drawnIn: string,
	state: MachineState,
	useTokens: boolean,
	used: Set<string>,
	say: (line: string) => void,
	/** The `animation:` this state's timeline turns on, by node id — see {@link playTimelines}. */
	animations: ReadonlyMap<string, Declarations>,
): StateLayer | null {
	const model = base.universe.model;
	const changed = new Map<string, Declarations>(
		[...animations].map(([id, declarations]) => [id, { ...declarations }] as const),
	);
	const hiddenHere: string[] = [];

	// Whatever the answer set holds a copy of, which is the materialisation
	// analysis's answer arrived at from the other end. Reading `model.states`
	// rather than re-running `materializedParts` is deliberate: a hand-written rule
	// may describe a copy the analysis never minted, and the file should carry what
	// the picture actually says rather than what the document predicted it would.
	for (const copy of Object.values(model.states)) {
		if (copy.instance !== instance.id || copy.state !== state.id) continue;
		const nodeId = instancePart(instance.id, copy.part);
		const drawn = model.byId[nodeId];
		const from = model.states[statePart(instance.id, drawnIn, copy.part)];
		if (!drawn || !from) {
			// Two ways to get here and they share a cause — the part is not in the
			// picture, and a selector can restyle an element but cannot write one —
			// and then part company over what a person can do about it.
			//
			// The first way is the common one and it is the spec's own headline
			// example: the state this file is drawn in *hides* the part, so a
			// dropdown drawn in `closed` has no panel in its markup and its `open`
			// state finds nothing to restyle. The whole machine then exports inert,
			// which is a bad way to learn that the file is written from one state. It
			// has a one-click answer — draw the use in the state that shows the most
			// — so the loss says it rather than leaving a reader to deduce it.
			//
			// The second is a copy a rule minted for a part the instance does not
			// draw at all. There is nothing to re-seat and no state that would help,
			// so it gets the bare sentence.
			const hiddenThere = from?.hidden === true;
			say(
				`${stateName(machine, state.id)} describes “${copy.part}” of “${instance.name}”, which this design is not drawing. A selector can restyle an element and cannot write one, so that part of the state is not in the file.` +
					(hiddenThere
						? ` ${stateName(machine, drawnIn)} — the state this use is drawn in — takes it out of the picture, and the markup is written from that state. Draw this use in a state that shows “${copy.part}” and the rest of the machine follows it into the file.`
						: ""),
			);
			continue;
		}
		if (copy.hidden) {
			changed.set(nodeId, { display: "none" });
			hiddenHere.push(nodeId);
			continue;
		}
		const delta = state.parts[copy.part];
		if (!index.byId.has(copy.part)) {
			// A part the document has no node for: a rule minted this copy, and a
			// rule can do that — `frame(stt(i1,hover,x),y,10)` is as legal as any
			// other fact. What it cannot do is bring a *name* with it. Every token
			// name in this file is read back out of the document, because the program
			// interns literals and by the time a colour reaches `rendered/3` it is a
			// hex code; a copy the document has no account of therefore exports as
			// the literal. The same loss `ModelScene.wears`' derived wearers take,
			// one mechanism over.
			say(
				`${stateName(machine, state.id)} describes “${copy.part}”, which a rule made rather than the document. Its values are in the file as the literals they resolved to: there is no stored value to read a token name off, so a link to a token is not in this file under that name.`,
			);
		}
		// Asked before anything is diffed, because the answer is a fact about the
		// *document* rather than about the declarations — and because a state that
		// changes only the wording produces no declarations at all, so a check made
		// after the diff would fall silent in exactly the case it exists for.
		if ((delta?.props?.text?.length ?? 0) > 0) {
			say(
				`${stateName(machine, state.id)} changes the words in ${nodeLabel(index, nodeId)}. Text is markup and not a declaration — a selector can restyle an element and cannot rewrite it — so the file holds the wording the picture was drawn with.`,
			);
		}
		if (retypes(index, state, copy.part)) {
			say(
				`${stateName(machine, state.id)} restyles the words in ${nodeLabel(index, nodeId)}, and the file carries the box they come to in that state. What it does not carry is the frame around them: a container is not re-hugged per state, so words that outgrow their parent overflow it here exactly as they do on the canvas.`,
			);
		}
		const before = copyPaint(
			index,
			base,
			drawn.kind,
			instance.id,
			copy.part,
			drawnIn,
			machine.states.find((s) => s.id === drawnIn)?.parts[copy.part],
			from,
			useTokens,
			used,
		);
		const after = copyPaint(
			index,
			base,
			drawn.kind,
			instance.id,
			copy.part,
			state.id,
			delta,
			copy,
			useTokens,
			used,
		);
		const declarations = diff(before, after);

		const moved = DIMENSIONS.some((dim) => copy.frame[dim] !== from.frame[dim]);
		// The box moving and the box turning are two questions, and only the first
		// one is a problem for a kind that draws its own geometry: a `<line>`'s
		// coordinates are a function of its box, so a rule that resized the box
		// would slide the frame out from under a shape written once — but a
		// rotation and a lift leave the box exactly where it was and are a
		// `transform` on the element, which works on a line as well as on anything
		// else. So the refusal below is keyed on `moved` alone, and a turned arrow
		// falls through to the branch that writes the pose.
		if (moved && drawsOwnGeometry(drawn.kind)) {
			// The one geometry a class cannot carry, and it is named rather than
			// approximated for the same reason `collapseSpace` refuses it: a line, an
			// arrow and a path put their numbers in the markup — a `<line>`'s
			// coordinates, a `<path>`'s `d` — and the markup is written once, from
			// the picture. A rule that moved the box would slide the frame out from
			// under a shape that stayed where it was drawn.
			say(
				`${stateName(machine, state.id)} moves ${nodeLabel(index, nodeId)}, and a line, an arrow and a path draw their own geometry inside their box — that markup is written once, so this state is in the file as a class that cannot move it.`,
			);
		} else {
			// Unconditional, where it used to ask `moved` again: the box moving is
			// no longer the only way a pose can differ — a state may lift a part in
			// z or lean it without touching any of the four numbers — and
			// `moveDeclarations` already answers with nothing where nothing changed.
			Object.assign(declarations, moveDeclarations(from, copy));
		}
		if (Object.keys(declarations).length === 0) continue;
		// Merged rather than set, because the animation this state turns on is
		// already in here and is a declaration about the same element. The delta
		// wins where the two name one property, which is the right way round: a
		// timeline is what happens on the way in, a delta is what it settles at.
		changed.set(nodeId, { ...(changed.get(nodeId) ?? {}), ...declarations });
	}

	if (changed.size === 0) return null;
	if (hiddenHere.length > 0) {
		say(
			`${stateName(machine, state.id)} takes ${hiddenHere.map((id) => nodeLabel(index, id)).join(", ")} out of the picture. display:none is in the file and it is instant: there is nothing between shown and not shown for a transition to tween, however long the transition says.`,
		);
	}

	// The attribute the runtime actually writes, which is `data-state` for the
	// first layer and `data-state-<layer>` for every other one — see
	// `attributeOf` in `runtime.ts`, which is the other half of this and must not
	// be able to disagree with it. A one-layer machine therefore emits exactly the
	// selector it emitted before layers existed.
	const on =
		pseudoClassFor(machine, stratum, drawnIn, state.id) ??
		(first
			? `[data-state="${state.id}"]`
			: `[data-state-${stratum}="${state.id}"]`);
	return {
		machine: machine.id,
		instance: instance.id,
		state: state.id,
		layer: stratum,
		on,
		changed,
		transitions: transitionsFor(index, base, machine, drawnIn, state, changed, say),
		label: `${machine.name} · ${stateName(machine, state.id)} on “${instance.name}”, as ${on}`,
	};
}

/**
 * A state that moves a box, written so the browser can move it cheaply.
 *
 * Solved geometry leaves this file as absolute `left`/`top` — that is what
 * `geometry()` writes and what {@link ExportResult.lost} already says about it —
 * and animating either of those is a layout on every frame. The *difference*
 * between two states is a translation, which the compositor does on its own
 * thread, so a state that moves a node writes the offset rather than the
 * coordinate. The base rule needs nothing at all for this to work: `transform`
 * starts at `none`, which interpolates against a translation as the identity.
 *
 * A size still leaves as `width`/`height`, and deliberately so. `scale` is the
 * compositor's answer to a size and it is a different picture — it stretches the
 * border, the corner radius and the words inside — so writing it would be
 * exporting a design nobody drew in exchange for a frame rate.
 */
function moveDeclarations(from: ModelState, to: ModelState): Declarations {
	const out: Declarations = {};
	const dx = to.frame.x - from.frame.x;
	const dy = to.frame.y - from.frame.y;
	// The three things a `transform` carries, asked separately, because whether to
	// write one at all is a different question from what to write in it. A
	// `transform` is one value: a state's rule does not *add* a rotation to the
	// base's translation, it replaces the whole declaration — so a state that
	// changes any part of the pose has to restate all of it, and a state that
	// changes none of it must say nothing rather than say `none` and quietly
	// un-turn a card that was leaning.
	const lifted = liftOf(to) !== liftOf(from);
	const turned = TURN_NAMES.some((name) => (to.turn?.[name] ?? 0) !== (from.turn?.[name] ?? 0));
	if (dx !== 0 || dy !== 0 || lifted || turned) {
		// `none` where the state's pose is the identity, which is what a state that
		// puts a turned part back flat means and the only way to say it.
		out.transform = transformOf(dx, dy, liftOf(to), to.turn) ?? "none";
	}
	if (to.frame.width !== from.frame.width) out.width = px(to.frame.width);
	if (to.frame.height !== from.frame.height) out.height = px(to.frame.height);
	// The depth is deliberately absent, and it is the one number of the six a flat
	// element has no meaning for: a `div` has a `width`, a `height` and a place on
	// the z axis, and no thickness. A state that changes only a rectangle's depth
	// therefore changes nothing in this file — which is true rather than lossy,
	// because it changes nothing on the canvas either.
	return out;
}

/**
 * True where this state changes something a hugging box is sized by.
 *
 * {@link MEASURED_PROPS} rather than a list written out here, because "what
 * changes how big the words are" is a question `measure.ts` already answers and
 * a second list is a second list to keep in step. {@link autoSizes} is the other
 * half: a part with a fixed size is not sized by its words, so restyling them
 * costs the file nothing worth naming.
 *
 * What this reports changed when `stateMeasures` was wired up. It used to mean
 * "the box in the file is the wrong one" — the copy carried the definition's
 * measurement whatever the state did to the type. Now the copy is measured in
 * its own state's typography and the box in the file is right, so the same
 * condition reports the one thing still missing: the *container* is not
 * re-hugged, because there is no `lask/3` for an instance's copy of a laid-out
 * definition for a per-state container arithmetic to be the second half of. See
 * the note on {@link stateMeasures}, which is where that exclusion is argued.
 */
function retypes(index: DocIndex, state: MachineState, part: string): boolean {
	const doc = index.byId.get(part);
	if (!doc || !autoSizes(doc)) return false;
	const delta = state.parts[part];
	return MEASURED_PROPS.some((prop) => (delta?.props?.[prop]?.length ?? 0) > 0);
}

/**
 * The `transition:` declaration each changed node's base rule takes.
 *
 * On the **base** rule rather than on the state's, which is what makes one
 * declaration pace the move in both directions: a rule that only exists while the
 * pointer is over the button cannot describe the move away from it. The price is
 * that a machine whose two edges are paced differently gets one of the two, and
 * the loss says which.
 *
 * The stagger is folded into each node's own delay here rather than left for
 * something at run time to schedule, and that is the whole reason the exported
 * runtime has no timers in it. A `transition-delay` is the browser's own
 * scheduler, on the compositor, exact and interruptible; a script counting
 * milliseconds beside it would apply the same delay twice and turn a rhythm into
 * a stutter. Which node is "first" is `order/2` — the paint order, which is the
 * only sequence the document actually states — with the id as the same tie-break
 * `byOrder` uses, so the rhythm is a property of the design rather than of the
 * order a map happened to be built in.
 */
function transitionsFor(
	index: DocIndex,
	base: Layer,
	machine: Machine,
	drawnIn: string,
	state: MachineState,
	changed: ReadonlyMap<string, Declarations>,
	say: (line: string) => void,
): Map<string, Declarations> {
	const out = new Map<string, Declarations>();
	const edge = entryEdge(machine, drawnIn, state.id);
	if (!edge) return out;
	const model = base.universe.model;
	// The exit gate, said out loud, because it is the one rung of the ladder that
	// is *entirely* invisible in the stylesheet. An input is visible — the state
	// it opens is a rule in the file; a guard is visible for the same reason; a
	// timeline is `@keyframes` a reader can read. An exit time is a comparison the
	// script makes before it writes an attribute, and somebody reading only the
	// CSS would conclude the button responds to every click, which it does not.
	//
	// The answer set's number first and the document's second, for `pacing`'s
	// reason exactly: an exit time is a `duration` Value, so it may name a token
	// whose alternatives the solver picked between.
	const held =
		model.machines[machine.id]?.exit[edge.id] ??
		transitionExit(machine, edge, { tokens: index.scene.tokens, picks: base.universe.pick });
	if (held > 0) {
		say(
			`The ${ms(held)} “${stateName(machine, state.id)}” has to be waited for. An exit time is a gate the script checks before it writes the attribute, so it is in the file and it works — but it is not in the CSS, and a reader of the stylesheet alone will not see it.`,
		);
	}
	const { duration, delay, stagger, easing } = pacing(
		model,
		machine,
		edge,
		base.universe.pick,
		index.scene.tokens,
	);
	const leaving = machine.transitions.find(
		(t) => t.enabled && t.from === state.id && t.to === drawnIn,
	);
	if (leaving) {
		const back = pacing(model, machine, leaving, base.universe.pick, index.scene.tokens);
		if (back.duration !== duration || back.easing !== easing || back.delay !== delay) {
			say(
				`How “${stateName(machine, state.id)}” is paced on the way out. One transition declaration on the base rule paces the move both ways, so the file uses the edge going in and the edge coming back runs at the same speed.`,
			);
		}
	}
	if (duration <= 0) return out;

	// The gradient's cut, said out loud, in the shape of the `display:none`
	// sentence one function up and for the same reason: the declaration a reader
	// would look for is *absent* from the file — `tweenedKeys` struck it — and an
	// absence explains nothing on its own. Conditional on the state actually
	// repainting a `background-image`, because a document whose gradients never
	// move loses nothing and a list of losses that pads itself is one nobody
	// finishes reading.
	const cut = [...changed]
		.filter(([, declarations]) => declarations.backgroundImage !== undefined)
		.map(([id]) => nodeLabel(index, id));
	if (cut.length > 0) {
		say(
			`${stateName(machine, state.id)} changes the gradient on ${cut.join(", ")}. The direction of a gradient does not tween: CSS swaps one background image for the other at the halfway point, however long the transition says. The gradient's two colours do tween, because they are registered custom properties — so a change of colour is smooth and a change of direction is a cut.`,
		);
	}

	const ordered = [...changed.keys()].sort((a, b) => {
		const x = model.byId[a];
		const y = model.byId[b];
		return (x?.order ?? 1) - (y?.order ?? 1) || (a < b ? -1 : a > b ? 1 : 0);
	});
	ordered.forEach((id, i) => {
		const kind = model.byId[id]?.kind;
		if (!kind) return;
		const keys = tweenedKeys(kind, edge.only, changed.get(id) ?? {});
		if (keys.length === 0) return;
		out.set(id, {
			transition: `${keys.join(", ")} ${ms(duration)} ${easing} ${ms(delay + i * stagger)}`,
		});
	});
	return out;
}

/* ------------------------------------------------------------------ */
/* A timeline, as @keyframes                                           */
/* ------------------------------------------------------------------ */

/*
 * **Why a timeline is CSS and a state is a selector, and why that is not two
 * answers to one question.**
 *
 * A state is a *pose*: the machine settles in it and stays there, and what a
 * stylesheet needs is a rule that says what the design looks like while it is
 * there. A timeline is a *path*: a sequence of poses with times on them, played
 * through. CSS has a word for each of those and they are different words, and
 * the reason this file uses both rather than picking one is that the browser is
 * a better animator than any script this file could ship. `@keyframes` runs on
 * the compositor, it is interruptible, it retimes itself when the tab is
 * backgrounded, and it costs the exported page no JavaScript at all — which is
 * the same argument `runtime.ts` makes about not owning a clock, arriving from
 * the other end.
 *
 * So the runtime switches `data-state`, the state's rule turns the animation on,
 * and the compositor plays it. Nothing in the emitted script knows a timeline
 * exists, and a grep for `mkat` or `@keyframes` in `MACHINE_RUNTIME` comes up
 * empty on purpose.
 *
 * **What is exact, and what is resampled.** Every keyframe's *value* and *time*
 * are answers this universe gave — `kval` and `kat`, both `#project`ed, so two
 * alternatives really are two files — and a track that animates one property
 * comes out with exactly the keyframes the designer wrote, at exactly the
 * percentages they resolved to. The one place arithmetic happens is where two
 * tracks about one part both write `transform`: `transform` is a single CSS
 * value, so a stop that moved the box and a stop that turned it cannot be two
 * declarations, and a stop at 40% has to say what the *rotation* is at 40% even
 * though the rotation's own keys are at 0% and 100%. That is a linear sample
 * between the two surrounding keys, it ignores the easing of the segment it
 * samples inside, and it is named in the losses — but only where it actually
 * happens, which is where two transform tracks of one part disagree about when
 * their keyframes are.
 */

/** One track of one timeline, with what this universe put in each keyframe. */
interface PlayedKey {
	at: number;
	/** The literal the value resolved to, or nothing where it resolved to nothing. */
	value: string | undefined;
	easing: Easing;
}

interface PlayedTrack {
	track: Track;
	keys: PlayedKey[];
}

/** Every track of one timeline, read against this universe's picks. */
function playedTracks(
	machine: Machine,
	timeline: Timeline,
	context: { tokens: readonly Token[]; picks: Picks },
): PlayedTrack[] {
	const out: PlayedTrack[] = [];
	for (const track of timeline.tracks) {
		const term = trackTerm(track);
		if (term === undefined) continue;
		const keys = solvedKeys(machine, timeline, track, context).map((solved) => ({
			at: solved.at,
			value: resolveValue(
				context,
				solved.key.value,
				keyValueVar(machine.id, timeline.id, term, solved.index),
			),
			easing: keyEasing(solved.key),
		}));
		if (keys.length > 0) out.push({ track, keys });
	}
	return out;
}

/**
 * One track's number at one moment, linearly.
 *
 * Only ever asked about a track whose values are a *quantity* — a length or an
 * angle — and only ever at a moment some other track of the same part has a
 * keyframe at. Before the first key and after the last it holds flat, which is
 * what `animation-fill-mode: both` does at the ends of the animation itself and
 * is the only answer that does not invent a value out of nothing.
 */
function sampleAt(keys: readonly PlayedKey[], read: (text: string) => number | undefined, at: number): number | undefined {
	const known = keys
		.map((key) => ({ at: key.at, n: key.value === undefined ? undefined : read(key.value) }))
		.filter((k): k is { at: number; n: number } => k.n !== undefined);
	if (known.length === 0) return undefined;
	if (at <= known[0].at) return known[0].n;
	const last = known[known.length - 1];
	if (at >= last.at) return last.n;
	for (let i = 0; i + 1 < known.length; i++) {
		const lo = known[i];
		const hi = known[i + 1];
		if (at < lo.at || at > hi.at) continue;
		const span = hi.at - lo.at;
		return span <= 0 ? lo.n : lo.n + ((hi.n - lo.n) * (at - lo.at)) / span;
	}
	return last.n;
}

/** True where this track writes into the one `transform` declaration. */
const movesTransform = (track: Track): boolean =>
	track.turn !== undefined || track.dim === "x" || track.dim === "y" || track.dim === "z";

/** A `@keyframes` name no other block in this file has taken. */
function keyframeName(taken: Set<string>, parts: readonly string[]): string {
	const stem = `k-${parts.map(slug).join("-")}`;
	let name = stem;
	for (let n = 2; taken.has(name); n++) name = `${stem}-${n}`;
	taken.add(name);
	return name;
}

/**
 * How a timeline's loop mode reaches the `animation` shorthand.
 *
 * `pingPong` is `alternate` over an infinite count, which is what the word means
 * and what {@link timelinePosition} does on the canvas — the two have to agree or
 * scrubbing in the studio and watching the exported page are two animations.
 * `none` runs once and `both` holds the last frame, which is what makes the
 * settled pose the state's rule states and the last keyframe of the timeline the
 * same picture rather than a snap between them.
 */
const LOOPING: Record<LoopMode, { count: string; direction: string }> = {
	none: { count: "1", direction: "normal" },
	loop: { count: "infinite", direction: "normal" },
	pingPong: { count: "infinite", direction: "alternate" },
};

/**
 * The timelines one state plays, as `@keyframes` blocks and an `animation`.
 *
 * One block per (instance, timeline, **part**), not per timeline: a `@keyframes`
 * block is applied to an element, and a timeline that moves a panel and fades a
 * label is two elements' worth of animation. Splitting per part is what makes
 * each block a sequence of declarations one element can actually take.
 *
 * The animation lands on the state's own rule where the state is one the file can
 * select — which is every state but the one the picture is drawn in — and on the
 * drawn state's *base* rule otherwise, through {@link MachineExport.playing},
 * which `htmlExport` merges the way it merges the `transition:` declarations. A
 * timeline that plays in the state the file opens in has to be running when the
 * file opens, and a rule that only exists under a `data-state` the runtime has
 * not written yet would start it late or not at all.
 */
function playTimelines(
	base: Layer,
	machine: Machine,
	instance: SceneNode,
	state: MachineState,
	context: { tokens: readonly Token[]; picks: Picks },
	out: Played,
	say: (line: string) => void,
): Map<string, Declarations> {
	const model = base.universe.model;
	const animations = new Map<string, Declarations>();
	let timelines = statePlays(machine, state);
	const named = timelines.length;
	if (named === 0) return animations;
	if (state.blend !== undefined) {
		// **One stop, and it is scaffolding rather than a feature.** CSS has no way
		// to mix two keyframe animations by a number: `animation` takes a list, but
		// two animations writing one property is the last one winning, not a blend.
		// So the file carries the stop the blend is *at* when the page opens — which
		// is `blendWeights` asked with no host values, so it falls back to every
		// input's declared initial, which is exactly the valuation the emitted
		// runtime seeds its store with — and the loss says so. The studio canvas
		// does the real mixing, off the same function.
		const weights = blendWeights(machine, state.blend, {});
		const heaviest = weights.reduce<(typeof weights)[number] | undefined>(
			(best, w) => (best === undefined || w.weight > best.weight ? w : best),
			undefined,
		);
		const chosen = timelines.find((t) => t.id === heaviest?.timeline);
		timelines = chosen ? [chosen] : timelines.slice(0, 1);
		// Counted against the timelines the blend *names*, not against the weights
		// it came back with: a 1D blend sitting on one of its own stops answers with
		// that stop alone, which is the common case and is exactly the case where a
		// designer most needs telling that the rest of the axis is not in the file.
		if (named > 1) {
			say(
				`The mix in ${stateName(machine, state.id)} of “${machine.name}”. A blend is arithmetic over a live number and CSS cannot mix two keyframe animations by one, so the file plays “${timelines[0].name}” — the stop the blend starts at — flat, and the other ${named - 1} ${named === 2 ? "is" : "are"} not in it.`,
			);
		}
	}

	for (const timeline of timelines) {
		const length = timelineLength(machine, timeline, context);
		if (length <= 0) {
			say(
				`“${timeline.name}” has no length in this design, so there is nothing between its keyframes to play. The pose ${stateName(machine, state.id)} settles in is in the file; the animation is not.`,
			);
			continue;
		}
		const tracks = playedTracks(machine, timeline, context);
		const parts = [...new Set(tracks.map((t) => t.track.part))];
		for (const part of parts) {
			const nodeId = instancePart(instance.id, part);
			const drawn = model.byId[nodeId];
			if (!drawn) {
				say(
					`“${timeline.name}” animates “${part}” of “${instance.name}”, which this design is not drawing. A stylesheet can animate an element and cannot write one, so that track is not in the file.`,
				);
				continue;
			}
			const block = keyframeBlock(
				timeline,
				length,
				tracks.filter((t) => t.track.part === part),
				drawn,
				say,
			);
			if (block === undefined) continue;
			const name = keyframeName(out.names, [instance.id, timeline.id, part]);
			out.keyframes.push(`@keyframes ${name} {\n${block}\n}`);
			const loop = LOOPING[timeline.loop ?? "none"];
			// `linear` in the shorthand on purpose: each stop carries its own
			// `animation-timing-function`, which is what a per-keyframe easing means
			// in CSS, and a curve in the shorthand would be applied *on top of* those
			// rather than instead of them.
			animations.set(nodeId, {
				...(animations.get(nodeId) ?? {}),
				animation: `${name} ${ms(length)} linear 0ms ${loop.count} ${loop.direction} both`,
			});
		}
	}
	return animations;
}

/** Where the timelines of one document accumulate while they are being read. */
interface Played {
	keyframes: string[];
	/** `animation:` for a node whose state is the one the picture is drawn in. */
	playing: Map<string, Declarations>;
	/** Every `@keyframes` name taken so far, so two of them cannot collide. */
	names: Set<string>;
}

/**
 * One part's tracks, as the body of a `@keyframes` block.
 *
 * The percentages are integers, which is what `rive-ladder-spec.md` §9.4 froze
 * and is coarser than it looks like it should be: 1% of a 200ms timeline is 2ms,
 * which no eye resolves, and a fractional percentage in a `@keyframes` selector
 * is legal but is a number nobody reading the file can check against the panel.
 * Where the rounding is not exact the loss says so, and where two keyframes round
 * onto one percentage the later one wins and the loss says that too — both are
 * facts about *this* timeline rather than about the format, so neither is said
 * about a document where they do not happen.
 *
 * `undefined` where the part's tracks come to no declarations at all, so the
 * caller emits no block and no `animation` rather than an empty one.
 */
function keyframeBlock(
	timeline: Timeline,
	length: number,
	tracks: readonly PlayedTrack[],
	drawn: ModelNode,
	say: (line: string) => void,
): string | undefined {
	const moving = tracks.filter((t) => movesTransform(t.track));
	// Every moment any transform track has a key at, because one `transform`
	// declaration has to answer for all of them at every stop it appears in.
	const moments = [...new Set(moving.flatMap((t) => t.keys.map((k) => k.at)))].sort(
		(a, b) => a - b,
	);
	if (
		moving.length > 1 &&
		moving.some((t) => t.keys.length !== moments.length)
	) {
		say(
			`When the parts of the move in “${timeline.name}” happen. Two tracks of one part both write the browser's one transform, and their keyframes are at different times — so the file states the whole pose at every one of those times, taking the in-between values as straight lines. A curve on a segment that another track subdivides is flattened inside it.`,
		);
	}

	/** Stop percentage -> what is declared there. */
	const stops = new Map<number, Declarations>();
	let rounded = false;
	let collided = false;
	let past = false;
	const stopAt = (at: number): Declarations => {
		if (at > length) past = true;
		const exact = (100 * Math.min(at, length)) / length;
		const percent = Math.round(exact);
		if (percent !== exact) rounded = true;
		const held = stops.get(percent);
		if (held !== undefined) collided = true;
		const made = held ?? {};
		stops.set(percent, made);
		return made;
	};

	for (const played of tracks) {
		const { track } = played;
		if (movesTransform(track)) continue;
		for (const key of played.keys) {
			if (key.value === undefined) continue;
			const at = stopAt(key.at);
			if (track.dim === "width" || track.dim === "height") {
				at[track.dim] = cssLength(key.value);
				continue;
			}
			if (track.dim === "depth") {
				// A `div` has no thickness — see `moveDeclarations`, which says the same
				// thing about the same number. Silently nothing rather than a loss:
				// there is nothing on the canvas either.
				continue;
			}
			if (track.prop !== undefined) {
				const paint = paintFor(drawn.kind, track.prop);
				if (paint) Object.assign(at, paint(cssValue(track.prop, key.value)));
			}
			Object.assign(at, easingAt(played, key));
		}
	}

	for (const at of moments) {
		const stop = stopAt(at);
		// A translation is a **delta** from where the element already is, because
		// `left` and `top` are absolute in the rule this animation runs on top of —
		// the same basis `moveDeclarations` writes a state's move in, so a timeline
		// and a state that both move a part agree about where zero is. A track that
		// says nothing about an axis leaves that axis where the picture has it,
		// which for x and y is a delta of nothing.
		const placed = (dim: "x" | "y"): Emu => {
			const sampled = sampleAt(keysOf(moving, dim), emuOf, at);
			return sampled === undefined ? 0 : sampled - drawn.frame[dim];
		};
		const dx = placed("x");
		const dy = placed("y");
		const z = sampleAt(keysOf(moving, "z"), emuOf, at) ?? drawn.spatial?.z ?? 0;
		const turn = { ...(drawn.turn ?? { rotateX: 0, rotateY: 0, rotateZ: 0 }) };
		for (const name of TURN_NAMES) {
			const sampled = sampleAt(turnKeys(moving, name), mdegOf, at);
			if (sampled !== undefined) turn[name] = sampled;
		}
		stop.transform = transformOf(dx, dy, z, turn) ?? "none";
		for (const played of moving) {
			const key = played.keys.find((k) => k.at === at);
			if (key) Object.assign(stop, easingAt(played, key));
		}
	}

	if (stops.size === 0) return undefined;
	if (rounded) {
		say(
			`Exactly when each keyframe of “${timeline.name}” lands. A CSS keyframe is a whole percentage of the animation, so a key that falls between two of them is written at the nearer one — at most half a percent of ${ms(length)} out.`,
		);
	}
	if (collided) {
		say(
			`Two keyframes of “${timeline.name}” land on the same whole percentage of it, and a stylesheet has one stop there. The later one is what is in the file.`,
		);
	}
	if (past) {
		say(
			`A keyframe of “${timeline.name}” is past the end of it — the timeline is ${ms(length)} long and says so — so the file holds that key at the end rather than beyond it, which is where the canvas holds it too.`,
		);
	}
	return [...stops.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([percent, declarations]) => rule(`${percent}%`, declarations, "\t"))
		.filter((text) => text !== "")
		.join("\n");
}

/** The keys of the one track about a dimension, or none. */
const keysOf = (tracks: readonly PlayedTrack[], dim: string): PlayedKey[] =>
	tracks.find((t) => t.track.dim === dim)?.keys ?? [];

/** The same, for a rotation. */
const turnKeys = (tracks: readonly PlayedTrack[], turn: Turn): PlayedKey[] =>
	tracks.find((t) => t.track.turn === turn)?.keys ?? [];

/**
 * The curve leaving one keyframe, as the declaration CSS reads it with.
 *
 * `animation-timing-function` inside a stop paces the segment *leaving* that
 * stop, which is exactly what {@link Keyframe.easing} means and why the last
 * keyframe's is read by nothing here as it is read by nothing anywhere else. The
 * default is left out rather than written: `ease-out` on every stop of every
 * block is the same animation and several hundred more bytes.
 */
function easingAt(played: PlayedTrack, key: PlayedKey): Declarations {
	const last = played.keys[played.keys.length - 1];
	if (key === last) return {};
	return key.easing === DEFAULT_EASING
		? {}
		: { animationTimingFunction: EASINGS[key.easing].css };
}

/**
 * Every machine in the document, as selectors over the base layer.
 *
 * The public reading, for a caller that wants the states without the file. It
 * keeps token names — that is what an export does unless asked otherwise — and
 * collects the tokens it named into a set it then drops, because a caller holding
 * one layer has nowhere to put a `:root` block. {@link htmlExport} calls the
 * planner directly for exactly that reason.
 */
export function exportMachines(scene: Scene, base: Layer): MachineExport {
	return planMachines(indexDocument(scene), base, true, new Set());
}

/* ------------------------------------------------------------------ */
/* The two entry points                                                */
/* ------------------------------------------------------------------ */

function emit(
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
	note: string,
	/** The variable the layers switch between, where they switch one. */
	varying?: string,
): ExportResult {
	const spec = EXPORT_TARGETS[options.target];
	const out: Emitted =
		layers.length === 0
			? { text: "", classes: [], lost: [] }
			: options.target === "svg"
				? svgExport(index, layers, options)
				: htmlExport(index, layers, options);
	const lost = [...ALWAYS_LOST, ...spec.loses, ...out.lost];
	if (isRuled(index.scene)) lost.push(GRID_LOST);
	if (options.tokens === false) {
		lost.push("Token names: every value is inlined as the literal it resolved to.");
	}
	if (layers.length > 1) {
		// The collapsed export keeps the varying variable; everything else about
		// the space is still gone.
		lost[0] =
			"The rest of the space. This artefact holds the one variable that separates these designs; any other design in the document is not in it.";
	}
	// A style is the one thing here that does *not* flatten: it comes out as the
	// class it already was, so what a class loses is not the treatment but the
	// *choice* — which variant. Unless the variant is exactly what the layers
	// switch, in which case both of them are in the file and the loss would be a
	// lie.
	if (out.classes.length > 0) {
		const names = out.classes.map((c) => `.${c.name}`).join(", ");
		const switched =
			varying !== undefined && parseVariable(varying)?.kind === "style";
		lost.push(
			switched
				? `Every variant but two. ${names} came out as ${out.classes.length === 1 ? "a class" : "classes"} and the layers switch between the two treatments these designs picked; a third variant would not be in the file.`
				: `Which treatment. ${names} came out as ${out.classes.length === 1 ? "a class" : "classes"} — one place to edit, and every wearer follows — but a class holds one variant, and the style's others are not in the file.`,
		);
		// A wearer only the answer set names shares the class, and that is the
		// point of reading it back — but it brings no *name* with it, because the
		// document has no value of its own to have named one.
		const derived = out.classes.filter((c) => c.derived.length > 0);
		if (derived.length > 0) {
			lost.push(
				`Token names under ${derived.map((c) => `.${c.name}`).join(", ")}. A node an instance or a rule dressed wears the class like any other, but a property no wearer the document holds takes from the style reaches it as a literal rather than as the token it linked to.`,
			);
		}
	}
	return {
		target: options.target,
		filename: `${slug(options.title ?? "design")}.${spec.extension}`,
		text: out.text,
		lost,
		note,
	};
}

/** One design, as a file. */
export function exportUniverse(
	scene: Scene,
	universe: ExportUniverse,
	options: ExportOptions,
): ExportResult {
	return emit(
		indexDocument(scene),
		[{ universe, media: null, under: null, label: "The design" }],
		options,
		"One universe, as it stands.",
	);
}

/**
 * The whole space as one artefact, where that is sound — and one universe with
 * the reason where it is not.
 *
 * SVG has neither media queries a designer would trust nor a theming
 * convention, so a collapse only reaches the HTML target; the SVG export of a
 * collapsible space is its base universe.
 */
export function exportSpace(
	scene: Scene,
	universes: readonly ExportUniverse[],
	options: ExportOptions,
): ExportResult {
	const index = indexDocument(scene);
	if (universes.length === 0) {
		return emit(index, [], options, "There is no design to export.");
	}
	const collapsed = collapseSpace(scene, universes);
	if ("reason" in collapsed || options.target !== "html") {
		const reason =
			"reason" in collapsed
				? collapsed.reason
				: "SVG has no media queries and no theming convention, so a collapsed space only reaches HTML.";
		return emit(
			index,
			[{ universe: universes[0], media: null, under: null, label: "The design" }],
			options,
			reason,
		);
	}
	return emit(index, collapsed.layers, options, collapsed.note, collapsed.variable);
}
