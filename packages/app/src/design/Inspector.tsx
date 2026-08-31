import { useState } from "react";
import {
	CHILD_PROPS,
	CSS_UNITS,
	MAX_TALLY,
	tallyOf,
	type DerivedNode,
	CONTAINER_PROPS,
	DIMENSIONS,
	type Dimension,
	FRAME_DIMS,
	GUIDE_PROPS,
	GUIDE_PROP_NAMES,
	type GuideProp,
	UNITS,
	type Unit,
	formatLength,
	setUnit,
	LAYOUT_PROPS,
	type LayoutProp,
	type Sizing,
	KINDS,
	PROPS,
	type ModelAlternative,
	type ModelNode,
	type Picks,
	type PropName,
	type Scene,
	type SceneNode,
	type Term,
	type Token,
	type Value,
	type ValueType,
	VALUE_TYPES,
	writeAngle,
	type Freedom,
	defaultValue,
	findInTree,
	flatten,
	frameFrozen,
	frameVar,
	guideValueOf,
	guideVar,
	isGridded,
	isPinned,
	isMeasured,
	lit,
	layoutValueOf,
	layoutVar,
	layoutWord,
	makeGuides,
	makeLayout,
	managedNodes,
	nodeNames,
	parentOf,
	propValues,
	setChildLayout,
	setGuideValue,
	setGuides,
	setLayout,
	setSizing,
	single,
	sizingOf,
	tokensOfType,
	updateLayout,
	propVar,
	renameNode,
	resolveValue,
	setFrameValue,
	setProp,
	tokensFor,
	varies,
	type ComponentDef,
	type ComponentVar,
	addInstance,
	definitionOf,
	isFullyHeld,
	instanceVariable,
	openVariables,
	releaseComponent,
	setHold,
	setVariant,
	shownVariant,
	termLabel,
	varLabel,
	variantsOf,
	type Style,
	styleOf,
	styleProps,
	styleVar,
	variantLabel,
	wearStyle,
	wornProps,
	type Machine,
	type MachineState,
	type StatePart,
	activeTerm,
	clearStatePart,
	componentDef,
	componentDefs,
	findState,
	instanceNodes,
	isInstance,
	isLengthType,
	machineForNode,
	machineForRoot,
	machineHealth,
	setNodeState,
	setStateFrame,
	setStateHidden,
	setStateProp,
	shownState,
	stateName,
	stateTouches,
	type Spatial,
	type Turn,
	SPATIALS,
	SPATIAL_DIMS,
	TURNS,
	TURN_NAMES,
	addCamera,
	addLight,
	addMesh,
	boxOf,
	camerasIn,
	cameraOf,
	clearSpatial,
	clearTurn,
	constraintMemberNode,
	inertConstraints,
	isSpatialNode,
	rotateVar,
	setSpatialValue,
	setStateTurn,
	setTurnValue,
	setViewportCamera,
	spatialFrozen,
	turnOf,
} from "@clingo-design/design-core";

import { NOTHING } from "./Styles";
import { StateStrip } from "./StateStrip";
import { LengthInput, ValueEditor, type WhyRow } from "./ValueEditor";
import { cx } from "./cx";
import {
	MARGIN_FIELDS,
	TRACK_FIELDS,
	guideFieldLabel,
} from "./guideFields";
import { documentUnit, shownEmu, shownLength } from "./lengths";
import styles from "./Inspector.module.css";

export interface InspectorProps {
	scene: Scene;
	selection: ReadonlySet<string>;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/** Picks of the universe on screen, so rows can show what is active. */
	picks: Picks;
	/** Variable keys the solver reports as unsettled. */
	varying: ReadonlySet<string>;
	/** Geometry the solver decided, so the fields it owns can say so. */
	solved?: Readonly<Record<string, { width?: number; height?: number }>>;
	/** Per variable, the alternatives that occur in at least one legal design. */
	reach?: Readonly<Record<string, Set<number>>>;
	/**
	 * The continuous half of the same idea: which of the selection's
	 * coordinates the rules have left a choice about.
	 */
	freedom?: Freedom;
	/** Alternatives the user has fixed, by variable. */
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	/**
	 * The why-probe, per variable.
	 *
	 * A function rather than a table because a row asks for its own key and
	 * there is at most one question outstanding in the whole panel: building a
	 * map would be building a map of one entry and 40 undefineds.
	 */
	why?: (variable: string) => WhyRow | undefined;
	/** Nodes the answer set has that the document does not — see `derived.ts`. */
	derived?: readonly DerivedNode[];
	/** Derived ids some universe has, whether or not the one on screen does. */
	known?: ReadonlySet<string>;
	/** Derived ids every universe has. */
	everywhere?: ReadonlySet<string>;
	/**
	 * Variables a rule minted, by key — see `ModelScene.variables`.
	 *
	 * The document cannot say what these hold, so a derived node's property row
	 * has to read its alternatives out of the answer set instead.
	 */
	variables?: Readonly<Record<string, readonly ModelAlternative[]>>;
	/**
	 * Move the selection. Only the component section uses it: an instance names
	 * its definition, and a name you cannot follow is a name you have to hunt
	 * for in the layer tree.
	 */
	onSelectionChange?: (ids: string[]) => void;
	/**
	 * Instance node id -> the state the canvas is drawing.
	 *
	 * Editor state, not document state, and the difference is the whole reason it
	 * is a prop rather than a field: `SceneNode.state` is a *fact the compiler
	 * emits* and changing it re-grounds, while playing a state is a read of atoms
	 * the answer set already holds — every state of every instance is in it at
	 * once. So watching a transition costs no solve, and the panel keeps the two
	 * questions in two different places: this one is temporary, the row below it
	 * is an edit.
	 */
	playing?: Readonly<Record<string, string>>;
	onPlay?: (instance: string, state: string | null) => void;
}

const SIZINGS: Sizing[] = ["hug", "fixed"];

/**
 * The appearance rows the frozen DOM contract addresses by a `data-role` of
 * their own — see {@link Inspector}'s `appearanceRow`.
 *
 * A partial table rather than a role per property, because the other nineteen
 * are already addressable by `data-prop` and giving them roles now would be
 * inventing a contract nobody is coding against. These two are named in
 * `docs/three-d-spec.md` §14, so they are the two that exist.
 */
const PROP_ROLES: Partial<Record<PropName, string>> = {
	solid: "solid-picker",
	lamp: "lamp-picker",
};

/**
 * How many tracks an axis is cut into.
 *
 * A spinner, where every length field in this panel deliberately is not, and the
 * difference is the whole reason `count` is its own value type: a count has no
 * unit to spell, so there is nothing for `type="number"` to make untypable, and
 * stepping it is the gesture somebody actually wants — "one more column" is an
 * edit, "13" is a thing you have to work out first.
 *
 * It commits only what {@link tallyOf} reads, which is the same reader the
 * compiler puts through `tally/2`. A fraction or a negative is not a strange
 * grid, it is a `1..N` the grounder cannot ground, and `MAX_TALLY` is the
 * ceiling that says so out loud.
 */
function CountField({
	label,
	value,
	onCommit,
	onSplit,
}: {
	label: string;
	/** The stored literal, which for a count is the number as written. */
	value: string;
	onCommit: (text: string) => void;
	/** Give this count a second alternative — a responsive grid, in one click. */
	onSplit?: () => void;
}) {
	// A draft while the box is being typed into, for the reason `LengthInput`
	// keeps one: a field that canonicalises under the caret is a field you cannot
	// clear in order to type a different number.
	const [draft, setDraft] = useState<string | null>(null);
	return (
		<label className={styles.field}>
			<span className={styles.fieldLabel}>{label}</span>
			<input
				className={styles.number}
				type="number"
				min={1}
				max={MAX_TALLY}
				step={1}
				data-field={label}
				value={draft ?? value}
				onChange={(e) => {
					const text = e.target.value;
					setDraft(text);
					const read = tallyOf(text.trim());
					// Zero tracks is not an empty grid, it is an equation with no
					// solution — the width of a track is divided by this — so the
					// floor is one, which is what `guideCount` clamps to as well.
					if (read !== undefined && read >= 1) onCommit(String(read));
				}}
				onBlur={() => setDraft(null)}
			/>
			{onSplit ? (
				<button
					type="button"
					className={styles.split}
					data-role={`split-${label}`}
					title="Give this a second value, so the design branches here"
					onClick={(e) => {
						e.preventDefault();
						onSplit();
					}}
				>
					+
				</button>
			) : null}
		</label>
	);
}

/**
 * One coordinate of a frame.
 *
 * It takes the stored literal rather than the number the canvas drew with, and
 * the difference is the point: for a coordinate this field can edit the two are
 * the same value, but the literal is the one that still says which unit it was
 * written in. A field that took the number would have to guess.
 *
 * Not `type="number"` any more, and it cannot be: a spinner will not hold
 * `210mm`. What is lost with it is the arrow keys, which is a real loss and the
 * canvas is where nudging belongs anyway.
 */
function LengthField({
	label,
	role,
	value,
	unit,
	onCommit,
	onSplit,
	onClear,
	disabled,
	pinned,
	title,
}: {
	label: string;
	/**
	 * `data-role` on the input, for the fields the frozen DOM contract names by
	 * one — `spatial-z`, `spatial-depth`. The planar four are addressed by
	 * `data-field` and pass nothing, which is not an inconsistency: `x` is a
	 * `data-field` on a hundred documents' worth of existing queries and the
	 * third axis has no such history to keep.
	 */
	role?: string;
	/** The stored literal for this dimension. */
	value: string;
	unit: Unit;
	/** The new stored literal — see `LengthInput`. */
	onCommit: (text: string) => void;
	/**
	 * Give this dimension a second alternative — the one gesture that turns a
	 * position into a design decision. Absent where there is nothing to split.
	 */
	onSplit?: () => void;
	/**
	 * Take the dimension out of the document entirely — offered only where
	 * absence is a *different statement* from zero, which on the planar four it
	 * never is and on the third axis always is. A frame has four dimensions
	 * whatever anybody does, so there is nothing there to clear; `spatial` is
	 * sparse, and a node holding `z: 0` states that it is in the third axis while
	 * a node holding nothing states that it is not. See `clearSpatial`.
	 */
	onClear?: () => void;
	disabled?: boolean;
	/** The rules leave this coordinate one legal value; there is no choice. */
	pinned?: boolean;
	title?: string;
}) {
	return (
		<label
			className={pinned ? `${styles.field} ${styles.pinned}` : styles.field}
			data-pinned={pinned ? "" : undefined}
			title={pinned ? "The rules leave this one value" : title}
		>
			<span className={styles.fieldLabel}>{label}</span>
			<LengthInput
				className={styles.number}
				role={role}
				field={label}
				value={value}
				unit={unit}
				disabled={disabled}
				onCommit={onCommit}
			/>
			{onSplit ? (
				<button
					type="button"
					className={styles.split}
					data-role={`split-${label}`}
					title="Give this a second value, so the design branches here"
					onClick={(e) => {
						e.preventDefault();
						onSplit();
					}}
				>
					+
				</button>
			) : null}
			{onClear ? (
				<button
					type="button"
					className={styles.split}
					data-role={`clear-${label}`}
					title={`Say nothing about ${label} at all, which is not the same as saying zero`}
					onClick={(e) => {
						e.preventDefault();
						onClear();
					}}
				>
					×
				</button>
			) : null}
		</label>
	);
}

/**
 * What this document is measured in.
 *
 * A document-wide setting in a panel that is otherwise about one selection, and
 * it sits in the position grid because that is where its effect is: the four
 * fields beside it are the ones a person reads a unit off, and a menu two panels
 * away would be a menu nobody connects to the numbers it changed.
 *
 * It changes no value in the document. A stored `"24px"` is 228600 EMU in a
 * millimetre document exactly as it is in a pixel one — it simply reads as
 * `6.35mm`, and keeps saying `"24px"` until somebody types over it. That is the
 * line the whole unit design draws: what a length *is* is settled, and a unit is
 * how it is spelled and read.
 *
 * `CSS_UNITS` rather than every row of the table, because `emu` is the writer's
 * escape for a value no CSS unit spells and not a unit anybody works in.
 */
function UnitField({
	unit,
	onChange,
}: {
	unit: Unit;
	onChange: (next: Unit) => void;
}) {
	return (
		<label
			className={styles.field}
			title="What this document is measured in. Every length here is read out in it, and a number typed with no unit means it — stored values keep the unit they were written in until they are edited."
		>
			<span className={styles.fieldLabel}>units</span>
			<select
				className={styles.number}
				data-role="document-unit"
				value={unit}
				onChange={(e) => onChange(e.target.value as Unit)}
			>
				{CSS_UNITS.map((u) => (
					<option key={u} value={u}>
						{UNITS[u].label}
					</option>
				))}
			</select>
		</label>
	);
}

/**
 * What a node a rule derived amounts to — and, where the rule left it a choice,
 * what that choice is.
 *
 * The analogy that makes this bearable is a spreadsheet: a typed cell and a
 * formula cell sit side by side and behave completely differently, and the
 * whole of what keeps that usable is that you can always tell which is which.
 * So this panel looks like the inspector and is inert everywhere the inspector
 * edits the document: the name is the ASP term and the geometry is what the
 * answer set said.
 *
 * It is *not* inert about the answer, though, and that is the distinction worth
 * keeping. A rule that writes `alt(prop(cell(R,C),text),D) :- digit(D)` has
 * created a variable, and a variable's alternatives can be greyed where no
 * design uses them and pinned to ask for the designs that do — neither of which
 * is an edit to the document. So a derived property with a choice behind it gets
 * the same row a document property gets, with the halves that would write back
 * to a document taken away.
 *
 * Writing an edit back into the rule that produced the node is a research
 * problem and is deliberately not attempted. The rule is the place to change
 * it, and the Rules panel is where the rule is.
 */
