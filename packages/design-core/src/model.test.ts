/**
 * The scene reader, against the real solver.
 *
 * Everything here goes through clingo rather than through hand-written atom
 * lists, because the point of the reader is that the answer set and the
 * document agree — an assertion made against atoms this file wrote itself
 * would only be checking the reader against my idea of the program.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { PULL_ATOM, SCENERY_ATOM, compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { statePart } from "./machines.ts";
import { readModel, type ModelNode } from "./model.ts";
import { makeNode } from "./edits.ts";
import {
	type Constraint,
	type Machine,
	type Scene,
	type SceneNode,
	type StatePart,
	type Transition,
	dimension,
	frameOf,
	makeLayout,
} from "./scene.ts";
import { card } from "./templates/card.ts";
import { palette } from "./templates/palette.ts";
import { flatten } from "./tree.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, ref, single } from "./values.ts";

/** A frame is EMU; the layout case below is stated in pixels. */
const px = (n: number): number => n * EMU_PER_PX;

/**
 * One answer set for a scene, as atoms.
 *
 * `scenery` is a parameter rather than always true because the reader's answer
 * to "there is no picture here" is part of what it promises: the picture is
 * behind an assumption, a solve is allowed to skip it, and what comes back then
 * has to read as an empty document rather than as an error. See scenery.test.ts,
 * which is where the gate itself is tested.
 */
async function firstModel(scene: Scene, scenery = true): Promise<string[]> {
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	try {
		const out = await session.solve({
			models: 1,
			assumptions: [
				...[...guards, PULL_ATOM].map((atom) => ({ atom })),
				{ atom: SCENERY_ATOM, sign: scenery },
			],
		});
		assert.equal(out.result, "SATISFIABLE");
		const model = out.models[0];
		assert.ok(model, "expected a model");
		return model;
	} finally {
		await session.close();
	}
}

/** Depth-first over the read scene, parents before children. */
function walk(nodes: readonly ModelNode[]): ModelNode[] {
	return nodes.flatMap((n) => [n, ...walk(n.children)]);
}

test("reads the whole tree back out of an answer set", async () => {
	const scene = card();
	const model = readModel(await firstModel(scene));

	// Same nodes, same order, same nesting as the document it came from.
	assert.deepEqual(
		walk(model.roots).map((n) => n.id),
		flatten(scene.nodes).map((n) => n.id),
	);
	assert.deepEqual(
		model.roots.map((n) => n.id),
		scene.nodes.map((n) => n.id),
	);
	for (const node of flatten(scene.nodes)) {
		const read = model.byId[node.id];
		assert.ok(read, `${node.id} missing`);
		assert.equal(read.kind, node.kind);
		assert.deepEqual(read.frame, frameOf(node));
		assert.deepEqual(
			read.children.map((c) => c.id),
			(node.children ?? []).map((c) => c.id),
		);
	}
});

test("paint order survives, even when the ids sort the other way", async () => {
	// `child/2` is a set; without `order/2` the only reading left would be
	// alphabetical, which is the opposite of this document's stacking.
	const rect = (id: string, x: number): SceneNode => ({
		...makeNode("rect", { x, y: 0, width: 40, height: 40 }, { id, name: id }),
		props: { fill: single("#000000") },
	});
	const scene: Scene = {
		styles: [],
		machines: [],
		tokens: [],
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: 200, height: 80 }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: single("#ffffff") },
				children: [rect("zed", 0), rect("mid", 20), rect("alpha", 40)],
			},
		],
		constraints: [],
		rules: "",
	};

	const model = readModel(await firstModel(scene));
	assert.deepEqual(
		model.byId.page?.children.map((c) => c.id),
		["zed", "mid", "alpha"],
	);
	assert.deepEqual(
		model.byId.page?.children.map((c) => c.order),
		[1, 2, 3],
	);
});

