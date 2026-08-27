/**
 * State machines, as a reading of the document.
 *
 * `machines.ts` is the one part of this feature that touches neither the
 * compiler nor React, so unlike `components.test.ts` — whose every claim is a
 * claim about the *program* and therefore goes through clingo — everything here
 * is a pure function against a hand-built scene. That is not a weaker test, it
 * is a test of a different thing: what the panel can say while the document is
 * unsatisfiable and there is no answer set at all.
 *
 * Two claims here *are* claims about the program and are held to it by their
 * shape rather than by a solve:
 *
 *   - {@link machineHealth} answers the same four questions `munreached/2`,
 *     `mdeadend/2`, `mnondet/3` and `mdangling/2` answer, so every health case
 *     below states the rule it is mirroring in its own comment. The two answers
 *     are compared against a real answer set in `machineprogram.test.ts`, which
 *     owns the compiler; when that file lands, the fixtures here are the ones it
 *     should use.
 *   - {@link materializedParts} decides how many atoms the program grounds, so
 *     every case asserts a whole set with `deepEqual` rather than membership.
 *     "It contains the leaf" is true of the wrong answer as well as the right
 *     one; the point of the analysis is everything it leaves out.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { makeNode } from "./edits.ts";
import {
	MACHINE_CHECKS,
	durationUnitOf,
	findMachine,
	findState,
	holdsStateCopy,
	initialState,
	machineForNode,
	machineForRoot,
	machineHealth,
	machineTable,
	materializedParts,
	motionLabel,
	parseStatePart,
	shownState,
	stateCopyIds,
	stateFrameVar,
	stateLabel,
	stateName,
	statePart,
	statePropVar,
	stateVarLabel,
	stepMachine,
	writeDuration,
} from "./machines.ts";
import {
	type Constraint,
	type Machine,
	type MachineState,
	MOTION_PROPS,
	type Scene,
	type SceneNode,
	TRIGGERS,
	TRIGGER_NAMES,
	type Transition,
	type Trigger,
	emptyScene,
} from "./scene.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, motionVar, msOf, single } from "./values.ts";

const px = (n: number): number => n * EMU_PER_PX;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/**
 * A card definition three levels deep, and however many uses of it.
 *
 * Written out rather than taken from a template so a test can say exactly what
 * it depends on, and shaped for the one thing the analysis has to get right: the
 * definition has a **branch** (`head`, holding `title`) and a **sibling leaf**
 * (`badge`), so "the leaf and its ancestors and nothing else" and "the container
 * but not its children" are two different sets rather than the same one written
 * twice.
 *
 *   page
 *   ├── card        (definition)
 *   │   ├── head
 *   │   │   └── title
 *   │   └── badge
 *   └── c1, c2, …   (instances)
 */
function cards(uses: Array<{ id: string; name?: string; state?: string; holds?: Record<string, number> }>): Scene {
	const title: SceneNode = {
		...makeNode("text", { x: px(8), y: px(8), width: px(120), height: px(20) }, {
			id: "title",
			name: "Title",
		}),
		props: { text: [lit("Go"), lit("Stop")], size: single("14px") },
	};
	const head: SceneNode = {
		...makeNode("frame", { x: px(0), y: px(0), width: px(200), height: px(36) }, {
			id: "head",
			name: "Head",
		}),
		props: { fill: [lit("#eeeeee")] },
		children: [title],
	};
	const badge: SceneNode = {
		...makeNode("rect", { x: px(160), y: px(48), width: px(24), height: px(24) }, {
			id: "badge",
			name: "Badge",
		}),
		props: { fill: [lit("#ef4444")] },
	};
	const definition: SceneNode = {
		...makeNode("frame", { x: px(20), y: px(20), width: px(200), height: px(96) }, {
			id: "card",
			name: "Card",
		}),
		props: { fill: [lit("#ffffff"), lit("#0f172a")], radius: single("8px") },
		children: [head, badge],
		component: true,
	};
	return {
		...emptyScene(),
		nodes: [
			{
				...makeNode("frame", { x: 0, y: 0, width: px(600), height: px(400) }, {
					id: "page",
					name: "Page",
				}),
				props: { fill: [lit("#ffffff")] },
				children: [
					definition,
					...uses.map((use, i) => ({
						...makeNode(
							"instance",
							{ x: px(300), y: px(20 + i * 120), width: px(200), height: px(96) },
							{ id: use.id, name: use.name ?? use.id },
						),
						instanceOf: "card",
						...(use.state ? { state: use.state } : {}),
						...(use.holds ? { holds: use.holds } : {}),
					})),
				],
			},
		],
	};
}

