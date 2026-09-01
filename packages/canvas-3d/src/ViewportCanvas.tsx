/**
 * The seam: a `viewport` node's 3D subtree, drawn.
 *
 * ## What it is handed, and what it deliberately is not
 *
 * It takes a `ModelNode` and a `ModelScene` — **one universe of the answer
 * set** — and nothing else. No `Scene`, no `ResolveContext`, no picks, no
 * tokens. Everything it draws was decided by the solver: the six lengths from
 * `frame/3`, the three angles from `turn/3`, every material and lens and lamp
 * from `rendered/3`, and which camera the view looks through from `looks/2`.
 * That is the same contract `Artboard.tsx` keeps for the flat renderer, and it
 * is the whole reason to keep it: a renderer that read the document would draw a
 * mesh where the document last stored it while the inspector beside it showed
 * where a geometric rule had actually put it.
 *
 * `docs/three-d-spec.md` §8.2 gives this component a third prop, `scene: Scene`,
 * "read only for a model's `MeshRef` and a mesh's own kind". **It is not here,
 * and that is a deliberate deviation** — see the note on {@link
 * ViewportCanvasProps}. The short version: a mesh's kind turned out to be in the
 * answer set after all (`rendered/3` carries `solid`), and a model's `MeshRef`
 * is unreachable for a different reason that no `Scene` prop would have fixed —
 * see `Model.tsx`.
 *
 * ## Where it is mounted
 *
 * Inside `Artboard.tsx`'s absolutely-positioned div for the viewport node, at
 * the same converted pixel frame, inside the same `transform` subtree as every
 * other node. Three things then work for nothing:
 *
 *   - **pan and zoom**, because the `<canvas>` is inside `InfiniteCanvas`'s
 *     transformed element and is scaled by the same CSS transform as every other
 *     pixel;
 *   - **culling**, because `useCulling` unmounts a whole artboard the camera
 *     cannot see and a viewport inside one unmounts with it — which is the
 *     behaviour that matters most, since unmounting is what releases the WebGL
 *     context;
 *   - **paint order**, because the div is in the same stack as the rectangles.
 *
 * The one thing that does not work for nothing is sharpness: a `<canvas>` under
 * a CSS `scale()` is resampled rather than redrawn. `InfiniteCanvas` already
 * writes `data-canvas-scale` on the transformed element, so {@link useCanvasScale}
 * reads it and feeds it into `dpr`. `InfiniteCanvas.tsx` is **not touched** by
 * any of this, which was a requirement rather than an outcome.
 *
 * ## The context budget
 *
 * Browsers cap live WebGL contexts around sixteen and drop the oldest past that.
 * `live` is granted from outside — `useViewportBudget` in the app, which is a
 * different step's file — and everything else draws a {@link ViewportStill}. A
 * still is not a placeholder for a missing feature; it is what twenty
 * simultaneous 3D views have to be.
 */
import {
	type AssetResolver,
	type ModelNode,
	type ModelScene,
	boxOf3,
} from "@clingo-design/design-core";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
	type Ref,
	type RefObject,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Object3D } from "three";

import { FramingCamera, ReviewCamera } from "./Cameras.tsx";
import { type GizmoSpec, SceneTree, boundsHint, findsCamera } from "./SceneTree.tsx";
import type { GizmoMode } from "./TransformGizmo.tsx";
import { ViewportStill } from "./ViewportStill.tsx";
import type { SpatialEdit } from "./edits3.ts";
import { defaultLens } from "./readings.ts";
import { worldFromEmu } from "./units3.ts";
import { type OrbitFocus, orbitPosition, useOrbit } from "./useOrbit.ts";

