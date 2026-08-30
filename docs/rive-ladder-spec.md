# The rest of the Rive ladder: inputs, conditions, default states, layers, timelines

> **AMENDED — read `docs/merged-plan.md` first.** This document was written in
> parallel with `docs/three-d-spec.md` by an agent who could not see it, and the
> two claim nine of the same files. `docs/merged-plan.md` is the reconciled plan
> and **it outranks this document** wherever the two differ: the file ownership
> table in §12 below is superseded by its §3.3, and five paragraphs here are
> wrong and are marked `**AMENDED**` in place. Everything not so marked stands,
> including every argument in §0.
>
> The corrections, in one list: §3.3 (`many/2` is renamed `manyfrom/2`), §4.5
> (the narrowed alias needs `mlfshadow` to iterate the *widened* dimension list,
> and a third alias for rotation), §5.2 (`Track.dim` widens to `Axis3` and gains
> `Track.turn`), §6.2 (`ModelKeyframe` gains `spatial` and `turn`), §8.2 (three
> projections are missing, and one of them is a shipped bug this rung inherits),
> §12 (`permilleOf` is not a fifth quantity, and ownership).

**Status: frozen.** This document is the contract for the five rungs above what
shipped in `35e8d94` and `05119e6`. It **extends a working design** — it does not
replace one. Where a paragraph here contradicts `docs/state-machines-spec.md`,
this one wins and says so out loud in the paragraph itself; everywhere else that
document is still the law, and its §0 invariant governs every line below.

Every type, predicate, prop and file boundary here is the contract. Where an
implementation step finds this document wrong, it implements the nearest correct
thing *and says so in its return value* — it does not quietly redesign an
interface another step is coding against.

---

## 0. The invariant, restated for five new kinds of thing

> **Nothing on this ladder is ever an `alt/2` alternative and nothing gets a
> `pick/2`.** Not a state, not an input, not a layer, not a timeline, not a
> blend state. Adding any of them to a document must leave its universe count
> exactly where it was.

The shipped feature earned that sentence for states, by making a state a *copy*
rather than a choice. Each new rung has to earn it again, and each earns it a
different way, so it is worth writing the five arguments down before the types:

- **An input earns it by being invisible to the picture.** No atom that is
  `#project`ed depends on an input's value. `shown/2` is a fact the compiler
  emits from the document, so which state an instance is *drawn* in never
  consults an input; an input's whole effect is on which transitions the
  *runtime* may take, and on the derived health predicates, which are shown and
  never projected. Two universes that differed only in an input would be
  pixel-identical and would collapse — so an input must not be a variable at
  all. §1.4 makes that a rule rather than an observation.
- **A condition earns it by being read at grounding.** Every comparison in this
  document is decided over *constants*: the range the input declares, and the
  literal the condition names. No condition is ever evaluated against a runtime
  value inside the program. What the program computes is which guards are
  **possible**, which is a claim about the document.
- **A default state earns it by being sugar.** `entry`, `exit` and `any` add
  three reserved *ids*, three facts and four rules. They add no states, no
  copies and no variables.
- **A layer earns it by composing rather than choosing.** Two layers are two
  `shown/2` facts, not a choice between them, and the composition rule is
  deterministic (§4.4). This is the rung where the shipped encoding pays for
  itself: had a state been a choice rule, two layers would have been a *product*
  of universes, and the thing a designer wanted — both layers running at once —
  would have been the one thing the encoding could not express.
- **A timeline earns it by being keyframes.** The solver decides a keyframe's
  time and a keyframe's value, both of which are ordinary `Value`s and branch
  only where a designer wrote alternatives. It never decides a *frame*. There is
  no frame rate anywhere in this document, in the program, or in the export.

**Acceptance test for this section** (step L4 owns it, and it is the first test
any reviewer should run): take a document with a one-state machine and count its
universes with `explore`. Add three inputs, six conditions, an Entry edge, an Any
edge, an Exit edge, a second layer with four states of its own, a timeline with
nine keyframes and a 1D blend state. The count must not move.

---

## 1. Rung one: inputs

### 1.1 What an input is, and what it is emphatically not

An input is a **runtime value**: a boolean, a number or a momentary trigger,
belonging to a machine, that a host — a browser, or the studio's preview — sets
from outside. It is what makes `hover` a state you can drive from a checkbox
rather than only from a pointer.

It is not a design-space value, and the distinction is the whole rung. A
`duration` on a transition *is* a design-space value: it may name a token, the
token may hold two alternatives, and the two really are two designs, because the
milliseconds show up in the exported file and a reader can tell them apart. An
input has no such shadow. Nothing in the picture, in the base layer of the
export, or in any projected atom moves when an input moves. A document that held
two starting values for a boolean input would hold two universes that are
identical in every projected atom, which is exactly the collapse `#project`
exists to prevent — and here the honest answer is not to add a projection but to
notice there is nothing to project.

So: **an input's declaration reaches the program as facts, never as a
`mval`-shaped variable, and `emitValue` is never called for one.** A reviewer
checking this rung checks that first and stops if it fails.

### 1.2 The types — `packages/design-core/src/scene.ts`

Placed in the **State machines** section, immediately after `MOTION_PROP_NAMES`
and before `StatePart`.

```ts
/**
 * The three kinds of thing a host can hand a machine.
 *
 * Rive's three, and the same three for the same reason rather than out of
 * imitation: a boolean is a condition that persists ("is this row selected"), a
 * number is a quantity a guard can compare and a blend can interpolate along
 * ("how far is the drawer open"), and a trigger is a moment that does not
 * persist ("the save succeeded"). A fourth kind — a string, an enum — was
 * considered and rejected: an enum is a boolean per case with a rule saying one
 * holds, which is a thing a designer can already write, and a string input
 * would be a guard the static checks in §7 could say nothing about, because
 * there is no range for a string to fall outside of.
 */
export type InputKind = "boolean" | "number" | "trigger";

export interface InputKindSpec {
	label: string;
	/**
	 * Whether a value persists between triggers.
	 *
	 * False for exactly one kind, and it is the kind whose whole meaning is the
	 * falseness: a trigger is consumed the instant a transition takes it, so
	 * "fired" is true for one evaluation and false afterwards. A runtime that
	 * kept it true would fire every guarded edge on the next unrelated event,
	 * which reads to a person as a machine that has gone off on its own.
	 */
	holds: boolean;
	/** What an input of this kind starts at when the document says nothing. */
	fallback: string;
}

export const INPUT_KINDS: Record<InputKind, InputKindSpec> = {
	boolean: { label: "Boolean", holds: true, fallback: "false" },
	number: { label: "Number", holds: true, fallback: "0" },
	trigger: { label: "Trigger", holds: false, fallback: "" },
};

export const INPUT_KIND_NAMES = Object.keys(INPUT_KINDS) as InputKind[];

/**
 * One input of one machine.
 *
 * Every field is a **plain string, never a {@link Value}**, and that is the one
 * decision in this interface worth arguing about. A `Value` would let a range
 * name a token, and a token with two alternatives would be two designs — which
 * is genuinely how `Transition.duration` works and genuinely right there.
 * It is wrong here. A range decides nothing anybody can see: it decides which
 * guards §7 calls impossible, and a document that held two opinions about that
 * would be a document that could not say whether its own machine was broken.
 * A budget is the thing alternatives are judged against, which is the same
 * argument `machinecheck.ts` already makes about the duration budget, one rung
 * further out.
 */
export interface MachineInput {
	/** Unique among the inputs of *its own machine*; a bare ASP constant. */
	id: string;
	/** What it is called. Free-form. */
	name: string;
	kind: InputKind;
	/**
	 * What it holds before anybody drives it.
	 *
	 * `"true"` / `"false"` for a boolean, read through {@link wordOf}; a numeral
	 * for a number, read through {@link permilleOf}. Absent, unreadable, or set
	 * on a trigger takes {@link INPUT_KINDS}' own fallback — a trigger has no
	 * resting value to start at, because "not fired" is not a value, it is the
	 * absence of one.
	 */
	initial?: string;
	/**
	 * The closed ends of a number input's range, inclusive. Numerals, read
	 * through {@link permilleOf}.
	 *
	 * **Absent is open, not zero.** An input with no `min` accepts anything, and
	 * the two checks that read a range (§7.1 and §7.4) simply say nothing about
	 * it. That is the honest reading: a designer who has not said how far the
	 * drawer opens has not said that it does not open at all, and a check that
	 * invented `0` would report violations against a claim nobody made.
	 *
	 * Ignored on a boolean and on a trigger, where the range is the kind.
	 */
	min?: string;
	max?: string;
}
```

and on `Machine`:

```ts
export interface Machine {
	// …
	/**
	 * What a host can hand this machine — see {@link MachineInput}.
	 *
	 * Absent is a machine nobody drives from outside, which is every machine any
	 * document currently holds, and the absence has to keep meaning that: a
	 * reader that filled this in with an empty array would still be right, but a
	 * reader that filled it in with a default input would change what the
	 * existing documents mean.
	 */
	inputs?: MachineInput[];
}
```

### 1.3 The fifth literal bridge — `permille/2`

A number input's range, a condition's comparand and a blend stop's threshold are
all *ratios*, and ASP has no floats. Length reaches the program as an integer
count of EMU and time as an integer count of milliseconds; a ratio reaches it as
an integer count of **thousandths**, and the reader is exact or nothing exactly
as `emuOf` and `msOf` are.

In `packages/design-core/src/values.ts`, beside `numeralOf`, `tallyOf` and
`msOf`:

```ts
/**
 * The largest magnitude a ratio may reach the program as, in thousandths.
 *
 * A thousand units either way. The argument is {@link MAX_TALLY}'s and
 * {@link MAX_MS}': gringo's integers are 32-bit and wrap in silence, the widest
 * arithmetic a permille reaches is a comparison against another permille, and a
 * blend axis a thousand units long is already past every input anybody has
 * declared. A mistyped `1e9` is a typo, and reading it as no number at all is
 * what every caller here already handles.
 */
export const MAX_PERMILLE = 1_000_000;

/**
 * The whole number of thousandths a text reads as: `"0.5"` is 500, `"1"` is
 * 1000, `"-2.25"` is -2250.
 *
 * The ASP-side reader for the `ratio` quantity, and the fifth member of the
 * family `emuOf`, `msOf`, `tallyOf` and `wordOf` are in. It is a *different*
 * function from {@link numeralOf}, which is the TypeScript-side reader and
 * returns a float, and the two are not merged for the reason `emuOf` and
 * `numeralOf` are not: a fact has to be an integer, and the exactness rule
 * belongs to the boundary rather than to the quantity. `"0.5"` is a ratio in
 * both readings; `"0.0005"` is a ratio to `numeralOf` and **nothing at all**
 * here, because half a thousandth is not a whole thousandth and rounding it
 * would put a number in the program that nobody typed.
 *
 * Unitless only. A percentage is refused rather than divided by a hundred:
 * `"50%"` and `"0.5"` are the same quantity written two ways, and a document
 * that could say it either way would be a document where a blend threshold and
 * an input range could silently be off by a factor of a hundred from each
 * other. If a designer wants percentages, they declare the input's range as
 * `0`..`100` and every number in the machine is in the same units — which is
 * what Rive does, and it is right.
 */
export function permilleOf(text: string): number | undefined;

/** The nearest whole thousandth, for the one caller allowed to round: a field
 *  a person is typing into. The twin of `nearestMs` and `nearestEmu`. */
export function nearestPermille(text: string): number | undefined;

/** A whole number of thousandths, spelled back. `500` is `"0.5"`, `1000` is `"1"`. */
export function writePermille(permille: number): string;

/** True when values of this type are ratios — the twin of `isTimeType`. */
export const isRatioType = (type: ValueType): boolean =>
	VALUE_TYPES[type].quantity === "ratio";
```

In the program, beside `numeral/2`, `tally/2`, `word/2` and `millis/2`, for
every interned literal `permilleOf` reads:

```prolog
#defined permille/2.
permille(l7,500).
```

Emitted under the same argument as the other four: a literal has no type, the
reader is chosen by what the value *is*, so `"0.5"` carries a `permille` and no
`tally`, `"12"` carries a `tally` **and** a `permille` of 12000, and `"200ms"`
carries a `millis` and neither.

> `"12"` carrying both a `tally/2` and a `permille/2` is deliberate and is the
> one overlap in the family. A count and a ratio are the same characters and
> differ only in what asks; every reader in the program asks by name
> (`tally` for a track count, `permille` for a blend threshold), so the overlap
> costs one extra atom per integer literal and confuses nothing. Adding a
> disambiguating rule would mean deciding, at interning time, what a number is
> *for*, which is the one thing an interned literal deliberately does not know.

### 1.4 The facts, and the rule that keeps an input out of the design space

| Predicate | Kind | Meaning |
| --- | --- | --- |
| `minput(M,X)` | fact | `X` is an input of machine `M` |
| `minkind(M,X,K)` | fact | `boolean`, `number` or `trigger` |
| `minbool(M,X,B)` | fact | a boolean input's starting value: `true` or `false` |
| `minnum(M,X,N)` | fact | a number input's starting value, in thousandths |
| `minlow(M,X,N)` `minhigh(M,X,N)` | fact | the closed ends of a number input's range, thousandths. Absent is open |

Derived:

| Predicate | Meaning |
| --- | --- |
| `minbounded(M,X)` | the input declares at least one end |
| `mintyped(M,X,K)` | `minkind` with the machine's own inputs only — see the guard below |

There is no `mval`-shaped variable, no `alt/2` and no `docvar` for an input, and
the reviewer's check is a scan: **`minput`, `minkind`, `minbool`, `minnum`,
`minlow` and `minhigh` are the only six predicates an input produces, and every
one of them is a fact.** `machineValues` is not extended for rung one. If a step
finds itself calling `emitValue` with an input key, it has taken a wrong turn.

### 1.5 How the studio drives one, and how the export does

Both drive it the same way, through the same table, which is the whole point of
`machineTable`/`stepMachine` and is the property `runtime.test.ts` already
exists to defend.

`MachineTable` gains, per machine:

```ts
inputs: Record<string, {
	kind: InputKind;
	/** Boolean: true/false. Number: thousandths. Trigger: absent. */
	initial?: boolean | number;
	/** Thousandths, where the document declared an end. */
	min?: number;
	max?: number;
}>;
```

and the runtime gains a *value store per instance*, because two buttons made from
one definition have two hover progresses and always did. The store is
`Record<instanceId, Record<inputId, boolean | number>>`, seeded from `initial`,
and a trigger input is not in it at all: a trigger is a set of ids that were
fired *for this evaluation*, handed in and thrown away.

In the studio it is editor state, held by `useMachinePlayback`, exactly as
`playing` already is, and for exactly the same reason: driving an input costs no
solve. Every state's copy is already in the one answer set; setting an input can
only change which state the preview *walks to*, and walking to a state is
reading a different entry out of the model that is already there. **Nothing
recompiles, nothing re-grounds, nothing lands in undo.**

In the exported file the store is a `var` in the runtime's closure, seeded from
the table, and the page's own script may set one through the handle the runtime
returns (§9.3). The exported file does not grow a UI for inputs and is not going
to: an input is an interface to the page that embeds the design, not a control
the design draws for itself.

---

## 2. Rung two: conditions, and exit time

### 2.1 What a guard is

A transition fires when its trigger happens **and** every one of its conditions
holds. The conjunction is total and there is no `or`: two guards that should be
alternatives are two transitions, which is what Rive does, and which here has a
second payoff — two transitions are two rows with two ids, so a violation can
name the one that is impossible instead of pointing at half of a boolean
expression.

### 2.2 The types

