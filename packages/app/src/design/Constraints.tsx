import {
	CONSTRAINT_KINDS,
	CONSTRAINT_NAMES,
	type Constraint,
	type ConstraintKind,
	EDGES,
	type Edge,
	PROPS,
	type PropName,
	type Scene,
	addConstraint,
	deleteConstraint,
	findInTree,
	retargetConstraint,
	sharedProps,
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

	function describe(c: Constraint): string {
		const spec = CONSTRAINT_KINDS[c.kind];
		return spec.summary
			.replace("{prop}", PROPS[c.prop].label.toLowerCase())
			.replace("{n}", String(c.limit ?? 1))
			.replace("{edge}", (EDGES[c.edge ?? "left"].label ?? "").toLowerCase())
			.replace("{v}", `${c.value ?? 0}px`);
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
					These {conflict.size} rules cannot all hold at once. Turn one off, or
					widen a property so there are more values to go around.
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

							{spec.valued ? (
								<input
									type="number"
									className={styles.limit}
									data-role="constraint-value"
									value={c.value ?? 0}
									title="Pixels"
									onChange={(e) =>
										onSceneChange(
											(prev) =>
												updateConstraint(prev, c.id, {
													value: Math.round(Number(e.target.value) || 0),
												}),
											`constraint-value:${c.id}`,
										)
									}
								/>
							) : null}

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
