/**
 * Nodes a rule brings into being, against the real solver.
 *
 * Every assertion here goes through clingo, because the whole claim is about
 * the *program*: that `node/1` is derivable, that what a derived node does not
 * say defaults rather than going missing, and that the reader then hands the
 * studio a scene it can list, select and refuse to drag.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, SCENERY_ATOM, compile } from "./compile.ts";
import { derivedAt, derivedNodes, documentIds, paintedOver } from "./derived.ts";
import { directSolver } from "./directSolver.ts";
import { makeNode } from "./edits.ts";
import { readModel } from "./model.ts";
import type { Scene } from "./scene.ts";
import { lit } from "./values.ts";

/** A document of one white frame, plus whatever rules the test is about. */
function board(rules: string): Scene {
	return {
		styles: [],
		tokens: [],
		constraints: [],
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: 300, height: 300 }, {
					id: "board",
					name: "Board",
				}),
				props: { fill: [lit("#ffffff")] },
				children: [],
			},
		],
		rules,
	};
}

/** Every answer set of a scene, as atom lists. */
async function models(scene: Scene, limit = 1): Promise<string[][]> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: limit,
			assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(out.result, "SATISFIABLE");
		return out.models;
	} finally {
		await session.close();
	}
}

const GRID = `
pos(1..3).
node(cell(R,C)) :- pos(R), pos(C).
kind(cell(R,C),rect) :- pos(R), pos(C).
child(board,cell(R,C)) :- pos(R), pos(C).
frame(cell(R,C),x,X) :- pos(R), pos(C), X = 20 + (C-1)*70.
frame(cell(R,C),y,Y) :- pos(R), pos(C), Y = 20 + (R-1)*70.
frame(cell(R,C),width,50) :- pos(R), pos(C).
frame(cell(R,C),height,50) :- pos(R), pos(C).
rendered(cell(R,C),fill,"#38bdf8") :- pos(R), pos(C).
`;

test("a rule puts nodes on the canvas that the document does not hold", async () => {
	const scene = board(GRID);
	const model = readModel((await models(scene))[0]);

	// The document's own frame is still the only root; the cells hang from it.
	assert.deepEqual(
		model.roots.map((n) => n.id),
		["board"],
	);
	const derived = derivedNodes(model, documentIds(scene));
	assert.equal(derived.length, 9);
	assert.deepEqual(
		derived.map((d) => d.node.id),
		[
			"cell(1,1)", "cell(1,2)", "cell(1,3)",
			"cell(2,1)", "cell(2,2)", "cell(2,3)",
			"cell(3,1)", "cell(3,2)", "cell(3,3)",
		],
	);
	// Read as one whole node: kind, place and paint all from the answer set.
	const middle = derived.find((d) => d.node.id === "cell(2,2)");
	assert.ok(middle);
	assert.equal(middle.node.kind, "rect");
	assert.equal(middle.parent, "board");
	assert.deepEqual(middle.world, { x: 90, y: 90, width: 50, height: 50 });
	assert.equal(middle.node.rendered.fill, "#38bdf8");
});

test("a derived node only has to say it exists", async () => {
	const model = readModel(
		(await models(board("node(ghost). child(board,ghost).")))[0],
	);
	const ghost = model.byId.ghost;
	assert.ok(ghost, "a node with nothing else said still draws");
	// The defaults, each in a rule rather than in the reader.
	assert.equal(ghost.kind, "frame");
	assert.equal(ghost.order, 1);
	assert.deepEqual(ghost.frame, { x: 0, y: 0, width: 0, height: 0 });
});

test("the defaults do not unsay what a rule actually stated", async () => {
	const model = readModel(
		(
			await models(
				board(`
node(a). kind(a,text). order(a,4). frame(a,x,12). frame(a,width,80).
child(board,a).
node(b). kind(b,frame). order(b,1). frame(b,y,0).
child(board,b).
`),
			)
		)[0],
	);
	// An explicit value wins, including where it happens to *be* the default —
	// `kind(b,frame)` and `frame(b,y,0)` must not knock their own rule out.
	assert.equal(model.byId.a?.kind, "text");
	assert.equal(model.byId.a?.order, 4);
	assert.deepEqual(model.byId.a?.frame, { x: 12, y: 0, width: 80, height: 0 });
	assert.equal(model.byId.b?.kind, "frame");
	assert.equal(model.byId.b?.order, 1);
});

test("order decides which derived node paints on top", async () => {
	const model = readModel(
		(
			await models(
				board(`
node(under). node(over).
child(board,under). child(board,over).
order(under,1). order(over,2).
`),
			)
		)[0],
	);
	assert.deepEqual(
		model.byId.board?.children.map((c) => c.id),
		["under", "over"],
	);
});

