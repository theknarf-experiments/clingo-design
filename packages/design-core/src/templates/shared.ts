/**
 * Building blocks shared by the templates.
 *
 * Thin wrappers over {@link makeNode}, so a template can state a node as one
 * line of literal data and still get the per-kind construction rules.
 *
 * Child coordinates are relative to the enclosing frame, so a frame can be
 * moved on the canvas without touching anything inside it.
 */
import { makeNode } from "../edits.ts";
import { MIN_NODE_SIZE } from "../geometry.ts";
import type { Dimension, SceneNode, Spatial, Turn } from "../scene.ts";
import { EMU_PER_PX } from "../units.ts";
import { type Token, type Value, single } from "../values.ts";

/**
 * A node's geometry as a template states it: **whole CSS pixels**, because that
 * is the unit a person laying out a page on a screen thinks in and because
 * every one of these numbers was chosen by eye.
 */
export type Box = [x: number, y: number, width: number, height: number];

/**
 * The box as a {@link Frame}, which is EMU.
 *
 * The one place the templates cross, and the reason a template can go on being
 * literal data: `[0, 0, 720, 400]` still reads as a 720-by-400 page rather than
 * as `[0, 0, 720 * EMU_PER_PX, 400 * EMU_PER_PX]` repeated four hundred times.
 * A px *string* elsewhere in a template needs no such treatment — `"22px"` is a
 * length in either era, which is exactly what keeping the storage format
 * unit-suffixed bought — so this is the only conversion in the folder.
 */
export const at = ([x, y, width, height]: Box) => ({
	x: x * EMU_PER_PX,
	y: y * EMU_PER_PX,
	width: width * EMU_PER_PX,
	height: height * EMU_PER_PX,
});

/**
 * Templates go through {@link makeNode} like any other node, so per-kind
 * construction rules live in exactly one place; `props` overrides rather than
 * adds to the kind's defaults, since a template states its whole appearance.
 */
export function frame(
	id: string,
	name: string,
	box: Box,
	props: SceneNode["props"],
	children: SceneNode[],
): SceneNode {
	return { ...makeNode("frame", at(box), { id, name }), props, children };
}

export function rect(
	id: string,
	name: string,
	box: Box,
	props: SceneNode["props"],
): SceneNode {
	return { ...makeNode("rect", at(box), { id, name }), props };
}

export function text(
	id: string,
	name: string,
	box: Box,
	// A whole {@link Value} as well as a bare string, because a wording with
	// alternatives is the ordinary case and not a special one: a template that
	// wants nine of them should not have to reach past this helper to say so.
	content: string | Value,
	props: SceneNode["props"],
): SceneNode {
	// Content joins the other properties rather than sitting beside them, so a
	// template can give a headline two wordings the way it gives it two colours.
	return {
		...makeNode("text", at(box), { id, name }),
		props: {
			text: typeof content === "string" ? single(content) : content,
			...props,
		},
	};
}

/**
 * A node with one of its dimensions given several alternatives.
 *
 * Geometry arrives here as a plain box, because that is what almost every node
 * wants; this is how a template says "and this one sits in two places", without
 * every helper above growing a second way to spell a frame.
 */
export function spread(
	node: SceneNode,
	dim: Dimension,
	values: Value,
): SceneNode {
	return { ...node, frame: { ...node.frame, [dim]: values } };
}

/**
 * A node wearing a style.
 *
 * Nothing is copied in: wearing one means the properties it decides are derived
 * per universe from the style's pick, so a template says which treatment a node
 * takes and says nothing about what that treatment is.
 */
export function wearing(node: SceneNode, style: string): SceneNode {
	return { ...node, style };
}

/** Replace one starter token's value. */
export function withToken(tokens: Token[], id: string, value: Value): Token[] {
	return tokens.map((t) => (t.id === id ? { ...t, value } : t));
}

/* ------------------------------------------------------------------ */
/* Three dimensions                                                    */
/* ------------------------------------------------------------------ */

/*
 * Everything below states an **ordinary scene node**, and that is the whole
 * reason these are five small functions rather than one `scene3d()` builder that
 * returns some other kind of thing.
 *
 * A mesh, a camera and a light are `node/1` with a `kind/2`, a `child/2`, an
 * `order/2`, a `visible/1` and a `frame/3`, exactly like the rectangle beside
 * them on the page. So they go through {@link makeNode} like every other
 * template node, they take a `props` record like every other template node, and
 * the helpers here differ from {@link rect} in precisely two ways: what they
 * pass as the kind, and the fact that two of them have no extent to speak of.
 * Had a 3D object needed its own construction path, that would have been the
 * first sign the architecture had grown a second document model beside the
 * scene — which is the one thing it was designed not to do.
 */

