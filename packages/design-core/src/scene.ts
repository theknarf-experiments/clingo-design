/**
 * The design document.
 *
 * Geometry is continuous and relative to the enclosing node — a node has
 * x/y/width/height the way a designer expects. Each of those four is a
 * {@link Value} like everything else a renderer or solver reads as a leaf, so
 * "this sits here on desktop and there on mobile" is one document with two
 * universes rather than two documents. A dimension still reaches ASP as a
 * number, not as a choosable domain: the *pick* is over the handful of
 * alternatives written down, and `frame/3` is derived from it.
 *
 * Every length here is **EMU** — see `units.ts` — while the *document* still
 * stores the text a designer typed, unit and all: `"24px"`, `"12pt"`, `"0.25in"`.
 * So this file is where the two meet. It reads with `emuOf`, which is exact or
 * nothing, and writes with {@link writeLength}, which spells a value back in the
 * unit it was already written in. Nothing in it rounds a conversion, and the one
 * rounding left is a claim about a pointer rather than about a number.
 *
 * Everything is a {@link Value}: a list of alternatives, each a literal or
 * a token reference. One alternative is an ordinary design; two or more is a
 * branch the solver explores.
 */
import { type Frame, MIN_NODE_SIZE, type PathPoint, boundsOf } from "./geometry.ts";
import {
	DEFAULT_UNIT,
	EMU_PER_PX,
	type Emu,
	type Unit,
	emuOf,
	formatLength,
	quantizeGesture,
	unitOf,
} from "./units.ts";
import {
	type Picks,
	type ResolveContext,
	type Token,
	VALUE_TYPES,
	type Value,
	type ValueType,
	activeIndex,
	constraintVar,
	frameVar,
	guideAtVar,
	guideVar,
	layoutVar,
	lit,
	motionVar,
	msOf,
	ref,
	resolveValue,
	single,
	styleVar,
	tallyOf,
	type Term,
	wordOf,
} from "./values.ts";
import { parseAtom } from "./atoms.ts";

/* ------------------------------------------------------------------ */
/* Writing a length down                                               */
/* ------------------------------------------------------------------ */

/**
 * How this file writes a length it *computed* — from a pointer, from a sum of
 * other lengths, from a default one of the tables below states.
 *
 * One writer where there were two: a module-private `px()` for frames and an
 * exported `dimension()` for constraint values, eleven hundred lines apart and
 * with a `Math.round` each. They had already drifted once.
 *
 * Two steps, and neither belongs at a call site because forgetting either is
 * invisible. **Quantizing** puts the value on a whole pixel. The old rounding
 * was there to keep `numeral/2` an integer and that reason is gone, but a second
 * one is not: a hand moving a mouse means a pixel, and without a quantum every
 * drag would write `"10.4px"` where it used to write `"10px"` — sub-pixel noise
 * in a document two people share, bought with precision no hand has. A whole
 * *pixel* rather than a whole `unit`, because the pointer is what is being
 * quantized and a pointer moves in pixels; a whole millimetre would be four
 * pixels of dead travel per step. **Spelling** in `unit` is what keeps a
 * designer's units across an edit: drag a node whose x is `"12pt"` and it comes
 * back `"12.75pt"`, because one pixel is exactly 0.75pt.
 *
 * The two steps can disagree, and where they do the spelling loses: nothing
 * spells a whole pixel in millimetres (9525 EMU is not a multiple of 9), so a
 * dragged millimetre value comes back in pixels, which is the fallback
 * {@link formatLength} was given for. A print document is still measured and
 * displayed in millimetres; what it cannot be is dragged in them, and the
 * inspector's field is where a person says `210mm` and means it.
 *
 * A length a *person typed* does not come through here. That is a statement
 * rather than a gesture — `12.5pt` means 12.5pt, and no pointer was involved —
 * so the inspector reads it with `nearestEmu` and writes it with
 * {@link formatLength}, unquantized.
 */
export function writeLength(emu: Emu, unit: Unit = DEFAULT_UNIT): string {
	return formatLength(quantizeGesture(emu), unit);
}

/**
 * A length one of the tables below states in whole pixels, as EMU and as the
 * text a document stores.
 *
 * The tables used to hold hand-typed strings — `"16px"`, `"2px"` — and under EMU
 * that is a promise rather than a fact. A fallback is read by `emuOf`, which is
 * exact or nothing, so an entry no unit could spell (`"8.5px"`) would make the
 * property silently say *nothing at all* rather than say 8.5. Writing them
 * through {@link writeLength} makes every entry exact by construction, and
 * leaves the number stated once, in the unit the person who chose it was
 * thinking in.
 */
const fromPx = (px: number): Emu => px * EMU_PER_PX;
const pxLength = (px: number): string => writeLength(fromPx(px));

export type PropName =
	| "text"
	| "fill"
	| "radius"
	| "stroke"
	| "strokeWidth"
	| "shadow"
	| "opacity"
	| "ink"
	| "fontFamily"
	| "size"
	| "weight"
	| "lineHeight"
	| "align";

export interface PropSpec {
	label: string;
	type: ValueType;
	/** Shown as the placeholder and used when adding an alternative. */
	fallback: string;
	/**
	 * A {@link Style} may decide it — see {@link STYLE_PROPS}.
	 *
	 * Required rather than optional, so adding a property is a decision made
	 * once here rather than a list somewhere else that quietly falls behind.
	 * Two things are out, and for different reasons:
	 *
	 *   - `text` is content, not treatment. A style that decided what a heading
	 *     said would make every heading wearing it say the same thing, which is
	 *     not what "these headings look alike" means.
	 *   - `opacity` is a state a node is *in* rather than part of how it is
	 *     drawn: a faded copy of a heading is the same treatment at half
	 *     strength, and a style that owned it would have to be duplicated to say
	 *     so. It composes with a style; it is not one of its fields.
	 */
	styleable: boolean;
	/**
	 * True when the CSS this property becomes is *inherited* — so a node that
	 * says nothing about it takes whatever its surroundings say.
	 *
	 * Which makes it the document's business rather than the node's: a design
	 * must look the same on the canvas and in an exported file, and an inherited
	 * property nobody declares is one the host page gets to decide. Every
	 * property marked here is declared once on the document itself — see
	 * `DOCUMENT_BASE` in paint.ts, and the test that holds the two in step.
	 *
	 * Required rather than optional, for the same reason {@link styleable} is:
	 * the answer is a fact about the property and belongs beside it.
	 */
	inherited: boolean;
}

export const PROPS: Record<PropName, PropSpec> = {
	// Content is a property like any other: a headline that reads one way or
	// another is a design decision, and the machinery for "one of these" is
	// already here. Nothing about a string made it special except history.
	text: {
		label: "Text",
		type: "text",
		fallback: VALUE_TYPES.text.fallback,
		styleable: false,
		inherited: false,
	},
	fill: {
		label: "Fill",
		type: "color",
		fallback: VALUE_TYPES.color.fallback,
		styleable: true,
		inherited: false,
	},
	radius: {
		label: "Corner radius",
		type: "length",
		fallback: VALUE_TYPES.length.fallback,
		styleable: true,
		inherited: false,
	},
	stroke: {
		label: "Stroke",
		type: "color",
		fallback: "#0f172a",
		styleable: true,
		inherited: false,
	},
	strokeWidth: {
		label: "Thickness",
		type: "length",
		fallback: pxLength(2),
		styleable: true,
		inherited: false,
	},
	shadow: {
		label: "Shadow",
		type: "shadow",
		fallback: VALUE_TYPES.shadow.fallback,
		styleable: true,
		inherited: false,
	},
	opacity: {
		label: "Opacity",
		type: "number",
		fallback: "1",
		styleable: false,
		inherited: false,
	},
	ink: {
		label: "Colour",
		type: "color",
		fallback: "#0f172a",
		styleable: true,
		inherited: true,
	},
	fontFamily: {
		label: "Font",
		type: "font",
		fallback: VALUE_TYPES.font.fallback,
		styleable: true,
		inherited: true,
	},
	size: {
		label: "Size",
		type: "length",
		fallback: pxLength(16),
		styleable: true,
		inherited: true,
	},
	weight: {
		label: "Weight",
		type: "weight",
		fallback: VALUE_TYPES.weight.fallback,
		styleable: true,
		inherited: true,
	},
	// A `number`, not a length, and that is not an oversight: CSS reads a
	// unitless line height as a multiple of the font size, which is what makes a
	// type scale hold together when the size changes. The one place the
	// difference bit — a breakpoint has to know which of two treatments is the
	// tighter one, and a ratio cannot say on its own — is answered where that
	// question is asked, by `ROOMINESS` in export.ts, which reads the leading in
	// pixels. Typing it as a length instead would have offered `8px` in the
	// inspector and let a scale of lengths link to it, to fix a comparison
	// happening somewhere else.
	lineHeight: {
		label: "Line height",
		type: "number",
		fallback: "1.35",
		styleable: true,
		inherited: true,
	},
	// In, deliberately. Alignment is part of a typographic treatment the way
	// weight is — "display: large, heavy, centred" against "body: small,
	// regular, left" is one decision, not two — and it is a closed menu like
	// every other field of one. Leaving it out would have been the arbitrary
	// choice, not putting it in.
	align: {
		label: "Alignment",
		type: "align",
		fallback: VALUE_TYPES.align.fallback,
		styleable: true,
		inherited: true,
	},
};

export const PROP_NAMES = Object.keys(PROPS) as PropName[];

/**
 * The properties a {@link Style} may decide, read off the one table that says
 * what a property is.
 *
 * Generic over the property set rather than a typographic feature with a
 * typographic table: the mechanism for "size and weight move together" is
 * character for character the mechanism for "fill, radius and shadow move
 * together", and a surface style is therefore not a thing to build later. What
 * makes a style a *text* style is which of these fields it happens to fill in,
 * plus the fact that only a text node has anywhere to put them — see
 * {@link styleProps}.
 */
export const STYLE_PROPS = PROP_NAMES.filter((p) => PROPS[p].styleable);

export type NodeKind =
	| "frame"
	| "rect"
	| "ellipse"
	| "line"
	| "arrow"
	| "path"
	| "text"
	| "group"
	| "instance";

/**
 * What a kind of node *is*, in one place.
 *
 * Everything downstream — hit testing, snapping, selection, grouping, the
 * renderer, the toolbar — asks this table rather than comparing kind names, so
 * adding a kind is one entry here plus whatever genuinely new behaviour it
 * needs, not a hunt through two dozen `kind === "frame"` checks.
 */
export interface KindSpec {
	/** Shown in the toolbar, and the name a new node gets. */
	label: string;
	/** Properties the inspector shows, in order. */
	props: PropName[];
	/**
	 * What a new node of this kind starts with.
	 *
	 * A property the inspector offers but that is missing here paints nothing
	 * until it is set — which is what an optional flourish like a stroke or a
	 * shadow should do, rather than appearing on every shape ever drawn.
	 */
	defaults: Partial<Record<PropName, Value>>;
	/** Size a click with no drag produces, in EMU — see {@link fromPx}. */
	defaultSize: { width: Emu; height: Emu };
	/** Has pixels of its own: it paints, it can be hit, it attracts snaps. */
	drawable: boolean;
	/**
	 * A pointer can draw one out, so the toolbar gets a slot for it.
	 *
	 * Not the same question as {@link drawable}: a group and an instance both
	 * have pixels and can be clicked, and neither is something you drag a box
	 * out to create — a group is made from a selection and an instance from a
	 * definition.
	 */
	tool: boolean;
	/** Holds children. */
	container: boolean;
	/**
	 * An artboard-like surface: it clips, new nodes drawn over it land inside
	 * it, its edges bound snapping, and a click inside selects what was clicked
	 * rather than the surface.
	 */
	surface: boolean;
	/**
	 * A wrapper around its children rather than a thing in its own right: it
	 * re-fits to whatever they occupy, selects as one object, and dissolves
	 * back into its parent when ungrouped.
	 */
	wrapsChildren: boolean;
	/**
	 * A plain shape. They share one toolbar slot with a menu behind it: a bar
	 * with a button per shape is a bar nobody reads.
	 */
	shape: boolean;
	/**
	 * Drawn as a stroke along a diagonal of its frame rather than as a box.
	 *
	 * Geometry in this model is an axis-aligned frame, so a line is stored as
	 * *its bounding box* plus which way it leans — see {@link SceneNode.diagonal}.
	 * Every gesture, snap, group and layout rule then works on a line unchanged;
	 * the price is that a line can only run corner to corner, so an arbitrary
	 * angle is not expressible.
	 */
	diagonal: boolean;
	/**
	 * Has content with a size of its own, so the box it was dragged out at is
	 * only a starting point.
	 *
	 * The measuring is not done here: it needs a font engine, and the only one
	 * available is the browser's canvas. The host measures and hands the
	 * numbers in — see `measure.ts`.
	 */
	measured: boolean;
	/**
	 * Drawn by placing point after point rather than by dragging a box out.
	 *
	 * Its real geometry is {@link SceneNode.points}; the frame is only their
	 * bounding box, which every edit keeps in step. Everything that works on
	 * frames — hit testing, snapping, grouping, automatic layout — therefore
	 * works on one unchanged.
	 */
	plotted: boolean;
}

/** Which corner-to-corner run a diagonal kind draws. */
export type Diagonal = "down" | "up";

