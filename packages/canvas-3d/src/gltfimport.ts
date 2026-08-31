/**
 * A glTF file, as **document nodes** — which is the whole reason import is worth
 * having.
 *
 * ## The thesis
 *
 * An imported chair does not arrive as a blob with a viewer bolted onto it. It
 * arrives as a `pivot` per glTF node and a `model` per primitive, in the layer
 * graph, each with a frame the solver placed, a rotation the inspector can type
 * into, and a fill, a roughness, a metalness and an opacity that are **ordinary
 * props** — the same props a `mesh` has, driven by the same tokens, varied by
 * the same alternatives, moved by the same machine states. A rule can align the
 * chair's back to a wall. A state can hide its legs. Every one of those
 * sentences is invariant 2 — *a 3D object is an ordinary scene node* — applied
 * to content that came from somewhere else, and none of them is true of a blob.
 *
 * ## Where the vertices go, and the one place this departs from its brief
 *
 * The brief for this step says the vertex data should sit **on the node, the way
 * a path's points do**. It does not, and it cannot from this package:
 * `SceneNode` has no field for a triangle soup, `scene.ts` is not this step's to
 * edit, and the field it *does* have — `SceneNode.mesh`, a {@link MeshRef} — was
 * shipped with a written argument against exactly that idea: a path's points are
 * a few dozen numbers and a glTF is megabytes, the document is an Automerge
 * document two people edit at once, and a blob in it is a blob in every diff,
 * every undo entry and every sync message.
 *
 * So what this does is the nearest correct thing, and it is nearer than it
 * sounds: the payload is split **per node**. Each `model` node gets its own
 * content-addressed payload holding its own primitive and nothing else, so a
 * document with a hundred imported parts has a hundred separately addressed
 * geometries, each reachable from the node that draws it, and *none* of them is
 * the opaque whole-file blob the brief was written against. What is on the node
 * is the hash, the exact bounds and the triangle count; what is beside the
 * document is the soup. **This disagreement is reported rather than absorbed** —
 * see the return value of the step that ran this.
 *
 * ## What is not here
 *
 * The store. `design-core/src/assets.ts` — the `AssetStore` interface of
 * `docs/merged-plan.md` M4 — is not in the tree, and this package may not invent
 * it. So {@link importGltf} returns the payloads as bytes with their hashes
 * already computed, and the caller puts them wherever the store turns out to be.
 * That is the honest seam: everything up to `store.put(bytes)` is done here.
 */
import {
	type AssetInfo,
	type MeshRef,
	type PropName,
	type SceneNode,
	type Value,
	formatLength,
	newNodeId,
	single,
	writeAngle,
} from "@clingo-design/design-core";
import { Color, Euler, Matrix4, Quaternion, Vector3 } from "three";

import {
	type GltfFile,
	type GltfLight,
	type GltfNode,
	type Triangles,
	boundsOf,
	centreTriangles,
	emuFromMetres,
	gltfWriter,
	parseGltfFile,
	readTriangles,
	scaleTriangles,
	triangleCount,
} from "./gltf.ts";

/* ------------------------------------------------------------------ */
/* What comes back                                                     */
/* ------------------------------------------------------------------ */

/** One payload, hashed, with what the document remembers about it. */
export interface ImportedAsset {
	/** The content hash — hex SHA-256, and the id a store keys it by. */
	id: string;
	info: AssetInfo;
	/**
	 * A standalone glTF holding **one primitive and no material**, centred on its
	 * own origin, in metres, in glTF's own axes.
	 *
	 * No material, deliberately: the file's material became props on the node,
	 * which is where a designer can change it and a token can drive it, and a
	 * second copy inside the payload would be a second answer to what colour the
	 * chair is. A loader mounts this geometry and paints it with
	 * `materialOf(node.rendered)` — which is exactly what `Model.tsx` already
	 * computes for the stand-in box it draws today.
	 */
	payload: Uint8Array;
}

