/**
 * A gizmo drag arriving at a document.
 *
 * These are the assertions that matter most in this step, because they are the
 * ones about a *file*: what a drag writes, what it refuses to write, what unit
 * it writes in, and — the one that would be invisible until somebody lost work —
 * that a node holding two designs still holds two afterwards.
 *
 * Headless and pure, like everything in `design-core`'s own suite. Nothing here
 * mounts a renderer; `applySpatialEdit` takes a `Scene` and returns a `Scene`,
 * and that is the whole seam. The gizmo component's half — a ray, a matrix and a
 * pointer — is `gizmoMath.test.ts`'s.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type Scene,
	type SceneNode,
	EMU_PER_PX,
	emptyScene,
	frameDim,
	frameVar,
	lit,
	makeFrame,
	ref,
	rotateVar,
	sceneContext,
	single,
	spatialDim,
	turnMdeg,
} from "@clingo-design/design-core";

import {
	type SpatialEdit,
	applySpatialEdit,
	applySpatialEdits,
	editableNode,
	gizmoRefusal,
	isEmptyEdit,
	turnWritten,
} from "./edits3.ts";

const P = EMU_PER_PX;
const px = (n: number) => n * P;

/** A viewport with one mesh in it, which is the smallest thing to drag. */
function sceneWith(mesh: Partial<SceneNode> = {}): Scene {
	const base = emptyScene();
	return {
		...base,
		nodes: [
			{
				id: "view1",
				kind: "viewport",
				name: "3D view",
				frame: makeFrame({ x: 0, y: 0, width: px(400), height: px(300) }),
				props: {},
				children: [
					{
						id: "cube",
						kind: "mesh",
						name: "Cube",
						frame: makeFrame({ x: px(10), y: px(20), width: px(50), height: px(50) }),
						props: {},
						...mesh,
					},
				],
			},
		],
	};
}

const find = (scene: Scene, id: string): SceneNode => {
	const node = editableNode(scene, id);
	assert.ok(node, `no node ${id}`);
	return node;
};

const move = (dx: number, dy: number, dz: number): SpatialEdit => ({
	kind: "move",
	id: "cube",
	phase: "drag",
	dx,
	dy,
	dz,
});

const turn = (mdeg: number, axis: "rotateX" | "rotateY" | "rotateZ" = "rotateY"): SpatialEdit => ({
	kind: "turn",
	id: "cube",
	phase: "drag",
	turn: axis,
	mdeg,
});

/* ------------------------------------------------------------------ */
/* Moving                                                              */
/* ------------------------------------------------------------------ */

test("a planar drag adds to the frame and a depth drag states a z the document never had", () => {
	const before = sceneWith();
	// The mesh holds no `spatial` at all — which is what every node of every flat
	// document holds, and what makes the third axis cost a 2D file nothing.
	assert.equal(find(before, "cube").spatial, undefined);

	const after = applySpatialEdit(before, move(px(6), px(-4), px(12)));
	const context = sceneContext(after);
	const cube = find(after, "cube");
	assert.equal(frameDim(cube, "x", context), px(16));
	assert.equal(frameDim(cube, "y", context), px(16));
	assert.equal(spatialDim(cube, "z", context), px(12));
	// And the two numbers it did not touch are untouched, not rewritten to
	// themselves in some other spelling.
	assert.equal(frameDim(cube, "width", context), px(50));
	assert.equal(cube.spatial?.depth, undefined);
});

test("increments compose: applying a whole drag in order lands where it should", () => {
	// The contract `edits3.ts`'s header states — each edit is a delta since the
	// previous one, so a caller may apply every one it is handed. A drag is
	// twenty of these a second and this is the property that makes that safe.
	const drag: SpatialEdit[] = [
		{ kind: "move", id: "cube", phase: "start", dx: 0, dy: 0, dz: 0 },
		move(px(3), 0, px(1)),
		move(px(4), 0, px(2)),
		move(px(-2), 0, px(-1)),
		{ kind: "move", id: "cube", phase: "end", dx: 0, dy: 0, dz: 0 },
	];
	const after = applySpatialEdits(sceneWith(), drag);
	const context = sceneContext(after);
	const cube = find(after, "cube");
	assert.equal(frameDim(cube, "x", context), px(15));
	assert.equal(spatialDim(cube, "z", context), px(2));
});

