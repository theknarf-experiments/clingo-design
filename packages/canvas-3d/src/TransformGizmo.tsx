/**
 * The transform gizmo: three arrows and three rings, and the drag that turns
 * either of them into a document edit.
 *
 * `docs/three-d-spec.md` §9.4 names this as the one thing deliberately left out
 * of the first cut — "a gizmo is drei's `TransformControls` plus a mapping from
 * its output back into `withSpatial`/`withTurn` edits plus an undo-coalescing
 * story plus a decision about what it does to a node a rule already places" —
 * and records it as the first thing to build next. This is that. Each of the
 * four clauses is answered somewhere below or in `edits3.ts`, and the two that
 * turned out to be interesting are the last two.
 *
 * ## It is not `TransformControls`, and the reason is not the dependency
 *
 * drei's `TransformControls` mutates the `Object3D` it is attached to and hands
 * you the result. In a system where the picture is the solver's answer, an
 * object that has been moved by a controller is a picture that no longer agrees
 * with the document *or* with the answer set — it agrees with the mouse. The
 * next re-solve snaps it back, so the whole drag becomes a fight between the
 * controller's transform and the one `SceneTree` computes, and whoever renders
 * last wins.
 *
 * So nothing here touches a transform. A drag reads a ray, reads the handle's
 * world basis, works out how far along the axis or how far around the ring the
 * pointer has come, and emits a {@link SpatialEdit}. The object moves when — and
 * only when — the document says it has. If a rule holds the node still, it
 * stands still while the arrow follows the pointer, which is exactly the truth
 * of the situation and is the behaviour §9.4 worried about getting wrong.
 *
 * ## What it does to a node a rule already places
 *
 * It writes the delta into the document and lets the solver answer. That is not
 * a dodge: it is the same thing dragging a constrained rectangle on the 2D
 * canvas already does, through the same `moveNodes`, and the answer a designer
 * gets is the honest one — a node pinned by a rule does not move, a node the
 * rule leaves one degree of freedom moves along it. `edits3.ts` says the rest.
 *
 * ## Why the rotation handles are a gimbal and not a trackball
 *
 * **This is the one genuinely nice thing in this file.** The document stores
 * three Euler angles applied in a fixed order — `rotationMatrix` is `Rx · Ry ·
 * Rz`, argued for at length in `TURNS` — and a gizmo has to decide what one of
 * its rings *means* in terms of those three numbers.
 *
 * A trackball gizmo (three world-aligned rings) is the usual answer and it is
 * the wrong one here: a drag on its "x" ring composes a rotation onto the left
 * of the stored one, and the result generally cannot be written as any triple of
 * `rotateX`, `rotateY`, `rotateZ` without solving an inverse Euler problem —
 * which is transcendental, ambiguous at the poles, and would rewrite two numbers
 * a designer did not touch. The `22.5deg` they typed into `rotateY` would come
 * back as `22.499deg` because they nudged `rotateX`.
 *
 * The gimbal is exact instead. Because the product is `Rx · Ry · Rz`:
 *
 *   - `rotateX` is the **outermost** factor, so adding Δ to it is `Rx(Δ) · R` —
 *     a rotation about the parent's own x axis, and the ring is the plain
 *     unrotated one;
 *   - `rotateY` sits inside `Rx`, so its ring is the parent's y axis **carried
 *     by `Rx(a)`**;
 *   - `rotateZ` is the **innermost**, so its ring is the node's own local z axis
 *     — the parent's z carried by `Rx(a) · Ry(b)`.
 *
 * Each ring therefore turns exactly one stored number by exactly the angle
 * dragged, the other two are never written, and the orientation of each ring is
 * `worldEuler` of a *prefix* of the turn record — which is one existing function
 * called with three arguments, not a fourth implementation of the rotation
 * chain. It also has a property the drag depends on: **a ring's own basis is
 * invariant under its own drag**, because the angles in its prefix are precisely
 * the ones it does not change. So the frame of reference cannot drift under the
 * pointer mid-gesture.
 *
 * The cost is the cost every gimbal has: the rings are not orthogonal once
 * something is turned, and at `rotateY = ±90°` the x and z rings line up and one
 * degree of freedom is unreachable. That is gimbal lock, it is a property of
 * storing three Euler angles rather than of this gizmo, and a designer who meets
 * it can reach the pose with a `pivot` — which is what `KINDS.pivot` is for.
 *
 * ## Sizing, and the two sign flips
 *
 * The gizmo is scaled every frame so that one local unit is one CSS pixel on
 * screen ({@link pixelSize}), because a viewport in this studio can be a 40px
 * thumbnail or a 4000px hero and a handle measured in EMU would be a speck on
 * one and a wall on the other.
 *
 * The crossing into three.js is `renderPoint`'s and it is applied here exactly
 * once, as a table of three directions: the document's `x` is three's `+X`, its
 * `y` is three's `−Y`, its `z` is three's `−Z`. The same table serves the
 * rotations, and that is not a coincidence — `worldEuler` explains it: `F =
 * diag(1, −1, −1)` is a rotation, so a document rotation by Δ about an axis `a`
 * is a three.js rotation by **the same Δ** about `F · a`. Which means there is no
 * separate sign map for the rings; there is one direction table, used twice.
 */
