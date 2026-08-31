/**
 * Machine verification, as rules a core can name.
 *
 * Every other design tool that knows what a state machine is will, at best, put
 * a yellow triangle beside an unreachable state. The triangle is a dead end: it
 * is not part of the document, nothing can be said about it, and the only thing
 * a person can do with it is look at it. Here a broken machine is a
 * **violation** — an ordinary `viol/1` derived against a term the document
 * gave the rule — and so it arrives with the four things a triangle can never
 * have:
 *
 *   - an enable switch, because it is a `Constraint` like any other and
 *     `active(C)` guards it;
 *   - a name in the unsat core, because that switch is an assumption and the
 *     solver echoes the assumptions it could not satisfy;
 *   - a strength, so "every state should be reachable" can be softened from a
 *     prohibition to a preference with a price, without one character of the
 *     rule changing;
 *   - `why.ts` and `relax.ts` for free, because both of those are searches over
 *     switches and this is a switch.
 *
 * None of that is new machinery and that is the whole design. The generated
 * program *derives* what is wrong with a machine — `munreached/2`,
 * `mdeadend/2`, `mnondet/3`, `mdangling/2`, `mdur/3` — and derives nothing
 * about whether that is acceptable, because it is not the compiler's business
 * to have an opinion about a document. Forbidding it is a rule of the
 * designer's, written in their own Rules panel, under their own name. This file
 * is the canned text of those rules and the one edit that puts one into a
 * document.
 *
 * ## Why a `custom` constraint and not a constraint kind of its own
 *
 * A `machineSound` kind was the obvious shape and it was rejected. A kind is a
 * vocabulary the whole tool has to learn: an entry in `CONSTRAINT_KINDS` with a
 * label, a summary, a member count, an annotation and a seed; rows in the
 * inspector; a case in `retargetConstraint` and in `pruneConstraints`; a
 * sentence in the CONTRACT. All of that to carry a rule whose entire content is
 * one line of ASP that the `custom` kind already carries exactly.
 *
 * And a kind takes something away that matters more than the tidiness it buys.
 * A kind's rule is generated, so it cannot be edited; a `custom` rule's body is
 * text in a panel, so "every state is reachable" can become "every state is
 * reachable except `disabled`" by adding one literal, and it stays the same
 * constraint with the same switch and the same name in the core. The canned
 * bodies below are a starting point a designer is meant to be able to rewrite,
 * which is precisely what `viol(no_wide_gaps) :- lgap(row,G), G > 24*emupx.`
 * in the CONTRACT is advertising.
 *
 * ## Why this file and not `machines.ts`
 *
 * `machines.ts` holds {@link MACHINE_CHECKS} because it holds
 * `machineHealth`, and the pairing is the point there: the panel's reading
 * of the document and the program's reading of the answer set have to agree, so
 * the two live side by side and `machines.test.ts` holds them equal. What is
 * here is the other half, and neither belongs in the other's file: the *edit*
 * that puts a check into a document — which is two writes, one to the
 * constraint list and one to the rules text, and a check that is in one and not
 * the other is a switch that does nothing or a rule nothing guards — and the one
 * check that cannot be a constant at all because it takes a number.
 *
 * ## The eleven, and why they arrive in two arrays
 *
 * The ladder — guards, layers, timelines and blend states — brought six more
 * findings that the generated program derives and has no opinion about, and each
 * of them is one more line of ASP under one more name. They live in
 * {@link LADDER_CHECKS} rather than at the end of {@link MACHINE_CHECKS}, and
 * `machines.ts` documents that split as temporary with a trigger: the six bodies
 * name predicates that arrived with the ladder's compile step, so offering them
 * before that step landed would have written rules into `scene.rules` that clingo
 * remarks on once per undefined predicate — a diagnostic the studio shows to the
 * designer as a problem with *their* document.
 *
 * That step has landed, and this is the single call site the split was always
 * going to be closed at. It is closed here, by a spread, rather than by deleting
 * one array into the other, and the difference is one of ownership rather than
 * taste: this file is the only reader of either array, `machineChecks()` is the
 * only function that returns a list of checks, and a spread at the one place
 * they are read is the same eleven with no edit to a file that has its own
 * tests holding its own contents. The comment on {@link LADDER_CHECKS} asks for
 * the paste; the paste and the spread produce the identical array, and whoever
 * makes it need change nothing here.
 *
 * The order is §7.6 of the ladder spec's, and it is an argument rather than a
 * list. The four graph checks first, because they are about whether the machine
 * is a machine at all — a state nothing reaches is broken however the guards
 * read. The six structural ones next, in the order the rungs were built, because
 * each of them is about a thing the document says on top of the graph. The budget
 * last, because it is the only one about taste.
 *
 * ## What the six new ones buy that a linter could not
 *
 * The same thing the budget buys and for the same reason — but it is worth being
 * exact about which of the six it is true of, rather than claiming it for all six
 * and being wrong about four of them.
 *
 * **Two of the six read numbers this universe resolved**, not numbers the
 * document stores. An exit time is `mexit/3`, which followed a `duration` Value
 * through `resolved/2` and which the program `#project`s, so a debounce scale
 * with a brisk end and a slow one really is two designs. A timeline's length is
 * `mtlen/3`, a `#max` over keyframe times that are themselves `Value`s, so an
 * animation can be short in one design and long in another and a transition can
 * outlast it in one and not the other. Both are checked at *both* ends, and the
 * design that breaks the rule is the thing that goes — not the rule, and not an
 * average of the two. A pass over `scene.machines` could not do that, because
 * there is no single document to make the pass over: there are as many as the
 * tokens multiply out to, and 600ms is perfectly fine in one of them.
 * `machinecheck.test.ts` proves both by solving rather than by asserting it here.
 *
 * **The other four read things the document fixes.** A guard's comparand
 * (`Condition.value`), an input's declared range (`MachineInput.min`/`max`) and a
 * blend stop's threshold (`BlendStop.at`) are all plain strings in the scene, and
 * a fight is a fact about which layer a state belongs to. A linter genuinely
 * could have found those four, and pretending otherwise would be selling the rung
 * on a property it has not got. What being a constraint buys *them* is the other
 * half of the feature, which is the half a linter has never had: a name in an
 * unsat core, a switch, a strength that can be softened, and `why.ts` and
 * `relax.ts` for nothing. And it buys it under one mechanism for all six rather
 * than two mechanisms for two groups — so the day a comparand becomes a `Value`,
 * which is the obvious next thing to want, those four join the first two and not
 * one character of this file changes.
 *
 * ## The budget, and where its number lives
 *
 * The first ten checks are claims about the shape of a graph, a guard, a layer,
 * a blend or a clock, and none of them has a parameter: a state is reachable or
 * it is not, a guard can be met or it cannot. "No transition takes longer
 * than 400ms" is not that. It is a house rule with a number in it, and the
 * number belongs to the document rather than to this file.
 *
 * The number is written **into the rule text** rather than into the
 * constraint's `Constraint.value`, and both readings were tried. A value
 * would make the budget an ordinary `Value` — linkable to a token, and a
 * token with two alternatives would be two documents, one strict about motion
 * and one relaxed. That is genuinely attractive and it is not what a budget is:
 * a budget is the thing the alternatives are judged against, and a document
 * holding two of them at once is not exploring a design space, it is failing to
 * decide. It is also not reachable from here — `c_value/2` is derived through
 * `numeral/2`, which reads EMU, and there is no bridge from a constraint's value
 * to `millis/2`; building one is a change to the generated program, and this
 * check does not need the program changed.
 *
 * So the budget is in the sentence the designer reads, in the panel where they
 * can change it, and `viol(machine_within_budget) :- mdur(_,_,Ms), Ms > 400.`
 * is a rule that explains itself to somebody who has never read this file.
 *
 * ## What the bodies are anonymous about, and why
 *
 * Every body below quantifies over the whole document — `mdur(_,_,Ms)`, not
 * `mdur(m1,_,Ms)`. A check is a claim about the *document*: "no transition
 * anywhere in this file crawls". Scoping one to a single machine is an edit to
 * the rule, which is a thing the Rules panel already is for, and which produces
 * a rule that still has its own name and its own switch. The alternative —
 * one constraint per machine, minted and deleted as machines come and go —
 * would put the tool in the business of writing and unwriting the user's rules
 * behind them.
 */
