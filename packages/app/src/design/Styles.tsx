import { Fragment, type CSSProperties } from "react";

import {
	PROPS,
	STYLE_PROPS,
	VALUE_TYPES,
	type ModelWearer,
	type Picks,
	type PropName,
	type Scene,
	type Style,
	type Term,
	addStyle,
	addStyleVariant,
	deleteStyle,
	deleteStyleVariant,
	familyLabel,
	flatten,
	lit,
	optionLabel,
	propValues,
	renameStyle,
	renameStyleVariant,
	resolveValue,
	setStylePart,
	styleProps,
	stylePartVar,
	styleVar,
	termLabel,
	tokensFor,
	variantLabel,
} from "@clingo-design/design-core";

import { optionValue, termFor, type WhyRow } from "./ValueEditor";
import { cx } from "./cx";
import { fontMenu } from "./fontFiles";
import styles from "./Styles.module.css";

/**
 * What a cell shows when this variant says nothing about this property.
 *
 * A hole is a real alternative — "styled, or plain" is one variable with an
 * empty variant in it — so it is drawn rather than left blank, and it is drawn
 * the same way in the inspector's styled rows.
 */
export const NOTHING = "—";

export interface StylesProps {
	scene: Scene;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	picks: Picks;
	/** Variable keys the solver reports as unsettled. */
	varying: ReadonlySet<string>;
	reach?: Readonly<Record<string, Set<number>>>;
	/** Variables nothing consults — see `unreadVariables`. */
	unread: ReadonlySet<string>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	why?: (variable: string) => WhyRow | undefined;
	/** So "worn by 4" can put those four in the inspector. */
	onSelectionChange?: (ids: string[]) => void;
	/**
	 * Wearing the answer set knows about and the document does not, by style id.
	 *
	 * A style can be worn by something that is not a layer — an instance's copy
	 * of a styled definition part is `inst(i,label)`, and a hand-written rule can
	 * dress a node it invented. Neither is in `scene`, so counting the document's
	 * wearers called such a style unworn. It is a *different subject* rather than
	 * a bigger number, which is why it gets its own sentence and no select
	 * button: there is nothing in the layer list to select.
	 */
	derivedWears?: Readonly<Record<string, readonly ModelWearer[]>>;
}

/**
 * One field of one variant: a single {@link Term}, never a list.
 *
 * The one place this differs from a property row, and it is the whole feature:
 * a value branches, a part does not. Branching is what the *variants* are for,
 * so a cell offers the three things a term can be — typed in, linked to a
 * token, computed from one — and no way to add a second.
 */
