/**
 * Geometric constraints — the kinds that talk about where a node is rather
 * than what colour it is.
 *
 * Every case goes through the real solver, because the whole claim is that
 * simplex answers the system exactly: an assertion on a rounded number would
 * pass just as well against arithmetic done in TypeScript.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import type { Frame } from "./geometry.ts";
import {
	addConstraint,
	addNode,
	addNodeTo,
	deleteNodes,
	makeNode,
	retargetConstraint,
	updateConstraint,
} from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import { type Scene, emptyScene } from "./scene.ts";
import { lit } from "./values.ts";

const empty = (): Scene => ({ ...emptyScene(), nodes: [] });

const solve = async (scene: Scene) => {
	const result = await explore(scene, directSolver, { sample: "first" });
	assert.equal(result.count, 1, "geometry must not multiply the universes");
	assert.equal(result.optimized, false, "a theory objective is not #minimize");
	return result.universes[0].solved;
};

const fails = async (scene: Scene): Promise<UnsatisfiableError> => {
	const error = await explore(scene, directSolver).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError, "expected no design at all");
	return error;
};

type Solved = Readonly<Record<string, Partial<Frame>>>;

/**
 * Edges, read back out of the answer rather than assumed from the document —
 * every one of these four quantities is the solver's to decide.
 */
const right = (s: Solved, id: string) => (s[id].x ?? 0) + (s[id].width ?? 0);
const bottom = (s: Solved, id: string) => (s[id].y ?? 0) + (s[id].height ?? 0);
const cx = (s: Solved, id: string) => (s[id].x ?? 0) + (s[id].width ?? 0) / 2;
const cy = (s: Solved, id: string) => (s[id].y ?? 0) + (s[id].height ?? 0) / 2;

/**
 * Total distance the design moved.
 *
 * Two nodes asked to meet cost the same however the shift is divided between
 * them, so simplex may return any point on that face and asserting one of them
 * would be asserting an arbitrary vertex. What is not arbitrary is the total:
 * the objective is minimised, so this is exactly the least the design could
 * have moved. Where a single answer is wanted the tests pin one side.
 */
function shifted(
	solved: Solved,
	from: Record<string, number>,
	axis: "x" | "width" = "x",
): number {
	return Object.entries(from).reduce(
		(sum, [id, was]) => sum + Math.abs((solved[id]?.[axis] ?? 0) - was),
		0,
	);
}

/** Loose rects on the canvas, at deliberately un-round places. */
function loose(...boxes: Array<[string, number, number, number, number]>): Scene {
	let scene = empty();
	for (const [id, x, y, width, height] of boxes) {
		scene = addNode(scene, makeNode("rect", { x, y, width, height }, { id }));
	}
	return scene;
}

/* ------------------------------------------------------------------ */
/* align                                                               */
/* ------------------------------------------------------------------ */

test("align brings the named edge of every member together", async () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 100, 60, 80, 20]);
	const solved = await solve(
		addConstraint(scene, "align", ["a", "b"], undefined, "left").scene,
	);
	assert.equal(solved.a.x, solved.b.x, "the left edges meet");
	assert.equal(shifted(solved, { a: 0, b: 100 }), 100, "and only just");
	assert.equal(solved.a.y, 0, "the other axis was never mentioned");
	assert.equal(solved.b.y, 60);
});

test("aligning centres accounts for the members' different sizes", async () => {
	// a is 40 wide and b is 80, so an aligned centre is a different shift for
	// each of them — which is the whole difference between a centre and an edge.
	// Pinning a settles which of the two gives way.
	let scene = loose(["a", 0, 0, 40, 20], ["b", 100, 0, 80, 20]);
	scene = addConstraint(scene, "pin", ["a"], undefined, "left").scene;
	const solved = await solve(
		addConstraint(scene, "align", ["a", "b"], undefined, "centerX").scene,
	);
	assert.equal(solved.a.x, 0, "pinned");
	assert.equal(solved.b.x, -20, "80 wide, so its centre reaches 20 from -20");
	assert.equal(cx(solved, "a"), cx(solved, "b"));
});

