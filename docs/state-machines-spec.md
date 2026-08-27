# State machines for component definitions

**Status: frozen.** Thirteen implementation steps code against this document
without talking to each other. Every type, every predicate, every prop and every
file boundary below is the contract. Where an implementation step finds this
document wrong, it implements the nearest correct thing *and says so in its
return value* — it does not quietly redesign an interface another step is
coding against.

---

## 0. The one invariant, and what it forces

> **A machine state is never an `alt/2` alternative and never gets a `pick/2`.**
> All states of a component are true at once in a single answer set. Adding a
> four-state machine to a document must not change its universe count.

States are not design-space choices. Variants × states is a *matrix*, not a
cross product of universes. That single sentence decides almost every awkward
question below, so it is worth writing out what it rules out and what it forces.

**It rules out the obvious encoding.** The cheap way to write states is a choice
rule — `1 { mstate_pick(I,S) : mstate(M,S) } 1.` — and then every state is a
universe, a button with four states and three variants is twelve designs, and
the multiverse stops being a design space and becomes a sprite sheet. Worse, the
cross-state questions a designer actually asks ("is the label still inside the
box when the button grows on hover?") become unaskable, because the two states
are in two different answer sets and nothing can relate them.

**It forces state copies.** Every state of every instance is materialised as its
own family of `frame/3` and `rendered/3` atoms in *one* answer set. That is what
makes a constraint over two states an ordinary constraint, what puts a broken
one in the unsat core, and what stops simplex placing the same node in two
places in two independent solves.

**It forces the shared variable.** A property that no state touches must be
*one* variable shared by every state copy. If each state copy minted its own
copy of the definition's two-alternative fill, four states would be 2⁴ = 16
designs where the designer wrote one binary choice. So a state copy reads the
instance's own `prop(inst(I,N),P)` for everything the state says nothing about,
and only what the state *does* say gets a variable of its own.

**It forces `shown/2` to be a fact, not a choice.** Which state an instance is
drawn in changes `rendered/3`, which is projected — so a choice rule over it
would multiply universes by the state count. It is therefore a fact the compiler
emits from `SceneNode.state`, and changing it is an edit. Watching a transition
*play* is a different thing entirely and costs no solve at all: the answer set
already holds every state's values, so the studio's canvas reads the state copy
it wants out of `ModelScene.states`. See §9.

There is exactly one place a state may legitimately branch the space: when a
designer writes **two alternatives inside one state's delta**. `hover fill:
[accent, danger]` is a design decision like any other and branches like any
other. That is not a violation of the invariant — the branching came from a
`Value` with two entries, not from the state.

**Acceptance test for this section** (step 4 owns it): a scene with a two-state
machine and a scene identical but for the machine having four states must
enumerate the *same number* of universes, and both must equal the count for the
same scene with no machine at all.

---

## 1. The term scheme — read this before anything else

Three terms are new. Every step must spell them exactly.

| Term | Arity | Meaning |
| --- | --- | --- |
| `stt(I,S,N)` | 3 | **The state copy.** Instance `I`, state `S`, definition part `N`. Carries `frame/3` and `rendered/3` for that state. **Never a `node/1`.** |
| `inst(I,N)` | 2 | **Unchanged.** The instance's part — the thing that draws, is hit-tested, is listed in Layers, and is exported. It is now a *derived view* of whichever state is shown. |
| `sprop(I,S,N,P)` / `sfval(I,S,N,D)` | 4 | The variables one state's delta mints, per instance. |
| `mval(M,T,F)` | 3 | The variable a transition's duration / delay / stagger is. |

### Why `stt/3` is not a node

`node/1` is what makes something *drawable*. If every state copy were a node,
every state of every instance would be painted on top of the others, the layer
list would grow by a factor of the state count, and hit-testing would have to
learn a rule it does not need. So a state copy is a parallel *description* —
frames and rendered properties — and nothing else. The consequences, each of
which an implementer will otherwise rediscover the hard way:

- `readModel` builds `byId` from `node/1`, so state copies are invisible to the
  canvas, the layer list, both export renderers, `isPartOf`, `partLabel`,
  `derivedNodes` and `paintedOver`. **All of those keep working unchanged.**
  This is the whole point of the alias design.
- `visible/1` is `node(N), not hidden(N)`, so there is no `visible(stt(...))`.
  Nothing needs one.
- `SCENE_DEFAULT_RULES` default `frame/3` off `node/1`, so a state copy gets no
  default from there. §3 gives it its own, in the same shape.
- `gsolved/1`, `lv/2`, `lsz/2`, `ge/2` and `c_node/2` do **not** require
  `node/1`. So a geometric constraint may name a state copy and simplex places
  it, which is exactly what point 5 of the brief asks for.

### Naming

- A **state id** is unique *within its machine* and must be a bare ASP constant
  (`wordOf(id) === id`). `rest`, `hover`, `open`.
- A **transition id** is unique *within its machine*, same spelling rule.
- A **machine id** is unique *in the document*, same spelling rule.

The brief proposed `mdur/2`. Because state and transition ids are machine-scoped
rather than document-scoped, the actual predicate is **`mdur/3` — `mdur(M,T,Ms)`**.
This is a deliberate deviation and it is uniform: every machine-scoped predicate
carries the machine as its first argument, so no id anywhere has to be unique in
a wider scope than a designer naturally keeps it in. `hover` is a state in every
machine in the document and that must not be a collision.

---

## 2. TypeScript types, written out in full

### 2.1 `packages/design-core/src/values.ts` — the fourth quantity

```ts
export type ValueType =
	| "color"
	| "length"
	| "number"
	| "count"
	| "duration"   // <- new, in this position
	| "weight"
	| "font"
	| "align"
	| "shadow"
	| "text"
	| "direction"
	| "placement"
	| "justify"
	| "sizing"
	| "growth";

export type Quantity = "length" | "ratio" | "count" | "time";
```

Add to `VALUE_TYPES`, between `count` and `weight`:

```ts
	/**
	 * How long something takes — the fourth quantity, and the first one that is
	 * not a distance, a proportion or a tally of things.
	 *
	 * A duration is a value like any other, which is the whole reason it is a
	 * type rather than a number on a transition: a `duration` token holding
	 * `["120ms", "240ms"]` *is* a motion scale, one place that decides how
	 * quickly the whole design moves, and pointing every transition at it is the
	 * same act as pointing every gap at a spacing token. Nothing else in the
	 * system had to learn a word for that to be true.
	 *
	 * Read by `msOf`, which is exact or nothing for the same reason `emuOf` is:
	 * a duration reaches ASP as an integer count of milliseconds, and a fact has
	 * to be an integer.
	 */
	duration: { label: "Duration", fallback: "200ms", quantity: "time" },
```

And two readers plus a ceiling, beside `numeralOf` and `tallyOf`:

```ts
/**
 * The longest duration a document may name, in milliseconds.
 *
 * Ten minutes. Not a limit anybody will meet on purpose — the argument is
 * `MAX_TALLY`'s, one step weaker: nothing grounds a range over a duration, but
 * `mstagger` is multiplied by a sibling index on a right-hand side, and
 * gringo's integers are 32-bit and wrap in silence. A mistyped `200000s` is a
 * typo, not a transition, and reading it as no duration at all is what every
 * caller already handles.
 */
export const MAX_MS = 600_000;

/**
 * The whole number of milliseconds a literal reads as: `"200ms"` is 200,
 * `"0.2s"` is 200, `"0"` is 0.
 *
 * The reader for the `time` quantity, and it is exact or nothing, exactly as
 * `emuOf` is. `"1.5ms"` is not a whole millisecond, so it reads as no duration
 * at all rather than as 1 or as 2 — a caller that wanted a rounding asks for
 * one by name (`nearestMs`), and the fact the compiler emits is never a number
 * nobody typed.
 *
 * Unitless is refused except for zero, which is what CSS does and for the same
 * reason: `200` is ambiguous between two units that differ by a factor of a
 * thousand, and guessing would make a design that animates for three minutes
 * look like a bug in the browser. `0` needs no unit because both readings
 * agree.
 *
 * The suffix is matched case-insensitively because CSS units are, and a
 * designer who types `200MS` has typed a duration. The *number* is not
 * normalised anywhere: what the document stores is what was typed, exactly as
 * a length keeps its own unit across an edit.
 *
 * Negative is read and returned as negative. Only `delay` may use it — a
 * negative delay starts a transition partway through, which is a real thing to
 * ask for — and `duration` and `stagger` clamp at zero where they are read.
 * The clamp is at the reading, not here, so that one reader serves all three.
 */
export function msOf(text: string): number | undefined {
	const m = /^\s*(-?\d+(?:\.\d+)?)\s*(ms|s)?\s*$/i.exec(text);
	if (!m) return undefined;
	const n = Number(m[1]);
	const unit = m[2]?.toLowerCase();
	if (unit === undefined) return n === 0 ? 0 : undefined;
	const ms = unit === "s" ? n * 1000 : n;
	if (!Number.isInteger(ms)) return undefined;
	return Math.abs(ms) <= MAX_MS ? ms : undefined;
}

/**
 * The nearest whole millisecond a text reads as, for the one caller that is
 * allowed to round: a field a person is typing into.
 *
 * The twin of `nearestEmu`, and it exists for the twin reason — `msOf` is exact
 * or nothing, so a half-millisecond typed into the inspector would read as no
 * duration and the row would go blank while the user was still typing. This is
 * an editorial act with a name and a caller, never something a conversion does
 * behind anyone's back.
 */
export function nearestMs(text: string): number | undefined {
	const m = /^\s*(-?\d+(?:\.\d+)?)\s*(ms|s)?\s*$/i.exec(text);
	if (!m) return undefined;
	const n = Number(m[1]);
	const unit = m[2]?.toLowerCase();
	if (unit === undefined && n !== 0) return undefined;
	const ms = Math.round(unit === "s" ? n * 1000 : n);
	return Math.abs(ms) <= MAX_MS ? ms : undefined;
}

/** True when values of this type are durations — the twin of `isLengthType`. */
export const isTimeType = (type: ValueType): boolean =>
	VALUE_TYPES[type].quantity === "time";

/**
 * One motion setting of one transition: `mval(m1,press,duration)`.
 *
 * A variable rather than a number for the reason a constraint's dimension is
 * one: point it at a `duration` token and the token's alternatives drive every
 * transition wearing it, with no second kind of parameter anywhere.
 */
export const motionVar = (
	machineId: string,
	transitionId: string,
	field: string,
): string => `mval(${machineId},${transitionId},${field})`;
```

**`parseVariable` is deliberately not extended.** `mval`, `sprop` and `sfval`
join `spart` in the set of keys that never parse back, and for the same reason
recorded there: every caller that reads a key back is asking about something the
*inspector's generic rows* can act on, and three more cases none of them could
act on would be three cases all of them had to handle. The Machines panel builds
these keys itself and knows what they are. Steps that need a human name for one
call `motionLabel` / `stateVarLabel` from `machines.ts` (§2.3).

### 2.2 `packages/design-core/src/scene.ts` — the document

Everything here is new. Place it in a new section after **Styles** and before
`interface Scene`.

```ts
/* ------------------------------------------------------------------ */
/* State machines                                                      */
/* ------------------------------------------------------------------ */

/**
 * What makes a machine move.
 *
 * Deliberately the *input* rather than a name of the designer's own: a trigger
 * has to mean something to a browser at the far end, or the export is a
 * picture with a data attribute nobody sets. Half of these collapse to a CSS
 * pseudo-class and cost the export no script at all; the rest drive
 * `data-state` from a generated runtime. Which is which is the `css` column,
 * read off this table rather than decided at the emitter — see `export.ts`.
 */
export type Trigger =
	| "pointerenter"
	| "pointerleave"
	| "pointerdown"
	| "pointerup"
	| "focus"
	| "blur"
	| "click"
	| "load";

export interface TriggerSpec {
	label: string;
	/** The DOM event a runtime listens for, and the one the canvas fires. */
	event: string;
	/**
	 * The pseudo-class a *pair* of transitions collapses to, so that the most
	 * common machine anybody builds — rest and hover — leaves as a stylesheet
	 * with no behaviour in it. Null where CSS has no name for the condition.
	 */
	css: "hover" | "active" | "focus-visible" | null;
	/** The trigger that undoes it, where the pair is what CSS understands. */
	pair?: Trigger;
}

export const TRIGGERS: Record<Trigger, TriggerSpec> = {
	pointerenter: {
		label: "Pointer enters",
		event: "pointerenter",
		css: "hover",
		pair: "pointerleave",
	},
	pointerleave: {
		label: "Pointer leaves",
		event: "pointerleave",
		css: "hover",
		pair: "pointerenter",
	},
	pointerdown: {
		label: "Pressed",
		event: "pointerdown",
		css: "active",
		pair: "pointerup",
	},
	pointerup: {
		label: "Released",
		event: "pointerup",
		css: "active",
		pair: "pointerdown",
	},
	// `focusin`/`focusout` rather than `focus`/`blur`: the DOM pair that
	// bubbles, which is what a listener on the instance's own element needs when
	// the thing that took focus is a descendant of it.
	focus: { label: "Focused", event: "focusin", css: "focus-visible", pair: "blur" },
	blur: { label: "Blurred", event: "focusout", css: "focus-visible", pair: "focus" },
	click: { label: "Clicked", event: "click", css: null },
	// No event: a load trigger fires once, when the runtime starts. It is how a
	// machine says "settle into this state" rather than "wait to be poked".
	load: { label: "On load", event: "", css: null },
};

export const TRIGGER_NAMES = Object.keys(TRIGGERS) as Trigger[];

/**
 * How a transition is paced.
 *
 * The keys are ASP constants and reach the program as themselves, the way
 * `spaceBetween` does — the words a human reads are the `label`s.
 */
export type Easing = "linear" | "ease" | "easeIn" | "easeOut" | "easeInOut";

export const EASINGS: Record<Easing, { label: string; css: string }> = {
	linear: { label: "Linear", css: "linear" },
	ease: { label: "Ease", css: "ease" },
	easeIn: { label: "Ease in", css: "ease-in" },
	easeOut: { label: "Ease out", css: "ease-out" },
	easeInOut: { label: "Ease in-out", css: "ease-in-out" },
};

export const EASING_NAMES = Object.keys(EASINGS) as Easing[];

/**
 * What a transition eases by default.
 *
 * `easeOut` rather than `ease`, because a state machine's transitions are
 * responses to a person: the interesting half of the curve is the beginning,
 * and a response that starts slowly reads as lag.
 */
export const DEFAULT_EASING: Easing = "easeOut";

/** One of the three numbers that pace a transition. */
export type MotionProp = "duration" | "delay" | "stagger";

export interface MotionPropSpec {
	label: string;
	type: ValueType;
	fallback: string;
	/**
	 * Whether a negative value means anything.
	 *
	 * Only a delay: a negative one starts the transition partway through, which
	 * is a real thing to ask for. A negative duration is not a fast transition
	 * and a negative stagger is not a reversed one — both are typos, and both
	 * are clamped to zero where they are read, exactly as a negative gap is.
	 */
	signed: boolean;
}

/**
 * Every input to the motion system, in one place — the twin of
 * {@link LAYOUT_PROPS} and {@link GUIDE_PROPS}, and it earns the shape for the
 * same reason both of those do: a bundle of settings that never paints, that
 * the program reads, and that may each hold alternatives or name a token.
 *
 * A `duration` token with two alternatives is a motion scale held in one
 * document — brisk and considered — and because the settings are values rather
 * than numbers, that really is two designs rather than two documents. It is the
 * grid argument, applied to time.
 */
export const MOTION_PROPS: Record<MotionProp, MotionPropSpec> = {
	duration: {
		label: "Duration",
		type: "duration",
		fallback: "200ms",
		signed: false,
	},
	delay: { label: "Delay", type: "duration", fallback: "0ms", signed: true },
	/**
	 * How much later each subsequent part starts, in `order/2` sequence.
	 *
	 * One number rather than a per-part offset, because a stagger is a *rhythm*
	 * and a table of offsets is a table nobody can read a rhythm off. Which
	 * parts it applies to is whichever ones the state actually changes.
	 */
	stagger: { label: "Stagger", type: "duration", fallback: "0ms", signed: false },
};

export const MOTION_PROP_NAMES = Object.keys(MOTION_PROPS) as MotionProp[];

/**
 * What one state says about one definition part — a **delta**, not a node.
 *
 * This is the decision the whole feature turns on. A state could have been a
 * whole second copy of the subtree, and every design tool that has states does
 * it that way; the price is that editing the component means editing it N
 * times, and that "what does hover actually change?" is a diff nobody can see.
 * A delta is the answer to that question written down, which is also the thing
 * a designer means when they say the word.
 *
 * Every field is absent-is-inherit. A property the state says nothing about is
 * the instance's own, shared with every other state — which is not merely
 * economical, it is the invariant: a fill with two alternatives that four
 * states each re-minted would be sixteen designs where the document holds two.
 */
export interface StatePart {
	/**
	 * Appearance and content, as ordinary {@link Value}s — so a state's fill may
	 * name a token, hold alternatives, or be derived, exactly like a node's.
	 */
	props?: Partial<Record<PropName, Value>>;
	/**
	 * Geometry, in the part's *own parent-relative* coordinates — the same space
	 * `SceneNode.frame` is in. So a state that moves a container moves everything
	 * inside it for nothing, which is what makes the materialisation analysis in
	 * the spec affordable.
	 */
	frame?: Partial<Record<Dimension, Value>>;
	/**
	 * Take this part out of the picture in this state.
	 *
	 * `true` or absent, like {@link SceneNode.component}, and deliberately with
	 * no `false`: a definition part is drawn unless a state says otherwise, so
	 * "shown" needs no spelling. A dropdown's panel is `hidden: true` in
	 * `closed` and silent in `open`.
	 */
	hidden?: true;
}

/**
 * One state of a machine: a name, and a delta per definition part.
 *
 * The first state of a machine is its **initial** state, and there is no
 * `initial` flag — the order *is* the answer, the same way `order/2` is the
 * paint order and nothing carries a `onTop` flag. Reordering the list is how
 * the initial state changes, which is one edit rather than two that can
 * disagree.
 */
export interface MachineState {
	/**
	 * Unique among the states of *its own machine*, and spellable as an ASP
	 * constant — it reaches the program inside `stt(I,S,N)` and inside every
	 * variable key a delta mints.
	 *
	 * Per machine rather than per document, for the reason a {@link Guide}'s id
	 * is per surface: `hover` is what every machine in the document calls that
	 * state, and making them collide would be making them rename each other.
	 */
	id: string;
	/** What it is called. Free-form. */
	name: string;
	/** Definition part id -> what this state changes about it. */
	parts: Record<string, StatePart>;
}

/**
 * One edge: from a state, to a state, on a trigger, over some time.
 *
 * A transition carries no geometry and no appearance. It says *when* the
 * machine moves and *how long the move takes*, and nothing about what the
 * design looks like at either end — that is entirely the two states' business.
 * Keeping the two apart is what lets the export collapse a rest/hover pair into
 * `:hover` and a `transition:` declaration and emit no behaviour at all.
 */
export interface Transition {
	/** Unique among the transitions of its own machine; an ASP constant. */
	id: string;
	/** A state id of the same machine. */
	from: string;
	/** A state id of the same machine. */
	to: string;
	trigger: Trigger;
	/**
	 * How long the move takes, as a `duration` {@link Value} — so it may name a
	 * token and follow a motion scale. Absent takes `MOTION_PROPS.duration`'s
	 * fallback, which is what the program's own default rule says too.
	 */
	duration?: Value;
	/** How long before it starts. May be negative — see {@link MotionPropSpec.signed}. */
	delay?: Value;
	/** How much later each subsequent part moves, in `order/2` sequence. */
	stagger?: Value;
	easing?: Easing;
	/**
	 * Only tween these properties; everything else in the state's delta snaps.
	 *
	 * Absent is *everything the delta touches*, which is what a designer means
	 * by default. Present and empty is a transition that tweens nothing, which
	 * is a legal and occasionally wanted thing to say — "change instantly on
	 * press, ease back on release".
	 */
	only?: PropName[];
	/** Off keeps it in the document but out of the program. */
	enabled: boolean;
}

/**
 * A state machine, belonging to one component definition.
 *
 * On {@link Scene} rather than on the definition's root node, and beside the
 * styles rather than among the nodes, for the reason styles are: a machine is a
 * record with its own identity, its own list of states and its own lifecycle,
 * and a `SceneNode` field would give every rectangle in the document a slot for
 * one. It names its root instead, and a machine whose root is no longer a
 * definition simply says nothing — the same silence a dangling
 * {@link SceneNode.instanceOf} leaves.
 *
 * **This is component-local runtime behaviour and it is not the multiverse.**
 * Every state is true at once in one answer set; nothing here is ever an
 * alternative, and adding a state to a machine must leave the document's
 * universe count exactly where it was.
 */
export interface Machine {
	/** Unique in the document; an ASP constant. */
	id: string;
	name: string;
	/** The id of the component definition's root node — see `isDefinition`. */
	root: string;
	/** In order. **The first is the initial state.** Never empty. */
	states: MachineState[];
	transitions: Transition[];
}
```

Then two additions to existing types:

```ts
export interface SceneNode {
	// …
	/**
	 * On an `instance` kind: which state of its definition's machine it is
	 * drawn in on the canvas, and which state it starts in when exported.
	 *
	 * **Structurally the twin of {@link holds}**, and the resemblance is exact
	 * rather than decorative: both are a decision the document remembers about
	 * one use of a shared definition, both name something the definition owns,
	 * and both leave the thing they name unchanged for every other use. The one
	 * difference is which way the decision cuts — a hold narrows the *design
	 * space*, a state selects one of the *behaviours*, and those are orthogonal.
	 * An instance may hold a variant and be drawn in a state, and the pair is a
	 * cell of a matrix rather than a point in a product of universes.
	 *
	 * Absent, or naming a state the machine no longer has, is the machine's
	 * initial state. Nothing is corrected on the way in: a stored document is
	 * read, not repaired, and a machine edited down leaves its instances legal.
	 *
	 * Read on an `instance` node and nowhere else. A component *definition* on
	 * the canvas is always its rest state, and that is a deliberate exclusion —
	 * see §3.6.
	 */
	state?: string;
}

export interface Scene {
	// …
	/**
	 * State machines, by the definitions they drive — see {@link Machine}.
	 *
	 * Beside the styles and the constraints rather than among them. A style is a
	 * variable, a constraint is a rule, and a machine is neither: it is
	 * behaviour, it never branches the space, and it is the first thing in this
	 * document that is about *time*.
	 */
	machines: Machine[];
}
```

`emptyScene()` gains `machines: []`.

### 2.3 `packages/design-core/src/machines.ts` — new file

The twin of `components.ts`: the term scheme, the lookups, the analysis and the
labels. Everything in it is a pure reading of the document or of one answer set.

```ts
/* ---- the term scheme ---- */

/** How one state's copy of a definition part is named: `stt(i1,hover,label)`. */
export const statePart = (
	instanceId: string,
	stateId: string,
	nodeId: string,
): string => `stt(${instanceId},${stateId},${nodeId})`;

/** The inverse, for anything showing one to a human. */
export function parseStatePart(
	id: string,
): { instance: string; state: string; node: string } | null;

/** One property a state overrides, as the variable it is: `sprop(I,S,N,P)`. */
export const statePropVar = (
	instanceId: string,
	stateId: string,
	nodeId: string,
	prop: string,
): string => `sprop(${instanceId},${stateId},${nodeId},${prop})`;

/** One dimension a state overrides: `sfval(I,S,N,D)`. */
export const stateFrameVar = (
	instanceId: string,
	stateId: string,
	nodeId: string,
	dim: string,
): string => `sfval(${instanceId},${stateId},${nodeId},${dim})`;

/* ---- lookups over the document ---- */

export const findMachine = (
	machines: readonly Machine[],
	id: string | undefined,
) => Machine | undefined;

/** The machine driving this definition root, if the document holds one. */
export function machineForRoot(scene: Scene, rootId: string | undefined): Machine | undefined;

/** The machine driving this node: its definition's, if it is an instance. */
export function machineForNode(scene: Scene, node: SceneNode): Machine | undefined;

export const findState = (machine: Machine, id: string | undefined) => MachineState | undefined;
export const findTransition = (machine: Machine, id: string | undefined) => Transition | undefined;

/** The initial state: the first one. Machines are never stateless. */
export const initialState = (machine: Machine): MachineState => machine.states[0];

/**
 * Which state a node is drawn in: what it says, or the initial one.
 *
 * A `state` naming something the machine no longer holds falls back rather than
 * failing, exactly as a dropped hold does.
 */
export function shownState(machine: Machine, node: SceneNode): string;

/** State id -> what it is called, falling back to the id. */
export const stateName = (machine: Machine, id: string): string;

/* ---- names, for the panels and the sentences ---- */

/**
 * A state copy in the words a person uses: `"Label · Hover — Button 1"`.
 *
 * The third member of the family `partLabel` and `datumLabel` are in, and here
 * for the same reason both of those are beside their own grammar: a state copy
 * is a member a rule can name and a designer cannot point at, so every sentence
 * the tool builds out of a rule's members has to be able to say it.
 *
 * Nothing for a term that is not a state copy, so a caller chains the three and
 * falls through to the raw id.
 */
export function stateLabel(scene: Scene, term: string): string | undefined;

/** `"Press · Duration"`, for a motion row and for a why-sentence. */
export function motionLabel(scene: Scene, variable: string): string | undefined;

/* ---- what a rule may name ---- */

/**
 * Every state copy this document holds, as constraint members — the twin of
 * `datumIds`, and what the Rules panel offers beside the node ids.
 *
 * Instance by instance, state by state, part by part, and **only the
 * materialised parts**: a term for a part with no copy is a member that says
 * nothing, and offering it would be offering a rule that silently never holds.
 */
export function stateCopyIds(scene: Scene): string[];

/**
 * True when the document still holds what a state-copy term names — the
 * question `pruneConstraints` has to ask of every member that is neither a node
 * nor a datum.
 *
 * Deliberately blunter than {@link stateCopyIds}, exactly as `holdsDatum` is
 * blunter than `datumIds`: held when the instance exists and its definition's
 * machine has that state, whatever the materialisation says. Asking whether the
 * *copy* exists would delete a designer's rule the moment they cleared the
 * delta that made the part materialise, and getting it back would mean retyping
 * the rule rather than the delta.
 */
export function holdsStateCopy(scene: Scene, term: string): boolean;

/* ---- the materialisation analysis: see §4 ---- */

export function materializedParts(scene: Scene, machine: Machine): Set<string>;

/* ---- machine health, read off the document ---- */

export interface MachineHealth {
	/** States no chain of transitions reaches from the initial one. */
	unreachable: string[];
	/** States nothing leaves. */
	deadEnds: string[];
	/** `[state, trigger]` pairs two enabled transitions both leave on. */
	nondeterministic: Array<[state: string, trigger: Trigger]>;
	/** Transitions naming a state the machine does not have. */
	dangling: string[];
}

/**
 * The same four questions the program answers, answered here.
 *
 * Two readers, and the duplication is the point rather than a smell: the panel
 * has to be able to say "this state is unreachable" while the document is
 * unsatisfiable and there is no answer set at all, and a rule has to be able to
 * say it as a `viol/1` so that it lands in a core with a name. Neither can do
 * the other's job. `machines.test.ts` holds the two answers equal on every
 * shape it tests.
 */
export function machineHealth(machine: Machine): MachineHealth;

/* ---- the runtime table, shared by the export and the studio ---- */

export interface MachineTable {
	/** Instance node id -> machine id. Only instances a machine drives. */
	instances: Record<string, { machine: string; initial: string }>;
	machines: Record<
		string,
		{
			initial: string;
			states: string[];
			/** from -> trigger -> to. First enabled transition wins. */
			edges: Record<string, Partial<Record<Trigger, string>>>;
		}
	>;
}

export function machineTable(scene: Scene): MachineTable;

/**
 * Where one trigger takes one instance, or nothing where it takes it nowhere.
 *
 * **This is the shared behaviour.** The studio's canvas playback calls it
 * directly and the exported runtime is a thirty-line interpreter of the same
 * table — so "what does clicking do" has one answer, and `runtime.test.ts`
 * proves the two agree by running the emitted script in Node against this.
 */
export function stepMachine(
	table: MachineTable,
	instance: string,
	current: string,
	trigger: Trigger,
): string | undefined;
```

### 2.4 `packages/design-core/src/model.ts` — reading states back

```ts
/** One state copy, as one answer set describes it. */
export interface ModelState {
	/** The instance node id. */
	instance: string;
	/** The state id. */
	state: string;
	/** The definition part id. */
	part: string;
	/** Relative to the parent, as `ModelNode.frame` is, with solved geometry folded in. */
	frame: Frame;
	/** What it draws with in this state: final text per property. */
	rendered: Partial<Record<PropName, string>>;
	/** True where this state takes the part out of the picture. */
	hidden: boolean;
}

/** What one answer set says about one machine's health. */
export interface ModelMachine {
	/** States `mreach/2` does not reach. */
	unreachable: string[];
	/** States `mdeadend/2` names. */
	deadEnds: string[];
	/** `[state, trigger]` pairs `mnondet/3` names. */
	nondeterministic: Array<[string, string]>;
	/** Transitions `mdangling/2` names. */
	dangling: string[];
	/** Transition id -> the milliseconds this universe resolved it to. */
	duration: Record<string, number>;
	delay: Record<string, number>;
	stagger: Record<string, number>;
}

export interface ModelScene {
	// …
	/**
	 * Every state copy, by its `stt(I,S,N)` term.
	 *
	 * Not folded into {@link byId}, because a state copy is not a node and must
	 * never be drawn as one: this is the *other* states, sitting beside the
	 * picture rather than in it, and the only two readers are the export (which
	 * turns them into classes) and the studio's playback (which draws one
	 * instead of the shown one, with no solve).
	 */
	states: Record<string, ModelState>;
	/** Which state each instance is shown in — `shown/2`. */
	shown: Record<string, string>;
	/** What the answer set says about each machine, by machine id. */
	machines: Record<string, ModelMachine>;
}
```

`collect` gains cases for `shown/2`, `mhidden/3`, `munreached/2`, `mdeadend/2`,
`mnondet/3`, `mdangling/2`, `mdur/3`, `mdelay/3`, `mstagger/3`, and gathers
`frame/3` and `rendered/3` for any id that `parseStatePart` reads. Solved
geometry from `readSolved` is folded into `ModelState.frame` exactly as it is
into `ModelNode.frame`, and by the same lines.

### 2.5 `packages/design-core/src/export.ts`

```ts
/**
 * One state of one machine, as the selector a stylesheet switches on.
 *
 * Not a {@link Layer}: a layer is a whole *universe* under a media query, and a
 * state is the same universe under a different selector on one element. The two
 * compose — a themed export of a document with a hover state has both — which
 * is only true because they are different mechanisms rather than one stretched.
 */
export interface StateLayer {
	machine: string;
	/** The instance's node id, whose element carries the selector. */
	instance: string;
	state: string;
	/**
	 * What is appended to the instance's own class selector: `":hover"`,
	 * `":active"`, `":focus-visible"`, or `'[data-state="open"]'`.
	 */
	on: string;
	/** Per node id, only what this state changes from the base. */
	changed: Map<string, Declarations>;
	/** `transition:` to put on each changed node's *base* rule. */
	transitions: Map<string, Declarations>;
	label: string;
}

export interface MachineExport {
	layers: StateLayer[];
	/** The `<script>` body, or null where every state is a pseudo-class. */
	runtime: string | null;
	/** What the file does not carry — appended to `ExportResult.lost`. */
	lost: string[];
}

/**
 * Every machine in the document, as selectors over the base layer.
 *
 * See §8 for the rules that decide which states become pseudo-classes and which
 * drive `data-state`.
 */
export function exportMachines(scene: Scene, base: Layer): MachineExport;
```

`ExportResult` is unchanged in shape; `lost` gains entries. `EXPORT_TARGETS.svg.loses`
gains one entry (§8).

### 2.6 `packages/design-core/src/runtime.ts` — new file

```ts
/**
 * The generated runtime, as source text.
 *
 * A string constant rather than a module the export imports, because an export
 * is one self-contained file: there is nothing to import from. Table-driven and
 * generic, so a document with four machines emits this once and a table, rather
 * than a function per machine — and so `runtime.test.ts` can run *this exact
 * text* against `stepMachine` and prove the two agree, which is the only thing
 * that keeps "the studio and the file behave the same" true.
 */
export const MACHINE_RUNTIME: string;

/** The whole `<script>` body: the table, then the runtime. */
export function runtimeScript(table: MachineTable): string;
```

---

## 3. ASP: every new predicate, and the alias rules

Facts unless marked. All of it lives in `compile.ts`. Where an argument is
`Ms` it is a **whole number of milliseconds**; where it is `V` it is EMU, as
everywhere else.

### 3.1 The machine, as facts

| Predicate | Kind | Meaning |
| --- | --- | --- |
| `machine(M)` | fact | `M` is a machine in the document |
| `machine_of(M,R)` | fact | `M` drives the component definition rooted at `R` |
| `mstate(M,S)` | fact | `S` is a state of `M` |
| `mindex(M,S,K)` | fact | `S` is `M`'s `K`th state, 1-based, document order |
| `mpart(M,N)` | fact | definition part `N` is **materialised** — §4 decided it |
| `mhide(M,S,N)` | fact | state `S` takes part `N` out of the picture |
| `mtrans(M,T)` | fact | `T` is an enabled transition of `M` |
| `mfrom(M,T,S)` `mto(M,T,S)` | fact | its ends |
| `mtrigger(M,T,G)` | fact | `G` is one of the {@link TRIGGERS} words |
| `measing(M,T,E)` | fact | one of the {@link EASINGS} words |
| `monly(M,T,P)` | fact | one property of the filter. No `monly` at all is "everything the delta touches" |
| `mdefdur(Ms)` `mdefdelay(Ms)` `mdefstagger(Ms)` | fact | `MOTION_PROPS` fallbacks, read through `msOf` |
| `mval(M,T,duration\|delay\|stagger)` | variable | the motion settings, minted through `emitValue` |
| `shown(I,S)` | fact **and** derived | which state instance `I` is drawn in |
| `mshadow(inst(I,N),P)` | fact | some state of `I`'s machine overrides property `P` on part `N` |
| `mfshadow(I,N,D)` | fact | some state overrides dimension `D` on part `N` |
| `sprop(I,S,N,P)` | variable | what state `S` says about property `P` of part `N`, for instance `I` |
| `sfval(I,S,N,D)` | variable | the same for a dimension |

Derived:

| Predicate | Meaning |
| --- | --- |
| `minstance(I,M)` | `I` is an instance of a definition `M` drives |
| `minitial(M,S)` | `M`'s initial state — `mindex(M,S,1)` |
| `mcopy(I,S,N)` | a state copy exists: `stt(I,S,N)` is a term the program describes |
| `mbase(I,N,D,V)` | what `I`'s copy of part `N` is before any state has an opinion |
| `msprop(I,S,N,P)` `msfval(I,S,N,D)` | this state really does say something usable here |
| `mhidden(I,S,N)` | this state hides this copy |
| `mdur(M,T,Ms)` `mdelay(M,T,Ms)` `mstagger(M,T,Ms)` | the motion settings, per universe |
| `mreach(M,S)` `munreached(M,S)` | reachability from the initial state |
| `mleaves(M,S)` `mdeadend(M,S)` | whether anything leaves a state |
| `mnondet(M,S,G)` | two transitions leave `S` on `G` |
| `mdangling(M,T)` | a transition names a state the machine has not got |
| `mtwoshown(I)` | two `shown/2` for one instance, which is not a state machine |
| `millis(Lit,Ms)` | the **fourth literal bridge**: the duration a literal reads as |

### 3.2 `MACHINE_RULES` — the exact text

Emitted **always**, like the geometry, component, style and guide rules and for
the same reason: `machine/1`, `mstate/2`, `mpart/2` and `instance/2` are all
things a hand-written rule may assert, and a contract that quietly does nothing
on some documents is not one. With no facts, none of it grounds.

Placed **after** the component rules (which is where `instance/2`, `cpart/2` and
`cinner/2` are said and where `mbase` replaces two of its lines) and **before**
the scene defaults (so a state copy's own defaults are stated after the frames
they guard).

```prolog
#defined machine/1.
#defined machine_of/2.
#defined mstate/2.
#defined mindex/3.
#defined mpart/2.
#defined mhide/3.
#defined mtrans/2.
#defined mfrom/3.
#defined mto/3.
#defined mtrigger/3.
#defined measing/3.
#defined monly/3.
#defined mdefdur/1.
#defined mdefdelay/1.
#defined mdefstagger/1.
#defined shown/2.
#defined mshadow/2.
#defined mfshadow/3.
#defined instance/2.
#defined cpart/2.
#defined cinner/2.
#defined millis/2.
#defined numeral/2.

% ---- which instances a machine drives ----
minstance(I,M) :- instance(I,R), machine_of(M,R).
minitial(M,S) :- mindex(M,S,1).

% Every instance of a driven definition is in *some* state, and never in two.
% The default is written the way the scene defaults are — the guard excludes the
% value the default supplies — so that supplying the default is not itself the
% reason the default no longer applies, which is the pair with no stable model.
% The compiler emits shown/2 as a fact for every instance the document holds;
% this rule is for the ones a rule of yours brought into being.
mstated(I) :- minstance(I,M), shown(I,S), not minitial(M,S).
shown(I,S) :- minstance(I,M), minitial(M,S), not mstated(I).

% ---- which parts get a copy ----
% Derived rather than emitted per instance: the analysis decides the parts once
% per machine, and the instances multiply it here for nothing.
mcopy(I,S,N) :- minstance(I,M), mstate(M,S), mpart(M,N).

% ---- what a copy starts from ----
% The two rules the component section used to write frame(inst(I,N),D,V) with,
% with the head renamed and nothing else changed. They are split out because the
% alias below *writes* frame(inst(I,N),D,V), and a rule cannot read its own
% head: without mbase the inherit rule and the alias would be a cycle through
% the one predicate the whole picture is made of.
mbase(I,N,D,V) :- instance(I,R), cinner(R,N), frame(N,D,V).
mbase(I,R,Z,V) :- instance(I,R), gspan(Z), frame(I,Z,V).

% What the instance's part is where no state has an opinion about it. The guard
% is per *dimension*, not per part: a state that moves a badge leaves the badge's
% width exactly where the definition put it, and this is the rule that says so.
frame(inst(I,N),D,V) :- mbase(I,N,D,V), not mfshadow(I,N,D).

% ---- each state's own copy ----
% A dimension the state says nothing about is the instance's. Every state of
% every instance is in one answer set, so a rule may compare two of them and
% simplex places both — which is the whole reason this is a copy and not a
% second solve.
frame(stt(I,S,N),D,V) :- mcopy(I,S,N), mbase(I,N,D,V), not msfval(I,S,N,D).
frame(stt(I,S,N),D,V) :- mcopy(I,S,N), resolved(sfval(I,S,N,D),L), numeral(L,V).
% ...and it only counts where it reads as a length, so a delta pointed at a
% dangling token or at "50%" falls back to the base rather than leaving the copy
% with no geometry at all. Same reading `frame/3` itself gets.
msfval(I,S,N,D) :- resolved(sfval(I,S,N,D),L), numeral(L,_).

% A state copy is not a node/1, so the scene defaults do not reach it. Its own,
% in the same shape and for the same reason: written so it cannot unsay itself.
mframed(I,S,N,D) :- frame(stt(I,S,N),D,V), V != 0.
frame(stt(I,S,N),A,0) :- mcopy(I,S,N), gaxis(A), not mframed(I,S,N,A).
frame(stt(I,S,N),Z,0) :- mcopy(I,S,N), gspan(Z), not mframed(I,S,N,Z).

% Appearance, the same way — and this is where the invariant lives. A property
% no state touches is read from the *instance's* one variable, shared by every
% state, so a fill with two alternatives is two designs whether the machine has
% two states or twenty. Minting a copy of it per state would be 2^N.
rendered(stt(I,S,N),P,L) :- mcopy(I,S,N), resolved(prop(inst(I,N),P),L),
                            not msprop(I,S,N,P).
rendered(stt(I,S,N),P,L) :- mcopy(I,S,N), resolved(sprop(I,S,N,P),L).
msprop(I,S,N,P) :- resolved(sprop(I,S,N,P),_).

mhidden(I,S,N) :- minstance(I,M), mhide(M,S,N), mcopy(I,S,N).

% ---- the shown state is what the instance *is* ----
% This is the join that keeps everything downstream working unchanged. frame/3
% and rendered/3 stay untimed and stay about inst(I,N), so the canvas, hit
% testing, isPartOf, partLabel, the layer list and both export targets never
% learn that states exist.
frame(inst(I,N),D,V) :- frame(stt(I,S,N),D,V), shown(I,S).
rendered(inst(I,N),P,L) :- rendered(stt(I,S,N),P,L), shown(I,S).
hidden(inst(I,N)) :- mhidden(I,S,N), shown(I,S).

% ---- a copy is parented where its part is ----
% Only so that a geometric constraint naming a state copy gets a world chain:
% gworld/2 climbs child/2, and a copy with no parent would be treated as a root
% and placed in the instance's own coordinates rather than on the canvas. The
% copies hang off the *instance* tree, never off each other, so no node ever
% gains a second parent and readModel — which builds byId from node/1 alone —
% never sees one.
child(inst(I,P),stt(I,S,N)) :- mcopy(I,S,N), instance(I,R), cinner(R,N),
                               child(P,N), cpart(R,P).
child(I,stt(I,S,R)) :- mcopy(I,S,R), instance(I,R).

% ---- how long a move takes, per universe ----
% The same shape a layout's gap has, for the same reason: a duration is a value,
% so what the export writes is derived from the pick rather than written down,
% and a `duration` token with two alternatives is a motion scale the document
% can hold both ends of.
mdur(M,T,V) :- resolved(mval(M,T,duration),L), millis(L,V), V >= 0.
% A negative duration is not a fast transition, it is a typo — exactly as a
% negative gap is not a tight row.
mdur(M,T,0) :- resolved(mval(M,T,duration),L), millis(L,V), V < 0.
mreadsdur(M,T) :- resolved(mval(M,T,duration),L), millis(L,_).
mdur(M,T,V) :- mtrans(M,T), mdefdur(V), not mreadsdur(M,T).
% A delay may be negative: it starts the move partway through, which is a thing
% to ask for rather than a mistake. So it is the one motion setting with no clamp.
mdelay(M,T,V) :- resolved(mval(M,T,delay),L), millis(L,V).
mreadsdelay(M,T) :- resolved(mval(M,T,delay),L), millis(L,_).
mdelay(M,T,V) :- mtrans(M,T), mdefdelay(V), not mreadsdelay(M,T).
mstagger(M,T,V) :- resolved(mval(M,T,stagger),L), millis(L,V), V >= 0.
mstagger(M,T,0) :- resolved(mval(M,T,stagger),L), millis(L,V), V < 0.
mreadsstagger(M,T) :- resolved(mval(M,T,stagger),L), millis(L,_).
mstagger(M,T,V) :- mtrans(M,T), mdefstagger(V), not mreadsstagger(M,T).

% ---- what is wrong with the machine ----
% Derived rather than checked here, so that a rule of yours can forbid any of
% them by name and land in a core like every other rule. The Machines panel
% offers the four canned `custom` constraints that do exactly that; there is no
% new constraint kind and no new machinery.
mreach(M,S) :- minitial(M,S).
mreach(M,S2) :- mreach(M,S1), mfrom(M,T,S1), mto(M,T,S2).
munreached(M,S) :- mstate(M,S), not mreach(M,S).
mleaves(M,S) :- mfrom(M,_,S).
mdeadend(M,S) :- mstate(M,S), not mleaves(M,S).
mnondet(M,S,G) :- mfrom(M,T1,S), mfrom(M,T2,S), T1 < T2,
                  mtrigger(M,T1,G), mtrigger(M,T2,G).
mdangling(M,T) :- mfrom(M,T,S), not mstate(M,S).
mdangling(M,T) :- mto(M,T,S), not mstate(M,S).
% Two shown states is not an instance in two states, it is two pictures on top
% of each other. Nothing the document can write does it; a rule can.
mtwoshown(I) :- shown(I,S1), shown(I,S2), S1 < S2.
```

### 3.3 The one change to a contract rule

In the `choices` section, `rendered/3`'s single rule gains one negative literal:

```prolog
% What a node actually draws with — the only thing an onlooker sees.
%
% A property some state of a machine owns is not drawn from the instance's own
% variable: the shown state's copy draws it, and the alias writes it back here.
% Without this guard both would, and `rendered/3` is a relation — two literals
% for one property is not two designs, it is one arbitrary answer, silently.
% The guard is per *property*, not per node, which is what keeps it to the one
% thing it is for: a property no state touches still draws from here, the state
% copies inherit exactly that literal, and the alias derives the same atom
% again, which costs nothing because it *is* the same atom.
#defined mshadow/2.
rendered(N,P,L) :- resolved(prop(N,P),L), not mshadow(N,P).
```

`frame/3`, `node/1`, `kind/2`, `child/2`, `order/2` and `visible/1` are
**untouched in arity and meaning**. `rendered/3` keeps both; what changed is one
guard that grounds away on every document with no machine in it.

### 3.4 The literal bridge

Beside `numeral/2`, `tally/2` and `word/2` in the `values` section, for every
interned literal:

```prolog
#defined millis/2.
millis(l7,200).
```

emitted wherever `msOf(text) !== undefined`. Same argument as the other three: a
literal has no type, the reader is chosen by what the value *is*, and `"200"`
happily carries a `tally` and no `millis` while `"200ms"` carries a `millis` and
neither of the others.

### 3.5 Output

```prolog
#show shown(I,S) : shown(I,S), scenery.
#show mhidden(I,S,N) : mhidden(I,S,N), scenery.
#show mdur(M,T,V) : mdur(M,T,V), scenery.
#show mdelay(M,T,V) : mdelay(M,T,V), scenery.
#show mstagger(M,T,V) : mstagger(M,T,V), scenery.
#show munreached(M,S) : munreached(M,S), scenery.
#show mdeadend(M,S) : mdeadend(M,S), scenery.
#show mnondet(M,S,G) : mnondet(M,S,G), scenery.
#show mdangling(M,T) : mdangling(M,T), scenery.
#show mtwoshown(I) : mtwoshown(I), scenery.
% Motion is a design decision like a gap: a `duration` token with two
% alternatives really is two designs — the brisk one and the considered one —
% and without this they differ in nothing that is projected and collapse into
% one universe with an arbitrary pick. Same argument as l_value/3, one axis over.
#project mdur/3.
#project mdelay/3.
#project mstagger/3.
```

A state copy's `frame/3` and `rendered/3` reach the answer set through the
existing generic `#show frame(N,D,V)` / `#show rendered(N,P,L)`, which is where
`ModelScene.states` reads them from. That is the cost of the feature in atoms:
one frame and one rendered set per state per materialised part. It is bounded by
the materialisation analysis and by nothing else, which is why §4 is not
optional.

### 3.6 What a machine deliberately does not do

**A definition on the canvas is always its rest state.** `SceneNode.state` is
read on an `instance` and nowhere else. The reason is `frame/3`: a definition
part's geometry is a *fact* the compiler emits, and a fact cannot be un-said by
a rule — so drawing the definition in a non-rest state would mean emitting a
different fact for a part because of an editor-ish field, and **every instance
of that definition inherits that fact**. Editing the machine would move the
component. The rest state is what the definition is; the states are what its
uses do. Authoring a non-rest state is done against an instance, and the
Machines panel's state strip plays one on the canvas without touching the
document (§9).

**A state changes appearance, geometry and presence. It does not change
structure.** No adding, removing or reparenting nodes, no changing a kind, no
changing the style a part wears, no changing a layout's settings. Hiding is the
one structural verb, and it is the one CSS can express. Anything more would be a
second document per state, which is the design this feature exists not to be.

**A state copy has no layout and no measurement of its own.** An instance's copy
of a laid-out definition already inherits the definition's *stored* frames
rather than re-solving its layout — a pre-existing limitation of components, not
something states introduce — so there is no `lslot/3` for a copy and nothing
reads `lask/3` for one. The visible consequence: a state that changes the text
of a hugging text node inside a definition does not resize its box. Named in
`ExportResult.lost` and in the Machines panel, not silently absorbed.

---

## 4. The materialisation analysis

This is what keeps grounding affordable. Without it, a four-state machine on a
twelve-part definition placed twenty times is 960 state copies, each with four
frames and a rendered set. With it, the usual button is two.

**Lives in** `machines.ts`. **Signature:**

```ts
export function materializedParts(scene: Scene, machine: Machine): Set<string>;
```

**Algorithm.** All of it over the *definition*, once per machine — never per
instance. The instances multiply it in ASP, through `mcopy/3`.

1. `def = componentDef(scene, machine.root)`. If there is none, return an empty
   set: a machine whose root is not a definition says nothing, exactly as an
   instance of a deleted definition derives nothing.
2. Let `parts` be `def.parts` keyed by id, and `parent` the parent map *within
   the definition subtree* (`parentMap([def.root])`).
3. **Seed — parts a state actually touches.** For every state `S` of the machine
   and every entry `[nodeId, delta]` of `S.parts`: if `parts.has(nodeId)` and the
   delta says anything at all — `delta.props` has a key with a non-empty `Value`,
   or `delta.frame` has a key with a non-empty `Value`, or `delta.hidden` — add
   `nodeId`.
4. **Seed — parts the solver places.** For every constraint `c` in
   `scene.constraints` with `c.enabled` and `CONSTRAINT_KINDS[c.kind].geometric`,
   for every member `m` of `c.nodes`: reduce `m` to a definition part id by, in
   order, `parts.has(m) ? m : parseInstancePart(m)?.node ?? parseStatePart(m)?.node`;
   if the result is a part of *this* definition, add it.

   This is the "only a `gsolved` child needs its own copy" half of the brief.
   Naming a node in a geometric constraint is what hands it to simplex, and a
   node simplex places has to be placeable *per state* or the two states share
   one answer and the constraint is a statement about neither.
5. **Close upward.** While any member of the set has a parent inside
   `def.parts`, add that parent. Terminates at `def.root`, which is therefore in
   the set whenever the set is non-empty.

   Upward and not downward, and that asymmetry *is* the analysis:
   - **Downward is free.** A frame is parent-relative, so a state that moves a
     container moves everything inside it with no copy for any of them. That is
     the whole reason `StatePart.frame` is specified in the part's own
     parent-relative coordinates.
   - **Upward is not.** A state copy's world coordinate is the parent's plus its
     own offset, chained through `child/2`, and `child(inst(I,P),stt(I,S,N))`
     needs `inst(I,P)` to be the right link in that chain. Stopping short would
     put the copy in the instance's coordinates rather than on the canvas.
6. Return the set. Empty means the machine materialises nothing, which is a
   machine whose states are all identical — legal, useless, and free.

**What the compiler does with it:** emits one `mpart(M,N)` per member, plus
`mshadow(inst(I,N),P)` and `mfshadow(I,N,D)` per instance for each
property/dimension *any* state overrides on a materialised part, plus the
`sprop`/`sfval` variables per instance per state per overridden field.

**Grounding budget, stated so it can be measured.** For machine `M` with `|S|`
states and `|P|` materialised parts, driving `|I|` instances, the program gains

- `|S|·|P|` × `|I|` `mcopy/3` atoms,
- at most `4·|S|·|P|·|I|` `frame/3` atoms and `|props touched|·|S|·|P|·|I|`
  `rendered/3` atoms,
- one `sprop`/`sfval` variable per overridden field per state per instance.

`machines.test.ts` asserts the analysis returns exactly the touched parts plus
their ancestors, and `machineprogram.test.ts` asserts the atom count against a
document with a deliberately deep definition.

---

## 5. Constraints over states — and the one thing that is *not* already true

**Confirmed by reading the code:** `Constraint.nodes` is `string[]`
(`scene.ts`), and it already carries terms that are not document nodes. The
doc-comment on that field says so in as many words — "A member may also be a
**datum** — a guide, or one line of a column grid — which is not a node and is
not in the document's tree" — and `datums.test.ts` and `guides.test.ts` exercise
it against the real solver. The compiler emits `c_node(C,N)` and `c_slot(C,N,I)`
for whatever string is there, with no validation, and the geometric rules relate
members through `c_node/2` and an edge quantity. **So a constraint can name
`stt(i1,hover,label)` with no type change anywhere.** `align`, `gap`,
`equalSize`, `symmetric` and `pin` all work over a state copy because it has
`frame/3` and a world chain; `differ`, `match` and `atMost` work over one
because it has `rendered/3`.

**But one thing is not already true, and every step must know it.**
`pruneConstraints` (edits.ts) filters members with

```ts
const nodes = c.nodes.filter((id) => alive.has(id) || holdsDatum(scene, id));
```

`alive` is the set of *document* node ids. A state copy is neither, so **today
that line would silently delete a cross-state rule** the next time anything calls
`pruneConstraints` — which is `deleteNodes`, `groupNodes`, `setGuides` and
`removeGuide`. (For the record: it would delete a member naming `inst(i1,label)`
too, which is a latent bug of the same shape that nobody has hit because the
canvas offers no way to name an instance part as a member.)

**The fix, owned by step 7:**

```ts
const nodes = c.nodes.filter(
	(id) => alive.has(id) || holdsDatum(scene, id) || holdsStateCopy(scene, id),
);
```

with `holdsStateCopy` as specified in §2.3 — blunt on purpose, exactly as
`holdsDatum` is blunt about a track index.

**Machine health as rules.** The Machines panel offers four one-click checks,
each of which is an ordinary `custom` constraint added with the existing
`addCustomConstraint`. There is no new constraint kind. The canned bodies,
exported from `machines.ts` as `MACHINE_CHECKS: Array<{ id: string; label: string; rule: string }>`:

```prolog
viol(machine_reachable)     :- munreached(_,_).
viol(machine_no_dead_ends)  :- mdeadend(_,_).
viol(machine_deterministic) :- mnondet(_,_,_).
viol(machine_wired)         :- mdangling(_,_).
```

They get an enable switch, a name in the unsat core, a strength the designer can
soften to a preference, and `why` and `relax` for free — which is precisely what
the brief asks for and precisely what a bare `:- ...` in the Rules panel could
never have.

**A constraint that holds in one state and breaks in another** needs no
machinery at all: it is one constraint naming two state copies. The example the
tests must use:

```
align [stt(b1,rest,label), stt(b1,hover,label)] on centerY
```

— "the label does not jump when you hover" — which is satisfiable, and becomes
unsatisfiable when a `hover` delta moves the label's `y`, at which point the core
names that one rule.

---

## 6. The CONTRACT block — exact text to add

Insert into `CONTRACT` in `compile.ts` **immediately after** the `% Components.`
section (the paragraph ending `pick(prop(inst(I,N),P),K) assumed, which is the
same thing a pin is.`) and **before** `% Automatic layout.`. Nothing already in
the block is deleted; two existing lines gain a clause, marked below.

````
% State machines. A definition may have one, and a machine is component-local
% *behaviour*: states, and transitions between them. It is emphatically not a
% design space. Every state of every instance is true at once, in this one
% answer set, and nothing here is ever an alternative — so adding a fourth state
% to a machine leaves the number of universes exactly where it was. Variants and
% states are a matrix, not a cross product.
%
%   machine(M)  machine_of(M, R)   M drives the definition rooted at R
%   mstate(M, S)                   S is a state of M. Ids are unique per
%                                  machine, not per document: `hover` is what
%                                  every machine calls that state
%   mindex(M, S, K)                S is M's Kth state, 1-based. There is no
%                                  `initial` flag — the order is the answer,
%                                  the way order/2 is the paint order
%   minitial(M, S)                 derived: mindex(M,S,1)
%   mpart(M, N)                    definition part N gets a copy per state.
%                                  Only the parts some state touches, plus
%                                  their ancestors: a frame is parent-relative,
%                                  so a state that moves a container moves
%                                  everything inside it for nothing
%   mhide(M, S, N)                 state S takes part N out of the picture
%   shown(I, S)                    which state instance I is drawn in. A fact,
%                                  never a choice: it decides rendered/3, which
%                                  is projected, so a choice over it would
%                                  multiply the universes by the state count
%
% The copies, and the view the rest of the program sees:
%
%   stt(I, S, N)                   instance I's copy of part N in state S.
%                                  **Never a node/1** — it carries frame/3 and
%                                  rendered/3 and nothing else, so the canvas,
%                                  the layer list and both exports never see
%                                  one. gsolved/1, lv/2, lsz/2, ge/2 and
%                                  c_node/2 do not need node/1, which is what
%                                  lets a rule place one and compare two
%   mcopy(I, S, N)                 derived: that copy exists
%   mbase(I, N, D, V)              derived: what I's copy of N is before any
%                                  state has an opinion
%   frame(inst(I,N),D,V) :- frame(stt(I,S,N),D,V), shown(I,S).
%   rendered(inst(I,N),P,L) :- rendered(stt(I,S,N),P,L), shown(I,S).
%   hidden(inst(I,N)) :- mhidden(I,S,N), shown(I,S).
%                                  inst(I,N) is a *view* of the shown state, so
%                                  frame/3 and rendered/3 stay untimed and
%                                  everything downstream is unchanged
%
% What a state does not touch, it shares. A property no state of the machine
% mentions is read from prop(inst(I,N),P) — the instance's one variable — by
% every state copy at once. That is the invariant, spelled as a rule: minting a
% copy of a two-alternative fill per state would make four states sixteen
% designs where the document holds two.
%
%   sprop(I, S, N, P)              the variable one state's delta mints for a
%                                  property; a value like any other, so it may
%                                  name a token or hold alternatives, and where
%                                  it holds two that really is two designs
%   sfval(I, S, N, D)              the same for one of the four dimensions
%   mshadow(inst(I,N), P)          some state owns this property, so the
%                                  instance does not draw it from its own
%                                  variable — the shown copy does
%   mfshadow(I, N, D)              the same for a dimension
%
% Time is the fourth quantity, beside length, count and ratio:
%
%   millis(Lit, Ms)                the DURATION a literal reads as, in whole
%                                  milliseconds: "200ms" is 200 and "0.2s" is
%                                  200 too. Exact or absent — "1.5ms" is not a
%                                  whole millisecond, so it emits nothing, and
%                                  a bare number is refused except for 0, which
%                                  reads the same under either unit
%   mval(M, T, duration|delay|stagger)   the variable a motion setting is, so a
%                                  `duration` token with two alternatives is a
%                                  motion scale the document holds both ends of
%   mdur(M, T, Ms)                 derived: millis(resolved(mval(M,T,duration)))
%   mdelay(M, T, Ms)  mstagger(M, T, Ms)   the same. Duration and stagger clamp
%                                  at zero; a delay does not, because a negative
%                                  one starts the move partway through
%
% Transitions, and what is wrong with them. All four checks are *derived*, not
% enforced, so a rule of yours forbids the ones you care about by name — and
% then it has an enable switch, a place in the unsat core, a strength you can
% soften to a preference, and `why`:
%
%   mtrans(M, T)   mfrom(M, T, S)   mto(M, T, S)
%   mtrigger(M, T, ...)            one of the trigger words below
%   measing(M, T, ...)             linear|ease|easeIn|easeOut|easeInOut
%   monly(M, T, Prop)              tween only these; no monly at all is
%                                  everything the state changes
%   mreach(M, S)                   derived: reachable from the initial state
%   munreached(M, S)               derived: and the states that are not
%   mdeadend(M, S)                 derived: nothing leaves S
%   mnondet(M, S, G)               derived: two transitions leave S on trigger G
%   mdangling(M, T)                derived: T names a state M has not got
%   mtwoshown(I)                   derived: two shown/2 for one instance, which
%                                  is two pictures on top of each other rather
%                                  than an instance in two states
%
%   viol(machine_deterministic) :- mnondet(_,_,_).
%
% A rule that relates two states is an ordinary rule with an unusual member. A
% state copy is a term c_node/2 takes exactly where it takes a node id, so "the
% label does not jump when you hover" is an align, with a name and a switch:
%
%   c_node(no_jump, stt(b1,rest,label)).
%   c_node(no_jump, stt(b1,hover,label)).
%   c_edge(no_jump, centerY).
%
% A machine changes appearance, geometry and presence. It does not change
% structure: no node appears, moves in the tree or changes kind, and hiding is
% the one structural verb, because it is the one a stylesheet can say. A
% definition on the canvas is always its rest state — a definition part's frame
% is a fact, a fact cannot be un-said by a rule, and every instance inherits it,
% so drawing the definition in another state would move the component itself.
````

Two existing lines gain a clause:

- Under **Scene**, `rendered(N, Prop, Lit)` gains:
  `"…what it draws with — an interned literal id, or the text itself in quotes.
  Not derived from a node's own variable where mshadow(N,Prop) holds: a machine
  owns that property, and the shown state's copy draws it"`.
- Under **Components**, `node(inst(I,N)) kind order child frame` gains:
  `"…frame and rendered come from the shown state's copy where the definition
  has a machine — see State machines below"`.

---

## 7. Duration parsing — the rules, and every edge case

`msOf(text): number | undefined` in `values.ts`. Grammar:

```
duration := ws? sign? digits ('.' digits)? ws? unit? ws?
unit     := 'ms' | 's'      (case-insensitive)
```

| Input | Reads as | Why |
| --- | --- | --- |
| `"200ms"` | `200` | |
| `"0.2s"` | `200` | seconds × 1000, and 200 is whole |
| `"1s"` | `1000` | |
| `"0"` | `0` | the one unitless value both units agree on, and legal CSS |
| `"0ms"` `"0s"` | `0` | |
| `"200"` | *nothing* | ambiguous by a factor of 1000; CSS refuses it too |
| `"1.5ms"` | *nothing* | not a whole millisecond. Exact or nothing, like `emuOf` |
| `"0.1234s"` | *nothing* | 123.4 ms |
| `"0.125s"` | `125` | whole, so it reads |
| `"-100ms"` | `-100` | read and returned; `duration`/`stagger` clamp at the *reading*, `delay` does not |
| `"200MS"` `"1S"` | `200` / `1000` | CSS units are case-insensitive; a designer who typed it typed a duration |
| `"  200 ms "` | `200` | whitespace tolerated in the same three places `numeralOf` tolerates it |
| `"200 ms"` | `200` | space before the unit is allowed, matching the regex above |
| `"200px"` | *nothing* | not a duration; the `length` reader has it |
| `"1e3ms"` | *nothing* | exponent notation is not a spelling this document uses anywhere |
| `"600001ms"` `"601s"` | *nothing* | past `MAX_MS` |
| `"-600001ms"` | *nothing* | the ceiling is on the magnitude |
| `"Infinity"` `""` `"ms"` | *nothing* | |

**Where the parsing lives.** In `values.ts`, beside `numeralOf` and `tallyOf`,
not in `units.ts`. `units.ts` exists because a *length* has seven units on a
lattice with an exactness argument per unit; time has two units related by a
whole thousand, and a two-row table is not a module. The three quantity readers
sitting together is also what makes the fourth one obviously the fourth.

**What is *not* normalised.** Nothing. What the document stores is what was
typed, `"0.2s"` stays `"0.2s"`, exactly as a length keeps its own unit across an
edit. The inspector's duration field shows the stored text and commits what
`nearestMs` reads, spelled back in the unit it was already written in
(`writeDuration(ms, unit)` in `machines.ts`, the twin of `writeLength`) — so a
document written in seconds stays in seconds.

**What reaches ASP.** `millis(Lit,Ms)` for every interned literal `msOf` reads,
and `mdur/mdelay/mstagger` derived from the resolved value. A duration that
reads as nothing derives no `millis`, so the transition falls to the table's
default through `not mreadsdur(M,T)` — the same fallback shape a layout gap has,
and the same reason: silence here is not a relation left unstated, it is a
transition with no duration at all.

---

## 8. Export

### 8.1 Which states become which selector

Per machine, per instance drawn in the base layer:

1. Let `init` be the machine's initial state. The base layer already draws the
   instance's *shown* state; the export **re-emits the instance's own base rules
   from the initial state** and hangs every other state off it as a selector, so
   an exported file always starts where the machine starts. (A `SceneNode.state`
   other than the initial one changes what the canvas shows and what
   `data-state` is initialised to; it does not change which state is the CSS
   base.)
2. A state `S ≠ init` is a **pseudo-class state** when:
   - exactly one enabled transition goes `init → S`, and its trigger has a
     non-null `TRIGGERS[g].css`; **and**
   - exactly one enabled transition goes `S → init`, and its trigger is
     `TRIGGERS[g].pair`; **and**
   - no other enabled transition enters or leaves `S`.

   Then `on = ":" + TRIGGERS[g].css` — `":hover"`, `":active"`,
   `":focus-visible"`.
3. Every other state is a **data state**: `on = '[data-state="' + S + '"]'`, and
   the file gains the runtime.
4. A machine all of whose non-initial states are pseudo-class states emits **no
   script at all**. That is the common case and it is the point.

### 8.2 What is emitted

For each `StateLayer`, and with `.nK` the instance's own generated class:

```css
/* base — on the instance's parts, in the base layer, once */
.n7 { background-color: #2563eb; transition: background-color 200ms ease-out 0ms; }

/* the state */
.n6:hover .n7 { background-color: #1d4ed8; }
```

- `changed` is the diff of the state copy's declarations against the initial
  state's, computed with the existing `diff()` over the existing
  `declarationsFor` / `geometry` output, reading `ModelScene.states` instead of
  `byId`. Nothing new decides what a property becomes CSS as — `paintFor` and
  `cssValue` are already the answer.
- `transitions` maps each changed node id to `{ transition: "<props> <dur>ms <easing> <delay>ms" }`,
  where `<props>` is the CSS property names of the changed declarations, filtered
  by `monly` where the transition has one, and `<delay>` is
  `mdelay + i·mstagger` with `i` the node's position among the changed nodes in
  `order/2` sequence.
- A state that hides a part emits `display: none` on that node in the state, and
  nothing on the base rule.
- Selector weight: state rules come **after** the base rules and are not wrapped
  in `:where()` — a state is meant to win over the base, which is the opposite
  of what a style class is for.

### 8.3 `lost`

Added conditionally, in the manner of `GRID_LOST`:

- **A drawn-geometry node a state moves.** For every node in
  `drawnGeometry(base.model)` whose state copy differs from the initial copy in
  any dimension:
  `"State “open” resizes Arrow “a1”, and a line, an arrow and a path draw their own geometry inside their box — that markup is written once, so this state is in the file as a class that cannot move it."`
- **A state that hides a part.**
  `"State “closed” takes “panel” out of the picture. display:none is in the file and it is instant: there is nothing between shown and not shown for a transition to tween, however long the transition says."`
- **A hugging text box a state re-words.** For every state that changes a
  `MEASURED_PROPS` property on a part that `autoSizes`:
  `"State “busy” changes the words in “label”, which sizes itself to them. An instance's copy takes the definition's own box — that is true of components generally, not only of states — so the box in this file is the rest state's."`
- **A machine on a document exported to SVG.** Added to
  `EXPORT_TARGETS.svg.loses` unconditionally:
  `"Behaviour. An SVG has no states: what is here is the one state the instance is drawn in, and the transitions, triggers and other states are not in the file."`

### 8.4 The runtime

`runtimeScript(table)` emits, inside one `<script>`:

```html
<script>
(function(){
var T = { …the MachineTable as JSON… };
…MACHINE_RUNTIME…
})();
</script>
```

`MACHINE_RUNTIME` is a table interpreter: for each entry of `T.instances`, find
`[data-node="<id>"]`, set `data-state` to the machine's initial state, add one
listener per distinct `TRIGGERS[g].event` used by an edge out of any state, and
on an event look up `T.machines[m].edges[current][trigger]` and write
`data-state`. `load` edges are followed once at start. It is under sixty lines,
has no dependencies, and does the same lookup `stepMachine` does — which
`runtime.test.ts` proves by evaluating the emitted text in Node and comparing.

---

## 9. React API — the exact props

Every signature below is the contract. `onSceneChange` everywhere has the
studio's shape: `(next: (prev: Scene) => Scene, coalesce?: string) => void`.

### 9.1 New component: `packages/app/src/design/Machines.tsx`

```tsx
export interface MachinesProps {
	scene: Scene;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	/** Picks of the universe on screen, so a delta row resolves like any row. */
	picks: Picks;
	/** Variable keys the solver reports as unsettled. */
	varying: ReadonlySet<string>;
	reach?: Readonly<Record<string, Set<number>>>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	why?: (variable: string) => WhyRow | undefined;
	/**
	 * The current selection. A machine's delta rows are edited against whichever
	 * definition part is selected, and its state strip drives whichever instance
	 * is — so the panel is a view on the selection, not a modal of its own.
	 */
	selection: ReadonlySet<string>;
	onSelectionChange?: (ids: string[]) => void;
	/**
	 * Instance node id -> the state the canvas is drawing instead of the
	 * document's. **Editor state, not the document's** — see `useMachinePlayback`.
	 */
	playing: Readonly<Record<string, string>>;
	onPlay: (instance: string, state: string | null) => void;
	/** What the answer set says about each machine, by machine id. */
	health?: Readonly<Record<string, ModelMachine>>;
	/** Rules the design on screen breaks, so a machine check reads like any rule. */
	broken?: ReadonlySet<string>;
	/** Rules an unsat core blames, likewise. */
	conflict?: ReadonlySet<string>;
}

export function Machines(props: MachinesProps): JSX.Element;
```

### 9.2 New component: `packages/app/src/design/StateStrip.tsx`

```tsx
export interface StateStripProps {
	machine: Machine;
	/** The state the document draws the subject in. */
	shown: string;
	/** The state the canvas is playing, if any. */
	playing?: string;
	/** States the answer set says are reachable; absent greys nothing. */
	reachable?: ReadonlySet<string>;
	/** Play a state on the canvas. Null hands it back to the document. */
	onPlay?: (state: string | null) => void;
	/** Make a state the one the document draws. Absent where there is no subject. */
	onShow?: (state: string) => void;
	/** Editing, absent in the read-only strip the inspector shows. */
	onAdd?: () => void;
	onRename?: (state: string, name: string) => void;
	onDelete?: (state: string) => void;
	onReorder?: (state: string, to: number) => void;
}

export function StateStrip(props: StateStripProps): JSX.Element;
```

### 9.3 New component: `packages/app/src/design/Transitions.tsx`

```tsx
export interface TransitionsProps {
	scene: Scene;
	machine: Machine;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	picks: Picks;
	varying: ReadonlySet<string>;
	reach?: Readonly<Record<string, Set<number>>>;
	pins: Readonly<Record<string, number>>;
	onPin: (variable: string, index: number | null) => void;
	/** Per transition, what this universe resolved its motion settings to. */
	timing?: Readonly<Record<string, { duration: number; delay: number; stagger: number }>>;
	/** Transitions the answer set calls dangling or nondeterministic. */
	health?: ModelMachine;
	/** Play the transition on the canvas: drive `from`, then `to`. */
	onPlay?: (transition: string) => void;
}

export function Transitions(props: TransitionsProps): JSX.Element;
```

### 9.4 New hook: `packages/app/src/design/useMachinePlayback.ts`

```tsx
export interface Playback {
	/** Instance node id -> the state the canvas is drawing. */
	playing: Readonly<Record<string, string>>;
	/** Drive one instance to a state; null hands it back to the document. */
	play: (instance: string, state: string | null) => void;
	/**
	 * Feed a trigger at an instance and follow the edge, if there is one.
	 * Returns the state it landed in, or null if nothing moved.
	 *
	 * This is what the canvas calls on a real pointer event, and it is the same
	 * `stepMachine` the exported runtime interprets — so watching it in the
	 * studio and clicking it in a browser cannot disagree.
	 */
	fire: (instance: string, trigger: Trigger) => string | null;
	clear: () => void;
}

export function useMachinePlayback(scene: Scene): Playback;
```

**Playback costs no solve.** The answer set already holds every state's `frame`
and `rendered` in `ModelScene.states`; playing a state is the canvas reading a
different entry out of the model it already has. Nothing recompiles, nothing
re-grounds, nothing lands in undo. *Setting* the drawn state — `SceneNode.state`
— is a different act, is an edit, and does land in undo.

### 9.5 New props on existing components

**`InspectorProps`** (`Inspector.tsx`) gains exactly two:

```tsx
	/**
	 * Instance node id -> the state the canvas is drawing. Editor state; the
	 * inspector's state strip reads it and the section's Play buttons write it.
	 */
	playing?: Readonly<Record<string, string>>;
	onPlay?: (instance: string, state: string | null) => void;
```

and one new private section, placed after `ComponentSection` and before
`StyleSection`:

```tsx
function StateSection({
	scene,
	node,
	machine,
	picks,
	playing,
	onSceneChange,
	onPlay,
	onSelect,
}: {
	scene: Scene;
	node: SceneNode;
	/** The machine driving this node — `machineForNode`, never undefined here. */
	machine: Machine;
	picks: Picks;
	/** The state the canvas is playing for *this* node. */
	playing?: string;
	onSceneChange: (next: (prev: Scene) => Scene, coalesce?: string) => void;
	onPlay?: (instance: string, state: string | null) => void;
	onSelect?: (ids: string[]) => void;
}): JSX.Element;
```

It renders a read-only `StateStrip` (no `onAdd`/`onRename`/`onDelete`), a
"Draw this instance in…" row that calls `setNodeState`, and a link to the
Machines panel. Editing a machine happens in one place.

**`ArtboardProps`** (`Artboard.tsx`) gains exactly one:

```tsx
	/**
	 * Instance node id -> a state to draw instead of the one the answer set
	 * shows. Read out of `universe.model.states`, so it costs no solve — the
	 * copies are already in the answer set beside the picture.
	 */
	playing?: Readonly<Record<string, string>>;
```

**`ConstraintsProps`** (`Constraints.tsx`) gains exactly one:

```tsx
	/**
	 * State copies a rule may name, as `stateCopyIds` lists them — offered in the
	 * member picker beside the node ids and the datums. A cross-state rule is an
	 * ordinary rule with an unusual member; this is the only place the panel has
	 * to learn that.
	 */
	stateMembers?: readonly string[];
```

**`Studio.tsx`** gains a fourth entry in `PANELS`:

```tsx
const PANELS = [
	{ id: "properties", label: "Properties" },
	{ id: "variables", label: "Variables" },
	{ id: "machines", label: "States" },
	{ id: "constraints", label: "Rules" },
] as const;
```

with the badge count `scene.machines.length`, and the label chain at lines ~657
and ~719 extended to
`byId.get(n)?.name ?? partLabel(scene,n) ?? datumLabel(scene,n) ?? stateLabel(scene,n) ?? n`.

No other prop on any existing component changes.

---

## 10. File ownership

**Touch only the files your step owns.** Thirteen agents share this working
tree; editing a file you do not own will be overwritten and will break the
build. A step that needs a symbol another step owns writes against the signature
in this document and does not go and add it.

| # | Step | Owns |
| --- | --- | --- |
| 1 | **The fourth quantity** — `ValueType "duration"`, `Quantity "time"`, `VALUE_TYPES.duration`, `msOf`, `nearestMs`, `MAX_MS`, `isTimeType`, `motionVar` | `packages/design-core/src/values.ts`, `packages/design-core/src/values.test.ts` |
| 2 | **The document types** — `Trigger`, `TRIGGERS`, `Easing`, `EASINGS`, `DEFAULT_EASING`, `MotionProp`, `MOTION_PROPS`, `StatePart`, `MachineState`, `Transition`, `Machine`, `Scene.machines`, `SceneNode.state`, `emptyScene` | `packages/design-core/src/scene.ts` |
| 3 | **The reading** — the whole of `machines.ts`: terms, lookups, `materializedParts`, `machineHealth`, `machineTable`, `stepMachine`, `stateLabel`, `motionLabel`, `stateCopyIds`, `holdsStateCopy`, `writeDuration`, `MACHINE_CHECKS`; and `index.ts` | `packages/design-core/src/machines.ts` (new), `packages/design-core/src/machines.test.ts` (new), `packages/design-core/src/index.ts` |
| 4 | **The program** — fact emission, `MACHINE_RULES`, the `mbase` rewrite of two `COMPONENT_RULES` lines, the `mshadow` guard on `rendered/3`, `millis/2`, the `#show`/`#project` block, `variableCounts`, `unreadVariables`, and the CONTRACT text | `packages/design-core/src/compile.ts`, `packages/design-core/src/machineprogram.test.ts` (new) |
| 5 | **Reading it back** — `ModelState`, `ModelMachine`, `ModelScene.states`/`.shown`/`.machines`, the `collect` cases, folding solved geometry into a state copy's frame | `packages/design-core/src/model.ts`, `packages/design-core/src/model.test.ts` |
| 6 | **The document reader** — `normalizeScene` reads `machines` and `SceneNode.state`; drops a machine with no root, no states, a non-constant id, a duplicate state id, or a transition naming a state the machine has not got; snaps nothing (a duration has no lattice) | `packages/design-core/src/project.ts`, `packages/design-core/src/project.test.ts` |
| 7 | **The edits** — `addMachine`, `deleteMachine`, `renameMachine`, `addState`, `renameState`, `deleteState`, `reorderState`, `setStateProp`, `setStateFrame`, `setStateHidden`, `clearStatePart`, `addTransition`, `updateTransition`, `deleteTransition`, `setNodeState`, `pruneMachines`, and the `holdsStateCopy` clause in `pruneConstraints` | `packages/design-core/src/edits.ts`, `packages/design-core/src/edits.test.ts` |
| 8 | **The way out** — `StateLayer`, `MachineExport`, `exportMachines`, the CSS emission, the conditional `lost` entries, the SVG `loses` entry | `packages/design-core/src/export.ts`, `packages/design-core/src/export.test.ts` |
| 9 | **The runtime** — `MACHINE_RUNTIME`, `runtimeScript`, and the test that runs the emitted text against `stepMachine` | `packages/design-core/src/runtime.ts` (new), `packages/design-core/src/runtime.test.ts` (new) |
| 10 | **The Machines panel** | `packages/app/src/design/Machines.tsx` (new), `packages/app/src/design/Machines.module.css` (new) |
| 11 | **The strips** — the state strip, the transition list, and the inspector's section | `packages/app/src/design/StateStrip.tsx` (new), `StateStrip.module.css` (new), `Transitions.tsx` (new), `Transitions.module.css` (new), `packages/app/src/design/Inspector.tsx` |
| 12 | **The studio wiring** — the panel tab, the playback hook, the label chain | `packages/app/src/design/Studio.tsx`, `packages/app/src/design/useMachinePlayback.ts` (new) |
| 13 | **The canvas and the rules panel** — drawing a played state, firing triggers from real pointer events, offering state copies as members | `packages/app/src/design/Artboard.tsx`, `packages/app/src/design/Constraints.tsx` |

Files nobody owns and nobody may touch: `components.ts`, `measure.ts`,
`derived.ts`, `explore.ts`, `why.ts`, `relax.ts`, `annotate.ts`, `paint.ts`,
`tree.ts`, `units.ts`, `LayerList.tsx`, `Editor.tsx`. The design is arranged so
that none of them needs to change — if one of them does, that is a finding to
report, not an edit to make.

---

## 11. Tests each step must write

Written the way the neighbouring tests are: colocated `*.test.ts`, `node:test`
plus `node:assert/strict`, and **through the real compiler and solver** wherever
the claim is a claim about the program. `components.test.ts` is the model to
follow — a helper that builds a button definition and N uses of it, then
assertions over atoms.

**Step 1 — `values.test.ts`**
1. Every row of the §7 table, as one parameterised test.
2. `msOf` refuses everything `emuOf` accepts and vice versa, on `"200px"`,
   `"12pt"`, `"200ms"`, `"0.2s"` — the two quantity readers do not overlap.
3. `MOTION_PROPS`' three fallbacks all read through `msOf` (the twin of the
   existing test that every length fallback reads through `emuOf`).
