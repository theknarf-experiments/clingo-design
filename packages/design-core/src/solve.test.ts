import assert from "node:assert/strict";
import { test } from "node:test";

import {
	CONTRACT,
	compile,
	reachableAlternatives,
	unreadVariables,
	varyingVariables,
} from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import {
	addNode,
	addToken,
	collapseToPicks,
	deleteToken,
	makeNode,
	renameToken,
	setProp,
	setTokenValue,
	wearStyle,
} from "./edits.ts";
import { Explorer, explore, varyingVars } from "./explore.ts";
import { findTemplate } from "./templates/index.ts";
import { type Scene, emptyScene } from "./scene.ts";
import {
	lit,
	propVar,
	ref,
	resolveValue,
	single,
	styleVar,
	tokenVar,
} from "./values.ts";

const card = () => findTemplate("card")!.create();
const run = (scene: Scene, limit = 64) =>
	explore(scene, directSolver, { limit, sample: "first" });

function boxScene(fill: ReturnType<typeof single>): Scene {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(
		scene,
		makeNode("rect", { x: 0, y: 0, width: 10, height: 10 }, { id: "box" }),
	);
	return setProp(scene, ["box"], "fill", fill);
}

test("a single-alternative document has exactly one universe", async () => {
	const result = await run(boxScene(single("#fff")));
	assert.equal(result.count, 1);
	assert.deepEqual(varyingVars(result), []);
});

test("alternatives on a property make it branch", async () => {
	const scene = boxScene([lit("#f00"), lit("#0f0"), lit("#00f")]);
	const result = await run(scene);

	assert.equal(result.count, 3);
	assert.deepEqual(varyingVars(result), [propVar("box", "fill")]);
	// Each universe picks a different alternative.
	const picked = result.universes.map((u) => u.pick[propVar("box", "fill")]);
	assert.deepEqual([...picked].sort(), [0, 1, 2]);
});

test("alternatives on a token branch every reference together", async () => {
	// Two boxes both linked to one token: they must always agree.
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, makeNode("rect", { x: 0, y: 0, width: 10, height: 10 }, { id: "a" }));
	scene = addNode(scene, makeNode("rect", { x: 20, y: 0, width: 10, height: 10 }, { id: "b" }));
	scene = setProp(scene, ["a"], "fill", [ref("accent")]);
	scene = setProp(scene, ["b"], "fill", [ref("accent")]);
	scene = setTokenValue(scene, "accent", [lit("#f00"), lit("#0f0")]);

	const result = await run(scene);
	assert.equal(result.count, 2, "one shared choice, not two independent ones");
	assert.deepEqual(varyingVars(result), [tokenVar("accent")]);

	for (const universe of result.universes) {
		const ctx = { tokens: scene.tokens, picks: universe.pick };
		assert.equal(
			resolveValue(ctx, [ref("accent")], propVar("a", "fill")),
			resolveValue(ctx, [ref("accent")], propVar("b", "fill")),
		);
	}
});

test("independent assignments multiply, shared tokens do not", async () => {
	// Same palette pasted onto two boxes: 3 x 3 = 9.
	const palette = [lit("#f00"), lit("#0f0"), lit("#00f")];
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, makeNode("rect", { x: 0, y: 0, width: 10, height: 10 }, { id: "a" }));
	scene = addNode(scene, makeNode("rect", { x: 20, y: 0, width: 10, height: 10 }, { id: "b" }));
	scene = setProp(scene, ["a"], "fill", palette);
	scene = setProp(scene, ["b"], "fill", palette);

	const result = await run(scene);
	assert.equal(result.count, 9);
});

test("a property may choose between a literal and a token", async () => {
	let scene = boxScene([lit("#111"), ref("accent")]);
	scene = setTokenValue(scene, "accent", [lit("#f00"), lit("#0f0")]);
	const result = await run(scene);

	// 1 literal + 2 through the token = 3 distinct designs, but 2 x 2 picks;
	// projection collapses the pairs that render identically.
	const colours = new Set(
		result.universes.map((u) =>
			resolveValue(
				{ tokens: scene.tokens, picks: u.pick },
				[lit("#111"), ref("accent")],
				propVar("box", "fill"),
			),
		),
	);
	assert.deepEqual([...colours].sort(), ["#0f0", "#111", "#f00"]);
});