function PartCell({
	style,
	variant,
	prop,
	term,
	scene,
	picks,
	onChange,
}: {
	style: Style;
	variant: number;
	prop: PropName;
	term: Term | undefined;
	scene: Scene;
	picks: Picks;
	onChange: (next: Term | undefined) => void;
}) {
	const spec = PROPS[prop];
	// The project's own families in front of the four system stacks for a `font`
	// row, and the type's own list for everything else — the same one question
	// every other panel's font row asks, asked through the same helper so that a
	// style variant can say "the display treatment is set in Fraunces" at all.
	const options = fontMenu(scene, spec.type) ?? VALUE_TYPES[spec.type].options;
	const tokens = tokensFor(scene, prop);
	const variable = stylePartVar(style.id, variant, prop);
	const context = { tokens: scene.tokens, picks, props: propValues(scene.nodes) };
	const resolved = term ? resolveValue(context, [term], variable) : undefined;

	if (term === undefined) {
		return (
			<div className={styles.cell} data-cell={variant}>
				<button
					type="button"
					className={styles.hole}
					data-role="set-part"
					title={`${variantLabel(style, variant)} decides nothing about ${spec.label.toLowerCase()}. Give it a value.`}
					onClick={() => onChange(lit(spec.fallback))}
				>
					{NOTHING}
				</button>
			</div>
		);
	}

	return (
		// `data-cell` rather than `data-variant`: the grid is flat, so a cell and
		// the head of its column are siblings, and one attribute meaning both
		// makes every selector over the table ambiguous.
		<div className={styles.cell} data-cell={variant}>
			{term.kind !== "literal" ? (
				<span className={styles.linked} data-role="part-ref">
					{termLabel(scene.tokens, term)}
					{resolved ? (
						<span className={styles.resolved}>
							{optionLabel(spec.type, resolved, options, spec.type === "font" ? familyLabel : undefined)}
						</span>
					) : (
						<span className={styles.broken}>unresolved</span>
					)}
				</span>
			) : options ? (
				<select
					className={styles.choice}
					data-role="part"
					value={term.value}
					onChange={(e) => onChange(lit(e.target.value))}
				>
					{/* A stack the menu has never seen stays selectable and reads as
					    the family a designer would call it — see `ValueEditor`, whose
					    branch this one mirrors and must keep mirroring. */}
					{options.some((o) => o.value === term.value) ? null : (
						<option value={term.value}>
							{optionLabel(spec.type, term.value, options, spec.type === "font" ? familyLabel : undefined)}
						</option>
					)}
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			) : spec.type === "color" ? (
				<span className={styles.colour}>
					<input
						type="color"
						className={styles.swatch}
						data-role="part-swatch"
						value={/^#[0-9a-f]{6}$/i.test(term.value) ? term.value : "#94a3b8"}
						onChange={(e) => onChange(lit(e.target.value))}
					/>
					<input
						className={styles.text}
						data-role="part"
						value={term.value}
						onChange={(e) => onChange(lit(e.target.value))}
					/>
				</span>
			) : (
				<input
					className={styles.text}
					data-role="part"
					value={term.value}
					onChange={(e) => onChange(lit(e.target.value))}
				/>
			)}

			<span className={styles.cellFoot}>
				<select
					className={styles.link}
					data-role="part-link"
					title="Type this field, link it to a variable, or compute it from one"
					value={optionValue(term)}
					onChange={(e) => onChange(termFor(e.target.value, resolved ?? spec.fallback))}
				>
					<option value="">Custom</option>
					{tokens.length > 0 ? (
						<optgroup label="Link to">
							{tokens.map((t) => (
								<option key={t.id} value={`ref:${t.id}`}>
									{t.name}
								</option>
							))}
						</optgroup>
					) : null}
				</select>
				<button
					type="button"
					className={styles.clear}
					data-role="clear-part"
					title="Let this variant decide nothing here"
					onClick={() => onChange(undefined)}
				>
					×
				</button>
			</span>
		</div>
	);
}

/**
 * One style, as a table: a column per variant, a row per property.
 *
 * A table rather than a list of collapsible variants, and that is not a
 * cosmetic choice. The content of the feature is the *correlation* — that these
 * fields move together and in which direction — and a correlation you have to
 * open two accordions to compare is a correlation nobody can see. Read down a
 * column and it is one treatment; read across a row and it is what the
 * treatments disagree about, which is the design decision itself.
 */
function StyleTable({
	scene,
	style,
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
}: {
	scene: Scene;
	style: Style;
	onSceneChange: StylesProps["onSceneChange"];
	picks: Picks;
	varying: ReadonlySet<string>;
	reach?: Readonly<Record<string, Set<number>>>;
	unread: ReadonlySet<string>;
	pins: Readonly<Record<string, number>>;
	onPin: StylesProps["onPin"];
	why?: StylesProps["why"];
	onSelectionChange?: (ids: string[]) => void;
	derivedWears?: StylesProps["derivedWears"];
}) {
	const variable = styleVar(style.id);
	const active = picks[variable];
	const reachable = reach?.[variable];
	const pinned = pins[variable];
	const whyRow = why?.(variable);
	const props = styleProps(style);
	const spare = STYLE_PROPS.filter((p) => !props.includes(p));
	const wearers = flatten(scene.nodes).filter((n) => n.style === style.id);
	/** Worn, but not by anything in the layer list — see the prop's comment. */
	const derived = derivedWears?.[style.id] ?? [];
	const branches = style.variants.length > 1;
	/**
	 * Whether the solver's answer about this variable says anything.
	 *
	 * A style nobody wears decides nothing, so projection collapses it and
	 * exactly one variant comes back reachable — which would grey the other and
	 * claim a rule ruled it out. Nothing did: no design uses *any* of them yet.
	 * So a style with no wearers is drawn plain, and "worn by nothing" beside its
	 * name is the honest version of the same news.
	 *
	 * Read off `unread` rather than counted here, because this panel is not the
	 * only row that asks: a token nothing links to sat behind the same collapse
	 * and greyed its own alternatives for want of the same gate. It is also the
	 * stricter reading — a node may wear a style and then state every property
	 * the style mentions, and then the style is worn and still decides nothing.
	 */
	const answered = branches && !unread.has(variable);

	/** A field the variants agree on is not part of the decision. */
	const same = (prop: PropName): boolean => {
		const key = (term: Term | undefined) => (term ? JSON.stringify(term) : "-");
		const first = key(style.variants[0]?.parts[prop]);
		return style.variants.every((v) => key(v.parts[prop]) === first);
	};

	return (
		<div className={styles.style} data-style={style.id}>
			<div className={styles.styleHead}>
				<input
					className={styles.name}
					data-role="style-name"
					value={style.name}
					onChange={(e) =>
						onSceneChange(
							(prev) => renameStyle(prev, style.id, e.target.value),
							`style-name-${style.id}`,
						)
					}
				/>
				{wearers.length > 0 ? (
					<button
						type="button"
						className={styles.wearers}
						data-role="select-wearers"
						title="Select every layer wearing this"
						onClick={() => onSelectionChange?.(wearers.map((n) => n.id))}
					>
						worn by {wearers.length}
					</button>
				) : derived.length > 0 ? (
					// Worn, and not by a layer. No button, because there is nothing in
					// the layer list to select: an instance's copy of a styled
					// definition part and a node a rule invented are both only in the
					// answer set.
					<span
						className={styles.wearers}
						data-role="derived-wearers"
						title={`Not from the layer list: ${derived
							.map((w) => w.node)
							.join(", ")}`}
					>
						worn by {derived.length} the rules dress
					</span>
				) : (
					<span className={styles.unworn} data-role="unworn">
						worn by nothing
					</span>
				)}
				<button
					type="button"
					className={styles.delete}
					data-role="delete-style"
					title="Delete — every wearer keeps the treatment it is showing"
					onClick={() => onSceneChange((prev) => deleteStyle(prev, style.id, picks))}
				>
					×
				</button>
			</div>

			<div
				className={styles.table}
				data-role="variants"
				data-varying={varying.has(variable) ? "" : undefined}
				style={{ "--variants": style.variants.length } as CSSProperties}
			>
				<div className={styles.corner}>
					{branches ? `${style.variants.length} variants` : "1 variant"}
				</div>
				{style.variants.map((variant, index) => {
					const dead = answered && reachable !== undefined && !reachable.has(index);
					const isPinned = pinned === index;
					const isActive = answered && index === active;
					return (
						<div
							key={index}
							className={cx(
								styles.variantHead,
								isActive && styles.active,
								dead && styles.impossible,
								isPinned && styles.pinnedHead,
							)}
							data-variant={index}
							data-active={isActive ? "" : undefined}
							data-impossible={dead ? "" : undefined}
							data-pinned={isPinned ? "" : undefined}
							title={
								dead
									? "No design uses this variant — a rule or a pin rules it out"
									: undefined
							}
						>
							<input
								className={styles.variantName}
								data-role="variant-name"
								value={variant.name ?? ""}
								placeholder={variantLabel(style, index)}
								// A column this narrow ellipsises "Comfortable", and an
								// input has no other way to show what it holds.
								title={variantLabel(style, index)}
								onChange={(e) =>
									onSceneChange(
										(prev) => renameStyleVariant(prev, style.id, index, e.target.value),
										`variant-name-${style.id}-${index}`,
									)
								}
							/>
							{whyRow && (dead || isActive) ? (
								<button
									type="button"
									className={cx(styles.ask, whyRow.at === index && styles.asking)}
									data-role="why-alt"
									aria-pressed={whyRow.at === index}
									title={
										dead
											? "Ask the solver why no design uses this variant."
											: "Ask the solver what makes it this variant."
									}
									onClick={() => whyRow.ask(whyRow.at === index ? null : index)}
								>
									?
								</button>
							) : null}
							{/* Only once something wears it: a pin is a question about the
							    designs, and until a variant reaches one there is no answer
							    to hold still. */}
							{answered ? (
								<button
									type="button"
									className={cx(styles.pin, isPinned && styles.pinOn)}
									data-role="pin-alt"
									aria-pressed={isPinned}
									title={
										isPinned
											? "Release this variant"
											: "Show only designs wearing this variant"
									}
									onClick={() => onPin(variable, isPinned ? null : index)}
								>
									{isPinned ? "◆" : "◇"}
								</button>
							) : null}
							<button
								type="button"
								className={styles.clear}
								data-role="delete-variant"
								title={
									branches
										? "Remove this variant"
										: "A style needs one variant. Add another first."
								}
								disabled={!branches}
								onClick={() =>
									onSceneChange((prev) => deleteStyleVariant(prev, style.id, index))
								}
							>
								×
							</button>
						</div>
					);
				})}

				{/* A row per property, as a fragment: the grid holds the label and the
				    cells as siblings, so a row is a row of the table rather than a
				    box of its own that would have to be re-measured against the
				    others. */}
				{props.map((prop) => (
					<Fragment key={prop}>
						<div className={styles.rowLabel} data-part-row={prop}>
							<span
								className={cx(styles.propLabel, branches && same(prop) && styles.agreed)}
								// The label itself as well as the annotation: the column is
								// narrow enough to ellipsise "Line height", and the tooltip
								// is the only place left to say which row this is.
								title={
									!branches
										? PROPS[prop].label
										: same(prop)
											? `${PROPS[prop].label} — every variant says the same thing here, so this is not part of the decision`
											: `${PROPS[prop].label} — the variants differ here, and this is what the pick decides`
								}
							>
								{PROPS[prop].label}
							</span>
							<button
								type="button"
								className={styles.clear}
								data-role="drop-part"
								title="Take this property out of the style. Its wearers decide it themselves again."
								onClick={() =>
									onSceneChange((prev) =>
										style.variants.reduce(
											(scene, _v, index) =>
												setStylePart(scene, style.id, index, prop, undefined),
											prev,
										),
									)
								}
							>
								×
							</button>
						</div>
						{style.variants.map((variant, index) => (
							<PartCell
								key={index}
								style={style}
								variant={index}
								prop={prop}
								term={variant.parts[prop]}
								scene={scene}
								picks={picks}
								onChange={(next) =>
									onSceneChange(
										(prev) => setStylePart(prev, style.id, index, prop, next),
										`part-${style.id}-${index}-${prop}`,
									)
								}
							/>
						))}
					</Fragment>
				))}
			</div>

			{props.length === 0 ? (
				<p className={styles.empty} data-role="no-parts">
					Nothing in it yet. Add a property, then a variant: one pick then decides
					all of them together.
				</p>
			) : null}

			{whyRow && whyRow.at !== null ? (
				<p
					className={styles.why}
					data-role="why"
					data-verdict={whyRow.verdict ?? undefined}
					data-pending={whyRow.answer === null ? "" : undefined}
				>
					{whyRow.answer ?? "Asking the solver — one solve per rule…"}
					{whyRow.solves !== null ? (
						<span className={styles.cost} data-role="why-cost">
							{whyRow.solves} solve{whyRow.solves === 1 ? "" : "s"}
						</span>
					) : null}
				</p>
			) : null}

			<div className={styles.styleFoot}>
				<button
					type="button"
					className={styles.add}
					data-role="add-variant"
					title="A copy of the last one, to differ from"
					onClick={() => onSceneChange((prev) => addStyleVariant(prev, style.id))}
				>
					+ Variant
				</button>
				{spare.length > 0 ? (
					<select
						className={styles.add}
						data-role="add-part"
						value=""
						onChange={(e) => {
							const prop = e.target.value as PropName;
							if (!prop) return;
							// Into every variant at once, at the property's own fallback:
							// a row that exists in one variant only is a row nobody can
							// read a correlation off.
							onSceneChange((prev) =>
								style.variants.reduce(
									(scene, _v, index) =>
										setStylePart(scene, style.id, index, prop, lit(PROPS[prop].fallback)),
									prev,
								),
							);
						}}
					>
						<option value="">+ Property</option>
						{spare.map((prop) => (
							<option key={prop} value={prop}>
								{PROPS[prop].label}
							</option>
						))}
					</select>
				) : null}
			</div>
		</div>
	);
}

/**
 * Styles: **one variable whose alternatives are whole records.**
 *
 * Beside the tokens rather than among them, because a style is not a token bent
 * into service. A token is a scalar: link a size to one and a weight to another
 * and the solver picks them independently, so two two-value tokens are four
 * designs of which two pair a display size with a body weight. A style is one
 * pick over whole treatments, which collapses that cross product into a
 * correlation — and every panel that reads a variable reads this one, because
 * none of them can tell the difference.
 */
export function Styles({
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
}: StylesProps) {
	return (
		<div className={styles.styles} data-role="styles">
			<div className={styles.head}>
				<span className={styles.hint}>
					One pick, a whole treatment. What the variants differ in is the
					decision.
				</span>
				<button
					type="button"
					className={styles.add}
					data-role="add-style"
					onClick={() => onSceneChange((prev) => addStyle(prev).scene)}
				>
					+ Style
				</button>
			</div>

			{scene.styles.length === 0 ? (
				<p className={styles.empty} data-role="no-styles">
					No styles. One holds several properties that move together — compact
					against comfortable typography is one variable, not four.
				</p>
			) : null}

			{scene.styles.map((style) => (
				<StyleTable
					key={style.id}
					scene={scene}
					style={style}
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
			))}
		</div>
	);
}
