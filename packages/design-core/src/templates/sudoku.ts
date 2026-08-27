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
 * A sudoku, as an ordinary document — most of which is not in the document at
 * all.
 *
 * Nothing here is a sudoku feature. The 81 cells are text nodes a rule brings
 * into being; a cell's nine pencil marks are `alt/2`, which is the same
 * predicate a property row compiles to, so they pick, resolve, render, grey and
 * pin exactly like a fill with nine colours. The 27 groups are `group/1` and
 * `member/2`, and each of the 27 rules in the Rules panel points at one of them
 * rather than listing nine ids. That is the whole encoding — six kinds of atom,
 * no new kind of anything — and the solver comes back with exactly one
 * universe, which is to say the finished board is already on the canvas.
 *
 * It was written as 81 TypeScript nodes and 243 enumerated members first, and
 * the difference is the point: what a rule creates used to be second-class,
 * with nothing to select, no property row to grey and no rule a core could
 * name. Every one of those now works on nodes the document does not hold.
 *
 * The three claims the template is in the list to make:
 *
 *   - the multiverse is the solution count: one for a proper puzzle, several
 *     the moment a `given` is deleted from the rules;
 *   - the reachability marks in a cell's property row are pencil marks —
 *     nine alternatives with the impossible ones dimmed, narrowing live as
 *     other cells are pinned;
 *   - two givens that clash come back as an unsat core naming the one group
 *     of nine they clash in, out of twenty-seven.
 *
 * The puzzle itself is data in the rules, which is where a puzzle belongs:
 * changing one `given` fact is how you open the board up or contradict it.
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

const CELL = 44;
const BOARD = CELL * 9;
const PAD = 24;
/** Where the grid starts inside the frame, under the title. */
const TOP = 72;

/** The three families of nine, and how a member of each is named. */
const FAMILIES = ["row", "col", "box"] as const;

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
 * What each one ranges over is a *set the rules named* — nine members this
 * document never enumerated and could not, since the cells are not in it.
 *
 * These 27 rows are the one part of the board still written in TypeScript, and
 * they have to be. A rule you write can now be a first-class constraint — the
 * `custom` kind, whose violation condition is ASP in the Rules panel — but the
 * *row* is what carries the switch, and the switch is an assumption: the solver
 * is handed `active(row1)` before it starts, from the document's own list of
 * constraints. A rule can mint the atoms and still not get the assumption, and
 * measured, both ways it can go are dead ends: `constraint(mine).` from a rule
 * leaves `active(mine)` free, so the solver switches the rule off and it does
 * nothing; asserting `active(mine).` as well makes it fire, but the core comes
 * back *empty*, because a core is a subset of what was assumed. Which is to say
 * a rule-minted constraint is exactly a bare `:- ...` again, with the two things
 * that make a rule first-class missing.
 *
 * So the names have to exist before the first solve, and 27 rows is what that
 * costs. `custom` would not shorten it either: it would be the same 27 rows,
 * each needing a hand-written `viol/1` to say what `differ` and `c_group`
 * already say between them.
 */
function groups(): Constraint[] {
	return FAMILIES.flatMap((family) =>
		Array.from({ length: 9 }, (_, i) => ({
			id: `${family}${i + 1}`,
			kind: "differ" as const,
			prop: "text" as const,
			nodes: [],
			group: `${family}(${i + 1})`,
			enabled: true,
		})),
	);
}

/** The puzzle, one fact per given. Delete one and the board opens up. */
function givens(): string {
	return PUZZLE.flatMap((row, r) => {
		const line = [...row].flatMap((digit, c) =>
			digit === "." ? [] : [`given(${r + 1},${c + 1},${digit}).`],
		);
		return line.length > 0 ? [line.join(" ")] : [];
	}).join("\n");
}