const state = (id: string, name: string, parts: MachineState["parts"] = {}): MachineState => ({
	id,
	name,
	parts,
});

const edge = (
	id: string,
	from: string,
	to: string,
	trigger: Trigger,
	extra: Partial<Transition> = {},
): Transition => ({ id, from, to, trigger, enabled: true, ...extra });

/** A machine on the card definition, with whatever states and edges a test needs. */
const machined = (
	scene: Scene,
	states: MachineState[],
	transitions: Transition[] = [],
	id = "m1",
): Scene => ({
	...scene,
	machines: [{ id, name: "Card states", root: "card", states, transitions }],
});

const rule = (
	id: string,
	kind: Constraint["kind"],
	nodes: string[],
	extra: Partial<Constraint> = {},
): Constraint => ({
	id,
	kind,
	prop: "fill",
	nodes,
	edge: "left",
	enabled: true,
	...extra,
});

/** Just the machine, for the health tests, which need no document at all. */
const bare = (states: MachineState[], transitions: Transition[]): Machine => ({
	id: "m1",
	name: "M",
	root: "card",
	states,
	transitions,
});

/* ------------------------------------------------------------------ */
/* The term scheme                                                     */
/* ------------------------------------------------------------------ */

test("a state copy's term round-trips, including a part whose id is a term", () => {
	assert.equal(statePart("c1", "hover", "title"), "stt(c1,hover,title)");
	assert.deepEqual(parseStatePart("stt(c1,hover,title)"), {
		instance: "c1",
		state: "hover",
		node: "title",
	});

	// The part id may itself be a term — a generated cell, or an instance part of
	// a nested definition. `parseAtom` counts brackets rather than splitting on
	// commas, which is the whole reason the term scheme goes through it.
	const nested = statePart("i1", "hover", "cell(1,1)");
	assert.equal(nested, "stt(i1,hover,cell(1,1))");
	assert.deepEqual(parseStatePart(nested), {
		instance: "i1",
		state: "hover",
		node: "cell(1,1)",
	});
	assert.deepEqual(parseStatePart(statePart("i1", "hover", "inst(i2,label)")), {
		instance: "i1",
		state: "hover",
		node: "inst(i2,label)",
	});
});

test("nothing else parses as a state copy", () => {
	// The three other things a constraint member can be: an instance part, a
	// datum, and a plain node id. A reader that answered for any of them would
	// make `pruneConstraints` keep a member the document does not hold.
	assert.equal(parseStatePart("inst(i,l)"), null);
	assert.equal(parseStatePart("cg(page,3,left)"), null);
	assert.equal(parseStatePart("card"), null);
	// Right name, wrong arity, which is the one that would be a silent bug: two
	// arguments is the copy-per-definition scheme this design rejected.
	assert.equal(parseStatePart("stt(hover,label)"), null);
	assert.equal(parseStatePart("stt(i1,hover,label,extra)"), null);
	assert.equal(parseStatePart(""), null);
});

test("a delta's variables are spelled the way the program spells them", () => {
	assert.equal(statePropVar("c1", "hover", "title", "fill"), "sprop(c1,hover,title,fill)");
	assert.equal(stateFrameVar("c1", "hover", "title", "x"), "sfval(c1,hover,title,x)");
	// Per instance and per state: two instances hovering to two different fills
	// is two variables, which is what makes an override survive a state.
	assert.notEqual(
		statePropVar("c1", "hover", "title", "fill"),
		statePropVar("c2", "hover", "title", "fill"),
	);
});

/* ------------------------------------------------------------------ */
/* The trigger table                                                   */
/* ------------------------------------------------------------------ */

test("a paired trigger is paired back, and the pair agrees on its pseudo-class", () => {
	// The assertion step 2 could not make about its own table, because the export
	// depends on it: a rest/hover pair collapses to `:hover` only if the two
	// halves name each other and name the same CSS condition. An asymmetric pair
	// would emit a selector for one direction and a script for the other.
	for (const name of TRIGGER_NAMES) {
		const spec = TRIGGERS[name];
		if (spec.pair === undefined) {
			assert.equal(spec.css, null, `${name} has a pseudo-class but no pair`);
			continue;
		}
		const other = TRIGGERS[spec.pair];
		assert.equal(other.pair, name, `${name} and ${spec.pair} do not pair back`);
		assert.equal(other.css, spec.css, `${name} and ${spec.pair} disagree on css`);
		assert.notEqual(spec.css, null, `${name} is paired but has no pseudo-class`);
	}
});

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