export interface ViewportCanvasProps {
	/** The viewport node, as the answer set describes it. */
	viewport: ModelNode;
	/**
	 * The whole model of this universe.
	 *
	 * Wanted for one field — `looks`, which says which camera the view looks
	 * through, and which is a fact about the *scene* rather than about the node
	 * because it is derived from `vcam/2`. Taking the whole `ModelScene` rather
	 * than the one string keeps this component's argument list the same shape as
	 * `Artboard`'s, and leaves room for `triangles` and the state copies when the
	 * budget row and the machine preview arrive.
	 */
	model: ModelScene;
	/**
	 * **Deviation from `docs/three-d-spec.md` §8.2, stated loudly.** That section
	 * gives this component a `scene: Scene` prop "read only for a model's
	 * `MeshRef` and a mesh's own kind". There is no such prop here, on the
	 * instruction that this package reads the answer set and never the document,
	 * and it turned out to cost less than the spec expected:
	 *
	 *   - **a mesh's own kind is in the answer set.** `solid` is a property, so it
	 *     is `rendered(N,solid,"sphere")` like every other, with its token already
	 *     followed and its alternative already picked. Reading it from the
	 *     document would have been *wrong* rather than merely redundant: a `solid`
	 *     token holding `[box, sphere]` is a design with two universes in it, and
	 *     the document cannot say which one this is.
	 *   - **a model's `MeshRef` is in the answer set too, and now entirely.** It
	 *     was not when this paragraph was written: the ref was a content hash,
	 *     nothing in the tree could turn one into bytes, and `Model.tsx` drew a
	 *     bounding box and said so. Both halves are atoms now — `asset/2` carries
	 *     the file's path and `meshpart/3` carries which part of it — and a
	 *     {@link resolve} function turns the path into bytes without this package
	 *     learning where they are kept. A `Scene` prop would have got the same two
	 *     facts a solve later and would have got them from the wrong place: a rule
	 *     that mints a model states its own `asset/2`, and the document has no
	 *     record of that node at all.
	 *
	 * If a later step finds a real need for the document, it belongs behind a
	 * narrower prop than the whole `Scene` — the thing actually wanted — because a
	 * `Scene` in this file's signature is an invitation to resolve something.
	 */
	scene?: never;
	/** The editor's selection, so a selected object gets an outline. */
	selection?: ReadonlySet<string>;
	/**
	 * A click in the scene, reporting the node id the raycaster landed on — the
	 * *same id* the layer list uses, which for an instance's part is
	 * `inst(I,label)`. Null where the ray hit nothing.
	 *
	 * Absent means the canvas takes no pointer events at all, which is the default
	 * and which is what keeps the 2D editor's gestures working over a 3D view.
	 */
	onPickNode?: (id: string | null, event: PointerEvent) => void;
	/**
	 * What the pointer is over, reported as it changes — the same ids again, and
	 * `null` when the pointer leaves everything.
	 *
	 * Optional, and **the view highlights the hovered object whether or not
	 * anybody is listening.** Hover is view-local, transient, and per-viewport;
	 * a studio showing eight universes has eight of them and none of them is a
	 * fact about the document, so the state lives here and this callback exists
	 * for the things that genuinely need it elsewhere — a status line naming what
	 * is under the pointer, a cursor that changes over a pickable object.
	 */
	onHoverNode?: (id: string | null) => void;
	/**
	 * Something to highlight from outside — a row hovered in the layer list, a
	 * member hovered in the Rules panel.
	 *
	 * Merged with what the raycaster is over rather than replacing it, because
	 * they mean the same thing and both are true at once. See
	 * {@link SceneTreeProps.hovered}.
	 */
	hovered?: ReadonlySet<string>;
	/**
	 * Offer a transform gizmo, in this mode, on the selected node.
	 *
	 * **On exactly one node**: it appears when {@link selection} holds a single id
	 * and {@link onEdit} is present, and not otherwise. Multi-select is left out
	 * deliberately rather than forgotten — a gizmo on several nodes has to decide
	 * where it stands, and the honest answers are "the bounding box of the
	 * selection", which `axisBounds` refuses to give for a turned node, or "the
	 * first one", which is a rule nobody can see. Moving several nodes at once is
	 * already an edit the inspector and the arrow keys make.
	 *
	 * Absent means no gizmo, which is the default and which is what a viewport the
	 * editor has not entered should show.
	 */
	gizmo?: GizmoMode;
	/**
	 * Where a drag ends up. See `edits3.ts` — the caller applies each edit it is
	 * handed, in order, and groups its undo history between `"start"` and `"end"`.
	 *
	 * Nothing in this package applies one. A renderer that wrote to the document
	 * would be a renderer with an opinion about it.
	 */
	onEdit?: (edit: SpatialEdit) => void;
	/** Orbit the camera. Editor state, never the document — see `useOrbit.ts`. */
	orbit?: boolean;
	/**
	 * Draw for real. False renders {@link ViewportStill} instead: a WebGL context
	 * per universe over twenty universes is past what a browser will give.
	 */
	live?: boolean;
	/**
	 * The canvas's CSS scale, so the drawing buffer matches the pixels on screen
	 * under the infinite canvas's zoom.
	 *
	 * Absent means "read it off `data-canvas-scale`", which is what
	 * `InfiniteCanvas` already writes and what a caller inside one should let
	 * happen. Stated overrides, for a caller that is not inside one — a preview
	 * pane, or a test.
	 */
	scale?: number;
	/** The last frame, as a data URL, when this view is not live. */
	poster?: string;
	/** Hands back a fresh poster. Costs a preserved drawing buffer — see below. */
	onPoster?: (dataUrl: string) => void;
	/**
	 * Where a model's bytes come from — one path in the project's tree in, the
	 * file at it out. See design-core's `assets.ts`.
	 *
	 * A function and not a store object, and the narrowing is the point: a
	 * renderer that could write could change the document, and one that could
	 * enumerate could decide what to draw by asking the tree rather than the
	 * answer set. There is no store interface left to hand over anyway — the five
	 * methods this used to be one of are gone with the content-addressed payloads.
	 *
	 * Absent draws every model as its stand-in box, which is what a host with no
	 * tree to read — a test, a poster render — should get.
	 */
	resolve?: AssetResolver;
	/** The camera commands — see {@link ViewportHandle}. */
	ref?: Ref<ViewportHandle>;
}

