/**
 * Export: the file is the answer set's picture.
 *
 * Every case below starts from a real document, compiles it, **solves it through
 * the real solver**, reads the answer set back with `readModel` and exports
 * that. Nothing here hands the exporter a hand-built `ModelScene`, and that is
 * the point: the claim this module makes is that the file holds what the solver
 * decided, and a fixture that skipped the solver could not test the claim.
 *
 * Two of these are proofs rather than checks. "the exporter tessellates what the
 * renderer draws" reads the segment counts off `Solid.tsx` itself, so a sphere
 * tuned in the viewport and not in the writer fails here rather than in
 * somebody's download. "a node lands where the solver put it" mounts the
 * exported file as three.js objects and compares against `design-core`'s own
 * matrix chain, which is the only way to know that the two-node origin bridge
 * and the rotation conjugation are right.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
	PULL_ATOM,
	SCENERY_ATOM,
	type ModelScene,
	type Scene,
	type SceneNode,
	applyMatrix,
	compile,
	directSolver,
	emptyScene,
	makeFrame,
	makeSpatial,
	readModel,
	sceneContext,
	sceneMatrixOf,
	single,
} from "@clingo-design/design-core";
import { Object3D, Quaternion, Vector3 } from "three";

import { METRE_IN_EMU, gltfWriter, type GltfJson, type GltfNode } from "./gltf.ts";
import { SOLID_ARGS, exportViewportGltf, tessellate } from "./gltfexport.ts";

const PX = 9525;
const px = (n: number): number => n * PX;

/** The chair's file, in the project's tree — the key `files` is keyed by. */
const CHAIR = "/assets/chair.gltf";

/* ------------------------------------------------------------------ */
/* A document, solved                                                  */
/* ------------------------------------------------------------------ */

const node = (id: string, kind: SceneNode["kind"], extra: Partial<SceneNode>): SceneNode => ({
	id,
	kind,
	name: id,
	frame: makeFrame({ x: 0, y: 0, width: 0, height: 0 }),
	props: {},
	...extra,
});

/**
 * A view with a turned pivot over a sphere, a camera, two lamps and a model.
 *
 * One document that exercises every branch of the emitter at once, because a
 * separate scene per case would be five solves rather than one and would let the
 * branches drift apart without anything noticing.
 */
function scene(): Scene {
	return {
		...emptyScene(),
		nodes: [
			node("board", "frame", {
				frame: makeFrame({ x: 0, y: 0, width: px(800), height: px(600) }),
				children: [
					node("view", "viewport", {
						frame: makeFrame({ x: 0, y: 0, width: px(400), height: px(300) }),
						camera: "cam",
						children: [
							node("pivot", "pivot", {
								frame: makeFrame({ x: px(200), y: px(150), width: 0, height: 0 }),
								turn: { rotateY: single("30deg") },
								children: [
									node("cube", "mesh", {
										frame: makeFrame({ x: px(10), y: px(20), width: px(100), height: px(60) }),
										spatial: makeSpatial({ z: px(5), depth: px(40) }),
										turn: { rotateZ: single("15deg") },
										props: {
											solid: single("sphere"),
											fill: single("#ff0000"),
											roughness: single("0.2"),
											metalness: single("0.8"),
										},
									}),
								],
							}),
							node("cam", "camera", {
								frame: makeFrame({ x: px(200), y: px(150), width: 0, height: 0 }),
								props: { fov: single("60deg"), near: single("2px"), far: single("5000px") },
							}),
							node("sun", "light", {
								props: {
									lamp: single("directional"),
									ink: single("#00ff00"),
									intensity: single("2"),
								},
							}),
							node("glow", "light", {
								props: { lamp: single("ambient"), ink: single("#ffffff"), intensity: single("1") },
							}),
							node("chair", "model", {
								frame: makeFrame({ x: px(50), y: px(50), width: px(80), height: px(80) }),
								spatial: makeSpatial({ depth: px(80) }),
								props: { fill: single("#0000ff") },
								// The reference the document holds: a file in the project's
								// tree and one part of it. It is on the *document* node so
								// that `compile` states `asset/2` and `meshpart/3` and the
								// exporter reads them off the answer set like everything
								// else — the same rule that makes a rule-minted model draw
								// its geometry.
								mesh: {
									src: CHAIR,
									format: "gltf",
									part: { node: 0, primitive: 0 },
									bounds: {
										x: -px(40),
										y: -px(40),
										z: -px(40),
										width: px(80),
										height: px(80),
										depth: px(80),
									},
									triangles: 1,
								},
							}),
						],
					}),
				],
			}),
		],
	};
}

