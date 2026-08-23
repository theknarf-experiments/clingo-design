import {
	CONSTRAINT_KINDS,
	CONSTRAINT_NAMES,
	type Constraint,
	type ConstraintKind,
	type ConstraintSpec,
	EDGES,
	type Edge,
	PROPS,
	type PropName,
	type Scene,
	addConstraint,
	constraintValue,
	deleteConstraint,
	dimension,
	findInTree,
	ref,
	retargetConstraint,
	sharedProps,
	termLabel,
	tokensOfType,
	updateConstraint,
} from "@clingo-design/design-core";

import styles from "./Constraints.module.css";
import { cx } from "./cx";

export interface ConstraintsProps {
	scene: Scene;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	selection: ReadonlySet<string>;
	/** Constraint ids the solver blamed for an impossible document. */
	conflict: ReadonlySet<string>;
	/** Select the nodes a constraint ranges over, so it can be seen. */
	onSelectionChange: (ids: string[]) => void;
}

/**
 * The number a `gap`, a `pin` or a mirror line holds to — typed in, or driven
 * by a variable.
 *
 * Driving it is the whole of what makes a dimension parametric: there is no
 * second kind of parameter, only the same token a fill could have named. Point
 * three lengths at it and the multiverse becomes a configuration table.
 *
 * The row edits one alternative, deliberately: the branching that is worth
 * having lives on the *token*, where every place that references it moves
 * together. The document can hold more, and the solver would pick between
 * them, but a rule with private alternatives is a rule nobody can find.
 */
function Dimension({
	scene,
	constraint,
	spec,
	onSceneChange,
}: {
	scene: Scene;
	constraint: Constraint;
	spec: ConstraintSpec;
	onSceneChange: ConstraintsProps["onSceneChange"];
}) {
	if (!spec.valueType) return null;
	const term = constraint.value?.[0];
	// What it comes to right now. Without a universe in hand this is the
	// token's first alternative, which is what the canvas would show anyway.
	const resolved = constraintValue(scene, constraint);
	const driven = term !== undefined && term.kind !== "literal";

	return (
		<>
			{driven ? (
				<span
					className={styles.driven}
					data-role="constraint-driver"
					title="Driven by a variable"
				>
					{termLabel(scene.tokens, term)}
					<span className={styles.resolved}>
						{resolved === undefined ? "?" : resolved}
					</span>
				</span>
			) : (
				<input
					type="number"
					className={styles.limit}
					data-role="constraint-value"
					value={resolved ?? 0}
					title="Pixels"
					onChange={(e) =>
						onSceneChange(
							(prev) =>
								updateConstraint(prev, constraint.id, {
									value: dimension(Number(e.target.value) || 0),
								}),
							`constraint-value:${constraint.id}`,
						)
					}
				/>
			)}
			<select
				className={styles.link}
				data-role="constraint-value-link"
				title="Hold a number, or let a variable drive it"
				value={driven && term.kind === "token" ? `ref:${term.token}` : ""}
				onChange={(e) => {
					const link = /^ref:(.+)$/.exec(e.target.value);
					onSceneChange((prev) =>
						updateConstraint(prev, constraint.id, {
							// Dropping a link keeps the number it was resolving to, so
							// nothing jumps at the moment of unlinking.
							value: link ? [ref(link[1])] : dimension(resolved ?? 0),
						}),
					);
				}}
			>
				<option value="">px</option>
				{tokensOfType(scene, spec.valueType).map((t) => (
					<option key={t.id} value={`ref:${t.id}`}>
						{t.name}
					</option>
				))}
			</select>
		</>
	);
}

/**
 * Rules the design must obey.
 *
 * This is what makes the multiverse a design *space* rather than the cross
 * product of everything typed into the property rows: a constraint removes
 * combinations that are legal to write but wrong to ship. When two of them
 * cannot both hold, the solver names the culprits and they are marked here —
 * which is the one thing a hand-rolled variant generator could never do.
 *
 * The geometric kinds are the same machinery pointed at where a node *is*:
 * naming one in a rule hands its frame to the solver, and a contradiction
 * between two of them comes back as a core exactly like a contradiction
 * between two colour rules.
 */