function DerivedPanel({
	id,
	node,
	parent,
	everywhere,
	variables,
	picks,
	reach,
	pins,
	onPin,
	unit,
	why,
}: {
	id: string;
	/** Absent when the universe on screen does not have this node. */
	node: ModelNode | undefined;
	parent: string | null;
	everywhere: boolean;
	/** The document's unit: the answer set is in EMU like everything else. */
	unit: Unit;
	/** Variables a rule minted, by key — see `ModelScene.variables`. */
	variables: Readonly<Record<string, readonly ModelAlternative[]>>;
	picks: Picks;
	reach?: Readonly<Record<string, Set<number>>>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	why?: (variable: string) => WhyRow | undefined;
}) {
	/**
	 * One property of a derived node, as a row.
	 *
	 * A choice the rule left open is the interesting case and gets the ordinary
	 * property row; anything the rule simply stated has one value and is reported
	 * as the text it drew with.
	 */
	function propRow(prop: PropName, drawn: string) {
		const variable = propVar(id, prop);
		const alternatives = variables[variable];
		if (!alternatives || alternatives.length === 0) {
			return (
				<div key={prop} className={styles.resolved} data-resolved={prop}>
					<span className={styles.fieldLabel}>{PROPS[prop].label}</span>
					<span className={styles.resolvedValue}>{drawn}</span>
				</div>
			);
		}
		const spec = PROPS[prop];
		const reachable = reach?.[variable];
		return (
			<ValueEditor
				key={prop}
				testId={prop}
				label={spec.label}
				type={spec.type}
				value={alternatives.map((alt) => lit(alt.text))}
				indices={alternatives.map((alt) => alt.index)}
				readOnly
				// Nothing to link to and nothing to write back: the rule decides.
				tokens={[]}
				unit={unit}
				fallback={spec.fallback}
				active={picks[variable]}
				varying={(reachable?.size ?? alternatives.length) > 1}
				reachable={reachable}
				pinned={pins[variable]}
				onPin={(index) => onPin(variable, index)}
				why={why?.(variable)}
				preview={(term: Term) => (term.kind === "literal" ? term.value : undefined)}
				onChange={() => {}}
			/>
		);
	}

	return (
		<div className={styles.inspector} data-role="inspector" data-derived={id}>
			<div className={styles.derivedName} data-role="node-name">
				{id}
			</div>
			<p className={styles.note} data-role="derived-note">
				Derived by a rule. The document does not hold this node, so there is
				nothing here to drag, rename or type into — change the rule that
				produces it in the Rules panel.
			</p>

			{node === undefined ? (
				<p className={styles.empty} data-role="derived-absent">
					Not in the design on screen. Another one has it.
				</p>
			) : (
				<>
					{everywhere ? null : (
						<p className={styles.note} data-role="derived-sometimes">
							Present in some designs and not others.
						</p>
					)}
					<h3>Position</h3>
					<p className={styles.note}>
						{parent === null
							? "On the canvas, from the answer set."
							: `Inside ${parent}, from the answer set.`}
					</p>
					<div className={styles.grid}>
						{DIMENSIONS.map((axis) => (
							<label
								key={axis}
								className={`${styles.field} ${styles.pinned}`}
								data-pinned=""
							>
								<span className={styles.fieldLabel}>{axis}</span>
								{/* What the answer set said, read out in the document's unit.
								    A derived frame is EMU like every other frame, and it is
								    the solver's number rather than a stored literal — so this
								    is the one geometry field with nothing to preserve the
								    spelling of. */}
								<input
									className={styles.number}
									data-field={axis}
									value={shownEmu(node.frame[axis], unit)}
									disabled
									readOnly
								/>
							</label>
						))}
					</div>

					<h3>Kind</h3>
					<p className={styles.note} data-role="derived-kind">
						{KINDS[node.kind].label}
					</p>

					{Object.keys(node.rendered).length > 0 ? <h3>Appearance</h3> : null}
					<div className={styles.props}>
						{KINDS[node.kind].props.map((prop) => {
							const value = node.rendered[prop];
							return value === undefined ? null : propRow(prop, value);
						})}
					</div>
				</>
			)}
		</div>
	);
}

/**
 * A strip of the definition's variants.
 *
 * This is the whole of "see the variants", and it is a strip rather than a
 * table because that is what the variants *are*: the points of the definition's
 * own space, one per combination of the choices it left open. Nothing declared
 * them; they are counted off the alternatives.
 *
 * `shown` is the one the universe on screen is drawing and `chosen` the one the
 * instance has held, and they are different questions: an instance that has
 * held nothing is still showing something.
 */
function VariantStrip({
	def,
	variants,
	truncated,
	shown,
	chosen,
	onChoose,
}: {
	def: ComponentDef;
	variants: ReturnType<typeof variantsOf>["variants"];
	truncated: boolean;
	shown: number;
	/** Set only on an instance that has made up its mind. */
	chosen?: number;
	/** Absent on the definition itself, which has nothing to choose. */
	onChoose?: (at: number) => void;
}) {
	if (variants.length === 0) {
		return (
			<p className={styles.note} data-role="no-variants">
				{def.name} has one variant: nothing in it holds more than one value
				yet. Give a property a second value and it becomes a space.
			</p>
		);
	}
	return (
		<>
			<div className={styles.variants} data-role="variants">
				{variants.map((variant, at) => (
					<button
						key={variant.label}
						type="button"
						data-variant={at}
						data-shown={at === shown ? "" : undefined}
						data-chosen={at === chosen ? "" : undefined}
						aria-pressed={at === chosen}
						disabled={!onChoose}
						className={cx(
							styles.variant,
							at === shown && styles.variantShown,
							at === chosen && styles.variantChosen,
						)}
						title={
							onChoose
								? `Hold this instance at "${variant.label}"`
								: `Variant ${at + 1} of ${variants.length}`
						}
						onClick={() => onChoose?.(at)}
					>
						{variant.label}
					</button>
				))}
			</div>
			{truncated ? (
				<p className={styles.note}>
					More variants than fit here — the first {variants.length} are shown.
				</p>
			) : null}
		</>
	);
}

/**
 * What a component is, said in the inspector.
 *
 * Two selections land here and they are opposite sides of one idea. A
 * *definition* is a design space: the panel counts its variants and offers to
 * place a use of it. An *instance* is a point in that space: the panel says
 * which definition, which variant it is showing, and lets each open choice be
 * held or handed back.
 *
 * An override is a held pick — see `heldPicks` — so the row below is not a
 * value editor. There is nothing to type: the alternatives are the definition's
 * and the only thing an instance decides is which one.
 */
function ComponentSection({
	scene,
	node,
	picks,
	reach,
	onSceneChange,
	onSelect,
}: {
	scene: Scene;
	node: SceneNode;
	picks: Picks;
	reach?: Readonly<Record<string, Set<number>>>;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	onSelect?: (ids: string[]) => void;
}) {
	const isInstance = node.instanceOf !== undefined;
	const real = isInstance
		? definitionOf(scene, node)
		: node.component
			? { root: node, name: node.name, parts: flatten([node]) }
			: undefined;

	if (isInstance && !real) {
		return (
			<div data-role="component-section">
				<h3>Component</h3>
				<p className={styles.note} data-role="orphan-instance">
					An instance of “{node.instanceOf}”, which is no longer a component
					definition. Nothing is derived inside it. Mark that subtree as a
					component again and this comes back.
				</p>
			</div>
		);
	}
	if (!real) return null;

	const { variants, truncated } = variantsOf(scene, real);
	const open = openVariables(real);
	const shown = shownVariant(variants, real, node.id, picks);
	/**
	 * The variant this node has made up its mind about, if it has.
	 *
	 * Asked of a definition as well as an instance, because a definition holds
	 * its own variables in exactly the way an instance holds its copies of them
	 * — see `SceneNode.holds`. Without it, pressing Keep on a universe writes a
	 * decision onto the definition that nothing in the panel could see or undo,
	 * while greying every alternative it did not take.
	 */
	const chosen = variants.findIndex((v) =>
		open.every((o) => node.holds?.[o.variable] === v.picks[o.variable]),
	);
	/** Definition space is document space for a definition's own parts. */
	const liveVar = (v: ComponentVar) =>
		isInstance ? instanceVariable(node.id, v.node.id, v.prop) : v.variable;
	const names = nodeNames(scene.nodes);
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };

	return (
		<div data-role="component-section">
			<h3>Component</h3>
			{isInstance ? (
				<p className={styles.note} data-role="instance-of">
					An instance of{" "}
					<button
						type="button"
						className={styles.jump}
						data-role="goto-definition"
						title="Select the definition"
						onClick={() => onSelect?.([real.root.id])}
					>
						{real.name}
					</button>
					. Everything inside is derived from it, so editing the definition
					changes this too.
				</p>
			) : (
				<p className={styles.note} data-role="definition-note">
					A definition: this subtree is a design space rather than one design.
					Every instance is a point in it, free wherever a property here holds
					more than one value — and so is the definition itself, which may be
					held to one of them like any of its uses.
				</p>
			)}

			<VariantStrip
				def={real}
				variants={variants}
				truncated={truncated}
				shown={shown}
				chosen={chosen >= 0 ? chosen : undefined}
				onChoose={(at) =>
					onSceneChange((prev) => setVariant(prev, node.id, variants[at].picks))
				}
			/>

			{node.holds ? (
				<button
					type="button"
					className={styles.follow}
					data-role="release-holds"
					title="Hand every choice back to the solver"
					onClick={() => onSceneChange((prev) => setVariant(prev, node.id, null))}
				>
					{isFullyHeld(real, node)
						? "Let the solver choose"
						: "Release every choice"}
				</button>
			) : null}

			{open.length > 0 ? (
				<h3>{isInstance ? "Overrides" : "Held here"}</h3>
			) : null}
			{open.map((v) => {
				const variable = liveVar(v);
				const held = node.holds?.[v.variable];
				const live = picks[variable];
				const reachable = reach?.[variable];
				return (
					<div key={v.variable} className={styles.override} data-override={v.variable}>
						<span className={styles.fieldLabel}>{varLabel(v)}</span>
						<div className={styles.variants}>
							{v.value.map((term, at) => {
								const dead =
									reachable !== undefined && !reachable.has(at);
								return (
									<button
										key={at}
										type="button"
										data-alt={at}
										data-held={at === held ? "" : undefined}
										data-active={at === live ? "" : undefined}
										data-impossible={dead ? "" : undefined}
										aria-pressed={at === held}
										className={cx(
											styles.variant,
											at === live && styles.variantShown,
											at === held && styles.variantChosen,
											dead && styles.variantDead,
										)}
										title={
											at === held
												? "Hand this choice back to the solver"
												: isInstance
													? "Hold this instance at this value"
													: "Hold the definition itself at this value"
										}
										onClick={() =>
											onSceneChange((prev) =>
												setHold(prev, node.id, v.variable, at === held ? null : at),
											)
										}
									>
										{resolveValue(context, [term], v.variable) &&
										PROPS[v.prop].type === "color" ? (
											<span
												className={styles.chip}
												style={{
													background: resolveValue(context, [term], v.variable),
												}}
												aria-hidden="true"
											/>
										) : null}
										{termLabel(scene.tokens, term, names)}
									</button>
								);
							})}
						</div>
					</div>
				);
			})}

			{isInstance ? null : (
				<div className={styles.defActions}>
					<button
						type="button"
						className={styles.follow}
						data-role="place-instance"
						onClick={() => {
							let created: string | null = null;
							onSceneChange((prev) => {
								const result = addInstance(prev, real.root.id, picks);
								created = result.id;
								return result.scene;
							});
							if (created) onSelect?.([created]);
						}}
					>
						Place an instance
					</button>
					<button
						type="button"
						className={styles.follow}
						data-role="release-component"
						title="Stop treating this subtree as a definition. Its instances keep the name and come back if it is marked again."
						onClick={() =>
							onSceneChange((prev) => releaseComponent(prev, real.root.id))
						}
					>
						Not a component
					</button>
				</div>
			)}
		</div>
	);
}

/**
 * The machine a *definition part* is authored against, with the definition it
 * belongs to.
 *
 * `machineForNode` deliberately refuses this question — see its comment: it
 * answers for an instance and for a definition root and stops there, because a
 * lookup that walked ancestors would make a click on a label inside a component
 * silently switch which machine a panel was showing. That argument is about the
 * *lookup* being blunt, not about the question being illegitimate, and here the
 * question is exactly the one being asked: this panel's subject is a part, the
 * delta a state holds is keyed by that part's id, and the only machine that can
 * hold such a key is the one driving a definition the part is inside.
 *
 * Innermost first, and the first one with a machine wins. A definition nested
 * inside another is the case that decides the order: an Icon inside a Button
 * is a part of the Button as well as a definition of its own, so selecting the
 * icon's root while the Button has a machine and the Icon has none must offer
 * the Button's states — the Button's hover is entitled to move it — rather than
 * saying there is nothing here. Where both have machines the inner one wins,
 * because that is the definition the selection is most immediately part of.
 */
