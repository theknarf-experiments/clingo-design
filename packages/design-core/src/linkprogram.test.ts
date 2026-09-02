/**
 * Links, against the real solver.
 *
 * Every claim this feature makes is a claim about the *program* — that a link is
 * a fact and never a choice, that a definition's link follows to every instance
 * of it, that `goes/1` is behind `visible/1` and therefore per universe — so
 * everything here goes through clingo rather than through a hand-written atom
 * list.
 *
 * The load-bearing one is first, and it is the repository's standing invariant
 * arriving at a new field: **adding a link must not add universes.** A link is
 * not a `Value`, so it mints no `alt/2` and no `pick/2` — and `#project goes/1.`
 * is a *finer* partition, which can only ever split. That it splits nothing on a
 * document whose links are fields is a fact to check rather than believe, which
 * is what the first test is.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAtom } from "./atoms.ts";
import { CONTRACT, PULL_ATOM, SCENERY_ATOM, compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { addCustomConstraint, makeNode, setLink } from "./edits.ts";
import { explore } from "./explore.ts";
import { readModel } from "./model.ts";
import { pageIdOf, pagePath } from "./pages.ts";
import { type Machine, type Scene, type SceneNode, emptyScene } from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, ref } from "./values.ts";

const px = (n: number): number => n * EMU_PER_PX;

const HOME = pagePath("Home");
const ABOUT = pagePath("About");
const CHECKOUT = pagePath("Checkout");

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/**
 * A page with one token holding two colours, so the space has a known size that
 * every universe assertion below is measured against.
 *
 * Two, deliberately: a document with one universe cannot tell "the link added
 * none" from "the projection collapsed them all".
 */
function base(): Scene {
	return {
		...emptyScene(),
		tokens: [
			{ id: "accent", name: "Accent", type: "color", value: [lit("#2563eb"), lit("#db2777")] },
		],
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(400), height: px(300) }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: [lit("#ffffff")] },
				children: [
					{
						...makeNode("rect", { x: px(20), y: px(20), width: px(120), height: px(60) }, {
							id: "card",
							name: "Card",
						}),
						props: { fill: [ref("accent")] },
					},
					makeNode("rect", { x: px(200), y: px(20), width: px(120), height: px(60) }, {
						id: "other",
						name: "Other",
					}),
				],
			},
		],
	};
}

/**
 * A definition with a link inside it, and however many uses of it.
 *
 * `hideDefinition` hides the linked part *itself* rather than the definition
 * root, and that is not a shortcut: `visible(N) :- node(N), not hidden(N).` is
 * per node and does not close downward — the closure is `readModel`'s `drawn`,
 * on the TypeScript side — so hiding the root would leave `visible(logo)` true
 * and `goes/1` derived from a part nothing draws. Which is the shipped meaning
 * of `visible/1` and is inherited here rather than argued with; a test about
 * what a *state* takes away has to hide the definition's own copy to be about
 * the instance at all.
 */
