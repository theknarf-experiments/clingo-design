# A second solver for the relations the first one cannot write down

**Status: frozen, amended twice — see §12 for the objections answered before
implementation and §13 for the two things implementation proved wrong. §13 wins
over §2.4, §6.1 and §7.3 wherever they differ.** Fifteen implementation steps code against this
document without talking to each other. Every type, every predicate, every
constant, every package boundary and every file below is the contract. Where an
implementation step finds this document wrong, it implements the nearest
correct thing *and says so in its return value* — it does not quietly redesign
an interface another step is coding against.

Two adversarial reviews were run against the first freeze and both found real
defects; thirty-one objections were raised, every one was checked against the
tree, and the text below is the amended version. Where an objection was
accepted the section it hit was rewritten in place. Where one was refused, or
where two of them proposed opposite fixes and one had to be chosen, **§12
answers it by name** — this document does not drop a disagreement quietly, for
the reason `docs/three-d-spec.md`'s own AMENDED blocks exist.

It extends the geometry that shipped with `docs/three-d-spec.md` and
`docs/merged-plan.md` rather than replacing any of it. **`docs/merged-plan.md`
still outranks its two source specs; it does not outrank this one**, because it
was frozen against a set of steps (M0–M24) that this track shares no work with.
Two files it lists as untouchable — `explore.ts` and `annotate.ts` — are claimed
here, and §9.1 says why that claim is legitimate rather than a violation.

---

## 0. The direction, and the five things it decides

> **clingo-lpx decides linear arithmetic, and a design tool wants three
> relations that are not linear: how far apart two things are, which way one
> lies from another, and whether three of them fall on one line at any angle. A
> second solver — FreeCAD's PlaneGCS, compiled to wasm — decides exactly those,
> as a refinement pass over an answer set the first solver has already produced,
> and it never decides anything the first solver could have.**

That sentence is the whole design. Everything below is a consequence of it
rather than a re-decision, and it is worth writing out what it buys and what it
costs, because both are unusual.

What it buys:

- **`align`, `gap`, `equalSize`, `symmetric` and `pin` do not change, at all.**
  They are exact, they are decided by simplex inside the answer set, and a
  document with no sketch rule in it compiles to a program that grounds no
  sketch atom and runs no sketch solve. The no-regression promise in §11 is
  asserted on that.
- **One switch, one currency, one core.** A sketch rule is `constraint(C)` with
  an `active(C)` guard like every other, so the unsat core, the Rules panel's
  blamed row, `why.ts` and `relax.ts` all name it with no new machinery. §2.4.
- **A rule can be about a diagonal.** `align` is axis-parallel by construction
  — `ge(A,E) = ge(B,E)` is one coordinate on one axis. Three cards on a line at
  37° is a sentence this tool has never been able to say, and it is the single
  most requested thing a linear geometry engine cannot do.

And the three things it costs, stated up front so nobody is surprised by §5 and
§6, because each is the opposite of an invariant this codebase holds:

1. **A number you push into PlaneGCS is a starting guess, not a fact.** Declare
   a circle of radius 50, ask for a tangency, and it returns `Success` having
   quietly made the radius 39.26. In this document a `frame/3` is a fact.
   §3.3 is the answer: everything the linear layer decided is *pinned* before
   the sketch solves, and everything it did not is *seeded*.
2. **Failure still writes geometry.** An over-constrained system returns
   `Failed` and leaves plausible, wrong coordinates behind. §6.1 is the answer:
   `apply_solution()` is called on two statuses and on no other, and the gate is
   before the merge into `Universe.solved`, never inside a renderer.
3. **The answer depends on where you started.** At `dof = 0` the starting point
   picks which of finitely many branches you land on; at `dof > 0` it picks a
   point out of a continuum. §4 is the answer: the starting point is document
   state, stored per node, edited by a drag, and never written by a solve.

### 0.1 What is *not* being built

Named here so no step invents it:

- **No new curve on the canvas.** The three kinds that ship (§1) are all
  point-to-point relations between anchors on ordinary boxes. Nothing draws a
  circle, nothing emits an SVG `A` command, `geometry.ts` gains no arc helper,
  and the exporters are untouched. That is a *reason* those three were chosen
  and not others; see §1.4.
- **No sizes.** The sketch layer moves positions and never a `width`, a
  `height` or a `depth`. §2.5.
- **No third axis.** The sketch plane is the document plane, x and y. A node
  inside a viewport may be named by a sketch rule; its `z` is not touched.
- **No feedback into grounding.** No `#external`, no `setExternals`, no second
  `Solver.open`, no integrity constraint learned from a numeric failure. §5.5
  is the argument, and it is the one place where getting this wrong would
  silently delete designs that are perfectly legal.

---

## 1. Which kinds ship

### 1.1 Three

| kind | label | members | value | means, in a design tool |
| --- | --- | --- | --- | --- |
| `distance` | Distance | 2 | `length` | these two sit exactly this far apart, measured however they lie |
| `bearing` | Bearing | 2 | `angle` | the second lies in this direction from the first |
| `collinear` | In a line | 3+ | — | these all fall on one straight line, at any angle |

Each is a relation between **anchors** — a named point on a node's box, §1.2 —
and each is provably outside clingo-lpx:

- `distance` is `√(Δx² + Δy²) = V`. Squaring both sides leaves a quadratic in
  the unknowns; there is no linear form and no integer-coefficient form.
- `bearing` is `atan2(Δy, Δx) = θ`. Fixing θ per universe does not rescue it:
  `Δy·cos θ − Δx·sin θ = 0` has irrational coefficients for every θ that is not
  a multiple of 90°, and the program's coefficients must be integers.
- `collinear` over three anchors is `(x₂−x₁)(y₃−y₁) − (y₂−y₁)(x₃−x₁) = 0`,
  which is bilinear in the unknowns.

What each is *for*, in the words the panel uses:

> **Distance.** “Badge” and “Card” sit 40px apart. A gap measures between two
> faces along one axis; this measures between two points, on the shortest path,
> whichever way round they are. It is how a label orbits a corner and how a
> callout keeps its leader the same length however the diagram is rearranged.

> **Bearing.** “Arrow” lies at 37° from “Node”. Measured clockwise from
> straight right, because that is the direction the document's x grows and its y
> grows downwards. A bearing on its own does not say how far — pair it with a
> Distance to pin the point, or leave it and the design has a ray of answers.

> **In a line.** “One”, “Two” and “Three” fall on one straight line. Not the
> same rule as Align, which is about a shared edge and is therefore always
> horizontal or vertical: this one is about a line at any angle, which is the
> one thing Align was never able to say.

### 1.2 Anchors

An `Edge` names one coordinate on one axis. A Euclidean relation needs a
**point**, which is a pair. Pretending an edge is a point would be one word for
two ideas, and this codebase's comments exist to prevent exactly that, so a
point gets its own small table:

```ts
/** A named point on a node's box — the nine handles, in reading order. */
export type Anchor =
	| "topLeft" | "top" | "topRight"
	| "left" | "center" | "right"
	| "bottomLeft" | "bottom" | "bottomRight";

/**
 * Which two edges an anchor is, so the table cannot drift from {@link EDGES}.
 *
 * Derived rather than written out: the x member is always a `pos` edge on the x
 * axis and the y member a `pos` edge on y, and both are looked up through
 * {@link edgeOn} exactly as `glead`/`gmid`/`gtrail` are in the program. A tenth
 * anchor would be a tenth pair of places, and there is no tenth pair.
 */
export const ANCHORS: Record<Anchor, { x: Edge; y: Edge }>;

export const ANCHOR_NAMES: Anchor[];
```

`ANCHORS` is generated in `scene.ts` from `EDGES` by crossing the three x
places (`left`, `centerX`, `right`) with the three y places (`top`, `centerY`,
`bottom`), in that order, so `ANCHOR_NAMES` is stable and `ANCHORS.center` is
`{ x: "centerX", y: "centerY" }` without anybody typing it.

One anchor per constraint, not one per member. That is the same shape `edge`
already has — `align … on left` is every member's left — it needs one panel
control rather than N, and the alternative (an anchor per slot) is a document
field whose length has to be kept equal to `nodes.length` through every
retarget. Where a designer really wants "this corner to that corner", the answer
is two rules or a `pivot`; the affordance is not worth a second array in the
document.

`Constraint` gains one optional field:

```ts
	/**
	 * Which point on each member a sketch rule is about — see {@link ANCHORS}.
	 *
	 * Absent on every linear kind and on every document written before sketch
	 * rules existed, which is why it is optional rather than defaulted: the
	 * compiler reads `spec.anchors` to decide whether to emit `c_anchor/2` at
	 * all, exactly as it reads `spec.edges` for `c_edge/2`.
	 */
	anchor?: Anchor;
```

A new field on `Constraint` needs no migration: `migrateConstraint` returns
`{...c}` and `isConstraint` tolerates keys it does not know. Verified. A new
field on `Scene` would be a different story entirely — see §4.1.

### 1.3 `ConstraintSpec` gains two columns

```ts
export interface ConstraintSpec {
	// … existing columns unchanged …
	/**
	 * Which solver decides this kind.
	 *
	 * `"linear"` is every kind that shipped: the relation becomes a
	 * clingo-lpx `&sum` theory atom inside the answer set, and the members'
	 * frames are handed to simplex through `gkind/1` → `gsolved/1`.
	 * `"sketch"` is a relation no linear encoding exists for: the program
	 * states the *rule* and states nothing about the *numbers*, and PlaneGCS
	 * decides them afterwards from the answer set.
	 *
	 * A column rather than a derivation off `geometric`, and this is the
	 * load-bearing part: `geometric` means "this rule is about where a node is
	 * rather than what colour it is", which is true of both engines and is what
	 * the Rules panel, `annotate.ts`, `machines.ts` and `edits.ts` are all
	 * asking when they read it. `gkind/1` was a pure mirror of `geometric` and
	 * must stop being one, or a sketch kind would drag its members into
	 * `gsolved/1`, mint `lv`/`lsz` for them and enrol them in the shared
	 * `&minimize` — two solvers claiming one rectangle, silently.
	 */
	engine: "linear" | "sketch";
	/**
	 * Which points it may be about; empty for every kind that reads an edge.
	 *
	 * The twin of {@link edges}, and exactly one of the two is non-empty on
	 * every kind. `shapeFor` and the compiler both branch on which, rather than
	 * on `engine`, because the question they are asking is "does this kind read
	 * an edge or a point" and a table answers it.
	 */
	anchors: Anchor[];
}
```

Every existing entry gains `engine: "linear", anchors: []`. The three new ones:

```ts
	distance: {
		label: "Distance",
		summary: "sit {v} apart",
		counted: false,
		distinct: false,
		minNodes: 2,
		maxNodes: 2,
		geometric: true,
		engine: "sketch",
		edges: [],
		anchors: ANCHOR_NAMES,
		valueType: "length",
		// Straight-line, so no combination of lead and trail edges measures it.
		// The seed is computed by `currentValue`'s sketch branch instead — see
		// §7.3 — and this list stays empty rather than lying about a sum.
		seed: [],
		annotation: "ray",
	},
	bearing: {
		label: "Bearing",
		summary: "lies {v} from the first",
		counted: false,
		distinct: false,
		minNodes: 2,
		maxNodes: 2,
		geometric: true,
		engine: "sketch",
		edges: [],
		anchors: ANCHOR_NAMES,
		valueType: "angle",
		seed: [],
		annotation: "ray",
	},
	collinear: {
		// Three, not two: any two points are on a line, so a two-member
		// `collinear` is a rule that is true by arithmetic and says nothing. The
		// same test `minNodes` applies everywhere — "fewest members for the
		// constraint to say anything".
		label: "In a line",
		summary: "fall on one line",
		counted: false,
		distinct: false,
		minNodes: 3,
		maxNodes: Number.POSITIVE_INFINITY,
		geometric: true,
		engine: "sketch",
		edges: [],
		anchors: ANCHOR_NAMES,
		seed: [],
		annotation: "ray",
	},
```

`distance` and `bearing` are `maxNodes: 2` for `gap`'s reason exactly: they read
their members by position, so a third has nowhere to go, and `rangesOverGroup`
is therefore false for all three (a group has no order).

**`bearing` is the first constraint kind in this tool whose `valueType` is not
`"length"`, and nothing in the value path can carry one yet.** That is a real
gap and it is named here rather than left for whichever step trips over it:
`shapeFor` writes `value: dimension(currentValue(...))` (edits.ts:1866),
`dimension` is `single(writeLength(emu, unit))` (scene.ts:5617), `compile.ts`
defaults an absent value to `dimension(0)`, and the Rules panel's `Dimension`
component is length-only end to end — `LengthInput`, `constraintValue`, and the
unlink branch that writes `single(formatLength(resolved ?? 0, unit))`
(Constraints.tsx:166-238). Left alone, a `bearing` would store `0px`, `mdegOf`
would refuse it (values.ts:1512 — a unitless non-zero is not an angle),
`sk_angle/2` would never derive, and touching the row's token menu would rewrite
the angle as a length. Three steps therefore carry an angle path, and each is
named in §9.2 rather than assumed:

- **P1** adds `angleValue(mdeg: number): Value` beside `dimension` in
  `scene.ts`, over the `writeAngle`/`nearestMdeg` pair that already shipped.
- **P6** branches `shapeFor` and `currentValue` on `spec.valueType`, writing
  `angleValue` for `"angle"` and `dimension` for `"length"`.
- **P12** branches the panel's `Dimension` on `spec.valueType`, with an angle
  field, an angle-aware resolved read, and an unlink branch that writes
  `writeAngle`.

"A new kind is one entry in `CONSTRAINT_KINDS`" is true of every kind that
measures a length and is not true of this one.

### 1.4 What was considered and refused, with the reason

Each of these is a real PlaneGCS constraint type. Each is refused, and the
refusals are as much of the decision as the acceptances.

- **`concentric`** — refused as a duplicate. Two boxes sharing a centre is
  `align … on centerX` and `align … on centerY`, both linear, both exact, both
  already in the menu and both able to name three members where a concentricity
  can only name two.
- **`perpendicular`** — refused as a duplicate of `bearing`. Two directions at
  90° is two bearings differing by 90°, and the document holds no line objects
  for a perpendicularity to be *about*: PlaneGCS's `perpendicular_ll` takes two
  lines, and a line here would have to be minted from a pair of anchors, which
  is a second geometry vocabulary for one relation already expressible.
