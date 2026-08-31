/**
 * The eye: a `camera` node made into the one three.js renders through, and the
 * fallback for a view that names none.
 *
 * Three things are worth reading before touching this file.
 *
 * **1. A document camera needs no flip of its own.** three.js points a camera
 * down its local `−z`; the document's `+z` is away from the viewer;
 * `renderPoint` negates z. So an unrotated document camera, mounted at its
 * crossed position with its crossed rotation, is already looking exactly where
 * the document says — into the screen — and its up vector is already the
 * document's up, because y is negated too. There is no `lookAt` anywhere in this
 * package and there must not be: a `lookAt` would be a second, silent answer to
 * where a camera points, sitting beside the rotation the solver worked out.
 *
 * **2. The camera is mounted where the node is in the tree**, inside every pivot
 * above it, rather than being positioned from a world matrix computed here.
 * `SceneTree` already composes the chain, and a camera that computed its own
 * would be a second implementation of it — the exact thing that goes wrong six
 * months later when a pivot gains a rotation.
 *
 * **3. The aspect ratio is the canvas's, not the viewport's.** A `viewport`
 * node's frame is a rectangle in EMU and the `<canvas>` fills it, so the two
 * agree — but only the canvas knows about `dpr`, about the artboard being
 * culled, and about the element having been resized by a gesture that has not
 * reached the document yet. `useThree(state => state.size)` is the number that
 * is true right now, and `setDefault` below reacts to it.
 */
