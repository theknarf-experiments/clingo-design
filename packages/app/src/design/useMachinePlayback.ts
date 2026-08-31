import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type InputValues,
	type MachineTable,
	type Scene,
	type Trigger,
	machineTable,
	stepInstance,
} from "@clingo-design/design-core";

/**
 * What the canvas is pretending about, while the document goes on saying
 * something else.
 *
 * See {@link useMachinePlayback} for why that sentence is still the whole
 * design, and why the shape below grew four fields without the sentence
 * changing.
 */
export interface Playback {
	/**
	 * Instance node id -> layer id -> the state the canvas is drawing.
	 *
	 * **Nested where it used to be flat, and the nesting is the rung.** A machine
	 * is in one state *per layer*, all at once — a button may be `pressed` in the
	 * press layer and `glowing` in the glow layer in the same moment — so a
	 * `Record<string, string>` could only ever have carried one third of the
	 * picture. Every reader that wants the old answer wants the *first* layer's
	 * entry, and {@link firstLayerOf} is that reading spelled once so the four
	 * panels that still take a flat record cannot each invent it.
	 *
	 * An instance with no entry is one the canvas is not playing at all, and a
	 * layer with no entry inside an instance's record is a layer handed back to
	 * the document while its siblings are still being played. Both absences mean
	 * "ask the document", which is what makes stopping playback a delete rather
	 * than a write.
	 */
	playing: Readonly<Record<string, Readonly<Record<string, string>>>>;
	/**
	 * Instance node id -> input id -> what the preview is holding.
	 *
	 * Seeded from every input's declared initial, exactly as the exported
	 * runtime's `seed` does, and then written over by whatever the designer has
	 * driven. **Per instance and not per machine**, because two buttons on one
	 * artboard driven by one machine are two things a person points at
	 * separately: a preview where opening one drawer opened both would be a
	 * preview of a document nobody wrote.
	 *
	 * A `trigger` input is never in here. "Not fired" is the absence of a value
	 * rather than a value, which is the same reading `INPUT_KINDS.trigger.holds`
	 * states and the same one `edgeAllows` implements — see {@link fireInput}.
	 */
	inputs: Readonly<Record<string, InputValues>>;
	/**
	 * Drive one layer of one instance; null hands *that layer* back to the
	 * document and leaves the others where they are.
	 */
	play: (instance: string, layer: string, state: string | null) => void;
	/** Set a persistent input. Clamped to its declared range, like the runtime. */
	setInput: (instance: string, input: string, value: boolean | number) => void;
	/**
	 * Fire a momentary one: true for this one evaluation and gone afterwards.
	 *
	 * Settling happens inside the call, on the `load` trigger, because that is
	 * what the exported runtime does — see the note on {@link fireInput} in the
	 * implementation.
	 */
	fireInput: (instance: string, input: string) => void;
	/**
	 * Feed a trigger at an instance and follow whatever edges it opens, in every
	 * layer at once. Null where nothing moved anywhere.
	 *
	 * The same {@link stepInstance} the exported runtime interprets, over the same
	 * {@link machineTable}, under the same guards and the same exit gate — so
	 * watching it in the studio and clicking it in a browser cannot disagree.
	 *
	 * **A non-null answer is every layer that was asked, at the state it ended in
	 * — not only the ones that changed.** That is `stepInstance`'s own shape and
	 * `RuntimeHandle.fireIn`'s — `fire` over there is the *first layer's* answer
	 * as a string, kept at the shape it shipped so that a page exported before
	 * layers existed keeps working — and it is kept rather than filtered because
	 * the two
	 * cannot be told apart from the outside: a layer that took a self-edge and a
	 * layer that took no edge both end where they began, and only the first is a
	 * fact about the machine. `rive-ladder-spec.md` §10.5 calls this "the layers
	 * that moved"; the wider reading is the one the two interpreters already
	 * share, and narrowing it here would make the studio and the file disagree
	 * about a self-edge. The null/non-null distinction still carries the question
	 * every caller actually asks — did this trigger do anything at all.
	 */
	fire: (instance: string, trigger: Trigger) => Record<string, string> | null;
	/**
	 * Where the timeline scrubber is, per instance, in milliseconds.
	 *
	 * Editor state like everything else here, and it costs no solve: the canvas
	 * reads the two keyframes either side of it out of the answer set it already
	 * holds and interpolates. There is no clock in this file and no frame rate
	 * anywhere in the system — see `machines.ts`' `sampleTimeline`, which is the
	 * function the canvas asks.
	 */
	scrub: Readonly<Record<string, number>>;
	setScrub: (instance: string, ms: number) => void;
	clear: () => void;
}