- **`tangent`** — refused, and this is the one worth stating at length because
  it is the constraint PlaneGCS is famous for. A scene node is an axis-aligned
  box with an optional corner radius; it is not a circle and it is not an arc.
  PlaneGCS's `tangent_lc`, `tangent_cc` and `tangent_aa` are relations between
  primitives this document does not contain, so shipping tangency would mean
  first shipping a parallel sketch-primitive model — circles and arcs that are
  not nodes, not in the layer list, not selectable, not exportable, not in the
  multiverse. That is the parallel document model the 3D track spent a page
  refusing, and the useful half of tangency (two round things touching) is
  `distance` with a value the document already knows.
- **`point on circle`** — refused as `distance` under another name. "This node's
  centre lies on the ring of radius R about that node" *is* `distance = R`.
- **`arc length`, `equal radius`, `p2l_distance`** — refused for `tangent`'s
  reason: no arcs, no circles, no lines.
- **`equalDistance` / radial spacing** ("these six are evenly spread around
  that one") — refused for now, and named here so it is a deliberate omission
  rather than an oversight. It needs a *group* over an ordered ring, which is a
  `rangesOverGroup` sketch kind, which is a second decision about member order
  and about what a group means to a solver that has no `#count`. It is the
  obvious fourth kind and it is not in this document.

The three that ship all draw as one hairline between two points. That is not a
coincidence and it is the payoff of the selection: §8.4 adds exactly one
`Annotated` member and no curve rendering anywhere.

---

## 2. How they compile

### 2.1 The principle

**A sketch kind states its rule in the program and states nothing about its
numbers.** The program says which constraints exist, which are switched on,
which members they have, which anchor and what value — and then stops. No
`&sum`, no theory atom, no `lv`, no `lsz`, no term in the `&minimize`. The
answer set is a complete, exact linear answer that happens to also carry a
question, and the sketch layer reads the question off it.

That is what makes the two solvers compose instead of fighting. It also means
the whole feature is inert on documents that do not use it, in the strongest
sense available: `SKETCH_CONSTRAINT_RULES` is not emitted at all unless the
document holds a sketch rule, and the three `skind/1` facts that *are* always
emitted (§2.2) derive nothing without it.

### 2.2 `gkind/1` stops mirroring `geometric`

One expression changes, and it is the single most important line in this
section:

```ts
const GEOMETRIC_KINDS = Object.entries(CONSTRAINT_KINDS)
	.filter(([, spec]) => spec.geometric && spec.engine === "linear")
	.map(([kind]) => `gkind(${kind}).`)

/**
 * Which kinds the second solver decides. The twin of {@link GEOMETRIC_KINDS},
 * split off the same table, and the two are exhaustive and disjoint over the
 * geometric kinds by construction — which is what stops one rectangle being
 * claimed by simplex and by PlaneGCS at once.
 */
const SKETCH_KINDS = Object.entries(CONSTRAINT_KINDS)
	.filter(([, spec]) => spec.geometric && spec.engine === "sketch")
	.map(([kind]) => `skind(${kind}).`)
```

On the shipped document set `GEOMETRIC_KINDS` is byte-identical to what it is
today, because every shipped kind is `engine: "linear"`. That is the assertion
step P3 writes first.

**Where `SKETCH_KINDS` goes, stated so no step has to guess: unconditionally,
in the `geometry rules` section, on the line after `...GEOMETRIC_KINDS`**
(compile.ts:5144). Its twin is emitted unconditionally there for a stated reason
— *"`gsolved(N)` is something a hand-written rule may assert, and a contract
that quietly does nothing on some documents is not one"* — and the reason
carries over verbatim: `skcon/1` is something a hand-written rule may assert
too, and `skind/1` is the table it would be asserting against. So every
document, sketch rule or not, gains exactly three lines:

```prolog
skind(distance). skind(bearing). skind(collinear).
```

Three plain facts that derive nothing on a document with no sketch rule, are not
`#show`n, appear in no answer set, and cannot move a universe count. Everything
*else* in this section — `SKETCH_CONSTRAINT_RULES`, its `#defined` lines, its
`#show`s and its two `#project`s — is gated on the `sketched` flag of §2.3 and
grounds on no shipped template.

The consequence is that §11's first promise cannot be plain byte-equality, and
it is restated there rather than left ambiguous: **identical but for those three
`skind/1` facts.** The redundant `#defined skind/1.` is therefore dropped from
`SKETCH_CONSTRAINT_RULES` — a predicate with facts in every program needs no
declaration.

### 2.3 The emission loop

Two lines of `compile()`'s constraint loop change, and they change from asking
the flag to asking the tables:

```ts
		if (spec.geometric) {
			geometric = true;
			// Read the tables rather than the engine: the question here is
			// whether this kind is about an edge or about a point, and exactly
			// one of the two lists is non-empty on every kind. Written
			// `spec.geometric ? c_edge : …` it would have emitted
			// `c_edge(c1,undefined)` for a sketch kind, because `spec.edges[0]`
			// of an empty list is nothing at all.
			if (spec.edges.length > 0) {
				constraintLines.push(atom("c_edge", c.id, c.edge ?? spec.edges[0]))
			}
			if (spec.anchors.length > 0) {
				sketched = true
				constraintLines.push(atom("c_anchor", c.id, c.anchor ?? spec.anchors[0]))
			}
			if (spec.valueType) {
				emitValue(constraintVar(c.id), c.value ?? dimension(0))
			}
		}
```

`sketched` joins `geometric` as a local flag, and the constraint-rules section
appends `...(sketched ? SKETCH_CONSTRAINT_RULES : [])` after
`...(geometric ? GEOMETRIC_CONSTRAINT_RULES : [])`. After, because the sketch
rules read `gdatum/1`, `gpos/2` and `gsize/2`, which the geometry rules say.

`edits.ts`'s `shapeFor` changes the same way and for the same reason —
`...(spec.edges.length > 0 ? { edge } : {})` and
`...(spec.anchors.length > 0 ? { anchor: keptAnchor ?? spec.anchors[4] } : {})`,
where index 4 is `center`, which is the anchor a rule means when nobody said.

### 2.4 The new rule block, verbatim

This is `SKETCH_CONSTRAINT_RULES` in `compile.ts`, spliced into the
`constraint rules` section immediately after `GEOMETRIC_CONSTRAINT_RULES`.

```ts
/**
 * The sketch constraint kinds, as questions rather than as answers.
 *
 * clingo-lpx decides linear arithmetic. A Euclidean distance, a bearing and a
 * collinearity are not linear in the unknowns and no amount of rewriting makes
 * them so — squaring leaves a quadratic, fixing an angle per universe leaves an
 * irrational coefficient where the program needs an integer, and three points on
 * a line is a determinant. So this section states no `&sum` at all. It states
 * which rules exist, which are switched on, which points they are about and what
 * numbers they name, and a second solver reads that off the answer set and
 * decides the coordinates afterwards — see docs/planegcs-spec.md.
 *
 * The switch is the same switch. `skon(C)` is `active(C)` and nothing else, so a
 * sketch rule has a name in an unsat core, a row in the panel, an entry in `why`
 * and a place in a relaxation with no new machinery anywhere. What it does *not*
 * have is `gkind(K)`, and that omission is the whole safety argument: without it
 * a sketch rule's members never reach `gsolved/1`, never mint `lv`/`lsz`, and
 * never enter the shared `&minimize`, so the two solvers cannot both claim one
 * rectangle.
 */
const SKETCH_CONSTRAINT_RULES = [
	"#defined c_anchor/2.",
	"#defined numeral/2.",
	"#defined mdeg/2.",
	"skcon(C) :- constraint(C), c_kind(C,K), skind(K).",
	"% The switch, exactly as the linear kinds use it. It is the only thing this",
	"% program says about whether a sketch rule holds: the deciding happens",
	"% outside, and `active(C)` is the handle the answer comes back on.",
	"skon(C) :- skcon(C), active(C).",
	"% What the rule is about, per universe. Two predicates rather than one",
	"% because the two carry different units and a single `sk_value/2` would have",
	"% been a number whose meaning depended on which kind read it: sk_length/2 is",
	"% EMU and sk_angle/2 is thousandths of a degree, and neither can be got from",
	"% the other. A value that reads as no number at all — a dangling reference, a",
	"% percentage — derives nothing, and the rule then goes to the sketch layer",
	"% with no number and is dropped there, visibly, rather than meaning zero.",
	"sk_length(C,V) :- skcon(C), c_kind(C,distance), resolved(cval(C),L), numeral(L,V).",
	"sk_angle(C,V) :- skcon(C), c_kind(C,bearing), resolved(cval(C),L), mdeg(L,V).",
	"% Which point on the box. `c_anchor/2` is emitted for exactly the kinds whose",
	"% `anchors` list is non-empty, which is exactly the sketch kinds.",
	"skanchor(C,A) :- skcon(C), c_anchor(C,A).",
	"% Which members are nodes of this document — a whitelist, and it is a",
	"% whitelist on purpose. `node/1` is not only a fact here: a hand-written rule",
	"% may derive one, `node(cell(R,C)) :- pos(R), pos(C).` is the documented",
	"% example, and `c_node/2` is emitted verbatim from what the document wrote —",
	"% which is how `cg(page,3,left)` and `gl(s,g)` already turn up as members. A",
	"% blacklist of the four shapes we happen to know about would let `cell(1,1)`",
	"% through: it would be sksolved, PlaneGCS would pick its coordinates, and",
	"% there would be no SceneNode to keep a starting point on and no drag gesture",
	"% to write one — a rule with a coin flip in it, arriving through the one door",
	"% an enumeration cannot close. So the compiler states this fact for every id",
	"% in `scene.nodes` and nothing else may be a point.",
	"#defined sknode/1.",
	"% ...and the refusals below survive as *messages* rather than as the gate.",
	"% Being able to say why a particular member was turned away is the whole",
	"% value of `refusedAnchor`, and 'this member is not a node in the document'",
	"% is the default sentence for everything the four cases do not name.",
	"% A datum is a line, not a point: a column line has a place on one axis and",
	"% nothing at all on the other, so an anchor of one would be half a coordinate",
	"% the document does not contain. Refused the way gdatum/1 already refuses a",
	"% span edge on a column line, one relation over.",
	"sknopoint(N) :- gdatum(N).",
	"% A copy is refused for a different reason and it is worth stating: a sketch",
	"% rule's starting point is stored on the node it moves (see the spec's §4),",
	"% and a state copy, a keyframe copy and an instance part are not nodes and",
	"% have nowhere to keep one.",
	"sknopoint(stt(I,S,N)) :- c_node(_,stt(I,S,N)).",
	"sknopoint(kfr(I,W,R,K)) :- c_node(_,kfr(I,W,R,K)).",
	"sknopoint(inst(I,N)) :- c_node(_,inst(I,N)).",
	"% A turned box has no corner where the document says it has one — that is why",
	"% `gnoedge/2` exists and why `inertMembers` has an `isTurned` branch — and a",
	"% sketch rule reaching for `topLeft` on a card turned 30 degrees would be",
	"% satisfied about a point the picture does not contain. The centre is the one",
	"% anchor a rotation leaves alone (a turn about the centre moves no linear",
	"% quantity, which is the decision the whole rotation feature rests on), so",
	"% the centre is the one anchor a turned member keeps.",
	"skoffcentre(N) :- grotated(N), skcon(C), c_node(C,N), c_anchor(C,A), A != center.",
	"sknopoint(N) :- skoffcentre(N).",
	"skpoint(N,A) :- skcon(C), c_node(C,N), skanchor(C,A), sknode(N), not sknopoint(N).",
	"% Which nodes the sketch layer may move. Read exactly as gsolved/1 is read —",
	"% naming a node in a sketch rule is what hands its place over — and the",
	"% switch is deliberately not consulted here for gsolved/1's reason: which",
	"% unknowns exist must not depend on which rules are assumed.",
	"sksolved(N) :- skcon(C), c_node(C,N), sknode(N), not sknopoint(N).",
	"% ...and which of its coordinates the linear layer already decided, which the",
	"% sketch layer reads and must not write. This is the one predicate that makes",
	"% the two solvers a sequence rather than a race.",
	"%",
	"% `gcoord/2` and emphatically not `gpos/2`, and the difference is the whole",
	"% rule. `gpos(N,A) :- gsolved(N), gplane(A).` derives only for a member of a",
	"% *linear geometric constraint*; a node in a stack is placed by the layout",
	"% equations and reaches the answer through `lslot/3`, never through `gpos/2`.",
	"% Written against gpos, every coordinate an automatic layout decided would",
	"% have arrived here untagged, been treated as free, and been moved — a sketch",
	"% rule silently overriding a row while the row still claimed to arrange it,",
	"% which is the two-solvers-one-rectangle failure this whole section exists to",
	"% prevent, arriving by the one door the tag was written to guard.",
	"% `gcoord/2` is the predicate that means 'the linear layer owns this",
	"% coordinate' — it covers gpos, gsize, lslot members and layout containers —",
	"% and `gplane(A)` narrows it to the two axes a point has. A layout container",
	"% gets `gcoord(C,S)` on its *spans* only, so a container named by a sketch",
	"% rule is held on nothing and is free to move as a whole, which is right: a",
	"% stack decides where its children are, not where it is.",
	"skheld(N,A) :- sksolved(N), gcoord(N,A), gplane(A).",
	"% The sketch plane is the document plane. A node in a viewport may be named",
	"% by a sketch rule and keeps whatever z the third axis gave it: PlaneGCS is",
	"% planar, and a third coordinate it never saw is a third coordinate it cannot",
	"% disturb.",
	"skmember(C,N,I) :- skcon(C), c_node(C,N), c_slot(C,N,I).",
]
```

`sknode/1` is a plain fact, one per entry in `scene.nodes`, emitted by the same
walk that already writes `node/1` and gated on `sketched` with the rest of the
block. It is declared `#defined` above so a document that somehow reaches these
rules with no node facts still grounds.

**What `skheld/2` now costs, said plainly, because it is a design decision and
not a detail.** A node that any linear geometric rule names is `gsolved`, and
`gsolved` gives it `gpos` on *both* planar axes — so `align [a,b] on left` holds
all four of `a`'s and `b`'s coordinates, and a `distance(a,b)` added on top has
no free coordinate to move and comes back conflicted. That is the intended
answer, not a bug: the two rules genuinely are a contradiction unless something
gives, the panel names both, and the designer turns one off. The common case a
sketch rule is *for* — two hand-placed boxes with no linear rule between them —
has nothing held and every coordinate free, which is why the feature is useful
at all. §5.1 is where that becomes a single solve, and §5.2
is the amendment that removed the loop it used to be.

### 2.5 What reaches the answer set

**These nine lines are the tail of `SKETCH_CONSTRAINT_RULES` itself, not an
addition to the `output` section, and that placement is load-bearing.** The
`output` section is unconditional; this block is not. `diagnostics.test.ts:77`
pins that this app *surfaces* clingo's "`#show` for a predicate nothing derives"
info message in the power panel, so an unconditional `#show skon(C)` would put
seven diagnostics nobody wrote into every document in the tool. Emitted with the
rules that derive the predicates, they appear exactly when something can derive
them and never otherwise. A `#show` and a `#project` are directives and are
position-independent within a program, so appending them to the rule array is
the same program as declaring them anywhere else.

Behind `scenery`, because these are picture atoms and a bare candidate solve
has no use for them:

```prolog
#show skon(C) : skon(C), scenery.
#show skmember(C,N,I) : skmember(C,N,I), scenery.
#show skanchor(C,A) : skanchor(C,A), scenery.
#show sk_length(C,V) : sk_length(C,V), scenery.
#show sk_angle(C,V) : sk_angle(C,V), scenery.
#show sksolved(N) : sksolved(N), scenery.
#show skheld(N,A) : skheld(N,A), scenery.
% A sketch rule's number is a design decision like a position: a `length` token
% with two alternatives is "40 apart" and "80 apart", and without this they
% differ in nothing projected and collapse into one universe with an arbitrary
% pick. Exactly the argument f_value/3 already makes, one relation over.
#project sk_length/2.
#project sk_angle/2.
```

The two `#project` directives are gated the way `merged-plan.md` §8 gates its
three: **P3 must show that no template's universe count moves.** No shipped
template holds a sketch rule, so none can, but that is a fact about today's
templates and it is re-checked rather than assumed.

Note what is deliberately **not** shown: nothing about sizes. `skheld/2` names
positions only, and the sketch system pins every member's `width` and `height`
from `frame/3` unconditionally (§3.2). A distance between two cards is about
where they are; letting a nonlinear solver resize a design node would make every
text box a free variable and would put hazard 1 into the middle of the type
system.

### 2.6 The CONTRACT

`compile.ts`'s `CONTRACT` gains a `% Sketch rules.` block naming every predicate
above — `skind`, `sknode`, `skcon`, `skon`, `skanchor`, `skpoint`, `sknopoint`,
`skoffcentre`, `sksolved`, `skheld`, `skmember`, `sk_length`, `sk_angle`,
`c_anchor` — plus the sentence that a sketch rule carries no `&sum` and is
decided outside the program. The drift guard is a test in P3's own file, in
`machineprogram.test.ts:3068`'s shape: a hand-written array of those fourteen
names, each asserted `CONTRACT.includes(name)`.

**And one correction while the file is open.** The CONTRACT's geometric
vocabulary line still reads

```
%   gedge(E, x|y, pos|span|axis)   what an edge is. A z row is emitted behind
%                               `spatial` and there are none yet — see Three
%                               dimensions
```

which has been false since the third axis landed: `EDGES` carries five z rows
and `EDGE_FACTS` emits all five behind `:- spatial.` P3 fixes that sentence in
the same commit. A rule-writer reading the contract is currently told the
third-axis edges do not exist.

---

## 3. The EMU boundary

### 3.0 Which coordinate system, before any of the rest of it

**The sketch system is built in world coordinates and its answers are written
back as local ones.** This is stated first because getting it wrong is silent
and total.

`readSolved` reads `lv/2` and `lsz/2`, and those are **parent-local**: `lv(N,x)`
is `N`'s offset inside its parent, and the world chain is `wv/2`, built by the
`gworld`/`gmoved` sums at compile.ts:616-637. A Euclidean distance between two
numbers in two different parents is not a distance. Ask for
`distance(cardInFrame, badgeOnPage) = 100` off local coordinates and PlaneGCS
reports `Success` at `dof = 0` on a design that is visibly wrong by the frame's
offset, and then writing the answer back as an `lv` moves the node by that
offset again.

So `sketch.ts` sums the chain on the way in and subtracts it on the way out,
using the function the overlay already uses for exactly this:
`placedNodes(scene.nodes, solved, context)` from `tree.ts`, whose `world` frame
is the accumulated origin. `annotate.ts` reads `placed.get(id)?.world` for the
same reason, so the ray drawn in §8.4 and the point solved here are the same
point by construction rather than by coincidence. `tree.ts` is read, never
edited.

Two consequences to state rather than discover:

- **A member whose world origin cannot be computed is refused**, with a
  sentence, by `refusedAnchor` — the same door as a datum and a copy.
- **A sketch rule across a viewport wall is warned about, not refused.**
  `crossesViewport` (spatial.ts:1030) already answers that question for the
  linear kinds and `merged-plan.md` §6.2 already requires the warning; P2 reuses
  it verbatim, and the sentence says that one member is measured in model space
  and the other on the page, so the number is not the length anyone will see.

### 3.1 Where it is crossed, and how many times

**Twice per solve, in CSS pixels, through the two functions `units.ts` already
blesses, and nowhere else.**

- In: `cssPxFromEmu(emu) = emu / 9525`, applied once per coordinate as the
  primitive list is built.
- Out: `emuFromCssPx(px) = wholeEmu(px * 9525)`, applied once per coordinate as
  the solution is read back.

Pixels rather than EMU because PlaneGCS's convergence threshold, its
Levenberg–Marquardt damping and its DogLeg trust radius are all absolute
quantities tuned in a plane where a shape is tens or hundreds of units across. A
plane where the same shape is a million units across is not a different geometry
but it is a different numerical problem, and re-tuning three constants against a
library's internals is a worse bet than dividing by 9525. `units.ts` already
names the CSS-pixel plane as the one legitimate float plane in this codebase and
already names the two functions that cross into it.

Nothing else converts. In particular the sketch layer does **not** use
`emuFromRational`: that function is `readSolved`'s, it parses a clingo-lpx
rational, and a PlaneGCS answer is a double and not a rational. The two land in
the same shape (`Record<string, Partial<Box>>`) through different doors, and
`wholeEmu` is the single quantization on both.

### 3.2 The round-trip guarantee

> **For every integer EMU value `e` with `|e| ≤ ASP_EMU_CEILING` (536,870,911),
> `emuFromCssPx(cssPxFromEmu(e)) === e` exactly.**

Provable, not hoped for. `cssPxFromEmu` is one IEEE-754 division, so the
computed `e/9525` differs from the real quotient by at most half an ulp;
multiplying back by 9525 in one rounded operation gives a value within about
`2⁻⁵² · |e|` of `e`, which for `|e| ≤ 2³¹/4` is under `1.2 × 10⁻⁷` EMU.
`wholeEmu` rounds to the nearest integer (ties away from zero) and therefore
recovers `e`. P0 asserts it as a property test over the boundary values and a
pseudo-random sweep, not as a spot check.

The consequence that matters: **a coordinate the sketch layer does not move
comes back bit-identical.** So a document with a sketch rule that touches two
nodes has exactly two nodes whose coordinates can move, and every other number
in `Universe.solved` is the linear solver's answer unchanged. That is asserted
directly, per universe, in P5.

**And it is true by construction rather than by numerics, which is a correction
to the first freeze.** The tempting argument — "it was pinned, so PlaneGCS
returned the value it was given" — does not hold. `coordinate_x` is a
*constraint* whose residual is driven toward zero, not a substitution; the
parameter behind it is still a variable, and §6.1 applies the solution on
`Converged`, which §6.1 itself glosses as *the iteration stopped improving
rather than the residual reached zero*. On a `Converged` universe a pinned
coordinate can come back displaced by an amount nothing bounds, `wholeEmu` would
faithfully record the displacement, and a number simplex decided exactly would
be off by the half-pixel that compile.ts's EMU prose exists to prevent.

So the guarantee is made structural: **after `apply_solution()`, and inside
`packages/planegcs` before any number leaves the package, the solver's value for
every pinned coordinate is discarded and the EMU that was pushed is written back
verbatim. Only free coordinates are read out of the system at all.** The round
trip on a held coordinate is then the identity function, independently of
status, of iteration count and of the library's residual, and P5's assertion is
exact rather than tolerant. `dof()` and the conflict set are still read off the
system as the library reports them; it is only the *numbers* that are filtered.

### 3.3 Pinning, seeding, and the answer to hazard 1

Every coordinate in the system is one of **two** things, and there is no third:

| | what it is | how it is pushed | tag |
| --- | --- | --- | --- |
| **held** | a coordinate the linear layer decided — it is in `skheld/2` | `coordinate_x` / `coordinate_y` at the world value from `Universe.solved` | `held(<node>,<x\|y>)` |
| **free** | a coordinate of an `sksolved` node that is not held | pushed as a parameter with a starting value, no pinning constraint | — |

A free coordinate's starting value is `SceneNode.sketchSeed` where the node has
one, and the node's placed world frame in this universe where it does not. §4.

This is the whole answer to "a declared value is only an initial guess": there
are no declared values in the system that are not also pinned. PlaneGCS is
handed a system in which the only movable numbers are the ones this document has
decided are the sketch layer's, and every one of those is a *position* of a node
a sketch rule names.

**There is no third `fixed` category, and the first freeze's was unreachable.**
It claimed two things. "A size, always" could not be pushed: `SketchRequest` has
`points`, `pinned` and `rules` and no size field anywhere, because §2.5 already
argued that no size ever enters the system — a size is not a variable here, so
it needs no pin. And "every coordinate of a member that is not `sksolved`" is
empty by construction: by §2.4 a member that is not `sksolved` is one the
whitelist or a refusal turned away, and such a member mints no `skpoint/2` and
never enters the system to be pinned. A tag category no path can produce is a
guard that guards nothing and a test that can only pass, so it is deleted rather
than kept for symmetry. **No size, of any node, in any universe, is ever a
parameter of the sketch system.**

---

## 4. Where solved geometry lives

This is the hard part, and the ground facts this spec was briefed against get it
wrong. The correction, in one sentence:

> **Solved coordinates are derived state, exactly like every other solved
> coordinate in this tool. What is document state is the *starting point*.**

The brief's reasoning — "two identical inputs converged to different answers,
therefore the answer must be stored" — has the causality backwards. The two
inputs were not identical: they differed in the starting point, which was
implicit, unnamed and unstored. Name it, store it, and the solve becomes a pure
function of (document, picks, seed) again. Store the *output* instead and you
inherit every problem in §4.1 and gain nothing.

### 4.1 What is stored, and where

```ts
// on SceneNode
	/**
	 * Where a sketch rule starts looking for this node — see
	 * docs/planegcs-spec.md §4.
	 *
	 * Two whole EMU under **one scalar key**, spelled `"<x>,<y>"` — not a
	 * `{ x, y }` object, and not a {@link Value}.
	 *
	 * Not a `Value`, because a starting point is a numerical hint and not a
	 * design decision: it has no alternatives, names no token, and does not vary
	 * between universes. Giving it a `Value` would have made "where the solver
	 * began" a thing the multiverse branches on, which is a sentence with no
	 * meaning.
	 *
	 * Not an object, and this is the part that was got wrong once already.
	 * `reconcile.ts`'s `assign` recurses into any object-vs-object pair
	 * (lines 67-75), so a nested `{ x, y }` is written into Automerge as a map
	 * with independent last-writer-wins on each key — exactly like
	 * `SceneNode.frame`. A mixed `frame` merge is a small visible offset a
	 * designer drags back; a mixed *seed* selects which branch the solve lands
	 * in, so at `dof = 0` the design jumps to a placement neither peer aimed at,
	 * on a document neither peer would have made, with nothing marking it as a
	 * merge artefact. A string is not a branch, so the reconciler replaces it
	 * whole and the two peers' aims stay two whole aims.
	 *
	 * Absent is the node's placed frame in this universe, which is where every
	 * document written before this field began. So there is no migration, no
	 * normalizer branch and no format marker: a document that has never met a
	 * sketch rule holds no `sketchSeed` anywhere and behaves exactly as it did.
	 *
	 * Written by exactly one gesture — dragging a node the sketch layer owns —
	 * and by no solve. See §4.4.
	 */
	sketchSeed?: string;
```

The two readers and the one writer are in `sketch.ts` (P2), so the spelling is
parsed in exactly one place:

```ts
/** `"<x>,<y>"` in whole EMU, or nothing where the string is not that. */
export function seedOf(node: SceneNode): Point | undefined;

/** The inverse, and the only thing that writes the spelling. */
export function spellSeed(at: Point): string;
```

`spellSeed` writes `${wholeEmu(at.x)},${wholeEmu(at.y)}`; `seedOf` accepts
exactly two comma-separated finite integers and returns `undefined` for anything
else. `project.ts`'s `pruneNodes` drops a `sketchSeed` that `seedOf` refuses, so
a corrupt one degrades to absence rather than to a failure.

**On the node, and this is not a convenience.** A new *top-level* `Scene` key is
silently destroyed by mixed-version peers, and this was verified by execution
during the survey that preceded this document: `normalizeScene` returns an
explicit nine-key object literal with no spread of its input, so it drops keys it
does not know; `saveScene` then feeds that stripped scene to `reconcile`, whose
`reconcileMap` **deletes** every target key the source lacks. One peer on older
code merely opening a page and touching anything would erase the field from the
shared Automerge document for everybody. A field on `SceneNode` has no such
problem — `pruneNodes` spreads the raw node, verified likewise — and so does a
field on `Constraint`.

### 4.2 Merge semantics

Per-key last-writer-wins, which is stock Automerge and which is **correct here
and would have been badly wrong for the alternative.**

- For a seed: two peers who both aim the same node produce one of the two aims,
  and "the peer who last aimed it wins" is exactly right. It is the same
  semantics `SceneNode.frame` already has for a drag.
- For solved coordinates it would have been a disaster, and this is the second
  reason they are not stored. Automerge merges *per key*, so two peers who both
  solved and both wrote `{x, y}` would produce peer A's x beside peer B's y — a
  point that is a solution of neither solve. Given a sketch with `dof > 0` that
  is not a near miss; it is arbitrary geometry with two people's names on it.

The seed is two integers under one **scalar** key — see §4.1 for why the shape
had to be a string and not an object — so even the pathological case (two peers,
same node, same instant) yields one whole coherent aim rather than peer A's x
beside peer B's y. Had it been nested, `reconcile.ts` would have merged it per
axis and the argument two bullets up would have applied to the seed verbatim,
which is the one place this document's own reasoning would have refuted itself.

### 4.3 Documents that predate the field

Every document in existence. They hold no `sketchSeed`, so every free coordinate
starts at the node's placed frame, which is where the designer put it. Nothing is
migrated, nothing is stamped, `normalizeScene`'s nine-key literal is unchanged,
and `Scene.unit`'s role as the pre-EMU format marker is untouched.

`project.ts` validates the field where it reads a node and drops it if it is not
two finite integers — a dropped seed is a node that starts where it sits, which
is the same behaviour as absence, so a corrupt seed degrades to the default
rather than to a failure.

### 4.4 How the starting point is chosen and written

**Chosen:** absent means the node's placed frame in this universe. That is the
whole default and it means a designer never has to know the field exists until
they disagree with where the solver landed.

**Written:** by one gesture and no other.

A node the sketch layer owns cannot be dragged in the ordinary way — a drag
writes `frame`, the next solve overrules it, and the node springs back. So the
Editor branches: **a drag whose subject and axis appear in
`universe.sketch.owned` writes `setSketchSeed(scene, id, point)` instead of
`setFrames`,** coalesced under one undo entry keyed `sketch-seed:<id>` exactly as
a frame drag is coalesced today. It reads `owned` and does not re-derive
`sksolved`/`skheld` for itself; §7.4 says why that field is the only source. The node follows the pointer, the solve re-runs from the new
aim, and the design snaps to whichever branch that aim is in. That is the
affordance, and it is also the entire user-facing story of §0's hazard 3: *the
starting point picks the branch, so drag it and pick a different one.*

Two edits, both pure:

```ts
/** Aim a sketched node: where the second solver starts looking for it. */
export function setSketchSeed(scene: Scene, id: string, at: Point): Scene;

/** Forget it, so the node starts from wherever it sits. */
export function clearSketchSeed(scene: Scene, id: string): Scene;
```

**Never written by a solve.** This codebase already has the sentence for why —
*"a repair on read makes looking at a project an edit that syncs"*, verbatim in
`pages.ts` and `store.ts` — and auto-persisting solver output is that pattern
with a different subject. Every solve would be an undo entry, an `updatedAt`
bump and a sync round trip, for a value that is recomputed on the next solve
anyway.

### 4.5 Determinism, and the gate on the whole feature

With the seed stored, a solve is a pure function of (document, pick vector,
seed). For the picture to be reproducible the *implementation* must be a pure
function too, and that is not free. The pass therefore fixes everything the
library lets it fix:

- a **fresh `GcsSystem`** per solve — constructed, not `clear_data()`d, because
  a reused system is a place for state to hide;
- **canonical order**: nodes sorted by id, constraints sorted by id, parameters
  emitted in that order, so the parameter vector is a function of the document
  and not of a `Map`'s insertion history;
- **`Algorithm.DogLeg`**, pinned;
- **`set_max_iterations(100)`** and **`set_convergence_threshold(1e-10)`**,
  pinned as named constants in `packages/planegcs/src/index.ts`.

And then the gate, which is P0's job and is not negotiable:

> **P0 asserts that one hundred consecutive `solve`s of the same system from the
> same seed return byte-identical *solved coordinates*, for a system with
> `dof > 0` as well as for one with `dof = 0`; and that two `Sketcher`s from two
> separate `init_planegcs_module()` instances, handed the same `SketchRequest`,
> return byte-identical solved coordinates too. If that test does not pass, this
> feature does not ship.** The fallback is not to ship non-deterministic geometry
> with a warning on it; the fallback is to stop and report, because a design tool
> whose canvas differs between two people looking at one document has failed at
> the only thing it does.

**The assertion is over the output, and that is a correction to the first
freeze**, which asserted byte-identical *parameter vectors*. The failure this
gate exists to catch is the one the survey measured: two runs with **verified
byte-identical parameter vectors** landing at radius 39.256568 and 108.456660,
both reporting `Success`. A gate over the parameter vector tests the input to
that failure and would have gone green on the exact evidence that motivated it,
which is the worst thing a gate can do. Equality of the parameter vectors stays
in the test as a *precondition* — it is what makes a difference in the output
attributable to the library rather than to the builder — but the assertion is
the coordinates that come back.

P0 exists to explain that measurement or to kill the track.

---

## 5. The pass

### 5.1 The shape

One sketch pass per **drawn** universe, run over the answer set between its
arriving and `Universe.model` being realised — synchronously, on the caller's
thread, in `interpret`; see §7.1 for why it is not in the worker. Bare
candidates — the sampler's pool, the count-only solves — are never sketched,
because they carry no `scenery` and therefore no `sk*` atoms at all.

**One solve. There is no release loop.** `MAX_RELEASE` does not exist.

```
sketch(facts, scene, solved) -> Settled | Adrift | Blamed

  held  := { (N,A) : skheld(N,A) in facts }
  rules := { C : skon(C) in facts }

  sys := build(facts, scene, solved, held)      // §3.0, §3.3, canonical order
  st  := sys.solve(DogLeg)

  if st in { Success, Converged }:
      sys.apply()                               // §3.2: free coordinates only
      return Settled { coords, dof: sys.dof(),
                       redundant: sys.redundant(),
                       approximate: st === Converged }

  conflict := sys.conflicting()                 // tag ids, verbatim
  if conflict is empty:
      return Adrift                             // §5.4 — NOT a conflict
  return Blamed { rules: conflict ∩ rules,
                  pins:  conflict ∩ { held(N,A) tags } }
```

`Blamed.rules` and `Blamed.pins` are both reported and either may be empty. A
conflict made only of `held(...)` tags is not a broken sketch rule — it is a
sketch rule contradicting the placement the linear layer already decided — and
the panel has a different sentence for it (§8.1). This split is deliberately the
same one `attribute()` already makes for a clingo core, where an
`UnsatisfiableError` carries `conflict` *and* `pinned` for exactly this reason.

### 5.2 AMENDED — why the release loop was removed

The first freeze released a `held` pin, re-solved, and repeated up to three
times, justified like this:

> *A `held` pin is not something the document said; it is something the linear
> layer's `&minimize` chose among the many placements it was indifferent
> between.*

**That is false for most held pins, and the argument it rests on inverts the
predicate.** `skheld/2` derives from `gcoord/2`, and a coordinate is `gcoord`
exactly when the node is a member of an `align`, a `gap`, an `equalSize`, a
`symmetric` or a `pin`, or is a child of an automatic layout — which is exactly
when a *hard* `&sum` equality may be fixing it. Releasing such a pin does not
ask whether simplex was standing where it wanted to be; it discards an equality
that a hard rule states.

The failure that follows is silent and complete. Take `align [a,b] on left` plus
`distance(a,b) = 100px`. All four coordinates are `held`, the conflict names
them, round one releases them, the re-solve moves `a`, and the merged
`Universe.solved` draws `a` and `b` with different left edges. `align` is a
geometric kind and geometric kinds have no `viol/1` — compile.ts:5285-5288 says
so in as many words — so it is not violated, not in the sketch conflict set and
not blamed. **The canvas shows a design that breaks an active hard rule while
the Rules panel shows that rule green.** The only report would have been §8.2's
"the layout put this at 240px; the sketch moved it to 251px", which reads as a
nudge rather than as a broken rule.

The sound alternative — release only coordinates the linear layer has *proved*
it is indifferent about, and clamp the sketch's answer back into that interval —
needs the per-coordinate feasible interval that `freedom.ts`'s `Travel` probe
computes. §6.2 refuses to mix that number into this one and §9.2 forbids
touching that file, so as frozen it is unimplementable, and a spec may not
specify a thing it has also forbidden.

So: **one solve, and a conflict is a conflict.** A sketch rule that needs a
coordinate the linear layer owns is reported as contradicting it, by name, in
both directions. The two solvers stay a strict sequence — the linear one decides,
the sketch one fills in what is left — and there is no path on which the second
overrules the first.

What is given up is real and worth naming: a `distance` between two nodes that
an `align` already touches now conflicts where the loop would have found an
answer. That answer was not one the document asked for.

`Settled.released` and the Inspector's "the layout wanted this at 240" sentence
are deleted with the loop. Nothing is released, so nothing is reported as
released.

### 5.3 The bound

**One PlaneGCS solve per drawn universe.** Drawn universes are structurally
capped at `2·limit + 1 = 49` (the enumerating solve returns at most `limit + 1`,
and at most `limit` more are hydrated), and only the `map` template actually
reaches it. At the measured 0.53 ms per build-solve-apply cycle:

| | drawn universes | worst-case sketch cost |
| --- | --- | --- |
| ten of fifteen templates | 1 | ≤ 0.6 ms |
| `card`, `component` | 15–16 | ≤ 9 ms |
| `map` (the worst) | 49 | ≤ 26 ms |

Against a `map` exploration measured at 3163 ms, and against a re-ground
measured at 58–124 ms. The pass is affordable on the main thread, which is the
other half of §7.1's argument.

### 5.4 `Failed` with an empty conflicting set

**This is the case that must not become an integrity constraint, and it is worth
a section of its own.**

PlaneGCS returns `Failed` for two quite different reasons and reports them the
same way. One is a genuine over-determination, and it comes with a non-empty
`get_gcs_conflicting_constraints()` naming the tags that cannot all hold. The
other is **numeric non-convergence**: the iteration ran out of steps, or landed
in a flat region, or started too far from any root. That comes back with an
empty conflicting set, and it is a statement about the *arithmetic*, not about
the *rules*.

The pipeline's answer:

- The universe is kept, whole. It shows clingo's linear geometry — which is a
  real, exact answer to every rule the linear layer owns.
- It is marked **`adrift`**. The status line says so, the Rules panel says so,
  and the members' Inspector rows say the sketch did not settle.

  **The word is `adrift` and it is never `unsettled`, anywhere in this track.**
  `unsettled` is taken: it means *"this variable has more than one value across
  the multiverse"* in `Studio.tsx:630`, which passes it as `varying={unsettled}`
  and `varyingCount={unsettled.size}` to the same `StatusLine` this feature adds
  a pill to, and it is documented that way in `Inspector.tsx:167`,
  `Styles.tsx:52`, `Machines.tsx:112`, `ValueEditor.tsx:75` and
  `Artboard.tsx:670`. One word with two meanings in one file, one component and
  one status line is the failure `merged-plan.md` §2's naming table exists to
  prevent — the table that renamed `many` to `manyfrom` and `Solid` to
  `SpatialFrame` — and this one would have landed with a local `unsettled` memo
  of one type in scope while `unsettled` of another type was destructured from
  the hook two lines up. `adrift` is the word: the design is real, it is just not
  moored to the sketch rules.
- **No rule is blamed.** `conflict` gains nothing. A row is not reddened,
  because no row is at fault.
- **Nothing is learned.** No nogood, no integrity constraint, no re-solve, no
  exclusion of this pick vector.

The reason that last point is stated in bold in a frozen spec is that the
tempting move — "this candidate failed, so forbid this combination and ask for
another" — deletes answers. A numeric failure is a property of the starting
point and of the iteration count, not of the design. Turn it into
`:- active(c1), active(c2).` and you have removed from the multiverse every
design in which those two rules coexist, including the ones that would have
converged perfectly from a different seed. The designer then sees fewer designs
than the document describes, with no error and no way to find out why. That is
the worst failure mode available to this track, and it is worse than showing
adrift geometry with a label on it.

`SuccessfulSolutionInvalid` is treated identically to this case, for the same
reason and one more: the library is reporting that it reached a solution it
cannot vouch for, which is precisely the shape of a claim that must not be
promoted to a fact about the rules.

### 5.5 Why there is no CEGAR feedback into clingo, at all

Even a *non-empty* conflicting set is not a sound nogood over answer sets, and
this is the sharper version of §5.4. `sk_length(C,V)` depends on the pick
vector: a `distance` whose value names a token with two alternatives is 40px in
one universe and 80px in another, and a contradiction at 40 says nothing about
80. A learned constraint over `active(C)` atoms is pick-blind by construction,
so it would prune universes it was never entitled to.

Three further reasons, any one of which would be sufficient:

1. **Assumptions are unary.** `cd_solve` takes signed literals, one atom each.
   There is no way to forbid a *combination* of active constraints without new
   program text.
2. **There is no way to add program text to a live control.** `session.cc`
   exposes `cd_open`, `cd_solve`, `cd_configure`, `cd_externals` and `cd_close`,
   and grounds exactly once, at open. Adding an integrity constraint means
   re-opening.
3. **Re-opening costs 58–124 ms.** `explore.ts`'s header table claiming a ~15 ms
   grounding floor is stale by about 4×; a blank document grounds in 58.0 ms and
   `sudoku` in 124.4 ms, measured on the pinned Node against this build. A CEGAR
   iteration that re-grounds is a 3–5× edit-latency regression on every document
   in exchange for a nogood that is unsound anyway. **P3 corrects that table in
   the same commit that adds the sketch rules**, because it is the number
   somebody will cost the next feature against.

There is one shape of nogood that *would* be sound — the same non-empty
conflicting set reported by every enumerated universe, which is a conflict that
holds under every pick the document offers. It is still not implemented, because
the payoff is smaller than it looks: what it would buy is throwing
`UnsatisfiableError` instead of showing 24 universes each with two red rows, and
the second is more useful. It is named here so that the omission is a decision.

---

## 6. Status and dof

### 6.1 The four statuses

`SolveStatus` is `{ Success: 0, Converged: 1, Failed: 2, SuccessfulSolutionInvalid: 3 }`.

| status | `apply_solution()` | `Universe.solved` | universe marked | blamed |
| --- | --- | --- | --- | --- |
| `Success` | **yes** | free sketch coordinates merged over the linear ones | settled | — |
| `Converged` | **yes** | merged | settled, `approximate` | — |
| `Failed`, conflict non-empty | **no** | untouched | conflicted | the rule tags in the set, and separately the `held(...)` tags |
| `Failed`, conflict empty | **no** | untouched | **adrift** | — |
| `SuccessfulSolutionInvalid` | **no** | untouched | **adrift** | — |

`apply_solution()` is called on exactly two statuses. The gate is in
`packages/planegcs`, before any number reaches design-core — not in the bridge,
not in `interpret`, and emphatically not in a renderer, because a plausible
wrong coordinate is indistinguishable from a right one by the time it is a CSS
`left`. On the two statuses where it *is* called, only free coordinates are read
back out; every pinned one is restored to the EMU that was pushed, per §3.2.

`Converged` is applied and marked rather than applied silently, because the
library is saying the iteration stopped improving rather than that the residual
reached zero. If P0 finds that reading of the enum wrong — that `Converged` is
in fact the ordinary success path and `Success` something narrower — it
implements the correct mapping and says so loudly in its return value. That is
the house rule and this is exactly the sort of thing it exists for.

### 6.2 dof

`gcs.dof()` is read after every applied solve and reaches the studio as one
number per universe.

| | meaning | what the user is told |
| --- | --- | --- |
| `dof === 0` | the sketch rules pin every free coordinate | *settled* |
| `dof > 0` | a continuum of placements satisfies them; this is one | *N free — one of infinitely many. Drag a member to choose a different one.* |
| `dof < 0` | more rules than freedoms, and they happen to agree | *redundant*, plus the ids from `get_gcs_redundant_constraints()` |

`dof > 0` is the normal case for a single `bearing` and is not an error. It is
the reason the seed is stored: the design a designer sees is the one their aim
picked, and the sentence tells them the aim is theirs to move.

**dof is not fed into `freedom.ts`, and this is a correction to one of the
surveys this spec was briefed against.** The two are different questions with
different answers:

- `Freedom` / `Travel` / `degreesOfFreedom` is **per coordinate**, exact,
  obtained by two clingo-lpx probes per axis, and counts an axis the solver
  never took charge of as free. "Fully determined" there means "the document
  plus the linear rules pin all four axes of this one node".
- `dof()` is **per system**, a count, and says nothing about which coordinate is
  free.

Merging them would put two numbers with two meanings behind one word in one
status bar, which is the failure `StatusLine.tsx`'s own header comment was
written to prevent (*"5 universes · fully settled" is a sentence that
contradicts itself*). They get two pills, two roles and two sentences. See §8.3.

**And one thing the probe must not be asked, which follows from `freedom.ts`
staying untouched.** `probeFreedom` decides *which coordinates to probe* from
the keys of the record it is handed — *"a coordinate is in `solved` exactly when
the solver decided it"*, freedom.ts:180-193 — and `useExploration.ts:198` hands
it `exploration.universes[0].solved`. A node named only by a sketch rule is not
`gsolved`, so it has no `gcoord/2` and therefore no `gprobe/3` atom in the
grounding, and `cd_solve` returns UNSATISFIABLE immediately for a positive
assumption on an atom that is not in the grounding (`session.cc`,
`atoms.find(sym) == atoms.end()`). Selecting such a node would fire four UNSAT
solves through the worker, come back with `Travel` null on both axes, and
`dimensionPinned` would read that as *not pinned* — offering the Position field
as freely editable for the one node whose position the sketch owns.

The sketch's coordinates **do** go into `Universe.solved`, because the canvas
needs them (§7.4). So the filter is at the probe instead: **P11 subtracts
`SketchReport.owned` from the record it hands `explorer.probe`**, in
`useExploration.ts`, which it owns. `freedom.ts` is not touched, the probe is
asked only about coordinates clingo decided, and the Inspector learns that a
sketch-owned coordinate is pinned from `SketchReport.owned` rather than from a
`Travel` that cannot exist.

---

## 7. The seam in design-core

### 7.1 The package

`packages/planegcs` — a raw-source workspace package, `@clingo-design/planegcs`,
modelled on `packages/vfs` and **not** on `packages/clingo-wasm`. It compiles
nothing, has no `build` script, no `dist`, and no mise task: it wraps a prebuilt
npm dependency.

```ts
// packages/planegcs/src/index.ts
/**
 * Where the wasm lives.
 *
 * Injected rather than resolved, and that is the whole reason this package
 * stays testable. `@salusoft89/planegcs` is an ordinary registry dependency, so
 * Vite pre-bundles it and rewrites the `new URL("planegcs.wasm",
 * import.meta.url)` inside its glue to a path in `node_modules/.vite/deps`,
 * where no wasm was copied — which is why clingo-wasm gets away with no
 * `locateFile` and this cannot: clingo-wasm is a symlinked workspace package
 * and is excluded from pre-bundling. Under Node the glue's own fallback finds
 * the file with `fs`, so the parameter is optional and the unit lane needs
 * nothing.
 *
 * The app passes it from a `?url` import, exactly as `packages/vfs` does for
 * Automerge — and the `?url` import stays in the app, so no module in this
 * package is unloadable under `node --test`.
 */
export interface SketchOptions { wasmUrl?: string }

export interface Sketcher {
	solve(request: SketchRequest): SketchOutcome;
	close(): void;
}

export async function openSketcher(options?: SketchOptions): Promise<Sketcher>;
```

**`solve` is synchronous and the sketcher runs on the main thread. It is not
behind the solver worker.** The first freeze declared both — a synchronous
`solve` *and* a fourth `op` in the worker protocol — and they cannot both be
built. The protocol is id-keyed `postMessage` (`packages/app/src/solver/protocol.ts`;
`workerSolver.ts:51-56` wraps every op in a `Promise`), so a worker round trip is
necessarily async, and whichever step landed second would have found the other's
interface unimplementable.

Main thread, and here is the whole argument:

1. **`interpret` must stay synchronous.** It is a module-level function
   (`explore.ts:500`) with three call sites, and one of them is inside
   `relaxation` (`explore.ts:450-458`), which is passed to a plain
   `ways.map(relaxation)` inside `diagnose`. Making `interpret` async makes
   `relaxation` async, makes `UnsatisfiableError`'s relaxation list a
   `Promise.all`, and puts the edit directly against `relax.ts` and `why.ts` —
   which §9.1 declares untouchable and which twelve checks depend on. That is
   far outside P5's chartered "touches nothing else in the file".
2. **Moving the pass into the worker is worse, not better.** The pass needs the
   *scene* — the seeds of §4, the tree for the world chain of §3.0 — which the
   worker does not have and cannot be given without widening `SolveRequest`.
   `solver.ts` is on the untouchable list of §9.2 for a stated reason, and
   widening it so a second solver can ride along is precisely the "one interface
   answering two questions" that put it there.
3. **The budget allows it.** §5.3 measures the whole pass at ≤ 26 ms on the
   worst template, once per exploration, against a 3163 ms exploration. That is
   a 0.8% addition on a path the user already waits on, not a frame budget.

So `openSketcher` is `await`ed once, at startup, beside the clingo `Session`; the
resulting `Sketcher` is handed to the `Explorer`; and `solve` is a 0.53 ms
synchronous call. **P10 owns the `?url` import, the `vite.config.ts` entry and
the app-side construction, and adds no protocol op.**

`init_planegcs_module` is typed `any` in practice — the shipped
`dist/planegcs_dist/` has no `planegcs.d.ts` and every tsconfig here sets
`skipLibCheck` — so P0 hand-writes `packages/planegcs/types/planegcs.d.mts`, in
`packages/clingo-wasm/types/clingo.d.mts`'s shape and for its reason.

Licensing: `@salusoft89/planegcs`'s npm metadata declares `LGPL-2.0-or-later`
while the LICENSE file in the same tarball is the LGPL **v2.1** text. Do not
write either number into code. `packages/planegcs/NOTICE` says "uses
@salusoft89/planegcs (FreeCAD's PlaneGCS) under the LGPL, as declared by the
package", links `https://github.com/Salusoft89/planegcs`, and ships the upstream
LICENSE verbatim. Nothing is owed today — every package here is `private: true`
— and the obligation attaches to the first distributed build of
`packages/app`. It is satisfied structurally already: `planegcs.wasm` is a
separate file fetched at runtime and never linked into `clingo.wasm`.

### 7.2 The request and the outcome

Pure data, structured-clone-trivial, so it crosses a worker boundary unchanged:

```ts
export interface SketchRequest {
	/** Every point the system holds, in CSS pixels, in canonical order. */
	points: ReadonlyArray<{ node: string; x: number; y: number }>;
	/** Which of those coordinates are nailed down, and by what. */
	pinned: ReadonlyArray<{ node: string; axis: "x" | "y"; tag: string }>;
	/** The rules, in canonical order. Tag is the bare `Constraint.id`. */
	rules: ReadonlyArray<SketchRule>;
}

export type SketchRule =
	| { tag: string; kind: "distance"; a: string; b: string; px: number }
	| { tag: string; kind: "bearing"; a: string; b: string; deg: number }
	| { tag: string; kind: "collinear"; members: readonly string[] };

export type SketchOutcome =
	/** Free coordinates only — a pinned one is not in `points` at all. */
	| { status: "settled"; points: Record<string, { x: number; y: number }>;
	    dof: number; approximate: boolean; redundant: readonly string[] }
	/** The conflicting set verbatim: rule tags and `held(<node>,<axis>)` tags. */
	| { status: "conflicted"; tags: readonly string[] }
	| { status: "adrift" };
```

`points` carries **only the free coordinates**, and that is the type-level half
of §3.2: a pinned coordinate is not merely equal to what was pushed, it is
absent, so no caller can accidentally read a residual back into `Universe.solved`.

**The tag currency is the bare `Constraint.id`**, and the survey's correction to
the ground facts is adopted: `SolveOutcome.core` holds `active(<id>)` strings,
not ids, and `explore.attribute()` is what strips the wrapper. So the merge
point for a sketch conflict is `attribute()`'s **output** — its `conflict:
string[]` — and not `SolveOutcome.core`. Tagging the PlaneGCS constraints
`active(<id>)` would work too and was rejected: the sketch layer never touches
an assumption list, so wrapping ids in an assumption's clothing would be
carrying a name for a hop that does not exist.

### 7.3 What design-core owns

`packages/design-core/src/sketch.ts` — new, pure, no wasm:

```ts
/**
 * The `sk*` atoms of one answer set, read once and passed around.
 *
 * Declared here and not in `model.ts` so that `sketch.ts` depends on nothing
 * downstream of it: `readSketchFacts` is the only reader of these atoms in the
 * tree, and it lives beside the only consumer.
 */
export interface SketchFacts {
	/** `skon(C)` — the rules that are switched on, in id order. */
	readonly rules: readonly string[];
	/** `skmember(C,N,I)` — members by slot, per rule. */
	readonly members: ReadonlyMap<string, readonly string[]>;
	/** `skanchor(C,A)`. */
	readonly anchors: ReadonlyMap<string, Anchor>;
	/** `sk_length(C,V)` in EMU. */
	readonly lengths: ReadonlyMap<string, number>;
	/** `sk_angle(C,V)` in thousandths of a degree. */
	readonly angles: ReadonlyMap<string, number>;
	/** `sksolved(N)`. */
	readonly solved: ReadonlySet<string>;
	/** `skheld(N,A)`, as `"<node>:<x|y>"`. */
	readonly held: ReadonlySet<string>;
}

/** Reads them. Returns empty sets on an answer set with no sketch rule in it. */
export function readSketchFacts(atoms: readonly string[]): SketchFacts;

/**
 * Build the system from one answer set: §3.0's world chain, §3.1's pixels and
 * §3.3's two categories, and nothing else.
 *
 * `undefined` when `facts.rules` is empty — which is every document that holds
 * no sketch rule, and is what promise 3 of §11 is asserted on.
 */
export function sketchRequest(
	scene: Scene,
	facts: SketchFacts,
	solved: Readonly<Record<string, Partial<Frame>>>,
	context: ResolveContext,
): SketchRequest | undefined;

/**
 * Turn an outcome back into EMU **local** coordinates, in `readSolved`'s shape —
 * the inverse of the world sum `sketchRequest` applied on the way in, which is
 * why it takes the same three inputs and not just the outcome.
 *
 * Only free coordinates appear in the result, so a key here is a coordinate the
 * sketch layer genuinely decided.
 */
export function sketchSolved(
	outcome: Extract<SketchOutcome, { status: "settled" }>,
	scene: Scene,
	solved: Readonly<Record<string, Partial<Frame>>>,
	context: ResolveContext,
): Record<string, Partial<Frame>>;

/**
 * Which coordinates the sketch owns, as `SketchReport.owned` — `sksolved`
 * minus `skheld`, per node, in canonical order. The single source for the
 * Inspector's pinned rows, the Editor's seed drag and P11's probe filter.
 */
export function sketchOwned(
	facts: SketchFacts,
): Record<string, readonly ("x" | "y")[]>;

/**
 * Why this rule cannot be about this member — or nothing where it can.
 *
 * The TypeScript twin of `sknopoint/1`, and the third reader in the family
 * `refusedEdge` and `crossesViewport` already hold: the panel has to grey the
 * row while there is no answer set at all, and the program has to refuse the
 * point while there is.
 *
 * Takes the whole constraint, not just the member, because one of the five
 * refusals is about the *anchor*: a turned box keeps its centre and loses its
 * corners, so whether this member is refused depends on which point the rule
 * asked for.
 */
export function refusedAnchor(
	scene: Scene,
	constraint: Constraint,
	member: string,
	picks?: Picks,
): string | undefined;

/**
 * Where one anchor of one frame is, in that frame's own coordinate system.
 *
 * The one place `ANCHORS` becomes arithmetic, so the point the system solves
 * for and the point the overlay draws are the same expression. Takes a `Frame`
 * and not an id because both callers already hold a *world* frame —
 * `sketchRequest` per §3.0 and `annotate.ts`'s `raysFor` per §8.4.
 */
export function anchorPoint(frame: Frame, anchor: Anchor): Point;

/** `"<x>,<y>"` in whole EMU, or nothing where the string is not that. */
export function seedOf(node: SceneNode): Point | undefined;

/** The inverse, and the only thing that writes the spelling. */
export function spellSeed(at: Point): string;
```

with the sentences, verbatim, because they are the feature:

> **“Column 3” is a line on the canvas, not a box, so it has a place on one
> axis and none at all on the other. A distance needs two points. Name the node
> the line guides instead, or use a rule about the one axis the line has.**

> **“Label” here is a copy of a part inside a state, and a sketch rule starts
> from a point you can drag — which a copy has nowhere to keep. Put the rule on
> the part itself, or on the instance.**

> **“Card” is turned 30°, and a turned box has no top-left corner where the
> design says it has one — that is why an Align cannot read its edges either.
> Its centre is still exactly where it says, so a rule about the centre holds.
> Use the centre, or take the turn off.**

> **“cell(1,1)” comes from a rule rather than from the document, so there is no
> layer to drag and nowhere to keep a starting point. A sketch rule needs a node
> the design actually contains.**

The turned sentence is built from `describeTurn` (spatial.ts:771) so it reads
like the two that shipped. **This matters more than it looks**, and it is worth
saying why rather than leaving it to be discovered: `inertMembers`
(spatial.ts:973) returns `[]` the moment `constraint.edge === undefined`, so the
shipped turned-node refusal is silent for all three sketch kinds by
construction. §7.3 cites that early return approvingly as the reason
`spatial.ts` needs no edit — which is true of the *edge* refusal and false of
the *turn* refusal, and `refusedAnchor` is what has to carry the second one.
Without it, `distance` on `topLeft` between a card turned 30° and another node
would hold a point that is not where the corner is drawn: the rule satisfied,
the picture disagreeing with it, and no mark or sentence anywhere.

And a warning rather than a refusal, per §3.0:

> **These two are on opposite sides of a viewport, so one is measured in model
> space and the other on the page. The rule holds about the numbers; the
> distance you see on screen is not the one it names.**

`Interlocking with what shipped:` `spatial.ts`'s `inertMembers` already guards
on `constraint.edge === undefined` and therefore returns `[]` for a sketch kind
with no edit; P2 verifies that and adds the `refusedAnchor` sweep beside it.
`machines.ts`'s two `spec.geometric` filters are correct unchanged — a sketch
rule naming a definition part does pin that part — and P2 asserts it rather than
editing the file.

### 7.4 What `Universe` gains

**First, the one new function type, declared in `explore.ts` and owned by P5.**
`interpret` is a module-level synchronous function with three call sites, one of
which is inside `relaxation`, which `diagnose` hands to a plain `ways.map`. None
of them has a scene, none of them has a `Sketcher`, and none of them may become
async (§7.1). So the whole of the sketch layer reaches `interpret` as one
closure, built once per exploration by the `Explorer`, which is the only object
that holds both the scene and the sketcher:

```ts
/**
 * One universe's sketch pass, or nothing where the document holds no sketch
 * rule — a closure rather than a pair of arguments, so that `interpret` and
 * `relaxation` thread one optional value instead of two, and so that the scene
 * and the `Sketcher` stay inside the `Explorer` that owns them.
 *
 * Synchronous by contract. See §7.1: making this a `Promise` makes `interpret`
 * async, which makes `relaxation` async, which puts the edit against `relax.ts`.
 */
export type SketchPass = (atoms: readonly string[]) => {
	readonly report: SketchReport;
	readonly solved: Record<string, Partial<Frame>>;
} | undefined;

function interpret(
	atoms: readonly string[],
	costs?: readonly number[],
	sketch?: SketchPass,
): Universe;
```

`Explorer`'s constructor takes `sketcher?: Sketcher` and builds the closure; the
three call sites pass it through. `relaxation` gains it as a second parameter and
`diagnose` binds it at the `ways.map` — `ways.map((w) => relaxation(w, sketch))`,
which is the whole of the change to that expression and is still synchronous.

```ts
export interface Universe extends Candidate {
	// … solved, model, violated unchanged …
	/**
	 * What the second solver made of this design, or absent where the document
	 * holds no sketch rule at all.
	 *
	 * `solved` above already carries the sketch's answer merged over the linear
	 * one, so nothing that draws a picture reads this. What reads it is the
	 * studio, which has to be able to say *settled*, *one of infinitely many*,
	 * *did not settle* and *these two rules cannot both hold here* — four states
	 * a coordinate cannot carry.
	 */
	readonly sketch?: SketchReport;
}

export interface SketchReport {
	status: "settled" | "adrift" | "conflicted";
	/** Degrees of freedom the sketch has left. Absent unless settled. */
	dof?: number;
	/** True when the solve converged without driving the residual to zero. */
	approximate: boolean;
	/** Constraint ids the sketch blames, in this universe. */
	conflict: readonly string[];
	/**
	 * `<node>:<axis>` the sketch could not have, because the linear layer had
	 * already decided it — the other half of a conflict, and often the whole of
	 * one. Kept apart from {@link conflict} because a pin is not a rule and
	 * cannot be turned off; the panel has its own sentence for it. The same
	 * split `UnsatisfiableError` makes between `conflict` and `pinned`.
	 */
	pinned: readonly string[];
	/** Constraint ids that say nothing new. */
	redundant: readonly string[];
	/**
	 * Which coordinates the sketch owns — `sksolved` minus `skheld`.
	 *
	 * **The only source for this question anywhere in the studio.** Three
	 * readers need it: the Inspector's *Placed by a sketch rule* rows and its
	 * `dimensionPinned` clause (§8.2), the Editor's seed-drag branch (§4.4), and
	 * P11's probe filter (§6.2). Re-deriving it from `scene.constraints` in
	 * TypeScript would produce a different answer the first time a member is a
	 * datum, a copy or a turned box — the cases `sknopoint/1` excludes and a
	 * naive re-derivation does not — and it would produce that different answer
	 * in three components independently.
	 */
	owned: Readonly<Record<string, readonly ("x" | "y")[]>>;
}
```

**The merge is per coordinate, not per node**, and the expression is written out
here because three steps code against it:

```ts
const solved = readSolved(atoms);
for (const [id, box] of Object.entries(sketchSolved(outcome, scene, solved, context))) {
	solved[id] = { ...solved[id], ...box };
}
```

A spread at the node level — `{ ...readSolved(atoms), ...sketchSolved(...) }` —
replaces the whole per-node record and deletes every key the sketch does not
carry. `readSolved` returns `Partial<Box>` holding whatever of `x, y, width,
height, z, depth` the answer set stated (model.ts:781-800); `sketchSolved`
returns `{ x, y }`. So a node that is both an `equalSize` member and a
`distance` member would lose its solved `width`, `boxOf` would fall back to
`facts.frame` (model.ts:1511-1520), and the node would snap to its stated width
while the answer set says otherwise; a node in a viewport would lose its solved
`z` and `depth` through `spatialOfTerm` (model.ts:1538-1549), breaking §0.1's
promise that a sketched node's `z` is not touched. P5's own assertion would not
catch it, because the nodes it expects to differ are exactly the ones that
would.

**And one edit in `model.ts`, because the merge alone does not reach the
picture.** `Universe.model` is `readModel(atoms)` (explore.ts:519), and
`readModel` computes its *own* `const solved = readSolved(atoms)` at
model.ts:1697 and feeds that to `boxOf` at 1726. It never sees `Universe.solved`.
Only `Editor.tsx` reads `universe.solved`; `Artboard.tsx` draws `universe.model`
(lines 756, 833, 865) and `ExportUniverse` carries `model` as the geometry
(export-core/src/options.ts:117). Left as the first freeze had it, a design with
a `distance` rule would be drawn two contradictory ways at once — the sketch's
placement on the editable canvas, the linear placement in the multiverse grid,
the posters and every exported file — and §11's export promise would be asserted
against a path the feature never reaches, so it would pass while the feature was
broken.

So **P4 gives `readModel` a solved override**:

```ts
export function readModel(
	atoms: readonly string[],
	/**
	 * Coordinates decided outside this answer set — the sketch layer's, and
	 * nothing else today. Merged over `readSolved`'s own reading per key, so a
	 * node the override names keeps every coordinate the override does not.
	 */
	override?: Readonly<Record<string, Partial<Frame>>>,
): ModelScene;
```

and P5 passes the merged record into both `solved` and the lazy `model` getter.
The sketch is picked up by one edit in `model.ts` — not by none.

`attribute()` in `explore.ts` gains no case: sketch conflicts never appear in a
clingo core. They reach the studio as `Universe.sketch` and get their own state
in the hook, beside the clingo conflict and never merged into it. §8.1.

---

## 8. The UI

### 8.1 `Constraints.tsx` — the Rules panel

The three kinds appear in the kind menu for free, because the menu is
`CONSTRAINT_NAMES` and the gating is `spec.geometric || available.length > 0`.
What has to be written:

0. **The edge control has to be gated on the table, not on the flag.** Line 794
   reads `spec.geometric ? <select … value={c.edge ?? spec.edges[0]}> : null`
   with options from `edgesFor(c)`. §2.3 catches this exact trap for `compile.ts`
   and for `shapeFor` and the first freeze did not carry it here, so every sketch
   rule would render an empty edge menu with `value={undefined}` — a blank
   control React logs a controlled/uncontrolled warning about, sitting where the
   rule's subject should be. **P12 changes the condition to
   `spec.edges.length > 0`.**
1. **An anchor control**, in the same position, gated on
   `spec.anchors.length > 0` — which is exactly the complement, since exactly one
   of the two lists is non-empty on every kind. A plain `<select>` over
   `ANCHOR_NAMES`, writing `updateConstraint(prev, id, { anchor })`.
2. **An angle-aware `Dimension`**, per §1.3: the component branches on
   `spec.valueType`, and a `bearing` gets an angle field, an angle-aware resolved
   read and an unlink branch that writes `writeAngle` rather than
   `formatLength`.
3. **A third row state**, `redundant`, joining `blamed` and `broken`. It reuses
   the dashed-border vocabulary `broken` already established for "satisfied but
   you should know", because that is exactly what a redundant sketch rule is —
   not an error, and not nothing. `.redundant { border-style: dashed;
   border-color: var(--dc-warn, #d9a441); }` — and note that `--dc-bad` is not
   defined in `index.css` at all, so every use carries its own fallback.
4. **A second conflict headline, with its own state and its own count.** Two
   things here, and both are corrections.

   **It does not go in `conflict`.** `ExplorationState.conflict` means
   *"constraint ids the solver blamed when the document admits no design"*; it
   is set only in the catch branch, alongside `exploration: null`
   (useExploration.ts:149), and `Constraints.tsx` reads it for the
   impossible-document headline at 538, for the red rows at 663/669, and to
   suppress the broken-preferences note at 623. A sketch conflict is neither of
   those things: the document is satisfiable, there are designs on screen, and
   the conflict is **per universe** while `conflict` is per document. Merged in,
   a satisfiable document showing 24 designs would get the impossible-document
   headline, and a rule that conflicts in universe 7 would be reddened while the
   designer looks at universe 1 where it holds perfectly. So P11 adds
   **`sketchConflict: string[]`** and **`sketchPinned: string[]`**, derived from
   the *displayed* universe's `SketchReport` and cleared exactly as `freedom` is,
   and P12 takes them as their own props. `conflict` keeps meaning what it means.

   **The headline is count-driven with a defined zero case**, because the count
   is not always two and is sometimes nought. The shipped string is hardcoded
   `These 2 rules…`; the sketch's is built from `sketchConflict.length`:

   > **These 2 rules cannot both hold in this design. A distance and a bearing
   > between the same two things fix a point exactly, so a second rule about
   > either has nowhere left to move. Turn one off, or drag a member to aim the
   > sketch somewhere else.**

   And when `sketchConflict` is empty but `sketchPinned` is not — which after
   §5.2 is the *common* case, not an edge one, because a conflict made only of
   `held(...)` tags is what a sketch rule aimed at a laid-out or aligned node
   produces:

   > **“Card” and “Badge” are already placed by other rules — an Align, a Gap or
   > a stack decides both of their positions — so this rule has nothing left to
   > move. Turn one of those off, or put this rule on something the layout does
   > not place.**

   A `conflicted` universe with an empty `sketchConflict` **and** an empty
   `sketchPinned` cannot arise (a non-empty conflicting set is what makes the
   status `conflicted`), and if one ever does it is routed to `adrift` rather
   than shown as a conflict with nothing in it under a headline claiming two.

5. **An adrift note**, in the `broken`/`inert` idiom, `data-role="adrift"` —
   never `data-role="unsettled"`, per §5.4:

   > **The sketch did not settle here. The rules do not contradict each other —
   > the solver ran out of steps looking for a placement that satisfies them
   > from where these nodes are now. The design below is the linear solver's,
   > which is exact about everything except these rules. Drag a member to start
   > it somewhere else.**

No relaxations are offered for a sketch conflict: `relax.ts` re-solves under
assumption subsets against a `SolverSession`, and a sketch conflict has no
session to re-solve against. The panel says so rather than showing an empty
`.ways` block.

### 8.2 `Inspector.tsx`

Two additions, both beside the shipped `data-role="inert-rules"` section and in
its idiom:

- **`data-role="sketch-placed"`** — `<h3>Placed by a sketch rule</h3>` and one
  line per owned coordinate, naming the rule. A coordinate the sketch owns is
  disabled in the Position grid: `dimensionPinned` (Inspector.tsx:2333) gains a
  clause reading **`universe.sketch.owned`** — and reads nothing else, per
  §7.4's note on that field. The `Travel` probe is not consulted for these
  coordinates and could not answer about them anyway (§6.2), so there is no
  precedence question to settle: `owned` decides for a sketch coordinate,
  `freedom` decides for a linear one, and the two sets are disjoint by
  construction.
- **`data-role="sketch-seed"`** — the starting point, as two read-only numbers
  and a *Forget* button calling `clearSketchSeed`, shown only when `seedOf`
  returns a point. The sentence beside it: *“Dragged to here. The sketch starts
  looking from this point, which is what picks between placements when the rules
  leave more than one.”*

There is no released-pin row. §5.2 removed the release, so the sentence *“The
layout put this at 240px; the sketch moved it to 251px”* has nothing to report
and would be describing a thing that no longer happens.

### 8.3 `StatusLine.tsx`

**One new pill, and it must not be called freedom.** `data-role="sketch"`, in
the `.tag` style, beside the universe count:

- `settled`
- `2 free` — title: *“Two degrees of freedom left in the sketch: this is one of
  infinitely many placements that satisfy these rules. Whole-sketch, unlike the
  per-coordinate travel beside it.”*
- `adrift`
- `redundant`

**`adrift`, and it is not called `unsettled`** — §5.4 has the argument, and this
is the component it is about: `Studio.tsx:2873` already passes
`varyingCount={unsettled.size}` to this same status line, meaning a different
thing. A row goes into whatever naming table the next merge writes, saying so.

`data-role="freedom"` is the shipped per-node readout and `data-role="travel"`
is the canvas overlay, which had to be renamed after a bare
`querySelector('[data-role=freedom]')` found the wrong one — the tree already
carries that scar and a third claim on the word would reopen it.

The e2e at `studio.spec.ts:132-134` asserts `toContainText(/\d+ universes/)` on
the whole status element and demands zero `[data-role="error"]` children. The
new pill must keep both true.

### 8.4 The canvas

`Annotated` gains one member and `Annotation` becomes a discriminated union.
**The union is required, not a nicety:** every shipped consumer reads
`axis`/`at`/`from`/`to` positionally, so adding optional `cx`/`cy` fields would
leave the line and span readers computing garbage for a ray.

**The two live in two files and two steps, and the first freeze got the
ownership wrong.** `Annotated` is in `scene.ts:3260` and belongs to P1;
`Annotation` is in `annotate.ts:52` and belongs to P8. P1's row cannot say
"`Annotation` becomes the union" without editing a file P8 owns, which is a
direct violation of §9.2's "every row owns whole files". So: **P1 adds `"ray"` to
`Annotated` and nothing more; P8 owns the union.**

P8 also owns `Annotations.tsx`, and that is not scope creep — it is what keeps
`pnpm turbo run typecheck` green. That component reads `note.axis`, `note.at`,
`note.from` and `note.to` with no narrowing (lines ~49-60), so the moment
`Annotation` becomes a union the app is red with *"Property 'axis' does not
exist on type '{ shape: \"ray\"; … }'"*, and it would have stayed red through
five consecutive steps until P14. P8 therefore lands the `shape` switch **and**
the ray's one `<line>`, and P14 is left with the seed drag alone.

```ts
export type Annotated = "none" | "edges" | "between" | "mirror" | "ray";

export type Annotation =
	| { shape: "line"; constraint: string; kind: ConstraintKind;
	    axis: "x" | "y"; at: number; from: number; to: number; label?: string }
	| { shape: "span"; constraint: string; kind: ConstraintKind;
	    axis: "x" | "y"; at: number; from: number; to: number; label?: string }
	/**
	 * Two points and the hairline between them — the one shape the three sketch
	 * kinds need and the reason none of them is a circle. `distance` and
	 * `bearing` draw between their two anchors; `collinear` draws from the first
	 * anchor to the last, so the line it asserts is the line it shows.
	 */
	| { shape: "ray"; constraint: string; kind: ConstraintKind;
	    a: Point; b: Point; label?: string };
```

**`annotate()` needs an early edgeless path, not a branch inside the existing
one.** The first freeze said the ray branch is reached before the axis test,
which is true and beside the point: there are *two* guards, and the fatal one is
first.

```ts
const edge = c.edge ?? spec.edges[0];
if (!edge) continue;                    // annotate.ts:234-235
const axis = EDGES[edge].axis;
if (axis !== "x" && axis !== "y") continue;
```

A sketch kind has `spec.edges === []`, so `edge` is `undefined` and the rule is
dropped at line 235 — before the axis test, before `datumFrame`, before
`marksFor`. Implemented as described, the overlay would be a silent no-op that
typechecks and tests green if the test only asserts the union's shape.

So the loop splits at the top:

```ts
if (spec.anchors.length > 0) {
	// No edge, no axis, no datum: a ray is between two *points*, and
	// `refusedAnchor` already guarantees that no member of a sketch rule that
	// reached an answer set is a datum, a copy or a turned box. So the world
	// frames are the whole input.
	const frames = c.nodes
		.map((id) => placed.get(id)?.world)
		.filter((f): f is Frame => f !== undefined);
	if (frames.length < spec.minNodes) continue;
	out.push(...raysFor(c, frames, scene.unit ?? DEFAULT_UNIT));
	continue;
}
```

with

```ts
function raysFor(c: Constraint, frames: readonly Frame[], unit: Unit): Annotation[];
```

beside `marksFor` and not inside it: `marksFor` takes `edge` and `axis` as
required arguments and resolves datums through `datumFrame(id, edge, lines())`,
none of which a ray has or needs. `raysFor` reads the anchor off
`ANCHORS[c.anchor ?? "center"]`, takes the anchor point of each frame, and emits
one `{ shape: "ray" }` — first to second for `distance` and `bearing`, first to
last for `collinear`, so the line it asserts is the line it shows.

`Annotations.tsx` gains a `switch (note.shape)` around what it already does and
one `<line>` case with `vector-effect: non-scaling-stroke`, in the existing
1px-origin-anchor SVG, and draws nothing new otherwise. Both are P8's.

`Editor.tsx` gains the seed drag of §4.4 and nothing else — the branch is *this
node's id is a key of `universe.sketch.owned` and this axis is in its list*,
which is the field §7.4 makes the single source for that question. Resize
handles are untouched, because the sketch layer never owns a size.

Constraint overlays are drawn only on the editable copy, never on the read-only
multiverse artboards. That stays true: a sketch ray is a note in the margin, and
the multiverse grid already shows fifteen artboards.

---

## 9. Ownership

### 9.1 The claims, against both frozen plans

**Two documents govern here, not one.** `merged-plan.md` §3.3 lists `explore.ts`
and `annotate.ts` among the files nobody may touch. But
`docs/framer-parity-plan.md` is **also frozen**, postdates it (`c668a31`), says
of itself *"this document outranks all four source specs"*, and independently
states in §1.1: *"`why.ts`, `relax.ts`, `derived.ts`, `explore.ts`,
`annotate.ts`, `freedom.ts`, `machinecheck.ts` and `units.ts` are claimed by
nobody and must stay that way."* Its five steps have all landed — `b855ca1`,
`202077a`, `7d21f19`, `e472780`, `8d5a508`. A legitimacy argument aimed only at
the older document addresses none of the governing text, so the claim is made
against both.

**The argument, and it is the same argument twice.** Both lists are *scoped to
their own steps*: `merged-plan.md`'s to M0–M24 (the third axis and the Rive
ladder), `framer-parity-plan.md`'s to its five (paint, fonts, easing, triggers,
prototyping). Every one of those steps has landed. This track shares no step and
no symbol with any of them: it adds `sk*` predicates nobody else names, a
`Universe.sketch` field nobody else reads, and a `"ray"` annotation shape nobody
else draws. The prohibition exists so that two *concurrent* tracks do not both
edit a module that eleven checks depend on; it is not a permanent freeze on two
files, and reading it as one would mean no geometry feature could ever be added
to this tool again.

`freedom.ts` is on that newer list too, and this document does not touch it —
§6.2 refuses to feed `dof` into it and §6.2's probe filter is placed in
`useExploration.ts` precisely so that it stays untouched. That is consistency
with the claim rather than an exception to it.

The claim is made explicitly rather than quietly, and it is narrow:

- **`explore.ts`** — P5 adds the sketch pass to `interpret`, adds
  `Universe.sketch`, threads an optional `SketchPass` into `Explorer`'s
  constructor and through `interpret`'s three call sites, and corrects the stale
  grounding table in the header comment. It touches nothing else in the file.
  There is no way to run a second solver over an answer set without editing the
  one module that owns the session and the universes; the alternative is a
  second explorer, which is the parallel model this whole document refuses.
- **`annotate.ts`** — P8 adds the `Annotation` union and the `"ray"` branch. The
  file's own header names itself as the intended extension point for a new mark.

`why.ts`, `relax.ts` and `freedom.ts` remain untouched and untouchable. Eleven
checks depend on the first two, this track adds a twelfth, and a step that finds
itself editing any of the three has stopped building a constraint. §7.1's
decision to keep `interpret` synchronous exists so that the `relax.ts` boundary
is never approached, and §6.2's decision to filter at the hook exists so that the
`freedom.ts` boundary is never approached.

### 9.2 The table

Every row owns whole files. A step that needs a symbol another step owns writes
against the signature in this document and does not go and add it. **Every step
leaves `pnpm turbo run typecheck` green over all eight packages and leaves the
test files named in its row passing.**

| # | step | owns | after |
| --- | --- | --- | --- |
| **P0** | **The package and the gate.** `@clingo-design/planegcs`: `types/planegcs.d.mts`, `openSketcher`, `SketchOptions`/`SketchRequest`/`SketchRule`/`SketchOutcome`, the canonical-order builder, the status gate of §6.1, the pinned write-back of §3.2, the single solve of §5.1, `NOTICE`. **CSS pixels in and out — this package knows nothing of EMU.** Plus the determinism gate of §4.5, asserted over solved coordinates: if it fails, stop and report | `packages/planegcs/**` (new), `packages/app/package.json`, `pnpm-lock.yaml` | — |
| **P1** | **The document types.** `Anchor`, `ANCHORS`, `ANCHOR_NAMES`; `ConstraintSpec.engine` and `.anchors`, with `engine: "linear", anchors: []` on all nine shipped entries; the three new `CONSTRAINT_KINDS` entries of §1.3; `Constraint.anchor?`; `SceneNode.sketchSeed?: string`; `angleValue(mdeg: number): Value` beside `dimension`; `Annotated` gains `"ray"` — **and nothing about `Annotation`, which is P8's** | `packages/design-core/src/scene.ts`, `packages/design-core/package.json` (the `@clingo-design/planegcs` dependency) | P0 |
| **P2** | **The sketch readings.** All of `sketch.ts`: `SketchFacts`, `readSketchFacts`, `sketchRequest`, `sketchSolved`, `sketchOwned`, `refusedAnchor`, `anchorPoint`, `seedOf`, `spellSeed` — including §3.0's world chain via `placedNodes`, §3.1's EMU boundary, and the `crossesViewport` warning. Plus the §3.2 EMU round-trip property test, which lives here because design-core owns `cssPxFromEmu`/`emuFromCssPx` and `ASP_EMU_CEILING`. Verifies and asserts — without editing — that `spatial.ts`'s `inertMembers` returns `[]` for an edgeless kind (**and therefore that `refusedAnchor` must carry the turn refusal itself**) and that `machines.ts`'s two `spec.geometric` filters are correct unchanged | `packages/design-core/src/sketch.ts`, `sketch.test.ts` (both new) | P1 |
| **P3** | **The program.** The narrowed `GEOMETRIC_KINDS`; `SKETCH_KINDS` unconditional beside it per §2.2; `sknode/1` facts; `SKETCH_CONSTRAINT_RULES` verbatim from §2.4 including the `#show`/`#project` tail of §2.5, gated on `sketched`; the `c_anchor/2` emission branch of §2.3; the `% Sketch rules.` CONTRACT block and its fourteen-name drift guard. **Plus one correction in the same commit:** the CONTRACT's stale z-edge sentence (§2.6) | `packages/design-core/src/compile.ts`, `sketchprogram.test.ts` (new) | P2 |
| **P4** | **The model override.** `readModel(atoms, override?)` per §7.4, merged per key into `boxOf`'s and `spatialOfTerm`'s reading. Nothing else; `readSketchFacts` is P2's | `packages/design-core/src/model.ts`, `model.test.ts` | P3 |
| **P5** | **The seam.** `SketchPass`; `Explorer` takes an optional one and threads it through `interpret`'s three call sites (450-458, 957, 1330) **synchronously**; the per-key merge of §7.4; `Universe.sketch`/`SketchReport`. Asserts the §3.2 consequence directly. **Plus one correction in the same commit:** `explore.ts`'s stale grounding table — *the numbers only, in the comment block at lines 19–102* (§5.5) | `packages/design-core/src/explore.ts`, `sketchsolve.test.ts` (new) | P4 |
| **P6** | **The edits.** `setSketchSeed`, `clearSketchSeed` (over P2's `spellSeed`); `shapeFor`'s table branch of §2.3 and its `valueType` branch of §1.3; `retargetConstraint` carrying `anchor` across a kind change; `currentValue`'s sketch branch — a `distance` seeds from the measured separation and a `bearing` from the measured direction, written with `angleValue`, so a new rule starts out already true | `packages/design-core/src/edits.ts`, `edits.test.ts` | P5 |
| **P7** | **The reader.** `isConstraint` tolerating `anchor` and validating it against `ANCHORS` when present; `pruneNodes` carrying `sketchSeed` and dropping one `seedOf` refuses to absence | `packages/design-core/src/project.ts`, `project.test.ts` | P6 |
| **P8** | **The overlay, end to end.** `Annotation` as the discriminated union of §8.4; `annotate()`'s edgeless path and `raysFor`; every existing reader switched on `shape` — **including `Annotations.tsx`'s, which is why that file is in this row and not in P14's: without it the app is red for five steps** | `packages/design-core/src/annotate.ts`, `annotate.test.ts`, `packages/app/src/design/Annotations.tsx`, `Annotations.module.css` | P7 |
| **P9** | **The barrel.** Re-exports P2's, P4's and P5's new surface, and the types P0 declares. Beware: `export *` puts every symbol in the app's namespace | `packages/design-core/src/index.ts` | P8 |
| **P10** | **The app-side sketcher.** The `?url` wasm import, `vite.config.ts`'s `optimizeDeps` entry, `openSketcher` awaited at startup beside the clingo `Session`, and the `SketchPass` closure handed to the `Explorer`. **No protocol op, no worker hop** — §7.1 | `packages/app/src/sketch/**` (new), `packages/app/vite.config.ts` | P9 |
| **P11** | **The hook.** `ExplorationState` gains `sketch`, `redundant`, `adrift`, `sketchConflict` and `sketchPinned`, all cleared on every exploration for the reason `freedom` is; and the probe filter of §6.2, which subtracts `SketchReport.owned` from the record handed to `explorer.probe`. **`conflict` is not touched** | `packages/app/src/design/useExploration.ts` | P10 |
| **P12** | **The rules panel.** Item 0's edge-control gate, the anchor control, the angle-aware `Dimension`, the `redundant` row, the three sentences of §8.1, the suppressed relaxation block | `packages/app/src/design/Constraints.tsx`, `Constraints.module.css` | P11 |
| **P13** | **The inspector and the status line.** §8.2 and §8.3, plus the wiring in the shell. Also fixes the stray five-tab indent at `Studio.tsx:2798` while the file is open | `packages/app/src/design/Inspector.tsx`, `StatusLine.tsx`, `Studio.tsx` | P12 |
| **P14** | **The seed drag.** §4.4's branch on `universe.sketch.owned`, and nothing else | `packages/app/src/design/Editor.tsx`, `Editor.module.css` | P13 |

**Two dependencies that cross package boundaries, made explicit so no step
discovers them.** P2's `sketch.ts` imports `SketchRequest`, `SketchRule` and
`SketchOutcome` from `@clingo-design/planegcs`, which P0 declares — hence the
`packages/design-core/package.json` entry in P1's row, the one manifest the first
freeze left unowned. And the round-trip property test moved from P0 to P2 for the
same reason it has to: `cssPxFromEmu`, `emuFromCssPx` and `ASP_EMU_CEILING` live
in design-core, so testing them from `packages/planegcs` would have forced
`planegcs → design-core` while P2 forces `design-core → planegcs` — a cycle in
the turbo graph. `packages/planegcs` stays unit-free: CSS pixels in, CSS pixels
out.

**Files nobody owns and nobody may touch:** `units.ts`, `why.ts`, `relax.ts`,
`stuck.ts`, `freedom.ts`, `directSolver.ts`, `solver.ts`, `reconcile.ts`,
`tree.ts`, `components.ts`, `derived.ts`, `paint.ts`, `export.ts` and every
`export-*` package, `packages/canvas/**`, `packages/canvas-core/**`,
`packages/canvas-3d/**`, `packages/vfs/**`, `packages/clingo-wasm/**`,
`LayerList.tsx`, `Artboard.tsx`.

`solver.ts` is in that list on purpose, and §7.1 is where it does real work.
`SolveOutcome` is answer-set shaped and has no place for a starting point, a dof
or a numeric status, and widening it would make one interface answer two
questions. It is also why the sketch pass cannot live in the worker: the worker
would need the scene, and the scene reaches it only through `SolveRequest`. The
sketcher is a separate, synchronous, 0.53 ms interface that lives in its own
package and runs on the main thread.

`Artboard.tsx` stays on the untouchable list and needs no edit, because §7.4's
`readModel` override is what puts the sketch into `universe.model` — the thing
that component already draws.

`spatialprogram.goldens.json` is owned by nobody. P3 may not update it, and P4
and P5 may not either. If a golden moves, that step **stops and reports**,
because a moved digest means either a deliberate answer change nobody asked for
or a leak. The fixture hashes *answers* — `nodes`, `frames`, `rendered` per
universe, checked — not program text, so §2.2's three unconditional `skind/1`
facts cannot legitimately move one: they derive nothing, are not shown, and are
not in a choice rule. Note separately that `spatialprogram.test.ts` asserts on
the literal *text* of the generated program (that `gedge(front,z,pos) :-
spatial.` is present and `gaxis(z).` is absent), so a new rule block can break it
without changing any answer — P3 runs it and, if it breaks, reports rather than
edits.

---

## 10. Review checklist

1. Does `GEOMETRIC_KINDS` still emit exactly `gkind(align). gkind(gap).
   gkind(equalSize). gkind(symmetric). gkind(pin).` and nothing else? A sketch
   kind in that list mints `lv`/`lsz` for its members and puts them in the
   shared `&minimize` — two solvers, one rectangle, silently.
2. Does a document with no sketch rule compile to a program with no `sk` atom in
   it, and does its exploration run zero PlaneGCS solves?
3. Is `apply_solution()` reachable from any path where the status is `Failed` or
   `SuccessfulSolutionInvalid`? It must not be, and the gate must be in
   `packages/planegcs` rather than in a caller.
4. Does an empty conflicting set ever produce a blamed rule, a learned nogood,
   or a re-solve? §5.4. Any of the three is the failure this document exists to
   prevent.
5. **Is there any path on which a coordinate in `skheld/2` comes out of the pass
   different from the one that went in?** There must not be — not by release
   (§5.2 removed the loop), not by residual (§3.2 restores the pushed value),
   not by an unfiltered merge (§7.4 merges per key). A `held` coordinate that
   moved is a hard linear rule broken with a green row beside it.
6. Does dragging a sketch-owned node write `sketchSeed` rather than `frame`, and
   does it coalesce into one undo entry?
7. Does any solve write to the document? It must not — check `headsOf` before
   and after an exploration on a document with a sketch rule.
8. Are there two numbers called "degrees of freedom" in the status bar? §6.2.
   And is the word `unsettled` used anywhere in this track's code? It must not
   be — §5.4.
9. Does `emuFromCssPx(cssPxFromEmu(e)) === e` at `e = ±ASP_EMU_CEILING`,
   `e = ±1`, and `e = ±9525`?
10. Did `why.ts`, `relax.ts` or `freedom.ts` change? Twelve checks now depend on
    the first two, and §6.2 depends on the third.
11. **Do the editable canvas and the multiverse grid draw the same design?**
    Open a document with a `distance` rule and compare `universe.solved`'s
    placement with `universe.model`'s for the same universe. They must agree, and
    they only do because of §7.4's `readModel` override.
12. **Does a sketch rule ever silently override a layout?** Put a `distance` on a
    child of a stack. It must come back conflicted, naming the stack's pin — not
    settled with the child moved out of its slot.
13. Is a stub reported as a stub? A `Sketcher` that typechecks and returns
    `adrift` for everything is scaffolding; an anchor `<select>` that renders
    and writes nothing is scaffolding; calling either finished is the worst
    outcome available to this plan.

---

## 11. The no-regression promise

Asserted by P3, P4 and P5 together, over every shipped template:

1. **Same program, byte for byte, but for three lines** — and the three are
   named exactly, because the first freeze's version of this promise matched
   neither reading of where `SKETCH_KINDS` goes and would have let P3 write a
   test against a guess:

   ```prolog
   skind(distance).
   skind(bearing).
   skind(collinear).
   ```

   in the `geometry rules` section, immediately after `GEOMETRIC_KINDS`, per
   §2.2. Nothing else changes: `SKETCH_CONSTRAINT_RULES`, its `#defined` lines,
   its `#show`s and its two `#project`s are gated on `sketched`, and no shipped
   template holds a sketch rule.
2. **Same universe count, same `readModel`, same `exportUniverse(...).text`** —
   i.e. `spatialprogram.goldens.json` is untouched. `readModel` gains an optional
   parameter in P4 and every existing caller passes nothing, so the goldens are
   checked against the no-argument call exactly as they are today.
3. **Zero PlaneGCS solves.** `sketchRequest` returns `undefined` for every one of
   them, and the wasm module is never even instantiated.
4. **The atoms of every template's answer sets contain no `skon(`, `skcon(`,
   `skmember(`, `skanchor(`, `sksolved(`, `skheld(`, `sk_length(` or
   `sk_angle(`.**

And one promise the goldens themselves do not make, recorded here so nobody
believes otherwise: `spatialprogram.goldens.json` contains **no** `html` or
`svg` digest, despite eight paragraphs of its own doc-comment arguing about
them and despite `merged-plan.md` §M0 requiring `exportUniverse(...).text` to be
byte-equal. `grep -c html` on that fixture is 0. The export half of the
no-regression promise is asserted by P5's own test in this track, not by that
file.

---

## 12. AMENDED — the review, and what was refused

Two adversarial reviews raised thirty-one objections against the first freeze.
Twenty-eight were accepted and the sections they hit were rewritten in place;
the rewrites are marked where they are large (§5.2, §9.1) and are simply the
text everywhere else. **The remaining three are answered here rather than
dropped**, because two reviewers proposed *opposite* fixes for the same defect
and a frozen document has to say which one it took and why the other was
refused.

### 12.1 Where the sketch runs: refused the worker, took the main thread

Both reviews found the same contradiction — §7.1 declares `Sketcher.solve`
synchronous while P10 puts it behind the `postMessage` solver worker — and they
proposed opposite repairs. One asked for the pass to move **into the worker**,
so the solve response carries `{ atoms, sketch }` and `interpret` stays
synchronous over plain data. The other asked for the sketcher to stay on the
**main thread**, so `openSketcher` is async, `solve` is sync, and `interpret`
gains a threaded parameter.

**The worker version is refused, and the reason is a file this document may not
touch.** The pass needs the scene: the seeds of §4 live on `SceneNode`, and the
world chain of §3.0 is walked over `scene.nodes`. The worker has neither, and
the only way to give it either is to widen `SolveRequest` — which is in
`solver.ts`, on §9.2's untouchable list, put there because *"`SolveOutcome` is
answer-set shaped and widening it would make one interface answer two
questions"*. A `SolveRequest` that carries a scene so that a second solver can
ride along is that sentence coming true. The reviewer who preferred the worker
was reasoning about latency; §5.3's measurement (≤ 26 ms on the worst template,
once per exploration, against 3163 ms) is what makes that concern affordable to
decline.

§7.1 now says main thread, synchronous, no protocol op, and P10's row says the
same. Nothing in the track is async that was not async before.

### 12.2 The released-pin loop: refused the tie-break, removed the loop

One review asked for the loop to release **one pin per round in canonical
order**, so that `MAX_RELEASE = 3` bounds released coordinates at three rather
than at everything. That is a real improvement on the loop as written — releasing
the whole `releasable` set frees a two-node system entirely on round one — and it
is refused anyway, because the other review showed that **no** number of released
pins is sound: a `held` coordinate can be fixed by a hard `&sum` equality, and
releasing it breaks an `align` that the panel still shows green. A tie-break on
an unsound operation is a tie-break on an unsound operation.

The loop is gone (§5.2). With it go the questions of termination, of the stale
post-loop conflict, and of `MAX_RELEASE` meaning anything — one solve has no
rounds. What survives from that review is its second finding, which was
independent of the loop and is now the common case rather than an edge one: a
conflicting set can contain no rule at all, so `Blamed` carries `rules` **and**
`pins`, the panel has a sentence for each, and §8.1's headline is count-driven
with a defined zero case.

### 12.3 Sketch-only nodes in `Universe.solved`: refused the exclusion

One review offered two ways to stop `probeFreedom` firing four UNSAT solves at a
node the sketch placed: keep such nodes **out of `Universe.solved`** and carry
them in `SketchReport.owned` alone, or **filter the ids** before probing.

Keeping them out is refused. `Universe.solved` is what `Editor.tsx` draws,
`placedNodes` walks and `annotate` measures against; a node whose position is
absent from it is a node the canvas draws at its stored frame — which is to say,
the feature does not work. The record is the picture, and a picture with a hole
in it to protect an unrelated probe is the wrong trade.

So the filter, and it is placed where it costs nothing: `useExploration.ts`
subtracts `SketchReport.owned` from the record it hands `explorer.probe` (§6.2).
`freedom.ts` is untouched, which is what §9.1 promised both frozen plans, and
the probe is asked only about coordinates clingo actually decided.

---

## 13. AMENDED after implementation — two things this document got wrong

Both were found by driving the shipped feature rather than by reading it, and
both are corrections to §§2–7 above. **Where §13 contradicts an earlier section,
§13 wins.**

### 13.1 The turn refusal is per *anchor*, not per node (§2.4, §7.3)

§2.4 writes:

```
skoffcentre(N) :- grotated(N), skcon(C), c_node(C,N), c_anchor(C,A), A != center.
sknopoint(N) :- skoffcentre(N).
```

`C` is existentially quantified, so **one** rule about a turned box's corner
withholds that box's point from **every** sketch rule naming it. The rules it
takes down with it are the ones about the *centre* — precisely the ones a turn
leaves exactly true, since a rotation about the centre moves no linear quantity,
which is the decision the whole rotation feature rests on. They went unstated,
the panel showed them green, and §7.3's refusal sentence told the centre rule it
was fine: *"Its centre is still exactly where it says, so a rule about the centre
holds."* It did not hold. That sentence was the only place the behaviour was
described, and it described the opposite of it.

The refusal exists because `anchorPoint` reads the **unrotated** frame, so the
corner it computes is not on the box. That is a fact about one anchor of one box
and nothing wider, so:

```
skoffcentre(N,A) :- grotated(N), skcon(C), c_node(C,N), skanchor(C,A), A != center.
skpoint(N,A) :- skcon(C), c_node(C,N), skanchor(C,A), sknode(N),
                not sknopoint(N), not skoffcentre(N,A).
sksolved(N) :- skpoint(N,_).
```

`sksolved/1` moves onto `skpoint/2` so that a turned box named *only* about its
corners is not solved at all, rather than arriving as a free point with nothing
said about it and one more degree of freedom in the status pill than the document
has. Still switch-blind — `skcon/1`, not `skon/1` — so §2.4's promise that which
unknowns exist does not depend on which rules are assumed is untouched.

**`skpoint/2` becomes the eighth `#show`.** §2.5 lists seven, and TypeScript
inferred point existence from `sksolved/1`; that inference is exactly what
per-anchor refusal breaks, because a node can now be solved and still have no
corner. `sketchRequest` filters each rule's members on `facts.points` rather than
on `facts.solved` alone. Re-deriving it in TypeScript is refused for the reason
`SketchReport.owned` gives: a second answer computed here would differ the first
time a member was turned, and differ silently.

§7.3's sentence now says what happens — *"a rule about the centre still holds.
Use the centre here"* — and it is true.

### 13.2 `SketchOutcome` needs a fourth member: `unavailable` (§6.1, §7.1)

§7.1 puts a synchronous façade in front of an asynchronous module, and §6.1
gives the façade three statuses to answer with. It picked `adrift` for the window
before the wasm lands. That is a false statement with a useless remedy attached:
`adrift` means *the solver looked from where these nodes are and ran out of
steps*, and both the status line and the Rules panel answer it by inviting the
designer to drag a member and start it somewhere else. No aim fixes a module that
has not arrived.

It is not only the cold-start window. `warm()` was `opening ??= openSketcher(…)`,
and a **rejected** promise is something that expression caches: one refused fetch
— a flaky connection, a service worker mid-update, an asset that 404s — and every
later solve joined the same dead promise, so the studio said *"the solver ran out
of steps"* about every sketch rule for the life of the tab. `warm()` now clears
the slot on rejection, which makes it the retry its own comment always claimed to
be, and the next solve tries again.

So `{ status: "unavailable" }` on `SketchOutcome`, `"unavailable"` on
`SketchReport.status`, `noSolver` beside `adrift` on `ExplorationState`, and a
sentence in each of the two surfaces that says the true thing: the rules have not
run, nothing is wrong with them, and nothing the designer changes will help.
`openSketcher` itself never returns it — a module that fails to instantiate
rejects — but `Sketcher` is an interface and the app is a legitimate implementer
of it.