4. `nearestMs("1.5ms")` is 2 and `msOf("1.5ms")` is nothing — the rounding has a
   caller and the parser does not do it.
5. `msOf` refuses `MAX_MS + 1` in both signs.

**Step 2 — no test file of its own.** Tables and types; steps 3 and 4 exercise
them. One assertion belongs to step 3: `TRIGGERS[g].pair`, where present, is
symmetric and shares its `css`.

**Step 3 — `machines.test.ts`**
1. `statePart`/`parseStatePart` round-trip, including a node id that is itself a
   term (`stt(i1,hover,cell(1,1))`).
2. `parseStatePart` reads nothing from `inst(i,l)`, `cg(page,3,left)` and a bare
   word.
3. `materializedParts`: a delta on a leaf materialises the leaf and every
   ancestor up to the root, **and nothing else** — in particular not the leaf's
   own children, and not a sibling.
4. `materializedParts`: a geometric constraint naming a definition part
   materialises it and its ancestors, with no delta anywhere.
5. `materializedParts`: a machine whose states are all empty materialises
   nothing.
6. `materializedParts`: a state that moves a *container* does not materialise its
   children — the payoff of parent-relative frames, asserted as a set equality.
7. `machineHealth` finds an unreachable state, a dead end, a nondeterministic
   pair and a dangling transition, each on its own minimal machine.
