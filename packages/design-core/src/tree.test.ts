import assert from "node:assert/strict";
import { test } from "node:test";

import {
	addNode,
	addNodeTo,
	DUPLICATE_OFFSET,
	duplicateNodes,
	deleteNodes,
	groupNodes,
	makeNode,
	moveNodes,
	reorderNodes,
	resizeSubtree,
	ungroupNodes,
} from "./edits.ts";
import { type Frame } from "./geometry.ts";
import { type Scene, emptyScene, frameOf, makeFrame } from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { single } from "./values.ts";
import {
	ancestorsOf,
	findInTree,
	flatten,
	frameAt,
	hitTestTree,
	locate,
	parentOf,
	selectionTargetOf,
	worldFrame,
} from "./tree.ts";

/**
 * Everything in this file is written in pixels and read in EMU.
 *
 * The tree operations under test — grouping, rebasing, hit testing — are pure
 * rectangle arithmetic and would be true in any unit, but the numbers a person
 * uses to state a case are pixel counts, and a frame now arrives in EMU. So the
 * cases stay readable and the two helpers below do the multiplying, rather than
 * the file filling with constants like 1524000 that nobody can check.
 */
const P = EMU_PER_PX;

const box = (x: number, y: number, width: number, height: number): Frame => ({
	x: x * P,
	y: y * P,
	width: width * P,
	height: height * P,
});

const at = (x: number, y: number) => ({ x: x * P, y: y * P });

/** A node's frame in one document, resolved — the shape assertions want. */
function frameIn(scene: Scene, id: string) {
	const node = findInTree(scene.nodes, id);
	return node ? frameOf(node) : undefined;
}

function boxes(n: number): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	for (let i = 0; i < n; i++) {
		scene = addNode(
			scene,
			makeNode("rect", box(i * 100, 0, 60, 40), {
				id: `b${i}`,
				name: `Box ${i}`,
			}),
		);
	}
	return scene;
}

const ids = (scene: Scene) => scene.nodes.map((n) => n.id);
const allIds = (scene: Scene) => flatten(scene.nodes).map((n) => n.id);

test("grouping wraps siblings and derives the frame from them", () => {
	const scene = boxes(3);
	const { scene: next, id } = groupNodes(scene, ["b0", "b1"]);
	assert.ok(id);

	assert.deepEqual(ids(next), [id, "b2"]);
	const group = findInTree(next.nodes, id!);
	assert.equal(group?.kind, "group");
	assert.deepEqual(group?.children?.map((c) => c.id), ["b0", "b1"]);
	// b0 at x0..60, b1 at x100..160 -> bounds 0..160.
	assert.deepEqual(group && frameOf(group), box(0, 0, 160, 40));
});

test("grouping keeps the frontmost member's stacking position", () => {
	const scene = boxes(4);
	// b1 and b3 are grouped; the group should sit where b3 was.
	const { scene: next, id } = groupNodes(scene, ["b1", "b3"]);
	assert.deepEqual(ids(next), ["b0", "b2", id]);
});

test("grouping a single node still nests it", () => {
	const { scene: next, id } = groupNodes(boxes(2), ["b1"]);
	assert.deepEqual(ids(next), ["b0", id]);
	assert.deepEqual(findInTree(next.nodes, id!)?.children?.map((c) => c.id), ["b1"]);
});

test("grouping nothing is a no-op", () => {
	const scene = boxes(2);
	const { scene: next, id } = groupNodes(scene, []);
	assert.equal(id, null);
	assert.deepEqual(ids(next), ids(scene));
});

test("ungrouping splices children back in place", () => {
	const { scene: grouped, id } = groupNodes(boxes(3), ["b0", "b1"]);
	const { scene: next, ids: freed } = ungroupNodes(grouped, [id!]);

	assert.deepEqual(ids(next), ["b0", "b1", "b2"]);
	assert.deepEqual(freed.sort(), ["b0", "b1"]);
	assert.equal(findInTree(next.nodes, id!), undefined);
});

