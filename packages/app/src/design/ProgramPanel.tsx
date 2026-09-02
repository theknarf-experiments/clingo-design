import { type ReactNode, useRef, useState } from "react";
import {
	CONTRACT,
	countDiagnostics,
	type Scene,
	type Universe,
} from "@clingo-design/design-core";

import { Code } from "./Code";
import { ExportPanel } from "./ExportPanel";
import styles from "./ProgramPanel.module.css";
import tabStyles from "./tabs.module.css";
import { cx } from "./cx";

export interface ProgramPanelProps {
	scene: Scene;
	generated: string;
	onChange: (next: Scene) => void;
	error: string | null;
	/**
	 * What clingo remarked about a program it ran anyway, line numbers already
	 * pointing at the user's own rules.
	 *
	 * Separate from `error` because they mean opposite things about the canvas:
	 * an error means nothing is on it, a remark means the design is fine and a
	 * rule is not earning its keep. The commonest one by far is a misspelled
	 * predicate, which grounds happily and does nothing.
	 */
	diagnostics: string;
	/**
	 * What the tool approximated about the designs on screen — its own remarks
	 * rather than clingo's, and shown in the same band for the same reason they
	 * are counted with them: the reader's question is whether anything about
	 * their rules is quietly not doing what it looks like.
	 */
	approximations: readonly string[];
	/** The space as it stands, for the export tab. */
	universes: readonly Universe[];
	projectName: string;
	/**
	 * Which page this is, and the project's pages by the id a link carries — both
	 * passed straight through to {@link ExportPanel}.
	 *
	 * This panel never looks at either, for the reason {@link posters} is on the
	 * way: the studio holds them and the export is where they are wanted, and
	 * threading them rather than reaching for a context keeps the one place that
	 * knows and the one place that uses visible in the same call chain.
	 */
	pageName?: string;
	pages?: Readonly<Record<string, string>>;
	/**
	 * The last frame each 3D view drew, as a PNG data URL by viewport node id —
	 * passed straight through to {@link ExportPanel}.
	 *
	 * This panel never looks at one. It is on the way because the studio holds the
	 * pictures and the export is where they are wanted, and threading them rather
	 * than reaching for a context keeps the one place that takes a photograph and
	 * the one place that uses it visible in the same call chain.
	 */
	posters?: Record<string, string>;
	/** Right-aligned slot in the tab strip — the studio puts its status there. */
	status?: ReactNode;
}

type Tab = "rules" | "generated" | "contract" | "export";

const TABS: Array<{ id: Tab; label: string }> = [
	{ id: "rules", label: "Your rules" },
	{ id: "generated", label: "Generated" },
	{ id: "contract", label: "Predicates" },
	{ id: "export", label: "Export" },
];

/**
 * The power-user escape hatch, and the way out.
 *
 * The generated half is read-only — it is a projection of the document, so
 * editing it would have nowhere to go — while the rules half is free-form ASP
 * appended to it. Export sits alongside them because it is the same kind of
 * thing: a rendering of the document into text you take somewhere else.
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
	diagnostics,
	approximations,
	universes,
	projectName,
	pageName,
	pages,
	posters,
	status,
}: ProgramPanelProps) {
	const [tab, setTab] = useState<Tab>("rules");
	// Closed by default: this is the escape hatch for reading and writing the
	// generated ASP, and most sessions never need it open.
	const [open, setOpen] = useState(false);
	const paint = useRef<HTMLPreElement | null>(null);
	// One band, two sources: clingo's remarks about the program, then the tool's
	// about its own arithmetic. An error wins it outright either way — when the
	// document does not ground there is no answer for a remark to be about, and
	// whatever was said last describes the program from before the edit that
	// broke it.
	const notes = error ? "" : [diagnostics, ...approximations].filter(Boolean).join("\n");
	const noteCount = countDiagnostics(notes);

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
					{tab === "export" ? (
						<ExportPanel
							scene={scene}
							universes={universes}
							projectName={projectName}
							pageName={pageName}
							pages={pages}
							posters={posters}
						/>
					) : tab === "rules" ? (
						<div className={styles.editor}>
							<pre
								ref={paint}
								className={cx(styles.code, styles.paint)}
								aria-hidden="true"
							>
								<Code text={scene.rules} />
							</pre>
							<textarea
								className={cx(styles.code, styles.input)}
								spellCheck={false}
								value={scene.rules}
								onChange={(e) => onChange({ ...scene, rules: e.target.value })}
								onScroll={(e) => {
									// The copy below has no scrollbars of its own; it is
									// dragged along by the one box the user can reach.
									const under = paint.current;
									if (!under) return;
									under.scrollTop = e.currentTarget.scrollTop;
									under.scrollLeft = e.currentTarget.scrollLeft;
								}}
							/>
						</div>
					) : (
						<pre className={cx(styles.code, styles.readonly)}>
							<Code text={tab === "generated" ? generated : CONTRACT} />
						</pre>
					)}

					{error ? (
						<div className={styles.error} data-role="error">
							{error}
						</div>
					) : noteCount > 0 ? (
						<div className={styles.notes} data-role="diagnostics">
							{notes}
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
							{id === "rules" && noteCount > 0 ? (
								<span
									className={styles.badge}
									data-role="diagnostic-count"
									title={`${noteCount} thing${noteCount === 1 ? "" : "s"} remarked on`}
								>
									{noteCount}
								</span>
							) : null}
							{active ? <span className={styles.caret} aria-hidden="true" /> : null}
						</button>
					);
				})}
				{status ? <div className={styles.status}>{status}</div> : null}
			</div>
		</div>
	);
}
