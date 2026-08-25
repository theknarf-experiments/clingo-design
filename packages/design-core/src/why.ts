/**
 * Why is this blue?
 *
 * The tool can already explain why there is *no* design: an unsatisfiable
 * answer comes back with a core, the core names switches, and `findWays` says
 * what to let go of. Nothing could explain anything about a design that exists
 * — which is the question the canvas actually provokes, because a rule that
 * mints alternatives and greys the rest out is a machine for producing dead
 * ends. A swatch the solver has ruled out is currently a tooltip and no
 * recourse.
 *
 * ## The question, and why it is one question
 *
 * Two things a designer asks about a value turn out to be the same query with
 * the sign flipped:
 *
 *  - *Why can it not be that?* — assume `pick(V,I)` and watch it fail.
 *  - *Why is it this?* — assume `pick(V,I)` **false** and watch that fail.
 *
 * Both ask the solver to entertain something and come back unsatisfiable, and
 * both therefore have a *core*: switches that cannot hold together with the
 * wish. So one primitive answers both, and the difference is one boolean. See
 * {@link questionAtom}.
 *
 * ## Abduction rather than a derivation tree
 *
 * The reason wanted is not the proof. A resolution proof of "no design puts
 * blue here" runs through the whole grounding and mentions nothing a designer
 * typed. What they can act on is much smaller: *which of the things I switched
 * on already rule this out*. That is abduction over the assumptions, and it
 * needs no new solver machinery — the same trick `probeFreedom` plays, one
 * question per solve on the grounding that is already open.
 *
 * ## Cores are not minimal, and this is where that bites hardest
 *
 * Measured on the palette template with one swatch pinned: asking for a second
 * button to take the pinned colour comes back with a core of five, two of them
 * switches — the `differ` rule and the pin. Asking for the *pinned* button to
 * take a different colour comes back with the same core, and there the `differ`
 * rule has nothing to do with it: the pin alone forbids it. A tool that read
 * the core out loud would blame an innocent rule half the time.
 *
 * So the core is a starting set and not an answer, and the search below spends
 * solves turning it into one:
 *
 *  1. **Is it even impossible?** One solve. A greyed swatch that comes back
 *     satisfiable is not forbidden at all — it is a duplicate, collapsed by
 *     `#project` because it renders the same design as another value. The old
 *     tooltip had to offer both readings as a guess; this settles it.
 *  2. **Is any of it ours?** One solve with *every* switch let go. Still
 *     unsatisfiable means no combination of them can help, and the honest
 *     answer is that the reason is somewhere the user has no switch for — the
 *     document's own structure, or a rule they wrote by hand. That boundary is
 *     the whole reason the `custom` constraint kind exists, and this is where
 *     the UI gets to say so.
 *  3. **Does one switch do it alone?** One solve per switch, with that switch
 *     the only one held. Exhaustive over the switches, so when it finds any
 *     they are *all* the single-switch reasons there are, and when it finds
 *     none that is a proved fact worth a sentence: no one rule is responsible.
 *  4. **Otherwise, shrink the core.** Delete-one-at-a-time until every
 *     survivor is necessary. Minimal, though not necessarily smallest — the
 *     sudoku evidence below says that is the honest shape of the answer anyway.
 *
 * ## Several reasons, said as several
 *
 * A design tool must not pick one cause and imply it is the cause. On the
 * sudoku, a pencil mark going dim in the top-left cell has `active(box1)`
 * ruling it out on its own — "box one already has a 3" — *and* keeps being
 * ruled out after that rule is switched off, by a chain through a row and three
 * boxes. Both are true. So the search keeps going after it has an answer:
 * whatever it found is dropped and the question asked again, and a second
 * reason that survives that is genuinely independent of the first.
 *
 * Which makes the remedy a hitting set rather than a list, and
 * {@link Explanation.sufficient} is the one solve that checks it: let go of the
 * reasons found and see whether the wish is granted. False means something the
 * search did not name is also in the way — an answer that is still true, just
 * not the whole truth, and the panel says which it has.
 *
 * ## Cost
 *
 * Roughly `3 + switches` solves, which on the sudoku's 27 rules measured at
 * 50–110ms — about half an exploration. That is a click and never a keystroke:
 * nothing here runs on an edit, and nothing here is computed for a row nobody
 * asked about.
 */
