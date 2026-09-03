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
import { keyCopy, statePart, trackDim, trackProp } from "./machines.ts";
import { boxOf3, readModel, type ModelNode } from "./model.ts";
import { makeNode } from "./edits.ts";
import {
	type Constraint,
	type Keyframe,
	type Machine,
	type MachineInput,
	type MachineLayer,
	type MachineState,
	type Scene,
	type SceneNode,
	type StatePart,
	type Timeline,
	type Transition,
	DEFAULT_EASING,
	dimension,
	emptyScene,
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
		/**
		 * `states` is the per-layer field rung four added *beside* `state` rather
		 * than in place of it — a document written before layers existed still
		 * says what it always said, and one that names three layers says three
		 * things at once.
		 */
		uses?: Array<{ id: string; state?: string; states?: Record<string, string> }>;
		/**
		 * `MachineState[]` rather than the three-field shape this started as, so
		 * that the layer, timeline and blend a state may carry come through the
		 * *same* builder. A second builder for layered machines would let a test
		 * assert something about a layered document that is not true of the
		 * unlayered one beside it, which is the one thing these tests exist to
		 * catch.
		 */
		states?: MachineState[];
		transitions?: Transition[];
		constraints?: Constraint[];
		inputs?: MachineInput[];
		layers?: MachineLayer[];
		timelines?: Timeline[];
	} = {},
): Scene {
	const machine: Machine = {
		id: "m1",
		name: "Button states",
		root: "btn",
		states: spec.states ?? FOUR,
		transitions: spec.transitions ?? [],
		...(spec.inputs ? { inputs: spec.inputs } : {}),
		...(spec.layers ? { layers: spec.layers } : {}),
		...(spec.timelines ? { timelines: spec.timelines } : {}),
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
						...(use.states ? { states: use.states } : {}),
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

/* ------------------------------------------------------------------ */
/* The third axis and the rotation                                     */
/* ------------------------------------------------------------------ */

/**
 * A node of any kind at a place, in pixels — the shape `spatialprogram.test.ts`
 * builds its documents out of, repeated here rather than shared because the two
 * files are asking different questions of the same document and a helper that
 * moved would move both answers at once.
 */
const at = (
	id: string,
	kind: SceneNode["kind"],
	box: { x: number; y: number; w: number; h: number },
	extra: Partial<SceneNode> = {},
): SceneNode => ({
	...makeNode(
		kind,
		{ x: px(box.x), y: px(box.y), width: px(box.w), height: px(box.h) },
		{ id, name: id },
	),
	...extra,
});

/** An artboard, which is the one kind every document's top level is. */
const board = (id: string, x: number, children: SceneNode[]): SceneNode => ({
	...at(id, "frame", { x, y: 0, w: 800, h: 600 }),
	props: { fill: single("#ffffff") },
	children,
});

const scened = (...nodes: SceneNode[]): Scene => ({ ...emptyScene(), nodes });

/** A flat card beside a view holding a camera, a light, a pivot and two meshes. */
const oneView = (): Scene =>
	scened(
		board("page", 0, [
			at("card", "rect", { x: 20, y: 20, w: 100, h: 40 }),
			at("view", "viewport", { x: 200, y: 40, w: 480, h: 320 }, {
				camera: "cam",
				children: [
					at("cam", "camera", { x: 0, y: 0, w: 0, h: 0 }),
					at("key", "light", { x: 0, y: 0, w: 0, h: 0 }),
					at("rig", "pivot", { x: 40, y: 60, w: 0, h: 0 }, {
						spatial: { z: single("80px") },
						children: [
							at("cube", "mesh", { x: 10, y: 20, w: 100, h: 100 }, {
								spatial: { z: single("30px"), depth: single("40px") },
								turn: { rotateY: single("30deg") },
							}),
							at("bust", "model", { x: 0, y: 0, w: 60, h: 60 }, {
								mesh: {
									// The file somebody imported, and which part of it — a path
									// and two of the file's own indices, where this used to be a
									// content hash. The fixture is a `model` node and nothing
									// here reads its geometry, so the only thing the change
									// costs is that the compiler now has a `src` to quote — and a
									// ref written the old way has none, so `quote` is handed
									// `undefined` and the whole compile throws. That is why this
									// fixture moved in the same change as `compile.ts` rather
									// than after it, and it is also the argument for the
									// migration in `project.ts`: a *document* never arrives here
									// in the old shape, because `normalizeScene` rewrites it on
									// the way out of its store. A test that builds a `Scene`
									// literal skips that door and so has to spell the shape the
									// compiler expects.
									src: "/assets/bust.glb",
									format: "glb",
									part: { node: 0, primitive: 0 },
									bounds: {
										x: 0,
										y: 0,
										width: px(60),
										height: px(60),
										z: 0,
										depth: px(60),
									},
									triangles: 1234,
								},
							}),
						],
					}),
				],
			}),
		]),
	);

test("a flat document reads back four numbers, and the two new fields are absent rather than zero", async () => {
	// Invariant 4 at this end of the pipe, and the reason both fields are
	// optional. Absence is a *claim* — "this is a flat thing in a flat place" —
	// so a reader that defaulted them to `{z: 0, depth: 0}` would have made every
	// existing assertion about every existing template true by accident rather
	// than by the program having said nothing.
	for (const scene of [card(), stateful()]) {
		const model = readModel(await firstModel(scene));
		for (const node of Object.values(model.byId)) {
			assert.equal(node.spatial, undefined, `${node.id} has a third axis`);
			assert.equal(node.turn, undefined, `${node.id} is turned`);
		}
		for (const [term, copy] of Object.entries(model.states)) {
			assert.equal(copy.spatial, undefined, `${term} has a third axis`);
			assert.equal(copy.turn, undefined, `${term} is turned`);
		}
		// ...and the five maps the third axis and the ladder added read as empty
		// rather than absent, which is the same additive reading the state
		// material already gets on a document that has never heard of a machine.
		assert.deepEqual(model.keyframes, {});
		assert.deepEqual(model.fightsAt, {});
		assert.deepEqual(model.triangles, {});
		assert.deepEqual(model.looks, {});
	}

	// The one place a caller is allowed to stop caring which it is holding. A
	// renderer placing a box does not care, and `boxOf3` is where it says so.
	const flat = readModel(await firstModel(card()));
	const badge = flat.byId.badge;
	assert.ok(badge);
	assert.deepEqual(boxOf3(badge), { ...badge.frame, z: 0, depth: 0 });
});

test("a viewport's subtree reads six numbers and a rotation; the page it is drawn on reads four", async () => {
	// The whole architecture in one assertion: a mesh is an ordinary scene node,
	// so it is in `byId`, in its parent's `children`, in paint order, with a
	// `rendered` — and the only thing that distinguishes it from the rect on the
	// same artboard is that the answer set had two more numbers and three angles
	// to say about it.
	const model = readModel(await firstModel(oneView()));

	const cube = model.byId.cube;
	assert.ok(cube);
	assert.equal(cube.kind, "mesh");
	assert.deepEqual(cube.spatial, { z: px(30), depth: px(40) });
	// Thousandths of a degree, and complete where it is present: a node the
	// answer set turned about one axis is not turned about the other two, and
	// saying so with a zero is cheaper for every reader than saying it with a
	// hole.
	assert.deepEqual(cube.turn, { rotateX: 0, rotateY: 30_000, rotateZ: 0 });
	assert.deepEqual(boxOf3(cube), { ...cube.frame, z: px(30), depth: px(40) });

	// A pivot the document lifted and never turned still reads three zeros, and a
	// camera the document said nothing about at all still reads six numbers,
	// because being *in* the third axis is what `s3/1` decides and the program's
	// own default fills the rest in.
	assert.deepEqual(model.byId.rig?.spatial, { z: px(80), depth: 0 });
	assert.deepEqual(model.byId.rig?.turn, { rotateX: 0, rotateY: 0, rotateZ: 0 });
	assert.deepEqual(model.byId.cam?.spatial, { z: 0, depth: 0 });
	assert.deepEqual(model.byId.view?.spatial, { z: 0, depth: 0 });

	// And the rectangle two hundred pixels to the left of the view is not in a
	// scene. A viewport puts *its own subtree* into three dimensions, never the
	// page it is drawn on, and this is where a designer could observe it.
	assert.equal(model.byId.card?.spatial, undefined);
	assert.equal(model.byId.card?.turn, undefined);
	assert.equal(model.byId.page?.spatial, undefined);

	// The tree is the ordinary tree, in the ordinary paint order — a mesh sorts by
	// `order/2` beside every other node rather than by anything of its own.
	assert.deepEqual(
		model.byId.rig?.children.map((c) => c.id),
		["cube", "bust"],
	);

	// Two maps that exist so a panel can answer without loading an asset or
	// re-deciding what a view looks through.
	assert.deepEqual(model.triangles, { bust: 1234 });
	assert.deepEqual(model.looks, { view: "cam" });
});

test("a hidden camera stops the marker and not the looking", async () => {
	// `vcam/2` is deliberately not filtered by `visible/1` in the reader either,
	// and the reader is where it would be easiest to filter it by accident: the
	// camera is gone from the picture and the view still knows what it looks
	// through. A view that went black because somebody hid a marker would be the
	// tool answering a question nobody asked.
	const model = readModel(await firstModel({ ...oneView(), rules: "hidden(cam)." }));
	assert.equal(model.byId.cam, undefined);
	assert.deepEqual(model.looks, { view: "cam" });
});

test("solved geometry on the third axis lands in `spatial`, by the same lines as `x`", async () => {
	// `readSolved` reads six axes now, not four, because `gpos(N,z)` and
	// `gsize(N,depth)` mint `lv(N,z)` and `lsz(N,depth)` for a node in the third
	// axis exactly as they mint the planar four — a mesh in a viewport is placed
	// by the same simplex, in the same units, by the same rules. So a `z` the
	// solver worked out has to beat the stored one for the reason a solved `x`
	// does, and land in the field that is not the `Frame`.
	const scene: Scene = {
		...scened(
			board("page", 0, [
				at("view", "viewport", { x: 0, y: 0, w: 480, h: 320 }, {
					children: [
						at("cube", "mesh", { x: 20, y: 20, w: 100, h: 100 }, {
							spatial: { z: single("0px") },
						}),
						at("pillar", "mesh", { x: 200, y: 20, w: 100, h: 100 }),
					],
				}),
			]),
		),
		rules: [
			"gsolved(cube). gsolved(pillar).",
			"&sum{ wv(cube,z); -wv(pillar,z) } = 240*emupx.",
		].join("\n"),
	};
	const model = readModel(await firstModel(scene));
	const cube = model.byId.cube;
	const pillar = model.byId.pillar;
	assert.ok(cube && pillar);
	assert.equal(cube.spatial?.z, px(240));
	assert.equal(pillar.spatial?.z, 0);
	// Not folded into the frame, which is the no-regression promise: `Frame` is
	// four numbers in every consumer of this package, and a fifth key here would
	// be a shape none of them has a field for.
	assert.deepEqual(Object.keys(cube.frame).sort(), ["height", "width", "x", "y"]);
	// The artboard gains a `z` here and not in the test above, and the difference
	// is real rather than incidental: the world chain a placed node hangs from
	// needs a floor to run down to, and a document where nothing inside the view
	// is placed never asks for one.
	assert.deepEqual(model.byId.page?.spatial, { z: 0, depth: 0 });
});

/* ------------------------------------------------------------------ */
/* A state, a keyframe and a pose                                      */
/* ------------------------------------------------------------------ */

/** A definition holding one lifted mesh, one instance of it, and a machine. */
const spatialComponent = (states: MachineState[]): Scene => ({
	...scened(
		board("page", 0, [
			at("view", "viewport", { x: 0, y: 0, w: 700, h: 400 }, {
				children: [
					at("widget", "pivot", { x: 0, y: 0, w: 120, h: 120 }, {
						component: true,
						children: [
							at("cube", "mesh", { x: 10, y: 10, w: 100, h: 100 }, {
								spatial: { z: single("0px"), depth: single("40px") },
							}),
						],
					}),
					at("u1", "instance", { x: 200, y: 0, w: 120, h: 120 }, { instanceOf: "widget" }),
				],
			}),
		]),
	),
	machines: [
		{ id: "m1", name: "Widget", root: "widget", states, transitions: [] },
	],
});

test("a state that lifts and turns a mesh reads back as a pose the canvas can draw", async () => {
	// A state copy carrying only four numbers is a pose nothing can draw and a
	// diff nothing can write, which is why `ModelState` grew the same two
	// optional halves a node has. A state whose *only* delta is a rotation is the
	// sharp case: it says nothing through `frame/3` or `rendered/3`, so without
	// `turn/3` as a source of copies it would be missing from a document that
	// plainly holds it.
	const model = readModel(
		await firstModel(
			spatialComponent([
				{ id: "flat", name: "flat", parts: {} },
				{
					id: "lifted",
					name: "lifted",
					parts: {
						cube: {
							frame: { z: dimension(px(120)) },
							turn: { rotateY: single("45deg") },
						},
					},
				},
			]),
		),
	);

	const flat = model.states[statePart("u1", "flat", "cube")];
	const lifted = model.states[statePart("u1", "lifted", "cube")];
	assert.ok(flat && lifted);
	assert.deepEqual(flat.spatial, { z: 0, depth: px(40) });
	assert.deepEqual(lifted.spatial, { z: px(120), depth: px(40) });
	assert.deepEqual(flat.turn, { rotateX: 0, rotateY: 0, rotateZ: 0 });
	assert.deepEqual(lifted.turn, { rotateX: 0, rotateY: 45_000, rotateZ: 0 });
	// The depth is not in the delta and is in both copies, which is the whole
	// point of a delta: a dimension a state says nothing about is the instance's
	// own, shared rather than copied.
	assert.equal(flat.spatial?.depth, lifted.spatial?.depth);
	// The planar four are untouched by a delta that only spoke about `z`.
	assert.deepEqual(flat.frame, lifted.frame);

	// And the drawn part is the shown copy, on all six axes and all three angles
	// — the alias carries the third axis exactly as it carries `x`, or the canvas
	// would draw a state the answer set does not hold.
	const drawn = model.byId["inst(u1,cube)"];
	assert.ok(drawn);
	assert.equal(model.shown.u1, "flat");
	assert.deepEqual(drawn.spatial, flat.spatial);
	assert.deepEqual(drawn.turn, flat.turn);
});

test("a viewport on another artboard does not put a flat button's states into three dimensions", async () => {
	// merged-plan §4, observed where it can actually be observed. The program's
	// state-copy defaults are narrowed to `s3(stt(I,S,N))` precisely so that one
	// viewport anywhere in the document does not silently give every state of
	// every button a `z` and a `depth` — and the reader is the only place that
	// narrowing is visible as anything other than an atom count.
	const button = stateful();
	const scene: Scene = {
		...button,
		nodes: [
			...button.nodes,
			board("page2", 900, [
				at("view", "viewport", { x: 20, y: 20, w: 480, h: 320 }, {
					camera: "cam",
					children: [
						at("cam", "camera", { x: 0, y: 0, w: 0, h: 0 }),
						at("cube", "mesh", { x: 100, y: 100, w: 100, h: 100 }),
					],
				}),
			]),
		],
	};
	const model = readModel(await firstModel(scene));

	// The document is spatial — there is a mesh in it, with six numbers.
	assert.deepEqual(model.byId.cube?.spatial, { z: 0, depth: 0 });
	// ...and the button on the other artboard is exactly as flat as it was.
	assert.equal(model.byId["inst(b1,label)"]?.spatial, undefined);
	assert.ok(Object.keys(model.states).length > 0, "there were copies to check");
	for (const [term, copy] of Object.entries(model.states)) {
		assert.equal(copy.spatial, undefined, `${term} gained a third axis`);
		assert.equal(copy.turn, undefined, `${term} gained a rotation`);
	}
});

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

test("a machine with no layers reads as the one-layer machine it is", async () => {
	// `shown` is kept and is `shownByLayer`'s first layer, so every reader written
	// before layers existed is asking the question it always asked. The layer it
	// is in is the one the *reader* mints, called `base`, and the two maps have to
	// agree about it or a panel indexed by layer would be showing a state `shown`
	// does not name.
	const model = readModel(await firstModel(stateful()));
	assert.deepEqual(model.machines.m1?.layers, ["base"]);
	assert.deepEqual(model.shown, { b1: "rest" });
	assert.deepEqual(model.shownByLayer, { b1: { base: "rest" } });
});

/**
 * Two layers over one part, both with an opinion about all three of paint,
 * geometry and rotation.
 *
 * The later layer is `glow`, so `glow` is what wins — the position in the list
 * *is* the priority, which is the same "the order is the answer" the initial
 * state and `order/2` already use.
 */
const layered = (): Scene =>
	stateful({
		layers: [
			{ id: "words", name: "Words" },
			{ id: "glow", name: "Glow" },
		],
		states: [
			{ id: "rest", name: "rest", parts: {}, layer: "words" },
			{
				id: "hot",
				name: "hot",
				layer: "words",
				parts: {
					label: {
						props: { ink: single(HOT_INK) },
						frame: { y: dimension(px(30)) },
						turn: { rotateZ: single("10deg") },
					},
				},
			},
			{ id: "cool", name: "cool", parts: {}, layer: "glow" },
			{
				id: "warm",
				name: "warm",
				layer: "glow",
				parts: {
					label: {
						props: { ink: single("#22c55e") },
						frame: { y: dimension(px(40)) },
						turn: { rotateZ: single("20deg") },
					},
				},
			},
		],
		uses: [{ id: "b1", states: { words: "hot", glow: "warm" } }],
	});

test("two layers are two states on screen at once, and `shown` is the lowest of them", async () => {
	// The rung the copy encoding was bought for. Two `shown/2` facts in ONE
	// answer set is what a layer *is*; a reader that took `shown` alone would be
	// showing half the picture with no way to know it, and one that treated two
	// of them as a contradiction would be refusing the feature.
	const model = readModel(await firstModel(layered()));
	assert.deepEqual(model.machines.m1?.layers, ["words", "glow"]);
	assert.deepEqual(model.shownByLayer, { b1: { words: "hot", glow: "warm" } });
	assert.equal(model.shown.b1, "hot", "the lowest layer, not whichever atom arrived first");
	// Both states are copies in the same answer set, as every other state is.
	assert.ok(model.states[statePart("b1", "hot", "label")]);
	assert.ok(model.states[statePart("b1", "warm", "label")]);
});

test("the later layer is what is drawn, and all three kinds of fight are named", async () => {
	const model = readModel(await firstModel(layered()));
	const drawn = model.byId["inst(b1,label)"];
	assert.ok(drawn);
	// `glow` is second, so `glow` writes — for paint, for geometry and for the
	// rotation alike. Exactly one value each: a `turn/3` derived twice for one
	// (part, axis) is not two designs, it is one arbitrary answer.
	assert.equal(drawn.rendered.ink, "#22c55e");
	assert.equal(drawn.frame.y, px(40));
	// The rotation too, and it is worth being explicit that this is a *flat*
	// document: `rotateZ` is a turn in the plane, so a state that spins a label
	// spins the drawn label, with no viewport and no mesh anywhere near it. The
	// third axis and the rotation arrived together and are not the same feature.
	assert.deepEqual(drawn.turn, { rotateX: 0, rotateY: 0, rotateZ: 20_000 });
	assert.deepEqual(model.states[statePart("b1", "warm", "label")]?.rendered.ink, "#22c55e");
	assert.deepEqual(model.states[statePart("b1", "hot", "label")]?.turn, {
		rotateX: 0,
		rotateY: 0,
		rotateZ: 10_000,
	});

	// The three fight lists are three sentences a panel writes differently, which
	// is why they are three fields rather than one with a tag. Static, and a
	// claim about the machine: these two layers *would* argue.
	const machine = model.machines.m1;
	assert.ok(machine);
	assert.deepEqual(machine.fights, [["glow", "words", "label", "ink"]]);
	assert.deepEqual(machine.frameFights, [["glow", "words", "label", "y"]]);
	assert.deepEqual(machine.rotationFights, [["glow", "words", "label", "rotateZ"]]);
	// ...and the same argument as *drawn*, which needs both fighting layers to
	// have a state on screen and so belongs beside the picture rather than beside
	// the health. Only the property fight is carried, which is `mfightat/5`'s own
	// arity and is flagged in this reader's field comment as the deviation it is.
	assert.deepEqual(model.fightsAt, { b1: [["glow", "words", "label", "ink"]] });
});

/* ------------------------------------------------------------------ */
/* Timelines                                                           */
/* ------------------------------------------------------------------ */

/** One keyframe, spelled the way a track holds one. */
const key = (at: string, value: string): Keyframe => ({
	at: [lit(at)],
	value: [lit(value)],
});

const PULSE: Timeline = {
	id: "pulse",
	name: "Pulse",
	loop: "loop",
	tracks: [
		{ part: "label", dim: "y", keys: [key("0ms", "14px"), key("300ms", "2px")] },
		{ part: "panel", prop: "fill", keys: [key("0ms", "#0f172a"), key("120ms", "#334155")] },
	],
};

const animated = (constraints: Constraint[] = []): Scene =>
	stateful({
		timelines: [PULSE],
		states: [
			{ id: "rest", name: "rest", parts: {} },
			{ id: "beat", name: "beat", parts: {}, timeline: "pulse" },
		],
		constraints,
	});

test("a timeline reads back as the times this universe put it at, and mints no copies", async () => {
	// What is here is what the answer set *decided*, which is the times and not
	// the values: `mkat/5` is the resolution of a `duration` Value against this
	// universe, so a panel that asked the document instead would be showing a
	// different animation from the one the solver answered with.
	//
	// And the default is no copies at all. A timeline on its own costs two
	// variables per keyframe and one per timeline, which is enough for the export
	// and enough for the canvas — so `keyframes` being empty here is the
	// rationing working rather than the feature missing.
	const model = readModel(await firstModel(animated()));
	const timelines = model.machines.m1?.timelines;
	assert.deepEqual(Object.keys(timelines ?? {}), ["pulse"]);
	assert.equal(timelines?.pulse?.length, 300, "derived from the last key");
	assert.equal(timelines?.pulse?.loop, "loop");
	assert.deepEqual(timelines?.pulse?.tracks, {
		[trackDim("label", "y")]: [
			{ index: 1, at: 0, easing: DEFAULT_EASING },
			{ index: 2, at: 300, easing: DEFAULT_EASING },
		],
		[trackProp("panel", "fill")]: [
			{ index: 1, at: 0, easing: DEFAULT_EASING },
			{ index: 2, at: 120, easing: DEFAULT_EASING },
		],
	});
	assert.deepEqual(model.keyframes, {});
});

test("a curve reads back as the term it is, and not only as a word the menu knows", async () => {
	// `measing/3` and `mkeasing/5` were **facts this file wrote** until a curve
	// became a Value, so a reader that tested the argument against `EASINGS` was
	// right for as long as nothing else could put an atom there. Both are derived
	// now and both have a second rule that puts `cubicBezier(X1,Y1,X2,Y2)` in the
	// answer set, which a membership test drops on the floor — and drops
	// *silently*, because every reader of these two fields falls back to
	// `DEFAULT_EASING` and the export would then write a curve that is wrong in a
	// way only a stopwatch could see. So the shape of the atom is asserted here,
	// where the fallback cannot hide it.
	const scene = stateful({
		timelines: [
			{
				...PULSE,
				tracks: [
					{
						part: "label",
						dim: "y",
						keys: [
							{ ...key("0ms", "14px"), easing: [lit("cubicBezier(340,1560,640,1000)")] },
							{ ...key("300ms", "2px"), easing: [lit("springSnappy")] },
						],
					},
				],
			},
		],
		states: [
			{ id: "rest", name: "rest", parts: {} },
			{ id: "beat", name: "beat", parts: {}, timeline: "pulse" },
		],
		transitions: [
			{
				id: "go",
				from: "rest",
				to: "beat",
				trigger: "pointerenter",
				enabled: true,
				easing: [lit("cubicBezier(200,0,0,1000)")],
			},
			{
				id: "back",
				from: "beat",
				to: "rest",
				trigger: "pointerleave",
				enabled: true,
				easing: [lit("springBouncy")],
			},
		],
	});
	const model = readModel(await firstModel(scene));
	// A term survives the parse because `parseAtom` splits on *top-level* commas,
	// so `measing(m1,go,cubicBezier(200,0,0,1000))` is three arguments and not six.
	// A reader that had split on every comma would have filed it under
	// `measing/6` and never seen it at all.
	assert.deepEqual(model.machines.m1?.easing, {
		go: "cubicBezier(200,0,0,1000)",
		back: "springBouncy",
	});
	// And the same one grain finer, over the curve *out of* a keyframe. The second
	// key's curve is read by nothing — there is no segment leaving the last one —
	// and is derived anyway, so it is here.
	assert.deepEqual(model.machines.m1?.timelines?.pulse?.tracks, {
		[trackDim("label", "y")]: [
			{ index: 1, at: 0, easing: "cubicBezier(340,1560,640,1000)" },
			{ index: 2, at: 300, easing: "springSnappy" },
		],
	});
});

test("a keyframe copy appears where a rule named one, and is a pose rather than a node", async () => {
	// `keyframeParts` seeds copies from the *constraints*, so naming a `kfr(...)`
	// term is what brings one into being. It is not a `node/1` for a state copy's
	// reasons exactly: a drawable copy per keyframe would paint every moment of
	// every animation on top of the picture and grow the layer list by the
	// keyframe count.
	const named = keyCopy("b1", "pulse", trackDim("label", "y"), 2);
	const model = readModel(
		await firstModel(
			animated([
				{
					id: "k",
					kind: "align",
					prop: "fill",
					nodes: [named, "inst(b1,panel)"],
					edge: "left",
					enabled: true,
				},
			]),
		),
	);

	// Both keys of the named track, because the closure is over the track: a copy
	// of only the moment a rule mentioned would be a pose with nothing to
	// interpolate from.
	assert.deepEqual(Object.keys(model.keyframes).sort(), [
		keyCopy("b1", "pulse", trackDim("label", "y"), 1),
		named,
	]);
	const second = model.keyframes[named];
	assert.ok(second);
	assert.equal(second.instance, "b1");
	assert.equal(second.timeline, "pulse");
	assert.equal(second.track, trackDim("label", "y"));
	assert.equal(second.index, 2);
	assert.equal(second.at, 300, "the millisecond this universe put it at");
	assert.equal(second.easing, DEFAULT_EASING);
	// It is where the track says it is at that moment, and it paints with what
	// the part paints with — a copy is a pose, so it carries the whole of one.
	assert.equal(second.frame.y, px(2));
	assert.equal(model.keyframes[keyCopy("b1", "pulse", trackDim("label", "y"), 1)]?.frame.y, px(14));
	assert.equal(second.rendered.text, "Go");

	// Nowhere a node would be, and beside `states` rather than in it: a state copy
	// is a pose the machine settles in, a keyframe copy is one it passes through,
	// and a reader that wanted "every pose" would still have to know which was
	// which to draw either.
	for (const id of Object.keys(model.byId)) {
		assert.ok(!id.startsWith("kfr("), `${id} is a keyframe copy in byId`);
	}
	for (const id of Object.keys(model.states)) {
		assert.ok(!id.startsWith("kfr("), `${id} is a keyframe copy in states`);
	}
});

/* ------------------------------------------------------------------ */
/* What the ladder finds wrong                                         */
/* ------------------------------------------------------------------ */

test("the ladder's health and its fourth motion table read back per machine", async () => {
	// The program's own answers rather than `machineHealth`'s, deliberately
	// duplicated for the reason the shipped four are: a panel has to be able to
	// say "no valuation can take this edge" while the document is unsatisfiable
	// and there is no answer set at all.
	const model = readModel(
		await firstModel(
			stateful({
				inputs: [
					{ id: "hovered", name: "hovered", kind: "boolean", initial: "false" },
					{ id: "n", name: "n", kind: "number", min: "0", max: "1" },
				],
				states: [
					{ id: "rest", name: "rest", parts: {} },
					{ id: "hot", name: "hot", parts: { label: { props: { ink: single(HOT_INK) } } } },
				],
				transitions: [
					// A guard no valuation can satisfy: `hovered` is a boolean and
					// nothing it can hold is both true and false.
					edge({
						id: "never",
						from: "rest",
						to: "hot",
						conditions: [
							{ input: "hovered", op: "eq", value: "true" },
							{ input: "hovered", op: "eq", value: "false" },
						],
					}),
					// A reserved id in a position it may not hold: nothing leaves Exit,
					// and nothing arrives at Entry.
					edge({ id: "wrong", from: "exit", to: "rest", trigger: "click" }),
					edge({ id: "alsowrong", from: "rest", to: "entry", trigger: "click" }),
					// An exit time is the fourth motion setting: a `duration` Value that
					// clamps at zero like a delay and is projected like a duration.
					edge({ id: "slow", from: "hot", to: "rest", trigger: "pointerleave", exit: [lit("50ms")] }),
				],
			}),
		),
	);
	const machine = model.machines.m1;
	assert.ok(machine);

	assert.deepEqual(machine.impossible, ["never"]);
	assert.deepEqual(machine.misplaced, ["alsowrong", "wrong"]);
	// A superset of `unreachable`: the ordinary reachability walk ignores guards,
	// this one refuses to walk an edge no valuation can take. `hot` is reachable
	// on paper and unreachable in the machine, which is exactly why the two lists
	// are separate rather than one.
	assert.deepEqual(machine.unreachable, []);
	assert.deepEqual(machine.unreachableWithGuards, ["hot"]);
	// Every transition has an exit time, because the program supplies its own
	// default where the document is silent.
	assert.deepEqual(machine.exit, { never: 0, wrong: 0, alsowrong: 0, slow: 50 });
});

test("a blend's stops, and a keyframe this universe put behind the one in front of it", async () => {
	// Two answers that are properties of an *answer* rather than of a document,
	// which is the class of bug a multiverse invents and a linter over the
	// document could never catch.
	const backwards: Timeline = {
		id: "pulse",
		name: "Pulse",
		tracks: [{ part: "label", dim: "y", keys: [key("300ms", "14px"), key("50ms", "2px")] }],
	};
	const model = readModel(
		await firstModel(
			stateful({
				inputs: [{ id: "n", name: "n", kind: "number", min: "0", max: "1" }],
				timelines: [backwards],
				states: [
					{
						id: "mix",
						name: "mix",
						parts: {},
						// Both a timeline and a blend: reported rather than repaired,
						// because a state with two sources is a mistake a person should
						// see rather than one a reader should quietly pick a side in.
						timeline: "pulse",
						blend: {
							kind: "oneD",
							input: "n",
							stops: [
								{ timeline: "pulse", at: "-0.5" },
								{ timeline: "pulse", at: "0.4" },
							],
						},
					},
				],
			}),
		),
	);
	const machine = model.machines.m1;
	assert.ok(machine);
	assert.deepEqual(machine.stopsOutOfRange, [["mix", 1]]);
	assert.deepEqual(machine.stopGaps, ["mix"]);
	assert.deepEqual(machine.twoSource, ["mix"]);
	assert.deepEqual(machine.backwardsKeys, [["pulse", trackDim("label", "y"), 2]]);
	// ...and the timeline is sorted by the time this universe resolved, with the
	// index as the tie-break, which is the same stable order `solvedKeys` uses —
	// so "key 3" is the same keyframe in the panel, in the term and here.
	assert.deepEqual(machine.timelines.pulse?.tracks[trackDim("label", "y")], [
		{ index: 2, at: 50, easing: DEFAULT_EASING },
		{ index: 1, at: 300, easing: DEFAULT_EASING },
	]);
});

test("two readings of one answer set are the same reading, whatever order the atoms arrive in", async () => {
	// Every sort in this file — the copies, the fights, the health lists, the
	// track keys, the layer stack, the `wears` table, the `shown` tie-break — is
	// there for one reason, and this is it stated once instead of thirteen times.
	// clingo's print order is a property of the search rather than of the answer,
	// so a reader that let it through would make a panel reorder itself between
	// two solves that decided exactly the same thing.
	//
	// The document is deliberately the busiest one this file builds: two layers
	// arguing over three things, a timeline, a blend, and an instance drawn in a
	// state per layer.
	const atoms = await firstModel(
		stateful({
			layers: [
				{ id: "words", name: "Words" },
				{ id: "glow", name: "Glow" },
			],
			timelines: [PULSE],
			inputs: [{ id: "n", name: "n", kind: "number", min: "0", max: "1" }],
			states: [
				{ id: "rest", name: "rest", parts: {}, layer: "words" },
				{
					id: "hot",
					name: "hot",
					layer: "words",
					parts: { label: { props: { ink: single(HOT_INK) }, turn: { rotateZ: single("10deg") } } },
				},
				{ id: "cool", name: "cool", parts: {}, layer: "glow" },
				{
					id: "warm",
					name: "warm",
					layer: "glow",
					parts: { label: { props: { ink: single("#22c55e") }, frame: { y: dimension(px(40)) } } },
				},
				{ id: "beat", name: "beat", parts: {}, layer: "glow", timeline: "pulse" },
			],
			uses: [{ id: "b1", states: { words: "hot", glow: "warm" } }],
		}),
	);

	// Reversed rather than shuffled at random, so a failure is reproducible: it
	// is the one permutation that puts every "first one wins" tie-break under the
	// opposite pressure at once.
	const forwards = readModel(atoms);
	const backwards = readModel([...atoms].reverse());
	assert.deepEqual(backwards, forwards);
	// `deepEqual` on an object compares keys as a set, so the two orders are
	// asserted separately — and they are what a panel actually iterates.
	assert.deepEqual(Object.keys(backwards.states), Object.keys(forwards.states));
	assert.deepEqual(Object.keys(backwards.byId), Object.keys(forwards.byId));
	assert.ok(Object.keys(forwards.states).length > 0, "there was something to sort");
});

/* ------------------------------------------------------------------ */
/* Coordinates decided outside the answer set                          */
/* ------------------------------------------------------------------ */

test("an override wins over the answer set, per key and not per node", async () => {
	// `Universe.model` is `readModel(atoms)` and `readModel` computes its own
	// `readSolved` — it never sees `Universe.solved`. So a second solver's answer
	// reaches the picture through this parameter or it does not reach it at all:
	// `Editor.tsx` reads `universe.solved` while `Artboard.tsx`, the posters and
	// every exported file draw `universe.model`, and without the override one
	// document would be drawn two contradictory ways at once.
	const scene: Scene = {
		...emptyScene(),
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(400), height: px(120) }, {
					id: "row",
				}),
				layout: makeLayout({ direction: "row" }),
				children: [
					makeNode("rect", { x: 0, y: 0, width: px(60), height: px(60) }, { id: "one" }),
					makeNode("rect", { x: 0, y: 0, width: px(60), height: px(60) }, { id: "two" }),
				],
			},
		],
	};
	const atoms = await firstModel(scene);
	const plain = readModel(atoms);
	// The row placed its children, so both coordinates are the layout's rather
	// than the document's — which is what makes the assertion below discriminating.
	assert.notEqual(plain.byId.one.frame.y, 0);

	const moved = readModel(atoms, { one: { x: px(111) } });
	assert.equal(moved.byId.one.frame.x, px(111));
	// **Per key.** A spread at the node level would replace the whole record and
	// delete every coordinate the override does not carry, so this `y` would fall
	// back to the stored frame's nought and the node would jump out of its slot —
	// with the answer set still saying otherwise.
	assert.equal(moved.byId.one.frame.y, plain.byId.one.frame.y);
	assert.equal(moved.byId.two.frame.x, plain.byId.two.frame.x);
	// And everything else is the reading it always was, which is what keeps the
	// goldens' no-argument call meaning what it meant.
	assert.deepEqual(readModel(atoms), plain);
});

test("an override about a node the answer set never mentions changes nothing", async () => {
	const atoms = await firstModel(card());
	const plain = readModel(atoms);
	assert.deepEqual(readModel(atoms, {}), plain);
	assert.deepEqual(readModel(atoms, { nobody: { x: px(9) } }), plain);
});
