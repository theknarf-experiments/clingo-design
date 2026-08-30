/**
 * The third axis, read off the document.
 *
 * This file is to a viewport what `tree.ts` is to an artboard: the walk, the
 * chain of transforms, and the one honest refusal at the end of it. Everything
 * here is a pure reading of a {@link Scene} against one universe's picks —
 * nothing compiles, nothing solves, nothing renders, and nothing imports
 * three.js. That is invariant 3, and it is also the only reason the interesting
 * arithmetic below can be checked by `node --test` with no browser in the room.
 *
 * The sentence the whole file rests on, from `docs/three-d-spec.md` §0:
 *
 * **A mesh, a camera and a light are ordinary scene nodes.** They have a
 * `kind`, a `frame`, a place in `children`, an `order` and a `visible`, they
 * appear in the layer list, a rule can name them, and they take part in the
 * multiverse. So this file adds no model of its own. It adds *readings*: which
 * nodes are in the third axis, what a viewport contains, which camera looks
 * through it, where a node ends up once its ancestors have had their say, and
 * the box it occupies — where a box is a thing that can honestly be said.
 *
 * Three decisions shape almost everything below.
 *
 *   - **The seam is a `viewport`.** Above it the document is the flat tool it
 *     has always been; below it there is a third axis and a camera. So most of
 *     the questions here are asked *relative to a viewport* rather than
 *     absolutely, and the pair {@link worldMatrixOf} / {@link sceneMatrixOf} is
 *     that distinction made into two functions rather than a boolean argument.
 *   - **Rotation is about the node's own centre**, which is what keeps every
 *     centre and every span an exact linear quantity on a turned node — see
 *     {@link TURNS}. It is also what makes the matrix chain here composable
 *     without ever needing a shear or a general affine inverse: every local
 *     transform is a rotation about a point followed by a translation.
 *   - **A turned node has no axis-aligned box**, and this file says so out loud
 *     rather than returning a plausible one. {@link axisBounds} refuses, and
 *     {@link refusedBounds} is the sentence a panel shows. That is the same
 *     shape `gnoedge/2` uses in the generated program and for the same reason:
 *     a number that quietly means something else is worse than no number.
 *
 * **Every length here is EMU** — see `units.ts` — with exactly two exceptions,
 * both named for it. A rotation is in thousandths of a degree, because that is
 * what the document stores and what `turn/3` carries. And the renderer
 * conversions at the bottom of the file cross into CSS pixels and radians,
 * which is the one boundary in this package where a float is the right answer.
 */
import { type Frame, type Point } from "./geometry.ts";
import {
	type Scene,
	type SceneNode,
	type Spatial,
	type Turn,
	TURN_NAMES,
	frameOf,
	isTurned,
	spatialDim,
	turnOf,
} from "./scene.ts";
import { ancestorsOf, findInTree, flatten } from "./tree.ts";
import { type Emu, EMU_PER_PX, cssPxFromEmu, emuFromCssPx } from "./units.ts";
import type { ResolveContext } from "./values.ts";

/**
 * What a reading resolves against when the caller has no universe in mind — the
 * first alternative of everything, which is what an unsolved preview shows.
 *
 * The same constant `tree.ts` and `scene.ts` each keep privately, and kept
 * privately again here for their reason: every entry point below takes a real
 * one, and a shared exported default would be a third thing to remember to pass.
 */
const NO_CONTEXT: ResolveContext = { tokens: [], picks: {} };

/**
 * Six numbers in EMU: a {@link Frame} and its third axis.
 *
 * **Local and unexported on purpose, and this is a note about ordering rather
 * than about design.** `docs/merged-plan.md` §2 gives this type to
 * `geometry.ts` as `Box = Frame & SpatialFrame`, owned by step M2, which has
 * not landed at the time this file was written. Exporting a second `Box` from
 * here would put two of them in the barrel and make the day M2 lands a merge
 * rather than a deletion.
 *
 * It is spelled structurally so that the two are **mutually assignable the
 * moment M2 exists**: `Record<Spatial, number>` is exactly `SpatialFrame`, so
 * every signature below already accepts and returns M2's type, and the change
 * when it arrives is this alias becoming `import type { Box } from
 * "./geometry.ts"` plus an `export type { Box }` if the barrel wants one.
 * `scene.ts`'s `spatialOf` spells its return the same way for the same reason.
 */