import { addCustomConstraint, deleteConstraint, violRefs } from "./edits.ts";
import {
	LADDER_CHECKS,
	MACHINE_CHECKS,
	type MachineHealth,
	findState,
	machineHealth,
	machineLayers,
	stateName,
	statePlays,
	timelineLength,
	transitionExit,
	writeDuration,
} from "./machines.ts";
import { type Machine, type Scene, isConstraintTerm, motionMs } from "./scene.ts";
import { MAX_MS } from "./values.ts";

/**
 * One canned verification rule: the term it answers to, how it reads, and the
 * ASP that derives it.
 *
 * Structurally what {@link MACHINE_CHECKS} already holds, named here so that the
 * four constants and the one the budget builds are one type with one contract:
 * `id` is *both* the constraint's term and the head of `rule`, because for a
 * `custom` constraint those are one thing. A second identity would have to be
 * mapped back at every hop — the switch, the core, the panel's guilty row — and
 * the core would end up naming something the document does not hold.
 */
export interface MachineCheck {
	/** An ASP constant, unique in the document, and the head of {@link rule}. */
	id: string;
	/** How the check reads in the list of rules. */
	label: string;
	/** One line, ending in a full stop: `viol(id) :- ...`. */
	rule: string;
}

/**
 * The motion budget a document gets when nobody has said otherwise.
 *
 * 400ms because that is roughly where a transition stops reading as feedback
 * and starts reading as an animation somebody has to wait for — twice the
 * `MOTION_PROPS.duration` fallback of 200ms, so a document that never touches
 * its durations passes with room to spare and the check only fires on a number
 * a person typed. A default that failed the untouched case would be a check
 * nobody could leave switched on.
 */
