/**
 * A timeline, as `@keyframes`.
 *
 * HTML's alone, for `states.ts`' reason: an SVG has no clock to play against.
 */
import type {
	Declarations,
	Easing,
	Emu,
	LoopMode,
	Machine,
	MachineState,
	ModelNode,
	Picks,
	Scene,
	SceneNode,
	Timeline,
	Token,
	Track,
	Turn,
} from "@clingo-design/design-core";
import {
	DEFAULT_EASING,
	TIMELINE_CLOCKS,
	TURN_NAMES,
	blendWeights,
	clockOf,
	cssLength,
	cssValue,
	emuOf,
	instancePart,
	keyEasing,
	keyValueVar,
	mdegOf,
	paintFor,
	resolveValue,
	solvedKeys,
	stateName,
	statePlays,
	timelineLength,
	trackTerm,
} from "@clingo-design/design-core";

import type {
	Layer,
} from "@clingo-design/export-core";
import {
	indexDocument,
	slug,
} from "@clingo-design/export-core";
import { transformOf } from "./depth.ts";
import { rule } from "./html.ts";
import type { MachineExport } from "./states.ts";
import { ms, planMachines, scrollTimelineFor, timingFunction } from "./states.ts";

/* ------------------------------------------------------------------ */
/* A timeline, as @keyframes                                           */
/* ------------------------------------------------------------------ */

/*
 * **Why a timeline is CSS and a state is a selector, and why that is not two
 * answers to one question.**
 *
 * A state is a *pose*: the machine settles in it and stays there, and what a
 * stylesheet needs is a rule that says what the design looks like while it is
 * there. A timeline is a *path*: a sequence of poses with times on them, played
 * through. CSS has a word for each of those and they are different words, and
 * the reason this file uses both rather than picking one is that the browser is
 * a better animator than any script this file could ship. `@keyframes` runs on
 * the compositor, it is interruptible, it retimes itself when the tab is
 * backgrounded, and it costs the exported page no JavaScript at all — which is
 * the same argument `runtime.ts` makes about not owning a clock, arriving from
 * the other end.
 *
 * So the runtime switches `data-state`, the state's rule turns the animation on,
 * and the compositor plays it. Nothing in the emitted script knows a timeline
 * exists, and a grep for `mkat` or `@keyframes` in `MACHINE_RUNTIME` comes up
 * empty on purpose.
 *
 * **What is exact, and what is resampled.** Every keyframe's *value* and *time*
 * are answers this universe gave — `kval` and `kat`, both `#project`ed, so two
 * alternatives really are two files — and a track that animates one property
 * comes out with exactly the keyframes the designer wrote, at exactly the
 * percentages they resolved to. The one place arithmetic happens is where two
 * tracks about one part both write `transform`: `transform` is a single CSS
 * value, so a stop that moved the box and a stop that turned it cannot be two
 * declarations, and a stop at 40% has to say what the *rotation* is at 40% even
 * though the rotation's own keys are at 0% and 100%. That is a linear sample
 * between the two surrounding keys, it ignores the easing of the segment it
 * samples inside, and it is named in the losses — but only where it actually
 * happens, which is where two transform tracks of one part disagree about when
 * their keyframes are.
 */

/** One track of one timeline, with what this universe put in each keyframe. */
interface PlayedKey {
	at: number;
	/** The literal the value resolved to, or nothing where it resolved to nothing. */
	value: string | undefined;
	/**
	 * The literal the *curve* resolved to — a menu word or a `cubicBezier(…)`, and
	 * text rather than an {@link Easing} for `easingOf`'s reason.
	 */
	easing: string;
}

interface PlayedTrack {
	track: Track;
	keys: PlayedKey[];
}

/** Every track of one timeline, read against this universe's picks. */
export function playedTracks(
	machine: Machine,
	timeline: Timeline,
	context: { tokens: readonly Token[]; picks: Picks },
): PlayedTrack[] {
	const out: PlayedTrack[] = [];
	for (const track of timeline.tracks) {
		const term = trackTerm(track);
		if (term === undefined) continue;
		const keys = solvedKeys(machine, timeline, track, context).map((solved) => ({
			at: solved.at,
			value: resolveValue(
				context,
				solved.key.value,
				keyValueVar(machine.id, timeline.id, term, solved.index),
			),
			easing: keyEasing(machine, timeline, term, solved.index, solved.key, context),
		}));
		if (keys.length > 0) out.push({ track, keys });
	}
	return out;
}

