/**
 * HTML and CSS.
 *
 * The emitter this package exists for, moved out of `design-core/export.ts`
 * whole. What changed on the way: `Emitted` comes from the core, and the
 * escaping, the data URIs and the reading of what a machine drew went with it,
 * because an SVG needs all three too. The losses, the depth reading, the class
 * builder, the states and the timelines are neighbouring files rather than
 * sections of one four-thousand-line one.
 */
import type {
	Declarations,
	Frame,
	ModelNode,
	NodeKind,
	Scene,
} from "@clingo-design/design-core";
import {
	CUSTOM_PROPERTY_RULES,
	DEFAULT_LINK_TRIGGER,
	DIMENSIONS,
	DOCUMENT_BASE,
	FRAME_DIMS,
	KINDS,
	LINK_RUNTIME,
	SHAPE_PAINT,
	SURFACE_BOX,
	TRIGGERS,
	arrowHead,
	cssText,
	cssValue,
	diagonalRun,
	drawsWords,
	fontFamilies,
	frameOf,
	frameVar,
	isDiagonal,
	isPlotted,
	paintFor,
	pathData,
	propVar,
	quoteFamily,
	scalePoints,
	usedFamilies,
} from "@clingo-design/design-core";

import type {
	DocIndex,
	Emitted,
	ExportOptions,
	ExportResult,
	Layer,
	Slot,
} from "@clingo-design/export-core";
import {
	customProperties,
	dataUrl,
	docNode,
	drawnStateValue,
	escapeAttr,
	escapeText,
	framePx,
	modelBounds,
	posterFor,
	px,
	round,
	slotsOf,
	slug,
	stopsHere,
	tokenNamed,
	valueNamed,
	viewportsIn,
} from "@clingo-design/export-core";

import {
	DEAD_LINK_LOST,
	LINKED_LOST,
	TURNED_LOST,
	missingImages,
	viewportLost,
} from "./losses.ts";
import { depthOf, liftOf, transformOf } from "./depth.ts";
import { classRule, styleClasses } from "./styles.ts";
import { planMachines, timelineRules } from "./states.ts";
import { springRules } from "./states.ts";