type Box = Frame & Record<Spatial, number>;

/**
 * A point in three dimensions, in EMU — the third axis's answer to
 * {@link Point}.
 *
 * Here rather than in `geometry.ts` beside `Point` because `geometry.ts` is
 * axis-aligned rectangle maths for a two-dimensional pointer and is staying
 * that way; a caller of this type is holding a coordinate that came out of a
 * matrix, and the matrices live here.
 */
export interface Point3 {
	x: number;
	y: number;
	z: number;
}

/* ------------------------------------------------------------------ */
/* What is in three dimensions                                         */
/* ------------------------------------------------------------------ */

/**
 * True when this document has a third axis at all — the TypeScript twin of the
 * `spatial.` fact the compiler emits.
 *
 * **The entire no-regression promise is this one question.** With no `spatial.`
 * the generated program's third-axis rules ground away, `gaxis/1` and `gspan/1`
 * stay the two-and-two they have always been, no node gains a `frame(N,z,0)`,
 * and a flat document is byte-for-byte the document it was. So this reader and
 * the compiler's gate have to agree exactly, and the definition is copied from
 * `docs/three-d-spec.md` §3.1 rather than improved on: **one `viewport` node, or
 * one node holding a `spatial` or a `turn` entry.**
 *
 * Two things it deliberately does *not* count, both of which look like they
 * should:
 *
 *   - a `mesh`, `camera` or `light` sitting on a plain artboard with no z, no
 *     depth and no turn. It is a node nothing renders and nothing measures, and
 *     it is exactly what dragging a mesh out of a viewport in the layer list
 *     leaves behind — see `docs/three-d-spec.md` §7.5, which keeps it and says
 *     nothing about it.
 *   - an empty `spatial: {}` or `turn: {}` record. `normalizeScene` drops those
 *     so that "flat" has one spelling, but a document may arrive from anywhere,
 *     and a record with no keys in it states nothing.
 *
 * When step M7 widens the gate, this widens with it, and the test that holds
 * them equal is M7's — the same arrangement `machineHealth` and `munreached/2`
 * have.
 */
export function isSpatialScene(scene: Scene): boolean {
	return flatten(scene.nodes).some(
		(node) =>
			node.kind === "viewport" ||
			Object.keys(node.spatial ?? {}).length > 0 ||
			Object.keys(node.turn ?? {}).length > 0,
	);
}

/** Every viewport in the document, in paint order. */
export function viewports(scene: Scene): SceneNode[] {
	return flatten(scene.nodes).filter((node) => node.kind === "viewport");
}

/**
 * The viewport a node is inside, or nothing.
 *
 * **A strict ancestor**, so a viewport is not inside itself, and that is a
 * decision rather than an off-by-one. A viewport is a rectangle *on the page*:
 * it is placed, sized, snapped and laid out in artboard coordinates like any
 * other rectangle, and only what it contains is three-dimensional. Answering
 * "itself" here would put a viewport into its own model space and make
 * {@link sceneMatrixOf} claim a view sits inside the view it is.
 *
 * The **nearest** such ancestor, for the ordinary reason: a viewport nested in
 * another viewport is a strange document but a legal one, and the inner one is
 * the model space its contents are actually measured in.
 */
export function viewportOf(scene: Scene, id: string): SceneNode | undefined {
	const trail = ancestorsOf(scene.nodes, id);
	for (let i = trail.length - 1; i >= 0; i--) {
		if (trail[i].kind === "viewport") return trail[i];
	}
	return undefined;
}

/**
 * Everything a viewport contains, in paint order, excluding the viewport
 * itself.
 *
 * The whole subtree rather than the direct children, because that is the
 * question every caller actually has: the renderer mounts all of it, the budget
 * counts all of it, and the "look through" menu searches all of it. A caller
 * that wants one level has `viewport.children` already.
 */
export function contentsOf(viewport: SceneNode): SceneNode[] {
	return flatten(viewport.children ?? []);
}