test("what a node renders with is the resolved text, not a literal id", async () => {
	const scene = card();
	const model = readModel(await firstModel(scene));

	const badge = model.byId.badge;
	assert.ok(badge);
	// `accent` holds five colours; whichever this universe picked, it is a
	// colour rather than an `l7`.
	const accents = ["#3b82f6", "#10b981", "#f59e0b", "#f43f5e", "#8b5cf6"];
	assert.ok(accents.includes(badge.rendered.fill ?? ""));
	assert.ok(["0px", "8px", "18px"].includes(badge.rendered.radius ?? ""));
	assert.equal(model.byId.title?.rendered.text, "Aurora");
	// A property the node does not hold stays absent rather than defaulting.
	assert.equal(badge.rendered.stroke, undefined);
});

test("a derived value reads back as what it was computed to be", async () => {
	// palette's labels take their ink from the button under them, so the two
	// have to agree in whichever universe came back.
	const model = readModel(await firstModel(palette()));
	for (const id of ["one", "two", "three"]) {
		const fill = model.byId[id]?.rendered.fill;
		const ink = model.byId[`${id}Label`]?.rendered.ink;
		assert.ok(fill && ink);
		assert.notEqual(fill, ink);
		// The pale swatch is the one that has to flip; every other reads white.
		assert.equal(ink, fill === "#fde047" ? "#0f172a" : "#ffffff");
	}
});

test("text with a comma in it survives the round trip", async () => {
	// The atom `literal(l0,"Fast, quiet")` has a comma that is not an argument
	// separator, which is the whole reason `parseAtom` knows about quotes.
	const scene: Scene = {
		styles: [],
		machines: [],
		tokens: [],
		nodes: [
			{
				...makeNode("text", { x: 0, y: 0, width: 200, height: 24 }, {
					id: "t",
					name: "t",
				}),
				props: { text: single('Fast, quiet — and "quoted"') },
			},
		],
		constraints: [],
		rules: "",
	};
	const model = readModel(await firstModel(scene));
	assert.equal(model.byId.t?.rendered.text, 'Fast, quiet — and "quoted"');
});

test("a hidden node takes its subtree with it", async () => {
	const scene = card();
	const model = readModel(await firstModel({ ...scene, rules: "hidden(card)." }));

	assert.deepEqual(model.roots.map((n) => n.id), ["page"]);
	assert.deepEqual(model.byId.page?.children ?? [], []);
	// Not merely detached: the children of a hidden node are not drawn either.
	assert.equal(model.byId.badge, undefined);
	assert.equal(model.byId.title, undefined);
});

test("solved geometry wins over the stored frame", async () => {
	// A row of three, so the solver rather than the document decides where the
	// children sit and how big the container is.
	const child = (id: string): SceneNode => ({
		...makeNode("rect", { x: 0, y: 0, width: px(40), height: px(20) }, {
			id,
			name: id,
		}),
		props: { fill: single("#000000") },
	});
	const scene: Scene = {
		styles: [],
		machines: [],
		tokens: [],
		nodes: [
			{
				...makeNode("frame", { x: px(10), y: px(10), width: px(999), height: px(999) }, {
					id: "row",
					name: "Row",
				}),
				props: { fill: single("#ffffff") },
				layout: makeLayout({ direction: "row", gap: 10, padding: 5 }),
				children: [child("a"), child("b"), child("c")],
			},
		],
		constraints: [],
		rules: "",
	};

	const model = readModel(await firstModel(scene));
	assert.deepEqual(
		model.byId.a?.frame,
		{ x: px(5), y: px(5), width: px(40), height: px(20) },
	);
	assert.deepEqual(
		model.byId.b?.frame,
		{ x: px(55), y: px(5), width: px(40), height: px(20) },
	);
	assert.deepEqual(
		model.byId.c?.frame,
		{ x: px(105), y: px(5), width: px(40), height: px(20) },
	);
	// The container hugs, so its stored 999x999 is not what it is.
	assert.deepEqual(
		model.byId.row?.frame,
		{ x: px(10), y: px(10), width: px(150), height: px(30) },
	);
});

test("a scene predicate a rule asserts is read like any other", async () => {
	// The reason for showing the scene at all: the answer set, not the
	// document, is what the picture is.
	const scene = card();
	const model = readModel(
		await firstModel({ ...scene, rules: "frame(badge,width,300)." }),
	);
	// Two frame/3 atoms for one axis: the reader takes one, and both are legal
	// readings — what matters is that the rule's fact reached it at all.
	assert.ok([64, 300].includes(model.byId.badge?.frame.width ?? 0));
});

