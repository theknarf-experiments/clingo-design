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
	BASE_LAYER,
	LADDER_CHECKS,
	MACHINE_CHECKS,
	type RuntimeEdge,
	blendWeights,
	composeStates,
	durationUnitOf,
	edgeAllows,
	findMachine,
	findState,
	guardImpossible,
	guardsDisjoint,
	guardsOverlap,
	holdsKeyCopy,
	holdsStateCopy,
	initialState,
	inputInitial,
	inputRange,
	keyCopy,
	keyCopyLabel,
	keyframeCopyIds,
	keyframeLabel,
	keyframeParts,
	layerInitial,
	layerOf,
	layerStates,
	machineForNode,
	machineForRoot,
	machineHealth,
	machineLayers,
	machineTable,
	materializedParts,
	motionLabel,
	normalizeCondition,
	parseKeyCopy,
	parseStatePart,
	parseTrack,
	sampleTimeline,
	shownState,
	shownStates,
	solvedKeys,
	statePart,
	statePlays,
	statePropVar,
	stateCopyIds,
	stateFrameVar,
	stateLabel,
	stateName,
	stateTurnLabel,
	stateTurnVar,
	stateVarLabel,
	stepInstance,
	stepLayer,
	stepMachine,
	timelineLength,
	timelinePosition,
	trackDim,
	trackProp,
	trackTerm,
	trackTurn,
	transitionExit,
	writeDuration,
} from "./machines.ts";
import {
	type Blend,
	type CompareOp,
	type Condition,
	type Constraint,
	type Easing,
	type Keyframe,
	type Machine,
	type MachineInput,
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
import { findInTree } from "./tree.ts";
import { EMU_PER_PX } from "./units.ts";
import {
	MAX_PERMILLE,
	keyTimeVar,
	keyValueVar,
	lit,
	motionVar,
	msOf,
	single,
	timelineLenVar,
} from "./values.ts";

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
	// Every member, and `deepEqual` on the whole record rather than four
	// memberships: the point of a health reading is what it does *not* say, and a
	// machine that a later rung starts complaining about is exactly the regression
	// this shape is here to catch.
	assert.deepEqual(health, {
		unreachable: [],
		deadEnds: [],
		nondeterministic: [],
		dangling: [],
		impossible: [],
		unreachableWithGuards: [],
		misplaced: [],
		fights: [],
		frameFights: [],
		turnFights: [],
		stopsOutOfRange: [],
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
		c1: { machine: "m1", initial: "rest", layerStart: { base: "rest" } },
		// `SceneNode.state` is what `data-state` is initialised to, so an exported
		// file starts where the document was drawn — and `layerStart` says the same
		// thing per layer, which on a machine with no layers is the one implicit
		// `base` layer and nothing else.
		c2: { machine: "m1", initial: "hover", layerStart: { base: "hover" } },
	});
	assert.deepEqual(table.machines, {
		m1: {
			initial: "rest",
			states: ["rest", "hover"],
			// The shipped edge table, unchanged: one destination per (state,
			// trigger), no guards and no Any expansion. This is what every reader
			// that has not learned about layers still reads.
			edges: {
				rest: { pointerenter: "hover" },
				hover: { pointerleave: "rest" },
			},
			layers: [
				{
					id: "base",
					initial: "rest",
					states: ["rest", "hover"],
					edges: {
						rest: { pointerenter: [{ to: "hover" }] },
						hover: { pointerleave: [{ to: "rest" }] },
					},
				},
			],
			inputs: {},
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

/* ------------------------------------------------------------------ */
/* The ladder: fixtures                                                */
/* ------------------------------------------------------------------ */

/**
 * The card scene, with whatever a rung needs bolted onto its machine.
 *
 * A second builder beside {@link machined} rather than more optional arguments
 * on that one, because every test above says exactly what it depends on and a
 * builder with eight optional fields would make each of them say it by omission.
 */
const laddered = (states: MachineState[], extra: Partial<Machine>, uses = [{ id: "c1" }]): Scene => {
	const scene = machined(cards(uses), states);
	return { ...scene, machines: [{ ...scene.machines[0], ...extra }] };
};

const key = (at: string, value: string, easing?: Easing): Keyframe => ({
	at: single(at),
	value: single(value),
	...(easing ? { easing } : {}),
});

const numberInput = (id: string, extra: Partial<MachineInput> = {}): MachineInput => ({
	id,
	name: id,
	kind: "number",
	...extra,
});

const condition = (input: string, op: CompareOp, value?: string): Condition => ({
	input,
	op,
	...(value === undefined ? {} : { value }),
});

/* ------------------------------------------------------------------ */
/* Layers                                                              */
/* ------------------------------------------------------------------ */

test("a machine with no layers has exactly one, and everything agrees about it", () => {
	const machine = bare([state("rest", "Rest"), state("hover", "Hover")], []);
	assert.deepEqual(machineLayers(machine), [{ id: BASE_LAYER, name: "Base" }]);

	// Every state belongs to it, whatever the states say — including one naming a
	// layer the machine has not got, which falls back rather than orphaning the
	// state. That is `SceneNode.state`'s judgement: a machine edited down leaves
	// its states legal.
	for (const state of machine.states) assert.equal(layerOf(machine, state), BASE_LAYER);
	const stray = bare([{ ...state("rest", "Rest"), layer: "gone" }], []);
	assert.equal(layerOf(stray, stray.states[0]), BASE_LAYER);

	// The layer's initial state and the machine's are the same one, and they have
	// to be: `minitial/2` is kept as the first layer's.
	assert.equal(layerInitial(machine, BASE_LAYER)?.id, initialState(machine).id);
	assert.deepEqual(layerStates(machine, BASE_LAYER).map((s) => s.id), ["rest", "hover"]);
	// An empty `layers: []` means the same as no layers at all. A machine with no
	// layer would be a machine with no states, since every state is in one, and
	// that is not a thing the document can mean — it is what deleting the last
	// layer leaves behind.
	assert.deepEqual(machineLayers({ ...machine, layers: [] }), machineLayers(machine));
});

test("two layers each start in their own first state, in document order", () => {
	const machine = bare(
		[
			state("rest", "Rest"),
			{ ...state("glow", "Glow"), layer: "fx" },
			state("hover", "Hover"),
			{ ...state("dim", "Dim"), layer: "fx" },
		],
		[],
	);
	const layered: Machine = {
		...machine,
		layers: [
			{ id: "base", name: "Base" },
			{ id: "fx", name: "Effects" },
		],
	};
	assert.deepEqual(layerStates(layered, "base").map((s) => s.id), ["rest", "hover"]);
	assert.deepEqual(layerStates(layered, "fx").map((s) => s.id), ["glow", "dim"]);
	assert.equal(layerInitial(layered, "fx")?.id, "glow");
	// The machine's own initial state is still the *first layer's*, unchanged.
	assert.equal(initialState(layered).id, "rest");
	// A layer nobody has put a state in yet has no initial state, and says so
	// rather than inventing one — which is what a layer somebody just added is.
	assert.equal(layerInitial({ ...layered, layers: [...layered.layers ?? [], { id: "new", name: "New" }] }, "new"), undefined);
});

test("shownStates on a document that has never heard of layers is shownState, once", () => {
	const scene = machined(
		cards([{ id: "c1" }, { id: "c2", state: "hover" }]),
		[state("rest", "Rest"), state("hover", "Hover")],
	);
	const machine = scene.machines[0];
	for (const id of ["c1", "c2"]) {
		const node = findInTree(scene.nodes, id);
		assert.ok(node);
		assert.deepEqual(shownStates(machine, node), {
			[BASE_LAYER]: shownState(machine, node),
		});
	}
});

test("SceneNode.states says a further layer, and wins over state for the first", () => {
	const scene = machined(
		cards([{ id: "c1" }, { id: "c2", state: "hover" }]),
		[
			state("rest", "Rest"),
			{ ...state("glow", "Glow"), layer: "fx" },
			state("hover", "Hover"),
			{ ...state("dim", "Dim"), layer: "fx" },
		],
	);
	const machine: Machine = {
		...scene.machines[0],
		layers: [
			{ id: "base", name: "Base" },
			{ id: "fx", name: "Effects" },
		],
	};
	const node = findInTree(scene.nodes, "c2");
	assert.ok(node);
	// `state` alone says the first layer and the second takes its own initial.
	assert.deepEqual(shownStates(machine, node), { base: "hover", fx: "glow" });

	// An entry in the record for the first layer wins over the string, so there is
	// exactly one place a multi-layer document says the whole answer.
	const both = { ...node, states: { base: "rest", fx: "dim" } };
	assert.deepEqual(shownStates(machine, both), { base: "rest", fx: "dim" });

	// A stored state has to be a state *of that layer*. Naming layer two's state
	// under layer one would draw one picture on top of itself, which is exactly
	// what `mtwoshown/1` is there to report and what nothing here should cause.
	const crossed = { ...node, states: { base: "dim" } };
	assert.deepEqual(shownStates(machine, crossed), { base: "rest", fx: "glow" });
	// And a state the machine no longer holds falls back rather than failing.
	assert.deepEqual(shownStates(machine, { ...node, states: { fx: "gone" } }), {
		base: "hover",
		fx: "glow",
	});
});

/* ------------------------------------------------------------------ */
/* Tracks and keyframe copies                                          */
/* ------------------------------------------------------------------ */

test("a track's term round-trips through all three shapes", () => {
	assert.equal(trackProp("panel", "fill"), "trkp(panel,fill)");
	assert.equal(trackDim("panel", "y"), "trkd(panel,y)");
	assert.equal(trackTurn("panel", "rotateZ"), "trkr(panel,rotateZ)");
	assert.deepEqual(parseTrack("trkp(panel,fill)"), { node: "panel", prop: "fill" });
	assert.deepEqual(parseTrack("trkd(panel,y)"), { node: "panel", dim: "y" });
	assert.deepEqual(parseTrack("trkr(panel,rotateZ)"), { node: "panel", turn: "rotateZ" });
	assert.equal(parseTrack("stt(c1,hover,title)"), null);
	assert.equal(parseTrack("panel"), null);

	// A track names exactly one field, and one that names none is no track — the
	// same reading the document reader gives it, which is why nothing downstream
	// has to invent a default field for it.
	assert.equal(trackTerm({ part: "panel", dim: "z", keys: [] }), "trkd(panel,z)");
	assert.equal(trackTerm({ part: "panel", turn: "rotateY", keys: [] }), "trkr(panel,rotateY)");
	assert.equal(trackTerm({ part: "panel", keys: [] }), undefined);
});

test("a keyframe copy's term round-trips, including a part whose id is a term", () => {
	const term = keyCopy("c1", "open", trackDim("panel", "y"), 3);
	assert.equal(term, "kfr(c1,open,trkd(panel,y),3)");
	assert.deepEqual(parseKeyCopy(term), {
		instance: "c1",
		timeline: "open",
		track: "trkd(panel,y)",
		index: 3,
	});
	// The part inside the track may itself be a term. `parseAtom` counts brackets,
	// which is the whole reason nothing here splits on commas.
	const nested = keyCopy("c1", "open", trackDim("cell(1,1)", "y"), 1);
	assert.deepEqual(parseKeyCopy(nested)?.track, "trkd(cell(1,1),y)");

	// Nothing else is a keyframe copy, including the other two copy terms.
	for (const other of ["stt(c1,hover,title)", "inst(c1,title)", "title", "kfr(c1,open,x)"]) {
		assert.equal(parseKeyCopy(other), null, other);
	}
	// An index that does not spell itself back is a term nothing here minted, and
	// reading it as key 3 would let a hand-typed rule name a copy the program
	// never mints and then wonder why it says nothing.
	assert.equal(parseKeyCopy("kfr(c1,open,trkd(panel,y),03)"), null);
	assert.equal(parseKeyCopy("kfr(c1,open,trkd(panel,y),x)"), null);
});

/* ------------------------------------------------------------------ */
/* The keyframe-copy budget                                            */
/* ------------------------------------------------------------------ */

/** A nine-keyframe timeline over the card's badge, and a state that plays it. */
const timelined = (uses = [{ id: "c1" }]): Scene =>
	laddered(
		[state("rest", "Rest"), { ...state("open", "Open"), timeline: "slide" }],
		{
			timelines: [
				{
					id: "slide",
					name: "Slide",
					tracks: [
						{
							part: "badge",
							dim: "y",
							keys: Array.from({ length: 9 }, (_, i) =>
								key(`${i * 25}ms`, `${i * 4}px`),
							),
						},
					],
				},
			],
		},
		uses,
	);

test("a timeline nobody has written a rule about mints no keyframe copies at all", () => {
	// The rationing, asserted as the absence it is. A timeline on its own costs
	// two variables per keyframe and one per timeline, and nothing else — which is
	// enough for the export and enough for the canvas, both of which interpolate.
	const scene = timelined();
	assert.deepEqual([...keyframeParts(scene, scene.machines[0])], []);
});

test("a rule naming one keyframe copy mints that track's part and its ancestors", () => {
	const scene = timelined();
	const member = keyCopy("c1", "slide", trackDim("badge", "y"), 4);
	const named = { ...scene, constraints: [rule("pin", "align", [member, "page"])] };
	const parts = keyframeParts(named, named.machines[0]);
	// The part the track animates, and the chain up to the definition's root —
	// upward only, because a copy's world coordinate is its parent's plus its own
	// and a chain with a link missing lands it in the instance's coordinates
	// rather than on the canvas.
	assert.deepEqual([...(parts.get("slide") ?? [])].sort(), ["badge", "card"]);
	// And nothing for a timeline no rule named.
	assert.deepEqual([...parts.keys()], ["slide"]);

	// A rule naming a track the timeline has not got, or another machine's
	// timeline, mints nothing: answering for it would hang copies off an instance
	// with no such track.
	for (const stray of [
		keyCopy("c1", "slide", trackDim("badge", "x"), 1),
		keyCopy("c1", "gone", trackDim("badge", "y"), 1),
	]) {
		const other = { ...scene, constraints: [rule("pin", "align", [stray, "page"])] };
		assert.deepEqual([...keyframeParts(other, other.machines[0])], [], stray);
	}
	// Off is out of the program, so it hands nothing to simplex.
	const off = {
		...scene,
		constraints: [rule("pin", "align", [member, "page"], { enabled: false })],
	};
	assert.deepEqual([...keyframeParts(off, off.machines[0])], []);
});

test("a state that plays a timeline materialises what the timeline animates", () => {
	// Missing this is not a slow document, it is a wrong one: the state's settled
	// pose is the timeline's value at its own length, and with no copy there is
	// nowhere for that pose to be.
	const scene = timelined();
	assert.deepEqual(
		[...materializedParts(scene, scene.machines[0])].sort(),
		["badge", "card"],
	);

	// A timeline nothing plays materialises nothing, which is the other half of
	// the same sentence and is how somebody works on one before wiring it up.
	const unplayed = laddered([state("rest", "Rest")], {
		timelines: scene.machines[0].timelines,
	});
	assert.deepEqual([...materializedParts(unplayed, unplayed.machines[0])], []);
});

test("a blend state materialises every timeline any of its stops names", () => {
	const scene = laddered(
		[
			state("rest", "Rest"),
			{
				...state("drawer", "Drawer"),
				blend: {
					kind: "oneD",
					input: "open",
					stops: [
						{ timeline: "shut", at: "0" },
						{ timeline: "wide", at: "1" },
						{ timeline: "gone", at: "2" },
					],
				},
			},
		],
		{
			inputs: [numberInput("open", { min: "0", max: "1" })],
			timelines: [
				{ id: "shut", name: "Shut", tracks: [{ part: "badge", dim: "y", keys: [key("0ms", "0px")] }] },
				{ id: "wide", name: "Wide", tracks: [{ part: "title", prop: "fill", keys: [key("0ms", "#fff")] }] },
			],
		},
	);
	// `badge` and `title` and their ancestors; the third stop names a timeline the
	// machine has not got and contributes nothing, which is the same silence a
	// dangling `instanceOf` leaves.
	assert.deepEqual(
		[...materializedParts(scene, scene.machines[0])].sort(),
		["badge", "card", "head", "title"],
	);
	// And `statePlays` is where that judgement is made, once.
	const machine = scene.machines[0];
	assert.deepEqual(
		statePlays(machine, machine.states[1]).map((w) => w.id),
		["shut", "wide"],
	);
	// A state holding both a timeline and a blend yields the blend's, and the pair
	// is reported as `mtwosource/2` rather than repaired.
	const both = { ...machine.states[1], timeline: "shut" };
	assert.deepEqual(statePlays(machine, both).map((w) => w.id), ["shut", "wide"]);
});

test("a keyframe rule survives an unrelated edit, and a deleted key does not", () => {
	const scene = timelined();
	const member = keyCopy("c1", "slide", trackDim("badge", "y"), 4);
	assert.equal(holdsKeyCopy(scene, member), true);

	// Blunt in the same place `holdsStateCopy` is: held whatever the analysis
	// says, because the rule is the only thing that makes the copy exist and
	// asking whether the copy exists would be a loop that eats itself.
	assert.deepEqual([...keyframeParts(scene, scene.machines[0])], []);

	// The index *is* checked, and that asymmetry is deliberate: a track that has
	// lost its ninth key has lost it, and no edit brings it back the way re-adding
	// a delta brings a materialised part back.
	assert.equal(holdsKeyCopy(scene, keyCopy("c1", "slide", trackDim("badge", "y"), 10)), false);
	assert.equal(holdsKeyCopy(scene, keyCopy("c1", "slide", trackDim("badge", "y"), 0)), false);
	assert.equal(holdsKeyCopy(scene, keyCopy("gone", "slide", trackDim("badge", "y"), 1)), false);
	assert.equal(holdsKeyCopy(scene, keyCopy("c1", "gone", trackDim("badge", "y"), 1)), false);
	assert.equal(holdsKeyCopy(scene, statePart("c1", "rest", "badge")), false);

	// The menu the Rules panel offers is every key of every track, unfiltered by
	// the analysis — because the analysis is seeded from the rules, so filtering
	// by it would mean there was never a first rule.
	const offered = keyframeCopyIds(scene);
	assert.equal(offered.length, 9);
	assert.equal(offered[3], member);
	assert.ok(offered.every((id) => holdsKeyCopy(scene, id)));
});

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

test("a rotation delta and a keyframe both have a sentence a panel can print", () => {
	const scene = timelined();
	assert.equal(stateTurnVar("c1", "hover", "badge", "rotateZ"), "srval(c1,hover,badge,rotateZ)");
	assert.equal(
		stateVarLabel(scene, stateTurnVar("c1", "rest", "badge", "rotateZ")),
		"Badge · Turn about Z · Rest — c1",
	);
	assert.equal(
		stateTurnLabel(scene, stateTurnVar("c1", "rest", "badge", "rotateZ")),
		"Badge · Turn about Z · Rest — c1",
	);
	// The rotation-only reader answers nothing for a fill, so a rotation row
	// cannot label something that is not a rotation.
	assert.equal(stateTurnLabel(scene, statePropVar("c1", "rest", "badge", "fill")), undefined);
	// And the general one spans all six axes, not the planar four: a state may
	// lift a mesh, so the variable for that lift has to have a name.
	assert.equal(
		stateVarLabel(scene, stateFrameVar("c1", "rest", "badge", "z")),
		"Badge · z · Rest — c1",
	);

	assert.equal(
		keyframeLabel(scene, keyTimeVar("m1", "slide", trackDim("badge", "y"), 3)),
		"Badge · y · Slide · key 3 · at",
	);
	assert.equal(
		keyframeLabel(scene, keyValueVar("m1", "slide", trackDim("badge", "y"), 3)),
		"Badge · y · Slide · key 3 · value",
	);
	assert.equal(keyframeLabel(scene, timelineLenVar("m1", "slide")), "Slide · length");
	// A key a panel minted out of a timeline that is gone is the caller's bug, and
	// a confident sentence would hide it exactly where it needs to be visible —
	// `motionLabel`'s judgement, not `stateLabel`'s.
	assert.equal(keyframeLabel(scene, timelineLenVar("m1", "gone")), undefined);

	// A copy term, on the other hand, was typed into a rule by a person, and the
	// rule outlives the thing it names.
	assert.equal(
		keyCopyLabel(scene, keyCopy("c1", "slide", trackDim("badge", "y"), 4)),
		"Badge · y · Slide · key 4 — c1",
	);
	assert.equal(
		keyCopyLabel(scene, keyCopy("c1", "gone", trackDim("badge", "y"), 4)),
		"Badge · y · gone · key 4 — c1",
	);
	assert.equal(keyCopyLabel(scene, statePart("c1", "rest", "badge")), undefined);
});

/* ------------------------------------------------------------------ */
/* Inputs, and the arithmetic of a guard                               */
/* ------------------------------------------------------------------ */

test("an input's starting value and range reach the program in thousandths", () => {
	assert.equal(inputInitial({ id: "on", name: "On", kind: "boolean" }), false);
	assert.equal(inputInitial({ id: "on", name: "On", kind: "boolean", initial: "true" }), true);
	// An unreadable value takes the kind's own fallback rather than being carried:
	// a runtime that started a boolean at "maybe" is a machine nothing can reason
	// about.
	assert.equal(inputInitial({ id: "on", name: "On", kind: "boolean", initial: "yes" }), false);
	assert.equal(inputInitial(numberInput("open", { initial: "0.5" })), 500);
	assert.equal(inputInitial(numberInput("open", { initial: "12" })), 12000);
	// Exact or nothing, exactly as `permilleOf` is: half a thousandth is not a
	// whole thousandth, and rounding it would put a number in the program nobody
	// typed.
	assert.equal(inputInitial(numberInput("open", { initial: "0.0005" })), 0);
	// A trigger has no resting value, because "not fired" is the absence of one.
	assert.equal(inputInitial({ id: "go", name: "Go", kind: "trigger", initial: "1" }), undefined);

	// Absent is open, not zero, in both directions and on both other kinds.
	assert.deepEqual(inputRange(numberInput("open")), {});
	assert.deepEqual(inputRange(numberInput("open", { min: "0" })), { min: 0 });
	assert.deepEqual(inputRange(numberInput("open", { min: "0", max: "1" })), { min: 0, max: 1000 });
	assert.deepEqual(inputRange({ id: "on", name: "On", kind: "boolean", min: "0" }), {});
});

test("six operators become one closed window, and gt is exact", () => {
	const machine = bare([state("rest", "Rest")], []);
	const withInput: Machine = { ...machine, inputs: [numberInput("open")] };
	const at = (op: CompareOp, value: string) =>
		normalizeCondition(withInput, condition("open", op, value));

	assert.deepEqual(at("eq", "0.5"), { input: "open", kind: "range", lo: 500, hi: 500 });
	assert.deepEqual(at("ge", "0.5"), { input: "open", kind: "range", lo: 500, hi: MAX_PERMILLE });
	// `v + 1` and not `v + ε`: the moment a quantity is a whole number of
	// something, "greater than" and "at least one more than" are the same claim.
	assert.deepEqual(at("gt", "0.5"), { input: "open", kind: "range", lo: 501, hi: MAX_PERMILLE });
	assert.deepEqual(at("le", "0.5"), { input: "open", kind: "range", lo: -MAX_PERMILLE, hi: 500 });
	assert.deepEqual(at("lt", "0.5"), { input: "open", kind: "range", lo: -MAX_PERMILLE, hi: 499 });
	// A hole is not an interval, so `ne` gets no window and is carried as the one
	// point it excludes.
	assert.deepEqual(at("ne", "0.5"), { input: "open", kind: "not", value: 500 });

	const booleans: Machine = {
		...machine,
		inputs: [{ id: "on", name: "On", kind: "boolean" }, { id: "go", name: "Go", kind: "trigger" }],
	};
	assert.deepEqual(normalizeCondition(booleans, condition("on", "eq", "true")), {
		input: "on",
		kind: "is",
		value: true,
	});
	assert.deepEqual(normalizeCondition(booleans, condition("on", "ne", "false")), {
		input: "on",
		kind: "isNot",
		value: false,
	});
	assert.deepEqual(normalizeCondition(booleans, condition("go", "fired")), {
		input: "go",
		kind: "fired",
	});
});

test("a condition that is not one comes back as a sentence, never as a throw", () => {
	// `mcbad/3`, and it is a value rather than an exception because a half-written
	// condition is the ordinary state of a row somebody is typing into.
	const machine: Machine = {
		...bare([state("rest", "Rest")], []),
		inputs: [numberInput("open"), { id: "on", name: "On", kind: "boolean" }],
	};
	for (const bad of [
		condition("gone", "eq", "1"),
		condition("on", "gt", "1"),
		condition("open", "eq", "half"),
		condition("open", "eq"),
	]) {
		const read = normalizeCondition(machine, bad);
		assert.equal(read.kind, "bad", JSON.stringify(bad));
		assert.ok(read.kind === "bad" && read.why.length > 0);
	}
});

test("an impossible guard is impossible for three different reasons", () => {
	const machine: Machine = {
		...bare([state("rest", "Rest"), state("hover", "Hover")], []),
		inputs: [numberInput("open", { min: "0", max: "1" }), { id: "on", name: "On", kind: "boolean" }],
	};
	const guarded = (conditions: Condition[]): Transition =>
		edge("in", "rest", "hover", "click", { conditions });

	// Two of its own conditions that cannot both hold.
	assert.equal(
		guardImpossible(machine, guarded([condition("open", "gt", "0.5"), condition("open", "lt", "0.3")])),
		true,
	);
	assert.equal(
		guardImpossible(machine, guarded([condition("on", "eq", "true"), condition("on", "eq", "false")])),
		true,
	);
	assert.equal(
		guardImpossible(machine, guarded([condition("open", "eq", "0.5"), condition("open", "ne", "0.5")])),
		true,
	);
	// A window that misses the input's own declared range entirely.
	assert.equal(guardImpossible(machine, guarded([condition("open", "gt", "2")])), true);
	assert.equal(guardImpossible(machine, guarded([condition("open", "lt", "-1")])), true);
	// A condition that is not a condition.
	assert.equal(guardImpossible(machine, guarded([condition("gone", "eq", "1")])), true);

	// And the ordinary shapes are not impossible: an unguarded edge, a window
	// inside the range, and two conditions about two different inputs, which can
	// always both hold because there is no relation between them.
	assert.equal(guardImpossible(machine, edge("in", "rest", "hover", "click")), false);
	assert.equal(guardImpossible(machine, guarded([condition("open", "ge", "0.5")])), false);
	assert.equal(
		guardImpossible(machine, guarded([condition("open", "gt", "0.5"), condition("on", "eq", "true")])),
		false,
	);
	// With no range declared, the same guard says nothing — absent is open.
	const open: Machine = { ...machine, inputs: [numberInput("open")] };
	assert.equal(guardImpossible(open, guarded([condition("open", "gt", "2")])), false);
});

test("two unguarded edges overlap, which is what keeps the shipped check the shipped check", () => {
	const machine: Machine = {
		...bare([state("rest", "Rest")], []),
		inputs: [numberInput("open")],
	};
	const guard = (op: CompareOp, value: string) => [normalizeCondition(machine, condition("open", op, value))];
	assert.equal(guardsOverlap([], []), true);
	assert.equal(guardsOverlap(guard("gt", "0.5"), []), true);
	assert.equal(guardsDisjoint(guard("gt", "0.5"), guard("lt", "0.3")), true);
	// Symmetric by construction rather than by a closure rule.
	assert.equal(guardsDisjoint(guard("lt", "0.3"), guard("gt", "0.5")), true);
	assert.equal(guardsDisjoint(guard("ge", "0.5"), guard("le", "0.5")), false);
});

/* ------------------------------------------------------------------ */
/* Health: the six new answers                                         */
/* ------------------------------------------------------------------ */

test("an impossible guard makes its destination unreachable, and only under guards", () => {
	// The two answers differing *is* the feature: the shipped check walks every
	// edge, the guard-aware one walks the ones a valuation could take.
	const machine: Machine = {
		...bare(
			[state("rest", "Rest"), state("hover", "Hover")],
			[edge("in", "rest", "hover", "click", { conditions: [condition("open", "gt", "2")] })],
		),
		inputs: [numberInput("open", { min: "0", max: "1" })],
	};
	const health = machineHealth(machine);
	assert.deepEqual(health.impossible, ["in"]);
	assert.deepEqual(health.unreachable, []);
	assert.deepEqual(health.unreachableWithGuards, ["hover"]);
});

test("unreachable is a subset of unreachableWithGuards on every machine here", () => {
	// The document half of the inclusion proof: `mgreach` walks a subset of
	// `mreach`'s edges, so `munreached` is a subset of `mgunreached`. Asserted as
	// a property over every shape this section builds rather than as one example.
	const shapes: Machine[] = [
		bare([state("rest", "Rest")], []),
		bare(
			[state("rest", "Rest"), state("hover", "Hover"), state("lost", "Lost")],
			[edge("in", "rest", "hover", "pointerenter")],
		),
		{
			...bare(
				[state("rest", "Rest"), state("hover", "Hover")],
				[edge("in", "rest", "hover", "click", { conditions: [condition("open", "gt", "2")] })],
			),
			inputs: [numberInput("open", { min: "0", max: "1" })],
		},
		bare(
			[state("rest", "Rest"), state("hover", "Hover")],
			[edge("in", "any", "hover", "click"), edge("out", "hover", "exit", "click")],
		),
		bare([state("rest", "Rest")], [edge("in", "entry", "rest", "load")]),
	];
	for (const machine of shapes) {
		const health = machineHealth(machine);
		for (const state of health.unreachable) {
			assert.ok(
				health.unreachableWithGuards.includes(state),
				`${state} is unreachable but not unreachable-with-guards`,
			);
		}
	}
});

test("Entry, Any and Exit are three words and not three states", () => {
	const machine = bare(
		[state("rest", "Rest"), state("hover", "Hover")],
		[
			// Entry is sugar over the initial state, so this leaves `rest`.
			edge("start", "entry", "rest", "load"),
			// Any leaves every state of its layer, so `hover` is not a dead end.
			edge("reset", "any", "rest", "click"),
			// And Exit is a destination that stops the layer. Something leaves
			// `hover`, so `hover` is not a dead end either.
			edge("done", "hover", "exit", "blur"),
			edge("in", "rest", "hover", "pointerenter"),
		],
	);
	const health = machineHealth(machine);
	// None of the three is a dangling end, and none of them is a state.
	assert.deepEqual(health.dangling, []);
	assert.deepEqual(health.misplaced, []);
	assert.deepEqual(health.unreachable, []);
	assert.deepEqual(health.deadEnds, []);

	// A reserved id in the wrong position is its own mistake with its own name,
	// because "this edge names a state you deleted" and "this edge tries to leave
	// Exit" are fixed two different ways.
	const wrong = bare(
		[state("rest", "Rest")],
		[
			edge("a", "exit", "rest", "click"),
			edge("b", "rest", "entry", "click"),
			edge("c", "rest", "any", "click"),
			edge("d", "rest", "gone", "focus"),
		],
	);
	const bad = machineHealth(wrong);
	assert.deepEqual(bad.misplaced, ["a", "b", "c"]);
	assert.deepEqual(bad.dangling, ["d"]);
});

test("a specific edge beside an Any edge is not nondeterminism, and two Any edges are", () => {
	const one = bare(
		[state("rest", "Rest"), state("hover", "Hover")],
		[edge("fall", "any", "rest", "click"), edge("in", "rest", "hover", "click")],
	);
	assert.deepEqual(machineHealth(one).nondeterministic, []);

	const two = bare(
		[state("rest", "Rest"), state("hover", "Hover")],
		[edge("a", "any", "rest", "click"), edge("b", "any", "hover", "click")],
	);
	// Both states of the layer, because an Any edge leaves every one of them.
	assert.deepEqual(machineHealth(two).nondeterministic, [
		["rest", "click"],
		["hover", "click"],
	]);
});

test("two edges whose guards cannot both hold are a dispatch table, not a coin toss", () => {
	const machine: Machine = {
		...bare(
			[state("rest", "Rest"), state("open", "Open"), state("shut", "Shut")],
			[
				edge("a", "rest", "open", "click", { conditions: [condition("wide", "gt", "0.5")] }),
				edge("b", "rest", "shut", "click", { conditions: [condition("wide", "lt", "0.3")] }),
			],
		),
		inputs: [numberInput("wide")],
	};
	assert.deepEqual(machineHealth(machine).nondeterministic, []);

	// Overlapping guards, on the other hand, really are two answers to one event.
	const overlapping: Machine = {
		...machine,
		transitions: [
			edge("a", "rest", "open", "click", { conditions: [condition("wide", "gt", "0.5")] }),
			edge("b", "rest", "shut", "click", { conditions: [condition("wide", "gt", "0.2")] }),
		],
	};
	assert.deepEqual(machineHealth(overlapping).nondeterministic, [["rest", "click"]]);
});

test("two layers with an opinion about one field are reported, per field and per kind", () => {
	const machine: Machine = {
		...bare(
			[
				state("rest", "Rest", {
					badge: {
						props: { fill: [lit("#111111")] },
						frame: { y: single("4px") },
						turn: { rotateZ: single("10deg") },
					},
				}),
				{
					...state("glow", "Glow", {
						badge: {
							props: { fill: [lit("#eeeeee")], opacity: single("0.5") },
							frame: { y: single("8px") },
							turn: { rotateZ: single("20deg") },
						},
					}),
					layer: "fx",
				},
			],
			[],
		),
		layers: [
			{ id: "base", name: "Base" },
			{ id: "fx", name: "Effects" },
		],
	};
	const health = machineHealth(machine);
	// Per field, not per part: a layer that moves a badge and a layer that
	// recolours it are not fighting, and `opacity` is owned by one layer only.
	assert.deepEqual(health.fights, [["base", "fx", "badge", "fill"]]);
	assert.deepEqual(health.frameFights, [["base", "fx", "badge", "y"]]);
	assert.deepEqual(health.turnFights, [["base", "fx", "badge", "rotateZ"]]);

	// One layer, however many states, is never a fight: the states of one layer
	// are alternatives in time rather than opinions at once.
	const flat: Machine = { ...machine, layers: undefined, states: machine.states.map((s) => ({ ...s, layer: undefined })) };
	assert.deepEqual(machineHealth(flat).fights, []);
	assert.deepEqual(machineHealth(flat).frameFights, []);
	assert.deepEqual(machineHealth(flat).turnFights, []);

	// And a value cleared in place owns nothing, so clearing one row does not
	// silently end a fight the other layer is still in.
	const cleared: Machine = {
		...machine,
		states: [{ ...machine.states[0], parts: { badge: { props: { fill: [] } } } }, machine.states[1]],
	};
	assert.deepEqual(machineHealth(cleared).fights, []);
});

test("a blend stop outside its input's range is dead code that ships", () => {
	const machine: Machine = {
		...bare(
			[
				{
					...state("drawer", "Drawer"),
					blend: {
						kind: "oneD",
						input: "open",
						stops: [
							{ timeline: "shut", at: "0" },
							{ timeline: "wide", at: "1" },
							{ timeline: "past", at: "2" },
						],
					},
				},
			],
			[],
		),
		inputs: [numberInput("open", { min: "0", max: "1" })],
	};
	assert.deepEqual(machineHealth(machine).stopsOutOfRange, [["drawer", 2]]);

	// An input with no declared range says nothing, in both directions: a check
	// that invented `0`..`100` would report against a claim nobody made.
	const open: Machine = { ...machine, inputs: [numberInput("open")] };
	assert.deepEqual(machineHealth(open).stopsOutOfRange, []);
});

test("the six new checks are one line of ASP each, held apart until their predicates exist", () => {
	assert.deepEqual(
		LADDER_CHECKS.map((c) => c.id),
		[
			"machine_guards_possible",
			"machine_states_live",
			"machine_layers_agree",
			"machine_blend_in_range",
			"machine_exit_within_duration",
			"machine_exit_before_end",
		],
	);
	// The shipped four are unchanged, and the six are *not* in them: their bodies
	// name predicates the generated program does not derive yet, and a canned
	// check offered before its predicate exists puts a clingo remark in the
	// designer's diagnostics about their own document.
	assert.equal(MACHINE_CHECKS.length, 4);
	for (const check of LADDER_CHECKS) {
		assert.ok(check.rule.startsWith(`viol(${check.id}) :- `), check.id);
		assert.ok(check.rule.endsWith("."), check.id);
		// One line, because `addMachineCheck` replaces the first line under a head
		// and drops the rest — so a two-line check could be half-edited by a person
		// and half-restored by the panel.
		assert.ok(!check.rule.includes("\n"), `${check.id} is one line`);
		assert.match(check.id, /^[a-z][A-Za-z0-9_]*$/);
		assert.ok(check.label.length > 0, check.id);
	}
	// The layer check has three disjuncts, one per kind of fight, because a check
	// that reported `opacity` and stayed silent about `rotateZ` would be a check
	// that says it covers layers and does not.
	const layers = LADDER_CHECKS[2].rule;
	for (const derived of ["mfight(", "mffight(", "mrfight("]) {
		assert.ok(layers.includes(derived), derived);
	}
});

/* ------------------------------------------------------------------ */
/* Exit time, and stepping                                             */
/* ------------------------------------------------------------------ */

test("an exit time is a duration Value that follows a token and clamps at zero", () => {
	const machine = bare([state("rest", "Rest"), state("hover", "Hover")], []);
	// Zero by default, which is "any time", and is what every transition in every
	// existing document means.
	assert.equal(transitionExit(machine, edge("in", "rest", "hover", "click")), 0);
	assert.equal(
		transitionExit(machine, edge("in", "rest", "hover", "click", { exit: single("300ms") })),
		300,
	);
	assert.equal(
		transitionExit(machine, edge("in", "rest", "hover", "click", { exit: single("0.3s") })),
		300,
	);
	// A negative exit time would be a transition takeable before its own state
	// began, which is not a thing to ask for however generously it is read.
	assert.equal(
		transitionExit(machine, edge("in", "rest", "hover", "click", { exit: single("-50ms") })),
		0,
	);
	// Exact or nothing, so a value no whole millisecond spells takes the default
	// rather than being rounded behind the designer's back.
	assert.equal(
		transitionExit(machine, edge("in", "rest", "hover", "click", { exit: single("1.5ms") })),
		0,
	);
	// And it is an ordinary `duration` Value, so it follows the motion scale.
	const context = {
		tokens: [{ id: "beat", name: "Beat", type: "duration" as const, value: single("240ms") }],
		picks: {},
	};
	assert.equal(
		transitionExit(
			machine,
			edge("in", "rest", "hover", "click", { exit: [{ kind: "token", token: "beat" }] }),
			context,
		),
		240,
	);
});

test("edgeAllows answers a boolean, six numeric operators, a trigger and a clock", () => {
	const unguarded: RuntimeEdge = { to: "hover" };
	assert.equal(edgeAllows(unguarded), true);

	const bool = (op: CompareOp, value: boolean): RuntimeEdge => ({
		to: "hover",
		when: [{ input: "on", op, value }],
	});
	assert.equal(edgeAllows(bool("eq", true), { on: true }), true);
	assert.equal(edgeAllows(bool("eq", true), { on: false }), false);
	assert.equal(edgeAllows(bool("ne", true), { on: false }), true);

	const num = (op: CompareOp): RuntimeEdge => ({
		to: "hover",
		when: [{ input: "open", op, value: 500 }],
	});
	for (const [op, at500, at600] of [
		["eq", true, false],
		["ne", false, true],
		["gt", false, true],
		["lt", false, false],
		["ge", true, true],
		["le", true, false],
	] as Array<[CompareOp, boolean, boolean]>) {
		assert.equal(edgeAllows(num(op), { open: 500 }), at500, `${op} at 500`);
		assert.equal(edgeAllows(num(op), { open: 600 }), at600, `${op} at 600`);
	}

	// A trigger is a moment: it is in the fired set for one evaluation or it is
	// not there at all.
	const fired: RuntimeEdge = { to: "hover", when: [{ input: "go", op: "fired" }] };
	assert.equal(edgeAllows(fired, {}, new Set(["go"])), true);
	assert.equal(edgeAllows(fired, {}, new Set()), false);

	// An input the store has not been given fails every condition about it. The
	// store is seeded from every declared input, so a missing entry means the
	// input is not this machine's — and answering true would let a typo open an
	// edge.
	assert.equal(edgeAllows(bool("eq", true), {}), false);

	// The exit gate is `held < exit`, strictly: an edge with a 300ms exit time
	// fires *at* 300ms. A trigger arriving before then is dropped, not deferred.
	const gated: RuntimeEdge = { to: "hover", exit: 300 };
	assert.equal(edgeAllows(gated, {}, new Set(), 299), false);
	assert.equal(edgeAllows(gated, {}, new Set(), 300), true);
	assert.equal(edgeAllows(gated, {}, new Set(), 301), true);
	// With no clock at all every gate is open, which is what a caller that is not
	// timing anything means.
	assert.equal(edgeAllows(gated), true);
});

test("stepLayer distinguishes nothing moved, the layer stopped, and where it went", () => {
	const scene = laddered(
		[state("rest", "Rest"), state("hover", "Hover")],
		{
			transitions: [
				edge("in", "rest", "hover", "pointerenter"),
				edge("done", "hover", "exit", "blur"),
			],
		},
	);
	const table = machineTable(scene);
	assert.equal(stepLayer(table, "c1", BASE_LAYER, "rest", "pointerenter"), "hover");
	// `null` is the layer stopping, and it is a different answer from `undefined`:
	// a caller that conflated them would keep listening to a machine that has said
	// it is finished.
	assert.equal(stepLayer(table, "c1", BASE_LAYER, "hover", "blur"), null);
	assert.equal(stepLayer(table, "c1", BASE_LAYER, "hover", "pointerenter"), undefined);
	assert.equal(stepLayer(table, "c1", "gone", "rest", "pointerenter"), undefined);
	assert.equal(stepLayer(table, "gone", BASE_LAYER, "rest", "pointerenter"), undefined);
});

test("a guarded edge is refused and the next one gets its turn", () => {
	const scene = laddered(
		[state("rest", "Rest"), state("open", "Open"), state("shut", "Shut")],
		{
			inputs: [numberInput("wide")],
			transitions: [
				edge("a", "rest", "open", "click", { conditions: [condition("wide", "gt", "0.5")] }),
				edge("b", "rest", "shut", "click"),
			],
		},
	);
	const table = machineTable(scene);
	assert.equal(stepLayer(table, "c1", BASE_LAYER, "rest", "click", { wide: 900 }), "open");
	// The guard refuses, so the unguarded edge behind it is taken — which is the
	// whole reason the table holds a list rather than one destination.
	assert.equal(stepLayer(table, "c1", BASE_LAYER, "rest", "click", { wide: 100 }), "shut");
	// The input's own declared initial is what the store is seeded from, so an
	// empty store here is "nobody has driven it" and the guard is not met.
	assert.equal(stepLayer(table, "c1", BASE_LAYER, "rest", "click"), "shut");
});

test("an Any edge is tried after the specific one, and only inside its own layer", () => {
	const scene = laddered(
		[
			state("rest", "Rest"),
			state("hover", "Hover"),
			{ ...state("glow", "Glow"), layer: "fx" },
		],
		{
			layers: [
				{ id: "base", name: "Base" },
				{ id: "fx", name: "Effects" },
			],
			transitions: [
				edge("fall", "any", "rest", "click"),
				edge("in", "rest", "hover", "click"),
			],
		},
	);
	const table = machineTable(scene);
	// Specific first: from `rest` the specific edge wins, and the Any edge behind
	// it is the fallback nobody could override if the order were the other way.
	assert.equal(stepLayer(table, "c1", "base", "rest", "click"), "hover");
	assert.equal(stepLayer(table, "c1", "base", "hover", "click"), "rest");
	// The Any edge belongs to the layer its *destination* is in, so it does not
	// reach into the effects layer at all.
	assert.equal(stepLayer(table, "c1", "fx", "glow", "click"), undefined);
});

test("an edge with a reserved word at both ends belongs to no layer, in both readings", () => {
	// `any` to `exit` is "stop some layer", and there is no answer to which — no
	// state anywhere in the edge to say. The table drops it and `machineHealth`
	// gives it no effective source, which are the same answer said twice, and the
	// two agreeing is the whole discipline of this file.
	const scene = laddered(
		[state("rest", "Rest"), { ...state("glow", "Glow"), layer: "fx" }],
		{
			layers: [
				{ id: "base", name: "Base" },
				{ id: "fx", name: "Effects" },
			],
			transitions: [edge("stop", "any", "exit", "click")],
		},
	);
	const table = machineTable(scene);
	assert.equal(stepLayer(table, "c1", "base", "rest", "click"), undefined);
	assert.equal(stepLayer(table, "c1", "fx", "glow", "click"), undefined);
	// And it leaves nothing, so both states are still dead ends rather than one of
	// them being quietly rescued by an edge no layer owns.
	assert.deepEqual(machineHealth(scene.machines[0]).deadEnds, ["rest", "glow"]);
});

test("stepInstance steps every layer at once and leaves the ones nothing moved", () => {
	const scene = laddered(
		[
			state("rest", "Rest"),
			state("hover", "Hover"),
			{ ...state("dim", "Dim"), layer: "fx" },
			{ ...state("bright", "Bright"), layer: "fx" },
			{ ...state("shut", "Shut"), layer: "menu" },
		],
		{
			layers: [
				{ id: "base", name: "Base" },
				{ id: "fx", name: "Effects" },
				{ id: "menu", name: "Menu" },
			],
			transitions: [
				edge("in", "rest", "hover", "pointerenter"),
				edge("lit", "dim", "bright", "pointerenter"),
			],
		},
	);
	const table = machineTable(scene);
	const at = { base: "rest", fx: "dim", menu: "shut" };
	// Two layers move on one trigger and the third stays where it was: a trigger
	// may mean something in one layer and nothing in another, and both answers are
	// true in the same moment.
	assert.deepEqual(stepInstance(table, "c1", at, "pointerenter"), {
		base: "hover",
		fx: "bright",
		menu: "shut",
	});
	// Nothing moved anywhere is `undefined`, the same answer for the same reason
	// `stepLayer` gives per layer.
	assert.equal(stepInstance(table, "c1", at, "click"), undefined);
	assert.equal(stepInstance(table, "gone", at, "pointerenter"), undefined);
});

test("the shipped stepMachine still answers the shipped question", () => {
	// The back-compatible half: the first layer, one state in, one state out, no
	// guards and no Any expansion. Every caller that has it today is asking about
	// a one-layer machine and gets exactly the answer it got.
	const scene = laddered(
		[state("rest", "Rest"), state("hover", "Hover")],
		{ transitions: [edge("in", "rest", "hover", "pointerenter")] },
	);
	const table = machineTable(scene);
	assert.equal(stepMachine(table, "c1", "rest", "pointerenter"), "hover");
	assert.equal(stepMachine(table, "c1", "hover", "pointerenter"), undefined);
});

/* ------------------------------------------------------------------ */
/* Composing, sampling, mixing                                         */
/* ------------------------------------------------------------------ */

test("the later layer wins the field, and only the field", () => {
	const machine: Machine = {
		...bare(
			[
				state("rest", "Rest", {
					badge: { props: { fill: [lit("#111111")], opacity: single("1") }, frame: { y: single("4px") } },
					title: { hidden: true },
				}),
				{
					...state("glow", "Glow", {
						badge: { props: { fill: [lit("#eeeeee")] } },
					}),
					layer: "fx",
				},
			],
			[],
		),
		layers: [
			{ id: "base", name: "Base" },
			{ id: "fx", name: "Effects" },
		],
	};
	const composed = composeStates(machine, { base: "rest", fx: "glow" });
	// Per field: the later layer takes `fill` and the earlier one keeps `opacity`
	// and the move. A resolution per *part* would have silently dropped both.
	assert.deepEqual(composed.badge.props?.fill, [lit("#eeeeee")]);
	assert.deepEqual(composed.badge.props?.opacity, single("1"));
	assert.deepEqual(composed.badge.frame?.y, single("4px"));
	// Hiding is a union rather than a last-writer, because hiding does not
	// conflict: any layer that hides, hides.
	assert.equal(composed.title.hidden, true);

	// A record naming another layer's state composes nothing for that layer,
	// rather than composing one layer's pose twice.
	assert.deepEqual(composeStates(machine, { base: "glow" }), {});
});

test("a timeline's length is its own, or its last keyframe, and never both", () => {
	const machine = laddered([state("rest", "Rest")], {
		timelines: [
			{
				id: "slide",
				name: "Slide",
				tracks: [{ part: "badge", dim: "y", keys: [key("0ms", "0px"), key("400ms", "40px")] }],
			},
		],
	}).machines[0];
	const timeline = machine.timelines?.[0];
	assert.ok(timeline);
	// Derived where the document is silent, so a timeline cannot disagree with its
	// own contents.
	assert.equal(timelineLength(machine, timeline), 400);
	// Present and shorter is legal and means what it says: the tail is not played.
	assert.equal(timelineLength(machine, { ...timeline, length: single("250ms") }), 250);
	// A timeline with nothing in it has a length, and it is zero rather than an
	// error — that is what a timeline somebody just created is.
	assert.equal(timelineLength(machine, { ...timeline, tracks: [] }), 0);
});

test("a timeline folds into its own length by loop mode, and never by a frame rate", () => {
	assert.equal(timelinePosition(0, 400), 0);
	assert.equal(timelinePosition(500, 400, "none"), 400);
	assert.equal(timelinePosition(500, 400, "loop"), 100);
	// Forwards and then backwards over twice the length, which is what the word
	// means and what `animation-direction: alternate` does.
	assert.equal(timelinePosition(500, 400, "pingPong"), 300);
	assert.equal(timelinePosition(800, 400, "pingPong"), 0);
	assert.equal(timelinePosition(900, 400, "pingPong"), 100);
	// A zero-length timeline is at 0 forever, which is the only answer that is not
	// a division by zero — and it is a real state rather than a degenerate one.
	assert.equal(timelinePosition(500, 0, "loop"), 0);
	// Before the start is the first frame. Unlike a transition's delay there is no
	// reading of "before it began" that is anything else.
	assert.equal(timelinePosition(-100, 400, "loop"), 0);
});

test("sampling says which two keyframes a moment sits between, and never a value", () => {
	const machine = laddered([state("rest", "Rest")], {
		timelines: [
			{
				id: "slide",
				name: "Slide",
				tracks: [
					{
						part: "badge",
						dim: "y",
						keys: [key("0ms", "0px", "linear"), key("200ms", "20px"), key("400ms", "40px")],
					},
					// A track with no field is no track, and is skipped entirely rather
					// than sampled to nothing.
					{ part: "title", keys: [key("0ms", "x")] },
				],
			},
		],
	}).machines[0];
	const timeline = machine.timelines?.[0];
	assert.ok(timeline);

	const at100 = sampleTimeline(machine, timeline, 100);
	assert.deepEqual(Object.keys(at100), ["trkd(badge,y)"]);
	const one = at100["trkd(badge,y)"];
	assert.equal(one.from?.index, 1);
	assert.equal(one.to?.index, 2);
	assert.equal(one.t, 0.5);
	// The easing is the one on `from`, because easing describes the segment
	// *leaving* a keyframe.
	assert.equal(one.easing, "linear");

	// At the last keyframe there is nowhere to travel to, and the fraction is zero
	// rather than a division by a span that does not exist.
	const end = sampleTimeline(machine, timeline, 400)["trkd(badge,y)"];
	assert.equal(end.from?.index, 3);
	assert.equal(end.to, undefined);
	assert.equal(end.t, 0);

	// What comes back is which two keyframes and how far, not a value: a colour
	// interpolates in a colour space and a word does not interpolate at all, and
	// this file knows about documents rather than about pixels.
	assert.equal("value" in one, false);
});

test("keyframes that resolved out of order are sorted through rather than reasoned about", () => {
	// A keyframe's time is a `Value`, so it resolves per universe and can land
	// before the one in front of it. That is not something a linter over the
	// document could catch — it is a property of an answer — and a sampler that
	// met a backwards segment would be a sampler with a negative fraction in it.
	const machine = laddered([state("rest", "Rest")], {
		timelines: [
			{
				id: "slide",
				name: "Slide",
				tracks: [
					{
						part: "badge",
						dim: "y",
						keys: [key("400ms", "40px"), key("100ms", "10px"), key("200ms", "20px")],
					},
				],
			},
		],
	}).machines[0];
	const timeline = machine.timelines?.[0];
	assert.ok(timeline);
	const keys = solvedKeys(machine, timeline, timeline.tracks[0]);
	assert.deepEqual(keys.map((k) => [k.index, k.at]), [
		[2, 100],
		[3, 200],
		[1, 400],
	]);
	// A keyframe whose time reads as no duration sits at 0 rather than being
	// dropped, because dropping it would renumber every key after it and quietly
	// change which one a rule was about.
	const broken = { ...timeline.tracks[0], keys: [key("nope", "0px"), key("50ms", "5px")] };
	assert.deepEqual(
		solvedKeys(machine, timeline, broken).map((k) => [k.index, k.at]),
		[
			[1, 0],
			[2, 50],
		],
	);
});

test("a 1D blend mixes the two stops either side of its input, and plays flat outside", () => {
	const machine = laddered([state("rest", "Rest")], {
		inputs: [numberInput("open", { min: "0", max: "1" })],
		timelines: [
			{ id: "shut", name: "Shut", tracks: [] },
			{ id: "half", name: "Half", tracks: [] },
			{ id: "wide", name: "Wide", tracks: [] },
		],
	}).machines[0];
	const blend: Blend = {
		kind: "oneD",
		input: "open",
		stops: [
			{ timeline: "shut", at: "0" },
			{ timeline: "wide", at: "1" },
			{ timeline: "half", at: "0.5" },
			// A stop naming a timeline the machine has not got is left out, the same
			// silence a dangling `instanceOf` leaves.
			{ timeline: "gone", at: "0.75" },
		],
	};
	// Laid out by threshold rather than by list order: the order they are listed
	// in is an editing convenience, the order they are laid out in is the design.
	assert.deepEqual(blendWeights(machine, blend, { open: 250 }), [
		{ index: 0, timeline: "shut", weight: 0.5 },
		{ index: 2, timeline: "half", weight: 0.5 },
	]);
	// Landing exactly on a stop is that stop, alone — not that stop plus a
	// neighbour at weight zero, which is the same picture said with an entry
	// naming a timeline that is not playing.
	assert.deepEqual(blendWeights(machine, blend, { open: 500 }), [
		{ index: 2, timeline: "half", weight: 1 },
	]);
	// Outside the outermost stops the nearest one plays flat, which is what
	// `mstopgap/2` reports as a fact about the design rather than a fault.
	assert.deepEqual(blendWeights(machine, blend, { open: -500 }), [
		{ index: 0, timeline: "shut", weight: 1 },
	]);
	assert.deepEqual(blendWeights(machine, blend, { open: 5000 }), [
		{ index: 1, timeline: "wide", weight: 1 },
	]);
	// With nothing driven, the input's own declared initial stands in — which is
	// what the store is seeded from, so a blend does not look broken the instant
	// before the first event.
	assert.deepEqual(blendWeights(machine, blend), [
		{ index: 0, timeline: "shut", weight: 1 },
	]);
});

test("a direct blend gives each stop its own weight, and nothing normalises them", () => {
	const machine = laddered([state("rest", "Rest")], {
		inputs: [numberInput("a"), numberInput("b")],
		timelines: [
			{ id: "one", name: "One", tracks: [] },
			{ id: "two", name: "Two", tracks: [] },
		],
	}).machines[0];
	const blend: Blend = {
		kind: "direct",
		stops: [
			{ timeline: "one", by: "a" },
			{ timeline: "two", by: "b" },
		],
	};
	// Both at full weight is what somebody asked for: dividing by the sum would
	// silently turn "both, fully" into "half each".
	assert.deepEqual(blendWeights(machine, blend, { a: 1000, b: 1000 }), [
		{ index: 0, timeline: "one", weight: 1 },
		{ index: 1, timeline: "two", weight: 1 },
	]);
	assert.deepEqual(blendWeights(machine, blend, { a: 250, b: 2000 }), [
		{ index: 0, timeline: "one", weight: 0.25 },
		// Clamped, because a weight past 1 is a typo rather than more of a
		// timeline than there is.
		{ index: 1, timeline: "two", weight: 1 },
	]);
	assert.deepEqual(blendWeights(machine, blend, {}), [
		{ index: 0, timeline: "one", weight: 0 },
		{ index: 1, timeline: "two", weight: 0 },
	]);
});
