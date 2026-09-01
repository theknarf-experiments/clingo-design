/**
 * A `ModelNode` subtree, as three.js objects.
 *
 * **This file reads the answer set and nothing else.** It is handed
 * `ModelNode`s — what one universe of `readModel` came back with — and it never
 * sees a `Scene`, a `Value`, a token or a pick. Every number it uses was decided
 * by the solver: `frame/3` for the six lengths, `turn/3` for the three angles,
 * `rendered/3` for every material, lamp and lens. That is the same contract the
 * 2D renderer keeps, and it is what makes the picture the solver's answer rather
 * than the editor's opinion — an editor that drew from the document would show a
 * mesh where the document last stored it while the panel beside it showed where
 * a rule had actually put it.
 *
 * It is also the whole of invariant 2 in one function. There is no 3D document
 * model here: a mesh, a camera and a light arrive as `ModelNode`s with a `kind`,
 * an `order`, a `frame`, a `spatial`, a `turn` and a `rendered`, in the same
 * array as the rectangles, and the switch below is the *only* place their kinds
 * are told apart.
 *
 * ## The transform chain, and why it is two groups per node
 *
 * `design-core/src/spatial.ts` gives every node two matrices and this file mounts
 * them as two nested `<group>`s, in the same order and for the same reason:
 *
 *   - `localMatrix` is `T(centre) · R` — the node's **centred** space, which is
 *     the space three.js positions an `Object3D` in, the space CSS's
 *     `transform-origin: center` puts a box in, and the space the document's
 *     rotation is about. That is the outer group, and it is where the node's own
 *     geometry goes.
 *   - `originMatrix` is `localMatrix · T(−half)` — the node's **origin** space,
 *     the near-top-left corner, which is what a child's `frame` is relative to.
 *     That is the inner group, and it is where the children go.
 *
 * With nothing rotated anywhere the product of a chain of these is the plain sum
 * of ancestor origins the flat renderer has always computed, which is the check
 * worth keeping in mind: **the third axis and the matrices cost a flat subtree
 * nothing.**
 *
 * Composing the two into one `Matrix4` per node and setting it with
 * `matrixAutoUpdate = false` would be marginally cheaper and would put a third
 * implementation of the chain in the repo. Two groups is the chain expressed as
 * the scene graph, which is the form three.js can then compose, cull and raycast
 * against for free.
 *
 * ## What is *not* drawn here
 *
 * A `viewport` inside a viewport, a `rect`, a `text` — any 2D kind that has been
 * dragged into a 3D subtree in the layer list. They arrive, because a node is a
 * node and the tree is the tree, and they draw nothing: there is no honest
 * answer to what a paragraph of text is in three dimensions, and drawing a
 * quad with the text on it would be inventing one. Their children are still
 * walked, so a mesh under a stray `group` is still drawn in the right place —
 * a `group` is a transform and a transform is something this file understands.
 */
import { type AssetResolver, type ModelNode, boxOf3 } from "@clingo-design/design-core";
import type { ThreeEvent } from "@react-three/fiber";
import type { RefObject } from "react";

import { type GizmoMode, TransformGizmo } from "./TransformGizmo.tsx";
import { Camera, FramingCamera } from "./Cameras.tsx";
import { Lights } from "./Lights.tsx";
import { Model } from "./Model.tsx";
import { Selection } from "./Selection.tsx";
import { Solid, isSolidKind } from "./Solid.tsx";
import type { SpatialEdit } from "./edits3.ts";
import { lampOf, lensOf, materialOf } from "./readings.ts";
import { worldBox, worldEuler, worldOriginOffset } from "./units3.ts";

/**
 * The three pointer props every drawable node gets, threaded as one object.
 *
 * One object rather than three props because there are exactly three, they are
 * always passed together, and every one of them is `undefined` in the same
 * circumstance — a viewport the editor has not entered takes no pointer events
 * at all. Passing them separately made `Solid`, `Model` and `Placed` each carry
 * three optional parameters that are meaningless apart.
 *
 * They are the *raw* R3F handlers rather than `(id) => void` callbacks, and that
 * is deliberate: the id is on the object the ray hit, `ViewportCanvas` already
 * has the walk that finds it, and a second copy of that walk here would be a
 * second answer to what a pick reports.
 */
