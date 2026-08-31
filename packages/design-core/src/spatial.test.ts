/**
 * The 3D reading layer: the viewport walk, the matrix chain, and the refusal.
 *
 * Beside `thirdaxis.test.ts` rather than inside it, and the split is the same
 * one that file's own header describes: `thirdaxis.test.ts` asserts what a
 * *document* holds — the tables, the sparse records, the readers on one node —
 * and this asserts what a *chain* of them comes to once ancestors, rotations and
 * a universe's picks have all had their say.
 *
 * Nothing here goes through the solver, and that is a fact about where this step
 * sits rather than a gap in the testing. `spatial.ts` states no ASP; the
 * predicates it is the twin of — `spatial.`, `s3/1`, `vcam/2` — are step M7's
 * and do not exist yet, so the test that holds the two answers equal is M7's to
 * write, exactly as `machines.test.ts` holds `machineHealth` equal to
 * `munreached/2`. What *is* asserted here against the shipped world is the
 * no-regression half: every template in the corpus is flat, stays flat, and gets
 * from this file exactly the four numbers `tree.ts` already gave it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type Scene,
	type SceneNode,
	emptyScene,
	makeFrame,
	makeSpatial,
	sceneContext,
} from "./scene.ts";
import {
	EMU_PER_RENDER_UNIT,
	applyMatrix,
	axisBounds,
	boxOf,
	cameraOf,
	camerasIn,
	centreOf,
	composeMatrix,
	contentsOf,
	crossesViewport,
	emuFromRender,
	identityMatrix,
	isSpatialNode,
	isSpatialScene,
	localMatrix,
	originMatrix,
	inertConstraints,
	planeOf,
	radFromMdeg,
	refusedBounds,
	refusedEdge,
	renderFromEmu,
	renderPoint,
	rotationMatrix,
	scenePosition,
	sceneMatrixOf,
	transformOf,
	translationMatrix,
	viewportOf,
	viewports,
	worldMatrixOf,
} from "./spatial.ts";
import { TEMPLATES } from "./templates/index.ts";
import { flatten, worldFrame } from "./tree.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, ref, rotateVar, single, tokenVar } from "./values.ts";

const P = EMU_PER_PX;
const px = (n: number) => n * P;

const node = (
	id: string,
	kind: SceneNode["kind"],
	extra: Partial<SceneNode> = {},
): SceneNode => ({
	id,
	kind,
	name: id,
	frame: makeFrame({ x: 0, y: 0, width: px(100), height: px(100) }),
	props: {},
	...extra,
});

const scene = (nodes: SceneNode[], extra: Partial<Scene> = {}): Scene => ({
	...emptyScene(),
	nodes,
	...extra,
});

/** Two matrices are equal to within float noise, element by element. */
function assertMatrix(
	actual: readonly number[],
	expected: readonly number[],
	message?: string,
) {
	assert.equal(actual.length, 16, "a matrix has sixteen numbers");
	for (let i = 0; i < 16; i++) {
		assert.ok(
			Math.abs(actual[i] - expected[i]) < 1e-9,
			`${message ?? "matrix"}[${i}]: ${actual[i]} !== ${expected[i]}`,
		);
	}
}

/* ------------------------------------------------------------------ */
/* What is in three dimensions                                         */
/* ------------------------------------------------------------------ */

test("the gate opens for a viewport, for a stated z and for a turn, and for nothing else", () => {
	assert.equal(isSpatialScene(emptyScene()), false);

	assert.equal(
		isSpatialScene(scene([node("f", "frame", { children: [node("v", "viewport")] })])),
		true,
		"one viewport anywhere",
	);
	assert.equal(
		isSpatialScene(scene([node("card", "rect", { spatial: makeSpatial({ z: px(24) }) })])),
		true,
		"a rect lifted off the page",
	);
	assert.equal(
		isSpatialScene(scene([node("card", "rect", { turn: { rotateZ: single("15deg") } })])),
		true,
		"a rect turned on the page",
	);

	// The two near-misses, both of which look like they should count.
	assert.equal(
		isSpatialScene(scene([node("m", "mesh")])),
		false,
		"a mesh with nothing said about it is a node nothing renders",
	);
	assert.equal(
		isSpatialScene(scene([node("card", "rect", { spatial: {}, turn: {} })])),
		false,
		"an empty record states nothing",
	);
});

