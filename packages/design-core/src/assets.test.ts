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

import { assetInfo, assetRefs, assetTotalBytes, missingAssets } from "./assets.ts";
import { makeNode, pruneAssets } from "./edits.ts";
import type { AssetInfo, MeshRef, Scene, SceneNode } from "./scene.ts";
import { emptyScene } from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";

const px = (n: number): number => n * EMU_PER_PX;

/**
 * A reference to one part of one file.
 *
 * `part` is a parameter with a default rather than a constant, because the
 * question this file's re-keying raised is exactly "what do two *parts* of one
 * file do here", and a fixture that could not spell two parts could not ask it.
 */
const ref = (src: string, part = 0): MeshRef => ({
	src,
	format: "glb",
	part: { node: 0, primitive: part },
	bounds: { x: 0, y: 0, width: px(40), height: px(40), z: 0, depth: px(40) },
	triangles: 12,
});

const info = (name: string, bytes: number): AssetInfo => ({
	format: "glb",
	bytes,
	triangles: 12,
	name,
});

/** A room with however many models in it, each naming a file by path. */
function room(models: Array<{ id: string; asset: string; part?: number }>): Scene {
	const nodes: SceneNode[] = models.map((m) => ({
		...makeNode("model", { x: 0, y: 0, width: px(40), height: px(40) }, {
			id: m.id,
			name: m.id,
		}),
		mesh: ref(m.asset, m.part),
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

test("two models of one chair are one file", () => {
	// The map is keyed by the path, so however many nodes point at one file there
	// is one entry, one download and one relink. This used to be the property
	// content addressing bought — importing the same bytes twice could not make
	// two entries — and it survives the move to paths for a different reason:
	// importing the same *file* twice is one write to one path.
	const scene = room([
		{ id: "a", asset: "/assets/h1.glb" },
		{ id: "b", asset: "/assets/h1.glb" },
		{ id: "c", asset: "/assets/h2.glb" },
	]);
	const refs = assetRefs(scene);
	assert.deepEqual([...refs.keys()].sort(), ["/assets/h1.glb", "/assets/h2.glb"]);
	assert.deepEqual(refs.get("/assets/h1.glb"), ["a", "b"]);
	// And it is one download, not two.
	assert.equal(assetTotalBytes(scene), 2000);
});

test("six legs of one chair are one download, which is what re-keying bought", () => {
	// The case the old index could not represent, and the reason `§6` re-keyed it.
	// A chair imported as six primitives is six `model` nodes; under content
	// addressing each carried the hash of its *own* extracted payload, so six
	// entries summed to six times a download that happens once. Keyed by path
	// they are one entry with six node ids against it, and `assetTotalBytes` is
	// correct in fact rather than only in code.
	const chair = "/assets/chair.glb";
	const scene = room(
		["seat", "back", "leg1", "leg2", "leg3", "leg4"].map((id, i) => ({
			id,
			asset: chair,
			part: i,
		})),
	);
	const refs = assetRefs(scene);
	assert.deepEqual([...refs.keys()], [chair], "one file");
	assert.equal(refs.get(chair)?.length, 6, "six nodes against it");
	assert.equal(assetTotalBytes(scene), 1000, "and one download, not six");
	// The part is deliberately not in the key: every question this file answers
	// is a question about a file, and a primitive index answers none of them.
	assert.deepEqual(missingAssets(scene, []), [chair], "one thing to relink");
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
		{ id: "a", asset: "/assets/here.glb" },
		{ id: "b", asset: "/assets/gone.glb" },
	]);
	assert.deepEqual(missingAssets(scene, ["/assets/here.glb"]), ["/assets/gone.glb"]);
	assert.deepEqual(
		missingAssets(scene, new Set(["/assets/here.glb", "/assets/gone.glb"])),
		[],
	);
	// Sorted, so a panel that lists them twice lists them the same way twice.
	assert.deepEqual(missingAssets(room([
		{ id: "a", asset: "/assets/z.glb" },
		{ id: "b", asset: "/assets/m.glb" },
		{ id: "c", asset: "/assets/a.glb" },
	]), []), ["/assets/a.glb", "/assets/m.glb", "/assets/z.glb"]);
	assert.equal(assetInfo(scene, "/assets/gone.glb")?.name, "/assets/gone.glb");
	assert.equal(assetInfo(scene, "/assets/never-imported.glb"), undefined);
});

test("the index and the nodes can disagree, and each question reads its own side", () => {
	// An entry nothing points at is an orphan the next edit drops; a node whose
	// hash has no entry is a document that arrived without its metadata. Both are
	// legal states of a scene and the two readers must not confuse them.
	const used = "/assets/used.glb";
	const scene = room([{ id: "a", asset: used }]);
	const withOrphan: Scene = {
		...scene,
		assets: { ...scene.assets, "/assets/orphan.glb": info("orphan", 500) },
	};
	assert.deepEqual([...assetRefs(withOrphan).keys()], [used], "refs read the nodes");
	assert.equal(assetTotalBytes(withOrphan), 1000, "an orphan is not a download");
	assert.ok(assetInfo(withOrphan, "/assets/orphan.glb"), "the index still remembers it");
	// pruneAssets is the edit that resolves it, and it leaves the used one alone.
	const pruned = pruneAssets(withOrphan);
	assert.deepEqual(Object.keys(pruned.assets ?? {}), [used]);

	// The other direction: a model with no index entry is still a reference.
	const noInfo: Scene = { ...scene, assets: {} };
	assert.deepEqual([...assetRefs(noInfo).keys()], [used]);
	assert.equal(assetTotalBytes(noInfo), 0, "unknown weighs nothing rather than guessing");
});

test("pruning drops the index entry and never claims to have dropped a file", () => {
	// The choice that only became visible when the key became a path. Under
	// content addressing the payloads were in a store nothing in the tree
	// implemented, so "what happens to the bytes" had no answer; now they are a
	// file in the project a person can open, and an edit that deleted megabytes
	// on a ⌫ would be helpfulness nobody can undo.
	//
	// This asserts the only half `design-core` can assert — that the function
	// returns a `Scene` and touches nothing else. The other half is structural
	// and stronger: this module cannot reach the tree, has no I/O, and could not
	// delete a file if it wanted to.
	const scene = room([{ id: "a", asset: "/assets/chair.glb" }]);
	const gone: Scene = { ...scene, nodes: [{ ...scene.nodes[0], children: [] }] };
	const pruned = pruneAssets(gone);
	assert.equal(pruned.assets, undefined, "the last entry leaves no empty index behind");
	assert.deepEqual(Object.keys(pruned), Object.keys(gone).filter((k) => k !== "assets"));
});

test("an image beside a model is not in the index, and pruning leaves it alone", () => {
	// `pruneAssets` reads `node.mesh.src` and deliberately not `node.image.src`,
	// even now that both are paths into the same tree. An image's intrinsic size
	// is on its own ref, no panel totals photographs, and there is no `AssetInfo`
	// for one to prune — so widening this to both kinds is a separate change with
	// its own argument to make, and not an oversight this test should paper over.
	const scene = room([{ id: "a", asset: "/assets/chair.glb" }]);
	const base = scene.nodes[0];
	const withPhoto: Scene = {
		...scene,
		nodes: [{
			...base,
			children: [
				...(base.children ?? []),
				{
					...makeNode("image", { x: 0, y: 0, width: px(40), height: px(40) }, {
						id: "photo",
						name: "photo",
					}),
					image: {
						src: "/assets/hero.png",
						mimeType: "image/png",
						width: px(40),
						height: px(40),
					},
				},
			],
		}],
	};
	assert.deepEqual(
		[...assetRefs(withPhoto).keys()],
		["/assets/chair.glb"],
		"the photograph is not an asset this index knows about",
	);
	assert.deepEqual(Object.keys(pruneAssets(withPhoto).assets ?? {}), ["/assets/chair.glb"]);
});
