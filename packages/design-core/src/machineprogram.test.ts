/**
 * State machines, against the real solver.
 *
 * Every claim the feature makes is a claim about the *program* — that a state is
 * a copy rather than a choice, that all of them are true at once, that what a
 * state does not touch it shares — so everything here goes through clingo rather
 * than through a hand-written atom list. `components.test.ts` is the model: a
 * button definition, some uses of it, and assertions over what comes back.
 *
 * The first test in the file is the feature's load-bearing guarantee and the
 * reason the encoding looks the way it does. **Adding states must not add
 * universes.** If it ever does, the multiverse has quietly become a sprite sheet
 * and every cross-state question a designer asks has become unaskable, whatever
 * else still works — so it is asserted three ways, against a document with no
 * machine, a document with two states and a document with four.
 *
 * Written in pixels at the document end and EMU in the middle, the same seam
 * `geometric.test.ts` and `datums.test.ts` name.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAtom, unquote } from "./atoms.ts";
import { PULL_ATOM, SCENERY_ATOM, compile, variableCounts } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { makeNode } from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import { statePart, stateFrameVar, statePropVar } from "./machines.ts";
import type {
	Constraint,
	Machine,
	MachineState,
	Scene,
	SceneNode,
	StatePart,
	Transition,
	Trigger,
} from "./scene.ts";
import { dimension } from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { type Token, type Value, lit, motionVar, single, tokenVar } from "./values.ts";

const P = EMU_PER_PX;
const px = (n: number): number => n * P;

/* ------------------------------------------------------------------ */
/* The document under test                                             */
/* ------------------------------------------------------------------ */

/**
 * A machine, spelled the way a document holds one rather than the way an editor
 * would build one.
 *
 * The defaults are the ones that make a transition legal without saying
 * anything: enabled, and no motion settings at all, so the program's own
 * `mdefdur`/`mdefdelay`/`mdefstagger` are what pace it. A test that cares about
 * pacing says so.
 */
const edge = (
	spec: Partial<Transition> & { id: string; from: string; to: string },
): Transition => ({ trigger: "pointerenter" as Trigger, enabled: true, ...spec });

const machine = (spec: {
	id?: string;
	root?: string;
	states: Array<{ id: string; name?: string; parts?: Record<string, StatePart> }>;
	transitions?: Transition[];
}): Machine => ({
	id: spec.id ?? "m1",
	name: "Button states",
	root: spec.root ?? "btn",
	states: spec.states.map(
		(state): MachineState => ({
			id: state.id,
			name: state.name ?? state.id,
			parts: state.parts ?? {},
		}),
	),
	transitions: spec.transitions ?? [],
});

/** One use of the definition, and what the document remembers about it. */
interface Use {
	id: string;
	/** Which state it is drawn in — {@link SceneNode.state}. */
	state?: string;
}

/**
 * A button definition and however many uses of it, optionally with a machine.
 *
 * The definition is deliberately three levels deep — `btn > panel > inner`
 * beside `btn > label` — because the materialisation analysis is the thing most
 * of these tests are indirectly about: a delta on `label` must reach `btn` and
 * must not reach `panel`, `inner` or anything under `label`, and a shape with
 * only leaves could not tell the difference.
 */
