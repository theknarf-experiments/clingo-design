import { useState } from "react";
import {
	DEFAULT_UNIT,
	DERIVATIONS,
	type Derivation,
	type Term,
	type Unit,
	VALUE_TYPES,
	type Value,
	type ValueType,
	type Verdict,
	derive,
	durationUnitOf,
	isLengthType,
	isTimeType,
	lit,
	nearestMs,
	writeDuration,
	optionLabel,
	ref,
	termLabel,
	tokenVar,
	type Token,
} from "@clingo-design/design-core";

import styles from "./ValueEditor.module.css";
import { cx } from "./cx";
import { shownLength, typedLength } from "./lengths";

/**
 * The why-probe, as one row sees it.
 *
 * A greyed swatch is a dead end: it says no design uses this and offers nothing
 * to do about it. This is the recourse — one question, one click, and the
 * solver's own answer in the panel. Lazy on purpose: it costs about a solve per
 * rule the document has, so nothing here happens until somebody asks.
 */
export interface WhyRow {
	/** Ask about one alternative, by solver index. Null puts the answer away. */
	ask: (index: number | null) => void;
	/** The alternative asked about, when the outstanding question is this row's. */
	at: number | null;
	/** The answer in words, or null while the solver still has the question. */
	answer: string | null;
	/** For styling, and so a test can tell "impossible" from "duplicate". */
	verdict: Verdict | null;
	/**
	 * Solver round trips the answer took.
	 *
	 * Shown, because the price is part of the answer: a colour row costs three
	 * solves and a sudoku cell costs ninety, and a designer who can see that
	 * learns which questions are cheap. It is also the only honest way to
	 * explain why one click returns instantly and another takes seconds.
	 */
	solves: number | null;
}

export interface ValueEditorProps {
	label: string;
	type: ValueType;
	value: Value;
	/** Tokens of a matching type — the legal things to link to. */
	tokens: readonly Token[];
	/** What each alternative currently resolves to, for the swatches. */
	preview: (term: Term) => string | undefined;
	onChange: (next: Value) => void;
	/** Which alternative the shown universe is using, if any. */
	active?: number;
	/** Set when the solver reports this assignment as unsettled. */
	varying?: boolean;
	/**
	 * Alternatives that occur in at least one legal design — the solver's brave
	 * consequences. Anything outside it cannot happen, however it is written,
	 * so the row says so instead of offering it as a live choice. Undefined
	 * while no answer is in hand, when nothing should be marked.
	 */
	reachable?: ReadonlySet<number>;
	/** The alternative the user has fixed, if any. */
	pinned?: number;
	/** Fix or release an alternative. Null releases. */
	onPin?: (index: number | null) => void;
	/** Ask the solver about one of these values, and show what it said. */
	why?: WhyRow;
	/**
	 * The solver's own index for each alternative, where it is not the position.
	 *
	 * A variable a *rule* minted numbers its alternatives however the rule liked
	 * — `alt(prop(cell(R,C),text),D) :- digit(D)` numbers them 1..9 — and it is
	 * that number `pick/2` carries and a pin assumes. Absent for a document
	 * value, whose alternatives are a list and so are numbered by position.
	 */
	indices?: readonly number[];
	/**
	 * The row shows a variable the document does not hold, so there is nothing to
	 * type into, link or add to. Everything that *asks* the solver a question —
	 * which alternative is live, which are ruled out, pinning one — still works,
	 * because those are questions about the answer, not about the document.
	 */
	readOnly?: boolean;
	/**
	 * The document's unit — what a length row reads out in, and what a number
	 * typed into one with no suffix means.
	 *
	 * Every other type ignores it: a colour has no unit and a line height is a
	 * ratio, and which is which is `isLengthType` off the value table rather
	 * than a list of property names kept in this file.
	 */
	unit?: Unit;
	fallback: string;
	/** Layer names, so a derivation from another node reads as its name. */
	names?: Readonly<Record<string, string>>;
	testId?: string;
}

