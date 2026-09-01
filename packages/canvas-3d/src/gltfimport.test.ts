/**
 * Import: a file becomes nodes, and the nodes stand where the file said.
 *
 * The centrepiece is the last test and it is the only one that could really
 * fail. Everything else here checks a mapping — a material became props, a mesh
 * became a `model`, a camera became a `camera` — and those are readable from the
 * code. What is *not* readable from the code is whether the transform algebra is
 * right: glTF composes `T · R · S` about a node's origin, the document composes
 * `T(centre) · R` about a node's centre, the two coordinate systems are mirrors
 * in y and z, and a scale has to be pushed down into geometry that has nowhere
 * else to put it. Four chances to be subtly wrong, none of them visible in a
 * diff.
 *
 * So that test does not check the arithmetic against itself. It builds the same
 * scene twice — once as three.js `Object3D`s driven by the file's own numbers,
 * once as a document walked by `design-core`'s `sceneMatrixOf` — and asserts the
 * two land on the same point. If the conjugation, the origin bridge or the scale
 * bake is wrong in any of them, they disagree.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type Scene,
	type SceneNode,
	type Value,
	applyMatrix,
	emptyScene,
	makeFrame,
	sceneContext,
	sceneMatrixOf,
} from "@clingo-design/design-core";
import { Euler, Object3D, Quaternion, Vector3 } from "three";

import {
	METRE_IN_EMU,
	type Triangles,
	boundsOf,
	gltfWriter,
	meshPart,
	parseGltfFile,
	partScale,
} from "./gltf.ts";
import {
	type GltfImport,
	type GltfImportOptions,
	importGltf,
} from "./gltfimport.ts";

/* ------------------------------------------------------------------ */
/* A file to import                                                    */
/* ------------------------------------------------------------------ */

/**
 * What a document value says, where it says one literal.
 *
 * `Value` is `Term[]` — the alternatives — and a `Term` is either a literal or a
 * reference to a token. Everything the importer writes is a single literal,
 * because a file states one colour rather than a design question, so this is the
 * whole of what these assertions need to read.
 */
const literalOf = (value: Value | undefined): string | undefined => {
	const term = value?.[0];
	return term?.kind === "literal" ? term.value : undefined;
};

/** A slab whose bounding box is deliberately *not* centred on its origin. */
const slab = (): Triangles => ({
	positions: Float32Array.from([0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 1, 0.5]),
	indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
});

const quaternion = (x: number, y: number, z: number): number[] => {
	const q = new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ"));
	return [q.x, q.y, q.z, q.w];
};

/** The rotation the tests use, chosen so all three axes are non-zero. */
const CHILD_TURN: [number, number, number] = [0.2, -0.35, 0.5];
const ROOT_TURN: [number, number, number] = [0, 0.7, 0];

/**
 * A file with a rotated, uniformly scaled root over a rotated mesh, plus a
 * camera and a lamp.
 *
 * The scale is **uniform** on purpose: a non-uniform one above a rotation is the
 * shear the importer refuses to pretend it can hold, and it is tested for
 * separately. Everything else here is the shape a modelling package writes.
 */
function sourceFile(): Uint8Array {
	const writer = gltfWriter({ generator: "test" });
	const material = writer.material({
		baseColour: [1, 0, 0],
		roughness: 0.25,
		metallic: 0.5,
		opacity: 0.4,
	});
	const mesh = writer.node({
		name: "Slab",
		mesh: writer.mesh(slab(), material, "Slab"),
		translation: [0.5, 0.25, -0.75],
		rotation: quaternion(...CHILD_TURN),
	});
	const camera = writer.node({
		name: "Eye",
		camera: writer.camera({
			type: "perspective",
			perspective: { yfov: Math.PI / 4, znear: 0.1, zfar: 100 },
		}),
		translation: [0, 1, 4],
	});
	const lamp = writer.node({
		name: "Key",
		extensions: {
			KHR_lights_punctual: {
				light: writer.light({ type: "point", color: [0, 1, 0], intensity: 3 }),
			},
		},
	});
	writer.roots([
		writer.node({
			name: "Root",
			children: [mesh, camera, lamp],
			translation: [1, 2, 3],
			rotation: quaternion(...ROOT_TURN),
			scale: [2, 2, 2],
		}),
	]);
	return new TextEncoder().encode(writer.text());
}

