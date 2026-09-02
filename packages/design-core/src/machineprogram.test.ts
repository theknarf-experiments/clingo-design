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
import {
	CONTRACT,
	PULL_ATOM,
	SCENERY_ATOM,
	compile,
	unreadVariables,
	variableCounts,
} from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { addCustomConstraint, makeNode } from "./edits.ts";
import { UnsatisfiableError, explore } from "./explore.ts";
import {
	LADDER_CHECKS,
	MACHINE_CHECKS,
	keyCopy,
	statePart,
	stateFrameVar,
	statePropVar,
	trackDim,
	trackProp,
} from "./machines.ts";
import { type Measurements, oneSize, stateMeasures } from "./measure.ts";
import { readModel } from "./model.ts";
import type {
	Blend,
	Constraint,
	Keyframe,
	Machine,
	MachineInput,
	MachineLayer,
	MachineState,
	Scene,
	SceneNode,
	StatePart,
	Timeline,
	TimelineClock,
	Transition,
	Trigger,
} from "./scene.ts";
import { dimension } from "./scene.ts";
import { TEMPLATES } from "./templates/index.ts";
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
	states: Array<{
		id: string;
		name?: string;
		parts?: Record<string, StatePart>;
		/**
		 * The three fields the ladder added to a state, threaded through the same
		 * builder rather than a second one — a state with a layer is a state, and a
		 * builder that split them would let a test assert something about a layered
		 * machine that is not true of the machine beside it.
		 */
		layer?: string;
		timeline?: string;
		/**
		 * ...and the fourth, added with the gestures. Threaded through the same
		 * builder for the same reason: a state with a clock is a state, and a
		 * builder that split them would let a test assert something about a
		 * scroll-driven machine that is not true of the machine beside it.
		 */
		clock?: TimelineClock;
		blend?: Blend;
	}>;
	transitions?: Transition[];
	inputs?: MachineInput[];
	layers?: MachineLayer[];
	timelines?: Timeline[];
}): Machine => ({
	id: spec.id ?? "m1",
	name: "Button states",
	root: spec.root ?? "btn",
	states: spec.states.map(
		(state): MachineState => ({
			id: state.id,
			name: state.name ?? state.id,
			parts: state.parts ?? {},
			...(state.layer ? { layer: state.layer } : {}),
			...(state.timeline ? { timeline: state.timeline } : {}),
			...(state.clock ? { clock: state.clock } : {}),
			...(state.blend ? { blend: state.blend } : {}),
		}),
	),
	transitions: spec.transitions ?? [],
	...(spec.inputs ? { inputs: spec.inputs } : {}),
	...(spec.layers ? { layers: spec.layers } : {}),
	...(spec.timelines ? { timelines: spec.timelines } : {}),
});

/** One keyframe, spelled the way a track holds one. */
const key = (at: string, value: string): Keyframe => ({
	at: [lit(at)],
	value: [lit(value)],
});

