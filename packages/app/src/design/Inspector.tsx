import {
	type Align,
	type Direction,
	type Justify,
	type Sizing,
	JUSTIFICATIONS,
	KINDS,
	PROPS,
	type Picks,
	type Scene,
	type SceneNode,
	type Term,
	DEFAULT_LAYOUT,
	type Freedom,
	defaultValue,
	findInTree,
	isPinned,
	isMeasured,
	managedNodes,
	nodeNames,
	propValues,
	setAlignSelf,
	setGrow,
	setLayout,
	setSizing,
	sizingOf,
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
}

const AXES = ["x", "y", "width", "height"] as const;
const DIRECTIONS: Direction[] = ["row", "column"];
const ALIGNMENTS: Align[] = ["start", "center", "end", "stretch"];
const SIZINGS: Sizing[] = ["hug", "fixed"];
const JUSTIFY = Object.keys(JUSTIFICATIONS) as Justify[];

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
}: InspectorProps) {
	const selected = [...selection]
		.map((id) => findInTree(scene.nodes, id))
		.filter((n): n is SceneNode => n !== undefined);

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
				<>
					<label className={styles.check}>
						<input
							type="checkbox"
							data-role="grow"
							checked={node.grow ?? false}
							onChange={(e) =>
								onSceneChange((prev) => setGrow(prev, [node.id], e.target.checked))
							}
						/>
						<span>Fill the leftover space</span>
					</label>
					<div className={styles.grid}>
						<label className={`${styles.field} ${styles.wide}`}>
							<span className={styles.fieldLabel}>align self</span>
							<select
								className={styles.number}
								data-role="align-self"
								value={node.alignSelf ?? ""}
								onChange={(e) =>
									onSceneChange((prev) =>
										setAlignSelf(
											prev,
											[node.id],
											(e.target.value || undefined) as Align | undefined,
										),
									)
								}
							>
								<option value="">as the layout says</option>
								{ALIGNMENTS.map((a) => (
									<option key={a} value={a}>
										{a}
									</option>
								))}
							</select>
						</label>
					</div>
				</>
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
										e.target.checked ? { ...DEFAULT_LAYOUT } : undefined,
									),
								)
							}
						/>
						<span>Arrange children automatically</span>
					</label>

					{node.layout ? (
						<div className={styles.grid}>
							<label className={styles.field}>
								<span className={styles.fieldLabel}>flow</span>
								<select
									className={styles.number}
									data-role="layout-direction"
									value={node.layout.direction}
									onChange={(e) =>
										onSceneChange((prev) =>
											updateLayout(prev, node.id, {
												direction: e.target.value as Direction,
											}),
										)
									}
								>
									{DIRECTIONS.map((d) => (
										<option key={d} value={d}>
											{d}
										</option>
									))}
								</select>
							</label>
							<label className={styles.field}>
								<span className={styles.fieldLabel}>size</span>
								<select
									className={styles.number}
									data-role="layout-sizing"
									value={node.layout.sizing}
									onChange={(e) =>
										onSceneChange((prev) =>
											updateLayout(prev, node.id, {
												sizing: e.target.value as Sizing,
											}),
										)
									}
								>
									{SIZINGS.map((z) => (
										<option key={z} value={z}>
											{z === "hug" ? "hug contents" : "fixed"}
										</option>
									))}
								</select>
							</label>
							<label className={styles.field}>
								<span className={styles.fieldLabel}>align</span>
								<select
									className={styles.number}
									data-role="layout-align"
									value={node.layout.align}
									onChange={(e) =>
										onSceneChange((prev) =>
											updateLayout(prev, node.id, {
												align: e.target.value as Align,
											}),
										)
									}
								>
									{ALIGNMENTS.map((a) => (
										<option key={a} value={a}>
											{a}
										</option>
									))}
								</select>
							</label>
							<label className={styles.field}>
								<span className={styles.fieldLabel}>justify</span>
								<select
									className={styles.number}
									data-role="layout-justify"
									value={node.layout.justify}
									onChange={(e) =>
										onSceneChange((prev) =>
											updateLayout(prev, node.id, {
												justify: e.target.value as Justify,
											}),
										)
									}
								>
									{JUSTIFY.map((j) => (
										<option key={j} value={j}>
											{JUSTIFICATIONS[j]}
										</option>
									))}
								</select>
							</label>
							<NumberField
								label="gap"
								value={node.layout.gap}
								onChange={(gap) =>
									onSceneChange(
										(prev) => updateLayout(prev, node.id, { gap }),
										`gap-${node.id}`,
									)
								}
							/>
							<NumberField
								label="padding"
								value={node.layout.padding}
								onChange={(padding) =>
									onSceneChange(
										(prev) => updateLayout(prev, node.id, { padding }),
										`pad-${node.id}`,
									)
								}
							/>
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
