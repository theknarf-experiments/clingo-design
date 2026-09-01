import { useState } from "react";

import {
	BLEND_KINDS,
	BLEND_KIND_NAMES,
	type Blend,
	type BlendKind,
	DEFAULT_DURATION_BUDGET_MS,
	DEFAULT_UNIT,
	DIMENSIONS,
	type Dimension,
	FRAME_DIMS,
	type InputValues,
	type Machine,
	type MachineState,
	type ModelMachine,
	PROPS,
	PROP_NAMES,
	type Picks,
	type PropName,
	type ResolveContext,
	type Scene,
	type SceneNode,
	type StatePart,
	TRIGGERS,
	type Term,
	type Token,
	type Value,
	type ValueType,
	addBlendStop,
	addLayer,
	addMachine,
	addMachineCheck,
	addState,
	addTimeline,
	clearStatePart,
	componentDef,
	componentDefs,
	deleteBlendStop,
	deleteLayer,
	deleteMachine,
	deleteState,
	durationBudgetCheck,
	findInTree,
	findInput,
	findState,
	findTransition,
	hasMachineCheck,
	instanceNodes,
	isInstance,
	layerInitial,
	layerOf,
	lit,
	machineCheckFinding,
	machineChecks,
	machineForRoot,
	machineHealth,
	machineLayers,
	materializedParts,
	motionMs,
	nodeNames,
	parseInstancePart,
	parseStatePart,
	propValues,
	removeMachineCheck,
	renameLayer,
	renameMachine,
	renameState,
	reorderLayer,
	reorderState,
	resolveValue,
	setBlendInput,
	setNodeLayerState,
	setStateBlend,
	setStateFrame,
	setStateHidden,
	setStateLayer,
	setStateProp,
	setStateTimeline,
	sharedPropsOfKinds,
	shownStates,
	stateFrameVar,
	stateName,
	statePropVar,
	tokensFor,
	tokensOfType,
	transitionExit,
	updateBlendStop,
	writeDuration,
} from "@clingo-design/design-core";

import { Inputs } from "./Inputs";
import { LayerStrip } from "./LayerStrip";
import { StateStrip } from "./StateStrip";
import { Timeline, suspectKey } from "./Timeline";
import { Transitions } from "./Transitions";
import { ValueEditor, type WhyRow } from "./ValueEditor";
import { cx } from "./cx";
import { fontMenu } from "./fontFiles";
import styles from "./Machines.module.css";

export interface MachinesProps {
	scene: Scene;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/** Picks of the universe on screen, so a delta row resolves like any row. */
	picks: Picks;
	/** Variable keys the solver reports as unsettled. */
	varying: ReadonlySet<string>;
	reach?: Readonly<Record<string, Set<number>>>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	why?: (variable: string) => WhyRow | undefined;
	/**
	 * The current selection. A machine's delta rows are edited against whichever
	 * definition part is selected, and its state strip drives whichever instance
	 * is — so the panel is a view on the selection, not a modal of its own.
	 */
	selection: ReadonlySet<string>;
	onSelectionChange?: (ids: string[]) => void;
	/**
	 * Instance node id -> layer id -> the state the canvas is drawing instead of
	 * the document's. **Editor state, not the document's** — see
	 * `useMachinePlayback`.
	 *
	 * Nested where it used to be flat, and the nesting is the rung: a machine is
	 * in one state *per layer*, all at once, so a flat record could only ever have
	 * carried the first layer's third of the picture.
	 */
	playing: Readonly<Record<string, Readonly<Record<string, string>>>>;
	/** Drive one layer of one instance; null hands that layer back to the document. */
	onPlay: (instance: string, layer: string, state: string | null) => void;
	/**
	 * Instance -> input id -> what the preview is holding. Editor state.
	 *
	 * **Optional, where `rive-ladder-spec.md` §10.6 has these three required.** A
	 * studio that has not wired a playback store yet must still be able to declare
	 * inputs, and the alternative — a required prop — would take the whole panel
	 * out of the build for the length of one other step's edit. A caller that
	 * passes them is exactly the frozen contract; a caller that does not gets the
	 * declaring half and a sentence saying the driving half is not connected.
	 */
	inputs?: Readonly<Record<string, InputValues>>;
	onSetInput?: (instance: string, input: string, value: boolean | number) => void;
	onFireInput?: (instance: string, input: string) => void;
	/** Which layer the panel's strips are showing. Editor state, held by Studio. */
	layer?: string;
	onLayerChange?: (layer: string) => void;
	/**
	 * Instance -> where its timeline scrubber is, in milliseconds, and how to move
	 * it.
	 *
	 * **Two props beyond the frozen five, and they are not optional to the
	 * feature.** `rive-ladder-spec.md` §10.4 puts `at` and `onScrub` on the
	 * timeline editor and §10.5 puts `scrub`/`setScrub` on the playback hook, and
	 * the timeline editor lives inside this panel — so with no way through, the
	 * scrubber could only ever move rows in this list and never the canvas, which
	 * is the one thing it exists to do. Absent, the position is held locally and
	 * says so.
	 */
	scrub?: Readonly<Record<string, number>>;
	onScrub?: (instance: string, ms: number) => void;
	/** What the answer set says about each machine, by machine id. */
	health?: Readonly<Record<string, ModelMachine>>;
	/** Rules the design on screen breaks, so a machine check reads like any rule. */
	broken?: ReadonlySet<string>;
	/** Rules an unsat core blames, likewise. */
	conflict?: ReadonlySet<string>;
}

/**
 * Which instance the panel is showing, and which definition part it is editing.
 *
 * Read off the selection rather than held in the panel, which is the decision
 * worth arguing for. A machine is authored against a *definition* — the delta
 * belongs to the component, not to any one use of it — but everything a designer
 * wants to *see* while authoring it is per instance: which universe's fill this
 * hover resolves to, whether the pin holds, what the canvas is drawing. Two
 * subjects, and a panel that owned its own would immediately disagree with the
 * canvas about both. So the canvas decides: click the label inside a button and
 * the delta rows are the label's; click a second button and the strip drives
 * that one.
 *
 * Three spellings of "a part of this component" are accepted, the same three
 * `materializedParts` reduces, because all three can end up in a selection: the
 * definition's own part (`label`), an instance's copy of it (`inst(b1,label)`,
 * which is what the inspector shows for a derived node) and one state's copy of
 * that (`stt(b1,hover,label)`, which is a member the Rules panel offers).
 *
 * Both answers fall back rather than going missing, and the fallbacks are not
 * symmetrical. The part falls back to the definition's **root**, because a
 * machine that changes nothing about anything still has to be able to say "the
 * whole button lifts on hover" — the root is where that delta goes. The instance
 * falls back to the **first use in the document**, because a panel with no
 * subject can still edit the delta but can say nothing about what it resolves to,
 * and the first use is a better guess than nothing. Where the document holds no
 * use at all, there is genuinely no instance and the panel says so instead of
 * pretending.
 */
function subjectOf(
	scene: Scene,
	machine: Machine,
	selection: ReadonlySet<string>,
	instances: readonly SceneNode[],
): { instance: SceneNode | undefined; part: string } {
	const parts = new Set((componentDef(scene, machine.root)?.parts ?? []).map((p) => p.id));
	let instance: SceneNode | undefined;
	let part: string | undefined;

	for (const id of selection) {
		const inner = parseStatePart(id) ?? parseInstancePart(id);
		const partId = inner ? inner.node : id;
		const holder = inner ? findInTree(scene.nodes, inner.instance) : findInTree(scene.nodes, id);
		if (part === undefined && parts.has(partId)) part = partId;
		if (
			instance === undefined &&
			holder !== undefined &&
			isInstance(holder) &&
			holder.instanceOf === machine.root
		) {
			instance = holder;
		}
	}

	return { instance: instance ?? instances[0], part: part ?? machine.root };
}

