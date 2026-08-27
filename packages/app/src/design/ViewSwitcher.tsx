import styles from "./ViewSwitcher.module.css";

export interface ViewOption<T extends string> {
	id: T;
	label: string;
	hint?: string;
}

export interface ViewSwitcherProps<T extends string> {
	/**
	 * Exactly two: a toggle with three states is a menu.
	 *
	 * The rule has been tested once and held. A component's state machine wants
	 * its states drawn side by side, which looks at first like a third view and
	 * is not one: a view is what the *whole canvas* shows, and there are two of
	 * those — the one design you are editing, and the space it came from. A strip
	 * of one component's states is an annotation on the design in front of you.
	 * It appears because something is selected and goes away when nothing is,
	 * which is what the align tools and the rulers already do, so it lives on the
	 * canvas in the design's own coordinates and this control stayed a toggle.
	 *
	 * Recorded here rather than only at the strip, because the pressure to widen
	 * a two-way switch arrives from somewhere else every time, and the argument
	 * has to be findable from the thing being widened.
	 */
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
