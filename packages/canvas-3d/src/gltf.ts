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