/** Ids in order, so a test can name a node instead of hunting for it. */
const counter = () => {
	let n = 0;
	return () => `n${n++}`;
};

/** Where the caller wrote the file before importing it — every ref points here. */
const SRC = "/assets/chair.gltf";

/**
 * An import, in the order the studio has to do it: parse, then write, then this.
 *
 * The parse is a separate line in every one of these because that is the whole
 * point of `importGltf` taking a {@link GltfFile}: `parseGltfFile` is the only
 * thing that throws, so a person who drops a PDF on a viewport gets an error
 * with nothing written to their tree. A test that handed bytes to the importer
 * could not tell the two orders apart.
 */
const imports = (
	bytes: Uint8Array,
	options: Partial<GltfImportOptions> = {},
): GltfImport => importGltf(parseGltfFile(bytes), { src: SRC, ...options });

/* ------------------------------------------------------------------ */
/* The shape that comes back                                           */
/* ------------------------------------------------------------------ */

test("a glTF becomes document nodes in the layer graph", () => {
	const imported = imports(sourceFile(), { id: counter() });
	assert.equal(imported.nodes.length, 1);
	const root = imported.nodes[0];
	assert.ok(root);
	// The root glTF node has three children, so it is a pivot — a place and a
	// rotation and no size, which is `KINDS.pivot`'s own description of itself.
	assert.equal(root.kind, "pivot");
	assert.equal(root.name, "Root");
	assert.deepEqual(
		root.children?.map((child) => [child.kind, child.name]),
		[
			["model", "Slab"],
			["camera", "Eye"],
			["light", "Key"],
		],
	);
	// A camera and a lamp are ordinary scene nodes, and this is invariant 2
	// paying for itself at import time: there was no separate "imported camera"
	// concept to write.
	const camera = root.children?.[1];
	assert.equal(literalOf(camera?.props?.fov), "45deg");
	assert.equal(literalOf(camera?.props?.near), "3600000emu");
	const lamp = root.children?.[2];
	assert.equal(literalOf(lamp?.props?.lamp), "point");
	assert.equal(literalOf(lamp?.props?.ink), "#00ff00");
	assert.equal(literalOf(lamp?.props?.intensity), "3");
});

test("a material arrives as ordinary props, not as a blob's private business", () => {
	const imported = imports(sourceFile(), { id: counter() });
	const model = imported.nodes[0]?.children?.[0];
	assert.equal(model?.kind, "model");
	// Linear [1,0,0] in the file is sRGB #ff0000 in a document, and three.js's
	// own `Color` made the crossing rather than a `pow` written here.
	assert.equal(literalOf(model?.props?.fill), "#ff0000");
	assert.equal(literalOf(model?.props?.roughness), "0.25");
	assert.equal(literalOf(model?.props?.metalness), "0.5");
	assert.equal(literalOf(model?.props?.opacity), "0.4");
});

test("the node references the file that was imported, and one part of it", () => {
	// This used to assert that the importer wrote a payload per primitive and put
	// the SHA-256 of it on the node. There is no payload and no hash: the file the
	// person imported is in the tree under its own name, and the node points at
	// that path and at two indices into the file's own arrays. Replacing the file
	// therefore replaces the chair, which is what the hash made impossible.
	const imported = imports(sourceFile(), { id: counter() });
	const model = imported.nodes[0]?.children?.[0];
	assert.equal(model?.mesh?.src, SRC);
	assert.equal(model?.mesh?.format, "gltf");
	// glTF node 0 is the slab — the writer wrote it first — and its mesh has one
	// primitive. Indices into the file, not names and not a hash.
	assert.deepEqual(model?.mesh?.part, { node: 0, primitive: 0 });
	assert.equal(model?.mesh?.triangles, 2);
	assert.equal(imported.triangles, 2);

	// What the payload assertion was really claiming — that the file's material is
	// on the *node*, as props a designer can change and a token can drive, rather
	// than baked into geometry beside it — is unchanged and is asserted above in
	// "a material arrives as ordinary props". Nothing about it depended on there
	// being a second file to check the absence of a material in.
	assert.equal(literalOf(model?.props?.fill), "#ff0000");
});

