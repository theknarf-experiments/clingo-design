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
 * becomes visible is CSS's business and is written down in CSS.
 *
 * **It reads a clock and never sets one**, and the difference is the whole of
 * what an exit time costs here. Rive's exit time defers a transition until the
 * time has elapsed; ours *gates* one — a trigger arriving too early is dropped
 * and not remembered (ladder spec §2.5). So the runtime records the moment of
 * each state change and subtracts, which is one call to `Date.now` and no queue.
 * A deferred fire would be a state change nobody's finger caused, arriving at a
 * moment nothing on the page marks, and a runtime with a queue in it is a second
 * animator arguing with the compositor. `setTimeout`, `setInterval` and
 * `requestAnimationFrame` therefore still do not appear in this text, and
 * `runtime.test.ts` asserts their absence and `Date.now`'s presence in the same
 * test, so that the distinction is the thing under guard rather than the word
 * "clock".
 *
 * **What is deliberately not here: timelines and blends.** A timeline is
 * `@keyframes` in the exported file and the compositor plays it; a blend is
 * arithmetic over a runtime value that CSS cannot mix, so the file carries one
 * stop and a `lost` entry says which (ladder spec §5.6, §9.1). Neither is in
 * {@link MachineTable} at all, so there is nothing here to sample: this runtime
 * switches classes, and `machines.ts`'s `sampleTimeline` and `blendWeights` —
 * which need the *document*, not the table — are what the studio canvas plays
 * with. See the note on {@link RuntimeHandle} for what that means for a host.
 *
 * **Why it is ES5 and why it is a factory.** No arrow functions, no `const`, no
 * `Object.entries` — this text is pasted into a file somebody may open in
 * whatever browser they have, and a syntax error in a `<script>` takes the
 * behaviour of the whole page with it rather than degrading. And the text is the
 * *body of a function* taking `(T, E, root, onChange, clock)` rather than a
 * self-starting block, for a reason that is entirely about being testable: a
 * self-starting block reaches for `document` on the first line, which means the
 * only way to check it is a browser, which means in practice nobody checks it.
 * As a factory it can be handed a null root and driven from Node, which is how
 * the agreement with `stepLayer` is proved at all. `clock` is the fifth
 * parameter and the emitted script passes it nothing, so a page gets `Date.now`;
 * a test gets a function it can wind forward, which is the only way an exit-time
 * gate is checkable at all without sleeping in a test suite.
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
 * `function (T, E, root, onChange, clock)`.
 *
 * `T` is a {@link MachineTable}, `E` is {@link TRIGGER_EVENTS}, `root` is a
 * `Document` or element to bind inside (null binds nothing, which is a runtime
 * that still answers questions but touches no DOM), `onChange` is an optional
 * `(instance, state, layer)` callback so a host that re-renders rather than
 * setting an attribute can hear about a move, and `clock` is an optional
 * `() => number` that stands in for `Date.now`. It returns a
 * {@link RuntimeHandle}.
 *
 * **Two step functions, because the table holds two answers.** `step` is the
 * shipped lookup and is *the same lookup* `stepMachine` is, down to returning
 * `undefined` in the same four places: an instance the table does not drive, a
 * machine the table has not got, a state with no outgoing edges, and a trigger
 * that state has no edge on. It reads `T.machines[m].edges`, the flat table —
 * no guards, no Any expansion, no exit gate, one destination — and it is kept
 * verbatim because that is the shape `machines.ts` still ships and the shape
 * `export.test.ts` asks about. `stepIn` is `stepLayer`'s twin and is what
 * actually drives the machine: per layer, a *list* of edges tried in the table's
 * own order, the first one the guard admits winning. When the shipped pair goes
 * from `machines.ts`, `step` goes from here with it and nothing else moves.
 *
 * **The three answers `stepIn` gives are three on purpose**, exactly as
 * `stepLayer`'s are: `undefined` is "nothing moved" (no edge, or every edge
 * refused), `null` is "the layer stopped" — an `exit` destination, which keeps
 * whatever state the layer was last in and stops answering — and a string is
 * where it went. A runtime that conflated the first two would keep listening to
 * a machine that has said it is finished; one that conflated `null` with a state
 * id would write `data-state="exit"`, which matches no rule in the stylesheet
 * and looks to a person exactly like a machine that failed.
 *
 * **`allows` mirrors `edgeAllows` line for line**, and the mirroring is the
 * reason `edgeAllows` is a named function over there rather than four lines
 * inlined twice. The one place this text is *more* careful than its twin is that
 * it looks a stored input up through `owns` rather than by plain index: the
 * store is a bare object literal in somebody's page and an input called
 * `constructor` would otherwise read back as a function. Both readers answer
 * "no" for that input, so it is a difference in how, not in what.
 *
 * There is no wildcard from-state. A `"*"` in an edge table is looked up as a
 * state literally called `"*"`, which is a state no document can spell — a state
 * id must be a bare ASP constant. That is not an oversight and it is not a
 * feature waiting to be added here: neither `stepMachine` nor `stepLayer` has a
 * wildcard, and a wildcard that only this text understood would be the drift
 * this whole file exists to prevent. An Any edge is the thing that was wanted,
 * and `machineTable` expands it into every state's row of its own layer, in the
 * table, for both readers at once.
 */
