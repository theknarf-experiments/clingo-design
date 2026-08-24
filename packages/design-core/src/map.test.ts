/**
 * The map generation template, against the real solver.
 *
 * There is no map generator here to test. What these check is that the
 * blogpost's method survives the translation: that a requirement really does
 * narrow the space, that every design the multiverse offers actually satisfies
 * the requirements that are on, and that a tile is an ordinary variable — so
 * pinning one is authoring part of the level and the rest is still generated
 * around it.
 *
 * @see https://eis-blog.soe.ucsc.edu/2011/10/map-generation-speedrun/
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { renameConstraint, updateConstraint, violRefs } from "./edits.ts";
import { UnsatisfiableError, explore, type Universe } from "./explore.ts";
import type { Scene } from "./scene.ts";
import { findTemplate } from "./templates/index.ts";
import { propVar } from "./values.ts";

const level = () => findTemplate("map")!.create();

const WIDTH = 11;
const tileVar = (x: number, y: number) => propVar(`t(${x},${y})`, "fill");

/**
 * Turn a requirement on or off, which is how the post is walked.
 *
 * The ordinary enable switch, not an edit to the rules: that is the whole
 * conversion — a requirement used to be a `want/1` fact commented in and out.
 */
function want(scene: Scene, name: string, on: boolean): Scene {
	assert.ok(
		scene.constraints.some((c) => c.id === name),
		`${name} is a rule of the document`,
	);
	return updateConstraint(scene, name, { enabled: on });
}

const run = (scene: Scene, limit = 6) =>
	explore(scene, directSolver, { limit, sample: "first" });

/** Which tiles a universe made walkable, as a set of "x,y". */
function floor(universe: Universe): Set<string> {
	const walkable = new Set<string>();
	for (let x = 1; x <= WIDTH; x++) {
		for (let y = 1; y <= WIDTH; y++) {
			// Alternative 2 is floor; the fill it resolves to is `surface`.
			if (universe.pick[tileVar(x, y)] === 2) walkable.add(`${x},${y}`);
		}
	}
	return walkable;
}

/** Shortest walk from the start over `floor`, or null if the exit is cut off. */
function shortestPath(walkable: ReadonlySet<string>): number | null {
	if (!walkable.has("1,1")) return null;
	const goal = `${WIDTH},${WIDTH}`;
	const seen = new Set(["1,1"]);
	let edge = ["1,1"];
	for (let d = 0; edge.length > 0; d++) {
		if (edge.includes(goal)) return d;
		const next: string[] = [];
		for (const cell of edge) {
			const [x, y] = cell.split(",").map(Number);
			for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
				const key = `${x + dx},${y + dy}`;
				if (walkable.has(key) && !seen.has(key)) {
					seen.add(key);
					next.push(key);
				}
			}
		}
		edge = next;
	}
	return null;
}

test("the whole board is derived — the document holds a heading and a caption", () => {
	const scene = level();
	assert.equal(scene.nodes.length, 1, "one page frame");
	assert.deepEqual(
		scene.nodes[0].children?.map((n) => n.id),
		["title", "caption"],
		"the board and all 121 tiles are rules, not nodes",
	);
	// Five requirements, and nothing to them but a name and a switch: what each
	// one *means* is the viol/1 in the rules panel.
	assert.deepEqual(
		scene.constraints.map((c) => c.id),
		["connected", "speedrun", "symmetric", "dense", "all_solid"],
	);
	for (const c of scene.constraints) {
		assert.equal(c.kind, "custom", c.id);
		assert.deepEqual(c.nodes, [], `${c.id} has no members`);
		assert.equal(c.group, undefined, `${c.id} has no group`);
		assert.equal(violRefs(scene.rules, c.id), 1, `${c.id} is written once`);
	}
	assert.deepEqual(
		scene.constraints.filter((c) => c.enabled).map((c) => c.id),
		["connected", "speedrun"],
		"the post's own starting point",
	);
});

test("the board's own constants do not shadow a dimension name", async () => {
	// `#const width=11.` replaces that constant symbol everywhere, and a frame is
	// placed with frame(N,width,V) — so naming the grid "width" rewrote every
	// frame in the document to frame(N,11,V) and the page came out 0 wide. The
	// template says "side" for that reason, and this is the regression.
	const scene = level();
	assert.doesNotMatch(
		scene.rules,
		/^#const\s+(x|y|width|height)\s*=/m,
		"no constant is named after a dimension",
	);
	const { universes } = await run(scene, 1);
	assert.deepEqual(universes[0].model.byId.page?.frame, {
		x: 0,
		y: 0,
		width: 348,
		height: 404,
	});
});

