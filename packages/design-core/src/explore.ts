/**
 * Turns a document into universes the renderer can draw.
 *
 * The grounding is reused: an {@link Explorer} holds a session and only
 * re-opens it when the *program* changes. Almost every edit does change it —
 * the document compiles to facts — so in practice the reuse catches a repeated
 * explore of an unchanged document, a pin (which is an assumption and was never
 * a re-grounding), and renaming a node. That is all; see grounding.test.ts,
 * which pins the split edit by edit.
 *
 * ## Why the obvious fix is not one: the document cannot be `#external`
 *
 * clingo's answer to re-grounding is multi-shot — atoms whose truth is set
 * between solves — and the document's facts look exactly like the thing that
 * should be external. They are not, and the reason is one sentence: an atom's
 * *truth* can change without re-grounding, but the set of atoms cannot. Almost
 * every edit a designer makes introduces a new **term**.
 *
 * Measured on this build, in-process through `directSolver`, medians of five:
 *
 * ```
 * doc         nodes   ground     warm     cold   ground as % of cold
 * card           11     21ms     18ms     41ms        54%
 * rail            6     24ms      7ms     32ms        75%
 * palette         9     19ms      6ms     25ms        76%
 * sudoku         22     77ms     26ms    107ms        72%
 * synth50        52     34ms     63ms     98ms        35%
 * synth200      202     96ms    255ms    353ms        27%
 * synth500      502    226ms    656ms    884ms        26%
 * buttons         8     16ms     48ms     87ms        18%   (118 solves)
 * map             6     53ms   2738ms   2773ms         2%   ( 80 solves)
 * ```
 *
 * Read that table before believing the headline. Grounding is a *large share*
 * only of the documents that are already fast: card re-solves in 41ms and
 * palette in 25ms, so deleting grounding outright buys card 23ms. The documents
 * that are actually slow are slow because of solves — map spends 98% of 2.7s
 * solving — and there multi-shot buys 2%.
 *
 * Confirmed in the studio over CDP, which is the number that decides it. A drag
 * on `card` — the most grounding-dominated document there is — is **95ms** from
 * mouse-up to the status line settling, of which the exploration reports 55ms
 * and grounding is ~21ms. So the edit latency people complain about is ~22%
 * grounding, ~35% solving, and ~40% worker hop and React. Deleting the grounder
 * outright would take that drag to 74ms, and for a drag it cannot be deleted at
 * all.
 *
 * Grounding itself is a ~15ms fixed floor plus ~0.4ms a node: the blank
 * template, one node and the whole generic rule skeleton, grounds in 15ms, and
 * a bare `a.` grounds in 1ms. So three quarters of card's grounding is parsing
 * 15KB of rules and rewriting them through clingo-lpx, which is a constant.
 *
 * ### The split, edit by edit
 *
 * Needs a new term, so it re-grounds and always will:
 *   * drag or resize — `frame(badge,x,41)` is an integer that was not there
 *   * type into a text node — a new `literal/2` string
 *   * pick a colour off the picker — the same, plus the table renumbers
 *   * edit a token's value, add a node, delete a node — new terms throughout
 *   * a gap or a size in a layout — a new `numeral/2` integer
 *
 * Truth only, so it *could* be an external — both verified working through the
 * shim, which has exposed `cd_externals` all along:
 *   * switching a rule off: `#external constraint(C)`. A disabled constraint
 *     emits strictly fewer facts, never other ones.
 *   * re-pointing a value at a literal *already in the table*:
 *     `#external alt_literal/3`. One atom moves. But the colour picker emits
 *     arbitrary colours, so the hit rate on the edit that matters is near zero.
 *
 * Already free, and worth saying because it is easy to count twice: pinning and
 * unpinning, a component override, a freedom probe, a why-question, brave and
 * cautious. All assumptions.
 *
 * ### The decisive measurement
 *
 * The one edit worth the whole exercise is the drag, and it was tried. Making a
 * coordinate external means grounding every coordinate the node could hold.
 * On eleven nodes — card — with one theory equation per frame, which is the
 * shape the geometry rules have:
 *
 * ```
 * frame/3 as facts                  ground     9ms   solve    4ms
 * #external over V=0..100           ground    45ms   solve   67ms
 * #external over V=0..500           ground   161ms   solve  296ms
 * #external over V=0..2000          ground   570ms   solve 1112ms
 * ```
 *
 * A canvas 100 pixels wide already costs nine times the grounding it was meant
 * to save, and a real one costs 130x, on the smallest document in the tool. The
 * technique fails hardest exactly where it was needed.
 *
 * So: not done, deliberately. What is left on the table is the constraint
 * toggle — 20ms of palette's 87ms, 54ms of map's 2.6s — for a restructuring
 * that would emit every disabled rule's facts into every grounding, put a
 * `c_level/2` for switched-off soft rules into the program (which makes
 * {@link isOptimizing} true for documents where it is false today, and see what
 * that function's own comment says about collapsing the multiverse), and add a
 * third state to reason about: an external nobody assigned is fixed *false* in
 * preprocessing, so an assumption on an atom only that external could derive
 * comes back UNSATISFIABLE rather than free. That is a large, sharp-edged
 * change for the cheapest interaction in the studio. The edit latency is real;
 * this is not where it lives.
 *
 * When enumeration exhausts the space, brave and cautious consequences are
 * derived from the models already in hand rather than asked for separately,
 * which takes the usual exploration from three solves down to one.
 *
 * Most of the solves an exploration does are not looked at. A sampling run
 * draws a few hundred candidates to show two dozen, and asks two more questions
 * of the whole space besides. So the picture is behind `SCENERY_ATOM` and only
 * turned on for the solves whose answer someone is going to look at: see
 * {@link Candidate}, and `#hydrate` for the ones that earn a slot late.
 */
import { PULL_ATOM, SCENERY_ATOM, compile } from "./compile.ts";
import { heldPicks } from "./components.ts";
import { formatDiagnostics, parseAtom } from "./atoms.ts";
import { type Freedom, probeFreedom } from "./freedom.ts";
import type { Frame } from "./geometry.ts";
import { type Measurements, measurementNotes } from "./measure.ts";
import { type ModelScene, readModel, readSolved } from "./model.ts";
import { type Switch, type Way, findWays } from "./relax.ts";
import { STRENGTHS, type Scene, strengthOfLevel } from "./scene.ts";
import type { Assumption, Solver, SolverSession } from "./solver.ts";
import {
	type SampleStrategy,
	makeRng,
	randomAssumptions,
	selectSpread,
	universeKey,
} from "./sampling.ts";
import { type Explanation, type Question, explain, questionAtom } from "./why.ts";