8. `machineHealth` and the solver agree: for each of those four machines, the
   answer set's `munreached`/`mdeadend`/`mnondet`/`mdangling` match the TypeScript
   answer exactly.
9. `stepMachine` follows an edge, refuses one that is not there, and prefers the
   first enabled transition where two share a `(from, trigger)`.
10. `stateLabel` reads `"Label · Hover — Button 1"` and nothing for a non-term.
11. `holdsStateCopy` is true for a state the machine still has and false once the
    state is deleted; it stays true when the part stops being materialised.

**Step 4 — `machineprogram.test.ts` (all against `directSolver`)**
1. **The invariant.** `explore` on a document with a two-state machine and on the
   same document with a four-state machine return the *same* universe count, and
   both equal the count with no machine.
2. **The invariant, harder.** A definition whose fill holds two alternatives and
   whose machine has four states, none touching fill, gives exactly two
   universes — not sixteen.
3. **Legitimate branching.** A `hover` delta holding two fills gives four
   universes on a two-alternative base fill, and each is a coherent pair.
4. `alt(stt(...))` and `pick(stt(...))` occur in **no** answer set of any
   document. Asserted as a scan over the atoms.
5. The shown state's `rendered` reaches `inst(I,N)`: with `state: "hover"` the
   instance's fill is the hover fill, and with no `state` it is the base fill.
