/**
 * The sudoku template, against the real solver.
 *
 * These are not tests of a sudoku engine — there is no sudoku engine. They
 * check the three claims the template is in the list to make: a proper puzzle
 * is exactly one universe, a hole in the givens is several, and a clash is a
 * core naming one group out of twenty-seven.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { deleteNodes } from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import { findTemplate } from "./templates/index.ts";
import { flatten } from "./tree.ts";
import { propVar, single } from "./values.ts";

const board = () => findTemplate("sudoku")!.create();

/** The digits a universe put in the grid, row by row. */
function digits(universe: { model: { byId: Record<string, { rendered: { text?: string } }> } }): string[] {
	const rows: string[] = [];
	for (let row = 1; row <= 9; row++) {
		let line = "";
		for (let col = 1; col <= 9; col++) {
			line += universe.model.byId[`r${row}c${col}`]?.rendered.text ?? ".";
		}
		rows.push(line);
	}
	return rows;
}

/** A cell's wording, replaced in a copy of the document. */
function write(scene: ReturnType<typeof board>, id: string, digit: string) {
	const next = { ...scene, nodes: structuredClone(scene.nodes) };
	const cell = flatten(next.nodes).find((n) => n.id === id);
	assert.ok(cell, `${id} exists`);
	cell.props.text = single(digit);
	return next;
}

test("the puzzle is 81 cells and 27 all-different rules", () => {
	const scene = board();
	const cells = flatten(scene.nodes).filter((n) => /^r\dc\d$/.test(n.id));
	assert.equal(cells.length, 81);
	assert.equal(scene.constraints.length, 27);
	for (const c of scene.constraints) {
		assert.equal(c.kind, "differ");
		assert.equal(c.prop, "text");
		assert.equal(c.nodes.length, 9, `${c.id} covers nine cells`);
		assert.equal(new Set(c.nodes).size, 9, `${c.id} has no repeats`);
	}
	// Every cell is in exactly three groups: its row, its column, its box.
	const seen = new Map<string, number>();
	for (const c of scene.constraints) {
		for (const id of c.nodes) seen.set(id, (seen.get(id) ?? 0) + 1);
	}
	assert.equal(seen.size, 81);
	for (const [id, count] of seen) assert.equal(count, 3, `${id} is in three groups`);

	// A given is one wording; an empty cell is the whole domain.
	const spread = cells.map((n) => n.props.text?.length ?? 0).sort();
	assert.equal(spread.filter((n) => n === 1).length, 30, "30 givens");
	assert.equal(spread.filter((n) => n === 9).length, 51, "51 unknowns");
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

test("with one answer, every cell's pencil marks come down to one digit", async () => {
	const result = await explore(board(), directSolver, { limit: 8 });
	// This is what the property rows grey out: brave consequences are the
	// alternatives that occur somewhere, so eight of nine go dim per cell.
	for (const [variable, indices] of Object.entries(result.brave.pick)) {
		assert.equal(indices.size, 1, `${variable} is settled`);
	}
	assert.equal(result.brave.pick[propVar("r1c3", "text")]?.size, 1);
});

test("delete some givens and the space opens up", async () => {
	const holed = deleteNodes(board(), ["r1c1", "r1c2", "r2c1", "r2c4"]);
	// Pruning keeps the groups; they simply range over fewer cells.
	assert.equal(holed.constraints.length, 27);
	assert.ok(
		holed.constraints.some((c) => c.nodes.length < 9),
		"the groups the deleted cells were in lost a member",
	);

	const result = await explore(holed, directSolver, { limit: 64 });
	assert.ok(result.total !== null && result.total > 1, "more than one board");
	// And now the pencil marks say something: some cell has several digits left.
	const open = Object.entries(result.brave.pick).filter(
		([v, s]) => v.startsWith("prop(r") && s.size > 1,
	);
	assert.ok(open.length > 0, "some cell is undecided");
});

test("pinning a cell narrows the space", async () => {
	const holed = deleteNodes(board(), ["r1c1", "r1c2", "r2c1", "r2c4"]);
	const before = await explore(holed, directSolver, { limit: 64 });
	const [variable, indices] = Object.entries(before.brave.pick).find(
		([v, s]) => v.startsWith("prop(r") && s.size > 1,
	)!;

	const after = await explore(holed, directSolver, {
		limit: 64,
		pins: { [variable]: [...indices][0] },
	});
	assert.ok(after.total !== null && before.total !== null);
	assert.ok(after.total < before.total, "fewer boards than before");
	assert.ok(after.total > 0, "still legal");
});

test("two givens that clash name one group out of twenty-seven", async () => {
	// R1C5 is a 7; making R1C1 one too leaves row 1 with nowhere to go.
	const clash = write(board(), "r1c1", "7");
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
	// promised is that the guilty group is in it and that it stays a handful
	// rather than the whole board.
	const clash = write(board(), "r5c1", "6");
	await assert.rejects(
		explore(clash, directSolver, { limit: 4 }),
		(err: unknown) => {
			assert.ok(err instanceof UnsatisfiableError);
			assert.ok(err.conflict.includes("col1"), err.conflict.join());
			assert.ok(err.conflict.length <= 3, err.conflict.join());
			return true;
		},
	);
});