export interface PointerHandlers {
	onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
	onPointerOver?: (event: ThreeEvent<PointerEvent>) => void;
	onPointerOut?: (event: ThreeEvent<PointerEvent>) => void;
}

/**
 * Which node the transform gizmo is on, and what it does — see
 * `TransformGizmo.tsx`.
 *
 * Threaded down the tree rather than mounted once at the top, because a gizmo
 * has to stand in the node's own space: its arrows point along the axes the
 * node's `frame` and `spatial` are measured in, which are its *parent's*, and
 * its rings are turned by the node's own `turn`. Composing that space here would
 * be a second copy of the transform chain; mounting it inside the group the
 * chain already built is none.
 */
export interface GizmoSpec {
	/** The model id of the node it is attached to. */
	id: string;
	mode: GizmoMode;
	onEdit: (edit: SpatialEdit) => void;
	grabbed?: RefObject<boolean>;
	onSeize?: () => void;
}

export interface SceneTreeProps {
	/** The viewport's children, straight off `ModelNode.children`. */
	nodes: readonly ModelNode[];
	/**
	 * Which camera `looks/2` named, or `undefined` for none.
	 *
	 * A node id rather than a node, because the answer may name a node that is
	 * not in this tree — see {@link FramingCamera}, which is the case worth
	 * reading about.
	 */
	looksThrough: string | undefined;
	/** The editor's selection, by the same ids the layer list uses. */
	selection?: ReadonlySet<string>;
	/**
	 * What is under the pointer, by the same ids again.
	 *
	 * A set rather than one id, because it carries two things at once and they
	 * merge: what the raycaster is over in *this* view, and what the editor says
	 * is hovered from somewhere else — a row in the layer list, a member of a rule
	 * in the constraints panel. Both mean "this is the object being talked about"
	 * and drawing them the same way is what makes hovering a rule's member light
	 * up the mesh it names.
	 */
	hovered?: ReadonlySet<string>;
	/** Passed to every mesh; absent means the scene takes no pointer events. */
	pointer?: PointerHandlers;
	/** The transform gizmo, on at most one node. */
	gizmo?: GizmoSpec;
	/**
	 * Model node id -> the path of the file it draws — `ModelScene.assets`.
	 *
	 * Threaded down rather than looked up per node, for the reason `looksThrough`
	 * is: this tree is walked once per frame and the whole map is one object.
	 *
	 * The other half of a model's reference — **which part** of that file — is
	 * *not* threaded beside this, and the asymmetry is deliberate rather than an
	 * omission. It is on the node, as `ModelNode.part`, because the map form of
	 * `asset/2` exists so a project can be audited without walking the tree — what
	 * does this design weigh, which files does it need — and a primitive index
	 * answers none of those questions. Only a renderer standing at a node wants
	 * it, and this walk is standing at the node.
	 */
	assets?: Readonly<Record<string, string>>;
	/** Where a payload's bytes come from — see `useAsset.ts`. */
	resolve?: AssetResolver;
}

export function SceneTree({
	nodes,
	looksThrough,
	selection,
	hovered,
	pointer,
	gizmo,
	assets,
	resolve,
}: SceneTreeProps) {
	return (
		<>
			{nodes.map((node) => (
				<Placed
					key={node.id}
					node={node}
					looksThrough={looksThrough}
					selection={selection}
					hovered={hovered}
					pointer={pointer}
					gizmo={gizmo}
					assets={assets}
					resolve={resolve}
				/>
			))}
		</>
	);
}

/**
 * One node: its transform, its own contribution, and its children in its origin
 * space.
 *
 * Nothing here consults `order`. `readModel` has already sorted `children` by
 * `order/2` with the id as a tie-break, so the array arrives in paint order —
 * and paint order is not draw order in three dimensions anyway, where the depth
 * buffer decides. What the order still governs is the *transparent* pass, which
 * three.js sorts back to front by distance, and which therefore also does not
 * consult it. So `order` is real, it is what the layer list shows, and it is
 * genuinely not this file's business.
 */