6. `rendered(inst(I,N),P,_)` is **single-valued** for every `N`, `P` in a
   document where a state overrides `P` — the `mshadow` guard, tested as the
   thing it prevents.
7. A state that overrides `x` moves `inst(I,N)`; the same state leaves `width`
   at the definition's, through `mfshadow` being per dimension.
8. A state that hides a part removes it and its subtree from
   `readModel(...).byId`.
9. Every state's copy is in the *one* answer set: `frame(stt(i,rest,label),y,_)`
   and `frame(stt(i,hover,label),y,_)` both present, with different values.
10. **Cross-state constraint.** `align [stt(b,rest,label), stt(b,hover,label)]`
    on `centerY` is satisfiable; adding a `hover` delta on the label's `y` makes
    it UNSAT with a core naming exactly that rule.
11. Two instances of the same definition can be in different states at once, and
    each renders its own.
12. `mdur` follows a `duration` token, clamps a negative to 0, and falls to
    `mdefdur` for a transition that names nothing.
13. `millis/2` is emitted for `"200ms"` and not for `"200"`; `tally/2` is emitted
    for `"200"` and not for `"200ms"`.
14. The generated program for a document with no machines is **byte-identical**
    to what it was before the feature, except for the added `#defined` lines, the
    `not mshadow(N,P)` literal and the always-emitted rule section. (Assert the
    absence of `machine(`/`mcopy(`/`stt(` in the generated text.)