export interface GltfImport {
	/**
	 * The subtree, ready to append to a `viewport`'s children — normally one
	 * node, and more only where the file's default scene had several roots.
	 *
	 * Frames are already in the parent's space, so this is `appendChild`'s
	 * business and never `addNodeTo`'s: there was no pointer here and there is
	 * nothing to convert out of canvas coordinates.
	 */
	nodes: SceneNode[];
	/** Every payload, hashed. The caller stores them and merges {@link Scene.assets}. */
	assets: ImportedAsset[];
	/** Total triangles across the import — for the budget and the status line. */
	triangles: number;
	/**
	 * What the file held and the document does not, in `ExportResult.lost`'s
	 * manner: one sentence each, plain, naming the thing rather than the code.
	 *
	 * An import's loss list is the mirror of an export's and it is worth exactly
	 * as much. A designer who imports a rigged, animated, textured character and
	 * gets a static grey one is owed the difference in sentences rather than in
	 * silence.
	 */
	lost: string[];
}

export interface GltfImportOptions {
	/** The file's name. Kept on every {@link MeshRef} so a relink has something to show. */
	source?: string;
	/** What to call the root in the layer list. Defaults to {@link source}. */
	name?: string;
	/** Node ids, for a test that wants them stable. Defaults to `newNodeId`. */
	id?: () => string;
}

/* ------------------------------------------------------------------ */
/* The import                                                          */
/* ------------------------------------------------------------------ */

/**
 * A `.gltf` or `.glb`, as nodes, payloads and a list of what was flattened.
 *
 * Asynchronous for one reason and it is the same reason `AssetStore.put` is:
 * the id is a SHA-256 of the payload, `crypto.subtle.digest` is a promise, and
 * hashing by hand in a synchronous loop would be slower and would be a second
 * implementation of a primitive both platforms already ship.
 *
 * Throws only where the bytes are not a glTF at all — see {@link parseGltfFile}.
 * Everything else a file can hold and a document cannot comes back in `lost`.
 */
export async function importGltf(
	bytes: Uint8Array,
	options: GltfImportOptions = {},
): Promise<GltfImport> {
	const file = parseGltfFile(bytes);
	const state: Walk = {
		file,
		id: options.id ?? newNodeId,
		source: options.source,
		lost: [],
		payloads: [],
		triangles: 0,
	};

	// Only the default scene. A glTF may hold several and a document holds one
	// tree per import; picking the file's own `scene` is what every viewer does
	// and picking all of them would stack unrelated scenes on top of each other
	// at the origin.
	const scenes = file.json.scenes ?? [];
	const chosen = scenes[file.json.scene ?? 0];
	if (scenes.length > 1) {
		say(state, "Only the file's default scene is imported; its other scenes are not.");
	}
	const roots = chosen?.nodes ?? (file.json.nodes ?? []).map((_, index) => index);

	fileLosses(state);
	const nodes: SceneNode[] = [];
	for (const root of roots) {
		const node = convert(state, root, UNIT_SCALE);
		if (node) nodes.push(node);
	}

	// One root, always, when the file gave more than one — a single thing lands in
	// the layer list, is selected as a unit and is deleted as a unit, which is
	// what dropping a file onto a view means. A file with one root keeps it,
	// because wrapping it would add a node nobody asked for.
	const wrapped =
		nodes.length > 1
			? [
					pivotNode(
						state,
						options.name ?? options.source ?? "Model",
						new Vector3(),
						undefined,
						nodes,
					),
				]
			: nodes.map((node) =>
					options.name === undefined ? node : { ...node, name: options.name },
				);

	const assets = await Promise.all(
		state.payloads.map(async (payload) => ({
			id: await sha256(payload.bytes),
			info: payload.info,
			payload: payload.bytes,
		})),
	);
	// The hash is the id, and the node holds it. The two are joined here rather
	// than during the walk because hashing is the one asynchronous step and
	// threading a promise through a recursive tree walk would have made the walk
	// asynchronous for no other reason.
	for (const [index, asset] of assets.entries()) {
		state.payloads[index]?.attach(asset.id);
	}

	return { nodes: wrapped, assets, triangles: state.triangles, lost: state.lost };
}

/** Everything the walk carries down and collects up. */
interface Walk {
	file: GltfFile;
	id: () => string;
	source: string | undefined;
	lost: string[];
	payloads: {
		bytes: Uint8Array;
		info: AssetInfo;
		/** Writes the hash into the `MeshRef` that is waiting for it. */
		attach: (id: string) => void;
	}[];
	triangles: number;
}

/** One sentence, once. A file with two hundred textures says so once. */
function say(state: Walk, sentence: string): void {
	if (!state.lost.includes(sentence)) state.lost.push(sentence);
}

