/**
 * Constraints over sets a rule named, and variables a rule minted.
 *
 * Two capabilities that only make sense together: a rule can put nodes on the
 * canvas, so it has to be able to say what varies about them and what rule they
 * obey — otherwise what it creates is decoration. Held against the real solver,
 * on a document small enough to read.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, compile } from "./compile.ts";
import { derivedNodes, documentIds } from "./derived.ts";
import { directSolver } from "./directSolver.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import { groupProps, readModel } from "./model.ts";
import {
	RULES_HEADER,
	type Constraint,
	makeFrame,
	type Scene,
	rangesOverGroup,
	starterTokens,
} from "./scene.ts";
import { deleteNodes, retargetConstraint } from "./edits.ts";
import { propVar, ref } from "./values.ts";

/** Three cells a rule builds, each saying one of `count` words. */
const RULES = (count: number) => `${RULES_HEADER}
pos(1..3).
say(1..${count}).
node(cell(I)) :- pos(I).
kind(cell(I),text) :- pos(I).
child(page,cell(I)) :- pos(I).
frame(cell(I),x,X) :- pos(I), X = (I-1)*60.
frame(cell(I),width,50) :- pos(I).
frame(cell(I),height,20) :- pos(I).
literal(word(N),"w") :- say(N).
alt(prop(cell(I),text),N) :- pos(I), say(N).
alt_literal(prop(cell(I),text),N,word(N)) :- alt(prop(cell(I),text),N).
group(all).
member(all,cell(I)) :- pos(I).
`;

const over = (group: string | undefined, nodes: string[] = []): Constraint => ({
	id: "k1",
	kind: "differ",
	prop: "text",
	nodes,
	...(group === undefined ? {} : { group }),
	enabled: true,
});

function scene(count: number, constraint: Constraint): Scene {
	return {
		tokens: starterTokens(),
		nodes: [
			{
				id: "page",
				kind: "frame",
				name: "Page",
				frame: makeFrame({ x: 0, y: 0, width: 200, height: 100 }),
				props: { fill: [ref("surface")] },
				children: [],
			},
		],
		constraints: [constraint],
		rules: RULES(count),
	};
}

test("a rule can mint a variable, and the answer set reports its alternatives", async () => {
	const result = await explore(scene(3, over("all")), directSolver, { limit: 16 });
	const model = result.universes[0].model;
	assert.deepEqual(Object.keys(model.groups), ["all"]);
	assert.deepEqual(model.groups.all, ["cell(1)", "cell(2)", "cell(3)"]);
	// Numbered 1..3 by the rule, not 0..2 — the index is the rule's to choose
	// and the reader reports what it actually said.
	assert.deepEqual(model.variables[propVar("cell(1)", "text")], [
		{ index: 1, text: "w" },
		{ index: 2, text: "w" },
		{ index: 3, text: "w" },
	]);
	// The document's own variables are not in here: it already holds those.
	assert.ok(!("tok(accent)" in model.variables));
	// And the group's members are text nodes, so a rule over them can be about
	// anything a text node holds.
	assert.ok(groupProps(model, model.groups.all).includes("text"));
	// A frame and a text node share only what both actually hold.
	assert.deepEqual(groupProps(model, ["page", ...model.groups.all]), ["opacity"]);
});

test("nine members the document never enumerated obey one rule", async () => {
	// Three cells, three words, all different: 3! = 6 arrangements. The rule
	// names no node at all.
	const with3 = await explore(scene(3, over("all")), directSolver, { limit: 16 });
	assert.equal(with3.total, 6);
	// Without the rule they are free: 27.
	const free = await explore(
		scene(3, { ...over("all"), enabled: false }),
		directSolver,
		{ limit: 32 },
	);
	assert.equal(free.total, 27);
});