/**
 * True when a node lives in the third axis — the TypeScript twin of `s3/1`.
 *
 * The three clauses of the predicate, in the order the program states them: a
 * viewport is in it, everything beneath one inherits it through `child/2`, and
 * a node the document has lifted, deepened or turned is in it wherever it sits.
 * That last clause is why a `rect` with a `z` on a plain artboard is spatial and
 * a `mesh` with nothing said about it is not — the document decides, not the
 * kind, exactly as {@link SceneNode.spatial} says.
 *
 * **A claim about the document, not about a universe**, and so it takes no
 * context. The compiler's `zstated/1` is emitted from the document before any
 * rule runs, precisely because reading it back out of `frame/3` would close a
 * loop through a negation and leave the program with no stable model. A reader
 * that consulted the picks would answer a different question from the program's
 * and the two would drift apart on exactly the documents where it mattered.
 */
export function isSpatialNode(scene: Scene, node: SceneNode): boolean {
	if (node.kind === "viewport") return true;
	if (Object.keys(node.spatial ?? {}).length > 0) return true;
	if (Object.keys(node.turn ?? {}).length > 0) return true;
	return viewportOf(scene, node.id) !== undefined;
}

/**
 * Every camera inside a viewport, for the "look through" menu.
 *
 * In paint order, which is the order the layer list shows them in, so a menu
 * built from this reads down the panel beside it.
 *
 * The viewport is looked up in `scene` rather than taken on trust, which is what
 * the otherwise redundant first argument is for: a panel holds the node it last
 * rendered from and the document may have moved on underneath it, and a menu
 * built from a stale subtree offers cameras that are no longer there. A node the
 * document does not hold falls back to itself, so a caller working with a
 * subtree it built by hand — which is what a test does — still gets an answer.
 */
export function camerasIn(scene: Scene, viewport: SceneNode): SceneNode[] {
	const live = findInTree(scene.nodes, viewport.id) ?? viewport;
	return contentsOf(live).filter((node) => node.kind === "camera");
}

/**
 * The camera a viewport looks through: what it names, when that really is a
 * camera inside it.
 *
 * The TypeScript twin of `vcam/2`, and it keeps the program's three conditions
 * exactly — the named node exists, it is a `camera`, and it is in this
 * viewport's own subtree. Anything else is **silence rather than repair**: a
 * dangling `camera` id derives nothing the way a dangling `instanceOf` does,
 * and the renderer then frames the subtree itself and the status line says so.
 * That is what makes deleting a camera leave a legal document.
 *
 * It deliberately does **not** consult `hidden`. Hiding a camera means "stop
 * drawing the camera's marker", never "stop looking" — a layer that hid a
 * camera must not blind the view it is the eye of. `docs/merged-plan.md` §6.4
 * settles this, and the renderer's half of it is that `visible/1` gates a mesh,
 * a model and a light, and is ignored for a camera and a pivot.
 */
export function cameraOf(
	scene: Scene,
	viewport: SceneNode,
): SceneNode | undefined {
	if (viewport.kind !== "viewport" || viewport.camera === undefined) {
		return undefined;
	}
	return camerasIn(scene, viewport).find((node) => node.id === viewport.camera);
}

/* ------------------------------------------------------------------ */
/* Reading one node                                                    */
/* ------------------------------------------------------------------ */

/**
 * Position and size on all six axes, in EMU, in this universe — relative to the
 * parent's origin, exactly as {@link SceneNode.frame} is.
 *
 * `frameOf` for the planar four and `spatialDim` for the other two, which means
 * a token, a derivation and a per-universe pick are followed on the third axis
 * by precisely the machinery that follows them on the first. **Absent is zero**,
 * so this never has to be asked whether the fields are there; a node that has
 * never heard of the third axis reads as a flat box at z 0 with no depth, which
 * is where a flat document already is.
 */
export function boxOf(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): Box {
	return {
		...frameOf(node, context),
		z: spatialDim(node, "z", context),
		depth: spatialDim(node, "depth", context),
	};
}

/** The centre of a box — the point every rotation in this file turns about. */
export function centreOf(box: Box): Point3 {
	return {
		x: box.x + box.width / 2,
		y: box.y + box.height / 2,
		z: box.z + box.depth / 2,
	};
}