/**
 * The losses that are facts about the *file* rather than about any one node.
 *
 * Said up front, before the walk, so that a file whose every mesh is refused
 * still explains itself rather than coming back with an empty tree and nothing
 * to read.
 */
function fileLosses(state: Walk): void {
	const { json } = state.file;
	if ((json.animations?.length ?? 0) > 0) {
		say(
			state,
			"Animation. The file's animation clips are not imported: a document's motion is a machine's states and a timeline's keyframes, and there is no honest mapping from a channel that drives a joint onto either.",
		);
	}
	if ((json.skins?.length ?? 0) > 0) {
		say(
			state,
			"Rigging. A skinned mesh comes in at its bind pose — the skeleton, the joints and the weights are not in the document, and moving the bones is not something a node can do.",
		);
	}
	if ((json.images?.length ?? 0) > 0 || (json.textures?.length ?? 0) > 0) {
		say(
			state,
			"Textures. A material becomes a fill, a roughness, a metalness and an opacity — four numbers a designer can edit and a token can drive. An image map is none of those and is dropped; the UV coordinates come along in the geometry, so a relinked texture would still land in the right place.",
		);
	}
	for (const extension of json.extensionsRequired ?? []) {
		say(
			state,
			`Extension. The file requires “${extension}”, which this reader does not implement — anything that depended on it is missing or wrong.`,
		);
	}
	for (const buffer of json.buffers ?? []) {
		if (buffer.uri !== undefined && !buffer.uri.startsWith("data:")) {
			say(
				state,
				`A buffer lives in a separate file (“${buffer.uri}”), which an import cannot reach. Re-export as a .glb, or with the buffers embedded, and the geometry will come with it.`,
			);
		}
	}
}

/* ------------------------------------------------------------------ */
/* The walk                                                            */
/* ------------------------------------------------------------------ */

const UNIT_SCALE: readonly [number, number, number] = [1, 1, 1];

/**
 * A node's three sizes, in EMU — the half of a `Box` that is not a place.
 *
 * Its own little type because every function below takes a place in **metres**
 * and a size in **EMU**, and one record holding both would be the kind of unit
 * mixing this package spends a whole module avoiding. A place is a point in a
 * coordinate system that has to be crossed; a size is a magnitude that only has
 * to be converted, and they are converted at different moments.
 */
interface EmuSize {
	width: number;
	height: number;
	depth: number;
}

const NO_SIZE: EmuSize = { width: 0, height: 0, depth: 0 };

/**
 * One glTF node and everything under it.
 *
 * ## The transform, which is the only hard part
 *
 * glTF composes `T · R · S` and puts a child's coordinates in that frame. The
 * document composes `T(centre) · R` and puts a child's coordinates in the frame
 * of the parent's **origin**, its near-top-left-near corner, which for a
 * zero-sized node is the same point as its centre. So a glTF node with no scale
 * maps onto a zero-sized `pivot` **exactly**: same place, same rotation, same
 * frame for the children, no approximation anywhere.
 *
 * The scale is the part with no home. A document node has no scale — its size
 * *is* its box — so a glTF scale is pushed down: it multiplies the geometry
 * underneath it and the places of everything below. That is exact in the two
 * cases that cover almost every real file (a uniform scale anywhere, or a scale
 * with nothing rotated below it) and is a **shear** in the remaining one, which
 * is named in `lost` against the node it happened on rather than averaged away.
 *
 * ## Why a zero-sized pivot rather than one that fits its children
 *
 * `addPivot` in `edits.ts` makes a pivot the bounding box of the nodes it
 * gathers, which is right for a gesture: you group things you can see. It is
 * wrong here, and not by taste — the document rotates a node about its
 * **centre**, so a pivot sized to its children rotates about the middle of the
 * chair rather than about the point the file said to rotate about, and every
 * rotated import would be subtly displaced. `KINDS.pivot.defaultSize` is
 * `0 × 0` and its own comment says a pivot is "a place and a rotation, and no
 * size"; this is that sentence taken literally.
 */