test("a derived node can be handed to the solver, and lands on its default frame", async () => {
	const atoms = (
		await models(
			board(`
node(pinned). kind(pinned,rect). child(board,pinned).
frame(pinned,width,40). frame(pinned,height,40).
gsolved(pinned).
&sum{ lv(pinned,x) } >= 100.
`),
		)
	)[0];
	const model = readModel(atoms);
	const pinned = model.byId["pinned"];
	assert.ok(pinned);
	// The pull is toward the frame the defaults gave it, so simplex stops at
	// the boundary rather than anywhere else legal. Without a default frame
	// there would be nothing to pull toward and the answer would be arbitrary.
	assert.equal(pinned.frame.x, 100);
	assert.equal(pinned.frame.y, 0);
});

test("solved geometry reads back for a node whose id is a term", async () => {
	const atoms = (
		await models(
			board(`
pos(1..2).
node(cell(I)) :- pos(I).
kind(cell(I),rect) :- pos(I).
child(board,cell(I)) :- pos(I).
frame(cell(I),width,30) :- pos(I).
frame(cell(I),height,30) :- pos(I).
gsolved(cell(I)) :- pos(I).
&sum{ lv(cell(1),x) } = 10.
&sum{ lv(cell(2),x); -lv(cell(1),x) } = 50.
`),
		)
	)[0];
	// `lv(cell(2),x)` holds a comma that is not an argument separator; the
	// reader has to parse the term rather than match it.
	const model = readModel(atoms);
	assert.equal(model.byId["cell(1)"]?.frame.x, 10);
	assert.equal(model.byId["cell(2)"]?.frame.x, 60);
});

test("hidden works on a derived node, and makes universes differ in structure", async () => {
	const scene = board(`
pos(1..3).
node(cell(I)) :- pos(I).
kind(cell(I),rect) :- pos(I).
child(board,cell(I)) :- pos(I).
frame(cell(I),width,30) :- pos(I).
frame(cell(I),height,30) :- pos(I).
{ sparse }.
hidden(cell(2)) :- sparse.
`);
	const answers = await models(scene, 4);
	// visible/1 is projected, so the two readings really are two designs.
	assert.equal(answers.length, 2);
	const counts = answers
		.map((atoms) => derivedNodes(readModel(atoms), documentIds(scene)).length)
		.sort();
	assert.deepEqual(counts, [2, 3]);
});

test("a rendered literal may be spelled out rather than interned", async () => {
	const model = readModel(
		(
			await models(
				board(`
node(a). kind(a,text). child(board,a).
rendered(a,text,"Fast, quiet").
rendered(a,ink,"#0f172a").
`),
			)
		)[0],
	);
	// A comma inside the quotes is not an argument separator, and a quoted
	// term is never a literal id, so there is nothing to look up.
	assert.equal(model.byId.a?.rendered.text, "Fast, quiet");
	assert.equal(model.byId.a?.rendered.ink, "#0f172a");
});

test("the canvas can find a derived node under the pointer", async () => {
	const scene = board(GRID);
	const model = readModel((await models(scene))[0]);
	const derived = derivedNodes(model, documentIds(scene));

	assert.equal(derivedAt(derived, { x: 100, y: 100 })?.node.id, "cell(2,2)");
	// Between two cells is the frame's own ground, which the document owns.
	assert.equal(derivedAt(derived, { x: 80, y: 80 }), null);
	// The document node the pointer would otherwise have hit is the one the
	// cell hangs from, so the cell is drawn over it and wins.
	assert.equal(paintedOver(model, "cell(2,2)", "board"), true);
	assert.equal(paintedOver(model, "board", "cell(2,2)"), false);
	// Two derived siblings: later in the paint order is on top.
	assert.equal(paintedOver(model, "cell(3,3)", "cell(1,1)"), true);
	assert.equal(paintedOver(model, "cell(1,1)", "cell(3,3)"), false);
	assert.equal(paintedOver(model, "cell(1,1)", "cell(1,1)"), false);
	assert.equal(paintedOver(model, "cell(1,1)", "nobody"), false);
});

test("a derived node over a document node that is not its parent still wins", async () => {
	// The case that used to be unreachable: something the document holds sits
	// between the frame and the cells, and the pointer lands on *it*. Paint
	// order is what settles it, and the cells are painted last.
	const scene = board(`
${GRID}
order(cell(R,C),I) :- pos(R), pos(C), I = 10 + (R-1)*3 + C.
`);
	scene.nodes[0].children = [
		{
			...makeNode("rect", { x: 0, y: 0, width: 300, height: 300 }, {
				id: "sheet",
				name: "Sheet",
			}),
			props: { fill: [lit("#f1f5f9")] },
		},
	];
	const model = readModel((await models(scene))[0]);
	const derived = derivedNodes(model, documentIds(scene));
	assert.equal(derivedAt(derived, { x: 100, y: 100 })?.node.id, "cell(2,2)");
	// `sheet` covers the whole frame, so it is what the document's own hit test
	// answers — and the cell is still what the eye sees.
	assert.equal(paintedOver(model, "cell(2,2)", "sheet"), true);
	assert.equal(paintedOver(model, "sheet", "cell(2,2)"), false);
});
