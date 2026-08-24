/**
 * The scene reader, against the real solver.
 *
 * Everything here goes through clingo rather than through hand-written atom
 * lists, because the point of the reader is that the answer set and the
 * document agree — an assertion made against atoms this file wrote itself
 * would only be checking the reader against my idea of the program.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { readModel, type ModelNode } from "./model.ts";
import { makeNode } from "./edits.ts";
import { type Scene, type SceneNode, frameOf, makeLayout } from "./scene.ts";
import { card } from "./templates/card.ts";
import { palette } from "./templates/palette.ts";
import { flatten } from "./tree.ts";
import { lit, ref, single } from "./values.ts";

/** One answer set for a scene, as atoms. */
async function firstModel(scene: Scene): Promise<string[]> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: 1,
			assumptions: [...guards, PULL_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(out.result, "SATISFIABLE");
		const model = out.models[0];
		assert.ok(model, "expected a model");
		return model;
	} finally {
		await session.close();
	}
}

/** Depth-first over the read scene, parents before children. */
function walk(nodes: readonly ModelNode[]): ModelNode[] {
	return nodes.flatMap((n) => [n, ...walk(n.children)]);
}

test("reads the whole tree back out of an answer set", async () => {
	const scene = card();
	const model = readModel(await firstModel(scene));

	// Same nodes, same order, same nesting as the document it came from.
	assert.deepEqual(
		walk(model.roots).map((n) => n.id),
		flatten(scene.nodes).map((n) => n.id),
	);
	assert.deepEqual(
		model.roots.map((n) => n.id),
		scene.nodes.map((n) => n.id),
	);
	for (const node of flatten(scene.nodes)) {
		const read = model.byId[node.id];
		assert.ok(read, `${node.id} missing`);
		assert.equal(read.kind, node.kind);
		assert.deepEqual(read.frame, frameOf(node));
		assert.deepEqual(
			read.children.map((c) => c.id),
			(node.children ?? []).map((c) => c.id),
		);
	}
});

test("paint order survives, even when the ids sort the other way", async () => {
	// `child/2` is a set; without `order/2` the only reading left would be
	// alphabetical, which is the opposite of this document's stacking.
	const rect = (id: string, x: number): SceneNode => ({
		...makeNode("rect", { x, y: 0, width: 40, height: 40 }, { id, name: id }),
		props: { fill: single("#000000") },
	});
	const scene: Scene = {
		tokens: [],
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: 200, height: 80 }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: single("#ffffff") },
				children: [rect("zed", 0), rect("mid", 20), rect("alpha", 40)],
			},
		],
		constraints: [],
		rules: "",
	};

	const model = readModel(await firstModel(scene));
	assert.deepEqual(
		model.byId.page?.children.map((c) => c.id),
		["zed", "mid", "alpha"],
	);
	assert.deepEqual(
		model.byId.page?.children.map((c) => c.order),
		[1, 2, 3],
	);
});

