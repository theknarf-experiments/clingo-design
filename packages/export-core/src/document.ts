/**
 * The document and the answer set, as every target needs them.
 *
 * Names, an index, the layers an artefact is made of, and EMU in CSS pixels
 * out. None of it is target-specific — an SVG and a stylesheet want the same
 * class names off the same styles and the same numbers off the same frames —
 * which is exactly why it is here rather than in either of them.
 */
import type {
	Declarations,
	Dimension,
	Emu,
	Frame,
	ModelNode,
	ModelScene,
	NodeKind,
	Picks,
	PropName,
	Scene,
	SceneNode,
	Style,
	Token,
	Value,
} from "@clingo-design/design-core";

import type { ExportOptions, ExportUniverse } from "./options.ts";
import {
	KINDS,
	activeTerm,
	cssLength,
	cssPx,
	cssPxFromEmu,
	cssRound,
	findToken,
	flatten,
	isLengthType,
	parseInstancePart,
	parseVariable,
	propValueOf,
	resolveValue,
	tokenVar,
} from "@clingo-design/design-core";

/* ------------------------------------------------------------------ */
/* Token names                                                         */
/* ------------------------------------------------------------------ */

/** `Brand blue` -> `brand-blue`, and never something CSS cannot parse. */
export function slug(name: string): string {
	const cleaned = name
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (cleaned === "") return "t";
	return /^[0-9]/.test(cleaned) ? `t-${cleaned}` : cleaned;
}

/** Custom-property names for every token, distinct even where the names collide. */
export function customNames(tokens: readonly Token[]): Map<string, string> {
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
export function styleClassNames(styles: readonly Style[]): Map<string, string> {
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
export interface DocIndex {
	scene: Scene;
	byId: Map<string, SceneNode>;
	custom: Map<string, string>;
	/** Class name per style id — see {@link styleClassNames}. */
	styleClass: Map<string, string>;
}

export function indexDocument(scene: Scene): DocIndex {
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
export function docNode(index: DocIndex, id: string): SceneNode | undefined {
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
export function documentValue(
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
export function tokenNamed(
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
export function valueNamed(
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
export function customProperties(
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
export interface Slot {
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
export const stopsHere = (kind: NodeKind): boolean => KINDS[kind].opaque;

/** Pre-order over the model, which is also paint order — down to a viewport. */
export function slotsOf(model: ModelScene): Slot[] {
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
export function viewportsIn(model: ModelScene): Array<{ node: ModelNode; inside: number }> {
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
export function posterFor(options: ExportOptions, node: ModelNode): Declarations {
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
export function modelBounds(model: ModelScene): Frame {
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
export const round = cssRound;

/** A length as a CSS declaration takes it. */
export const px = (emu: Emu): string => `${cssPx(emu)}px`;

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
export const framePx = (frame: Frame): Frame => ({
	x: cssPxFromEmu(frame.x),
	y: cssPxFromEmu(frame.y),
	width: cssPxFromEmu(frame.width),
	height: cssPxFromEmu(frame.height),
});