function buttons(spec: {
	uses?: Use[];
	machines?: Machine[];
	constraints?: Constraint[];
	tokens?: Token[];
	/** What the definition's root paints with. One alternative unless said. */
	fill?: Value;
	rules?: string;
} = {}): Scene {
	const label: SceneNode = {
		...makeNode("text", { x: px(12), y: px(14), width: px(136), height: px(20) }, {
			id: "label",
			name: "Label",
		}),
		props: { text: single("Go"), ink: single("#ffffff"), size: single("14px") },
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
		props: { fill: spec.fill ?? single("#3b82f6"), radius: single("8px") },
		children: [label, panel],
		component: true,
	};
	return {
		styles: [],
		machines: spec.machines ?? [],
		tokens: spec.tokens ?? [],
		constraints: spec.constraints ?? [],
		rules: spec.rules ?? "",
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(600), height: px(400) }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: single("#ffffff") },
				children: [
					definition,
					...(spec.uses ?? []).map((use, i) => ({
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

const rule = (
	id: string,
	kind: Constraint["kind"],
	nodes: string[],
	edgeName: Constraint["edge"],
	value?: Value,
): Constraint => ({
	id,
	kind,
	prop: "fill",
	nodes,
	edge: edgeName,
	enabled: true,
	...(value ? { value } : {}),
});

/* ------------------------------------------------------------------ */
/* Reading the answer set directly                                     */
/* ------------------------------------------------------------------ */

/**
 * Every answer set of a document, as raw atoms.
 *
 * `explore` is the right tool for a question about *designs*; several claims
 * below are about atoms it does not surface — `mdur/3`, `mtwoshown/1`, and the
 * absence of `pick(stt(...))` — so this opens the session itself and assumes
 * exactly what an ordinary solve assumes: every rule's switch, the pull toward
 * the stored frames, and the picture.
 */
async function answers(scene: Scene): Promise<string[][]> {
	const { program, guards } = compile(scene);
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

/** The one answer set of a document that has only one. */
async function only(scene: Scene): Promise<string[]> {
	const models = await answers(scene);
	assert.equal(models.length, 1, "this document is meant to hold one design");
	return models[0];
}

/** Atoms of one predicate, as their argument lists. */
function args(atoms: readonly string[], name: string, arity: number): string[][] {
	return atoms.flatMap((text) => {
		const atom = parseAtom(text);
		return atom && atom.name === name && atom.args.length === arity ? [atom.args] : [];
	});
}

/** Literal id -> the text it stands for, so a `rendered/3` reads as a colour. */
function literals(atoms: readonly string[]): Map<string, string> {
	return new Map(args(atoms, "literal", 2).map(([id, text]) => [id, unquote(text)]));
}

/** What one term draws with, whether it is a node or a state copy. */
function renderedOf(atoms: readonly string[], term: string): Record<string, string> {
	const table = literals(atoms);
	const out: Record<string, string> = {};
	for (const [node, prop, literal] of args(atoms, "rendered", 3)) {
		if (node !== term) continue;
		const text = literal.startsWith('"') ? unquote(literal) : table.get(literal);
		if (text !== undefined) out[prop] = text;
	}
	return out;
}

/** One term's frame, in EMU, off the `frame/3` atoms. */
function frameOf(atoms: readonly string[], term: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [node, dim, value] of args(atoms, "frame", 3)) {
		if (node === term) out[dim] = Number(value);
	}
	return out;
}

const run = (scene: Scene, limit = 200) =>
	explore(scene, directSolver, { limit, sample: "first" });

const fails = async (scene: Scene): Promise<UnsatisfiableError> => {
	const error = await explore(scene, directSolver).then(
		() => null,
		(e: unknown) => e,
	);
	assert.ok(error instanceof UnsatisfiableError, "expected no design at all");
	return error;
};

/* ------------------------------------------------------------------ */
/* The invariant                                                       */
/* ------------------------------------------------------------------ */

/**
 * Four states worth of deltas, none of which is a choice: each state moves the
 * label somewhere else, with exactly one alternative for the dimension.
 */
const nudge = (y: number): Record<string, StatePart> => ({
	label: { frame: { y: dimension(px(y)) } },
});

test("adding states does not add universes — the whole feature in one assertion", async () => {
	// THIS IS THE GUARANTEE. A machine state is never an alt/2 alternative and
	// never gets a pick/2, so a document's universe count is a fact about what the
	// designer wrote alternatives for and nothing else. The cheap encoding — a
	// choice rule over mstate/2 — passes every other test in this file and fails
	// this one, which is exactly why it is first.
	const uses = [{ id: "b1" }];
	const none = buttons({ uses, fill: [lit("#3b82f6"), lit("#0f172a")] });
	const two = buttons({
		uses,
		fill: [lit("#3b82f6"), lit("#0f172a")],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(10) },
				],
				transitions: [edge({ id: "over", from: "rest", to: "hover" })],
			}),
		],
	});
	const four = buttons({
		uses,
		fill: [lit("#3b82f6"), lit("#0f172a")],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(10) },
					{ id: "pressed", parts: nudge(16) },
					{ id: "busy", parts: nudge(6) },
				],
				transitions: [
					edge({ id: "over", from: "rest", to: "hover" }),
					edge({ id: "down", from: "hover", to: "pressed", trigger: "pointerdown" }),
					edge({ id: "work", from: "pressed", to: "busy", trigger: "click" }),
					edge({ id: "done", from: "busy", to: "rest", trigger: "load" }),
				],
			}),
		],
	});

	const bare = (await run(none)).count;
	assert.ok(bare > 1, "the document has a design space at all, or this proves nothing");
	assert.equal((await run(two)).count, bare, "two states are not two more designs");
	assert.equal((await run(four)).count, bare, "and four are not sixteen");

	// And the copies really are there in the four-state document, so the equality
	// above is not the equality of two documents with no machine in them.
	const atoms = (await answers(four))[0];
	for (const state of ["rest", "hover", "pressed", "busy"]) {
		assert.ok(
			frameOf(atoms, statePart("b1", state, "label")).y !== undefined,
			`${state} has a copy of the label`,
		);
	}
});

test("a shared fill under four states is two designs, not sixteen", async () => {
	// The other half of the invariant, and the one that decides the encoding of
	// rendered/3: a property no state touches is read from the instance's ONE
	// variable by every copy at once. Minting a copy of it per state would make
	// this document 2^4.
	const scene = buttons({
		uses: [{ id: "b1" }],
		fill: [{ kind: "token", token: "accent" }],
		tokens: [
			{ id: "accent", name: "Accent", type: "color", value: [lit("#3b82f6"), lit("#0f172a")] },
		],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(10) },
					{ id: "pressed", parts: nudge(16) },
					{ id: "busy", parts: nudge(6) },
				],
			}),
		],
	});
	const found = await run(scene);
	assert.equal(found.count, 2, "one binary choice, four states, two designs");

	// Every state copy of the root paints the same fill in a universe, because
	// there is only one variable for all of them to read.
	for (const model of await answers(scene)) {
		const fills = ["rest", "hover", "pressed", "busy"].map(
			(state) => renderedOf(model, statePart("b1", state, "btn")).fill,
		);
		assert.equal(new Set(fills).size, 1, "one fill, shared by every state");
		assert.equal(fills[0], renderedOf(model, "inst(b1,btn)").fill);
	}
});

