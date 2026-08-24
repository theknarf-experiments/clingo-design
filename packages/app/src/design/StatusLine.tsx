import {
	type Exploration,
	FRAME_AXES,
	type Freedom,
	degreesOfFreedom,
	describeCosts,
} from "@clingo-design/design-core";

import styles from "./StatusLine.module.css";

export interface StatusLineProps {
	exploration: Exploration | null;
	error: string | null;
	solving: boolean;
	/**
	 * How many assignments the solver has left a choice about.
	 *
	 * The solver's count rather than the document's, because it sits next to the
	 * universe count and the two have to agree: "5 universes · fully settled" is
	 * a sentence that contradicts itself.
	 */
	varyingCount: number;
	/** Nodes currently selected on the canvas. */
	selectionCount?: number;
	/** How far the selection's solver-owned coordinates can still travel. */
	freedom?: Freedom;
	/** True while that is being worked out. */
	probing?: boolean;
}

/**
 * What the selection has left, in words.
 *
 * Only worth saying about geometry the solver decides: a node the document
 * places has all four of its numbers and always will, and announcing that on
 * every click would be noise. Silence therefore means "nothing has been said
 * about this node", which is the truth.
 */
function room(freedom: Freedom): { label: string; detail: string } | null {
	const ids = Object.keys(freedom);
	if (ids.length !== 1) return null;
	const node = freedom[ids[0]];
	// Counted over all four numbers, not only the ones the solver took charge
	// of: "fully determined" has to mean there is nothing left to change, and a
	// container that hugs its contents still has somewhere to be put.
	const free = degreesOfFreedom(node);
	const detail = FRAME_AXES.map((axis) => {
		const travel = node[axis];
		if (!free.includes(axis)) return `${axis} pinned`;
		if (!travel || (travel.min === null && travel.max === null)) {
			return `${axis} open`;
		}
		return `${axis} ${travel.min ?? "−∞"} to ${travel.max ?? "∞"}`;
	}).join(" · ");
	return {
		label:
			free.length === 0
				? "fully determined"
				: `${free.length} degree${free.length === 1 ? "" : "s"} of freedom`,
		detail,
	};
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

/**
 * How much worse than the best a shown design is allowed to be, in points.
 *
 * Read back off the ceiling rather than passed down: the number the user cares
 * about is "how far from best", and the exploration reports the ceiling itself
 * because that is what it enumerated under.
 */
function slackOf(exploration: Exploration): string {
	return exploration.bound
		.map((bound, i) => bound - (exploration.costs[i] ?? 0))
		.join(", ");
}

/** The one-line summary of the current space, shown in the bottom bar. */
export function StatusLine({
	exploration,
	error,
	solving,
	varyingCount,
	selectionCount = 0,
	freedom = {},
	probing = false,
}: StatusLineProps) {
	const left = room(freedom);
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
							title={
								exploration.optimized
									? "Enumeration order is biased, so the designs tied at each cost are sampled across every varying token. Nothing shown is worse for it."
									: "Enumeration order is biased; these are sampled across every varying token."
							}
						>
							sampled
						</span>
					) : null}
					{exploration.optimized ? (
						<>
							<span
								className={styles.tag}
								data-role="ranked"
								title={`This document prefers rather than forbids, so these are the designs within ${slackOf(exploration)} of the best, best first — not only the best. Ceiling ${exploration.bound.join(", ")}.`}
							>
								ranked
							</span>
							<span
								data-role="cost"
								title="What the best design on the grid gave up. Every other design gave up at least as much."
							>
								{" · best gives up "}
								{describeCosts(exploration.costs, exploration.levels)}
							</span>
						</>
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
			{left ? (
				<span
					className={left.label === "fully determined" ? styles.ms : undefined}
					data-role="freedom"
					title={`${left.detail} — two solves per coordinate, so this is asked only about the selection`}
				>
					· {left.label}
				</span>
			) : probing ? (
				<span className={styles.ms} data-role="freedom">
					· probing…
				</span>
			) : null}
			{solving ? <span className={styles.spin} /> : null}
		</div>
	);
}
