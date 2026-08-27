/**
 * The state machine runtime, as source text.
 *
 * An exported document is one self-contained file. There is nothing for it to
 * import, no bundler between it and the browser, and no second request it is
 * allowed to make — so the behaviour a machine needs has to arrive as characters
 * inside a `<script>` tag. That is why this module's product is a *string* and
 * not a function.
 *
 * The obvious way to write it is to generate JavaScript per machine: a function
 * with the states as a switch and the edges as `if`s. That was rejected, and the
 * reason is the whole shape of this file. Generated code is a second
 * implementation of the machine, and a second implementation is a thing that can
 * disagree with the first — so "what does clicking this button do" would have
 * two answers, the studio's {@link stepMachine} and whatever the emitter
 * happened to write that day, and nothing would ever notice they had drifted
 * apart. Instead the machine leaves as **data** — a {@link MachineTable}, the
 * same one the studio's playback reads — and this text is a generic interpreter
 * of it. One table, two readers, and `runtime.test.ts` runs *this exact text*
 * against `stepMachine` over every `(state, trigger)` pair there is. That test
 * is not a nicety; it is the only thing keeping the sentence "the studio and the
 * exported file behave the same" true.
 *
 * **What this runtime does not do: pacing.** It has no timers, and a search for
 * `setTimeout` in it comes up empty. A transition's duration, delay and stagger
 * are already in the file, as the `transition:` declaration `export.ts` puts on
 * each changed node's base rule — `<props> <dur>ms <easing> <delay>ms`, with the
 * stagger folded into each node's own delay in `order/2` sequence (spec §8.2).
 * The browser's compositor is the animator. If this script *also* waited before
 * flipping `data-state`, every delay in the document would be applied twice and
 * every stagger would be a stutter. So the runtime's whole job is to decide, at
 * the instant of the event, which state the element is in; when that change
 * becomes visible is CSS's business and is written down in CSS. This is also why
 * {@link MachineTable} carries no numbers: it does not need any.
 *
 * **Why it is ES5 and why it is a factory.** No arrow functions, no `const`, no
 * `Object.entries` — this text is pasted into a file somebody may open in
 * whatever browser they have, and a syntax error in a `<script>` takes the
 * behaviour of the whole page with it rather than degrading. And the text is the
 * *body of a function* taking `(T, E, root, onChange)` rather than a
 * self-starting block, for a reason that is entirely about being testable: a
 * self-starting block reaches for `document` on the first line, which means the
 * only way to check it is a browser, which means in practice nobody checks it.
 * As a factory it can be handed a null root and driven from Node, which is how
 * the agreement with `stepMachine` is proved at all.
 */
import type { MachineTable } from "./machines.ts";
import { TRIGGERS, TRIGGER_NAMES, type Trigger } from "./scene.ts";

/**
 * Which DOM event each trigger listens for — {@link TRIGGERS}, flattened to the
 * one column the runtime needs.
 *
 * Serialised into the script beside the table rather than written out inside
 * {@link MACHINE_RUNTIME}, and that is a deliberate choice about where drift can
 * happen. A copy of this mapping baked into the runtime text would be a second
 * statement of `TRIGGERS[g].event` — and the day somebody decides that `focus`
 * should listen for `focusin` rather than `focus` (which is exactly the decision
 * `scene.ts` already records, and for a good reason), the panel and the exported
 * file would quietly stop agreeing about what a focus trigger is. Deriving it
 * here means the table in the file is always the table in the document.
 *
 * The empty string for `load` is not a missing entry: `load` is the trigger with
 * no event, fired once when the runtime starts, and the runtime tests the string
 * for emptiness rather than keeping a second list of "the real events".
 */
export const TRIGGER_EVENTS: Record<Trigger, string> = Object.fromEntries(
	TRIGGER_NAMES.map((trigger) => [trigger, TRIGGERS[trigger].event]),
) as Record<Trigger, string>;

