import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { updateConstraint } from "./edits.ts";
import { explore, varyingVars } from "./explore.ts";
import { compareCosts } from "./sampling.ts";
import { frameOf, sceneContext } from "./scene.ts";
import { flatten } from "./tree.ts";
import { TEMPLATES, findTemplate } from "./templates/index.ts";

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