function convert(
	state: Walk,
	index: number,
	parentScale: readonly [number, number, number],
): SceneNode | undefined {
	const node = state.file.json.nodes?.[index];
	if (!node) return undefined;
	const local = decompose(node);
	// The parent's accumulated scale acts on this node's *place*, and then goes
	// on down multiplied by this node's own.
	const place = new Vector3(
		local.position.x * parentScale[0],
		local.position.y * parentScale[1],
		local.position.z * parentScale[2],
	);
	const scale: [number, number, number] = [
		parentScale[0] * local.scale.x,
		parentScale[1] * local.scale.y,
		parentScale[2] * local.scale.z,
	];
	if (local.scale.x < 0 || local.scale.y < 0 || local.scale.z < 0) {
		say(
			state,
			`A mirrored part (“${nameOf(node, index)}”) is imported unmirrored: a document node has a size, a size is a magnitude, and there is no negative box. Its geometry is the shape it was before the file flipped it.`,
		);
	}
	const turned = !isIdentity(local.quaternion);
	if (turned && !uniform(parentScale)) {
		say(
			state,
			`A stretched parent above a rotated part (“${nameOf(node, index)}”) is a shear, and a document node has a size rather than a scale. The part is imported at its own proportions, which is a small difference in shape wherever the file stretched something and then turned it.`,
		);
	}

	const parts = meshParts(state, node, scale);
	const children: SceneNode[] = [];
	for (const child of node.children ?? []) {
		const converted = convert(state, child, scale);
		if (converted) children.push(converted);
	}
	const lens = cameraNode(state, node, index);
	const lamp = lightNode(state, node, index);

	// The collapse: one primitive and nothing else is one node, not two. This is
	// the common shape by a wide margin — an exporter writes a node per object —
	// and the two-node form would double the layer list for no information.
	if (parts.length === 1 && children.length === 0 && !lens && !lamp) {
		const part = parts[0];
		if (!part) return undefined;
		// The geometry's own centre, turned into the parent's frame: the document
		// places a `model` by the box its vertices occupy, and glTF places it by
		// the node's origin, which is usually not the same point. `place + R·c` is
		// the exact bridge — the rotation then happens about the geometry's centre,
		// which is what the document means by a turn, and the two agree vertex for
		// vertex.
		const centre = part.centre.clone().applyQuaternion(local.quaternion).add(place);
		return modelNode(state, part, centre, local.quaternion);
	}

	const inside = [
		...parts.map((part) => modelNode(state, part, part.centre, undefined)),
		...(lens ? [lens] : []),
		...(lamp ? [lamp] : []),
		...children,
	];
	if (inside.length === 0) return undefined;
	// A node that is nothing but one camera or one light is that camera or that
	// light, standing where the pivot would have stood. Same argument as the
	// collapse above, and the same arithmetic: a zero-sized node's centre and
	// origin are one point.
	if (inside.length === 1 && parts.length === 0 && children.length === 0) {
		const only = inside[0];
		if (only) return { ...only, ...placed(place, local.quaternion, NO_SIZE) };
	}
	return pivotNode(state, nameOf(node, index), place, local.quaternion, inside);
}

/** A glTF node's local transform, however the file chose to spell it. */
function decompose(node: GltfNode): {
	position: Vector3;
	quaternion: Quaternion;
	scale: Vector3;
} {
	const position = new Vector3();
	const quaternion = new Quaternion();
	const scale = new Vector3(1, 1, 1);
	if (node.matrix && node.matrix.length === 16) {
		// glTF's matrix is column-major, which is `Matrix4.fromArray`'s own order,
		// and three.js's `decompose` is the reference implementation of the split
		// glTF's own specification describes. Writing a second one here would be
		// writing a worse one.
		new Matrix4().fromArray(node.matrix).decompose(position, quaternion, scale);
		return { position, quaternion, scale };
	}
	if (node.translation?.length === 3) position.fromArray(node.translation);
	if (node.rotation?.length === 4) quaternion.fromArray(node.rotation).normalize();
	if (node.scale?.length === 3) scale.fromArray(node.scale);
	return { position, quaternion, scale };
}

const isIdentity = (q: Quaternion): boolean =>
	Math.abs(q.x) < 1e-9 && Math.abs(q.y) < 1e-9 && Math.abs(q.z) < 1e-9;

const uniform = (scale: readonly [number, number, number]): boolean =>
	Math.abs(scale[0] - scale[1]) < 1e-9 && Math.abs(scale[1] - scale[2]) < 1e-9;

