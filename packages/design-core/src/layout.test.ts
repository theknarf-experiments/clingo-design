import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { addNode, addNodeTo, makeNode, reparent } from "./edits.ts";
import { explore } from "./explore.ts";
import { type AutoLayout, type Scene, emptyScene } from "./scene.ts";
import { findInTree, mapTree } from "./tree.ts";

/** A frame of the given size with `n` children, laid out. */
function row(
	layout: Partial<AutoLayout>,
	container: { width: number; height: number },
	children: Array<{ id: string; width: number; height: number; grow?: boolean }>,
): Scene {
	let scene = emptyScene();
	scene = { ...scene, nodes: [] };
	scene = addNode(
		scene,
		makeNode(
			"frame",
			{ x: 0, y: 0, width: container.width, height: container.height },
			{ id: "box" },
		),
	);
	for (const child of children) {
		scene = addNodeTo(
			scene,
			"box",
			makeNode(
				"rect",
				{ x: 0, y: 0, width: child.width, height: child.height },
				{ id: child.id },
			),
		);
	}
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) => {
			if (n.id === "box") {
				return {
					...n,
					layout: {
						direction: "row",
						gap: 10,
						padding: 10,
						align: "start",
						// These cases pin the container size on purpose; hugging
						// has its own tests below.
						sizing: "fixed",
						...layout,
					} as AutoLayout,
				};
			}
			const spec = children.find((c) => c.id === n.id);
			return spec?.grow ? { ...n, grow: true } : n;
		}),
	};
}

const solve = async (scene: Scene) => {
	const result = await explore(scene, directSolver, { sample: "first" });
	assert.equal(result.count, 1, "layout must not multiply the universes");
	return result.universes[0].solved;
};

test("children are laid end to end from the padding", async () => {
	const solved = await solve(
		row({}, { width: 400, height: 100 }, [
			{ id: "a", width: 100, height: 40 },
			{ id: "b", width: 60, height: 40 },
		]),
	);
	assert.equal(solved.a.x, 10);
	assert.equal(solved.a.width, 100);
	assert.equal(solved.b.x, 120, "10 padding + 100 wide + 10 gap");
	assert.equal(solved.b.width, 60);
});

test("growers divide whatever is left over", async () => {
	const solved = await solve(
		row({ gap: 20, padding: 10 }, { width: 600, height: 100 }, [
			{ id: "a", width: 200, height: 40 },
			{ id: "b", width: 10, height: 40, grow: true },
			{ id: "c", width: 10, height: 40, grow: true },
		]),
	);
	// 600 - 2*10 padding - 2*20 gaps = 540 for the children; a keeps 200.
	assert.equal(solved.a.width, 200);
	assert.equal(solved.b.width, 170);
	assert.equal(solved.c.width, 170);
	assert.equal(solved.a.x, 10);
	assert.equal(solved.b.x, 230);
	assert.equal(solved.c.x, 420);
});

test("a share that does not divide evenly stays exact", async () => {
	const solved = await solve(
		row({ gap: 0, padding: 0 }, { width: 100, height: 50 }, [
			{ id: "a", width: 1, height: 10, grow: true },
			{ id: "b", width: 1, height: 10, grow: true },
			{ id: "c", width: 1, height: 10, grow: true },
		]),
	);
	// 100/3 each — the reason positions are floats rather than integers.
	assert.ok(Math.abs((solved.a.width ?? 0) - 100 / 3) < 1e-9);
	assert.ok(Math.abs((solved.c.x ?? 0) - 200 / 3) < 1e-9);
});

test("a column stacks on the other axis", async () => {
	const solved = await solve(
		row({ direction: "column", gap: 8, padding: 4 }, { width: 200, height: 300 }, [
			{ id: "a", width: 50, height: 30 },
			{ id: "b", width: 50, height: 70 },
		]),
	);
	assert.equal(solved.a.y, 4);
	assert.equal(solved.a.height, 30);
	assert.equal(solved.b.y, 42, "4 padding + 30 tall + 8 gap");
	assert.equal(solved.b.height, 70);
	// The cross axis is x in a column.
	assert.equal(solved.a.x, 4);
});