/**
 * The generated runtime, as source text: the body of
 * `function (T, E, root, onChange)`.
 *
 * `T` is a {@link MachineTable}, `E` is {@link TRIGGER_EVENTS}, `root` is a
 * `Document` or element to bind inside (null binds nothing, which is a runtime
 * that still answers questions but touches no DOM), and `onChange` is an
 * optional `(instance, state)` callback so a host that re-renders rather than
 * setting an attribute can hear about a move. It returns
 * `{ step, state, states, set, fire, start }`.
 *
 * `step` is the load-bearing one and it is written to be *the same lookup*
 * {@link stepMachine} is, down to returning `undefined` in the same four places:
 * an instance the table does not drive, a machine the table has not got, a state
 * with no outgoing edges, and a trigger that state has no edge on. Nothing here
 * consults a prototype guard, and the omission is on purpose — `stepMachine`
 * does not either, and the point of this function is to be indistinguishable
 * from it, not to be defensible on its own. The triggers it is ever asked about
 * come from `E`, which is eight fixed words.
 *
 * There is no wildcard from-state. A `"*"` in `T.machines[m].edges` is looked up
 * as a state literally called `"*"`, which is a state no document can spell — a
 * state id must be a bare ASP constant. That is not an oversight and it is not a
 * feature waiting to be added here: `stepMachine` has no wildcard, and a
 * wildcard that only this text understood would be the drift this whole file
 * exists to prevent. If a machine ever wants "this trigger does the same thing
 * from anywhere", it is `machineTable` that has to say so, in the table, for
 * both readers at once.
 */
