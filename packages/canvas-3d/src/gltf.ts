/**
 * glTF 2.0, read and written — the container, and nothing about the document.
 *
 * This is the codec both directions share: `gltfimport.ts` parses a file through
 * it and `gltfexport.ts` writes one through it, and neither of them knows what a
 * `bufferView` is. That split is worth the extra module because the two halves
 * would otherwise each grow their own idea of what an accessor is, and a
 * round-trip that reads with one idea and writes with another is a bug that only
 * shows up as geometry that is subtly wrong in the second lap.
 *
 * ## Why this is not three.js's `GLTFLoader` and `GLTFExporter`
 *
 * `three/examples/jsm` has both, and neither is usable here:
 *
 *   - `GLTFLoader` produces an `Object3D` tree — a *renderer's* answer. This
 *     package's import has to produce **document nodes**: a `pivot` per glTF
 *     node, a `model` per primitive, in the layer graph, with the materials as
 *     ordinary props. That is invariant 2 applied to imported content, and it is
 *     the whole reason import is worth having rather than an opaque blob. Going
 *     through an `Object3D` would mean decomposing matrices back out of a
 *     structure that had already thrown away the mesh-versus-primitive split
 *     that decides how many nodes there are.
 *   - `GLTFExporter` needs a live scene graph, which means a renderer, which
 *     means the exporter could not run in a `node --test` — and everything below
 *     is exercised headless, in this package, with no WebGL context in the room.
 *
 * What *is* taken from three.js is the arithmetic that is a fact about three.js's
 * own conventions rather than about glTF: `Quaternion` and `Euler` in
 * `gltfimport.ts`, and the six geometry constructors in `gltfexport.ts`. glTF's
 * coordinate system, its Euler-free rotations and its metre convention are the
 * same as three.js's, which is precisely why those two are allowed to answer.
 *
 * ## The subset
 *
 * Read: `scene`/`scenes`, `nodes` (TRS and `matrix`), `meshes` with
 * `TRIANGLES` primitives, `POSITION`/`NORMAL`/`TEXCOORD_0`, indices of every
 * unsigned component type, `materials`' metallic-roughness factors, GLB and
 * base64 `data:` buffers.
 *
 * Not read, and every one of them is named in the import's `lost` list rather
 * than silently dropped: external buffer URIs, sparse accessors, non-triangle
 * primitive modes, textures and samplers, skins, morph targets, animations,
 * `KHR_draco_mesh_compression` and every other extension.
 *
 * Written: exactly what {@link GltfWriter} exposes, which is what the document
 * has to say — geometry, metallic-roughness materials, perspective cameras and
 * `KHR_lights_punctual` lamps.
 */

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

/**
 * One metre, in EMU — **exactly**, which is the whole point of stating it.
 *
 * glTF has no unit field and its convention is metres. 1 in = 0.0254 m and
 * 1 in = 914400 EMU, so 1 m is 914400 / 0.0254 = 36,000,000 EMU: a whole number.
 * The one conversion this package makes on the way out therefore divides rather
 * than approximates, and a document measured in millimetres round-trips through
 * a glTF and back to the millimetre it was.
 *
 * **This constant belongs in `design-core/src/gltf.ts`**, which
 * `docs/merged-plan.md` M13 specifies and which is not in the tree. It is here
 * for the reason `readings.ts` gives about `materialOf`: the alternative was an
 * exporter that cannot convert. The day M13 lands, this block becomes two
 * re-export lines — the names are already the ones §6.2 froze, so nothing
 * downstream has to be renamed for that to happen.
 */
export const METRE_IN_EMU = 36_000_000;

/** EMU to metres, for the file. Exact — see {@link METRE_IN_EMU}. */
export const metresFromEmu = (emu: number): number => emu / METRE_IN_EMU;

/**
 * Metres back to EMU, rounded to the whole unit.
 *
 * Rounded rather than kept fractional because EMU is an integer by definition —
 * `units.ts` opens with that — and a float EMU would be a second kind of length
 * in a codebase whose central promise is that it has one. At 1/914400 inch the
 * rounding is roughly a nanometre, which is smaller than any modelling package's
 * own float32 vertex precision, so nothing observable survives it.
 */
export const emuFromMetres = (metres: number): number =>
	Math.round(metres * METRE_IN_EMU);

/* ------------------------------------------------------------------ */
/* The file, structurally                                              */
/* ------------------------------------------------------------------ */

/** A node's transform, either decomposed or as a column-major 4×4. */
export interface GltfNode {
	name?: string;
	children?: number[];
	mesh?: number;
	camera?: number;
	translation?: number[];
	rotation?: number[];
	scale?: number[];
	matrix?: number[];
	extensions?: { KHR_lights_punctual?: { light: number } };
}

export interface GltfPrimitive {
	attributes: Record<string, number>;
	indices?: number;
	material?: number;
	/** 4 is TRIANGLES, which is the only one with an answer here. */
	mode?: number;
	targets?: unknown[];
}

export interface GltfMesh {
	name?: string;
	primitives: GltfPrimitive[];
}

export interface GltfMaterial {
	name?: string;
	pbrMetallicRoughness?: {
		baseColorFactor?: number[];
		metallicFactor?: number;
		roughnessFactor?: number;
		baseColorTexture?: unknown;
		metallicRoughnessTexture?: unknown;
	};
	normalTexture?: unknown;
	occlusionTexture?: unknown;
	emissiveTexture?: unknown;
	emissiveFactor?: number[];
	alphaMode?: string;
	doubleSided?: boolean;
}

