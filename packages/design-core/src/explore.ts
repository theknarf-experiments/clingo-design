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
import { PULL_ATOM, compile } from "./compile.ts";
import { formatDiagnostics, parseAtom } from "./atoms.ts";
import { type Freedom, probeFreedom } from "./freedom.ts";
import type { Frame } from "./geometry.ts";
import type { Measurements } from "./measure.ts";
import { type ModelScene, readModel, readSolved } from "./model.ts";
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
	 * Lazy, and deliberately. A sampling run interprets a few hundred
	 * candidates and shows two dozen of them, so building a scene for each
	 * would be work thrown away — `distance` and `universeKey`, the only things
	 * that read a rejected candidate, never touch this.
	 */
	readonly model: ModelScene;
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

/**
 * Thrown when the program admits no universes at all.
 *
 * Everything the user can switch on — a constraint, a pinned value — is
 * assumed rather than baked in, so an unsatisfiable answer comes back with a
 * *core*: the smallest subset of those switches that cannot hold together.
 * `conflict` names the guilty constraints and `pinned` the guilty pins. Both
 * are empty when the contradiction is somewhere the solver cannot attribute,
 * such as a hand-written rule.
 */
export class UnsatisfiableError extends Error {
	readonly conflict: string[];
	readonly pinned: string[];

	constructor(conflict: string[] = [], pinned: string[] = []) {
		super(blame(conflict, pinned));
		this.name = "UnsatisfiableError";
		this.conflict = conflict;
		this.pinned = pinned;
	}
}

function blame(conflict: readonly string[], pinned: readonly string[]): string {
	const rules = `${conflict.length} rule${conflict.length === 1 ? "" : "s"}`;
	if (conflict.length > 0 && pinned.length > 0) {
		return `The pinned values and ${rules} cannot hold together.`;
	}
	if (pinned.length > 0) return "The pinned values cannot hold together.";
	if (conflict.length > 0) return `${rules} cannot hold together.`;
	return "No design satisfies these rules.";
}

/** Splits a core back into the constraints and the pins it names. */
function attribute(core: readonly string[]): {
	conflict: string[];
	pinned: string[];
} {
	const conflict: string[] = [];
	const pinned: string[] = [];
	for (const atom of core) {
		// The core echoes the assumptions as given, sign prefix and all.
		const guard = /^\+?active\(([^)]+)\)$/.exec(atom);
		if (guard) {
			conflict.push(guard[1]);
			continue;
		}
		const pin = /^\+?pick\((.+),(\d+)\)$/.exec(atom);
		if (pin) pinned.push(pin[1]);
	}
	return { conflict, pinned };
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
	let scene: ModelScene | undefined;
	const universe: Universe = {
		pick: {},
		visible: new Set(),
		solved: readSolved(atoms),
		get model(): ModelScene {
			// Memoised on the universe rather than on whoever draws it: a grid
			// cell re-renders far more often than it is re-solved.
			return (scene ??= readModel(atoms));
		},
	};
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
	/**
	 * Alternatives the user has fixed, as variable -> index.
	 *
	 * These are *assumptions*, not edits: they narrow what the solver returns
	 * without touching the document, so browsing a space costs a solve and is
	 * undone by forgetting them rather than by an undo entry.
	 */
	pins?: Readonly<Record<string, number>>;
	/**
	 * Natural sizes for the nodes that size themselves to their content, from
	 * whoever has a canvas to measure with — see `measure.ts`. They are part of
	 * the program, so changing one re-grounds.
	 */
	measurements?: Measurements;
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

/**
 * Weak constraints or #minimize/#maximize mean the program ranks its models.
 *
 * A theory `&minimize` is emphatically not that: it ranks the *points* the
 * simplex solver may return inside one answer set, and every answer set is
 * still an equal answer. Matching it here would switch every document with
 * solved geometry into `optN` and throw away the sampling.
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
	#program = "";
	/** What the last exploration assumed, so a probe asks about that document. */
	#assumed: ReadonlyArray<{ atom: string; sign?: boolean }> = [];

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

		const { program, generated, guards, userRulesLine } = compile(scene, {
			measurements: options.measurements,
		});
		// Constraints and pins are both assumed rather than baked in: that is
		// what lets an unsatisfiable answer name which of them is at fault, and
		// it means a pin costs a solve rather than a re-grounding.
		const pins = Object.entries(options.pins ?? {}).map(
			([variable, index]) => `pick(${variable},${index})`,
		);
		// The pull toward each node's stored frame is a switch too, so a freedom
		// probe can take it off. Every ordinary solve wants it on.
		const assume = [...guards, ...pins, PULL_ATOM].map((atom) => ({ atom }));
		const reusedGrounding = this.#session !== null && this.#program === program;

		if (!reusedGrounding) await this.#reopen(program, userRulesLine);
		const session = this.#session;
		if (!session) throw new Error("solver session unavailable");
		this.#assumed = assume;

		const optimized = isOptimizing(program);
		let solves = 0;

		// One more than we will show, so `truncated` is exact rather than a
		// guess based on hitting the cap. In an optimising program only proven
		// optima count as answers.
		const enumerated = await session.solve({
			models: limit + 1,
			mode: optimized ? "optN" : "auto",
			assumptions: assume,
		});
		solves++;
		if (enumerated.result === "UNSATISFIABLE") {
			const { conflict, pinned } = attribute(enumerated.core);
			throw new UnsatisfiableError(conflict, pinned);
		}

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
				session.solve({ models: 0, mode: "brave", assumptions: assume }),
				session.solve({ models: 0, mode: "cautious", assumptions: assume }),
				session.solve({ models: countLimit, countOnly: true, assumptions: assume }),
			]);
			solves += 3;
			// Brave and cautious emit progressive witnesses; the last is the answer.
			brave = accumulate(braveOut.models.at(-1) ?? []);
			cautious = accumulate(cautiousOut.models.at(-1) ?? []);
			total = countOut.exhausted ? countOut.count : null;

			if (strategy === "diverse" && !optimized) {
				const drawn = await this.#sample(session, brave, poolSize, seed, assume);
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
		guards: ReadonlyArray<{ atom: string }>,
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
			// The guards stay on: a sample must be a legal design too.
			const outcome = await session.solve({
				models: 1,
				assumptions: [...guards, ...assumptions],
			});
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
		this.#assumed = [];
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
