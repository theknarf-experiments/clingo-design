/**
 * Styles: one variable whose alternatives are whole records.
 *
 * The whole feature is one claim, and the first test is that claim: link a
 * heading's size to one token and its weight to another and the solver picks
 * them *independently*, so two two-alternative tokens are four designs of which
 * two pair a display size with a body weight. Correlation between properties is
 * the one thing the scalar token model cannot express — you would need N tokens
 * plus a `match` constraint per pair, which is unwritable.
 *
 * So the acceptance criterion is not "a style renders". It is that the
 * incoherent combinations are *absent*, and that the coherent ones are still
 * there. Everything here goes through the real solver, because that absence is
 * a fact about the answer sets and about nothing else.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, SCENERY_ATOM, compile, variableCounts } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import {
	addStyle,
	addStyleVariant,
	collapseToPicks,
	deleteStyle,
	deleteStyleVariant,
	makeNode,
	renameStyle,
	renameStyleVariant,
	setProp,
	setStyle,
	setStylePart,
	wearStyle,
} from "./edits.ts";
import { explore } from "./explore.ts";
import { normalizeScene } from "./project.ts";
import { readModel } from "./model.ts";
import {
	PROPS,
	STYLE_PROPS,
	type Scene,
	type SceneNode,
	type Style,
	emptyScene,
	propValueOf,
	styleProps,
	variantLabel,
	wornProps,
} from "./scene.ts";
import { findInTree } from "./tree.ts";
import {
	type Term,
	derive,
	lit,
	parseVariable,
	ref,
	single,
	stylePartVar,
	styleVar,
} from "./values.ts";

/* ------------------------------------------------------------------ */
/* Scaffolding                                                         */
/* ------------------------------------------------------------------ */

/** A page with `n` text nodes in it, and nothing else. */
function page(n: number): Scene {
	const kids: SceneNode[] = [];
	for (let i = 1; i <= n; i++) {
		kids.push({
			...makeNode("text", { x: 20, y: 20 + i * 40, width: 200, height: 30 }, {
				id: `t${i}`,
			}),
			props: { text: single(`Heading ${i}`) },
		});
	}
	return {
		...emptyScene(),
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: 320, height: 240 }, {
					id: "page",
				}),
				children: kids,
			},
		],
	};
}

const style = (id: string, variants: Style["variants"]): Style => ({
	id,
	name: id,
	variants,
});

function wear(scene: Scene, ids: readonly string[], styleId: string): Scene {
	return setStyle(scene, ids, styleId);
}

/** Every answer set, with the picture on. */
async function models(scene: Scene, limit = 0): Promise<string[][]> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: limit,
			assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		return out.result === "UNSATISFIABLE" ? [] : out.models;
	} finally {
		await session.close();
	}
}

/** `node.prop=text` for everything drawn, per model, sorted. */
function drawn(atoms: readonly string[], props: readonly string[]): string[] {
	const model = readModel(atoms);
	const out: string[] = [];
	for (const node of Object.values(model.byId)) {
		for (const prop of props) {
			const text = node.rendered[prop as keyof typeof node.rendered];
			if (text !== undefined) out.push(`${node.id}.${prop}=${text}`);
		}
	}
	return out.sort();
}

/** The set of designs, as one comparable string each. */
async function designs(scene: Scene, props: readonly string[]): Promise<string[]> {
	return (await models(scene)).map((m) => drawn(m, props).join(" ")).sort();
}

/* ------------------------------------------------------------------ */
/* The claim                                                          */
/* ------------------------------------------------------------------ */

test("two scalar tokens give the cross product, incoherent designs included", async () => {
	// The state of the world before styles: size and weight vary independently.
	let scene = page(1);
	scene = {
		...scene,
		tokens: [
			{ id: "sz", name: "sz", type: "length", value: [lit("32px"), lit("16px")] },
			{ id: "wt", name: "wt", type: "weight", value: [lit("700"), lit("400")] },
		],
	};
	scene = setProp(scene, ["t1"], "size", [ref("sz")]);
	scene = setProp(scene, ["t1"], "weight", [ref("wt")]);

	const found = await designs(scene, ["size", "weight"]);
	assert.equal(found.length, 4, "the cross product");
	assert.ok(
		found.includes("t1.size=32px t1.weight=400"),
		"and it contains a display size at a body weight",
	);
});

