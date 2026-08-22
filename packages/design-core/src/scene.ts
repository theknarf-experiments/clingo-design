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
import { type Frame, boundsOf } from "./geometry.ts";
import {
	FALLBACK,
	type Token,
	type Value,
	type ValueType,
	lit,
	ref,
	single,
} from "./values.ts";

export type PropName = "fill" | "radius" | "ink" | "size" | "weight";

export interface PropSpec {
	label: string;
	type: ValueType;
	/** Shown as the placeholder and used when adding an alternative. */
	fallback: string;
}

export const PROPS: Record<PropName, PropSpec> = {
	fill: { label: "Fill", type: "color", fallback: FALLBACK.color },
	radius: { label: "Corner radius", type: "length", fallback: FALLBACK.length },
	ink: { label: "Colour", type: "color", fallback: "#0f172a" },
	size: { label: "Size", type: "length", fallback: "16px" },
	weight: { label: "Weight", type: "weight", fallback: FALLBACK.weight },
};

export type NodeKind = "frame" | "rect" | "text" | "group";

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
	/** What a new node of this kind starts with. */
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
}

export const KINDS: Record<NodeKind, KindSpec> = {
	frame: {
		label: "Frame",
		props: ["fill", "radius"],
		defaults: { fill: [lit("#ffffff")] },
		defaultSize: { width: 480, height: 320 },
		drawable: true,
		container: true,
		surface: true,
		wrapsChildren: false,
	},
	rect: {
		label: "Rectangle",
		props: ["fill", "radius"],
		defaults: { fill: [lit(FALLBACK.color)], radius: [lit(FALLBACK.length)] },
		defaultSize: { width: 160, height: 120 },
		drawable: true,
		container: false,
		surface: false,
		wrapsChildren: false,
	},
	text: {
		label: "Text",
		props: ["ink", "size", "weight"],
		defaults: {
			ink: [lit(PROPS.ink.fallback)],
			size: [lit(PROPS.size.fallback)],
			weight: [lit(FALLBACK.weight)],
		},
		defaultSize: { width: 160, height: 28 },
		drawable: true,
		container: false,
		surface: false,
		wrapsChildren: false,
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
	},
};

export const NODE_KINDS = Object.keys(KINDS) as NodeKind[];

/** The kinds a pointer can draw out. A group is only ever made from a selection. */
export const DRAW_KINDS = NODE_KINDS.filter((k) => KINDS[k].drawable);

export const isDrawable = (node: SceneNode): boolean => KINDS[node.kind].drawable;
export const isSurface = (node: SceneNode): boolean => KINDS[node.kind].surface;
export const wrapsChildren = (node: SceneNode): boolean =>
	KINDS[node.kind].wrapsChildren;

/* ------------------------------------------------------------------ */
/* Automatic layout                                                    */
/* ------------------------------------------------------------------ */

export type Direction = "row" | "column";
/** Where children sit on the axis they are *not* stacked along. */
export type Align = "start" | "center" | "end" | "stretch";

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
	props: Partial<Record<PropName, Value>>;
	/** Present on the container kinds. */
	children?: SceneNode[];
	/** Set on a container to lay its children out automatically. */
	layout?: AutoLayout;
	/** Under a laid-out parent: take a share of the leftover space. */
	grow?: boolean;
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