function withComponent(
	uses: string[],
	extra: Partial<Machine>[] = [],
	hideDefinition = false,
): Scene {
	const logo: SceneNode = {
		...makeNode("rect", { x: px(4), y: px(4), width: px(40), height: px(20) }, {
			id: "logo",
			name: "Logo",
		}),
		link: { to: HOME },
		...(hideDefinition ? { hidden: true as const } : {}),
	};
	const definition: SceneNode = {
		...makeNode("frame", { x: px(10), y: px(10), width: px(200), height: px(30) }, {
			id: "nav",
			name: "Nav",
		}),
		children: [logo],
		component: true,
	};
	return {
		...emptyScene(),
		...(extra.length > 0 ? { machines: extra as Machine[] } : {}),
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(600), height: px(400) }, {
					id: "page",
					name: "Page",
				}),
				children: [
					definition,
					...uses.map((id, i) => ({
						...makeNode(
							"instance",
							{ x: px(20), y: px(60 + i * 60), width: px(200), height: px(30) },
							{ id, name: id },
						),
						instanceOf: "nav",
					})),
				],
			},
		],
	};
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function answers(scene: Scene, flow?: { here?: string; pages?: string[] }): Promise<string[][]> {
	const { program, guards } = compile(scene, flow ? { flow } : {});
	const session = await directSolver.open(program, "--project");
	try {
		const outcome = await session.solve({
			models: 0,
			assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(outcome.result, "SATISFIABLE", "the document has at least one design");
		return outcome.models;
	} finally {
		await session.close();
	}
}

const universes = async (scene: Scene): Promise<number> =>
	(await explore(scene, directSolver, { limit: 64 })).count;

/** Every atom of one name in one answer set, as `name(a,b)` text. */
const named = (model: readonly string[], name: string): string[] =>
	model.filter((text) => parseAtom(text)?.name === name).sort();

/* ------------------------------------------------------------------ */
/* The invariant                                                       */
/* ------------------------------------------------------------------ */

test("adding a link adds no universes", async () => {
	// The whole reason a link is a field rather than a `Value`, asserted the way
	// the repository asserts it everywhere else. Three shapes: one link, two links
	// to two different pages, and a link inside a definition placed twice — which
	// is the one that would catch a copy rule minting a variable per instance.
	const plain = base();
	const n = await universes(plain);
	assert.equal(n, 2, "the token is what makes this two designs");

	const one = setLink(plain, ["card"], { to: ABOUT });
	assert.equal(await universes(one), n, "a link is a fact, not a choice");

	const two = setLink(one, ["other"], { to: CHECKOUT });
	assert.equal(await universes(two), n, "and a second one is a second fact");

	// And the copy rule, which grounds `instance × cpart × link` and could
	// plausibly have multiplied something.
	const before = await universes(withComponent([]));
	assert.equal(await universes(withComponent(["nav1", "nav2"])), before);
});

test("a link mints no alt/2 and no pick/2", async () => {
	// One rung finer than the count, and the reason the count holds: a link never
	// reaches the choice rule at all, so there is nothing for a projection to
	// partition differently. `variables` is the compiler's own list of what the
	// document offered the solver, and a link is not in it.
	const plain = base();
	const linked = setLink(plain, ["card"], { to: ABOUT, on: "pointerenter" });
	assert.deepEqual(
		Object.keys(compile(linked).variables).sort(),
		Object.keys(compile(plain).variables).sort(),
	);
	// And nothing in the answer set picks between pages: every `pick/2` there is
	// belongs to the token, which is the one thing this document put a choice on.
	const model = (await answers(linked))[0];
	assert.equal(
		named(model, "pick").some((text) => text.includes(pageIdOf(ABOUT))),
		false,
		"no pick is minted over a page",
	);
});

/* ------------------------------------------------------------------ */
/* The facts and the derivation                                        */
/* ------------------------------------------------------------------ */

test("a link is two facts and a reachability", async () => {
	const scene = setLink(base(), ["card"], { to: ABOUT });
	const model = (await answers(scene))[0];
	const id = pageIdOf(ABOUT);
	assert.deepEqual(named(model, "link"), [`link(card,${id})`]);
	assert.deepEqual(named(model, "linkon"), ["linkon(card,click)"]);
	assert.deepEqual(named(model, "goes"), [`goes(${id})`]);
});

test("linkon carries the document's trigger, and a link with none reads as click", async () => {
	const hover = setLink(base(), ["card"], { to: ABOUT, on: "pointerenter" });
	assert.deepEqual(named((await answers(hover))[0], "linkon"), [
		"linkon(card,pointerenter)",
	]);
	// `setLink` drops an `on` that is the default, so the common link is one field
	// in the document — and the program still states the fact, out of the one
	// constant both readers share.
	const plain = setLink(base(), ["card"], { to: ABOUT, on: "click" });
	assert.equal(plain.nodes[0].children?.[0].link?.on, undefined);
	assert.deepEqual(named((await answers(plain))[0], "linkon"), ["linkon(card,click)"]);
});

test("a rule that hides the node takes the design's way out with it", async () => {
	// The whole argument for `goes/1` being derived rather than being the fact.
	// The document still links there — a rule may want to reason about the edge —
	// and *this design* does not have it.
	const scene = setLink(base(), ["card"], { to: ABOUT });
	const model = (await answers({ ...scene, rules: "hidden(card)." }))[0];
	assert.deepEqual(named(model, "link"), [`link(card,${pageIdOf(ABOUT)})`]);
	assert.deepEqual(named(model, "goes"), []);
});

test("a link inside a definition follows every instance", async () => {
	// The copy rule, which is the whole payoff of a link being a field: a nav bar
	// is a component rather than a thing pasted onto nine pages, and nothing had to
	// be built for it.
	const model = (await answers(withComponent(["nav1", "nav2"])))[0];
	const id = pageIdOf(HOME);
	assert.deepEqual(named(model, "link"), [
		`link(inst(nav1,logo),${id})`,
		`link(inst(nav2,logo),${id})`,
		`link(logo,${id})`,
	]);
	assert.deepEqual(named(model, "linkon"), [
		"linkon(inst(nav1,logo),click)",
		"linkon(inst(nav2,logo),click)",
		"linkon(logo,click)",
	]);
	// One `goes/1` however many instances lead there: it is a set of pages, not a
	// count of edges.
	assert.deepEqual(named(model, "goes"), [`goes(${id})`]);
});

test("a state that hides the linked part takes goes with it", async () => {
	// `hidden(inst(I,N)) :- mhidden(I,S,N), shown(I,S)` reaching `visible/1`, and
	// through it `goes/1`. The definition still links; the instance drawn in a
	// state that hides the logo does not lead anywhere, and neither does the
	// definition, because a definition is hidden on every page that uses it.
	const machine: Machine = {
		id: "m1",
		name: "Nav",
		root: "nav",
		states: [
			{ id: "full", name: "Full", parts: {} },
			{ id: "bare", name: "Bare", parts: { logo: { hidden: true } } },
		],
		transitions: [
			{ id: "t1", from: "full", to: "bare", trigger: "click", enabled: true },
		],
	};
	const shown: Scene = (() => {
		const scene = withComponent(["nav1"], [machine], true);
		const page = scene.nodes[0];
		const kids = [...(page.children ?? [])];
		kids[1] = { ...kids[1], state: "bare" };
		return { ...scene, nodes: [{ ...page, children: kids }] };
	})();
	const model = (await answers(shown))[0];
	assert.equal(
		named(model, "link").includes(`link(inst(nav1,logo),${pageIdOf(HOME)})`),
		true,
		"the edge is still stated",
	);
	assert.deepEqual(named(model, "goes"), [], "and this design does not have it");
});

test("a dangling link compiles, derives and costs nothing", async () => {
	// A `to` naming a path no page lives at is legal and stays legal, which is what
	// makes deleting a page a deletion rather than an edit to every other page. The
	// id derives from the path, so the program has an edge to a page nothing
	// answers to — which is exactly what `viol(dead_link)` is for.
	const scene = setLink(base(), ["card"], { to: pagePath("Deleted") });
	const model = (await answers(scene))[0];
	assert.deepEqual(named(model, "goes"), [`goes(${pageIdOf(pagePath("Deleted"))})`]);
	assert.equal(await universes(scene), 2);
});

/* ------------------------------------------------------------------ */
/* here/1 and page/1                                                   */
/* ------------------------------------------------------------------ */

test("a compile with no flow states no page and no here", async () => {
	// The whole link story without a project around it: a test — or any caller
	// holding one document — still gets the edges and the reachability, because
	// those are the document's own. Only the project's half is absent.
	const scene = setLink(base(), ["card"], { to: ABOUT });
	const { program } = compile(scene);
	assert.equal(/^page\(/m.test(program), false);
	assert.equal(/^here\(/m.test(program), false);
	const model = (await answers(scene))[0];
	assert.deepEqual(named(model, "link"), [`link(card,${pageIdOf(ABOUT)})`]);
	assert.deepEqual(named(model, "goes"), [`goes(${pageIdOf(ABOUT)})`]);
});

test("the page list reaches the program, sorted and once", async () => {
	const scene = setLink(base(), ["card"], { to: ABOUT });
	const { program } = compile(scene, {
		flow: { here: HOME, pages: [ABOUT, HOME, ABOUT] },
	});
	assert.match(program, new RegExp(`^here\\(${pageIdOf(HOME)}\\)\\.$`, "m"));
	const pages = program.split("\n").filter((line) => line.startsWith("page("));
	assert.deepEqual(pages, [...pages].sort(), "read the same way twice");
	assert.equal(pages.length, 2, "and a repeated path is one page");
});

test("viol(dead_link) fires for a dangling link and not for a live one", async () => {
	// The point of any of this reaching the program: the document may say it, and
	// the document may also be told to complain about saying it, which is the split
	// this tool draws everywhere else between a fact and an opinion about it.
	// Through a `custom` constraint, because `viol/1` is shown behind `active/1`:
	// a rule nobody switched on has no opinion, which is the split between a fact
	// and an opinion about it that this whole mechanism is.
	const rule = "viol(dead_link) :- goes(P), not page(P).";
	//
	// Soft rather than hard, because the question is what the rule *reports*: a
	// prohibition with no design that satisfies it is UNSAT, which is a true
	// answer to a different question. `prefer` is the tier that makes a violation
	// a name on a design rather than the absence of one.
	const named_ = (scene: Scene): Scene => {
		const { scene: withRule, id } = addCustomConstraint(scene, "dead_link");
		return {
			...withRule,
			constraints: withRule.constraints.map((c) =>
				c.id === id ? { ...c, strength: "prefer" as const } : c,
			),
			rules: rule,
		};
	};
	const live = named_(setLink(base(), ["card"], { to: ABOUT }));
	const dead = named_(setLink(base(), ["card"], { to: pagePath("Gone") }));
	const flow = { here: HOME, pages: [HOME, ABOUT] };

	assert.deepEqual(named((await answers(live, flow))[0], "viol"), []);
	assert.deepEqual(named((await answers(dead, flow))[0], "viol"), ["viol(dead_link)"]);
});

test("a document can require a page to be reachable from here", async () => {
	// The sentence this tool can say and no other design tool can: not "is there a
	// link" but "does *this design* lead there", per universe, refusable.
	const rule = `:- here(${pageIdOf(HOME)}), not goes(${pageIdOf(CHECKOUT)}).`;
	const flow = { here: HOME, pages: [HOME, ABOUT, CHECKOUT] };
	// Asserted through the solver directly rather than through `explore`, which
	// takes no flow: the constraint is the claim, and the two programs below differ
	// in exactly one link.
	const without: Scene = { ...setLink(base(), ["card"], { to: ABOUT }), rules: rule };
	const bad = compile(without, { flow });
	const badSession = await directSolver.open(bad.program, "--project");
	try {
		const outcome = await badSession.solve({
			models: 1,
			assumptions: [...bad.guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(outcome.result, "UNSATISFIABLE", "no design gets to checkout");
	} finally {
		await badSession.close();
	}

	const with_: Scene = { ...setLink(without, ["other"], { to: CHECKOUT }), rules: rule };
	const good = compile(with_, { flow });
	const goodSession = await directSolver.open(good.program, "--project");
	try {
		const outcome = await goodSession.solve({
			models: 1,
			assumptions: [...good.guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(outcome.result, "SATISFIABLE", "and once the link is there, it does");
	} finally {
		await goodSession.close();
	}
});

/* ------------------------------------------------------------------ */
/* The model reader                                                    */
/* ------------------------------------------------------------------ */

test("link, linkon and goes reach the model", async () => {
	const scene = setLink(base(), ["card"], { to: ABOUT, on: "pointerenter" });
	const model = readModel((await answers(scene))[0]);
	const id = pageIdOf(ABOUT);
	assert.deepEqual(model.byId.card.link, { to: id, on: "pointerenter" });
	assert.deepEqual(model.links, { card: { to: id, on: "pointerenter" } });
	assert.deepEqual(model.goes, [id]);
	assert.equal(model.byId.other.link, undefined);
});

test("a rule-asserted link with no trigger reads as a click", async () => {
	// Which is the whole reason the default lives on this side of the seam: a rule
	// states `link(other, pg_…)` and says nothing about when, and both readers that
	// draw one — the model and the presenter — supply `click` out of one constant.
	const scene = { ...base(), rules: `link(other,${pageIdOf(CHECKOUT)}).` };
	const model = readModel((await answers(scene))[0]);
	assert.deepEqual(model.byId.other.link, { to: pageIdOf(CHECKOUT), on: "click" });
	assert.deepEqual(model.goes, [pageIdOf(CHECKOUT)]);
});

test("goes is sorted, so one answer set reads the same way twice", async () => {
	const scene = setLink(setLink(base(), ["card"], { to: CHECKOUT }), ["other"], {
		to: ABOUT,
	});
	const model = readModel((await answers(scene))[0]);
	assert.deepEqual(model.goes, [...model.goes].sort());
	assert.equal(model.goes.length, 2);
});

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

test("the contract names every link predicate a rule may write", () => {
	// A rule-writer reads the `%`-block and nothing else. A predicate the program
	// derives and the contract does not mention is a feature nobody can reach.
	for (const line of ["here(P)", "page(P)", "link(N, P)", "linkon(N, Trigger)", "goes(P)"]) {
		assert.equal(CONTRACT.includes(line), true, line);
	}
	assert.equal(CONTRACT.includes("viol(dead_link)"), true);
});
