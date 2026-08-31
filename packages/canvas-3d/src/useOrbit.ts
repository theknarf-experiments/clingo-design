/**
 * Orbiting: **editor state, never the document.**
 *
 * A viewport's camera is a node the solver placed. Dragging in the view must not
 * move it — a design tool whose picture stops matching its own document the
 * moment you look around is a tool you cannot trust — so orbiting mounts a
 * *review camera* of this package's own beside the scene, seeded from whatever
 * camera was in force when the drag began, and lets go of it when orbiting
 * stops. The document camera is never touched, `frame/3` never moves, and
 * turning orbit off snaps straight back to the solver's answer.
 *
 * Written here rather than taken from drei's `<OrbitControls>`, and that is the
 * only reason `@react-three/drei` is not a dependency of this package.
 * `OrbitControls` is the standard answer and a good one; it also brings the
 * whole of drei into the app's dependency graph — a large library, of which this
 * package would use one component — and what it does that this does not is
 * damping, panning, touch gestures and a dozen configuration surfaces. The
 * spherical arithmetic below is the part that matters and it is twenty lines.
 * If orbiting ever needs to be good rather than adequate, delete this file and
 * add drei; the seam is the hook's return value and nothing else.
 *
 * The maths is the textbook one and the only thing worth writing down is which
 * space it is in: **three.js's**, after the crossing, because the target comes
 * from `boundsHint` and the seed comes from a camera object. Nothing in this
 * file is in EMU and nothing in it converts, which is the rule `units3.ts`
 * states.
 */
import { useThree } from "@react-three/fiber";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Vector3 } from "three";

/** Where the review camera is, as a spherical offset from what it looks at. */
export interface OrbitPose {
	/** Radians east of the +z axis, in the xz plane. */
	azimuth: number;
	/** Radians above the xz plane. Clamped short of the poles. */
	elevation: number;
	/** Distance from the target, in renderer units. */
	distance: number;
	/**
	 * What the camera is orbiting around and pointing at, in renderer units.
	 *
	 * **On the pose rather than passed beside it**, which it was not when this
	 * file was first written and which framing the selection is what changed. A
	 * target held by the caller is a target that is one thing — the middle of
	 * everything in the view — and framing a selection means moving the pivot to
	 * the selection and then orbiting *that*. Two callers each holding half the
	 * camera would have had to agree about when the half they held changed, which
	 * is the shape of bug that shows up as a view that snaps back a frame after
	 * you frame something.
	 */
	target: [number, number, number];
}

/**
 * A pose as a position.
 *
 * The pole is never reached — `elevation` is clamped to just inside ±90° — so
 * the camera's up vector never becomes parallel to its forward and the view
 * never flips over. That single clamp is the difference between an orbit that
 * feels solid and one that gimbal-locks on the first drag to the top.
 */
export function orbitPosition(pose: OrbitPose): [number, number, number] {
	const cosElevation = Math.cos(pose.elevation);
	return [
		pose.target[0] + pose.distance * cosElevation * Math.sin(pose.azimuth),
		pose.target[1] + pose.distance * Math.sin(pose.elevation),
		pose.target[2] + pose.distance * cosElevation * Math.cos(pose.azimuth),
	];
}

/**
 * Something to look at, and the request to go and look at it.
 *
 * **Identity is the request.** A new object means "frame this now"; the same
 * object handed back on the next render means nothing at all. That is deliberate
 * and it is the only shape that works for a command with a payload: a boolean
 * would have to be turned off again by the caller, a nonce would be a number
 * nobody can name, and comparing the centre and radius by value would refuse to
 * re-frame after the user had orbited away from the very thing they asked to
 * frame — which is the single most common second press of the key.
 */
export interface OrbitFocus {
	/** The middle of what to frame, in renderer units — `boundsHint`'s centre. */
	centre: readonly [number, number, number];
	/** Its bounding radius, in renderer units. Never zero. */
	radius: number;
}

/** Just inside the pole, in radians — see {@link orbitPosition}. */
const POLE = Math.PI / 2 - 0.01;

/** Radians of rotation per pixel dragged. A full turn is about 700px across. */
const PER_PIXEL = 0.009;

/** How much one wheel notch dollies, as a proportion of the distance. */
const PER_NOTCH = 0.0015;

/** The closest and furthest the review camera may get, as multiples of the seed. */
const NEAREST = 0.05;
const FURTHEST = 20;