/**
 * Everything one node's own transform is, resolved against one universe.
 *
 * Three fields rather than a matrix, because the three are what a caller
 * actually branches on and a matrix is what it composes. The inspector wants
 * the numbers, the exporter wants the rotations as CSS functions, the budget
 * wants the size, and only the renderer wants the product — so the product is
 * {@link localMatrix}, built from this, and this stays readable.
 *
 * **The universe is not optional in spirit even though the argument is.** A
 * `length` token holding two alternatives is a mesh in two places, and an
 * `angle` token holding `[0deg, 30deg]` is a card that lies flat in one design
 * and tilts in another. A caller that passes no context is looking at the first
 * alternative of everything, which is a real thing to want — an unsolved
 * preview — and is not the same as looking at the document.
 */
export interface Transform {
	/** Six numbers in the parent's origin space, in EMU. */
	box: Box;
	/** Thousandths of a degree about each axis — see {@link TURNS}. */
	turn: Record<Turn, number>;
	/** {@link centreOf} the box: what the rotation is about. */
	centre: Point3;
}

export function transformOf(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): Transform {
	const box = boxOf(node, context);
	return { box, turn: turnOf(node, context), centre: centreOf(box) };
}

/* ------------------------------------------------------------------ */
/* The world chain                                                     */
/* ------------------------------------------------------------------ */

/**
 * A 4×4 transform, **column-major**: element `[column][row]` is at
 * `m[column * 4 + row]`, so the translation is the last four entries.
 *
 * Column-major because both consumers already are. three.js's `Matrix4.elements`
 * is column-major and CSS's `matrix3d()` takes its sixteen numbers in exactly
 * that order, so a matrix built here goes into either one with no transpose and
 * therefore with no place for a transpose to be forgotten. The one cost is that
 * it reads transposed on the page, which is what the index arithmetic in
 * {@link composeMatrix} is spelled out for.
 *
 * A sixteen-tuple rather than `number[]`, so a matrix with fifteen entries in it
 * is a compile error rather than a `NaN` three frames later.
 *
 * **Floats, and the only floats in this file.** Every other number here is an
 * integer count of EMU. A rotation matrix holds sines and cosines, which are
 * irrational for all but a few angles — that irrationality is the whole of §4's
 * argument for why the solver refuses a turned node's faces — so a matrix is a
 * *rendering* quantity and never a document one. Nothing writes one back.
 */
export type Mat4 = readonly [
	number, number, number, number,
	number, number, number, number,
	number, number, number, number,
	number, number, number, number,
];

/** The transform that does nothing. */
export const identityMatrix = (): Mat4 => [
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1,
];

/** A pure translation, in EMU. */
export const translationMatrix = (x: number, y: number, z: number): Mat4 => [
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	x, y, z, 1,
];

/**
 * `a` then `b`, as one matrix — that is, `a · b`, which applied to a point does
 * `b` first.
 *
 * Written as an index loop rather than as sixteen expressions because the
 * expressions are where a column-major transpose bug hides: four of them are
 * symmetric enough to be wrong and still look right. The loop is the definition
 * of matrix multiplication with the column-major indexing stated once, in one
 * place, where it can be read.
 *
 * The cast is the one in this file. A tuple of exactly sixteen cannot be built
 * by a loop without it, and the loop's bounds are the proof that there are
 * sixteen.
 */
export function composeMatrix(a: Mat4, b: Mat4): Mat4 {
	const out = new Array<number>(16);
	for (let column = 0; column < 4; column++) {
		for (let row = 0; row < 4; row++) {
			let sum = 0;
			for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
			out[column * 4 + row] = sum;
		}
	}
	return out as unknown as Mat4;
}

/**
 * The rotation a `turn` record comes to, as a matrix.
 *
 * **`rotateZ`, then `rotateY`, then `rotateX`** — the fixed order
 * {@link TURNS} argues for, which as a matrix product is `Rx · Ry · Rz`,
 * because a product applied to a point does its rightmost factor first. That is
 * CSS's own order for `rotateX(..) rotateY(..) rotateZ(..)` read left to right
 * *and* three.js's default `XYZ` Euler order read as intrinsic rotations, which
 * is why the two renderers agree with no conversion and why this file needs no
 * conversion either.
 *
 * The angles are in the **document's** space: x right, y down, z away from the
 * viewer. That is a right-handed system — point along x, curl to y, and the
 * thumb goes away — so these are the textbook matrices with no sign games, and a
 * positive `rotateZ` turns x toward y, which on screen is clockwise, which is
 * what CSS's `rotate()` does. A consumer whose z points the other way flips it
 * at its own boundary and exactly once; {@link renderPoint} is that boundary for
 * three.js.
 */