test("group then ungroup round-trips the document", () => {
	const scene = boxes(3);
	const { scene: grouped, id } = groupNodes(scene, ["b0", "b1"]);
	const { scene: back } = ungroupNodes(grouped, [id!]);
	assert.deepEqual(back.nodes, scene.nodes);
});

test("ancestors, parent and top level", () => {
	const { scene: inner, id: innerId } = groupNodes(boxes(3), ["b0", "b1"]);
	const { scene, id: outerId } = groupNodes(inner, [innerId!, "b2"]);

	assert.deepEqual(
		ancestorsOf(scene.nodes, "b0").map((n) => n.id),
		[outerId, innerId],
	);
	assert.equal(parentOf(scene.nodes, "b0")?.id, innerId);
	assert.equal(parentOf(scene.nodes, innerId!)?.id, outerId);
	assert.equal(parentOf(scene.nodes, outerId!), undefined);
	// Clicking a nested leaf selects the outermost group.
	assert.equal(selectionTargetOf(scene.nodes, "b0")?.id, outerId);
	assert.equal(selectionTargetOf(scene.nodes, outerId!)?.id, outerId);
});

test("flatten is depth-first, parents before children", () => {
	const { scene: inner, id: innerId } = groupNodes(boxes(3), ["b0", "b1"]);
	assert.deepEqual(allIds(inner), [innerId, "b0", "b1", "b2"]);
});

test("locate finds the sibling list at any depth", () => {
	const { scene, id } = groupNodes(boxes(3), ["b0", "b1"]);
	assert.equal(locate(scene.nodes, "b2")?.index, 1);
	const nested = locate(scene.nodes, "b1");
	assert.equal(nested?.index, 1);
	assert.equal(nested?.parent?.id, id);
	assert.equal(locate(scene.nodes, "nope"), null);
});

test("moving a group carries its children without touching them", () => {
	const { scene, id } = groupNodes(boxes(2), ["b0", "b1"]);
	const moved = moveNodes(scene, [id!], 10 * P, 5 * P);

	// Children are relative, so their own frames are untouched...
	assert.deepEqual(frameIn(moved, "b0"), box(0, 0, 60, 40));
	assert.deepEqual(frameIn(moved, "b1"), box(100, 0, 60, 40));
	assert.deepEqual(frameIn(moved, id!), box(10, 5, 160, 40));
	// ...but they land in the right place on the canvas.
	assert.deepEqual(worldFrame(moved.nodes, "b1"), box(110, 5, 60, 40));
});

test("moving a child re-derives the group frame", () => {
	const { scene, id } = groupNodes(boxes(2), ["b0", "b1"]);
	const moved = moveNodes(scene, ["b1"], 0, 100 * P);
	// The group grows to contain the child's new position.
	assert.deepEqual(frameIn(moved, id!), box(0, 0, 160, 140));
});

test("grouping rebases children into the group's space", () => {
	const { scene, id } = groupNodes(boxes(2), ["b0", "b1"]);
	const group = findInTree(scene.nodes, id!);
	// The group sits where the members were; the members start at its origin.
	assert.deepEqual(group && frameOf(group), box(0, 0, 160, 40));
	assert.deepEqual(group?.children?.map((c) => frameOf(c).x), [0, 100 * P]);
});

test("ungrouping lifts children back into the parent's space", () => {
	let scene = boxes(2);
	scene = moveNodes(scene, ["b0", "b1"], 50 * P, 20 * P);
	const { scene: grouped, id } = groupNodes(scene, ["b0", "b1"]);
	const { scene: back } = ungroupNodes(grouped, [id!]);

	assert.deepEqual(frameIn(back, "b0"), box(50, 20, 60, 40));
	assert.deepEqual(frameIn(back, "b1"), box(150, 20, 60, 40));
});

