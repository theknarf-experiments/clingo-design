/**
 * A state, as a selector.
 *
 * HTML's alone. An SVG has no states, and says so once about the format rather
 * than once per machine in the document.
 */
import type {
	Declarations,
	Easing,
	Machine,
	MachineState,
	ModelNode,
	ModelScene,
	ModelState,
	NodeKind,
	Picks,
	PropName,
	SceneNode,
	StatePart,
	Token,
	Transition,
	Value,
} from "@clingo-design/design-core";
import {
	DEFAULT_EASING,
	DIMENSIONS,
	DRAG_SLOP_PX,
	EASINGS,
	EASING_NAMES,
	KINDS,
	MEASURED_PROPS,
	SURFACE_BOX,
	TIMELINE_CLOCKS,
	TRIGGERS,
	TURN_NAMES,
	autoSizes,
	clockOf,
	cssEasing,
	cssName,
	cssValue,
	easingOf,
	instanceNodes,
	instancePart,
	layerInitial,
	layerStates,
	machineForNode,
	machineLayers,
	machineTable,
	motionMs,
	paintFor,
	propVar,
	runtimeScript,
	springOf,
	stateName,
	statePart,
	statePropVar,
	transitionExit,
} from "@clingo-design/design-core";

import type {
	DocIndex,
	ExportResult,
	Layer,
} from "@clingo-design/export-core";
import {
	docNode,
	drawnStates,
	px,
	tokenNamed,
	valueNamed,
} from "@clingo-design/export-core";
import { liftOf, transformOf } from "./depth.ts";
import { diff } from "./html.ts";
import type { Played } from "./timeline.ts";
import { playTimelines } from "./timeline.ts";

/* ------------------------------------------------------------------ */
/* A state, as a selector                                              */
/* ------------------------------------------------------------------ */

/*
 * **Why this is not `collapseSpace`, and must never be routed through it.**
 *
 * The two mechanisms both end up emitting extra CSS rules on top of a base
 * layer, which is the whole of what they have in common, and it is a coincidence
 * of the medium rather than a shared idea. Collapsing a space takes N *universes*
 * — N different answers to a question the document asked, each a complete design
 * — and folds them into one file under a condition the browser evaluates
 * (`prefers-color-scheme`, a width). It is allowed to do that only where the
 * document says which universe is which, which is why `collapseSpace` spends most
 * of its length refusing.
 *
 * A machine's states are not universes and there is nothing to refuse. Every
 * state of every instance is already in the *one* answer set beside the picture —
 * that is the invariant the whole feature is built on, see `machines.ts` — so
 * there is no choice being folded, no variable being switched, and no question
 * about which state is "the narrow one". The states of an instance are a matrix
 * cell beside its variant, not a point in a product of universes, and the two
 * compose exactly because they are separate: a themed export of a document with a
 * hover state has a media query *and* a `:hover` rule, and neither eats the
 * other.
 *
 * Stretching one mechanism over both would have broken the honest half. A state
 * routed through `collapseSpace` would have to pass `disagreements()`, which
 * compares `pick`s — and a state changes no pick at all, so every state would
 * read as "these universes make the same decisions" and collapse to nothing. Made
 * to pass, it would then have to be *refused* wherever the space is genuinely not
 * collapsible, which would mean a document that cannot be themed also cannot
 * hover. There is no version of one function that is right about both.
 *
 * So: two mechanisms, one file, and the layering below is deliberate. The base
 * rules are the picture. The collapse's layers, if any, are conditional
 * *redefinitions* of that picture. The state rules come last and are the only
 * thing in the file with real selector weight, because a state is meant to win
 * over whatever the picture currently says — which is the exact opposite of what
 * a style class is for, and why they are wrapped in `:where()` and these are not.
 */

/**
 * One state of one machine, as the selector a stylesheet switches on.
 *
 * Not a {@link Layer}: a layer is a whole universe under a media query, and a
 * state is the same universe under a different selector on one element.
 */
export interface StateLayer {
	machine: string;
	/** The instance's node id, whose element carries the selector. */
	instance: string;
	state: string;
	/**
	 * Which layer of the machine this state belongs to.
	 *
	 * A machine is in one state **per layer**, all at once, so an instance's
	 * element carries one attribute per layer and a state's selector has to say
	 * which one it is switching on. A machine the document gave no layers has
	 * exactly one, called `base`, which {@link machineLayers} mints — so this
	 * field is never empty and a one-layer document reads as the un-layered one
	 * it is.
	 */
	layer: string;
	/**
	 * What is appended to the instance's own class selector: `":hover"`,
	 * `":active"`, `":focus-visible"`, `'[data-state="open"]'`, or
	 * `'[data-state-glow="lit"]'` for a layer that is not the first.
	 *
	 * The first layer writes plain `data-state` and every further one writes
	 * `data-state-<layer>`, which is exactly what the emitted runtime does — and
	 * the asymmetry is the whole reason it does: a one-layer file is byte
	 * identical to the one that shipped before layers existed.
	 */
	on: string;
	/** Per node id, only what this state changes from the base. */
	changed: Map<string, Declarations>;
	/** `transition:` to put on each changed node's *base* rule. */
	transitions: Map<string, Declarations>;
	label: string;
}