/**
 * Nothing is being played, spelled once.
 *
 * A shared object rather than a fresh `{}`, because {@link Playback.playing} is
 * handed straight to `Artboard`, which is memoised: a new empty object every
 * render would re-render every artboard on the canvas on every pointermove, for
 * a change that is not a change. The same argument `NO_PICKS` in Studio.tsx
 * makes, one prop over, and the reason there are four of these rather than one
 * shared `{}` cast four ways — a single object would tempt somebody into
 * mutating it.
 */
const NOTHING: Readonly<Record<string, Readonly<Record<string, string>>>> = {};
const NO_INPUTS: Readonly<Record<string, InputValues>> = {};
const NO_SCRUB: Readonly<Record<string, number>> = {};
/** One instance's layers, when it is being played in none of them. */
const NO_LAYERS: Readonly<Record<string, string>> = {};
/** No momentary input is true, shared for the reason {@link NOTHING} is. */
const EMPTY: ReadonlySet<string> = new Set();

/**
 * The layers of the machine driving one instance, in stacking order.
 *
 * Through the *table* rather than through the document, for the reason every
 * other lookup in this file goes through the table: the one place that decides
 * which layers a machine has, and which states are in each, has to be the one
 * place the exported file reads too. `machineTable` drops a cross-layer edge, a
 * dangling edge and an impossible guard; a second walk over `scene.machines`
 * here would put all three back and the studio would follow edges the file
 * refuses.
 *
 * Empty for an instance no machine drives, which is the same silence
 * `stepInstance` answers with and which every caller below already handles.
 */
function layersOf(table: MachineTable, instance: string) {
	const at = table.instances[instance];
	if (at === undefined) return [];
	return table.machines[at.machine]?.layers ?? [];
}

/**
 * Where an instance's machine starts, per layer — the document's own answer.
 *
 * `layerStart` is what {@link shownStates} said, so an instance the document
 * draws in `open` starts its playback in `open` rather than jumping to the
 * machine's first state the moment a pointer touches it. The fallback to
 * `initial` is not defensive tidying: `MachineTable.instances[].layerStart` is
 * optional precisely because two files build a table by hand in a fixture, and a
 * reader that found it missing and answered nothing would make every guarded
 * edge in those fixtures unreachable for a reason nobody could see.
 *
 * Exported, and one of four pure functions in this file that are, because a hook
 * cannot be run under `node --test` and the arithmetic it does can. See
 * `useMachinePlayback.test.ts`.
 */
export function startingStates(
	table: MachineTable,
	instance: string,
): Record<string, string> {
	const at = table.instances[instance];
	if (at === undefined) return {};
	const layers = layersOf(table, instance);
	if (at.layerStart !== undefined) {
		// Filtered against the layers the table actually holds, so a stale entry
		// for a deleted layer cannot make `stepInstance` walk one.
		const out: Record<string, string> = {};
		for (const layer of layers) {
			const start = at.layerStart[layer.id];
			if (start !== undefined) out[layer.id] = start;
		}
		if (Object.keys(out).length > 0) return out;
	}
	const first = layers[0];
	return first === undefined ? {} : { [first.id]: at.initial };
}

/**
 * Where each layer of one instance is *right now*: what is being played, or
 * where the document starts it.
 *
 * A **stopped** layer is left out of the answer entirely rather than carried at
 * the state it stopped in, and that is what makes the stop stick.
 * {@link stepInstance} skips a layer the caller says nothing about — its own
 * comment says so, and calls it the caller's business to know where a layer is —
 * so omitting a stopped one is how this file says "that layer has finished
 * answering" in the vocabulary the stepper already has. Including it would make
 * a machine that took an edge into Exit start moving again on the next hover.
 *
 * The state it stopped in is still in {@link Playback.playing} and is still what
 * the canvas draws, which is the other half of what "stopped" means: the layer
 * keeps its picture and loses its voice.
 */
