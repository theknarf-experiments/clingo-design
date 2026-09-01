# The parity plan: paint, fonts, curves, gestures and a prototype, as one order of work

**Status: frozen. This document outranks all four source specs.**

Four architecture documents were written in parallel by agents who could not talk
to each other:

- `docs/framer-paint-spec.md` — gradients, blur, mix modes; claims `compile.ts` is
  untouched.
- `docs/framer-fonts-spec.md` — a font is a file in the tree; claims no new ASP at
  all.
- `docs/framer-motion-spec.md` — two independent parts: **curves** (an easing
  becomes a `Value`) and **gestures** (four triggers and a scroll clock).
- `docs/framer-prototype-spec.md` — a link is a field on a node, and present mode
  is a route.

Between them they are **five features**, because the motion spec is two specs in
one file, and this plan treats them as five: paint, fonts, easing, triggers,
prototyping — one commit each.

All four extend the tree as `0f11338` left it, after `docs/merged-plan.md` landed
its twenty-four steps. That document is still the law where nothing below
contradicts it, and this one is written in its shape deliberately: it found four
collisions the two specs it merged could not see, and finding this set's is the
job here.

Between them the four tracks claim **eleven of the same files** and would have
edited nine of them simultaneously. Where a paragraph here contradicts a source
spec, **this one wins**, and the source spec is to be read through it. Where an
implementation step finds *this* document wrong, it implements the nearest
correct thing and says so loudly in its return value — it does not quietly
redesign an interface the next step is coding against.

---

## 0. What this merge actually found

Seven things. Two were anticipated by a spec, one was anticipated and answered
with the wrong evidence, and four were not seen by anybody.

1. **A drag that ends navigates.** Step 4 teaches the runtime that a gesture
   which ended is not also a click, and swallows the click inside `listen()`.
   Step 5 makes a linked node an `<a href>`, and a `click` link uses **no script
   at all** — the browser navigates natively, and a listener that returns early
   cannot stop a default action it never sees. So a card that is both draggable
   and linked works in the studio, where one reader suppresses the other, and
   navigates on every drag in the exported file. Wrong only in the artefact, only
   after a gesture. §6.1.
2. **A presentation paints in colours nobody chose and measures in a face it is
   not painting in.** The paint step mounts its `@property` registrations at the
   *studio* root and the fonts step registers its faces in a *studio* hook;
   present mode is a different route and renders neither. §6.2.
3. **The link stylesheet outranks the design's own colour.** `.design
   a[data-node] { color: inherit }` is specificity (0,2,1); a node's own rule is
   a bare class and a style's is `:where()`, which is nothing. So putting a link
   on a text node deletes its `ink`, which is the exact opposite of the sentence
   that block's comment makes. §6.3.
4. **Paint's proof that it did not touch the compiler is a claim about a git
   diff**, true at the moment it lands and false forever after, because three of
   the other four steps change the program of every document that has a machine
   in it. The assertion has to be restated before it is written, not repaired
   after it rots. §6.4.
5. **`blur` is already a `Trigger`.** The paint spec spends a page proving `mix`
   is not `blend` and never checks the other new word against the same table.
   Not fatal, and the reason it is not fatal is worth writing down once so the
   next person does not re-litigate it. §1.2.
6. **`page` is about to be both a timeline clock and a link predicate**, in one
   generated program. Renamed. §1.2.
7. **Two shipped predicates gain a `#project` in step 3**, and a projection can
   only ever *split* universes. It splits none of today's templates and that has
   to be proved rather than believed, because invariant 4 outranks a feature.
   §6.5.

Everything else is bookkeeping, and the bookkeeping is in §§1–5.

---

## 1. Collisions

### 1.1 Files claimed by more than one track

Eleven files and six panels. `P` is paint, `F` fonts, `E` easing, `T` triggers,
`L` prototyping — which is also their landing order.

| file | claimed by | resolved |
| --- | --- | --- |
| `design-core/src/values.ts` | P, F, E | **P → F → E**, in that order, three disjoint regions — §5.2 |
| `design-core/src/scene.ts` | P, F, E, T, L | **P → F → E → T → L**; E *removes* the block T edits beside, which is why E precedes T — §3 |
| `design-core/src/paint.ts` | P only | **P alone**, and F is forbidden it — §4 |
| `design-core/src/export.ts` | P, F, E, T, L | **all five, in order**, and the head stylesheet is written by four of them — §5.6 |
| `design-core/src/compile.ts` | E, T, L (P claims *none*) | **E → T → L**, and P's claim is an assertion rather than an absence — §6.4 |
| `design-core/src/machines.ts` | E, T | **E then T**, disjoint |
| `design-core/src/model.ts` | E, T, L | **E → T → L**, three field additions |
| `design-core/src/project.ts` | F, E, T, L | four readers, disjoint |
| `design-core/src/runtime.ts` | T, L | **T then L**, and L edits T's binder — §6.1 |
| `design-core/src/edits.ts` | F, L | disjoint (`addFont`/`removeFont`; `setLink`) |
| `design-core/src/measure.ts` | F only | **F alone**, and `MEASURED_PROPS` must not grow — §5.7 |
| `app/src/design/Inspector.tsx` | P, F, L | **P → F → L**; P and F both edit `appearanceRow` — §5.8 |
| `app/src/design/Studio.tsx` | F, E, L (and P, overturned) | **F → E → L**; P's edit moves to `App.tsx` — §6.2 |
| `app/src/design/Timeline.tsx` | E, T | E owns the keyframe easing row, T owns the clock select |
| `app/src/design/Editor.tsx` | T, L | **T then L**; L lifts what T just wrote — §6.6 |
| `app/src/design/ValueEditor.tsx` | F, E | F adds the `options` prop; E only *uses* `type="easing"` |
| `app/src/design/ExportPanel.tsx` | F, L | F fetches font bytes; L changes the filename default |

`Transitions.tsx`, `CurveField.tsx`, `Fonts.tsx` and `Present.tsx` are
single-owner. `useMachinePlayback.ts` is claimed by nobody and that is a result
rather than an oversight — the motion spec says so and this plan holds it: a step
that finds itself editing it has misread the clock.

`packages/canvas-3d/**`, `packages/canvas/**`, `packages/canvas-core/**`,
`why.ts`, `relax.ts`, `derived.ts`, `explore.ts`, `annotate.ts`, `freedom.ts`,
`machinecheck.ts` and `units.ts` are claimed by nobody and must stay that way.
`machinecheck.ts` is in that list on the motion spec's own argument (§2.6.4): a
gesture with no undo edge is already `mdeadend/2`, and a second check saying the
same thing about two specific triggers goes quiet the day somebody adds a third.

### 1.2 Names claimed twice, or already taken

Every predicate below was grepped against `compile.ts` as it ships. The greps
that count are the ones with the parenthesis, because this codebase's comments
are prose and a bare word appears dozens of times in English and never as a term.

**Already taken, and a genuine collision:**

- **`page`** — the motion spec's `TimelineClock` is `"time" | "view" | "page"`
  and reaches the program as `mclock(M,S,page)`; the prototype spec's link
  vocabulary states `page(pg_about_1k3z9)` and `viol(dead_link) :- goes(P), not
  page(P).` A 0-ary constant and a unary predicate do not collide for the
  grounder, and they collide for everything else: one program, one `%`-contract,
  one Rules panel, and `grep 'page('` finds both. **Renamed `pageScroll`** — §2.
- **`blur`** — `Trigger`'s eighth member, shipped, `TRIGGERS.blur` with the label
  "Blurred" and the event `focusout`. The paint spec adds a `PropName "blur"`
  after arguing at length that `mix` must not be `blend`, and never runs its own
  test against the trigger table. **Kept, with the label changed to "Layer
  blur"** — §2, and the rule that decides it is stated there because it is the
  rule that will be asked for again.

**Already taken, and correctly extended rather than collided with:**

- `EasingSpec` — the motion spec says the easing table "gains one column and one
  optional sub-record". It gains the sub-record only: `{ label, css }` is what
  `EASINGS` already holds (`scene.ts:3802`). What is new is that the anonymous
  shape becomes a named `EasingSpec` interface. One sentence of the spec is
  wrong; the design is not.
