# The motion gap: curves that are values, and gestures that are not events

**Status: design, not yet built.** Two features, two steps, two commits. They
share a file list and share nothing else, and they are written apart here on
purpose: **Part One (curves)** can land alone and leaves the trigger table
untouched; **Part Two (gestures)** can land alone and leaves the easing table
untouched. Neither depends on the other.

Every type, predicate and CSS string below is the contract. Where the
implementer finds this document wrong, they implement the nearest correct thing
and say so in their return value — they do not quietly redesign an interface the
other step is coding against.

---

## 0. What I read, and the two sentences the whole design turns on

`scene.ts` (`Trigger`/`TRIGGERS`/`TriggerSpec` at 3712–3792, `Easing`/`EASINGS`/
`DEFAULT_EASING` at 3794–3819, the `MotionProp` essay at 3821–3893, `Keyframe` at
4112–4131, `MachineInput` at 3938–3989, `Blend` at 4208–4222, `Transition` at
4414–4493, `easingOf` at 4622–4635), `machines.ts` (`MachineTable`, `runtimeLayers`,
`keyEasing`, `solvedKeys`, `timelineLength`, `timelinePosition`, `sampleTimeline`,
`blendWeights`, `MACHINE_CHECKS`/`LADDER_CHECKS`), `runtime.ts` in full,
`compile.ts` (`MOTION_DEFAULT_PREDICATES` 1194–1233, `MACHINE_RULES` 1314–1604,
the `CONTRACT` prose 2298–2860, the fact emission 4323–4420, `machineValues`
3654–3703, `variableCounts`/`unreadVariables` 5290–5440, the `#show`/`#project`
block 4990–5190), `export.ts` (`pseudoClassFor`, `pacing`, `transitionsFor`,
`planMachines`, `playTimelines`, `MachineExport`), `values.ts` (`ValueType`,
`Quantity`, `VALUE_TYPES`, `wordOf`, `motionVar`, `keyTimeVar`), `project.ts`
(`normalizeTransitions`, `settingValue`), `Transitions.tsx`,
`useMachinePlayback.ts`, `Editor.tsx`'s preview handlers, `Studio.tsx`'s
`onTrigger`, `Artboard.module.css`.

Two sentences decide almost everything below, and both are already written down
somewhere in that list.

**One.** `easingOf`'s own doc says an easing is "a word rather than a
{@link Value} … an easing is a closed menu of five curves with no arithmetic in
it, nothing scales it". The first half of that is a *description* and the second
half is an *argument*, and the argument is wrong — not because easings scale,
but because it proves too much. Nine of the nineteen `ValueType`s are closed
menus with no arithmetic in them (`direction`, `align`, `fit`, `placement`,
`justify`, `sizing`, `growth`, `solid`, `lamp`), nothing scales any of them, and
every one is a `Value` that may name a token and hold alternatives. `#project
l_value/3` exists precisely so that a `direction` token holding `row` and
`column` is two designs. An easing is that shape exactly. **The asymmetry the
brief names is real and it is resolved by making `easing` a `Value`, not by
defending the word.**

**Two.** `runtime.ts` refuses to own a clock, and `runtime.test.ts` enforces the
refusal by asserting that `setTimeout`, `setInterval` and `requestAnimationFrame`
do not appear in the emitted text. That refusal is the reason the studio and the
exported file cannot disagree, and **nothing in Part Two may weaken it.** It is
what kills the obvious design for scroll-linked motion and it is what makes the
right one cheap.

---

# PART ONE — CURVES

## 1.1 What springs are, and what they are not

A spring gets **three fixed members of the existing `Easing` menu** and no
parameters. A custom bezier gets a **literal in the same value**, spelled in the
document's own dialect. Neither invents a type.

### 1.1.1 Rejected: parameterised springs

`Transition.easing: Easing | { kind: "spring"; stiffness: Value; damping: Value;
mass: Value }`. Rejected, and the four reasons are cumulative:

1. **The parameters would have to be `Value`s** — the rest of this document says
   `Value`, and a stiffness that could not name a token while a duration could
   would be the same asymmetry moved one field over. So a spring is three
   variables, three `#show`s and three `#project`s. Two of them named tokens
   holding two alternatives each is **four universes**, and that is the sprite
   sheet `MACHINE_RULES`' opening argument exists to prevent, arriving through a
   door nobody was watching.
2. **The multiverse renders stills.** Four universes differing only in damping
   are pixel-identical in every `rendered/3` atom the gallery draws. `mdur/3`
   escapes that because a duration is *one number* the panel prints and the
   export writes as text; three spring parameters are a curve, and a curve is not
   a thing a still frame can show a person. The document would branch on a
   difference the tool cannot display.
3. **The program cannot hold it.** A spring's settle time is
   `-ln(0.005·√(1−ζ²)) / (ζω₀)` — transcendental in the parameters. `clingo-lpx`
   supplies **linear** theory variables and the grounder has 32-bit integers.
   There is no `mdur/3` a parameterised spring could derive, so
   `machine_exit_within_duration` (`mexit(M,T,E), mdur(M,T,D), E > D`) would have
   no `D` on exactly the transitions most likely to have a wrong one.
4. **It collides with `Transition.duration`.** See §1.4, which is the only one of
   the four that is not fatal on its own and is the one that decides the *shape*
   of what we ship instead.

The 90%: a designer reaches for a *named* spring nine times out of ten, and a
design system ships three to six of them. Three fixed members cost three table
entries and nothing else in the repository.

### 1.1.2 What is added to the menu

`Easing` grows from five members to eight. Every one is still a bare ASP constant
and reaches `measing/3` as itself.

```ts
export type Easing =
	| "linear"
	| "ease"
	| "easeIn"
	| "easeOut"
	| "easeInOut"
	| "springGentle"
	| "springSnappy"
	| "springBouncy";
```

The table gains one column and one optional sub-record:

```ts
/**
 * The physics a named spring's `css` was sampled from.
 *
 * Here rather than in the sampler because the numbers are what a designer
 * *thinks* in — "stiffness 400, damping 32" is the vocabulary of every motion
 * tool that has springs — while what a browser is handed is a `linear()` with
 * sixty-five stops in it and no physics at all. Keeping both means the panel can
 * say what the curve is made of, the test in `values.test.ts` can regenerate the
 * string and check the constant, and nobody has to read four hundred numbers to
 * find out that `springBouncy` overshoots by sixteen percent.
 *
 * The three of them decide the curve's **shape** through exactly one derived
 * quantity, the damping ratio ζ = damping / (2·√(stiffness·mass)), because the
 * sample is taken over normalised time and normalised travel. `mass` is
 * therefore redundant with the other two and is kept anyway: a designer who
 * changes stiffness and expects the bounce to change is asking about ζ, and a
 * table that hid one of its three terms would make that arithmetic a mystery.
 */
export interface SpringSpec {
	stiffness: number;
	damping: number;
	mass: number;
	/**
	 * Where the sample was truncated, in whole milliseconds: the settle time, at
	 * which the spring is within half a percent of its rest position and moving
	 * slowly enough that a person cannot see it move.
	 *
	 * **This is a hint and never a duration.** What paces the transition is
	 * `Transition.duration`, which is a `Value` a designer set and a token may
	 * hold two ends of — see §1.4, which is where that collision is resolved and
	 * why it is resolved that way round. The panel shows this number beside the
	 * menu so that a designer who wants the spring at its natural speed knows
	 * what to type into the duration field.
	 */
	natural: number;
	/**
	 * What a browser with no `linear()` is given instead — see §1.5.
	 *
	 * A named curve or a `cubic-bezier`, chosen to be the nearest thing CSS could
	 * always express. It is not a good spring; it is a curve that moves in the
	 * same direction at roughly the same speed, which is the whole ambition of a
	 * fallback.
	 */
	fallback: string;
}

export interface EasingSpec {
	label: string;
	/**
	 * The CSS timing function this word means.
	 *
	 * A separate column and not the stored value itself, unlike every other
	 * enumerated {@link ValueType} in `values.ts` — and the reason is the reason
	 * `spaceBetween` and `oneD` exist. CSS spells its curves with hyphens
	 * (`ease-in-out`) and a stored value reaches the generated program as an ASP
	 * constant, where a hyphen is a minus sign. So the document's dialect is
	 * `easeInOut` and this column is the one translator; {@link cssEasing} is the
	 * only function allowed to read it.
	 */
	css: string;
	spring?: SpringSpec;
}
```

The three springs, with the numbers to type in:

| id | stiffness | damping | mass | ζ | overshoot | `natural` | `fallback` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `springGentle` | 170 | 26 | 1 | 0.997 | none | `410ms` → **410** | `ease-out` |
| `springSnappy` | 400 | 32 | 1 | 0.800 | ~1.5% | **330** | `cubic-bezier(0.2, 0, 0, 1)` |
| `springBouncy` | 300 | 18 | 1 | 0.520 | ~16% | **590** | `cubic-bezier(0.34, 1.56, 0.64, 1)` |

Labels: "Spring — gentle", "Spring — snappy", "Spring — bouncy". They sort after
the five curves in `EASING_NAMES` because `Object.keys` preserves insertion
order and the menu reads better with the plain curves first.

`DEFAULT_EASING` does **not** move. `easeOut` stays the default, for the reason
already written at `scene.ts:3812` — a state machine's transitions are responses
to a person and a response that starts slowly reads as lag — and because
changing it would re-pace every transition in every existing document.

### 1.1.3 The sampler, and why the strings are checked in

```ts
/** How many stops a sampled spring's `linear()` carries. */
export const SPRING_STOPS = 65;

/**
 * A named spring's position at `SPRING_STOPS` evenly spaced moments, normalised
 * so that time runs 0..1 over `natural` and travel runs 0..1 over the whole
 * move.
 *
 * Underdamped and critically damped are one formula, because ζ = 0.997 is not
 * ζ = 1 and the limit is only interesting to a mathematician:
 *
 *     x(t) = 1 − e^(−ζω₀t) · ( cos(ω_d t) + (ζω₀/ω_d) · sin(ω_d t) )
 *     ω₀ = √(stiffness / mass)      ω_d = ω₀√(1 − ζ²)
 *
 * The first stop is pinned to exactly 0 and the last to exactly 1 rather than
 * taken from the formula. At `natural` the spring is within half a percent of
 * rest, not at rest, and a `linear()` whose last stop is 0.996 leaves every
 * animated property four thousandths short of the value the state's own rule
 * says it has — which is a border that never quite arrives at its colour and a
 * box that stops one pixel out of a two-hundred-pixel move.
 */
export function sampleSpring(spec: SpringSpec, stops = SPRING_STOPS): number[];
```

