/**
 * Machine verification, against the real solver.
 *
 * The claim being tested is not "this function returns the right list". It is
 * that a broken state machine is a **named violation** — that switching a check
 * on makes the document unsatisfiable, that the unsat core comes back saying
 * `machine_reachable` and not something anonymous, that switching it off gives
 * the document back, and that softening it to a preference turns the same rule
 * into a price. Every one of those is a claim about clingo, so every test here
 * goes through it.
 *
 * ## The tests that carry the weight
 *
 * `the core names the check` runs a document with all eleven checks on and one
 * thing wrong with it, and asserts that the way out names what is wrong and
 * nothing else — because a core that blamed all eleven, or none, would leave the
 * feature no better than the yellow triangle it exists to replace.
 *
 * `every shipped template is the same document with all eleven checks on` is the
 * no-regression claim, counted on all thirteen rather than argued.
 *
 * And three tests are the ones that could not have been a lint over the document
 * at all, because each of them turns on a number *this universe* resolved rather
 * than a number the scene stores: `a duration token is checked at both ends` for
 * the budget against `mdur/3`, `an exit time is checked in every universe` for
 * `mexit/3`, and `a timeline's length is this universe's too` for `mtlen/3`. In
 * each, one token with two ends is two designs, one of them breaks the rule, and
 * what goes is that design and not the rule. The other three ladder checks read
 * comparands and thresholds the document fixes as plain strings and a linter
 * could genuinely have found them; `machinecheck.ts` says so in as many words
 * rather than claiming the whole rung is something it is not.
 *
 * ## Why the isolating document does not always exist
 *
 * The six ladder checks are not independent about what they *find*, and the
 * documents below are built to isolate what can be isolated and to state what
 * cannot. `machine_states_live` is strictly stronger than `machine_reachable` by
 * construction — `mgreach` walks a subset of `mreach`'s edges — so it can never
 * be the only thing a document breaks: a state it calls dead is either dead
 * outright, which is `machine_reachable` too, or dead behind a guard nothing can
 * meet, which is `machine_guards_possible` too. `the two reachability checks are
 * one implication` asserts exactly that rather than pretending an isolating
 * document exists, and it is the more useful test for it.
 *
 * Everywhere else the isolation is real and is asserted by `blames`, which does
 * not merely look for a name in the core — a core in this build is not minimal
 * and names innocent neighbours — but reads the *relaxation* `findWays` proved
 * with a solve, and holds it equal to exactly the checks named. "And only it" is
 * therefore said once per broken document, in the one place where it is a fact
 * about the document rather than about the solver's search order.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { makeNode, updateConstraint } from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import {
	DEFAULT_DURATION_BUDGET_MS,
	addMachineCheck,
	durationBudgetCheck,
	hasMachineCheck,
	machineCheckFinding,
	machineChecks,
	removeMachineCheck,
} from "./machinecheck.ts";
import { LADDER_CHECKS, MACHINE_CHECKS, writeDuration } from "./machines.ts";
import type {
	Blend,
	Condition,
	Constraint,
	Keyframe,
	Machine,
	MachineInput,
	MachineLayer,
	MachineState,
	Scene,
	SceneNode,
	StatePart,
	Timeline,
	Transition,
	Trigger,
} from "./scene.ts";
import { dimension } from "./scene.ts";
import { TEMPLATES } from "./templates/index.ts";
import { EMU_PER_PX } from "./units.ts";
import { MAX_MS, type Token, type Value, lit, ref, single } from "./values.ts";

const px = (n: number): number => n * EMU_PER_PX;

/* ------------------------------------------------------------------ */
/* The document under test                                             */
/* ------------------------------------------------------------------ */

/**
 * A transition, with the defaults that make one legal without saying anything:
 * enabled, and no motion settings at all, so the program's own `mdefdur` is what
 * paces it. A test that cares about pacing says so.
 */
const edge = (
	spec: Partial<Transition> & { id: string; from: string; to: string },
): Transition => ({ trigger: "pointerenter" as Trigger, enabled: true, ...spec });

const state = (id: string): MachineState => ({ id, name: id, parts: {} });

/**
 * A machine over the button below, spelled the way a document holds one.
 *
 * The states carry no deltas at all, which is deliberate: every check here is a
 * claim about the transition *graph* or about a duration, and none of them reads
 * a delta. A machine that changed nothing about the picture is still a machine
 * that can be broken, and keeping the deltas out means a failing test is about
 * the check rather than about materialisation.
 */
const machine = (
	states: string[],
	transitions: Transition[],
	id = "m1",
): Machine => ({
	id,
	name: "Button states",
	root: "btn",
	states: states.map(state),
	transitions,
});

/**
 * The same machine with the four things the ladder added, threaded through one
 * builder rather than a second one.
 *
 * A layered machine is a machine, and a builder that split them would let a test
 * assert something about a guarded machine that is not true of the plain one
 * beside it. Every field is optional and absent means what it has always meant:
 * no inputs, one implicit layer, no timelines.
 */
const rig = (spec: {
	id?: string;
	states: Array<{
		id: string;
		layer?: string;
		timeline?: string;
		blend?: Blend;
		parts?: Record<string, StatePart>;
	}>;
	transitions: Transition[];
	inputs?: MachineInput[];
	layers?: MachineLayer[];
	timelines?: Timeline[];
}): Machine => ({
	id: spec.id ?? "m1",
	name: "Button states",
	root: "btn",
	states: spec.states.map((s) => ({
		id: s.id,
		name: s.id,
		parts: s.parts ?? {},
		...(s.layer ? { layer: s.layer } : {}),
		...(s.timeline ? { timeline: s.timeline } : {}),
		...(s.blend ? { blend: s.blend } : {}),
	})),
	transitions: spec.transitions,
	...(spec.inputs ? { inputs: spec.inputs } : {}),
	...(spec.layers ? { layers: spec.layers } : {}),
	...(spec.timelines ? { timelines: spec.timelines } : {}),
});

const number = (
	id: string,
	spec: { initial?: string; min?: string; max?: string } = {},
): MachineInput => ({ id, name: id, kind: "number", ...spec });

const key = (at: string, value: string): Keyframe => ({
	at: [lit(at)],
	value: [lit(value)],
});

/**
 * A guard nothing can meet, by the first of `mguardnever/2`'s three routes: two
 * windows on one input that do not overlap, which is `mclash(M,T,T)` — the same
 * arithmetic two transitions are compared with, asked of one.
 *
 * The self-clash rather than the out-of-range one because it needs no declared
 * range, so a document using it says nothing at all about `minlow`/`minhigh` and
 * a failure here cannot be a bug in the range reading.
 */
const contradiction: Condition[] = [
	{ input: "n", op: "lt", value: "0.2" },
	{ input: "n", op: "gt", value: "0.8" },
];

