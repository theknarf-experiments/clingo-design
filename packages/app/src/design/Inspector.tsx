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
	type Value,
	type Freedom,
	defaultValue,
	findInTree,
	flatten,
	frameFrozen,
	frameOf,
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
} from "@clingo-design/design-core";

import { NOTHING } from "./Styles";
import { LengthInput, ValueEditor, type WhyRow } from "./ValueEditor";
import { cx } from "./cx";
import {
	MARGIN_FIELDS,
	TRACK_FIELDS,
	guideFieldLabel,
} from "./guideFields";
import { documentUnit, shownEmu } from "./lengths";
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
}

const SIZINGS: Sizing[] = ["hug", "fixed"];

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
	value,
	unit,
	onCommit,
	onSplit,
	disabled,
	pinned,
}: {
	label: string;
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
	disabled?: boolean;
	/** The rules leave this coordinate one legal value; there is no choice. */
	pinned?: boolean;
}) {
	return (
		<label
			className={pinned ? `${styles.field} ${styles.pinned}` : styles.field}
			data-pinned={pinned ? "" : undefined}
			title={pinned ? "The rules leave this one value" : undefined}
		>
			<span className={styles.fieldLabel}>{label}</span>
			<LengthInput
				className={styles.number}
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
}: InspectorProps) {
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
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	const names = nodeNames(scene.nodes);
	/** Where the node actually is, in the universe on screen. */
	const box = frameOf(node, context);

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
		if (wears && taken.includes(prop)) {
			const svar = styleVar(wears.id);
			const at = picks[svar] ?? 0;
			return (
				<div key={prop} className={styles.styled} data-styled={prop}>
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
		if (!wears || !offered.includes(prop)) return <div key={prop}>{own}</div>;
		return (
			<div key={prop} className={styles.overriding} data-overriding={prop}>
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

			{/* Beside it, and for the same reason: "wearing Heading" is part of what
			    the selection is, and a panel that only said so forty rows down
			    beside `size` would be a panel that never said it. */}
			<StyleSection
				scene={scene}
				node={node}
				picks={picks}
				onSceneChange={onSceneChange}
			/>

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
