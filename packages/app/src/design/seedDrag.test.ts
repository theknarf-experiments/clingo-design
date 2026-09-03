import assert from "node:assert/strict";
import { test } from "node:test";

import type { SketchReport } from "@clingo-design/design-core";

import { sketchDrag } from "./seedDrag.ts";

/**
 * What a drag on a sketched node is allowed to write.
 *
 * One claim, made four times: **the aim is decided by what the sketch layer
 * owns and the frame by what it placed**, and reading one field for both jobs
 * is the defect these exist to keep out. It withheld the frame write on every
 * universe the sketch did not settle — where no solved coordinate exists and
 * the stored frame is the only thing placing the node — so the drag showed as
 * settling and then moved nothing, on exactly the documents where moving
 * something is the only move a designer has left.
 */

const report = (
	owned: Record<string, readonly ("x" | "y")[]>,
	placed: Record<string, readonly ("x" | "y")[]>,
	status: SketchReport["status"] = "settled",
): SketchReport => ({
	status,
	approximate: false,
	conflict: [],
	pinned: [],
	redundant: [],
	owned,
	placed,
});

const both = ["x", "y"] as const;

test("a settled node is aimed and its frame is left alone on every placed axis", () => {
	const { aim, held } = sketchDrag(
		report({ card: both, badge: both }, { card: both, badge: both }),
		["card", "badge"],
	);
	assert.deepEqual([...aim.keys()], ["card", "badge"]);
	assert.deepEqual([...held.keys()], ["card", "badge"]);
	assert.deepEqual(held.get("card"), both);
});

test("a node the sketch owns but did not place is aimed AND placed by the drag", () => {
	// The finding. `adrift` and `conflicted` both apply nothing, so `placed` is
	// empty while `owned` stays as it was — the rules are still the rules — and a
	// caller that withheld the frame write on `owned` withheld it here, where
	// nothing else was going to move the node.
	for (const status of ["adrift", "conflicted"] as const) {
		const { aim, held } = sketchDrag(
			report({ card: both, badge: both }, {}, status),
			["card", "badge"],
		);
		assert.deepEqual([...aim.keys()], ["card", "badge"], status);
		assert.equal(held.size, 0, `${status}: the frame is this node's only placer`);
	}
});

test("an axis at a time: one placed coordinate withholds one half of the frame", () => {
	// A node the linear layer holds on `x` and the sketch places on `y`. The frame
	// write keeps its `x` and gives up its `y`, which is the case that makes both
	// fields records rather than sets of node ids.
	const { aim, held } = sketchDrag(report({ card: ["y"] }, { card: ["y"] }), [
		"card",
	]);
	assert.deepEqual(aim.get("card"), ["y"]);
	assert.deepEqual(held.get("card"), ["y"]);
});

test("a document with no sketch rule in it drags exactly as it always did", () => {
	const { aim, held } = sketchDrag(undefined, ["card", "badge"]);
	assert.equal(aim.size, 0);
	assert.equal(held.size, 0);
});

test("a node that is not a member of any sketch rule is neither aimed nor held", () => {
	const { aim, held } = sketchDrag(report({ card: both }, { card: both }), [
		"card",
		"loose",
	]);
	assert.deepEqual([...aim.keys()], ["card"]);
	assert.deepEqual([...held.keys()], ["card"]);
});