/**
 * What one universe resolved one machine's edges to, in whole milliseconds.
 *
 * Four numbers rather than three since the ladder: an exit time is a `duration`
 * Value like a delay, it clamps at zero like a delay and the program `#project`s
 * it like a delay, so a debounce scale holding two ends is two designs and only
 * the solver knows which end is on screen.
 */
type Timing = Record<
	string,
	{ duration: number; delay: number; stagger: number; exit: number }
>;

/**
 * Every edge's pacing: the answer set's number where there is one, the
 * document's own reading where there is not.
 *
 * The answer set first, because a duration that names a token is a different
 * number in a different universe and only the solver knows which one is on
 * screen. The fallback is the same walk `mdur/3` makes — `motionMs` resolves the
 * value, clamps what the table says to clamp, and falls to `MOTION_PROPS`' own
 * default — so a panel with no answer in hand shows the number the exported file
 * would carry rather than a blank. One function because three readers want it:
 * the transition rows, the budget check, and the transition preview, which has
 * to wait the right length of time.
 */
function timingFor(
	machine: Machine,
	answer: ModelMachine | undefined,
	context: ResolveContext,
): Timing {
	return Object.fromEntries(
		machine.transitions.map((t) => [
			t.id,
			{
				duration: answer?.duration[t.id] ?? motionMs(machine, t, "duration", context),
				delay: answer?.delay[t.id] ?? motionMs(machine, t, "delay", context),
				stagger: answer?.stagger[t.id] ?? motionMs(machine, t, "stagger", context),
				// Through `transitionExit` rather than `motionMs`, because `exit` is not
				// a `MotionProp` — `MOTION_PROPS` still has three entries and
				// `motionMs` reads that table. One function each until the day the
				// fourth entry lands, at which point both readings become the same
				// call. The clamp at zero is the same one either way.
				exit: answer?.exit[t.id] ?? transitionExit(machine, t, context),
			},
		]),
	);
}

/**
 * What is wrong with the machines, in the panel's own words — read off the
 * **document** rather than out of the answer set, and that is not an oversight.
 *
 * The two readings are held equal by `machines.test.ts`, so on a satisfiable
 * document it makes no difference which one is shown. On an unsatisfiable one it
 * makes all the difference: there is no answer set, `health` is empty, and a
 * panel reading it would go quiet at exactly the moment a designer is looking for
 * the thing they broke. The answer set's copy of these findings earns its keep
 * elsewhere — it is what a `viol/1` reads, so it is what lands in an unsat core
 * with a name — and it is what the *motion* half of this reads, because a
 * duration is a fact about one universe and cannot be read off the document
 * alone.
 *
 * Across every machine at once, because that is the scope the rules have: the
 * canned bodies are anonymous in every argument (`munreached(_,_)`), so a check
 * is a claim about the document and not about one machine. The machine's name is
 * only put in front of a phrase where there is more than one to confuse.
 *
 * ## Eleven checks, five sentences here and six from design-core
 *
 * The four graph checks and the budget keep their sentences in this file,
 * because they were written when those checks shipped and a second spelling of
 * "Ghost cannot be reached" would be a second spelling that drifts. The six the
 * ladder added get theirs from {@link machineCheckFinding}, which is exported
 * for exactly this and is documented as "the six the ladder added, and `null`
 * for everything else, including a check id it has never heard of" — so it is
 * spelled here as the `default:` branch after this switch's own cases rather
 * than as five more `case`s that would have to be kept in step with a list in
 * another package.
 *
 * The budget is the one check that could not be answered from a document at all:
 * what a transition takes is `mdur/3` in an answer set, which is why this
 * function is handed a {@link Timing} table and `machineCheckFinding` is not.
 */
function findingFor(
	check: string,
	machines: readonly Machine[],
	timings: Readonly<Record<string, Timing>>,
	budget: number,
): string | null {
	const phrases: string[] = [];
	for (const machine of machines) {
		const health = machineHealth(machine);
		const states = (ids: readonly string[]) =>
			ids.map((id) => stateName(machine, id)).join(", ");
		// The document's reading, handed on so `machineCheckFinding` does not walk
		// the machine a second time per row: eleven rows times N machines is eleven
		// walks of the same graph otherwise.
		let phrase: string | null = machineCheckFinding(check, machine, health);
		switch (check) {
			case "machine_reachable":
				if (health.unreachable.length > 0) {
					phrase = `${states(health.unreachable)} cannot be reached`;
				}
				break;
			case "machine_no_dead_ends":
				if (health.deadEnds.length > 0) phrase = `nothing leaves ${states(health.deadEnds)}`;
				break;
			case "machine_deterministic":
				if (health.nondeterministic.length > 0) {
					phrase = `${health.nondeterministic
						.map(
							([state, trigger]) =>
								`${stateName(machine, state)} on ${TRIGGERS[trigger].label.toLowerCase()}`,
						)
						.join(", ")} goes two ways`;
				}
				break;
			case "machine_wired":
				if (health.dangling.length > 0) {
					phrase = `${health.dangling.join(", ")} names a state that is gone`;
				}
				break;
			case "machine_within_budget": {
				const over = machine.transitions.filter(
					(t) => (timings[machine.id]?.[t.id]?.duration ?? 0) > budget,
				);
				if (over.length > 0) {
					phrase = over
						.map(
							(t) => `${t.id} takes ${writeDuration(timings[machine.id][t.id].duration)}`,
						)
						.join(", ");
				}
				break;
			}
		}
		if (phrase !== null) {
			phrases.push(machines.length > 1 ? `${machine.name}: ${phrase}` : phrase);
		}
	}
	return phrases.length === 0 ? null : phrases.join(" · ");
}

/**
 * The budget the document is currently holding this tool to, read back out of
 * the rule the tool wrote.
 *
 * A field has to show what is in force, and what is in force is the number in
 * the ASP — not one this component remembers, which would drift the moment
 * anybody undid, loaded another document or edited the rule by hand. Read with a
 * pattern loose enough to survive a body somebody has added a literal to and
 * strict enough to want the comparison it wrote; anything it cannot read falls
 * back to the default, which is the honest answer for a rule that has stopped
 * being this rule.
 */
const BUDGET = /viol\(\s*machine_within_budget\s*\)\s*:-[^\n]*?Ms\s*>\s*(\d+)/;
const budgetOf = (rules: string): number => {
	const match = BUDGET.exec(rules);
	return match ? Number(match[1]) : DEFAULT_DURATION_BUDGET_MS;
};

/**
 * The five checks, each offered as an ordinary rule and none of them applied
 * unasked.
 *
 * The panel *reports* all five whatever the document says, and *forbids* only
 * the ones a designer ticks — which is the whole shape of this tool, applied to
 * machines. A dead end is not a mistake: "once it is submitted it stays
 * submitted" is a machine somebody meant. So the finding is always visible, and
 * the ban is a checkbox that produces a `custom` constraint with an enable
 * switch, a strength that can be softened to a preference, a name in the unsat
 * core, and `why` and `relax` for free — none of which the yellow triangle every
 * other tool draws here could ever have.
 *
 * Ticking and unticking both go through `machinecheck.ts` rather than through
 * `addCustomConstraint` and a string append written here, because a check is two
 * writes that have to agree: a constraint with no rule is a switch that can never
 * fire, and a rule with no constraint is never guarded and so never fires either.
 * Keeping the pair honest is that file's whole job, and doing it a second way in
 * a panel is how the two spellings drift.
 */
