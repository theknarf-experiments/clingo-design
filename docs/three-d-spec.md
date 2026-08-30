# 3D objects as ordinary scene nodes

> **AMENDED — read `docs/merged-plan.md` first.** This document was written in
> parallel with `docs/rive-ladder-spec.md` by an agent who could not see it, and
> the two claim nine of the same files. `docs/merged-plan.md` is the reconciled
> plan and **it outranks this document** wherever the two differ: the file
> ownership table in §13 below is superseded by its §3.3, and eight paragraphs
> here are wrong and are marked `**AMENDED**` in place. Everything not so marked
> still stands.
>
> The corrections, in one list, so a reader can find them:
> §1.4 / §6.5 (`mdeg/2` is the *sixth* literal bridge, not the fifth),
> §2.2 (`Solid` is renamed `SpatialFrame`), §3.2 (the narrowing is incomplete
> and leaves the linear objective **unbounded** — this is the serious one),
> §3.4 (a third `gnoedge` rule is required), §5 (`s3/1` does not reach an
> instance's parts), §7.4 (`ModelNode.solid` is renamed `.spatial`),
> §12.2 (`mlfshadow` must iterate the widened list too), §12.3 (`mbase_turn/4`
> belongs in `COMPONENT_RULES`, not `MACHINE_RULES`), and §13 (ownership).

**Status: frozen.** Twelve implementation steps code against this document
without talking to each other. Every type, every predicate, every prop, every
package boundary and every file below is the contract. Where an implementation
step finds this document wrong, it implements the nearest correct thing *and
says so in its return value* — it does not quietly redesign an interface another
step is coding against.

It extends the state-machine work (`docs/state-machines-spec.md`, shipped in
35e8d94 and 05119e6) rather than replacing any of it, and §12 is written for
track B specifically: what a machine state may do to a 3D node.

---

## 0. The direction, and the four things it decides

> **A mesh, a camera and a light are `node/1` with a `kind/2`, a `child/2`, an
> `order/2`, a `visible/1` and a `frame/3`, stated in the generated program like
> every other node.** They appear in the layer list, they are selectable, a
> geometric constraint can name them, they can be hidden, they can carry a
> machine state, and they take part in the multiverse. There is no parallel 3D
> document model living beside the scene.

This is settled, and everything below is a consequence of it rather than a
re-decision. It is worth writing out what it buys, because each item is a
feature somebody would otherwise have to build twice:

- **The layer list, hit testing in the tree, grouping, deletion, undo, Automerge
  sync, the multiverse, pinning, the unsat core and `why`** all work on a mesh
  the day the kind is added, because none of them asks what a node *is* — they
  ask `KINDS[node.kind]` and the tables answer. A parallel model would need its
  own answer to all nine.
- **A token drives a material.** A mesh's colour is `prop(N,fill)` and a `color`
  token with two alternatives is two designs of the 3D scene, in the same
  multiverse as the two designs of the page it sits on. That is not something a
  bolted-on three.js scene could ever have.
- **A rule can name a mesh.** `align [card, hero_cube] on centerY` is an
  ordinary `align`. §4 is entirely about which of those rules stay honest.

And the one thing it costs, stated up front so nobody is surprised by §4: the
solver is linear, so it can place a rotated object but it cannot *measure* one.

### The seam

A 3D subtree hangs inside a **`viewport`** — a 2D rectangle on the artboard that
contains a 3D scene and names the camera that looks at it. Everything above the
viewport (artboards, layout, guides, the grid, the exporter's HTML path, the 2D
pointer) is exactly the tool it is today, because a viewport is a rectangle with
a fill and a radius and nothing above it has to look inside. Everything below it
is three-dimensional.

The seam is one kind and one boolean (`KindSpec.opaque`). It is what makes the
answer to "does the HTML export draw this?" a lookup rather than a judgement
call, and it is why §10 can give CSS 3D transforms a real job without that job
leaking into the scene graph.

### Acceptance test for this section (step 1 owns it)

For every template in `templates.test.ts`: the universe count, the `readModel`
output and the exported bytes of a document with no viewport in it are
**identical** before and after this track. Asserted over atoms and over export
text, not over generated program text — see §3.7 for why that distinction is
deliberate here where the machine spec asserted byte-identity of the program.

---

## 1. Kinds and props

### 1.1 `NodeKind` — six new entries

```ts
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
	| "viewport"
	| "pivot"
	| "mesh"
	| "model"
	| "camera"
	| "light";
```

`KindSpec` gains two required columns. Required rather than optional for the
reason `styleable` and `inherited` are: the answer is a fact about the kind and
belongs beside it, and a list somewhere else quietly falls behind.

```ts
export interface KindSpec {
	// … existing columns unchanged …
	/**
	 * This kind lives in three dimensions: it reads {@link SceneNode.spatial}
	 * and {@link SceneNode.turn}, it is drawn by the 3D renderer rather than by
	 * the DOM, and the HTML export cannot carry it.
	 *
	 * Not the same question as being *inside* a viewport, and the difference is
	 * load-bearing. A `rect` with a `z` and a `rotateZ` is a flat box that CSS
	 * can draw exactly (see §10.4); a `mesh` is geometry CSS has no word for.
	 * `spatial` is the second of those, and it is what the exporter branches on.
	 */
	spatial: boolean;
	/**
	 * The pointer stops here: what is inside is picked by something else.
	 *
	 * True only for `viewport`. A mesh's silhouette on screen is a projection of
	 * its geometry through a camera, and the document's own hit testing knows
	 * about axis-aligned rectangles in EMU — so `hitTestTree` descending into a
	 * viewport would answer with a frame that has nothing to do with the pixels
	 * anybody clicked. It stops at the box instead, and the raycaster inside the
	 * viewport answers the question it is actually equipped for. See §9.
	 */
	opaque: boolean;
}
```

Every existing entry gains `spatial: false, opaque: false`. The six new ones:

| kind | label | drawable | tool | container | surface | wrapsChildren | shape | diagonal | measured | plotted | spatial | opaque |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `viewport` | 3D view | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** |
| `pivot` | Pivot | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| `mesh` | Solid | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| `model` | Model | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| `camera` | Camera | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| `light` | Light | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |

Notes each of which is a decision, not a default:

- **`viewport` is not a `surface`.** A surface clips, bounds snapping, and takes
  new nodes drawn over it. The first two are right and the third is not: dragging
  a rectangle over a 3D view means "a rectangle on top of the view", never "a
  rectangle inside the scene". `opaque` gives the clipping and the pointer
  behaviour without the drop behaviour.
- **`viewport` is `tool: true`** and `shape: false`, so it gets its own toolbar
  slot beside `frame` rather than hiding behind the shape menu. A 3D view is not
  a shape.
- **Nothing 3D is `tool: true`.** You cannot drag a box out in three dimensions
  with a two-dimensional pointer and mean anything by it. A mesh, a camera and a
  light are added by an edit (§7.3) from the viewport's own menu, exactly as a
  group comes from a selection and an instance from a definition.
- **`pivot` rather than reusing `group`.** A group is `wrapsChildren: true`: it
  refits to its children's 2D bounding box and dissolves when ungrouped. Inside a
  viewport that refitting is meaningless — a bounding box of rotated solids is
  the very trigonometry §4 is about — so a 3D grouping node is a *transform node*
  with a place and a rotation of its own and no size at all. Naming it `pivot`
  says which of the two it is.
- **`model` rather than a flag on `mesh`.** The precedent is exact: `rect` is
  parametric and `path` is `plotted: true` with its vertices on the node. A
  `mesh` is one of six primitives named by a `Value`; a `model` is imported
  geometry whose payload is a field on the node. Two kinds, for the same reason
  there are two kinds today. See §5.

### 1.2 `PropName` — seven new entries

```ts
export type PropName =
	| "text" | "fill" | "radius" | "stroke" | "strokeWidth" | "shadow"
	| "opacity" | "ink" | "fontFamily" | "size" | "weight" | "lineHeight"
	| "align"
	| "solid"        // <- new, from here down
	| "roughness"
	| "metalness"
	| "lamp"
	| "intensity"
	| "fov"
	| "near"
	| "far"
	| "perspective";
```

Eight, counting `perspective`, which belongs to the CSS-3D half (§10.4) rather
than to the scene.

```ts
	/**
	 * Which primitive a `mesh` is.
	 *
	 * A closed menu and therefore a {@link Value} like a `direction` is, which is
	 * the whole reason it is a property rather than a field: `[box, sphere]` is a
	 * real design question with two answers, and a `solid` token pointed at by
	 * six meshes is a family that changes shape together. A field would have made
	 * that a second kind of variation with its own editor.
	 */
	solid: { label: "Solid", type: "solid", fallback: "box", styleable: false, inherited: false },
	/**
	 * How rough the surface is: 0 is a mirror, 1 is chalk.
	 *
	 * A `number`, not a new quantity, and for the reason `lineHeight` is one: it
	 * is a bare proportion compared and interpolated as itself, and `numeralOf`
	 * already reads exactly that. Clamped to [0,1] where it is read, not here —
	 * the reader is `roughnessOf` in `spatial.ts` and the clamp is stated once.
	 */
	roughness: { label: "Roughness", type: "number", fallback: "0.6", styleable: true, inherited: false },
	metalness: { label: "Metalness", type: "number", fallback: "0", styleable: true, inherited: false },
	/**
	 * Which kind of lamp a `light` is.
	 *
	 * Same argument as {@link solid}: "key light or ambient" is a design
	 * decision, so it is a value with a menu behind it.
	 */
	lamp: { label: "Lamp", type: "lamp", fallback: "directional", styleable: false, inherited: false },
	/**
	 * How bright a light is. Unbounded above; negative is clamped to zero where
	 * it is read, exactly as a negative gap is.
	 */
	intensity: { label: "Intensity", type: "number", fallback: "1", styleable: true, inherited: false },
	/**
	 * A camera's vertical field of view.
	 *
	 * The one property of the {@link angle} type, and it is here rather than as a
	 * plain number so that a document can hold "wide and long" as two
	 * alternatives of one `angle` token and get two designs of the same scene —
	 * which is the whole grid argument, applied to a lens.
	 */
	fov: { label: "Field of view", type: "angle", fallback: "50deg", styleable: false, inherited: false },
	/**
	 * The near and far clip planes, as ordinary lengths in EMU.
	 *
	 * Lengths rather than bare numbers because they *are* lengths in the world
	 * the scene is measured in, which means a `length` token drives them and the
	 * unit machinery reads them with no new reader. See §6 for what the renderer
	 * does with them and for the one clamp it applies.
	 */
	near: { label: "Near", type: "length", fallback: pxLength(1), styleable: false, inherited: false },
	far: { label: "Far", type: "length", fallback: pxLength(20000), styleable: false, inherited: false },
	/**
	 * How far the eye is from a CSS 3D scene — the `perspective` declaration, and
	 * nothing to do with a `camera` node.
	 *
	 * Offered on `frame` only. It is the one number CSS needs before a `rotateY`
	 * on a child means anything, and it is a length like every other, so a
	 * document may hold two of them. See §10.4, which is the only reader.
	 */
	perspective: { label: "Perspective", type: "length", fallback: pxLength(1200), styleable: false, inherited: false },
```

**Colour is reused, not re-invented.** A mesh's base colour is `fill` and a
light's colour is `ink`. That is deliberate and it is what makes a brand palette
light a 3D scene without anybody wiring anything: the same `color` token, the
same variable shape, the same `differ`/`match` constraints. `ink` is labelled
"Colour" and already means "the colour the thing itself is" rather than "the
colour of the surface behind it", which is exactly what a light's colour is.
`PropSpec.inherited` on `ink` is a claim about the CSS it becomes, and a light
never becomes CSS, so nothing about `DOCUMENT_BASE` changes.

### 1.3 Per-kind property lists

```ts
	viewport: {
		props: ["fill", "radius", "stroke", "strokeWidth", "opacity"],
		defaults: { fill: [lit("#0b1020")] },
		defaultSize: { width: fromPx(480), height: fromPx(320) },
	},
	pivot:  { props: [], defaults: {}, defaultSize: { width: fromPx(0), height: fromPx(0) } },
	mesh:   {
		props: ["solid", "fill", "roughness", "metalness", "opacity"],
		defaults: { solid: [lit("box")], fill: [lit(PROPS.fill.fallback)], roughness: [lit("0.6")] },
		defaultSize: { width: fromPx(100), height: fromPx(100) },
	},
	model:  {
		props: ["fill", "roughness", "metalness", "opacity"],
		defaults: {},
		defaultSize: { width: fromPx(100), height: fromPx(100) },
	},
	camera: { props: ["fov", "near", "far"], defaults: {}, defaultSize: { width: fromPx(0), height: fromPx(0) } },
	light:  {
		props: ["lamp", "ink", "intensity"],
		defaults: { lamp: [lit("directional")], ink: [lit("#ffffff")], intensity: [lit("1")] },
		defaultSize: { width: fromPx(0), height: fromPx(0) },
	},
```

`frame`'s list gains `"perspective"` at the end. Nothing else changes.

A `model` states no `fill` default on purpose: an imported material is the
file's, and a fill the document did not ask for would silently repaint every
imported asset the moment it landed. Stated, it overrides — which is the
affordance a designer wants and the default nobody wants.

### 1.4 New `ValueType`s

```ts
export type ValueType =
	| "color" | "length" | "number" | "count" | "duration"
	| "angle"       // <- new
	| "weight" | "font" | "align" | "shadow" | "text"
	| "direction" | "placement" | "justify" | "sizing" | "growth"
	| "solid"       // <- new
	| "lamp";       // <- new

export type Quantity = "length" | "ratio" | "count" | "time" | "angle";
```

```ts
	/**
	 * A rotation, and the fifth quantity.
	 *
	 * It earns a quantity of its own by the same test `time` passed: there is one
	 * reader, {@link mdegOf}, and it accepts text no other reader accepts and
	 * refuses text they all take. `"45deg"` is an angle and nothing else; `"45"`
	 * is forty-five columns and no angle at all. Filing it under `ratio` would
	 * make a bare `45` mean a rotation on a node and a line height on a text,
	 * decided by which caller happened to ask.
	 */
	angle: { label: "Angle", fallback: "0deg", quantity: "angle" },
	solid: {
		label: "Solid",
		fallback: "box",
		options: [
			{ value: "box", label: "Box" },
			{ value: "sphere", label: "Sphere" },
			{ value: "cylinder", label: "Cylinder" },
			{ value: "cone", label: "Cone" },
			{ value: "plane", label: "Plane" },
			{ value: "torus", label: "Torus" },
		],
	},
	lamp: {
		label: "Lamp",
		fallback: "directional",
		options: [
			{ value: "ambient", label: "Ambient" },
			{ value: "directional", label: "Directional" },
			{ value: "point", label: "Point" },
			{ value: "spot", label: "Spot" },
		],
	},
```

The option `value`s are ASP constants and reach the program as themselves, the
way `spaceBetween` and `easeOut` do.

---

## 2. The third axis

### 2.1 The decision

**`Dimension` and `FrameValue` are not widened. A parallel two-row table is
added beside them, and `frame/3` carries all six.**

The alternative — six required keys on `FrameValue` — was worked through and
rejected, and the reasons are worth recording because they are the reasons the
whole no-regression promise holds:

- `FrameValue` is `Record<Dimension, Value>`, *required*. Widening it makes
  every `makeFrame`, every template, every test fixture and every stored document
  invalid until it grows two more keys. That is not a migration, it is a rewrite.
- `makeFrame` would then write two more `Value`s per node, so every rectangle in
  every document would gain two `frame/3` facts and two more chances to vary.
  Multiplicity is something a designer asks for.
- `SCENE_DEFAULT_RULES` default off `gaxis/1` and `gspan/1`, so widening those
  tables gives every node in every document a `frame(N,z,0)` whether or not the
  document has ever heard of the third axis.

So:

```ts
/** The two numbers that put a node in the third dimension. */
export type Spatial = "z" | "depth";

/** Any of the six — the vocabulary a rule and the solver share. */
export type Axis3 = Dimension | Spatial;

export const SPATIAL_DIMS: Record<Spatial, DimensionSpec> = {
	z: { label: "z", type: "length", fallback: pxLength(0), role: "pos" },
	depth: { label: "depth", type: "length", fallback: pxLength(0), role: "span" },
};

export const SPATIALS = Object.keys(SPATIAL_DIMS) as Spatial[];

/** The six, planar first, so a loop over them is a loop in reading order. */
export const DIMENSIONS_3D: Axis3[] = [...DIMENSIONS, ...SPATIALS];

/** What a node holds about the third axis. Sparse: absent is z 0, depth 0. */
export type SpatialValue = Partial<Record<Spatial, Value>>;
```

`DimensionSpec` is reused unchanged: `z` is a `pos` and `depth` is a `span`,
which is all the geometry rules ever ask.

### 2.2 What it does to each thing the brief names

| | change |
| --- | --- |
| `Dimension` | **unchanged** — four |
| `FRAME_DIMS` | **unchanged** — four rows |
| `DIMENSIONS` | **unchanged** — four |
| `FrameValue` | **unchanged** — four required keys |
| `makeFrame` | **unchanged** — writes four |
| `frameOf` / `frameDim` | **unchanged** — read four |
| `withFrame` / `frameFrozen` | **unchanged** — the third axis has its own pair, §2.3 |
| `Frame` (geometry.ts) | **unchanged** — four numbers, and every gesture, snap, marquee and hit test stays two-dimensional |
| `EDGES` | **five new rows**, §2.4 |
| `Edge` axis type | `"x" \| "y"` widens to `"x" \| "y" \| "z"` |
| `edgeOn` | signature widens to take `"z"`; body unchanged |
| `PLACES` / `SPANS` / `AXES` | widen automatically — they are filters over `EDGE_NAMES` |
| `CONSTRAINT_KINDS[k].edges` | widen automatically, and are then narrowed *per document* by `edgeOptions`, §2.5 |

New, beside the four readers:

```ts
/** A sparse spatial record from plain numbers, for a gesture or a template. */
export function makeSpatial(solid: Partial<Solid>): SpatialValue;

/** What one spatial dimension comes to in EMU. Absent is 0, exactly as the program's default rule makes it. */
export function spatialDim(node: SceneNode, dim: Spatial, context?: ResolveContext): Emu;

/** Both, as the plain pair. The twin of {@link frameOf}. */
export function spatialOf(node: SceneNode, context?: ResolveContext): Solid;

/** A node with some of its third axis replaced by numbers. The twin of {@link withFrame}, same rules. */
export function withSpatial(node: SceneNode, patch: Partial<Solid>, context?: ResolveContext): SceneNode;

/** True when a drag cannot write this dimension. The twin of {@link frameFrozen}. */
export function spatialFrozen(node: SceneNode, dim: Spatial, context?: ResolveContext): boolean;
```

and in `geometry.ts`, types only — nothing in that file computes in three
dimensions, because nothing in that file is asked to:

> **AMENDED (merged-plan §2).** `Solid` is renamed **`SpatialFrame`**. The word
> `solid` is already spent three times over on *which primitive a mesh is* —
> `PropName "solid"`, `ValueType "solid"`, and the whole of `solid.ts` — and
> `ModelNode.solid?: Solid` would have read as "which primitive" while meaning
> "z and depth". `SpatialFrame` is to `Frame` what `SpatialValue` is to
> `FrameValue`, which is the parallel the name was fighting. Every signature
> below that says `Solid` or `Partial<Solid>` reads `SpatialFrame`.

```ts
/** The third axis of a box, in EMU. The twin of {@link Frame}. */
export interface SpatialFrame {
	z: number;
	depth: number;
}

/** A frame and its third axis. Six numbers, in EMU. */
export type Box = Frame & SpatialFrame;
```

`SceneNode` gains:

```ts
	/**
	 * Where the node sits on the third axis and how deep it is — see
	 * {@link SPATIAL_DIMS}.
	 *
	 * Optional and sparse, which is the whole design: a document with no 3D in it
	 * holds no `spatial` anywhere, states no `frame(N,z,_)`, grounds no third
	 * axis and costs exactly nothing. Absent is z 0 and depth 0, which is where a
	 * flat document already is.
	 *
	 * Read on every kind, not only the spatial ones. A `rect` with a `z` is a
	 * card lifted off the page, and the HTML export draws it with a real CSS
	 * `translate3d` — see §10.4. What decides whether a node is *geometry* is
	 * {@link KindSpec.spatial}; what this decides is only where the node is.
	 */
	spatial?: SpatialValue;
	/**
	 * How the node is turned, per axis, in degrees — see {@link TURNS}.
	 *
	 * Optional and sparse for the same reason {@link spatial} is. Read on every
	 * kind. **Rotation is about the node's own centre**, and that is not a
	 * convenience: it is what keeps `centerX`, `centerY` and `centerZ` linear
	 * quantities on a turned node, which is the difference between the solver
	 * being able to say something honest about a rotated object and being able to
	 * say nothing at all. See §4.
	 */
	turn?: TurnValue;
	/**
	 * On a `viewport`: the id of the `camera` node the view looks through.
	 *
	 * A dangling id derives nothing rather than failing, the way a dangling
	 * {@link instanceOf} does — the renderer then frames the subtree with a
	 * default camera and the status line says so. Naming a node that is not a
	 * camera, or a camera outside this viewport's subtree, is the same silence.
	 */
	camera?: string;
	/**
	 * On a `model`: the imported geometry — see §5.
	 *
	 * The vertices themselves are **not here**. This is the reference, the box
	 * they occupy and the counts; the payload lives in the asset store, keyed by
	 * {@link MeshRef.asset}.
	 */
	mesh?: MeshRef;
```

### 2.3 Rotation, as a document field

```ts
/** One of the three axes a node may be turned about. */
export type Turn = "rotateX" | "rotateY" | "rotateZ";

export interface TurnSpec {
	label: string;
	/** The axis it turns about, so a rule and the renderer read one table. */
	axis: "x" | "y" | "z";
	/** The CSS function, for the 3D-transform half of the export. */
	css: "rotateX" | "rotateY" | "rotateZ";
}

export const TURNS: Record<Turn, TurnSpec> = {
	rotateX: { label: "Turn about X", axis: "x", css: "rotateX" },
	rotateY: { label: "Turn about Y", axis: "y", css: "rotateY" },
	rotateZ: { label: "Turn about Z", axis: "z", css: "rotateZ" },
};

export const TURN_NAMES = Object.keys(TURNS) as Turn[];

export type TurnValue = Partial<Record<Turn, Value>>;

/** What one rotation comes to, in thousandths of a degree. Absent is 0. */
export function turnMdeg(node: SceneNode, turn: Turn, context?: ResolveContext): number;

/** All three. */
export function turnOf(node: SceneNode, context?: ResolveContext): Record<Turn, number>;

/** True when any of the three is non-zero in this universe — see §4. */
export function isTurned(node: SceneNode, context?: ResolveContext): boolean;
```

**Order of application is fixed and is not a document field: `rotateZ`, then
`rotateY`, then `rotateX`, applied about the node's own centre, then the
translation.** That is CSS's own order for `rotateX(..) rotateY(..) rotateZ(..)`
read left to right and three.js's default `XYZ` Euler order read as intrinsic
rotations, so the two renderers agree with no conversion. A document field for
the order was considered and rejected: it is a fifth thing that can differ
between the canvas and the file, in exchange for expressing rotations that are
also expressible by composing a `pivot`.

### 2.4 `EDGES` — five new rows

```ts
export type Edge =
	| "left" | "centerX" | "right"
	| "top" | "centerY" | "bottom"
	| "width" | "height"
	| "x" | "y"
	| "front" | "centerZ" | "back"   // <- new
	| "depth"                        // <- new
	| "z";                           // <- new

export interface EdgeSpec {
	label: string;
	axis: "x" | "y" | "z";   // <- widened
	role: "pos" | "span" | "axis";
	place?: "lead" | "mid" | "trail";
}

	front:   { label: "Front face",     axis: "z", role: "pos",  place: "lead" },
	centerZ: { label: "Depth centre",   axis: "z", role: "pos",  place: "mid" },
	back:    { label: "Back face",      axis: "z", role: "pos",  place: "trail" },
	depth:   { label: "Depth",          axis: "z", role: "span" },
	z:       { label: "In depth",       axis: "z", role: "axis" },
```

`front` is the *lead* on z and `back` the trail, which fixes the sign
convention for the whole system: **+z points away from the viewer**, matching
the document's y-down, x-right plane. three.js is right-handed with +z toward
the viewer, so the renderer negates z exactly once, in one function, named for
it — see §6.3.

### 2.5 Which edges a panel offers

`CONSTRAINT_KINDS[k].edges` widens for free, which means the Rules panel would
offer `front` on a flat document. It must not.

```ts
/**
 * The edges this kind may be about, given the members it has.
 *
 * The table's own list narrowed to the axes the members actually live on: a
 * rule over two rectangles is offered six places and two sizes, exactly as it is
 * today, and one that names a mesh is offered nine and three. Read here rather
 * than filtered at the panel, because `annotate.ts`, `why.ts` and the seeding in
 * `addConstraint` all ask the same question and three copies of it drift.
 *
 * Empty members is the whole list, because a rule being built has not said what
 * it is about yet and refusing everything would be refusing the first click.
 */
export function edgeOptions(
	scene: Scene,
	kind: ConstraintKind,
	members: readonly string[],
): Edge[];
```

---

## 3. ASP: every new predicate, and the gate

All of it lives in `compile.ts`. Facts unless marked. Where an argument is `V`
it is EMU; where it is `Mdeg` it is a whole number of **thousandths of a
degree**.

### 3.1 The gate

| Predicate | Kind | Meaning |
| --- | --- | --- |
| `spatial` | fact, 0-ary | this document has a third axis at all |
| `zstated(N)` | fact | the document states a `z`, a `depth` or a rotation for `N` |
| `s3(N)` | derived | `N` lives in the third axis |

`spatial.` is emitted when the document holds at least one `viewport` node, or
any node with a `spatial` or a `turn` entry. Nothing else in this whole section
grounds without it, which is the entirety of the no-regression promise:

```prolog
#defined spatial/0.
#defined zstated/1.
#defined looks/2.
#defined tris/2.
#defined mdeg/2.

% ---- the third axis exists, or it does not ----
% Guarded rather than stated, and this one atom is what keeps a flat document
% flat. With no `spatial` the two lines below ground away, so gaxis/1 and
% gspan/1 are the two-and-two they have always been, the scene defaults state
% four frames per node rather than six, and no gsolved node gains a z unknown.
% A rule of yours may assert `spatial.` and get the axis without the document
% holding a viewport, which is the same courtesy `ggrid/1` and `machine/1` get.
gaxis(z) :- spatial.
gspan(depth) :- spatial.
gturn(rotateX) :- spatial.
gturn(rotateY) :- spatial.
gturn(rotateZ) :- spatial.

% ---- which nodes are in it ----
% Not derived from frame/3, deliberately: the scene default below *writes*
% frame(N,z,0) for an s3 node, so reading frame/3 here would close a loop
% through a negation and leave the program with no stable model. The compiler
% states zstated/1 instead, which is a claim about the document and is settled
% before any rule runs.
s3(N) :- kind(N,viewport).
s3(C) :- s3(P), child(P,C).
s3(N) :- zstated(N).
```

> **AMENDED (merged-plan §6.3).** A fourth clause is required. `zstated/1` is
> emitted per *document* node, so a definition part the document lifted has
> `zstated(part)` and `inst(I,part)` has nothing; the `child/2` climb only rescues
> it when some ancestor is already `s3`. An instance of a definition holding a
> lifted `rect`, placed on a plain artboard, would be flat.
>
> ```prolog
> s3(inst(I,N)) :- instance(I,R), cpart(R,N), s3(N).
> ```
>
> A **state copy** needs no clause of its own: `MACHINE_RULES` already states
> `child(inst(I,P),stt(I,S,N))` for the world chain, so `s3(stt(I,S,N))` falls out
> of the climb — which is what merged-plan §4 relies on.

Widening `gaxis/1` and `gspan/1` rather than adding a parallel `gzaxis/1` is the
other half of the decision, and it is what makes §4 short. Every rule that reads
those two — the scene defaults, `gpos`/`gsize`, the world chain, the edge
equation, `gcoord`, `mbase`, the state copies' own defaults — picks up the third
axis with no new line anywhere. A parallel table would have meant writing each of
those rules twice and keeping the two copies in step forever.

### 3.2 The scene defaults

One change, and it is a narrowing rather than a widening:

```prolog
% As before, for the two planar axes and the two planar spans.
framed(N,A) :- frame(N,A,V), V != 0.
frame(N,A,0) :- node(N), gplane(A), not framed(N,A).
frame(N,S,0) :- node(N), gplanespan(S), not framed(N,S).
% ...and the third axis only for the nodes that are in it. Written this way
% round rather than as `gaxis(A)` because a spatial document still holds
% artboards, cards and headlines that have no business gaining two coordinates
% and two more atoms each: a viewport on page four does not put the whole
% document into three dimensions, it puts its own subtree there.
frame(N,z,0) :- node(N), s3(N), not framed(N,z).
frame(N,depth,0) :- node(N), s3(N), not framed(N,depth).
```

`gplane(x). gplane(y). gplanespan(width). gplanespan(height).` are new 0-cost
facts naming the planar half of the vocabulary. They exist solely so the two
default rules can stay narrow while `gaxis/1` and `gspan/1` grow; every other
reader of the geometry vocabulary wants all of it and keeps reading `gaxis/1`.

**This is the one place in the geometry rules where a `gaxis(A)` became
something else, and it is worth checking in review.** A `gsolved` node in a
spatial document *does* get `lv(N,z)` and `lsz(N,depth)` unknowns and the four
pull inequalities that go with them, reading the `frame(N,z,V)` the default above
supplied — which is correct: a rectangle a rule places in a document that has a
third axis is at z 0 and stays there unless something says otherwise.

> **AMENDED — this paragraph is wrong, and it is the most serious error in this
> document. See `docs/merged-plan.md` §5.**
>
> The `frame(N,z,V)` the default above supplies is supplied **only for an `s3`
> node**, which is the whole point of the narrowing — but `gpos/2` and `gsize/2`
> were left reading the *widened* `gaxis/1` and `gspan/1`. So a plain rectangle on
> another artboard, named in a geometric constraint, in a document that has a
> viewport anywhere, gains `gpos(N,z)` with **no** `frame(N,z,V)`, therefore no
> pull inequality, therefore a `gd(N,z)` in the shared `&minimize` with nothing
> bounding it from below. `compile.ts`'s own comment above `gsolved/1` says what
> that is: *"An unbounded objective is not a wrong picture, it is no answer at
> all."* The same happens on the explore path through `gcoord/2` → `gprobe/3` →
> `&maximize`.
>
> `gpos/2`, `gsize/2`, `gworld/2`, `gcoord/2`, `gmoved/2` and `gowns/2` must be
> narrowed the same way the defaults were. The nine replacement lines are in
> merged-plan §5, and the first test to write is: *a document with a viewport on
> artboard two and an `align` between two rectangles on artboard one is SAT and
> places them exactly where the same document without the viewport does.*

### 3.3 Rotation

| Predicate | Kind | Meaning |
| --- | --- | --- |
| `rval(N,R)` | variable | the value one rotation is — minted through `emitValue` |
| `mdeg(Lit,Mdeg)` | fact | the **sixth literal bridge** (`numeral`, `tally`, `word`, `millis`, `permille`, and now this — **AMENDED**, merged-plan §2: the ladder's `permille/2` is the fifth, and both documents claimed the number): the angle a literal reads as |
| `t_value(N,R,Lit)` | derived | `resolved(rval(N,R))` — **projected** |
| `turn(N,R,Mdeg)` | derived | how far `N` is turned about `R`, this universe |
| `turned(N,R)` | derived | it says something usable there |
| `grotated(N)` | derived | some rotation of `N` is non-zero |

```prolog
#defined rval/2.
#defined mdeg/2.
% The same shape frame/3 has, one axis over: a rotation is a value like any
% other, so it is picked per universe and may name a token — an `angle` token
% with two alternatives is a card that lies flat in one design and tilts in
% another, and that really is two designs.
t_value(N,R,L) :- resolved(rval(N,R),L).
turn(N,R,V) :- t_value(N,R,L), mdeg(L,V).
turned(N,R) :- t_value(N,R,L), mdeg(L,_).
% A rotation that reads as no angle at all is no rotation, not zero by accident
% — same reading frame/3 gets, and the same fallback.
turn(N,R,0) :- s3(N), gturn(R), not turned(N,R).
grotated(N) :- turn(N,R,V), V != 0.
```

### 3.4 The refusal — §4's rules, stated here

```prolog
% A rotated box's left edge is trigonometry, and clingo-lpx is linear
% arithmetic. So the quantity is never created, the relation that wanted it goes
% unstated, and the rule says nothing — which is exactly the silence gdatum/1
% already arranges for a span edge on a column line, for exactly the same
% reason: a constraint that quietly means something else is worse than one that
% quietly means nothing, and the editor is where the refusal is made visible.
gnoedge(N,E) :- grotated(N), gedge(E,_,pos), gplace(E,lead).
gnoedge(N,E) :- grotated(N), gedge(E,_,pos), gplace(E,trail).
```

`gedgeof(N,E) :- gcon(C), c_node(C,N), gneed(C,E), not gnoedge(N,E).` is already
written that way and does not change.

> **AMENDED (merged-plan §6.2).** A third rule is required, and without it a rule
> across the seam is satisfied by a box the document does not contain:
>
> ```prolog
> % A node that is not in the third axis has no quantity there. `gedgeof/2` reads
> % only c_node/2 and gneed/2, so without this an `align [card, cube] on centerZ`
> % grounds ge(card,centerZ) out of unknowns nothing constrains and reports itself
> % satisfied. The same wrong-rectangle answer gdatum/1 refuses for a span edge on
> % a column line, refused the same way.
> gnoedge(N,E) :- spatial, gedge(E,z,_), not s3(N).
> ```
>
> `refusedEdge` gains the sentence for it, in merged-plan §6.2. Note also that
> `refusedEdge` is handed a constraint *member*, which may be `stt(I,S,N)`,
> `kfr(I,W,R,K)` or `inst(I,N)` rather than a node id, and must reduce before it
> asks — merged-plan §6.6.

### 3.5 The scene's own new facts

| Predicate | Kind | Meaning |
| --- | --- | --- |
| `looks(V,C)` | fact | viewport `V` looks through camera `C` |
| `vcam(V,C)` | derived | ...and `C` really is a camera in `V`'s subtree |
| `tris(N,K)` | fact | model `N`'s payload holds `K` triangles |
| `asset(N,A)` | fact | model `N`'s payload is asset `A` |

```prolog
% A camera the document names but that is not a camera, or is not in this view,
% decides nothing — the same silence a dangling instanceOf leaves. The renderer
% then frames the subtree itself and says so; see §6.
vcam(V,C) :- looks(V,C), kind(C,camera), s3(C), kind(V,viewport).
```

`tris/2` is emitted for its own sake and it is the cheapest useful thing in this
section: `viol(mesh_budget) :- tris(_,K), K > 200000.` is a rule a team can
write on day one, with a name in the core, a switch and a `why`, and it needed
no new machinery at all.

### 3.6 Output

```prolog
#show turn(N,R,V) : turn(N,R,V), scenery.
#show tris(N,K) : tris(N,K), scenery.
#show looks(V,C) : looks(V,C), scenery.
#show vcam(V,C) : vcam(V,C), scenery.
% A rotation is a design decision like a position: an `angle` token with two
% alternatives is the flat design and the tilted one, and without this they
% differ in nothing projected and collapse into one universe with an arbitrary
% pick. Exactly the argument f_value/3 already makes, one quantity over.
#project t_value/3.
```

`frame(N,z,V)` and `frame(N,depth,V)` reach the answer set through the existing
generic `#show frame(N,D,V)`. That is the cost of the third axis in atoms: two
per node in a viewport's subtree, and nothing anywhere else.

### 3.7 What "no regression" is asserted as, and why not byte-identity

The state-machine spec asserted that the generated program for a machine-free
document was byte-identical but for the added `#defined` lines. This track cannot
promise that and should not pretend to: `EDGE_FACTS` is generated from the
`EDGES` table, and five new rows produce five new lines. They are emitted as
**guarded rules rather than facts** —

```ts
const EDGE_FACTS = EDGE_NAMES.flatMap((edge) => {
	const spec = EDGES[edge];
	// The planar rows stay facts and stay byte-identical. A z row is the same
	// fact behind the gate, so a flat document grounds none of them and a rule
	// that asserts `spatial.` gets all five.
	const guard = spec.axis === "z" ? " :- spatial." : ".";
	return [ /* gedge(...) and gplace(...) with `guard` */ ];
});
```

— so **no z atom grounds in a flat document**. The promise this track makes, and
the one step 1's test asserts, is therefore about the *answer sets and the
output*, which is what a designer can actually observe:

1. same universe count,
2. same `readModel(...)` result, deep-equal,
3. same `exportUniverse(...).text`, byte for byte,
4. and the atoms of a flat document contain no `gedge(front`, no `gaxis(z`, no
   `frame(_,z,` and no `turn(`.

---

## 4. Rotation, and its limit

**This is the load-bearing section.** Everything above is bookkeeping; this is
the part where the system has to tell the truth about what it cannot do.

### 4.1 The arithmetic

`clingo-lpx` decides **linear** arithmetic over rationals. Every geometric
relation in the program is a sum of whole multiples of `lv`, `lsz`, `wv`, `ge`
and `gd` against an integer bound, and that is the only reason a document full of
constraints has an exact answer rather than a search.

A rotated box's extent on an axis is `|w·cos θ| + |h·sin θ|`. Its left edge is
`cx − (|w·cos θ| + |h·sin θ|)/2`. Neither is linear in anything, and neither
becomes linear by being written differently: θ is itself a value the solver may
be picking between, so even fixing θ per universe and folding the trigonometry
into a coefficient would mean grounding a different program per rotation — and
`cos 30°` is irrational, so the coefficient could not be an integer even then.

There is no encoding. There is only a line, and the job is to draw it where a
designer can see it.

### 4.2 Where the line falls

Rotation is about the node's **own centre**. That single decision is what makes
the line worth drawing at all, because it splits the ten quantities cleanly:

| quantity | on a rotated node | why |
| --- | --- | --- |
| `centerX`, `centerY`, `centerZ` | **honest** | a rotation about the centre does not move the centre. `ge(N,centerX) = 2·wv(N,x) + 1·lsz(N,width)` is exactly as true after the turn as before |
| `width`, `height`, `depth` | **honest** | a span is a property of the node *in its own frame*, and turning a card does not make it a wider card. `equalSize [a,b] on width` means "these two are the same size", which is what a designer means and what stays true |
| `x`, `y`, `z` (whole axes) | **honest for `symmetric`, refused for `gap`** | `symmetric` reads `gmid` and is therefore about centres; `gap` reads `glead`/`gtrail` and is therefore about faces |
| `left`, `right`, `top`, `bottom`, `front`, `back` | **refused** | the box's face is not where the pixels are, and `ge(N,left)` would be a number about a rectangle the document does not contain |

So the refusal is exactly: **positional edges at `lead` and `trail`, on a node
with any non-zero rotation.** That is §3.4's two rules, and the shape of the
refusal — `gnoedge/2`, so the quantity is never minted and the relation goes
unstated — is the shape `gdatum/1` already uses for a span edge on a column
line.

The consequences a designer meets, each stated as the sentence the editor shows:

- `gap [a,b] on x` where either is rotated → refused, because a gap is measured
  between two faces.
- `align [a,b] on left` where either is rotated → refused. `align … on centerX`
  is offered instead, in the same menu, and for most uses of `align` it is what
  was meant.
- `pin` on `left` of a rotated node → refused. `pin` on `centerX` works.
- Everything about `width`, `height`, `depth` and every centre → works, and
  works exactly.
- A **rotated node may still be `gsolved`**, and this matters: the solver
  translates it, sizes it, and puts it in the world chain, so a rotated mesh
  under an automatic layout or held by a `pin` on its centre lands exactly where
  it should. Rotation and translation commute about the centre, which is why.

### 4.3 A refusal a designer can see

Silence in ASP is invisible, and an invisible refusal is worse than the wrong
answer it replaced. So the refusal is *also* a reader, in `spatial.ts`, and the
Rules panel is required to show it:

```ts
/**
 * Why this rule cannot be about this quantity on this member, in the words the
 * panel shows — or nothing where it can.
 *
 * The TypeScript twin of `gnoedge/2`, and the two are held equal by a test
 * against the real solver, exactly as `machineHealth` and `munreached/2` are
 * held equal. Two readers because neither can do the other's job: the panel has
 * to grey the row while there is no answer set at all, and the program has to
 * refuse the quantity while there is.
 */
export function refusedEdge(
	scene: Scene,
	member: string,
	edge: Edge,
	picks?: Picks,
): string | undefined;
```

The sentences, verbatim, because they are the feature:

> **“Panel” is turned 30° about Y, and the left edge of a turned box is
> trigonometry. The solver here is linear arithmetic — that is what makes every
> other rule in this document exact — so a rule about this edge would be a
> statement about a rectangle the design does not contain. Its centre and its
> width are still exactly what they say they are.**

> **A gap is measured from one face to the next, and “Card” is turned 12° about
> Z, so it has no face on this axis that a number could hold. Either measure
> between their centres with `symmetric`, or take the turn off.**

And the inertness is reported rather than merely refused:

```ts
/** Every enabled constraint that names a quantity the program will not create. */
export function inertConstraints(
	scene: Scene,
	picks?: Picks,
): Array<{ constraint: string; member: string; edge: Edge; why: string }>;
```

The Rules panel marks those rows (`data-role="inert-rule"`), and the status line
counts them beside the broken ones. A rule that says nothing is a rule with a
bug in it, and the tool is required to say so out loud.

### 4.4 What the editor refuses to do directly

Two more refusals, both consequences of `geometry.ts` being axis-aligned
rectangle maths and staying that way:

- **A rotated node's resize handles are hidden.** `resizeFrame` drags a side of
  an axis-aligned box; on a turned node the side under the pointer is not the
  side the maths would move. The inspector's width and height fields still work
  and are exact. `rotationFrozen(node, context): boolean` in `scene.ts` is what
  `Editor.tsx` reads, beside the `frameFrozen` it already reads.
- **Hit testing uses the unrotated box.** A click near a turned card's corner
  may select it when the pixels there are empty, or miss it where they are not.
  This is named rather than fixed: fixing it means an oriented-box test in
  `geometry.ts` and a second one for the 3D case, and the 3D case is already
  answered correctly by the raycaster (§9). Recorded here, in `ExportResult`
  nowhere, and in the layer list's tooltip on a turned node.

---

## 5. Imported geometry

### 5.1 The precedent, followed exactly

A path's `points` live on the `SceneNode` and never enter the program; the path
itself is an ordinary node with an ordinary frame, so snapping, layout,
constraints, grouping and the multiverse all work on it and none of them has ever
seen a bezier. An imported mesh is the same trade at a different scale.

- The **node** is `kind(N,model)` with a `frame/3` — the bounding box of the
  vertices, in EMU, exactly as a path's frame is the bounding box of its points.
  Everything that works on frames works on a model unchanged.
- The **vertices** are not in the program, are not in `frame/3`, and are not
  reachable from any rule. What *is* reachable is `tris(N,K)`, which is the one
  fact about the payload that a rule can usefully hold an opinion about.

### 5.2 Where the payload lives, and why not on the node

```ts
/**
 * The reference to an imported mesh: small, diffable, and synced.
 *
 * The bytes are **not here**, and that is the one place this departs from the
 * path precedent. A path's points are a few dozen numbers and belong in the
 * document; a glTF is megabytes, the document is an Automerge document two
 * people edit at once, and putting a binary blob in it would put that blob in
 * every diff, every undo entry and every sync message. So the node holds the
 * hash and the metadata — which is everything the *editor* needs to draw a layer
 * row, run a constraint, and know what it is looking at — and the payload lives
 * in a content-addressed store beside the document.
 *
 * The cost of that split is one thing and it is stated in §10.3: an export has
 * to be handed a resolver, because a file cannot reach into an object store.
 */
export interface MeshRef {
	/** Content hash of the payload — the id the asset store keys it by. */
	asset: string;
	format: "gltf" | "glb";
	/** The box the vertices occupy, in the model's own space, in EMU. */
	bounds: Box;
	/** For the layer list, the budget rule and the status line. */
	triangles: number;
	/** The file it came from, so a relink has something to show. Free-form. */
	source?: string;
}

/** What the document remembers about an asset it does not hold. */
export interface AssetInfo {
	format: "gltf" | "glb";
	/** Payload length in bytes, so the studio can total it without loading it. */
	bytes: number;
	triangles: number;
	name: string;
}

export interface Scene {
	// …
	/**
	 * Metadata for every asset the document's models reference, by hash.
	 *
	 * Beside the tokens and the machines rather than among the nodes: an asset is
	 * shared, has its own identity and lifecycle, and two models may reference
	 * one. A hash the index does not know is a missing asset, which is a thing
	 * the studio reports and the export names in `lost` — never a thing that
	 * fails a solve.
	 */
	assets?: Record<string, AssetInfo>;
}
```

The store itself is an interface in design-core and an implementation in the
app, so nothing impure crosses the boundary:

```ts
// packages/design-core/src/assets.ts — new file, pure
export interface AssetStore {
	get(id: string): Promise<Uint8Array | undefined>;
	/** Returns the content hash, which is the id. */
	put(bytes: Uint8Array): Promise<string>;
	has(id: string): Promise<boolean>;
	/** Everything nothing references any more. */
	sweep(keep: ReadonlySet<string>): Promise<string[]>;
}

/** Every asset id the document still references — what `sweep` is handed. */
export function referencedAssets(scene: Scene): Set<string>;
```

`packages/app/src/projects/assets.ts` implements it over IndexedDB, beside the
existing `idb.ts`. The hash is SHA-256 via `crypto.subtle`, hex, which is why
`put` is async and why the interface is not synchronous.

### 5.3 What the exporter pays

Two things, and both are stated rather than absorbed:

1. **The glTF target must be handed the bytes.** `ExportOptions.assets?: (id:
   string) => Uint8Array | undefined` — a synchronous resolver the studio fills
   from a prefetch, because `exportUniverse` is synchronous and making it async
   would ripple through every caller and every test in `export.test.ts`. Where
   the resolver returns nothing, the model exports as its **bounding box** as a
   plain mesh and `lost` gains:
   > *“Model “Chair” is in the file as its bounding box: its geometry lives
   > outside the document, and this export was not handed it.”*
2. **The HTML target never needs them**, because a model is inside a viewport
   and the HTML target does not draw a viewport's contents at all (§10.2).

---

## 6. Units

### 6.1 EMU is the world unit, unchanged

`units.ts` **does not change**. Not one line. EMU is an integer 1/914400 inch, it
works as a world unit exactly as it works as a page unit, and the third axis is
measured in it like the first two. That is the whole of the units answer and it
is worth saying because the alternative — a separate "world unit" with a scale
factor — would have put a second unit system in a codebase whose central promise
is that it has one.

### 6.2 The two exact conversions, and where they live

```ts
// packages/canvas-3d/src/units3.ts
/**
 * EMU to the units the renderer's scene graph is in, which are **CSS pixels** —
 * `cssPxFromEmu` under the name this package uses.
 *
 * Pixels rather than metres, and the reason is float precision rather than
 * taste. A 480px viewport is 4,572,000 EMU; a `float32` depth buffer has a
 * 24-bit mantissa, so a scene measured in EMU would lose sub-object precision
 * before anything got interesting, and z-fighting on two coplanar faces would
 * appear as a rendering bug in a system whose numbers are exact. In CSS pixels
 * the same viewport is 480 units, `near` at 1 and `far` at 20000 give a
 * perfectly ordinary depth range, and the number on screen is the number in the
 * inspector.
 *
 * The discipline this package keeps is the discipline `viewport.ts` keeps in the
 * app: anything holding renderer units has `World` in its name, and this module
 * is the only place that crosses.
 */
export const worldFromEmu = (emu: Emu): number => cssPxFromEmu(emu);
export const emuFromWorld = (world: number): Emu => emuFromCssPx(world);

/** Thousandths of a degree to radians, for three.js. Lossy, once, by name. */
export const radFromMdeg = (mdeg: number): number => (mdeg / 1000) * (Math.PI / 180);
```

```ts
// packages/design-core/src/gltf.ts
/**
 * EMU to metres, for the glTF target — and it is **exact**.
 *
 * glTF has no unit field and its convention is metres. 1 in = 0.0254 m =
 * 914400 EMU, so 1 m is exactly 36,000,000 EMU: a whole number, which means the
 * one conversion this file makes divides rather than approximates, and a
 * document measured in millimetres round-trips through a glTF and back to the
 * millimetre it was.
 */
export const METRE_IN_EMU = 36_000_000;
export const metresFromEmu = (emu: Emu): number => emu / METRE_IN_EMU;
```

### 6.3 The one sign flip

The document's plane is x right, y **down**, and §2.4 fixes +z **away from the
viewer**. three.js is right-handed with y up and +z toward the viewer. The
renderer therefore negates y and z exactly once, in one function, in
`canvas-3d/src/units3.ts`:

```ts
/** A document point, as a three.js position. The only place a sign flips. */
export const worldPoint = (at: Box): [number, number, number] => [
	worldFromEmu(at.x + at.width / 2),
	-worldFromEmu(at.y + at.height / 2),
	-worldFromEmu(at.z + at.depth / 2),
];
```

The `+size/2` is the other half of §2.3's centre decision showing up in the
renderer: the document stores an origin and a size, three.js positions an object
by its centre, and rotation is about the centre in both.

### 6.4 The gringo ceiling

`ASP_EMU_CEILING` is `2^31/4` EMU ≈ 56,364 px, set by the `4*V` in the mirrorless
`symmetric` rule. **The third axis adds no coefficient to any right-hand side**:
`z` is a `pos` and `depth` is a `span`, so they flow through the *same* equations
the planar four do, with the same `2*` and `K*` coefficients and no new ones.
`ASP_EMU_CEILING` and `aspLayoutCeiling` are therefore unchanged and remain
correct.

The two 3D numbers that come nearest it are `far` and a model's `depth`. A `far`
of 20,000 px is 190,500,000 EMU — comfortably under 536,870,911, and about a
third of it, which is close enough to be worth writing down. `far` is a `prop`
resolved through `numeral/2` and never multiplied, so it is bounded by
`MAX_SAFE_INTEGER` rather than by the ceiling; a `far` on a node a geometric rule
*also* places is bounded by the ceiling like any other length. Recorded, tested
in `aspunits.test.ts`, not enforced — a clamp would silently move a designer's
number.

Rotation has its own, unrelated ceiling:

```ts
/**
 * The furthest a document may turn something: ten full turns, in thousandths of
 * a degree.
 *
 * `MAX_MS`'s argument, one quantity over, and one step weaker still: nothing
 * grounds a range over an angle and nothing multiplies one, so this exists only
 * because gringo's integers are 32-bit and a mistyped `3600000deg` should read
 * as a typo rather than wrap into a small negative rotation nobody can explain.
 */
export const MAX_MDEG = 3_600_000;
```

### 6.5 Reading an angle

In `values.ts`, beside `emuOf`, `numeralOf`, `tallyOf` and `msOf` — the quantity
readers sitting together is what makes a new one obviously new. (`angle` **is**
the fifth *quantity*, which is this document's claim and stands; what it is not
is the fifth *literal bridge*. The ladder's `permilleOf` is a second reader for
the `ratio` quantity that has been there since `numeralOf`, not a sixth quantity
— merged-plan §2.)

```ts
/**
 * The whole number of **thousandths of a degree** a literal reads as: `"45deg"`
 * is 45000, `"0.5deg"` is 500, `"0.25turn"` is 90000.
 *
 * Thousandths rather than whole degrees because a fact has to be an integer and
 * a designer will type `22.5deg` on the first day. A thousandth of a degree is
 * an arcsecond and a bit, four orders finer than anything a screen resolves, so
 * the granularity is invisible in the same way an EMU is.
 *
 * **Exact or nothing**, exactly as `emuOf` and `msOf` are. `"1.0005deg"` is
 * 1000.5 thousandths, so it reads as no angle at all rather than as 1000 or as
 * 1001 — a caller that wanted a rounding asks for one by name
 * ({@link nearestMdeg}), and the fact the compiler emits is never a number
 * nobody typed.
 *
 * Three units, and the fourth is refused for a reason rather than an oversight.
 * `deg` is the unit; `turn` is 360000 and `grad` is 900, both whole, so both
 * round-trip exactly. **`rad` is refused except for zero**, because π is
 * irrational: `"1rad"` is 57295.779… thousandths and there is no exact reading,
 * and quietly rounding it would put a number in the document that no unit
 * conversion here has ever put there. `"0rad"` reads as 0, because every unit
 * agrees about zero — the same courtesy `msOf` extends to a bare `0`.
 *
 * Unitless is refused except for zero, for `msOf`'s reason: `"45"` is a count
 * of forty-five things everywhere else in this system, and guessing would make
 * a grid of forty-five columns and a rotation of forty-five degrees the same
 * text.
 *
 * Negative is read and returned as negative: a rotation has two directions and
 * both are things to ask for. Nothing clamps it.
 */
export function mdegOf(text: string): number | undefined;

/** The nearest thousandth, for the one caller allowed to round: a field a person is typing into. */
export function nearestMdeg(text: string): number | undefined;

/** How an angle is written back, in the unit it was already written in. The twin of `writeLength`. */
export function writeAngle(mdeg: number, unit?: "deg" | "turn" | "grad"): string;

/** True when values of this type are angles — the twin of `isTimeType`. */
export const isAngleType = (type: ValueType): boolean =>
	VALUE_TYPES[type].quantity === "angle";

/** One rotation of one node, as the variable it is: `rval(n7,rotateY)`. */
export const rotateVar = (nodeId: string, turn: string): string =>
	`rval(${nodeId},${turn})`;
```

| Input | Reads as | Why |
| --- | --- | --- |
| `"45deg"` | `45000` | |
| `"22.5deg"` | `22500` | |
| `"-90deg"` | `-90000` | both directions are real |
| `"0.25turn"` | `90000` | 360000 × 0.25, whole |
| `"1turn"` | `360000` | |
| `"50grad"` | `45000` | 900 × 50 |
| `"0"` `"0rad"` `"0deg"` | `0` | every unit agrees about zero |
| `"45"` | *nothing* | that is a count everywhere else |
| `"1rad"` | *nothing* | 57295.779… — π is irrational |
| `"1.0005deg"` | *nothing* | not a whole thousandth |
| `"45DEG"` | `45000` | CSS units are case-insensitive |
| `"  45 deg "` | `45000` | the three places `emuOf` tolerates space |
| `"3600001mdeg"`, `"3601deg"` | *nothing* | past `MAX_MDEG`, in both signs |
| `"45px"` `""` `"deg"` | *nothing* | |

`parseVariable` **is** extended for `rval`, unlike `mval`/`sprop`/`sfval`: the
inspector's generic rows really can act on a rotation — it is one number, of one
type, on one node, with alternatives and a token link, which is precisely what
those rows are for. That is the test, and it is the reason the machine keys stay
out.

---

## 7. TypeScript, file by file

### 7.1 `packages/design-core/src/spatial.ts` — new file

The twin of `machines.ts`: the readings, the refusals and the labels. Everything
in it is a pure reading of the document or of one answer set.

```ts
/* ---- what is in three dimensions ---- */

/** True when the document has a third axis at all — what gates `spatial.`. */
export function isSpatialScene(scene: Scene): boolean;

/** Every viewport in the document, in document order. */
export function viewports(scene: Scene): SceneNode[];

/** The viewport a node is inside, or nothing. */
export function viewportOf(scene: Scene, id: string): SceneNode | undefined;

/** True when this node is inside a viewport, or states a z, a depth or a turn. */
export function isSpatialNode(scene: Scene, node: SceneNode): boolean;

/** The camera a viewport looks through: what it names, if that is a camera in it. */
export function cameraOf(scene: Scene, viewport: SceneNode): SceneNode | undefined;

/** Every camera inside a viewport, for the "look through" menu. */
export function camerasIn(scene: Scene, viewport: SceneNode): SceneNode[];

/* ---- reading one node ---- */

/** Position and size on all six axes, in EMU, in this universe. */
export function boxOf(node: SceneNode, context?: ResolveContext): Box;

/** A material, as the renderer wants it — clamps live here and nowhere else. */
export interface Material {
	fill: string;
	roughness: number;   // clamped [0,1]
	metalness: number;   // clamped [0,1]
	opacity: number;     // clamped [0,1]
}
export function materialOf(rendered: Partial<Record<PropName, string>>): Material;

/** A lamp, likewise. `intensity` clamps at zero: a negative light is a typo. */
export interface Lamp { lamp: string; ink: string; intensity: number }
export function lampOf(rendered: Partial<Record<PropName, string>>): Lamp;

/** A lens. `fov` in thousandths of a degree; `near`/`far` in EMU, far > near enforced. */
export interface Lens { fovMdeg: number; near: Emu; far: Emu }
export function lensOf(rendered: Partial<Record<PropName, string>>): Lens;

/* ---- the refusals: see §4 ---- */

export function refusedEdge(scene: Scene, member: string, edge: Edge, picks?: Picks): string | undefined;
export function inertConstraints(scene: Scene, picks?: Picks): Array<{ constraint: string; member: string; edge: Edge; why: string }>;

/* ---- the budget, for the status line ---- */

export interface SpatialBudget {
	viewports: number;
	/** Meshes and models, over every viewport. */
	objects: number;
	triangles: number;
	/** Assets the document references and `Scene.assets` does not know. */
	missing: string[];
}
export function spatialBudget(scene: Scene): SpatialBudget;
```

### 7.2 `packages/design-core/src/solid.ts` — new file

Pure geometry generation, no three.js, so the exporter can tessellate without a
renderer and `node:test` can check it headless.

```ts
/** A primitive as indexed triangles, in the unit cube, y-down like the document. */
export interface Tessellation {
	/** Interleaved xyz, 3 per vertex. */
	positions: Float32Array;
	/** Interleaved xyz normals. */
	normals: Float32Array;
	indices: Uint32Array;
}

/**
 * The six primitives, generated rather than stored.
 *
 * In the **unit cube** — every coordinate in [-0.5, 0.5] — so that the box's
 * size is applied as a scale by whoever draws it and one tessellation serves
 * every mesh in the document. A sphere in a unit cube is an ellipsoid when the
 * box is not cubic, which is what a designer resizing a sphere means.
 *
 * `segments` is the one quality knob, and it is a constant rather than a
 * property: a document that could hold a segment count would hold a rendering
 * setting, and the number of arguments about what it should be would exceed the
 * number of pixels it changes.
 */
export const SOLID_SEGMENTS = 32;
export function tessellate(solid: string): Tessellation;
```

### 7.3 `packages/design-core/src/edits.ts`

```ts
/** A viewport with a camera and a key light in it, ready to look at. */
export function addViewport(scene: Scene, parent: string | null, frame: Frame): Scene;

/** One mesh, in the viewport's own space. `solid` is the primitive it starts as. */
export function addMesh(scene: Scene, viewport: string, solid: string): Scene;
export function addCamera(scene: Scene, viewport: string): Scene;
export function addLight(scene: Scene, viewport: string, lamp: string): Scene;
export function addPivot(scene: Scene, viewport: string, children: readonly string[]): Scene;

/** An imported model. The caller has already put the bytes in the store. */
export function addModel(
	scene: Scene,
	viewport: string,
	ref: MeshRef,
	info: AssetInfo,
): Scene;

/** Which camera a viewport looks through. A no-op on anything else. */
export function setViewportCamera(scene: Scene, viewport: string, camera: string | null): Scene;

/** One spatial dimension, as an edit. The twin of `setFrameValue`. */
export function setSpatialValue(scene: Scene, id: string, dim: Spatial, value: Value): Scene;
export function setTurnValue(scene: Scene, id: string, turn: Turn, value: Value): Scene;

/** Drop the entry entirely when it says nothing, so "flat" has one spelling. */
export function clearSpatial(scene: Scene, id: string, dim: Spatial): Scene;
export function clearTurn(scene: Scene, id: string, turn: Turn): Scene;

/** Assets nothing references any more, dropped from the index. Called by `deleteNodes`. */
export function pruneAssets(scene: Scene): Scene;
```

`pruneConstraints` gains nothing: a 3D node is an ordinary node and is already in
`alive`. **That is the one place this track is cheaper than the machine track
was, and it is the invariant paying for itself.**

### 7.4 `packages/design-core/src/model.ts`

`ModelNode` and `ModelState` each gain two optional fields. Optional, and absent
on every node of every flat document, which is what keeps `model.test.ts`'s
existing assertions true unchanged:

> **AMENDED (merged-plan §2).** The field is named **`spatial`**, not `solid`,
> and its type is `SpatialFrame`. It is the answer-set twin of
> `SceneNode.spatial` exactly as `ModelNode.frame` is the twin of
> `SceneNode.frame`, and the old name would have collided with the mesh
> primitive. `boxOf3` reads `node.spatial?.z` and `node.spatial?.depth`.
>
> **`ModelKeyframe` (the ladder's, `rive-ladder-spec.md` §6.2) gains the same two
> fields**, for the same reason — merged-plan §6.5. A keyframe copy of a mesh
> that carries only four numbers is a pose the canvas cannot draw.

```ts
export interface ModelNode {
	// …
	/**
	 * Where it is on the third axis, when the answer set said anything about it.
	 *
	 * Beside `frame` rather than folded into it, and that is the whole
	 * no-regression story in one field: `Frame` is four numbers, every gesture,
	 * every snap, every hit test and every existing test reads four numbers, and
	 * a document with no third axis produces no `frame(N,z,_)` so this stays
	 * absent. A reader that wants six calls `boxOf3(node)`.
	 */
	solid?: Solid;
	/** How it is turned, in thousandths of a degree per axis — `turn/3`. */
	turn?: Record<Turn, number>;
}

export interface ModelState {
	// … the same two, for the same reason.
	solid?: Solid;
	turn?: Record<Turn, number>;
}

/** A model node's six numbers, with the missing two read as zero. */
export const boxOf3 = (node: { frame: Frame; solid?: Solid }): Box => ({
	...node.frame,
	z: node.solid?.z ?? 0,
	depth: node.solid?.depth ?? 0,
});
```

`collect` gains: `z` and `depth` to the `AXIS` lookup used by the `frame/3` case
— routed into a new `facts.solid` map rather than into `facts.frame`, so `boxOf`
keeps returning four — plus cases for `turn/3`, `tris/2`, `looks/2` and
`vcam/2`. `readSolved` gains `z` and `depth` to its own `AXIS`, so a solved third
axis folds into `ModelNode.solid` by the same lines that fold x into `frame`.

`ModelScene` gains:

```ts
	/** Model node id -> its triangle count, for the budget line — `tris/2`. */
	triangles: Record<string, number>;
	/** Viewport node id -> the camera node it looks through — `vcam/2`. */
	looks: Record<string, string>;
```

### 7.5 `packages/design-core/src/project.ts`

`normalizeScene` reads, and drops or keeps, on the argument that a stored
document is read rather than repaired:

- `spatial` and `turn`: each entry is a `Value`; a non-value entry is dropped,
  an empty record is dropped entirely so "flat" has one spelling. Lengths are
  snapped onto their unit's lattice by the existing migration; **angles are not
  snapped**, because an angle has no lattice — `mdegOf` is exact or nothing and
  a stored `"22.5deg"` is exactly 22500.
- `camera`: kept even when it names nothing, which is the twin of a dangling
  `instanceOf` and what makes deleting a camera leave a legal document.
- `mesh`: dropped when it is not a `MeshRef` shape; **kept when the asset index
  does not know its hash**, because that is a missing file rather than a broken
  document, and it is the difference between "relink this" and "your chair is
  gone".
- `assets`: entries nothing references are kept on read (a paste may be about to
  reference one) and dropped by `pruneAssets` on an edit.
- A node of a 3D kind sitting outside any viewport is **kept and says nothing**:
  it is `node/1` with a `kind/2` like everything else, the renderer never sees
  it because no viewport contains it, and it is exactly what dragging a mesh out
  of a viewport in the layer list leaves behind. Correcting it would be
  correcting a thing a designer did on purpose.

---

## 8. The renderer seam

### 8.1 Package layout

**A new package, `packages/canvas-3d`, beside `packages/canvas`.**

Beside rather than inside the app, for three reasons and against one:

- `design-core` must stay pure (invariant 3), so it is not a candidate at all.
- The app already gets its 2D canvas from a package with a React peer dependency
  and a `src/index.ts` export; a 3D canvas is the same shape and the symmetry is
  worth keeping.
- A package boundary is a boundary the typechecker enforces: nothing in the app
  can accidentally `import { Mesh } from "three"`, because three is not in the
  app's dependency graph. That is the rule this track most wants held.
- Against: one more workspace to build. Which is why `canvas-3d` has no build
  step at all and is consumed from source like `canvas` and `canvas-core` —
  `"exports": { ".": "./src/index.ts" }`.

```jsonc
// packages/canvas-3d/package.json
{
	"name": "@clingo-design/canvas-3d",
	"version": "0.0.0",
	"private": true,
	"type": "module",
	"exports": { ".": "./src/index.ts" },
	"scripts": { "typecheck": "tsc --noEmit" },
	"dependencies": {
		"@clingo-design/design-core": "workspace:*",
		"@react-three/drei": "^10.7.0",
		"@react-three/fiber": "^9.4.0",
		"three": "^0.182.0"
	},
	"devDependencies": {
		"@types/react": "^19.2.18",
		"@types/three": "^0.182.0",
		"typescript": "^7.0.2",
		"vite": "^8.2.2"
	},
	"peerDependencies": { "react": "^19.2.0" }
}
```

`packages/app/package.json` gains exactly one dependency:
`"@clingo-design/canvas-3d": "workspace:*"`. **No `three`, no
`@react-three/*` in the app.** The version floors are what current R3F requires
for React 19; the implementing step resolves the exact versions and reports what
it pinned.

Files:

```
packages/canvas-3d/
	package.json
	tsconfig.json                 (copied from packages/canvas)
	src/index.ts
	src/units3.ts                 the crossing, §6.2
	src/ViewportCanvas.tsx        the <Canvas> and the seam
	src/SceneTree.tsx             ModelNode -> R3F elements
	src/Solid.tsx                 the six primitives
	src/Model.tsx                 a loaded glTF
	src/Lights.tsx  src/Cameras.tsx
	src/useAsset.ts               AssetStore -> a parsed three.js Object3D
	src/Selection.tsx             the outline around a selected object
	src/ViewportStill.tsx         the placeholder for a view that is not live
```

### 8.2 The API

```tsx
export interface ViewportCanvasProps {
	/** The viewport node, as the answer set describes it. */
	viewport: ModelNode;
	/** The whole model, because a camera may be anywhere in the subtree. */
	model: ModelScene;
	/** The document, read only for a model's `MeshRef` and a mesh's own kind. */
	scene: Scene;
	/** Where the payloads come from. Absent draws every model as its bounds box. */
	assets?: AssetStore;
	/** The editor's selection, so a selected object gets an outline. */
	selection?: ReadonlySet<string>;
	/**
	 * A click in the scene, reporting the node id the raycaster landed on — the
	 * *same id* the layer list uses, which for an instance's part is
	 * `inst(I,label)`. Null where the ray hit nothing.
	 *
	 * Absent means the canvas takes no pointer events at all, which is the
	 * default and which is what keeps the 2D editor's gestures working over a 3D
	 * view. See §9.
	 */
	onPickNode?: (id: string | null, event: PointerEvent) => void;
	/** Orbit the camera. Editor state, never the document — see §9.3. */
	orbit?: boolean;
	/**
	 * Draw for real. False renders {@link ViewportStill} instead: a WebGL context
	 * per universe over twenty universes is past what a browser will give.
	 */
	live?: boolean;
	/**
	 * The camera's CSS scale, so the drawing buffer matches the pixels on screen
	 * under the infinite canvas's zoom. Read off `data-canvas-scale`, which
	 * `InfiniteCanvas` already writes — see §8.3.
	 */
	scale?: number;
	/** The last frame, as a data URL, for a still. Rendered on demand. */
	onPoster?: (dataUrl: string) => void;
}

export function ViewportCanvas(props: ViewportCanvasProps): JSX.Element;

export interface ViewportStillProps {
	viewport: ModelNode;
	poster?: string;
	/** What to say where there is no poster: "3D view · 24 objects". */
	label: string;
}
export function ViewportStill(props: ViewportStillProps): JSX.Element;
```

### 8.3 Mounting inside the existing 2D canvas

**`packages/canvas/src/InfiniteCanvas.tsx` is not touched.** That is a
requirement, not an outcome, and it is achievable because a viewport is an
ordinary drawable node:

- `Artboard.tsx`'s `CONTENT` table gains one entry:
  `viewport: (node, frame, _doc, ctx) => <ViewportCanvas … />`. `CONTENT` already
  takes `(node, frame, doc)`; it gains a fourth argument carrying the model, the
  assets and the picking callback, threaded from `ArtboardProps`. So a viewport
  is drawn by the same absolutely-positioned div every other node is drawn by,
  at the same converted pixel frame, in the same paint order, inside the same
  `transform` subtree.
- **Pan and zoom keep working for nothing**, because the R3F `<canvas>` is inside
  `InfiniteCanvas`'s `s.transform` element and is scaled by the same CSS
  transform as every other pixel on the canvas.
- **Zoom would blur it**, because a `<canvas>` under a CSS `scale()` is
  resampled rather than redrawn. The fix costs one existing attribute:
  `InfiniteCanvas` already writes `data-canvas-scale={camera.scale}` on that
  element. `ViewportCanvas` reads it (`closest("[data-canvas-scale]")`, on mount
  and on a `MutationObserver`), and sets R3F's `dpr` to
  `Math.min(3, devicePixelRatio * scale)` so the drawing buffer matches the
  on-screen size. Clamped at 3 because a 6× zoom on a 2× display would ask for a
  buffer thirty-six times the pixels for a view nobody is looking closely at.
- **Culling keeps working for nothing.** `useCulling` unmounts a whole artboard
  when the camera cannot see it, and a viewport inside one unmounts with it —
  which is the behaviour that matters most here, because unmounting is what
  releases the WebGL context.
- **The context budget is the one genuinely new constraint.** Browsers cap live
  WebGL contexts at around sixteen and start dropping the oldest past that; the
  studio lays out a couple of dozen universes. So `live` is granted by
  `useViewportBudget(max = 8)` in the app, in this order: the pinned universe
  first, then the hovered one, then document order. Everything else draws a
  `ViewportStill` — the last poster if one exists, otherwise the viewport's own
  fill and a label. A still is not a placeholder for a missing feature; it is
  what twenty simultaneous 3D views have to be, and saying so is better than a
  studio that goes black on the ninth artboard.
- **`frameloop="demand"`** by default, so a static scene costs no frames at all
  and the studio's pointermove re-renders do not turn into a render loop.
  `"always"` only while `orbit` is on or a machine is being played.

---

## 9. Picking

### 9.1 The requirement

A click on a 3D object must select the same node the layer list selects. Since a
3D object *is* a scene node, "the same node" is literal: one id, one selection
set, one `onSelectionChange`.

### 9.2 How the raycaster reports back

Every object `SceneTree.tsx` mounts carries `userData.nodeId` set to the model
node's id — which is the document node's id for a plain mesh and the term
`inst(I,N)` for an instance's part, exactly as the layer list and the export use.

On `onPointerDown`, R3F hands the component an event with `object` and a
`stopPropagation`. `ViewportCanvas`:

1. walks `object.parent` upward until it finds a `userData.nodeId`,
2. calls `onPickNode(id, event.nativeEvent)`,
3. calls `event.stopPropagation()`, so only the frontmost object answers.

A click that hits nothing calls `onPickNode(null, …)` from the `onPointerMissed`
handler on the `<Canvas>`.

### 9.3 How it composes with the 2D hit testing already in `Editor.tsx`

This is the part with a real design decision in it, because two hit testers over
one pointer is how a tool gets a mode nobody can predict.

`Editor.tsx`'s `onPointerDown` calls `hitTestTree(scene.nodes, point, …)`, which
walks `placedNodes` and tests axis-aligned frames. A mesh **is** in that list and
**would** be hit — by its frame, which has nothing to do with its silhouette. So:

- **`hitTestTree` and `frameAt` stop at an opaque node.** `placedNodes` gains a
  `stopAt` predicate; `hitTestTree` passes `isOpaque`, so the walk yields the
  viewport and never its children. `dropTargetAt` does the same, so a drag can
  never drop a rectangle *inside* a 3D scene. This is the `KindSpec.opaque`
  column earning its place: one boolean, three call sites, no `kind ===
  "viewport"` anywhere.
- **A single click on a viewport selects the viewport.** That is the right
  default: the common gesture over a 3D view is moving or resizing the box it
  sits in.
- **A double-click *enters* it**, and that is not a new gesture — `onDoubleClick`
  already means "reach through the wrapper to the leaf". `Editor` gains
  `entered: string | null` (editor state, never the document), and while a
  viewport is entered:
  - its `ViewportCanvas` gets `onPickNode` and `pointer-events: auto`; every
    other one keeps `pointer-events: none`,
  - clicks raycast and call `onSelectionChange([id])`,
  - drag-with-space or middle-drag orbits (`orbit` on),
  - `Escape` leaves, and the studio's existing Escape-clears-selection is taken
    in the capture phase and stopped there — the same trick the pen already uses.
- **Selection flows the other way too.** `ViewportCanvas` takes `selection`, so
  selecting a mesh in the layer list draws its outline in the 3D view. Both
  directions through one prop and one callback is what "the same node" has to
  mean to be worth claiming.
- **While previewing** (a machine is running), the entered viewport takes pointer
  events regardless, so a `click` trigger on a 3D instance works. `instanceUnder`
  in Editor.tsx is unchanged and still answers by frame — an instance's *box* is
  what a trigger is about, and a machine driven by which triangle you touched is
  not a thing this system offers.

### 9.4 What is deliberately not here

**There is no 3D transform gizmo in this cut.** Moving a mesh is done with the
inspector's six number fields, with a geometric constraint, or with a `pivot`. A
gizmo is drei's `TransformControls` plus a mapping from its output back into
`withSpatial`/`withTurn` edits plus an undo-coalescing story plus a decision
about what it does to a node a rule already places — which is a whole step, and
naming it as absent is better than shipping one that fights the solver. Recorded
here as the first thing to build next.

---

## 10. Export

### 10.1 A third target

```ts
export type ExportTarget = "html" | "svg" | "gltf";

export interface TargetSpec {
	// …
	language: "html" | "svg" | "json";   // <- widened
	/**
	 * True when the target only applies to documents of a certain shape — see
	 * {@link availableTargets}. A glTF of a document with no 3D in it is an empty
	 * file, and offering it would be offering a broken button.
	 */
	conditional?: (scene: Scene) => boolean;
}

	gltf: {
		label: "glTF (3D)",
		extension: "gltf",
		mime: "model/gltf+json",
		language: "json",
		conditional: (scene) => viewports(scene).length > 0,
		loses: [
			"Everything outside the 3D view. A glTF is a scene, not a page: the artboard around this viewport, its text, its rectangles and the rest of the document are not in the file.",
			"Behaviour. A glTF has no states: what is here is the one state each instance is drawn in, and the transitions, the triggers and the other states are not in the file.",
			"Materials are approximated. A fill, a roughness and a metalness become one glTF metallic-roughness material; a shadow, a stroke and a corner radius have no meaning on a solid and are dropped.",
		],
	},
```

`ExportOptions` gains:

```ts
	/**
	 * Which viewport to export, for the glTF target. Absent is the first in
	 * document order — a document with one viewport, which is the usual one,
	 * therefore needs no option at all.
	 */
	viewport?: string;
	/** Where a model's bytes come from — see §5.3. Absent exports bounding boxes. */
	assets?: (id: string) => Uint8Array | undefined;
	/** The last frame each viewport rendered, as a data URL, for the HTML target. */
	posters?: Record<string, string>;
```

`export function availableTargets(scene: Scene): ExportTarget[]` — read by
`ExportPanel.tsx`, which today lists `EXPORT_TARGET_NAMES` unconditionally.

### 10.2 What the HTML target does when it meets a viewport

It draws **the box** — the viewport's own fill, radius, stroke and opacity, which
are real properties of a real rectangle and are exactly what shows behind a
transparent scene — and it does not descend. `drawn`-style recursion stops at an
`opaque` kind, one condition, in the one emitter.

Where `options.posters` has an entry for that viewport, the box additionally gets
`background-image: url(<data-url>); background-size: cover`, so the exported page
shows the view rather than a coloured rectangle.

`lost` gains, per viewport, conditionally, in the manner of `GRID_LOST`:

> *“The 3D view “Hero”. HTML and CSS can position and turn a flat box, and this
> file does — but they have no word for geometry, a camera, a light or a
> material, so the 24 objects inside this view are not in it. What is here is the
> view's own box{, with the frame the canvas last drew as its background}. Export
> the viewport as glTF for the scene itself.”*

The brace is the poster clause, present only when there is one.

### 10.3 The glTF target

`packages/design-core/src/gltf.ts` — new file, pure, no three.js.

```ts
/**
 * One viewport's subtree, as glTF 2.0 JSON.
 *
 * Written here rather than through three.js's own `GLTFExporter` for the reason
 * design-core is pure: an exporter that needed a renderer would put WebGL in the
 * dependency graph of a headless test. It is also the smaller job — the document
 * is already a tree of transforms, boxes and materials, which is very nearly
 * what glTF is, and the only real work is tessellating six primitives (see
 * `solid.ts`) and copying an imported buffer through.
 *
 * **Metres**, exactly: 36,000,000 EMU is one metre, so the conversion divides
 * rather than approximates. See {@link metresFromEmu}.
 */
export function exportGltf(
	scene: Scene,
	universe: ExportUniverse,
	viewport: string,
	options: { assets?: (id: string) => Uint8Array | undefined; title?: string },
): { text: string; lost: string[] };
```

The mapping, so nobody has to guess:

| document | glTF |
| --- | --- |
| `viewport` | the `scene`, and its `nodes` array |
| `pivot` | a `node` with children and a TRS, no mesh |
| `mesh` | a `node` + a `mesh` from `tessellate(solid)`, scaled by the box |
| `model` | a `node` + the imported buffer's meshes, or the bounds box |
| `camera` | a `camera` of type `perspective`, `yfov` in **radians** |
| `light` | `KHR_lights_punctual`, which is in `extensionsUsed`; an `ambient` lamp has no punctual equivalent and becomes a very low-intensity `directional` plus a `lost` entry |
| `frame/3` + `spatial` | `translation`, from the box's **centre** |
| `turn` | `rotation`, as a quaternion from the ZYX Euler §2.3 fixes |
| `width/height/depth` | `scale`, applied to the unit-cube tessellation |
| `fill`/`roughness`/`metalness`/`opacity` | one `pbrMetallicRoughness` material |
| `hidden` | the node is simply not emitted |

Conditional `lost` entries:

- an ambient light (above);
- a model whose bytes were not supplied (§5.3);
- a mesh whose fill resolved to something that is not a colour;
- **a machine on any node in this viewport**:
  > *“Behaviour. State “hover” repaints “Cube”, and a glTF holds one scene: what
  > is in the file is the state each instance is drawn in.”*

### 10.4 CSS 3D transforms — where the line falls, exactly

This is a real partial answer and it gets a real implementation, and the line is
the `viewport` kind:

**Outside a viewport**, a node with a `z` or a `turn` exports as genuine CSS,
losing nothing:

```css
.n7 {
	transform: translate3d(0px, 0px, 24px) rotateZ(15deg) rotateY(30deg) rotateX(0deg);
	transform-origin: center center;
}
.n3 { transform-style: preserve-3d; }   /* every ancestor up to the surface */
.n1 { perspective: 1200px; }            /* the nearest surface, from PROPS.perspective */
```

Written in `geometry()` beside the `left`/`top`/`width`/`height` it already
writes. The order is §2.3's order, written left to right, which is what CSS
composes in that order. `transform-origin: center` is what makes it the same
rotation the canvas and the solver agreed about.

**Inside a viewport**, nothing of the sort is emitted, whatever a node's
transform is — because its siblings are meshes and lights, and a `preserve-3d`
subtree of empty divs is not a partial answer to a 3D scene, it is a wrong one.

That is the line, and it is the second reason the `viewport` kind earns its
place: without it, the exporter would have to decide per node whether the CSS
answer was good enough, and there is no honest way to make that judgement one
node at a time.

The `svg` target gains one unconditional sentence in `EXPORT_TARGETS.svg.loses`:

> *“Three dimensions. An SVG is flat: a node with a z or a turn is drawn in the
> place its untransformed box occupies, and a 3D view is drawn as its own
> rectangle.”*

### 10.5 `ExportResult.lost`, collected

Added conditionally, in `GRID_LOST`'s manner:

1. one per viewport, HTML target — §10.2;
2. one per model with no bytes, glTF target — §5.3;
3. one per ambient light, glTF target — §10.3;
4. one per machine touching a viewport's subtree, both targets — §12.5;
5. one for the whole document, HTML target, when any node outside a viewport is
   turned:
   > *“A turned box is drawn by the browser and hit-tested by its untransformed
   > rectangle, here and on the canvas both — so a click near a corner of “Card”
   > may land on it where there is nothing drawn.”*

---

## 11. The CONTRACT text to add

Insert into `CONTRACT` in `compile.ts` **immediately after** the `% Scene.`
section (the paragraph ending with the three-by-three grid worked example, and
the sentence about `visible/1` being projected) and **before** `% Constraints,
as facts.`. Nothing already in the block is deleted; three existing lines gain a
clause, listed after.

````
% Three dimensions. A mesh, a camera and a light are nodes. Not a parallel
% document, not a special case, not a renderer with its own model: node/1 with a
% kind/2, a child/2, an order/2, a visible/1 and a frame/3, exactly like a
% rectangle. So they are in the layer list, they are selectable, a rule can name
% one, one can be hidden, and each takes part in the multiverse — and none of
% that had to be built, because none of it asks what a node is.
%
% They hang inside a viewport, which is a flat rectangle on the artboard that
% contains a scene and names the camera looking at it. That is the seam: above
% it, this is the same 2D tool it was; below it, there is a third axis.
%
%   kind(N, viewport|pivot|mesh|model|camera|light)
%   looks(V, C)                    V looks through camera C
%   vcam(V, C)                     derived: ...and C really is a camera in V
%   tris(N, K)                     model N holds K triangles. Emitted so you can
%                                  hold an opinion about it:
%                                    viol(mesh_budget) :- tris(_,K), K > 200000.
%   spatial                        this document has a third axis at all
%   s3(N)                          derived: N is in it — a viewport, anything
%                                  under one, or anything the document gave a z,
%                                  a depth or a turn
%
% The third axis is the same frame/3 you already have, with two more dimensions
% in it. Nothing about the predicate changed:
%
%   frame(N, z|depth, Emu)         only for an s3 node, and only in a document
%                                  that has a third axis. gaxis/1 and gspan/1
%                                  grow to hold them behind `spatial`, so every
%                                  rule below — the pull, the world chain, the
%                                  edge equation, gcoord/2 — covers three axes
%                                  with no line of its own, and a flat document
%                                  grounds not one atom of it
%   gedge(front|centerZ|back, z, pos)   gplace as usual: lead, mid, trail
%   gedge(depth, z, span)   gedge(z, z, axis)
%
% Rotation is held per axis, in **thousandths of a degree**, about the node's
% own centre:
%
%   mdeg(Lit, Mdeg)                the ANGLE a literal reads as: "45deg" is
%                                  45000 and "0.25turn" is 90000 too. Exact or
%                                  absent — "1rad" is 57295.779... thousandths,
%                                  so it emits nothing at all, and a bare number
%                                  is refused except for 0
%   rval(N, rotateX|rotateY|rotateZ)     the variable a rotation is, so an
%                                  `angle` token with two alternatives is the
%                                  flat design and the tilted one
%   t_value(N, R, Lit)             derived: resolved(rval(N,R)) — projected, so
%                                  two rotations really are two designs
%   turn(N, R, Mdeg)               derived: how far, this universe. 0 where the
%                                  document says nothing
%   grotated(N)                    derived: some rotation of N is not zero
%
% AND HERE IS THE LIMIT, WHICH YOU HAVE TO KNOW. clingo-lpx decides LINEAR
% arithmetic. A turned box's extent on an axis is |w*cos t| + |h*sin t|, and its
% left edge is its centre less half of that. That is trigonometry: there is no
% encoding of it here, and there is not going to be one. So on a node with any
% non-zero rotation:
%
%   HONEST   centerX, centerY, centerZ   a turn about the centre does not move
%                                        the centre
%   HONEST   width, height, depth        a span is the node in its own frame,
%                                        and turning a card does not widen it
%   REFUSED  left, right, top, bottom, front, back
%                                        the box's face is not where the pixels
%                                        are, and ge(N,left) would be a number
%                                        about a rectangle you do not have
%
%   gnoedge(N,E) :- grotated(N), gedge(E,_,pos), gplace(E,lead).
%   gnoedge(N,E) :- grotated(N), gedge(E,_,pos), gplace(E,trail).
%
% The quantity is therefore never created and the relation that wanted it goes
% unstated — the same silence gdatum/1 arranges for a span edge on a column
% line, for the same reason and by the same two lines. A rule that quietly means
% nothing beats one that quietly means something else, and the editor is where
% the refusal is made visible: it greys the edge and says why. `align ... on
% centerX` is the offer it makes instead, and for most uses of `align` it is
% what was meant.
%
% What is *not* refused is placing a turned node. Rotation about the centre
% commutes with translation, so gsolved/1, the pull, the world chain and a pin
% on a centre all work on one exactly.
%
% An imported mesh is a node and its vertices are not. The same trade a path
% makes — points live on the document node and never reach here — one scale up:
% the frame is the geometry's bounding box, so snapping, layout, constraints and
% grouping all work on a model unchanged, and the only fact about the payload
% that reaches a rule is tris/2.
````

Three existing lines gain a clause:

- Under **Scene**, `frame(N, x|y|width|height, Emu)` gains: `"…and z|depth in a
  document with a third axis, for the nodes that are in it — see Three
  dimensions below"`.
- Under **Units**, the ceiling paragraph gains: `"The third axis adds no
  coefficient to any right-hand side — z is a pos and depth is a span, so both
  flow through the equations the planar four already do — so the 2^31/4 limit is
  unchanged. An angle has its own, much smaller one: ten turns."`
- Under **Constraints**, `gedge(E, x|y, pos|span|axis)` becomes
  `gedge(E, x|y|z, pos|span|axis)` and gains `"…the z rows only in a document
  with a third axis"`.

---

## 12. What a machine state may do to a 3D node

Written for track B, which may rely on every sentence here.

### 12.1 Appearance: free, and already works

`StatePart.props` is `Partial<Record<PropName, Value>>` and the new properties
are ordinary `PropName`s, so a state may change a mesh's `fill`, `roughness`,
`metalness` and `opacity`, a light's `ink` and `intensity`, a camera's `fov`,
`near` and `far`, and a mesh's `solid`. `sprop/4`, `mshadow/2` and the
`rendered/3` alias carry all of it with **no change to any machine rule**. A
hover that warms the key light is authored today's way and costs nothing new.

### 12.2 Geometry: one type widening, no new rules

```ts
export interface StatePart {
	props?: Partial<Record<PropName, Value>>;
	/** Now over all six — see §2. */
	frame?: Partial<Record<Axis3, Value>>;
	/** New: how this state turns the part. */
	turn?: Partial<Record<Turn, Value>>;
	hidden?: true;
}
```

The `frame` widening is **free in ASP**. `sfval(I,S,N,D)` and `mfshadow(I,N,D)`
already take any `D`; the copy rules read `mbase(I,N,D,V)` which reads `frame/3`
which now carries six; and the copy's own default rule
`frame(stt(I,S,N),Z,0) :- mcopy(I,S,N), gspan(Z)` picks up `depth` the moment
`gspan(depth)` holds. The only change is the compiler iterating `DIMENSIONS_3D`
where it iterates `DIMENSIONS`, guarded by `isSpatialScene`.

> **AMENDED, twice.**
>
> **It is not free, and "picks up `depth` the moment `gspan(depth)` holds" is the
> bug, not the feature** (merged-plan §4). That rule picks `depth` up for *every*
> state copy in the document, including the flat button on page one, the moment a
> viewport appears anywhere — which is the very thing §3.2 narrowed the scene
> defaults to prevent, leaving `inst(I,N)` flat and `stt(I,S,N)` three-dimensional
> with an alias joining them. The two lines become four, guarded on
> `s3(stt(I,S,N))`; merged-plan §4 has the text and the argument that
> `s3(stt(...))` costs no new rule.
>
> **And the widened iteration is not the only change.** `rive-ladder-spec.md` §4.5
> narrows the `frame(inst(I,N),D,V)` alias by `mfwriter(M,L,N,D)`, derived from
> `mlfshadow(M,L,N,D)`, which the compiler emits by iterating the *same* list. If
> `mfshadow` iterates six and `mlfshadow` iterates four, a state that lifts a mesh
> in z moves the copy and never reaches the picture — in a document that solves
> cleanly and reports nothing. Merged-plan §6.1.

### 12.3 Rotation: three new rules, and they are the whole of it

New variable `srval(I,S,N,R)` (`stateTurnVar` in `machines.ts`), new fact
`mrshadow(I,N,R)`, and in `MACHINE_RULES`, immediately after the `sfval` block
and written to the same shape:

```prolog
#defined srval/4.
#defined mrshadow/3.
% A rotation the state says nothing about is the instance's own, shared by every
% state — the invariant, one quantity over. Minting a copy of a two-alternative
% angle per state would be 2^N designs where the document holds two.
turn(inst(I,N),R,V) :- mbase_turn(I,N,R,V), not mrshadow(I,N,R).
turn(stt(I,S,N),R,V) :- mcopy(I,S,N), mbase_turn(I,N,R,V), not msrval(I,S,N,R).
turn(stt(I,S,N),R,V) :- mcopy(I,S,N), resolved(srval(I,S,N,R),L), mdeg(L,V).
msrval(I,S,N,R) :- resolved(srval(I,S,N,R),L), mdeg(L,_).
% The copy's own default, in the shape the frame default is in, written so it
% cannot unsay itself.
mturned(I,S,N,R) :- turn(stt(I,S,N),R,V), V != 0.
turn(stt(I,S,N),R,0) :- mcopy(I,S,N), gturn(R), not mturned(I,S,N,R).
% And the alias: the shown state is what the instance *is*.
turn(inst(I,N),R,V) :- turn(stt(I,S,N),R,V), shown(I,S).
```

with `mbase_turn(I,N,R,V) :- instance(I,R0), cinner(R0,N), turn(N,R,V).` beside
`mbase/4`, and for the same reason: a rule cannot read its own head.

> **AMENDED (merged-plan §6.3).** `mbase_turn/4` and the first of the three rules
> above — `turn(inst(I,N),R,V) :- mbase_turn(I,N,R,V), not mrshadow(I,N,R).` —
> are **component** rules wearing a machine's clothes, and putting them in
> `MACHINE_RULES` leaves rotation broken on every document with a rotated
> component and no machine: the definition turns, both instances of it do not.
> They move to `COMPONENT_RULES`, beside `mbase/4`, and the predicate is renamed
> `tbase/4` for what it is. `#defined mrshadow/3.` keeps the guard grounding away
> where there is no machine, exactly as the `mshadow` guard on `rendered/3` does.
> The remaining rules here are unchanged but read `tbase/4`.
>
> **And the alias needs a writer guard under layers**, which did not exist when
> this section was written: two layers that both turn one part would derive two
> `turn/3` atoms for one `(node, axis)`, which — in `rive-ladder-spec.md` §4.4's
> own words about `rendered/3` — is not two designs but one arbitrary answer,
> silently. `mlrshadow/4`, `mrwriter/4` and `mrfight/5` are in merged-plan §6.4,
> and `machine_layers_agree` gains a third disjunct.
>
> **`stateTurnVar` / `srval` is added by `machines.ts`'s owner**, not by this
> track: §13 below forbids this track from touching that file and then asks for a
> symbol in it. Merged-plan step M5 supplies it.

### 12.4 What a state may not do

The existing rule — *a state changes appearance, geometry and presence, never
structure* — extends exactly:

- **no changing `SceneNode.mesh`.** Swapping imported geometry per state is a
  second document per state, which is the design the feature exists not to be.
  Changing `solid` between two *primitives* is a property and is allowed, which
  is the line: a primitive is a value, a payload is a file.
- **no changing which camera a viewport looks through.** `looks/2` is a fact
  about the view, not about a state of a component, and a state that moved the
  camera would move it for every instance of the definition at once.
- **no changing a node's kind, its children or its parent**, as before.

### 12.5 What the export loses

- **HTML**: a machine that touches anything inside a viewport gets one `lost`
  entry naming it, because the CSS path cannot animate a mesh. The machine's
  *other* states still export for every node outside the viewport, so a
  hover that both darkens a button and spins a cube exports half of itself and
  says which half.
- **glTF**: one scene, one state — the shown one — and the sentence in §10.3.
- **Playback on the canvas costs no solve**, exactly as before: every state's
  `frame`, `turn` and `rendered` are in the one answer set, `ModelState` carries
  `solid` and `turn` (§7.4), and `SceneTree.tsx` reads the played copy the same
  three-lookup way `Artboard.tsx` already does.

---

## 13. File ownership

> **SUPERSEDED — use `docs/merged-plan.md` §3.3.** The table below is kept for
> its per-step *content*, which is still the contract for what gets built; its
> *ownership* is void, because nine of these files are also claimed by
> `docs/rive-ladder-spec.md` and two agents cannot edit one file. The merged
> table folds each contested file into one step with one owner, and fixes the
> order: **this track's `compile.ts` step lands before the ladder's**, because it
> widens the vocabulary tables every machine rule quantifies over.
>
> Two rows here are wrong on their own terms as well: step 2 must also widen
> `StatePart.frame` to `Axis3` and add `StatePart.turn` **and teach
> `stateTouches` about it**, and step 12's claim on `Constraints.tsx` collides
> with the ladder's L15.

**Touch only the files your step owns.** Other agents edit other files in this
same working tree; editing a file you do not own loses their work and breaks the
build. A step that needs a symbol another step owns writes against the signature
in this document and does not go and add it.

| # | Step | Owns |
| --- | --- | --- |
| 1 | **The fifth quantity and the no-regression harness** — `ValueType "angle"`, `Quantity "angle"`, `VALUE_TYPES.angle/solid/lamp`, `mdegOf`, `nearestMdeg`, `writeAngle`, `MAX_MDEG`, `isAngleType`, `rotateVar`, the `parseVariable` `rval` case; and the §0 regression test | `packages/design-core/src/values.ts`, `values.test.ts`, `packages/design-core/src/flat.test.ts` (new) |
| 2 | **The document types** — the six kinds, `KindSpec.spatial`/`opaque`, the eight props, `Spatial`, `Axis3`, `SPATIAL_DIMS`, `SpatialValue`, `Turn`, `TURNS`, `TurnValue`, the five edges, `makeSpatial`, `spatialOf`, `spatialDim`, `withSpatial`, `spatialFrozen`, `turnOf`, `turnMdeg`, `isTurned`, `rotationFrozen`, `edgeOptions`, `MeshRef`, `AssetInfo`, `Scene.assets`, the four `SceneNode` fields, `emptyScene` | `packages/design-core/src/scene.ts`, `packages/design-core/src/geometry.ts` (the two types only) |
| 3 | **The readings** — the whole of `spatial.ts` and `solid.ts`, `assets.ts`, and `index.ts` | `packages/design-core/src/spatial.ts` (new), `spatial.test.ts` (new), `solid.ts` (new), `solid.test.ts` (new), `assets.ts` (new), `index.ts` |
| 4 | **The program** — `spatial.`/`zstated/1`/`looks/2`/`tris/2`/`asset/2` emission, `mdeg/2`, the gate rules, the narrowed scene defaults, the rotation rules, the two `gnoedge` rules, the guarded `EDGE_FACTS`, the `#show`/`#project` block, `variableCounts`, and the CONTRACT text | `packages/design-core/src/compile.ts`, `packages/design-core/src/spatialprogram.test.ts` (new) |
| 5 | **Reading it back** — `ModelNode.solid`/`.turn`, `ModelState.solid`/`.turn`, `ModelScene.triangles`/`.looks`, `boxOf3`, the `collect` cases, `readSolved`'s widened axis table | `packages/design-core/src/model.ts`, `model.test.ts` |
| 6 | **The document reader** — `normalizeScene` per §7.5 | `packages/design-core/src/project.ts`, `project.test.ts` |
| 7 | **The edits** — every signature in §7.3, plus `pruneAssets` from `deleteNodes` | `packages/design-core/src/edits.ts`, `edits.test.ts` |
| 8 | **The way out** — `"gltf"`, `availableTargets`, `conditional`, the HTML target's opaque stop and poster, the CSS-3D `transform`/`perspective`/`preserve-3d` emission, the SVG sentence, the conditional `lost` entries | `packages/design-core/src/export.ts`, `export.test.ts` |
| 9 | **The glTF writer** — `exportGltf`, `metresFromEmu`, `METRE_IN_EMU` | `packages/design-core/src/gltf.ts` (new), `gltf.test.ts` (new) |
| 10 | **The 3D renderer** — the whole of `packages/canvas-3d`, and the app's dependency entry | `packages/canvas-3d/**` (new), `packages/app/package.json` |
| 11 | **The canvas seam and picking** — the `CONTENT` entry and the fourth argument, `opaque` in `hitTestTree`/`frameAt`/`dropTargetAt`/`placedNodes`, `entered`, the double-click gesture, `useViewportBudget` | `packages/app/src/design/Artboard.tsx`, `packages/app/src/design/Editor.tsx`, `packages/design-core/src/tree.ts`, `tree.test.ts`, `packages/app/src/design/useViewportBudget.ts` (new) |
| 12 | **The panels** — the 3D inspector rows (six dimensions, three rotations, material, lamp, lens), the "look through" menu, the import affordance, the refused-edge marks in the Rules panel, the budget in the status line, the target list | `packages/app/src/design/Inspector.tsx`, `Constraints.tsx`, `StatusLine.tsx`, `ExportPanel.tsx`, `ShapePicker.tsx`, `packages/app/src/projects/assets.ts` (new) |

Files nobody owns and nobody may touch: `units.ts`, `components.ts`,
`machines.ts` (track B owns it), `measure.ts`, `derived.ts`, `explore.ts`,
`why.ts`, `relax.ts`, `annotate.ts`, `paint.ts`, `packages/canvas/**`,
`packages/canvas-core/**`, `LayerList.tsx`, `Studio.tsx`. The design is arranged
so that none of them needs to change — **`InfiniteCanvas.tsx` in particular, which
is the whole point of §8.3.** If one of them does need to change, that is a
finding to report, not an edit to make.

Note the two departures from the state-machine spec's ownership table, both
deliberate: this track **does** own `tree.ts` (the `opaque` stop) and
`Editor.tsx` (entering a viewport). Neither is owned by any machine step, so
there is no conflict, but a reader coming from that document should know.

---

## 14. Tests each step must write

Colocated `*.test.ts`, `node:test` plus `node:assert/strict`, and **through the
real compiler and solver** wherever the claim is a claim about the program.
`machineprogram.test.ts` and `components.test.ts` are the models to follow.

**Step 1 — `values.test.ts`**
1. Every row of §6.5's table, as one parameterised test.
2. `mdegOf` refuses everything `emuOf`, `tallyOf`, `numeralOf` and `msOf` accept,
   and vice versa, on `"200px"`, `"200ms"`, `"200"`, `"1.35"`, `"45deg"`,
   `"0.25turn"` — the five quantity readers do not overlap.
3. `nearestMdeg("1.0005deg")` is 1001 and `mdegOf("1.0005deg")` is nothing.
4. `writeAngle(mdegOf("0.25turn")!, "turn")` is `"0.25turn"` — an angle keeps its
   unit across an edit, exactly as a length does.
5. `mdegOf` refuses `MAX_MDEG + 1` in both signs.
6. `parseVariable(rotateVar("n7","rotateY"))` reads back; `parseVariable` still
   reads nothing from `mval`, `sprop`, `sfval`, `spart`.

**Step 1 — `flat.test.ts` (the no-regression harness, owned here so it exists first)**
7. For every template: universe count, `readModel` deep-equality and
   `exportUniverse(...).text` byte-equality against a golden captured before the
   track lands.
8. A flat document's atoms contain no `gedge(front`, `gaxis(z`, `frame(_,z,`,
   `turn(`, `spatial`, `s3(`.

**Step 2 — no test file of its own.** Tables and types; steps 3 and 4 exercise
them. Three assertions belong to step 3: every `KINDS` entry has both new
columns; `viewport` is the only `opaque` kind; and every `EDGES` row with
`axis: "z"` has a planar twin with the same `role` and `place`.

**Step 3 — `spatial.test.ts`**
1. `isSpatialScene` is false for every template and true for a document with one
   viewport, and true for a flat document with a single `rotateZ` on a rect.
2. `viewportOf` finds the viewport for a mesh three levels down and nothing for a
   rect on an artboard.
3. `cameraOf` returns nothing for a dangling id, for an id naming a rect, and for
   a camera in a *different* viewport.
4. `boxOf` of a node with no `spatial` is the frame with z 0 and depth 0.
5. `materialOf` clamps a roughness of `"2"` to 1 and of `"-1"` to 0; `lampOf`
   clamps a negative intensity to 0; `lensOf` refuses a `far` below `near` by
   returning the fallback pair and nothing else.
6. `refusedEdge` refuses `left` on a node turned 30° about Y, allows `centerX`
   and `width` on the same node, and allows `left` once the turn is cleared.
7. `refusedEdge` allows `left` on a node whose only turn resolves to `"0deg"` —
   the refusal is about the *value*, not about the field being present.
8. `inertConstraints` finds a `gap` over a turned member and does not find the
   `symmetric` beside it.
9. `spatialBudget` totals triangles over two models and lists a hash the asset
   index has not got.

**Step 3 — `solid.test.ts`**
10. `tessellate("box")` is 12 triangles, 36 indices, and every position is within
    [-0.5, 0.5] on every axis.
11. Every one of the six tessellates without throwing, has `indices.length % 3 === 0`,
    and has one normal per position.
12. `tessellate("sphere")`'s vertices are all within 1e-6 of the unit sphere.
13. An unknown solid falls back to `box` rather than throwing — the same reading a
    dangling word gets everywhere else.

**Step 4 — `spatialprogram.test.ts` (all against `directSolver`)**
1. **The gate.** A document with no viewport grounds no `gaxis(z)`, no
   `frame(_,z,_)`, no `gedge(front,...)` — asserted as a scan over the atoms.
2. A document with one viewport grounds `frame(N,z,0)` and `frame(N,depth,0)` for
   every node *inside* it and for none outside it.
3. A rect on another artboard in that same document still has exactly four
   `frame/3` atoms.
4. **The invariant.** Adding a viewport with six meshes to a document does not
   change the universe count of the rest of it; adding a `[box, sphere]` to one
   mesh's `solid` doubles it, because that is a `Value` with two entries.
5. `turn/3` follows an `angle` token, is 0 for a node that says nothing, and is
   absent entirely for a node outside the third axis.
6. `#project t_value/3`: a document whose only difference between two universes
   is a rotation enumerates two universes, not one.
7. **The refusal.** `align [meshA, meshB] on left` with `meshA` turned produces
   **no** `ge(meshA,left)` — asserted through `gedgeof/2` and through the absence
   of the equation's effect — and the two meshes' lefts are free.
8. The same document with `centerX` instead is SAT and the two centres coincide
   exactly.
9. `equalSize [meshA, meshB] on width` holds on two turned meshes: a span is
   honest.
10. `pin [mesh] on centerZ` at 100px puts the mesh's centre at 100px in z,
    read out of `__lpx(lv(mesh,z),…)` and `__lpx(lsz(mesh,depth),…)`.
11. `gap [a,b] on z` between two unturned meshes holds, and the same rule with
    `a` turned says nothing at all rather than saying something wrong.
12. The world chain reaches z: a mesh inside a pivot inside a viewport has a
    `wv(mesh,z)` equal to the sum of the three offsets.
13. `mdeg/2` is emitted for `"45deg"` and not for `"45"`; `tally/2` is emitted
    for `"45"` and not for `"45deg"`.
14. `tris/2` and `vcam/2` read back; a `looks` naming a rect derives no `vcam`.
15. `refusedEdge` and `gnoedge/2` agree on every shape tested — the two-readers
    test, run the way `machineHealth`'s is.
16. **Grounding budget.** A viewport with 24 meshes emits exactly `24 × 6`
    `frame/3` atoms for its subtree plus the viewport's own six, and no more.

**Step 5 — `model.test.ts`**
1. `readModel` puts `frame(n,z,V)` in `ModelNode.solid` and leaves `frame`
   four-valued.
2. A flat document's `ModelNode` has `solid` and `turn` both `undefined` —
   asserted with `Object.hasOwn`, so an explicit `undefined` fails too.
3. `turn/3`, `tris/2` and `vcam/2` read back into the three new places.
4. `__lpx(lv(m,z),…)` and `__lpx(lsz(m,depth),…)` land in `ModelState.solid` and
   `ModelNode.solid` by the same precedence a solved x gets.
5. `boxOf3` of a node with no `solid` is the frame plus two zeroes.

**Step 6 — `project.test.ts`**
1. A document with no `assets` reads back with `assets` absent, not `{}`.
2. A `spatial` holding a non-value is dropped; an empty `spatial` record is
   dropped entirely.
3. `turn` is **not** snapped, where a `frame` length is — `"22.5deg"` survives
   `normalizeScene` unchanged.
4. A `camera` naming a deleted node is **kept**.
5. A `mesh` whose hash the asset index does not know is **kept**.
6. A `mesh` node sitting outside every viewport is **kept**.
7. `normalizeScene` is idempotent on a document with a viewport.

**Step 7 — `edits.test.ts`**
1. `addViewport` produces a viewport with exactly one camera and one light in it,
   and the viewport's `camera` names that camera.
2. `addMesh` into a non-viewport is a no-op.
3. `setViewportCamera` on a node that is not a camera is a no-op; with `null` it
   clears the field rather than writing an empty string.
4. `clearTurn` removes the `turn` record entirely when the last entry goes.
5. `deleteNodes` of the last model referencing an asset drops it from
   `scene.assets`; deleting one of two does not.
6. A constraint naming a mesh survives `deleteNodes` of an unrelated node and is
   dropped when the mesh goes — the ordinary path, asserted so the claim in §7.3
   that nothing had to change is a tested claim rather than an assumption.
7. Every edit returns the same scene object when nothing changed.

**Step 8 — `export.test.ts`**
1. A document with no viewport exports **byte-identical** output to before, in
   both targets.
2. `availableTargets` omits `gltf` for a flat document and includes it for one
   with a viewport.
3. The HTML target draws a viewport's box with its fill and does **not** emit any
   element for the meshes inside it, and `lost` names the view by name and counts
   the objects.
4. With a poster, the box gets a `background-image` and the `lost` sentence gains
   its clause.
5. A `rect` with `z: 24px` and `rotateY: 30deg` outside a viewport emits
   `translate3d(0px, 0px, 24px) rotateZ(0deg) rotateY(30deg) rotateX(0deg)`, a
   `transform-origin: center center`, `preserve-3d` on each ancestor up to the
   surface, and `perspective` on the surface.
6. The same node **inside** a viewport emits none of that.
7. The turned-box hit-testing sentence appears once for a document with three
   turned nodes, not three times.
8. The SVG target gains its sentence and draws a viewport as a plain rectangle.
9. A themed collapse and a viewport compose: the media query and the viewport's
   box are both in the file.

**Step 9 — `gltf.test.ts`**
1. `JSON.parse(exportGltf(...).text)` succeeds and has `asset.version === "2.0"`.
2. A viewport with one 100px box produces one mesh whose `scale` is
   `[100/36000000·9525, …]` — i.e. the box's EMU size through `metresFromEmu`,
   asserted exactly rather than approximately.
3. `metresFromEmu(METRE_IN_EMU)` is exactly 1, and `METRE_IN_EMU` is 36,000,000.
4. A turned node's `rotation` quaternion, converted back to ZYX Euler, is the
   document's three angles to within 1e-9.
5. A camera exports `yfov` in radians equal to `fov` in degrees times π/180.
6. An ambient light exports as a directional one **and** adds its `lost` entry.
7. A model with no bytes supplied exports as its bounds box and adds its `lost`
   entry; with bytes supplied, the buffer is in `buffers` as a data URI.
8. A hidden node is absent from `nodes` entirely.
9. A machine in the viewport's subtree adds the behaviour `lost` entry once.

**Step 10 — `packages/canvas-3d`.** No test runner in this package (it is React
and WebGL). It verifies by `pnpm turbo run typecheck`, and it owns two pure
modules that step 3's runner can reach if it wants them — `units3.ts` gets its
assertions in `spatial.test.ts` instead:
1. `worldFromEmu(EMU_PER_PX)` is 1; `emuFromWorld(worldFromEmu(n))` is `n` for a
   whole number of EMU.
2. `radFromMdeg(180000)` is π.
3. `worldPoint` negates y and z and centres the box — asserted on a box at
   (10,20,30) sized 40×50×60.

**Step 11 — `tree.test.ts`**
1. `hitTestTree` over a point inside a viewport returns the **viewport**, not the
   mesh under the pointer.
2. `frameAt` over the same point returns the artboard, not the viewport — a drop
   never lands inside a 3D scene.
3. `dropTargetAt` likewise.
4. `placedNodes` still returns every node including the ones inside a viewport,
   because the layer list and the exporter both need them — only the *hit
   testers* stop.
5. A flat document's `hitTestTree` answers are unchanged, asserted against the
   existing cases.

**Step 12 — app panels.** No test runner; verifies by `pnpm turbo run typecheck`
and by the DOM contract the existing panels keep: every interactive element
carries a `data-role`, and the new ones are `add-viewport`, `add-mesh`,
`add-camera`, `add-light`, `add-model`, `look-through`, `spatial-z`,
`spatial-depth`, `turn-x`, `turn-y`, `turn-z`, `solid-picker`, `lamp-picker`,
`enter-viewport`, `leave-viewport`, `refused-edge`, `inert-rule`,
`relink-asset`, `mesh-budget`.

---

## 15. Review checklist — what a reviewer checks before merging any step

1. Does the change put a 3D object anywhere but in `node/1` / `kind/2` /
   `child/2` / `order/2` / `visible/1` / `frame/3`? If so it is wrong, whatever
   else it does — there is to be no parallel 3D document model.
2. Does any part of the third axis ground in a document with no viewport in it?
   Everything new is behind `spatial`, and step 1's `flat.test.ts` is the arbiter.
3. Does it widen `Dimension`, `FrameValue`, `Frame`, `makeFrame` or `frameOf`?
   Those five stay four-valued; §2.1 says why.
4. Does it let the solver constrain a *face* or an *extent* of a rotated node? If
   so it is stating something that is not true; see §4.
5. Is a refusal invisible? A refusal a designer cannot see is worse than the
   wrong answer it replaced — `refusedEdge` and `inertConstraints` exist so that
   never happens, and a panel that silently greys a row has not finished the job.
6. Does anything in `design-core` import `three`, `@react-three/*`, `react`, or
   touch the DOM? Invariant 3.
7. Does anything in `packages/app` import `three` or `@react-three/*` directly?
   It goes through `canvas-3d`.
8. Was `packages/canvas/src/InfiniteCanvas.tsx` edited? It must not be — §8.3.
9. Does a comment argue *why*, including what was considered and rejected? A
   terse one-liner reads as foreign here — see `components.ts`, `model.ts` and
   `machines.ts`.
10. Do local imports carry the explicit `.ts` extension?
11. Is the claim about the program tested through the real compiler and solver
    rather than through a hand-written atom list?
12. Is a stub reported as a stub? A `ViewportCanvas` that typechecks and draws
    nothing is scaffolding, and calling it the renderer is the worst outcome
    available to this track.