test("a machine is found by its id, by its root and through an instance", () => {
	const scene = machined(cards([{ id: "c1" }]), [state("rest", "Rest")]);
	const [machine] = scene.machines;

	assert.equal(findMachine(scene.machines, "m1"), machine);
	assert.equal(findMachine(scene.machines, "nope"), undefined);
	assert.equal(findMachine(scene.machines, undefined), undefined);
	assert.equal(machineForRoot(scene, "card"), machine);
	assert.equal(machineForRoot(scene, "page"), undefined);

	const instance = scene.nodes[0].children?.find((n) => n.id === "c1");
	assert.ok(instance);
	assert.equal(machineForNode(scene, instance), machine, "an instance is driven by its definition's");

	const definition = scene.nodes[0].children?.find((n) => n.id === "card");
	assert.ok(definition);
	assert.equal(machineForNode(scene, definition), machine, "so is the definition root itself");

	// A part *inside* the definition finds nothing, deliberately: the panel that
	// authors a delta already knows which machine it is showing, and guessing one
	// from the selection would switch it under a click on a label.
	const title = definition.children?.[0]?.children?.[0];
	assert.ok(title);
	assert.equal(machineForNode(scene, title), undefined);
});

test("a machine whose root stopped being a definition is still found", () => {
	// The blunt reading, and it is the same silence a dangling `instanceOf`
	// leaves: the record is still in the document with states and transitions in
	// it, and a panel that could not show it could not repair it. What goes quiet
	// is the *program* — asserted one test down, where the analysis materialises
	// nothing.
	const scene = machined(cards([{ id: "c1" }]), [state("rest", "Rest")]);
	const released = {
		...scene,
		nodes: [
			{
				...scene.nodes[0],
				children: scene.nodes[0].children?.map((n) => {
					if (n.id !== "card") return n;
					// `component` is `true`-or-absent, so releasing one is removing the
					// field rather than writing `false` into it — the same shape
					// `StatePart.hidden` has, and for the same reason.
					const { component: _released, ...rest } = n;
					return rest;
				}),
			},
		],
	};
	assert.equal(machineForRoot(released, "card")?.id, "m1");
	assert.deepEqual([...materializedParts(released, released.machines[0])], []);
});

test("the initial state is the first one, and a node falls back to it", () => {
	const scene = machined(
		cards([{ id: "c1" }, { id: "c2", state: "hover" }, { id: "c3", state: "gone" }]),
		[state("rest", "Rest"), state("hover", "Hover")],
	);
	const machine = scene.machines[0];
	const at = (id: string): SceneNode => {
		const node = scene.nodes[0].children?.find((n) => n.id === id);
		assert.ok(node);
		return node;
	};

	assert.equal(initialState(machine).id, "rest");
	assert.equal(shownState(machine, at("c1")), "rest", "no state is the initial one");
	assert.equal(shownState(machine, at("c2")), "hover");
	// Naming a state the machine no longer has falls back rather than failing —
	// the same judgement a dropped hold gets, and it is what leaves a machine
	// edited down with legal instances instead of broken ones.
	assert.equal(shownState(machine, at("c3")), "rest");
	assert.equal(at("c3").state, "gone", "and nothing was corrected on the way in");

	assert.equal(stateName(machine, "hover"), "Hover");
	assert.equal(stateName(machine, "gone"), "gone", "an unknown state reads as its id");
	assert.equal(findState(machine, "gone"), undefined);
});

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

test("a state copy reads as a sentence, and a non-copy reads as nothing", () => {
	const scene = machined(
		cards([{ id: "c1", name: "Card 1" }]),
		[state("rest", "Rest"), state("hover", "Hover")],
	);
	assert.equal(stateLabel(scene, "stt(c1,hover,title)"), "Title · Hover — Card 1");

	// Chained after `partLabel` and `datumLabel`, so it must answer nothing for
	// everything they answer for, and fall through to the raw id for the rest.
	assert.equal(stateLabel(scene, "inst(c1,title)"), undefined);
	assert.equal(stateLabel(scene, "cg(page,3,left)"), undefined);
	assert.equal(stateLabel(scene, "card"), undefined);

	// A copy naming things the document has let go still reads as its own ids: a
	// rule outlives what it names, and a term is more use than a blank while it
	// is being repaired.
	assert.equal(stateLabel(scene, "stt(gone,hover,title)"), "Title · hover — gone");
	assert.equal(stateLabel(scene, "stt(c1,gone,gone)"), "gone · gone — Card 1");
});

