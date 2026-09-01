/**
 * Turning a path and a part into geometry a `<mesh>` can draw.
 *
 * The seam `Model.tsx` was written around, with both ends of it in place: the
 * answer set states `asset(N,"/assets/chair.glb")` and `meshpart(N,I,P)`, an
 * {@link AssetResolver} fetches that file from wherever the host keeps the
 * project's tree, and this turns those bytes into a `BufferGeometry`.
 *
 * **Not three.js's `GLTFLoader`, for the reason `gltf.ts` gives at length.** The
 * package already reads glTF, headlessly and without a WebGL context, and a
 * second reader would grow a second idea of what an accessor is.
 *
 * ## The one normalisation, and why this file does none of it
 *
 * What arrives here used to be a payload the importer wrote: one primitive, no
 * material, already scaled, already centred — four lines of accessor reading.
 * What arrives now is **the file the person imported**, whole, and the part this
 * node draws is two indices into it. So the scaling and the centring the
 * importer used to bake into the bytes have to happen on the way to the screen
 * instead, and if they happened *here* they would be a second implementation of
 * `gltfimport.ts`'s — which is exactly the drift `docs/model-files.md` §0 says
 * this change must not buy. They happen in `meshPart`, in `gltf.ts`, which the
 * importer measured the node's box with and which the exporter writes out with.
 * This file selects, fetches and uploads to the GPU; it decides nothing.
 *
 * ## Why the material is not in the file's hands
 *
 * The file's material became *props on the node* at import, which is where a
 * designer can change it and a token can drive it. So only geometry is read here
 * and the colour comes from `materialOf(node.rendered)` — the same call a
 * primitive `mesh` makes. A model and a cube are painted by one code path, and a
 * model's colour is a property of the document like every other.
 *
 * ## Resolution is a race, and the loser is the box
 *
 * A file is megabytes over IndexedDB, a node can be selected and dragged while
 * it loads, and a rule can re-mint the node onto a different file mid-flight. So
 * every resolution is guarded by the path *and the part* it started for: a
 * result that comes back for something the component is no longer showing is
 * dropped rather than drawn. Until one arrives — and forever, where the tree has
 * never held the file — `Model.tsx` draws its stand-in box, which is the honest
 * picture of a node whose geometry is elsewhere.
 */
import type { AssetResolver } from "@clingo-design/design-core";
import { useEffect, useState } from "react";
import { BufferAttribute, BufferGeometry } from "three";

import {
	type GltfFile,
	type MetreBounds,
	type PartRef,
	meshPart,
	parseGltfFile,
} from "./gltf.ts";

/**
 * One part of one file, ready to draw: the vertices, and the box they occupy.
 *
 * The bounds travel **with** the geometry rather than being measured off it
 * again by the caller, and that is the whole reason this is a record and not a
 * `BufferGeometry`. `Model.tsx` has to divide the node's box by the part's own
 * extent to draw a four-metre chair at the size the solver said (see
 * `fitScale`), and the extent it divides by must be the one `meshPart` measured
 * — the same number `MeshRef.bounds` was written from at import and the same one
 * `gltfexport.ts` fits with. A second measurement here, off a `boundingBox`
 * three.js computed, would be a third opinion about how big a chair is, and it
 * would be right until the day it was not.
 */
export interface LoadedPart {
	geometry: BufferGeometry;
	/** In metres, centred on the origin, exactly as {@link meshPart} returned it. */
	bounds: MetreBounds;
}

/**
 * A file's part, as geometry — or `undefined` while it loads, is missing, or
 * cannot be read.
 *
 * One state for all three, deliberately. `Model.tsx` draws the same box for
 * every one of them, and it is the right box in every one of them: the node has
 * a real place and a real size whether the chair inside it has arrived, will
 * never arrive, or arrived broken. Distinguishing them here would be inviting a
 * caller to draw three different wrong pictures.
 *
 * The studio *does* tell them apart, and elsewhere: `missingAssets` reads the
 * document against the tree and reports what needs relinking, which is a
 * question about a project rather than about a frame of rendering.
 *
 * **The effect depends on `node` and `primitive` and never on `part` itself.**
 * The part comes off the answer set, which is rebuilt on every solve, so the
 * object identity changes every time anything in the document changes; an effect
 * keyed on it would refetch the file on every keystroke and, worse, would set
 * state in a loop on a host whose resolver is also rebuilt per render. Two
 * numbers are the whole of what this depends on.
 */