`sampleSpring` exists so the constant is **checkable**, not so it is called at
run time. `EASINGS.springSnappy.css` is a checked-in string of sixty-five
numbers, and `values.test.ts` regenerates it and asserts equality. The
alternative — computing it on every export — was rejected because the export runs
once per keystroke in the studio and a spring's curve is a constant of the
universe; and because a checked-in string is a thing a reviewer can read in a
diff, while a number produced at run time is a thing nobody ever looks at.

**Sixty-five stops.** `linear()` interpolates linearly between stops, so the
error between two of them is bounded by `h²·max|f″| / 8`. For `springBouncy`
(ω_d·natural ≈ 8.7 radians over the span, so `max|f″|` ≈ 76 in normalised units)
that is `(1/64)²·76/8` ≈ **0.23%** of the travel — half a pixel on a
two-hundred-pixel move, which is under the threshold at which anybody can see a
curve is polygonal. Thirty-three stops give 0.9%, which is two pixels on the same
move and is visible on a slow bounce. The byte cost is ~390 characters per
spring, paid **once per document** and not once per node, because §1.5 hoists it
into a custom property.

## 1.2 `easing` becomes a `Value`

This is the asymmetry resolved, and it is what makes a **feel token** possible: a
`curve` token holding `["easeOut", "springSnappy"]` is one document holding the
crisp reading and the playful one, and pointing every transition at it is the
same act as pointing every duration at a motion scale. Without it, springs are a
menu; with it, springs are a design decision the multiverse can show you both
sides of.

### 1.2.1 A new `ValueType`

```ts
export type ValueType = /* … */ | "easing";
```

```ts
/**
 * The shape of a curve — the tenth enumerated type, and the first one that is
 * about *time* rather than about the picture.
 *
 * A type rather than a word on a transition for `duration`'s reason exactly,
 * and the parallel is worth stating because it is the whole feature: a
 * `duration` token holding two alternatives is a **motion scale**, one place
 * that decides how quickly a design moves; a `curve` token holding
 * `["easeOut", "springBouncy"]` is a **feel**, one place that decides whether it
 * moves like a control or like a toy. Both are decisions a design system makes
 * once, both show up in the exported file as text a reader can tell apart, and
 * both therefore branch the space rather than collapsing into one universe with
 * an arbitrary pick.
 *
 * No `quantity`, like every other menu here: a curve is not a number, it is not
 * read by `numeralOf` or `msOf` or any of the six literal bridges, and the one
 * spelling of it that *does* carry numbers — a custom bezier — carries four of
 * them and so is a shape rather than a quantity. That is why §1.3's bridge is a
 * seventh bridge and not a sixth `Quantity`.
 */
easing: {
	label: "Easing",
	fallback: DEFAULT_EASING,
	options: EASING_NAMES.map((id) => ({ value: id, label: EASINGS[id].label })),
},
```

**The table has to move.** `EASINGS` currently lives in `scene.ts`, and
`scene.ts` imports `values.ts`, so `VALUE_TYPES.easing.options` cannot read it
there. `EASINGS`, `EASING_NAMES`, `Easing`, `DEFAULT_EASING`, `EasingSpec`,
`SpringSpec`, `SPRING_STOPS` and `sampleSpring` all move to **`values.ts`**,
beside `FONTS`, `ALIGNS`, `SHADOWS` and `DIRECTIONS`, which is where every other
menu already is. `scene.ts` re-exports them so no import in the app moves. This
is not tidying: it is the same move `FONTS` already made, and doing it any other
way means writing the eight labels twice.

`VALUE_TYPES.easing.fallback` and `DEFAULT_EASING` are one string in two tables.
`values.test.ts` asserts they are equal — "one default, two tables" — because a
document that fell back to `ease` in the editor and `easeOut` in the program
would be a document nobody could debug.

### 1.2.2 The document

```ts
export interface Transition {
	/* … */
	/**
	 * The shape of the curve, as an `easing` {@link Value} — so it may name a
	 * token, and a `curve` token holding two alternatives really is two designs.
	 *
	 * A {@link Value} and not the bare {@link Easing} word it used to be, and the
	 * change is a correction rather than a widening. The old comment on
	 * `easingOf` argued that an easing is "a closed menu of five curves with no
	 * arithmetic in it, nothing scales it" — which is true of `direction`,
	 * `align`, `fit`, `placement`, `justify`, `sizing`, `growth`, `solid` and
	 * `lamp` as well, every one of which is a Value, and `#project l_value/3`
	 * exists so that a `direction` token holding `row` and `column` is two
	 * designs rather than one. A duration token is a motion *scale*; a curve
	 * token is a *feel*; both are one decision a design system makes once.
	 *
	 * Absent takes {@link DEFAULT_EASING}, which is what the program's own
	 * `mdefease/1` rule says too.
	 */
	easing?: Value;
}

export interface Keyframe {
	/* … */
	/**
	 * How the segment *leaving* this keyframe is paced, as an `easing`
	 * {@link Value} — the same widening a transition's easing takes, for the same
	 * reason and at the same time.
	 *
	 * Made a Value together with the transition's rather than left behind,
	 * because half a change is a new asymmetry replacing an old one: a document
	 * where the hover curve could name a token and the overshoot curve could not
	 * would be a feel scale with a hole in it, which is exactly the sentence
	 * {@link Transition.exit} already makes about a motion scale.
	 *
	 * It costs a keyframe **one variable, and only where somebody typed
	 * something** — `machineValues` guards on `key.easing.length > 0` exactly as
	 * it guards on `key.at.length > 0` — so a timeline whose keyframes say
	 * nothing about their curves mints nothing at all, and one that names a
	 * single curve mints a one-alternative variable, which is not a choice
	 * anybody makes. The last keyframe's easing is still read by nothing and is
	 * still kept rather than refused.
	 */
	easing?: Value;
}
```

### 1.2.3 The readers

`easingOf` and `keyEasing` both gain a context and both return **the literal
text**, not an `Easing`:

```ts
/**
 * How a transition is paced in this universe, as the literal it resolved to.
 *
 * **Text and not an {@link Easing}**, which looks like a loss of type safety and
 * is the opposite: the answer may be a menu word (`"springSnappy"`) or a custom
 * curve (`"cubicBezier(200,0,0,1000)"`), and a union of those two shapes would
 * be a union every caller had to destructure before it could hand the thing to
 * {@link cssEasing}, which takes text. Text is the currency everywhere else in
 * this system — a literal has no type and the reader is chosen by what the value
 * *is* — and an easing is not the place to invent a second convention.
 *
 * Falls back to {@link DEFAULT_EASING} where the transition says nothing, where
 * what it says resolves to nothing, and where what it resolves to is neither a
 * word the menu knows nor a curve {@link bezierOf} reads. All three are the same
 * answer the generated program gives through `not mreadsease(M,T)`, which is the
 * point: `cssEasing` would otherwise write a timing function no browser parses.
 */
export function easingOf(
	machine: Machine,
	transition: Transition,
	context?: ResolveContext,
): string;

/** The same reader over a keyframe's outgoing segment. */
export function keyEasing(
	machine: Machine,
	timeline: Timeline,
	track: string,
	index: number,
	key: Keyframe,
	context?: ResolveContext,
): string;
```

`easingOf`'s signature change is the one breaking change in Part One and it
breaks four call sites: `compile.ts:4340`, `export.ts:3022` (`pacing`),
`Transitions.tsx:467`, and `machines.ts`'s `sampleTimeline` (through `keyEasing`).
`TrackSample.easing` changes from `Easing` to `string` for the same reason.

And the translator, in `values.ts`, the only function allowed to read
`EasingSpec.css`:

```ts
/**
 * A stored curve as CSS, or nothing where it is neither.
 *
 * Two spellings and one function, because there is exactly one place in the
 * system where the document's dialect becomes a browser's: a menu word through
 * {@link EASINGS}, and a `cubicBezier(…)` term through {@link bezierOf}. A
 * caller that got `undefined` writes `EASINGS[DEFAULT_EASING].css`, which is the
 * same fallback the program takes.
 *
 * A **spring** comes back as its whole `linear()` string. The export does not
 * write that string into a rule — it hoists it into a custom property, see §1.5
 * — but that is the export's business and not this function's, and a caller with
 * no stylesheet to hoist into (the studio canvas, which sets `--dc-play-easing`
 * on an element) wants the string itself.
 */
export function cssEasing(text: string): string | undefined;
```

## 1.3 Custom bezier

### 1.3.1 The spelling

A custom curve is a literal in the same `easing` value, written in the document's
dialect:

```
cubicBezier(200, 0, 0, 1000)      =  cubic-bezier(0.2, 0, 0, 1)
cubicBezier(340, 1560, 640, 1000) =  cubic-bezier(0.34, 1.56, 0.64, 1)
```

Four whole **thousandths**, which is `permilleOf`'s unit and the unit every ratio
in this system already reaches the program in. Rejected alternatives, both for
the same reason:

- **Store the CSS: `cubic-bezier(0.2, 0, 0, 1)`.** It is not an ASP term. A
  hyphen is a minus sign to the grounder and `0.2` is not an integer, so the
  literal could reach the program as a quoted string and nothing else — meaning
  no rule could ever say anything about it, and the seventh bridge below would be
  a string parser inside ASP.
- **Four separate fields on `Transition`.** Four `Value`s is four variables and
  four projections for one curve, which is §1.1.1's objection to parameterised
  springs arriving through a second door. One literal is one variable.

`cubicBezier(200,0,0,1000)` **is** a legal ASP term — a lowerCamel functor with
four integer arguments — which is why the program can name it in a rule:

```
viol(system_curves) :- measing(_,_,cubicBezier(_,_,_,_)).
```

"Every transition uses a curve from the system." That is a real check a design
system wants, it is one line in the Rules panel, and it is only writable because
the term is a term.

### 1.3.2 The reader, and the seventh bridge

```ts
/**
 * The four control points a literal reads as, in thousandths — exact or
 * nothing, for `emuOf`'s and `msOf`'s reason: a bezier reaches the program as
 * four integers and a fact has to be an integer.
 *
 * `x` is clamped to nothing and *refused* outside 0..1000, because a cubic
 * bezier timing function whose control points leave that range on the time axis
 * is not a slow curve, it is a curve that runs backwards in time — which CSS
 * refuses too, and which is a typo rather than a design. `y` is unbounded in
 * both directions and deliberately: `y` outside 0..1000 is overshoot and
 * undershoot, which is exactly what somebody reaching for a custom curve
 * instead of a named spring is reaching for.
 *
 * Whitespace after the commas is accepted and nothing else is; a decimal point
 * anywhere reads as no curve at all, for `msOf`'s reason — `cubicBezier(0.2,…)`
 * is two-tenths of a thousandth, ambiguous by a factor of a thousand, and
 * rounding it behind the designer's back would put a curve in the file that no
 * panel agrees with.
 */