function Checks({
	scene,
	machines,
	timings,
	onSceneChange,
	broken,
	conflict,
}: {
	scene: Scene;
	machines: readonly Machine[];
	timings: Readonly<Record<string, Timing>>;
	onSceneChange: MachinesProps["onSceneChange"];
	broken?: ReadonlySet<string>;
	conflict?: ReadonlySet<string>;
}) {
	const budget = budgetOf(scene.rules);
	return (
		<div className={styles.checks} data-role="checks">
			{machineChecks(budget).map((check) => {
				const finding = findingFor(check.id, machines, timings, budget);
				const held = hasMachineCheck(scene, check);
				const blamed = conflict?.has(check.id) ?? false;
				const failing = broken?.has(check.id) ?? false;
				return (
					<div
						key={check.id}
						className={cx(
							styles.check,
							finding !== null && styles.failing,
							blamed && styles.blamed,
						)}
						data-check={check.id}
						data-failing={finding !== null ? "" : undefined}
					>
						<label className={styles.checkLabel}>
							<input
								type="checkbox"
								data-role="machine-check"
								aria-label={check.label}
								checked={held}
								title={
									held
										? "Stop forbidding it. The finding stays; only the rule goes."
										: `Forbid it, as a rule you own: ${check.rule}`
								}
								onChange={(e) =>
									onSceneChange((prev) =>
										e.target.checked
											? addMachineCheck(prev, check)
											: removeMachineCheck(prev, check),
									)
								}
							/>
							{check.id === "machine_within_budget" ? (
								<>
									No transition longer than
									<input
										className={styles.budget}
										data-role="budget"
										type="number"
										min={0}
										step={50}
										aria-label="Longest a transition may take, in milliseconds"
										value={budget}
										// Written straight back into the rule, because the rule is
										// where the number lives — `addMachineCheck` is documented
										// as authoritative about the body for exactly this field.
										// Only where the check is already held: typing into it
										// otherwise would add a rule nobody asked for.
										disabled={!held}
										onChange={(e) =>
											onSceneChange(
												(prev) =>
													addMachineCheck(
														prev,
														durationBudgetCheck(Number(e.target.value)),
													),
												"machine-budget",
											)
										}
									/>
									ms
								</>
							) : (
								check.label
							)}
						</label>
						<span className={styles.finding}>
							{finding ?? "holds"}
							{held && blamed ? " — and your rule says it must not" : null}
							{held && !blamed && failing ? " — your rule is a preference here" : null}
						</span>
					</div>
				);
			})}
		</div>
	);
}

/**
 * What one state changes about one part — the delta, as rows.
 *
 * Only what the state actually says is a row, and that is the feature rather
 * than an economy. A state is a *diff* of the definition, so a panel that listed
 * every property with most of them empty would be showing a second copy of the
 * component and asking the designer to spot the difference; the whole argument
 * for a delta over a duplicated subtree is that "what does hover change?" is
 * written down. Adding a row is therefore an explicit act, and it starts from
 * the value the definition already holds, so the first thing the row says is
 * true and the edit is a change to it.
 *
 * Every row is an ordinary {@link ValueEditor}, which is what makes a state's
 * fill able to name a token, hold alternatives, and be pinned and asked about
 * like anything else. A delta that holds two fills is two designs — the one
 * place a state may legitimately branch the space, because the branching came
 * from a value with two entries and not from the state.
 */
function StateDelta({
	scene,
	machine,
	state,
	part,
	instance,
	picks,
	varying,
	reach,
	pins,
	onPin,
	why,
	onSceneChange,
	onSelectionChange,
}: {
	scene: Scene;
	machine: Machine;
	/** The state whose delta this is — the one being played, or the one drawn. */
	state: string;
	/** The definition part id. */
	part: string;
	/** The use of the component the values are resolved against, if there is one. */
	instance: SceneNode | undefined;
	picks: Picks;
	varying: ReadonlySet<string>;
	reach?: Readonly<Record<string, Set<number>>>;
	pins: Readonly<Record<string, number>>;
	onPin: MachinesProps["onPin"];
	why?: MachinesProps["why"];
	onSceneChange: MachinesProps["onSceneChange"];
	onSelectionChange?: (ids: string[]) => void;
}) {
	const unit = scene.unit ?? DEFAULT_UNIT;
	const names = nodeNames(scene.nodes);
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	const node = findInTree(scene.nodes, part);
	const delta: StatePart = findState(machine, state)?.parts[part] ?? {};
	const copied = materializedParts(scene, machine).has(part);

	/**
	 * The variable this row's value resolves under, where there is a use of the
	 * component to resolve it in.
	 *
	 * `sprop(I,S,N,P)` is per *instance*, because the override's value is the
	 * instance's own — two buttons hover to two different fills exactly as they
	 * rest at two different ones. So with nothing using the component yet there is
	 * no variable, no pick and no answer, and the row is still perfectly editable:
	 * the alternatives are in the document either way, and it is only the
	 * questions *about the answer* that go quiet.
	 */
	const propKey = (prop: PropName): string | undefined =>
		instance ? statePropVar(instance.id, state, part, prop) : undefined;
	const dimKey = (dim: Dimension): string | undefined =>
		instance ? stateFrameVar(instance.id, state, part, dim) : undefined;

	const held = PROP_NAMES.filter((prop) => (delta.props?.[prop]?.length ?? 0) > 0);
	const moved = DIMENSIONS.filter((dim) => (delta.frame?.[dim]?.length ?? 0) > 0);
	const spare = node
		? sharedPropsOfKinds([node.kind]).filter((prop) => !held.includes(prop))
		: [];
	const spareDims = DIMENSIONS.filter((dim) => !moved.includes(dim));

	/** A row a designer adds starts at what the part is now, not at a fallback. */
	const startingProp = (prop: PropName): Value =>
		node?.props?.[prop] && node.props[prop].length > 0
			? node.props[prop]
			: [lit(PROPS[prop].fallback)];
	const startingDim = (dim: Dimension): Value =>
		node?.frame?.[dim] && node.frame[dim].length > 0
			? node.frame[dim]
			: [lit(FRAME_DIMS[dim].fallback)];

	function row(
		field: string,
		label: string,
		type: ValueType,
		fallback: string,
		value: Value,
		variable: string | undefined,
		tokens: readonly Token[],
		write: (next: Value | undefined) => void,
	) {
		return (
			<div
				key={field}
				className={styles.delta}
				data-role="state-delta"
				data-state={state}
				data-part={part}
				data-field={field}
			>
				<ValueEditor
					testId={`state-${field}`}
					label={label}
					type={type}
					value={value}
					tokens={tokens}
					unit={unit}
					fallback={fallback}
					names={names}
					// A state that changes the typeface is a delta on a font row, and it
					// wants the same menu the node's own row has — a hover that switches
					// to a family this page uploaded is the whole point of uploading one.
					options={fontMenu(scene, type)}
					active={variable ? picks[variable] : undefined}
					varying={variable ? varying.has(variable) : undefined}
					reachable={variable ? reach?.[variable] : undefined}
					pinned={variable ? pins[variable] : undefined}
					onPin={variable ? (index) => onPin(variable, index) : undefined}
					why={variable ? why?.(variable) : undefined}
					// With no use of the component there is no variable to key a pick
					// off, so the preview reads the first alternative — which is what
					// `activeIndex` does for any variable nothing has picked yet.
					preview={(term: Term) => resolveValue(context, [term], variable ?? "")}
					onChange={(next) => write(next)}
				/>
				<button
					type="button"
					className={styles.clear}
					data-role="clear-delta"
					title="Let this state say nothing here, and share the component's own value"
					onClick={() => write(undefined)}
				>
					×
				</button>
			</div>
		);
	}

	return (
		<div className={styles.deltas} data-role="state-parts" data-part={part}>
			<div className={styles.deltaHead}>
				<button
					type="button"
					className={styles.subject}
					data-role="select-part"
					title="Select this part on the canvas. Selecting another one edits that one instead."
					onClick={() => onSelectionChange?.([part])}
				>
					{names[part] ?? part}
				</button>
				<span className={styles.copies} data-role="materialised">
					{copied
						? "copied per state"
						: "shared — nothing needs a copy of it yet"}
				</span>
			</div>

			{/*
			 * Hiding is the one structural verb a state has, and it is the one that
			 * needs a sentence about the export attached to it rather than left in a
			 * loss line the designer reads after the fact.
			 *
			 * A selector can restyle an element and cannot write one. So a part the
			 * *drawn* state hides is not in the exported markup at all, and no other
			 * state can bring it back: a dropdown drawn in `closed` exports as a
			 * closed dropdown with no behaviour, which is the most obvious machine
			 * anybody builds and the one that would otherwise ship inert. The way
			 * round it is one click — draw the use in the state that shows the most,
			 * with ◉ in the strip above — and this is where a person is standing when
			 * they need to know that.
			 */}
			<label
				className={styles.hidden}
				data-role="state-hidden"
				title="A state may take a part out of the picture; it may not put one back. The exported file writes the markup once, from the state this use is drawn in, and a selector can restyle an element but cannot write one — so a part hidden in the drawn state is missing from the file in every state. Draw the use in the state that shows the most (◉ above), and hide from there."
			>
				<input
					type="checkbox"
					checked={delta.hidden === true}
					onChange={(e) =>
						onSceneChange((prev) =>
							setStateHidden(prev, machine.id, state, part, e.target.checked),
						)
					}
				/>
				Out of the picture in this state
			</label>

			{held.map((prop) =>
				row(
					prop,
					PROPS[prop].label,
					PROPS[prop].type,
					PROPS[prop].fallback,
					delta.props?.[prop] ?? [],
					propKey(prop),
					tokensFor(scene, prop),
					(next) =>
						onSceneChange(
							(prev) => setStateProp(prev, machine.id, state, part, prop, next),
							`delta-${machine.id}-${state}-${part}-${prop}`,
						),
				),
			)}

			{moved.map((dim) =>
				row(
					dim,
					FRAME_DIMS[dim].label,
					FRAME_DIMS[dim].type,
					FRAME_DIMS[dim].fallback,
					delta.frame?.[dim] ?? [],
					dimKey(dim),
					tokensOfType(scene, FRAME_DIMS[dim].type),
					(next) =>
						onSceneChange(
							(prev) => setStateFrame(prev, machine.id, state, part, dim, next),
							`delta-${machine.id}-${state}-${part}-${dim}`,
						),
				),
			)}

			{held.length === 0 && moved.length === 0 && delta.hidden !== true ? (
				<p className={styles.empty} data-role="no-delta">
					{stateName(machine, state)} changes nothing about this part, so it draws
					the component's own values — one variable shared by every state, not a
					copy per state.
				</p>
			) : null}

			<div className={styles.deltaFoot}>
				<select
					className={styles.add}
					data-role="add-delta"
					value=""
					title="Something this state changes about this part"
					onChange={(e) => {
						const field = e.target.value;
						if (!field) return;
						if ((DIMENSIONS as readonly string[]).includes(field)) {
							const dim = field as Dimension;
							onSceneChange((prev) =>
								setStateFrame(prev, machine.id, state, part, dim, startingDim(dim)),
							);
							return;
						}
						const prop = field as PropName;
						onSceneChange((prev) =>
							setStateProp(prev, machine.id, state, part, prop, startingProp(prop)),
						);
					}}
				>
					<option value="">+ Change</option>
					{spare.length > 0 ? (
						<optgroup label="Appearance">
							{spare.map((prop) => (
								<option key={prop} value={prop}>
									{PROPS[prop].label}
								</option>
							))}
						</optgroup>
					) : null}
					{spareDims.length > 0 ? (
						<optgroup label="Geometry">
							{spareDims.map((dim) => (
								<option key={dim} value={dim}>
									{FRAME_DIMS[dim].label}
								</option>
							))}
						</optgroup>
					) : null}
				</select>
				<button
					type="button"
					className={styles.add}
					data-role="clear-delta"
					disabled={held.length === 0 && moved.length === 0 && delta.hidden !== true}
					title="Everything this state says about this part, gone"
					onClick={() =>
						onSceneChange((prev) => clearStatePart(prev, machine.id, state, part))
					}
				>
					Clear
				</button>
			</div>
		</div>
	);
}