test("a drag writes the alternative on screen and leaves the other designs alone", () => {
	// The thing that would be invisible until somebody lost work. A node with two
	// positions is a document holding two designs; a gesture that collapsed it to
	// one would silently delete a design.
	const before = sceneWith({
		frame: {
			...makeFrame({ x: px(10), y: px(20), width: px(50), height: px(50) }),
			x: [lit("10px"), lit("200px")],
		},
		spatial: { z: [lit("0px"), lit("90px")] },
	});
	const picks = { [frameVar("cube", "x")]: 1, [frameVar("cube", "z")]: 1 };
	const after = applySpatialEdit(before, move(px(5), 0, px(5)), picks);
	const cube = find(after, "cube");
	assert.deepEqual(
		cube.frame.x.map((t) => (t.kind === "literal" ? t.value : t.kind)),
		["10px", "205px"],
	);
	assert.deepEqual(
		(cube.spatial?.z ?? []).map((t) => (t.kind === "literal" ? t.value : t.kind)),
		["0px", "95px"],
	);
	// And with no picks at all — an unsolved preview — the first alternative is
	// the one that moves, which is what the first alternative means everywhere.
	const first = applySpatialEdit(before, move(px(5), 0, 0));
	assert.deepEqual(
		find(first, "cube").frame.x.map((t) => (t.kind === "literal" ? t.value : t.kind)),
		["15px", "200px"],
	);
});

test("an axis that is a token is refused, and the rest of the drag still lands", () => {
	// `withFrame`'s rule and `withSpatial`'s: that dimension is the token's to
	// decide and unwiring it would break a link the designer set up. The editor
	// says so by refusing to drag such an axis — and the axes beside it still
	// move, so the gesture is not lost, only narrowed.
	const before = sceneWith({
		frame: {
			...makeFrame({ x: px(10), y: px(20), width: px(50), height: px(50) }),
			x: [ref("gap")],
		},
	});
	const after = applySpatialEdit(before, move(px(9), px(9), 0));
	const cube = find(after, "cube");
	assert.deepEqual(cube.frame.x, [ref("gap")]);
	assert.equal(frameDim(cube, "y", sceneContext(after)), px(29));
});

test("a drag keeps the unit a length was already written in", () => {
	const before = sceneWith({
		frame: {
			...makeFrame({ x: 0, y: 0, width: px(50), height: px(50) }),
			x: single("2pt"),
		},
		spatial: { z: single("1in") },
	});
	// Three points is 3 * 12700 EMU; one point on top of two is three.
	const after = applySpatialEdit(before, move(12700, 0, 914400));
	const cube = find(after, "cube");
	assert.equal(cube.frame.x[0].kind === "literal" && cube.frame.x[0].value, "3pt");
	assert.equal(
		cube.spatial?.z?.[0].kind === "literal" && cube.spatial.z[0].value,
		"2in",
	);
});

/* ------------------------------------------------------------------ */
/* Turning                                                             */
/* ------------------------------------------------------------------ */

test("a turn states an angle the document never had, and then adds to it", () => {
	const before = sceneWith();
	assert.equal(find(before, "cube").turn, undefined);

	const once = applySpatialEdit(before, turn(30000));
	assert.deepEqual(find(once, "cube").turn?.rotateY, single("30deg"));

	const twice = applySpatialEdit(once, turn(15500));
	assert.equal(turnMdeg(find(twice, "cube"), "rotateY", sceneContext(twice)), 45500);
	// A thousandth of a degree is the unit `turn/3` carries, and a half degree
	// survives it exactly rather than rounding to a whole one.
	assert.deepEqual(find(twice, "cube").turn?.rotateY, single("45.5deg"));
});

