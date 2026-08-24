/**
 * The sudoku template, against the real solver.
 *
 * These are not tests of a sudoku engine — there is no sudoku engine. They
 * check the three claims the template is in the list to make: a proper puzzle
 * is exactly one universe, a hole in the givens is several, and a clash is a
 * core naming one group out of twenty-seven. Nothing the board is made of is in
 * the document, so they are also the regression on rule-derived nodes being
 * first-class: selectable, greyable, pinnable, and nameable in a core.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import type { Universe } from "./explore.ts";
import { findTemplate } from "./templates/index.ts";
import { flatten } from "./tree.ts";
import { propVar } from "./values.ts";

const board = () => findTemplate("sudoku")!.create();

const cellVar = (row: number, col: number) => propVar(`cell(${row},${col})`, "text");

/** The digits a universe put in the grid, row by row. */
function digits(universe: Universe): string[] {
	const rows: string[] = [];
	for (let row = 1; row <= 9; row++) {
		let line = "";
		for (let col = 1; col <= 9; col++) {
			line += universe.model.byId[`cell(${row},${col})`]?.rendered.text ?? ".";
		}
		rows.push(line);
	}
	return rows;
}

/** Rewrites one `given` fact, which is how the puzzle itself is edited. */
function regiven(
	scene: ReturnType<typeof board>,
	row: number,
	col: number,
	digit: string | null,
) {
	const was = new RegExp(`given\\(${row},${col},\\d\\)\\.\\s?`);
	assert.match(scene.rules, was, `given(${row},${col},_) is in the rules`);
	return {
		...scene,
		rules: scene.rules.replace(
			was,
			digit === null ? "" : `given(${row},${col},${digit}). `,
		),
	};
}

test("the document holds the furniture; the rules hold the puzzle", () => {
	const scene = board();
	// Not one cell in the document, and not one member enumerated.
	const ids = flatten(scene.nodes).map((n) => n.id);
	assert.equal(ids.filter((id) => id.startsWith("cell(")).length, 0);
	assert.equal(scene.constraints.length, 27);
	for (const c of scene.constraints) {
		assert.equal(c.kind, "differ");
		assert.equal(c.prop, "text");
		assert.deepEqual(c.nodes, [], `${c.id} names no members`);
		assert.match(c.group ?? "", /^(row|col|box)\([1-9]\)$/, `${c.id} names a group`);
	}
	assert.equal(new Set(scene.constraints.map((c) => c.group)).size, 27);
});

test("a proper puzzle solves to exactly one universe", async () => {
	const result = await explore(board(), directSolver, { limit: 8 });
	assert.equal(result.count, 1);
	assert.equal(result.total, 1);
	assert.deepEqual(digits(result.universes[0]), [
		"534678912",
		"672195348",
		"198342567",
		"859761423",
		"426853791",
		"713924856",
		"961537284",
		"287419635",
		"345286179",
	]);
});

test("the 81 cells and 27 groups come back out of the answer set", async () => {
	const result = await explore(board(), directSolver, { limit: 8 });
	const model = result.universes[0].model;
	// Every cell is a node of the answer set the document knows nothing about.
	const cells = Object.keys(model.byId).filter((id) => id.startsWith("cell("));
	assert.equal(cells.length, 81);
	assert.equal(Object.keys(model.groups).length, 27);
	for (const [name, members] of Object.entries(model.groups)) {
		assert.equal(members.length, 9, `${name} has nine members`);
		assert.equal(new Set(members).size, 9, `${name} has no repeats`);
	}
	// Each cell is in exactly three groups: its row, its column, its box.
	const seen = new Map<string, number>();
	for (const members of Object.values(model.groups)) {
		for (const id of members) seen.set(id, (seen.get(id) ?? 0) + 1);
	}
	assert.equal(seen.size, 81);
	for (const [id, count] of seen) assert.equal(count, 3, `${id} is in three groups`);

	// And every open cell is a *variable*, with nine alternatives the document
	// never minted, keyed so the studio can pin one.
	const variables = Object.entries(model.variables);
	assert.equal(variables.length, 81);
	const nine = variables.filter(([, alts]) => alts.length === 9);
	assert.equal(nine.length, 51, "51 unknowns with the full domain");
	assert.equal(variables.length - nine.length, 30, "30 givens with one digit");
	const one = model.variables[cellVar(1, 1)];
	assert.deepEqual(one, [{ index: 5, text: "5" }], "R1C1 is the given 5");
	assert.deepEqual(
		model.variables[cellVar(1, 3)]?.map((a) => a.text),
		["1", "2", "3", "4", "5", "6", "7", "8", "9"],
	);
});

