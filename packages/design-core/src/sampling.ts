/**
 * Choosing which universes to show.
 *
 * Enumeration order is not a sample. A solver walks a search tree, so the
 * first N answer sets fix the early decisions and vary only the late ones —
 * measured on a 531,441-universe space, the first 24 models left four of six
 * tokens at a single value. Showing that as "the multiverse" is misleading.
 *
 * Two mechanisms fix it:
 *
 *   * *Assumption sampling* — assume a random value for a random subset of
 *     tokens and let the solver complete it. Each solve is heavily constrained
 *     and therefore fast, and the result is spread across every dimension.
 *   * *Greedy max-min selection* — from a larger pool, repeatedly take the
 *     candidate furthest from everything chosen so far, so the grid shows
 *     contrast rather than near-duplicates.
 */
import type { Candidate } from "./explore.ts";

/**
 * How the shown universes were chosen.
 *
 * `first` is enumeration order — biased, and only honest when it *is* the whole
 * space. `diverse` is the two mechanisms above. `ranked` is both mechanisms
 * *under a cost ceiling*: the document expresses a preference, so only designs
 * within the bound are candidates at all, and they are shown cheapest first.
 *
 * That last strategy used to sample nothing, on the argument that a diverse
 * spread of a ranked space would put a bad design next to the best one with no
 * way to tell which was which. The argument was right and the conclusion was
 * wrong. Ranking does not order the near-optimal designs into a queue; it sorts
 * them into a handful of *tiers*, and inside a tier every design is exactly as
 * good as every other. Measured on a 729-design space with one soft rule, all
 * 24 designs shown were tied at cost 0 while 243 designs shared that cost — so
 * search order, not the preference, was choosing 24 of the 243. Diversity
 * *inside a tier* costs the ranking nothing, and {@link selectSpread} is where
 * that is made precise.
 */
export type SampleStrategy = "first" | "diverse" | "ranked";

/**
 * A small deterministic PRNG (xorshift32).
 *
 * Determinism is the point: the same seed must produce the same grid, so an
 * unrelated re-render never reshuffles what the user is looking at. Reseeding
 * is an explicit act.
 */
export function makeRng(seed: number): () => number {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state >>>= 0;
		state ^= state >> 17;
		state ^= state << 5;
		state >>>= 0;
		return state / 0x1_0000_0000;
	};
}

/** Identity of a universe, for de-duplication. */
export function universeKey(universe: Candidate): string {
	const picks = Object.entries(universe.pick)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([variable, index]) => `${variable}=${index}`);
	const visible = [...universe.visible].sort();
	return `${picks.join(",")}|${visible.join(",")}`;
}

/**
 * How different two universes are: differing token bindings plus differing
 * node visibility. Tokens that are settled contribute nothing, so distance
 * automatically measures only what actually varies.
 */
export function distance(a: Candidate, b: Candidate): number {
	let d = 0;
	const variables = new Set([...Object.keys(a.pick), ...Object.keys(b.pick)]);
	for (const variable of variables) {
		if (a.pick[variable] !== b.pick[variable]) d++;
	}
	const nodes = new Set([...a.visible, ...b.visible]);
	for (const node of nodes) {
		if (a.visible.has(node) !== b.visible.has(node)) d++;
	}
	return d;
}

/**
 * Greedy max-min (farthest-point) selection.
 *
 * Deterministic: it always starts from the pool's first element, so the same
 * pool yields the same order.
 */
export function selectDiverse<T extends Candidate>(
	pool: readonly T[],
	k: number,
): T[] {
	if (pool.length <= k) return [...pool];

	const chosen: T[] = [pool[0]];
	const remaining = pool.slice(1);
	// Distance from each remaining candidate to the chosen set.
	const nearest = remaining.map((u) => distance(u, pool[0]));

	while (chosen.length < k && remaining.length > 0) {
		let best = 0;
		for (let i = 1; i < remaining.length; i++) {
			if (nearest[i] > nearest[best]) best = i;
		}
		const picked = remaining[best];
		chosen.push(picked);
		remaining.splice(best, 1);
		nearest.splice(best, 1);
		for (let i = 0; i < remaining.length; i++) {
			nearest[i] = Math.min(nearest[i], distance(remaining[i], picked));
		}
	}
	return chosen;
}

/**
 * Lexicographic order on cost vectors: the first level they differ at decides,
 * and a shorter vector is padded with zeros.
 *
 * This is what `@` levels *mean*, and it is why the ordering is done here at
 * all: a bounded enumeration comes back in search order, and on every program
 * tried the optimum was the last model of the run.
 *
 * It lives beside the selection rather than beside the solving because the only
 * thing it decides is which designs earn a slot — see {@link selectSpread},
 * whose whole argument is that "equal cost" is a bigger equivalence class than
 * it looks.
 */
export function compareCosts(a: readonly number[], b: readonly number[]): number {
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

/**
 * The k designs to show: a spread of the *good* ones.
 *
 * Diversity and ranking pull against each other — the most diverse two dozen
 * are not the best two dozen — and this is where the pull is resolved. Not by
 * trading one off against the other, which would need a weight nobody can
 * choose honestly, but by noticing that the conflict is mostly imaginary. A
 * cost vector is a *tier*, not a place in a queue: two designs with equal cost
 * are equally good by the only measure the document states, and which of them
 * gets a slot is a question preference has no opinion about. So the tiers are
 * filled cheapest first, and the choice *within* the tier that runs out of room
 * is the one that shows the most contrast.
 *
 * What that buys is exact, and worth stating as a guarantee: the multiset of
 * costs this returns is identical to what sorting the pool and taking the first
 * k returns. No design shown here is worse than a design the old code would
 * have shown. Diversity is bought for nothing.
 *
 * With no preferences in the document every cost vector is empty, every design
 * is in one tier, and this *is* {@link selectDiverse} — which is why both paths
 * call this one function. There must be one answer to "which designs earn a
 * slot".
 */
export function selectSpread<T extends Candidate>(
	pool: readonly T[],
	k: number,
): T[] {
	// Stable, so a tie group keeps the pool's order and the greedy selection
	// inside it starts where the pool meant it to.
	const sorted = [...pool].sort((a, b) => compareCosts(a.costs, b.costs));
	const chosen: T[] = [];
	let i = 0;
	while (i < sorted.length && chosen.length < k) {
		let end = i;
		while (
			end < sorted.length &&
			compareCosts(sorted[end].costs, sorted[i].costs) === 0
		) {
			end++;
		}
		const tier = sorted.slice(i, end);
		const room = k - chosen.length;
		// A tier that fits goes in whole; only the one that overflows is selected
		// from, and that is the only place diversity gets a say.
		chosen.push(...(tier.length <= room ? tier : selectDiverse(tier, room)));
		i = end;
	}
	return chosen;
}

/**
 * Builds one random assumption set: a value for a random subset of the tokens
 * that vary. Leaving some tokens free keeps the query satisfiable when
 * constraints rule combinations out, and lets the solver fill the rest.
 */
export function randomAssumptions(
	/** Variable key -> the alternative indices it may take, as strings. */
	candidates: ReadonlyMap<string, readonly string[]>,
	rng: () => number,
	coverage: number,
): Array<{ atom: string }> {
	const out: Array<{ atom: string }> = [];
	for (const [token, values] of candidates) {
		if (values.length === 0) continue;
		if (rng() >= coverage) continue;
		const value = values[Math.floor(rng() * values.length)];
		out.push({ atom: `pick(${token},${value})` });
	}
	return out;
}
