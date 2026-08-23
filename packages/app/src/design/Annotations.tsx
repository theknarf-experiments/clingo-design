import type { Annotation } from "@clingo-design/design-core";

import styles from "./Annotations.module.css";

/** How far a dimension's end ticks reach either side of it, in document units. */
const TICK = 4;

/** How far a label floats off the mark it belongs to. */
const LIFT = 5;

export interface AnnotationsProps {
	notes: readonly Annotation[];
}

/**
 * The selected node's geometric rules, drawn over the design.
 *
 * Quiet on purpose: hairlines and small numbers, no arrowheads, no leader
 * lines. A constraint that shouts is a constraint you stop seeing the design
 * through — and this overlay shares the canvas with selection outlines, snap
 * guides, path anchors and layout drop targets, none of which it may be
 * mistaken for. It takes no pointer events at all, so nothing here can get in
 * the way of a drag.
 *
 * Everything is in document coordinates, inside a one-pixel anchor at the
 * origin that overflows — the same trick the pen uses.
 */
export function Annotations({ notes }: AnnotationsProps) {
	if (notes.length === 0) return null;
	return (
		<svg className={styles.marks} data-role="annotations" aria-hidden="true">
			{notes.map((note, i) => {
				// One coordinate is fixed and the other runs; which is which is the
				// difference between standing across the design and measuring along
				// it. Naming them once keeps both cases to one piece of drawing.
				const line =
					note.shape === "line"
						? { along: note.axis === "x" ? "y" : "x", at: note.at }
						: { along: note.axis, at: note.at };
				const horizontal = line.along === "x";
				const a = horizontal
					? { x: note.from, y: line.at }
					: { x: line.at, y: note.from };
				const b = horizontal
					? { x: note.to, y: line.at }
					: { x: line.at, y: note.to };
				const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
				return (
					<g
						key={`${note.constraint}-${i}`}
						className={styles.mark}
						data-annotation={note.constraint}
						data-kind={note.kind}
						data-shape={note.shape}
					>
						<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
						{note.shape === "span"
							? [a, b].map((end) => (
									<line
										key={`${end.x},${end.y}`}
										x1={horizontal ? end.x : end.x - TICK}
										y1={horizontal ? end.y - TICK : end.y}
										x2={horizontal ? end.x : end.x + TICK}
										y2={horizontal ? end.y + TICK : end.y}
									/>
								))
							: null}
						{note.label !== undefined ? (
							<text
								className={styles.label}
								x={mid.x + (horizontal ? 0 : LIFT)}
								y={mid.y - (horizontal ? LIFT : 0)}
								textAnchor={horizontal ? "middle" : "start"}
								dominantBaseline={horizontal ? "auto" : "middle"}
							>
								{note.label}
							</text>
						) : null}
					</g>
				);
			})}
		</svg>
	);
}