test("alternatives written inside a delta do branch, and pair coherently", async () => {
	// The one place a state may legitimately branch the space. `hover fill:
	// [danger, warning]` is a design decision like any other, and it branches like
	// any other — the branch came from a Value with two entries, not from the
	// state. Crossed with a two-alternative base, that is four designs.
	const scene = buttons({
		uses: [{ id: "b1" }],
		fill: [{ kind: "token", token: "accent" }],
		tokens: [
			{ id: "accent", name: "Accent", type: "color", value: [lit("#3b82f6"), lit("#0f172a")] },
		],
		machines: [
			machine({
				states: [
					{ id: "rest" },
					{ id: "hover", parts: { btn: { props: { fill: [lit("#ef4444"), lit("#f59e0b")] } } } },
				],
			}),
		],
	});
	const found = await run(scene);
	assert.equal(found.count, 4);

	const delta = statePropVar("b1", "hover", "btn", "fill");
	const pairs = new Set(
		found.universes.map((u) => `${u.pick[tokenVar("accent")]}/${u.pick[delta]}`),
	);
	assert.equal(pairs.size, 4, "all four combinations, each its own design");

	// And each really is a coherent pair rather than two independent readings of
	// one universe: the rest copy takes the token's colour and the hover copy
	// takes the delta's, in the same answer set.
	for (const model of await answers(scene)) {
		const rest = renderedOf(model, statePart("b1", "rest", "btn")).fill;
		const hover = renderedOf(model, statePart("b1", "hover", "btn")).fill;
		assert.ok(["#3b82f6", "#0f172a"].includes(rest));
		assert.ok(["#ef4444", "#f59e0b"].includes(hover));
		assert.equal(rest, renderedOf(model, "inst(b1,btn)").fill, "rest is what is drawn");
	}
});

test("no state is ever an alternative, in the program or in an answer", async () => {
	// Asserted as a scan rather than as a count, because a count can be right for
	// the wrong reason. A state must not appear as a variable *at all*: not in the
	// document's variable table, not as an alt/2 in the generated text, and not as
	// a pick/2 in any answer set.
	const scene = buttons({
		uses: [{ id: "b1" }, { id: "b2", state: "hover" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: { label: { props: { ink: single("#000000") } } } },
				],
				transitions: [edge({ id: "over", from: "rest", to: "hover" })],
			}),
		],
	});
	const { generated, variables } = compile(scene);

	assert.deepEqual(
		Object.keys(variables).filter((key) => key.includes("stt(")),
		[],
		"a state copy is never a variable",
	);
	assert.deepEqual(
		Object.keys(variableCounts(scene)).filter((key) => key.includes("stt(")),
		[],
		"and the studio is told the same",
	);
	assert.doesNotMatch(generated, /\balt\(stt\(/);
	assert.doesNotMatch(generated, /\bpick\(stt\(/);
	// Nor a choice rule over the states themselves, however spelled.
	for (const line of generated.split("\n")) {
		if (line.trimStart().startsWith("%")) continue;
		assert.ok(
			!(line.includes("{") && line.includes("mstate")),
			`no choice rule over states: ${line}`,
		);
	}
	for (const model of await answers(scene)) {
		assert.deepEqual(
			model.filter((atom) => atom.startsWith("pick(stt(")),
			[],
			"and none in the answer",
		);
	}
});

/* ------------------------------------------------------------------ */
/* The alias: what the instance actually is                            */
/* ------------------------------------------------------------------ */

test("the shown state is what the instance draws with", async () => {
	const states = [
		{ id: "rest" },
		{ id: "hover", parts: { label: { props: { ink: single("#ff0000") } } } },
	];
	const drawn = async (use: Use) => {
		const scene = buttons({ uses: [use], machines: [machine({ states })] });
		const found = await run(scene);
		return found.universes[0].model.byId[`inst(${use.id},label)`].rendered.ink;
	};
	assert.equal(await drawn({ id: "b1", state: "hover" }), "#ff0000");
	// No `state` at all is the initial one, which is the first in the list.
	assert.equal(await drawn({ id: "b1" }), "#ffffff");
	// And a state the machine has not got falls back rather than failing, exactly
	// as a dropped hold does.
	assert.equal(await drawn({ id: "b1", state: "gone" }), "#ffffff");
});

test("a property a state owns is drawn once, not twice", async () => {
	// The mshadow guard, tested as the thing it prevents. rendered/3 is a
	// *relation*: without the guard the instance's own variable and the shown
	// copy would both write the property, and two literals for one property is
	// not two designs — it is one arbitrary answer, silently.
	const scene = buttons({
		uses: [{ id: "b1", state: "hover" }, { id: "b2" }],
		machines: [
			machine({
				states: [
					{ id: "rest" },
					{ id: "hover", parts: { label: { props: { ink: single("#ff0000") } } } },
				],
			}),
		],
	});
	for (const model of await answers(scene)) {
		const seen = new Map<string, string>();
		for (const [node, prop, literal] of args(model, "rendered", 3)) {
			const key = `${node} ${prop}`;
			const had = seen.get(key);
			assert.ok(
				had === undefined || had === literal,
				`${key} draws with one literal, not ${had} and ${literal}`,
			);
			seen.set(key, literal);
		}
		// And the guard really is per property: the label still draws its size
		// from its own variable, which no state mentions.
		assert.equal(renderedOf(model, "inst(b1,label)").ink, "#ff0000");
		assert.equal(renderedOf(model, "inst(b1,label)").size, "14px");
		assert.equal(renderedOf(model, "inst(b2,label)").ink, "#ffffff");
	}
});

test("a state owns a dimension, not a part: the rest of the frame is the definition's", async () => {
	// mfshadow/3 is per dimension for exactly this reason. A state that moves a
	// badge leaves the badge's width where the definition put it, and if the guard
	// were per part the whole frame would fall back to the copy's own zeroes.
	const scene = buttons({
		uses: [{ id: "b1", state: "hover" }],
		machines: [
			machine({
				states: [
					{ id: "rest" },
					{ id: "hover", parts: { label: { frame: { x: dimension(px(40)) } } } },
				],
			}),
		],
	});
	const model = await only(scene);
	assert.deepEqual(frameOf(model, "inst(b1,label)"), {
		x: px(40),
		y: px(14),
		width: px(136),
		height: px(20),
	});
	// The rest copy is untouched, in the same answer set.
	assert.equal(frameOf(model, statePart("b1", "rest", "label")).x, px(12));
	assert.equal(frameOf(model, statePart("b1", "hover", "label")).x, px(40));
});

test("a state that hides a part takes its subtree out of the picture", async () => {
	const states = [
		{ id: "open" },
		{ id: "closed", parts: { panel: { hidden: true as const } } },
	];
	const shut = await run(
		buttons({ uses: [{ id: "b1", state: "closed" }], machines: [machine({ states })] }),
	);
	const byId = shut.universes[0].model.byId;
	assert.equal(byId["inst(b1,panel)"], undefined, "the panel is gone");
	assert.equal(byId["inst(b1,inner)"], undefined, "and so is what was inside it");
	assert.ok(byId["inst(b1,label)"], "and nothing else is");

	// The same document in the other state draws all of it — hiding is a state's
	// business and not the definition's.
	const open = await run(
		buttons({ uses: [{ id: "b1", state: "open" }], machines: [machine({ states })] }),
	);
	assert.ok(open.universes[0].model.byId["inst(b1,panel)"]);
	assert.ok(open.universes[0].model.byId["inst(b1,inner)"]);
});

test("two instances of one definition can be in different states at once", async () => {
	const scene = buttons({
		uses: [{ id: "b1" }, { id: "b2", state: "hover" }],
		machines: [
			machine({
				states: [
					{ id: "rest" },
					{ id: "hover", parts: { label: { props: { ink: single("#ff0000") } } } },
				],
			}),
		],
	});
	const model = await only(scene);
	assert.equal(renderedOf(model, "inst(b1,label)").ink, "#ffffff");
	assert.equal(renderedOf(model, "inst(b2,label)").ink, "#ff0000");
	// shown/2 is a fact per instance, so this is the document's answer rather than
	// something the solver chose.
	assert.deepEqual(
		args(model, "shown", 2).sort(),
		[["b1", "rest"], ["b2", "hover"]],
	);
});

/* ------------------------------------------------------------------ */
/* Every state at once, and rules over two of them                     */
/* ------------------------------------------------------------------ */

test("every state's copy is in the one answer set, with its own geometry", async () => {
	// The reason a state is a copy rather than a second solve. Two states in two
	// answer sets could not be compared by anything, and simplex would be free to
	// place the same node in two places in two independent runs.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(4) },
				],
			}),
		],
	});
	const model = await only(scene);
	assert.equal(frameOf(model, statePart("b1", "rest", "label")).y, px(14));
	assert.equal(frameOf(model, statePart("b1", "hover", "label")).y, px(4));
	// Both copies are parented into the instance's tree, which is what gives them
	// a world chain — the root's copy under the instance itself, the label's under
	// the instance's copy of the root — and neither is a node, which is what keeps
	// them off the canvas and out of the layer list.
	assert.deepEqual(
		args(model, "child", 2)
			.filter(([, child]) => child.startsWith("stt("))
			.map(([parent, child]) => `${parent} > ${child}`)
			.sort(),
		[
			`b1 > ${statePart("b1", "hover", "btn")}`,
			`b1 > ${statePart("b1", "rest", "btn")}`,
			`inst(b1,btn) > ${statePart("b1", "hover", "label")}`,
			`inst(b1,btn) > ${statePart("b1", "rest", "label")}`,
		],
	);
	assert.deepEqual(
		model.filter((atom) => atom.startsWith("node(stt(") || atom.startsWith("visible(stt(")),
		[],
		"a state copy is never drawable",
	);
});