export interface GltfAccessor {
	bufferView?: number;
	byteOffset?: number;
	componentType: number;
	normalized?: boolean;
	count: number;
	type: string;
	min?: number[];
	max?: number[];
	sparse?: unknown;
}

export interface GltfBufferView {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
	byteStride?: number;
	target?: number;
}

export interface GltfBuffer {
	uri?: string;
	byteLength: number;
}

export interface GltfCamera {
	type: "perspective" | "orthographic";
	perspective?: { yfov: number; znear: number; zfar?: number; aspectRatio?: number };
	orthographic?: { xmag: number; ymag: number; znear: number; zfar: number };
	name?: string;
}

export interface GltfLight {
	type: "directional" | "point" | "spot";
	name?: string;
	color?: number[];
	intensity?: number;
	range?: number;
	spot?: { innerConeAngle?: number; outerConeAngle?: number };
}

export interface GltfJson {
	asset: { version: string; generator?: string; copyright?: string };
	scene?: number;
	scenes?: { name?: string; nodes?: number[] }[];
	nodes?: GltfNode[];
	meshes?: GltfMesh[];
	materials?: GltfMaterial[];
	accessors?: GltfAccessor[];
	bufferViews?: GltfBufferView[];
	buffers?: GltfBuffer[];
	cameras?: GltfCamera[];
	skins?: unknown[];
	animations?: unknown[];
	images?: unknown[];
	textures?: unknown[];
	extensionsUsed?: string[];
	extensionsRequired?: string[];
	extensions?: { KHR_lights_punctual?: { lights: GltfLight[] } };
}

/** A parsed file: the JSON, and every buffer it could actually reach. */
export interface GltfFile {
	json: GltfJson;
	/**
	 * Buffer index to its bytes. **Sparse on purpose**: a buffer with an external
	 * URI is not here, because this package has no filesystem and no fetch, and a
	 * reader that got an empty array back would draw an empty mesh rather than
	 * report a missing file.
	 */
	buffers: Map<number, Uint8Array>;
}

const GLB_MAGIC = 0x46546c67; // "glTF", little-endian
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const CHUNK_BIN = 0x004e4942; // "BIN\0"

/**
 * A `.glb` or a `.gltf`, whichever the bytes turn out to be.
 *
 * Sniffed rather than told, because a file picker hands over bytes and a name,
 * and a name is the least reliable thing about a file. The magic number is
 * twelve bits of certainty and the fallback — decode as UTF-8 and parse as JSON —
 * fails loudly on anything that is neither.
 *
 * Throws on a file it cannot read at all. That is the one place in this module
 * that throws, and it is deliberate: a malformed *container* is not a document
 * with something missing from it, it is not a glTF, and the caller has an error
 * to show a person who picked the wrong file. Everything the container can hold
 * but this codec cannot use is reported through `lost` instead.
 */
export function parseGltfFile(bytes: Uint8Array): GltfFile {
	const buffers = new Map<number, Uint8Array>();
	// A DataView over the exact window, so a Uint8Array that is a view into a
	// larger ArrayBuffer (which is what every subarray in here is) reads its own
	// bytes rather than the pool's.
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const binary = bytes.byteLength >= 12 && view.getUint32(0, true) === GLB_MAGIC;
	let json: GltfJson;
	if (binary) {
		let at = 12;
		let text: string | undefined;
		while (at + 8 <= bytes.byteLength) {
			const length = view.getUint32(at, true);
			const kind = view.getUint32(at + 4, true);
			const body = bytes.subarray(at + 8, at + 8 + length);
			if (kind === CHUNK_JSON) text = new TextDecoder().decode(body);
			// The BIN chunk is buffer 0 by the specification, and only buffer 0.
			else if (kind === CHUNK_BIN) buffers.set(0, body);
			at += 8 + length + ((4 - (length % 4)) % 4);
		}
		if (text === undefined) throw new Error("glTF: the binary file has no JSON chunk.");
		json = JSON.parse(text) as GltfJson;
	} else {
		json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
	}
	if (typeof json?.asset?.version !== "string") {
		throw new Error("glTF: no asset.version — this is not a glTF file.");
	}
	for (const [index, buffer] of (json.buffers ?? []).entries()) {
		if (buffers.has(index)) continue;
		const payload = dataUriBytes(buffer.uri);
		if (payload) buffers.set(index, payload);
	}
	return { json, buffers };
}

/** The bytes of a `data:` URI, or nothing for an external one — see {@link GltfFile}. */
function dataUriBytes(uri: string | undefined): Uint8Array | undefined {
	if (uri === undefined) return undefined;
	const comma = uri.indexOf(",");
	if (!uri.startsWith("data:") || comma < 0) return undefined;
	const head = uri.slice(0, comma);
	const body = uri.slice(comma + 1);
	return head.endsWith(";base64")
		? decodeBase64(body)
		: new TextEncoder().encode(decodeURIComponent(body));
}

/* ------------------------------------------------------------------ */
/* Geometry, normalised                                                */
/* ------------------------------------------------------------------ */

/**
 * One triangle soup, in the one shape both directions of this package speak.
 *
 * Deliberately the smallest thing that can be both read from an arbitrary file
 * and written back out: positions, optional normals, optional first UV set, and
 * indices — always present here even where the file had none, because "no
 * indices" is a statement about a file's encoding and not about a mesh, and
 * making every reader handle both spellings is how the two halves drift apart.
 *
 * Positions are in **metres, in glTF's own coordinate system** (x right, y up,
 * z toward the viewer) and they stay there. The crossing into the document's
 * y-down, z-away space happens once, on the *node's* transform, in
 * `gltfimport.ts` — never on the vertices. Rewriting a million positions to
 * flip two signs would be slower, lossier and, worst of all, would make the
 * payload something a `GLTFLoader` could no longer load unchanged.
 */