export interface UseOrbitOptions {
	/** Whether dragging orbits at all. False parks the listeners completely. */
	enabled: boolean;
	/** What to orbit around, in renderer units — usually `boundsHint`'s centre. */
	target: readonly [number, number, number];
	/** The bounding radius, used to seed the distance if nothing else can. */
	radius: number;
	/**
	 * Frame something, once, on a new object — see {@link OrbitFocus}.
	 *
	 * Acts **whether or not `enabled` is true**, and the asymmetry is the point:
	 * orbiting is a drag, so it is on only while a modifier is held, while framing
	 * is a command and the view has to stay where it was put afterwards. So a
	 * focus creates the review pose if there is not one and moves it if there is,
	 * and the pose then persists until the caller passes `undefined` *and* stops
	 * orbiting — which is how the editor hands the view back to the document's own
	 * camera.
	 */
	focus?: OrbitFocus;
	/**
	 * The review camera's vertical field of view in degrees, so framing knows how
	 * far back to stand. `ReviewCamera` is given `defaultLens()`, and this should
	 * be the same number — a framing computed through a different lens from the
	 * one it will be seen through is a framing that is slightly wrong every time.
	 */
	fov?: number;
	/**
	 * A drag that belongs to somebody else — the transform gizmo's grab flag.
	 *
	 * Checked at pointerdown, so a press that lands on a gizmo handle never starts
	 * an orbit at all. It is only half the arbitration, because the two listeners
	 * are on different elements and this one runs first; {@link UseOrbit.abort} is
	 * the other half. `TransformGizmo`'s `seize` explains the pair.
	 */
	blocked?: RefObject<boolean>;
}

/** What the hook hands back: the pose to mount, and a way to give up a drag. */
export interface UseOrbit {
	/** `undefined` when the document's own camera should be in force. */
	pose: OrbitPose | undefined;
	/**
	 * Drop the drag in progress, if any, without changing the pose.
	 *
	 * Called by the gizmo at the moment it takes the pointer. This is the half of
	 * the arbitration that copes with the orbit listener having already run: it
	 * fires on the canvas, the gizmo's fires on the div around it, and the canvas
	 * is inside the div, so in the bubble phase the orbit always gets there first.
	 */
	abort: () => void;
}

/**
 * The review camera's pose, and the handlers that move it.
 *
 * The pose is seeded **once, from the camera that was default when orbiting
 * turned on** — which is the document's camera if it named one, and the framing
 * camera if it did not. So looking around starts from where the design says you
 * are standing, which is the whole reason to seed it from a camera rather than
 * from the framing every time.
 *
 * The pose is `undefined` when neither a drag nor a framing is holding the view,
 * so a caller can mount the review camera on exactly that: no pose, no camera,
 * the document's camera unchanged.
 *
 * Must be called **inside** the `<Canvas>`, like every hook that reads
 * `useThree`.
 */
