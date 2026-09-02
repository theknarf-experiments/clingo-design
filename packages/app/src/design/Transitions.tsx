import {
	DEFAULT_EASING,
	MOTION_PROPS,
	MOTION_PROP_NAMES,
	type Machine,
	type ModelMachine,
	type MotionProp,
	type Picks,
	RESERVED_STATES,
	type Scene,
	TRIGGERS,
	TRIGGER_NAMES,
	type Term,
	type Transition,
	type Trigger,
	type Value,
	addTransition,
	deleteTransition,
	easingOf,
	findState,
	guardImpossible,
	layerInitial,
	layerOf,
	machineLayers,
	motionVar,
	propValues,
	resolveValue,
	stateName,
	tokensOfType,
	updateTransition,
	writeDuration,
} from "@clingo-design/design-core";

import { Conditions } from "./Conditions";
import { CurveField } from "./CurveField";
import { ValueEditor } from "./ValueEditor";
import { cx } from "./cx";
import styles from "./Transitions.module.css";

/**
 * The edges of one machine: when it moves, and how long the move takes.
 *
 * A list under the state strip rather than arrows drawn between the chips, and
 * the argument is the strip's own one level down: an arrow can show that
 * `rest → hover` exists, and everything a designer comes here to *change* about
 * it — the trigger, three durations that may each name a token and hold
 * alternatives, an easing, a property filter, a switch — has no room on an
 * arrow. So the shape of the machine is the strip and this list read together,
 * and what is wrong with the shape is said in words by `machineHealth` rather
 * than left to be seen in a picture.
 *
 * **A transition carries no geometry and no appearance.** It says *when* the
 * machine moves and *how long* the move takes, and nothing about what the design
 * looks like at either end — that is entirely the two states' business. Keeping
 * the two apart is exactly what lets the export collapse a rest/hover pair into
 * `:hover` plus a `transition:` declaration and ship a file with no behaviour in
 * it at all.
 *
 * **The three motion settings are values, not numbers**, and every one of them
 * goes through the same {@link ValueEditor} a fill does. That is the whole
 * reason `duration` is a `ValueType`: a token holding `["120ms", "240ms"]` *is*
 * a motion scale — one place that decides how quickly the whole design moves —
 * and pointing every transition at it is the same act as pointing every gap at a
 * spacing token. Which also means a motion setting really can branch the design
 * space, and `#project mdur/3` is what makes the brisk document and the
 * considered one two universes rather than one with an arbitrary pick.
 */
export interface TransitionsProps {
	scene: Scene;
	machine: Machine;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	picks: Picks;
	varying: ReadonlySet<string>;
	reach?: Readonly<Record<string, Set<number>>>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	/**
	 * Per transition, what this universe resolved its motion settings to.
	 *
	 * Four numbers and not three: an **exit time** is a `duration` Value like a
	 * delay, it clamps at zero like a delay, and the program `#project`s it like a
	 * delay — so a debounce scale holding two ends really is two designs, and only
	 * the solver knows which end is on screen. It sits in this table rather than
	 * in {@link MOTION_PROPS} because `MotionProp` still has three members; the
	 * day `compile.ts` adds the fourth entry, the special case here and in the
	 * document reader both go away.
	 */
	timing?: Readonly<
		Record<
			string,
			{ duration: number; delay: number; stagger: number; exit?: number }
		>
	>;
	/** Transitions the answer set calls dangling or nondeterministic. */
	health?: ModelMachine;
	/**
	 * Transitions whose guard can never be met — `mguardnever/2`.
	 *
	 * Separate from {@link health} rather than read out of it, because the panel
	 * has to be able to say this while the document is **unsatisfiable and there
	 * is no answer set at all** — which is exactly the moment somebody is looking
	 * for the thing they broke. The Machines panel hands the document's own
	 * reading, `machineHealth`, and the two are held equal by `machines.test.ts`
	 * on every satisfiable document.
	 */
	impossible?: ReadonlySet<string>;
	/** Transitions naming a reserved id in the wrong position — `mmisplaced/2`. */
	misplaced?: ReadonlySet<string>;
	/**
	 * Show only the transitions of this layer. Absent is all of them.
	 *
	 * A transition belongs to the layer of the state it leaves, and — where it
	 * leaves `entry` or `any`, which are not states and have no layer — to the
	 * layer of the state it arrives at. That is `mtlayer/3`'s own rule and it is
	 * spelled once here, in {@link layerOfEdge}.
	 */
	layer?: string;
	/** Play the transition on the canvas: drive `from`, then `to`. */
	onPlay?: (transition: string) => void;
}