export interface Triangles {
	positions: Float32Array;
	normals?: Float32Array;
	uvs?: Float32Array;
	indices: Uint32Array;
}

/** An axis-aligned box in glTF's space, in metres. */
export interface MetreBounds {
	min: [number, number, number];
	max: [number, number, number];
}

const COMPONENT_BYTES: Record<number, number> = {
	5120: 1, // BYTE
	5121: 1, // UNSIGNED_BYTE
	5122: 2, // SHORT
	5123: 2, // UNSIGNED_SHORT
	5125: 4, // UNSIGNED_INT
	5126: 4, // FLOAT
};

const TYPE_COMPONENTS: Record<string, number> = {
	SCALAR: 1,
	VEC2: 2,
	VEC3: 3,
	VEC4: 4,
	MAT4: 16,
};

/**
 * An accessor as plain numbers, `count × components` of them, or nothing.
 *
 * Nothing rather than an exception for a sparse accessor, an external buffer or
 * a component type outside the table: each of those is a *file* saying something
 * this codec cannot read, the caller has a `lost` list to say so in, and a throw
 * would turn one unreadable attribute into an unimportable file.
 *
 * `byteStride` is honoured, which is what makes an interleaved buffer — what
 * every optimised exporter writes — readable rather than scrambled.
 */
export function readAccessor(
	file: GltfFile,
	index: number | undefined,
): Float64Array | undefined {
	if (index === undefined) return undefined;
	const accessor = file.json.accessors?.[index];
	if (!accessor || accessor.sparse !== undefined) return undefined;
	const components = TYPE_COMPONENTS[accessor.type];
	const size = COMPONENT_BYTES[accessor.componentType];
	if (components === undefined || size === undefined) return undefined;
	const out = new Float64Array(accessor.count * components);
	if (accessor.bufferView === undefined) return out; // Legally all zeroes.
	const bufferView = file.json.bufferViews?.[accessor.bufferView];
	if (!bufferView) return undefined;
	const bytes = file.buffers.get(bufferView.buffer);
	if (!bytes) return undefined;
	const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	const stride = bufferView.byteStride ?? size * components;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let i = 0; i < accessor.count; i++) {
		for (let c = 0; c < components; c++) {
			const at = base + i * stride + c * size;
			if (at + size > bytes.byteLength) return undefined;
			out[i * components + c] = readComponent(view, at, accessor.componentType);
		}
	}
	return out;
}

function readComponent(view: DataView, at: number, componentType: number): number {
	switch (componentType) {
		case 5120:
			return view.getInt8(at);
		case 5121:
			return view.getUint8(at);
		case 5122:
			return view.getInt16(at, true);
		case 5123:
			return view.getUint16(at, true);
		case 5125:
			return view.getUint32(at, true);
		default:
			return view.getFloat32(at, true);
	}
}

/**
 * One primitive as a {@link Triangles}, or nothing with the reason said out
 * loud.
 *
 * The reason comes back as a string rather than being logged, because the
 * caller is building an import report and a console message is not a report. A
 * `mode` that is not `TRIANGLES` is the common one — a point cloud and a line
 * set are perfectly legal glTF and there is no document node that is either.
 */
export function readTriangles(
	file: GltfFile,
	primitive: GltfPrimitive,
): { triangles: Triangles } | { refused: string } {
	if (primitive.mode !== undefined && primitive.mode !== 4) {
		return { refused: "it is not made of triangles" };
	}
	const positions = readAccessor(file, primitive.attributes?.POSITION);
	if (!positions || positions.length === 0) {
		return { refused: "its vertex positions are in a form this reader cannot follow" };
	}
	const count = positions.length / 3;
	const indices = readAccessor(file, primitive.indices);
	const normals = readAccessor(file, primitive.attributes?.NORMAL);
	const uvs = readAccessor(file, primitive.attributes?.TEXCOORD_0);
	return {
		triangles: {
			positions: Float32Array.from(positions),
			...(normals && normals.length === count * 3
				? { normals: Float32Array.from(normals) }
				: {}),
			...(uvs && uvs.length === count * 2 ? { uvs: Float32Array.from(uvs) } : {}),
			indices: indices
				? Uint32Array.from(indices)
				: Uint32Array.from({ length: count }, (_, i) => i),
		},
	};
}

/**
 * The box a triangle soup occupies, in metres.
 *
 * Computed from the positions rather than read from the accessor's `min`/`max`,
 * even though glTF requires those on a POSITION accessor. Two reasons and both
 * are about trust: a file's stated bounds are a claim rather than a measurement
 * and exporters do get them wrong, and the same function has to answer for
 * geometry this package tessellated itself, which has no accessor to ask.
 */
export function boundsOf(triangles: Triangles): MetreBounds {
	const min: [number, number, number] = [Infinity, Infinity, Infinity];
	const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
	const { positions } = triangles;
	for (let i = 0; i + 2 < positions.length; i += 3) {
		for (let axis = 0; axis < 3; axis++) {
			const v = positions[i + axis] ?? 0;
			if (v < min[axis]) min[axis] = v;
			if (v > max[axis]) max[axis] = v;
		}
	}
	// An empty soup has no box. Zero rather than infinities, so that arithmetic
	// downstream produces a degenerate node rather than a NaN one — a mesh with
	// no vertices in it is a thing a file can contain.
	if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
	return { min, max };
}

/** How many triangles a soup holds — the number `tris/2` carries. */
export const triangleCount = (triangles: Triangles): number =>
	Math.floor(triangles.indices.length / 3);

