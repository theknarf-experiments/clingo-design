/**
 * The codec: what is written can be read, and the units are exact.
 *
 * Headless, under `node --test`, with no WebGL context and no DOM — which is
 * the whole reason `gltf.ts` is a hand-written reader and writer rather than
 * three.js's `GLTFLoader` and `GLTFExporter`. A test that needed a renderer
 * could not be this test.
 *
 * The shape of every case here is the same and it is deliberate: **write, read
 * back, compare**. A codec whose two halves are only tested against fixtures
 * agrees with the fixtures and with nothing else; a codec tested against itself
 * catches the one failure mode that matters, which is the two halves drifting.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	METRE_IN_EMU,
	type Triangles,
	boundsOf,
	centreTriangles,
	decodeBase64,
	emuFromMetres,
	encodeBase64,
	gltfWriter,
	metresFromEmu,
	parseGltfFile,
	readTriangles,
	scaleTriangles,
	triangleCount,
} from "./gltf.ts";

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

test("a metre is a whole number of EMU, so the conversion divides", () => {
	// 1 in = 0.0254 m and 1 in = 914400 EMU. The claim `gltf.ts` makes is that
	// the quotient is an integer, which is what makes the export exact.
	assert.equal(METRE_IN_EMU, 914400 / 0.0254);
	assert.equal(Number.isInteger(METRE_IN_EMU), true);
});

test("a document measured in millimetres survives the round trip", () => {
	// One millimetre is 36000 EMU exactly, so a card 210mm wide comes back the
	// same integer it went out as — the property §6.2 claims for the target.
	for (const mm of [1, 210, 297, 1000]) {
		const emu = mm * 36_000;
		assert.equal(emuFromMetres(metresFromEmu(emu)), emu);
	}
});

/* ------------------------------------------------------------------ */
/* base64                                                              */
/* ------------------------------------------------------------------ */

test("base64 round-trips every byte and every remainder", () => {
	// All 256 values, and then the three lengths modulo 3, because the padding
	// branch is the half of a base64 implementation that is usually wrong.
	const all = Uint8Array.from({ length: 256 }, (_, i) => i);
	assert.deepEqual(decodeBase64(encodeBase64(all)), all);
	for (const length of [0, 1, 2, 3, 4, 5]) {
		const bytes = all.subarray(0, length);
		assert.deepEqual(decodeBase64(encodeBase64(bytes)), bytes);
	}
});

test("the alphabet is the standard one", () => {
	// Held against a value nobody can produce by accident: "Man" is the canonical
	// example from the RFC, and a home-grown alphabet fails it immediately.
	assert.equal(encodeBase64(new TextEncoder().encode("Man")), "TWFu");
	assert.equal(encodeBase64(new TextEncoder().encode("Ma")), "TWE=");
	assert.equal(encodeBase64(new TextEncoder().encode("M")), "TQ==");
});

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** A slab with a deliberately off-centre bounding box — see `centreTriangles`. */
const slab = (): Triangles => ({
	positions: Float32Array.from([0, 0, 0, 2, 0, 0, 0, 1, 0.5]),
	normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
	uvs: Float32Array.from([0, 0, 1, 0, 0, 1]),
	indices: Uint32Array.from([0, 1, 2]),
});

test("bounds are measured rather than believed", () => {
	assert.deepEqual(boundsOf(slab()), { min: [0, 0, 0], max: [2, 1, 0.5] });
	// An empty soup has a box at the origin rather than a box of infinities: a
	// mesh with no vertices is a thing a file can hold, and NaN geometry is not.
	assert.deepEqual(
		boundsOf({ positions: new Float32Array(), indices: new Uint32Array() }),
		{ min: [0, 0, 0], max: [0, 0, 0] },
	);
});

test("centring moves the box to the origin and nothing else", () => {
	const centred = centreTriangles(slab());
	assert.deepEqual(boundsOf(centred), { min: [-1, -0.5, -0.25], max: [1, 0.5, 0.25] });
	// The shape is untouched: same size, same normals, same indices.
	assert.deepEqual(centred.indices, slab().indices);
	assert.deepEqual(centred.normals, slab().normals);
});