/**
 * The templates that are in three dimensions, named rather than detected.
 *
 * A written list and **not** `TEMPLATES.filter(isSpatialScene)`, and the
 * difference is the whole value of the two loops below. Filtered by the
 * predicate under test, they would agree with it by construction: a bug that
 * made every document read as flat would empty the spatial half and both loops
 * would pass with nothing left to say. Named, the partition itself is the
 * assertion — a template that quietly grows a viewport fails here, and so does
 * one that quietly loses the one it has.
 *
 * It stays a set of one for as long as `solids` is the only template that states
 * a third axis, which is the no-regression promise in its most literal form:
 * twelve of the thirteen documents that shipped before the third axis existed
 * are still, atom for atom, documents that have never heard of it.
 */
const SPATIAL_TEMPLATES = new Set(["solids"]);

test("every template is flat, and stays flat — bar the one that says otherwise", () => {
	for (const template of TEMPLATES) {
		const document = template.create();
		const spatial = SPATIAL_TEMPLATES.has(template.id);
		assert.equal(isSpatialScene(document), spatial, template.id);
		if (spatial) {
			// The other half of the partition, so the list above cannot be padded
			// with a flat template and quietly excuse it from the loop.
			assert.ok(viewports(document).length > 0, `${template.id} has no view`);
			assert.ok(
				flatten(document.nodes).some((n) => isSpatialNode(document, n)),
				`${template.id} has no node in the third axis`,
			);
			continue;
		}
		assert.deepEqual(viewports(document), [], template.id);
		for (const n of flatten(document.nodes)) {
			assert.equal(isSpatialNode(document, n), false, `${template.id}/${n.id}`);
		}
	}
});

test("a viewport is not inside itself, and the nearest one wins", () => {
	const inner = node("inner", "viewport", { children: [node("cube", "mesh")] });
	const outer = node("outer", "viewport", { children: [inner] });
	const document = scene([node("art", "frame", { children: [outer, node("card", "rect")] })]);

	assert.equal(viewportOf(document, "outer")?.id, undefined);
	assert.equal(viewportOf(document, "inner")?.id, "outer");
	assert.equal(viewportOf(document, "cube")?.id, "inner");
	assert.equal(viewportOf(document, "card"), undefined);
	assert.equal(viewportOf(document, "nobody"), undefined);

	assert.deepEqual(
		viewports(document).map((v) => v.id),
		["outer", "inner"],
		"paint order, outermost first",
	);
	assert.deepEqual(
		contentsOf(outer).map((n) => n.id),
		["inner", "cube"],
		"the whole subtree, not one level",
	);
});

test("s3's three clauses, as a reader", () => {
	const cube = node("cube", "mesh");
	const rig = node("rig", "pivot", { children: [cube] });
	const view = node("view", "viewport", { children: [rig] });
	const lifted = node("lifted", "rect", { spatial: makeSpatial({ z: px(8) }) });
	const turned = node("turned", "rect", { turn: { rotateY: single("30deg") } });
	const loose = node("loose", "mesh");
	const document = scene([
		node("art", "frame", { children: [view, lifted, turned, loose] }),
	]);

	assert.equal(isSpatialNode(document, view), true, "a viewport is in it");
	assert.equal(isSpatialNode(document, rig), true, "and everything under one");
	assert.equal(isSpatialNode(document, cube), true, "however deep");
	assert.equal(isSpatialNode(document, lifted), true, "a node the document lifted");
	assert.equal(isSpatialNode(document, turned), true, "or turned");
	// The one that decides the whole design: a spatial *kind* is not a spatial
	// *node*. Dragging a mesh out of a view leaves a node nothing renders, and
	// correcting it would be correcting something a designer did on purpose.
	assert.equal(isSpatialNode(document, loose), false);
	assert.equal(isSpatialNode(document, node("art", "frame")), false);
});

test("a viewport looks through the camera it names, when that is a camera in it", () => {
	const eye = node("eye", "camera");
	const other = node("other", "camera");
	const view = node("view", "viewport", {
		camera: "eye",
		children: [eye, node("cube", "mesh")],
	});
	const document = scene([node("art", "frame", { children: [view, other] })]);

	assert.equal(cameraOf(document, view)?.id, "eye");
	assert.deepEqual(
		camerasIn(document, view).map((n) => n.id),
		["eye"],
	);

	// The three silences, each of which is a dangling reference rather than an
	// error: deleting a camera has to leave a legal document.
	assert.equal(cameraOf(document, { ...view, camera: "gone" }), undefined, "dangling");
	assert.equal(cameraOf(document, { ...view, camera: "cube" }), undefined, "not a camera");
	assert.equal(cameraOf(document, { ...view, camera: "other" }), undefined, "outside the view");
	assert.equal(cameraOf(document, { ...view, camera: undefined }), undefined, "unnamed");
	assert.equal(cameraOf(document, node("card", "rect", { camera: "eye" })), undefined, "not a view");
});