test("a rule may align two states of one instance, and simplex places both", async () => {
	// "The label does not jump when you hover", as an ordinary align with two
	// unusual members. Nothing about the constraint machinery changed: c_node/2
	// takes a state copy exactly where it takes a node id, and gsolved/1 never
	// asked for node/1.
	const states = [
		{ id: "rest", parts: nudge(14) },
		{ id: "hover", parts: nudge(34) },
	];
	const loose = buttons({ uses: [{ id: "b1" }], machines: [machine({ states })] });
	const bare = await run(loose);
	// Nothing names them, so nothing places them: a copy the solver was not handed
	// sits exactly where the delta put it, twenty pixels apart.
	assert.equal(bare.universes[0].solved[statePart("b1", "rest", "label")], undefined);
	const bareAtoms = await only(loose);
	assert.equal(frameOf(bareAtoms, statePart("b1", "rest", "label")).y, px(14));
	assert.equal(frameOf(bareAtoms, statePart("b1", "hover", "label")).y, px(34));

	const held = buttons({
		uses: [{ id: "b1" }],
		machines: [machine({ states })],
		constraints: [
			rule(
				"no_jump",
				"align",
				[statePart("b1", "rest", "label"), statePart("b1", "hover", "label")],
				"centerY",
			),
		],
	});
	const found = await run(held);
	const solved = found.universes[0].solved;
	const restY = solved[statePart("b1", "rest", "label")]?.y;
	const hoverY = solved[statePart("b1", "hover", "label")]?.y;
	assert.ok(restY !== undefined && hoverY !== undefined, "both copies were placed");
	// Equal heights, so equal centres is equal offsets. *Where* the pair lands is
	// deliberately not asserted: the objective is the sum of two distances to 14
	// and to 34, which every point between them pays equally, so the answer is a
	// vertex of a segment rather than a midpoint. What the rule promises is that
	// the label does not jump, and that is the equality.
	assert.equal(restY, hoverY);
	assert.ok(restY >= px(14) && restY <= px(34), "and it landed between the two");
});