export const DEFAULT_DURATION_BUDGET_MS = 400;

/**
 * A whole number of milliseconds that gringo can read, or the default.
 *
 * Three things get repaired here and each of them would otherwise produce text
 * that is not a program. A fractional budget spells `Ms > 399.5`, and ASP has no
 * floats; a non-finite one spells `Ms > NaN`, which is a syntax error that would
 * take the *whole document* down rather than the rule; and a negative one is a
 * budget no duration can meet, since `mdur/3` clamps at zero, so it reads as
 * "no transition at all may exist" — which is a sentence somebody might mean but
 * never one they meant to say by typing a minus.
 *
 * The rounding is the same editorial act `writeDuration` makes and it is made
 * for the same reason: the contract is whole milliseconds, and the alternative
 * to rounding is refusing, which would leave the designer with a number in the
 * field and no rule in the document.
 */
function wholeBudget(ms: number): number {
	if (!Number.isFinite(ms)) return DEFAULT_DURATION_BUDGET_MS;
	return Math.min(MAX_MS, Math.max(0, Math.round(ms)));
}

/**
 * "No transition takes longer than `ms`", as a rule.
 *
 * Reads `mdur/3`, which is the duration **this universe resolved to** rather
 * than the text the document stores — so a `duration` token with two
 * alternatives is checked at both ends, and a design that only breaks the budget
 * in the slow half of a motion scale is found rather than averaged away. That is
 * the thing a linter over the document could not do, and it is why this check is
 * a rule and not a function.
 *
 * Strictly greater, so a budget of 400 admits a 400ms transition: a budget is a
 * limit somebody is allowed to reach, and a check that fired on the number in
 * its own label would be read as a bug every time.
 *
 * Every transition is covered, including the ones that say nothing about their
 * own duration: `mdur/3` falls back to `mdefdur/1`, so the default pacing is
 * measured against the budget exactly as a typed one is. A check that only
 * looked at durations somebody wrote down would pass a document by staying
 * ignorant of most of it.
 */
export function durationBudgetCheck(
	ms: number = DEFAULT_DURATION_BUDGET_MS,
): MachineCheck {
	const budget = wholeBudget(ms);
	return {
		id: "machine_within_budget",
		label: `No transition longer than ${writeDuration(budget)}`,
		rule: `viol(machine_within_budget) :- mdur(_,_,Ms), Ms > ${budget}.`,
	};
}

/**
 * Every check the Machines panel offers, in the order it offers them.
 *
 * The four graph checks first, because they are about whether the machine is a
 * machine at all; the six the ladder added next, in the order the rungs were
 * built; the budget last, because it is about taste. See the file comment for
 * why the first ten arrive in two arrays and why they are joined here.
 *
 * A document can hold any subset of them: each is an independent constraint with
 * its own switch, and none of them reads any of the others. **They are not
 * independent about what they fire on**, though, and that is a property of the
 * findings rather than of this list — `machine_states_live` is strictly stronger
 * than `machine_reachable`, so a document with a state nothing reaches breaks
 * both, and the way out `relax.ts` offers is to let go of both. That is the
 * honest answer and not a wart: a designer who switched two rules on that say
 * overlapping things has to switch two rules off to be rid of the overlap, and a
 * search that hid one of them would be offering a way out that does not work.
 */