test("every tile is on the canvas and none of them is in the document", async () => {
	const { universes } = await run(level(), 1);
	const model = universes[0].model;
	const ids = Object.keys(model.byId);
	assert.equal(
		ids.filter((id) => id.startsWith("t(")).length,
		WIDTH * WIDTH,
		"121 tiles, all derived",
	);
	assert.ok(model.byId.board, "and the board under them");
});

test("a tile is an ordinary two-alternative variable", async () => {
	const { brave } = await run(level(), 1);
	// Both wall and floor are reachable for a tile in the middle of the board:
	// this is the same reachable-alternative set a fill with two colours has.
	assert.deepEqual([...brave.pick[tileVar(6, 6)]].sort(), [1, 2]);
});

test("the exit is reachable in every design the multiverse offers", async () => {
	const { universes } = await run(level());
	assert.ok(universes.length > 1, "several levels");
	for (const universe of universes) {
		const walk = shortestPath(floor(universe));
		assert.ok(walk !== null, "the exit is walkable to");
	}
});

test("speedrun is what makes the walk long, and it is a real narrowing", async () => {
	const short = await run(want(level(), "speedrun", false));
	const long = await run(level());

	// The requirement is a minimum path length, so every design must exceed it.
	for (const universe of long.universes) {
		const walk = shortestPath(floor(universe));
		assert.ok(
			walk !== null && walk > WIDTH * 2,
			`the walk is longer than ${WIDTH * 2} steps, got ${walk}`,
		);
	}
	// And without it the generator hands back doorsteps: the shortest of the
	// unconstrained designs beats anything the constrained ones can offer.
	const best = Math.min(
		...short.universes.map((u) => shortestPath(floor(u)) ?? Infinity),
	);
	assert.ok(
		best <= WIDTH * 2,
		`an unconstrained design reaches the exit within ${WIDTH * 2} steps, got ${best}`,
	);
});

test("pinning a tile authors part of the level and the rest is generated around it", async () => {
	const scene = level();
	// Hold one tile to wall. This is an assumption, not an edit — the same thing
	// clicking a swatch in a property row does.
	const pinned = await explore(scene, directSolver, {
		limit: 6,
		sample: "first",
		pins: { [tileVar(6, 6)]: 1 },
	});
	assert.ok(pinned.universes.length > 1, "still several levels");
	for (const universe of pinned.universes) {
		assert.equal(universe.pick[tileVar(6, 6)], 1, "the decision holds");
		assert.ok(shortestPath(floor(universe)) !== null, "and they still work");
	}
	// The document is untouched: a pin is not an edit.
	assert.equal(scene.rules, level().rules);
});

test("density is a floor on the walkable count", async () => {
	const dense = await run(want(level(), "dense", true), 3);
	const least = Math.floor((3 * WIDTH * WIDTH) / 4);
	assert.ok(dense.universes.length > 0, "there are designs to check");
	for (const universe of dense.universes) {
		assert.ok(
			floor(universe).size >= least,
			`at least ${least} walkable tiles, got ${floor(universe).size}`,
		);
	}
});

test("symmetric maps mirror on both axes", async () => {
	const scene = want(want(level(), "symmetric", true), "speedrun", false);
	const { universes } = await run(scene, 3);
	assert.ok(universes.length > 0, "there are designs to check");
	for (const universe of universes) {
		const walkable = floor(universe);
		for (const cell of walkable) {
			const [x, y] = cell.split(",").map(Number);
			assert.ok(walkable.has(`${WIDTH - x + 1},${y}`), `${cell} mirrors horizontally`);
			assert.ok(walkable.has(`${x},${WIDTH - y + 1}`), `${cell} mirrors vertically`);
		}
	}
});

test("a requirement that is off emits no switch, so its rules cannot ground", () => {
	// This is the mechanism the template leans on, asserted where it is decidable:
	// a disabled constraint contributes no `constraint/1` fact, so `active(C)` has
	// nothing to derive it from and every rule whose body reads it is discarded at
	// grounding. Timing says the rest; see the file's own measurements.
	const scene = level();
	const { program, guards } = compile(scene);
	assert.deepEqual(guards, ["active(connected)", "active(speedrun)"]);
	assert.ok(program.includes("constraint(speedrun)."));
	assert.ok(!program.includes("constraint(all_solid)."), "off is out of the program");
	// And the rules do read the switch in a body — not only in a viol/1 head,
	// which would be about truth rather than about grounding.
	for (const guarded of ["connected", "speedrun", "symmetric", "all_solid"]) {
		assert.match(scene.rules, new RegExp(`active\\(${guarded}\\)`), guarded);
	}
});

