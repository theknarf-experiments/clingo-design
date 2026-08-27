import {
	DEFAULT_DURATION_BUDGET_MS,
	DEFAULT_UNIT,
	DIMENSIONS,
	type Dimension,
	FRAME_DIMS,
	type Machine,
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
	addMachine,
	addMachineCheck,
	addState,
	clearStatePart,
	componentDef,
	componentDefs,
	deleteMachine,
	deleteState,
	durationBudgetCheck,
	findInTree,
	findState,
	findTransition,
	hasMachineCheck,
	initialState,
	instanceNodes,
	isInstance,
	lit,
	machineChecks,
	machineForRoot,
	machineHealth,
	materializedParts,
	motionMs,
	nodeNames,
	parseInstancePart,
	parseStatePart,
	propValues,
	removeMachineCheck,
	renameMachine,
	renameState,
	reorderState,
	resolveValue,
	setNodeState,
	setStateFrame,
	setStateHidden,
	setStateProp,
	sharedPropsOfKinds,
	shownState,
	stateFrameVar,
	stateName,
	statePropVar,
	tokensFor,
	tokensOfType,
	writeDuration,
} from "@clingo-design/design-core";

import { StateStrip } from "./StateStrip";
import { Transitions } from "./Transitions";
import { ValueEditor, type WhyRow } from "./ValueEditor";
import { cx } from "./cx";
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
	 * Instance node id -> the state the canvas is drawing instead of the
	 * document's. **Editor state, not the document's** — see `useMachinePlayback`.
	 */
	playing: Readonly<Record<string, string>>;
	onPlay: (instance: string, state: string | null) => void;
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

/** What one universe resolved one machine's edges to, in whole milliseconds. */
type Timing = Record<string, { duration: number; delay: number; stagger: number }>;

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
		let phrase: string | null = null;
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

	const shown = instance
		? shownState(machine, instance)
		: (initialState(machine)?.id ?? "");
	const played = instance ? playing[instance.id] : undefined;
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

	const answer = health?.[machine.id];
	const unreachable = new Set(machineHealth(machine).unreachable);
	const reachable = new Set(
		machine.states.map((s) => s.id).filter((id) => !unreachable.has(id)),
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
	 */
	const playTransition = (id: string) => {
		const transition = findTransition(machine, id);
		if (!transition || !instance) return;
		onPlay(instance.id, transition.from);
		const pace = timing[id] ?? { duration: 0, delay: 0 };
		window.setTimeout(
			() => onPlay(instance.id, transition.to),
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

			<StateStrip
				machine={machine}
				shown={shown}
				playing={played}
				reachable={reachable}
				onPlay={instance ? (state) => onPlay(instance.id, state) : undefined}
				onShow={
					instance
						? (state) =>
								onSceneChange((prev) => setNodeState(prev, instance.id, state))
						: undefined
				}
				onAdd={() => onSceneChange((prev) => addState(prev, machine.id).scene)}
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
				onPlay={instance ? playTransition : undefined}
			/>
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
					Every state is true at once. Adding one changes what the component can
					do, never how many designs there are.
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
