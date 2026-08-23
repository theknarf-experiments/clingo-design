import assert from "node:assert/strict";
import { test } from "node:test";

import { change, from, load, save } from "@automerge/automerge";
import {
	type Project,
	type Scene,
	TEMPLATES,
	createProject,
	deleteNodes,
	moveNodes,
	reconcile,
} from "@clingo-design/design-core";

/**
 * What `store.ts` does to a document, minus the browser.
 *
 * Applying a replacement scene to a live document is the one place where the
 * plain-data half of the studio meets the document library, and it is fussier
 * than it looks: it rejects a value that already belongs to it, and it stores
 * no undefined. Both of those are reachable from an ordinary edit.
 *
 * The plain entry point rather than `/slim`: under Node the library finds its
 * own wasm, and only the browser build has to be handed a URL for it.
 */

function seed(id = "card"): Project {
	const template = TEMPLATES.find((t) => t.id === id);
	assert.ok(template, `no ${id} template`);
	return createProject({ id: "p1", name: template.name, scene: template.create() });
}

/** A round trip through storage, so nothing under test sees a warm object. */
function stored(project: Project) {
	return load<Project>(save(from(project)));
}

function apply(doc: ReturnType<typeof stored>, scene: Scene) {
	let touched = false;
	const next = change(doc, (draft) => {
		touched = reconcile(draft.scene, scene);
	});
	return { doc: next, touched };
}

test("a scene the editor did not change writes nothing", () => {
	const doc = stored(seed());
	const { doc: next, touched } = apply(doc, doc.scene);
	assert.equal(touched, false);
	assert.equal(next, doc, "an empty change hands the same document back");
});

test("an edit that reuses untouched subtrees is accepted", () => {
	// The editor rebuilds the scene immutably, so most of what it hands back
	// is the very objects the document already holds.
	const doc = stored(seed());
	const { doc: next, touched } = apply(doc, deleteNodes(doc.scene, ["title"]));
	assert.equal(touched, true);
	assert.deepEqual(next.scene, deleteNodes(doc.scene, ["title"]));
});

test("a cleared field is removed rather than stored as undefined", () => {
	const doc = stored(seed());
	const node = doc.scene.nodes[0];
	const scene: Scene = {
		...doc.scene,
		nodes: [{ ...node, layout: undefined, children: [...(node.children ?? [])] }],
	};
	const { doc: next } = apply(doc, scene);
	assert.equal("layout" in next.scene.nodes[0], false);
});

test("a whole edit history survives being saved and loaded", () => {
	let doc = stored(seed());
	const rules = "% edited\n";
	doc = apply(doc, { ...doc.scene, rules }).doc;
	doc = apply(doc, moveNodes(doc.scene, ["badge"], 12, 34)).doc;
	doc = apply(doc, deleteNodes(doc.scene, ["title"])).doc;

	const back = load<Project>(save(doc));
	assert.deepEqual(back.scene, doc.scene);
	assert.equal(back.scene.rules, rules);
});

test("every template survives becoming a document", () => {
	for (const template of TEMPLATES) {
		const project = createProject({ id: template.id, scene: template.create() });
		assert.deepEqual(stored(project).scene, project.scene, template.id);
	}
});
