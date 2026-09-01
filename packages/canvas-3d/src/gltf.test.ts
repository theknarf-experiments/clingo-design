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
	type GltfWriter,
	type MetreBounds,
	type Triangles,
	boundsOf,
	centreTriangles,
	decodeBase64,
	emuFromMetres,
	encodeBase64,
	fitScale,
	gltfWriter,
	meshPart,
	meshParts,
	metresFromEmu,
	parseGltfFile,
	partScale,
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

/* ------------------------------------------------------------------ */
/* One part of a file, normalised                                      */
/* ------------------------------------------------------------------ */

/*
 * The three steps `meshPart` promises — read, scale by the chain, centre — held
 * to one at a time, because this is the function the importer's box and the
 * renderer's geometry both come out of. Every case below is a way the two could
 * have disagreed if there were two implementations: a scale applied once or
 * twice, a translation applied here as well as on the node, a primitive index
 * that means a different primitive on the way out than it did on the way in.
 */

/** The same file the writer would produce, read back — what every caller has. */
const parsed = (writer: GltfWriter) =>
	parseGltfFile(new TextEncoder().encode(writer.text(false)));

/** A second soup, distinguishable from `slab` by its box alone. */
const pole = (): Triangles => ({
	positions: Float32Array.from([0, 0, 0, 0, 4, 0, 0, 0, 1]),
	indices: Uint32Array.from([0, 1, 2]),
});

test("a part is scaled by the whole chain above it, and moved by none of it", () => {
	// A leaf scaled 3× in x under a parent scaled 2× everywhere: the geometry is
	// baked with [6, 2, 2]. The leaf's own translation is *not* baked — it stays
	// on the document node as a place, which is the one thing `gltfimport.ts`
	// does with a transform that this must not do a second time.
	const writer = gltfWriter();
	const mesh = writer.mesh(slab(), undefined, "Slab");
	const leaf = writer.node({ name: "Leaf", mesh, translation: [10, 0, 0], scale: [3, 1, 1] });
	writer.roots([writer.node({ name: "Parent", children: [leaf], scale: [2, 2, 2] })]);
	const file = parsed(writer);

	const part = meshPart(file, { node: leaf, primitive: 0 });
	assert.ok("triangles" in part);
	assert.deepEqual([...part.scale], [6, 2, 2]);
	// slab is (0,0,0)–(2,1,0.5); scaled it is (0,0,0)–(12,2,1), and centring
	// takes out the middle of *that* box and nothing else.
	assert.deepEqual([...part.centre], [6, 1, 0.5]);
	assert.deepEqual(part.bounds, { min: [-6, -1, -0.5], max: [6, 1, 0.5] });
	// A ten-metre translation on the node would have moved the box off the origin
	// had it been applied; it is not applied.
	assert.equal(part.bounds.min[0] + part.bounds.max[0], 0);
	// `scaleTriangles`'s own rule, reproduced by going through it rather than
	// around it: this chain is not uniform, so the normals go and the UVs stay.
	assert.equal(part.triangles.normals, undefined);
	assert.deepEqual(part.triangles.uvs, slab().uvs);
	assert.equal(triangleCount(part.triangles), 1);
});

test("one mesh under two nodes at two scales is two different geometries", () => {
	// Why `PartRef` addresses the **node** and not the mesh. A mesh index alone
	// could not tell these two apart, and they are not the same chair.
	const writer = gltfWriter();
	const mesh = writer.mesh(slab(), undefined, "Slab");
	const small = writer.node({ mesh });
	const large = writer.node({ mesh, scale: [2, 2, 2] });
	writer.roots([small, large]);
	const file = parsed(writer);

	const a = meshPart(file, { node: small, primitive: 0 });
	const b = meshPart(file, { node: large, primitive: 0 });
	assert.ok("bounds" in a && "bounds" in b);
	assert.deepEqual(a.bounds.max, [1, 0.5, 0.25]);
	assert.deepEqual(b.bounds.max, [2, 1, 0.5]);
});

