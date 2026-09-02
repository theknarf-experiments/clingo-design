/**
 * The exported runtime, held to the studio's answer.
 *
 * Every other test file in this package proves something about a function. This
 * one proves something about a *string* — and the claim is unusual enough to
 * state plainly, because it decides how the tests below are shaped:
 *
 * > What an exported file does when you click it is what the studio does when
 * > you click it.
 *
 * There is no type system across that seam. `MACHINE_RUNTIME` is characters; by
 * the time they matter they are running in somebody's browser, with no compiler
 * left in the room. The only way to hold the two together is to *run the text*
 * and compare it to `stepMachine`, which is what {@link evalRuntime} exists for
 * and what the exhaustive matrix below does — every instance the table drives
 * and two it does not, every state the machine has and three it has not, every
 * trigger there is and two nobody has heard of. Membership tests would not do:
 * "the runtime follows the hover edge" is true of a broken runtime too, and the
 * interesting half of an interpreter is what it refuses.
 *
 * The DOM half is tested against a hand-written fake rather than a headless
 * browser, and the fake is four methods long on purpose. The runtime touches
 * exactly `querySelectorAll`, `getAttribute`, `setAttribute` and
 * `addEventListener`; a fake that offers those and nothing else is a statement
 * about how small the runtime's contact with the page is, and it fails loudly on
 * the day someone reaches for a fifth.
 *
 * What is deliberately *not* tested here, because it is deliberately not here:
 * pacing. Duration, delay and stagger are `transition:` declarations `export.ts`
 * writes onto the base rules (spec §8.2), not timers in this script. There is a
 * test below that asserts the absence, because "the runtime has no timers" is a
 * load-bearing fact — a script that also waited would apply every delay twice —
 * and a fact nobody wrote a test for is a fact somebody will helpfully add a
 * `setTimeout` to.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { makeNode } from "./edits.ts";
import {
	BASE_LAYER,
	type InputValues,
	type MachineTable,
	type RuntimeEdge,
	type RuntimeLayer,
	machineTable,
	stepInstance,
	stepLayer,
	stepMachine,
} from "./machines.ts";
import {
	type Condition,
	type Machine,
	type MachineInput,
	type MachineState,
	type Scene,
	type SceneNode,
	DRAG_SLOP_PX,
	TRIGGERS,
	TRIGGER_NAMES,
	type Transition,
	type Trigger,
	emptyScene,
} from "./scene.ts";
import {
	MACHINE_RUNTIME,
	TRIGGER_BINDINGS,
	evalRuntime,
	runtimeScript,
	runtimeSource,
} from "./runtime.ts";
import { EMU_PER_PX } from "./units.ts";
import { lit, single } from "./values.ts";

const px = (n: number): number => n * EMU_PER_PX;

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const state = (id: string, name = id): MachineState => ({ id, name, parts: {} });

const edge = (
	id: string,
	from: string,
	to: string,
	trigger: Trigger,
	extra: Partial<Transition> = {},
): Transition => ({ id, from, to, trigger, enabled: true, ...extra });

/**
 * A menu definition with a machine on it, and however many uses.
 *
 * Three states rather than two, and that is the point of the fixture: a two-state
 * machine cannot tell "followed the edge" apart from "toggled", so an
 * interpreter that ignored the table entirely would pass. `busy` is reachable
 * only from `open`, so the matrix has states a trigger works in and states the
 * same trigger does nothing in — which is the case a runtime has to get right
 * and the one a `switch` per machine gets wrong.
 */
function menus(
	uses: Array<{ id: string; state?: string; at?: Record<string, string> }>,
	states: MachineState[],
	transitions: Transition[],
	extra: Partial<Machine> = {},
): Scene {
	const label: SceneNode = {
		...makeNode(
			"text",
			{ x: px(8), y: px(8), width: px(80), height: px(20) },
			{ id: "label", name: "Label" },
		),
		props: { text: [lit("Menu")], size: single("14px") },
	};
	const definition: SceneNode = {
		...makeNode(
			"frame",
			{ x: px(20), y: px(20), width: px(160), height: px(40) },
			{ id: "menu", name: "Menu" },
		),
		props: { fill: [lit("#ffffff")] },
		children: [label],
		component: true,
	};
	const machine: Machine = {
		id: "m1",
		name: "Menu states",
		root: "menu",
		states,
		transitions,
		...extra,
	};
	return {
		...emptyScene(),
		machines: [machine],
		nodes: [
			{
				...makeNode(
					"frame",
					{ x: 0, y: 0, width: px(600), height: px(400) },
					{ id: "page", name: "Page" },
				),
				props: { fill: [lit("#ffffff")] },
				children: [
					definition,
					...uses.map((use, i) => ({
						...makeNode(
							"instance",
							{ x: px(300), y: px(20 + i * 80), width: px(160), height: px(40) },
							{ id: use.id, name: use.id },
						),
						instanceOf: "menu",
						...(use.state ? { state: use.state } : {}),
						...(use.at ? { states: use.at } : {}),
					})),
				],
			},
		],
	};
}

/** The three-state machine the matrix is run over. */
const threeStates = (): MachineState[] => [
	state("shut", "Shut"),
	state("open", "Open"),
	state("busy", "Busy"),
];

const threeEdges = (): Transition[] => [
	edge("t1", "shut", "open", "click"),
	edge("t2", "open", "shut", "click"),
	edge("t3", "open", "busy", "pointerdown"),
	edge("t4", "busy", "open", "pointerup"),
	// Enters `shut` on leaving, from `open` only. So `pointerleave` is a trigger
	// that moves the machine in one state and does nothing in the other two,
	// which is what makes "no edge from here" a real case rather than a typo.
	edge("t5", "open", "shut", "pointerleave"),
];

const menuTable = (): MachineTable =>
	machineTable(menus([{ id: "m_a" }, { id: "m_b", state: "open" }], threeStates(), threeEdges()));

/* ------------------------------------------------------------------ */
/* The ladder, as one fixture                                          */
/* ------------------------------------------------------------------ */

const input = (
	id: string,
	kind: MachineInput["kind"],
	rest: Partial<MachineInput> = {},
): MachineInput => ({ id, name: id, kind, ...rest });

const when = (
	input: string,
	op: Condition["op"],
	value?: string,
): Condition => ({ input, op, ...(value === undefined ? {} : { value }) });

/**
 * One machine with all five rungs on it, because the rungs interact and a
 * fixture per rung would never catch that.
 *
 * Three layers, and they are three so that "later wins" has a middle to be
 * wrong about, and so that one layer stopping leaves *two* still answering. The
 * first layer keeps the shut/open/busy story the shipped matrix is written
 * against, so the two matrices are about one machine.
 *
 * - **press**, the first layer: the shipped toggle, plus a guard on the edge
 *   into `busy` (so a condition is the difference between moving and not), an
 *   exit time on the edge out of it (so the gate has something to gate), and an
 *   Any edge home on `pointerleave` (so precedence has a case).
 * - **glow**: a number-guarded edge, which is the one guard the four orderings
 *   are ever asked of, and an ordinary edge back.
 * - **boot**: an Entry edge guarded on a trigger input — which is exactly the
 *   idiom "when the save succeeds, move" — and an Exit edge, so a layer can
 *   stop while the other two carry on.
 *
 * The cross-layer edge at the end is deliberate and is asserted about below: it
 * names a destination in another layer, so no layer can honour it and
 * `machineTable` drops it rather than writing an id whose rules live under
 * somebody else's selector.
 */
function ladder(uses: Array<{ id: string; at?: Record<string, string> }> = [{ id: "m_a" }]): Scene {
	return menus(
		uses,
		[
			state("shut", "Shut"),
			state("open", "Open"),
			state("busy", "Busy"),
			{ ...state("dim", "Dim"), layer: "glow" },
			{ ...state("bright", "Bright"), layer: "glow" },
			{ ...state("cold", "Cold"), layer: "boot" },
			{ ...state("warm", "Warm"), layer: "boot" },
		],
		[
			edge("t1", "shut", "open", "click"),
			edge("t2", "open", "shut", "click"),
			edge("t3", "open", "busy", "pointerdown", {
				conditions: [when("ready", "eq", "true")],
			}),
			edge("t4", "busy", "open", "pointerup", { exit: single("300ms") }),
			edge("t5", "any", "shut", "pointerleave"),
			// Specific, on the trigger the Any edge above also answers, and from a
			// state the Any edge reaches: this pair is the whole of the precedence
			// rule, and without it nothing here would notice an interpreter that
			// tried the fallback first.
			edge("t6", "busy", "open", "pointerleave"),
			edge("g1", "dim", "bright", "pointerenter", {
				conditions: [when("level", "ge", "0.5")],
			}),
			edge("g2", "bright", "dim", "pointerleave"),
			edge("b1", "entry", "warm", "load", {
				conditions: [when("saved", "fired")],
			}),
			edge("b2", "warm", "exit", "click"),
			edge("x1", "shut", "bright", "pointerup"),
		],
		{
			layers: [
				{ id: "press", name: "Press" },
				{ id: "glow", name: "Glow" },
				{ id: "boot", name: "Boot" },
			],
			inputs: [
				input("ready", "boolean", { initial: "true" }),
				input("armed", "boolean", { initial: "false" }),
				input("level", "number", { initial: "0.2", min: "0", max: "1" }),
				input("saved", "trigger"),
			],
		},
	);
}

const ladderTable = (uses?: Array<{ id: string; at?: Record<string, string> }>): MachineTable =>
	machineTable(ladder(uses));

/**
 * The one use {@link ladder} makes by default, named so the matrices below read
 * as being about layers and states rather than about which button it is.
 *
 * A test that wants two of them passes its own ids to `ladderTable` and spells
 * them out; everything else varies the layer, the state, the trigger and the
 * valuation against this single instance, because an instance is not the
 * dimension any of those tests are exploring.
 */
const instance = "m_a";

/** A clock a test winds by hand, and the runtime that reads it. */
function clocked(
	table: MachineTable,
	root: unknown = null,
): { js: ReturnType<typeof evalRuntime>; tick: (ms: number) => void } {
	let at = 0;
	const js = evalRuntime(table, root, undefined, () => at);
	return {
		js,
		tick: (ms: number) => {
			at += ms;
		},
	};
}

