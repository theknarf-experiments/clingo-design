# The merged plan: three dimensions and the Rive ladder, as one order of work

**Status: frozen. This document outranks both source specs.**

Two architecture documents were written in parallel by agents who could not talk
to each other:

- `docs/three-d-spec.md` — track A, twelve steps, a mesh is an ordinary node.
- `docs/rive-ladder-spec.md` — track B, fifteen steps, inputs through timelines.

Both extend `docs/state-machines-spec.md`, which shipped in `35e8d94` and
`05119e6` and is still the law where nothing below contradicts it. Neither track
wrote a line of implementation code; both are specs, and the tree at the moment
of writing is clean — `pnpm turbo run typecheck` 8/8, design-core 1004/1004, app
38/38, verified before and after this document was written, which touched only
`docs/`.

Between them the two tracks claim **nine of the same files** and would have
edited seven of them simultaneously. This document is the single plan everything
downstream codes against: which step owns which file, what each contested name
is finally called, and — the part that matters most — the four places where one
track's change silently breaks the other's and nobody would have found out until
the solver came back with no answer at all.

Where a paragraph here contradicts either source spec, **this one wins**, and
the source spec has been amended in place to point here. Where an implementation
step finds *this* document wrong, it implements the nearest correct thing and
says so loudly in its return value.

---

## 0. What this merge actually found

Four things, and only the first was anticipated by either spec.

1. **The third axis silently widens the state-copy defaults.** Anticipated by
   the brief, confirmed in the code, and it needs a guard. §4.
2. **The third axis makes the linear objective unbounded.** *Not* anticipated by
   anyone, and it is the serious one: in a document that has a viewport anywhere,
   a node named in a geometric constraint *outside* every viewport gains a `z`
   unknown with nothing pulling on it, and an unbounded `&minimize` is not a
   wrong picture — it is no answer at all. The code says so itself, in the
   comment above `gsolved/1`, about exactly this hazard for datums. §5.
3. **A rule between a 2D node and a 3D one is currently a rule that quietly
   means nothing**, in both directions, and neither spec noticed. §6.2.
4. **A state's frame delta does not branch the multiverse today** — a shipped
   latent gap, not something either track introduced, but both tracks widen the
   mechanism that has it. §8.

Everything else was bookkeeping, and the bookkeeping is in §§1–3.

---

## 1. Collisions

### 1.1 Files both tracks claim

Nine core files and two panels. Every one of these would have been edited by two
agents in one working tree.

| file | track A step | track B step | resolved |
| --- | --- | --- | --- |
| `values.ts` (+ test) | 1 | L1 | **M1**, both halves |
| `scene.ts` | 2 | L2 | **M3**, both halves |
| `index.ts` | 3 | L3 | **M6**, alone |
| `compile.ts` (+ tests) | 4 | L4 | **M7 then M8**, in that order — §3 |
| `model.ts` (+ test) | 5 | L5 | **M9**, both halves |
| `project.ts` (+ test) | 6 | L6 | **M10**, both halves |
| `edits.ts` (+ test) | 7 | L7 | **M11**, both halves |
| `export.ts` (+ test) | 8 | L8 | **M12**, both halves |
| `machines.ts` | *(needs `stateTurnVar`)* | L3 | **M5**, which adds track A's symbols too |
| `Artboard.tsx` | 11 | L15 | **M18**, both halves |
| `Constraints.tsx` | 12 | L15 | **M19**, both halves |

`Inspector.tsx` is **not** contested: track A step 12 owns it and track B never
names it. `Studio.tsx` is not contested either — track B's L14 owns it and track
A lists it as untouchable. Both source specs' §0 summaries overstate the overlap
on those two; the amendments correct them.

Track A also claims `tree.ts` and `Editor.tsx`, which the state-machine spec
listed as untouchable. That was a deliberate, declared departure in track A §13
and it stands: no machine step needs either.

### 1.2 Names claimed twice, or already taken

Every predicate below was grepped against the **real generated program** for all
thirteen templates (`compile(t.create()).program`, thirteen files, 13,684 lines).
The method matters: this codebase's comments are prose, so a bare word like
`turn` or `many` appears dozens of times in English and never as a term. The
grep that counts is the one with the parenthesis.

**Already taken, and correctly extended rather than collided with:**

- `gnoedge/2` — exists (`compile.ts:1296`, the span-edge-on-a-column-line
  refusal). Track A extends it with two more rules. Correct: that *is* the
  precedent, and it is the same silence for the same reason.

**Free, but un-greppable, and therefore renamed:**

- `many/2` (track B §3.3) → **`manyfrom/2`**. The word "many" appears 26 times in
  the generated program's own comments. A predicate whose name is a common
  English word in a file people read by grep is a predicate nobody can find, and
  this repository has a commit whose whole subject is that failure mode. Two
  reference sites, both inside the new rules.

**Free and kept, with the near-miss recorded so nobody re-merges them:**

- `turn/3` and `turned/2` (track A). The words appear 15 and 13 times in prose;
  `turn(` and `turned(` appear zero times. Kept.