```ts
/**
 * How a condition compares.
 *
 * Six words, and the split is by what they can be asked of. `eq` and `ne` suit
 * every kind; the four orderings suit a number and nothing else; `fired` suits a
 * trigger and nothing else and takes no comparand, because "the trigger
 * happened" is the whole of what there is to say about a moment.
 *
 * Spelled as constants rather than as `"="`, `"!="`, `">"` — they reach the
 * program as themselves, inside `mcondop/4`, and `>` is not a term.
 */
export type CompareOp = "eq" | "ne" | "gt" | "lt" | "ge" | "le" | "fired";

export interface CompareOpSpec {
	label: string;
	/** Which input kinds this op may be asked of. */
	kinds: readonly InputKind[];
	/** Whether it takes a comparand at all. */
	comparand: boolean;
}

export const COMPARE_OPS: Record<CompareOp, CompareOpSpec> = {
	eq: { label: "is", kinds: ["boolean", "number"], comparand: true },
	ne: { label: "is not", kinds: ["boolean", "number"], comparand: true },
	gt: { label: "is more than", kinds: ["number"], comparand: true },
	lt: { label: "is less than", kinds: ["number"], comparand: true },
	ge: { label: "is at least", kinds: ["number"], comparand: true },
	le: { label: "is at most", kinds: ["number"], comparand: true },
	fired: { label: "fired", kinds: ["trigger"], comparand: false },
};

export const COMPARE_OP_NAMES = Object.keys(COMPARE_OPS) as CompareOp[];

/**
 * One conjunct of one transition's guard.
 *
 * A plain string comparand, never a {@link Value}, for {@link MachineInput}'s
 * reason exactly: a guard decides nothing an onlooker can see, so a comparand
 * with two alternatives would be two universes identical in every projected
 * atom. It would also make §7.1 undecidable in the only way that matters —
 * "this guard can never be satisfied" would become "this guard can never be
 * satisfied in three of the four universes", which is a sentence with nowhere
 * to be said.
 */
export interface Condition {
	/** An input id of the same machine. */
	input: string;
	op: CompareOp;
	/**
	 * What the input is compared against: `"true"`/`"false"` for a boolean, a
	 * numeral for a number. Absent for `fired`, and ignored where the op takes
	 * none.
	 */
	value?: string;
}
```

and on `Transition`:

```ts
export interface Transition {
	// …
	/**
	 * Everything that must hold, as well as the trigger, for this edge to be
	 * taken. Absent or empty is an unguarded edge — which is every edge in every
	 * document written before this rung, and which must stay exactly as fast and
	 * exactly as legal as it is today.
	 *
	 * A conjunction, in document order. The order does not decide anything: the
	 * program tests all of them at grounding and the runtime tests all of them at
	 * the event, and neither short-circuits in a way an onlooker could detect.
	 * It is kept because a person put them in that order and a list that
	 * reordered itself would be a list nobody could edit.
	 */
	conditions?: Condition[];
	/**
	 * How long this transition's `from` state must have been held before this
	 * edge may be taken, as a `duration` {@link Value} — see §2.5.
	 *
	 * A {@link Value} and not a plain string, unlike a condition's comparand, and
	 * the difference is the point rather than an inconsistency: an exit time is
	 * *pacing*. It belongs to the same family as `duration`, `delay` and
	 * `stagger`, it wants to name the same `duration` token they do, and a motion
	 * scale that made every transition brisk and left one debounce at 400ms would
	 * be a motion scale with a hole in it.
	 */
	exit?: Value;
}
```

### 2.3 `exit` joins `MOTION_PROPS`, and almost nothing has to change

`MotionProp` gains `"exit"` and `MOTION_PROPS` gains:

```ts
	/**
	 * How long the `from` state must have been held before the edge may be
	 * taken — Rive's exit time.
	 *
	 * Zero by default, which is "any time", and is what every transition in
	 * every existing document means. Unsigned for `duration`'s reason and not
	 * `delay`'s: a negative exit time would be a transition takeable before its
	 * state began, which is not a thing to ask for however generously it is read.
	 */
	exit: { label: "Exit time", type: "duration", fallback: "0ms", signed: false },
```

This one table entry is worth pausing on, because it is why this rung is cheap.
Everything downstream of `MOTION_PROPS` iterates `MOTION_PROP_NAMES`, so the
following all extend themselves with no edit at all:

- `compile.ts` `MOTION_DEFAULTS` emits `mdefexit(0)` — once
  `MOTION_DEFAULT_PREDICATES` gains `exit: "mdefexit"`, which is the one line
  that is not free;
- `compile.ts` `machineValues` mints `mval(M,T,exit)` per transition;
- `compile.ts` `unreadVariables` reads it back through `motionValueOf`;
- `project.ts`'s transition reader reads and validates it;
- `Transitions.tsx` grows a fourth motion row, because it renders
  `MOTION_PROP_NAMES.map(motionRow)`.

The four lines that are *not* free are the `mexit/3` rules (§8), the
`MOTION_DEFAULT_PREDICATES` entry, `ModelMachine.exit`, and the export's use of
it. Everything else is a table.

> **Risk, stated here so no step is surprised by it.** `Transitions.tsx` gaining
> a row is a *visible* change to a shipped panel that no step in this ladder
> owns editing. It is the intended behaviour — the row is how a designer types
> an exit time — but a step that runs the app and sees a fourth row has not
> found a bug.

### 2.4 The facts

Conditions are indexed within their transition, 1-based in document order, so a
violation can name one.

| Predicate | Kind | Meaning |
| --- | --- | --- |
| `mcond(M,T,K)` | fact | transition `T` of `M` has a `K`th condition |
| `mcondin(M,T,K,X)` | fact | it is about input `X` |
| `mcondop(M,T,K,Op)` | fact | one of the {@link COMPARE_OPS} words |
| `mcrange(M,T,K,X,Lo,Hi)` | fact | a **numeric** condition, normalised to a closed window in thousandths |
| `mcnot(M,T,K,X,N)` | fact | a numeric `ne`: the one thousandth value it excludes |
| `mcis(M,T,K,X,B)` | fact | a boolean `eq`: `true` or `false` |
| `mcisnot(M,T,K,X,B)` | fact | a boolean `ne` |
| `mcfired(M,T,K,X)` | fact | a trigger `fired` |
| `mcbad(M,T,K)` | fact | the condition names an input the machine has not got, or an op its kind does not take, or a comparand that reads as nothing |
| `mval(M,T,exit)` | variable | the exit time, minted by the existing `machineValues` loop |

**The normalisation into a window is where the work is, and it is done in
TypeScript rather than in ASP.** `mcrange` carries a closed interval because a
closed interval is the shape the clash rules in §7.1 can compare in one line,
and because turning six operators into intervals once, in a function with a
name, is better than six pairs of rules that each have to know which way `ge`
points. The mapping, with `±MAX_PERMILLE` standing for the open ends:

| Condition | `Lo` | `Hi` |
| --- | --- | --- |
| `x eq v` | `v` | `v` |
| `x ge v` | `v` | `MAX_PERMILLE` |
| `x gt v` | `v + 1` | `MAX_PERMILLE` |
| `x le v` | `-MAX_PERMILLE` | `v` |
| `x lt v` | `-MAX_PERMILLE` | `v - 1` |
| `x ne v` | *(no window)* | — |

`gt` becoming `v + 1` is exact rather than an approximation, and it is exact
*because* the quantity is an integer count of thousandths. That is the same
sentence a length in EMU earned and it is earned here for the same reason: the
moment a quantity is a whole number of something, "greater than" and "at least
one more than" are the same claim, and the checks below get to be arithmetic
rather than symbolic.

`ne` gets no window because a hole is not an interval. It clashes with exactly
one thing — the point it excludes — and §7.1 says so in two lines.

Derived:

| Predicate | Meaning |
| --- | --- |
| `mguarded(M,T)` | `T` has at least one condition |
| `mclash(M,T1,T2)` | some condition of `T1` and some condition of `T2` cannot both hold |
| `mdisjoint(M,T1,T2)` | symmetric closure of `mclash` |
| `moverlap(M,T1,T2)` | two edges whose guards are **not** provably disjoint |
| `mguardnever(M,T)` | `T`'s own guard cannot be satisfied — §7.1 |
| `mfeasible(M,T)` | `mtrans(M,T)` and not `mguardnever(M,T)` |
| `mexit(M,T,Ms)` | the exit time this universe resolved to, clamped at zero |

### 2.5 Exit time: what it means here, and where we leave Rive

Rive's exit time is "how long must pass in this state before this transition may
be taken", and it is usually paired with a transition that has no trigger at all:
the animation finishes and the machine moves on by itself.

**We have no untriggered transitions and this document does not add any.** Every
transition has a trigger; `load` is the one that fires by itself, once. So exit
time here means precisely:

> A trigger arriving before the `from` state has been held for `mexit`
> milliseconds **does not move the machine**, and is not remembered.

That is a debounce, and it is a genuinely useful thing to be able to say — "a
second click within 300ms is the same click" is one line of a table instead of a
timer somebody hand-writes. It is also a deliberate, stated departure from Rive
in one respect: **Rive would fire the transition when the exit time elapses if
the condition still holds; we drop the event instead.** The reason is the same
one `runtime.ts` already gives for having no `setTimeout` in it: a deferred fire
is a state change nobody's finger caused, arriving at a moment nothing on the
page marks, and a runtime with a queue in it is a second animator arguing with
the compositor. A designer who wants "and then it moves on by itself" writes a
`load`-triggered edge out of the destination state, which the runtime's `settle`
already follows.

The runtime therefore reads a clock but never sets one: it records
`Date.now()` per instance per layer at each state change and compares. There is
still no timer in the exported file, and a grep for `setTimeout` still comes up
empty. That sentence is load-bearing and step L9 must keep it true.

---

## 3. Rung three: Entry, Exit and Any

### 3.1 Three reserved ids, and not three states

`entry`, `exit` and `any` become **reserved state ids**, legal only as a
`Transition.from` or `.to` and never as a `MachineState.id`.

They are deliberately not entries in `Machine.states`, and the argument is the
one §2 of the shipped spec makes about `stt/3` not being a `node/1`. A
`MachineState` is *a delta over the definition's parts*. Entry, Exit and Any have
no appearance and never will: they would be three empty deltas per machine, three
copies per instance per part in `mcopy/3`, three rows in every state strip, three
terms in `stateCopyIds` that a rule could name and that would say nothing — and
`shownState` could return one of them, which would mean "draw this button in
Exit", which is not a picture. Every one of those costs is paid to express three
words that are perfectly well expressed as three constants.

`normalizeScene` **drops a state whose id is reserved** (step L6), on the same
argument it already drops a state whose id is not an ASP constant: a term the
program is going to read as something else is not a state, and keeping it would
make one picture wrong in a way nothing reports.

The compiler emits three facts, always, beside `MOTION_DEFAULTS`:

```prolog
mreserved(entry). mreserved(exit). mreserved(any).
```

### 3.2 Entry — and the discovery that we already had it

Rive's Entry is a node with one job: the machine begins there, and the
transitions out of it choose the starting state, possibly under guards.

We already ship that, and it is called `load`. `TRIGGERS.load` is documented in
`scene.ts` as "a load trigger fires once, when the runtime starts. It is how a
machine says 'settle into this state' rather than 'wait to be poked'", and
`MACHINE_RUNTIME`'s `settle()` already follows a chain of them at start.

So Entry is **sugar over the initial state**, and it is spelled as a rule rather
than as a rewrite in the compiler, so that a hand-written `mfrom(M,t,entry)` gets
the same treatment as a document one:

```prolog
mefrom(M,T,S) :- mfrom(M,T,entry), mlinitial(M,L,S), mtlayer(M,T,L).
```

`addTransition` defaults an Entry edge's trigger to `load` (step L7). Nothing
forces it: an Entry edge on `click` is simply a click edge out of the initial
state, which is a coherent thing to have written and is not worth refusing.

**`shown/2` is untouched by an Entry edge.** Which state the canvas draws is a
fact from the document; an Entry edge decides where the *runtime* starts. Those
two can differ, exactly as they already can when `SceneNode.state` names a
non-initial state, and `export.ts` already answers the question that raises: the
CSS **base** is the machine's initial state and `data-state` is initialised from
the document. Nothing there changes.

### 3.3 Any — a source, not a state

An `any` edge may be taken from any state **of its own layer**. It is not a state
and it does not participate in reachability as a destination.

```prolog
manyfrom(M,T) :- mfrom(M,T,any).
mefrom(M,T,S) :- manyfrom(M,T), mstate(M,S), mslayer(M,S,L), mtlayer(M,T,L).
```

> **AMENDED (merged-plan §1.2).** The predicate was spelled `many/2`. The word
> "many" appears twenty-six times in the generated program's own comments, so a
> predicate called `many` is a predicate nobody can grep for — and this repository
> has a commit whose entire subject is that failure mode. `manyfrom/2` says the
> same thing and can be found. Every occurrence of `many(` in §8 reads
> `manyfrom(` too.

Precedence, when a specific edge and an Any edge both leave the same state on the
same trigger: **the specific one wins.** That is Rive's rule and it is also the
only rule that makes Any usable — an Any edge is the fallback, and a fallback
that beat the specific case would be a fallback nobody could override. It is
encoded as a rank, and the rank is what keeps `mnondet/3` from screaming at the
ordinary idiom:

```prolog
mrank(M,T,1) :- mfrom(M,T,S), not mreserved(S).
mrank(M,T,2) :- manyfrom(M,T).
```

`not mreserved(S)` rather than `mstate(M,S)`, and the difference is not a
shortcut. `machines.ts` records as intentional that "a nondeterministic pair may
be reported on a `from` the machine has not got", because two edges leaving the
same missing state are still two edges the designer wrote and meant. Requiring
`mstate/2` here would take that back — silently, and only for the pair that has
*also* lost its state, which is the worst moment to stop reporting anything.

`machineTable` says the same thing in the table so that both interpreters agree:
an Any edge is written into every state's row of its layer, and **only where that
row has no specific entry for the trigger already**. The table is built specific
edges first, Any edges second, document order within each — which is the existing
"first enabled transition wins" rule with one tie-break in front of it.

### 3.4 Exit — a destination that stops a layer

An `exit` edge's `to` is `exit`; taking it stops the layer. A stopped layer keeps
whatever state it was last in — its classes stay on the element, its copy is
still what the picture draws — and stops responding to triggers.

```prolog
mstops(M,T) :- mto(M,T,exit).
```

A state whose only outgoing edge goes to `exit` **is not a dead end**: something
leaves it, and what it leaves to is the end of the layer, which is a design
somebody meant. `mleaves/2` reads `mefrom/3`, so this falls out with no extra
rule, and the shipped `mdeadend/2` keeps meaning what it meant.

What `exit` does need is an exemption from `mdangling/2`, which today reports any
end that is not an `mstate/2`. That is the one change this rung makes to a
shipped rule, and it is guarded so that a document with no reserved ids in it is
byte-identical:

```prolog
mdangling(M,T) :- mfrom(M,T,S), not mstate(M,S), not mreserved(S).
mdangling(M,T) :- mto(M,T,S), not mstate(M,S), not mreserved(S).
% ...and a reserved id in the wrong position is its own fault, reported under
% its own name rather than folded into dangling, because "this edge names a
% state you deleted" and "this edge tries to leave Exit" are two different
% mistakes and a designer fixes them two different ways.
mmisplaced(M,T) :- mfrom(M,T,exit).
mmisplaced(M,T) :- mto(M,T,entry).
mmisplaced(M,T) :- mto(M,T,any).
```

`machine_wired`'s canned body gains a second disjunct, which is the only edit any
shipped check needs:

```prolog
viol(machine_wired) :- mdangling(_,_).
viol(machine_wired) :- mmisplaced(_,_).
```

### 3.5 What the shipped health predicates now read

Every one of the four keeps its name, its arity and its meaning, and three of
them change which predicate they walk. **On a document with no reserved id, no
condition and one layer, `mefrom/3` is `mfrom/3` and all four are the rules that
shipped.** That equality is step L4's test 1 and is the whole of the
no-regression argument for this rung.

```prolog
% The effective source of an edge: what it may be taken from.
mefrom(M,T,S) :- mfrom(M,T,S), not mreserved(S).
```

Note that this deliberately does **not** require `mstate(M,S)`. The shipped
`machines.ts` records two quirks as intentional — reachability follows an edge
whose destination is not a state, and a nondeterministic pair may be reported on
a `from` the machine has not got — and both survive here unchanged. A rule that
tightened them would be repairing the document into silence, which is the thing
`mdangling/2` exists to prevent.

---

## 4. Rung four: layers

This is the deepest change and it is also, because of how the shipped encoding
was built, a surprisingly small one. It is worth saying why before saying what.

