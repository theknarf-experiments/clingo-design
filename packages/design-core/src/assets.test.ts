/**
 * The asset vocabulary, over documents built by hand.
 *
 * Nothing here needs a solver: every question this file answers is a set
 * difference or a sum over the tree, and that is the point of the split. What
 * needs a database is the app's implementation, and what needs a canvas is the
 * loader; both are exercised where they live.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assetInfo,
	assetRefs,
	assetTotalBytes,
	memoryAssetStore,
	missingAssets,
} from "./assets.ts";
import { makeNode, pruneAssets } from "./edits.ts";
import type { AssetInfo, MeshRef, Scene, SceneNode } from "./scene.ts";
import { emptyScene } from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";

const px = (n: number): number => n * EMU_PER_PX;

const ref = (asset: string): MeshRef => ({
	asset,
	format: "glb",
	bounds: { x: 0, y: 0, width: px(40), height: px(40), z: 0, depth: px(40) },
	triangles: 12,
	source: "chair.glb",
});

const info = (name: string, bytes: number): AssetInfo => ({
	format: "glb",
	bytes,
	triangles: 12,
	name,
});

/** A room with however many models in it, each naming an asset by hash. */
function room(models: Array<{ id: string; asset: string }>): Scene {
	const nodes: SceneNode[] = models.map((m) => ({
		...makeNode("model", { x: 0, y: 0, width: px(40), height: px(40) }, {
			id: m.id,
			name: m.id,
		}),
		mesh: ref(m.asset),
	}));
	const base = emptyScene();
	return {
		...base,
		nodes: [{ ...base.nodes[0], children: nodes }],
		assets: Object.fromEntries(
			[...new Set(models.map((m) => m.asset))].map((a) => [a, info(a, 1000)]),
		),
	};
}

test("two models of one chair are one asset", () => {
	// The whole of content addressing in one assertion: the reference map is
	// keyed by what the bytes *are*, so importing the same file twice cannot
	// produce two entries however many nodes point at it.
	const scene = room([
		{ id: "a", asset: "h1" },
		{ id: "b", asset: "h1" },
		{ id: "c", asset: "h2" },
	]);
	const refs = assetRefs(scene);
	assert.deepEqual([...refs.keys()].sort(), ["h1", "h2"]);
	assert.deepEqual(refs.get("h1"), ["a", "b"]);
	// And it is one download, not two.
	assert.equal(assetTotalBytes(scene), 2000);
});

test("a document with no models references nothing and weighs nothing", () => {
	const scene = emptyScene();
	assert.equal(assetRefs(scene).size, 0);
	assert.equal(assetTotalBytes(scene), 0);
	assert.deepEqual(missingAssets(scene, []), []);
});

test("a missing asset is reported, and it is not the node that is missing", () => {
	// The rule the file exists to hold. A payload the store has never seen is a
	// relink, and the model is still a node with a box: nothing here removes it,
	// nothing here fails, and the document is unchanged by asking.
	const scene = room([
		{ id: "a", asset: "here" },
		{ id: "b", asset: "gone" },
	]);
	assert.deepEqual(missingAssets(scene, ["here"]), ["gone"]);
	assert.deepEqual(missingAssets(scene, new Set(["here", "gone"])), []);
	// Sorted, so a panel that lists them twice lists them the same way twice.
	assert.deepEqual(missingAssets(room([
		{ id: "a", asset: "z" },
		{ id: "b", asset: "m" },
		{ id: "c", asset: "a" },
	]), []), ["a", "m", "z"]);
	assert.equal(assetInfo(scene, "gone")?.name, "gone");
	assert.equal(assetInfo(scene, "never-imported"), undefined);
});

test("the index and the nodes can disagree, and each question reads its own side", () => {
	// An entry nothing points at is an orphan the next edit drops; a node whose
	// hash has no entry is a document that arrived without its metadata. Both are
	// legal states of a scene and the two readers must not confuse them.
	const scene = room([{ id: "a", asset: "used" }]);
	const withOrphan: Scene = {
		...scene,
		assets: { ...scene.assets, orphan: info("orphan", 500) },
	};
	assert.deepEqual([...assetRefs(withOrphan).keys()], ["used"], "refs read the nodes");
	assert.equal(assetTotalBytes(withOrphan), 1000, "an orphan is not a download");
	assert.ok(assetInfo(withOrphan, "orphan"), "but the index still remembers it");
	// pruneAssets is the edit that resolves it, and it leaves the used one alone.
	const pruned = pruneAssets(withOrphan);
	assert.deepEqual(Object.keys(pruned.assets ?? {}), ["used"]);

	// The other direction: a model with no index entry is still a reference.
	const noInfo: Scene = { ...scene, assets: {} };
	assert.deepEqual([...assetRefs(noInfo).keys()], ["used"]);
	assert.equal(assetTotalBytes(noInfo), 0, "unknown weighs nothing rather than guessing");
});

test("the memory store satisfies the whole interface, so a test drives real code", () => {
	// Not a mock. An import driven through this is driven through the same calls
	// the app's IndexedDB store answers, which is what makes the headless test
	// worth having.
	const bytes = new Uint8Array([1, 2, 3]);
	const store = memoryAssetStore();
	return (async () => {
		assert.equal(await store.has("h"), false);
		assert.equal(await store.get("h"), undefined);
		await store.put("h", bytes);
		assert.equal(await store.has("h"), true);
		assert.deepEqual(await store.get("h"), bytes);
		await store.put("g", new Uint8Array([9]));
		assert.deepEqual(await store.keys(), ["g", "h"], "sorted");
		await store.remove("h");
		assert.deepEqual(await store.keys(), ["g"]);
		// Removing what was never there is not an error: a store is a set, and a
		// caller cleaning up after a failed import should not have to check first.
		await store.remove("nothing");
		assert.deepEqual(await store.keys(), ["g"]);
	})();
});

test("a store seeded from pairs answers for them", () => {
	const store = memoryAssetStore([["a", new Uint8Array([1])]]);
	return (async () => {
		assert.deepEqual(await store.keys(), ["a"]);
		assert.deepEqual(await store.get("a"), new Uint8Array([1]));
	})();
});
