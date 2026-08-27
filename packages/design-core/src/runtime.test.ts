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
	type MachineTable,
	machineTable,
	stepMachine,
} from "./machines.ts";
import {
	type Machine,
	type MachineState,
	type Scene,
	type SceneNode,
	TRIGGERS,
	TRIGGER_NAMES,
	type Transition,
	type Trigger,
	emptyScene,
} from "./scene.ts";
import {
	MACHINE_RUNTIME,
	TRIGGER_EVENTS,
	evalRuntime,
	runtimeScript,
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
	uses: Array<{ id: string; state?: string }>,
	states: MachineState[],
	transitions: Transition[],
	machineId = "m1",
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
		id: machineId,
		name: "Menu states",
		root: "menu",
		states,
		transitions,
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
/* A DOM small enough to read                                          */
/* ------------------------------------------------------------------ */

interface FakeElement {
	attrs: Record<string, string>;
	listeners: Record<string, Array<() => void>>;
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	addEventListener(type: string, handler: () => void): void;
	dispatch(type: string): void;
}

function element(nodeId: string): FakeElement {
	return {
		attrs: { "data-node": nodeId },
		listeners: {},
		getAttribute(name) {
			return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
		},
		setAttribute(name, value) {
			this.attrs[name] = value;
		},
		addEventListener(type, handler) {
			(this.listeners[type] ??= []).push(handler);
		},
		dispatch(type) {
			for (const handler of this.listeners[type] ?? []) handler();
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
	const script = runtimeScript(menuTable());
	assert.ok(script.includes(MACHINE_RUNTIME));

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
		assert.equal(TRIGGER_EVENTS[trigger], TRIGGERS[trigger].event);
	}
	assert.equal(TRIGGER_EVENTS.focus, "focusin");
	assert.equal(TRIGGER_EVENTS.blur, "focusout");
	// `load` is the trigger with no event: it fires once at start, and the runtime
	// tests the string for emptiness rather than keeping a second list.
	assert.equal(TRIGGER_EVENTS.load, "");

	const script = runtimeScript(menuTable());
	const json = /^var E = (.*);$/m.exec(script);
	assert.ok(json);
	assert.deepEqual(JSON.parse(json[1]), TRIGGER_EVENTS);
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
	assert.equal(js.fire("m_a", "pointerleave"), null);
	assert.equal(js.state("m_a"), "shut");
	assert.equal(js.fire("m_a", "pointerup"), null);
	assert.equal(js.state("m_a"), "shut");

	// A trigger no document can even spell.
	assert.equal(js.fire("m_a", "wiggle"), null);
	assert.equal(js.state("m_a"), "shut");

	// And the edge that is there still works afterwards — the refusals left
	// nothing behind.
	assert.equal(js.fire("m_a", "click"), "open");
	assert.equal(js.fire("m_a", "pointerleave"), "shut");
});

test("an instance the table does not drive answers null and stays out of it", () => {
	const js = evalRuntime(menuTable());
	js.start();

	assert.equal(js.state("menu"), null);
	assert.equal(js.fire("menu", "click"), null);
	assert.equal(js.fire("nobody", "click"), null);
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
	assert.equal(js.fire("m_a", "click"), null);
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
	assert.equal(js.fire("m_a", "click"), "open");
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
	js.fire("m_a", "click");
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
/* Pacing is the stylesheet's, and stays there                         */
/* ------------------------------------------------------------------ */

test("the runtime has no timers, because the transition declarations are the pacing", () => {
	// Load-bearing, and stated as a test because it is exactly the kind of fact
	// somebody helpfully breaks. A transition's duration, delay and stagger are
	// already in the exported file, as the `transition:` declaration `export.ts`
	// puts on each changed node's base rule — `<props> <dur>ms <easing>
	// <delay>ms`, with the stagger folded into each node's own delay in `order/2`
	// sequence (spec §8.2). The browser's compositor is the animator. A script
	// that *also* waited before flipping `data-state` would apply every delay
	// twice and turn every stagger into a stutter.
	for (const timer of [
		"setTimeout",
		"setInterval",
		"requestAnimationFrame",
		"Date.now",
		"performance.now",
	]) {
		assert.ok(
			!MACHINE_RUNTIME.includes(timer),
			`the runtime must not reach for ${timer}`,
		);
	}
	// Nor does the table carry a number for it to wait on — which is the same fact
	// one level down, and why `MachineTable` has no timing fields.
	assert.equal(JSON.stringify(menuTable()).includes("duration"), false);
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
	assert.equal(js.states.m_a, "open");
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
	assert.deepEqual(none, { instances: {}, machines: {} });
	const js = evalRuntime(none);
	js.start();
	assert.equal(js.fire("m_a", "click"), null);
});