15. `mtwoshown` is derived when a hand-written rule asserts a second `shown/2`.
16. Grounding budget: a definition eight parts deep with a delta on the deepest
    leaf emits exactly `states × 8` `mcopy/3` atoms per instance and no more.

**Step 5 — `model.test.ts`**
1. `readModel` builds `states` from `frame`/`rendered` on `stt` terms, keyed by
   the whole term.
2. State copies are absent from `byId` and from `roots` — they are not nodes.
3. `shown` and the four health maps read back.
4. Solved geometry from `__lpx(lv(stt(...),x),…)` lands in `ModelState.frame`,
   the same way it lands in `ModelNode.frame`.
5. An answer set asked for without `scenery` reads as no states at all rather
   than as an error.

**Step 6 — `project.test.ts`**
1. A document with no `machines` reads back with `machines: []`.
2. A machine with no states is dropped; one with a non-constant id is dropped;
   one whose root is a plain string that is not in the document is **kept** (the
   twin of a dangling `instanceOf`, which says nothing rather than failing).
3. Duplicate state ids within a machine: the second is dropped, the first kept.
4. A transition naming a state the machine has not got is **kept**, so the
   `mdangling` check has something to report — dropping it would repair the
   document and hide the mistake.
5. `SceneNode.state` that is not a string is dropped; one naming a state the
   machine no longer has is **kept** and falls back at read time.