/**
 * A design the solver found, as its decisions and nothing else.
 *
 * This is what a *rejected* answer is. Sampling draws a few hundred of these to
 * show two dozen, and the only questions asked of one before it is chosen are
 * "is this a duplicate" and "how far is it from what I already have" — both of
 * which read the picks. So a candidate solve assumes `scenery` off and comes
 * back with a quarter of the atoms.
 *
 * There is deliberately no picture on here. A candidate cannot be drawn, and
 * that is a type error rather than a blank canvas: the alternative design, a
 * `model` that is empty when nobody asked for one, fails silently and looks
 * exactly like a document with nothing in it. {@link Explorer.explore} turns
 * every candidate it means to show into a {@link Universe} first.
 */
export interface Candidate {
	/** variable key -> which alternative is active */
	pick: Record<string, number>;
	/** node ids that survive `visible/1` */
	visible: Set<string>;
	/**
	 * What this design gave up, one entry per priority level and highest level
	 * first. Empty in a document that expresses no preference, which is most.
	 *
	 * On the candidate rather than alongside it because it is a property of the
	 * design and travels with it: the pool is sorted by this, the caption shows
	 * it, and a hydrated universe has to arrive still carrying the cost its bare
	 * candidate was chosen for. Pair it with {@link Exploration.levels} to say
	 * *which* preference each number belongs to.
	 */
	costs: number[];
}

/** A candidate the solver was also asked to describe the picture of. */
export interface Universe extends Candidate {
	/**
	 * Geometry the solver worked out — for nodes under an automatic layout, and
	 * for nodes handed to it by a geometric constraint.
	 *
	 * Partial by design: a node placed by hand is not in here at all, and a
	 * laid-out one may have only some axes solved. Whatever is present wins
	 * over the node's stored frame.
	 */
	solved: Record<string, Partial<Frame>>;
	/**
	 * The picture this universe *is* — the tree, the frames and the final text
	 * of every property, read straight out of the answer set.
	 *
	 * This is what a renderer draws. `pick` and `solved` stay because the rest
	 * of the studio asks different questions of a universe: which alternative
	 * to pin, how far a coordinate may travel, what to caption a cell with.
	 *
	 * Lazy, and deliberately: a grid cell re-renders far more often than it is
	 * re-solved, and the atoms are already in hand.
	 */
	readonly model: ModelScene;
	/**
	 * Rules this design breaks — the soft ones, since a hard one being broken is
	 * not a design.
	 *
	 * This is what makes "possible but disappointing" a thing the studio can
	 * say. A document whose only conflicts are preferences is satisfiable, and
	 * before soft rules existed that state could not arise: every conflict was
	 * an impossibility. Now the common case is a design that is perfectly legal
	 * and gives something up, and the rule it gave up is nameable.
	 *
	 * Costs say *how much* was given up; this says *what*. Both, because a tier
	 * total is not actionable and a rule name is not comparable.
	 */
	readonly violated: ReadonlySet<string>;
}

export interface SamplingInfo {
	strategy: SampleStrategy;
	/** Candidates considered before selection. */
	pool: number;
	/** Reproduces this exact sample. */
	seed: number;
	/** True when the shown universes are a sample rather than the whole space. */
	sampled: boolean;
}

export interface Consequences {
	/** variable key -> the alternatives it takes across the universes */
	pick: Record<string, Set<number>>;
	visible: Set<string>;
}

export interface Exploration {
	/** The generated half of the program, for the power panel. */
	generated: string;
	universes: Universe[];
	/** Holds in every universe. */
	cautious: Consequences;
	/** Holds in at least one universe. */
	brave: Consequences;
	/** True when more universes exist than were enumerated. */
	truncated: boolean;
	/** Universes returned. */
	count: number;
	/** Size of the whole space, or null when counting was itself capped. */
	total: number | null;
	/** Wall-clock for the whole exploration. */
	ms: number;
	/** How many solver round trips this took — 1 when the space is small. */
	solves: number;
	/** True when the grounding was reused from the previous exploration. */
	reusedGrounding: boolean;
	/** How the shown universes were chosen. */
	sampling: SamplingInfo;
	/**
	 * True when the document expresses a preference, so the universes are the
	 * near-optimal ones in cost order rather than a sample of the whole space.
	 *
	 * Not "only proven optima": that is what this used to mean and it was the
	 * wrong answer. A tool whose point is holding several designs at once must
	 * not show one the moment somebody writes down a preference — see
	 * {@link bound}.
	 */
	optimized: boolean;
	/** What the best design found costs, per level, highest level first. */
	costs: number[];
	/**
	 * The ceiling every shown design is at or under, per level.
	 *
	 * Lexicographic, so it is not read entry by entry: a design beats the bound
	 * as soon as it is under it at the first level they differ at.
	 */
	bound: number[];
	/**
	 * Which priority level each entry of a cost vector belongs to, highest first
	 * — the document's own levels, from `compile`.
	 *
	 * A `:~` written by hand in the Rules panel adds a level nothing here can
	 * see, which shifts the vector; the lengths then disagree, and that
	 * disagreement is the signal not to put a tier's name on a number.
	 */
	levels: number[];
	/**
	 * What clingo said about the program while grounding it, with line numbers
	 * already pointing at the user's own rules. Empty when it said nothing.
	 *
	 * Not errors — every one of these explorations succeeded. This is how a
	 * misspelled predicate in a hand-written rule stops being silent: the rule
	 * grounds, contributes nothing, and clingo mentions it.
	 */
	diagnostics: string;
	/**
	 * What the tool approximated about these designs, in the same words clingo
	 * would use. Empty on almost every document.
	 *
	 * Beside the diagnostics rather than inside them because the source is
	 * different — this is the tool remarking on its own arithmetic, not clingo
	 * remarking on the program — and in the same band because the reader's
	 * question is the same one: is anything about my rules not doing what it
	 * looks like? Today there is exactly one entry, and it is the one
	 * approximation that cannot announce itself where it happens; see
	 * {@link measurementNotes}.
	 */
	approximations: string[];
}

/**
 * What an exploration reports about the *program* rather than about the
 * question asked of it — filled in the same way whichever path answered.
 */
type Common = Pick<
	Exploration,
	"generated" | "reusedGrounding" | "diagnostics" | "levels" | "ms" | "solves"