export interface MachineExport {
	layers: StateLayer[];
	/**
	 * The `@keyframes` blocks a timeline came out as, ready to be written into
	 * the stylesheet — one per (instance, timeline, part).
	 *
	 * Beside {@link layers} rather than inside one, because a `@keyframes` block
	 * is not a rule and has no selector: it is a *named* thing the `animation`
	 * declaration on a state's rule points at, and it has to be written once at
	 * the top level however many states or layers reference it.
	 */
	keyframes: string[];
	/**
	 * `animation:` for a node the *drawn* state animates, by node id.
	 *
	 * Beside {@link layers} for the reason {@link StateLayer.transitions} is: it
	 * belongs on the node's own base rule, and merging it into the base
	 * declarations before the collapse's `diff()` runs would have every theme and
	 * every breakpoint say `animation: unset` — the machine and the collapse
	 * eating each other, which is exactly the composition this file promises they
	 * do not.
	 */
	playing: Map<string, Declarations>;
	/** The `<script>` body, or null where every state is a pseudo-class. */
	runtime: string | null;
	/** What the file does not carry — appended to {@link ExportResult.lost}. */
	lost: string[];
	/**
	 * The springs any emitted declaration referred to, so the stylesheet can
	 * define their custom properties and the `@supports` block that upgrades
	 * them.
	 *
	 * A spring is a `linear()` with sixty-five stops in it, and it cannot be
	 * written inline. `linear()` is Baseline 2023, and a browser that cannot parse
	 * it treats the whole declaration as invalid and **drops it** — which, because
	 * this file writes the `transition` *shorthand*, takes the duration and the
	 * delay with it, so the state would not tween at all, it would snap. That is a
	 * worse failure than an approximate curve, so a fallback is mandatory.
	 *
	 * The obvious idiom — two `transition` declarations, one plain and one inside
	 * `@supports` — cannot be written here: {@link Declarations} is
	 * `Record<string, string>` and one key is one property, so two `transition`
	 * declarations for one node would be one declaration, the later of the two.
	 * Rewriting that record into a list of pairs is a change to every emitter in
	 * this file for the sake of three curves. So the curve goes into a custom
	 * property defined twice, and the declaration says `var(--dc-ease-…)`, which
	 * substitutes *before* the shorthand is parsed and is therefore one key.
	 *
	 * A **set collected during the walk** rather than a scan of the document
	 * afterwards, for the reason `used` is a single set: a spring named by a
	 * `curve` token in a hover state has to reach `:root` like any other named
	 * thing, and a second collection reconciled later is how one goes missing.
	 * Only springs are in here; a plain curve and a custom bezier are written
	 * inline, because they are short and every browser parses them.
	 */
	springs: Set<Easing>;
	/**
	 * The `@keyframes` names whose `animation-name` is gated behind
	 * `@supports (animation-timeline: view())`, so the stylesheet can define the
	 * custom property that carries them.
	 *
	 * A scroll-clocked timeline is four longhands and a `var()` where an
	 * unclocked one is the `animation` shorthand, and the `var()` is not
	 * decoration: `animation-timeline` is Chrome/Edge 115 and Firefox 144, Safari
	 * has no `view()` yet, and a browser that ignores the declaration would
	 * otherwise play the animation **once, on load**, before the element is
	 * anywhere near the viewport. That is motion at the wrong moment, which reads
	 * to a person as a bug, where a still element reads as a design. So the name
	 * itself is what the `@supports` block switches on, and a browser without the
	 * feature gets `animation-name: none`.
	 *
	 * The custom property rather than the whole rule inside `@supports`, for
	 * {@link springs}' reason exactly and it is worth having said once: {@link
	 * Declarations} is `Record<string, string>`, one key is one property, and a
	 * rule split across an `@supports` boundary cannot live in that shape without
	 * turning every declaration map in this file into a list of blocks.
	 *
	 * A **set collected during the walk**, beside `springs` and threaded with it.
	 */
	scrolled: Set<string>;
}

/**
 * Which pseudo-class a state collapses to, or nothing where it needs the script.
 *
 * The test is deliberately strict, and every clause of it is protecting the same
 * claim: that `.n6:hover .n7 { … }` is *the whole behaviour*, with nothing left
 * over that a reader of the file would have to be told about. CSS has no memory,
 * so a pseudo-class can only stand for a state the browser is already tracking
 * for us — which means the state has to be entered exactly one way, left exactly
 * one way, and the two ways have to be the two halves of one condition.
 *
 *   - **exactly one enabled edge in, from the base state, on a trigger CSS has a
 *     name for.** Two ways in means the state is reached from somewhere the
 *     pseudo-class knows nothing about.
 *   - **exactly one enabled edge out, back to the base state, on that trigger's
 *     pair.** `pointerenter` in and `click` out is a state you enter by hovering
 *     and leave by clicking, and `:hover` would leave it the moment the pointer
 *     did — which is a different machine from the one that was drawn.
 *   - **nothing else touches it.** Any other edge is behaviour the file would be
 *     silently dropping.
 *
 * `TRIGGERS[g].css` and `.pair` are read off the table rather than decided here,
 * so a new trigger with a pseudo-class is one entry in `scene.ts` and no change
 * at all in this file.
 */
export function pseudoClassFor(
	machine: Machine,
	layer: string,
	base: string,
	state: string,
): string | null {
	// This layer's own edges, and only its own. A cross-layer edge is a thing the
	// program reports (`mcrosslayer/2`) and the runtime table leaves out, so
	// counting one here would refuse a collapse on the strength of an edge that
	// cannot fire — and on a one-layer machine the filter is the identity, which
	// is why every existing file is byte for byte what it was.
	const own = layerStates(machine, layer).map((s) => s.id);
	const enabled = machine.transitions.filter(
		(t) => t.enabled && own.includes(t.from) && own.includes(t.to),
	);
	const into = enabled.filter((t) => t.to === state);
	const outOf = enabled.filter((t) => t.from === state);
	if (into.length !== 1 || outOf.length !== 1) return null;
	const [enter] = into;
	const [leave] = outOf;
	if (enter.from !== base || leave.to !== base) return null;
	const spec = TRIGGERS[enter.trigger];
	if (spec.css === null || spec.pair !== leave.trigger) return null;
	return `:${spec.css}`;
}

/**
 * The `animation-timeline` a state's timeline is driven by, or nothing where it
 * runs on wall time.
 *
 * Deliberately shaped as {@link pseudoClassFor}'s twin, and placed beside it,
 * because it is the same question: **is there a CSS shape for what this machine
 * says?** That function answers with a pseudo-class where the trigger pair has
 * one and with a data-state rule where it has not; this one answers with a scroll
 * timeline where the clock has one and with wall time where it has not. Neither
 * is a feature the document knows about — the document says one thing, and the
 * export finds the CSS-native path where there is one.
 *
 * That parallel is the whole argument for putting a scroll-linked effect on the
 * state that already plays a timeline: it is not a new concept in this file, it
 * is a second instance of the one this file is built around. The alternative
 * considered and refused — scroll progress as a number input driving a 1D blend —
 * would have needed a keyframe sampler inside `runtime.ts`, which is the
 * two-implementations-that-drift problem that file exists to prevent, and it
 * would not have worked anyway: a 1D blend is a *selector* over whole timelines
 * and returns no time, so wiring the scroll to it gives a crossfade with a
 * stopped clock rather than a parallax.
 */
export function scrollTimelineFor(state: MachineState): string | null {
	return TIMELINE_CLOCKS[clockOf(state)].css;
}

