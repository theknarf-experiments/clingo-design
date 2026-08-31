import { useEffect, useRef, useState } from "react";

import {
	COMPARE_OPS,
	COMPARE_OP_NAMES,
	type CompareOp,
	type Condition,
	type Machine,
	type Scene,
	type Transition,
	addCondition,
	deleteCondition,
	findInput,
	normalizeCondition,
	updateCondition,
} from "@clingo-design/design-core";

import { cx } from "./cx";
import styles from "./Conditions.module.css";

/**
 * The guard on one edge: everything that must hold **as well as** the trigger.
 *
 * **A conjunction, and there is no `or`.** Two guards that ought to be
 * alternatives are two transitions — which is what Rive does, and which here has
 * a second payoff the panel is built around: two transitions are two rows with
 * two ids, so "this edge can never be taken" can name the one that is impossible
 * instead of pointing at half of a boolean expression. There is therefore no
 * grouping control here, no parentheses and no operator between the rows, and
 * the word `and` between them is copy rather than a choice.
 *
 * **Rows are numbered from one and the number is load-bearing.** A condition has
 * no id: the program numbers the conjuncts as it emits them (`mcond(M,T,K)`) and
 * `mcbad(M,T,K)` names one by that number, so the digit at the left of a row is
 * the digit a violation sentence uses. An editor counting from zero beside a
 * panel counting from one is the oldest off-by-one there is, and every index this
 * component passes to `edits.ts` is the one the row displays.
 *
 * **Nothing here is a design-space value**, so no row is a {@link ValueEditor}:
 * a comparand is a plain string in the document for the reason `scene.ts` gives
 * — a guard decides nothing an onlooker can see, so a comparand with two
 * alternatives would be two universes identical in every projected atom, and
 * "this guard can never be satisfied" would become "…in three of the four
 * universes", which is a sentence with nowhere to be said.
 *
 * **A half-written condition is shown and explained, never repaired.** An input
 * that has been deleted, an operator its kind cannot answer, a comparand that
 * reads as no number: `normalizeCondition` calls each of them `bad` and hands
 * back the sentence, which is exactly `mcbad/3`, and the row prints it. A select
 * that snapped an illegal operator to a legal one would take away the symptom of
 * the mistake and leave the mistake — the same argument the transition's own
 * from/to selects already make about a dangling state.
 */
export interface ConditionsProps {
	machine: Machine;
	transition: Transition;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/** True where the answer set says this whole guard can never be met. */
	impossible?: boolean;
	/**
	 * Condition indices the compiler could not read at all — `mcbad/3`, 1-based.
	 *
	 * Additional to what this component works out for itself rather than instead
	 * of it: `normalizeCondition` is the same reading the compiler makes and it
	 * carries the *sentence*, which is the thing worth showing, so a row is marked
	 * when either source says so. A caller with an answer set in hand passes this
	 * and the two agree; a caller without one passes nothing and the rows are
	 * still right, which is the property that lets the panel keep explaining
	 * itself while the document is unsatisfiable.
	 */
	bad?: ReadonlySet<number>;
}

/**
 * A comparand field, held as a draft while it is typed into.
 *
 * {@link Inputs}' `Field` in miniature and for its reason: the value is written
 * straight through to the document on every keystroke, and a controlled field
 * reading back off the document would make text that reads as nothing — `"0."`,
 * or an empty box on the way to a new number — snap back under the cursor. Here
 * the case is sharper still, because a comparand that reads as nothing is a
 * *legal document state* that the panel is supposed to report rather than
 * prevent.
 */
