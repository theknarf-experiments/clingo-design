import { frame, text } from "./shared.ts";
import {
	RULES_HEADER,
	starterTokens,
	type Constraint,
	type Scene,
	type SceneNode,
} from "../scene.ts";
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
 * The requirements are the document's five rules, and every one of them is a
 * rule *written here*: a `custom` constraint derives no `viol/1` of its own, so
 * the ASP in the panel is the violation condition and the checkbox in the Rules
 * panel is the post's progression. They were `want/1` facts you commented in and
 * out, which is what a hand-written requirement had to be before a rule you wrote
 * could have a switch.
 *
 * What that buys, beyond not editing text to change your mind: `all_solid` and
 * `speedrun` cannot both hold — a fully open board walks to the exit in
 * 2*(side-1) steps and the speedrun demands more than 2*side — and turning both
 * on names *those two, out of five*, both of them rules the designer wrote. That
 * is the whole claim of the kind, on a document where the rules are the feature.
 *
 * The guard is read in a *body*, which is the part worth knowing. A switched-off
 * constraint emits no `constraint/1` fact at all, so `active(speedrun)` cannot be
 * derived, so a rule whose body says it never grounds — the same freeness the
 * `want/1` facts had, from the switch instead of from an edit. Measured at side
 * 11, exploring: 2.89s with the speedrun on and 2.15s with it off, where the
 * `want/1` facts this replaced were 2.80s and 2.16s. The switch costs nothing,
 * and turning a requirement off still refunds what it cost.
 *
 * Measured before it was written, because the post is about speed: on the machine
 * that recorded 9 1.0s, 11 1.8s, 13 3.1s, 15 5.0s, this document now reads 1.76s,
 * 2.79s, 4.53s and 7.12s — the curve moved with the machine and not with the
 * conversion, which is what the paired numbers above are for.
 *
 * `lakes` is the one requirement that is still a `want/1` line, on purpose: it is
 * a `#maximize` rather than a prohibition, so there is no `viol/1` for a switch
 * to guard, and optimisation is a different kind of expensive — fine at side 9,
 * minutes at 11. A checkbox that costs minutes is a worse control than a
 * commented line with the reason next to it.
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
			`${TILES} tiles, five requirements, no generator.`,
			{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
		),
	];
}