/** One use of the definition, and what the document remembers about it. */
interface Use {
	id: string;
	/** Which state it is drawn in — {@link SceneNode.state}. */
	state?: string;
	/**
	 * Which state it is drawn in **per layer** — {@link SceneNode.states}, the
	 * field rung four added beside `state` rather than in place of it, so a
	 * document written before layers existed still reads.
	 */
	states?: Record<string, string>;
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
						...(use.states ? { states: use.states } : {}),
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
async function answers(
	scene: Scene,
	measurements?: Measurements,
): Promise<string[][]> {
	const { program, guards } = compile(scene, { measurements });
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
async function only(scene: Scene, measurements?: Measurements): Promise<string[]> {
	const models = await answers(scene, measurements);
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

/* ------------------------------------------------------------------ */
/* The shape of a move                                                  */
/* ------------------------------------------------------------------ */

/**
 * A machine whose one edge is paced by whatever curve the caller hands it.
 *
 * The curve is a {@link Value}, so the argument may be a literal, a token
 * reference, or two of either — which is the whole point of the rung and is what
 * every assertion below varies.
 */
const curved = (easing: Value, tokenValue?: Value): Scene =>
	buttons({
		uses: [{ id: "b1" }],
		...(tokenValue
			? { tokens: [{ id: "feel", name: "Feel", type: "easing", value: tokenValue }] }
			: {}),
		machines: [
			machine({
				states: [{ id: "rest", parts: nudge(14) }, { id: "hover", parts: nudge(4) }],
				transitions: [
					edge({ id: "over", from: "rest", to: "hover", easing }),
					edge({ id: "back", from: "hover", to: "rest", trigger: "pointerleave" }),
				],
			}),
		],
	});

test("an easing is a value: it follows a token, refuses a word the menu has not got, and falls back", async () => {
	// The three ways a curve can be said, in one document, because they are one
	// rule and its two fallbacks: a token the solver resolved, a word `measeopt/1`
	// does not know, and nothing at all. All three of the last two land on
	// `mdefease`, which is the same answer `curveOf` gives on the TypeScript side
	// — a fallback only one reader takes is drift with a fig leaf on it.
	const scene = buttons({
		uses: [{ id: "b1" }],
		tokens: [
			{ id: "feel", name: "Feel", type: "easing", value: single("springSnappy") },
		],
		machines: [
			machine({
				states: [{ id: "rest", parts: nudge(14) }, { id: "hover", parts: nudge(4) }],
				transitions: [
					edge({
						id: "over",
						from: "rest",
						to: "hover",
						easing: [{ kind: "token", token: "feel" }],
					}),
					edge({
						id: "back",
						from: "hover",
						to: "rest",
						trigger: "pointerleave",
						easing: single("wobble"),
					}),
					edge({ id: "press", from: "rest", to: "hover", trigger: "pointerdown" }),
				],
			}),
		],
	});
	const model = await only(scene);
	assert.deepEqual(
		Object.fromEntries(args(model, "measing", 3).map(([, t, curve]) => [t, curve])),
		{ over: "springSnappy", back: "easeOut", press: "easeOut" },
	);
	// The setting really is a variable, so a `curve` token drives every transition
	// wearing it — which is what makes a feel one decision.
	assert.equal(compile(scene).variables[motionVar("m1", "over", "easing")], 1);
	// And a transition that said nothing mints nothing: the guard in
	// `machineValues` is on `easing.length > 0`, exactly as it is on `exit`.
	assert.equal(compile(scene).variables[motionVar("m1", "press", "easing")], undefined);
});

test("a curve token with two alternatives is two designs", async () => {
	// **The projection test.** A feel is a design decision like a motion scale: a
	// `curve` token holding the crisp reading and the playful one is one document
	// holding both. Without `#project measing/3.` the two answer sets are
	// identical in every other projected atom — the pictures are the same still
	// frame — clingo collapses them into one, and the studio shows a single design
	// for a document that plainly holds two, with an arbitrary pick nobody chose.
	// That is the asset/2 failure of 546eb02 arriving one predicate over, and this
	// assertion is what fails loudly if the line is ever deleted.
	const token = [{ kind: "token" as const, token: "feel" }];
	assert.equal(
		(await run(curved(token, [lit("easeOut"), lit("springSnappy")]))).count,
		2,
	);
	// The control, on the same shape: one alternative is one design, so the
	// projection is not simply multiplying every document that has a machine.
	assert.equal((await run(curved(token, single("easeOut")))).count, 1);
	// And the two really do differ in the curve rather than in something
	// incidental.
	const curves = new Set(
		(await answers(curved(token, [lit("easeOut"), lit("springSnappy")]))).map(
			(model) => args(model, "measing", 3).find(([, t]) => t === "over")?.[2],
		),
	);
	assert.deepEqual([...curves].sort(), ["easeOut", "springSnappy"]);
});

test("springs add no universes", async () => {
	// Three fixed members of a menu and no parameters, which is the decision the
	// whole feature turns on: a parameterised spring would be three Values, and
	// two of them holding two alternatives each is four universes differing in
	// nothing a still frame can show. So a spring is a word where `easeOut` is a
	// word, and swapping one for the other changes the curve and nothing else.
	const plain = await run(curved(single("easeOut")));
	const sprung = await run(curved(single("springBouncy")));
	assert.equal(plain.count, sprung.count);
	assert.equal(plain.count, 1);
	// One grain finer: the two documents' atoms differ in the `measing` rows and
	// in the interned text of the word itself, and in nothing else at all. The
	// second exclusion is the point rather than a concession — a curve is a
	// literal like any other, so it is `alt_literal/3` and `literal/2` and no new
	// machinery, which is the same shape a fill has.
	const without = (atoms: readonly string[], curve: string) =>
		atoms.filter((a) => !a.startsWith("measing(") && !a.includes(`"${curve}"`)).sort();
	assert.deepEqual(
		without(await only(curved(single("springBouncy"))), "springBouncy"),
		without(await only(curved(single("easeOut"))), "easeOut"),
	);
});

test("a custom bezier reaches the program as a term and never as a word", async () => {
	// The dialect exists so a rule can name a curve. `cubicBezier(200,0,0,1000)`
	// is a lowerCamel functor with four integer arguments, so
	// `viol(system_curves) :- measing(_,_,cubicBezier(_,_,_,_))` grounds; CSS's own
	// `cubic-bezier(0.2, 0, 0, 1)` is a minus sign and three non-integers and
	// could only ever have reached the program as a quoted string, about which no
	// rule can say anything.
	const scene = curved(single("cubicBezier(200,0,0,1000)"));
	const model = await only(scene);
	assert.ok(
		model.includes("measing(m1,over,cubicBezier(200,0,0,1000))"),
		"the curve is a term in the answer set",
	);
	// And it is a term rather than a word: `word/2` is the *menu* bridge, and a
	// bezier that reached it would match `measeopt(E)` against nothing and derive
	// nothing, which is the same failure written the other way round.
	assert.deepEqual(
		args(model, "measing", 3).filter(([, t]) => t === "over")[0],
		["m1", "over", "cubicBezier(200,0,0,1000)"],
	);
	// The seventh bridge, present for that literal and for no other.
	const { generated } = compile(scene);
	const beziers = [...generated.matchAll(/^bezier\((l\d+),([^)]*)\)\.$/gm)];
	assert.equal(beziers.length, 1);
	assert.equal(beziers[0][2], "200,0,0,1000");
	// A rule really can name it, which is the whole reason for the spelling and
	// is the assertion the dialect exists to make true. "Every transition uses a
	// curve from the system" is one line in the Rules panel; with a bespoke curve
	// in the document it fires, and the document has no design at all — blamed by
	// name, which is what a term buys and a quoted string could never have.
	const guarded = addCustomConstraint(scene, "system_curves");
	const error = await fails({
		...guarded.scene,
		rules: "viol(system_curves) :- measing(_,_,cubicBezier(_,_,_,_)).",
	});
	assert.deepEqual(error.conflict, ["system_curves"]);
	// And the same rule over the same document with a menu word in it is silent,
	// which is the half that says the rule is about the curve rather than about
	// machines in general.
	assert.equal(
		(
			await run({
				...addCustomConstraint(curved(single("easeOut")), "system_curves").scene,
				rules: "viol(system_curves) :- measing(_,_,cubicBezier(_,_,_,_)).",
			})
		).count,
		1,
	);
});

test("the seventh bridge costs a document with no curve in it nothing", () => {
	// Zero facts in every document written before this rung, which is nearly all
	// of them. The bridge is emitted per literal that admits it, like the other
	// six, so the price of the feature for a document that holds no bespoke curve
	// is the `#defined` line and nothing else.
	const { generated } = compile(buttons({ uses: [{ id: "b1" }] }));
	assert.ok(!/^bezier\(/m.test(generated), "no bezier fact anywhere");
	assert.ok(generated.includes("#defined bezier/5."));
	// And the menu itself, which *is* emitted always — beside `mdefdur` and for
	// its reason: a hand-written rule may assert `mtrans/2`, and a transition with
	// no curve at all is a transition nothing shapes.
	assert.ok(generated.includes("mdefease(easeOut)."));
	assert.ok(generated.includes("measeopt(springBouncy)."));
});

test("a keyframe's curve is a value and is projected", async () => {
	// The same claim one grain finer, over `mkeasing/5`, which stopped being a
	// fact this repository wrote and became a thing the program derives. An
	// overshoot that eases in one universe and springs in the other is two
	// animations, and without `#project mkeasing/5.` they differ in nothing
	// projected — `#project mkat/5.` is already there for the same keyframe's
	// *time*, and this belongs beside it.
	const sprung = (easing: Value, tokenValue?: Value): Scene =>
		buttons({
			uses: [{ id: "b1" }],
			...(tokenValue
				? { tokens: [{ id: "feel", name: "Feel", type: "easing", value: tokenValue }] }
				: {}),
			machines: [
				machine({
					states: [{ id: "rest", timeline: "open", parts: {} }],
					timelines: [
						{
							id: "open",
							name: "Open",
							tracks: [
								{
									part: "label",
									dim: "y",
									keys: [
										{ ...key("0ms", "14px"), easing },
										key("200ms", "4px"),
									],
								},
							],
						},
					],
				}),
			],
		});
	const token = [{ kind: "token" as const, token: "feel" }];
	assert.equal(
		(await run(sprung(token, [lit("easeIn"), lit("springBouncy")]))).count,
		2,
	);
	assert.equal((await run(sprung(token, single("easeIn")))).count, 1);
	// The keyframe that says nothing takes `mdefease`, which is the rule that
	// replaced the fact the emitter used to write for every key.
	const model = await only(sprung(single("cubicBezier(340,1560,640,1000)")));
	const curves = Object.fromEntries(
		args(model, "mkeasing", 5).map(([, , , index, curve]) => [index, curve]),
	);
	assert.deepEqual(curves, {
		"1": "cubicBezier(340,1560,640,1000)",
		"2": "easeOut",
	});
});

test("a curve token every transition points at is read, not greyed", () => {
	// `unreadVariables` is what greys a token's alternatives in the panel, and it
	// works by walking everything that *reads* a value. A `curve` token every
	// transition in the document points at is the most-read thing in it, and
	// leaving `transition.easing` out of that walk would report it unread and grey
	// its alternatives on the strength of a projection artefact — which is exactly
	// the failure the comment beside `transition.exit` describes, one setting over.
	const token = [{ kind: "token" as const, token: "feel" }];
	const scene = curved(token, [lit("easeOut"), lit("springSnappy")]);
	assert.equal(unreadVariables(scene).has(tokenVar("feel")), false);
	// The control: a token nothing points at *is* unread, so the walk is looking
	// at the field rather than at the presence of a machine.
	const spare = {
		...scene,
		machines: [{ ...scene.machines[0], transitions: scene.machines[0].transitions.map((t) => {
			const { easing: _easing, ...rest } = t;
			return rest;
		}) }],
	};
	assert.ok(unreadVariables(spare).has(tokenVar("feel")));
	// And the same over a keyframe's curve, which is the other field the walk
	// gained in the same commit.
	const keyed = buttons({
		uses: [{ id: "b1" }],
		tokens: [{ id: "feel", name: "Feel", type: "easing", value: [lit("easeOut"), lit("easeIn")] }],
		machines: [
			machine({
				states: [{ id: "rest", timeline: "open", parts: {} }],
				timelines: [
					{
						id: "open",
						name: "Open",
						tracks: [
							{
								part: "label",
								dim: "y",
								keys: [{ ...key("0ms", "14px"), easing: token }, key("200ms", "4px")],
							},
						],
					},
				],
			}),
		],
	});
	assert.equal(unreadVariables(keyed).has(tokenVar("feel")), false);
});

test("the two projections split no template", async () => {
	// **The §6.5 gate, and it outranks the feature.** A finer projection can only
	// ever *split* answer sets, never merge them — so the risk was never that this
	// stops working, it is that a template's universe count moves and a test that
	// has asserted a number since the machine model shipped starts failing for a
	// reason that looks like a bug.
	//
	// It does not move, and the reason is a fact about today's templates rather
	// than a property of the encoding: every easing in every template is a bare
	// word, which migrates to a one-alternative Value, so every one of those
	// variables has exactly one alternative and the finer partition partitions
	// nothing differently. Checked here rather than believed, by solving each
	// template twice — once as it compiles, and once with the two lines cut out —
	// because if a count ever does move, the projections come out and become their
	// own step with their own golden update.
	for (const template of TEMPLATES) {
		const scene = template.create();
		const { program, guards } = compile(scene);
		// A template with no transition and no keyframe is settled without a solve
		// and is settled *harder*: `measing/3` and `mkeasing/5` are derived from
		// `mtrans/2` and `mkey/4`, so with neither fact in the program both
		// predicates are empty and a projection over an empty predicate partitions
		// nothing. Thirteen of the fifteen templates are in this case, and solving
		// each of them twice to find that out would be four minutes of clingo
		// saying so the long way.
		const facts = (name: string) =>
			program.split("\n").some((line) => line.startsWith(`${name}(`) && !line.includes(":-"));
		if (!facts("mtrans") && !facts("mkey")) {
			assert.ok(!facts("measing"), `${template.id}`);
			assert.ok(!facts("mkeasing"), `${template.id}`);
			continue;
		}
		const counts: number[] = [];
		for (const text of [program, program.replaceAll(/^#project m(easing\/3|keasing\/5)\.$/gm, "")]) {
			const session = await directSolver.open(text, "--project");
			try {
				const outcome = await session.solve({
					models: 0,
					assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
				});
				counts.push(outcome.models.length);
			} finally {
				await session.close();
			}
		}
		assert.equal(
			counts[0],
			counts[1],
			`${template.id}: the two #project lines split it into ${counts[0]} where it had ${counts[1]}`,
		);
	}
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

/* ------------------------------------------------------------------ */
/* A copy is measured in its own state's typography                    */
/* ------------------------------------------------------------------ */

/**
 * The label, reworded by one state and left alone by the other.
 *
 * Long enough that the wrong answer is unmistakable: the definition draws the
 * label 136 px wide, and a host measuring these words comes back with 300.
 */
const reword = (text: string): Record<string, StatePart> => ({
	label: { props: { text: single(text) } },
});

test("a state that rewords a hugging part is measured in its own type", async () => {
	// Before this was wired, `stateMeasures` computed the table and the compiler
	// threw it away: the copy took `mbase/4`, so the words grew and the box they
	// sit in did not. The whole pass is three pieces that have to agree — the
	// analysis here, a host with a canvas, and `emitStateAsked` — so the test
	// names all three by using the first to key the second and reading the third.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest" },
					{ id: "hover", parts: reword("Go somewhere far away") },
				],
			}),
		],
	});
	const hover = statePart("b1", "hover", "label");
	assert.deepEqual(
		stateMeasures(scene).map((m) => m.id),
		[hover],
		"only the state that changes the type is worth measuring",
	);
	// What the host hands back, keyed by the copy's own term.
	const measured: Measurements = {
		label: oneSize({ width: px(30), height: px(20) }),
		[hover]: oneSize({ width: px(300), height: px(20) }),
	};
	const atoms = await only(scene, measured);
	assert.equal(frameOf(atoms, hover).width, px(300), "the copy hugs its own words");
	assert.equal(
		frameOf(atoms, statePart("b1", "rest", "label")).width,
		px(136),
		"a state that changes no type is the definition's box, not the other state's",
	);
	// And the invariant is untouched by any of it: a measurement is a fact about
	// a copy, never an alternative to choose between.
	assert.deepEqual(
		atoms.filter((atom) => atom.startsWith("pick(stt(") || atom.startsWith("alt(stt(")),
		[],
	);
});

test("a width the state states beats the words it would otherwise hug", async () => {
	// The three sources in their order: a delta the designer typed, then the
	// measurement, then the definition's box. A hover that says "be 200 wide" is
	// an instruction and is not overruled by what the words happen to come to.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest" },
					{
						id: "hover",
						parts: {
							label: {
								props: { text: single("Go somewhere far away") },
								frame: { width: dimension(px(200)) },
							},
						},
					},
				],
			}),
		],
	});
	const hover = statePart("b1", "hover", "label");
	const atoms = await only(scene, {
		[hover]: oneSize({ width: px(300), height: px(20) }),
	});
	assert.equal(frameOf(atoms, hover).width, px(200));
	// The height said nothing, so that dimension is still the measurement's —
	// the guard is per dimension, like every other guard in this section.
	assert.equal(frameOf(atoms, hover).height, px(20));
});

