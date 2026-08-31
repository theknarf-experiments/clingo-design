import { useEffect, useRef, useState } from "react";

import {
	type Machine,
	machineLayers,
	stateName,
} from "@clingo-design/design-core";

import { cx } from "./cx";
import styles from "./LayerStrip.module.css";

/**
 * The layers of one machine, stacked, with what each one is currently showing.
 *
 * **Named `LayerStrip` and not `Layers`**, because `LayerList.tsx` is the
 * document's layer list — the tree of nodes on the canvas — and two panels
 * called Layers in one studio is a studio nobody can be directed around. The
 * word is overloaded in the domain and there is nothing to be done about that
 * except to keep the two names apart in the code.
 *
 * **The list is the priority, lowest first, and there is no priority field.**
 * The same "the order *is* the answer" that makes `states[0]` the initial state
 * and `order/2` the paint order: a layer's position in {@link Machine.layers} is
 * what `mlindex/3` numbers and what `mwriter/4` reads to decide which of two
 * layers gets to paint a property. Reordering is therefore not a cosmetic act on
 * a list — it is the control for who wins a fight — and the strip says so at the
 * row where the fight is reported.
 *
 * **What this strip is not.** It is not a second state strip. Each row names the
 * state that layer is in and offers to *look* at that layer, and everything that
 * can be done to a state — playing it, drawing it, renaming it, giving it a
 * delta — happens in the {@link StateStrip} below, for whichever layer is being
 * looked at. A strip that also expanded each layer's states would be the whole
 * panel drawn N times, and the thing a designer is actually editing is one
 * state's delta.
 *
 * **A machine with no layers still has one.** `machineLayers` mints `base` for a
 * machine whose document says nothing, so this renders one row rather than an
 * empty space — which is the truth about such a machine and is also where the
 * "+ Layer" button has to live for anybody to find it. Every document written
 * before layers existed reads as the one-layer machine it is.
 */
export interface LayerStripProps {
	machine: Machine;
	/** Layer id -> the state the subject is in. */
	shown: Readonly<Record<string, string>>;
	/** Layer id -> the state the canvas is playing, if any. */
	playing?: Readonly<Record<string, string>>;
	/** Layers the answer set says are fighting, so a row can be marked. */
	fighting?: ReadonlySet<string>;
	/**
	 * The layer whose states the panel below is showing.
	 *
	 * Not in `rive-ladder-spec.md` §10.3's list, and added because the strip is
	 * the only control that can say which layer is being looked at: the props
	 * that *are* in the list describe every layer at once, so without this the
	 * rows would be a read-out of something the designer cannot steer. Absent
	 * marks nothing, which is the honest picture for a caller that keeps no such
	 * selection.
	 */
	looking?: string;
	onLook?: (layer: string) => void;
	onAdd?: () => void;
	onRename?: (layer: string, name: string) => void;
	onDelete?: (layer: string) => void;
	onReorder?: (layer: string, to: number) => void;
}

/**
 * One layer's row.
 *
 * The name is an `<input>` for {@link StateStrip}'s reason: a layer is named
 * once, immediately after it is made, and a pencil icon would put a mode between
 * the person and the single gesture they came for. The draft-and-commit dance is
 * the same one, and it is here for the same case — `renameLayer` refuses a blank
 * name, so a controlled field would snap the old name back under the cursor the
 * moment somebody cleared it to retype.
 */
