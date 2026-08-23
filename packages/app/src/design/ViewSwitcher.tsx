import styles from "./ViewSwitcher.module.css";

export interface ViewOption<T extends string> {
	id: T;
	label: string;
	hint?: string;
}

export interface ViewSwitcherProps<T extends string> {
	/** Exactly two: a toggle with three states is a menu. */
	options: readonly [ViewOption<T>, ViewOption<T>];
	value: T;
	onChange: (next: T) => void;
}

/**
 * Flips between the two views.
 *
 * A dropdown for two options is a menu whose only useful row is the one you
 * are not on, so this is a button instead: it names where you are, and one
 * click is the whole interaction. The label stays text rather than becoming an
 * icon like the tools — "Multiverse" is the kind of word a picture cannot make
 * unambiguous.
 */
export function ViewSwitcher<T extends string>({
	options,
	value,
	onChange,
}: ViewSwitcherProps<T>) {
	const current = options.find((o) => o.id === value) ?? options[0];
	const other = options.find((o) => o.id !== current.id) ?? options[1];

	return (
		<button
			type="button"
			className={styles.toggle}
			data-role="view-switcher"
			data-view-current={current.id}
			data-view-next={other.id}
			aria-label={`${current.label} view. Switch to ${other.label}.`}
			onClick={() => onChange(other.id)}
		>
			<Swap />
			{current.label}
			<span className={styles.tip} role="tooltip" aria-hidden="true">
				Switch to {other.label}
				{other.hint ? <span className={styles.tipHint}>{other.hint}</span> : null}
			</span>
		</button>
	);
}

/** Two arrows passing: the shape of a thing that swaps rather than opens. */
function Swap() {
	return (
		<svg
			className={styles.icon}
			viewBox="0 0 16 16"
			width="13"
			height="13"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M2 5h10M9.5 2.5 12 5 9.5 7.5" />
			<path d="M14 11H4M6.5 8.5 4 11l2.5 2.5" />
		</svg>
	);
}
