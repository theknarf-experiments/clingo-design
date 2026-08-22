import {
	DERIVATIONS,
	type Derivation,
	type Term,
	type Value,
	type ValueType,
	derive,
	lit,
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
	fallback,
	names,
	testId,
}: ValueEditorProps) {
	const isColour = type === "color";
	// A derivation only makes sense where it reads and writes the same type —
	// the contrast of a font weight is not a thing.
	const derivations = (Object.keys(DERIVATIONS) as Derivation[]).filter(
		(via) => DERIVATIONS[via].type === type,
	);

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
					<span className={styles.count} data-role="alt-count">
						{value.length} values
					</span>
				) : null}
			</header>

			<div className={styles.alts}>
				{value.map((term, index) => {
					const resolved = preview(term);
					const isActive = value.length > 1 && index === active;
					return (
						<div
							key={index}
							className={cx(styles.alt, isActive && styles.active)}
							data-alt={index}
							data-active={isActive ? "" : undefined}
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

							{term.kind === "literal" ? (
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
										<span className={styles.resolved}>{resolved}</span>
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