export function currentStates(
	table: MachineTable,
	instance: string,
	played: Readonly<Record<string, string>> | undefined,
	halted: ReadonlySet<string> = new Set(),
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [layer, state] of Object.entries(startingStates(table, instance))) {
		if (halted.has(haltKey(instance, layer))) continue;
		out[layer] = played?.[layer] ?? state;
	}
	// A layer the document does not start — one with no states at all — but which
	// the designer has driven by hand from the layer strip. Rare, and admitting it
	// is cheaper than explaining why a state you can see on the canvas is not a
	// state the machine will step out of.
	for (const [layer, state] of Object.entries(played ?? {})) {
		if (halted.has(haltKey(instance, layer))) continue;
		out[layer] ??= state;
	}
	return out;
}

/**
 * How long each layer has been in the state it is in, in milliseconds.
 *
 * The exit gate is `heldMs < exit`, strictly, and it is evaluated inside
 * `edgeAllows` against exactly this record — so a layer nothing has moved yet has
 * been in its state since the preview opened, not since the epoch and not for no
 * time at all. A layer with no timestamp is answered `Infinity`, which opens
 * every gate, and that is the right answer rather than a lenient one: the state
 * it is in is the one the *document* put it in, which is to say it has been in it
 * since before the session started.
 */
export function heldFrom(
	since: Readonly<Record<string, number>> | undefined,
	now: number,
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [layer, at] of Object.entries(since ?? {})) {
		out[layer] = Math.max(0, now - at);
	}
	return out;
}

/**
 * Every input of every driven instance, at its declared initial.
 *
 * The twin of the emitted runtime's `seed`, and deliberately a *separate* store
 * from what the designer has driven — see {@link useMachinePlayback}. A trigger
 * is not in here and an input the table gives no initial is not in here either:
 * absent means the host has not been told a value, and `edgeAllows` refuses
 * every guard about a value it has not got, which is what stops a typo opening
 * an edge.
 *
 * The seed is **not clamped** to the declared range, and the asymmetry with
 * {@link Playback.setInput} is the runtime's own and is kept on purpose: the seed
 * is what the *document* says, and a document whose initial sits outside its own
 * range is a thing `machine_input_range` reports and a person fixes, not a thing
 * a preview should quietly rewrite so nobody ever sees it.
 */
export function seedInputs(table: MachineTable): Record<string, InputValues> {
	const out: Record<string, InputValues> = {};
	for (const [instance, at] of Object.entries(table.instances)) {
		const declared = table.machines[at.machine]?.inputs ?? {};
		const store: Record<string, boolean | number> = {};
		for (const [id, spec] of Object.entries(declared)) {
			if (spec.kind === "trigger") continue;
			if (spec.initial === undefined) continue;
			store[id] = spec.initial;
		}
		out[instance] = store;
	}
	return out;
}

/** One layer of one instance, as a key a flat set can hold. */
const haltKey = (instance: string, layer: string): string =>
	`${instance} ${layer}`;

/**
 * The flat answer, for the panels that still ask a flat question.
 *
 * `Machines`, `StateStrip`, `Transitions` and `Inspector` all take
 * `Record<instance, state>` and belong to steps this one may not edit, so the
 * projection lives here rather than four times over in Studio.tsx. The first
 * layer is the right projection and not a convenient one: it is what
 * `SceneNode.state` means, what `MachineTable.instances[].initial` carries, and
 * what the export writes as plain `data-state` — the same choice made in four
 * places, made here for the fifth.
 */
export function firstLayerOf(
	table: MachineTable,
	playing: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [instance, byLayer] of Object.entries(playing)) {
		const first = layersOf(table, instance)[0];
		const state = first ? byLayer[first.id] : undefined;
		if (state !== undefined) out[instance] = state;
	}
	return out;
}

