import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import {
	addConstraint,
	addNode,
	deleteNodes,
	makeNode,
	pruneConstraints,
	setProp,
	sharedProps,
	updateConstraint,
} from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import { emptyScene, type Scene } from "./scene.ts";
import { derive, lit, propVar, ref, resolveValue, single } from "./values.ts";

/** Three rectangles in a frame, each free to take any of three fills. */
function threeBoxes(): Scene {
	let scene = emptyScene();
	const palette = [lit("#ff0000"), lit("#00ff00"), lit("#0000ff")];
	for (const id of ["a", "b", "c"]) {
		scene = addNode(
			scene,
			makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id }),
		);
		scene = setProp(scene, [id], "fill", palette);
	}
	return scene;
}

const universes = async (scene: Scene, limit = 200) =>
	(await explore(scene, directSolver, { limit, sample: "first" })).count;

test("with no constraints the space is the plain cross product", async () => {
	assert.equal(await universes(threeBoxes()), 27);
});

test("differ removes the designs where two members share a value", async () => {
	const { scene } = addConstraint(threeBoxes(), "differ", ["a", "b"], "fill");
	// 27 total, 9 of them have a and b equal.
	assert.equal(await universes(scene), 18);
});

test("match collapses its members onto one value", async () => {
	const { scene } = addConstraint(threeBoxes(), "match", ["a", "b", "c"], "fill");
	assert.equal(await universes(scene), 3);
});

test("atMost counts distinct values, not members", async () => {
	const two = addConstraint(threeBoxes(), "atMost", ["a", "b", "c"], "fill");
	// At most 2 distinct across three boxes rules out only the 6 all-different.
	assert.equal(await universes(updateConstraint(two.scene, two.id, { limit: 2 })), 21);
	assert.equal(await universes(updateConstraint(two.scene, two.id, { limit: 1 })), 3);
});

test("a disabled constraint stays in the document but out of the program", async () => {
	const { scene, id } = addConstraint(threeBoxes(), "match", ["a", "b", "c"], "fill");
	assert.equal(await universes(scene), 3);
	const off = updateConstraint(scene, id, { enabled: false });
	assert.equal(off.constraints.length, 1);
	assert.equal(await universes(off), 27);
});

test("conflicting constraints report the smallest guilty subset", async () => {
	let scene = threeBoxes();
	const differ = addConstraint(scene, "differ", ["a", "b"], "fill");
	scene = differ.scene;
	const match = addConstraint(scene, "match", ["a", "b"], "fill");
	scene = match.scene;
	// A third, innocent constraint must not be blamed.
	const other = addConstraint(scene, "differ", ["b", "c"], "fill");
	scene = other.scene;

	const error = await explore(scene, directSolver).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError);
	assert.deepEqual(
		[...error.conflict].sort(),
		[differ.id, match.id].sort(),
		"only the two that actually contradict each other",
	);
});

test("an unsatisfiable hand-written rule is reported without blaming a constraint", async () => {
	const scene = { ...threeBoxes(), rules: ":- pick(V,I), alt(V,I)." };
	const error = await explore(scene, directSolver).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError);
	assert.deepEqual(error.conflict, []);
});

test("constraints follow token links rather than the alternative index", async () => {
	// Both boxes link to the same token, so they can never differ.
	let scene = threeBoxes();
	scene = { ...scene, tokens: [...scene.tokens, { id: "t", name: "t", type: "color", value: single("#ff0000") }] };
	scene = setProp(scene, ["a"], "fill", [ref("t")]);
	scene = setProp(scene, ["b"], "fill", [lit("#ff0000")]);
	const { scene: constrained } = addConstraint(scene, "differ", ["a", "b"], "fill");
	const error = await explore(constrained, directSolver).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(
		error instanceof UnsatisfiableError,
		"a token spelling the same colour still counts as the same colour",
	);
});

test("sharedProps only offers what every selected node exposes", () => {
	let scene = emptyScene();
	scene = addNode(scene, makeNode("rect", { x: 0, y: 0, width: 9, height: 9 }, { id: "r" }));
	scene = addNode(scene, makeNode("text", { x: 0, y: 0, width: 9, height: 9 }, { id: "t" }));
	assert.deepEqual(sharedProps(scene, ["r"]), [
		"fill",
		"radius",
		"stroke",
		"strokeWidth",
		"shadow",
		"opacity",
	]);
	assert.deepEqual(sharedProps(scene, ["t"]), [
		"ink",
		"fontFamily",
		"size",
		"weight",
		"lineHeight",
		"align",
		"opacity",
	]);
	// Opacity is the one thing everything drawable has, so a rule can range
	// across kinds that otherwise share nothing.
	assert.deepEqual(sharedProps(scene, ["r", "t"]), ["opacity"]);
});

test("deleting a node drops the constraints that ranged over it", () => {
	const { scene } = addConstraint(threeBoxes(), "differ", ["a", "b"], "fill");
	assert.equal(deleteNodes(scene, ["a"]).constraints.length, 0);
	// Losing one of three still leaves a meaningful pair.
	const wide = addConstraint(threeBoxes(), "differ", ["a", "b", "c"], "fill").scene;
	const after = deleteNodes(wide, ["c"]);
	assert.deepEqual(after.constraints[0].nodes, ["a", "b"]);
});

test("pruneConstraints returns the same scene when nothing changed", () => {
	const { scene } = addConstraint(threeBoxes(), "differ", ["a", "b"], "fill");
	assert.equal(pruneConstraints(scene), scene);
});

/* ------------------------------------------------------------------ */
/* Derived values                                                      */
/* ------------------------------------------------------------------ */

