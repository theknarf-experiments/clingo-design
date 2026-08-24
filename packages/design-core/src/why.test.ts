/**
 * Why is this blue?
 *
 * Every case goes through the real solver, and it has to: the whole mechanism
 * is what clingo hands back as a core and which subsets of the assumptions it
 * calls unsatisfiable. A hand-written atom list would be testing the arithmetic
 * of this file against itself.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { Explorer } from "./explore.ts";
import { palette } from "./templates/palette.ts";
import { sudoku } from "./templates/sudoku.ts";
import { card } from "./templates/card.ts";
import { type Explanation, describeExplanation, explain } from "./why.ts";

/** Names as the panel would supply them. */
const NAMES = {
	rule: (id: string) => (id === "k_distinct" ? "Fill all different" : id),
	pin: (v: string) => v.replace(/^prop\(([^,]+),(.+)\)$/, "$1 $2"),
};

/** The variable behind one button's fill on the palette template. */
const fillOf = (node: string) => `prop(${node},fill)`;

async function ask(
	scene: Parameters<Explorer["explore"]>[0],
	pins: Record<string, number>,
	question: Parameters<Explorer["why"]>[0],
): Promise<Explanation> {
	const explorer = new Explorer(directSolver);
	try {
		await explorer.explore(scene, { pins, limit: 4 });
		const answer = await explorer.why(question);
		assert.ok(answer, "an exploration was in hand, so there is an answer");
		return answer;
	} finally {
		await explorer.close();
	}
}

test("a why-question before any exploration has no answer at all", async () => {
	const explorer = new Explorer(directSolver);
	try {
		assert.equal(
			await explorer.why({
				kind: "alternative",
				variable: fillOf("two"),
				index: 0,
			}),
			null,
		);
	} finally {
		await explorer.close();
	}
});

test("an alternative nothing rules out comes back possible", async () => {
	// No pins: `differ` cuts 27 combinations to 6, and every colour still lands
	// on every button somewhere in those 6.
	const answer = await ask(palette(), {}, {
		kind: "alternative",
		variable: fillOf("two"),
		index: 0,
	});
	assert.equal(answer.verdict, "possible");
	assert.deepEqual(answer.reasons, []);
	// One solve to find out, which is the cheapest question in the file.
	assert.equal(answer.solves, 1);
});

test("a rule and a pin together are named as one reason, and neither alone", async () => {
	// One is pinned blue and `differ` forbids a second blue, so two cannot be
	// blue — and it takes *both* of those to forbid it.
	const answer = await ask(palette(), { [fillOf("one")]: 0 }, {
		kind: "alternative",
		variable: fillOf("two"),
		index: 0,
	});
	assert.equal(answer.verdict, "forced");
	assert.equal(answer.reasons.length, 1);
	assert.deepEqual(answer.reasons[0].rules, ["k_distinct"]);
	assert.deepEqual(answer.reasons[0].pins, [fillOf("one")]);
	// Two switches that only work together, so neither is a reason on its own.
	assert.equal(answer.smallest, false);
	assert.equal(answer.reasons[0].free, false);
	// Letting go of either makes blue available again — proved by a solve.
	assert.equal(answer.sufficient, true);
});

test("the innocent rule is not blamed, even though the core names it", async () => {
	// The pin alone forbids the *pinned* button taking another colour. clingo's
	// core for this includes `active(k_distinct)` — measured — so a tool that
	// read the core out loud would blame the `differ` rule for a pin's doing.
	const answer = await ask(palette(), { [fillOf("one")]: 0 }, {
		kind: "alternative",
		variable: fillOf("one"),
		index: 1,
	});
	assert.equal(answer.verdict, "forced");
	assert.equal(answer.reasons.length, 1);
	assert.deepEqual(answer.reasons[0].rules, []);
	assert.deepEqual(answer.reasons[0].pins, [fillOf("one")]);
	// One switch, found by the exhaustive sweep, so it is the smallest there is.
	assert.equal(answer.smallest, true);
	// Nothing to edit: the user asked a question and can stop asking.
	assert.equal(answer.reasons[0].free, true);
	assert.equal(answer.sufficient, true);
});