/**
 * The editor's own camera, as three commands.
 *
 * **This is the camera a designer looks through while working, and it is never a
 * camera the document holds.** The distinction is the whole of `useOrbit.ts`'s
 * header and it is worth repeating at the API: a `camera` node has a `frame`, a
 * `turn`, a lens a rule can constrain and a state can animate, and it is saved in
 * the file. Where somebody happened to be standing when they last looked at the
 * scene is a preference, it belongs to the session and not to the design, and
 * putting it in the document would mean two people opening one file disagreeing
 * about what it looks like. So framing and orbiting move a *review* camera that
 * this package mounts, and letting go of it — {@link ViewportHandle.release} —
 * hands the view straight back to the solver's answer with nothing written
 * anywhere.
 *
 * An imperative handle rather than a prop, because these are events and not
 * state. "Frame the selection" pressed twice means frame it twice, and there is
 * no value a declarative prop could hold that says that without the caller also
 * having to unset it.
 */
export interface ViewportHandle {
	/**
	 * Put the review camera where the selection fills the frame, keeping whatever
	 * direction the view is already looking from.
	 *
	 * With nothing selected this frames the whole view, which is what the key
	 * does in every tool that has one — "frame nothing" is not a useful gesture
	 * and "frame everything" is the thing somebody with an empty selection wanted.
	 */
	frameSelection(): void;
	/** The same, on everything the view draws. */
	frameAll(): void;
	/** Give the view back to the document's own camera. */
	release(): void;
}

export function ViewportCanvas({
	viewport,
	model,
	selection,
	onPickNode,
	onHoverNode,
	hovered,
	gizmo,
	onEdit,
	orbit = false,
	live = true,
	scale,
	poster,
	onPoster,
	resolve,
	ref,
}: ViewportCanvasProps) {
	const host = useRef<HTMLDivElement>(null);
	const measured = useCanvasScale(host, scale);

	const nodes = viewport.children;
	const looksThrough = model.looks[viewport.id];

	// The framing lives out here, above the `<Canvas>`, because the handle is out
	// here too — `useImperativeHandle` cannot reach state that only exists inside
	// R3F's tree, and `boundsHint` is a pure walk of the model that needs nothing
	// from the renderer to answer.
	const [focus, setFocus] = useState<OrbitFocus | undefined>(undefined);
	useImperativeHandle(
		ref,
		() => ({
			frameSelection: () =>
				setFocus(boundsHint(nodes, selection && selection.size > 0 ? selection : undefined)),
			frameAll: () => setFocus(boundsHint(nodes)),
			release: () => setFocus(undefined),
		}),
		[nodes, selection],
	);

	if (!live) {
		return (
			<div ref={host} style={FILL}>
				<ViewportStill
					rendered={viewport.rendered}
					poster={poster}
					label={stillLabel(viewport)}
				/>
			</div>
		);
	}

	return (
		<div
			ref={host}
			style={{
				...FILL,
				// The default. The editor turns it on for the one viewport it has
				// entered, which is `docs/three-d-spec.md` §9.3's gesture and a
				// different step's code; without that, a 3D view is a picture the 2D
				// pointer passes straight through, exactly like the rectangle it is
				// drawn inside.
				pointerEvents: onPickNode || onHoverNode || gizmo || orbit ? "auto" : "none",
			}}
		>
			<Canvas
				// Transparent, so the viewport's own `fill`, `radius` and `stroke` —
				// which `Artboard` has already drawn on the div behind this, because a
				// viewport is a rectangle like any other — show through wherever the
				// scene does not cover them. Painting the fill again here would be two
				// answers to one property, and the one on the div is the one the
				// exporter also uses.
				gl={{ alpha: true, antialias: true, preserveDrawingBuffer: Boolean(onPoster) }}
				dpr={dprFor(measured)}
				// Nothing here animates on its own: a scene is redrawn when the answer
				// set changes, which is a re-render. `demand` means the studio's
				// pointermove re-renders do not become a render loop, and it is why
				// `useOrbit` calls `invalidate()` by hand.
				frameloop="demand"
				// R3F's own default camera, which exists before ours mounts and which
				// `useDefaultCamera` restores on unmount. Given the document's own
				// fallback lens so the first frame is never drawn through a lens
				// nothing in the system asked for.
				camera={{ fov: defaultLens().fov, near: defaultLens().near, far: defaultLens().far }}
				onPointerMissed={(event) => {
					// A click that hit nothing. Reported rather than swallowed, because
					// "you clicked the empty part of the scene" is a real answer and the
					// editor's answer to it is to clear the selection.
					onPickNode?.(null, event as unknown as PointerEvent);
				}}
				style={{ width: "100%", height: "100%", display: "block" }}
			>
				<Contents
					nodes={nodes}
					looksThrough={looksThrough}
					selection={selection}
					hovered={hovered}
					onPickNode={onPickNode}
					onHoverNode={onHoverNode}
					gizmo={gizmo}
					onEdit={onEdit}
					orbit={orbit}
					focus={focus}
					onPoster={onPoster}
					assets={model.assets}
					resolve={resolve}
				/>
			</Canvas>
		</div>
	);
}

