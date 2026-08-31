/**
 * A `light` node, as the lamp the answer set says it is.
 *
 * Two things here are decisions rather than transcriptions, and both are about
 * the fact that a design tool's numbers are not a photographer's.
 *
 * **1. A light points where the node is turned, not at the origin.** three.js
 * aims a directional and a spot light from its position at a `target` object,
 * which defaults to the world origin — so two lights at two places would both
 * point at the middle of the scene whatever the document said about them. That
 * is not what a `rotateY` on a lamp means. So each aimed light carries a target
 * object one unit **forward of itself**, as a child of its own group, and points
 * at that: the aim is then the node's own rotation, composed through every
 * pivot above it, exactly as a camera's is. The forward direction is three.js's
 * `-z`, which crosses back to the document's `+z` — *away from the viewer* — and
 * that is the same forward `Cameras.tsx` relies on. An unrotated lamp shines
 * into the screen, which is where an unrotated camera is looking, so a scene
 * with one of each and nothing turned is lit rather than silhouetted.
 *
 * **2. `decay` is zero, and `intensity` is therefore a plain multiplier.**
 * three.js has been physically correct since r155: a point or spot light's
 * intensity is candela and falls off with the square of the distance. In a scene
 * measured in CSS pixels a lamp 300 units from a solid would need an intensity
 * near 90,000 to look like anything, so `intensity: 1` — the property's own
 * fallback, and the number a designer types — would draw a black scene. The two
 * ways out are a hidden scale factor and `decay: 0`; a hidden scale factor is a
 * magic number nobody could ever predict from the inspector, and this codebase's
 * whole argument is that the number on screen is the number in the panel. So the
 * falloff goes and the number stays. What is lost is real and is worth naming: a
 * point light here does not get dimmer with distance, so it cannot be used to
 * model a lamp in a room. What is kept is that `intensity: 2` is twice as bright
 * as `intensity: 1` in every scene, at every scale, which is the property a
 * design tool actually needs.
 */
import { useEffect, useRef } from "react";
import type { DirectionalLight, Object3D, SpotLight } from "three";

import type { Lamp } from "./readings.ts";

/**
 * How wide a spot light's cone is, in radians, and how soft its edge is.
 *
 * **Constants because the document has no word for either.** `KINDS.light.props`
 * is `["lamp", "ink", "intensity"]` and nothing else: there is no `angle` and no
 * `penumbra` property, so there is nothing in an answer set for these to be read
 * from and a `spot` is a `point` with a cone of a fixed width. Recorded here
 * rather than tuned, so that the day the document grows the properties this is
 * one deletion. π/6 is a 60° cone, which is a normal stage spot; the penumbra
 * softens the last fifth of it, because a hard-edged circle reads as a rendering
 * artefact rather than as a light.
 */
const SPOT_ANGLE = Math.PI / 6;
const SPOT_PENUMBRA = 0.2;

export interface LightsProps {
	lamp: Lamp;
}

/**
 * The lamp itself, expected to be mounted **inside the node's own transform
 * group** — so it carries no position and no rotation of its own. Where it is
 * and which way it faces is the group's business, which is `SceneTree`'s, which
 * is the same chain a mesh goes through. A light that placed itself would be a
 * second implementation of the transform chain.
 *
 * A hidden light does not reach here at all: `readModel` drops a node without a
 * `visible/1` from the tree, so hiding a lamp puts it out, which is one of the
 * affordances "a 3D object is an ordinary scene node" was bought for. (A hidden
 * *camera* is the opposite case and is handled where it arises — see
 * `Cameras.tsx`.)
 */
export function Lights({ lamp }: LightsProps) {
	switch (lamp.kind) {
		case "ambient":
			// No direction, no position, no target: an ambient light is a constant
			// added to every fragment, so the node's place and rotation say nothing
			// about it. That is not a defect in the mapping — it is what "ambient"
			// means — and the layer list still shows it, a state can still hide it,
			// and a rule can still name it, because it is still an ordinary node.
			return <ambientLight color={lamp.colour} intensity={lamp.intensity} />;
		case "point":
			return (
				<pointLight color={lamp.colour} intensity={lamp.intensity} decay={0} />
			);
		case "directional":
			return <Directional lamp={lamp} />;
		case "spot":
			return <Spot lamp={lamp} />;
	}
}

/**
 * The aim, as a hook, so the two aimed kinds share it rather than resemble it.
 *
 * The target is an ordinary empty `Object3D` sitting one unit ahead of the lamp
 * in the lamp's own space, and the caller mounts it **as a sibling inside the
 * same group** so that the scene graph updates its world matrix every frame with
 * no help. three.js's own docs say to add the target to the scene for exactly
 * this reason; the version where the target is assigned but never mounted is the
 * classic bug where a light stops moving with its parent.
 *
 * The effect has no dependency array on purpose. R3F reuses objects across
 * re-renders, and a `useEffect(…, [])` here would leave a light holding the
 * target of a mount that has since been replaced.
 */
function useAim<T extends DirectionalLight | SpotLight>() {
	const light = useRef<T>(null);
	const target = useRef<Object3D>(null);
	useEffect(() => {
		if (light.current && target.current) light.current.target = target.current;
	});
	// three.js forward. Crosses back to the document's +z — into the screen.
	const marker = <object3D ref={target} position={[0, 0, -1]} />;
	return { light, marker };
}

function Directional({ lamp }: { lamp: Lamp }) {
	const { light, marker } = useAim<DirectionalLight>();
	return (
		<>
			<directionalLight ref={light} color={lamp.colour} intensity={lamp.intensity} />
			{marker}
		</>
	);
}

function Spot({ lamp }: { lamp: Lamp }) {
	const { light, marker } = useAim<SpotLight>();
	return (
		<>
			<spotLight
				ref={light}
				color={lamp.colour}
				intensity={lamp.intensity}
				angle={SPOT_ANGLE}
				penumbra={SPOT_PENUMBRA}
				decay={0}
			/>
			{marker}
		</>
	);
}