const nameOf = (node: GltfNode, index: number): string =>
	node.name?.trim() || `Node ${index}`;

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** One primitive, ready to become one `model` node. */
interface Part {
	name: string;
	triangles: Triangles;
	/** Where the geometry's box sits in its node's frame, in metres. */
	centre: Vector3;
	/** The box's size in metres, unsigned. */
	size: [number, number, number];
	props: Partial<Record<PropName, Value>>;
}

/**
 * A node's mesh, as one {@link Part} per primitive.
 *
 * **Per primitive and not per mesh**, and the reason is the material. A glTF
 * mesh with three primitives is one object drawn in three materials, and a
 * document node holds *one* fill, one roughness and one metalness — so three
 * primitives that became one node would be one material, and two thirds of the
 * file's own surfacing would vanish with nothing to say about it. Splitting them
 * makes each material an ordinary prop on an ordinary node, which is the whole
 * brief. The split is named in `lost` so that a designer who counted three
 * objects in Blender and found four in the layer list can see why.
 */
function meshParts(
	state: Walk,
	node: GltfNode,
	scale: readonly [number, number, number],
): Part[] {
	if (node.mesh === undefined) return [];
	const mesh = state.file.json.meshes?.[node.mesh];
	if (!mesh) return [];
	const name = mesh.name?.trim() || node.name?.trim() || "Model";
	const parts: Part[] = [];
	for (const [index, primitive] of mesh.primitives.entries()) {
		if ((primitive.targets?.length ?? 0) > 0) {
			say(
				state,
				"Morph targets. A mesh's blend shapes are not imported; it comes in at its base shape.",
			);
		}
		const read = readTriangles(state.file, primitive);
		if ("refused" in read) {
			say(state, `Part of “${name}” is not in the document because ${read.refused}.`);
			continue;
		}
		const scaled = scaleTriangles(read.triangles, scale);
		const bounds = boundsOf(scaled);
		parts.push({
			name: mesh.primitives.length > 1 ? `${name} ${index + 1}` : name,
			triangles: centreTriangles(scaled),
			centre: new Vector3(
				(bounds.min[0] + bounds.max[0]) / 2,
				(bounds.min[1] + bounds.max[1]) / 2,
				(bounds.min[2] + bounds.max[2]) / 2,
			),
			size: [
				bounds.max[0] - bounds.min[0],
				bounds.max[1] - bounds.min[1],
				bounds.max[2] - bounds.min[2],
			],
			props: materialProps(state, primitive.material),
		});
	}
	if (parts.length > 1) {
		say(
			state,
			"A mesh drawn in several materials arrives as several nodes — one per material — because a node has one fill. They sit together under the pivot the mesh came in on.",
		);
	}
	return parts;
}

/**
 * A glTF material as ordinary props: `fill`, `roughness`, `metalness`,
 * `opacity`.
 *
 * The mapping is a rename rather than an interpretation, which is not luck:
 * `PROPS.roughness` and `PROPS.metalness` were named after glTF's own
 * metallic-roughness model. What the document has no room for — every texture,
 * the emissive term, the alpha *mode*, single-sidedness and every
 * `KHR_materials_*` extension — is said once in the file's loss list.
 *
 * `baseColorFactor` is **linear** and a document's `fill` is a CSS colour, which
 * is sRGB. three.js's `Color` does that conversion and this file does not: it is
 * the same argument `units3.ts` makes about the Euler triple — a fact about a
 * colour space is not a fact about the document, and the library that owns the
 * convention should be the one that answers.
 */
function materialProps(
	state: Walk,
	index: number | undefined,
): Partial<Record<PropName, Value>> {
	if (index === undefined) return {};
	const material = state.file.json.materials?.[index];
	if (!material) return {};
	const pbr = material.pbrMetallicRoughness ?? {};
	if (
		pbr.baseColorTexture ||
		pbr.metallicRoughnessTexture ||
		material.normalTexture ||
		material.occlusionTexture ||
		material.emissiveTexture
	) {
		say(
			state,
			"Textures. A material becomes a fill, a roughness, a metalness and an opacity — four numbers a designer can edit and a token can drive. An image map is none of those and is dropped; the UV coordinates come along in the geometry, so a relinked texture would still land in the right place.",
		);
	}
	if ((material.emissiveFactor ?? [0, 0, 0]).some((v) => v > 0)) {
		say(
			state,
			"A material that glows arrives unlit: the document's surface has no emissive term, so the light it was giving off is gone and only the colour it was is here.",
		);
	}
	const props: Partial<Record<PropName, Value>> = {};
	const colour = pbr.baseColorFactor;
	if (colour) {
		props.fill = single(
			`#${new Color().setRGB(colour[0] ?? 1, colour[1] ?? 1, colour[2] ?? 1, "srgb-linear").getHexString("srgb")}`,
		);
		const alpha = colour[3] ?? 1;
		if (alpha < 1) props.opacity = single(ratio(alpha));
	}
	if (pbr.roughnessFactor !== undefined) props.roughness = single(ratio(pbr.roughnessFactor));
	if (pbr.metallicFactor !== undefined) props.metalness = single(ratio(pbr.metallicFactor));
	return props;
}

