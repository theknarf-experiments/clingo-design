import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { addNode, addNodeTo, makeNode } from "./edits.ts";
import { explore } from "./explore.ts";
import { type AutoLayout, type Scene, emptyScene } from "./scene.ts";
import { mapTree } from "./tree.ts";

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
						...layout,
					},
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