/**
 * One track's number at one moment, linearly.
 *
 * Only ever asked about a track whose values are a *quantity* — a length or an
 * angle — and only ever at a moment some other track of the same part has a
 * keyframe at. Before the first key and after the last it holds flat, which is
 * what `animation-fill-mode: both` does at the ends of the animation itself and
 * is the only answer that does not invent a value out of nothing.
 */
export function sampleAt(keys: readonly PlayedKey[], read: (text: string) => number | undefined, at: number): number | undefined {
	const known = keys
		.map((key) => ({ at: key.at, n: key.value === undefined ? undefined : read(key.value) }))
		.filter((k): k is { at: number; n: number } => k.n !== undefined);
	if (known.length === 0) return undefined;
	if (at <= known[0].at) return known[0].n;
	const last = known[known.length - 1];
	if (at >= last.at) return last.n;
	for (let i = 0; i + 1 < known.length; i++) {
		const lo = known[i];
		const hi = known[i + 1];
		if (at < lo.at || at > hi.at) continue;
		const span = hi.at - lo.at;
		return span <= 0 ? lo.n : lo.n + ((hi.n - lo.n) * (at - lo.at)) / span;
	}
	return last.n;
}

/** True where this track writes into the one `transform` declaration. */
export const movesTransform = (track: Track): boolean =>
	track.turn !== undefined || track.dim === "x" || track.dim === "y" || track.dim === "z";

/** A `@keyframes` name no other block in this file has taken. */
export function keyframeName(taken: Set<string>, parts: readonly string[]): string {
	const stem = `k-${parts.map(slug).join("-")}`;
	let name = stem;
	for (let n = 2; taken.has(name); n++) name = `${stem}-${n}`;
	taken.add(name);
	return name;
}

/**
 * How a timeline's loop mode reaches the `animation` shorthand.
 *
 * `pingPong` is `alternate` over an infinite count, which is what the word means
 * and what {@link timelinePosition} does on the canvas — the two have to agree or
 * scrubbing in the studio and watching the exported page are two animations.
 * `none` runs once and `both` holds the last frame, which is what makes the
 * settled pose the state's rule states and the last keyframe of the timeline the
 * same picture rather than a snap between them.
 */
export const LOOPING: Record<LoopMode, { count: string; direction: string }> = {
	none: { count: "1", direction: "normal" },
	loop: { count: "infinite", direction: "normal" },
	pingPong: { count: "infinite", direction: "alternate" },
};

/**
 * The timelines one state plays, as `@keyframes` blocks and an `animation`.
 *
 * One block per (instance, timeline, **part**), not per timeline: a `@keyframes`
 * block is applied to an element, and a timeline that moves a panel and fades a
 * label is two elements' worth of animation. Splitting per part is what makes
 * each block a sequence of declarations one element can actually take.
 *
 * The animation lands on the state's own rule where the state is one the file can
 * select — which is every state but the one the picture is drawn in — and on the
 * drawn state's *base* rule otherwise, through {@link MachineExport.playing},
 * which `htmlExport` merges the way it merges the `transition:` declarations. A
 * timeline that plays in the state the file opens in has to be running when the
 * file opens, and a rule that only exists under a `data-state` the runtime has
 * not written yet would start it late or not at all.
 */