/* ------------------------------------------------------------------ */
/* A DOM small enough to read                                          */
/* ------------------------------------------------------------------ */

/**
 * A pointer event, as much of one as the recogniser reads.
 *
 * Three fields, and no more, which is itself the assertion: the drag recogniser
 * looks at `clientX`, `clientY` and `pointerId` and at nothing else — no
 * `pageX`, no `offsetX`, no `target`. Client coordinates because the threshold
 * is a fact about the hand, and a scroll under a held finger is not travel.
 */
interface FakePointer {
	clientX: number;
	clientY: number;
	pointerId: number;
}

interface FakeElement {
	attrs: Record<string, string>;
	listeners: Record<string, Array<(event: unknown) => void>>;
	/** Pointer ids this element was asked to capture, in order. */
	captured: number[];
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	addEventListener(type: string, handler: (event: unknown) => void): void;
	setPointerCapture(id: number): void;
	dispatch(type: string, event?: Partial<FakePointer>): void;
}

function element(nodeId: string): FakeElement {
	return {
		attrs: { "data-node": nodeId },
		listeners: {},
		captured: [],
		getAttribute(name) {
			return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
		},
		setAttribute(name, value) {
			this.attrs[name] = value;
		},
		addEventListener(type, handler) {
			(this.listeners[type] ??= []).push(handler);
		},
		setPointerCapture(id) {
			this.captured.push(id);
		},
		dispatch(type, event = {}) {
			const full = { clientX: 0, clientY: 0, pointerId: 1, ...event };
			for (const handler of this.listeners[type] ?? []) handler(full);
		},
	};
}

/**
 * The browser's own reporter of geometry, faked, with the two properties the
 * runtime relies on: it is handed targets and it delivers records for them.
 *
 * Installed on `globalThis` because the runtime text is compiled with
 * `new Function` and therefore sees the global scope and nothing else — which is
 * the scope it gets inside a `<script>` tag too, and is exactly why
 * `evalRuntime` is written that way. Removed again by the caller, so one test
 * cannot leave an observer standing for the next.
 */
function observing(): {
	install: () => void;
	remove: () => void;
	/** Deliver one batch, as the browser would. */
	report: (records: Array<{ node: string; inside: boolean }>) => void;
	/** Targets handed to `observe`, in order. */
	watched: string[];
	/** How many observers were constructed. */
	made: number;
} {
	const state = { watched: [] as string[], made: 0 };
	let deliver: ((records: unknown[]) => void) | undefined;
	class Fake {
		constructor(callback: (records: unknown[]) => void) {
			state.made += 1;
			deliver = callback;
		}
		observe(target: { getAttribute(name: string): string | null }): void {
			state.watched.push(target.getAttribute("data-node") ?? "");
		}
	}
	return {
		install: () => {
			(globalThis as Record<string, unknown>).IntersectionObserver = Fake;
		},
		remove: () => {
			(globalThis as Record<string, unknown>).IntersectionObserver = undefined;
		},
		report: (records) => {
			deliver?.(
				records.map((r) => ({
					target: { getAttribute: () => r.node },
					isIntersecting: r.inside,
				})),
			);
		},
		get watched() {
			return state.watched;
		},
		get made() {
			return state.made;
		},
	};
}

/** A document that is a list of elements and one query. */
function page(ids: string[]): { root: unknown; els: Record<string, FakeElement> } {
	const els: Record<string, FakeElement> = {};
	for (const id of ids) els[id] = element(id);
	const list = ids.map((id) => els[id]);
	return {
		root: {
			querySelectorAll(selector: string) {
				assert.equal(selector, "[data-node]");
				return list;
			},
		},
		els,
	};
}

/* ------------------------------------------------------------------ */
/* The text is a program                                               */
/* ------------------------------------------------------------------ */

test("the emitted script evaluates, with a DOM and without one", () => {
	// Spec §11 step 9.1. The cheapest possible test and the one that catches the
	// most: a syntax error in this text is a `<script>` that takes the behaviour
	// of somebody's whole exported page down with it, and it would never show up
	// in a type check because the text has no types.
	const script = runtimeScript(menuTable());
	assert.doesNotThrow(() => new Function(script));

	// And it runs. `typeof document === "undefined" ? null : document` is what
	// makes this possible in Node — a runtime with a null root binds nothing and
	// is otherwise entirely itself.
	assert.doesNotThrow(() => {
		new Function(script)();
	});
});

test("the script carries the runtime verbatim, not a copy of it", () => {
	// This is the drift the whole file is about, in its smallest form. If
	// `runtimeScript` ever built its own text — even by reformatting this one —
	// then every test below would be testing a string that is not the string that
	// ships, and would keep passing while the export broke.
	//
	// `runtimeSource()` rather than `MACHINE_RUNTIME`, and the difference is the
	// point rather than a weakening: the shipped text is the authored text with
	// its prose removed, one strip, in one function, that `evalRuntime` also
	// calls. So the string asserted here is still exactly the string every other
	// test in this file drives — which is the property the test is named for.
	const script = runtimeScript(menuTable());
	assert.ok(script.includes(runtimeSource()));

	// And it is wrapped, not merely concatenated: nothing leaks into the page's
	// global scope, and `M.start()` is what actually binds it.
	assert.ok(script.startsWith("(function(){"));
	assert.ok(script.includes("M.start();"));
	assert.ok(script.trimEnd().endsWith("})();"));
});

test("the table in the script is the table, and it round-trips through JSON.parse", () => {
	// Spec §11 step 9.4. The table is the whole interface between the compiler and
	// the runtime; if it does not survive being written into a script tag and read
	// back, nothing downstream of it means anything.
	const table = menuTable();
	const script = runtimeScript(table);
	const json = /^var T = (.*);$/m.exec(script);
	assert.ok(json, "the table is one line and it is named T");
	assert.deepEqual(JSON.parse(json[1]), table);
});

test("a node id that could close the script tag is escaped and still reads back", () => {
	// Not a thing anybody types on purpose, which is exactly why it is the sort of
	// thing that becomes a bug report years later: the HTML parser ends a script
	// at the first `</script`, wherever it appears — including inside what
	// JavaScript considers a string literal. The escape is `\u003c`, which
	// `JSON.parse` reads straight back as `<`.
	const table: MachineTable = {
		instances: { "</script>": { machine: "m1", initial: "shut" } },
		machines: { m1: { initial: "shut", states: ["shut"], edges: {} } },
	};
	const script = runtimeScript(table);
	assert.ok(!script.includes("</script>"));
	assert.ok(script.includes("\\u003c/script>"));

	const json = /^var T = (.*);$/m.exec(script);
	assert.ok(json);
	assert.deepEqual(JSON.parse(json[1]), table);
});

test("the event map is derived from TRIGGERS rather than restated", () => {
	// The runtime needs to know that `focus` listens for `focusin`. It could have
	// carried its own copy of that; then the day `scene.ts` changed its mind — and
	// `scene.ts` has already changed its mind once, which is why the pair is
	// `focusin`/`focusout` and not `focus`/`blur` — the panel and the exported
	// file would quietly disagree about what a focus trigger is.
	for (const trigger of TRIGGER_NAMES) {
		assert.equal(TRIGGER_BINDINGS[trigger].event, TRIGGERS[trigger].event);
		assert.equal(TRIGGER_BINDINGS[trigger].source, TRIGGERS[trigger].source);
		assert.equal(TRIGGER_BINDINGS[trigger].suppresses, TRIGGERS[trigger].suppresses);
	}
	assert.equal(TRIGGER_BINDINGS.focus.event, "focusin");
	assert.equal(TRIGGER_BINDINGS.blur.event, "focusout");
	// `load` is the trigger with no event: it fires once at start, and the runtime
	// tests the string for emptiness rather than keeping a second list.
	assert.equal(TRIGGER_BINDINGS.load.event, "");
	// The four gestures have no event *and* a source, which is the pair that keeps
	// them out of `listen()` and inside a binder. A gesture that lost its source
	// would silently never be bound — the failure `TriggerSpec.source` exists to
	// prevent — so both halves are asserted rather than one.
	for (const trigger of ["viewenter", "viewleave"] as const) {
		assert.equal(TRIGGER_BINDINGS[trigger].event, "");
		assert.equal(TRIGGER_BINDINGS[trigger].source, "view");
	}
	for (const trigger of ["dragbegin", "dragend"] as const) {
		assert.equal(TRIGGER_BINDINGS[trigger].event, "");
		assert.equal(TRIGGER_BINDINGS[trigger].source, "drag");
	}
	// And the one column that is neither an event nor a source: what a drag that
	// ended swallows. In the table rather than in the runtime text, so the emitted
	// interpreter holds no trigger id at all.
	assert.equal(TRIGGER_BINDINGS.dragend.suppresses, "click");
	// `label` is the column that is deliberately absent: nothing in the script
	// could act on it, and twelve labels is two hundred bytes in every file.
	assert.equal("label" in TRIGGER_BINDINGS.click, false);

	const script = runtimeScript(menuTable());
	const json = /^var E = (.*);$/m.exec(script);
	assert.ok(json);
	assert.deepEqual(JSON.parse(json[1]), TRIGGER_BINDINGS);
});

test("the drag threshold travels on the table, and it is the studio's number", () => {
	// One threshold, two readers. `DRAG_SLOP_PX` is a property of the hand rather
	// than of the design, so it is not a per-transition setting and there is
	// nowhere in the document to say it — which makes "how far is a drag" a
	// question only this constant answers, in the studio and in the file at once.
	const table = menuTable();
	assert.deepEqual(table.settings, { dragSlop: DRAG_SLOP_PX });
	// Stated always, not only where a machine uses a gesture: a field that appears
	// sometimes is a field every reader has to test for twice.
	assert.deepEqual(machineTable(emptyScene()).settings, { dragSlop: DRAG_SLOP_PX });
});

/* ------------------------------------------------------------------ */
/* The runtime and the studio give one answer                          */
/* ------------------------------------------------------------------ */

