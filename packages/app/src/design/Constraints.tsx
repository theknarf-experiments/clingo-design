import { useState } from "react";
import {
	type Anchor,
	CONSTRAINT_KINDS,
	CONSTRAINT_NAMES,
	type Constraint,
	type ConstraintKind,
	type ConstraintSpec,
	DEFAULT_STRENGTH,
	EDGES,
	type Edge,
	type ModelScene,
	PROPS,
	type PropName,
	type Relaxation,
	STRENGTHS,
	STRENGTH_NAMES,
	type Picks,
	type Scene,
	type Strength,
	UNITS,
	type Unit,
	angleValue,
	isSoft,
	addConstraint,
	addCustomConstraint,
	constrainsProp,
	constraintTermError,
	constraintValue,
	constraintVar,
	crossesViewport,
	datumLabel,
	deadlock,
	deleteConstraint,
	edgeOptions,
	findInTree,
	formatLength,
	groupProps,
	inertMembers,
	keyCopyLabel,
	mdegOf,
	rangesOverGroup,
	ref,
	refusedMembers,
	renameConstraint,
	resolveValue,
	retargetConstraint,
	sharedProps,
	single,
	stateLabel,
	takesMembers,
	termLabel,
	tokensOfType,
	updateConstraint,
	violRefs,
	writeAngle,
} from "@clingo-design/design-core";

import { AngleInput, LengthInput } from "./ValueEditor";
import styles from "./Constraints.module.css";
import { cx } from "./cx";
import { documentUnit, shownEmu } from "./lengths";

export interface ConstraintsProps {
	scene: Scene;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	selection: ReadonlySet<string>;
	/** Constraint ids the solver blamed for an impossible document. */
	conflict: ReadonlySet<string>;
	/**
	 * Soft rules the design on screen breaks.
	 *
	 * Not a conflict and not an error: a preference costs points rather than
	 * forbidding, so this is a legal design that gave something up. The panel has
	 * to say the two differently, because the previous phase made this state
	 * newly reachable and "your rules conflict" would be a lie about it.
	 */
	broken: ReadonlySet<string>;
	/** The ways out of the conflict, cheapest first, each already solved for. */
	relaxations: readonly Relaxation[];
	/** True when the search proved these are every way out of that size. */
	exhaustive: boolean;
	/** "Switch off Fill all different" — the studio owns the wording. */
	describeRelaxation: (relaxation: Relaxation) => string;
	/** Take one. */
	onRelax: (relaxation: Relaxation) => void;
	/** Select the nodes a constraint ranges over, so it can be seen. */
	onSelectionChange: (ids: string[]) => void;
	/**
	 * The universe on screen, for the sets its rules named.
	 *
	 * A rule can put nodes on the canvas and say which of them belong together;
	 * `model.groups` is that saying, and it is what a constraint is pointed at
	 * instead of a list of ids. Reading it from the answer set rather than asking
	 * the user for an ASP term is the whole authoring story: the groups on offer
	 * are exactly the ones that exist.
	 */
	model?: ModelScene;
	/**
	 * State copies a rule may name, as `stateCopyIds` lists them — offered beside
	 * the node ids and the datums a rule can already be about.
	 *
	 * A cross-state rule is an **ordinary rule with an unusual member**, and this
	 * one prop is the only place the panel has to learn that. `Constraint.nodes`
	 * is already `string[]` and already carries terms that are not document nodes
	 * — a guide, one line of a column grid — and the compiler emits `c_node(C,N)`
	 * for whatever string is there, so "the label does not jump when you hover" is
	 * an `align` over two members and needs no kind, no field and no machinery of
	 * its own.
	 *
	 * It arrives as a prop rather than being computed here because the list is the
	 * materialisation analysis's answer: a term for a part with no copy is a
	 * member that would silently never hold, and the studio has already run that
	 * analysis for the canvas. Computing it again in a panel would be the same
	 * walk twice, with two chances to disagree.
	 */
	stateMembers?: readonly string[];
	/**
	 * Keyframe copies a rule may name, as `keyframeCopyIds` lists them — offered
	 * in the same menu the state copies are, and for the same reason.
	 *
	 * **The menu is the front door and there is no other one.** `compile()` mints
	 * `kfr(I,W,R,K)` only where a rule already names one — `keyframeParts` is
	 * seeded from `scene.constraints` and from nothing else — so without this list
	 * the whole mechanism is a term nobody can type: a designer would have to know
	 * the spelling, the track term's own bracket syntax and the 1-based index, and
	 * get all three right before anything appeared. That is why this list, unlike
	 * the state copies', is *not* filtered by the materialisation analysis: it
	 * would then offer only the terms somebody had already used, and there would
	 * be no first rule.
	 */
	keyMembers?: readonly string[];
	/**
	 * The universe on screen, for the readers that answer differently in
	 * different designs.
	 *
	 * One reader needs it and it is {@link inertMembers}: an `angle` token holding
	 * `[0deg, 30deg]` is a rule that holds in one design and says nothing in the
	 * next, and marking it inert in the flat one would be a warning with nothing
	 * behind it. Absent is the first alternative of everything, which is what an
	 * unsolved panel shows anyway — the same default `Dimension` above takes.
	 */
	picks?: Picks;
	/**
	 * Constraint ids the *second* solver blamed in the design on screen.
	 *
	 * Its own prop rather than more entries in {@link conflict}, and the
	 * difference is not a nicety. `conflict` means "the document admits no design
	 * at all"; it arrives with an empty canvas and it drives the headline that
	 * says so. A sketch conflict arrives with the canvas full: the document is
	 * satisfiable, these designs exist, and what cannot hold is a pair of rules
	 * in *this* one. It is per universe where `conflict` is per document, so
	 * merging them would redden a rule that holds perfectly in the design beside
	 * this one.
	 */
	sketchConflict?: ReadonlySet<string>;
	/**
	 * `<node>:<axis>` the sketch could not have, because the linear layer had
	 * already decided it.
	 *
	 * The other half of a sketch conflict and often the whole of one: a `distance`
	 * aimed at two nodes an `align` already places conflicts with the placement
	 * rather than with a rule, so there is nothing to redden and a different
	 * sentence to say. A pin is not a rule and cannot be switched off, which is
	 * why it is kept apart rather than folded into the list above.
	 */
	sketchPinned?: readonly string[];
	/**
	 * Constraint ids the sketch says nothing new — more rules than freedoms, and
	 * they happen to agree. Not an error, and not nothing.
	 */
	redundant?: ReadonlySet<string>;
	/**
	 * True when the sketch did not settle and blames nothing for it.
	 *
	 * The numeric failure of the second solver, which is a statement about the
	 * arithmetic and not about the rules: the iteration ran out of steps looking
	 * for a placement from where these nodes are now. Nothing is blamed, nothing
	 * is learned, and the design below is the linear solver's — exact about
	 * everything except these rules.
	 */
	adrift?: boolean;
	/** True when the geometry solver never loaded, so no sketch rule has run. */
	noSolver?: boolean;
}