>;

/**
 * A way out of a contradiction, with the design it leads to.
 *
 * The picture is the whole point. "Switch off these two rules" is a worse
 * version of the core the user already has; "switch off these two rules and you
 * get *this*" is a decision they can make. So every relaxation carries a
 * universe, drawn by the very solve that proved the relaxation works — see
 * `findWays`, which asks for `scenery` because it knows someone will look.
 */
export interface Relaxation {
	/** Rules to switch off. A document edit, and an undo entry. */
	rules: string[];
	/** Variables to unpin. Not an edit at all. */
	pins: string[];
	/**
	 * True when this costs the document nothing — only pins are let go.
	 *
	 * Worth its own field rather than left as `rules.length === 0` at every use
	 * site, because it is the *reason* these come first: a pin is a question the
	 * user asked and can stop asking.
	 */
	free: boolean;
	/** The design that comes out. */
	universe: Universe;
}

/**
 * Thrown when the program admits no universes at all.
 *
 * Everything the user can switch on — a constraint, a pinned value — is
 * assumed rather than baked in, so an unsatisfiable answer comes back with a
 * *core*: the smallest subset of those switches that cannot hold together.
 * `conflict` names the guilty constraints and `pinned` the guilty pins. Both
 * are empty when the contradiction is somewhere the solver cannot attribute,
 * such as a hand-written rule.
 *
 * And then it comes back with the other half of the answer. A core says what is
 * wrong; {@link relaxations} says what to do about it, and each one is a design
 * on the other side of the decision rather than a suggestion. Empty when the
 * conflict is unattributable, because a switch nobody has cannot be thrown.
 */
export class UnsatisfiableError extends Error {
	readonly conflict: string[];
	readonly pinned: string[];
	/**
	 * The cheapest ways out, fewest rules switched off first — several when
	 * several are equally cheap, which is the case that matters: whether it is
	 * the grid rule or the colour rule that has to go is the designer's call,
	 * and the tool has no way to know.
	 */
	readonly relaxations: Relaxation[];
	/**
	 * True when the search finished rather than ran out of budget.
	 *
	 * The difference between "these are the ways out" and "these are ways out",
	 * which is a sentence the panel has to be able to say honestly.
	 */
	readonly exhaustive: boolean;

	constructor(
		conflict: string[] = [],
		pinned: string[] = [],
		relaxations: Relaxation[] = [],
		exhaustive = true,
	) {
		super(blame(conflict, pinned, relaxations));
		this.name = "UnsatisfiableError";
		this.conflict = conflict;
		this.pinned = pinned;
		this.relaxations = relaxations;
		this.exhaustive = exhaustive;
	}
}

function blame(
	conflict: readonly string[],
	pinned: readonly string[],
	relaxations: readonly Relaxation[] = [],
): string {
	const rules = `${conflict.length} rule${conflict.length === 1 ? "" : "s"}`;
	const what =
		conflict.length > 0 && pinned.length > 0
			? `The pinned values and ${rules} cannot hold together.`
			: pinned.length > 0
				? "The pinned values cannot hold together."
				: conflict.length > 0
					? `${rules} cannot hold together.`
					: "No design satisfies these rules.";
	// The count only, and the names in the panel: a status line is one line, and
	// a rule's name is the document's, not the solver's.
	if (relaxations.length === 0) return what;
	const n = relaxations.length;
	return `${what} ${n} way${n === 1 ? "" : "s"} out.`;
}

/** Splits a core back into the constraints and the pins it names. */
function attribute(core: readonly string[]): {
	conflict: string[];
	pinned: string[];
} {
	const conflict: string[] = [];
	const pinned: string[] = [];
	for (const text of core) {
		// The core echoes the assumptions as given, sign prefix and all.
		const atom = parseAtom(text.replace(/^[+-]/, ""));
		if (!atom) continue;
		// Parsed rather than matched, for the reason `parseVariable` is: both a
		// constraint id and a variable key may be a *term*. `active(box(1))` and
		// `pick(prop(cell(1,1),text),3)` are one argument and two, and a regex
		// over the argument list reads them as neither — so a core naming them
		// would come back blaming nothing at all.
		if (atom.name === "active" && atom.args.length === 1) {
			conflict.push(atom.args[0]);
		} else if (atom.name === "pick" && atom.args.length === 2) {
			pinned.push(atom.args[0]);
		}
	}
	return { conflict, pinned };
}

/**
 * Turns a failed solve into the error the studio shows: who is at fault, and
 * what to do about it.
 *
 * The second half costs solves — one per way out tried — and they are spent
 * here rather than lazily on request for two reasons. The state is already
 * stopped, so there is no frame budget to protect; and a way out is only worth
 * offering *with its picture*, which means the search and the drawing are the
 * same solve. See `findWays`.
 *
 * `base` is the picture-bearing assumption list, so `scenery` is on and the
 * answer a successful relaxation returns is a universe rather than a set of
 * decisions someone else has to redraw.
 */
async function diagnose(
	session: SolverSession,
	base: ReadonlyArray<Assumption>,
	owned: readonly Switch[],
	core: readonly string[],
): Promise<UnsatisfiableError> {
	const { conflict, pinned } = attribute(core);
	const { ways, complete } = await findWays(session, { base, owned, core });
	return new UnsatisfiableError(conflict, pinned, ways.map(relaxation), complete);
}

/** A way out, with its answer set read as the design it is. */
function relaxation(way: Way): Relaxation {
	return {
		rules: way.rules,
		pins: way.pins,
		// Letting go of a pin is not an edit, so a way out made only of pins asks
		// nothing of the document at all.
		free: way.rules.length === 0,
		universe: interpret(way.atoms),
	};
}

/**
 * Reads `pick/2` and `visible/1` out of an answer set.
 *
 * `onPick` is what separates the two readings: one answer set assigns each
 * variable a single alternative, while brave/cautious consequences accumulate
 * the alternatives a variable takes across many.
 */
function readAtoms(
	atoms: readonly string[],
	onPick: (variable: string, index: number) => void,
	onVisible: (node: string) => void,
): void {
	for (const text of atoms) {
		const atom = parseAtom(text);
		if (!atom) continue;
		if (atom.name === "pick" && atom.args.length === 2) {
			onPick(atom.args[0], Number(atom.args[1]));
		} else if (atom.name === "visible" && atom.args.length === 1) {
			onVisible(atom.args[0]);
		}
	}
}

