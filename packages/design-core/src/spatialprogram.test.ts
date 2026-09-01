/**
 * The third axis, as a claim about the generated program — through the real
 * compiler and the real solver, never through a hand-written atom list.
 *
 * `machineprogram.test.ts` is the model this follows, and for the same reason:
 * every sentence the feature says is a sentence about what clingo grounds. That
 * a flat document grounds none of it, that a viewport puts *its own subtree*
 * into three dimensions and not the page it sits on, that a rotated box loses
 * its faces and keeps its centre — none of those can be checked by reading the
 * rule text, because the interesting failures are all rules that ground when
 * they should not.
 *
 * **The first two tests are the ones that matter most and they are deliberately
 * first.** One is the no-regression proof: every template's universe count, node
 * set, frames, paint and both export targets, held against a fixture captured
 * from the tree exactly as it stood before this step touched `compile.ts`. The
 * other is the unbounded objective — a document with a viewport on one artboard
 * and an ordinary `align` on another — which is the failure that would have
 * shipped as "the app stopped answering", and which is invisible to every test
 * that only looks at documents holding one thing at a time.
 *
 * Written in pixels at the document end and EMU in the middle, the seam
 * `geometric.test.ts` and `machineprogram.test.ts` both name.
 */
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseAtom } from "./atoms.ts";
import { PULL_ATOM, SCENERY_ATOM, compile, variableCounts } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { exportUniverse } from "./export.ts";
import { explore } from "./explore.ts";
import { readModel } from "./model.ts";
import {
	type Constraint,
	type Machine,
	type Scene,
	type SceneNode,
	EDGES,
	EDGE_NAMES,
	dimension,
	emptyScene,
	makeFrame,
	makeSpatial,
} from "./scene.ts";
import { isSpatialScene, refusedEdge } from "./spatial.ts";
import { TEMPLATES } from "./templates/index.ts";
import { EMU_PER_PX } from "./units.ts";
import { type Value, lit, rotateVar, single } from "./values.ts";

const P = EMU_PER_PX;
const px = (n: number): number => n * P;

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

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

/** An artboard, which is the one kind every document's top level is. */
const board = (
	id: string,
	at: { x: number; y: number },
	children: SceneNode[],
): SceneNode => ({
	...node(id, "frame", { children }),
	frame: makeFrame({ x: px(at.x), y: px(at.y), width: px(800), height: px(600) }),
});

const at = (id: string, kind: SceneNode["kind"], box: {
	x: number;
	y: number;
	w: number;
	h: number;
}, extra: Partial<SceneNode> = {}): SceneNode => ({
	...node(id, kind, extra),
	frame: makeFrame({ x: px(box.x), y: px(box.y), width: px(box.w), height: px(box.h) }),
});

const scened = (...nodes: SceneNode[]): Scene => ({ ...emptyScene(), nodes });

const geometric = (
	id: string,
	kind: Constraint["kind"],
	nodes: string[],
	edge: Constraint["edge"],
	/** In pixels, like every other number in this file's documents. */
	value?: number,
): Constraint => ({
	id,
	kind,
	prop: "fill",
	nodes,
	edge,
	value: value === undefined ? undefined : dimension(px(value)),
	enabled: true,
});

/* ------------------------------------------------------------------ */
/* Reading the program back                                            */
/* ------------------------------------------------------------------ */

/**
 * One answer set, with whatever extra `#show` the caller needs.
 *
 * Several predicates this file is about are *derived and not shown* — `s3/1`,
 * `gedgeof/2`, `grotated/1` — because nothing in the studio reads them. Asking
 * for them here rather than showing them from the compiler is the honest way
 * round: a `#show` added for a test is a cost every solve in the app would pay
 * for a fact no panel wants.
 */
async function answer(scene: Scene, extra = ""): Promise<string[]> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(`${program}\n${extra}\n`, "--project");
	try {
		const out = await session.solve({
			models: 1,
			assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(out.result, "SATISFIABLE", "expected a design");
		return out.models[0] ?? [];
	} finally {
		await session.close();
	}
}

/** Every atom of one predicate, as its argument lists. */
const of = (atoms: readonly string[], name: string): string[][] =>
	atoms.flatMap((text) => {
		const atom = parseAtom(text);
		return atom && atom.name === name ? [atom.args] : [];
	});

/** Whether a 0-ary atom is in the answer. */
const holds = (atoms: readonly string[], name: string): boolean =>
	atoms.includes(name);

/**
 * A theory variable's value, in pixels.
 *
 * clingo-lpx answers in exact rationals, so `"320/3"` is a real answer and not
 * a formatting accident — reading it as a fraction rather than parsing an
 * integer is what lets an assertion about a whole pixel fail loudly when the
 * answer is not one.
 */
function lpx(atoms: readonly string[], variable: string): number | undefined {
	for (const text of atoms) {
		const m = /^__lpx\((.+),"([^"]*)"\)$/.exec(text);
		if (!m || m[1] !== variable) continue;
		const slash = m[2].indexOf("/");
		const n =
			slash === -1
				? Number(m[2])
				: Number(m[2].slice(0, slash)) / Number(m[2].slice(slash + 1));
		return n / P;
	}
	return undefined;
}

/* ------------------------------------------------------------------ */
/* 1. No regression                                                    */
/* ------------------------------------------------------------------ */

/**
 * What a template comes to, reduced to something a fixture can hold.
 *
 * Digests rather than the text itself, because the whole HTML of thirteen
 * templates in every universe is a megabyte of fixture nobody would ever read —
 * and what is being asserted is *equality*, which a digest settles exactly. The
 * node ids are kept whole, because when this fails the first question is which
 * node appeared or went missing, and a digest cannot answer it.
 */
function summarise(template: (typeof TEMPLATES)[number], result: {
	count: number;
	total: number | null;
	universes: ReadonlyArray<Parameters<typeof exportUniverse>[1] & { model: { byId: Record<string, unknown> } }>;
}): unknown {
	const scene = template.create();
	const digest = (text: string): string =>
		createHash("sha256").update(text).digest("hex").slice(0, 16);
	const ids = new Set<string>();
	for (const u of result.universes) {
		for (const id of Object.keys(u.model.byId)) ids.add(id);
	}
	return {
		count: result.count,
		total: result.total,
		ids: [...ids].sort(),
		universes: result.universes.map((u) => {
			const byId = u.model.byId as Record<string, { frame?: unknown; rendered?: unknown }>;
			const nodes = Object.keys(byId).sort();
			return {
				nodes: digest(nodes.join(",")),
				frames: digest(
					nodes.map((id) => `${id}:${JSON.stringify(byId[id]?.frame ?? null)}`).join("\n"),
				),
				rendered: digest(
					nodes.map((id) => `${id}:${JSON.stringify(byId[id]?.rendered ?? null)}`).join("\n"),
				),
				html: digest(exportUniverse(scene, u, { target: "html", title: template.id }).text),
				svg: digest(exportUniverse(scene, u, { target: "svg", title: template.id }).text),
			};
		}),
	};
}