test("camerasIn reads the live subtree, not the node it was handed", () => {
	const view = node("view", "viewport", { children: [node("eye", "camera")] });
	const document = scene([node("art", "frame", { children: [view] })]);
	// A panel holding last render's node: the document has since gained a camera.
	const stale = node("view", "viewport", { children: [] });
	assert.deepEqual(
		camerasIn(document, stale).map((n) => n.id),
		["eye"],
	);
	// And a subtree the document does not hold at all still answers, so a caller
	// building nodes by hand is not silently given nothing.
	const detached = node("detached", "viewport", { children: [node("lens", "camera")] });
	assert.deepEqual(
		camerasIn(document, detached).map((n) => n.id),
		["lens"],
	);
});

/* ------------------------------------------------------------------ */
/* Reading one node                                                    */
/* ------------------------------------------------------------------ */

test("a box is six numbers, and the missing two are zero", () => {
	const flat = node("flat", "rect");
	assert.deepEqual(boxOf(flat), {
		x: 0,
		y: 0,
		width: px(100),
		height: px(100),
		z: 0,
		depth: 0,
	});

	const deep = node("deep", "mesh", { spatial: makeSpatial({ z: px(10), depth: px(40) }) });
	assert.deepEqual(boxOf(deep), {
		x: 0,
		y: 0,
		width: px(100),
		height: px(100),
		z: px(10),
		depth: px(40),
	});
	assert.deepEqual(centreOf(boxOf(deep)), { x: px(50), y: px(50), z: px(30) });
});

test("a transform is resolved against one universe", () => {
	const document = scene([
		node("cube", "mesh", { turn: { rotateY: [ref("tilt")] } }),
	]);
	document.tokens = [
		...document.tokens,
		{ id: "tilt", name: "tilt", type: "angle", value: [lit("0deg"), lit("30deg")] },
	];
	const key = "tok(tilt)";

	assert.equal(
		transformOf(document.nodes[0], sceneContext(document, { [key]: 0 })).turn.rotateY,
		0,
	);
	assert.equal(
		transformOf(document.nodes[0], sceneContext(document, { [key]: 1 })).turn.rotateY,
		30_000,
	);
});

/* ------------------------------------------------------------------ */
/* The matrices                                                        */
/* ------------------------------------------------------------------ */

