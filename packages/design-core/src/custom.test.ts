/**
 * The `custom` constraint kind — a rule the user wrote, with a switch and a
 * name.
 *
 * Everything here goes through the real solver, because the whole claim is
 * about the solver: that a hand-written `viol/1` is guarded by the same
 * assumption the built-in kinds are, and so comes back in a core naming the
 * rule rather than as a document that is inexplicably impossible.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile, variableCounts } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import {
	addConstraint,
	addCustomConstraint,
	addNode,
	constraintTermError,
	deleteNodes,
	makeNode,
	pruneConstraints,
	renameConstraint,
	retargetConstraint,
	setProp,
	updateConstraint,
	violRefs,
} from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import {
	CONSTRAINT_KINDS,
	CONSTRAINT_NAMES,
	RULES_HEADER,
	type Scene,
	constrainsProp,
	emptyScene,
	rangesOverGroup,
	takesMembers,
} from "./scene.ts";
import { lit } from "./values.ts";

const RED = "#ff0000";

/** Three rectangles, each free to take any of three fills. */
function threeBoxes(): Scene {
	let scene = emptyScene();
	const palette = [lit(RED), lit("#00ff00"), lit("#0000ff")];
	for (const id of ["a", "b", "c"]) {
		scene = addNode(
			scene,
			makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id }),
		);
		scene = setProp(scene, [id], "fill", palette);
	}
	return scene;
}

const withRules = (scene: Scene, rules: string): Scene => ({
	...scene,
	rules: `${RULES_HEADER}${rules}\n`,
});

const universes = async (scene: Scene, limit = 200) =>
	(await explore(scene, directSolver, { limit, sample: "first" })).count;

const fails = async (scene: Scene): Promise<UnsatisfiableError> => {
	const error = await explore(scene, directSolver).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError, "expected no design at all");
	return error;
};

/* ------------------------------------------------------------------ */
/* The switch                                                          */
/* ------------------------------------------------------------------ */

test("a custom rule narrows the space, and its switch turns it off again", async () => {
	const added = addCustomConstraint(threeBoxes(), "no_red_a");
	assert.equal(added.id, "no_red_a");
	const scene = withRules(
		added.scene,
		`viol(no_red_a) :- rendered(a,fill,L), literal(L,"${RED}").`,
	);
	// 27 designs; forbidding one of a's three fills leaves 18.
	assert.equal(await universes(scene), 18);

	const off = updateConstraint(scene, "no_red_a", { enabled: false });
	assert.equal(off.constraints.length, 1, "still in the document");
	assert.equal(await universes(off), 27, "and out of the program");
});

test("a violated custom rule is unsatisfiable, and disabling it is not", async () => {
	const added = addCustomConstraint(threeBoxes(), "impossible");
	const scene = withRules(added.scene, "viol(impossible).");
	const error = await fails(scene);
	assert.deepEqual(error.conflict, ["impossible"], "blamed by name");

	// The rule is still there and still grounds; only the assumption changed.
	const off = updateConstraint(scene, "impossible", { enabled: false });
	assert.equal(await universes(off), 27);
});

test("a viol whose term is no constraint does nothing at all", async () => {
	// This is what a rename leaves behind, and it is why `renameConstraint`
	// rewrites the rules: nothing guards the head, so the switch is gone.
	const added = addCustomConstraint(threeBoxes(), "here");
	const scene = withRules(added.scene, "viol(gone).");
	assert.equal(await universes(scene), 27);
});

/* ------------------------------------------------------------------ */
/* Blame                                                               */
/* ------------------------------------------------------------------ */

test("a core names the custom rule and not an innocent one", async () => {
	let scene = threeBoxes();
	// b is red and nothing else, so `differ` over a and b forbids a being red.
	scene = setProp(scene, ["b"], "fill", [lit(RED)]);
	const guilty = addCustomConstraint(scene, "a_must_be_red");
	scene = guilty.scene;
	const differ = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = differ.scene;
	// c is free, so this one can always hold.
	const innocent = addConstraint(scene, "differ", ["b", "c"], "fill");
	scene = withRules(
		innocent.scene,
		`viol(a_must_be_red) :- rendered(a,fill,L), not literal(L,"${RED}").`,
	);

	const error = await fails(scene);
	assert.ok(
		error.conflict.includes("a_must_be_red"),
		"the hand-written rule is named",
	);
	assert.ok(error.conflict.includes(differ.id), "so is the built-in it fights");
	assert.ok(
		!error.conflict.includes(innocent.id),
		"and the rule that can hold is not blamed",
	);
});