/**
 * Which layer of an instance a state belongs to, for a caller that has only the
 * state.
 *
 * The other half of {@link firstLayerOf}: a panel that still says "play `hover`
 * on this button" has to be turned back into "play `hover` in the layer `hover`
 * is in", and the table is the only thing here that knows. Nothing where no
 * layer of this instance's machine holds the state, which is what a panel
 * rendered against a document that has since moved on hands in, and which the
 * caller reads as "do not play it".
 */
export function layerHolding(
	table: MachineTable,
	instance: string,
	state: string,
): string | undefined {
	return layersOf(table, instance).find((layer) => layer.states.includes(state))
		?.id;
}

/**
 * Playing a machine on the canvas, without touching the document.
 *
 * **This costs no solve, and that is still the whole reason it can exist at
 * all.** Every state of every instance is already in the one answer set — that
 * is the invariant the feature turns on, and the rung this step adds does not
 * bend it: three layers are three `shown/2` facts in one answer set rather than
 * a design space with twelve members in it, so playing all three at once is the
 * canvas reading three entries out of a model it already has. Nothing
 * recompiles, nothing re-grounds, nothing lands in undo. Compare the thing this
 * is *not*: `SceneNode.state` — which state the document draws an instance in —
 * is an edit, is a fact the compiler emits, re-grounds, and does land in undo.
 *
 * The state lives here, in the editor, beside the pins and the zero point and
 * for the same reason those do: it is a decision about the person looking rather
 * than about the design. Two people may watch the same document's button in two
 * different states without disagreeing about anything, and a document that
 * carried it would mean opening a file and finding somebody else's pointer still
 * resting on the button. Everything this hook has gained since — a driven input,
 * a stopped layer, a scrubber's position — is the same kind of thing and is held
 * the same way.
 *
 * ### Why the live values are refs as well as state
 *
 * `fire` has to read where every layer *is* and write where each one lands, and
 * it is called from a pointer handler that may run more than once before React
 * re-renders — a `pointerup` and the `click` that follows it, or the chain of
 * `load` edges the studio walks when preview is switched on. Reading `playing`
 * out of the closure would make the second call in such a run read the state
 * from before the first, so a two-step chain would take one step and a load chain
 * would stop after its first edge. The refs are the authority and the React
 * state is their shadow, committed together, so the two can never be seen apart.
 *
 * ### The inputs are two stores and not one
 *
 * {@link seedInputs} says what the *document* starts every input at; `driven`
 * holds what the designer has since set. They are merged on read rather than
 * merged on write, and the reason is that the document changes under the
 * preview: nudge a number input's initial in the panel and the seed has to move,
 * while an input somebody deliberately dragged to 700 has to stay at 700. One
 * store would have to choose, and either choice is wrong half the time.
 *
 * ### What it deliberately does not do
 *
 * There is still no timer here and no animation clock. What paces a transition
 * on the canvas is CSS, exactly as in the exported file: the studio hands the
 * artboard a duration and an easing and the browser's compositor does the
 * moving. A script that also waited before switching state would apply every
 * delay twice. `runtime.ts` makes the same argument about the emitted runtime,
 * and it is the same argument because it is the same design.
 *
 * The scrubber is not a clock either. It is a *position*, set by a hand on a
 * slider, and the canvas samples the timeline at it — so a timeline the designer
 * is dragging through moves, and one nobody is touching does not move at all.
 * A play button that advanced it on a `requestAnimationFrame` was considered and
 * left out: it would be a second animator arguing with the compositor, which is
 * exactly the thing `runtime.ts` refuses to ship, and the honest way to watch a
 * timeline run at speed is to export the file and look at it.
 *
 * And there is still no validation of `trigger` against what the machine listens
 * for: {@link stepInstance} answers `undefined` for a trigger no edge takes,
 * which is the same answer as "no edge from here", which is the same answer the
 * exported runtime gives. One lookup, one answer, three callers.
 */