/**
 * The same soup, moved so its bounding box is centred on the origin.
 *
 * Every consumer in this package assumes a payload's geometry is centred in the
 * box the node states, because that is what `Model.tsx` draws and what a node's
 * rotation — which is about its **centre** — means. glTF assumes nothing of the
 * sort: a chair exported from a modelling package usually sits with its feet on
 * y = 0. So the offset is taken out of the vertices exactly once, here, on the
 * way into the document, and the node's own frame carries it instead.
 *
 * The alternative was to keep the vertices as they were and give the node a
 * "geometry offset" field. That is a field `SceneNode` does not have, that every
 * rule and every gesture would have to learn, and it would mean a `model`'s box
 * was not where its picture is — which is the one thing a box is for.
 */
export function centreTriangles(triangles: Triangles): Triangles {
	const { min, max } = boundsOf(triangles);
	const centre = [
		(min[0] + max[0]) / 2,
		(min[1] + max[1]) / 2,
		(min[2] + max[2]) / 2,
	];
	if (centre.every((c) => c === 0)) return triangles;
	const positions = Float32Array.from(triangles.positions);
	for (let i = 0; i + 2 < positions.length; i += 3) {
		positions[i] = (positions[i] ?? 0) - (centre[0] ?? 0);
		positions[i + 1] = (positions[i + 1] ?? 0) - (centre[1] ?? 0);
		positions[i + 2] = (positions[i + 2] ?? 0) - (centre[2] ?? 0);
	}
	return { ...triangles, positions };
}

/** The same soup, with every position multiplied componentwise. */
export function scaleTriangles(
	triangles: Triangles,
	scale: readonly [number, number, number],
): Triangles {
	if (scale[0] === 1 && scale[1] === 1 && scale[2] === 1) return triangles;
	const positions = Float32Array.from(triangles.positions);
	for (let i = 0; i + 2 < positions.length; i += 3) {
		positions[i] = (positions[i] ?? 0) * scale[0];
		positions[i + 1] = (positions[i + 1] ?? 0) * scale[1];
		positions[i + 2] = (positions[i + 2] ?? 0) * scale[2];
	}
	// Under a *uniform* scale the normals are unchanged and come along. Under a
	// non-uniform one they are **dropped rather than rescaled**: the correct
	// answer is the inverse transpose, and writing it here would be writing a
	// normal matrix into a payload that a renderer is going to apply its own to.
	// Dropping is stated rather than approximated, and it is the safe half of the
	// choice — every loader recomputes absent normals flat, and none of them
	// repairs wrong ones.
	const uniform = scale[0] === scale[1] && scale[1] === scale[2];
	return {
		positions,
		...(uniform && triangles.normals ? { normals: triangles.normals } : {}),
		...(triangles.uvs ? { uvs: triangles.uvs } : {}),
		indices: triangles.indices,
	};
}

/* ------------------------------------------------------------------ */
/* One part of a file, normalised                                      */
/* ------------------------------------------------------------------ */

/**
 * **The one normalisation**, and the reason the rest of this section exists.
 *
 * A `model` node used to reference a *payload*: a standalone single-primitive
 * glTF the importer wrote, already scaled and already centred, addressed by the
 * hash of its bytes. It references a **file and a part of it** instead — the
 * file the person imported, under the name they gave it, in the project's tree
 * — which is what makes replacing the file replace the chair everywhere it is
 * drawn. `docs/model-files.md` §0 argues that trade and this is the bill for it:
 *
 * > The importer used to bake the normalisation into the bytes it stored. With
 * > the original file in the tree, the loader has to reproduce that
 * > normalisation exactly, or the geometry will not sit in the box the solver
 * > placed.
 *
 * The two halves that must agree are in different packages, run at different
 * times, and are exercised by different tests — so the rule is that they are not
 * two halves. {@link meshPart} is the **only** place a primitive becomes
 * geometry, and its three callers are `gltfimport.ts` (which measures the box),
 * `useAsset.ts` (which draws it) and `gltfexport.ts` (which writes it back out).
 * The half of that rule which is easy to lose is the importer's: it must
 * **stop** scaling and centring on its own — it keeps threading `parentScale`,
 * because it still needs that to place children and to name a shear, but the
 * geometry comes back from here. Then "what the box was measured from" and "what
 * the renderer draws" are the same array by construction rather than by
 * agreement, which is the only kind of agreement that survives a year of edits
 * to three files.
 *
 * ## What "normalised" means, exactly — three steps, in this order
 *
 * 1. {@link readTriangles} the primitive;
 * 2. {@link scaleTriangles} by {@link partScale} — the product of the `scale`
 *    components from the default scene's root down to this node **inclusive**,
 *    with `scaleTriangles`'s own rule about normals under a non-uniform scale;
 * 3. {@link centreTriangles}, and measure the box that results.
 *
 * The **translation and the rotation are not applied**, and that is not an
 * omission. `gltfimport.ts` keeps them: a glTF node becomes a zero-sized `pivot`
 * carrying its `T` and `R`, and a collapsed leaf carries `place + R·centre` and
 * a `turn`. Baking the world transform into the vertices here would be a second,
 * incompatible normalisation — and it would throw away the pivots, which are the
 * part of an import a designer can actually grab hold of. The scale is the only
 * component of a glTF transform a document node has no home for, because a
 * document node's size *is* its box, so the scale is the only one that goes into
 * the geometry.
 *
 * ## Where this lives
 *
 * `docs/model-files.md` §3 specifies a sibling module, `meshpart.ts`, on the
 * argument that this is a *policy over* the codec rather than codec. The policy
 * is here, in the codec, because it has exactly the codec's dependencies —
 * none, not even three.js — and its three callers already import this module for
 * `parseGltfFile` and `boundsOf`, so a second module would have bought a second
 * import path and nothing else. Everything below is exported, so if it ever
 * grows a dependency on the *document* — a `SceneNode`, a `Value`, a unit — that
 * is the day it moves out, and moving it is a rename.
 */

