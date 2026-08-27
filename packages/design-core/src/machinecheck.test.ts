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
 * Two tests carry more weight than the rest. `the core names the check` runs a
 * document with all five checks on and exactly one thing wrong with it, and
 * asserts the core names that one — because a core that named all five, or none,
 * would leave the feature no better than the yellow triangle it exists to
 * replace. And `a duration token is checked at both ends` is the one that could
 * not be a lint over the document at all: the budget is measured against
 * `mdur/3`, which is what *this universe* resolved the duration to, so a motion
 * scale with a fast alternative and a slow one loses the slow half and keeps the
 * fast one.
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
	machineChecks,
	removeMachineCheck,
} from "./machinecheck.ts";
import { MACHINE_CHECKS, writeDuration } from "./machines.ts";
import type {
	Constraint,
	Machine,
	MachineState,
	Scene,
	SceneNode,
	Transition,
	Trigger,
} from "./scene.ts";
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
async function blames(scene: Scene, id: string): Promise<UnsatisfiableError> {
	const error = await fails(scene);
	const named = new Set(scene.constraints.map((c) => c.id));
	assert.ok(error.conflict.length > 0, "the core blames something rather than nothing");
	assert.ok(
		error.conflict.every((blamed) => named.has(blamed)),
		`the core names rules the document holds, not anonymous ones: ${error.conflict}`,
	);
	assert.ok(error.conflict.includes(id), `${id} is in the core`);
	assert.deepEqual(
		error.relaxations.map((way) => way.rules),
		[[id]],
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
			"machine_reachable",
			"machine_no_dead_ends",
			"machine_deterministic",
			"machine_wired",
			"machine_within_budget",
		],
	);
	// The four graph checks are `machines.ts`' own, unchanged: there is one text
	// for each rule and this file is not a second copy of it.
	assert.deepEqual(checks.slice(0, 4), MACHINE_CHECKS);

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
	assert.equal(scene.constraints.length, 5);
	const out = await run(scene);
	assert.ok(out.count >= 1, "the document still has designs");
});

test("the checks say nothing about a document with no machine in it", async () => {
	// Every body quantifies over predicates that ground to nothing here, so five
	// switched-on rules cost the document exactly nothing. Which is what lets a
	// panel leave them on by default.
	const scene = checked(buttons());
	assert.equal(await run(scene).then((o) => o.count), 1);
});

test("an unreachable state is a violation with a name", async () => {
	const broken = machine(
		["rest", "hover", "ghost"],
		[
			edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			// `ghost` leaves somewhere, so it is unreachable without also being a dead
			// end: exactly one of the five checks has anything to say about it.
			edge({ id: "escape", from: "ghost", to: "rest", trigger: "click" }),
		],
	);
	await blames(checked(buttons({ machines: [broken] })), "machine_reachable");

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
/* Blame                                                               */
/* ------------------------------------------------------------------ */

test("the core names the check and not something anonymous", async () => {
	// Five checks on, one thing wrong, and an innocent rule of the designer's own
	// switched on beside them. A core naming all six — or naming nothing, which is
	// what a bare `:- munreached(_,_).` typed into the Rules panel would give — is
	// the failure this whole design exists to avoid.
	const broken = machine(
		["rest", "hover", "ghost"],
		[
			edge({ id: "over", from: "rest", to: "hover", trigger: "pointerenter" }),
			edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
			edge({ id: "escape", from: "ghost", to: "rest", trigger: "click" }),
		],
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

	const error = await blames(scene, "machine_reachable");
	// The designer's own rule is in the core beside the check — cores in this
	// build are not minimal, which is exactly why `blames` reads the relaxation
	// and not the core. What matters here is that the way out is one rule, and it
	// is the check rather than the rule about the label's ink.
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

	// Off keeps the rule in the document and takes it out of the program.
	const off = updateConstraint(scene, "machine_reachable", { enabled: false });
	assert.equal(off.constraints.length, 5, "still there");
	assert.ok((await run(off)).count >= 1, "and no longer forbidding anything");

	// Softened, not one character of the rule changes: the same `viol/1` is
	// ranked instead of forbidden, and the design that pays for it is shown with
	// the price on it.
	const soft = updateConstraint(scene, "machine_reachable", { strength: "prefer" });
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
	// The diagnostics panel is a real channel, and five hand-written rules reading
	// five derived predicates are five chances to be told a body atom no rule
	// heads. They are headed — `MACHINE_RULES` states every one of them
	// unconditionally — but on a document with no machine in it they ground to
	// nothing, which is a different thing that clingo also has opinions about. So
	// it is checked rather than assumed, in both directions.
	assert.equal((await run(checked(buttons({ machines: [sound()] })))).diagnostics, "");
	assert.equal((await run(checked(buttons()))).diagnostics, "");
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