6. `normalizeScene` is idempotent on a document with a machine.

**Step 7 — `edits.test.ts`**
1. `addMachine` on a definition root produces a machine with exactly one state,
   named for the rest, with an empty delta.
2. `deleteState` on the initial state promotes the next one, and every transition
   that named the deleted state is deleted with it.
3. `deleteState` refuses to leave a machine with no states.
4. `reorderState` to position 0 changes which state is initial and nothing else.
5. `setStateProp` writes a delta and `clearStatePart` removes the part entry
   entirely when nothing is left in it — so "this state changes nothing here" has
   one spelling, not two.
6. `setNodeState` on a non-instance is a no-op.
7. `pruneMachines` drops a machine whose root stopped being a definition, and is
   called by `releaseComponent` and `deleteNodes`.
8. **The pruning fix.** A constraint naming `stt(i1,hover,label)` survives
   `deleteNodes` of an unrelated node — the regression this document exists to
   prevent — and is dropped when the instance is deleted.
9. Every edit returns the same scene object when nothing changed (the house rule
   the existing edits all keep).

**Step 8 — `export.test.ts`**
1. A rest/hover pair on `pointerenter`/`pointerleave` emits `:hover` and **no
   `<script>`**.
2. A `click` transition emits `[data-state="…"]` and a script.
3. The `transition:` declaration lands on the base rule, names only the CSS
   properties that actually change, and carries `mdur` and the easing's `css`.