const rules = (over: number) => `${RULES_HEADER}
% ---- the requirements ----
% This is the post's speedrun, and the five requirements are the five rules in
% the Rules panel — tick one and watch the whole multiverse change. With only
% "connected" the exit is usually next door; "speedrun" is what makes the level
% worth walking; "all_solid" contradicts it outright, and turning both on names
% those two in the conflict and leaves the other three alone.
%
% Each is a "Custom rule": the document holds its name and its switch, and the
% violation condition is the viol/1 below. Reading its own switch in a *body* is
% what keeps an unused requirement free — a rule that is off emits no
% constraint/1 fact, so active(...) cannot be derived and nothing under it
% grounds. That is not about truth, which ":- viol(C), active(C)" already
% settles; it is about what the grounder has to build.

% Tiles a side, and the shortest walk the exit is allowed to be. Raise "side"
% and the board grows; it is the one number worth playing with, and the reason
% the post is called a speedrun is that it gets expensive quickly — measured, an
% exploration is ~1.8s at 9, ~2.8s at 11, ~4.5s at 13 and ~7.1s at 15.
%
% Not "width": a #const replaces that constant symbol *everywhere*, and this
% program says frame(N,width,V) to place a node. Naming a constant x, y, width
% or height silently rewrites every frame in the document — and so does naming
% one "emupx", which is the pixel the generated program declares and which every
% coordinate below is multiplied by.
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
reachable(X,Y) :- active(connected), start(X,Y), solid(X,Y).
reachable(NX,NY) :- reachable(X,Y), step(DX,DY), NX=X+DX, NY=Y+DY, solid(NX,NY).
complete :- finish(X,Y), reachable(X,Y).
viol(connected) :- not complete.

% ---- and it has to be a walk, not a doorstep ----
% at(X,Y,T) is "reachable in T steps". Bounding T at "walk" and then forbidding
% the exit inside that bound is the post's trick for a minimum path length: the
% exit stays reachable (above) but no route gets there in "walk" steps or less.
at(X,Y,0) :- active(speedrun), start(X,Y), solid(X,Y).
at(NX,NY,T+1) :- at(X,Y,T), T<walk, step(DX,DY), NX=X+DX, NY=Y+DY, solid(NX,NY).
viol(speedrun) :- finish(X,Y), at(X,Y,_).

% ---- the optional refinements from the post ----
hmis(X,Y) :- active(symmetric), solid(X,Y), not solid(side-X+1,Y).
vmis(X,Y) :- active(symmetric), solid(X,Y), not solid(X,side-Y+1).
viol(symmetric) :- 1 { hmis(X,Y) : dim(X), dim(Y); vmis(X,Y) : dim(X), dim(Y) }.

viol(dense) :- active(dense), #count{ X,Y : solid(X,Y) } < 3*side*side/4.

% ---- the requirement that cannot hold with the speedrun ----
% "solid" is the post's word for a tile you can walk on, so this is "every tile
% walkable" — an open field, which is the thing the rest of the post is trying
% to avoid. It is here because it is *impossible* alongside the speedrun: an
% open board reaches the exit in 2*(side-1) steps and the speedrun forbids any
% route of "walk" = 2*side or fewer. Turn both on and the document has no
% design, and the two rules named in the conflict are these two.
viol(all_solid) :- active(all_solid), dim(X), dim(Y), not solid(X,Y).

% ---- the sixth requirement, which is not a rule you can switch ----
% A lake is a wall tile walled in on all four sides. The post maximises them to
% stop the generator handing back open fields. This is a weak constraint, so the
% objective shows in the status line rather than ruling designs out — which is
% also why it is the one requirement still spelled as a fact you comment in:
% there is no viol/1 here for a switch to guard, because nothing is ever
% violated, only ranked. And ranking is a different kind of work: measured, fine
% at side 9 and minutes at side 11. Turn it on with a small board.
% want(lakes).
% Says the absence is deliberate. Without it clingo remarks that want/1 occurs
% in no rule head — correctly, since the only fact is commented out — and the
% panel would greet every new map with a warning about the one line that is
% *meant* to be off. This is the idiom for a predicate that may legitimately
% have no facts, and the generated program above uses it for the same reason.
#defined want/1.
lake(X,Y) :- want(lakes), dim(X), dim(Y), solid(X+DX,Y+DY) : step(DX,DY); not solid(X,Y).
#maximize { 1,X,Y : lake(X,Y) }.

% ---- the drawing ----
% The board and every tile are derived. child/2 is a set, so paint order is
% order/2 and nothing else: the board sits above the ${over} layers the page
% holds, and the tiles above that.
%
% frame/3 is in EMU, so the pixel counts below are multiplied by "emupx" — a
% #const the generated program declares, which gringo folds while grounding.
% Writing ${TILE}*emupx keeps the number the one a person chose.
node(board). kind(board,rect). child(page,board).
frame(board,x,${PAD}*emupx). frame(board,y,${TOP}*emupx).
frame(board,width,W) :- W = side*${TILE}*emupx.
frame(board,height,W) :- W = side*${TILE}*emupx.
order(board,${over + 1}).
rendered(board,fill,L) :- resolved(tok(muted),L).
rendered(board,radius,"2px").

node(t(X,Y)) :- dim(X), dim(Y).
kind(t(X,Y),rect) :- dim(X), dim(Y).
child(page,t(X,Y)) :- dim(X), dim(Y).
frame(t(X,Y),x,PX) :- dim(X), dim(Y), PX = (${PAD} + (X-1)*${TILE})*emupx.
frame(t(X,Y),y,PY) :- dim(X), dim(Y), PY = (${TOP} + (Y-1)*${TILE})*emupx.
frame(t(X,Y),width,${TILE}*emupx) :- dim(X), dim(Y).
frame(t(X,Y),height,${TILE}*emupx) :- dim(X), dim(Y).
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

/**
 * The post's requirements, as rules the document holds.
 *
 * Nothing but a name and a switch: the kind derives no `viol/1`, so the ASP in
 * the panel is the whole of what each one means. The two that ship on are the
 * post's own starting point; `all_solid` is off because it contradicts the
 * speedrun, and it is in the list *because* it does.
 */
function requirements(): Constraint[] {
	const on = ["connected", "speedrun"];
	return ["connected", "speedrun", "symmetric", "dense", "all_solid"].map((id) => ({
		id,
		kind: "custom" as const,
		// Meaningless to a rule with no members, and kept only so that switching
		// this row to a colour rule has a property to remember.
		prop: "fill" as const,
		nodes: [],
		enabled: on.includes(id),
	}));
}

export function map(): Scene {
	const page = furniture();
	return {
		tokens: starterTokens(),
		styles: [],
		machines: [],
		nodes: [
			frame(
				"page",
				"Level",
				[0, 0, PAD * 2 + BOARD, TOP + BOARD + PAD],
				{ fill: [ref("surface")] },
				page,
			),
		],
		constraints: requirements(),
		rules: rules(page.length),
	};
}