/**
 * What one state plays: nothing, a timeline, or a mixture of them.
 *
 * **This is a property of a state and it is edited where the state is**, which
 * is the whole reason it is here rather than in the timeline editor. A timeline
 * belongs to the machine and is routinely played by two states — a `loop` and a
 * `pressed` both playing `idle` — so "which timeline does this play" is a
 * sentence about the state, and putting the control on the timeline would make
 * it a sentence about a thing that has several answers at once.
 *
 * **A state's settled pose is the timeline's last keyframe, and it is derived.**
 * The state still has its own delta, and the two compose exactly as everything
 * else here does: the timeline decides what it has a track for and the delta
 * decides the rest. Nothing is stored twice, so moving the last keyframe moves
 * the picture rather than leaving it behind.
 *
 * **A state holding both a timeline and a blend is reported, never repaired.**
 * The blend wins where a document somehow holds both — that is `MachineState`'s
 * own shipped rule — and `mtwosource/2` says so out loud, because a state with
 * two sources is a mistake a person should see rather than one a reader should
 * quietly pick a side in. So the two controls are both live and the sentence
 * appears underneath.
 */
function Plays({
	machine,
	state,
	twoSource,
	stopsOutOfRange,
	gap,
	onSceneChange,
}: {
	machine: Machine;
	state: MachineState;
	twoSource: boolean;
	/** 1-based stop numbers outside the blend input's own range. */
	stopsOutOfRange: ReadonlySet<number>;
	/** The stops do not cover the input's range — legal, and worth saying. */
	gap: boolean;
	onSceneChange: MachinesProps["onSceneChange"];
}) {
	const timelines = machine.timelines ?? [];
	const layers = machineLayers(machine);
	const numbers = (machine.inputs ?? []).filter((x) => x.kind === "number");
	const blend = state.blend;

	/**
	 * A fresh blend starts `oneD` with no stops, on the first number input there
	 * is.
	 *
	 * With no stops rather than with one, because a stop names a timeline and
	 * inventing which timeline somebody meant to mix is a guess this panel cannot
	 * make — and a blend with one stop plays that stop flat everywhere, which
	 * looks like a working mixture and is not one.
	 */
	const fresh = (): Blend => ({
		kind: "oneD",
		...(numbers[0] ? { input: numbers[0].id } : {}),
		stops: [],
	});

	/**
	 * Where a new 1D stop lands: an end of the input's own declared range.
	 *
	 * The bottom for the first stop and the top for every one after it, out of the
	 * strings the document holds rather than out of `inputRange`'s thousandths,
	 * because those strings are exactly what the field beside it edits. A range
	 * nobody stated has no ends to use, so it falls back to `0` and then to the
	 * count — which stacks two stops on one threshold if somebody keeps pressing,
	 * and that is visible in the row and fixed by typing rather than hidden by a
	 * clever guess about an axis the document has not described.
	 */
	const along = blend === undefined ? undefined : findInput(machine, blend.input);
	const nextAt = (): string | undefined => {
		if (blend === undefined || blend.kind !== "oneD") return undefined;
		if (blend.stops.length === 0) return along?.min ?? "0";
		return along?.max ?? String(blend.stops.length);
	};

	return (
		<div className={styles.plays} data-role="state-plays" data-state={state.id}>
			{/*
			 * Which layer this state belongs to.
			 *
			 * Here rather than on the chip in the strip above, and the reason is what
			 * the control does: moving a state to another layer takes it out of the
			 * strip it is being edited in, so a select on the chip would be a menu
			 * that makes the thing it is attached to disappear. Here it sits with the
			 * state's other whole-state facts — what it plays, what it mixes — and the
			 * strip re-renders around it.
			 *
			 * `null` is the first layer and is written as *absence*, not as the first
			 * layer's id, because absent-is-first is what every document written
			 * before layers existed means and a writer that filled the field in would
			 * change nothing today and everything the moment somebody reordered the
			 * layers.
			 */}
			<label className={styles.play}>
				<span className={styles.playLabel}>In</span>
				<select
					className={styles.select}
					data-role="state-layer"
					aria-label="Layer this state belongs to"
					title="Which layer this state is one of. A machine is in one state per layer at once, so moving a state here changes what it composes with rather than what it replaces."
					value={layerOf(machine, state)}
					onChange={(e) =>
						onSceneChange((prev) =>
							setStateLayer(
								prev,
								machine.id,
								state.id,
								e.target.value === layers[0].id ? null : e.target.value,
							),
						)
					}
				>
					{layers.map((l) => (
						<option key={l.id} value={l.id}>
							{l.name}
						</option>
					))}
				</select>
			</label>

			<label className={styles.play}>
				<span className={styles.playLabel}>Plays</span>
				<select
					className={styles.select}
					data-role="state-timeline"
					aria-label="Timeline this state plays"
					title="A timeline this state plays from its start. Its settled pose — what a cross-state rule compares and what the canvas draws at rest — is the timeline at its own length, derived rather than stored."
					value={state.timeline ?? ""}
					disabled={timelines.length === 0}
					onChange={(e) =>
						onSceneChange((prev) =>
							setStateTimeline(
								prev,
								machine.id,
								state.id,
								e.target.value || null,
							),
						)
					}
				>
					<option value="">nothing</option>
					{timelines.map((w) => (
						<option key={w.id} value={w.id}>
							{w.name}
						</option>
					))}
				</select>

				<button
					type="button"
					className={styles.add}
					data-role="toggle-blend"
					title={
						blend === undefined
							? "Mix several timelines by a number input. None of the mixing is solved and none of it can be — the input is not in the program — but every keyframe of every timeline a stop names is, and so are the thresholds the checks judge."
							: "Take the mixture away. The timelines stay in the machine."
					}
					onClick={() =>
						onSceneChange((prev) =>
							setStateBlend(
								prev,
								machine.id,
								state.id,
								blend === undefined ? fresh() : null,
							),
						)
					}
				>
					{blend === undefined ? "+ Blend" : "− Blend"}
				</button>
			</label>

			{blend !== undefined ? (
				<div className={styles.blend} data-role="blend">
					<div className={styles.blendHead}>
						<select
							className={styles.select}
							data-role="blend-kind"
							aria-label="Blend kind"
							title="1D lays the stops along one number input's axis and mixes the two either side of it. Direct gives every stop its own weight input, which is a mixture nothing interpolates between."
							value={blend.kind}
							onChange={(e) =>
								onSceneChange((prev) =>
									setStateBlend(prev, machine.id, state.id, {
										...blend,
										kind: e.target.value as BlendKind,
									}),
								)
							}
						>
							{BLEND_KIND_NAMES.map((kind) => (
								<option key={kind} value={kind}>
									{BLEND_KINDS[kind].label}
								</option>
							))}
						</select>

						{blend.kind === "oneD" ? (
							<select
								className={styles.select}
								data-role="blend-input"
								aria-label="Blend input"
								title="The number input the stops are laid out along. Its declared range is what `mstopout/3` judges the thresholds against — and a range nobody stated is open, so the check simply stays quiet."
								value={blend.input ?? ""}
								onChange={(e) =>
									onSceneChange((prev) =>
										setBlendInput(
											prev,
											machine.id,
											state.id,
											e.target.value || null,
										),
									)
								}
							>
								<option value="">no input</option>
								{numbers.map((x) => (
									<option key={x.id} value={x.id}>
										{x.name || x.id}
									</option>
								))}
							</select>
						) : null}

						<button
							type="button"
							className={styles.add}
							data-role="add-blend-stop"
							disabled={timelines.length === 0}
							title={
								timelines.length === 0
									? "A stop plays a timeline, and this machine has none yet."
									: "Another timeline in the mixture, at an end of the input's own range."
							}
							onClick={() =>
								onSceneChange((prev) =>
									addBlendStop(
										prev,
										machine.id,
										state.id,
										timelines[0].id,
										nextAt(),
									),
								)
							}
						>
							+ Stop
						</button>
					</div>

					{blend.stops.map((stop, i) => (
						<div
							// The index is the identity, because a stop has none: deleting
							// stop 2 really does make stop 3 into stop 2, in the document and
							// in `mstopat/4`, and a synthetic key would be pretending
							// otherwise.
							key={i}
							className={cx(
								styles.stop,
								stopsOutOfRange.has(i + 1) && styles.outside,
							)}
							data-role="blend-stop"
							data-stop={i + 1}
						>
							<span className={styles.stopIndex}>{i + 1}</span>
							<select
								className={styles.select}
								data-role="stop-timeline"
								aria-label="Timeline this stop plays"
								value={stop.timeline}
								onChange={(e) =>
									onSceneChange((prev) =>
										updateBlendStop(prev, machine.id, state.id, i + 1, {
											timeline: e.target.value,
										}),
									)
								}
							>
								{timelines.some((w) => w.id === stop.timeline) ? null : (
									<option value={stop.timeline}>
										{stop.timeline} — no such timeline
									</option>
								)}
								{timelines.map((w) => (
									<option key={w.id} value={w.id}>
										{w.name}
									</option>
								))}
							</select>

							{blend.kind === "oneD" ? (
								<input
									className={styles.threshold}
									data-role="stop-at"
									aria-label="Where on the axis this stop sits"
									title="Where on the input's axis this stop sits. Read as a ratio in thousandths, which is the integer `mstopat/4` carries and the one the checks compare against the input's range."
									value={stop.at ?? ""}
									onChange={(e) =>
										onSceneChange(
											(prev) =>
												updateBlendStop(prev, machine.id, state.id, i + 1, {
													at: e.target.value === "" ? null : e.target.value,
												}),
											`stop-at-${machine.id}-${state.id}-${i + 1}`,
										)
									}
								/>
							) : (
								<select
									className={styles.select}
									data-role="stop-by"
									aria-label="The input that is this stop's weight"
									value={stop.by ?? ""}
									onChange={(e) =>
										onSceneChange((prev) =>
											updateBlendStop(prev, machine.id, state.id, i + 1, {
												by: e.target.value || null,
											}),
										)
									}
								>
									<option value="">no weight</option>
									{numbers.map((x) => (
										<option key={x.id} value={x.id}>
											{x.name || x.id}
										</option>
									))}
								</select>
							)}

							<button
								type="button"
								className={styles.clear}
								data-role="delete-blend-stop"
								title="Take this stop out of the mixture."
								onClick={() =>
									onSceneChange((prev) =>
										deleteBlendStop(prev, machine.id, state.id, i + 1),
									)
								}
							>
								×
							</button>
						</div>
					))}

					{blend.stops.length === 0 ? (
						<p className={styles.empty} data-role="no-stops">
							No stops, so this blend mixes nothing. Every keyframe of every
							timeline a stop names is solved; the mixing itself is arithmetic
							over a runtime value and is not.
						</p>
					) : null}

					{gap ? (
						<p className={styles.trouble} data-role="blend-gap">
							The stops do not cover the input's whole range, so part of the axis
							plays one timeline flat. Legal, sometimes meant, and worth knowing.
						</p>
					) : null}
					{stopsOutOfRange.size > 0 ? (
						<p className={styles.trouble} data-role="blend-outside">
							{stopsOutOfRange.size === 1 ? "A stop sits" : "Stops sit"} outside
							the input's own range, where the input can never be, so{" "}
							{stopsOutOfRange.size === 1 ? "it plays" : "they play"} nothing.
						</p>
					) : null}
				</div>
			) : null}

			{twoSource ? (
				<p className={styles.trouble} data-role="two-source">
					This state holds a timeline <em>and</em> a blend. The blend wins, and the
					pair is reported rather than repaired — a state with two sources is a
					mistake to see rather than one to be quietly decided for.
				</p>
			) : null}
		</div>
	);
}