/**
 * One property row.
 *
 * A row is a *list* of alternatives, not a single field: adding a second one
 * is how a designer says "either of these", and that is the only thing that
 * creates a branch. Each alternative is independently either a typed literal
 * or a link to a token.
 */
/**
 * How a term is spelled in the link dropdown.
 *
 * One select covers all three kinds because they are alternatives to each
 * other, not independent settings: a value is typed in, linked, or computed —
 * never two at once.
 */
export function optionValue(term: Term): string {
	if (term.kind === "token") return `ref:${term.token}`;
	if (term.kind === "derived") return `via:${term.via}:${term.from}`;
	return "";
}

/**
 * The inverse. Exported with {@link optionValue} because a style's variant is
 * edited a term at a time rather than a list at a time — see `Styles` — and
 * "typed in, linked, or computed" has to mean the same thing in both panels.
 */
export function termFor(option: string, fallback: string): Term {
	const link = /^ref:(.+)$/.exec(option);
	if (link) return ref(link[1]);
	const derived = /^via:([^:]+):(.+)$/.exec(option);
	if (derived) return derive(derived[1] as Derivation, derived[2]);
	return lit(fallback);
}

/**
 * The one length field in the editor.
 *
 * Three panels want it — a frame's four coordinates, a gap or a stroke width,
 * the distance a geometric rule holds to — and they want it to behave
 * identically, because somebody who learns that `12pt` is accepted in one field
 * will type it into all three. So it lives here beside {@link optionValue} and
 * {@link termFor}, and a panel supplies nothing but its own chrome.
 *
 * It commits on every keystroke that reads as a length, and keeps a draft of
 * what is actually in the box until the caret leaves. Both halves are load
 * bearing and they pull against each other. Committing per keystroke is what
 * makes the canvas follow a number as it is typed, which is most of why a field
 * beats a dialogue. Keeping the draft is what stops the field arguing with the
 * person using it: what is stored is canonical and what is shown is rounded
 * into the document's unit, so a box that re-rendered from the document
 * mid-word would turn `2` into `2px` under the caret and then have nowhere to
 * put the `4`. Letting go of the draft on blur is how a person finds out what
 * was kept — `0.5px` comes back as itself, `nonsense` was never written at all,
 * and neither answer needed an error message to say so.
 *
 * Text that is not a length is simply not committed. That is a narrowing: a
 * length field used to take any text at all, and `emuOf` is exact-or-nothing,
 * so what "any text" now buys is a dimension that silently reads as zero.
 */