test("one style collapses that cross product into a correlation", async () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("heading", [
				{
					name: "Compact",
					parts: { size: lit("16px"), weight: lit("400"), lineHeight: lit("1.2") },
				},
				{
					name: "Comfortable",
					parts: { size: lit("32px"), weight: lit("700"), lineHeight: lit("1.6") },
				},
			]),
		],
	};
	scene = wear(scene, ["t1"], "heading");

	const found = await designs(scene, ["size", "weight", "lineHeight"]);
	assert.deepEqual(found, [
		"t1.lineHeight=1.2 t1.size=16px t1.weight=400",
		"t1.lineHeight=1.6 t1.size=32px t1.weight=700",
	]);
	// The point, stated as an absence: every incoherent pairing is gone.
	for (const bad of [
		["size=16px", "weight=700"],
		["size=32px", "weight=400"],
		["size=16px", "lineHeight=1.6"],
		["size=32px", "lineHeight=1.2"],
	]) {
		assert.ok(
			!found.some((d) => bad.every((part) => d.includes(part))),
			`${bad.join(" with ")} is not a design`,
		);
	}
});

test("the correlation holds across every node wearing the style", async () => {
	// "Compact versus comfortable typography across a whole page" — one variable.
	let scene = page(3);
	scene = {
		...scene,
		styles: [
			style("body", [
				{ parts: { size: lit("14px"), lineHeight: lit("1.2") } },
				{ parts: { size: lit("18px"), lineHeight: lit("1.6") } },
			]),
		],
	};
	scene = wear(scene, ["t1", "t2", "t3"], "body");

	const found = await designs(scene, ["size", "lineHeight"]);
	assert.equal(found.length, 2, "three nodes, still two designs");
	for (const design of found) {
		const sizes = new Set(
			design.split(" ").filter((p) => p.includes(".size=")).map((p) => p.split("=")[1]),
		);
		assert.equal(sizes.size, 1, "every wearer is at the same size");
	}
});

/* ------------------------------------------------------------------ */
/* A part is a value: tokens and derivations                           */
/* ------------------------------------------------------------------ */

test("a style part that names a token resolves through to the token's value", async () => {
	let scene = page(1);
	scene = {
		...scene,
		tokens: [
			{ id: "lg", name: "lg", type: "length", value: single("40px") },
			{ id: "brand", name: "brand", type: "color", value: single("#3b82f6") },
		],
		styles: [
			style("display", [{ parts: { size: ref("lg"), ink: ref("brand") } }]),
		],
	};
	scene = wear(scene, ["t1"], "display");

	assert.deepEqual(await designs(scene, ["size", "ink"]), [
		"t1.ink=#3b82f6 t1.size=40px",
	]);
});

test("a token's own alternatives still branch through a style part", async () => {
	let scene = page(1);
	scene = {
		...scene,
		tokens: [
			{ id: "lg", name: "lg", type: "length", value: [lit("40px"), lit("28px")] },
		],
		styles: [style("display", [{ parts: { size: ref("lg") } }])],
	};
	scene = wear(scene, ["t1"], "display");

	// One variant, two designs: the scale is still one source of truth, and a
	// style linking to it inherits its branching rather than flattening it.
	assert.deepEqual(await designs(scene, ["size"]), [
		"t1.size=28px",
		"t1.size=40px",
	]);
});

test("a derived style part is computed per universe", async () => {
	let scene = page(1);
	scene = {
		...scene,
		tokens: [
			{
				id: "bg",
				name: "bg",
				type: "color",
				value: [lit("#ffffff"), lit("#0f172a")],
			},
		],
		styles: [style("onBg", [{ parts: { ink: derive("contrast", "tok(bg)") } }])],
	};
	scene = wear(scene, ["t1"], "onBg");

	assert.deepEqual(await designs(scene, ["ink"]), [
		"t1.ink=#0f172a",
		"t1.ink=#ffffff",
	]);
});

/* ------------------------------------------------------------------ */
/* Precedence                                                          */
/* ------------------------------------------------------------------ */

test("a node that states its own value keeps it, and takes the rest", async () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("heading", [
				{ parts: { size: lit("16px"), weight: lit("400") } },
				{ parts: { size: lit("32px"), weight: lit("700") } },
			]),
		],
	};
	scene = wear(scene, ["t1"], "heading");
	scene = setProp(scene, ["t1"], "size", single("24px"));

	const found = await designs(scene, ["size", "weight"]);
	assert.deepEqual(found, [
		"t1.size=24px t1.weight=400",
		"t1.size=24px t1.weight=700",
	]);
	// One value per property, in every design. Two would be the failure mode:
	// `rendered/3` is a relation, so nothing stops it holding both.
	for (const atoms of await models(scene)) {
		const sizes = atoms.filter((a) => a.startsWith("rendered(t1,size,"));
		assert.equal(sizes.length, 1, "exactly one size is rendered");
	}
});