test("placing the shown state moves what is drawn, not only the copy", async () => {
	// The other half of the alias, and the half a rule cannot write. Placing a
	// copy answers in the theory — `__lpx(lv(stt(b1,rest,label),y),…)` — and an
	// ASP rule cannot read a theory atom and re-state it under `inst(b1,label)`,
	// so `frame(inst(I,N),D,V) :- frame(stt(I,S,N),D,V), shown(I,S)` carries the
	// stated geometry across and carries none of the solved geometry. readModel
	// finishes the alias, and without it the tool draws the label where the
	// definition put it while the answer set says the state it is drawn in moved
	// it — one state and two pictures, on the canvas and in the exported file.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(34) },
				],
			}),
		],
		constraints: [
			rule(
				"pin_rest",
				"pin",
				[statePart("b1", "rest", "label")],
				"top",
				dimension(px(200)),
			),
		],
	});
	const found = await run(scene);
	const universe = found.universes[0];
	assert.equal(universe.model.shown.b1, "rest");
	const copy = universe.model.states[statePart("b1", "rest", "label")];
	const drawn = universe.model.byId["inst(b1,label)"];
	assert.ok(copy && drawn, "the copy and the drawn part are both in the model");
	// The pin is on the world edge and the instance sits at y=20, so the copy's
	// own offset is 180 — asserted so that the equality below is an equality
	// between two moved things rather than between two unmoved ones.
	assert.equal(copy.frame.y, px(180));
	assert.deepEqual(drawn.frame, copy.frame);
	// And the state nobody placed is still where its own delta put it: the alias
	// is a view of the *shown* copy, not a merge of all of them.
	assert.equal(universe.model.states[statePart("b1", "hover", "label")].frame.y, px(34));
	// The document's own geometry is untouched — `Universe.solved` is the solver's
	// answer, verbatim, because everything that reads it reads it about document
	// nodes and an instance part is not one.
	assert.equal(universe.solved["inst(b1,label)"], undefined);
});

test("a cross-state rule that cannot hold lands in the core under its own name", async () => {
	// DEVIATION FROM THE SPEC, recorded here because it is the honest version of
	// the case. §11 asks for one align over two state copies to become UNSAT once
	// a delta moves the label. It cannot: naming a copy in a geometric constraint
	// is what hands it to simplex, so both copies are free and simplex simply
	// moves them together — which is the test above, and is what the rule *means*.
	// A single geometric rule over free members is never unsatisfiable, for state
	// copies exactly as for nodes; every UNSAT case in geometric.test.ts needs two.
	//
	// So this is the pair: "the label does not jump" and "the label drops twenty
	// pixels on hover" cannot both hold, and what matters is that a state copy
	// carries its rule into the core the same way a node does — with a name, a
	// switch, and an innocent third rule left unblamed.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(34) },
				],
			}),
		],
		constraints: [
			rule(
				"no_jump",
				"align",
				[statePart("b1", "rest", "label"), statePart("b1", "hover", "label")],
				"centerY",
			),
			rule(
				"drop_on_hover",
				"gap",
				[statePart("b1", "rest", "label"), statePart("b1", "hover", "label")],
				"y",
				dimension(px(20)),
			),
			rule("innocent", "align", ["inst(b1,label)", "inst(b1,panel)"], "left"),
		],
	});
	const error = await fails(scene);
	assert.deepEqual([...error.conflict].sort(), ["drop_on_hover", "no_jump"]);
});

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

test("a duration is a value: it follows a token, clamps a typo and falls back", async () => {
	const scene = buttons({
		uses: [{ id: "b1" }],
		tokens: [{ id: "brisk", name: "Brisk", type: "duration", value: [lit("0.12s")] }],
		machines: [
			machine({
				states: [{ id: "rest", parts: nudge(14) }, { id: "hover", parts: nudge(4) }],
				transitions: [
					edge({
						id: "over",
						from: "rest",
						to: "hover",
						duration: [{ kind: "token", token: "brisk" }],
					}),
					// A negative duration is not a fast transition, it is a typo.
					edge({
						id: "back",
						from: "hover",
						to: "rest",
						trigger: "pointerleave",
						duration: single("-50ms"),
						// A delay, by contrast, may be negative: it starts the move
						// partway through, which is a real thing to ask for.
						delay: single("-30ms"),
					}),
					// And one that names nothing at all, which takes the table's own
					// fallbacks through mdefdur/mdefdelay/mdefstagger.
					edge({ id: "press", from: "rest", to: "hover", trigger: "pointerdown" }),
				],
			}),
		],
	});
	const model = await only(scene);
	const table = (name: string) =>
		Object.fromEntries(
			args(model, name, 3).map(([, transition, ms]) => [transition, Number(ms)]),
		);
	assert.deepEqual(table("mdur"), { over: 120, back: 0, press: 200 });
	assert.deepEqual(table("mdelay"), { over: 0, back: -30, press: 0 });
	assert.deepEqual(table("mstagger"), { over: 0, back: 0, press: 0 });
	// The setting really is a variable, so a `duration` token drives every
	// transition wearing it — which is what makes a motion scale one document.
	assert.equal(compile(scene).variables[motionVar("m1", "over", "duration")], 1);
});

