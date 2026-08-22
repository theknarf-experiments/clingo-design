/**
 * Turns a document into universes the renderer can draw.
 *
 * The grounding is reused: an {@link Explorer} holds a session and only
 * re-opens it when the *program* changes. Almost every edit does change it —
 * the document compiles to facts — so in practice the reuse only catches
 * renames, text edits and a repeated explore of an unchanged document.
 *
 * When enumeration exhausts the space, brave and cautious consequences are
 * derived from the models already in hand rather than asked for separately,
 * which takes the usual exploration from three solves down to one.
 */
import { compile } from "./compile.ts";
import { formatDiagnostics, parseAtom } from "./atoms.ts";
import type { Scene } from "./scene.ts";
import type { Solver, SolverSession } from "./solver.ts";
import {
	type SampleStrategy,
	makeRng,
	randomAssumptions,
	selectDiverse,
	universeKey,
} from "./sampling.ts";

export interface Universe {
	/** variable key -> which alternative is active */
	pick: Record<string, number>;
	/** node ids that survive `visible/1` */
	visible: Set<string>;
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
	/** True when the program optimises and only proven optima are shown. */
	optimized: boolean;
	/** Cost of the optimum, when optimising. */
	costs: number[];
}

/** Thrown when the program admits no universes at all. */
export class UnsatisfiableError extends Error {
	constructor() {
		super("No design satisfies these constraints.");
		this.name = "UnsatisfiableError";
	}
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

function interpret(atoms: readonly string[]): Universe {
	const universe: Universe = { pick: {}, visible: new Set() };
	readAtoms(
		atoms,
		(variable, index) => {
			universe.pick[variable] = index;
		},
		(node) => universe.visible.add(node),
	);
	return universe;
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

function dedupe(universes: readonly Universe[]): Universe[] {
	const seen = new Set<string>();
	const out: Universe[] = [];
	for (const u of universes) {
		const key = universeKey(u);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(u);
	}
	return out;
}

/** Union of the universes: everything that happens somewhere. */
function unionOf(universes: readonly Universe[]): Consequences {
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
function intersectionOf(universes: readonly Universe[]): Consequences {
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
}

const DEFAULTS = {
	limit: 24,
	// Counting 20,000 models costs ~500ms and buys nothing: a space that large
	// reads as "many" either way. 2,000 keeps exact counts for spaces small
	// enough to care about, at ~60ms.
	countLimit: 2_000,
	sample: "diverse" as SampleStrategy,
	seed: 1,
	/** Fraction of varying tokens pinned per sampling query. */
	coverage: 0.75,
	/** Give up on a sampling query set after this many misses in a row. */
	maxMisses: 12,
};

/** Weak constraints or #minimize/#maximize mean the program ranks its models. */
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
	#program = "";

	constructor(solver: Solver) {
		this.#solver = solver;
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
		const started = Date.now();

		const { program, generated, userRulesLine } = compile(scene);
		const reusedGrounding = this.#session !== null && this.#program === program;

		if (!reusedGrounding) await this.#reopen(program, userRulesLine);
		const session = this.#session;
		if (!session) throw new Error("solver session unavailable");

		const optimized = isOptimizing(program);
		let solves = 0;

		// One more than we will show, so `truncated` is exact rather than a
		// guess based on hitting the cap. In an optimising program only proven
		// optima count as answers.
		const enumerated = await session.solve({
			models: limit + 1,
			mode: optimized ? "optN" : "auto",
		});
		solves++;
		if (enumerated.result === "UNSATISFIABLE") throw new UnsatisfiableError();

		const enumeratedUniverses = enumerated.models.map(interpret);
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
			const [braveOut, cautiousOut, countOut] = await Promise.all([
				session.solve({ models: 0, mode: "brave" }),
				session.solve({ models: 0, mode: "cautious" }),
				session.solve({ models: countLimit, countOnly: true }),
			]);
			solves += 3;
			// Brave and cautious emit progressive witnesses; the last is the answer.
			brave = accumulate(braveOut.models.at(-1) ?? []);
			cautious = accumulate(cautiousOut.models.at(-1) ?? []);
			total = countOut.exhausted ? countOut.count : null;

			if (strategy === "diverse" && !optimized) {
				const drawn = await this.#sample(session, brave, poolSize, seed);
				solves += drawn.solves;
				// Enumeration order is biased, but those models are still valid
				// candidates; the selector decides what actually earns a slot.
				const pool = dedupe([...drawn.universes, ...enumeratedUniverses]);
				universes = selectDiverse(pool, limit);
				sampling = { strategy, pool: pool.length, seed, sampled: true };
			} else {
				// Optimising programs are already ranked: showing anything other
				// than the best would misrepresent them.
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
			generated,
			universes,
			brave,
			cautious,
			truncated,
			count: universes.length,
			total,
			ms: Date.now() - started,
			solves,
			reusedGrounding,
			sampling,
			optimized,
			costs: enumerated.costs,
		};
	}

	/**
	 * Draws candidates by assuming a random value for a random subset of the
	 * tokens that vary, letting the solver complete each one.
	 *
	 * Leaving some tokens free is what keeps this robust: when constraints rule
	 * a combination out, the solver still has room to find a nearby legal one
	 * instead of simply returning UNSAT.
	 */
	async #sample(
		session: SolverSession,
		brave: Consequences,
		poolSize: number,
		seed: number,
	): Promise<{ universes: Universe[]; solves: number }> {
		const candidates = new Map<string, string[]>();
		for (const [variable, indices] of Object.entries(brave.pick)) {
			if (indices.size > 1) {
				candidates.set(variable, [...indices].sort().map(String));
			}
		}
		if (candidates.size === 0) return { universes: [], solves: 0 };

		const rng = makeRng(seed);
		const seen = new Set<string>();
		const universes: Universe[] = [];
		let solves = 0;
		let misses = 0;
		let coverage = DEFAULTS.coverage;

		while (universes.length < poolSize && misses < DEFAULTS.maxMisses) {
			const assumptions = randomAssumptions(candidates, rng, coverage);
			const outcome = await session.solve({ models: 1, assumptions });
			solves++;

			const first = outcome.models[0];
			if (outcome.result !== "SATISFIABLE" || !first) {
				// Too much was assumed for the constraints to allow; ask for less.
				misses++;
				coverage = Math.max(0.2, coverage * 0.7);
				continue;
			}
			const universe = interpret(first);
			const key = universeKey(universe);
			if (seen.has(key)) {
				misses++;
				continue;
			}
			seen.add(key);
			universes.push(universe);
			misses = 0;
		}
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