export function rotationMatrix(turn: Record<Turn, number>): Mat4 {
	const [ca, sa] = cosSin(turn.rotateX);
	const [cb, sb] = cosSin(turn.rotateY);
	const [cg, sg] = cosSin(turn.rotateZ);
	// Rx · Ry · Rz, written out by row and then laid down by column. Held equal
	// to three.js's `makeRotationFromEuler` for order "XYZ" element by element,
	// which is the check that matters: this is the matrix the renderer would
	// otherwise build itself, and two builders would be two answers.
	return [
		cb * cg, ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, 0,
		-cb * sg, ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, 0,
		sb, -sa * cb, ca * cb, 0,
		0, 0, 0, 1,
	];
}

/** Cosine and sine of an angle given in thousandths of a degree. */
function cosSin(mdeg: number): [number, number] {
	const radians = radFromMdeg(mdeg);
	return [Math.cos(radians), Math.sin(radians)];
}

/** A point through a matrix. The `w` row is never anything but affine here. */
export function applyMatrix(matrix: Mat4, point: Point3): Point3 {
	const { x, y, z } = point;
	return {
		x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
		y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
		z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
	};
}

/**
 * A node's own transform: **its centred space to its parent's origin space**.
 *
 * "Centred space" is the node's own frame with the origin at its centre and the
 * axes turned with it, so a corner of the node is at `(±width/2, ±height/2,
 * ±depth/2)`. That is the space three.js positions an `Object3D` in and the
 * space CSS's `transform-origin: center` puts a box in, and it is the space the
 * rotation is about, so it is the space this chain speaks.
 *
 * `T(centre) · R` and nothing else: turn about the origin, then move the origin
 * to where the node's centre is. A rotation about a point *is* those two, and
 * because the point is the node's own centre there is never a third factor —
 * which is the geometric form of the argument {@link TURNS} makes and the reason
 * a centre survives a rotation as an exact linear quantity.
 */
export function localMatrix(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): Mat4 {
	const { turn, centre } = transformOf(node, context);
	return composeMatrix(
		translationMatrix(centre.x, centre.y, centre.z),
		rotationMatrix(turn),
	);
}

/**
 * A node's transform for the things *inside* it: **its origin space to its
 * parent's origin space**.
 *
 * A child's `frame` is relative to its parent's origin — the near-top-left
 * corner — and that is the one fact `tree.ts` opens with. So the step from a
 * child to its parent is {@link localMatrix} pushed back out to the corner,
 * which is one more translation by half the size.
 *
 * The degenerate case is the check worth keeping in mind: with no rotation
 * anywhere this is `T(centre) · T(−half)`, which is `T(x, y, z)`, and a chain of
 * them is the plain sum of ancestor origins that {@link worldOrigin} has always
 * computed. **The third axis and the matrices cost a flat document nothing, and
 * this is where that is true.**
 */
export function originMatrix(
	node: SceneNode,
	context: ResolveContext = NO_CONTEXT,
): Mat4 {
	const box = boxOf(node, context);
	return composeMatrix(
		localMatrix(node, context),
		translationMatrix(-box.width / 2, -box.height / 2, -box.depth / 2),
	);
}

/**
 * A node's centred space to the canvas, through every ancestor.
 *
 * The full chain, outermost first, exactly as {@link worldFrame} sums origins —
 * and it reduces to that sum when nothing in the chain is turned. Undefined for
 * an id the tree does not hold, which is what every other reader here does with
 * one.
 *
 * This is the chain in **page coordinates**, which is the right one for the
 * layer list, for a selection outline and for a rule that names a node inside a
 * viewport and one outside it. It is *not* what the 3D renderer wants, because
 * it climbs out through the viewport and up the artboard and there is no camera
 * anywhere in the sum — see {@link sceneMatrixOf}, and see
 * `docs/merged-plan.md` §6.2 for what that costs a rule that spans the seam.
 */