/**
 * Everything one state copy paints, with a token the document named kept as one.
 *
 * The twin of {@link declarationsFor}, over a {@link ModelState} instead of a
 * {@link ModelNode}, and it is a second function rather than a shared one for a
 * reason that is not laziness: a state copy has no kind of its own — the copy is
 * a parallel *description*, and what it is is decided by the definition part,
 * which is a node of the picture and already says so — and it looks its token
 * names up in two places rather than one.
 *
 * Those two places are the whole of the invariant, showing through at the export:
 *
 *   - a property the state's delta answers has its own variable,
 *     `sprop(I,S,N,P)`, and the name is read from the delta's own {@link Value};
 *   - a property the state says nothing about is read from the *instance's* one
 *     shared `prop(inst(I,N),P)` — the same variable every other state of the
 *     same instance reads, which is why four states of a two-alternative fill are
 *     two designs and not sixteen.
 *
 * Getting that order wrong in either direction is a wrong file rather than an
 * untidy one: reading the instance's variable for a property the state overrode
 * would name the token the *base* wears while writing the state's colour beside
 * it, which is a stylesheet that lies about its own design system.
 *
 * The kind's constant furniture — {@link SURFACE_BOX}, a shape's `box` — is
 * deliberately absent. Every copy of one part has the same kind and so the same
 * furniture, so it is identical on both sides of every diff this feeds and would
 * cancel; and the base rule the state sits on top of already carries it.
 */
export function copyPaint(
	index: DocIndex,
	layer: Layer,
	kind: NodeKind,
	instance: string,
	part: string,
	state: string,
	delta: StatePart | undefined,
	copy: ModelState,
	useTokens: boolean,
	used: Set<string>,
): Declarations {
	const out: Declarations = {};
	for (const prop of KINDS[kind].props) {
		const value = copy.rendered[prop];
		if (value === undefined) continue;
		const paint = paintFor(kind, prop);
		if (!paint) continue;
		const said = delta?.props?.[prop];
		const token = !useTokens
			? undefined
			: said !== undefined && said.length > 0
				? valueNamed(
						index,
						layer.universe.pick,
						said,
						statePropVar(instance, state, part, prop),
					)
				: tokenNamed(
						index,
						layer.universe.pick,
						propVar(instancePart(instance, part), prop),
					);
		if (token) {
			used.add(token.id);
			Object.assign(out, paint(`var(--${index.custom.get(token.id)})`));
		} else {
			Object.assign(out, paint(cssValue(prop, value)));
		}
	}
	return out;
}

/**
 * Which CSS properties a transition names, filtered by the transition's `only`.
 *
 * `display` is struck out unconditionally and that is not a filter, it is the
 * truth: there is nothing between shown and not shown to interpolate, so naming
 * it would produce a `transition` declaration a browser ignores and a reader
 * believes. The loss says so out loud instead.
 *
 * An `only` list is {@link PropName}s and the changed set is CSS keys, so the
 * translation goes through {@link paintFor} — the same table the declarations
 * came out of, asked the same question — rather than through a second mapping
 * that could disagree with the first. Geometry survives no `only` list at all,
 * because a frame dimension is not a `PropName` and never will be: "only tween
 * the fill" is a sentence about paint, and a designer who wrote it did not mean
 * to keep the box moving.
 */
export function tweenedKeys(
	kind: NodeKind,
	only: readonly PropName[] | undefined,
	changed: Declarations,
): string[] {
	// `animation` is struck out beside `display` and for a sibling reason: it is
	// not a value between two states, it is a *schedule*, and `transition:
	// animation` is a declaration a browser ignores and a reader believes. What
	// paces a timeline is the timeline.
	//
	// `background-image` is the third, and it is the gradient's own limitation:
	// CSS does not interpolate one background image into another, it swaps them
	// at the halfway point however long the transition says. Naming it would be a
	// declaration a browser accepts, does nothing visible with, and a reader
	// believes — `display`'s reason exactly. The gradient's two *colours* are not
	// struck out, because they are registered custom properties with a `<color>`
	// syntax and genuinely tween: a change of colour is smooth and a change of
	// direction is a cut, which is what the loss beside this says out loud.
	const keys = Object.keys(changed).filter(
		(key) => key !== "display" && key !== "animation" && key !== "backgroundImage",
	);
	if (only === undefined) return keys.map(cssName);
	const allowed = new Set<string>();
	for (const prop of only) {
		const paint = paintFor(kind, prop);
		if (paint) for (const key of Object.keys(paint(""))) allowed.add(key);
	}
	return keys.filter((key) => allowed.has(key)).map(cssName);
}

/** A whole number of milliseconds as CSS writes one. */
export const ms = (n: number): string => `${Math.round(n)}ms`;

/**
 * How long a transition takes in *this* universe, and how it is paced.
 *
 * The answer set first, the document second, and the order matters: a duration
 * is a {@link Value}, so it may name a `duration` token whose alternatives the
 * solver picked between, and `mdur/3` is that pick resolved. The document reader
 * is the fallback for an answer set that was asked for without `scenery` — the
 * same reading, arrived at without the solver — rather than a second opinion.
 *
 * The curve is read the same way round and for the same reason, which is new:
 * it used to be a bare word on the transition and a lookup in `EASINGS`, so
 * there was nothing for a universe to have an opinion about. `measing/3` is the
 * pick resolved, and an easing that names a `curve` token the solver chose
 * between resolves to nothing without a context — which is the bug
 * `machineTable`'s own `context` parameter was added to close, arriving one
 * field over.
 */
export function pacing(
	model: ModelScene,
	machine: Machine,
	transition: Transition,
	picks: Picks,
	tokens: readonly Token[],
): {
	duration: number;
	delay: number;
	stagger: number;
	/** Ready to write: a timing function, or `var(--dc-ease-<spring>)`. */
	easing: string;
	/** The spring the caller must add to {@link MachineExport.springs}, if any. */
	spring?: Easing;
} {
	const said = model.machines[machine.id];
	const context = { tokens, picks };
	const read = (prop: "duration" | "delay" | "stagger"): number =>
		said?.[prop][transition.id] ?? motionMs(machine, transition, prop, context);
	const curve = said?.easing[transition.id] ?? easingOf(machine, transition, context);
	return {
		duration: read("duration"),
		delay: read("delay"),
		stagger: read("stagger"),
		...timingFunction(curve),
	};
}