Copies **compose** where a choice rule would **multiply**. Had a state been
`1 { spick(I,S) : mstate(M,S) } 1`, two layers would have been two choice rules,
and a document with a four-state layer and a three-state layer would have been
twelve universes of which nobody was choosing between eleven — and the question a
person actually asks about layers ("does the glow still line up when the button
is also pressed?") would have been unaskable, because the two layers' states
would be in different answer sets. Under copies, two layers are two `shown/2`
facts in the one answer set, and the composite is a rule.

### 4.1 The types

```ts
/**
 * One layer of a machine: a name, and an order.
 *
 * Deliberately *not* a container of states. A layer holds no `states` array and
 * no `transitions` array, and each {@link MachineState} names its layer instead
 * — which is the opposite of how Rive's file format does it and is the right
 * way round here, for two reasons that both come from the shipped encoding.
 *
 * A state id is already unique per *machine* (`MachineState.id` says so), and
 * `stt(I,S,N)` names a state with no layer in the term. Nesting the states
 * under layers would either re-scope every id — changing the arity of
 * `mstate/2`, `mindex/3`, `mcopy/3` and the shape of every state copy term a
 * designer has already typed into a rule — or leave the ids machine-scoped
 * anyway and make the nesting a second, redundant statement of where a state
 * lives. And `Machine.states` in document order is what the state strip renders
 * and what `mindex/3` numbers; a machine whose states lived in two arrays would
 * need a third thing to say what order they are in.
 *
 * So a layer is an id, a name and a position, and the position is the priority
 * — the same "the order *is* the answer" the initial state and `order/2`
 * already use, one axis over.
 */
export interface MachineLayer {
	/** Unique among the layers of its own machine; a bare ASP constant. */
	id: string;
	name: string;
}

export interface Machine {
	// …
	/**
	 * The machine's layers, in order. **Later layers win** — see §4.4.
	 *
	 * Absent or empty is a one-layer machine, which is every machine in every
	 * document today. The reader mints nothing for it: a machine with no
	 * `layers` emits one `mlayer(M,base)` and every state belongs to it.
	 */
	layers?: MachineLayer[];
}

export interface MachineState {
	// …
	/**
	 * Which layer this state belongs to. Absent, or naming a layer the machine
	 * has not got, is the **first** layer.
	 *
	 * Absent-is-first rather than absent-is-invalid, for {@link SceneNode.state}'s
	 * reason: a machine edited down must leave its states legal, and a document
	 * written before layers existed must mean exactly what it meant.
	 */
	layer?: string;
}
```

and on `SceneNode`:

```ts
export interface SceneNode {
	// …
	/**
	 * Which state of each *further* layer this instance is drawn in — layer id to
	 * state id.
	 *
	 * {@link SceneNode.state} keeps saying what it says, and says it about the
	 * **first** layer. Two fields for one idea is a smell and it is being paid
	 * for on purpose: every machine that exists today has one layer, every
	 * instance that exists today says its state in one string, and making them
	 * all grow a record keyed by a layer id nobody named would be churn with no
	 * reader — and a migration, which is a thing that can go wrong, in exchange
	 * for a tidiness nobody can see.
	 *
	 * An entry here for the first layer wins over `state`, so there is exactly
	 * one place a multi-layer document says the whole answer. Nothing is
	 * corrected on the way in.
	 */
	states?: Record<string, string>;
}
```

`machines.ts` gains the one reader everything else goes through:

```ts
/** Layer id -> the state this node is drawn in, for every layer of the machine. */
export function shownStates(machine: Machine, node: SceneNode): Record<string, string>;

/** The layers of a machine, in order, minting `base` where the document has none. */
export function machineLayers(machine: Machine): MachineLayer[];

/** The layer a state belongs to, falling back to the first. */
export function layerOf(machine: Machine, state: MachineState): string;

/** The first state of a layer — that layer's initial state. */
export function layerInitial(machine: Machine, layer: string): MachineState | undefined;
```

`shownState(machine, node)` is **kept, unchanged, and means the first layer's
state.** Every existing caller is asking about a one-layer machine and gets the
same answer it got.

### 4.2 The facts

| Predicate | Kind | Meaning |
| --- | --- | --- |
| `mlayer(M,L)` | fact | `L` is a layer of `M`. Always at least one |
| `mlindex(M,L,K)` | fact | `L` is `M`'s `K`th layer, 1-based, document order. **The order is the priority** |
| `mslayer(M,S,L)` | fact | state `S` belongs to layer `L` |
| `mlfirst(M,L,S)` | fact | `S` is the first state of `L` in document order |
| `mlshadow(M,L,N,P)` | fact | some state of layer `L` overrides property `P` on part `N` |
| `mlfshadow(M,L,N,D)` | fact | the same for a dimension |

Derived:

| Predicate | Meaning |
| --- | --- |
| `mlinitial(M,L,S)` | `mlfirst(M,L,S)` — the state a layer starts in |
| `mtlayer(M,T,L)` | the layer a transition belongs to |
| `mwriter(M,L,N,P)` | the layer that actually decides `P` on `N`: the last one that owns it |
| `mfwriter(M,L,N,D)` | the same for a dimension |
| `mfight(M,L1,L2,N,P)` | two layers both own property `P` of part `N` |
| `mffight(M,L1,L2,N,D)` | two layers both own dimension `D` of part `N` |
| `mfightat(I,L1,L2,N,P)` | …and both of their shown states are the ones on screen |
| `mcrosslayer(M,T)` | a transition whose ends are in two different layers |

`minitial(M,S) :- mindex(M,S,1)` is **kept exactly as it is**, and is the first
layer's initial state. `mlinitial/3` is the per-layer one and is a different
predicate rather than a different arity of the same one, because two arities of
one name in a file people read by grep is a cruelty.

### 4.3 The rules that thread the layer through

Three shipped rules gain a layer argument in their body and keep their heads:

```prolog
% Every instance is in one state per *layer*, and never in two of one layer.
% The guard is the shipped one with L threaded through it — the default must not
% be the reason the default stops applying, which is the pair with no stable
% model.
mstated(I,L) :- minstance(I,M), shown(I,S), mslayer(M,S,L), not mlinitial(M,L,S).
shown(I,S)   :- minstance(I,M), mlinitial(M,L,S), not mstated(I,L).

% Two shown states of *one layer* is two pictures on top of each other. Two
% shown states of two layers is a machine doing its job.
mtwoshown(I) :- minstance(I,M), shown(I,S1), shown(I,S2), S1 < S2,
                mslayer(M,S1,L), mslayer(M,S2,L).

% Reachability starts at every layer's own initial state, because a layer that
% is never entered is not a machine with unreachable states, it is a layer.
mreach(M,S) :- mlinitial(M,_,S).
```

On a one-layer document each of these is the rule that shipped, atom for atom.
That is not a hope; it is step L4's test.

### 4.4 The conflict rule — the decision the brief asked for

Two layers can both have an opinion about one property of one part. Rive resolves
it by layer order, last writer wins, and reports nothing. The brief asks whether
we do the same, or refuse to guess and name the two layers fighting.

**We do both, and the order matters: resolve first, report second.**

*Resolve*, because the program must produce a picture. Leaving the alias to fire
for both layers would derive two literals for one `rendered/3`, and `rendered/3`
is a relation — two literals for one property is not two designs, it is one
arbitrary answer, silently. That is the exact disease the `mshadow` guard was
added to cure and re-introducing it one rung up would be a regression, not a
policy. And refusing by making the document *unsatisfiable* would be worse still:
two layers that both animate opacity is the single most ordinary thing anybody
builds with layers, and a tool that showed a blank canvas and an unsat core for
it would be a tool nobody reached rung four with.

*Report*, because we can, and because it is the reason to build this here. The
conflict is derived as `mfight/5` against terms the document named — the machine,
the two layers, the part and the property — so the canned check
`machine_layers_agree` (§7.3) turns it into an ordinary `viol/1` with a switch, a
name in the unsat core, a strength that can be softened to a preference, and
`why` and `relax` for free. Rive ships none of that. **This is the audit's whole
conclusion in five rules.**

```prolog
% Which layer actually decides a property: the last one that owns it. The order
% is the priority, the way document order is already the initial state and the
% paint order, so there is no `priority` field to disagree with the list.
mwriter(M,L,N,P) :- mlshadow(M,L,N,P),
                    K = #max{ J : mlshadow(M,L2,N,P), mlindex(M,L2,J) },
                    mlindex(M,L,K).
mfwriter(M,L,N,D) :- mlfshadow(M,L,N,D),
                     K = #max{ J : mlfshadow(M,L2,N,D), mlindex(M,L2,J) },
                     mlindex(M,L,K).

% ...and the fact that there was a decision to make.
mfight(M,L1,L2,N,P)  :- mlshadow(M,L1,N,P), mlshadow(M,L2,N,P), L1 < L2.
mffight(M,L1,L2,N,D) :- mlfshadow(M,L1,N,D), mlfshadow(M,L2,N,D), L1 < L2.
% The same fight, in this universe, on this instance, as drawn — for the panel
% that wants to say "these two, right now" rather than "these two, in principle".
mfightat(I,L1,L2,N,P) :- minstance(I,M), mfight(M,L1,L2,N,P),
                         shown(I,S1), mslayer(M,S1,L1),
                         shown(I,S2), mslayer(M,S2,L2).
```

`mfight/5` is **static**: it fires when two layers both *could* write the
property, whether or not the two states that do are both on screen. That is the
right default and it is not laziness — a machine is a claim about all of its
runs, and a check that only fired in the universe you happened to be looking at
would be a check that passed until it shipped. `mfightat/6` is there for the
panel, which is answering a different question ("why is this pixel this colour")
and is allowed to be about the moment.

### 4.5 The alias, narrowed

The three alias rules gain an ownership guard, and this is the change that makes
layers work at all:

```prolog
frame(inst(I,N),D,V) :- frame(stt(I,S,N),D,V), shown(I,S),
                        minstance(I,M), mslayer(M,S,L), mfwriter(M,L,N,D).
rendered(inst(I,N),P,L) :- rendered(stt(I,S,N),P,L), shown(I,S),
                           minstance(I,M), mslayer(M,S,Lay), mwriter(M,Lay,N,P).
% Hiding needs no writer, because hiding does not conflict: two layers that both
% take a part out of the picture agree, and one that hides while another paints
% is not a disagreement about a value, it is a part that is not there. Any layer
% that hides, hides.
hidden(inst(I,N)) :- mhidden(I,S,N), shown(I,S).
```

**Why this is not a regression, argued rather than assumed.** Take a one-layer
document and any property `P` of any part `N`:

- *No state owns `P`.* Then `mlshadow` is empty for it, so `mwriter` is empty and
  the alias does not fire — and `mshadow(inst(I,N),P)` is also empty, so the base
  rule `rendered(N,P,L) :- resolved(prop(N,P),L), not mshadow(N,P)` fires and
  derives the same atom the alias used to derive redundantly. Same atom.
- *Some state owns `P`.* Then `mshadow` holds, the base rule is blocked, exactly
  one layer owns it so `mwriter` names that layer, and the alias fires for the
  shown state of it. Same atom.

The guard therefore removes only derivations that were duplicates, which is a
real improvement quite apart from layers: the alias now says only what a state
actually decided, instead of restating everything the copy inherited.

> **AMENDED (merged-plan §6.1 and §6.4).** Two things this section could not
> know, because `docs/three-d-spec.md` did not exist when it was written.
>
> **`mlfshadow/4` must iterate the same dimension list `mfshadow/3` does.** The
> 3D track widens a state's frame delta to six dimensions. If the compiler emits
> `mfshadow` over `DIMENSIONS_3D` and `mlfshadow` over `DIMENSIONS`, then
> `mfwriter/4` is empty for `z` and `depth`, the narrowed alias never fires for
> them, and a state that lifts a mesh 40px moves `stt(I,S,N)` and leaves the
> picture where it was — in a document that solves cleanly and reports nothing.
> Both are emitted over `DIMENSIONS_3D` where `isSpatialScene(scene)`.
>
> **There is a third alias, for rotation, and it needs the same guard.** Two
> layers that both turn one part would derive two `turn/3` atoms for one
> `(node, axis)`, which is precisely the disease §4.4 argues about one predicate
> over: not two designs, one arbitrary answer, silently. `mlrshadow/4`,
> `mrwriter/4` and `mrfight/5` are in merged-plan §6.4, and
> `machine_layers_agree` gains a third disjunct.
>
> `hidden/1` is unaffected in both cases; hiding is still monotone.

### 4.6 What a layer copy is *not*

A state copy of layer 2 inherits, for everything it does not own, the
**instance's own** variable — not layer 1's current value. So `stt(I,glow,badge)`
is layer 2's pose in isolation, and is not "the composite picture with layer 1
already applied".

That is deliberate and it is the only reading that keeps a copy meaningful. A
copy that composed the other layers in would depend on which state every *other*
layer was shown in, which would make it a copy per combination — the cross
product this whole design exists not to build. The composite exists in exactly
one place, `inst(I,N)`, which is what draws, what exports, and what a rule about
the picture names. A rule that wants to compare two layers' poses names the two
copies, and gets exactly what it asked for.

The export composes them the same way and for free: each layer's rules are
written after the previous layer's, so the cascade does what `mwriter` does. §9.2
says how the selectors are kept apart.

---

## 5. Rung five: timelines and blend states

### 5.1 The settled position, stated before anything else

> **The solver decides keyframes. It never decides frames.**

Grounding scales with the number of keyframes a document holds and with nothing
else. There is no frame rate in this document, in the generated program, in the
model, or in the export. A timeline with nine keyframes costs the same whether it
plays over 100ms or 10 seconds, and whether the browser draws it at 60Hz or 120.

What that buys, and what it costs:

- **Solved:** every keyframe's *time* (a `duration` `Value`, so it may name a
  token and follow a motion scale) and every keyframe's *value* (an ordinary
  `Value`, so it may name a colour token, hold alternatives, or be derived).
  Two alternatives inside a keyframe are two designs, and that is legitimate
  branching for the same reason a delta's two fills are: the branch came from a
  `Value` a designer wrote, not from the timeline.
- **Solved, where a rule asks:** the *geometry of one part at one keyframe*,
  placed by simplex, so that "the label is still inside the box at every
  keyframe" is an ordinary geometric constraint. Rationed — §5.5.
- **Interpolated, never solved:** everything between two keyframes. The browser's
  compositor does it in the export, and the studio canvas does it by lerping
  between two copies it already has in the answer set. Neither costs a solve.

### 5.2 The types

```ts
/**
 * One moment on one track: when, and what.
 *
 * `at` is a `duration` {@link Value} rather than a number for the reason a
 * transition's duration is one: a keyframe wants to name the same motion scale
 * everything else does, and "the overshoot happens at `--beat`" is a sentence a
 * document should be able to hold both ends of.
 */
export interface Keyframe {
	/** When, from the start of the timeline. A `duration` Value. */
	at: Value;
	/** What the track's property or dimension is at that moment. */
	value: Value;
	/**
	 * How the segment *leaving* this keyframe is paced. The last keyframe's
	 * easing is read by nothing, and is kept rather than refused, because a
	 * keyframe that stops being last should not lose what somebody typed.
	 */
	easing?: Easing;
}

/**
 * One property of one part, over time.
 *
 * A track names exactly one of `prop` and `dim` — a track that named both would
 * be two tracks sharing a keyframe list, and the moment somebody moved a
 * keyframe on one of them it would be two tracks anyway. A track that names
 * neither is read as no track at all.
 *
 * Per part and per property rather than per part, because that is the grain a
 * designer edits at and the grain a conflict happens at: two layers fighting
 * over `opacity` of `panel` is a sentence about one property, and a per-part
 * track would make it a sentence about six.
 */
export interface Track {
	/** The definition part this animates. */
	part: string;
	prop?: PropName;
	/**
	 * **AMENDED (merged-plan §6.5): `Axis3`, not `Dimension`.** The 3D track
	 * widens a state's frame delta to six, and a line that let a *state* lift a
	 * mesh in z while forbidding a *timeline* from doing it would be an arbitrary
	 * line through one feature. The keyframe copy's frame rules already leave `D`
	 * unbound and need no edit.
	 */
	dim?: Axis3;
	/**
	 * **AMENDED (merged-plan §6.5): new.** A track animates exactly one of
	 * `prop`, `dim` and `turn`, for the reason the two-way split already gives:
	 * a track that named two would be two tracks sharing a keyframe list, and the
	 * moment somebody moved a key on one of them it would be two tracks anyway.
	 * The rotation pair of rules is written in the shape of the dimension pair.
	 */
	turn?: Turn;
	/** In time order. The reader sorts; two keys at one time keep the first. */
	keys: Keyframe[];
}

export type LoopMode = "none" | "loop" | "pingPong";

export interface Timeline {
	/** Unique in its machine; a bare ASP constant. */
	id: string;
	name: string;
	tracks: Track[];
	/**
	 * How long it is, as a `duration` Value. Absent is **the last keyframe's
	 * time**, derived rather than stored, so a timeline cannot disagree with its
	 * own contents. Present and shorter than the last keyframe is legal and is
	 * what it says: the tail is not played.
	 */
	length?: Value;
	loop?: LoopMode;
}
```