export function bezierOf(text: string): [number, number, number, number] | undefined;
```

And in the generated program, **a seventh literal bridge**:

```
bezier(Lit, X1, Y1, X2, Y2)
```

emitted by the compiler over the same interning pass that emits `millis/2` and
`permille/2`, one fact per literal that reads as a curve, **zero facts in every
document that has none**.

This is a stated cost. `values.ts`'s `Quantity` essay counts the bridges — "There
are six: `numeral`, `tally`, `word`, `millis`, `permille` and `mdeg`" — and this
makes seven. It is not a sixth `Quantity`, and the distinction is the one that
essay already draws: a quantity is one number with one reader, and a bezier is a
*tuple* of four. Filing it under `ratio` would make `permilleOf` answer for a
thing that is not a proportion of anything; giving it a `Quantity` name would be
a column that changed no answer, which is the trap the `weight` note steps
around. It is a bridge and not a quantity, and the count of bridges is the number
that goes up.

### 1.3.3 Why not just let the bezier fall back in the program

The tempting cheap version: no bridge at all. A bezier literal reads as no
`word/2`, so `measing/3` falls to `mdefease`, and the export writes the bezier
anyway because it resolves the document's own `Value` against the picks.

**Refused.** The program and the file would then disagree about what curve is
playing — the file would show a bespoke overshoot while a rule reading
`measing(m1,over,easeOut)` was told it was an ease-out. Every other fallback in
this system is a fallback *both* readers take (`msOf` refuses `"1.5ms"` in the
panel and `millis/2` refuses it in the program, and both land on `mdefdur`).
A fallback only one reader takes is drift with a fig leaf on it, and it is the
class of bug the whole two-readers-one-table arrangement in `runtime.ts` exists
to make impossible.

## 1.4 A spring's duration, against `Transition.duration`

**`Transition.duration` wins, always, and a spring is a shape stretched over it.**

A named spring in this system is not a simulation. It is a curve of **unit
length** — a `linear()` timing function over normalised time — and
`Transition.duration` is how long that unit is stretched over. Everything already
built keeps working unchanged: `mdur/3` keeps its meaning and its projection,
`transition: <props> <dur>ms <easing> <delay>ms` keeps its number,
`machine_exit_within_duration` keeps its `D`, the stagger keeps folding into each
node's own delay in `order/2` sequence, and a `duration` token still retimes the
whole document — springs included.

**What is lost, said out loud.** A real spring's frequency is a property of the
spring. Two `springBouncy` transitions at 200ms and 600ms are not one spring
played slowly; they are two different springs, and Framer Motion ignores
`duration` for a spring for exactly this reason. We choose the other side, and
the reason is not convenience:

- A duration is already the one number **every** panel row, **every** exported
  declaration, **every** check and **every** motion token in this system is
  written around. A curve that quietly ignored it would put a second, invisible
  clock in a document that has exactly one — and a designer who set the duration
  to 400ms and watched it take 590 would have no way to find out why.
- The program could not hold the other answer. §1.1.1(3): the settle time is
  transcendental, `mdur/3` would be underivable for a spring transition, and
  `mexit(M,T,E), mdur(M,T,D), E > D` would go silent on precisely the rows most
  likely to be wrong.

**The accommodation, which costs one string.** `SpringSpec.natural` records the
settle time the sample was truncated at, and the Transitions row shows it beside
the menu whenever the resolved curve is a spring:

> Spring — bouncy · settles naturally in **590ms**

so a designer who wants the physical spring types 590 into the duration field
that is already on the row. Nothing is computed, nothing is defaulted, and
nothing writes to the document on the designer's behalf.

**Rejected: `Transition.duration` becomes optional and derived for springs.** It
would take `mdur/3` away from the program (see above), leave the exported
`transition:` shorthand with no number to write, and make the duration field in
the panel disappear and reappear as the curve changed — which is a control that
moves under the hand.

## 1.5 The export

### 1.5.1 What `linear()` costs and what browsers do without it

`linear()` is Baseline 2023 (Chrome 113, Safari 17.2, Firefox 112). A browser
that does not parse it treats the declaration as invalid **and drops the whole
declaration** — and because the export writes the `transition` *shorthand*, that
takes the duration and the delay with it. The state would not tween at all; it
would snap. That is a worse failure than an approximate curve, so a fallback is
mandatory and not a nicety.

The obvious idiom is two declarations:

```css
.n7 { transition: opacity 200ms ease-out 0ms; }
.n7 { transition: opacity 200ms linear(0, 0.021, …, 1) 0ms; }
```

**Refused**, and for a structural reason rather than an aesthetic one:
`Declarations` in `export.ts` is `Record<string, string>` and one key is one
property, so two `transition` declarations for one node cannot both live in a
`StateLayer.transitions` entry. Rewriting that record into a list of pairs is a
change to every emitter in the file for the sake of three springs.

**What is emitted instead**: one custom property per spring the file actually
uses, defined twice — once plainly, once inside `@supports` — and referenced from
every `transition` declaration. `var()` substitutes before the shorthand is
parsed, so this is one declaration and one key.

```css
:root {
	--dc-ease-springSnappy: cubic-bezier(0.2, 0, 0, 1);
}
@supports (transition-timing-function: linear(0, 1)) {
	:root {
		--dc-ease-springSnappy: linear(0, 0.0208, 0.0801, …, 1);
	}
}
```

and on the node's base rule, from `transitionsFor`:

```css
.n7 { transition: opacity, color 200ms var(--dc-ease-springSnappy) 0ms; }
```

The `@supports` block is emitted **once per document**, after the `:root` block
that carries the token custom properties and before the layer blocks, and it
holds one line per spring in `MachineExport.springs`. A document that uses no
spring emits neither block and is byte-identical to what it exports today —
which is the no-regression claim and is asserted in §1.7.

`--dc-ease-springSnappy` is a legal custom property name (they are
case-sensitive and accept letters), and the `dc-` prefix is the one
`--dc-play-easing` in `Artboard.module.css` already uses.

### 1.5.2 `MachineExport`

```ts
export interface MachineExport {
	/* … */
	/**
	 * The springs any emitted declaration referred to, so the stylesheet can
	 * define their custom properties and the `@supports` block that upgrades
	 * them — see §1.5.1.
	 *
	 * A set collected during the walk rather than a scan of the document
	 * afterwards, for the reason `used` is a single set: a spring named by a
	 * `curve` token in a hover state has to reach `:root` like any other named
	 * thing, and a second collection reconciled later is how one goes missing.
	 * Only springs are in here; a plain curve and a custom bezier are written
	 * inline, because they are short and every browser parses them.
	 */
	springs: Set<Easing>;
}
```

`pacing()` (`export.ts:3007`) changes to resolve the easing against the universe
and to report which spring, if any, it named:

```ts
function pacing(/* … */): {
	duration: number;
	delay: number;
	stagger: number;
	/** Ready to write: a curve, or `var(--dc-ease-<spring>)`. */
	easing: string;
	/** The spring the caller must add to `MachineExport.springs`, if any. */
	spring?: Easing;
};
```

**The answer set first and the document second**, exactly as the three durations
already are: `model.machines[m].easing[t]` where the universe supplied one, the
document reader with picks where it did not. That ordering is not decorative —
an easing that names a token whose alternatives the solver chose between resolves
to nothing without a context, which is the bug `machineTable`'s own `context`
parameter was added to close.

### 1.5.3 What does not change

`pseudoClassFor` is untouched. A curve is not a trigger, so a rest/hover pair
with a spring on it still collapses to `:hover` and still exports with no script
in the file — which is the promise `export.ts`'s header makes and the one worth
protecting hardest. `exportSvg` is untouched: a machine reaches the SVG path
through nothing, since `machines.keyframes` and `machines.layers` are read only
by the HTML emitter.

## 1.6 The generated program

### 1.6.1 Facts, always

Beside `MOTION_DEFAULTS` and `LADDER_DEFAULTS`, and emitted **always**, for their
stated reason: a hand-written rule may assert `mtrans/2`, and a transition with
no curve at all is a transition nothing shapes.

```
mdefease(easeOut).
measeopt(linear).  measeopt(ease).  measeopt(easeIn).  measeopt(easeOut).
measeopt(easeInOut).  measeopt(springGentle).  measeopt(springSnappy).
measeopt(springBouncy).
```

`measeopt/1` is generated from `EASING_NAMES`, so a ninth curve is one table
entry and no edit here. It exists so the program can tell a curve it knows from a
word it does not: without it, a `curve` token holding `["easeOut", "wobble"]`
would put `measing(m1,over,wobble)` into the answer set, the export would write
`wobble` into a `transition` declaration, and the browser would drop the
declaration and snap. `EASINGS`' own "a stored word the table does not know falls
back" rule, moved into ASP so both readers keep it.

`MOTION_DEFAULT_PREDICATES` does **not** grow. `easing` is not a `MotionProp` and
must not become one: `MotionPropSpec` carries `type: ValueType` used as a
duration, `fallback` read by `msOf`, and `signed`, and `motionMs` calls `msOf` on
every member. A non-time member would make `motionMs` return `0` for it. The
variable key still goes through `motionVar(machine.id, transition.id, "easing")`
→ `mval(m1,over,easing)`, which is exactly the arrangement `exit` already has and
is cited as the precedent: the *key* is in the family, the *table* is not.

### 1.6.2 Rules, in `MACHINE_RULES` beside `mdur/3`

```
% ---- what shape a move has, per universe ----
% The same shape mdur/3 has and for the same reason: a curve is a value, so what
% the export writes is derived from the pick rather than written down, and a
% `curve` token with two alternatives is a feel the document can hold both ends
% of.
measing(M,T,E) :- resolved(mval(M,T,easing),L), word(L,E), measeopt(E).
% A custom curve is a TERM and never a word — cubicBezier(200,0,0,1000) is a
% lowerCamel functor with four integer arguments, which is a thing a rule can
% name (`viol(system_curves) :- measing(_,_,cubicBezier(_,_,_,_))`) and a hyphen
% would not be. The four numbers are thousandths, permille/2's own unit.
measing(M,T,cubicBezier(A,B,C,D)) :- resolved(mval(M,T,easing),L), bezier(L,A,B,C,D).
% Derived from the two SOURCES and never from measing/3 itself. A rule whose body
% negates its own head predicate is the shape with no stable model — the same
% trap `wornProps` records about negating alt/2 — so this mirrors
% mreadsdur/2 exactly rather than being written the short way.
mreadsease(M,T) :- resolved(mval(M,T,easing),L), word(L,E), measeopt(E).
mreadsease(M,T) :- resolved(mval(M,T,easing),L), bezier(L,_,_,_,_).
measing(M,T,E) :- mtrans(M,T), mdefease(E), not mreadsease(M,T).
```

and the same five lines one grain finer for a keyframe, over the new
`keas(M,W,R,K)` variable, replacing the `mkeasing/5` fact that
`compile.ts:4340`-adjacent emission currently writes:

```
mkeasing(M,W,R,K,E) :- resolved(keas(M,W,R,K),L), word(L,E), measeopt(E).
mkeasing(M,W,R,K,cubicBezier(A,B,C,D)) :- resolved(keas(M,W,R,K),L), bezier(L,A,B,C,D).
mreadskeas(M,W,R,K) :- resolved(keas(M,W,R,K),L), word(L,E), measeopt(E).
mreadskeas(M,W,R,K) :- resolved(keas(M,W,R,K),L), bezier(L,_,_,_,_).
mkeasing(M,W,R,K,E) :- mkey(M,W,R,K), mdefease(E), not mreadskeas(M,W,R,K).
```

`#defined` lines for `mdefease/1`, `measeopt/1`, `bezier/5`, `mreadsease/2` and
`mreadskeas/4` join the block at `compile.ts:1315–1337`.

