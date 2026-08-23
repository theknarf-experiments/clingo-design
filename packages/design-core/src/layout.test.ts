import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { addNode, addNodeTo, makeNode, reparent } from "./edits.ts";
import { explore } from "./explore.ts";
import {
	type ContainerProp,
	type Scene,
	emptyScene,
	makeLayout,
} from "./scene.ts";
import { single } from "./values.ts";

import { dropTargetAt, findInTree, mapTree } from "./tree.ts";

/** A layout in plain words and numbers — the tests fix one arrangement. */
type LayoutSpec = Partial<Record<ContainerProp, string | number>>;

interface Child {
	id: string;
	width: number;
	height: number;
	grow?: boolean;
	alignSelf?: string;
}

/** A frame of the given size with `n` children, laid out. */
function row(
	layout: LayoutSpec,
	container: { width: number; height: number },
	children: Child[],
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
					layout: makeLayout({
						gap: 10,
						padding: 10,
						// These cases pin the container size on purpose; hugging
						// has its own tests below.
						sizing: "fixed",
						...layout,
					}),
				};
			}
			const spec = children.find((c) => c.id === n.id);
			if (!spec) return n;
			return {
				...n,
				...(spec.grow ? { grow: single("grow") } : {}),
				...(spec.alignSelf ? { alignSelf: single(spec.alignSelf) } : {}),
			};
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
/* Justification                                                       */
/* ------------------------------------------------------------------ */

/** 400 wide, padding 10, gap 10, two children of 100 and 60: 210 to spare. */
const spare = (justify: string) =>
	solve(
		row({ justify }, { width: 400, height: 100 }, [
			{ id: "a", width: 100, height: 40 },
			{ id: "b", width: 60, height: 40 },
		]),
	);

test("start leaves the slack at the end", async () => {
	const solved = await spare("start");
	assert.equal(solved.a.x, 10);
	assert.equal(solved.b.x, 120);
});

test("centre splits the slack either side of the run", async () => {
	const solved = await spare("center");
	assert.equal(solved.a.x, 115, "10 + 210/2");
	assert.equal(solved.b.x, 225);
	assert.equal(
		400 - (solved.b.x ?? 0) - 60,
		solved.a.x,
		"as much space after the run as before it",
	);
});

test("end pushes the run against the far padding", async () => {
	const solved = await spare("end");
	assert.equal(solved.a.x, 220);
	assert.equal(solved.b.x, 330, "220 + 100 + 10");
	assert.equal(330 + 60, 390, "flush against the padding");
});

test("space between spreads the slack into the gaps", async () => {
	const solved = await solve(
		row({ justify: "spaceBetween" }, { width: 400, height: 100 }, [
			{ id: "a", width: 100, height: 40 },
			{ id: "b", width: 60, height: 40 },
			{ id: "c", width: 40, height: 40 },
		]),
	);
	// 400 - 20 padding - 200 of children = 180, over two gaps.
	assert.equal(solved.a.x, 10);
	assert.equal(solved.b.x, 200, "10 + 100 + 90");
	assert.equal(solved.c.x, 350, "200 + 60 + 90");
	assert.equal((solved.c.x ?? 0) + 40, 390, "the last one ends flush");
});

test("space between with one child is just a child at the padding", async () => {
	const solved = await solve(
		row({ justify: "spaceBetween" }, { width: 400, height: 100 }, [
			{ id: "a", width: 100, height: 40 },
		]),
	);
	assert.equal(solved.a.x, 10, "nothing to spread it against");
	assert.equal(solved.a.width, 100);
});

test("justification is nothing to argue about when growers took the slack", async () => {
	// There is no leftover once something has filled it, so every mode has to
	// agree with start rather than fight the grower for the same pixels.
	for (const justify of ["start", "center", "end", "spaceBetween"] as const) {
		const solved = await solve(
			row({ justify }, { width: 400, height: 100 }, [
				{ id: "a", width: 100, height: 40 },
				{ id: "b", width: 10, height: 40, grow: true },
			]),
		);
		assert.equal(solved.a.x, 10, justify);
		assert.equal(solved.b.x, 120, justify);
		assert.equal(solved.b.width, 270, `${justify}: 400 - 20 pad - 10 gap - 100`);
	}
});

test("a hugging container has no slack to justify, in any mode", async () => {
	for (const justify of ["start", "center", "end", "spaceBetween"] as const) {
		const solved = await solve(
			row({ justify, sizing: "hug" }, { width: 400, height: 100 }, [
				{ id: "a", width: 100, height: 40 },
				{ id: "b", width: 60, height: 40 },
			]),
		);
		assert.equal(solved.box.width, 190, justify);
		assert.equal(solved.a.x, 10, justify);
		assert.equal(solved.b.x, 120, justify);
	}
});

test("a column justifies down its own axis", async () => {
	const solved = await solve(
		row(
			{ direction: "column", justify: "end", gap: 10, padding: 10 },
			{ width: 200, height: 300 },
			[
				{ id: "a", width: 50, height: 30 },
				{ id: "b", width: 50, height: 70 },
			],
		),
	);
	assert.equal(solved.b.y, 220, "300 - 10 - 70");
	assert.equal(solved.a.y, 180);
	assert.equal(solved.a.x, 10, "the cross axis is untouched");
});

/* ------------------------------------------------------------------ */
/* Per-child alignment                                                 */
/* ------------------------------------------------------------------ */