/**
 * Which layer an edge runs in — `mtlayer/3`, read off the document.
 *
 * Its source's layer where the source is a state, and its **destination's**
 * where the source is a reserved word: `entry` and `any` are not states and have
 * no layer of their own, so the only thing that can say which layer such an edge
 * runs in is the state at its other end. An edge with reserved words at both ends
 * belongs to no layer, which is exactly what `any → exit` is, and it is reported
 * as misplaced rather than filed anywhere.
 */
function layerOfEdge(machine: Machine, transition: Transition): string | undefined {
	const from = findState(machine, transition.from);
	if (from !== undefined) return layerOf(machine, from);
	const to = findState(machine, transition.to);
	return to === undefined ? undefined : layerOf(machine, to);
}

/**
 * A `<select>` over the machine's states that can also show a state the machine
 * has not got.
 *
 * The extra option is the point rather than a defensive branch. A transition
 * naming a missing state is the one broken thing this document is built to
 * *report* — `mdangling/2` derives it, the Machines panel offers a one-click rule
 * that forbids it by name — and a select that silently snapped such an end to its
 * first legal value would repair the document under the designer and take the
 * symptom away with it. So the missing name is listed, marked, and stays until
 * somebody changes it on purpose.
 *
 * **Three of the names it offers are not states**, and that is deliberate too.
 * `entry`, `any` and `exit` are reserved words, legal only as an end of an edge,
 * and they are emphatically not entries in `Machine.states` — as states they
 * would be three empty deltas per machine, three copies per instance per part,
 * three rows in every strip and three terms a rule could name that would say
 * nothing. So they live here, in the one control where they mean something, and
 * each position offers only the ones that are legal in it. Choosing the wrong one
 * is still possible by hand and by another editor, which is what
 * {@link TransitionsProps.misplaced} reports.
 */
function StateSelect({
	machine,
	role,
	value,
	title,
	reserved,
	onChange,
}: {
	machine: Machine;
	role: string;
	value: string;
	title: string;
	/** The reserved words that are legal in this position, with their sense. */
	reserved: ReadonlyArray<[id: string, sense: string]>;
	onChange: (next: string) => void;
}) {
	const state = findState(machine, value) !== undefined;
	const word = RESERVED_STATES.has(value);
	const legal = state || reserved.some(([id]) => id === value);
	return (
		<select
			className={cx(styles.select, !legal && styles.broken)}
			data-role={role}
			aria-label={title}
			title={title}
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			{legal ? null : (
				<option value={value}>
					{value} — {word ? "not allowed at this end" : "no such state"}
				</option>
			)}
			{machine.states.map((s) => (
				<option key={s.id} value={s.id}>
					{s.name}
				</option>
			))}
			{reserved.length > 0 ? (
				<optgroup label="Not a state">
					{reserved.map(([id, sense]) => (
						<option key={id} value={id}>
							{id} — {sense}
						</option>
					))}
				</optgroup>
			) : null}
		</select>
	);
}

/** The words legal as a source, and the words legal as a destination. */
const FROM_WORDS: ReadonlyArray<[string, string]> = [
	["entry", "when the runtime starts"],
	["any", "from every state of this layer"],
];
const TO_WORDS: ReadonlyArray<[string, string]> = [
	["exit", "stop this layer"],
];