### 1.6.3 The `#show` and `#project` lines — **the two that carry the feature**

```
#show measing(M,T,E) : measing(M,T,E), scenery.
#project measing/3.
#project mkeasing/5.
```

`mkeasing/5` is already `#show`n (`compile.ts:5112`); `measing/3` is not shown
today at all, because today it is a fact the panel reads off the document.

**`#project measing/3.` is the line that, if forgotten, silently deletes this
feature.** A `curve` token holding `easeOut` and `springSnappy` produces two
answer sets identical in every projected atom, clingo collapses them into one,
and the studio shows a single design for a document that plainly holds two —
with an arbitrary pick nobody chose. That is the `asset/2` failure of commit
546eb02 arriving one predicate over, and §1.7's second test is written to fail
loudly if the line is missing.

`#project mkeasing/5.` is the same claim for a keyframe's outgoing curve, and it
belongs beside `#project mkat/5.`, which is already there for a keyframe's time.

New variable helper in `values.ts`, beside `keyTimeVar`/`keyValueVar`:

```ts
/** How the segment leaving a keyframe is paced — see {@link keyTimeVar}. */
export const keyEaseVar = (
	machineId: string,
	timelineId: string,
	track: string,
	index: number,
): string => `keas(${machineId},${timelineId},${track},${index})`;
```

### 1.6.4 The three walks that must learn about it

- **`machineValues`** (`compile.ts:3654`): visit
  `motionVar(m, t, "easing")` beside the existing `exit` special case, and
  `keyEaseVar(...)` beside `keyTimeVar`/`keyValueVar`, both guarded on
  `length > 0`.
- **`variableCounts`** rides `machineValues`, so it needs no edit — say so in the
  commit, because it looks like an omission.
- **`unreadVariables`** (`compile.ts:5414`): `read.push(transition.easing)` beside
  `read.push(transition.exit)`, and `read.push(key.easing)` beside
  `read.push(key.at, key.value)`. Without these a `curve` token every transition
  in the document points at is reported **unread** and its alternatives are
  greyed in the panel — which is the exact failure the existing comment there
  describes about a `duration` token, one field over.

### 1.6.5 The CONTRACT prose

`compile.ts:2809–2824` gains, in place of the current `measing` line:

```
%   mval(M, T, duration|delay|stagger|exit|easing)   the variable a motion
%                                  setting is. The first four are durations; the
%                                  fifth is a curve, and a `curve` token with two
%                                  alternatives is a FEEL the document holds both
%                                  ends of, exactly as a `duration` token is a
%                                  motion scale
%   measing(M, T, C)               derived: the curve, as one of the eight menu
%                                  words or as cubicBezier(X1,Y1,X2,Y2) with the
%                                  control points in THOUSANDTHS. Projected, so
%                                  two curves are two designs
%   bezier(Lit, X1, Y1, X2, Y2)    the seventh literal bridge: the four control
%                                  points a literal reads as. Exact or absent —
%                                  a decimal point anywhere reads as no curve at
%                                  all, and X outside 0..1000 is a curve that
%                                  runs backwards in time rather than a slow one
```

## 1.7 The document reader

`normalizeTransitions` (`project.ts:1230`) replaces the `Object.hasOwn(EASINGS,
easing)` test with one line:

```ts
const easing = settingValue(raw.easing, "easing");
```

**This is the migration and it is free.** `settingValue` takes a string and
returns `single(raw)` (through `snapValue`, which does nothing for a type with no
`length` quantity), so every existing document's `easing: "easeOut"` reads back as
`[lit("easeOut")]` — the same curve, now a one-alternative value, which is not a
choice anybody makes and adds no universes. A stored word the menu does not know
is **no longer dropped by the reader**: it is kept as a literal, and both the
program (`measeopt/1`) and `cssEasing` fall back on it. That is a deliberate move
of the repair from the reader to the readers, and it is the right way round for
the reason the existing comment there gives about a bogus trigger: a trigger
decides *whether* the machine ever moves and is refused at the door; an easing
only decides the shape of the curve, and a document should not lose what somebody
typed because a menu shrank.

`normalizeKeyframes` takes the identical line for `raw.easing`.

## 1.8 The UI surface

### 1.8.1 `Transitions.tsx`

The `<select>` at 461–476 is deleted. In its place, `easing` becomes a
**fourth `motionRow`-shaped row** — a `ValueEditor` with `type="easing"`, so it
varies, greys, pins, takes a token and shows the resolved literal exactly as the
three duration rows already do. It goes above the three, because the curve is
what a designer changes first.

```tsx
<div className={styles.motion} data-role="transition-easing" data-transition={transition.id}>
	<ValueEditor
		testId="transition-easing"
		label="Easing"
		type="easing"
		value={transition.easing ?? []}
		tokens={tokensOfType(scene, "easing")}
		fallback={DEFAULT_EASING}
		active={picks[easingVariable]}
		varying={varying.has(easingVariable)}
		reachable={reach?.[easingVariable]}
		pinned={pins[easingVariable]}
		onPin={(index) => onPin(easingVariable, index)}
		preview={(term) => resolveValue(context, [term], easingVariable)}
		onChange={(next) =>
			write({ easing: next.length > 0 ? next : undefined },
				`easing-${machine.id}-${transition.id}`)
		}
	/>
	<CurveField
		value={easingOf(machine, transition, context)}
		onChange={(text) => write({ easing: [lit(text)] }, `curve-${machine.id}-${transition.id}`)}
	/>
</div>
```

`data-role="transition-easing"` is kept from the deleted `<select>` so the
existing e2e selector still finds the control.

The spring hint is one line under the row, rendered only where the resolved
literal is a spring:

```tsx
{spring ? (
	<p className={styles.finding} data-role="transition-spring-natural">
		This spring settles naturally in {writeDuration(spring.natural)}. What paces
		it here is the duration below, because a duration is the one number every
		row, every check and every exported declaration in this document is written
		around — see §1.4.
	</p>
) : null}
```

### 1.8.2 `CurveField` — one new component, two callers

`app/src/design/CurveField.tsx`. Shown only when the resolved literal reads as a
`cubicBezier(…)`, or when the designer opens it from a "Custom curve" disclosure
beside the menu. Four number inputs (in hundredths, displayed as `0.20`; stored
as thousandths) and a 64×64 SVG preview of the curve with the two control handles
drawn. It writes **one literal through the same `onChange`**, so tokens,
alternatives, pins and undo all keep working; it is a spelling aid and never a
second storage path.

**Rejected: a free text field where the designer types `cubic-bezier(.2,0,0,1)`.**
The stored dialect is `cubicBezier(200,0,0,1000)`, so a text field would either
demand thousandths of a person (a typo `bezierOf` refuses in silence) or accept
CSS and translate — which is a second dialect and a second place the two can
disagree.

Both `Transitions.tsx` and `Timeline.tsx` use it — the keyframe easing
`<select>` at `Timeline.tsx:289` takes the same widening — which is why it is a
component and not forty lines inline.

### 1.8.3 `Studio.tsx` and the canvas

`Studio.tsx:1910` becomes:

```ts
easing: cssEasing(edge.transition.easing === undefined
	? DEFAULT_EASING
	: (answer?.machines[edge.machine.id]?.easing[edge.transition.id]
		?? easingOf(edge.machine, edge.transition, context)))
	?? EASINGS[DEFAULT_EASING].css,
```

and the value goes into `--dc-play-easing`, which already exists in
`Artboard.module.css:46`. **The canvas needs no `@supports` dance**: the studio
runs in whatever browser the designer has open right now, and every browser that
can run this app parses `linear()`. Only the exported file, which is a thing
somebody keeps, needs the fallback.

`ModelMachine` gains `easing: Record<string, string>` — transition id → the
literal this universe resolved, read from `measing/3` — beside `duration`,
`delay`, `stagger` and `exit`. `TransitionsProps.timing` gains an `easing?:
string` field for the same reason its `exit?: number` is there.

## 1.9 Part One test plan, by assertion name

**`values.test.ts`**
- `"one default, two tables"` — `VALUE_TYPES.easing.fallback === DEFAULT_EASING`.
- `"every spring's checked-in linear() is what its physics gives"` — for each
  spring, `sampleSpring(spec)` rounded to four places, joined, equals the `css`
  string. This is what makes the constants reviewable.
