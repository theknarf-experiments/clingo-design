/**
 * Ways out of a contradiction.
 *
 * A core says which switches cannot hold together. Its *complement* is the
 * interesting half: the largest set of them that can. This file finds the
 * cheapest ways to get there — the smallest sets of switches whose removal
 * makes the program satisfiable again — and it finds several when several
 * exist, because which rule matters is exactly what the tool cannot know.
 *
 * ## Why this is an assumption search and not a weak constraint
 *
 * The obvious construction is `:~ not active(C). [1@k,C]` and one `optN`
 * solve: the optimum is then the maximum satisfiable subset by definition.
 * That was measured against this build and it does work — same answers as the
 * search below, on both a two-way and a one-way conflict. It was not taken,
 * for three reasons found the same way:
 *
 *  - It needs its own grounding. A weak constraint is program text, and the
 *    program the studio has open is the one without it. Diagnosing a conflict
 *    would mean re-grounding a second copy of the whole document.
 *  - `#project drop/1` does not isolate the drop-sets. Projection is on the
 *    *union* of the signatures, and the generated program already projects
 *    `rendered/3` and four more, so `optN` came back with 18 models for 2
 *    distinct drop-sets. Getting the drop-sets out means enumerating designs
 *    and de-duplicating, and a cap on that enumeration silently loses ways out.
 *  - Every model it returns has to be re-solved to get a picture, because the
 *    relaxed session is a different session from the one the studio draws from.
 *
 * The search below costs one solve per candidate way out — three solves for the
 * two-way conflict above — needs no new program, and each answer it returns
 * *is* an answer set of the document under that relaxation, so the picture
 * comes for free. Which matters: the whole value here is "turn this off and you
 * get *this* design", not a list of rule names.
 *
 * ## What it guarantees
 *
 * Ascending cardinality, so every way returned is minimum-cardinality and
 * therefore minimal: nothing smaller works, and no proper subset of it works
 * either. Sound whatever the solver hands back, because a way out is only
 * offered once a real solve under it came back SATISFIABLE — which matters,
 * since an UNSAT core in this build is not minimal and the hitting-set pruning
 * below therefore only prunes, never decides.
 */
import { unsigned } from "./atoms.ts";
import type { Assumption, SolverSession } from "./solver.ts";

/** A switch the user owns, and what dropping it would cost them. */
export interface Switch {
	/** The assumption as it reaches the solver, and as a core echoes it. */
	atom: string;
	/** The constraint id, or the variable a pin holds. */
	id: string;
	/**
	 * True when letting go of it is not a document edit.
	 *
	 * A pin is a question, not a change: releasing one costs a solve and leaves
	 * undo alone. Switching a rule off is an edit somebody has to mean. So the
	 * two are not interchangeable and the search ranks them, rather than
	 * offering whichever it happened to try first.
	 */
	free: boolean;
}

/** One way out: the switches to let go of, and the design that comes back. */
export interface Way {
	/** Constraint ids to switch off. */
	rules: string[];
	/** Variables to unpin. */
	pins: string[];
	/** The answer set the surviving switches admit, with a picture in it. */
	atoms: string[];
}

export interface Ways {
	ways: Way[];
	solves: number;
	/**
	 * False when the search stopped on its budget rather than on an answer.
	 *
	 * The ways returned are still real — each was solved for — but there may be
	 * others of the same size, so a caller must not say "these are the only
	 * ones".
	 */
	complete: boolean;
}

export interface RelaxOptions {
	/**
	 * The assumptions that are not up for discussion — `gpull`, `scenery`, and
	 * anything else the caller needs true to read an answer at all.
	 *
	 * Include `scenery`: every way out is going to be looked at, so the solve
	 * that proves one may as well be the solve that draws it.
	 */
	base: readonly Assumption[];
	/** The switches the search may let go of. */
	owned: readonly Switch[];
	/** The core that started this, as the solver echoed it. */
	core: readonly string[];
	/** Ways to offer at most. */
	limit?: number;
	/** Solves to spend at most. */
	budget?: number;
	/** Rules to switch off at most, in one way out. */
	maxRules?: number;
	/** Pins to release at most, in one way out. */
	maxPins?: number;
}

const DEFAULTS = {
	/** Four ways out is a choice; ten is a second problem. */
	limit: 4,
	/**
	 * A conflict is already a stopped state, so this is allowed to be dear — but
	 * it is on the path between an edit and the screen redrawing, and a bare
	 * solve on the documents measured is a millisecond or two.
	 */
	budget: 48,
	/**
	 * Two rules off is a proposal a designer can read. Three is a rewrite, and
	 * the search for it is cubic in the candidates.
	 */
	maxRules: 2,
	/** Pins are free, so more of them can go — and usually one is enough. */
	maxPins: 3,
};