export function playTimelines(
	base: Layer,
	machine: Machine,
	instance: SceneNode,
	state: MachineState,
	context: { tokens: readonly Token[]; picks: Picks },
	out: Played,
	/** The springs this state's keyframes named — see {@link MachineExport.springs}. */
	springs: Set<Easing>,
	/** The gated `@keyframes` names — see {@link MachineExport.scrolled}. */
	scrolled: Set<string>,
	say: (line: string) => void,
): Map<string, Declarations> {
	const model = base.universe.model;
	const animations = new Map<string, Declarations>();
	let timelines = statePlays(machine, state);
	const named = timelines.length;
	if (named === 0) return animations;
	if (state.blend !== undefined) {
		// **One stop, and it is scaffolding rather than a feature.** CSS has no way
		// to mix two keyframe animations by a number: `animation` takes a list, but
		// two animations writing one property is the last one winning, not a blend.
		// So the file carries the stop the blend is *at* when the page opens — which
		// is `blendWeights` asked with no host values, so it falls back to every
		// input's declared initial, which is exactly the valuation the emitted
		// runtime seeds its store with — and the loss says so. The studio canvas
		// does the real mixing, off the same function.
		const weights = blendWeights(machine, state.blend, {});
		const heaviest = weights.reduce<(typeof weights)[number] | undefined>(
			(best, w) => (best === undefined || w.weight > best.weight ? w : best),
			undefined,
		);
		const chosen = timelines.find((t) => t.id === heaviest?.timeline);
		timelines = chosen ? [chosen] : timelines.slice(0, 1);
		// Counted against the timelines the blend *names*, not against the weights
		// it came back with: a 1D blend sitting on one of its own stops answers with
		// that stop alone, which is the common case and is exactly the case where a
		// designer most needs telling that the rest of the axis is not in the file.
		if (named > 1) {
			say(
				`The mix in ${stateName(machine, state.id)} of “${machine.name}”. A blend is arithmetic over a live number and CSS cannot mix two keyframe animations by one, so the file plays “${timelines[0].name}” — the stop the blend starts at — flat, and the other ${named - 1} ${named === 2 ? "is" : "are"} not in it.`,
			);
		}
	}

	for (const timeline of timelines) {
		const length = timelineLength(machine, timeline, context);
		if (length <= 0) {
			say(
				`“${timeline.name}” has no length in this design, so there is nothing between its keyframes to play. The pose ${stateName(machine, state.id)} settles in is in the file; the animation is not.`,
			);
			continue;
		}
		const tracks = playedTracks(machine, timeline, context);
		const parts = [...new Set(tracks.map((t) => t.track.part))];
		for (const part of parts) {
			const nodeId = instancePart(instance.id, part);
			const drawn = model.byId[nodeId];
			if (!drawn) {
				say(
					`“${timeline.name}” animates “${part}” of “${instance.name}”, which this design is not drawing. A stylesheet can animate an element and cannot write one, so that track is not in the file.`,
				);
				continue;
			}
			const block = keyframeBlock(
				timeline,
				length,
				tracks.filter((t) => t.track.part === part),
				drawn,
				springs,
				say,
			);
			if (block === undefined) continue;
			const name = keyframeName(out.names, [instance.id, timeline.id, part]);
			out.keyframes.push(`@keyframes ${name} {\n${block}\n}`);
			const loop = LOOPING[timeline.loop ?? "none"];
			const scroll = scrollTimelineFor(state);
			if (scroll !== null) {
				scrolled.add(name);
				// Longhands rather than the shorthand, because one of the five has to
				// be a `var()` the `@supports` block switches — see
				// `MachineExport.scrolled`. The other four are harmless in a browser
				// that ignores them: `animation-timeline` is dropped as unknown,
				// `animation-duration: auto` is dropped as invalid, and
				// `animation-name: none` means nothing plays regardless.
				//
				// `auto` and not the timeline's own length: a scroll-driven animation's
				// duration *is* the range it is attached to, and a number here would
				// be a second clock inside the one the scroll already is. The
				// document's length still decides everything that matters — the
				// keyframe percentages, which are what the block above is made of.
				//
				// The loop mode is deliberately dropped, and it is the one thing this
				// path silently does not carry: a scroll timeline has no repetitions to
				// count, because scrolling back *is* the animation running backwards.
				// `iteration-count` and `direction` against a scroll range are either
				// ignored or subdivide the range, and neither is what "ping-pong" was
				// asked for.
				animations.set(nodeId, {
					...(animations.get(nodeId) ?? {}),
					"animation-name": `var(--dc-tl-${name})`,
					"animation-duration": "auto",
					"animation-timing-function": "linear",
					"animation-fill-mode": "both",
					"animation-timeline": scroll,
				});
				// One sentence per (state, clock) rather than per node, because `say`
				// dedupes and a timeline animating six parts is one decision a designer
				// made once. It names the browsers rather than saying "some browsers",
				// for the reason every other loss here names a thing: a sentence a
				// person can act on beats a sentence they have to go and research.
				say(
					`“${timeline.name}” in ${stateName(machine, state.id)} of “${machine.name}” is driven by ${TIMELINE_CLOCKS[clockOf(state)].label.toLowerCase()} rather than by the clock. That needs \`animation-timeline\`, which Safari has not got: there the element sits at the state's own pose and nothing moves. ${timeline.loop !== undefined && timeline.loop !== "none" ? "Its looping is not in the file either — scrolling back is what plays it backwards. " : ""}Nothing here is scripted; the whole of it is five declarations and a custom property.`,
				);
				continue;
			}
			// `linear` in the shorthand on purpose: each stop carries its own
			// `animation-timing-function`, which is what a per-keyframe easing means
			// in CSS, and a curve in the shorthand would be applied *on top of* those
			// rather than instead of them.
			animations.set(nodeId, {
				...(animations.get(nodeId) ?? {}),
				animation: `${name} ${ms(length)} linear 0ms ${loop.count} ${loop.direction} both`,
			});
		}
	}
	return animations;
}