test("align works across parents, on world coordinates", async () => {
	// 30 into a card at 0 and 10 into a card at 500 are comparable numbers only
	// once both are read on the canvas.
	let scene = empty();
	for (const [id, x] of [["left", 0], ["right", 500]] as const) {
		scene = addNode(
			scene,
			makeNode("frame", { x, y: 0, width: 300, height: 200 }, { id }),
		);
	}
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
	// p stays where it is, so q's answer is the only one there is.
	scene = addConstraint(scene, "pin", ["p"], undefined, "left").scene;
	const solved = await solve(
		addConstraint(scene, "align", ["p", "q"], undefined, "left").scene,
	);
	assert.equal(solved.p.x, 30);
	assert.equal(
		solved.q.x,
		-470,
		"canvas x 30, expressed inside a card that starts at 500",
	);
});

test("align ranges over more than two", async () => {
	const scene = loose(
		["a", 0, 0, 10, 10],
		["b", 30, 0, 10, 10],
		["c", 60, 0, 10, 10],
	);
	const solved = await solve(
		addConstraint(scene, "align", ["a", "b", "c"], undefined, "left").scene,
	);
	assert.equal(solved.a.x, 30);
	assert.equal(solved.b.x, 30);
	assert.equal(solved.c.x, 30);
});

/* ------------------------------------------------------------------ */
/* gap                                                                 */
/* ------------------------------------------------------------------ */

test("gap is measured edge to edge", async () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 400, 0, 60, 20]);
	const added = addConstraint(scene, "gap", ["a", "b"], undefined, "x");
	const solved = await solve(updateConstraint(added.scene, added.id, { value: 24 }));
	assert.equal(
		(solved.b.x ?? 0) - right(solved, "a"),
		24,
		"a's right edge to b's left edge",
	);
	// Nothing overshot: whatever share of the 336 each end gave up, both moved
	// toward the other rather than past it.
	assert.ok((solved.a.x ?? 0) >= 0 && (solved.a.x ?? 0) <= 400);
	assert.ok((solved.b.x ?? 0) >= 0 && (solved.b.x ?? 0) <= 400);
});

test("which member is the near side is the order they were named in", async () => {
	// The same pair, named the other way round: b now leads, so a has to end up
	// past it rather than before it. Both sizes are pinned, because a gap can
	// also be closed by making a box smaller and that costs the objective just
	// as much as moving it — with the widths settled there is one answer.
	let scene = loose(["a", 0, 0, 40, 20], ["b", 400, 0, 60, 20]);
	scene = addConstraint(scene, "pin", ["a"], undefined, "width").scene;
	scene = addConstraint(scene, "pin", ["b"], undefined, "width").scene;

	const forward = addConstraint(scene, "gap", ["a", "b"], undefined, "x");
	const ahead = await solve(updateConstraint(forward.scene, forward.id, { value: 10 }));
	assert.equal((ahead.b.x ?? 0) - right(ahead, "a"), 10);

	const backward = addConstraint(scene, "gap", ["b", "a"], undefined, "x");
	const behind = await solve(updateConstraint(backward.scene, backward.id, { value: 10 }));
	assert.equal(
		(behind.a.x ?? 0) - right(behind, "b"),
		10,
		"b's right edge to a's left edge now",
	);
	assert.ok((behind.a.x ?? 0) > (behind.b.x ?? 0), "a ended up past b");
});

test("a fresh gap measures what is already there and changes nothing", async () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 400, 0, 60, 20]);
	const { scene: constrained, id } = addConstraint(scene, "gap", ["a", "b"], undefined, "x");
	assert.equal(
		constrained.constraints.find((c) => c.id === id)?.value,
		360,
		"400 less a's right edge at 40",
	);
	const solved = await solve(constrained);
	assert.equal(solved.a.x, 0);
	assert.equal(solved.b.x, 400);
});

test("a vertical gap is the same rule down the other axis", async () => {
	const scene = loose(["a", 0, 0, 20, 30], ["b", 0, 200, 20, 30]);
	const added = addConstraint(scene, "gap", ["a", "b"], undefined, "y");
	const solved = await solve(updateConstraint(added.scene, added.id, { value: 10 }));
	assert.equal((solved.b.y ?? 0) - bottom(solved, "a"), 10);
	assert.equal(solved.a.x, 0, "the horizontal axis was not touched");
});