export function LengthInput({
	value,
	unit,
	className,
	role,
	field,
	title,
	disabled,
	onCommit,
}: {
	/** The stored literal — `"24px"`, `"210mm"`, `"4763emu"`. */
	value: string;
	unit: Unit;
	className?: string;
	/** `data-role`, and `data-field` — how each panel already addresses its own. */
	role?: string;
	field?: string;
	title?: string;
	disabled?: boolean;
	/**
	 * The new stored literal — and only once what is in the box reads as a
	 * length, so half-typed text never reaches the document.
	 */
	onCommit: (text: string) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	return (
		<input
			className={className}
			data-role={role}
			data-field={field}
			title={title}
			disabled={disabled}
			value={draft ?? shownLength(value, unit)}
			onChange={(e) => {
				const text = e.target.value;
				setDraft(text);
				const read = typedLength(text, unit);
				if (read) onCommit(read.text);
			}}
			onBlur={() => setDraft(null)}
			onKeyDown={(e) => {
				// Enter is how a person says "that is the number" in a form, and here
				// it means "show me what you kept" — the blur drops the draft.
				if (e.key === "Enter") e.currentTarget.blur();
			}}
		/>
	);
}

/**
 * The one duration field, and the twin of {@link LengthInput} down to the draft.
 *
 * A duration is the fourth quantity and it needs its own field for the reason a
 * length needed one: `msOf` is exact-or-nothing, so a plain text input commits
 * `"200m"` on the way to `"200ms"` and the transition it paces silently falls
 * back to the table's 200 while somebody is still typing. Committing only what
 * reads as a duration is what makes the half-typed state harmless.
 *
 * Two things it deliberately does *not* borrow from its twin. There is no
 * document-wide unit, so what is shown is what is stored — `"0.2s"` stays
 * `"0.2s"` — and {@link durationUnitOf} keeps whichever of the two the person
 * was typing in, because a document whose motion scale is written in seconds
 * should stay in seconds across an edit. And it commits through `nearestMs`
 * rather than `msOf`, which is the one editorial rounding this feature allows
 * and the one that names its caller: a field a person is typing into. `1.5ms`
 * is not a whole millisecond and the program can only carry whole ones, so the
 * choice is between rounding it here, where it is visible in the box the moment
 * the caret leaves, and refusing it, which would look like the field being
 * broken.
 */
export function DurationInput({
	value,
	className,
	role,
	field,
	title,
	disabled,
	onCommit,
}: {
	/** The stored literal — `"200ms"`, `"0.2s"`, `"0"`. */
	value: string;
	className?: string;
	role?: string;
	field?: string;
	title?: string;
	disabled?: boolean;
	/** The new stored literal, once what is in the box reads as a duration. */
	onCommit: (text: string) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	return (
		<input
			className={className}
			data-role={role}
			data-field={field}
			title={title}
			disabled={disabled}
			value={draft ?? value}
			onChange={(e) => {
				const text = e.target.value;
				setDraft(text);
				const ms = nearestMs(text);
				if (ms !== undefined) {
					onCommit(writeDuration(ms, durationUnitOf(text, durationUnitOf(value))));
				}
			}}
			onBlur={() => setDraft(null)}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
			}}
		/>
	);
}