/** One universe of a document, through the real solver. */
async function solved(document: Scene): Promise<ModelScene> {
	const { program, guards } = compile(document);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: 1,
			assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(out.result, "SATISFIABLE", "expected a design");
		return readModel(out.models[0] ?? []);
	} finally {
		await session.close();
	}
}

/** The exported file, parsed back. */
const parse = (text: string): GltfJson => JSON.parse(text) as GltfJson;

/* ------------------------------------------------------------------ */
/* What comes out                                                      */
/* ------------------------------------------------------------------ */

test("a viewport's subtree becomes a glTF 2.0 scene", async () => {
	const out = exportViewportGltf(await solved(scene()));
	assert.equal(out.viewport, "view");
	const json = parse(out.text);
	assert.equal(json.asset.version, "2.0");
	assert.equal(json.asset.generator, "clingo-design");
	// The pivot, the camera, the two lamps and the model — the artboard around
	// the view is not in the file, which is the target's first stated loss.
	assert.equal(json.scenes?.[0]?.nodes?.length, 5);
	assert.equal(json.scenes?.[0]?.name, "view");
});

test("a material is the metallic-roughness the document asked for", async () => {
	const json = parse(exportViewportGltf(await solved(scene())).text);
	const material = json.materials?.find((m) => m.pbrMetallicRoughness?.roughnessFactor === 0.2);
	assert.ok(material, "the sphere's material");
	assert.equal(material.pbrMetallicRoughness?.metallicFactor, 0.8);
	// `#ff0000` is sRGB and glTF's `baseColorFactor` is linear, so red stays 1
	// and the other two stay 0 — a colour that survived the crossing without
	// being touched twice.
	assert.deepEqual(material.pbrMetallicRoughness?.baseColorFactor, [1, 0, 0, 1]);
	assert.equal(material.doubleSided, true);
	assert.equal(material.alphaMode, undefined);
});

test("a camera is a perspective camera, in radians", async () => {
	const json = parse(exportViewportGltf(await solved(scene())).text);
	const lens = json.cameras?.[0]?.perspective;
	assert.ok(lens);
	assert.ok(Math.abs(lens.yfov - Math.PI / 3) < 1e-6, `yfov ${lens.yfov}`);
	// 2px near and 5000px far, as metres.
	assert.ok(Math.abs(lens.znear - px(2) / METRE_IN_EMU) < 1e-9);
	assert.ok(Math.abs((lens.zfar ?? 0) - px(5000) / METRE_IN_EMU) < 1e-9);
});

test("lamps are KHR_lights_punctual, and an ambient one is named as a stand-in", async () => {
	const out = exportViewportGltf(await solved(scene()));
	const json = parse(out.text);
	assert.deepEqual(json.extensionsUsed, ["KHR_lights_punctual"]);
	const lights = json.extensions?.KHR_lights_punctual?.lights ?? [];
	assert.equal(lights.length, 2);
	const sun = lights.find((light) => light.name === "sun");
	assert.equal(sun?.type, "directional");
	assert.deepEqual(sun?.color, [0, 1, 0]);
	assert.equal(sun?.intensity, 2);
	// glTF has no ambient lamp at all, so the document's becomes a very dim
	// directional one and the difference is a sentence rather than a surprise.
	const glow = lights.find((light) => light.name === "glow");
	assert.equal(glow?.type, "directional");
	assert.ok((glow?.intensity ?? 1) < 0.2);
	assert.match(out.lost.join(" "), /Ambient light/);
});

test("a model whose file was not handed over is its bounding box, and says which file", async () => {
	const out = exportViewportGltf(await solved(scene()));
	assert.match(out.lost.join(" "), /Model “chair” is in the file as its bounding box/);
	// The sentence now names the file, which it could not before: the answer set
	// carries the path, so an export that was handed no bytes can say exactly what
	// it was not handed rather than only that something was missing.
	assert.match(out.lost.join(" "), /\/assets\/chair\.gltf/);
	const json = parse(out.text);
	// The stand-in is a box, so it has the same twelve triangles a box has.
	const boxes = (json.meshes ?? []).filter((mesh) => mesh.name === "chair");
	assert.equal(boxes.length, 1);
});

test("a model whose file is handed over is its own geometry", async () => {
	// A file in the tree, keyed by its path — the same shape `ExportOptions.images`
	// takes in the other exporter. This used to be a resolver keyed by node id,
	// which existed only because a `ModelScene` could not say which payload a
	// model drew; it says so now, in `asset/2` and `meshpart/3`.
	const out = exportViewportGltf(await solved(scene()), {
		files: { [CHAIR]: oneTriangle() },
	});
	assert.doesNotMatch(out.lost.join(" "), /bounding box/);
	const json = parse(out.text);
	const chair = (json.meshes ?? []).find((m) => m.name === "chair");
	assert.ok(chair);
	// One triangle came in, one triangle went out — and it wears the *node's*
	// material, `#0000ff`, rather than the file's (which has none).
	const indices = json.accessors?.[chair.primitives[0]?.indices ?? -1];
	assert.equal(indices?.count, 3);
	const material = json.materials?.[chair.primitives[0]?.material ?? -1];
	assert.deepEqual(material?.pbrMetallicRoughness?.baseColorFactor, [0, 0, 1, 1]);
});