import { type ModelNode, type Turn, parseInstancePart } from "@clingo-design/design-core";
import { type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	type Intersection,
	type Object3D,
	type Raycaster as ThreeRaycaster,
	Group,
	Mesh,
	Raycaster,
	Vector2,
	Vector3,
} from "three";

import type { EditPhase, SpatialEdit } from "./edits3.ts";
import {
	type Ray,
	type Vec3,
	angleDelta,
	angleInPlane,
	closestOnAxis,
	cross,
	intersectPlane,
	normalise,
	pixelSize,
	scale as scaled,
	snapTo,
} from "./gizmoMath.ts";
import { emuFromWorld, worldEuler } from "./units3.ts";

/** Which of the two gestures the handles offer. */
export type GizmoMode = "move" | "turn";

export interface TransformGizmoProps {
	/**
	 * The node the gizmo is attached to, as the answer set describes it.
	 *
	 * Read for exactly two things: its id, which every edit carries, and its
	 * `turn`, which orients the rings. Its *place* is not read at all — the gizmo
	 * is mounted inside the group `SceneTree` already put at the node's centre, so
	 * the transform chain is composed once, by the renderer, for the picture and
	 * for the handles alike.
	 */
	node: ModelNode;
	mode: GizmoMode;
	/**
	 * Each increment of a drag, as a delta since the previous one. See
	 * {@link SpatialEdit} — the caller applies every one it is handed and groups
	 * its undo history between `"start"` and `"end"`.
	 */
	onEdit: (edit: SpatialEdit) => void;
	/**
	 * The pointer arbiter, shared with `useOrbit`.
	 *
	 * A gizmo drag and an orbit drag are both a primary-button press on the same
	 * canvas, and the two must not both start. See {@link seize} for why this is a
	 * ref and a callback rather than one of them.
	 */
	grabbed?: RefObject<boolean>;
	/** Called at the moment a handle takes the pointer — `useOrbit`'s `abort`. */
	onSeize?: () => void;
	/** How far the arrows reach and how wide the rings are, in CSS pixels. */
	reach?: number;
}

/**
 * The gizmo, or nothing at all for a node it refuses to offer one on.
 *
 * The refusal is `inst(I,N)` — an instance's copy of a component's part.
 * `edits3.ts`'s header says why dragging one is a different edit from the one it
 * looks like, and `gizmoRefusal` is the sentence a panel shows. Here it is one
 * early return, made against the id alone: `parseInstancePart` is a string
 * parser and needs no document, which is what lets this component keep the rule
 * the rest of the package keeps.
 */
