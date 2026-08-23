/**
 * The size a node asks for when its own content decides, not its box.
 *
 * Nothing here measures anything. Measuring text needs a font engine, and the
 * only one available is the browser's canvas — so the host measures and hands
 * the numbers in as plain pixels, and this side is arithmetic over them. That
 * is what keeps the compiler pure and testable in Node, where no canvas exists.
 */
import { KINDS, PROPS, type SceneNode, type Sizing, isLaidOut } from "./scene.ts";
import { flatten } from "./tree.ts";

export interface Size {
	width: number;
	height: number;
}

/** Natural sizes the host measured, by node id. */
export type Measurements = Readonly<Record<string, Size>>;

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
export function askedSize(node: SceneNode, measured?: Measurements): Size {
	const size = autoSizes(node) ? measured?.[node.id] : undefined;
	return size ?? { width: node.frame.width, height: node.frame.height };
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
 */
export function naturalSize(node: SceneNode, measured?: Measurements): Size {
	const layout = node.layout;
	if (!layout || layout.sizing !== "hug" || !isLaidOut(node)) {
		return askedSize(node, measured);
	}
	const children = (node.children ?? []).map((c) => naturalSize(c, measured));
	const pad = Math.max(0, layout.padding);
	const gap = Math.max(0, layout.gap);
	const row = layout.direction === "row";
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