export const MACHINE_RUNTIME = `"use strict";
// Everything the table says, with the two shapes the interpreter needs already
// pulled out, so a malformed table is an inert runtime rather than a throw on
// line one of somebody's page.
var instances = T && T.instances ? T.instances : {};
var machines = T && T.machines ? T.machines : {};
var events = E || {};
// Instance node id -> the state it is in right now. This is the only mutable
// thing in here, and it is what "reports the current state" means: a host reads
// it, or listens for onChange, and never has to ask the DOM what it decided.
var current = {};
// Instance node id -> the element wearing data-state, filled in by start().
var elements = {};

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// The whole machine, and the twin of stepMachine. Deliberately pure: it reads no
// current state and writes none, so a caller can ask "where would this go" of
// any state at all, which is what makes it comparable to the studio's answer.
function step(instance, from, trigger) {
  var at = instances[instance];
  if (at === undefined) return undefined;
  var machine = machines[at.machine];
  if (machine === undefined) return undefined;
  var row = machine.edges[from];
  if (row === undefined) return undefined;
  return row[trigger];
}

function state(instance) {
  return owns(current, instance) ? current[instance] : null;
}

// Commit a state. Anything that is not a state id is refused rather than
// written, because the one caller that can pass rubbish is start() reading an
// instance's stored initial out of a table somebody may have hand-edited, and a
// data-state of "undefined" matches no rule in the stylesheet and looks to the
// person reading it exactly like a machine that failed to move.
function set(instance, to) {
  if (typeof to !== "string") return null;
  current[instance] = to;
  var element = elements[instance];
  if (element) element.setAttribute("data-state", to);
  if (onChange) onChange(instance, to);
  return to;
}

// Feed a trigger in and follow the edge, if there is one. A trigger this state
// has no edge on is a no-op that returns null — not an error and not a throw,
// because the listeners are attached per *machine* and a machine that responds
// to click in one state and not another is the ordinary case, not a mistake. A
// self-edge is a move: it followed an edge, so it reports where it landed.
function fire(instance, trigger) {
  if (!owns(current, instance)) return null;
  var to = step(instance, current[instance], trigger);
  return to === undefined ? null : set(instance, to);
}

// The load trigger, followed at start until nothing more is waiting.
//
// A chain settles — load: a -> b, b -> c ends at c — because "settle into this
// state" is what a load edge is for and stopping one edge short would be an
// arbitrary place to stop. A cycle stops *before* going round again rather than
// after: the machine ends in the last state it had not already been in, which is
// the one place a reader can point at and say why it is there. A page that spins
// before it has painted is worse than a machine that stops somewhere legal, and
// neither mdeadend nor munreached is the check that would have caught this — a
// two-state load cycle is reachable, leaves both states, and is deterministic.
function settle(instance) {
  if (!owns(current, instance)) return;
  var at = current[instance];
  var seen = {};
  seen[at] = true;
  for (;;) {
    var to = step(instance, at, "load");
    if (to === undefined || owns(seen, to)) return;
    seen[to] = true;
    at = set(instance, to);
  }
}

// One listener, in its own function so the trigger it closes over is this one
// and not whatever the loop variable ended up being.
function listen(instance, trigger, element) {
  element.addEventListener(events[trigger], function () {
    fire(instance, trigger);
  });
}

// Every trigger any edge of this machine uses, so an instance gets listeners for
// what it can actually respond to and not for all eight.
function triggersOf(machine) {
  var used = {};
  for (var from in machine.edges) {
    if (!owns(machine.edges, from)) continue;
    var row = machine.edges[from];
    for (var trigger in row) {
      if (owns(row, trigger)) used[trigger] = true;
    }
  }
  return used;
}

// Find the elements by scanning for the attribute rather than by building an
// attribute-equals selector per instance. A node id is not guaranteed to be
// spellable inside a selector — a quote or a backslash in one would either throw
// or, worse, match something else — and a single pass over the document is
// cheaper than one query per instance anyway.
//
// The wording avoids spelling that selector out, and deliberately: this comment
// ships inside somebody's exported page, and a quoted data-node attribute in a
// comment is a string every grep over the output finds and every reader has to
// rule out by hand. Once was enough — it made a test that reads the file's own
// nodes back out believe the page drew an element called "...".
function bind() {
  if (!root || !root.querySelectorAll) return;
  var found = root.querySelectorAll("[data-node]");
  for (var i = 0; i < found.length; i++) {
    var id = found[i].getAttribute("data-node");
    if (id !== null && owns(instances, id)) elements[id] = found[i];
  }
}

// Put every instance in its starting state, listen for what can move it, then
// follow the load edges. In that order: an element has to be found before
// data-state can be written to it, and load edges are followed last so that a
// machine which settles on load reports the move through onChange like any other.
function start() {
  var id;
  bind();
  for (id in instances) {
    if (owns(instances, id)) set(id, instances[id].initial);
  }
  for (id in instances) {
    if (!owns(instances, id)) continue;
    var element = elements[id];
    var machine = machines[instances[id].machine];
    if (!element || !machine) continue;
    var used = triggersOf(machine);
    for (var trigger in used) {
      if (owns(used, trigger) && events[trigger]) listen(id, trigger, element);
    }
  }
  for (id in instances) {
    if (owns(instances, id)) settle(id);
  }
}

return {
  step: step,
  state: state,
  states: current,
  set: set,
  fire: fire,
  start: start
};`;

/**
 * The whole `<script>` body: the table, the event map, then the runtime.
 *
 * Wrapped in an immediately-invoked function so that a page carrying two
 * exported documents — or an exported document pasted into a page that already
 * has scripts — gains no globals at all. Nothing is hung off `window`: a host
 * that wants to drive the machine itself has the studio, and a name in the
 * global scope is a name that can be taken.
 *
 * `typeof document === "undefined" ? null : document` looks like paranoia in a
 * file that only ever ends up in a browser, and it is not: it is what lets the
 * emitted text be evaluated in Node by `runtime.test.ts` without a DOM shim, so
 * that "does the script somebody is about to ship even parse" is a question with
 * a cheap answer. A null root binds nothing and the runtime still runs.
 *
 * The `<` in the JSON is escaped because this string goes inside a `<script>`
 * element, where the parser ends the script at the first `</script` sequence
 * wherever it appears — including inside what JavaScript considers a string
 * literal. A node named `</script>` is not a thing anybody will type on purpose,
 * which is exactly the sort of thing that turns into a bug report years later.
 * `\\u003c` parses back to `<` under `JSON.parse`, so the table round-trips
 * unchanged.
 *
 * An empty table emits a script that binds nothing and does nothing. That is
 * deliberate rather than an oversight: deciding that a document with no
 * behaviour should carry *no script at all* belongs to `export.ts`, which is the
 * only place that knows whether every state collapsed to a pseudo-class — see
 * {@link MachineExport.runtime}, which is `string | null` for that reason.
 */