export function TransformGizmo({
	node,
	mode,
	onEdit,
	grabbed,
	onSeize,
	reach = 96,
}: TransformGizmoProps) {
	const root = useRef<Group>(null);
	// The latest callback, read by native listeners that are bound once per drag.
	// Without this, changing `onEdit` between two pointer moves — which happens on
	// every re-render of the studio — would rebind mid-gesture and drop the
	// pointer capture with it.
	const emit = useRef(onEdit);
	emit.current = onEdit;

	const drag = useRef<Drag | null>(null);
	const [dragging, setDragging] = useState<string | null>(null);
	const [hot, setHot] = useState<string | null>(null);

	useScreenScale(root);

	const gl = useThree((state) => state.gl);
	const get = useThree((state) => state.get);

	/**
	 * A handle takes the pointer.
	 *
	 * Two mechanisms rather than one, and it is worth saying why both are needed
	 * rather than trimming to the tidier-looking half. R3F connects its own
	 * pointer listeners to the `<div>` **around** the canvas, while `useOrbit`
	 * listens on the `<canvas>` itself — so in the bubble phase the orbit listener
	 * runs *first* and has already started an orbit by the time this handler is
	 * dispatched. A shared flag alone would therefore be set too late, and a call
	 * to `abort` alone would be too early if the two ever swapped order. So the
	 * flag stops a drag that has not begun and `onSeize` cancels one that has, and
	 * the gizmo wins whichever way round the listeners happen to be registered.
	 */
	const seize = useCallback(
		(event: ThreeEvent<PointerEvent>) => {
			event.stopPropagation();
			if (grabbed) grabbed.current = true;
			onSeize?.();
			const canvas = gl.domElement;
			if (canvas.hasPointerCapture(event.nativeEvent.pointerId)) {
				canvas.releasePointerCapture(event.nativeEvent.pointerId);
			}
			canvas.setPointerCapture(event.nativeEvent.pointerId);
		},
		[gl, grabbed, onSeize],
	);

	const rayAt = useCallback(
		(event: PointerEvent): Ray | undefined => rayFrom(event, gl.domElement, get().camera),
		[gl, get],
	);

	const begin = useCallback(
		(event: ThreeEvent<PointerEvent>, handle: Handle) => {
			if (event.nativeEvent.button !== 0) return;
			const group = root.current;
			if (!group) return;
			// The world matrices three.js holds are updated on its way into a render,
			// so the one standing here may be a frame old — and a frame old is a
			// wrong anchor for the whole gesture, not just for one frame. Refreshed
			// from the top of the chain, once, at the only moment it matters.
			group.updateWorldMatrix(true, true);
			const ray = rayAt(event.nativeEvent);
			if (!ray) return;
			const started = openDrag(handle, group, ray, event.nativeEvent.pointerId);
			if (!started) return;
			seize(event);
			drag.current = started;
			setDragging(handle.id);
			emit.current(zeroEdit(node.id, handle, "start"));
		},
		[node.id, rayAt, seize],
	);

	// The move and up listeners are native and on the canvas, for `useOrbit`'s
	// reason: the element that receives a drag is outside the R3F tree, and a
	// gesture that must keep tracking when the pointer leaves the object — which
	// is every gesture in a gizmo, since the pointer leaves the arrow immediately
	// — cannot be expressed as props on the arrow.
	//
	// Bound for the gizmo's whole life rather than for the drag's, and gated on
	// `drag.current` instead. Binding them when the drag opens would make the
	// gesture depend on React having committed the state change *between* the
	// pointerdown and the first pointermove — which it does today, because
	// automatic batching flushes in a microtask and a microtask runs before the
	// next input event, and which is far too subtle a thing for a drag to rest on.
	// Three idle listeners on one canvas cost nothing.
	useEffect(() => {
		const canvas = gl.domElement;

		const move = (event: PointerEvent) => {
			const at = drag.current;
			if (!at || at.pointerId !== event.pointerId) return;
			const ray = rayFrom(event, canvas, get().camera);
			if (!ray) return;
			const step = advance(at, ray, event.shiftKey);
			if (step === undefined) return;
			emit.current(stepEdit(node.id, at.handle, step));
		};

		const up = (event: PointerEvent) => {
			const at = drag.current;
			if (!at || at.pointerId !== event.pointerId) return;
			if (canvas.hasPointerCapture(event.pointerId)) {
				canvas.releasePointerCapture(event.pointerId);
			}
			drag.current = null;
			if (grabbed) grabbed.current = false;
			setDragging(null);
			emit.current(zeroEdit(node.id, at.handle, "end"));
		};

		canvas.addEventListener("pointermove", move);
		canvas.addEventListener("pointerup", up);
		canvas.addEventListener("pointercancel", up);
		return () => {
			canvas.removeEventListener("pointermove", move);
			canvas.removeEventListener("pointerup", up);
			canvas.removeEventListener("pointercancel", up);
			// Unmounting mid-drag — the artboard was culled, the selection changed,
			// the universe was re-pinned. The drag is ended rather than abandoned, so
			// a caller that opened a history group on `"start"` is never left holding
			// one open. `drag.current` is cleared first so the emit is the last word.
			const at = drag.current;
			drag.current = null;
			if (grabbed) grabbed.current = false;
			if (at) emit.current(zeroEdit(node.id, at.handle, "end"));
		};
	}, [gl, get, grabbed, node.id]);

	if (parseInstancePart(node.id) !== null) return null;

	const turn = node.turn;
	return (
		<group ref={root}>
			{mode === "move"
				? MOVE_AXES.map((axis) => (
						<Arrow
							key={axis.id}
							axis={axis}
							reach={reach}
							lit={hot === axis.id || dragging === axis.id}
							dimmed={dragging !== null && dragging !== axis.id}
							onDown={(event) => begin(event, axis)}
							onOver={() => setHot(axis.id)}
							onOut={() => setHot((was) => (was === axis.id ? null : was))}
						/>
					))
				: TURN_RINGS.map((ring) => (
						<Ring
							key={ring.id}
							ring={ring}
							turn={turn}
							reach={reach}
							lit={hot === ring.id || dragging === ring.id}
							dimmed={dragging !== null && dragging !== ring.id}
							onDown={(event) => begin(event, ring)}
							onOver={() => setHot(ring.id)}
							onOut={() => setHot((was) => (was === ring.id ? null : was))}
						/>
					))}
		</group>
	);
}