/** Where the timelines of one document accumulate while they are being read. */
export interface Played {
	keyframes: string[];
	/** `animation:` for a node whose state is the one the picture is drawn in. */
	playing: Map<string, Declarations>;
	/** Every `@keyframes` name taken so far, so two of them cannot collide. */
	names: Set<string>;
}

/**
 * One part's tracks, as the body of a `@keyframes` block.
 *
 * The percentages are integers, which is what `rive-ladder-spec.md` §9.4 froze
 * and is coarser than it looks like it should be: 1% of a 200ms timeline is 2ms,
 * which no eye resolves, and a fractional percentage in a `@keyframes` selector
 * is legal but is a number nobody reading the file can check against the panel.
 * Where the rounding is not exact the loss says so, and where two keyframes round
 * onto one percentage the later one wins and the loss says that too — both are
 * facts about *this* timeline rather than about the format, so neither is said
 * about a document where they do not happen.
 *
 * `undefined` where the part's tracks come to no declarations at all, so the
 * caller emits no block and no `animation` rather than an empty one.
 */
export function keyframeBlock(
	timeline: Timeline,
	length: number,
	tracks: readonly PlayedTrack[],
	drawn: ModelNode,
	springs: Set<Easing>,
	say: (line: string) => void,
): string | undefined {
	const moving = tracks.filter((t) => movesTransform(t.track));
	// Every moment any transform track has a key at, because one `transform`
	// declaration has to answer for all of them at every stop it appears in.
	const moments = [...new Set(moving.flatMap((t) => t.keys.map((k) => k.at)))].sort(
		(a, b) => a - b,
	);
	if (
		moving.length > 1 &&
		moving.some((t) => t.keys.length !== moments.length)
	) {
		say(
			`When the parts of the move in “${timeline.name}” happen. Two tracks of one part both write the browser's one transform, and their keyframes are at different times — so the file states the whole pose at every one of those times, taking the in-between values as straight lines. A curve on a segment that another track subdivides is flattened inside it.`,
		);
	}

	/** Stop percentage -> what is declared there. */
	const stops = new Map<number, Declarations>();
	let rounded = false;
	let collided = false;
	let past = false;
	const stopAt = (at: number): Declarations => {
		if (at > length) past = true;
		const exact = (100 * Math.min(at, length)) / length;
		const percent = Math.round(exact);
		if (percent !== exact) rounded = true;
		const held = stops.get(percent);
		if (held !== undefined) collided = true;
		const made = held ?? {};
		stops.set(percent, made);
		return made;
	};

	for (const played of tracks) {
		const { track } = played;
		if (movesTransform(track)) continue;
		for (const key of played.keys) {
			if (key.value === undefined) continue;
			const at = stopAt(key.at);
			if (track.dim === "width" || track.dim === "height") {
				at[track.dim] = cssLength(key.value);
				continue;
			}
			if (track.dim === "depth") {
				// A `div` has no thickness — see `moveDeclarations`, which says the same
				// thing about the same number. Silently nothing rather than a loss:
				// there is nothing on the canvas either.
				continue;
			}
			if (track.prop !== undefined) {
				const paint = paintFor(drawn.kind, track.prop);
				if (paint) Object.assign(at, paint(cssValue(track.prop, key.value)));
			}
			Object.assign(at, easingAt(played, key, springs));
		}
	}

	for (const at of moments) {
		const stop = stopAt(at);
		// A translation is a **delta** from where the element already is, because
		// `left` and `top` are absolute in the rule this animation runs on top of —
		// the same basis `moveDeclarations` writes a state's move in, so a timeline
		// and a state that both move a part agree about where zero is. A track that
		// says nothing about an axis leaves that axis where the picture has it,
		// which for x and y is a delta of nothing.
		const placed = (dim: "x" | "y"): Emu => {
			const sampled = sampleAt(keysOf(moving, dim), emuOf, at);
			return sampled === undefined ? 0 : sampled - drawn.frame[dim];
		};
		const dx = placed("x");
		const dy = placed("y");
		const z = sampleAt(keysOf(moving, "z"), emuOf, at) ?? drawn.spatial?.z ?? 0;
		const turn = { ...(drawn.turn ?? { rotateX: 0, rotateY: 0, rotateZ: 0 }) };
		for (const name of TURN_NAMES) {
			const sampled = sampleAt(turnKeys(moving, name), mdegOf, at);
			if (sampled !== undefined) turn[name] = sampled;
		}
		stop.transform = transformOf(dx, dy, z, turn) ?? "none";
		for (const played of moving) {
			const key = played.keys.find((k) => k.at === at);
			if (key) Object.assign(stop, easingAt(played, key, springs));
		}
	}

	if (stops.size === 0) return undefined;
	if (rounded) {
		say(
			`Exactly when each keyframe of “${timeline.name}” lands. A CSS keyframe is a whole percentage of the animation, so a key that falls between two of them is written at the nearer one — at most half a percent of ${ms(length)} out.`,
		);
	}
	if (collided) {
		say(
			`Two keyframes of “${timeline.name}” land on the same whole percentage of it, and a stylesheet has one stop there. The later one is what is in the file.`,
		);
	}
	if (past) {
		say(
			`A keyframe of “${timeline.name}” is past the end of it — the timeline is ${ms(length)} long and says so — so the file holds that key at the end rather than beyond it, which is where the canvas holds it too.`,
		);
	}
	return [...stops.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([percent, declarations]) => rule(`${percent}%`, declarations, "\t"))
		.filter((text) => text !== "")
		.join("\n");
}