test("the file's own bytes are what the node's box was measured from", () => {
	// The claim §3 of `docs/model-files.md` exists to make checkable, and the one
	// this whole change stands on: the loader, given only the file and the two
	// indices on the ref, reproduces the exact geometry the importer measured. The
	// fixture's root scales by two, which is the case where a loader that forgot
	// the chain is off by a factor of two in every axis.
	const file = parseGltfFile(sourceFile());
	const imported = importGltf(file, { src: SRC, id: counter() });
	const model = imported.nodes[0]?.children?.[0];
	const ref = model?.mesh?.part;
	assert.ok(ref);

	const part = meshPart(file, ref);
	assert.ok(!("refused" in part));
	const bounds = boundsOf(part.triangles);
	assert.deepEqual(
		[
			Math.round((bounds.max[0] - bounds.min[0]) * METRE_IN_EMU),
			Math.round((bounds.max[1] - bounds.min[1]) * METRE_IN_EMU),
			Math.round((bounds.max[2] - bounds.min[2]) * METRE_IN_EMU),
		],
		[
			model?.mesh?.bounds.width,
			model?.mesh?.bounds.height,
			model?.mesh?.bounds.depth,
		],
		"the loader measures the box the document states",
	);
	// And the chain the loader derived from the file is the chain the walk threaded
	// down itself: the root's `[2,2,2]` times the slab's implicit `[1,1,1]`. Two
	// numbers that must agree, computed two ways, which is what stops the walk
	// being authoritative about a number the loader also has to know.
	assert.deepEqual(partScale(file, ref.node), [2, 2, 2]);
});

test("a payload the old importer wrote normalises to itself", () => {
	// The migration in `docs/model-files.md` §10, proved rather than hoped:
	// an existing document's `{asset: h}` becomes `{src: "/assets/" + h, part:
	// {node: 0, primitive: 0}}`, and the bytes at that path are what the *old*
	// importer wrote — one node, one mesh, one primitive, no scale, already
	// centred. Every step of `meshPart` is the identity on such a file, so the
	// migrated node draws the same vertices through the new code path, with no
	// legacy branch anywhere in the loader. That is invariant 4 discharged.
	const centred: Triangles = {
		positions: Float32Array.from([-1, -0.5, -0.25, 1, -0.5, -0.25, -1, 0.5, 0.25]),
		indices: Uint32Array.from([0, 1, 2]),
	};
	const writer = gltfWriter({ generator: "clingo-design import" });
	writer.roots([writer.node({ mesh: writer.mesh(centred, undefined, "Slab"), name: "Slab" })]);
	const legacy = parseGltfFile(new TextEncoder().encode(writer.text(false)));

	const part = meshPart(legacy, { node: 0, primitive: 0 });
	assert.ok(!("refused" in part));
	assert.deepEqual([...part.triangles.positions], [...centred.positions]);
	assert.deepEqual([...part.scale], [1, 1, 1]);
	assert.deepEqual([...part.centre], [0, 0, 0]);
});

test("the node's stated bounds are the box the vertices occupy", () => {
	const imported = imports(sourceFile(), { id: counter() });
	const model = imported.nodes[0]?.children?.[0];
	// The slab is 2 × 1 × 0.5 metres and the root scales it by two, so the box is
	// 4 × 2 × 1 metres — and `MeshRef.bounds` is centred, because the vertices
	// are.
	assert.deepEqual(model?.mesh?.bounds, {
		x: -2 * METRE_IN_EMU,
		y: -1 * METRE_IN_EMU,
		z: -0.5 * METRE_IN_EMU,
		width: 4 * METRE_IN_EMU,
		height: 2 * METRE_IN_EMU,
		depth: 1 * METRE_IN_EMU,
	});
	// And the *node's* frame says the same size, in the document's own spelling.
	assert.equal(literalOf(model?.frame.width), `${4 * METRE_IN_EMU}emu`);
	assert.equal(literalOf(model?.spatial?.depth), `${1 * METRE_IN_EMU}emu`);
});