test("stretch fills the cross axis, centre splits the remainder", async () => {
	const stretched = await solve(
		row({ align: "stretch", padding: 10 }, { width: 400, height: 120 }, [
			{ id: "a", width: 100, height: 30 },
		]),
	);
	assert.equal(stretched.a.height, 100, "120 less 2 x 10 padding");
	assert.equal(stretched.a.y, 10);

	const centred = await solve(
		row({ align: "center", padding: 10 }, { width: 400, height: 120 }, [
			{ id: "a", width: 100, height: 30 },
		]),
	);
	assert.equal(centred.a.height, 30, "centring keeps the size it asked for");
	assert.equal(centred.a.y, 45, "(120 - 30) / 2");
});

test("a container without a layout solves nothing", async () => {
	let scene = emptyScene();
	scene = addNodeTo(
		scene,
		"frame1",
		makeNode("rect", { x: 5, y: 7, width: 20, height: 20 }, { id: "free" }),
	);
	const solved = await solve(scene);
	assert.deepEqual(solved, {}, "hand-placed nodes keep their own frames");
});

/* ------------------------------------------------------------------ */
/* Hugging                                                             */
/* ------------------------------------------------------------------ */

test("a hugging container takes its size from its contents", async () => {
	// Two 140x60 children stacked vertically before wrapping — their bounds say
	// nothing about what a row of them needs, which is the whole reason the
	// container cannot keep a stored size.
	const solved = await solve(
		row({ sizing: "hug", gap: 16, padding: 16 }, { width: 172, height: 188 }, [
			{ id: "a", width: 140, height: 60 },
			{ id: "b", width: 140, height: 60 },
		]),
	);
	assert.equal(solved.box.width, 328, "16 + 140 + 16 + 140 + 16");
	assert.equal(solved.box.height, 92, "16 + 60 + 16");
	assert.equal(solved.a.x, 16);
	assert.equal(solved.b.x, 172);
});

test("hugging follows the tallest child, not the first", async () => {
	const solved = await solve(
		row({ sizing: "hug", gap: 10, padding: 10 }, { width: 10, height: 10 }, [
			{ id: "a", width: 40, height: 30 },
			{ id: "b", width: 40, height: 90 },
		]),
	);
	assert.equal(solved.box.height, 110, "90 plus 2 x 10");
	assert.equal(solved.box.width, 110, "40 + 10 + 40 + 2 x 10");
});

test("a column hugs the other way round", async () => {
	const solved = await solve(
		row(
			{ sizing: "hug", direction: "column", gap: 8, padding: 4 },
			{ width: 10, height: 10 },
			[
				{ id: "a", width: 50, height: 30 },
				{ id: "b", width: 90, height: 70 },
			],
		),
	);
	assert.equal(solved.box.height, 116, "4 + 30 + 8 + 70 + 4");
	assert.equal(solved.box.width, 98, "widest child plus 2 x 4");
});

test("growing in a hugging container is just the size asked for", async () => {
	// There is no leftover space to divide when the container is defined by
	// its contents, so a grower must not be left unconstrained.
	const solved = await solve(
		row({ sizing: "hug", gap: 0, padding: 0 }, { width: 500, height: 100 }, [
			{ id: "a", width: 40, height: 20 },
			{ id: "b", width: 60, height: 20, grow: true },
		]),
	);
	assert.equal(solved.b.width, 60);
	assert.equal(solved.box.width, 100);
});

test("stretch inside a hugging container gives every child the tallest height", async () => {
	const solved = await solve(
		row({ sizing: "hug", align: "stretch", gap: 0, padding: 0 }, { width: 9, height: 9 }, [
			{ id: "a", width: 40, height: 25 },
			{ id: "b", width: 40, height: 75 },
		]),
	);
	assert.equal(solved.box.height, 75);
	assert.equal(solved.a.height, 75, "stretched up to the container");
	assert.equal(solved.b.height, 75);
});