and on `MachineState` and `Machine`:

```ts
export interface MachineState {
	// …
	/**
	 * A timeline this state plays, by id.
	 *
	 * A state that plays a timeline still has its `parts` delta, and the two
	 * compose the way everything else in this design composes: the timeline
	 * decides what it has a track for, and the delta decides the rest. The
	 * state's **settled pose** — what `stt(I,S,N)` is, what the canvas draws, what
	 * a cross-state constraint compares — is the timeline's value at its own
	 * length, which is to say the last keyframe of each track. That is derived,
	 * not typed: a document that stored the end pose twice would be a document
	 * where moving the last keyframe left the picture behind.
	 */
	timeline?: string;
	/**
	 * A blend state — several timelines mixed by a number input. Wins over
	 * {@link timeline} where a document somehow holds both, and the pair is
	 * reported as `mtwosource/2` rather than repaired, because a state with two
	 * sources is a mistake a person should see rather than one a reader should
	 * quietly pick a side in.
	 */
	blend?: Blend;
}

/**
 * `oneD` and not `"1d"`, and the spelling is not cosmetic: a blend kind reaches
 * the program as itself, inside `mblend/3`, and `1d` is not an ASP constant —
 * a constant may not begin with a digit. The same rule that makes `spaceBetween`
 * a word rather than `space-between`.
 */
export type BlendKind = "oneD" | "direct";

export const BLEND_KINDS: Record<BlendKind, { label: string }> = {
	oneD: { label: "1D" },
	direct: { label: "Direct" },
};

export interface BlendStop {
	/** The timeline this stop plays. */
	timeline: string;
	/** 1D only: where on the blend input's axis this stop sits. A numeral. */
	at?: string;
	/** Direct only: the number input that is this stop's weight. */
	by?: string;
}

export interface Blend {
	kind: BlendKind;
	/** 1D only: the number input the stops are laid out along. */
	input?: string;
	stops: BlendStop[];
}

export interface Machine {
	// …
	/** Timelines, shared by the states that play them. */
	timelines?: Timeline[];
}
```

Timelines live on the **machine** rather than on the state, because two states
routinely play one animation (a `loop` and a `pressed` both playing `idle`), and
because a blend state plays several. A timeline nothing plays is legal, costs a
handful of variables and no copies, and is how somebody works on one before
wiring it up.

### 5.3 The term scheme

Two new terms. Both go in `machines.ts` beside `statePart`.

| Term | Arity | Meaning |
| --- | --- | --- |
| `trkp(N,P)` / `trkd(N,D)` | 2 | **A track.** Part `N`'s property `P`, or part `N`'s dimension `D`. Two shapes rather than one with a tag, so that a rule that only cares about geometry writes `trkd(N,D)` and grounds against nothing else |
| `kfr(I,W,R,K)` | 4 | **A keyframe copy.** Instance `I`'s pose of track `R` of timeline `W` at keyframe `K`. Carries `frame/3` and `rendered/3`. **Never a `node/1`**, for `stt/3`'s reasons exactly |

```ts
export const trackProp = (nodeId: string, prop: string): string => `trkp(${nodeId},${prop})`;
export const trackDim  = (nodeId: string, dim: string): string  => `trkd(${nodeId},${dim})`;
export function parseTrack(id: string): { node: string; prop?: string; dim?: string } | null;

export const keyCopy = (instanceId: string, timelineId: string, track: string, index: number)
	: string => `kfr(${instanceId},${timelineId},${track},${index})`;
export function parseKeyCopy(id: string):
	{ instance: string; timeline: string; track: string; index: number } | null;

/** The variable a keyframe's time is: `kat(m1,open,trkd(panel,y),3)`. */
export const keyTimeVar = (machineId: string, timelineId: string, track: string, index: number)
	: string => `kat(${machineId},${timelineId},${track},${index})`;
/** The variable a keyframe's value is. */
export const keyValueVar = (machineId: string, timelineId: string, track: string, index: number)
	: string => `kval(${machineId},${timelineId},${track},${index})`;
/** The variable a timeline's own length is. */
export const timelineLenVar = (machineId: string, timelineId: string)
	: string => `tlen(${machineId},${timelineId})`;

/** `"Panel · y · Open · key 3"`, for a motion row and a why-sentence. */
export function keyframeLabel(scene: Scene, variable: string): string | undefined;
/** `"Panel · y · Open · key 3 — Card 1"`, for a keyframe copy a rule named. */
export function keyCopyLabel(scene: Scene, term: string): string | undefined;

/**
 * True when the document still holds what a keyframe-copy term names — the twin
 * of `holdsStateCopy`, and the clause `pruneConstraints` needs so that a rule
 * about a keyframe survives an unrelated `deleteNodes`.
 *
 * Blunt in exactly the same place and for exactly the same reason: held when the
 * instance exists and its machine still has that timeline and that track,
 * whatever `keyframeParts` says today. Asking whether the *copy* exists would
 * delete the designer's rule the moment they cleared it — and the rule is the
 * only thing that makes the copy exist, so that is a loop that eats itself.
 */
export function holdsKeyCopy(scene: Scene, term: string): boolean;
```

> **The pruning clause is not optional and is the same latent bug the shipped
> spec's §5 found.** `pruneConstraints` filters members with
> `alive.has(id) || holdsDatum(...) || holdsStateCopy(...)`, and a `kfr(...)`
> term is none of those — so without the fourth clause, the first
> `deleteNodes`, `groupNodes`, `setGuides` or `removeGuide` after a keyframe rule
> is written silently deletes it. Step L7 owns the line and step L7's test 8 is
> the regression.

`kat`, `kval` and `tlen` join `mval`, `sprop`, `sfval` and `spart` in the set of
keys `parseVariable` deliberately does not read back, for the reason recorded
there: every caller that reads a key back is asking about something the
inspector's generic rows can act on, and these are not.

### 5.4 The facts

| Predicate | Kind | Meaning |
| --- | --- | --- |
| `mtimeline(M,W)` | fact | `W` is a timeline of `M` |
| `mtplays(M,S,W)` | fact | state `S` plays timeline `W` |
| `mtrack(M,W,R)` | fact | `R` is a track of `W` |
| `mtrackof(M,W,R,N)` | fact | the definition part it animates |
| `mkey(M,W,R,K)` | fact | `R` has a `K`th keyframe, 1-based, time order |
| `mkeasing(M,W,R,K,E)` | fact | the segment leaving it |
| `mloop(M,W,Mode)` | fact | `none`, `loop` or `pingPong` |
| `mkpart(M,W,N)` | fact | a part this timeline's keyframe copies are minted for — the analysis, §5.5 |
| `kat(M,W,R,K)` | variable | when |
| `kval(M,W,R,K)` | variable | what |
| `tlen(M,W)` | variable | how long, where the document said |
| `mblend(M,S,Kind)` | fact | state `S` is a blend state |
| `mblendin(M,S,X)` | fact | 1D: the input it blends along |
| `mstop(M,S,J,W)` | fact | its `J`th stop plays timeline `W` |
| `mstopat(M,S,J,N)` | fact | 1D: the threshold, in thousandths |
| `mstopby(M,S,J,X)` | fact | direct: the weight input |

Derived:

| Predicate | Meaning |
| --- | --- |
| `mkat(M,W,R,K,Ms)` | the millisecond this universe put that keyframe at |
| `mtlast(M,W,Ms)` | the last keyframe of any track |
| `mtlen(M,W,Ms)` | the timeline's length: what it says, or `mtlast` |
| `mkcopy(I,W,R,K)` | a keyframe copy exists |
| `mkorder(M,W,R,K1,K2)` | `K2` immediately follows `K1` in time |
| `mkbackwards(M,W,R,K)` | a keyframe that resolved to a time before its predecessor's |
| `mkpast(M,W,R,K)` | a keyframe past the timeline's own length |
| `mstopout(M,S,J)` | a 1D stop outside its blend input's range — §7.4 |
| `mstopgap(M,S)` | the input's range extends past the outermost stop |
| `mtwosource(M,S)` | a state holding both a timeline and a blend |

`mkbackwards/4` is worth a sentence. Keyframe times are `Value`s, so a keyframe
can resolve to a time *before* the one in front of it in a universe where a token
went the other way. That is not a thing a linter over the document can catch, and
it is exactly the class of bug a multiverse invents. It is derived, and it is
available to the Rules panel as an ordinary check; it is not one of the five the
brief asked for, so it does not get a canned constant, and a designer who wants
it writes one line.

### 5.5 The keyframe-copy analysis, and the budget

Keyframe copies are **rationed harder than state copies**, and the default is
none.

A timeline on its own costs *no copies at all*: two variables per keyframe
(`kat` and `kval`), one per timeline (`tlen`), and nothing else. That is enough
for the export, which needs values and times and interpolates the rest, and
enough for the studio canvas, which lerps.

A copy is minted only where a rule asks for one — the same seed
`materializedParts` already uses for its second source, and the same argument:
naming a term in a geometric constraint is what hands it to simplex, and a term
simplex places has to exist.

```ts
/**
 * Which (timeline, track) pairs need a copy per keyframe.
 *
 * Empty for every document that has not written a rule about a keyframe, which
 * is the point: a timeline is variables, and a *placed* keyframe is a copy.
 *
 * Seeded only from `scene.constraints`, reduced through `parseKeyCopy`, and
 * closed upward through the definition exactly as `materializedParts` closes —
 * a copy's world coordinate is its parent's plus its own, and a chain with a
 * link missing puts it in the instance's coordinates instead of on the canvas.
 * The upward closure adds `mkpart/3` entries, not more tracks: an ancestor of an
 * animated part gets a copy so the chain exists, and that copy takes its
 * geometry from the state copy, because no track animates it.
 */
export function keyframeParts(scene: Scene, machine: Machine): Map<string, Set<string>>;
```

**Budget, stated so it can be measured.** For machine `M` with `|W|` timelines
holding `|K|` keyframes in total, driving `|I|` instances, and with `|C|` tracks
a rule names:

- `2·|K| + |W|` variables, **independent of `|I|`** — a keyframe's time and value
  belong to the machine, exactly as a transition's duration does, because every
  instance moves by the same clock;
- `|C|·(keyframes of those tracks)·|I|` `kfr/4` copies, each carrying at most four
  `frame/3` atoms and one `rendered/3`;
- zero atoms per frame, per second, or per anything to do with playback.

`machineprogram.test.ts` asserts the atom count against a document with a
twenty-keyframe timeline and no rules — the assertion being that there are no
`kfr(` atoms at all.

### 5.6 Blend states: what is solved, and the loss

A 1D blend state plays several timelines and mixes them by where a number input
sits between the stops' thresholds. The mixing is arithmetic over a runtime
value, so **none of it is solved**, and none of it can be: the input is not in
the program.

What is solved is everything the stops are made of — every keyframe of every
timeline a stop names, with its time and its value — and everything the checks
need: the thresholds, in thousandths, against the input's declared range.

What the export carries, stated plainly rather than implied:

- **CSS carries one stop.** The stop nearest the input's `initial` value is
  written as the state's `@keyframes`, and the rest are not in the file.
- **A `lost` entry says so**, and names the state and the stops that were
  dropped:
  `"State “drawer” blends three timelines by “open”. CSS has no way to mix two keyframe animations by a number, so the file carries the one nearest where “open” starts and the other two are not in it."`
- **The studio canvas does the real thing**, because it has every keyframe of
  every stop in the one answer set and can lerp between two of them at whatever
  the preview's input says.

That asymmetry is reported as scaffolding, not sold as a feature. Step L8 owns
the sentence and step L8's test asserts the sentence is emitted.

---

## 6. Reading it back

### 6.1 `machines.ts` — the document's own answers

`MachineHealth` gains six members, and every one of them is the twin of a
derived predicate. The duplication is the point, for the reason `machines.ts`
already gives at length: the panel has to be able to say "this guard can never be
met" while the document is unsatisfiable and there is no answer set at all, and a
rule has to be able to say it as a `viol/1` that lands in a core with a name.

```ts
export interface MachineHealth {
	// … the four that shipped, unchanged …
	/** Transitions whose guard cannot be satisfied — `mguardnever/2`. */
	impossible: string[];
	/** States no *feasible* chain reaches — `mgunreached/2`. A superset of `unreachable`. */
	unreachableWithGuards: string[];
	/** Transitions naming a reserved id in the wrong position — `mmisplaced/2`. */
	misplaced: string[];
	/** `[layer, layer, part, prop]` — `mfight/5`. */
	fights: Array<[string, string, string, string]>;
	/** `[layer, layer, part, dim]` — `mffight/5`. */
	frameFights: Array<[string, string, string, string]>;
	/** `[state, stop index]` outside the blend input's range — `mstopout/3`. */
	stopsOutOfRange: Array<[string, number]>;
}
```

`unreachableWithGuards` being a superset of `unreachable` is asserted in
`machines.test.ts` on every shape it builds, not merely believed: it is the
TypeScript half of §7.2's inclusion proof, and the two halves being tested the
same way on both sides is what keeps them honest with each other.

### 6.2 `model.ts` — the answer set's

```ts
/** One keyframe copy, as one answer set describes it. The twin of {@link ModelState}. */
export interface ModelKeyframe {
	instance: string;
	timeline: string;
	/** The track term, `trkp(...)` or `trkd(...)`. */
	track: string;
	/** 1-based, in time order. */
	index: number;
	/** The millisecond this universe put it at. */
	at: number;
	/** Relative to the parent, with solved geometry folded in, as `ModelState.frame` is. */
	frame: Frame;
	/**
	 * **AMENDED (merged-plan §6.5): two new optional fields**, `spatial?:
	 * SpatialFrame` and `turn?: Record<Turn, number>`, exactly the pair
	 * `ModelNode` and `ModelState` gain from the 3D track and for the same
	 * reason. A keyframe copy of a mesh that carries only four numbers is a pose
	 * the canvas cannot draw. Absent on every keyframe of every flat document.
	 */
	spatial?: SpatialFrame;
	turn?: Record<Turn, number>;
	rendered: Partial<Record<PropName, string>>;
	easing: Easing;
}

/** One timeline, as one answer set describes it. */
export interface ModelTimeline {
	/** Milliseconds — `mtlen/3`. */
	length: number;
	loop: LoopMode;
	/** Track term -> its keyframes, in time order, with times and literals. */
	tracks: Record<string, Array<{ index: number; at: number; value: string; easing: Easing }>>;
}

export interface ModelMachine {
	// … the seven that shipped, unchanged …
	/** Transition id -> the exit time this universe resolved it to. */
	exit: Record<string, number>;
	/** Transitions whose guard cannot be satisfied — `mguardnever/2`. */
	impossible: string[];
	/** States no *feasible* chain of transitions reaches — `mgunreached/2`. */
	unreachableWithGuards: string[];
	/** Transitions that name a reserved id in the wrong position — `mmisplaced/2`. */
	misplaced: string[];
	/** `[layer, layer, part, prop]` — `mfight/5`. */
	fights: Array<[string, string, string, string]>;
	/** `[layer, layer, part, dim]` — `mffight/5`. */
	frameFights: Array<[string, string, string, string]>;
	/** `[state, stop]` pairs outside the blend input's range — `mstopout/3`. */
	stopsOutOfRange: Array<[string, number]>;
	/** Timeline id -> what this universe made of it. */
	timelines: Record<string, ModelTimeline>;
}

export interface ModelScene {
	// … unchanged …
	/**
	 * Every keyframe copy a rule asked for, by its whole `kfr(I,W,R,K)` term.
	 *
	 * Beside {@link states} and not folded into it, because they answer different
	 * questions: a state copy is a pose the machine settles in, a keyframe copy
	 * is a pose it passes through, and a reader that wanted "every pose" would
	 * still have to know which was which to draw either.
	 */
	keyframes: Record<string, ModelKeyframe>;
	/**
	 * Which state each instance is drawn in, per layer: instance -> layer ->
	 * state.
	 *
	 * {@link shown} is **kept** and is the first layer's, which is what every
	 * existing reader is asking about and what the shipped `solvedView` uses
	 * while `byId` is being built.
	 */
	shownByLayer: Record<string, Record<string, string>>;
}
```