test("a delta's variable reads as the row it belongs to", () => {
	const scene = machined(
		cards([{ id: "c1", name: "Card 1" }]),
		[state("rest", "Rest"), state("hover", "Hover")],
	);
	assert.equal(
		stateVarLabel(scene, statePropVar("c1", "hover", "title", "fill")),
		"Title · Fill · Hover — Card 1",
	);
	assert.equal(
		stateVarLabel(scene, stateFrameVar("c1", "hover", "title", "x")),
		"Title · x · Hover — Card 1",
	);
	// A field no table holds is a caller minting a key out of nothing, and a
	// confident label would hide it.
	assert.equal(stateVarLabel(scene, statePropVar("c1", "hover", "title", "nope")), undefined);
	assert.equal(stateVarLabel(scene, stateFrameVar("c1", "hover", "title", "fill")), undefined);
	assert.equal(stateVarLabel(scene, "prop(title,fill)"), undefined);
});

test("a motion variable reads as its transition, and goes quiet when the edge is gone", () => {
	const scene = machined(
		cards([{ id: "c1" }]),
		[state("rest", "Rest"), state("down", "Down")],
		[edge("press", "rest", "down", "pointerdown")],
	);
	assert.equal(motionLabel(scene, motionVar("m1", "press", "duration")), "Press · Duration");
	assert.equal(motionLabel(scene, motionVar("m1", "press", "stagger")), "Press · Stagger");

	// The opposite judgement from `stateLabel`, and the reason is that a `mval`
	// key is never typed by a person: it is minted by a panel from a transition it
	// is looking at, so one that no longer matches is a bug rather than a rule.
	assert.equal(motionLabel(scene, motionVar("m1", "gone", "duration")), undefined);
	assert.equal(motionLabel(scene, motionVar("mX", "press", "duration")), undefined);
	assert.equal(motionLabel(scene, "mval(m1,press,colour)"), undefined);
	assert.equal(motionLabel(scene, "prop(title,fill)"), undefined);
});

/* ------------------------------------------------------------------ */
/* The materialisation analysis                                        */
/* ------------------------------------------------------------------ */

test("a delta on a leaf materialises the leaf and its ancestors, and nothing else", () => {
	const scene = machined(cards([{ id: "c1" }]), [
		state("rest", "Rest"),
		state("hover", "Hover", { title: { props: { fill: [lit("#111111")] } } }),
	]);
	// `badge` is a sibling and `head`'s other descendants are not touched: the
	// whole point of the analysis is what it leaves out, so this is a set
	// equality rather than three membership checks.
	assert.deepEqual(
		[...materializedParts(scene, scene.machines[0])].sort(),
		["card", "head", "title"],
	);
});

test("a delta on the root alone materialises the root alone", () => {
	// The cheapest real machine there is — "the whole card darkens on hover" —
	// and the one the grounding budget is stated against: one copy per state per
	// instance, whatever the definition is made of.
	const scene = machined(cards([{ id: "c1" }]), [
		state("rest", "Rest"),
		state("hover", "Hover", { card: { props: { fill: [lit("#0f172a")] } } }),
	]);
	assert.deepEqual([...materializedParts(scene, scene.machines[0])], ["card"]);
});

test("a state that moves a container does not materialise its children", () => {
	// The payoff of parent-relative frames, and the reason `StatePart.frame` is
	// specified in the part's own coordinates: a state that lifts the head lifts
	// the title inside it for nothing. Downward is free; upward is not.
	const scene = machined(cards([{ id: "c1" }]), [
		state("rest", "Rest"),
		state("open", "Open", { head: { frame: { y: single("8px") } } }),
	]);
	assert.deepEqual([...materializedParts(scene, scene.machines[0])].sort(), ["card", "head"]);
});

test("hiding a part materialises it; saying nothing does not", () => {
	const hidden = machined(cards([{ id: "c1" }]), [
		state("open", "Open"),
		state("closed", "Closed", { badge: { hidden: true } }),
	]);
	assert.deepEqual([...materializedParts(hidden, hidden.machines[0])].sort(), ["badge", "card"]);

	// The four spellings of "says nothing", which an edit that cleared its last
	// property leaves behind. Materialising on one of these would mint a `sprop`
	// variable with no alternatives on the strength of a leftover.
	const empty = machined(cards([{ id: "c1" }]), [
		state("rest", "Rest"),
		state("hover", "Hover", {
			title: {},
			badge: { props: {} },
			head: { props: { fill: [] } },
			card: { frame: { x: [] } },
		}),
	]);
	assert.deepEqual([...materializedParts(empty, empty.machines[0])], []);
});

test("a delta on a part the definition has not got materialises nothing", () => {
	// Kept in the document by `normalizeScene` — a definition edited down leaves
	// its machine legal — so the analysis is where it goes quiet.
	const scene = machined(cards([{ id: "c1" }]), [
		state("rest", "Rest"),
		state("hover", "Hover", { footer: { props: { fill: [lit("#111111")] } } }),
	]);
	assert.deepEqual([...materializedParts(scene, scene.machines[0])], []);
});

