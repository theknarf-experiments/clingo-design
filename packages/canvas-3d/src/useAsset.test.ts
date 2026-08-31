/**
 * The loader, against payloads `importGltf` actually wrote.
 *
 * A round trip rather than a fixture: the import writes a standalone
 * single-primitive glTF for each mesh it finds, and this reads one back into the
 * geometry a `<mesh>` draws. The two halves have to agree about what a vertex
 * is, and the only way to check that is to run them against each other — a
 * hand-written payload would be a third opinion.
 *
 * `geometryOf` rather than the hook, because `useAsset` is a hook and this
 * package tests headless with no renderer in the room. What the hook adds over
 * this function is the fetch, the guard against a stale hash and the dispose,
 * and those are React's behaviour rather than glTF's.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { type Triangles, gltfWriter } from "./gltf.ts";
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

test("a payload the importer wrote reads back as the geometry it held", async () => {
	const result = await importGltf(oneMesh(), { source: "slab.glb" });
	assert.equal(result.assets.length, 1, "one primitive is one payload");

	const geometry = geometryOf(result.assets[0].payload);
	assert.ok(geometry, "the payload parses");

	const position = geometry.getAttribute("position");
	assert.equal(position.itemSize, 3);
	assert.equal(position.count, 4, "four vertices, as written");
	assert.equal(geometry.getIndex()?.count, 6, "two triangles");
	// The importer centres a payload on its own origin — that is what lets the
	// renderer scale it by the node's box and have it land where the solver put
	// the node. So the vertices are not the ones written; their *extent* is.
	const xs = [];
	for (let i = 0; i < position.count; i++) xs.push(position.getX(i));
	assert.equal(Math.max(...xs) - Math.min(...xs), 2, "two metres wide, still");
});

test("normals and UVs survive, and a file with neither still lights", () => {
	return (async () => {
		const withAll = geometryOf(
			(await importGltf(oneMesh())).assets[0].payload,
		);
		assert.ok(withAll?.getAttribute("normal"), "normals carried");
		assert.ok(withAll?.getAttribute("uv"), "uvs carried");

		// A file with no normals would otherwise draw flat black under every lamp,
		// which is a correct import that looks like a bug. Computed rather than
		// refused.
		const bare = geometryOf(
			(
				await importGltf(
					oneMesh({
						positions: slab().positions,
						indices: slab().indices,
					}),
				)
			).assets[0].payload,
		);
		assert.ok(bare, "a file with only positions still loads");
		assert.ok(bare?.getAttribute("normal"), "normals computed rather than absent");
	})();
});

test("nothing a caller can be handed makes this throw", () => {
	// Every one of these is a thing that reaches a renderer in the wild: a
	// truncated download, a file that is not glTF at all, an empty payload. The
	// answer to all three is the same box, so the answer here is `undefined` and
	// never an exception — a corrupt asset must cost its own node its geometry
	// and not take the view it is in down with it.
	assert.equal(geometryOf(new Uint8Array()), undefined);
	assert.equal(geometryOf(Uint8Array.from([1, 2, 3, 4])), undefined);
	assert.equal(geometryOf(new TextEncoder().encode("not a gltf at all")), undefined);
	assert.equal(geometryOf(new TextEncoder().encode("{}")), undefined, "valid json, no mesh");
});