test("every (state, trigger) pair the runtime answers is the pair stepMachine answers", () => {
	// Spec §11 step 9.2, and the reason this file exists. Exhaustive rather than
	// illustrative: the interesting half of an interpreter is what it refuses, and
	// a runtime that returned the first edge it found for everything would sail
	// through any test that only ever asked it about edges that exist.
	const table = menuTable();
	const js = evalRuntime(table);

	const instances = ["m_a", "m_b", "menu", "nobody"];
	// The three real states, two that no machine has, and `"*"` — see the wildcard
	// test below for why that one is in the list.
	const states = ["shut", "open", "busy", "closed", "", "*"];
	const triggers = [...TRIGGER_NAMES, "wiggle", ""];

	let moves = 0;
	for (const instance of instances) {
		for (const from of states) {
			for (const trigger of triggers) {
				const mine = js.step(instance, from, trigger);
				const theirs = stepMachine(table, instance, from, trigger as Trigger);
				assert.equal(
					mine,
					theirs,
					`${instance} in ${from} on ${trigger}: runtime ${String(mine)}, studio ${String(theirs)}`,
				);
				if (theirs !== undefined) moves += 1;
			}
		}
	}

	// A guard on the guard. Agreement is trivially true if neither ever moves, and
	// a typo in the fixture would produce exactly that. Two instances × five edges.
	assert.equal(moves, 10);
});

test("a trigger with no edge from here is a no-op, not an error", () => {
	// The listeners are attached per *machine*, so a machine that responds to
	// click in one state and not another is the ordinary case rather than a
	// mistake — which is why this returns null and leaves the state alone rather
	// than throwing or, worse, writing a data-state nothing in the file matches.
	const js = evalRuntime(menuTable());
	js.start();

	assert.equal(js.state("m_a"), "shut");
	// `pointerleave` leaves `open`, and nothing leaves `shut` but a click.
	assert.equal(js.fireIn("m_a", "pointerleave"), null);
	assert.equal(js.state("m_a"), "shut");
	assert.equal(js.fireIn("m_a", "pointerup"), null);
	assert.equal(js.state("m_a"), "shut");

	// A trigger no document can even spell.
	assert.equal(js.fireIn("m_a", "wiggle"), null);
	assert.equal(js.state("m_a"), "shut");

	// And the edge that is there still works afterwards — the refusals left
	// nothing behind. What comes back is a record now, keyed by layer, because an
	// instance moves one state per layer and a string cannot say that; a one-layer
	// machine's record is the one entry `machineLayers` mints for it.
	assert.deepEqual(js.fireIn("m_a", "click"), { [BASE_LAYER]: "open" });
	assert.deepEqual(js.fireIn("m_a", "pointerleave"), { [BASE_LAYER]: "shut" });
});

test("fire and states keep the shape they shipped, and the layered answers took new names", () => {
	// **A compatibility test, and the thing it protects is a file somebody keeps.**
	// An exported page is HTML on disk with a host script beside it, and the host
	// that was written against the export before layers existed does
	// `M.fire("btn","click") === "hover"` and reads `M.states[id]` as a string. If
	// `fire` had quietly started returning a record and `states` a nested one, both
	// of those would have become silently wrong the moment the document was
	// re-exported: an object is always truthy, `===` against a state id never
	// matches again, and there is nothing on screen to show for it.
	//
	// So the pair is the one the rest of the handle already uses — `set`/`setIn`,
	// `state`/`stateIn`, `step`/`stepIn` — and `fire`/`fireIn` and
	// `states`/`statesIn` join it. The bare name means the first layer, which is
	// the layer that writes `data-state`, which is the whole of what a one-layer
	// document ever had.
	const js = evalRuntime(menuTable());
	js.start();

	assert.equal(typeof js.states.m_a, "string", "flat, as it shipped");
	assert.equal(js.states.m_a, "shut");
	assert.deepEqual(js.statesIn.m_a, { [BASE_LAYER]: "shut" }, "and the whole answer beside it");

	// A string out of `fire`, and the same move reported as a record by `fireIn`.
	assert.equal(js.fire("m_a", "click"), "open");
	assert.equal(js.states.m_a, "open", "the flat record is live, not a snapshot");
	assert.deepEqual(js.fireIn("m_a", "pointerleave"), { [BASE_LAYER]: "shut" });
	assert.equal(js.states.m_a, "shut");

	// Null where the first layer took no edge, exactly as the shipped one did —
	// including the trigger no document can spell.
	assert.equal(js.fire("m_a", "pointerleave"), null);
	assert.equal(js.fire("m_a", "wiggle"), null);
	assert.equal(js.states.m_a, "shut");
});

test("fire reports the first layer and still moves every one of them", () => {
	// The half of the compatibility promise that is not about the return value:
	// `fire` is a narrower *report*, never a narrower run. A click that presses a
	// button and lights it must do both whichever function the host called, or a
	// page written against the old shape would have half a machine.
	const js = evalRuntime(ladderTable());
	js.start();
	js.fireInput(instance, "saved");

	// press moves, glow does not, boot exits — and only press's answer comes back.
	assert.equal(js.fire(instance, "click"), "open");
	assert.equal(js.stateIn(instance, "press"), "open");
	assert.equal(js.stateIn(instance, "glow"), "dim");
	assert.equal(js.stopped(instance, "boot"), true, "the layer nobody asked about still stopped");
	assert.equal(js.states[instance], "open", "and data-state's twin is the first layer");
});

test("an instance the table does not drive answers null and stays out of it", () => {
	const js = evalRuntime(menuTable());
	js.start();

	assert.equal(js.state("menu"), null);
	assert.equal(js.fireIn("menu", "click"), null);
	assert.equal(js.fireIn("nobody", "click"), null);
	// Firing at nothing did not invent an entry for it, which is what would make
	// `states` grow every time a stray event arrived.
	assert.deepEqual(Object.keys(js.states).sort(), ["m_a", "m_b"]);
});

test("before start, an instance is in no state and nothing fires", () => {
	// `fire` reads the current state, and there is not one until `start` puts the
	// instances in their initial states. A runtime that guessed the initial state
	// here would be a second place the initial state is decided.
	const js = evalRuntime(menuTable());
	assert.equal(js.state("m_a"), null);
	assert.equal(js.fireIn("m_a", "click"), null);
	// `step` is pure, so it answers perfectly well without a current state — which
	// is exactly what lets the matrix above ask it about states nothing is in.
	assert.equal(js.step("m_a", "shut", "click"), "open");
});

test("`*` is a state id, not a wildcard, in both readers at once", () => {
	// The brief asked for `"*"` as a from-state meaning "from anywhere". It is not
	// implemented, and the reason is the invariant this file is here to keep: a
	// wildcard only the emitted text understood would be precisely the drift that
	// makes "the studio and the file behave the same" false. `stepMachine` has no
	// wildcard and `machines.ts` belongs to another step. So `"*"` is looked up as
	// a state literally called `"*"` — a state no document can spell, since a
	// state id must be a bare ASP constant — and, crucially, *both* readers say
	// so. If the feature is ever wanted it belongs in `machineTable`, expanded
	// into the table for both readers, not in one interpreter.
	const table: MachineTable = {
		instances: { m_a: { machine: "m1", initial: "shut" } },
		machines: {
			m1: {
				initial: "shut",
				states: ["shut", "open"],
				edges: {
					shut: { click: "open" },
					"*": { click: "shut" },
				},
			},
		},
	};
	const js = evalRuntime(table);

	// From a real state, the real edge — the `"*"` row does not shadow it.
	assert.equal(js.step("m_a", "shut", "click"), "open");
	assert.equal(stepMachine(table, "m_a", "shut", "click"), "open");

	// From a state with no row, nothing — the `"*"` row is not consulted.
	assert.equal(js.step("m_a", "open", "click"), undefined);
	assert.equal(stepMachine(table, "m_a", "open", "click"), undefined);

	// And the row is reachable, as the ordinary state key it is. Which is what
	// makes this a definition rather than a silence.
	assert.equal(js.step("m_a", "*", "click"), "shut");
	assert.equal(stepMachine(table, "m_a", "*", "click"), "shut");
});

test("where two edges share a (from, trigger), both readers take the same one", () => {
	// `machineTable` resolves nondeterminism by document order — first enabled
	// edge wins — and reports the pair through `mnondet/3` so the designer can fix
	// it. Until they do, the studio and the exported file must at least be wrong
	// in the same direction; a machine that behaves differently in the two places
	// is not a bug report anybody can write down.
	const table = machineTable(
		menus([{ id: "m_a" }], threeStates(), [
			edge("t1", "shut", "open", "click"),
			edge("t2", "shut", "busy", "click"),
		]),
	);
	assert.equal(stepMachine(table, "m_a", "shut", "click"), "open");
	assert.equal(evalRuntime(table).step("m_a", "shut", "click"), "open");
});

/* ------------------------------------------------------------------ */
/* Binding to a page                                                   */
/* ------------------------------------------------------------------ */

test("start puts every instance in its own initial state and writes data-state", () => {
	// Per instance, not per machine: `m_b` carries `state: "open"` in the
	// document, and spec §8.1 is explicit that a `SceneNode.state` other than the
	// initial one changes what `data-state` is initialised to. (What the *CSS
	// base* is remains the machine's initial state, which is a different question
	// and `export.ts`'s.)
	const table = menuTable();
	const { root, els } = page(["m_a", "m_b", "label"]);
	const js = evalRuntime(table, root);
	js.start();

	assert.equal(els.m_a.attrs["data-state"], "shut");
	assert.equal(els.m_b.attrs["data-state"], "open");
	// An element that is not an instance of a driven definition is left alone —
	// the runtime scans the whole page once and keeps only what the table names.
	assert.equal(els.label.attrs["data-state"], undefined);
});

test("a real event moves the machine and the attribute follows", () => {
	const { root, els } = page(["m_a"]);
	const js = evalRuntime(menuTable(), root);
	js.start();

	els.m_a.dispatch("click");
	assert.equal(js.state("m_a"), "open");
	assert.equal(els.m_a.attrs["data-state"], "open");

	els.m_a.dispatch("pointerdown");
	assert.equal(els.m_a.attrs["data-state"], "busy");
	els.m_a.dispatch("pointerup");
	assert.equal(els.m_a.attrs["data-state"], "open");

	// And an event this state has no edge on leaves the attribute exactly where
	// it was, rather than clearing it.
	els.m_a.dispatch("pointerdown");
	els.m_a.dispatch("pointerdown");
	assert.equal(els.m_a.attrs["data-state"], "busy");
});