test("why is it this — an unpinned value is not forced at all", async () => {
	const answer = await ask(palette(), {}, {
		kind: "value",
		variable: fillOf("two"),
		index: 0,
	});
	// The negative form: "could it be anything else?" — yes, so nothing forces
	// it and the honest answer is that this universe simply chose.
	assert.equal(answer.verdict, "possible");
});

test("why is it this — a pin is what forces it, and says so", async () => {
	const answer = await ask(palette(), { [fillOf("one")]: 0 }, {
		kind: "value",
		variable: fillOf("one"),
		index: 0,
	});
	assert.equal(answer.verdict, "forced");
	assert.equal(answer.reasons.length, 1);
	assert.deepEqual(answer.reasons[0].pins, [fillOf("one")]);
	assert.equal(answer.reasons[0].free, true);
	assert.equal(answer.smallest, true);
});

test("two pins each rule the same swatch out on their own", async () => {
	// One is blue and three is yellow, so two can be neither — and each pin
	// does it by itself given `differ`... except `differ` is needed too, so what
	// this really tests is that a *pair* of independent two-switch reasons is
	// not silently collapsed into one.
	const answer = await ask(
		palette(),
		{ [fillOf("one")]: 0, [fillOf("three")]: 1 },
		{ kind: "alternative", variable: fillOf("two"), index: 0 },
	);
	assert.equal(answer.verdict, "forced");
	// The rule plus the pin on `one`. The pin on `three` is a reason for a
	// *different* swatch, so it must not appear here.
	assert.equal(answer.reasons.length, 1);
	assert.deepEqual(answer.reasons[0].rules, ["k_distinct"]);
	assert.deepEqual(answer.reasons[0].pins, [fillOf("one")]);
	assert.equal(answer.sufficient, true);
});

test("a document with no switches at all can explain nothing", async () => {
	// The card template has tokens with several values and not one constraint.
	// Every alternative is reachable, so there is nothing to ask — and the
	// negative question comes back possible rather than pretending.
	const answer = await ask(card(), {}, {
		kind: "value",
		variable: "tok(accent)",
		index: 0,
	});
	assert.equal(answer.verdict, "possible");
});

test("a value with a single alternative is forced by nothing the user owns", async () => {
	// `surface` holds one colour, so no other pick exists — and no rule and no
	// pin has anything to do with that. The boundary the UI has to state.
	const answer = await ask(palette(), {}, {
		kind: "value",
		variable: "tok(surface)",
		index: 0,
	});
	assert.equal(answer.verdict, "unattributable");
	assert.deepEqual(answer.reasons, []);
	// Two solves: is it impossible, and is any of it ours.
	assert.equal(answer.solves, 2);
});

test("a sudoku pencil mark has a reason, and admits it is not the only one", async () => {
	// A solved puzzle: every cell but one has eight dim marks, and each is dim
	// for a chain of reasons rather than one. This is the case the honesty
	// fields exist for.
	const answer = await ask(sudoku(), {}, {
		kind: "alternative",
		variable: "prop(cell(3,1),text)",
		index: 3,
	});
	assert.equal(answer.verdict, "forced");
	assert.ok(answer.reasons.length >= 1);
	// Every reason is one of the sudoku's own rules, named.
	for (const reason of answer.reasons) {
		assert.deepEqual(reason.pins, []);
		assert.ok(reason.rules.length > 0);
		for (const rule of reason.rules) {
			assert.match(rule, /^(row|col|box)[1-9]$/);
		}
	}
	// A puzzle with one solution has many independent reasons for each
	// exclusion, so switching off the ones named here is not enough. Saying
	// otherwise would be a lie the user finds out by trying it.
	assert.equal(answer.sufficient, false);
	// The sweep is one solve per rule, so this is a click and not a keystroke.
	assert.ok(answer.solves > 27, `expected the sweep to run, got ${answer.solves}`);
	assert.ok(answer.solves < 128);
});