/* ------------------------------------------------------------------ */
/* The handles                                                         */
/* ------------------------------------------------------------------ */

/**
 * A translation handle: which of the six document dimensions it writes, and
 * where it points once the crossing has been applied.
 *
 * `column` and `sign` together are the direction in the gizmo group's own space
 * — `sign · e_column` — which is `renderPoint`'s flip written as data. Reading
 * the direction out of the group's world matrix rather than composing it here is
 * what keeps this file free of a second copy of the transform chain: whatever
 * `SceneTree` mounted, the arrow points along, including through every rotated
 * pivot above it.
 *
 * `rotation` is only the geometry's: three.js builds a cylinder and a cone
 * standing along `+Y`, so each arrow is turned to lie along its own axis. It has
 * nothing to do with the arithmetic and is never read by it.
 */
interface MoveAxis {
	id: string;
	kind: "move";
	axis: "x" | "y" | "z";
	column: 0 | 1 | 2;
	sign: 1 | -1;
	rotation: [number, number, number];
	colour: string;
}

/**
 * A rotation handle: which stored angle it writes, which prefix of the turn
 * record orients it, and which two columns of that orientation are the plane's
 * basis.
 *
 * `u` and `v` are column indices, chosen so that `column[u] × column[v]` is the
 * crossed document axis this ring turns about — which is what
 * {@link angleInPlane}'s contract asks for and what makes the measured angle the
 * document's own delta with no sign applied afterwards. The three choices are
 * `e_y × e_z = +e_x`, `e_x × e_z = −e_y` and `e_y × e_x = −e_z`, matching the
 * direction table above entry for entry.
 */
interface TurnRing {
	id: string;
	kind: "turn";
	turn: Turn;
	/** The angles applied *outside* this one — see the gimbal note in the header. */
	prefix: readonly Turn[];
	u: 0 | 1 | 2;
	v: 0 | 1 | 2;
	/** The torus's own tilt, so its normal is the axis. Never read by the maths. */
	rotation: [number, number, number];
	colour: string;
}

type Handle = MoveAxis | TurnRing;

/**
 * The three axis colours, and the one a handle takes while it is under the
 * pointer or being dragged.
 *
 * Red-green-blue for x-y-z is the convention every 3D tool shares and there is
 * nothing to gain by being original about it; a designer's hand already knows
 * which arrow is which. Note that the **green** one points *down* the screen,
 * because the document's y does, and that is the right surprise to leave in
 * place — it is the same y the inspector shows and the same y a rule names.
 *
 * Stated as constants for `Selection.tsx`'s reason: a gizmo is editor state, it
 * is not in the document, and there is nothing in a `ModelScene` to read a
 * colour from. A `--dc-*` custom property is not reachable from a WebGL draw
 * either.
 */
const AXIS_INK = { x: "#ef4444", y: "#22c55e", z: "#3b82f6" } as const;
const HOT_INK = "#fbbf24";

const MOVE_AXES: readonly MoveAxis[] = [
	{ id: "move:x", kind: "move", axis: "x", column: 0, sign: 1, rotation: [0, 0, -Math.PI / 2], colour: AXIS_INK.x },
	{ id: "move:y", kind: "move", axis: "y", column: 1, sign: -1, rotation: [Math.PI, 0, 0], colour: AXIS_INK.y },
	{ id: "move:z", kind: "move", axis: "z", column: 2, sign: -1, rotation: [-Math.PI / 2, 0, 0], colour: AXIS_INK.z },
];