`collect` gains cases for `mexit/3`, `mguardnever/2`, `mgunreached/2`,
`mmisplaced/2`, `mfight/5`, `mffight/5`, `mstopout/3`, `mkat/5`, `mtlen/3`,
`mloop/3`, `mslayer/3`, `mlindex/3` and `mkeasing/5`, and gathers `frame/3` and
`rendered/3` for any id `parseKeyCopy` reads.

---

## 7. The new checks — the five the brief asked for, and a sixth

Every one derives a `viol/1` against a term the document named, through the
`custom` constraint machinery that already exists. **There is no new constraint
kind, no new panel concept and no change to `why.ts`, `relax.ts`, the unsat core
or `annotate.ts`.** They are five more entries in `MACHINE_CHECKS`, and they get
an enable switch, a name in the core, a softenable strength and a `why` for the
same reason the shipped four do: because they are constraints.

Rive ships none of these. That is the point of the rung.

### 7.1 A guard that can never be satisfied

```prolog
% Two conditions of one transition that cannot both hold — the same clash rules
% two transitions are compared with, asked of one.
mguardnever(M,T) :- mclash(M,T,T).
% ...or a window that misses the input's own declared range entirely.
mguardnever(M,T) :- mcrange(M,T,_,X,_,H), minlow(M,X,Lo), Lo > H.
mguardnever(M,T) :- mcrange(M,T,_,X,L,_), minhigh(M,X,Hi), L > Hi.
% ...or a condition that is not a condition: an input the machine has not got,
% an operator its kind does not take, a comparand that reads as no number.
mguardnever(M,T) :- mcbad(M,T,_).
```

and the clash rules, which are the whole of the arithmetic and are shared with
§7.2 and with `mnondet/3`:

```prolog
% Two windows on one input that do not meet.
mclash(M,T1,T2) :- mcrange(M,T1,_,X,L1,H1), mcrange(M,T2,_,X,L2,H2), L1 > H2.
% A hole against the point it excludes.
mclash(M,T1,T2) :- mcnot(M,T1,_,X,V), mcrange(M,T2,_,X,V,V).
% Two booleans that disagree.
mclash(M,T1,T2) :- mcis(M,T1,_,X,B1), mcis(M,T2,_,X,B2), B1 != B2.
mclash(M,T1,T2) :- mcis(M,T1,_,X,B), mcisnot(M,T2,_,X,B).
mdisjoint(M,T1,T2) :- mclash(M,T1,T2).
mdisjoint(M,T1,T2) :- mclash(M,T2,T1).
moverlap(M,T1,T2) :- mfrom(M,T1,_), mfrom(M,T2,_), not mdisjoint(M,T1,T2).
```

Four clash rules and a symmetric closure. `L1 > H2` alone suffices for the window
case because the closure covers the other direction; writing both would be the
same claim twice.

```prolog
viol(machine_guards_possible) :- mguardnever(_,_).
```

> A `fired` condition on a trigger input nobody ever fires is **not** reported,
> and the omission is deliberate: what a host fires is not in the document, and a
> check that called every trigger input dead would fire on every correct machine
> the day before somebody wired the page up.

### 7.2 A state unreachable once the guards are taken into account

Strictly stronger than the shipped reachability check, and the strictness is
provable rather than hoped for.

```prolog
mfeasible(M,T) :- mtrans(M,T), not mguardnever(M,T).
mgreach(M,S)   :- mlinitial(M,_,S).
mgreach(M,S2)  :- mgreach(M,S1), mefrom(M,T,S1), mfeasible(M,T), mto(M,T,S2).
mgunreached(M,S) :- mstate(M,S), not mgreach(M,S).
```

`mgreach` walks a subset of the edges `mreach` walks, so `mgreach ⊆ mreach`, so
`munreached ⊆ mgunreached`. **Every state the shipped check calls unreachable is
also called unreachable here, and there are states this one catches that it does
not.** `machineprogram.test.ts` asserts the inclusion on every machine it builds,
which is a much better test than any single example.

Soundness, in the direction it fires: a guard `mguardnever` rejects is one no
runtime valuation can satisfy, so the edge genuinely can never be taken, so a
state this check calls unreachable genuinely is. **It is not complete in the
other direction, and that is stated rather than hidden**: a state reachable only
through a *sequence* of guards that cannot all hold in order is still called
reachable here, because tracking which valuations survive each hop is tracking
(state × valuation), which is the combinatorial explosion this whole design is
built to avoid. Refusing to guess is the house position and this is where it is
paid for.

```prolog
viol(machine_states_live) :- mgunreached(_,_).
```

### 7.3 Two layers that write the same property of the same part

```prolog
viol(machine_layers_agree) :- mfight(_,_,_,_,_).
viol(machine_layers_agree) :- mffight(_,_,_,_,_).
```

The one check on this list that a designer will switch off on purpose, and it is
built to be switched off well: it is a `custom` rule, so "these two layers may
fight over opacity and no others" is one added literal in the Rules panel and is
still the same constraint with the same switch and the same name in the core.
`machinecheck.ts`'s whole argument for `custom` over a constraint kind is being
spent here.

The panel's sentence names both layers, the part and the property, out of
`ModelMachine.fights` — which is the thing Rive cannot do and this rung exists
for. The program still draws a picture: `mwriter/4` resolved it by layer order
before this check ever ran.

### 7.4 A blend input whose range does not cover its own thresholds

```prolog
mstopout(M,S,J) :- mstopat(M,S,J,N), mblendin(M,S,X), minlow(M,X,Lo),  N < Lo.
mstopout(M,S,J) :- mstopat(M,S,J,N), mblendin(M,S,X), minhigh(M,X,Hi), N > Hi.
viol(machine_blend_in_range) :- mstopout(_,_,_).
```

A stop the input can never reach is an animation that is in the file and never
plays, which is the most expensive kind of dead code there is — it ships.

The converse is derived and **not** canned:

```prolog
% The axis extends past the outermost stop, so part of the input's range plays
% one timeline flat. Legal, sometimes meant, and worth being able to ask about.
%
% `mhasstop/2` guards both aggregates rather than being implied by `mblendin/3`,
% and it is not defensive tidiness: a blend state with an input and no stops is
% exactly what a half-built one is, and #min over nothing is #sup, which clingo
% remarks on once per blend state on every document somebody is in the middle of
% authoring. The same argument `lbiggest/2` makes with its trailing `; 0`, one
% aggregate over — except that here there is no sensible empty answer to write
% down, so the rule declines to hold at all.
mhasstop(M,S) :- mstopat(M,S,_,_).
mstoplo(M,S,N) :- mhasstop(M,S), N = #min{ V : mstopat(M,S,_,V) }.
mstophi(M,S,N) :- mhasstop(M,S), N = #max{ V : mstopat(M,S,_,V) }.
mstopgap(M,S)  :- mblendin(M,S,X), minlow(M,X,Lo),  mstoplo(M,S,N), Lo < N.
mstopgap(M,S)  :- mblendin(M,S,X), minhigh(M,X,Hi), mstophi(M,S,N), Hi > N.
```

An input with no declared range says nothing here, in both directions. That is
§1.2's absent-is-open, showing through where it matters: a check that invented a
`0`..`100` range would report violations against a claim the designer never made.

### 7.5 A transition whose exit time exceeds its own duration

```prolog
viol(machine_exit_within_duration) :- mexit(M,T,E), mdur(M,T,D), E > D.
```

**This is the check the brief asked for, worded as the brief worded it, and it is
shipped exactly so.** It is worth writing down what it does and does not catch,
because the two readings are easy to conflate:

- *What it catches*: a transition that must wait longer to become available than
  it takes to run. That is nearly always a typo — the two numbers are in adjacent
  fields in the same row — and it is the reading "its own duration" has.
- *What it does not catch, and what the deeper bug usually is*: an exit time
  longer than the `from` **state's timeline**, which makes the transition
  unreachable rather than merely odd, because the state finishes before the exit
  time elapses. That needs `mtlen/3`, which §5 supplies, and is a genuinely
  different claim.

So a **sixth** derivation and a sixth canned check ship beside it, and the
Machines panel offers both:

```prolog
mexitpast(M,T) :- mexit(M,T,E), mfrom(M,T,S), mtplays(M,S,W), mtlen(M,W,Len),
                  mloop(M,W,none), E > Len.
viol(machine_exit_before_end) :- mexitpast(_,_).
```

`mloop(M,W,none)` is in the body because a looping timeline never ends, so no
exit time is past it. Reporting one would be reporting a bug against a design
that works.

### 7.6 The six, as a table

`MACHINE_CHECKS` in `machines.ts` grows from four entries to ten, in this order —
the four graph checks first, because they are about whether the machine is a
machine at all; the five new structural ones next; the budget last, because it is
about taste. `machineChecks(budget)` in `machinecheck.ts` is unchanged in shape.

| id | label | body |
| --- | --- | --- |
| `machine_reachable` | Every state is reachable | *(shipped)* |
| `machine_no_dead_ends` | No dead ends | *(shipped)* |
| `machine_deterministic` | One edge per trigger | *(shipped, body unchanged — its meaning narrows because `mnondet/3` now consults `moverlap/3`)* |
| `machine_wired` | Every transition is wired | *(shipped, gains the `mmisplaced` disjunct)* |
| `machine_guards_possible` | Every guard can be met | `viol(…) :- mguardnever(_,_).` |
| `machine_states_live` | Every state is reachable through its guards | `viol(…) :- mgunreached(_,_).` |
| `machine_layers_agree` | No two layers write one property | two disjuncts, §7.3 |
| `machine_blend_in_range` | Every blend stop is in range | `viol(…) :- mstopout(_,_,_).` |
| `machine_exit_within_duration` | No exit time longer than its transition | §7.5 |
| `machine_exit_before_end` | No exit time past its own state | §7.5 |
| `machine_within_budget` | No transition longer than *n* | *(shipped, `machinecheck.ts`)* |

---

## 8. The exact `MACHINE_RULES` additions

Appended to the existing array in `compile.ts`, in this order, **after** the
shipped health block and before the closing bracket — except for the four
`mefrom`-threading edits, which replace shipped lines in place and are marked
`(REPLACES)`.

```prolog
#defined minput/2.
#defined minkind/3.
#defined minbool/3.
#defined minnum/3.
#defined minlow/3.
#defined minhigh/3.
#defined mcond/3.
#defined mcondin/4.
#defined mcondop/4.
#defined mcrange/6.
#defined mcnot/5.
#defined mcis/5.
#defined mcisnot/5.
#defined mcfired/4.
#defined mcbad/3.
#defined mreserved/1.
#defined mlayer/2.
#defined mlindex/3.
#defined mslayer/3.
#defined mlfirst/3.
#defined mlshadow/4.
#defined mlfshadow/4.
#defined mdefexit/1.
#defined mtimeline/2.
#defined mtplays/3.
#defined mtrack/3.
#defined mtrackof/4.
#defined mkey/4.
#defined mkeasing/5.
#defined mloop/3.
#defined mkpart/3.
#defined mblend/3.
#defined mblendin/3.
#defined mstop/4.
#defined mstopat/4.
#defined mstopby/4.
#defined permille/2.

% ---- layers ----
% A layer is an id and a position, and the position is the priority — the same
% "the order is the answer" the initial state and order/2 already use. A machine
% with no layers in the document emits one, called base, and every state is in
% it, so every rule below is the rule that shipped on such a document.
mlinitial(M,L,S) :- mlfirst(M,L,S).
mtlayer(M,T,L) :- mfrom(M,T,S), mslayer(M,S,L).
mtlayer(M,T,L) :- mfrom(M,T,R), mreserved(R), mto(M,T,S), mslayer(M,S,L).
mcrosslayer(M,T) :- mtlayer(M,T,L1), mto(M,T,S), mslayer(M,S,L2), L1 != L2.

% ---- the reserved sources and destinations ----
% Entry is sugar over the initial state, and it is a rule rather than a rewrite
% in the compiler so that a hand-written mfrom(M,t,entry) gets the same reading a
% document one does. Any is a source that stands for every state of its layer.
% Exit is a destination and derives nothing but the fact that a layer stops.
mefrom(M,T,S) :- mfrom(M,T,S), not mreserved(S).
mefrom(M,T,S) :- mfrom(M,T,entry), mlinitial(M,L,S), mtlayer(M,T,L).
manyfrom(M,T) :- mfrom(M,T,any).
mefrom(M,T,S) :- manyfrom(M,T), mstate(M,S), mslayer(M,S,L), mtlayer(M,T,L).
mstops(M,T)   :- mto(M,T,exit).
% not mreserved/1 rather than mstate/2: a pair of edges leaving a state the
% machine has lost is still a pair the designer wrote, and machines.ts records
% reporting it as intentional.
mrank(M,T,1)  :- mfrom(M,T,S), not mreserved(S).
mrank(M,T,2)  :- manyfrom(M,T).
mmisplaced(M,T) :- mfrom(M,T,exit).
mmisplaced(M,T) :- mto(M,T,entry).
mmisplaced(M,T) :- mto(M,T,any).

% ---- guards ----
% Every comparison here is between two constants: the range the input declared
% and the literal the condition named. Nothing in this block ever consults a
% runtime value, which is the whole reason an input is not a variable.
mguarded(M,T) :- mcond(M,T,_).
mclash(M,T1,T2) :- mcrange(M,T1,_,X,L1,H1), mcrange(M,T2,_,X,L2,H2), L1 > H2.
mclash(M,T1,T2) :- mcnot(M,T1,_,X,V), mcrange(M,T2,_,X,V,V).
mclash(M,T1,T2) :- mcis(M,T1,_,X,B1), mcis(M,T2,_,X,B2), B1 != B2.
mclash(M,T1,T2) :- mcis(M,T1,_,X,B), mcisnot(M,T2,_,X,B).
mdisjoint(M,T1,T2) :- mclash(M,T1,T2).
mdisjoint(M,T1,T2) :- mclash(M,T2,T1).
% Not provably disjoint. The default for two unguarded edges is overlap, which is
% what makes the deterministic check on a document with no conditions the check
% that shipped, atom for atom.
moverlap(M,T1,T2) :- mfrom(M,T1,_), mfrom(M,T2,_), not mdisjoint(M,T1,T2).
mguardnever(M,T) :- mclash(M,T,T).
mguardnever(M,T) :- mcrange(M,T,_,X,_,H), minlow(M,X,Lo), Lo > H.
mguardnever(M,T) :- mcrange(M,T,_,X,L,_), minhigh(M,X,Hi), L > Hi.
mguardnever(M,T) :- mcbad(M,T,_).
mfeasible(M,T) :- mtrans(M,T), not mguardnever(M,T).

% ---- exit time ----
% The fourth motion setting, in the shape the other three are in and clamped the
% way duration and stagger are: a negative exit time would be a transition
% takeable before its own state began.
mexit(M,T,V) :- resolved(mval(M,T,exit),L), millis(L,V), V >= 0.
mexit(M,T,0) :- resolved(mval(M,T,exit),L), millis(L,V), V < 0.
mreadsexit(M,T) :- resolved(mval(M,T,exit),L), millis(L,_).
mexit(M,T,V) :- mtrans(M,T), mdefexit(V), not mreadsexit(M,T).

% ---- guard-aware reachability ----
% A subset of mreach's edges, so munreached is a subset of mgunreached and this
% check is strictly stronger than the one that shipped. Sound where it fires and
% deliberately incomplete the other way: tracking which valuations survive each
% hop is tracking state x valuation, which is the explosion this design exists
% to avoid.
mgreach(M,S)  :- mlinitial(M,_,S).
mgreach(M,S2) :- mgreach(M,S1), mefrom(M,T,S1), mfeasible(M,T), mto(M,T,S2).
mgunreached(M,S) :- mstate(M,S), not mgreach(M,S).

% ---- who writes what, when two layers both have an opinion ----
mwriter(M,L,N,P) :- mlshadow(M,L,N,P),
                    K = #max{ J : mlshadow(M,L2,N,P), mlindex(M,L2,J) },
                    mlindex(M,L,K).
mfwriter(M,L,N,D) :- mlfshadow(M,L,N,D),
                     K = #max{ J : mlfshadow(M,L2,N,D), mlindex(M,L2,J) },
                     mlindex(M,L,K).
mfight(M,L1,L2,N,P)  :- mlshadow(M,L1,N,P), mlshadow(M,L2,N,P), L1 < L2.
mffight(M,L1,L2,N,D) :- mlfshadow(M,L1,N,D), mlfshadow(M,L2,N,D), L1 < L2.
mfightat(I,L1,L2,N,P) :- minstance(I,M), mfight(M,L1,L2,N,P),
                         shown(I,S1), mslayer(M,S1,L1),
                         shown(I,S2), mslayer(M,S2,L2).

% ---- timelines ----
% Keyframes, and nothing but keyframes. There is no frame, no frame rate and no
% time in this block that is not a keyframe's own.
mkat(M,W,R,K,V) :- resolved(kat(M,W,R,K),L), millis(L,V), V >= 0.
mkat(M,W,R,K,0) :- resolved(kat(M,W,R,K),L), millis(L,V), V < 0.
% The empty maximum, written down — the same 0 lbiggest/2 carries, and for the
% same reason: a timeline with no keyframe that reads must still have a length,
% and #max over nothing is #inf, which clingo remarks on once per timeline.
mtlast(M,W,V) :- mtimeline(M,W), V = #max{ T : mkat(M,W,_,_,T); 0 }.
mtlen(M,W,V) :- resolved(tlen(M,W),L), millis(L,V), V >= 0.
mreadstlen(M,W) :- resolved(tlen(M,W),L), millis(L,_).
mtlen(M,W,V) :- mtimeline(M,W), mtlast(M,W,V), not mreadstlen(M,W).
mkpast(M,W,R,K) :- mkat(M,W,R,K,T), mtlen(M,W,Len), T > Len.
mknext(M,W,R,K1,K2) :- mkey(M,W,R,K1), mkey(M,W,R,K2), K2 = K1 + 1.
mkbackwards(M,W,R,K2) :- mknext(M,W,R,K1,K2), mkat(M,W,R,K1,T1),
                         mkat(M,W,R,K2,T2), T2 < T1.

% A keyframe copy, where a rule asked for one. Its geometry and its paint come
% from the track where the track speaks and from the state's own copy where it
% does not — the same absent-is-inherit every other copy in this program uses.
mkcopy(I,W,R,K) :- minstance(I,M), mkey(M,W,R,K), mtrackof(M,W,R,N), mkpart(M,W,N).
frame(kfr(I,W,R,K),D,V) :- mkcopy(I,W,R,K), R = trkd(_,D),
                           resolved(kval(M,W,R,K),L), minstance(I,M), numeral(L,V).
frame(kfr(I,W,R,K),D,V) :- mkcopy(I,W,R,K), mtrackof(M,W,R,N), minstance(I,M),
                           mtplays(M,S,W), frame(stt(I,S,N),D,V),
                           not mkeydim(I,W,R,K,D).
mkeydim(I,W,R,K,D) :- mkcopy(I,W,R,K), R = trkd(_,D),
                      minstance(I,M), resolved(kval(M,W,R,K),L), numeral(L,_).
rendered(kfr(I,W,R,K),P,L) :- mkcopy(I,W,R,K), R = trkp(_,P),
                              minstance(I,M), resolved(kval(M,W,R,K),L).
rendered(kfr(I,W,R,K),P,L) :- mkcopy(I,W,R,K), mtrackof(M,W,R,N), minstance(I,M),
                              mtplays(M,S,W), rendered(stt(I,S,N),P,L),
                              not mkeyprop(I,W,R,K,P).
mkeyprop(I,W,R,K,P) :- mkcopy(I,W,R,K), R = trkp(_,P),
                       minstance(I,M), resolved(kval(M,W,R,K),_).
% Parented where its part is, for gworld/2's chain — the same rule shape a state
% copy gets and for the same reason. A keyframe copy hangs off the *instance*
% tree, never off a state copy and never off another keyframe copy.
child(inst(I,P),kfr(I,W,R,K)) :- mkcopy(I,W,R,K), mtrackof(M,W,R,N),
                                 minstance(I,M), instance(I,Root), cinner(Root,N),
                                 child(P,N), cpart(Root,P).
child(I,kfr(I,W,R,K)) :- mkcopy(I,W,R,K), mtrackof(M,W,R,N), minstance(I,M),
                         instance(I,N).

% ---- blend states ----
mstopout(M,S,J) :- mstopat(M,S,J,N), mblendin(M,S,X), minlow(M,X,Lo),  N < Lo.
mstopout(M,S,J) :- mstopat(M,S,J,N), mblendin(M,S,X), minhigh(M,X,Hi), N > Hi.
mhasstop(M,S) :- mstopat(M,S,_,_).
mstoplo(M,S,N) :- mhasstop(M,S), N = #min{ V : mstopat(M,S,_,V) }.
mstophi(M,S,N) :- mhasstop(M,S), N = #max{ V : mstopat(M,S,_,V) }.
mstopgap(M,S) :- mblendin(M,S,X), minlow(M,X,Lo),  mstoplo(M,S,N), Lo < N.
mstopgap(M,S) :- mblendin(M,S,X), minhigh(M,X,Hi), mstophi(M,S,N), Hi > N.
mtwosource(M,S) :- mtplays(M,S,_), mblend(M,S,_).
mexitpast(M,T) :- mexit(M,T,E), mfrom(M,T,S), mtplays(M,S,W), mtlen(M,W,Len),
                  mloop(M,W,none), E > Len.
```