/** Which part of a file: two indices into the file's own arrays, and nothing derived. */
export interface PartRef {
	/**
	 * The **glTF node** index — not a document node id, and not a mesh index.
	 *
	 * The node rather than the mesh because the node is what the scale chain is
	 * computed from: one mesh instanced by two nodes at two scales is two
	 * different pieces of geometry, and a mesh index alone could not tell them
	 * apart. The mesh is `json.nodes[node].mesh`, so storing it too would be a
	 * second address for one thing and would spell `node.mesh.mesh`.
	 */
	node: number;
	/** Which primitive of that node's mesh — a mesh in three materials has three. */
	primitive: number;
}

/** One primitive, selected and normalised — everything a caller needs and no document in it. */
export interface MeshPart {
	/**
	 * Scaled by the chain and centred on its own origin, in metres, in glTF's own
	 * axes. The crossing into the document's y-down space happens on the node's
	 * transform and never on the vertices — see {@link Triangles}.
	 */
	triangles: Triangles;
	/** The box those triangles occupy: measured, and centred to within a float. */
	bounds: MetreBounds;
	/**
	 * The offset {@link centreTriangles} took *out* of the vertices, in the glTF
	 * node's own frame, in metres.
	 *
	 * Not in `docs/model-files.md` §3's list of fields, and it has to be: the
	 * importer places a collapsed leaf at `place + R·centre`, which is the exact
	 * bridge between glTF placing a mesh by its node's origin and the document
	 * placing a `model` by the box its vertices occupy. Without this number here
	 * the importer would have to re-derive it from the uncentred soup — which
	 * means running two of the three steps a second time, on its own, which is
	 * precisely the second implementation this function exists to prevent.
	 */
	centre: readonly [number, number, number];
	/** What the importer calls the node — the file's name for the mesh, or the node's. */
	name: string;
	/** The file's material index for this primitive, for the importer's props. */
	material?: number;
	/** The accumulated scale, so a caller can name the mirror or the shear it implies. */
	scale: readonly [number, number, number];
}

/** One primitive of one node, in the order the file lists them, refusals included. */
export interface MeshPartEntry {
	ref: PartRef;
	part: MeshPart | { refused: string };
}

/**
 * One part, normalised — or a refusal, in {@link readTriangles}'s own manner.
 *
 * Every refusal is a clause that completes "…is not in the document because
 * ___", because that is the sentence the import report and the studio's relink
 * list are both built out of. **Nothing here throws**, and that is load-bearing
 * rather than tidy: a stale `MeshRef` — one whose file was replaced by a
 * structurally different file at the same path — reaches this function in the
 * wild, on a render, and a renderer that threw would take the viewport down over
 * a chair that should have drawn its stand-in box.
 */
export function meshPart(file: GltfFile, ref: PartRef): MeshPart | { refused: string } {
	const node = file.json.nodes?.[ref.node];
	if (!node) return { refused: `the file has no node ${ref.node}` };
	if (node.mesh === undefined) return { refused: `node ${ref.node} of the file draws no mesh` };
	const mesh = file.json.meshes?.[node.mesh];
	if (!mesh) return { refused: `the file has no mesh ${node.mesh}` };
	const primitive = mesh.primitives?.[ref.primitive];
	if (!primitive) {
		return {
			refused: `that mesh has no part ${ref.primitive} — the file has changed since this was imported`,
		};
	}
	const read = readTriangles(file, primitive);
	if ("refused" in read) return read;

	const scale = partScale(file, ref.node);
	const scaled = scaleTriangles(read.triangles, scale);
	// Measured *before* centring, because this is the number the centring removes
	// and the importer needs it to place the node. Both come off one measurement
	// of one array, so they cannot disagree about where the middle is.
	const box = boundsOf(scaled);
	const triangles = centreTriangles(scaled);
	return {
		triangles,
		// Measured again rather than asserted as ±half the extent: `boundsOf`'s own
		// comment is that a stated box is a claim and a measured one is a fact, and
		// the fact is what the renderer's fit has to be computed from.
		bounds: boundsOf(triangles),
		centre: [
			(box.min[0] + box.max[0]) / 2,
			(box.min[1] + box.max[1]) / 2,
			(box.min[2] + box.max[2]) / 2,
		],
		name: partName(file, ref),
		...(primitive.material === undefined ? {} : { material: primitive.material }),
		scale,
	};
}

/**
 * Every part of one glTF node, in the file's own order, refusals in place.
 *
 * **Refusals stay in the list rather than being filtered out of it**, and that is
 * the whole reason this returns a `{ ref, part }` pair instead of an array of
 * parts. A mesh whose first primitive is a point cloud and whose second is
 * triangles must produce a node addressing `primitive: 1`; a filtered list would
 * hand the caller index `0` for it and the node would draw the point cloud —
 * except that it cannot be drawn, so it would draw nothing, from a reference
 * that looks perfectly well-formed. The caller also has an import report to fill
 * in, and a part that vanished silently is a sentence it cannot write.
 *
 * An empty list for a node with no mesh, a mesh the file does not hold, or an
 * index out of range: those are not refusals about a *part*, they are a node
 * with no parts, which is most of a glTF's nodes.
 */
