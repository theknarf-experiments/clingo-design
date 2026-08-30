/**
 * The document's third axis: the six kinds, the two spatial dimensions, the
 * three rotations, and the readers over them.
 *
 * Colocated beside `scene.ts`'s other table tests rather than folded into
 * `spatial.ts`'s, because these are assertions about what a *document* holds —
 * the tables, the sparse records and the four readers that walk them — and
 * `spatial.ts` is about what an answer set says. The two files are written by
 * two steps and the split is where the dependency runs.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { explore } from "./explore.ts";
import {
	CONSTRAINT_KINDS,
	CONSTRAINT_NAMES,
	DIMENSIONS,
	DIMENSIONS_3D,
	EDGES,
	KINDS,
	NODE_KINDS,
	PROPS,
	SPATIALS,
	SPATIAL_DIMS,
	type Scene,
	type SceneNode,
	TURNS,
	TURN_NAMES,
	dimensionSpec,
	edgeOptions,
	emptyScene,
	isOpaque,
	isSpatialKind,
	isTurned,
	makeFrame,
	makeSpatial,
	rotationFrozen,
	sceneContext,
	spatialDim,
	spatialFrozen,
	spatialOf,
	stateTouches,
	turnMdeg,
	turnOf,
	withSpatial,
} from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { frameVar, lit, ref, rotateVar, single } from "./values.ts";

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

/* ------------------------------------------------------------------ */
/* The tables                                                          */
/* ------------------------------------------------------------------ */

test("every kind answers both of the new columns, and only a view stops the pointer", () => {
	for (const kind of NODE_KINDS) {
		assert.equal(typeof KINDS[kind].spatial, "boolean", `${kind}.spatial`);
		assert.equal(typeof KINDS[kind].opaque, "boolean", `${kind}.opaque`);
	}
	// One kind, and it is the seam. `opaque` is what makes "does the pointer go
	// inside?" a lookup rather than a judgement call, and a second opaque kind
	// would be a second seam nobody drew.
	assert.deepEqual(
		NODE_KINDS.filter((k) => KINDS[k].opaque),
		["viewport"],
	);
	// The viewport itself is *not* spatial: it is a rectangle on the artboard,
	// which is exactly what lets every 2D thing above it carry on unchanged.
	assert.deepEqual(
		NODE_KINDS.filter((k) => KINDS[k].spatial),
		["pivot", "mesh", "model", "camera", "light"],
	);
	assert.equal(isOpaque({ kind: "viewport" }), true);
	assert.equal(isOpaque({ kind: "frame" }), false);
	assert.equal(isSpatialKind({ kind: "mesh" }), true);
	assert.equal(isSpatialKind({ kind: "viewport" }), false);
});

test("the third axis is two more dimensions of the kinds the geometry already has", () => {
	assert.deepEqual(SPATIALS, ["z", "depth"]);
	// Planar first, so a loop over the six is a loop in reading order.
	assert.deepEqual(DIMENSIONS_3D, [...DIMENSIONS, ...SPATIALS]);
	// `z` is a place and `depth` is an extent, which is all any geometry rule
	// ever asks — and it is why the third axis needed no new rule shapes.
	assert.equal(SPATIAL_DIMS.z.role, "pos");
	assert.equal(SPATIAL_DIMS.depth.role, "span");
	for (const dim of DIMENSIONS_3D) {
		assert.equal(dimensionSpec(dim).type, "length");
		assert.ok(dimensionSpec(dim).label.length > 0);
	}
});

test("the three rotations name three axes and three CSS functions", () => {
	assert.deepEqual(TURN_NAMES, ["rotateX", "rotateY", "rotateZ"]);
	assert.deepEqual(
		TURN_NAMES.map((t) => TURNS[t].axis),
		["x", "y", "z"],
	);
	// The CSS function is the key, which is what keeps the exporter from needing
	// a second table to translate one into the other.
	for (const turn of TURN_NAMES) assert.equal(TURNS[turn].css, turn);
});

test("the new properties are ordinary properties of ordinary types", () => {
	for (const prop of [
		"solid",
		"roughness",
		"metalness",
		"lamp",
		"intensity",
		"fov",
		"near",
		"far",
		"perspective",
	] as const) {
		assert.ok(PROPS[prop], `${prop} should be in the table`);
	}
	// Colour is reused rather than re-invented: a mesh's base colour is `fill`
	// and a light's is `ink`, so the same `color` token drives both and a brand
	// palette lights a scene with nothing wired up.
	assert.ok(KINDS.mesh.props.includes("fill"));
	assert.ok(KINDS.light.props.includes("ink"));
	// A model states no fill default: an imported material is the file's, and a
	// fill the document did not ask for would repaint every asset on import.
	assert.deepEqual(KINDS.model.defaults, {});
	// `perspective` belongs to the surface the turned children sit on.
	assert.ok(KINDS.frame.props.includes("perspective"));
	for (const kind of NODE_KINDS) {
		if (kind === "frame") continue;
		assert.ok(!KINDS[kind].props.includes("perspective"), kind);
	}
});

