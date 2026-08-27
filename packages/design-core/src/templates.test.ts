import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { updateConstraint } from "./edits.ts";
import { exportUniverse } from "./export.ts";
import { explore, varyingVars } from "./explore.ts";
import { compareCosts } from "./sampling.ts";
import { frameOf, sceneContext, wornProps } from "./scene.ts";
import { findInTree, flatten } from "./tree.ts";
import { TEMPLATES, findTemplate } from "./templates/index.ts";
import { styleVar } from "./values.ts";

test("every template has a unique id and a findable entry", () => {
	const ids = TEMPLATES.map((t) => t.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const id of ids) assert.equal(findTemplate(id)?.id, id);
	assert.equal(findTemplate("nope"), undefined);
});

for (const template of TEMPLATES) {
	test(`template "${template.id}" is solvable and laid out`, async () => {
		const scene = template.create();
		const result = await explore(scene, directSolver, { limit: 64 });
		assert.ok(result.count > 0, "expected at least one universe");

		const all = flatten(scene.nodes);
		const context = sceneContext(scene);
		for (const node of all) {
			assert.ok(result.universes[0].visible.has(node.id), `${node.id} should render`);
			// Every node must have a real position and size.
			const box = frameOf(node, context);
			assert.ok(box.width > 0 && box.height > 0, `${node.id} has no size`);
			assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y));
		}
		// Node ids must be unique or selection and hit testing break.
		const ids = all.map((n) => n.id);
		assert.equal(new Set(ids).size, ids.length);
	});
}

test("every template's top level is frames", () => {
	for (const template of TEMPLATES) {
		const scene = template.create();
		assert.ok(scene.nodes.length > 0, `${template.id} has no frames`);
		for (const node of scene.nodes) {
			assert.equal(node.kind, "frame", `${template.id}/${node.id} is not a frame`);
		}
	}
});

test("template contents stay inside their frame", () => {
	for (const template of TEMPLATES) {
		const scene = template.create();
		const check = (parent: (typeof scene.nodes)[number]) => {
			const outer = frameOf(parent);
			for (const child of parent.children ?? []) {
				// Coordinates are relative, so containment is a local check.
				const box = frameOf(child);
				assert.ok(
					box.x >= 0 &&
						box.y >= 0 &&
						box.x + box.width <= outer.width &&
						box.y + box.height <= outer.height,
					`${template.id}/${child.id} escapes ${parent.id}`,
				);
				check(child);
			}
		};
		for (const root of scene.nodes) check(root);
	}
});

test("blank is one empty frame, and settled", async () => {
	const scene = findTemplate("blank")!.create();
	assert.equal(scene.nodes.length, 1);
	assert.equal(scene.nodes[0].kind, "frame");
	assert.deepEqual(scene.nodes[0].children, []);

	const result = await explore(scene, directSolver, { limit: 8 });
	assert.equal(result.count, 1);
	assert.deepEqual(varyingVars(result), []);
});

test("card varies through two shared tokens", async () => {
	const result = await explore(findTemplate("card")!.create(), directSolver, {
		limit: 64,
		sample: "first",
	});
	// 5 accents x 3 radii, and every reference moves together.
	assert.equal(result.count, 15);
	assert.deepEqual(varyingVars(result).sort(), ["tok(accent)", "tok(radius)"]);
});

test("button set varies per assignment, not through a token", async () => {
	const result = await explore(findTemplate("buttons")!.create(), directSolver, {
		limit: 64,
		sample: "first",
	});
	// Three independent choices of three: 27.
	assert.equal(result.count, 27);
	assert.deepEqual(varyingVars(result).sort(), [
		"prop(one,fill)",
		"prop(three,fill)",
		"prop(two,fill)",
	]);
});