const TURN_RINGS: readonly TurnRing[] = [
	{ id: "turn:rotateX", kind: "turn", turn: "rotateX", prefix: [], u: 1, v: 2, rotation: [0, Math.PI / 2, 0], colour: AXIS_INK.x },
	{ id: "turn:rotateY", kind: "turn", turn: "rotateY", prefix: ["rotateX"], u: 0, v: 2, rotation: [Math.PI / 2, 0, 0], colour: AXIS_INK.y },
	{ id: "turn:rotateZ", kind: "turn", turn: "rotateZ", prefix: ["rotateX", "rotateY"], u: 1, v: 0, rotation: [0, 0, 0], colour: AXIS_INK.z },
];

interface HandleProps {
	reach: number;
	lit: boolean;
	/** True while another handle is being dragged: this one steps out of the way. */
	dimmed: boolean;
	onDown: (event: ThreeEvent<PointerEvent>) => void;
	onOver: () => void;
	onOut: () => void;
}

/**
 * One translate arrow: a shaft, a head, and a fat invisible sleeve to grab.
 *
 * The sleeve is the whole reason a gizmo is usable. A 1.2px shaft is a target
 * nobody can hit with a mouse and certainly not with a trackpad, so the thing
 * that answers the raycast is an 8px-radius cylinder covering the arrow's whole
 * length, drawn with `colorWrite` off so it is a hit region and not a shape.
 * Invisible-by-`visible={false}` would have been simpler and does not work: the
 * raycaster and R3F's event layer both skip an invisible object, which is the
 * point of the flag.
 */
function Arrow({ axis, reach, lit, dimmed, onDown, onOver, onOut }: HandleProps & { axis: MoveAxis }) {
	const shaft = Math.max(reach - HEAD_LENGTH, 1);
	return (
		<group rotation={axis.rotation}>
			<mesh position={[0, shaft / 2, 0]} renderOrder={ON_TOP} raycast={noRaycast}>
				<cylinderGeometry args={[SHAFT_RADIUS, SHAFT_RADIUS, shaft, 8]} />
				<meshBasicMaterial color={lit ? HOT_INK : axis.colour} depthTest={false} transparent opacity={dimmed ? 0.25 : 1} />
			</mesh>
			<mesh position={[0, shaft + HEAD_LENGTH / 2, 0]} renderOrder={ON_TOP} raycast={noRaycast}>
				<coneGeometry args={[HEAD_RADIUS, HEAD_LENGTH, 12]} />
				<meshBasicMaterial color={lit ? HOT_INK : axis.colour} depthTest={false} transparent opacity={dimmed ? 0.25 : 1} />
			</mesh>
			<mesh
				position={[0, reach / 2, 0]}
				raycast={frontRaycast}
				onPointerDown={onDown}
				onPointerOver={onOver}
				onPointerOut={onOut}
			>
				<cylinderGeometry args={[GRAB_RADIUS, GRAB_RADIUS, reach, 8]} />
				<meshBasicMaterial colorWrite={false} depthWrite={false} />
			</mesh>
		</group>
	);
}

/**
 * One rotate ring, mounted inside the prefix of the turn record that orients it.
 *
 * The outer group is `worldEuler` of that prefix and **is the group the drag
 * reads its basis from**; the inner tilt is the torus's own, so that a ring lies
 * in the plane perpendicular to its axis. Keeping the two apart is what lets
 * {@link TurnRing.u} and `v` be plain column indices of a matrix the renderer
 * already computed.
 */
function Ring({
	ring,
	turn,
	reach,
	lit,
	dimmed,
	onDown,
	onOver,
	onOut,
}: HandleProps & { ring: TurnRing; turn: ModelNode["turn"] }) {
	const radius = reach * 0.75;
	return (
		<group rotation={worldEuler(prefixOf(turn, ring.prefix))} userData={{ gizmoRing: ring.id }}>
			<group rotation={ring.rotation}>
				<mesh renderOrder={ON_TOP} raycast={noRaycast}>
					<torusGeometry args={[radius, SHAFT_RADIUS, 6, 64]} />
					<meshBasicMaterial color={lit ? HOT_INK : ring.colour} depthTest={false} transparent opacity={dimmed ? 0.25 : 1} />
				</mesh>
				<mesh raycast={frontRaycast} onPointerDown={onDown} onPointerOver={onOver} onPointerOut={onOut}>
					<torusGeometry args={[radius, GRAB_RADIUS, 6, 48]} />
					<meshBasicMaterial colorWrite={false} depthWrite={false} />
				</mesh>
			</group>
		</group>
	);
}