- `measing/3` and `mkeasing/5` — both exist. `measing/3` is a *fact* today
  (`compile.ts:4340`) and becomes derived; `mkeasing/5` is already `#show`n and
  gains a `#project`. Neither is a new name and both change meaning, which is
  worse than a new name and is why §6.5 gates them.
- `componentIdOf` — the prototype spec factors its arithmetic into
  `aspConstant(prefix, stem, from)`. Correct, and test 4 of its plan freezes the
  output so the factoring cannot move an id that already reaches shipped
  programs.

**Claimed twice inside one spec, resolved here:**

- **`missingFonts`** — declared in the fonts spec §3 as a pure reader in
  `fonts.ts` (`missingFonts(scene, held): FontFile[]`) *and* used in §7.2 as the
  export's sentence builder beside `missingImages`. Two functions, one name, two
  files. The reader keeps the name; the export's builder is **`missingFaces`**.
- **`view`** — a `TriggerSource` (where a runtime hears a trigger) and a
  `TimelineClock` (what advances a timeline), both added by step 4, both in
  `scene.ts`, twenty lines apart. **Both kept**, because `TriggerSource` is
  TypeScript-only and never reaches the program, so the two can never meet in an
  answer set. Recorded so nobody merges them into one union on the grounds that
  they have the same members.

**Free, and kept with the near-miss recorded:**

- `here/1` (prototyping). The English word is everywhere in these essays; `here(`
  is nowhere. Kept, on the same terms `turn/3` was kept in the last merge.
- `goes/1`, `link/2`, `linkon/2`, `mclock/3`, `measeopt/1`, `mdefease/1`,
  `bezier/5`, `mreadsease/2`, `mreadskeas/4` — zero occurrences as terms today.
- `mix`, `gradient`, `gradientFrom`, `gradientTo`, `backdropBlur` — zero
  occurrences anywhere in `compile.ts`. The paint spec's `mix`-over-`blend`
  decision stands, unchanged and now checked: `blend` really is taken five times
  over by the machine model's timeline mixing.

**Word reuse across enumerated types is already the house practice**, and this
matters because two of the five steps add rosters. `stretch` is both an `align`
and a `fit`; `fixed` is both a `sizing` and a `growth`; `center` is in three
menus; `point` is a `lamp` and `plane` is a `solid`. A literal has no type and
the reader is chosen by what the value *is* — so `MIXES`' twelve words collide
with nothing by construction, and the rule the codebase actually keeps is the one
§2 states about `blur`.

---

## 2. The resolved naming table

One row per new type, property, predicate and constant that is contested, renamed
or worth pinning. Everything not in this table keeps the name its source spec
gave it.

| what | claimed as | by | **resolved** | why |
| --- | --- | --- | --- | --- |
| the blend-mode property | `mix` | P | **kept** | `Blend`, `BlendKind`, `BLEND_KINDS`, `BlendStop`, `mblend/3` are the machine model's mixing of timelines and were here first. Confirmed against the shipped tree |
| the layer-blur property | `blur`, label "Blur" | P | **`blur` kept; label becomes "Layer blur"** | `blur` is `Trigger`'s eighth member (label "Blurred", event `focusout`). Two things may share a word when (a) they can never occupy the same argument position of the same predicate and (b) no one panel shows both words. `rendered(N,blur,L)` and `mtrigger(M,T,blur)` satisfy (a), and the property's value is a length so `word(L,blur)` is unreachable from it. (b) failed — a machine state's delta rows and its trigger menu are one screen apart — and "Layer blur" fixes it for one string, pairs with "Backdrop blur", and is what every other tool calls it |
| the timeline clock that follows the document's scroll | `page` | T | **`pageScroll`** | §1.2. `mclock(M,S,page)` and `page(P)` in one program is the `blend` collision one feature over. `view` stays: nothing else in the program is called `view` (`viewport` is a `kind`) |
| the export's missing-face sentence builder | `missingFonts` | F | **`missingFaces`** | the pure reader in `fonts.ts` keeps `missingFonts`; two functions with one name in two files is the duplication `store.ts` congratulates itself on removing |
| `optionLabel`'s widened signature | two shapes offered | F | **`optionLabel(type, value, extra?, fallback?)`** | the spec offered a nested ternary *or* a fourth parameter and said either was fine. It is not fine to leave that to the implementer: `ValueEditor` is shared by five callers and a nested ternary in one of them is a second dialect. The fourth parameter is `familyLabel` at the font call site and absent everywhere else |
| the easing table's home | `values.ts` | E | **kept**, and `scene.ts` re-exports | `VALUE_TYPES.easing.options` must read it and `scene.ts` imports `values.ts`. This is the move `FONTS` already made |
| the shape of an easing entry | "one new column" | E | **`EasingSpec` is a new *name* for a shipped shape, plus `spring?`** | §1.2 |
| a state's clock | `MachineState.clock?: TimelineClock` | T | **kept, a word and never a `Value`** | the motion spec's own argument, and it is the one place its answer goes the other way from the easing step's. A feel is a scale; a clock is wiring |
| a link | `SceneNode.link?: NodeLink` | L | **kept, and never a `Value`** | it would make every link a `pick`, an `alt/2` and a branch of the space, paid for by every document so the rare one can vary — and the varying case is a rule over `pick/2`, which is where a decision that depends on the design has always belonged |
| a page's constant | `pg_about_us_1k3z9` | L | **kept** | snake_case with a hash, which is not lowerCamel and *is* legal ASP (`[a-z][A-Za-z0-9_]*`), and is `componentIdOf`'s shipped shape. Recorded so nobody "fixes" it into a camel-cased second implementation of an id that reaches generated programs |
| the anchor's neutralising rule | `.design a[data-node]` | L | **`:where(.design a[data-node])`** | §6.3 |
| the click a gesture swallows | `swallow` inside `listen()` | T | **a capture-phase listener on the root, added by L** | §6.1 |
| the paint step's `@property` mount point | `Studio.tsx` | P | **`App.tsx`** | §6.2 |
| paint's no-compiler-change proof | byte-identical `program` before and after | P | **`"paint adds no predicate"`** | §6.4 |

### 2.1 Every ASP-facing constant, checked

Anything that reaches the program *as itself* must be a legal ASP constant —
`[a-z][A-Za-z0-9_]*` for a symbol, the same for a functor. Checked one at a time:

- **Paint.** Property names `mix`, `gradient`, `gradientFrom`, `gradientTo`,
  `blur`, `backdropBlur` — all lowerCamel ✓. Mix-mode values reach `word/2` as
  `normal multiply screen overlay darken lighten difference exclusion hue
  saturation color luminosity` — twelve single lower-case words ✓, which is
  exactly why the four hyphenated CSS modes are out and must stay out. Gradient
  recipes and colours reach the program as quoted strings only — parentheses,
  commas and hashes all fail `wordOf`, which is the same company a `box-shadow`
  already keeps ✓.
- **Fonts.** Nothing. That is the fonts spec's central finding and this plan
  holds it: a `fontFamily` is already a `Value`, `rendered/3` is already shown,
  and the `@font-face` join happens in TypeScript where it belongs ✓.
- **Easing.** `easing` as the fifth `mval/3` key ✓. The eight curve words
  `linear ease easeIn easeOut easeInOut springGentle springSnappy springBouncy`
  ✓. `cubicBezier(200,0,0,1000)` — a lowerCamel functor with four integers ✓, and
  the reason the dialect exists: `cubic-bezier(0.2, 0, 0, 1)` is a minus sign and
  a non-integer to the grounder. Predicates `measeopt/1`, `mdefease/1`,
  `bezier/5`, `mreadsease/2`, `mreadskeas/4` ✓. The variable key
  `keas(m1,tl1,<track>,3)` inherits `mkat/5`'s existing requirement that a track
  name is a legal constant ✓.
- **Triggers.** `viewenter viewleave dragbegin dragend` ✓. Clocks `time view
  pageScroll` ✓ (post-rename). `mclock/3` ✓.
