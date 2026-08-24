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

export type SampleStrategy = "first" | "diverse";

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