function Comparand({
	value,
	label,
	onCommit,
}: {
	value: string;
	label: string;
	onCommit: (text: string) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const committed = useRef(value);
	useEffect(() => {
		if (committed.current !== value) {
			committed.current = value;
			setDraft(null);
		}
	}, [value]);
	return (
		<input
			className={styles.field}
			data-role="condition-value"
			aria-label={label}
			title={label}
			value={draft ?? value}
			onChange={(e) => {
				setDraft(e.target.value);
				onCommit(e.target.value);
			}}
			onBlur={() => setDraft(null)}
		/>
	);
}

/** One conjunct: an input, a comparison, and what it is compared against. */
function Row({
	machine,
	transition,
	condition,
	index,
	flagged,
	onSceneChange,
}: {
	machine: Machine;
	transition: Transition;
	condition: Condition;
	/** 1-based, the number the program and a violation both use. */
	index: number;
	flagged: boolean;
	onSceneChange: ConditionsProps["onSceneChange"];
}) {
	const inputs = machine.inputs ?? [];
	const input = findInput(machine, condition.input);
	const normal = normalizeCondition(machine, condition);
	const bad = normal.kind === "bad";

	const write = (patch: Partial<Condition>, coalesce?: string) =>
		onSceneChange(
			(prev) =>
				updateCondition(prev, machine.id, transition.id, index, patch),
			coalesce,
		);

	/**
	 * The operators this row offers: the ones the input's kind can answer, plus
	 * the one it currently holds where that is not among them.
	 *
	 * The extra entry is the point rather than a defensive branch, exactly as in
	 * the transition's `StateSelect`. Turning a boolean into a number leaves every
	 * `is more than` on it, and a menu that silently dropped the option would
	 * leave a select showing a blank while the document held a condition — so the
	 * illegal operator is listed, marked, and stays until somebody changes it.
	 */
	const offered = COMPARE_OP_NAMES.filter(
		(op) => input !== undefined && COMPARE_OPS[op].kinds.includes(input.kind),
	);
	const known = offered.includes(condition.op);
	const takesComparand =
		Object.hasOwn(COMPARE_OPS, condition.op) && COMPARE_OPS[condition.op].comparand;

	return (
		<div
			className={cx(styles.condition, (bad || flagged) && styles.broken)}
			data-role="condition"
			data-transition={transition.id}
			data-condition={index}
			data-bad={bad || flagged ? "" : undefined}
		>
			<span className={styles.index} title="The number `mcond/3` gives this conjunct, and the one a violation names.">
				{index}
			</span>

			<select
				className={cx(styles.select, input === undefined && styles.missing)}
				data-role="condition-input"
				aria-label="Input"
				title="Which input this condition is about."
				value={condition.input}
				onChange={(e) => write({ input: e.target.value })}
			>
				{/* An input the machine has not got is kept and marked, for the reason
				    a dangling transition end is: `mcbad/3` reports it, and a select
				    that snapped it to the first legal input would repair the document
				    under the designer and take the finding with it. */}
				{input === undefined ? (
					<option value={condition.input}>{condition.input} — no such input</option>
				) : null}
				{inputs.map((x) => (
					<option key={x.id} value={x.id}>
						{x.name || x.id}
					</option>
				))}
			</select>

			<select
				className={cx(styles.select, !known && styles.missing)}
				data-role="condition-op"
				aria-label="Comparison"
				title="How it compares. A boolean answers `is` and `is not`; the four orderings are a number's; `fired` is a trigger's and takes nothing to compare against, because a moment has no value."
				value={condition.op}
				onChange={(e) => write({ op: e.target.value as CompareOp })}
			>
				{known ? null : (
					<option value={condition.op}>
						{COMPARE_OPS[condition.op]?.label ?? condition.op} — not for this kind
					</option>
				)}
				{offered.map((op) => (
					<option key={op} value={op}>
						{COMPARE_OPS[op].label}
					</option>
				))}
			</select>

			{takesComparand ? (
				input?.kind === "boolean" ? (
					<select
						className={styles.select}
						data-role="condition-value"
						aria-label="Compared against"
						value={condition.value ?? ""}
						onChange={(e) => write({ value: e.target.value })}
					>
						{condition.value === "true" || condition.value === "false" ? null : (
							<option value={condition.value ?? ""}>
								{condition.value ?? "(nothing)"} — not true or false
							</option>
						)}
						<option value="false">false</option>
						<option value="true">true</option>
					</select>
				) : (
					<Comparand
						value={condition.value ?? ""}
						label="Compared against"
						onCommit={(text) =>
							write(
								{ value: text },
								`condition-${machine.id}-${transition.id}-${index}`,
							)
						}
					/>
				)
			) : (
				<span className={styles.fixed}>—</span>
			)}

			<button
				type="button"
				className={styles.action}
				data-role="delete-condition"
				title="Take this conjunct away. The edge stays and fires more often, which is what removing something from an `and` means."
				onClick={() =>
					onSceneChange((prev) =>
						deleteCondition(prev, machine.id, transition.id, index),
					)
				}
			>
				×
			</button>

			{bad ? (
				<p className={styles.why} data-role="condition-bad">
					{normal.why}
				</p>
			) : null}
		</div>
	);
}

export function Conditions({
	machine,
	transition,
	onSceneChange,
	impossible,
	bad,
}: ConditionsProps) {
	const conditions = transition.conditions ?? [];
	const inputs = machine.inputs ?? [];

	return (
		<div
			className={cx(styles.conditions, impossible && styles.impossible)}
			data-role="conditions"
			data-transition={transition.id}
		>
			<div className={styles.head}>
				<span className={styles.title}>
					{conditions.length === 0 ? "Unguarded" : "While"}
				</span>
				<button
					type="button"
					className={styles.add}
					data-role="add-condition"
					disabled={inputs.length === 0}
					title={
						inputs.length === 0
							? "A condition is about an input, and this machine has none. Add one above first — a condition naming nothing would be `mcbad` at the instant it was made, which is an accusation the designer earned by pressing a button."
							: "Something that must also hold. It starts at the input's own resting value, so a fresh row says something true and harmless rather than something this panel invented."
					}
					onClick={() =>
						onSceneChange((prev) =>
							addCondition(prev, machine.id, transition.id),
						)
					}
				>
					+ Condition
				</button>
			</div>

			{conditions.map((condition, i) => (
				<Row
					// The index is the identity here, because a condition has none — and
					// that is honest rather than a React shortcut: deleting conjunct 2
					// really does make the old conjunct 3 into conjunct 2, in the
					// document, in `mcond/3` and in the sentence a violation prints.
					key={i}
					machine={machine}
					transition={transition}
					condition={condition}
					index={i + 1}
					flagged={bad?.has(i + 1) ?? false}
					onSceneChange={onSceneChange}
				/>
			))}

			{impossible ? (
				<p className={styles.finding} data-role="guard-impossible">
					No valuation of these inputs satisfies all of it, so this edge can never
					be taken. Two of the conditions contradict each other, one asks for a
					number outside the input's own range, or one of them is not a condition
					at all.
				</p>
			) : null}
		</div>
	);
}
