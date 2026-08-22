import { useRef } from "react";

import styles from "./ContextMenu.module.css";
import { useDismiss } from "./useDismiss";

export interface MenuItem {
	id: string;
	label: string;
	hint?: string;
	disabled?: boolean;
	run: () => void;
}

export interface ContextMenuProps {
	/** Position in the containing element's coordinates. */
	at: { x: number; y: number };
	items: Array<MenuItem | "separator">;
	onClose: () => void;
}

/**
 * A right-click menu, positioned in screen space.
 *
 * It renders outside the canvas transform, so it stays a fixed size no matter
 * how far the canvas is zoomed.
 */
export function ContextMenu({ at, items, onClose }: ContextMenuProps) {
	const root = useRef<HTMLDivElement>(null);
	useDismiss(root, onClose);

	return (
		<div
			ref={root}
			className={styles.menu}
			role="menu"
			data-role="context-menu"
			style={{ left: at.x, top: at.y }}
			onContextMenu={(e) => e.preventDefault()}
		>
			{items.map((item, i) =>
				item === "separator" ? (
					<div key={`sep${i}`} className={styles.separator} />
				) : (
					<button
						key={item.id}
						type="button"
						role="menuitem"
						data-menu={item.id}
						className={styles.item}
						disabled={item.disabled}
						onClick={() => {
							item.run();
							onClose();
						}}
					>
						<span>{item.label}</span>
						{item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
					</button>
				),
			)}
		</div>
	);
}