test("resolution happens inside ASP too, so rules can compare values", async () => {
	// Two boxes drawing from the same palette, forbidden from matching.
	const palette = [lit("#f00"), lit("#0f0")];
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, makeNode("rect", { x: 0, y: 0, width: 10, height: 10 }, { id: "a" }));
	scene = addNode(scene, makeNode("rect", { x: 20, y: 0, width: 10, height: 10 }, { id: "b" }));
	scene = setProp(scene, ["a"], "fill", palette);
	scene = setProp(scene, ["b"], "fill", palette);
	scene.rules = ":- resolved(prop(a,fill),C), resolved(prop(b,fill),C).";

	const result = await run(scene);
	assert.equal(result.count, 2, "the two matching combinations are ruled out");
});

test("a rule can compare a literal against a token reference", async () => {
	let scene = boxScene([lit("#f00")]);
	scene = addNode(
		scene,
		makeNode("rect", { x: 20, y: 0, width: 10, height: 10 }, { id: "other" }),
	);
	scene = setProp(scene, ["other"], "fill", [ref("accent")]);
	scene = setTokenValue(scene, "accent", [lit("#f00"), lit("#0f0")]);
	// The box is #f00; forbid the token from resolving to the same literal.
	scene.rules = ":- resolved(prop(box,fill),C), resolved(prop(other,fill),C).";

	const result = await run(scene);
	assert.equal(result.count, 1);
	assert.equal(
		resolveValue(
			{ tokens: scene.tokens, picks: result.universes[0].pick },
			[ref("accent")],
			propVar("other", "fill"),
		),
		"#0f0",
	);
});