test("the relink handle is the path, because the path is the file", () => {
	// There is no `source` field any more and this test lost nothing by it: what
	// it asserted was that a node remembers where its geometry came from, and the
	// node's `src` *is* where its geometry is — one answer that stays true when
	// the file is renamed or replaced, instead of a second free-form copy of a
	// name that nothing kept true.
	const imported = imports(sourceFile(), {
		src: "/assets/chair-2.glb",
		name: "The chair",
		id: counter(),
	});
	assert.equal(imported.nodes[0]?.name, "The chair");
	const mesh = imported.nodes[0]?.children?.[0]?.mesh;
	assert.equal(mesh?.src, "/assets/chair-2.glb");
	// And the format follows the name the file was written under — the collision
	// `putNamedAsset` resolved included.
	assert.equal(mesh?.format, "glb");
});

/* ------------------------------------------------------------------ */
/* What is flattened, said out loud                                    */
/* ------------------------------------------------------------------ */

test("what a document cannot hold is named rather than dropped in silence", () => {
	const writer = gltfWriter();
	const mesh = writer.mesh(slab(), undefined);
	writer.roots([writer.node({ mesh })]);
	const json = writer.json();
	// Everything a real character file has and a document has not.
	const rigged = {
		...json,
		animations: [{ channels: [], samplers: [] }],
		skins: [{ joints: [0] }],
		images: [{ uri: "skin.png" }],
		textures: [{ source: 0 }],
		scenes: [{ nodes: [0] }, { nodes: [] }],
	};
	const imported = imports(
		new TextEncoder().encode(JSON.stringify(rigged)),
		{ id: counter() },
	);
	const lost = imported.lost.join(" ");
	assert.match(lost, /Animation/);
	assert.match(lost, /Rigging/);
	assert.match(lost, /Textures/);
	assert.match(lost, /default scene/);
});

test("a buffer in another file is reported, not silently empty", () => {
	const imported = imports(
		new TextEncoder().encode(
			JSON.stringify({
				asset: { version: "2.0" },
				scenes: [{ nodes: [0] }],
				nodes: [{ mesh: 0 }],
				meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
				accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
				bufferViews: [{ buffer: 0, byteLength: 36 }],
				buffers: [{ byteLength: 36, uri: "chair.bin" }],
			}),
		),
		{ id: counter() },
	);
	assert.match(imported.lost.join(" "), /separate file/);
	assert.equal(imported.nodes.length, 0);
});

test("a stretched parent over a rotated child is named as the shear it is", () => {
	const writer = gltfWriter();
	const child = writer.node({
		name: "Turned",
		mesh: writer.mesh(slab(), undefined),
		rotation: quaternion(0, 0, 0.4),
	});
	writer.roots([writer.node({ name: "Squashed", children: [child], scale: [3, 1, 1] })]);
	const imported = imports(
		new TextEncoder().encode(writer.text()),
		{ id: counter() },
	);
	assert.match(imported.lost.join(" "), /shear/);
	assert.match(imported.lost.join(" "), /Turned/);
});

test("a mesh drawn in two materials becomes two nodes, and says so", () => {
	// One node, one mesh, two primitives — which is one object in three materials
	// in every modelling package, and a document node holds one fill.
	const writer = gltfWriter();
	const mesh = writer.meshOf(
		[
			{ triangles: slab(), material: writer.material({ baseColour: [1, 0, 0] }) },
			{ triangles: slab(), material: writer.material({ baseColour: [0, 0, 1] }) },
		],
		"Two tone",
	);
	writer.roots([writer.node({ name: "Two tone", mesh })]);
	const imported = imports(
		new TextEncoder().encode(writer.text()),
		{ id: counter() },
	);
	const root = imported.nodes[0];
	assert.equal(root?.kind, "pivot");
	assert.deepEqual(
		root?.children?.map((child) => literalOf(child.props?.fill)),
		["#ff0000", "#0000ff"],
	);
	assert.match(imported.lost.join(" "), /several materials/);
	// This counted two payloads. It now says something strictly stronger: the two
	// nodes are two *parts of one file* — same path, same glTF node, and the only
	// thing that differs is which primitive of that node's mesh each one draws.
	// Counting payloads could not have told a two-primitive mesh apart from two
	// meshes; these three assertions can.
	const refs = root?.children?.map((child) => child.mesh);
	assert.deepEqual(refs?.map((ref) => ref?.src), [SRC, SRC]);
	assert.deepEqual(refs?.map((ref) => ref?.part.node), [0, 0]);
	assert.deepEqual(refs?.map((ref) => ref?.part.primitive), [0, 1]);
});