test("a negative gap is an overlap, not a swap", async () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 100, 0, 40, 20]);
	const added = addConstraint(scene, "gap", ["a", "b"], undefined, "x");
	const solved = await solve(updateConstraint(added.scene, added.id, { value: -10 }));
	assert.equal((solved.b.x ?? 0) - right(solved, "a"), -10);
});

/* ------------------------------------------------------------------ */
/* equalSize                                                           */
/* ------------------------------------------------------------------ */

test("equalSize settles on one width without moving anything", async () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 300, 0, 100, 60]);
	const solved = await solve(
		addConstraint(scene, "equalSize", ["a", "b"], undefined, "width").scene,
	);
	assert.equal(solved.a.width, solved.b.width, "one width between them");
	assert.equal(shifted(solved, { a: 40, b: 100 }, "width"), 60, "and only just");
	assert.equal(solved.a.height, 20, "the other span was never mentioned");
	assert.equal(solved.b.height, 60);
	assert.equal(solved.a.x, 0, "resizing is not moving");
	assert.equal(solved.b.x, 300);
});

test("equalSize on heights ranges over three", async () => {
	const scene = loose(
		["a", 0, 0, 10, 30],
		["b", 0, 100, 10, 60],
		["c", 0, 200, 10, 90],
	);
	const solved = await solve(
		addConstraint(scene, "equalSize", ["a", "b", "c"], undefined, "height").scene,
	);
	assert.equal(solved.a.height, 60);
	assert.equal(solved.b.height, 60);
	assert.equal(solved.c.height, 60);
});

/* ------------------------------------------------------------------ */
/* symmetric                                                           */
/* ------------------------------------------------------------------ */

test("symmetric about a third node balances the two around its centre", async () => {
	// The middle box's centre is 150. a's centre is 20 and b's is 320, so the
	// pair is already balanced — moving the far one in has to move the near one
	// out by as much.
	let scene = loose(
		["a", 0, 0, 40, 20],
		["b", 300, 0, 40, 20],
		["mid", 100, 0, 100, 20],
	);
	// Pin the mirror so the answer is unique rather than a whole family.
	scene = addConstraint(scene, "pin", ["mid"], undefined, "centerX").scene;
	const added = addConstraint(scene, "symmetric", ["a", "b", "mid"], undefined, "x");
	// Then insist a sits somewhere new, and watch b follow.
	const pinned = addConstraint(added.scene, "pin", ["a"], undefined, "centerX");
	const solved = await solve(
		updateConstraint(pinned.scene, pinned.id, { value: 50 }),
	);
	assert.equal(cx(solved, "a"), 50);
	assert.equal(cx(solved, "b"), 250, "as far past 150 as a is short of it");
	assert.equal(cx(solved, "mid"), 150, "the mirror stayed put");
});

test("symmetric about a line needs no third node", async () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 300, 0, 60, 20]);
	const added = addConstraint(scene, "symmetric", ["a", "b"], undefined, "x");
	// Seeded at the line already between them: 20 and 330 average to 175.
	assert.equal(
		added.scene.constraints.find((c) => c.id === added.id)?.value,
		175,
	);
	const solved = await solve(updateConstraint(added.scene, added.id, { value: 100 }));
	const centreA = cx(solved, "a");
	const centreB = cx(solved, "b");
	assert.equal(centreA + centreB, 200, "equidistant either side of 100");
	assert.equal(100 - centreA, centreB - 100);
});

test("a mirror down the y axis reflects vertically", async () => {
	const scene = loose(["a", 0, 0, 20, 40], ["b", 0, 300, 20, 40]);
	const added = addConstraint(scene, "symmetric", ["a", "b"], undefined, "y");
	const solved = await solve(updateConstraint(added.scene, added.id, { value: 50 }));
	assert.equal(cy(solved, "a") + cy(solved, "b"), 100);
	assert.equal(solved.a.x, 0, "the horizontal axis is nobody's business here");
});

/* ------------------------------------------------------------------ */
/* pin                                                                 */
/* ------------------------------------------------------------------ */