/* ------------------------------------------------------------------ */
/* Reading one node                                                    */
/* ------------------------------------------------------------------ */

test("a node that says nothing about the third axis is at z 0, depth 0", () => {
	const flat = node("r1", "rect");
	assert.equal(spatialDim(flat, "z"), 0);
	assert.equal(spatialDim(flat, "depth"), 0);
	assert.deepEqual(spatialOf(flat), { z: 0, depth: 0 });
	// And an empty record answers the same, which is what lets the reader be
	// asked before anything has checked whether the field is there.
	assert.deepEqual(spatialOf(node("r2", "rect", { spatial: {} })), {
		z: 0,
		depth: 0,
	});
});

test("a stated third axis reads in EMU, and follows a token like any other", () => {
	const lifted = node("m1", "mesh", {
		spatial: { z: single("24px"), depth: single("40px") },
	});
	assert.deepEqual(spatialOf(lifted), { z: px(24), depth: px(40) });

	const linked = node("m2", "mesh", { spatial: { z: [ref("lift")] } });
	const scene: Scene = {
		...emptyScene(),
		tokens: [
			{ id: "lift", name: "lift", type: "length", value: single("64px") },
		],
		nodes: [linked],
	};
	assert.equal(spatialDim(linked, "z", sceneContext(scene)), px(64));
	// A universe is chosen by the pick, exactly as a frame dimension is.
	const two: Scene = {
		...scene,
		tokens: [
			{
				id: "lift",
				name: "lift",
				type: "length",
				value: [lit("64px"), lit("8px")],
			},
		],
	};
	assert.equal(
		spatialDim(linked, "z", sceneContext(two, { "tok(lift)": 1 })),
		px(8),
	);
});

test("makeSpatial writes only what it was told, so flat has one spelling", () => {
	assert.deepEqual(makeSpatial({}), {});
	const only = makeSpatial({ z: px(24) });
	assert.deepEqual(Object.keys(only), ["z"]);
	assert.deepEqual(only.z, single("24px"));
});

test("a drag writes a third axis where there was silence, and never over a link", () => {
	// Silence is writable: absence is not a link, it is the document saying
	// nothing, and there is no other way to state a z for the first time.
	const flat = node("m1", "mesh");
	const lifted = withSpatial(flat, { z: px(24) });
	assert.notEqual(lifted, flat);
	assert.deepEqual(lifted.spatial, { z: single("24px") });

	// A unit survives the edit, exactly as it does through `withFrame`.
	const inPoints = node("m2", "mesh", { spatial: { z: single("12pt") } });
	assert.deepEqual(withSpatial(inPoints, { z: px(17) }).spatial?.z, [
		lit("12.75pt"),
	]);

	// A link is the token's to change: quietly replacing it with a number would
	// unwire the very thing the designer set up.
	const linked = node("m3", "mesh", { spatial: { z: [ref("lift")] } });
	assert.equal(withSpatial(linked, { z: px(24) }), linked);

	// A patch that says what is already stored is not an edit at all.
	const same = node("m4", "mesh", { spatial: { z: single("24px") } });
	assert.equal(withSpatial(same, { z: px(24) }), same);
	assert.equal(withSpatial(same, {}), same);

	// A plane is a real primitive: `depth` is not clamped the way a width is.
	const flattened = withSpatial(node("m5", "mesh"), { depth: 0 });
	assert.equal(spatialDim(flattened, "depth"), 0);
});

test("a spatial dimension is frozen by a link and by nothing else", () => {
	assert.equal(spatialFrozen(node("m1", "mesh"), "z"), false);
	assert.equal(
		spatialFrozen(node("m2", "mesh", { spatial: { z: single("8px") } }), "z"),
		false,
	);
	assert.equal(
		spatialFrozen(node("m3", "mesh", { spatial: { z: [ref("lift")] } }), "z"),
		true,
	);
	// An empty value is silence, not a link — the same reading `stateTouches`
	// gives a cleared delta.
	assert.equal(
		spatialFrozen(node("m4", "mesh", { spatial: { z: [] } }), "z"),
		false,
	);
});

/* ------------------------------------------------------------------ */
/* Rotation                                                            */
/* ------------------------------------------------------------------ */

