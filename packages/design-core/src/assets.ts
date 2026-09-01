/**
 * Where the bytes live.
 *
 * A `model` node holds a {@link MeshRef} — a path into the project's tree, one
 * part of the file at that path, a box and a triangle count — and `Scene.assets`
 * holds an {@link AssetInfo} per path. Between them that is everything the
 * *editor* needs: a layer row, a constraint, a budget, a name. What neither
 * holds is the geometry, because a chair is two megabytes of vertices and a
 * document is a thing that gets sent, diffed, undone and kept in memory a
 * hundred times over.
 *
 * So the payload lives in the project's file tree beside the document, and this
 * file is the vocabulary the three packages share about it: `design-core`
 * answers every question that can be answered from the document alone, the app
 * owns the tree, and `canvas-3d` takes an {@link AssetResolver} and never learns
 * where the bytes came from.
 *
 * **Nothing here does any I/O.** The helpers are pure readings of a `Scene`.
 * That is what keeps this file in a package with no DOM in its `lib` — and it is
 * also what makes the interesting question testable headlessly, because "which
 * assets is this document missing" is a set difference and not a database.
 *
 * ## Addressed by path, and what that costs and buys
 *
 * These functions used to key on a SHA-256 of the payload, and the argument for
 * it was real: because the id *was* the content, a store could never hold the
 * wrong bytes under a name — there was no cache to invalidate and no version to
 * check. That property is gone and it was traded deliberately, because it is the
 * same property as "replacing the file cannot replace the picture". A designer
 * who drops a fixed chair into the project's tree over the old one expects every
 * node that drew it to draw the new one, and under content addressing that was
 * not a re-import of one file but a re-import of every node. See
 * `docs/model-files.md` §0, which argues the trade in full, and
 * {@link MeshRef.src}, which argues it again where the field lives.
 *
 * What the change buys here beyond the editing story: an entry per **file**
 * rather than per primitive. Ten legs of one chair were ten hash-keyed payloads
 * that summed to ten times the download; they are one path with ten node ids
 * against it, which makes {@link assetTotalBytes} correct in fact and not merely
 * in code. It did not change a line of the sum.
 *
 * ## A missing asset is a sentence, never a failure
 *
 * Bytes and documents part company: a project copied without its tree, a
 * browser that cleared site data, a file shared with a colleague. The rule this
 * file exists to hold is that none of that may cost the designer their layout.
 * A `model` whose file is missing is still a node — it solves, it constrains,
 * it exports its box, it keeps its place in the layer list — and what it lacks
 * is a picture. {@link missingAssets} is how the studio finds them to say so;
 * `Model.tsx` draws its stand-in box meanwhile. "Relink this" and "your chair
 * is gone" are two different sentences and only the first one is ever true.
 *
 * A path makes that sentence better rather than worse, which was not the reason
 * for the change but is worth recording: "`/assets/chair.glb` is missing" is
 * something a person can go and look for, and a 64-character hex string never
 * was.
 */
import type { AssetInfo, Scene } from "./scene.ts";
import { flatten } from "./tree.ts";

/**
 * Fetch one payload by its path in the project's tree.
 *
 * `canvas-3d` takes this rather than anything that could write, and the
 * narrowing is the point: a renderer that could put bytes somewhere is a
 * renderer that could change the document, and one that could enumerate them is
 * one that could decide what to draw by looking at the database rather than at
 * the answer set. It is handed one path and gives back bytes or nothing.
 *
 * The parameter is still spelled `id` and has been a path since `f2b6316`; the
 * name is the last piece of the hash-addressed vocabulary left standing, and it
 * is left alone because renaming a parameter of an exported function type
 * changes no call site and no behaviour and would put churn in a diff that has
 * enough of it.
 *
 * There is deliberately no store *interface* beside this. There was one — five
 * async methods, `get`/`put`/`has`/`keys`/`remove`, keyed by content hash — and
 * it never had an implementation outside its own test: the app writes through
 * the vfs, which is a tree and not a set of hashes, and the tree is the thing
 * `MeshRef.src` now points into. An interface with no implementor is a second
 * opinion about where bytes live, and this change removed the possibility of a
 * second opinion rather than adding one.
 */
export type AssetResolver = (id: string) => Promise<Uint8Array | undefined>;

/**
 * Every file the document references, by path, with the models that reference
 * it.
 *
 * Read off the nodes rather than off `Scene.assets`, and the difference is the
 * whole reason this is a function: the index is what the document *remembers*
 * and the nodes are what it *uses*, and the two can disagree in both
 * directions. An index entry with no node is an orphan `pruneAssets` drops on
 * the next edit; a node whose path is in no index is a document that arrived
 * without its metadata, which is rarer and worse and is why
 * {@link missingAssets} asks about the tree rather than about the index.
 *
 * Keyed on `node.mesh.src` and **not** on the src-and-part pair, which is the
 * one judgement in this function. Every caller of this is asking a question
 * about a download — is it here, what does it weigh, what is its name — and ten
 * parts of one chair are one download, one absence and one relink. The part is
 * how a node picks its geometry out of bytes that have already arrived, which is
 * a question for the renderer and never for this file.
 */
export function assetRefs(scene: Scene): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const node of flatten(scene.nodes)) {
		const src = node.mesh?.src;
		if (src === undefined) continue;
		const at = out.get(src);
		if (at) at.push(node.id);
		else out.set(src, [node.id]);
	}
	return out;
}

/**
 * Paths this document's models point at that `held` does not have — the relink
 * list.
 *
 * `held` is whatever the caller can answer for: the paths in the project's tree,
 * or one subset of them. Sorted, so a panel listing them twice lists them in the
 * same order twice, and a test can assert the list rather than the set.
 */
export function missingAssets(scene: Scene, held: Iterable<string>): string[] {
	const have = held instanceof Set ? held : new Set(held);
	return [...assetRefs(scene).keys()].filter((src) => !have.has(src)).sort();
}

/**
 * What the document says its geometry weighs, without loading a byte of it.
 *
 * Off `AssetInfo.bytes`, which is exactly why that field is in the document:
 * the studio wants to say "4.2 MB of models" beside a project in a list, and
 * opening every payload to total them would make an overview page load a
 * scene's worth of vertices per row.
 *
 * Counted per distinct file rather than per model, because two chairs in one
 * room are one download — and, since the index is keyed by path, so are two
 * *parts* of one chair. That second clause is new and is the whole of what
 * §6 bought: this sum was written to be right and only became right when
 * `AssetInfo.bytes` started meaning the size of a file somebody imported.
 */
export function assetTotalBytes(scene: Scene): number {
	let total = 0;
	for (const src of assetRefs(scene).keys()) {
		total += scene.assets?.[src]?.bytes ?? 0;
	}
	return total;
}

/** What the document remembers about the file at one path, or nothing. */
export const assetInfo = (scene: Scene, src: string): AssetInfo | undefined =>
	scene.assets?.[src];