test("a scene with alternatives reads differently in different universes", async () => {
	const scene: Scene = {
		styles: [],
		machines: [],
		tokens: [
			{ id: "accent", name: "accent", type: "color", value: [lit("#111111"), lit("#222222")] },
		],
		nodes: [
			{
				...makeNode("rect", { x: 0, y: 0, width: 10, height: 10 }, {
					id: "r",
					name: "r",
				}),
				props: { fill: [ref("accent")] },
			},
		],
		constraints: [],
		rules: "",
	};
	const { program, guards } = compile(scene);
	const session = await directSolver.open(program, "--project");
	const out = await session.solve({
		models: 0,
		assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
	});
	await session.close();

	const fills = out.models
		.map((m) => readModel(m).byId.r?.rendered.fill)
		.sort();
	assert.deepEqual(fills, ["#111111", "#222222"]);
});

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

/**
 * A component with a machine on it, and however many uses of it.
 *
 * Three levels — `btn > label` beside `btn > panel > inner` — because the
 * copies are rationed and a shape with only leaves could not show it. `inner` is
 * under a part a state hides and is touched by no state at all, so nothing ever
 * mints a copy of it: the analysis closes upward and downward is free, since a
 * state that moves a container moves what is in it for nothing.
 *
 * Written in EMU at the document end, in pixels here, the same seam the rest of
 * this file names.
 */
const REST_INK = "#ffffff";
const HOT_INK = "#f43f5e";

const state = (id: string, parts: Record<string, StatePart> = {}) => ({
	id,
	name: id,
	parts,
});

/** A transition with the settings that make one legal without saying anything. */
const edge = (
	spec: Partial<Transition> & { id: string; from: string; to: string },
): Transition => ({ trigger: "pointerenter", enabled: true, ...spec });

/**
 * Four states, one per thing a state can do: nothing, recolour, move, hide.
 *
 * `rest` is deliberately empty. A machine's first state is its initial one and
 * the definition on the canvas *is* that state, so the common document says
 * nothing in it and every other state is written as the difference from it.
 */
const FOUR = [
	state("rest"),
	state("hot", { label: { props: { ink: single(HOT_INK) } } }),
	state("low", { label: { frame: { y: dimension(px(34)) } } }),
	state("gone", { panel: { hidden: true } }),
];

function stateful(
	spec: {
		uses?: Array<{ id: string; state?: string }>;
		states?: Array<{ id: string; name: string; parts: Record<string, StatePart> }>;
		transitions?: Transition[];
		constraints?: Constraint[];
	} = {},
): Scene {
	const machine: Machine = {
		id: "m1",
		name: "Button states",
		root: "btn",
		states: spec.states ?? FOUR,
		transitions: spec.transitions ?? [],
	};
	const label: SceneNode = {
		...makeNode("text", { x: px(12), y: px(14), width: px(136), height: px(20) }, {
			id: "label",
			name: "Label",
		}),
		props: { text: single("Go"), ink: single(REST_INK), size: single("14px") },
	};
	const inner: SceneNode = {
		...makeNode("rect", { x: px(4), y: px(4), width: px(40), height: px(12) }, {
			id: "inner",
			name: "Inner",
		}),
		props: { fill: single("#22c55e") },
	};
	const panel: SceneNode = {
		...makeNode("frame", { x: px(12), y: px(40), width: px(136), height: px(60) }, {
			id: "panel",
			name: "Panel",
		}),
		props: { fill: single("#0f172a") },
		children: [inner],
	};
	const definition: SceneNode = {
		...makeNode("frame", { x: px(20), y: px(20), width: px(160), height: px(48) }, {
			id: "btn",
			name: "Button",
		}),
		props: { fill: single("#3b82f6"), radius: single("8px") },
		children: [label, panel],
		component: true,
	};
	return {
		styles: [],
		machines: [machine],
		tokens: [],
		constraints: spec.constraints ?? [],
		rules: "",
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(600), height: px(400) }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: single("#ffffff") },
				children: [
					definition,
					...(spec.uses ?? [{ id: "b1" }]).map((use, i) => ({
						...makeNode(
							"instance",
							{ x: px(300), y: px(20 + i * 120), width: px(160), height: px(48) },
							{ id: use.id, name: use.id },
						),
						instanceOf: "btn",
						...(use.state ? { state: use.state } : {}),
					})),
				],
			},
		],
	};
}

