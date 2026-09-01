import { useEffect, useState } from "react";
import { type Scene, flatten } from "@clingo-design/design-core";

import { resolveAsset } from "../projects/store";

/**
 * Every picture the document uses, as bytes, for the exporter.
 *
 * `exportUniverse` is synchronous — it turns an answer set into a file and does
 * no I/O, which is what lets the whole of it be tested headlessly — so the
 * payloads have to be in hand before it is called. That is the same arrangement
 * `posters` already has, and this is the other half of it.
 *
 * Read off the **document** rather than the answer set, deliberately. A rule can
 * mint an image node and state its own `asset/2`, and such a node draws on the
 * canvas; what it cannot do is name a file this hook would know to load, because
 * the document has no record of it. The exporter names any it could not inline
 * in `lost`, so a rule-minted picture is reported rather than silently blank —
 * and the alternative, walking every universe's model to collect paths, would
 * make opening the export panel solve the whole space.
 *
 * Returns `{}` until the reads land. An export taken in that instant is a file
 * whose images are listed as missing, which is honest and self-correcting: the
 * panel re-renders when they arrive.
 */
export function useImageBytes(scene: Scene): Record<string, Uint8Array> {
	const [bytes, setBytes] = useState<Record<string, Uint8Array>>({});

	// The paths, as a stable string so an unchanged set of images does not
	// re-read every payload on every keystroke — the scene object is new on
	// every edit, and the pictures in it almost never are.
	const paths = [
		...new Set(
			flatten(scene.nodes).flatMap((n) => (n.image ? [n.image.src] : [])),
		),
	]
		.sort()
		.join("\n");

	useEffect(() => {
		const wanted = paths ? paths.split("\n") : [];
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
	}, [paths]);

	return bytes;
}
