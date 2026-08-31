import { useEffect, useRef, useState } from "react";

import {
	INPUT_KINDS,
	INPUT_KIND_NAMES,
	type InputKind,
	type InputValues,
	type Machine,
	type MachineInput,
	type Scene,
	addInput,
	deleteInput,
	inputInitial,
	inputRange,
	nearestPermille,
	renameInput,
	setInputInitial,
	setInputKind,
	setInputRange,
	writePermille,
} from "@clingo-design/design-core";

import { cx } from "./cx";
import styles from "./Inputs.module.css";

/**
 * What a host hands a machine from outside — declared here, and driven here.
 *
 * **Two different kinds of act in one list, and the panel has to keep them
 * apart.** Declaring an input is an edit: it writes `MachineInput` into the
 * document, emits `minput/2` and its neighbours, lands in undo, and re-grounds.
 * *Driving* one is not an edit at all — it is editor state, exactly like playing
 * a state or pinning an alternative, it costs no solve, and it never reaches the
 * document. The reason it costs nothing is the whole shape of this rung: **an
 * input is not in the design space**. Nothing projected depends on one, so a
 * document with three inputs has precisely the universe count of the same
 * document with none, and moving a slider here cannot change the picture's
 * universe — only which transitions a runtime would be allowed to take.
 *
 * So the left half of a row is the document (name, kind, resting value, range)
 * and the right half is the preview (a checkbox, a slider, a Fire button), with
 * a rule between them, and the panel says which is which rather than leaving
 * somebody to discover that half of what they touched was saved.
 *
 * **Every field of the document half is a plain string, never a `Value`**, and
 * the rows are plain fields rather than {@link ValueEditor}s for that reason. A
 * `Value` would let a range name a token and hold two alternatives, and a range
 * decides nothing anybody can see — it decides which guards the checks call
 * impossible, so a document holding two opinions about it would be a document
 * that could not say whether its own machine was broken. That argument is
 * `scene.ts`'s and this panel is its visible consequence: no swatch row, no pin,
 * no why-button, because there is nothing here for the solver to have an opinion
 * about.
 */
export interface InputsProps {
	scene: Scene;
	machine: Machine;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/**
	 * What the preview currently holds for the instance on screen — editor state,
	 * never the document's. An input is a runtime value and driving one costs no
	 * solve, so this never lands in undo.
	 */
	values?: InputValues;
	/**
	 * Set a persistent input.
	 *
	 * **Optional, where `rive-ladder-spec.md` §10.1 has it required**, and the
	 * widening is deliberate: a studio that has not yet wired a playback store
	 * must still be able to *declare* inputs, and a driving control that was
	 * rendered live and did nothing would teach the wrong thing about what
	 * driving one costs. Absent draws the preview half as a read-out of the
	 * resting value with a sentence saying so. A caller that passes one is
	 * exactly the frozen contract.
	 */
	onSet?: (input: string, value: boolean | number) => void;
	/** Fire a momentary one. Optional for {@link onSet}'s reason. */
	onFire?: (input: string) => void;
	/** Inputs no guard in the machine reads, so a row can say it is unused. */
	unread?: ReadonlySet<string>;
}

/**
 * A number input's value, as a **ratio in thousandths** — which is the one unit
 * question this panel has to get right.
 *
 * `permilleOf` is the integer boundary for the `ratio` quantity, the way `emuOf`
 * is for `length`: `"1"` is 1000, `"0.5"` is 500, and it is that integer that
 * reaches `minnum/3`, `mcondval/4`, `mstopat/4` and the `InputValues` a runtime
 * holds. A field that showed the raw thousandths would be showing a designer the
 * program's arithmetic instead of their own number, and one that showed a
 * rounded decimal and wrote it back through a float would lose a threshold the
 * checks are comparing against — so the text is read and written through the
 * bridge in both directions and never through `Number`.
 */
const readRatio = (text: string): number | undefined => nearestPermille(text);
const showRatio = (permille: number): string => writePermille(permille);