test("a uniform scale keeps the normals and a non-uniform one drops them", () => {
	// The rule `scaleTriangles` argues for: the inverse transpose is the correct
	// answer for a stretched normal, writing one into a payload is not this
	// package's business, and absent normals are recomputed by every loader while
	// wrong ones are repaired by none.
	assert.notEqual(scaleTriangles(slab(), [2, 2, 2]).normals, undefined);
	assert.equal(scaleTriangles(slab(), [2, 1, 1]).normals, undefined);
	assert.deepEqual(boundsOf(scaleTriangles(slab(), [2, 3, 4])), {
		min: [0, 0, 0],
		max: [4, 3, 2],
	});
});

/* ------------------------------------------------------------------ */
/* Write, then read                                                    */
/* ------------------------------------------------------------------ */

test("what the writer writes, the reader reads back exactly", () => {
	const writer = gltfWriter({ generator: "test" });
	const material = writer.material({ baseColour: [1, 0, 0], roughness: 0.25 });
	const mesh = writer.mesh(slab(), material, "Slab");
	writer.roots([writer.node({ name: "Slab", mesh })], "A scene");
	const file = parseGltfFile(new TextEncoder().encode(writer.text()));

	assert.equal(file.json.asset.version, "2.0");
	assert.equal(file.json.scenes?.[0]?.name, "A scene");
	const primitive = file.json.meshes?.[0]?.primitives?.[0];
	assert.ok(primitive);
	const read = readTriangles(file, primitive);
	assert.ok("triangles" in read);
	// Float32 in, Float32 out, with the buffer having been base64'd in between.
	assert.deepEqual(read.triangles.positions, slab().positions);
	assert.deepEqual(read.triangles.normals, slab().normals);
	assert.deepEqual(read.triangles.uvs, slab().uvs);
	assert.deepEqual(read.triangles.indices, slab().indices);
	assert.equal(triangleCount(read.triangles), 1);
});

test("a POSITION accessor states the bounds a loader needs", () => {
	const writer = gltfWriter();
	writer.roots([writer.node({ mesh: writer.mesh(slab(), undefined) })]);
	const file = parseGltfFile(new TextEncoder().encode(writer.text()));
	const position = file.json.accessors?.[0];
	assert.deepEqual(position?.min, [0, 0, 0]);
	assert.deepEqual(position?.max, [2, 1, 0.5]);
});

test("identical materials are one material", () => {
	const writer = gltfWriter();
	const a = writer.material({ baseColour: [0, 1, 0], roughness: 0.5 });
	const b = writer.material({ baseColour: [0, 1, 0], roughness: 0.5 });
	const c = writer.material({ baseColour: [0, 1, 0], roughness: 0.6 });
	assert.equal(a, b);
	assert.notEqual(a, c);
	assert.equal(writer.json().materials?.length, 2);
});

test("a lamp declares its extension exactly once", () => {
	const writer = gltfWriter();
	writer.light({ type: "point", intensity: 1 });
	writer.light({ type: "spot", intensity: 2 });
	const json = writer.json();
	assert.deepEqual(json.extensionsUsed, ["KHR_lights_punctual"]);
	assert.equal(json.extensions?.KHR_lights_punctual?.lights.length, 2);
});

test("an empty export is still a legal glTF", () => {
	// The answer `exportViewportGltf` gives for a document with no 3D in it. A
	// file with no buffer must not declare one.
	const writer = gltfWriter();
	writer.roots([]);
	const json = JSON.parse(writer.text());
	assert.equal(json.asset.version, "2.0");
	assert.equal(json.buffers, undefined);
});

/* ------------------------------------------------------------------ */
/* The container                                                       */
/* ------------------------------------------------------------------ */