function machineForPart(
	scene: Scene,
	node: SceneNode,
): { machine: Machine; def: ComponentDef } | undefined {
	const holding = componentDefs(scene).filter((d) =>
		d.parts.some((p) => p.id === node.id),
	);
	for (let at = holding.length - 1; at >= 0; at--) {
		const machine = machineForRoot(scene, holding[at].root.id);
		if (machine) return { machine, def: holding[at] };
	}
	return undefined;
}

/* ------------------------------------------------------------------ */
/* What a rotation costs a rule                                        */
/* ------------------------------------------------------------------ */

/**
 * Every enabled rule that names this node and has been left saying nothing.
 *
 * **This used to be a stand-in and is no longer one**, and the difference is
 * worth a paragraph because the stand-in was right to announce itself. It
 * re-derived `gnoedge/2` here, in a panel, against a program it could not see:
 * two readers of one refusal, one of them checked by nothing, free to drift the
 * day somebody added a rule to `SPATIAL_RULES`. `spatial.ts` now owns the real
 * pair — `refusedEdge` is the twin of `gnoedge/2` and `inertConstraints` walks
 * the document with it — so what is left here is a filter and a shape, which is
 * all a panel ever had any business holding.
 *
 * **Every member, not only the selection**, which is the case a designer
 * actually meets and the reason this block exists at all: `align [card, panel]
 * on left` where *panel* is the turned one leaves `card` exactly as free as it
 * was, so the thing that does not move is the thing nobody touched. A reader
 * that only asked whether the selected node was turned would be silent in
 * precisely that situation.
 *
 * The universe matters and is why this takes picks. An `angle` token holding
 * `[0deg, 30deg]` is a rule that holds in one design and is inert in the next,
 * and marking it inert in the flat one would be a warning with nothing behind
 * it.
 */
interface InertRule {
	/** The constraint's own term — what an unsat core would blame. */
	constraint: string;
	/** The member whose rotation is what took the quantity away. */
	culprit: string;
	why: string;
}

function inertRules(
	scene: Scene,
	node: SceneNode,
	picks: Picks,
): InertRule[] {
	const out: InertRule[] = [];
	const seen = new Set<string>();
	for (const found of inertConstraints(scene, picks)) {
		if (seen.has(found.constraint)) continue;
		const constraint = scene.constraints.find((c) => c.id === found.constraint);
		// Is this node one of the ones the rule is about? Through the same
		// reduction `spatial.ts` uses, rather than a fourth copy of it here: a rule
		// may name the part, the instance's copy, a state's copy or a keyframe's,
		// and all four are this node as far as simplex is concerned.
		const names = (constraint?.nodes ?? []).some(
			(member) => constraintMemberNode(scene, member)?.id === node.id,
		);
		if (!names) continue;
		seen.add(found.constraint);
		out.push({
			constraint: found.constraint,
			culprit: constraintMemberNode(scene, found.member)?.id ?? found.member,
			why: found.why,
		});
	}
	return out;
}

/**
 * What a value says, in one line, for the row that is showing what a state is
 * overriding.
 *
 * Alternatives are joined with "or" rather than a comma because that is what a
 * list of them means — this value is a decision the solver makes, and reading
 * it out as "24px or 32px" says so where "24px, 32px" reads as two things at
 * once. A length is read out in the document's unit like every other length in
 * this panel; anything else is its term's own label, so a token appears by name
 * rather than as whatever it currently resolves to. The name is the point: what
 * the base *says* is what a delta is being compared against, and a state that
 * overrides `accent` with `#ff0000` should read as leaving `accent` behind.
 */
function valueLine(
	scene: Scene,
	names: Readonly<Record<string, string>>,
	value: Value,
	type: ValueType,
	unit: Unit,
): string {
	if (value.length === 0) return "nothing";
	return value
		.map((term) =>
			term.kind === "literal" && isLengthType(type)
				? shownLength(term.value, unit)
				: termLabel(scene.tokens, term, names),
		)
		.join(" or ");
}

/**
 * Which state this instance is drawn in — which is also which state it starts
 * in when the document is exported.
 *
 * One decision rather than two, and that is worth defending because a tool
 * could easily have had a "preview state" separate from an "initial state". It
 * would then have two answers to "what does this button look like", and the
 * canvas would be showing a design the file does not ship. `SceneNode.state` is
 * the twin of `SceneNode.holds` — a decision the document remembers about one
 * use of a shared definition — and this row is the twin of the override rows
 * above it.
 *
 * Playing a state is the *other* thing, and the strip is where it lives: it
 * changes no document, costs no solve, and is forgotten when the panel closes,
 * because every state's copy is already in the one answer set beside the
 * picture. A row that conflated the two would make watching a hover an edit.
 *
 * `picks` is in the props because a caller that has them should hand them over
 * and because the spec puts it there — but nothing here reads it, and the
 * absence is the invariant showing through: a state is never an `alt/2`
 * alternative and never gets a `pick/2`, so there is no pick that says which
 * state anything is in.
 */
function StateSection({
	scene,
	node,
	machine,
	playing,
	onSceneChange,
	onPlay,
	onSelect,
}: {
	scene: Scene;
	node: SceneNode;
	/** The machine driving this node — `machineForNode`, never undefined here. */
	machine: Machine;
	picks: Picks;
	/** The state the canvas is playing for *this* node. */
	playing?: string;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	onPlay?: (instance: string, state: string | null) => void;
	onSelect?: (ids: string[]) => void;
}) {
	const first = machine.states[0];
	if (!first) {
		return (
			<div data-role="state-section">
				<h3>States</h3>
				<p className={styles.note} data-role="no-states">
					“{machine.name}” has no states left. Add one in the States panel and
					this instance has somewhere to be.
				</p>
			</div>
		);
	}
	/**
	 * States nothing can ever reach, greyed rather than hidden — the same
	 * treatment an alternative no design uses gets two sections up, and for the
	 * same reason: it is still in the document and still a thing to repair.
	 */
	const unreached = new Set(machineHealth(machine).unreachable);
	const reachable = new Set(
		machine.states.map((s) => s.id).filter((id) => !unreached.has(id)),
	);
	/** What the document says, as opposed to what it falls back to. */
	const stored = findState(machine, node.state)?.id;
	/**
	 * Whether the machine's root is still a component definition.
	 *
	 * `machineForRoot` is blunt on purpose — see its comment: it answers what the
	 * machine *names*, so that a machine whose definition was released is still a
	 * record a panel can show and repair. The program is not blunt about it at
	 * all: `machine_of(M,R)` joins `instance(I,R)` and finds nobody, so nothing
	 * about the machine reaches the answer set. That gap between a document that
	 * holds a machine and a design that has none is exactly the kind of silence
	 * this panel says out loud everywhere else — an instance of a definition that
	 * stopped being one, a node wearing a style the document no longer holds —
	 * and it costs one lookup to say it here too.
	 */
	const alive = componentDef(scene, machine.root) !== undefined;

	return (
		<div data-role="state-section">
			<h3>States</h3>
			<p className={styles.note} data-role="machine-of">
				Behaving as <strong>{machine.name}</strong>, which belongs to the
				definition rather than to this use of it. Every state is true at once in
				the answer set, so playing one costs no solve — what the document
				remembers is only which one is drawn.
			</p>
			{alive ? null : (
				<p className={styles.note} data-role="orphan-machine">
					Its root is no longer a component definition, so nothing it says
					reaches the design. The states are still here; mark that subtree as a
					component again and they come back.
				</p>
			)}

			{/* Read-only: the strip shows and plays, and editing a machine happens in
			    one place. A second editor here would be a second place to rename a
			    state and a second place to get it wrong. */}
			<StateStrip
				machine={machine}
				shown={shownState(machine, node)}
				playing={playing}
				reachable={reachable}
				onPlay={(state) => onPlay?.(node.id, state)}
				onShow={(state) =>
					onSceneChange((prev) => setNodeState(prev, node.id, state))
				}
			/>

			<label
				className={cx(styles.field, styles.wide)}
				title="Which state this instance is drawn in on the canvas, and which state it starts in when the document is exported. One answer, because a canvas showing a design the file does not ship would be a canvas nobody could trust."
			>
				<span className={styles.fieldLabel}>drawn in</span>
				<select
					className={styles.number}
					data-role="show-state"
					value={stored ?? ""}
					onChange={(e) =>
						onSceneChange((prev) =>
							setNodeState(prev, node.id, e.target.value || null),
						)
					}
				>
					{/* Two ways to be in the initial state, and they are different
					    statements. Saying nothing follows the machine: reorder its
					    states and this instance follows them. Naming the state pins
					    this instance to it whatever the machine does later. */}
					<option value="">Follow the machine — {stateName(machine, first.id)}</option>
					{machine.states.map((state) => (
						<option key={state.id} value={state.id}>
							{state.name}
							{unreached.has(state.id) ? " (unreachable)" : ""}
						</option>
					))}
				</select>
			</label>

			<p className={styles.note}>
				{/* There is no prop that switches panels — the tabs are Studio's — so
				    the nearest honest thing is to select the definition, which is
				    where the machine's own rows are, and to name the panel that
				    edits it. */}
				<button
					type="button"
					className={styles.jump}
					data-role="goto-machine"
					title="Select the definition this machine belongs to; the States panel is where its states and transitions are edited"
					onClick={() => onSelect?.([machine.root])}
				>
					Edit {machine.name}
				</button>{" "}
				in the States panel: adding a state, or changing what one does, changes
				every instance at once.
			</p>
		</div>
	);
}

/**
 * The authoring surface for a state's delta — the second half of this feature's
 * whole editing story, and the half where a designer can most easily be lied
 * to.
 *
 * The danger is precise and worth naming: every row below *looks* like the rows
 * further down the panel, and the rows further down write the definition. Type a
 * colour in the wrong block and you have not changed what the button looks like
 * on hover, you have changed what the button looks like — in every state, in
 * every instance, forever, with an undo stack as the only clue. So the block
 * commits to three things that cost screen space and are worth it:
 *
 *   - **nothing is authored by default.** The strip opens on *Base*, which is
 *     not a state; while it is selected this block shows no editable rows at
 *     all, and the panel is the panel it has always been. A designer has to
 *     press a state's name before a single delta row exists.
 *   - **the banner says which state, in words, above the rows.** Not a border,
 *     not a tint — those are the *second* signal, and a person scrolling past a
 *     tint reads it as decoration.
 *   - **every row says what the definition decided beside what the state does**,
 *     the way the style rows say "from Heading". A delta is meaningless on its
 *     own; it is a difference, and a difference shown without the thing it
 *     differs from is a number.
 *
 * What the block writes is `MachineState.parts[node.id]`, keyed by the
 * *definition* part — so it is authored once and every instance gets it, which
 * is the same bargain the definition itself strikes. The variables it mints are
 * per instance (`sprop(I,S,N,P)`), and so the solver questions a row could ask —
 * which alternative is live, which are ruled out, pin one — have as many answers
 * as there are instances and no single answer here. Rather than pick an instance
 * and quietly show its answer as if it were the definition's, these rows leave
 * those halves off entirely; the States panel is where a delta's variable is
 * greyed, pinned and asked about, because that panel is looking at one instance
 * at a time.
 *
 * Which is also the answer to "why does the States panel edit deltas too". The
 * two are the same edit approached from its two ends: that panel holds a machine
 * and walks its parts — one state, every part, with the solver's answers beside
 * each row — and this one holds a part and walks the machine's states, which is
 * the end a designer is at when they have just clicked a label on the canvas and
 * want to know what hover does to *it*. They write through the same edits with
 * the same coalescing keys, so a value dragged in one and typed in the other
 * lands in the undo stack as one change either way.
 */