test("all tiles walkable and a long walk cannot both hold, and the core says which", async () => {
	// The demo the kind exists for: two requirements the *designer* wrote, out of
	// five, and the document is impossible. An open board reaches the exit in
	// 2*(WIDTH-1) = 20 steps and the speedrun forbids any route of 22 or fewer.
	const scene = want(level(), "all_solid", true);
	const error = await explore(scene, directSolver, { limit: 4 }).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError, "no design at all");
	// A core is the smallest set clingo *found*, so what is promised is membership
	// and a bound. Measured, this one is exactly the two — and stays two with all
	// five requirements on, which is the sentence the template is here to say.
	assert.ok(error.conflict.includes("speedrun"), error.conflict.join());
	assert.ok(error.conflict.includes("all_solid"), error.conflict.join());
	assert.ok(error.conflict.length <= 2, error.conflict.join());

	const everything = level().constraints.reduce(
		(s, c) => want(s, c.id, true),
		level(),
	);
	const worst = await explore(everything, directSolver, { limit: 4 }).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(worst instanceof UnsatisfiableError);
	assert.deepEqual([...worst.conflict].sort(), ["all_solid", "speedrun"]);
});

test("all tiles walkable is a legal requirement on its own", async () => {
	// Which is what makes the pair a *contradiction* rather than one bad rule:
	// switch the speedrun off and the open field is the one design there is.
	const scene = want(want(level(), "all_solid", true), "speedrun", false);
	const { universes, total } = await run(scene, 4);
	assert.equal(total, 1, "exactly one open board");
	assert.equal(floor(universes[0]).size, WIDTH * WIDTH, "every tile walkable");
	assert.equal(shortestPath(floor(universes[0])), 2 * (WIDTH - 1));
});

test("the requirements really are guarded, so an unused one is not grounded", async () => {
	// `lakes` carries a #maximize, and optimisation is expensive enough that the
	// template ships with it off. The guard is what makes that free rather than
	// merely unused: with want(lakes) absent there is no objective at all.
	const { costs, universes } = await run(level(), 1);
	assert.deepEqual(costs ?? [], [], "no objective while lakes is off");
	assert.equal(universes.length, 1, "and the board still draws");
});

test("a weak constraint whose condition grounds away still yields designs", async () => {
	// The template's #maximize is unconditional but `lake/2` is guarded, so with
	// lakes off the objective ranges over nothing. `isOptimizing` reads the
	// program text and cannot know that, and asking clingo for optima when there
	// is nothing to rank returns satisfiable-with-no-models. That used to reach
	// the canvas as an empty scene; this is the regression on it.
	const scene = level();
	assert.match(scene.rules, /^#maximize/m, "the objective is in the program");
	assert.match(scene.rules, /^% want\(lakes\)\./m, "and it ranges over nothing");

	const { universes, optimized } = await run(scene, 4);
	assert.ok(universes.length > 1, "designs, not a blank canvas");
	assert.equal(optimized, false, "and the space is reported as unranked");
});

test("renaming a requirement carries its guard, not only its condition", async () => {
	// The failure this is here to prevent is silent, and worse than the orphaned
	// `viol` the rename already handled: leave `active(speedrun)` behind and the
	// rules under it never ground, so the requirement is not broken but vacuously
	// satisfied — a generator that quietly stopped generating what was asked for.
	const renamed = renameConstraint(level(), "speedrun", "long_walk");
	assert.equal(renamed.rewritten, 2, "the head and the guard");
	assert.doesNotMatch(renamed.scene.rules, /(viol|active)\(speedrun\)/);
	// The prose still says "speedrun", deliberately: a whole-token substitution
	// across arbitrary ASP would rewrite a predicate that happened to share the
	// name, and an out-of-date comment is the cheaper mistake.
	assert.ok(renamed.scene.rules.includes("post's speedrun"));
	assert.deepEqual(compile(renamed.scene).guards, [
		"active(connected)",
		"active(long_walk)",
	]);
	// And it still does what it did, under the new name.
	for (const universe of (await run(renamed.scene)).universes) {
		const walk = shortestPath(floor(universe));
		assert.ok(walk !== null && walk > WIDTH * 2, `still a long walk, got ${walk}`);
	}
});