export function worldMatrixOf(
	scene: Scene,
	id: string,
	context: ResolveContext = NO_CONTEXT,
): Mat4 | undefined {
	const node = findInTree(scene.nodes, id);
	if (!node) return undefined;
	let matrix = identityMatrix();
	for (const ancestor of ancestorsOf(scene.nodes, id)) {
		matrix = composeMatrix(matrix, originMatrix(ancestor, context));
	}
	return composeMatrix(matrix, localMatrix(node, context));
}

/**
 * A node's centred space to **its viewport's model space** — what the 3D
 * renderer mounts it with.
 *
 * The same chain as {@link worldMatrixOf}, stopped at the viewport instead of
 * running on up to the canvas, because the viewport's origin is where the
 * renderer's own coordinate system starts: everything above the seam is a
 * rectangle on a page and belongs to the 2D canvas, and mixing the two would
 * put an artboard's position into a scene's geometry.
 *
 * Undefined when no viewport contains the node, and that is the honest answer
 * rather than an identity fallback. A mesh on a plain artboard is a node in a
 * document with no model space to be in — it is what dragging one out of a view
 * leaves behind — and a caller that got a matrix back would draw it somewhere.
 */
export function sceneMatrixOf(
	scene: Scene,
	id: string,
	context: ResolveContext = NO_CONTEXT,
): Mat4 | undefined {
	const node = findInTree(scene.nodes, id);
	if (!node) return undefined;
	const viewport = viewportOf(scene, id);
	if (!viewport) return undefined;
	const trail = ancestorsOf(scene.nodes, id);
	const from = trail.findIndex((a) => a.id === viewport.id);
	let matrix = identityMatrix();
	for (const ancestor of trail.slice(from + 1)) {
		matrix = composeMatrix(matrix, originMatrix(ancestor, context));
	}
	return composeMatrix(matrix, localMatrix(node, context));
}

/* ------------------------------------------------------------------ */
/* The box, and the refusal                                            */
/* ------------------------------------------------------------------ */

/**
 * A node's axis-aligned box on the canvas, in EMU — or **nothing at all**, when
 * anything in its chain is turned.
 *
 * The six-number twin of {@link worldFrame}, and it agrees with it exactly on
 * the four planar numbers of an unturned node. Which is the whole of the
 * arithmetic: with no rotation in the chain a world box is the sum of the
 * ancestors' origins plus the node's own frame, integer EMU throughout, exact.
 *
 * **The refusal is the feature.** Turn any node in the chain and the region the
 * node occupies stops being a box the document contains: its extent on an axis
 * becomes `|w·cos θ| + |h·sin θ|`, which is irrational for all but a handful of
 * angles, so an "axis-aligned box" for it would be a rounded lie in a file whose
 * every other number is exact. There is a rectangle that contains the rotated
 * one, and returning it would be worse than returning nothing: a caller would
 * hit-test against it, snap to it, draw a selection outline on it and align a
 * rule to it, and each of those would be a claim about a shape nobody drew.
 *
 * So this returns `undefined` and {@link refusedBounds} says why, in the words a
 * panel shows. It is the same shape as `gnoedge/2` in the generated program —
 * the quantity is never minted, the relation goes unstated, and the editor is
 * where the silence is made visible — and it is the same shape `refusedEdge`
 * will take when step M4 writes it.
 *
 * **The 3D case is answered properly elsewhere and is not a gap here.** Inside a
 * viewport the question "what is the pointer over?" is the raycaster's, which
 * intersects the actual geometry through the actual camera and needs no bounding
 * box at all; that is what `KindSpec.opaque` buys, and it is why the pointer
 * stops at the viewport's rectangle.
 */
export function axisBounds(
	scene: Scene,
	id: string,
	context: ResolveContext = NO_CONTEXT,
): Box | undefined {
	const node = findInTree(scene.nodes, id);
	if (!node) return undefined;
	if (turnedInChain(scene, node, context)) return undefined;
	let x = 0;
	let y = 0;
	let z = 0;
	for (const ancestor of ancestorsOf(scene.nodes, id)) {
		const box = boxOf(ancestor, context);
		x += box.x;
		y += box.y;
		z += box.z;
	}
	const own = boxOf(node, context);
	return {
		x: x + own.x,
		y: y + own.y,
		z: z + own.z,
		width: own.width,
		height: own.height,
		depth: own.depth,
	};
}

