import { useCallback, useRef, useState } from "react";

import styles from "./ViewSwitcher.module.css";
import { cx } from "./cx";
import { useDismiss } from "./useDismiss";

export interface ViewOption<T extends string> {
	id: T;
	label: string;
	hint?: string;
}

export interface ViewSwitcherProps<T extends string> {
	options: ReadonlyArray<ViewOption<T>>;
	value: T;
	onChange: (next: T) => void;
}

/**
 * Floating view picker, laid over the canvas rather than docked in a bar.
 * Sits outside the canvas's transform layer, so it stays put while the canvas
 * pans and zooms.
 */
export function ViewSwitcher<T extends string>({
	options,
	value,
	onChange,
}: ViewSwitcherProps<T>) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const current = options.find((o) => o.id === value);

	useDismiss(
		root,
		useCallback(() => setOpen(false), []),
		open,
	);

	return (
		<div className={styles.root} ref={root} data-role="view-switcher">
			<button
				type="button"
				className={styles.trigger}
				aria-haspopup="menu"
				aria-expanded={open}
				data-view-current={value}
				onClick={() => setOpen((o) => !o)}
			>
				{current?.label ?? value}
				<span className={styles.caret} aria-hidden="true" />
			</button>

			{open ? (
				<div className={styles.menu} role="menu">
					{options.map((option) => (
						<button
							key={option.id}
							type="button"
							role="menuitemradio"
							aria-checked={option.id === value}
							data-view={option.id}
							className={cx(
								styles.item,
								option.id === value && styles.itemActive,
							)}
							onClick={() => {
								onChange(option.id);
								setOpen(false);
							}}
						>
							<span className={styles.itemLabel}>{option.label}</span>
							{option.hint ? (
								<span className={styles.itemHint}>{option.hint}</span>
							) : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