export function meshParts(file: GltfFile, node: number): MeshPartEntry[] {
	const mesh = file.json.meshes?.[file.json.nodes?.[node]?.mesh ?? -1];
	if (!mesh) return [];
	return mesh.primitives.map((_, primitive) => {
		const ref: PartRef = { node, primitive };
		return { ref, part: meshPart(file, ref) };
	});
}

/**
 * The name the importer gives one part.
 *
 * The mesh's name, then the node's, then a word — and a suffix only where the
 * mesh has more than one primitive, because a mesh drawn in three materials
 * becomes three nodes and three rows in the layer list called the same thing is
 * three rows nobody can tell apart. Numbered from one, because the layer list is
 * read by a person.
 */
function partName(file: GltfFile, ref: PartRef): string {
	const node = file.json.nodes?.[ref.node];
	const mesh = file.json.meshes?.[node?.mesh ?? -1];
	const name = mesh?.name?.trim() || node?.name?.trim() || "Model";
	return (mesh?.primitives.length ?? 0) > 1 ? `${name} ${ref.primitive + 1}` : name;
}

/**
 * The accumulated scale above and including one node — the chain the geometry
 * is baked with.
 *
 * Derived from the file alone, and that is the point of it. The importer already
 * knows this number: it threads `parentScale` down its own recursive walk, which
 * it still needs for placing children and for naming a shear. But the *loader*
 * has only a file and a `PartRef`, months later, in another package — so if the
 * chain were only obtainable by walking the whole file the way the importer
 * walks it, the loader would grow a second walk, and the two walks would drift
 * exactly the way §0 says the two normalisations would. `gltfimport.test.ts`
 * asserts the derived chain equals the threaded one, which is what keeps the
 * importer's walk honest rather than authoritative.
 *
 * The product is taken **from the root down**, one multiplication per level,
 * which is the order the threaded walk uses — so the two agree bit for bit and
 * not merely to within a float.
 */
export function partScale(file: GltfFile, node: number): [number, number, number] {
	const parents = parentIndex(file);
	// Up to the root collecting, then down multiplying: a fold from the far end
	// would be the same arithmetic in a different order, and float multiplication
	// is not associative.
	const chain: number[] = [];
	const seen = new Set<number>();
	for (let at: number | undefined = node; at !== undefined && !seen.has(at); ) {
		seen.add(at);
		chain.push(at);
		at = parents.get(at);
	}
	const scale: [number, number, number] = [1, 1, 1];
	for (let i = chain.length - 1; i >= 0; i--) {
		const local = localScale(file.json.nodes?.[chain[i] ?? -1]);
		scale[0] *= local[0];
		scale[1] *= local[1];
		scale[2] *= local[2];
	}
	return scale;
}

/**
 * A node's own scale, however the file chose to spell its transform.
 *
 * The matrix case is three.js's `Matrix4.decompose` written out, deliberately to
 * the letter: the scales are the lengths of the three basis columns and a
 * negative determinant is charged to **x** alone. That last rule is arbitrary —
 * a matrix that mirrors says nothing about *which* axis was flipped — so the
 * only thing that matters is that everybody makes the same arbitrary choice, and
 * `gltfimport.ts` decomposes with three.js. `Math.sqrt` of the sum of squares
 * rather than `Math.hypot` for the same reason and it is not pedantry:
 * `Vector3.length` is the former, the two differ in the last bit, and this
 * number multiplies a million vertices.
 *
 * The determinant is the 3×3 one. A glTF node's matrix is required to be
 * decomposable into TRS, so its bottom row is `0 0 0 1` and the 4×4 determinant
 * three.js takes is equal to it.
 */
function localScale(node: GltfNode | undefined): readonly [number, number, number] {
	if (!node) return [1, 1, 1];
	const m = node.matrix;
	if (m && m.length === 16) {
		const length = (a: number, b: number, c: number): number =>
			Math.sqrt(
				(m[a] ?? 0) * (m[a] ?? 0) + (m[b] ?? 0) * (m[b] ?? 0) + (m[c] ?? 0) * (m[c] ?? 0),
			);
		const sx = length(0, 1, 2);
		const sy = length(4, 5, 6);
		const sz = length(8, 9, 10);
		return [determinant3(m) < 0 ? -sx : sx, sy, sz];
	}
	const s = node.scale;
	return s && s.length === 3 ? [s[0] ?? 1, s[1] ?? 1, s[2] ?? 1] : [1, 1, 1];
}