test("the chain reads a matrix and a TRS triple as the same scale", () => {
	// A file may spell a transform either way and modelling packages spell it both
	// ways in one file. The matrix case is three.js's decomposition written out,
	// and it has to agree with it exactly, because `gltfimport.ts` decomposes with
	// three.js and the two answers are multiplied into the same vertices.
	const trs = gltfWriter();
	trs.roots([trs.node({ mesh: trs.mesh(slab(), undefined), scale: [2, 3, 4] })]);
	const matrix = gltfWriter();
	matrix.roots([
		matrix.node({
			mesh: matrix.mesh(slab(), undefined),
			// Column-major diag(2, 3, 4) — glTF's own order and `Matrix4.fromArray`'s.
			matrix: [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1],
		}),
	]);
	assert.deepEqual(partScale(parsed(trs), 0), [2, 3, 4]);
	assert.deepEqual(partScale(parsed(matrix), 0), [2, 3, 4]);
});

test("a mirror comes back negative, whichever way the file spells it", () => {
	// A negative determinant is charged to x alone — an arbitrary rule, and the
	// only thing that matters is that this and three.js make the same arbitrary
	// choice. The importer turns it into a `lost` sentence and an unsigned box;
	// what it must never do is disagree with the loader about the shape.
	const trs = gltfWriter();
	trs.roots([trs.node({ mesh: trs.mesh(slab(), undefined), scale: [-2, 3, 4] })]);
	const matrix = gltfWriter();
	matrix.roots([
		matrix.node({
			mesh: matrix.mesh(slab(), undefined),
			matrix: [-2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1],
		}),
	]);
	assert.deepEqual(partScale(parsed(trs), 0), [-2, 3, 4]);
	assert.deepEqual(partScale(parsed(matrix), 0), [-2, 3, 4]);
	// And the box is still a box: extents are measured off the vertices, so a
	// mirrored part has the size it had before the file flipped it.
	const part = meshPart(parsed(trs), { node: 0, primitive: 0 });
	assert.ok("bounds" in part);
	assert.deepEqual(part.bounds, { min: [-2, -1.5, -1], max: [2, 1.5, 1] });
});

test("a chain runs to the root and stops on a file that loops", () => {
	// Three levels multiply in one order, from the root down, which is the order
	// the importer's own recursion uses — the two are held equal in
	// `gltfimport.test.ts`, and this is the half of that claim that lives here.
	const writer = gltfWriter();
	const leaf = writer.node({ mesh: writer.mesh(slab(), undefined), scale: [2, 1, 1] });
	const middle = writer.node({ children: [leaf], scale: [3, 1, 1] });
	writer.roots([writer.node({ children: [middle], scale: [5, 1, 1] })]);
	assert.deepEqual(partScale(parsed(writer), leaf), [30, 1, 1]);

	// A file whose hierarchy is not a tree is malformed, and the answer to a
	// malformed file is an answer rather than a hung tab.
	const looped = parsed(writer);
	looped.json.nodes = [
		{ children: [1], scale: [2, 1, 1] },
		{ children: [0], mesh: 0, scale: [3, 1, 1] },
	];
	assert.deepEqual(partScale(looped, 1), [6, 1, 1]);
});

test("a part that is already centred and unscaled comes back untouched", () => {
	// The legacy proof, at this level: an old per-primitive payload is a one-node,
	// one-mesh, one-primitive file that is already scaled and already centred, so
	// every one of the three steps is the identity on it — the chain is [1,1,1]
	// because the writer emits no scale, and `centreTriangles` early-returns on a
	// box that is already at the origin. A migrated document therefore draws the
	// same vertices through the new path, with no legacy branch in the loader.
	const centred = centreTriangles(slab());
	const writer = gltfWriter({ generator: "clingo-design import" });
	writer.roots([writer.node({ mesh: writer.mesh(centred, undefined, "Slab"), name: "Slab" })]);

	const part = meshPart(parsed(writer), { node: 0, primitive: 0 });
	assert.ok("triangles" in part);
	assert.deepEqual([...part.scale], [1, 1, 1]);
	assert.deepEqual([...part.centre], [0, 0, 0]);
	assert.deepEqual(part.triangles.positions, centred.positions);
	assert.deepEqual(part.triangles.normals, centred.normals);
	assert.deepEqual(part.triangles.indices, centred.indices);
	assert.equal(part.name, "Slab");
});

