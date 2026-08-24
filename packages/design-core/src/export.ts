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
 */
import type { Frame } from "./geometry.ts";
import { pathData, scalePoints } from "./geometry.ts";
import { parseInstancePart } from "./components.ts";
import type { ModelNode, ModelScene } from "./model.ts";
import {
	DOCUMENT_BASE,
	PAINT,
	SHAPE_PAINT,
	SURFACE_BOX,
	arrowHead,
	cssText,
	type Declarations,
	diagonalRun,
	paintOf,
} from "./paint.ts";
import {
	type Dimension,
	DIMENSIONS,
	FRAME_DIMS,
	KINDS,
	LAYOUT_PROPS,
	type LayoutProp,
	type NodeKind,
	PROPS,
	type PropName,
	type Scene,
	type SceneNode,
	frameOf,
} from "./scene.ts";
import { flatten } from "./tree.ts";
import {
	type Picks,
	type Token,
	type Value,
	activeTerm,
	findToken,
	frameVar,
	layoutVar,
	luminance,
	parseVariable,
	propVar,
	resolveValue,
	tokenVar,
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
			"Text is placed in a fixed box: it wraps the way the canvas measured it, and will re-wrap if a font is missing.",
		],
	},
	svg: {
		label: "SVG",
		extension: "svg",
		mime: "image/svg+xml",
		language: "svg",
		loses: [
			"Shadows are dropped — SVG needs a filter per elevation, and a filter is not the declaration a designer wrote.",
			"Text does not wrap. Each line of the document's own text becomes a tspan; a line the canvas broke because the box was narrow comes out unbroken.",
			"A text baseline is computed from the font size rather than measured, so a face with unusual metrics sits a pixel or two off.",
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
	 * Emit `var(--accent)` where a value named a token, with the definitions at
	 * the top. Off inlines the literal everywhere, which is what a paste into
	 * something with its own variables wants.
	 * @default true
	 */
	tokens?: boolean;
	/** Names the document in the output. */
	title?: string;
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

/* ------------------------------------------------------------------ */
/* Reading the document for what the atoms do not carry                */
/* ------------------------------------------------------------------ */

/** Everything one export needs to know that is not in the model. */
interface DocIndex {
	scene: Scene;
	byId: Map<string, SceneNode>;
	custom: Map<string, string>;
}

function indexDocument(scene: Scene): DocIndex {
	return {
		scene,
		byId: new Map(flatten(scene.nodes).map((n) => [n.id, n] as const)),
		custom: customNames(scene.tokens),
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

/** Whatever the document stores for a variable, if it stores anything. */
function documentValue(index: DocIndex, variable: string): Value | undefined {
	const parsed = parseVariable(variable);
	if (!parsed) return undefined;
	if (parsed.kind === "token") {
		return findToken(index.scene.tokens, parsed.token)?.value;
	}
	if (parsed.kind === "prop") {
		return docNode(index, parsed.node)?.props[parsed.prop as PropName];
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
	const value = documentValue(index, variable);
	if (!value) return undefined;
	const term = activeTerm(value, variable, picks);
	return term?.kind === "token"
		? findToken(index.scene.tokens, term.token)
		: undefined;
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

/** Pre-order over the model, which is also paint order. */
function slotsOf(model: ModelScene): Slot[] {
	const out: Slot[] = [];
	const walk = (node: ModelNode, depth: number): void => {
		out.push({ id: node.id, className: `n${out.length}`, kind: node.kind, depth });
		for (const child of node.children) walk(child, depth + 1);
	};
	for (const root of model.roots) walk(root, 0);
	return out;
}

/** The box every root sits inside, so a document away from the origin still tiles. */
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

/** Coordinates are exact rationals upstream; four places is well past a pixel. */
const round = (n: number): number => Math.round(n * 10000) / 10000;
const px = (n: number): string => `${round(n)}px`;

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
	return out;
}

/** Everything a node paints, with token links kept as `var(--name)`. */
function declarationsFor(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
	useTokens: boolean,
	used: Set<string>,
): Declarations {
	if (!useTokens) return paintOf(node);
	// The same walk `paintOf` does, with the token's name standing in for the
	// literal wherever the document named one. Kept parallel deliberately: the
	// property-to-CSS mapping stays in exactly one table.
	const box: Declarations = {};
	if (KINDS[node.kind].surface) Object.assign(box, SURFACE_BOX);
	const shape = SHAPE_PAINT[node.kind];
	if (shape?.box) Object.assign(box, shape.box);
	for (const prop of KINDS[node.kind].props) {
		const value = node.rendered[prop];
		if (value === undefined) continue;
		const paint = shape?.paint?.[prop] ?? PAINT[prop];
		if (!paint) continue;
		const token = tokenNamed(index, layer.universe.pick, propVar(node.id, prop));
		if (token) {
			used.add(token.id);
			Object.assign(box, paint(`var(--${index.custom.get(token.id)})`));
		} else {
			Object.assign(box, paint(value));
		}
	}
	return box;
}

/** The markup a kind draws inside its box, as a string. */
function htmlContent(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
): string {
	if (node.kind === "text") return escapeText(node.rendered.text ?? "");
	const doc = docNode(index, node.id);
	const frame = node.frame;
	if (node.kind === "line" || node.kind === "arrow") {
		const { y1, y2 } = diagonalRun(frame, doc?.diagonal);
		const head =
			node.kind === "arrow"
				? `<polyline points="${escapeAttr(arrowHead(0, y1, frame.width, y2))}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
				: "";
		return `<svg class="s" aria-hidden="true"><line x1="0" y1="${y1}" x2="${frame.width}" y2="${y2}" stroke-linecap="round" fill="none"/>${head}</svg>`;
	}
	if (node.kind === "path") {
		if (!doc) return "";
		const context = { tokens: index.scene.tokens, picks: layer.universe.pick };
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

const BASE_CSS = `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: #f1f5f9; }
.design {
	position: relative;
	/* A document defines its own appearance; it never inherits the page's —
	   the same declarations the canvas puts on an artboard. */
${cssText(DOCUMENT_BASE, "\t")}
}
.design [data-node] { position: absolute; }
/* A line, an arrow or a path, drawn across its own box. Overflow is visible so
   a thick stroke is not clipped in half along the frame's edge. */
.design .s { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }`;

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

function htmlBody(index: DocIndex, slots: readonly Slot[], layer: Layer): string {
	const byId = new Map(slots.map((s) => [s.id, s] as const));
	const render = (node: ModelNode, depth: number, pretty: boolean): string => {
		const slot = byId.get(node.id);
		if (!slot) return "";
		const pad = pretty ? "\t".repeat(depth + 2) : "";
		const open = `${pad}<div class="${slot.className}" data-node="${escapeAttr(node.id)}" data-kind="${node.kind}">`;
		const content = htmlContent(index, layer, node);
		const nested = !keepsWhitespace(node.kind) && node.children.length > 0;
		const kids = node.children
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

function htmlExport(
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
): string {
	const useTokens = options.tokens !== false;
	const base = layers[0];
	const slots = slotsOf(base.universe.model);
	const used = new Set<string>();

	/** Every declaration one layer makes, keyed by selector. */
	const readLayer = (layer: Layer): Map<string, Declarations> => {
		const out = new Map<string, Declarations>();
		const origin = modelBounds(layer.universe.model);
		out.set(".design", {
			width: px(origin.width),
			height: px(origin.height),
		});
		const byId = new Map(slots.map((s) => [s.id, s] as const));
		const walk = (node: ModelNode, root: boolean): void => {
			const slot = byId.get(node.id);
			if (slot) {
				out.set(`.${slot.className}`, {
					...geometry(index, layer, node, root, origin, useTokens, used),
					...declarationsFor(index, layer, node, useTokens, used),
				});
			}
			for (const child of node.children) walk(child, false);
		};
		for (const root of layer.universe.model.roots) walk(root, true);
		// Custom properties are a layer's own, so a theme is one block of them.
		const custom: Declarations = {};
		for (const token of index.scene.tokens) {
			if (!used.has(token.id)) continue;
			const value = resolveValue(
				{ tokens: index.scene.tokens, picks: layer.universe.pick },
				token.value,
				tokenVar(token.id),
			);
			if (value !== undefined) custom[`--${index.custom.get(token.id)}`] = value;
		}
		if (Object.keys(custom).length > 0) out.set(":root", custom);
		return out;
	};

	const baseRules = readLayer(base);

	const css: string[] = [BASE_CSS];
	for (const [selector, declarations] of baseRules) {
		const block = rule(selector, declarations, "");
		if (block) css.push(block);
	}

	for (const layer of layers.slice(1)) {
		const rules = readLayer(layer);
		const inner: string[] = [];
		const indent = layer.media ? "\t" : "";
		for (const [selector, declarations] of rules) {
			const changed = diff(baseRules.get(selector) ?? {}, declarations);
			if (Object.keys(changed).length === 0) continue;
			// `:root` is where the custom properties live; a scoped layer moves
			// them onto its own selector rather than redefining the document's.
			const scoped =
				layer.under === null
					? selector
					: selector === ":root"
						? layer.under
						: `${layer.under} ${selector}`;
			const block = rule(scoped, changed, indent);
			if (block) inner.push(block);
		}
		if (inner.length === 0) continue;
		css.push(`/* ${layer.label} */`);
		css.push(
			layer.media ? `@media ${layer.media} {\n${inner.join("\n")}\n}` : inner.join("\n"),
		);
	}

	const title = escapeText(options.title ?? "Design");
	return `<!doctype html>
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
${htmlBody(index, slots, base)}
\t</div>
</body>
</html>
`;
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
	// shadow: an SVG shadow is a filter, and a filter is not the declaration
	// anyone wrote. Named in EXPORT_TARGETS.svg.loses rather than approximated.
};

/** A shape's own attributes, before anything is painted on it. */
const SVG_SHAPES: Partial<Record<NodeKind, (frame: Frame) => string>> = {
	frame: (f) => `<rect width="${round(f.width)}" height="${round(f.height)}"/>`,
	rect: (f) => `<rect width="${round(f.width)}" height="${round(f.height)}"/>`,
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
		const token = useTokens
			? tokenNamed(index, layer.universe.pick, propVar(node.id, prop))
			: undefined;
		if (token) used.add(token.id);
		Object.assign(
			box,
			paint(token ? `var(--${index.custom.get(token.id)})` : value),
		);
	}
	return box;
}

/** The number a line height reads as, for the em maths a tspan needs. */
function lineHeightOf(node: ModelNode): number {
	const n = Number(node.rendered.lineHeight);
	return Number.isFinite(n) && n > 0 ? n : 1.35;
}

function svgText(node: ModelNode, style: string): string {
	const align = node.rendered.align ?? "left";
	const x =
		align === "center" ? node.frame.width / 2 : align === "right" ? node.frame.width : 0;
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
	clips: string[],
): string {
	const pad = "\t".repeat(depth + 1);
	const frame = node.frame;
	const declarations = svgPaint(index, layer, node, useTokens, used);
	const style =
		Object.keys(declarations).length === 0
			? ""
			: ` style="${escapeAttr(cssText(declarations).replace(/\n/g, " "))}"`;

	let own = "";
	const doc = docNode(index, node.id);
	if (node.kind === "text") {
		own = svgText(node, style);
	} else if (node.kind === "line" || node.kind === "arrow") {
		const { y1, y2 } = diagonalRun(frame, doc?.diagonal);
		const head =
			node.kind === "arrow"
				? `<polyline points="${escapeAttr(arrowHead(0, y1, frame.width, y2))}" fill="none" stroke-linecap="round" stroke-linejoin="round"${style}/>`
				: "";
		own = `<line x1="0" y1="${round(y1)}" x2="${round(frame.width)}" y2="${round(y2)}" fill="none" stroke-linecap="round"${style}/>${head}`;
	} else if (node.kind === "path") {
		const context = { tokens: index.scene.tokens, picks: layer.universe.pick };
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

	const inside = node.children.map((child) =>
		svgNode(index, layer, child, useTokens, used, depth + 1, clips),
	);
	const kids =
		inside.length === 0 ? "" : `\n${pad}\t<g${clip}>\n${inside.join("\n")}\n${pad}\t</g>`;
	return `${pad}<g transform="translate(${round(frame.x)},${round(frame.y)})" data-node="${escapeAttr(node.id)}" data-kind="${node.kind}">${own}${kids}\n${pad}</g>`;
}

function svgExport(
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
): string {
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
				clips,
			),
		)
		.join("\n");

	const custom: Declarations = {};
	for (const token of index.scene.tokens) {
		if (!used.has(token.id)) continue;
		const value = resolveValue(
			{ tokens: index.scene.tokens, picks: base.universe.pick },
			token.value,
			tokenVar(token.id),
		);
		if (value !== undefined) custom[`--${index.custom.get(token.id)}`] = value;
	}
	// `svg` rather than `:root`, so the definitions hold both in a standalone
	// file and when this markup is pasted into an HTML page.
	const definitions =
		Object.keys(custom).length === 0 ? "" : `svg {\n${cssText(custom, "\t")}\n}\n`;
	const style = `\n<style>\n${definitions}text { white-space: pre; }\n</style>`;
	const defs = clips.length === 0 ? "" : `\n<defs>\n\t${clips.join("\n\t")}\n</defs>`;
	const title = options.title ? `\n<title>${escapeText(options.title)}</title>` : "";

	const w = round(bounds.width);
	const h = round(bounds.height);
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif" fill="#0f172a">${title}${style}${defs}
${body}
</svg>
`;
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

/** Where two models disagree about anything but a frame. */
function sameStructure(a: ModelScene, b: ModelScene): boolean {
	const ids = Object.keys(a.byId).sort();
	if (ids.join(" ") !== Object.keys(b.byId).sort().join(" ")) return false;
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
 * Whether this space is one artefact rather than N designs.
 *
 * The claim being tested is narrow and worth stating exactly. A document whose
 * universes differ only by layout `direction` *is* a media query; one whose
 * universes differ only by colour *is* a theme. Both are true, and both stop
 * being true the moment anything else differs — so the test is:
 *
 *   1. the universes differ in exactly one variable;
 *   2. that variable has a meaning the target understands, which today means
 *      a colour token (a theme) or a container's direction (a breakpoint);
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
		// of what `prefers-color-scheme: dark` asks for. More than two has no
		// light and dark to be, and calling the third one "dark" would be a lie.
		if (universes.length === 2) {
			const [light, dark] = byBrightness(scene, universes, parsed.token);
			return {
				kind: "theme",
				variable,
				label: token.name,
				// The preference is a *default*, so it goes on the media query
				// alone; the attribute is the same universe again, so that a page
				// can force either way whatever the browser says.
				layers: [
					{ universe: light, media: null, under: null, label: `${token.name}: the light value` },
					{
						universe: dark,
						media: "(prefers-color-scheme: dark)",
						under: null,
						label: `${token.name}: the darker value, when the reader prefers a dark scheme`,
					},
					{
						universe: dark,
						media: null,
						under: '[data-theme="dark"]',
						label: `${token.name}: the darker value, forced`,
					},
				],
				note: `One artefact, themed on “${token.name}”: the darker value under prefers-color-scheme: dark, or forced with data-theme="dark".`,
			};
		}
		return {
			kind: "theme",
			variable,
			label: token.name,
			layers: universes.map((universe, i) => ({
				universe,
				media: null,
				under: i === 0 ? null : `[data-theme="alt-${i}"]`,
				label:
					i === 0
						? `${token.name}: the default`
						: `${token.name}: [data-theme="alt-${i}"]`,
			})),
			note: `One artefact with ${universes.length} themes on “${token.name}”, selected with data-theme.`,
		};
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
		const wideWidth = Math.ceil(modelBounds(universes[wide].model).width);
		const layers: Layer[] = [
			{
				universe: universes[narrow],
				media: null,
				under: null,
				label: "Column: the narrow layout, and the base",
			},
			{
				universe: universes[wide],
				media: `(min-width: ${wideWidth}px)`,
				under: null,
				label: `Row: from ${wideWidth}px, the width the row actually needs`,
			},
		];
		return {
			kind: "breakpoint",
			variable,
			label: LAYOUT_PROPS.direction.label,
			layers,
			note: `One artefact with a breakpoint: the column layout below ${wideWidth}px and the row at or above it.`,
		};
	}

	return {
		reason: `These designs differ only in ${describe(scene, variable)}, and no target has a mechanism for that — a stylesheet has no way to know which of the values is the narrow screen, or the dark one. Export a single design instead.`,
	};
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
	return `the value of rule ${parsed.constraint}`;
}

/* ------------------------------------------------------------------ */
/* The two entry points                                                */
/* ------------------------------------------------------------------ */

function emit(
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
	note: string,
): ExportResult {
	const spec = EXPORT_TARGETS[options.target];
	const text =
		layers.length === 0
			? ""
			: options.target === "svg"
				? svgExport(index, layers, options)
				: htmlExport(index, layers, options);
	const lost = [...ALWAYS_LOST, ...spec.loses];
	if (options.tokens === false) {
		lost.push("Token names: every value is inlined as the literal it resolved to.");
	}
	if (layers.length > 1) {
		// The collapsed export keeps the varying variable; everything else about
		// the space is still gone.
		lost[0] =
			"The rest of the space. This artefact holds the one variable that separates these designs; any other design in the document is not in it.";
	}
	return {
		target: options.target,
		filename: `${slug(options.title ?? "design")}.${spec.extension}`,
		text,
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
	return emit(index, collapsed.layers, options, collapsed.note);
}