/** A background token that is light in one universe and dark in the other. */
function flippingBackground(): Scene {
	let scene = emptyScene();
	scene = {
		...scene,
		tokens: [
			...scene.tokens,
			{
				id: "bg",
				name: "bg",
				type: "color",
				value: [lit("#ffffff"), lit("#000000")],
			},
		],
	};
	scene = addNode(
		scene,
		makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id: "box" }),
	);
	scene = setProp(scene, ["box"], "fill", [ref("bg")]);
	scene = addNode(
		scene,
		makeNode("text", { x: 0, y: 0, width: 40, height: 40 }, { id: "label" }),
	);
	return setProp(scene, ["label"], "ink", [derive("contrast", "tok(bg)")]);
}

test("a derived value adds no branching but flips with its source", async () => {
	const scene = flippingBackground();
	const result = await explore(scene, directSolver, { sample: "first" });

	// Two designs — the token's two values. The derived ink does not multiply
	// them, because it is inferred rather than chosen.
	assert.equal(result.count, 2);
	assert.deepEqual(
		result.universes.map((u) => u.pick[propVar("label", "ink")]),
		[0, 0],
		"the derived alternative is the only one there is",
	);

	// Resolved per universe, the ink is the readable one over that background.
	const pairs = result.universes.map((u) => {
		const context = { tokens: scene.tokens, picks: u.pick };
		return [
			resolveValue(context, [ref("bg")], propVar("box", "fill")),
			resolveValue(
				context,
				[derive("contrast", "tok(bg)")],
				propVar("label", "ink"),
			),
		];
	});
	assert.deepEqual(
		[...pairs].sort(),
		[
			["#000000", "#ffffff"],
			["#ffffff", "#0f172a"],
		],
		"dark ink on the light background and light ink on the dark one",
	);
});

test("the solver computes the derivation, not just the renderer", async () => {
	// A second label pinned to dark ink, forced to match the derived one. Only
	// the light-background universe can satisfy that — which is only true if
	// ASP is following the derivation itself.
	let scene = flippingBackground();
	scene = addNode(
		scene,
		makeNode("text", { x: 0, y: 0, width: 40, height: 40 }, { id: "pinned" }),
	);
	scene = setProp(scene, ["pinned"], "ink", single("#0f172a"));
	const { scene: constrained } = addConstraint(
		scene,
		"match",
		["label", "pinned"],
		"ink",
	);

	const result = await explore(constrained, directSolver, { sample: "first" });
	assert.equal(result.count, 1);
	assert.equal(
		resolveValue(
			{ tokens: constrained.tokens, picks: result.universes[0].pick },
			[ref("bg")],
			propVar("box", "fill"),
		),
		"#ffffff",
		"the universe that survived is the one with the light background",
	);
});

test("a derivation from a missing source resolves to nothing rather than throwing", async () => {
	let scene = emptyScene();
	scene = addNode(
		scene,
		makeNode("text", { x: 0, y: 0, width: 40, height: 40 }, { id: "label" }),
	);
	scene = setProp(scene, ["label"], "ink", [derive("contrast", "tok(nope)")]);
	const result = await explore(scene, directSolver, { sample: "first" });
	assert.equal(result.count, 1);
});

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/* ------------------------------------------------------------------ */

test("a pin narrows the space without touching the document", async () => {
	const scene = threeBoxes();
	const pinned = await explore(scene, directSolver, {
		limit: 200,
		sample: "first",
		pins: { [propVar("a", "fill")]: 1 },
	});
	// a is fixed, b and c stay free: 1 x 3 x 3.
	assert.equal(pinned.count, 9);
	// Every universe agrees with the pin.
	assert.ok(
		pinned.universes.every((u) => u.pick[propVar("a", "fill")] === 1),
		"the pin holds in every design returned",
	);
	// And the scene is untouched — pins are not edits.
	assert.equal(await universes(scene), 27);
});

test("pins compose with constraints", async () => {
	const { scene } = addConstraint(threeBoxes(), "differ", ["a", "b"], "fill");
	const result = await explore(scene, directSolver, {
		limit: 200,
		sample: "first",
		pins: { [propVar("a", "fill")]: 0 },
	});
	// a is fixed to 0, b must differ from it (2 left), c is free (3).
	assert.equal(result.count, 6);
});

test("a pin the rules forbid is reported as the pin's fault", async () => {
	// match forces a and b equal; pinning them apart cannot hold.
	const { scene } = addConstraint(threeBoxes(), "match", ["a", "b"], "fill");
	const error = await explore(scene, directSolver, {
		pins: { [propVar("a", "fill")]: 0, [propVar("b", "fill")]: 1 },
	}).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError);
	assert.deepEqual(
		[...error.pinned].sort(),
		[propVar("a", "fill"), propVar("b", "fill")].sort(),
	);
	assert.match(error.message, /pinned values/);
});

test("brave consequences say which alternatives remain reachable", async () => {
	const { scene } = addConstraint(threeBoxes(), "match", ["a", "b", "c"], "fill");
	const all = await explore(scene, directSolver, { limit: 200, sample: "first" });
	// Everything is still reachable: all three may take any colour together.
	assert.deepEqual([...all.brave.pick[propVar("a", "fill")]].sort(), [0, 1, 2]);

	// Pinning one collapses what the others can be — this is what greys the
	// impossible alternatives out in the inspector.
	const pinned = await explore(scene, directSolver, {
		limit: 200,
		sample: "first",
		pins: { [propVar("a", "fill")]: 2 },
	});
	assert.deepEqual([...pinned.brave.pick[propVar("b", "fill")]], [2]);
	assert.deepEqual([...pinned.cautious.pick[propVar("c", "fill")]], [2]);
});