test("a copy nobody measured is the box the definition was drawn at", async () => {
	// The first render happens before anything has been measured and a headless
	// solve has no canvas at all, so this is the ordinary case rather than the
	// degenerate one — and it has to be exactly what a machine did before the
	// measurement pass existed.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [{ id: "rest" }, { id: "hover", parts: reword("Go somewhere far away") }],
			}),
		],
	});
	const atoms = await only(scene);
	assert.equal(frameOf(atoms, statePart("b1", "hover", "label")).width, px(136));
	assert.equal(frameOf(atoms, statePart("b1", "rest", "label")).width, px(136));
});

/* ------------------------------------------------------------------ */
/* The ladder: inputs, guards, reserved ids, layers, timelines, blends */
/* ------------------------------------------------------------------ */

/**
 * The one answer set of a document, with extra predicates asked for by name.
 *
 * Most of the ladder is deliberately carried by no atom: `minput/2` and its five
 * companions are shown by nothing and projected by nothing, because an input is
 * a fact the document already holds and a panel reads it from the document. That
 * is the right shipping decision and it makes the rungs untestable through
 * {@link answers}, so the `#show` is added **here**, in the test, rather than in
 * the program — the same way `spatialprogram.test.ts` asks about `s3/1`. A test
 * that had to ship a `#show` to be able to run would be a test that changed the
 * thing it was measuring.
 */
async function asked(
	scene: Scene,
	signatures: readonly string[],
	measurements?: Measurements,
): Promise<string[]> {
	const { program, guards } = compile(scene, { measurements });
	const shows = signatures
		.map((signature) => {
			const [name, arity] = signature.split("/");
			const vars = Array.from({ length: Number(arity) }, (_, i) => `X${i}`).join(",");
			return `#show ${name}(${vars}) : ${name}(${vars}).`;
		})
		.join("\n");
	const session = await directSolver.open(`${program}\n${shows}\n`, "--project");
	try {
		const outcome = await session.solve({
			models: 0,
			assumptions: [...guards, PULL_ATOM, SCENERY_ATOM].map((atom) => ({ atom })),
		});
		assert.equal(outcome.result, "SATISFIABLE", "the document has at least one design");
		// The FIRST answer set, not the only one, and the difference matters only
		// where it does not: every predicate this helper is used to ask about is a
		// fact about the machine rather than about a universe — which layer a state
		// is in, which window a guard is, which state a keyframe copy inherits from
		// — so it is the same in all of them. A caller wanting a claim about the
		// design space asks {@link run} or {@link answers}, which are about that.
		return outcome.models[0];
	} finally {
		await session.close();
	}
}

/** Atoms of one predicate, whole and sorted, so a deepEqual reads as a set. */
const named = (atoms: readonly string[], name: string): string[] =>
	atoms.filter((atom) => atom.startsWith(`${name}(`)).sort();

/** Whether the generated program states a fact, verbatim. */
const states = (scene: Scene, fact: string): boolean =>
	compile(scene).program.includes(`\n${fact}\n`);

const boolean = (id: string, initial?: string): MachineInput => ({
	id,
	name: id,
	kind: "boolean",
	...(initial === undefined ? {} : { initial }),
});

const number = (
	id: string,
	spec: { initial?: string; min?: string; max?: string } = {},
): MachineInput => ({ id, name: id, kind: "number", ...spec });

const track = (part: string, dim: "x" | "y", keys: Keyframe[]) => ({ part, dim, keys });

/**
 * A machine with every rung on it, used by the invariant test and by nothing
 * else — a document that exercises one rung at a time is the wrong document for
 * the one question that is about all five at once.
 */
const everything = () =>
	machine({
		inputs: [boolean("hovered", "false"), number("openness", { initial: "0", min: "0", max: "1" })],
		layers: [
			{ id: "motion", name: "Motion" },
			{ id: "glow", name: "Glow" },
			{ id: "badge", name: "Badge" },
		],
		timelines: [
			{
				id: "pulse",
				name: "Pulse",
				loop: "loop",
				tracks: [track("label", "y", [key("0ms", "14px"), key("300ms", "2px")])],
			},
		],
		states: [
			{ id: "rest", layer: "motion", parts: nudge(14) },
			{ id: "hover", layer: "motion", parts: nudge(10), timeline: "pulse" },
			{ id: "dark", layer: "glow", parts: { panel: { props: { fill: single("#000000") } } } },
			{ id: "lit", layer: "glow", parts: { panel: { props: { fill: single("#ffffff") } } } },
			{
				id: "mix",
				layer: "badge",
				blend: {
					kind: "oneD",
					input: "openness",
					stops: [{ timeline: "pulse", at: "0.2" }, { timeline: "pulse", at: "0.8" }],
				},
			},
		],
		transitions: [
			edge({ id: "start", from: "entry", to: "rest", trigger: "load" }),
			edge({
				id: "over",
				from: "rest",
				to: "hover",
				exit: [lit("100ms")],
				conditions: [{ input: "hovered", op: "eq", value: "true" }],
			}),
			edge({ id: "away", from: "any", to: "rest", trigger: "click" }),
			edge({ id: "off", from: "dark", to: "exit", trigger: "click" }),
		],
	});

test("the whole ladder adds no universes — five rungs in one assertion", async () => {
	// THE GUARANTEE, restated for everything above a state. An input is a runtime
	// value, a layer is a parallel copy, a keyframe is a fact and a blend is
	// interpolation: not one of them is a design decision, so a document with two
	// inputs, three layers, a timeline and a blend state has exactly the universe
	// count of the same document with none of them. The cheap encoding of any one
	// rung — a choice rule over an input's values, a choice over which layer wins
	// — passes every other test below and fails this one, which is why it is
	// first and why it is written before the encoding it checks.
	const uses = [{ id: "b1" }];
	const fill: Value = [lit("#3b82f6"), lit("#0f172a")];
	const none = buttons({ uses, fill });
	const flat = buttons({
		uses,
		fill,
		machines: [
			machine({
				states: [{ id: "rest", parts: nudge(14) }, { id: "hover", parts: nudge(10) }],
				transitions: [edge({ id: "over", from: "rest", to: "hover" })],
			}),
		],
	});
	const laddered = buttons({ uses, fill, machines: [everything()] });

	const bare = (await run(none)).count;
	assert.ok(bare > 1, "the document has a design space at all, or this proves nothing");
	assert.equal((await run(flat)).count, bare, "states are not designs — the shipped claim");
	assert.equal(
		(await run(laddered)).count,
		bare,
		"and neither are inputs, layers, timelines or a blend",
	);

	// And the rungs really are in the document, so the equality above is not the
	// equality of two documents with no ladder on them.
	const atoms = await asked(laddered, [
		"minput/2",
		"mlayer/2",
		"mtimeline/2",
		"mblend/3",
		"mcond/3",
	]);
	assert.equal(named(atoms, "minput").length, 2);
	assert.equal(named(atoms, "mlayer").length, 3);
	assert.equal(named(atoms, "mtimeline").length, 1);
	assert.equal(named(atoms, "mblend").length, 1);
	assert.equal(named(atoms, "mcond").length, 1);

	// The invariant is checkable a second way, and this is the way a reviewer of
	// rung one is told to check it: not one of the ladder's facts is a variable,
	// so no key in the studio's own table names an input, a layer, a blend or a
	// condition. `variableCounts` is the same walk the compiler mints from, so a
	// row here that was not a variable there is impossible by construction — what
	// this asserts is that the walk never visits a rung at all.
	const keys = Object.keys(variableCounts(laddered));
	for (const key of keys) {
		for (const forbidden of ["hovered", "openness", "motion", "glow", "badge"]) {
			assert.ok(
				!key.includes(forbidden),
				`${key} names ${forbidden}, so a rung became a design decision`,
			);
		}
	}
	// ...and nothing anywhere picks one.
	const all = await answers(laddered);
	for (const model of all) {
		for (const atom of model) {
			assert.ok(
				!/^(pick|alt)\((minput|mlayer|mblend|mcond|mtimeline)/.test(atom),
				`${atom} is a choice over a rung`,
			);
		}
	}
});

test("an input is six facts and never a variable, and its numbers are thousandths", async () => {
	// Rung one, and the whole of it. Every number an input carries — a starting
	// value, a range end — is a whole count of thousandths through `permilleOf`,
	// so that a threshold, a range end and a live value are three numbers nobody
	// has to divide by a thousand to compare. That unit is the reason the guard
	// arithmetic in rung two is exact rather than approximate.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				inputs: [
					boolean("hovered", "true"),
					number("openness", { initial: "0.5", min: "0", max: "1" }),
					{ id: "poke", name: "poke", kind: "trigger" },
					// Absent is OPEN, not zero, in both directions: a designer who has
					// not said how far the drawer opens has not said that it does not.
					number("loose"),
					// A kind the table does not know says nothing at all, exactly as a
					// node whose kind the table does not know draws nothing.
					{ id: "odd", name: "odd", kind: "sideways" as MachineInput["kind"] },
				],
				states: [{ id: "rest" }],
			}),
		],
	});
	assert.ok(states(scene, "minput(m1,hovered)."));
	assert.ok(states(scene, "minkind(m1,hovered,boolean)."));
	assert.ok(states(scene, "minbool(m1,hovered,true)."));
	assert.ok(states(scene, "minnum(m1,openness,500)."), "a half is five hundred thousandths");
	assert.ok(states(scene, "minlow(m1,openness,0)."));
	assert.ok(states(scene, "minhigh(m1,openness,1000)."));
	// A trigger holds nothing: "not fired" is the absence of a value rather than
	// one a store can keep, so there is no minbool and no minnum for it.
	assert.ok(states(scene, "minput(m1,poke)."));
	assert.ok(!compile(scene).program.includes("minbool(m1,poke"));
	assert.ok(!compile(scene).program.includes("minnum(m1,poke"));
	assert.ok(!compile(scene).program.includes("minlow(m1,loose"));
	assert.ok(!compile(scene).program.includes("minhigh(m1,loose"));
	assert.ok(!compile(scene).program.includes("minput(m1,odd)"));

	// Facts, not variables: nothing in the studio's table names one, and nothing
	// in the answer set is a pick over one.
	assert.deepEqual(
		Object.keys(variableCounts(scene)).filter((key) => key.includes("hovered")),
		[],
	);
	// And whether the range is bounded at all is derived rather than assumed, so
	// the two checks that read a range never report against a claim nobody made.
	const atoms = await asked(scene, ["minbounded/2"]);
	assert.deepEqual(named(atoms, "minbounded"), ["minbounded(m1,openness)"]);
});

