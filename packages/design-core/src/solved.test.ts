/**
 * Geometry the solver decides rather than the document.
 *
 * Nothing in the UI opts a node in yet, so these drive it the way the power
 * panel would: a hand-written `gsolved(N).` plus whatever relation is being
 * tested. When a geometric constraint kind arrives it asserts the same atom.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { addNode, addNodeTo, makeNode } from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import { type AutoLayout, type Scene, emptyScene } from "./scene.ts";
import { mapTree } from "./tree.ts";
import { lit } from "./values.ts";

const empty = (): Scene => ({ ...emptyScene(), nodes: [] });

const rules = (scene: Scene, text: string): Scene => ({ ...scene, rules: text });

const run = async (scene: Scene) => {
	const result = await explore(scene, directSolver, { sample: "first" });
	assert.equal(result.count, 1, "solved geometry must not multiply universes");
	assert.equal(result.optimized, false, "a theory objective is not #minimize");
	return result.universes[0].solved;
};

/** One rect on the canvas at a deliberately un-round place. */
function loose(): Scene {
	return addNode(
		empty(),
		makeNode("rect", { x: 120, y: 40, width: 60, height: 30 }, { id: "box" }),
	);
}

/**
 * A frame at (100,50) holding a rect at (20,10) *inside* it — `addNodeTo`
 * takes canvas coordinates and rebases them.
 */
function nested(): Scene {
	let scene = addNode(
		empty(),
		makeNode("frame", { x: 100, y: 50, width: 400, height: 300 }, { id: "card" }),
	);
	scene = addNodeTo(
		scene,
		"card",
		makeNode("rect", { x: 120, y: 60, width: 40, height: 20 }, { id: "kid" }),
	);
	return scene;
}

test("the geometry rules are inert until a node opts in", async () => {
	assert.deepEqual(await run(loose()), {});
});

test("a solved node with nothing said about it keeps its stored frame", async () => {
	const solved = await run(rules(loose(), "gsolved(box)."));
	assert.deepEqual(solved.box, { x: 120, y: 40, width: 60, height: 30 });
});

test("a solved node moves as little as the relation allows", async () => {
	const pushed = await run(
		rules(loose(), "gsolved(box).\n&sum{ wv(box,x) } >= 300."),
	);
	assert.equal(pushed.box.x, 300, "the nearest legal x, not an arbitrary one");
	assert.equal(pushed.box.y, 40, "the axis nobody mentioned did not move");
	assert.equal(pushed.box.width, 60);

	// ...and the same from the other side, so this is not a lower bound the
	// simplex solver happened to sit on.
	const pulled = await run(
		rules(loose(), "gsolved(box).\n&sum{ wv(box,x) } <= 50."),
	);
	assert.equal(pulled.box.x, 50);
});

test("the pull is on every unknown, size included", async () => {
	const solved = await run(
		rules(loose(), "gsolved(box).\n&sum{ lsz(box,width) } >= 200."),
	);
	assert.equal(solved.box.width, 200);
	assert.equal(solved.box.height, 30, "unmentioned, so unchanged");
	assert.equal(solved.box.x, 120, "widening is not moving");
});

test("displacement is shared, so the cheapest side of a relation gives way", async () => {
	// Two rects 400 apart, asked to sit 100 apart. Moving either satisfies it,
	// and the sum of the movements is the same wherever the pair ends up — but
	// pinning one end makes the answer unique, and it is the other that moves.
	let scene = addNode(
		empty(),
		makeNode("rect", { x: 0, y: 0, width: 20, height: 20 }, { id: "a" }),
	);
	scene = addNode(
		scene,
		makeNode("rect", { x: 400, y: 0, width: 20, height: 20 }, { id: "b" }),
	);
	const solved = await run(
		rules(
			scene,
			`gsolved(a). gsolved(b).
&sum{ wv(b,x); -wv(a,x) } = 100.
&sum{ wv(a,x) } = 0.`,
		),
	);
	assert.equal(solved.a.x, 0);
	assert.equal(solved.b.x, 100);
});

/* ------------------------------------------------------------------ */
/* World coordinates                                                   */
/* ------------------------------------------------------------------ */

test("a world coordinate is the parent's plus the node's own offset", async () => {
	// The parent stays a fact, so its 100 enters the sum as a number.
	const solved = await run(
		rules(nested(), "gsolved(kid).\n&sum{ wv(kid,x) } = 200."),
	);
	assert.equal(solved.kid.x, 100, "200 on the canvas is 100 inside a card at 100");
	assert.equal(solved.kid.y, 10, "still parent-relative, still untouched");
	assert.deepEqual(solved.card, undefined, "the parent was never handed over");
});