export function ValueEditor({
	label,
	type,
	value,
	tokens,
	preview,
	onChange,
	active,
	varying,
	reachable,
	pinned,
	onPin,
	why,
	indices,
	readOnly,
	unit = DEFAULT_UNIT,
	fallback,
	names,
	testId,
}: ValueEditorProps) {
	// Which alternative the solver calls this one. For a document value the
	// position *is* the index, which is why nothing else in the row has to know.
	const at = (position: number) => indices?.[position] ?? position;
	const isColour = type === "color";
	const isLength = isLengthType(type);
	const isTime = isTimeType(type);
	/**
	 * How a literal of this type reads on screen: a length in the document's
	 * unit, anything on a closed menu by the menu's own name, everything else as
	 * itself. One function so the read-only row, the editable row and the little
	 * resolved-value tag beside a token cannot drift apart.
	 */
	const shown = (text: string) =>
		isLength ? shownLength(text, unit) : optionLabel(type, text);
	const multiline = VALUE_TYPES[type].multiline === true;
	// A closed set of choices is a menu. Typing a font stack or a box-shadow by
	// hand is not editing, it is remembering.
	const options = VALUE_TYPES[type].options;
	// A derivation only makes sense where it reads and writes the same type —
	// the contrast of a font weight is not a thing.
	const derivations = (Object.keys(DERIVATIONS) as Derivation[]).filter(
		(via) => DERIVATIONS[via].type === type,
	);
	/**
	 * An alternative no design in the current space picks.
	 *
	 * Two different reasons land here and the wording has to cover both: a rule
	 * or a pin may forbid it, or another alternative may already resolve to the
	 * same thing — designs are compared by what they *render*, so a duplicate
	 * produces nothing new. Either way it is not a live choice, but neither is
	 * it impossible to write.
	 */
	const unused = (position: number) =>
		reachable !== undefined && value.length > 1 && !reachable.has(at(position));
	const usedCount = reachable
		? value.filter((_, position) => reachable.has(at(position))).length
		: value.length;
	const narrowed = reachable !== undefined && usedCount < value.length;

	function replace(index: number, term: Term) {
		onChange(value.map((t, i) => (i === index ? term : t)));
	}

	function remove(index: number) {
		// The last alternative cannot go: a property with no value has nothing
		// to render. Clearing it entirely is a separate action.
		if (value.length <= 1) return;
		onChange(value.filter((_, i) => i !== index));
	}

	function add() {
		const last = value.at(-1);
		// Seed from the current value so the new row starts somewhere sensible.
		onChange([...value, last ? { ...last } : lit(fallback)]);
	}

	return (
		<section className={styles.row} data-prop={testId} data-varying={varying ? "" : undefined}>
			<header className={styles.head}>
				<span className={styles.label}>{label}</span>
				{value.length > 1 ? (
					<span
						className={cx(styles.count, usedCount === 1 && styles.settled)}
						data-role="alt-count"
						data-narrowed={narrowed ? "" : undefined}
						title={
							narrowed
								? "The rest are ruled out, or resolve to the same thing as one of these"
								: undefined
						}
					>
						{narrowed
							? `${usedCount} of ${value.length} in use`
							: `${value.length} values`}
					</span>
				) : null}
			</header>

			<div className={styles.alts}>
				{value.map((term, index) => {
					const resolved = preview(term);
					const isActive = value.length > 1 && at(index) === active;
					const dead = unused(index);
					const isPinned = pinned === at(index);
					return (
						<div
							key={index}
							className={cx(
								styles.alt,
								isActive && styles.active,
								dead && styles.impossible,
								isPinned && styles.pinned,
							)}
							data-alt={index}
							data-active={isActive ? "" : undefined}
							data-impossible={dead ? "" : undefined}
							data-pinned={isPinned ? "" : undefined}
							title={
								dead
									? "No design uses this value — either a rule rules it out, or another value already produces the same design"
									: undefined
							}
						>
							{isColour ? (
								<input
									type="color"
									className={styles.swatch}
									data-role="swatch"
									disabled={readOnly || term.kind !== "literal"}
									value={/^#[0-9a-f]{6}$/i.test(resolved ?? "") ? resolved : "#94a3b8"}
									onChange={(e) => replace(index, lit(e.target.value))}
								/>
							) : (
								<span
									className={styles.dot}
									data-role="dot"
									aria-hidden="true"
								/>
							)}

							{readOnly ? (
								// Nothing to type into: the rule that produced this is what
								// says so, and the Rules panel is where the rule is.
								<span className={styles.text} data-role="literal-readonly">
									{term.kind === "literal"
										? shown(term.value)
										: termLabel(tokens, term, names)}
								</span>
							) : term.kind === "literal" && options ? (
								<select
									className={styles.choice}
									data-role="literal"
									value={term.value}
									onChange={(e) => replace(index, lit(e.target.value))}
								>
									{/* Anything written before the list existed — an older
									    document, a hand-edited value — stays selectable
									    rather than silently becoming the first option. */}
									{options.some((o) => o.value === term.value) ? null : (
										<option value={term.value}>{term.value}</option>
									)}
									{options.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							) : term.kind === "literal" && isLength ? (
								// A length is the one literal that is not stored as it is
								// shown: the document keeps `"12pt"` and a millimetre document
								// reads it out as `4.23333mm`. See {@link LengthInput}.
								<LengthInput
									className={styles.text}
									role="literal"
									value={term.value}
									unit={unit}
									title="A number in this document's unit, or one with its own — 12pt, 0.25in"
									onCommit={(text) => replace(index, lit(text))}
								/>
							) : term.kind === "literal" && isTime ? (
								// And the fourth quantity, for the reason the third one is
								// here: `msOf` is exact or nothing, so a plain input would
								// commit `200m` on the way to `200ms`. See
								// {@link DurationInput}.
								<DurationInput
									className={styles.text}
									role="literal"
									value={term.value}
									title="How long, in milliseconds or seconds — 200ms, 0.2s"
									onCommit={(text) => replace(index, lit(text))}
								/>
							) : term.kind === "literal" ? (
								multiline ? (
									<textarea
										className={cx(styles.text, styles.prose)}
										data-role="literal"
										rows={2}
										value={term.value}
										onChange={(e) => replace(index, lit(e.target.value))}
									/>
								) : (
									<input
										className={styles.text}
										data-role="literal"
										value={term.value}
										onChange={(e) => replace(index, lit(e.target.value))}
									/>
								)
							) : (
								<span
									className={styles.token}
									data-role={term.kind === "derived" ? "derived-ref" : "token-ref"}
								>
									{termLabel(tokens, term, names)}
									{resolved ? (
										<span className={styles.resolved}>
											{shown(resolved)}
										</span>
									) : (
										<span className={styles.broken}>unresolved</span>
									)}
								</span>
							)}

							{readOnly ? null : (
								<select
									className={styles.link}
									data-role="link"
									title="Type a value, link it to a variable, or compute it from one"
									value={optionValue(term)}
									onChange={(e) =>
										replace(index, termFor(e.target.value, resolved ?? fallback))
									}
								>
									<option value="">Custom</option>
									{tokens.length > 0 ? (
										<optgroup label="Link to">
											{tokens.map((t) => (
												<option key={t.id} value={`ref:${t.id}`}>
													{t.name}
												</option>
											))}
										</optgroup>
									) : null}
									{tokens.length > 0
										? derivations.map((via) => (
												<optgroup key={via} label={DERIVATIONS[via].label}>
													{tokens.map((t) => (
														<option key={t.id} value={`via:${via}:${tokenVar(t.id)}`}>
															{t.name}
														</option>
													))}
												</optgroup>
											))
										: null}
								</select>
							)}

							{why && value.length > 1 && (dead || isActive) ? (
								<button
									type="button"
									className={cx(
										styles.ask,
										why.at === at(index) && styles.asking,
									)}
									data-role="why-alt"
									aria-pressed={why.at === at(index)}
									title={
										dead
											? "Ask the solver why no design uses this. Costs a solve per rule."
											: "Ask the solver what makes it this value. Costs a solve per rule."
									}
									onClick={() =>
										why.ask(why.at === at(index) ? null : at(index))
									}
								>
									?
								</button>
							) : null}

							{onPin && value.length > 1 ? (
								<button
									type="button"
									className={cx(styles.pin, isPinned && styles.pinOn)}
									data-role="pin-alt"
									aria-pressed={isPinned}
									title={
										isPinned
											? "Release this value"
											: "Show only designs that use this value"
									}
									onClick={() => onPin(isPinned ? null : at(index))}
								>
									{isPinned ? "◆" : "◇"}
								</button>
							) : null}

							{readOnly ? null : (
								<button
									type="button"
									className={styles.remove}
									data-role="remove-alt"
									title="Remove this value"
									disabled={value.length <= 1}
									onClick={() => remove(index)}
								>
									×
								</button>
							)}
						</div>
					);
				})}
			</div>

			{why && why.at !== null ? (
				<p
					className={styles.why}
					data-role="why"
					data-verdict={why.verdict ?? undefined}
					data-pending={why.answer === null ? "" : undefined}
				>
					{why.answer ?? "Asking the solver — one solve per rule…"}
					{why.solves !== null ? (
						<span className={styles.cost} data-role="why-cost">
							{why.solves} solve{why.solves === 1 ? "" : "s"}
						</span>
					) : null}
				</p>
			) : null}

			{readOnly ? null : (
				<button
					type="button"
					className={styles.add}
					data-role="add-alt"
					onClick={add}
				>
					+ Add value
				</button>
			)}
		</section>
	);
}
