import { type ReactNode, useState } from "react";
import { CONTRACT, type Scene } from "@clingo-design/design-core";

import styles from "./ProgramPanel.module.css";
import tabStyles from "./tabs.module.css";
import { cx } from "./cx";

export interface ProgramPanelProps {
	scene: Scene;
	generated: string;
	onChange: (next: Scene) => void;
	error: string | null;
	/** Right-aligned slot in the tab strip — the studio puts its status there. */
	status?: ReactNode;
}

type Tab = "rules" | "generated" | "contract";

const TABS: Array<{ id: Tab; label: string }> = [
	{ id: "rules", label: "Your rules" },
	{ id: "generated", label: "Generated" },
	{ id: "contract", label: "Predicates" },
];

/**
 * The power-user escape hatch. The generated half is read-only — it is a
 * projection of the document, so editing it would have nowhere to go — while
 * the rules half is free-form ASP appended to it.
 *
 * The tab strip sits at the bottom with the content above it. Clicking the
 * active tab collapses the panel to just that strip; clicking any other tab
 * switches to it, reopening if needed. The last tab survives a collapse.
 */
export function ProgramPanel({
	scene,
	generated,
	onChange,
	error,
	status,
}: ProgramPanelProps) {
	const [tab, setTab] = useState<Tab>("rules");
	const [open, setOpen] = useState(true);

	function select(id: Tab) {
		if (id === tab) {
			setOpen((wasOpen) => !wasOpen);
			return;
		}
		setTab(id);
		setOpen(true);
	}

	return (
		<div
			className={cx(styles.program, !open && styles.closed)}
			data-role="program-panel"
			data-open={open || undefined}
		>
			{open ? (
				<>
					{tab === "rules" ? (
						<textarea
							className={styles.code}
							spellCheck={false}
							value={scene.rules}
							onChange={(e) => onChange({ ...scene, rules: e.target.value })}
						/>
					) : (
						<pre className={cx(styles.code, styles.readonly)}>
							{tab === "generated" ? generated : CONTRACT}
						</pre>
					)}

					{error ? (
						<div className={styles.error} data-role="error">
							{error}
						</div>
					) : null}
				</>
			) : null}

			<div className={cx(tabStyles.bar, styles.tabs)}>
				{TABS.map(({ id, label }) => {
					const active = id === tab;
					return (
						<button
							key={id}
							type="button"
							data-tab={id}
							className={cx(tabStyles.button, active && open && tabStyles.active)}
							aria-expanded={active ? open : undefined}
							title={active ? (open ? "Collapse panel" : "Expand panel") : undefined}
							onClick={() => select(id)}
						>
							{label}
							{active ? <span className={styles.caret} aria-hidden="true" /> : null}
						</button>
					);
				})}
				{status ? <div className={styles.status}>{status}</div> : null}
			</div>
		</div>
	);
}