function StateDeltaSection({
	scene,
	node,
	machine,
	def,
	state,
	picks,
	unit,
	inDepth,
	playing,
	onEdit,
	onPlay,
	onSceneChange,
}: {
	scene: Scene;
	/** The definition part being authored — the subject of the whole panel. */
	node: SceneNode;
	machine: Machine;
	def: ComponentDef;
	/** The state being authored, or undefined for the definition's own values. */
	state: MachineState | undefined;
	picks: Picks;
	unit: Unit;
	/**
	 * Whether the panel is showing the third axis for this part at all — the same
	 * answer the Depth and Rotation sections below are drawn from, handed down
	 * rather than recomputed.
	 *
	 * Recomputing it here would let the two disagree, and the way they would
	 * disagree is the bad one: a designer who has opened the third axis on a flat
	 * card to lean it on hover would find the definition's own rotation rows on
	 * screen and the state's missing, with nothing saying why. One answer, decided
	 * once, in the component that owns the disclosure.
	 */
	inDepth: boolean;
	/** What the canvas is drawing each instance in — see `InspectorProps`. */
	playing?: Readonly<Record<string, string>>;
	/** Choose a state to author, or null to go back to the definition. */
	onEdit: (state: string | null) => void;
	onPlay?: (instance: string, state: string | null) => void;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
}) {
	const names = nodeNames(scene.nodes);
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	// Six numbers rather than four: `boxOf` is `frameOf` with the third axis
	// beside it and answers zero where the document says nothing, so a flat part
	// reads exactly what `frameOf` gave it and a lifted one has somewhere for a
	// new alternative to start from.
	const box = boxOf(node, context);
	const delta: StatePart = (state && state.parts[node.id]) || {};
	/** The initial state is what the definition on the canvas already is. */
	const initial = machine.states[0]?.id;
	/**
	 * What the block is currently about, for the sentences. The rows are only
	 * ever rendered with a state open, so this is the state's name wherever a row
	 * reads it; `def.name` is what it falls back to, which no row ever sees and
	 * which is still the true answer for the Base chip's own title.
	 */
	const showing = state?.name ?? def.name;
	/**
	 * Where this state can actually be watched.
	 *
	 * The definition on the canvas is always its initial state and that is not an
	 * oversight — §3.6: a definition part's frame is a *fact* the compiler emits,
	 * every instance inherits it, so drawing the definition in a non-initial state
	 * would move the component itself. The consequence for this panel is the thing
	 * a designer would otherwise spend ten minutes on: choosing Hover here changes
	 * nothing on the canvas, ever. So the block says so, and hands over the one
	 * gesture that does show it — playing the state on the uses, which touches no
	 * document and costs no solve because every state's copy is already in the
	 * answer set beside the picture.
	 */
	const uses = instanceNodes(scene).filter((n) => n.instanceOf === def.root.id);
	const watching =
		state !== undefined &&
		uses.length > 0 &&
		uses.every((n) => playing?.[n.id] === state.id);

	/**
	 * What a new delta starts at: the *one* value the definition is showing,
	 * never the whole list.
	 *
	 * This is the invariant, enforced at the one gesture that could break it by
	 * accident. Seeding a delta with a base that holds two alternatives would
	 * mint a `sprop` variable with two alternatives, and four states doing that
	 * to one binary choice is sixteen designs where the designer wrote one. Two
	 * alternatives *inside* a state is a legitimate design decision — "hover is
	 * accent or danger" is a question worth asking the solver — but it is one a
	 * person types on purpose with "+ Add value", not one that arrives free with
	 * a button called Change.
	 */
	function seed(value: Value, variable: string, fallback: string): Value {
		const term = activeTerm(value, variable, picks);
		return [term ? { ...term } : lit(fallback)];
	}

	/**
	 * One row of the block: what the state says here, or an offer to make it say
	 * something, with what the definition decided in both cases.
	 */
	function deltaRow({
		key,
		label,
		type,
		base,
		override,
		tokens,
		fallback,
		variable,
		onWrite,
	}: {
		key: string;
		label: string;
		type: ValueType;
		/** What the definition holds — every state that says nothing gets this. */
		base: Value;
		/** What this state holds instead, where it holds anything. */
		override: Value | undefined;
		tokens: readonly Token[];
		fallback: string;
		/** Only for previewing a term; a delta's real variable is per instance. */
		variable: string;
		/**
		 * Write the delta, or clear it with `undefined`. It carries its own
		 * `onSceneChange` because a property and a dimension are two different
		 * keys and two different edits, and the row is the same row either way.
		 */
		onWrite: (next: Value | undefined) => void;
	}) {
		const baseLine = valueLine(scene, names, base, type, unit);
		if (override && override.length > 0) {
			return (
				// The same three roles the States panel's own delta rows carry, and
				// the same spelling of each: two panels editing one thing should be
				// addressable by one query, not by two that have to be kept in step.
				<div
					key={key}
					className={styles.delta}
					data-role="state-delta"
					data-state={state?.id}
					data-part={node.id}
					data-field={key}
				>
					<ValueEditor
						testId={`delta-${key}`}
						label={label}
						type={type}
						value={override}
						tokens={tokens}
						unit={unit}
						fallback={fallback}
						names={names}
						preview={(term: Term) => resolveValue(context, [term], variable)}
						onChange={(next) => onWrite(next)}
					/>
					<div className={styles.styledFoot}>
						<span className={styles.styledBy}>
							{def.name} says {baseLine}
						</span>
						<button
							type="button"
							className={styles.follow}
							data-role="clear-delta"
							data-field={key}
							title={`Stop overriding this in ${showing}. It goes back to whatever ${def.name} decides, shared with every other state.`}
							onClick={() => onWrite(undefined)}
						>
							Follow {def.name}
						</button>
					</div>
				</div>
			);
		}
		return (
			<div
				key={key}
				className={styles.baseRow}
				data-role="state-base"
				data-part={node.id}
				data-field={key}
			>
				<span className={styles.fieldLabel}>{label}</span>
				<span className={styles.baseValue} title={`${def.name} decides this, and every state that says nothing about it draws it`}>
					{baseLine}
				</span>
				<button
					type="button"
					className={styles.change}
					data-role="add-delta"
					data-field={key}
					title={`Give ${showing} its own ${label.toLowerCase()}, starting at what ${def.name} is showing`}
					onClick={() => onWrite(seed(base, variable, fallback))}
				>
					Change in {showing}
				</button>
			</div>
		);
	}

	return (
		<div data-role="state-delta-section">
			{/* Not "States": a node can be an instance *and* a part of an outer
			    definition, and then both blocks are on screen at once. Two headings
			    reading "States" a hand's width apart, one about which state this node
			    is in and one about what a state changes, is the confusion this block
			    is built to prevent, arriving in the one place nobody would look for
			    it. */}
			<h3>What a state changes</h3>
			<p className={styles.note} data-role="delta-of">
				<strong>{def.name}</strong> behaves as <strong>{machine.name}</strong>.
				Pick a state to author what it changes about this part; everything a
				state says nothing about is {def.name}’s own, shared by every state at
				once.
			</p>

			{/* The chooser, and the *Base* chip is the load-bearing half of it: it is
			    the way out, it is what the block opens on, and it is what makes "am I
			    editing the button or the button's hover" a question with a visible
			    answer rather than a thing to remember. */}
			<div className={styles.stateBar} data-role="author-states">
				<button
					type="button"
					className={cx(styles.state, state === undefined && styles.stateBase)}
					data-role="author-state"
					data-base=""
					data-on={state === undefined ? "" : undefined}
					aria-pressed={state === undefined}
					title={`Edit ${def.name} itself — what every state that says nothing draws`}
					onClick={() => onEdit(null)}
				>
					Base
				</button>
				{machine.states.map((s) => (
					<button
						key={s.id}
						type="button"
						className={cx(styles.state, s.id === state?.id && styles.stateOn)}
						data-role="author-state"
						data-state={s.id}
						data-on={s.id === state?.id ? "" : undefined}
						data-touched={stateTouches(s.parts[node.id] ?? {}) ? "" : undefined}
						aria-pressed={s.id === state?.id}
						title={`Edit what ${s.name} changes about ${node.name}`}
						onClick={() => onEdit(s.id)}
					>
						{s.name}
						{stateTouches(s.parts[node.id] ?? {}) ? (
							<span className={styles.touched} aria-hidden="true">
								•
							</span>
						) : null}
					</button>
				))}
			</div>

			{state === undefined ? (
				<p className={styles.note} data-role="editing-base">
					Editing <strong>{def.name}</strong> itself. The rows below this block
					are the definition’s own values — change one and every state that says
					nothing about it changes with it.
				</p>
			) : (
				<>
					<p className={styles.authoring} data-role="editing-state">
						Editing <strong>{state.name}</strong> of {def.name} · {node.name}.
						Every row in this block writes what {state.name} changes; the rows
						below it are still {def.name}’s own.
					</p>

					{/* And immediately: the canvas has not moved, and it is not going to.
					    A definition is drawn in its initial state whatever is open here
					    — §3.6, and the reason is that a definition part's frame is a fact
					    every instance inherits — so the panel says it in the same breath
					    and offers the gesture that does show the state. */}
					{uses.length === 0 ? (
						<p className={styles.note} data-role="no-uses">
							Nothing on the canvas changes: {def.name} itself is always drawn
							in {stateName(machine, initial ?? "")}, and there is no instance of
							it to watch this state on. Place one and this becomes visible.
						</p>
					) : (
						<p className={styles.note} data-role="watch-note">
							{def.name} itself is always drawn in{" "}
							{stateName(machine, initial ?? "")}, so nothing on the canvas moves
							while this is open.{" "}
							<button
								type="button"
								className={styles.jump}
								data-role="play-state"
								aria-pressed={watching}
								title={
									watching
										? "Put the canvas back to the state each use is drawn in"
										: "Draw every use of this definition in this state. It changes no document and costs no solve — every state's copy is already in the answer set."
								}
								onClick={() => {
									for (const use of uses) {
										onPlay?.(use.id, watching ? null : state.id);
									}
								}}
							>
								{watching
									? "Stop watching"
									: `Watch it on ${uses.length} use${uses.length === 1 ? "" : "s"}`}
							</button>
						</p>
					)}

					{state.id === initial ? (
						<p className={styles.note} data-role="initial-warning">
							{state.name} is the initial state, which is what {def.name}
							already is on the canvas. A delta here changes only {state.name}
							— the other states keep reading {def.name}’s own value — so what
							is almost always meant is editing {def.name} below.
						</p>
					) : null}

					{/* Presence first, because it is the one thing a delta says that no
					    row below can express, and because it decides whether the rest of
					    the block is even drawn on screen in this state. */}
					<label className={styles.check}>
						<input
							type="checkbox"
							data-role="state-hidden"
							checked={delta.hidden === true}
							onChange={(e) =>
								onSceneChange((prev) =>
									setStateHidden(prev, machine.id, state.id, node.id, e.target.checked),
								)
							}
						/>
						<span>Out of the picture in {state.name}</span>
					</label>
					{delta.hidden ? (
						<p className={styles.note} data-role="hidden-note">
							{node.name} and everything inside it is not drawn in {state.name}.
							The rows below still say what it would look like if it were.
						</p>
					) : null}

					{/* A part the container above places is placed by it in every state:
					    a state copy has no layout of its own — §3.6 — so a delta on a
					    managed coordinate is a value the layout then decides over. Said
					    here rather than by disabling the row, because the row is not
					    wrong for `width` and because the position half of the same claim
					    is already made twenty rows down about the definition. */}
					{managedNodes(scene.nodes).has(node.id) ? (
						<p className={styles.note} data-role="delta-managed">
							Placed by the layout above, in this state as in every other — a
							state has no layout of its own to differ with.
						</p>
					) : null}

					<div className={styles.props} data-role="delta-frame">
						{DIMENSIONS.map((dim) =>
							deltaRow({
								key: dim,
								label: FRAME_DIMS[dim].label,
								type: FRAME_DIMS[dim].type,
								base: node.frame[dim],
								override: delta.frame?.[dim],
								tokens: tokensOfType(scene, FRAME_DIMS[dim].type),
								// A third alternative starts where the part is now, spelled
								// in the document's unit — a fallback has no literal of its
								// own to inherit a spelling from.
								fallback: formatLength(box[dim], unit),
								variable: frameVar(node.id, dim),
								onWrite: (next) =>
									onSceneChange(
										(prev) =>
											setStateFrame(prev, machine.id, state.id, node.id, dim, next),
										`delta-${machine.id}-${state.id}-${node.id}-${dim}`,
									),
							}),
						)}
					</div>

					{/* And the other two, which are the same row and a different table.
					    A state that lifts a mesh 40px forward is the claim a state that
					    moves a button two pixels down is — `sfval(I,S,N,D)` takes any of
					    the six and `setStateFrame` was widened to `Axis3` for exactly
					    this — so it is `deltaRow` again with `SPATIAL_DIMS` where
					    `FRAME_DIMS` was, and no new machinery anywhere.

					    Behind the same disclosure the definition's own rows are behind,
					    and that is the whole of why this is not noise on a flat document:
					    a hover that changes a button's `depth` is not a thing anybody
					    means, and three empty rows per state per part would bury the two
					    that matter. */}
					{inDepth ? (
						<div className={styles.props} data-role="delta-spatial">
							{SPATIALS.map((dim) =>
								deltaRow({
									key: dim,
									label: SPATIAL_DIMS[dim].label,
									type: SPATIAL_DIMS[dim].type,
									base: node.spatial?.[dim] ?? [lit(SPATIAL_DIMS[dim].fallback)],
									override: delta.frame?.[dim],
									tokens: tokensOfType(scene, SPATIAL_DIMS[dim].type),
									fallback: formatLength(box[dim], unit),
									variable: frameVar(node.id, dim),
									onWrite: (next) =>
										onSceneChange(
											(prev) =>
												setStateFrame(prev, machine.id, state.id, node.id, dim, next),
											`delta-${machine.id}-${state.id}-${node.id}-${dim}`,
										),
								}),
							)}
						</div>
					) : null}

					{/* Rotation, which is the one delta with no row above it in the
					    definition's own grid: a turn is always a full value row, never a
					    compact field, because an `angle` token holding two alternatives is
					    "the whole rack tilts, or it does not" and that is a design
					    decision rather than a number. The state's copy is the same shape,
					    written through `setStateTurn` into `srval(I,S,N,R)`.

					    What a fresh delta starts at is the angle the part is *already*
					    turned by, spelled in degrees — `writeAngle` rather than the stored
					    literal, because the base may be a token and a delta seeded with a
					    link would follow the definition rather than differ from it, which
					    is the one thing a delta is for. */}
					{inDepth ? (
						<div className={styles.props} data-role="delta-turn">
							{TURN_NAMES.map((turn) =>
								deltaRow({
									key: turn,
									label: TURNS[turn].label,
									type: "angle",
									base: node.turn?.[turn] ?? [lit(VALUE_TYPES.angle.fallback)],
									override: delta.turn?.[turn],
									tokens: tokensOfType(scene, "angle"),
									fallback: writeAngle(turnOf(node, context)[turn]),
									variable: rotateVar(node.id, turn),
									onWrite: (next) =>
										onSceneChange(
											(prev) =>
												setStateTurn(prev, machine.id, state.id, node.id, turn, next),
											`delta-${machine.id}-${state.id}-${node.id}-${turn}`,
										),
								}),
							)}
						</div>
					) : null}

					<div className={styles.props} data-role="delta-props">
						{KINDS[node.kind].props.map((prop) =>
							deltaRow({
								key: prop,
								label: PROPS[prop].label,
								type: PROPS[prop].type,
								base: node.props[prop] ?? defaultValue(prop),
								override: delta.props?.[prop],
								tokens: tokensFor(scene, prop),
								fallback: PROPS[prop].fallback,
								variable: propVar(node.id, prop),
								onWrite: (next) =>
									onSceneChange(
										(prev) =>
											setStateProp(prev, machine.id, state.id, node.id, prop, next),
										`delta-${machine.id}-${state.id}-${node.id}-${prop}`,
									),
							}),
						)}
					</div>

					{stateTouches(delta) ? (
						<button
							type="button"
							className={styles.follow}
							data-role="clear-delta"
							data-part={node.id}
							title={`Say that ${state.name} changes nothing about ${node.name}. One spelling of "nothing", so the delta is gone rather than left empty.`}
							onClick={() =>
								onSceneChange((prev) =>
									clearStatePart(prev, machine.id, state.id, node.id),
								)
							}
						>
							{state.name} changes nothing here
						</button>
					) : null}
				</>
			)}
		</div>
	);
}