test("resizing a group scales its contents", () => {
	const { scene, id } = groupNodes(boxes(2), ["b0", "b1"]);
	const resized = resizeSubtree(scene, id!, box(0, 0, 320, 40));

	assert.deepEqual(frameIn(resized, "b0"), box(0, 0, 120, 40));
	assert.deepEqual(frameIn(resized, "b1"), box(200, 0, 120, 40));
});

test("a frame does not resize itself around its children", () => {
	// Groups hug their contents; artboards are a fixed surface.
	const scene = emptyScene();
	const before = frameOf(scene.nodes[0]);
	const grown = moveNodes(
		{
			...scene,
			nodes: [
				{
					...scene.nodes[0],
					children: [
						makeNode("rect", box(0, 0, 40, 40), { id: "inner" }),
					],
				},
			],
		},
		["inner"],
		2000 * P,
		2000 * P,
	);
	assert.deepEqual(frameOf(grown.nodes[0]), before);
});

test("deleting a group removes its whole subtree", () => {
	const { scene, id } = groupNodes(boxes(3), ["b0", "b1"]);
	const next = deleteNodes(scene, [id!]);
	assert.deepEqual(allIds(next), ["b2"]);
});

test("duplicating a group deep-copies it with fresh ids", () => {
	const { scene, id } = groupNodes(boxes(2), ["b0", "b1"]);
	const { scene: next, ids: created } = duplicateNodes(scene, [id!]);

	assert.equal(created.length, 1);
	const clone = findInTree(next.nodes, created[0]);
	assert.equal(clone?.children?.length, 2);
	// No id may be shared with the original.
	const originals = new Set(["b0", "b1", id]);
	for (const child of clone?.children ?? []) assert.ok(!originals.has(child.id));
	// And the copy is offset.
	assert.equal(clone && frameOf(clone).x, DUPLICATE_OFFSET);
});

test("z-order is scoped to the parent", () => {
	const { scene, id } = groupNodes(boxes(3), ["b0", "b1"]);
	const next = reorderNodes(scene, ["b0"], "front");
	// b0 moves to the front *within its group*, not the document.
	assert.deepEqual(findInTree(next.nodes, id!)?.children?.map((c) => c.id), ["b1", "b0"]);
	assert.deepEqual(ids(next), [id, "b2"]);
});

test("nested grouping survives round trips", () => {
	const { scene: inner, id: innerId } = groupNodes(boxes(4), ["b0", "b1"]);
	const { scene: outer, id: outerId } = groupNodes(inner, [innerId!, "b2"]);
	assert.equal(flatten(outer.nodes).length, 6, "2 groups + 4 boxes");

	const { scene: peeled } = ungroupNodes(outer, [outerId!]);
	assert.deepEqual(ids(peeled), [innerId, "b2", "b3"]);
	assert.equal(findInTree(peeled.nodes, "b0") !== undefined, true);
});

test("hit testing works in canvas coordinates through nesting", () => {
	// A frame at 100,100 with a box at 20,20 inside it: the box occupies
	// 120..180 on the canvas even though its own frame says 20.
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			{
				id: "f",
				kind: "frame",
				name: "Frame",
				frame: makeFrame(box(100, 100, 200, 200)),
				props: {},
				children: [
					makeNode("rect", box(20, 20, 60, 60), { id: "box" }),
				],
			},
		],
	};

	assert.equal(hitTestTree(scene.nodes, at(150, 150))?.node.id, "box");
	// Inside the frame but outside the box selects the frame.
	assert.equal(hitTestTree(scene.nodes, at(250, 250))?.node.id, "f");
	assert.equal(hitTestTree(scene.nodes, at(50, 50)), undefined);

	assert.deepEqual(worldFrame(scene.nodes, "box"), box(120, 120, 60, 60));
});

