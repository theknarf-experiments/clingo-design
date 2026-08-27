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
 * ## The budget, and where its number lives
 *
 * The first four checks are claims about the shape of a graph and have no
 * parameter: a state is reachable or it is not. "No transition takes longer
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
import { MACHINE_CHECKS, writeDuration } from "./machines.ts";
import { type Scene, isConstraintTerm } from "./scene.ts";
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
 * machine at all, and the budget last, because it is about taste. A document can
 * hold any subset of them: each is an independent constraint with its own
 * switch, and none of them reads any of the others.
 */
export function machineChecks(
	budget: number = DEFAULT_DURATION_BUDGET_MS,
): MachineCheck[] {
	return [...MACHINE_CHECKS, durationBudgetCheck(budget)];
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