test("applying a style to nodes that state their own values is visible", async () => {
	// The gesture, and the reason `wearStyle` exists beside `setStyle`. Every
	// text node the studio makes states a size and a weight, so applying a
	// treatment with `setStyle` alone changes nothing anybody can see and leaves
	// one silent override per node per property.
	let scene = page(3);
	for (const id of ["t1", "t2", "t3"])
		scene = setProp(scene, [id], "size", single("14px"));
	scene = {
		...scene,
		styles: [
			style("prose", [
				{ parts: { size: lit("15px"), weight: lit("450") } },
				{ parts: { size: lit("18px"), weight: lit("400") } },
			]),
		],
	};
	const ids = ["t1", "t2", "t3"];

	const inert = setStyle(scene, ids, "prose");
	assert.deepEqual(
		wornProps(inert, findInTree(inert.nodes, "t1") as SceneNode),
		["weight"],
		"size stays the node's own, so applying it half worked",
	);
	assert.deepEqual(
		await designs(inert, ["size"]),
		[
			"t1.size=14px t2.size=14px t3.size=14px",
			"t1.size=14px t2.size=14px t3.size=14px",
		],
		"two designs, and the size is the same 14px in both",
	);

	const applied = wearStyle(scene, ids, "prose");
	for (const id of ids)
		assert.deepEqual(
			wornProps(applied, findInTree(applied.nodes, id) as SceneNode),
			["size", "weight"],
			"the treatment won",
		);
	assert.deepEqual(await designs(applied, ["size", "weight"]), [
		"t1.size=15px t1.weight=450 t2.size=15px t2.weight=450 t3.size=15px t3.weight=450",
		"t1.size=18px t1.weight=400 t2.size=18px t2.weight=400 t3.size=18px t3.weight=400",
	]);

	// And then one override, made on purpose, is the only one there is — the
	// other two wearers still move with the pick.
	const one = setProp(applied, ["t2"], "size", single("34px"));
	assert.deepEqual(await designs(one, ["size"]), [
		"t1.size=15px t2.size=34px t3.size=15px",
		"t1.size=18px t2.size=34px t3.size=18px",
	]);
	assert.deepEqual(
		wornProps(one, findInTree(one.nodes, "t2") as SceneNode),
		["weight"],
	);

	// Taking it off again leaves the node with no opinion rather than with a
	// baked copy: nothing was ever written in, so there is nothing to leave.
	const bare = wearStyle(applied, ["t1"], undefined);
	assert.equal(findInTree(bare.nodes, "t1")?.props.size, undefined);
	assert.equal(findInTree(bare.nodes, "t1")?.style, undefined);
});

test("wearing a style leaves alone what the wearer cannot draw", () => {
	// A rectangle wearing a text style keeps its fill: the property was never
	// worn, so clearing it would be an edit to something invisible.
	let scene = page(1);
	scene = {
		...scene,
		nodes: [
			{
				...(scene.nodes[0] as SceneNode),
				children: [
					...(scene.nodes[0].children ?? []),
					{
						...makeNode("rect", { x: 0, y: 0, width: 40, height: 40 }, { id: "box" }),
						props: { fill: single("#ff0000"), size: single("40px") },
					},
				],
			},
		],
		styles: [
			style("prose", [
				{ parts: { size: lit("15px"), fill: lit("#000000") } },
				{ parts: { size: lit("18px"), fill: lit("#111111") } },
			]),
		],
	};
	const worn = wearStyle(scene, ["t1", "box"], "prose");
	const box = findInTree(worn.nodes, "box") as SceneNode;
	assert.deepEqual(box.props.fill, undefined, "a rect draws a fill, so it goes");
	assert.deepEqual(
		box.props.size,
		single("40px"),
		"a rect has nowhere to put a size, so it stays",
	);
	// The text node is the mirror image of that.
	const t1 = findInTree(worn.nodes, "t1") as SceneNode;
	assert.equal(t1.props.size, undefined);
	assert.deepEqual(wornProps(worn, t1), ["size"]);
});