### 8.1 The shipped lines that are replaced

Five, and each is the shipped line with one more literal or one renamed
predicate. **On a document with no reserved id, no condition and one layer, every
one of them derives exactly the atoms it derived before**, which is step L4's
first test and the whole no-regression argument.

```prolog
% (REPLACES) the shipped shown/2 default pair. L threaded through; the guard is
% unchanged in shape, because the default must not be the reason the default
% stops applying.
mstated(I,L) :- minstance(I,M), shown(I,S), mslayer(M,S,L), not mlinitial(M,L,S).
shown(I,S)   :- minstance(I,M), mlinitial(M,L,S), not mstated(I,L).

% (REPLACES) mreach's seed. Every layer starts somewhere; on one layer this is
% minitial/2.
mreach(M,S) :- mlinitial(M,_,S).

% (REPLACES) mreach's step and mleaves, which now walk the *effective* source, so
% that an Any edge leaves every state of its layer and an Entry edge leaves the
% initial one.
mreach(M,S2) :- mreach(M,S1), mefrom(M,T,S1), mto(M,T,S2).
mleaves(M,S) :- mefrom(M,_,S).

% (REPLACES) mnondet. Two edges on one trigger are only nondeterministic when
% their guards can both hold and neither outranks the other. With no conditions
% moverlap is always true and with no Any edge every rank is 1, so this is the
% shipped rule on every document that has neither.
mnondet(M,S,G) :- mefrom(M,T1,S), mefrom(M,T2,S), T1 < T2,
                  mtrigger(M,T1,G), mtrigger(M,T2,G),
                  moverlap(M,T1,T2), mrank(M,T1,R), mrank(M,T2,R).

% (REPLACES) mdangling, exempting the three reserved ids. A reserved id in the
% wrong position is mmisplaced/2 instead, because "this edge names a state you
% deleted" and "this edge tries to leave Exit" are two mistakes and a designer
% fixes them two ways.
mdangling(M,T) :- mfrom(M,T,S), not mstate(M,S), not mreserved(S).
mdangling(M,T) :- mto(M,T,S), not mstate(M,S), not mreserved(S).

% (REPLACES) mtwoshown. Per layer.
mtwoshown(I) :- minstance(I,M), shown(I,S1), shown(I,S2), S1 < S2,
                mslayer(M,S1,L), mslayer(M,S2,L).

% (REPLACES) the three alias rules, guarded by which layer owns the field.
frame(inst(I,N),D,V) :- frame(stt(I,S,N),D,V), shown(I,S),
                        minstance(I,M), mslayer(M,S,L), mfwriter(M,L,N,D).
rendered(inst(I,N),P,L) :- rendered(stt(I,S,N),P,L), shown(I,S),
                           minstance(I,M), mslayer(M,S,Lay), mwriter(M,Lay,N,P).
```

`hidden(inst(I,N)) :- mhidden(I,S,N), shown(I,S).` is **not** replaced. Hiding is
monotone and two layers that both hide agree.

### 8.2 Output

```prolog
#show mexit(M,T,V) : mexit(M,T,V), scenery.
#show mguardnever(M,T) : mguardnever(M,T), scenery.
#show mgunreached(M,S) : mgunreached(M,S), scenery.
#show mmisplaced(M,T) : mmisplaced(M,T), scenery.
#show mfight(M,L1,L2,N,P) : mfight(M,L1,L2,N,P), scenery.
#show mffight(M,L1,L2,N,D) : mffight(M,L1,L2,N,D), scenery.
#show mstopout(M,S,J) : mstopout(M,S,J), scenery.
#show mstopgap(M,S) : mstopgap(M,S), scenery.
#show mtwosource(M,S) : mtwosource(M,S), scenery.
#show mexitpast(M,T) : mexitpast(M,T), scenery.
#show mkbackwards(M,W,R,K) : mkbackwards(M,W,R,K), scenery.
#show mslayer(M,S,L) : mslayer(M,S,L), scenery.
#show mlindex(M,L,K) : mlindex(M,L,K), scenery.
#show mkat(M,W,R,K,V) : mkat(M,W,R,K,V), scenery.
#show mtlen(M,W,V) : mtlen(M,W,V), scenery.
#show mloop(M,W,Mode) : mloop(M,W,Mode), scenery.
#show mkeasing(M,W,R,K,E) : mkeasing(M,W,R,K,E), scenery.
% Motion is a design decision like a gap, and an exit time is motion: a
% `duration` token with two alternatives really is two designs, and without this
% they differ in nothing projected and collapse into one universe with an
% arbitrary pick. Same argument mdur/3 already carries, one setting over.
#project mexit/3.
% ...and a keyframe's time and its value are the same argument again. A timeline
% whose overshoot is at `--beat` is two timelines when `--beat` holds two
% alternatives, and they are two designs a person can watch.
#project mkat/5.
#project mtlen/3.
```

A keyframe copy's `frame/3` and `rendered/3` reach the answer set through the
existing generic `#show`s, exactly as a state copy's do.

> **AMENDED (merged-plan §8) — three projections are missing, and one of them is
> a shipped bug this rung inherits rather than causes.**
>
> `f_value/3` is projected, which is what makes "this card is in one of two
> places" two universes. **`sfval(I,S,N,D)` has no such derivation and is
> projected by nothing** — so today, a state delta whose `y` holds two
> alternatives is *one* universe with an arbitrary pick, and the two designs a
> designer wrote collapse. (A state's *paint* deltas are fine: they reach
> `rendered/3`, which is projected.) This rung adds `kval` and the 3D track adds
> `srval` to the same un-projected family, so "the overshoot goes one of two
> distances" and "the card tilts one of two ways on hover" would collapse the same
> way.
>
> ```prolog
> sf_value(I,S,N,D,L) :- resolved(sfval(I,S,N,D),L).
> sr_value(I,S,N,R,L) :- resolved(srval(I,S,N,R),L).
> kf_value(M,W,R,K,L) :- resolved(kval(M,W,R,K),L).
> #project sf_value/5.  #project sr_value/5.  #project kf_value/5.
> ```
>
> **Gated**, and the gate is not optional: no template's universe count may move.
> It does not — every state delta in `templates/machine.ts` is built with
> `single(...)`, so each of these variables has one alternative and the finer
> projection partitions nothing differently — but that is a fact about today's
> templates and has to be re-checked rather than assumed. If a count moves, this
> comes out and becomes its own change with its own golden update, because the
> no-regression invariant outranks a bug fix.

**`minput/2` and its five companions are shown by nothing and projected by
nothing.** That is not an omission. An input is a fact the document already
holds, the panel reads it from the document, and showing it would put a value in
the model that no reader could do anything with. If a step finds itself wanting
`#show minput`, the question it is really asking is a question about the
document, and `machines.ts` is where document questions are answered.

---

## 9. Runtime, table and export

### 9.1 `MachineTable` — the shape both interpreters read

Changed in three places, and every change is breaking in the type system and
caught by `tsc` on the two readers, which is the intended way to make it:

```ts
export interface MachineTable {
	instances: Record<string, {
		machine: string;
		/**
		 * Layer id -> the state this instance starts in. **Replaces the single
		 * `initial: string`**, because an instance is now in one state per layer
		 * and a single string cannot say that. A one-layer machine's entry is a
		 * record of one, which is one more brace in the JSON and no more.
		 */
		initial: Record<string, string>;
	}>;
	machines: Record<string, {
		/** Layer id -> what it starts in and where its edges go. In order. */
		layers: Array<{
			id: string;
			initial: string;
			states: string[];
			/**
			 * from -> trigger -> the edges to try, in order. **A list rather than
			 * one destination**, because a guard can refuse and the next edge has
			 * to get its turn. Specific edges first, then Any edges, document
			 * order within each.
			 */
			edges: Record<string, Partial<Record<Trigger, RuntimeEdge[]>>>;
		}>;
		inputs: Record<string, {
			kind: InputKind;
			initial?: boolean | number;
			min?: number;
			max?: number;
		}>;
	}>;
}

export interface RuntimeEdge {
	/** The state it goes to, or `null` where it stops the layer. */
	to: string | null;
	/** Every condition, all of which must hold. Absent is unguarded. */
	when?: Array<{ input: string; op: CompareOp; value?: boolean | number }>;
	/** Milliseconds the from-state must have been held. Absent is zero. */
	exit?: number;
}
```

Two things are deliberately still absent from the table: durations, delays and
staggers (the CSS carries them, and the runtime is not an animator — the shipped
`runtime.ts` argues this at length and nothing here changes it), and anything to
do with timelines (a timeline is `@keyframes` in the file; the runtime switches
classes and the compositor plays them).

`exit` is the one number that had to be added, and it is a *gate* rather than a
schedule: the runtime reads a clock, never sets one, and a grep for `setTimeout`
in `MACHINE_RUNTIME` must still come up empty. Step L9's test asserts that as a
string search over `MACHINE_RUNTIME` itself.

### 9.2 `machines.ts` — the shared behaviour

```ts
/** What a host has set, per instance: input id -> value. Triggers are not here. */
export type InputValues = Readonly<Record<string, boolean | number>>;

/**
 * Whether one edge may be taken right now.
 *
 * Split out of {@link stepLayer} because it is the one piece three callers
 * need — the studio, the emitted runtime and `machinecheck`'s explanation of a
 * refusal — and because a guard that is evaluated in two places is a guard that
 * can be evaluated two ways.
 */
export function edgeAllows(
	edge: RuntimeEdge,
	inputs: InputValues,
	fired: ReadonlySet<string>,
	heldMs: number,
): boolean;

/**
 * Where one trigger takes one *layer*, or nothing where it takes it nowhere.
 *
 * `null` is a distinguishable answer from `undefined` and the distinction
 * matters: `undefined` is "nothing moved", `null` is "the layer stopped", and a
 * caller that conflated them would keep listening to a machine that has said it
 * is finished.
 */
export function stepLayer(
	table: MachineTable,
	instance: string,
	layer: string,
	current: string,
	trigger: Trigger,
	inputs?: InputValues,
	fired?: ReadonlySet<string>,
	heldMs?: number,
): string | null | undefined;

/**
 * Where one trigger takes one instance: every layer stepped, in layer order.
 *
 * **Replaces the shipped `stepMachine`**, whose signature took a single current
 * state and returned a single one. The old shape cannot express a machine with
 * two layers and there is no honest adapter, so it goes rather than acquiring a
 * second meaning. The name is kept because the thing it does is the thing it
 * did.
 */
export function stepMachine(
	table: MachineTable,
	instance: string,
	current: Readonly<Record<string, string>>,
	trigger: Trigger,
	inputs?: InputValues,
	fired?: ReadonlySet<string>,
	heldMs?: Readonly<Record<string, number>>,
): Record<string, string> | undefined;
```

### 9.3 `MACHINE_RUNTIME`

Gains, and nothing else:

- an input store per instance, seeded from `T.machines[m].inputs`;
- `setInput(instance, id, value)` and `fireInput(instance, id)`, both on the
  returned handle, both clamped to the declared range where there is one;
