/**
 * Turning a content hash into geometry a `<mesh>` can draw.
 *
 * The seam `Model.tsx` was written around, now that both ends of it exist: the
 * answer set states `asset(N,"<hash>")` and `ModelScene.assets` carries it, an
 * {@link AssetResolver} fetches the payload from wherever the host keeps bytes,
 * and this turns those bytes into a `BufferGeometry`.
 *
 * **Not three.js's `GLTFLoader`, for the reason `gltf.ts` gives at length.** The
 * package already reads glTF, headlessly and without a WebGL context, and a
 * second reader would grow a second idea of what an accessor is. What is loaded
 * here is not a general glTF anyway: an {@link ImportedAsset} payload is a
 * standalone file holding exactly one triangle primitive, no material and no
 * transform, which `importGltf` wrote precisely so that this could be four lines
 * of accessor reading rather than a scene graph walk.
 *
 * ## Why the material is not in the payload, and is not read here
 *
 * The file's material became *props on the node* at import, which is where a
 * designer can change it and a token can drive it. So the payload carries
 * geometry only and the colour comes from `materialOf(node.rendered)` — the same
 * call a primitive `mesh` makes. A model and a cube are painted by one code
 * path, and a model's colour is a property of the document like every other.
 *
 * ## Resolution is a race, and the loser is the box
 *
 * A payload is megabytes over IndexedDB, a node can be selected and dragged
 * while it loads, and a hash can change under the hook when a rule re-mints the
 * node. So every resolution is guarded by the hash it started for: a result that
 * comes back for a hash the component is no longer showing is dropped rather
 * than drawn. Until one arrives — and forever, where the store has never held
 * the payload — `Model.tsx` draws its stand-in box, which is the honest picture
 * of a node whose geometry is elsewhere.
 */
import type { AssetResolver } from "@clingo-design/design-core";
import { useEffect, useState } from "react";
import { BufferAttribute, BufferGeometry } from "three";

import { parseGltfFile, readTriangles } from "./gltf.ts";

/**
 * A payload, as geometry — or `undefined` while it loads, is missing, or cannot
 * be read.
 *
 * One state for all three, deliberately. `Model.tsx` draws the same box for
 * every one of them, and it is the right box in every one of them: the node has
 * a real place and a real size whether the chair inside it has arrived, will
 * never arrive, or arrived broken. Distinguishing them here would be inviting a
 * caller to draw three different wrong pictures.
 *
 * The studio *does* tell the two apart, and elsewhere: `missingAssets` reads the
 * document against the store and reports what needs relinking, which is a
 * question about a project rather than about a frame of rendering.
 */
export function useAsset(
	hash: string | undefined,
	resolve: AssetResolver | undefined,
): BufferGeometry | undefined {
	const [geometry, setGeometry] = useState<BufferGeometry | undefined>();

	useEffect(() => {
		if (hash === undefined || resolve === undefined) {
			setGeometry(undefined);
			return;
		}
		let alive = true;
		void resolve(hash)
			.then((bytes) => {
				if (!alive || !bytes) return;
				const built = geometryOf(bytes);
				// Checked again after the parse: `alive` closes over this effect's
				// hash, so a component whose node changed asset mid-parse throws the
				// old geometry away instead of drawing it for one frame.
				if (alive && built) setGeometry(built);
			})
			.catch(() => {
				// A payload that will not parse is a missing payload as far as the
				// picture is concerned. It is not thrown: a corrupt asset must cost
				// its own node its geometry and nothing else — not the view it is in,
				// and not the other models beside it.
			});
		return () => {
			alive = false;
			// Geometry holds GPU buffers, which nothing collects for us. Disposing on
			// the way out is what keeps scrubbing a timeline past twenty models from
			// leaking twenty buffers a second.
			setGeometry((previous) => {
				previous?.dispose();
				return undefined;
			});
		};
	}, [hash, resolve]);

	return geometry;
}

/**
 * One payload's single primitive, as a `BufferGeometry`.
 *
 * Exported for the test, which builds a payload with `importGltf` and reads it
 * back here — a round trip through the two halves that have to agree about what
 * a vertex is.
 *
 * Returns nothing rather than throwing on every shape a file can be wrong in,
 * because the caller's answer to all of them is the same box.
 */
export function geometryOf(bytes: Uint8Array): BufferGeometry | undefined {
	let file: ReturnType<typeof parseGltfFile>;
	try {
		file = parseGltfFile(bytes);
	} catch {
		return undefined;
	}
	const primitive = file.json.meshes?.[0]?.primitives?.[0];
	if (!primitive) return undefined;
	const read = readTriangles(file, primitive);
	if ("refused" in read) return undefined;

	const { positions, normals, uvs, indices } = read.triangles;
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new BufferAttribute(positions, 3));
	if (normals && normals.length === positions.length) {
		geometry.setAttribute("normal", new BufferAttribute(normals, 3));
	}
	if (uvs && uvs.length === (positions.length / 3) * 2) {
		geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
	}
	geometry.setIndex(new BufferAttribute(indices, 1));
	// A file with no normals is a file that would otherwise draw flat black under
	// every lamp. Computed rather than refused, because the alternative is a
	// correct import that looks like a bug.
	if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
	return geometry;
}