test("pin fixes one coordinate outright", async () => {
	const scene = loose(["a", 0, 0, 40, 20]);
	const added = addConstraint(scene, "pin", ["a"], undefined, "left");
	const solved = await solve(updateConstraint(added.scene, added.id, { value: 250 }));
	assert.equal(solved.a.x, 250);
	assert.equal(solved.a.y, 0);
	assert.equal(solved.a.width, 40);
});

test("pin reaches a size and a centre as readily as an edge", async () => {
	const scene = loose(["a", 0, 0, 40, 20]);
	const wide = addConstraint(scene, "pin", ["a"], undefined, "width");
	assert.equal(
		(await solve(updateConstraint(wide.scene, wide.id, { value: 300 }))).a.width,
		300,
	);
	const centred = addConstraint(scene, "pin", ["a"], undefined, "centerY");
	const solved = await solve(updateConstraint(centred.scene, centred.id, { value: 60 }));
	assert.equal(cy(solved, "a"), 60);
});

test("a pin on a child is a canvas coordinate, not a parent-relative one", async () => {
	let scene = addNode(
		empty(),
		makeNode("frame", { x: 100, y: 50, width: 400, height: 300 }, { id: "card" }),
	);
	scene = addNodeTo(
		scene,
		"card",
		makeNode("rect", { x: 120, y: 60, width: 40, height: 20 }, { id: "kid" }),
	);
	const added = addConstraint(scene, "pin", ["kid"], undefined, "left");
	assert.equal(
		added.scene.constraints.find((c) => c.id === added.id)?.value,
		120,
		"seeded from where it sits on the canvas",
	);
	const solved = await solve(updateConstraint(added.scene, added.id, { value: 200 }));
	assert.equal(solved.kid.x, 100, "200 on the canvas is 100 inside a card at 100");
});

/* ------------------------------------------------------------------ */
/* Conflicts                                                           */
/* ------------------------------------------------------------------ */

test("two pins on one quantity come back as a core naming both", async () => {
	const scene = loose(["a", 0, 0, 40, 20], ["b", 300, 0, 40, 20]);
	const first = addConstraint(scene, "pin", ["a"], undefined, "left");
	const one = updateConstraint(first.scene, first.id, { value: 0 });
	const second = addConstraint(one, "pin", ["a"], undefined, "left");
	const both = updateConstraint(second.scene, second.id, { value: 100 });
	// A third rule that is perfectly satisfiable must not be blamed.
	const innocent = addConstraint(both, "equalSize", ["a", "b"], undefined, "width");

	const error = await fails(innocent.scene);
	assert.deepEqual(
		[...error.conflict].sort(),
		[first.id, second.id].sort(),
		"only the two that actually contradict each other",
	);
});

test("an alignment and a gap that cannot both hold name each other", async () => {
	// Left edges together *and* a 10px gap between them would need a box of
	// width -10. The non-negative size bound is what turns that from a silly
	// answer into a conflict the solver can attribute.
	const scene = loose(["a", 0, 0, 40, 20], ["b", 300, 0, 40, 20]);
	const aligned = addConstraint(scene, "align", ["a", "b"], undefined, "left");
	const gapped = addConstraint(aligned.scene, "gap", ["a", "b"], undefined, "x");
	const scene2 = updateConstraint(gapped.scene, gapped.id, { value: 10 });

	const error = await fails(scene2);
	assert.deepEqual([...error.conflict].sort(), [aligned.id, gapped.id].sort());
});

test("a geometric rule and a property rule are attributed separately", async () => {
	// The geometric conflict is real; the colour rule is fine and stays unnamed.
	const scene = loose(["a", 0, 0, 40, 20], ["b", 300, 0, 40, 20]);
	const first = addConstraint(scene, "pin", ["a"], undefined, "width");
	const one = updateConstraint(first.scene, first.id, { value: 10 });
	const second = addConstraint(one, "pin", ["a"], undefined, "width");
	const both = updateConstraint(second.scene, second.id, { value: 20 });
	const colours = addConstraint(both, "match", ["a", "b"], "fill");

	const error = await fails(colours.scene);
	assert.deepEqual([...error.conflict].sort(), [first.id, second.id].sort());
});