/** A button definition, one use of it, and whatever machine is under test. */
function buttons(spec: {
	machines?: Machine[];
	constraints?: Constraint[];
	tokens?: Token[];
	rules?: string;
} = {}): Scene {
	const label: SceneNode = {
		...makeNode("text", { x: px(12), y: px(14), width: px(136), height: px(20) }, {
			id: "label",
			name: "Label",
		}),
		props: { text: single("Go"), ink: single("#ffffff"), size: single("14px") },
	};
	const definition: SceneNode = {
		...makeNode("frame", { x: px(20), y: px(20), width: px(160), height: px(48) }, {
			id: "btn",
			name: "Button",
		}),
		props: { fill: single("#3b82f6"), radius: single("8px") },
		children: [label],
		component: true,
	};
	return {
		styles: [],
		machines: spec.machines ?? [],
		tokens: spec.tokens ?? [],
		constraints: spec.constraints ?? [],
		rules: spec.rules ?? "",
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(600), height: px(400) }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: single("#ffffff") },
				children: [
					definition,
					{
						...makeNode(
							"instance",
							{ x: px(300), y: px(20), width: px(160), height: px(48) },
							{ id: "b1", name: "b1" },
						),
						instanceOf: "btn",
					},
				],
			},
		],
	};
}

/** The rest↔hover machine every other shape here is a break of. */
const sound = (transitions?: Transition[]): Machine =>
	machine(
		["rest", "hover"],
		transitions ?? [
			edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
		],
	);

/** A document with every canned check switched on. */
function checked(scene: Scene, budget = DEFAULT_DURATION_BUDGET_MS): Scene {
	return machineChecks(budget).reduce(addMachineCheck, scene);
}

const run = (scene: Scene, limit = 200) =>
	explore(scene, directSolver, { limit, sample: "first" });

const fails = async (scene: Scene): Promise<UnsatisfiableError> => {
	const error = await explore(scene, directSolver).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError, "expected no design at all");
	return error;
};

/**
 * A document with nothing left in it, and the one check that is why.
 *
 * Two assertions, and the split between them is the whole of what a core is
 * worth. The core says the reason is **attributable**: it comes back naming
 * switches the document holds, which is the thing a bare `:- munreached(_,_).`
 * typed into the Rules panel could never do — that one is unsatisfiable with an
 * empty conflict and nothing to point at. But a core in this build is not
 * minimal, and `why.ts` opens with the measurement that says so, so the core
 * here also names innocent checks that were merely assumed alongside the guilty
 * one. Reading it out loud would blame them.
 *
 * So the *answer* is the relaxation, which `findWays` proved with a solve:
 * exactly one way out, exactly one rule in it, and switching that rule off
 * really does give the document back. That is what the panel offers and so it
 * is what these tests assert.
 */
async function blames(
	scene: Scene,
	...ids: string[]
): Promise<UnsatisfiableError> {
	const error = await fails(scene);
	const named = new Set(scene.constraints.map((c) => c.id));
	assert.ok(error.conflict.length > 0, "the core blames something rather than nothing");
	assert.ok(
		error.conflict.every((blamed) => named.has(blamed)),
		`the core names rules the document holds, not anonymous ones: ${error.conflict}`,
	);
	// `some` and not `every`, and the difference is a fact about what a core is
	// rather than a weakening. A core is a set of assumptions **sufficient** for
	// the contradiction, not the set of all the ones that are violated: where a
	// document breaks two checks, `active(machine_reachable)` alone already
	// explains why there is no design, and clingo is entitled to hand back only
	// that. The complete answer is the relaxation below, which `findWays` builds
	// by *solving* — dropping the named rule, catching the second core that comes
	// back, and proving the pair with a satisfiable solve.
	assert.ok(
		ids.some((id) => error.conflict.includes(id)),
		`one of ${ids.join(", ")} is in the core: ${error.conflict}`,
	);
	// Sorted on both sides because a way out is a *set*: `findWays` builds it from
	// whichever order the candidate atoms came out of the cores in, and asserting
	// that order would be asserting something about the solver rather than about
	// the document. Several ids where one check implies another, which is a real
	// property of the eleven and is stated at the head of this file rather than
	// papered over — the way out has to switch off everything that is violated,
	// because switching off half of it gives the document nothing back.
	assert.deepEqual(
		error.relaxations.map((way) => [...way.rules].sort()),
		[[...ids].sort()],
		"and it is the only way out",
	);
	assert.deepEqual(error.pinned, [], "no pin is to blame");
	return error;
}

/* ------------------------------------------------------------------ */
/* The shape of a check                                                */
/* ------------------------------------------------------------------ */

test("every check is one line of ASP under its own name", () => {
	const checks = machineChecks();
	assert.deepEqual(
		checks.map((c) => c.id),
		[
			// The graph, first: whether the machine is a machine at all.
			"machine_reachable",
			"machine_no_dead_ends",
			"machine_deterministic",
			"machine_wired",
			// The ladder, next, in the order the rungs were built.
			"machine_guards_possible",
			"machine_states_live",
			"machine_layers_agree",
			"machine_blend_in_range",
			"machine_exit_within_duration",
			"machine_exit_before_end",
			// Taste, last.
			"machine_within_budget",
		],
	);
	// Both arrays are `machines.ts`' own, unchanged: there is one text for each
	// rule and this file is not a second copy of it. The join is a spread at the
	// one place they are read, so the day somebody pastes `LADDER_CHECKS` onto the
	// end of `MACHINE_CHECKS` — which its own comment asks for — these two lines
	// are what says the eleven did not move.
	assert.deepEqual(checks.slice(0, 4), MACHINE_CHECKS);
	assert.deepEqual(checks.slice(4, 10), LADDER_CHECKS);

	// Unique, because an id is a constraint term and two rows answering to one
	// name would be one switch with two checkboxes on it.
	assert.equal(new Set(checks.map((c) => c.id)).size, checks.length);

	for (const check of checks) {
		// The id is both the constraint's term and the head of the body, because
		// for a `custom` constraint those are one thing.
		assert.ok(check.rule.startsWith(`viol(${check.id}) :- `), check.id);
		assert.ok(check.rule.endsWith("."), check.id);
		assert.ok(!check.rule.includes("\n"), `${check.id} is one line`);
		assert.ok(check.label.length > 0, check.id);
		// An ASP constant, or the rule does not ground and the switch never binds.
		assert.match(check.id, /^[a-z][A-Za-z0-9_]*$/);
	}
});