/**
 * The fixture, captured from the working tree **before one line of this step
 * landed** — the compiler as it stood after the type and reader steps and
 * before the third axis reached `compile.ts`.
 *
 * Regenerating it is not a repair. If a number in here moves, either a template
 * changed on purpose, in which case this file is updated in the same commit and
 * the commit says which universe moved and why, or the third axis has leaked
 * into a document that has none — which is the one failure this whole track
 * promised could not happen.
 *
 * The `html` and `svg` digests of every universe of every template moved once,
 * with the paint step, and that is the one regeneration this fixture has taken.
 * It was not optional and it was not a repair: a fill stopped being the
 * `background` shorthand and became `background-color`, and every exported file
 * gained the two `@property` registrations and an `isolation`, so the bytes of
 * every document this repo has ever exported changed by construction. What the
 * regeneration had to prove — and did, field by field, before a byte was written
 * — is that `count`, `total`, `ids`, `nodes`, `frames` and `rendered` did **not**
 * move for any universe of any template, and that `html` and `svg` moved for
 * *every* one of them. A paint change that left an export alone would mean the
 * property never reached the file; a paint change that moved a frame would mean
 * it reached the geometry, which is the thing `MEASURED_PROPS` exists to stop.
 *
 * Two ids were **added** later and neither is a regeneration: `deck` and
 * `solids` are the templates written after the ladder and the third axis
 * shipped, so they have no "before" to have moved away from. What they get out
 * of being in here is the same thing every other id gets from tomorrow onwards —
 * a count, a node set, a frame, a paint and both exports, pinned. Adding an id
 * is an ordinary change; changing one that was already here is the thing this
 * comment is about.
 */