test("two custom rules that contradict each other name each other", async () => {
	let scene = threeBoxes();
	scene = addCustomConstraint(scene, "a_red").scene;
	scene = addCustomConstraint(scene, "a_green").scene;
	// An innocent third, over a node neither of them mentions.
	const innocent = addConstraint(scene, "differ", ["b", "c"], "fill");
	scene = withRules(
		innocent.scene,
		[
			`viol(a_red) :- rendered(a,fill,L), not literal(L,"${RED}").`,
			'viol(a_green) :- rendered(a,fill,L), not literal(L,"#00ff00").',
		].join("\n"),
	);

	const error = await fails(scene);
	assert.deepEqual([...error.conflict].sort(), ["a_green", "a_red"]);
	assert.ok(!error.conflict.includes(innocent.id));
});

/* ------------------------------------------------------------------ */
/* Coexisting with the other kinds                                     */
/* ------------------------------------------------------------------ */

test("a custom rule composes with differ rather than replacing it", async () => {
	// differ over all three leaves the 6 permutations; forbidding red on a
	// leaves the 4 of those where a is green or blue.
	let scene = addConstraint(threeBoxes(), "differ", ["a", "b", "c"], "fill").scene;
	scene = addCustomConstraint(scene, "no_red_a").scene;
	scene = withRules(
		scene,
		`viol(no_red_a) :- rendered(a,fill,L), literal(L,"${RED}").`,
	);
	assert.equal(await universes(scene), 4);
});

test("a custom rule coexists with a geometric kind, which still places nodes", async () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("rect", { x: 10, y: 0, width: 40, height: 40 }, { id: "a" }),
	);
	scene = setProp(scene, ["a"], "fill", [lit(RED), lit("#00ff00")]);
	const pin = addConstraint(scene, "pin", ["a"], undefined, "left");
	scene = updateConstraint(pin.scene, pin.id, { value: [lit("100px")] });
	scene = addCustomConstraint(scene, "not_red").scene;
	scene = withRules(
		scene,
		`viol(not_red) :- rendered(a,fill,L), literal(L,"${RED}").`,
	);

	// The colour rule cuts the space in half; the pin still moves the box.
	const result = await explore(scene, directSolver, { sample: "first" });
	assert.equal(result.count, 1, "one fill survives");
	assert.equal(result.universes[0].solved.a?.x, 100, "and the pin still holds");

	// Break the geometry instead, and the two kinds are blamed independently:
	// the theory propagator reports through the same assumptions the property
	// rules do, and the colour rule — which can still hold — is left out.
	const second = addConstraint(scene, "pin", ["a"], undefined, "left");
	const broken = updateConstraint(second.scene, second.id, {
		value: [lit("300px")],
	});
	const error = await fails(broken);
	assert.deepEqual([...error.conflict].sort(), [pin.id, second.id].sort());
	assert.ok(
		!error.conflict.includes("not_red"),
		"a rule that can still hold is not blamed for the geometry",
	);
});

/* ------------------------------------------------------------------ */
/* What the compiler emits, and does not                               */
/* ------------------------------------------------------------------ */

test("a custom constraint compiles to two facts and a switch", () => {
	const { scene } = addCustomConstraint(threeBoxes(), "mine");
	const { program, guards } = compile(scene);
	assert.deepEqual(guards, ["active(mine)"]);
	assert.ok(program.includes("constraint(mine)."));
	assert.ok(program.includes("c_kind(mine,custom)."));
	// No members, so nothing that reads members: no property to compare, no
	// edge, no slots, no dimension.
	assert.ok(!program.includes("c_prop(mine,"), "no property");
	assert.ok(!program.includes("c_edge(mine,"), "no edge");
	assert.ok(!program.includes("c_node(mine,"), "no members");
	assert.ok(!program.includes("cval(mine)"), "no dimension variable");
	// And nothing for the multiverse to branch on: a rule with no dimension is
	// not a variable, so it must not show up in "what varies".
	assert.equal(variableCounts(scene)["cval(mine)"], undefined);
});

test("a custom constraint survives deleting every node", () => {
	// It ranges over nothing the document holds, so no deletion can turn it into
	// a rule over a ghost — which is the only reason pruning exists.
	const { scene } = addCustomConstraint(threeBoxes(), "mine");
	const after = deleteNodes(scene, ["a", "b", "c"]);
	assert.deepEqual(
		after.constraints.map((c) => c.id),
		["mine"],
	);
	assert.equal(pruneConstraints(scene), scene, "and nothing changed");
});