test("the matrix primitives", () => {
	assertMatrix(identityMatrix(), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
	// Column-major: the translation is the last four, which is what makes a
	// matrix here go into three.js and into CSS `matrix3d()` with no transpose.
	assert.deepEqual(translationMatrix(2, 3, 5).slice(12), [2, 3, 5, 1]);

	const t = translationMatrix(2, 3, 5);
	assertMatrix(composeMatrix(identityMatrix(), t), t, "identity on the left");
	assertMatrix(composeMatrix(t, identityMatrix()), t, "identity on the right");

	assert.deepEqual(applyMatrix(t, { x: 1, y: 1, z: 1 }), { x: 3, y: 4, z: 6 });
});

test("a quarter turn about z takes x to y, which on a y-down plane is clockwise", () => {
	const quarter = rotationMatrix({ rotateX: 0, rotateY: 0, rotateZ: 90_000 });
	const turned = applyMatrix(quarter, { x: 1, y: 0, z: 0 });
	assert.ok(Math.abs(turned.x) < 1e-12);
	assert.ok(Math.abs(turned.y - 1) < 1e-12);
	assert.ok(Math.abs(turned.z) < 1e-12);
});

test("the rotation order is rotateZ, then rotateY, then rotateX", () => {
	const turn = { rotateX: 20_000, rotateY: 35_000, rotateZ: 50_000 };
	const only = (axis: "rotateX" | "rotateY" | "rotateZ") =>
		rotationMatrix({ rotateX: 0, rotateY: 0, rotateZ: 0, [axis]: turn[axis] });
	// Rx · Ry · Rz — the rightmost factor is applied first, so z goes first. This
	// is the product three.js's `makeRotationFromEuler` builds for order "XYZ"
	// and the one CSS's `rotateX(..) rotateY(..) rotateZ(..)` composes, which is
	// why nothing between here and either renderer converts anything.
	assertMatrix(
		rotationMatrix(turn),
		composeMatrix(composeMatrix(only("rotateX"), only("rotateY")), only("rotateZ")),
	);
});

test("with nothing turned, the chain is the sum of origins tree.ts already computed", () => {
	const cube = node("cube", "mesh", {
		frame: makeFrame({ x: px(10), y: px(20), width: px(30), height: px(40) }),
		spatial: makeSpatial({ z: px(5), depth: px(6) }),
	});
	const view = node("view", "viewport", {
		frame: makeFrame({ x: px(100), y: px(200), width: px(480), height: px(320) }),
		children: [cube],
	});
	const document = scene([
		node("art", "frame", {
			frame: makeFrame({ x: px(1), y: px(2), width: px(900), height: px(700) }),
			children: [view],
		}),
	]);

	// An unturned origin matrix is a plain translation by the node's own frame,
	// which is the whole reason the third axis costs a flat document nothing.
	assertMatrix(originMatrix(view), translationMatrix(px(100), px(200), 0));
	assertMatrix(
		localMatrix(cube),
		translationMatrix(px(10 + 15), px(20 + 20), px(5 + 3)),
		"local puts the origin at the centre",
	);

	const world = worldMatrixOf(document, "cube");
	assert.ok(world);
	const centre = { x: world[12], y: world[13], z: world[14] };
	const flat = worldFrame(document.nodes, "cube");
	assert.ok(flat);
	assert.equal(centre.x, flat.x + flat.width / 2);
	assert.equal(centre.y, flat.y + flat.height / 2);
	assert.equal(centre.z, px(5 + 3));

	// The scene chain stops at the viewport: the artboard's place on the page is
	// not part of the geometry inside the view.
	const inside = sceneMatrixOf(document, "cube");
	assert.ok(inside);
	assertMatrix(inside, localMatrix(cube));
	assert.equal(sceneMatrixOf(document, "view"), undefined, "a view is not inside itself");
	assert.equal(sceneMatrixOf(document, "art"), undefined, "nor is an artboard");
	assert.equal(worldMatrixOf(document, "nobody"), undefined);
});

test("a turned ancestor carries its children round its own centre", () => {
	// A 100x100 pivot at the origin, turned a quarter turn about z, holding a
	// zero-sized marker at its top-right corner. The marker sits (50, -50) from
	// the pivot's centre; a quarter turn sends that to (50, 50); so the marker
	// lands at (100, 100) — the corner diagonally opposite the one it started at.
	const marker = node("marker", "pivot", {
		frame: makeFrame({ x: px(100), y: 0, width: 0, height: 0 }),
	});
	const rig = node("rig", "pivot", {
		frame: makeFrame({ x: 0, y: 0, width: px(100), height: px(100) }),
		turn: { rotateZ: single("90deg") },
		children: [marker],
	});
	const document = scene([node("view", "viewport", { children: [rig] })]);

	const world = worldMatrixOf(document, "marker");
	assert.ok(world);
	assert.ok(Math.abs(world[12] - px(100)) < 1e-6, `x ${world[12]}`);
	assert.ok(Math.abs(world[13] - px(100)) < 1e-6, `y ${world[13]}`);
	assert.ok(Math.abs(world[14]) < 1e-6, `z ${world[14]}`);
});

/* ------------------------------------------------------------------ */
/* The box, and the refusal                                            */
/* ------------------------------------------------------------------ */

test("an unturned node has an exact box, in integer EMU", () => {
	const cube = node("cube", "mesh", {
		frame: makeFrame({ x: px(10), y: px(20), width: px(30), height: px(40) }),
		spatial: makeSpatial({ z: px(5), depth: px(6) }),
	});
	const document = scene([
		node("art", "frame", {
			frame: makeFrame({ x: px(1), y: px(2), width: px(900), height: px(700) }),
			children: [node("view", "viewport", {
				frame: makeFrame({ x: px(100), y: px(200), width: px(480), height: px(320) }),
				children: [cube],
			})],
		}),
	]);

	const box = axisBounds(document, "cube");
	assert.deepEqual(box, {
		x: px(111),
		y: px(222),
		z: px(5),
		width: px(30),
		height: px(40),
		depth: px(6),
	});
	assert.equal(refusedBounds(document, "cube"), undefined);
	// And it agrees with the two-dimensional reader on the four numbers they
	// both have, which is invariant 4 stated one node at a time.
	const flat = worldFrame(document.nodes, "cube");
	assert.deepEqual(flat, { x: box.x, y: box.y, width: box.width, height: box.height });
});

test("every template's nodes get the same four numbers from both readers", () => {
	for (const template of TEMPLATES) {
		const document = template.create();
		const flatDocument = !SPATIAL_TEMPLATES.has(template.id);
		for (const n of flatten(document.nodes)) {
			const box = axisBounds(document, n.id);
			const flat = worldFrame(document.nodes, n.id);
			if (!box) {
				// The only thing that may refuse: a turned node's faces are the
				// trigonometry a linear solver cannot do. A *flat* document has no
				// such node, so a refusal there is a bug rather than a boundary —
				// which is why this is two assertions and not a `continue`.
				assert.ok(!flatDocument, `${template.id}/${n.id} refused`);
				assert.match(refusedBounds(document, n.id) ?? "", /turned/, `${template.id}/${n.id}`);
				continue;
			}
			// Invariant 4, stated one node at a time: whatever else the third axis
			// gave a node, the two readers still agree about the four numbers they
			// have both always had.
			assert.deepEqual(
				{ x: box.x, y: box.y, width: box.width, height: box.height },
				flat,
				`${template.id}/${n.id}`,
			);
			if (flatDocument) {
				assert.equal(box.z, 0, `${template.id}/${n.id}`);
				assert.equal(box.depth, 0, `${template.id}/${n.id}`);
			}
		}
	}
});

test("a turned node has no box, and the refusal names it", () => {
	const document = scene([
		node("panel", "rect", { turn: { rotateY: single("30deg") } }),
	]);
	assert.equal(axisBounds(document, "panel"), undefined);
	const why = refusedBounds(document, "panel");
	assert.ok(why);
	assert.match(why, /“panel” is turned 30° about Y/);
	assert.match(why, /trigonometry/);
});

test("a turned ancestor refuses its children, and the refusal names the ancestor", () => {
	const document = scene([
		node("rig", "pivot", {
			turn: { rotateZ: single("22.5deg") },
			children: [node("cube", "mesh")],
		}),
	]);
	assert.equal(axisBounds(document, "cube"), undefined);
	const why = refusedBounds(document, "cube");
	assert.ok(why);
	assert.match(why, /“cube” sits under “rig”/);
	// Degrees, written as shortly as they can be: the document stores 22500.
	assert.match(why, /22\.5° about Z/);
});

test("two turns are read as a sentence, and zero is not a turn", () => {
	const document = scene([
		node("card", "rect", {
			turn: { rotateY: single("30deg"), rotateZ: single("12deg"), rotateX: single("0deg") },
		}),
	]);
	const why = refusedBounds(document, "card");
	assert.ok(why);
	assert.match(why, /30° about Y and 12° about Z/);
	assert.doesNotMatch(why, /about X/);
});

test("the refusal is a fact about one universe, not about the field", () => {
	const document = scene([node("card", "rect", { turn: { rotateZ: [ref("tilt")] } })]);
	document.tokens = [
		...document.tokens,
		{ id: "tilt", name: "tilt", type: "angle", value: [lit("0deg"), lit("30deg")] },
	];
	const key = "tok(tilt)";

	// Flat in the first design: a box, and nothing to say about it. Refusing here
	// would be a refusal with nothing behind it.
	assert.ok(axisBounds(document, "card", sceneContext(document, { [key]: 0 })));
	assert.equal(refusedBounds(document, "card", sceneContext(document, { [key]: 0 })), undefined);
	// Turned in the second: no box, and a sentence.
	assert.equal(axisBounds(document, "card", sceneContext(document, { [key]: 1 })), undefined);
	assert.ok(refusedBounds(document, "card", sceneContext(document, { [key]: 1 })));
});

test("a rotation the document names per node still reaches the reader", () => {
	// The other half of the same point: the pick key is the node's own rotation
	// variable, not a token, so an alternative written inline branches too.
	const document = scene([
		node("card", "rect", { turn: { rotateZ: [lit("0deg"), lit("45deg")] } }),
	]);
	const key = rotateVar("card", "rotateZ");
	assert.ok(axisBounds(document, "card", sceneContext(document, { [key]: 0 })));
	assert.equal(axisBounds(document, "card", sceneContext(document, { [key]: 1 })), undefined);
});

test("nothing is refused for a node the document does not hold — it is simply absent", () => {
	const document = scene([node("card", "rect")]);
	assert.equal(axisBounds(document, "nobody"), undefined);
	assert.equal(refusedBounds(document, "nobody"), undefined);
});

/* ------------------------------------------------------------------ */
/* The renderer boundary                                               */
/* ------------------------------------------------------------------ */

test("EMU cross to renderer units, which are CSS pixels", () => {
	assert.equal(renderFromEmu(px(480)), 480);
	assert.equal(emuFromRender(480), px(480));
	assert.equal(EMU_PER_RENDER_UNIT, EMU_PER_PX);
	assert.equal(emuFromRender(renderFromEmu(px(37))), px(37), "whole pixels round-trip");
});

test("radians are the one lossy direction, and they are named for it", () => {
	assert.equal(radFromMdeg(180_000), Math.PI);
	assert.equal(radFromMdeg(0), 0);
	assert.equal(radFromMdeg(-90_000), -Math.PI / 2);
});

test("the sign flip happens once, on two axes", () => {
	assert.deepEqual(renderPoint({ x: px(1), y: px(2), z: px(3) }), [1, -2, -3]);
	assert.deepEqual(planeOf({ x: 1, y: 2, z: 3 }), { x: 1, y: 2 });
});

test("a scene position is the chain, the flip and the crossing, in one call", () => {
	const cube = node("cube", "mesh", {
		frame: makeFrame({ x: px(10), y: px(20), width: px(30), height: px(40) }),
		spatial: makeSpatial({ z: px(5), depth: px(6) }),
	});
	const document = scene([
		node("art", "frame", {
			children: [node("view", "viewport", {
				frame: makeFrame({ x: px(100), y: px(200), width: px(480), height: px(320) }),
				children: [cube],
			})],
		}),
	]);
	assert.deepEqual(scenePosition(document, "cube"), [25, -40, -8]);
	assert.equal(scenePosition(document, "view"), undefined, "no model space to be in");
	assert.equal(scenePosition(document, "nobody"), undefined);
});

/* ------------------------------------------------------------------ */
/* What a rule cannot be about                                         */
/* ------------------------------------------------------------------ */

/** A geometric rule, spelled the way the document spells one. */
const rule = (
	id: string,
	kind: "align" | "gap" | "symmetric" | "pin",
	nodes: string[],
	edge: string,
): Scene["constraints"][number] => ({
	id,
	kind,
	nodes,
	prop: "fill",
	edge: edge as never,
	enabled: true,
});

test("a face of a turned box is refused, and its centre and its size are not", () => {
	// The twin of `gnoedge/2`'s two rotation clauses, asked one edge at a time.
	// The point of the pair is the *asymmetry*: a rotation about the node's own
	// centre leaves the centre and the span exactly where they were, and it is
	// only the two ends of an axis that stop being a number.
	const document = scene([
		node("panel", "rect", { turn: { rotateY: single("30deg") } }),
		node("card", "rect"),
	]);

	const said = refusedEdge(document, "panel", "left");
	assert.ok(said, "a lead edge on a turned node");
	assert.match(said, /“panel” is turned 30° about Y/);
	assert.match(said, /linear arithmetic/);
	assert.match(said, /Horizontal centre/i, "and it offers the rule that would hold");

	assert.ok(refusedEdge(document, "panel", "right"), "and the trail edge");
	assert.equal(refusedEdge(document, "panel", "centerX"), undefined, "a centre survives");
	assert.equal(refusedEdge(document, "panel", "width"), undefined, "and so does a span");
	assert.equal(refusedEdge(document, "card", "left"), undefined, "an unturned node keeps its faces");
	assert.equal(refusedEdge(document, "nobody", "left"), undefined, "and a datum has no rotation");
});

test("a turn that resolves to nothing refuses nothing, and the universe decides which", () => {
	// The argument for taking picks at all: an `angle` token holding two
	// alternatives is a design that is turned and a design that is not, and
	// refusing the edge in the flat one would be a warning with nothing behind it.
	const document = scene(
		[node("panel", "rect", { turn: { rotateZ: [ref("lean")] } })],
		{
			tokens: [
				{ id: "lean", name: "Lean", type: "angle", value: [lit("0deg"), lit("20deg")] },
			],
		},
	);
	// The pick is on the *token*, which is where the branching is: the node holds
	// one alternative and that alternative is a reference.
	assert.equal(
		refusedEdge(document, "panel", "left", { [tokenVar("lean")]: 0 }),
		undefined,
		"flat in this design",
	);
	assert.ok(
		refusedEdge(document, "panel", "left", { [tokenVar("lean")]: 1 }),
		"and turned in the next",
	);
});

test("a gap over a turned member is inert and a mirror over one is exact", () => {
	// Which places a kind reads is taken off `CONSTRAINT_KINDS[k].seed` rather
	// than switched on the kind, which is what makes these two answers different
	// without either of them being written down: `gap`'s seed measures at `trail`
	// then `lead`, and `symmetric`'s measures at `mid` twice.
	const document = scene(
		[
			node("panel", "rect", { turn: { rotateZ: single("12deg") } }),
			node("card", "rect"),
		],
		{
			constraints: [
				rule("k_gap", "gap", ["card", "panel"], "x"),
				rule("k_mirror", "symmetric", ["card", "panel"], "x"),
				rule("k_align", "align", ["card", "panel"], "centerY"),
				rule("k_left", "align", ["card", "panel"], "left"),
			],
		},
	);

	const found = inertConstraints(document);
	assert.deepEqual(
		found.map((one) => one.constraint).sort(),
		["k_gap", "k_left"],
		"the two that read a face, and neither of the two that do not",
	);
	assert.deepEqual(
		found.map((one) => one.member),
		["panel", "panel"],
		"and it is the turned member that is named, not the selected one",
	);
	assert.match(
		found.find((one) => one.constraint === "k_gap")?.why ?? "",
		/measured from one face to the next/,
	);

	// A rule that is switched off says nothing about anything, so it is not here.
	const off = {
		...document,
		constraints: document.constraints.map((c) => ({ ...c, enabled: false })),
	};
	assert.deepEqual(inertConstraints(off), []);
});

test("a refusal reader reduces a copy term before it asks", () => {
	// `docs/merged-plan.md` §6.6: a rule may name the part, the instance's copy of
	// it, one state's copy of that, or a keyframe's — and all four hand the *part*
	// to simplex. Getting this wrong is not a wrong answer, it is silence: the
	// program refuses the edge through `gnoedge/2` and the panel says nothing.
	const document = scene([
		node("def", "frame", {
			children: [node("label", "text", { turn: { rotateZ: single("8deg") } })],
		}),
	]);
	for (const member of [
		"label",
		"inst(b1,label)",
		"stt(b1,hover,label)",
		"kfr(b1,slide,trkd(label,y),2)",
	]) {
		assert.ok(
			refusedEdge(document, member, "left"),
			`${member} did not reduce to the part`,
		);
	}
	assert.equal(
		refusedEdge(document, "stt(b1,hover,nobody)", "left"),
		undefined,
		"a copy of a part the document has not got is nothing at all",
	);
});

test("a rule across a viewport's wall is warned about rather than refused", () => {
	// The third reader, and the only one that refuses nothing. The rule holds,
	// exactly — and it holds about model space, while a camera moves the pixels.
	const cube = node("cube", "mesh");
	const other = node("ring", "mesh");
	const document = scene([
		node("art", "frame", {
			children: [
				node("hero", "viewport", { name: "Hero", children: [cube] }),
				node("side", "viewport", { name: "Side", children: [other] }),
				node("card", "rect", { name: "Card" }),
			],
		}),
	]);

	const across = crossesViewport(document, ["card", "cube"]);
	assert.ok(across, "one in, one out");
	assert.match(across, /inside the 3D view “Hero”/);
	assert.match(across, /moving the camera moves the pixels/);

	const two = crossesViewport(document, ["cube", "ring"]);
	assert.ok(two, "two views is two cameras, and the same surprise");
	assert.match(two, /Each is drawn through its own camera/);

	assert.equal(crossesViewport(document, ["cube"]), undefined, "one member is no seam");
	assert.equal(crossesViewport(document, ["card", "art"]), undefined, "both outside");
	// A view is not inside itself, so a rule between a cube and the box it is
	// drawn in *is* across the seam — and it is the most surprising case of all,
	// because the two look like one thing on the page. Warned, like the rest.
	assert.ok(crossesViewport(document, ["cube", "hero"]));
});
