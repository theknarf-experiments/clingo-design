import { useEffect, useRef, useState } from "react";

import {
	type Machine,
	initialState,
	stateName,
} from "@clingo-design/design-core";

import { cx } from "./cx";
import styles from "./StateStrip.module.css";

/**
 * The states of one machine, in a row, in the order that decides which is
 * initial.
 *
 * **A strip and not a graph**, and the choice is worth defending because every
 * other tool that has states draws a graph. A graph is the right picture for a
 * machine you are *reading* — it shows the cycles and the dead ends at a glance,
 * which is exactly what `machineHealth` already says in words — and a poor
 * surface for one you are *editing*, because what is being edited is a state's
 * delta, and a canvas of boxes and arrows has nowhere to put a fill row with a
 * token menu, a pin and a why button. So the states are a strip, the edges are a
 * list underneath it, and the delta gets the room.
 *
 * **The order is the only place the initial state is written down.** There is no
 * `initial` flag anywhere in the document — `initialState` is `states[0]` — so
 * this strip is not merely displaying the order, it is the control for it, and
 * the leftmost chip says "starts here" out loud rather than leaving somebody to
 * infer it from a position.
 *
 * **Two verbs, kept visibly apart.** *Playing* a state draws it on the canvas and
 * touches nothing: every state's `frame/3` and `rendered/3` are already in the
 * one answer set, so it costs no solve, no re-ground and nothing in undo.
 * *Showing* a state writes `SceneNode.state`, which is an edit — it changes what
 * the document says this instance is, and what the exported file starts as. They
 * are one click apart, so the strip labels them and never merges them into a
 * single "select".
 *
 * Read-only is the absence of the four editing callbacks rather than a flag,
 * which is what the inspector renders: the same component, showing and playing,
 * with no way to rename a state in two places.
 */
export interface StateStripProps {
	machine: Machine;
	/** The state the document draws the subject in. */
	shown: string;
	/** The state the canvas is playing, if any. */
	playing?: string;
	/** States the answer set says are reachable; absent greys nothing. */
	reachable?: ReadonlySet<string>;
	/** Play a state on the canvas. Null hands it back to the document. */
	onPlay?: (state: string | null) => void;
	/** Make a state the one the document draws. Absent where there is no subject. */
	onShow?: (state: string) => void;
	/** Editing, absent in the read-only strip the inspector shows. */
	onAdd?: () => void;
	onRename?: (state: string, name: string) => void;
	onDelete?: (state: string) => void;
	onReorder?: (state: string, to: number) => void;
}

/**
 * One chip: a state's name, what is true of it, and what can be done to it.
 *
 * The name is an `<input>` sized to its own content rather than a label with a
 * pencil beside it. A state gets renamed roughly once, right after it is made,
 * and a pencil would put a mode between the person and the one gesture they came
 * for — which is `renameNode`'s judgement in the layer list, applied to a
 * shorter word.
 *
 * What it deliberately does not show is the state's **id**. It is the term in
 * `stt(I,S,N)`, in every `sprop` key a pin is recorded under, and in the
 * `data-state` an exported page switches on — but it is not editable (renaming
 * writes the name and never the id, because an exported page and the document
 * that made it would otherwise stop agreeing silently), so putting it on the chip
 * would be showing somebody a word they cannot change and do not need. It is in
 * the title attribute, where somebody writing a cross-state rule can find it.
 */