- `Layer` (shipped, `export.ts` — a whole universe under a media query),
  `StateLayer` (shipped, `export.ts` — one state's selector) and `MachineLayer`
  (track B — a machine's layer) are three different things with three names, and
  the `LayerStrip` / `LayerList` split track B §10.3 argues for holds.

**Claimed twice by the two tracks, resolved in §2:** `Solid`, `ModelNode.solid`,
`Dimension` in `Track.dim`, "the fifth literal bridge", "the fifth quantity".

**Verified free** (zero occurrences as a term in any template's program): all 47
of track A's new predicates and all 89 of track B's, individually.

---

## 2. The resolved naming table

| what | claimed as | by | **resolved** | why |
| --- | --- | --- | --- | --- |
| the numeric `{z, depth}` pair in `geometry.ts` | `Solid` | A §2.2 | **`SpatialFrame`** | `PropName "solid"`, `ValueType "solid"` and the whole of `solid.ts` mean *which primitive a mesh is*. One word for two ideas inside one package is the thing this codebase's comments exist to prevent, and the collision is worst exactly where it hurts: `ModelNode.solid?: Solid` would have read as "which primitive" and meant "z and depth" |
| `ModelNode` / `ModelState` third-axis field | `.solid` | A §7.4 | **`.spatial`** | it is the answer-set twin of `SceneNode.spatial`, exactly as `ModelNode.frame` is the twin of `SceneNode.frame`. The parallel was already there and the name was fighting it |
| `spatialOf`, `withSpatial`, `makeSpatial` return/patch type | `Solid` | A §2.2 | **`SpatialFrame`** | follows the above |
| `Box` (six numbers) | `Box` | A | **kept** | `Frame` + `SpatialFrame`, and nothing else is called `Box` |
| an Any-edge source | `many/2` | B §3.3 | **`manyfrom/2`** | §1.2 |
| a track's geometry axis | `Track.dim?: Dimension` | B §5.2 | **`Track.dim?: Axis3`**, and `Track.turn?: Turn` added | otherwise a *state* can move a mesh in z and a *timeline* cannot, which is an arbitrary line through one feature. §6.5 |
| a state's frame delta | `Partial<Record<Axis3, Value>>` | A §12.2 | **kept** — and `StatePart.turn` with it | track A already widened it; track B's `StatePart` edits must be written against the widened type |
| `millis/2`'s successor | "the **fifth** literal bridge" | both | **`permille/2` is the fifth, `mdeg/2` is the sixth** | `numeral`, `tally`, `word`, `millis` are four. Both tracks wrote "fifth" for their own. Landing order decides, and §3 puts `mdeg` after `permille` in prose only — they are independent in code |
| `permilleOf` | "the fifth quantity" | B §12 | **not a quantity at all** — the second *reader* for the shipped `ratio` quantity | `Quantity` gains exactly one member in this merge, `angle`, from track A. `permilleOf` is to `numeralOf` what `emuOf` is to a float: the integer boundary reader for a quantity that already exists. Track B's own §1.3 says this correctly; only its ownership table said "fifth quantity" |
| `Quantity` | `"angle"` (A), nothing (B) | A §1.4 | **five: `length`, `ratio`, `count`, `time`, `angle`** | |
| `ValueType` additions | `angle`, `solid`, `lamp` (A); none (B) | A §1.4 | **kept, all three** | |
| `MotionProp` order | `duration, delay, stagger` + `exit` (B) | B §2.3 | **`duration, delay, stagger, exit`** | appended, so `MOTION_PROP_NAMES`'s order is stable and `Transitions.tsx`'s fourth row is last |
| a machine state's rotation variable | `srval(I,S,N,R)` / `stateTurnVar` | A §12.3 | **kept, and it lives in `machines.ts` (M5), not in track A's files** | track A's own ownership table says `machines.ts` is track B's. M5 adds it |
| the component-level rotation base | `mbase_turn/4`, in `MACHINE_RULES` | A §12.3 | **`tbase/4`, in `COMPONENT_RULES`** | §6.3 — a rotated mesh inside a definition must turn whether or not the definition has a machine |
| the layer-writer pair for rotation | *(absent)* | — | **`mlrshadow/4`, `mrwriter/4`** | §6.4 |
| `#project t_value/3` | A §3.6 | A | **kept**, and joined by `#project sf_value/5`, `#project sr_value/5`, `#project kf_value/5` | §8 |

Everything not in this table keeps the name its source spec gave it.

---

## 3. Ordering, and the file-ownership table

### 3.1 The one ordering that is not negotiable

**Track A's compile step lands before track B's.**

Track A widens the *vocabulary tables* every machine rule quantifies over —
`gaxis/1`, `gspan/1`, `EDGES` — and narrows two scene defaults to compensate.
Track B's rules are written by iterating those same tables. If track B lands
first, track A has to go back and re-guard seven rules it did not write, in a
file it is sharing, against tests it did not write. Landing A first means B is
written once, against the final vocabulary, and B's own no-regression proof
(its L4 test 3, sorted-set equality of ten predicates against the shipped
program) is run against a program that is already three-dimensional.

The same logic gives the order inside every other shared file: **A's half, then
B's half**, in one step where the file is small enough and in two sequenced steps
where it is not. Only `compile.ts` is split into two steps; everywhere else one
agent writes both halves, because two halves of one file are cheaper to write
than to merge.

### 3.2 Everything before everything else

**M0 must run on the tree as it stands, before M1 exists.** It captures the
goldens the whole no-regression promise is asserted against, and a golden
captured after the first line lands is not a golden.

### 3.3 The table

Every row owns whole files. A step that needs a symbol another step owns writes
against the signature in this document and does not go and add it.

| # | step | owns | after |
| --- | --- | --- | --- |
| **M0** | **The goldens.** For every template: universe count, `readModel` deep-equal, `exportUniverse(...).text` byte-equal, captured as fixtures. Plus the atom-absence scan (no `gedge(front`, `gaxis(z`, `frame(_,z,`, `turn(`, `spatial`, `s3(`, `minput(`, `mcond(`, `mlayer(`, `kfr(`, `mtimeline(`) | `packages/design-core/src/flat.test.ts` (new), `packages/design-core/src/__goldens/**` (new) | — |
| **M1** | **The quantity readers, both.** A's `angle` quantity, `VALUE_TYPES.angle/solid/lamp`, `mdegOf`, `nearestMdeg`, `writeAngle`, `MAX_MDEG`, `isAngleType`, `rotateVar`, `parseVariable`'s `rval` case. B's `permilleOf`, `nearestPermille`, `writePermille`, `MAX_PERMILLE`, `isRatioType`, and the `kat`/`kval`/`tlen` key builders | `packages/design-core/src/values.ts`, `values.test.ts` | M0 |
| **M2** | **The two geometry types.** `SpatialFrame`, `Box` — types only, nothing in that file computes in three dimensions | `packages/design-core/src/geometry.ts` | M1 |
| **M3** | **The document types, both.** A: six kinds, `KindSpec.spatial`/`.opaque`, eight props, `Spatial`, `Axis3`, `SPATIAL_DIMS`, `SpatialValue`, `Turn`, `TURNS`, `TurnValue`, five edges, the six spatial readers, `rotationFrozen`, `edgeOptions`, `MeshRef`, `AssetInfo`, `Scene.assets`, four `SceneNode` fields, `StatePart.frame` widened to `Axis3` + `StatePart.turn`, `stateTouches` taught about `turn`. B: `InputKind`, `INPUT_KINDS`, `MachineInput`, `CompareOp`, `COMPARE_OPS`, `Condition`, `Transition.conditions`/`.exit`, `MOTION_PROPS.exit`, `MachineLayer`, `MachineState.layer`/`.timeline`/`.blend`, `Keyframe`, `Track` (with `dim?: Axis3`, `turn?: Turn`), `Timeline`, `LoopMode`, `Blend`, `BlendKind`, `BLEND_KINDS`, `BlendStop`, `Machine.inputs`/`.layers`/`.timelines`, `SceneNode.states`, `emptyScene` | `packages/design-core/src/scene.ts` | M2 |
| **M4** | **The spatial readings.** All of `spatial.ts`, `solid.ts`, `assets.ts`. `refusedEdge` reduces `stt(...)`, `kfr(...)` and `inst(...)` members to a document node before asking — §6.6. Gains `crossesViewport` — §6.2 | `packages/design-core/src/spatial.ts`, `spatial.test.ts`, `solid.ts`, `solid.test.ts`, `assets.ts` (all new) | M3 |
| **M5** | **The machine readings.** All of track B's L3, **plus** track A's `stateTurnVar` (`srval(I,S,N,R)`) and `stateTurnLabel`. `MACHINE_CHECKS` grows from four to ten | `packages/design-core/src/machines.ts`, `machines.test.ts` | M3 |
| **M6** | **The barrel.** Re-exports M4's and M5's new surface | `packages/design-core/src/index.ts` | M4, M5 |
| **M7** | **The program, third axis.** The `spatial.` gate, `zstated/1`, `s3/1` **including the `inst(...)` clause of §6.3**, `gplane/1` + `gplanespan/1`, the narrowed scene defaults, **the narrowed `gpos`/`gsize`/`gcoord` of §5**, the guarded `EDGE_FACTS`, `rval`/`mdeg`/`t_value`/`turn`/`turned`/`grotated`, `tbase/4` and the component rotation alias (§6.3), **three** `gnoedge` rules (track A's two plus §6.2's), `looks`/`vcam`/`tris`/`asset`, the `#show`/`#project` block, `variableCounts`, and the `% Three dimensions.` CONTRACT block | `packages/design-core/src/compile.ts`, `spatialprogram.test.ts` (new) | M6 |
| **M8** | **The program, the ladder.** All of track B §8, written against M7's widened vocabulary. **Plus the four guards M7 makes necessary**: the state-copy frame defaults of §4, `mlfshadow` over `Axis3`, the rotation copy rules (`srval`, `mrshadow`, `mlrshadow`, `mrwriter`) of §6.4, and the keyframe copy over `Axis3`. **Plus the three projections of §8**, behind that section's gate. `manyfrom/2` for `many/2`. The `% Inputs.`…`% Blend states.` CONTRACT text | `packages/design-core/src/compile.ts`, `machineprogram.test.ts` | M7 |
| **M9** | **Reading it back, both.** A: `ModelNode.spatial`/`.turn`, `ModelState.spatial`/`.turn`, `ModelScene.triangles`/`.looks`, `boxOf3`, `readSolved`'s widened axis table. B: `ModelKeyframe` (**with `.spatial` and `.turn`** — §6.5), `ModelTimeline`, `ModelMachine`'s eight, `ModelScene.keyframes`/`.shownByLayer`. All `collect` cases from both | `packages/design-core/src/model.ts`, `model.test.ts` | M8 |
| **M10** | **The document reader, both** — track A §7.5 and track B L6 | `packages/design-core/src/project.ts`, `project.test.ts` | M9 |
| **M11** | **The edits, both** — track A §7.3 and track B L7, including *both* new `pruneConstraints` clauses (`holdsStateCopy` is shipped; `holdsKeyCopy` is new; a 3D node needs none) | `packages/design-core/src/edits.ts`, `edits.test.ts` | M10 |
| **M12** | **The way out, both** — track A §10 (the `gltf` target, `availableTargets`, the opaque stop, posters, CSS-3D `transform`/`perspective`/`preserve-3d`, the SVG sentences) and track B §9.4 (`StateLayer.layer`, per-layer attribute, `@keyframes`, the blend loss). §6.7 says how they compose | `packages/design-core/src/export.ts`, `export.test.ts` | M11 |
| **M13** | **The glTF writer** — `exportGltf`, `metresFromEmu`, `METRE_IN_EMU` | `packages/design-core/src/gltf.ts`, `gltf.test.ts` (new) | M12 |
| **M14** | **The runtime** — track B L9 | `packages/design-core/src/runtime.ts`, `runtime.test.ts` | M5 |
| **M15** | **The checks** — track B L10 | `packages/design-core/src/machinecheck.ts`, `machinecheck.test.ts` | M5 |
| **M16** | **The 3D renderer** — all of `packages/canvas-3d`, and the app's one dependency entry | `packages/canvas-3d/**` (new), `packages/app/package.json` | M6 |
| **M17** | **Picking and the viewport gesture** — `opaque` in `placedNodes`/`hitTestTree`/`frameAt`/`dropTargetAt`, `entered`, the double-click, `useViewportBudget` | `packages/design-core/src/tree.ts`, `tree.test.ts`, `packages/app/src/design/Editor.tsx`, `packages/app/src/design/useViewportBudget.ts` (new) | M6 |
| **M18** | **The canvas, both** — the `viewport` `CONTENT` entry and its fourth argument (A), and per-layer `playing` plus the scrubber's lerp (B) | `packages/app/src/design/Artboard.tsx` | M16, M17, M14 |
| **M19** | **The rules panel, both** — refused-edge marks, `data-role="inert-rule"`, the cross-viewport warning (A), and `keyframeMembers` (B) | `packages/app/src/design/Constraints.tsx` | M18 |
| **M20** | **The 3D panels** — the six dimension rows, three rotation rows, material, lamp, lens, "look through", import, the budget, the target list | `packages/app/src/design/Inspector.tsx`, `StatusLine.tsx`, `ExportPanel.tsx`, `ShapePicker.tsx`, `packages/app/src/projects/assets.ts` (new) | M18 |
| **M21** | **Inputs and conditions** | `packages/app/src/design/Inputs.tsx` + `.module.css`, `Conditions.tsx` + `.module.css` (all new) | M14 |
| **M22** | **Layers and timelines** | `packages/app/src/design/LayerStrip.tsx` + `.module.css`, `Timeline.tsx` + `.module.css` (all new) | M14 |
| **M23** | **The machines panel and its strips** | `packages/app/src/design/Machines.tsx`, `StateStrip.tsx`, `Transitions.tsx` | M21, M22 |
| **M24** | **The studio wiring** — the playback hook, the label chain, the scrubber | `packages/app/src/design/Studio.tsx`, `packages/app/src/design/useMachinePlayback.ts` | M23 |

**Files nobody owns and nobody may touch:** `units.ts`, `components.ts`,
`measure.ts`, `derived.ts`, `explore.ts`, **`why.ts`, `relax.ts`**,
`annotate.ts`, `paint.ts`, `packages/canvas/**` — **`InfiniteCanvas.tsx` in
particular** — `packages/canvas-core/**`, `LayerList.tsx`. `why.ts` and
`relax.ts` are in bold for track B's reason, which now covers eleven checks
rather than five: they reach the unsat core, the explanation and the relaxation
without one character changing in either, and a step that finds itself editing
one of them has stopped building a constraint.

The label chain at `Studio.tsx`'s two sites is, finally:
`byId.get(n)?.name ?? partLabel(scene,n) ?? datumLabel(scene,n) ?? stateLabel(scene,n) ?? keyCopyLabel(scene,n) ?? n`.

---

## 4. The third axis versus the state-copy frame rules

**The brief's question, answered: it is not correct, and here is the guard.**

`MACHINE_RULES` states a copy's own frame defaults per dimension by iterating the
vocabulary table, at `compile.ts:1110–1111` exactly as shipped:

```prolog
frame(stt(I,S,N),A,0) :- mcopy(I,S,N), gaxis(A), not mframed(I,S,N,A).
frame(stt(I,S,N),Z,0) :- mcopy(I,S,N), gspan(Z), not mframed(I,S,N,Z).
```

Track A widens `gaxis/1` and `gspan/1` behind the `spatial.` gate. So the moment
a document holds one viewport, **every state copy of every part of every instance
in the whole document gains two more `frame/3` atoms**, including the four-state
button on page one that has never heard of the third axis. Track A took care to
narrow the *scene* defaults to `s3/1` precisely so that "a viewport on page four
does not put the whole document into three dimensions" — and then left the state
copies un-narrowed, because track A never read `MACHINE_RULES`.

It is not merely wasteful. It is inconsistent: `inst(I,N)` would be flat (the
scene default is narrowed) while `stt(I,S,N)` would be three-dimensional (this
one is not), and the alias joins them.

**The guard, owned by M8**, replacing those two lines with four:

```prolog
% The planar two, exactly as they shipped — gplane/1 and gplanespan/1 are
% gaxis/1 and gspan/1 as they were before the third axis widened them.
frame(stt(I,S,N),A,0) :- mcopy(I,S,N), gplane(A), not mframed(I,S,N,A).
frame(stt(I,S,N),Z,0) :- mcopy(I,S,N), gplanespan(Z), not mframed(I,S,N,Z).
% ...and the third axis only for the copies that are in it, which is the same
% narrowing the scene defaults got and for the same reason. A state copy of a
% flat button in a document that happens to contain a viewport is flat.
frame(stt(I,S,N),z,0) :- mcopy(I,S,N), s3(stt(I,S,N)), not mframed(I,S,N,z).
frame(stt(I,S,N),depth,0) :- mcopy(I,S,N), s3(stt(I,S,N)), not mframed(I,S,N,depth).
```

**`s3(stt(I,S,N))` costs nothing and needs no new rule**, and this is the part
worth checking rather than believing: `s3(C) :- s3(P), child(P,C)` climbs
`child/2`, and `MACHINE_RULES` already states

```prolog
child(inst(I,P),stt(I,S,N)) :- mcopy(I,S,N), instance(I,R), cinner(R,N), child(P,N), cpart(R,P).
child(I,stt(I,S,R)) :- mcopy(I,S,R), instance(I,R).
```

for the world chain. A state copy therefore inherits `s3` from the instance part
it hangs off, which is exactly the right answer: a copy is in the third axis when
the thing it is a copy of is. There is no negation in that path and no cycle.

On a flat document `gplane ≡ gaxis`, `gplanespan ≡ gspan`, `s3` is empty, and the
four rules derive precisely the atoms the two derive today. That is M8's test,
asserted as sorted-set equality of `frame/3` over the whole template corpus, not
as a spot check.

**Two neighbouring rules were checked and need no guard**, which is worth writing
down so nobody guards them anyway:

- `mbase(I,R,Z,V) :- instance(I,R), gspan(Z), frame(I,Z,V).` (`compile.ts:908`)
  widens to `depth`, and self-narrows: it only fires where `frame(I,depth,V)`
  exists, which requires the instance node itself to be `s3`. An instance of a 3D
  component being resizable in depth is the wanted behaviour, and this is how it
  arrives.
- `mbase(I,N,D,V) :- instance(I,R), cinner(R,N), frame(N,D,V).` leaves `D`
  unbound over `frame/3` and therefore picks up `z` and `depth` for free,
  correctly, with no edit at all.

---

## 5. The unbounded objective — the thing neither track saw

This is the most serious finding in the merge and it would have shipped as
"the app stopped answering on documents with a viewport".

`gaxis/1` and `gspan/1` do not only feed the defaults. They feed the unknowns:

```prolog
gpos(N,A) :- gsolved(N), gaxis(A).      % compile.ts:521
gsize(N,S) :- gsolved(N), gspan(S).     % compile.ts:522
&minimize{ gd(N,A) : gpos(N,A), gpull; 4*gd(N,S) : gsize(N,S), gpull }.
```

and the two inequalities that bound `gd` read `frame(N,A,V)` in their bodies:

```prolog
&sum{ lv(N,A); -gd(N,A) } <= V :- gpos(N,A), frame(N,A,V).
&sum{ lv(N,A); gd(N,A) } >= V :- gpos(N,A), frame(N,A,V).
```

Track A's narrowed scene default supplies `frame(N,z,0)` **only for an `s3`
node**. So in any document holding a viewport, take a plain rectangle on another
artboard that is named in a geometric constraint. It is `gsolved`. It therefore
gains `gpos(N,z)` and `gsize(N,depth)`. It has no `frame(N,z,V)`, so neither pull
inequality grounds, so `gd(N,z)` appears in the `&minimize` with **no lower
bound**. The same happens through `gcoord/2` → `gprobe/3` → `&maximize` on the
explore path.

The codebase already knows this failure mode by name. The comment above
`gsolved/1` explains the `not gdatum(N)` exception in exactly these words: *"gd(D,A)
would then be a variable in the shared &minimize with nothing bounding it from
below. An unbounded objective is not a wrong picture, it is no answer at all."*

**The fix, owned by M7**, is the same narrowing the scene defaults got, applied
one layer up. Five shipped lines become nine:

```prolog
gpos(N,A) :- gsolved(N), gplane(A).
gpos(N,z) :- gsolved(N), s3(N).
gsize(N,S) :- gsolved(N), gplanespan(S).
gsize(N,depth) :- gsolved(N), s3(N).
% gworld/2 and gcoord/2 had bodies identical to gpos/gsize; deriving them from
% gpos/gsize instead of restating the body is atom-identical today and narrows
% for free tomorrow.
gworld(N,A) :- gpos(N,A).
gcoord(N,A) :- gpos(N,A).
gcoord(N,S) :- gsize(N,S).
gcoord(N,A) :- lslot(_,N,_), gplane(A).
gcoord(N,S) :- lslot(_,N,_), gplanespan(S).
```

with `gowns(S,Z) :- layout(S,_), gspan(Z).` and `gmoved(N,A) :- lslot(_,N,_), gaxis(A).`
likewise narrowed to the planar vocabulary plus an `s3` clause. On a flat
document every one of these is the rule that shipped, atom for atom, because
`gplane ≡ gaxis` and `s3` is empty.

**M7's test for this is not optional and is the first one to write:** a document
with a viewport on artboard two and an `align` between two rectangles on artboard
one must be SAT and must place them exactly where the same document without the
viewport places them. Track A's §14 step 4 test 3 ("a rect on another artboard
still has exactly four `frame/3` atoms") tests the symptom; this tests the
disease.

---

## 6. The interactions, and who owns each

### 6.1 A machine state that moves a 3D node in z

**Owner: M3 for the type, M8 for the rules. Track A §12.2's claim that this is
"free in ASP" is true of the shipped rules and false of track B's.**

`sfval(I,S,N,D)` takes any `D`, `mbase/4` carries six, and the copy rules read
`mbase`. So under the *shipped* alias it really is free. But track B §4.5 narrows
that alias to `mfwriter(M,L,N,D)`, which is derived from `mlfshadow(M,L,N,D)`,
which the **compiler emits by iterating the dimension list**. If M8 emits
`mlfshadow` over `DIMENSIONS` while M8 emits `mfshadow` over `DIMENSIONS_3D`, a
state that moves a mesh in z will move `stt(...)` and never reach `inst(...)`:
the copy will be right and the picture will be wrong, in a document that solves
cleanly and reports nothing.

**M8 emits `mfshadow`, `mlfshadow` and the `sfval` variables over the same list**
— `DIMENSIONS_3D` where `isSpatialScene(scene)` and `DIMENSIONS` otherwise — and
`machineprogram.test.ts` asserts a hover that lifts a cube 40px in z moves
`frame(inst(i,cube),z,_)` and not only `frame(stt(i,hover,cube),z,_)`.

### 6.2 A constraint between a 3D node and a 2D one

**Owner: M7 for the refusal, M4 for the reader, M19 for the sentence. Neither
spec addressed this and both are wrong about it in opposite directions.**

Two cases, and they are different.

**On a shared planar axis** — `align [card, hero_cube] on centerY` — the rule
works, is well-defined, and is *not* what a designer expects. `wv(cube,y)` is the
world chain summed through `child/2`, which climbs out of the viewport and up the
artboard, so the rule aligns the cube's position **in the viewport's model space,
offset by the viewport's own frame** with the card's position on the page. There
is no camera in that sum. Move the camera and the cube's pixels move; the
constraint does not notice.

This is allowed — a node is a node, and refusing it would be the parallel
document model invariant 2 forbids. But an invisible surprise is the thing track
A §4.3 spends a page arguing against, so it gets the same treatment: **M4 gains**

```ts
/**
 * Why a rule over these members is measuring something other than what is on
 * screen — or nothing where it is not.
 *
 * The third refusal-shaped reader, and the only one that refuses nothing: a rule
 * across a viewport's wall is exact about model space and silent about pixels,
 * because a camera sits between the two and no linear relation can hold both. So
 * it is a warning rather than a `gnoedge`, marked in the panel and counted in the
 * status line beside the inert ones.
 */
export function crossesViewport(
	scene: Scene,
	members: readonly string[],
): string | undefined;
```

with the sentence, verbatim:

> **“Hero cube” is inside the 3D view “Hero” and “Card” is not. This rule is
> exact about where the cube sits in the scene, and the scene is drawn through a
> camera — so moving the camera moves the pixels and leaves this rule satisfied.
> Put both members inside the view, or both outside it, to constrain what you can
> see.**

**On the third axis** — `align [card, hero_cube] on centerZ` — the rule is worse:
it quietly means nothing, and it currently *reports as satisfied*. With §5's
narrowing, `card` has no `frame(card,z,V)` and no `gpos(card,z)`, but
`gedgeof(card,centerZ)` still grounds (it reads only `c_node/2` and `gneed/2`),
so `ge(card,centerZ)` is defined in terms of unknowns nothing constrains and the
`align` is satisfied by a rectangle the document does not contain. That is the
exact disease `gdatum/1` was written to cure, one axis over. **M7 adds the third
`gnoedge` rule:**

```prolog
% A node that is not in the third axis has no quantity there. Without this, an
% align on centerZ between a card and a cube is satisfied by moving a coordinate
% the card does not have — the same wrong-rectangle answer gdatum/1 refuses for a
% span edge on a column line, and refused the same way: the quantity is never
% minted, the relation goes unstated, and the editor is where it is made visible.
gnoedge(N,E) :- spatial, gedge(E,z,_), not s3(N).
```

and `refusedEdge` (M4) reports it with:

> **“Card” is not in a 3D view, so it has no front, no back and no depth. A rule
> about this quantity would be a rule about a box the document does not contain.
> Put it inside the view, or use a rule about the two axes it does have.**

### 6.3 A 3D node inside a component definition, and its state copies

**Owner: M7. Two gaps, both in track A, both silent.**

**`s3` does not reach an instance's parts.** `s3/1` is seeded from
`kind(N,viewport)` and from `zstated(N)`, and `zstated/1` is emitted per
*document* node. A definition part with a `spatial` entry gets `zstated(part)`;
`inst(I,part)` gets nothing, and the `child/2` climb only helps if some ancestor
is `s3`. So an instance of a definition whose root is a `pivot` (not a viewport)
placed inside a viewport works by the climb, and an instance of a definition
holding a lifted `rect` placed on a plain artboard does not. M7 adds:

```prolog
% An instance's part is in the third axis where the definition's part is. The
% climb through child/2 catches a part under a viewport; this catches the one the
% document lifted by name, whose zstated/1 is about the definition and not about
% this use of it.
s3(inst(I,N)) :- instance(I,R), cpart(R,N), s3(N).
```

**Rotation does not reach an instance's parts at all without a machine.** Track A
§12.3 puts `mbase_turn/4` and the `turn(inst(I,N),R,V)` alias inside
`MACHINE_RULES`, so a definition containing a rotated mesh, placed twice, with no
machine anywhere, draws two unrotated meshes. That is a component bug wearing a
machine's clothes. M7 moves it to `COMPONENT_RULES`, beside `mbase/4`, renamed
`tbase/4` for what it is:

```prolog
% What an instance's part is turned by before any state has an opinion. Beside
% mbase/4 and split out for mbase/4's exact reason: the machine section also
% writes turn(inst(I,N),R,V) — the shown state's copy, aliased back — and a rule
% cannot read its own head.
tbase(I,N,R,V) :- instance(I,R0), cinner(R0,N), turn(N,R,V).
turn(inst(I,N),R,V) :- tbase(I,N,R,V), not mrshadow(I,N,R).
```

with `#defined mrshadow/3.` so that the guard grounds away on every document with
no machine in it — the same shape the `mshadow` guard on `rendered/3` already has.

**The state copies then follow for free**, which is the payoff: track A §12.3's
three rotation rules read `tbase/4` instead of `mbase_turn/4` and are otherwise
unchanged, and `grotated(stt(I,S,N))` derives, so a state that turns a part
correctly loses its `left` and `right` through the same two `gnoedge` rules that
serve a document node. A cross-state rule over a turned copy is refused, visibly,
with no new machinery — which is the strongest evidence available that the two
tracks' encodings actually compose.

### 6.4 A layer that hides a camera, and layers that fight over a rotation

**Owner: M8 for the rules, M16 for the renderer's reading.**

Three distinct answers, and they differ.

**A layer that hides a mesh or a model** works today with no change: `hidden` is
monotone, track B §4.5 explicitly does not narrow the `hidden` alias by writer,
and two layers that both hide agree. The renderer honours `visible/1` and the
mesh is not mounted.

**A layer that hides a light** turns the light off, and that is correct and
wanted — a `light` is not `drawable` but it is a node, `visible/1` is derived for
every node, and a state that darkens a scene by hiding the key light is exactly
the affordance the "a 3D object is an ordinary scene node" invariant was bought
for.

**A layer that hides a camera must not blind the viewport.** `vcam/2` is a claim
about which camera a view looks through, not about what is painted, and a
designer hiding a camera means "stop drawing the camera's marker", not "stop
looking". So `vcam/2` **does not consult `hidden/1`**, and the rule track A §3.5
gives is kept verbatim. M16 states the corresponding renderer rule: `visible/1`
gates `mesh`, `model` and `light`, and is ignored for `camera` and `pivot`.

**Two layers that both turn one part** needs the pair track B built for `frame`
and `rendered` and did not build for `turn`, because `turn` did not exist when it
was written. M8 adds it, in the shape of the other two:

```prolog
mrwriter(M,L,N,R) :- mlrshadow(M,L,N,R),
                     K = #max{ J : mlrshadow(M,L2,N,R), mlindex(M,L2,J) },
                     mlindex(M,L,K).
mrfight(M,L1,L2,N,R) :- mlrshadow(M,L1,N,R), mlrshadow(M,L2,N,R), L1 < L2.
turn(inst(I,N),R,V) :- turn(stt(I,S,N),R,V), shown(I,S),
                       minstance(I,M), mslayer(M,S,L), mrwriter(M,L,N,R).
```

and `viol(machine_layers_agree)` gains a third disjunct, `:- mrfight(_,_,_,_,_).`
Without the writer guard, two layers each turning a card derive two `turn/3`
atoms for one `(node, axis)` — which, exactly as track B §4.4 says of
`rendered/3`, is not two designs but one arbitrary answer, silently.

### 6.5 Materials, timelines, and what a state may override

**Owner: M3 for the types, M8 for the emission, M16 for the reading.**

Track A §12.1 is correct and needs no rules: a mesh's `fill`, `roughness`,
`metalness`, `opacity` and `solid`, a light's `ink` and `intensity`, and a
camera's `fov`, `near` and `far` are ordinary `PropName`s, so `sprop/4`,
`mshadow/2`, `mlshadow/4`, `mwriter/4` and the `rendered/3` alias carry all of
them with not one new line. A hover that warms the key light is authored the way
a hover that darkens a button is.

Two consequences neither spec drew:

**A timeline must be able to animate the same things a state can.** Track B typed
`Track.dim?: Dimension`, which would have let a *state* lift a cube in z and
forbidden a *timeline* from doing it. The resolution in §2 widens it to `Axis3`
and adds `Track.turn?: Turn`, so a track names exactly one of `prop`, `dim` and
`turn`. The keyframe copy's frame rules already quantify over `D` unbound and
need no edit; the rotation track adds one pair of rules in the shape of the
dimension pair.

**`ModelKeyframe` needs `.spatial` and `.turn`.** M9 adds them, for
`ModelState`'s reason exactly: a keyframe copy of a mesh that carries only four
numbers is a pose the canvas cannot draw.

**The clamps stay in one place.** `materialOf`, `lampOf` and `lensOf` in
`spatial.ts` are the only place a roughness is clamped to [0,1] or a negative
intensity to zero. `canvas-3d` reads them and must not re-clamp: two clamp sites
is two answers, and the one in the pure package is the one a headless test can
check.

### 6.6 What a refusal reader is handed

**Owner: M4.** Both new copy terms are things a rule may name — `stt(I,S,N)`
(shipped), `kfr(I,W,R,K)` (track B) — and `inst(I,N)` was already one. So
`refusedEdge(scene, member, edge, picks)` is handed a term, not a node id, and it
must reduce before it asks: `parseStatePart`, then `parseKeyCopy`, then
`parseInstancePart`, then the bare id. Getting this wrong means a rule over a
turned mesh's state copy is offered `left`, the program refuses it through
`gnoedge`, and the panel says nothing — which is the one outcome track A §4.3
exists to prevent.

`inertConstraints` and `crossesViewport` reduce the same way, through one shared
private helper.

### 6.7 How the two exports compose

**Owner: M12.** They compose, and the reason is worth stating because it looks
like it should not.

Track B computes a state's CSS as `diff()` of the state copy's declarations
against the initial state's, over the existing `declarationsFor` and `geometry`.
Track A teaches `geometry()` to write `transform: translate3d(...) rotateZ(...)…`
beside the `left`/`top`/`width`/`height` it already writes. So **a machine state
that turns a card outside a viewport exports as an animated CSS transform with no
new emitter code at all** — the diff picks the `transform` declaration up like
any other, and the `transition:` line names it like any other property.

Inside a viewport nothing of the sort is emitted, by track A §10.4's rule, and
track B's machine losses and track A's viewport loss are both appended: a hover
that darkens a button and spins a cube exports half of itself and says which
half, in two sentences from two tracks that were never merged.

Three orderings inside M12, so the file is written once:

1. the `opaque` stop in the HTML emitter, before anything else, so no later step
   emits markup for a mesh;
2. track A's `geometry()` widening, so track B's `diff()` sees `transform`;
3. track B's layer and `@keyframes` emission on top.

---

## 7. Decisions where the two specs disagreed

Nine, each with the reason, so that anyone who wants to reverse one can see what
it costs.

1. **`Solid` becomes `SpatialFrame`, and `ModelNode.solid` becomes
   `.spatial`.** Track A used one word for the mesh primitive and for the
   `{z, depth}` pair. The primitive keeps the word because three things already
   carry it (`PropName`, `ValueType`, `solid.ts`); the pair takes the name that
   makes it the twin of `SceneNode.spatial`.
2. **Track A's compile step lands before track B's.** §3.1. The alternative —
   B first — costs a re-guard of seven rules B wrote and A did not.
3. **`many/2` becomes `manyfrom/2`.** Greppability, §1.2.
4. **`permilleOf` is not a new quantity.** Track B's ownership table called it
   the fifth; `ratio` has been a quantity since `numeralOf`. Only `angle` is new.
5. **Track A's `mbase_turn/4` moves out of `MACHINE_RULES` and becomes
   `tbase/4` in `COMPONENT_RULES`.** §6.3. Track A put a *component* rule in the
   machine section, which would have left rotation broken on every document with
   a rotated component and no machine.
6. **`stateTurnVar` / `srval` is added by M5 in `machines.ts`, not by track A.**
   Track A's own ownership table forbids it from touching that file and then asks
   for a symbol in it. M5 supplies it.
7. **`Track.dim` widens to `Axis3` and `Track.turn` is added.** §6.5. Track B
   typed it four-valued because track A did not exist when it was written.
8. **A cross-viewport rule is warned about, not refused; a cross-viewport rule on
   the z axis is refused.** §6.2. The first is exact and surprising, the second
   is meaningless, and treating them the same would either forbid a legitimate
   rule or permit a hollow one.
9. **The `#project` gap in §8 is fixed inside M8 rather than deferred**, behind a
   gate that proves no template's universe count moves.

---

## 8. One shipped gap both tracks widen

Not caused by either track, found while merging them, and it must be fixed here
because both tracks make it worse.

`f_value(N,D,L) :- resolved(fval(N,D),L).` is `#project`ed, which is what makes
"this card is in one of two places" two universes. **`sfval(I,S,N,D)` has no such
derivation and is projected by nothing.** So today, a state delta whose `y` holds
two alternatives is *one* universe with an arbitrary pick: the two designs a
designer wrote collapse, silently, and the `#project` machinery that exists to
prevent exactly this was never pointed at state frames. (A state's *paint* deltas
are fine — they reach `rendered/3`, which is projected.)

Track A adds `srval` (a state's rotation) and track B adds `kval` (a keyframe's
value) to the same un-projected family. Left alone, "the card tilts one of two
ways on hover" and "the overshoot goes one of two distances" would both collapse
the same way.

**M8 adds three derivations and three projections, in `f_value/3`'s shape:**

```prolog
sf_value(I,S,N,D,L) :- resolved(sfval(I,S,N,D),L).
sr_value(I,S,N,R,L) :- resolved(srval(I,S,N,R),L).
kf_value(M,W,R,K,L) :- resolved(kval(M,W,R,K),L).
#project sf_value/5.
#project sr_value/5.
#project kf_value/5.
```

**Gate, and it is not optional:** M8 must show that no template's universe count
moves. It does not — every state delta in `templates/machine.ts` is built with
`single(...)`, so every one of these variables has exactly one alternative and
the finer projection partitions nothing differently — but that is a fact about
today's templates and it has to be re-checked rather than assumed. If a count
does move, this change comes out of M8 and becomes its own step with its own
golden update, because invariant 4 outranks a bug fix.

---

## 9. Review checklist for the merge itself

The two source specs' checklists both still apply in full. These are the
questions only the merge can be asked.

1. Does a state copy or a keyframe copy gain a `z` or a `depth` in a document
   whose viewport is somewhere else entirely? §4.
2. Does a geometric constraint over two flat rectangles still solve, in a
   document that contains a viewport? §5. If the app hangs or returns nothing,
   this is why.
3. Does `mlfshadow` iterate the same dimension list `mfshadow` does? §6.1. The
   symptom is a state copy that moves and a picture that does not.
4. Does a rotated mesh inside a component definition, placed twice, with no
   machine, actually turn? §6.3.
5. Does a rule between a node inside a viewport and one outside it say anything
   in the panel? §6.2. Silence here is the failure.
6. Do two layers that both turn one part derive one `turn/3` atom for that pair,
   or two? §6.4.
7. Was `packages/canvas/src/InfiniteCanvas.tsx` edited? It must not be.
8. Did anything in `why.ts` or `relax.ts` change? Eleven checks now depend on it
   not having.
9. Is a stub reported as a stub? A `ViewportCanvas` that typechecks and draws
   nothing is scaffolding; a `@keyframes` emitter that writes an empty block is
   scaffolding; calling either one finished is the worst outcome available to
   this plan.
