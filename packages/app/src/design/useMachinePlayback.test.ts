import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type Machine,
	type MachineState,
	type Scene,
	type SceneNode,
	type Transition,
	EMU_PER_PX,
	emptyScene,
	machineTable,
	makeNode,
	single,
	stepInstance,
} from "@clingo-design/design-core";

import {
	currentStates,
	firstLayerOf,
	heldFrom,
	layerHolding,
	seedInputs,
	startingStates,
} from "./useMachinePlayback.ts";

/**
 * The playback hook, as far as a headless test can reach it.
 *
 * A hook needs a renderer and this package has none — the app's five test files
 * are all pure helpers, and adding a React test renderer to run four assertions
 * would be a dependency in the app's graph for the sake of a test. So the
 * arithmetic the hook does is in exported functions and the React part is the
 * three refs that hold their answers, which is the same split `viewport.ts` and
 * `layout.ts` already have here.
 *
 * Every one of these goes through the **real** `machineTable`, not a
 * hand-written one, because the whole claim these functions make is that the
 * studio reads the table the exported file reads. A fixture table would prove
 * the functions agree with the fixture.
 */

const px = (n: number) => n * EMU_PER_PX;

/** A component definition with two parts, and however many instances. */
function cards(uses: Array<{ id: string; state?: string; states?: Record<string, string> }>): Scene {
	const label: SceneNode = makeNode(
		"text",
		{ x: px(8), y: px(8), width: px(80), height: px(20) },
		{ id: "label", name: "Label" },
	);
	const definition: SceneNode = {
		...makeNode("frame", { x: px(20), y: px(20), width: px(200), height: px(96) }, {
			id: "card",
			name: "Card",
		}),
		children: [label],
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
				children: [
					definition,
					...uses.map((use, i) => ({
						...makeNode(
							"instance",
							{ x: px(300), y: px(20 + i * 120), width: px(200), height: px(96) },
							{ id: use.id, name: use.id },
						),
						instanceOf: "card",
						...(use.state === undefined ? {} : { state: use.state }),
						...(use.states === undefined ? {} : { states: use.states }),
					})),
				],
			},
		],
	};
}

const state = (id: string, layer?: string): MachineState => ({
	id,
	name: id,
	parts: {},
	...(layer === undefined ? {} : { layer }),
});

const edge = (
	id: string,
	from: string,
	to: string,
	trigger: Transition["trigger"],
	extra: Partial<Transition> = {},
): Transition => ({ id, from, to, trigger, enabled: true, ...extra });

const machined = (scene: Scene, machine: Omit<Machine, "root" | "name">): Scene => ({
	...scene,
	machines: [{ root: "card", name: "Card states", ...machine }],
});

/* ------------------------------------------------------------------ */
/* Where a machine starts                                              */
/* ------------------------------------------------------------------ */

test("an unlayered machine starts one layer, at the state the document draws", () => {
	const scene = machined(cards([{ id: "c1" }, { id: "c2", state: "hover" }]), {
		id: "m1",
		states: [state("rest"), state("hover")],
		transitions: [edge("in", "rest", "hover", "pointerenter")],
	});
	const table = machineTable(scene);

	// One entry, called `base`, which is the implicit layer every machine written
	// before layers existed has. The name matters: it is what `data-state` is
	// written from in the export and what a played record is keyed by here.
	assert.deepEqual(startingStates(table, "c1"), { base: "rest" });
	// `SceneNode.state` is what the file starts at, so playback starts there too
	// rather than jumping to the machine's first state on the first hover.
	assert.deepEqual(startingStates(table, "c2"), { base: "hover" });
	assert.deepEqual(startingStates(table, "nobody"), {});
});

test("three layers start in three states at once, which is what a layer is for", () => {
	const scene = machined(cards([{ id: "c1", states: { glow: "lit" } }]), {
		id: "m1",
		layers: [
			{ id: "press", name: "Press" },
			{ id: "glow", name: "Glow" },
		],
		states: [
			state("rest", "press"),
			state("down", "press"),
			state("dark", "glow"),
			state("lit", "glow"),
		],
		transitions: [edge("press", "rest", "down", "pointerdown")],
	});
	const table = machineTable(scene);

	assert.deepEqual(startingStates(table, "c1"), { press: "rest", glow: "lit" });
	// The flat projection every panel that has not learned about layers still
	// asks for: the first layer, which is the one the export writes as plain
	// `data-state`.
	assert.deepEqual(
		firstLayerOf(table, { c1: { press: "down", glow: "lit" } }),
		{ c1: "down" },
	);
	assert.equal(layerHolding(table, "c1", "lit"), "glow");
	assert.equal(layerHolding(table, "c1", "down"), "press");
	assert.equal(layerHolding(table, "c1", "nosuch"), undefined);
});

/* ------------------------------------------------------------------ */
/* Where it is now                                                     */
/* ------------------------------------------------------------------ */

test("a played layer overrides the document and leaves its siblings alone", () => {
	const scene = machined(cards([{ id: "c1" }]), {
		id: "m1",
		layers: [
			{ id: "press", name: "Press" },
			{ id: "glow", name: "Glow" },
		],
		states: [state("rest", "press"), state("down", "press"), state("dark", "glow")],
		transitions: [],
	});
	const table = machineTable(scene);

	assert.deepEqual(currentStates(table, "c1", { press: "down" }), {
		press: "down",
		glow: "dark",
	});
});

