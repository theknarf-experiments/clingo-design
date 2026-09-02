import { type Picks, type Scene, variableCounts } from "@clingo-design/design-core";

/**
 * A design, in the address bar.
 *
 * Present mode walks from page to page and each page is its own document with
 * its own program, so "universe 3 of Home" is not a thing About has ever heard
 * of. **The thing that crosses a page boundary cannot be a universe.** What
 * crosses is `Picks` — variable key to alternative index — because a variable
 * key is built from document ids that pages share: `tok(accent)` is the same
 * token on every page of a project, since `emptyScene()` mints the same six.
 *
 * And there is already a mechanism for "hold these alternatives while I look
 * around, without editing the document": **pins**. They reach the solver as an
 * assumption, so a design costs a solve rather than a re-grounding, leaves undo
 * alone, and is undone by forgetting it. A presentation is a long look around,
 * so its carrier is a pin set and there is no new concept at all.
 *
 * It lives in the **query string** rather than in a ref, and that one decision is
 * what makes the browser's back button work with no code: following a link
 * pushes a url that already holds the design, so going back restores the page
 * *and* what it looked like. Editor state cannot be handed to anybody; a link
 * can.
 */

/**
 * The separator between a variable key and its index.
 *
 * `~`, because a variable key holds `(`, `)`, `,` and `:` — `prop(inst(i1,label),text)`
 * is the realistic worst case — and never a tilde. A key that somehow contains
 * one is **dropped rather than mis-parsed**, which is the whole reason this is a
 * named constant with a sentence attached: a split that took the first tilde
 * would turn one broken pin into a pin on a variable that does not exist, and a
 * pin on a variable that does not exist makes every solve unsatisfiable for a
 * reason nobody in a presentation can see.
 */
const AT = "~";

/** And between pairs. Semicolons are legal in a query value and keys hold none. */
const SEP = ";";

/**
 * A pin set, as one query parameter.
 *
 * Sorted, so that two readings of one design produce one address: the url is
 * compared by the browser's history and by anybody pasting it, and a record's
 * key order is not a fact about the design.
 *
 * Not URI-encoded here. `URLSearchParams` encodes the whole value when the
 * address is built, and encoding twice is the classic way to end up with `%2528`
 * in somebody's link.
 */
export function encodeDesign(picks: Picks): string {
	return Object.keys(picks)
		.sort()
		.map((key) => `${key}${AT}${picks[key]}`)
		.join(SEP);
}

/**
 * And back — dropping anything that is not a pair, rather than throwing.
 *
 * A presentation has no panel to report a malformed address in, and a person who
 * was handed a link cannot fix it. So a bad pair is dropped and the rest survive:
 * a design that is *nearly* what the sender meant is a great deal better than a
 * blank screen, and the alternative — refusing the whole address — would make one
 * stale variable throw away four good ones.
 *
 * The index has to be a whole non-negative number, because it is an index into an
 * alternative list. `Number("")` is 0 and `Number("1.5")` is 1.5, so both are
 * checked rather than either being assumed.
 */
export function decodeDesign(value: string | null | undefined): Picks {
	if (!value) return {};
	const out: Record<string, number> = {};
	for (const pair of value.split(SEP)) {
		if (pair === "") continue;
		const parts = pair.split(AT);
		// Exactly two. A key holding a tilde would split into three and is dropped
		// rather than half-read — see {@link AT}.
		if (parts.length !== 2) continue;
		const [key, index] = parts;
		if (key === "" || index === "") continue;
		// `Number("")` is 0, which is a perfectly good index and a completely wrong
		// reading of `tok(accent)~` — hence the emptiness test above rather than
		// trusting the arithmetic below to notice.
		const at = Number(index);
		if (!Number.isInteger(at) || at < 0) continue;
		out[key] = at;
	}
	return out;
}

/**
 * The pins this document can actually hold.
 *
 * The studio's own stale-pin rule, moved into a pure function so both callers
 * can have it: a pin on a variable that no longer exists — or on an alternative
 * that has since been deleted — would make every solve unsatisfiable for a reason
 * the user cannot see. In the studio there is a panel to see it in and clear it.
 * **In a presentation there is not, so it must not be possible.**
 *
 * Narrower than the studio's rule in one way, deliberately: the studio also keeps
 * a pin the solver's last answer mentioned, because a rule can mint a variable
 * the document does not hold. That needs an answer set, and this runs *before*
 * the first solve of a page you have just walked to — there is nothing to consult
 * yet. A rule-minted variable pinned on one page and dropped on the next is a
 * design that loses one choice; a pin that makes the page unsatisfiable is a
 * presentation that shows nothing at all.
 */
export function holdable(scene: Scene, picks: Picks): Picks {
	const counts = variableCounts(scene);
	const out: Record<string, number> = {};
	for (const [key, index] of Object.entries(picks)) {
		if (index < (counts[key] ?? 0)) out[key] = index;
	}
	return out;
}

/**
 * What to carry forward when a link is followed: what came in, plus what this
 * page actually decided.
 *
 * Merged over what came in rather than replacing it, so a choice made on the
 * first page survives a second page that has never heard of it — which is what
 * makes "present this in the dark one and keep it dark" work across a five-page
 * walk. Only the variables that were still open here are added: a variable the
 * rules settled needs no pin, and a pin per variable would make the address
 * unreadable and pointless.
 */
export function carried(
	incoming: Picks,
	pick: Picks,
	varying: Iterable<string>,
): Picks {
	const out: Record<string, number> = { ...incoming };
	for (const key of varying) {
		const at = pick[key];
		if (typeof at === "number") out[key] = at;
	}
	return out;
}