test("no single rule does it, and the independent chains are listed separately", async () => {
	// Measured on this puzzle: nothing rules this mark out alone, and once the
	// chain that does is switched off another one takes over. Both are true and
	// the panel has to be able to say so — picking one would imply it was the
	// cause.
	const answer = await ask(sudoku(), {}, {
		kind: "alternative",
		variable: "prop(cell(3,1),text)",
		index: 2,
	});
	assert.equal(answer.verdict, "forced");
	assert.equal(answer.smallest, false);
	assert.ok(
		answer.reasons.length >= 2,
		`expected several chains, got ${answer.reasons.length}`,
	);
	for (const reason of answer.reasons) assert.ok(reason.rules.length > 1);
	// Independent by construction: a later reason is searched for only among the
	// switches the earlier ones left alone.
	const seen = new Set<string>();
	for (const reason of answer.reasons) {
		for (const rule of reason.rules) {
			assert.equal(seen.has(rule), false, `${rule} appears in two reasons`);
			seen.add(rule);
		}
	}
});

test("a budget too small to finish still answers, and never claims sufficiency", async () => {
	// The one place `explain` is called directly rather than through the
	// Explorer, because the budget is what is under test and a caller who wants
	// an answer does not pass one.
	const { compile, PULL_ATOM, SCENERY_ATOM } = await import("./compile.ts");
	const { program, guards } = compile(sudoku());
	const session = await directSolver.open(program, "--project");
	try {
		const base = [
			...[...guards, PULL_ATOM].map((atom) => ({ atom })),
			{ atom: SCENERY_ATOM, sign: false },
		];
		const owned = guards.map((atom) => ({
			atom,
			id: atom.slice("active(".length, -1),
			free: false,
		}));
		const answer = await explain(session, {
			base,
			owned,
			want: { atom: "pick(prop(cell(3,1),text),2)", sign: true },
			// Enough to establish impossibility and that a switch is at fault,
			// and then nothing left to sweep with.
			budget: 4,
		});
		assert.ok(answer.solves <= 5, `spent ${answer.solves}`);
		// It found what it could inside the budget and did not claim more: a
		// short search cannot prove the reasons it names are the whole story,
		// and sufficiency is proved by a solve rather than assumed.
		assert.equal(answer.sufficient, false);
		assert.equal(answer.smallest, false);
	} finally {
		await session.close();
	}
});

test("the sentence names the rule and the pin, and says letting either go is enough", async () => {
	const question = {
		kind: "alternative",
		variable: fillOf("two"),
		index: 0,
	} as const;
	const answer = await ask(palette(), { [fillOf("one")]: 0 }, question);
	assert.equal(
		describeExplanation(question, answer, NAMES),
		"Nothing on its own rules this out. Fill all different and your pin on" +
			" one fill together do. Letting go of any one of them would make it" +
			" available.",
	);
});

test("a possible alternative is told it is a duplicate, not a ban", async () => {
	const question = { kind: "alternative", variable: fillOf("two"), index: 0 } as const;
	const answer = await ask(palette(), {}, question);
	assert.match(describeExplanation(question, answer, NAMES), /^Nothing rules this out\./);
	assert.match(describeExplanation(question, answer, NAMES), /already on the canvas/);
});

test("the boundary is stated as a boundary: only rules with a switch can be blamed", async () => {
	const question = { kind: "value", variable: "tok(surface)", index: 0 } as const;
	const answer = await ask(palette(), {}, question);
	assert.equal(answer.verdict, "unattributable");
	assert.match(
		describeExplanation(question, answer, NAMES),
		/only the value the program allows|Nothing you can switch off/,
	);
});

test("a partial sudoku answer never claims to be the whole reason", async () => {
	const question = {
		kind: "alternative",
		variable: "prop(cell(3,1),text)",
		index: 3,
	} as const;
	const answer = await ask(sudoku(), {}, question);
	const words = describeExplanation(question, answer, NAMES);
	assert.match(words, /^Box1 rules this out\./);
	assert.match(words, /part of the reason rather than all of it/);
});