test("a guard is a closed window, and six operators come to one comparison", async () => {
	// Rung two. The normalisation into an interval happens in `machines.ts` so
	// that the panel and the program cannot disagree about what a condition means;
	// what this checks is that the interval reaches the program, that `gt` became
	// `v + 1` exactly rather than approximately, and that the three shapes an
	// interval cannot hold — a hole, a boolean, a trigger — reach it as their own
	// predicates instead of being flattened into one that cannot say them.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				inputs: [boolean("on"), number("n", { min: "0", max: "1" }), { id: "poke", name: "poke", kind: "trigger" }],
				states: [{ id: "rest" }, { id: "hover" }],
				transitions: [
					edge({ id: "a", from: "rest", to: "hover", conditions: [{ input: "n", op: "gt", value: "0.5" }] }),
					edge({ id: "b", from: "rest", to: "hover", conditions: [{ input: "n", op: "le", value: "0.5" }] }),
					edge({ id: "c", from: "rest", to: "hover", conditions: [{ input: "n", op: "ne", value: "0.5" }] }),
					edge({ id: "d", from: "rest", to: "hover", conditions: [{ input: "on", op: "eq", value: "true" }] }),
					edge({ id: "e", from: "rest", to: "hover", conditions: [{ input: "on", op: "ne", value: "true" }] }),
					edge({ id: "f", from: "rest", to: "hover", conditions: [{ input: "poke", op: "fired" }] }),
					// An input the machine has not got. Reported rather than dropped:
					// dropping it would leave the edge reading as unguarded and firing on
					// every trigger, which is a wrong machine rather than a reported one.
					edge({ id: "g", from: "rest", to: "hover", conditions: [{ input: "ghost", op: "eq", value: "1" }] }),
				],
			}),
		],
	});
	const atoms = await asked(scene, [
		"mcrange/6",
		"mcnot/5",
		"mcis/5",
		"mcisnot/5",
		"mcfired/4",
		"mcbad/3",
		"mcondin/4",
		"mguarded/2",
		"mguardnever/2",
		"mclash/3",
		"mdisjoint/3",
	]);
	assert.deepEqual(named(atoms, "mcrange"), [
		// A half is 500 thousandths, so "more than a half" is 501 and up — exact,
		// because the unit is a whole number and not a float.
		"mcrange(m1,a,1,n,501,1000000)",
		"mcrange(m1,b,1,n,-1000000,500)",
	]);
	assert.deepEqual(named(atoms, "mcnot"), ["mcnot(m1,c,1,n,500)"]);
	assert.deepEqual(named(atoms, "mcis"), ["mcis(m1,d,1,on,true)"]);
	assert.deepEqual(named(atoms, "mcisnot"), ["mcisnot(m1,e,1,on,true)"]);
	assert.deepEqual(named(atoms, "mcfired"), ["mcfired(m1,f,1,poke)"]);
	assert.deepEqual(named(atoms, "mcbad"), ["mcbad(m1,g,1)"]);
	// A bad condition states no mcondin/4 at all, and that is deliberate: its
	// fourth argument would be an input id the machine has not got — a term that
	// reads as a constant and names nothing — and every rule joining on it would
	// ground against a phantom.
	assert.ok(!atoms.includes("mcondin(m1,g,1,ghost)"));
	assert.deepEqual(named(atoms, "mguardnever"), ["mguardnever(m1,g)"]);
	// The window pair really is disjoint, and the closure covers both directions
	// from one L1 > H2.
	assert.ok(atoms.includes("mclash(m1,a,b)"));
	assert.ok(atoms.includes("mdisjoint(m1,a,b)") && atoms.includes("mdisjoint(m1,b,a)"));
	assert.equal(named(atoms, "mguarded").length, 7);
});

test("two edges whose guards cannot both hold are not a nondeterministic pair", async () => {
	// The payoff of rung two, and the reason it is worth encoding at all: the
	// ordinary idiom — two edges out of one state on one trigger, told apart by a
	// condition — was reported as nondeterministic before guards existed, and a
	// checker that screams at the ordinary idiom is a checker people turn off.
	const guarded = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				inputs: [boolean("on")],
				states: [{ id: "rest" }, { id: "hover" }, { id: "pressed" }],
				transitions: [
					edge({ id: "a", from: "rest", to: "hover", conditions: [{ input: "on", op: "eq", value: "true" }] }),
					edge({ id: "b", from: "rest", to: "pressed", conditions: [{ input: "on", op: "ne", value: "true" }] }),
				],
			}),
		],
	});
	assert.deepEqual(named(await answers(guarded).then((m) => m[0]), "mnondet"), []);

	// ...and with no conditions at all, the pair is the rule that shipped: two
	// edges, one trigger, reported. NOT PROVABLY DISJOINT is the default, which is
	// a sound refusal to guess rather than a claim that no valuation exists.
	const bare = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [{ id: "rest" }, { id: "hover" }, { id: "pressed" }],
				transitions: [
					edge({ id: "a", from: "rest", to: "hover" }),
					edge({ id: "b", from: "rest", to: "pressed" }),
				],
			}),
		],
	});
	assert.deepEqual(named((await answers(bare))[0], "mnondet"), [
		"mnondet(m1,rest,pointerenter)",
	]);
});

test("a window outside its own input's range is a guard nothing can meet", async () => {
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				inputs: [number("n", { min: "0", max: "1" })],
				states: [{ id: "rest" }, { id: "hover" }, { id: "far" }],
				transitions: [
					edge({ id: "over", from: "rest", to: "hover", conditions: [{ input: "n", op: "gt", value: "5" }] }),
					edge({ id: "on", from: "hover", to: "far" }),
				],
			}),
		],
	});
	const atoms = (await answers(scene))[0];
	assert.deepEqual(named(atoms, "mguardnever"), ["mguardnever(m1,over)"]);
	// And the reachability that takes guards into account is strictly stronger
	// than the one that shipped: `hover` is reachable by an edge and unreachable
	// through that edge's guard, so mreach says nothing and mgreach does.
	assert.deepEqual(named(atoms, "munreached"), []);
	assert.deepEqual(named(atoms, "mgunreached"), [
		"mgunreached(m1,far)",
		"mgunreached(m1,hover)",
	]);
});

test("Entry, Exit and Any are three constants and never three states", async () => {
	// Rung three, and the whole of what it costs. Three reserved ids, three facts
	// and four rules; no states, no copies, no variables — because a state is a
	// delta over the definition's parts and Entry has no appearance, so as a state
	// it would be an empty delta, a copy per instance per part, a row in every
	// strip, and a term `shown/2` could carry, which would mean "draw this button
	// in Exit".
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				layers: [{ id: "main", name: "Main" }, { id: "extra", name: "Extra" }],
				states: [
					{ id: "rest", layer: "main" },
					{ id: "hover", layer: "main" },
					{ id: "badge", layer: "extra" },
				],
				transitions: [
					edge({ id: "start", from: "entry", to: "hover", trigger: "load" }),
					edge({ id: "home", from: "any", to: "rest", trigger: "click" }),
					edge({ id: "gone", from: "hover", to: "exit", trigger: "pointerleave" }),
					edge({ id: "wrong", from: "exit", to: "rest", trigger: "click" }),
					edge({ id: "alsowrong", from: "rest", to: "entry", trigger: "click" }),
					edge({ id: "nowhere", from: "rest", to: "deleted", trigger: "load" }),
				],
			}),
		],
	});
	const atoms = await asked(scene, ["mefrom/3", "manyfrom/2", "mstops/2", "mrank/3", "mcopy/3"]);
	// Entry resolves to the initial state OF ITS OWN LAYER, which is the only
	// reading available: `entry` is in no layer, so the edge takes its layer from
	// where it points.
	assert.ok(atoms.includes("mefrom(m1,start,rest)"), "entry is the layer's first state");
	// Any stands for every state of its own layer, and for no state of the other.
	assert.ok(atoms.includes("mefrom(m1,home,rest)"));
	assert.ok(atoms.includes("mefrom(m1,home,hover)"));
	assert.ok(!atoms.includes("mefrom(m1,home,badge)"), "Any does not cross a layer");
	assert.deepEqual(named(atoms, "manyfrom"), ["manyfrom(m1,home)"]);
	assert.deepEqual(named(atoms, "mstops"), ["mstops(m1,gone)"]);
	// Specific beats Any, which is Rive's rule and the only one that makes a
	// fallback usable — encoded as a rank so that mnondet stops screaming at it.
	assert.ok(atoms.includes("mrank(m1,home,2)"));
	assert.ok(atoms.includes("mrank(m1,gone,1)"));
	// Not states: no copy of anything is ever made for one, and no reserved id is
	// ever a term in a copy.
	assert.deepEqual(
		named(atoms, "mcopy").filter((atom) => /entry|exit|any/.test(atom)),
		[],
	);
	assert.ok(!compile(scene).program.includes("mstate(m1,entry)"));

	// "This edge names a state you deleted" and "this edge tries to leave Exit"
	// are two different mistakes, fixed two different ways, so they are two
	// different predicates rather than one.
	const health = (await answers(scene))[0];
	assert.deepEqual(named(health, "mmisplaced"), [
		"mmisplaced(m1,alsowrong)",
		"mmisplaced(m1,wrong)",
	]);
	assert.deepEqual(named(health, "mdangling"), ["mdangling(m1,nowhere)"]);
});