/**
 * A bare number, as a document value.
 *
 * Three decimals, which is finer than a slider and than any difference an eye
 * makes on a roughness, and which keeps `0.30000000000000004` — the float that a
 * file's own arithmetic hands over — out of a document people read.
 */
const ratio = (value: number): string => String(Math.round(value * 1000) / 1000);

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

/**
 * A frame, a third axis and a rotation, written the way the document spells
 * them.
 *
 * **`formatLength` rather than `writeLength`**, which is `makeFrame`'s one
 * difference from this, and it is deliberate. `writeLength` quantizes to a whole
 * pixel, and its own comment says why and says when not to: *"a hand moving a
 * mouse means a pixel"*, and *"a length a person typed does not come through
 * here… no pointer was involved"*. Nothing here came from a pointer. A chair is
 * 1.234 metres wide because a file says so, and rounding it to the nearest CSS
 * pixel on the way in would make the node's box disagree with the vertices
 * inside it — which is the one thing a `model`'s box is for.
 */
function placed(
	place: Vector3,
	rotation: Quaternion | undefined,
	size: EmuSize,
): Pick<SceneNode, "frame" | "spatial" | "turn"> {
	// The crossing, and the only one in this file: glTF is y-up and z-toward-the
	// viewer, the document is y-down and z-away. `F = diag(1, −1, −1)`, applied
	// to the point here and by conjugation to the rotation in `turnOf` — see
	// `units3.ts`, which makes the same crossing in the other direction and
	// writes out why a rotation does not cross the way a point does.
	const x = emuFromMetres(place.x) - size.width / 2;
	const y = emuFromMetres(-place.y) - size.height / 2;
	const z = emuFromMetres(-place.z) - size.depth / 2;
	const turn = rotation ? turnOf(rotation) : undefined;
	return {
		frame: {
			x: single(formatLength(Math.round(x))),
			y: single(formatLength(Math.round(y))),
			width: single(formatLength(size.width)),
			height: single(formatLength(size.height)),
		},
		// Sparse, which is `makeSpatial`'s rule and the no-regression story: a node
		// that sits on the origin plane with no depth holds nothing at all, and a
		// flat import of a flat file adds no third axis to the document.
		...(z !== 0 || size.depth !== 0
			? {
					spatial: {
						...(z !== 0 ? { z: single(formatLength(Math.round(z))) } : {}),
						...(size.depth !== 0 ? { depth: single(formatLength(size.depth)) } : {}),
					},
				}
			: {}),
		...(turn ? { turn } : {}),
	};
}

/**
 * A glTF rotation as the document's three angles.
 *
 * The inverse of `units3.ts`'s `worldEuler`, exactly: the Euler triple is
 * extracted in three.js's `XYZ` order — which `spatial.ts`'s `rotationMatrix` is
 * held equal to, element for element — and then y and z are **negated**, because
 * carrying a rotation across `F = diag(1, −1, −1)` is conjugation and
 * conjugating by `F` flips the sign of a turn about y and about z while leaving
 * one about x alone. `worldEuler` does the same two negations going the other
 * way, and `F` is its own inverse, so an import followed by an export is the
 * identity on every angle.
 *
 * Thousandths of a degree, rounded, because that is what `TURNS` stores and it
 * is finer than any screen resolves.
 */
