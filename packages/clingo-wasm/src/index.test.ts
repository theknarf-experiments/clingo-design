import assert from "node:assert/strict";
import { test } from "node:test";

import {
	ClingoError,
	ExitCode,
	answerSets,
	run,
	solve,
} from "./index.ts";

test("solves a choice rule and enumerates every answer set", async () => {
	const result = await solve("1 { p(1..3) } 1. #show p/1.", { models: 0 });

	assert.equal(result.Result, "SATISFIABLE");
	const sets = answerSets(result).map((s) => s.join(",")).sort();
	assert.deepEqual(sets, ["p(1)", "p(2)", "p(3)"]);
});

test("defaults to a single model", async () => {
	const result = await solve("1 { p(1..3) } 1. #show p/1.");
	assert.equal(answerSets(result).length, 1);
});

test("reports unsatisfiable programs", async () => {
	const result = await solve("a. :- a.");
	assert.equal(result.Result, "UNSATISFIABLE");
	assert.deepEqual(answerSets(result), []);
});

test("solves a graph colouring instance", async () => {
	const program = `
		node(1..4).
		edge(1,2). edge(2,3). edge(3,4). edge(4,1).
		colour(r; g; b).
		1 { assign(N,C) : colour(C) } 1 :- node(N).
		:- edge(N,M), assign(N,C), assign(M,C).
		#show assign/2.
	`;
	const result = await solve(program, { models: 0 });

	assert.equal(result.Result, "SATISFIABLE");
	const sets = answerSets(result);
	assert.ok(sets.length > 0, "expected at least one colouring");

	// Every model must assign each of the four nodes exactly one colour.
	for (const set of sets) {
		assert.equal(set.length, 4);
	}
});

test("finds the optimum of an optimisation program", async () => {
	const program = `
		1 { sel(1..3) } 3.
		#minimize { 1,X : sel(X) }.
		#show sel/1.
	`;
	const result = await solve(program, { models: 0 });

	assert.equal(result.Result, "OPTIMUM FOUND");
	const best = answerSets(result).at(-1);
	assert.deepEqual(best?.length, 1);
});

test("surfaces syntax errors as ClingoError", async () => {
	await assert.rejects(
		() => solve("this is not valid asp ###"),
		(err: unknown) => {
			assert.ok(err instanceof ClingoError);
			assert.match(err.stderr, /error/i);
			return true;
		},
	);
});

test("run() exposes the raw exit code and stdout", async () => {
	const result = await run("a. b.", ["--models=0", "--outf=2"]);

	// Satisfiable and search space exhausted.
	assert.equal(result.code, ExitCode.SATISFIABLE | ExitCode.EXHAUSTED);
	assert.equal(JSON.parse(result.stdout).Result, "SATISFIABLE");
});

test("repeated solves on the reused instance stay independent", async () => {
	// The Emscripten instance is cached across calls, so verify that state
	// from one run cannot leak into the next.
	const first = await solve("p(1). #show p/1.", { models: 0 });
	const second = await solve("q(2). #show q/1.", { models: 0 });
	const third = await solve("p(1). #show p/1.", { models: 0 });

	assert.deepEqual(answerSets(first), [["p(1)"]]);
	assert.deepEqual(answerSets(second), [["q(2)"]]);
	assert.deepEqual(answerSets(third), [["p(1)"]]);
});

test("concurrent solves are serialised and do not interleave output", async () => {
	const programs = [
		"a(1). #show a/1.",
		"b(2). #show b/1.",
		"c(3). #show c/1.",
		"d(4). #show d/1.",
	];

	const results = await Promise.all(
		programs.map((p) => solve(p, { models: 0 })),
	);

	assert.deepEqual(
		results.map((r) => answerSets(r)[0]),
		[["a(1)"], ["b(2)"], ["c(3)"], ["d(4)"]],
	);
});