function Placed({
	node,
	looksThrough,
	selection,
	hovered,
	pointer,
	gizmo,
	assets,
	resolve,
}: {
	node: ModelNode;
	looksThrough: string | undefined;
	selection?: ReadonlySet<string>;
	hovered?: ReadonlySet<string>;
	pointer?: PointerHandlers;
	gizmo?: GizmoSpec;
	assets?: Readonly<Record<string, string>>;
	resolve?: AssetResolver;
}) {
	const { position, size } = worldBox(boxOf3(node));
	const rotation = worldEuler(node.turn);
	const selected = selection?.has(node.id) === true;
	// Selected wins: two coincident line loops z-fight even with the depth test
	// off, and the selection is the stronger claim of the two anyway.
	const marked = selected ? "selected" : hovered?.has(node.id) ? "hovered" : undefined;
	return (
		<>
			<group position={position} rotation={rotation}>
				<Contents
					node={node}
					size={size}
					looksThrough={looksThrough}
					pointer={pointer}
					asset={assets?.[node.id]}
					resolve={resolve}
				/>
				{marked ? <Selection size={size} tone={marked} /> : null}
				<group position={worldOriginOffset(size)}>
					<SceneTree
						nodes={node.children}
						assets={assets}
						resolve={resolve}
						looksThrough={looksThrough}
						selection={selection}
						hovered={hovered}
						pointer={pointer}
						gizmo={gizmo}
					/>
				</group>
			</group>
			{/*
			  * The gizmo, in the node's centre **without its rotation** — a sibling of
			  * the group above rather than a child of it, and that is the whole
			  * geometric argument of `TransformGizmo` expressed as one JSX element.
			  *
			  * The node's `frame`, its `spatial` and the axes its `turn` is applied
			  * about are all measured in the *parent's* origin space, so that is the
			  * space a handle has to stand in: an arrow inside the rotated group would
			  * point along an axis the document has no number for, and dragging it
			  * would have to solve for what combination of x, y and z it meant. Here,
			  * an arrow is one dimension and a ring is one stored angle.
			  *
			  * The rotation the rings *do* need — the prefix that carries `rotateY`'s
			  * ring inside `Rx(a)` — is applied by the gizmo itself, from `node.turn`,
			  * one ring at a time.
			  */}
			{gizmo && gizmo.id === node.id ? (
				<group position={position}>
					<TransformGizmo
						node={node}
						mode={gizmo.mode}
						onEdit={gizmo.onEdit}
						grabbed={gizmo.grabbed}
						onSeize={gizmo.onSeize}
					/>
				</group>
			) : null}
		</>
	);
}

/**
 * What one node *is*, once it is standing in the right place.
 *
 * The switch is exhaustive over the kinds this package draws and silent about
 * every other, which is the honest shape: a `frame`, a `rect`, a `text` or a
 * nested `viewport` inside a 3D subtree is a node the document is allowed to
 * hold and that this renderer has nothing to say about. `pivot` is silent for a
 * different reason — it is a transform and the transform has already happened,
 * one group up. Both silences are one `return null`, and telling them apart is
 * what this comment is for.
 */
function Contents({
	node,
	size,
	looksThrough,
	pointer,
	asset,
	resolve,
}: {
	node: ModelNode;
	/** The node's box, already converted by {@link Placed}, so it crosses once. */
	size: readonly [number, number, number];
	looksThrough: string | undefined;
	pointer?: PointerHandlers;
	asset?: string;
	resolve?: AssetResolver;
}) {
	switch (node.kind) {
		case "mesh": {
			// An unknown word draws as a box rather than as nothing. `edits.ts` says
			// the same about a solid it does not recognise — "an unknown word is
			// kept rather than repaired" — and a `solid` can resolve through a token
			// to anything at all, so this is a document with a typo in it and not a
			// document that cannot be drawn. `VALUE_TYPES.solid`'s own fallback is
			// `box`, so falling back to it is following the table rather than
			// choosing.
			const kind = isSolidKind(node.rendered.solid) ? node.rendered.solid : "box";
			const material = materialOf(node.rendered);
			return (
				<Solid kind={kind} size={size} nodeId={node.id} meshProps={pointer}>
					<meshStandardMaterial
						color={material.colour}
						roughness={material.roughness}
						metalness={material.metalness}
						opacity={material.opacity}
						transparent={material.transparent}
					/>
				</Solid>
			);
		}
		case "model":
			return (
				<Model
					node={node}
					size={size}
					pointer={pointer}
					asset={asset}
					// Straight off the node, where `meshpart/3` was read into it, and
					// not out of a second map handed down beside `assets` — see
					// {@link SceneTreeProps.assets} for why the two halves of one
					// reference legitimately arrive by two routes.
					part={node.part}
					resolve={resolve}
				/>
			);
		case "light":
			return <Lights lamp={lampOf(node.rendered)} />;
		case "camera":
			return <Camera lens={lensOf(node.rendered)} primary={looksThrough === node.id} />;
		default:
			return null;
	}
}