test("a file with several parts exports the one the node draws, and no others", async () => {
	// The regression `payloadParts` would reintroduce, and the reason it was
	// deleted rather than adapted: it read every primitive of every mesh, which
	// was right when a payload held one primitive and exports an entire chair for
	// one of its ten parts now that the payload is the whole file the person
	// imported.
	const writer = gltfWriter();
	const mesh = writer.meshOf(
		[
			// Primitive 0: two triangles, four metres across. Primitive 1: one
			// triangle, two metres across. Either one is recognisable in the output
			// by itself, which is what makes "only one of them" checkable.
			{
				triangles: {
					positions: Float32Array.from([-2, -1, 0, 2, -1, 0, -2, 1, 0, 2, 1, 0]),
					indices: Uint32Array.from([0, 1, 2, 1, 3, 2]),
				},
				material: undefined,
			},
			{
				triangles: {
					positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
					indices: Uint32Array.from([0, 1, 2]),
				},
				material: undefined,
			},
		],
		"Chair",
	);
	writer.roots([writer.node({ mesh, name: "Chair" })]);

	const document = scene();
	const chairNode = viewportChild(document, "chair");
	// The node draws the *second* primitive — a mesh in two materials is two
	// document nodes, and this is the one that owns primitive 1.
	chairNode.mesh = { ...chairNode.mesh!, part: { node: 0, primitive: 1 } };

	const out = exportViewportGltf(await solved(document), {
		files: { [CHAIR]: new TextEncoder().encode(writer.text()) },
	});
	const json = parse(out.text);
	const chair = (json.meshes ?? []).find((m) => m.name === "chair");
	assert.ok(chair);
	assert.equal(chair.primitives.length, 1, "one primitive out, not the file's two");
	const indices = json.accessors?.[chair.primitives[0]?.indices ?? -1];
	assert.equal(indices?.count, 3, "the one-triangle part, not the two-triangle one");
});

test("a part the file no longer holds is a bounding box with the reason", async () => {
	// The stale reference of `scene.ts`'s §2.1: somebody replaced the file at that
	// path with a structurally different one. The node still has a real box the
	// solver placed, so it draws and exports as that box — and the loss list says
	// which chair and why, rather than reporting a missing file that is right
	// there.
	const document = scene();
	const chairNode = viewportChild(document, "chair");
	chairNode.mesh = { ...chairNode.mesh!, part: { node: 0, primitive: 4 } };
	const out = exportViewportGltf(await solved(document), {
		files: { [CHAIR]: oneTriangle() },
	});
	assert.match(out.lost.join(" "), /Model “chair” is in the file as its bounding box/);
	assert.match(out.lost.join(" "), /has no part 4/);
});