/**
 * One machine: what it drives, its states, what a state changes, its edges, and
 * what is wrong with it.
 *
 * A list and not a graph, which was a real decision and not a shortcut. A node
 * graph is what every other tool draws, and it is the right picture for a
 * machine somebody is *reading*; it is a poor surface for one somebody is
 * *editing*, because the thing being edited is almost never the topology. It is
 * the delta — what hover changes — and a canvas of boxes and arrows has nowhere
 * to put a fill row with a token menu, a pin and a why button, so it grows a
 * side panel and the graph becomes a picture beside the editor rather than the
 * editor. The four or five states a component machine actually has read
 * perfectly well as a strip, and the transitions read as sentences under them.
 */
function MachineCard({
	scene,
	machine,
	timing,
	onSceneChange,
	picks,
	varying,
	reach,
	pins,
	onPin,
	why,
	selection,
	onSelectionChange,
	playing,
	onPlay,
	inputs,
	onSetInput,
	onFireInput,
	layer,
	onLayerChange,
	scrub,
	onScrub,
	health,
}: {
	scene: Scene;
	machine: Machine;
	/** What this universe paces this machine's edges at — see {@link timingFor}. */
	timing: Timing;
} & Omit<MachinesProps, "scene" | "broken" | "conflict">) {
	const def = componentDef(scene, machine.root);
	const instances = instanceNodes(scene).filter((n) => n.instanceOf === machine.root);
	const { instance, part } = subjectOf(scene, machine, selection, instances);
	const names = nodeNames(scene.nodes);

	/**
	 * Which layer this card is pointed at.
	 *
	 * The prop first, because Studio holds one selection for the whole panel and
	 * a card that ignored it would disagree with whatever else reads it; then this
	 * card's own memory, because the prop is one string and this list may hold
	 * several machines with different layers; then the first layer, which is what
	 * every un-layered machine has and is the reading `StateStrip` documents for
	 * an absent `layer`.
	 */
	const layers = machineLayers(machine);
	const [remembered, setRemembered] = useState<string | undefined>(undefined);
	const has = (id: string | undefined): id is string =>
		id !== undefined && layers.some((l) => l.id === id);
	const looking = has(layer) ? layer : has(remembered) ? remembered : layers[0].id;
	const look = (id: string) => {
		setRemembered(id);
		onLayerChange?.(id);
	};

	/**
	 * What each layer is showing, and what the canvas is playing in each.
	 *
	 * `shownStates` is the document's answer for every layer at once — it is the
	 * same walk the compiler makes to emit `shown/2`, including its refusal to
	 * draw a state that has since moved to another layer — and with no use of the
	 * component in the document there is nothing to ask it about, so each layer
	 * falls back to its own first state. That fallback is what lets the panel
	 * still edit a machine nothing has used yet.
	 */
	const shownByLayer: Readonly<Record<string, string>> = instance
		? shownStates(machine, instance)
		: Object.fromEntries(
				layers
					.map((l) => [l.id, layerInitial(machine, l.id)?.id])
					.filter((pair): pair is [string, string] => pair[1] !== undefined),
			);
	const playedByLayer = instance ? (playing[instance.id] ?? {}) : {};

	const shown = shownByLayer[looking] ?? "";
	const played = playedByLayer[looking];
	/**
	 * The state being edited is the state being looked at.
	 *
	 * Playing one and editing one are deliberately the same act, which saves the
	 * panel a third notion of "current" that could disagree with the canvas. It
	 * costs nothing to be generous with: every state's values are already in the
	 * one answer set, so playing one is the canvas reading a different entry out of
	 * the model it has — no solve, no re-ground, nothing in undo. *Drawing* an
	 * instance in a state is the other verb, it is an edit, and the strip keeps
	 * the two visibly apart.
	 */
	const editing = played ?? shown;
	const editingState = findState(machine, editing);

	/**
	 * What is wrong with this machine — the answer set's reading where there is
	 * one, the document's where there is not.
	 *
	 * The order matters and it is the opposite of the checks': there, the document
	 * is authoritative because a finding has to be showable while the solve is
	 * unsatisfiable. Here the answer set goes first because these lists are what
	 * *mark* rows, and a mark that disagreed with the sentence beside it would be
	 * worse than either. An empty array from the answer set is an answer and not
	 * an absence, so `??` falls through only when the machine is missing from the
	 * model entirely — which is what a solve asked for without `scenery` looks
	 * like.
	 */
	const answer = health?.[machine.id];
	const doc = machineHealth(machine);
	const unreachable = new Set(answer?.unreachable ?? doc.unreachable);
	const reachable = new Set(
		machine.states.map((s) => s.id).filter((id) => !unreachable.has(id)),
	);
	const deadWithGuards = new Set(
		answer?.unreachableWithGuards ?? doc.unreachableWithGuards,
	);
	const impossible = new Set(answer?.impossible ?? doc.impossible);
	const misplaced = new Set(answer?.misplaced ?? doc.misplaced);
	/**
	 * Every layer named in a fight, over paint, geometry **or rotation**.
	 *
	 * All three families, because they are one finding: a designer told two layers
	 * argue over `fill` and not that they also argue over `rotateZ` fixes half of
	 * it and comes back. The two readings spell the rotation family differently —
	 * `MachineHealth.turnFights` against `ModelMachine.rotationFights` — which is
	 * a seam in the two packages and not a difference in the claim.
	 */
	const fighting = new Set<string>();
	for (const [first, second] of [
		...(answer?.fights ?? doc.fights),
		...(answer?.frameFights ?? doc.frameFights),
		...(answer?.rotationFights ?? doc.turnFights),
	]) {
		fighting.add(first);
		fighting.add(second);
	}

	/**
	 * Inputs no guard and no blend reads, so a row can say it is unused.
	 *
	 * Blends counted as readers as well as guards, which the predicate name
	 * `unread` might not suggest: an input that decides nothing about which edges
	 * may be taken but lays out a mixture is very much being read, and telling
	 * somebody it is not would send them to delete it.
	 */
	const readInputs = new Set<string>();
	for (const t of machine.transitions) {
		for (const c of t.conditions ?? []) readInputs.add(c.input);
	}
	for (const s of machine.states) {
		if (s.blend?.input !== undefined) readInputs.add(s.blend.input);
		for (const stop of s.blend?.stops ?? []) {
			if (stop.by !== undefined) readInputs.add(stop.by);
		}
	}
	const unreadInputs = new Set(
		(machine.inputs ?? []).map((x) => x.id).filter((id) => !readInputs.has(id)),
	);

	/** Which timeline the editor below is open on, and where its scrubber is. */
	const timelines = machine.timelines ?? [];
	const [opened, setOpened] = useState<string | undefined>(undefined);
	const open = timelines.find((w) => w.id === opened) ?? timelines[0];
	const [localScrub, setLocalScrub] = useState(0);
	/**
	 * The shared position is only read where there is a way to write it.
	 *
	 * Not defensiveness: `scrub` without `onScrub` is a controlled slider with no
	 * setter, so every drag would be overwritten on the next render by the value
	 * that was already there and the control would sit still under the pointer.
	 * Falling back to the local position keeps the editor usable and honest about
	 * what it can reach — the rows and the resolved times move, and the canvas does
	 * not, because nothing has told it to.
	 */
	const shared =
		onScrub !== undefined && instance ? scrub?.[instance.id] : undefined;
	const at = shared ?? localScrub;
	const moveScrub = (ms: number) => {
		setLocalScrub(ms);
		if (instance) onScrub?.(instance.id, ms);
	};

	/**
	 * Keyframes this universe put out of order, for the timeline that is open.
	 *
	 * `mkbackwards/4` is a property of an **answer** and not of a document — a
	 * keyframe's time is a `Value`, so the same keys in another universe may be in
	 * order — which is why it arrives through the model and there is no
	 * document-side reading of it beside the others above.
	 */
	const suspect = new Set(
		(answer?.backwardsKeys ?? [])
			.filter(([timeline]) => open !== undefined && timeline === open.id)
			.map(([, track, index]) => suspectKey(track, index)),
	);

	/**
	 * Watching an edge: its `from`, then its `to`, with the wait between them.
	 *
	 * The canvas does not tween — it draws whichever state copy it is handed, and
	 * every one of them is already in the answer set — so what can honestly be
	 * shown here is the *pacing*: where the move starts, how long it takes, where
	 * it ends. Interpolating between the two frames in the studio would be the tool
	 * animating something the exported file animates differently, and a preview
	 * that lies about the artefact is worse than one that admits what it is.
	 *
	 * Played **in the edge's own layer**, which is the layer of the state it
	 * leaves — or of the state it arrives at, where it leaves a reserved word. An
	 * edge played into the wrong layer would put a state on screen beside a
	 * sibling that has no idea it is there, which is precisely the picture
	 * `mtwoshown/1` reports and nothing here should be able to cause.
	 */
	const playTransition = (id: string) => {
		const transition = findTransition(machine, id);
		if (!transition || !instance) return;
		const from = findState(machine, transition.from);
		const to = findState(machine, transition.to);
		const where = from ? layerOf(machine, from) : to ? layerOf(machine, to) : undefined;
		if (where === undefined) return;
		if (from) onPlay(instance.id, where, from.id);
		const pace = timing[id] ?? { duration: 0, delay: 0 };
		window.setTimeout(
			() => onPlay(instance.id, where, to ? to.id : null),
			Math.max(0, pace.delay) + pace.duration,
		);
	};

	return (
		<section className={styles.machine} data-machine={machine.id}>
			<div className={styles.machineHead}>
				<input
					className={styles.name}
					data-role="machine-name"
					aria-label="Machine name"
					value={machine.name}
					onChange={(e) =>
						onSceneChange(
							(prev) => renameMachine(prev, machine.id, e.target.value),
							`machine-name-${machine.id}`,
						)
					}
				/>
				{def ? (
					<button
						type="button"
						className={styles.subject}
						data-role="select-root"
						title="Select the component this machine drives"
						onClick={() => onSelectionChange?.([def.root.id])}
					>
						{def.name}
					</button>
				) : (
					// A machine whose root stopped being a definition says nothing to the
					// program — `machine_of(M,R)` joins nothing — but it is still a record
					// with states and edges in it, and the panel that could show it is the
					// only place it can be repaired or deliberately deleted.
					<span className={styles.orphan} data-role="no-root">
						nothing to drive
					</span>
				)}
				<button
					type="button"
					className={styles.delete}
					data-role="delete-machine"
					title="Delete this machine. Every instance goes back to having one appearance."
					onClick={() => onSceneChange((prev) => deleteMachine(prev, machine.id))}
				>
					×
				</button>
			</div>

			<div className={styles.subjectLine}>
				{instance ? (
					<button
						type="button"
						className={styles.subject}
						data-role="select-instance"
						title="Select this use on the canvas. Selecting another one drives that one."
						onClick={() => onSelectionChange?.([instance.id])}
					>
						{names[instance.id] ?? instance.id}
					</button>
				) : (
					<span className={styles.orphan} data-role="no-instance">
						nothing uses this component yet
					</span>
				)}
				<span className={styles.uses}>
					{instances.length === 1 ? "1 use" : `${instances.length} uses`}
				</span>
			</div>

			<Inputs
				scene={scene}
				machine={machine}
				onSceneChange={onSceneChange}
				values={instance ? inputs?.[instance.id] : undefined}
				onSet={
					instance && onSetInput
						? (input, value) => onSetInput(instance.id, input, value)
						: undefined
				}
				onFire={
					instance && onFireInput
						? (input) => onFireInput(instance.id, input)
						: undefined
				}
				unread={unreadInputs}
			/>

			<LayerStrip
				machine={machine}
				shown={shownByLayer}
				playing={playedByLayer}
				fighting={fighting}
				looking={looking}
				onLook={look}
				onAdd={() => onSceneChange((prev) => addLayer(prev, machine.id).scene)}
				onRename={(id, name) =>
					onSceneChange(
						(prev) => renameLayer(prev, machine.id, id, name),
						`layer-name-${machine.id}-${id}`,
					)
				}
				onDelete={(id) => onSceneChange((prev) => deleteLayer(prev, machine.id, id))}
				onReorder={(id, to) =>
					onSceneChange((prev) => reorderLayer(prev, machine.id, id, to))
				}
			/>

			<StateStrip
				machine={machine}
				shown={shown}
				playing={played}
				reachable={reachable}
				deadWithGuards={deadWithGuards}
				layer={looking}
				onPlay={
					instance ? (state) => onPlay(instance.id, looking, state) : undefined
				}
				onShow={
					instance
						? (state) =>
								// Through `setNodeLayerState` rather than `setNodeState`, which
								// is what makes ◉ mean the same thing on a layered machine as
								// on an un-layered one: it writes `SceneNode.states[layer]`,
								// and for the *first* layer it writes the shipped
								// `SceneNode.state` instead, so a one-layer document produced
								// by this panel is byte-identical to one produced before
								// layers existed.
								onSceneChange((prev) =>
									setNodeLayerState(prev, instance.id, looking, state),
								)
						: undefined
				}
				onAdd={() =>
					onSceneChange((prev) => {
						// Two edits in one gesture, and therefore one undo: `addState`
						// appends to the machine, and the new state belongs to the layer
						// being looked at rather than to the first one. Without the second
						// half, adding a state while looking at the glow layer would put it
						// in the press layer and the strip it was added from would not show
						// it.
						const made = addState(prev, machine.id);
						return looking === layers[0].id
							? made.scene
							: setStateLayer(made.scene, machine.id, made.id, looking);
					})
				}
				onRename={(state, name) =>
					onSceneChange(
						(prev) => renameState(prev, machine.id, state, name),
						`state-name-${machine.id}-${state}`,
					)
				}
				onDelete={(state) =>
					onSceneChange((prev) => deleteState(prev, machine.id, state))
				}
				onReorder={(state, to) =>
					onSceneChange((prev) => reorderState(prev, machine.id, state, to))
				}
			/>

			{editingState !== undefined ? (
				<Plays
					machine={machine}
					state={editingState}
					twoSource={
						answer?.twoSource.includes(editing) ??
						(editingState.timeline !== undefined &&
							editingState.blend !== undefined)
					}
					stopsOutOfRange={
						new Set(
							(answer?.stopsOutOfRange ?? doc.stopsOutOfRange)
								.filter(([state]) => state === editing)
								// `+ 1` because `mstopout/3` numbers a blend's stops from one
								// and both health readings record the array index. The number
								// shown is the program's, so a designer sent to "stop 2" finds
								// the second row rather than the third.
								.map(([, index]) => index + 1),
						)
					}
					gap={answer?.stopGaps.includes(editing) ?? false}
					onSceneChange={onSceneChange}
				/>
			) : null}

			{machine.states.length > 0 ? (
				<StateDelta
					scene={scene}
					machine={machine}
					state={editing}
					part={part}
					instance={instance}
					picks={picks}
					varying={varying}
					reach={reach}
					pins={pins}
					onPin={onPin}
					why={why}
					onSceneChange={onSceneChange}
					onSelectionChange={onSelectionChange}
				/>
			) : null}

			<Transitions
				scene={scene}
				machine={machine}
				onSceneChange={onSceneChange}
				picks={picks}
				varying={varying}
				reach={reach}
				pins={pins}
				onPin={onPin}
				timing={timing}
				health={answer}
				impossible={impossible}
				misplaced={misplaced}
				layer={looking}
				onPlay={instance ? playTransition : undefined}
			/>

			{/*
			 * Timelines, under the edges rather than above them, because that is the
			 * order a machine gets built in: states, then what moves between them,
			 * then the animation one of those states plays. One editor at a time —
			 * the machine's timelines are a list of names and the open one is a
			 * panel — because a timeline is tall and three of them expanded would
			 * push everything a designer came here for off the bottom.
			 */}
			<div className={styles.timelines} data-role="timelines">
				<div className={styles.timelineHead}>
					<span className={styles.title}>Timelines</span>
					{timelines.map((w) => (
						<button
							key={w.id}
							type="button"
							className={cx(styles.tab, w.id === open?.id && styles.openTab)}
							data-role="open-timeline"
							data-timeline={w.id}
							aria-pressed={w.id === open?.id}
							onClick={() => setOpened(w.id)}
						>
							{w.name}
						</button>
					))}
					<button
						type="button"
						className={styles.add}
						data-role="add-timeline"
						title="A timeline: one or more properties of one or more parts, over time, as keyframes. Grounding scales with the number of keys and with nothing else — there is no frame rate anywhere in this system."
						onClick={() =>
							onSceneChange((prev) => {
								const made = addTimeline(prev, machine.id);
								setOpened(made.id);
								return made.scene;
							})
						}
					>
						+ Timeline
					</button>
				</div>

				{open !== undefined ? (
					<Timeline
						scene={scene}
						machine={machine}
						timeline={open}
						onSceneChange={onSceneChange}
						picks={picks}
						varying={varying}
						pins={pins}
						onPin={onPin}
						solved={answer?.timelines[open.id]}
						suspect={suspect}
						at={at}
						onScrub={moveScrub}
					/>
				) : (
					<p className={styles.empty} data-role="no-timelines">
						No timelines. A state can play one, and several states routinely play
						the same one — a `loop` and a `pressed` both playing `idle` — which is
						why they belong to the machine rather than to a state.
					</p>
				)}
			</div>
		</section>
	);
}