test("an instance listens for what its machine uses and nothing else", () => {
	// One listener per distinct event the machine's edges name. Attaching all
	// eight would put a click handler on every exported instance in the document,
	// which is a real cost on a page and a real surprise in a devtools panel.
	const { root, els } = page(["m_a"]);
	evalRuntime(menuTable(), root).start();

	assert.deepEqual(
		Object.keys(els.m_a.listeners).sort(),
		["click", "pointerdown", "pointerleave", "pointerup"],
	);
	// `focusin`, `focusout` and `pointerenter` are not in the machine, so they are
	// not on the element.
	assert.equal(els.m_a.listeners.focusin, undefined);
	assert.equal(els.m_a.listeners.pointerenter, undefined);
	// And `load` never becomes a listener at all: its event is the empty string.
	assert.equal(els.m_a.listeners[""], undefined);
});

test("an instance with no element in the page still runs, silently", () => {
	// An exported fragment, a node the renderer dropped, a page assembled by hand.
	// The runtime keeps the state internally and writes no attribute, which is
	// what makes `onChange` a complete interface rather than a convenience.
	const table = menuTable();
	const { root } = page(["m_b"]);
	const js = evalRuntime(table, root);
	js.start();

	assert.equal(js.state("m_a"), "shut");
	assert.deepEqual(js.fireIn("m_a", "click"), { [BASE_LAYER]: "open" });
});

test("a host that re-renders hears every move through onChange", () => {
	// The other half of "reports the current state": a host driving React does not
	// want an attribute written behind its back, it wants to be told. Same
	// callback for the initial state as for a move — a host that only learned
	// about *changes* would have to work out the starting state itself, from the
	// table, which is the table being read in two places again.
	const seen: Array<[string, string]> = [];
	const js = evalRuntime(menuTable(), null, (instance, next) => {
		seen.push([instance, next]);
	});
	js.start();
	js.fireIn("m_a", "click");
	js.set("m_b", "busy");

	assert.deepEqual(seen, [
		["m_a", "shut"],
		["m_b", "open"],
		["m_a", "open"],
		["m_b", "busy"],
	]);
});

test("set refuses anything that is not a state id", () => {
	// The caller that can pass rubbish is `start` itself, reading an instance's
	// stored initial out of a table somebody may have hand-edited. A `data-state`
	// of "undefined" matches no rule in the stylesheet and looks, to the person
	// reading it, exactly like a machine that failed to move.
	const table: MachineTable = {
		instances: { m_a: { machine: "m1" } as { machine: string; initial: string } },
		machines: { m1: { initial: "shut", states: ["shut"], edges: {} } },
	};
	const { root, els } = page(["m_a"]);
	const js = evalRuntime(table, root);
	js.start();

	assert.equal(js.state("m_a"), null);
	assert.equal(els.m_a.attrs["data-state"], undefined);
});

/* ------------------------------------------------------------------ */
/* Load                                                                */
/* ------------------------------------------------------------------ */

test("a load edge is followed once at start, and a chain settles", () => {
	// `load` is how a machine says "settle into this state" rather than "wait to
	// be poked". A chain ends where it ends rather than one edge short, because
	// stopping short would be an arbitrary place to stop.
	const table = machineTable(
		menus([{ id: "m_a" }], [state("boot"), state("shut"), state("open")], [
			edge("t0", "boot", "shut", "load"),
			edge("t1", "shut", "open", "load"),
			edge("t2", "open", "shut", "click"),
		]),
	);
	const { root, els } = page(["m_a"]);
	const js = evalRuntime(table, root);
	js.start();

	assert.equal(js.state("m_a"), "open");
	assert.equal(els.m_a.attrs["data-state"], "open");
	// Following the chain did not also attach a listener for it: `load` has no
	// event, so there is nothing to listen for.
	assert.deepEqual(Object.keys(els.m_a.listeners), ["click"]);
});

test("a load cycle stops rather than spinning", () => {
	// A page that never finishes painting is worse than a machine that stops
	// somewhere legal, and neither `mdeadend` nor `munreached` is the check that
	// would have caught this: a two-state load cycle is reachable, leaves both
	// states, and is perfectly deterministic.
	const table = machineTable(
		menus([{ id: "m_a" }], [state("a"), state("b")], [
			edge("t1", "a", "b", "load"),
			edge("t2", "b", "a", "load"),
		]),
	);
	const js = evalRuntime(table);
	js.start();
	// It went a -> b, then declined to go back to `a`. Stopping *before* going
	// round rather than after is what makes the resting state the last one it had
	// not already been in — a place a reader can point at and say why it is there,
	// rather than "wherever the guard happened to trip".
	assert.equal(js.state("m_a"), "b");
});

test("a load self-edge is not a loop", () => {
	const table = machineTable(
		menus([{ id: "m_a" }], [state("a")], [edge("t1", "a", "a", "load")]),
	);
	const js = evalRuntime(table);
	js.start();
	assert.equal(js.state("m_a"), "a");
});

/* ------------------------------------------------------------------ */
/* Gestures: a recognition, not an event                               */
/* ------------------------------------------------------------------ */

/** A machine with a drag pair and a click edge out of the same state. */
const draggable = (): MachineTable =>
	machineTable(
		menus(
			[{ id: "m_a" }],
			[state("rest"), state("held"), state("open")],
			[
				edge("grab", "rest", "held", "dragbegin"),
				edge("drop", "held", "rest", "dragend"),
				edge("tap", "rest", "open", "click"),
			],
		),
	);

test("a drag past the slop fires dragbegin exactly once", () => {
	const { root, els } = page(["m_a"]);
	const js = evalRuntime(draggable(), root);
	js.start();
	// The recogniser is bound because the machine uses a drag trigger, and the
	// three listeners it needs are the three it has. `dragbegin` and `dragend`
	// themselves are never event names — that is what `source` means.
	assert.deepEqual(
		Object.keys(els.m_a.listeners).sort(),
		["click", "lostpointercapture", "pointercancel", "pointerdown", "pointermove", "pointerup"],
	);

	els.m_a.dispatch("pointerdown", { clientX: 100, clientY: 100 });
	assert.equal(js.state("m_a"), "rest", "a press alone is not a drag");
	els.m_a.dispatch("pointermove", { clientX: 101, clientY: 101 });
	assert.equal(js.state("m_a"), "rest", "and neither is a tremor under the slop");
	// √2 ≈ 1.41 and √8 ≈ 2.83 are both under three; √18 ≈ 4.24 is over. The
	// comparison is squared in the runtime so there is no square root and no
	// float, and this is the crossing that proves the threshold is the distance
	// rather than either axis alone.
	els.m_a.dispatch("pointermove", { clientX: 102, clientY: 102 });
	assert.equal(js.state("m_a"), "rest");
	els.m_a.dispatch("pointermove", { clientX: 103, clientY: 103 });
	assert.equal(js.state("m_a"), "held", "past three pixels it is a drag");
	assert.deepEqual(els.m_a.captured, [1], "and the pointer is captured, so it keeps reporting");

	// Once. Every further move is the same gesture, and a `dragbegin` per pixel
	// would take a second edge out of the state the first one arrived in.
	els.m_a.dispatch("pointermove", { clientX: 200, clientY: 200 });
	els.m_a.dispatch("pointermove", { clientX: 300, clientY: 300 });
	assert.equal(js.state("m_a"), "held");
});

test("a drag under the slop is a click and never a drag", () => {
	// The whole reason the threshold exists: a drag with no slop is `pointerdown`
	// under another name, and `pointerdown` already exists with `:active` behind
	// it. A shaky click has to stay a click.
	const { root, els } = page(["m_a"]);
	const js = evalRuntime(draggable(), root);
	js.start();

	els.m_a.dispatch("pointerdown", { clientX: 50, clientY: 50 });
	els.m_a.dispatch("pointermove", { clientX: 52, clientY: 50 });
	els.m_a.dispatch("pointerup", { clientX: 52, clientY: 50 });
	assert.equal(js.state("m_a"), "rest", "nothing began, so nothing ended");
	els.m_a.dispatch("click");
	assert.equal(js.state("m_a"), "open", "and the click is an ordinary click");
	assert.deepEqual(els.m_a.captured, []);
});

test("the click after a drag is swallowed exactly once", () => {
	// A browser sends a click after a drag that started on the element, and a
	// machine with a drag edge *and* a click edge would otherwise move twice. The
	// swallow is read off the table's `suppresses` column rather than tested
	// against a trigger id, so the emitted text holds no trigger name — and it is
	// consumed by the very next click, so the gesture after it is ordinary again.
	const { root, els } = page(["m_a"]);
	const js = evalRuntime(draggable(), root);
	js.start();

	els.m_a.dispatch("pointerdown", { clientX: 0, clientY: 0 });
	els.m_a.dispatch("pointermove", { clientX: 40, clientY: 0 });
	assert.equal(js.state("m_a"), "held");
	els.m_a.dispatch("pointerup", { clientX: 40, clientY: 0 });
	assert.equal(js.state("m_a"), "rest", "the drag ended and the machine came back");

	els.m_a.dispatch("click");
	assert.equal(js.state("m_a"), "rest", "the click the browser sends after it is eaten");
	els.m_a.dispatch("click");
	assert.equal(js.state("m_a"), "open", "exactly one, and the next click is a click");
});