/**
 * What a rule's value comes to as an angle, for the one kind whose `valueType`
 * is not `"length"`.
 *
 * {@link constraintValue}'s twin and not an extension of it, because the two
 * are exact-or-nothing about different quantities: `emuOf` refuses `"30deg"`
 * and `mdegOf` refuses `"40px"`, and a single reader that answered both would
 * be a number whose meaning depended on which kind asked. The walk is the same
 * walk — the constraint's own variable, through whatever token it names — so a
 * `bearing` driven by an `angle` token reads the token, exactly as the
 * program's `mdeg/2` does.
 */
function constraintAngle(scene: Scene, c: Constraint): number | undefined {
	const text = resolveValue(
		{ tokens: scene.tokens, picks: {} },
		c.value,
		constraintVar(c.id),
	);
	return text === undefined ? undefined : mdegOf(text);
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
	unit,
	onSceneChange,
}: {
	scene: Scene;
	constraint: Constraint;
	spec: ConstraintSpec;
	/** What the document is measured in — see the inspector's unit menu. */
	unit: Unit;
	onSceneChange: ConstraintsProps["onSceneChange"];
}) {
	if (!spec.valueType) return null;
	const term = constraint.value?.[0];
	const driven = term !== undefined && term.kind !== "literal";
	/**
	 * An angle is the second quantity a rule can hold to, and every writer on
	 * this path was a length writer.
	 *
	 * `bearing` is the first kind whose `valueType` is not `"length"`, and left
	 * alone every branch below would have written it as one: the field would
	 * commit `"37px"`, `mdegOf` would refuse that, `sk_angle/2` would never
	 * derive, and touching the token menu would rewrite the angle as a distance.
	 * So the reader, the field and the unlink branch each ask the table which
	 * quantity this is, rather than assuming.
	 */
	const angular = spec.valueType === "angle";
	// What it comes to right now — EMU for a length, thousandths of a degree for
	// an angle. Without a universe in hand this is the token's first alternative,
	// which is what the canvas would show anyway.
	const resolved = angular
		? constraintAngle(scene, constraint)
		: constraintValue(scene, constraint);
	/** The same number as a person reads it, for the driven row's echo. */
	const shown =
		resolved === undefined
			? "?"
			: angular
				? writeAngle(resolved)
				: shownEmu(resolved, unit);
	/** And as the document stores it, for a field with nothing typed in it yet. */
	const stored = angular
		? writeAngle(resolved ?? 0)
		: formatLength(resolved ?? 0, unit);

	return (
		<>
			{driven ? (
				<span
					className={styles.driven}
					data-role="constraint-driver"
					title="Driven by a variable"
				>
					{termLabel(scene.tokens, term)}
					<span className={styles.resolved}>{shown}</span>
				</span>
			) : angular ? (
				// The one field that keeps the unit it was typed in rather than the
				// document's: a document's unit is a *length* unit, and an angle has no
				// opinion about millimetres. `deg`, `turn` and `grad` all say the same
				// circle, so there is nothing to normalise them against.
				<AngleInput
					className={cx(styles.limit, styles.length)}
					role="constraint-value"
					value={term?.kind === "literal" ? term.value : stored}
					title="Which way the second one lies from the first, clockwise from straight right — in degrees, or with a unit of its own like 0.25turn"
					onCommit={(text) =>
						onSceneChange(
							(prev) =>
								updateConstraint(prev, constraint.id, { value: single(text) }),
							`constraint-value:${constraint.id}`,
						)
					}
				/>
			) : (
				// The same field the inspector's coordinates use, for the same reason:
				// a rule that holds two edges 12pt apart is a statement in points, so
				// what is typed is what is stored. `dimension()` quantizes to a whole
				// pixel and is still the right writer where a distance is *measured*
				// off the design rather than said — which is what `addConstraint` and
				// `retargetConstraint` do when a rule is created or changes kind.
				<LengthInput
					className={cx(styles.limit, styles.length)}
					role="constraint-value"
					value={term?.kind === "literal" ? term.value : stored}
					unit={unit}
					title={`How far apart, in ${UNITS[unit].label.toLowerCase()} — or with a unit of its own, like 12pt`}
					onCommit={(text) =>
						onSceneChange(
							(prev) =>
								updateConstraint(prev, constraint.id, { value: single(text) }),
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
							// nothing jumps at the moment of unlinking — and keeps it in the
							// quantity the kind is measured in, so an angle unlinked does not
							// come back as a distance.
							value: link
								? [ref(link[1])]
								: angular
									? angleValue(resolved ?? 0)
									: single(stored),
						}),
					);
				}}
			>
				{/* What "hold a number" is measured in, which is the document's unit
				    for a length and always degrees for an angle. */}
				<option value="">{angular ? "deg" : UNITS[unit].symbol}</option>
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
 * The default for the two optional id sets, hoisted so a studio that passes
 * neither does not hand the panel a fresh set every render.
 */
const EMPTY: ReadonlySet<string> = new Set();

/**
 * The nine anchor names as a person reads them.
 *
 * Split off the camel case rather than tabulated, so there is one list of
 * anchors in the tree and this cannot drift from it: `ANCHOR_NAMES` is the
 * table, and a tenth anchor would appear here spelled correctly without anybody
 * editing this. The one editorial touch is the spelling of the middle one,
 * which this codebase writes the British way everywhere else it appears.
 *
 * `sketch.ts` has a second table of the same nine anchors, `ANCHOR_WORDS`, and
 * the two are deliberately not one. That one holds *prose fragments* for the
 * middle of a refusal sentence — "a turned box has no top-left corner where the
 * design says it has one" — and this one holds labels for a `<select>`, where
 * "Top left" is what a menu says and "top-left corner" is what it does not. The
 * only fact they share is the spelling of the middle one, so that is the only
 * thing that can drift, and it drifts into a menu reading "Center" beside a
 * sentence reading "centre" rather than into anything a solver sees.
 */
function anchorLabel(anchor: Anchor): string {
	const words = anchor.replace(/([A-Z])/g, " $1").toLowerCase();
	const said = words === "center" ? "centre" : words;
	return said.charAt(0).toUpperCase() + said.slice(1);
}

/** A member of a sketch pin — `"<node>:<axis>"` — as the node it names. */
function pinnedNode(tag: string): string {
	const cut = tag.lastIndexOf(":");
	return cut === -1 ? tag : tag.slice(0, cut);
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
	broken,
	relaxations,
	exhaustive,
	describeRelaxation,
	onRelax,
	onSelectionChange,
	model,
	stateMembers,
	keyMembers,
	picks,
	sketchConflict = EMPTY,
	sketchPinned = [],
	redundant = EMPTY,
	adrift = false,
	noSolver = false,
}: ConstraintsProps) {
	const selected = [...selection];
	const groups = Object.keys(model?.groups ?? {}).sort();
	/** Every distance in this panel is read and written in it — see `lengths.ts`. */
	const unit = documentUnit(scene);
	/**
	 * Blamed rules the *document* can explain, which is a different question from
	 * the one the core answers.
	 *
	 * Only the blamed ones: a satisfiable document may still hold a rule whose
	 * members are tied together — it might be soft, or its own violation might be
	 * what the design is paying for — and volunteering "this can never hold" about
	 * a design that is on the screen would be the panel arguing with the canvas.
	 */
	const knots = scene.constraints
		.filter((c) => conflict.has(c.id))
		.map((c) => ({ id: c.id, stuck: deadlock(scene, c) }))
		.filter((k): k is { id: string; stuck: NonNullable<typeof k.stuck> } =>
			k.stuck !== undefined,
		);
	/**
	 * The rule whose name is being typed, and what has been typed so far.
	 *
	 * A rename carries the user's ASP with it, so it is committed on blur or
	 * Enter rather than per keystroke — half a name is not a name, and renaming
	 * through `n`, `no`, `no_` would drag `viol(...)` along for the ride. One slot
	 * rather than a draft per row because only one field can have the caret.
	 */
	const [naming, setNaming] = useState<{ id: string; text: string } | null>(null);
	/** The rule whose `viol(...)` line was last put on the clipboard. */
	const [copied, setCopied] = useState<string | null>(null);
	/**
	 * What a new rule will range over: the selected layers, or a set a rule
	 * named.
	 *
	 * One control, in the place the members were always chosen, because these are
	 * alternatives to each other and not two ways of adding a rule.
	 */
	const [target, setTarget] = useState("");
	// A group that has since stopped existing must not silently keep taking new
	// rules; falling back to the selection is what the panel did before.
	const over = groups.includes(target) ? target : "";
	const membersOf = (group: string) => model?.groups[group] ?? [];
	const propsOf = (c: Constraint): PropName[] =>
		c.group !== undefined && model
			? groupProps(model, membersOf(c.group))
			: sharedProps(scene, c.nodes);
	const available = over
		? model
			? groupProps(model, membersOf(over))
			: []
		: sharedProps(scene, selected);

	/**
	 * A property rule also needs something to talk *about*; a geometric one
	 * always has geometry to talk about, so it only needs enough members.
	 *
	 * A group supplies the members, so what it needs instead is a kind that reads
	 * them as a set — a gap has a near side and a far side, and a set has neither.
	 *
	 * A kind with no subject at all asks for neither: its condition is ASP the
	 * user writes, and there is nothing in the document for a selection to
	 * supply. So it is always on offer, which is why the menu itself is never
	 * disabled any more — the truth about the *other* kinds is carried per
	 * option, where it always was.
	 */
	const offered = (kind: ConstraintKind): boolean => {
		const spec = CONSTRAINT_KINDS[kind];
		if (!takesMembers(kind)) return true;
		if (over) return rangesOverGroup(kind) && (spec.geometric || available.length > 0);
		if (selected.length < spec.minNodes) return false;
		return spec.geometric || available.length > 0;
	};
	/** Whether anything can be added *about what is selected*, for the tooltip. */
	const canTarget = CONSTRAINT_NAMES.some((k) => takesMembers(k) && offered(k));

	/**
	 * What a member is called, whatever kind of thing it is.
	 *
	 * The chain is the one the studio's own label chain is, in the same order and
	 * for the same reason: a member is a node most of the time, a datum sometimes
	 * — a guide, one line of a column grid — and a state copy where a rule relates
	 * two states of a component. All three are strings in `Constraint.nodes`, and
	 * without the last two links a rule about a hover state read as the raw term
	 * `stt(b1,hover,label)` in the one place a person goes to find out what a rule
	 * is about. Falling through to the id is deliberate rather than a last resort:
	 * a rule may name a term a hand-written rule invented, and a receipt is more
	 * use than a blank.
	 */
	const nameOf = (id: string) =>
		findInTree(scene.nodes, id)?.name ??
		datumLabel(scene, id) ??
		stateLabel(scene, id) ??
		keyCopyLabel(scene, id) ??
		id;

	/**
	 * Copies this rule could still take, in the order the panel lists them.
	 *
	 * The state copies and the keyframe copies in one menu, because they are one
	 * kind of thing to the rule that names them: a member that is not a node, that
	 * `c_node/2` takes exactly where it takes a node id, and that no selection on
	 * the canvas can ever supply. Two menus would be two controls asking the same
	 * question in a 260px panel.
	 *
	 * Filtered against what the rule already names, and against the kind's
	 * `maxNodes`, because `shapeFor` slices extra members off the end: offering a
	 * third member to a `gap` would be offering a choice that silently does
	 * nothing. Nothing is offered where the rule ranges over a group instead —
	 * a group *is* the membership, and adding a listed member beside it would be
	 * two answers to one question.
	 */
	const spareStates = (c: Constraint): readonly string[] => {
		const all = [...(stateMembers ?? []), ...(keyMembers ?? [])];
		if (all.length === 0) return [];
		if (c.group !== undefined) return [];
		const held = new Set(c.nodes);
		return c.nodes.length >= CONSTRAINT_KINDS[c.kind].maxNodes
			? []
			: all.filter((term) => !held.has(term));
	};

	/**
	 * What this rule cannot say, and what it says about somewhere other than the
	 * screen — the two readers `spatial.ts` keeps, asked per row.
	 *
	 * **Silence is the failure this answers.** A rule about a turned node's left
	 * edge is refused by `gnoedge/2`: the quantity is never minted, the relation
	 * goes unstated, and the rule sits in this panel looking exactly like a rule
	 * that holds. A rule between a node inside a 3D view and one outside it is
	 * worse in the other direction — it *does* hold, exactly, about model space,
	 * while a camera moves the pixels it appears to be about. Neither is an error
	 * and neither can be found by looking at the design, so both are said here,
	 * where the rule is.
	 *
	 * Asked per row rather than by filtering one `inertConstraints` walk, which is
	 * what the exported function is for: on a page of forty rules, filtering would
	 * be forty walks of forty rules to draw one mark.
	 */
	/**
	 * The quantities this rule may be about, given who its members are.
	 *
	 * Plus whatever it is about *already*, which is the case that makes this a
	 * function rather than one call: a rule written on a mesh and then dragged out
	 * of the view still names `centerZ`, and a menu that dropped the current value
	 * would render as the first option and silently retarget the rule the next
	 * time anybody touched it. The row shows what the rule says; the menu says
	 * what it could say instead.
	 */
	const edgesFor = (c: Constraint): readonly Edge[] => {
		const members = c.group === undefined ? c.nodes : membersOf(c.group);
		const offered = edgeOptions(scene, c.kind, members);
		const at = c.edge;
		return at !== undefined && !offered.includes(at) ? [at, ...offered] : offered;
	};

	/**
	 * What this rule says nothing about, from whichever solver would have said it —
	 * one list, because to a designer scanning the panel it is one fact.
	 *
	 * `inertMembers` is the linear half and answers about an `Edge` the program
	 * refused to mint. It returns `[]` for a sketch kind on its first line, and not
	 * because a sketch rule cannot be silenced: `edges` is empty on all three, so
	 * `constraint.edge` is never set, so the question it asks is not the question
	 * they raise. Theirs is about the *anchor* — a turned box keeps its centre and
	 * loses its corners — and `refusedMembers` is the half that knows it. Without
	 * this second call a `distance` on `topLeft` between a card turned 30° and
	 * another node governs nothing at all and renders here as an ordinary green
	 * row, which is the silence this panel exists to break.
	 *
	 * Keyed rather than indexed because the two halves are keyed differently: an
	 * edge refusal is one sentence per member *per edge*, an anchor refusal one per
	 * member, and a rule holding both must not collapse them onto one key.
	 */
	const notesOf = (
		c: Constraint,
	): { key: string; member: string; why: string }[] =>
		c.enabled
			? [
					...inertMembers(scene, c, picks).map((found) => ({
						key: `edge:${found.member}/${found.edge}`,
						member: found.member,
						why: found.why,
					})),
					...refusedMembers(scene, c, picks).map((found) => ({
						key: `anchor:${found.member}`,
						member: found.member,
						why: found.why,
					})),
				]
			: [];
	const crossingOf = (c: Constraint): string | undefined => {
		if (!c.enabled || !CONSTRAINT_KINDS[c.kind].geometric) return undefined;
		const over = c.group === undefined ? c.nodes : membersOf(c.group);
		return over.length < 2 ? undefined : crossesViewport(scene, over);
	};

	/** The "what it ranges over" control, for the head and for each rule. */
	function overSelect(
		value: string,
		onPick: (group: string | undefined) => void,
		role: string,
	) {
		if (groups.length === 0) return null;
		return (
			<select
				className={styles.over}
				data-role={role}
				title="Range over the selected layers, or over a set your rules named"
				value={value}
				onChange={(e) => onPick(e.target.value || undefined)}
			>
				<option value="">Selected layers</option>
				{groups.map((group) => (
					<option key={group} value={group}>
						{group} ({membersOf(group).length})
					</option>
				))}
			</select>
		);
	}

	/** A driven dimension reads as the variable's name, not as today's number. */
	function dimensionOf(c: Constraint): string {
		const term = c.value?.[0];
		if (term && term.kind !== "literal") return termLabel(scene.tokens, term);
		// In the quantity the kind is measured in: the document's unit for the
		// eight kinds that hold a length — the sentence this lands in is read
		// beside the panel that says `mm` — and degrees for the one that holds an
		// angle, which has no opinion about millimetres.
		return CONSTRAINT_KINDS[c.kind].valueType === "angle"
			? writeAngle(constraintAngle(scene, c) ?? 0)
			: shownEmu(constraintValue(scene, c) ?? 0, unit);
	}

	/**
	 * Whether this rule is one of the ones that cannot hold — from either solver.
	 *
	 * One reader for the row's red mark, because to a designer scanning the panel
	 * they are one fact: this rule is why there is no design, or this rule is why
	 * the design on screen does not obey it. The two are kept apart everywhere
	 * *else* — the headlines differ, the ways out differ, and the deadlock
	 * diagnosis is only ever about the document's own core.
	 */
	const guilty = (id: string) => conflict.has(id) || sketchConflict.has(id);

	function describe(c: Constraint): string {
		const spec = CONSTRAINT_KINDS[c.kind];
		const summary = spec.summary
			.replace("{prop}", PROPS[c.prop].label.toLowerCase())
			.replace("{n}", String(c.limit ?? 1))
			.replace("{edge}", (EDGES[c.edge ?? "left"].label ?? "").toLowerCase())
			.replace("{v}", dimensionOf(c));
		// The kind says what the relation is; the strength says whether it is a
		// demand. Both from their own table, so neither has a copy of the other's
		// wording — see STRENGTHS.
		return STRENGTHS[c.strength ?? DEFAULT_STRENGTH].phrase.replace(
			"{s}",
			summary,
		);
	}

	return (
		<div className={styles.constraints} data-role="constraints">
			<div className={styles.head}>
				<span className={styles.hint}>
					{groups.length > 0
						? "Rules the design must obey. Add one over the selected layers, over a set your rules named, or write your own."
						: "Rules the design must obey. Select layers to add one, or write your own."}
				</span>
				{overSelect(over, (group) => setTarget(group ?? ""), "new-constraint-over")}
				<select
					className={styles.add}
					data-role="add-constraint"
					value=""
					title={
						canTarget
							? over
								? `Constrain every member of ${over}`
								: "Constrain the selected layers"
							: over
								? "This set has nothing its members all share — but a rule you write yourself needs nothing"
								: "Select layers that share a property, or two to relate by geometry — or write your own rule"
					}
					onChange={(e) => {
						const kind = e.target.value as ConstraintKind;
						if (!kind) return;
						onSceneChange((prev) =>
							// A kind with no subject is named rather than pointed at
							// something, and the name is what its author has to type into
							// their own ASP — so it starts out readable (`rule`, `rule_2`)
							// instead of as an opaque handle.
							takesMembers(kind)
								? addConstraint(
										prev,
										kind,
										over ? [] : selected,
										over ? available[0] : undefined,
										undefined,
										over || undefined,
									).scene
								: addCustomConstraint(prev).scene,
						);
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
						? "This rule cannot hold as things stand."
						: `These ${conflict.size} rules cannot all hold at once.`}{" "}
					{/* The generic advice, and only when there is nothing better to
					    say. A list of specific ways out is below whenever the solver
					    found any, and telling somebody to "turn one off" underneath
					    two buttons that turn the right one off is noise — worse, it is
					    wrong advice in the case where the rules are fine and it is the
					    pins that cannot hold. */}
					{relaxations.length === 0
						? "Turn one off, or widen a property so there are more values to go around."
						: null}
				</p>
			) : null}

			{/* The second solver's conflict, which is a different sentence from the
			    one above because it is a different situation. That one means the
			    document admits no design at all and the canvas is empty; this one
			    means the designs are there and two rules cannot both hold in the one
			    on screen. No ways out are offered either: a relaxation is a re-solve
			    under a subset of the assumptions, against a session — and a sketch
			    conflict has no session to re-solve against. So the advice is what the
			    designer can actually do. */}
			{sketchConflict.size > 0 ? (
				<p className={styles.sketchConflict} data-role="sketch-conflict">
					{sketchConflict.size === 1
						? "This rule cannot hold in the design on screen."
						: `These ${sketchConflict.size} rules cannot all hold in this design.`}{" "}
					A distance and a bearing between the same two things fix a point
					exactly, so a second rule about either has nowhere left to move. Turn
					one off, or drag a member to aim the sketch somewhere else.
				</p>
			) : sketchPinned.length > 0 ? (
				// The commoner half, and it names no rule because no rule is at fault:
				// naming a node in an Align, a Gap or a stack hands both its
				// coordinates to the linear solver, and a sketch rule aimed at it then
				// has nothing left to move. A pin cannot be switched off, so the advice
				// points at the rules that made it.
				<p className={styles.sketchConflict} data-role="sketch-pinned">
					{[...new Set(sketchPinned.map(pinnedNode))]
						.map((id) => `“${nameOf(id)}”`)
						.join(" and ")}{" "}
					{sketchPinned.length === 1 ? "is" : "are"} already placed by other
					rules — an Align, a Gap or a stack decides their positions — so this
					rule has nothing left to move. Turn one of those off, or put this rule
					on something the layout does not place.
				</p>
			) : null}

			{/* Neither a conflict nor a design: the second solver ran out of steps.
			    Nothing is blamed and no row is reddened, because a numeric failure is
			    a property of where these nodes happen to be sitting rather than of
			    the rules — and turning it into a fact about the rules would delete
			    every design that would have converged from somewhere else. */}
			{/* Before adrift, and exclusive with it: a rule that never ran is not a
			    rule that ran and did not settle, and the remedy the adrift sentence
			    offers — drag a member and start it somewhere else — cannot work on a
			    module that is not there. */}
			{noSolver ? (
				<p className={styles.adrift} data-role="no-solver">
					These rules have not run. The geometry solver did not load, so the
					design below is the linear solver’s alone — exact about everything
					except these. Nothing is wrong with the rules and nothing you change
					here will help; reload if it does not clear itself.
				</p>
			) : null}
			{adrift && !noSolver ? (
				<p className={styles.adrift} data-role="adrift">
					The sketch did not settle here. The rules do not contradict each other
					— the solver ran out of steps looking for a placement that satisfies
					them from where these nodes are now. The design below is the linear
					solver’s, which is exact about everything except these rules. Drag a
					member to start it somewhere else.
				</p>
			) : null}

			{/* Why, where the document can say why. A core names which rules cannot
			    hold together and the ways out say what to do about it, and for the
			    commonest impossible document there is — two nodes that share a
			    treatment and a rule that says they must differ — both are true and
			    neither is the news. Nothing is wrong with the rule; the two members
			    are one value, and no search can make them two. The only way out on
			    offer is "delete your rule", so without this the panel's whole answer
			    is bad advice. See `deadlock`. */}
			{knots.length > 0 ? (
				<ul className={styles.knots} data-role="deadlocks">
					{knots.map((knot) => (
						<li key={knot.id}>
							<button
								type="button"
								className={styles.knot}
								data-role="deadlock"
								data-constraint={knot.id}
								title="Select the two that cannot be told apart"
								onClick={() => onSelectionChange([...knot.stuck.nodes])}
							>
								{knot.stuck.said}
							</button>
						</li>
					))}
				</ul>
			) : null}

			{/* The other half of the answer. A core says what is wrong; this says
			    what to do about it, and each row is a design that already exists —
			    the solve that proved the way out works is the solve that drew it,
			    so it is on the canvas right now. Several rows means several
			    *equally cheap* ways out, and choosing between them is not the
			    tool's business: which rule matters is the only thing here that
			    nobody but the designer knows. */}
			{relaxations.length > 0 ? (
				<div className={styles.ways} data-role="relaxations">
					<p className={styles.waysHead}>
						{relaxations.length === 1
							? "One way out"
							: `${exhaustive ? "" : "At least "}${relaxations.length} ways out — each is drawn on the canvas`}
					</p>
					{relaxations.map((relaxation) => (
						<button
							key={[...relaxation.rules, ...relaxation.pins].join("|")}
							type="button"
							className={styles.way}
							data-role="relaxation"
							data-free={relaxation.free ? "" : undefined}
							title={
								relaxation.free
									? "Let go of these held values. Not an edit — there is nothing to undo."
									: "Switch these rules off. An edit, so ⌘Z brings them back."
							}
							onClick={() => onRelax(relaxation)}
						>
							<span>{describeRelaxation(relaxation)}</span>
							<span className={styles.wayTag}>
								{relaxation.free ? "free" : "edit"}
							</span>
						</button>
					))}
				</div>
			) : null}

			{/* Possible, and disappointing — which the previous phase made
			    reachable and which must not read as a conflict. A soft rule cannot
			    make a document impossible, so nothing here needs fixing; the
			    document is simply asking for more than it can have. */}
			{conflict.size === 0 && broken.size > 0 ? (
				<p className={styles.disappointing} data-role="broken">
					{broken.size === 1
						? "One preference is broken in the design on screen. Nothing here is impossible — this is the best the rules allow."
						: `${broken.size} preferences are broken in the design on screen. Nothing here is impossible — this is the best the rules allow.`}
				</p>
			) : null}

			{scene.constraints.length === 0 ? (
				<p className={styles.empty}>
					No rules yet — every combination of your values is allowed.
				</p>
			) : null}

			{scene.constraints.map((c) => {
				const spec = CONSTRAINT_KINDS[c.kind];
				const props = propsOf(c);
				const members = c.group === undefined ? c.nodes : membersOf(c.group);
				// A rule with no subject: its name is the whole of it, so the name is
				// what the row edits and the line to write is what the row shows.
				const named = naming?.id === c.id ? naming : null;
				const nameError =
					named && named.text !== c.id
						? constraintTermError(scene, named.text, c.id)
						: undefined;
				// The cheapest honest signal, and phrased as what it measured: a rule
				// reached through `viol(C) :- mine(C).` counts zero and still fires, so
				// zero says "nothing here names it", not "this is broken".
				const refs = violRefs(scene.rules, c.id);
				const stub = `viol(${c.id}) :- `;
				// What the program will not create for this rule, and what it will
				// create somewhere the screen is not. Neither is an error and both are
				// invisible without this.
				const inert = notesOf(c);
				const crossing = crossingOf(c);
				return (
					<div
						key={c.id}
						className={cx(
							styles.rule,
							guilty(c.id) && styles.blamed,
							broken.has(c.id) && styles.broken,
							redundant.has(c.id) && styles.redundant,
							inert.length > 0 && styles.inert,
							!c.enabled && styles.off,
						)}
						data-constraint={c.id}
						data-blamed={guilty(c.id) ? "" : undefined}
						// Satisfied, and saying nothing new: the second solver has more
						// rules than freedoms and they happen to agree. Dashed like a
						// broken preference, because it is the same kind of news — not an
						// error, and not nothing.
						data-redundant={redundant.has(c.id) ? "" : undefined}
						// A preference this design gave up. Marked, not flagged: it is
						// what the rule is *for*, and the design is legal.
						data-broken={broken.has(c.id) ? "" : undefined}
						// A rule that says nothing at all, because a quantity it names is
						// one the program refuses to mint. Not a conflict — a document
						// full of these solves perfectly well — and not a preference
						// either; it is a rule with a bug in it, and the row has to say so
						// or nobody will ever find out.
						data-role={inert.length > 0 ? "inert-rule" : undefined}
					>
						{/* Two lines, because the panel is 260px and five controls across
						    it collapse each other to nothing. The first says how firmly the
						    rule holds and whether it holds at all; the second says what the
						    rule *is*. */}
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
							{/* First in the rule because it is the verb of the sentence the
							    rule reads as: "must — all different — fill". A preference is
							    not a different kind of rule, so it is not in the kind menu. */}
							<select
								className={styles.strength}
								data-role="constraint-strength"
								value={c.strength ?? DEFAULT_STRENGTH}
								title="Forbid this, or merely prefer it. Preferences are ranked against each other, strongest tier first."
								onChange={(e) =>
									onSceneChange((prev) =>
										updateConstraint(prev, c.id, {
											strength: e.target.value as Strength,
										}),
									)
								}
							>
								{STRENGTH_NAMES.map((strength) => (
									<option key={strength} value={strength}>
										{STRENGTHS[strength].label}
									</option>
								))}
							</select>
							{isSoft(c.strength) ? (
								<input
									type="number"
									className={styles.limit}
									data-role="constraint-weight"
									min={1}
									value={c.weight ?? 1}
									title="What breaking this costs, in points, inside its tier"
									onChange={(e) =>
										onSceneChange(
											(prev) =>
												updateConstraint(prev, c.id, {
													weight: Math.max(1, Number(e.target.value) || 1),
												}),
											`constraint-weight:${c.id}`,
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

						<div className={styles.ruleHead}>
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
									max={Math.max(1, members.length)}
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

							{/* What the rule is about: which quantity of its members, which
							    point on them, how they look, or — for a rule with no members
							    — nothing but its own name.

							    Asked of the tables and not of `spec.geometric`, because the
							    question is whether this kind reads an *edge* or a *point* and
							    exactly one of the two lists is non-empty on every kind.
							    Written as the flag, a sketch rule would have rendered an edge
							    menu with nothing in it and `value={undefined}` — a blank
							    control React logs a controlled/uncontrolled warning about,
							    sitting where the rule's subject should be. */}
							{spec.edges.length > 0 ? (
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
									{/* Narrowed by what the members actually have. `EDGES` holds
									    all fifteen quantities and a flat rectangle has ten of
									    them, so an unfiltered menu would offer a card a front
									    face — a rule the program refuses through `gnoedge/2`,
									    which means a rule that quietly does nothing. Offering
									    it and then explaining the silence is worse than not
									    offering it: `edgeOptions` is the filter and
									    `refusedEdge` is the explanation for the rules that
									    already exist. */}
									{edgesFor(c).map((edge) => (
										<option key={edge} value={edge}>
											{EDGES[edge].label}
										</option>
									))}
								</select>
							) : spec.anchors.length > 0 ? (
								<select
									className={styles.prop}
									data-role="constraint-anchor"
									// One anchor for the whole rule, not one per member — the
									// same shape `edge` has, where "align on left" is every
									// member's left. Index 4 of the nine in reading order is the
									// centre, which is the point a rule means when nobody said.
									value={c.anchor ?? spec.anchors[4]}
									title="Which point on each member this rule is about. A distance and a bearing are between points, not between edges — which is why they can be about a diagonal at all."
									onChange={(e) =>
										onSceneChange((prev) =>
											updateConstraint(prev, c.id, {
												anchor: e.target.value as Anchor,
											}),
										)
									}
								>
									{/* Unfiltered, unlike the edge menu beside it. An edge can be
									    a quantity a member does not have — a flat card has no
									    front face — and `gnoedge/2` refuses those. Every box has
									    all nine of its handles, so the only anchor a member can
									    lose is a corner it lost by being turned, and that is a
									    refusal about the *member* rather than about the menu. */}
									{spec.anchors.map((anchor) => (
										<option key={anchor} value={anchor}>
											{anchorLabel(anchor)}
										</option>
									))}
								</select>
							) : constrainsProp(c.kind) ? (
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
							) : (
								<input
									className={cx(styles.name, nameError && styles.bad)}
									data-role="constraint-name"
									spellCheck={false}
									value={named ? named.text : c.id}
									aria-invalid={nameError ? true : undefined}
									title="The term your rule writes in viol(...), and the name a conflict is reported under"
									onChange={(e) => setNaming({ id: c.id, text: e.target.value })}
									// Committed on the way out, not per keystroke: the rename
									// rewrites the user's `viol(...)` and half a name is not a
									// name. Escape drops the draft without blurring, so the
									// blur that follows sees no draft to commit.
									onBlur={() => {
										if (named && !nameError && named.text !== c.id) {
											onSceneChange((prev) =>
												renameConstraint(prev, c.id, named.text).scene,
											);
										}
										setNaming(null);
									}}
									onKeyDown={(e) => {
										if (e.key === "Enter") e.currentTarget.blur();
										if (e.key === "Escape") setNaming(null);
									}}
								/>
							)}

							<Dimension
								scene={scene}
								constraint={c}
								spec={spec}
								unit={unit}
								onSceneChange={onSceneChange}
							/>
						</div>

						{takesMembers(c.kind) ? (
							<div className={styles.memberRow}>
								{/* Members, chosen where they were always chosen. A group is
								    a set the rules named, so the choice is between "the ones
								    I picked" and "the ones a rule says belong together". */}
								{overSelect(
									c.group ?? "",
									(group) =>
										onSceneChange((prev) =>
											retargetConstraint(prev, c.id, { group }),
										),
									"constraint-over",
								)}
								<button
									type="button"
									className={styles.members}
									data-role="constraint-members"
									data-group={c.group}
									title={
										c.group === undefined
											? "Select these layers"
											: `Select the ${members.length} members of ${c.group}`
									}
									disabled={members.length === 0}
									onClick={() => onSelectionChange([...members])}
								>
									{c.group === undefined
										? `${c.nodes.map(nameOf).join(", ")} ${describe(c)}`
										: members.length === 0
											? // No answer to read them out of — an unsatisfiable
												// document has none, and that is when this is read.
												`${c.group} ${describe(c)}`
											: `${members.length} in ${c.group} ${describe(c)}`}
								</button>

								{/* A state copy cannot be selected on the canvas — it is not a
								    node, deliberately, which is what keeps it out of the layer
								    list and out of both exports — so it is the one member the
								    panel has to be able to add without a selection. A menu
								    rather than a mode: the list is short, it is exactly the
								    copies that exist, and picking one appends it the way
								    picking a group retargets. */}
								{spareStates(c).length > 0 ? (
									<select
										className={styles.kind}
										data-role="constraint-add-state"
										aria-label="Add a state copy"
										title="Name one state of one component as a member. A rule over two states of the same part — “the label does not jump when you hover” — is an ordinary rule with an unusual member: every state is true at once in this one answer set, so simplex places both."
										value=""
										onChange={(e) => {
											const term = e.target.value;
											if (!term) return;
											onSceneChange((prev) =>
												updateConstraint(prev, c.id, {
													nodes: [...c.nodes, term],
												}),
											);
										}}
									>
										<option value="">+ state…</option>
										{spareStates(c).map((term) => (
											<option key={term} value={term}>
												{nameOf(term)}
											</option>
										))}
									</select>
								) : null}
							</div>
						) : (
							<div className={styles.memberRow}>
								{/* The line the designer has to write, spelled out. The panel
								    already knows the term — it *is* the id — so making
								    somebody work it out from a name field would be gratuitous.
								    Copying rather than inserting: an unfinished rule appended
								    to the panel is a syntax error, and a syntax error is the
								    whole document gone. */}
								<button
									type="button"
									className={styles.term}
									data-role="constraint-term"
									title="Copy this, then finish it in the Your rules panel"
									onClick={() => {
										navigator.clipboard?.writeText(stub).then(
											() => {
												setCopied(c.id);
												setTimeout(
													() => setCopied((was) => (was === c.id ? null : was)),
													1500,
												);
											},
											() => setCopied(null),
										);
									}}
								>
									<code>{stub}…</code>
									<span className={styles.copy}>
										{copied === c.id ? "copied" : "copy"}
									</span>
								</button>
							</div>
						)}

						{takesMembers(c.kind) ? null : (
							<p
								className={cx(styles.note, nameError && styles.bad)}
								data-role={
									nameError
										? "constraint-name-error"
										: refs === 0
											? "constraint-unwritten"
											: "constraint-written"
								}
							>
								{nameError ??
									(refs === 0
										? describe(c)
										: `named ${refs === 1 ? "once" : `${refs} times`} in your rules`)}
							</p>
						)}

						{/* Why this rule says nothing. One sentence per refused member,
						    because two members turned two different ways are two different
						    reasons and a single line would have to pick one. Each names the
						    member whose rotation took the quantity away, which is the part
						    that makes it worth reading: the node that fails to move is
						    usually not the node somebody turned.

						    Both solvers' refusals through this one block, because the
						    reader is one person and the news is one piece: a linear rule
						    silenced by `gnoedge/2` and a sketch rule silenced by
						    `sknopoint/1` are the same disappointment, and only one of the
						    two has an edge to name. */}
						{inert.map((found) => (
							<p
								key={found.key}
								className={cx(styles.note, styles.inertNote)}
								data-role="inert-reason"
								data-member={found.member}
							>
								{found.why}
							</p>
						))}

						{/* And the opposite failure: a rule that holds exactly, about a
						    place the camera is between you and. Softer markup than the
						    inert rows on purpose — this rule works, and the design may
						    well be what its author meant. */}
						{crossing ? (
							<p
								className={cx(styles.note, styles.crossNote)}
								data-role="cross-viewport"
							>
								{crossing}
							</p>
						) : null}
					</div>
				);
			})}
		</div>
	);
}
