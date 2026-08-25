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
 * A style is the one thing here that is not a translation but an *identity*: a
 * style is a shared bundle of declarations under a name, and so is a CSS class.
 * So it comes out as one — see {@link styleClasses} — and a wearer's rule holds
 * only what it says for itself. That is the whole of why the HTML target got
 * smaller and readable at the same time; nothing else in this file changed.
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
	type Style,
	findStyle,
	frameOf,
	propValueOf,
	styleProps,
	variantLabel,
	wornProps,
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
	numeralOf,
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
			"A style is not a class here. An SVG is read by things that apply the presentation attributes and skip the stylesheet, so every wearer carries the treatment inlined: the correlation is in the picture, but it is not in the file.",
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
	const value = documentValue(index, variable, picks);
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
/* A style, as a class                                                 */
/* ------------------------------------------------------------------ */

/** Which function turns this property into declarations for this kind, if any. */
function paintFor(
	kind: NodeKind,
	prop: PropName,
): ((value: string) => Declarations) | undefined {
	if (!KINDS[kind].props.includes(prop)) return undefined;
	return SHAPE_PAINT[kind]?.paint?.[prop] ?? PAINT[prop];
}

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
	/** Wearers drawn in this universe, by node id, in document order. */
	wearers: string[];
	/** Per wearer, the properties it takes from the style rather than states. */
	worn: Map<string, Set<PropName>>;
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
 * Read off the *document*, because that is where wearing lives: `sty_wears/3`
 * is a predicate a rule may assert too, and the answer set does not report it
 * back. Those nodes come out with the properties inlined, exactly as a
 * rule-minted node's token link comes out as a literal, and for the same
 * reason. Named in {@link ExportResult.lost}.
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
		const said = paint(token ? `var(--${index.custom.get(token.id)})` : value);
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
		const paint = paintFor(node.kind, prop);
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

function htmlBody(
	index: DocIndex,
	slots: readonly Slot[],
	layer: Layer,
	/** The style class each wearer carries beside its own, if any. */
	wearing: Map<string, string>,
): string {
	const byId = new Map(slots.map((s) => [s.id, s] as const));
	const render = (node: ModelNode, depth: number, pretty: boolean): string => {
		const slot = byId.get(node.id);
		if (!slot) return "";
		const pad = pretty ? "\t".repeat(depth + 2) : "";
		const worn = wearing.get(node.id);
		const names = worn === undefined ? slot.className : `${slot.className} ${worn}`;
		const open = `${pad}<div class="${names}" data-node="${escapeAttr(node.id)}" data-kind="${node.kind}">`;
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

/** The file, and what it turned out to hold — see {@link ExportResult.lost}. */
interface Emitted {
	text: string;
	/** The styles that came out as classes. */
	classes: StyleClass[];
}

function htmlExport(
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
): Emitted {
	const useTokens = options.tokens !== false;
	const base = layers[0];
	const slots = slotsOf(base.universe.model);
	const used = new Set<string>();
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
		out.set(".design", {
			width: px(origin.width),
			height: px(origin.height),
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
		const byId = new Map(slots.map((s) => [s.id, s] as const));
		const walk = (node: ModelNode, root: boolean): void => {
			const slot = byId.get(node.id);
			if (slot) {
				const own: Declarations = {
					...geometry(index, layer, node, root, origin, useTokens, used),
					...declarationsFor(index, layer, node, useTokens, used),
				};
				// Whatever the class already says for a property this node takes
				// from it. Decided by which property it is rather than by comparing
				// the two values, so that turning token names off cannot change the
				// shape of the output — only what the declarations read as.
				for (const key of shared.get(node.id) ?? []) delete own[key];
				out.set(`.${slot.className}`, own);
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
			const block = rule(scope(selector, layer.under), changed, indent);
			if (block) inner.push(block);
		}
		if (inner.length === 0) continue;
		css.push(`/* ${layer.label} */`);
		css.push(
			layer.media ? `@media ${layer.media} {\n${inner.join("\n")}\n}` : inner.join("\n"),
		);
	}

	const title = escapeText(options.title ?? "Design");
	return {
		classes,
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
${htmlBody(index, slots, base, wearing)}
\t</div>
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
	return {
		classes: [],
		text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif" fill="#0f172a">${title}${style}${defs}
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
	const width = Math.ceil(modelBounds(wide.model).width);
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
}

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
			const values = universes.map((u) => u.model.byId[node.id]?.rendered[prop]);
			if (values.some((v) => v === undefined)) continue;
			const said = values as string[];
			if (new Set(said).size > 1) out.push({ prop, node: node.id, values: said });
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
 *   3. **The document states the order.** One variant's lengths are all smaller
 *      than the other's, and the tighter type scale is the narrow screen —
 *      which is what every responsive type ramp there has ever been means. Where
 *      the lengths disagree about which variant is the tighter one, there is no
 *      narrow design to pick and this refuses.
 *
 * And where the variants differ only in colour, the same argument makes it a
 * theme instead, ordered by the ground it paints.
 *
 * The limits, all of them:
 *
 *   - two variants for a breakpoint. A third has no pair of screens to be, the
 *     same way a third direction would not;
 *   - at least one length has to differ, and the lengths have to agree. A style
 *     that varies only its weight, its family or its leading carries no claim
 *     about screen width, and is refused rather than guessed at;
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

	// Otherwise the lengths decide, if they agree.
	const lengths = changes.filter(
		(change) => PROPS[change.prop].type === "length" && readable(change),
	);
	if (lengths.length === 0) {
		const named = changes
			.map((change) => PROPS[change.prop].label.toLowerCase())
			.join(", ");
		return {
			reason: `The variants of “${style.name}” differ in ${named}, and none of that is a length. A stylesheet has no way to know which of two weights or two families is the narrow screen, so this exports as one design at a time.`,
		};
	}
	if (universes.length !== 2) {
		return {
			reason: `“${style.name}” has ${universes.length} treatments in play and a breakpoint has two sides, so there is no pair of screens to map them onto.`,
		};
	}
	const ways = new Set(
		lengths.map((change) => Math.sign(numeral(change.values[1]) - numeral(change.values[0]))),
	);
	if (ways.size !== 1) {
		return {
			reason: `The lengths in “${style.name}” disagree about which treatment is the tighter one — one of them grows where another shrinks — so neither variant is the narrow screen.`,
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

/** The number a rendered length reads as, and 0 where it reads as nothing. */
const numeral = (text: string): number => numeralOf(text) ?? 0;

/** True where every universe's value for this property is a number. */
const readable = (change: StyleChange): boolean =>
	change.values.every((value) => numeralOf(value) !== undefined);

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
	if (parsed.kind === "style") {
		return `the style “${findStyle(scene.styles, parsed.style)?.name ?? parsed.style}”`;
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
	/** The variable the layers switch between, where they switch one. */
	varying?: string,
): ExportResult {
	const spec = EXPORT_TARGETS[options.target];
	const out: Emitted =
		layers.length === 0
			? { text: "", classes: [] }
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
		lost.push(
			"A style a rule handed a node. Wearing is read from the document, so a node dressed by an asserted sty_wears/3 carries its properties inlined and shares no class.",
		);
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