/** The determinant of a column-major 4×4's upper-left 3×3 — see {@link localScale}. */
function determinant3(m: readonly number[]): number {
	const a = m[0] ?? 0;
	const b = m[4] ?? 0;
	const c = m[8] ?? 0;
	const d = m[1] ?? 0;
	const e = m[5] ?? 0;
	const f = m[9] ?? 0;
	const g = m[2] ?? 0;
	const h = m[6] ?? 0;
	const i = m[10] ?? 0;
	return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * Child index to parent index, built once per parsed file.
 *
 * glTF states the hierarchy downwards — a node lists its `children` — and every
 * question here is asked upwards, so the edges are inverted once. A node
 * hierarchy is a strict tree by the specification: **first parent wins** where a
 * malformed file lists a node under two, which is a choice rather than an error
 * because a chair with a duplicated child should still import.
 *
 * Memoised on the parsed file rather than recomputed per part, because a
 * document with ten parts of one chair calls {@link meshPart} ten times on one
 * `GltfFile` and this walk is over every node in it. The staleness trap is named
 * rather than guarded: the map is keyed by the `GltfFile` *object*, so a file
 * that is parsed again gets a fresh entry and a file that is mutated after a
 * part has been read does not. Nothing mutates a parsed file today — the one
 * mutable `GltfJson` in this module belongs to {@link gltfWriter}, which nobody
 * asks for a part of — and the day something does, this is the line that is
 * wrong.
 */
const PARENTS = new WeakMap<GltfFile, Map<number, number>>();

function parentIndex(file: GltfFile): Map<number, number> {
	const known = PARENTS.get(file);
	if (known) return known;
	const parents = new Map<number, number>();
	for (const [index, node] of (file.json.nodes ?? []).entries()) {
		for (const child of node.children ?? []) {
			if (!parents.has(child) && child !== index) parents.set(child, index);
		}
	}
	PARENTS.set(file, parents);
	return parents;
}

/**
 * How much to scale a part's own box to fill a node's box, per axis.
 *
 * The geometry comes back from {@link meshPart} in **metres**, not in a unit
 * box, so every consumer that draws it into a node's frame divides by its extent
 * — and they all divide the same way, here, which is the point.
 *
 * *Rejected: normalising into a unit box inside `meshPart`.* It would delete
 * this function and make a renderer's `scale = size` correct as written, but it
 * bakes a division into the vertices: the exporter would then write a chair
 * whose coordinates are nothing the file ever contained, and the day somebody
 * wants the file's own numbers back there is nowhere to get them. The division
 * belongs in the drawing, which is where the box is.
 *
 * `1` where either side is zero, which covers the two real cases — a flat part
 * (a plane has no thickness and no scale makes it thick) and a node whose depth
 * the document never stated. Dividing anyway gives `0` or `Infinity`, and both
 * of those are a mesh nobody can see.
 */
export function fitScale(
	bounds: MetreBounds,
	size: readonly [number, number, number],
): [number, number, number] {
	const fit = (want: number, have: number): number =>
		want === 0 || have === 0 ? 1 : want / have;
	return [
		fit(size[0], bounds.max[0] - bounds.min[0]),
		fit(size[1], bounds.max[1] - bounds.min[1]),
		fit(size[2], bounds.max[2] - bounds.min[2]),
	];
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/** A metallic-roughness material, in glTF's own numbers: linear, 0..1. */
export interface MaterialSpec {
	name?: string;
	/** Linear RGB, 0..1. */
	baseColour?: [number, number, number];
	opacity?: number;
	metallic?: number;
	roughness?: number;
}

export interface GltfWriter {
	/** Interns a material and answers its index — identical specs share one. */
	material(spec: MaterialSpec): number;
	/** Writes a triangle soup as a single-primitive mesh; answers its index. */
	mesh(triangles: Triangles, material: number | undefined, name?: string): number;
	/** Writes several primitives as one mesh — a model's own split, preserved. */
	meshOf(
		parts: readonly { triangles: Triangles; material: number | undefined }[],
		name?: string,
	): number;
	camera(camera: GltfCamera): number;
	light(light: GltfLight): number;
	node(node: GltfNode): number;
	/** The nodes the scene starts from, in order, and what to call the scene. */
	roots(indices: readonly number[], name?: string): void;
	/** The finished file, as glTF JSON text — one embedded base64 buffer. */
	text(indent?: boolean): string;
	/** The finished file, for a caller that wants to keep reading it. */
	json(): GltfJson;
}

/**
 * A writer that accumulates one buffer and hands back a `.gltf`.
 *
 * **JSON with an embedded `data:` buffer rather than a `.glb`**, and that is the
 * one format decision here. A `.glb` is smaller and is what a game engine wants;
 * a `.gltf` is text, which means it diffs, it can be read in the export panel
 * beside the HTML and the SVG the other targets produce, and it is one string
 * rather than a byte array — and `ExportResult.text` is a `string`, so a binary
 * target would have needed a second shape all the way up through the panel.
 * `docs/three-d-spec.md` §10.3 names the mime type `model/gltf+json` and the
 * extension `gltf`, which is the same decision made upstream.
 *
 * The cost is base64: a third larger than the bytes it carries. Stated rather
 * than hidden, and it is the reason `meshOf` interns nothing — a caller that
 * wants a small file writes fewer meshes, not a cleverer writer.
 */
export function gltfWriter(options: { generator?: string } = {}): GltfWriter {
	const json: GltfJson = {
		asset: {
			version: "2.0",
			...(options.generator ? { generator: options.generator } : {}),
		},
		scene: 0,
		scenes: [{ nodes: [] }],
		nodes: [],
	};
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	const materials = new Map<string, number>();

	/** Appends bytes to the one buffer, 4-byte aligned, and answers the view. */
	const write = (bytes: Uint8Array, stride: number | undefined): number => {
		// glTF requires an accessor's offset to be a multiple of its component
		// size, and every component here is 1, 2 or 4 bytes, so 4-byte alignment
		// satisfies all of them at once.
		const pad = (4 - (byteLength % 4)) % 4;
		if (pad > 0) {
			chunks.push(new Uint8Array(pad));
			byteLength += pad;
		}
		const views = (json.bufferViews ??= []);
		views.push({
			buffer: 0,
			byteOffset: byteLength,
			byteLength: bytes.byteLength,
			...(stride === undefined ? {} : { byteStride: stride }),
		});
		chunks.push(bytes);
		byteLength += bytes.byteLength;
		return views.length - 1;
	};

	const accessor = (spec: GltfAccessor): number => {
		const list = (json.accessors ??= []);
		list.push(spec);
		return list.length - 1;
	};

	const floats = (
		data: Float32Array,
		type: "VEC3" | "VEC2",
		bounds?: MetreBounds,
	): number => {
		const size = type === "VEC3" ? 3 : 2;
		const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		// A fresh copy, because `data` may be a view into a larger buffer that the
		// caller still owns and the writer holds on to these until `text()`.
		const view = write(Uint8Array.from(bytes), size * 4);
		return accessor({
			bufferView: view,
			componentType: 5126,
			count: data.length / size,
			type,
			// `min`/`max` are required on POSITION and are what a loader uses to
			// build a bounding box without touching the vertices.
			...(bounds ? { min: bounds.min, max: bounds.max } : {}),
		});
	};

	const primitiveOf = (
		triangles: Triangles,
		material: number | undefined,
	): GltfPrimitive => {
		const position = floats(triangles.positions, "VEC3", boundsOf(triangles));
		const attributes: Record<string, number> = { POSITION: position };
		if (triangles.normals) attributes.NORMAL = floats(triangles.normals, "VEC3");
		if (triangles.uvs) attributes.TEXCOORD_0 = floats(triangles.uvs, "VEC2");
		const data = Uint32Array.from(triangles.indices);
		const view = write(
			new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
			undefined,
		);
		const indices = accessor({
			bufferView: view,
			componentType: 5125,
			count: data.length,
			type: "SCALAR",
		});
		return {
			attributes,
			indices,
			mode: 4,
			...(material === undefined ? {} : { material }),
		};
	};

	const addMesh = (primitives: GltfPrimitive[], name: string | undefined): number => {
		const list = (json.meshes ??= []);
		list.push({ primitives, ...(name === undefined ? {} : { name }) });
		return list.length - 1;
	};

	return {
		material(spec) {
			const key = JSON.stringify(spec);
			const seen = materials.get(key);
			if (seen !== undefined) return seen;
			const list = (json.materials ??= []);
			const opacity = spec.opacity ?? 1;
			const colour = spec.baseColour;
			list.push({
				...(spec.name === undefined ? {} : { name: spec.name }),
				pbrMetallicRoughness: {
					...(colour
						? { baseColorFactor: [colour[0], colour[1], colour[2], opacity] }
						: opacity < 1
							? { baseColorFactor: [1, 1, 1, opacity] }
							: {}),
					...(spec.metallic === undefined ? {} : { metallicFactor: spec.metallic }),
					...(spec.roughness === undefined ? {} : { roughnessFactor: spec.roughness }),
				},
				// `BLEND` rather than `MASK`, and only where it was asked for: an
				// opaque material that declares blending is sorted per frame by every
				// renderer that loads it, which is a cost the document did not ask for.
				...(opacity < 1 ? { alphaMode: "BLEND" } : {}),
				// A solid is a closed surface and a document's meshes are drawn from
				// both sides on the canvas, where nothing back-face culls. Saying so
				// keeps the file looking like the viewport it came from.
				doubleSided: true,
			});
			const index = list.length - 1;
			materials.set(key, index);
			return index;
		},
		mesh(triangles, material, name) {
			return addMesh([primitiveOf(triangles, material)], name);
		},
		meshOf(parts, name) {
			return addMesh(
				parts.map((part) => primitiveOf(part.triangles, part.material)),
				name,
			);
		},
		camera(camera) {
			const list = (json.cameras ??= []);
			list.push(camera);
			return list.length - 1;
		},
		light(light) {
			const used = (json.extensionsUsed ??= []);
			if (!used.includes(KHR_LIGHTS)) used.push(KHR_LIGHTS);
			const extensions = (json.extensions ??= {});
			const lights = (extensions.KHR_lights_punctual ??= { lights: [] });
			lights.lights.push(light);
			return lights.lights.length - 1;
		},
		node(node) {
			const list = (json.nodes ??= []);
			list.push(node);
			return list.length - 1;
		},
		roots(indices, name) {
			json.scenes = [
				{ nodes: [...indices], ...(name === undefined ? {} : { name }) },
			];
		},
		json() {
			return finish();
		},
		text(indent = true) {
			return JSON.stringify(finish(), null, indent ? "\t" : undefined);
		},
	};

	function finish(): GltfJson {
		if (byteLength === 0) return json;
		const all = new Uint8Array(byteLength);
		let at = 0;
		for (const chunk of chunks) {
			all.set(chunk, at);
			at += chunk.byteLength;
		}
		json.buffers = [
			{
				byteLength,
				uri: `data:application/octet-stream;base64,${encodeBase64(all)}`,
			},
		];
		return json;
	}
}

/** The extension every punctual light in a glTF is declared under. */
export const KHR_LIGHTS = "KHR_lights_punctual";

/* ------------------------------------------------------------------ */
/* base64                                                              */
/* ------------------------------------------------------------------ */

/*
 * Written out rather than reached for, and the reason is neither performance nor
 * pride: `btoa` is a DOM global, `Buffer` is a Node one, and this module is
 * imported by a React component in a browser *and* by a `node --test` with no
 * DOM. Picking either would have meant a runtime check at the bottom of a codec,
 * which is a thing that works until it does not. Sixteen lines of table lookup
 * work identically in both and can be tested in one.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] ?? 0;
		const b = bytes[i + 1] ?? 0;
		const c = bytes[i + 2] ?? 0;
		const word = (a << 16) | (b << 8) | c;
		const rest = bytes.length - i;
		out += ALPHABET[(word >> 18) & 63];
		out += ALPHABET[(word >> 12) & 63];
		out += rest > 1 ? ALPHABET[(word >> 6) & 63] : "=";
		out += rest > 2 ? ALPHABET[word & 63] : "=";
	}
	return out;
}

export function decodeBase64(text: string): Uint8Array {
	const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let at = 0;
	let word = 0;
	let bits = 0;
	for (const character of clean) {
		word = (word << 6) | ALPHABET.indexOf(character);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[at++] = (word >> bits) & 0xff;
		}
	}
	return out.subarray(0, at);
}
