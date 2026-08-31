/**
 * Where the bytes live.
 *
 * A `model` node holds a {@link MeshRef} — a content hash, a box, a triangle
 * count and the file it came from — and `Scene.assets` holds an
 * {@link AssetInfo} per hash. Between them that is everything the *editor*
 * needs: a layer row, a constraint, a budget, a name. What neither holds is the
 * geometry, because a chair is two megabytes of vertices and a document is a
 * thing that gets sent, diffed, undone and kept in memory a hundred times over.
 *
 * So the payload lives in a content-addressed store beside the document, and
 * this file is the vocabulary the three packages share about it: `design-core`
 * defines what a store is and answers every question that can be answered from
 * the document alone, the app implements one over IndexedDB, and `canvas-3d`
 * takes a {@link AssetResolver} and never learns where the bytes came from.
 *
 * **Nothing here does any I/O.** The interface is a type; the helpers are pure
 * readings of a `Scene`. That is what keeps this file in a package with no DOM
 * in its `lib` — and it is also what makes the interesting question testable
 * headlessly, because "which assets is this document missing" is a set
 * difference and not a database.
 *
 * ## Content addressing, and the one thing it buys
 *
 * The id is a SHA-256 of the payload, so two imports of one chair are one
 * stored asset and a document that references it twice stores it once. That is
 * the ordinary reason. The one worth writing down is different: because the id
 * *is* the content, a store can never hold the wrong bytes under a name. There
 * is no cache to invalidate and no version to check — a hash either resolves or
 * it does not, and a resolver that returns anything at all is returning the
 * geometry that was imported. Every other design here has to ask "is this
 * still the right chair"; this one cannot be asked it.
 *
 * ## A missing asset is a sentence, never a failure
 *
 * Bytes and documents part company: a project copied without its store, a
 * browser that cleared site data, a file shared with a colleague. The rule this
 * file exists to hold is that none of that may cost the designer their layout.
 * A `model` whose asset is missing is still a node — it solves, it constrains,
 * it exports its box, it keeps its place in the layer list — and what it lacks
 * is a picture. {@link missingAssets} is how the studio finds them to say so;
 * `Model.tsx` draws its stand-in box meanwhile. "Relink this" and "your chair
 * is gone" are two different sentences and only the first one is ever true.
 */
import type { AssetInfo, Scene } from "./scene.ts";
import { flatten } from "./tree.ts";

/**
 * Somewhere payloads can be put and got, keyed by their own hash.
 *
 * Asynchronous throughout because the only real implementation is IndexedDB and
 * the only real hash is `crypto.subtle.digest`, both of which are promises. A
 * synchronous store would be a store that could not be the one the app uses,
 * and an interface shaped around the fake is an interface that lies.
 *
 * Deliberately five methods and no cache, no eviction and no reference
 * counting. What may be deleted is a question about the *document* —
 * `pruneAssets` answers it on the only edit that can orphan one — and a store
 * that made that decision for itself would be a second opinion about which
 * chairs still exist.
 */
export interface AssetStore {
	/** The payload, or nothing where this store has never held it. */
	get(id: string): Promise<Uint8Array | undefined>;
	/**
	 * Store a payload under its own hash, and hand back that hash.
	 *
	 * Takes the id rather than computing it, because the hash is computed once
	 * at import — see `importGltf`, which needs it to build the `MeshRef` before
	 * anything is stored — and hashing twice would be a second implementation of
	 * the identity every other method depends on.
	 */
	put(id: string, bytes: Uint8Array): Promise<void>;
	has(id: string): Promise<boolean>;
	/** Every id held, so the studio can total, audit and garbage-collect. */
	keys(): Promise<string[]>;
	remove(id: string): Promise<void>;
}

/**
 * Fetch one payload — the half of {@link AssetStore} a renderer needs.
 *
 * `canvas-3d` takes this and not the store, and the narrowing is the point: a
 * renderer that could `put` is a renderer that could change the document, and
 * one that could `keys` is one that could decide what to draw by looking at the
 * database rather than at the answer set. It is handed one hash and gives back
 * bytes or nothing.
 */
export type AssetResolver = (id: string) => Promise<Uint8Array | undefined>;

/**
 * Every asset the document references, by hash, with the models that reference
 * it.
 *
 * Read off the nodes rather than off `Scene.assets`, and the difference is the
 * whole reason this is a function: the index is what the document *remembers*
 * and the nodes are what it *uses*, and the two can disagree in both
 * directions. An index entry with no node is an orphan `pruneAssets` drops on
 * the next edit; a node whose hash is in no index is a document that arrived
 * without its metadata, which is rarer and worse and is why
 * {@link missingAssets} asks about the store rather than about the index.
 */
export function assetRefs(scene: Scene): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const node of flatten(scene.nodes)) {
		const hash = node.mesh?.asset;
		if (hash === undefined) continue;
		const at = out.get(hash);
		if (at) at.push(node.id);
		else out.set(hash, [node.id]);
	}
	return out;
}

/**
 * Hashes this document's models point at that `held` does not have — the
 * relink list.
 *
 * `held` is whatever the caller can answer for: a store's `keys()`, or one
 * project's subset of them. Sorted, so a panel listing them twice lists them in
 * the same order twice, and a test can assert the list rather than the set.
 */
export function missingAssets(scene: Scene, held: Iterable<string>): string[] {
	const have = held instanceof Set ? held : new Set(held);
	return [...assetRefs(scene).keys()].filter((hash) => !have.has(hash)).sort();
}

/**
 * What the document says its geometry weighs, without loading a byte of it.
 *
 * Off `AssetInfo.bytes`, which is exactly why that field is in the document:
 * the studio wants to say "4.2 MB of models" beside a project in a list, and
 * opening every payload to total them would make an overview page load a
 * scene's worth of vertices per row.
 *
 * Counted per distinct asset rather than per model, because two chairs in one
 * room are one download.
 */
export function assetTotalBytes(scene: Scene): number {
	let total = 0;
	for (const hash of assetRefs(scene).keys()) {
		total += scene.assets?.[hash]?.bytes ?? 0;
	}
	return total;
}

/** What the document remembers about one asset, or nothing. */
export const assetInfo = (scene: Scene, hash: string): AssetInfo | undefined =>
	scene.assets?.[hash];

/**
 * A store that keeps everything in a Map — for tests, and for any host with no
 * database.
 *
 * Not a stub: it satisfies the whole interface honestly, so a test that drives
 * an import through it is driving the real code path and not a mock of it. What
 * it does not do is survive a reload, which is the one thing the app's
 * implementation exists for.
 *
 * The bytes are stored as handed over. Copying them would be defensive against
 * a caller that mutates a payload it has already stored, which is a thing no
 * caller does and which content addressing makes incoherent anyway — mutating
 * the bytes changes what the hash means, and the store would be right and the
 * caller wrong.
 */
export function memoryAssetStore(
	initial?: Iterable<readonly [string, Uint8Array]>,
): AssetStore {
	const held = new Map<string, Uint8Array>(initial);
	return {
		async get(id) {
			return held.get(id);
		},
		async put(id, bytes) {
			held.set(id, bytes);
		},
		async has(id) {
			return held.has(id);
		},
		async keys() {
			return [...held.keys()].sort();
		},
		async remove(id) {
			held.delete(id);
		},
	};
}