- **Prototyping.** `link/2`, `linkon/2`, `goes/1`, `page/1`, `here/1` ✓. Page ids
  from `aspConstant`, which lower-cases, collapses non-alphanumerics to `_`,
  strips leading and trailing `_`, substitutes `c` for an empty stem and prefixes
  `pg_` — so a leading digit is structurally impossible ✓. `linkon/2`'s second
  argument is one of the three shipped trigger words ✓.

---

## 3. The ordering, and its reason

**Paint, then fonts, then easing, then triggers, then prototyping.** The brief's
order is kept. It was checked against the specs rather than assumed, and each
edge earns its place:

**Paint first**, for two reasons and the second is the stronger. It is the only
step that changes bytes every existing document already exports — `fill` stops
writing the `background` shorthand and writes `background-color`, which rewrites
about a dozen assertions in `export.test.ts` — so landing it first means the four
later steps write their export assertions once, against the corrected
declarations. And its central claim, that `compile.ts` is not touched, is only
*observable* while the program is otherwise unchanged: from step 3 onward, every
document with a machine in it gets `mdefease.`, eight `measeopt/1` facts and one
`mclock/3` per state whether or not anybody asked for a curve. §6.4 restates the
assertion so it survives; landing paint first is what lets the original one be
run once, as a golden, inside its own commit.

**Fonts second.** It is the step that *restructures* `export.ts` rather than
appending to it: `IMAGE_TYPES` becomes `MEDIA_TYPES`, `dataUrl` takes a fallback
MIME, the stylesheet becomes `[...fontFaces(...), BASE_CSS]` instead of
`[BASE_CSS]`, and one shipped `EXPORT_TARGETS.html.loses` sentence is rewritten
because it is now half wrong. Steps 3, 4 and 5 all append to that same list and
that same array. Appending to a list somebody is about to rewrite is the merge
nobody wins.

**Easing third, before triggers.** The motion spec says its two parts are
independent and they nearly are. Two things want this order anyway. First,
`Easing`, `EASINGS`, `EASING_NAMES` and `DEFAULT_EASING` *leave* `scene.ts` in
step 3 (lines 3794–3819), and the trigger block step 4 rewrites is
`scene.ts:3722–3792` — the seventy lines immediately above. Two agents in one
window of one file is precisely the collision this document exists to prevent,
and sequencing costs nothing. Second, step 4 replaces `TRIGGER_EVENTS` with
`TRIGGER_BINDINGS` in `runtime.ts`, which step 5 codes against; putting the
runtime's shape change before both of its readers means it is written once.

**Triggers fourth, before prototyping.** `LINK_TRIGGERS` is "three of the eight"
in its spec and must be written as three of the **twelve**, with the four new
words refused on the record (§8). `Editor.tsx` grows a drag recogniser in step 4
and step 5 lifts pointer logic out of that same file. And the swallowed click of
§6.1 is a fix step 5 makes *to* step 4's runtime, which is only expressible in
this order.

**Prototyping last**, because it is the only step that reads all four of the
others: a presentation measures with the fonts step's `ready` set, paints with
the paint step's registrations, paces with the easing step's curves and gestures
with the trigger step's slop. A presenter written against a half-finished stack
presents a half-finished design, and — §6.2 — two of those four dependencies fail
*silently*.

Two orderings **inside** a step, both load-bearing:

- **Step 1 lands `fill → backgroundColor` and `SURFACE_BOX` first**, with the
  twelve export assertions rewritten, before a single new property exists. It is
  the only edit in the whole plan that can break a picture that works today, and
  it should be the thing a reviewer sees at the top of the diff rather than
  buried under six table entries.
- **Step 2 lands measurement before export**, which is the fonts spec's own §13
  and its reason is kept verbatim: an export that carries a face measured in the
  wrong one is a file that is wrong in a way nobody can see until they open it.

---

## 4. File ownership

Every row owns whole files unless a region is named. A step that needs a symbol
another step owns writes against the signature in this document and does not go
and add it. A later step inheriting a half-finished type from an earlier one is
expected; two steps editing one function is not, and where it is unavoidable §5
says who writes which line.

