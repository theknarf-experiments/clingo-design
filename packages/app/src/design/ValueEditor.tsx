import {
	DERIVATIONS,
	type Derivation,
	type Term,
	VALUE_TYPES,
	type Value,
	type ValueType,
	derive,
	lit,
	optionLabel,
	ref,
	termLabel,
	tokenVar,
	type Token,
} from "@clingo-design/design-core";

import styles from "./ValueEditor.module.css";
import { cx } from "./cx";

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
function optionValue(term: Term): string {
	if (term.kind === "token") return `ref:${term.token}`;
	if (term.kind === "derived") return `via:${term.via}:${term.from}`;
	return "";
}

function termFor(option: string, fallback: string): Term {
	const link = /^ref:(.+)$/.exec(option);
	if (link) return ref(link[1]);
	const derived = /^via:([^:]+):(.+)$/.exec(option);
	if (derived) return derive(derived[1] as Derivation, derived[2]);
	return lit(fallback);
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
	fallback,
	names,
	testId,
}: ValueEditorProps) {
	const isColour = type === "color";
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
	const unused = (index: number) =>
		reachable !== undefined && value.length > 1 && !reachable.has(index);
	const usedCount = reachable
		? [...reachable].filter((i) => i < value.length).length
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
					const isActive = value.length > 1 && index === active;
					const dead = unused(index);
					const isPinned = pinned === index;
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
									disabled={term.kind !== "literal"}
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

							{term.kind === "literal" && options ? (
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
							) : term.kind === "literal" ? (
								<input
									className={styles.text}
									data-role="literal"
									value={term.value}
									onChange={(e) => replace(index, lit(e.target.value))}
								/>
							) : (
								<span
									className={styles.token}
									data-role={term.kind === "derived" ? "derived-ref" : "token-ref"}
								>
									{termLabel(tokens, term, names)}
									{resolved ? (
										<span className={styles.resolved}>
											{optionLabel(type, resolved)}
										</span>
									) : (
										<span className={styles.broken}>unresolved</span>
									)}
								</span>
							)}

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
									onClick={() => onPin(isPinned ? null : index)}
								>
									{isPinned ? "◆" : "◇"}
								</button>
							) : null}

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
						</div>
					);
				})}
			</div>

			<button
				type="button"
				className={styles.add}
				data-role="add-alt"
				onClick={add}
			>
				+ Add value
			</button>
		</section>
	);
}