test("a pointercancel ends a drag that had begun", () => {
	// Three things end a drag — the pointer coming up, the browser cancelling it,
	// and the capture being lost — and all three fire `dragend` where one had
	// begun. A machine left in its dragging state because the browser took the
	// pointer away would be a machine stuck there with nothing on the page to say
	// why.
	for (const ending of ["pointercancel", "lostpointercapture"]) {
		const { root, els } = page(["m_a"]);
		const js = evalRuntime(draggable(), root);
		js.start();
		els.m_a.dispatch("pointerdown", { clientX: 0, clientY: 0 });
		els.m_a.dispatch("pointermove", { clientX: 0, clientY: 20 });
		assert.equal(js.state("m_a"), "held", ending);
		els.m_a.dispatch(ending);
		assert.equal(js.state("m_a"), "rest", ending);
		// ...and the drag is over, so a further move does not begin a second one.
		els.m_a.dispatch("pointermove", { clientX: 0, clientY: 90 });
		assert.equal(js.state("m_a"), "rest", ending);
	}
});

test("a machine with no gesture gets no recogniser and no observer", () => {
	// The no-regression half, and it is what `usesSource` is for: an ordinary
	// hover machine must not grow three pointer listeners and a place in an
	// observer because the *vocabulary* grew.
	const watcher = observing();
	watcher.install();
	try {
		const { root, els } = page(["m_a"]);
		evalRuntime(menuTable(), root).start();
		assert.deepEqual(
			Object.keys(els.m_a.listeners).sort(),
			["click", "pointerdown", "pointerleave", "pointerup"],
		);
		assert.equal(els.m_a.listeners.pointermove, undefined);
		assert.equal(watcher.made, 0, "and no observer is constructed at all");
	} finally {
		watcher.remove();
	}
});

/** A machine that reveals when it scrolls into view and hides when it leaves. */
const revealing = (): MachineTable =>
	machineTable(
		menus(
			[{ id: "m_a" }],
			[state("away"), state("here")],
			[
				edge("reveal", "away", "here", "viewenter"),
				edge("hide", "here", "away", "viewleave"),
				// A load edge into the same place the observer's first record would
				// take it, so the ordering assertion below has something to be about.
				edge("settled", "away", "away", "load"),
			],
		),
	);

test("an element already in view gets viewenter after settle and not before", () => {
	// The ordering `start()` is written for, and the difference between a reveal
	// that works and one that has already happened before anybody sees it. An
	// observer delivers an initial record for everything it is given, so an
	// element on screen at load gets `viewenter` on the frame after `observe` —
	// and `observe` is the last thing `start` does, after the load chain.
	const watcher = observing();
	watcher.install();
	try {
		const { root, els } = page(["m_a"]);
		const seen: string[] = [];
		const js = evalRuntime(revealing(), root, (_i, to) => seen.push(to));
		js.start();
		// Nothing bound on the element: a view trigger is not an event.
		assert.deepEqual(Object.keys(els.m_a.listeners), []);
		assert.deepEqual(watcher.watched, ["m_a"]);
		assert.equal(js.state("m_a"), "away", "settled first, and the observer has not spoken");

		watcher.report([{ node: "m_a", inside: true }]);
		assert.equal(js.state("m_a"), "here");
		// The initial state, then the reveal — in that order, which is what says
		// the load chain ran before the observer rather than being overwritten by
		// it.
		assert.deepEqual(seen, ["away", "here"]);
	} finally {
		watcher.remove();
	}
});

test("a view crossing that repeats the same answer fires nothing", () => {
	// An observer re-reports on a resize and on a scroll that did not change the
	// answer. A machine that fired `viewenter` twice would take a second edge out
	// of the state the first one arrived in, which on a three-state reveal is a
	// machine that skips a state for a reason nothing on the page marks.
	const watcher = observing();
	watcher.install();
	try {
		const { root } = page(["m_a"]);
		const moves: string[] = [];
		const js = evalRuntime(revealing(), root, (_i, to) => moves.push(to));
		js.start();
		moves.length = 0;

		watcher.report([{ node: "m_a", inside: true }]);
		watcher.report([{ node: "m_a", inside: true }]);
		watcher.report([{ node: "m_a", inside: true }]);
		assert.deepEqual(moves, ["here"], "three records, one crossing");

		watcher.report([{ node: "m_a", inside: false }]);
		assert.deepEqual(moves, ["here", "away"], "and the crossing back is one too");
		// A record about something the table does not drive is ignored rather than
		// thrown on: the observer is one per document and an element could be
		// anything.
		watcher.report([{ node: "nobody", inside: true }]);
		assert.deepEqual(moves, ["here", "away"]);
	} finally {
		watcher.remove();
	}
});

test("a page with no IntersectionObserver runs, and simply never crosses", () => {
	// The `typeof` guard, which is not defensive tidiness: this text is evaluated
	// in Node by every test in this file, and a bare `new IntersectionObserver`
	// would throw on the first line of `start()` — taking the machine's ordinary
	// click behaviour down with it, in a page as well as in a test.
	const { root } = page(["m_a"]);
	const js = evalRuntime(revealing(), root);
	assert.doesNotThrow(() => {
		js.start();
	});
	assert.equal(js.state("m_a"), "away");
});

/* ------------------------------------------------------------------ */
/* Pacing is the stylesheet's, and stays there                         */
/* ------------------------------------------------------------------ */

test("the runtime reads a clock and never sets one", () => {
	// Load-bearing, and stated as a test because it is exactly the kind of fact
	// somebody helpfully breaks. A transition's duration, delay and stagger are
	// already in the exported file, as the `transition:` declaration `export.ts`
	// puts on each changed node's base rule — `<props> <dur>ms <easing>
	// <delay>ms`, with the stagger folded into each node's own delay in `order/2`
	// sequence (spec §8.2). The browser's compositor is the animator. A script
	// that *also* waited before flipping `data-state` would apply every delay
	// twice and turn every stagger into a stutter.
	for (const timer of ["setTimeout", "setInterval", "requestAnimationFrame"]) {
		assert.ok(
			!MACHINE_RUNTIME.includes(timer),
			`the runtime must not reach for ${timer}`,
		);
	}

	// `Date.now` is the one that changed, and the two halves of this test are the
	// distinction the ladder spec §2.5 draws. An exit time here is a *gate* and not
	// a schedule: a trigger arriving too early is dropped and not remembered, so
	// the runtime subtracts two clock readings and never asks to be woken. Reading
	// the clock is therefore required — an exit gate without one would be an exit
	// gate that always opens — and it is required to appear exactly once, as the
	// fallback for the injected clock, because a second reading in a different
	// place is how a "held for" turns into a "wait for".
	assert.equal(MACHINE_RUNTIME.split("Date.now").length - 1, 1);
	assert.ok(MACHINE_RUNTIME.includes("var readClock = clock || function ()"));

	// Nor does the table carry a duration for it to wait on. `exit` is the one
	// number that had to be added and it is the only one: `MachineTable` still has
	// no `duration`, no `delay` and no `stagger`, because those are the CSS's.
	const json = JSON.stringify(menuTable());
	assert.equal(json.includes("duration"), false);
	assert.equal(json.includes("delay"), false);
	assert.equal(json.includes("stagger"), false);
});

test("firing is synchronous: the state is decided at the instant of the event", () => {
	// The consequence of having no timers, asserted from the outside. The state is
	// true the moment the event lands; when it becomes *visible* is CSS's, which
	// is what lets a stagger be a stagger without the runtime knowing the word.
	const { root, els } = page(["m_a"]);
	const js = evalRuntime(menuTable(), root);
	js.start();

	els.m_a.dispatch("click");
	assert.equal(els.m_a.attrs["data-state"], "open");
	assert.equal(js.statesIn.m_a[BASE_LAYER], "open");
});

/* ------------------------------------------------------------------ */
/* Nothing to do                                                       */
/* ------------------------------------------------------------------ */

test("an empty table is a runtime that binds nothing and does nothing", () => {
	// Spec §11 step 9.3 says the *call site* turns this into no script at all, and
	// that decision belongs to `export.ts` — it is the only place that knows
	// whether every state collapsed to a pseudo-class, which is the common case
	// and the whole point of the collapse. What is owned here is that emitting it
	// anyway is harmless.
	const empty: MachineTable = { instances: {}, machines: {} };
	const script = runtimeScript(empty);
	assert.doesNotThrow(() => {
		new Function(script)();
	});

	const { root, els } = page(["m_a"]);
	const js = evalRuntime(empty, root);
	js.start();
	assert.deepEqual(js.states, {});
	assert.equal(els.m_a.attrs["data-state"], undefined);
	assert.equal(Object.keys(els.m_a.listeners).length, 0);
});

test("a document with no machines has an empty table and no behaviour to lose", () => {
	const bare = machineTable(
		menus([{ id: "m_a" }], threeStates(), threeEdges()),
	);
	assert.notDeepEqual(bare.instances, {});

	const none = machineTable({ ...menus([{ id: "m_a" }], [], []), machines: [] });
	assert.deepEqual(none, {
		instances: {},
		machines: {},
		settings: { dragSlop: DRAG_SLOP_PX },
	});
	const js = evalRuntime(none);
	js.start();
	assert.equal(js.fireIn("m_a", "click"), null);
});

/* ------------------------------------------------------------------ */
/* The ladder: one table, two readers, still                           */
/* ------------------------------------------------------------------ */