test("the document, read on this side, agrees about precedence", () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("heading", [
				{ parts: { size: lit("16px"), weight: lit("400") } },
				{ parts: { size: lit("32px"), weight: lit("700") } },
			]),
		],
	};
	scene = wear(scene, ["t1"], "heading");
	scene = setProp(scene, ["t1"], "size", single("24px"));
	const node = findInTree(scene.nodes, "t1") as SceneNode;

	assert.deepEqual(propValueOf(scene, node, "size"), single("24px"));
	assert.deepEqual(propValueOf(scene, node, "weight"), [lit("400")]);
	assert.deepEqual(
		propValueOf(scene, node, "weight", { [styleVar("heading")]: 1 }),
		[lit("700")],
		"the universe on screen decides which variant is read",
	);
	assert.deepEqual(wornProps(scene, node), ["weight"]);
});

test("a style decides nothing about a kind that cannot draw the property", async () => {
	let scene = page(1);
	scene = {
		...scene,
		nodes: [
			{
				...scene.nodes[0],
				children: [
					...(scene.nodes[0].children ?? []),
					makeNode("rect", { x: 8, y: 8, width: 40, height: 40 }, { id: "box" }),
				],
			},
		],
		styles: [
			style("heading", [{ parts: { size: lit("32px"), fill: lit("#123456") } }]),
		],
	};
	// A fresh rect is born holding its kind's default fill, and that default is
	// the node's own value — so it wins, exactly as a typed one would. Cleared
	// here so the question under test is about the *kind* and not about
	// precedence, which the previous test is about.
	scene = setProp(scene, ["box"], "fill", undefined);
	scene = wear(scene, ["t1", "box"], "heading");

	const [only] = await models(scene);
	const model = readModel(only);
	assert.equal(model.byId.t1.rendered.size, "32px", "the text takes the size");
	assert.equal(model.byId.t1.rendered.fill, undefined, "text has no fill to take");
	assert.equal(model.byId.box.rendered.fill, "#123456", "the rect takes the fill");
	assert.equal(model.byId.box.rendered.size, undefined, "a rect has no size to take");
	assert.deepEqual(
		wornProps(scene, findInTree(scene.nodes, "box") as SceneNode),
		["fill"],
	);
});

/* ------------------------------------------------------------------ */
/* Empty and degenerate                                                */
/* ------------------------------------------------------------------ */

test("a one-variant style is the ordinary named style: no branching", async () => {
	let scene = page(2);
	scene = {
		...scene,
		styles: [style("body", [{ parts: { size: lit("15px"), align: lit("center") } }])],
	};
	scene = wear(scene, ["t1", "t2"], "body");

	const found = await designs(scene, ["size", "align"]);
	assert.equal(found.length, 1, "one design");
	assert.equal(
		found[0],
		"t1.align=center t1.size=15px t2.align=center t2.size=15px",
	);
	assert.deepEqual(variableCounts(scene)[styleVar("body")], 1);
});

test("a style nobody wears creates no designs", async () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("unused", [
				{ parts: { size: lit("10px") } },
				{ parts: { size: lit("90px") } },
			]),
		],
	};
	// It is a variable — the solver picks for it — but nothing renders from it,
	// and projection is on what is rendered. So the space is unchanged.
	assert.equal((await models(scene)).length, 1);
	assert.equal(variableCounts(scene)[styleVar("unused")], 2);
});

test("a styled node whose style was deleted decides its own appearance", async () => {
	let scene = page(1);
	scene = { ...scene, styles: [style("gone", [{ parts: { size: lit("64px") } }])] };
	scene = wear(scene, ["t1"], "gone");
	// Not through `deleteStyle`, which bakes: this is the state a document is in
	// when the reference outlives the style, however it got there.
	const orphaned: Scene = { ...scene, styles: [] };

	const [only] = await models(orphaned);
	assert.equal(only !== undefined, true, "it still has a design");
	assert.equal(
		readModel(only).byId.t1.rendered.size,
		undefined,
		"nothing is rendered for the property, and nothing fails",
	);
	assert.deepEqual(
		wornProps(orphaned, findInTree(orphaned.nodes, "t1") as SceneNode),
		[],
	);
});

test("a variant that decides nothing is a real alternative", async () => {
	// "Styled, or plain" is one variable with two variants, one of them empty.
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("maybe", [{ parts: {} }, { parts: { weight: lit("800") } }]),
		],
	};
	scene = wear(scene, ["t1"], "maybe");

	const found = await designs(scene, ["weight"]);
	assert.deepEqual(found, ["", "t1.weight=800"], "one design draws no weight");
});