test("a group with too few members to go round names itself in the core", async () => {
	await assert.rejects(
		explore(scene(2, over("all")), directSolver, { limit: 4 }),
		(err: unknown) => {
			assert.ok(err instanceof UnsatisfiableError);
			assert.deepEqual(err.conflict, ["k1"]);
			return true;
		},
	);
});

test("the rule that derives the members is generic, and only emitted when used", () => {
	const grouped = compile(scene(3, over("all")));
	assert.ok(grouped.program.includes("c_group(k1,all)."));
	assert.ok(grouped.program.includes("c_node(C,N) :- c_group(C,G), member(G,N)."));
	// No `c_node` facts: what it ranges over is the rule's business.
	assert.ok(!grouped.program.includes("c_node(k1,"));
	assert.ok(!grouped.program.includes("c_slot(k1,"));

	const listed = compile(scene(3, over(undefined, ["page", "page"])));
	assert.ok(!listed.program.includes("c_group("));
	assert.ok(!listed.program.includes("c_node(C,N) :- c_group"));
});

test("a group survives what a listed member would not", () => {
	// A listed rule over a deleted node is a ghost and is pruned; a group's
	// members were never the document's to delete.
	const listed = scene(3, over(undefined, ["page", "page"]));
	assert.equal(deleteNodes(listed, ["page"]).constraints.length, 0);
	const grouped = scene(3, over("all"));
	assert.equal(deleteNodes(grouped, ["page"]).constraints.length, 1);
	assert.equal(deleteNodes(grouped, ["page"]).constraints[0].group, "all");
});

test("only the kinds that read their members as a set can take one", () => {
	assert.equal(rangesOverGroup("differ"), true);
	assert.equal(rangesOverGroup("match"), true);
	assert.equal(rangesOverGroup("atMost"), true);
	assert.equal(rangesOverGroup("align"), true);
	assert.equal(rangesOverGroup("equalSize"), true);
	// A gap has a near side and a far side; a set has neither.
	assert.equal(rangesOverGroup("gap"), false);
	assert.equal(rangesOverGroup("symmetric"), false);
	assert.equal(rangesOverGroup("pin"), false);

	// So retargeting to one of those drops the group rather than keeping dead
	// data, and the listed members are what it falls back to.
	const grouped = scene(3, { ...over("all"), nodes: ["page"] });
	const asGap = retargetConstraint(grouped, "k1", { kind: "gap" });
	assert.equal(asGap.constraints[0].group, undefined);
	assert.deepEqual(asGap.constraints[0].nodes, ["page"]);
	// And going back picks it up again only if it is asked for.
	const back = retargetConstraint(asGap, "k1", { kind: "differ" });
	assert.equal(back.constraints[0].group, undefined);
	const pointed = retargetConstraint(asGap, "k1", { kind: "differ", group: "all" });
	assert.equal(pointed.constraints[0].group, "all");
});

test("what a rule created is derived, and says so", async () => {
	const doc = scene(3, over("all"));
	const result = await explore(doc, directSolver, { limit: 4 });
	const model = result.universes[0].model;
	const derived = derivedNodes(model, documentIds(doc));
	assert.deepEqual(
		derived.map((d) => d.node.id),
		["cell(1)", "cell(2)", "cell(3)"],
	);
	// Under the page, so the panel can show them where they are.
	assert.deepEqual(new Set(derived.map((d) => d.parent)), new Set(["page"]));
});

test("a document with no such rule pays nothing for either", async () => {
	const plain: Scene = {
		...scene(3, over(undefined, ["page", "page"])),
		rules: RULES_HEADER,
	};
	const { program, guards } = compile(plain);
	const session = await directSolver.open(program, "--project");
	const out = await session.solve({
		models: 1,
		assumptions: [...guards, PULL_ATOM].map((atom) => ({ atom })),
	});
	await session.close();
	const model = readModel(out.models[0]);
	assert.deepEqual(model.groups, {});
	assert.deepEqual(model.variables, {});
	assert.ok(!out.models[0].some((a) => a.startsWith("dalt(")));
});