test("every (layer, state, trigger, valuation) the runtime answers is the one stepLayer answers", () => {
	// The extended agreement test, and the reason this file exists said one rung
	// up. Exhaustive rather than illustrative, for the shipped matrix's reason:
	// the interesting half of an interpreter is what it *refuses*, and a runtime
	// that took the first edge it found would sail through any test that only ever
	// asked it about edges that fire. Guards make that far worse, because a
	// runtime that ignored `when` entirely would pass every test written about a
	// guard that holds.
	const table = ladderTable();
	const js = evalRuntime(table);

	const layers = ["press", "glow", "boot", "nope"];
	const states = ["shut", "open", "busy", "dim", "bright", "cold", "warm", "gone", ""];
	const triggers = [...TRIGGER_NAMES, "wiggle"];
	// Four valuations: the store as seeded, the store with the number guard open,
	// the store with the boolean guard shut, and an empty store — which is the one
	// a reader is most likely to get wrong, because "the host has said nothing" has
	// to refuse every condition rather than pass it.
	const valuations: InputValues[] = [
		{},
		{ ready: true, armed: false, level: 200 },
		{ ready: false, armed: false, level: 800 },
		{ ready: true, level: 500 },
	];
	const fireds = [[], ["saved"], ["armed"]];
	const helds = [0, 299, 300, undefined];

	let moves = 0;
	let stops = 0;
	for (const layer of layers) {
		for (const from of states) {
			for (const trigger of triggers) {
				for (const inputs of valuations) {
					for (const fired of fireds) {
						for (const heldMs of helds) {
							const mine = js.stepIn(instance, layer, from, trigger, inputs, fired, heldMs);
							const theirs = stepLayer(
								table,
								instance,
								layer,
								from,
								trigger as Trigger,
								inputs,
								new Set(fired),
								heldMs,
							);
							assert.equal(
								mine,
								theirs,
								`${layer}/${from} on ${trigger} with ${JSON.stringify(inputs)} fired ${fired.join()} held ${String(heldMs)}: runtime ${String(mine)}, studio ${String(theirs)}`,
							);
							if (typeof theirs === "string") moves += 1;
							if (theirs === null) stops += 1;
						}
					}
				}
			}
		}
	}

	// Guards on the guard. Agreement is trivially true if neither ever moves, and
	// a typo in the fixture would produce exactly that — so both halves of the
	// three-valued answer have to have happened, and the `null` half is the one a
	// reader that treated "stopped" as "nothing" would silently lose.
	assert.ok(moves > 0);
	assert.ok(stops > 0);
});

test("the shipped step and the layered one disagree, and the layered one is right", () => {
	// `x1` in the fixture goes from a state of the press layer to a state of the
	// glow layer. The flat table cannot see layers at all — it checks only that
	// both ends are states of the *machine* — so the shipped lookup answers it,
	// and answering it would write `bright` into the press layer's attribute,
	// where the only rules named `bright` live under the glow layer's selector.
	//
	// This is not a bug being asserted into permanence: `machines.ts` records that
	// the flat table is kept for the shipped readers and goes when they do, and the
	// per-layer table already drops the edge. What the test pins is that `fire`
	// reads the right one of the two, which is the whole difference between the
	// two lookups being a transition and being a trap.
	const table = ladderTable();
	const js = evalRuntime(table);
	assert.equal(js.step(instance, "shut", "pointerup"), "bright");
	assert.equal(stepMachine(table, instance, "shut", "pointerup"), "bright");
	assert.equal(js.stepIn(instance, "press", "shut", "pointerup"), undefined);
	assert.equal(js.stepIn(instance, "glow", "shut", "pointerup"), undefined);

	js.start();
	assert.equal(js.fireIn(instance, "pointerup"), null);
	assert.equal(js.state(instance), "shut");
	assert.equal(js.stateIn(instance, "glow"), "dim");
});

test("firing asks every layer at once, and the answer is stepInstance's", () => {
	// A layer is the thing that is in one state at a time; an instance is in one
	// state per layer, all at once. So one trigger may move the press layer and
	// leave the glow layer where it was, and both are true in the same moment.
	//
	// Driven twice over the same script, once with the clock stopped and once with
	// it far ahead, because the exit gate is the one thing in here whose answer
	// depends on when it is asked — and a runtime that read its own clock
	// differently from the record handed to `stepInstance` would agree by accident
	// in the first pass and diverge in the second.
	for (const ahead of [false, true]) {
		const table = ladderTable();
		const { js, tick } = clocked(table);
		js.start();
		js.setInput(instance, "level", 800);

		const script: Array<[string, string[]]> = [
			["click", []],
			["pointerdown", []],
			["pointerup", []],
			["pointerenter", []],
			["pointerleave", []],
			["click", []],
			["load", ["saved"]],
			["click", []],
			["focus", []],
		];
		let moved = 0;
		for (const [trigger, fired] of script) {
			if (ahead) tick(1_000_000);
			// What the twin is told is exactly what the runtime knows: the layers that
			// are still answering, and how long each has been where it is. A stopped
			// layer is a layer the caller leaves out, which is how `stepInstance` says
			// "stopped" without holding any state of its own.
			const current: Record<string, string> = {};
			const heldMs: Record<string, number> = {};
			for (const layer of ["press", "glow", "boot"]) {
				const at = js.stateIn(instance, layer);
				if (at === null || js.stopped(instance, layer)) continue;
				current[layer] = at;
				heldMs[layer] = ahead ? Number.POSITIVE_INFINITY : 0;
			}
			const theirs = stepInstance(
				table,
				instance,
				current,
				trigger as Trigger,
				js.inputs[instance],
				new Set(fired),
				heldMs,
			);
			const mine = js.fireIn(instance, trigger, fired);
			assert.deepEqual(mine ?? undefined, theirs, `${trigger} (${ahead ? "late" : "at once"})`);
			if (mine !== null) moved += 1;
		}
		assert.ok(moved >= 4, "the script has to actually move things");
	}
});

/* ------------------------------------------------------------------ */
/* Rung one: inputs                                                    */
/* ------------------------------------------------------------------ */

test("the store is seeded from the table, and a trigger is not in it", () => {
	// An input is a runtime value, so the store is per *instance*: two buttons made
	// from one definition have two hover progresses and always did. A trigger has
	// no entry at all, because "not fired" is the absence of a value rather than
	// one — a store that held one would fire every guarded edge on the next
	// unrelated event, which reads to a person as a machine gone off on its own.
	const js = evalRuntime(ladderTable([{ id: "m_a" }, { id: "m_b" }]));
	js.start();

	assert.deepEqual(js.inputs.m_a, { ready: true, armed: false, level: 200 });
	assert.deepEqual(js.inputs.m_b, { ready: true, armed: false, level: 200 });
	assert.equal(Object.hasOwn(js.inputs.m_a, "saved"), false);

	// And they are two stores, not one read twice.
	js.setInput("m_a", "level", 900);
	assert.equal(js.inputs.m_a.level, 900);
	assert.equal(js.inputs.m_b.level, 200);
});

test("a number input is clamped to its declared range, and the seed is not", () => {
	const js = evalRuntime(ladderTable());
	js.start();

	assert.equal(js.setInput(instance, "level", 800), 800);
	assert.equal(js.setInput(instance, "level", 5000), 1000);
	assert.equal(js.setInput(instance, "level", -5000), 0);

	// The asymmetry is deliberate and is worth a fixture of its own: what the
	// *document* says an input starts at is carried through untouched, even where
	// it sits outside the document's own declared range, because that is a thing
	// the checks report and a person fixes rather than a thing the runtime should
	// quietly rewrite so nobody ever sees it. What a *host* hands in is clamped,
	// because a host is not a person and there is nowhere to report it to.
	const wide = machineTable(
		ladder().machines?.[0]
			? {
					...ladder(),
					machines: [
						{
							...ladder().machines[0],
							inputs: [input("level", "number", { initial: "9", min: "0", max: "1" })],
						},
					],
				}
			: ladder(),
	);
	const loose = evalRuntime(wide);
	loose.start();
	assert.equal(loose.inputs[instance].level, 9000);
});

test("setInput refuses what it cannot store, rather than coercing it", () => {
	// Every refusal here is a value that would otherwise sit in the store failing
	// comparisons in silence, which reads exactly like a machine that has stopped
	// responding — the hardest kind of bug to report, because nothing happened.
	const js = evalRuntime(ladderTable());
	js.start();
	const before = { ...js.inputs[instance] };

	assert.equal(js.setInput(instance, "nosuch", true), null);
	assert.equal(js.setInput("nobody", "ready", true), null);
	// A trigger is fired, not set.
	assert.equal(js.setInput(instance, "saved", true), null);
	// Kind mismatches, both ways round.
	assert.equal(js.setInput(instance, "ready", 1 as unknown as boolean), null);
	assert.equal(js.setInput(instance, "level", true as unknown as number), null);
	assert.equal(js.setInput(instance, "level", Number.NaN), null);

	assert.deepEqual(js.inputs[instance], before);
});

test("a guard is the difference between moving and not, on the same trigger", () => {
	// The whole of rung two from the outside. Same state, same trigger, two
	// answers, and the only thing that changed is a value no pixel depends on —
	// which is exactly why an input is not a design-space variable.
	const { root, els } = page([instance]);
	const js = evalRuntime(ladderTable(), root);
	js.start();

	els[instance].dispatch("click");
	assert.equal(js.state(instance), "open");

	// `ready` is true, so the guarded edge into `busy` is open.
	els[instance].dispatch("pointerdown");
	assert.equal(js.state(instance), "busy");
	assert.equal(els[instance].attrs["data-state"], "busy");

	// Wind it back and shut the guard.
	js.set(instance, "open");
	js.setInput(instance, "ready", false);
	els[instance].dispatch("pointerdown");
	assert.equal(js.state(instance), "open");
});

test("the four orderings are asked of a number, in thousandths", () => {
	// `ge 0.5` is 500 thousandths, and the boundary is the point: a ratio reaches
	// the runtime as a whole number of thousandths for the same reason a length
	// reaches the program as a whole number of EMU, so "at least" and "more than"
	// are exact rather than approximate.
	const js = evalRuntime(ladderTable());
	js.start();

	assert.equal(js.stepIn(instance, "glow", "dim", "pointerenter", { level: 499 }), undefined);
	assert.equal(js.stepIn(instance, "glow", "dim", "pointerenter", { level: 500 }), "bright");
	assert.equal(js.stepIn(instance, "glow", "dim", "pointerenter", { level: 1000 }), "bright");
	// An input the host has said nothing about refuses, rather than passing: the
	// store is seeded from every declared initial, so a missing entry means the
	// input is not one of this machine's at all, and answering "yes" would let a
	// typo open an edge.
	assert.equal(js.stepIn(instance, "glow", "dim", "pointerenter", {}), undefined);
});