test("switching a kind to custom drops the members it can no longer read", () => {
	const differ = addConstraint(threeBoxes(), "differ", ["a", "b"], "fill");
	const custom = retargetConstraint(differ.scene, differ.id, { kind: "custom" });
	assert.deepEqual(custom.constraints[0].nodes, []);
	// And back again: a narrowing retarget has always forgotten what would not
	// fit, so there is nothing to restore — the rule needs new members.
	const back = retargetConstraint(custom, differ.id, { kind: "differ" });
	assert.deepEqual(back.constraints[0].nodes, []);
	// Still a legal document either way.
	assert.equal(compile(custom).guards.length, 1);
});

test("a custom constraint takes no group, because it has no members to be a set", () => {
	const { scene } = addCustomConstraint(threeBoxes(), "mine");
	const grouped = retargetConstraint(scene, "mine", { group: "row1" });
	assert.equal(grouped.constraints[0].group, undefined);
});

test("a rule cannot mint a constraint, because the switch is an assumption", async () => {
	// The limit of the kind, and the reason the sudoku's 27 rules are 27 rows of
	// the document rather than one rule that derives them. `constraint/1` is
	// derivable — the geometry rules say `#defined constraint/1.` — but what makes
	// a constraint enforceable is that `active(C)` was *assumed* before the solve,
	// and the assumptions are the document's list of constraints. Both ways a rule
	// can try it are dead ends, and this is which:
	const seed = addCustomConstraint(threeBoxes(), "seed").scene;
	const minted = withRules(
		seed,
		[
			"constraint(mine). c_kind(mine,custom).",
			`viol(mine) :- rendered(a,fill,L), literal(L,"${RED}").`,
		].join("\n"),
	);
	// Nothing assumed it, so the solver simply switches it off.
	assert.deepEqual(compile(minted).guards, ["active(seed)"]);
	assert.equal(await universes(minted), 27, "the rule does nothing at all");

	// Assert the switch as well and it fires — but it is a bare `:- ...` again:
	// unswitchable, and invisible to blame, because a core is a subset of what
	// was assumed and nothing assumed this.
	const asserted = withRules(minted, `${minted.rules.trim()}\nactive(mine).`);
	assert.equal(await universes(asserted), 18, "now it holds the space down");
	const impossible = withRules(
		seed,
		"constraint(mine). c_kind(mine,custom). active(mine). viol(mine).",
	);
	assert.deepEqual((await fails(impossible)).conflict, [], "and nothing is named");
});

/* ------------------------------------------------------------------ */
/* The name is the contract                                           */
/* ------------------------------------------------------------------ */

test("a name must be spellable as an ASP constant", () => {
	const scene = threeBoxes();
	for (const bad of ["No_Wide_Gaps", "_x", "no wide gaps", "no-wide-gaps", "1st", "", "not"]) {
		assert.ok(
			constraintTermError(scene, bad) !== undefined,
			`${bad} must be refused`,
		);
		assert.equal(addCustomConstraint(scene, bad).id, null);
		assert.equal(addCustomConstraint(scene, bad).scene, scene, "untouched");
	}
	for (const good of ["a", "no_wide_gaps", "rule2", "camelCase", "gap", "width"]) {
		assert.equal(constraintTermError(scene, good), undefined, good);
	}
});

test("two rules cannot claim the same term", () => {
	const first = addCustomConstraint(threeBoxes(), "mine");
	assert.equal(first.id, "mine");
	const second = addCustomConstraint(first.scene, "mine");
	assert.equal(second.id, null);
	assert.equal(second.scene, first.scene);
	assert.match(constraintTermError(first.scene, "mine") ?? "", /already called/);
	// A built-in constraint's generated id is in the same namespace.
	const differ = addConstraint(first.scene, "differ", ["a", "b"], "fill");
	assert.notEqual(
		constraintTermError(differ.scene, differ.id),
		undefined,
		"a generated id is claimed too",
	);
});

test("an unnamed custom rule gets a readable term, and the next one a fresh one", () => {
	const first = addCustomConstraint(threeBoxes());
	assert.equal(first.id, "rule");
	const second = addCustomConstraint(first.scene);
	assert.equal(second.id, "rule_2");
	assert.deepEqual(
		second.scene.constraints.map((c) => c.id),
		["rule", "rule_2"],
	);
});