/** Every `k`-sized subset of `list`, in list order. */
function* subsets<T>(list: readonly T[], k: number): Generator<T[]> {
	if (k === 0) {
		yield [];
		return;
	}
	for (let i = 0; i <= list.length - k; i++) {
		for (const rest of subsets(list.slice(i + 1), k - 1)) {
			yield [list[i], ...rest];
		}
	}
}

/**
 * The cheapest ways to make an unsatisfiable document satisfiable again.
 *
 * Cheapest is lexicographic: fewest rules switched off first, then fewest pins
 * released. That ordering is the point rather than a detail — a document whose
 * pins are the only problem is offered "let go of this pin" and never "delete
 * your rule", because the first costs nothing and the second costs a design
 * decision.
 *
 * Candidates come from the cores. An atom that appears in no core cannot help:
 * a way out has to *hit* every core, since keeping a whole core intact is
 * unsatisfiable by definition. New cores arrive from the solves that fail, so
 * the candidate set grows during the search and each cardinality level is run
 * to a fixpoint before the next one is tried.
 */
export async function findWays(
	session: SolverSession,
	options: RelaxOptions,
): Promise<Ways> {
	const limit = options.limit ?? DEFAULTS.limit;
	const budget = options.budget ?? DEFAULTS.budget;
	const maxRules = options.maxRules ?? DEFAULTS.maxRules;
	const maxPins = options.maxPins ?? DEFAULTS.maxPins;

	const owned = new Map(options.owned.map((s) => [s.atom, s]));
	/** Cores, as the owned atoms in them. */
	const cores: Array<Set<string>> = [];
	const candidates = new Set<string>();
	let solves = 0;

	/**
	 * Records a core and returns false when nothing owned appears in it.
	 *
	 * An unhittable core is the end of the search rather than a step in it: the
	 * contradiction is somewhere the user has no switch for — a rule they wrote
	 * by hand, a document that cannot be laid out — and no combination of the
	 * switches they do have will move it.
	 */
	const record = (core: readonly string[]): boolean => {
		const mine = new Set<string>();
		for (const text of core) {
			const atom = unsigned(text);
			if (owned.has(atom)) mine.add(atom);
		}
		if (mine.size === 0) return false;
		cores.push(mine);
		for (const atom of mine) candidates.add(atom);
		return true;
	};

	if (!record(options.core)) return { ways: [], solves, complete: true };

	const ways: Way[] = [];
	/** Combinations already tried, so a fixpoint pass does not repeat them. */
	const tried = new Set<string>();
	let complete = true;

	for (let rules = 0; rules <= maxRules && ways.length === 0; rules++) {
		for (let pins = 0; pins <= maxPins && ways.length === 0; pins++) {
			if (rules === 0 && pins === 0) continue;
			// A failed solve widens the candidate set, and the combinations that
			// use the new candidates have not been tried at this level yet.
			let grew = true;
			while (grew && ways.length < limit && solves < budget) {
				grew = false;
				const ruleAtoms = [...candidates].filter((a) => !owned.get(a)?.free);
				const pinAtoms = [...candidates].filter((a) => owned.get(a)?.free);
				if (ruleAtoms.length < rules || pinAtoms.length < pins) break;
				for (const someRules of subsets(ruleAtoms, rules)) {
					for (const somePins of subsets(pinAtoms, pins)) {
						if (ways.length >= limit || solves >= budget) break;
						const drop = new Set([...someRules, ...somePins]);
						const key = [...drop].sort().join(" ");
						if (tried.has(key)) continue;
						// Must hit every core: keeping one whole is unsatisfiable.
						if (!cores.every((core) => [...core].some((a) => drop.has(a)))) {
							continue;
						}
						tried.add(key);
						const outcome = await session.solve({
							models: 1,
							assumptions: options.base.filter((a) => !drop.has(a.atom)),
						});
						solves++;
						const atoms = outcome.models[0];
						if (outcome.result === "SATISFIABLE" && atoms) {
							ways.push({
								rules: someRules.map((a) => owned.get(a)?.id ?? a),
								pins: somePins.map((a) => owned.get(a)?.id ?? a),
								atoms,
							});
						} else if (record(outcome.core)) {
							grew = true;
						}
					}
				}
			}
			// Out of budget mid-level: whatever was found is real, but the level
			// was not finished, so there may be siblings nobody looked at.
			if (solves >= budget) complete = false;
		}
	}

	// Stopped at the ceiling rather than at the end of a level, so the same
	// applies: the caller must not claim these are the only ones.
	if (ways.length >= limit) complete = false;
	return { ways, solves, complete };
}
