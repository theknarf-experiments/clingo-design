import assert from "node:assert/strict";
import { test } from "node:test";

import { directSolver } from "./directSolver.ts";
import { explore, varyingVars } from "./explore.ts";
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
		for (const node of all) {
			assert.ok(result.universes[0].visible.has(node.id), `${node.id} should render`);
			// Every node must have a real position and size.
			assert.ok(node.frame.width > 0 && node.frame.height > 0, `${node.id} has no size`);
			assert.ok(Number.isFinite(node.frame.x) && Number.isFinite(node.frame.y));
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
			for (const child of parent.children ?? []) {
				// Coordinates are relative, so containment is a local check.
				assert.ok(
					child.frame.x >= 0 &&
						child.frame.y >= 0 &&
						child.frame.x + child.frame.width <= parent.frame.width &&
						child.frame.y + child.frame.height <= parent.frame.height,
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

test("two frames share one accent variable", async () => {
	const scene = findTemplate("pair")!.create();
	assert.equal(scene.nodes.length, 2, "two artboards");

	const result = await explore(scene, directSolver, { limit: 32, sample: "first" });
	// One shared token, so both frames move together: three designs, not nine.
	assert.equal(result.count, 3);
	assert.deepEqual(varyingVars(result), ["tok(accent)"]);
});