test("a geometric constraint materialises the part it names, with no delta anywhere", () => {
	// The "only a gsolved child needs its own copy" half. Naming a node in a
	// geometric constraint hands it to simplex, and a node simplex places has to
	// be placeable per state or the two states share one answer.
	const base = machined(cards([{ id: "c1" }]), [state("rest", "Rest"), state("hover", "Hover")]);
	const named = { ...base, constraints: [rule("pin", "align", ["badge", "page"])] };
	assert.deepEqual([...materializedParts(named, named.machines[0])].sort(), ["badge", "card"]);

	// The three spellings of the same part, at three removes: the part itself,
	// the instance's copy, and one state's copy. A cross-state rule names the
	// third, and that is a rule about the part.
	for (const member of ["title", "inst(c1,title)", "stt(c1,hover,title)"]) {
		const one = { ...base, constraints: [rule("pin", "align", [member, "page"])] };
		assert.deepEqual(
			[...materializedParts(one, one.machines[0])].sort(),
			["card", "head", "title"],
			member,
		);
	}
});

test("a switched-off or non-geometric constraint materialises nothing", () => {
	const base = machined(cards([{ id: "c1" }]), [state("rest", "Rest"), state("hover", "Hover")]);
	// Off is out of the program, so it hands nothing to simplex.
	const off = { ...base, constraints: [rule("pin", "align", ["badge", "page"], { enabled: false })] };
	assert.deepEqual([...materializedParts(off, off.machines[0])], []);
	// And a property rule talks about `rendered/3`, which every copy already has
	// through the shared variable — there is nothing per-state to place.
	const property = { ...base, constraints: [rule("same", "match", ["badge", "head"])] };
	assert.deepEqual([...materializedParts(property, property.machines[0])], []);
});

test("a machine whose states are all empty materialises nothing", () => {
	const scene = machined(cards([{ id: "c1" }]), [
		state("rest", "Rest"),
		state("hover", "Hover"),
		state("down", "Down"),
	]);
	assert.deepEqual([...materializedParts(scene, scene.machines[0])], []);
	// Legal, useless and free: no copies means no atoms, whatever the states cost
	// to write down.
	assert.deepEqual(stateCopyIds(scene), []);
});

test("the analysis is per definition, so instances multiply it and holds do not change it", () => {
	// Three uses, one of which holds an override of the definition's fill. A hold
	// is a *pick*, and picks are the design space; the copies are behaviour. The
	// two are a matrix, so the second must not move when the first does.
	const held = machined(
		cards([
			{ id: "c1" },
			{ id: "c2", holds: { "prop(card,fill)": 1 } },
			{ id: "c3", holds: { "prop(title,text)": 1 } },
		]),
		[state("rest", "Rest"), state("hover", "Hover", { title: { frame: { y: single("4px") } } })],
	);
	const plain = machined(
		cards([{ id: "c1" }]),
		[state("rest", "Rest"), state("hover", "Hover", { title: { frame: { y: single("4px") } } })],
	);
	assert.deepEqual(
		[...materializedParts(held, held.machines[0])].sort(),
		[...materializedParts(plain, plain.machines[0])].sort(),
	);

	// The instances multiply it here, in document order: instance, then state,
	// then part — and the parts in the definition's own order, because this is a
	// menu a person reads.
	assert.deepEqual(stateCopyIds(held), [
		"stt(c1,rest,card)",
		"stt(c1,rest,head)",
		"stt(c1,rest,title)",
		"stt(c1,hover,card)",
		"stt(c1,hover,head)",
		"stt(c1,hover,title)",
		"stt(c2,rest,card)",
		"stt(c2,rest,head)",
		"stt(c2,rest,title)",
		"stt(c2,hover,card)",
		"stt(c2,hover,head)",
		"stt(c2,hover,title)",
		"stt(c3,rest,card)",
		"stt(c3,rest,head)",
		"stt(c3,rest,title)",
		"stt(c3,hover,card)",
		"stt(c3,hover,head)",
		"stt(c3,hover,title)",
	]);
});

/* ------------------------------------------------------------------ */
/* What a rule may name                                                */
/* ------------------------------------------------------------------ */