/**
 * Everything inside the `<Canvas>`, which is a separate component because
 * `useThree` and `useFrame` only exist below it.
 *
 * The camera decision is here rather than in `SceneTree` because it is a
 * decision about the *view* and not about any node: mount the framing camera
 * exactly when nothing else will be default. Three ways that happens — the view
 * names no camera, it names one that is not a camera, or it names one the answer
 * set placed and `readModel` dropped because it is hidden. `findsCamera` answers
 * all three with one question, asked of the model rather than of the document,
 * which is the distinction `Cameras.tsx` is written around.
 */
function Contents({
	nodes,
	looksThrough,
	selection,
	hovered,
	onPickNode,
	onHoverNode,
	gizmo,
	onEdit,
	orbit,
	focus,
	onPoster,
	assets,
	resolve,
}: {
	nodes: readonly ModelNode[];
	looksThrough: string | undefined;
	selection?: ReadonlySet<string>;
	hovered?: ReadonlySet<string>;
	onPickNode?: (id: string | null, event: PointerEvent) => void;
	onHoverNode?: (id: string | null) => void;
	gizmo?: GizmoMode;
	onEdit?: (edit: SpatialEdit) => void;
	orbit: boolean;
	focus?: OrbitFocus;
	onPoster?: (dataUrl: string) => void;
	assets?: Readonly<Record<string, string>>;
	resolve?: AssetResolver;
}) {
	const bounds = boundsHint(nodes);
	// Whether a gizmo handle owns the pointer. Shared with `useOrbit`, which is
	// the only other thing in this canvas that takes a primary-button drag; see
	// `TransformGizmo`'s `seize` for why the arbitration is two mechanisms.
	const grabbed = useRef(false);
	const { pose, abort } = useOrbit({
		enabled: orbit,
		target: bounds.centre,
		radius: bounds.radius,
		focus,
		fov: defaultLens().fov,
		blocked: grabbed,
	});
	const framed = !findsCamera(nodes, looksThrough);

	// What the raycaster is over, held here rather than by the caller: hover is
	// view-local and transient, a studio showing eight universes has eight of
	// them, and none is a fact about the document. `onHoverNode` reports it for
	// the things outside that want to know.
	const [under, setUnder] = useState<string | null>(null);
	const marks = useMemo(() => {
		if (!under) return hovered;
		const set = new Set(hovered ?? []);
		set.add(under);
		return set;
	}, [hovered, under]);

	const onPick = useCallback(
		(event: ThreeEvent<PointerEvent>) => {
			if (!onPickNode) return;
			// Only the frontmost object answers. R3F hands every intersected object
			// the event in depth order, so without this a click through three
			// stacked meshes would report three picks and the last one — the one
			// furthest away — would win.
			event.stopPropagation();
			onPickNode(idUnder(event.object), event.nativeEvent);
		},
		[onPickNode],
	);

	const onOver = useCallback(
		(event: ThreeEvent<PointerEvent>) => {
			// Stopped for `onPick`'s reason and one more: R3F sends `pointerover` to
			// every object along the ray, so a mesh behind another would light up
			// through it. The frontmost is the one a click would take, and the
			// highlight has to promise exactly that.
			event.stopPropagation();
			const id = idUnder(event.object);
			setUnder(id);
			onHoverNode?.(id);
		},
		[onHoverNode],
	);

	const onOut = useCallback(
		(event: ThreeEvent<PointerEvent>) => {
			const id = idUnder(event.object);
			// Only the object that is actually being left clears the mark. Without
			// this, moving from a near mesh to a far one behind it would deliver the
			// far one's `pointerover` first and the near one's `pointerout` second,
			// and the highlight would blink off the thing the pointer is now on.
			setUnder((was) => (was === id ? null : was));
			if (onHoverNode) onHoverNode(null);
		},
		[onHoverNode],
	);

	const pointer = onPickNode || onHoverNode || gizmo
		? { onPointerDown: onPick, onPointerOver: onOver, onPointerOut: onOut }
		: undefined;

	// One node, or none — see `ViewportCanvasProps.gizmo` on why not several.
	const only = selection && selection.size === 1 ? [...selection][0] : undefined;
	const handles: GizmoSpec | undefined =
		gizmo && onEdit && only !== undefined
			? { id: only, mode: gizmo, onEdit, grabbed, onSeize: abort }
			: undefined;

	return (
		<>
			{/*
			  * A little light, only when the document has none.
			  *
			  * A scene with no `light` node in it renders black under a
			  * `meshStandardMaterial`, which looks exactly like a broken renderer and
			  * is the first thing anybody will see after adding a mesh. So an
			  * unlit view gets a dim ambient and a key from over the viewer's
			  * shoulder — and the moment the document states a lamp of its own, this
			  * goes, so a designer's first light is the only light and the picture is
			  * the document's.
			  */}
			{hasLight(nodes) ? null : (
				<>
					<ambientLight intensity={0.6} />
					<directionalLight position={[1, 2, 3]} intensity={1.6} />
				</>
			)}

			{/*
			  * While orbiting, the tree is told the view looks through *nothing*, so
			  * the document's own camera mounts as an ordinary node and never asks to
			  * be the default. Stated here rather than left to effect order: two
			  * components both calling `set({ camera })` would resolve by whichever
			  * effect happened to run last, which works today and is exactly the kind
			  * of thing that silently reverses when a component moves.
			  */}
			<SceneTree
				nodes={nodes}
				looksThrough={pose ? undefined : looksThrough}
				selection={selection}
				hovered={marks}
				pointer={pointer}
				gizmo={handles}
				assets={assets}
				resolve={resolve}
			/>

			{/*
			  * The review camera wins over both the document's and the framing one
			  * while orbiting, and vanishes when it stops — which is what makes
			  * looking around leave no trace in the document. When it goes,
			  * `useDefaultCamera`'s restore hands the view back to whichever camera
			  * was default when it arrived, which is the document's.
			  */}
			{pose ? (
				<ReviewCamera
					lens={defaultLens()}
					position={orbitPosition(pose)}
					target={pose.target}
				/>
			) : framed ? (
				<FramingCamera lens={defaultLens()} centre={bounds.centre} radius={bounds.radius} />
			) : null}

			{onPoster ? <Poster onPoster={onPoster} /> : null}
		</>
	);
}

