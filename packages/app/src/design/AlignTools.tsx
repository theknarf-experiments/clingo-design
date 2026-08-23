import { EDGES, type Edge, EDGE_NAMES } from "@clingo-design/design-core";

import styles from "./AlignTools.module.css";

/** The six a click can mean: a node's own places, not its sizes or the axes. */
const PLACES = EDGE_NAMES.filter((e) => EDGES[e].role === "pos");

export interface AlignToolsProps {
	/** How many layers a click would be about. */
	count: number;
	onAlign: (edge: Edge) => void;
	onDistribute: () => void;
}

/**
 * The alignments, as one press each.
 *
 * These are not commands that nudge boxes and forget: each one writes a
 * constraint, so the alignment survives everything that happens next. The
 * slot only exists while there is a multi-selection, because the bar floats
 * over the canvas and six more buttons on it at all times would be six buttons
 * in the way.
 */
export function AlignTools({ count, onAlign, onDistribute }: AlignToolsProps) {
	if (count < 2) return null;
	return (
		<div className={styles.tools} data-role="align-tools">
			{PLACES.map((edge) => (
				<button
					key={edge}
					type="button"
					data-align={edge}
					aria-label={`Align ${EDGES[edge].label.toLowerCase()}`}
					className={styles.tool}
					onClick={() => onAlign(edge)}
				>
					<AlignIcon edge={edge} />
					<span className={styles.tip} role="tooltip" aria-hidden="true">
						Align {EDGES[edge].label.toLowerCase()}
					</span>
				</button>
			))}
			<button
				type="button"
				data-role="distribute"
				aria-label="Even gaps"
				className={styles.tool}
				disabled={count < 3}
				onClick={onDistribute}
			>
				<DistributeIcon />
				<span className={styles.tip} role="tooltip" aria-hidden="true">
					{count < 3 ? "Even gaps needs three layers" : "Even gaps"}
				</span>
			</button>
		</div>
	);
}

/* Drawn on the same 16×16 grid as the tool icons. */
const RULE = { lead: 2.6, mid: 8, trail: 13.4 } as const;
const BARS = [
	{ length: 7, across: 3.3 },
	{ length: 10.8, across: 9.3 },
];
const THICK = 3.4;

/**
 * An alignment's glyph: the line the edges meet on, and two bars meeting it.
 *
 * Computed from the edge's own axis and place rather than drawn six times —
 * the icons differ by exactly what the table already says they differ by.
 */
function AlignIcon({ edge }: { edge: Edge }) {
	const { axis, place = "lead" } = EDGES[edge];
	const rule = RULE[place];
	const flip = axis === "y";
	const line = flip
		? { x1: 1.6, y1: rule, x2: 14.4, y2: rule }
		: { x1: rule, y1: 1.6, x2: rule, y2: 14.4 };
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			aria-hidden="true"
			focusable="false"
		>
			<line {...line} />
			{BARS.map((bar) => {
				const start =
					place === "lead"
						? rule
						: place === "mid"
							? rule - bar.length / 2
							: rule - bar.length;
				const rect = flip
					? { x: bar.across, y: start, width: THICK, height: bar.length }
					: { x: start, y: bar.across, width: bar.length, height: THICK };
				return (
					<rect
						key={bar.across}
						{...rect}
						rx="1"
						fill="currentColor"
						stroke="none"
						opacity="0.75"
					/>
				);
			})}
		</svg>
	);
}

/** Three bars with the same air between them, whichever way the run happens to lie. */
function DistributeIcon() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
			focusable="false"
		>
			{[2.4, 7.1, 11.8].map((x) => (
				<rect
					key={x}
					x={x}
					y="3.2"
					width="1.8"
					height="9.6"
					rx="0.8"
					fill="currentColor"
					opacity="0.75"
				/>
			))}
		</svg>
	);
}