/**
 * A field whose text is held while it is being typed into and committed the
 * moment it reads as something.
 *
 * The draft is not a nicety here. Every one of these writes straight through to
 * the document, and a controlled field reading back off the document would make
 * `"0."` — which reads as nothing — snap to the last committed number under the
 * cursor, so `0.5` could not be typed at all. Which is `Chip`'s argument in the
 * state strip and `renameConstraint`'s in the Rules panel, applied to a number:
 * the draft lets the field say something unreadable while the document goes on
 * holding the last thing that was readable.
 *
 * Unreadable text is *stored* rather than refused where the document field takes
 * a string — a range end that reads as nothing is a range the checks stay silent
 * about, which is the same answer an absent one gets, arrived at honestly. It is
 * only the *driving* half that refuses, because there the value has to be a
 * number for a guard to compare.
 */
function Field({
	role,
	label,
	value,
	placeholder,
	width,
	disabled,
	onCommit,
}: {
	role: string;
	label: string;
	value: string;
	placeholder?: string;
	width?: string;
	/**
	 * Live-looking and inert is the one state this component must not have, so
	 * the flag exists rather than letting an absent `onSet` swallow the keystroke:
	 * a field a person can type into that changes nothing teaches them the wrong
	 * thing about what driving an input costs, which is the sentence this whole
	 * panel is built around.
	 */
	disabled?: boolean;
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
			data-role={role}
			aria-label={label}
			title={label}
			placeholder={placeholder}
			disabled={disabled}
			style={width ? { width } : undefined}
			value={draft ?? value}
			onChange={(e) => {
				setDraft(e.target.value);
				onCommit(e.target.value);
			}}
			onBlur={() => setDraft(null)}
		/>
	);
}