- `"a sampled spring is pinned at both ends and never runs backwards in time"` —
  first stop exactly `0`, last exactly `1`, `SPRING_STOPS` stops.
- `"bezierOf is exact or nothing"` — `cubicBezier(200,0,0,1000)` reads as
  `[200,0,0,1000]`; `cubicBezier(340, 1560, 640, 1000)` reads (y overshoots);
  `cubicBezier(1200,0,0,0)` does not (x out of range); `cubicBezier(0.2,0,0,1)`
  does not (a decimal is ambiguous by a factor of a thousand);
  `cubic-bezier(0.2,0,0,1)` does not (that is CSS, not the dialect).
- `"cssEasing writes CSS for all eight words and for a bezier, and nothing else"`.

**`project.test.ts`**
- `"an easing stored as a bare word reads as a one-alternative value"` — the
  migration. `{ easing: "easeOut" }` → `[lit("easeOut")]`, round-trips, and the
  scene's universe count is unchanged.
- `"an easing the menu has not got is kept rather than dropped"` — `"wobble"`
  survives the reader; `easingOf` falls back to `easeOut`; the transition is
  still in the document.

**`machineprogram.test.ts`**
- `"an easing is a value: it follows a token, refuses a word the menu has not
  got, and falls back"` — three edges, `measing` reads
  `{ over: "springSnappy", back: "easeOut", press: "easeOut" }`, and
  `compile(scene).variables[motionVar("m1","over","easing")] === 1`.
- `"a curve token with two alternatives is two designs"` — **the projection
  test.** `run(feel(["easeOut","springSnappy"])).count === 2`; the control with
  one alternative is `1`; and the two universes really differ in `measing`'s
  third argument. Deletes without `#project measing/3.`
- `"a custom bezier reaches the program as a term and never as a word"` —
  `measing(m1,over,cubicBezier(200,0,0,1000))` present; no `word(_, cubicBezier…)`;
  `bezier/5` present for that literal and for no other.
- `"the seventh bridge costs a document with no curve in it nothing"` — no
  `bezier(` anywhere in the program text for the button template.
- `"springs add no universes"` — the same document with `easeOut` and with
  `springSnappy` has the same universe count, and sorted-set equality of every
  atom except the `measing` ones.
- `"a keyframe's curve is a value and is projected"` — the same pair of
  assertions over `mkeasing/5`.

**`machines.test.ts`**
- `"easingOf follows a token and falls back three ways"` — absent, resolving to
  nothing, and resolving to a word the menu has not got, all `easeOut`.
- `"keyEasing is the same reader over a keyframe, and the last key's is still
  read by nothing"`.
- `"a TrackSample carries the literal and not an Easing"` — a bezier survives
  `sampleTimeline`.

**`export.test.ts`**
- `"a spring exports as a custom property with a curve in front of it"` — the
  `:root` block holds `--dc-ease-springSnappy: cubic-bezier(0.2, 0, 0, 1);`, an
  `@supports (transition-timing-function: linear(0, 1))` block redefines it to a
  `linear(` with 65 stops, and the node's rule says
  `transition: … var(--dc-ease-springSnappy) …`.
- `"a document with no spring emits neither block"` — no `--dc-ease-` and no
  `@supports` anywhere. **The no-regression assertion.**
- `"a rest/hover pair with a spring still collapses to :hover"` —
  `exportMachines(...).runtime === null` and the selector is `:hover`. A curve is
  not a trigger.
- `"a curve token's two alternatives are two files"` — the two universes export
  two different `transition` declarations.

**Golden fixtures.** `spatialprogram.goldens.json` must **not** move in Part One:
no template uses a spring or a bezier, `easeOut` still writes `ease-out`, and the
runtime text is untouched. If it does move, something other than this rung
changed and the fixture is reporting a genuine difference — the rule
`runtime.ts:796–815` states, applied one feature over.

---

# PART TWO — GESTURES

## 2.1 Confirming what the export does today

`pseudoClassFor` (`export.ts:2860`) reads `TRIGGERS[enter.trigger].css` and
returns `null` on the first clause:

```ts
const spec = TRIGGERS[enter.trigger];
if (spec.css === null || spec.pair !== leave.trigger) return null;
```

So a state entered by any trigger with `css: null` gets, in `stateLayerFor`
(3362–3366):

```ts
const on =
	pseudoClassFor(machine, stratum, drawnIn, state.id) ??
	(first ? `[data-state="${state.id}"]` : `[data-state-${stratum}="${state.id}"]`);
```

— an attribute selector — and back in `planMachines` (3143):

```ts
if (!layer.on.startsWith(":")) scripted = true;
```

— so `MachineExport.runtime` becomes the emitted script instead of `null`.

**Confirmed: a machine using a scroll or drag trigger emits a `data-state` rule
plus the `<script>`, and `export.ts` needs no change at all for that to be
true.** The file's own comment says so — "a new trigger with a pseudo-class is
one entry in `scene.ts` and no change at all in this file" — and the converse is
what we are relying on. What `export.ts` does gain in Part Two is one `lost`
sentence per gesture-driven machine (§2.6) and the scroll-timeline emission
(§2.5), and neither touches `pseudoClassFor`.

## 2.2 Four new triggers, defined precisely

### 2.2.1 What `scroll` means

Two readings were available:

1. **This element entered the viewport** — `IntersectionObserver`, per instance,
   with a matching leave.
2. **The page scrolled** — a global event with no element identity.

**Reading (2) is rejected and it is not close.** It has no pair, so every state
it entered would be a one-way door with no edge back; it is the same event for
every instance on the page, so a machine could not tell which button it was
about; and "the page scrolled at all, ever" is true within four hundred
milliseconds of a page opening and false never again. It would make every machine
that used it settle immediately and stay there.

**`scroll` therefore means (1)**, and it is a pair:

```ts
viewenter: {
	label: "Scrolls into view",
	// No DOM event, and unlike `load` that is not because it fires once: an
	// IntersectionObserver is how a browser tells us a geometric fact changed,
	// which is `source` below rather than `event` here. Keeping `event` empty is
	// what stops `start()` attaching a listener for an event name that does not
	// exist.
	event: "",
	source: "view",
	// CSS has no pseudo-class for "on screen". `:target` is the fragment,
	// `animation-timeline: view()` is a clock and not a state, and there is no
	// third candidate — so a machine that reveals on scroll is a data-state rule
	// and a script, which §2.5 is the one exception to.
	css: null,
	pair: "viewleave",
},
viewleave: {
	label: "Scrolls out of view",
	event: "",
	source: "view",
	css: null,
	pair: "viewenter",
},
```

**Precisely**: `viewenter` fires when the instance's element goes from not
intersecting the viewport to intersecting it by any amount — `threshold: 0`, the
observer's default. `viewleave` fires on the opposite crossing. No threshold
field, and that is a decision: "any pixel" is what a person means by "on screen",
a fraction would be a number nobody could pick correctly for two different
elements, and a designer who wants "half of it" writes a timeline whose clock is
the scroll (§2.4) rather than a state that flips at 50%.

An element **already on screen when the page loads** gets `viewenter` from the
observer's initial record, which arrives on the frame after `observe()` is
called — so after `settle()` has run and after the first paint. That ordering is
specified in §2.3 and it is the difference between a reveal that works and one
that has already happened before anybody sees it.

### 2.2.2 What `drag` means, and the threshold

A drag with no threshold is `pointerdown` under a different name, and
`pointerdown` already exists with `:active` behind it. **The threshold is what
makes it a drag.**

```ts
dragbegin: {
	label: "Drag begins",
	// Deliberately NOT the HTML5 `dragstart` event, and the constant is spelled
	// differently from it for exactly that reason. The HTML drag-and-drop API
	// needs `draggable="true"`, paints a ghost image the page cannot style, does
	// not fire on touch at all, and is about transferring data rather than about
	// a gesture. What a designer means by "drag" is a pointer that went down and
	// then moved, and that is recognised from pointer events — `source` below.
	//
	// A maintainer who "fixes" this by filling in `event: "dragstart"` will get a
	// machine that moves only under a mouse, only after the browser's own drag
	// heuristics agree, and never on a phone.
	event: "",
	source: "drag",
	css: null,
	pair: "dragend",
},
dragend: {
	label: "Drag ends",
	event: "",
	source: "drag",
	css: null,
	pair: "dragbegin",
	/**
	 * The trigger this one swallows once, because a gesture that ended is not
	 * also a click.
	 *
	 * A browser does the same thing with a real drag on a link, and the two
	 * interpreters have to agree about it or a machine with a drag edge *and* a
	 * click edge would move twice in the studio and once in the file. Named in
	 * the table rather than written into the runtime text, so that the emitted
	 * interpreter contains no trigger id at all — the same argument
	 * `TRIGGER_EVENTS` already makes about not baking `focusin` into the script.
	 */
	suppresses: "click",
},
```

**Threshold: 3 CSS pixels, measured on the raw pointer coordinates.** Three
because it is the smallest slop that survives a shaky click and is what every
drag library converges on; Chromium's own is 5 and iOS's scroll threshold is
about 10, and both of those are tuned for a different question (should this
become a scroll?). It is **not** a per-transition setting, for `MachineInput`'s
own reason: it is a property of *the hand*, not of the design, and a document
holding two opinions about it would be a document that could not say whether its
own gesture worked.

It lives once, in `scene.ts`:

```ts
/**
 * How far a pointer must move while down before the runtime calls it a drag, in
 * CSS pixels.
 *
 * **Screen pixels and never document ones.** The studio's canvas pans and zooms,
 * so three document pixels at 25% zoom is under one pixel of finger travel and
 * at 400% is twelve — and a threshold that changed with the zoom would be a
 * gesture that behaved differently depending on how closely somebody was
 * looking. It is measured on the raw event coordinates in both readers.
 */
export const DRAG_SLOP_PX = 3;
```

**What undoes it**: `pointerup`, and `pointercancel`, and the pointer being lost
— all three end the drag and all three fire `dragend` if one had begun. The
runtime takes a pointer capture at the moment `dragbegin` fires, so a drag that
leaves the element keeps reporting; the capture is released at `dragend`.

### 2.2.3 `TriggerSpec` gains two columns

