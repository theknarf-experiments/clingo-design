import {
	FALLBACK,
	VALUE_TYPE_LABEL,
	type Picks,
	type Scene,
	type Term,
	type ValueType,
	addToken,
	deleteToken,
	propValues,
	renameToken,
	resolveValue,
	setTokenValue,
	tokenVar,
} from "@clingo-design/design-core";

import { ValueEditor } from "./ValueEditor";
import styles from "./Variables.module.css";

export interface VariablesProps {
	scene: Scene;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	picks: Picks;
	varying: ReadonlySet<string>;
}

const TYPES = Object.keys(FALLBACK) as ValueType[];

/**
 * Named values, referenced from anywhere — CSS custom properties, essentially.
 *
 * A token has no multiplicity of its own beyond what its *value* holds: give
 * it two alternatives and every reference branches together. That is the
 * difference from a per-reference list, which branches independently.
 */
export function Variables({
	scene,
	onSceneChange,
	picks,
	varying,
}: VariablesProps) {
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };

	return (
		<div className={styles.variables} data-role="variables">
			<div className={styles.head}>
				<span className={styles.hint}>
					Named values, referenced from anywhere.
				</span>
				<select
					className={styles.add}
					data-role="add-token"
					value=""
					onChange={(e) => {
						const type = e.target.value as ValueType;
						if (!type) return;
						onSceneChange((prev) => addToken(prev, type).scene);
					}}
				>
					<option value="">+ New</option>
					{TYPES.map((type) => (
						<option key={type} value={type}>
							{VALUE_TYPE_LABEL[type]}
						</option>
					))}
				</select>
			</div>

			{scene.tokens.length === 0 ? (
				<p className={styles.empty}>No variables yet.</p>
			) : null}

			{scene.tokens.map((token) => {
				const variable = tokenVar(token.id);
				// A token may link to other tokens, but never to itself.
				const linkable = scene.tokens.filter(
					(t) => t.type === token.type && t.id !== token.id,
				);
				return (
					<div className={styles.token} key={token.id} data-token={token.id}>
						<div className={styles.tokenHead}>
							<input
								className={styles.name}
								data-role="token-name"
								value={token.name}
								onChange={(e) =>
									onSceneChange(
										(prev) => renameToken(prev, token.id, e.target.value),
										`token-name-${token.id}`,
									)
								}
							/>
							<span className={styles.type}>{VALUE_TYPE_LABEL[token.type]}</span>
							<button
								type="button"
								className={styles.delete}
								data-role="delete-token"
								title="Delete — references keep their current value"
								onClick={() =>
									onSceneChange((prev) => deleteToken(prev, token.id))
								}
							>
								×
							</button>
						</div>

						<ValueEditor
							testId={`token-${token.id}`}
							label="Value"
							type={token.type}
							value={token.value}
							tokens={linkable}
							fallback={FALLBACK[token.type]}
							active={picks[variable]}
							varying={varying.has(variable)}
							preview={(term: Term) => resolveValue(context, [term], variable)}
							onChange={(next) =>
								onSceneChange(
									(prev) => setTokenValue(prev, token.id, next),
									`token-${token.id}`,
								)
							}
						/>
					</div>
				);
			})}
		</div>
	);
}