/**
 * Why {@link axisBounds} gave nothing back, in the sentence the panel shows — or
 * nothing, where it gave a box.
 *
 * The two are a pair for the reason `refusedEdge` and `gnoedge/2` are a pair:
 * silence in a system is invisible, and an invisible refusal is worse than the
 * wrong answer it replaced. A caller that can show a person a reason is required
 * to, and a caller that cannot is at least required to know there was one.
 *
 * It names **which** node is turned, which is the part that makes the sentence
 * worth reading: a mesh whose bounds are refused is usually not the mesh
 * somebody turned, it is three levels under a pivot that was.
 */
export function refusedBounds(
	scene: Scene,
	id: string,
	context: ResolveContext = NO_CONTEXT,
): string | undefined {
	const node = findInTree(scene.nodes, id);
	if (!node) return undefined;
	const culprit = turnedInChain(scene, node, context);
	if (!culprit) return undefined;
	const turned = describeTurn(culprit, context);
	if (culprit.id === node.id) {
		return `“${node.name}” is turned ${turned}, and the box a turned node occupies is trigonometry — an extent of |w·cos θ| + |h·sin θ|, which is not a whole number of EMU for any angle worth turning by. So there is no axis-aligned box to give you rather than a rounded one. Its centre and its size are still exactly what they say they are, and inside a 3D view the pointer is answered by the geometry itself.`;
	}
	return `“${node.name}” sits under “${culprit.name}”, which is turned ${turned}, so it has no axis-aligned box on the canvas — a turned ancestor carries everything beneath it off the axes, and the region its children occupy stops being a rectangle the document contains. Its centre and its size are still exact, and so is its place in the scene.`;
}

/**
 * The nearest node in `id`'s chain — itself first, then outwards — that is
 * turned in this universe, or nothing.
 *
 * Itself first because that is the answer a designer is most likely to be able
 * to act on, and outwards rather than inwards because a turned ancestor is the
 * one people forget about. The universe matters and is why this is not a field
 * check: an `angle` token holding `[0deg, 30deg]` is a chain that is turned in
 * one design and flat in another, and refusing a box in the flat one would be a
 * refusal with nothing behind it.
 */
function turnedInChain(
	scene: Scene,
	node: SceneNode,
	context: ResolveContext,
): SceneNode | undefined {
	if (isTurned(node, context)) return node;
	const trail = ancestorsOf(scene.nodes, node.id);
	for (let i = trail.length - 1; i >= 0; i--) {
		if (isTurned(trail[i], context)) return trail[i];
	}
	return undefined;
}

/**
 * How a node is turned, for a sentence: `30° about Y`, or `30° about Y and 12°
 * about Z` when it is turned about more than one.
 *
 * Degrees rather than the thousandths the document stores, because this is prose
 * for a person and nobody has ever meant `30000` by a right angle and a third.
 * The number is written with as few decimal places as it needs — a whole degree
 * has none — which is the same courtesy `writeLength` extends to a length.
 */