/**
 * A resolved curve as the two things a caller writing a declaration needs: the
 * text to put in the shorthand, and the spring to remember.
 *
 * One function and two call sites — a transition's `transition:` and a
 * keyframe's `animation-timing-function` — because "a spring is a `var()` and
 * everything else is itself" is one sentence and two copies of it would drift
 * the first time a fourth spelling arrived. A curve neither reader knows takes
 * the default, which is the same answer `measing/3` gives through
 * `not mreadsease(M,T)`.
 */
export function timingFunction(curve: string): { easing: string; spring?: Easing } {
	const spring = springOf(curve);
	if (spring !== undefined) {
		return { easing: `var(--dc-ease-${curve})`, spring: curve as Easing };
	}
	return { easing: cssEasing(curve) ?? EASINGS[DEFAULT_EASING].css };
}

/**
 * The two blocks a document with springs in it needs at the top of its
 * stylesheet, or nothing at all where it has none.
 *
 * Two definitions of one custom property: the plain one every browser takes, and
 * the sampled `linear()` inside `@supports`, which every browser that can parse
 * it prefers because it is later and equally specific. Emitted once per document
 * after the `:root` block that carries the token custom properties and before the
 * layer blocks — see the stylesheet order in `docs/framer-parity-plan.md` §5.6.
 *
 * Written as text rather than as a {@link Declarations} record for the reason
 * {@link MachineExport.springs} gives at length: a rule split across an
 * `@supports` boundary cannot live in a `Record<string, string>` where one key
 * is one property. A document that uses no spring emits **neither block** and is
 * byte-identical to what it exported before this feature existed, which is the
 * no-regression claim and is asserted by name.
 */
export function springRules(springs: ReadonlySet<Easing>): string[] {
	if (springs.size === 0) return [];
	// In menu order rather than in the order the walk found them: a stylesheet is
	// a thing people diff, and "the order two states happened to be visited in" is
	// not an order anybody asked for.
	const named = EASING_NAMES.filter((id) => springs.has(id));
	const fallback = named.map(
		(id) => `\t--dc-ease-${id}: ${EASINGS[id].spring?.fallback ?? EASINGS[DEFAULT_EASING].css};`,
	);
	const sampled = named.map((id) => `\t\t--dc-ease-${id}: ${EASINGS[id].css};`);
	return [
		`:root {\n${fallback.join("\n")}\n}`,
		`@supports (transition-timing-function: linear(0, 1)) {\n\t:root {\n${sampled.join("\n")}\n\t}\n}`,
	];
}

/**
 * The edge a state is entered by, which is the one whose pacing the file writes.
 *
 * Preferring the edge from the base state because that is the move a reader of
 * the exported page will actually make: the base is what the file draws, so
 * "going into hover" is the transition being described. Anything else entering
 * the state is a fallback so that a state reached only from elsewhere still gets
 * paced rather than snapping.
 */
export function entryEdge(
	machine: Machine,
	base: string,
	state: string,
): Transition | undefined {
	const enabled = machine.transitions.filter((t) => t.enabled && t.to === state);
	return enabled.find((t) => t.from === base) ?? enabled[0];
}

/** True where a kind draws its real geometry inside its box — see {@link drawnGeometry}. */
export const drawsOwnGeometry = (kind: NodeKind): boolean =>
	KINDS[kind].diagonal || KINDS[kind].plotted;

/** A phrase for a node in the losses: its name where the document has one. */
export function nodeLabel(index: DocIndex, id: string): string {
	const doc = docNode(index, id);
	return doc ? `${KINDS[doc.kind].label} “${doc.name}”` : `“${id}”`;
}

/**
 * Every machine in the document, as selectors over the base layer.
 *
 * The signature this file's callers use is {@link exportMachines}; this is the
 * same work with the two things the HTML emitter has and a bare caller does not —
 * whether token names are wanted, and the set of tokens the file has ended up
 * using, which a state naming one has to be able to add to. Splitting them is
 * what keeps `used` a single set: a `duration` token pointed at by a hover state
 * has to reach `:root` like any other, and a second collection reconciled
 * afterwards is how one would go missing.
 */
