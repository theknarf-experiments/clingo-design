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
import { type Frame, type Point, boundsOf } from "./geometry.ts";
import {
	type Token,
	VALUE_TYPES,
	type Value,
	type ValueType,
	lit,
	ref,
	single,
} from "./values.ts";

export type PropName =
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
			"ink",
			"fontFamily",
			"size",
			"weight",
			"lineHeight",
			"align",
			"opacity",
		],
		defaults: {
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
 * `atMost` does — see {@link CONSTRAINT_KINDS}. {@link JUSTIFICATIONS} carries
 * the words a human reads.
 */
export type Justify = "start" | "center" | "end" | "spaceBetween";

export const JUSTIFICATIONS: Record<Justify, string> = {
	start: "start",
	center: "center",
	end: "end",
	spaceBetween: "space between",
};

/**
 * Turns a container into a solved layout rather than a free-form canvas.
 *
 * The positions are not stored: they are variables in a system of linear
 * equations the solver answers, which is why "these three share the leftover
 * space" is expressible at all. Everything here is an *input* to that system.
 */
export interface AutoLayout {
	direction: Direction;
	/** Between adjacent children, in pixels. */
	gap: number;
	/** Inside every edge of the container. */
	padding: number;
	align: Align;
	justify: Justify;
	/**
	 * Whether the container takes its size from its contents.
	 *
	 * Hugging is the default because the alternative is a box whose size has
	 * nothing to do with what it holds: arrange four things in a row and a
	 * fixed container simply clips them.
	 */
	sizing: Sizing;
}

export type Sizing = "hug" | "fixed";

export const ALIGNMENTS = new Set<string>(["start", "center", "end", "stretch"]);

export const DEFAULT_LAYOUT: AutoLayout = {
	direction: "row",
	gap: 16,
	padding: 16,
	align: "start",
	justify: "start",
	sizing: "hug",
};

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
	text?: string;
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
	points?: Point[];
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
	/** Under a laid-out parent: take a share of the leftover space. */
	grow?: boolean;
	/**
	 * Under a laid-out parent: sit differently on the cross axis from its
	 * siblings. Absent means whatever the container says.
	 */
	alignSelf?: Align;
}

/** True when this node's children are placed by the solver. */
export const isLaidOut = (node: SceneNode): boolean =>
	node.layout !== undefined && (node.children?.length ?? 0) > 0;

/* ------------------------------------------------------------------ */
/* Constraints                                                         */
/* ------------------------------------------------------------------ */

export type ConstraintKind = "differ" | "match" | "atMost";

export interface ConstraintSpec {
	label: string;
	/** Phrased for the constraint list, with `{prop}` and `{n}` filled in. */
	summary: string;
	/** True when the kind reads {@link Constraint.limit}. */
	counted: boolean;
	/** Fewest nodes for the constraint to say anything. */
	minNodes: number;
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
	},
	match: {
		label: "All the same",
		summary: "share one {prop}",
		counted: false,
		minNodes: 2,
	},
	atMost: {
		label: "At most N distinct",
		summary: "use at most {n} distinct {prop}",
		counted: true,
		minNodes: 2,
	},
};

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
	/** The property being constrained. */
	prop: PropName;
	/** Nodes it ranges over. */
	nodes: string[];
	/** Distinct-value budget, for the counted kinds. */
	limit?: number;
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

/** Tokens whose type matches a property — the legal things to link it to. */
export function tokensFor(scene: Scene, prop: PropName): Token[] {
	const type = PROPS[prop].type;
	return scene.tokens.filter((t) => t.type === type);
}

/** A default value for a property that has none yet. */
export function defaultValue(prop: PropName): Value {
	return [lit(PROPS[prop].fallback)];
}