function describeTurn(node: SceneNode, context: ResolveContext): string {
	const turn = turnOf(node, context);
	const parts = TURN_NAMES.filter((name) => turn[name] !== 0).map(
		(name) => `${degreeText(turn[name])}° about ${name.slice("rotate".length)}`,
	);
	if (parts.length === 0) return "0°";
	if (parts.length === 1) return parts[0];
	return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Thousandths of a degree as the shortest exact decimal: `22500` is `22.5`. */
function degreeText(mdeg: number): string {
	return String(Number((mdeg / 1000).toFixed(3)));
}

/* ------------------------------------------------------------------ */
/* The renderer boundary                                               */
/* ------------------------------------------------------------------ */

/**
 * EMU to the units a 3D renderer's scene graph is in, which are **CSS pixels**.
 *
 * Pixels rather than metres, and the reason is float precision rather than
 * taste. A 480px viewport is 4,572,000 EMU; a `float32` depth buffer has a
 * 24-bit mantissa, so a scene measured in EMU would run out of precision before
 * anything got interesting and two coplanar faces would z-fight — which would
 * read as a rendering bug in a system whose numbers are otherwise exact. In CSS
 * pixels the same viewport is 480 units, a `near` of 1 and a `far` of 20000 give
 * an ordinary depth range, and the number on screen is the number in the
 * inspector.
 *
 * **Named `render`, not `world`, and that is a deliberate departure from
 * `docs/three-d-spec.md` §6.2.** That section calls this `worldFromEmu`, on the
 * discipline that anything holding renderer units has `World` in its name — a
 * good rule inside `canvas-3d`, where the word is free. It is not free here.
 * `worldOrigin`, `worldFrame` and `gworld/2` have meant *absolute canvas
 * coordinates in EMU* since long before there was a third axis, so a
 * `worldFromEmu` in this package would make one word mean two things one import
 * apart. That is exactly the collision `merged-plan` §2 renamed `Solid` to
 * avoid, and it is renamed here for the same reason.
 *
 * `canvas-3d` may keep the spec's spelling for its own callers with a renaming
 * re-export — `export { renderFromEmu as worldFromEmu }` — and **should not
 * restate the arithmetic**. Two conversion sites are two answers, and the one in
 * the pure package is the one a headless test can check; that is the same
 * argument `docs/merged-plan.md` §6.5 makes about where a clamp lives.
 */
export const renderFromEmu = (emu: Emu): number => cssPxFromEmu(emu);

/** Renderer units back to EMU, quantized once, at this boundary and no other. */
export const emuFromRender = (render: number): Emu => emuFromCssPx(render);

/**
 * How many EMU one renderer unit is, for a caller sizing a camera frustum or a
 * grid rather than converting a length.
 *
 * The same number {@link EMU_PER_PX} is, re-exported under the name that says
 * which side of the boundary the caller is standing on.
 */
export const EMU_PER_RENDER_UNIT = EMU_PER_PX;

/**
 * Thousandths of a degree to radians, for a renderer that wants them. **Lossy,
 * once, by name.**
 *
 * π is irrational, so this is the one direction that cannot round-trip, and it
 * has a name so that the loss happens where somebody asked for it. Nothing in
 * the document is ever written from the result: an angle goes into the file
 * through `mdegOf`, which is exact or nothing, and comes back out through
 * `writeAngle`.
 */
export const radFromMdeg = (mdeg: number): number =>
	(mdeg / 1000) * (Math.PI / 180);

/**
 * A document point as a three.js position — **the one place a sign flips**.
 *
 * The document's plane is x right, y **down**, and `front` being the lead on z
 * fixes +z as *away* from the viewer. three.js is right-handed with y up and +z
 * *toward* the viewer, so two axes are negated, and they are negated here, once,
 * in a function named for it. A second negation anywhere else would be a scene
 * that is correct in one component and mirrored in the next.
 *
 * Note what this does **not** do: it does not negate the rotations. Flipping two
 * of three axes is a rotation of the coordinate system rather than a reflection
 * of it — the handedness survives — so the Euler triple goes across unchanged
 * and {@link rotationMatrix} is the matrix three.js would have built. A caller
 * targeting CSS instead has its own crossing to make, because CSS's +z points at
 * the viewer too.
 */
export const renderPoint = (point: Point3): [number, number, number] => [
	renderFromEmu(point.x),
	-renderFromEmu(point.y),
	-renderFromEmu(point.z),
];

/**
 * Where a node's centre is in its viewport's scene, ready to hand to a renderer.
 *
 * The three readings above composed into the one a caller actually makes, so
 * that a renderer never writes the chain out itself and gets the order wrong.
 * Undefined for the same two reasons {@link sceneMatrixOf} is: no such node, or
 * no viewport around it.
 */
export function scenePosition(
	scene: Scene,
	id: string,
	context: ResolveContext = NO_CONTEXT,
): [number, number, number] | undefined {
	const matrix = sceneMatrixOf(scene, id, context);
	if (!matrix) return undefined;
	// The centred space's own origin *is* the centre, so the matrix's
	// translation column is the answer with no point to push through it.
	return renderPoint({ x: matrix[12], y: matrix[13], z: matrix[14] });
}

/**
 * A two-dimensional point read out of a three-dimensional one, for the callers
 * that live above the seam.
 *
 * Here rather than left to each caller because dropping z is a decision — it is
 * the projection a *page* makes, not the one a camera makes — and a caller that
 * writes `{ x: p.x, y: p.y }` inline has made that decision silently.
 */
export const planeOf = (point: Point3): Point => ({ x: point.x, y: point.y });