- `heldAt`, a `{instance: {layer: timestamp}}` written on every state change and
  read by the exit-time gate;
- guard evaluation, in one function, mirroring `edgeAllows` line for line;
- per-layer `data-state`: the **first** layer writes `data-state`, and every
  further layer writes `data-state-<layer id>`. A one-layer file is therefore
  byte-identical to the one that ships today, which is the whole reason for the
  asymmetry.

`RuntimeHandle` gains `setInput`, `fireInput`, `inputs` and `stopped`.

`runtime.test.ts`'s agreement test is extended rather than replaced: the emitted
text's `step` is driven with every `(layer, state, trigger, input valuation)`
combination of a three-layer machine with two boolean inputs, and compared
against `stepLayer`. That is the test that keeps "the studio and the file behave
the same" true, and it is the reason `edgeAllows` is a named function rather than
four lines inlined twice.

### 9.4 `export.ts`

- `StateLayer` gains `layer: string`, and `on` for a further layer is
  `'[data-state-<layer>="open"]'`.
- Layers are emitted in document order, so the cascade resolves a fight the same
  way `mwriter/4` does. That agreement is asserted, not assumed:
  `export.test.ts` builds a two-layer fight and checks that the property the file
  ends up with is the one `readModel` reports on `inst(I,N)`.
- A timeline becomes a `@keyframes` block per (instance, timeline), with each
  keyframe's percentage `100 * mkat / mtlen` — an integer percentage rounded
  once, at the emitter, with the rounding named in the loss where it is not
  exact. Loop mode becomes `animation-iteration-count` / `animation-direction`.
- A blend state carries **one stop** and a `lost` entry that says which, §5.6.
- New `lost` entries: the blend one; an exit time on a transition whose state has
  no timeline (`"…the file gates on elapsed time in script; a reader of the CSS
  alone will not see it"`); and a keyframe past its own timeline's length.
- `EXPORT_TARGETS.svg.loses` gains: `"Inputs, guards and timelines. An SVG has
  no clock and no host to set a value from."`

---

## 10. React — the exact props

`onSceneChange` everywhere has the studio's shape:
`(next: (prev: Scene) => Scene, coalesce?: string) => void`.

### 10.1 New: `packages/app/src/design/Inputs.tsx`

```tsx
export interface InputsProps {
	scene: Scene;
	machine: Machine;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/**
	 * What the preview currently holds for the instance on screen — editor
	 * state, never the document's. An input is a runtime value and driving one
	 * costs no solve, so this never lands in undo.
	 */
	values: InputValues;
	/** Set a persistent input. */
	onSet: (input: string, value: boolean | number) => void;
	/** Fire a momentary one. */
	onFire: (input: string) => void;
	/** Inputs no guard in the machine reads, so a row can say it is unused. */
	unread?: ReadonlySet<string>;
}

export function Inputs(props: InputsProps): JSX.Element;
```

### 10.2 New: `packages/app/src/design/Conditions.tsx`

```tsx
export interface ConditionsProps {
	machine: Machine;
	transition: Transition;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/** True where the answer set says this whole guard can never be met. */
	impossible?: boolean;
	/** Condition indices the compiler could not read at all — `mcbad/3`. */
	bad?: ReadonlySet<number>;
}

export function Conditions(props: ConditionsProps): JSX.Element;
```

### 10.3 New: `packages/app/src/design/LayerStrip.tsx`

Named `LayerStrip` and not `Layers`, because `LayerList.tsx` is the document's
layer list and two panels called Layers in one studio is a UI nobody can be
directed around.

```tsx
export interface LayerStripProps {
	machine: Machine;
	/** Layer id -> the state the subject is in. */
	shown: Readonly<Record<string, string>>;
	/** Layer id -> the state the canvas is playing, if any. */
	playing?: Readonly<Record<string, string>>;
	/** Layers the answer set says are fighting, so a row can be marked. */
	fighting?: ReadonlySet<string>;
	onAdd?: () => void;
	onRename?: (layer: string, name: string) => void;
	onDelete?: (layer: string) => void;
	onReorder?: (layer: string, to: number) => void;
}

export function LayerStrip(props: LayerStripProps): JSX.Element;
```

### 10.4 New: `packages/app/src/design/Timeline.tsx`

```tsx
export interface TimelineProps {
	scene: Scene;
	machine: Machine;
	timeline: Timeline;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	picks: Picks;
	varying: ReadonlySet<string>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	/** What this universe made of it: lengths, keyframe times, per-track values. */
	solved?: ModelTimeline;
	/** Keyframes that resolved out of order or past the end. */
	suspect?: ReadonlySet<string>;
	/**
	 * Where the scrubber is, in milliseconds. Editor state. The canvas lerps
	 * between the two keyframes either side of it, out of the answer set it
	 * already has, so scrubbing costs no solve.
	 */
	at: number;
	onScrub: (ms: number) => void;
}

export function Timeline(props: TimelineProps): JSX.Element;
```

### 10.5 Changed: `useMachinePlayback.ts`

```tsx
export interface Playback {
	/** Instance -> layer -> the state the canvas is drawing. */
	playing: Readonly<Record<string, Readonly<Record<string, string>>>>;
	/** Instance -> input id -> value. */
	inputs: Readonly<Record<string, InputValues>>;
	/** Drive one layer of one instance; null hands that layer back to the document. */
	play: (instance: string, layer: string, state: string | null) => void;
	setInput: (instance: string, input: string, value: boolean | number) => void;
	/** Fire a momentary input: true for this evaluation and gone afterwards. */
	fireInput: (instance: string, input: string) => void;
	/**
	 * Feed a trigger at an instance and follow whatever edges it opens, in every
	 * layer. Returns the layers that moved, or null if nothing did.
	 *
	 * The same `stepMachine` the exported runtime interprets, so watching it in
	 * the studio and clicking it in a browser cannot disagree — including about
	 * a guard, which is why {@link edgeAllows} is a shared function and not two.
	 */
	fire: (instance: string, trigger: Trigger) => Record<string, string> | null;
	/** Where the timeline scrubber is, per instance. */
	scrub: Readonly<Record<string, number>>;
	setScrub: (instance: string, ms: number) => void;
	clear: () => void;
}

export function useMachinePlayback(scene: Scene): Playback;
```

### 10.6 Changed props on existing components

**`MachinesProps`** gains exactly five:

```tsx
	/** Instance -> input id -> value the preview holds. Editor state. */
	inputs: Readonly<Record<string, InputValues>>;
	onSetInput: (instance: string, input: string, value: boolean | number) => void;
	onFireInput: (instance: string, input: string) => void;
	/** Which layer the panel's strips are showing. Editor state, held by Studio. */
	layer?: string;
	onLayerChange?: (layer: string) => void;
```

and `playing` changes shape to `Record<string, Record<string, string>>` and
`onPlay` to `(instance: string, layer: string, state: string | null) => void`.

**`StateStripProps`** gains exactly two, and keeps everything else:

```tsx
	/** Show only the states of this layer. Absent is the first layer's. */
	layer?: string;
	/** States the *guard-aware* reachability calls unreachable, greyed harder. */
	deadWithGuards?: ReadonlySet<string>;
```

**`TransitionsProps`**: `timing` gains an `exit` member per transition, and it
gains three:

```tsx
	/** Transitions whose guard can never be met — `mguardnever/2`. */
	impossible?: ReadonlySet<string>;
	/** Transitions naming a reserved id in the wrong position. */
	misplaced?: ReadonlySet<string>;
	/** Show only the transitions of this layer. Absent is all of them. */
	layer?: string;
```

**`ArtboardProps.playing`** changes shape to
`Readonly<Record<string, Readonly<Record<string, string>>>>` — instance, then
layer.

**`ConstraintsProps.stateMembers`** is joined by
`keyframeMembers?: readonly string[]`, listing the `kfr(...)` terms a rule may
name, exactly as `stateMembers` lists the `stt(...)` ones.

**`Studio.tsx`**: no new panel tab. Inputs, conditions, layers and timelines all
live inside the **States** panel, because they are all parts of one machine and a
fifth tab would make "edit this machine" a thing spread across two places. The
label chain at the two sites gains one more link:
`byId.get(n)?.name ?? partLabel(…) ?? datumLabel(…) ?? stateLabel(…) ?? keyCopyLabel(scene,n) ?? n`.

No other prop on any existing component changes.

---

## 11. The CONTRACT block — exact text to add

Appended to the `% State machines.` section in `compile.ts`, immediately before
its closing paragraph (`% A machine changes appearance, geometry and presence.`),
which stays where it is and stays true.

````
% Inputs. What a host hands a machine from outside: a boolean, a number or a
% momentary trigger. These are RUNTIME values and they are not in the design
% space — no atom below is ever an alt/2, nothing here gets a pick/2, and a
% document with an input has exactly the universe count of one without. Nothing
% projected depends on an input at all: shown/2 is a fact the document emits, so
% which state is *drawn* never consults one. What an input decides is which
% transitions a runtime may take, and — through the guards below — which of them
% are possible at all, which is a claim about the document rather than a picture.
%
%   minput(M, X)                   X is an input of machine M
%   minkind(M, X, boolean|number|trigger)
%   minbool(M, X, true|false)      a boolean input's starting value
%   minnum(M, X, N)                a number input's, in THOUSANDTHS
%   minlow(M, X, N)  minhigh(M, X, N)
%                                  the closed ends of a number input's range.
%                                  Absent is OPEN, not zero: a designer who has
%                                  not said how far the drawer opens has not said
%                                  that it does not open
%
%   permille(Lit, N)               the fifth literal bridge: the RATIO a literal
%                                  reads as, in thousandths. "0.5" is 500 and
%                                  "12" is 12000. Exact or absent, like
%                                  numeral/2 and millis/2 — "0.0005" is not a
%                                  whole thousandth and emits nothing. A
%                                  percentage is refused rather than divided:
%                                  declare the range 0..100 and every number in
%                                  the machine is in one unit
%
% Guards. A transition fires when its trigger happens AND every one of its
% conditions holds. There is no `or`; two guards that are alternatives are two
% transitions, which is one more id a violation can name. Every comparison here
% is between two CONSTANTS — the range the input declared and the literal the
% condition named — so nothing in this block ever evaluates a runtime value:
%
%   mcond(M, T, K)                 T's Kth condition, 1-based, document order
%   mcondin(M, T, K, X)            about input X
%   mcondop(M, T, K, eq|ne|gt|lt|ge|le|fired)
%   mcrange(M, T, K, X, Lo, Hi)    a numeric condition as a CLOSED window in
%                                  thousandths. `x > v` is [v+1, ..] and that is
%                                  exact rather than approximate, because a
%                                  thousandth is a whole number of something
%   mcnot(M, T, K, X, N)           a numeric `ne`: the one value it excludes. Not
%                                  a window, because a hole is not an interval
%   mcis / mcisnot(M, T, K, X, B)  a boolean condition
%   mcfired(M, T, K, X)            a trigger condition
%   mcbad(M, T, K)                 a condition that is not one: an input the
%                                  machine has not got, an operator its kind does
%                                  not take, a comparand that reads as nothing
%   mclash(M, T1, T2)              derived: some condition of each cannot both
%                                  hold. Asked of one transition against itself
%                                  it is an impossible guard
%   moverlap(M, T1, T2)            derived: NOT provably disjoint. Two unguarded
%                                  edges overlap, which is what keeps
%                                  mnondet/3 the rule it was
%   mguardnever(M, T)              derived: this guard can never be met
%   mfeasible(M, T)                derived: and the ones that can
%   mval(M, T, exit)  mexit(M, T, Ms)
%                                  the fourth motion setting: how long T's `from`
%                                  state must have been held before T may be
%                                  taken. A trigger arriving early is DROPPED,
%                                  not deferred — there is no timer in the
%                                  exported runtime and there is not going to be
%
% Entry, Exit and Any. Three reserved ids, legal only as a transition's end and
% never as a state — a state is a delta over the definition's parts, and these
% three have no appearance to have a delta of:
%
%   mreserved(entry) mreserved(exit) mreserved(any)
%   mefrom(M, T, S)                derived: what an edge may be taken FROM. An
%                                  ordinary edge from S; an entry edge from the
%                                  initial state (entry is sugar over `load`,
%                                  which this program already had); an any edge
%                                  from every state of its own layer
%   manyfrom(M, T)  mstops(M, T)   derived: an Any edge; an edge that stops a
%                                  layer
%   mrank(M, T, 1|2)               derived: specific beats Any, which is Rive's
%                                  rule and the only one that makes a fallback a
%                                  fallback
%   mmisplaced(M, T)               derived: a reserved id in the wrong position
%
% Layers. A machine has one or more, they all run at once, and each is in
% exactly one state at a time. This is where copies pay for themselves: two
% layers are two shown/2 facts in ONE answer set, where a choice rule would have
% been a product of universes and the question "does the glow line up when the
% button is also pressed" would have had nowhere to be asked.
%
%   mlayer(M, L)   mlindex(M, L, K)
%                                  L is M's Kth layer. THE ORDER IS THE
%                                  PRIORITY — no priority field to disagree with
%                                  the list, the way order/2 has no onTop flag
%   mslayer(M, S, L)               state S belongs to layer L. State ids stay
%                                  unique per MACHINE, so stt(I,S,N) is unchanged
%                                  and every rule a designer has already written
%                                  about a state copy still says what it said
%   mlinitial(M, L, S)             derived: the state a layer starts in
%   mtlayer(M, T, L)               derived: the layer a transition belongs to
%   mlshadow(M, L, N, P)           some state of L owns property P of part N
%   mwriter(M, L, N, P)            derived: the layer that actually decides it —
%                                  the LAST one that owns it. That is Rive's
%                                  resolution and it is here because the program
%                                  must draw a picture: two literals for one
%                                  rendered/3 is not two designs, it is one
%                                  arbitrary answer, silently
%   mfight(M, L1, L2, N, P)        derived: and the fact that there was a
%                                  decision to make. THIS is the thing Rive
%                                  cannot do — the two layers, by name, in a
%                                  core, with a switch and a why:
%
%   viol(machine_layers_agree) :- mfight(_,_,_,_,_).
%
% Timelines. Keyframes over time, per property, per part. THE SOLVER DECIDES
% KEYFRAMES AND NEVER FRAMES: grounding scales with how many keyframes a document
% holds and with nothing else, and there is no frame rate in this program, this
% model or this export. What happens between two keyframes is interpolated by
% the compositor in the file and by the canvas in the studio, and costs no solve
% in either.
%
%   mtimeline(M, W)   mtplays(M, S, W)
%   trkp(N, P)  trkd(N, D)         a track: part N's property, or its dimension
%   mtrack(M, W, R)  mtrackof(M, W, R, N)
%   mkey(M, W, R, K)               R's Kth keyframe, 1-based, in time order
%   kat(M, W, R, K)                the variable its TIME is — a duration Value,
%                                  so a keyframe can name the same motion scale
%                                  everything else does
%   kval(M, W, R, K)               the variable its VALUE is — an ordinary Value,
%                                  so a keyframe colour may name a token and two
%                                  alternatives in one really are two designs
%   mkat(M, W, R, K, Ms)  mtlen(M, W, Ms)
%                                  derived: what this universe made of them
%   mkbackwards(M, W, R, K)        derived: a keyframe that resolved BEFORE its
%                                  predecessor. Not a thing a linter over the
%                                  document could catch, because it is a
%                                  universe's answer rather than a document's
%   kfr(I, W, R, K)                a keyframe copy: instance I's pose of that
%                                  track at that keyframe. **Never a node/1**,
%                                  for stt/3's reasons, and minted ONLY where a
%                                  rule names one — a timeline on its own costs
%                                  two variables per keyframe and no copies at
%                                  all
%
% Blend states. Several timelines mixed by a number input. The mixing is
% arithmetic over a runtime value, so NONE of it is solved and none of it can be:
%
%   mblend(M, S, 1d|direct)  mblendin(M, S, X)
%   mstop(M, S, J, W)  mstopat(M, S, J, N)  mstopby(M, S, J, X)
%   mstopout(M, S, J)              derived: a stop outside its input's own range
%                                  — an animation that is in the file and can
%                                  never play
%   mstopgap(M, S)                 derived: the range extends past the outermost
%                                  stop, so part of the axis plays one timeline
%                                  flat. Legal, sometimes meant, derived anyway
````