import { unsigned } from "./atoms.ts";
import type { Switch } from "./relax.ts";
import type { Assumption, SolverSession } from "./solver.ts";

/**
 * What a designer points at.
 *
 * `alternative` is the greyed swatch — "no design uses this, why not". `value`
 * is the live one — "this came out blue, what made it". They differ only in the
 * sign of the assumption the solver is handed, which is why they are one type.
 */
export type Question =
	| { kind: "alternative"; variable: string; index: number }
	| { kind: "value"; variable: string; index: number };

/**
 * The wish, as the solver reads it.
 *
 * `1 { pick(V,I) : alt(V,I) } 1` is what makes the negative form work: exactly
 * one alternative holds, so forbidding this one is asking for any of the
 * others, and an unsatisfiable answer means there are no others to be had.
 */
export function questionAtom(question: Question): Assumption {
	return {
		atom: `pick(${question.variable},${question.index})`,
		sign: question.kind === "alternative",
	};
}

/**
 * One minimal set of switches that already settles the matter.
 *
 * Minimal is the load-bearing word: every member is necessary, so letting go of
 * *any single one of them* defeats this reason. That is what makes a reason
 * actionable without a second search — but only this reason, since another may
 * be waiting behind it.
 */
export interface Reason {
	/** Constraint ids. Switching one off is a document edit. */
	rules: string[];
	/** Pinned variables. Releasing one is not an edit at all. */
	pins: string[];
	/**
	 * True when nothing here is a document edit — the reason is entirely the
	 * user's own pins, and they can stop asking.
	 *
	 * Its own field for the reason `Relaxation.free` is: it decides the order
	 * these are offered in, and a caller should not have to re-derive it.
	 */
	free: boolean;
}

export type Verdict =
	/** The solver allows it. A greyed swatch here is a duplicate, not a ban. */
	| "possible"
	/** Impossible, and the switches the user owns are why. */
	| "forced"
	/** Impossible whatever the user switches off. Not their rules' doing. */
	| "unattributable";

export interface Explanation {
	verdict: Verdict;
	/**
	 * Every reason found, the ones that cost nothing to break first and the
	 * smallest after that. Empty unless the verdict is `forced`.
	 */
	reasons: Reason[];
	/**
	 * True when every reason listed is one switch — which is minimum, not merely
	 * minimal, and was proved by looking at every switch there is.
	 *
	 * False is a statement too, and a strong one: no single thing the user
	 * switched on accounts for this, so the reason listed is a *combination*
	 * that only holds together.
	 */
	smallest: boolean;
	/**
	 * True when letting go of one thing from each reason listed is enough —
	 * checked by a solve, not inferred.
	 *
	 * The difference between "this is why" and "this is part of why". A sudoku
	 * exclusion is usually the second, and saying the first there would be a
	 * lie the user discovers by switching a rule off and watching nothing
	 * change.
	 */
	sufficient: boolean;
	/** Solver round trips spent. Worth showing: this is a question with a price. */
	solves: number;
}

export interface WhyOptions {
	/**
	 * The assumptions the exploration ran under — the same ones, or the answer
	 * is about a different document.
	 */
	base: readonly Assumption[];
	/** The switches the user owns: constraint guards and pins. */
	owned: readonly Switch[];
	/** What is being asked about. */
	want: Assumption;
	/** Independent reasons to look for at most. */
	limit?: number;
	/** Solves to spend at most. */
	budget?: number;
}

const DEFAULTS = {
	/**
	 * Three reasons is already "several things independently force this", which
	 * is the message; a fourth adds no meaning and costs a core shrink.
	 */
	limit: 3,
	/**
	 * The single-switch sweep is one solve per switch, and a bare solve on the
	 * documents measured is one to three milliseconds. 128 covers every template
	 * with room to spare, and a document past it gets a truthful partial answer
	 * rather than a hang — running short shows up as `sufficient: false`, because
	 * sufficiency is proved by a solve rather than assumed from the search.
	 */
	budget: 128,
};