test("a style with no variants at all is dropped rather than made unsatisfiable", async () => {
	let scene = page(1);
	scene = { ...scene, styles: [style("empty", [])] };
	scene = wear(scene, ["t1"], "empty");

	const { generated } = compile(scene);
	assert.ok(!generated.includes(styleVar("empty")), "no variable is emitted");
	assert.equal((await models(scene)).length, 1, "and the document still solves");
});

/* ------------------------------------------------------------------ */
/* What falls out free                                                 */
/* ------------------------------------------------------------------ */

test("`sty(S)` is a variable key the studio can read back", () => {
	assert.deepEqual(parseVariable(styleVar("heading")), {
		kind: "style",
		style: "heading",
	});
	// A part is not one, deliberately: it holds a single alternative, so it is
	// never unsettled, pinned or shown.
	assert.equal(parseVariable(stylePartVar("heading", 0, "size")), null);
});

test("a style variable pins like any other", async () => {
	let scene = page(2);
	scene = {
		...scene,
		styles: [
			style("h", [
				{ parts: { size: lit("16px") } },
				{ parts: { size: lit("48px") } },
			]),
		],
	};
	scene = wear(scene, ["t1", "t2"], "h");

	const pinned = await explore(scene, directSolver, {
		limit: 8,
		pins: { [styleVar("h")]: 1 },
	});
	assert.equal(pinned.count, 1, "the pin settles the space");
	for (const universe of pinned.universes) {
		assert.equal(universe.model.byId.t1.rendered.size, "48px");
		assert.equal(universe.pick[styleVar("h")], 1);
	}
});

test("brave and cautious reach a style's variants with no special casing", async () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("h", [
				{ parts: { size: lit("16px") } },
				{ parts: { size: lit("48px") } },
			]),
		],
	};
	scene = wear(scene, ["t1"], "h");

	const found = await explore(scene, directSolver, { limit: 8 });
	assert.deepEqual(
		[...(found.brave.pick[styleVar("h")] ?? [])].sort(),
		[0, 1],
		"both variants are reachable — neither row is greyed",
	);
	assert.equal(
		found.cautious.pick[styleVar("h")],
		undefined,
		"and neither is forced",
	);
});

test("a rule can grey a variant out, and the greying reads off the same atoms", async () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("h", [
				{ parts: { size: lit("16px") } },
				{ parts: { size: lit("48px") } },
			]),
		],
		rules: `:- pick(sty(h),1).\n`,
	};
	scene = wear(scene, ["t1"], "h");

	const found = await explore(scene, directSolver, { limit: 8 });
	assert.deepEqual([...(found.brave.pick[styleVar("h")] ?? [])], [0]);
	assert.deepEqual([...(found.cautious.pick[styleVar("h")] ?? [])], [0]);
});

test("`differ` over a styled property means these headings must not look alike", async () => {
	let scene = page(2);
	scene = {
		...scene,
		styles: [
			style("a", [
				{ parts: { size: lit("32px"), weight: lit("700") } },
				{ parts: { size: lit("24px"), weight: lit("600") } },
			]),
			style("b", [
				{ parts: { size: lit("32px"), weight: lit("700") } },
				{ parts: { size: lit("16px"), weight: lit("400") } },
			]),
		],
		constraints: [
			{
				id: "distinct",
				kind: "differ",
				prop: "size",
				nodes: ["t1", "t2"],
				enabled: true,
			},
		],
	};
	scene = wear(scene, ["t1"], "a");
	scene = wear(scene, ["t2"], "b");

	const found = await designs(scene, ["size", "weight"]);
	// Three of the four pairings survive: the one where both styles say 32px is
	// the one the rule forbids, and it is forbidden through `rendered/3` with no
	// knowledge of styles anywhere in the rule.
	assert.equal(found.length, 3);
	for (const design of found) {
		const sizes = design
			.split(" ")
			.filter((p) => p.includes(".size="))
			.map((p) => p.split("=")[1]);
		assert.notEqual(sizes[0], sizes[1], "no two headings share a size");
	}
});

test("two nodes wearing one style cannot be made to differ — the correlation bites", async () => {
	let scene = page(2);
	scene = {
		...scene,
		styles: [
			style("h", [
				{ parts: { size: lit("32px") } },
				{ parts: { size: lit("16px") } },
			]),
		],
		constraints: [
			{
				id: "distinct",
				kind: "differ",
				prop: "size",
				nodes: ["t1", "t2"],
				enabled: true,
			},
		],
	};
	scene = wear(scene, ["t1", "t2"], "h");

	// One style, one pick, one size. This is not a bug to route around; it is
	// what "these wear the same treatment" means, and the rules panel says so by
	// coming back with nothing rather than by quietly picking twice.
	await assert.rejects(() => explore(scene, directSolver, { limit: 4 }), {
		name: "UnsatisfiableError",
	});
});