function turnOf(rotation: Quaternion): SceneNode["turn"] | undefined {
	const euler = new Euler().setFromQuaternion(rotation, "XYZ");
	const mdeg = {
		rotateX: Math.round((euler.x * 180000) / Math.PI),
		rotateY: Math.round((-euler.y * 180000) / Math.PI),
		rotateZ: Math.round((-euler.z * 180000) / Math.PI),
	};
	const written = Object.entries(mdeg).filter(([, value]) => value !== 0);
	if (written.length === 0) return undefined;
	return Object.fromEntries(
		written.map(([axis, value]) => [axis, single(writeAngle(value))]),
	) as SceneNode["turn"];
}

/**
 * Three metre lengths as three EMU sizes.
 *
 * Unsigned, because a size is a magnitude: a mirrored node — a glTF `scale` with
 * a negative component, which is a perfectly ordinary thing for a modelling
 * package to write — has a negative extent in one axis and a box −100 wide is
 * not a thing. The mirroring itself is lost, and is named against the node.
 */
const sizeOf = (metres: readonly [number, number, number]): EmuSize => ({
	width: Math.abs(emuFromMetres(metres[0])),
	height: Math.abs(emuFromMetres(metres[1])),
	depth: Math.abs(emuFromMetres(metres[2])),
});

/**
 * The `model` node for one primitive, and the payload it addresses.
 *
 * The payload is written here rather than collected and written at the end
 * because the writer is cheap and the alternative — a second pass that has to
 * remember which soup belonged to which node — is exactly the bookkeeping that
 * goes wrong. What *is* deferred is the hash, which is asynchronous; the
 * `MeshRef` is built with an empty `asset` and `attach` fills it in, which is
 * the one mutation in this file and it is confined to one field of one object.
 */
function modelNode(
	state: Walk,
	part: Part,
	centre: Vector3,
	rotation: Quaternion | undefined,
): SceneNode {
	const writer = gltfWriter({ generator: "clingo-design import" });
	const mesh = writer.mesh(part.triangles, undefined, part.name);
	writer.roots([writer.node({ mesh, name: part.name })]);
	const bytes = new TextEncoder().encode(writer.text(false));
	const triangles = triangleCount(part.triangles);
	state.triangles += triangles;
	const size = sizeOf(part.size);
	const ref: MeshRef = {
		asset: "",
		format: "gltf",
		// The vertices were centred on their own origin on the way in, so the box
		// they occupy is centred too. Six numbers in the model's own space, which
		// is what `MeshRef.bounds` is defined to be.
		bounds: {
			x: -size.width / 2,
			y: -size.height / 2,
			z: -size.depth / 2,
			width: size.width,
			height: size.height,
			depth: size.depth,
		},
		triangles,
		...(state.source === undefined ? {} : { source: state.source }),
	};
	state.payloads.push({
		bytes,
		info: {
			format: "gltf",
			bytes: bytes.byteLength,
			triangles,
			name: part.name,
		},
		attach: (id) => {
			ref.asset = id;
		},
	});
	return {
		id: state.id(),
		kind: "model",
		name: part.name,
		...placed(centre, rotation, size),
		props: part.props,
		mesh: ref,
	};
}

/** A `pivot`: a place, a rotation, no size, and everything under it. */
function pivotNode(
	state: Walk,
	name: string,
	place: Vector3,
	rotation: Quaternion | undefined,
	children: SceneNode[],
): SceneNode {
	return {
		id: state.id(),
		kind: "pivot",
		name,
		...placed(place, rotation, NO_SIZE),
		props: {},
		children,
	};
}

/* ------------------------------------------------------------------ */
/* Cameras and lamps                                                   */
/* ------------------------------------------------------------------ */

/**
 * A glTF camera as a `camera` node — because a camera is an ordinary scene node
 * and always was.
 *
 * This is invariant 2 paying for itself at import time: there is no separate
 * "imported camera" concept to write, because the document already has a kind
 * whose props are a `fov`, a `near` and a `far`, and glTF's perspective camera
 * is those three numbers. A modelling package's carefully framed view arrives as
 * something the viewport can look through and the inspector can edit.
 *
 * An orthographic camera does not arrive, and is named: `KINDS.camera.props` is
 * three perspective numbers, and drawing an orthographic scene through a
 * perspective lens would be a picture the file did not describe.
 */