export const MACHINE_RUNTIME = `"use strict";
// Everything the table says, with the two shapes the interpreter needs already
// pulled out, so a malformed table is an inert runtime rather than a throw on
// line one of somebody's page.
var instances = T && T.instances ? T.instances : {};
var machines = T && T.machines ? T.machines : {};
var events = E || {};
// The clock, read and never set. A page gets the wall clock below, because the
// emitted script passes no fifth argument; a test passes a function it can wind
// forward, which is the only way to check an exit-time gate without sleeping.
// One reading of the wall clock, in one place, on purpose: a second one
// somewhere else is how a "held for" quietly turns into a "wait for".
var readClock = clock || function () { return Date.now(); };
// Instance node id -> layer id -> the state that layer is in right now. Nested
// rather than flat because an instance is in one state *per layer*, all at once,
// which is the whole of layers in one sentence — and a single string per
// instance is exactly what cannot say it. This is what "reports the current
// state" means: a host reads it, or listens for onChange, and never has to ask
// the DOM what it decided.
var current = {};
// Instance node id -> the state its *first* layer is in: the flat record that
// shipped before layers existed, kept live beside the nested one above.
//
// Two records for one fact, which is normally the thing this file argues hardest
// against, and the reason it is right here is that they are not one fact: this is
// the answer to "what does data-state say", which is what a page that was
// exported before layers existed reads out of M.states, and the nested record is
// the answer to "where is every layer". Deriving this one on read would mean
// M.states becoming a function call, and a property that turns into a method is
// exactly the silent break the pair exists to avoid. It is written in one place —
// setIn — so it cannot fall behind.
var shown = {};
// Instance -> layer -> true, once that layer has taken an edge into Exit. A
// stopped layer keeps its state and its classes and stops answering triggers.
var halted = {};
// Instance -> layer -> the clock reading at that layer's last state change. The
// whole of the exit-time gate: a difference, never a schedule.
var heldAt = {};
// Instance -> input id -> boolean or number, in the units the table states:
// true/false for a boolean, thousandths for a number. Per instance and not per
// machine, because two buttons made from one definition have two hover
// progresses and always did. Triggers are not in here at all — a trigger is a
// moment, not a value, so it is handed to one evaluation and thrown away.
var values = {};
// Instance node id -> the element wearing the state attributes, filled by start().
var elements = {};

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function machineOf(instance) {
  if (!owns(instances, instance)) return undefined;
  return machines[instances[instance].machine];
}

// The layers of the machine driving this instance, in order. A table with no
// layers in it drives nothing through here, and that is deliberate rather than a
// gap to patch: stepLayer says the same, and synthesising a layer out of the flat
// edge table would be a second reading of the table living in one of its two
// readers, which is the drift this file exists to prevent. Every table
// machineTable builds has them.
function layersOf(instance) {
  var machine = machineOf(instance);
  return machine && machine.layers ? machine.layers : [];
}

function layerAt(instance, layer) {
  var list = layersOf(instance);
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === layer) return list[i];
  }
  return undefined;
}

// The first layer is the one that writes plain data-state, so a one-layer file is
// byte-identical to the one that shipped before layers existed. Every further
// layer writes its own attribute; see attributeOf.
function firstLayer(instance) {
  var list = layersOf(instance);
  return list.length > 0 ? list[0].id : undefined;
}

function attributeOf(instance, layer) {
  return layer === firstLayer(instance) ? "data-state" : "data-state-" + layer;
}

// The shipped lookup, kept: the flat edge table, one destination, no guards and
// no exit gate. The twin of stepMachine, and it goes when that one does.
// Deliberately pure: it reads no current state and writes none, so a caller can
// ask "where would this go" of any state at all, which is what makes it
// comparable to the studio's answer.
function step(instance, from, trigger) {
  var at = instances[instance];
  if (at === undefined) return undefined;
  var machine = machines[at.machine];
  if (machine === undefined) return undefined;
  var row = machine.edges[from];
  if (row === undefined) return undefined;
  return row[trigger];
}

// Whether one edge may be taken right now — edgeAllows, line for line.
//
// The exit gate is held < exit, strictly, so an edge with a 300ms exit time fires
// *at* 300ms. An input the host has not set fails every condition about it except
// fired, and that is a decision rather than a fallthrough: the store is seeded
// from every declared initial, so a missing entry means the input is not one of
// this machine's at all, and answering "true" would let a typo open an edge.
function allows(edge, inputs, fired, heldMs) {
  if (edge.exit !== undefined && heldMs < edge.exit) return false;
  var when = edge.when || [];
  for (var i = 0; i < when.length; i++) {
    var condition = when[i];
    if (condition.op === "fired") {
      if (!fired || indexOf(fired, condition.input) < 0) return false;
      continue;
    }
    var have = inputs && owns(inputs, condition.input) ? inputs[condition.input] : undefined;
    if (have === undefined) return false;
    var want = condition.value;
    if (typeof have === "boolean" || typeof want === "boolean") {
      // A boolean answers eq and ne and nothing else, and an operator its kind
      // does not take is refused rather than read as one of the two. The table
      // never carries such an edge, so this is the second of two answers to one
      // question, and the two agreeing is what keeps a hand-written table in a
      // fixture from behaving differently from a generated one.
      if (typeof have !== "boolean" || typeof want !== "boolean") return false;
      if (condition.op !== "eq" && condition.op !== "ne") return false;
      if (condition.op === "eq" ? have !== want : have === want) return false;
      continue;
    }
    if (want === undefined) return false;
    var ok = condition.op === "eq" ? have === want
      : condition.op === "ne" ? have !== want
      : condition.op === "gt" ? have > want
      : condition.op === "lt" ? have < want
      : condition.op === "ge" ? have >= want
      : have <= want;
    if (!ok) return false;
  }
  return true;
}

// Array.prototype.indexOf is ES5 and would do, but the fired set arrives from
// whatever a host passed and a host may pass anything iterable-looking. A loop
// over a length is what every shape of it has in common.
function indexOf(list, id) {
  if (!list) return -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i] === id) return i;
  }
  return -1;
}

// Where one trigger takes one layer — stepLayer's twin, and the lookup that
// actually drives the machine. The edges are tried in the order the table holds
// them, specific before Any, document order within each, and the first one the
// guard admits wins. That precedence lives in the table rather than here, so that
// the studio, which reads the same list, cannot order it differently.
function stepIn(instance, layer, from, trigger, inputs, fired, heldMs) {
  if (!owns(instances, instance)) return undefined;
  var row = layerAt(instance, layer);
  if (row === undefined) return undefined;
  // The edge table is tested for before it is read, which stepLayer does not do,
  // and the asymmetry is the same one the header draws about owns: over there the
  // table is a MachineTable a compiler has already checked, and RuntimeLayer.edges
  // is a required field, so a layer without one cannot exist. In here the table is
  // JSON out of a script tag in somebody's page and nothing checked it at all —
  // and hasOwnProperty called on nothing throws, which would take the behaviour of
  // the whole page with it rather than leaving one machine inert. A layer with no
  // edges moves nowhere, which is what a layer with an empty edge table does too,
  // so the two readers still agree about every table either of them can be given.
  var out = row.edges && owns(row.edges, from) ? row.edges[from] : undefined;
  var list = out && owns(out, trigger) ? out[trigger] : undefined;
  if (!list) return undefined;
  var ms = heldMs === undefined ? Infinity : heldMs;
  for (var i = 0; i < list.length; i++) {
    if (allows(list[i], inputs, fired, ms)) return list[i].to;
  }
  return undefined;
}

function stateIn(instance, layer) {
  var at = owns(current, instance) ? current[instance] : undefined;
  return at && owns(at, layer) ? at[layer] : null;
}

function state(instance) {
  var first = firstLayer(instance);
  return first === undefined ? null : stateIn(instance, first);
}

function stopped(instance, layer) {
  return owns(halted, instance) && halted[instance][layer] === true;
}

// How long the layer has been where it is. No record means the layer has not
// started, and Infinity is what "held forever" is called: it opens every gate,
// which is edgeAllows' own default and the answer that makes an unguarded
// document behave as if exit times did not exist.
function elapsed(instance, layer) {
  if (!owns(heldAt, instance) || !owns(heldAt[instance], layer)) return Infinity;
  return readClock() - heldAt[instance][layer];
}

// Commit a state to one layer. Anything that is not a state id is refused rather
// than written, because two callers can pass rubbish: start(), reading an
// instance's stored initial out of a table somebody may have hand-edited, and a
// layer with no states at all, whose initial the table spells as the empty
// string. A data-state of "undefined" or of "" matches no rule in the stylesheet
// and looks to the person reading it exactly like a machine that failed to move.
function setIn(instance, layer, to) {
  if (typeof to !== "string" || to === "") return null;
  var at = owns(current, instance) ? current[instance] : (current[instance] = {});
  at[layer] = to;
  var when = owns(heldAt, instance) ? heldAt[instance] : (heldAt[instance] = {});
  when[layer] = readClock();
  // The flat mirror, written here and nowhere else. Only the first layer, because
  // only the first layer writes data-state and M.states has always been the twin
  // of that attribute.
  if (layer === firstLayer(instance)) shown[instance] = to;
  var element = elements[instance];
  if (element) element.setAttribute(attributeOf(instance, layer), to);
  if (onChange) onChange(instance, to, layer);
  return to;
}

// The shipped set, and it means the first layer — which is what every host that
// has one today is asking about.
function set(instance, to) {
  var first = firstLayer(instance);
  return first === undefined ? null : setIn(instance, first, to);
}

function stop(instance, layer) {
  var at = owns(halted, instance) ? halted[instance] : (halted[instance] = {});
  at[layer] = true;
}

// Feed a trigger in and let every layer answer it — stepInstance's twin.
//
// Layers are stepped independently and all at once, which is what a layer is: one
// click may move the press layer and leave the glow layer where it was, and both
// answers are true in the same moment. Nothing is stepped twice and no layer sees
// another's new state, so the order of the walk cannot change the answer.
//
// A trigger no layer has an edge on is a no-op that returns null — not an error
// and not a throw, because the listeners are attached per machine and a machine
// that responds to click in one state and not another is the ordinary case rather
// than a mistake. Where something did move, what comes back is a record of every
// layer that was asked: where it ended up, or null where it stopped. One string
// cannot say that any more, which is the same reason the table's per-instance
// initial had to become a record.
//
// A stopped layer is left out of the walk entirely rather than asked and refused,
// which is exactly how stepInstance says it: a layer the caller says nothing
// about is not in the current record, and a stepper that filled one in would be a
// stepper that could move a layer the caller had deliberately stopped.
//
// Named fireIn and not fire, and the pair below it is the reason: step/stepIn,
// state/stateIn and set/setIn are already three pairs where the bare name means
// the first layer and the -In name takes a layer, and a fire that quietly changed
// what it returned would have been the one member of the family that broke a page
// instead of extending it.
function fireIn(instance, trigger, fired) {
  var at = owns(current, instance) ? current[instance] : undefined;
  if (!at) return null;
  var list = layersOf(instance);
  var out = {};
  var moved = false;
  for (var i = 0; i < list.length; i++) {
    var layer = list[i].id;
    if (!owns(at, layer) || stopped(instance, layer)) continue;
    var to = stepIn(
      instance,
      layer,
      at[layer],
      trigger,
      values[instance],
      fired,
      elapsed(instance, layer)
    );
    if (to === undefined) {
      out[layer] = at[layer];
      continue;
    }
    moved = true;
    if (to === null) {
      stop(instance, layer);
      out[layer] = null;
      continue;
    }
    out[layer] = setIn(instance, layer, to);
  }
  return moved ? out : null;
}

// The shipped fire, and it means the first layer — the state data-state now
// carries, or null where nothing moved.
//
// **This is a compatibility promise and not a convenience.** An exported page is
// a file somebody keeps: a host that wrote  if (M.fire("btn","click") === "hover")
// against the runtime that shipped before layers existed must keep getting a
// string out of it, because an object is always truthy and === against a string
// never matches again — a silently wrong answer the moment the document is
// re-exported, with nothing on screen to show for it. So the layered answer took
// the new name and this one kept its meaning, exactly as set/setIn did.
//
// On a one-layer document the two are the same answer read two ways, which is
// every document that could have a host written against the old shape. Where a
// later layer moved and the first did not, this returns null: nothing the first
// layer — and therefore nothing data-state — has to say changed, which is what
// the shipped function meant by null. A host that wants the whole answer asks
// fireIn, and the lost list in export.ts names it.
function fire(instance, trigger, fired) {
  var first = firstLayer(instance);
  var at = owns(current, instance) ? current[instance] : undefined;
  // Asked before the fire and asked purely, because fireIn reports a layer that
  // did not move as sitting where it already was, and a self-edge reports the
  // same thing. stepIn writes nothing, so this is the question "would the first
  // layer take an edge" answered against the state and the clock the fire is
  // about to use — not the ones it leaves behind.
  var took =
    at === undefined || first === undefined || !owns(at, first) || stopped(instance, first)
      ? undefined
      : stepIn(instance, first, at[first], trigger, values[instance], fired, elapsed(instance, first));
  var out = fireIn(instance, trigger, fired);
  if (took === undefined || took === null) return null;
  return out && first !== undefined && owns(out, first) ? out[first] : null;
}

// The load trigger, followed per layer at start until nothing more is waiting.
//
// A chain settles — load: a -> b, b -> c ends at c — because "settle into this
// state" is what a load edge is for and stopping one edge short would be an
// arbitrary place to stop. A cycle stops *before* going round again rather than
// after: the layer ends in the last state it had not already been in, which is
// the one place a reader can point at and say why it is there. A page that spins
// before it has painted is worse than a machine that stops somewhere legal, and
// neither mdeadend nor munreached is the check that would have caught this — a
// two-state load cycle is reachable, leaves both states, and is deterministic.
//
// Settling leaves each layer at a load fixpoint, which is what makes this the
// right thing for fireInput to call as well: nothing here can move again unless a
// guard that was false has become true.
function settle(instance, fired) {
  var at = owns(current, instance) ? current[instance] : undefined;
  if (!at) return null;
  var list = layersOf(instance);
  var out = null;
  for (var i = 0; i < list.length; i++) {
    var layer = list[i].id;
    if (!owns(at, layer)) continue;
    var seen = {};
    seen[at[layer]] = true;
    for (;;) {
      if (stopped(instance, layer)) break;
      var to = stepIn(
        instance,
        layer,
        at[layer],
        "load",
        values[instance],
        fired,
        elapsed(instance, layer)
      );
      if (to === undefined) break;
      if (to !== null && owns(seen, to)) break;
      if (out === null) out = {};
      if (to === null) {
        stop(instance, layer);
        out[layer] = null;
        break;
      }
      seen[to] = true;
      setIn(instance, layer, to);
      out[layer] = to;
    }
  }
  return out;
}

function declaredInput(instance, id) {
  var machine = machineOf(instance);
  var declared = machine && machine.inputs ? machine.inputs : {};
  return owns(declared, id) ? declared[id] : undefined;
}

// Clamped to the declared range, where the document declared one. Absent is open
// rather than zero: a designer who has not said how far the drawer opens has not
// said that it does not open at all.
function clamp(spec, value) {
  var out = value;
  if (spec.min !== undefined && out < spec.min) out = spec.min;
  if (spec.max !== undefined && out > spec.max) out = spec.max;
  return out;
}

// Set a persistent input. Refused, rather than coerced, where the machine has no
// such input, where the kind does not match what was handed in, where the input
// is a trigger (a moment is fired, not set), or where the number is not one —
// NaN would sit in the store failing every comparison in silence, which reads as
// a machine that has stopped responding.
//
// The value handed in is clamped; the value seeded from the table is not. That
// asymmetry is deliberate: the seed is what the *document* says the input starts
// at, and a document whose initial sits outside its own declared range is a thing
// the checks report and a person fixes, not a thing this text should quietly
// rewrite so that nobody ever sees it.
function setInput(instance, id, value) {
  var spec = declaredInput(instance, id);
  if (spec === undefined || spec.kind === "trigger") return null;
  if (spec.kind === "boolean") {
    if (typeof value !== "boolean") return null;
  } else {
    if (typeof value !== "number" || value !== value) return null;
    value = clamp(spec, value);
  }
  var store = owns(values, instance) ? values[instance] : (values[instance] = {});
  store[id] = value;
  return value;
}

// Fire a momentary one, and let the machine answer it now.
//
// The trigger is true for this one evaluation and gone, which is what a trigger
// is: a store that kept one true would fire every guarded edge on the next
// unrelated event, and a runtime that armed one until the next click would do the
// same thing one event later. So the evaluation happens here, on the load
// trigger, and the fired set is thrown away with the call.
//
// load rather than an invented event, because load is the trigger with no event —
// the one a machine already uses to say "settle into this state" rather than
// "wait to be poked", and a host-fired input is precisely something that happened
// which no pointer on this element marks. Settling is a fixpoint, so on a machine
// with no guarded load edge this moves nothing at all; a guarded one is exactly
// how a designer writes "when the save succeeds, move".
function fireInput(instance, id) {
  var spec = declaredInput(instance, id);
  if (spec === undefined || spec.kind !== "trigger") return null;
  return settle(instance, [id]);
}

// Seed the store from what the document says each input starts at. A trigger is
// not in it, and an input the table gives no initial is not in it either: absent
// means the host has not been told a value, and every guard about it refuses.
function seed(instance) {
  var machine = machineOf(instance);
  var declared = machine && machine.inputs ? machine.inputs : {};
  var store = values[instance] = {};
  for (var id in declared) {
    if (!owns(declared, id)) continue;
    var spec = declared[id];
    if (!spec || spec.kind === "trigger" || spec.initial === undefined) continue;
    store[id] = spec.initial;
  }
}

// Put every layer of one instance where the document drew it. The record wins
// over the single string, so a multi-layer document says the whole answer in one
// place, and the string is still what a one-layer document means.
function begin(instance) {
  var at = instances[instance];
  var start = at.layerStart || {};
  var list = layersOf(instance);
  for (var i = 0; i < list.length; i++) {
    var layer = list[i];
    var to = owns(start, layer.id) ? start[layer.id]
      : i === 0 && typeof at.initial === "string" ? at.initial
      : layer.initial;
    setIn(instance, layer.id, to);
  }
}

// One listener, in its own function so the trigger it closes over is this one
// and not whatever the loop variable ended up being.
function listen(instance, trigger, element) {
  element.addEventListener(events[trigger], function () {
    // fireIn, because the page wants every layer moved and not the first layer's
    // answer. fire is the reporting shape a host calls; this is the machine
    // running, and running only the first layer would be a click that pressed a
    // button and did not light it.
    fireIn(instance, trigger);
  });
}

// Every trigger any edge of any layer of this machine uses, so an instance gets
// listeners for what it can actually respond to and not for all eight.
function triggersOf(machine) {
  var used = {};
  var layers = machine.layers || [];
  for (var i = 0; i < layers.length; i++) {
    var edges = layers[i].edges;
    for (var from in edges) {
      if (!owns(edges, from)) continue;
      var row = edges[from];
      for (var trigger in row) {
        if (owns(row, trigger)) used[trigger] = true;
      }
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

// Seed the inputs, put every instance in its starting states, listen for what can
// move it, then follow the load edges. In that order: an input has to hold its
// initial before a load guard is asked about it, an element has to be found
// before an attribute can be written to it, and load edges are followed last so
// that a machine which settles on load reports the move through onChange like any
// other.
function start() {
  var id;
  bind();
  for (id in instances) {
    if (!owns(instances, id)) continue;
    seed(id);
    begin(id);
  }
  for (id in instances) {
    if (!owns(instances, id)) continue;
    var element = elements[id];
    var machine = machineOf(id);
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
  stepIn: stepIn,
  state: state,
  stateIn: stateIn,
  // The flat record shipped and keeps its shape and its name; the nested one is
  // beside it under the -In name the rest of this object already uses. A page
  // exported before layers existed reads M.states[id] and gets a string, as it
  // always did.
  states: shown,
  statesIn: current,
  set: set,
  setIn: setIn,
  fire: fire,
  fireIn: fireIn,
  setInput: setInput,
  fireInput: fireInput,
  inputs: values,
  stopped: stopped,
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
 * The factory takes five arguments and this call passes three, which is not an
 * omission: a page wants the real `Date.now` and the real absence of an
 * `onChange`, and spelling either of them out here would be putting a default in
 * two places. The fifth exists so a test can wind the clock forward, which is the
 * only way an exit-time gate is checkable without sleeping in a test suite.
 *
 * An empty table emits a script that binds nothing and does nothing. That is
 * deliberate rather than an oversight: deciding that a document with no
 * behaviour should carry *no script at all* belongs to `export.ts`, which is the
 * only place that knows whether every state collapsed to a pseudo-class — see
 * {@link MachineExport.runtime}, which is `string | null` for that reason.
 *
 * ## What every exported page now pays, and why it is one interpreter
 *
 * **An amendment to the no-regression promise, in writing, because it is a real
 * cost and not naming it would be the dishonest half of shipping it.** Layers,
 * inputs, guards and exit gates roughly doubled this text: a one-layer,
 * no-input, no-guard document's exported HTML grew from about 12 kB to about 27
 * kB, and every byte of the growth is interpreter it does not use. Nothing about
 * what that document *does* changed — the DOM behaviour is identical, which is
 * what the compatibility pair on {@link RuntimeHandle} is about — but a simple
 * page carries the whole ladder.
 *
 * The obvious remedy is conditional emission: ship a small runtime when the
 * table has one layer, no inputs, no guards and no exit times, and the big one
 * otherwise. **It is refused, and the reason is this file's opening argument.**
 * Two texts is two interpreters, and two interpreters is a thing that can
 * disagree — "what does clicking this button do" would get a different answer
 * depending on whether some other part of the document happened to grow a
 * second layer, and `runtime.test.ts`'s agreement matrix would be checking one
 * of them. Every failure mode this module was shaped to prevent comes back at
 * exactly the moment a document gets interesting.
 *
 * The cheap half of the cost is separable and is *also* refused, for a smaller
 * reason: about 15 kB of the 25 kB is this interpreter's own comments, and a
 * `runtimeScript` that stripped them would halve the payload with no behaviour
 * change at all. What it would cost is that `evalRuntime` tests
 * {@link MACHINE_RUNTIME} and the page would run something else — a test proving
 * something about a slightly different text than the one that ships, which is
 * the failure {@link evalRuntime} exists to close. If that trade is ever worth
 * making, the way to make it is to strip once, in a function both this and
 * `evalRuntime` call, and to move the fixture in the same commit that does it.
 *
 * **This function is why an edit to {@link MACHINE_RUNTIME} moves a fixture in
 * another file, and the fact is written down here because the file it moves does
 * not know about this one.** `spatialprogram.goldens.json` holds a digest of each
 * template's exported HTML, and the `machine` template's HTML contains this
 * script, which contains that text *verbatim* — so every character added to the
 * runtime changes a hash in a no-regression fixture, including the characters in
 * its comments. That is a real consequence rather than a regression, and the two
 * are told apart by a rule with a proof attached: when the runtime is rolled back
 * to its previous text, the exported HTML must hash to exactly what the fixture
 * already held, for every universe. If it does not, something *other* than this
 * script moved and the fixture is reporting a genuine change to the document.
 * Regenerating it on any weaker ground than that is indistinguishable from
 * deleting the test.
 *
 * The neighbouring fields the fixture keeps — the node set, the frames, the
 * rendered props, and the SVG, which carries no script at all — are the reason
 * this is checkable rather than a matter of assertion: they are the whole of what
 * the document *is*, they are computed from the same universes, and they do not
 * move when this text does.
 */
export function runtimeScript(table: MachineTable): string {
	const json = JSON.stringify(table).replace(/</g, "\\u003c");
	const events = JSON.stringify(TRIGGER_EVENTS);
	return [
		"(function(){",
		`var T = ${json};`,
		`var E = ${events};`,
		"var M = (function (T, E, root, onChange, clock) {",
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
 *
 * **There is nothing here about timelines or blends, and there is not going to
 * be.** A timeline is `@keyframes` in the exported file and the compositor plays
 * it once this handle switches the attribute; a blend is arithmetic over a
 * runtime value that CSS cannot mix, so the file carries one stop and says so in
 * a `lost` entry. Neither is in {@link MachineTable}, so this interpreter has
 * nothing to sample and would have to be handed the *document* to do it — which
 * is `machines.ts`'s `sampleTimeline` and `blendWeights`, which the studio canvas
 * calls with the answer set it already has. A second sampler in here, reading a
 * second copy of the keyframes shipped in the script tag, would be exactly the
 * two-implementations-that-drift problem this whole file exists to prevent.
 */
export interface RuntimeHandle {
	/**
	 * The shipped lookup, and the twin of {@link stepMachine}: the flat edge
	 * table, one destination, no guards and no exit gate. Kept while that function
	 * is, and it goes when it goes.
	 */
	step: (instance: string, from: string, trigger: string) => string | undefined;
	/**
	 * The twin of `stepLayer`, and what actually drives the machine: where one
	 * trigger takes one layer, under the guards and the exit gate.
	 *
	 * `undefined` is "nothing moved", `null` is "the layer stopped", a string is
	 * where it went. `heldMs` left out means held forever, which opens every gate.
	 */
	stepIn: (
		instance: string,
		layer: string,
		from: string,
		trigger: string,
		inputs?: Record<string, boolean | number>,
		fired?: readonly string[],
		heldMs?: number,
	) => string | null | undefined;
	/** The state an instance's **first** layer is in, or null before {@link start}. */
	state: (instance: string) => string | null;
	/** The state one named layer is in, or null. */
	stateIn: (instance: string, layer: string) => string | null;
	/**
	 * Instance -> the state its **first** layer is in. Read it; the runtime owns
	 * it.
	 *
	 * **Flat, and it stays flat.** This is the twin of the `data-state` attribute
	 * and it is what shipped before layers existed, so a host that was written
	 * against an earlier export and reads `M.states[id]` keeps getting a string
	 * out of it. Widening it in place would have been a silent break of every such
	 * page the moment somebody re-exported: an object is truthy, `===` against a
	 * state id stops matching, and nothing on screen says why. See
	 * {@link statesIn} for the whole answer.
	 */
	states: Record<string, string>;
	/**
	 * Instance -> layer -> current state. Read it; the runtime owns it.
	 *
	 * The whole answer, under the `-In` name the rest of this handle already uses
	 * for the per-layer half of a pair. An instance is in one state per layer all
	 * at once and a string cannot say that. A stopped layer is still in here,
	 * wearing the state it stopped in — which is what "a stopped layer keeps
	 * whatever state it was last in" means.
	 */
	statesIn: Record<string, Record<string, string>>;
	/** Force the **first** layer's state, as a host driving playback does. */
	set: (instance: string, to: string) => string | null;
	/** Force one named layer's state. */
	setIn: (instance: string, layer: string, to: string) => string | null;
	/**
	 * Feed a trigger in and report what the **first** layer did: where it went, or
	 * null where it took no edge.
	 *
	 * Every layer is still moved — this is a reporting shape, not a narrower fire
	 * — and {@link fireIn} is the one that says what all of them did. The split is
	 * a compatibility promise: the shipped `fire` returned `string | null`, so a
	 * page holding `if (M.fire("btn","click") === "hover")` must keep working
	 * across a re-export, and the layered answer takes the new name exactly as
	 * `setIn` took it from `set`.
	 */
	fire: (
		instance: string,
		trigger: string,
		fired?: readonly string[],
	) => string | null;
	/**
	 * Let every layer answer this trigger — the twin of `stepInstance`.
	 *
	 * Null where nothing moved anywhere. Otherwise a record of every layer that
	 * was asked: where it ended up, or null where it stopped. `fired` is the
	 * momentary inputs true for this one evaluation.
	 */
	fireIn: (
		instance: string,
		trigger: string,
		fired?: readonly string[],
	) => Record<string, string | null> | null;
	/** Set a persistent input; null where the machine has no such input to set. */
	setInput: (
		instance: string,
		input: string,
		value: boolean | number,
	) => boolean | number | null;
	/**
	 * Fire a momentary one, and settle. Null where the machine has no such
	 * trigger; otherwise what settling moved, in `fire`'s shape.
	 */
	fireInput: (instance: string, input: string) => Record<string, string | null> | null;
	/** Instance -> input id -> what it holds. Read it; the runtime owns it. */
	inputs: Record<string, Record<string, boolean | number>>;
	/** Whether that layer has taken an edge into Exit and stopped answering. */
	stopped: (instance: string, layer: string) => boolean;
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
 * attribute. That is the mode the agreement with `stepLayer` is proved in, and it
 * is also what a host that re-renders rather than mutating wants: pass `onChange`
 * and ignore the DOM entirely.
 *
 * `clock` is the one argument the emitted script does *not* pass, so a page gets
 * `Date.now` and a test gets a number it decides. It is the whole of what makes
 * the exit-time gate testable: the alternative is a test that sleeps, which is a
 * test that is slow when it passes and flaky when it fails.
 */
export function evalRuntime(
	table: MachineTable,
	root: unknown = null,
	onChange?: (instance: string, state: string, layer: string) => void,
	clock?: () => number,
): RuntimeHandle {
	const factory = new Function(
		"T",
		"E",
		"root",
		"onChange",
		"clock",
		MACHINE_RUNTIME,
	) as (
		table: MachineTable,
		events: Record<string, string>,
		root: unknown,
		onChange: ((instance: string, state: string, layer: string) => void) | undefined,
		clock: (() => number) | undefined,
	) => RuntimeHandle;
	return factory(table, TRIGGER_EVENTS, root, onChange, clock);
}