/** A set of switch atoms, read as the thing the panel shows. */
function reasonOf(atoms: readonly string[], owned: Map<string, Switch>): Reason {
	const rules: string[] = [];
	const pins: string[] = [];
	for (const atom of atoms) {
		const s = owned.get(atom);
		if (!s) continue;
		(s.free ? pins : rules).push(s.id);
	}
	return { rules, pins, free: rules.length === 0 };
}

/** Free reasons first, then the smallest — the order they are worth reading in. */
function rank(a: Reason, b: Reason): number {
	if (a.free !== b.free) return a.free ? -1 : 1;
	return a.rules.length + a.pins.length - (b.rules.length + b.pins.length);
}

/**
 * Why an atom cannot hold — or the news that it can.
 *
 * `want` is asked for on top of `base` with some of `base`'s switches taken
 * away; nothing else about the program changes, so this runs on the grounding
 * an exploration already left open. See the file comment for the shape of the
 * search and what each step buys.
 */
export async function explain(
	session: SolverSession,
	options: WhyOptions,
): Promise<Explanation> {
	const limit = options.limit ?? DEFAULTS.limit;
	const budget = options.budget ?? DEFAULTS.budget;
	const owned = new Map(options.owned.map((s) => [s.atom, s]));
	const want = options.want;
	let solves = 0;

	/** One solve holding exactly `keep` of the switches, plus the wish. */
	const ask = async (keep: (atom: string) => boolean) => {
		solves++;
		return session.solve({
			models: 1,
			assumptions: [
				...options.base.filter((a) => !owned.has(a.atom) || keep(a.atom)),
				want,
			],
		});
	};

	const asIs = await ask(() => true);
	if (asIs.result !== "UNSATISFIABLE") {
		return { verdict: "possible", reasons: [], smallest: true, sufficient: true, solves };
	}

	// Everything let go of at once. Still impossible means no switch is at fault
	// and there is nothing to search for — the reason lives in the document's
	// structure or in a rule with no name to blame.
	const without = await ask(() => false);
	if (without.result === "UNSATISFIABLE") {
		return {
			verdict: "unattributable",
			reasons: [],
			smallest: false,
			sufficient: false,
			solves,
		};
	}

	// Every switch that does it on its own. Exhaustive, so finding none is a
	// proof rather than a failure to look.
	const singles: string[] = [];
	for (const s of options.owned) {
		if (solves >= budget) break;
		const only = await ask((atom) => atom === s.atom);
		if (only.result === "UNSATISFIABLE") singles.push(s.atom);
	}

	// Every single-switch reason is listed, however many there are: the sweep
	// found all of them, they are equally cheap to name, and dropping one for
	// tidiness would make the sufficiency check below report a gap that is only
	// this function's discretion. `limit` bounds the expensive branch instead.
	const found: string[][] = singles.map((atom) => [atom]);
	const smallest = singles.length > 0;

	if (found.length === 0) {
		// No one switch is responsible, so the reason is a combination. Shrink the
		// core into one, then ask again with it gone: a second reason that survives
		// that is independent of the first by construction.
		let core = asIs.core;
		while (found.length < limit && solves < budget) {
			const taken = new Set(found.flat());
			let candidates = core
				.map(unsigned)
				.filter((atom) => owned.has(atom) && !taken.has(atom));
			if (candidates.length === 0) break;
			for (const drop of [...candidates]) {
				if (solves >= budget) break;
				const trial = new Set(candidates.filter((a) => a !== drop));
				const out = await ask((atom) => trial.has(atom));
				if (out.result === "UNSATISFIABLE") candidates = [...trial];
			}
			found.push(candidates);
			if (solves >= budget) break;
			const next = new Set([...found.flat()]);
			const again = await ask((atom) => !next.has(atom));
			if (again.result !== "UNSATISFIABLE") break;
			core = again.core;
		}
	}

	// Whether the answer is the whole answer: let go of one thing from each
	// reason — all of them, since a reason is minimal — and see.
	const relaxed = new Set(found.flat());
	const check = solves < budget ? await ask((atom) => !relaxed.has(atom)) : null;
	const sufficient = check !== null && check.result !== "UNSATISFIABLE";

	const reasons = found
		.map((atoms) => reasonOf(atoms, owned))
		.filter((r) => r.rules.length + r.pins.length > 0)
		.sort(rank);

	// The shrink found nothing of the user's after all: the core named switches
	// that turned out unnecessary, and what is left is not theirs to fix.
	if (reasons.length === 0) {
		return {
			verdict: "unattributable",
			reasons: [],
			smallest: false,
			sufficient: false,
			solves,
		};
	}
	return { verdict: "forced", reasons, smallest, sufficient, solves };
}