test("a state copy is held while the instance and the state are, whatever is materialised", () => {
	const scene = machined(
		cards([{ id: "c1" }]),
		[state("rest", "Rest"), state("hover", "Hover", { title: { frame: { y: single("4px") } } })],
	);
	const member = statePart("c1", "hover", "title");
	assert.equal(holdsStateCopy(scene, member), true);

	// Blunter than `stateCopyIds` on purpose, exactly as `holdsDatum` is blunter
	// than `datumIds`. Clearing the delta un-materialises the part — the copy is
	// gone from the offered members — and the rule must survive it, or repairing a
	// delta would mean retyping a rule.
	const cleared = machined(scene, [state("rest", "Rest"), state("hover", "Hover")]);
	assert.deepEqual(stateCopyIds(cleared), []);
	assert.equal(holdsStateCopy(cleared, member), true);

	// Deleting the state is the thing that lets go: there is no state for the
	// term to name in any universe, now or after an edit to a delta.
	const dropped = machined(scene, [state("rest", "Rest")]);
	assert.equal(holdsStateCopy(dropped, member), false);

	// So is deleting the instance, or the definition's machine.
	assert.equal(holdsStateCopy(scene, statePart("gone", "hover", "title")), false);
	assert.equal(holdsStateCopy({ ...scene, machines: [] }, member), false);
	// A definition root is not an instance and never gets a copy.
	assert.equal(holdsStateCopy(scene, statePart("card", "hover", "title")), false);
	// And everything that is not a state copy at all is somebody else's question.
	assert.equal(holdsStateCopy(scene, "inst(c1,title)"), false);
	assert.equal(holdsStateCopy(scene, "title"), false);
});

/* ------------------------------------------------------------------ */
/* Machine health                                                      */
/* ------------------------------------------------------------------ */

test("an unreachable state is found", () => {
	// munreached(M,S) :- mstate(M,S), not mreach(M,S).
	const health = machineHealth(
		bare(
			[state("rest", "Rest"), state("hover", "Hover"), state("lost", "Lost")],
			[edge("in", "rest", "hover", "pointerenter"), edge("out", "hover", "rest", "pointerleave")],
		),
	);
	assert.deepEqual(health.unreachable, ["lost"]);
	assert.deepEqual(health.dangling, []);
	assert.deepEqual(health.nondeterministic, []);
});

test("reachability follows a chain and survives a cycle", () => {
	// mreach(M,S2) :- mreach(M,S1), mfrom(M,T,S1), mto(M,T,S2) — a graph, and a
	// cycle between two states is the *normal* shape rather than an edge case.
	const health = machineHealth(
		bare(
			[state("a", "A"), state("b", "B"), state("c", "C")],
			[
				edge("t1", "a", "b", "pointerenter"),
				edge("t2", "b", "c", "click"),
				edge("t3", "c", "a", "pointerleave"),
			],
		),
	);
	assert.deepEqual(health.unreachable, []);
	assert.deepEqual(health.deadEnds, []);
});

test("a dead end is found", () => {
	// mleaves(M,S) :- mfrom(M,_,S).  mdeadend(M,S) :- mstate(M,S), not mleaves(M,S).
	const health = machineHealth(
		bare(
			[state("rest", "Rest"), state("gone", "Gone")],
			[edge("go", "rest", "gone", "click")],
		),
	);
	assert.deepEqual(health.deadEnds, ["gone"]);
	assert.deepEqual(health.unreachable, []);
});

test("a nondeterministic pair is found once, and named by its state and trigger", () => {
	// mnondet(M,S,G) :- mfrom(M,T1,S), mfrom(M,T2,S), T1 < T2, mtrigger(M,T1,G),
	//                   mtrigger(M,T2,G).
	const health = machineHealth(
		bare(
			[state("rest", "Rest"), state("a", "A"), state("b", "B")],
			[
				edge("one", "rest", "a", "click"),
				edge("two", "rest", "b", "click"),
				edge("three", "rest", "a", "pointerenter"),
				edge("back", "a", "rest", "click"),
				edge("home", "b", "rest", "click"),
			],
		),
	);
	// Three edges leave `rest` and two of them share a trigger: one pair, not two
	// entries and not one per transition.
	assert.deepEqual(health.nondeterministic, [["rest", "click"]]);
	assert.deepEqual(health.unreachable, []);
	assert.deepEqual(health.deadEnds, []);
});

test("a dangling transition is found, and does not make its own destination unreachable", () => {
	// mdangling(M,T) :- mfrom(M,T,S), not mstate(M,S).  …and the same for mto.
	const health = machineHealth(
		bare(
			[state("rest", "Rest"), state("hover", "Hover")],
			[
				edge("in", "rest", "hover", "pointerenter"),
				edge("out", "hover", "rest", "pointerleave"),
				edge("broken", "rest", "deleted", "click"),
				edge("orphan", "deleted", "rest", "click"),
			],
		),
	);
	assert.deepEqual(health.dangling.sort(), ["broken", "orphan"]);
	// Reachability follows an edge whose destination is not a state, which is why
	// `mreach/2` does not check `mstate/2`: a dangling edge is reported as
	// dangling, and not *also* as the reason a real state went unreached.
	assert.deepEqual(health.unreachable, []);
});

