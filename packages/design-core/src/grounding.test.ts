/**
 * Which edits re-ground, and which the {@link Explorer} answers without
 * re-opening its session.
 *
 * This is the split the header of explore.ts argues from, kept executable so it
 * cannot rot. Nothing here is an aspiration: every assertion records what the
 * compiler does *today*, and the interesting direction of failure is the good
 * one — a case that flips from `re-grounds` to `reuses` is a win somebody should
 * come and write down.
 *
 * Through the real Explorer rather than by diffing `compile` output alone,
 * because `reusedGrounding` is the thing the app pays for and it is a property
 * of the session, not of the text.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { Explorer } from "./explore.ts";
import {
	addNode,
	deleteNodes,
	makeNode,
	renameConstraint,
	renameNode,
	renameToken,
	setFrame,
	setProp,
	setText,
	setTokenValue,
	updateConstraint,
} from "./edits.ts";
import type { Scene } from "./scene.ts";
import { findTemplate } from "./templates/index.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit } from "./values.ts";

/** A frame is EMU; the one case that drags something says the drag in pixels. */
const px = (n: number): number => n * EMU_PER_PX;

const card = (): Scene => findTemplate("card")!.create();
const palette = (): Scene => findTemplate("palette")!.create();

/**
 * True when exploring `after` on an Explorer already warmed on `before` keeps
 * the grounding.
 */
async function reuses(before: Scene, after: Scene): Promise<boolean> {
	const explorer = new Explorer(directSolver);
	try {
		await explorer.explore(before);
		return (await explorer.explore(after)).reusedGrounding;
	} finally {
		await explorer.close();
	}
}

/** Lines of the compiled program that `after` has and `before` does not. */
function addedLines(before: Scene, after: Scene): string[] {
	const strip = (scene: Scene) =>
		compile(scene)
			.program.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("%"));
	const had = new Set(strip(before));
	return strip(after).filter((line) => !had.has(line));
}

test("a node's name is the only label the program never sees", async () => {
	const base = card();
	// A node's name is the document's business and never reaches ASP, so this is
	// the one edit that is already free — and it is the whole of what the reuse
	// in `explore` catches.
	assert.equal(await reuses(base, renameNode(base, "badge", "Chip")), true);
	assert.deepEqual(addedLines(base, renameNode(base, "badge", "Chip")), []);

	// A token's name is *not* the same case, which is easy to assume and wrong:
	// `token_name/2` is compiled so the editor can read a document's own
	// vocabulary out of an answer set, and a quoted string is a term.
	const retitled = renameToken(base, "accent", "Brand");
	assert.equal(await reuses(base, retitled), false);
	assert.deepEqual(addedLines(base, retitled), ['token_name(accent,"Brand").']);

	// And a constraint "rename" is not a rename at all — it moves the id, which
	// is the term every guard, core and hand-written `viol/1` is written against.
	const withRules = palette();
	const rule = withRules.constraints[0];
	assert.ok(rule, "the palette template has a constraint to rename");
	const { scene: renamed } = renameConstraint(withRules, rule.id, "all_different");
	assert.equal(await reuses(withRules, renamed), false);
});

test("a drag re-grounds, because a coordinate is a term", async () => {
	const base = card();
	// The badge sits at 40,40 and is 64x26; this is one pixel of drag.
	const moved = setFrame(base, "badge", {
		x: px(41),
		y: px(40),
		width: px(64),
		height: px(26),
	});
	assert.equal(await reuses(base, moved), false);
	// And this is why it cannot be an external: the atom `frame(badge,x,390525)`
	// is not in the old grounding at all. Making it so means grounding every
	// coordinate a node could hold — and EMU makes that argument stronger rather
	// than weaker, since the lattice a coordinate lives on is now 9525 times
	// finer. It is measured in the header of explore.ts and is orders of
	// magnitude the wrong way.
	assert.ok(
		addedLines(base, moved).includes(`frame(badge,x,${px(41)}).`),
		"the moved coordinate arrives as a brand-new atom",
	);
});

test("typing text re-grounds, and adds exactly one literal", async () => {
	const base = card();
	const typed = setText(base, "title", "Aurora!");
	assert.equal(await reuses(base, typed), false);
	// One new term, and no way to have pre-ground it: the string is whatever the
	// designer typed.
	const added = addedLines(base, typed);
	assert.equal(added.length, 1);
	assert.match(added[0], /^literal\(l\d+,"Aurora!"\)\.$/);
});

test("a colour already in the document is one atom; a new one is a new term", async () => {
	const base = card();
	// `#10b981` is one of the accent token's five values, so the literal table
	// already holds it and only the pointer moves. This is the one value edit
	// multi-shot could express — `alt_literal/3` as an external, verified to
	// work — and it is also the one the colour picker almost never produces.
	const known = setProp(base, ["badge"], "fill", [lit("#10b981")]);
	assert.deepEqual(addedLines(base, known), [
		"alt_literal(prop(badge,fill),0,l1).",
	]);

	// An arbitrary colour is a new literal, and because the table is numbered by
	// order of appearance, inserting one renumbers every literal after it.
	const fresh = setProp(base, ["badge"], "fill", [lit("#123456")]);
	assert.ok(addedLines(base, fresh).length > 1);
	assert.equal(await reuses(base, fresh), false);
});

test("structural edits re-ground, in both directions", async () => {
	const base = card();
	const added = makeNode("rect", { x: 10, y: 10, width: 20, height: 20 });
	assert.equal(await reuses(base, addNode(base, added)), false);
	assert.equal(await reuses(base, deleteNodes(base, ["badge"])), false);
	// A token's value is the alternatives themselves, so editing one is editing
	// the design space rather than a point in it.
	assert.equal(
		await reuses(base, setTokenValue(base, "accent", [lit("#000000")])),
		false,
	);
});

test("switching a rule off re-grounds today, and is the one edit that need not", async () => {
	const base = palette();
	const rule = base.constraints.find((c) => c.enabled);
	assert.ok(rule, "the palette template has an enabled constraint");
	const off = updateConstraint(base, rule.id, { enabled: false });
	assert.equal(await reuses(base, off), false);

	// Nothing new appears — a disabled constraint emits *fewer* facts, never
	// other ones. So this edit, alone among the ones above, is expressible as
	// `#external constraint(C)`: the terms are all already there. It is not done
	// because of what it would cost everywhere else; see the header of
	// explore.ts for the arithmetic.
	assert.deepEqual(addedLines(base, off), []);
	// Pinning, by contrast, is already free — an assumption, not a fact.
	const explorer = new Explorer(directSolver);
	try {
		const first = await explorer.explore(base);
		const pinnable = Object.entries(first.brave.pick).find(
			([, indices]) => indices.size > 1,
		);
		assert.ok(pinnable, "the palette template has something left to pin");
		const pinned = await explorer.explore(base, {
			pins: { [pinnable[0]]: [...pinnable[1]][0] },
		});
		assert.equal(pinned.reusedGrounding, true);
	} finally {
		await explorer.close();
	}
});