/* ------------------------------------------------------------------ */
/* The proof                                                           */
/* ------------------------------------------------------------------ */

/**
 * Where the file says the slab's geometry is, computed by three.js.
 *
 * Deliberately independent of every line in `gltfimport.ts`: it mounts the
 * file's own numbers as an `Object3D` chain and asks three.js for the world
 * matrix, which is what a renderer that read the file directly would draw with.
 */
function threeAnswer(): Vector3 {
	const root = new Object3D();
	root.position.set(1, 2, 3);
	root.quaternion.fromArray(quaternion(...ROOT_TURN));
	root.scale.set(2, 2, 2);
	const child = new Object3D();
	child.position.set(0.5, 0.25, -0.75);
	child.quaternion.fromArray(quaternion(...CHILD_TURN));
	root.add(child);
	root.updateMatrixWorld(true);
	// The geometry's own bounding-box centre, in the child's local space: the
	// slab spans 0..2, 0..1, 0..0.5, so its middle is (1, 0.5, 0.25).
	return new Vector3(1, 0.5, 0.25).applyMatrix4(child.matrixWorld);
}

test("the imported node stands exactly where the file put the geometry", () => {
	const imported = imports(sourceFile(), { id: counter() });
	const root = imported.nodes[0];
	assert.ok(root);

	// The document side: the imported subtree under a viewport at the origin, and
	// `design-core`'s own chain — `T(centre) · R` per node, composed to the
	// viewport's model space — asked where the model node's centre is.
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			{
				id: "view",
				kind: "viewport",
				name: "View",
				frame: makeFrame({ x: 0, y: 0, width: 400 * 9525, height: 300 * 9525 }),
				props: {},
				children: [root],
			} satisfies SceneNode,
		],
	};
	const model = root.children?.[0];
	assert.ok(model);
	const matrix = sceneMatrixOf(scene, model.id, sceneContext(scene, {}));
	assert.ok(matrix);
	const document = applyMatrix(matrix, { x: 0, y: 0, z: 0 });

	// The file side, crossed: `F = diag(1, −1, −1)`, then metres to EMU.
	const world = threeAnswer();
	const expected = {
		x: world.x * METRE_IN_EMU,
		y: -world.y * METRE_IN_EMU,
		z: -world.z * METRE_IN_EMU,
	};

	// A tenth of a CSS pixel. The slack is real and it is all rounding: EMU is an
	// integer, a position is float32 in the file, and the two sides compose their
	// matrices in a different order. Nothing structural survives a tolerance this
	// tight — getting the conjugation, the origin bridge or the scale bake wrong
	// moves the node by centimetres.
	const slack = 952.5;
	assert.ok(Math.abs(document.x - expected.x) < slack, `x ${document.x} vs ${expected.x}`);
	assert.ok(Math.abs(document.y - expected.y) < slack, `y ${document.y} vs ${expected.y}`);
	assert.ok(Math.abs(document.z - expected.z) < slack, `z ${document.z} vs ${expected.z}`);
});

test("a rotation survives the crossing in both directions", () => {
	// The document's rotation is `worldEuler`'s inverse of the file's, and the
	// file's is recovered by applying `worldEuler` again — `F` is its own
	// inverse, so an import followed by an export is the identity on an angle.
	const imported = imports(sourceFile(), { id: counter() });
	const model = imported.nodes[0]?.children?.[0];
	const euler = new Euler().setFromQuaternion(
		new Quaternion().fromArray(quaternion(...CHILD_TURN)),
		"XYZ",
	);
	const degrees = (radians: number) => Math.round((radians * 180000) / Math.PI) / 1000;
	assert.equal(literalOf(model?.turn?.rotateX), `${degrees(euler.x)}deg`);
	assert.equal(literalOf(model?.turn?.rotateY), `${degrees(-euler.y)}deg`);
	assert.equal(literalOf(model?.turn?.rotateZ), `${degrees(-euler.z)}deg`);
});