/** The keys of the one track about a dimension, or none. */
export const keysOf = (tracks: readonly PlayedTrack[], dim: string): PlayedKey[] =>
	tracks.find((t) => t.track.dim === dim)?.keys ?? [];

/** The same, for a rotation. */
export const turnKeys = (tracks: readonly PlayedTrack[], turn: Turn): PlayedKey[] =>
	tracks.find((t) => t.track.turn === turn)?.keys ?? [];

/**
 * The curve leaving one keyframe, as the declaration CSS reads it with.
 *
 * `animation-timing-function` inside a stop paces the segment *leaving* that
 * stop, which is exactly what {@link Keyframe.easing} means and why the last
 * keyframe's is read by nothing here as it is read by nothing anywhere else. The
 * default is left out rather than written: `ease-out` on every stop of every
 * block is the same animation and several hundred more bytes.
 */
export function easingAt(
	played: PlayedTrack,
	key: PlayedKey,
	springs: Set<Easing>,
): Declarations {
	const last = played.keys[played.keys.length - 1];
	if (key === last) return {};
	if (key.easing === DEFAULT_EASING) return {};
	// The same `var()`-or-itself decision a transition's curve gets, through the
	// same function: a keyframe may name a spring exactly as a transition may, and
	// a sixty-five-stop `linear()` written into every stop of every block would be
	// several hundred bytes per keyframe rather than per document.
	const { easing, spring } = timingFunction(key.easing);
	if (spring !== undefined) springs.add(spring);
	return { animationTimingFunction: easing };
}

/**
 * Every machine in the document, as selectors over the base layer.
 *
 * The public reading, for a caller that wants the states without the file. It
 * keeps token names — that is what an export does unless asked otherwise — and
 * collects the tokens it named into a set it then drops, because a caller holding
 * one layer has nowhere to put a `:root` block. {@link htmlExport} calls the
 * planner directly for exactly that reason.
 */
export function exportMachines(scene: Scene, base: Layer): MachineExport {
	return planMachines(indexDocument(scene), base, true, new Set());
}

