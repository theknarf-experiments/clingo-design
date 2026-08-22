import { useCallback, useRef, useState } from "react";
import { KINDS, type NodeKind } from "@clingo-design/design-core";

import { ToolIcon } from "./ToolIcon";
import styles from "./ShapePicker.module.css";
import { cx } from "./cx";
import { useDismiss } from "./useDismiss";

export interface ShapePickerProps {
	shapes: readonly NodeKind[];
	/** The shape the button currently stands for. */
	value: NodeKind;
	/** Whether that shape is the live tool. */
	active: boolean;
	/** Shown in the tooltip; the key also cycles the slot. */
	shortcut: string;
	onPick: (kind: NodeKind) => void;
}

/**
 * The toolbar's shape slot: a button that draws the shape it is showing, and a
 * menu that changes which shape that is.
 *
 * A button per shape would be most of the toolbar, and the bar floats over the
 * canvas — so the shapes share one slot and one key, the way they do in every
 * drawing tool.
 */
export function ShapePicker({
	shapes,
	value,
	active,
	shortcut,
	onPick,
}: ShapePickerProps) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);

	useDismiss(
		root,
		useCallback(() => setOpen(false), []),
		open,
	);

	return (
		<div
			className={styles.root}
			ref={root}
			data-role="shape-picker"
			data-shape={value}
		>
			<button
				type="button"
				data-tool={value}
				aria-label={KINDS[value].label}
				className={cx(styles.tool, active && styles.active)}
				onClick={() => onPick(value)}
			>
				<ToolIcon tool={value} />
				<span className={styles.tip} role="tooltip" aria-hidden="true">
					{KINDS[value].label}
					<kbd className={styles.tipKey}>{shortcut}</kbd>
				</span>
			</button>

			<button
				type="button"
				className={styles.caret}
				data-role="shape-menu"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Other shapes"
				onClick={() => setOpen((o) => !o)}
			/>

			{open ? (
				<div className={styles.menu} role="menu">
					{shapes.map((kind) => (
						<button
							key={kind}
							type="button"
							role="menuitemradio"
							aria-checked={kind === value}
							data-shape-option={kind}
							className={cx(styles.item, kind === value && styles.itemActive)}
							onClick={() => {
								onPick(kind);
								setOpen(false);
							}}
						>
							<ToolIcon tool={kind} />
							<span className={styles.itemLabel}>{KINDS[kind].label}</span>
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