function Row({
	machine,
	layerId,
	name,
	index,
	total,
	state,
	played,
	fighting,
	looking,
	onLook,
	onRename,
	onDelete,
	onReorder,
}: {
	machine: Machine;
	layerId: string;
	name: string;
	index: number;
	total: number;
	/** The state this layer is showing, if the subject has one. */
	state: string | undefined;
	/** The state the canvas is playing in this layer, if any. */
	played: string | undefined;
	fighting: boolean;
	looking: boolean;
	onLook?: (layer: string) => void;
	onRename?: (layer: string, name: string) => void;
	onDelete?: (layer: string) => void;
	onReorder?: (layer: string, to: number) => void;
}) {
	const [draft, setDraft] = useState<string | null>(null);
	const shownName = draft ?? name;
	const committed = useRef(name);
	useEffect(() => {
		if (committed.current !== name) {
			committed.current = name;
			setDraft(null);
		}
	}, [name]);

	/**
	 * The state's *name* and not its id, because the row is a sentence about what
	 * is on screen. The id is in the title, where a person writing a cross-state
	 * rule can find it, exactly as the state chips do it.
	 */
	const label = state === undefined ? undefined : stateName(machine, state);
	const playedLabel = played === undefined ? undefined : stateName(machine, played);

	return (
		<div
			className={cx(
				styles.layer,
				looking && styles.looking,
				fighting && styles.fighting,
			)}
			data-role="machine-layer"
			data-layer={layerId}
			data-looking={looking ? "" : undefined}
		>
			{onReorder ? (
				<button
					type="button"
					className={styles.move}
					data-role="reorder-layer"
					disabled={index === 0}
					title="Move down the stack. The position is the priority — where two layers write the same property of the same part, the later one wins — so this is the control for that fight and not a tidying gesture."
					onClick={() => onReorder(layerId, index - 1)}
				>
					{/* An arrow and not a chevron, because the rows are stacked: the
					    strip is drawn top-of-stack-first, so "earlier in the list" and
					    "further down the page" are the same move and the glyph should
					    say which one the eye will see. */}
					↓
				</button>
			) : null}

			<button
				type="button"
				className={styles.pick}
				data-role="look-at-layer"
				aria-pressed={looking}
				disabled={onLook === undefined}
				title={`Show this layer's states below. The id \`${layerId}\`, which is what \`data-state-${layerId}\` switches on in the exported file.`}
				onClick={() => onLook?.(layerId)}
			>
				<span className={styles.rank}>{index + 1}</span>
			</button>

			{onRename ? (
				<input
					className={styles.name}
					data-role="layer-name"
					aria-label="Layer name"
					value={shownName}
					onChange={(e) => {
						setDraft(e.target.value);
						onRename(layerId, e.target.value);
					}}
					onBlur={() => setDraft(null)}
				/>
			) : (
				<span className={styles.label}>{name}</span>
			)}

			{/*
			 * What this layer is showing, which is the whole reason a strip exists
			 * rather than a `<select>`: two layers are two states **at once**, in one
			 * answer set, and the picture on the canvas is both of them composed. A
			 * control that showed one current layer would be describing a choice the
			 * document does not make.
			 */}
			<span className={styles.state} data-role="layer-state">
				{playedLabel !== undefined ? (
					<em title="The canvas is playing this state in this layer. The document still says something else.">
						{playedLabel}
					</em>
				) : (
					(label ?? "—")
				)}
			</span>

			{onDelete ? (
				<button
					type="button"
					className={styles.action}
					data-role="delete-layer"
					disabled={total <= 1}
					title={
						total <= 1
							? "The last layer stays. A machine with none is the un-layered machine every document started as, and that is what one layer already means."
							: "Delete this layer. Its states stay in the machine and fall back to the first layer, so nothing anybody authored is lost — but they will all be on screen at once until they are moved somewhere that makes sense."
					}
					onClick={() => onDelete(layerId)}
				>
					×
				</button>
			) : null}
		</div>
	);
}

export function LayerStrip({
	machine,
	shown,
	playing,
	fighting,
	looking,
	onLook,
	onAdd,
	onRename,
	onDelete,
	onReorder,
}: LayerStripProps) {
	const layers = machineLayers(machine);
	/**
	 * Whether the machine's layers are its own or the one `machineLayers` mints.
	 *
	 * Worth distinguishing in the copy but not in the controls: an un-layered
	 * machine is a one-layer machine in every rule that reads one, so the row is
	 * real, the rename is real (it writes the machine's first `MachineLayer` into
	 * a document that had none) and only the sentence underneath changes.
	 */
	const minted = (machine.layers ?? []).length === 0;

	return (
		<div className={styles.strip} data-role="machine-layers" data-machine={machine.id}>
			<div className={styles.head}>
				<span className={styles.title}>Layers</span>
				{onAdd ? (
					<button
						type="button"
						className={styles.add}
						data-role="add-layer"
						title="A second layer, on top. Its states are composed with the ones below rather than chosen between — a machine with a four-state layer and a three-state layer has seven states and still exactly as many designs as it had before, because a state was never a choice."
						onClick={onAdd}
					>
						+ Layer
					</button>
				) : null}
			</div>

			<div className={styles.rows}>
				{/*
				 * Top of the stack first, so the row that wins a fight is the row at
				 * the top — the same way the layer list draws the document's own
				 * stacking. The index shown is the document's, counting from one, so
				 * the number beside a row is the number `mlindex/3` carries and the
				 * one a violation sentence names.
				 */}
				{[...layers].reverse().map((layer) => {
					const index = layers.findIndex((l) => l.id === layer.id);
					return (
						<Row
							key={layer.id}
							machine={machine}
							layerId={layer.id}
							name={layer.name}
							index={index}
							total={layers.length}
							state={shown[layer.id]}
							played={playing?.[layer.id]}
							fighting={fighting?.has(layer.id) ?? false}
							looking={looking === layer.id}
							onLook={onLook}
							onRename={onRename}
							onDelete={onDelete}
							onReorder={onReorder}
						/>
					);
				})}
			</div>

			<p className={styles.note} data-role="layers-note">
				{minted
					? "One layer, which is what every machine has until somebody adds a second. Its states are the machine's states."
					: "Every layer is showing a state at once, and the picture is all of them composed. Later layers win where two of them write the same thing."}
			</p>
		</div>
	);
}