export function machineChecks(
	budget: number = DEFAULT_DURATION_BUDGET_MS,
): MachineCheck[] {
	return [...MACHINE_CHECKS, ...LADDER_CHECKS, durationBudgetCheck(budget)];
}

/**
 * The `viol(id) :- ... .` line, however the body was subsequently edited.
 *
 * Matched on the *head* rather than on the whole text, which is the decision
 * that makes {@link addMachineCheck} an update as well as an insert and
 * {@link removeMachineCheck} able to take away a rule the designer has been
 * working on. The trailing full stop is part of the pattern so that only a
 * complete one-line rule matches: a body somebody has spread over several lines
 * is left exactly where it is, and the constraint going away turns it into an
 * unguarded `viol/1`, which the CONTRACT already says does nothing at all. That
 * is a worse outcome than a clean removal and a better one than a rules panel
 * this file has silently cut in half.
 */
function headPattern(id: string): RegExp {
	return new RegExp(`^viol\\(\\s*${id}\\s*\\)\\s*:-.*\\.$`);
}

/**
 * True when the document holds this check: a constraint answering to its name,
 * and a rule that says so.
 *
 * Both halves, because either alone is the broken state rather than a partial
 * one. A constraint with no rule is a switch that cannot ever fire — it looks on
 * in the panel and verifies nothing. A rule with no constraint is never guarded
 * and so never fires either. A checkbox has to be showing whether the check is
 * *working*, and the honest answer to "half of it is here" is no.
 *
 * {@link violRefs} is a substring search and is honest only about what it
 * measures, exactly as its own comment says: a body reached indirectly counts
 * zero. That under-reports, which is the safe direction here — the worst it
 * causes is {@link addMachineCheck} writing a canned rule the designer will see.
 */
export function hasMachineCheck(scene: Scene, check: MachineCheck): boolean {
	return (
		scene.constraints.some((c) => c.id === check.id) &&
		violRefs(scene.rules, check.id) > 0
	);
}

/**
 * Puts a check into the document — the constraint and the rule, in one edit.
 *
 * Idempotent about the constraint and **authoritative about the rule**: if a
 * line already answers to this head it is replaced with the text passed in. That
 * asymmetry is the one judgement call in this file, and it is what makes the
 * budget field work. Changing the budget is calling this again with a different
 * `durationBudgetCheck`, and a version that respected an existing line would
 * leave the designer typing into a number that does not reach the solver.
 *
 * The cost is that re-adding a check whose body somebody has edited restores the
 * canned one. Which is what re-adding a canned check ought to mean, and it is
 * reachable only from a deliberate click: nothing calls this on a redraw.
 *
 * No comment line is written above the rule. The label is already beside the
 * constraint in the rules list, and a second copy of it in the rules text would
 * be a second place saying the same thing — one that goes stale the moment the
 * budget changes, and one this file would then have to find and remove again.
 * `viol(machine_within_budget) :- mdur(_,_,Ms), Ms > 400.` explains itself.
 *
 * An id ASP cannot spell is refused with the document untouched, the same
 * refusal `addCustomConstraint` makes and for the same reason — but silently,
 * because unlike a name a person typed this one came from a table and there is
 * nobody to tell.
 */
export function addMachineCheck(scene: Scene, check: MachineCheck): Scene {
	if (!isConstraintTerm(check.id)) return scene;

	const held = scene.constraints.some((c) => c.id === check.id);
	// `addCustomConstraint` mints under a generated id and renames, so the rename
	// carries any `viol(id)`/`active(id)` the rules already say — which is exactly
	// the case where a rule was written before the constraint existed. Nothing is
	// rewritten here because the id we ask for is the id we get.
	const withConstraint = held ? scene : addCustomConstraint(scene, check.id).scene;

	const pattern = headPattern(check.id);
	// The first line under this head becomes the rule, and any further ones go.
	// Several lines under one head are several ways to violate the same rule,
	// which is legal ASP and a thing a person may have meant — but this call is a
	// statement about what the check *is*, and leaving a second disjunct behind
	// would make the panel's number field turn a budget into a floor.
	let replaced = false;
	const lines: string[] = [];
	for (const line of withConstraint.rules.split("\n")) {
		if (!pattern.test(line.trim())) {
			lines.push(line);
			continue;
		}
		if (replaced) continue;
		replaced = true;
		lines.push(check.rule);
	}
	if (replaced) return { ...withConstraint, rules: lines.join("\n") };

	const rules = withConstraint.rules;
	const gap = rules.length === 0 || rules.endsWith("\n") ? "" : "\n";
	return { ...withConstraint, rules: `${rules}${gap}${check.rule}\n` };
}