test("a hugging container nested in another composes", async () => {
	// The inner container is in the outer's sum as a solved size rather than a
	// stored one, so the outer ends up exactly wide enough for it.
	let scene = emptyScene();
	scene = { ...scene, nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "outer" }),
	);
	scene = addNodeTo(
		scene,
		"outer",
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "inner" }),
	);
	scene = addNodeTo(
		scene,
		"inner",
		makeNode("rect", { x: 0, y: 0, width: 50, height: 20 }, { id: "leaf" }),
	);
	const hug: AutoLayout = {
		direction: "row",
		gap: 0,
		padding: 10,
		align: "start",
		sizing: "hug",
	};
	scene = {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === "outer" || n.id === "inner" ? { ...n, layout: hug } : n,
		),
	};
	const solved = await solve(scene);
	assert.equal(solved.inner.width, 70, "50 plus the inner padding");
	assert.equal(solved.outer.width, 90, "70 plus the outer padding");
});

/* ------------------------------------------------------------------ */
/* Moving in and out of a layout                                       */
/* ------------------------------------------------------------------ */

/** A hugging row at (100,100) holding two children, plus one loose rect. */
async function withLayout() {
	let scene = emptyScene();
	scene = { ...scene, nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 100, y: 100, width: 10, height: 10 }, { id: "box" }),
	);
	for (const id of ["a", "b"]) {
		scene = addNodeTo(
			scene,
			"box",
			makeNode("rect", { x: 0, y: 0, width: 40, height: 20 }, { id }),
		);
	}
	scene = addNode(
		scene,
		makeNode("rect", { x: 500, y: 300, width: 30, height: 30 }, { id: "loose" }),
	);
	scene = {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === "box"
				? {
						...n,
						layout: {
							direction: "row",
							gap: 10,
							padding: 10,
							align: "start",
							sizing: "hug",
						} as AutoLayout,
					}
				: n,
		),
	};
	return { scene, solved: await solve(scene) };
}

test("leaving a layout keeps the node where the solver had put it", async () => {
	const { scene, solved } = await withLayout();
	// b sits at x=60 inside a container at x=100, so its canvas x is 160.
	assert.equal(solved.b.x, 60);

	const moved = reparent(scene, "b", null, 2, solved);
	const b = findInTree(moved.nodes, "b");
	assert.deepEqual(
		b?.frame,
		{ x: 160, y: 110, width: 40, height: 20 },
		"snapshotted in canvas coordinates, not the stale stored frame",
	);
	// And the container closes up around the one child that is left.
	const after = await solve(moved);
	assert.equal(after.box.width, 60, "10 + 40 + 10");
});

test("joining a layout hands its position over to the container", async () => {
	const { scene, solved } = await withLayout();
	const moved = reparent(scene, "loose", "box", 2, solved);

	// The stored frame is rebased into the container, but what it will *be* is
	// the layout's business.
	const loose = findInTree(moved.nodes, "loose");
	assert.deepEqual(loose?.frame, { x: 400, y: 200, width: 30, height: 30 });

	const after = await solve(moved);
	assert.equal(after.loose.x, 110, "third in the row: 10 + 40 + 10 + 40 + 10");
	assert.equal(after.loose.y, 10, "the padding, not where it used to be");
	assert.equal(after.box.width, 150, "the container grew to take it");
});

test("dropping at an index decides where in the arrangement it lands", async () => {
	const { scene, solved } = await withLayout();
	const first = await solve(reparent(scene, "loose", "box", 0, solved));
	assert.equal(first.loose.x, 10, "inserted before both");
	assert.equal(first.a.x, 50);
});

test("a node cannot be moved inside itself", async () => {
	const { scene, solved } = await withLayout();
	assert.equal(reparent(scene, "box", "a", 0, solved), scene);
	assert.equal(reparent(scene, "box", "box", 0, solved), scene);
});

test("only a container can take children", async () => {
	const { scene, solved } = await withLayout();
	assert.equal(reparent(scene, "loose", "a", 0, solved), scene);
});