test("the budget's number is in the rule, in the label, and repaired on the way in", () => {
	assert.equal(
		durationBudgetCheck(400).rule,
		"viol(machine_within_budget) :- mdur(_,_,Ms), Ms > 400.",
	);
	assert.equal(durationBudgetCheck(400).label, "No transition longer than 400ms");
	assert.equal(durationBudgetCheck().rule, durationBudgetCheck(400).rule);

	// ASP has no floats, so a fractional budget is rounded rather than spelled.
	assert.ok(durationBudgetCheck(399.6).rule.includes("> 400."));
	// A negative budget is a budget nothing can meet — `mdur/3` clamps at zero —
	// so it reads as "no transition at all", which nobody types on purpose.
	assert.ok(durationBudgetCheck(-50).rule.includes("> 0."));
	// And a number that is not one would spell `Ms > NaN`, taking the whole
	// document down rather than the rule.
	assert.equal(durationBudgetCheck(Number.NaN).rule, durationBudgetCheck().rule);
	assert.ok(durationBudgetCheck(1e12).rule.includes(`> ${MAX_MS}.`));
	assert.equal(
		durationBudgetCheck(1500).label,
		`No transition longer than ${writeDuration(1500)}`,
	);
});

/* ------------------------------------------------------------------ */
/* Firing, and staying silent                                          */
/* ------------------------------------------------------------------ */

test("a sound machine passes every check at once", async () => {
	const scene = checked(buttons({ machines: [sound()] }));
	assert.equal(scene.constraints.length, 11);
	const out = await run(scene);
	assert.ok(out.count >= 1, "the document still has designs");
});

test("the checks say nothing about a document with no machine in it", async () => {
	// Every body quantifies over predicates that ground to nothing here, so eleven
	// switched-on rules cost the document exactly nothing. Which is what lets a
	// panel leave them on by default — and it is the whole reason the ladder's
	// compile step opens with a `#defined` block, because a body naming a predicate
	// no rule heads is a clingo remark per predicate, landing in `diagnostics`,
	// which the studio shows the designer as a problem with *their* document.
	const scene = checked(buttons());
	assert.equal(scene.constraints.length, 11);
	assert.equal(await run(scene).then((o) => o.count), 1);
});

test("an unreachable state is a violation with a name", async () => {
	const broken = machine(
		["rest", "hover", "ghost"],
		[
			edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			// `ghost` leaves somewhere, so it is unreachable without also being a dead
			// end.
			edge({ id: "escape", from: "ghost", to: "rest", trigger: "click" }),
		],
	);
	// TWO names, and the second is the ladder's own implication showing through
	// rather than a leak: `mgreach/2` walks a subset of `mreach/2`'s edges, so a
	// state nothing reaches is also a state no *feasible* chain reaches, and both
	// rules fire. The way out has to let go of both, because letting go of one
	// gives the document nothing back — which is the honest answer and the one
	// `relax.ts` proves with a solve rather than inferring.
	await blames(
		checked(buttons({ machines: [broken] })),
		"machine_reachable",
		"machine_states_live",
	);

	// And the same machine with the way in put back is a document again.
	const fixed = machine(broken.states.map((s) => s.id), [
		...broken.transitions,
		edge({ id: "enter", from: "rest", to: "ghost", trigger: "click" }),
	]);
	assert.ok((await run(checked(buttons({ machines: [fixed] })))).count >= 1);
});