/** Every copy of one instance, as the terms they are keyed by. */
const copiesOf = (instance: string, states: string[], parts: string[]): string[] =>
	states.flatMap((s) => parts.map((n) => statePart(instance, s, n))).sort();

test("every state is in the answer set, not only the one on the canvas", async () => {
	// The whole reason the states are read back at all: one solve holds the
	// picture *and* every picture the same instance could be showing, so the
	// exporter and the canvas can have all of them without asking again.
	const model = readModel(await firstModel(stateful()));

	// Keyed by the whole `stt(I,S,N)` term, and holding exactly the copies the
	// program minted: four states over the three parts the analysis materialised
	// — `label` and `panel` because a state touches them, `btn` because it is
	// their ancestor and the world chain climbs. `inner` is touched by nothing
	// and is under a part a state hides, so it has no copy at all; the rationing
	// is the compiler's, and this records what reaches a reader.
	assert.deepEqual(
		Object.keys(model.states).sort(),
		copiesOf("b1", ["gone", "hot", "low", "rest"], ["btn", "label", "panel"]),
	);
	assert.equal(model.states[statePart("b1", "hot", "inner")], undefined);

	const hot = model.states[statePart("b1", "hot", "label")];
	assert.ok(hot);
	assert.equal(hot.instance, "b1");
	assert.equal(hot.state, "hot");
	assert.equal(hot.part, "label");

	// And the shown copy is the picture: the alias rules make `inst(b1,label)` a
	// view of whichever state is shown, so reading the node and reading its copy
	// have to give the same answer or one of the two is lying.
	const rest = model.states[statePart("b1", "rest", "label")];
	const drawn = model.byId["inst(b1,label)"];
	assert.ok(rest && drawn);
	assert.equal(model.shown.b1, "rest");
	assert.deepEqual(drawn.frame, rest.frame);
	assert.deepEqual(drawn.rendered, rest.rendered);
});

test("a state copy is not a node, and is nowhere a node would be", async () => {
	// `stt/3` is deliberately not a `node/1`. If a copy ever turned up in `byId`
	// the canvas would paint four buttons on top of each other, the layer list
	// would grow by the state count, and hit-testing would have a case to learn.
	const model = readModel(await firstModel(stateful()));

	for (const id of Object.keys(model.byId)) {
		assert.ok(!id.startsWith("stt("), `${id} is a state copy in byId`);
	}
	assert.deepEqual(
		walk(model.roots).filter((n) => n.id.startsWith("stt(")),
		[],
	);
	// The copies hang off the instance in `child/2` — only so that a geometric
	// constraint naming one gets a world chain — and that parenting reaches no
	// node's children either.
	for (const node of Object.values(model.byId)) {
		assert.ok(!node.children.some((c) => c.id.startsWith("stt(")));
	}
	assert.ok(Object.keys(model.states).length > 0, "there were copies to find");
});

test("a state that only recolours changes one property and shares the rest", async () => {
	// The invariant, read from the other end. A property no state touches is one
	// variable that every copy reads, so `text` and `size` are not four values
	// that happen to agree — they are one value, and this is what that looks
	// like from the answer set.
	const model = readModel(await firstModel(stateful()));
	const rest = model.states[statePart("b1", "rest", "label")];
	const hot = model.states[statePart("b1", "hot", "label")];
	assert.ok(rest && hot);

	assert.equal(rest.rendered.ink, REST_INK);
	assert.equal(hot.rendered.ink, HOT_INK);
	assert.equal(hot.rendered.text, "Go");
	assert.equal(hot.rendered.size, "14px");
	assert.deepEqual(
		{ ...hot.rendered, ink: rest.rendered.ink },
		rest.rendered,
		"ink is the only difference between the two",
	);
	// And a state that says nothing about geometry leaves it where the
	// definition put it, per dimension rather than per part.
	assert.deepEqual(hot.frame, rest.frame);
	assert.equal(rest.frame.y, px(14));
});