test("a hand-written rule can dress nodes it created", async () => {
	// `sty_wears/3` is part of the contract, so the style machinery reaches
	// nodes the document has no account of.
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("h", [
				{ parts: { size: lit("20px") } },
				{ parts: { size: lit("44px") } },
			]),
		],
		rules: [
			"node(extra). kind(extra,text). child(page,extra).",
			"frame(extra,x,20). frame(extra,y,180).",
			"frame(extra,width,120). frame(extra,height,24).",
			"sty_wears(extra,h,size).",
			"",
		].join("\n"),
	};

	const found = await models(scene);
	assert.equal(found.length, 2, "the derived node's size varies with the style");
	const sizes = found.map((m) => readModel(m).byId.extra?.rendered.size).sort();
	assert.deepEqual(sizes, ["20px", "44px"]);
});

test("the style rules add nothing clingo wants to remark on", async () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [style("h", [{ parts: { size: ref("radius") } }])],
	};
	scene = wear(scene, ["t1"], "h");
	const withStyles = await explore(scene, directSolver, { limit: 4 });
	assert.equal(withStyles.diagnostics, "", "a document with styles is clean");

	// And so is one without, even though the rules are emitted regardless.
	const without = await explore(page(1), directSolver, { limit: 4 });
	assert.equal(without.diagnostics, "");
});

/* ------------------------------------------------------------------ */
/* The tables                                                          */
/* ------------------------------------------------------------------ */

test("which properties a style may decide is read off PROPS", () => {
	assert.ok(!STYLE_PROPS.includes("text"), "content is not a treatment");
	assert.ok(!STYLE_PROPS.includes("opacity"), "nor is a state");
	for (const prop of ["size", "weight", "lineHeight", "fontFamily", "align", "ink"]) {
		assert.ok(STYLE_PROPS.includes(prop as never), `${prop} is styleable`);
	}
	// Generic over the property set, not a typographic feature: a surface style
	// is the same mechanism and needs no retrofit.
	for (const prop of ["fill", "radius", "stroke", "strokeWidth", "shadow"]) {
		assert.ok(STYLE_PROPS.includes(prop as never), `${prop} too`);
	}
	assert.deepEqual(
		STYLE_PROPS.filter((p) => !PROPS[p].styleable),
		[],
		"the list is the table, not a copy of it",
	);
});

test("a surface style works, unchanged", async () => {
	let scene = page(0);
	scene = {
		...scene,
		nodes: [
			{
				...scene.nodes[0],
				children: [
					makeNode("rect", { x: 10, y: 10, width: 60, height: 40 }, { id: "a" }),
					makeNode("rect", { x: 90, y: 10, width: 60, height: 40 }, { id: "b" }),
				],
			},
		],
		styles: [
			style("chip", [
				{ name: "Flat", parts: { fill: lit("#e2e8f0"), radius: lit("4px") } },
				{ name: "Raised", parts: { fill: lit("#ffffff"), radius: lit("14px") } },
			]),
		],
	};
	// A rect is born holding its kind's defaults for both of these, and a node's
	// own value wins. Handing the pair over to the style is what wearing one
	// means, and it is an explicit act.
	for (const prop of ["fill", "radius"] as const) {
		scene = setProp(scene, ["a", "b"], prop, undefined);
	}
	scene = wear(scene, ["a", "b"], "chip");

	const found = await designs(scene, ["fill", "radius"]);
	assert.equal(found.length, 2, "two treatments, not four combinations");
	for (const design of found) {
		const radii = new Set(
			design.split(" ").filter((p) => p.includes(".radius=")).map((p) => p.split("=")[1]),
		);
		assert.equal(radii.size, 1);
	}
});

test("styleProps is the union across variants, in table order", () => {
	const s = style("h", [
		{ parts: { weight: lit("700") } },
		{ parts: { size: lit("32px") } },
	]);
	assert.deepEqual(styleProps(s), ["size", "weight"]);
	assert.equal(variantLabel(s, 0), "Variant 1");
	assert.equal(variantLabel({ ...s, variants: [{ name: "Big", parts: {} }] }, 0), "Big");
});

