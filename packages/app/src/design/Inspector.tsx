import {
	CHILD_PROPS,
	type DerivedNode,
	CONTAINER_PROPS,
	DIMENSIONS,
	type Dimension,
	FRAME_DIMS,
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
	isPinned,
	isMeasured,
	lit,
	layoutValueOf,
	layoutVar,
	layoutWord,
	makeLayout,
	managedNodes,
	nodeNames,
	parentOf,
	propValues,
	setChildLayout,
	setLayout,
	setSizing,
	single,
	sizingOf,
	tokensOfType,
	updateLayout,
	propVar,
	renameNode,
	resolveValue,
	setFrame,
	setFrameValue,
	setProp,
	tokensFor,
	varies,
	type ComponentDef,
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
} from "@clingo-design/design-core";

import { ValueEditor } from "./ValueEditor";
import { cx } from "./cx";
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

function NumberField({
	label,
	value,
	onChange,
	onSplit,
	disabled,
	pinned,
}: {
	label: string;
	value: number;
	onChange: (next: number) => void;
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
			<input
				type="number"
				className={styles.number}
				value={Math.round(value)}
				data-field={label}
				disabled={disabled}
				onChange={(e) => {
					const next = Number(e.target.value);
					if (Number.isFinite(next)) onChange(next);
				}}
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
}: {
	id: string;
	/** Absent when the universe on screen does not have this node. */
	node: ModelNode | undefined;
	parent: string | null;
	everywhere: boolean;
	/** Variables a rule minted, by key — see `ModelScene.variables`. */
	variables: Readonly<Record<string, readonly ModelAlternative[]>>;
	picks: Picks;
	reach?: Readonly<Record<string, Set<number>>>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
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
				fallback={spec.fallback}
				active={picks[variable]}
				varying={(reachable?.size ?? alternatives.length) > 1}
				reachable={reachable}
				pinned={pins[variable]}
				onPin={(index) => onPin(variable, index)}
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
								<input
									type="number"
									className={styles.number}
									data-field={axis}
									value={Math.round(node.frame[axis])}
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
	const chosen = isInstance
		? variants.findIndex((v) =>
				open.every((o) => node.holds?.[o.variable] === v.picks[o.variable]),
			)
		: -1;
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
					more than one value.
				</p>
			)}

			<VariantStrip
				def={real}
				variants={variants}
				truncated={truncated}
				shown={shown}
				chosen={isInstance && chosen >= 0 ? chosen : undefined}
				onChoose={
					isInstance
						? (at) =>
								onSceneChange((prev) => setVariant(prev, node.id, variants[at].picks))
						: undefined
				}
			/>

			{isInstance ? (
				<>
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

					{open.length > 0 ? <h3>Overrides</h3> : null}
					{open.map((v) => {
						const variable = instanceVariable(node.id, v.node.id, v.prop);
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
														: "Hold this instance at this value"
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
				</>
			) : (
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
	derived = [],
	known,
	everywhere,
	variables = {},
	onSelectionChange,
}: InspectorProps) {
	const selected = [...selection]
		.map((id) => findInTree(scene.nodes, id))
		.filter((n): n is SceneNode => n !== undefined);

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
			</div>
		);
	}

	if (selected.length > 1) {
		return (
			<div className={styles.inspector} data-role="inspector">
				<h2>{selected.length} selected</h2>
				<p className={styles.empty}>
					Move them together, or select one to edit its properties.
				</p>
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
				fallback={spec.fallback}
				names={names}
				active={picks[variable]}
				varying={varying.has(variable)}
				reachable={reach?.[variable]}
				pinned={pins[variable]}
				onPin={(index) => onPin(variable, index)}
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

			<h3>Position</h3>
			{managed ? (
				<p className={styles.note} data-role="managed-note">
					Placed by the layout above. Size is what it asks for, not
					necessarily what it gets.
				</p>
			) : null}
			{/* The ordinary case: four numbers in a compact grid, each with a way to
			    turn itself into a decision. Empty only when all four have become
			    one, and then it would be a gap in the panel. */}
			{DIMENSIONS.some(plainDimension) ? (
			<div className={styles.grid}>
				{DIMENSIONS.filter(plainDimension).map((dim) => (
					<NumberField
						key={dim}
						label={dim}
						value={box[dim]}
						pinned={dimensionPinned(dim)}
						disabled={dimensionPinned(dim)}
						// Splitting is offered even where the rules have settled the
						// coordinate: what a second alternative says is "these are two
						// designs", which is a question about the space rather than an
						// edit the solver has already answered.
						onSplit={() =>
							onSceneChange((prev) =>
								setFrameValue(prev, [node.id], dim, [
									...node.frame[dim],
									lit(`${box[dim]}px`),
								]),
							)
						}
						onChange={(next) =>
							onSceneChange(
								(prev) => setFrame(prev, node.id, { ...box, [dim]: next }, picks),
								`frame-${dim}`,
							)
						}
					/>
				))}
			</div>
			) : null}

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
						fallback={`${box[dim]}px`}
						names={names}
						active={picks[variable]}
						varying={varying.has(variable)}
						reachable={reach?.[variable]}
						pinned={pins[variable]}
						onPin={(index) => onPin(variable, index)}
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

			{KINDS[node.kind].props.length > 0 ? <h3>Appearance</h3> : null}
			<div className={styles.props}>
				{KINDS[node.kind].props.map((prop) => {
					const spec = PROPS[prop];
					const variable = propVar(node.id, prop);
					const value = node.props[prop] ?? defaultValue(prop);
					return (
						<ValueEditor
							key={prop}
							testId={prop}
							label={spec.label}
							type={spec.type}
							value={value}
							tokens={tokensFor(scene, prop)}
							fallback={spec.fallback}
							names={names}
							active={picks[variable]}
							varying={varying.has(variable)}
							reachable={reach?.[variable]}
							pinned={pins[variable]}
							onPin={(index) => onPin(variable, index)}
							preview={(term: Term) =>
								resolveValue(context, [term], variable)
							}
							onChange={(next) =>
								onSceneChange(
									(prev) => setProp(prev, [node.id], prop, next),
									`prop-${node.id}-${prop}`,
								)
							}
						/>
					);
				})}
			</div>
		</div>
	);
}
