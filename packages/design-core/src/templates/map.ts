import { frame, text } from "./shared.ts";
import { RULES_HEADER, starterTokens, type Scene, type SceneNode } from "../scene.ts";
import { ref, single } from "../values.ts";

/**
 * Map generation, after Adam Smith's "map generation speedrun".
 *
 * https://eis-blog.soe.ucsc.edu/2011/10/map-generation-speedrun/
 *
 * The post builds a level generator by adding one ASP rule at a time and
 * looking at what comes out: tiles are a choice, the exit has to be reachable,
 * then it has to be *far*, then the map has to be symmetric, dense, pocketed.
 * It is a good fit for this tool for a reason that has nothing to do with maps:
 * the post's whole method is "add a requirement, look at the space it leaves",
 * and that is what the multiverse is.
 *
 * So every artboard in the multiverse is a different level and all of them are
 * legal. There is no generate button and no seed to re-roll: the requirements
 * *are* the generator, and the designs are what satisfies them. The space is far
 * too big to enumerate — 119 of the 121 tiles are free, the two ends being
 * forced walkable — so it is sampled, and "shuffle" is how you ask for more.
 *
 * Nothing here is a map feature, and almost nothing is in the document. The 121
 * tiles are `node/1` a rule brings into being. Each one's fill is `alt/2` with
 * two alternatives, which is the same predicate a property row compiles to — so
 * a tile picks, resolves, renders, greys and *pins* exactly like a rectangle
 * whose fill holds two colours. Pinning is what makes this more than a
 * generator: click a tile, hold it to wall, and every design still on offer is
 * one that works around your decision. That is mixed-initiative generation, and
 * it cost nothing to get, because pinning was already how a designer holds one
 * thing still while the rest moves.
 *
 * The requirements are `want/1` facts at the top of the Rules panel, so the
 * post's progression is a matter of commenting a line in and out. Read those
 * first; everything below them is the post's ASP, modernised from clingo 3, with
 * our predicates for the drawing.
 *
 * Measured before it was written, because the post is about speed: at side 11 an
 * exploration is ~1.8s, and the curve is 9 1.0s, 13 3.1s, 15 5.0s. `want(lakes)`
 * adds a `#maximize`, and optimisation is a different kind of expensive — fine
 * at 9, minutes at 11. The comment on that line says so.
 */

/** Tiles a side. 11 is the size where a re-solve still feels like an edit. */
const SIDE = 11;
const TILE = 28;
const PAD = 20;
/** Where the board starts, under the heading. */
const TOP = 76;
const BOARD = SIDE * TILE;
const TILES = SIDE * SIDE;