test("preference orders the whole space, and the tiers decide", async () => {
	const scene = findTemplate("ranked")!.create();
	const out = await explore(scene, directSolver, { limit: 24 });
	// Nine designs, all of them legal and all of them shown: two preferences
	// that cannot both hold are a ranking, not a smaller space.
	assert.equal(out.count, 9);
	assert.equal(out.optimized, true);
	assert.equal(out.truncated, false);
	// Three tiers, strongest first, and the best design pays the cheaper rule.
	assert.deepEqual(out.levels, [3, 2, 1]);
	assert.deepEqual(out.costs, [0, 1, 0]);
	const costs = out.universes.map((u) => u.costs);
	assert.deepEqual(costs[0], out.costs, "best first");
	for (let i = 1; i < costs.length; i++) {
		assert.ok(compareCosts(costs[i - 1], costs[i]) <= 0);
	}
	// The winner is an all-different design, which is what the stronger tier
	// asked for; the restraint it gave up shows as the point at the second level.
	const [a, b, c] = ["one", "two", "three"].map(
		(id) => out.universes[0].model.byId[id]?.rendered.fill,
	);
	assert.equal(new Set([a, b, c]).size, 3);

	// Swap the two tiers and the same space, the same nine designs, ranks the
	// other way round. Nothing else about the document changes.
	let swapped = updateConstraint(scene, "variety", { strength: "prefer" });
	swapped = updateConstraint(swapped, "restraint", { strength: "strong" });
	const other = await explore(swapped, directSolver, { limit: 24 });
	assert.equal(other.count, 9);
	assert.deepEqual(other.costs, [0, 1, 0]);
	const winner = ["one", "two", "three"].map(
		(id) => other.universes[0].model.byId[id]?.rendered.fill,
	);
	assert.ok(new Set(winner).size <= 2, "restraint now wins");
});

test("two frames share one accent variable", async () => {
	const scene = findTemplate("pair")!.create();
	assert.equal(scene.nodes.length, 2, "two artboards");

	const result = await explore(scene, directSolver, { limit: 32, sample: "first" });
	// One shared token, so both frames move together: three designs, not nine.
	assert.equal(result.count, 3);
	assert.deepEqual(varyingVars(result), ["tok(accent)"]);
});

test("two typographies is one variable, and both of its designs are coherent", async () => {
	// The template exists to make one argument, so this is that argument as an
	// assertion. Four correlated fields — family, size, weight, leading — held
	// as four two-value tokens would be sixteen designs and fourteen of them
	// incoherent; held as one style they are two.
	const scene = findTemplate("typography")!.create();
	const out = await explore(scene, directSolver, { limit: 24 });
	assert.deepEqual(varyingVars(out), [styleVar("prose")], "one variable");
	assert.equal(out.count, 2, "two designs");

	const body = ["deck", "first", "second", "footnote"];
	const treatments = out.universes
		.map((u) => {
			const n = u.model.byId.deck;
			return [n.rendered.size, n.rendered.weight, n.rendered.lineHeight].join("/");
		})
		.sort();
	assert.deepEqual(treatments, ["15px/450/1.3", "18px/400/1.75"]);
	for (const universe of out.universes) {
		// The correlation, per universe: one pick, and every wearer took the
		// same whole record from it.
		for (const prop of ["size", "weight", "lineHeight", "fontFamily"] as const) {
			const values = new Set(body.map((id) => universe.model.byId[id].rendered[prop]));
			assert.equal(values.size, 1, `${prop} agrees across the page`);
		}
	}

	// And the heading is the ordinary case rather than the pure one: it states
	// its own size and weight and takes the family and the leading.
	const title = findInTree(scene.nodes, "title");
	assert.ok(title);
	assert.deepEqual(wornProps(scene, title), ["fontFamily", "lineHeight"]);
});

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

/**
 * The `machine` template exists to make one claim, so these are that claim as
 * assertions, in the order the template's own doc-comment makes them.
 *
 * The first is the load-bearing one and it is deliberately first: a document
 * with a three-state machine, and the same document with the machine cut out of
 * it, enumerate the same designs. Every other test in this block would pass
 * under the cheap encoding — a choice rule over the states — and this one is the
 * one that would not.
 */
test("states are not a design space: the machine changes no universe count", async () => {
	const scene = findTemplate("machine")!.create();

	const withMachine = await explore(scene, directSolver, { limit: 64 });
	const without = await explore({ ...scene, machines: [] }, directSolver, {
		limit: 64,
	});

	// The same *variables*, not merely the same number of them. A count could
	// coincide; two identical lists cannot, and this is what says the machine
	// added no axis rather than adding one and removing another.
	assert.deepEqual(
		varyingVars(withMachine).sort(),
		varyingVars(without).sort(),
		"a machine is behaviour, not a design decision",
	);
	assert.equal(withMachine.count, without.count);
	assert.ok(withMachine.count > 1, "there is a space for the machine not to change");

	// And a fourth state is free, which is the claim in the form somebody would
	// actually hit it: adding a state must not multiply anything. Under a choice
	// rule this would be `count * 4/3`.
	const fourth = {
		...scene,
		machines: scene.machines.map((m) => ({
			...m,
			states: [...m.states, { id: "busy", name: "Busy", parts: {} }],
		})),
	};
	assert.equal((await explore(fourth, directSolver, { limit: 64 })).count, withMachine.count);

	// No variable anywhere is a state, and no answer set holds a pick over one.
	for (const variable of varyingVars(withMachine)) {
		assert.ok(!variable.includes("stt("), `${variable} is a state copy`);
		assert.ok(!variable.startsWith("sprop("), `${variable} branches per state`);
	}
});