/**
 * Hand the last drawn frame back as a data URL, once, after the first render.
 *
 * `useFrame` with a priority above zero would take over the render loop, so this
 * runs at the default priority and reads the buffer *after* R3F has drawn into
 * it. That is why `preserveDrawingBuffer` is on whenever `onPoster` is: without
 * it the browser is free to clear the buffer the instant the frame is composited
 * and `toDataURL` comes back blank — which is the classic version of this bug,
 * and the reason the flag is paid for only by the views that asked for a poster.
 *
 * Once, not every frame: a poster is what a view looked like, and re-encoding a
 * PNG sixty times a second to keep it fresh would cost more than the rendering.
 */
function Poster({ onPoster }: { onPoster: (dataUrl: string) => void }) {
	const gl = useThree((state) => state.gl);
	const taken = useRef(false);
	useFrame(() => {
		if (taken.current) return;
		taken.current = true;
		try {
			onPoster(gl.domElement.toDataURL("image/png"));
		} catch {
			// A tainted or lost context. A missing poster is a still with a label on
			// it, which is a perfectly good outcome; throwing here would take the
			// whole studio down for a thumbnail.
		}
	});
	return null;
}

/**
 * The node id a raycast landed on, found by walking up from the object that was
 * hit.
 *
 * Up rather than at, because a hit lands on a `Mesh` and the id is on whichever
 * ancestor `SceneTree` put it on — the mesh itself for a solid, the wrapping
 * group for a model. Every object this package mounts that stands for a node
 * carries `userData.nodeId`, and nothing else does, so the first one found going
 * up is the answer. `null` if the ray somehow hit something this package did not
 * mount.
 */