/** One input: what it is, and what the preview is holding it at. */
function Row({
	machine,
	input,
	held,
	unread,
	onSceneChange,
	onSet,
	onFire,
}: {
	machine: Machine;
	input: MachineInput;
	/** What the preview holds, or undefined where it holds nothing yet. */
	held: boolean | number | undefined;
	unread: boolean;
	onSceneChange: InputsProps["onSceneChange"];
	onSet?: InputsProps["onSet"];
	onFire?: InputsProps["onFire"];
}) {
	const [name, setName] = useState<string | null>(null);
	const committed = useRef(input.name);
	useEffect(() => {
		if (committed.current !== input.name) {
			committed.current = input.name;
			setName(null);
		}
	}, [input.name]);

	const write = (next: (prev: Scene) => Scene, coalesce?: string) =>
		onSceneChange(next, coalesce);

	/**
	 * The resting value, and what the preview falls back to.
	 *
	 * `inputInitial` rather than the raw field, so the row reads what the *program*
	 * will read: a boolean whose `initial` says something that is not `true` or
	 * `false` starts at the kind's own fallback, and a number whose `initial` reads
	 * as nothing starts at zero. A panel that echoed the text would show a starting
	 * value the machine does not have.
	 */
	const resting = inputInitial(input);
	const at = held ?? resting;
	const { min, max } = inputRange(input);

	return (
		<div
			className={cx(styles.input, unread && styles.unread)}
			data-role="machine-input"
			data-input={input.id}
			data-kind={input.kind}
		>
			<div className={styles.declare}>
				<input
					className={styles.name}
					data-role="input-name"
					aria-label="Input name"
					value={name ?? input.name}
					title={`The id \`${input.id}\`, which is what a condition names, what \`mcondin/4\` grounds and what a host page keys its \`InputValues\` by. Renaming writes the name and never the id — renaming through would unwire every guard silently.`}
					onChange={(e) => {
						setName(e.target.value);
						write(
							(prev) => renameInput(prev, machine.id, input.id, e.target.value),
							`input-name-${machine.id}-${input.id}`,
						);
					}}
					onBlur={() => setName(null)}
				/>

				<select
					className={styles.select}
					data-role="input-kind"
					aria-label="Input kind"
					title="Boolean persists, number persists and can be compared and blended along, trigger is a moment that does not persist. Changing it repairs nothing else: the conditions that compared it the old way stay, and every one of them is reported under its own name rather than tidied away."
					value={input.kind}
					onChange={(e) =>
						write((prev) =>
							setInputKind(prev, machine.id, input.id, e.target.value as InputKind),
						)
					}
				>
					{INPUT_KIND_NAMES.map((kind) => (
						<option key={kind} value={kind}>
							{INPUT_KINDS[kind].label}
						</option>
					))}
				</select>

				<button
					type="button"
					className={styles.action}
					data-role="delete-input"
					title="Delete this input, and every condition that was about it. A guard is a conjunction, so an edge that loses a conjunct fires more often — that is the honest consequence, and it is better than leaving conditions behind that report `mcbad` at somebody who did not write them."
					onClick={() => write((prev) => deleteInput(prev, machine.id, input.id))}
				>
					×
				</button>
			</div>

			<div className={styles.settings}>
				{input.kind === "trigger" ? (
					<span className={styles.note}>
						A moment, not a value. Nothing rests here — "not fired" is the absence
						of a value rather than one of them.
					</span>
				) : (
					<>
						<label className={styles.setting}>
							<span className={styles.settingLabel}>Starts</span>
							{input.kind === "boolean" ? (
								<select
									className={styles.select}
									data-role="input-initial"
									aria-label="Starting value"
									value={resting === true ? "true" : "false"}
									onChange={(e) =>
										write((prev) =>
											setInputInitial(prev, machine.id, input.id, e.target.value),
										)
									}
								>
									<option value="false">false</option>
									<option value="true">true</option>
								</select>
							) : (
								<Field
									role="input-initial"
									label="Starting value"
									width="3.4rem"
									value={input.initial ?? ""}
									placeholder={INPUT_KINDS.number.fallback}
									onCommit={(text) =>
										write(
											(prev) =>
												setInputInitial(
													prev,
													machine.id,
													input.id,
													text.trim() === "" ? null : text,
												),
											`input-initial-${machine.id}-${input.id}`,
										)
									}
								/>
							)}
						</label>

						{input.kind === "number" ? (
							<label
								className={styles.setting}
								title="The closed ends of the range, inclusive. **Empty is open, not zero** — a designer who has not said how far the drawer opens has not said that it does not open, and a range invented here would have the checks calling guards impossible against a claim nobody made."
							>
								<span className={styles.settingLabel}>Range</span>
								<Field
									role="input-min"
									label="Smallest value, empty for open"
									width="2.8rem"
									value={input.min ?? ""}
									placeholder="open"
									onCommit={(text) =>
										write(
											(prev) =>
												setInputRange(
													prev,
													machine.id,
													input.id,
													text.trim() === "" ? null : text,
													input.max ?? null,
												),
											`input-range-${machine.id}-${input.id}`,
										)
									}
								/>
								<span className={styles.to}>to</span>
								<Field
									role="input-max"
									label="Largest value, empty for open"
									width="2.8rem"
									value={input.max ?? ""}
									placeholder="open"
									onCommit={(text) =>
										write(
											(prev) =>
												setInputRange(
													prev,
													machine.id,
													input.id,
													input.min ?? null,
													text.trim() === "" ? null : text,
												),
											`input-range-${machine.id}-${input.id}`,
										)
									}
								/>
							</label>
						) : null}
					</>
				)}
			</div>

			{/*
			 * The preview half. Separated by a rule rather than by a heading,
			 * because the boundary is the point: everything left of it is in the
			 * file and everything right of it is in this browser tab.
			 */}
			<div className={styles.drive} data-role="drive-input">
				{input.kind === "trigger" ? (
					<button
						type="button"
						className={styles.fire}
						data-role="fire-input"
						disabled={onFire === undefined}
						title={
							onFire === undefined
								? "Nothing is driving this preview, so there is nothing to fire it at."
								: "Fire it: true for one evaluation and gone afterwards. A runtime that kept it true would take every guarded edge on the next unrelated event, which reads as a machine that has gone off on its own."
						}
						onClick={() => onFire?.(input.id)}
					>
						Fire
					</button>
				) : input.kind === "boolean" ? (
					<label className={styles.toggle}>
						<input
							type="checkbox"
							data-role="set-input"
							aria-label={`Drive ${input.name || input.id}`}
							disabled={onSet === undefined}
							checked={at === true}
							onChange={(e) => onSet?.(input.id, e.target.checked)}
						/>
						<span>{at === true ? "true" : "false"}</span>
					</label>
				) : (
					<>
						{/*
						 * A slider only where both ends are known, because a slider needs
						 * two ends and inventing them is the one thing the range field is
						 * documented not to do. An open-ended number gets the field alone,
						 * which is the honest control for a quantity with no stated
						 * bounds.
						 */}
						{min !== undefined && max !== undefined && max > min ? (
							<input
								className={styles.slider}
								type="range"
								data-role="set-input"
								aria-label={`Drive ${input.name || input.id}`}
								disabled={onSet === undefined}
								min={min}
								max={max}
								step={1}
								value={typeof at === "number" ? Math.min(max, Math.max(min, at)) : min}
								onChange={(e) => onSet?.(input.id, Number(e.target.value))}
							/>
						) : null}
						<Field
							role="set-input-number"
							label={`Drive ${input.name || input.id}`}
							width="3rem"
							disabled={onSet === undefined}
							value={typeof at === "number" ? showRatio(at) : ""}
							placeholder={onSet === undefined ? "—" : "0"}
							onCommit={(text) => {
								const read = readRatio(text);
								// Refused rather than stored where it reads as nothing, which is
								// the opposite of what the document fields above do — and for
								// the reason stated on {@link Field}: a driven value has to be
								// a number for a guard to compare it, whereas a stored one that
								// reads as nothing is simply a claim the checks stay quiet
								// about.
								if (read !== undefined) onSet?.(input.id, read);
							}}
						/>
					</>
				)}
			</div>

			{unread ? (
				<p className={styles.finding} data-role="input-unread">
					No guard in this machine reads it, so driving it moves nothing. It is
					still in the exported table, where a host page can set it.
				</p>
			) : null}
		</div>
	);
}