export function Constraints({
	scene,
	onSceneChange,
	selection,
	conflict,
	onSelectionChange,
}: ConstraintsProps) {
	const selected = [...selection];
	const available = sharedProps(scene, selected);

	/**
	 * A property rule also needs something to talk *about*; a geometric one
	 * always has geometry to talk about, so it only needs enough members.
	 */
	const offered = (kind: ConstraintKind): boolean => {
		const spec = CONSTRAINT_KINDS[kind];
		if (selected.length < spec.minNodes) return false;
		return spec.geometric || available.length > 0;
	};
	const canAdd = CONSTRAINT_NAMES.some(offered);

	const nameOf = (id: string) => findInTree(scene.nodes, id)?.name ?? id;

	/** A driven dimension reads as the variable's name, not as today's number. */
	function dimensionOf(c: Constraint): string {
		const term = c.value?.[0];
		if (term && term.kind !== "literal") return termLabel(scene.tokens, term);
		return `${constraintValue(scene, c) ?? 0}px`;
	}

	function describe(c: Constraint): string {
		const spec = CONSTRAINT_KINDS[c.kind];
		return spec.summary
			.replace("{prop}", PROPS[c.prop].label.toLowerCase())
			.replace("{n}", String(c.limit ?? 1))
			.replace("{edge}", (EDGES[c.edge ?? "left"].label ?? "").toLowerCase())
			.replace("{v}", dimensionOf(c));
	}

	return (
		<div className={styles.constraints} data-role="constraints">
			<div className={styles.head}>
				<span className={styles.hint}>
					Rules the design must obey. Select layers to add one.
				</span>
				<select
					className={styles.add}
					data-role="add-constraint"
					value=""
					disabled={!canAdd}
					title={
						canAdd
							? "Constrain the selected layers"
							: "Select layers that share a property, or two to relate by geometry"
					}
					onChange={(e) => {
						const kind = e.target.value as ConstraintKind;
						if (!kind) return;
						onSceneChange((prev) => addConstraint(prev, kind, selected).scene);
					}}
				>
					<option value="">+ New</option>
					{CONSTRAINT_NAMES.map((kind) => (
						<option key={kind} value={kind} disabled={!offered(kind)}>
							{CONSTRAINT_KINDS[kind].label}
						</option>
					))}
				</select>
			</div>

			{conflict.size > 0 ? (
				<p className={styles.conflict} data-role="conflict">
					{conflict.size === 1
						? "This rule cannot hold. Turn it off, or widen a property so there are more values to go around."
						: `These ${conflict.size} rules cannot all hold at once. Turn one off, or widen a property so there are more values to go around.`}
				</p>
			) : null}

			{scene.constraints.length === 0 ? (
				<p className={styles.empty}>
					No rules yet — every combination of your values is allowed.
				</p>
			) : null}

			{scene.constraints.map((c) => {
				const spec = CONSTRAINT_KINDS[c.kind];
				const props = sharedProps(scene, c.nodes);
				return (
					<div
						key={c.id}
						className={cx(
							styles.rule,
							conflict.has(c.id) && styles.blamed,
							!c.enabled && styles.off,
						)}
						data-constraint={c.id}
						data-blamed={conflict.has(c.id) ? "" : undefined}
					>
						<div className={styles.ruleHead}>
							<input
								type="checkbox"
								className={styles.toggle}
								data-role="toggle-constraint"
								checked={c.enabled}
								title="Switch this rule off without deleting it"
								onChange={(e) =>
									onSceneChange((prev) =>
										updateConstraint(prev, c.id, { enabled: e.target.checked }),
									)
								}
							/>
							<select
								className={styles.kind}
								data-role="constraint-kind"
								value={c.kind}
								onChange={(e) =>
									// Not `updateConstraint`: a new kind reads different
									// fields, and they have to be measured off the design
									// rather than defaulted to zero.
									onSceneChange((prev) =>
										retargetConstraint(prev, c.id, {
											kind: e.target.value as ConstraintKind,
										}),
									)
								}
							>
								{CONSTRAINT_NAMES.map((kind) => (
									<option key={kind} value={kind}>
										{CONSTRAINT_KINDS[kind].label}
									</option>
								))}
							</select>

							{spec.counted ? (
								<input
									type="number"
									className={styles.limit}
									data-role="constraint-limit"
									min={1}
									max={Math.max(1, c.nodes.length)}
									value={c.limit ?? 1}
									onChange={(e) =>
										onSceneChange((prev) =>
											updateConstraint(prev, c.id, {
												limit: Math.max(1, Number(e.target.value) || 1),
											}),
										)
									}
								/>
							) : null}

							{spec.geometric ? (
								<select
									className={styles.prop}
									data-role="constraint-edge"
									value={c.edge ?? spec.edges[0]}
									onChange={(e) =>
										onSceneChange((prev) =>
											retargetConstraint(prev, c.id, {
												edge: e.target.value as Edge,
											}),
										)
									}
								>
									{spec.edges.map((edge) => (
										<option key={edge} value={edge}>
											{EDGES[edge].label}
										</option>
									))}
								</select>
							) : (
								<select
									className={styles.prop}
									data-role="constraint-prop"
									value={c.prop}
									onChange={(e) =>
										onSceneChange((prev) =>
											updateConstraint(prev, c.id, {
												prop: e.target.value as PropName,
											}),
										)
									}
								>
									{(props.length > 0 ? props : [c.prop]).map((prop) => (
										<option key={prop} value={prop}>
											{PROPS[prop].label}
										</option>
									))}
								</select>
							)}

							<Dimension
								scene={scene}
								constraint={c}
								spec={spec}
								onSceneChange={onSceneChange}
							/>

							<button
								type="button"
								className={styles.delete}
								data-role="delete-constraint"
								title="Delete this rule"
								onClick={() =>
									onSceneChange((prev) => deleteConstraint(prev, c.id))
								}
							>
								×
							</button>
						</div>

						<button
							type="button"
							className={styles.members}
							data-role="constraint-members"
							title="Select these layers"
							onClick={() => onSelectionChange(c.nodes)}
						>
							{c.nodes.map(nameOf).join(", ")} {describe(c)}
						</button>
					</div>
				);
			})}
		</div>
	);
}