test("renaming carries the user's viol rule with it, and says how many it moved", async () => {
	const added = addCustomConstraint(threeBoxes(), "no_red_a");
	const scene = withRules(
		added.scene,
		[
			`viol(no_red_a) :- rendered(a,fill,L), literal(L,"${RED}").`,
			"% and again, with the whitespace a person types",
			"viol( no_red_a ) :- 1 = 2.",
		].join("\n"),
	);
	assert.equal(await universes(scene), 18);

	const renamed = renameConstraint(scene, "no_red_a", "keep_a_cool");
	assert.equal(renamed.rewritten, 2, "both references moved");
	assert.equal(renamed.scene.constraints[0].id, "keep_a_cool");
	assert.ok(!renamed.scene.rules.includes("no_red_a"));
	// The point of rewriting: the rule still fires, so the space is still 18.
	assert.equal(await universes(renamed.scene), 18);
	assert.deepEqual(compile(renamed.scene).guards, ["active(keep_a_cool)"]);
});

test("a rename with nothing to rewrite reports zero, which is the warning", async () => {
	// Reached indirectly, so the rename cannot follow it — and afterwards the
	// switch does nothing. `rewritten` is how a caller knows to say so.
	const added = addCustomConstraint(threeBoxes(), "no_red_a");
	const scene = withRules(added.scene, [
		"mine(no_red_a).",
		`viol(C) :- mine(C), rendered(a,fill,L), literal(L,"${RED}").`,
	].join("\n"));
	assert.equal(await universes(scene), 18);

	const renamed = renameConstraint(scene, "no_red_a", "keep_a_cool");
	assert.equal(renamed.rewritten, 0);
	assert.equal(
		await universes(renamed.scene),
		27,
		"the rule is orphaned — which is exactly what the count is for",
	);
});

test("a rename to an illegal or taken term changes nothing", () => {
	let scene = addCustomConstraint(threeBoxes(), "mine").scene;
	scene = addCustomConstraint(scene, "yours").scene;
	scene = withRules(scene, "viol(mine).");
	for (const bad of ["Mine", "not", "yours", "mine other"]) {
		const attempt = renameConstraint(scene, "mine", bad);
		assert.equal(attempt.scene, scene, bad);
		assert.equal(attempt.rewritten, 0);
	}
	// Renaming to its own name is a no-op rather than a rewrite.
	assert.equal(renameConstraint(scene, "mine", "mine").rewritten, 0);
	// And an id no constraint holds is not a rename at all.
	assert.equal(renameConstraint(scene, "nobody", "somebody").scene, scene);
});

/* ------------------------------------------------------------------ */
/* What the panel can ask about it                                     */
/* ------------------------------------------------------------------ */

test("a kind with nowhere to put a member is the kind with no subject", () => {
	// Read off the table, so a new kind answers this by describing itself. The
	// editor uses it for three decisions — offer the kind whatever is selected,
	// put a name field where the subject would go, and show the line to write
	// instead of a member list — and all three want the same one question.
	assert.deepEqual(
		CONSTRAINT_NAMES.filter((k) => !takesMembers(k)),
		["custom"],
	);
	for (const kind of CONSTRAINT_NAMES) {
		const spec = CONSTRAINT_KINDS[kind];
		if (takesMembers(kind)) continue;
		// Nothing a member would have supplied: no property, no edge, no value —
		// so nothing for the row's middle to show but the name.
		assert.equal(constrainsProp(kind), false, kind);
		assert.deepEqual(spec.edges, [], kind);
		assert.equal(spec.valueType, undefined, kind);
		assert.equal(rangesOverGroup(kind), false, kind);
	}
});

test("a rule may read its own switch, and the rename carries that too", async () => {
	// Reading `active(C)` in a body is how a requirement stays unground while it
	// is off — the map template's whole trick. Left behind by a rename it is worse
	// than an orphaned `viol`: the rule under it never grounds, so the requirement
	// is vacuously satisfied rather than broken, and nothing says so.
	const added = addCustomConstraint(threeBoxes(), "no_red_a");
	const scene = withRules(added.scene, [
		"guilty(a) :- active(no_red_a).",
		`viol(no_red_a) :- guilty(N), rendered(N,fill,L), literal(L,"${RED}").`,
	].join("\n"));
	assert.equal(await universes(scene), 18);
	// The panel's signal is about the condition, not the switch: one viol/1.
	assert.equal(violRefs(scene.rules, "no_red_a"), 1);

	const renamed = renameConstraint(scene, "no_red_a", "keep_a_cool");
	assert.equal(renamed.rewritten, 2, "the condition and the guard");
	assert.doesNotMatch(renamed.scene.rules, /no_red_a/);
	assert.equal(await universes(renamed.scene), 18, "and it still fires");

	// The same rules with the guard left behind is the silent failure, spelled
	// out: not unsatisfiable, not blamed — just 27 designs again.
	const orphaned = withRules(added.scene, [
		"guilty(a) :- active(somebody_else).",
		`viol(no_red_a) :- guilty(N), rendered(N,fill,L), literal(L,"${RED}").`,
	].join("\n"));
	assert.equal(await universes(orphaned), 27);
});

