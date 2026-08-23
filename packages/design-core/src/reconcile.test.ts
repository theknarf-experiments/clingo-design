import assert from "node:assert/strict";
import { test } from "node:test";

import { reconcile } from "./reconcile.ts";

test("an identical value is left alone", () => {
	const target = { a: 1, b: { c: [1, 2] } };
	assert.equal(reconcile(target, { a: 1, b: { c: [1, 2] } }), false);
	assert.deepEqual(target, { a: 1, b: { c: [1, 2] } });
});

test("changed, added and removed keys", () => {
	const target: Record<string, unknown> = { a: 1, gone: true };
	assert.equal(reconcile(target, { a: 2, added: "x" }), true);
	assert.deepEqual(target, { a: 2, added: "x" });
});

test("an undefined value removes the key rather than storing a hole", () => {
	const target: Record<string, unknown> = { layout: { gap: 8 } };
	assert.equal(reconcile(target, { layout: undefined }), true);
	assert.equal("layout" in target, false);
});

test("nested branches are mutated in place", () => {
	const inner = { c: 1 };
	const target = { b: inner };
	reconcile(target, { b: { c: 2 } });
	assert.equal(target.b, inner, "the existing object is edited, not replaced");
	assert.equal(inner.c, 2);
});

test("lists grow, shrink and update by position", () => {
	const target = [1, 2, 3];
	assert.equal(reconcile(target, [1, 9]), true);
	assert.deepEqual(target, [1, 9]);
	assert.equal(reconcile(target, [1, 9, 4, 5]), true);
	assert.deepEqual(target, [1, 9, 4, 5]);
});

test("a list of objects reuses the objects it already has", () => {
	const first = { id: "a", x: 0 };
	const target = [first];
	reconcile(target, [{ id: "a", x: 10 }, { id: "b", x: 0 }]);
	assert.equal(target[0], first);
	assert.equal(first.x, 10);
	assert.equal(target.length, 2);
});

test("an inserted branch is copied, never aliased", () => {
	// The replacement reuses subtrees of the value it replaces, so writing one
	// straight through would leave two places pointing at one object.
	const shared = { deep: { n: 1 } };
	const target: Record<string, unknown> = {};
	reconcile(target, { a: shared, list: [shared] });
	assert.deepEqual(target.a, shared);
	assert.notEqual(target.a, shared);
	assert.notEqual((target.list as unknown[])[0], shared);
	assert.notEqual((target.a as { deep: unknown }).deep, shared.deep);
});

test("an inserted branch carries no undefined-valued keys", () => {
	const target: Record<string, unknown> = {};
	reconcile(target, { node: { id: "a", layout: undefined, kids: [{ x: undefined }] } });
	const node = target.node as Record<string, unknown>;
	assert.equal("layout" in node, false);
	assert.deepEqual(node.kids, [{}]);
});

test("a branch replaced by a leaf, and the other way round", () => {
	const toLeaf: Record<string, unknown> = { v: { deep: 1 } };
	assert.equal(reconcile(toLeaf, { v: 3 }), true);
	assert.equal(toLeaf.v, 3);

	const toBranch: Record<string, unknown> = { v: 3 };
	assert.equal(reconcile(toBranch, { v: { deep: 1 } }), true);
	assert.deepEqual(toBranch.v, { deep: 1 });
});

test("a list is never merged into a map", () => {
	const target: Record<string, unknown> = { v: { 0: "a" } };
	assert.equal(reconcile(target, { v: ["a"] }), true);
	assert.ok(Array.isArray(target.v));
});

test("nulls are values, not deletions", () => {
	const target: Record<string, unknown> = { v: 1 };
	assert.equal(reconcile(target, { v: null }), true);
	assert.equal(target.v, null);
	assert.equal(reconcile(target, { v: null }), false);
});

test("only the touched subtree reports a change", () => {
	const target = { kept: { a: 1 }, edited: { b: 1 } };
	const kept = target.kept;
	assert.equal(reconcile(target, { kept: { a: 1 }, edited: { b: 2 } }), true);
	assert.equal(target.kept, kept);
	assert.equal(target.edited.b, 2);
});