/**
 * Whether this subtree holds the camera a viewport says it looks through.
 *
 * Asked by `ViewportCanvas` before it decides whether to mount a
 * {@link FramingCamera}, and asked of the *model* rather than of the document,
 * which is the point: `looks/2` is derived from `vcam/2`, `vcam/2` deliberately
 * does not consult `hidden/1`, and `readModel` deliberately does not keep a
 * hidden node. So "the document names a camera" and "there is a camera here to
 * render through" are two different questions and this is the second one.
 */
export function findsCamera(nodes: readonly ModelNode[], id: string | undefined): boolean {
	if (id === undefined) return false;
	return nodes.some(
		(node) =>
			(node.id === id && node.kind === "camera") || findsCamera(node.children, id),
	);
}

/**
 * The bounding box of everything drawable in a subtree, in renderer units.
 *
 * Used only for the framing fallback, so it is deliberately the cheap answer: it
 * unions each node's own box, transformed by position alone and not by rotation,
 * which is why it is stated as a **hint** rather than as bounds. A rotated cube
 * really does stick out of this by up to √3⁄2 of its size — but this number's
 * only job is to put a camera far enough back that a scene appears, and
 * `FramingCamera` already multiplies it by a margin for exactly that reason.
 *
 * Computing the exact rotated bounds would mean composing the matrix chain here,
 * which is `spatial.ts`'s job and would be a second copy of it. Asking three.js
 * for `new Box3().setFromObject(scene)` would be the right answer and is not
 * available: it needs the objects to exist, and the camera is decided one render
 * before they do.
 */
export function boundsHint(
	nodes: readonly ModelNode[],
	/**
	 * Only these nodes and what is inside them, for framing a selection.
	 *
	 * A node in the set contributes, **and so does its whole subtree**, which is
	 * the answer a designer expects: framing a `pivot` frames what is on it, not
	 * the empty point the pivot itself occupies. An empty set is not the same as
	 * `undefined` and answers with the empty view's unit sphere — "you asked to
	 * frame nothing" is a real question with a real answer, and it is the one that
	 * leaves the camera looking at the middle of the view.
	 */
	only?: ReadonlySet<string>,
): { centre: [number, number, number]; radius: number } {
	let min = [Infinity, Infinity, Infinity];
	let max = [-Infinity, -Infinity, -Infinity];
	const visit = (
		list: readonly ModelNode[],
		at: readonly [number, number, number],
		inside: boolean,
	) => {
		for (const node of list) {
			const { position, size } = worldBox(boxOf3(node));
			const centre: [number, number, number] = [
				at[0] + position[0],
				at[1] + position[1],
				at[2] + position[2],
			];
			const counts = inside || only === undefined || only.has(node.id);
			// A camera and a light have a default 100×100 frame that means nothing —
			// they are `drawable: false` — so they contribute their place and not
			// their size, or a scene with one light in it would frame the light.
			const half = node.kind === "camera" || node.kind === "light"
				? [0, 0, 0]
				: [size[0] / 2, size[1] / 2, size[2] / 2];
			if (counts) {
				min = min.map((v, i) => Math.min(v, centre[i] - half[i]));
				max = max.map((v, i) => Math.max(v, centre[i] + half[i]));
			}
			const offset = worldOriginOffset(size);
			visit(
				node.children,
				[centre[0] + offset[0], centre[1] + offset[1], centre[2] + offset[2]],
				counts,
			);
		}
	};
	visit(nodes, [0, 0, 0], false);
	if (!Number.isFinite(min[0])) {
		// An empty view. Something has to be framed, and a unit sphere at the
		// origin is the smallest honest answer: the camera ends up looking at the
		// middle of a view with nothing in it, which is what it should show.
		return { centre: [0, 0, 0], radius: 1 };
	}
	const centre: [number, number, number] = [
		(min[0] + max[0]) / 2,
		(min[1] + max[1]) / 2,
		(min[2] + max[2]) / 2,
	];
	const radius = Math.max(
		Math.hypot(max[0] - centre[0], max[1] - centre[1], max[2] - centre[2]),
		1,
	);
	return { centre, radius };
}