/** How to spell the two kinds of switch in the reader's own vocabulary. */
export interface WhyNames {
	/** A constraint id as the panel names that rule. */
	rule: (id: string) => string;
	/** A variable key as the thing it holds. */
	pin: (variable: string) => string;
}

/** "a, b and c" — an English list, because these are read as a sentence. */
function series(parts: readonly string[]): string {
	if (parts.length <= 1) return parts[0] ?? "";
	return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function reasonWords(reason: Reason, names: WhyNames): string {
	return series([
		...reason.rules.map(names.rule),
		...reason.pins.map((v) => `your pin on ${names.pin(v)}`),
	]);
}

/**
 * An explanation as the sentence the panel shows.
 *
 * Here rather than in the app for the reason `describeCosts` is here: there is
 * one right answer and two readers would eventually disagree about it. The
 * wording is load-bearing — every clause is one of the honesty fields, and
 * dropping any of them turns a partial answer into a claim.
 *
 * Names come from the caller because only the document knows them: a rule is
 * "Fill all different on Starter, Team…" and never `k_distinct`, and a pin is
 * the value it holds and never `prop(one,fill)`.
 */
export function describeExplanation(
	question: Question,
	explanation: Explanation,
	names: WhyNames,
): string {
	const asking = question.kind === "alternative";
	if (explanation.verdict === "possible") {
		// Nothing forbids it, so for a greyed swatch the grey means the other
		// thing it can mean: `#project` collapsed it into a design already shown.
		return asking
			? "Nothing rules this out. It is greyed because it produces a design already on the canvas — the same picture, written a different way."
			: "Nothing forces this. Other values are legal here; this design simply picked one.";
	}
	if (explanation.verdict === "unattributable") {
		return asking
			? "Nothing you can switch off makes this possible. The reason is in the document itself or in a rule with no switch — only rules with an enable switch can be blamed by name."
			: "Nothing you can switch off would change this. It is the only value the program allows.";
	}

	const list = explanation.reasons.map((r) => reasonWords(r, names));
	const verb = asking ? "rules this out" : "forces this";
	// Capitalised here rather than in CSS: `text-transform` would shout an ASP
	// term, and the first word is a rule's own name as often as it is "your".
	const up = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
	const lead =
		explanation.smallest && list.length === 1
			? `${up(list[0])} ${verb}.`
			: explanation.smallest
				? `${up(series(list))} each ${verb} on their own.`
				: list.length === 1
					? `Nothing on its own ${verb}. ${up(list[0])} together do.`
					: // Several groups run to a paragraph nobody reads — a sudoku
						// exclusion can name fifteen rules in three chains. Broken onto
						// lines, which the panel renders as lines.
						`Nothing on its own ${verb}. ${list.length} independent groups do:\n${list
							.map((words) => `• ${up(words)}`)
							.join("\n")}`;

	// The closing clause is the whole honesty of this: "these are the reasons"
	// and "these are among the reasons" are different sentences, and which one
	// is true was settled by a solve. A reason is minimal, so any one member of
	// it defeats it — and with several reasons that becomes one from each.
	const outcome = asking ? "make it available" : "let it change";
	const single = explanation.reasons.length === 1;
	const close = !explanation.sufficient
		? "Something else does too, so this is part of the reason rather than all of it."
		: single && explanation.reasons[0].rules.length + explanation.reasons[0].pins.length === 1
			? `Let go of it to ${outcome}.`
			: single
				? `Letting go of any one of them would ${outcome}.`
				: explanation.reasons.every((r) => r.rules.length + r.pins.length === 1)
					? `All of them would have to go to ${outcome}.`
					: `One from each would have to go to ${outcome}.`;
	// The close goes on its own line only where the lead already broke onto
	// several, so a one-line answer stays one line.
	return `${lead}${lead.includes("\n") ? "\n" : " "}${close}`;
}
