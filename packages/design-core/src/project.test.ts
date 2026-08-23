import assert from "node:assert/strict";
import { test } from "node:test";

import {
	createProject,
	findProject,
	normalizeScene,
	sortProjects,
	uniqueProjectName,
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

test("a stored geometric constraint survives a round trip, garbage does not", () => {
	const good = {
		id: "k1",
		kind: "pin",
		prop: "fill",
		nodes: ["a"],
		edge: "centerX",
		value: 120,
		enabled: true,
	};
	const scene = normalizeScene({
		constraints: [
			good,
			// A rule naming an edge nothing understands would compile into a fact
			// no rule matches, and read as a solver bug from the outside.
			{ ...good, id: "k2", edge: "sideways" },
			{ ...good, id: "k3", value: "twelve" },
		],
	});
	assert.deepEqual(
		scene.constraints.map((c) => c.id),
		["k1"],
	);
	assert.equal(scene.constraints[0].edge, "centerX");
	assert.equal(scene.constraints[0].value, 120);
});
