/**
 * What clingo says about a program it ran anyway.
 *
 * The rules panel is a place people write ASP by hand, and the commonest
 * mistake there is a misspelled predicate: it grounds perfectly, contributes
 * nothing, and the design silently comes back wider than intended. clingo has
 * always had something to say about that; the shim discarded it, because the
 * parse call took a message limit of zero and neither it nor the control was
 * given a logger.
 *
 * These are the regression on that channel staying open, end to end: the
 * message arrives, it is attributed to the line the user typed, and a clean
 * document still says nothing at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { countDiagnostics, formatDiagnostics } from "./atoms.ts";
import { directSolver } from "./directSolver.ts";
import { Explorer, explore } from "./explore.ts";
import { addNode, makeNode, setProp } from "./edits.ts";
import { emptyScene, type Scene } from "./scene.ts";
import { TEMPLATES } from "./templates/index.ts";
import { lit } from "./values.ts";

/** Two rectangles with two fills each, plus whatever rules are given. */
function scene(rules: string): Scene {
	let next = emptyScene();
	for (const id of ["a", "b"]) {
		next = addNode(
			next,
			makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id }),
		);
		next = setProp(next, [id], "fill", [lit("#ff0000"), lit("#00ff00")]);
	}
	return { ...next, rules };
}

test("a program clingo has nothing to say about reports nothing", async () => {
	const { diagnostics } = await explore(scene(""), directSolver, { limit: 4 });
	assert.equal(diagnostics, "");
});

test("a misspelled predicate in a hand-written rule is reported, not swallowed", async () => {
	// `thnig/1` is never derived, so this rule grounds and does nothing. The
	// space is unchanged, which is exactly why it needs saying out loud.
	const { diagnostics, count } = await explore(
		scene("wanted(X) :- thnig(X)."),
		directSolver,
		{ limit: 8 },
	);
	assert.equal(count, 4, "the design space is untouched");
	assert.match(diagnostics, /atom does not occur in any rule head/);
	assert.match(diagnostics, /thnig/, "and it names the predicate");
});

test("the message points at the line the user typed, not into the generated half", async () => {
	// The generated program is hundreds of lines; a raw clingo line number would
	// be true and useless. Two blank lines, so the rule is the user's line 3.
	const { diagnostics } = await explore(
		scene("\n\nwanted(X) :- thnig(X)."),
		directSolver,
		{ limit: 4 },
	);
	assert.match(diagnostics, /your rules, line 3:/, diagnostics);
	assert.doesNotMatch(diagnostics, /generated, line/);
});

test("a #show for a predicate nothing derives is reported", async () => {
	const { diagnostics } = await explore(scene("#show nope/1."), directSolver, {
		limit: 4,
	});
	assert.match(diagnostics, /no atoms over signature occur in program/);
});

test("several remarks all arrive", async () => {
	const { diagnostics } = await explore(
		scene("p(X) :- one(X).\nq(X) :- two(X)."),
		directSolver,
		{ limit: 4 },
	);
	assert.match(diagnostics, /one/);
	assert.match(diagnostics, /two/);
});

test("a reused grounding keeps what clingo said about it", async () => {
	// Diagnostics are read when the program is opened, and an edit that does not
	// change the program does not re-open it. They must not vanish on the second
	// exploration just because nothing was re-grounded.
	const explorer = new Explorer(directSolver);
	const doc = scene("wanted(X) :- thnig(X).");
	try {
		const first = await explorer.explore(doc, { limit: 4 });
		const second = await explorer.explore(doc, { limit: 4 });
		assert.ok(second.reusedGrounding, "the grounding was reused");
		assert.equal(second.diagnostics, first.diagnostics);
		assert.match(second.diagnostics, /thnig/);
	} finally {
		await explorer.close();
	}
});

test("formatDiagnostics reads all three of clingo's source prefixes", () => {
	// `<string>` is the AST parser a session grounds through, and is the one that
	// carries these warnings; `-` and `<block>` are the other two entry points.
	// Missing any of them means a line number counted from the wrong place.
	for (const prefix of ["-", "<block>", "<string>"]) {
		assert.equal(
			formatDiagnostics(`${prefix}:12:3-9: info: something`, 10),
			"your rules, line 3:3-9: info: something",
			prefix,
		);
	}
	// Below the user's own rules, it is our generated program's problem.
	assert.equal(
		formatDiagnostics("<string>:4:1: info: something", 10),
		"generated, line 4:1: info: something",
	);
});

test("every shipped template is clean, so a badge always means your own rule", async () => {
	// The generated program is generic rules over per-document facts, so a
	// document with no `atMost` heads no c_limit/2 and clingo says so. That is
	// true and useless to a reader who never wrote the predicate, and it would
	// put a warning on a freshly opened template — which trains people to
	// ignore the one signal this channel exists to carry. `#defined` is how the
	// absence is declared deliberate, here and in the generated program.
	for (const template of TEMPLATES) {
		const { diagnostics } = await explore(template.create(), directSolver, {
			limit: 2,
			sample: "first",
		});
		assert.equal(diagnostics, "", `${template.id}: ${diagnostics}`);
	}
});

test("a remark is counted once, not once per line of it", async () => {
	// clingo writes a header and then the atom it is about, so counting lines
	// reports one mistake as two — which is what the tab badge showed before
	// this existed.
	const { diagnostics } = await explore(
		scene("wanted(X) :- thnig(X)."),
		directSolver,
		{ limit: 4 },
	);
	assert.ok(diagnostics.split("\n").length > 1, "it really is multi-line");
	assert.equal(countDiagnostics(diagnostics), 1);

	const two = await explore(
		scene("p(X) :- one(X).\nq(X) :- two(X)."),
		directSolver,
		{ limit: 4 },
	);
	assert.equal(countDiagnostics(two.diagnostics), 2);

	assert.equal(countDiagnostics(""), 0);
	assert.equal(countDiagnostics("   \n  "), 0);
	// Something was said that does not look like clingo: say one, not none.
	assert.equal(countDiagnostics("something unexpected"), 1);
});
