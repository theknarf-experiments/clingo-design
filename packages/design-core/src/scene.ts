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
	mdegOf,
	motionVar,
	msOf,
	ref,
	rotateVar,
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
	| "fit"
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
	| "align"
	// From here down: the properties of a thing in three dimensions, plus the
	// one CSS number that has nothing to do with the scene. See §1.2 of
	// `docs/three-d-spec.md`, and note that colour is *reused* rather than
	// re-invented — a mesh's base colour is `fill` and a light's is `ink`, which
	// is what lets a brand palette light a 3D scene with nothing wired up.
	| "solid"
	| "roughness"
	| "metalness"
	| "lamp"
	| "intensity"
	| "fov"
	| "near"
	| "far"
	| "perspective";

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
	fit: {
		label: "Fit",
		type: "fit",
		fallback: VALUE_TYPES.fit.fallback,
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
	/**
	 * Which primitive a `mesh` is.
	 *
	 * A closed menu and therefore a {@link Value} like a `direction` is, which is
	 * the whole reason it is a property rather than a field: `[box, sphere]` is a
	 * real design question with two answers, and a `solid` token pointed at by
	 * six meshes is a family that changes shape together. A field would have made
	 * that a second kind of variation with its own editor, and the multiverse
	 * would have had nothing to say about it.
	 */
	solid: {
		label: "Solid",
		type: "solid",
		fallback: VALUE_TYPES.solid.fallback,
		styleable: false,
		inherited: false,
	},
	/**
	 * How rough the surface is: 0 is a mirror, 1 is chalk.
	 *
	 * A `number`, not a new quantity, and for the reason {@link lineHeight} is
	 * one: it is a bare proportion, compared and interpolated as itself, and
	 * `numeralOf` already reads exactly that. **Clamped to [0,1] where it is
	 * read, not here** — the reader is `roughnessOf` in `spatial.ts` and the
	 * clamp is stated once, because two clamp sites is two answers and only one
	 * of them can be checked headless.
	 */
	roughness: {
		label: "Roughness",
		type: "number",
		fallback: "0.6",
		styleable: true,
		inherited: false,
	},
	metalness: {
		label: "Metalness",
		type: "number",
		fallback: "0",
		styleable: true,
		inherited: false,
	},
	/**
	 * Which kind of lamp a `light` is.
	 *
	 * Same argument as {@link solid}: "key light or ambient" is a design
	 * decision, so it is a value with a menu behind it rather than a field with a
	 * dropdown of its own.
	 */
	lamp: {
		label: "Lamp",
		type: "lamp",
		fallback: VALUE_TYPES.lamp.fallback,
		styleable: false,
		inherited: false,
	},
	/**
	 * How bright a light is. Unbounded above; negative is clamped to zero where
	 * it is read, exactly as a negative gap is.
	 */
	intensity: {
		label: "Intensity",
		type: "number",
		fallback: "1",
		styleable: true,
		inherited: false,
	},
	/**
	 * A camera's vertical field of view.
	 *
	 * The one property of the `angle` type, and it is here rather than as a plain
	 * number so that a document can hold "wide and long" as two alternatives of
	 * one `angle` token and get two designs of the same scene — which is the
	 * whole grid argument, applied to a lens.
	 */
	fov: {
		label: "Field of view",
		type: "angle",
		fallback: "50deg",
		styleable: false,
		inherited: false,
	},
	/**
	 * The near and far clip planes, as ordinary lengths in EMU.
	 *
	 * Lengths rather than bare numbers because they *are* lengths in the world
	 * the scene is measured in, which means a `length` token drives them and the
	 * unit machinery reads them with no new reader. `far` below `near` is refused
	 * by `lensOf` rather than clamped here, for {@link roughness}' reason.
	 */
	near: {
		label: "Near",
		type: "length",
		fallback: pxLength(1),
		styleable: false,
		inherited: false,
	},
	far: {
		label: "Far",
		type: "length",
		fallback: pxLength(20000),
		styleable: false,
		inherited: false,
	},
	/**
	 * How far the eye is from a CSS 3D scene — the `perspective` declaration, and
	 * nothing whatsoever to do with a `camera` node.
	 *
	 * Offered on `frame` only. It is the one number CSS needs before a `rotateY`
	 * on a child means anything, and it is a length like every other, so a
	 * document may hold two of them. The exporter is the only reader; nothing on
	 * the canvas and nothing in the program consults it, because inside a
	 * viewport the camera decides the projection and outside one there is no
	 * projection to decide.
	 */
	perspective: {
		label: "Perspective",
		type: "length",
		fallback: pxLength(1200),
		styleable: false,
		inherited: false,
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
	| "instance"
	// The seam, and what is on the far side of it. A `viewport` is an ordinary
	// 2D rectangle on the artboard that happens to contain a 3D scene; the five
	// below it are that scene. Every one of them is `node/1` with a `kind/2`, a
	// `child/2`, an `order/2`, a `visible/1` and a `frame/3` — there is no
	// parallel 3D document model, which is what makes the layer list, hit
	// testing, grouping, undo, sync, the multiverse, pinning and the unsat core
	// work on a mesh the day the kind is added.
	| "viewport"
	| "pivot"
	| "mesh"
	| "image"
	| "model"
	| "camera"
	| "light";

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
	/**
	 * This kind lives in three dimensions: it reads {@link SceneNode.spatial} and
	 * {@link SceneNode.turn}, it is drawn by the 3D renderer rather than by the
	 * DOM, and the HTML export cannot carry it.
	 *
	 * **Not the same question as being *inside* a viewport**, and the difference
	 * is load-bearing. A `rect` with a `z` and a `rotateZ` is a flat box that CSS
	 * can draw exactly, with a real `translate3d`; a `mesh` is geometry CSS has
	 * no word for. This column is the second of those, and it is what the
	 * exporter branches on. What decides where a node *is* is
	 * {@link SceneNode.spatial}, which every kind may hold.
	 *
	 * Required rather than optional, for {@link styleable}'s reason one table
	 * over: the answer is a fact about the kind and belongs beside it, and a list
	 * somewhere else quietly falls behind.
	 */
	spatial: boolean;
	/**
	 * The pointer stops here: what is inside is picked by something else.
	 *
	 * True for exactly one kind, `viewport`. A mesh's silhouette on screen is a
	 * projection of its geometry through a camera, and this document's own hit
	 * testing knows about axis-aligned rectangles in EMU — so `hitTestTree`
	 * descending into a viewport would answer with a frame that has nothing to do
	 * with the pixels anybody clicked. It stops at the box instead, and the
	 * raycaster inside the viewport answers the question it is actually equipped
	 * for.
	 *
	 * Deliberately *not* the same as {@link surface}, which also clips: a surface
	 * takes new nodes drawn over it, and dragging a rectangle over a 3D view
	 * means "a rectangle on top of the view", never "a rectangle inside the
	 * scene". `opaque` buys the clipping and the pointer behaviour without the
	 * drop behaviour.
	 */
	opaque: boolean;
}

/** Which corner-to-corner run a diagonal kind draws. */
export type Diagonal = "down" | "up";

export const KINDS: Record<NodeKind, KindSpec> = {
	frame: {
		label: "Frame",
		// `perspective` last, and only here: it is the CSS declaration that makes
		// a `rotateY` on a child mean anything, so it belongs to the surface the
		// turned children sit on and nowhere else. Nothing on the canvas and
		// nothing in the program reads it — see `PROPS.perspective`.
		props: [
			"fill",
			"radius",
			"stroke",
			"strokeWidth",
			"shadow",
			"opacity",
			"perspective",
		],
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
		spatial: false,
		opaque: false,
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
		spatial: false,
		opaque: false,
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
		spatial: false,
		opaque: false,
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
		spatial: false,
		opaque: false,
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
		spatial: false,
		opaque: false,
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
		spatial: false,
		opaque: false,
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
		spatial: false,
		opaque: false,
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
		spatial: false,
		opaque: false,
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
		spatial: false,
		opaque: false,
	},
	/**
	 * The seam: a rectangle on the artboard that contains a 3D scene, and names
	 * the camera it looks through.
	 *
	 * `tool: true` and `shape: false`, so it gets its own toolbar slot beside
	 * `frame` rather than hiding behind the shape menu — a 3D view is not a
	 * shape, and the one thing worse than an extra button is a button nobody
	 * finds. `surface: false` and `opaque: true` for the reason on
	 * {@link KindSpec.opaque}: it clips and it stops the pointer, and it does not
	 * accept a drop.
	 *
	 * It is not itself `spatial`. Everything above it — artboards, layout,
	 * guides, the grid, the HTML exporter, the 2D pointer — is exactly the tool
	 * it is today, because a viewport is a rectangle with a fill and a radius and
	 * nothing above it has to look inside. Everything below it is three
	 * dimensional.
	 */
	viewport: {
		label: "3D view",
		props: ["fill", "radius", "stroke", "strokeWidth", "opacity"],
		defaults: { fill: [lit("#0b1020")] },
		defaultSize: { width: fromPx(480), height: fromPx(320) },
		drawable: true,
		tool: true,
		container: true,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
		spatial: false,
		opaque: true,
	},
	/**
	 * A transform node inside a scene: a place and a rotation, and no size.
	 *
	 * `pivot` rather than reusing `group`, and the difference is not cosmetic. A
	 * group is `wrapsChildren: true`: it re-fits to its children's 2D bounding
	 * box and dissolves when ungrouped. Inside a viewport that re-fitting is
	 * meaningless — the bounding box of rotated solids is exactly the
	 * trigonometry a linear solver cannot do — so a 3D grouping node is a
	 * transform with a place and a rotation of its own and nothing to re-fit.
	 * Naming it `pivot` says which of the two it is.
	 */
	pivot: {
		label: "Pivot",
		props: [],
		defaults: {},
		defaultSize: { width: fromPx(0), height: fromPx(0) },
		drawable: false,
		tool: false,
		container: true,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
		spatial: true,
		opaque: false,
	},
	/**
	 * One of the six primitives, named by a {@link Value} — see `PROPS.solid`.
	 *
	 * Not `tool: true`, and neither is anything else in three dimensions: you
	 * cannot drag a box out in three dimensions with a two-dimensional pointer
	 * and mean anything by it. A mesh, a camera and a light are added by an edit
	 * from the viewport's own menu, exactly as a group comes from a selection and
	 * an instance from a definition.
	 */
	mesh: {
		label: "Solid",
		props: ["solid", "fill", "roughness", "metalness", "opacity"],
		defaults: {
			solid: [lit(VALUE_TYPES.solid.fallback)],
			fill: [lit(PROPS.fill.fallback)],
			roughness: [lit(PROPS.roughness.fallback)],
		},
		defaultSize: { width: fromPx(100), height: fromPx(100) },
		drawable: true,
		tool: false,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
		spatial: true,
		opaque: false,
	},
	/**
	 * Imported geometry — see {@link SceneNode.mesh}.
	 *
	 * A separate kind rather than a flag on {@link mesh}, and the precedent is
	 * exact: `rect` is parametric and `path` is `plotted: true` with its vertices
	 * on the node. A mesh is one of six primitives named by a value; a model is a
	 * payload whose reference is a field. Two kinds, for the same reason there
	 * are two kinds today.
	 *
	 * It states **no `fill` default on purpose**: an imported material is the
	 * file's, and a fill the document did not ask for would silently repaint
	 * every imported asset the moment it landed. Stated, it overrides — which is
	 * the affordance a designer wants and the default nobody wants.
	 */
	image: {
		label: "Image",
		// `fit` first: it is the one a designer changes, because a box is almost
		// never the aspect of the picture in it. No `fill` — an image *is* its
		// pixels, and a colour behind them would only be seen through the
		// letterboxing, which is a thing to notice rather than a thing to offer.
		props: ["fit", "radius", "opacity"],
		defaults: {},
		// Only ever seen by a node whose file went missing before it was placed:
		// an import sizes the node to the picture's own dimensions.
		defaultSize: { width: fromPx(200), height: fromPx(150) },
		drawable: true,
		// Not a tool. Every other drawable kind is made by dragging a box, and an
		// image cannot be — there is a file to choose first, and its intrinsic
		// size is what the box should be. It arrives through Import.
		tool: false,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
		spatial: false,
		// Not opaque. That column is the viewport seam — "does the pointer stop
		// here" — and an image has nothing inside for a pointer to reach. A leaf
		// with no children answers it the way every other leaf does.
		opaque: false,
	},
	model: {
		label: "Model",
		props: ["fill", "roughness", "metalness", "opacity"],
		defaults: {},
		defaultSize: { width: fromPx(100), height: fromPx(100) },
		drawable: true,
		tool: false,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
		spatial: true,
		opaque: false,
	},
	/**
	 * An eye in the scene. Not `drawable`: what a camera contributes to the
	 * picture is the projection, not a silhouette, and the marker the editor
	 * draws for it is an overlay rather than a node's pixels.
	 *
	 * It still holds properties, and it is the first kind in this table that
	 * does so without painting. A lens is a set of numbers the renderer reads;
	 * `drawable` is a claim about pixels, and the two have finally come apart.
	 */
	camera: {
		label: "Camera",
		props: ["fov", "near", "far"],
		defaults: {},
		defaultSize: { width: fromPx(0), height: fromPx(0) },
		drawable: false,
		tool: false,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
		spatial: true,
		opaque: false,
	},
	/**
	 * A lamp. Its colour is `ink` — "the colour the thing itself is" — which is
	 * the property a `color` token already drives, so a brand palette lights the
	 * scene with nothing wired up.
	 *
	 * `drawable: false` for {@link camera}'s reason, and yet `visible/1` still
	 * governs it: hiding a light is how a state darkens a scene, and that is one
	 * of the affordances the "a 3D object is an ordinary scene node" decision was
	 * bought for. Hiding a *camera*, by contrast, means stop drawing its marker
	 * and not stop looking — see `vcam/2`.
	 */
	light: {
		label: "Light",
		props: ["lamp", "ink", "intensity"],
		defaults: {
			lamp: [lit(VALUE_TYPES.lamp.fallback)],
			ink: [lit("#ffffff")],
			intensity: [lit(PROPS.intensity.fallback)],
		},
		defaultSize: { width: fromPx(0), height: fromPx(0) },
		drawable: false,
		tool: false,
		container: false,
		surface: false,
		wrapsChildren: false,
		shape: false,
		diagonal: false,
		measured: false,
		plotted: false,
		spatial: true,
		opaque: false,
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
/**
 * True when this kind *is* geometry in three dimensions — a mesh, a model, a
 * camera, a light or a pivot.
 *
 * The question the exporter asks before it tries to write markup for a node,
 * and the question the 3D renderer asks before it mounts one. Not the question
 * "is this node inside a viewport", which is about the tree and is answered in
 * `spatial.ts`: a `rect` with a `z` is a flat box CSS can draw exactly, and a
 * `mesh` on a plain artboard is still geometry nothing on the DOM path can
 * carry.
 */
export const isSpatialKind = (node: Kinded): boolean => KINDS[node.kind].spatial;
/** True when the pointer stops at this node — see {@link KindSpec.opaque}. */
export const isOpaque = (node: Kinded): boolean => KINDS[node.kind].opaque;
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

/* ------------------------------------------------------------------ */
/* The third axis                                                      */
/* ------------------------------------------------------------------ */

/*
 * **{@link Dimension} and {@link FrameValue} are not widened. A parallel
 * two-row table is added beside them, and `frame/3` in the generated program
 * carries all six.**
 *
 * The alternative — six required keys on `FrameValue` — was worked through and
 * rejected three times over, and the reasons are the reasons the whole
 * no-regression promise holds:
 *
 *   - `FrameValue` is `Record<Dimension, Value>`, *required*. Widening it makes
 *     every {@link makeFrame}, every template, every test fixture and every
 *     stored document invalid until it grows two more keys. That is not a
 *     migration, it is a rewrite.
 *   - `makeFrame` would then write two more values per node, so every rectangle
 *     in every document would gain two `frame/3` facts and two more chances to
 *     vary. Multiplicity is something a designer asks for, not something every
 *     box on the canvas is born with.
 *   - The scene defaults in the generated program key off the geometry
 *     vocabulary, so widening it there gives every node in every document a
 *     `frame(N,z,0)` whether or not the document has ever heard of a third
 *     axis. A viewport on page four should put *its own subtree* into three
 *     dimensions, not the whole file.
 *
 * So the third axis is **optional and sparse everywhere**: absent is z 0 and
 * depth 0, which is where a flat document already is, and a document with no 3D
 * in it holds no `spatial` anywhere and costs exactly nothing.
 */

/** The two numbers that put a node in the third dimension. */
export type Spatial = "z" | "depth";

/**
 * Any of the six — the vocabulary a rule and the solver share.
 *
 * Named `Axis3` rather than `Dimension3` because it is what an *edge* is about
 * as well as what a frame holds, and because the four-versus-six distinction is
 * the only thing about it worth reading off the name.
 */
export type Axis3 = Dimension | Spatial;

/**
 * The two spatial dimensions, in one place — the twin of {@link FRAME_DIMS}.
 *
 * {@link DimensionSpec} is reused unchanged: `z` is a `pos` and `depth` is a
 * `span`, which is all the geometry rules ever ask of a dimension. That reuse
 * is what makes the third axis cost one table rather than a parallel rule set —
 * a `pos` flows through the same equations `x` does, with the same coefficients,
 * so nothing about the grounding ceiling moves either.
 */
export const SPATIAL_DIMS: Record<Spatial, DimensionSpec> = {
	z: { label: "z", type: "length", fallback: pxLength(0), role: "pos" },
	depth: { label: "depth", type: "length", fallback: pxLength(0), role: "span" },
};

export const SPATIALS = Object.keys(SPATIAL_DIMS) as Spatial[];

/** The six, planar first, so a loop over them is a loop in reading order. */
export const DIMENSIONS_3D: Axis3[] = [...DIMENSIONS, ...SPATIALS];

/**
 * What one dimension is, whichever of the six it is — the lookup that lets a
 * caller iterate {@link DIMENSIONS_3D} without knowing which table a name came
 * out of.
 */
export const dimensionSpec = (dim: Axis3): DimensionSpec =>
	Object.hasOwn(FRAME_DIMS, dim)
		? FRAME_DIMS[dim as Dimension]
		: SPATIAL_DIMS[dim as Spatial];

/** What a node holds about the third axis. Sparse: absent is z 0, depth 0. */
export type SpatialValue = Partial<Record<Spatial, Value>>;

/**
 * A sparse spatial record from plain numbers, for a gesture or a template.
 *
 * **Sparse on purpose, and it is the whole of the no-regression story in one
 * function**: only the dimensions the caller names are written, so
 * `makeSpatial({})` is `{}` and a node that has never been lifted holds nothing
 * at all. In pixels, for {@link makeFrame}'s reason — there is no document here
 * to ask what unit it is in, and a length in another unit gets into the document
 * by being typed or by being kept.
 */
export function makeSpatial(spatial: Partial<Record<Spatial, number>>): SpatialValue {
	const out: SpatialValue = {};
	for (const dim of SPATIALS) {
		const given = spatial[dim];
		if (given !== undefined) out[dim] = single(writeLength(given));
	}
	return out;
}

/**
 * What one spatial dimension comes to in EMU, following whatever token it names
 * — the twin of {@link frameDim}, and the same walk the generated program does.
 *
 * **Absent is 0**, exactly as the program's own default rule makes it for a node
 * that is in the third axis, and exactly as a frame dimension that resolves to
 * no length at all is. So a reader never has to ask whether the field is there.
 */
export function spatialDim(
	node: SceneNode,
	dim: Spatial,
	context: ResolveContext = NO_CONTEXT,
): Emu {
	const resolved = resolveValue(
		context,
		node.spatial?.[dim],
		frameVar(node.id, dim),
	);
	return (resolved === undefined ? undefined : emuOf(resolved)) ?? 0;
}

/**
 * Both, as the plain pair — the twin of {@link frameOf}.
 *
 * Structurally `SpatialFrame` from `geometry.ts`, which is the name the rest of
 * the system knows this pair by; it is spelled `Record<Spatial, number>` here
 * only because the two are the same type and this file is the one that owns the
 * word `Spatial`. See the note in the return-value report for why the import is
 * not written yet.
 */
export function spatialOf(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): Record<Spatial, number> {
	return {
		z: spatialDim(node, "z", context),
		depth: spatialDim(node, "depth", context),
	};
}

/**
 * A node with some of its third axis replaced by numbers — the twin of
 * {@link withFrame}, and it obeys the same rules with one stated exception.
 *
 * The same: the write lands on **the alternative the visible universe picked**,
 * an alternative that names a token or is derived is left exactly as it is, and
 * each dimension is written back in the unit it was already spelled in.
 *
 * The exception: a dimension the node **does not hold at all** is written as a
 * fresh single-alternative literal rather than skipped. That is not the
 * inconsistency it looks like. A frame always has four dimensions, so an absent
 * one there is impossible and a non-literal one is a deliberate link a drag must
 * not unwire; the third axis is sparse, so absence is *silence* rather than a
 * link, and writing a number where the document said nothing is exactly what
 * dragging a mesh forward means. There is no other way to state a z for the
 * first time.
 *
 * `depth` is **not** clamped to {@link MIN_NODE_SIZE}, where `width` and
 * `height` are: a plane is a real primitive with a real depth of zero, and a
 * clamp would make the flattest solid in the menu unspellable.
 */
export function withSpatial(
	node: SceneNode,
	patch: Partial<Record<Spatial, number>>,
	context: ResolveContext = NO_CONTEXT,
): SceneNode {
	let spatial: SpatialValue | undefined;
	for (const dim of SPATIALS) {
		const next = patch[dim];
		if (next === undefined) continue;
		const value = node.spatial?.[dim];
		if (value === undefined || value.length === 0) {
			spatial ??= { ...node.spatial };
			spatial[dim] = single(writeLength(next));
			continue;
		}
		const index = activeIndex(value, frameVar(node.id, dim), context.picks);
		const term = index === -1 ? undefined : value[index];
		if (term?.kind !== "literal") continue;
		if (emuOf(term.value) === next) continue;
		const written = writeLength(next, unitOf(term.value));
		if (term.value === written) continue;
		spatial ??= { ...node.spatial };
		spatial[dim] = value.map((t, i) => (i === index ? lit(written) : t));
	}
	return spatial ? { ...node, spatial } : node;
}

/**
 * True when a drag cannot write this spatial dimension: the alternative on
 * screen is a link rather than a number, so the answer lives in the token.
 *
 * The twin of {@link frameFrozen}, and it answers `false` for a dimension the
 * node does not hold — see {@link withSpatial} for why silence is writable where
 * a link is not.
 */
export function spatialFrozen(
	node: SceneNode,
	dim: Spatial,
	context: ResolveContext = NO_CONTEXT,
): boolean {
	const value = node.spatial?.[dim];
	if (value === undefined || value.length === 0) return false;
	const index = activeIndex(value, frameVar(node.id, dim), context.picks);
	return index === -1 || value[index].kind !== "literal";
}

/* ------------------------------------------------------------------ */
/* Rotation                                                            */
/* ------------------------------------------------------------------ */

/** One of the three axes a node may be turned about. */
export type Turn = "rotateX" | "rotateY" | "rotateZ";

export interface TurnSpec {
	label: string;
	/** The axis it turns about, so a rule and the renderer read one table. */
	axis: "x" | "y" | "z";
	/** The CSS function, for the 3D-transform half of the export. */
	css: "rotateX" | "rotateY" | "rotateZ";
}

/**
 * The three rotations, in one place.
 *
 * **Order of application is fixed and is not a document field: `rotateZ`, then
 * `rotateY`, then `rotateX`, about the node's own centre, then the
 * translation.** That is CSS's own order for `rotateX(..) rotateY(..)
 * rotateZ(..)` read left to right, and three.js's default `XYZ` Euler order read
 * as intrinsic rotations, so the two renderers agree with no conversion. A
 * document field for the order was considered and rejected: it is a fifth thing
 * that can differ between the canvas and the file, in exchange for expressing
 * rotations that are also expressible by composing a {@link KINDS.pivot}.
 *
 * **About the node's own centre**, and that is the decision the whole feature
 * turns on rather than a convenience. A rotation about the centre does not move
 * the centre, so `centerX`, `centerY` and `centerZ` stay exactly the linear
 * quantities they were and a rotated node can still be placed, sized and put in
 * the world chain by a linear solver. What it cannot be is *measured* on a face:
 * a turned box's left edge is `cx − (|w·cos θ| + |h·sin θ|)/2`, which is not
 * linear in anything, so those quantities are refused rather than approximated.
 */
export const TURNS: Record<Turn, TurnSpec> = {
	rotateX: { label: "Turn about X", axis: "x", css: "rotateX" },
	rotateY: { label: "Turn about Y", axis: "y", css: "rotateY" },
	rotateZ: { label: "Turn about Z", axis: "z", css: "rotateZ" },
};

export const TURN_NAMES = Object.keys(TURNS) as Turn[];

/** What a node holds about how it is turned. Sparse: absent is 0 everywhere. */
export type TurnValue = Partial<Record<Turn, Value>>;

/**
 * What one rotation comes to, in **thousandths of a degree**, following whatever
 * token it names — the twin of {@link spatialDim} one quantity over.
 *
 * Thousandths because a fact has to be an integer and a designer will type
 * `22.5deg` on the first day; a thousandth of a degree is an arcsecond and a
 * bit, four orders finer than anything a screen resolves. Read with `mdegOf`,
 * which is exact or nothing, so a rotation spelled in a unit no whole thousandth
 * spells reads as **no rotation at all** rather than as a rounded one — the same
 * answer the generated program gives, and the same reason `motionMs` gives for
 * refusing `"1.5ms"`.
 */
export function turnMdeg(
	node: SceneNode,
	turn: Turn,
	context: ResolveContext = NO_CONTEXT,
): number {
	const resolved = resolveValue(
		context,
		node.turn?.[turn],
		rotateVar(node.id, turn),
	);
	return (resolved === undefined ? undefined : mdegOf(resolved)) ?? 0;
}

/** All three, in thousandths of a degree. */
export function turnOf(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): Record<Turn, number> {
	return {
		rotateX: turnMdeg(node, "rotateX", context),
		rotateY: turnMdeg(node, "rotateY", context),
		rotateZ: turnMdeg(node, "rotateZ", context),
	};
}

/**
 * True when any of the three is non-zero **in this universe**.
 *
 * The universe matters, and it is why this takes a context rather than looking
 * at the field: an `angle` token holding `[0deg, 30deg]` is a card that lies
 * flat in one design and tilts in another, and the quantities a rule may be
 * about differ between the two. A reader that asked only whether `node.turn`
 * existed would refuse a rule about the flat design's left edge, which is a
 * refusal with nothing behind it.
 */
export function isTurned(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): boolean {
	return TURN_NAMES.some((turn) => turnMdeg(node, turn, context) !== 0);
}

/**
 * True when a resize gesture cannot be trusted on this node, because it is
 * turned.
 *
 * The editor reads this beside {@link frameFrozen} and hides the resize handles.
 * `resizeFrame` drags a *side of an axis-aligned box*, and on a turned node the
 * side under the pointer is not the side the arithmetic would move — so the
 * handle would be a control that did something other than what it looked like.
 * The inspector's width and height fields still work and are still exact.
 *
 * A separate name from {@link isTurned} rather than an alias of it, though they
 * agree today, because they are two different questions and only one of them is
 * settled: `isTurned` is a fact about the document, while this is a claim about
 * what a gesture can do, and the day `geometry.ts` grows an oriented-box resize
 * for the quarter-turn cases this one stops being the other.
 */
export function rotationFrozen(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): boolean {
	return isTurned(node, context);
}

/* ------------------------------------------------------------------ */
/* Imported geometry                                                   */
/* ------------------------------------------------------------------ */

/**
 * The reference to imported geometry: a **file in the project's tree, and one
 * part of it**.
 *
 * **The bytes are not here**, and that is the one place this departs from the
 * path precedent it otherwise follows exactly. A path's points are a few dozen
 * numbers and belong in the document; a glTF is megabytes, the document is an
 * Automerge document two people edit at once, and putting a binary blob in it
 * would put that blob in every diff, every undo entry and every sync message. So
 * the node holds the reference, the box and the counts — everything the *editor*
 * needs to draw a layer row, run a constraint and know what it is looking at —
 * and the geometry stays in the file it was imported from.
 *
 * ## Addressed by path, not by a hash of the payload
 *
 * `/assets/chair.glb` is what the tree shows, what a clone writes to disk, what
 * a colleague receives, and what this points at — so **replacing that file
 * replaces the chairs everywhere they are used**, because the reference is to
 * *the file* and not to bytes that happened to be there. That is the same
 * sentence {@link ImageRef} already carries, and stating it of both kinds is
 * what makes `asset/2` in the answer set mean one thing rather than
 * one-and-a-half.
 *
 * What the old content hash bought was a store that can never hold the wrong
 * bytes under a name, and it bought it by making the reference untouchable:
 * replacing a chair meant re-importing every node that drew one, and the file a
 * person had chosen and named was not in their project at all — only a hash was.
 * That trades a guarantee nobody asked for against the operation everybody asks
 * for.
 *
 * *Rejected: keeping a content hash of the file **beside** the path*, to make
 * staleness exactly detectable. It would defeat the feature it was protecting: a
 * reference that refuses when the bytes change is a hash reference wearing a
 * path. This document deliberately does not know whether the file at its path is
 * the one it was imported from, and the cheap witness where that matters is
 * already here — {@link triangles}, against what the file's own primitive holds,
 * which is a sentence in a relink list rather than a refusal to draw. A
 * re-tessellated chair is still the chair.
 *
 * ## When the file changes underneath
 *
 * Re-saved at the same path, the new geometry is drawn in the old box: the fit
 * is to {@link bounds}, so a chair that changed proportions looks stretched
 * until somebody says otherwise. The repair is an **ordinary edit** — measure
 * the file and rewrite these six numbers and the node's frame — and not a
 * migration, because nothing about the document is wrong. Structurally
 * different, {@link part} may address a primitive the file no longer holds; the
 * loader refuses that reference and the node draws its stand-in box. Missing
 * altogether, the same box, and the path in the relink list.
 */
export interface MeshRef {
	/**
	 * Absolute path in the project's tree — `/assets/chair.glb`.
	 *
	 * This is also the relink handle. There is no separate "the file it came
	 * from" field any more: the file it came from is the file it points at, and
	 * a second, free-form copy of the name was a second answer to the same
	 * question that nothing kept true.
	 */
	src: string;
	format: "gltf" | "glb";
	/**
	 * Which part of that file — two indices into the file's own arrays, and
	 * nothing derived from its bytes.
	 *
	 * **The glTF node index, not the mesh index.** The mesh is
	 * `json.nodes[part.node].mesh`, so storing that too would be a second address
	 * for one thing and would spell `node.mesh.mesh`. The *node* is what has to
	 * be stored, because it is what the scale chain is computed from: one mesh
	 * instanced by two nodes at two scales is two different pieces of geometry,
	 * and a mesh index alone could not tell them apart.
	 *
	 * **Indices rather than names**, because glTF names are optional, non-unique
	 * and routinely absent from an optimised export, while an index survives a
	 * byte-identical re-import exactly — which is the case that matters, since
	 * dropping the same file in twice must address the same geometry.
	 *
	 * `primitive` is the second index because a mesh drawn in three materials
	 * arrives as three nodes — a node holds one fill — and each of them owns one
	 * primitive of that mesh.
	 */
	part: {
		/** Index into the file's `nodes` — **not** a {@link SceneNode.id}. */
		node: number;
		/** Index into that node's mesh's `primitives`. */
		primitive: number;
	};
	/**
	 * The box the vertices occupy, in the model's own space, in EMU.
	 *
	 * Six numbers — structurally `Box` from `geometry.ts`, which is
	 * {@link Frame} and the third axis together. Spelled out here rather than
	 * imported for the reason given on {@link spatialOf}.
	 *
	 * Here rather than measured from the file for {@link ImageRef}'s exact
	 * reason: it is needed **before the payload arrives** — to place the node at
	 * the size the geometry really is, and to keep a real box while the bytes are
	 * loading, missing, or on the far end of a sync. A `model` with no file is
	 * still a node the solver places, a rule aligns and a pivot turns.
	 */
	bounds: Frame & Record<Spatial, number>;
	/** This part's own count — for the layer list, the budget rule and the status line. */
	triangles: number;
}

/**
 * A raster image the document points at rather than holds.
 *
 * The same trade {@link MeshRef} makes, and for a sharper reason: a photograph
 * is megabytes of pixels with no structure to merge, and a document is diffed,
 * undone and synced on every keystroke.
 *
 * **Addressed by path, not by hash.** The image is a real file in the project's
 * tree — `/assets/hero.png` — with the name the person who imported it chose,
 * and this node references that file. Which means it is a file in every sense
 * the rest of the world uses the word: it appears in the tree, it clones onto
 * disk under its own name, and replacing it replaces the picture everywhere it
 * is used, because the reference is to *the file* rather than to some bytes
 * that happened to be there.
 *
 * The intrinsic size is here rather than read from the payload because it is
 * needed before the payload arrives: to place a new node at the size the picture
 * really is, and to keep the right aspect while the bytes are loading, missing,
 * or on the far end of a sync.
 */
export interface ImageRef {
	/** Absolute path in the project's tree — `/assets/hero.png`. */
	src: string;
	/** The media type, so a data url and an `<img>` agree about what it is. */
	mimeType: string;
	/** Intrinsic pixel dimensions, as the decoder reported them. */
	width: number;
	height: number;
}

/** What the document remembers about an asset it does not hold. */
export interface AssetInfo {
	format: "gltf" | "glb";
	/** Payload length in bytes, so the studio can total it without loading it. */
	bytes: number;
	triangles: number;
	name: string;
}

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
	/**
	 * Which state of each *further* layer this instance is drawn in — layer id to
	 * state id.
	 *
	 * {@link state} keeps saying what it says, and says it about the **first**
	 * layer. Two fields for one idea is a smell and it is being paid for on
	 * purpose: every machine that exists today has one layer, every instance that
	 * exists today says its state in one string, and making them all grow a
	 * record keyed by a layer id nobody named would be churn with no reader — and
	 * a migration, which is a thing that can go wrong, in exchange for a tidiness
	 * nobody can see.
	 *
	 * An entry here for the first layer wins over {@link state}, so there is
	 * exactly one place a multi-layer document says the whole answer. Nothing is
	 * corrected on the way in.
	 */
	states?: Record<string, string>;
	/**
	 * Where the node sits on the third axis and how deep it is — see
	 * {@link SPATIAL_DIMS}.
	 *
	 * Optional and sparse, which is the whole design: a document with no 3D in it
	 * holds no `spatial` anywhere, states no `frame(N,z,_)`, grounds no third
	 * axis and costs exactly nothing. Absent is z 0 and depth 0, which is where a
	 * flat document already is.
	 *
	 * **Read on every kind, not only the spatial ones.** A `rect` with a `z` is a
	 * card lifted off the page, and the HTML export draws it with a real CSS
	 * `translate3d`. What decides whether a node is *geometry* is
	 * {@link KindSpec.spatial}; what this decides is only where the node is.
	 */
	spatial?: SpatialValue;
	/**
	 * How the node is turned, per axis — see {@link TURNS}.
	 *
	 * Optional and sparse for the same reason {@link spatial} is, and read on
	 * every kind for the same reason. Rotation is about the node's own centre,
	 * which is what keeps every centre and every span an honest linear quantity
	 * on a turned node, and what makes the refusal of its *faces* a line a
	 * designer can be shown rather than a limitation nobody mentions.
	 */
	turn?: TurnValue;
	/**
	 * On a `viewport`: the id of the `camera` node the view looks through.
	 *
	 * A dangling id derives nothing rather than failing, the way a dangling
	 * {@link instanceOf} does — the renderer then frames the subtree with a
	 * default camera and the status line says so. Naming a node that is not a
	 * camera, or a camera outside this viewport's own subtree, is the same
	 * silence, and it is silence rather than repair because deleting a camera has
	 * to leave a legal document.
	 */
	camera?: string;
	/**
	 * On a `model`: the imported geometry — see {@link MeshRef}.
	 *
	 * The vertices themselves are **not here**. This is the reference, the box
	 * they occupy and the counts; the geometry is in the file at
	 * {@link MeshRef.src}, in the project's tree, exactly as an `image`'s pixels
	 * are. It is the third axis's answer to {@link points}, and it sits beside it
	 * for that reason.
	 */
	mesh?: MeshRef;
	/**
	 * On an `image`: which file in the tree it draws — see {@link ImageRef}.
	 *
	 * The pixels are **not here**, for the reason `mesh` and `points` are not
	 * either. A node whose file is missing is still a node: it has a place, a
	 * size, and a rule that can name it. What it lacks is a picture, which is a
	 * relink rather than a failure.
	 */
	image?: ImageRef;
	/**
	 * Take this node and everything under it out of the picture.
	 *
	 * `true` or absent, like {@link SceneNode.component} and like a state's own
	 * `hidden`, and deliberately with no `false`: a node is drawn unless
	 * something says otherwise, so "shown" needs no spelling.
	 *
	 * It reaches the program as `hidden/1`, which the contract has always
	 * documented as assertable and which `visible/1` is derived against — so a
	 * hidden node is absent from the picture, absent from an export, and still
	 * entirely present as a node: it has an id, a place, a kind, and a rule may
	 * name it. That is what makes it the right way to carry a **component
	 * definition that lives in another document**, which is drawn on its own
	 * canvas and must not appear on every page that uses it.
	 */
	hidden?: true;
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
	| "y"
	| "front"
	| "centerZ"
	| "back"
	| "depth"
	| "z";

export interface EdgeSpec {
	label: string;
	/**
	 * Which of the three the quantity is measured along.
	 *
	 * Three since the third axis landed, and the widening is the *only* thing
	 * that ever stood between `EDGES` and its `z` rows — see the note on the
	 * table. Everything that reads this and can only draw in two dimensions
	 * skips a `z` row rather than narrowing the type back: `annotate.ts` is the
	 * one such reader, and what it draws for a rule about `centerZ` is nothing,
	 * which is the answer its own comment predicted.
	 */
	axis: "x" | "y" | "z";
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
 *
 * **The third axis's five rows are here**, and the decision that was blocking
 * them is recorded because it is the interesting part. Widening
 * {@link EdgeSpec.axis} from `"x" | "y"` costs `annotate.ts` twenty-eight
 * errors, all of one shape: it hands the axis straight to two module-private
 * helpers that measure a rectangle, and its exported `Annotation.axis` is the
 * planar pair. Somebody had to decide what the canvas overlay *draws* for a rule
 * about `centerZ`, and the answer is **nothing** — a depth is not a distance on
 * the page, there is no line to rule across it and no place to hang a label, and
 * a mark that projected one onto the plane would be a mark about a number the
 * page does not contain. So `annotate.ts` skips a `z` row and keeps its own
 * type; it is the same refusal `axisBounds` makes about a turned node, in the
 * one other file that draws.
 *
 * Everything else took the rows with no edit at all, which is what the previous
 * note predicted: {@link edgeOptions} filters by axis through a `Set<string>`,
 * {@link PLACES}/{@link SPANS}/{@link AXES} are role filters, and
 * `CONSTRAINT_KINDS[k].edges` widened with them. `compile.ts`'s `EDGE_FACTS`
 * already emitted a `z` row behind `:- spatial.` for the day this landed, so a
 * flat document grounds not one of them and `gedge(front` is still absent from
 * its program.
 *
 * **`front` is the lead and `back` is the trail**, because +z points *away* from
 * the viewer — the same convention `SPATIALS` states and the same one that makes
 * a camera sit at negative z. Getting this backwards would put `gplace(front,
 * trail)` in the program and quietly invert every depth rule in the document.
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
	front: { label: "Front face", axis: "z", role: "pos", place: "lead" },
	centerZ: { label: "Depth centre", axis: "z", role: "pos", place: "mid" },
	back: { label: "Back face", axis: "z", role: "pos", place: "trail" },
	depth: { label: "Depth", axis: "z", role: "span" },
	z: { label: "In depth", axis: "z", role: "axis" },
};

export const EDGE_NAMES = Object.keys(EDGES) as Edge[];

/** The positional edge at one end (or the middle) of an axis. */
export const edgeOn = (
	axis: "x" | "y" | "z",
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

/**
 * True when this node id names something that lives in the third axis: a
 * viewport, anything inside one, or a node the document has lifted or turned by
 * name.
 *
 * The document-side half of `s3/1`, and deliberately module-private. Its public
 * twin is `isSpatialNode` in `spatial.ts`, which is where every other spatial
 * reading lives — but `spatial.ts` reads *this* file, so a reader here cannot
 * call it without closing a cycle, and {@link edgeOptions} has to be here
 * because `CONSTRAINT_KINDS` is. Two readers of one rule is the cost; the rule
 * itself is three lines and is stated in the program as well, which is the
 * arrangement `machineHealth` and `munreached/2` already keep and test.
 *
 * A member that is not a plain node id — a datum, an instance part `inst(I,N)`,
 * a state copy `stt(I,S,N)`, a keyframe copy `kfr(I,W,R,K)` — answers **false**.
 * That is a deliberate under-approximation rather than an oversight: reducing
 * those terms needs the parsers in `components.ts` and `machines.ts`, both of
 * which read this file, and offering an edge the program will refuse through
 * `gnoedge/2` is a worse failure than not offering one it would have accepted.
 * The panel's own refusal reader (`refusedEdge`, in `spatial.ts`) does reduce
 * them, and it is the one that has to be exact.
 */
function inThirdAxis(scene: Scene, member: string): boolean {
	let found = false;
	const walk = (nodes: readonly SceneNode[], inside: boolean): void => {
		for (const node of nodes) {
			if (found) return;
			const here = inside || node.kind === "viewport";
			if (node.id === member) {
				found =
					here ||
					Object.keys(node.spatial ?? {}).length > 0 ||
					Object.keys(node.turn ?? {}).length > 0;
				return;
			}
			if (node.children) walk(node.children, here);
		}
	};
	walk(scene.nodes, false);
	return found;
}

/**
 * The edges this kind may be about, given the members it has.
 *
 * The table's own list narrowed to the axes the members actually live on: a rule
 * over two rectangles is offered six places and two sizes, exactly as it is
 * today, and one that names only nodes inside a 3D view is offered the third
 * axis as well. Read here rather than filtered at the panel, because
 * `annotate.ts`, `why.ts` and the seeding in `addConstraint` all ask the same
 * question and three copies of it drift.
 *
 * **Empty members is the whole list**, because a rule being built has not said
 * what it is about yet and refusing everything would be refusing the first
 * click.
 *
 * Every member must be in the third axis for the third axis to be offered, not
 * merely one: a rule spanning the seam is either exact-and-surprising (on a
 * shared planar axis, where it measures model space and says nothing about
 * pixels) or hollow (on z, where one member has no such quantity at all), and
 * the second of those is the one this narrowing is here to prevent.
 */
export function edgeOptions(
	scene: Scene,
	kind: ConstraintKind,
	members: readonly string[],
): Edge[] {
	const offered = CONSTRAINT_KINDS[kind].edges;
	if (members.length === 0) return [...offered];
	// The planar pair always, and the third only where every member has a
	// quantity on it. A `Set<string>` rather than of the axis union because it is
	// a filter and not a claim about the vocabulary.
	const axes = new Set<string>(["x", "y"]);
	if (members.every((member) => inThirdAxis(scene, member))) axes.add("z");
	return offered.filter((edge) => axes.has(EDGES[edge].axis));
}

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
	// A grid rules a *page*, which is a rectangle: there are columns and there
	// are rows and there is no third family of them, so `TRACK_WORDS` has two
	// axes and a datum on the third is a term nothing in this codebase mints.
	// Answered with nothing rather than with an invented word, which is what this
	// function already does for a term that is not a datum at all.
	if (spec.axis === "z") return undefined;
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

/**
 * One of the three numbers that pace a transition.
 *
 * **It should be four.** {@link Transition.exit} is a fourth pacing number of
 * exactly this shape — a `duration` {@link Value} that wants to name the same
 * motion scale the other three do — and the plan for it is to be an entry here,
 * so that `MOTION_DEFAULTS`, `machineValues`, `unreadVariables`, the document
 * reader and the fourth row in `Transitions.tsx` all extend themselves with no
 * edit at all. That is the whole reason the exit-time rung is cheap.
 *
 * It is **not** here yet, and the reason is an ordering error rather than a
 * design one: `compile.ts` holds `MOTION_DEFAULT_PREDICATES:
 * Record<MotionProp, string>`, so adding a member to this union makes that file
 * fail to typecheck for want of one line — `exit: "mdefexit"` — and `compile.ts`
 * belongs to a later step that this one may not edit. Adding the union member
 * here would hand every step after this one a red build to fix.
 *
 * So {@link Transition.exit} is typed and read as a `duration` value on its own,
 * and the moment `compile.ts`'s owner adds that one entry this union grows and
 * the special case in the document reader goes away.
 */
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

/* ------------------------------------------------------------------ */
/* Inputs: what a host hands a machine                                 */
/* ------------------------------------------------------------------ */

/**
 * The three kinds of thing a host can hand a machine.
 *
 * Rive's three, and the same three for the same reason rather than out of
 * imitation: a boolean is a condition that persists ("is this row selected"), a
 * number is a quantity a guard can compare and a blend can interpolate along
 * ("how far is the drawer open"), and a trigger is a moment that does not
 * persist ("the save succeeded"). A fourth kind — a string, an enum — was
 * considered and rejected: an enum is a boolean per case with a rule saying one
 * holds, which is a thing a designer can already write, and a string input would
 * be a guard the static checks could say nothing about, because there is no
 * range for a string to fall outside of.
 */
export type InputKind = "boolean" | "number" | "trigger";

export interface InputKindSpec {
	label: string;
	/**
	 * Whether a value persists between triggers.
	 *
	 * False for exactly one kind, and it is the kind whose whole meaning is the
	 * falseness: a trigger is consumed the instant a transition takes it, so
	 * "fired" is true for one evaluation and false afterwards. A runtime that
	 * kept it true would fire every guarded edge on the next unrelated event,
	 * which reads to a person as a machine that has gone off on its own.
	 */
	holds: boolean;
	/** What an input of this kind starts at when the document says nothing. */
	fallback: string;
}

export const INPUT_KINDS: Record<InputKind, InputKindSpec> = {
	boolean: { label: "Boolean", holds: true, fallback: "false" },
	number: { label: "Number", holds: true, fallback: "0" },
	trigger: { label: "Trigger", holds: false, fallback: "" },
};

export const INPUT_KIND_NAMES = Object.keys(INPUT_KINDS) as InputKind[];

/**
 * One input of one machine.
 *
 * **An input is a runtime value, and it is emphatically not a design-space
 * one.** A `duration` on a transition *is* a design-space value: it may name a
 * token, the token may hold two alternatives, and the two really are two
 * designs, because the milliseconds show up in the exported file and a reader
 * can tell them apart. An input has no such shadow. Nothing in the picture, in
 * the base layer of the export, or in any projected atom moves when an input
 * moves — so a document that held two starting values for a boolean would hold
 * two universes identical in every projected atom, which is exactly the collapse
 * `#project` exists to prevent, and here the honest answer is not to add a
 * projection but to notice there is nothing to project.
 *
 * Which is why **every field here is a plain string, never a {@link Value}**. A
 * `Value` would let a range name a token, and a range decides nothing anybody
 * can see: it decides which guards the checks call impossible, and a document
 * that held two opinions about that would be a document that could not say
 * whether its own machine was broken. A budget is the thing alternatives are
 * judged against, which is the argument `machinecheck.ts` already makes about
 * the duration budget, one rung further out.
 */
export interface MachineInput {
	/** Unique among the inputs of *its own machine*; a bare ASP constant. */
	id: string;
	/** What it is called. Free-form. */
	name: string;
	kind: InputKind;
	/**
	 * What it holds before anybody drives it.
	 *
	 * `"true"` / `"false"` for a boolean, read through `wordOf`; a numeral for a
	 * number, read through `permilleOf`. Absent, unreadable, or set on a trigger
	 * takes {@link INPUT_KINDS}' own fallback — a trigger has no resting value to
	 * start at, because "not fired" is not a value, it is the absence of one.
	 */
	initial?: string;
	/**
	 * The closed ends of a number input's range, inclusive. Numerals, read
	 * through `permilleOf`.
	 *
	 * **Absent is open, not zero.** An input with no `min` accepts anything, and
	 * the checks that read a range simply say nothing about it. That is the
	 * honest reading: a designer who has not said how far the drawer opens has
	 * not said that it does not open at all, and a check that invented `0` would
	 * report violations against a claim nobody made.
	 *
	 * Ignored on a boolean and on a trigger, where the range is the kind.
	 */
	min?: string;
	max?: string;
}

/* ------------------------------------------------------------------ */
/* Conditions: what has to hold as well as the trigger                 */
/* ------------------------------------------------------------------ */

/**
 * How a condition compares.
 *
 * Six words and a seventh that takes no comparand, and the split is by what they
 * can be asked of. `eq` and `ne` suit every kind; the four orderings suit a
 * number and nothing else; `fired` suits a trigger and nothing else and takes no
 * comparand, because "the trigger happened" is the whole of what there is to say
 * about a moment.
 *
 * Spelled as constants rather than as `"="`, `"!="`, `">"` — they reach the
 * program as themselves, inside `mcondop/4`, and `>` is not a term.
 */
export type CompareOp = "eq" | "ne" | "gt" | "lt" | "ge" | "le" | "fired";

export interface CompareOpSpec {
	label: string;
	/** Which input kinds this op may be asked of. */
	kinds: readonly InputKind[];
	/** Whether it takes a comparand at all. */
	comparand: boolean;
}

export const COMPARE_OPS: Record<CompareOp, CompareOpSpec> = {
	eq: { label: "is", kinds: ["boolean", "number"], comparand: true },
	ne: { label: "is not", kinds: ["boolean", "number"], comparand: true },
	gt: { label: "is more than", kinds: ["number"], comparand: true },
	lt: { label: "is less than", kinds: ["number"], comparand: true },
	ge: { label: "is at least", kinds: ["number"], comparand: true },
	le: { label: "is at most", kinds: ["number"], comparand: true },
	fired: { label: "fired", kinds: ["trigger"], comparand: false },
};

export const COMPARE_OP_NAMES = Object.keys(COMPARE_OPS) as CompareOp[];

/**
 * One conjunct of one transition's guard.
 *
 * A transition fires when its trigger happens **and** every one of its
 * conditions holds. The conjunction is total and there is no `or`: two guards
 * that should be alternatives are two transitions, which is what Rive does, and
 * which here has a second payoff — two transitions are two rows with two ids, so
 * a violation can name the one that is impossible instead of pointing at half of
 * a boolean expression.
 *
 * A plain string comparand, never a {@link Value}, for {@link MachineInput}'s
 * reason exactly: a guard decides nothing an onlooker can see, so a comparand
 * with two alternatives would be two universes identical in every projected
 * atom. It would also make "this guard can never be satisfied" undecidable in
 * the only way that matters — it would become "this guard can never be satisfied
 * in three of the four universes", which is a sentence with nowhere to be said.
 */
export interface Condition {
	/** An input id of the same machine. */
	input: string;
	op: CompareOp;
	/**
	 * What the input is compared against: `"true"`/`"false"` for a boolean, a
	 * numeral for a number. Absent for `fired`, and ignored where the op takes
	 * none.
	 */
	value?: string;
}

/* ------------------------------------------------------------------ */
/* Layers: two states at once, composed rather than chosen             */
/* ------------------------------------------------------------------ */

/**
 * One layer of a machine: a name, and an order.
 *
 * Deliberately *not* a container of states. A layer holds no `states` array and
 * no `transitions` array, and each {@link MachineState} names its layer instead
 * — which is the opposite of how Rive's file format does it and is the right way
 * round here, for two reasons that both come from the shipped encoding.
 *
 * A state id is already unique per *machine*, and `stt(I,S,N)` names a state
 * with no layer in the term. Nesting the states under layers would either
 * re-scope every id — changing the arity of `mstate/2`, `mindex/3`, `mcopy/3`
 * and the shape of every state copy term a designer has already typed into a
 * rule — or leave the ids machine-scoped anyway and make the nesting a second,
 * redundant statement of where a state lives. And {@link Machine.states} in
 * document order is what the state strip renders and what `mindex/3` numbers; a
 * machine whose states lived in two arrays would need a third thing to say what
 * order they are in.
 *
 * So a layer is an id and a name, and its **position in the list is its
 * priority** — the same "the order *is* the answer" the initial state and
 * `order/2` already use, one axis over. Later layers win.
 */
export interface MachineLayer {
	/** Unique among the layers of its own machine; a bare ASP constant. */
	id: string;
	name: string;
}

/* ------------------------------------------------------------------ */
/* Timelines: keyframes, and never frames                              */
/* ------------------------------------------------------------------ */

/*
 * **The solver decides keyframes. It never decides frames.**
 *
 * Grounding scales with the number of keyframes a document holds and with
 * nothing else. There is no frame rate in this file, in the generated program,
 * in the model, or in the export. A timeline with nine keyframes costs the same
 * whether it plays over 100ms or ten seconds, and whether the browser draws it
 * at 60Hz or 120.
 *
 * What that buys: every keyframe's *time* and *value* are ordinary
 * {@link Value}s, so they may name a token, follow a motion scale, and hold
 * alternatives — and two alternatives inside a keyframe really are two designs,
 * for the same reason a delta's two fills are. What it costs: everything
 * *between* two keyframes is interpolated rather than solved, by the browser's
 * compositor in the export and by lerping two copies the answer set already
 * holds on the canvas. Neither costs a solve.
 */

/**
 * One moment on one track: when, and what.
 *
 * `at` is a `duration` {@link Value} rather than a number for the reason a
 * transition's duration is one: a keyframe wants to name the same motion scale
 * everything else does, and "the overshoot happens at `--beat`" is a sentence a
 * document should be able to hold both ends of.
 */
export interface Keyframe {
	/** When, from the start of the timeline. A `duration` Value. */
	at: Value;
	/** What the track's property, dimension or rotation is at that moment. */
	value: Value;
	/**
	 * How the segment *leaving* this keyframe is paced. The last keyframe's
	 * easing is read by nothing, and is kept rather than refused, because a
	 * keyframe that stops being last should not lose what somebody typed.
	 */
	easing?: Easing;
}

/**
 * One property of one part, over time.
 *
 * A track names **exactly one** of {@link prop}, {@link dim} and {@link turn} —
 * a track that named two would be two tracks sharing a keyframe list, and the
 * moment somebody moved a keyframe on one of them it would be two tracks anyway.
 * A track that names none is read as no track at all.
 *
 * Per part *and* per property rather than per part, because that is the grain a
 * designer edits at and the grain a conflict happens at: two layers fighting
 * over `opacity` of `panel` is a sentence about one property, and a per-part
 * track would make it a sentence about six.
 */
export interface Track {
	/** The definition part this animates. */
	part: string;
	prop?: PropName;
	/**
	 * One of the **six** axes, not four. A line that let a *state* lift a mesh in
	 * z while forbidding a *timeline* from doing it would be an arbitrary line
	 * through one feature, and the keyframe copy's frame rules leave the
	 * dimension unbound and need no edit to carry the extra two.
	 */
	dim?: Axis3;
	/**
	 * A rotation, for the same reason {@link dim} spans six: a state may turn a
	 * part, so a timeline may too. The rules for it are written in the shape of
	 * the dimension pair.
	 */
	turn?: Turn;
	/** In time order. The reader sorts; two keys at one time keep the first. */
	keys: Keyframe[];
}

export type LoopMode = "none" | "loop" | "pingPong";

export interface Timeline {
	/** Unique in its machine; a bare ASP constant. */
	id: string;
	name: string;
	tracks: Track[];
	/**
	 * How long it is, as a `duration` Value. Absent is **the last keyframe's
	 * time**, derived rather than stored, so a timeline cannot disagree with its
	 * own contents. Present and shorter than the last keyframe is legal and is
	 * what it says: the tail is not played.
	 */
	length?: Value;
	loop?: LoopMode;
}

/**
 * `oneD` and not `"1d"`, and the spelling is not cosmetic: a blend kind reaches
 * the program as itself, inside `mblend/3`, and `1d` is not an ASP constant — a
 * constant may not begin with a digit. The same rule that makes `spaceBetween` a
 * word rather than `space-between`.
 */
export type BlendKind = "oneD" | "direct";

export const BLEND_KINDS: Record<BlendKind, { label: string }> = {
	oneD: { label: "1D" },
	direct: { label: "Direct" },
};

export const BLEND_KIND_NAMES = Object.keys(BLEND_KINDS) as BlendKind[];

export interface BlendStop {
	/** The timeline this stop plays. */
	timeline: string;
	/** 1D only: where on the blend input's axis this stop sits. A numeral. */
	at?: string;
	/** Direct only: the number input that is this stop's weight. */
	by?: string;
}

/**
 * Several timelines, mixed by a number input.
 *
 * The mixing is arithmetic over a runtime value, so **none of it is solved**,
 * and none of it can be: the input is not in the program. What *is* solved is
 * everything the stops are made of — every keyframe of every timeline a stop
 * names, with its time and its value — and everything the checks need: the
 * thresholds, in thousandths, against the input's declared range.
 */
export interface Blend {
	kind: BlendKind;
	/** 1D only: the number input the stops are laid out along. */
	input?: string;
	stops: BlendStop[];
}

/* ------------------------------------------------------------------ */
/* Entry, Exit and Any: three reserved ids, and not three states       */
/* ------------------------------------------------------------------ */

/**
 * State ids a machine may not use, legal only as a {@link Transition.from} or
 * {@link Transition.to}.
 *
 * They are deliberately not entries in {@link Machine.states}, and the argument
 * is the one that keeps `stt/3` from being a `node/1`. A {@link MachineState} is
 * *a delta over the definition's parts*; Entry, Exit and Any have no appearance
 * and never will. As states they would be three empty deltas per machine, three
 * copies per instance per part, three rows in every state strip, three terms a
 * rule could name that would say nothing — and `shownState` could return one of
 * them, which would mean "draw this button in Exit", which is not a picture.
 * Every one of those costs is paid to express three words that are perfectly
 * well expressed as three constants.
 *
 * A {@link Trigger} of `load` is already Entry: it fires once, when the runtime
 * starts, and the runtime's `settle()` already follows a chain of them. So
 * `entry` is sugar over the initial state rather than a fourth node, and it is
 * spelled as a rule in the program so that a hand-written `mfrom(M,t,entry)`
 * gets the same treatment a document one does.
 */
export const RESERVED_STATES: ReadonlySet<string> = new Set([
	"entry",
	"exit",
	"any",
]);

/** True when a state id is one of the three the program reads as a word. */
export const isReservedState = (id: string): boolean => RESERVED_STATES.has(id);

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
	 *
	 * Over all six axes, not four. A state that lifts a mesh is the same kind of
	 * claim as one that moves a button two pixels down, and the delta is sparse
	 * already — a dimension a state says nothing about is the instance's own — so
	 * widening the key costs a document that has never heard of a third axis
	 * nothing at all. What it does *not* do is widen the state copy's own default
	 * rules in the program: those stay narrowed to the copies that are in the
	 * third axis, or a viewport on page four would put every state of every
	 * button on page one into three dimensions.
	 */
	frame?: Partial<Record<Axis3, Value>>;
	/**
	 * How this state turns the part, per axis — see {@link TURNS}.
	 *
	 * Absent-is-inherit like every other field here: a rotation the state says
	 * nothing about is the instance's own, shared with every other state. Minting
	 * a copy of a two-alternative angle per state would be 2^N designs where the
	 * document holds two, which is the invariant this whole interface exists to
	 * keep.
	 */
	turn?: Partial<Record<Turn, Value>>;
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
 *
 * {@link StatePart.turn} is read here too, and it has to be: a state whose only
 * delta is a rotation materialises no copy without this line, so the mesh it
 * meant to turn is never minted, `turn(stt(I,S,N),R,V)` has nothing to be about,
 * and a hover that spins a card does nothing at all in a document that solves
 * cleanly and reports nothing.
 */
export const stateTouches = (part: StatePart): boolean =>
	part.hidden === true ||
	Object.values(part.props ?? {}).some((v) => (v?.length ?? 0) > 0) ||
	Object.values(part.frame ?? {}).some((v) => (v?.length ?? 0) > 0) ||
	Object.values(part.turn ?? {}).some((v) => (v?.length ?? 0) > 0);

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
	/**
	 * Which layer this state belongs to. Absent, or naming a layer the machine
	 * has not got, is the **first** layer.
	 *
	 * Absent-is-first rather than absent-is-invalid, for {@link SceneNode.state}'s
	 * reason: a machine edited down must leave its states legal, and a document
	 * written before layers existed must mean exactly what it meant.
	 */
	layer?: string;
	/**
	 * A timeline this state plays, by id.
	 *
	 * A state that plays a timeline still has its {@link parts} delta, and the
	 * two compose the way everything else here composes: the timeline decides
	 * what it has a track for, and the delta decides the rest. The state's
	 * **settled pose** — what `stt(I,S,N)` is, what the canvas draws, what a
	 * cross-state constraint compares — is the timeline's value at its own
	 * length, which is to say the last keyframe of each track. That is derived,
	 * not typed: a document that stored the end pose twice would be a document
	 * where moving the last keyframe left the picture behind.
	 */
	timeline?: string;
	/**
	 * A blend state — several timelines mixed by a number input.
	 *
	 * Wins over {@link timeline} where a document somehow holds both, and the
	 * pair is *reported* rather than repaired, because a state with two sources
	 * is a mistake a person should see rather than one a reader should quietly
	 * pick a side in.
	 */
	blend?: Blend;
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
	/**
	 * Everything that must hold, as well as the trigger, for this edge to be
	 * taken — see {@link Condition}.
	 *
	 * Absent or empty is an unguarded edge, which is every edge in every document
	 * written before guards existed, and which must stay exactly as fast and
	 * exactly as legal as it is today.
	 *
	 * A conjunction, in document order. The order decides nothing: the program
	 * tests all of them at grounding and the runtime tests all of them at the
	 * event, and neither short-circuits in a way an onlooker could detect. It is
	 * kept because a person put them in that order and a list that reordered
	 * itself would be a list nobody could edit.
	 */
	conditions?: Condition[];
	/**
	 * How long this transition's `from` state must have been held before this
	 * edge may be taken, as a `duration` {@link Value} — Rive's exit time.
	 *
	 * A {@link Value} and not a plain string, unlike a condition's comparand, and
	 * the difference is the point rather than an inconsistency: an exit time is
	 * *pacing*. It belongs to the same family as `duration`, `delay` and
	 * `stagger`, it wants to name the same `duration` token they do, and a motion
	 * scale that made every transition brisk and left one debounce at 400ms would
	 * be a motion scale with a hole in it. See {@link MotionProp} for why it is
	 * not yet a member of that table, and what the one-line unblock is.
	 *
	 * **We have no untriggered transitions and this does not add any**, so it
	 * means precisely: a trigger arriving before the `from` state has been held
	 * this long does not move the machine, and is not remembered. That is a
	 * debounce, and it is a deliberate, stated departure from Rive — Rive would
	 * fire the transition when the time elapsed if the condition still held. The
	 * reason is `runtime.ts`'s own: a deferred fire is a state change nobody's
	 * finger caused, arriving at a moment nothing on the page marks, and a
	 * runtime with a queue in it is a second animator arguing with the
	 * compositor. A designer who wants "and then it moves on by itself" writes a
	 * `load`-triggered edge out of the destination state, which `settle()`
	 * already follows.
	 */
	exit?: Value;
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
	/**
	 * What a host can hand this machine — see {@link MachineInput}.
	 *
	 * Absent is a machine nobody drives from outside, which is every machine any
	 * document currently holds, and the absence has to keep meaning that: a
	 * reader that filled this in with an empty array would still be right, but a
	 * reader that filled it in with a default input would change what the
	 * existing documents mean.
	 */
	inputs?: MachineInput[];
	/**
	 * The machine's layers, in order. **Later layers win.**
	 *
	 * Absent or empty is a one-layer machine, which is every machine in every
	 * document today. The reader mints nothing for it: a machine with no `layers`
	 * emits one `mlayer(M,base)` and every state belongs to it.
	 *
	 * Copies **compose** where a choice rule would **multiply**, and this rung is
	 * where the shipped encoding pays for itself. Had a state been a choice rule,
	 * two layers would have been two choice rules, a four-state layer beside a
	 * three-state layer would have been twelve universes nobody was choosing
	 * between eleven of, and the question a person actually asks about layers —
	 * "does the glow still line up when the button is also pressed?" — would have
	 * been unaskable, because the two layers' states would be in different answer
	 * sets. Under copies, two layers are two `shown/2` facts in one answer set
	 * and the composite is a rule.
	 */
	layers?: MachineLayer[];
	/**
	 * Timelines, shared by the states that play them — see {@link Timeline}.
	 *
	 * On the machine rather than on the state, because two states routinely play
	 * one animation (a `loop` and a `pressed` both playing `idle`) and because a
	 * blend state plays several. A timeline nothing plays is legal, costs a
	 * handful of variables and no copies, and is how somebody works on one before
	 * wiring it up.
	 */
	timelines?: Timeline[];
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
	/**
	 * Metadata for every asset the document's models reference, by hash — see
	 * {@link AssetInfo}.
	 *
	 * Beside the tokens and the machines rather than among the nodes: an asset is
	 * shared, has its own identity and lifecycle, and two models may reference
	 * one. A hash this index does not know is a **missing asset**, which is a
	 * thing the studio reports and the export names in `lost` — never a thing
	 * that fails a solve, and never a reason to drop the node that points at it.
	 * "Relink this" and "your chair is gone" are two different sentences and only
	 * the first one is true.
	 *
	 * Absent rather than `{}` on a document with no models, so that "this
	 * document holds no imported geometry" has one spelling — the same rule
	 * {@link SceneNode.lines} keeps about an empty list.
	 */
	assets?: Record<string, AssetInfo>;
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