/** The same JSON, wrapped in a GLB container with a real BIN chunk. */
function asGlb(json: object, bin: Uint8Array): Uint8Array {
	const text = new TextEncoder().encode(JSON.stringify(json));
	const pad = (bytes: Uint8Array, fill: number): Uint8Array => {
		const extra = (4 - (bytes.byteLength % 4)) % 4;
		if (extra === 0) return bytes;
		const out = new Uint8Array(bytes.byteLength + extra).fill(fill);
		out.set(bytes);
		return out;
	};
	const jsonChunk = pad(text, 0x20);
	const binChunk = pad(bin, 0);
	const total = 12 + 8 + jsonChunk.byteLength + 8 + binChunk.byteLength;
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);
	view.setUint32(0, 0x46546c67, true);
	view.setUint32(4, 2, true);
	view.setUint32(8, total, true);
	view.setUint32(12, jsonChunk.byteLength, true);
	view.setUint32(16, 0x4e4f534a, true);
	out.set(jsonChunk, 20);
	const at = 20 + jsonChunk.byteLength;
	view.setUint32(at, binChunk.byteLength, true);
	view.setUint32(at + 4, 0x004e4942, true);
	out.set(binChunk, at + 8);
	return out;
}

test("a .glb is read, and its BIN chunk is buffer 0", () => {
	// Three float triples in the binary chunk, addressed by an accessor with no
	// URI anywhere — which is the shape of every .glb a modelling package writes
	// and the one a `data:` reader alone would silently return nothing for.
	const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]);
	const bin = new Uint8Array(positions.buffer.slice(0));
	const glb = asGlb(
		{
			asset: { version: "2.0" },
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0 }],
			meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
			accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
			bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
			buffers: [{ byteLength: bin.byteLength }],
		},
		bin,
	);
	const file = parseGltfFile(glb);
	const primitive = file.json.meshes?.[0]?.primitives?.[0];
	assert.ok(primitive);
	const read = readTriangles(file, primitive);
	assert.ok("triangles" in read);
	assert.deepEqual(read.triangles.positions, positions);
	// No indices in the file, so the reader invents the sequential ones — "no
	// indices" is a statement about an encoding rather than about a mesh.
	assert.deepEqual(read.triangles.indices, Uint32Array.from([0, 1, 2]));
});

test("an interleaved buffer is read by its stride rather than scrambled", () => {
	// Position and normal in one buffer view, six floats apart — what every
	// optimising exporter writes, and what a reader that assumed tight packing
	// would return as nonsense rather than as an error.
	const data = Float32Array.from([
		1, 2, 3, 9, 9, 9, //
		4, 5, 6, 9, 9, 9,
		7, 8, 9, 9, 9, 9,
	]);
	const bin = new Uint8Array(data.buffer.slice(0));
	const file = parseGltfFile(
		asGlb(
			{
				asset: { version: "2.0" },
				meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
				accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
				bufferViews: [
					{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength, byteStride: 24 },
				],
				buffers: [{ byteLength: bin.byteLength }],
			},
			bin,
		),
	);
	const primitive = file.json.meshes?.[0]?.primitives?.[0];
	assert.ok(primitive);
	const read = readTriangles(file, primitive);
	assert.ok("triangles" in read);
	assert.deepEqual(read.triangles.positions, Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
});

test("what cannot be read says why, and does not throw", () => {
	const writer = gltfWriter();
	writer.roots([writer.node({ mesh: writer.mesh(slab(), undefined) })]);
	const file = parseGltfFile(new TextEncoder().encode(writer.text()));
	// A point cloud is legal glTF and there is no document node that is one.
	const points = readTriangles(file, {
		attributes: { POSITION: 0 },
		mode: 0,
	});
	assert.ok("refused" in points);
	assert.match(points.refused, /triangles/);
	// A sparse accessor is legal too, and is not implemented.
	const sparse = readTriangles(
		{ json: { ...file.json, accessors: [{ ...file.json.accessors![0]!, sparse: {} }] }, buffers: file.buffers },
		{ attributes: { POSITION: 0 } },
	);
	assert.ok("refused" in sparse);
});

test("bytes that are not a glTF throw, because a person picked the wrong file", () => {
	assert.throws(() => parseGltfFile(new TextEncoder().encode("hello")));
	assert.throws(() => parseGltfFile(new TextEncoder().encode('{"nope":1}')), /not a glTF/);
});