test("a motion scale is two designs, which is what the projection is for", async () => {
	// Motion is a design decision like a gap. A `duration` token with two
	// alternatives is one document holding both the brisk reading and the
	// considered one — and without `#project mdur/3` the two differ in nothing
	// that is projected, collapse into one universe, and the document silently
	// holds a pick nobody chose. Same argument as l_value/3, one axis over.
	const paced = (values: Value) =>
		buttons({
			uses: [{ id: "b1" }],
			tokens: [{ id: "pace", name: "Pace", type: "duration", value: values }],
			machines: [
				machine({
					states: [{ id: "rest", parts: nudge(14) }, { id: "hover", parts: nudge(4) }],
					transitions: [
						edge({
							id: "over",
							from: "rest",
							to: "hover",
							duration: [{ kind: "token", token: "pace" }],
						}),
					],
				}),
			],
		});
	assert.equal((await run(paced([lit("120ms"), lit("400ms")]))).count, 2);
	// The control, on the same shape: one alternative is one design, so the
	// projection is not simply multiplying every document with a machine in it.
	assert.equal((await run(paced([lit("120ms")]))).count, 1);
	// And the two designs really do differ in the duration rather than in
	// something incidental.
	const durations = new Set(
		(await answers(paced([lit("120ms"), lit("400ms")]))).map(
			(model) => args(model, "mdur", 3)[0]?.[2],
		),
	);
	assert.deepEqual([...durations].sort(), ["120", "400"]);
});

test("millis is the fourth bridge, and a bare number is not a duration", () => {
	// A literal has no type and the reader is chosen by what the value *is*. "200"
	// is a tally and no duration — ambiguous by a factor of a thousand, which CSS
	// refuses too — while "200ms" is a duration and neither a length nor a count.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: { label: { props: { text: single("200") } } } },
					{ id: "hover", parts: nudge(4) },
				],
				transitions: [
					edge({ id: "over", from: "rest", to: "hover", duration: single("200ms") }),
				],
			}),
		],
	});
	const { generated } = compile(scene);
	const table = new Map(
		[...generated.matchAll(/^literal\((l\d+),"([^"]*)"\)\.$/gm)].map((m) => [m[2], m[1]]),
	);
	const ms = table.get("200ms");
	const bare = table.get("200");
	assert.ok(ms && bare, "both texts are interned");
	assert.ok(generated.includes(`millis(${ms},200).`));
	assert.ok(!generated.includes(`tally(${ms},`));
	assert.ok(generated.includes(`tally(${bare},200).`));
	assert.ok(!generated.includes(`millis(${bare},`));
});

/* ------------------------------------------------------------------ */
/* What a document with no machine pays                                */
/* ------------------------------------------------------------------ */

test("a document with no machine states no machine fact at all", () => {
	// The rules are emitted always, like the geometry and component rules and for
	// the same reason: machine/1, mstate/2 and mpart/2 are things a hand-written
	// rule may assert. What must not appear is a single *fact* — with no facts,
	// none of it grounds, and the program is what it was before the feature but
	// for declarations, one negative literal and a rule section.
	const { generated } = compile(buttons({ uses: [{ id: "b1" }] }));
	assert.ok(!generated.includes("% ---- machines ----"), "no fact section");
	const facts = generated
		.split("\n")
		.filter((line) => !line.includes(":-"))
		.filter((line) =>
			/^(machine|machine_of|mstate|mindex|mpart|mhide|mtrans|mfrom|mto|mtrigger|measing|monly|shown|mshadow|mfshadow)\(/.test(
				line,
			),
		);
	assert.deepEqual(facts, [], "every machine predicate is a rule head or nothing");
	// The three motion fallbacks are the exception and are deliberate: they are
	// the table's own numbers, and a machine a *rule* brought into being needs
	// them as much as one the document holds.
	assert.ok(generated.includes("mdefdur(200)."));
	assert.ok(generated.includes("mdefdelay(0)."));
	assert.ok(generated.includes("mdefstagger(0)."));
	// And nothing in the document's variable table.
	assert.deepEqual(
		Object.keys(compile(buttons({ uses: [{ id: "b1" }] })).variables).filter(
			(key) => key.startsWith("sprop(") || key.startsWith("sfval(") || key.startsWith("mval("),
		),
		[],
	);
});

test("the machine section grounds without a word, machine or no machine", async () => {
	// The diagnostics panel is a real channel and the section adds twenty-odd
	// predicates to a program that may hold none of them — a `#show` of a
	// signature nothing grounds, or a body atom no rule heads, is an info message
	// on every document in the tool, about a predicate the reader never wrote.
	// That is the noise the `#defined` block exists to prevent, and this is where
	// it is checked rather than assumed.
	const withOne = buttons({
		uses: [{ id: "b1", state: "hover" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: { label: { props: { ink: single("#000000") } } } },
				],
				transitions: [edge({ id: "over", from: "rest", to: "hover", duration: single("120ms") })],
			}),
		],
	});
	assert.equal((await run(withOne)).diagnostics, "");
	assert.equal((await run(buttons({ uses: [{ id: "b1" }] }))).diagnostics, "");
});

test("the frame an instance inherits is unchanged by the rename to mbase", async () => {
	// The one rewrite the feature makes to a rule that was already there: two
	// COMPONENT_RULES lines lost their head to mbase/4, and one rule in the
	// machine section puts the atoms back. On a document with no machine that has
	// to be invisible, which is what this holds.
	const model = await only(buttons({ uses: [{ id: "b1" }] }));
	assert.deepEqual(frameOf(model, "inst(b1,label)"), {
		x: px(12),
		y: px(14),
		width: px(136),
		height: px(20),
	});
	// The root copy still takes the instance's own size and sits at its origin.
	assert.deepEqual(frameOf(model, "inst(b1,btn)"), {
		x: 0,
		y: 0,
		width: px(160),
		height: px(48),
	});
});