4. `monly` narrows the property list.
5. A stagger produces increasing `transition-delay` in `order/2` sequence.
6. A hidden part emits `display: none` in the state and a `lost` entry.
7. A state moving a `line`/`arrow`/`path` produces the `drawnGeometry` `lost`
   entry and does not emit a broken class.
8. A document with no machines exports **byte-identical** output to before.
9. The SVG target gains its `loses` entry and carries only the shown state.
10. A themed collapse and a machine compose: the media query and the `:hover`
    selector are both in the file and neither eats the other.

**Step 9 — `runtime.test.ts`**
1. `new Function(runtimeScript(table))` evaluates without throwing.
2. Driving the evaluated runtime's lookup with every `(state, trigger)` pair of a
   three-state machine gives exactly what `stepMachine` gives — the one test that
   keeps the studio and the file honest with each other.
3. `runtimeScript` of an empty table is `null` at the call site (no script).
4. The emitted table round-trips through `JSON.parse`.

**Steps 10–13 — app.** The app has no test runner; these steps verify by
`pnpm turbo run typecheck` and by the DOM contract the existing panels keep:
every interactive element carries a `data-role`, and the new ones are
`add-machine`, `machine-name`, `state`, `add-state`, `state-name`,
`delete-state`, `show-state`, `play-state`, `transition`, `add-transition`,
`transition-from`, `transition-to`, `transition-trigger`, `transition-duration`,
`transition-easing`, `delete-transition`, `state-delta`, `clear-delta`,
`machine-check`, `goto-machine`.

---

## 12. Review checklist — what a reviewer checks before merging any step

1. Does the change add an `alt/2` or a `pick/2` over anything a state decides?
   If so it is wrong, whatever else it does.
2. Does it materialise a state copy for a part no state touches and no
   constraint names? If so §4 has been bypassed.
3. Does it make `stt(I,S,N)` a `node/1`? If so the layer list, hit testing and
   both exports are about to grow a case they do not need.
4. Does it change the arity or meaning of `frame/3`, `rendered/3`, `node/1`,
   `kind/2`, `child/2`, `order/2` or `visible/1`? The one permitted change is the
   `not mshadow(N,P)` guard in §3.3, and it is already spent.
5. Does a comment argue *why*, including what was considered and rejected? A
   terse one-liner reads as foreign here — see `components.ts` and `model.ts`.
6. Do local imports carry the explicit `.ts` extension?
7. Is the claim about the program tested through the real compiler and solver
   rather than through a hand-written atom list?