test("identical literals intern to one id, so equality works across nodes", () => {
	const palette = [lit("#f00"), lit("#0f0")];
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = addNode(scene, makeNode("rect", { x: 0, y: 0, width: 10, height: 10 }, { id: "a" }));
	scene = addNode(scene, makeNode("rect", { x: 20, y: 0, width: 10, height: 10 }, { id: "b" }));
	scene = setProp(scene, ["a"], "fill", palette);
	scene = setProp(scene, ["b"], "fill", palette);

	const { generated } = compile(scene);
	// Each distinct text appears once in the table, however many places use it.
	const table = [...generated.matchAll(/^literal\((l\d+),"([^"]*)"\)\./gm)];
	const byText = new Map(table.map((m) => [m[2], m[1]]));
	assert.equal(byText.size, table.length, "no text is interned twice");

	// Both nodes must point at the *same* ids, or rules could not compare them.
	const idFor = (text: string) => byText.get(text);
	for (const colour of ["#f00", "#0f0"]) {
		const id = idFor(colour);
		assert.ok(id, `${colour} should be interned`);
		assert.match(generated, new RegExp(`alt_literal\\(prop\\(a,fill\\),\\d+,${id}\\)`));
		assert.match(generated, new RegExp(`alt_literal\\(prop\\(b,fill\\),\\d+,${id}\\)`));
	}
});

test("geometry stays a fact, never a choice", () => {
	const scene = addNode(
		{ ...emptyScene(), nodes: [] },
		makeNode("rect", { x: 120, y: 80, width: 200, height: 140 }, { id: "box" }),
	);
	const { generated, variables } = compile(scene);
	assert.match(generated, /frame\(box,x,120\)\./);
	assert.equal((generated.match(/frame\(box,/g) ?? []).length, 4);
	// The only variables are the box's own properties, plus the tokens.
	assert.ok(!Object.keys(variables).some((v) => v.includes("frame")));
});

test("varyingVariables reports what will branch, without solving", () => {
	let scene = boxScene([lit("#f00"), lit("#0f0")]);
	scene = setTokenValue(scene, "radius", [lit("0px"), lit("9px")]);
	assert.deepEqual(varyingVariables(scene).sort(), [
		propVar("box", "fill"),
		tokenVar("radius"),
	]);
});

test("collapsing to a universe leaves a single-valued document", async () => {
	const scene = card();
	const result = await run(scene);
	assert.ok(result.count > 1);

	const collapsed = collapseToPicks(scene, result.universes[0].pick);
	assert.deepEqual(varyingVariables(collapsed), []);
	const after = await run(collapsed);
	assert.equal(after.count, 1);
});

test("adding, renaming and deleting tokens", () => {
	const scene = emptyScene();
	const { scene: withNew, id } = addToken(scene, "color");
	assert.equal(withNew.tokens.length, scene.tokens.length + 1);

	const renamed = renameToken(withNew, id, "  brand  ");
	assert.equal(renamed.tokens.find((t) => t.id === id)?.name, "brand");
	// A blank name is rejected rather than leaving an unnamed variable.
	assert.equal(renameToken(renamed, id, "  ").tokens.find((t) => t.id === id)?.name, "brand");
});

test("deleting a token freezes its value into everything that used it", () => {
	let scene = boxScene([ref("accent")]);
	scene = setTokenValue(scene, "accent", single("#abcdef"));
	const after = deleteToken(scene, "accent");

	assert.equal(after.tokens.find((t) => t.id === "accent"), undefined);
	// The box keeps looking the same instead of losing its fill.
	assert.deepEqual(after.nodes[0].props.fill, [lit("#abcdef")]);
});

test("a token value that would cycle is rejected", () => {
	let scene: Scene = { ...emptyScene(), nodes: [] };
	scene = setTokenValue(scene, "accent", [ref("surface")]);
	const before = scene.tokens.find((t) => t.id === "surface")?.value;
	// surface -> accent would close the loop.
	scene = setTokenValue(scene, "surface", [ref("accent")]);
	assert.deepEqual(scene.tokens.find((t) => t.id === "surface")?.value, before);
});

test("the contract documents the resolved predicate", () => {
	assert.match(CONTRACT, /resolved\(V, Lit\)/);
	assert.match(CONTRACT, /prop\(Node, Property\)/);
});

test("Explorer still reuses the grounding when nothing structural changed", async () => {
	const explorer = new Explorer(directSolver);
	try {
		const scene = card();
		await explorer.explore(scene);
		assert.equal((await explorer.explore(scene)).reusedGrounding, true);
		// Changing an alternative is structural, so it re-grounds.
		const edited = setTokenValue(scene, "accent", single("#000000"));
		assert.equal((await explorer.explore(edited)).reusedGrounding, false);
	} finally {
		await explorer.close();
	}
});

test("alternatives that resolve alike collapse into one universe", async () => {
	// Two ways to say the same colour is not two designs.
	const scene = boxScene([lit("#ff0000"), lit("#ff0000")]);
	const result = await run(scene);
	assert.equal(result.count, 1);
});

test("a literal duplicating a token's value does not double the space", async () => {
	// Exactly what "+ Add value" then "unlink" produces in the inspector.
	let scene = boxScene([ref("accent")]);
	scene = setTokenValue(scene, "accent", [lit("#111111"), lit("#222222")]);
	const before = await run(scene);
	assert.equal(before.count, 2);

	// Adding an alternative that can only ever resolve to #111111 adds a
	// pick, but no new design.
	const widened = setProp(scene, ["box"], "fill", [ref("accent"), lit("#111111")]);
	const after = await run(widened);
	assert.equal(after.count, 2, "still #111111 or #222222");
});

test("genuinely different alternatives still branch", async () => {
	let scene = boxScene([ref("accent"), lit("#00ff00")]);
	scene = setTokenValue(scene, "accent", [lit("#111111"), lit("#222222")]);
	const result = await run(scene);
	assert.equal(result.count, 3, "#111111, #222222 or #00ff00");
});

/* ------------------------------------------------------------------ */
/* Variables nothing consults                                          */
/* ------------------------------------------------------------------ */

test("a variable nothing consults is not reported as narrowed", async () => {
	// PROJECTION MAKES AN UNUSED VARIABLE LOOK RULED OUT. The program projects on
	// what a design renders, so every universe that differs only in a pick nobody
	// reads collapses into one, and brave consequences come back naming a single
	// reachable alternative. A row that greys the rest is claiming a rule forbade
	// them; nothing did, and nothing asked.
	//
	// This is asserted against the real solver in both directions on one document,
	// because the failure is not "the wrong number" — it is a true answer to a
	// question that was never worth asking, and only the contrast says so.
	let scene = boxScene([lit("#f00")]);
	scene = setTokenValue(scene, "accent", [lit("#111111"), lit("#222222")]);
	const spare = tokenVar("accent");
	const found = await run(scene);
	assert.deepEqual([...(found.brave.pick[spare] ?? [])].sort(), [1], "collapsed");

	// So the panel is handed an answer with that entry taken out, and an absent
	// entry is what every row already reads as "nothing to say".
	const reach = reachableAlternatives(scene, found.brave.pick);
	assert.equal(reach?.[spare], undefined);
	assert.ok(unreadVariables(scene).has(spare));
	// The document still holds the branch, and the panel still says so: which
	// alternatives are *reachable* and whether the assignment *varies* are two
	// different questions, and only the first one has no answer here.
	assert.ok(varyingVariables(scene).includes(spare));

	// And the control, on the same token: link the box to it and the answer means
	// something again, so nothing above is a blanket exemption for tokens.
	const linked = setProp(scene, ["box"], "fill", [ref("accent")]);
	const after = await run(linked);
	assert.deepEqual([...(after.brave.pick[spare] ?? [])].sort(), [0, 1]);
	assert.equal(unreadVariables(linked).has(spare), false);
	assert.deepEqual(
		reachableAlternatives(linked, after.brave.pick)?.[spare],
		new Set([0, 1]),
	);
});

test("an unworn style, and a token only an unworn style names, are both unread", async () => {
	// The three ways this bites, in one document. `Styles` had a gate of its own
	// and the token rows had none, which is why the answer now comes from one
	// place: the question is "does anything consult this", and a token reached
	// only through something nothing consults is not consulted either.
	let scene = boxScene([lit("#f00")]);
	scene = setTokenValue(scene, "accent", [lit("#111111"), lit("#222222")]);
	scene = {
		...scene,
		styles: [
			{
				id: "h",
				name: "Heading",
				variants: [
					{ parts: { fill: ref("accent") } },
					{ parts: { fill: lit("#333333") } },
				],
			},
		],
	};
	const unread = unreadVariables(scene);
	assert.ok(unread.has(styleVar("h")), "nothing wears it");
	assert.ok(unread.has(tokenVar("accent")), "only the unworn style names it");
	// Both really do come back collapsed, so the greying really would have lied.
	const found = await run(scene);
	assert.equal(found.brave.pick[styleVar("h")]?.size, 1);
	assert.equal(found.brave.pick[tokenVar("accent")]?.size, 1);

	// Wear it and both become consulted, in one step: the style decides `fill`,
	// and the variant that decides it links to the token.
	const worn = wearStyle(scene, ["box"], "h");
	const wornUnread = unreadVariables(worn);
	assert.equal(wornUnread.has(styleVar("h")), false);
	assert.equal(wornUnread.has(tokenVar("accent")), false);
	const answer = await run(worn);
	assert.deepEqual([...(answer.brave.pick[styleVar("h")] ?? [])].sort(), [0, 1]);
});

test("a style is unread when its wearer decides everything the style mentions", () => {
	// Stricter than counting wearers, which is what the panel used to do. A node
	// may wear a style and state every property the style talks about, and then
	// the style is worn and still decides nothing — `wornProps` is the precedence
	// the compiler applies, so it is the precedence this reads.
	let scene = boxScene([lit("#f00")]);
	scene = {
		...scene,
		styles: [
			{
				id: "h",
				name: "Heading",
				variants: [
					{ parts: { fill: lit("#111111") } },
					{ parts: { fill: lit("#222222") } },
				],
			},
		],
	};
	const worn = wearStyle(scene, ["box"], "h");
	// `wearStyle` clears what the style decides, which is what makes the gesture
	// visible — so the style is consulted.
	assert.equal(unreadVariables(worn).has(styleVar("h")), false);
	// Say it again on the node itself and the node wins, so the style is left
	// deciding nothing at all.
	const overridden = setProp(worn, ["box"], "fill", [lit("#abcdef")]);
	assert.ok(unreadVariables(overridden).has(styleVar("h")));
});

test("a hand-written rule naming a token is enough to count as consulting it", () => {
	// Over-reporting is the dangerous direction: calling a variable unread when a
	// rule reads it would hide a real ban. Nothing here can know what a rule wants
	// with `tok(accent)`, so a mention is taken at its word.
	let scene = boxScene([lit("#f00")]);
	scene = setTokenValue(scene, "accent", [lit("#111111"), lit("#222222")]);
	assert.ok(unreadVariables(scene).has(tokenVar("accent")));
	const consulted = { ...scene, rules: "mine :- resolved(tok(accent),L), L != nothing." };
	assert.equal(unreadVariables(consulted).has(tokenVar("accent")), false);
	// A name that merely *contains* the id is not a mention of it.
	const other = { ...scene, rules: "mine :- resolved(tok(accenting),L)." };
	assert.ok(unreadVariables(other).has(tokenVar("accent")));
});