export function planMachines(
	index: DocIndex,
	base: Layer,
	useTokens: boolean,
	used: Set<string>,
): MachineExport {
	const model = base.universe.model;
	const layers: StateLayer[] = [];
	const played: Played = { keyframes: [], playing: new Map(), names: new Set() };
	const lost: string[] = [];
	const say = (line: string): void => {
		if (!lost.includes(line)) lost.push(line);
	};
	// Beside `used` and threaded exactly as `used` is, because it is the same kind
	// of thing: a name an emitted declaration referred to, which the stylesheet
	// then has to define at the top of the file. Collected during the walk rather
	// than scanned for afterwards, for `used`'s reason — a spring a `curve` token
	// named in a hover state is a spring only the walk ever sees.
	const springs = new Set<Easing>();
	// And its twin, for the same reason and threaded the same way: the gated
	// `@keyframes` names, which only the walk that emitted the `var()` ever sees.
	const scrolled = new Set<string>();
	let scripted = false;
	const context = { tokens: index.scene.tokens, picks: base.universe.pick };

	for (const node of instanceNodes(index.scene)) {
		const machine = machineForNode(index.scene, node);
		if (!machine || machine.states.length === 0) continue;
		if (!model.byId[node.id]) continue;
		const stack = machineLayers(machine);
		const drawn = drawnStates(model, machine, node, stack[0].id);

		// What a gesture costs, said once per machine rather than once per state,
		// because it is one fact about the machine and a designer reading six copies
		// of it learns nothing on the sixth.
		//
		// Two sentences and the second is the one nobody expects: **the element does
		// not move with the pointer.** A drag trigger says the machine is now in the
		// dragging state; it does not carry the pointer's position, and making it do
		// so would be a `transform` written on every pointermove by a script — the
		// second animator arguing with the compositor that `runtime.ts` refuses. A
		// designer who wants the thing to follow the finger wants a pointer-driven
		// number input, which is deliberately not built.
		//
		// The threshold and the it-does-not-follow-your-finger sentence are
		// conditional on a *drag*, and that is not tidiness. There are two sources
		// and a machine that only reveals on scroll would otherwise be told how far
		// a pointer has to travel and what a drag does not do, about a gesture it
		// has not got — which is how a losses list stops being read.
		const gestured = machine.transitions.filter(
			(t) => t.enabled && TRIGGERS[t.trigger].source !== undefined,
		);
		const gestures = [...new Set(gestured.map((t) => TRIGGERS[t.trigger].label.toLowerCase()))];
		if (gestures.length > 0) {
			const dragged = gestured.some((t) => TRIGGERS[t.trigger].source === "drag");
			say(
				`“${machine.name}” moves on a gesture — ${gestures.join(", ")} — and CSS has no name for any of them, so those states are \`data-state\` rules and the file carries the interpreter that switches them.${dragged ? ` A drag is a pointer that moved more than ${DRAG_SLOP_PX} pixels while down, which is the same threshold the canvas uses. What the file does **not** do is move the element with the pointer: a drag trigger says which state the machine is in, and what that state looks like is your design.` : ""}`,
			);
		}

		for (const [index_, stratum] of stack.entries()) {
			const drawnIn = drawn[stratum.id];
			// A layer with no states at all is a layer somebody has just added. There
			// is nothing to draw it in and nothing to switch to, and `shownStates`
			// says so by leaving it out rather than by naming nothing.
			if (drawnIn === undefined) continue;
			const first = index_ === 0;
			const init = layerInitial(machine, stratum.id)?.id;
			// The state the *picture* is in, which is the state this file's own rules
			// are. §8.1 of the spec asks for the machine's initial state instead and
			// re-seated base rules to get there; this does the nearer-correct thing and
			// says so. Two reasons, and the second is the one that decided it. A file
			// whose base is a state the runtime immediately writes over shows the wrong
			// design until the script runs, which is a flash of the wrong colour on
			// every load. And where the two differ the collapse to a pseudo-class is not
			// available anyway — `:hover` can add a state to what is drawn, never
			// subtract one — so re-seating would have bought a flash and nothing else.
			// Where the instance is drawn in the initial state, which is every document
			// that does not say otherwise, the two readings are the same reading.
			if (init !== undefined && drawnIn !== init) {
				say(
					`“${node.name}” is drawn in ${stateName(machine, drawnIn)}, so that is the state this file's own rules are and the one it starts in. Every other state of “${machine.name}” — the machine's initial one included — is a data-state rule rather than a pseudo-class, because a selector can add to what is drawn and cannot subtract from it.`,
				);
			}

			for (const state of layerStates(machine, stratum.id)) {
				// The timeline first, because what it comes to is an `animation`
				// declaration on the same elements the delta paints — so it is one more
				// thing this state changes, and a state that changes *only* an
				// animation is still a state the file has to be able to select.
				const played_ = playTimelines(
					base,
					machine,
					node,
					state,
					context,
					played,
					springs,
					scrolled,
					say,
				);
				if (state.id === drawnIn) {
					// The state the picture is in has no selector of its own — it is what
					// the base rules are — so an animation it plays goes on the base rule
					// and is running the moment the file opens.
					for (const [id, declarations] of played_) {
						played.playing.set(id, { ...(played.playing.get(id) ?? {}), ...declarations });
					}
					continue;
				}
				const layer = stateLayerFor(
					index,
					base,
					machine,
					node,
					stratum.id,
					first,
					drawnIn,
					state,
					useTokens,
					used,
					springs,
					say,
					played_,
				);
				if (!layer) continue;
				if (!layer.on.startsWith(":")) scripted = true;
				layers.push(layer);
			}
		}
	}

	return {
		layers,
		keyframes: played.keyframes,
		playing: played.playing,
		// One script for the whole document, or none at all. The table already holds
		// every machine, so a second data-state layer costs nothing; and a document
		// whose states all collapsed to pseudo-classes gets no `<script>` tag,
		// which is the case the pseudo-class rules exist to produce.
		//
		// **The universe's own context**, and it is the same `context` the exit-time
		// sentence a few lines up already reads with. Built without one, the table's
		// only resolved number — an edge's exit time — silently became zero wherever
		// a document paced its debounce with a `duration` token, so this file
		// announced a wait in its losses and shipped a runtime that did not wait.
		// One reading, one answer.
		runtime: scripted ? runtimeScript(machineTable(index.scene, context)) : null,
		lost,
		springs,
		scrolled,
	};
}

/**
 * The two blocks a document with a scroll-clocked timeline needs at the top of
 * its stylesheet, or nothing at all where it has none.
 *
 * {@link springRules}' sibling, written the same way and emitted beside it, and
 * the pairing is structural rather than aesthetic: both are one logical
 * declaration that has to exist twice — once plainly and once behind
 * `@supports` — and {@link Declarations} cannot hold either, because one key is
 * one property and a rule split across an at-rule boundary is two blocks. So
 * both hoist the conditional part into a custom property on `:root`, where it is
 * one line, and leave the node's own rule a flat set of declarations.
 *
 * The plain definition is `none`, which is a legal `animation-name` meaning
 * nothing plays — so a browser without `animation-timeline` shows the state's
 * own pose and no motion. That is the honest degradation and it is argued for
 * where the gate is written; a document with no clock in it emits **neither
 * block** and is byte-identical to what it exported before.
 *
 * **One gate for both clocks**, and `view()` is what it tests even where the
 * only clock in the document is `scroll(root block)`. The two functions are one
 * feature and shipped together in every engine that has either — Chrome and Edge
 * 115, Firefox 144 — so a second `@supports` would be a second block that can
 * never disagree with the first, and one block is one line for a reader to
 * check. If an engine ever ships one without the other, this is the line that
 * has to grow a second gate keyed on {@link TIMELINE_CLOCKS}`[c].css`.
 *
 * And the whole of it is worth nothing without one thing this function cannot
 * say: **no box between the animated element and the page may be a scroll
 * container.** `view()` is the element's pass through its *nearest* scrollport,
 * so a clipping ancestor that clips with `overflow: hidden` becomes that
 * scrollport and freezes the animation at a constant with every declaration here
 * still perfectly correct. That is why a surface clips with `overflow: clip` —
 * `paint.ts`'s `CLIP` carries the argument, and `export.test.ts` asserts it in
 * the same test as this block.
 */