export const KINDS: Record<NodeKind, KindSpec> = {
	frame: {
		label: "Frame",
		props: ["fill", "radius", "stroke", "strokeWidth", "shadow", "opacity"],
		defaults: { fill: [lit("#ffffff")] },
		defaultSize: { width: fromPx(480), height: fromPx(320) },
		drawable: true,
		tool: true,
		container: true,
		surface: true,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
	},
	rect: {
		label: "Rectangle",
		props: ["fill", "radius", "stroke", "strokeWidth", "shadow", "opacity"],
		defaults: {
			fill: [lit(PROPS.fill.fallback)],
			radius: [lit(PROPS.radius.fallback)],
		},
		defaultSize: { width: fromPx(160), height: fromPx(120) },
		drawable: true,
		tool: true,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: true,
		diagonal: false,
		measured: false,
		plotted: false,
	},
	ellipse: {
		// A corner radius on something with no corners says nothing, so fill is
		// the whole of an ellipse's appearance.
		label: "Ellipse",
		props: ["fill", "stroke", "strokeWidth", "shadow", "opacity"],
		defaults: { fill: [lit(PROPS.fill.fallback)] },
		defaultSize: { width: fromPx(140), height: fromPx(140) },
		drawable: true,
		tool: true,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: true,
		diagonal: false,
		measured: false,
		plotted: false,
	},
	line: {
		// No shadow: a box-shadow follows the node's box, and for a stroked kind
		// the box is only the rectangle the stroke happens to span — the shadow
		// would outline a shape the document does not contain.
		label: "Line",
		props: ["stroke", "strokeWidth", "opacity"],
		defaults: {
			stroke: [lit(PROPS.stroke.fallback)],
			strokeWidth: [lit(PROPS.strokeWidth.fallback)],
		},
		defaultSize: { width: fromPx(160), height: fromPx(96) },
		drawable: true,
		tool: true,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: true,
		diagonal: true,
		measured: false,
		plotted: false,
	},
	arrow: {
		label: "Arrow",
		props: ["stroke", "strokeWidth", "opacity"],
		defaults: {
			stroke: [lit(PROPS.stroke.fallback)],
			strokeWidth: [lit(PROPS.strokeWidth.fallback)],
		},
		defaultSize: { width: fromPx(160), height: fromPx(96) },
		drawable: true,
		tool: true,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: true,
		diagonal: true,
		measured: false,
		plotted: false,
	},
	path: {
		// Not a `shape`: the pen is a mode you stay in for several clicks, and
		// hiding it behind the shape menu would hide the only tool that needs
		// explaining.
		label: "Path",
		props: ["fill", "stroke", "strokeWidth", "opacity"],
		defaults: {
			fill: [lit(PROPS.fill.fallback)],
			stroke: [lit(PROPS.stroke.fallback)],
			strokeWidth: [lit(PROPS.strokeWidth.fallback)],
		},
		// Only reached by a caller that has no points to bound; the pen always
		// has some.
		defaultSize: { width: fromPx(120), height: fromPx(120) },
		drawable: true,
		tool: true,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: true,
	},
	text: {
		label: "Text",
		props: [
			"text",
			"ink",
			"fontFamily",
			"size",
			"weight",
			"lineHeight",
			"align",
			"opacity",
		],
		defaults: {
			text: [lit(PROPS.text.fallback)],
			ink: [lit(PROPS.ink.fallback)],
			size: [lit(PROPS.size.fallback)],
			weight: [lit(PROPS.weight.fallback)],
		},
		defaultSize: { width: fromPx(160), height: fromPx(28) },
		drawable: true,
		tool: true,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: true,
		plotted: false,
	},
	group: {
		label: "Group",
		props: [],
		defaults: {},
		defaultSize: { width: fromPx(0), height: fromPx(0) },
		drawable: false,
		tool: false,
		container: true,
		surface: false,
		wrapsChildren: true,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
	},
	/**
	 * A use of a component — see `components.ts`.
	 *
	 * It holds nothing itself: no children, no properties, no appearance. Every
	 * pixel inside it is a *derived* node the compiler's component rules produce
	 * from the definition, which is what makes editing the definition change
	 * every instance with nothing to propagate. What the document stores is
	 * where it sits, how big it is, which definition it uses, and which of the
	 * definition's open choices it has made up its mind about.
	 */
	instance: {
		label: "Instance",
		props: [],
		defaults: {},
		defaultSize: { width: fromPx(160), height: fromPx(48) },
		// Clickable and snappable: it is a thing on the canvas even though the
		// pixels belong to the copy inside it.
		drawable: true,
		// Never dragged out. An instance comes from a definition.
		tool: false,
		// The copy inside is derived, so there is nothing here for a drop to
		// land in — and a document child would be a child the definition does
		// not know about.
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
	},
};

export const NODE_KINDS = Object.keys(KINDS) as NodeKind[];

/**
 * The kinds a pointer can draw out. A group is only ever made from a selection,
 * and an instance only ever from a definition.
 */
export const DRAW_KINDS = NODE_KINDS.filter((k) => KINDS[k].tool);

/** The shapes, in the order their shared toolbar slot cycles through them. */
export const SHAPE_KINDS = DRAW_KINDS.filter((k) => KINDS[k].shape);

/**
 * These ask about the kind and nothing else, so they take anything that has
 * one — a document node, or a node read back out of an answer set.
 */
export interface Kinded {
	kind: NodeKind;
}

export const isDrawable = (node: Kinded): boolean => KINDS[node.kind].drawable;
export const isSurface = (node: Kinded): boolean => KINDS[node.kind].surface;
export const wrapsChildren = (node: Kinded): boolean =>
	KINDS[node.kind].wrapsChildren;
export const isDiagonal = (node: Kinded): boolean => KINDS[node.kind].diagonal;
export const isPlotted = (node: Kinded): boolean => KINDS[node.kind].plotted;
/**
 * True when a kind draws words inside its box, so `rendered.text` means
 * something for it.
 *
 * Off the property list rather than off a column of its own, because that is
 * already the answer: a kind draws text exactly when `text` is one of the
 * properties it paints. Not the same question as {@link KindSpec.measured},
 * which is about a node taking its *size* from its content — the two coincide
 * on the one kind that has both and would come apart on a kind that wrapped
 * text to a fixed box.
 */
export const drawsWords = (node: Kinded): boolean =>
	KINDS[node.kind].props.includes("text");

/* ------------------------------------------------------------------ */
/* Automatic layout                                                    */
/* ------------------------------------------------------------------ */

export type Direction = "row" | "column";
/** Where children sit on the axis they are *not* stacked along. */
export type Align = "start" | "center" | "end" | "stretch";
/**
 * Where the leftover space on the *stacking* axis goes.
 *
 * `spaceBetween` is one word because it reaches ASP as a constant, the way
 * `atMost` does — see {@link CONSTRAINT_KINDS}. The words a human reads are
 * the option labels in `VALUE_TYPES.justify`.
 */
export type Justify = "start" | "center" | "end" | "spaceBetween";
export type Sizing = "hug" | "fixed";

/** A setting the container holds. */
export type ContainerProp =
	| "direction"
	| "sizing"
	| "align"
	| "justify"
	| "gap"
	| "padding";
/** A setting one of its children holds about itself. */
export type ChildProp = "grow" | "alignSelf";
export type LayoutProp = ContainerProp | ChildProp;

export interface LayoutPropSpec {
	label: string;
	type: ValueType;
	fallback: string;
	/** Where it is stored: on the container, or on one of its children. */
	on: "container" | "child";
}

/**
 * Every input to the layout system, in one place.
 *
 * They are {@link Value}s, not scalars, for the same reason a fill is one: a
 * design system varies its direction between breakpoints and its gap between
 * densities, and neither is expressible by a document that can hold only one
 * of each. A gap that names a `length` token *is* a spacing scale.
 *
 * They are not {@link PROPS} because they are not a node's appearance —
 * nothing paints them, the solver reads them — and a per-kind property list is
 * the wrong home for a setting that only exists while a layout is switched on.
 * What they share with a property is the part that matters: a variable key
 * ({@link layoutVar}), alternatives, tokens, and a pick per universe.
 *
 * The compiler emits this table's option lists as facts and derives the layout
 * predicates from the pick, so adding a setting is an entry here plus one rule
 * — never a change to how a document is compiled.
 */
export const LAYOUT_PROPS: Record<LayoutProp, LayoutPropSpec> = {
	direction: {
		label: "Flow",
		type: "direction",
		fallback: VALUE_TYPES.direction.fallback,
		on: "container",
	},
	/**
	 * Whether the container takes its size from its contents.
	 *
	 * Hugging is the default because the alternative is a box whose size has
	 * nothing to do with what it holds: arrange four things in a row and a
	 * fixed container simply clips them.
	 */
	sizing: {
		label: "Size",
		type: "sizing",
		fallback: VALUE_TYPES.sizing.fallback,
		on: "container",
	},
	align: {
		label: "Align",
		type: "placement",
		fallback: VALUE_TYPES.placement.fallback,
		on: "container",
	},
	justify: {
		label: "Justify",
		type: "justify",
		fallback: VALUE_TYPES.justify.fallback,
		on: "container",
	},
	/** Between adjacent children. */
	gap: { label: "Gap", type: "length", fallback: pxLength(16), on: "container" },
	/** Inside every edge of the container. */
	padding: {
		label: "Padding",
		type: "length",
		fallback: pxLength(16),
		on: "container",
	},
	/** Under a laid-out parent: take a share of the leftover space. */
	grow: {
		label: "Grow",
		type: "growth",
		fallback: VALUE_TYPES.growth.fallback,
		on: "child",
	},
	/** Under a laid-out parent: sit differently from its siblings. */
	alignSelf: {
		label: "Align self",
		type: "placement",
		fallback: VALUE_TYPES.placement.fallback,
		on: "child",
	},
};

export const LAYOUT_PROP_NAMES = Object.keys(LAYOUT_PROPS) as LayoutProp[];
export const CONTAINER_PROPS = LAYOUT_PROP_NAMES.filter(
	(p) => LAYOUT_PROPS[p].on === "container",
) as ContainerProp[];
export const CHILD_PROPS = LAYOUT_PROP_NAMES.filter(
	(p) => LAYOUT_PROPS[p].on === "child",
) as ChildProp[];

/**
 * Turns a container into a solved layout rather than a free-form canvas.
 *
 * The positions are not stored: they are variables in a system of linear
 * equations the solver answers, which is why "these three share the leftover
 * space" is expressible at all. Everything here is an *input* to that system,
 * and every input is a value that may hold alternatives — see
 * {@link LAYOUT_PROPS}.
 */
export type AutoLayout = Record<ContainerProp, Value>;

/**
 * A layout from plain words and numbers — what a caller means when it has one
 * arrangement in mind rather than a space of them.
 *
 * Everything unstated takes the table's fallback, so this is also how a new
 * layout is made.
 *
 * A bare number here is **whole pixels**, not EMU, and that is not the exception
 * it looks like: a bare number is what a document means by pixels too, and every
 * caller of this is a template or a test writing down a gap the way a person
 * says one. A gesture never comes through here — nothing drags a gap — so there
 * is no pointer quantity to be confused with.
 */