test("a switched-off transition is out of the program, so health counts it as absent", () => {
	// mtrans/2, mfrom/3 and mto/3 are emitted for enabled transitions only. So
	// switching an edge off can make a state unreachable, which is exactly what a
	// person means by switching it off.
	const states = [state("rest", "Rest"), state("hover", "Hover")];
	const on = machineHealth(bare(states, [edge("in", "rest", "hover", "pointerenter")]));
	assert.deepEqual(on.unreachable, []);
	assert.deepEqual(on.deadEnds, ["hover"]);

	const off = machineHealth(
		bare(states, [edge("in", "rest", "hover", "pointerenter", { enabled: false })]),
	);
	assert.deepEqual(off.unreachable, ["hover"]);
	assert.deepEqual(off.deadEnds, ["rest", "hover"]);
	// And a disabled edge is not a dangling one, however broken it is.
	const brokenOff = machineHealth(
		bare(states, [edge("in", "rest", "deleted", "click", { enabled: false })]),
	);
	assert.deepEqual(brokenOff.dangling, []);
});

test("the healthy two-state machine everybody builds is reported as healthy", () => {
	const health = machineHealth(
		bare(
			[state("rest", "Rest"), state("hover", "Hover")],
			[edge("in", "rest", "hover", "pointerenter"), edge("out", "hover", "rest", "pointerleave")],
		),
	);
	assert.deepEqual(health, {
		unreachable: [],
		deadEnds: [],
		nondeterministic: [],
		dangling: [],
	});
});

test("the canned checks are ordinary custom rules naming the derived predicates", () => {
	const wanted = [
		"machine_reachable",
		"machine_no_dead_ends",
		"machine_deterministic",
		"machine_wired",
	];
	assert.deepEqual(MACHINE_CHECKS.map((c) => c.id), wanted);
	for (const check of MACHINE_CHECKS) {
		// The id is both the constraint's term and the head of its body: for a
		// `custom` constraint those are one thing, which is why there is no
		// separate name to map back at every hop.
		assert.ok(check.rule.startsWith(`viol(${check.id}) :- `), check.id);
		assert.ok(check.rule.endsWith("."), check.id);
		assert.ok(check.label.length > 0, check.id);
		// An ASP constant, or the rule does not ground.
		assert.match(check.id, /^[a-z][A-Za-z0-9_]*$/);
	}
	assert.equal(
		MACHINE_CHECKS[2].rule,
		"viol(machine_deterministic) :- mnondet(_,_,_).",
	);
});

/* ------------------------------------------------------------------ */
/* The runtime table                                                   */
/* ------------------------------------------------------------------ */

test("the table carries the instances a machine drives, each starting where it is drawn", () => {
	const scene = machined(
		cards([{ id: "c1" }, { id: "c2", state: "hover" }]),
		[state("rest", "Rest"), state("hover", "Hover")],
		[edge("in", "rest", "hover", "pointerenter"), edge("out", "hover", "rest", "pointerleave")],
	);
	const table = machineTable(scene);

	assert.deepEqual(table.instances, {
		c1: { machine: "m1", initial: "rest" },
		// `SceneNode.state` is what `data-state` is initialised to, so an exported
		// file starts where the document was drawn.
		c2: { machine: "m1", initial: "hover" },
	});
	assert.deepEqual(table.machines, {
		m1: {
			initial: "rest",
			states: ["rest", "hover"],
			edges: {
				rest: { pointerenter: "hover" },
				hover: { pointerleave: "rest" },
			},
		},
	});
	// The table is JSON in somebody's exported page, so it round-trips.
	assert.deepEqual(JSON.parse(JSON.stringify(table)), table);
});

test("a machine nothing uses is not in the table at all", () => {
	// Which is what lets an export with no drawn machine emit no script: an empty
	// table is the signal, and a machine with no instances would falsify it.
	const scene = machined(cards([]), [state("rest", "Rest")]);
	assert.deepEqual(machineTable(scene), { instances: {}, machines: {} });
});

test("disabled and dangling edges are left out of the table", () => {
	const scene = machined(
		cards([{ id: "c1" }]),
		[state("rest", "Rest"), state("hover", "Hover")],
		[
			edge("in", "rest", "hover", "pointerenter"),
			edge("off", "rest", "hover", "click", { enabled: false }),
			// A destination the machine has not got would write a `data-state` no
			// rule in the file matches — a runtime that silently stops matching
			// anything is worse than one that does not move.
			edge("broken", "rest", "deleted", "focus"),
		],
	);
	const table = machineTable(scene);
	// Absent and empty mean the same thing to the lookup, and this table is JSON
	// in a `<script>` tag in somebody's exported page — so a state nothing leaves
	// gets no row at all.
	assert.equal(table.machines.m1.edges.hover, undefined, "a state nothing leaves gets no row");
	assert.deepEqual(table.machines.m1.edges, { rest: { pointerenter: "hover" } });
});