export function timelineRules(scrolled: ReadonlySet<string>): string[] {
	if (scrolled.size === 0) return [];
	// Sorted, for `springRules`' reason: a stylesheet is a thing people diff, and
	// "the order the walk happened to visit two states in" is not an order
	// anybody asked for.
	const names = [...scrolled].sort();
	const off = names.map((name) => `\t--dc-tl-${name}: none;`);
	const on = names.map((name) => `\t\t--dc-tl-${name}: ${name};`);
	return [
		`:root {\n${off.join("\n")}\n}`,
		`@supports (animation-timeline: view()) {\n\t:root {\n${on.join("\n")}\n\t}\n}`,
	];
}


/** One instance in one state, or nothing where the state changes nothing at all. */
function stateLayerFor(
	index: DocIndex,
	base: Layer,
	machine: Machine,
	instance: SceneNode,
	stratum: string,
	first: boolean,
	drawnIn: string,
	state: MachineState,
	useTokens: boolean,
	used: Set<string>,
	/** The springs this state's own pacing named — see {@link MachineExport.springs}. */
	springs: Set<Easing>,
	say: (line: string) => void,
	/** The `animation:` this state's timeline turns on, by node id — see {@link playTimelines}. */
	animations: ReadonlyMap<string, Declarations>,
): StateLayer | null {
	const model = base.universe.model;
	const changed = new Map<string, Declarations>(
		[...animations].map(([id, declarations]) => [id, { ...declarations }] as const),
	);
	const hiddenHere: string[] = [];

	// Whatever the answer set holds a copy of, which is the materialisation
	// analysis's answer arrived at from the other end. Reading `model.states`
	// rather than re-running `materializedParts` is deliberate: a hand-written rule
	// may describe a copy the analysis never minted, and the file should carry what
	// the picture actually says rather than what the document predicted it would.
	for (const copy of Object.values(model.states)) {
		if (copy.instance !== instance.id || copy.state !== state.id) continue;
		const nodeId = instancePart(instance.id, copy.part);
		const drawn = model.byId[nodeId];
		const from = model.states[statePart(instance.id, drawnIn, copy.part)];
		if (!drawn || !from) {
			// Two ways to get here and they share a cause — the part is not in the
			// picture, and a selector can restyle an element but cannot write one —
			// and then part company over what a person can do about it.
			//
			// The first way is the common one and it is the spec's own headline
			// example: the state this file is drawn in *hides* the part, so a
			// dropdown drawn in `closed` has no panel in its markup and its `open`
			// state finds nothing to restyle. The whole machine then exports inert,
			// which is a bad way to learn that the file is written from one state. It
			// has a one-click answer — draw the use in the state that shows the most
			// — so the loss says it rather than leaving a reader to deduce it.
			//
			// The second is a copy a rule minted for a part the instance does not
			// draw at all. There is nothing to re-seat and no state that would help,
			// so it gets the bare sentence.
			const hiddenThere = from?.hidden === true;
			say(
				`${stateName(machine, state.id)} describes “${copy.part}” of “${instance.name}”, which this design is not drawing. A selector can restyle an element and cannot write one, so that part of the state is not in the file.` +
					(hiddenThere
						? ` ${stateName(machine, drawnIn)} — the state this use is drawn in — takes it out of the picture, and the markup is written from that state. Draw this use in a state that shows “${copy.part}” and the rest of the machine follows it into the file.`
						: ""),
			);
			continue;
		}
		if (copy.hidden) {
			changed.set(nodeId, { display: "none" });
			hiddenHere.push(nodeId);
			continue;
		}
		const delta = state.parts[copy.part];
		if (!index.byId.has(copy.part)) {
			// A part the document has no node for: a rule minted this copy, and a
			// rule can do that — `frame(stt(i1,hover,x),y,10)` is as legal as any
			// other fact. What it cannot do is bring a *name* with it. Every token
			// name in this file is read back out of the document, because the program
			// interns literals and by the time a colour reaches `rendered/3` it is a
			// hex code; a copy the document has no account of therefore exports as
			// the literal. The same loss `ModelScene.wears`' derived wearers take,
			// one mechanism over.
			say(
				`${stateName(machine, state.id)} describes “${copy.part}”, which a rule made rather than the document. Its values are in the file as the literals they resolved to: there is no stored value to read a token name off, so a link to a token is not in this file under that name.`,
			);
		}
		// Asked before anything is diffed, because the answer is a fact about the
		// *document* rather than about the declarations — and because a state that
		// changes only the wording produces no declarations at all, so a check made
		// after the diff would fall silent in exactly the case it exists for.
		if ((delta?.props?.text?.length ?? 0) > 0) {
			say(
				`${stateName(machine, state.id)} changes the words in ${nodeLabel(index, nodeId)}. Text is markup and not a declaration — a selector can restyle an element and cannot rewrite it — so the file holds the wording the picture was drawn with.`,
			);
		}
		if (retypes(index, state, copy.part)) {
			say(
				`${stateName(machine, state.id)} restyles the words in ${nodeLabel(index, nodeId)}, and the file carries the box they come to in that state. What it does not carry is the frame around them: a container is not re-hugged per state, so words that outgrow their parent overflow it here exactly as they do on the canvas.`,
			);
		}
		const before = copyPaint(
			index,
			base,
			drawn.kind,
			instance.id,
			copy.part,
			drawnIn,
			machine.states.find((s) => s.id === drawnIn)?.parts[copy.part],
			from,
			useTokens,
			used,
		);
		const after = copyPaint(
			index,
			base,
			drawn.kind,
			instance.id,
			copy.part,
			state.id,
			delta,
			copy,
			useTokens,
			used,
		);
		const declarations = diff(before, after);

		const moved = DIMENSIONS.some((dim) => copy.frame[dim] !== from.frame[dim]);
		// The box moving and the box turning are two questions, and only the first
		// one is a problem for a kind that draws its own geometry: a `<line>`'s
		// coordinates are a function of its box, so a rule that resized the box
		// would slide the frame out from under a shape written once — but a
		// rotation and a lift leave the box exactly where it was and are a
		// `transform` on the element, which works on a line as well as on anything
		// else. So the refusal below is keyed on `moved` alone, and a turned arrow
		// falls through to the branch that writes the pose.
		if (moved && drawsOwnGeometry(drawn.kind)) {
			// The one geometry a class cannot carry, and it is named rather than
			// approximated for the same reason `collapseSpace` refuses it: a line, an
			// arrow and a path put their numbers in the markup — a `<line>`'s
			// coordinates, a `<path>`'s `d` — and the markup is written once, from
			// the picture. A rule that moved the box would slide the frame out from
			// under a shape that stayed where it was drawn.
			say(
				`${stateName(machine, state.id)} moves ${nodeLabel(index, nodeId)}, and a line, an arrow and a path draw their own geometry inside their box — that markup is written once, so this state is in the file as a class that cannot move it.`,
			);
		} else {
			// Unconditional, where it used to ask `moved` again: the box moving is
			// no longer the only way a pose can differ — a state may lift a part in
			// z or lean it without touching any of the four numbers — and
			// `moveDeclarations` already answers with nothing where nothing changed.
			Object.assign(declarations, moveDeclarations(from, copy));
		}
		if (Object.keys(declarations).length === 0) continue;
		// Merged rather than set, because the animation this state turns on is
		// already in here and is a declaration about the same element. The delta
		// wins where the two name one property, which is the right way round: a
		// timeline is what happens on the way in, a delta is what it settles at.
		changed.set(nodeId, { ...(changed.get(nodeId) ?? {}), ...declarations });
	}

	if (changed.size === 0) return null;
	if (hiddenHere.length > 0) {
		say(
			`${stateName(machine, state.id)} takes ${hiddenHere.map((id) => nodeLabel(index, id)).join(", ")} out of the picture. display:none is in the file and it is instant: there is nothing between shown and not shown for a transition to tween, however long the transition says.`,
		);
	}

	// The attribute the runtime actually writes, which is `data-state` for the
	// first layer and `data-state-<layer>` for every other one — see
	// `attributeOf` in `runtime.ts`, which is the other half of this and must not
	// be able to disagree with it. A one-layer machine therefore emits exactly the
	// selector it emitted before layers existed.
	const on =
		pseudoClassFor(machine, stratum, drawnIn, state.id) ??
		(first
			? `[data-state="${state.id}"]`
			: `[data-state-${stratum}="${state.id}"]`);
	return {
		machine: machine.id,
		instance: instance.id,
		state: state.id,
		layer: stratum,
		on,
		changed,
		transitions: transitionsFor(index, base, machine, drawnIn, state, changed, springs, say),
		label: `${machine.name} · ${stateName(machine, state.id)} on “${instance.name}”, as ${on}`,
	};
}

