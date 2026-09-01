/**
 * A `model` node — imported geometry, drawn when the bytes are here and drawn as
 * **its bounding box** when they are not.
 *
 * A `model` is the one kind whose picture does not live entirely in the answer
 * set. Its `frame/3` does, its `turn/3` does, its material does, `tris/2` carries
 * the triangle count, `asset/2` carries the path of the file in the project's
 * tree and `meshpart/3` carries which part of it — but the vertices are in that
 * file, and reading a file is I/O. So the path and the two indices come off the
 * answer set like everything else this package draws, and the bytes come through
 * an {@link AssetResolver} the host supplies: `canvas-3d` never learns whether
 * they were in IndexedDB, in memory or over a network, which is what keeps it a
 * renderer.
 *
 * **Both halves off the answer set, and `meshpart/3` is the half that is easy to
 * forget.** A rule that mints a model must get its geometry drawn exactly as a
 * rule that mints a rect gets its fill, and a path with no part selector is a
 * chair that draws its first primitive whatever the document said — which looks
 * like a missing asset and so goes unnoticed. `f2b6316` found and paid for that
 * failure mode once already, with a reader whose `#show` had never shipped.
 *
 * `useAsset.ts` does the loading and says why it is not three's `GLTFLoader`.
 *
 * **The box is not a placeholder graphic and does not go away because it was
 * cheap to keep.** A model with no payload — never imported into this store, a
 * project copied without its assets, a corrupt file — is still a node with a
 * real place and a real size, which the solver decided, which a rule can align,
 * which a state can move and which a pivot turns. All of that is true whether
 * the chair has arrived or not, so the honest picture of it is its box, in its
 * own material, with an edge on it so it reads as *a stand-in for geometry*
 * rather than as a cube somebody modelled. It is the same answer the glTF
 * exporter gives when it is not handed the bytes — "Model “Chair” is in the file
 * as its bounding box" — and two readers that disagreed about what a model with
 * no payload is would be two documents.
 *
 * Which of the two is showing is therefore not an error state and is not
 * reported here. "This document references geometry this store has never held"
 * is a question about a project rather than about a frame, and `missingAssets`
 * answers it where a person can act on it.
 */
import type { AssetResolver, ModelNode } from "@clingo-design/design-core";
import { BoxGeometry } from "three";

import type { PointerHandlers } from "./SceneTree.tsx";
import { fitScale } from "./gltf.ts";
import { materialOf } from "./readings.ts";
import { useAsset } from "./useAsset.ts";

export interface ModelProps {
	node: ModelNode;
	/** The node's box, in renderer units — `worldBox(...).size`. */
	size: readonly [number, number, number];
	/**
	 * Picking and hovering, spread onto the stand-in box.
	 *
	 * All three rather than the single `onPointerDown` this took before, because a
	 * model has to be hoverable for the same reason a mesh does — it is a node in
	 * the layer list and the selection is one selection — and because passing the
	 * handlers as one object is what stops this signature growing a fourth
	 * optional callback the next time.
	 */
	pointer?: PointerHandlers;
	/**
	 * The path of the file this node draws, in the project's tree — `asset/2`,
	 * off `ModelScene.assets`.
	 *
	 * Off the answer set and not off the document, which is the same rule that
	 * keeps every other thing this package draws the solver's answer: a rule that
	 * mints a model states its own `asset/2` and gets its geometry drawn, exactly
	 * as a rule that mints a rect gets its fill.
	 */
	asset?: string;
	/**
	 * Which part of that file — `meshpart/3`, the glTF node index and the
	 * primitive index, off the answer set beside the path.
	 *
	 * Optional in the same way and for the same reason `asset` is: a `mesh`, a
	 * `pivot` and a model whose file the document never stated all arrive here
	 * with nothing, and every one of them is a node that draws its box.
	 */
	part?: { node: number; primitive: number };
	/** Where bytes come from. Absent on a host with no store — see `useAsset`. */
	resolve?: AssetResolver;
}

export function Model({ node, size, pointer, asset, part, resolve }: ModelProps) {
	const material = materialOf(node.rendered);
	const loaded = useAsset(asset, part, resolve);
	/*
	 * The loaded chair, drawn at the size of the box the solver placed.
	 *
	 * `fitScale` and not `size`, and this line is the bug `docs/model-files.md`
	 * §1.1 found. The vertices arrive in **metres** — the file's own numbers,
	 * centred on their own origin, deliberately not divided by anything (see
	 * `fitScale`'s rejected alternative) — while the stand-in beside them is a
	 * `boxGeometry` of `[1,1,1]`, which really is a unit box. Scaling both by the
	 * node's box in render units therefore drew a four-metre slab sixteen metres
	 * wide and a mug at half size, and only the box was ever right. Dividing by
	 * the part's own extent is what makes the two branches the same picture, and
	 * the extent comes off the same `meshPart` measurement that
	 * `MeshRef.bounds` was written from and that `gltfexport.ts` fits with — so
	 * the editor and the export cannot disagree about where a chair sits, which is
	 * the drift this whole change is about.
	 *
	 * `normalized` is deliberately not set on the geometry: the file holds float
	 * positions, and a reader that re-normalised them would be scaling a chair by
	 * whatever its own extent happened to be.
	 */
	const scale: [number, number, number] = loaded
		? fitScale(loaded.bounds, size)
		: [size[0] || 1, size[1] || 1, size[2] || 1];

	if (loaded) {
		return (
			<group scale={scale} userData={{ nodeId: node.id }}>
				<mesh {...pointer} geometry={loaded.geometry} userData={{ nodeId: node.id }}>
					<meshStandardMaterial
						color={material.colour ?? STANDIN}
						roughness={material.roughness}
						metalness={material.metalness}
						opacity={material.opacity}
						transparent={material.transparent}
					/>
				</mesh>
			</group>
		);
	}

	return (
		<group scale={scale} userData={{ nodeId: node.id }}>
			<mesh {...pointer} userData={{ nodeId: node.id }}>
				<boxGeometry args={[1, 1, 1]} />
				{/*
				  * `KINDS.model` states no `fill` default on purpose — an imported
				  * material is the file's, and a fill the document did not ask for
				  * would repaint every asset the moment it landed. So `colour` is
				  * genuinely `undefined` for most models, and this is the one place
				  * in the package that needs its own default rather than the
				  * property's: a stand-in has to be *some* colour, and a stated fill
				  * still overrides it, which is the affordance the table wanted.
				  */}
				<meshStandardMaterial
					color={material.colour ?? STANDIN}
					roughness={material.roughness}
					metalness={material.metalness}
					opacity={material.opacity}
					transparent={material.transparent}
				/>
			</mesh>
			{/*
			  * The edge, so a bounding box reads as a bounding box. Not raycastable —
			  * `raycast` is emptied — so a click on a model still lands on the solid
			  * beneath it and reports the node id once rather than twice.
			  */}
			<lineSegments raycast={() => undefined}>
				<edgesGeometry args={[boxEdges()]} />
				<lineBasicMaterial color={EDGE} />
			</lineSegments>
		</group>
	);
}

/**
 * A unit cube's geometry, built once for the edges of every stand-in.
 *
 * Built lazily rather than at module load, because importing this module must
 * not require a WebGL context or a document — the package is consumed from
 * source and a bare import happens during typechecking and during a server
 * render.
 */
let cube: BoxGeometry | undefined;
const boxEdges = (): BoxGeometry => (cube ??= new BoxGeometry(1, 1, 1));

/** Neutral, mid-tone, and not a colour any palette in the templates uses. */
const STANDIN = "#8899aa";
const EDGE = "#c8d4e0";