test("a state that moves a part moves only that part, in that state", async () => {
	const model = readModel(await firstModel(stateful()));
	const rest = model.states[statePart("b1", "rest", "label")];
	const low = model.states[statePart("b1", "low", "label")];
	assert.ok(rest && low);

	assert.equal(low.frame.y, px(34));
	assert.equal(rest.frame.y, px(14));
	// The dimensions the delta is silent about are the definition's, and the
	// other parts are untouched in every state.
	assert.equal(low.frame.x, rest.frame.x);
	assert.equal(low.frame.width, rest.frame.width);
	assert.deepEqual(
		model.states[statePart("b1", "low", "panel")]?.frame,
		model.states[statePart("b1", "rest", "panel")]?.frame,
	);
});

test("a state that hides a part says so per copy, and the other states still draw it", async () => {
	// Drawn in `gone`, so the panel really is out of the picture — and the copy
	// that has it is still there to be read, which is exactly what lets the
	// export write one rule for the state and the canvas swap back with no solve.
	const model = readModel(await firstModel(stateful({ uses: [{ id: "b1", state: "gone" }] })));

	assert.equal(model.shown.b1, "gone");
	assert.equal(model.states[statePart("b1", "gone", "panel")]?.hidden, true);
	assert.equal(model.states[statePart("b1", "rest", "panel")]?.hidden, false);
	assert.equal(model.states[statePart("b1", "gone", "label")]?.hidden, false);

	// Out of the picture takes its subtree with it, exactly as `hidden/1` does
	// for a node — because that is what it is: the alias states `hidden(inst(I,N))`
	// for the shown state and nothing downstream learns that states exist.
	assert.equal(model.byId["inst(b1,panel)"], undefined);
	assert.equal(model.byId["inst(b1,inner)"], undefined);
	assert.ok(model.byId["inst(b1,label)"], "the rest of the button is drawn");
	// The hidden copy is still a copy, with the geometry and the fill it would
	// have had. `hidden` is per copy and deliberately not closed downward: both
	// readers close it in their own medium, and "this state hides this part" is
	// what a panel has to be able to say.
	const gone = model.states[statePart("b1", "gone", "panel")];
	assert.equal(gone?.frame.y, px(40));
	assert.equal(gone?.rendered.fill, "#0f172a");
});

test("two instances are read in two states at once", async () => {
	const model = readModel(
		await firstModel(stateful({ uses: [{ id: "b1" }, { id: "b2", state: "hot" }] })),
	);
	assert.deepEqual(model.shown, { b1: "rest", b2: "hot" });
	assert.equal(model.byId["inst(b1,label)"]?.rendered.ink, REST_INK);
	assert.equal(model.byId["inst(b2,label)"]?.rendered.ink, HOT_INK);
	// Both instances hold all four states, because a copy is per instance: two
	// uses of one button may be drawn in two states, and a rule may be about one
	// of them.
	assert.equal(Object.keys(model.states).length, 2 * 4 * 3);
	assert.equal(model.states[statePart("b2", "rest", "label")]?.rendered.ink, REST_INK);
});