test("a turn keeps the unit an angle was written in, and falls back to degrees", () => {
	const before = sceneWith({ turn: { rotateZ: single("0.25turn") } });
	// A quarter turn is 90000 thousandths; a whole degree on top is 91000, which
	// is not a multiple of nine and so cannot be a turn. It comes back in degrees
	// rather than as a turn with six decimals — `writeAngle`'s own rule.
	const after = applySpatialEdit(before, turn(1000, "rotateZ"));
	assert.deepEqual(find(after, "cube").turn?.rotateZ, single("91deg"));

	// Where it *can* be said in the stored unit, it is.
	const eighth = applySpatialEdit(before, turn(45000, "rotateZ"));
	assert.deepEqual(find(eighth, "cube").turn?.rotateZ, single("0.375turn"));
});

test("a rotation past a whole turn is kept as a rotation past a whole turn", () => {
	// Not wrapped into [0, 360), and `edits3.ts` says why: 370 and 10 are the same
	// pose and different numbers, and a state animating between 350 and 370 takes
	// the short way where one animating between 350 and 10 takes the long way.
	const before = sceneWith({ turn: { rotateX: single("350deg") } });
	const after = applySpatialEdit(before, turn(30000, "rotateX"));
	assert.deepEqual(find(after, "cube").turn?.rotateX, single("380deg"));
});

test("a rotation that is a token is refused, and one that is not an angle is left alone", () => {
	const linked = sceneWith({ turn: { rotateY: [ref("tilt")] } });
	assert.equal(applySpatialEdit(linked, turn(5000)), linked);

	// A literal that is not an angle at all — a stored document is read rather
	// than repaired, so it is neither replaced nor added to.
	const rubbish = sceneWith({ turn: { rotateY: single("chartreuse") } });
	assert.equal(applySpatialEdit(rubbish, turn(5000)), rubbish);
});

test("the alternative on screen is the one a turn writes", () => {
	const before = sceneWith({ turn: { rotateZ: [lit("0deg"), lit("90deg")] } });
	const value = turnWritten(find(before, "cube"), "rotateZ", 5000, {
		[rotateVar("cube", "rotateZ")]: 1,
	});
	assert.deepEqual(
		(value ?? []).map((t) => (t.kind === "literal" ? t.value : t.kind)),
		["0deg", "95deg"],
	);
});

/* ------------------------------------------------------------------ */
/* Refusals                                                            */
/* ------------------------------------------------------------------ */

test("an instance's part is refused by name rather than moved", () => {
	// The model id for a copy of a component's node is the term `inst(i1,label)`,
	// which is not a document node at all. Moving it would move it in every
	// instance at once, which is a real edit and a different one.
	const scene = sceneWith();
	assert.equal(editableNode(scene, "inst(i1,cube)"), undefined);
	const refusal = gizmoRefusal(scene, "inst(i1,cube)");
	assert.ok(refusal && refusal.includes("instance"));
	assert.equal(
		applySpatialEdit(scene, { ...move(px(10), 0, 0), id: "inst(i1,cube)" }),
		scene,
	);
});

test("an id the tree does not hold, and an edit that says nothing, both change nothing", () => {
	const scene = sceneWith();
	assert.equal(applySpatialEdit(scene, { ...move(px(10), 0, 0), id: "gone" }), scene);
	assert.equal(gizmoRefusal(scene, "gone"), "No such node.");
	assert.equal(gizmoRefusal(scene, "cube"), undefined);

	// The phase boundaries are real edits carrying no movement, and applying one
	// must be exactly a no-op — a caller applies every edit it is handed.
	assert.ok(isEmptyEdit({ kind: "move", id: "cube", phase: "start", dx: 0, dy: 0, dz: 0 }));
	assert.equal(
		applySpatialEdit(scene, { kind: "move", id: "cube", phase: "start", dx: 0, dy: 0, dz: 0 }),
		scene,
	);
	assert.equal(
		applySpatialEdit(scene, { kind: "turn", id: "cube", phase: "end", turn: "rotateX", mdeg: 0 }),
		scene,
	);
});

test("a document with no third axis in it stays a document with no third axis in it", () => {
	// The no-regression promise, at this file's own boundary: a drag that writes
	// only x and y must not leave a `spatial` record behind, or the compiler's
	// gate would open and a flat file would gain `frame(N,z,0)` on every node.
	const after = applySpatialEdit(sceneWith(), move(px(5), px(5), 0));
	assert.equal(find(after, "cube").spatial, undefined);
	assert.equal(find(after, "cube").turn, undefined);
});