export function useAsset(
	src: string | undefined,
	part: PartRef | undefined,
	resolve: AssetResolver | undefined,
): LoadedPart | undefined {
	const [loaded, setLoaded] = useState<LoadedPart | undefined>();
	const node = part?.node;
	const primitive = part?.primitive;

	useEffect(() => {
		if (src === undefined || node === undefined || primitive === undefined || !resolve) {
			setLoaded(undefined);
			return;
		}
		let alive = true;
		void loadFile(src, resolve)
			.then((file) => {
				// Checked after the fetch and after the parse: `alive` closes over this
				// effect's path and part, so a component whose node changed either of
				// them mid-flight throws the result away instead of drawing it for one
				// frame.
				if (!alive || !file) return;
				const built = partOf(file, { node, primitive });
				if (alive && built) setLoaded(built);
			})
			.catch(() => {
				// A file that will not parse is a missing file as far as the picture is
				// concerned. It is not rethrown: a corrupt asset must cost its own node
				// its geometry and nothing else — not the view it is in, and not the
				// other models beside it.
			});
		return () => {
			alive = false;
			// Geometry holds GPU buffers, which nothing collects for us. Disposing on
			// the way out is what keeps scrubbing a timeline past twenty models from
			// leaking twenty buffers a second.
			setLoaded((previous) => {
				previous?.geometry.dispose();
				return undefined;
			});
		};
	}, [src, node, primitive, resolve]);

	return loaded;
}

/**
 * One fetch and one parse per file per frame, however many parts of it are
 * mounting.
 *
 * This is the cost `docs/model-files.md` §8 names and it is the one thing that
 * got worse: a payload used to be one primitive's bytes fetched by one node, and
 * a file is the whole chair — every primitive, every texture, every animation
 * the importer refused. A chair split into ten parts by its ten materials is ten
 * nodes, and without this it would be ten reads of the same file out of IndexedDB
 * and ten runs of the same JSON parse, in one frame, on mount.
 *
 * **In flight only, and that is what makes it safe.** The entry is dropped the
 * moment the promise settles, so this is not a cache and cannot serve stale
 * bytes: writing new bytes to `/assets/chair.glb` and re-rendering fetches them,
 * which is §0's whole point — *replacing the file replaces the picture*. A
 * parsed cache keyed by path would silently defeat that, and it would also pin
 * the file in memory, because `GltfFile` holds its buffers as subarrays of the
 * bytes. §8 puts that second and only behind a profile that asks for it, with an
 * invalidation hooked to the vfs subscription that already tells the studio the
 * tree changed.
 *
 * Keyed by path alone rather than by path and resolver: a host has one tree, the
 * resolver is a way of reading it, and two different resolvers racing on one path
 * inside one frame is not a thing this app can do.
 */
const IN_FLIGHT = new Map<string, Promise<GltfFile | undefined>>();

function loadFile(src: string, resolve: AssetResolver): Promise<GltfFile | undefined> {
	const already = IN_FLIGHT.get(src);
	if (already) return already;
	// The resolver is called from inside a promise rather than beside one, so a
	// host whose `resolve` throws synchronously — a store that was closed, a
	// worker that is gone — becomes a rejection this function's callers already
	// handle, instead of an exception thrown out of a `useEffect` body.
	const started = Promise.resolve()
		.then(() => resolve(src))
		.then((bytes) => (bytes ? tryParse(bytes) : undefined))
		.finally(() => {
			// Dropped on settle, whether it resolved or threw — a rejected fetch that
			// stayed in the map would make one flaky read permanent.
			if (IN_FLIGHT.get(src) === started) IN_FLIGHT.delete(src);
		});
	IN_FLIGHT.set(src, started);
	return started;
}

const tryParse = (bytes: Uint8Array): GltfFile | undefined => {
	try {
		return parseGltfFile(bytes);
	} catch {
		return undefined;
	}
};

/**
 * One part of an already-parsed file, as a {@link LoadedPart}.
 *
 * Nothing here throws, for the reason `meshPart` does not: a `MeshRef` whose
 * file has been replaced by a structurally different one at the same path
 * reaches this on a render, and a renderer that threw would take the viewport
 * down over a chair that should have drawn its stand-in box.
 */
export function partOf(file: GltfFile, ref: PartRef): LoadedPart | undefined {
	const part = meshPart(file, ref);
	if ("refused" in part) return undefined;

	const { positions, normals, uvs, indices } = part.triangles;
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
	// every lamp — and so is a part the chain scaled non-uniformly, which is where
	// `scaleTriangles` drops them rather than writing a wrong inverse transpose.
	// Computed rather than refused, because the alternative is a correct import
	// that looks like a bug.
	if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
	return { geometry, bounds: part.bounds };
}

/**
 * One part of a file's bytes, as a {@link LoadedPart} — parse and all.
 *
 * Exported for the test, which writes a file, imports it and reads a part back
 * here: a round trip through the two halves that have to agree about what a
 * vertex is. The hook does not use it, because the hook parses once per file and
 * this parses once per call, which is the difference §8 is about.
 *
 * Returns nothing rather than throwing on every shape a file can be wrong in,
 * because the caller's answer to all of them is the same box.
 */
export function geometryOf(bytes: Uint8Array, ref: PartRef): LoadedPart | undefined {
	const file = tryParse(bytes);
	return file ? partOf(file, ref) : undefined;
}