/**
 * Takes a check back out: the constraint, and the line that derives it.
 *
 * Both, because {@link deleteConstraint} alone would leave a `viol/1` whose term
 * is no constraint — which the CONTRACT documents as doing nothing, so the
 * document would still be correct and the Rules panel would still be showing a
 * line that has quietly stopped meaning anything. That is the shape of orphan a
 * rename was taught to avoid, and unticking a checkbox should not create one.
 *
 * Unknown checks and half-held ones are handled by doing whichever half there is
 * to do: the two operations are independent and neither needs the other to have
 * succeeded.
 */
export function removeMachineCheck(scene: Scene, check: MachineCheck): Scene {
	if (!isConstraintTerm(check.id)) return scene;
	const pattern = headPattern(check.id);
	const rules = scene.rules
		.split("\n")
		.filter((line) => !pattern.test(line.trim()))
		.join("\n");
	return { ...deleteConstraint(scene, check.id), rules };
}

/* ------------------------------------------------------------------ */
/* What the panel says a check has found                               */
/* ------------------------------------------------------------------ */

/**
 * "a, b and c" — an English list, because these are read as a sentence rather
 * than scanned as a column. `why.ts` has the same three lines and they are not
 * shared: exporting a comma from one file into another is a dependency between
 * two things that have nothing to do with each other, and the day one of them
 * wants an Oxford comma is the day it should be free to have one.
 */