test("a rotation reads in thousandths of a degree, exact or not at all", () => {
	const still = node("m1", "mesh");
	assert.equal(turnMdeg(still, "rotateY"), 0);
	assert.deepEqual(turnOf(still), { rotateX: 0, rotateY: 0, rotateZ: 0 });

	const turned = node("m2", "mesh", {
		turn: { rotateY: single("22.5deg"), rotateZ: single("0.25turn") },
	});
	assert.equal(turnMdeg(turned, "rotateY"), 22500);
	assert.equal(turnMdeg(turned, "rotateZ"), 90000);
	assert.equal(turnMdeg(turned, "rotateX"), 0);

	// A bare number is a count everywhere else in this system, so it is no angle
	// here — the same refusal `motionMs` makes of `"200"`, and it falls to the
	// same answer the program's own default rule gives.
	assert.equal(
		turnMdeg(node("m3", "mesh", { turn: { rotateX: single("45") } }), "rotateX"),
		0,
	);
	// And so is a rotation nothing can spell exactly.
	assert.equal(
		turnMdeg(
			node("m4", "mesh", { turn: { rotateX: single("1.0005deg") } }),
			"rotateX",
		),
		0,
	);
});

test("whether a node is turned is a question about a universe, not about a field", () => {
	const scene: Scene = {
		...emptyScene(),
		tokens: [
			{
				id: "tilt",
				name: "tilt",
				type: "angle",
				value: [lit("0deg"), lit("30deg")],
			},
		],
		nodes: [node("m1", "mesh", { turn: { rotateY: [ref("tilt")] } })],
	};
	const card = scene.nodes[0];
	// Flat in the first design, tilted in the second — and the quantities a rule
	// may be about differ between them, which is why this takes a context.
	assert.equal(isTurned(card, sceneContext(scene, { "tok(tilt)": 0 })), false);
	assert.equal(isTurned(card, sceneContext(scene, { "tok(tilt)": 1 })), true);
	// The resize handles follow the same answer.
	assert.equal(
		rotationFrozen(card, sceneContext(scene, { "tok(tilt)": 1 })),
		true,
	);
	assert.equal(
		rotationFrozen(card, sceneContext(scene, { "tok(tilt)": 0 })),
		false,
	);
	// The field being present is not the question: a turn of zero is no turn.
	assert.equal(
		isTurned(node("m2", "mesh", { turn: { rotateZ: single("0deg") } })),
		false,
	);
});

test("the keys a rotation and a third axis reach the program under", () => {
	// A z and a depth are ordinary frame variables — there is no third key
	// family, which is what makes the solver's geometry rules carry six for
	// free. A rotation is its own, because an angle is not a length.
	assert.equal(frameVar("m1", "z"), "fval(m1,z)");
	assert.equal(frameVar("m1", "depth"), "fval(m1,depth)");
	assert.equal(rotateVar("m1", "rotateY"), "rval(m1,rotateY)");
});

/* ------------------------------------------------------------------ */
/* Which edges a panel offers                                          */
/* ------------------------------------------------------------------ */

test("a rule being built is offered everything its kind allows", () => {
	const scene = emptyScene();
	for (const kind of CONSTRAINT_NAMES) {
		// Empty members is the whole list: a rule that has not said what it is
		// about yet has nothing to be narrowed against, and refusing everything
		// would be refusing the first click.
		assert.deepEqual(edgeOptions(scene, kind, []), CONSTRAINT_KINDS[kind].edges);
	}
});

test("a rule over flat members is offered the two axes they live on", () => {
	const scene: Scene = {
		...emptyScene(),
		nodes: [node("a", "rect"), node("b", "rect")],
	};
	for (const kind of CONSTRAINT_NAMES) {
		const offered = edgeOptions(scene, kind, ["a", "b"]);
		// Never more than the kind's own table entry allows.
		for (const edge of offered) {
			assert.ok(CONSTRAINT_KINDS[kind].edges.includes(edge));
			assert.notEqual(EDGES[edge].axis as string, "z");
		}
		// And every planar edge the kind allows is still offered, which is the
		// whole no-regression claim for this reader.
		assert.deepEqual(
			offered,
			CONSTRAINT_KINDS[kind].edges.filter(
				(e) => (EDGES[e].axis as string) !== "z",
			),
		);
	}
});