```ts
/** How a runtime hears about a trigger that is not a DOM event on the element. */
export type TriggerSource = "view" | "drag";

export interface TriggerSpec {
	label: string;
	event: string;
	css: "hover" | "active" | "focus-visible" | null;
	/**
	 * The trigger that undoes it.
	 *
	 * The comment here used to say "where the pair is what CSS understands",
	 * which was true of the six that shipped and is a narrower claim than the
	 * field makes. A pair is a fact about the *gesture* — a drag that begins
	 * ends, a thing that scrolls in scrolls out — and `pseudoClassFor` reads
	 * `css` first and short-circuits before it ever gets here, so setting it on a
	 * trigger with no pseudo-class changes no behaviour and says something true.
	 */
	pair?: Trigger;
	/**
	 * Where the runtime hears it, where a listener on the instance's own element
	 * is not where.
	 *
	 * Absent is the ordinary case and covers seven of the twelve: `event` names a
	 * DOM event and `listen()` attaches to it. `load` is absent too and has an
	 * empty `event`, which is the third case — fired once by `settle()` and never
	 * bound at all.
	 */
	source?: TriggerSource;
	/** A trigger this one swallows once — see `dragend`. */
	suppresses?: Trigger;
}
```

`Trigger` grows from eight members to twelve. **What that costs**, in the voice of
the `MotionProp` essay, because the essay is right that the cost of a union
member is the thing to write down before adding one: `TRIGGERS` is a
`Record<Trigger, …>` so it must gain four entries or the file does not typecheck;
`TRIGGER_BINDINGS` is derived and gains them free; `RuntimeLayer.edges` is a
`Partial<Record<Trigger, …>>` and gains them free; the trigger `<select>` in
`Transitions.tsx` maps `TRIGGER_NAMES` and gains them free; `runtime.ts`'s
`listen()` keys off `events[trigger]` being non-empty and would therefore
**silently never bind them**, which is the whole reason `source` exists; and
`Editor.tsx` must decide, for each one, whether the canvas fires it (§2.7). Four
table entries and two decisions. **No universes**: a trigger reaches the program
as `mtrigger(M,T,G)`, a fact, and `machineprogram.test.ts` asserts the count is
unchanged.

## 2.3 What the exported runtime does

Everything below is DOM binding, and **not one line of it is inside `stepIn`,
`allows`, `fireIn`, `setIn` or `settle`.** That is the load-bearing claim of Part
Two: a new trigger is a new way of *calling* `fire`, never a new thing inside the
step function — so `stepLayer` in `machines.ts` and the emitted text stay the
agreeing pair that `runtime.test.ts`'s matrix proves, and the matrix widens by
four columns without changing shape.

### 2.3.1 The table serialised beside the script

`TRIGGER_EVENTS` is replaced by:

```ts
/**
 * The two columns of {@link TRIGGERS} the runtime needs, serialised into the
 * script beside the table.
 *
 * A widening of `TRIGGER_EVENTS` rather than a second constant, and the
 * argument that constant already made is the argument for widening it: a copy of
 * any of this baked into {@link MACHINE_RUNTIME} would be a second statement of
 * `TRIGGERS`, and the day somebody decides a drag is five pixels rather than
 * three — or that `focus` listens for `focusin`, which is exactly the decision
 * `scene.ts` already records — the panel and the exported file would quietly
 * stop agreeing about what a trigger is.
 *
 * `label` is deliberately left out. It is the only column of the four that
 * nothing in the script could act on, and eight labels is two hundred bytes in
 * every exported file.
 */
export const TRIGGER_BINDINGS: Record<
	Trigger,
	{ event: string; source?: TriggerSource; suppresses?: Trigger }
>;
```

`evalRuntime` and `runtimeScript` pass it in `E`'s place; `runtime.test.ts`
updates in the same commit. The runtime text's two readers of `events[trigger]`
become `bindings[trigger].event`.

`DRAG_SLOP_PX` travels on the **table**, not as a seventh factory parameter:

```ts
export interface MachineTable {
	instances: /* … */;
	machines: /* … */;
	/**
	 * Settings that belong to no machine — the gesture thresholds, today just
	 * one.
	 *
	 * On the table rather than as another parameter to the runtime factory,
	 * because the table is the thing both interpreters already read and the
	 * factory signature is a thing three files agree about. Optional for
	 * `layerStart`'s reason exactly: two files build a `MachineTable` by hand in
	 * a fixture, and a required field would fail their typecheck rather than
	 * their tests. `machineTable` always fills it.
	 */
	settings?: { dragSlop: number };
}
```

### 2.3.2 The two binders, added to `MACHINE_RUNTIME`