/** The turn record cut down to the angles applied outside a given ring. */
function prefixOf(
	turn: ModelNode["turn"],
	keys: readonly Turn[],
): Partial<Record<Turn, number>> {
	const out: Partial<Record<Turn, number>> = {};
	for (const key of keys) out[key] = turn?.[key] ?? 0;
	return out;
}

const SHAFT_RADIUS = 1.2;
const HEAD_RADIUS = 5;
const HEAD_LENGTH = 16;
/** The grab sleeve's radius in CSS pixels — a comfortable pointer target. */
const GRAB_RADIUS = 8;
/** After the scene and after `Selection`, so the depth-test-free pass is last. */
const ON_TOP = 1000;

/** Drawn only. A hit on a shaft would report the shaft rather than the sleeve. */
const noRaycast = () => undefined;

/**
 * A raycast whose hits sort in front of every object in the scene, while still
 * sorting correctly against each other.
 *
 * A gizmo is drawn with `depthTest` off, so its handles are visible through the
 * object they are attached to — and they have to be, because the gizmo is
 * centred on the node and the inner half of every arrow is *inside* it. Picking
 * has to agree with drawing or the half of each handle a designer can see is a
 * half they cannot click, which reads as a broken tool.
 *
 * R3F dispatches intersections in distance order and the frontmost handler stops
 * propagation, so "in front of everything" is expressible as a distance. Scaling
 * by a millionth rather than setting zero is what keeps the handles ordered
 * among *themselves*: a ring nearer the eye than another still wins, which is
 * what makes two overlapping rings pickable at all.
 *
 * The alternative — a second raycaster and a second event layer for the gizmo —
 * is what a bigger library does and is a great deal more machinery for the same
 * two properties.
 */
function frontRaycast(this: Object3D, raycaster: ThreeRaycaster, intersects: Intersection[]) {
	const before = intersects.length;
	Mesh.prototype.raycast.call(this as Mesh, raycaster, intersects);
	for (let i = before; i < intersects.length; i++) {
		intersects[i].distance *= IN_FRONT;
	}
}

const IN_FRONT = 1e-6;

/* ------------------------------------------------------------------ */
/* The drag                                                            */
/* ------------------------------------------------------------------ */

/**
 * A gesture in progress, in **world space, frozen at the moment it began**.
 *
 * Frozen is the important word. The document is re-solved while the pointer
 * moves, so `node` changes under this component several times a second — and an
 * axis whose origin was re-read each frame would chase the object it is moving,
 * which is a positive feedback loop with a very obvious signature: the mesh
 * accelerates away from the pointer. Anchoring on the pose the drag started from
 * and reporting *increments* against the total makes the loop closed and exact:
 * however the document answers, the next increment is measured from the same
 * place the first one was.
 *
 * `emitted` is what has already been reported, in document units, so the
 * increment handed to the caller is always `total − emitted` and applying every
 * one in order lands on `total`.
 */
type Drag =
	| {
			kind: "move";
			handle: MoveAxis;
			pointerId: number;
			origin: Vec3;
			direction: Vec3;
			/** The axis parameter under the pointer when the drag began. */
			from: number;
			/** EMU already reported. */
			emitted: number;
	  }
	| {
			kind: "turn";
			handle: TurnRing;
			pointerId: number;
			centre: Vec3;
			u: Vec3;
			v: Vec3;
			normal: Vec3;
			/** The last absolute angle read, in radians — see {@link angleDelta}. */
			last: number;
			/** Radians accumulated, unwrapped, since the drag began. */
			turned: number;
			/** Thousandths of a degree already reported. */
			emitted: number;
	  };

/**
 * A drag, opened against the handle's world basis — or `undefined` when the
 * handle cannot be read from where the camera is standing.
 *
 * The refusal is {@link closestOnAxis}'s and {@link intersectPlane}'s and it is
 * inherited on purpose: an arrow pointing at the eye and a ring seen exactly
 * edge-on have no answer, and beginning a drag that can never produce a number
 * would be a handle that swallows the pointer and does nothing.
 */