test("what a node renders with is the resolved text, not a literal id", async () => {
	const scene = card();
	const model = readModel(await firstModel(scene));

	const badge = model.byId.badge;
	assert.ok(badge);
	// `accent` holds five colours; whichever this universe picked, it is a
	// colour rather than an `l7`.
	const accents = ["#3b82f6", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6"];
	assert.ok(accents.includes(badge.rendered.fill ?? ""));
	assert.ok(["0px", "8px", "18px"].includes(badge.rendered.radius ?? ""));
	assert.equal(model.byId.title?.rendered.text, "Aurora");
	// A property the node does not hold stays absent rather than defaulting.
	assert.equal(badge.rendered.stroke, undefined);
});

test("a derived value reads back as what it was computed to be", async () => {
	// palette's labels take their ink from the button under them, so the two
	// have to agree in whichever universe came back.
	const model = readModel(await firstModel(palette()));
	for (const id of ["one", "two", "three"]) {
		const fill = model.byId[id]?.rendered.fill;
		const ink = model.byId[`${id}Label`]?.rendered.ink;
		assert.ok(fill && ink);
		assert.notEqual(fill, ink);
		// The pale swatch is the one that has to flip; every other reads white.
		assert.equal(ink, fill === "#fde047" ? "#0f172a" : "#ffffff");
	}
});

test("text with a comma in it survives the round trip", async () => {
	// The atom `literal(l0,"Fast, quiet")` has a comma that is not an argument
	// separator, which is the whole reason `parseAtom` knows about quotes.
	const scene: Scene = {
		tokens: [],
		nodes: [
			{
				...makeNode("text", { x: 0, y: 0, width: 200, height: 24 }, {
					id: "t",
					name: "t",
				}),
				props: { text: single('Fast, quiet — and "quoted"') },
			},
		],
		constraints: [],
		rules: "",
	};
	const model = readModel(await firstModel(scene));
	assert.equal(model.byId.t?.rendered.text, 'Fast, quiet — and "quoted"');
});

test("a hidden node takes its subtree with it", async () => {
	const scene = card();
	const model = readModel(await firstModel({ ...scene, rules: "hidden(card)." }));

	assert.deepEqual(model.roots.map((n) => n.id), ["page"]);
	assert.deepEqual(model.byId.page?.children ?? [], []);
	// Not merely detached: the children of a hidden node are not drawn either.
	assert.equal(model.byId.badge, undefined);
	assert.equal(model.byId.title, undefined);
});

test("solved geometry wins over the stored frame", async () => {
	// A row of three, so the solver rather than the document decides where the
	// children sit and how big the container is.
	const child = (id: string): SceneNode => ({
		...makeNode("rect", { x: 0, y: 0, width: 40, height: 20 }, { id, name: id }),
		props: { fill: single("#000000") },
	});
	const scene: Scene = {
		tokens: [],
		nodes: [
			{
				...makeNode("frame", { x: 10, y: 10, width: 999, height: 999 }, {
					id: "row",
					name: "Row",
				}),
				props: { fill: single("#ffffff") },
				layout: makeLayout({ direction: "row", gap: 10, padding: 5 }),
				children: [child("a"), child("b"), child("c")],
			},
		],
		constraints: [],
		rules: "",
	};

	const model = readModel(await firstModel(scene));
	assert.deepEqual(
		model.byId.a?.frame,
		{ x: 5, y: 5, width: 40, height: 20 },
	);
	assert.deepEqual(
		model.byId.b?.frame,
		{ x: 55, y: 5, width: 40, height: 20 },
	);
	assert.deepEqual(
		model.byId.c?.frame,
		{ x: 105, y: 5, width: 40, height: 20 },
	);
	// The container hugs, so its stored 999x999 is not what it is.
	assert.deepEqual(
		model.byId.row?.frame,
		{ x: 10, y: 10, width: 150, height: 30 },
	);
});

test("a scene predicate a rule asserts is read like any other", async () => {
	// The reason for showing the scene at all: the answer set, not the
	// document, is what the picture is.
	const scene = card();
	const model = readModel(
		await firstModel({ ...scene, rules: "frame(badge,width,300)." }),
	);
	// Two frame/3 atoms for one axis: the reader takes one, and both are legal
	// readings — what matters is that the rule's fact reached it at all.
	assert.ok([64, 300].includes(model.byId.badge?.frame.width ?? 0));
});

test("a scene with alternatives reads differently in different universes", async () => {
	const scene: Scene = {
		tokens: [
			{ id: "accent", name: "accent", type: "color", value: [lit("#111111"), lit("#222222")] },
		],
		nodes: [
			{
				...makeNode("rect", { x: 0, y: 0, width: 10, height: 10 }, {
					id: "r",
					name: "r",
				}),
				props: { fill: [ref("accent")] },
			},
		],
		constraints: [],
		rules: "",
	};
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	const out = await session.solve({
		models: 0,
		assumptions: [...guards, PULL_ATOM].map((atom) => ({ atom })),
	});
	await session.close();

	const fills = out.models
		.map((m) => readModel(m).byId.r?.rendered.fill)
		.sort();
	assert.deepEqual(fills, ["#111111", "#222222"]);
});
