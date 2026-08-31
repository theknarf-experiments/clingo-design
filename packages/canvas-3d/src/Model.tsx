/**
 * A `model` node — imported geometry, drawn when the bytes are here and drawn as
 * **its bounding box** when they are not.
 *
 * A `model` is the one kind whose picture does not live entirely in the answer
 * set. Its `frame/3` does, its `turn/3` does, its material does, `tris/2` carries
 * the triangle count and `asset/2` carries the content hash — but the vertices
 * are a payload in an `AssetStore`, addressed by that hash, and a store is I/O.
 * So the hash comes off `ModelScene.assets` like everything else this package
 * draws, and the bytes come through an {@link AssetResolver} the host supplies:
 * `canvas-3d` never learns whether they were in IndexedDB, in memory or over a
 * network, which is what keeps it a renderer.
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
	 * The content hash of the geometry this node draws — `ModelScene.assets`.
	 *
	 * Off the answer set and not off the document, which is the same rule that
	 * keeps every other thing this package draws the solver's answer: a rule that
	 * mints a model states its own `asset/2` and gets its geometry drawn, exactly
	 * as a rule that mints a rect gets its fill.
	 */
	asset?: string;
	/** Where bytes come from. Absent on a host with no store — see `useAsset`. */
	resolve?: AssetResolver;
}

export function Model({ node, size, pointer, asset, resolve }: ModelProps) {
	const material = materialOf(node.rendered);
	const geometry = useAsset(asset, resolve);
	const scale: [number, number, number] = [size[0] || 1, size[1] || 1, size[2] || 1];

	/*
	 * The loaded chair, drawn in the box the solver placed.
	 *
	 * The payload was written centred on its own origin and in metres, so the
	 * geometry arrives as a unit-ish thing at the middle of nothing; scaling the
	 * group by the node's box is what puts it exactly where every other kind is
	 * put. That is also why the box and the geometry are interchangeable here
	 * rather than two layouts: they occupy the same space by construction, so a
	 * payload arriving mid-drag changes what is drawn and never where.
	 *
	 * `normalized` is deliberately not set on the geometry: `importGltf` wrote
	 * float positions, and a reader that re-normalised them would be scaling a
	 * chair by whatever its own extent happened to be.
	 */
	if (geometry) {
		return (
			<group scale={scale} userData={{ nodeId: node.id }}>
				<mesh {...pointer} geometry={geometry} userData={{ nodeId: node.id }}>
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