/** One edge, and everything a person can say about it. */
function Row({
	scene,
	machine,
	transition,
	picks,
	varying,
	reach,
	pins,
	onPin,
	timing,
	health,
	impossible,
	misplaced,
	onPlay,
	onSceneChange,
}: {
	transition: Transition;
} & Omit<TransitionsProps, "timing" | "layer"> & {
		timing?: {
			duration: number;
			delay: number;
			stagger: number;
			exit?: number;
		};
	}) {
	const context = {
		tokens: scene.tokens,
		picks,
		props: propValues(scene.nodes),
	};
	const write = (patch: Partial<Omit<Transition, "id">>, coalesce?: string) =>
		onSceneChange(
			(prev) => updateTransition(prev, machine.id, transition.id, patch),
			coalesce,
		);

	const dangling = health?.dangling.includes(transition.id) === true;
	const nondet =
		health?.nondeterministic.some(
			([state, trigger]) =>
				state === transition.from && trigger === transition.trigger,
		) === true;
	/**
	 * Whether this edge's guard can ever be met.
	 *
	 * The prop first and the document's own reading second, which is the same
	 * two-readers arrangement `machineHealth` documents at length: the answer set
	 * saw every universe, and `guardImpossible` saw the document's first reading
	 * of it — but only the second is available while the document is
	 * unsatisfiable, and that is when a designer most needs the sentence. They
	 * agree on everything satisfiable, which `machines.test.ts` pins.
	 */
	const never = impossible?.has(transition.id) ?? guardImpossible(machine, transition);
	const misfiled = misplaced?.has(transition.id) ?? false;
	const past = health?.exitPast.includes(transition.id) === true;

	/**
	 * The variable this edge's curve is, and what this universe resolved it to.
	 *
	 * The answer set first and the document second, which is the same ordering
	 * every number on this row already takes and is not decorative: an easing that
	 * names a `curve` token the solver chose between resolves to *the token* in
	 * one universe and to something else in the other, and a panel reading the
	 * document alone would draw one curve for a design that plainly holds two.
	 *
	 * Read off {@link TransitionsProps.health}, which is this machine's
	 * `ModelMachine`, rather than out of `timing` — the four numbers there come
	 * from `Machines.tsx`'s `timingFor`, which this rung does not own, and the
	 * record that carries the resolved curve was already being handed to this
	 * component for the health lists. One prop fewer for the same answer.
	 */
	const easingVariable = motionVar(machine.id, transition.id, "easing");
	const curve = health?.easing[transition.id] ?? easingOf(machine, transition, context);

	/**
	 * One motion setting, as the variable it is: `mval(m1,press,duration)`.
	 *
	 * Per machine *and* per transition, which is why the predicate is `mdur/3`
	 * rather than the `mdur/2` the design started with: a state id and a
	 * transition id are unique within their own machine and nowhere wider, so
	 * `hover` is what every machine in the document calls that state and `press`
	 * is what every one of them calls that edge. Making those collide would be
	 * making machines rename each other.
	 */
	const motionRow = (prop: MotionProp) => {
		const spec = MOTION_PROPS[prop];
		const variable = motionVar(machine.id, transition.id, prop);
		const value: Value = transition[prop] ?? [];
		return (
			<div
				key={prop}
				className={styles.motion}
				data-role={`transition-${prop}`}
				data-transition={transition.id}
			>
				<ValueEditor
					testId={`transition-${prop}`}
					label={spec.label}
					type={spec.type}
					value={value}
					tokens={tokensOfType(scene, spec.type)}
					fallback={spec.fallback}
					active={picks[variable]}
					varying={varying.has(variable)}
					reachable={reach?.[variable]}
					pinned={pins[variable]}
					onPin={(index) => onPin(variable, index)}
					preview={(term: Term) => resolveValue(context, [term], variable)}
					onChange={(next) =>
						write(
							{ [prop]: next.length > 0 ? next : undefined },
							`motion-${machine.id}-${transition.id}-${prop}`,
						)
					}
				/>
			</div>
		);
	};

	return (
		<div
			className={cx(
				styles.transition,
				!transition.enabled && styles.off,
				(dangling || nondet || never || misfiled) && styles.flagged,
			)}
			data-role="transition"
			data-transition={transition.id}
			data-impossible={never ? "" : undefined}
			data-misplaced={misfiled ? "" : undefined}
		>
			<div className={styles.head}>
				<label
					className={styles.switch}
					title={
						transition.enabled
							? "On. Switching it off keeps the edge in the document and out of the program — the machine stops moving that way without anybody having to remember how it was wired."
							: "Off: in the document, out of the program. It is not in the exported runtime either, and a state it was the only way into is now unreachable."
					}
				>
					<input
						type="checkbox"
						checked={transition.enabled}
						onChange={(e) => write({ enabled: e.target.checked })}
					/>
				</label>

				<StateSelect
					machine={machine}
					role="transition-from"
					value={transition.from}
					title="Leaves this state"
					reserved={FROM_WORDS}
					onChange={(from) => write({ from })}
				/>
				<span className={styles.arrow}>→</span>
				<StateSelect
					machine={machine}
					role="transition-to"
					value={transition.to}
					title="Arrives at this state"
					reserved={TO_WORDS}
					onChange={(to) => write({ to })}
				/>

				<select
					className={styles.select}
					data-role="transition-trigger"
					aria-label="Trigger"
					title="What makes it fire. Half of these collapse to a CSS pseudo-class when the machine has a matching edge back, and that pair exports as a stylesheet with no script in it at all."
					value={transition.trigger}
					onChange={(e) => write({ trigger: e.target.value as Trigger })}
				>
					{TRIGGER_NAMES.map((trigger) => (
						<option key={trigger} value={trigger}>
							{TRIGGERS[trigger].label}
						</option>
					))}
				</select>

				{onPlay ? (
					<button
						type="button"
						className={styles.action}
						data-role="play-transition"
						title="Play it on the canvas: the from state, then the to state after the delay and the duration. The canvas draws states rather than tweening between them, so what this previews is the pacing."
						onClick={() => onPlay(transition.id)}
					>
						▶
					</button>
				) : null}

				<button
					type="button"
					className={styles.action}
					data-role="delete-transition"
					title="Delete this edge. The states stay."
					onClick={() =>
						onSceneChange((prev) =>
							deleteTransition(prev, machine.id, transition.id),
						)
					}
				>
					×
				</button>
			</div>

			{dangling ? (
				<p className={styles.finding} data-role="transition-dangling">
					It names a state this machine has not got, so it can never fire.
				</p>
			) : null}
			{nondet ? (
				<p className={styles.finding} data-role="transition-nondet">
					Another edge leaves {stateName(machine, transition.from)} on the same
					trigger. The studio and the exported file both take the first one in
					this list, which is an answer rather than a decision.
				</p>
			) : null}
			{misfiled ? (
				<p className={styles.finding} data-role="transition-misplaced">
					One end is a reserved word in the position the other one takes:{" "}
					<code>entry</code> and <code>any</code> are sources, <code>exit</code> is
					a destination, and none of them is a state. This edge belongs to no
					layer and derives no source, so nothing can ever take it.
				</p>
			) : null}
			{past ? (
				<p className={styles.finding} data-role="transition-exit-past">
					Its exit time is past the end of the timeline its source state plays, so
					the trigger can never arrive late enough. Shorten the wait, or lengthen
					the timeline.
				</p>
			) : null}
			{/*
			 * `machine_exit_within_duration`, said on the row it is about rather than
			 * only in the checks list at the bottom of the panel.
			 *
			 * Read off the resolved numbers and not off the document, because that is
			 * what the rule reads — `mexit(M,T,E), mdur(M,T,D), E > D` — and a
			 * duration that names a motion scale is a different number in a different
			 * universe. So this row can say "not in this design" while the check,
			 * which saw every universe, says the document breaks it, and both are
			 * true: the check is the one that is authoritative and this is the one
			 * that points at where to type.
			 */}
			{timing !== undefined && (timing.exit ?? 0) > timing.duration ? (
				<p className={styles.finding} data-role="transition-exit-long">
					It waits {writeDuration(timing.exit ?? 0)} before it may be taken and
					then takes {writeDuration(timing.duration)} — a debounce longer than the
					move it guards, which reads to a person as a control that has stopped
					responding.
				</p>
			) : null}

			{/*
			 * The curve, as the fourth motion row and the first of them.
			 *
			 * It was a `<select>` writing a bare word, defended by an argument that
			 * proves too much — "a closed menu with no arithmetic in it, nothing
			 * scales it" is equally true of `direction`, `align` and nine others,
			 * every one of which is a Value. So it is a {@link ValueEditor} like the
			 * three durations beside it: it varies, greys, pins, takes a token and
			 * shows what this universe resolved it to. A `curve` token holding
			 * `["easeOut", "springSnappy"]` is a **feel** — one place that decides
			 * whether the design moves like a control or like a toy — and it branches
			 * the space exactly as a `duration` token holding two numbers does.
			 *
			 * Above the three durations, because the curve is what a designer
			 * changes first: how long a move takes is a number you tune, and what
			 * shape it has is the decision.
			 *
			 * `data-role="transition-easing"` is kept from the deleted select so the
			 * e2e walk's selector still finds the control.
			 */}
			<div
				className={styles.motion}
				data-role="transition-easing"
				data-transition={transition.id}
			>
				<ValueEditor
					testId="transition-easing"
					label="Easing"
					type="easing"
					value={transition.easing ?? []}
					tokens={tokensOfType(scene, "easing")}
					fallback={DEFAULT_EASING}
					active={picks[easingVariable]}
					varying={varying.has(easingVariable)}
					reachable={reach?.[easingVariable]}
					pinned={pins[easingVariable]}
					onPin={(index) => onPin(easingVariable, index)}
					preview={(term: Term) => resolveValue(context, [term], easingVariable)}
					onChange={(next) =>
						write(
							{ easing: next.length > 0 ? next : undefined },
							`easing-${machine.id}-${transition.id}`,
						)
					}
				/>
				{/*
				 * The four control points, writing into the *same* value the row
				 * above writes into — one of its alternatives, and not the list.
				 *
				 * It used to hand over `[lit(text)]`, which reads as "put this curve
				 * in the row" and means "delete every other design the row was
				 * holding": a `["easeOut", "springBouncy"]` feel collapsed to one
				 * curve, and the space halved, the moment a handle was nudged. Which
				 * alternative it lands in is `picks[easingVariable]` — the one this
				 * universe is using, because that is the curve the drawing beside the
				 * fields is drawing.
				 */}
				<CurveField
					testId="transition-curve"
					curve={curve}
					value={transition.easing ?? []}
					active={picks[easingVariable]}
					onChange={(next) =>
						write(
							{ easing: next.length > 0 ? next : undefined },
							`curve-${machine.id}-${transition.id}`,
						)
					}
				/>
			</div>

			{/* The row used to hold the easing select as well; with that gone it is
			    the resolved numbers alone, and an empty flex row for a document with
			    no answer set in hand is a gap nobody asked for. */}
			{timing ? (
				<div className={styles.settings}>
					<span className={styles.resolved} data-role="transition-timing">
						{timing.duration}ms
						{timing.delay !== 0 ? `, after ${timing.delay}ms` : ""}
						{timing.stagger !== 0 ? `, ${timing.stagger}ms apart` : ""}
						{timing.exit ? `, not before ${writeDuration(timing.exit)} held` : ""}
					</span>
				</div>
			) : null}

			{MOTION_PROP_NAMES.map(motionRow)}

			{/*
			 * Exit time — Rive's, with one stated departure.
			 *
			 * **We have no untriggered transitions and this does not add any.** It
			 * means precisely: a trigger arriving before the `from` state has been
			 * held this long does not move the machine, and is not remembered. That
			 * is a debounce. Rive would fire the transition later, when the time
			 * elapsed, if the condition still held — and a deferred fire is a state
			 * change nobody's finger caused, arriving at a moment nothing on the page
			 * marks, which is a second animator arguing with the compositor. A
			 * designer who wants "and then it moves on by itself" writes a `load`
			 * edge out of the destination, which `settle()` already follows.
			 *
			 * A `duration` row like the three above it, so it can name the same
			 * motion scale they do: a scale that made every transition brisk and left
			 * one debounce at 400ms would be a scale with a hole in it.
			 */}
			<div
				className={styles.motion}
				data-role="transition-exit"
				data-transition={transition.id}
			>
				<ValueEditor
					testId="transition-exit"
					label="Hold first"
					type="duration"
					value={transition.exit ?? []}
					tokens={tokensOfType(scene, "duration")}
					fallback="0ms"
					active={picks[motionVar(machine.id, transition.id, "exit")]}
					varying={varying.has(motionVar(machine.id, transition.id, "exit"))}
					reachable={reach?.[motionVar(machine.id, transition.id, "exit")]}
					pinned={pins[motionVar(machine.id, transition.id, "exit")]}
					onPin={(index) =>
						onPin(motionVar(machine.id, transition.id, "exit"), index)
					}
					preview={(term: Term) =>
						resolveValue(
							context,
							[term],
							motionVar(machine.id, transition.id, "exit"),
						)
					}
					onChange={(next) =>
						write(
							{ exit: next.length > 0 ? next : undefined },
							`exit-${machine.id}-${transition.id}`,
						)
					}
				/>
			</div>

			<Conditions
				machine={machine}
				transition={transition}
				onSceneChange={onSceneChange}
				impossible={never}
			/>
		</div>
	);
}