test("a child can overrule the container's alignment for itself", async () => {
	const solved = await solve(
		row({ align: "start", padding: 10 }, { width: 400, height: 120 }, [
			{ id: "a", width: 40, height: 30 },
			{ id: "b", width: 40, height: 30, alignSelf: "center" },
			{ id: "c", width: 40, height: 30, alignSelf: "end" },
			{ id: "d", width: 40, height: 30, alignSelf: "stretch" },
		]),
	);
	assert.equal(solved.a.y, 10, "following the container");
	assert.equal(solved.b.y, 45, "(120 - 30) / 2");
	assert.equal(solved.c.y, 80, "120 - 10 - 30");
	assert.equal(solved.d.y, 10);
	assert.equal(solved.d.height, 100, "stretched, alone among them");
	assert.equal(solved.a.height, 30);
});

test("an override can also opt out of a stretching container", async () => {
	const solved = await solve(
		row({ align: "stretch", padding: 10 }, { width: 400, height: 120 }, [
			{ id: "a", width: 40, height: 30 },
			{ id: "b", width: 40, height: 30, alignSelf: "start" },
		]),
	);
	assert.equal(solved.a.height, 100);
	assert.equal(solved.b.height, 30, "kept the size it asked for");
	assert.equal(solved.b.y, 10);
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
	const hug = makeLayout({ gap: 0, padding: 10 });
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

/**
 * A hugging row holding one rect and one hugging column, whose stored frame is
 * deliberately nothing like what it will hug to.
 */
function nested(outer: LayoutSpec): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 9, height: 9 }, { id: "outer" }),
	);
	scene = addNodeTo(
		scene,
		"outer",
		makeNode("rect", { x: 0, y: 0, width: 40, height: 20 }, { id: "a" }),
	);
	scene = addNodeTo(
		scene,
		"outer",
		makeNode("frame", { x: 0, y: 0, width: 10, height: 10 }, { id: "inner" }),
	);
	for (const id of ["p", "q"]) {
		scene = addNodeTo(
			scene,
			"inner",
			makeNode("rect", { x: 0, y: 0, width: 30, height: 25 }, { id }),
		);
	}
	const base: LayoutSpec = { gap: 0, padding: 10 };
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) => {
			if (n.id === "outer") return { ...n, layout: makeLayout({ ...base, ...outer }) };
			if (n.id === "inner") {
				return {
					...n,
					layout: makeLayout({ ...base, direction: "column", padding: 5 }),
				};
			}
			return n;
		}),
	};
}

test("hugging across the axis follows what a nested hug comes to, not its frame", async () => {
	const solved = await solve(nested({}));
	assert.equal(solved.inner.height, 60, "5 + 25 + 25 + 5");
	assert.equal(solved.inner.width, 40, "30 plus 2 x 5");
	assert.equal(
		solved.outer.height,
		80,
		"the taller child is the inner container at 60, not its stored 10",
	);
	assert.equal(solved.outer.width, 100, "10 + 40 + 40 + 10");
});

test("stretching a nested hug hands that axis over to the parent", async () => {
	// Its own hug would fix the height at 60; the parent says otherwise, and a
	// parent that says so wins rather than making the document unsolvable.
	const solved = await solve(nested({ align: "stretch" }));
	assert.equal(solved.outer.height, 80, "still the natural height of its tallest");
	assert.equal(solved.inner.height, 60, "80 less 2 x 10");
	assert.equal(solved.a.height, 60);
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
						layout: makeLayout({ gap: 10, padding: 10 }),
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

/* ------------------------------------------------------------------ */
/* Finding the drop target under a pointer                             */
/* ------------------------------------------------------------------ */

test("a drop lands in the container under the pointer, at the pointer", async () => {
	// The row sits at (100,100) and is 110 wide: a spans 110..150, b 160..200.
	const { scene, solved } = await withLayout();
	const drop = (x: number) =>
		dropTargetAt(scene.nodes, { x, y: 120 }, new Set(["loose"]), solved);

	assert.deepEqual(drop(115), { id: "box", index: 0 }, "before a's middle");
	assert.deepEqual(drop(155), { id: "box", index: 1 }, "between them");
	assert.deepEqual(drop(205), { id: "box", index: 2 }, "past b's middle");
});

test("a drop outside every surface is a drop on the canvas", async () => {
	const { scene, solved } = await withLayout();
	assert.deepEqual(
		dropTargetAt(scene.nodes, { x: 900, y: 900 }, new Set(["loose"]), solved),
		{ id: null, index: 1 },
		"one top-level node stays behind once loose is lifted out",
	);
});

test("what is being dragged cannot be what it is dropped into", async () => {
	const { scene, solved } = await withLayout();
	// The pointer is over the row, but the row is the thing in hand.
	assert.deepEqual(
		dropTargetAt(scene.nodes, { x: 150, y: 120 }, new Set(["box"]), solved),
		{ id: null, index: 1 },
	);
});

test("a child dragged within its own layout counts only the siblings left", async () => {
	const { scene, solved } = await withLayout();
	assert.deepEqual(
		dropTargetAt(scene.nodes, { x: 205, y: 120 }, new Set(["a"]), solved),
		{ id: "box", index: 1 },
		"past the one remaining child",
	);
});

test("a plain container takes a drop on top, order being nobody's business", async () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("frame", { x: 0, y: 0, width: 200, height: 200 }, { id: "plain" }),
	);
	scene = addNodeTo(
		scene,
		"plain",
		makeNode("rect", { x: 10, y: 10, width: 20, height: 20 }, { id: "kid" }),
	);
	assert.deepEqual(dropTargetAt(scene.nodes, { x: 100, y: 100 }), {
		id: "plain",
		index: 1,
	});
});