export function useMachinePlayback(scene: Scene): Playback {
	/**
	 * The flattened machines, and the only thing here that reads the document.
	 *
	 * The same table the export ships in its `<script>` — see `machineTable` — so
	 * the studio cannot follow an edge the file would not, or refuse one it would.
	 * Memoised on the whole scene rather than on `scene.machines`, because which
	 * instances a machine drives depends on the nodes too.
	 */
	const table = useMemo(() => machineTable(scene), [scene]);
	const seeded = useMemo(() => seedInputs(table), [table]);

	const live = useRef<Readonly<Record<string, Readonly<Record<string, string>>>>>(
		NOTHING,
	);
	const [playing, setPlaying] =
		useState<Readonly<Record<string, Readonly<Record<string, string>>>>>(NOTHING);

	const driven = useRef<Readonly<Record<string, InputValues>>>(NO_INPUTS);
	const [drives, setDrives] = useState<Readonly<Record<string, InputValues>>>(
		NO_INPUTS,
	);

	const [scrub, setScrubState] = useState<Readonly<Record<string, number>>>(
		NO_SCRUB,
	);

	/**
	 * When each layer last entered the state it is in, as a wall-clock stamp.
	 *
	 * A ref and never state: nothing draws it, and re-rendering the canvas
	 * because a millisecond passed is exactly the stutter the preview must not
	 * have. A layer with no stamp has been in its state since before the session,
	 * which {@link heldFrom} reads as forever — see there for why that is the
	 * right answer and not a lenient one.
	 */
	const since = useRef<Record<string, Record<string, number>>>({});
	/** Layers that have taken an edge into Exit and stopped answering. */
	const halted = useRef<Set<string>>(new Set());

	/** Write both halves at once, so nothing can read one without the other. */
	const commit = useCallback(
		(next: Readonly<Record<string, Readonly<Record<string, string>>>>) => {
			live.current = next;
			setPlaying(next);
		},
		[],
	);

	const commitInputs = useCallback((next: Readonly<Record<string, InputValues>>) => {
		driven.current = next;
		setDrives(next);
	}, []);

	/**
	 * What the preview is holding for every instance: the document's seed, with
	 * whatever the designer has driven over the top.
	 *
	 * Memoised on both halves, because it is handed to the Machines panel as a
	 * prop and a fresh object every render would re-render it on every
	 * pointermove over the canvas — the same argument {@link NOTHING} makes.
	 */
	const inputs = useMemo(() => {
		if (Object.keys(drives).length === 0) return seeded;
		const out: Record<string, InputValues> = { ...seeded };
		for (const [instance, held] of Object.entries(drives)) {
			out[instance] = { ...(seeded[instance] ?? {}), ...held };
		}
		return out;
	}, [seeded, drives]);

	/**
	 * Forget a played state the document no longer admits.
	 *
	 * A machine deleted, a state deleted, a *layer* deleted, an instance deleted,
	 * a definition that stopped being one: any of those leaves an entry pointing
	 * at a state copy that is not in the answer set any more, and the canvas would
	 * quietly go on drawing the instance's own picture while a panel said it was
	 * playing something. Dropping the entry is the honest reading — the machine is
	 * not where it was, so it is nowhere — and it is the same shape as the
	 * studio's pin pruning, which drops a pin on an alternative that has since
	 * gone.
	 *
	 * Against the table rather than against the document directly, so that the one
	 * place that decides which states a layer may be in is the one place that
	 * decides which states it may be *played* in. The stopped set and the entry
	 * timestamps are pruned in the same pass, since a key nothing can name again
	 * is a key that would otherwise be held for the life of the session.
	 */
	useEffect(() => {
		const at = live.current;
		let changed = false;
		const kept: Record<string, Readonly<Record<string, string>>> = {};
		for (const [instance, byLayer] of Object.entries(at)) {
			const layers = layersOf(table, instance);
			const keptLayers: Record<string, string> = {};
			for (const [layer, state] of Object.entries(byLayer)) {
				const row = layers.find((l) => l.id === layer);
				if (row?.states.includes(state)) keptLayers[layer] = state;
				else changed = true;
			}
			if (Object.keys(keptLayers).length > 0) kept[instance] = keptLayers;
			else if (Object.keys(byLayer).length > 0) changed = true;
		}
		// The bookkeeping that hangs off a played layer, pruned against the same
		// answer rather than against a second reading of it.
		for (const key of [...halted.current]) {
			const [instance, layer] = key.split(" ");
			if (!layersOf(table, instance).some((l) => l.id === layer)) {
				halted.current.delete(key);
			}
		}
		for (const instance of Object.keys(since.current)) {
			if (table.instances[instance] === undefined) delete since.current[instance];
		}
		if (!changed) return;
		commit(Object.keys(kept).length === 0 ? NOTHING : kept);
	}, [table, commit]);

	/**
	 * An input the document no longer declares, dropped for the same reason a
	 * played state is: a value nothing reads is a value a panel would go on
	 * showing after the row it belonged to had gone.
	 */
	useEffect(() => {
		const at = driven.current;
		let changed = false;
		const kept: Record<string, InputValues> = {};
		for (const [instance, held] of Object.entries(at)) {
			const machine = table.instances[instance]?.machine;
			const declared = machine ? (table.machines[machine]?.inputs ?? {}) : {};
			const keptInputs: Record<string, boolean | number> = {};
			for (const [id, value] of Object.entries(held)) {
				if (Object.hasOwn(declared, id)) keptInputs[id] = value;
				else changed = true;
			}
			if (Object.keys(keptInputs).length > 0) kept[instance] = keptInputs;
			else if (Object.keys(held).length > 0) changed = true;
		}
		if (!changed) return;
		commitInputs(Object.keys(kept).length === 0 ? NO_INPUTS : kept);
	}, [table, commitInputs]);

	/** Stamp a layer as having entered its state now. */
	const touch = useCallback((instance: string, layer: string) => {
		const row = (since.current[instance] ??= {});
		row[layer] = Date.now();
	}, []);

	const play = useCallback(
		(instance: string, layer: string, state: string | null) => {
			const at = live.current;
			const held = at[instance];
			if (state === null) {
				if (held?.[layer] === undefined) return;
				const { [layer]: _handedBack, ...rest } = held;
				// Handing a layer back also lets it answer again: a designer who
				// pressed "stop playing" on a layer that had run into Exit means the
				// layer should behave as the document says, and the document does not
				// say it is finished.
				halted.current.delete(haltKey(instance, layer));
				delete since.current[instance]?.[layer];
				const next = { ...at };
				if (Object.keys(rest).length === 0) delete next[instance];
				else next[instance] = rest;
				commit(Object.keys(next).length === 0 ? NOTHING : next);
				return;
			}
			// A state the layer has not got is not played and not reported as an
			// error either. The panels build their buttons out of the layer's own
			// states, so the only way to get here with a bad pair is a document
			// edited under a panel that has not re-rendered yet — and drawing
			// nothing at all for a beat is better than drawing a state copy that is
			// not in the answer set.
			const row = layersOf(table, instance).find((l) => l.id === layer);
			if (!row?.states.includes(state)) return;
			if (held?.[layer] === state) return;
			halted.current.delete(haltKey(instance, layer));
			touch(instance, layer);
			commit({ ...at, [instance]: { ...(held ?? NO_LAYERS), [layer]: state } });
		},
		[table, commit, touch],
	);

	/**
	 * One trigger, answered by every layer at once.
	 *
	 * The whole of the decision is {@link stepInstance}'s, which reads the same
	 * table the exported runtime reads, with the same guards, the same Any-edge
	 * precedence and the same exit gate. What is done *here* is the three things
	 * a stepper cannot do: remember where each layer was, notice which ones
	 * stopped, and restamp the ones that moved so the next exit gate measures from
	 * the right moment.
	 *
	 * A self-edge counts as a move and reports where it landed, which is the same
	 * answer `MACHINE_RUNTIME.fire` gives: "this trigger did something here" is a
	 * different claim from "the picture changed", and only the first one is a
	 * question about the machine.
	 */
	const fireWith = useCallback(
		(
			instance: string,
			trigger: Trigger,
			fired: ReadonlySet<string>,
		): Record<string, string> | null => {
			if (table.instances[instance] === undefined) return null;
			const at = live.current;
			const current = currentStates(table, instance, at[instance], halted.current);
			if (Object.keys(current).length === 0) return null;
			const moved = stepInstance(
				table,
				instance,
				current,
				trigger,
				inputs[instance],
				fired,
				heldFrom(since.current[instance], Date.now()),
			);
			if (moved === undefined) return null;

			const next: Record<string, string> = { ...(at[instance] ?? NO_LAYERS) };
			const answer: Record<string, string> = {};
			for (const [layer, to] of Object.entries(moved)) {
				if (to === null) {
					// A stopped layer keeps whatever state it was last in — its picture
					// stays exactly as it is — and simply stops being asked. That is what
					// `null` means in `stepLayer`'s three answers, and conflating it with
					// "nothing moved" would leave the studio listening to a machine that
					// has said it is finished.
					halted.current.add(haltKey(instance, layer));
					next[layer] ??= current[layer];
					continue;
				}
				if (next[layer] !== to) touch(instance, layer);
				next[layer] = to;
				answer[layer] = to;
			}
			commit({ ...at, [instance]: next });
			return Object.keys(answer).length === 0 ? null : answer;
		},
		[table, inputs, commit, touch],
	);

	const fire = useCallback(
		(instance: string, trigger: Trigger) => fireWith(instance, trigger, EMPTY),
		[fireWith],
	);

	const setInput = useCallback(
		(instance: string, input: string, value: boolean | number) => {
			const machine = table.instances[instance]?.machine;
			const spec = machine ? table.machines[machine]?.inputs?.[input] : undefined;
			// Refused rather than coerced where the machine has no such input, where
			// the kind does not match, where the input is a trigger (a moment is
			// fired, not set), or where the number is not one. Every one of those is
			// the emitted runtime's own refusal, written the same way round, because
			// a preview that accepted a value the file would reject is a preview of a
			// different document.
			if (spec === undefined || spec.kind === "trigger") return;
			let held = value;
			if (spec.kind === "boolean") {
				if (typeof held !== "boolean") return;
			} else {
				if (typeof held !== "number" || Number.isNaN(held)) return;
				if (spec.min !== undefined && held < spec.min) held = spec.min;
				if (spec.max !== undefined && held > spec.max) held = spec.max;
			}
			const at = driven.current;
			if (at[instance]?.[input] === held) return;
			commitInputs({
				...at,
				[instance]: { ...(at[instance] ?? {}), [input]: held },
			});
		},
		[table, commitInputs],
	);

	/**
	 * Fire a momentary input, and let the machine answer it now.
	 *
	 * The trigger is true for this one evaluation and gone, which is what a
	 * trigger is: a store that kept one true would fire every guarded edge on the
	 * next unrelated event. So the evaluation happens inside this call, on the
	 * `load` trigger, and the fired set is thrown away with it — the emitted
	 * runtime's `fireInput` to the letter, including the choice of `load`, which
	 * is the trigger with no event and therefore the only honest one for something
	 * that happened which no pointer on the canvas marks.
	 *
	 * One pass rather than the runtime's fixpoint loop. Settling is a fixpoint and
	 * a second pass would only move a layer whose guard the first pass opened —
	 * which cannot happen, because the fired set is consumed and nothing else here
	 * changed. The load chain that *does* need the loop is the one the studio
	 * walks when preview is switched on, and that loop lives in Studio.tsx where
	 * it can also stop on a cycle.
	 */
	const fireInput = useCallback(
		(instance: string, input: string) => {
			const machine = table.instances[instance]?.machine;
			const spec = machine ? table.machines[machine]?.inputs?.[input] : undefined;
			if (spec === undefined || spec.kind !== "trigger") return;
			fireWith(instance, "load", new Set([input]));
		},
		[table, fireWith],
	);

	const setScrub = useCallback((instance: string, ms: number) => {
		const at = Math.max(0, Math.round(ms));
		setScrubState((prev) => (prev[instance] === at ? prev : { ...prev, [instance]: at }));
	}, []);

	const clear = useCallback(() => {
		halted.current = new Set();
		since.current = {};
		setScrubState((prev) => (Object.keys(prev).length === 0 ? prev : NO_SCRUB));
		if (Object.keys(driven.current).length > 0) commitInputs(NO_INPUTS);
		if (Object.keys(live.current).length > 0) commit(NOTHING);
	}, [commit, commitInputs]);

	return { playing, inputs, play, setInput, fireInput, fire, scrub, setScrub, clear };
}