function idUnder(object: Object3D | null): string | null {
	for (let at = object; at; at = at.parent) {
		const id: unknown = at.userData.nodeId;
		if (typeof id === "string") return id;
	}
	return null;
}

/** True when the document lights this view itself — see the fallback above. */
function hasLight(nodes: readonly ModelNode[]): boolean {
	return nodes.some((node) => node.kind === "light" || hasLight(node.children));
}

/**
 * What a still says when it has no poster: "3D view · 24 objects".
 *
 * The count is of things that draw — meshes and models — rather than of nodes,
 * because "3D view · 31 objects" for a scene with six lights and a camera in it
 * would be counting the wrong thing. `triangles` is read where the model knows
 * it, which for now is imported models only, so the sentence stays honest about
 * what it can total rather than inventing a number for the primitives.
 */
function stillLabel(viewport: ModelNode): string {
	let objects = 0;
	const visit = (nodes: readonly ModelNode[]) => {
		for (const node of nodes) {
			if (node.kind === "mesh" || node.kind === "model") objects += 1;
			visit(node.children);
		}
	};
	visit(viewport.children);
	// `KINDS.viewport.label` is "3D view", and it is spelled out rather than
	// imported because importing the table for one string would put the
	// document's vocabulary in a file that is otherwise only about pixels.
	return `3D view · ${objects} object${objects === 1 ? "" : "s"}`;
}

/**
 * The CSS scale this canvas is being drawn at, so the drawing buffer can match.
 *
 * Read off `data-canvas-scale`, which `InfiniteCanvas` already writes on its
 * transformed element and which is therefore the number that is true rather than
 * a second copy of the camera. Watched with a `MutationObserver` because the
 * attribute changes on every zoom and a zoom is not a React render of this
 * component.
 *
 * A stated `scale` prop skips all of it, and a canvas mounted outside an
 * `InfiniteCanvas` finds no attribute and gets 1 — which is the right answer for
 * a preview pane that is not being zoomed.
 */
function useCanvasScale(
	host: RefObject<HTMLElement | null>,
	stated: number | undefined,
): number {
	const [measured, setMeasured] = useState(1);
	useEffect(() => {
		if (stated !== undefined) return;
		const element = host.current?.closest("[data-canvas-scale]");
		if (!(element instanceof HTMLElement)) return;
		const read = () => {
			const value = Number(element.dataset.canvasScale);
			setMeasured(Number.isFinite(value) && value > 0 ? value : 1);
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(element, { attributes: true, attributeFilter: ["data-canvas-scale"] });
		return () => observer.disconnect();
	}, [host, stated]);
	return stated ?? measured;
}

/**
 * The drawing buffer's pixel ratio, clamped.
 *
 * Clamped at 3 because a 6× zoom on a 2× display would ask for a buffer
 * thirty-six times the pixels for a view nobody is looking closely at, and
 * because a `<canvas>` past the browser's maximum texture size silently stops
 * drawing altogether.
 */
function dprFor(scale: number): number {
	const device = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
	return Math.min(3, Math.max(1, device * scale));
}

/** Fills whatever box the artboard drew for the viewport node. */
const FILL = {
	position: "absolute",
	inset: 0,
	overflow: "hidden",
} as const;

/**
 * The viewport's frame in renderer units, for a caller that wants to know how
 * big the scene's window is without converting anything itself.
 *
 * Exported because the app's budget row and the status line both want it and
 * neither should reach for `EMU_PER_PX`.
 */
export function viewportSize(viewport: ModelNode): { width: number; height: number } {
	const box = boxOf3(viewport);
	return { width: worldFromEmu(box.width), height: worldFromEmu(box.height) };
}