/**
 * Which treatment this selection wears, if any.
 *
 * One select rather than a strip, because a node wears one style: two styles
 * could both decide `size`, and then the answer would depend on which was
 * listed first. Anything the style does not decide the node decides itself.
 *
 * It takes a whole selection so that "select the headings, wear Heading" is one
 * gesture — which is how a style is applied in practice, and the reason this
 * appears in the many-selected panel too.
 *
 * {@link wearStyle} rather than `setStyle`, so the gesture does what it looks
 * like: the treatment wins, and what is left overriding afterwards was
 * overridden on purpose. See its comment — the difference is the whole
 * usability of applying one.
 */
function StylePicker({
	all,
	ids,
	current,
	mixed,
	onSceneChange,
}: {
	all: readonly Style[];
	ids: readonly string[];
	/** The style they all wear, where they agree. */
	current: string | undefined;
	mixed: boolean;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
}) {
	return (
		<select
			className={styles.wear}
			data-role="wear-style"
			value={mixed ? "?" : (current ?? "")}
			title="Wear one of the document's styles, or none"
			onChange={(e) => {
				const next = e.target.value;
				if (next === "?") return;
				onSceneChange((prev) => wearStyle(prev, ids, next === "" ? undefined : next));
			}}
		>
			{mixed ? (
				<option value="?" disabled>
					Mixed
				</option>
			) : null}
			<option value="">No style</option>
			{all.map((style) => (
				<option key={style.id} value={style.id}>
					{style.name}
				</option>
			))}
		</select>
	);
}

/**
 * "Wearing Heading" — and what that means for this node.
 *
 * The same language a component instance gets, because it is the same idea:
 * something outside this node decides part of it, editing the thing outside
 * changes every node wearing it, and the node can still differ where it says
 * so. What is *not* offered is a per-node choice of variant: the pick belongs
 * to the style — one variable for the whole document — and a node that could
 * choose its own would be a node that had its own copy of it.
 */
function StyleSection({
	scene,
	node,
	picks,
	onSceneChange,
}: {
	scene: Scene;
	node: SceneNode;
	picks: Picks;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
}) {
	const worn = styleOf(scene, node);
	// Nothing to wear and nothing worn: a document with no styles should not
	// grow a section about them.
	if (scene.styles.length === 0 && node.style === undefined) return null;
	const decides = worn ? wornProps(scene, node) : [];
	const at = worn ? picks[styleVar(worn.id)] : undefined;

	return (
		<div data-role="style-section">
			<h3>Style</h3>
			{node.style !== undefined && !worn ? (
				<p className={styles.note} data-role="orphan-style">
					Wearing “{node.style}”, which the document no longer holds. Nothing is
					taken from it, so this node decides its own appearance.
				</p>
			) : null}
			{worn ? (
				<p className={styles.note} data-role="wearing">
					Wearing <strong>{worn.name}</strong>
					{worn.variants.length > 1 && at !== undefined ? (
						<>
							, showing <strong>{variantLabel(worn, at)}</strong>
						</>
					) : null}
					.{" "}
					{decides.length > 0
						? `It decides ${decides.map((p) => PROPS[p].label.toLowerCase()).join(", ")} below.`
						: "It decides nothing this node has anywhere to put."}
				</p>
			) : null}
			<StylePicker
				all={scene.styles}
				ids={[node.id]}
				current={worn?.id}
				mixed={false}
				onSceneChange={onSceneChange}
			/>
		</div>
	);
}

/**
 * Properties of the current selection, in the shape a designer expects:
 * position, then content, then appearance.
 *
 * The one idea that is not Figma's is that every appearance row holds a *list*
 * of values. One value is an ordinary design; two is a decision the solver
 * will explore.
 */
