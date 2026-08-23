/**
 * The design document.
 *
 * Geometry is continuous and relative to the enclosing node — a node has
 * x/y/width/height the way a designer expects. It reaches ASP as *facts*, not
 * as choices: `frame(n1,x,120)` is four atoms, whereas making a coordinate
 * choosable would ground a domain of thousands per node.
 *
 * Everything else is a {@link Value}: a list of alternatives, each a literal or
 * a token reference. One alternative is an ordinary design; two or more is a
 * branch the solver explores.
 */
import { type Frame, type PathPoint, boundsOf } from "./geometry.ts";
import {
	type Picks,
	type ResolveContext,
	type Token,
	VALUE_TYPES,
	type Value,
	type ValueType,
	constraintVar,
	layoutVar,
	lit,
	numeralOf,
	ref,
	resolveValue,
	single,
} from "./values.ts";

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
}

export const PROPS: Record<PropName, PropSpec> = {
	// Content is a property like any other: a headline that reads one way or
	// another is a design decision, and the machinery for "one of these" is
	// already here. Nothing about a string made it special except history.
	text: { label: "Text", type: "text", fallback: VALUE_TYPES.text.fallback },
	fill: { label: "Fill", type: "color", fallback: VALUE_TYPES.color.fallback },
	radius: {
		label: "Corner radius",
		type: "length",
		fallback: VALUE_TYPES.length.fallback,
	},
	stroke: { label: "Stroke", type: "color", fallback: "#0f172a" },
	strokeWidth: { label: "Thickness", type: "length", fallback: "2px" },
	shadow: {
		label: "Shadow",
		type: "shadow",
		fallback: VALUE_TYPES.shadow.fallback,
	},
	opacity: { label: "Opacity", type: "number", fallback: "1" },
	ink: { label: "Colour", type: "color", fallback: "#0f172a" },
	fontFamily: {
		label: "Font",
		type: "font",
		fallback: VALUE_TYPES.font.fallback,
	},
	size: { label: "Size", type: "length", fallback: "16px" },
	weight: {
		label: "Weight",
		type: "weight",
		fallback: VALUE_TYPES.weight.fallback,
	},
	lineHeight: { label: "Line height", type: "number", fallback: "1.35" },
	align: {
		label: "Alignment",
		type: "align",
		fallback: VALUE_TYPES.align.fallback,
	},
};

export type NodeKind =
	| "frame"
	| "rect"
	| "ellipse"
	| "line"
	| "arrow"
	| "path"
	| "text"
	| "group";

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
	/** Size a click with no drag produces. */
	defaultSize: { width: number; height: number };
	/** Has pixels of its own: it paints, it can be hit, it attracts snaps. */
	drawable: boolean;
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
		defaultSize: { width: 480, height: 320 },
		drawable: true,
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
		defaultSize: { width: 160, height: 120 },
		drawable: true,
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
		defaultSize: { width: 140, height: 140 },
		drawable: true,
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
		defaultSize: { width: 160, height: 96 },
		drawable: true,
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
		defaultSize: { width: 160, height: 96 },
		drawable: true,
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
		defaultSize: { width: 120, height: 120 },
		drawable: true,
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
		defaultSize: { width: 160, height: 28 },
		drawable: true,
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
		defaultSize: { width: 0, height: 0 },
		drawable: false,
		container: true,
		surface: false,
		wrapsChildren: true,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
	},
};

export const NODE_KINDS = Object.keys(KINDS) as NodeKind[];

/** The kinds a pointer can draw out. A group is only ever made from a selection. */
export const DRAW_KINDS = NODE_KINDS.filter((k) => KINDS[k].drawable);

/** The shapes, in the order their shared toolbar slot cycles through them. */
export const SHAPE_KINDS = DRAW_KINDS.filter((k) => KINDS[k].shape);

export const isDrawable = (node: SceneNode): boolean => KINDS[node.kind].drawable;
export const isSurface = (node: SceneNode): boolean => KINDS[node.kind].surface;
export const wrapsChildren = (node: SceneNode): boolean =>
	KINDS[node.kind].wrapsChildren;
export const isDiagonal = (node: SceneNode): boolean =>
	KINDS[node.kind].diagonal;
export const isPlotted = (node: SceneNode): boolean =>
	KINDS[node.kind].plotted;

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
	gap: { label: "Gap", type: "length", fallback: "16px", on: "container" },
	/** Inside every edge of the container. */
	padding: {
		label: "Padding",
		type: "length",
		fallback: "16px",
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
					? `${given}px`
					: given,
		);
	}
	return out;
}