function series(parts: readonly string[]): string {
	if (parts.length <= 1) return parts[0] ?? "";
	return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * What the six ladder checks have found in one machine, as the sentence beside
 * the checkbox — or nothing, when they have found nothing.
 *
 * ## Why the panel *reports* what it does not *forbid*
 *
 * This is the half of the feature that is not a constraint, and it is the half
 * that makes the constraint bearable. A tick box that forbade something without
 * first saying whether it was happening would be a switch a designer flips to
 * find out, and finding out would cost them their canvas: `machine_layers_agree`
 * on a document where two layers really do both animate `opacity` is an empty
 * screen and an unsat core. So the finding is always visible and the ban is
 * always optional, and a fight — the one Rive resolves silently and never
 * mentions — is a sentence in a panel whether or not anybody has forbidden it.
 *
 * ## Why this wording lives in `design-core` and not in the panel
 *
 * `describeExplanation` in `why.ts` for exactly the same reason: there is one
 * right answer, and two readers would eventually disagree about it. A fight in
 * particular has an ordering in it — *which* layer wins — and that ordering is
 * the position of a layer in {@link Machine.layers}, which a panel would have to
 * re-derive and could re-derive backwards. Getting it backwards would name the
 * wrong layer as the winner while the canvas drew the other one, which is worse
 * than saying nothing.
 *
 * ## Six and not eleven
 *
 * Only the six the ladder added. The four graph checks already have a sentence in
 * the Machines panel, written when they shipped, and a second spelling of "Ghost
 * cannot be reached" here would be a second spelling that drifts. The budget is
 * not answerable from a document at all: what a transition takes is `mdur/3` in
 * an answer set, which is why the panel is handed a `Timing` table and this
 * function is not. So the contract is precise — *the six the ladder added, and
 * `null` for everything else, including a check id this file has never heard of*
 * — and a caller spells it as a fallback after its own cases.
 *
 * ## The document's reading, not the answer set's
 *
 * Everything here comes off {@link machineHealth} and its neighbours, which read
 * `scene.machines` with no `ResolveContext` — the same two-readers arrangement
 * `machines.ts` documents at length, and it is deliberate here for one reason
 * beyond consistency: **a finding must be showable before there is an answer
 * set.** The panel draws while the solver is unsatisfiable, which is precisely
 * when a check has fired and a designer most wants the sentence. Where a duration
 * or a threshold names a token with two alternatives the two readings can differ,
 * and the check is the one that is authoritative — it saw every universe and this
 * saw the document's own first reading. That is the same gap `machineHealth` has
 * carried since it shipped and the same one `machines.test.ts` pins.
 */
export function machineCheckFinding(
	check: string,
	machine: Machine,
	health: MachineHealth = machineHealth(machine),
): string | null {
	const names = (ids: readonly string[]) =>
		series(ids.map((id) => stateName(machine, id)));

	switch (check) {
		case "machine_guards_possible": {
			if (health.impossible.length === 0) return null;
			// Transition ids raw, the way `machine_wired` already reports a dangling
			// edge: a transition has no name field, and inventing "the edge from Rest
			// to Hover" would be a second name for a thing the row above calls `over`.
			return `${series(health.impossible)} can never be taken`;
		}

		case "machine_states_live": {
			if (health.unreachableWithGuards.length === 0) return null;
			// Deliberately **not** the difference against `unreachable`. Subtracting
			// what the reachability row already said would read better and would lie
			// in the one case that matters: a document whose only unreachable states
			// are unreachable both ways would leave this row saying "holds" while its
			// rule was making the document unsatisfiable.
			return `${names(health.unreachableWithGuards)} cannot be reached once the guards are read`;
		}

		case "machine_layers_agree": {
			const layers = machineLayers(machine);
			const rank = (id: string) => layers.findIndex((layer) => layer.id === id);
			const label = (id: string) =>
				layers.find((layer) => layer.id === id)?.name ?? id;
			// The three fight families in one sentence, because they are one finding:
			// a designer who is told two layers fight over `fill` and not that they
			// also fight over `x` fixes half of it and comes back.
			const all = [...health.fights, ...health.frameFights, ...health.turnFights];
			if (all.length === 0) return null;
			return series(
				all.map(([first, second, part, field]) => {
					// `mfight/5` states its pair in TERM order — `L1 < L2` is there to
					// state a fight once rather than twice — so the winner is read from
					// the layer list and never from the argument positions. Getting this
					// backwards would name the loser as the winner while the canvas drew
					// the winner.
					const winner = rank(first) >= rank(second) ? first : second;
					const loser = winner === first ? second : first;
					return `${label(winner)} beats ${label(loser)} over ${part}'s ${field}`;
				}),
			);
		}

		case "machine_blend_in_range": {
			if (health.stopsOutOfRange.length === 0) return null;
			return series(
				health.stopsOutOfRange.map(
					// `+ 1` because `mstopat/4` and `mstopout/3` number a blend's stops
					// from one and `MachineHealth` records the array index. The two
					// disagree, `machines.ts` owns that, and a panel that echoed the
					// index would send a designer to the wrong row of a list they can
					// see — so the number shown is the program's.
					([state, index]) =>
						`stop ${index + 1} of ${stateName(machine, state)} is outside its input's range`,
				),
			);
		}

		case "machine_exit_within_duration": {
			const late = machine.transitions.filter((transition) => {
				if (!transition.enabled) return false;
				return (
					transitionExit(machine, transition) >
					motionMs(machine, transition, "duration")
				);
			});
			if (late.length === 0) return null;
			return series(
				late.map(
					(transition) =>
						`${transition.id} waits ${writeDuration(transitionExit(machine, transition))} to run for ${writeDuration(motionMs(machine, transition, "duration"))}`,
				),
			);
		}

		case "machine_exit_before_end": {
			const stranded: string[] = [];
			for (const transition of machine.transitions) {
				if (!transition.enabled) continue;
				const exit = transitionExit(machine, transition);
				if (exit === 0) continue;
				const from = findState(machine, transition.from);
				if (!from) continue;
				for (const timeline of statePlays(machine, from)) {
					// A looping timeline never ends, so no exit time is past it —
					// `mloop(M,W,none)` is in the rule's body for the same reason.
					// Reporting one would be reporting a bug against a design that works.
					if ((timeline.loop ?? "none") !== "none") continue;
					const length = timelineLength(machine, timeline);
					if (exit <= length) continue;
					stranded.push(
						`${transition.id} waits ${writeDuration(exit)}, but ${stateName(machine, from.id)} is over in ${writeDuration(length)}`,
					);
					// One sentence per transition, not one per timeline it could have
					// waited past: a blend state plays several and a designer fixes the
					// one number in the one field either way.
					break;
				}
			}
			return stranded.length === 0 ? null : series(stranded);
		}

		default:
			return null;
	}
}