test("a word ending in the switch's name is not the switch", () => {
	// `inactive(mine)` must not read as a mention of `mine`'s switch, or a rename
	// would corrupt a predicate the user invented.
	const added = addCustomConstraint(threeBoxes(), "mine");
	const scene = withRules(added.scene, [
		"inactive(mine).",
		"myviol(mine).",
		"viol(mine) :- 1 = 2.",
	].join("\n"));
	const renamed = renameConstraint(scene, "mine", "yours");
	assert.equal(renamed.rewritten, 1, "only the real viol/1");
	assert.ok(renamed.scene.rules.includes("inactive(mine)."));
	assert.ok(renamed.scene.rules.includes("myviol(mine)."));
	assert.ok(renamed.scene.rules.includes("viol(yours) :- 1 = 2."));
});

test("violRefs counts exactly what a rename can carry", () => {
	const added = addCustomConstraint(threeBoxes(), "no_red_a");
	const scene = withRules(added.scene, [
		`viol(no_red_a) :- rendered(a,fill,L), literal(L,"${RED}").`,
		"viol( no_red_a ) :- 1 = 2.",
	].join("\n"));
	// The rename moves a superset of what the panel calls written — it carries
	// `active(id)` as well — and that is the safe direction: the panel can never
	// call a rule written that the rename would then orphan.
	assert.equal(violRefs(scene.rules, "no_red_a"), 2);
	assert.equal(renameConstraint(scene, "no_red_a", "cool").rewritten, 2);
	assert.equal(violRefs(scene.rules, "cool"), 0, "before the rename");
	assert.equal(
		violRefs(renameConstraint(scene, "no_red_a", "cool").scene.rules, "cool"),
		2,
		"and after it",
	);
});

test("zero references means nothing names it, not that it is broken", async () => {
	// Which is why the panel says so quietly rather than in red: this rule fires,
	// and the count is 0 because the reference is indirect.
	const added = addCustomConstraint(threeBoxes(), "no_red_a");
	const scene = withRules(added.scene, [
		"mine(no_red_a).",
		`viol(C) :- mine(C), rendered(a,fill,L), literal(L,"${RED}").`,
	].join("\n"));
	assert.equal(violRefs(scene.rules, "no_red_a"), 0);
	assert.equal(await universes(scene), 18, "and yet it holds the space down");

	// A near miss counts as nothing, which is the case the signal is for.
	const typo = withRules(added.scene, "viol(no_red_b) :- 1 = 1.");
	assert.equal(violRefs(typo.rules, "no_red_a"), 0);
	assert.equal(await universes(typo), 27, "nothing guards the typo's head");
});

test("a fresh unnamed rule reads as unwritten, and naming it does not change that", () => {
	// The two halves of the row: the term to write, and whether anything says it.
	const first = addCustomConstraint(emptyScene());
	assert.equal(first.id, "rule");
	assert.equal(violRefs(first.scene.rules, "rule"), 0);
	const renamed = renameConstraint(first.scene, "rule", "no_wide_gaps");
	assert.equal(renamed.rewritten, 0);
	assert.equal(violRefs(renamed.scene.rules, "no_wide_gaps"), 0);
	// And the id is what the line has to say, which is all the panel needs to
	// spell it out.
	assert.equal(renamed.scene.constraints[0].id, "no_wide_gaps");
});

test("renaming works on a generated id too, so there is no per-kind path", () => {
	const differ = addConstraint(threeBoxes(), "differ", ["a", "b"], "fill");
	const renamed = renameConstraint(differ.scene, differ.id, "no_twins");
	assert.equal(renamed.rewritten, 0, "nothing referenced the opaque id");
	assert.deepEqual(compile(renamed.scene).guards, ["active(no_twins)"]);
});
