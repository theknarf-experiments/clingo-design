/**
 * The loader, against the file a person would actually have imported.
 *
 * A round trip rather than a fixture: the file is written with `gltfWriter`, run
 * through `importGltf` — which is what decides *which part* a node addresses —
 * and then read back here through the same two indices the node ended up
 * holding. The two halves have to agree about what a vertex is, and the only way
 * to check that is to run them against each other; a hand-written part reference
 * would be a third opinion.
 *
 * What changed with the file in the tree: these used to read
 * `result.assets[0].payload`, a standalone single-primitive glTF the importer
 * wrote. There is no such payload. They read the file itself and select a part
 * of it, which is what the renderer does — and every assertion below is the one
 * that was here before, because none of them was ever about the payload: four
 * vertices, six indices, two metres wide *still*, normals and UVs carried,
 * normals computed when absent, and nothing a caller can be handed making this
 * throw.
 *
 * `geometryOf` rather than the hook, because `useAsset` is a hook and this
 * package tests headless with no renderer in the room. What the hook adds over
 * this function is the fetch, the in-flight dedupe, the guard against a stale
 * path and the dispose, and those are React's behaviour rather than glTF's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { type Triangles, gltfWriter, parseGltfFile } from "./gltf.ts";
import { importGltf } from "./gltfimport.ts";
import { geometryOf } from "./useAsset.ts";

/** Two triangles, with normals and UVs, so every attribute path is exercised. */
const slab = (): Triangles => ({
	positions: Float32Array.from([0, 0, 0, 2, 0, 0, 0, 1, 0, 2, 1, 0.5]),
	normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
	uvs: Float32Array.from([0, 0, 1, 0, 0, 1, 1, 1]),
	indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
});

/** One mesh, written the way a modelling package would. */
function oneMesh(triangles: Triangles = slab()): Uint8Array {
	const writer = gltfWriter({ generator: "test" });
	const mesh = writer.mesh(triangles, undefined, "Slab");
	writer.roots([writer.node({ name: "Slab", mesh })]);
	return new TextEncoder().encode(writer.text());
}

/** The part reference the importer put on the node it made for that mesh. */
function importedPart(bytes: Uint8Array): { node: number; primitive: number } {
	const imported = importGltf(parseGltfFile(bytes), { src: "/assets/slab.gltf" });
	const ref = imported.nodes[0]?.mesh?.part;
	assert.ok(ref, "the import produced a model node with a part reference");
	return ref;
}

test("the file the importer read reads back as the geometry it held", () => {
	const bytes = oneMesh();
	const loaded = geometryOf(bytes, importedPart(bytes));
	assert.ok(loaded, "the file parses and the part is there");

	const position = loaded.geometry.getAttribute("position");
	assert.equal(position.itemSize, 3);
	assert.equal(position.count, 4, "four vertices, as written");
	assert.equal(loaded.geometry.getIndex()?.count, 6, "two triangles");
	// `meshPart` centres a part on its own origin — that is what lets the renderer
	// fit it to the node's box and have it land where the solver put the node. So
	// the vertices are not the ones written; their *extent* is.
	const xs = [];
	for (let i = 0; i < position.count; i++) xs.push(position.getX(i));
	assert.equal(Math.max(...xs) - Math.min(...xs), 2, "two metres wide, still");
	// And the box comes back beside the geometry, measured from the same array —
	// which is what `Model.tsx` divides the node's box by, and what
	// `MeshRef.bounds` was written from at import.
	assert.equal(loaded.bounds.max[0] - loaded.bounds.min[0], 2);
});

test("normals and UVs survive, and a file with neither still lights", () => {
	const bytes = oneMesh();
	const withAll = geometryOf(bytes, importedPart(bytes));
	assert.ok(withAll?.geometry.getAttribute("normal"), "normals carried");
	assert.ok(withAll?.geometry.getAttribute("uv"), "uvs carried");

	// A file with no normals would otherwise draw flat black under every lamp,
	// which is a correct import that looks like a bug. Computed rather than
	// refused.
	const plain = oneMesh({ positions: slab().positions, indices: slab().indices });
	const bare = geometryOf(plain, importedPart(plain));
	assert.ok(bare, "a file with only positions still loads");
	assert.ok(bare?.geometry.getAttribute("normal"), "normals computed rather than absent");
});

test("nothing a caller can be handed makes this throw", () => {
	// Every one of these is a thing that reaches a renderer in the wild: a
	// truncated download, a file that is not glTF at all, an empty payload. The
	// answer to all of them is the same box, so the answer here is `undefined` and
	// never an exception — a corrupt asset must cost its own node its geometry and
	// not take the view it is in down with it.
	const first = { node: 0, primitive: 0 };
	assert.equal(geometryOf(new Uint8Array(), first), undefined);
	assert.equal(geometryOf(Uint8Array.from([1, 2, 3, 4]), first), undefined);
	assert.equal(geometryOf(new TextEncoder().encode("not a gltf at all"), first), undefined);
	assert.equal(
		geometryOf(new TextEncoder().encode("{}"), first),
		undefined,
		"valid json, no mesh",
	);
	// The fifth, which is new because the reference is new: a part index the file
	// does not hold. A `MeshRef` outlives the bytes it was measured against —
	// somebody replaces `/assets/chair.glb` with a chair that has fewer primitives
	// — and that stale reference arrives here on a render, not in an importer.
	assert.equal(
		geometryOf(oneMesh(), { node: 0, primitive: 7 }),
		undefined,
		"a primitive the file no longer holds",
	);
	assert.equal(
		geometryOf(oneMesh(), { node: 9, primitive: 0 }),
		undefined,
		"a node the file no longer holds",
	);
});