test("a mesh in two materials is two named parts, and each keeps its own", () => {
	const writer = gltfWriter();
	const red = writer.material({ baseColour: [1, 0, 0] });
	const blue = writer.material({ baseColour: [0, 0, 1] });
	writer.roots([
		writer.node({
			mesh: writer.meshOf(
				[
					{ triangles: slab(), material: red },
					{ triangles: pole(), material: blue },
				],
				"Chair",
			),
		}),
	]);
	const parts = meshParts(parsed(writer), 0);

	assert.deepEqual(
		parts.map((entry) => entry.ref),
		[
			{ node: 0, primitive: 0 },
			{ node: 0, primitive: 1 },
		],
	);
	const [first, second] = parts.map((entry) => entry.part);
	assert.ok(first && "name" in first && second && "name" in second);
	// Numbered, because two layer rows called "Chair" are two rows nobody can
	// tell apart; and each carries the file's own material index, which is what
	// becomes a fill on the node rather than a copy inside a payload.
	assert.deepEqual([first.name, second.name], ["Chair 1", "Chair 2"]);
	assert.deepEqual([first.material, second.material], [red, blue]);
	assert.deepEqual(second.bounds.max, [0, 2, 0.5]);

	// One primitive, one part, and no number on it.
	const single = gltfWriter();
	single.roots([single.node({ mesh: single.mesh(slab(), undefined, "Chair") })]);
	const only = meshParts(parsed(single), 0);
	assert.equal(only.length, 1);
	assert.ok(only[0] && "name" in only[0].part);
	assert.equal(only[0].part.name, "Chair");
});

test("a refused part keeps its place in the list, so the indices stay the file's", () => {
	// The reason `meshParts` returns refusals rather than filtering them out. A
	// point cloud first and triangles second must produce a reference to
	// primitive **1**; a filtered list would hand back index 0 for it and the
	// node would address geometry that cannot be drawn, from a reference that
	// looks perfectly well-formed.
	const writer = gltfWriter();
	writer.roots([
		writer.node({
			mesh: writer.meshOf(
				[
					{ triangles: slab(), material: undefined },
					{ triangles: pole(), material: undefined },
				],
				"Chair",
			),
		}),
	]);
	const file = parsed(writer);
	const first = file.json.meshes?.[0]?.primitives?.[0];
	assert.ok(first);
	first.mode = 0; // POINTS — legal glTF, and no document node is one.

	const parts = meshParts(file, 0);
	assert.equal(parts.length, 2);
	assert.ok("refused" in parts[0]!.part);
	assert.match((parts[0]!.part as { refused: string }).refused, /triangles/);
	assert.equal(parts[1]?.ref.primitive, 1);
	assert.ok("triangles" in parts[1]!.part);
});

test("an index the file does not hold refuses, and nothing here throws", () => {
	// A stale reference reaches this on a *render*, because the whole point of
	// addressing a file by path is that somebody can replace it. A throw here is
	// a viewport that goes down over a chair that should have drawn its box.
	const writer = gltfWriter();
	const mesh = writer.mesh(slab(), undefined, "Slab");
	writer.roots([writer.node({ mesh }), writer.node({ name: "Empty" })]);
	const file = parsed(writer);

	for (const ref of [
		{ node: 7, primitive: 0 }, // No such node.
		{ node: 1, primitive: 0 }, // A node with no mesh — a pivot, in the document.
		{ node: 0, primitive: 3 }, // The file has changed under the reference.
	]) {
		const part = meshPart(file, ref);
		assert.ok("refused" in part, `${JSON.stringify(ref)} should refuse`);
		assert.equal(typeof part.refused, "string");
	}
	// A mesh index the file does not hold either — the same answer, not a crash.
	const broken = parsed(writer);
	broken.json.nodes = [{ mesh: 9 }];
	assert.ok("refused" in meshPart(broken, { node: 0, primitive: 0 }));
	// And `meshParts` on a node with nothing to draw is empty rather than sorry:
	// that is most of a glTF's nodes.
	assert.deepEqual(meshParts(file, 1), []);
	assert.deepEqual(meshParts(file, 7), []);
});

test("fitting divides, and answers 1 where either side is nothing", () => {
	// `gltfexport.ts`'s `fit`, kept exactly, now shared with the renderer — which
	// is the fix for a `model` being drawn at its metre extent rather than at the
	// size of its box.
	const bounds: MetreBounds = { min: [-1, -0.5, 0], max: [1, 0.5, 0] };
	assert.deepEqual(fitScale(bounds, [4, 2, 3]), [2, 2, 1]);
	// A flat part has no thickness and no scale makes it thick; a box the document
	// never gave a depth is the same case from the other side. `0` and `Infinity`
	// are both a mesh nobody can see.
	assert.deepEqual(fitScale(bounds, [0, 2, 0]), [1, 2, 1]);
});