function openDrag(
	handle: Handle,
	root: Group,
	ray: Ray,
	pointerId: number,
): Drag | undefined {
	const origin = positionOf(root);
	if (handle.kind === "move") {
		const direction = basisColumn(root, handle.column, handle.sign);
		if (!direction) return undefined;
		const from = closestOnAxis(ray, origin, direction);
		if (from === undefined) return undefined;
		return { kind: "move", handle, pointerId, origin, direction, from, emitted: 0 };
	}
	// The ring's own group, one level in — the `worldEuler(prefix)` one, which is
	// what carries `rotateY`'s ring inside `Rx(a)` and `rotateZ`'s inside
	// `Rx(a)·Ry(b)`. Found by its marker rather than by index, so re-ordering the
	// three rings in the table above cannot silently swap two planes.
	const group = ringGroup(root, handle.id);
	if (!group) return undefined;
	const u = basisColumn(group, handle.u, 1);
	const v = basisColumn(group, handle.v, 1);
	if (!u || !v) return undefined;
	const normal = normalise(cross(u, v));
	if (!normal) return undefined;
	const centre = positionOf(group);
	const hit = intersectPlane(ray, centre, normal);
	if (!hit) return undefined;
	return {
		kind: "turn",
		handle,
		pointerId,
		centre,
		u,
		v,
		normal,
		last: angleInPlane(hit, centre, u, v),
		turned: 0,
		emitted: 0,
	};
}

/**
 * One pointer move: how much further the document should go, in its own units.
 *
 * `undefined` for a frame with no reading — a ray that has gone parallel to the
 * axis, a plane the pointer has crossed behind — and for a frame that produced
 * no change at all, which is most of them once the movement is quantized. A
 * gizmo that emitted a zero edit on every pointer move would put sixty no-op
 * entries a second into whatever the caller is doing with them.
 *
 * **Quantized here rather than by the writer**, and once. A translation becomes
 * an integer count of EMU through `emuFromWorld`, which is the same
 * `emuFromCssPx` the 2D canvas quantizes a pointer delta with, so a mesh dragged
 * in a viewport and a rectangle dragged on an artboard land on the same lattice.
 * A rotation becomes an integer count of thousandths of a degree, which is what
 * `turn/3` carries and finer than any screen resolves.
 *
 * Shift snaps: eight pixels, or fifteen degrees. Applied to the **total** rather
 * than to each increment, so holding Shift halfway through a drag snaps to the
 * lattice rather than to wherever the unsnapped part had got to, and letting go
 * of it returns to exactly where the pointer is.
 */
function advance(at: Drag, ray: Ray, snap: boolean): number | undefined {
	if (at.kind === "move") {
		const now = closestOnAxis(ray, at.origin, at.direction);
		if (now === undefined) return undefined;
		const travel = snapTo(now - at.from, snap ? SNAP_PIXELS : 0);
		const total = emuFromWorld(travel);
		const step = total - at.emitted;
		if (step === 0) return undefined;
		at.emitted = total;
		return step;
	}
	const hit = intersectPlane(ray, at.centre, at.normal);
	if (!hit) return undefined;
	const now = angleInPlane(hit, at.centre, at.u, at.v);
	at.turned += angleDelta(now, at.last);
	at.last = now;
	const turned = snapTo(at.turned, snap ? SNAP_RADIANS : 0);
	const total = Math.round((turned * 180000) / Math.PI);
	const step = total - at.emitted;
	if (step === 0) return undefined;
	at.emitted = total;
	return step;
}

/** Eight CSS pixels, which is the studio's own nudge step. */
const SNAP_PIXELS = 8;
/** Fifteen degrees: twenty-four to the turn, and every 30° and 45° on the way. */
const SNAP_RADIANS = Math.PI / 12;

/** A phase boundary: a real edit shape, carrying no movement. */
function zeroEdit(id: string, handle: Handle, phase: EditPhase): SpatialEdit {
	return handle.kind === "move"
		? { kind: "move", id, phase, dx: 0, dy: 0, dz: 0 }
		: { kind: "turn", id, phase, turn: handle.turn, mdeg: 0 };
}