Both obey the file's constraints: ES5, no arrow functions, no `const`, whole-line
`//` comments only (so `runtimeSource()`'s line filter stays safe), **and no
timer of any kind**.

```js
var slop = T && T.settings && typeof T.settings.dragSlop === "number"
  ? T.settings.dragSlop : 3;
// Instance -> the pointerdown that may become a drag, as [x, y] in client
// coordinates; null once it has or once the pointer is gone.
var origin = {};
// Instance -> true while a drag is in progress.
var dragging = {};
// Instance -> the trigger the drag that just ended swallows once. Read off the
// table's suppresses column, so this text holds no trigger id of its own.
var swallow = {};

function usesSource(machine, source) {
  var layers = machine.layers || [];
  for (var i = 0; i < layers.length; i++) {
    var edges = layers[i].edges;
    for (var from in edges) {
      if (!owns(edges, from)) continue;
      var row = edges[from];
      for (var trigger in row) {
        if (owns(row, trigger) && bindings[trigger] && bindings[trigger].source === source) return true;
      }
    }
  }
  return false;
}

function endDrag(instance) {
  origin[instance] = null;
  if (!dragging[instance]) return;
  dragging[instance] = false;
  swallow[instance] = bindings.dragend ? bindings.dragend.suppresses : undefined;
  fireIn(instance, "dragend");
}

function bindDrag(instance, element) {
  element.addEventListener("pointerdown", function (event) {
    origin[instance] = [event.clientX, event.clientY];
    dragging[instance] = false;
  });
  element.addEventListener("pointermove", function (event) {
    var at = origin[instance];
    if (!at || dragging[instance]) return;
    var dx = event.clientX - at[0];
    var dy = event.clientY - at[1];
    // Squared, so no square root and no floating-point comparison against a
    // threshold that is a whole number of pixels.
    if (dx * dx + dy * dy < slop * slop) return;
    dragging[instance] = true;
    // Capture, so the drag keeps reporting once the pointer leaves the element.
    // A drag that stopped at the edge of the thing being dragged would be a
    // gesture that ends when it starts working.
    if (element.setPointerCapture) element.setPointerCapture(event.pointerId);
    fireIn(instance, "dragbegin");
  });
  element.addEventListener("pointerup", function () { endDrag(instance); });
  element.addEventListener("pointercancel", function () { endDrag(instance); });
  element.addEventListener("lostpointercapture", function () { endDrag(instance); });
}

// One observer for the whole document, because a browser coalesces records
// across targets and N observers is N callbacks per scroll.
//
// An IntersectionObserver is NOT a clock, and the distinction is the one this
// file is built around: it is the browser telling us, on its own schedule, that
// a geometric fact changed. It is addEventListener for geometry. Nothing here
// polls, nothing here schedules, and the assertion in runtime.test.ts that
// setTimeout, setInterval and requestAnimationFrame do not appear in this text
// is unchanged and still passes.
function observeViews(ids) {
  if (typeof IntersectionObserver === "undefined" || ids.length === 0) return;
  var seen = {};
  var observer = new IntersectionObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var id = records[i].target.getAttribute("data-node");
      if (id === null || !owns(instances, id)) continue;
      var inside = records[i].isIntersecting;
      // Crossings only. An observer re-reports on resize and on a scroll that
      // did not change the answer, and a machine that fired viewenter twice
      // would take a second edge out of the state the first one arrived in.
      if (seen[id] === inside) continue;
      seen[id] = inside;
      fireIn(id, inside ? "viewenter" : "viewleave");
    }
  });
  for (var j = 0; j < ids.length; j++) {
    if (elements[ids[j]]) observer.observe(elements[ids[j]]);
  }
}
```

`listen()` grows one clause, table-driven:

```js
function listen(instance, trigger, element) {
  element.addEventListener(bindings[trigger].event, function () {
    // A drag that ended swallows the click the browser sends after it. Read off
    // the table rather than tested against a trigger id, so this text still
    // contains no trigger name at all.
    if (swallow[instance] === trigger) {
      swallow[instance] = undefined;
      return;
    }
    fireIn(instance, trigger);
  });
}
```

### 2.3.3 `start()`, and why the order matters

```js
function start() {
  var id;
  var watching = [];
  bind();
  for (id in instances) { if (owns(instances, id)) { seed(id); begin(id); } }
  for (id in instances) {
    if (!owns(instances, id)) continue;
    var element = elements[id];
    var machine = machineOf(id);
    if (!element || !machine) continue;
    var used = triggersOf(machine);
    for (var trigger in used) {
      if (owns(used, trigger) && bindings[trigger] && bindings[trigger].event) {
        listen(id, trigger, element);
      }
    }
    if (usesSource(machine, "drag")) bindDrag(id, element);
    if (usesSource(machine, "view")) watching.push(id);
  }
  for (id in instances) { if (owns(instances, id)) settle(id); }
  // Observed LAST, and after settle. An IntersectionObserver delivers an initial
  // record for everything it is given, so an element already on screen gets
  // viewenter on the frame after this line — which is what a reveal wants, and
  // which arriving before the load chain had run would have overwritten.
  observeViews(watching);
}
```

### 2.3.4 What the exported file therefore does

- A rest/hover pair still exports as `:hover` and no script. Unchanged.
- A machine with a drag pair exports a `[data-state="dragging"]` rule, the
  script, a pointer recogniser, and a `transition:` declaration paced by the
  edge going in — so the *appearance* of dragging (lift, shadow, scale) is CSS
  and only the state flip is script. That is the same division of labour the
  hover pair has.
- A machine with a view pair exports the same shape plus one shared observer.
- **The element does not move with the pointer.** A drag trigger says "the
  machine is now in the dragging state"; it does not carry the pointer's
  position. Making it do so would be a `transform` written every pointermove by a
  script, which is the second animator arguing with the compositor that
  `runtime.ts` refuses. A designer who wants the thing to follow the finger wants
  a number input driven by the pointer, and that is the deferred feature in §2.8.

## 2.4 Scroll-linked effects — the recommendation, and why the premise is wrong

**Recommended: a scroll-linked effect is a *clock* on the state that already
plays a timeline. It is one optional word-valued field, one ASP fact, one export
branch, and no change whatsoever to `runtime.ts` or `useMachinePlayback.ts`.**

**Rejected: scroll progress as a number input driving a 1D blend.**

### 2.4.1 The premise does not hold, and finding that out is the whole argument

The brief says: "scroll progress as a number input in permille, driving a 1D blend
across timelines, is parallax with nothing new invented". I went looking for what
it would cost and found that it does not do the thing.

Read `blendWeights` (`machines.ts:3015`) and `sampleTimeline` (`machines.ts:2926`)
together. A 1D blend lays *whole timelines* along the axis of a number input and
returns **which timelines are playing and how much of each**. It returns no time.
Where the timelines are *scrubbed to* is a separate quantity entirely — in the
studio it is `Playback.scrub`, "where the timeline scrubber is, per instance, in
milliseconds", set by a hand on a slider.

So a 1D blend is a **selector**, and that is not an accident of this
implementation: it is what a 1D blend is in Rive, where the input picks between
an idle and a run cycle and the *clock* keeps running underneath. Parallax is the
opposite shape. Parallax has **one** timeline, and what the scroll decides is
**where in it you are**.

Wiring scroll to a blend input therefore gives: as you scroll, the mix crossfades
from one timeline to another, both of them stuck at whatever millisecond the
scrubber last sat at. That is not parallax. It is a crossfade with a stopped
clock. To make it parallax you would additionally have to drive `Playback.scrub`
from the same scroll position — at which point the blend is doing nothing, the
input is doing nothing, and the actual mechanism is "the scroll is the clock",
which is the recommendation.

Three further costs, if it had worked:

- **The exported file could not do it.** `runtime.ts` says, in a paragraph headed
  "What is deliberately not here: timelines and blends", that neither is in
  `MachineTable` and that a sampler in the emitted text "would be exactly the
  two-implementations-that-drift problem this whole file exists to prevent". A
  scroll-driven blend would need exactly that sampler.
- **It would need a scroll listener with no frame budget.** `requestAnimationFrame`
  is forbidden and asserted absent. A `scroll` listener that calls
  `getBoundingClientRect` per driven instance and then re-samples keyframes, on
  every scroll event, with no coalescing, is the shape of a page that janks.
- **It has no CSS to degrade to.** Which the recommendation does, and that is
  what makes the recommendation cheap.

### 2.4.2 What is added

```ts
/**
 * What advances a timeline: wall time, or a scroll position.
 *
 * Bare constants, and the spelling matters for {@link BlendKind}'s reason
 * exactly — a clock reaches the program as itself, inside `mclock/3`.
 *
 * `view` is **this element's** pass through the viewport, `page` is the
 * document's own scroll. Two and not one, because they are two different
 * sentences a designer says: "the hero image drifts as it goes by" is about the
 * element, and "the progress bar fills as you read" is about the page. Both are
 * CSS scroll-timeline concepts and the names are chosen to say which — `view()`
 * and `scroll()` — so that the document and the stylesheet it becomes use one
 * vocabulary.
 */
export type TimelineClock = "time" | "view" | "page";

export const TIMELINE_CLOCKS: Record<
	TimelineClock,
	{
		label: string;
		/** The CSS `animation-timeline` value, or null for wall time. */
		css: string | null;
	}
> = {
	time: { label: "Time", css: null },
	view: { label: "This element's pass through the view", css: "view()" },
	page: { label: "The page's scroll", css: "scroll(root block)" },
};
```

and one field on the record that already plays a timeline:

```ts
export interface MachineState {
	/* … */
	/**
	 * What advances {@link timeline} — wall time, or a scroll position.
	 *
	 * Absent is `time`, which is every state in every document today and must go
	 * on meaning exactly what it meant.
	 *
	 * **On the state and not on the timeline**, which is the same choice
	 * {@link timeline} itself made and for the same reason: two states routinely
	 * play one animation, and a `loop` that ran on wall time while a `parallax`
	 * state played the same keyframes off the scroll is a real document. Putting
	 * it on {@link Timeline} would make the two states rename each other's
	 * animation.
	 *
	 * **A plain word and never a {@link Value}, and this is the one place in this
	 * document where that answer goes the other way from §1.2's.** An easing is a
	 * *feel*, and a feel is a scale a design system holds one end of — a `curve`
	 * token pointed at by every transition is a real thing to write. A clock is
	 * *wiring*. There is no scale for it to be on, nothing points at it twice, and
	 * a token holding `["time","view"]` would be a document that could not say
	 * what its own parallax is attached to. Same judgement {@link MachineInput}
	 * makes about a range: a budget is the thing alternatives are judged against,
	 * not a thing that has them.
	 *
	 * Read by nothing where {@link timeline} is absent, and kept rather than
	 * refused — a state that stops playing a timeline should not lose what
	 * somebody typed.
	 */
	clock?: TimelineClock;
}
```

### 2.4.3 Why this is the right shape — six reasons

1. **The studio needs no change at all.** `Playback.scrub` already exists and is
   already "a *position*, set by a hand on a slider" — `useMachinePlayback.ts`'s
   own words, in the paragraph explaining why there is no play button. A scroll
   clock is the exported file's hand on that same slider. The only edit is the
   scrubber's **label**, and one sentence in the Timeline panel saying so. Not one
   line of `useMachinePlayback.ts` or `runtime.ts` moves.
2. **The exported file needs no script.** `animation-timeline: view()` is the CSS
   feature that does exactly this, the `@keyframes` block already exists —
   `playTimelines` writes one per (instance, timeline, part) — and the `animation`
   declaration is already on the state's rule. The whole emission is three extra
   declarations. See §2.5.
3. **It is the same question `pseudoClassFor` already asks, one feature over.**
   The export already looks at a machine and asks "is there a CSS shape for
   this?", answering with a stylesheet where there is and a script where there is
   not. A scroll-clocked timeline is that question asked about a clock instead of
   about a state. That parallel is the argument: this is not a new concept in the
   export, it is a second instance of the one the export is built around.
4. **It adds no universes and needs no projection.** A clock is a word the
   document states, so `mclock(M,S,C)` is a fact — like `mslayer/3`, one per
   state — and a fact is in every answer set. Nothing to project, nothing to
   collapse.
5. **It composes with everything.** A scroll-clocked state is still a state: it
   has a delta, it is entered by a transition with a duration and a curve, it
   sits in a layer, it can be hidden. A separate `ScrollEffect` record on the
   scene would have been none of those things, and would have needed its own
   values, its own variables, its own `#show`s, its own checks and its own
   argument for why adding one adds no universes.
6. **The keyframes stay solved.** Every keyframe's time and value is a `Value`
   resolved per universe, so a parallax whose overshoot names a `--beat` token
   really is two designs. That is a property this inherits for free from the
   timeline machinery and would have had to earn again from scratch.

### 2.4.4 What it costs, honestly

- **Browser support.** `animation-timeline` is Chrome/Edge from 115 and Firefox
  from 144; Safari does not have `view()` as of this writing. Behind `@supports`
  a non-supporting browser gets **no animation at all** — the element sits at the
  state's own pose, which is a static design rather than a broken one. §2.5.2
  argues that choice against the alternative.
- **No animation range field.** `view()`'s default range is `cover 0%` to
  `cover 100%` — the element's entire pass across the viewport — which is the
  standard parallax window and needs no document field. A designer who wants a
  shorter window has no way to say so. That is the obvious next thing and it is
  deliberately not here: `MachineState.range?: [string, string]` is two more
  fields and two more things to validate, for a refinement nobody asks for until
  they have used the first version.
- **`mexitpast/2` stops meaning anything for a scroll-clocked state**, because
  the state's timeline has no wall-clock length to be past. §2.6.3 fixes that
  with one body literal.

## 2.5 Emitting a scroll-clocked timeline

### 2.5.1 The mechanism

`playTimelines` writes, per animated node, a `Declarations` entry like
`{ animation: "dc-tl-b1-para-panel 800ms linear both" }`. For a scroll-clocked
state the export writes **longhands plus a gated name**:

```css
/* Once, at the top of the stylesheet. */
:root {
	--dc-tl-b1-para-panel: none;
}
@supports (animation-timeline: view()) {
	:root {
		--dc-tl-b1-para-panel: dc-tl-b1-para-panel;
	}
}
```

```css
/* On the node's rule, exactly where the `animation` shorthand went before. */
.n9 {
	animation-name: var(--dc-tl-b1-para-panel);
	animation-duration: auto;
	animation-timing-function: linear;
	animation-fill-mode: both;
	animation-timeline: view();
}
```

**Why the custom property rather than putting the rule inside `@supports`.**
`Declarations` is `Record<string, string>` — one key, one property — and
`StateLayer.changed` / `MachineExport.playing` are maps of those. A rule split
across an `@supports` boundary cannot be expressed in that shape without turning
every declaration map in the file into a list of blocks. The custom property
moves the conditional to `:root`, where it is one line, and leaves the node's
rule a flat set of declarations. Exactly the trick §1.5.1 uses for springs, for
exactly the same structural reason.

The other four declarations are harmless in a browser that ignores them:
`animation-timeline` is dropped as unknown, `animation-duration: auto` is dropped
as invalid, and `animation-name: none` means nothing plays regardless.

### 2.5.2 Rejected: degrade to the animation running on wall time

The cheaper emission is the `animation` shorthand as today plus
`animation-timeline: view()` on top, so a browser without scroll timelines plays
the animation once, on load, at its authored duration.

**Refused.** A parallax that fires once when the page opens, before the element is
anywhere near the viewport, is motion at the wrong moment — which reads to a
person as a bug, where a still element reads as a design. "No animation" is the
honest degradation and "the wrong animation" is not.

### 2.5.3 `scrollTimelineFor` — the sibling of `pseudoClassFor`

```ts
/**
 * The `animation-timeline` a state's timeline is driven by, or nothing where it
 * runs on wall time.
 *
 * Deliberately shaped as `pseudoClassFor`'s twin, and placed beside it, because
 * it is the same question: is there a CSS shape for what this machine says? That
 * function answers with a pseudo-class where the trigger pair has one and with a
 * data-state rule where it has not; this one answers with a scroll timeline
 * where the clock has one and with wall time where it has not. Neither is a
 * feature the document knows about — the document says one thing, and the export
 * finds the CSS-native path where there is one.
 */
function scrollTimelineFor(state: MachineState): string | null;
```

`MachineExport` gains `scrolled: Set<string>` — the `@keyframes` names that are
gated — which the HTML emitter turns into the `:root` pair and the `@supports`
block, and one `lost` sentence names them.

## 2.6 The rest of the generated program

### 2.6.1 One fact per state

```
mclock(M, S, C)
```

emitted for **every** state, defaulting to `time` where the document is silent —
one fact per state, the same order `mslayer/3` already is, which is what lets the
rules below read `mclock(M,S,time)` positively rather than negating two
alternatives.

`#defined mclock/3.` joins the block, and:

```
#show mclock(M,S,C) : mclock(M,S,C), scenery.
```

shown for `mloop/3`'s reason, which is right beside it: the Machines and Timeline
panels read a timeline's settings out of the model rather than asking the
document a second question. `ModelMachine` gains `clocks: Record<string,
TimelineClock>`.

No `#project`. A clock is a fact, not a variable — §2.4.2.

### 2.6.2 Documentation

`compile.ts`'s `CONTRACT`, in the timelines section:

```
%   mclock(M, S, time|view|page)   what advances the timeline state S plays:
%                                  wall time, this element's pass through the
%                                  viewport, or the page's own scroll. A fact
%                                  and never a variable — a clock is wiring, and
%                                  there is no scale for it to be on
```

and the trigger list gains the four words.

### 2.6.3 One rule narrowed

```
% Only where the state's timeline runs on a clock an exit time can be measured
% against. A scroll-clocked timeline has no wall-clock length, so "the trigger
% can never arrive late enough" is a sentence about nothing — the state finishes
% when the reader scrolls past it, which is not a duration.
mexitpast(M,T) :- …, mclock(M,S,time).
```

### 2.6.4 No new check

`LADDER_CHECKS` does **not** grow. A gesture whose undo edge is missing leaves
the machine stuck in the state it entered, and `mdeadend/2` already reports
exactly that, already has a canned rule (`machine_no_dead_ends`), and already
names the state. A second check saying the same thing about two specific triggers
would be a check that goes quiet the day somebody adds a third gesture.

## 2.7 The studio

### 2.7.1 `Editor.tsx` fires the drag pair and not the view pair

`onPreviewMove` gains slop tracking against the **raw** event coordinates (not
`toDocument(event)`, per `DRAG_SLOP_PX`'s comment: the canvas zooms and the hand
does not), firing `dragbegin` once on the first crossing. `onPreviewUp` and
`onPreviewLeave` fire `dragend` where a drag had begun, and suppress the
synthesised `click` in the same way the runtime does — reading `suppresses` off
`TRIGGERS`, so the two readers cannot disagree about whether a drag is also a
click.

**`viewenter` and `viewleave` are not fired from the canvas at all**, and the
argument is `onPreviewUp`'s own, word for word one feature over: the canvas has
no viewport to enter. An artboard is a box the camera pans and zooms over rather
than a page somebody scrolls, and firing a view trigger when a node crossed the
*editor's* viewport edge would make the studio disagree with the exported file
about the one thing the two are supposed to agree on — while also firing every
time somebody panned. A view state is authored, exported, read in the panel, and
**played from the state strip**, exactly as a focus state already is.

### 2.7.2 `useMachinePlayback.ts` — no change

Stated as a claim rather than an omission. The hook holds `playing`, `inputs`,
`scrub` and the step; a trigger is a string it hands to `stepInstance`, and a
clock is a fact about how the *export* advances a timeline the hook already
scrubs by hand. `useMachinePlayback.test.ts` is untouched, and if the implementer
finds themselves editing it, something in this spec is wrong.

### 2.7.3 The Timeline panel

One label and one sentence. Where the state being looked at has a clock other
than `time`, the scrubber is titled "Scroll position" and the panel says:

> This timeline is driven by **this element's pass through the view** in the
> exported file. The scrubber here is that scroll position, by hand.

## 2.8 Deferred, with the reason

**A scroll-driven number input** — `MachineInput.driver?: "viewProgress" |
"pageProgress"`, computed in permille by the runtime and fed through `setInput`,
so a guard could say `progress > 500`.

It is a coherent feature and it is genuinely useful for the *discrete* half of
scroll behaviour (a header that compacts a fifth of the way down). It is deferred
because everything it enables is already expressible: a header that compacts is a
scroll-clocked timeline that animates the header, which needs no script, no
scroll listener, no `getBoundingClientRect` per event and no answer to the
question of how to throttle without `requestAnimationFrame`. **One mechanism, and
the second one earns nothing the first does not already give.** If it is ever
built, it is a fifth rung of the ladder with its own `mindrive/3` fact and its
own argument for why an input is still invisible to the picture — which is an
argument `MachineInput`'s essay already makes and which a *driven* input does not
obviously inherit, since a driver is a fact about the page rather than about the
host.

**`prefers-reduced-motion`.** Springs and scroll-linked motion are precisely what
that media query is about, and this spec deliberately does not add it. The honest
version is a **document-wide** decision — a media query is a universe axis, and
`collapseSpace` and the breakpoint machinery already own that idea — so bolting a
per-transition "and also this one is reduced" flag on here would be the wrong
shape at the wrong grain. It is the next rung and it is a real gap; naming it is
the most this step should do.

**A pointer-position input.** "The thing follows the finger" needs a number the
pointer writes, which is the deferred input above plus a second driver. Same
answer, same reason.

## 2.9 Part Two test plan, by assertion name

**`machineprogram.test.ts`**
- `"four new triggers are four facts and no universes"` — a document using
  `dragbegin`/`dragend` has the universe count of the same document using
  `pointerdown`/`pointerup`, and `mtrigger/3` carries the new words.
- `"a clock is a word on a state, and a state with one mints the same copies"` —
  `mclock(m1,para,view)` present, `mcopy/3` sorted-set equal to the same document
  with no clock.
- `"every state has a clock, and the default is time"` — one `mclock` per state
  in a document that says nothing about clocks.
- `"an exit time past a scroll-clocked timeline is not reported"` —
  `mexitpast/2` empty where the same document with `clock: "time"` reports it.

**`runtime.test.ts`**
- `"the agreement matrix still holds over twelve triggers"` — the existing
  `(state, trigger)` sweep, widened by `TRIGGER_NAMES`; `stepLayer` and the
  emitted text answer identically for every pair.
- `"the runtime still has no clock"` — the existing absence assertion for
  `setTimeout`, `setInterval` and `requestAnimationFrame`, and the presence
  assertion for `Date.now`, both unchanged over a text that now constructs an
  `IntersectionObserver`. **This is the assertion that guards §2.3's whole
  claim.**
- `"the strip takes only prose"` — unchanged, over the new lines.
- `"a drag past the slop fires dragbegin exactly once"` — drive `evalRuntime`
  with a fake element that records listeners and replays a pointerdown and three
  pointermoves; assert one `dragbegin`.
- `"a drag under the slop is a click and never a drag"` — pointerdown, a 2px
  move, pointerup, click: no `dragbegin`, no `dragend`, one `click`.
- `"the click after a drag is swallowed exactly once"` — the drag sequence
  followed by two clicks moves the machine once.
- `"a pointercancel ends a drag that had begun"`.
- `"an element already in view gets viewenter after settle and not before"` —
  with a fake `IntersectionObserver`, assert the load chain ran first.
- `"a view crossing that repeats the same answer fires nothing"`.

**`export.test.ts`**
- `"a machine entered by a drag does not collapse to a pseudo-class"` —
  `runtime !== null`, the selector is `[data-state="dragging"]`, and the
  `transition:` declaration is still on the base rule.
- `"a scroll-clocked timeline is a gated custom property and no script"` — the
  `:root` line sets the name to `none`, an `@supports (animation-timeline:
  view())` block sets it to the `@keyframes` name, the node's rule says
  `animation-name: var(--dc-tl-…)`, and nothing else changed.
- `"a document with no clock and no gesture emits neither"` — the no-regression
  assertion.
- `"a gesture-driven machine says so in the losses"`.

**`app/e2e/studio.spec.ts`**
- `"dragging an instance in preview mode moves the machine and does not select
  it"`.
- `"a drag shorter than the slop is a click"`.

**Golden fixtures.** `spatialprogram.goldens.json` **will** move in Part Two,
because `MACHINE_RUNTIME`'s text changes and the `machine` template's exported
HTML contains it verbatim. The rule in `runtime.ts:796–815` applies and is not
optional: regenerate only after proving that rolling the runtime text back
reproduces the fixture's existing hashes for every universe. Anything weaker is
indistinguishable from deleting the test.

---

## 3. File ownership

| file | Part One | Part Two |
| --- | --- | --- |
| `design-core/src/values.ts` | `easing` type, `EASINGS` + springs moved in, `cssEasing`, `bezierOf`, `sampleSpring`, `keyEaseVar` | — |
| `design-core/src/scene.ts` | `Transition.easing`/`Keyframe.easing` widen, re-export the moved table | `Trigger` ×4, `TriggerSpec.source`/`suppresses`, `TimelineClock`, `MachineState.clock`, `DRAG_SLOP_PX` |
| `design-core/src/machines.ts` | `easingOf`, `keyEasing`, `TrackSample.easing` | `MachineTable.settings` |
| `design-core/src/project.ts` | two `settingValue` lines | `clock` in the state reader |
| `design-core/src/compile.ts` | `mdefease`, `measeopt`, `bezier/5`, the ten rules, two `#project`s, one `#show`, three walks, CONTRACT | `mclock/3`, `mexitpast` narrowing, CONTRACT |
| `design-core/src/model.ts` | `ModelMachine.easing` | `ModelMachine.clocks` |
| `design-core/src/export.ts` | `pacing`, `MachineExport.springs`, the `@supports` block | `scrollTimelineFor`, `MachineExport.scrolled`, two `lost` lines |
| `design-core/src/runtime.ts` | — | `TRIGGER_BINDINGS`, `bindDrag`, `observeViews`, `listen`, `start` |
| `app/src/design/Transitions.tsx` | the easing row, the spring hint | — |
| `app/src/design/Timeline.tsx` | keyframe easing row | the clock select, the scrubber label |
| `app/src/design/CurveField.tsx` | **new** | — |
| `app/src/design/Studio.tsx` | `--dc-play-easing` | — |
| `app/src/design/Editor.tsx` | — | the drag recogniser |

`useMachinePlayback.ts` appears in neither column, and that is the result rather
than an oversight.