const GOLDENS = JSON.parse(
	readFileSync(new URL("./spatialprogram.goldens.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

for (const template of TEMPLATES) {
	test(`no regression: "${template.id}" solves, reads and exports exactly as before`, async () => {
		const scene = template.create();
		const result = await explore(scene, directSolver, { limit: 32 });
		assert.deepEqual(
			summarise(template, result as never),
			GOLDENS[template.id],
			`the third axis changed the "${template.id}" template`,
		);
	});
}

/**
 * The one template that is in three dimensions — the twin of
 * `SPATIAL_TEMPLATES` in `spatial.test.ts`, named for the same reason.
 *
 * Every other template is a document written before the third axis existed, and
 * the loop below is the promise that they still are: not "mostly flat", not
 * "flat unless something opted in", but zero atoms of every predicate the third
 * axis owns, across twelve documents and every universe of each. The list is
 * spelled out in the loop rather than counted here, because a count is a number
 * that goes stale the first time the vocabulary grows and a reader who trusts it
 * stops reading the assertions.
 */
const SPATIAL_TEMPLATES = new Set(["solids"]);

test("no template's atoms hold one word of the third axis", async () => {
	// The gate, asserted where a designer could actually observe it: not by
	// reading the rules — they are emitted always, like the geometry and machine
	// rules and for the same reason — but by looking at what they ground to.
	// Every predicate of the vocabulary, and nothing of any of them.
	for (const template of TEMPLATES) {
		const scene = template.create();
		if (SPATIAL_TEMPLATES.has(template.id)) {
			// The other end of the partition, so the exclusion above cannot be used
			// to quieten a template that leaked into the third axis by accident.
			assert.equal(isSpatialScene(scene), true, `${template.id} reads as flat`);
			continue;
		}
		assert.equal(isSpatialScene(scene), false, `${template.id} reads as spatial`);
		const atoms = await answer(
			scene,
			"#show s3/1.\n#show spatial/0.\n#show zstated/1.\n#show grotated/1.\n",
		);
		assert.equal(holds(atoms, "spatial"), false, `${template.id} has a third axis`);
		assert.equal(of(atoms, "s3").length, 0, `${template.id} has an s3 node`);
		assert.equal(of(atoms, "zstated").length, 0, `${template.id} states a z`);
		assert.equal(of(atoms, "grotated").length, 0, `${template.id} turns something`);
		assert.equal(of(atoms, "turn").length, 0, `${template.id} has a rotation`);
		assert.equal(of(atoms, "vcam").length, 0, `${template.id} looks through a camera`);
		assert.equal(of(atoms, "tris").length, 0, `${template.id} holds geometry`);
		// The newest word of the vocabulary, in the list on the day it was added.
		// `meshpart/3` is stated only for a node carrying a `MeshRef`, and no
		// template holds a `model` — so this is zero for the same structural
		// reason `tris/2` is, and the assertion is here so that it stays a reason
		// rather than a coincidence.
		assert.equal(of(atoms, "meshpart").length, 0, `${template.id} names a mesh part`);
		for (const [, dim] of of(atoms, "frame")) {
			assert.ok(
				dim === "x" || dim === "y" || dim === "width" || dim === "height",
				`${template.id} has a frame on ${dim}`,
			);
		}
		// And the program text, for what the atoms cannot speak for: the gate is
		// never stated, and every third-axis vocabulary row is a *rule* behind it
		// rather than a fact.
		//
		// This used to assert that `gedge(front` did not appear in the text at all,
		// which was true only because `EDGES` had no z rows in it. Now that it has
		// them, the row is generated always — like every other rule in this program
		// — and what keeps the promise is the guard, so the guard is what is
		// asserted. The atom scan above is the other half and the stronger one:
		// generated or not, a flat document grounds none of it.
		const { generated } = compile(scene);
		assert.equal(generated.includes("\nspatial.\n"), false, template.id);
		assert.ok(
			generated.includes("gedge(front,z,pos) :- spatial."),
			`${template.id} has no guarded front row`,
		);
		assert.equal(generated.includes("gedge(front,z,pos)."), false, template.id);
		assert.equal(generated.includes("gplace(front,lead)."), false, template.id);
		assert.equal(generated.includes("gaxis(z)."), false, template.id);
	}
});

/* ------------------------------------------------------------------ */
/* 2. The unbounded objective                                          */
/* ------------------------------------------------------------------ */

/**
 * Two artboards: one with two rectangles a rule lines up, one with a 3D view.
 *
 * The rule and the view have nothing whatever to do with each other, which is
 * the entire point of the test.
 */
const twoArtboards = (withView: boolean): Scene => ({
	...scened(
		board("page", { x: 0, y: 0 }, [
			at("a", "rect", { x: 40, y: 40, w: 120, h: 80 }),
			at("b", "rect", { x: 300, y: 200, w: 120, h: 80 }),
		]),
		...(withView
			? [
					board("page2", { x: 900, y: 0 }, [
						at("view", "viewport", { x: 20, y: 20, w: 480, h: 320 }, {
							camera: "cam",
							children: [
								at("cam", "camera", { x: 0, y: 0, w: 0, h: 0 }),
								at("cube", "mesh", { x: 100, y: 100, w: 100, h: 100 }),
							],
						}),
					]),
				]
			: []),
	),
	constraints: [geometric("k_align", "align", ["a", "b"], "left")],
});

test("a rule on one artboard is untouched by a 3D view on another", async () => {
	// The most serious thing the merge found, and it is invisible to every test
	// that looks at one feature at a time. `gaxis/1` grows the moment the
	// document holds a viewport; if `gpos/2` had gone on reading it, `a` and `b`
	// — plain rectangles, nine hundred pixels away from any camera — would each
	// have gained a `gd(N,z)` in the shared `&minimize` with no `frame(N,z,V)`
	// to bound it from below. An unbounded objective is not a wrong picture, it
	// is no answer at all, and the symptom is the whole app going quiet.
	const flat = await explore(twoArtboards(false), directSolver, { sample: "first" });
	const spatial = await explore(twoArtboards(true), directSolver, { sample: "first" });
	assert.equal(flat.count, 1);
	assert.equal(spatial.count, 1, "a 3D view is not a design decision");
	// Not merely satisfiable: satisfied in exactly the same place.
	assert.deepEqual(spatial.universes[0].solved.a, flat.universes[0].solved.a);
	assert.deepEqual(spatial.universes[0].solved.b, flat.universes[0].solved.b);
	assert.equal(spatial.universes[0].solved.a?.x, spatial.universes[0].solved.b?.x);
});

test("a rectangle outside every view keeps its four dimensions and no more", async () => {
	const atoms = await answer(twoArtboards(true));
	const frames = (id: string): string[] =>
		of(atoms, "frame")
			.filter(([node]) => node === id)
			.map(([, dim]) => dim)
			.sort();
	assert.deepEqual(frames("a"), ["height", "width", "x", "y"]);
	assert.deepEqual(frames("b"), ["height", "width", "x", "y"]);
	// ...and everything inside the view has six.
	assert.deepEqual(frames("cube"), ["depth", "height", "width", "x", "y", "z"]);
	assert.deepEqual(frames("view"), ["depth", "height", "width", "x", "y", "z"]);
	assert.deepEqual(frames("cam"), ["depth", "height", "width", "x", "y", "z"]);
	// The artboard the view sits on is *not* in the third axis — a viewport puts
	// its own subtree there, not the page it is drawn on — so it keeps its four
	// like any other rectangle. It gains a z only where the world chain needs a
	// floor to run down to, which is when a rule actually places something inside
	// the view; nothing here does, and the chain test below is where that case is.
	assert.deepEqual(frames("page2"), ["height", "width", "x", "y"]);
	assert.deepEqual(frames("page"), ["height", "width", "x", "y"]);
});

/* ------------------------------------------------------------------ */
/* 3. The gate, and who is in the third axis                           */
/* ------------------------------------------------------------------ */

const oneView = (extra: Partial<SceneNode> = {}): Scene =>
	scened(
		board("page", { x: 0, y: 0 }, [
			at("card", "rect", { x: 20, y: 20, w: 100, h: 40 }),
			at("view", "viewport", { x: 200, y: 40, w: 480, h: 320 }, {
				camera: "cam",
				children: [
					at("cam", "camera", { x: 0, y: 0, w: 0, h: 0 }),
					at("key", "light", { x: 0, y: 0, w: 0, h: 0 }),
					at("rig", "pivot", { x: 40, y: 60, w: 0, h: 0 }, {
						spatial: { z: single("80px") },
						children: [
							at("cube", "mesh", { x: 10, y: 20, w: 100, h: 100 }, {
								spatial: { z: single("30px"), depth: single("40px") },
								...extra,
							}),
						],
					}),
				],
			}),
		]),
	);

test("the gate is one atom, and the reader and the compiler agree about it", async () => {
	const flat = scened(board("page", { x: 0, y: 0 }, [at("card", "rect", { x: 0, y: 0, w: 10, h: 10 })]));
	assert.equal(isSpatialScene(flat), false);
	assert.equal(compile(flat).generated.includes("\nspatial.\n"), false);

	// Three openings, and the reader has to answer for all three or the panel
	// and the program are describing different documents.
	const view = oneView();
	assert.equal(isSpatialScene(view), true);
	assert.ok(compile(view).generated.includes("\nspatial.\n"));

	const lifted = scened(
		board("page", { x: 0, y: 0 }, [
			at("card", "rect", { x: 0, y: 0, w: 10, h: 10 }, { spatial: { z: single("24px") } }),
		]),
	);
	assert.equal(isSpatialScene(lifted), true);
	const turned = scened(
		board("page", { x: 0, y: 0 }, [
			at("card", "rect", { x: 0, y: 0, w: 10, h: 10 }, { turn: { rotateZ: single("12deg") } }),
		]),
	);
	assert.equal(isSpatialScene(turned), true);
	for (const scene of [lifted, turned]) {
		const atoms = await answer(scene, "#show spatial/0.\n#show s3/1.\n");
		assert.ok(holds(atoms, "spatial"));
		assert.deepEqual(of(atoms, "s3"), [["card"]], "only the node the document lifted");
	}
});

test("a viewport puts its own subtree in the third axis and nothing else", async () => {
	const atoms = await answer(oneView(), "#show s3/1.\n");
	assert.deepEqual(
		of(atoms, "s3")
			.map(([id]) => id)
			.sort(),
		["cam", "cube", "key", "rig", "view"],
	);
	const frames = new Map<string, Set<string>>();
	for (const [id, dim] of of(atoms, "frame")) {
		(frames.get(id) ?? frames.set(id, new Set()).get(id)!).add(dim);
	}
	assert.equal(frames.get("card")?.has("z"), false, "a card is not in a scene");
	assert.equal(frames.get("cube")?.has("depth"), true);
});

test("the grounding a view costs is six dimensions a node and not one more", async () => {
	// The budget, asserted rather than assumed: a view with twelve meshes in it
	// is twelve times six plus the view's own six plus the camera's, and the
	// page it is drawn on gains exactly one atom — the z floor the world chain
	// needs, which is not a depth and never becomes one.
	const meshes = Array.from({ length: 12 }, (_, i) =>
		at(`m${i}`, "mesh", { x: i * 10, y: 0, w: 20, h: 20 }),
	);
	const scene = scened(
		board("page", { x: 0, y: 0 }, [
			at("view", "viewport", { x: 0, y: 0, w: 480, h: 320 }, { children: meshes }),
		]),
	);
	const atoms = await answer(scene);
	const count = (id: string): number => of(atoms, "frame").filter(([n]) => n === id).length;
	for (const mesh of meshes) assert.equal(count(mesh.id), 6, mesh.id);
	assert.equal(count("view"), 6);
	// Nothing is gsolved here, so there is no z chain and the page keeps four.
	assert.equal(count("page"), 4);
	assert.equal(of(atoms, "frame").length, 12 * 6 + 6 + 4);
});

/* ------------------------------------------------------------------ */
/* 4. Rotation                                                         */
/* ------------------------------------------------------------------ */

test("a rotation is a value: it follows a token, and reads as nothing when it is nothing", async () => {
	const scene = oneView({ turn: { rotateY: single("30deg") } });
	const atoms = await answer(scene);
	const turns = new Map(
		of(atoms, "turn").map(([id, axis, mdeg]) => [`${id}/${axis}`, Number(mdeg)]),
	);
	assert.equal(turns.get("cube/rotateY"), 30000, "thousandths of a degree");
	// The other two, and every other node in the third axis, default to zero —
	// so a reader never has to ask whether the field was there.
	assert.equal(turns.get("cube/rotateX"), 0);
	assert.equal(turns.get("rig/rotateZ"), 0);
	// ...and a node outside the third axis has no rotation at all, not a zero.
	assert.equal(turns.has("card/rotateZ"), false);

	// A unit no whole thousandth spells is no angle, which is the same silence a
	// dimension that reads as no length gets — never a rounding nobody typed.
	const radians = await answer(oneView({ turn: { rotateY: single("1rad") } }));
	const found = of(radians, "turn").find(([id, axis]) => id === "cube" && axis === "rotateY");
	assert.deepEqual(found, ["cube", "rotateY", "0"]);
	assert.equal(of(radians, "grotated").length, 0);
});

test("mdeg and tally read the same text differently, and neither guesses", async () => {
	// The fifth literal bridge beside the four that shipped. A bare number is a
	// count of forty-five things everywhere else in this system, so guessing
	// would make a grid of forty-five columns and a rotation of forty-five
	// degrees the same text.
	const scene = oneView({ turn: { rotateY: [lit("45deg"), lit("45")] } });
	const { generated } = compile(scene);
	const literals = new Map(
		[...generated.matchAll(/^literal\((l\d+),"([^"]*)"\)\.$/gm)].map((m) => [m[2], m[1]]),
	);
	const deg = literals.get("45deg");
	const bare = literals.get("45");
	assert.ok(deg && bare);
	assert.ok(generated.includes(`mdeg(${deg},45000).`));
	assert.equal(generated.includes(`mdeg(${bare},`), false);
	assert.ok(generated.includes(`tally(${bare},45).`));
	assert.equal(generated.includes(`tally(${deg},`), false);
});

test("two rotations are two designs, because t_value is projected", async () => {
	// Without `#project t_value/3` the two universes differ in nothing that is
	// projected and collapse into one with an arbitrary pick — the flat design
	// and the tilted one, and the designer is shown whichever the solver reached
	// first. Exactly the argument f_value/3 already makes, one quantity over.
	const two = oneView({ turn: { rotateY: [lit("0deg"), lit("30deg")] } });
	const result = await explore(two, directSolver, { limit: 8 });
	assert.equal(result.count, 2);
	const angles = result.universes
		.map((u) => u.pick[rotateVar("cube", "rotateY")])
		.sort();
	assert.deepEqual(angles, [0, 1]);
	// And one alternative is one design, so a document nobody asked to vary
	// pays nothing for the variable being minted unconditionally.
	assert.equal((await explore(oneView({ turn: { rotateY: single("30deg") } }), directSolver, { limit: 8 })).count, 1);
	// The studio and the program agree about which rows exist.
	assert.equal(variableCounts(two)[rotateVar("cube", "rotateY")], 2);
});

/* ------------------------------------------------------------------ */
/* 5. The refusal                                                      */
/* ------------------------------------------------------------------ */

/** Two meshes in one view, with a rule over them and an optional turn. */
const twoMeshes = (
	kind: Constraint["kind"],
	edge: Constraint["edge"],
	turn: Value | undefined,
	value?: number,
): Scene => ({
	...scened(
		board("page", { x: 0, y: 0 }, [
			at("view", "viewport", { x: 0, y: 0, w: 480, h: 320 }, {
				children: [
					at("m1", "mesh", { x: 20, y: 20, w: 100, h: 60 }, turn ? { turn: { rotateY: turn } } : {}),
					at("m2", "mesh", { x: 300, y: 150, w: 140, h: 60 }),
				],
			}),
		]),
	),
	constraints: [geometric("k", kind, ["m1", "m2"], edge, value)],
});

test("a turned box has no faces, and the quantity is never minted", async () => {
	// A turned box's left edge is |w*cos t| + |h*sin t| away from its centre, and
	// clingo-lpx is linear arithmetic. So the rule does not mean something
	// approximate, and it does not mean something else: it means nothing, and
	// gedgeof/2 is where that is visible.
	const turned = await answer(
		twoMeshes("align", "left", single("30deg")),
		"#show gedgeof/2.\n#show gnoedge/2.\n#show grotated/1.\n",
	);
	assert.deepEqual(of(turned, "grotated"), [["m1"]]);
	assert.deepEqual(
		of(turned, "gedgeof").map((a) => a.join("/")).sort(),
		["m2/left"],
		"the turned member is offered no left at all",
	);
	assert.ok(of(turned, "gnoedge").some(([n, e]) => n === "m1" && e === "left"));
	// The lefts are therefore unrelated: m1 stays exactly where it was drawn.
	assert.equal(lpx(turned, "lv(m1,x)"), 20);
	assert.equal(lpx(turned, "lv(m2,x)"), 300);

	// Take the turn off and the same document is the ordinary rule it looks
	// like — the refusal is about the *value*, not about the field being there.
	const flat = await answer(twoMeshes("align", "left", single("0deg")), "#show gedgeof/2.\n");
	assert.deepEqual(
		of(flat, "gedgeof").map((a) => a.join("/")).sort(),
		["m1/left", "m2/left"],
	);
	assert.equal(lpx(flat, "lv(m1,x)"), lpx(flat, "lv(m2,x)"));
});

test("a turned box keeps its centre and its size, exactly", async () => {
	// The other half of the line, and the half that makes drawing it worth it:
	// rotation is about the node's own centre, so a centre is as true after the
	// turn as before and a span is the node in its own frame.
	const centres = await answer(twoMeshes("align", "centerX", single("30deg")));
	const centre = (id: string, w: number): number =>
		(lpx(centres, `lv(${id},x)`) ?? 0) + (lpx(centres, `lsz(${id},width)`) ?? w) / 2;
	assert.equal(centre("m1", 100), centre("m2", 140));

	const sizes = await answer(twoMeshes("equalSize", "width", single("30deg")));
	assert.equal(lpx(sizes, "lsz(m1,width)"), lpx(sizes, "lsz(m2,width)"));

	// And a gap, which is measured face to face, says nothing at all about the
	// same member — the two answers differ because the two questions do. The
	// centre survives the refusal, because it is honest and because `gap` names a
	// whole axis and `gneed/2` asks for all three places on it; what the gap rule
	// itself reads is `glead`/`gtrail`, and neither of those is there.
	const gap = await answer(
		twoMeshes("gap", "x", single("30deg"), 24),
		"#show gedgeof/2.\n",
	);
	assert.deepEqual(
		of(gap, "gedgeof")
			.filter(([n]) => n === "m1")
			.map(([, e]) => e),
		["centerX"],
		"a gap needs faces, and a turned box has none",
	);
	assert.equal(lpx(gap, "lv(m1,x)"), 20, "so it stays exactly where it was drawn");
	assert.equal(lpx(gap, "lv(m2,x)"), 300);
	// The same rule over the same two meshes, unturned, is the ordinary gap: m2's
	// left face sits 24px past m1's right one.
	const held = await answer(twoMeshes("gap", "x", undefined, 24));
	assert.equal(
		(lpx(held, "lv(m2,x)") ?? 0) - ((lpx(held, "lv(m1,x)") ?? 0) + (lpx(held, "lsz(m1,width)") ?? 0)),
		24,
	);
});

test("refusedEdge and gnoedge/2 agree, edge by edge, on the same document", async () => {
	// **The two-readers test, and the reason `refusedEdge` was allowed to exist.**
	// The panel has to grey a row while there is no answer set at all, and the
	// program has to refuse the quantity while there is — so there are two
	// implementations of one rule, and two implementations of one rule are a thing
	// that can disagree. This is the same arrangement `machineHealth` and
	// `munreached/2` have, held the same way: not by spot-checking a sentence, but
	// by asking both readers about every member and every edge of one document and
	// comparing the two sets.
	//
	// The document turns one of two meshes, which is one of the two levers
	// `gnoedge/2` has; the other is the third clause, a `z` edge on a node outside
	// the third axis, and the loop below reaches it because both meshes are inside
	// a viewport and every edge is asked. The partition is stated rather than
	// assumed, so that a vocabulary that lost its z rows again would fail here
	// instead of passing vacuously.
	assert.deepEqual(
		EDGE_NAMES.filter((e) => EDGES[e].axis === "z"),
		["front", "centerZ", "back", "depth", "z"],
		"all five third-axis quantities are in the vocabulary and therefore asked about",
	);

	const document = twoMeshes("align", "left", single("30deg"));
	const atoms = await answer(document, "#show gnoedge/2.\n");
	const refused = new Set(
		of(atoms, "gnoedge").map(([node, edge]) => `${node}/${edge}`),
	);
	// Only the edges the program could have minted at all: `gnoedge/2` is ranged
	// over this document's own members, so an edge of a node no rule names is not
	// a disagreement, it is a question neither reader was asked.
	const mine = new Set<string>();
	for (const member of document.constraints[0].nodes) {
		for (const edge of EDGE_NAMES) {
			if (refusedEdge(document, member, edge) !== undefined) {
				mine.add(`${member}/${edge}`);
			}
		}
	}
	assert.deepEqual(
		[...mine].sort(),
		[...refused].filter((k) => k.startsWith("m1/") || k.startsWith("m2/")).sort(),
		"the reader and the program refuse exactly the same quantities",
	);
	assert.ok(mine.size > 0, "and they agree about something, not about nothing");

	// **The third clause, which had nowhere to fire until `EDGES` grew its z
	// rows.** A rule between a rectangle on the page and a mesh in a view, about a
	// depth: the mesh has a front and the rectangle has not, so the quantity is
	// never minted for it and the rule is satisfied by a box the document does not
	// contain unless something refuses it. Both readers refuse it, and only for
	// the member that is outside the third axis.
	const across: Scene = {
		...scened(
			board("page", { x: 0, y: 0 }, [
				at("card", "rect", { x: 40, y: 40, w: 120, h: 80 }),
				at("view", "viewport", { x: 300, y: 0, w: 480, h: 320 }, {
					children: [at("m1", "mesh", { x: 20, y: 20, w: 100, h: 60 })],
				}),
			]),
		),
		constraints: [geometric("k_deep", "align", ["card", "m1"], "centerZ")],
	};
	const deep = await answer(across, "#show gnoedge/2.\n");
	const deepRefused = new Set(
		of(deep, "gnoedge").map(([node, edge]) => `${node}/${edge}`),
	);
	const deepMine = new Set<string>();
	for (const member of across.constraints[0].nodes) {
		for (const edge of EDGE_NAMES) {
			if (refusedEdge(across, member, edge) !== undefined) {
				deepMine.add(`${member}/${edge}`);
			}
		}
	}
	// All five z quantities, and only for the member that has none of them. The
	// program refuses the whole family at once — `gnoedge/2`'s third clause ranges
	// over `gedge(E,z,_)` and not over the edge this rule happens to name — and the
	// reader, asked one edge at a time, gives the same five.
	assert.deepEqual(
		[...deepMine].sort(),
		["card/back", "card/centerZ", "card/depth", "card/front", "card/z"],
	);
	assert.deepEqual([...deepMine].sort(), [...deepRefused].sort());
	assert.match(
		refusedEdge(across, "card", "centerZ") ?? "",
		/no front, no back and no depth/,
	);
	assert.equal(refusedEdge(across, "m1", "centerZ"), undefined, "the mesh keeps it");

	// The other half of the partition: unturn it and both go silent together.
	const flat = twoMeshes("align", "left", single("0deg"));
	const none = await answer(flat, "#show gnoedge/2.\n");
	assert.deepEqual(of(none, "gnoedge"), []);
	for (const member of flat.constraints[0].nodes) {
		for (const edge of EDGE_NAMES) {
			assert.equal(refusedEdge(flat, member, edge), undefined, `${member}/${edge}`);
		}
	}
});

test("a rule about depth is an ordinary rule, and the vocabulary is what made it one", async () => {
	// **The payoff of `EDGES` growing its five z rows**, and the thing that was
	// impossible before them: a designer could write a rule about `left` from a
	// menu and had to write one about `front` by hand, against `wv/2` and `lsz/2`,
	// in the power panel. There was no menu entry, because there was no edge.
	//
	// Nothing in the program had to change for this. `gedge/3` and `gplace/2` were
	// already emitted from the table behind the `spatial` gate, the geometry rules
	// read the table rather than naming edges, and `gaxis(z)`/`gspan(depth)` have
	// been there since the third axis landed. What was missing was the vocabulary
	// row, which is the whole argument for `compile()` never naming an edge.
	const stacked = (kind: Constraint["kind"], edge: Constraint["edge"], value?: number): Scene => ({
		...scened(
			board("page", { x: 0, y: 0 }, [
				at("view", "viewport", { x: 0, y: 0, w: 480, h: 320 }, {
					children: [
						at("m1", "mesh", { x: 20, y: 20, w: 100, h: 60 }, {
							spatial: makeSpatial({ z: px(40), depth: px(30) }),
						}),
						at("m2", "mesh", { x: 300, y: 150, w: 140, h: 60 }, {
							spatial: makeSpatial({ z: px(200), depth: px(50) }),
						}),
					],
				}),
			]),
		),
		constraints: [geometric("k", kind, ["m1", "m2"], edge, value)],
	});

	// Front faces together: both sit at the same z, and the depths are untouched.
	const front = await answer(stacked("align", "front"));
	assert.equal(lpx(front, "lv(m1,z)"), lpx(front, "lv(m2,z)"));
	assert.equal(lpx(front, "lsz(m1,depth)"), 30, "a place rule moves and does not resize");
	assert.equal(lpx(front, "lsz(m2,depth)"), 50);

	// Depth centres together, which is a different answer because the depths differ.
	const centres = await answer(stacked("align", "centerZ"));
	const middle = (id: string): number =>
		(lpx(centres, `lv(${id},z)`) ?? 0) + (lpx(centres, `lsz(${id},depth)`) ?? 0) / 2;
	assert.equal(middle("m1"), middle("m2"));
	assert.notEqual(lpx(centres, "lv(m1,z)"), lpx(centres, "lv(m2,z)"));

	// A depth is a span like a width, and a gap on z is measured face to face.
	const same = await answer(stacked("equalSize", "depth"));
	assert.equal(lpx(same, "lsz(m1,depth)"), lpx(same, "lsz(m2,depth)"));
	const gap = await answer(stacked("gap", "z", 24));
	assert.equal(
		(lpx(gap, "lv(m2,z)") ?? 0) - ((lpx(gap, "lv(m1,z)") ?? 0) + (lpx(gap, "lsz(m1,depth)") ?? 0)),
		24,
	);
});

test("a turned node is still placed, because a turn about a centre commutes with a move", async () => {
	// The refusal is narrow on purpose. A rotated mesh under a pin on its centre
	// lands exactly where it should, and saying otherwise would have made the
	// third axis a place where the solver stops working.
	const scene = twoMeshes("pin", "centerX", single("30deg"), 200);
	scene.constraints = [geometric("k", "pin", ["m1"], "centerX", 200)];
	const atoms = await answer(scene);
	assert.equal((lpx(atoms, "lv(m1,x)") ?? 0) + (lpx(atoms, "lsz(m1,width)") ?? 0) / 2, 200);
});

/* ------------------------------------------------------------------ */
/* 6. The world chain                                                  */
/* ------------------------------------------------------------------ */

test("the world chain reaches z, through the seam and up to the canvas", async () => {
	// A mesh inside a pivot inside a view inside an artboard: four offsets, one
	// of which — the artboard's — the document never wrote, because an artboard
	// is not in the third axis. Without the floor the last scene default
	// supplies, wv(page,z) is a free variable and every z below it comes back off
	// a number simplex was free to choose.
	const scene: Scene = {
		...oneView(),
		constraints: [geometric("k", "pin", ["cube"], "centerX", 300)],
	};
	const atoms = await answer(scene, "#show s3/1.\n");
	// The document says: rig at z 80 inside the view, cube at z 30 inside it,
	// and the view and the page at nothing at all, which is zero.
	assert.equal(lpx(atoms, "wv(cube,z)"), 110);
	assert.equal(lpx(atoms, "wv(rig,z)"), 80);
	assert.equal(lpx(atoms, "wv(view,z)"), 0);
	assert.equal(lpx(atoms, "wv(page,z)"), 0);
	// The floor is a z and never a depth: the page is a rectangle on the canvas,
	// not a box in a scene, and it is emphatically still not `s3`.
	const pageFrames = of(atoms, "frame")
		.filter(([id]) => id === "page")
		.map(([, dim]) => dim)
		.sort();
	assert.deepEqual(pageFrames, ["height", "width", "x", "y", "z"]);
	assert.equal(
		of(atoms, "s3").some(([id]) => id === "page"),
		false,
	);
});

test("a rule between two 3D nodes is an ordinary rule — the contract's worked example", async () => {
	// Verbatim from the `% Three dimensions.` block of CONTRACT, because a
	// worked example nobody runs is a claim rather than an example. EDGES has no
	// z rows yet, so a rule about depth is written against wv/2 directly; the
	// planar half of the same rule is what `align ... on centerX` compiles to.
	const scene: Scene = {
		...scened(
			board("page", { x: 0, y: 0 }, [
				at("view", "viewport", { x: 0, y: 0, w: 480, h: 320 }, {
					children: [
						at("cube", "mesh", { x: 20, y: 20, w: 100, h: 100 }, {
							spatial: { z: single("0px") },
						}),
						at("pillar", "mesh", { x: 200, y: 20, w: 100, h: 100 }),
					],
				}),
			]),
		),
		constraints: [geometric("k", "align", ["cube", "pillar"], "centerX")],
		rules: [
			"gsolved(cube). gsolved(pillar).",
			"&sum{ wv(cube,z); -wv(pillar,z) } = 240*emupx.",
		].join("\n"),
	};
	const atoms = await answer(scene);
	assert.equal((lpx(atoms, "wv(cube,z)") ?? 0) - (lpx(atoms, "wv(pillar,z)") ?? 0), 240);
	const centre = (id: string): number =>
		(lpx(atoms, `lv(${id},x)`) ?? 0) + (lpx(atoms, `lsz(${id},width)`) ?? 0) / 2;
	assert.equal(centre("cube"), centre("pillar"));
});

/* ------------------------------------------------------------------ */
/* 7. What the document says about a scene                             */
/* ------------------------------------------------------------------ */

test("a view looks through a camera, or through nothing, and never silently through a rect", async () => {
	const atoms = await answer(oneView());
	assert.deepEqual(of(atoms, "looks"), [["view", "cam"]]);
	assert.deepEqual(of(atoms, "vcam"), [["view", "cam"]]);

	// A camera the document names but that is not a camera decides nothing — the
	// same silence a dangling instanceOf leaves. The renderer frames the subtree
	// itself and the status line says so.
	const wrong = oneView();
	const view = wrong.nodes[0].children?.[1] as SceneNode;
	view.camera = "key";
	const atomsWrong = await answer(wrong);
	assert.deepEqual(of(atomsWrong, "looks"), [["view", "key"]]);
	assert.deepEqual(of(atomsWrong, "vcam"), []);

	const dangling = oneView();
	((dangling.nodes[0].children?.[1] as SceneNode).camera = "nope");
	assert.deepEqual(of(await answer(dangling), "vcam"), []);
});

test("hiding a camera stops the marker and not the looking", async () => {
	// vcam/2 is a claim about which camera a view looks through, not about what
	// is painted. A designer who hides a camera means "stop drawing its marker",
	// and a view that went black would be the tool answering a question nobody
	// asked.
	const scene: Scene = { ...oneView(), rules: "hidden(cam)." };
	const atoms = await answer(scene);
	assert.deepEqual(of(atoms, "vcam"), [["view", "cam"]]);
	assert.equal(
		of(atoms, "visible").some(([id]) => id === "cam"),
		false,
	);
});

test("an imported mesh is a node and its vertices are not", async () => {
	const scene = scened(
		board("page", { x: 0, y: 0 }, [
			at("view", "viewport", { x: 0, y: 0, w: 480, h: 320 }, {
				children: [
					at("bust", "model", { x: 0, y: 0, w: 200, h: 200 }, {
						mesh: {
							src: "/assets/bust.glb",
							format: "glb",
							// The second and third integers of the sentence: which glTF node
							// of that file, and which primitive of its mesh. Node 2 and
							// primitive 1 rather than a pair of zeros, so a compiler that
							// emitted a plausible default instead of reading the ref would
							// fail here rather than pass.
							part: { node: 2, primitive: 1 },
							bounds: { x: 0, y: 0, width: px(200), height: px(200), z: 0, depth: px(200) },
							triangles: 240_000,
						},
					}),
				],
			}),
		]),
	);
	// No `#show asset/2.` of its own any more: the compiler shows it, because
	// `ModelScene.assets` reads it and for a while nothing did — the reader was
	// written and the directive was not, so every model fell back to its
	// stand-in box for want of one line. A second show here duplicated the atom,
	// which is how that was noticed.
	const atoms = await answer(scene);
	assert.deepEqual(of(atoms, "tris"), [["bust", "240000"]]);
	// A path in the project's tree — and now the path of the file *somebody
	// imported*, under the name they chose, for both kinds. `asset/2` used to
	// carry `/assets/<hash>` for a mesh, because the importer minted a payload
	// per primitive and nobody had named those; a model references the imported
	// file itself now, so the predicate means one thing rather than
	// one-and-a-half.
	assert.deepEqual(of(atoms, "asset"), [["bust", '"/assets/bust.glb"']]);
	// ...and which part of that file, because a file is a chair and a node is a
	// leg. Two plain integers, straight off `MeshRef.part`, and asserted here
	// beside `asset/2` for the reason the comment above it in `compile.ts` gives:
	// the reader in `model.ts` and the `#show` that feeds it must ship together
	// or the atom is invisible, and an invisible `meshpart/3` looks exactly like
	// a missing file — which is how `asset/2` went unshown for months.
	assert.deepEqual(of(atoms, "meshpart"), [["bust", "2", "1"]]);
	// And the third leg of that sentence, because two of the three have been
	// shipped without the third twice now. `readModel` is what the renderer
	// actually holds, and an atom nothing reads is exactly as invisible as an
	// atom nothing shows — `Model.tsx` would draw its stand-in box either way,
	// which is the failure that went unnoticed for months the last time.
	const read = readModel(atoms);
	assert.equal(read.assets.bust, "/assets/bust.glb", "the path reaches the renderer");
	const bust = read.byId.bust;
	assert.equal(bust?.asset, "/assets/bust.glb", "on the node as well as in the map");
	// On the node and deliberately *not* in a second map beside `assets`: the map
	// exists so a project can be audited without walking the tree, and a primitive
	// index answers no question anybody asks of a project.
	assert.deepEqual(bust?.part, { node: 2, primitive: 1 });
	assert.ok(!("parts" in read), "no second map on the scene");
	// The count is emitted for its own sake, and this is the cheapest useful
	// thing the whole section buys: a budget is a rule a team writes on day one,
	// with a name in the core, a switch and a `why`.
	const budget: Scene = {
		...scene,
		constraints: [
			{
				id: "mesh_budget",
				kind: "custom",
				prop: "fill",
				nodes: [],
				enabled: true,
			},
		],
		rules: "viol(mesh_budget) :- tris(_,K), K > 200000.",
	};
	await assert.rejects(() => explore(budget, directSolver, { limit: 4 }));
});

/* ------------------------------------------------------------------ */
/* 8. Components, instances and machines                               */
/* ------------------------------------------------------------------ */

/** A definition holding a turned, lifted mesh, and two uses of it. */
const rotatedComponent = (machines: Machine[] = []): Scene => ({
	...scened(
		board("page", { x: 0, y: 0 }, [
			at("view", "viewport", { x: 0, y: 0, w: 700, h: 400 }, {
				children: [
					at("widget", "pivot", { x: 0, y: 0, w: 120, h: 120 }, {
						component: true,
						children: [
							at("cube", "mesh", { x: 10, y: 10, w: 100, h: 100 }, {
								turn: { rotateY: single("30deg") },
								spatial: { depth: single("40px") },
							}),
						],
					}),
					at("u1", "instance", { x: 200, y: 0, w: 120, h: 120 }, { instanceOf: "widget" }),
					at("u2", "instance", { x: 400, y: 0, w: 120, h: 120 }, { instanceOf: "widget" }),
				],
			}),
		]),
	),
	machines,
});

test("a rotated part of a definition turns in every instance, with no machine anywhere", async () => {
	// The bug this arrangement exists to prevent: with `tbase/4` filed under the
	// machine rules, a definition holding a turned mesh, placed twice, with no
	// machine in the document, draws two *unturned* meshes — a component bug
	// wearing a machine's clothes, on a document that has no machine.
	const atoms = await answer(rotatedComponent());
	const turns = new Map(
		of(atoms, "turn").map(([id, axis, mdeg]) => [`${id}/${axis}`, Number(mdeg)]),
	);
	assert.equal(turns.get("cube/rotateY"), 30000);
	assert.equal(turns.get("inst(u1,cube)/rotateY"), 30000);
	assert.equal(turns.get("inst(u2,cube)/rotateY"), 30000);
	// One atom per (node, axis), not two: the default cannot unsay the base.
	const y = of(atoms, "turn").filter(([id, axis]) => id === "inst(u1,cube)" && axis === "rotateY");
	assert.equal(y.length, 1);
	assert.equal(turns.get("inst(u1,cube)/rotateX"), 0);
});

test("an instance's part is in the third axis where the definition's part is", async () => {
	// zstated/1 is a claim about a *document* node, so `inst(I,part)` has none of
	// its own and the climb through child/2 only rescues it where an ancestor is
	// already spatial. On a plain artboard there is no such ancestor: without the
	// fourth clause of s3/1, the definition beside the instances is in the third
	// axis and the instances are not, which is two pictures of one component.
	const scene = scened(
		board("page", { x: 0, y: 0 }, [
			at("widget", "frame", { x: 0, y: 0, w: 120, h: 120 }, {
				component: true,
				children: [
					at("chip", "rect", { x: 10, y: 10, w: 100, h: 40 }, {
						spatial: { z: single("24px") },
					}),
				],
			}),
			at("u1", "instance", { x: 200, y: 0, w: 120, h: 120 }, { instanceOf: "widget" }),
		]),
	);
	const atoms = await answer(scene, "#show s3/1.\n");
	const s3 = of(atoms, "s3").map(([id]) => id);
	assert.ok(s3.includes("chip"));
	assert.ok(s3.includes("inst(u1,chip)"), "the instance's copy is lifted too");
	const z = of(atoms, "frame").filter(([id, dim]) => id === "inst(u1,chip)" && dim === "z");
	assert.deepEqual(z, [["inst(u1,chip)", "z", String(px(24))]]);
	// And nothing else in the document gained a third axis.
	assert.equal(s3.includes("page"), false);
	assert.equal(s3.includes("u1"), false);
});

/** A machine over a definition with one part, spelled the way a document holds one. */
const machineOver = (root: string, part: string, delta: Record<string, Value>): Machine => ({
	id: "m1",
	name: "states",
	root,
	states: [
		{ id: "rest", name: "rest", parts: {} },
		{ id: "lifted", name: "lifted", parts: { [part]: { frame: delta } } },
	],
	transitions: [
		{ id: "t1", from: "rest", to: "lifted", trigger: "pointerenter", enabled: true },
	],
});

test("a state that lifts a mesh in z moves the copy and the picture both", async () => {
	// The quietest bug this feature can have: `mfshadow/3` and the `sfval/4`
	// variables written over two different dimension lists, so the copy moves and
	// `inst(I,N)` never hears about it — a document that solves cleanly, reports
	// nothing, and draws the mesh where it was.
	const scene = rotatedComponent([machineOver("widget", "cube", { z: single("40px") })]);
	const atoms = await answer(scene);
	const frame = (id: string, dim: string): number | undefined => {
		const found = of(atoms, "frame").find(([n, d]) => n === id && d === dim);
		return found === undefined ? undefined : Number(found[2]) / P;
	};
	assert.equal(frame("stt(u1,lifted,cube)", "z"), 40);
	assert.equal(frame("stt(u1,rest,cube)", "z"), 0);
	// `rest` is the shown state, so the picture is where the definition put it —
	// and the copy that moved is in the same answer set, which is what a rule
	// relating two states needs.
	assert.equal(frame("inst(u1,cube)", "z"), 0);
	assert.ok(
		compile(scene).generated.includes("mfshadow(u1,cube,z)."),
		"the shadow has to name the same dimension the variable does",
	);
	// And the state's own variable is the one the studio offers.
	assert.equal(variableCounts(scene)["sfval(u1,lifted,cube,z)"], 1);
});

test("a state copy in a flat document stays flat, however far away a view is", async () => {
	// `gaxis/1` grows the moment the document holds one viewport. Read here, the
	// state-copy defaults would give every copy of every part of every instance
	// in the document a z and a depth — including the button on page one that has
	// never heard of the third axis — while `inst(I,N)` stayed flat, because the
	// scene defaults are narrowed. The alias joins the two.
	const flatButton = board("page", { x: 0, y: 0 }, [
		at("btn", "frame", { x: 0, y: 0, w: 120, h: 40 }, {
			component: true,
			children: [at("label", "text", { x: 8, y: 8, w: 100, h: 24 })],
		}),
		at("b1", "instance", { x: 200, y: 0, w: 120, h: 40 }, { instanceOf: "btn" }),
	]);
	const withView = board("page2", { x: 900, y: 0 }, [
		at("view", "viewport", { x: 0, y: 0, w: 480, h: 320 }, {
			children: [at("cube", "mesh", { x: 0, y: 0, w: 100, h: 100 })],
		}),
	]);
	const machine = machineOver("btn", "label", { y: single("4px") });
	const near: Scene = { ...scened(flatButton), machines: [machine] };
	const far: Scene = { ...scened(flatButton, withView), machines: [machine] };

	const dims = async (scene: Scene): Promise<string[]> => {
		const atoms = await answer(scene);
		return of(atoms, "frame")
			.filter(([id]) => id === "stt(b1,rest,label)")
			.map(([, dim]) => dim)
			.sort();
	};
	assert.deepEqual(await dims(near), ["height", "width", "x", "y"]);
	assert.deepEqual(
		await dims(far),
		["height", "width", "x", "y"],
		"a viewport on another artboard is not this button's business",
	);
	// ...and the copy of a part that *is* in a view has all six.
	const spatial: Scene = {
		...rotatedComponent([machineOver("widget", "cube", { z: single("40px") })]),
	};
	const atoms = await answer(spatial);
	assert.deepEqual(
		of(atoms, "frame")
			.filter(([id]) => id === "stt(u1,rest,cube)")
			.map(([, dim]) => dim)
			.sort(),
		["depth", "height", "width", "x", "y", "z"],
	);
});

test("a whole 3D scene, with states in it, adds no designs at all", async () => {
	// The invariant the state-machine work earned, held across the seam: a state
	// is a copy and not a choice, a mesh is a node and not a design decision, and
	// neither of them multiplies anything.
	const plain = await explore(rotatedComponent(), directSolver, { limit: 16 });
	const stated = await explore(
		rotatedComponent([machineOver("widget", "cube", { z: single("40px") })]),
		directSolver,
		{ limit: 16 },
	);
	assert.equal(plain.count, 1);
	assert.equal(stated.count, 1);
});
