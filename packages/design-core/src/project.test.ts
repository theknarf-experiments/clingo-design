import assert from "node:assert/strict";
import { test } from "node:test";

import {
	PROJECTS_VERSION,
	createProject,
	deleteProject,
	findProject,
	normalizeScene,
	parseProjects,
	renameProject,
	serializeProjects,
	sortProjects,
	uniqueProjectName,
	updateProjectScene,
} from "./project.ts";
import { DEFAULT_FRAME, emptyScene } from "./scene.ts";

const at = (n: number) => ({ now: n });

test("createProject seeds a default scene and timestamps", () => {
	const p = createProject({ id: "a", name: "Kiln", ...at(100) });
	assert.equal(p.id, "a");
	assert.equal(p.name, "Kiln");
	assert.equal(p.createdAt, 100);
	assert.equal(p.updatedAt, 100);
	assert.ok(p.scene.tokens.length > 0);
	assert.equal(p.scene.nodes.length, 1, "a new document has one frame");
	assert.equal(p.scene.nodes[0].kind, "frame");
});

test("createProject falls back to Untitled for blank names", () => {
	assert.equal(createProject({ id: "a", name: "   " }).name, "Untitled");
	assert.equal(createProject({ id: "b" }).name, "Untitled");
});

test("uniqueProjectName avoids collisions", () => {
	const list = [
		createProject({ id: "1", name: "Untitled" }),
		createProject({ id: "2", name: "Untitled 2" }),
	];
	assert.equal(uniqueProjectName([]), "Untitled");
	assert.equal(uniqueProjectName(list), "Untitled 3");
	assert.equal(uniqueProjectName(list, "Kiln"), "Kiln");
});

test("rename trims and bumps updatedAt", () => {
	const list = [createProject({ id: "a", name: "One", ...at(1) })];
	const next = renameProject(list, "a", "  Two  ", 50);
	assert.equal(next[0].name, "Two");
	assert.equal(next[0].updatedAt, 50);
});

test("rename ignores an empty name", () => {
	const list = [createProject({ id: "a", name: "One", ...at(1) })];
	const next = renameProject(list, "a", "   ", 50);
	assert.equal(next[0].name, "One");
	assert.equal(next[0].updatedAt, 1);
});

test("delete removes only the target", () => {
	const list = [createProject({ id: "a" }), createProject({ id: "b" })];
	assert.deepEqual(deleteProject(list, "a").map((p) => p.id), ["b"]);
	assert.equal(deleteProject(list, "nope").length, 2);
});

test("updateProjectScene replaces the scene and touches the project", () => {
	const list = [createProject({ id: "a", ...at(1) })];
	const scene = { ...emptyScene(), rules: "% edited" };
	const next = updateProjectScene(list, "a", scene, 99);
	assert.equal(next[0].scene.rules, "% edited");
	assert.equal(next[0].updatedAt, 99);
});

test("sortProjects lists most recently updated first", () => {
	const list = [
		createProject({ id: "old", ...at(10) }),
		createProject({ id: "new", ...at(30) }),
		createProject({ id: "mid", ...at(20) }),
	];
	assert.deepEqual(sortProjects(list).map((p) => p.id), ["new", "mid", "old"]);
});

test("findProject handles a missing or undefined id", () => {
	const list = [createProject({ id: "a" })];
	assert.equal(findProject(list, "a")?.id, "a");
	assert.equal(findProject(list, "b"), undefined);
	assert.equal(findProject(list, undefined), undefined);
});

test("projects survive a serialize/parse round trip", () => {
	const list = [
		createProject({ id: "a", name: "Kiln", ...at(5) }),
		createProject({ id: "b", name: "Span", ...at(7) }),
	];
	const back = parseProjects(serializeProjects(list));
	assert.deepEqual(back, list);
});

test("parseProjects tolerates junk instead of throwing", () => {
	assert.deepEqual(parseProjects(null), []);
	assert.deepEqual(parseProjects(""), []);
	assert.deepEqual(parseProjects("not json"), []);
	assert.deepEqual(parseProjects("[]"), []);
	assert.deepEqual(parseProjects('{"projects":"nope"}'), []);
	// A future/foreign version is discarded rather than misread.
	assert.deepEqual(
		parseProjects(JSON.stringify({ version: 999, projects: [{ id: "a" }] })),
		[],
	);
});

test("parseProjects drops entries with no id and de-duplicates", () => {
	const text = JSON.stringify({
		version: PROJECTS_VERSION,
		projects: [{ id: "a", name: "A" }, { name: "no id" }, { id: "a", name: "dupe" }],
	});
	const back = parseProjects(text);
	assert.deepEqual(back.map((p) => p.id), ["a"]);
	assert.equal(back[0].name, "A");
});

test("a document written before frames were nodes is migrated", () => {
	// The old shape: a global artboard, with nodes loose beside it.
	const text = JSON.stringify({
		version: PROJECTS_VERSION,
		projects: [
			{
				id: "a",
				name: "Legacy",
				createdAt: 1,
				updatedAt: 1,
				scene: {
					artboard: { width: 500, height: 400 },
					nodes: [
						{
							id: "box",
							kind: "rect",
							name: "Box",
							frame: { x: 10, y: 20, width: 30, height: 40 },
							props: {},
						},
					],
				},
			},
		],
	});
	const [project] = parseProjects(text);

	// Its contents end up inside a frame of the old artboard's size.
	assert.equal(project.scene.nodes.length, 1);
	const root = project.scene.nodes[0];
	assert.equal(root.kind, "frame");
	assert.deepEqual(root.frame, { x: 0, y: 0, width: 500, height: 400 });
	assert.deepEqual(root.children?.map((c) => c.id), ["box"]);
});

test("normalizeScene fills every missing field", () => {
	const s = normalizeScene({});
	assert.ok(s.tokens.length > 0, "a document always has its starter variables");
	assert.deepEqual(s.nodes[0].frame, { x: 0, y: 0, ...DEFAULT_FRAME });
	assert.equal(s.nodes.length, 1);
	assert.equal(typeof s.rules, "string");
});

test("a legacy artboard is migrated, and nonsense dimensions fall back", () => {
	assert.deepEqual(
		normalizeScene({ artboard: { width: 900, height: 500 }, nodes: [] }).nodes[0].frame,
		{ x: 0, y: 0, width: 900, height: 500 },
	);
	assert.deepEqual(
		normalizeScene({ artboard: { width: "wide", height: null } }).nodes[0].frame,
		{ x: 0, y: 0, ...DEFAULT_FRAME },
	);
	assert.equal(normalizeScene("nope").rules, emptyScene().rules);
});

test("nodes with no frame are dropped, not rendered at 0x0", () => {
	// Documents outlive schemas: an old flow-layout node has no frame, and
	// keeping it would put an invisible entry in the layer list.
	const text = JSON.stringify({
		version: PROJECTS_VERSION,
		projects: [
			{
				id: "a",
				name: "Legacy",
				createdAt: 1,
				updatedAt: 1,
				scene: {
					nodes: [
						{ id: "old", kind: "rect", name: "No frame", props: {} },
						{
							id: "new",
							kind: "rect",
							name: "Box",
							frame: { x: 1, y: 2, width: 3, height: 4 },
							props: {},
						},
					],
				},
			},
		],
	});
	const [project] = parseProjects(text);
	// No legacy artboard here, so the survivors stay at the top level.
	assert.deepEqual(project.scene.nodes.map((n) => n.id), ["new"]);
});