test("a dead end is a violation with a name", async () => {
	const broken = machine(
		["rest", "hover"],
		[edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" })],
	);
	await blames(checked(buttons({ machines: [broken] })), "machine_no_dead_ends");
	assert.ok((await run(checked(buttons({ machines: [sound()] })))).count >= 1);
});

test("two edges on one trigger is a violation with a name", async () => {
	const broken = sound([
		edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" }),
		// Same source, same trigger, and the machine has no answer to which one
		// wins. `machineTable` picks the first in document order so that the studio
		// and the exported file at least agree; this is the check that says the
		// designer should not be relying on that.
		edge({ id: "over2", from: "rest", to: "hover", trigger: "pointerenter" }),
		edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
	]);
	await blames(checked(buttons({ machines: [broken] })), "machine_deterministic");
});

test("a transition naming a state the machine has not got is a violation with a name", async () => {
	// Not in the step's list of four, but it is the fifth switch a document holds
	// and a test that only ever adds five checks and breaks four of them would
	// never notice this one firing on a document it should not.
	const broken = machine(
		["rest", "hover"],
		[
			edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			edge({ id: "gone", from: "hover", to: "pressed", trigger: "click" }),
		],
	);
	await blames(checked(buttons({ machines: [broken] })), "machine_wired");
});

/* ------------------------------------------------------------------ */
/* The budget                                                          */
/* ------------------------------------------------------------------ */

const paced = (duration: Value): Machine =>
	sound([
		edge({
			id: "over",
			from: "rest",
			to: "hover",
			trigger: "pointerenter",
			duration,
		}),
		edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
	]);

test("a transition over the budget is a violation with a name", async () => {
	await blames(
		checked(buttons({ machines: [paced(single("600ms"))] })),
		"machine_within_budget",
	);
});

test("the budget is a limit a transition may reach, and the default pacing is under it", async () => {
	// Strictly greater, so 400ms passes a 400ms budget: a check that fired on the
	// number in its own label reads as a bug every time it is seen.
	assert.ok(
		(await run(checked(buttons({ machines: [paced(single("400ms"))] })))).count >= 1,
	);
	assert.ok(
		(await run(checked(buttons({ machines: [paced(single("0.4s"))] })))).count >= 1,
		"and the same duration written in seconds is the same duration",
	);
	// A transition that says nothing about its own duration is still measured:
	// `mdur/3` falls back to `mdefdur/1`, so the 200ms default is checked too.
	assert.ok((await run(checked(buttons({ machines: [sound()] })))).count >= 1);
	await blames(checked(buttons({ machines: [sound()] }), 100), "machine_within_budget");
});

test("a duration token is checked at both ends, and only the slow end is lost", async () => {
	// THIS IS THE ONE A LINT OVER THE DOCUMENT COULD NOT DO. The budget reads
	// `mdur/3` — what *this universe* resolved the duration to — so a motion scale
	// with a fast alternative and a slow one is two designs, and the check removes
	// the design that breaks it rather than the rule that named it.
	const tokens: Token[] = [
		{
			id: "motion",
			name: "motion",
			type: "duration",
			value: [lit("200ms"), lit("600ms")],
		},
	];
	const scale = buttons({ machines: [paced([ref("motion")])], tokens });
	assert.equal((await run(scale)).count, 2, "two designs, one fast and one slow");

	const out = await run(checked(scale));
	assert.equal(out.count, 1, "the slow half is gone and the fast half is a design");
});

/* ------------------------------------------------------------------ */
/* The ladder's six                                                    */
/* ------------------------------------------------------------------ */

/**
 * A machine with one guarded edge and an unguarded way round it.
 *
 * The way round is the whole point of the shape: it keeps `hover` reachable
 * whatever the guard says, so a document built with an impossible guard breaks
 * `machine_guards_possible` and nothing else, and `blames` can assert that the
 * only way out is that one rule. On a different trigger, because two edges
 * leaving one state on one trigger is what `machine_deterministic` is about and
 * this test is not about that.
 */
const guarded = (conditions?: Condition[]): Machine =>
	rig({
		inputs: [number("n")],
		states: [{ id: "rest" }, { id: "hover" }],
		transitions: [
			edge({
				id: "over",
				from: "rest",
				to: "hover",
				trigger: "pointerenter",
				...(conditions ? { conditions } : {}),
			}),
			edge({ id: "warm", from: "rest", to: "hover", trigger: "click" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
		],
	});

test("a guard that can never be met is a violation with a name", async () => {
	// Two windows on one input that do not overlap — `mclash(M,T,T)`, the same
	// arithmetic two transitions are compared with, asked of one. Nothing a host
	// can ever hand this machine opens the edge.
	await blames(
		checked(buttons({ machines: [guarded(contradiction)] })),
		"machine_guards_possible",
	);

	// The same machine unguarded, and the same machine with a guard somebody could
	// actually satisfy, are both documents.
	assert.ok((await run(checked(buttons({ machines: [guarded()] })))).count >= 1);
	assert.ok(
		(
			await run(
				checked(buttons({ machines: [guarded([{ input: "n", op: "gt", value: "0.5" }])] })),
			)
		).count >= 1,
	);
});

test("a guard outside its own input's declared range is the same violation", async () => {
	// The second of `mguardnever/2`'s three routes, and the one a designer hits by
	// changing a range rather than by writing a contradiction: the window is
	// perfectly sensible and the input cannot reach it. Worth its own test because
	// it is the route that reads `minlow`/`minhigh`, and absent-is-open means a
	// machine that declares no range must stay silent — which is the second half.
	const ranged = (spec: { min?: string; max?: string }): Machine =>
		rig({
			inputs: [number("n", spec)],
			states: [{ id: "rest" }, { id: "hover" }],
			transitions: [
				edge({
					id: "over",
					from: "rest",
					to: "hover",
					trigger: "pointerenter",
					conditions: [{ input: "n", op: "gt", value: "5" }],
				}),
				edge({ id: "warm", from: "rest", to: "hover", trigger: "click" }),
				edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			],
		});
	await blames(
		checked(buttons({ machines: [ranged({ min: "0", max: "1" })] })),
		"machine_guards_possible",
	);
	// A designer who has not said how far the drawer opens has not said that it
	// does not open, so a check that invented a `0`..`100` range would report a
	// violation against a claim nobody made.
	assert.ok((await run(checked(buttons({ machines: [ranged({})] })))).count >= 1);
});

test("the two reachability checks are one implication, and the stronger one fires alone", async () => {
	// `mgreach/2` walks a subset of `mreach/2`'s edges, so every state the shipped
	// check calls unreachable is called unreachable here too — which means this
	// check can never be the *only* thing a document breaks, and the honest test
	// is the implication rather than an isolating document that cannot exist.
	//
	// `hover` and `far` are reachable by an edge and unreachable through that
	// edge's guard. The shipped check is silent; this one is not.
	const broken = rig({
		inputs: [number("n")],
		states: [{ id: "rest" }, { id: "hover" }, { id: "far" }],
		transitions: [
			edge({
				id: "over",
				from: "rest",
				to: "hover",
				trigger: "pointerenter",
				conditions: contradiction,
			}),
			edge({ id: "on", from: "hover", to: "far", trigger: "click" }),
			edge({ id: "back", from: "far", to: "rest", trigger: "pointerleave" }),
		],
	});
	const scene = checked(buttons({ machines: [broken] }));
	await blames(scene, "machine_guards_possible", "machine_states_live");

	// And the proof that the shipped check really is the weaker one: take the two
	// ladder rules away and the document comes back, with `machine_reachable`
	// still switched on and still saying nothing.
	const shipped = [LADDER_CHECKS[0], LADDER_CHECKS[1]].reduce(
		removeMachineCheck,
		scene,
	);
	assert.ok(
		shipped.constraints.some((c) => c.id === "machine_reachable"),
		"the shipped reachability check is still held",
	);
	assert.ok(
		(await run(shipped)).count >= 1,
		"and it has nothing to say about a state only a broken guard reaches",
	);
});

/**
 * Two layers, each with two states so that neither is a dead end, and one part
 * both of them have an opinion about.
 *
 * `Over` is second in the list, so `Over` wins — the order *is* the priority,
 * the same way the first state is the initial one and `order/2` is the paint
 * order.
 */
const layered = (under: StatePart, over: StatePart): Machine =>
	rig({
		layers: [
			{ id: "under", name: "Under" },
			{ id: "over", name: "Over" },
		],
		states: [
			{ id: "u", layer: "under", parts: { label: under } },
			{ id: "u2", layer: "under" },
			{ id: "o", layer: "over", parts: { label: over } },
			{ id: "o2", layer: "over" },
		],
		transitions: [
			edge({ id: "ua", from: "u", to: "u2", trigger: "pointerenter" }),
			edge({ id: "ub", from: "u2", to: "u", trigger: "pointerleave" }),
			edge({ id: "oa", from: "o", to: "o2", trigger: "pointerdown" }),
			edge({ id: "ob", from: "o2", to: "o", trigger: "pointerup" }),
		],
	});

const paints = (ink: string): StatePart => ({ props: { ink: single(ink) } });
const moves = (x: number): StatePart => ({ frame: { x: dimension(px(x)) } });
const turns = (deg: number): StatePart => ({ turn: { rotateZ: [lit(`${deg}deg`)] } });

test("two layers writing one field is a violation with a name — all three families", async () => {
	// THE CHECK NO COMPETITOR HAS. Rive resolves this silently by layer order and
	// never mentions it; here the program resolves it *and* derives the conflict
	// against the machine, the two layers, the part and the field, so a canned
	// `custom` rule turns it into an ordinary violation with a switch, a name in
	// the core, a strength that can be softened, and `why` and `relax` for free.
	//
	// Three families and three assertions, because the rule is three disjuncts on
	// one line and a version where only the first one worked would pass any test
	// that only checked a fill.
	for (const [what, under, over] of [
		["a property", paints("#111111"), paints("#222222")],
		["a dimension", moves(1), moves(9)],
		["a rotation", turns(10), turns(40)],
	] as Array<[string, StatePart, StatePart]>) {
		const error = await blames(
			checked(buttons({ machines: [layered(under, over)] })),
			"machine_layers_agree",
		);
		assert.ok(error.relaxations[0].universe.visible.has("b1"), what);
	}

	// Two layers with opinions about *different* fields of one part is not a
	// fight, it is two layers doing their job — which is the whole reason rung
	// four exists and the case this check must stay quiet about.
	assert.ok(
		(await run(checked(buttons({ machines: [layered(paints("#111111"), moves(9))] }))))
			.count >= 1,
	);
	// And so is one layer with four states, however much they disagree with each
	// other: a fight is between layers, and states of one layer are alternatives
	// in time rather than two writers at once.
	const oneLayer = rig({
		states: [
			{ id: "u", parts: { label: paints("#111111") } },
			{ id: "o", parts: { label: paints("#222222") } },
		],
		transitions: [
			edge({ id: "ua", from: "u", to: "o", trigger: "pointerenter" }),
			edge({ id: "ub", from: "o", to: "u", trigger: "pointerleave" }),
		],
	});
	assert.ok((await run(checked(buttons({ machines: [oneLayer] })))).count >= 1);
});

const pulse = (loop: "none" | "loop"): Timeline => ({
	id: "pulse",
	name: "Pulse",
	loop,
	tracks: [{ part: "label", dim: "y", keys: [key("0ms", "14px"), key("200ms", "4px")] }],
});

test("a blend stop outside its input's range is a violation with a name", async () => {
	// A stop the input can never reach is an animation that is in the file and
	// never plays, which is the most expensive kind of dead code there is.
	const blended = (stops: string[]): Machine =>
		rig({
			inputs: [number("n", { min: "0", max: "1" })],
			timelines: [pulse("loop")],
			states: [
				{ id: "rest" },
				{
					id: "mix",
					blend: {
						kind: "oneD",
						input: "n",
						stops: stops.map((at) => ({ timeline: "pulse", at })),
					},
				},
			],
			transitions: [
				edge({ id: "go", from: "rest", to: "mix", trigger: "pointerenter" }),
				edge({ id: "back", from: "mix", to: "rest", trigger: "pointerleave" }),
			],
		});

	await blames(
		checked(buttons({ machines: [blended(["0", "2"])] })),
		"machine_blend_in_range",
	);
	// A stop *at* an end of the range is in range: a threshold a designer is
	// allowed to reach, the same reading the budget's strict `>` has.
	assert.ok((await run(checked(buttons({ machines: [blended(["0", "1"])] })))).count >= 1);
	// And an input with no declared range says nothing, in both directions.
	const open = blended(["-5", "5"]);
	open.inputs = [number("n")];
	assert.ok((await run(checked(buttons({ machines: [open] })))).count >= 1);
});

test("an exit time longer than its own transition is a violation with a name", async () => {
	// The brief's check, worded as the brief worded it: a transition that must
	// wait longer to become available than it takes to run. Nearly always a typo,
	// because the two numbers are in adjacent fields of one row.
	const debounced = (spec: { exit?: Value; duration?: Value }): Machine =>
		rig({
			states: [{ id: "rest" }, { id: "hover" }],
			transitions: [
				edge({
					id: "over",
					from: "rest",
					to: "hover",
					trigger: "pointerenter",
					...spec,
				}),
				edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			],
		});

	await blames(
		checked(buttons({ machines: [debounced({ exit: [lit("600ms")] })] })),
		"machine_exit_within_duration",
	);
	// Against the default pacing, not against a number somebody typed: `mdur/3`
	// falls back to `mdefdur/1`, so the transition above is measured at 200ms
	// without ever saying so. Equal is not longer, for the budget's reason.
	assert.ok(
		(await run(checked(buttons({ machines: [debounced({ exit: [lit("200ms")] })] }))))
			.count >= 1,
	);
	assert.ok(
		(
			await run(
				checked(
					buttons({
						machines: [debounced({ exit: [lit("600ms")], duration: [lit("600ms")] })],
					}),
					1000,
				),
			)
		).count >= 1,
		"and a transition that takes as long as it waits is fine",
	);
	// Every transition in every document written before exit times existed has no
	// exit time at all, reads as zero, and passes.
	assert.ok((await run(checked(buttons({ machines: [debounced({})] })))).count >= 1);
});

test("an exit time past its own state's timeline is a violation with a name", async () => {
	// The deeper bug the literal reading does not catch, shipped beside it rather
	// than substituted for it: the state finishes before the exit time elapses, so
	// the transition is *unreachable* rather than merely odd.
	const waiting = (loop: "none" | "loop"): Machine =>
		rig({
			timelines: [pulse(loop)],
			states: [{ id: "rest", timeline: "pulse" }, { id: "hover" }],
			transitions: [
				edge({
					id: "over",
					from: "rest",
					to: "hover",
					trigger: "pointerenter",
					// As long as it waits, so the check beside this one stays quiet and
					// the way out is one rule.
					exit: [lit("9s")],
					duration: [lit("9s")],
				}),
				edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			],
		});

	// The budget is raised past the 9s duration, because this test is about the
	// exit time and a second violation would make the way out two rules and say
	// nothing extra.
	await blames(
		checked(buttons({ machines: [waiting("none")] }), 10_000),
		"machine_exit_before_end",
	);
	// A looping timeline never ends, so no exit time is past it. Reporting one
	// would be reporting a bug against a design that works.
	assert.ok(
		(await run(checked(buttons({ machines: [waiting("loop")] }), 10_000))).count >= 1,
	);
});

test("an exit time is checked in every universe, and only the design that breaks it goes", async () => {
	// THE LADDER'S HALF OF THE CLAIM THE BUDGET MAKES ABOVE, and the reason these
	// six are checks in the program rather than a lint over `scene.machines`.
	// `mexit/3` reads `resolved(mval(M,T,exit),L)` and the program `#project`s it,
	// so a debounce scale with a brisk end and a slow one really is two designs —
	// and the check takes away the design that breaks it and leaves the one that
	// does not. A lint could not do that, because there is no single document to
	// lint: there are as many as the tokens multiply out to, and "600ms" is
	// perfectly fine in one of them.
	const debounce = (...ends: string[]): Token[] => [
		{ id: "debounce", name: "debounce", type: "duration", value: ends.map(lit) },
	];
	const waits = rig({
		states: [{ id: "rest" }, { id: "hover" }],
		transitions: [
			edge({
				id: "over",
				from: "rest",
				to: "hover",
				trigger: "pointerenter",
				exit: [ref("debounce")],
			}),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
		],
	});

	// The transition says nothing about how long it runs for, so `mdur/3` falls
	// back to the 200ms default: one end of the scale waits less than that and the
	// other waits twice it.
	const scale = buttons({ machines: [waits], tokens: debounce("100ms", "400ms") });
	assert.equal((await run(scale)).count, 2, "an exit time with two ends is two designs");

	const out = await run(checked(scale));
	assert.equal(out.count, 1, "and the end that outlasts its own transition is gone");
	// Named rather than assumed. Asserting the count alone would pass just as well
	// on a check that removed the wrong half, which is the failure worth catching:
	// a check that kept the broken design and threw away the good one would look
	// identical from a count and would be exactly backwards.
	assert.equal(
		out.universes[0].model.machines.m1.exit.over,
		100,
		"the design left standing is the one whose exit time fits inside its transition",
	);

	// Both ends over the duration is a document with nothing left in it, blamed on
	// the check by name — which is what says the rule reads each universe rather
	// than counting them.
	await blames(
		checked(buttons({ machines: [waits], tokens: debounce("400ms", "600ms") })),
		"machine_exit_within_duration",
	);
});

test("a timeline's length is this universe's too, so what is past its end is", async () => {
	// The same claim one derivation deeper, because `machine_exit_before_end` does
	// not read a token at all — it reads `mtlen/3`, which is a `#max` over keyframe
	// times, which are `Value`s that may themselves name a motion scale. So a
	// timeline that is short in one design and long in another is a state a
	// transition outlasts in one design and not the other, and the check has to be
	// able to tell those two apart. Nothing about the transition changes between
	// them; only the animation it is waiting for does.
	const tokens: Token[] = [
		{ id: "beat", name: "beat", type: "duration", value: [lit("200ms"), lit("800ms")] },
	];
	const scaled: Timeline = {
		id: "pulse",
		name: "Pulse",
		loop: "none",
		tracks: [
			{
				part: "label",
				dim: "y",
				keys: [key("0ms", "14px"), { at: [ref("beat")], value: [lit("4px")] }],
			},
		],
	};
	const waiting = rig({
		timelines: [scaled],
		states: [{ id: "rest", timeline: "pulse" }, { id: "hover" }],
		transitions: [
			edge({
				id: "over",
				from: "rest",
				to: "hover",
				trigger: "pointerenter",
				// Exactly as long as it waits, so the check beside this one has nothing
				// to say in either design and the way out stays one rule.
				exit: [lit("500ms")],
				duration: [lit("500ms")],
			}),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
		],
	});
	const scale = buttons({ machines: [waiting], tokens });
	assert.equal((await run(scale)).count, 2, "a keyframe time with two ends is two designs");

	// The budget is raised past the 500ms duration, for the same reason the test
	// above it raises it: a second violation would make the way out two rules and
	// say nothing extra about the one under test.
	const out = await run(checked(scale, 10_000));
	assert.equal(out.count, 1, "the design whose animation ends before the wait is gone");
	assert.equal(
		out.universes[0].model.machines.m1.timelines.pulse.length,
		800,
		"and the one left is the one that is still playing when the edge opens",
	);
});

test("the six new checks say nothing about the machines that shipped before them", async () => {
	// The no-regression claim for rung ten, and it is asserted rather than
	// believed: a machine with no inputs, no layers, no timelines and no exit
	// times must pass all eleven exactly as it passed all five, and a document
	// with no machine must cost nothing at all.
	for (const check of LADDER_CHECKS) {
		const alone = addMachineCheck(buttons({ machines: [sound()] }), check);
		assert.equal(hasMachineCheck(alone, check), true, check.id);
		const out = await run(alone);
		assert.ok(out.count >= 1, check.id);
		assert.equal(out.diagnostics, "", `${check.id}: ${out.diagnostics}`);
		assert.equal((await run(addMachineCheck(buttons(), check))).count, 1, check.id);
	}
});

/* ------------------------------------------------------------------ */
/* What the panel says a check has found                               */
/* ------------------------------------------------------------------ */

test("a fight is a sentence naming both layers, the part, the field and the winner", async () => {
	// The thing Rive cannot do, and the reason the resolve-first-report-second
	// order is a decision rather than an implementation detail. The program still
	// draws a picture — `mwriter/4` settled it by layer order — and the panel gets
	// to say who won and over what.
	const fighting = layered(paints("#111111"), paints("#222222"));
	assert.equal(
		machineCheckFinding("machine_layers_agree", fighting),
		"Over beats Under over label's ink",
	);

	// THE ASSERTION THAT MAKES THE SENTENCE WORTH SHOWING: the layer the panel
	// calls the winner is the layer whose value the canvas draws. The winner is
	// read from the layer *list* and never from the argument positions —
	// `mfight/5` states its pair in term order, because `L1 < L2` is there to
	// state a fight once rather than twice, and `over` happens to sort before
	// `under` — so a reader that took the winner from the first argument would
	// name the loser every time the ids sorted that way. This is exactly that
	// case, and one solve settles it.
	const painted = await run(buttons({ machines: [fighting] }));
	assert.ok(painted.count >= 1);
	assert.equal(
		painted.universes[0].model.byId["inst(b1,label)"].rendered.ink,
		"#222222",
		"the layer the sentence names as the winner is the one the picture draws",
	);

	// All three families in one sentence, because a designer told about the fill
	// and not the offset fixes half of it and comes back.
	const everywhere = machineCheckFinding(
		"machine_layers_agree",
		layered({ ...paints("#111111"), ...moves(1) }, { ...paints("#222222"), ...moves(9) }),
	);
	assert.ok(everywhere?.includes("label's ink"), everywhere ?? "");
	assert.ok(everywhere?.includes("label's x"), everywhere ?? "");

	// Nothing where there is nothing: two layers with different opinions about
	// different fields is two layers doing their job.
	assert.equal(
		machineCheckFinding("machine_layers_agree", layered(paints("#111111"), moves(9))),
		null,
	);
});

test("the other five sentences say what was found, and nothing when nothing was", () => {
	assert.equal(
		machineCheckFinding("machine_guards_possible", guarded(contradiction)),
		"over can never be taken",
	);
	assert.equal(machineCheckFinding("machine_guards_possible", guarded()), null);

	const stranded = rig({
		inputs: [number("n")],
		states: [{ id: "rest" }, { id: "hover", }],
		transitions: [
			edge({
				id: "over",
				from: "rest",
				to: "hover",
				trigger: "pointerenter",
				conditions: contradiction,
			}),
		],
	});
	assert.equal(
		machineCheckFinding("machine_states_live", stranded),
		"hover cannot be reached once the guards are read",
	);
	assert.equal(machineCheckFinding("machine_states_live", sound()), null);

	// Numbered from one, because `mstopat/4` and `mstopout/3` number a blend's
	// stops from one and a panel that echoed the array index would send a designer
	// to the wrong row of a list they can see.
	const blend: Blend = {
		kind: "oneD",
		input: "n",
		stops: [
			{ timeline: "pulse", at: "0" },
			{ timeline: "pulse", at: "2" },
		],
	};
	const outside = rig({
		inputs: [number("n", { min: "0", max: "1" })],
		timelines: [pulse("loop")],
		states: [{ id: "mix", blend }],
		transitions: [],
	});
	assert.equal(
		machineCheckFinding("machine_blend_in_range", outside),
		"stop 2 of mix is outside its input's range",
	);

	const late = rig({
		states: [{ id: "rest" }, { id: "hover" }],
		transitions: [
			edge({
				id: "over",
				from: "rest",
				to: "hover",
				trigger: "pointerenter",
				exit: [lit("600ms")],
			}),
		],
	});
	assert.equal(
		machineCheckFinding("machine_exit_within_duration", late),
		"over waits 600ms to run for 200ms",
	);
	assert.equal(machineCheckFinding("machine_exit_within_duration", sound()), null);

	const past = rig({
		timelines: [pulse("none")],
		states: [{ id: "rest", timeline: "pulse" }, { id: "hover" }],
		transitions: [
			edge({
				id: "over",
				from: "rest",
				to: "hover",
				trigger: "pointerenter",
				exit: [lit("9s")],
				duration: [lit("9s")],
			}),
		],
	});
	assert.equal(
		machineCheckFinding("machine_exit_before_end", past),
		"over waits 9000ms, but rest is over in 200ms",
	);
	// A looping timeline never ends, so no exit time is past it — the same body
	// literal `mloop(M,W,none)` the rule has, said once more in TypeScript.
	assert.equal(
		machineCheckFinding("machine_exit_before_end", {
			...past,
			timelines: [pulse("loop")],
		}),
		null,
	);
});

test("the sentence answers for the six the ladder added and for nothing else", () => {
	// A precise contract, because a caller spells it as a fallback after its own
	// cases. The four graph checks already have a sentence in the Machines panel
	// and a second spelling here would be a second spelling that drifts; the
	// budget is not answerable from a document at all, because what a transition
	// takes is `mdur/3` in an answer set.
	const broken = machine(
		["rest", "hover", "ghost"],
		[edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" })],
	);
	for (const check of [...MACHINE_CHECKS, durationBudgetCheck()]) {
		assert.equal(machineCheckFinding(check.id, broken), null, check.id);
	}
	assert.equal(machineCheckFinding("not_a_check_at_all", broken), null);
	// And every one of the six is answered by name rather than falling through the
	// switch — proved by a machine that breaks all six at once.
	//
	// The guarded edge runs *inside* a layer and does not point at that layer's
	// initial state, which is the one shape that makes `mgunreached/2` fire: every
	// layer's first state is reachable by definition — `mgreach(M,S) :-
	// mlinitial(M,_,S)` — so a broken guard pointing at one would be a broken
	// guard nothing downstream noticed.
	const wreck = rig({
		inputs: [number("n", { min: "0", max: "1" })],
		layers: [
			{ id: "under", name: "Under" },
			{ id: "over", name: "Over" },
		],
		timelines: [pulse("none")],
		states: [
			{ id: "u", layer: "under", parts: { label: paints("#111111") } },
			{ id: "u2", layer: "under" },
			{ id: "o", layer: "over", timeline: "pulse", parts: { label: paints("#222222") } },
			{
				id: "mix",
				layer: "over",
				blend: {
					kind: "oneD",
					input: "n",
					stops: [{ timeline: "pulse", at: "9" }],
				},
			},
		],
		transitions: [
			edge({
				id: "shut",
				from: "u",
				to: "u2",
				trigger: "pointerenter",
				conditions: contradiction,
			}),
			edge({
				id: "wait",
				from: "o",
				to: "mix",
				trigger: "click",
				exit: [lit("9s")],
			}),
		],
	});
	for (const check of LADDER_CHECKS) {
		assert.notEqual(machineCheckFinding(check.id, wreck), null, check.id);
	}
});

/* ------------------------------------------------------------------ */
/* Blame                                                               */
/* ------------------------------------------------------------------ */

test("the core names the check and not something anonymous", async () => {
	// Eleven checks on, one thing wrong, and an innocent rule of the designer's
	// own switched on beside them. A way out naming all twelve — or naming
	// nothing, which is what a bare `:- munreached(_,_).` typed into the Rules
	// panel would give — is the failure this whole design exists to avoid.
	//
	// A dead end rather than an unreachable state, so that exactly one check is
	// broken: this is the test about *blame*, and a document breaking two checks
	// would leave "the way out is small" unsaid.
	const broken = machine(
		["rest", "hover"],
		[edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" })],
	);
	const innocent: Constraint = {
		id: "label_is_dark",
		kind: "custom",
		prop: "fill",
		nodes: [],
		enabled: true,
	};
	const scene = checked(
		buttons({
			machines: [broken],
			constraints: [innocent],
			rules: 'viol(label_is_dark) :- rendered(inst(b1,label),ink,L), literal(L,"#000000").\n',
		}),
	);
	assert.equal(scene.constraints.length, 12);

	const error = await blames(scene, "machine_no_dead_ends");
	// The designer's own rule is in the core beside the check — cores in this
	// build are not minimal, which is exactly why `blames` reads the relaxation
	// and not the core. What matters here is that the way out is one rule, and it
	// is the check rather than the rule about the label's ink, and that the ten
	// checks that have nothing to say about a dead end stay out of it.
	assert.ok(error.conflict.includes("label_is_dark"));
	assert.equal(error.relaxations[0].free, false, "switching a rule off is an edit");
	// The status line carries counts and never names, on purpose — a rule's name
	// is the document's rather than the solver's, and the panel reads `conflict`
	// and `relaxations` to say it. So the one thing to assert about the message is
	// that it offers the way out rather than a shrug.
	assert.ok(error.message.endsWith("1 way out."), error.message);
	// And letting go of the check really does give a picture back: the way out
	// carries the answer set it was proved with, so the panel can show it.
	assert.ok(error.relaxations[0].universe.visible.has("b1"));
});

test("switching the check off gives the document back, and softening it prices it", async () => {
	const broken = machine(
		["rest", "hover", "ghost"],
		[
			edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			edge({ id: "escape", from: "ghost", to: "rest", trigger: "click" }),
		],
	);
	const scene = checked(buttons({ machines: [broken] }));
	// Both reachability checks, because an unreachable state breaks both and this
	// test is about what a switch does rather than about which switches are lit.
	const guilty = ["machine_reachable", "machine_states_live"] as const;

	// Off keeps the rule in the document and takes it out of the program.
	const off = guilty.reduce(
		(prev, id) => updateConstraint(prev, id, { enabled: false }),
		scene,
	);
	assert.equal(off.constraints.length, 11, "still there");
	assert.ok((await run(off)).count >= 1, "and no longer forbidding anything");

	// Softened, not one character of the rule changes: the same `viol/1` is
	// ranked instead of forbidden, and the design that pays for it is shown with
	// the price on it.
	const soft = guilty.reduce(
		(prev, id) => updateConstraint(prev, id, { strength: "prefer" }),
		scene,
	);
	assert.equal(soft.rules, scene.rules, "the rule text is untouched");
	const out = await run(soft);
	assert.ok(out.count >= 1, "a design with an unreachable state, at a cost");
	assert.equal(out.optimized, true);
	assert.ok(
		out.costs.some((c) => c > 0),
		"and the cost is not zero",
	);
});

/* ------------------------------------------------------------------ */
/* The edit                                                            */
/* ------------------------------------------------------------------ */

test("adding a check writes both halves, and adding it twice writes neither again", () => {
	const check = MACHINE_CHECKS[0];
	const once = addMachineCheck(buttons(), check);
	assert.equal(once.constraints.length, 1);
	assert.equal(once.constraints[0].kind, "custom");
	assert.equal(once.constraints[0].id, check.id);
	assert.equal(once.constraints[0].enabled, true);
	assert.ok(once.rules.includes(check.rule));
	assert.equal(hasMachineCheck(once, check), true);

	const twice = addMachineCheck(once, check);
	assert.equal(twice.constraints.length, 1);
	assert.equal(
		twice.rules.split("\n").filter((l) => l.trim() === check.rule).length,
		1,
		"one rule, not two",
	);
});

test("half a check is not a check", () => {
	const check = MACHINE_CHECKS[1];
	const whole = addMachineCheck(buttons(), check);

	// A rule with no constraint is never guarded, so it never fires; a constraint
	// with no rule is a switch that cannot ever fire. Both look on in a panel, and
	// neither verifies anything, so the honest answer to either is no.
	assert.equal(hasMachineCheck({ ...whole, rules: "" }, check), false);
	assert.equal(hasMachineCheck({ ...whole, constraints: [] }, check), false);
	assert.equal(hasMachineCheck(buttons(), check), false);
});

test("changing the budget rewrites the line rather than adding a second", () => {
	const scene = addMachineCheck(buttons(), durationBudgetCheck(400));
	const raised = addMachineCheck(scene, durationBudgetCheck(250));
	assert.equal(raised.constraints.length, 1, "the same constraint, still switched on");
	const heads = raised.rules
		.split("\n")
		.filter((line) => line.trim().startsWith("viol(machine_within_budget)"));
	assert.deepEqual(heads.map((l) => l.trim()), [durationBudgetCheck(250).rule]);
});

test("a hand-edited body is replaced when the check is added again, and only then", () => {
	const check = MACHINE_CHECKS[0];
	const mine = "viol(machine_reachable) :- munreached(m1,_).";
	const edited = { ...addMachineCheck(buttons(), check), rules: `${mine}\n` };
	// Nothing calls this on a redraw, so the only way here is a deliberate click,
	// and re-adding a canned check is a request for the canned check.
	assert.ok(addMachineCheck(edited, check).rules.includes(check.rule));
	assert.ok(!addMachineCheck(edited, check).rules.includes(mine));
	// Reading it does not rewrite it.
	assert.equal(hasMachineCheck(edited, check), true);
	assert.equal(edited.rules, `${mine}\n`);
});

test("removing a check takes both halves away", () => {
	const check = MACHINE_CHECKS[2];
	const scene = addMachineCheck(
		{ ...buttons(), rules: "% my own rules\nviol(mine) :- node(nothing).\n" },
		check,
	);
	const gone = removeMachineCheck(scene, check);
	assert.equal(gone.constraints.length, 0);
	assert.ok(!gone.rules.includes(check.id), "no orphaned viol/1 left behind");
	assert.ok(gone.rules.includes("viol(mine)"), "and nothing else was touched");
	assert.equal(hasMachineCheck(gone, check), false);

	// Removing what was never there is not an error, and neither is removing one
	// half of a half-held check.
	assert.deepEqual(removeMachineCheck(buttons(), check), buttons());
});

test("the checks ground without a word to say about themselves", async () => {
	// The diagnostics panel is a real channel, and eleven hand-written rules
	// reading fourteen derived predicates are fourteen chances to be told a body
	// atom no rule heads. They are headed — `MACHINE_RULES` states every one of
	// them, and `#defined` covers the ladder's — but on a document with no machine
	// in it they ground to nothing, which is a different thing clingo also has
	// opinions about. So it is checked rather than assumed, in three directions.
	assert.equal((await run(checked(buttons({ machines: [sound()] })))).diagnostics, "");
	assert.equal((await run(checked(buttons()))).diagnostics, "");

	// And on a document that actually has every rung on it, which is the case that
	// grounds the *most* of the ladder rather than the least: inputs, a guard, two
	// layers, a timeline, a blend, an exit time. All eleven checks on, all eleven
	// silent, and the document still has a design.
	const rigged = rig({
		inputs: [number("n", { min: "0", max: "1" })],
		layers: [
			{ id: "under", name: "Under" },
			{ id: "over", name: "Over" },
		],
		timelines: [pulse("loop")],
		states: [
			{ id: "u", layer: "under", parts: { label: paints("#111111") } },
			{ id: "u2", layer: "under", timeline: "pulse" },
			{ id: "o", layer: "over", parts: { label: moves(9) } },
			{
				id: "mix",
				layer: "over",
				blend: {
					kind: "oneD",
					input: "n",
					stops: [
						{ timeline: "pulse", at: "0" },
						{ timeline: "pulse", at: "1" },
					],
				},
			},
		],
		transitions: [
			edge({
				id: "ua",
				from: "u",
				to: "u2",
				trigger: "pointerenter",
				conditions: [{ input: "n", op: "gt", value: "0.5" }],
				exit: [lit("100ms")],
			}),
			edge({ id: "ub", from: "u2", to: "u", trigger: "pointerleave" }),
			edge({ id: "oa", from: "o", to: "mix", trigger: "pointerdown" }),
			edge({ id: "ob", from: "mix", to: "o", trigger: "pointerup" }),
		],
	});
	const out = await run(checked(buttons({ machines: [rigged] })));
	assert.equal(out.diagnostics, "", out.diagnostics);
	assert.ok(out.count >= 1, "a document with every rung on it is still a document");
	for (const check of machineChecks()) {
		assert.equal(machineCheckFinding(check.id, rigged), null, check.id);
	}
});

test("every shipped template is the same document with all eleven checks on", async () => {
	// THE NO-REGRESSION CLAIM, proved rather than argued. A check is a `custom`
	// constraint and a constraint can only ever *remove* designs, so the way this
	// feature could break a document that has never heard of state machines is by
	// a body grounding to something on a document with no machine in it — which is
	// exactly what an anonymous `mdur(_,_,Ms)` would do if `mdur/3` ever acquired
	// a clause that did not need `mtrans/2`.
	//
	// Counted rather than reasoned about, on every template, before and after. The
	// limit is generous enough to reach every template's whole space and cheap
	// enough to run in a test: `count` is the total the enumeration found, not the
	// number shown, so a template that overruns would report the same number twice
	// and the assertion would still be the assertion.
	for (const template of TEMPLATES) {
		const scene = template.create();
		const before = await explore(scene, directSolver, { limit: 64 });
		const after = await explore(checked(scene), directSolver, { limit: 64 });
		assert.equal(after.count, before.count, `${template.id} lost designs`);
		assert.equal(after.diagnostics, "", `${template.id}: ${after.diagnostics}`);
	}
});

test("the appended rules reach the program the compiler generates", () => {
	// The one assertion that the two halves of this file meet: what
	// `addMachineCheck` writes into `scene.rules` is what `compile` appends after
	// the generated program, under a `constraint/1` that gives it a switch.
	const scene = checked(buttons({ machines: [sound()] }));
	const { program, guards } = compile(scene);
	for (const check of machineChecks()) {
		assert.ok(program.includes(check.rule), check.id);
		assert.ok(program.includes(`constraint(${check.id})`), `${check.id} is switched`);
		assert.ok(guards.includes(`active(${check.id})`), `${check.id} is assumed`);
	}
});
