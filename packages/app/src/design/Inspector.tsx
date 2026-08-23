import {
	CHILD_PROPS,
	type DerivedNode,
	CONTAINER_PROPS,
	LAYOUT_PROPS,
	type LayoutProp,
	type Sizing,
	KINDS,
	PROPS,
	type ModelNode,
	type Picks,
	type Scene,
	type SceneNode,
	type Term,
	type Value,
	type Freedom,
	defaultValue,
	findInTree,
	isPinned,
	isMeasured,
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
	setProp,
	tokensFor,
} from "@clingo-design/design-core";

import { ValueEditor } from "./ValueEditor";
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
}

const AXES = ["x", "y", "width", "height"] as const;
const SIZINGS: Sizing[] = ["hug", "fixed"];

function NumberField({
	label,
	value,
	onChange,
	disabled,
	pinned,
}: {
	label: string;
	value: number;
	onChange: (next: number) => void;
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
		</label>
	);
}

/**
 * What a node a rule derived amounts to — read-only, and saying why.
 *
 * The analogy that makes this bearable is a spreadsheet: a typed cell and a
 * formula cell sit side by side and behave completely differently, and the
 * whole of what keeps that usable is that you can always tell which is which.
 * So this panel looks like the inspector and is inert everywhere the inspector
 * is live: the name is the ASP term, the geometry is what the answer set said,
 * and every property is the text the node actually drew with.
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
}: {
	id: string;
	/** Absent when the universe on screen does not have this node. */
	node: ModelNode | undefined;
	parent: string | null;
	everywhere: boolean;
}) {
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
						{AXES.map((axis) => (
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

					{Object.keys(node.rendered).length > 0 ? <h3>Resolved</h3> : null}
					<div className={styles.props}>
						{KINDS[node.kind].props.map((prop) => {
							const value = node.rendered[prop];
							if (value === undefined) return null;
							return (
								<div
									key={prop}
									className={styles.resolved}
									data-resolved={prop}
								>
									<span className={styles.fieldLabel}>{PROPS[prop].label}</span>
									<span className={styles.resolvedValue}>{value}</span>
								</div>
							);
						})}
					</div>
				</>
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

			<h3>Position</h3>
			{managed ? (
				<p className={styles.note} data-role="managed-note">
					Placed by the layout above. Size is what it asks for, not
					necessarily what it gets.
				</p>
			) : null}
			<div className={styles.grid}>
				{AXES.map((axis) => {
					// The probe is the authority wherever it has spoken: a field is
					// dead when the rules leave the coordinate one value, and live
					// otherwise — even for a coordinate the solver decides, because
					// the stored number is what that coordinate is pulled toward.
					// Until it lands, the document's own coarser answer stands in:
					// a layout places its children, and a size the solver worked out
					// is not a size to type into.
					const probed = freedom[node.id]?.[axis];
					const pinned = probed
						? isPinned(probed)
						: (managed && (axis === "x" || axis === "y")) ||
							(axis === "width" && sizedBySolver.width) ||
							(axis === "height" && sizedBySolver.height);
					return (
						<NumberField
							key={axis}
							label={axis}
							value={node.frame[axis]}
							pinned={pinned}
							disabled={pinned}
							onChange={(next) =>
								onSceneChange(
									(prev) =>
										setFrame(prev, node.id, { ...node.frame, [axis]: next }),
									`frame-${axis}`,
								)
							}
						/>
					);
				})}
			</div>

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
