/**
 * What a design is *ruled* with, drawn: the margins, the column and row grid,
 * and the lines somebody pulled off a ruler.
 *
 * One renderer, used twice. The editable copy passes the handlers and gets a
 * grid whose hand-drawn lines can be dragged, locked and rubbed out; every other
 * copy on the canvas passes none and gets the same picture, inert. That split is
 * a prop rather than a second component on purpose — two renderers of one thing
 * drift, and the thing they would drift about is where a column is, which is the
 * one number this whole feature exists to have exactly one of.
 *
 * **Everything here is read out of the answer set** — see `lines.ts`. Nothing in
 * this file divides a width by a count or subtracts a margin from anything: the
 * lines come back as `lv(D,A)` from the same solve that placed the nodes, and
 * the bands are the space between two of them. So the line you see, the line a
 * drag catches on and the line a rule names are one number, and a document
 * nobody has solved yet draws nothing rather than drawing a guess.
 *
 * It returns a fragment rather than a container, because its coordinate plane is
 * its caller's: the editor's overlay and a read-only copy both position their
 * contents in canvas pixels from the document's own origin, and a wrapper would
 * either need to be a positioned box of the right size or would quietly become
 * one that was not.
 *
 * The unit crossing is the same one every other overlay makes: `RuledLine` is
 * EMU like everything `design-core` answers with, and every number that becomes
 * a `left` or a `width` goes through `viewport.ts`.
 */
import { memo, useMemo } from "react";
import {
	type RuledLine,
	type Scene,
	datumLabel,
	ruledTracks,
} from "@clingo-design/design-core";

import { cx } from "./cx";
import styles from "./Guides.module.css";
import { canvasPx, canvasRect } from "./viewport";

export interface GuidesProps {
	/** For the names: a line's title is what a rule about it would be called. */
	scene: Scene;
	/** Every line of the universe being drawn, from {@link ruledLines}. */
	lines: readonly RuledLine[];
	/**
	 * Lines the live gesture is caught on, so they can say so. Absent where
	 * nothing is being dragged, which is every copy but the editable one.
	 */
	held?: ReadonlySet<string>;
	/**
	 * Whether a hand-drawn line answers the pointer at all.
	 *
	 * The editor sets it under the select tool and nowhere else, for the reason a
	 * path's vertices only appear under it: with the rectangle tool in hand a
	 * press on a guide means "start a rectangle here", and a guide that swallowed
	 * it would be a hole in the canvas.
	 */
	editable?: boolean;
	/** Begin dragging one. Never offered for a line of the grid — see below. */
	onGrab?: (line: RuledLine, guide: string) => void;
	onLock?: (line: RuledLine, guide: string) => void;
	onRemove?: (line: RuledLine, guide: string) => void;
}

/**
 * Memoised because the editor above it re-renders on every pointermove, and a
 * grid changes only when the document or the answer set does — which is to say
 * never during the gesture that is redrawing everything else.
 */
export const Guides = memo(function Guides({
	scene,
	lines,
	held,
	editable,
	onGrab,
	onLock,
	onRemove,
}: GuidesProps) {
	/**
	 * The bands, which are what make a grid readable.
	 *
	 * A fence of identical lines cannot say which gaps are columns and which are
	 * gutters — twelve columns is twenty-three indistinguishable stripes — and
	 * that distinction is the first thing anybody wants from a grid. A single
	 * track is not shaded: one track is the live area rather than a division of
	 * it, the margin lines already draw exactly that rectangle, and shading it
	 * would put a wash over every page whose rows nobody set.
	 */
	const bands = useMemo(
		() => ruledTracks(lines).filter((track) => track.count > 1),
		[lines],
	);

	return (
		<>
			{bands.map((track) => {
				const box = canvasRect(track.area);
				return (
					<div
						key={`${track.surface}-${track.axis}-${track.index}`}
						className={styles.band}
						data-band={track.index}
						data-axis={track.axis}
						style={{
							left: box.x,
							top: box.y,
							width: box.width,
							height: box.height,
						}}
						// No tooltip, deliberately: a band covers the design, so it takes
						// no pointer events, and a `title` on something a pointer cannot
						// reach is an attribute that never shows. Which track it is lives
						// in the data attributes, where the thing that needs to know is
						// looking anyway. The lines are where a name is worth having, and
						// there it reaches a hand.
					/>
				);
			})}

			{/* Drawn whether or not any rule names them and whether or not anything
			    is being dragged, because that is what a grid is for — and drawn from
			    the same numbers a rule would hold something to, since both come out
			    of `lv(D,A)`.

			    Only the hand-drawn ones ever answer the pointer. Where a column line
			    falls is the answer to the margins, the gutter and the count, so
			    there is nothing there for a hand to take hold of: dragging one could
			    mean any of three edits and the arithmetic cannot say which. Change
			    the setting and every line follows. */}
			{lines.map((line) => {
				const at = canvasPx(line.at);
				const from = canvasPx(line.from);
				const span = canvasPx(line.to - line.from);
				// A line answers the pointer only if somebody drew it by hand, and
				// only where the caller said so. `guide` is that line's own id, and
				// `own` is the check that it is really there — the handlers below are
				// only ever built inside it.
				const own =
					editable === true && line.role === "guide" && line.guide !== undefined;
				const guide = line.guide as string;
				const grab = own && !line.locked;
				return (
					<div
						key={line.term}
						className={cx(
							styles.ruled,
							line.role === "guide" ? styles.drawnLine : styles[line.role],
							line.role === "guide" && line.locked && styles.lockedLine,
							own && styles.grabbable,
						)}
						data-line={line.term}
						data-role={line.role}
						data-axis={line.axis}
						data-locked={line.locked ? "" : undefined}
						data-active={held?.has(line.term) ? "" : undefined}
						title={
							own
								? line.locked
									? "Locked · double-click to unlock · alt-click to remove"
									: "Drag to move · double-click to lock · alt-click to remove"
								: datumLabel(scene, line.term)
						}
						style={
							line.axis === "x"
								? { left: at, top: from, height: span }
								: { top: at, left: from, width: span }
						}
						onPointerDown={
							own
								? (e) => {
										// A locked line takes no gesture and does not swallow one
										// either: the press carries on up to the editor and selects
										// whatever is behind it, which is the difference between
										// "do not move this" and "do not click here".
										if (!grab) return;
										e.stopPropagation();
										if (e.altKey) onRemove?.(line, guide);
										else onGrab?.(line, guide);
									}
								: undefined
						}
						onDoubleClick={
							own
								? (e) => {
										e.stopPropagation();
										onLock?.(line, guide);
									}
								: undefined
						}
					/>
				);
			})}
		</>
	);
});