/** Everything the page holds itself: the heading, the board, the grid rules. */
function furniture(): SceneNode[] {
	return [
		text("title", "Title", [PAD, 20, BOARD, 26], "Sudoku", {
			ink: [ref("ink")],
			size: single("20px"),
			weight: single("700"),
		}),
		text(
			"caption",
			"Caption",
			[PAD, 48, BOARD, 16],
			"81 cells and 27 groups, all of them derived by rules.",
			{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
		),
		rect("board", "Board", [PAD, TOP, BOARD, BOARD], {
			fill: [ref("surface")],
			radius: single("2px"),
			stroke: single("#0f172a"),
			strokeWidth: single("2px"),
		}),
		...gridLines(),
	];
}

const rules = (over: number) => `${RULES_HEADER}
% ---- the puzzle ----
% One fact per given. Delete one and the space opens up; change one so that two
% givens clash and the core names the single group of nine they clash in.
pos(1..9).
digit(1..9).
${givens()}
open(R,C) :- pos(R), pos(C), not given(R,C,_).

% ---- the 81 cells ----
% node/1 is derivable, so these are on the canvas without being in the
% document. Frames are relative to the page, which is what the grid is drawn on.
%
% frame/3 is in EMU, so every coordinate here is written in pixels and
% multiplied by "emupx" — a #const the generated program declares, folded away
% while grounding. Say the unit rather than the number: ${CELL}*emupx is a
% ${CELL}-pixel cell, and ${CELL * 9525} is nothing anybody can read.
node(cell(R,C)) :- pos(R), pos(C).
kind(cell(R,C),text) :- pos(R), pos(C).
child(page,cell(R,C)) :- pos(R), pos(C).
frame(cell(R,C),x,X) :- pos(R), pos(C), X = (${PAD} + (C-1)*${CELL})*emupx.
frame(cell(R,C),y,Y) :- pos(R), pos(C), Y = (${TOP} + (R-1)*${CELL})*emupx.
frame(cell(R,C),width,${CELL}*emupx) :- pos(R), pos(C).
frame(cell(R,C),height,${CELL}*emupx) :- pos(R), pos(C).
% child/2 is a set, so paint order is order/2 and nothing else. The digits go
% over the board and its grid rules, which are the ${over} layers the page holds.
order(cell(R,C),I) :- pos(R), pos(C), I = ${over} + (R-1)*9 + C.

% ---- what a cell says: nine pencil marks, or the one digit it was given ----
% alt/2 is the same predicate a property row compiles to, so these are ordinary
% variables: the solver picks one per cell, the inspector offers all nine and
% dims the ones no board uses, and either can be pinned.
literal(dig(1),"1"). literal(dig(2),"2"). literal(dig(3),"3").
literal(dig(4),"4"). literal(dig(5),"5"). literal(dig(6),"6").
literal(dig(7),"7"). literal(dig(8),"8"). literal(dig(9),"9").
alt(prop(cell(R,C),text),D) :- open(R,C), digit(D).
alt(prop(cell(R,C),text),D) :- given(R,C,D).
alt_literal(prop(cell(R,C),text),D,dig(D)) :- alt(prop(cell(R,C),text),D).

% ---- how a cell is drawn ----
% A given is the designer's and a solved digit is the solver's, and the board
% says which is which the way a printed puzzle does. The colours follow the
% document's own variables, so recolouring 'accent' recolours the answers.
% A line box exactly as tall as the cell is what centres the digit in it.
rendered(cell(R,C),ink,L) :- given(R,C,_), resolved(tok(ink),L).
rendered(cell(R,C),ink,L) :- open(R,C), resolved(tok(accent),L).
rendered(cell(R,C),weight,"700") :- given(R,C,_).
rendered(cell(R,C),weight,"500") :- open(R,C).
rendered(cell(R,C),size,"22px") :- pos(R), pos(C).
rendered(cell(R,C),align,"center") :- pos(R), pos(C).
rendered(cell(R,C),lineHeight,"2") :- pos(R), pos(C).

% ---- the 27 groups ----
% Each is a set the Rules panel can point a constraint at. Twenty-seven rules
% cover 243 memberships that nothing had to write down.
group(row(R)) :- pos(R).
group(col(C)) :- pos(C).
group(box(B)) :- B = 1..9.
member(row(R),cell(R,C)) :- pos(R), pos(C).
member(col(C),cell(R,C)) :- pos(R), pos(C).
member(box(B),cell(R,C)) :- pos(R), pos(C), B = 3*((R-1)/3) + (C-1)/3 + 1.
`;

export function sudoku(): Scene {
	const page = furniture();
	return {
		tokens: starterTokens(),
		styles: [],
		machines: [],
		nodes: [
			frame(
				"page",
				"Puzzle",
				[0, 0, PAD * 2 + BOARD, TOP + BOARD + PAD],
				{ fill: [ref("muted")] },
				page,
			),
		],
		constraints: groups(),
		rules: rules(page.length),
	};
}