export function Transitions({
	scene,
	machine,
	onSceneChange,
	picks,
	varying,
	reach,
	pins,
	onPin,
	timing,
	health,
	impossible,
	misplaced,
	layer,
	onPlay,
}: TransitionsProps) {
	/**
	 * Which edges this list shows, and where a new one starts.
	 *
	 * Filtered by layer where the panel is looking at one, because a transition
	 * runs in exactly one layer and a list that mixed them would offer a `from`
	 * menu of states the edge could not legally leave — `mcrosslayer/2` is the
	 * program's name for an edge that tries. An edge that belongs to no layer at
	 * all (reserved words at both ends) is shown in **every** filtered list rather
	 * than in none, because a row nobody can see is a row nobody can fix, and that
	 * edge is precisely the one somebody has to.
	 */
	const layers = machineLayers(machine);
	const which =
		layer !== undefined && layers.some((l) => l.id === layer) ? layer : undefined;
	const shown =
		which === undefined
			? machine.transitions
			: machine.transitions.filter((t) => {
					const at = layerOfEdge(machine, t);
					return at === undefined || at === which;
				});
	/**
	 * The state a new edge leaves: the start of the layer being looked at, or the
	 * machine's own start where no layer is. Same for the arrival, one along.
	 */
	const first = which === undefined ? machine.states[0] : layerInitial(machine, which);
	const pool = which === undefined ? machine.states : machine.states.filter(
		(s) => layerOf(machine, s) === which,
	);

	return (
		<div className={styles.transitions} data-role="transitions" data-layer={which}>
			<div className={styles.listHead}>
				<span className={styles.title}>Transitions</span>
				<button
					type="button"
					className={styles.add}
					data-role="add-transition"
					title="An edge from the initial state to the next one, on a pointer enter. Nothing about its pacing is written down: an edge that says nothing follows the document's one default, so making everything a little slower is one change rather than N."
					disabled={pool.length === 0}
					onClick={() =>
						onSceneChange(
							(prev) =>
								addTransition(
									prev,
									machine.id,
									first?.id ?? "",
									// The second state where there is one, and back to the
									// first where there is not: a self-edge is a legal thing
									// to write and an honest starting point, where guessing
									// at a state that does not exist would make the first
									// thing the panel says about a new machine a `mdangling`
									// finding the designer did not cause. Both ends come out of
									// **this layer's** states, because an edge that reaches into
									// another layer is `mcrosslayer/2` rather than an edge.
									(pool[1] ?? first)?.id ?? "",
									"pointerenter",
								).scene,
						)
					}
				>
					+ Transition
				</button>
			</div>

			{shown.length === 0 ? (
				<p className={styles.empty} data-role="no-transitions">
					No edges {which === undefined ? "yet" : "in this layer"}, so every state
					but{" "}
					<strong>{first ? stateName(machine, first.id) : "the first"}</strong> is
					unreachable — the states exist and nothing can get to them. A rest/hover
					pair on pointer enter and pointer leave is the one that exports with no
					script in the file.
				</p>
			) : (
				shown.map((transition) => (
					<Row
						key={transition.id}
						scene={scene}
						machine={machine}
						transition={transition}
						picks={picks}
						varying={varying}
						reach={reach}
						pins={pins}
						onPin={onPin}
						timing={timing?.[transition.id]}
						health={health}
						impossible={impossible}
						misplaced={misplaced}
						onPlay={onPlay}
						onSceneChange={onSceneChange}
					/>
				))
			)}
		</div>
	);
}