export function Inspector({
	scene,
	selection,
	onSceneChange,
	picks,
	varying,
	solved,
	reach,
	freedom = {},
	pins,
	onPin,
	why,
	derived = [],
	known,
	everywhere,
	variables = {},
	onSelectionChange,
	playing,
	onPlay,
}: InspectorProps) {
	/**
	 * Which state's delta the panel is authoring, or null for the definition
	 * itself. Panel state and nothing else: it writes no document, it is not in
	 * the undo stack, and it is forgotten when the app reloads.
	 *
	 * A state *id* rather than a machine-and-state pair, and it survives moving
	 * the selection on purpose. "Edit hover's fill on the label, then hover's y
	 * on the icon" is one job with two selections in it, and a chooser that reset
	 * to Base on every click would make that job a click longer every time. A
	 * selection whose machine has no state by that id falls back to Base — see
	 * `authored` below — so nothing is ever authored into a state the part's
	 * machine has not got.
	 *
	 * It is deliberately *not* `playing`. Which state the canvas is drawing is a
	 * per-instance question with an answer for each instance; which state is
	 * being authored is a question about the definition, which has no instance in
	 * it. The two agreeing would need one of them to be lying.
	 */
	const [authoring, setAuthoring] = useState<string | null>(null);
	/**
	 * Whether the third axis is on screen for a selection that is not already in
	 * it.
	 *
	 * Panel state, and it writes nothing — which is the point, and it is worth
	 * defending because the obvious alternative is a button that writes `z: 0`.
	 * Stating a `z` is not a display setting: `zstated/1` is emitted from it,
	 * `s3/1` follows, `isSpatialScene` turns true, and the whole third axis
	 * grounds for a document whose author wanted to *look* at two number fields.
	 * The no-regression promise is that a flat document costs nothing, and a
	 * disclosure that quietly spent it would be the worst possible way to break
	 * that promise — invisibly, from a click that looked like scrolling.
	 *
	 * So the rows appear, the document is untouched, and the first number typed
	 * into one of them is what puts the node in the third axis. `clearSpatial`
	 * and `clearTurn` take it back out again, and the × beside each field is
	 * there so that taking it back out is as reachable as putting it in.
	 *
	 * It survives moving the selection, for {@link authoring}'s reason: "lean the
	 * card, then lean the badge on it" is one job with two selections in it, and
	 * a disclosure that shut on every click would make that job a click longer
	 * every time. A node already in the third axis ignores it entirely.
	 */
	const [depthOpen, setDepthOpen] = useState(false);
	const selected = [...selection]
		.map((id) => findInTree(scene.nodes, id))
		.filter((n): n is SceneNode => n !== undefined);
	/**
	 * What every length in this panel is read out in, whatever each one is
	 * stored as. One document-wide answer rather than one per row: a panel where
	 * the width said millimetres and the padding said pixels would be a panel
	 * whose numbers cannot be compared by eye, which is most of what a panel of
	 * numbers is for.
	 */
	const unit = documentUnit(scene);
	const changeUnit = (next: Unit) => onSceneChange((prev) => setUnit(prev, next));

	// A single selected id the document does not hold is a node some rule
	// derived. There is nothing to edit, so what it gets is an account of
	// itself rather than a form.
	const lone = selection.size === 1 ? [...selection][0] : undefined;
	if (lone !== undefined && selected.length === 0) {
		const found = derived.find((d) => d.node.id === lone);
		if (found || known?.has(lone)) {
			return (
				<DerivedPanel
					id={lone}
					node={found?.node}
					parent={found?.parent ?? null}
					everywhere={everywhere === undefined || everywhere.has(lone)}
					variables={variables}
					picks={picks}
					reach={reach}
					pins={pins}
					onPin={onPin}
					unit={unit}
					why={why}
				/>
			);
		}
	}

	if (selected.length === 0) {
		return (
			<div className={styles.inspector} data-role="inspector">
				<p className={styles.empty}>
					Nothing selected. Draw a rectangle with <kbd>R</kbd>, text with{" "}
					<kbd>T</kbd>, or pick a layer.
				</p>
				{/* The document's own setting, and the only panel state that is worth
				    anything with nothing selected — "measure this in millimetres" is a
				    decision about the document, usually made before the first
				    rectangle exists. */}
				<h3>Units</h3>
				<div className={styles.grid}>
					<UnitField unit={unit} onChange={changeUnit} />
				</div>
			</div>
		);
	}

	if (selected.length > 1) {
		const worn = new Set(selected.map((n) => n.style));
		return (
			<div className={styles.inspector} data-role="inspector">
				<h2>{selected.length} selected</h2>
				<p className={styles.empty}>
					Move them together, or select one to edit its properties.
				</p>
				{/* Except this: wearing a style is the one edit that is *better* made
				    to a whole selection, because "these all look alike" is what a
				    style says. */}
				{scene.styles.length > 0 ? (
					<div data-role="style-section">
						<h3>Style</h3>
						<p className={styles.note}>
							One treatment for all {selected.length}. Whatever it decides they
							stop deciding themselves; select one to override it there.
						</p>
						<StylePicker
							all={scene.styles}
							ids={selected.map((n) => n.id)}
							current={worn.size === 1 ? [...worn][0] : undefined}
							mixed={worn.size > 1}
							onSceneChange={onSceneChange}
						/>
					</div>
				) : null}
			</div>
		);
	}

	const node = selected[0];
	const managed = managedNodes(scene.nodes).has(node.id);
	// A size the solver worked out is not a size the inspector can set.
	const sizedBySolver = {
		width: solved?.[node.id]?.width !== undefined,
		height: solved?.[node.id]?.height !== undefined,
	};
	const container = KINDS[node.kind].container && (node.children?.length ?? 0) > 0;
	/**
	 * The two ways a machine reaches this panel, and they are different subjects
	 * rather than two spellings of one.
	 *
	 * An **instance** is *in* a state: the decision it owns is which one, and
	 * that is a fact the compiler emits about this node. A **definition part** is
	 * what a state is *about*: the decision authored against it is a delta, which
	 * belongs to the definition and reaches every instance at once.
	 *
	 * A node can be both — an instance nested inside another definition — and
	 * then both blocks appear, which is right: the nested button is drawn in a
	 * state of its own machine, and the outer card's hover may still recolour it.
	 */
	const ownMachine = isInstance(node) ? machineForNode(scene, node) : undefined;
	const partOf = machineForPart(scene, node);
	/**
	 * The state being authored, once the chooser's answer has been checked
	 * against the machine actually in front of us. A stale id — hover carried
	 * over to a component that has no hover — is Base, silently, because the
	 * alternative is authoring into a state that does not exist.
	 */
	const authored = partOf ? findState(partOf.machine, authoring ?? undefined) : undefined;
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	const names = nodeNames(scene.nodes);
	/**
	 * Where the node actually is, in the universe on screen — all six numbers.
	 *
	 * `boxOf` rather than `frameOf`, and it changes nothing about the four rows
	 * that were already here: it *is* `frameOf` with `spatialDim` beside it, and
	 * both answer zero where the document says nothing. What it buys is a place
	 * for a `z` field's fallback to come from that is the same place the `x`
	 * field's comes from, rather than a second reader with a second idea of what
	 * silence means.
	 */
	const box = boxOf(node, context);
	/**
	 * Whether this node is in the third axis at all — `isSpatialNode`, which is
	 * the TypeScript twin of the program's `s3/1` and asks the *document*
	 * rather than a universe, exactly as `zstated/1` is emitted from the document.
	 *
	 * Or its kind is: a `mesh` dragged out of a viewport in the layer list is a
	 * node the document holds, that nothing renders and nothing measures, and
	 * `isSpatialNode` deliberately does not count it — see its comment. The panel
	 * has to, because that node's place in the third axis is exactly what a
	 * person has to be able to fix, and a `mesh` whose inspector offers four
	 * numbers is a mesh nobody can put back.
	 */
	const spatialHere = isSpatialNode(scene, node) || KINDS[node.kind].spatial;
	const inDepth = spatialHere || depthOpen;
	/** Rules that name this node and have been left saying nothing. */
	const inert = inertRules(scene, node, picks);
	/**
	 * The cameras a view could look through, and the one it does.
	 *
	 * Both asked of `scene` rather than of the node in hand, which is what
	 * `camerasIn`'s otherwise redundant first argument is for: the panel holds the
	 * node it last rendered from, the document may have moved on underneath it,
	 * and a menu built from a stale subtree offers cameras that are no longer
	 * there. `cameraOf` keeps `vcam/2`'s three conditions exactly — it exists, it
	 * is a camera, it is in this view — so a name that fails any of them reads as
	 * "not looking through anything", which is what the program says too.
	 */
	const cameras = node.kind === "viewport" ? camerasIn(scene, node) : [];
	const looksThrough = node.kind === "viewport" ? cameraOf(scene, node) : undefined;

	/**
	 * A dimension with one number in it, which is what a number field can edit.
	 *
	 * Anything else — a choice, or a link to a token — is a value with a life of
	 * its own, and typing a number over it would either throw an alternative away
	 * or silently unwire a parameter.
	 */
	function plainDimension(dim: Dimension): boolean {
		return !varies(node.frame[dim]) && !frameFrozen(node, dim, context);
	}

	/**
	 * The literal one dimension holds — which, for a dimension a field can edit,
	 * is the whole of what it holds: {@link plainDimension} is exactly "one
	 * alternative, and it is a number".
	 *
	 * The literal rather than `box[dim]`, because the two are the same length and
	 * only one of them still says which unit it was written in. The fallback is
	 * for the dimension a `frameOf` default filled in, where there is no literal
	 * to have a unit.
	 */
	function storedLength(dim: Dimension): string {
		const term = node.frame[dim][0];
		return term?.kind === "literal" ? term.value : formatLength(box[dim], unit);
	}

	/**
	 * Typing a coordinate, which is a *statement* and not a gesture.
	 *
	 * So it is written exactly as said, through the same `setFrameValue` the
	 * alternatives row below uses — one of them is the list and the other is its
	 * only member. Three things `setFrame` would have done are deliberately not
	 * done here, and each is a gesture's business rather than a statement's:
	 *
	 *   - it writes through `writeLength`, which rounds to a whole pixel. Right
	 *     for a hand on a mouse, and it would make `210mm` — 793.7px — impossible
	 *     to type into the document that most wants it.
	 *   - it normalises the *whole* box, so typing a width would quietly pull a
	 *     hand-typed `12.5pt` x onto the pixel grid beside it. One field, one
	 *     value.
	 *   - it clamps a size to `MIN_NODE_SIZE`, which `geometry.ts` states as the
	 *     smallest a node may be *dragged* down to. A one-pixel rule is a thing
	 *     you type.
	 *
	 * What is given up with them is `refit`: a path's vertices do not rescale
	 * when its box is typed, and a group above does not re-fit until the next
	 * edit that moves something. Both were already true of the alternatives row,
	 * and neither is worth reimplementing half of `edits.ts` in a panel for.
	 */
	function stateDimension(dim: Dimension, text: string) {
		onSceneChange(
			(prev) => setFrameValue(prev, [node.id], dim, [lit(text)]),
			`frame-${node.id}-${dim}`,
		);
	}

	/**
	 * The probe is the authority wherever it has spoken: a field is dead when the
	 * rules leave the coordinate one value, and live otherwise — even for a
	 * coordinate the solver decides, because the stored number is what that
	 * coordinate is pulled toward. Until it lands, the document's own coarser
	 * answer stands in: a layout places its children, and a size the solver worked
	 * out is not a size to type into.
	 */
	function dimensionPinned(dim: Dimension): boolean {
		const probed = freedom[node.id]?.[dim];
		if (probed) return isPinned(probed);
		if (managed && FRAME_DIMS[dim].role === "pos") return true;
		return dim === "width" ? sizedBySolver.width : dim === "height" ? sizedBySolver.height : false;
	}

	/* -------------------------------------------------------------- */
	/* The third axis                                                  */
	/* -------------------------------------------------------------- */

	/**
	 * {@link plainDimension} one axis over, with one difference that is the whole
	 * of what makes the third axis sparse: **absence is plain**.
	 *
	 * A frame always has four dimensions, so `node.frame[dim]` is a list with
	 * something in it and "does it vary" is the only question. `node.spatial` is
	 * optional, and a node that has never been lifted holds nothing at all — which
	 * is not a choice, not a link, and exactly what a number field should be able
	 * to write into. `varies(undefined)` is already false and `spatialFrozen`
	 * already answers false for a dimension the node does not hold, so the two
	 * readers agree with no case here; this comment exists because the agreement
	 * looks accidental and is not.
	 */
	function plainSpatial(dim: Spatial): boolean {
		return (
			!varies(node.spatial?.[dim]) && !spatialFrozen(node, dim, context)
		);
	}

	/** The literal one spatial dimension holds — the twin of {@link storedLength}. */
	function storedSpatial(dim: Spatial): string {
		const term = node.spatial?.[dim]?.[0];
		return term?.kind === "literal" ? term.value : formatLength(box[dim], unit);
	}

	/**
	 * Typing a `z` or a `depth`, which is a statement like typing an `x` is — and
	 * on a node that held nothing, it is *also* the moment the node joins the
	 * third axis.
	 *
	 * That is not a hidden side effect; it is the only way to say it. `zstated/1`
	 * is emitted from the document rather than read back out of `frame/3`, so
	 * there is no state between "flat" and "in the third axis" for a field to
	 * write, and `setSpatialValue`'s own comment says the same about which kinds
	 * may be lifted: every one of them, because the document decides and not the
	 * kind. The × beside the field is the way back out, and `clearSpatial` removes
	 * the record rather than zeroing it so that "not lifted" keeps one spelling.
	 */
	function stateSpatial(dim: Spatial, text: string) {
		onSceneChange(
			(prev) => setSpatialValue(prev, node.id, dim, [lit(text)]),
			`spatial-${node.id}-${dim}`,
		);
	}

	/**
	 * One spatial dimension that has stopped being one number — it names a
	 * `length` token, or holds two alternatives — as the row every other value
	 * gets.
	 *
	 * The twin of the frame's own alternatives row below, down to the variable:
	 * `spatialDim` resolves through `frameVar(id, "z")`, so `z` really is a
	 * seventh dimension of one family as far as picking, pinning and asking why
	 * are concerned, and only the *storage* is separate. That is why this row can
	 * hand `picks`, `reach`, `pins` and `why` straight through with no
	 * translation: the solver has one name for it and so does the panel.
	 */
	function spatialRow(dim: Spatial) {
		const spec = SPATIAL_DIMS[dim];
		const variable = frameVar(node.id, dim);
		return (
			<ValueEditor
				key={dim}
				testId={`spatial-${dim}`}
				label={spec.label}
				type={spec.type}
				value={node.spatial?.[dim] ?? [lit(spec.fallback)]}
				tokens={tokensOfType(scene, spec.type)}
				unit={unit}
				fallback={formatLength(box[dim], unit)}
				names={names}
				active={picks[variable]}
				varying={varying.has(variable)}
				reachable={reach?.[variable]}
				pinned={pins[variable]}
				onPin={(index) => onPin(variable, index)}
				why={why?.(variable)}
				preview={(term: Term) => resolveValue(context, [term], variable)}
				onChange={(next) =>
					onSceneChange(
						(prev) => setSpatialValue(prev, node.id, dim, next),
						`spatial-${node.id}-${dim}`,
					)
				}
			/>
		);
	}

	/**
	 * One rotation, always as a full value row and never as a compact field.
	 *
	 * The asymmetry with the six dimensions is deliberate and it is the same one
	 * the compiler makes: a frame dimension holding a single literal is emitted as
	 * a *fact*, because paying for a `pick` on four dimensions of every rectangle
	 * in a document would multiply the program for nothing, while a rotation is
	 * emitted as a variable **always** — rotations are held by the handful of
	 * nodes that are turned at all, and every one of them wants to be able to name
	 * an `angle` token. "The whole rack tilts, or it does not" is one token and two
	 * designs, and a compact number field is the one control that cannot say it.
	 *
	 * So the panel spends the space the program spends, in the same place, for the
	 * same reason. The row is `angle`-typed, which is what routes it through
	 * `AngleInput` — see that field for why a plain input would snap a turned card
	 * flat once per keystroke.
	 */
	function turnRow(turn: Turn) {
		const variable = rotateVar(node.id, turn);
		const held = node.turn?.[turn];
		return (
			<div key={turn} data-role={`turn-${TURNS[turn].axis}`}>
				<ValueEditor
					testId={turn}
					label={TURNS[turn].label}
					type="angle"
					value={held ?? [lit(VALUE_TYPES.angle.fallback)]}
					tokens={tokensOfType(scene, "angle")}
					unit={unit}
					fallback={writeAngle(turnOf(node, context)[turn])}
					names={names}
					active={picks[variable]}
					varying={varying.has(variable)}
					reachable={reach?.[variable]}
					pinned={pins[variable]}
					onPin={(index) => onPin(variable, index)}
					why={why?.(variable)}
					preview={(term: Term) => resolveValue(context, [term], variable)}
					onChange={(next) =>
						onSceneChange(
							(prev) => setTurnValue(prev, node.id, turn, next),
							`turn-${node.id}-${turn}`,
						)
					}
				/>
				{held ? (
					<div className={styles.styledFoot}>
						<span className={styles.styledBy}>
							{/* Not decoration: a node with a rotation in the document is a
							    node whose faces no rule may be about, whether or not the
							    angle is zero in this universe. */}
							turned in the document
						</span>
						<button
							type="button"
							className={styles.follow}
							data-role={`clear-${turn}`}
							title="Say nothing about this rotation at all. A node that says nothing about all three keeps its faces, and a rule may be about them again."
							onClick={() =>
								onSceneChange((prev) => clearTurn(prev, node.id, turn))
							}
						>
							Not turned
						</button>
					</div>
				) : null}
			</div>
		);
	}

	/**
	 * One layout setting, as an ordinary value row.
	 *
	 * A layout's inputs are values like a fill is, so they get the same editor:
	 * two alternatives here is "a row at one breakpoint and a column at
	 * another", and a link is a gap that follows a spacing token. Which entry of
	 * `LAYOUT_PROPS` it is decides everything, including where it is written
	 * back to — the container, or this child.
	 */
	function layoutRow(prop: LayoutProp) {
		const spec = LAYOUT_PROPS[prop];
		const variable = layoutVar(node.id, prop);
		// A child says nothing until it is singled out, so its row starts at
		// what it is actually getting: the container's own answer.
		const parent = parentOf(scene.nodes, node.id);
		const seed =
			spec.on === "child" && prop === "alignSelf" && parent
				? layoutWord(parent, "align", context)
				: spec.fallback;
		const value: Value = layoutValueOf(node, prop) ?? single(seed);
		return (
			<ValueEditor
				key={prop}
				testId={`layout-${prop}`}
				label={spec.label}
				type={spec.type}
				value={value}
				tokens={tokensOfType(scene, spec.type)}
				unit={unit}
				fallback={spec.fallback}
				names={names}
				active={picks[variable]}
				varying={varying.has(variable)}
				reachable={reach?.[variable]}
				pinned={pins[variable]}
				onPin={(index) => onPin(variable, index)}
				why={why?.(variable)}
				preview={(term: Term) => resolveValue(context, [term], variable)}
				onChange={(next) =>
					onSceneChange(
						(prev) =>
							spec.on === "child"
								? setChildLayout(prev, [node.id], prop as "grow" | "alignSelf", next)
								: updateLayout(prev, node.id, { [prop]: next }),
						`layout-${node.id}-${prop}`,
					)
				}
			/>
		);
	}

	/**
	 * One guide setting, as an ordinary value row.
	 *
	 * `layoutRow`'s twin, because the document's two tables are twins: a margin
	 * or a gutter is a value exactly as a gap is, so it gets the same editor and
	 * the same everything downstream — a margin can name the page's spacing
	 * token, and a column count with two alternatives is a responsive grid held
	 * in one document. Which entry of `GUIDE_PROPS` it is decides the rest.
	 *
	 * Nothing here is a distance the *editor* works out. Where the lines then
	 * fall is the solver's answer to these numbers, which is why the canvas reads
	 * them back out of the answer set instead of dividing anything by hand.
	 */
	/**
	 * What one guide setting holds, with the table's own fallback standing in.
	 *
	 * The fallback is not a guess: it is what the compiler emits for a setting a
	 * node does not hold, so a field showing it is showing what the grid is
	 * actually being ruled with.
	 */
	function guideValue(prop: GuideProp): Value {
		return guideValueOf(node, prop) ?? single(GUIDE_PROPS[prop].fallback);
	}

	/**
	 * A setting with one number in it, which is what a compact field can edit —
	 * {@link plainDimension} for the grid, and the same argument: a choice or a
	 * link to a token is a value with a life of its own, and typing over it would
	 * either throw an alternative away or silently unwire a parameter.
	 */
	function plainGuide(prop: GuideProp): boolean {
		const value = guideValue(prop);
		return value.length === 1 && value[0].kind === "literal";
	}

	/** The literal a plain setting holds — for a plain one, all it holds. */
	function storedGuide(prop: GuideProp): string {
		const term = guideValue(prop)[0];
		return term?.kind === "literal" ? term.value : GUIDE_PROPS[prop].fallback;
	}

	/** Typing one: a statement, written exactly as said, like a coordinate. */
	function stateGuide(prop: GuideProp, text: string) {
		onSceneChange(
			(prev) => setGuideValue(prev, node.id, prop, [lit(text)]),
			`guides-${node.id}-${prop}`,
		);
	}

	/**
	 * Turning one setting into two — and for a grid this is the headline rather
	 * than a corner case. A count with two alternatives is twelve columns wide and
	 * six narrow, held in one document, with the solver free to choose between
	 * them and a rule free to decide which. The second alternative is a copy of
	 * the first, spelling and all, so a margin written in millimetres does not
	 * sprout a pixel twin.
	 */
	function splitGuide(prop: GuideProp) {
		onSceneChange((prev) =>
			setGuideValue(prev, node.id, prop, [
				...guideValue(prop),
				lit(storedGuide(prop)),
			]),
		);
	}

	function guideRow(prop: GuideProp) {
		const spec = GUIDE_PROPS[prop];
		const variable = guideVar(node.id, prop);
		const value: Value = guideValue(prop);
		return (
			<ValueEditor
				key={prop}
				testId={`guide-${prop}`}
				label={spec.label}
				type={spec.type}
				value={value}
				tokens={tokensOfType(scene, spec.type)}
				unit={unit}
				fallback={spec.fallback}
				names={names}
				active={picks[variable]}
				varying={varying.has(variable)}
				reachable={reach?.[variable]}
				pinned={pins[variable]}
				onPin={(index) => onPin(variable, index)}
				why={why?.(variable)}
				preview={(term: Term) => resolveValue(context, [term], variable)}
				onChange={(next) =>
					onSceneChange(
						(prev) => setGuideValue(prev, node.id, prop, next),
						`guides-${node.id}-${prop}`,
					)
				}
			/>
		);
	}

	/** The style this node wears, and what it does and does not decide for it. */
	const wears = styleOf(scene, node);
	const taken = wears ? wornProps(scene, node) : [];
	const offered = wears ? styleProps(wears) : [];

	/**
	 * One appearance property. Wearing a style puts it in one of three states,
	 * and the whole point is that they are told apart at a glance.
	 *
	 *   - **the style decides it.** The row is the style's variants, read-only:
	 *     what it holds is not this node's to type, and the alternatives are the
	 *     treatments rather than values. Everything that asks the *solver* a
	 *     question still works — which variant is live, which are ruled out,
	 *     pinning one, asking why — because those are questions about the answer
	 *     rather than about the document, which is the bargain a derived node's
	 *     row strikes too.
	 *   - **the node overrides it.** An ordinary editable row, marked as
	 *     overriding and with a way back. Deliberate in both directions: you
	 *     override by pressing a button, and that button is what says the style
	 *     stopped applying here.
	 *   - **neither.** The ordinary row, unchanged.
	 */
	function appearanceRow(prop: PropName) {
		const spec = PROPS[prop];
		const variable = propVar(node.id, prop);
		/**
		 * The two appearance rows the frozen DOM contract names by a role of their
		 * own — which primitive a mesh is, and which lamp a light is.
		 *
		 * They are otherwise entirely ordinary rows and get no special code: both
		 * are `Value`s over a closed menu, exactly as a `direction` is, so
		 * `ValueEditor` renders each as a `<select>` off `VALUE_TYPES[type].options`
		 * and `[box, sphere]` is two designs of one document with no help from
		 * here. The role is a handle for a query, not a behaviour — which is why it
		 * is a lookup rather than a branch, and why it goes on all three wrappers
		 * below: a mesh wearing a style still has a solid picker.
		 */
		const role = PROP_ROLES[prop];
		if (wears && taken.includes(prop)) {
			const svar = styleVar(wears.id);
			const at = picks[svar] ?? 0;
			return (
				<div key={prop} className={styles.styled} data-styled={prop} data-role={role}>
					<ValueEditor
						testId={prop}
						label={spec.label}
						type={spec.type}
						// The style's variants, in order, so the row says what the
						// treatments hold for this property and which is showing. A
						// variant silent about it draws nothing for it.
						value={wears.variants.map((v) => v.parts[prop] ?? lit(NOTHING))}
						readOnly
						tokens={tokensFor(scene, prop)}
						unit={unit}
						fallback={spec.fallback}
						names={names}
						active={picks[svar]}
						varying={varying.has(svar)}
						reachable={reach?.[svar]}
						pinned={pins[svar]}
						onPin={(index) => onPin(svar, index)}
						why={why?.(svar)}
						preview={(term: Term) => resolveValue(context, [term], svar)}
						onChange={() => {}}
					/>
					<div className={styles.styledFoot}>
						<span className={styles.styledBy}>from {wears.name}</span>
						<button
							type="button"
							className={styles.follow}
							data-role={`override-${prop}`}
							title={`Give this node its own ${spec.label.toLowerCase()}, starting at what ${wears.name} is showing`}
							onClick={() =>
								onSceneChange((prev) =>
									setProp(prev, [node.id], prop, [
										wears.variants[at]?.parts[prop] ?? lit(spec.fallback),
									]),
								)
							}
						>
							Override
						</button>
					</div>
				</div>
			);
		}
		const own = (
			<ValueEditor
				testId={prop}
				label={spec.label}
				type={spec.type}
				value={node.props[prop] ?? defaultValue(prop)}
				tokens={tokensFor(scene, prop)}
				unit={unit}
				fallback={spec.fallback}
				names={names}
				active={picks[variable]}
				varying={varying.has(variable)}
				reachable={reach?.[variable]}
				pinned={pins[variable]}
				onPin={(index) => onPin(variable, index)}
				why={why?.(variable)}
				preview={(term: Term) => resolveValue(context, [term], variable)}
				onChange={(next) =>
					onSceneChange(
						(prev) => setProp(prev, [node.id], prop, next),
						`prop-${node.id}-${prop}`,
					)
				}
			/>
		);
		if (!wears || !offered.includes(prop)) {
			return (
				<div key={prop} data-role={role}>
					{own}
				</div>
			);
		}
		return (
			<div key={prop} className={styles.overriding} data-overriding={prop} data-role={role}>
				{own}
				<div className={styles.styledFoot}>
					<span className={styles.styledBy}>overriding {wears.name}</span>
					<button
						type="button"
						className={styles.follow}
						data-role={`follow-style-${prop}`}
						title={`Hand this property back to ${wears.name}`}
						onClick={() =>
							onSceneChange((prev) => setProp(prev, [node.id], prop, undefined))
						}
					>
						Follow {wears.name}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className={styles.inspector} data-role="inspector">
			<input
				className={styles.name}
				value={node.name}
				data-role="node-name"
				onChange={(e) =>
					onSceneChange((prev) => renameNode(prev, node.id, e.target.value), "name")
				}
			/>

			{/* Before anything else, because it says what the selection *is*. An
			    instance whose panel opens on four number fields is an instance
			    nobody can tell from a frame. */}
			<ComponentSection
				scene={scene}
				node={node}
				picks={picks}
				reach={reach}
				onSceneChange={onSceneChange}
				onSelect={onSelectionChange}
			/>

			{/* Then what it *does*, which is the same kind of claim: an instance of a
			    component that behaves is not fully described by which variant it is
			    holding. Before the style section, because "which state is this drawn
			    in" changes what every row below it means. */}
			{ownMachine ? (
				<StateSection
					scene={scene}
					node={node}
					machine={ownMachine}
					picks={picks}
					playing={playing?.[node.id]}
					onSceneChange={onSceneChange}
					onPlay={onPlay}
					onSelect={onSelectionChange}
				/>
			) : null}

			{partOf ? (
				<StateDeltaSection
					scene={scene}
					node={node}
					machine={partOf.machine}
					def={partOf.def}
					state={authored}
					picks={picks}
					unit={unit}
					inDepth={inDepth}
					playing={playing}
					onEdit={setAuthoring}
					onPlay={onPlay}
					onSceneChange={onSceneChange}
				/>
			) : null}

			{/* Beside it, and for the same reason: "wearing Heading" is part of what
			    the selection is, and a panel that only said so forty rows down
			    beside `size` would be a panel that never said it. */}
			<StyleSection
				scene={scene}
				node={node}
				picks={picks}
				onSceneChange={onSceneChange}
			/>

			{/* The one place the state block reaches outside itself, and it earns the
			    trespass: with a state open above, every row from here down still
			    writes the definition, and a person who has just typed a colour into
			    a delta row is exactly the person about to type one into the row
			    below it. The block's own banner cannot say this, because this is a
			    statement about what is *not* in the block. */}
			{authored ? (
				<p className={styles.baseLine} data-role="base-note">
					Everything below is <strong>{partOf?.def.name}</strong> itself, not{" "}
					{authored.name} — shared by every state that says nothing.
				</p>
			) : null}

			<h3>Position</h3>
			{managed ? (
				<p className={styles.note} data-role="managed-note">
					Placed by the layout above. Size is what it asks for, not
					necessarily what it gets.
				</p>
			) : null}
			{/* The ordinary case: four numbers in a compact grid, each with a way to
			    turn itself into a decision — and the unit they are all read in,
			    beside them, because a number whose unit is elsewhere on the screen
			    is a number nobody trusts. The grid is never empty now: a node whose
			    four coordinates have all become decisions still has a unit. */}
			<div className={styles.grid}>
				{DIMENSIONS.filter(plainDimension).map((dim) => (
					<LengthField
						key={dim}
						label={dim}
						value={storedLength(dim)}
						unit={unit}
						pinned={dimensionPinned(dim)}
						disabled={dimensionPinned(dim)}
						// Splitting is offered even where the rules have settled the
						// coordinate: what a second alternative says is "these are two
						// designs", which is a question about the space rather than an
						// edit the solver has already answered.
						//
						// The second alternative is a copy of the literal, spelling and
						// all — the same thing the value row's own "+ Add value" does, and
						// what keeps a design in points from sprouting a pixel twin.
						onSplit={() =>
							onSceneChange((prev) =>
								setFrameValue(prev, [node.id], dim, [
									...node.frame[dim],
									lit(storedLength(dim)),
								]),
							)
						}
						onCommit={(text) => stateDimension(dim, text)}
					/>
				))}
				<UnitField unit={unit} onChange={changeUnit} />
			</div>

			{/* A dimension holding more than one number, or one that names a token,
			    gets the row every other value gets: the alternatives, which one this
			    universe is using, what the rules have ruled out, and a pin. This is
			    where "here on desktop, there on mobile" is written. */}
			{DIMENSIONS.filter((dim) => !plainDimension(dim)).map((dim) => {
				const variable = frameVar(node.id, dim);
				return (
					<ValueEditor
						key={dim}
						testId={`frame-${dim}`}
						label={FRAME_DIMS[dim].label}
						type={FRAME_DIMS[dim].type}
						value={node.frame[dim]}
						tokens={tokensOfType(scene, FRAME_DIMS[dim].type)}
						unit={unit}
						// What a third alternative starts at: where the node is now,
						// spelled in the document's unit, since a fallback has no
						// literal of its own to inherit a spelling from.
						fallback={formatLength(box[dim], unit)}
						names={names}
						active={picks[variable]}
						varying={varying.has(variable)}
						reachable={reach?.[variable]}
						pinned={pins[variable]}
						onPin={(index) => onPin(variable, index)}
						why={why?.(variable)}
						preview={(term: Term) => resolveValue(context, [term], variable)}
						onChange={(next) =>
							onSceneChange(
								(prev) => setFrameValue(prev, [node.id], dim, next),
								`frame-${node.id}-${dim}`,
							)
						}
					/>
				);
			})}

			{/* ---------------------------------------------------------------
			    The third axis. Everything from here to the end of the rotation
			    block is behind `inDepth`, and a document that has never heard of
			    three dimensions sees one quiet button where all of it would be —
			    which is the panel's half of the promise the whole feature is built
			    on. A viewport on page four puts *its own subtree* into three
			    dimensions, not the file, and not the inspector either.
			    --------------------------------------------------------------- */}
			{inDepth ? (
				<>
					<h3>Depth</h3>
					{spatialHere ? null : (
						<p className={styles.note} data-role="depth-note">
							{node.name} is flat: the document says nothing about where it sits
							in depth, and nothing here has changed that yet. Type a number and
							it joins the third axis — which is a real change, because from
							then on the file has a third axis in it.
						</p>
					)}
					<div className={styles.grid} data-role="spatial-fields">
						{SPATIALS.filter(plainSpatial).map((dim) => (
							<LengthField
								key={dim}
								label={SPATIAL_DIMS[dim].label}
								role={`spatial-${dim}`}
								value={storedSpatial(dim)}
								unit={unit}
								title={
									dim === "z"
										? "Where the node sits along the third axis. Positive is away from the viewer, matching the page's y-down."
										: "How deep the node is. A plane is a real solid with a depth of zero, so this is not clamped the way width and height are."
								}
								// A silence counts as the one alternative it draws as, so `+`
								// on a dimension the node does not hold yields *two* and not
								// one. Without that the first press on a flat node would look
								// like a button that did nothing: it would state a `z` of
								// zero — a real change to the document and no change to the
								// picture — and the row would still be a single number.
								onSplit={() =>
									onSceneChange((prev) =>
										setSpatialValue(prev, node.id, dim, [
											...(node.spatial?.[dim] ?? [lit(storedSpatial(dim))]),
											lit(storedSpatial(dim)),
										]),
									)
								}
								// Offered only where there is something to clear, so a node
								// that says nothing is not offered a way to say nothing.
								onClear={
									node.spatial?.[dim] === undefined
										? undefined
										: () =>
												onSceneChange((prev) => clearSpatial(prev, node.id, dim))
								}
								onCommit={(text) => stateSpatial(dim, text)}
							/>
						))}
					</div>
					{SPATIALS.filter((dim) => !plainSpatial(dim)).map(spatialRow)}

					<h3>Rotation</h3>
					<p className={styles.note} data-role="rotation-note">
						About the node’s own centre, in the fixed order Z then Y then X —
						which is both CSS’s and three.js’s, so the canvas and the exported
						file agree with no conversion. Turning about the centre is what keeps
						the centres exact: a rule may still be about {node.name}’s centre and
						its size, and may not be about its faces.
					</p>
					<div className={styles.props} data-role="turn-fields">
						{TURN_NAMES.map(turnRow)}
					</div>
				</>
			) : (
				<button
					type="button"
					className={styles.follow}
					data-role="show-depth"
					title="Show where this sits in depth and how it is turned. It writes nothing — a document with no third axis in it stays a document with no third axis in it until a number is typed."
					onClick={() => setDepthOpen(true)}
				>
					Depth and rotation…
				</button>
			)}

			{/* What a view looks through, which is the one setting a viewport has
			    that no other kind does — and it is a *fact* rather than a value,
			    the same call `gline/3`'s axis makes: which camera a view uses is
			    structure, not a design decision, so it is a select with one answer
			    and not a row with alternatives.

			    A dangling name is silence rather than repair, exactly as `vcam/2`
			    has it: the renderer frames the subtree itself and the panel says
			    so. That is what makes deleting a camera leave a legal document. */}
			{node.kind === "viewport" ? (
				<div data-role="viewport-section">
					<h3>View</h3>
					{cameras.length === 0 ? (
						<p className={styles.note} data-role="no-cameras">
							Nothing in this view is a camera, so the renderer frames whatever
							is inside it. Add a camera and this becomes a choice.
						</p>
					) : (
						<label
							className={cx(styles.field, styles.wide)}
							title="Which camera this view looks through. Hiding that camera stops drawing its marker and does not stop it looking — a layer that hid a camera must not blind the view it is the eye of."
						>
							<span className={styles.fieldLabel}>looks through</span>
							<select
								className={styles.number}
								data-role="look-through"
								value={node.camera ?? ""}
								onChange={(e) =>
									onSceneChange((prev) =>
										setViewportCamera(prev, node.id, e.target.value || null),
									)
								}
							>
								<option value="">Frame everything inside</option>
								{cameras.map((cam) => (
									<option key={cam.id} value={cam.id}>
										{cam.name}
									</option>
								))}
							</select>
						</label>
					)}
					{node.camera !== undefined && !looksThrough ? (
						<p className={styles.note} data-role="dangling-camera">
							It names “{node.camera}”, which is not a camera inside this view
							any more. Nothing is refused and nothing fails — the renderer
							frames the subtree itself, which is what deleting a camera is
							supposed to leave behind.
						</p>
					) : null}

					{/* What goes *in* a view, and it is here rather than in the toolbar
					    for the reason a viewport is drawn there and its contents are
					    not: the toolbar draws a rectangle on the page, and everything
					    below the seam is placed in the view's own space, in front of
					    its camera, by a verb that knows where that is. A pointer that
					    dragged a cube out on the page would be a pointer answering a
					    question — where in three dimensions? — that a 2D drag cannot
					    ask.

					    So they are buttons on the view, not tools, and each one is the
					    `edits.ts` verb of the same name: a solid lands on the origin
					    plane in shot, a camera becomes the one being looked through
					    when there is not one already, a lamp goes up and to the left
					    like a key light. Every one of them makes an ordinary node —
					    it is in the layer list, a rule can name it, it can be hidden,
					    and it takes part in the multiverse. */}
					<div className={styles.addRow} data-role="viewport-add">
						<span className={styles.fieldLabel}>add</span>
						<select
							className={styles.number}
							data-role="add-solid"
							aria-label="Add a solid"
							title="Put one of the six primitives in this view, on the origin plane and in front of the camera. Which primitive is a property with a value, so it can hold two alternatives like any other."
							value=""
							onChange={(e) => {
								const solid = e.target.value;
								if (!solid) return;
								onSceneChange((prev) => addMesh(prev, node.id, solid));
							}}
						>
							<option value="">Solid…</option>
							{(VALUE_TYPES.solid.options ?? []).map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<select
							className={styles.number}
							data-role="add-light"
							aria-label="Add a light"
							title="Put a lamp in this view. Its colour is ink — the colour the thing itself is — so a brand palette lights the scene with nothing wired up."
							value=""
							onChange={(e) => {
								const lamp = e.target.value;
								if (!lamp) return;
								onSceneChange((prev) => addLight(prev, node.id, lamp));
							}}
						>
							<option value="">Light…</option>
							{(VALUE_TYPES.lamp.options ?? []).map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<button
							type="button"
							className={styles.follow}
							data-role="add-camera"
							title="Another eye, where the first one is. It becomes the camera this view looks through only if the view has not got one — the first camera you add is obviously the one to look through, and the third obviously is not."
							onClick={() => onSceneChange((prev) => addCamera(prev, node.id))}
						>
							Camera
						</button>
					</div>
					{/* A pivot is not here, and its absence is a decision. `addPivot`
					    takes the objects to group, so it belongs on a *selection of
					    them* and not on the view — and the gesture a designer already
					    has for "put these together" is ⌘G. `Studio.tsx`'s `group()`
					    routes it: a selection of direct children of one viewport makes
					    a pivot, everything else makes a group, and the difference is
					    that a group re-fits to its children's box while the box of
					    rotated solids is exactly the trigonometry a linear solver
					    cannot do. */}
				</div>
			) : null}

			{/* Imported geometry, read out rather than edited. The vertices are not
			    in the document — a glTF is megabytes, the document is edited by two
			    people at once, and a blob here would be a blob in every diff, every
			    undo entry and every sync message — so what the node holds is the
			    hash, the box and the counts, and this shows exactly those.

			    **The relink affordance is not here, and that is a gap rather than a
			    decision.** `docs/merged-plan.md` M4's `AssetStore` does not exist in
			    the tree and neither does the app's implementation of it, so there is
			    nothing to relink *through*; a button that opened a file picker and
			    dropped the bytes on the floor would be worse than no button. The
			    triangle count is here because the budget rule reads it and a person
			    about to trip that rule should be able to see the number. */}
			{node.kind === "model" ? (
				<div data-role="model-section">
					<h3>Model</h3>
					{node.mesh ? (
						<>
							<p className={styles.note} data-role="mesh-ref">
								{node.mesh.source ?? "An imported mesh"} ·{" "}
								{node.mesh.format.toUpperCase()} ·{" "}
								{node.mesh.triangles.toLocaleString()} triangles. Its vertices
								live in the asset store, keyed by content hash, and never enter
								the document or the program — what a rule can be about is this
								node’s box and this count.
							</p>
							<div className={styles.resolved} data-resolved="asset">
								<span className={styles.fieldLabel}>asset</span>
								<span className={styles.resolvedValue}>{node.mesh.asset}</span>
							</div>
						</>
					) : (
						<p className={styles.note} data-role="no-mesh">
							Nothing imported yet, so this draws as its own box. The importer is
							not built — there is no asset store behind it — and until there is,
							a model is a placeholder with a real frame that rules can hold.
						</p>
					)}
				</div>
			) : null}

			{/* The refusal, said where the wondering happens. A rule that names a
			    turned node's face is not broken and does not fail: the quantity is
			    never minted, the relation is never stated, and the design comes back
			    looking exactly as if the rule were not there. Silence in ASP is
			    invisible, so this is the panel's half of `gnoedge/2` — read off
			    `spatial.ts`'s `inertConstraints`, which is the twin the program is
			    held equal to, and shown here as well as in the Rules panel because
			    the two answer different questions: that one is "which rules are
			    inert", this one is "why is nothing happening to the thing I have
			    selected". */}
			{inert.length > 0 ? (
				<div data-role="inert-rules">
					<h3>Rules that say nothing</h3>
					{inert.map((rule) => (
						<p
							key={rule.constraint}
							className={styles.refused}
							data-role="inert-rule"
							data-constraint={rule.constraint}
							data-culprit={rule.culprit}
						>
							<strong>{rule.constraint}</strong>{" "}
							<span data-role="refused-edge">{rule.why}</span>
						</p>
					))}
				</div>
			) : null}

			{isMeasured(node) ? (
				<div className={styles.grid}>
					<label className={styles.field}>
						<span className={styles.fieldLabel}>sizing</span>
						<select
							className={styles.number}
							data-role="text-sizing"
							value={sizingOf(node)}
							onChange={(e) =>
								onSceneChange((prev) =>
									setSizing(prev, [node.id], e.target.value as Sizing),
								)
							}
						>
							{SIZINGS.map((z) => (
								<option key={z} value={z}>
									{z === "hug" ? "auto" : "fixed"}
								</option>
							))}
						</select>
					</label>
				</div>
			) : null}

			{managed ? (
				<div className={styles.props}>
					{CHILD_PROPS.map((prop) => (
						<div key={prop}>
							{layoutRow(prop)}
							{/* A child's own say can be given up again; every other
							    value only ever has one. */}
							{layoutValueOf(node, prop) ? (
								<button
									type="button"
									className={styles.follow}
									data-role={`clear-layout-${prop}`}
									onClick={() =>
										onSceneChange((prev) =>
											setChildLayout(prev, [node.id], prop, undefined),
										)
									}
								>
									Follow the layout
								</button>
							) : null}
						</div>
					))}
				</div>
			) : null}

			{container ? (
				<>
					<h3>Layout</h3>
					<label className={styles.check}>
						<input
							type="checkbox"
							data-role="auto-layout"
							checked={node.layout !== undefined}
							onChange={(e) =>
								onSceneChange((prev) =>
									setLayout(
										prev,
										node.id,
										e.target.checked ? makeLayout() : undefined,
									),
								)
							}
						/>
						<span>Arrange children automatically</span>
					</label>

					{node.layout ? (
						<div className={styles.props}>
							{CONTAINER_PROPS.map((prop) => layoutRow(prop))}
						</div>
					) : null}
				</>
			) : null}

			{KINDS[node.kind].surface ? (
				<>
					<h3>Guides</h3>
					{/* Absence is off, so there is nothing to switch: a surface either
					    holds a grid or does not, and the checkbox is that field. A
					    one-track grid with no margins is indistinguishable from no
					    grid, so the degenerate case costs nothing and there is no
					    "enabled" flag to keep in step with the settings under it.

					    Turning it off prunes the rules that were holding something to
					    a column of it — see `setGuides`. */}
					<label className={styles.check}>
						<input
							type="checkbox"
							data-role="rule-guides"
							checked={isGridded(node)}
							onChange={(e) =>
								onSceneChange((prev) =>
									setGuides(
										prev,
										node.id,
										e.target.checked ? makeGuides() : undefined,
									),
								)
							}
						/>
						<span>Rule this surface with margins and a grid</span>
					</label>

					{isGridded(node) ? (
						<>
							{/* What the numbers below are *for*, said once. A grid here is
							    not a drawing aid: every line it implies is a place a rule
							    can name, so a card held to column three is still held to it
							    when the count changes. */}
							<p className={styles.note} data-role="guides-note">
								Where the lines fall is the solver's answer to these numbers,
								and each one is a place a rule can hold something to — pin a
								card to column three and it stays there when the count changes.
								None of it is part of the design, so none of it is exported.
							</p>

							{/* The live area, in the same compact grid the position fields
							    use, and labelled with the same one-word edges: a margin and
							    an edge are the same end of the same axis. */}
							<div className={styles.grid} data-role="guide-margins">
								{MARGIN_FIELDS.filter(plainGuide).map((prop) => (
									<LengthField
										key={prop}
										label={guideFieldLabel(prop)}
										value={storedGuide(prop)}
										unit={unit}
										onSplit={() => splitGuide(prop)}
										onCommit={(text) => stateGuide(prop, text)}
									/>
								))}
							</div>

							{/* Then the tracks, an axis to a line: how many, and how far
							    apart. A count is a spinner and a gutter is a length, which
							    is the `count`/`length` split in the value table showing
							    through to the two controls it was added to make possible. */}
							<div className={styles.grid} data-role="guide-tracks">
								{TRACK_FIELDS.filter(plainGuide).map((prop) =>
									GUIDE_PROPS[prop].role === "count" ? (
										<CountField
											key={prop}
											label={guideFieldLabel(prop)}
											value={storedGuide(prop)}
											onSplit={() => splitGuide(prop)}
											onCommit={(text) => stateGuide(prop, text)}
										/>
									) : (
										<LengthField
											key={prop}
											label={guideFieldLabel(prop)}
											value={storedGuide(prop)}
											unit={unit}
											onSplit={() => splitGuide(prop)}
											onCommit={(text) => stateGuide(prop, text)}
										/>
									),
								)}
							</div>

							{/* And anything that has stopped being one number — a margin that
							    names the page's spacing token, a count with two alternatives
							    — gets the row every other value gets, in the table's own
							    order. This is where a responsive grid is read and pinned. */}
							<div className={styles.props}>
								{GUIDE_PROP_NAMES.filter((prop) => !plainGuide(prop)).map(
									guideRow,
								)}
							</div>
						</>
					) : null}
				</>
			) : null}

			{KINDS[node.kind].props.length > 0 ? <h3>Appearance</h3> : null}
			<div className={styles.props}>
				{KINDS[node.kind].props.map(appearanceRow)}
			</div>
		</div>
	);
}
