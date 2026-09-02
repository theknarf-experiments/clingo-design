import {
	DEFAULT_EASING,
	EASINGS,
	type Machine,
	MOTION_PROPS,
	type ModelScene,
	type ResolveContext,
	type Scene,
	type SceneNode,
	type Transition,
	type Trigger,
	cssEasing,
	easingOf,
	machineForNode,
	machineLayers,
	msOf,
	shownStates,
} from "@clingo-design/design-core";

/**
 * How a trigger that just fired is paced, for whoever is drawing the move.
 *
 * **Lifted out of `Studio.tsx` because present mode has to pace a transition the
 * same way**, and a second answer to "how long does this hover take" is the
 * class of disagreement the whole machine architecture is arranged to prevent.
 * The studio and the presenter are two views of one document; if they disagreed
 * about a duration, the presentation would be a demo of a design nobody wrote.
 *
 * It is a second reading of what `stepMachine` answers, and the duplication with
 * the step is deliberate and narrow: the step decides *where the machine goes*,
 * which must have exactly one answer shared with the exported file, while this
 * decides *how the move is paced*, which the file gets from the same document by
 * a different route. The two are kept in step by being written to the same three
 * conditions `machineTable` filters on — enabled, both ends real, first in
 * document order — so the transition found here is the transition the table's
 * edge came from.
 */

/**
 * What "no duration" means, read out of `MOTION_PROPS` through `msOf`.
 *
 * The same table and the same reader the compiler emits `mdefdur/1` from, so the
 * canvas and the program cannot hold two different opinions about it. A table
 * entry no unit spells reads as nothing here and emits no default there, which
 * is a table to fix rather than a number to invent — so the `?? 0` is a type
 * obligation rather than a second policy.
 */
export const MOTION_FALLBACK = {
	duration: msOf(MOTION_PROPS.duration.fallback) ?? 0,
	delay: msOf(MOTION_PROPS.delay.fallback) ?? 0,
};

/** What the canvas writes into `--dc-play-*` for the move that just fired. */
export interface PlayedMotion {
	duration: number;
	delay: number;
	easing: string;
}

/** The edge a trigger takes at an instance right now, or nothing. */
export function edgeAt(
	scene: Scene,
	node: SceneNode | undefined,
	playing: Readonly<Record<string, Readonly<Record<string, string>>>>,
	instance: string,
	trigger: Trigger,
): { machine: Machine; transition: Transition } | undefined {
	if (!node) return undefined;
	const machine = machineForNode(scene, node);
	if (!machine) return undefined;
	// Where every layer is: what is being played, over what the document draws.
	// Layers made "where the machine is" plural, so the edge that fired is the
	// first one leaving *any* layer's current state — which is what `stepInstance`
	// walks, in the same layer order, and the same reason this is a second reading
	// rather than a second decision.
	const at = { ...shownStates(machine, node), ...playing[instance] };
	const ids = new Set(machine.states.map((s) => s.id));
	for (const layer of machineLayers(machine)) {
		const from = at[layer.id];
		if (from === undefined) continue;
		const transition = machine.transitions.find(
			(t) =>
				t.enabled &&
				t.trigger === trigger &&
				t.from === from &&
				ids.has(t.from) &&
				ids.has(t.to),
		);
		if (transition) return { machine, transition };
	}
	return undefined;
}

/**
 * And what that edge costs in milliseconds and a curve.
 *
 * The answer set's numbers where there are any, the document's reading against
 * this universe's picks where there are not — and the ordering matters, because
 * a `duration` token the solver chose between has no reading without a context.
 *
 * A **spring comes back as its whole `linear()` string** and is written straight
 * into `--dc-play-easing`. The canvas needs no `@supports` dance, which is the
 * one place the studio and the exported file deliberately differ: the studio runs
 * in whatever browser the designer has open right now and every browser that can
 * run this app parses `linear()`; only a file somebody keeps needs the fallback.
 */
export function motionOf(
	edge: { machine: Machine; transition: Transition },
	model: ModelScene | undefined,
	context: ResolveContext,
): PlayedMotion {
	const timing = model?.machines[edge.machine.id];
	return {
		duration: timing?.duration[edge.transition.id] ?? MOTION_FALLBACK.duration,
		delay: timing?.delay[edge.transition.id] ?? MOTION_FALLBACK.delay,
		easing:
			cssEasing(
				timing?.easing[edge.transition.id] ??
					easingOf(edge.machine, edge.transition, context),
			) ?? EASINGS[DEFAULT_EASING].css,
	};
}