test("stepMachine follows an edge, refuses one that is not there, and takes the first of two", () => {
	const scene = machined(
		cards([{ id: "c1" }]),
		[state("rest", "Rest"), state("hover", "Hover"), state("down", "Down")],
		[
			edge("in", "rest", "hover", "pointerenter"),
			edge("out", "hover", "rest", "pointerleave"),
			edge("press", "rest", "down", "click"),
			// The second edge on the same (from, trigger). The panel reports the pair
			// through `mnondet/3`; until it is fixed, the studio and the exported file
			// must at least do the same thing, and the first one written is it.
			edge("press_too", "rest", "hover", "click"),
		],
	);
	const table = machineTable(scene);

	assert.equal(stepMachine(table, "c1", "rest", "pointerenter"), "hover");
	assert.equal(stepMachine(table, "c1", "hover", "pointerleave"), "rest");
	assert.equal(stepMachine(table, "c1", "rest", "click"), "down", "first enabled edge wins");
	assert.equal(stepMachine(table, "c1", "hover", "click"), undefined, "no edge, no move");
	assert.equal(stepMachine(table, "c1", "down", "pointerenter"), undefined, "a dead end stays");
	assert.equal(stepMachine(table, "c1", "gone", "click"), undefined, "an unknown state moves nowhere");
	assert.equal(stepMachine(table, "nobody", "rest", "click"), undefined, "so does an unknown instance");
});

/* ------------------------------------------------------------------ */
/* Writing a duration down                                             */
/* ------------------------------------------------------------------ */

test("a duration is written back in the unit it was already in, and reads back exactly", () => {
	assert.equal(writeDuration(200), "200ms");
	assert.equal(writeDuration(200, "ms"), "200ms");
	assert.equal(writeDuration(200, "s"), "0.2s");
	assert.equal(writeDuration(1000, "s"), "1s");
	assert.equal(writeDuration(1500, "s"), "1.5s");
	assert.equal(writeDuration(1, "s"), "0.001s");
	assert.equal(writeDuration(0, "s"), "0s");
	assert.equal(writeDuration(0, "ms"), "0ms");
	assert.equal(writeDuration(-250, "s"), "-0.25s");
	assert.equal(writeDuration(-250, "ms"), "-250ms");

	// The property that matters: what is written is read back by the same reader
	// the compiler uses, exactly. `msOf` is exact or nothing, so a spelling it
	// cannot read would put a number in the panel that no exported file agrees
	// with.
	for (const ms of [0, 1, 7, 120, 200, 999, 1000, 1234, -1, -999, -1500, 600000]) {
		for (const unit of ["ms", "s"] as const) {
			assert.equal(msOf(writeDuration(ms, unit)), ms, `${ms}${unit}`);
		}
	}

	// Whole milliseconds are the contract; the rounding is the same editorial act
	// `nearestMs` is, in the one place spelling it exactly would blank the field.
	assert.equal(writeDuration(1.5), "2ms");
	assert.equal(writeDuration(1.4, "s"), "0.001s");
});

test("the unit a duration was written in is read back, defaulting to milliseconds", () => {
	assert.equal(durationUnitOf("200ms"), "ms");
	assert.equal(durationUnitOf("0.2s"), "s");
	assert.equal(durationUnitOf(" 200 MS "), "ms");
	assert.equal(durationUnitOf("1S"), "s");
	// A bare number carries no unit; `msOf` refuses it, and the caller writing a
	// value into a field that held one has to pick something.
	assert.equal(durationUnitOf("200"), "ms");
	assert.equal(durationUnitOf("200", "s"), "s");
	assert.equal(durationUnitOf(""), "ms");
});

test("every motion fallback is a duration this file can write and read", () => {
	// The table's own defaults reach ASP as `mdefdur/1` and friends, so a fallback
	// no reader could read would make a transition with no duration at all.
	for (const prop of ["duration", "delay", "stagger"] as const) {
		const ms = msOf(MOTION_PROPS[prop].fallback);
		assert.notEqual(ms, undefined, prop);
		assert.equal(writeDuration(ms as number, durationUnitOf(MOTION_PROPS[prop].fallback)), MOTION_PROPS[prop].fallback);
	}
});