Two existing lines gain a clause:

- Under **State machines**, `shown(I, S)` gains: `"…one per LAYER, so a
  multi-layer machine has several and mtwoshown/1 only reports two of the same
  layer"`.
- Under **State machines**, the `frame(inst(I,N),D,V) :- …` alias lines gain:
  `"…and only for the field the layer that writes it owns — see mwriter/4"`.

---

## 12. File ownership

> **SUPERSEDED — use `docs/merged-plan.md` §3.3.** The table below is kept for
> its per-step *content*, which is still the contract for what gets built; its
> *ownership* is void, because nine of these files are also claimed by
> `docs/three-d-spec.md` and two agents cannot edit one file. The merged table
> folds each contested file into one step with one owner, and fixes the order:
> **the 3D track's `compile.ts` step lands before L4's**, because it widens the
> vocabulary tables every rule in §8 quantifies over — writing §8 against the
> narrower tables means re-guarding seven of its own rules afterwards.
>
> Two rows are wrong on their own terms as well. **L1 is not "the fifth
> quantity":** `ratio` has been a quantity since `numeralOf`, and `permilleOf` is
> its integer-boundary reader, the way `emuOf` is `length`'s — which is exactly
> what §1.3 says. The only new quantity in this merge is `angle`, from the 3D
> track. The row is renamed *"The ratio bridge"*. And **L15's claim on
> `Artboard.tsx` and `Constraints.tsx`** collides with the 3D track's steps 11
> and 12; merged-plan M18 and M19 own those files and write both halves.

**Touch only the files your step owns.** A step that needs a symbol another step
owns writes against the signature in this document and does not go and add it.

| # | Step | Owns |
| --- | --- | --- |
| L1 | **The ratio bridge** *(not "the fifth quantity" — see above)* — `permilleOf`, `nearestPermille`, `writePermille`, `MAX_PERMILLE`, `isRatioType`, and the `keyTimeVar`/`keyValueVar`/`timelineLenVar` keys | `packages/design-core/src/values.ts`, `values.test.ts` |
| L2 | **The document types** — `InputKind`, `INPUT_KINDS`, `MachineInput`, `CompareOp`, `COMPARE_OPS`, `Condition`, `Transition.conditions`/`.exit`, `MOTION_PROPS.exit`, `MachineLayer`, `MachineState.layer`/`.timeline`/`.blend`, `Keyframe`, `Track`, `Timeline`, `LoopMode`, `Blend`, `BlendKind`, `BLEND_KINDS`, `BlendStop`, `Machine.inputs`/`.layers`/`.timelines`, `SceneNode.states` | `packages/design-core/src/scene.ts` |
| L3 | **The reading** — `machineLayers`, `layerOf`, `layerInitial`, `shownStates`, `trackProp`/`trackDim`/`parseTrack`, `keyCopy`/`parseKeyCopy`, `keyframeParts`, `keyframeLabel`/`keyCopyLabel`, `edgeAllows`, `stepLayer`, the new `stepMachine`, the new `machineTable`, `MachineHealth`'s six new members (§6.1), the six new `MACHINE_CHECKS` | `packages/design-core/src/machines.ts`, `machines.test.ts`, `index.ts` |
| L4 | **The program** — every fact in §1.4/§2.4/§4.2/§5.4, the whole of §8, the §11 CONTRACT text, `variableCounts` and `unreadVariables` for `kat`/`kval`/`tlen` | `packages/design-core/src/compile.ts`, `machineprogram.test.ts` |
| L5 | **Reading it back** — `ModelKeyframe`, `ModelTimeline`, `ModelMachine`'s eight new members, `ModelScene.keyframes`/`.shownByLayer`, the `collect` cases | `packages/design-core/src/model.ts`, `model.test.ts` |
| L6 | **The document reader** — inputs, conditions, layers, timelines and blends through `normalizeScene`; drops a state whose id is reserved, an input with a non-constant id, a track naming neither `prop` nor `dim`; **keeps** a condition naming an input the machine has not got, so `mcbad/3` has something to report | `packages/design-core/src/project.ts`, `project.test.ts` |
| L7 | **The edits** — `addInput`/`renameInput`/`setInputKind`/`setInputRange`/`deleteInput`, `addCondition`/`updateCondition`/`deleteCondition`, `addLayer`/`renameLayer`/`deleteLayer`/`reorderLayer`/`setStateLayer`, `addTimeline`/`deleteTimeline`/`addTrack`/`deleteTrack`/`addKeyframe`/`updateKeyframe`/`deleteKeyframe`, `setStateTimeline`/`setStateBlend`/`addBlendStop`, `setNodeLayerState`, and `pruneConstraints`' `holdsKeyCopy` clause | `packages/design-core/src/edits.ts`, `edits.test.ts` |
| L8 | **The way out** — `StateLayer.layer`, the per-layer attribute, `@keyframes` emission, the blend loss, the three new conditional losses, the SVG `loses` entry | `packages/design-core/src/export.ts`, `export.test.ts` |
| L9 | **The runtime** — the input store, `setInput`/`fireInput`, guard evaluation, the exit gate, the per-layer attribute, and the extended agreement test | `packages/design-core/src/runtime.ts`, `runtime.test.ts` |
| L10 | **The checks** — the six new entries in `machineChecks`, and the panel's sentence for a fight | `packages/design-core/src/machinecheck.ts`, `machinecheck.test.ts` |
| L11 | **Inputs and conditions in the studio** | `packages/app/src/design/Inputs.tsx` + `.module.css` (new), `Conditions.tsx` + `.module.css` (new) |
| L12 | **Layers and timelines in the studio** | `packages/app/src/design/LayerStrip.tsx` + `.module.css` (new), `Timeline.tsx` + `.module.css` (new) |
| L13 | **The panel and the strips** — wiring L11 and L12 in, the per-layer state strip | `packages/app/src/design/Machines.tsx`, `StateStrip.tsx`, `Transitions.tsx` |
| L14 | **The studio wiring** — the playback hook, the label chain, the scrubber | `packages/app/src/design/Studio.tsx`, `useMachinePlayback.ts` |
| L15 | **The canvas and the rules panel** — drawing a played state per layer, lerping the scrubber, offering keyframe copies as members | `packages/app/src/design/Artboard.tsx`, `Constraints.tsx` |

Files nobody owns and nobody may touch: `components.ts`, `measure.ts`,
`derived.ts`, `explore.ts`, **`why.ts`, `relax.ts`**, `annotate.ts`, `paint.ts`,
`tree.ts`, `units.ts`, `LayerList.tsx`, `Editor.tsx`. `why.ts` and `relax.ts` are
in bold because they are the payoff: the five new checks reach the unsat core,
the explanation and the relaxation *without one character changing in either*,
and if a step finds itself editing one of them the check it is building has
stopped being a constraint.

---

## 13. Tests each step writes

Through the real compiler and solver wherever the claim is a claim about the
program. `machineprogram.test.ts` is the model.

**L1 — `values.test.ts`**
1. `permilleOf` on `"0.5"`→500, `"1"`→1000, `"12"`→12000, `"-2.25"`→-2250,
   `"0"`→0.
2. `permilleOf` reads nothing from `"0.0005"`, `"50%"`, `"1e3"`, `"200px"`,
   `"200ms"`, `""`.
3. `permilleOf` refuses `MAX_PERMILLE + 1` in both signs.
4. `nearestPermille("0.0005")` is 1 and `permilleOf("0.0005")` is nothing — the
   rounding has a caller and the parser does not do it.
5. `writePermille(permilleOf(t))` round-trips every text in test 1.
6. The five quantity readers do not overlap where they must not: `"200px"` reads
   as a length and nothing else; `"200ms"` as a duration and nothing else; `"12"`
   as a count **and** a ratio, which is the one documented overlap and is
   asserted rather than tolerated.

**L3 — `machines.test.ts`**
1. `machineLayers` mints `base` for a machine with no `layers`, and
   `layerOf`/`layerInitial` agree with it.
2. `shownStates` on a legacy node with `state` and a one-layer machine equals
   `{ [firstLayer]: shownState(...) }`.
3. `keyframeParts` is **empty** for a machine with a nine-keyframe timeline and
   no constraints — the rationing, asserted as the absence it is.
4. `keyframeParts` returns the track and its ancestors when a geometric
   constraint names one `kfr(...)` term, and nothing else.
5. `parseKeyCopy` round-trips, including a part id that is itself a term, and
   reads nothing from `stt(...)`, `inst(...)` and a bare word.
6. `edgeAllows`: a boolean guard, a numeric window at each of the six operators,
   a `fired` that is and is not in the set, and an exit gate at, one below and
   one above.
7. `stepLayer` returns `undefined` for no edge, `null` for an Exit edge, and the
   state for a taken one — the three answers, distinguished.
8. `stepMachine` steps two layers on one trigger and leaves a third alone.
9. `machineHealth` and the solver agree on all **ten** answers — the four that
   shipped and the six of §6.1 — on ten minimal machines built one fault at a
   time. **This is the test that keeps a greyed row and a name in an unsat core
   saying the same thing** and it is the one to write first.
10. `machineHealth(m).unreachable` is a subset of
    `machineHealth(m).unreachableWithGuards` on every machine the file builds —
    §7.2's inclusion, asserted on the document side as well as the program side.

**L4 — `machineprogram.test.ts`, all against `directSolver`**
1. **The invariant, §0's acceptance test, verbatim.** Universe count does not
   move when three inputs, six conditions, an Entry, an Any, an Exit, a second
   layer, a timeline and a blend are added.
2. `alt(minput(…))`, `pick(minput(…))`, `alt(kfr(…))` and `pick(kfr(…))` occur in
   **no** answer set of any document. A scan over the atoms.
3. **The regression proof, and the most important test in this document.** For a
   corpus of every existing template plus the machine fixtures from
   `machineprogram.test.ts`, the generated program's `shown/2`, `mreach/2`,
   `munreached/2`, `mleaves/2`, `mdeadend/2`, `mnondet/3`, `mdangling/2`,
   `mtwoshown/1`, `frame/3` and `rendered/3` atoms are **identical** to the ones
   the shipped program derives. Not "equivalent" — identical, asserted as sorted
   set equality.
4. `mgreach ⊆ mreach` and therefore `munreached ⊆ mgunreached`, on every machine
   the file builds. A property, not an example.
5. An impossible guard (`x > 5` and `x < 3`) derives `mguardnever` and its state
   goes unreachable under guards but not under the shipped check — the two
   answers differing is the feature.
6. A guard comparing a number input against a value outside its declared range
   derives `mguardnever`; the same guard with no range declared derives nothing.
7. Two edges on one trigger with disjoint guards do **not** derive `mnondet`;
   with overlapping guards they do; with no guards at all they do.
8. An Any edge is taken from every state of its layer and from no state of
   another layer.
9. A specific edge and an Any edge on one trigger do not derive `mnondet`; two
   Any edges do.
10. Two layers writing one property derive `mfight`, `rendered(inst(I,N),P,_)` is
    **single-valued**, and the value is the later layer's.
11. Two layers writing different properties derive no `mfight` and both properties
    land.
12. `mexit` follows a `duration` token, clamps a negative to 0, falls to
    `mdefexit`, and derives `mexitpast` against a non-looping timeline.
13. A blend stop outside its input's range derives `mstopout`; inside, nothing.
14. **The budget.** A twenty-keyframe timeline with no constraints emits zero
    `kfr(` atoms; naming one track in a geometric constraint emits exactly
    twenty per instance and no more.
15. `permille/2` is emitted for `"0.5"` and for `"12"`, and not for `"200ms"`.
16. The generated program for a document with no machines contains no `minput(`,
    `mcond(`, `mlayer(`, `kfr(` or `mtimeline(` and solves to the same answer set
    it did before.

**L5–L10** each write the tests their §-numbered section names, plus, for L8 and
L9 without exception: **a document with no machines exports byte-identical output
to before**, and **a one-layer machine emits `data-state` and not
`data-state-base`**.

**L11–L15 — app.** No test runner; verify by `pnpm turbo run typecheck` and the
`data-role` contract. New roles: `add-input`, `input-name`, `input-kind`,
`input-value`, `fire-input`, `delete-input`, `add-condition`, `condition-input`,
`condition-op`, `condition-value`, `delete-condition`, `transition-exit`,
`add-layer`, `layer-name`, `delete-layer`, `reorder-layer`, `state-layer`,
`add-timeline`, `timeline-name`, `add-track`, `add-keyframe`, `keyframe-at`,
`keyframe-value`, `keyframe-easing`, `delete-keyframe`, `scrub`, `blend-input`,
`add-blend-stop`, `blend-stop-at`.

---

## 14. Review checklist

1. Does the change add an `alt/2` or a `pick/2` over an input, a condition, a
   layer, a timeline's identity or a blend? If so it is wrong, whatever else it
   does. (A keyframe's `at` and `value` are `Value`s and *may* branch. That is
   the one exception and it is the same exception a delta's fill already is.)
2. Does anything projected depend on an input's value? If so rung one has been
   built wrong and the universe count is about to move.
3. Does the program mention a frame, a frame rate, or a time that is not a
   keyframe's own? Rung five's whole budget is that sentence.
4. Does `kfr(I,W,R,K)` or any reserved id become a `node/1` or an `mstate/2`?
5. Does a document with no machine, no layer and no condition still compile to
   the atoms it compiled to before? §13's L4 test 3 is the proof and it is not
   optional.
6. Is a keyframe copy minted for a track no rule names? If so §5.5 has been
   bypassed and the budget is gone.
7. Did anything have to change in `why.ts` or `relax.ts`? If so the check being
   built has stopped being a constraint.
8. Does a comment argue *why*, including what was considered and rejected?
9. Do local imports carry the explicit `.ts` extension?
10. Is the claim about the program tested through the real compiler and solver
    rather than through a hand-written atom list?

---

## 15. Where this knowingly departs — from Rive, and from the brief

Collected in one place so a reader does not have to find them, because each is a
decision somebody may want to reverse and none of them should be discovered by
surprise in a diff.

**From Rive, four times.**

1. **A transition blocked by its exit time drops the event; Rive would fire it
   when the time elapsed.** §2.5. The reason is `runtime.ts`'s own: no timers, no
   queue, and a deferred fire is a state change nobody's finger caused. A
   designer who wants "and then it moves on by itself" writes a `load` edge out
   of the destination, which `settle()` already follows.
2. **Entry is not a node in the graph; it is the initial state plus the `load`
   trigger.** §3.2. We already shipped Entry and it turned out to be spelled
   differently. The reserved id is accepted and derived, so a document imported
   from Rive reads naturally, but the program never grows a fourth node.
3. **A layer conflict is resolved *and* reported.** §4.4. Rive resolves silently.
   The resolution is Rive's exactly — last layer wins — because the program has
   to draw a picture; the report is the thing this tool exists to add.
4. **A blend state is not fully in the exported file.** §5.6. CSS cannot mix two
   keyframe animations by a number, the export carries one stop and a `lost`
   entry naming the others, and the studio canvas does the real interpolation.
   **This is scaffolding in the export and is labelled as such**; a step that
   ships it and calls the export complete has misreported it.

**From the brief, once, and it is the one worth arguing about.**

The brief asks for a check on "a transition whose exit time exceeds its own
duration", and §7.5 ships exactly that, worded exactly that way. While building
it, it became clear that the *literal* reading catches a typo (two numbers in
adjacent fields) and that the reading which catches the real bug is different:
an exit time longer than the **from state's timeline**, which makes the
transition unreachable rather than merely odd. Rather than silently substituting
the second for the first, both ship: `machine_exit_within_duration` is the
brief's, `machine_exit_before_end` is the other, and the Machines panel offers
them side by side.

**And one thing the brief asked for that is not here.**

There is no untriggered transition. Rive's exit time is most often paired with
one — an animation ends and the machine moves on — and the whole of that idiom
is expressed here as a `load` edge, which is not the same thing: `load` fires at
start, not at the end of a timeline. A genuine "when this timeline finishes"
trigger is a real gap, it is one more entry in `TRIGGERS` plus a line in the
runtime that listens for `animationend`, and it is **deliberately not in this
document** because it needs the timeline rung to be built first and because
guessing at its interaction with looping timelines and blend states before there
is one to test against is how a frozen spec becomes wrong. It is the obvious
sixth rung and it should be specified after rung five ships, not before.
