/**
 * The size a node asks for when its own content decides, not its box.
 *
 * Nothing here measures anything. Measuring text needs a font engine, and the
 * only one available is the browser's canvas — so the host measures and hands
 * the numbers in as plain pixels, and this side is arithmetic over them. That
 * is what keeps the compiler pure and testable in Node, where no canvas exists.
 */
import {
	KINDS,
	PROPS,
	type SceneNode,
	type Sizing,
	frameOf,
	isLaidOut,
	layoutLength,
	layoutValueOf,
	layoutWord,
} from "./scene.ts";
import { flatten } from "./tree.ts";
import { type ResolveContext, varies } from "./values.ts";

export interface Size {
	width: number;
	height: number;
}

/** Natural sizes the host measured, by node id. */
/**
 * Measured sizes, per node, **per alternative of its content**.
 *
 * Copy is a value like any other now, so a text node may say one thing in one
 * universe and another somewhere else, and the two do not occupy the same
 * space. One size per node would silently be the first alternative's.
 */
export type Measurements = Readonly<Record<string, readonly Size[]>>;

/** Has content whose size can be measured. */
export const isMeasured = (node: SceneNode): boolean =>
	KINDS[node.kind].measured;

/**
 * Whether a node takes its size from its content.
 *
 * Automatic is the default, for the same reason a layout hugs by default: the
 * box a text node happened to be dragged out at says nothing about the words
 * that ended up in it.
 */
export function autoSizes(node: SceneNode): boolean {
	return isMeasured(node) && sizingOf(node) === "hug";
}

/** How a node decides its own size. Only the measured kinds have a say. */
export function sizingOf(node: SceneNode): Sizing {
	if (!isMeasured(node)) return "fixed";
	return node.sizing === "fixed" ? "fixed" : "hug";
}

/**
 * What a node asks to be: its measurement if it has one, otherwise its frame.
 *
 * A measurement the host did not supply is not an error — the first render
 * happens before anything has been measured, and a headless solve has no
 * canvas at all — so the frame is always there to fall back to.
 */
export function askedSize(
	node: SceneNode,
	measured?: Measurements,
	alternative = 0,
	context?: ResolveContext,
): Size {
	const sizes = autoSizes(node) ? measured?.[node.id] : undefined;
	// Out of range falls back to the first: an alternative can be deleted
	// between a measurement and the solve that reads it.
	const size = sizes?.[alternative] ?? sizes?.[0];
	if (size) return size;
	const frame = frameOf(node, context);
	return { width: frame.width, height: frame.height };
}

/** How many measured sizes a node has — one per alternative of its content. */
export function measuredCount(
	node: SceneNode,
	measured?: Measurements,
): number {
	return measured?.[node.id]?.length ?? 0;
}

/**
 * What a node would be with nothing pushing on it, its contents included.
 *
 * A hugging container's stored frame is stale by construction — the solver owns
 * its size — so a parent needing to know how big such a child is cannot read it
 * off the document. Nor can it ask the solver for it: the cross axis takes a
 * *maximum* over the children, and a maximum over solved values is not a linear
 * constraint. So it is a bottom-up pass here, over exactly the arithmetic the
 * layout rules use, and the answer goes in as that node's `lask` fact.
 *
 * `context` is what the layout's own settings resolve against, so a gap that
 * names a token counts as the token's length. It carries no picks: this runs
 * *before* the solve that decides them, so a setting with alternatives is read
 * at its first — the same approximation this pass already makes for a nested
 * text node's wording.
 */
export function naturalSize(
	node: SceneNode,
	measured?: Measurements,
	context?: ResolveContext,
): Size {
	// A container whose sizing is itself a choice has no one natural size, so
	// it asks for the frame it was drawn at: that is exactly what the fixed
	// alternative means, and the hugging one works its own size out from the
	// equations and never reads this.
	if (
		!isLaidOut(node) ||
		varies(layoutValueOf(node, "sizing")) ||
		layoutWord(node, "sizing", context) !== "hug"
	) {
		return askedSize(node, measured, 0, context);
	}
	const children = (node.children ?? []).map((c) =>
		naturalSize(c, measured, context),
	);
	const pad = layoutLength(node, "padding", context);
	const gap = layoutLength(node, "gap", context);
	const row = layoutWord(node, "direction", context) === "row";
	const main = (s: Size) => (row ? s.width : s.height);
	const cross = (s: Size) => (row ? s.height : s.width);
	const along =
		children.reduce((total, s) => total + main(s), 0) +
		gap * (children.length - 1) +
		2 * pad;
	const across = Math.max(...children.map(cross)) + 2 * pad;
	return row
		? { width: along, height: across }
		: { width: across, height: along };
}

/** The nodes the host should measure, at any depth. */
export function toMeasure(nodes: readonly SceneNode[]): SceneNode[] {
	return flatten(nodes).filter(autoSizes);
}

export interface FontSpec {
	/** A CSS font-family list, as stored. */
	family: string;
	/** A CSS length. */
	size: string;
	weight: string;
}

/**
 * A CSS `font` shorthand — the one string a canvas 2D context understands, and
 * the form pretext wants. Order is fixed by CSS: weight, then size, then the
 * family list.
 */
export function fontString(spec: FontSpec): string {
	return `${spec.weight} ${spec.size} ${spec.family}`;
}

/** A CSS length in pixels. Only px and bare numbers occur in this model. */
export function pixels(value: string | undefined, fallback: number): number {
	const n = Number.parseFloat(value ?? "");
	return Number.isFinite(n) ? n : fallback;
}

/**
 * How tall one line is, in pixels.
 *
 * CSS reads a unitless line-height as a multiple of the font size and a length
 * as itself; the inspector offers the former, but a document may hold either.
 */
export function lineHeightPx(
	fontSize: string | undefined,
	lineHeight: string | undefined,
): number {
	const size = pixels(fontSize, pixels(PROPS.size.fallback, 16));
	const raw = (lineHeight ?? "").trim();
	const ratio = Number(raw);
	if (raw !== "" && Number.isFinite(ratio)) return size * ratio;
	if (raw.endsWith("px")) return pixels(raw, size);
	return size * Number(PROPS.lineHeight.fallback);
}