test("an exit time is the fourth motion setting, and pacing is still a design", async () => {
	// Rung three's other half. An exit time is motion, motion is a value, and a
	// value with two alternatives is two designs — the brisk debounce and the
	// patient one — which is what `#project mexit/3` is for and what would collapse
	// into one universe with an arbitrary pick without it.
	const scene = buttons({
		uses: [{ id: "b1" }],
		tokens: [{ id: "beat", name: "Beat", type: "duration" as const, value: [lit("100ms"), lit("400ms")] }],
		machines: [
			machine({
				states: [{ id: "rest" }, { id: "hover" }],
				transitions: [
					edge({ id: "plain", from: "rest", to: "hover" }),
					edge({ id: "typo", from: "hover", to: "rest", exit: [lit("-50ms")] }),
				],
			}),
		],
	});
	const atoms = (await answers(scene))[0];
	// Absent is zero, which is "any time", and is what every transition written
	// before this rung means.
	assert.ok(atoms.includes("mexit(m1,plain,0)"));
	// A negative exit time is a transition takeable before its own state began,
	// so it clamps exactly where a duration does.
	assert.ok(atoms.includes("mexit(m1,typo,0)"));

	const varied = buttons({
		uses: [{ id: "b1" }],
		tokens: [{ id: "beat", name: "Beat", type: "duration" as const, value: [lit("100ms"), lit("400ms")] }],
		machines: [
			machine({
				states: [{ id: "rest" }, { id: "hover" }],
				transitions: [
					edge({ id: "over", from: "rest", to: "hover", exit: [{ kind: "token", token: "beat" }] }),
				],
			}),
		],
	});
	assert.equal((await run(varied)).count, 2, "a debounce scale is two designs");
});

/* ------------------------------------------------------------------ */
/* Gestures and clocks                                                 */
/* ------------------------------------------------------------------ */

test("four new triggers are four facts and no universes", async () => {
	// A trigger reaches the program as `mtrigger(M,T,G)`, a fact, and a fact is in
	// every answer set — so widening the vocabulary from eight words to twelve
	// cannot branch the space however different the four new ones are to a
	// *runtime*. Asserted against the same document written with the shipped
	// triggers rather than against a remembered number, because the claim is that
	// the two documents cost the same and not that either costs one.
	const built = (a: Trigger, b: Trigger): Scene =>
		buttons({
			uses: [{ id: "b1" }],
			machines: [
				machine({
					states: [{ id: "rest" }, { id: "held" }],
					transitions: [
						edge({ id: "grab", from: "rest", to: "held", trigger: a }),
						edge({ id: "drop", from: "held", to: "rest", trigger: b }),
					],
				}),
			],
		});
	const pointers = built("pointerdown", "pointerup");
	const dragged = built("dragbegin", "dragend");
	const viewed = built("viewenter", "viewleave");
	const bare = (await run(pointers)).count;
	assert.equal((await run(dragged)).count, bare, "a drag pair is not two designs");
	assert.equal((await run(viewed)).count, bare, "nor is a view pair");

	// And the words really do reach the program, which is the half that would go
	// silently missing if the emitter ever filtered a trigger it did not know.
	assert.ok(states(dragged, "mtrigger(m1,grab,dragbegin)."));
	assert.ok(states(dragged, "mtrigger(m1,drop,dragend)."));
	assert.ok(states(viewed, "mtrigger(m1,grab,viewenter)."));
	assert.ok(states(viewed, "mtrigger(m1,drop,viewleave)."));
});

test("every state has a clock, and the default is time", async () => {
	// One fact per state, always — the arrangement `mslayer/3` and `mloop/3`
	// already have, and the reason is the rule that reads it: `mexitpast/2` names
	// `mclock(M,S,time)` positively, which is one body literal instead of a
	// negation over a vocabulary that will grow. A document that said nothing
	// about clocks and emitted nothing would make that rule silently stop firing.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [machine({ states: [{ id: "rest" }, { id: "hover" }] })],
	});
	assert.deepEqual(named((await answers(scene))[0], "mclock"), [
		"mclock(m1,hover,time)",
		"mclock(m1,rest,time)",
	]);
});

test("a clock is a word on a state, and a state with one mints the same copies", async () => {
	// The other half of `MachineState.clock`'s essay, checked rather than
	// asserted: a clock is *wiring*, so it is a fact and never a Value, so it
	// branches nothing and — the sharper claim — it changes nothing about what the
	// state materialises. Two universes differing only in what drives an animation
	// would be two identical still frames, which is the thing the multiverse is
	// not for.
	const built = (clock?: "view" | "pageScroll"): Scene =>
		buttons({
			uses: [{ id: "b1" }],
			machines: [
				machine({
					timelines: [
						{
							id: "drift",
							name: "Drift",
							loop: "none",
							tracks: [track("label", "y", [key("0ms", "14px"), key("400ms", "2px")])],
						},
					],
					states: [
						{ id: "rest" },
						{ id: "para", timeline: "drift", ...(clock ? { clock } : {}) },
					],
					transitions: [edge({ id: "over", from: "rest", to: "para" })],
				}),
			],
		});
	const plain = built();
	const scrolled = built("view");
	assert.equal((await run(scrolled)).count, (await run(plain)).count);

	const atoms = (await answers(scrolled))[0];
	assert.deepEqual(named(atoms, "mclock"), [
		"mclock(m1,para,view)",
		"mclock(m1,rest,time)",
	]);
	// **The whole answer set, minus the clock fact itself, is the unclocked
	// document's answer set.** Not "the same number of copies": the same atoms, by
	// name — every `stt(...)` copy, every frame, every rendered property. A clock
	// that changed one of them would be a clock that had leaked into the picture,
	// and a clock that is in the picture is a design decision the multiverse would
	// then have to be able to explore, which is exactly the argument for it being
	// a fact.
	const withoutClock = (list: readonly string[]) =>
		list.filter((a) => !a.startsWith("mclock(")).sort();
	assert.deepEqual(withoutClock(atoms), withoutClock((await answers(plain))[0]));
	// And it mints no variable, so there is nothing for a pick to decide and
	// nothing for a projection to partition.
	assert.deepEqual(
		Object.keys(compile(scrolled).variables).sort(),
		Object.keys(compile(plain).variables).sort(),
	);
	// And the page's own scroll is the other word, spelled `pageScroll` rather
	// than `page` because a page of a flow is about to be `page/1` and one word
	// carrying two meanings through one program is the collision this rename
	// exists to prevent.
	assert.ok(states(built("pageScroll"), "mclock(m1,para,pageScroll)."));
	assert.equal(compile(built("pageScroll")).program.includes("mclock(m1,para,page)"), false);

	// **And it comes back out**, which is the assertion `#show mclock/3` is for
	// and the one this repository has learned to write down: a predicate stated
	// and never shown is a feature that works everywhere except where anybody can
	// see it, and `asset/2` cost a whole feature to exactly that omission. This is
	// `ModelMachine.clocks`' only reader in the tree — the two panels ask the
	// document, for the reason written where the field is declared — so without
	// this line the `#show` could be deleted and every other test would stay
	// green.
	assert.deepEqual(readModel(atoms).machines.m1?.clocks, {
		para: "view",
		rest: "time",
	});
	assert.deepEqual(readModel((await answers(plain))[0]).machines.m1?.clocks, {
		para: "time",
		rest: "time",
	});
});

test("an exit time past a scroll-clocked timeline is not reported", async () => {
	// A scroll-clocked timeline has no wall-clock length for a debounce to be
	// longer than: the state finishes when the reader scrolls past it, which is
	// not a duration, so "the trigger can never arrive late enough" is a sentence
	// about nothing. The same document on the wall clock reports it, which is what
	// makes this a narrowing rather than a silence.
	const timelines: Timeline[] = [
		{
			id: "pulse",
			name: "Pulse",
			loop: "none",
			tracks: [track("label", "y", [key("0ms", "14px"), key("200ms", "4px")])],
		},
	];
	const built = (clock?: "view"): Scene =>
		buttons({
			uses: [{ id: "b1" }],
			machines: [
				machine({
					timelines,
					states: [
						{ id: "rest", timeline: "pulse", ...(clock ? { clock } : {}) },
						{ id: "hover" },
					],
					transitions: [edge({ id: "over", from: "rest", to: "hover", exit: [lit("9s")] })],
				}),
			],
		});
	assert.deepEqual(named((await answers(built()))[0], "mexitpast"), ["mexitpast(m1,over)"]);
	assert.deepEqual(named((await answers(built("view")))[0], "mexitpast"), []);
});

test("an exit time longer than its own state's timeline makes the edge unreachable", async () => {
	// The deeper reading of the brief's check, shipped beside the literal one
	// rather than substituted for it: a transition that must wait longer to become
	// available than the state it waits in lasts is a transition nothing can ever
	// take.
	const timelines: Timeline[] = [
		{
			id: "pulse",
			name: "Pulse",
			loop: "none",
			tracks: [track("label", "y", [key("0ms", "14px"), key("200ms", "4px")])],
		},
	];
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				timelines,
				states: [{ id: "rest", timeline: "pulse" }, { id: "hover" }],
				transitions: [edge({ id: "over", from: "rest", to: "hover", exit: [lit("9s")] })],
			}),
		],
	});
	assert.deepEqual(named((await answers(scene))[0], "mexitpast"), ["mexitpast(m1,over)"]);

	// ...and a looping timeline never ends, so no exit time is past it. Reporting
	// one would be reporting a bug against a design that works.
	const looping = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				timelines: [{ ...timelines[0], loop: "loop" }],
				states: [{ id: "rest", timeline: "pulse" }, { id: "hover" }],
				transitions: [edge({ id: "over", from: "rest", to: "hover", exit: [lit("9s")] })],
			}),
		],
	});
	assert.deepEqual(named((await answers(looping))[0], "mexitpast"), []);
});