export function runtimeScript(table: MachineTable): string {
	const json = JSON.stringify(table).replace(/</g, "\\u003c");
	const events = JSON.stringify(TRIGGER_EVENTS);
	return [
		"(function(){",
		`var T = ${json};`,
		`var E = ${events};`,
		"var M = (function (T, E, root, onChange) {",
		MACHINE_RUNTIME,
		'})(T, E, typeof document === "undefined" ? null : document);',
		"M.start();",
		"})();",
	].join("\n");
}

/**
 * What the runtime hands back: the machine, as an object a host can drive.
 *
 * This is the shape {@link MACHINE_RUNTIME}'s last statement returns, written
 * down in TypeScript so that the one caller who evaluates the text — the test,
 * through {@link evalRuntime} — is checked against it rather than reaching into
 * an `any`. The methods take and return plain strings rather than `Trigger` and
 * a state id union, because by the time the text is running it is JavaScript in
 * somebody's page and the types are gone; pretending otherwise at this boundary
 * would be claiming a guarantee that ends one line earlier than it looks.
 */
export interface RuntimeHandle {
	/** The twin of {@link stepMachine}: where a trigger takes a state. */
	step: (instance: string, from: string, trigger: string) => string | undefined;
	/** The state an instance is in, or null before {@link start}. */
	state: (instance: string) => string | null;
	/** Instance -> current state. Read it; the runtime owns it. */
	states: Record<string, string>;
	/** Force a state, as a host driving playback does. */
	set: (instance: string, to: string) => string | null;
	/** Follow the edge this trigger names, or nothing. */
	fire: (instance: string, trigger: string) => string | null;
	/** Bind to the DOM, initialise every instance, follow the load edges. */
	start: () => void;
}

/**
 * The runtime, evaluated — the same text the export ships, as a callable thing.
 *
 * Here rather than in the test file because it is the one place the `new
 * Function` call is written down, and writing it twice is how a test ends up
 * proving something about a slightly different text than the one that ships. It
 * is handed exactly what the emitted script hands it, so the only difference
 * between calling this and loading the export in a browser is which `root` and
 * which table.
 *
 * `new Function` and not `eval`: the body is compiled in the global scope with
 * nothing of this module in view, which is the scope it gets inside a `<script>`
 * tag too. A closure over anything here would make the agreement test easier to
 * pass and the claim it makes false.
 *
 * The default `root` is null, which binds no elements — so a caller with no DOM
 * gets a runtime that still answers `step` and `fire` and simply never writes an
 * attribute. That is the mode the agreement with `stepMachine` is proved in, and
 * it is also what a host that re-renders rather than mutating wants: pass
 * `onChange` and ignore the DOM entirely.
 */
export function evalRuntime(
	table: MachineTable,
	root: unknown = null,
	onChange?: (instance: string, state: string) => void,
): RuntimeHandle {
	const factory = new Function(
		"T",
		"E",
		"root",
		"onChange",
		MACHINE_RUNTIME,
	) as (
		table: MachineTable,
		events: Record<string, string>,
		root: unknown,
		onChange: ((instance: string, state: string) => void) | undefined,
	) => RuntimeHandle;
	return factory(table, TRIGGER_EVENTS, root, onChange);
}