test("every state of the button is in the one answer set, beside the picture", async () => {
	const scene = findTemplate("machine")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const model = out.universes[0].model;

	// Three states, two materialised parts, two uses. The label is materialised
	// because `pressed` gives it a delta; nothing else in the definition is,
	// which is the analysis paying for itself.
	assert.deepEqual(
		Object.keys(model.states).sort(),
		[
			"stt(hovering,hover,button)",
			"stt(hovering,hover,label)",
			"stt(hovering,pressed,button)",
			"stt(hovering,pressed,label)",
			"stt(hovering,rest,button)",
			"stt(hovering,rest,label)",
			"stt(resting,hover,button)",
			"stt(resting,hover,label)",
			"stt(resting,pressed,button)",
			"stt(resting,pressed,label)",
			"stt(resting,rest,button)",
			"stt(resting,rest,label)",
		],
		"every state of every use, in one answer set",
	);

	// A state copy is never a node, which is what keeps it out of the layer list,
	// out of hit testing and out of both exporters — none of which had to learn a
	// case for it.
	for (const id of Object.keys(model.byId)) {
		assert.ok(!id.startsWith("stt("), `${id} is drawn, and a state copy must not be`);
	}

	// The three states really are three pictures: the lift, the rest, the press.
	const y = (state: string) => model.states[`stt(resting,${state},button)`].frame.y;
	assert.ok(y("hover") < y("rest"), "hover lifts");
	assert.ok(y("pressed") > y("rest"), "a press takes the weight");

	// Two uses in two states at once, each drawing its own — which is the thing a
	// sprite sheet cannot do, since the two would be in two answer sets.
	assert.deepEqual(model.shown, { resting: "rest", hovering: "hover" });
	assert.equal(model.byId["inst(resting,button)"].frame.y, y("rest"));
	assert.equal(model.byId["inst(hovering,button)"].frame.y, y("hover"));

	// What a state does not touch, it shares. Hover says nothing about the fill,
	// so its copy paints the literal the instance's own one variable resolved to
	// — not a second variable that happens to agree.
	assert.equal(
		model.states["stt(resting,hover,button)"].rendered.fill,
		model.byId["inst(resting,button)"].rendered.fill,
	);
	// And the one property a state does own is the one that differs.
	assert.notEqual(
		model.states["stt(resting,pressed,button)"].rendered.fill,
		model.states["stt(resting,rest,button)"].rendered.fill,
	);

	// The machine is sound, and the answer set says so in the four predicates the
	// canned checks read. A template that shipped with a finding in it would be
	// teaching the finding.
	const health = model.machines.buttonStates;
	assert.deepEqual(health.unreachable, []);
	assert.deepEqual(health.deadEnds, []);
	assert.deepEqual(health.nondeterministic, []);
	assert.deepEqual(health.dangling, []);
	// The motion scale resolved, and the one edge that names its own number kept
	// it: a press is immediate, everything else follows the token.
	assert.deepEqual(health.duration, {
		enter: 160,
		leave: 160,
		release: 160,
		press: 60,
	});
});

test("the button leaves as a stylesheet with the states in it", async () => {
	const scene = findTemplate("machine")!.create();
	const out = await explore(scene, directSolver, { limit: 8 });
	const html = exportUniverse(scene, out.universes[0], {
		target: "html",
		title: "machine",
	});

	// `pressed` is entered and left by a pointer down and up *from hover* rather
	// than from the initial state, so it is not a pseudo-class state and the file
	// carries the table-driven runtime instead. The rest/hover pair on its own
	// would have collapsed to `:hover` and emitted no script at all.
	assert.match(html.text, /\[data-state="pressed"\]/);
	assert.match(html.text, /<script>/);
	// Paced from the answer set rather than from a number in the emitter.
	assert.match(html.text, /transition:[^;]*160ms/);

	// And what it cannot carry, it says: the second use is drawn in a state other
	// than the machine's initial one, so the file starts there and every state is
	// a data-state rule.
	assert.ok(
		html.lost.some((entry) => entry.includes("Hovering")),
		"the export names the state it starts in",
	);

	// SVG has no states at all, and says so rather than shipping a still frame
	// that looks like the whole design.
	const svg = exportUniverse(scene, out.universes[0], {
		target: "svg",
		title: "machine",
	});
	assert.ok(svg.lost.some((entry) => entry.startsWith("Behaviour.")));
});