test("a trigger input is true for one evaluation and gone", () => {
	// The Entry edge of the boot layer is guarded on `saved fired`, which is the
	// idiom the rung exists for: "when the save succeeds, move". Nothing has fired
	// at start, so settling leaves the layer at its initial state.
	const js = evalRuntime(ladderTable());
	js.start();
	assert.equal(js.stateIn(instance, "boot"), "cold");

	// Firing it settles the layer, now, rather than arming it for whatever event
	// happens to come next. An armed trigger would be the failure `INPUT_KINDS`
	// warns about, one event later: a machine that goes off on its own.
	assert.deepEqual(js.fireInput(instance, "saved"), { boot: "warm" });
	assert.equal(js.stateIn(instance, "boot"), "warm");
	assert.equal(Object.hasOwn(js.inputs[instance], "saved"), false);

	// And it is spent. A second settle moves nothing, because the trigger is not
	// in a store to be found again.
	assert.equal(js.fireInput(instance, "saved"), null);

	assert.equal(js.fireInput(instance, "ready"), null, "a boolean is set, not fired");
	assert.equal(js.fireInput(instance, "nosuch"), null);
});

test("firing an input on a machine with no guarded load edge moves nothing", () => {
	// Settling is a fixpoint: `start` already followed every load edge that was
	// open, so re-running it can only move something a guard has just unlocked.
	// That is what makes `load` the honest trigger for a host-fired input rather
	// than an invented one — the alternative, firing every trigger the machine
	// uses, would take a click nobody clicked.
	const js = evalRuntime(
		machineTable(
			menus([{ id: "m_a" }], [state("boot"), state("shut")], [
				edge("t0", "boot", "shut", "load"),
			], { inputs: [input("saved", "trigger")] }),
		),
	);
	js.start();
	assert.equal(js.state(instance), "shut");
	assert.equal(js.fireInput(instance, "saved"), null);
	assert.equal(js.state(instance), "shut");
});

/* ------------------------------------------------------------------ */
/* Rung two: the exit gate                                             */
/* ------------------------------------------------------------------ */

test("an exit time gates a trigger, and the trigger is dropped rather than deferred", () => {
	// The stated departure from Rive, asserted rather than described. Rive would
	// fire the transition when the time elapsed if the condition still held; we
	// drop the event. The reason is this file's own: a deferred fire is a state
	// change nobody's finger caused, arriving at a moment nothing on the page
	// marks, and a runtime with a queue in it is a second animator arguing with
	// the compositor.
	const { js, tick } = clocked(ladderTable());
	js.start();
	js.fireIn(instance, "click");
	js.fireIn(instance, "pointerdown");
	assert.equal(js.state(instance), "busy");

	// Too early: nothing moves, and nothing is remembered.
	tick(299);
	assert.equal(js.fireIn(instance, "pointerup"), null);
	assert.equal(js.state(instance), "busy");

	// Past the gate with no new event: still nothing. This is the whole of "not
	// remembered" — a queue would have moved the machine here, with no finger on
	// it.
	tick(9_000);
	assert.equal(js.state(instance), "busy");

	// And the next event, which is a real one, is taken.
	assert.deepEqual(js.fireIn(instance, "pointerup"), {
		press: "open",
		glow: "dim",
		boot: "cold",
	});
});

test("the gate opens at the exit time, not after it", () => {
	// `held < exit`, strictly, so a 300ms exit time fires *at* 300ms. An off-by-one
	// here is a debounce that is one tick long in the studio and another in the
	// file, which is the class of disagreement this whole file is built to make
	// impossible.
	const { js, tick } = clocked(ladderTable());
	js.start();
	js.fireIn(instance, "click");
	js.fireIn(instance, "pointerdown");
	tick(300);
	assert.deepEqual(js.fireIn(instance, "pointerup"), {
		press: "open",
		glow: "dim",
		boot: "cold",
	});
});

test("the clock is read at each state change, per layer", () => {
	// The gate is a difference between two readings, so what it measures is how
	// long *this layer* has been where it is — not how long the instance has
	// existed, and not how long some other layer has been settled. A single
	// per-instance stamp would make a busy glow layer open the press layer's gate.
	const { js, tick } = clocked(ladderTable());
	js.start();
	tick(10_000);
	js.fireIn(instance, "click");
	// The press layer has just moved, so its clock restarts here; every other
	// layer has been where it is for ten seconds.
	js.fireIn(instance, "pointerdown");
	tick(299);
	assert.equal(js.fireIn(instance, "pointerup"), null);
	tick(1);
	assert.ok(js.fireIn(instance, "pointerup"));
});

/* ------------------------------------------------------------------ */
/* Rung three: Entry, Exit and Any                                     */
/* ------------------------------------------------------------------ */

test("an Any edge is taken from every state of its own layer, and never another's", () => {
	// It is a source, not a state: it does not appear in `states`, nothing goes
	// *to* it, and it is written into every row of the layer whose state it lands
	// in — *every* row, including the row of a state that already answers the same
	// trigger with an edge of its own.
	//
	// That last row is why this test reads the table as well as running it, and the
	// reason is worth spelling out because the obvious version of this test is
	// wrong. `busy` has `t6` on `pointerleave` too, so from there the specific edge
	// wins and `stepIn` says `open` — which is the *next* test's whole subject. So
	// asking `stepIn` alone could not tell "the Any edge is in that row and was
	// overridden" apart from "the Any edge was never written into that row at all",
	// and those two are a precedence rule and a missing feature. This test is the
	// coverage half and reads the rows; the one below is the precedence half and
	// runs them. Between them the Any edge is pinned at both ends, which is what an
	// earlier draft of this pair did not do: it asserted `shut` from all three
	// states, contradicting the test directly beneath it.
	const table = ladderTable();
	const js = evalRuntime(table);
	js.start();

	// Annotated rather than inferred, here and on `row` below, because `assert.ok`
	// is a TypeScript assertion function: narrowing one is only allowed against a
	// name that carries an explicit type, and without the annotations the whole
	// chain reading out of `press` infers circularly and lands as `any` — which
	// would quietly turn the row assertions below into no assertions at all.
	const press: RuntimeLayer | undefined = table.machines.m1.layers?.find(
		(layer) => layer.id === "press",
	);
	assert.ok(press);
	// Not a state, and nothing arrives at it: `any` is spelled in the document and
	// exists nowhere in the table.
	assert.equal(press.states.includes("any"), false);
	assert.deepEqual(press.states, ["shut", "open", "busy"]);
	assert.equal(js.stepIn(instance, "press", "any", "pointerleave"), undefined);

	// Every row of this layer ends with it, which is what "from every state" means
	// once expansion has happened — last because Any comes after the specific
	// edges, which is the tie-break the table holds.
	for (const from of press.states) {
		const row: RuntimeEdge[] = press.edges[from]?.pointerleave ?? [];
		assert.equal(row[row.length - 1]?.to, "shut", from);
	}
	// Two of the three rows hold nothing else on that trigger, so what the Any edge
	// says is what the runtime does. The third holds two, and is the next test's.
	for (const from of ["shut", "open"]) {
		assert.equal(js.stepIn(instance, "press", from, "pointerleave"), "shut", from);
	}
	assert.equal(press.edges.busy?.pointerleave?.length, 2);

	// And it stops at its own layer's wall. An Any edge that leaked into the other
	// two would be a fallback that hijacked them — neither of which has any edge on
	// `pointerleave` from the state it starts in.
	assert.equal(js.stepIn(instance, "glow", "dim", "pointerleave"), undefined);
	assert.equal(js.stepIn(instance, "boot", "cold", "pointerleave"), undefined);
});

test("a layer with no edge table at all is inert rather than a throw", () => {
	// The table in an exported file is JSON in a script tag that no compiler ever
	// saw, so `RuntimeLayer.edges` being a required field says nothing about what
	// can actually arrive here. A layer without one moves nowhere — which is what a
	// layer with an empty edge table does too, so this is the runtime being more
	// careful than `stepLayer` rather than answering differently from it. The whole
	// point is that the *rest* of the machine keeps working, because a throw on
	// line one takes the behaviour of the whole page with it.
	const table = {
		instances: { m_a: { machine: "m1", initial: "shut", layerStart: { press: "shut", glow: "dim" } } },
		machines: {
			m1: {
				initial: "shut",
				states: ["shut", "open", "dim"],
				edges: {},
				layers: [
					{ id: "press", initial: "shut", states: ["shut", "open"], edges: { shut: { click: [{ to: "open" }] } } },
					// No `edges` key whatever, which is the shape a hand-written table has.
					{ id: "glow", initial: "dim", states: ["dim"] },
				],
			},
		},
	} as unknown as MachineTable;
	const js = evalRuntime(table);
	js.start();
	assert.equal(js.stepIn("m_a", "glow", "dim", "click"), undefined);
	assert.deepEqual(js.fireIn("m_a", "click"), { press: "open", glow: "dim" });
	assert.equal(js.stateIn("m_a", "glow"), "dim");
});

test("a specific edge beats an Any edge on the same trigger", () => {
	// Rive's rule, and the only rule that makes Any usable: a fallback that beat
	// the specific case would be a fallback nobody could override. It is a
	// tie-break in the *table* — specific edges first, Any second — rather than a
	// comparison here, so the studio cannot order the list differently.
	const js = evalRuntime(ladderTable());
	js.start();
	assert.equal(js.stepIn(instance, "press", "busy", "pointerleave"), "open");
	// Both edges really are there, so this is a precedence and not an absence.
	assert.equal(js.stepIn(instance, "press", "open", "pointerleave"), "shut");
});

test("an Entry edge decides where the runtime starts, and the document decides what is drawn", () => {
	// Entry is sugar over the initial state, and it is spelled as a rule so that a
	// hand-written `entry` gets what a document one gets. What it does *not* touch
	// is which state the canvas draws: that is a fact from the document, and the
	// two can differ exactly as they already can when a node names a non-initial
	// state.
	const table = ladderTable();
	assert.equal(table.instances[instance].layerStart?.boot, "cold");

	const js = evalRuntime(table);
	js.start();
	assert.equal(js.stateIn(instance, "boot"), "cold");
	// The Entry edge is on the layer's initial state, where the runtime starts,
	// which is what makes it an Entry edge at all.
	assert.equal(
		js.stepIn(instance, "boot", "cold", "load", { }, ["saved"]),
		"warm",
	);
});