export function makeLayout(
	spec: Partial<Record<ContainerProp, string | number>> = {},
): AutoLayout {
	const out = {} as AutoLayout;
	for (const prop of CONTAINER_PROPS) {
		const given = spec[prop];
		out[prop] = single(
			given === undefined
				? LAYOUT_PROPS[prop].fallback
				: typeof given === "number"
					? pxLength(given)
					: given,
		);
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* Guides: margins, a grid of tracks, and lines drawn by hand          */
/* ------------------------------------------------------------------ */

/** One setting of the grid a surface is ruled with. */
export type GuideProp =
	| "marginTop"
	| "marginRight"
	| "marginBottom"
	| "marginLeft"
	| "columns"
	| "gutter"
	| "rows"
	| "rowGutter";

export interface GuidePropSpec {
	label: string;
	type: ValueType;
	fallback: string;
	/**
	 * Which part of the track equation this setting is. A track's width is
	 * `(span - lead - trail - (N-1)*gutter) / N`, and every setting here is one
	 * of those four names.
	 */
	role: "margin" | "count" | "gutter";
	/**
	 * The axis the tracks are cut along: columns divide `x`, rows divide `y`.
	 *
	 * The same axis {@link EDGES} names, and named here for the same reason it is
	 * named there — so the rule that places a track is written over an axis
	 * variable rather than over the word `x`. A row grid is then the column rule
	 * with a different fact, which is what made rows worth having from the start
	 * instead of "later".
	 */
	axis: "x" | "y";
	/**
	 * For a margin: which end of that axis it is measured in from — matching
	 * {@link EdgeSpec.place}, so `marginLeft` and the `left` edge are the same
	 * end of the same axis. Absent on the counts and the gutters, which belong to
	 * the whole axis rather than to one end of it.
	 */
	place?: "lead" | "trail";
}

/**
 * Every input to the guide system, in one place.
 *
 * Shaped exactly like {@link LAYOUT_PROPS}, and for the same reasons, which is
 * the whole argument for building it this way: a bundle of settings a container
 * holds, none of which paints, all of which the solver reads, each free to vary.
 * Reusing that shape means the compiler emits this table's values as facts and
 * derives the grid from the pick, so adding a setting is one entry plus one rule.
 *
 * They are {@link Value}s rather than numbers, and the payoff is bigger here than
 * it is for a gap. A margin that names a `length` token *is* the page's spacing
 * scale. And a count holding two alternatives is a responsive grid written as one
 * document — twelve columns wide, six narrow — which means the solver can *pick*
 * a grid, and a constraint can decide which grid the design uses. That is the
 * thing the page-layout tools cannot say: in InDesign a second grid is a second
 * master page and a second copy of the layout.
 *
 * Absence is off. A node with no {@link SceneNode.guides} has no grid at all —
 * nothing emitted, nothing drawn — exactly as `layout === undefined` means no
 * automatic layout, and there is no `enabled` flag to keep in step with the
 * settings around it. That costs nothing, because the degenerate grid is already
 * free: one track with no margins is indistinguishable from no grid.
 */
export const GUIDE_PROPS: Record<GuideProp, GuidePropSpec> = {
	marginTop: {
		label: "Top margin",
		type: "length",
		fallback: pxLength(0),
		role: "margin",
		axis: "y",
		place: "lead",
	},
	marginRight: {
		label: "Right margin",
		type: "length",
		fallback: pxLength(0),
		role: "margin",
		axis: "x",
		place: "trail",
	},
	marginBottom: {
		label: "Bottom margin",
		type: "length",
		fallback: pxLength(0),
		role: "margin",
		axis: "y",
		place: "trail",
	},
	marginLeft: {
		label: "Left margin",
		type: "length",
		fallback: pxLength(0),
		role: "margin",
		axis: "x",
		place: "lead",
	},
	/**
	 * A `count`, not a `number` — see {@link VALUE_TYPES.count}. A number's
	 * inhabitants are 1.35 line heights and 0.5 opacities, and the rule that lays
	 * the tracks out grounds `1..N` over this one, so a fraction is not a wide
	 * grid but a hung grounder.
	 */
	columns: {
		label: "Columns",
		type: "count",
		fallback: VALUE_TYPES.count.fallback,
		role: "count",
		axis: "x",
	},
	gutter: {
		label: "Gutter",
		type: "length",
		fallback: pxLength(16),
		role: "gutter",
		axis: "x",
	},
	rows: {
		label: "Rows",
		type: "count",
		fallback: VALUE_TYPES.count.fallback,
		role: "count",
		axis: "y",
	},
	rowGutter: {
		label: "Row gutter",
		type: "length",
		fallback: pxLength(16),
		role: "gutter",
		axis: "y",
	},
};

export const GUIDE_PROP_NAMES = Object.keys(GUIDE_PROPS) as GuideProp[];

/** The one setting matching a description — the shape {@link edgeOn} has. */
const guidePropWhere = (
	matches: (spec: GuidePropSpec) => boolean,
): GuideProp => GUIDE_PROP_NAMES.find((p) => matches(GUIDE_PROPS[p])) as GuideProp;

/** How many tracks this axis is cut into: `columns` for x, `rows` for y. */
export const countOn = (axis: "x" | "y"): GuideProp =>
	guidePropWhere((s) => s.role === "count" && s.axis === axis);

/** The space between two adjacent tracks on this axis. */
export const gutterOn = (axis: "x" | "y"): GuideProp =>
	guidePropWhere((s) => s.role === "gutter" && s.axis === axis);

/** The margin at one end of this axis. */
export const marginOn = (
	axis: "x" | "y",
	place: "lead" | "trail",
): GuideProp =>
	guidePropWhere(
		(s) => s.role === "margin" && s.axis === axis && s.place === place,
	);

/**
 * The grid a surface is ruled with — margins and a count of tracks per axis.
 *
 * The twin of {@link AutoLayout}, down to the type: a record over the settings
 * table, every field a {@link Value}. What it describes is the opposite half of
 * the same idea. A layout *places* the children; a grid places nothing at all —
 * it says where the lines are, and a constraint decides what is pinned to them.
 * So a surface can hold both, and they never argue.
 */
export type SurfaceGuides = Record<GuideProp, Value>;

/**
 * A grid from plain words and numbers — what a template or a test means when it
 * has one grid in mind rather than a space of them. Everything unstated takes
 * the table's fallback, so this is also how a new grid is made.
 *
 * A bare number is **whole pixels**, exactly as it is in {@link makeLayout} and
 * for the same reason: a bare number is what a document means by pixels, and
 * nobody drags a margin into existence.
 */
export function makeGuides(
	spec: Partial<Record<GuideProp, string | number>> = {},
): SurfaceGuides {
	const out = {} as SurfaceGuides;
	for (const prop of GUIDE_PROP_NAMES) {
		const given = spec[prop];
		out[prop] = single(
			given === undefined
				? GUIDE_PROPS[prop].fallback
				: typeof given === "number"
					? // A count is a number of things, not a distance: `columns: 12`
						// is twelve, not twelve pixels' worth of columns.
						GUIDE_PROPS[prop].type === "count"
						? String(Math.trunc(given))
						: pxLength(given)
					: given,
		);
	}
	return out;
}

/**
 * One line a designer drew, on a surface.
 *
 * **In the surface's own local coordinates** — the same space a child's frame is
 * in, and the same invariant the whole document runs on: an operation on a node
 * says nothing about what it contains, and everything inside comes along on its
 * own. Move the artboard and its guides move; duplicate it and they duplicate;
 * a component definition carries its own. A world-space guide would be the one
 * piece of geometry that did not, and "the guide I put on this page" is what a
 * designer means every time. The pasteboard guides of a page-layout tool have no
 * equivalent here because there is no page model for them to be beside yet; when
 * one arrives, a spread-level guide is this same field one level up.
 *
 * {@link at} is a {@link Value} for the reason a frame dimension is: a guide that
 * names a token moves with the token, so dragging the guide can edit the token
 * and everything pinned to the guide follows. That is the thesis of the tool,
 * applied to the guide itself.
 */
export interface Guide {
	/**
	 * Unique among the lines of *its own surface*, and spellable as an ASP
	 * constant — it reaches the program inside a datum term ({@link lineDatum})
	 * and inside its own variable key ({@link guideAtVar}).
	 *
	 * Per surface rather than per document, which is what keeps duplication free:
	 * copy an artboard and the copy's lines keep their names under a new surface
	 * id, so `gl(frame2,g1)` is a different datum from `gl(frame1,g1)` without
	 * anything having to renumber.
	 */
	id: string;
	axis: "x" | "y";
	/** Where it sits, along that axis, relative to the surface's own origin. */
	at: Value;
	/**
	 * Do not let a gesture move it. A property of the guide, unlike whether
	 * guides are *shown*, which is a property of the person looking and lives in
	 * the editor — see the note on {@link SceneNode.lines}.
	 */
	locked?: boolean;
}

/**
 * True when this node's guides mean anything: it holds a grid, and it is the
 * kind of thing a grid can be drawn on.
 *
 * Mirrors {@link isLaidOut}, and asks {@link KINDS} rather than naming a kind. A
 * grid stored on a rectangle is not deleted on the way in — a stored document is
 * read, not corrected — it simply says nothing, here and in the compiler, which
 * both ask this.
 */
export const isGridded = (node: SceneNode): boolean =>
	node.guides !== undefined && KINDS[node.kind].surface;

/** Whatever a node stores for one guide setting, if anything. */
export function guideValueOf(
	node: SceneNode,
	prop: GuideProp,
): Value | undefined {
	return node.guides?.[prop];
}

/**
 * What a guide setting comes to, following whatever token it names — the same
 * walk the generated program does through `resolved/2`.
 *
 * Nothing for a setting the node does not hold, or one that resolves to no
 * literal at all; the program behaves the same way, and the caller falls back to
 * the table.
 */
export function guideSetting(
	node: SceneNode,
	prop: GuideProp,
	context: ResolveContext = NO_CONTEXT,
): string | undefined {
	return resolveValue(
		context,
		guideValueOf(node, prop),
		guideVar(node.id, prop),
	);
}

/**
 * A margin or a gutter, in EMU, falling back to the table's own default.
 *
 * Never negative, for the reason {@link layoutLength} is not: a margin of -8 is
 * not a page, and the track equation would read it as one.
 */
export function guideLength(
	node: SceneNode,
	prop: GuideProp,
	context?: ResolveContext,
): Emu {
	const resolved = guideSetting(node, prop, context);
	const n = resolved === undefined ? undefined : emuOf(resolved);
	return Math.max(0, n ?? emuOf(GUIDE_PROPS[prop].fallback) ?? 0);
}

/**
 * How many tracks an axis is cut into. **At least one**, always.
 *
 * The clamp is not tidiness: the track width divides by this number, so a grid
 * of zero columns is not an empty grid but an equation with no solution. One
 * track spanning the space inside the margins is what "no grid" already looks
 * like, so the degenerate case answers itself.
 *
 * Read with `tallyOf`, which refuses a fraction, a negative and anything past
 * `MAX_TALLY` — a count is the one quantity the *grounder* reads, and a mistyped
 * hundred thousand would hang clingo rather than draw a wrong picture.
 */
export function guideCount(
	node: SceneNode,
	prop: GuideProp,
	context?: ResolveContext,
): number {
	const resolved = guideSetting(node, prop, context);
	const n = resolved === undefined ? undefined : tallyOf(resolved);
	return Math.max(1, n ?? tallyOf(GUIDE_PROPS[prop].fallback) ?? 1);
}

/** The lines drawn on a node, in the order they were drawn. */
export const guideLines = (node: SceneNode): readonly Guide[] => node.lines ?? [];

export const findGuide = (
	node: SceneNode,
	id: string | undefined,
): Guide | undefined =>
	id === undefined ? undefined : guideLines(node).find((g) => g.id === id);

/**
 * A name for a new line on this surface: `g1`, `g2`, … — the first one free.
 *
 * Here rather than at whatever edit draws a guide, because the two things a
 * guide id has to be are facts about the document: spellable as an ASP constant,
 * since it reaches the program inside a term, and unused *on this surface*,
 * since that is the scope {@link Guide.id} is unique in. Both are easy to
 * satisfy by accident and impossible to notice having broken — a colliding id is
 * two datums answering to one name, which the solver reads as one datum.
 */
export function nextGuideId(node: SceneNode): string {
	const taken = new Set(guideLines(node).map((g) => g.id));
	for (let n = 1; ; n++) {
		const id = `g${n}`;
		if (!taken.has(id)) return id;
	}
}

/**
 * Where one line sits, in EMU, in its surface's own coordinates.
 *
 * Zero for a position that resolves to no length — the same answer
 * {@link frameDim} gives, and the same reason: the generated program's own
 * default says zero, and a reader that guessed something else would draw the
 * line somewhere the solver does not think it is.
 */
export function guideAt(
	node: SceneNode,
	guide: Guide,
	context: ResolveContext = NO_CONTEXT,
): Emu {
	const resolved = resolveValue(
		context,
		guide.at,
		guideAtVar(node.id, guide.id),
	);
	return (resolved === undefined ? undefined : emuOf(resolved)) ?? 0;
}

/**
 * A line dragged to a new place — {@link withFrame} for a guide, and it obeys
 * the same rule for the same reasons.
 *
 * The write lands on **the alternative the visible universe picked**, so a guide
 * that holds two positions keeps both and the drag moves the one on screen. An
 * alternative that names a token or is derived is left exactly as it is: that
 * position is the token's to change, and quietly replacing the link with a
 * number would unwire the very thing the guide was drawn to demonstrate — drag
 * the guide, the token moves, everything pinned to it follows. The position is
 * written back in the unit it was already spelled in, and a patch that repeats
 * what is stored is not an edit at all.
 *
 * The lock is honoured here rather than at whatever gesture called, because a
 * lock is a property of the guide: every road to moving it has to pass this one.
 */
export function withGuideAt(
	node: SceneNode,
	guide: Guide,
	at: Emu,
	context: ResolveContext = NO_CONTEXT,
): Guide {
	if (guide.locked) return guide;
	const index = activeIndex(
		guide.at,
		guideAtVar(node.id, guide.id),
		context.picks,
	);
	const term = index === -1 ? undefined : guide.at[index];
	if (term?.kind !== "literal") return guide;
	if (emuOf(term.value) === at) return guide;
	const written = writeLength(at, unitOf(term.value));
	if (term.value === written) return guide;
	return {
		...guide,
		at: guide.at.map((t, i) => (i === index ? lit(written) : t)),
	};
}

/**
 * True when a gesture cannot move this line: it is locked, or the alternative on
 * screen is a link rather than a number.
 *
 * The twin of {@link frameFrozen}, and it exists for the same reason — the
 * editor has to be able to say "not this one" *before* the drag rather than by
 * silently doing nothing after it.
 */
export function guideFrozen(
	node: SceneNode,
	guide: Guide,
	context: ResolveContext = NO_CONTEXT,
): boolean {
	if (guide.locked) return true;
	const index = activeIndex(
		guide.at,
		guideAtVar(node.id, guide.id),
		context.picks,
	);
	return index === -1 || guide.at[index].kind !== "literal";
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** One of the four numbers that say where a node is and how big it is. */
export type Dimension = "x" | "y" | "width" | "height";

export interface DimensionSpec {
	label: string;
	type: ValueType;
	/** Shown as the placeholder and used when adding an alternative. */
	fallback: string;
	/** A place along an axis, or an extent on it. */
	role: "pos" | "span";
}

/**
 * The four dimensions, in one place.
 *
 * They are {@link Value}s for the same reason a fill and a gap are: a design
 * that puts the same card in one place on a wide screen and another on a narrow
 * one is *one* design space, and a document that can hold only one number per
 * dimension cannot say so. A dimension that names a `length` token is a
 * position driven by a parameter — the thing a `pin` constraint could already
 * reach indirectly, said directly.
 *
 * Not in {@link PROPS}: nothing paints a coordinate, and a per-kind property
 * list is the wrong home for something every kind has exactly four of. What
 * they share with a property is the part that matters — a variable key
 * ({@link frameVar}), alternatives, tokens, and a pick per universe.
 */
export const FRAME_DIMS: Record<Dimension, DimensionSpec> = {
	x: { label: "x", type: "length", fallback: pxLength(0), role: "pos" },
	y: { label: "y", type: "length", fallback: pxLength(0), role: "pos" },
	width: { label: "width", type: "length", fallback: pxLength(0), role: "span" },
	height: { label: "height", type: "length", fallback: pxLength(0), role: "span" },
};

export const DIMENSIONS = Object.keys(FRAME_DIMS) as Dimension[];

/** A node's geometry: four values, each free to hold alternatives. */
export type FrameValue = Record<Dimension, Value>;

/**
 * A frame from plain numbers — the default a gesture or a template produces.
 *
 * **One alternative each.** Multiplicity is something a designer asks for, not
 * something every rectangle on the canvas is born with: four varying dimensions
 * per node would multiply the space past usefulness before anyone had made a
 * decision.
 *
 * **In pixels**, because there is no document here to ask. A frame is made from
 * a gesture or from a template, and neither has the scene in hand — see
 * {@link writeLength} for what that costs, which is nothing while `px` is the
 * default unit and a gesture is a whole number of pixels anyway. A length in
 * another unit gets into the document by being typed, or by being kept: an edit
 * to an existing value spells it back in its own unit.
 */
export function makeFrame(frame: Frame): FrameValue {
	return {
		x: single(writeLength(frame.x)),
		y: single(writeLength(frame.y)),
		width: single(writeLength(frame.width)),
		height: single(writeLength(frame.height)),
	};
}

/**
 * What one dimension comes to in EMU, following whatever token it names.
 *
 * The same walk the generated program does through `resolved/2` and `numeral/2`
 * — and now *exactly* the same number, where it used to be the same number only
 * because both sides rounded to a pixel. `emuOf` is exact or nothing and the
 * compiler emits what it returns, so the canvas and the solver can no longer
 * disagree by half a pixel however fine the document gets.
 * `context.picks` is the universe being looked at; without one the first
 * alternative stands in, which is what an unsolved preview should show.
 *
 * A dimension that resolves to no length at all is 0, exactly as the program's
 * own default rule makes it, rather than being left unstated. The values that
 * fall into that hole are wider than they were: `"20.5px"` is 195262.5 EMU and
 * so is not a length, where before it was 20.5 and rounded to 21. That is the
 * migration's business, not this function's — see `normalizeScene`, which snaps
 * every stored length onto its unit's lattice once, visibly, on the way in.
 */
export function frameDim(
	node: SceneNode,
	dim: Dimension,
	context: ResolveContext = NO_CONTEXT,
): Emu {
	const resolved = resolveValue(
		context,
		node.frame[dim],
		frameVar(node.id, dim),
	);
	return (resolved === undefined ? undefined : emuOf(resolved)) ?? 0;
}

/**
 * All four, as the plain rectangle every gesture and every renderer wants — in
 * EMU, like every {@link Frame} in this codebase.
 */
export function frameOf(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): Frame {
	return {
		x: frameDim(node, "x", context),
		y: frameDim(node, "y", context),
		width: frameDim(node, "width", context),
		height: frameDim(node, "height", context),
	};
}

/**
 * A node with some of its geometry replaced by numbers.
 *
 * **This is the rule a drag obeys.** A gesture writes to *the alternative the
 * visible universe picked* — the same thing typing into a token's value does
 * while a universe is pinned — so a node with two positions keeps both and you
 * move the one you can see. Nothing here ever shortens a list.
 *
 * An alternative that is a token reference or a derivation is left exactly as
 * it is: that dimension is the token's to change, and quietly replacing the
 * link with a literal would unwire a parameter the designer set up. The editor
 * says so by refusing to drag such an axis; see `frameFrozen`.
 *
 * The patch is in EMU, and each dimension is written back **in the unit it was
 * already written in** — {@link unitOf} off the old literal, {@link writeLength}
 * into the new one. A design in points stays in points across a drag.
 */
export function withFrame(
	node: SceneNode,
	patch: Partial<Frame>,
	context: ResolveContext = NO_CONTEXT,
): SceneNode {
	let frame: FrameValue | undefined;
	for (const dim of DIMENSIONS) {
		const next = patch[dim];
		if (next === undefined) continue;
		const value = node.frame[dim];
		const index = activeIndex(value, frameVar(node.id, dim), context.picks);
		const term = index === -1 ? undefined : value[index];
		if (term?.kind !== "literal") continue;
		const wanted =
			FRAME_DIMS[dim].role === "span" ? Math.max(MIN_NODE_SIZE, next) : next;
		// A patch that says what the value already says is not an edit. That used
		// to be covered by comparing the two spellings a line below, and is not any
		// more: a stored length can now be finer than the pixel a gesture is
		// quantized to, so a drag that ended where it began would otherwise pull an
		// exact "12.5pt" onto the pixel grid on its way past.
		if (emuOf(term.value) === wanted) continue;
		const written = writeLength(wanted, unitOf(term.value));
		if (term.value === written) continue;
		frame ??= { ...node.frame };
		frame[dim] = value.map((t, i) => (i === index ? lit(written) : t));
	}
	return frame ? { ...node, frame } : node;
}

/**
 * True when a drag cannot write this dimension: the alternative on screen is a
 * link rather than a number, so the answer lives in the token.
 */
export function frameFrozen(
	node: SceneNode,
	dim: Dimension,
	context: ResolveContext = NO_CONTEXT,
): boolean {
	const value = node.frame[dim];
	const index = activeIndex(value, frameVar(node.id, dim), context.picks);
	return index === -1 || value[index].kind !== "literal";
}

const NO_CONTEXT: ResolveContext = { tokens: [], picks: {} };

/** A resolve context over a document, for the callers that hold a whole one. */
export const sceneContext = (
	scene: Scene,
	picks: Picks = {},
): ResolveContext => ({ tokens: scene.tokens, picks });

export interface SceneNode {
	id: string;
	kind: NodeKind;
	/** Shown in the layer list; free-form. */
	name: string;
	/**
	 * Relative to the parent's origin — see the note in `tree.ts`.
	 *
	 * Four {@link Value}s rather than four numbers, so a node can sit in one
	 * place in one universe and another somewhere else; read it with
	 * {@link frameOf}. Under an {@link AutoLayout} parent this is not where the
	 * node sits: the solver decides that. It stays as the size the node asks
	 * for, and as where it returns to if the layout is removed.
	 */
	frame: FrameValue;
	/** Literal content for text nodes. */
	/**
	 * Which way a {@link KindSpec.diagonal} kind leans: "down" runs from the
	 * frame's top-left corner to its bottom-right, "up" from bottom-left to
	 * top-right. Absent on every other kind.
	 */
	diagonal?: Diagonal;
	/**
	 * A {@link KindSpec.plotted} kind's vertices, relative to its own frame
	 * origin — so moving the node never touches them.
	 *
	 * The frame is exactly their bounding box. Resizing scales them to match;
	 * see {@link scalePoints}. Absent on every other kind.
	 */
	points?: PathPoint[];
	/** Whether a plotted kind's last point joins back up to its first. */
	closed?: boolean;
	/**
	 * On a {@link KindSpec.measured} kind: whether its size comes from its
	 * content or from the frame above. Absent means automatic — see
	 * `measure.ts`. Meaningless on every other kind.
	 */
	sizing?: Sizing;
	props: Partial<Record<PropName, Value>>;
	/**
	 * The id of the {@link Style} this node wears, if any.
	 *
	 * One slot rather than a list: two styles could both decide `size`, and then
	 * which one wins is an ordering question the document would have to answer
	 * every time anybody looked. One style, and anything it does not decide is
	 * the node's own — see {@link wornProps}.
	 *
	 * A dangling id decides nothing, the way {@link instanceOf} derives nothing.
	 */
	style?: string;
	/** Present on the container kinds. */
	children?: SceneNode[];
	/** Set on a container to lay its children out automatically. */
	layout?: AutoLayout;
	/**
	 * Set on a surface to rule it with margins and a grid of tracks — see
	 * {@link GUIDE_PROPS}. Absent is no grid at all.
	 */
	guides?: SurfaceGuides;
	/**
	 * Lines drawn by hand on this surface — see {@link Guide}.
	 *
	 * Beside {@link guides} rather than inside it, because the two are not the
	 * same kind of thing however alike they look on screen. The grid is a record
	 * over a fixed table of settings, keyed by name, with a fallback for every
	 * field; a line is an object with an identity, a lock and a lifecycle — drawn,
	 * dragged, deleted one at a time. Forcing them into one field would give the
	 * grid a key the table does not know about, or give every line a defaulted
	 * setting it has no use for.
	 *
	 * What is *not* here is whether any of this is shown. That is a fact about the
	 * person looking rather than about the document, it belongs beside the pinned
	 * universe in the editor, and a document that carried it would mean opening a
	 * file and being unable to see why the layout will not move. Locking is the
	 * other half of that split and does live here: "do not let me drag this by
	 * accident" is a decision about the guide, worth keeping, and worth sending to
	 * a collaborator.
	 */
	lines?: Guide[];
	/**
	 * Under a laid-out parent: whether it takes a share of the leftover space.
	 * A `growth` value — absent is the same as keeping its size.
	 */
	grow?: Value;
	/**
	 * Under a laid-out parent: sit differently on the cross axis from its
	 * siblings. A `placement` value; absent means whatever the container says.
	 */
	alignSelf?: Value;
	/**
	 * This subtree is a component definition — see `components.ts`.
	 *
	 * A definition is not a separate kind of object: it is an ordinary subtree
	 * with a flag, drawn and edited on the canvas like anything else. What the
	 * flag adds is that its property variables are re-minted once per instance,
	 * so the subtree stops being one design and becomes a design *space* that
	 * several nodes can each take a point of.
	 */
	component?: true;
	/**
	 * On an `instance` kind: the id of the definition's root node.
	 *
	 * A dangling reference derives nothing rather than failing, which is what
	 * deleting a definition out from under its instances leaves behind.
	 */
	instanceOf?: string;
	/**
	 * The choices this node has made up its mind about, as *definition-space*
	 * variable key -> alternative index.
	 *
	 * These are held picks, not values. An instance can only differ from its
	 * definition where the definition wrote more than one alternative, so an
	 * override is necessarily a choice among those alternatives — which means
	 * there is nothing here that could contradict the definition, only
	 * something that could narrow it. Definition-space keys rather than the
	 * instance's own so that a variant carries over from one instance to
	 * another unchanged.
	 *
	 * On an `instance` kind it is an override. On a {@link component} root it is
	 * the definition holding *itself* to one of its variants, which is the same
	 * act: a definition is a design as well as a space, and for its own parts
	 * definition space is document space, so the keys mean the same thing. That
	 * is the only place a whole universe can be written down without shortening
	 * the lists its instances index into — see `collapseToPicks`.
	 */
	holds?: Readonly<Record<string, number>>;
	/**
	 * On an `instance` kind: which state of its definition's machine it is
	 * drawn in on the canvas, and which state it starts in when exported.
	 *
	 * **Structurally the twin of {@link holds}**, and the resemblance is exact
	 * rather than decorative: both are a decision the document remembers about
	 * one use of a shared definition, both name something the definition owns,
	 * and both leave the thing they name unchanged for every other use. The one
	 * difference is which way the decision cuts — a hold narrows the *design
	 * space*, a state selects one of the *behaviours*, and those are orthogonal.
	 * An instance may hold a variant and be drawn in a state, and the pair is a
	 * cell of a matrix rather than a point in a product of universes.
	 *
	 * Absent, or naming a state the machine no longer has, is the machine's
	 * initial state. Nothing is corrected on the way in: a stored document is
	 * read, not repaired, and a machine edited down leaves its instances legal.
	 *
	 * Read on an `instance` node and nowhere else. A component *definition* on
	 * the canvas is always its rest state, and that is deliberate: a definition
	 * part's frame is a *fact* the compiler emits, a fact cannot be un-said by a
	 * rule, and every instance of the definition inherits it — so drawing the
	 * definition in another state would move the component itself.
	 */
	state?: string;
}

/** True when this node's children are placed by the solver. */
export const isLaidOut = (node: SceneNode): boolean =>
	node.layout !== undefined && (node.children?.length ?? 0) > 0;

/* ------------------------------------------------------------------ */
/* Reading a layout                                                    */
/* ------------------------------------------------------------------ */

/** Whatever a node stores for one layout setting, if anything. */
export function layoutValueOf(
	node: SceneNode,
	prop: LayoutProp,
): Value | undefined {
	return LAYOUT_PROPS[prop].on === "child"
		? node[prop as ChildProp]
		: node.layout?.[prop as ContainerProp];
}

/**
 * What a layout setting comes to, following whatever token it names.
 *
 * The same walk the generated program does, done here for everything on this
 * side that has to know: measuring a hugging container, and working out where
 * a drop lands in a row. `picks` is the universe being looked at — without one
 * the first alternative stands in, which is what an unsolved preview should
 * show.
 *
 * Returns nothing for a setting the node does not hold, or one that resolves
 * to no word at all. The program behaves the same way: the rule that wanted it
 * simply goes unstated.
 */
export function layoutSetting(
	node: SceneNode,
	prop: LayoutProp,
	context: ResolveContext = { tokens: [], picks: {} },
): string | undefined {
	return resolveValue(
		context,
		layoutValueOf(node, prop),
		layoutVar(node.id, prop),
	);
}

/**
 * The same, as a length in EMU, falling back to the table's own default.
 *
 * Never negative: a gap of -8 is not a design, and the layout rules would read
 * it as one. The table's own fallback is written by {@link pxLength} and so is
 * always a length `emuOf` can read, which leaves the final `?? 0` for the one
 * caller that could still reach it — someone asking a word-valued setting like
 * `direction` how long it is, which is a question with no answer.
 */
export function layoutLength(
	node: SceneNode,
	prop: LayoutProp,
	context?: ResolveContext,
): Emu {
	const resolved = layoutSetting(node, prop, context);
	const n = resolved === undefined ? undefined : emuOf(resolved);
	return Math.max(0, n ?? emuOf(LAYOUT_PROPS[prop].fallback) ?? 0);
}

/** The same, as one of the words the setting's menu offers. */
export function layoutWord(
	node: SceneNode,
	prop: LayoutProp,
	context?: ResolveContext,
): string {
	const resolved = layoutSetting(node, prop, context);
	const spec = LAYOUT_PROPS[prop];
	const legal = VALUE_TYPES[spec.type].options?.some(
		(o) => o.value === resolved,
	);
	return legal && resolved !== undefined ? resolved : spec.fallback;
}

/* ------------------------------------------------------------------ */
/* Constraints                                                         */
/* ------------------------------------------------------------------ */

export type ConstraintKind =
	| "differ"
	| "match"
	| "atMost"
	| "align"
	| "gap"
	| "equalSize"
	| "symmetric"
	| "pin"
	| "custom";

/**
 * A quantity a geometric constraint can talk about.
 *
 * The six positional ones and the two sizes are things a *node* has; `x` and
 * `y` are whole axes, which is what a gap is measured along and what a mirror
 * runs across. All of them are linear in the world coordinates, which is the
 * only reason simplex can answer a document full of them exactly.
 */
export type Edge =
	| "left"
	| "centerX"
	| "right"
	| "top"
	| "centerY"
	| "bottom"
	| "width"
	| "height"
	| "x"
	| "y";

export interface EdgeSpec {
	label: string;
	axis: "x" | "y";
	/** A place on a node, a size of one, or the axis itself. */
	role: "pos" | "span" | "axis";
	/**
	 * Where on the node a positional edge sits, which is also how much of the
	 * node's own size lies before it: none at `lead`, half at `mid`, all of it
	 * at `trail`. Absent on the sizes and the axes.
	 */
	place?: "lead" | "mid" | "trail";
}

/**
 * The geometric vocabulary, in one place.
 *
 * `compile()` emits this table as facts and the rules read it, so an edge is
 * never named in a rule: adding one is an entry here.
 */
export const EDGES: Record<Edge, EdgeSpec> = {
	left: { label: "Left edge", axis: "x", role: "pos", place: "lead" },
	centerX: { label: "Horizontal centre", axis: "x", role: "pos", place: "mid" },
	right: { label: "Right edge", axis: "x", role: "pos", place: "trail" },
	top: { label: "Top edge", axis: "y", role: "pos", place: "lead" },
	centerY: { label: "Vertical centre", axis: "y", role: "pos", place: "mid" },
	bottom: { label: "Bottom edge", axis: "y", role: "pos", place: "trail" },
	width: { label: "Width", axis: "x", role: "span" },
	height: { label: "Height", axis: "y", role: "span" },
	x: { label: "Horizontally", axis: "x", role: "axis" },
	y: { label: "Vertically", axis: "y", role: "axis" },
};

export const EDGE_NAMES = Object.keys(EDGES) as Edge[];

/** The positional edge at one end (or the middle) of an axis. */
export const edgeOn = (
	axis: "x" | "y",
	place: "lead" | "mid" | "trail",
): Edge =>
	EDGE_NAMES.find(
		(e) => EDGES[e].axis === axis && EDGES[e].place === place,
	) as Edge;

/** The six an `align` offers: a node's own places, not its sizes. */
const PLACES = EDGE_NAMES.filter((e) => EDGES[e].role === "pos");
const SPANS = EDGE_NAMES.filter((e) => EDGES[e].role === "span");
const AXES = EDGE_NAMES.filter((e) => EDGES[e].role === "axis");

/**
 * One term of the sum a fresh geometric constraint seeds its value from.
 *
 * `slot` is the 1-based member, `place` where on the axis to measure it —
 * `self` being the constraint's own edge, for the kinds whose edge already
 * names a place.
 */
export interface SeedTerm {
	slot: number;
	place: "lead" | "mid" | "trail" | "self";
	weight: number;
}

/**
 * How a constraint draws itself over the design.
 *
 * The shapes, not the kinds: `edges` is the quantity the members share,
 * `between` the distance from one to the next, `mirror` the line they balance
 * across. A new kind picks one of these rather than growing the overlay a case
 * — see `annotate.ts`.
 */
export type Annotated = "none" | "edges" | "between" | "mirror";

export interface ConstraintSpec {
	label: string;
	/** Phrased for the constraint list, with `{prop}`, `{n}`, `{edge}` and `{v}` filled in. */
	summary: string;
	/** True when the kind reads {@link Constraint.limit}. */
	counted: boolean;
	/** Fewest nodes for the constraint to say anything. */
	minNodes: number;
	/** Most it can use. Extra members would have nowhere to go. */
	maxNodes: number;
	/**
	 * True when the kind demands its members take *pairwise different* values.
	 *
	 * Which is the one shape a document can make impossible without any rule
	 * conflicting with any other: two members whose property the document ties to
	 * one source can never be told apart, so the rule cannot hold however the
	 * solver searches. Read off here rather than tested at the use site — see
	 * `deadlock` in `stuck.ts`, which is the only reader and would otherwise be a
	 * `kind === "differ"`.
	 */
	distinct: boolean;
	/**
	 * True when the kind talks about *where a node is* rather than about one of
	 * its properties.
	 *
	 * Naming a node in a geometric constraint hands that node's frame over to
	 * the solver — see the geometry rules in `compile.ts`.
	 */
	geometric: boolean;
	/** Which quantities it may be about; empty for the property kinds. */
	edges: Edge[];
	/**
	 * What {@link Constraint.value} is, for the kinds that read one; absent for
	 * the kinds that do not. A type rather than a flag because the value is an
	 * ordinary {@link Value} and so has the same choice of tokens to link to as
	 * any property of that type does.
	 */
	valueType?: ValueType;
	/**
	 * What that value measures in the design as it stands, so a new constraint
	 * starts out already true rather than yanking the layout somewhere. Read
	 * from here rather than switched on the kind — see `addConstraint`.
	 */
	seed: SeedTerm[];
	/** What it draws on the canvas while one of its members is selected. */
	annotation: Annotated;
}

/**
 * What each kind of constraint means.
 *
 * The generated program carries one generic rule per kind and the constraints
 * themselves are plain facts, so a new kind is an entry here plus one rule —
 * never a change to how a document is compiled.
 */
export const CONSTRAINT_KINDS: Record<ConstraintKind, ConstraintSpec> = {
	differ: {
		label: "All different",
		summary: "no two share a {prop}",
		counted: false,
		distinct: true,
		minNodes: 2,
		maxNodes: Number.POSITIVE_INFINITY,
		geometric: false,
		edges: [],
		seed: [],
		annotation: "none",
	},
	match: {
		label: "All the same",
		summary: "share one {prop}",
		counted: false,
		distinct: false,
		minNodes: 2,
		maxNodes: Number.POSITIVE_INFINITY,
		geometric: false,
		edges: [],
		seed: [],
		annotation: "none",
	},
	atMost: {
		label: "At most N distinct",
		summary: "use at most {n} distinct {prop}",
		counted: true,
		distinct: false,
		minNodes: 2,
		maxNodes: Number.POSITIVE_INFINITY,
		geometric: false,
		edges: [],
		seed: [],
		annotation: "none",
	},
	align: {
		label: "Align",
		summary: "share a {edge}",
		counted: false,
		distinct: false,
		minNodes: 2,
		maxNodes: Number.POSITIVE_INFINITY,
		geometric: true,
		edges: PLACES,
		seed: [],
		annotation: "edges",
	},
	gap: {
		// Ordered: the first member is the near side of the gap, so a negative
		// value is an overlap rather than a swap.
		label: "Gap",
		summary: "sit {v} apart, {edge}",
		counted: false,
		distinct: false,
		minNodes: 2,
		maxNodes: 2,
		geometric: true,
		edges: AXES,
		valueType: "length",
		// From the near side of the first member to the far side of the second.
		seed: [
			{ slot: 1, place: "trail", weight: -1 },
			{ slot: 2, place: "lead", weight: 1 },
		],
		annotation: "between",
	},
	equalSize: {
		label: "Same size",
		summary: "share a {edge}",
		counted: false,
		distinct: false,
		minNodes: 2,
		maxNodes: Number.POSITIVE_INFINITY,
		geometric: true,
		edges: SPANS,
		seed: [],
		annotation: "edges",
	},
	symmetric: {
		// Two members mirror across the line {@link Constraint.value} names; a
		// third replaces that line with its own centre, so the mirror can be a
		// thing in the design rather than a number.
		label: "Symmetric",
		summary: "mirror each other {edge}",
		counted: false,
		distinct: false,
		minNodes: 2,
		maxNodes: 3,
		geometric: true,
		edges: AXES,
		valueType: "length",
		// The line already halfway between the two centres.
		seed: [
			{ slot: 1, place: "mid", weight: 0.5 },
			{ slot: 2, place: "mid", weight: 0.5 },
		],
		annotation: "mirror",
	},
	pin: {
		label: "Pin",
		summary: "hold a {edge} at {v}",
		counted: false,
		distinct: false,
		minNodes: 1,
		maxNodes: 1,
		geometric: true,
		edges: [...PLACES, ...SPANS],
		valueType: "length",
		seed: [{ slot: 1, place: "self", weight: 1 }],
		annotation: "edges",
	},
	/**
	 * A rule the user wrote, with a switch and a name.
	 *
	 * Every other kind derives `viol/1` from facts the document holds; this one
	 * derives nothing, and the hand-written rule in the Rules panel supplies the
	 * violation condition itself:
	 *
	 *     viol(no_wide_gaps) :- lgap(row,G), G > 24.
	 *
	 * The compiler emits `constraint(C)` and `c_kind(C,custom)` and stops. What
	 * that buys is everything the generic guard machinery already does for the
	 * built-in kinds and that a bare `:- ...` in the panel could never do: an
	 * enable checkbox, and a name in the unsat core when the document turns out
	 * to be impossible. It is the same move that made a rule-named *set* a
	 * first-class member list, applied to the rule itself.
	 *
	 * No members, so no property, no edge, no dimension and no group — a set has
	 * to be a set of something, and this one ranges over whatever its author's
	 * rule ranges over. `maxNodes: 0` is the field that says all of that: see
	 * {@link rangesOverGroup} and {@link constrainsProp}, both of which read it
	 * rather than naming this kind.
	 */
	custom: {
		label: "Custom rule",
		// No placeholders: there is nothing in the document to fill them from, and
		// what this rule means is in the ASP the user wrote. The editor shows this
		// where a rule with members shows its members — which is to say, while
		// nothing has been written it is the truth about the rule.
		summary: "holds until one of your rules says otherwise",
		counted: false,
		distinct: false,
		// Zero either way: it is not too small to say anything without members —
		// it says whatever its rule says — and it has nowhere to put one.
		minNodes: 0,
		maxNodes: 0,
		geometric: false,
		edges: [],
		seed: [],
		annotation: "none",
	},
};

export const CONSTRAINT_NAMES = Object.keys(CONSTRAINT_KINDS) as ConstraintKind[];

/* ------------------------------------------------------------------ */
/* How firmly a rule holds                                             */
/* ------------------------------------------------------------------ */

/**
 * A rule's strength: a prohibition, or a preference at one of three tiers.
 *
 * On the *instance* rather than on the kind, and that is the whole claim: "all
 * these must differ" and "prefer that these differ" are the same relation at
 * two strengths, over the same members, about the same property. A parallel set
 * of `preferDiffer`/`preferMatch` kinds would double {@link CONSTRAINT_KINDS}
 * to say nothing new, and every table read that asks what a kind *is* —
 * `rangesOverGroup`, `constrainsProp`, `annotation`, `seed` — would have two
 * entries to keep in step.
 */
export type Strength = "must" | "strong" | "prefer" | "slight";

export interface StrengthSpec {
	label: string;
	/**
	 * The `@` priority a violation costs at, or undefined for a prohibition.
	 *
	 * Levels are a lexicographic order, not a scale: no amount of cost at a
	 * lower level outweighs a point at a higher one. That is what makes a tier
	 * list worth having over a single number — "brand colours are
	 * non-negotiable, then prefer contrast, then prefer tight spacing" is three
	 * tiers and cannot be spelled with weights alone.
	 *
	 * Numbered from 1 up so that level 0 — an ASP weak constraint's default
	 * priority — stays free for a rule the user writes by hand, which then ranks
	 * below every tier here.
	 */
	level?: number;
	/** Wrapped around the kind's own summary in the rules list. */
	phrase: string;
}

/**
 * The tiers, ordered. One table, and the *only* place a priority number is
 * written down: the compiler emits `c_level/2` from it and one generic weak
 * constraint reads that, so a new tier is an entry here and nothing else.
 */
export const STRENGTHS: Record<Strength, StrengthSpec> = {
	must: { label: "Must", phrase: "{s}" },
	strong: { label: "Strongly prefer", level: 3, phrase: "strongly prefer: {s}" },
	prefer: { label: "Prefer", level: 2, phrase: "prefer: {s}" },
	slight: { label: "Slightly prefer", level: 1, phrase: "slightly prefer: {s}" },
};

/** The tiers, strongest first — which is also the order the costs come back in. */
export const STRENGTH_NAMES = Object.keys(STRENGTHS) as Strength[];

/** What a constraint's strength is when the document does not say. */
export const DEFAULT_STRENGTH: Strength = "must";

/**
 * True when a rule is a preference rather than a prohibition — read off the
 * table, so no caller ever compares against `"must"`.
 */
export const isSoft = (strength: Strength | undefined): boolean =>
	STRENGTHS[strength ?? DEFAULT_STRENGTH].level !== undefined;

/** The priority a violation costs at, or undefined for a prohibition. */
export const levelOf = (strength: Strength | undefined): number | undefined =>
	STRENGTHS[strength ?? DEFAULT_STRENGTH].level;

/** What a violation of `constraint` costs at its tier. At least one point. */
export const weightOf = (constraint: Constraint): number =>
	Math.max(1, Math.round(constraint.weight ?? 1));

/**
 * True when a kind can range over a set it never enumerated — see
 * {@link Constraint.group}.
 *
 * Read off the table rather than listed here: a kind that takes any number of
 * members treats them as a set, while one with a ceiling reads them *by
 * position* — which side of a gap, which node is the mirror — and a set has no
 * positions to read. So an unbounded kind is exactly the kind a group can fill.
 */
export const rangesOverGroup = (kind: ConstraintKind): boolean =>
	CONSTRAINT_KINDS[kind].maxNodes === Number.POSITIVE_INFINITY;

/**
 * True when a kind has a subject in the document at all.
 *
 * A kind with nowhere to put a member is not a rule about *these nodes*; it is
 * a rule about whatever its author's ASP is about. So it needs no selection to
 * be worth adding, has no property and no edge to be about, and its whole
 * content is the term it reaches ASP as — which is why the editor puts a name
 * field where every other kind puts a subject.
 *
 * `maxNodes` rather than `minNodes`, and off the table rather than listed: a
 * kind that can hold no members is the only kind that can have no subject.
 */
export const takesMembers = (kind: ConstraintKind): boolean =>
	CONSTRAINT_KINDS[kind].maxNodes > 0;

/**
 * True when a kind is about a *property* of its members — which is what
 * `c_prop/2` says and what the `differ`/`match`/`atMost` rules read.
 *
 * Read off the table rather than listed, and off two fields rather than one:
 * `geometric` says a kind talks about where a node is instead of how it looks,
 * and a kind with no members at all has nothing to be about either way. So
 * `custom` needs no case here — a rule with no subject cannot have a property.
 */
export const constrainsProp = (kind: ConstraintKind): boolean =>
	!CONSTRAINT_KINDS[kind].geometric && takesMembers(kind);

/**
 * Words a constraint id may not be.
 *
 * A constraint id reaches ASP as a bare term — `constraint(no_wide_gaps)` — and
 * for a {@link CONSTRAINT_KINDS.custom} rule it is also the term the *user*
 * types in `viol(...)`, so it has to be spellable as a constant. Every lowercase
 * word clingo's own vocabulary uses was tried against `constraint(W).`, and only
 * `not` is a syntax error: the directives are all `#`-prefixed, and `count`,
 * `sum`, `min`, `max`, `inf`, `sup`, `true` and the rest are ordinary constants
 * in term position. So this set is one word rather than a keyword list nobody
 * would keep in step.
 *
 * Colliding with the generated vocabulary — a rule called `gap`, or `frame` — is
 * *not* forbidden: nothing joins a constraint id to a kind, an edge or a node
 * id, so `constraint(gap)` says only what it says.
 */
export const RESERVED_TERMS: ReadonlySet<string> = new Set(["not"]);

/**
 * True when `name` can be a constraint id: an ASP constant, and not a word the
 * grounder needs. Uniqueness is a document question and lives with the edit.
 */
export const isConstraintTerm = (name: string): boolean =>
	wordOf(name) === name && !RESERVED_TERMS.has(name);

/**
 * Properties every one of these kinds holds — what a rule over them may be
 * about.
 *
 * Two callers with the same question and no business knowing which properties
 * belong to which kind: the document's own nodes, and the members of a
 * rule-named group, which exist only in the answer set.
 */
export function sharedPropsOfKinds(kinds: readonly NodeKind[]): PropName[] {
	if (kinds.length === 0) return [];
	return KINDS[kinds[0]].props.filter((prop) =>
		kinds.every((kind) => KINDS[kind].props.includes(prop)),
	);
}

/**
 * A rule the design must obey, expressed over a property of several nodes.
 *
 * Constraints are what turn a list of alternatives into a design *space*:
 * without them the universes are just the cross product of everything the user
 * typed. Each one is compiled behind its own switch so the solver can report
 * exactly which of them conflict — see `compile()`.
 */
export interface Constraint {
	/**
	 * The term this constraint reaches ASP as, and the name a core blames.
	 *
	 * Not an opaque handle: `constraint(C)`, `active(C)` and `cval(C)` are all
	 * built from it, an unsat core comes back naming it, and the editor marks the
	 * guilty row by it. For a {@link CONSTRAINT_KINDS.custom} rule it is also the
	 * term the *user* writes in `viol(...)`, which is why there is no separate
	 * name field: a second identity would have to be mapped back at every one of
	 * those hops, and the core would name something the document does not hold.
	 *
	 * So it must be an ASP constant ({@link isConstraintTerm}) and unique in the
	 * document, and changing it is a rename that carries the user's rules with it
	 * — see `renameConstraint`.
	 */
	id: string;
	kind: ConstraintKind;
	/** The property being constrained. Meaningless to the geometric kinds. */
	prop: PropName;
	/**
	 * Nodes it ranges over, in the order they were named.
	 *
	 * A member may also be a **datum** — a guide, or one line of a column grid —
	 * which is not a node and is not in the document's tree. That is deliberate
	 * and it is what makes "pin this card to column three" an ordinary `align`
	 * with a name, a switch and a place in an unsat core, rather than a second
	 * snapping system. See {@link parseDatum}, and {@link holdsDatum}, which is
	 * what anything filtering this list against the live nodes has to ask as well.
	 */
	nodes: string[];
	/**
	 * A set a rule named, ranged over instead of {@link nodes}.
	 *
	 * `group(row(1)). member(row(1), cell(1,C)) :- pos(C).` is nine members the
	 * document never enumerated, and this is one constraint over all of them —
	 * with its own enable switch and its own name in an unsat core, exactly like
	 * a constraint that listed them. The value is the ASP term naming the group,
	 * so it is picked from the `group/1` instances the answer set holds rather
	 * than typed.
	 *
	 * Only the kinds that treat their members as a set can take one; see
	 * {@link rangesOverGroup}. When it is set, `nodes` is ignored by the
	 * compiler and kept only so that switching back remembers the old list.
	 */
	group?: string;
	/** Distinct-value budget, for the counted kinds. */
	limit?: number;
	/** Which quantity, for the geometric kinds. */
	edge?: Edge;
	/**
	 * What a `gap`, a `pin` or a mirror line holds to — a length, so EMU.
	 *
	 * A {@link Value} like any other, so it can be a number typed in or a link
	 * to a `length` token — and a token with three alternatives driving it is a
	 * design table: the same drawing at three sizes. It reaches ASP as the
	 * variable {@link constraintVar} names, and `c_value(C,V)` is then derived
	 * per universe rather than being a fact.
	 */
	value?: Value;
	/**
	 * Whether this rule forbids its violation or merely costs something.
	 *
	 * Absent is {@link DEFAULT_STRENGTH}, so every document written before soft
	 * rules existed reads as all-hard, which is what it was. A soft rule still
	 * derives the same `viol/1`; what changes is what the program does with it —
	 * `:- viol(C)` becomes `:~ viol(C). [W@L,C]`. See {@link STRENGTHS}.
	 */
	strength?: Strength;
	/**
	 * What a violation costs at that tier. Absent is 1; meaningless when hard.
	 *
	 * A whole violation, once: `viol/1` is one atom per rule, so a rule is
	 * broken or it is not and this is the price, not a measure of how badly. A
	 * cost that grows with the damage is a `:~` of your own in the Rules panel.
	 */
	weight?: number;
	/** Off keeps it in the document but out of the program. */
	enabled: boolean;
}

/**
 * Which tier a priority level belongs to, for reading a cost vector back.
 *
 * Undefined for a level no tier claims, which is what a `:~` the user wrote by
 * hand has — so a cost entry either gets a tier's name or gets none, and never
 * gets the wrong one.
 */
export const strengthOfLevel = (level: number): Strength | undefined =>
	STRENGTH_NAMES.find((s) => STRENGTHS[s].level === level);

/* ------------------------------------------------------------------ */
/* Datums: the other face of a guide                                   */
/* ------------------------------------------------------------------ */

/**
 * **A guide is not a line drawn on top of the design.** It is a datum: one fixed
 * linear quantity in the design's own coordinates, which the geometric machinery
 * can name in exactly the place it names a node.
 *
 * That is the whole trick, and it is what keeps the feature small. `align`,
 * `gap` and `symmetric` relate their members through `c_node/2` and read a
 * quantity per member; a datum supplies that quantity and nothing else changes.
 * No new constraint kind, no parallel snapping, no second geometry engine. "Pin
 * this card to column three" is an `align` over `[card, cg(page,3,left)]`, and so
 * it gets a name and a switch like every other rule, an unsat core can blame it,
 * and `why.ts` can already explain it.
 *
 * A datum is a **zero-size box** in the solver, which is what lets it reuse the
 * edge machinery rather than growing an edge family of its own — and it is why
 * naming an edge in the term below is not a contradiction. All six of the
 * datum's own edges coincide, so the `edge` argument is not saying which edge of
 * the datum: it is saying **which line of the track** the datum stands for. That
 * matters for `align` in particular, which forces the *same* edge on both
 * members: `align` on `left` puts the card's left edge on the line, and `align`
 * on `centerX` puts its centre there, because the datum answers the same number
 * either way.
 *
 * Three lines per track rather than two — `left`, `centerX`, `right` on a column;
 * `top`, `centerY`, `bottom` on a row — because centring something in a column is
 * the second thing anybody does with a grid, and with two lines it would need a
 * rule that talks about both. The set is read off {@link EDGES} rather than
 * listed, so it is the same three places every other piece of geometry has.
 */
export type Datum =
	/** One line of the `index`-th track of a surface's grid; 1-based, as `1..N` grounds. */
	| { kind: "track"; surface: string; index: number; edge: Edge }
	/** One line drawn by hand — see {@link Guide}. */
	| { kind: "line"; surface: string; guide: string };

/**
 * The term a track line reaches ASP as, and the string a constraint stores as a
 * member: `cg(page,3,left)`.
 *
 * A term rather than an opaque id, for the reason a constraint's own id is one:
 * it is what the answer set says, what an overlay reads back, and what a
 * hand-written rule can name.
 */
export const trackDatum = (
	surface: string,
	index: number,
	edge: Edge,
): string => `cg(${surface},${index},${edge})`;

/** The same, for a line a designer drew: `gl(page,g1)`. */
export const lineDatum = (surface: string, guide: string): string =>
	`gl(${surface},${guide})`;

/**
 * Reads either back, or nothing for a term that is neither — which is what an
 * ordinary node id is, since a node id is a bare word or a term of the user's
 * own. Parsed rather than matched, for the reason `parseVariable` is: a surface
 * id may itself be a term, and `cg(cell(1,1),3,left)` has three arguments of
 * which two hold commas.
 */
export function parseDatum(term: string): Datum | undefined {
	const atom = parseAtom(term);
	if (!atom) return undefined;
	const [a, b, c] = atom.args;
	if (atom.name === "cg" && atom.args.length === 3) {
		const index = Number(b);
		if (!Number.isInteger(index) || index < 1) return undefined;
		// A size or an axis names no line, so it names no datum: `cg(page,3,width)`
		// would be a member every geometric rule read as something it is not.
		if (!Object.hasOwn(EDGES, c) || EDGES[c as Edge].role !== "pos") {
			return undefined;
		}
		return { kind: "track", surface: a, index, edge: c as Edge };
	}
	if (atom.name === "gl" && atom.args.length === 2) {
		return { kind: "line", surface: a, guide: b };
	}
	return undefined;
}

/** True when a constraint member is a datum rather than a node. */
export const isDatum = (term: string): boolean => parseDatum(term) !== undefined;

/** Every node in the document, roots first — see {@link datumIds}. */
function eachNode(nodes: readonly SceneNode[], visit: (n: SceneNode) => void) {
	for (const node of nodes) {
		visit(node);
		if (node.children) eachNode(node.children, visit);
	}
}

/**
 * The largest number of tracks this axis is cut into **in any universe**.
 *
 * A count is a value like any other, so a responsive grid holds two of them and
 * the twelfth column exists in one universe and not the other. Enumerating the
 * datums therefore means taking the widest reading, not the current one.
 *
 * It reads this value's own alternatives and stops there: a count that *names a
 * token* is read at whatever the token resolves to with no pick, so a token
 * holding `[6, 12]` reports six. That is a real limit and it is why
 * {@link holdsDatum} — the question anything destructive should ask — does not
 * look at the index at all.
 */
function trackCeiling(scene: Scene, node: SceneNode, axis: "x" | "y"): number {
	const prop = countOn(axis);
	const key = guideVar(node.id, prop);
	const value = guideValueOf(node, prop);
	let most = guideCount(node, prop, sceneContext(scene));
	for (let i = 0; i < (value?.length ?? 0); i++) {
		most = Math.max(most, guideCount(node, prop, sceneContext(scene, { [key]: i })));
	}
	return most;
}

/**
 * Every datum this document holds — what the editor can offer as a member, and
 * what an overlay draws.
 *
 * Ordered surface by surface, and within a surface: the column lines, the row
 * lines, then the hand-drawn ones. A track index runs to {@link trackCeiling},
 * so a grid that is twelve columns in one universe and six in another offers
 * twelve — a datum that exists in *some* universe is a datum a rule may name.
 *
 * Walked here rather than through `flatten` in tree.ts because the dependency
 * runs the other way: tree.ts reads this file.
 */
export function datumIds(scene: Scene): string[] {
	const out: string[] = [];
	eachNode(scene.nodes, (node) => {
		if (isGridded(node)) {
			for (const axis of ["x", "y"] as const) {
				// The three places this axis has, off the same table every other
				// piece of geometry reads them from.
				const places = PLACES.filter((e) => EDGES[e].axis === axis);
				const count = trackCeiling(scene, node, axis);
				for (let k = 1; k <= count; k++) {
					for (const edge of places) out.push(trackDatum(node.id, k, edge));
				}
			}
		}
		for (const guide of guideLines(node)) {
			out.push(lineDatum(node.id, guide.id));
		}
	});
	return out;
}

/**
 * True when the document still holds what a datum names — the question
 * `pruneConstraints` asks of every member that is not a node.
 *
 * Deliberately blunter than {@link datumIds}: a track datum is held when its
 * surface is gridded, whatever index it names. Asking whether *that* track
 * exists would mean deleting a designer's rule the moment they typed a smaller
 * column count, and getting it back would mean retyping the rule rather than the
 * count. A member pointing past the end of the grid says nothing until the grid
 * grows again, which is what an alternative in a value already means everywhere
 * else in this document.
 */
export function holdsDatum(scene: Scene, term: string): boolean {
	const datum = parseDatum(term);
	if (!datum) return false;
	let held = false;
	eachNode(scene.nodes, (node) => {
		if (node.id !== datum.surface) return;
		held =
			datum.kind === "track"
				? isGridded(node)
				: findGuide(node, datum.guide) !== undefined;
	});
	return held;
}

/**
 * What one track is called on each axis, and what each of its three lines is
 * called — the words, and only the words.
 *
 * A table rather than a conditional for the usual reason, but also because the
 * two axes genuinely disagree about English: the middle line of a column is its
 * *centre* and the middle line of a row is its *middle*, and `EDGES` cannot say
 * that because "Horizontal centre" is a name for an edge of a node rather than
 * for a line of a track. Both keys are read off {@link EDGES} — the axis and the
 * place — so nothing here decides which line a term names, only how to say it.
 */
const TRACK_WORDS = {
	x: { track: "Column", lead: "left", mid: "centre", trail: "right" },
	y: { track: "Row", lead: "top", mid: "middle", trail: "bottom" },
} as const;

/**
 * A datum in the words a person uses for it: `"Column 3 left — Page"`.
 *
 * The twin of `partLabel`, and here for the same reason it is beside
 * `parseInstancePart`: this is where the term's grammar is known, and a second
 * reader spelling `cg(page,3,left)` out by hand would be a second grammar.
 *
 * It matters more than a tidier panel. A datum is the one member of a rule that
 * a designer cannot point at — a card at 480 with nothing beside it looks like a
 * card somebody dragged there — so every sentence the tool builds out of a rule's
 * members has to be able to say "column three of the page". That is what makes
 * "*Align on Card, Column 3 left — Page* forces this" an answer to why the card
 * is where it is, where the raw term is only a receipt.
 *
 * Nothing for a term that is not a datum, exactly as `partLabel` answers nothing
 * for a node that is not an instance part, so a caller can chain the two and
 * fall through to the id. The name is the surface's own, unresolved — a datum on
 * a surface the document no longer holds still reads as its term's surface id,
 * which is more use than nothing while a rule is being repaired.
 */
export function datumLabel(scene: Scene, term: string): string | undefined {
	const datum = parseDatum(term);
	if (!datum) return undefined;
	let surface = datum.surface;
	eachNode(scene.nodes, (node) => {
		if (node.id === datum.surface) surface = node.name;
	});
	if (datum.kind === "line") return `Guide ${datum.guide} — ${surface}`;
	const spec = EDGES[datum.edge];
	const words = TRACK_WORDS[spec.axis];
	return `${words.track} ${datum.index} ${words[spec.place ?? "lead"]} — ${surface}`;
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */

/**
 * One complete treatment: the fields of the record a style's pick chooses.
 *
 * Each field is a {@link Term} rather than a {@link Value}, and that is the
 * point. A value is a list of alternatives and would branch on its own, which
 * is the cross product a style exists to collapse — a variant is *one* answer
 * for every property it mentions. Branching is what the list of variants is
 * for, and there is exactly one list.
 *
 * A term rather than a string so a field can name a token or be derived:
 * `size: ref("lg")` keeps one source of truth for the scale, and the same
 * resolution the rest of the document gets applies here — see `compile.ts`.
 */
export interface StyleVariant {
	/**
	 * What to call it. "Compact" and "Comfortable" are the reason a style is
	 * worth having, and they are not derivable from the parts: an ordinary
	 * alternative prints itself — `#3b82f6` — while a whole record has no
	 * printable value, only a summary. Optional so a document written without
	 * one still reads; see {@link variantLabel}.
	 */
	name?: string;
	parts: Partial<Record<PropName, Term>>;
}

/**
 * **One variable whose alternatives are whole records.**
 *
 * Not a {@link Token}, and the difference is not cosmetic. A token is
 * `{ type, value }` — a scalar whose legality is `PROPS[prop].type ===
 * token.type`, linkable to one property at a time. Link a size to one token and
 * a weight to another and the solver picks them *independently*: two
 * two-alternative tokens are four designs, of which two are incoherent. That is
 * the one thing the scalar model cannot express, and writing it out as N tokens
 * plus a `match` constraint per pair is unwritable.
 *
 * A style fixes exactly that. One pick decides size AND weight AND line height
 * together, so "compact versus comfortable typography across a whole page" is
 * one variable with two alternatives rather than four tokens with sixteen
 * combinations. It collapses a cross product into a correlation.
 *
 * Beside the tokens on {@link Scene} rather than among them, and `sty(S)` is a
 * variable key of its own — see {@link styleVar}. Everything downstream then
 * applies to it because it cannot tell the difference: it picks, it is pinnable,
 * it is greyed when unreachable, and a rule can name it.
 */
export interface Style {
	id: string;
	/** User-facing, like a token's. */
	name: string;
	/**
	 * Each entry is one complete treatment; a pick chooses between them.
	 *
	 * One entry is the ordinary named style — a bundle with no branching, which
	 * is what a style is in every other tool. Two or more is the design space.
	 */
	variants: StyleVariant[];
}

/** What a variant is called, falling back to its position. */
export const variantLabel = (style: Style, index: number): string =>
	style.variants[index]?.name?.trim() || `Variant ${index + 1}`;

export const findStyle = (
	styles: readonly Style[],
	id: string | undefined,
): Style | undefined => (id === undefined ? undefined : styles.find((s) => s.id === id));

/**
 * The style a node wears, if the document still holds it.
 *
 * A dangling reference resolves to nothing rather than failing, exactly as
 * {@link SceneNode.instanceOf} does: deleting a style out from under a wearer
 * leaves a node that decides its own appearance, not a broken program.
 */
export const styleOf = (scene: Scene, node: SceneNode): Style | undefined =>
	findStyle(scene.styles, node.style);

/**
 * Every property this style says something about, in table order.
 *
 * The union across its variants, filtered to {@link STYLE_PROPS} — so a field
 * one variant fills in and another leaves out is still one of the style's
 * properties, and a property no style may decide is dropped however it got
 * stored.
 */
export function styleProps(style: Style): PropName[] {
	return STYLE_PROPS.filter((prop) =>
		style.variants.some((v) => v.parts[prop] !== undefined),
	);
}

/**
 * The properties a style actually decides *for this node* — which is where
 * precedence is resolved, and it is resolved here rather than in ASP.
 *
 * Three filters, and each is a different question:
 *
 *   - the style says something about it at all;
 *   - the node's kind has somewhere to put it, so a text style worn by a
 *     rectangle decides nothing about the rectangle rather than painting a
 *     property it does not draw;
 *   - **the node does not state its own value.** A node wearing a style but
 *     differing in one property is the ordinary case, and the node wins. Doing
 *     this in the generated program would mean a rule whose body negates its own
 *     head predicate, which is the shape that has no stable model; the
 *     alternative — negating `var/1` — works, but `alt/2` is the one predicate
 *     hand-written rules are invited to derive, so a negative dependency on it
 *     is a loop waiting to happen. TypeScript knows the answer already.
 */
export function wornProps(scene: Scene, node: SceneNode): PropName[] {
	const style = styleOf(scene, node);
	if (!style) return [];
	const offered = KINDS[node.kind].props;
	return styleProps(style).filter(
		(prop) =>
			offered.includes(prop) && (node.props[prop]?.length ?? 0) === 0,
	);
}

/**
 * What the *document* says a node's property is: its own value, or the part its
 * style contributes.
 *
 * The same precedence the generated program applies, for the callers on this
 * side that have to know before there is any answer to read — measuring a text
 * node against the font it will actually be drawn in, above all. `picks` is the
 * universe being looked at; without one the first variant stands in, which is
 * what an unsolved preview should show.
 *
 * A single-term value, because a variant holds one answer per property. Nothing
 * here ever lengthens a list, so a caller can resolve it with the node's own
 * `prop(N,P)` key and get the same literal the solver derived.
 */
export function propValueOf(
	scene: Scene,
	node: SceneNode,
	prop: PropName,
	picks: Picks = {},
): Value | undefined {
	const own = node.props[prop];
	if (own && own.length > 0) return own;
	const style = styleOf(scene, node);
	if (!style || !KINDS[node.kind].props.includes(prop)) return undefined;
	const index = activeIndex(
		style.variants,
		styleVar(style.id),
		picks,
	);
	const term = index === -1 ? undefined : style.variants[index].parts[prop];
	return term ? [term] : undefined;
}

/* ------------------------------------------------------------------ */
/* State machines                                                      */
/* ------------------------------------------------------------------ */

/**
 * What makes a machine move.
 *
 * Deliberately the *input* rather than a name of the designer's own: a trigger
 * has to mean something to a browser at the far end, or the export is a
 * picture with a data attribute nobody sets. Half of these collapse to a CSS
 * pseudo-class and cost the export no script at all; the rest drive
 * `data-state` from a generated runtime. Which is which is the `css` column,
 * read off this table rather than decided at the emitter — see `export.ts`.
 */
export type Trigger =
	| "pointerenter"
	| "pointerleave"
	| "pointerdown"
	| "pointerup"
	| "focus"
	| "blur"
	| "click"
	| "load";

export interface TriggerSpec {
	label: string;
	/** The DOM event a runtime listens for, and the one the canvas fires. */
	event: string;
	/**
	 * The pseudo-class a *pair* of transitions collapses to, so that the most
	 * common machine anybody builds — rest and hover — leaves as a stylesheet
	 * with no behaviour in it. Null where CSS has no name for the condition.
	 */
	css: "hover" | "active" | "focus-visible" | null;
	/** The trigger that undoes it, where the pair is what CSS understands. */
	pair?: Trigger;
}

export const TRIGGERS: Record<Trigger, TriggerSpec> = {
	pointerenter: {
		label: "Pointer enters",
		event: "pointerenter",
		css: "hover",
		pair: "pointerleave",
	},
	pointerleave: {
		label: "Pointer leaves",
		event: "pointerleave",
		css: "hover",
		pair: "pointerenter",
	},
	pointerdown: {
		label: "Pressed",
		event: "pointerdown",
		css: "active",
		pair: "pointerup",
	},
	pointerup: {
		label: "Released",
		event: "pointerup",
		css: "active",
		pair: "pointerdown",
	},
	// `focusin`/`focusout` rather than `focus`/`blur`: the DOM pair that
	// bubbles, which is what a listener on the instance's own element needs when
	// the thing that took focus is a descendant of it.
	focus: {
		label: "Focused",
		event: "focusin",
		css: "focus-visible",
		pair: "blur",
	},
	blur: {
		label: "Blurred",
		event: "focusout",
		css: "focus-visible",
		pair: "focus",
	},
	click: { label: "Clicked", event: "click", css: null },
	// No event: a load trigger fires once, when the runtime starts. It is how a
	// machine says "settle into this state" rather than "wait to be poked".
	load: { label: "On load", event: "", css: null },
};

export const TRIGGER_NAMES = Object.keys(TRIGGERS) as Trigger[];

/**
 * How a transition is paced.
 *
 * The keys are ASP constants and reach the program as themselves, the way
 * `spaceBetween` does — the words a human reads are the `label`s.
 */
export type Easing = "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut";

export const EASINGS: Record<Easing, { label: string; css: string }> = {
	linear: { label: "Linear", css: "linear" },
	ease: { label: "Ease", css: "ease" },
	easeIn: { label: "Ease in", css: "ease-in" },
	easeOut: { label: "Ease out", css: "ease-out" },
	easeInOut: { label: "Ease in-out", css: "ease-in-out" },
};

export const EASING_NAMES = Object.keys(EASINGS) as Easing[];

/**
 * What a transition eases by default.
 *
 * `easeOut` rather than `ease`, because a state machine's transitions are
 * responses to a person: the interesting half of the curve is the beginning,
 * and a response that starts slowly reads as lag.
 */
export const DEFAULT_EASING: Easing = "easeOut";

/** One of the three numbers that pace a transition. */
export type MotionProp = "duration" | "delay" | "stagger";

export interface MotionPropSpec {
	label: string;
	type: ValueType;
	fallback: string;
	/**
	 * Whether a negative value means anything.
	 *
	 * Only a delay: a negative one starts the transition partway through, which
	 * is a real thing to ask for. A negative duration is not a fast transition
	 * and a negative stagger is not a reversed one — both are typos, and both
	 * are clamped to zero where they are read, exactly as a negative gap is.
	 */
	signed: boolean;
}

/**
 * Every input to the motion system, in one place — the twin of
 * {@link LAYOUT_PROPS} and {@link GUIDE_PROPS}, and it earns the shape for the
 * same reason both of those do: a bundle of settings that never paints, that
 * the program reads, and that may each hold alternatives or name a token.
 *
 * A `duration` token with two alternatives is a motion scale held in one
 * document — brisk and considered — and because the settings are values rather
 * than numbers, that really is two designs rather than two documents. It is the
 * grid argument, applied to time.
 */
export const MOTION_PROPS: Record<MotionProp, MotionPropSpec> = {
	duration: {
		label: "Duration",
		type: "duration",
		fallback: "200ms",
		signed: false,
	},
	delay: { label: "Delay", type: "duration", fallback: "0ms", signed: true },
	/**
	 * How much later each subsequent part starts, in `order/2` sequence.
	 *
	 * One number rather than a per-part offset, because a stagger is a *rhythm*
	 * and a table of offsets is a table nobody can read a rhythm off. Which
	 * parts it applies to is whichever ones the state actually changes.
	 */
	stagger: {
		label: "Stagger",
		type: "duration",
		fallback: "0ms",
		signed: false,
	},
};

export const MOTION_PROP_NAMES = Object.keys(MOTION_PROPS) as MotionProp[];

/**
 * What one state says about one definition part — a **delta**, not a node.
 *
 * This is the decision the whole feature turns on. A state could have been a
 * whole second copy of the subtree, and every design tool that has states does
 * it that way; the price is that editing the component means editing it N
 * times, and that "what does hover actually change?" is a diff nobody can see.
 * A delta is the answer to that question written down, which is also the thing
 * a designer means when they say the word.
 *
 * Every field is absent-is-inherit. A property the state says nothing about is
 * the instance's own, shared with every other state — which is not merely
 * economical, it is the invariant: a fill with two alternatives that four
 * states each re-minted would be sixteen designs where the document holds two.
 *
 * **A delta decides strictly more than a {@link StyleVariant} does**, and the
 * difference is not an inconsistency to tidy up later. A variant's `parts` are
 * filtered to {@link STYLE_PROPS} — no `text`, no `opacity`, no geometry and no
 * presence — because a style is a *treatment*: a claim that these nodes look
 * alike, which several unrelated nodes wear at once, and a treatment that moved
 * its wearers or made them say the same words would be one no two nodes could
 * share. A state is the opposite kind of claim. It is one machine's account of
 * one definition, in one of the situations that definition is in, and "the
 * panel is out of the picture when the menu is closed" and "the button is two
 * pixels lower while it is held down" are exactly what a person means by a
 * state. So `props` spans all of {@link PROPS}, `frame` spans the four
 * dimensions, and `hidden` is here — while adding, removing or reparenting a
 * node is *not*, because that would make a state a second document rather than
 * a reading of this one. Hiding is the one structural verb, and it is the one a
 * stylesheet can say.
 */
export interface StatePart {
	/**
	 * Appearance and content, as ordinary {@link Value}s — so a state's fill may
	 * name a token, hold alternatives, or be derived, exactly like a node's.
	 */
	props?: Partial<Record<PropName, Value>>;
	/**
	 * Geometry, in the part's *own parent-relative* coordinates — the same space
	 * {@link SceneNode.frame} is in. So a state that moves a container moves
	 * everything inside it for nothing, which is what makes the materialisation
	 * analysis in `machines.ts` affordable: a copy is minted for the parts some
	 * state touches and their *ancestors*, and never for their children.
	 */
	frame?: Partial<Record<Dimension, Value>>;
	/**
	 * Take this part out of the picture in this state.
	 *
	 * `true` or absent, like {@link SceneNode.component}, and deliberately with
	 * no `false`: a definition part is drawn unless a state says otherwise, so
	 * "shown" needs no spelling. A dropdown's panel is `hidden: true` in
	 * `closed` and silent in `open`.
	 */
	hidden?: true;
}

/**
 * True when a delta says anything at all — the question the materialisation
 * analysis asks of every entry before it mints a copy for the part.
 *
 * Here rather than at the analysis because it is a fact about the shape rather
 * than about the walk, and because "says nothing" has more spellings than it
 * looks: an entry left behind by an edit that cleared its last property is
 * `{ props: {} }`, and a property cleared in place is `{ props: { fill: [] } }`
 * — an empty {@link Value}, which resolves to no literal and so decides
 * nothing. Both are the same claim as no entry at all, and a reader that only
 * checked for the key would materialise a part, and a `sprop` variable with no
 * alternatives, on the strength of a leftover.
 */
export const stateTouches = (part: StatePart): boolean =>
	part.hidden === true ||
	Object.values(part.props ?? {}).some((v) => (v?.length ?? 0) > 0) ||
	Object.values(part.frame ?? {}).some((v) => (v?.length ?? 0) > 0);

/**
 * One state of a machine: a name, and a delta per definition part.
 *
 * The first state of a machine is its **initial** state, and there is no
 * `initial` flag — the order *is* the answer, the same way `order/2` is the
 * paint order and nothing carries a `onTop` flag. Reordering the list is how
 * the initial state changes, which is one edit rather than two that can
 * disagree.
 */
export interface MachineState {
	/**
	 * Unique among the states of *its own machine*, and spellable as an ASP
	 * constant — it reaches the program inside `stt(I,S,N)` and inside every
	 * variable key a delta mints.
	 *
	 * Per machine rather than per document, for the reason a {@link Guide}'s id
	 * is per surface: `hover` is what every machine in the document calls that
	 * state, and making them collide would be making them rename each other.
	 */
	id: string;
	/** What it is called. Free-form. */
	name: string;
	/** Definition part id -> what this state changes about it. */
	parts: Record<string, StatePart>;
}

/**
 * One edge: from a state, to a state, on a trigger, over some time.
 *
 * A transition carries no geometry and no appearance. It says *when* the
 * machine moves and *how long the move takes*, and nothing about what the
 * design looks like at either end — that is entirely the two states' business.
 * Keeping the two apart is what lets the export collapse a rest/hover pair into
 * `:hover` and a `transition:` declaration and emit no behaviour at all.
 */
export interface Transition {
	/** Unique among the transitions of its own machine; an ASP constant. */
	id: string;
	/** A state id of the same machine. */
	from: string;
	/** A state id of the same machine. */
	to: string;
	trigger: Trigger;
	/**
	 * How long the move takes, as a `duration` {@link Value} — so it may name a
	 * token and follow a motion scale. Absent takes `MOTION_PROPS.duration`'s
	 * fallback, which is what the program's own default rule says too.
	 */
	duration?: Value;
	/** How long before it starts. May be negative — see {@link MotionPropSpec.signed}. */
	delay?: Value;
	/** How much later each subsequent part moves, in `order/2` sequence. */
	stagger?: Value;
	easing?: Easing;
	/**
	 * Only tween these properties; everything else in the state's delta snaps.
	 *
	 * Absent is *everything the delta touches*, which is what a designer means
	 * by default. Present and empty is a transition that tweens nothing, which
	 * is a legal and occasionally wanted thing to say — "change instantly on
	 * press, ease back on release".
	 */
	only?: PropName[];
	/** Off keeps it in the document but out of the program. */
	enabled: boolean;
}

/**
 * A state machine, belonging to one component definition.
 *
 * On {@link Scene} rather than on the definition's root node, and beside the
 * styles rather than among the nodes, for the reason styles are: a machine is a
 * record with its own identity, its own list of states and its own lifecycle,
 * and a `SceneNode` field would give every rectangle in the document a slot for
 * one. It names its root instead, and a machine whose root is no longer a
 * definition simply says nothing — the same silence a dangling
 * {@link SceneNode.instanceOf} leaves.
 *
 * **This is component-local runtime behaviour and it is not the multiverse.**
 * Every state is true at once in one answer set; nothing here is ever an
 * alternative, and adding a state to a machine must leave the document's
 * universe count exactly where it was.
 */
export interface Machine {
	/** Unique in the document; an ASP constant. */
	id: string;
	name: string;
	/** The id of the component definition's root node — see `isDefinition`. */
	root: string;
	/** In order. **The first is the initial state.** Never empty. */
	states: MachineState[];
	transitions: Transition[];
}

/** Whatever a transition stores for one motion setting, if anything. */
export function motionValueOf(
	transition: Transition,
	prop: MotionProp,
): Value | undefined {
	return transition[prop];
}

/**
 * What a motion setting comes to, following whatever token it names — the same
 * walk the generated program does through `resolved/2`, and the twin of
 * {@link guideSetting} over the twin table.
 *
 * Nothing for a setting the transition does not hold, or one that resolves to
 * no literal at all; the program behaves the same way, through
 * `not mreadsdur(M,T)` and its two siblings, and the caller falls back to the
 * table.
 */
export function motionSetting(
	machine: Machine,
	transition: Transition,
	prop: MotionProp,
	context: ResolveContext = NO_CONTEXT,
): string | undefined {
	return resolveValue(
		context,
		motionValueOf(transition, prop),
		motionVar(machine.id, transition.id, prop),
	);
}

/**
 * One motion setting in whole milliseconds, falling back to the table's own
 * default — the twin of {@link guideLength}, and it clamps for the same reason
 * that one does, minus one exception the table states.
 *
 * A duration and a stagger clamp at zero, because a negative duration is not a
 * fast transition and a negative stagger is not a reversed one; both are typos,
 * and the generated program clamps them in exactly the same place with exactly
 * the same argument (`mdur(M,T,0) :- …, V < 0`). A **delay does not**, because a
 * negative delay starts the move partway through, which is a real thing to ask
 * for — {@link MotionPropSpec.signed} is where that difference is stated once
 * and this is the only reader of it.
 *
 * Read with `msOf`, which is exact or nothing: a setting spelled `"1.5ms"` is
 * not a whole millisecond, reads as no duration at all, and so takes the
 * fallback rather than being rounded behind the designer's back. That is the
 * same answer the program gives, and giving a different one here would put a
 * number in the panel that no exported file agrees with.
 */
export function motionMs(
	machine: Machine,
	transition: Transition,
	prop: MotionProp,
	context?: ResolveContext,
): number {
	const resolved = motionSetting(machine, transition, prop, context);
	const read = resolved === undefined ? undefined : msOf(resolved);
	const ms = read ?? msOf(MOTION_PROPS[prop].fallback) ?? 0;
	return MOTION_PROPS[prop].signed ? ms : Math.max(0, ms);
}

/**
 * How a transition is paced, falling back to {@link DEFAULT_EASING}.
 *
 * A word rather than a {@link Value}, so this is a lookup rather than a
 * resolution: an easing is a closed menu of five curves with no arithmetic in
 * it, nothing scales it, and a `duration` token is where a document says "all
 * my motion moves together". A stored word the table does not know falls back
 * rather than being carried, exactly as an unknown {@link Scene.unit} does —
 * the emitter would otherwise write a CSS timing function no browser parses.
 */
export const easingOf = (transition: Transition): Easing =>
	transition.easing !== undefined && Object.hasOwn(EASINGS, transition.easing)
		? transition.easing
		: DEFAULT_EASING;

export interface Scene {
	/** Named values, referenced from anywhere. Like CSS custom properties. */
	tokens: Token[];
	/**
	 * Correlated bundles of properties, worn by nodes — see {@link Style}.
	 *
	 * Beside the tokens rather than among them: a token is a scalar with a type,
	 * a style is a record with variants, and forcing one into the other's shape
	 * would give every style a `ValueType` that means nothing and every token a
	 * variant list of one.
	 */
	styles: Style[];
	/**
	 * State machines, by the definitions they drive — see {@link Machine}.
	 *
	 * Beside the styles and the constraints rather than among them. A style is a
	 * variable, a constraint is a rule, and a machine is neither: it is
	 * behaviour, it never branches the space, and it is the first thing in this
	 * document that is about *time*.
	 */
	machines: Machine[];
	/**
	 * Paint order: later nodes sit on top. Top-level nodes are normally
	 * frames — the artboards — but nothing enforces that.
	 */
	nodes: SceneNode[];
	/** Rules the design must obey, authored without writing ASP. */
	constraints: Constraint[];
	/**
	 * Free-form ASP appended after the generated program — the power-user
	 * escape hatch. Rules here can constrain or vary anything above.
	 */
	rules: string;
	/**
	 * The unit this document is measured in, for the two purposes a *display*
	 * unit has: what the inspector shows and offers, and what a length nobody
	 * has spelled yet gets written in. It governs no read — a stored `"16"` is
	 * pixels whatever this says, or the meaning of every legacy value in the
	 * document would move when a designer changed a menu.
	 *
	 * Optional, and its absence carries a second meaning that is worth more than
	 * the first one today: **a document with no unit predates EMU**. Every
	 * length in this document is a unit-suffixed string and reads the same in
	 * either era — that is what keeping the storage format bought — but a *bare
	 * number* does not, and a path's vertices are bare numbers in the current
	 * format too. `normalizeScene` stamps it, and seeing it absent is how that
	 * migration knows those vertices are still pixels.
	 *
	 * So exactly two things write it, and the second one is why the field exists
	 * at all: `normalizeScene`, which puts it there, and `setUnit`, which is the
	 * inspector's unit menu and can only ever exchange one unit for another.
	 * Nothing may take it away again — a document that could lose the stamp is a
	 * document that gets migrated twice — and nothing else should set it without
	 * reading that migration first.
	 */
	unit?: Unit;
}

/** The size the document's first frame is created at, in EMU. */
export const DEFAULT_FRAME = { width: fromPx(720), height: fromPx(480) };

export const RULES_HEADER = `% Power-user panel — plain ASP, appended after the generated program.
% Everything above is generated from the document; these rules can constrain
% or vary any of it.
`;

/**
 * The variables a new document starts with.
 *
 * These are ordinary tokens with nothing special about them — a starting
 * palette, not a fixed system. Rename, delete or add freely.
 */
export function starterTokens(): Token[] {
	return [
		{ id: "accent", name: "accent", type: "color", value: single("#3b82f6") },
		{ id: "surface", name: "surface", type: "color", value: single("#ffffff") },
		{ id: "muted", name: "muted", type: "color", value: single("#e2e8f0") },
		{ id: "ink", name: "ink", type: "color", value: single("#0f172a") },
		{ id: "subtle", name: "subtle", type: "color", value: single("#475569") },
		{ id: "radius", name: "radius", type: "length", value: single("8px") },
	];
}

/**
 * A new document starts with one frame, because a canvas with nothing to draw
 * on is not a useful blank page.
 */
export function emptyScene(): Scene {
	return {
		tokens: starterTokens(),
		// No starter styles. A palette is a reasonable thing to hand somebody
		// before they have drawn anything; a treatment for text that does not
		// exist yet is not.
		styles: [],
		// And no starter machines, for a stronger version of the same reason: a
		// machine belongs to a component definition, and a new document has no
		// components in it. One made in advance would name a root that does not
		// exist, which is a machine that says nothing at all.
		machines: [],
		nodes: [
			{
				id: "frame1",
				kind: "frame",
				name: "Frame 1",
				frame: makeFrame({ x: 0, y: 0, ...DEFAULT_FRAME }),
				props: { fill: [ref("surface")] },
				children: [],
			},
		],
		constraints: [],
		rules: RULES_HEADER,
		// Stated rather than left to the default, because absence means "written
		// before EMU" — see {@link Scene.unit}. A document made now is not.
		unit: DEFAULT_UNIT,
	};
}

/**
 * The area the document occupies, used to lay out copies of it in the
 * multiverse. Falls back to a default-sized box for an empty document.
 */
export function documentBounds(
	scene: Scene,
	context: ResolveContext = NO_CONTEXT,
): Frame {
	// Only the roots matter: children are relative to them, so they are inside.
	return (
		boundsOf(scene.nodes.map((n) => frameOf(n, context))) ?? {
			x: 0,
			y: 0,
			...DEFAULT_FRAME,
		}
	);
}

/**
 * `base`, then `base<sep>2`, `base<sep>3`, … — the first one not already taken.
 * Shared by everything the user names: projects, tokens.
 */
export function uniqueName(
	taken: Iterable<string>,
	base: string,
	separator = " ",
): string {
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}${separator}${n}`;
		if (!used.has(candidate)) return candidate;
	}
}

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

/** Tokens of one type — the legal things to link a value of it to. */
export function tokensOfType(scene: Scene, type: ValueType): Token[] {
	return scene.tokens.filter((t) => t.type === type);
}

/** Tokens whose type matches a property — the legal things to link it to. */
export function tokensFor(scene: Scene, prop: PropName): Token[] {
	return tokensOfType(scene, PROPS[prop].type);
}

/**
 * A computed length in EMU, as the {@link Value} a constraint or a dimension is
 * stored as. One line of {@link writeLength}, which is where the reasoning is.
 */
export const dimension = (emu: Emu, unit: Unit = DEFAULT_UNIT): Value =>
	single(writeLength(emu, unit));

/**
 * The length a constraint's value comes to in EMU, following whatever token it
 * names.
 *
 * The same walk the generated program does through `resolved/2` and
 * `numeral/2`, done here for the editor: the row has to show a number, and a
 * seeded constraint has to be measured before there is any answer to read it
 * out of. `picks` is the universe being looked at, if there is one.
 *
 * Nothing rather than zero when the value is not a length — a `gap` linked to a
 * token holding `50%` has no distance to show, and a row that printed 0 would be
 * claiming it did.
 */
export function constraintValue(
	scene: Scene,
	constraint: Constraint,
	picks: Picks = {},
): Emu | undefined {
	const resolved = resolveValue(
		{ tokens: scene.tokens, picks },
		constraint.value,
		constraintVar(constraint.id),
	);
	return resolved === undefined ? undefined : emuOf(resolved);
}

/** A default value for a property that has none yet. */
export function defaultValue(prop: PropName): Value {
	return [lit(PROPS[prop].fallback)];
}