/**
 * What a node holds on the third axis, and how it is turned — in the units a
 * template thinks in.
 *
 * Whole CSS pixels and whole degrees, for {@link at}'s reason and stated the
 * same way round: every one of these numbers was chosen by eye, and a template
 * that spelled `single("-260px")` four times per mesh would be a template nobody
 * reads. The conversion to a `length` {@link Value} happens here, once.
 *
 * **Sparse on purpose, and absence is not zero.** Only the dimensions named are
 * written, because a camera sitting on the origin plane must hold no `spatial`
 * at all rather than holding `{ z: "0px" }` — `zstated/1`, `s3/1` and
 * `isSpatialScene` all read the presence of the key, so two spellings of "flat"
 * would be a document that is in three dimensions because somebody wrote down
 * where it was not.
 *
 * A dimension that wants *alternatives* rather than a number is written onto the
 * node directly, the way {@link spread} does it for the planar four. That is
 * rare enough not to deserve a second parameter shape here, and important enough
 * that the long spelling should stay visible where it happens.
 */
export function deep(
	node: SceneNode,
	spatial: Partial<Record<Spatial, number>>,
	turn?: Partial<Record<Turn, number>>,
): SceneNode {
	const px = <K extends string>(from: Partial<Record<K, number>>, unit: string) =>
		Object.fromEntries(
			Object.entries(from).map(([k, v]) => [k, single(`${v as number}${unit}`)]),
		);
	const written = px(spatial, "px");
	const turned = turn ? px(turn, "deg") : {};
	return {
		...node,
		...(Object.keys(written).length > 0 ? { spatial: written } : {}),
		...(Object.keys(turned).length > 0 ? { turn: turned } : {}),
	};
}

/**
 * The seam: a rectangle on the artboard whose children are three dimensional.
 *
 * `camera` is a **field and not a value**, which is the same call
 * {@link SceneNode.instanceOf} makes and for the same reason: which eye a view
 * looks through is structure, not appearance, and a document where it branched
 * would be a document with two universes that differ in nothing a rule can name.
 * A dangling id derives nothing rather than failing, so a template may name the
 * camera before it states it.
 */
export function view(
	id: string,
	name: string,
	box: Box,
	camera: string,
	props: SceneNode["props"],
	children: SceneNode[],
): SceneNode {
	return { ...makeNode("viewport", at(box), { id, name }), camera, props, children };
}

/**
 * One of the six primitives — see `PROPS.solid`.
 *
 * Identical to {@link rect} but for the kind, and the resemblance is the point:
 * a solid is a box with a `solid` word and a `depth`, and everything that reads
 * a rectangle's frame reads this one's. Its depth is given through {@link deep},
 * because the planar box is what the layer list, the align rules and the
 * inspector already understand.
 */
export function mesh(
	id: string,
	name: string,
	box: Box,
	props: SceneNode["props"],
): SceneNode {
	return { ...makeNode("mesh", at(box), { id, name }), props };
}

/**
 * A camera or a lamp: a node with a place and no silhouette.
 *
 * Stated as the **point it sits at** rather than as a box, because that is the
 * only thing about it that means anything — `drawable: false` says what it
 * contributes to the picture is a projection or an illumination, never pixels.
 * It still gets a real frame, because `makeNode` clamps every span up to
 * {@link MIN_NODE_SIZE}: a node the pointer could never grab is a node nobody
 * could select in the layer list, and the editor draws a marker at it. Half that
 * minimum is subtracted here so the marker is *centred* on the point the
 * template named, which is the same correction `markerOrigin` makes in
 * `edits.ts` and for the same reason.
 */
export function marker(
	kind: "camera" | "light",
	id: string,
	name: string,
	[x, y]: [x: number, y: number],
	props: SceneNode["props"],
): SceneNode {
	const half = MIN_NODE_SIZE / 2 / EMU_PER_PX;
	return { ...makeNode(kind, at([x - half, y - half, 0, 0]), { id, name }), props };
}

/**
 * A transform inside a scene: a place, a rotation, and nothing to re-fit.
 *
 * Not a `group`, and the difference is not cosmetic — a group is
 * `wrapsChildren: true` and re-fits to its children's 2D bounding box, which
 * inside a viewport is exactly the trigonometry over rotated solids that a
 * linear solver cannot do. A pivot has the extent of a marker and its children
 * stand where they stand.
 */
export function pivot(
	id: string,
	name: string,
	[x, y]: [x: number, y: number],
	children: SceneNode[],
): SceneNode {
	const half = MIN_NODE_SIZE / 2 / EMU_PER_PX;
	return {
		...makeNode("pivot", at([x - half, y - half, 0, 0]), { id, name }),
		children,
	};
}