/**
 * A state that moves a box, written so the browser can move it cheaply.
 *
 * Solved geometry leaves this file as absolute `left`/`top` — that is what
 * `geometry()` writes and what {@link ExportResult.lost} already says about it —
 * and animating either of those is a layout on every frame. The *difference*
 * between two states is a translation, which the compositor does on its own
 * thread, so a state that moves a node writes the offset rather than the
 * coordinate. The base rule needs nothing at all for this to work: `transform`
 * starts at `none`, which interpolates against a translation as the identity.
 *
 * A size still leaves as `width`/`height`, and deliberately so. `scale` is the
 * compositor's answer to a size and it is a different picture — it stretches the
 * border, the corner radius and the words inside — so writing it would be
 * exporting a design nobody drew in exchange for a frame rate.
 */
function moveDeclarations(from: ModelState, to: ModelState): Declarations {
	const out: Declarations = {};
	const dx = to.frame.x - from.frame.x;
	const dy = to.frame.y - from.frame.y;
	// The three things a `transform` carries, asked separately, because whether to
	// write one at all is a different question from what to write in it. A
	// `transform` is one value: a state's rule does not *add* a rotation to the
	// base's translation, it replaces the whole declaration — so a state that
	// changes any part of the pose has to restate all of it, and a state that
	// changes none of it must say nothing rather than say `none` and quietly
	// un-turn a card that was leaning.
	const lifted = liftOf(to) !== liftOf(from);
	const turned = TURN_NAMES.some((name) => (to.turn?.[name] ?? 0) !== (from.turn?.[name] ?? 0));
	if (dx !== 0 || dy !== 0 || lifted || turned) {
		// `none` where the state's pose is the identity, which is what a state that
		// puts a turned part back flat means and the only way to say it.
		out.transform = transformOf(dx, dy, liftOf(to), to.turn) ?? "none";
	}
	if (to.frame.width !== from.frame.width) out.width = px(to.frame.width);
	if (to.frame.height !== from.frame.height) out.height = px(to.frame.height);
	// The depth is deliberately absent, and it is the one number of the six a flat
	// element has no meaning for: a `div` has a `width`, a `height` and a place on
	// the z axis, and no thickness. A state that changes only a rectangle's depth
	// therefore changes nothing in this file — which is true rather than lossy,
	// because it changes nothing on the canvas either.
	return out;
}

/**
 * True where this state changes something a hugging box is sized by.
 *
 * {@link MEASURED_PROPS} rather than a list written out here, because "what
 * changes how big the words are" is a question `measure.ts` already answers and
 * a second list is a second list to keep in step. {@link autoSizes} is the other
 * half: a part with a fixed size is not sized by its words, so restyling them
 * costs the file nothing worth naming.
 *
 * What this reports changed when `stateMeasures` was wired up. It used to mean
 * "the box in the file is the wrong one" — the copy carried the definition's
 * measurement whatever the state did to the type. Now the copy is measured in
 * its own state's typography and the box in the file is right, so the same
 * condition reports the one thing still missing: the *container* is not
 * re-hugged, because there is no `lask/3` for an instance's copy of a laid-out
 * definition for a per-state container arithmetic to be the second half of. See
 * the note on {@link stateMeasures}, which is where that exclusion is argued.
 */
function retypes(index: DocIndex, state: MachineState, part: string): boolean {
	const doc = index.byId.get(part);
	if (!doc || !autoSizes(doc)) return false;
	const delta = state.parts[part];
	return MEASURED_PROPS.some((prop) => (delta?.props?.[prop]?.length ?? 0) > 0);
}

/**
 * The `transition:` declaration each changed node's base rule takes.
 *
 * On the **base** rule rather than on the state's, which is what makes one
 * declaration pace the move in both directions: a rule that only exists while the
 * pointer is over the button cannot describe the move away from it. The price is
 * that a machine whose two edges are paced differently gets one of the two, and
 * the loss says which.
 *
 * The stagger is folded into each node's own delay here rather than left for
 * something at run time to schedule, and that is the whole reason the exported
 * runtime has no timers in it. A `transition-delay` is the browser's own
 * scheduler, on the compositor, exact and interruptible; a script counting
 * milliseconds beside it would apply the same delay twice and turn a rhythm into
 * a stutter. Which node is "first" is `order/2` — the paint order, which is the
 * only sequence the document actually states — with the id as the same tie-break
 * `byOrder` uses, so the rhythm is a property of the design rather than of the
 * order a map happened to be built in.
 */