import { type Camera as R3FCamera, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import type { PerspectiveCamera as ThreePerspectiveCamera } from "three";

import type { Lens } from "./readings.ts";

export interface CameraProps {
	lens: Lens;
	/**
	 * True for the camera `looks/2` names — the one three.js renders through.
	 *
	 * A viewport with several cameras in it mounts them all: they are ordinary
	 * nodes, they are in the layer list, a rule can name one, and the studio's
	 * "look through" menu switches between them by rewriting `viewport.camera`,
	 * which changes `looks/2`, which changes this boolean. Only one of them is
	 * ever the default, and the un-chosen ones cost a `PerspectiveCamera` object
	 * that nothing renders through, which is nothing.
	 */
	primary: boolean;
}

/**
 * A `camera` node. Mounted inside its own transform group, like a lamp.
 *
 * Nothing draws a marker for it here. A camera is `drawable: false` in
 * `KINDS`, and the editor's marker for one is an overlay in the 2D layer rather
 * than geometry in the scene — a wireframe pyramid inside the scene would be an
 * object a raycast could hit and a shadow could fall on, which is a different
 * claim from "there is a camera here".
 */
export function Camera({ lens, primary }: CameraProps) {
	const camera = useRef<ThreePerspectiveCamera>(null);
	useDefaultCamera(camera, primary);
	return (
		<perspectiveCamera
			ref={camera}
			fov={lens.fov}
			near={lens.near}
			far={lens.far}
		/>
	);
}

/**
 * The framing camera: what a viewport looks through when it names no camera, or
 * names one that is not in the scene.
 *
 * **The second case is not hypothetical and it is the one interesting thing in
 * this file.** `docs/merged-plan.md` is explicit that `vcam/2` "does not consult
 * `hidden/1`" — hiding a camera means stop drawing its marker, never stop
 * looking — but `readModel` drops a node with no `visible/1` from the tree
 * entirely, so a `ModelScene` holds `looks: {view: "cam"}` and **no node called
 * `cam`**. The pose the program worked out for that camera is in the answer set,
 * in `frame/3` and `turn/3`, and it does not survive into the model.
 *
 * So a hidden camera does not blind the view — the requirement is met — but what
 * the view falls back to is this framing rather than the camera's own pose,
 * which is not what the merged plan meant. It is reported as a gap in the reader
 * rather than papered over here, because the repair belongs in `model.ts`: a
 * `ModelScene` that cannot express the pose of a node the answer set placed is
 * the thing that is wrong, and a second reader in this package that went back to
 * the atoms would be exactly the parallel 3D document model invariant 2 forbids.
 *
 * The framing itself is deliberately dumb: put the eye back along the document's
 * `−z` — toward the viewer, which is where a viewer is — far enough that the
 * bounding sphere of everything in the view fits the vertical field of view,
 * looking at the middle of it. It is the "you have not placed a camera yet"
 * picture, and its only job is that a scene appears at all.
 */
export function FramingCamera({
	lens,
	centre,
	radius,
}: {
	lens: Lens;
	/** The middle of everything drawn, in renderer units, already crossed. */
	centre: readonly [number, number, number];
	/** The bounding sphere's radius, in renderer units. Never zero. */
	radius: number;
}) {
	const camera = useRef<ThreePerspectiveCamera>(null);
	useDefaultCamera(camera, true);
	// Half the vertical field of view, so `sin` is the ratio the sphere subtends.
	const half = (lens.fov * Math.PI) / 360;
	// A fifth of margin, so nothing is ever exactly on the edge of the frame.
	const distance = (radius / Math.max(Math.sin(half), 1e-3)) * 1.2;
	// three.js `+z` is toward the viewer, and this is the one place in the
	// package that says so without going through the crossing — because it is
	// not crossing anything. There is no document behind this number.
	const position: [number, number, number] = [
		centre[0],
		centre[1],
		centre[2] + distance,
	];
	// `far` has to reach past the scene or the framing would clip what it framed,
	// and the document's own `far` was written for a camera the document placed.
	const far = Math.max(lens.far, distance + radius * 2);
	return (
		<perspectiveCamera
			ref={camera}
			position={position}
			fov={lens.fov}
			near={lens.near}
			far={far}
		/>
	);
}

/**
 * The review camera: where orbiting puts the eye.
 *
 * **The one camera in this package that is allowed a `lookAt`**, and the reason
 * the rule stated at the top of this file is not being broken. That rule is
 * about a camera the *document* placed: its rotation is `turn/3`, a rule can
 * constrain it, a state can turn it, and a `lookAt` beside it would be a second
 * silent answer to which way it points. A review camera is not in the document
 * at all — it is a pose the editor is holding while somebody drags — and
 * "pointing at what you are orbiting around" is its entire definition. There is
 * nothing here for a `lookAt` to contradict.
 *
 * It carries the document's default lens rather than the lens of the camera it
 * is standing in for, because it is not standing in for one: a document camera
 * with a 12° lens is a design decision about a shot, and looking around a scene
 * through it would show a keyhole.
 */
export function ReviewCamera({
	lens,
	position,
	target,
}: {
	lens: Lens;
	position: readonly [number, number, number];
	/** What to point at, in renderer units. */
	target: readonly [number, number, number];
}) {
	const camera = useRef<ThreePerspectiveCamera>(null);
	useDefaultCamera(camera, true);
	// A layout effect rather than a `lookAt` prop, because R3F has none: the
	// element sets `position` declaratively and the orientation has to be applied
	// to the object after it exists. Before paint, so a drag never shows one
	// frame pointing the wrong way.
	useLayoutEffect(() => {
		camera.current?.lookAt(target[0], target[1], target[2]);
	});
	// `far` stretched past the target, for `FramingCamera`'s reason: the
	// document's `far` was written for a shot, and dollying out past it while
	// looking around would clip the scene away.
	const reach = Math.hypot(
		position[0] - target[0],
		position[1] - target[1],
		position[2] - target[2],
	);
	return (
		<perspectiveCamera
			ref={camera}
			position={[position[0], position[1], position[2]]}
			fov={lens.fov}
			near={lens.near}
			far={Math.max(lens.far, reach * 4)}
		/>
	);
}

/**
 * Make a camera the one R3F renders through, and keep its aspect ratio true.
 *
 * R3F's `set({ camera })` is the supported way in; drei's `<PerspectiveCamera
 * makeDefault>` is this hook plus a lot of features this package does not use,
 * and adding the whole of drei for it would have put a large dependency in the
 * app's graph to save fifteen lines. That is the only reason drei is not a
 * dependency of this package.
 *
 * Two effects rather than one, because they are two different lifetimes:
 *
 *   - the **aspect** is a layout effect and runs on every size change, before
 *     the browser paints, so a resize never shows one frame of stretched scene.
 *     R3F's own `updateCamera` does the same arithmetic on the default camera
 *     when the canvas is resized, and this is not a second answer to the same
 *     question: R3F reacts to the *size* changing, and this also has to react to
 *     *which camera is default* changing, which happens with no resize at all
 *     when a viewport's "look through" is switched.
 *   - the **default** is a plain effect that restores whatever camera was in
 *     force when this one took over. Without the restore, switching which camera
 *     a viewport looks through would leave the scene rendering from a
 *     `PerspectiveCamera` that is no longer in the tree — a black frame that only
 *     appears when you use the feature.
 *
 * The camera being replaced is captured through `state.get()` inside the effect
 * rather than by subscribing to `state.camera`. Subscribing would be a loop with
 * an unpleasant shape: this effect sets `state.camera`, the subscription
 * re-renders with the new value, the dependency changes, and the cleanup
 * "restores" the camera to itself — so the original is lost on the first commit
 * and the restore silently does nothing.
 */
function useDefaultCamera(
	camera: RefObject<ThreePerspectiveCamera | null>,
	primary: boolean,
) {
	const set = useThree((state) => state.set);
	const get = useThree((state) => state.get);
	const size = useThree((state) => state.size);
	const replaced = useRef<R3FCamera | null>(null);

	useLayoutEffect(() => {
		const it = camera.current;
		if (!it || !primary) return;
		it.aspect = size.width / Math.max(size.height, 1);
		it.updateProjectionMatrix();
	}, [camera, primary, size.width, size.height]);

	useEffect(() => {
		const it = camera.current;
		if (!it || !primary) return;
		replaced.current = get().camera;
		set({ camera: it });
		return () => {
			const back = replaced.current;
			replaced.current = null;
			if (back) set({ camera: back });
		};
	}, [camera, primary, set, get]);
}