function readCandidate(
	atoms: readonly string[],
	costs: readonly number[] = [],
): Candidate {
	const candidate: Candidate = { pick: {}, visible: new Set(), costs: [...costs] };
	readAtoms(
		atoms,
		(variable, index) => {
			candidate.pick[variable] = index;
		},
		(node) => candidate.visible.add(node),
	);
	return candidate;
}

/** Reads an answer set that was asked for with `scenery` on. */
function interpret(
	atoms: readonly string[],
	costs: readonly number[] = [],
): Universe {
	let scene: ModelScene | undefined;
	const violated = new Set<string>();
	for (const text of atoms) {
		const atom = parseAtom(text);
		// Only the soft ones can be here: the program shows `viol(C)` behind
		// `active(C)`, and a hard rule that is active and violated is not a model.
		if (atom && atom.name === "viol" && atom.args.length === 1) {
			violated.add(atom.args[0]);
		}
	}
	return {
		...readCandidate(atoms, costs),
		solved: readSolved(atoms),
		violated,
		get model(): ModelScene {
			return (scene ??= readModel(atoms));
		},
	};
}

/**
 * What a design gave up, in words: "Prefer 1 · Slightly prefer 2".
 *
 * One function because there is one answer, and the status line and the
 * artboard captions must not disagree about what a number means. Only the
 * levels that actually cost something are named — a design that paid nothing at
 * a tier has nothing to say about it, and one that paid nothing anywhere says
 * "nothing", which is a phrase both readers can build a sentence around.
 *
 * Falls back to the bare numbers when the vector is longer than the levels the
 * document knows about, which is what a `:~` written by hand in the Rules panel
 * does to it. Better an unlabelled cost than a cost labelled with the wrong
 * tier.
 */
export function describeCosts(
	costs: readonly number[],
	levels: readonly number[],
): string {
	if (costs.length === 0) return "";
	if (costs.length !== levels.length) return `cost ${costs.join(", ")}`;
	const paid = costs
		.map((cost, i) => ({ cost, strength: strengthOfLevel(levels[i]) }))
		.filter((entry) => entry.cost !== 0);
	if (paid.length === 0) return "nothing";
	return paid
		.map(({ cost, strength }) =>
			strength ? `${STRENGTHS[strength].label} ${cost}` : `cost ${cost}`,
		)
		.join(" · ");
}

/**
 * The ceiling a ranked exploration enumerates under: the optimum, loosened by
 * `slack` points.
 *
 * Points rather than a percentage, and that is a decision worth the paragraph:
 * a point *is* the unit the tiers are written in — one violated preference of
 * weight one — so "within two points of the best" reads as "gives up at most
 * two more preferences", which is a sentence a designer can act on. A
 * percentage is not: the best design usually costs nothing at all, and 50% of
 * nothing is nothing, so a relative bound would silently collapse the very
 * documents this feature is for back onto their optima.
 *
 * Every level is loosened, not only the lowest, because the bound clingo takes
 * is *lexicographic* — verified against this build: with two levels, a ceiling
 * of `2,2` admits a design costing `1,3`, since the first level already decides
 * it. A bound that held the top level at its optimum would therefore show only
 * designs that agree with the best about the most important thing, which for a
 * single-tier document is the collapse this whole mechanism exists to avoid.
 * Loosening the top tier too is also what makes the trade-off *visible*: the
 * grid holds designs that gave up something dear to buy something cheap, and
 * each says on its caption what it paid.
 *
 * One point at minimum, so a preference always leaves something to compare the
 * best design against.
 */
export function rankedBound(
	costs: readonly number[],
	slack: number,
): number[] {
	const points = Math.max(1, Math.round(slack));
	return costs.map((cost) => cost + points);
}

/**
 * Whether a candidate is already a universe.
 *
 * Structural because that is what the distinction *is*: the two differ by
 * whether the solve that produced them was asked for a picture, and the pool a
 * selection runs over holds both.
 */
function isDrawn(candidate: Candidate): candidate is Universe {
	return "model" in candidate;
}

function accumulate(atoms: readonly string[]): Consequences {
	const acc: Consequences = { pick: {}, visible: new Set() };
	readAtoms(
		atoms,
		(variable, index) => (acc.pick[variable] ??= new Set()).add(index),
		(node) => acc.visible.add(node),
	);
	return acc;
}

/**
 * Drops duplicates, keeping the position of the first of each — but the drawn
 * copy of a design in preference to a bare one.
 *
 * Position matters: {@link selectDiverse} starts from the first element, and the
 * sampled candidates come before the enumerated ones deliberately, so the
 * selection begins somewhere in the space rather than at the top of the search
 * tree. What must not follow from that is throwing away a picture already paid
 * for because a bare candidate saying the same thing was drawn first.
 */
function dedupe<T extends Candidate>(candidates: readonly T[]): T[] {
	const at = new Map<string, number>();
	const out: T[] = [];
	for (const candidate of candidates) {
		const key = universeKey(candidate);
		const seen = at.get(key);
		if (seen === undefined) {
			at.set(key, out.length);
			out.push(candidate);
		} else if (!isDrawn(out[seen]) && isDrawn(candidate)) {
			out[seen] = candidate;
		}
	}
	return out;
}

/** Union of the universes: everything that happens somewhere. */
function unionOf(universes: readonly Candidate[]): Consequences {
	const acc: Consequences = { pick: {}, visible: new Set() };
	for (const u of universes) {
		for (const [variable, index] of Object.entries(u.pick)) {
			(acc.pick[variable] ??= new Set()).add(index);
		}
		for (const node of u.visible) acc.visible.add(node);
	}
	return acc;
}

/** Intersection of the universes: everything that is settled. */
function intersectionOf(universes: readonly Candidate[]): Consequences {
	const [first, ...rest] = universes;
	if (!first) return { pick: {}, visible: new Set() };

	const pick: Record<string, Set<number>> = {};
	for (const [variable, index] of Object.entries(first.pick)) {
		if (rest.every((u) => u.pick[variable] === index)) {
			pick[variable] = new Set([index]);
		}
	}
	const visible = new Set<string>();
	for (const node of first.visible) {
		if (rest.every((u) => u.visible.has(node))) visible.add(node);
	}
	return { pick, visible };
}