test("two machines on one root: one drives it, the other only describes itself", async () => {
	// `normalizeScene` dedupes machine *ids* and not roots, so an import or a merge
	// of two documents reaches this and nothing upstream stops it. Every reader in
	// the tool answers `machineForRoot` — the first machine naming that root — and
	// `machine_of/2` is the one line in the program that has to agree with them.
	// Without that agreement both machines' `minstance/2` derive, so the second
	// mints a full set of copies nothing draws, shadows, aliases or shows.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				id: "m1",
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(4) },
				],
			}),
			machine({
				id: "m2",
				states: [
					{ id: "open", parts: { label: { props: { ink: single("#ff0000") } } } },
					{ id: "closed", parts: {} },
				],
				transitions: [edge({ id: "shut", from: "open", to: "closed" })],
			}),
		],
	});
	// Both machines are in the *program* as records — the facts themselves are not
	// projected, so this is the generated text rather than the answer set — because
	// a panel shows the second and a rule may name one of its states.
	const { generated } = compile(scene);
	assert.ok(generated.includes("machine(m1).") && generated.includes("machine(m2)."));
	assert.ok(generated.includes("mstate(m2,open).") && generated.includes("mpart(m2,label)."));
	// Only one of them drives the definition, so only one of them has copies.
	assert.ok(generated.includes("machine_of(m1,btn)."));
	assert.ok(!generated.includes("machine_of(m2,"), "the shadowed machine drives nothing");
	const model = await only(scene);
	// Its health is still derived and still shown: m2's `closed` leaves nothing, and
	// saying so is the whole reason the record stays in the program.
	assert.ok(
		args(model, "mdeadend", 2).some(([m, s]) => m === "m2" && s === "closed"),
		"a machine that drives nothing is still checked",
	);
	const copyStates = new Set(
		args(model, "frame", 3)
			.map(([term]) => term)
			.filter((term) => term.startsWith("stt("))
			.map((term) => term.split(",")[1]),
	);
	assert.deepEqual([...copyStates].sort(), ["hover", "rest"]);
	assert.deepEqual(
		model.filter((atom) => atom.includes("stt(b1,open,") || atom.includes("stt(b1,closed,")),
		[],
		"the shadowed machine mints no copy at all",
	);
	// And one shown state, which is the thing the ghost copies would have broken:
	// with both machines driving, the default rule says shown/2 for each one's
	// initial state on any instance a rule minted, which is two pictures.
	assert.deepEqual(args(model, "shown", 2), [["b1", "rest"]]);
	assert.deepEqual(args(model, "mtwoshown", 1), []);
});

/* ------------------------------------------------------------------ */
/* Pathologies a rule can write and the document cannot                */
/* ------------------------------------------------------------------ */

test("two shown states for one instance is reported rather than drawn", async () => {
	// Nothing the document can write does this — shown/2 is one fact per instance
	// — but a rule can, and an instance in two states is not an instance in two
	// states: it is two pictures on top of each other. So it is derived and shown,
	// and a rule of the designer's own can forbid it by name.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(4) },
				],
			}),
		],
		rules: "shown(b1,hover).",
	});
	const model = (await answers(scene))[0];
	assert.deepEqual(args(model, "mtwoshown", 1), [["b1"]]);
	// And the control: without the rule there is one shown state and no report.
	const clean = (await answers({ ...scene, rules: "" }))[0];
	assert.deepEqual(args(clean, "mtwoshown", 1), []);
});

test("what is wrong with a machine is derived, and named", async () => {
	// All four checks land in the answer set rather than being enforced, so that a
	// `custom` rule of the designer's own is what turns any of them into a
	// violation — with a switch, a name in the core and a `why` for free.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: nudge(4) },
					{ id: "orphan", parts: nudge(8) },
				],
				transitions: [
					edge({ id: "over", from: "rest", to: "hover" }),
					// Two edges out of `rest` on one trigger, which is a machine that
					// cannot say where a pointer takes it.
					edge({ id: "also", from: "rest", to: "orphan" }),
					// ...but `also` is switched off, so it is out of the program: that
					// is what leaves `orphan` unreached and makes `rest` deterministic.
					edge({ id: "nowhere", from: "hover", to: "missing", trigger: "click" }),
				].map((t) => (t.id === "also" ? { ...t, enabled: false } : t)),
			}),
		],
	});
	const model = (await answers(scene))[0];
	assert.deepEqual(args(model, "munreached", 2), [["m1", "orphan"]]);
	assert.deepEqual(args(model, "mdeadend", 2).map(([, s]) => s).sort(), ["orphan"]);
	assert.deepEqual(args(model, "mnondet", 3), [], "a switched-off edge is not an edge");
	assert.deepEqual(args(model, "mdangling", 2), [["m1", "nowhere"]]);
	// A hidden part is reported per copy, so a panel can grey the state that hides
	// it without asking a second question.
	assert.deepEqual(args(model, "mhidden", 3), []);
});

test("a hidden part is reported per state copy, not only per state", async () => {
	const scene = buttons({
		uses: [{ id: "b1" }, { id: "b2" }],
		machines: [
			machine({
				states: [
					{ id: "open" },
					{ id: "closed", parts: { panel: { hidden: true as const } } },
				],
			}),
		],
	});
	const model = await only(scene);
	assert.deepEqual(
		args(model, "mhidden", 3).sort(),
		[["b1", "closed", "panel"], ["b2", "closed", "panel"]],
	);
});

/* ------------------------------------------------------------------ */
/* The grounding budget                                                */
/* ------------------------------------------------------------------ */