/* ------------------------------------------------------------------ */
/* HTML + CSS                                                          */
/* ------------------------------------------------------------------ */



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
export function geometry(
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


/** Everything a node paints, with token links kept as `var(--name)`. */
export function declarationsFor(
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
 * What `src: url(…) format(…)` should say, per extension.
 *
 * The `format()` hint is what browsers actually dispatch on, and it is why a
 * wrong MIME in a `data:` URI is survivable. An extension not in this table gets
 * the data URI with `application/octet-stream` and **no** `format()` clause at
 * all, so the browser sniffs rather than being told something false — which is
 * the same call `dataUrl` makes one function up about an unknown picture.
 */
export const FONT_FORMATS: Record<string, string> = {
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
export function missingFaces(
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
export const kb = (bytes: number): string => `${Math.round(bytes / 1024)} kB`;

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
export function fontWeightNote(
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
export function htmlContent(
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
export function rule(selector: string, declarations: Declarations, indent: string): string {
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
export function scope(selector: string, under: string | null): string {
	if (under === null) return selector;
	if (selector === ":root") return under;
	const inner = /^:where\((.*)\)$/.exec(selector);
	return inner ? `:where(${under} ${inner[1]})` : `${under} ${selector}`;
}

/** Everything in `next` that `base` does not already say. */
export function diff(base: Declarations, next: Declarations): Declarations {
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
}
/* A link is an anchor, so the user agent has opinions about it — a colour, an
   underline and a tap highlight the design did not ask for. Neutralised once
   here rather than folded into each linked node's own rule, so putting a link on
   something never repaints it.

   Wrapped in :where(), and that is the whole of the rule rather than decoration.
   ".design a[data-node]" is a class, a type and an attribute — (0,2,1) — while a
   node's own rule is a bare class at (0,1,0) and a style's is already inside
   :where() and weighs nothing at all. And the ink property writes "color". So the unwrapped
   selector would do the exact opposite of what this comment claims: a text node
   that leads somewhere would lose its ink to a neutraliser written to be
   invisible. At zero specificity it still beats the user agent — author styles
   win over UA styles regardless of weight — and loses to every node rule and
   every style class, which is what "never repaints it" was trying to say.

   Keyed on [data-node] so it says what it means: the design's own boxes, not an
   anchor a rule put inside a text node. Unconditional because it is three
   declarations on a selector that matches nothing in a document with no links,
   and because BASE_CSS is a constant — a condition here would be a second code
   path for four lines. */
:where(.design a[data-node]) {
	color: inherit;
	text-decoration: none;
	-webkit-tap-highlight-color: transparent;
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
	pages: Readonly<Record<string, string>> = {},
): string {
	const byId = new Map(slots.map((s) => [s.id, s] as const));
	const render = (node: ModelNode, depth: number, pretty: boolean): string => {
		const slot = byId.get(node.id);
		if (!slot) return "";
		const pad = pretty ? "\t".repeat(depth + 2) : "";
		const worn = wearing.get(node.id);
		const names = worn === undefined ? slot.className : `${slot.className} ${worn}`;
		// A link is an anchor, because a link that is not an `<a>` is not a link: it
		// is not in the tab order, middle-click does not open it in a tab, and a
		// screen reader does not announce it as one. Everything else about the box
		// is untouched — same class, same data attributes, same rule in the
		// stylesheet — so this swaps one tag and adds one attribute rather than
		// growing a second way for a node to be emitted.
		//
		// Read off the `ModelNode`, which came from the answer set, so **a link a
		// rule asserted exports too**. Nothing extra was needed for that and it is
		// worth the sentence, so nobody "simplifies" it into reading the document.
		const link = node.link;
		const to = link === undefined ? undefined : pages[link.to];
		const tag = to === undefined ? "div" : "a";
		const href = to === undefined ? "" : ` href="${escapeAttr(`${slug(to)}.html`)}"`;
		// Only where the browser will not do it on its own — see LINK_RUNTIME. A
		// click link carries no attribute and therefore costs the file no script.
		const fires =
			to !== undefined && link !== undefined && link.on !== DEFAULT_LINK_TRIGGER
				? ` data-link-on="${escapeAttr(TRIGGERS[link.on].event)}"`
				: "";
		const open = `${pad}<${tag} class="${names}" data-node="${escapeAttr(node.id)}" data-kind="${node.kind}"${href}${fires}>`;
		const close = `</${tag}>`;
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
		if (!nested) return `${open}${content}${kids.join("")}${close}`;
		return [content === "" ? open : `${open}${content}`, ...kids, `${pad}${close}`].join(
			"\n",
		);
	};
	return layer.universe.model.roots
		.map((root) => render(root, 0, true))
		.filter((markup) => markup !== "")
		.join("\n");
}

/** The file, and what it turned out to hold — see {@link ExportResult.lost}. */

export function htmlExport(
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

	// After the `:root` block that carries the token custom properties — which is
	// the last thing `baseRules` writes — and before the layer blocks, which is
	// the stylesheet order `docs/framer-parity-plan.md` §5.6 fixes so that four
	// steps writing one array do not each have to rediscover it. Position is
	// legibility rather than correctness here: `--dc-ease-*` is defined on `:root`
	// and referred to from a `transition` shorthand, and a custom property is
	// substituted at use rather than at definition, so a later `:root` would work
	// as well. A reader looking for "what curve is this" should find it beside the
	// other things the document named once.
	css.push(...springRules(machines.springs));
	// Beside the springs, which is where `docs/framer-parity-plan.md` §5.6 puts
	// them: two `:root` pairs written by two steps for one structural reason, and
	// a reader who has understood one has understood the other.
	css.push(...timelineRules(machines.scrolled));

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

	/**
	 * What this document's links came to, over the nodes that are actually drawn.
	 *
	 * Over the slots rather than over `model.links`, and the difference is the
	 * `visible/1` guard one level up: `link/2` is shown for hidden nodes too — a
	 * rule may want to reason about an edge the design does not offer — while what
	 * this file emits is what it drew. A link on a node no slot holds is not in
	 * this file at all, so it is neither an anchor nor a loss.
	 */
	const pages = options.pages ?? {};
	let linked = 0;
	let dead = 0;
	let scripted = false;
	for (const slot of slots) {
		const link = base.universe.model.byId[slot.id]?.link;
		if (link === undefined) continue;
		if (pages[link.to] === undefined) {
			dead += 1;
			continue;
		}
		linked += 1;
		if (link.on !== DEFAULT_LINK_TRIGGER) scripted = true;
	}
	if (linked > 0) spatialLost.push(LINKED_LOST);
	if (dead > 0) spatialLost.push(DEAD_LINK_LOST(dead));

	const title = escapeText(options.title ?? "Design");
	// At the end of the body, where a script that reads the document has to be:
	// the runtime's first act is one `querySelectorAll("[data-node]")` pass, and in
	// the head it would find nothing. `defer` would work too and would be a second
	// thing to be right about — see `runtime.ts`, which is deliberately a plain
	// ES5 body with no dependency on when it runs beyond the elements existing.
	const script =
		machines.runtime === null ? "" : `\n<script>\n${machines.runtime}\n</script>`;
	// And the six lines a link that is not a click needs, in a script of its own
	// beside the interpreter's rather than inside it. Two scripts and not one
	// because they are two different things: that one is a table interpreter and
	// this one has no table. A document whose every link is a click emits neither
	// this tag nor a `data-link-on` anywhere, which is the whole reason an anchor
	// was chosen over a handler.
	const links = scripted
		? `\n<script>\n(function(){\nvar root = document;\n${LINK_RUNTIME}\n})();\n</script>`
		: "";
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
${htmlBody(index, slots, base, wearing, options.images ?? {}, pages)}
\t</div>${script}${links}
</body>
</html>
`,
	};
}