/** One increment, on the one axis the handle owns. */
function stepEdit(id: string, handle: Handle, step: number): SpatialEdit {
	if (handle.kind === "turn") {
		return { kind: "turn", id, phase: "drag", turn: handle.turn, mdeg: step };
	}
	return {
		kind: "move",
		id,
		phase: "drag",
		dx: handle.axis === "x" ? step : 0,
		dy: handle.axis === "y" ? step : 0,
		dz: handle.axis === "z" ? step : 0,
	};
}

/* ------------------------------------------------------------------ */
/* Reading the scene graph                                             */
/* ------------------------------------------------------------------ */

/** Where an object stands, in world space. */
function positionOf(object: Object3D): Vec3 {
	const v = new Vector3().setFromMatrixPosition(object.matrixWorld);
	return [v.x, v.y, v.z];
}

/**
 * One axis of an object's world basis, as a unit vector.
 *
 * Normalised rather than taken raw, and this is the one place the package
 * defends against a scale in the chain. `SceneTree` mounts positions and
 * rotations and never a scale, so the columns *are* unit — but the gizmo's own
 * root group is scaled every frame to keep it a constant size on screen, and
 * that scale is very much in this matrix. Normalising is how the same code reads
 * the root group and a ring group without knowing which of them is scaled.
 */
function basisColumn(object: Object3D, column: 0 | 1 | 2, sign: 1 | -1): Vec3 | undefined {
	const v = new Vector3().setFromMatrixColumn(object.matrixWorld, column);
	const unit = normalise([v.x, v.y, v.z]);
	return unit && (sign === 1 ? unit : scaled(unit, -1));
}

/** The `worldEuler(prefix)` group a ring hangs from, found by its marker. */
function ringGroup(root: Group, id: string): Group | undefined {
	let found: Group | undefined;
	root.traverse((child) => {
		if (!found && child instanceof Group && child.userData.gizmoRing === id) found = child;
	});
	return found;
}

/**
 * A pointer event as a world-space ray through the live camera.
 *
 * Built here rather than taken off R3F's event object, because a drag needs a
 * ray on frames where the pointer is over nothing at all and R3F only hands one
 * out with an intersection. The normalised device coordinates come from the
 * canvas's own bounding rectangle, which is the right rectangle under the
 * infinite canvas's CSS zoom: `clientX` and `getBoundingClientRect` are in the
 * same scaled space, so the ratio between them is unaffected by the transform.
 */
function rayFrom(
	event: PointerEvent,
	canvas: HTMLCanvasElement,
	camera: Parameters<ThreeRaycaster["setFromCamera"]>[1],
): Ray | undefined {
	const rect = canvas.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return undefined;
	const ndc = new Vector2(
		((event.clientX - rect.left) / rect.width) * 2 - 1,
		-(((event.clientY - rect.top) / rect.height) * 2 - 1),
	);
	const raycaster = new Raycaster();
	raycaster.setFromCamera(ndc, camera);
	const { origin, direction } = raycaster.ray;
	return {
		origin: [origin.x, origin.y, origin.z],
		direction: [direction.x, direction.y, direction.z],
	};
}

/**
 * Keep the gizmo a constant number of pixels across, whatever the lens and
 * however far away it is.
 *
 * Set on every frame *and* once before the first paint. The frame loop alone
 * would be enough in a `frameloop="always"` canvas and is not enough here: this
 * package renders on demand, and the one frame between mounting and the first
 * `useFrame` would draw the gizmo at scale 1 — which in a scene measured in CSS
 * pixels is a 96-pixel gizmo drawn 96 units across, an object roughly the size
 * of the thing it is attached to and then instantly the right size. One flash of
 * the wrong scale on every selection is exactly the kind of thing that reads as
 * jank without anybody being able to say what happened.
 */
function useScreenScale(root: RefObject<Group | null>) {
	const get = useThree((state) => state.get);
	const fit = useCallback(() => {
		const group = root.current;
		if (!group) return;
		const state = get();
		const camera = state.camera;
		const here = new Vector3().setFromMatrixPosition(group.matrixWorld);
		const distance = camera.position.distanceTo(here);
		// Every camera this package mounts is a perspective one — the document's
		// `camera` kind has a `fov`, and so do the framing and review cameras — so
		// the fallback is a default lens rather than a second projection model.
		const fov = "fov" in camera && typeof camera.fov === "number" ? camera.fov : 50;
		group.scale.setScalar(pixelSize(distance, fov, state.size.height));
	}, [get, root]);
	useLayoutEffect(fit);
	useFrame(fit);
}