function transitionsFor(
	index: DocIndex,
	base: Layer,
	machine: Machine,
	drawnIn: string,
	state: MachineState,
	changed: ReadonlyMap<string, Declarations>,
	springs: Set<Easing>,
	say: (line: string) => void,
): Map<string, Declarations> {
	const out = new Map<string, Declarations>();
	const edge = entryEdge(machine, drawnIn, state.id);
	if (!edge) return out;
	const model = base.universe.model;
	// The exit gate, said out loud, because it is the one rung of the ladder that
	// is *entirely* invisible in the stylesheet. An input is visible — the state
	// it opens is a rule in the file; a guard is visible for the same reason; a
	// timeline is `@keyframes` a reader can read. An exit time is a comparison the
	// script makes before it writes an attribute, and somebody reading only the
	// CSS would conclude the button responds to every click, which it does not.
	//
	// The answer set's number first and the document's second, for `pacing`'s
	// reason exactly: an exit time is a `duration` Value, so it may name a token
	// whose alternatives the solver picked between.
	const held =
		model.machines[machine.id]?.exit[edge.id] ??
		transitionExit(machine, edge, { tokens: index.scene.tokens, picks: base.universe.pick });
	if (held > 0) {
		say(
			`The ${ms(held)} “${stateName(machine, state.id)}” has to be waited for. An exit time is a gate the script checks before it writes the attribute, so it is in the file and it works — but it is not in the CSS, and a reader of the stylesheet alone will not see it.`,
		);
	}
	const { duration, delay, stagger, easing, spring } = pacing(
		model,
		machine,
		edge,
		base.universe.pick,
		index.scene.tokens,
	);
	const leaving = machine.transitions.find(
		(t) => t.enabled && t.from === state.id && t.to === drawnIn,
	);
	if (leaving) {
		const back = pacing(model, machine, leaving, base.universe.pick, index.scene.tokens);
		if (back.duration !== duration || back.easing !== easing || back.delay !== delay) {
			say(
				`How “${stateName(machine, state.id)}” is paced on the way out. One transition declaration on the base rule paces the move both ways, so the file uses the edge going in and the edge coming back runs at the same speed.`,
			);
		}
	}
	if (duration <= 0) return out;

	// The gradient's cut, said out loud, in the shape of the `display:none`
	// sentence one function up and for the same reason: the declaration a reader
	// would look for is *absent* from the file — `tweenedKeys` struck it — and an
	// absence explains nothing on its own. Conditional on the state actually
	// repainting a `background-image`, because a document whose gradients never
	// move loses nothing and a list of losses that pads itself is one nobody
	// finishes reading.
	const cut = [...changed]
		.filter(([, declarations]) => declarations.backgroundImage !== undefined)
		.map(([id]) => nodeLabel(index, id));
	if (cut.length > 0) {
		say(
			`${stateName(machine, state.id)} changes the gradient on ${cut.join(", ")}. The direction of a gradient does not tween: CSS swaps one background image for the other at the halfway point, however long the transition says. The gradient's two colours do tween, because they are registered custom properties — so a change of colour is smooth and a change of direction is a cut.`,
		);
	}

	const ordered = [...changed.keys()].sort((a, b) => {
		const x = model.byId[a];
		const y = model.byId[b];
		return (x?.order ?? 1) - (y?.order ?? 1) || (a < b ? -1 : a > b ? 1 : 0);
	});
	ordered.forEach((id, i) => {
		const kind = model.byId[id]?.kind;
		if (!kind) return;
		const keys = tweenedKeys(kind, edge.only, changed.get(id) ?? {});
		if (keys.length === 0) return;
		// Remembered **here**, beside the declaration that names it, rather than
		// where `pacing` answered — which is where it was written first, and which
		// was wrong in a way only a file could show. Three of the paths out of this
		// function reach no declaration at all: a transition whose duration resolved
		// to zero returns above, a state that changes nothing a browser tweens
		// returns on the line above this one, and the `leaving` edge is read only to
		// *compare* the two directions. A spring collected on any of those puts a
		// `:root` block and five hundred characters of `@supports` into a file that
		// refers to neither — and `springRules` cannot tell, because a set of names
		// carries no record of who asked. The declaration is the only place that
		// knows, so it is the place that says so.
		if (spring !== undefined) springs.add(spring);
		// **The pacing is repeated once per property, and the repetition is the
		// whole declaration.** `transition` is a comma-separated list of *whole*
		// transitions, not a property list with one pacing after it: the commas
		// separate the items, so `a, b, c 200ms ease-out` is three transitions of
		// which the first two take the initial `0s ease` and only `c` is paced.
		// That is what shipped here — `keys.join(", ")` followed by one pacing —
		// and it meant every state that changed two or more things snapped on all
		// of them but the last, in every file this repository has ever written.
		//
		// It survived a green suite because the string is *correct* for one key,
		// and every machine fixture in `export.test.ts` moved exactly one property
		// — a fill. One key is also the only case where the two spellings are the
		// same characters, so nothing short of a two-property state could see it.
		//
		// The canvas never had the bug and that is the sharpest way to say what
		// this was: `Artboard.module.css` writes the *longhands*, where one
		// `transition-duration` legitimately repeats across every entry of
		// `transition-property`. So a hover that changed a fill and a shadow tweened
		// both on screen and tweened one in the file, which is the divergence
		// `SHAPE_PAINT` and `PAINT` exist to make impossible — the same class of bug
		// as `overflow: hidden`, and invisible for the same reason: nothing in the
		// stylesheet says it out loud, and `getComputedStyle` reports the parse
		// rather than the intent unless you read `transitionDuration` and count the
		// zeroes.
		//
		// The shorthand is kept rather than switched to the longhands the canvas
		// uses. Three declarations where one will do is three things for `diff` to
		// unsay in every theme and every breakpoint, and the collapse machinery
		// above is written against one `transition` key per selector.
		const paced = `${ms(duration)} ${easing} ${ms(delay + i * stagger)}`;
		out.set(id, {
			transition: keys.map((key) => `${key} ${paced}`).join(", "),
		});
	});
	return out;
}