| # | step | may edit | must not touch |
| --- | --- | --- | --- |
| **1** | **Paint** — six properties, two value types, the fill longhand, the registrations, the SVG flattening | `values.ts` (`ValueType` +2, `GRADIENTS`, `MIXES`, `GRADIENT_FROM/TO`, two `VALUE_TYPES` rows), `scene.ts` (`PropName` +6, `PropSpec.needs`, `PROPS` +6, `KINDS[*].props`), **all of `paint.ts`**, `export.ts` (`BASE_CSS`, `SVG_PAINT`, `svgPaint`'s flatten, `tweenedKeys`' filter list, `EXPORT_TARGETS.svg.loses`, the gradient-transition loss), `props.test.ts`, `export.test.ts`, `measure.test.ts`, `tree.test.ts`, `parity.test.ts`, `Inspector.tsx` (**only** the `needs` guard at the top of `appearanceRow`), `Artboard.module.css`, `App.tsx` (the one `<style>`), the e2e walk (one assertion) | `compile.ts` — **at all**, and that is the claim rather than a restriction; `machines.ts`, `model.ts`, `project.ts`, `edits.ts`, `measure.ts`, `runtime.ts`, `Studio.tsx`, `Editor.tsx`, `Transitions.tsx`, `Timeline.tsx`, `KINDS.group.props` (stays `[]`) |
| **2** | **Fonts** — a font file in the tree, the loaded set, the measured string, the face in the file | `scene.ts` (`FontFile`, `FontAxis`, `Scene.fonts`), `values.ts` (`SYSTEM_FONTS`, `optionLabel`'s two new parameters, the `FONTS` comment rewrite), **new `fonts.ts` + test**, `measure.ts` (`fontNotes` **only**), `project.ts` (`normalizeScene` tolerating the field), `edits.ts` (`addFont`, `removeFont`), `export.ts` (`fontFaces`, `missingFaces`, `ExportOptions.fonts`, `MEDIA_TYPES`, `dataUrl`, the `css` array head, both `EXPORT_TARGETS` lists), `index.ts`, app: `measureText.ts`, `Studio.tsx` (`PANELS`, `useDocumentFonts`, the memo, the status line), **new `Fonts.tsx` + css + `useDocumentFonts.ts`**, `ValueEditor.tsx` (the `options` prop), the five `font`-typed call sites (one prop each), `ExportPanel.tsx` (font bytes) | `compile.ts` — **at all**, and that is fonts' own finding; `paint.ts` (`PAINT.fontFamily` stays a pass-through and `DOCUMENT_BASE.fontFamily` stays hard-coded); `MEASURED_PROPS` — **must not grow**, §5.7; `machines.ts`, `runtime.ts`, `model.ts`, `Editor.tsx`, `store.ts`, `packages/vfs/**` |
| **3** | **Easing** — a curve is a `Value`, three springs, a custom bezier, the seventh bridge | `values.ts` (the moved easing block, `SpringSpec`, `SPRING_STOPS`, `sampleSpring`, `cssEasing`, `bezierOf`, `keyEaseVar`, `ValueType "easing"`), `scene.ts` (`Transition.easing`, `Keyframe.easing`, the re-exports, **removing** the easing block), `machines.ts` (`easingOf`, `keyEasing`, `TrackSample.easing`), `project.ts` (two `settingValue` lines), `compile.ts` (`mdefease/1`, `measeopt/1`, `bezier/5`, the ten rules, one `#show`, two `#project`s, `machineValues`, `unreadVariables`, the `CONTRACT` prose), `model.ts` (`ModelMachine.easing`), `export.ts` (`pacing`, `MachineExport.springs`, the `:root` + `@supports` block), `Transitions.tsx`, `Timeline.tsx` (**only** the keyframe easing row), **new `CurveField.tsx`**, `Studio.tsx` (**only** `--dc-play-easing`) | `runtime.ts` — a curve is not a trigger and `pseudoClassFor` must not learn about one; `Trigger`, `TRIGGERS`, `TriggerSpec`; `MOTION_DEFAULT_PREDICATES` and `MotionProp` — easing must **not** become one; `paint.ts`, `edits.ts`, `measure.ts`, `Editor.tsx`, `useMachinePlayback.ts`, `Inspector.tsx` |
| **4** | **Triggers** — four gestures, a scroll clock, and the runtime that binds them | `scene.ts` (`Trigger` +4, `TriggerSpec.source`/`.suppresses`, `TRIGGERS` +4, `TriggerSource`, `DRAG_SLOP_PX`, `TimelineClock`, `TIMELINE_CLOCKS`, `MachineState.clock`), `machines.ts` (`MachineTable.settings`), `project.ts` (the clock in the state reader), `compile.ts` (`mclock/3`, the `mexitpast/2` narrowing, `CONTRACT`), `model.ts` (`ModelMachine.clocks`), `export.ts` (`scrollTimelineFor`, `MachineExport.scrolled`, the `--dc-tl-*` gate, two loss lines), `runtime.ts` (`TRIGGER_BINDINGS`, `bindDrag`, `observeViews`, `listen`, `start`), `Editor.tsx` (the drag recogniser), `Timeline.tsx` (**only** the clock select and the scrubber label), `runtime.test.ts`, `machineprogram.test.ts`, `spatialprogram.goldens.json` (regenerated under `runtime.ts:796–815`'s rule) | `values.ts`, `paint.ts`, `EASINGS`/`cssEasing`/`bezierOf` — step 3's, finished; `Transitions.tsx`'s easing row; `useMachinePlayback.ts` — stated as a result, not an omission; `machinecheck.ts` — `LADDER_CHECKS` does not grow; `stepIn`/`allows`/`fireIn`/`setIn`/`settle` — a trigger is a new way of *calling* `fire`, never a new thing inside the step function; `measure.ts`, `edits.ts`, `Inspector.tsx` |
| **5** | **Prototyping** — a link, a page id, an anchor, and present mode | **new `pages.ts` + tests**, `components.ts` (`componentIdOf` → `aspConstant`), `scene.ts` (`NodeLink`, `SceneNode.link`, `LINK_TRIGGERS`, `DEFAULT_LINK_TRIGGER`), `compile.ts` (the two facts, `CompileOptions.flow`, `LINK_RULES`, three `#show`s, one `#project`, `CONTRACT`), `model.ts` (`ModelNode.link`, `ModelScene.links`/`.goes`), `tree.ts` (`instanceAt`, moved), `edits.ts` (`setLink`), `export.ts` (the anchor, the `:where()` block, `LINK_RUNTIME`, `ExportOptions.pages`, three losses + the per-page font sentence), `runtime.ts` (`LINK_RUNTIME`, **and** the capture-phase swallow of §6.1 — a named five-line edit inside step 4's binder), app: **new `Present.tsx`**, `App.tsx` (the route), `Editor.tsx` (call `instanceAt`, lift the recogniser, the link outline), `Inspector.tsx` (the Link section), `LayerList.tsx`, `Pages.tsx`, `Studio.tsx` (the Present button, `pages`), `store.ts` (`renamePage`'s repoint, the re-exports), `ExportPanel.tsx` | `values.ts`, `paint.ts`, `PAINT`, `measure.ts`, `machines.ts`, `EASINGS`; `TRIGGERS` — **read only**, no new trigger, no new column; `MACHINE_RUNTIME`'s interpreter core; `why.ts`, `relax.ts`, `InfiniteCanvas.tsx` |

**Files nobody owns and nobody may touch:** `units.ts`, `components.ts` beyond
the one-line `componentIdOf` factoring, `derived.ts`, `explore.ts`, **`why.ts`**,
**`relax.ts`**, `annotate.ts`, `freedom.ts`, `machinecheck.ts`,
`packages/canvas/**` — **`InfiniteCanvas.tsx` in particular** —
`packages/canvas-core/**`, `packages/canvas-3d/**`, `packages/vfs/**`. `why.ts`
and `relax.ts` are in bold for the reason the last merge put them there: eleven
checks reach the unsat core, the explanation and the relaxation without one
character changing in either, and a step that finds itself editing one of them
has stopped building a feature.

---

## 5. The shared-spine edits

Five tables and four constants are written by more than one step. This section
says who adds what, in what order, so the second one extends rather than
rewrites.

### 5.1 `PROPS` and `PropName`

| step | adds | notes |
| --- | --- | --- |
| 1 Paint | `gradient`, `gradientFrom`, `gradientTo`, `blur`, `backdropBlur`, `mix`, and the optional `PropSpec.needs` column | appended after `align` and **before** the 3D block, so the comment that opens that block stays true. All six `styleable: true` (which grows `STYLE_PROPS` for free) and all six `inherited: false` (which leaves `DOCUMENT_BASE` untouched) |
| 2 Fonts | **nothing** | `fontStyle` is priced and refused in the spec, and this plan holds the refusal for its stated reason: it is cheap except for `MEASURED_PROPS`, which is the one part that touches the hard problem |
| 3 Easing | **nothing** | an easing is a `Transition`/`Keyframe` field, not a node property, and it must not become a `MotionProp` either — `motionMs` would return `0` for it |
| 4 Triggers | **nothing** | a clock is a field on a state |
| 5 Prototyping | **nothing** | a link is a field on a node beside `hidden` |

So `PROPS` has exactly one writer. The `needs` column has exactly one consumer
(`appearanceRow`) and one pair of users (`gradientFrom`, `gradientTo`); a later
step wanting a conditional row uses the column rather than inventing a second.

### 5.2 `ValueType` and `VALUE_TYPES`

| step | adds |
| --- | --- |
| 1 Paint | `gradient`, `mix`, and their two `VALUE_TYPES` rows. Neither is a `Quantity` |
| 2 Fonts | **nothing**. `SYSTEM_FONTS` is an alias for the shipped `FONTS`, and the project's own families are merged in the *app*, at `fontOptions` — a table that varies per project is a table `compile.ts`, `scene.ts`, `edits.ts` and four components would each have to be handed |
| 3 Easing | `easing`, its row, and the `EASINGS` block moving in from `scene.ts` |
| 4, 5 | nothing |

Consequence for prose: the motion spec counts "nine of the nineteen value types"
and calls `easing` "the tenth enumerated type". After step 1 it is eleven of
twenty-one, and `easing` is the twelfth enumerated type of twenty-two. **Step 3
fixes the arithmetic in the comment it copies from the spec**, or the comment is
wrong the day it lands.

The literal-bridge count is unaffected and stays checkable: six today
(`numeral`, `tally`, `word`, `millis`, `permille`, `mdeg`), paint adds none,
fonts adds none, and `bezier/5` in step 3 is **the seventh**. Any step that
believes it is adding the seventh has been beaten to it.

### 5.3 `EASINGS` and `Easing`

One writer: step 3, which grows the union from five to eight, names the entry
shape `EasingSpec`, adds the optional `SpringSpec`, moves the whole block to
`values.ts` and leaves a re-export behind. `DEFAULT_EASING` does **not** move —
changing it would re-pace every transition in every existing document. Step 4
must not add a "scroll" easing: what advances a timeline is a clock, and the two
are different questions asked of different records.

### 5.4 `TRIGGERS`, `Trigger` and `TriggerSpec`

| step | adds | notes |
| --- | --- | --- |
| 4 Triggers | four entries (`viewenter`, `viewleave`, `dragbegin`, `dragend`) and two columns (`source`, `suppresses`), plus `TriggerSource` and `DRAG_SLOP_PX` | `TRIGGER_NAMES` and `RuntimeLayer.edges` widen for free; `listen()` keys off `bindings[trigger].event` being non-empty, which is the whole reason `source` exists |
| 5 Prototyping | **nothing** — `LINK_TRIGGERS` is a *subset* and `TRIGGERS[g].event`/`.label` are read | and its essay is rewritten as three of twelve, refusing the four new words on the record — §8 |

`TriggerSpec.pair`'s doc comment is amended by step 4 (it currently says "where
the pair is what CSS understands", which was true of the six that shipped and is
narrower than the field means). Step 5 must not amend it again.

### 5.5 `PAINT` and `SVG_PAINT`

One writer: step 1, which changes `fill` from the `background` shorthand to
`backgroundColor` (the one edit in the whole plan that can break a working
picture), adds five entries, adds `blurFilter`, adds `mix` to `SVG_PAINT` and
adds the gradient flattening after `svgPaint`'s property loop. Step 2 is
explicitly forbidden `paint.ts`: `PAINT.fontFamily` stays a pass-through with no
scene in scope, because it is the one table shared by everything that paints and
its whole value is that a renderer looks nothing up.

### 5.6 The head stylesheet — four writers, one order

`export.ts`'s `const css: string[] = [BASE_CSS]` and `BASE_CSS` itself are
written by four of the five steps. The order inside the emitted file is fixed
here so nobody has to rediscover it:

1. **`@font-face` blocks** (step 2), unshifted before everything, so a face is
   declared before `.design` sets a family on anything.
2. **`@property --gfrom` / `--gto`** (step 1), inside `BASE_CSS` at the top.
   Global at-rules, so their position is legibility rather than correctness —
   but they are in `BASE_CSS` and not in the array because the canvas needs them
   too, from the same constant.
3. **`.design { isolation: isolate; … }`** (step 1) — a mix mode blends against
   the nearest isolation group and without one that group is the page the file
   was pasted into.
4. **`:root { --dc-ease-* }` and its `@supports`** (step 3), after the token
   custom properties and before the layer blocks.
5. **`:root { --dc-tl-* }` and its `@supports`** (step 4), beside them.
6. **`:where(.design a[data-node]) { … }`** (step 5), appended — §6.3.

Steps 3 and 4 use the same trick for the same structural reason —
`Declarations` is `Record<string,string>`, one key is one property, and a rule
split across an `@supports` boundary cannot live in that shape — and they must
say so once, in step 3, rather than twice.

### 5.7 `MEASURED_PROPS`

**Nobody grows it.** It is a whitelist and it is the input to `capAxes` and
`stateBudget`, so a new member changes the budget arithmetic and every test that
counts rows. Paint argues `blur` out (a `filter` does not change a layout box by
a hair); fonts argues `fontStyle` out (italic changes advance widths, which is
exactly the hard part, and it should not ride along). Both refusals are recorded
in §9 so a later step does not quietly reverse one.

### 5.8 `EXPORT_TARGETS`, `ExportOptions`, and the model records

- **`EXPORT_TARGETS.html.loses`** — step 2 *rewrites* the shipped "will re-wrap
  if a font is missing" sentence (it is now half wrong) and adds one; steps 3, 4
  and 5 append. The rewrite lands before the appends, which the ordering gives.
  Step 1 adds nothing here, deliberately: HTML carries all four paint features
  exactly.
- **`EXPORT_TARGETS.svg.loses`** — step 1 adds two (gradients flattened, blur
  dropped), step 2 adds one (no faces), step 5 adds one (links). Step 1 adds no
  sentence about mix modes because SVG carries them.
- **`ExportOptions`** — step 2 adds `fonts`, step 5 adds `pages`. Two optional
  maps and not one merged one, for the reason `assetPaths(scene, kind)` takes a
  kind: the panel knows which target is selected and the SVG target wants the
  pictures and none of the faces.
- **`MachineExport`** — step 3 adds `springs: Set<Easing>`, step 4 adds
  `scrolled: Set<string>`. Both are sets collected during the walk, never a scan
  afterwards.
- **`ModelMachine`** — step 3 adds `easing`, step 4 adds `clocks`.
  **`ModelNode`/`ModelScene`** — step 5 adds `link`, `links`, `goes`.

### 5.9 `Inspector.tsx`'s `appearanceRow` — the one function two steps edit

Unavoidable and therefore spelled out. Step 1 writes, as the first two lines of
the callback:

```ts
const needs = PROPS[prop].needs;
if (needs !== undefined && node.props[needs] === undefined) return null;
```

Step 2 adds `options={fontOptions(scene)}` to the `ValueEditor` the callback
returns, and touches nothing above it. Step 5 adds a **new section** above
Appearance and does not enter the callback at all. Step 1's guard is not applied
in the style-variant editor (`Inspector.tsx:1711`), which lists the same
properties for a variant: a variant has no `gradient` value to test unless it
sets one, and hiding a field a variant could legitimately fill would make a style
unable to say something a node can.

---

## 6. The interactions, and who owns each

### 6.1 A drag that ends, and a link that navigates anyway

**Owner: step 5, editing step 4's runtime. Neither spec saw it.**

Step 4's `dragend` carries `suppresses: "click"`, and the swallow is implemented
inside `listen()`: the machine's own click listener returns early once. That is
correct and complete *for a machine*. Step 5 then makes a linked node an
`<a href>` and emits **no script at all** for the common case, because an anchor
navigates on click natively and that is the whole reason for choosing an anchor.

So on a node that is both draggable and linked — which is the first thing anybody
builds with a drag: a card you can throw around and also open — the exported file
navigates on every drag. The studio does not, because `Editor.tsx` suppresses the
synthesised click before `linkAt` is ever consulted. **The two readers disagree,
in the artefact only, after a gesture**, which is the exact class of failure the
one-table-two-readers arrangement in `runtime.ts` exists to make impossible.

The fix is five lines, and it belongs to step 5 because step 5 is what makes it
necessary:

```js
// A gesture that ended swallows the click the browser sends after it — including
// the browser's own default action, which for an anchor is a navigation. In the
// CAPTURE phase and on the root, because a listener on the element runs after the
// anchor has already been asked to navigate, and because the same handler has to
// stop the machine's own click edge: "a drag is not also a click" is one sentence
// and it cannot be true for one reader and false for the other.
root.addEventListener("click", function (event) {
  if (!armed) return;
  armed = false;
  event.preventDefault();
  event.stopPropagation();
}, true);
```

with `armed` set by `endDrag` from `bindings.dragend.suppresses`, and
`listen()`'s own swallow clause **deleted** — it becomes dead the moment the
capture handler stops propagation, and two mechanisms for one sentence is how
they drift.

**The flag is not matched against a node id**, and that is a decision rather than
laziness: the anchor may be an *ancestor* of the part that was dragged (a linked
card containing a draggable handle) or a descendant of it, so identity matching
would let the navigation through in exactly the component case §3.3 of the
prototype spec is proudest of. At most one gesture is in flight and the flag is
consumed by the very next click, whatever it lands on, which is what "the click
the browser sends after a drag" means.

The studio's half of this already exists — step 4 has `Editor.tsx` read
`suppresses` off `TRIGGERS` — and step 5's Present overlay must do the same
(§6.6).

### 6.2 A presentation with no registrations and no faces

**Owner: step 5 for the calls, step 1 for the mount point. Neither spec saw it,
and both of its halves fail silently.**

The paint spec renders `<style>{CUSTOM_PROPERTY_RULES}</style>` "once at the
studio root in `Studio.tsx`". The fonts spec registers faces in
`useDocumentFonts(scene)`, called from `Studio.tsx`, and threads its `ready` set
into `measureScene`. Present mode is a **route**, `p/:id/present/:page`, and it
renders neither `Studio` nor `Editor`.

Two consequences, and the first is worse than it looks:

- **The `@property` registrations are absent, so `--gfrom` and `--gto` inherit.**
  The `var()` fallbacks inside every recipe mean a gradient still *paints*, which
  is exactly why this is invisible — but `diff()` writes `unset` for a
  declaration a state layer does not make, and `unset` on an inheriting custom
  property means *inherit*. So a machine state that stops repainting a gradient
  colour takes its parent's rather than the default's, and a keyframe on
  `--gfrom` snaps instead of tweening. A presentation would be the one place in
  the product where a gradient behaves differently, for a reason nobody could
  find.
- **No face is registered, so the presentation measures and paints in the
  fallback.** That is self-consistent — which is the fonts spec's whole §5.4
  claim and it holds — but it is not the design: the line breaks in a
  presentation would differ from the line breaks in the studio, for the same
  document, at the same moment.

**The fix, both halves cheap:**

1. **Step 1 mounts the registrations at `App.tsx`**, not `Studio.tsx`. `@property`
   is a global at-rule and the app root is the element that is mounted exactly
   once for every route. This overturns paint §5.1 and is the reason step 1 owns
   `App.tsx` at all.
2. **Step 5's `Present.tsx` calls `useDocumentFonts(scene)`** and passes `ready`
   to `measureScene(scene, ready)`, with the same `readyKey` memo `Studio.tsx`
   uses. One line and one dependency array, and without them a presentation is
   the tool's own artefact rendered wrong.

### 6.3 The link stylesheet outranks the design

**Owner: step 5. Inside one spec, invisible without the paint table in front of
you.**

The prototype spec appends

```css
.design a[data-node] { color: inherit; text-decoration: none; … }
```

with the comment "so putting a link on something never repaints it". It does the
opposite. `.design a[data-node]` is (0,2,1) — a class, a type and an attribute. A
node's own rule is a bare class, (0,1,0), and a style's class is wrapped in
`:where()`, which weighs nothing at all by design (`export.ts:1614`, and the
comment at 1732 that says exactly why). And `PAINT.ink` writes `color`. So a text
node that leads somewhere loses its `ink` to a neutraliser that was written to be
invisible.

**Resolved: the block is wrapped in `:where()`.**

```css
:where(.design a[data-node]) { color: inherit; text-decoration: none; -webkit-tap-highlight-color: transparent; }
```

Zero specificity beats the user agent anyway — author styles win over UA styles
regardless of weight — and loses to every node rule and every style class, which
is what "never repaints it" was trying to say. It is the same trick the style
classes already use, one selector over.

### 6.4 Paint's proof, restated so it survives

**Owner: step 1. Anticipated by nobody, because each spec was the last one.**

Paint's acceptance test 10 is: for every template, `compile(scene).program` is
byte-identical before and after the change. That is a claim about a git diff. It
is true the day paint lands and false from step 3 onward — `mdefease.` and eight
`measeopt/1` facts are emitted **always**, one `mclock/3` per state is emitted
**always**, and a `links` section joins every program — so the assertion would
either be deleted by a later step or, worse, weakened by one.

Two assertions replace it, and they say what paint actually claims:

- **`"paint adds no predicate"`** — the set of predicate names in
  `compile(t.create()).program` is equal for each template and for the same
  template with all six paint properties set on every node whose kind offers
  them. This is the standing assertion; it survives all four later steps, and it
  fails loudly if somebody ever adds a `gstop/4`.
- **`"paint changes no atom but its own literals"`** — the sorted set of atoms
  differs only in `alt/2`, `alt_literal/3`, `literal/2` and the bridges. Which is
  the same claim one grain finer, and is what makes "a gradient recipe carries no
  bridge at all" checkable.

The byte-identical form is kept as a **one-off** inside step 1's own commit,
captured before the first line and asserted after the last, and then deleted
rather than left to rot into a test somebody loosens.

### 6.5 Two projections, and the count that has to be proved

**Owner: step 3. The last merge's §8 arriving one feature over.**

`#project measing/3.` and `#project mkeasing/5.` refine the partition the solver
collapses answer sets by. A finer projection can only ever **split** universes,
never merge them — so the risk is not that the feature fails, it is that a
template's universe count moves and a test that has asserted a number since the
machine model shipped starts failing for a reason that looks like a bug.

It does not move: every easing in `templates/machine.ts` is a bare word that
migrates to a one-alternative `Value`, so every one of those variables has
exactly one alternative and the finer projection partitions nothing differently.
**That is a fact about today's templates and it must be re-checked rather than
assumed.** If a count does move, the two projections come out of step 3 and
become their own step with their own golden update, because the invariant that a
copy adds zero universes — and the tests that assert counts — outrank a feature.

The same gate covers `#project goes/1.` in step 5, where the prototype spec
already argues it is free (`goes/1` is functionally determined by `visible/1`,
which is projected, and by static `link/2` facts) and where its test 2f asserts
it directly.

Two other counting hazards, both benign and both worth naming so a failing
assertion is legible:

- **`compile(scene).variables` grows in step 3.** Every transition that stores an
  easing mints a one-alternative variable through `machineValues`. No universes,
  but any test asserting a *variable count* for a machine template moves, and
  `unreadVariables` must learn about `transition.easing` and `key.easing` or a
  `curve` token every transition points at is reported unread and greyed in the
  panel.
- **`spatialprogram.goldens.json` must not move in step 3 and will move in step
  4**, because `MACHINE_RUNTIME`'s text changes and the machine template's
  exported HTML contains it verbatim. `runtime.ts:796–815`'s rule applies and is
  not optional: regenerate only after proving that rolling the runtime text back
  reproduces the existing hashes for every universe. Anything weaker is
  indistinguishable from deleting the test.

### 6.6 What a presentation can and cannot demonstrate

**Owner: step 5, and two of the three answers are "nothing to build".**

- **A drag must work in Present.** The Present overlay hit-tests with
  `instanceAt` and `linkAt`; if it does not also recognise a drag, a machine
  whose whole point is a gesture does nothing in the presentation and everything
  in the file. So step 5 **lifts the slop recogniser out of `Editor.tsx`**
  alongside the `instanceUnder` → `instanceAt` move the spec already makes, and
  Present fires `dragbegin`/`dragend` against raw client coordinates using
  `DRAG_SLOP_PX` — and suppresses the following link with `suppresses` read off
  `TRIGGERS`, which is §6.1's studio half.
- **A view trigger fires in neither.** The canvas has no viewport to enter, which
  is the motion spec's own argument, and a presentation is a design **scaled to
  fit** — nothing ever scrolls, so nothing ever crosses. `viewenter`/`viewleave`
  are authored, exported, and played from the state strip in the studio; in
  Present they are inert. Recorded rather than fixed: firing them on a pan or a
  scale would make the studio disagree with the file about the one thing the two
  exist to agree on.
- **A scroll-clocked timeline shows its state's pose in Present**, animating
  nothing — which is *exactly* what a browser without `animation-timeline` shows
  in the exported file, and exactly what the motion spec argues is the honest
  degradation. The studio and the fallback file agree by construction. That is a
  result, and it is the strongest available evidence that the clock was put on
  the right record.

### 6.7 How the five exports compose

**Owner: whoever lands last in each file, which is why §5.6 fixes the order.**
They compose, and two of the compositions look like they should not.

- **A spring transition on a gradient's colour works with no new code.** Step 1
  registers `--gfrom` with a `<color>` syntax, which is what makes it
  interpolable at all; step 3 writes `var(--dc-ease-springSnappy)` as the timing
  function of the same shorthand. So "the card's sheen warms with a bouncy
  spring" is one `transition` declaration written by two steps that never met.
- **A gradient's *direction* still cuts**, because step 1 struck `backgroundImage`
  out of `tweenedKeys` and no curve changes that. The loss sentence step 1 writes
  is therefore still true after step 3, and step 3 must not add a second one
  claiming otherwise.
- **A linked node that also mixes and blurs** exports as an `<a>` carrying the
  same class and the same declarations a `<div>` would have; `mix-blend-mode` and
  `filter` apply to an anchor exactly as they apply to a div, and §6.3's
  `:where()` keeps the design's own colours on top.

### 6.8 A prototype carries its fonts N times

**Owner: step 5, as one sentence. Not fixable inside this plan, and saying so is
the fix.**

Step 2 inlines every used face into every exported HTML file, once per family, at
4/3 of the file's size. Step 5 makes a prototype a **folder of files that link to
each other** — one per page, each exported separately, each carrying its own
copy. Five pages and one variable `.ttf` is five and a half megabytes, and no
browser can share the faces between them because each `data:` URI is a separate
document's private bytes with no cache key.

There is no cheap fix: sharing the faces means an external `fonts/` directory,
which is the multi-file export that is out of scope (§9) and is a different
artefact. So step 5 adds one clause to `LINKED_LOST`, naming the number, in the
voice the fonts step already established:

> Each page carries its own copy of every font it uses, so a five-page prototype
> carrying one family is five copies of it. Nothing is fetched and nothing is
> shared; the files work offline and they are large.

---

## 7. Acceptance, per step

Colocated `*.test.ts`, `node --test` + `node:assert`, through the real solver
where the claim is about the program. Every step also carries the standing
invariant: **the universe count of every template is unchanged**, asserted, with
the two exceptions named in §6.5.

### Step 1 — Paint

Must exist, by name:

- `"a fill is a background colour, so a gradient can sit over it"` — the §4.1
  regression guard, on `PAINT.fill` and `SURFACE_BOX`. The single most important
  assertion in the step.
- `"a state that repaints the fill does not erase the gradient"` — the same
  regression driven end to end through a machine's hover state.
- `"paint adds no predicate"` and `"paint changes no atom but its own
  literals"` — §6.4.
- `"every mix mode is one word, so a rule can name it"` — `wordOf(o.value) ===
  o.value` for all twelve.
- `"a gradient paints even when only its direction is set"` and `"the two
  gradient colours are spelled once"` — the three-readers-one-source guard.
- `"a mix mode branches the space like any other value"` (2 universes) and
  `"a gradient's colour branches, and its direction does too"` (2 and 4).
- `"a backdrop blur goes on the box kinds, never on a stroked one"`,
  `"a gradient only goes where there is a box to paint it on"`, and `"a
  gradient's parts sit together, and after the fill"`.
- `"a blur changes no box"` and `"a blur does not widen what you can click"`.
- `"an SVG flattens a gradient rather than losing the shape"` — the guard against
  a black rectangle, which is the failure that is a wrong picture rather than a
  loss.
- `"a negative blur is clamped where it is read"`, `"the document isolates
  itself"`, `"an SVG keeps a mix mode"`, `"the SVG target says what it dropped"`.

**In a browser**: a rect's Appearance list shows a Gradient select, a Layer blur
length row and a Mix select; `[data-prop="gradientFrom"]` is **absent** until a
direction is chosen, appears afterwards, and does **not** disappear when the
direction is set back to None. A card with a gradient and a hover state that
changes only its fill keeps its sheen through the hover — which is the one bug a
test can miss and an eye cannot.

### Step 2 — Fonts

- `"the generated program is byte-identical with and without a font roster"`,
  `"declaring three fonts adds no universes"`, `"a font declaration mints no
  alt/2 and no pick/2"` — the invariant group, landed **first**, before anything
  can read the field.
- `"a family the host has not loaded is taken out of the stack, wherever it
  sits"` and `"a system family is never taken out, loaded or not"`.
- `"the same words in the same design get two different font strings before and
  after a face lands"` — the direct assertion that neither cache can serve a
  stale width, which is the whole of the hard part.
- `"a design that sets text in an imported font carries the face"`, `"a family
  the design declares and does not use is not in the file"`, `"a family used only
  in the second collapsed universe is still in the file"`.
- `"a face whose bytes the caller did not hand over is named, not silently
  absent"`, `"an SVG names the family and carries no face"`, `"a document with no
  imported fonts exports exactly what it exported before"`.
- `"a font that is not in the project is one note, whatever wears it"`.

**In a browser**, and this step cannot be finished without it: upload a font in
the Fonts panel and watch a text node's box **change size** — the face reaching
pretext's module-scope `OffscreenCanvas` through `document.fonts.add` is a
specification detail two layers from any code here, and if it is false the whole
of §5 is silently wrong. The e2e assertion is a width inequality against a
threshold with a deliberately chosen condensed or monospace fixture, never a
snapshot, or it passes vacuously.

### Step 3 — Easing

- `"a curve token with two alternatives is two designs"` — **the projection
  test.** It fails without `#project measing/3.`, and that line is the one which,
  if forgotten, silently deletes the feature.
- `"a keyframe's curve is a value and is projected"` — the same over
  `mkeasing/5`.
- `"springs add no universes"` and the §6.5 gate: every template's count is
  equal before and after the two projections.
- `"a custom bezier reaches the program as a term and never as a word"` and
  `"the seventh bridge costs a document with no curve in it nothing"`.
- `"bezierOf is exact or nothing"`, `"one default, two tables"`, `"every spring's
  checked-in linear() is what its physics gives"`, `"a sampled spring is pinned
  at both ends and never runs backwards in time"`.
- `"an easing stored as a bare word reads as a one-alternative value"` and `"an
  easing the menu has not got is kept rather than dropped"` — the migration.
- `"a spring exports as a custom property with a curve in front of it"` and `"a
  document with no spring emits neither block"` — the no-regression assertion.
- `"a rest/hover pair with a spring still collapses to :hover"` — a curve is not
  a trigger, and this is the promise worth protecting hardest.

**In a browser**: the Transitions panel's easing row varies, greys, pins and
takes a token like the three duration rows beside it; choosing Spring — bouncy
shows the settles-naturally line with a number; the canvas plays the spring.

### Step 4 — Triggers

- `"the agreement matrix still holds over twelve triggers"` — the `(state,
  trigger)` sweep, widened; `stepLayer` and the emitted text answer identically
  for every pair.
- `"the runtime still has no clock"` — the absence of `setTimeout`,
  `setInterval` and `requestAnimationFrame` over a text that now constructs an
  `IntersectionObserver`. **This guards the whole claim of the step.**
- `"a drag past the slop fires dragbegin exactly once"`, `"a drag under the slop
  is a click and never a drag"`, `"the click after a drag is swallowed exactly
  once"`, `"a pointercancel ends a drag that had begun"`.
- `"an element already in view gets viewenter after settle and not before"` and
  `"a view crossing that repeats the same answer fires nothing"`.
- `"four new triggers are four facts and no universes"`, `"every state has a
  clock, and the default is time"`, `"a clock is a word on a state, and a state
  with one mints the same copies"`, `"an exit time past a scroll-clocked timeline
  is not reported"`.
- `"a scroll-clocked timeline is a gated custom property and no script"` and `"a
  document with no clock and no gesture emits neither"`.

**In a browser**: dragging an instance in preview mode moves the machine and does
not select it; a drag shorter than the slop is a click.

### Step 5 — Prototyping

- `"a drag that ended does not follow the link"` — **§6.1, and it is the
  assertion this step exists to get right.** Drive the emitted runtime with a
  fake anchor: pointerdown, four pointermoves, pointerup, click — assert
  `preventDefault` was called and `location` did not change; then a plain click
  navigates.
- `"the link rule never repaints the design"` — §6.3. A text node with `ink` and
  a link: its `color` in the emitted CSS is the design's, and
  `:where(.design a[data-node])` appears exactly once.
- `"a presentation registers the same custom properties the studio does"` and
  `"a presentation measures in the faces it paints in"` — §6.2, asserted where
  they can be (the `<style>` is in the app root's markup; `Present` passes a
  `ready` set to `measureScene`) and **seen** in a browser where they cannot.
- `"adding a link adds no universes"` — with a link on a node, a second link, and
  a link inside a component definition placed twice: all N.
- `"a rule that hides the node takes the design's way out with it"` — `link/2`
  present, `goes/1` absent.
- `"a link inside a definition follows every instance"` — the copy rule, which is
  the whole argument for a link being a field.
- `pageIdOf`'s legality, injectivity and prefix separation from `componentIdOf`,
  and `"componentIdOf did not move"` against a frozen literal.
- `"a pointerenter link emits the script and a click link emits none"` — the
  absence assertion, in `runtime.test.ts`'s shape.
- `"a link whose page is gone exports as a box and says so"`, `"lost holds
  LINKED_LOST exactly once"`, `"the SVG target emits no anchor"`.
- `"renamePage repoints and deletePage dangles"`.
- `decodeDesign`/`encodeDesign` round-trip over keys holding commas and
  parentheses; `holdable` drops a stale variable and an out-of-range index.

**In a browser**, as a tail on the single existing Playwright walk: add a page,
link a node to it through the Inspector, press Present, follow the link, press
the browser's back button, and land on page one with the same design on screen —
which is the whole of the pins-in-the-address argument in one assertion. And no
console errors, as the rest of the walk asserts.

---

## 8. Decisions overturned, and disagreements settled

Twelve, each with what reversing it would cost.

1. **The `@property` registrations mount at `App.tsx`, not `Studio.tsx`.**
   Overturns paint §5.1. Present mode is a route and renders no studio; §6.2.
2. **The link rule is wrapped in `:where()`.** Overturns prototype §5.2's
   selector, which does the opposite of what its own comment claims; §6.3.
3. **The drag's click-swallow moves out of `listen()` and onto the root, in the
   capture phase, added by step 5.** Overturns motion §2.3.2's placement. Left
   where it was, a drag on a linked card navigates in the exported file; §6.1.
4. **Paint's byte-identical program test is replaced by two assertions about
   predicates and atoms.** Overturns paint's test 10 as a standing test; §6.4.
5. **`TimelineClock`'s `page` becomes `pageScroll`.** Overturns motion §2.4.2.
   `mclock(M,S,page)` and `page(P)` in one program is the `blend` collision the
   paint spec spent a page avoiding, arriving from the other side.
6. **`PROPS.blur.label` is "Layer blur".** Amends paint §3.3. `blur` is
   `Trigger`'s eighth member; §1.2.
7. **The export's missing-face sentence builder is `missingFaces`.** Settles the
   fonts spec against itself, where §3 and §7.2 both claim `missingFonts`.
8. **`optionLabel` takes four parameters.** Settles the fonts spec's own "either
   is fine", which is not a thing to leave to an implementer working in a
   component five callers share.
9. **`Present.tsx` recognises drags, by lifting step 4's recogniser.** Extends
   prototype §6.4, which lists only `instanceAt` and `linkAt`. Without it a
   gesture-driven design cannot be demonstrated in the mode built for
   demonstrating designs; §6.6.
10. **`LINK_TRIGGERS` is three of twelve, and the four new words are refused on
    the record.** Amends prototype §2.2, which reasons about eight. `viewenter`
    and `viewleave` fail the `load` objection with a delay — a page that
    navigates because something scrolled into view is a redirect with no human
    act in the loop; `dragbegin` and `dragend` are the pair §6.1 has to suppress,
    and offering them as link triggers would be shipping the collision as a
    feature.
11. **The Fonts panel's "In this project" group ships in step 2 rather than being
    deferred.** It is the only thing that makes the per-page roster survivable
    when a component instanced from another page names a family this page does
    not declare — a case fonts §4.3 identifies and answers only for the *label*.
12. **`spatialprogram.goldens.json` is regenerated in step 4 and in no other
    step.** Settles the two specs' golden claims against each other: the motion
    spec says Part One must not move it and Part Two will; paint, fonts and
    prototyping have no business moving it at all, and a step that finds it moved
    has changed something it did not mean to.

---

## 9. What is out of scope, with reasons

Each of these is the honest small feature chosen over the big one that fights the
model. They are listed together so that nobody re-derives one of them as a
follow-up without reading what it costs.

- **Multiple fills** (`paints?: Value[]`). `Value` is `Term[]` and the list
  already means *alternatives*; a second list with the opposite meaning at the
  same position would make `fill: [a, b]` mean "a over b" here and "a or b"
  everywhere else. The bill is `rendered/3` becoming `rendered/4` and every
  reader of it, plus `Style.variants[].parts`, `MachineState.parts[].props`,
  `Track.prop`, `PAINT`'s signature and a list-of-lists in the inspector. What is
  shipped instead — a colour under a gradient, plus a blend mode — is the
  overwhelming majority of what multi-fill is used for. Build it when somebody
  turns up with a design that needs three layers, with that design in hand.
- **Draggable gradient stops, three-stop gradients, `gradientAngle`,
  `background-blend-mode`, arbitrary CSS `filter`.** Each priced in paint §12.
  The angle is the one that was close, and it is out because the row would be
  live for a third of the menu and inert for the rest, and the inspector has no
  mechanism for a row that greys on another row's *value*.
- **A Google Fonts fetcher.** Local-first: a fetched family is a family a
  collaborator on a train does not have, and because measurement follows what is
  loaded, that is genuinely two different designs with two different answer sets.
  Upload is the whole feature, and it is also the point at which the designer,
  rather than the tool, makes the redistribution decision.
- **`font-variation-settings` as a property, and italic.** The first needs `PROPS`
  to vary per project, which is a change to the deepest table in the model, for
  the sake of `opsz`. The second is cheap except for `MEASURED_PROPS`, which is
  the one part that touches the hard problem; it should not ride along on the
  step that has to solve it.
- **Parameterised springs.** Four cumulative objections and any one is fatal: the
  parameters would have to be `Value`s (four universes differing only in damping,
  which the multiverse renders as four identical stills); the settle time is
  transcendental, so `mdur/3` would be underivable and
  `machine_exit_within_duration` would go silent on exactly the transitions most
  likely to be wrong. Three named springs are three table entries.
- **Scroll progress as a number input driving a 1D blend.** The premise does not
  hold: a 1D blend is a *selector* over whole timelines and returns no time, so
  wiring scroll to it gives a crossfade with a stopped clock. Parallax has one
  timeline and the scroll decides *where in it you are*, which is a clock — one
  optional word on a state, one fact, one export branch, and no change to
  `runtime.ts` at all.
- **`prefers-reduced-motion`.** Springs and scroll-linked motion are exactly what
  that query is about, and the honest version is document-wide — a media query is
  a universe axis, and `collapseSpace` and the breakpoint machinery already own
  that idea. A per-transition "and also this one is reduced" flag is the wrong
  shape at the wrong grain. It is the next rung and naming it is the most this
  plan should do.
- **A `Value`-typed link, a hotspot kind, a link as a little machine, "back" and
  "overlay" as targets, push/slide page transitions.** Each in prototype §12. The
  machine framing is the one worth repeating: eleven health rules and an
  interpreter are written about *states*, and a navigation has no state to arrive
  in.
- **Project-wide reachability in ASP.** One page's program grounds one page and
  knows only its own outgoing edges, so answering "is every page reachable" in
  the program means either putting every page's link graph into every page's
  program or solving all of them to draw a marker in a list. The per-universe
  half — the half only this tool can do — is `goes/1`; the project half is a walk
  of the documents. Two questions, two mechanisms, each where its data is.
- **Multi-file / folder export.** Genuinely valuable and genuinely a different
  artefact: a folder is a zip, a directory picker or a build step. The 90% is
  that `href="about-us.html"` is *already* the right string for that folder, so
  the day somebody writes the loop nothing about the emitter changes — and §6.8's
  loss sentence tells a person how to do it by hand until then.
- **A flow-graph panel.** A second canvas: a layout, a camera, drag-to-arrange
  and an ordering somebody has to store. The one sentence it gets asked to say is
  "no page links here", and that costs a hook and a dot.
- **Growing `MEASURED_PROPS`.** §5.7.

---

## 10. Review checklist for the merge itself

The four source specs' checklists all still apply in full. These are the
questions only the merge can be asked, and every one of them has a wrong answer
that looks like nothing at all.

1. On a node that is both draggable and linked, does the **exported file**
   navigate when a drag ends? §6.1. The studio will not, which is what makes this
   the one to check first.
2. Does a presentation carry the `@property` blocks and register the document's
   faces? §6.2. Both failures are invisible: the gradient still paints and the
   text still sets.
3. Does a linked text node keep its `ink`? §6.3.
4. Is paint's no-compiler-change claim asserted as a fact about predicates rather
   than as a fact about a diff? §6.4.
5. Did any template's universe count move when the two `#project` lines landed?
   §6.5. If it did, the projections come out and become their own step.
6. Does `grep 'page('` in the generated program find exactly one thing? §1.2.
7. Was `MEASURED_PROPS` grown by anybody? §5.7.
8. Did anything in `why.ts`, `relax.ts` or `packages/canvas/src/InfiniteCanvas.tsx`
   change? Nothing in this plan needs any of them.
9. Does the emitted runtime still contain no `setTimeout`, no `setInterval` and
   no `requestAnimationFrame`, over a text that now constructs an
   `IntersectionObserver` and a capture-phase click listener? Step 4's assertion,
   re-run after step 5 edits the same text.
10. Is a stub reported as a stub? A `Fonts.tsx` that lists files and cannot load
    one is scaffolding; a `Present.tsx` that renders an artboard and follows no
    link is scaffolding; calling either finished is the worst outcome available
    to this plan.