test("solved geometry lands in a state copy's frame, by the same lines as a node's", async () => {
	// A geometric constraint may name a state copy — that is the point of `stt/3`
	// not being a `node/1` — and naming one hands it to simplex. So a copy's
	// frame is `__lpx(lv(stt(...),y),…)` where there is one and the stored delta
	// only where there is not, which is the precedence `ModelNode.frame` already
	// has.
	const scene = stateful({
		constraints: [
			{
				id: "no_jump",
				kind: "align",
				prop: "fill",
				nodes: [statePart("b1", "rest", "label"), statePart("b1", "low", "label")],
				edge: "centerY",
				enabled: true,
			},
		],
	});
	const model = readModel(await firstModel(scene));
	const rest = model.states[statePart("b1", "rest", "label")];
	const low = model.states[statePart("b1", "low", "label")];
	assert.ok(rest && low);

	// Equal heights, so equal centres is equal offsets. *Where* the pair lands is
	// deliberately not asserted: the pull toward 14 and toward 34 pays the same
	// everywhere between them, so simplex returns a vertex rather than a
	// midpoint. What the rule promises is that the label does not jump.
	assert.equal(rest.frame.y, low.frame.y);
	assert.ok(rest.frame.y >= px(14) && rest.frame.y <= px(34));
	// And at least one of the two is not where the document stored it, which is
	// the half that proves the solved value won.
	assert.ok(rest.frame.y !== px(14) || low.frame.y !== px(34));
	// A copy nothing placed keeps the stored frame, so this is a fold and not a
	// blanket.
	assert.equal(model.states[statePart("b1", "rest", "panel")]?.frame.y, px(40));
});

test("what is wrong with a machine, and how long its moves take, read back per machine", async () => {
	// The health lists are the program's answers rather than `machineHealth`'s,
	// and they are worth reading precisely because they are the ones a rule can
	// forbid by name. The motion tables are the other kind of answer: a duration
	// is a value, so how long a transition runs is something this universe
	// decided and the exporter has to ask.
	const scene = stateful({
		transitions: [
			edge({ id: "over", from: "rest", to: "hot", duration: single("120ms") }),
			edge({ id: "back", from: "hot", to: "rest", trigger: "pointerleave" }),
			edge({ id: "down", from: "rest", to: "low", trigger: "pointerdown" }),
			// A second edge out of `rest` on the same trigger: two answers to one
			// question, which is a machine that does not know what it does.
			edge({ id: "alsodown", from: "rest", to: "hot", trigger: "pointerdown" }),
			// And one naming a state the machine has not got, which is kept rather
			// than repaired so that there is something to report.
			edge({ id: "oops", from: "rest", to: "nowhere", trigger: "click" }),
		],
	});
	const model = readModel(await firstModel(scene));
	const machine = model.machines.m1;
	assert.ok(machine);

	// `gone` is in the document and nothing goes to it; `gone` and `low` are
	// where the machine stops.
	assert.deepEqual(machine.unreachable, ["gone"]);
	assert.deepEqual(machine.deadEnds, ["gone", "low"]);
	assert.deepEqual(machine.nondeterministic, [["rest", "pointerdown"]]);
	assert.deepEqual(machine.dangling, ["oops"]);
	// Every enabled transition is paced, whether or not it says so: the ones that
	// name nothing take the table's own fallback through `mdefdur`.
	assert.deepEqual(machine.duration, {
		over: 120,
		back: 200,
		down: 200,
		alsodown: 200,
		oops: 200,
	});
	assert.deepEqual(machine.delay, { over: 0, back: 0, down: 0, alsodown: 0, oops: 0 });
	assert.deepEqual(machine.stagger, { over: 0, back: 0, down: 0, alsodown: 0, oops: 0 });
	// A machine the answer set says nothing about is absent, not empty.
	assert.equal(model.machines.m2, undefined);
});

test("a document with no machine reads back with nothing to say about states", async () => {
	// The state material is additive: a document that has never heard of a
	// machine reads exactly as it did before the feature, and the three new maps
	// are empty rather than absent.
	const model = readModel(await firstModel(card()));
	assert.deepEqual(model.states, {});
	assert.deepEqual(model.shown, {});
	assert.deepEqual(model.machines, {});
	assert.ok(model.roots.length > 0, "the picture is still there");
});

test("an answer set asked for without the picture reads as no states at all", async () => {
	// Every one of these predicates is behind `scenery`, so a solve that only
	// wanted the decisions has none of them — and that is a question nobody
	// asked rather than a machine that went missing. Same reading the picture
	// itself already gets.
	const model = readModel(await firstModel(stateful(), false));
	assert.deepEqual(model.roots, []);
	assert.deepEqual(model.states, {});
	assert.deepEqual(model.shown, {});
	assert.deepEqual(model.machines, {});
});