/**
 * A halo is not a hit area, and the reason is that the file agrees.
 *
 * "Click the blurry bit" is a plausible-sounding request and it is wrong three
 * times over. The frame is what the editor draws — handles, snaps, alignment and
 * the marquee are all the frame — so a hit area bigger than it would make a node
 * selectable where nothing on screen says it is. The browser hit-tests the
 * unblurred border box, so in the exported file a pointer over the halo is over
 * whatever is behind it, and extending the canvas's reach would make the editor
 * and the file disagree about what you are pointing at, which is the one thing
 * `paint.ts` exists to prevent. And the halo is mostly transparent: picking a
 * node by a pixel that is four percent opaque is worse than not picking it.
 *
 * Asserted rather than argued because `hitTestTree` never opens `props` at all,
 * and this is the test that says that is a decision rather than an omission a
 * later blur-aware version would be free to fix.
 */
test("a blur does not widen what you can click", () => {
	const blurred: Scene = {
		...emptyScene(),
		nodes: [
			{
				...makeNode("rect", box(100, 100, 60, 60), { id: "box" }),
				props: { blur: single("40px") },
			},
		],
	};

	assert.equal(hitTestTree(blurred.nodes, at(130, 130))?.node.id, "box");
	// Two pixels outside the frame, well inside a forty-pixel smear.
	assert.equal(hitTestTree(blurred.nodes, at(162, 130)), undefined);
	assert.equal(hitTestTree(blurred.nodes, at(130, 98)), undefined);
});

test("clicking inside a frame selects the child, not the frame", () => {
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			{
				id: "f",
				kind: "frame",
				name: "Frame",
				frame: makeFrame(box(0, 0, 200, 200)),
				props: {},
				children: [
					makeNode("rect", box(10, 10, 50, 50), { id: "box" }),
				],
			},
		],
	};
	// A frame is a container you work inside, unlike a group.
	assert.equal(selectionTargetOf(scene.nodes, "box")?.id, "box");
	assert.equal(selectionTargetOf(scene.nodes, "f")?.id, "f");
});

test("a group inside a frame still selects as a whole", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = {
		...scene,
		nodes: [
			{
				id: "f",
				kind: "frame",
				name: "Frame",
				frame: makeFrame(box(0, 0, 300, 300)),
				props: {},
				children: [
					makeNode("rect", box(0, 0, 40, 40), { id: "a" }),
					makeNode("rect", box(60, 0, 40, 40), { id: "b" }),
				],
			},
		],
	};
	const { scene: grouped, id } = groupNodes(scene, ["a", "b"]);
	assert.equal(selectionTargetOf(grouped.nodes, "a")?.id, id);
});

test("frameAt finds the innermost frame under a point", () => {
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			{
				id: "outer",
				kind: "frame",
				name: "Outer",
				frame: makeFrame(box(0, 0, 400, 400)),
				props: {},
				children: [
					{
						id: "inner",
						kind: "frame",
						name: "Inner",
						frame: makeFrame(box(100, 100, 100, 100)),
						props: {},
						children: [],
					},
				],
			},
		],
	};
	assert.equal(frameAt(scene.nodes, at(150, 150))?.node.id, "inner");
	assert.equal(frameAt(scene.nodes, at(300, 300))?.node.id, "outer");
	assert.equal(frameAt(scene.nodes, at(900, 900)), undefined);
});

test("addNodeTo rebases a canvas-space node into its new parent", () => {
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			{
				id: "f",
				kind: "frame",
				name: "Frame",
				frame: makeFrame(box(200, 100, 300, 300)),
				props: {},
				children: [],
			},
		],
	};
	// Drawn at canvas 250,150 — inside the frame, so it becomes 50,50 local.
	const node = makeNode("rect", box(250, 150, 40, 40), { id: "drawn" });
	const next = addNodeTo(scene, "f", node);

	const drawnNode = findInTree(next.nodes, "drawn");
	assert.ok(drawnNode);
	assert.deepEqual(frameOf(drawnNode), box(50, 50, 40, 40));
	assert.deepEqual(worldFrame(next.nodes, "drawn"), box(250, 150, 40, 40));
});