test("a stopped layer is left out entirely, and that is what makes the stop stick", () => {
	const scene = machined(cards([{ id: "c1" }]), {
		id: "m1",
		states: [state("rest"), state("done")],
		transitions: [edge("go", "rest", "done", "click")],
	});
	const table = machineTable(scene);

	// `stepInstance` skips a layer the caller says nothing about — its own
	// comment says where a layer is is the caller's business — so omitting a
	// halted one is how this file says "finished" in the stepper's own
	// vocabulary. The assertion is the consequence, not the shape: the trigger
	// that would have moved it does nothing.
	const halted = new Set(["c1 base"]);
	assert.deepEqual(currentStates(table, "c1", undefined, halted), {});
	assert.equal(
		stepInstance(table, "c1", currentStates(table, "c1", undefined, halted), "click"),
		undefined,
	);
	// And with the layer answering again, the same trigger moves it — so the
	// stop is the set and not something about the document.
	assert.deepEqual(
		stepInstance(table, "c1", currentStates(table, "c1", undefined), "click"),
		{ base: "done" },
	);
});

/* ------------------------------------------------------------------ */
/* The exit gate                                                       */
/* ------------------------------------------------------------------ */

test("a layer nothing has moved has been in its state forever, which opens every gate", () => {
	// The claim this pins is the one that is easy to get backwards. A layer with
	// no timestamp is in the state the *document* put it in, so it has been in it
	// since before the session — `Infinity`, not zero. Zero would make a debounced
	// edge refuse the very first click of a preview, for a reason nothing on the
	// screen explains.
	assert.deepEqual(heldFrom(undefined, 1000), {});
	assert.deepEqual(heldFrom({ base: 700 }, 1000), { base: 300 });
	// A clock that has gone backwards — a machine sleeping, a stamp restored —
	// held for no time rather than for a negative one, which would open a gate
	// that should be shut.
	assert.deepEqual(heldFrom({ base: 1200 }, 1000), { base: 0 });
});

test("the exit gate is read off exactly this record, and refuses before it elapses", () => {
	const scene = machined(cards([{ id: "c1" }]), {
		id: "m1",
		states: [state("rest"), state("done")],
		transitions: [edge("go", "rest", "done", "click", { exit: single("300ms") })],
	});
	const table = machineTable(scene);
	const current = currentStates(table, "c1", undefined);

	const at = (since: number, now: number) =>
		stepInstance(
			table,
			"c1",
			current,
			"click",
			undefined,
			undefined,
			heldFrom({ base: since }, now),
		);

	assert.equal(at(1000, 1100), undefined, "100ms held, 300ms gate: refused");
	// Strictly `heldMs < exit`, so an edge with a 300ms exit time fires *at* 300.
	assert.deepEqual(at(1000, 1300), { base: "done" });
	// And with no stamp at all the gate is open, which is the previous test's
	// claim asserted where it actually matters.
	assert.deepEqual(
		stepInstance(table, "c1", current, "click", undefined, undefined, heldFrom(undefined, 0)),
		{ base: "done" },
	);
});

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

test("the seed is the document's own initials, with no trigger in it and nothing clamped", () => {
	const scene = machined(cards([{ id: "c1" }]), {
		id: "m1",
		states: [state("rest"), state("open")],
		inputs: [
			{ id: "open", name: "Open", kind: "boolean", initial: "true" },
			// Deliberately outside its own declared range. The seed is what the
			// document *says*; `machine_input_range` reports the mismatch and a
			// person fixes it. A preview that quietly rewrote it would be the one
			// place the mistake is invisible.
			{ id: "reach", name: "Reach", kind: "number", initial: "1.4", min: "0", max: "1" },
			{ id: "saved", name: "Saved", kind: "trigger" },
		],
		transitions: [edge("go", "rest", "open", "load", {
			conditions: [{ input: "open", op: "eq", value: "true" }],
		})],
	});
	const table = machineTable(scene);
	const seeded = seedInputs(table);

	assert.deepEqual(Object.keys(seeded), ["c1"]);
	// A trigger is not in the store: "not fired" is the absence of a value rather
	// than a value, which is what `edgeAllows` implements and what makes a guard
	// about an unset input refuse instead of opening.
	assert.deepEqual(seeded.c1, { open: true, reach: 1400 });
});

test("an instance with no inputs seeds an empty store rather than nothing at all", () => {
	const scene = machined(cards([{ id: "c1" }]), {
		id: "m1",
		states: [state("rest")],
		transitions: [],
	});
	// An entry, because the instance is driven; empty, because nothing is
	// declared. A missing entry would read as "this instance has no machine",
	// which is a different claim and the one `table.instances` already answers.
	assert.deepEqual(seedInputs(machineTable(scene)), { c1: {} });
});

test("a guard reads the seeded store, so a document's initial really opens an edge", () => {
	const scene = machined(cards([{ id: "c1" }]), {
		id: "m1",
		states: [state("shut"), state("open")],
		inputs: [{ id: "wide", name: "Wide", kind: "boolean", initial: "true" }],
		transitions: [
			edge("go", "shut", "open", "click", {
				conditions: [{ input: "wide", op: "eq", value: "true" }],
			}),
		],
	});
	const table = machineTable(scene);
	const seeded = seedInputs(table);

	assert.deepEqual(
		stepInstance(table, "c1", currentStates(table, "c1", undefined), "click", seeded.c1),
		{ base: "open" },
	);
	// The same edge with the input driven the other way is refused — which is the
	// whole of what a guard buys, asserted through the two functions the studio
	// actually composes rather than through `edgeAllows` directly.
	assert.equal(
		stepInstance(table, "c1", currentStates(table, "c1", undefined), "click", { wide: false }),
		undefined,
	);
	// And an input the store has not been told about refuses too, rather than
	// letting a typo open the edge.
	assert.equal(
		stepInstance(table, "c1", currentStates(table, "c1", undefined), "click", {}),
		undefined,
	);
});