/** A definition `p1 > p2 > … > p8`, with a delta on the deepest leaf. */
function tower(states: number): Scene {
	const depth = 8;
	let node: SceneNode | undefined;
	for (let level = depth; level >= 1; level--) {
		const child = node;
		node = {
			...makeNode("frame", { x: px(4), y: px(4), width: px(200), height: px(200) }, {
				id: `p${level}`,
				name: `P${level}`,
			}),
			props: { fill: single("#ffffff") },
			...(child ? { children: [child] } : {}),
			...(level === 1 ? { component: true } : {}),
		};
	}
	const root = node as SceneNode;
	return {
		styles: [],
		tokens: [],
		constraints: [],
		rules: "",
		machines: [
			{
				id: "m1",
				name: "Deep",
				root: "p1",
				states: Array.from({ length: states }, (_, i) => ({
					id: `s${i + 1}`,
					name: `S${i + 1}`,
					parts: { [`p${depth}`]: { frame: { x: dimension(px(i * 4)) } } },
				})),
				transitions: [],
			},
		],
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(900), height: px(600) }, {
					id: "page",
					name: "Page",
				}),
				children: [
					root,
					{
						...makeNode("instance", { x: px(400), y: 0, width: px(200), height: px(200) }, {
							id: "u1",
						}),
						instanceOf: "p1",
					},
					{
						...makeNode("instance", { x: px(650), y: 0, width: px(200), height: px(200) }, {
							id: "u2",
						}),
						instanceOf: "p1",
					},
				],
			},
		],
	};
}

test("a delta on the deepest leaf costs its ancestors and nothing else", async () => {
	// The materialisation analysis, measured rather than asserted about. Upward
	// only: the leaf's ancestors are links in the world chain child/2 climbs, and
	// stopping short would place the copy in the instance's coordinates. Downward
	// is free — there is nothing below p8 here, so the sibling-free tower is the
	// pure form of the count.
	const scene = tower(3);
	const { generated } = compile(scene);
	const parts = [...generated.matchAll(/^mpart\(m1,(p\d)\)\.$/gm)].map((m) => m[1]);
	assert.deepEqual(parts, ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);

	const model = await only(scene);
	const copies = new Set(
		args(model, "frame", 3)
			.map(([term]) => term)
			.filter((term) => term.startsWith("stt(")),
	);
	// Three states, eight parts, two instances — and not one atom more.
	assert.equal(copies.size, 3 * 8 * 2);
	for (const use of ["u1", "u2"]) {
		for (const state of ["s1", "s2", "s3"]) {
			for (let level = 1; level <= 8; level++) {
				assert.ok(copies.has(statePart(use, state, `p${level}`)));
			}
		}
	}
	// And the delta's own variables are one per state per instance, on the one
	// part that holds one — never on the seven ancestors it dragged in.
	assert.deepEqual(
		Object.keys(compile(scene).variables).filter((key) => key.startsWith("sfval(")).sort(),
		["u1", "u2"]
			.flatMap((use) =>
				["s1", "s2", "s3"].map((state) => stateFrameVar(use, state, "p8", "x")),
			)
			.sort(),
	);
});

test("a machine whose states say nothing materialises nothing", async () => {
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [machine({ states: [{ id: "rest" }, { id: "hover", parts: { label: {} } }] })],
	});
	const { generated } = compile(scene);
	assert.doesNotMatch(generated, /^mpart\(/m, "legal, useless, and free");
	const model = await only(scene);
	assert.deepEqual(
		args(model, "frame", 3).filter(([term]) => term.startsWith("stt(")),
		[],
	);
	// The instance is still in a state, though, which is what lets a delta appear
	// later without anything else changing.
	assert.deepEqual(args(model, "shown", 2), [["b1", "rest"]]);
});

/* ------------------------------------------------------------------ */
/* The studio's reading of the same document                           */
/* ------------------------------------------------------------------ */

test("a delta field and a motion setting are rows like any other row", () => {
	// variableCounts is what keeps a pin alive across an edit and what the "this
	// varies" mark is drawn from, so it has to hold exactly what the compiler
	// mints — no more, and above all no entry for a state.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest", parts: nudge(14) },
					{ id: "hover", parts: { label: { props: { ink: [lit("#000"), lit("#fff")] } } } },
				],
				transitions: [
					edge({ id: "over", from: "rest", to: "hover", duration: single("120ms") }),
					edge({ id: "off", from: "hover", to: "rest", enabled: false, duration: single("9s") }),
				],
			}),
		],
	});
	const counts = variableCounts(scene);
	assert.equal(counts[stateFrameVar("b1", "rest", "label", "y")], 1);
	assert.equal(counts[statePropVar("b1", "hover", "label", "ink")], 2);
	assert.equal(counts[motionVar("m1", "over", "duration")], 1);
	assert.equal(counts[motionVar("m1", "off", "duration")], undefined, "switched off");
	assert.equal(counts[motionVar("m1", "over", "delay")], undefined, "said nothing");
	// The document's own table and the compiler's agree, which is the property
	// that makes a pin survive.
	const { variables } = compile(scene);
	for (const [key, count] of Object.entries(counts)) {
		if (!key.startsWith("sprop(") && !key.startsWith("sfval(") && !key.startsWith("mval(")) continue;
		assert.equal(variables[key], count, key);
	}
	for (const key of Object.keys(variables)) {
		if (!key.startsWith("sprop(") && !key.startsWith("sfval(") && !key.startsWith("mval(")) continue;
		assert.equal(counts[key], variables[key], key);
	}
});