export interface ExploreOptions {
	/** Maximum universes to show. */
	limit?: number;
	/**
	 * Cap on counting the whole space. Counting is exhaustive work — every
	 * model has to be enumerated — so a space bigger than this reports
	 * `total: null` instead of paying for a number no one reads. When `total`
	 * is non-null it is exact.
	 */
	countLimit?: number;
	/**
	 * How to pick which universes to show when the space is bigger than
	 * `limit`. "first" takes enumeration order, which is heavily biased;
	 * "diverse" samples across every dimension.
	 * @default "diverse"
	 */
	sample?: SampleStrategy;
	/** Candidates to draw before selecting `limit` of them. */
	poolSize?: number;
	/** Same seed, same sample. Change it to reshuffle. */
	seed?: number;
	/**
	 * Alternatives the user has fixed, as variable -> index.
	 *
	 * These are *assumptions*, not edits: they narrow what the solver returns
	 * without touching the document, so browsing a space costs a solve and is
	 * undone by forgetting them rather than by an undo entry.
	 *
	 * A component instance's overrides arrive the same way, read off the
	 * document — see `heldPicks`. Anything here wins over one of those, so a pin
	 * can look past an override without editing it away.
	 */
	pins?: Readonly<Record<string, number>>;
	/**
	 * Natural sizes for the nodes that size themselves to their content, from
	 * whoever has a canvas to measure with — see `measure.ts`. They are part of
	 * the program, so changing one re-grounds.
	 */
	measurements?: Measurements;
	/**
	 * How many points below the best a design may be and still be shown — one
	 * point being one violated preference of weight one.
	 *
	 * The dial between "the single best design" and "the whole space", and the
	 * floor is one point rather than zero, deliberately: a preference with
	 * nothing to compare the best design against is a preference whose effect
	 * nobody can see.
	 * @default 2
	 */
	slack?: number;
}

const DEFAULTS = {
	limit: 24,
	// Counting 20,000 models costs ~500ms and buys nothing: a space that large
	// reads as "many" either way. 2,000 keeps exact counts for spaces small
	// enough to care about, at ~60ms.
	countLimit: 2_000,
	sample: "diverse" as SampleStrategy,
	seed: 1,
	/** Points of suboptimality still worth showing. Two preferences' worth. */
	slack: 2,
	/**
	 * Candidates a ranked enumeration draws before ordering them.
	 *
	 * More than a grid holds, because the enumeration is not best-first and the
	 * cheapest way to be sure the second-best design is in hand is to have seen
	 * a good many of them. Bare solves, so this is one round trip either way.
	 */
	rankPool: 200,
	/** Fraction of varying tokens pinned per sampling query. */
	coverage: 0.75,
	/** Give up on a sampling query set after this many misses in a row. */
	maxMisses: 12,
};

/**
 * Weak constraints or #minimize/#maximize mean the program ranks its models.
 *
 * A theory `&minimize` is emphatically not that: it ranks the *points* the
 * simplex solver may return inside one answer set, and every answer set is
 * still an equal answer. The two objectives are separate and both live at once
 * — verified through the real solver, and there is a test for it — so a ranked
 * document still places its solved nodes exactly where an unranked one would.
 *
 * Text rather than a flag off `compile`, because the Rules panel is a place
 * people write ASP by hand and a `:~` typed in there ranks the program just as
 * much as one the document generated. The cost of reading the text is a false
 * positive — a weak constraint whose condition grounds away still matches — and
 * that no longer matters: a ranked exploration asks for the optimum first, and
 * an empty cost vector is how it finds out there was nothing to rank and hands
 * the question back. What used to be a program answering SATISFIABLE with zero
 * models, reaching the canvas as a blank.
 */