test("switching a geometric rule off takes it out of the program", async () => {
	const scene = loose(["a", 0, 0, 40, 20]);
	const added = addConstraint(scene, "pin", ["a"], undefined, "left");
	const moved = updateConstraint(added.scene, added.id, { value: 250 });
	assert.equal((await solve(moved)).a.x, 250);
	const off = updateConstraint(moved, added.id, { enabled: false });
	assert.deepEqual(await solve(off), {}, "nothing is handed to the solver at all");
});

/* ------------------------------------------------------------------ */
/* Housekeeping                                                        */
/* ------------------------------------------------------------------ */

test("a geometric constraint takes only as many members as it can use", () => {
	const scene = loose(["a", 0, 0, 10, 10], ["b", 0, 0, 10, 10], ["c", 0, 0, 10, 10]);
	const gap = addConstraint(scene, "gap", ["a", "b", "c"]);
	assert.deepEqual(gap.scene.constraints[0].nodes, ["a", "b"]);
	const pin = addConstraint(scene, "pin", ["a", "b", "c"]);
	assert.deepEqual(pin.scene.constraints[0].nodes, ["a"]);
	const align = addConstraint(scene, "align", ["a", "b", "c"]);
	assert.deepEqual(align.scene.constraints[0].nodes, ["a", "b", "c"]);
});

test("changing what a rule is about re-seeds the fields the new kind reads", () => {
	const scene = loose(["a", 10, 0, 40, 20], ["b", 200, 0, 40, 20]);
	const { scene: withMatch, id } = addConstraint(scene, "match", ["a", "b"], "fill");

	// A colour rule turned into a pin has no edge and no value yet; defaulting
	// them silently would slam the node to zero.
	const pinned = retargetConstraint(withMatch, id, { kind: "pin" });
	const pin = pinned.constraints[0];
	assert.equal(pin.kind, "pin");
	assert.deepEqual(pin.nodes, ["a"], "a pin has one subject");
	assert.equal(pin.edge, "left");
	assert.equal(pin.value, 10, "where a's left edge already is");

	// And a change of axis re-measures: 24px of horizontal gap says nothing
	// about a vertical one.
	const { scene: withGap, id: gapId } = addConstraint(scene, "gap", ["a", "b"], undefined, "x");
	assert.equal(withGap.constraints[0].value, 150, "200 less a's right edge at 50");
	const vertical = retargetConstraint(withGap, gapId, { edge: "y" });
	assert.equal(vertical.constraints[0].edge, "y");
	assert.equal(vertical.constraints[0].value, -20, "b's top is 20 below a's bottom");
});

test("deleting a node drops the geometric constraints that named it", () => {
	const scene = loose(["a", 0, 0, 10, 10], ["b", 0, 0, 10, 10], ["c", 0, 0, 10, 10]);
	const pinned = addConstraint(scene, "pin", ["a"]).scene;
	assert.equal(deleteNodes(pinned, ["a"]).constraints.length, 0);

	// A gap needs both sides; an align survives on the two members left.
	const gapped = addConstraint(scene, "gap", ["a", "b"]).scene;
	assert.equal(deleteNodes(gapped, ["b"]).constraints.length, 0);
	const aligned = addConstraint(scene, "align", ["a", "b", "c"]).scene;
	assert.deepEqual(deleteNodes(aligned, ["c"]).constraints[0].nodes, ["a", "b"]);
});

test("a geometric constraint does not multiply the universes it is drawn in", async () => {
	let scene = loose(["a", 0, 0, 40, 20], ["b", 300, 0, 40, 20]);
	scene = {
		...scene,
		nodes: scene.nodes.map((n) => ({
			...n,
			props: { ...n.props, fill: [lit("#ff0000"), lit("#00ff00")] },
		})),
	};
	const { scene: constrained } = addConstraint(scene, "align", ["a", "b"], undefined, "left");
	const result = await explore(constrained, directSolver, { sample: "first" });
	assert.equal(result.count, 4, "two fills each, and nothing crossed with them");
	const places = new Set<string>();
	for (const universe of result.universes) {
		assert.equal(universe.solved.a.x, universe.solved.b.x);
		places.add(`${universe.solved.a.x}`);
	}
	assert.equal(places.size, 1, "every universe places them the same way");
});