function cameraNode(state: Walk, node: GltfNode, index: number): SceneNode | undefined {
	if (node.camera === undefined) return undefined;
	const camera = state.file.json.cameras?.[node.camera];
	if (!camera) return undefined;
	if (camera.type !== "perspective" || !camera.perspective) {
		say(
			state,
			"An orthographic camera is not imported: a document's camera is a field of view, a near plane and a far plane, and an orthographic projection is none of those.",
		);
		return undefined;
	}
	const lens = camera.perspective;
	return {
		id: state.id(),
		kind: "camera",
		name: camera.name?.trim() || node.name?.trim() || `Camera ${index}`,
		frame: emptyFrame(),
		props: {
			// glTF's `yfov` is the vertical field of view in radians and `PROPS.fov`
			// is the same angle — three.js's `PerspectiveCamera.fov` is vertical too,
			// which is why `lensOf` hands it straight over.
			fov: single(writeAngle(Math.round((lens.yfov * 180000) / Math.PI))),
			near: single(formatLength(emuFromMetres(lens.znear))),
			...(lens.zfar === undefined
				? {}
				: { far: single(formatLength(emuFromMetres(lens.zfar))) }),
		},
	};
}

/**
 * A `KHR_lights_punctual` lamp as a `light` node.
 *
 * Three of glTF's four kinds are the document's four minus `ambient`, which
 * glTF has no punctual equivalent for — so nothing maps onto `ambient` and
 * nothing is lost by that: the arrow points the other way, and it is the
 * *export* that has to say something about an ambient lamp.
 *
 * **The intensity is not the same number and is not converted.** glTF's is
 * photometric — lux for a directional lamp, candela for a point or a spot — and
 * the document's is `PROPS.intensity`, a bare multiplier that `Lights.tsx` hands
 * to three.js with `decay: 0`, in a scene measured in CSS pixels. There is no
 * conversion between them that does not need a scene scale and a unit system the
 * document has not got, so the number comes across as itself and the difference
 * is named. Any other choice would be a magic constant nobody could predict from
 * the inspector.
 */
function lightNode(state: Walk, node: GltfNode, index: number): SceneNode | undefined {
	const which = node.extensions?.KHR_lights_punctual?.light;
	if (which === undefined) return undefined;
	const light: GltfLight | undefined =
		state.file.json.extensions?.KHR_lights_punctual?.lights?.[which];
	if (!light) return undefined;
	say(
		state,
		"A lamp's brightness is not the same number here. A glTF states it in lux or candela; a document states a plain multiplier that the renderer applies with no distance falloff, so an imported lamp keeps its colour and its direction and will want its brightness set by eye.",
	);
	if (light.spot && (light.spot.innerConeAngle ?? light.spot.outerConeAngle)) {
		say(
			state,
			"A spotlight's cone comes in at the renderer's own angle: the document's light has a lamp, a colour and a brightness, and no property for how wide the beam is.",
		);
	}
	const colour = light.color ?? [1, 1, 1];
	return {
		id: state.id(),
		kind: "light",
		name: light.name?.trim() || node.name?.trim() || `Light ${index}`,
		frame: emptyFrame(),
		props: {
			lamp: single(light.type),
			ink: single(
				`#${new Color().setRGB(colour[0] ?? 1, colour[1] ?? 1, colour[2] ?? 1, "srgb-linear").getHexString("srgb")}`,
			),
			intensity: single(ratio(light.intensity ?? 1)),
		},
	};
}

/**
 * A frame with nothing in it, for a marker kind.
 *
 * A camera and a light are `drawable: false` with a `defaultSize` of `0 × 0`:
 * what they contribute is a projection and a colour, never a silhouette. Where
 * one of these is the only thing on its glTF node, `placed` replaces this with
 * the node's own place; where it shares a node with geometry, it stays at its
 * pivot's origin, which is where the file put it.
 */
const emptyFrame = (): SceneNode["frame"] => ({
	x: single(formatLength(0)),
	y: single(formatLength(0)),
	width: single(formatLength(0)),
	height: single(formatLength(0)),
});

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

/**
 * The content hash, hex — the id an asset store keys a payload by.
 *
 * SHA-256 through `crypto.subtle`, which is what `docs/three-d-spec.md` §5.2
 * specifies for `AssetStore.put` and is the reason that method is asynchronous.
 * Web Crypto rather than a hash written here: it is in every browser and in
 * Node, it is the same digest on both, and two implementations of a content
 * address is two documents that disagree about whether they hold the same chair.
 */
async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
}