function isOptimizing(program: string): boolean {
	return /^\s*(?::~|#(?:minimize|maximize))/m.test(program);
}

/**
 * Holds a grounded program between explorations.
 *
 * Call {@link close} when done; the grounding lives in the WebAssembly heap.
 */
export class Explorer {
	#solver: Solver;
	#session: SolverSession | null = null;
	#diagnostics = "";
	#program = "";
	/** What the last exploration assumed, so a probe asks about that document. */
	#assumed: ReadonlyArray<{ atom: string; sign?: boolean }> = [];
	/**
	 * Which of those assumptions are the user's, and which are free to let go.
	 *
	 * Kept for the same reason `#assumed` is: a follow-up question has to be
	 * about the document that was explored, and "what could I switch off" is not
	 * answerable from the assumption list alone — a guard and a pin reach the
	 * solver as ordinary atoms and only this says which is which.
	 */
	#owned: readonly Switch[] = [];

	constructor(solver: Solver) {
		this.#solver = solver;
	}

	/**
	 * How far the named nodes' solver-owned coordinates can travel.
	 *
	 * Runs on the grounding the last {@link explore} left open, under the same
	 * assumptions, so it costs solves rather than a re-grounding — but two of
	 * them per coordinate, which is why the caller decides what is worth asking
	 * about. Returns nothing at all before the first exploration.
	 */
	async probe(
		solved: Readonly<Record<string, Partial<Frame>>>,
		nodeIds: readonly string[],
	): Promise<Freedom> {
		const session = this.#session;
		if (!session || nodeIds.length === 0) return {};
		return probeFreedom(session, this.#assumed, solved, nodeIds);
	}

	/**
	 * Why a value came out the way it did — or why the one beside it cannot.
	 *
	 * Runs on the grounding and the assumptions the last {@link explore} left,
	 * like {@link probe}, so the answer is about the document on screen. Costs
	 * roughly one solve per switch the document has: a click, never a keystroke.
	 * See `why.ts` for what each verdict is worth.
	 *
	 * Null before the first exploration, and after one that failed — there is no
	 * answer in hand to ask a question about.
	 */
	async why(question: Question): Promise<Explanation | null> {
		const session = this.#session;
		if (!session) return null;
		return explain(session, {
			base: this.#assumed,
			owned: this.#owned,
			want: questionAtom(question),
		});
	}

	async explore(
		scene: Scene,
		options: ExploreOptions = {},
	): Promise<Exploration> {
		const limit = options.limit ?? DEFAULTS.limit;
		const countLimit = options.countLimit ?? DEFAULTS.countLimit;
		const strategy = options.sample ?? DEFAULTS.sample;
		const seed = options.seed ?? DEFAULTS.seed;
		const poolSize = options.poolSize ?? limit * 2;
		const slack = options.slack ?? DEFAULTS.slack;
		const started = Date.now();

		const { program, generated, guards, userRulesLine, levels } = compile(scene, {
			measurements: options.measurements,
		});
		// Constraints and pins are both assumed rather than baked in: that is
		// what lets an unsatisfiable answer name which of them is at fault, and
		// it means a pin costs a solve rather than a re-grounding.
		//
		// A component instance's overrides come in the same way, because that is
		// all an override is: a pin the document remembers. Written first, so a
		// pin the user set while browsing looks *past* an override on the same
		// variable rather than contradicting it — two assumptions naming the same
		// variable would be an unsatisfiable answer with nothing wrong.
		const held = Object.entries({
			...heldPicks(scene),
			...(options.pins ?? {}),
		});
		const pins = held.map(([variable, index]) => `pick(${variable},${index})`);
		// Which of the assumptions below belong to the user, and which of those
		// they can let go of for nothing. A relaxation search may throw any of
		// these switches and must never touch the two below them: `gpull` and
		// `scenery` are how an answer is read, not what the document says.
		const owned: Switch[] = [
			...guards.map((atom) => ({
				atom,
				id: parseAtom(atom)?.args[0] ?? atom,
				free: false,
			})),
			...held.map(([variable, index]) => ({
				atom: `pick(${variable},${index})`,
				id: variable,
				free: true,
			})),
		];
		// The pull toward each node's stored frame is a switch too, so a freedom
		// probe can take it off. Every ordinary solve wants it on.
		const assume = [...guards, ...pins, PULL_ATOM].map((atom) => ({ atom }));
		// Every solve below is one of these two. `bare` is the cheap one — a few
		// dozen atoms of decisions — and it is what all the consequence and
		// sampling work runs on; `withPicture` costs three or four times as many
		// atoms and is asked for only where one is going to be looked at.
		const bare = [...assume, { atom: SCENERY_ATOM, sign: false }];
		const withPicture = [...assume, { atom: SCENERY_ATOM }];
		const reusedGrounding = this.#session !== null && this.#program === program;

		if (!reusedGrounding) await this.#reopen(program, userRulesLine);
		const session = this.#session;
		if (!session) throw new Error("solver session unavailable");
		// A freedom probe reads `__lpx_objective` and nothing else, so it wants
		// the cheap reading too, and so does a why-question.
		this.#assumed = bare;
		this.#owned = owned;

		let solves = 0;
		// True of the exploration whatever question was asked of the program, so
		// the two paths below cannot answer it differently.
		const common: Omit<Common, "ms" | "solves"> = {
			generated,
			reusedGrounding,
			diagnostics: this.#diagnostics,
			levels,
		};
		// Read off the designs that are actually shown, so it is a remark about
		// what is on screen: a rule that only dresses a node in some universes
		// says nothing about the ones that do not.
		const noted = (universes: readonly Universe[]): string[] =>
			measurementNotes(
				scene,
				universes.map((u) => u.model),
				options.measurements,
			);

		// A document that expresses a preference is a different question, not a
		// harder version of the same one: the answer is the near-optimal designs
		// in cost order, and there is nothing to sample. It can decline — a
		// `#maximize` whose condition grounds away ranks nothing — and then this
		// falls through to the ordinary path below.
		if (isOptimizing(program)) {
			const ranked = await this.#rank(
				session,
				bare,
				withPicture,
				limit,
				slack,
				owned,
				poolSize,
				seed,
				countLimit,
			);
			solves += ranked.solves;
			if (ranked.exploration) {
				return {
					...common,
					ms: Date.now() - started,
					solves,
					...ranked.exploration,
					approximations: noted(ranked.exploration.universes),
				};
			}
		}

		// One more than we will show, so `truncated` is exact rather than a
		// guess based on hitting the cap.
		//
		// The one solve that asks for pictures up front. Wherever the space fits
		// in the grid these *are* the universes shown, so gating this would
		// trade a single solve for up to `limit` of them; where it does not, at
		// most `limit + 1` pictures are drawn for nothing.
		const enumerated = await session.solve({
			models: limit + 1,
			mode: "auto",
			assumptions: withPicture,
		});
		solves++;
		if (enumerated.result === "UNSATISFIABLE") {
			throw await diagnose(session, withPicture, owned, enumerated.core);
		}

		const enumeratedUniverses = enumerated.models.map((atoms) =>
			interpret(atoms),
		);
		const truncated = enumeratedUniverses.length > limit;

		let brave: Consequences;
		let cautious: Consequences;
		let total: number | null;
		let universes: Universe[];
		let sampling: SamplingInfo = {
			strategy,
			pool: enumeratedUniverses.length,
			seed,
			sampled: false,
		};

		if (!truncated && enumerated.exhausted) {
			// The enumeration *is* the whole space, so the consequences follow
			// from it directly — no extra round trips, and no sampling needed.
			universes = enumeratedUniverses;
			brave = unionOf(universes);
			cautious = intersectionOf(universes);
			total = universes.length;
			// Nothing was selected: this is the whole space, in solver order.
			sampling = {
				strategy: "first",
				pool: universes.length,
				seed,
				sampled: false,
			};
		} else {
			// Bare: brave and cautious would otherwise union and intersect a whole
			// scene per witness, and `accumulate` reads two predicates of it.
			const [braveOut, cautiousOut, countOut] = await Promise.all([
				session.solve({ models: 0, mode: "brave", assumptions: bare }),
				session.solve({ models: 0, mode: "cautious", assumptions: bare }),
				session.solve({ models: countLimit, countOnly: true, assumptions: bare }),
			]);
			solves += 3;
			// Brave and cautious emit progressive witnesses; the last is the answer.
			brave = accumulate(braveOut.models.at(-1) ?? []);
			cautious = accumulate(cautiousOut.models.at(-1) ?? []);
			total = countOut.exhausted ? countOut.count : null;

			if (strategy === "diverse") {
				const sampled = await this.#sample(session, brave, poolSize, seed, bare);
				solves += sampled.solves;
				// Enumeration order is biased, but those models are still valid
				// candidates; the selector decides what actually earns a slot.
				const pool = dedupe<Candidate>([
					...sampled.candidates,
					...enumeratedUniverses,
				]);
				// Nothing in this pool has a cost, so this is plain farthest-point
				// selection. The same function does the ranked path's choosing, so
				// there is one answer to which designs earn a slot.
				const chosen = selectSpread(pool, limit);
				const hydrated = await this.#hydrate(session, chosen, withPicture);
				solves += hydrated.solves;
				universes = hydrated.universes;
				sampling = { strategy, pool: pool.length, seed, sampled: true };
			} else {
				universes = enumeratedUniverses.slice(0, limit);
				sampling = {
					strategy: "first",
					pool: enumeratedUniverses.length,
					seed,
					sampled: true,
				};
			}
		}

		return {
			...common,
			ms: Date.now() - started,
			approximations: noted(universes),
			universes,
			brave,
			cautious,
			truncated,
			count: universes.length,
			total,
			solves,
			sampling,
			// Nothing ranked: either the document expresses no preference, or the
			// one it expresses grounded away to nothing.
			optimized: false,
			costs: [],
			bound: [],
		};
	}

	/**
	 * The near-optimal designs, best first — a document with a preference in it.
	 *
	 * `optN` alone would answer with the proven optima and nothing else, which on
	 * most documents is a single design: a tool for holding several at once would
	 * become a tool that shows you one, and the preference a designer just wrote
	 * down would have deleted their design space. So the optimum is only the
	 * first question. The second is *bounded suboptimality*: every design within
	 * {@link rankedBound} of it, which clingo answers natively through
	 * `--opt-mode=enum,<bound>` — confirmed against this build, including that
	 * the bound is lexicographic and that the models come back in search order
	 * rather than best first.
	 *
	 * And then the same question the unranked path asks, because a bounded region
	 * that does not fit the grid has the same problem the whole space has and it
	 * was hiding here for a while: enumeration order is not a sample. Measured on
	 * a 729-design document with one soft rule, the bounded enumeration's first
	 * 200 models left one of six fills at a single value — so `brave` reported a
	 * colour as *settled across every good design* when all three of its values
	 * occur in designs that cost exactly the same, and the 24 shown had a mean
	 * pairwise distance of 2.26 against the 4.06 the unranked path gets on the
	 * same document. So the region is sampled too, with the same assumption
	 * sampling and now under the cost ceiling, and the consequences are asked of
	 * the solver *under the bound* rather than read off a truncated pool.
	 *
	 * The cheap case stays cheap. When the bounded enumeration exhausted and the
	 * whole region fits on the grid — the `ranked` template, and any document
	 * whose preference narrows things down hard — there is nothing to sample and
	 * nothing to select, and this is the two solves it always was.
	 *
	 * Every solve here is bare. What comes back is candidates with costs; the
	 * ones that earn a slot are drawn afterwards by the same `#hydrate` a sampled
	 * exploration uses, and a hydrating solve ignores the weak constraints
	 * entirely — the picks it assumes already name one design, so there is
	 * nothing left to rank.
	 *
	 * Returns no exploration when the program's `:~` or `#maximize` turned out to
	 * rank nothing after grounding — an empty cost vector. That is not an error
	 * and not a blank canvas: it is the map template, whose `#maximize` is
	 * switched off by a commented fact, and the caller carries on the ordinary
	 * way.
	 */
	async #rank(
		session: SolverSession,
		bare: ReadonlyArray<Assumption>,
		withPicture: ReadonlyArray<Assumption>,
		limit: number,
		slack: number,
		owned: readonly Switch[],
		poolSize: number,
		seed: number,
		countLimit: number,
	): Promise<{
		// The approximations are the caller's: they are read off the universes
		// this returns, so there is one place that decides what a remark is.
		exploration: Omit<Exploration, keyof Common | "approximations"> | null;
		solves: number;
	}> {
		const best = await session.solve({
			models: 1,
			mode: "optN",
			assumptions: bare,
		});
		let solves = 1;
		if (best.result === "UNSATISFIABLE") {
			// The soft rules cannot be why: a preference costs points, it forbids
			// nothing. So this is the same contradiction the unranked path meets,
			// and it gets the same diagnosis — under the ordinary assumptions,
			// where the weak constraints are ignored entirely.
			throw await diagnose(session, withPicture, owned, best.core);
		}
		const optimum = best.models[0];
		if (!optimum || best.costs.length === 0) {
			return { exploration: null, solves };
		}

		const bound = rankedBound(best.costs, slack);
		const within = await session.solve({
			models: DEFAULTS.rankPool,
			bound,
			assumptions: bare,
		});
		solves++;

		// The optimum first, because a capped enumeration can miss it: measured,
		// `enum` walks the bounded region in search order and the best design was
		// the last model of every run. Prepended rather than appended so `dedupe`
		// keeps it at the front — and so the design `optN` actually proved optimal
		// heads its own tier and is therefore the first artboard.
		const enumerated = dedupe<Candidate>([
			readCandidate(optimum, best.costs),
			...within.models.map((atoms, i) =>
				readCandidate(atoms, within.modelCosts[i] ?? []),
			),
		]);

		let pool = enumerated;
		let brave: Consequences;
		let cautious: Consequences;
		let total: number | null;
		let sampled = false;

		if (within.exhausted && enumerated.length <= limit) {
			// The enumeration *is* the near-optimal region, and all of it fits. The
			// consequences follow from it directly, exactly as they do when the
			// whole space fits in the unranked path.
			brave = unionOf(enumerated);
			cautious = intersectionOf(enumerated);
			total = enumerated.length;
		} else {
			// All three under the bound, which this build honours for brave,
			// cautious and counting alike — verified. Asked of the solver rather
			// than read off the pool because the pool is 200 models of a region
			// that has more, and a union over a truncated enumeration reports
			// variety as settled.
			const [braveOut, cautiousOut, countOut] = await Promise.all([
				session.solve({ models: 0, mode: "brave", bound, assumptions: bare }),
				session.solve({ models: 0, mode: "cautious", bound, assumptions: bare }),
				session.solve({ models: countLimit, countOnly: true, bound, assumptions: bare }),
			]);
			solves += 3;
			brave = accumulate(braveOut.models.at(-1) ?? []);
			cautious = accumulate(cautiousOut.models.at(-1) ?? []);
			total = countOut.exhausted ? countOut.count : null;

			const drawn = await this.#sample(session, brave, poolSize, seed, bare, bound);
			solves += drawn.solves;
			// Sampled before enumerated, as in the unranked path: `selectSpread`
			// sorts stably, so a tie group keeps this order and the greedy
			// selection inside it starts away from the top of the search tree.
			// The optimum stays first of all — it is the one design here that was
			// *proved* to be as good as the document allows.
			pool = dedupe<Candidate>([
				enumerated[0],
				...drawn.candidates,
				...enumerated.slice(1),
			]);
			sampled = true;
		}

		const chosen = selectSpread(pool, limit);
		const hydrated = await this.#hydrate(session, chosen, withPicture);
		solves += hydrated.solves;

		// Over the near-optimal designs rather than the whole space, because for a
		// ranked document that *is* the space: "what every good design agrees
		// about" is the question worth an overlay, and "what every legal design
		// agrees about" would include the designs the preference exists to reject.
		return {
			exploration: {
				universes: hydrated.universes,
				brave,
				cautious,
				truncated: total === null || total > hydrated.universes.length,
				count: hydrated.universes.length,
				total,
				sampling: {
					strategy: "ranked",
					pool: pool.length,
					seed,
					sampled,
				},
				optimized: true,
				costs: best.costs,
				bound,
			},
			solves,
		};
	}

	/**
	 * Draws candidates by assuming a random value for a random subset of the
	 * tokens that vary, letting the solver complete each one.
	 *
	 * Leaving some tokens free is what keeps this robust: when constraints rule
	 * a combination out, the solver still has room to find a nearby legal one
	 * instead of simply returning UNSAT.
	 *
	 * `bound` makes the same mechanism serve a ranked document: every drawn
	 * candidate is then a design *within the cost ceiling*, and it arrives
	 * carrying its own cost so the selection can tier it. Without the bound the
	 * weak constraints are ignored and every candidate would come back costing
	 * nothing, which would sort the whole sample above the proven optimum.
	 */
	async #sample(
		session: SolverSession,
		brave: Consequences,
		poolSize: number,
		seed: number,
		guards: ReadonlyArray<Assumption>,
		bound?: readonly number[],
	): Promise<{ candidates: Candidate[]; solves: number }> {
		const varying = new Map<string, string[]>();
		for (const [variable, indices] of Object.entries(brave.pick)) {
			if (indices.size > 1) {
				varying.set(variable, [...indices].sort().map(String));
			}
		}
		if (varying.size === 0) return { candidates: [], solves: 0 };

		const rng = makeRng(seed);
		const seen = new Set<string>();
		const candidates: Candidate[] = [];
		let solves = 0;
		let misses = 0;
		let coverage = DEFAULTS.coverage;

		while (candidates.length < poolSize && misses < DEFAULTS.maxMisses) {
			const assumptions = randomAssumptions(varying, rng, coverage);
			// The guards stay on: a sample must be a legal design too. `scenery` is
			// among them, off — this loop fires most of the solves in an
			// exploration and reads nothing but the picks.
			const outcome = await session.solve({
				models: 1,
				bound,
				assumptions: [...guards, ...assumptions],
			});
			solves++;

			const first = outcome.models[0];
			if (outcome.result !== "SATISFIABLE" || !first) {
				// Too much was assumed for the constraints to allow — or, under a
				// bound, for any design that cheap to exist. Ask for less.
				misses++;
				coverage = Math.max(0.2, coverage * 0.7);
				continue;
			}
			const candidate = readCandidate(first, outcome.modelCosts[0] ?? []);
			const key = universeKey(candidate);
			if (seen.has(key)) {
				misses++;
				continue;
			}
			seen.add(key);
			candidates.push(candidate);
			misses = 0;
		}
		return { candidates, solves };
	}

	/**
	 * Asks for the picture of the candidates that earned a slot.
	 *
	 * One solve each, with every one of the candidate's picks assumed — and
	 * `1 { pick(V,I) : alt(V,I) } 1` means assuming them fixes the discrete half
	 * of the answer set exactly, so what comes back is the design that was
	 * chosen and not merely one nearby. It cannot be unsatisfiable: the
	 * candidate itself witnesses that those picks hold together, and `scenery`
	 * is a free choice on top of them. If it ever is, that is a bug in this
	 * file and the exploration says so rather than drawing an empty canvas.
	 *
	 * The candidates that came out of the enumeration already have a picture, so
	 * this costs at most `limit` solves and usually fewer.
	 */
	async #hydrate(
		session: SolverSession,
		chosen: readonly Candidate[],
		guards: ReadonlyArray<Assumption>,
	): Promise<{ universes: Universe[]; solves: number }> {
		let solves = 0;
		const universes = await Promise.all(
			chosen.map(async (candidate) => {
				if (isDrawn(candidate)) return candidate;
				const outcome = await session.solve({
					models: 1,
					assumptions: [
						...guards,
						...Object.entries(candidate.pick).map(([variable, index]) => ({
							atom: `pick(${variable},${index})`,
						})),
					],
				});
				solves++;
				const atoms = outcome.models[0];
				if (!atoms) {
					throw new Error(
						`a chosen design could not be drawn: ${outcome.result}`,
					);
				}
				// Carried over rather than re-read: this solve assumed the picks and
				// so has no bound and no cost of its own, and the cost is why the
				// candidate was chosen.
				return interpret(atoms, candidate.costs);
			}),
		);
		return { universes, solves };
	}

	async #reopen(program: string, userRulesLine: number): Promise<void> {
		await this.close();
		try {
			// `#project` directives in the program only take effect with the
			// flag, and without it two alternatives spelling the same colour
			// would show up as two separate designs.
			this.#session = await this.#solver.open(program, "--project");
			this.#program = program;
			// Read here rather than at every exploration: grounding is when
			// clingo has anything to say, and a reused grounding keeps whatever
			// it said the first time.
			this.#diagnostics = formatDiagnostics(
				this.#session.diagnostics,
				userRulesLine,
			);
		} catch (err) {
			// Rewrite clingo's line numbers to point at the user's own rules.
			const message =
				err instanceof Error
					? formatDiagnostics(err.message, userRulesLine)
					: String(err);
			throw new Error(message || "clingo failed to ground the program");
		}
	}

	async close(): Promise<void> {
		const session = this.#session;
		this.#session = null;
		this.#program = "";
		this.#assumed = [];
		this.#owned = [];
		this.#diagnostics = "";
		if (session) await session.close();
	}
}

/** Variables whose alternative is not settled across the whole space. */
export function varyingVars(exploration: Exploration): string[] {
	return Object.entries(exploration.brave.pick)
		.filter(([, indices]) => indices.size > 1)
		.map(([variable]) => variable);
}

/**
 * One-shot convenience: opens a session, explores, and closes it again.
 * Prefer {@link Explorer} anywhere the same document is explored twice.
 */
export async function explore(
	scene: Scene,
	solver: Solver,
	options: ExploreOptions = {},
): Promise<Exploration> {
	const explorer = new Explorer(solver);
	try {
		return await explorer.explore(scene, options);
	} finally {
		await explorer.close();
	}
}