export interface SceneNode {
	id: string;
	kind: NodeKind;
	/** Shown in the layer list; free-form. */
	name: string;
	/**
	 * Relative to the parent's origin — see the note in `tree.ts`.
	 *
	 * Under an {@link AutoLayout} parent this is not where the node sits: the
	 * solver decides that. It stays as the size the node asks for, and as
	 * where it returns to if the layout is removed.
	 */
	frame: Frame;
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
	/** Present on the container kinds. */
	children?: SceneNode[];
	/** Set on a container to lay its children out automatically. */
	layout?: AutoLayout;
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

/** The same, as pixels, falling back to the table's default. */
export function layoutLength(
	node: SceneNode,
	prop: LayoutProp,
	context?: ResolveContext,
): number {
	const resolved = layoutSetting(node, prop, context);
	const n = resolved === undefined ? undefined : numeralOf(resolved);
	return Math.max(0, n ?? numeralOf(LAYOUT_PROPS[prop].fallback) ?? 0);
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
	| "pin";

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
		minNodes: 1,
		maxNodes: 1,
		geometric: true,
		edges: [...PLACES, ...SPANS],
		valueType: "length",
		seed: [{ slot: 1, place: "self", weight: 1 }],
		annotation: "edges",
	},
};

export const CONSTRAINT_NAMES = Object.keys(CONSTRAINT_KINDS) as ConstraintKind[];

/**
 * A rule the design must obey, expressed over a property of several nodes.
 *
 * Constraints are what turn a list of alternatives into a design *space*:
 * without them the universes are just the cross product of everything the user
 * typed. Each one is compiled behind its own switch so the solver can report
 * exactly which of them conflict — see `compile()`.
 */
export interface Constraint {
	id: string;
	kind: ConstraintKind;
	/** The property being constrained. Meaningless to the geometric kinds. */
	prop: PropName;
	/** Nodes it ranges over, in the order they were named. */
	nodes: string[];
	/** Distinct-value budget, for the counted kinds. */
	limit?: number;
	/** Which quantity, for the geometric kinds. */
	edge?: Edge;
	/**
	 * What a `gap`, a `pin` or a mirror line holds to, in pixels.
	 *
	 * A {@link Value} like any other, so it can be a number typed in or a link
	 * to a `length` token — and a token with three alternatives driving it is a
	 * design table: the same drawing at three sizes. It reaches ASP as the
	 * variable {@link constraintVar} names, and `c_value(C,V)` is then derived
	 * per universe rather than being a fact.
	 */
	value?: Value;
	/** Off keeps it in the document but out of the program. */
	enabled: boolean;
}

export interface Scene {
	/** Named values, referenced from anywhere. Like CSS custom properties. */
	tokens: Token[];
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
}

/** The size the document's first frame is created at. */
export const DEFAULT_FRAME = { width: 720, height: 480 };

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
		nodes: [
			{
				id: "frame1",
				kind: "frame",
				name: "Frame 1",
				frame: { x: 0, y: 0, ...DEFAULT_FRAME },
				props: { fill: [ref("surface")] },
				children: [],
			},
		],
		constraints: [],
		rules: RULES_HEADER,
	};
}

/**
 * The area the document occupies, used to lay out copies of it in the
 * multiverse. Falls back to a default-sized box for an empty document.
 */
export function documentBounds(scene: Scene): Frame {
	// Only the roots matter: children are relative to them, so they are inside.
	return (
		boundsOf(scene.nodes.map((n) => n.frame)) ?? { x: 0, y: 0, ...DEFAULT_FRAME }
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

/** A whole number of pixels, as the {@link Value} a dimension is stored as. */
export const dimension = (n: number): Value => single(`${Math.round(n)}px`);

/**
 * The number a constraint's dimension comes to, following whatever token it
 * names.
 *
 * The same walk the generated program does through `resolved/2` and
 * `numeral/2`, done here for the editor: the row has to show a number, and a
 * seeded constraint has to be measured before there is any answer to read it
 * out of. `picks` is the universe being looked at, if there is one.
 */
export function constraintValue(
	scene: Scene,
	constraint: Constraint,
	picks: Picks = {},
): number | undefined {
	const resolved = resolveValue(
		{ tokens: scene.tokens, picks },
		constraint.value,
		constraintVar(constraint.id),
	);
	return resolved === undefined ? undefined : numeralOf(resolved);
}

/** A default value for a property that has none yet. */
export function defaultValue(prop: PropName): Value {
	return [lit(PROPS[prop].fallback)];
}