test("a member the reader cannot resolve is treated as flat, not as anything", () => {
	// A datum, an instance part and a state copy are all things a rule may name
	// and none of them is a node id. Offering an edge the program will refuse
	// through `gnoedge/2` is a worse failure than not offering one it would have
	// accepted, so the narrowing errs the safe way here and the exact answer is
	// `refusedEdge`'s job.
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			node("view", "viewport", { children: [node("cube", "mesh")] }),
		],
	};
	const planar = CONSTRAINT_KINDS.align.edges.filter(
		(e) => (EDGES[e].axis as string) !== "z",
	);
	assert.deepEqual(edgeOptions(scene, "align", ["cube", "cg(page,3,left)"]), planar);
	assert.deepEqual(edgeOptions(scene, "align", ["cube", "nosuchnode"]), planar);
});

/* ------------------------------------------------------------------ */
/* A state's delta                                                     */
/* ------------------------------------------------------------------ */

test("a delta that only turns a part is a delta that says something", () => {
	// Without this the copy is never materialised, so the mesh the state meant
	// to turn is never minted and a hover that spins a card does nothing at all
	// — in a document that solves cleanly and reports nothing.
	assert.equal(stateTouches({ turn: { rotateY: single("30deg") } }), true);
	// A cleared entry is the same claim as no entry: an empty value resolves to
	// no literal and decides nothing.
	assert.equal(stateTouches({ turn: {} }), false);
	assert.equal(stateTouches({ turn: { rotateY: [] } }), false);
	// And the third axis, through the widened frame delta.
	assert.equal(stateTouches({ frame: { z: single("40px") } }), true);
	assert.equal(stateTouches({ frame: { depth: [] } }), false);
});

/* ------------------------------------------------------------------ */
/* Through the real compiler and the real solver                       */
/* ------------------------------------------------------------------ */

const sceneWithAView = (): Scene => ({
	...emptyScene(),
	nodes: [
		{
			...node("page", "frame", {
				children: [
					node("card", "rect"),
					node("view", "viewport", {
						camera: "cam",
						children: [
							node("cam", "camera"),
							node("key", "light"),
							node("rig", "pivot", {
								children: [
									node("cube", "mesh", {
										spatial: { z: single("24px"), depth: single("40px") },
										turn: { rotateY: single("30deg") },
									}),
								],
							}),
						],
					}),
				],
			}),
			frame: makeFrame({ x: 0, y: 0, width: px(800), height: px(600) }),
		},
	],
});

test("a mesh, a camera and a light are ordinary scene nodes in the program", () => {
	// The invariant this whole track exists for, asserted where it can actually
	// be checked: there is no parallel 3D document model, so every one of these
	// reaches the program through the same `node/1` and `kind/2` a rectangle
	// does, and the layer list, hit testing, grouping and the multiverse all
	// work on them because none of them asks what a node *is*.
	const { program } = compile(sceneWithAView());
	for (const [id, kind] of [
		["view", "viewport"],
		["cam", "camera"],
		["key", "light"],
		["rig", "pivot"],
		["cube", "mesh"],
	] as const) {
		assert.ok(program.includes(`node(${id}).`), `${id} should be a node`);
		assert.ok(program.includes(`kind(${id},${kind}).`), `${id} is a ${kind}`);
	}
	// And the tree is the tree: a mesh hangs off a pivot hangs off the view.
	assert.ok(program.includes("child(view,cam)."));
	assert.ok(program.includes("child(rig,cube)."));
	assert.ok(program.includes("child(page,view)."));
});

test("adding a whole 3D scene to a document does not add a design to it", async () => {
	// Every node, every property and every rotation above is written with one
	// alternative, so none of it is a choice — which is the same sentence the
	// state-machine work earned for states, one feature over.
	const withView = await explore(sceneWithAView(), directSolver, { limit: 16 });
	const flat: Scene = {
		...emptyScene(),
		nodes: [
			{
				...node("page", "frame", { children: [node("card", "rect")] }),
				frame: makeFrame({ x: 0, y: 0, width: px(800), height: px(600) }),
			},
		],
	};
	const without = await explore(flat, directSolver, { limit: 16 });
	assert.equal(without.count, 1);
	assert.equal(withView.count, 1);
	// Every node is drawn, including the ones inside the view: the layer list
	// and the exporter both need them, and only the *hit testers* stop.
	for (const id of ["card", "view", "cam", "key", "rig", "cube"]) {
		assert.ok(withView.universes[0].visible.has(id), `${id} should render`);
	}
});

test("a solid held as two primitives is two designs, because a value is a value", async () => {
	const scene = sceneWithAView();
	const view = scene.nodes[0].children?.[1] as SceneNode;
	const cube = (view.children?.[2] as SceneNode).children?.[0] as SceneNode;
	cube.props = { solid: [lit("box"), lit("sphere")] };
	const result = await explore(scene, directSolver, { limit: 16 });
	assert.equal(result.count, 2);
});