/* ------------------------------------------------------------------ */
/* Edits                                                              */
/* ------------------------------------------------------------------ */

test("defining a style, wearing it, and editing a variant", () => {
	const made = addStyle(page(1));
	let scene = made.scene;
	assert.equal(scene.styles.length, 1);
	assert.deepEqual(scene.styles[0].variants, [{ parts: {} }], "one empty variant");

	scene = renameStyle(scene, made.id, "Heading");
	assert.equal(scene.styles[0].name, "Heading");

	scene = setStylePart(scene, made.id, 0, "size", lit("32px"));
	scene = setStylePart(scene, made.id, 0, "weight", lit("700"));
	assert.deepEqual(scene.styles[0].variants[0].parts, {
		size: lit("32px"),
		weight: lit("700"),
	});

	// Content is not a treatment, and the edit says so rather than trusting a
	// caller to have read the table.
	const refused = setStylePart(scene, made.id, 0, "text", lit("nope"));
	assert.equal(refused, scene, "an unstyleable property is refused");

	scene = setStylePart(scene, made.id, 0, "weight", undefined);
	assert.deepEqual(scene.styles[0].variants[0].parts, { size: lit("32px") });

	scene = setStyle(scene, ["t1"], made.id);
	assert.equal(findInTree(scene.nodes, "t1")?.style, made.id);
	scene = setStyle(scene, ["t1"], undefined);
	assert.equal(findInTree(scene.nodes, "t1")?.style, undefined);
	assert.ok(!("style" in (findInTree(scene.nodes, "t1") as object)));

	// Wearing a style the document does not hold is not an edit at all.
	assert.equal(setStyle(scene, ["t1"], "nope"), scene);
});

test("a second variant starts as a copy of the first", () => {
	let scene = addStyle(page(1), {
		variants: [{ parts: { size: lit("16px"), weight: lit("400") } }],
	}).scene;
	const id = scene.styles[0].id;
	scene = addStyleVariant(scene, id);
	assert.deepEqual(scene.styles[0].variants[1].parts, {
		size: lit("16px"),
		weight: lit("400"),
	});
	scene = setStylePart(scene, id, 1, "size", lit("32px"));
	scene = setStylePart(scene, id, 1, "weight", lit("700"));
	scene = renameStyleVariant(scene, id, 1, "Display");
	assert.equal(scene.styles[0].variants[1].name, "Display");
	assert.deepEqual(scene.styles[0].variants[0].parts, {
		size: lit("16px"),
		weight: lit("400"),
	}, "the first is untouched");
});

test("the last variant cannot be deleted", () => {
	let scene = addStyle(page(1)).scene;
	const id = scene.styles[0].id;
	scene = addStyleVariant(scene, id);
	assert.equal(scene.styles[0].variants.length, 2);
	scene = deleteStyleVariant(scene, id, 1);
	assert.equal(scene.styles[0].variants.length, 1);
	assert.equal(deleteStyleVariant(scene, id, 0), scene, "the last one stays");
});

test("deleting a style bakes it into its wearers", () => {
	let scene = page(2);
	scene = {
		...scene,
		tokens: [{ id: "brand", name: "brand", type: "color", value: single("#3b82f6") }],
		styles: [
			style("h", [
				{ parts: { size: lit("16px"), ink: ref("brand") } },
				{ parts: { size: lit("48px"), ink: lit("#000000") } },
			]),
		],
	};
	scene = wear(scene, ["t1", "t2"], "h");
	scene = setProp(scene, ["t2"], "size", single("11px"));

	const first = deleteStyle(scene, "h");
	assert.equal(first.styles.length, 0);
	const t1 = findInTree(first.nodes, "t1") as SceneNode;
	assert.equal(t1.style, undefined);
	assert.deepEqual(t1.props.size, [lit("16px")], "the first variant is what was showing");
	assert.deepEqual(
		t1.props.ink,
		[ref("brand")],
		"a link is baked as the link — the token is not going anywhere",
	);
	const t2 = findInTree(first.nodes, "t2") as SceneNode;
	assert.deepEqual(t2.props.size, single("11px"), "its own value is untouched");
	assert.deepEqual(t2.props.ink, [ref("brand")]);

	// With a universe in hand, the variant on screen is the one that survives.
	const second = deleteStyle(scene, "h", { [styleVar("h")]: 1 });
	assert.deepEqual(
		(findInTree(second.nodes, "t1") as SceneNode).props.size,
		[lit("48px")],
	);
});