export function useOrbit({
	enabled,
	target,
	radius,
	focus,
	fov = 50,
	blocked,
}: UseOrbitOptions): UseOrbit {
	const get = useThree((state) => state.get);
	const invalidate = useThree((state) => state.invalidate);
	const [pose, setPose] = useState<OrbitPose | undefined>(undefined);
	// The pointer id and the last position, so a drag that leaves the canvas and
	// comes back does not jump. `null` between drags.
	const drag = useRef<{ id: number; x: number; y: number } | null>(null);
	// The bounds through a ref, because the listeners below are attached once per
	// enablement and must not be torn down and rebuilt every time a size changes
	// somewhere in the scene — rebinding mid-drag drops the pointer capture.
	const radiusRef = useRef(radius);
	radiusRef.current = radius;
	// The focus already acted on, by identity — see `OrbitFocus`.
	const framed = useRef<OrbitFocus | undefined>(undefined);

	const abort = useCallback(() => {
		const at = drag.current;
		if (!at) return;
		drag.current = null;
		const canvas = get().gl.domElement;
		if (canvas.hasPointerCapture(at.id)) canvas.releasePointerCapture(at.id);
	}, [get]);

	/*
	 * Framing, before the seeding effect below and deliberately so.
	 *
	 * Both write the pose and the order they run in decides which wins on the
	 * render where a viewport is entered *and* something is framed in the same
	 * commit. Framing is the explicit request and the seed is the default, so the
	 * seed goes second and skips a pose that already exists — which is what the
	 * `previous && !framed` shape below says.
	 */
	useEffect(() => {
		if (!focus || framed.current === focus) return;
		framed.current = focus;
		const centre: [number, number, number] = [focus.centre[0], focus.centre[1], focus.centre[2]];
		// Far enough back that the bounding sphere fills the frame with a fifth of
		// margin — `FramingCamera`'s own arithmetic, kept in one shape so that
		// framing a selection and the fallback framing agree about how close is
		// close enough.
		const half = (Math.max(fov, 1e-3) * Math.PI) / 360;
		const distance = (Math.max(focus.radius, 1) / Math.max(Math.sin(half), 1e-3)) * 1.2;
		setPose((previous) => ({
			// The direction is kept where there is one, so framing a second object
			// does not also spin the view back to front-on. Front-on only when
			// nothing was in force — which is the "you just pressed it" case.
			azimuth: previous?.azimuth ?? 0,
			elevation: previous?.elevation ?? 0,
			distance,
			target: centre,
		}));
		invalidate();
	}, [focus, fov, invalidate]);

	useEffect(() => {
		if (!enabled) {
			// A framing outlives the drag that is not happening: the view stays where
			// it was put until the caller drops the focus too. `framed` is left
			// pointing at the focus that made it, so putting the same one back does
			// not re-frame — the caller asks again with a new object.
			if (!focus) setPose(undefined);
			return;
		}
		// Seeded from the live camera through `get()` rather than by subscribing,
		// for `useDefaultCamera`'s reason: this hook is about to change what the
		// default camera is, and a subscription would re-seed from its own result.
		const camera = get().camera;
		const centre: [number, number, number] = [target[0], target[1], target[2]];
		const from = new Vector3().copy(camera.position).sub(new Vector3(...centre));
		const distance = from.length() || Math.max(radius * 3, 1);
		setPose((previous) =>
			// A pose already in force is a framing the caller asked for, or the pose
			// a previous drag left behind, and either is a better answer than the
			// camera this hook is itself about to replace. Seeding only into silence
			// is what makes framing-then-orbiting continue from the framing.
			previous ?? {
				azimuth: Math.atan2(from.x, from.z),
				// `asin` of a ratio that can drift a hair past 1 through float error,
				// which would be `NaN` and a camera at no position at all.
				elevation: Math.asin(Math.min(1, Math.max(-1, from.y / distance))),
				distance,
				target: centre,
			},
		);
		// `target` and `radius` are deliberately not dependencies. Re-seeding
		// because the scene's bounds moved — which happens on every keystroke that
		// changes a size — would snap the view back mid-drag. The seed is a fact
		// about the moment orbiting started.
	}, [enabled, focus, get]);

	// The listeners go on `gl.domElement` — the real `<canvas>` — through a native
	// `useEffect` rather than onto React props, and the reason is where this hook
	// has to live. It needs `useThree`, so it is inside the R3F tree; the element
	// that receives the drag is outside it. Native listeners on the canvas are the
	// seam between the two, and they are what `OrbitControls` does for the same
	// reason. They are also the only way to take `wheel` with `passive: false`,
	// which is what stops the infinite canvas behind this one zooming at the same
	// time.
	useEffect(() => {
		if (!enabled) return;
		const canvas = get().gl.domElement;

		const down = (event: PointerEvent) => {
			// Only the primary button orbits. Right-drag is the studio's context
			// menu and middle-drag is its pan, and taking either here would make
			// this view the one place in the tool where they mean something else.
			if (event.button !== 0) return;
			// A press that is about to land on a gizmo handle. Half the arbitration
			// — see {@link UseOrbitOptions.blocked}, and `abort` for the other half.
			if (blocked?.current) return;
			canvas.setPointerCapture(event.pointerId);
			drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
			// Stopped so the pan gesture on the canvas behind this one does not also
			// start. A viewport only gets pointer events at all when the editor has
			// entered it, so this is never taking a gesture from anybody.
			event.stopPropagation();
		};

		const move = (event: PointerEvent) => {
			const at = drag.current;
			if (!at || at.id !== event.pointerId) return;
			const dx = event.clientX - at.x;
			const dy = event.clientY - at.y;
			at.x = event.clientX;
			at.y = event.clientY;
			setPose((previous) =>
				previous === undefined
					? previous
					: {
							...previous,
							// Dragging right turns the scene right, which means the camera
							// goes left — hence the sign. Dragging down looks from above.
							azimuth: previous.azimuth - dx * PER_PIXEL,
							elevation: Math.min(
								POLE,
								Math.max(-POLE, previous.elevation + dy * PER_PIXEL),
							),
						},
			);
			// `frameloop` is `demand` unless something is animating, so a drag that
			// did not ask for a frame would move the camera and draw nothing.
			invalidate();
		};

		const up = (event: PointerEvent) => {
			if (drag.current?.id !== event.pointerId) return;
			if (canvas.hasPointerCapture(event.pointerId)) {
				canvas.releasePointerCapture(event.pointerId);
			}
			drag.current = null;
		};

		const wheel = (event: WheelEvent) => {
			event.preventDefault();
			event.stopPropagation();
			setPose((previous) => {
				if (previous === undefined) return previous;
				// Multiplicative, so a notch moves the same *proportion* at every
				// scale — which is what makes zooming feel the same close up and far
				// away, and is the same reason the 2D canvas zooms multiplicatively.
				const scaled = previous.distance * (1 + event.deltaY * PER_NOTCH);
				const seed = Math.max(radiusRef.current, 1);
				return {
					...previous,
					distance: Math.min(seed * FURTHEST, Math.max(seed * NEAREST, scaled)),
				};
			});
			invalidate();
		};

		canvas.addEventListener("pointerdown", down);
		canvas.addEventListener("pointermove", move);
		canvas.addEventListener("pointerup", up);
		canvas.addEventListener("pointercancel", up);
		canvas.addEventListener("wheel", wheel, { passive: false });
		return () => {
			canvas.removeEventListener("pointerdown", down);
			canvas.removeEventListener("pointermove", move);
			canvas.removeEventListener("pointerup", up);
			canvas.removeEventListener("pointercancel", up);
			canvas.removeEventListener("wheel", wheel);
			drag.current = null;
		};
	}, [blocked, enabled, get, invalidate]);

	return { pose, abort };
}