/**
 * States: **behaviour, and deliberately not a design space.**
 *
 * Beside the Styles panel, and the contrast with it is the fastest way to say
 * what this panel is. A style is one variable whose alternatives are whole
 * treatments: the solver picks one, the others are other universes, and a
 * document with two styles of two variants each is four designs. A machine is
 * the other thing entirely. Its states are all true *at once*, in one answer
 * set, side by side — a button with four states and three variants is three
 * designs each of which has four states, not twelve designs. Adding "pressed" to
 * a button must leave the number of designs exactly where it was, and if it does
 * not, the encoding underneath this panel is wrong.
 *
 * That is why nothing in here is a pick, why the state strip's Play button costs
 * no solve (every state's frame and rendered values are already in the answer
 * set beside the picture), and why the one thing that *does* branch — two
 * alternatives written inside one state's delta — branches through an ordinary
 * value row and not through the strip.
 *
 * ## Five more rungs, and the claim survives every one of them
 *
 * The panel now holds inputs, guards, layers, timelines and blend states, and
 * none of them is an alternative either. **Inputs** are runtime values: nothing
 * projected depends on one, so driving a slider here cannot change which universe
 * is on screen, and the panel draws a rule down the middle of every input row to
 * say which half is the document and which half is this browser tab. **Layers**
 * compose where a choice rule would multiply — two layers are two `shown/2` facts
 * in one answer set, not a four-state layer times a three-state layer — which is
 * exactly why the layer strip lists what every layer is showing *at once* rather
 * than offering a current one. **Timelines** cost keyframes and nothing else:
 * there is no frame rate here, in the program, in the model or in the export, so
 * the scrubber is a read of two copies the answer set already holds. **Blends**
 * are arithmetic over a runtime value and are not solved at all; what *is* solved
 * is every keyframe of every timeline a stop names, and the thresholds the checks
 * judge.
 *
 * The one thing any of them adds to the design space is what was already there:
 * a `Value` with two alternatives. A keyframe's time and a keyframe's value are
 * ordinary value rows, so a timeline that names a motion scale really is two
 * animations — and that branch arrives through the same {@link ValueEditor} a
 * fill does, for the same reason, with the same pin and the same why-button.
 *
 * A machine belongs to a component definition, so the panel is a list of
 * machines and not a property of the selection; but every subject it needs — the
 * instance to resolve against, the part to edit — comes from the selection, so
 * that the canvas and the panel cannot come to disagree about what is being
 * looked at.
 */