test("a solved root's world coordinate is its own frame", async () => {
	const solved = await run(
		rules(loose(), "gsolved(box).\n&sum{ wv(box,x); -wv(box,x) } = 0."),
	);
	assert.equal(solved.box.x, 120);
});

test("nodes under different parents can be compared", async () => {
	// Two cards far apart, one child each: the whole point of world
	// coordinates is that 30 inside one and 10 inside the other are
	// comparable numbers at all.
	let scene = empty();
	for (const [id, x] of [
		["left", 0],
		["right", 500],
	] as const) {
		scene = addNode(
			scene,
			makeNode("frame", { x, y: 0, width: 300, height: 200 }, { id }),
		);
	}
	// 30 into the near card, 10 into the far one.
	scene = addNodeTo(
		scene,
		"left",
		makeNode("rect", { x: 30, y: 0, width: 20, height: 20 }, { id: "p" }),
	);
	scene = addNodeTo(
		scene,
		"right",
		makeNode("rect", { x: 510, y: 0, width: 20, height: 20 }, { id: "q" }),
	);
	const solved = await run(
		rules(
			scene,
			`gsolved(p). gsolved(q).
&sum{ wv(q,x); -wv(p,x) } = 0.
&sum{ wv(p,x) } = 30.`,
		),
	);
	assert.equal(solved.p.x, 30, "where it already was");
	assert.equal(
		solved.q.x,
		-470,
		"30 on the canvas, from inside a card that starts at 500",
	);
});

/* ------------------------------------------------------------------ */
/* One namespace with automatic layout                                 */
/* ------------------------------------------------------------------ */

/** A fixed 400-wide row at (100,50) with two children. */
function laidOut(): Scene {
	let scene = addNode(
		empty(),
		makeNode("frame", { x: 100, y: 50, width: 400, height: 100 }, { id: "row" }),
	);
	for (const [id, width] of [
		["a", 100],
		["b", 60],
	] as const) {
		scene = addNodeTo(
			scene,
			"row",
			makeNode("rect", { x: 0, y: 0, width, height: 40 }, { id }),
		);
	}
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === "row"
				? {
						...n,
						layout: {
							direction: "row",
							gap: 10,
							padding: 10,
							align: "start",
							justify: "start",
							sizing: "fixed",
						} as AutoLayout,
					}
				: n,
		),
	};
}

test("a laid-out child that is also solved is one set of equations", async () => {
	// b's stored x is 0 and the pull is toward it, but the layout has the last
	// word: the two share `lv(b,x)` rather than each getting their own.
	const solved = await run(rules(laidOut(), "gsolved(b)."));
	assert.equal(solved.b.x, 120, "10 padding + 100 wide + 10 gap");
	assert.equal(solved.a.x, 10);
});

test("a laid-out child's world coordinate is the row's plus the layout's", async () => {
	// The row starts at 100 and the layout puts b at 120 inside it, so 220 is
	// the only canvas position b has — asking for it holds, and asking for a
	// pixel either side does not.
	const solved = await run(rules(laidOut(), "gsolved(b).\n&sum{ wv(b,x) } = 220."));
	assert.equal(solved.b.x, 120);
	await assert.rejects(
		run(rules(laidOut(), "gsolved(b).\n&sum{ wv(b,x) } = 221.")),
		UnsatisfiableError,
	);
});

test("a layout and a geometric demand that disagree are a real contradiction", async () => {
	// Nothing papers over this: the layout fixes lv(a,x) at the padding and the
	// rule wants it elsewhere, so there is no answer rather than a compromise.
	await assert.rejects(
		run(rules(laidOut(), "gsolved(a).\n&sum{ lv(a,x) } = 999.")),
		UnsatisfiableError,
	);
});

/* ------------------------------------------------------------------ */
/* The multiverse                                                      */
/* ------------------------------------------------------------------ */

test("solved coordinates do not multiply the universes", async () => {
	const scene = rules(loose(), "gsolved(box).\n&sum{ wv(box,x) } >= 300.");
	const varying: Scene = {
		...scene,
		nodes: mapTree(scene.nodes, (n) => ({
			...n,
			props: { ...n.props, fill: [lit("#ff0000"), lit("#00ff00")] },
		})),
	};
	const result = await explore(varying, directSolver, { sample: "first" });
	assert.equal(result.count, 2, "the two fills, and nothing crossed with them");
	assert.equal(result.optimized, false);
	for (const universe of result.universes) {
		assert.equal(universe.solved.box.x, 300, "every universe places it the same");
	}
});
