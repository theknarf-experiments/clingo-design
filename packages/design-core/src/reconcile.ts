/**
 * Turning a replacement into the mutations that would have produced it.
 *
 * The editor hands out a whole new {@link Scene} on every keystroke, but a
 * document store records what changed rather than what the value now is.
 * Assigning the replacement wholesale would rewrite every field of every
 * node, so the new value is walked against the old one and only the
 * differences are written.
 *
 * Nothing here knows what it is mutating. The store's drafts behave like
 * plain objects and arrays, which is the whole interface this needs.
 */

type Holder = Record<PropertyKey, unknown>;

/**
 * Mutates `target` until it matches `source`, and reports whether it had to.
 *
 * The answer matters: a caller that stamps an "updated at" alongside the edit
 * would otherwise stamp it for edits that were not edits.
 */
export function reconcile(target: object, source: object): boolean {
	return Array.isArray(source)
		? reconcileList(target as unknown[], source)
		: reconcileMap(target as Holder, source as Holder);
}

function reconcileMap(target: Holder, source: Holder): boolean {
	let changed = false;
	// A key the replacement does not carry — or carries as undefined, which is
	// what a spread that clears a field leaves behind — is a deletion.
	for (const key of Object.keys(target)) {
		if (source[key] === undefined) {
			delete target[key];
			changed = true;
		}
	}
	for (const key of Object.keys(source)) {
		if (source[key] === undefined) continue;
		if (assign(target, key, source[key])) changed = true;
	}
	return changed;
}

/**
 * Lists are matched by position. A reordering therefore rewrites the span it
 * moved across; the alternative is an alignment pass, and scene lists are
 * short enough that it would not pay for itself.
 */
function reconcileList(target: unknown[], source: readonly unknown[]): boolean {
	let changed = false;
	if (target.length > source.length) {
		target.splice(source.length, target.length - source.length);
		changed = true;
	}
	for (let i = 0; i < source.length; i++) {
		if (i >= target.length) {
			target.push(copy(source[i]));
			changed = true;
		} else if (assign(target as unknown as Holder, i, source[i])) {
			changed = true;
		}
	}
	return changed;
}

function assign(holder: Holder, key: PropertyKey, next: unknown): boolean {
	const current = holder[key];
	if (isBranch(current) && isBranch(next) && Array.isArray(current) === Array.isArray(next)) {
		return reconcile(current, next);
	}
	if (Object.is(current, next)) return false;
	holder[key] = copy(next);
	return true;
}

/**
 * What actually gets written. A replacement reuses whole subtrees of the value
 * it replaces, so an insert would otherwise store an object the target already
 * holds elsewhere — which a document store is entitled to refuse, and does.
 * Keys explicitly set to `undefined` are dropped for the same reason a missing
 * key is: nothing stores a hole.
 */
function copy(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(copy);
	if (!isBranch(value)) return value;
	const out: Holder = {};
	for (const [key, inner] of Object.entries(value)) {
		if (inner !== undefined) out[key] = copy(inner);
	}
	return out;
}

function isBranch(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}