/**
 * `scene` is in {@link InputsProps} because the frozen signature has it, and it
 * is deliberately not destructured here: every field of every input is a plain
 * string, so there is no `ResolveContext` to build, no token list to offer and
 * no universe to resolve against. Taking it and ignoring it keeps the component
 * the one the other steps are coding against, and the day a range becomes a
 * `Value` it is already in hand.
 */
export function Inputs({
	machine,
	onSceneChange,
	values,
	onSet,
	onFire,
	unread,
}: InputsProps) {
	const inputs = machine.inputs ?? [];

	return (
		<div className={styles.inputs} data-role="machine-inputs" data-machine={machine.id}>
			<div className={styles.head}>
				<span className={styles.title}>Inputs</span>
				<select
					className={styles.add}
					data-role="add-input"
					aria-label="Add an input"
					value=""
					title="Something a host page hands this machine. Adding one changes what the machine can be told and never how many designs the document has — nothing projected depends on an input, so there is nothing here for the solver to branch on."
					onChange={(e) => {
						const kind = e.target.value;
						if (!kind) return;
						onSceneChange(
							(prev) => addInput(prev, machine.id, kind as InputKind).scene,
						);
					}}
				>
					<option value="">+ Input</option>
					{INPUT_KIND_NAMES.map((kind) => (
						<option key={kind} value={kind}>
							{INPUT_KINDS[kind].label}
						</option>
					))}
				</select>
			</div>

			{inputs.length === 0 ? (
				<p className={styles.empty} data-role="no-inputs">
					Nothing drives this machine from outside. A boolean is a condition that
					persists, a number is a quantity a guard compares and a blend mixes
					along, and a trigger is a moment that does not persist.
				</p>
			) : (
				inputs.map((input) => (
					<Row
						key={input.id}
						machine={machine}
						input={input}
						held={values?.[input.id]}
						unread={unread?.has(input.id) ?? false}
						onSceneChange={onSceneChange}
						onSet={onSet}
						onFire={onFire}
					/>
				))
			)}

			{inputs.length > 0 && onSet === undefined && onFire === undefined ? (
				<p className={styles.note} data-role="not-driving">
					Nothing is driving the preview here, so the right-hand column is reading
					back what each input rests at rather than what it is being held at.
				</p>
			) : null}
		</div>
	);
}