/** A one-triangle glTF, which is the smallest thing a `model` can point at. */
function oneTriangle(): Uint8Array {
	const writer = gltfWriter();
	const mesh = writer.mesh(
		{
			positions: Float32Array.from([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
			indices: Uint32Array.from([0, 1, 2]),
		},
		undefined,
		"Chair",
	);
	writer.roots([writer.node({ mesh, name: "Chair" })]);
	return new TextEncoder().encode(writer.text());
}

/** One of the viewport's own children, by id, for a test that edits it. */
function viewportChild(document: Scene, id: string): SceneNode {
	const found = document.nodes[0]?.children?.[0]?.children?.find((child) => child.id === id);
	assert.ok(found, `the document holds ${id}`);
	return found;
}

test("a flat document exports an empty scene rather than throwing", () => {
	const empty: ModelScene = readModel([]);
	const out = exportViewportGltf(empty);
	assert.equal(out.viewport, undefined);
	assert.match(out.lost.join(" "), /no 3D view/);
	assert.equal(parse(out.text).scenes?.[0]?.nodes?.length, 0);
});

test("the loss list is the target's, so it moves upstream without an edit here", async () => {
	const out = exportViewportGltf(await solved(scene()));
	// The three sentences `docs/three-d-spec.md` §10.3 froze for this target come
	// first and come from `gltfTarget()`, which reads `EXPORT_TARGETS.gltf` the
	// day M12 writes one.
	assert.match(out.lost[0] ?? "", /Everything outside the 3D view/);
	assert.match(out.lost[1] ?? "", /Behaviour/);
	assert.match(out.lost[2] ?? "", /Materials are approximated/);
});

/* ------------------------------------------------------------------ */
/* The two proofs                                                      */
/* ------------------------------------------------------------------ */

test("the exporter tessellates what the renderer draws", () => {
	// `Solid.tsx` is JSX, so it cannot be imported into a test Node runs — and
	// importing it would not help anyway, because its segment counts live inside
	// the elements it returns rather than in a table. So the numbers are read out
	// of the *source*, which is the thing that has to agree: a sphere retuned in
	// the viewport and not in `SOLID_ARGS` fails here, with both lists printed.
	//
	// A source-text assertion is a blunt instrument and it is used deliberately
	// rather than for want of a better one. The alternative was to move the six
	// argument lists into a shared `.ts` module, which means editing a file this
	// step does not own; the alternative to *that* was to let the writer and the
	// renderer drift, which is the one failure this whole export is about.
	const source = readFileSync(new URL("./Solid.tsx", import.meta.url), "utf8");
	const drawn: Record<string, number[]> = {
		box: [], sphere: [], cylinder: [], cone: [], plane: [], torus: [],
	};
	for (const kind of Object.keys(drawn)) {
		const found = new RegExp(`${kind}Geometry\\s+args=\\{\\[([^\\]]*)\\]\\}`).exec(source);
		assert.ok(found, `Solid.tsx draws a ${kind}`);
		drawn[kind] = found[1]!.split(",").map((n) => Number(n.trim()));
	}
	for (const [kind, args] of Object.entries(drawn)) {
		assert.deepEqual(args, [...SOLID_ARGS[kind as keyof typeof SOLID_ARGS]], kind);
	}

	for (const kind of Object.keys(SOLID_ARGS) as (keyof typeof SOLID_ARGS)[]) {
		const soup = tessellate(kind);
		assert.ok(soup.positions.length > 0, `${kind} tessellated`);
		assert.equal(soup.indices.length % 3, 0);
	}
	// The one that is easy to state and easy to get wrong: a unit sphere has a
	// diameter of one, so the box is the scale rather than twice it.
	const sphere = tessellate("sphere");
	let maximum = 0;
	for (const value of sphere.positions) maximum = Math.max(maximum, Math.abs(value));
	assert.ok(Math.abs(maximum - 0.5) < 1e-6, `radius ${maximum}`);
});

/** The world position of a node in a parsed glTF, computed by three.js. */
function worldOf(json: GltfJson, wanted: (node: GltfNode) => boolean): Vector3 | undefined {
	const build = (index: number, parent: Object3D): Object3D | undefined => {
		const source = json.nodes?.[index];
		if (!source) return undefined;
		const object = new Object3D();
		if (source.translation) object.position.fromArray(source.translation);
		if (source.rotation) object.quaternion.copy(new Quaternion().fromArray(source.rotation));
		if (source.scale) object.scale.fromArray(source.scale);
		parent.add(object);
		let found = wanted(source) ? object : undefined;
		for (const child of source.children ?? []) found = build(child, object) ?? found;
		return found;
	};
	const root = new Object3D();
	let found: Object3D | undefined;
	for (const index of json.scenes?.[0]?.nodes ?? []) found = build(index, root) ?? found;
	root.updateMatrixWorld(true);
	return found ? found.getWorldPosition(new Vector3()) : undefined;
}

test("a node lands where the solver put it, through the file", async () => {
	const document = scene();
	const out = exportViewportGltf(await solved(document));
	const json = parse(out.text);

	// The file's answer: the mesh-bearing node under `cube`, which is where the
	// geometry actually hangs, walked by three.js.
	const world = worldOf(json, (node) => node.mesh !== undefined && node.name === "cube");
	assert.ok(world, "the sphere's mesh node");

	// The document's answer: `design-core`'s own chain, in the viewport's model
	// space, applied to the node's own origin — which is its centre.
	const matrix = sceneMatrixOf(document, "cube", sceneContext(document, {}));
	assert.ok(matrix);
	const centre = applyMatrix(matrix, { x: 0, y: 0, z: 0 });

	// Crossed by `F = diag(1, −1, −1)` and converted to metres, which is the one
	// crossing the exporter makes.
	const expected = [
		centre.x / METRE_IN_EMU,
		-centre.y / METRE_IN_EMU,
		-centre.z / METRE_IN_EMU,
	];
	const slack = px(0.1) / METRE_IN_EMU;
	assert.ok(Math.abs(world.x - expected[0]!) < slack, `x ${world.x} vs ${expected[0]}`);
	assert.ok(Math.abs(world.y - expected[1]!) < slack, `y ${world.y} vs ${expected[1]}`);
	assert.ok(Math.abs(world.z - expected[2]!) < slack, `z ${world.z} vs ${expected[2]}`);
});