test("three layers are three states at once in one answer set, and not three designs", async () => {
	// Rung four, and the rung the copy encoding was bought for. Two layers are two
	// `shown/2` facts in ONE answer set, so "is the glow lined up while the button
	// is also pressed" is an ordinary rule over two terms — where under a choice
	// rule the two layers' states would be in two different answer sets and the
	// question would have nowhere to be asked.
	const scene = buttons({ uses: [{ id: "b1" }], machines: [everything()] });
	const atoms = (await answers(scene))[0];
	assert.deepEqual(named(atoms, "shown"), [
		"shown(b1,dark)",
		"shown(b1,mix)",
		"shown(b1,rest)",
	]);
	// Three shown states is a machine doing its job, not three pictures on top of
	// each other — which is exactly the distinction mslayer/3 exists to let a
	// reader draw, and mtwoshown/1 to report when it cannot.
	assert.deepEqual(named(atoms, "mtwoshown"), []);
	assert.ok(atoms.includes("mslayer(m1,rest,motion)"));
	assert.ok(atoms.includes("mlindex(m1,glow,2)"));

	// A stored state has to be a state of the layer it is stored under, or a
	// document that moved `hover` from one layer to another would draw the
	// instance in it on both — one picture on top of itself.
	const picked = buttons({
		uses: [{ id: "b1", states: { motion: "hover", glow: "lit" } }],
		machines: [everything()],
	});
	assert.deepEqual(named((await answers(picked))[0], "shown"), [
		"shown(b1,hover)",
		"shown(b1,lit)",
		"shown(b1,mix)",
	]);
});

test("a machine with no layers still has one, and every rule is the rule that shipped", async () => {
	// The whole no-regression argument for rung four in one assertion: the reader
	// mints a layer called `base` for a machine that says nothing about layers,
	// which is every machine in every document written before this rung, so the
	// four rules that quantify over layers are not special-cased anywhere.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [machine({ states: [{ id: "rest", parts: nudge(14) }, { id: "hover", parts: nudge(10) }] })],
	});
	const atoms = (await answers(scene))[0];
	assert.deepEqual(named(atoms, "mlindex"), ["mlindex(m1,base,1)"]);
	assert.deepEqual(named(atoms, "mslayer"), [
		"mslayer(m1,hover,base)",
		"mslayer(m1,rest,base)",
	]);
	assert.deepEqual(named(atoms, "shown"), ["shown(b1,rest)"], "one layer, one shown state");
});

test("two layers with an opinion about one field: the later one writes, and both are named", async () => {
	// RESOLVE FIRST, REPORT SECOND, and the order is the decision. Resolve because
	// the program must produce a picture — leaving both aliases to fire derives two
	// `rendered/3` literals for one property, which is one arbitrary answer rather
	// than two designs. Report because we can, and because the report is the whole
	// reason to build this here rather than let Rive's silent last-writer-wins be
	// the only answer.
	const contested = machine({
		layers: [{ id: "under", name: "Under" }, { id: "over", name: "Over" }],
		states: [
			{
				id: "u",
				layer: "under",
				parts: { panel: { props: { fill: single("#111111") }, frame: { x: dimension(px(1)) }, turn: { rotateZ: [lit("10deg")] } } },
			},
			{
				id: "o",
				layer: "over",
				parts: { panel: { props: { fill: single("#222222") }, frame: { x: dimension(px(9)) }, turn: { rotateZ: [lit("40deg")] } } },
			},
		],
	});
	const scene = buttons({ uses: [{ id: "b1" }], machines: [contested] });
	const atoms = await asked(scene, [
		"mwriter/4",
		"mfwriter/4",
		"mrwriter/4",
		"mfightat/5",
		"mfshadow/3",
		"mlfshadow/4",
	]);

	// Exactly one atom for the instance's field, and it is the later layer's.
	const painted = renderedOf(atoms, "inst(b1,panel)");
	assert.equal(painted.fill, "#222222", "the later layer writes");
	assert.equal(
		atoms.filter((atom) => atom.startsWith("rendered(inst(b1,panel),fill,")).length,
		1,
		"one property, one literal — not two designs but one relation",
	);
	assert.equal(frameOf(atoms, "inst(b1,panel)").x, px(9));
	assert.equal(
		atoms.filter((atom) => atom.startsWith("frame(inst(b1,panel),x,")).length,
		1,
	);
	assert.deepEqual(named(atoms, "mwriter"), ["mwriter(m1,over,panel,fill)"]);
	assert.deepEqual(named(atoms, "mfwriter"), ["mfwriter(m1,over,panel,x)"]);
	assert.deepEqual(named(atoms, "mrwriter"), ["mrwriter(m1,over,panel,rotateZ)"]);
	// Rotation is the third of the family and the one that did not exist when the
	// alias was narrowed, so it gets the same assertion the other two just got.
	assert.equal(
		atoms.filter((atom) => atom.startsWith("turn(inst(b1,panel),rotateZ,")).length,
		1,
		"two layers turning one part is one angle, not two",
	);
	assert.ok(atoms.includes("turn(inst(b1,panel),rotateZ,40000)"), "and it is the later one");

	// §9 question 3 of the merged plan, asserted rather than read off the source:
	// mlfshadow/4 must be written over the SAME dimension list mfshadow/3 is, or
	// mfwriter/4 is empty for a dimension the shadow claims and a state that moves
	// a part moves its copy and leaves the picture where it was.
	const shadowed = new Set(
		named(atoms, "mfshadow").map((atom) => atom.replace(/^mfshadow\(b1,/, "").replace(/\)$/, "")),
	);
	const owned = new Set(
		named(atoms, "mlfshadow").map((atom) =>
			atom.replace(/^mlfshadow\(m1,[^,]+,/, "").replace(/\)$/, ""),
		),
	);
	assert.deepEqual([...owned].sort(), [...shadowed].sort());

	// ...and all three fights are derived against terms the document named, so a
	// canned `custom` check turns each into an ordinary viol/1 with a switch, a
	// name in the core, and `why` and `relax` for free.
	//
	// `L1 < L2` in the three fight rules is TERM order and not layer order — it is
	// there to state the pair once rather than twice, and `over` sorts before
	// `under` — so a reader takes the priority from mlindex/3 and never from the
	// argument positions.
	assert.deepEqual(named(atoms, "mfight"), ["mfight(m1,over,under,panel,fill)"]);
	assert.deepEqual(named(atoms, "mffight"), ["mffight(m1,over,under,panel,x)"]);
	assert.deepEqual(named(atoms, "mrfight"), ["mrfight(m1,over,under,panel,rotateZ)"]);
	// The static one is about the machine; this one is about the instance in front
	// of you, which is the different question a panel asks.
	assert.deepEqual(named(atoms, "mfightat"), ["mfightat(b1,over,under,panel,fill)"]);
});

test("hiding needs no writer, because two layers that both hide agree", async () => {
	// Not an omission and worth asserting rather than arguing: hiding does not
	// conflict. Two layers that both take a part out of the picture agree, and one
	// that hides while another paints is not a disagreement about a value, it is a
	// part that is not there. Any layer that hides, hides.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				layers: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
				states: [
					{ id: "sa", layer: "a", parts: { panel: { props: { fill: single("#111111") } } } },
					{ id: "sb", layer: "b", parts: { panel: { hidden: true } } },
				],
			}),
		],
	});
	// Read off `visible/1`, which is what the answer set carries: `hidden/1` is a
	// body atom the scene rules negate and is shown by nothing, exactly as it is
	// for a node the document hid.
	const atoms = (await answers(scene))[0];
	assert.ok(!atoms.includes("visible(inst(b1,panel))"), "the layer that hides, hides");
	assert.ok(atoms.includes("visible(inst(b1,label))"), "and hides nothing else");
	// ...while the layer that paints still paints, on a part its own layer owns.
	assert.equal(renderedOf(atoms, "inst(b1,panel)").fill, "#111111");
});

test("a measured copy is one width for the instance, across one layer and across two", async () => {
	// THE THIRD SOURCE, and the bug it hid. A copy that hugs its own words takes
	// its box from `lask/3` rather than from a delta the designer typed, so the
	// width was in neither shadow table — and both rules that read those tables
	// then fired beside it: the base rule derived the definition's box as well as
	// the measured one on a *one-layer* document, and the unowned half of the
	// alias fired once per shown state on a two-layer one. Two frame/3 atoms for
	// one (node, dimension) is one arbitrary answer, silently.
	const layered = machine({
		layers: [{ id: "words", name: "Words" }, { id: "glow", name: "Glow" }],
		states: [
			{ id: "rest", layer: "words" },
			{ id: "wordy", layer: "words", parts: reword("Go somewhere far away") },
			{ id: "dark", layer: "glow", parts: { panel: { props: { fill: single("#000000") } } } },
		],
	});
	const wordy = statePart("b1", "wordy", "label");
	const measured: Measurements = { [wordy]: oneSize({ width: px(300), height: px(20) }) };

	const twoLayers = buttons({
		uses: [{ id: "b1", states: { words: "wordy", glow: "dark" } }],
		machines: [layered],
	});
	const atoms = await only(twoLayers, measured);
	assert.equal(
		atoms.filter((atom) => atom.startsWith("frame(inst(b1,label),width,")).length,
		1,
		"one width, not one per shown state",
	);
	assert.equal(frameOf(atoms, "inst(b1,label)").width, px(300), "and it is the measured one");

	// The same document with one layer, which is where this has been since state
	// machines shipped.
	const flat = buttons({
		uses: [{ id: "b1", state: "wordy" }],
		machines: [
			machine({ states: [{ id: "rest" }, { id: "wordy", parts: reword("Go somewhere far away") }] }),
		],
	});
	const one = await only(flat, measured);
	assert.equal(
		one.filter((atom) => atom.startsWith("frame(inst(b1,label),width,")).length,
		1,
	);
	assert.equal(frameOf(one, "inst(b1,label)").width, px(300));

	// And the state that was not measured is still the definition's box, so the
	// fix narrowed nothing it should not have.
	assert.equal(frameOf(one, statePart("b1", "rest", "label")).width, px(136));
});

