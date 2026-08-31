/**
 * A `model` node — imported geometry — drawn as **its bounding box**, because
 * the geometry is not here.
 *
 * **Read this before assuming the feature is missing something small.** A
 * `model` is the one kind whose picture does not live in the answer set. Its
 * `frame/3` does, its `turn/3` does, its material does, and `tris/2` carries the
 * triangle count — but the vertices are a payload addressed by a content hash on
 * `SceneNode.mesh`, and the payload itself is in an `AssetStore`. Two of those
 * three things do not exist at the time this package was written:
 *
 *   - `design-core/src/assets.ts` — the `AssetStore` interface and
 *     `referencedAssets` (`docs/merged-plan.md` M4) — **is not in the tree**;
 *   - `packages/app/src/projects/assets.ts`, the IndexedDB implementation
 *     (M20) — **is not in the tree**;
 *   - and `MeshRef` (the hash, the format and the imported bounds) is a field of
 *     the *document*, which this package does not read, by the same rule that
 *     keeps the picture the solver's answer.
 *
 * So `useAsset.ts` and a `GLTFLoader` are not written here. Writing them would
 * have meant inventing the store interface they load through, and inventing an
 * interface other steps are coding against is the one thing this run was told
 * not to do quietly. **This is reported as unbuilt, not as done.**
 *
 * What *is* drawn is the honest remainder, and it is not a placeholder graphic:
 * a `model` is a node with a real box that the solver placed, that a rule can
 * align, that a state can move and that a pivot turns, and all of that is true
 * of the box whether or not the chair inside it has loaded. So it draws as its
 * box, in its own material, with an edge on it so it reads as *a stand-in for
 * geometry* rather than as a cube somebody modelled. It is the same answer the
 * glTF exporter is specified to give when it is not handed the bytes — "Model
 * “Chair” is in the file as its bounding box" — which is worth matching: two
 * readers that disagree about what a model with no payload is would be two
 * documents.
 *
 * The seam this leaves for whoever builds it: replace the body of this component
 * with the loaded `Object3D` when the store has it, keep the box for when it does
 * not, and leave the material and the `userData.nodeId` exactly where they are.
 * Nothing else in this package needs to change.
 */
import type { ModelNode } from "@clingo-design/design-core";
import { BoxGeometry } from "three";

import type { PointerHandlers } from "./SceneTree.tsx";
import { materialOf } from "./readings.ts";

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
}

export function Model({ node, size, pointer }: ModelProps) {
	const material = materialOf(node.rendered);
	const scale: [number, number, number] = [size[0] || 1, size[1] || 1, size[2] || 1];
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
