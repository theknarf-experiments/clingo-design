import {
	VALUE_TYPES,
	VALUE_TYPE_NAMES,
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
	type ModelWearer,
} from "@clingo-design/design-core";

import { Styles } from "./Styles";
import { ValueEditor, type WhyRow } from "./ValueEditor";
import { fontMenu } from "./fontFiles";
import { documentUnit } from "./lengths";
import styles from "./Variables.module.css";

export interface VariablesProps {
	scene: Scene;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	picks: Picks;
	varying: ReadonlySet<string>;
	reach?: Readonly<Record<string, Set<number>>>;
	/**
	 * Variables nothing in the document consults — see `unreadVariables`.
	 *
	 * Not the same as "no answer yet", which is what an absent `reach` entry
	 * means on its own, and the two want saying differently: a token nobody
	 * links to is news the panel should carry, the way an unworn style is.
	 */
	unread: ReadonlySet<string>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	/** The why-probe, per variable — see `Inspector`. */
	why?: (variable: string) => WhyRow | undefined;
	/** So a style can put its wearers in the inspector — see `Styles`. */
	onSelectionChange?: (ids: string[]) => void;
	/**
	 * Wearing the answer set knows about and the document does not, by style id.
	 *
	 * `ModelScene.wears` — an instance's copy of a styled definition part, or a
	 * node a hand-written rule dressed. The panel needs it to stop saying "worn
	 * by nothing" about a style that is worn, just not by a layer.
	 */
	derivedWears?: Readonly<Record<string, readonly ModelWearer[]>>;
}

/**
 * The document's variables: treatments, then named values.
 *
 * A token has no multiplicity of its own beyond what its *value* holds: give
 * it two alternatives and every reference branches together. That is the
 * difference from a per-reference list, which branches independently.
 *
 * Two sections rather than one list, because a style is a different shape and
 * not a token with extra fields. A token is a scalar picked independently of
 * every other, so linking a size to one and a weight to another gives the cross
 * product; a style is one pick over whole records, which is the only way to say
 * that two properties move together. Bending either into the other's row would
 * hide exactly the difference that matters.
 *
 * Styles first, against the dependency order — a style's field may link to a
 * token and never the reverse. The token list has no bound, so "under the
 * tokens" means "off the bottom of a scroll", and the typography template put
 * its one style there: six colours and a radius stood between the panel and the
 * only variable in the document that was actually varying. One style row also
 * carries more of the design than the whole list above it, since one pick moves
 * four properties on six layers.
 */
export function Variables({
	scene,
	onSceneChange,
	picks,
	varying,
	reach,
	unread,
	pins,
	onPin,
	why,
	onSelectionChange,
	derivedWears,
}: VariablesProps) {
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };

	return (
		<div className={styles.variables} data-role="variables">
			<h3 className={styles.section}>Styles</h3>
			<Styles
				scene={scene}
				onSceneChange={onSceneChange}
				picks={picks}
				varying={varying}
				reach={reach}
				unread={unread}
				pins={pins}
				onPin={onPin}
				why={why}
				onSelectionChange={onSelectionChange}
				derivedWears={derivedWears}
			/>

			<h3 className={styles.section}>Values</h3>
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
					{VALUE_TYPE_NAMES.map((type) => (
						<option key={type} value={type}>
							{VALUE_TYPES[type].label}
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
							<span className={styles.type}>{VALUE_TYPES[token.type].label}</span>
						{/* The honest half of the greying that no longer happens here: a
						    token nothing links to has no answer to show, and saying why
						    is better than a row that has quietly stopped marking. */}
						{unread.has(variable) ? (
							<span className={styles.unused} data-role="token-unused">
								used by nothing
							</span>
						) : null}
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
							// A length token is read out in the document's unit like every
							// other length the editor shows — see `lengths.ts`.
							unit={documentUnit(scene)}
							fallback={VALUE_TYPES[token.type].fallback}
							// A `font` token's own definition is a font row like any other:
							// "the display face is Inter or Fraunces" is two families this
							// project holds, and a menu that offered only the four system
							// stacks would be the one place a designer could not spell it.
							options={fontMenu(scene, token.type)}
							active={picks[variable]}
							varying={varying.has(variable)}
							reachable={reach?.[variable]}
							pinned={pins[variable]}
							onPin={(index) => onPin(variable, index)}
							why={why?.(variable)}
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