/** Everything the document holds: a heading and a caption. The board is a rule. */
function furniture(): SceneNode[] {
	return [
		text("title", "Title", [PAD, 20, BOARD, 26], "Map generation", {
			ink: [ref("ink")],
			size: single("20px"),
			weight: single("700"),
		}),
		text(
			"caption",
			"Caption",
			[PAD, 48, BOARD, 16],
			`${TILES} tiles, one document, no generator.`,
			{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
		),
	];
}

const rules = (over: number) => `${RULES_HEADER}
% ---- the requirements ----
% This is the post's speedrun. Comment a line in or out and watch the whole
% multiverse change: with only "connected" the exit is usually next door, and
% "speedrun" is what makes the level worth walking. Every rule below is guarded
% on one of these, so a requirement that is off is not even grounded.
want(connected).
want(speedrun).
% want(symmetric).   % mirror-image maps, both axes
% want(dense).       % at least three quarters walkable
% want(lakes).       % maximise enclosed pockets, and see the note below

% Tiles a side, and the shortest walk the exit is allowed to be. Raise "side"
% and the board grows; it is the one number worth playing with, and the reason
% the post is called a speedrun is that it gets expensive quickly (9 is ~1s,
% 11 ~1.8s, 13 ~3.1s, 15 ~5.0s).
%
% Not "width": a #const replaces that constant symbol *everywhere*, and this
% program says frame(N,width,V) to place a node. Naming a constant x, y, width
% or height silently rewrites every frame in the document.
#const side=${SIDE}.
#const walk=${SIDE * 2}.
dim(1..side).
start(1,1). finish(side,side).
step(0,-1). step(0,1). step(1,0). step(-1,0).

% ---- the map is a choice, and the choice is a property row ----
% Two alternatives per tile: 1 is wall, 2 is floor. Nothing about this is
% map-specific — it is the same alt/2 a fill with two colours compiles to,
% which is why a tile can be pinned and why the impossible one goes dim.
% The colours follow the document's own tokens, so recolouring "ink" or
% "surface" recolours the dungeon.
alt(prop(t(X,Y),fill),1) :- dim(X), dim(Y).
alt(prop(t(X,Y),fill),2) :- dim(X), dim(Y).
alt_literal(prop(t(X,Y),fill),1,L) :- dim(X), dim(Y), resolved(tok(ink),L).
alt_literal(prop(t(X,Y),fill),2,L) :- dim(X), dim(Y), resolved(tok(surface),L).
solid(X,Y) :- pick(prop(t(X,Y),fill),2).

% ---- what you can walk on has to reach the exit ----
reachable(X,Y) :- start(X,Y), solid(X,Y).
reachable(NX,NY) :- reachable(X,Y), step(DX,DY), NX=X+DX, NY=Y+DY, solid(NX,NY).
complete :- finish(X,Y), reachable(X,Y).
:- want(connected), not complete.

% ---- and it has to be a walk, not a doorstep ----
% at(X,Y,T) is "reachable in T steps". Bounding T at "walk" and then forbidding
% the exit inside that bound is the post's trick for a minimum path length: the
% exit stays reachable (above) but no route gets there in "walk" steps or less.
at(X,Y,0) :- want(speedrun), start(X,Y), solid(X,Y).
at(NX,NY,T+1) :- at(X,Y,T), T<walk, step(DX,DY), NX=X+DX, NY=Y+DY, solid(NX,NY).
:- want(speedrun), finish(X,Y), at(X,Y,_).

% ---- the optional refinements from the post ----
hmis(X,Y) :- solid(X,Y), not solid(side-X+1,Y).
vmis(X,Y) :- solid(X,Y), not solid(X,side-Y+1).
:- want(symmetric), 1 { hmis(X,Y) : dim(X), dim(Y); vmis(X,Y) : dim(X), dim(Y) }.

:- want(dense), #count{ X,Y : solid(X,Y) } < 3*side*side/4.

% A lake is a wall tile walled in on all four sides. The post maximises them to
% stop the generator handing back open fields. This is a weak constraint, so the
% objective shows in the status line rather than ruling designs out — and it is
% the one requirement that changes the *kind* of work the solver does: ranking
% designs, not just admitting them. Measured, because that matters here: fine at
% side 9, minutes at side 11. Turn it on with a small board.
lake(X,Y) :- want(lakes), dim(X), dim(Y), solid(X+DX,Y+DY) : step(DX,DY); not solid(X,Y).
#maximize { 1,X,Y : lake(X,Y) }.

% ---- the drawing ----
% The board and every tile are derived. child/2 is a set, so paint order is
% order/2 and nothing else: the board sits above the ${over} layers the page
% holds, and the tiles above that.
node(board). kind(board,rect). child(page,board).
frame(board,x,${PAD}). frame(board,y,${TOP}).
frame(board,width,W) :- W = side*${TILE}.
frame(board,height,W) :- W = side*${TILE}.
order(board,${over + 1}).
rendered(board,fill,L) :- resolved(tok(muted),L).
rendered(board,radius,"2px").

node(t(X,Y)) :- dim(X), dim(Y).
kind(t(X,Y),rect) :- dim(X), dim(Y).
child(page,t(X,Y)) :- dim(X), dim(Y).
frame(t(X,Y),x,PX) :- dim(X), dim(Y), PX = ${PAD} + (X-1)*${TILE}.
frame(t(X,Y),y,PY) :- dim(X), dim(Y), PY = ${TOP} + (Y-1)*${TILE}.
frame(t(X,Y),width,${TILE}) :- dim(X), dim(Y).
frame(t(X,Y),height,${TILE}) :- dim(X), dim(Y).
order(t(X,Y),I) :- dim(X), dim(Y), I = ${over + 1} + (Y-1)*side + X.
rendered(t(X,Y),radius,"0px") :- dim(X), dim(Y).

% Where you start and where you are going. Both are forced walkable by the
% reachability rules above, so these only have to mark them.
rendered(t(X,Y),stroke,L) :- start(X,Y), resolved(tok(accent),L).
rendered(t(X,Y),stroke,L) :- finish(X,Y), resolved(tok(accent),L).
rendered(t(X,Y),strokeWidth,"3px") :- start(X,Y).
rendered(t(X,Y),strokeWidth,"3px") :- finish(X,Y).
% A pocket the maximise found, outlined so the objective is visible on the
% canvas and not only in the status line. Disjoint from the two above: a lake
% is a wall tile and those two are floor.
rendered(t(X,Y),stroke,L) :- lake(X,Y), resolved(tok(subtle),L).
rendered(t(X,Y),strokeWidth,"2px") :- lake(X,Y).
`;

export function map(): Scene {
	const page = furniture();
	return {
		tokens: starterTokens(),
		nodes: [
			frame(
				"page",
				"Level",
				[0, 0, PAD * 2 + BOARD, TOP + BOARD + PAD],
				{ fill: [ref("surface")] },
				page,
			),
		],
		constraints: [],
		rules: rules(page.length),
	};
}
