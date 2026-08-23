import { frame, rect, text } from "./shared.ts";
import {
	RULES_HEADER,
	starterTokens,
	type Constraint,
	type Scene,
	type SceneNode,
} from "../scene.ts";
import { lit, ref, single } from "../values.ts";

/**
 * A sudoku, as an ordinary document.
 *
 * Nothing here is a sudoku feature. A cell is a text node whose wording holds
 * nine alternatives; a given is the same node with one. A row, a column and a
 * box are the `differ` rule the Rules panel already offers, over nine members
 * and the `text` property. That is the whole encoding — 81 nodes, 27 rules,
 * no new kind of anything — and the solver comes back with exactly one
 * universe, which is to say the finished board is already on the canvas.
 *
 * It earns its place in this list because every part of the studio says
 * something true about it at once:
 *
 *   - the multiverse is the solution count: one for a proper puzzle, several
 *     the moment a given is deleted;
 *   - the reachability marks in a cell's property row are pencil marks —
 *     nine alternatives with the impossible ones dimmed, narrowing live as
 *     other cells are pinned;
 *   - two givens that clash come back as an unsat core naming the one group
 *     of nine they clash in, out of twenty-seven.
 *
 * The digits are the *content* of the cells rather than nine colours, which
 * only became possible when copy stopped being a bare string and became a
 * value like any other.
 */

/** Wikipedia's example grid: 30 givens, and exactly one completion. */
const PUZZLE = [
	"53..7....",
	"6..195...",
	".98....6.",
	"8...6...3",
	"4..8.3..1",
	"7...2...6",
	".6....28.",
	"...419..5",
	"....8..79",
];

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Nine alternatives — an empty cell is a variable with the full domain. */
const PENCIL = DIGITS.map(lit);

const CELL = 44;
const BOARD = CELL * 9;
const PAD = 24;
/** Where the grid starts inside the frame, under the title. */
const TOP = 72;

const cellId = (row: number, col: number) => `r${row + 1}c${col + 1}`;
const cellName = (row: number, col: number) => `R${row + 1}C${col + 1}`;

/**
 * One cell.
 *
 * Fixed sizing rather than hugging: a sudoku cell is a square of the grid, not
 * a box the width of whatever digit landed in it — and a hugging cell would
 * also have every one of its nine wordings measured, which is 729 measurements
 * for a board that never moves.
 */
function cell(row: number, col: number): SceneNode {
	const given = PUZZLE[row][col];
	const box: [number, number, number, number] = [
		PAD + col * CELL,
		TOP + row * CELL,
		CELL,
		CELL,
	];
	const node = text(
		cellId(row, col),
		cellName(row, col),
		box,
		given === "." ? PENCIL : given,
		{
			// A given is the designer's, a solved digit is the solver's, and the
			// board says which is which the way a printed puzzle does.
			ink: given === "." ? [ref("accent")] : [ref("ink")],
			size: single("22px"),
			weight: single(given === "." ? "500" : "700"),
			align: single("center"),
			// A line box exactly as tall as the cell is what centres the digit in
			// it; there is no vertical alignment to ask for.
			lineHeight: single("2"),
		},
	);
	return { ...node, sizing: "fixed" };
}

/** The 8 interior rules of the grid, thick every third one. */
function gridLines(): SceneNode[] {
	const lines: SceneNode[] = [];
	for (let i = 1; i < 9; i++) {
		const heavy = i % 3 === 0;
		const w = heavy ? 2 : 1;
		const paint = { fill: [lit(heavy ? "#0f172a" : "#e2e8f0")], radius: single("0px") };
		const at = PAD + i * CELL - (heavy ? 1 : 0);
		lines.push(
			rect(`vline${i}`, `Column rule ${i}`, [at, TOP, w, BOARD], paint),
			rect(`hline${i}`, `Row rule ${i}`, [PAD, TOP + i * CELL - (heavy ? 1 : 0), BOARD, w], paint),
		);
	}
	return lines;
}

/**
 * The 27 groups, as `differ` over `text`.
 *
 * Each is a plain constraint with its own switch, which is what makes a
 * contradiction attributable: the core names `row1` rather than "the sudoku".
 */
function groups(): Constraint[] {
	const out: Constraint[] = [];
	const add = (id: string, nodes: string[]) =>
		out.push({ id, kind: "differ", prop: "text", nodes, enabled: true });

	for (let i = 0; i < 9; i++) {
		add(`row${i + 1}`, DIGITS.map((_, c) => cellId(i, c)));
		add(`col${i + 1}`, DIGITS.map((_, r) => cellId(r, i)));
		add(
			`box${i + 1}`,
			DIGITS.map((_, k) =>
				cellId(3 * Math.floor(i / 3) + Math.floor(k / 3), 3 * (i % 3) + (k % 3)),
			),
		);
	}
	return out;
}

export function sudoku(): Scene {
	const cells: SceneNode[] = [];
	for (let row = 0; row < 9; row++) {
		for (let col = 0; col < 9; col++) cells.push(cell(row, col));
	}

	return {
		tokens: starterTokens(),
		nodes: [
			frame(
				"page",
				"Puzzle",
				[0, 0, PAD * 2 + BOARD, TOP + BOARD + PAD],
				{ fill: [ref("muted")] },
				[
					text("title", "Title", [PAD, 20, BOARD, 26], "Sudoku", {
						ink: [ref("ink")],
						size: single("20px"),
						weight: single("700"),
					}),
					text(
						"caption",
						"Caption",
						[PAD, 48, BOARD, 16],
						"81 cells of nine digits, 27 rules, one universe.",
						{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
					),
					rect("board", "Board", [PAD, TOP, BOARD, BOARD], {
						fill: [ref("surface")],
						radius: single("2px"),
						stroke: single("#0f172a"),
						strokeWidth: single("2px"),
					}),
					...gridLines(),
					...cells,
				],
			),
		],
		constraints: groups(),
		rules: RULES_HEADER,
	};
}
