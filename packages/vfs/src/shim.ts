/**
 * Just enough of vitest's surface to run this package's tests unchanged.
 *
 * `vfs` was copied wholesale from another repo of ours where the test runner is
 * vitest; here every package tests with `node --test` and `node:assert`. The two
 * ways to reconcile that are to rewrite sixty assertions or to translate the
 * handful of matchers they use, and this is the second — chosen because the
 * tests are the part of this package most likely to be **re-copied**. Upstream
 * keeps changing (a storage layout, an endpoint shape), and a test file that is
 * byte-identical to theirs can be brought across with `cp`; one that has been
 * hand-converted has to be re-converted, by someone reading both dialects, every
 * time.
 *
 * So the price of the copy is paid once, here, in one file. The only edit made
 * to the test files themselves is the import specifier on line one.
 *
 * **Deliberately not a general vitest.** It implements exactly the six matchers
 * these tests use and nothing else, so a test copied across that reaches for a
 * seventh fails loudly on an undefined method rather than passing vacuously —
 * which is the failure mode a permissive shim would have, and the reason not to
 * write `toBe` as a no-op-if-unknown fallback.
 */
import assert from "node:assert/strict";

export { describe, it, test } from "node:test";

/** The matchers, over one already-settled value. */
interface Matchers {
	toBe(expected: unknown): void;
	toEqual(expected: unknown): void;
	toBeUndefined(): void;
	toHaveLength(n: number): void;
	toBeInstanceOf(ctor: abstract new (...args: never[]) => unknown): void;
}

function matchers(value: unknown, message: string | undefined, negated: boolean): Matchers {
	// One place decides what a failure reads as, so a negated matcher does not
	// have to invent its own sentence.
	const check = (ok: boolean, detail: string) => {
		assert.ok(negated ? !ok : ok, message ?? (negated ? `not ${detail}` : detail));
	};
	return {
		toBe(expected) {
			if (negated) return check(Object.is(value, expected), `is ${String(expected)}`);
			// Through assert.strictEqual rather than assert.ok when positive, so the
			// runner prints the diff it is good at rather than a bare "expected true".
			if (message === undefined) assert.strictEqual(value, expected);
			else assert.strictEqual(value, expected, message);
		},
		toEqual(expected) {
			if (negated) return check(deepEqual(value, expected), "deep-equals");
			if (message === undefined) assert.deepStrictEqual(value, expected);
			else assert.deepStrictEqual(value, expected, message);
		},
		toBeUndefined() {
			check(value === undefined, "is undefined");
		},
		toHaveLength(n) {
			check((value as { length?: number })?.length === n, `has length ${n}`);
		},
		toBeInstanceOf(ctor) {
			check(value instanceof ctor, `is a ${ctor.name}`);
		},
	};
}

/** `deepStrictEqual` as a predicate, for the negated case. */
function deepEqual(a: unknown, b: unknown): boolean {
	try {
		assert.deepStrictEqual(a, b);
		return true;
	} catch {
		return false;
	}
}

export function expect(value: unknown, message?: string) {
	return {
		...matchers(value, message, false),
		not: matchers(value, message, true),
		/**
		 * `await expect(p).resolves.toBeUndefined()`.
		 *
		 * The matchers come back as promises, so the `await` at the call site is
		 * what actually waits — which means a rejected promise fails the test by
		 * rejecting rather than by an assertion, and says which call it was.
		 */
		resolves: {
			async toBeUndefined() {
				matchers(await (value as Promise<unknown>), message, false).toBeUndefined();
			},
			async toBe(expected: unknown) {
				matchers(await (value as Promise<unknown>), message, false).toBe(expected);
			},
			async toEqual(expected: unknown) {
				matchers(await (value as Promise<unknown>), message, false).toEqual(expected);
			},
		},
	};
}

/**
 * `vi.fn` as the identity it is used as here.
 *
 * These tests never ask a spy what it recorded — they close over their own
 * `calls` array and push to it — so the whole of `vi.fn` in this package is
 * "wrap this implementation". Implementing call tracking nobody reads would be
 * inventing a feature to satisfy a name.
 */
export const vi = {
	fn: <T>(impl: T): T => impl,
};