test("a timeline on its own is variables and facts, and not one copy", async () => {
	// Rung five, and the decision that makes it affordable. THE SOLVER DECIDES
	// KEYFRAMES AND NEVER FRAMES: a twenty-key timeline costs the same whether it
	// plays over 100ms or ten seconds, and a keyframe copy is minted only where a
	// geometric rule asked for one — a twenty-key timeline on a twelve-part
	// definition placed twenty times would otherwise be 4,800 poses nobody asked
	// to place.
	const timelines: Timeline[] = [
		{
			id: "pulse",
			name: "Pulse",
			loop: "pingPong",
			tracks: [track("label", "y", [key("0ms", "14px"), key("300ms", "2px")])],
		},
	];
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [machine({ timelines, states: [{ id: "rest", timeline: "pulse" }] })],
	});
	const atoms = await asked(scene, ["mkcopy/4", "mkpart/3", "mknext/5"]);
	assert.deepEqual(named(atoms, "mkcopy"), [], "no rule asked, so no copy exists");
	assert.deepEqual(named(atoms, "mkpart"), []);
	assert.deepEqual(atoms.filter((atom) => atom.includes("kfr(")), []);
	// What it does cost: the times, the length, the loop mode and the easings.
	assert.deepEqual(named(atoms, "mkat"), [
		"mkat(m1,pulse,trkd(label,y),1,0)",
		"mkat(m1,pulse,trkd(label,y),2,300)",
	]);
	// Absent is the last keyframe's time, DERIVED rather than stored, so a
	// timeline cannot disagree with its own contents.
	assert.deepEqual(named(atoms, "mtlen"), ["mtlen(m1,pulse,300)"]);
	assert.deepEqual(named(atoms, "mloop"), ["mloop(m1,pulse,pingPong)"]);
	assert.deepEqual(named(atoms, "mknext"), ["mknext(m1,pulse,trkd(label,y),1,2)"]);

	// A stated length shorter than the last keyframe is legal and means what it
	// says: the tail is not played.
	const clipped = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				timelines: [{ ...timelines[0], length: [lit("100ms")] }],
				states: [{ id: "rest", timeline: "pulse" }],
			}),
		],
	});
	const short = await asked(clipped, ["mkpast/4"]);
	assert.deepEqual(named(short, "mtlen"), ["mtlen(m1,pulse,100)"]);
	assert.deepEqual(named(short, "mkpast"), ["mkpast(m1,pulse,trkd(label,y),2)"]);
});

test("a keyframe whose time resolves before its predecessor's is a fact about the answer", async () => {
	// Not a thing a linter over the document could ever catch, because a
	// keyframe's time is a Value and this is a property of an answer rather than
	// of a document — which is exactly the class of bug a multiverse invents.
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				timelines: [
					{
						id: "pulse",
						name: "Pulse",
						tracks: [track("label", "y", [key("300ms", "14px"), key("50ms", "2px")])],
					},
				],
				states: [{ id: "rest", timeline: "pulse" }],
			}),
		],
	});
	assert.deepEqual(named((await answers(scene))[0], "mkbackwards"), [
		"mkbackwards(m1,pulse,trkd(label,y),2)",
	]);
});

test("a rule that names a keyframe mints its copy, and the copy is placed", async () => {
	// The rationing, from the other side: `mkpart/3` is seeded only from the
	// geometric constraints that name a `kfr(...)` term, and naming one is what
	// turns a timeline into poses simplex can place.
	const overshoot = keyCopy("b1", "pulse", trackDim("label", "y"), 2);
	const scene = buttons({
		uses: [{ id: "b1" }],
		constraints: [rule("k", "align", ["label", overshoot], "left")],
		machines: [
			machine({
				timelines: [
					{
						id: "pulse",
						name: "Pulse",
						tracks: [track("label", "y", [key("0ms", "14px"), key("300ms", "2px")])],
					},
				],
				states: [{ id: "rest", timeline: "pulse" }],
			}),
		],
	});
	const atoms = await asked(scene, ["mkcopy/4", "mkpart/3", "mkeydim/5"]);
	assert.deepEqual(named(atoms, "mkcopy"), [
		"mkcopy(b1,pulse,trkd(label,y),1)",
		"mkcopy(b1,pulse,trkd(label,y),2)",
	]);
	// The track's part and its ancestors, and nothing under either — the same
	// materialisation analysis a state copy gets.
	assert.deepEqual(named(atoms, "mkpart"), ["mkpart(m1,pulse,btn)", "mkpart(m1,pulse,label)"]);
	// The track speaks about y, so y is the keyframe's own; everything else is
	// inherited from the state whose timeline it is.
	assert.equal(frameOf(atoms, overshoot).y, px(2));
	assert.equal(frameOf(atoms, overshoot).width, px(136));
});

test("a keyframe copy inherits from one state, however many play the timeline", async () => {
	// `mtplays/3` is a fact about the MACHINE — which states play which timeline —
	// and says nothing about which of them is on screen, deliberately. Read as the
	// join, each of the three inherit rules fired once per playing state, so a
	// timeline two states play whose deltas disagree about the part it animates
	// derived two frame/3 atoms for one (copy, dimension): not two poses, one
	// arbitrary answer. The first playing state wins, and the tie-break is
	// document order for the reason every other tie-break in the program is.
	const overshoot = keyCopy("b1", "pulse", trackProp("label", "ink"), 1);
	const scene = buttons({
		uses: [{ id: "b1" }],
		constraints: [rule("k", "align", ["label", overshoot], "left")],
		machines: [
			machine({
				timelines: [
					{
						id: "pulse",
						name: "Pulse",
						tracks: [
							{
								part: "label",
								prop: "ink",
								keys: [{ at: [lit("0ms")], value: [lit("#ff0000")] }],
							},
						],
					},
				],
				states: [
					{ id: "first", parts: { label: { frame: { x: dimension(px(5)) } } }, timeline: "pulse" },
					{ id: "second", parts: { label: { frame: { x: dimension(px(99)) } } }, timeline: "pulse" },
				],
			}),
		],
	});
	const atoms = await asked(scene, ["mkbase/3", "mtplays/3"]);
	assert.deepEqual(named(atoms, "mtplays"), [
		"mtplays(m1,first,pulse)",
		"mtplays(m1,second,pulse)",
	]);
	assert.deepEqual(named(atoms, "mkbase"), ["mkbase(m1,pulse,first)"]);
	assert.equal(
		atoms.filter((atom) => atom.startsWith(`frame(${overshoot},x,`)).length,
		1,
		"one pose, not one per playing state",
	);
	assert.equal(frameOf(atoms, overshoot).x, px(5), "and it is the first state's");
});

test("a blend state is arithmetic over a runtime value, and its stops are checked", async () => {
	// The mixing is arithmetic over an input, so none of it is solved and none of
	// it can be — the input is not in the program. What *is* solved is everything
	// the stops are made of, and what the checks need: the thresholds, in
	// thousandths, against the input's own declared range.
	const timelines: Timeline[] = [
		{
			id: "pulse",
			name: "Pulse",
			tracks: [track("label", "y", [key("0ms", "14px")])],
		},
	];
	const scene = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				inputs: [number("n", { min: "0", max: "1" })],
				timelines,
				states: [
					{
						id: "mix",
						blend: {
							kind: "oneD",
							input: "n",
							stops: [
								{ timeline: "pulse", at: "-0.5" },
								{ timeline: "pulse", at: "0.4" },
								{ timeline: "pulse", at: "2" },
							],
						},
					},
				],
			}),
		],
	});
	assert.ok(states(scene, "mstopat(m1,mix,2,400)."), "a threshold is thousandths too");
	const atoms = (await answers(scene))[0];
	assert.deepEqual(named(atoms, "mstopout"), ["mstopout(m1,mix,1)", "mstopout(m1,mix,3)"]);

	// The converse, and deliberately not canned: the axis extends past the
	// outermost stop, so part of the input's range plays one timeline flat. Legal,
	// sometimes meant, and worth being able to ask about.
	const gapped = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				inputs: [number("n", { min: "0", max: "1" })],
				timelines,
				states: [
					{
						id: "mix",
						timeline: "pulse",
						blend: {
							kind: "oneD",
							input: "n",
							stops: [{ timeline: "pulse", at: "0.2" }, { timeline: "pulse", at: "0.8" }],
						},
					},
				],
			}),
		],
	});
	const gapAtoms = (await answers(gapped))[0];
	assert.deepEqual(named(gapAtoms, "mstopgap"), ["mstopgap(m1,mix)"]);
	// A state holding both a timeline and a blend is REPORTED rather than
	// repaired, because a state with two sources is a mistake a person should see
	// rather than one a reader should quietly pick a side in.
	assert.deepEqual(named(gapAtoms, "mtwosource"), ["mtwosource(m1,mix)"]);
});