test("with one answer, every cell's pencil marks come down to one digit", async () => {
	const result = await explore(board(), directSolver, { limit: 8 });
	// This is what the property rows grey out: brave consequences are the
	// alternatives that occur somewhere, so eight of nine go dim per cell.
	for (const [variable, indices] of Object.entries(result.brave.pick)) {
		assert.equal(indices.size, 1, `${variable} is settled`);
	}
	assert.equal(result.brave.pick[cellVar(1, 3)]?.size, 1);
});

test("delete some givens and the space opens up", async () => {
	let holed = board();
	for (const [row, col] of [
		[1, 1],
		[1, 2],
		[2, 1],
		[2, 4],
	]) {
		holed = regiven(holed, row, col, null);
	}
	// The groups are untouched: what they range over is the rules' business.
	assert.equal(holed.constraints.length, 27);

	const result = await explore(holed, directSolver, { limit: 64 });
	assert.ok(result.total !== null && result.total > 1, "more than one board");
	// And now the pencil marks say something: some cell has several digits left.
	const open = Object.entries(result.brave.pick).filter(
		([v, s]) => v.startsWith("prop(cell(") && s.size > 1,
	);
	assert.ok(open.length > 0, "some cell is undecided");
});

test("pinning a derived cell narrows the space", async () => {
	let holed = board();
	for (const [row, col] of [
		[1, 1],
		[1, 2],
		[2, 1],
		[2, 4],
	]) {
		holed = regiven(holed, row, col, null);
	}
	const before = await explore(holed, directSolver, { limit: 64 });
	const [variable, indices] = Object.entries(before.brave.pick).find(
		([v, s]) => v.startsWith("prop(cell(") && s.size > 1,
	)!;

	// A pin on a variable no document value named — the whole of what used to
	// be missing. It is an assumption like any other.
	const after = await explore(holed, directSolver, {
		limit: 64,
		pins: { [variable]: [...indices][0] },
	});
	assert.ok(after.total !== null && before.total !== null);
	assert.ok(after.total < before.total, "fewer boards than before");
	assert.ok(after.total > 0, "still legal");
	assert.deepEqual([...(after.brave.pick[variable] ?? [])], [[...indices][0]]);
});

test("two givens that clash name one group out of twenty-seven", async () => {
	// R1C5 is a 7; making R1C1 one too leaves row 1 with nowhere to go.
	const clash = regiven(board(), 1, 1, "7");
	await assert.rejects(
		explore(clash, directSolver, { limit: 4 }),
		(err: unknown) => {
			assert.ok(err instanceof UnsatisfiableError);
			assert.deepEqual(err.conflict, ["row1"]);
			return true;
		},
	);
});

test("a clash down a column blames the column", async () => {
	// R2C1 is a 6, so a second 6 in column 1 has nowhere to go. A core is the
	// smallest set clingo *found*, not the smallest that exists, so what is
	// promised is that the guilty group is in it and that it stays a fraction of
	// the twenty-seven rather than the whole board.
	//
	// It is a *looser* fraction than it was when the same 27 rules listed their
	// members: measured, this core is ten where the enumerated encoding gave two.
	// Deriving `c_node/2` from `member/2` is what does it — same models, same
	// answer, different clause structure for conflict analysis to walk. The
	// straight row clash below is still exactly one rule either way, which is the
	// case the studio's own demo turns on, so the trade was taken rather than
	// forking the kinds to keep a tighter core.
	const clash = regiven(board(), 5, 1, "6");
	await assert.rejects(
		explore(clash, directSolver, { limit: 4 }),
		(err: unknown) => {
			assert.ok(err instanceof UnsatisfiableError);
			assert.ok(err.conflict.includes("col1"), err.conflict.join());
			assert.ok(err.conflict.length <= 12, err.conflict.join());
			return true;
		},
	);
});

test("the switch on a group-ranged rule is the ordinary one", async () => {
	// A group carries no privileges: switching one off has to take it out of the
	// program, and switching them all off has to leave 51 free cells behind.
	const scene = board();
	const off = (ids: readonly string[]) => ({
		...scene,
		constraints: scene.constraints.map((c) =>
			ids.includes(c.id) ? { ...c, enabled: false } : c,
		),
	});

	const one = compile(off(["box1"]));
	assert.ok(!one.guards.includes("active(box1)"), "no switch to assume");
	assert.ok(!one.program.includes("c_group(box1,"), "and nothing in the program");
	assert.ok(one.program.includes("c_group(box2,box(2))."), "the rest are still there");

	// A proper puzzle is over-determined, so one rule fewer is still one board —
	// the switch has to be seen where the three groups that meet in a corner all
	// come off, and then the digit in that corner is free to move.
	assert.equal((await explore(off(["box1"]), directSolver, { limit: 8 })).total, 1);
	const loose = await explore(off(["row1", "col1", "box1"]), directSolver, { limit: 8 });
	assert.ok(loose.total !== null && loose.total > 1, `${loose.total} boards`);
});