function Chip({
	machine,
	stateId,
	index,
	initial,
	drawn,
	played,
	unreachable,
	onPlay,
	onShow,
	onRename,
	onDelete,
	onReorder,
}: {
	machine: Machine;
	stateId: string;
	index: number;
	initial: boolean;
	drawn: boolean;
	played: boolean;
	unreachable: boolean;
	onPlay?: (state: string | null) => void;
	onShow?: (state: string) => void;
	onRename?: (state: string, name: string) => void;
	onDelete?: (state: string) => void;
	onReorder?: (state: string, to: number) => void;
}) {
	const name = stateName(machine, stateId);
	/**
	 * The typed text, held here and committed on every keystroke.
	 *
	 * A draft rather than a controlled value straight off the document, for the
	 * one case that would otherwise be unusable: `renameState` refuses a blank
	 * name — a state with no name reads as nothing at all in a strip — so clearing
	 * the field to retype it would snap the old name back under the cursor. The
	 * draft lets the field be empty while the document keeps the last real name,
	 * which is `renameConstraint`'s arrangement in the Rules panel.
	 */
	const [draft, setDraft] = useState<string | null>(null);
	const shownName = draft ?? name;
	// A rename from somewhere else — an undo, another editor — has to reach a
	// field nobody is typing in. Dropping the draft on a document change would
	// fight the person typing; keeping it forever would show them a stale name.
	const committed = useRef(name);
	useEffect(() => {
		if (committed.current !== name) {
			committed.current = name;
			setDraft(null);
		}
	}, [name]);

	return (
		<div
			className={cx(
				styles.chip,
				played && styles.played,
				drawn && styles.drawn,
				unreachable && styles.unreachable,
			)}
			data-role="state"
			data-state={stateId}
			data-initial={initial ? "" : undefined}
			title={
				`${name} — the id \`${stateId}\`, which is what a cross-state rule names ` +
				`(stt(…,${stateId},…)) and what the exported file switches on.` +
				(initial ? " First in the list, so this is where the machine starts." : "") +
				(unreachable ? " No chain of transitions reaches it from the start." : "")
			}
		>
			{onReorder ? (
				<button
					type="button"
					className={styles.move}
					data-role="reorder-state"
					disabled={index === 0}
					title="Move earlier. Moving a state to the front is how a machine changes where it starts — there is no separate flag to set, so there is nothing that can disagree with the order."
					onClick={() => onReorder(stateId, index - 1)}
				>
					‹
				</button>
			) : null}

			{onRename ? (
				<input
					className={styles.name}
					data-role="state-name"
					aria-label="State name"
					size={Math.max(4, shownName.length)}
					value={shownName}
					onChange={(e) => {
						setDraft(e.target.value);
						onRename(stateId, e.target.value);
					}}
					onBlur={() => setDraft(null)}
				/>
			) : (
				<span className={styles.label}>{name}</span>
			)}

			{initial ? (
				<span className={styles.initial} title="The machine starts here.">
					start
				</span>
			) : null}

			{onPlay ? (
				<button
					type="button"
					className={cx(styles.action, played && styles.on)}
					data-role="play-state"
					aria-pressed={played}
					// The state the document already draws is not a state to play, and
					// the button says so rather than being a no-op that lights up.
					// `inst(I,N)` *is* the shown copy — the alias in the program and its
					// other half in `readModel` — so pressing this would swap the canvas
					// for a picture identical to the one it already shows, and ■ would
					// swap it back. A control whose two positions look the same is a
					// control that teaches the wrong thing about what playing does.
					disabled={drawn}
					title={
						drawn
							? "This is the state the canvas is already drawing: the picture is this state. Play one of the others, or use ◉ to change which state the document draws."
							: played
								? "Stop playing this state and draw what the document says again."
								: "Draw this state on the canvas. It costs no solve — every state is already in this answer set — and nothing about the document changes."
					}
					onClick={() => onPlay(played ? null : stateId)}
				>
					{played ? "■" : "▶"}
				</button>
			) : null}

			{onShow ? (
				<button
					type="button"
					className={cx(styles.action, drawn && styles.on)}
					data-role="show-state"
					aria-pressed={drawn}
					disabled={drawn}
					title="Make this the state the document draws this use in, and the state the exported file starts in. Unlike playing, this is an edit."
					onClick={() => onShow(stateId)}
				>
					◉
				</button>
			) : null}

			{onDelete ? (
				<button
					type="button"
					className={styles.action}
					data-role="delete-state"
					title={
						machine.states.length <= 1
							? "The last state stays: a machine with none has nothing to draw an instance in. Delete the machine instead."
							: "Delete this state, and every transition with an end in it."
					}
					disabled={machine.states.length <= 1}
					onClick={() => onDelete(stateId)}
				>
					×
				</button>
			) : null}
		</div>
	);
}

export function StateStrip({
	machine,
	shown,
	playing,
	reachable,
	onPlay,
	onShow,
	onAdd,
	onRename,
	onDelete,
	onReorder,
}: StateStripProps) {
	const first = initialState(machine);

	return (
		<div className={styles.strip} data-role="states" data-machine={machine.id}>
			<div className={styles.row}>
				{machine.states.map((state, index) => (
					<Chip
						key={state.id}
						machine={machine}
						stateId={state.id}
						index={index}
						initial={state.id === first?.id}
						drawn={state.id === shown}
						played={state.id === playing}
						// Absent greys nothing: with no answer in hand — an unsolved
						// document, or an unsatisfiable one — every state is as reachable
						// as the panel knows how to say.
						unreachable={reachable !== undefined && !reachable.has(state.id)}
						onPlay={onPlay}
						onShow={onShow && state.id !== shown ? onShow : undefined}
						onRename={onRename}
						onDelete={onDelete}
						onReorder={onReorder}
					/>
				))}

				{onAdd ? (
					<button
						type="button"
						className={styles.add}
						data-role="add-state"
						title="A state with an empty delta: the same picture as the one before it, costing no state copy at all, until you change one field of it."
						onClick={onAdd}
					>
						+ State
					</button>
				) : null}
			</div>

			{playing !== undefined ? (
				<p className={styles.note} data-role="playing-note">
					Playing <strong>{stateName(machine, playing)}</strong> on the canvas. The
					document still says {stateName(machine, shown)}; nothing here is an edit.
				</p>
			) : null}
		</div>
	);
}
