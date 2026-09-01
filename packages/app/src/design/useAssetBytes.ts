import { useEffect, useState } from "react";
import { type Scene, flatten } from "@clingo-design/design-core";

import { resolveAsset } from "../projects/store";

/**
 * The payloads an export needs, fetched out of the project's tree.
 *
 * `exportUniverse` and `exportViewportGltf` are both synchronous — they turn an
 * answer set into a file and do no I/O, which is what lets the whole of both be
 * tested headlessly — so the payloads have to be in hand before either is
 * called. This is the other half of that arrangement, and it is one hook rather
 * than two because there is now one kind of thing to fetch: **a path into the
 * project's tree**. A photograph and a chair are the same problem since
 * geometry stopped being content-addressed, and a second hook would have been
 * the same eight lines wearing a different noun.
 *
 * This file was `useImageBytes` and the rename is the point of `§9`: the glTF
 * exporter used to take a `geometry?: (nodeId) => Uint8Array` callback because a
 * `ModelScene` could not say which *file* a node drew, only which content hash,
 * and the hash was not a thing this hook could look up. It says the path now, so
 * both exporters take one map keyed by path and one hook fills both.
 */

/**
 * The paths the document's nodes of one kind reference, deduplicated and sorted.
 *
 * Read off the **document** rather than the answer set, deliberately. A rule can
 * mint an image or a model node and state its own `asset/2`, and such a node
 * draws on the canvas; what it cannot do is name a file this could know to load,
 * because the document has no record of it. Both exporters name any payload they
 * could not inline in `lost`, so a rule-minted picture is reported rather than
 * silently blank — and the alternative, walking every universe's model to
 * collect paths, would make opening the export panel solve the whole space.
 *
 * Sorted so that {@link usePathBytes}'s effect key is a property of *which*
 * files are referenced and not of the order the tree happens to be walked in.
 */
export function assetPaths(scene: Scene, kind: "image" | "mesh"): string[] {
	const refs = flatten(scene.nodes).flatMap((n) => {
		const src = kind === "image" ? n.image?.src : n.mesh?.src;
		return src ? [src] : [];
	});
	return [...new Set(refs)].sort();
}

/**
 * Those paths, as bytes.
 *
 * Takes the paths rather than the scene, which is the one structural decision
 * here and is what keeps an HTML export from reading a twenty-megabyte chair.
 * The panel knows which target is selected and therefore which payloads that
 * target can possibly use; a hook that took the scene would have to fetch both
 * kinds always, because a hook cannot be called conditionally. So the caller
 * passes an empty list for the kind it does not need, and "which files does this
 * export want" stays a question about the target rather than becoming a question
 * about I/O.
 *
 * The effect is keyed on the joined paths and not on the array, because the
 * array is new on every render — the scene object is new on every keystroke and
 * the pictures in it almost never are.
 *
 * One fetch per path and no cache, deliberately, for the reason `useAsset.ts`
 * gives at greater length: a cache keyed by path serves the old bytes after the
 * file is replaced, and "replacing the file replaces the picture" is the whole
 * of why these are paths. This is a panel somebody opens, not a render loop.
 *
 * Returns `{}` until the reads land. An export taken in that instant is a file
 * whose payloads are listed as missing, which is honest and self-correcting: the
 * panel re-renders when they arrive.
 */
export function usePathBytes(paths: readonly string[]): Record<string, Uint8Array> {
	const [bytes, setBytes] = useState<Record<string, Uint8Array>>({});
	const key = paths.join("\n");

	useEffect(() => {
		const wanted = key ? key.split("\n") : [];
		if (wanted.length === 0) {
			setBytes({});
			return;
		}
		let alive = true;
		void Promise.all(
			wanted.map(async (path) => [path, await resolveAsset(path)] as const),
		).then((pairs) => {
			if (!alive) return;
			const out: Record<string, Uint8Array> = {};
			for (const [path, data] of pairs) if (data) out[path] = data;
			setBytes(out);
		});
		return () => {
			alive = false;
		};
	}, [key]);

	return bytes;
}