export function Machines({
	scene,
	onSceneChange,
	picks,
	varying,
	reach,
	pins,
	onPin,
	why,
	selection,
	onSelectionChange,
	playing,
	onPlay,
	inputs,
	onSetInput,
	onFireInput,
	layer,
	onLayerChange,
	scrub,
	onScrub,
	health,
	broken,
	conflict,
}: MachinesProps) {
	const defs = componentDefs(scene);
	const spare = defs.filter((def) => machineForRoot(scene, def.root.id) === undefined);
	/**
	 * Every machine's pacing, resolved once here rather than once per card.
	 *
	 * Because the checks are document-wide — the canned bodies are anonymous in
	 * every argument, so "no transition takes longer than 400ms" is a claim about
	 * the document — the budget row has to be able to see every machine's numbers,
	 * and the transition rows want the same table. One walk, two readers.
	 */
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	const timings: Record<string, Timing> = Object.fromEntries(
		scene.machines.map((machine) => [
			machine.id,
			timingFor(machine, health?.[machine.id], context),
		]),
	);

	return (
		<div className={styles.machines} data-role="machines">
			<div className={styles.head}>
				<span className={styles.hint}>
					Every state is true at once, on every layer at once. Adding a state, a
					layer, an input or a timeline changes what the component can do, never
					how many designs there are.
				</span>
				<select
					className={styles.add}
					data-role="add-machine"
					aria-label="Add a machine"
					value=""
					disabled={spare.length === 0}
					title={
						defs.length === 0
							? "A machine belongs to a component. Make one first."
							: spare.length === 0
								? "Every component already has a machine"
								: "Give a component states"
					}
					onChange={(e) => {
						const root = e.target.value;
						if (!root) return;
						const name = defs.find((d) => d.root.id === root)?.name;
						onSceneChange((prev) => addMachine(prev, root, name).scene);
					}}
				>
					<option value="">+ Machine</option>
					{spare.map((def) => (
						<option key={def.root.id} value={def.root.id}>
							{def.name}
						</option>
					))}
				</select>
			</div>

			{defs.length === 0 ? (
				<p className={styles.empty} data-role="no-components">
					Nothing here is a component yet. States belong to a definition — the
					thing several copies share — so make one, and then say what it does when
					the pointer is over it.
				</p>
			) : scene.machines.length === 0 ? (
				<p className={styles.empty} data-role="no-machines">
					No machines. One holds the situations a component is in — rest, hover,
					pressed — as a diff of the component rather than a second copy of it, so
					"what does hover change?" is written down instead of spotted.
				</p>
			) : null}

			{scene.machines.map((machine) => (
				<MachineCard
					key={machine.id}
					scene={scene}
					machine={machine}
					timing={timings[machine.id] ?? {}}
					onSceneChange={onSceneChange}
					picks={picks}
					varying={varying}
					reach={reach}
					pins={pins}
					onPin={onPin}
					why={why}
					selection={selection}
					onSelectionChange={onSelectionChange}
					playing={playing}
					onPlay={onPlay}
					inputs={inputs}
					onSetInput={onSetInput}
					onFireInput={onFireInput}
					layer={layer}
					onLayerChange={onLayerChange}
					scrub={scrub}
					onScrub={onScrub}
					health={health}
				/>
			))}

			{/* Under the machines rather than inside each one: a check is a rule
			    about the document, not about a machine, and drawing five checkboxes
			    per card would be drawing the same five switches twice. */}
			{scene.machines.length > 0 ? (
				<Checks
					scene={scene}
					machines={scene.machines}
					timings={timings}
					onSceneChange={onSceneChange}
					broken={broken}
					conflict={conflict}
				/>
			) : null}
		</div>
	);
}