test("collapsing to a universe shortens a style's variants", () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("h", [
				{ parts: { size: lit("16px") } },
				{ parts: { size: lit("48px") } },
			]),
		],
	};
	scene = wear(scene, ["t1"], "h");
	const kept = collapseToPicks(scene, { [styleVar("h")]: 1 });
	assert.deepEqual(kept.styles[0].variants, [{ parts: { size: lit("48px") } }]);
	// No pick, no rewrite — the same rule every other assignment follows.
	assert.equal(collapseToPicks(scene, {}).styles[0].variants.length, 2);
});

test("baking a deleted style leaves the design it was showing", async () => {
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("h", [{ parts: { size: lit("16px"), weight: lit("400") } }]),
		],
	};
	scene = wear(scene, ["t1"], "h");
	const before = await designs(scene, ["size", "weight"]);
	const after = await designs(deleteStyle(scene, "h"), ["size", "weight"]);
	assert.deepEqual(after, before, "the picture does not move");
});

/* ------------------------------------------------------------------ */
/* Documents from before styles existed                                */
/* ------------------------------------------------------------------ */

test("a document saved before styles existed reads as having none", () => {
	const old = {
		tokens: [{ id: "a", name: "a", type: "color", value: [lit("#fff")] }],
		nodes: [
			{
				id: "n1",
				kind: "rect",
				name: "R",
				frame: { x: 0, y: 0, width: 10, height: 10 },
				props: {},
			},
		],
		constraints: [],
		rules: "",
	};
	assert.deepEqual(normalizeScene(old).styles, []);
});

test("a stored style is normalised rather than trusted", () => {
	const stored = {
		...emptyScene(),
		styles: [
			// Good, if untidy: a part naming a property no style may decide, and
			// one that is not a term at all.
			{
				id: "h",
				name: "Heading",
				variants: [
					{
						name: "Big",
						parts: { size: lit("32px"), text: lit("nope"), weight: "700" },
					},
					{},
				],
			},
			// No variants: a variable with no alternatives, so it goes.
			{ id: "empty", name: "Empty", variants: [] },
			// Not a style at all.
			{ id: 7, name: "Bad", variants: [{ parts: {} }] },
		],
		nodes: [
			{
				...makeNode("text", { x: 0, y: 0, width: 10, height: 10 }, { id: "t1" }),
				style: 42,
			},
		],
	};
	const scene = normalizeScene(stored);
	assert.equal(scene.styles.length, 1);
	assert.equal(scene.styles[0].id, "h");
	assert.deepEqual(scene.styles[0].variants, [
		{ name: "Big", parts: { size: lit("32px") } },
		{ parts: {} },
	]);
	assert.equal(
		findInTree(scene.nodes, "t1")?.style,
		undefined,
		"a style reference that is not a string is dropped",
	);
});

/* ------------------------------------------------------------------ */
/* Program shape                                                       */
/* ------------------------------------------------------------------ */

test("a style compiles to facts and never changes the shape of the program", () => {
	const plain = compile(page(1)).generated;
	let scene = page(1);
	scene = {
		...scene,
		styles: [
			style("h", [
				{ parts: { size: lit("16px") } },
				{ parts: { size: ref("radius") } },
			]),
		],
	};
	scene = wear(scene, ["t1"], "h");
	const styled = compile(scene).generated;

	// The rules are identical; only the facts differ.
	const rulesOf = (program: string) =>
		program.split("\n").filter((line) => line.includes(":-"));
	assert.deepEqual(rulesOf(styled), rulesOf(plain));

	assert.ok(styled.includes("alt(sty(h),0)."), "the variants are alternatives");
	assert.ok(styled.includes("sty_wears(t1,h,size)."), "and the wearer is a fact");
	assert.ok(
		styled.includes(`alt(${stylePartVar("h", 1, "size")},0).`),
		"a linked part becomes a variable",
	);
	assert.ok(
		!styled.includes(`alt(${stylePartVar("h", 0, "size")},0).`),
		"a literal part stays a fact",
	);
	// A variable with one alternative is not shown as a choice.
	assert.equal(variableCounts(scene)[stylePartVar("h", 1, "size")], undefined);
	assert.equal(variableCounts(scene)[styleVar("h")], 2);
});

test("a part is one term, so a style never branches twice", () => {
	// Typed, not asserted: the shape is the argument. A `Value` here would
	// reintroduce the cross product the style exists to collapse.
	const parts: Partial<Record<"size", Term>> = { size: lit("32px") };
	assert.equal(parts.size?.kind, "literal");
});
