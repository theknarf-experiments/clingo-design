import {
	KINDS,
	PROPS,
	type Picks,
	type Scene,
	type SceneNode,
	type Term,
	defaultValue,
	findInTree,
	nodeNames,
	propValues,
	propVar,
	renameNode,
	resolveValue,
	setFrame,
	setProp,
	setText,
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
}

const AXES = ["x", "y", "width", "height"] as const;

function NumberField({
	label,
	value,
	onChange,
}: {
	label: string;
	value: number;
	onChange: (next: number) => void;
}) {
	return (
		<label className={styles.field}>
			<span className={styles.fieldLabel}>{label}</span>
			<input
				type="number"
				className={styles.number}
				value={Math.round(value)}
				data-field={label}
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
			<div className={styles.grid}>
				{AXES.map((axis) => (
					<NumberField
						key={axis}
						label={axis}
						value={node.frame[axis]}
						onChange={(next) =>
							onSceneChange(
								(prev) => setFrame(prev, node.id, { ...node.frame, [axis]: next }),
								`frame-${axis}`,
							)
						}
					/>
				))}
			</div>

			{node.kind === "text" ? (
				<>
					<h3>Content</h3>
					<textarea
						className={styles.text}
						value={node.text ?? ""}
						data-role="node-text"
						onChange={(e) =>
							onSceneChange((prev) => setText(prev, node.id, e.target.value), "text")
						}
					/>
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