test("all ten canned checks ground on a document with a machine, and say nothing about it", async () => {
	// The reason `#defined` is the first thing in the ladder block. A canned check
	// offered before its predicate exists is not merely inert: `addMachineCheck`
	// writes the rule into `scene.rules`, the compiler appends it verbatim, and
	// clingo remarks once per undefined predicate — which lands in `diagnostics`,
	// which the studio shows to the designer as a problem with *their* document.
	const rules = [...MACHINE_CHECKS, ...LADDER_CHECKS].map((check) => check.rule).join("\n");
	const scene = buttons({
		uses: [{ id: "b1" }],
		rules,
		machines: [
			machine({
				states: [{ id: "rest", parts: nudge(14) }, { id: "hover", parts: nudge(10) }],
				transitions: [
					edge({ id: "over", from: "rest", to: "hover" }),
					edge({ id: "out", from: "hover", to: "rest", trigger: "pointerleave" }),
				],
			}),
		],
	});
	const { diagnostics, count } = await explore(scene, directSolver, { limit: 8 });
	assert.equal(diagnostics, "", diagnostics);
	assert.ok(count > 0, "a healthy machine violates none of the ten");

	// ...and on a document with no machine at all, which is the case the block is
	// `#defined` for.
	const empty = buttons({ rules });
	const bare = await explore(empty, directSolver, { limit: 8 });
	assert.equal(bare.diagnostics, "", bare.diagnostics);
});

test("the three new projections move no template's universe count", async () => {
	// §8's gate, and it is not optional. `f_value/3` is projected, which is what
	// makes "this card is in one of two places" two universes; `sfval/4` was
	// projected by nothing and has been since state machines shipped, so a state
	// delta whose y held two alternatives was ONE universe with an arbitrary pick.
	// The ladder adds `kval` and the third axis adds `srval` to the same family,
	// and all three are now derived and projected.
	//
	// That partitions nothing differently on a document whose deltas each hold one
	// alternative — which is every template, because every delta in
	// `templates/machine.ts` is built with `single(...)`. But that is a fact about
	// today's templates and not about the encoding, so it is re-checked here
	// rather than assumed, exactly as the plan requires.
	for (const template of TEMPLATES) {
		const scene = template.create();
		const counts = variableCounts(scene);
		for (const [variable, count] of Object.entries(counts)) {
			if (!/^(sfval|srval|kval)\(/.test(variable)) continue;
			assert.equal(
				count,
				1,
				`${template.id}/${variable} holds ${count} alternatives, so the finer ` +
					"projection may split a universe and the goldens have to be recaptured",
			);
		}
	}
	// And the one template that holds a machine at all, counted for real: the
	// projections are in the shipped program, so this is the number the goldens
	// were captured at.
	const machineTemplate = TEMPLATES.find((entry) => entry.id === "machine");
	assert.ok(machineTemplate, "the machine template is what makes this test mean anything");
	const before = await explore(machineTemplate.create(), directSolver, { limit: 64 });
	assert.equal(before.count, 8, "unchanged by sf_value, sr_value and kf_value");
});

test("a state that lifts a part in z puts that part in the third axis, and the picture with it", async () => {
	// **A shipped gap, repaired at the encoding rather than at the reading.**
	// `StatePart.frame` is keyed over six axes and `Track.dim` spans six precisely
	// so a state may lift a mesh and a timeline may animate it — and
	// `isSpatialScene`, the twin of the compiler's `spatial.` gate, counted a
	// `viewport` node and a `spatial` or `turn` on a *node* and neither of them on
	// a delta. So `stateDimensions` handed the machine section the planar four, no
	// `sfval(I,S,N,z)` was minted, and a designer who opened the depth rows on a
	// flat part and typed a number got no atom, no picture and no warning. The
	// Inspector puts those rows behind a toggle on any node, so it was reachable
	// rather than theoretical.
	//
	// The repair is `thirdAxisParts`, and the half worth asserting is the second
	// one: the *part* becomes `zstated`, not merely its copies. The narrower fix —
	// open the gate and leave `zstated/1` alone — derives `frame(stt(...),z,V)`
	// from `sfval` because that rule leaves the dimension unbound, while
	// `s3(stt(...))` stays false. The copy would then have a z in the state that
	// sets one and none at all in the state beside it, and nothing anywhere would
	// have a `depth`. A part that is somewhere on an axis in one state and nowhere
	// on it in the next is not a design.
	const lifted = buttons({
		// Drawn in `hover`, so the instance the picture holds is the lifted one and
		// the assertion below is about a picture rather than about a copy.
		uses: [{ id: "b1", state: "hover" }],
		machines: [
			machine({
				states: [
					{ id: "rest", name: "Rest", parts: {} },
					{ id: "hover", name: "Hover", parts: { label: { frame: { z: dimension(px(40)) } } } },
				],
				transitions: [
					edge({ id: "t1", from: "rest", to: "hover", trigger: "pointerenter" }),
					edge({ id: "t2", from: "hover", to: "rest", trigger: "pointerleave" }),
				],
			}),
		],
	});
	const atoms = await only(lifted);

	assert.ok(states(lifted, "spatial."), "the gate is open");
	// On the *part* and on nothing else, asserted against the program text rather
	// than the answer set: `zstated/1` is a claim the compiler states about the
	// document, and it is not in the `#show` block because no reader outside the
	// program has any use for it.
	const program = compile(lifted).program;
	assert.ok(program.includes("\nzstated(label).\n"), "on the part itself");
	assert.equal(program.includes("\nzstated(btn).\n"), false, "and not on its parent");

	// The copy that was lifted has the z; the copy beside it has the default, not
	// nothing; and both have a depth.
	assert.equal(frameOf(atoms, "stt(b1,hover,label)").z, px(40));
	assert.equal(frameOf(atoms, "stt(b1,rest,label)").z, 0);
	assert.equal(frameOf(atoms, "stt(b1,hover,label)").depth, 0);
	// And the picture moves with the copy, which is `merged-plan` §6.1's whole
	// point: mfshadow and mlfshadow iterate one dimension list, so a state that
	// lifts a part lifts the instance and not only its own copy.
	assert.equal(frameOf(atoms, "inst(b1,label)").z, px(40), "the drawn state is hover");

	// The gate is narrow: a delta about the four planar dimensions is not a third
	// axis, and a document holding one is the flat document it always was.
	const flat = buttons({
		uses: [{ id: "b1" }],
		machines: [
			machine({
				states: [
					{ id: "rest", name: "Rest", parts: {} },
					{ id: "hover", name: "Hover", parts: nudge(30) },
				],
				transitions: [edge({ id: "t1", from: "rest", to: "hover", trigger: "pointerenter" })],
			}),
		],
	});
	assert.equal(states(flat, "spatial."), false);
	assert.deepEqual(named(await only(flat), "zstated"), []);
});

test("the contract names every predicate the ladder puts in the program", () => {
	// The CONTRACT block is what a designer reads in the power panel before
	// writing a rule, so a predicate the program derives and the contract does not
	// name is a predicate nobody can find. This is a drift guard rather than a
	// prose check: the list below is read off the emission and the rules in
	// `compile.ts`, and the moment a rung gains a predicate without gaining a
	// line here, this fails and says which.
	const ladder = [
		// Rung one: an input, and the bridge its numbers cross on.
		"minput",
		"minkind",
		"minbool",
		"minnum",
		"minlow",
		"minhigh",
		"minbounded",
		"permille",
		// Rung two: the guard, as a closed window.
		"mcond",
		"mcondin",
		"mcondop",
		"mcrange",
		"mcnot",
		"mcis",
		"mcisnot",
		"mcfired",
		"mcbad",
		"mguarded",
		"mclash",
		"mdisjoint",
		"moverlap",
		"mguardnever",
		"mfeasible",
		"mgreach",
		"mgunreached",
		// Rung three: the reserved ids and the fourth motion setting.
		"mreserved",
		"mefrom",
		"manyfrom",
		"mstops",
		"mrank",
		"mmisplaced",
		"mexit",
		"mexitpast",
		// Rung four: layers, and who writes what when two of them disagree.
		"mlayer",
		"mlindex",
		"mslayer",
		"mlfirst",
		"mlinitial",
		"mtlayer",
		"mcrosslayer",
		"mlshadow",
		"mlfshadow",
		"mlrshadow",
		"mwriter",
		"mfwriter",
		"mrwriter",
		"mowned",
		"mfowned",
		"mrowned",
		"mfight",
		"mffight",
		"mrfight",
		"mfightat",
		// Rung five: timelines, keyframe copies and blend states.
		"mtimeline",
		"mtplays",
		"mloop",
		"mtrack",
		"mtrackof",
		"mkey",
		"mkeasing",
		"mreadskeas",
		"mkat",
		"mtlen",
		"mknext",
		"mkpast",
		"mkbackwards",
		"mkbase",
		"mkpart",
		"mblend",
		"mblendin",
		"mstop",
		"mstopat",
		"mstopby",
		"mstopout",
		"mstopgap",
		"mtwosource",
		// ...and what advances one, which arrived with the gestures.
		"mclock",
		// The terms and the variable keys a rule may type.
		"kat",
		"kval",
		"keas",
		// Rung six: the curve, which is a Value now and is therefore derived,
		// projected and readable rather than a fact the emitter wrote.
		"measing",
		"mdefease",
		"measeopt",
		"mreadsease",
		"bezier",
		"tlen",
		"trkp",
		"trkd",
		"trkr",
		"kfr",
	];
	for (const predicate of ladder) {
		assert.ok(
			CONTRACT.includes(predicate),
			`the contract never mentions ${predicate}, so nobody can find it`,
		);
	}
	// And the two sentences the whole ladder rests on, which a later edit is most
	// likely to soften into something that is no longer a promise.
	assert.match(CONTRACT, /THE SOLVER DECIDES\n?%? ?KEYFRAMES AND NEVER FRAMES/);
	assert.match(CONTRACT, /THE ORDER IS THE\n%\s+PRIORITY/);
	// The blend kind reaches the program as `oneD`, never as `1d`: an ASP
	// constant may not begin with a digit, and a contract that promised the
	// spelling the spec used would promise a term no rule can hold.
	assert.match(CONTRACT, /mblend\(M, S, oneD\|direct\)/);
	assert.ok(!CONTRACT.includes("mblend(M, S, 1d"));
});