test("an Exit edge stops one layer and leaves the rest of the machine running", () => {
	// A stopped layer keeps whatever state it was last in — its classes stay on
	// the element, its copy is still what the picture draws — and stops answering.
	// It is emphatically not in a state called Exit: a `data-state="exit"` would
	// match no rule in the stylesheet and would look exactly like a machine that
	// had failed.
	const { root, els } = page([instance]);
	const js = evalRuntime(ladderTable(), root);
	js.start();
	js.fireInput(instance, "saved");
	assert.equal(js.stateIn(instance, "boot"), "warm");
	assert.equal(js.stopped(instance, "boot"), false);

	// One click: the press layer moves and the boot layer stops, in one event.
	assert.deepEqual(js.fireIn(instance, "click"), {
		press: "open",
		glow: "dim",
		boot: null,
	});
	assert.equal(js.stopped(instance, "boot"), true);
	assert.equal(js.stateIn(instance, "boot"), "warm");
	assert.equal(els[instance].attrs["data-state-boot"], "warm");

	// And it is out of the walk from here on: the other two keep answering, and
	// nothing writes `exit` anywhere.
	assert.deepEqual(js.fireIn(instance, "click"), { press: "shut", glow: "dim" });
	assert.equal(JSON.stringify(els[instance].attrs).includes("exit"), false);
});

/* ------------------------------------------------------------------ */
/* Rung four: layers                                                   */
/* ------------------------------------------------------------------ */

test("the first layer writes data-state and every further one writes its own", () => {
	// The asymmetry is the whole reason for it: a one-layer file is byte-identical
	// to the one that shipped before layers existed, so no existing export changes
	// and no existing stylesheet has to learn a new attribute.
	const { root, els } = page([instance]);
	evalRuntime(ladderTable(), root).start();

	assert.equal(els[instance].attrs["data-state"], "shut");
	assert.equal(els[instance].attrs["data-state-glow"], "dim");
	assert.equal(els[instance].attrs["data-state-boot"], "cold");
	assert.equal(els[instance].attrs["data-state-press"], undefined);

	// And the one-layer document that came before writes exactly one attribute,
	// spelled exactly as it always was.
	const { root: plain, els: one } = page(["m_a"]);
	evalRuntime(menuTable(), plain).start();
	assert.deepEqual(Object.keys(one.m_a.attrs).sort(), ["data-node", "data-state"]);
});

test("two layers move independently, and one trigger can move both", () => {
	const { root, els } = page([instance]);
	const js = evalRuntime(ladderTable(), root);
	js.start();
	js.setInput(instance, "level", 800);

	// `pointerenter` is the glow layer's alone.
	els[instance].dispatch("pointerenter");
	assert.equal(js.stateIn(instance, "glow"), "bright");
	assert.equal(js.state(instance), "shut");

	// `pointerleave` is both layers' at once: the press layer's Any edge and the
	// glow layer's own. Two answers, one moment, which is what a layer is.
	els[instance].dispatch("pointerleave");
	assert.equal(js.stateIn(instance, "glow"), "dim");
	assert.equal(js.state(instance), "shut");
	assert.equal(els[instance].attrs["data-state-glow"], "dim");
});

test("an instance starts each layer where the document drew it", () => {
	// `SceneNode.state` says the first layer's and `SceneNode.states` says any
	// layer's, with the record winning where a document holds both. Two fields for
	// one idea, paid for on purpose: every instance that exists today says its
	// state in one string, and a migration is a thing that can go wrong in
	// exchange for a tidiness nobody can see.
	const js = evalRuntime(ladderTable([{ id: "m_a", at: { press: "busy", glow: "bright" } }]));
	js.start();
	assert.equal(js.state(instance), "busy");
	assert.equal(js.stateIn(instance, "glow"), "bright");
	assert.equal(js.stateIn(instance, "boot"), "cold");
	assert.equal(js.stateIn(instance, "nope"), null);
});

test("a layer only listens for what its own edges use, across all the layers", () => {
	// One listener per distinct event any layer names. Attaching all eight would
	// put a click handler on every exported instance in the document, which is a
	// real cost on a page and a real surprise in a devtools panel — and attaching
	// only the first layer's would make a further layer's edges dead.
	const { root, els } = page([instance]);
	evalRuntime(ladderTable(), root).start();
	assert.deepEqual(
		Object.keys(els[instance].listeners).sort(),
		["click", "pointerdown", "pointerenter", "pointerleave", "pointerup"],
	);
	// `load` has no event and never becomes a listener, however many layers use it.
	assert.equal(els[instance].listeners[""], undefined);
});

test("onChange names the layer, so a host that re-renders knows which attribute moved", () => {
	// The third argument is appended rather than substituted: a host written
	// against the shipped two-argument callback goes on working and simply ignores
	// it, which is the only way to add a layer id to a signature that is already in
	// somebody's page.
	const seen: Array<[string, string, string]> = [];
	const js = evalRuntime(ladderTable(), null, (id, next, layer) => {
		seen.push([id, next, layer]);
	});
	js.start();
	assert.deepEqual(seen, [
		[instance, "shut", "press"],
		[instance, "dim", "glow"],
		[instance, "cold", "boot"],
	]);

	seen.length = 0;
	js.fireIn(instance, "click");
	assert.deepEqual(seen, [[instance, "open", "press"]]);
});

test("a state id that is not one is refused, per layer", () => {
	// The empty string is the case worth having: a layer somebody has just added
	// has no states, so the table spells its initial as `""`, and a
	// `data-state-glow=""` would match no rule in the stylesheet while looking to
	// a reader exactly like a machine that failed to move.
	const table: MachineTable = {
		instances: { m_a: { machine: "m1", initial: "shut", layerStart: { press: "shut" } } },
		machines: {
			m1: {
				initial: "shut",
				states: ["shut"],
				edges: {},
				layers: [
					{ id: "press", initial: "shut", states: ["shut"], edges: {} },
					{ id: "glow", initial: "", states: [], edges: {} },
				],
			},
		},
	};
	const { root, els } = page(["m_a"]);
	const js = evalRuntime(table, root);
	js.start();

	assert.equal(js.state("m_a"), "shut");
	assert.equal(js.stateIn("m_a", "glow"), null);
	assert.equal(els.m_a.attrs["data-state-glow"], undefined);
	assert.equal(js.setIn("m_a", "glow", undefined as unknown as string), null);
});

/* ------------------------------------------------------------------ */
/* Rung five: what is not here                                         */
/* ------------------------------------------------------------------ */

test("the table carries no timeline and the runtime samples none", () => {
	// Stated as a test because it is a boundary somebody will otherwise try to
	// helpfully cross. A timeline is `@keyframes` in the exported file and the
	// compositor plays it once this script switches the attribute; a blend is
	// arithmetic over a runtime value CSS cannot mix, so the file carries one stop
	// and a `lost` entry says which. Neither is in `MachineTable`, so there is
	// nothing here to sample — and a sampler in here, reading a second copy of the
	// keyframes shipped inside the script tag, would be exactly the two
	// implementations that drift.
	//
	// The real sampling is `machines.ts`'s `sampleTimeline` and `blendWeights`,
	// which need the *document* and the answer set, and which the studio canvas
	// calls with a model it already has.
	const table = machineTable(
		menus([{ id: "m_a" }], threeStates(), threeEdges(), {
			timelines: [
				{
					id: "w1",
					name: "Open",
					tracks: [
						{ part: "label", dim: "y", keys: [{ at: single("0ms"), value: single("0px") }] },
					],
				},
			],
		}),
	);
	const json = JSON.stringify(table);
	for (const word of ["timeline", "keys", "blend", "track"]) {
		assert.equal(json.includes(word), false, `the table must not carry ${word}`);
	}
	for (const word of ["keyframe", "lerp", "blend", "sample"]) {
		assert.equal(MACHINE_RUNTIME.includes(word), false, `the runtime must not mention ${word}`);
	}
});

/* ------------------------------------------------------------------ */
/* The strip                                                           */
/* ------------------------------------------------------------------ */

test("the strip takes only prose, and the two facts that make it safe hold", () => {
	// `runtimeSource` filters whole lines rather than parsing JavaScript, which is
	// safe on exactly two conditions. Both are properties of MACHINE_RUNTIME
	// rather than of the filter, so they are asserted here rather than trusted:
	// nothing may hide a `//` inside a string or a regex, and nothing may open a
	// block comment the line filter would leave half of.
	const lines = MACHINE_RUNTIME.split("\n");
	assert.deepEqual(
		lines.filter((l) => !l.trim().startsWith("//") && l.includes("//")),
		[],
		"a // anywhere but the start of a line would make this a parse, not a filter",
	);
	assert.deepEqual(
		lines.filter((l) => l.includes("/*") || l.includes("*/")),
		[],
		"a block comment cannot be removed a line at a time",
	);

	// What comes out is the code, in order, unchanged. Not reformatted, not
	// re-indented, not joined — a line that survives is byte-identical, which is
	// what keeps a stack trace out of somebody's page legible.
	const source = runtimeSource();
	assert.deepEqual(
		source.split("\n"),
		lines.filter((l) => l.trim() !== "" && !l.trim().startsWith("//")),
	);
	assert.equal(
		source.split("\n").some((l) => l.trim().startsWith("//")),
		false,
		"no comment survives",
	);

	// And it is worth what it costs. The regression this repays was measured at
	// +15.1 kB on the `machine` template; a floor rather than an equality, so the
	// test does not fail every time somebody writes another paragraph.
	assert.ok(
		MACHINE_RUNTIME.length - source.length > 12000,
		`the strip saved ${MACHINE_RUNTIME.length - source.length} bytes`,
	);
	assert.ok(source.startsWith('"use strict";'));
});

test("the stripped runtime is the one the agreement matrix drives", () => {
	// The condition the payload note sets for taking this trade at all: one strip,
	// in one function, that both callers go through. If `evalRuntime` ever went
	// back to MACHINE_RUNTIME this test fails, and every other test in this file
	// would quietly become a test about a text that does not ship.
	const table = ladderTable();
	assert.ok(runtimeScript(table).includes(runtimeSource()));
	assert.equal(runtimeScript(table).includes(MACHINE_RUNTIME), false);

	// Same table, same answers, through the text that ships.
	const js = evalRuntime(table);
	js.start();
	assert.equal(js.state(instance), "shut");
	assert.equal(js.step(instance, "shut", "pointerup"), "bright");
});
