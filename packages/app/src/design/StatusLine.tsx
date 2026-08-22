import type { Exploration } from "@clingo-design/design-core";

import styles from "./StatusLine.module.css";

export interface StatusLineProps {
	exploration: Exploration | null;
	error: string | null;
	solving: boolean;
	/** How many assignments hold more than one value. */
	varyingCount: number;
	/** Nodes currently selected on the canvas. */
	selectionCount?: number;
}

/**
 * What the time was spent on. Deliberately only the round-trip count: whether
 * the grounding was reused is decided by the compiled program, not by anything
 * the designer chose, so reporting it invites reading it as a lever.
 */
function detail(exploration: Exploration): string {
	const n = exploration.solves;
	return `${n} solver round trip${n === 1 ? "" : "s"}`;
}

/** The one-line summary of the current space, shown in the bottom bar. */
export function StatusLine({
	exploration,
	error,
	solving,
	varyingCount,
	selectionCount = 0,
}: StatusLineProps) {
	return (
		<div className={styles.status} data-role="status">
			{error ? (
				<span className={styles.bad} data-role="error" title={error}>
					{error}
				</span>
			) : exploration ? (
				<>
					<strong>{exploration.count}</strong>
					{exploration.truncated ? (
						<>
							{" of "}
							{exploration.total === null
								? "many"
								: exploration.total.toLocaleString()}
						</>
					) : null}{" "}
					universe{exploration.count === 1 ? "" : "s"}
					{exploration.sampling.sampled ? (
						<span
							className={styles.tag}
							title="Enumeration order is biased; these are sampled across every varying token."
						>
							sampled
						</span>
					) : null}
					{exploration.optimized ? (
						<span
							className={styles.tag}
							title={`Only proven optima are shown (cost ${exploration.costs.join(", ")}).`}
						>
							optimal
						</span>
					) : null}
					{varyingCount > 0
						? ` · ${varyingCount} variable${varyingCount === 1 ? "" : "s"} varying`
						: " · fully settled"}
					<span className={styles.ms} title={detail(exploration)}>
						{" "}
						{exploration.ms}ms
					</span>
				</>
			) : (
				"solving…"
			)}
			{selectionCount > 0 ? (
				<span className={styles.ms}>
					· {selectionCount} selected
				</span>
			) : null}
			{solving ? <span className={styles.spin} /> : null}
		</div>
	);
}
