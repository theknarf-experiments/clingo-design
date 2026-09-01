# The paint gap: gradients, blur, mix modes, and the fills there will not be

**Status: a design, not an amendment.** Nothing here contradicts
`docs/three-d-spec.md`, `docs/state-machines-spec.md` or `docs/rive-ladder-spec.md`;
it adds six entries to `PROPS`, two to `VALUE_TYPES`, seven to `PAINT`, one to
`SVG_PAINT`, one optional column to `PropSpec`, and **changes one existing
declaration** — which is the only edit in here that can break a picture that
works today, and §4.1 is entirely about it.

It touches `compile.ts` **not at all**, and §7 is the argument for why that is
the correct answer rather than an oversight.

---

## 0. The decision this turns on

> **Every one of these is an ordinary `PropName` holding an ordinary `Value`.**
> No new field on `SceneNode`, no list-valued property, no composite editor, no
> new variable shape in the program, no new `#show`. What makes them work is
> that CSS already composes a colour, an image, a filter and a blend mode on one
> box — so four independent one-property-to-declarations entries produce a
> layered result that no single property could.

Everything below is a consequence of that, and §9 is the place I recommend
*against* the one feature that would break it.

The four properties, and the one sentence each:

| Feature | How it lands | New shape? |
| --- | --- | --- |
| Gradient | `gradient` (a closed menu of CSS `background-image` recipes) + `gradientFrom` + `gradientTo` (two ordinary `color` Values) | none |
| Layer blur | `blur`, a `length` → `filter: blur(...)` | none |
| Backdrop blur | `backdropBlur`, a `length` → `backdrop-filter: blur(...)` | none |
| Blend mode | `mix`, a closed menu → `mix-blend-mode` | none |
| Multiple fills | **not built.** `fill` + `gradient` + `mix` is 90% of it; §9 | — |

---

## 1. How a gradient fits `Value` — and why the shadow precedent does *not* transfer

The brief asks whether a gradient follows `SHADOWS` (a whole CSS declaration as
one option value) or needs stops the inspector can drag. The honest answer is
**neither, and the reason the first one fails is specific and worth stating**,
because it looks like it ought to work.

`SHADOWS` reads:

```ts
const SHADOWS: ValueOption[] = [
	{ value: "none", label: "None" },
	{ value: "0 1px 2px rgba(15,23,42,0.10)", label: "Subtle" },
	...
];
```

with the essay above it: *"A shadow that is four coupled numbers is four rows in
the inspector and four ways to make something that looks wrong; every design
tool ships a ladder instead."*

That argument is airtight **because a shadow is colourless.** Every entry is
translucent slate at four opacities; it is the same shadow at four elevations,
and no design has ever needed a shadow made of its own brand colours. A frozen
ladder is therefore the whole of the feature.

A gradient is the exact opposite. A gradient is *made of the design's colours*.
A frozen roster of gradient strings would be a roster of somebody else's palette
— it could not name a `color` token, could not branch on one, could not follow a
style variant, could not be repainted by a machine state, and could not appear
in the unsat core as the colour it is. Every single thing this document model is
*for* would be switched off for the one property where a designer most wants it.
A `gradient` ValueType whose literal is a complete CSS string is a dead end and
should not be built.

Stops the inspector can drag is the other end, and it is expensive in a specific
way: it is not a bigger property, it is a **different shape**. A stop list is
`{ color: Value; at: Value }[]`, and `props` is
`Partial<Record<PropName, Value>>`. It would need a field on `SceneNode` beside
`points` and `guides`, a sub-editor in the inspector, its own emission in
`compile.ts` (`gstop/4` or similar) with its own `#show`, its own reading in
`model.ts`, its own shape in `Style.variants[].parts` (which is
`Partial<Record<PropName, Term>>` — one term per property, singular), its own
shape in `MachineState.parts[].props`, and its own kind of `Track`. That is the
same bill §9 refuses to pay for multiple fills, for the same reason.

### 1.1 The answer: a gradient is three ordinary properties

Split the gradient along the seam CSS already has. The **shape and direction**
is a closed menu — genuinely enumerable, genuinely colour-free, and exactly the
kind of thing `SHADOWS` and `FITS` are. The **two colours** are two ordinary
`color` properties. They are joined by two CSS custom properties, which the
recipe strings name and the colour properties write:

```
background-image: linear-gradient(180deg, var(--gfrom, #ffffff), var(--gto, #94a3b8));
--gfrom: var(--brand);
--gto: #0f172a;
```

Everything falls out of that:

- **A gradient stop can be a token.** `gradientFrom: ref("brand")` reaches the
  export as `--gfrom: var(--brand)`, which is the design system in the file
  rather than a number that used to be one.
- **A gradient branches the space.** `gradientTo: [lit("#0f172a"), lit("#7c3aed")]`
  is two designs, counted and explored exactly as two fills are, with no new
  code anywhere.
- **A style can own it.** `gradient` and both colours are `styleable`, so "the
  cards all have the brand sheen" is one style with three fields.
- **A machine state can repaint it**, a keyframe track can animate it, and — see
  §5.2 — the colours genuinely *tween*, because the custom properties are
  registered with a `<color>` syntax.
- **`PAINT` stays one entry per property.** Four callers share that shape
  (`paintOf`, `declarationsFor`, `classRule`, `svgPaint`, plus `tweenedKeys` and
  the `@keyframes` writer, which is six); a composite would have had to change
  all of them.

The cost, stated plainly: **two stops, not N, and no draggable midpoint.** A
three-stop gradient is not expressible. I think that is right for a first
version and §13 says what the third stop would cost.

---

## 2. `values.ts` — two new types

### 2.1 `ValueType`

```ts
export type ValueType =
	| "color"
	| "length"
	| "number"
	| "count"
	| "duration"
	| "angle"
	| "weight"
	| "font"
	| "align"
	| "shadow"
	| "text"
	| "direction"
	| "placement"
	| "justify"
	| "sizing"
	| "fit"
	| "growth"
	| "solid"
	| "lamp"
	| "gradient"
	| "mix";
```

Neither is a {@link Quantity}: a gradient recipe is a CSS string and a mix mode
is a word, and neither has a reader that turns it into a number. The literal
bridges are untouched — see §7.

### 2.2 The two ends of a gradient, named once

```ts
/**
 * What a gradient is made of when nobody has said.
 *
 * Exported and named rather than typed out, because the same pair of colours has
 * to be spelled in three places that cannot be allowed to disagree: the `var()`
 * fallbacks inside every recipe in {@link GRADIENTS}, the `fallback` of
 * `PROPS.gradientFrom` and `PROPS.gradientTo` — which is what the inspector row
 * shows before anybody types — and the `initial-value` of the registered custom
 * properties in `CUSTOM_PROPERTY_RULES`. Three copies of `#ffffff` is a design
 * where the row says one colour and the box paints another, and nothing about
 * that failure looks like a bug: it looks like the picture.
 *
 * White to slate, because a gradient a designer has only chosen the *direction*
 * of should read as a gradient at a glance — a pair that differed by a hair
 * would look like a rendering fault, and a pair that differed by a hue would be
 * an opinion about somebody's palette.
 */
export const GRADIENT_FROM = "#ffffff";
export const GRADIENT_TO = "#94a3b8";

/** Both ends, as the two `var()`s every recipe below shares. */
const STOPS = `var(--gfrom, ${GRADIENT_FROM}), var(--gto, ${GRADIENT_TO})`;
```

The `var()` fallback is doubled with the `@property` `initial-value` of §4.3 on
purpose, and neither half is redundant: the registration is what makes the
custom property non-inheriting and animatable, and the inline fallback is what
paints a gradient in a reader that has not got `@property`. Belt, and braces,
and they hold different things up.

### 2.3 `GRADIENTS`

```ts
/**
 * A direction, not a picture.
 *
 * This is the half of a gradient that genuinely *is* a closed menu, and
 * separating it from the half that is not is the whole design. Which way a
 * gradient runs is a small, finite, colour-free decision — the same kind of
 * thing `FITS` and `PLACEMENTS` are — while what colours it runs between is the
 * design's own palette, and belongs to two `color` properties that can name a
 * token. A roster of complete gradient strings would have been the `SHADOWS`
 * move, and it fails here for the reason it succeeds there: a shadow is
 * colourless and a gradient is nothing *but* colour.
 *
 * Every entry names both `--gfrom` and `--gto` with a literal fallback, so a
 * node that has chosen a direction and nothing else still paints a gradient
 * rather than nothing at all. A missing custom property makes the whole
 * declaration invalid at computed-value time, which in CSS means the gradient
 * silently disappears — the exact failure a `var()` fallback exists to prevent,
 * and the one a test in §11 pins.
 *
 * `none` first and as the fallback, unlike `SHADOWS`, whose fallback is its
 * second entry: a shadow is an elevation and "no shadow" is a rung on that
 * ladder, while a gradient is a flourish and the great majority of boxes do not
 * want one. A new alternative on this row should start at "no gradient".
 */
const GRADIENTS: ValueOption[] = [
	{ value: "none", label: "None" },
	{ value: `linear-gradient(180deg, ${STOPS})`, label: "Linear, down" },
	{ value: `linear-gradient(0deg, ${STOPS})`, label: "Linear, up" },
	{ value: `linear-gradient(90deg, ${STOPS})`, label: "Linear, right" },
	{ value: `linear-gradient(135deg, ${STOPS})`, label: "Linear, down and right" },
	{ value: `radial-gradient(circle at 50% 50%, ${STOPS})`, label: "Radial, from the centre" },
	{ value: `radial-gradient(circle at 0% 0%, ${STOPS})`, label: "Radial, from the corner" },
	{ value: `conic-gradient(from 180deg at 50% 50%, ${STOPS})`, label: "Conic" },
];
```

Seven directions and a `none`. Rejected: an eighth `gradientAngle` property so
the angle could name an `angle` token — see §12.3, it is the best of the things
left out and it is left out for a concrete reason.

### 2.4 `MIXES`

```ts
/**
 * How a layer's colours meet what is behind it — CSS `mix-blend-mode`.
 *
 * **Every value here is one lower-case word, and that is a constraint rather
 * than a coincidence.** `wordOf` accepts `/^[a-z][A-Za-z0-9_]*$/` and nothing
 * else, so a value with a dash in it reaches the program as a quoted string and
 * emits no `word/2` beside it. That is perfectly legal — a colour and a shadow
 * are exactly that — but it would make this the first *enumerated* roster in the
 * file where half the entries carry a word and half do not, and a rule that
 * reads `word(L,multiply)` and finds nothing for `soft-light` is a rule that is
 * right about eight modes and quietly wrong about four.
 *
 * So the four CSS modes whose names are hyphenated — `color-dodge`,
 * `color-burn`, `hard-light` and `soft-light` — are **out**, and this is the one
 * place in this design where something real is given up. Soft light in
 * particular is a mode designers reach for. Two things make it bearable: a
 * curated roster is what this file already does everywhere (four font stacks out
 * of thousands, five elevations out of infinity), and the alternative — storing
 * `softLight` and translating it in `PAINT` the way `fit` translates `stretch`
 * to `fill` — buys the four modes at the price of the rule that an enumerated
 * value *is* the CSS it paints with, which is what makes an enumerated type cost
 * the renderer nothing. Four modes is a cheaper thing to lose than that rule.
 *
 * `normal` first and as the fallback, because it is CSS's initial value: a row
 * that has never been touched must mean "composite the ordinary way".
 */
const MIXES: ValueOption[] = [
	{ value: "normal", label: "Normal" },
	{ value: "multiply", label: "Multiply" },
	{ value: "screen", label: "Screen" },
	{ value: "overlay", label: "Overlay" },
	{ value: "darken", label: "Darken" },
	{ value: "lighten", label: "Lighten" },
	{ value: "difference", label: "Difference" },
	{ value: "exclusion", label: "Exclusion" },
	{ value: "hue", label: "Hue" },
	{ value: "saturation", label: "Saturation" },
	{ value: "color", label: "Colour" },
	{ value: "luminosity", label: "Luminosity" },
];
```

### 2.5 `VALUE_TYPES`

```ts
	gradient: { label: "Gradient", fallback: GRADIENTS[0].value, options: GRADIENTS },
	mix: { label: "Mix", fallback: MIXES[0].value, options: MIXES },
```

---

## 3. `scene.ts` — six properties and one optional column

### 3.1 `PropName`

Six new members, appended after `align` and before the 3D block, so the
existing comment (*"From here down: the properties of a thing in three
dimensions"*) stays true:

```ts
	| "lineHeight"
	| "align"
	// The paint layer above a fill. Four features, six names, and every one of
	// them an ordinary property holding an ordinary Value — see
	// `docs/framer-paint-spec.md`. `mix` is deliberately not called `blend`:
	// `Blend`, `BlendKind`, `BLEND_KINDS` and `mblend/3` are the machine model's
	// mixing of *timelines*, and one word for two unrelated things is a word
	// that stops meaning either.
	| "gradient"
	| "gradientFrom"
	| "gradientTo"
	| "blur"
	| "backdropBlur"
	| "mix"
	// From here down: the properties of a thing in three dimensions ...
	| "solid"
```

**On the name.** `blend` is taken three times over — `Blend`, `BlendKind`,
`BLEND_KINDS`, `BlendStop`, `mblend/3`, `mblendin/3` — and all of them are about
a state mixing several timelines by a number input. `mix` is the name here, in
all three places the brief asks about:

- **In the types**: `PropName` `"mix"`, `ValueType` `"mix"`, `VALUE_TYPES.mix`.
  Nothing in `machines.ts` or the machine half of `scene.ts` uses the token
  `mix`, so a grep for it lands only on this feature.
- **In ASP**: the variable is `prop(n1,mix)` and the fact is
  `rendered(n1,mix,l7)`. `mblend(M,S,oneD)` and `rendered(N,mix,L)` cannot be
  confused by a reader or by a grounder.
- **In the UI**: the row is labelled **"Mix"**, and the machine panel's row stays
  "Blend". A designer who knows the phrase "blend mode" will find it under Mix in
  the Appearance list next to Opacity, which is where it lives in every tool;
  what they will never do is find two rows called Blend that mean different
  things.

Rejected names: `blendMode` (still the taken word, and the machine panel would
have "Blend" and "Blend mode" three inches apart), `composite` (the correct
graphics term and nobody's design vocabulary), `over` (cute, meaningless).

### 3.2 `PropSpec` gains one optional column

```ts
	/**
	 * The property this one is a detail of: the inspector shows this row only
	 * when the node holds a value for that one.
	 *
	 * **Optional, unlike {@link styleable} and {@link inherited}, and the
	 * asymmetry is the point.** Those two are required because every property has
	 * an answer and a missing one is a decision nobody made. This one has a
	 * default that *is* an answer — a property that stands on its own stands on
	 * its own — so absent means something, and forcing twenty-odd entries to say
	 * `needs: undefined` would be noise that taught nothing.
	 *
	 * It exists for one shape and says so: `gradientFrom` and `gradientTo` are
	 * two colours that paint nothing at all until a direction has been chosen,
	 * and a rect's Appearance list is twelve rows long without them being two of
	 * the twelve on every box ever drawn.
	 *
	 * **A claim about the inspector's layout and nothing else.** The value stays
	 * in the document when the row goes away, a style may still decide it, a
	 * machine state may still repaint it, a rule may still name it, and the
	 * exporter still writes it. A hidden row is a row not shown, not a property
	 * switched off — which is why the test is "does the node hold a value for
	 * `needs`" rather than "does that value resolve to something": a designer
	 * flipping between directions and `none` must not have the two colour rows
	 * blink out from under the cursor.
	 */
	needs?: PropName;
```

### 3.3 `PROPS` — the six entries

```ts
	/**
	 * Which way a gradient runs, as the whole `background-image` it becomes.
	 *
	 * The direction is a closed menu and the colours are two properties of their
	 * own, which is the split the whole feature turns on — see §1 of
	 * `docs/framer-paint-spec.md`. A roster of complete gradient strings, the way
	 * `shadow` is a roster of complete declarations, would have frozen somebody
	 * else's palette into the menu: a gradient is made of the design's own
	 * colours, and a `shadow` is not made of anything.
	 *
	 * `styleable` because a gradient is treatment in the plainest sense — "the
	 * cards all carry the brand sheen" is one decision several nodes wear, and it
	 * is precisely a style's job to hold it. `inherited` false because
	 * `background-image` does not inherit in CSS, so a node that says nothing
	 * about it takes nothing from its surroundings and the document has no
	 * obligation to declare it. (The two custom properties it *reads* are a
	 * different question, answered on `gradientFrom` below.)
	 */
	gradient: {
		label: "Gradient",
		type: "gradient",
		fallback: VALUE_TYPES.gradient.fallback,
		styleable: true,
		inherited: false,
	},
	/**
	 * The colour a gradient starts from, and the colour it ends at.
	 *
	 * Ordinary `color` properties, which is the entire point: they take a token,
	 * they hold alternatives, they follow a style variant, a state repaints them
	 * and a keyframe tweens them, and none of that needed a line of new code.
	 * What they paint is a *custom property* rather than a declaration —
	 * `--gfrom` and `--gto`, which the recipes in `GRADIENTS` name — because CSS
	 * has no way to say "the second colour of the background image" and this is
	 * the way it has instead.
	 *
	 * `styleable` for {@link gradient}'s reason. `inherited` **false**, and this
	 * is the one entry in the table where that claim needed something built to
	 * make it true: an *unregistered* custom property inherits, so `--gfrom` set
	 * on a frame would silently become the starting colour of every gradient
	 * inside it, and `unset` in a state layer would resolve to the parent's
	 * colour rather than to the default. `CUSTOM_PROPERTY_RULES` in `paint.ts`
	 * registers both with `inherits: false`, which makes this column honest and
	 * — a second win, and the reason the registration is worth its four lines —
	 * makes the two colours *animatable*, since only a registered custom property
	 * with a `<color>` syntax can be interpolated by a transition or a keyframe.
	 *
	 * The fallbacks are `GRADIENT_FROM` and `GRADIENT_TO`, which are the same two
	 * constants the recipes and the registrations use. Three spellings of white
	 * would be an inspector row that shows one colour beside a box that paints
	 * another.
	 */
	gradientFrom: {
		label: "Gradient from",
		type: "color",
		fallback: GRADIENT_FROM,
		styleable: true,
		inherited: false,
		needs: "gradient",
	},
	gradientTo: {
		label: "Gradient to",
		type: "color",
		fallback: GRADIENT_TO,
		styleable: true,
		inherited: false,
		needs: "gradient",
	},
	/**
	 * How far the node's own pixels are smeared — the CSS `filter`.
	 *
	 * A `length`, so it is EMU like every other one: written with
	 * {@link writeLength}, read with `emuOf`, shown in the document's unit by the
	 * one `LengthInput`, and reaching the program as a `numeral/2` in EMU so a
	 * rule can say a blur is at most eight pixels. A bare `number` was the
	 * tempting alternative and is wrong: a blur radius is a distance on the page,
	 * it should follow a `length` token beside a gap and a radius, and a document
	 * measured in millimetres should read it out in millimetres.
	 *
	 * It blurs the node **and everything inside it**, because that is what a CSS
	 * filter does, and it is also what a designer means by "blur this card". A
	 * frame is the unit of "blur these things together"; a group is not, because
	 * a group holds no properties at all (§10.3).
	 *
	 * `styleable`: a frosted treatment is a treatment. `inherited` false: `filter`
	 * does not inherit — it applies to the subtree by *painting* it, which is a
	 * different mechanism and not one `DOCUMENT_BASE` has anything to say about.
	 *
	 * Clamped at zero where it is read, not here, for the reason `roughness` is:
	 * see `blurFilter` in `paint.ts`, which is the one place both renderers cross.
	 */
	blur: {
		label: "Blur",
		type: "length",
		fallback: pxLength(8),
		styleable: true,
		inherited: false,
	},
	/**
	 * How far *what is behind* the node is smeared — `backdrop-filter`, and the
	 * whole of frosted glass.
	 *
	 * A separate property rather than a mode of {@link blur}, because they are two
	 * CSS properties that compose: a card can blur its own contents *and* the
	 * page behind it, and a boolean beside one number could not say that. They are
	 * also offered on different kinds — see §3.4 — and a mode would have had to
	 * be offered wherever either was legal.
	 *
	 * It shows nothing at all through an opaque node, which is a fact about CSS
	 * and not a fault: something has to be see-through for there to be a backdrop.
	 * Left as a fact rather than papered over with an automatic transparency,
	 * because inventing an opacity nobody asked for is how a design tool starts
	 * lying about the document.
	 *
	 * `styleable` and `inherited` as {@link blur}.
	 */
	backdropBlur: {
		label: "Backdrop blur",
		type: "length",
		fallback: pxLength(12),
		styleable: true,
		inherited: false,
	},
	/**
	 * How this node's colours meet what is painted behind it — `mix-blend-mode`.
	 *
	 * **Not `blend`.** `Blend`, `BlendKind`, `BLEND_KINDS` and `mblend/3` are the
	 * machine model's mixing of timelines, and they were here first; one word for
	 * two unrelated things is a word that stops meaning either. See §3.1.
	 *
	 * `styleable` **true**, and the interesting comparison is with `opacity`,
	 * which is not. The note on {@link PropSpec.styleable} rules `opacity` out
	 * because it is "a state a node is *in* rather than part of how it is drawn:
	 * a faded copy of a heading is the same treatment at half strength, and a
	 * style that owned it would have to be duplicated to say so." A mix mode
	 * fails that test in both halves. It is not a strength — there is no half a
	 * multiply — so no style ever has to be duplicated for it; and "these chips
	 * all multiply over whatever they sit on" is one sentence about how a family
	 * of things is drawn, which is a style's definition.
	 *
	 * `inherited` false: `mix-blend-mode` does not inherit. What it *does* is form
	 * a stacking context and blend within its isolation group, which is why both
	 * renderers isolate the document — see §5.1.
	 */
	mix: {
		label: "Mix",
		type: "mix",
		fallback: VALUE_TYPES.mix.fallback,
		styleable: true,
		inherited: false,
	},
```

Note that `styleable: true` on all six adds them to `STYLE_PROPS` with no other
change, and `inherited: false` on all six means `DOCUMENT_BASE` is untouched and
the test that walks the inherited properties keeps passing unaltered. That test
is the reason the `inherited` claim on `gradientFrom` had to be *made* true
rather than merely asserted: had it been `true`, the test would have demanded
`--gfrom` in `DOCUMENT_BASE`, which would declare it at the root and do nothing
whatsoever about a frame leaking its gradient colour into a rect inside it.

### 3.4 `KINDS` — which kinds get which, and where in the list

The ordering rule, and it is load-bearing rather than tidy: **`gradient` and its
two colours come immediately after `fill`.** `Declarations` is a plain object and
`cssText` writes it in insertion order, and every walk that builds one iterates
`KINDS[kind].props` — so the props order *is* the declaration order in both
renderers. §4.1 removes the shorthand hazard that made this a correctness
question; it stays a legibility one, and a test pins it.

```ts
	frame: {
		props: [
			"fill", "gradient", "gradientFrom", "gradientTo",
			"radius", "stroke", "strokeWidth", "shadow",
			"blur", "backdropBlur", "mix", "opacity",
			"perspective",
		],
	},
	rect: {
		props: [
			"fill", "gradient", "gradientFrom", "gradientTo",
			"radius", "stroke", "strokeWidth", "shadow",
			"blur", "backdropBlur", "mix", "opacity",
		],
	},
	ellipse: {
		props: [
			"fill", "gradient", "gradientFrom", "gradientTo",
			"stroke", "strokeWidth", "shadow",
			"blur", "backdropBlur", "mix", "opacity",
		],
	},
	line:  { props: ["stroke", "strokeWidth", "blur", "mix", "opacity"] },
	arrow: { props: ["stroke", "strokeWidth", "blur", "mix", "opacity"] },
	path:  { props: ["fill", "stroke", "strokeWidth", "blur", "mix", "opacity"] },
	text:  { props: [..., "align", "blur", "mix", "opacity"] },
	image: { props: ["fit", "radius", "blur", "mix", "opacity"] },
```

Nothing else changes: `viewport`, `mesh`, `model`, `camera`, `light`, `group` and
`instance` are untouched. `defaults` gains nothing for any of the six — a
property missing from `defaults` "paints nothing until it is set, which is what
an optional flourish like a stroke or a shadow should do", and every one of these
is a flourish.

The three exclusions, each argued, because each is the kind of thing that looks
like an oversight:

**No `backdropBlur` on a stroked or plotted or texty kind** (`line`, `arrow`,
`path`, `text`, `image`). This is the shadow argument, exactly, and there is
already a test asserting it for `shadow`: `backdrop-filter` blurs the backdrop of
the element's **box**, and for a diagonal, a polygon or a paragraph the box is
only the rectangle the ink happens to span. A frosted rectangle behind a diagonal
line is a shape the document does not contain. On an `image` it is worse than
wrong, it is invisible: the picture is opaque and covers its own backdrop.

**But `blur` is offered on all of them**, and the difference is real rather than
a compromise. `filter: blur()` smears *the pixels the element painted* — the
stroke, the glyphs, the photograph — so a blurred diagonal is a blurred diagonal.
The two properties differ in exactly the way `shadow` and `opacity` differ, and
they are split along the same line.

**No `gradient` on `line`, `arrow`, `path`, `text`, `image` or `viewport`.** Four
separate reasons and they happen to agree:
- `line`, `arrow` and `path` paint through `SHAPE_PAINT`, whose `path` entry
  redirects `fill` onto the SVG shape (`fill: (value) => ({ fill: value })`).
  `background-image` on the box would paint a rectangle behind a polygon.
- `text` would need `background-clip: text` and a transparent `color`, which is
  two more declarations and a third property to switch them on, and which breaks
  the moment anything selects the text.
- `image` draws an `<img>` filling its box; a gradient under it is invisible.
- `viewport` already spends `background-image` on the poster the export writes
  for it (`posterFor`), and two writers for one declaration is a picture decided
  by iteration order.

**No `mix` or `blur` on `viewport`, `mesh`, `model`, `camera` or `light`.** The
three-dimensional kinds paint through `canvas-3d` and three.js materials, not
through `PAINT`; `blur` and `mix` are CSS words with no reading there, and a row
that changes nothing is worse than no row. `viewport` is the near miss: `mix` on
one has a meaning in the HTML export and none on the canvas, which draws a live
WebGL canvas, and none in SVG, which draws an empty rectangle. A control that
changes the file and not the picture is the thing `EXPORT_TARGETS` exists to stop
multiplying, so the seam stays where §0 of `three-d-spec.md` put it.

---

## 4. `paint.ts` — the table, and the one edit that can break something

### 4.1 `fill` becomes `background-color`

This is the load-bearing change and it is one word.

```ts
	fill: (value) => ({ background: value }),        // today
	fill: (value) => ({ backgroundColor: value }),   // required
```

`background` is a **shorthand**, and a shorthand resets every longhand it covers,
`background-image` among them. Today that is harmless because nothing else writes
`background-image` on an ordinary node. With a gradient it is a live bug in three
places, and only the first of them is fixed by ordering:

1. `paintOf` and `declarationsFor` walk `KINDS[kind].props` in order, so
   `background` lands before `background-image` and the gradient survives — but
   only because of a list's order, which is exactly the kind of invariant that
   holds until somebody sorts the list.
2. **`copyPaint` and `diff` are not fixable by ordering.** A machine state that
   repaints *only* the fill produces a state rule containing the single
   declaration `background: #1d4ed8;`. It cascades after the base rule, and it
   erases the base rule's gradient. The card has a sheen; you hover it; the sheen
   vanishes and comes back on the way out. Nothing about that reads as a bug in
   the shorthand.
3. `classRule` has the same problem the moment a style decides a fill and a node
   decides a gradient.

`background-color` is a longhand. It never touches `background-image`, the state
layer composes the way a reader expects, and `transition: background-color` is
what the browser actually wants to interpolate. There is no case where the
shorthand was buying anything: no `PAINT` entry ever set a background position, a
repeat or a size.

`SURFACE_BOX` changes with it, for the same reason and one more — a surface's
ground has to sit *under* a gradient rather than reset it:

```ts
export const SURFACE_BOX: Declarations = {
	backgroundColor: "#ffffff",
	overflow: "hidden",
};
```

**This changes exported bytes**, and about a dozen existing assertions in
`export.test.ts` read `background: …` (lines 236, 247, 718, 719, 739, 1327, 1366,
1722, 1859, 2322 and the ordering assertion at 2365). Every one of them becomes
`background-color: …`. That is expected and is not a licence to loosen them: the
ordering assertion at 2365 — `background` before `background-image` on a viewport
poster — should stay exactly as strict, now reading `background-color`.

### 4.2 The table

```ts
export const PAINT: Partial<Record<PropName, (value: string) => Declarations>> = {
	fill: (value) => ({ backgroundColor: value }),
	// The gradient's three halves. `background-image` over the fill's
	// `background-color` is CSS's own layering and is the whole of "two fills"
	// this tool offers — see §9 of docs/framer-paint-spec.md, which recommends
	// against the general case and says what this buys instead.
	gradient: (value) => ({ backgroundImage: value }),
	// A custom property, because CSS has no name for "the second colour of the
	// background image". `cssName` already leaves a `--custom` alone, and React
	// already writes one out of a style object, so this needed nothing built.
	gradientFrom: (value) => ({ "--gfrom": value }),
	gradientTo: (value) => ({ "--gto": value }),
	radius: (value) => ({ borderRadius: value }),
	stroke: (value) => ({ borderColor: value, borderStyle: "solid" }),
	strokeWidth: (value) => ({ borderWidth: value, borderStyle: "solid" }),
	shadow: (value) => ({ boxShadow: value }),
	// The two blurs. The clamp is here rather than at the two call sites for
	// `roughness`' reason: two clamps is two answers, and only one of them can be
	// checked headless.
	blur: (value) => ({ filter: `blur(${blurFilter(value)})` }),
	backdropBlur: (value) => ({ backdropFilter: `blur(${blurFilter(value)})` }),
	mix: (value) => ({ mixBlendMode: value }),
	opacity: (value) => ({ opacity: value }),
	ink: (value) => ({ color: value }),
	...
};
```

and the clamp:

```ts
/**
 * A blur radius on its way into a filter function, never negative.
 *
 * `blur(-4px)` is not a CSS length the function accepts, and an unparsable
 * argument invalidates the *whole* declaration — so a designer who typed a minus
 * sign would lose the blur rather than get none of it, which are different
 * pictures and only one of them is explicable. Clamping to zero says "no blur",
 * which is what a negative radius means if it means anything.
 *
 * It arrives here already through {@link cssValue}, so it is pixels or it is a
 * `var()`. A `var()` is passed through untouched and deliberately: what a token
 * holds is not known here, it is resolved by the browser at computed-value time,
 * and a wrapper that tried to guard it would have to invent a second
 * substitution engine. A `length` token holding a negative number costs exactly
 * this one declaration, in one node, and nothing else.
 *
 * The empty string is a fourth caller and not a mistake: `tweenedKeys` calls
 * every paint function with `""` purely to read back which CSS keys it writes,
 * and `blur()` is a perfectly good nonsense value to throw away.
 */
const blurFilter = (value: string): string => {
	if (value.startsWith("var(")) return value;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) && n < 0 ? "0px" : value;
};
```

`cssValue` needs no change: `isLengthType("length")` is already true, so `blur`
and `backdropBlur` cross from EMU to pixels through the same one function every
other length does. `gradient` and `mix` are not length types and pass through as
themselves, exactly as `shadow` and `font` do.

### 4.3 The registrations

```ts
/**
 * The two custom properties a gradient is made of, registered.
 *
 * Three things follow from `@property` and every one of them is load-bearing:
 *
 *   - **`inherits: false`.** An unregistered custom property inherits, which
 *     would make a frame's gradient colour the starting colour of every gradient
 *     inside it — a leak with no symptom, since the picture would simply be a
 *     colour nobody chose. It is also what makes `PROPS.gradientFrom.inherited`
 *     an honest `false` rather than a claim the table makes and the CSS breaks.
 *   - **`initial-value`.** `diff` writes `unset` for a declaration a state layer
 *     does not make, and `unset` on an inheriting custom property means *inherit*
 *     — so without a registration, a state that stopped saying anything about a
 *     gradient colour would take its parent's rather than the default's.
 *   - **`syntax: "<color>"`.** Only a registered property with a real syntax can
 *     be interpolated, so this is the line that makes a gradient's colours
 *     actually *tween* through a transition or a `@keyframes` instead of
 *     snapping at the halfway point.
 *
 * A string rather than a rule in each renderer's stylesheet, for
 * {@link DOCUMENT_BASE}'s reason exactly: the exporter needs these declarations
 * and a CSS module is not somewhere it can read them from. The canvas renders it
 * into a `<style>` at the studio root and the exporter concatenates it into
 * `BASE_CSS`, and there is one copy of the two initial colours in the codebase.
 */
export const CUSTOM_PROPERTY_RULES = `@property --gfrom {
	syntax: "<color>";
	inherits: false;
	initial-value: ${GRADIENT_FROM};
}
@property --gto {
	syntax: "<color>";
	inherits: false;
	initial-value: ${GRADIENT_TO};
}`;
```

---

## 5. The HTML target

### 5.1 `BASE_CSS`: isolation, and the registrations

```
@property --gfrom { … }
@property --gto { … }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: #f1f5f9; }
.design {
	position: relative;
	/* A mix mode blends against everything painted below it in the nearest
	   isolation group, and without one that group is the page this file was
	   pasted into. A design defines its own appearance and never borrows the
	   host's — the same sentence DOCUMENT_BASE makes about inheritance, made
	   about compositing. Not *in* DOCUMENT_BASE, which is by its own definition
	   the properties CSS inherits, and `isolation` is not one of them. */
	isolation: isolate;
	…DOCUMENT_BASE…
}
```

The canvas needs the same two things: `isolation: isolate` on `.artboard` in
`Artboard.module.css`, beside the comment already there about not inheriting the
app's theme, and `<style>{CUSTOM_PROPERTY_RULES}</style>` rendered once at the
studio root in `Studio.tsx`. `@property` is a global at-rule wherever it is
declared, so once anywhere in the document is enough, and the studio root is the
place that is mounted exactly once.

### 5.2 `tweenedKeys`: `background-image` is struck out

```ts
	const keys = Object.keys(changed).filter(
		(key) => key !== "display" && key !== "animation" && key !== "backgroundImage",
	);
```

with a comment in the shape of the two beside it: a `background-image` between
two gradients does not interpolate in CSS — it swaps discretely at the halfway
point — so `transition: background-image` is a declaration a browser accepts,
does nothing visible with, and a reader believes. Struck out for `display`'s
reason exactly.

And the loss it implies is said out loud, in the shape of the `display:none`
sentence already at export.ts:3353 — emitted only when a transition's changed
keys actually include `backgroundImage`:

> *"<State> changes the gradient on <node>. The direction of a gradient does not
> tween: CSS swaps one background image for the other at the halfway point,
> however long the transition says. The gradient's two colours do tween, because
> they are registered custom properties — so a change of colour is smooth and a
> change of direction is a cut."*

That sentence is the payoff of the split in §1.1 stated as a limitation, which is
the honest way round.

### 5.3 Nothing else

`declarationsFor`, `classRule`, `copyPaint`, `styleClasses`, `diff`, the
`@keyframes` writer and `htmlBody` need **no changes at all**. Every one of them
is written against `KINDS[kind].props` and `paintFor`, and the six new properties
answer both. The token-preserving walk writes `--gfrom: var(--brand)` with no
help, because `cssName` already leaves a `--custom` alone.

`EXPORT_TARGETS.html.loses` gains nothing: the HTML target carries all four
features exactly.

---

## 6. The SVG target

### 6.1 `SVG_PAINT` gains one entry

```ts
	// SVG has compositing: `mix-blend-mode` is a CSS Compositing property that
	// applies to SVG elements and that the rasterisers this target is written for
	// implement, unlike the CSS filter functions below. Carried rather than
	// dropped, because dropping something that works would be the same lie in the
	// other direction.
	mix: (value) => ({ mixBlendMode: value }),
```

and the root `<svg>` element gains `style="isolation: isolate"`, unconditionally,
for the reason `.design` does: a multiply near the top of the picture must blend
against the design and not against whatever the file was pasted over.

### 6.2 A gradient is flattened, not dropped

`gradient`, `gradientFrom`, `gradientTo`, `blur` and `backdropBlur` are **absent**
from `SVG_PAINT`, so they write nothing — the same mechanism that drops `shadow`.
But dropping the gradient outright has a failure the shadow does not: a rect whose
fill has been cleared and whose paint is entirely a gradient would emit no `fill`
at all, and an SVG shape with no fill is **black**. That is not a loss, it is a
wrong picture, and it is the exact class of bug this repo has already paid for.

So, after the property loop in `svgPaint`:

```ts
	// A gradient flattens to the colour it starts from.
	//
	// An SVG shape has no background, so the CSS `background-image` a gradient
	// becomes says nothing here. Carrying it properly would mean a
	// `<linearGradient>` def per node, built by reading the recipe the designer
	// chose back into an angle and two stops — a second description of the same
	// picture, in a file whose whole promise is that the file *is* the picture.
	//
	// Flattened rather than dropped, and the difference is not tidiness: a node
	// whose fill was cleared and whose paint is entirely a gradient would leave
	// this element with no `fill` at all, and an SVG shape with no fill is black.
	// A recognisably wrong colour is a worse answer than a recognisably simpler
	// one, and the loss list says which happened.
	//
	// Written as the colour rather than as the `var()` the document named, and it
	// is the one value in this target that is: this is a *flattening* rather than
	// a translation, and naming the token here would claim the file carries a
	// gradient that the picture has not got.
	const recipe = node.rendered.gradient;
	if (recipe !== undefined && recipe !== "none") {
		const from = node.rendered.gradientFrom;
		if (from !== undefined) box.fill = cssValue("gradientFrom", from);
	}
```

It runs after the loop so it beats the node's own `fill`, which is what "the
gradient is what you see" means. It is guarded on the recipe so that a node
carrying gradient colours with the direction set back to `none` paints its flat
fill, which is what the canvas shows.

### 6.3 `EXPORT_TARGETS.svg.loses`

Two new sentences, beside the shadow one they are siblings of:

```ts
		"Gradients are flattened to the colour they start from. An SVG shape has no background, and carrying the gradient would mean a gradient definition per node, built by reading the recipe back into an angle and two stops — a second description of the same picture.",
		"Blur is dropped. A blur here is a CSS `filter`, and the CSS filter functions are not SVG filters: a browser opening this file would blur, and a rasteriser reading the same attribute would not, which makes the file two pictures depending on who opened it. A backdrop blur has no SVG reading at all — an element here has no backdrop to reach behind.",
```

No sentence about mix modes, because they are carried.

---

## 7. What reaches ASP, and how

**Nothing changes in `compile.ts`. No new predicate, no new `#show`, no new
literal bridge.** That is not a shortcut; it is the thing the design was arranged
to make true, and here is the chain, read off the code rather than assumed.

A node's property becomes a variable in one generic loop:

```ts
		for (const [prop, value] of Object.entries(node.props)) {
			if (value) emitValue(propVar(node.id, prop), value);
		}
```

`emitValue` writes `alt(prop(n1,mix),0)` and `alt_literal(prop(n1,mix),0,l7)`,
interning the text in `LiteralTable`, which is keyed by the text and knows
nothing about types. The pick resolves through the generic rule at compile.ts:4773:

```
rendered(N,P,L) :- resolved(prop(N,P),L), not mshadow(N,P).
```

and reaches the answer set through the `#show` that is already there:

```
#show rendered(N,P,L) : rendered(N,P,L), scenery.
#show literal(I,T) : literal(I,T), scenery.
```

`readModel`'s `renderedTexts` reads it into `Partial<Record<PropName,string>>`
with no whitelist. The house rule about a missing `#show` costing a whole feature
(`asset/2`, 546eb02) is satisfied by *not adding a predicate*, which is the only
way to satisfy it with certainty.

**The literal side, precisely.** Each of the six values reaches the program as an
interned quoted string, and picks up whichever of the six bridges its *text*
admits — the bridge is chosen by what the value is, never by who is asking:

| Value | `literal/2` | bridges |
| --- | --- | --- |
| `"multiply"` | `literal(l7,"multiply")` | `word(l7,multiply)` |
| `"linear-gradient(180deg, var(--gfrom, #ffffff), var(--gto, #94a3b8))"` | yes, escaped | **none** |
| `"#7c3aed"` (a gradient stop) | yes | none |
| `"73152emu"` / `"8px"` (a blur) | yes | `numeral(l9,73152)`, and `tally`/`permille` if the text is a bare integer |

The gradient recipe carries no bridge at all, and that is the same company a
colour and a `box-shadow` already keep: `wordOf` is `/^[a-z][A-Za-z0-9_]*$/` and
parentheses, commas and hashes all fail it. A rule that wants to say something
about gradients compares literal identity —
`:- rendered(a,gradient,G), rendered(b,gradient,G).` — which is exactly how the
existing `differ` and `match` constraints already work on `fill`. The house
invariant that "anything that reaches the program *as itself* must be a legal ASP
constant" is not engaged: a gradient recipe reaches the program as a quoted
string, never as a term.

Two consequences worth writing down because somebody will want them:

- **`blur` is constrainable.** It is a `length`, so `numeral/2` carries it in EMU
  and a rule can write `:- rendered(N,blur,L), numeral(L,V), V > 76200.` — no
  blur over eight pixels — with nothing added. This is a real argument for
  `length` over `number`, not a side effect.
- **`mix` is groundable.** Every value in `MIXES` is a legal constant, so
  `mword(N,M) :- rendered(N,mix,L), word(L,M).` works and a rule can reason over
  the mode by name. This is the payoff of the roster decision in §2.4 and the
  reason the four hyphenated modes are out.

**Universe counts are unchanged** for every document that does not use the new
properties, because nothing is emitted for a property a node does not hold. A
document that *does* use them branches exactly as a fill does: two `mix` values
is two universes, and the acceptance test in §11 asserts it against the real
solver.

---

## 8. Measurement and hit testing

The brief asks whether blur affects either. **Neither, and both answers are
already enforced by an existing table rather than by a promise.**

### 8.1 Measurement

`measure.ts` names the properties that participate:

```ts
export const MEASURED_PROPS: readonly PropName[] = [
	"text",
	"fontFamily",
	"size",
	"weight",
	"lineHeight",
];
```

It is a whitelist, so `blur` cannot enter measurement by accident. It should not
enter it deliberately either, and the reason is CSS rather than convenience: a
`filter` does not change an element's layout box by a hair. The border box is the
same size blurred or not; the smear is painted outside it and participates in no
layout. So a hugging container hugs the same box either way, `lask/3` is
unchanged, the solved geometry is unchanged, and — the property that matters —
the canvas and the export agree about it *for free*, because both are asking a
browser the same question.

A version that inflated the measured box by 3σ so a blurred node "took up its
halo" would be a number this repo invented, appearing in `frame/3`, moving its
laid-out siblings, and disagreeing with every browser that ever rendered the
export.

### 8.2 Hit testing

`hitTestTree` in `tree.ts` reads frames and `isDrawable` and never opens `props`
at all. It stays that way, and the three reasons are worth stating because "click
the blurry bit" is a plausible-sounding request:

1. **The frame is what the editor draws.** Selection handles, snap targets,
   alignment and the marquee are all the frame. A hit area that was bigger than
   the frame would make a node selectable in a region where nothing about the
   editor says it is there.
2. **The browser hit-tests the unblurred box.** In the exported file, a pointer
   over the halo of a blurred card is over whatever is behind it. Extending the
   canvas's hit area would make the editor and the file disagree about what you
   are pointing at, which is precisely what this repo's shared `paint.ts` exists
   to prevent.
3. **The halo is mostly transparent.** Picking a node by a pixel that is 4%
   opaque is a worse experience than not picking it, and it would shadow whatever
   is genuinely under the pointer.

The one visible consequence, which needs no code: a surface clips
(`overflow: hidden` in `SURFACE_BOX`), so a blurred child's halo is cut at its
frame's edge — identically on the canvas and in the export, because both apply
the same declaration.

### 8.3 Two CSS side effects, checked rather than assumed

`filter`, `backdrop-filter` and `mix-blend-mode` each create a **stacking
context**, and the first two also create a **containing block for absolutely
positioned descendants**. Both could in principle move something.

Neither does here, and the reason is the export's own structure: every node is
`position: absolute` inside its parent node, which is itself `position: absolute`
— so every node already has a positioned ancestor, and it is already its parent.
Making that parent a containing block changes nothing, because it already was
one. And paint order in this document is DOM order (`order/2`, no `z-index`
anywhere), and a stacking context does not reorder a subtree that is already
contiguous in the DOM. Asserted in §11 rather than argued alone, because "it
happens to be fine" is a sentence that stops being true when the markup changes.

---

## 9. Multiple fills: don't. Here is what to build instead.

**Recommendation: do not add a list of fills, now or as a follow-up to this. Ship
`fill` + `gradient` + `mix` and stop.** I mean it, and the argument has three
parts.

### 9.1 The type already means something else

`Value` is `Term[]`, and the list means **alternatives**: more than one is what
branches the design space. A list of fills would put a second list with the
*opposite* meaning at the same position in the same type. `fill: [a, b]` would
have to mean "a over b" here and "a or b" everywhere else, and the multiverse —
the whole thesis of the tool — would have no way to say "either of these two
stacks of fills". That is not an implementation difficulty; it is the type
already being spoken for.

So a fill list must be a *different field*: `paints?: Value[]` on `SceneNode`.

### 9.2 What that field costs, counted

Every one of these is a real edit, not a hypothetical:

- **`compile.ts`**: `propVar(n,prop)` is one variable per property. A list needs
  one per layer — `paintVar(n,i)` — and a new fact carrying the index.
- **`rendered/3` becomes `rendered/4`.** Its guard comment says in as many words
  that two literals for one property "is not two designs, it is one arbitrary
  answer, silently". A list makes that arity change, and every reader of
  `rendered/3` changes with it: `model.ts`, the `differ`/`match`/`atMost`
  constraints, `annotate.ts`, `why.ts`, the machine alias rules, the keyframe
  copies, the state copies.
- **`#show`**, and therefore a new chance to make the `asset/2` mistake.
- **`Style.variants[].parts`** is `Partial<Record<PropName, Term>>` — one term per
  property. A style could not hold a fill stack without changing shape.
- **`MachineState.parts[].props`** and **`Track.prop`** likewise: a track animates
  one property to one value.
- **`PAINT`** is `(value: string) => Declarations`, one property in, declarations
  out. A stack needs a fold.
- **The inspector** needs a nested list editor inside a row that is itself a list
  of alternatives — a list of lists, on screen, where one list means "and" and the
  other means "or".

That is six or seven subsystems, and the last item is a genuinely hard interface
problem: no design tool has ever had to draw "alternatives of stacks".

### 9.3 What a gradient plus a mix mode buys instead, for four table entries

- **Two paints, stacked.** `background-color` under `background-image`. A tint
  under a sheen is the overwhelming majority of what multi-fill is used for.
- **Both independently tokenised, branchable, styleable, animatable.**
- **A blend mode**, so a node composites with what is behind it — which is the
  *other* thing people reach for multi-fill to fake.
- **A gradient recipe can itself carry more than one layer** if it ever needs to:
  `background-image` takes a comma-separated list, and a future roster entry could
  be two stacked gradients. That is a menu entry, not a document change.

What it does not buy, stated so nobody discovers it later: N arbitrary layers,
per-layer blend modes (`background-blend-mode`), image fills, and a fill stack
that reorders. If somebody turns up with a design that genuinely needs three
layers, the answer is `paints: Value[]` and `rendered/4` and the bill in §9.2 —
and it should be paid then, with that design in hand, and not before.

The wrong answer, named so it does not get built: a second numbered property
(`gradient2`, `fill2`). That is a list wearing a disguise, with none of a list's
generality and all of a new property's cost, repeated for every layer anybody
wants.

---

## 10. The UI

### 10.1 Free

`Inspector.tsx`'s `appearanceRow` is `{KINDS[node.kind].props.map(appearanceRow)}`
and reads `PROPS[prop].label` and `PROPS[prop].type`. `ValueEditor` picks its
editor off `VALUE_TYPES[type]`. So:

- `gradient` and `mix` are `<select>`s, because both types have `options`.
- `gradientFrom` and `gradientTo` are colour swatches, because `type === "color"`.
- `blur` and `backdropBlur` are `LengthInput`s, because `isLengthType("length")`,
  which means they read out in the document's unit and refuse half-typed text.

Every one of them gets alternatives, token links, derivations, pinning, the
why-probe, the impossible-value greying and the style override button, with no
code.

### 10.2 The one thing to build: `PropSpec.needs`

In `appearanceRow`, before anything else:

```ts
		const needs = PROPS[prop].needs;
		if (needs !== undefined && node.props[needs] === undefined) return null;
```

Twelve rows on a rect is a wall; ten is a list. The predicate is "does the node
hold a value for the property this is a detail of", not "does that value resolve
to something", so choosing `None` in the gradient menu keeps the two colour rows
on screen — a designer flipping between directions must not have rows blink out
from under the cursor.

**Not applied in the style-variant editor**, which lists the same properties for
a variant through its own `KINDS[node.kind].props.map` (Inspector.tsx:1711). A
style variant has no `gradient` value to test unless it sets one, and hiding a
field a variant could legitimately fill would make a style unable to say something
a node can. Stated in the doc comment so the asymmetry reads as a decision.

### 10.3 Two honest gaps

**A group cannot be blurred.** `KINDS.group.props` is `[]` and a test asserts it
(`props.test.ts`: *"everything with an appearance of its own can be faded"*, plus
the explicit `assert.deepEqual(spec.props, [])`). Blurring several things together
means putting them in a frame. That is a real limitation and it is not this
feature's job to lift: giving a group properties changes what a group *is* — it
is `wrapsChildren: true`, it re-fits, it dissolves on ungroup — and a group that
carried paint would need an answer for what happens to that paint when it
dissolves.

**Gradient rows do not know which of them the recipe uses.** A conic gradient
reads both colours and a `none` reads neither, and the rows say the same thing
either way. Acceptable; a row that greys itself out based on the *content* of
another row's value is a mechanism the inspector has not got and should not grow
for this.

---

## 11. Test plan

Colocated, `node --test` + `node:assert`, through the real solver wherever the
claim is about the program.

### `design-core/src/props.test.ts`

1. **`"a fill is a background colour, so a gradient can sit over it"`** —
   `assert.deepEqual(Object.keys(PAINT.fill!("#fff")), ["backgroundColor"])`, and
   the same for `SURFACE_BOX`. This is the regression guard for §4.1 and it is the
   single most important assertion in the file: the shorthand was correct until it
   was not.
2. **`"a gradient's parts sit together, and after the fill"`** — for every kind
   whose `props` includes `gradient`: it also includes both colour properties, and
   `indexOf("fill") < indexOf("gradient")`, and the three are contiguous.
3. **`"a backdrop blur goes on the box kinds, never on a stroked one"`** — the
   twin of the existing shadow test. `frame`/`rect`/`ellipse` have
   `backdropBlur`; `line`/`arrow`/`path`/`text`/`image` do not, and all five of
   those *do* have `blur`.
4. **`"a gradient only goes where there is a box to paint it on"`** — `gradient`
   appears in exactly `frame`, `rect`, `ellipse`.
5. **`"every mix mode is one word, so a rule can name it"`** — for every option of
   `VALUE_TYPES.mix`: `wordOf(o.value) === o.value`. This is the invariant §2.4
   gave up four modes for; if it ever fails, the roster grew a dash.
6. **`"a gradient paints even when only its direction is set"`** — for every
   `GRADIENTS` option except `none`: the value contains
   `` `var(--gfrom, ${GRADIENT_FROM})` `` and `` `var(--gto, ${GRADIENT_TO})` ``.
7. **`"the two gradient colours are spelled once"`** — `PROPS.gradientFrom.fallback
   === GRADIENT_FROM`, `PROPS.gradientTo.fallback === GRADIENT_TO`, and
   `CUSTOM_PROPERTY_RULES` contains both as `initial-value`s. Three readers, one
   source; this is what stops the row showing one colour and the box painting
   another.
8. **`"a mix mode branches the space like any other value"`** — `box({ mix: [lit("normal"), lit("multiply")] })`,
   `explore` with `directSolver`, `count === 2`, `varyingVars === [propVar("box","mix")]`.
   The twin of the existing shadow and opacity tests.
9. **`"a gradient's colour branches, and its direction does too"`** — two
   alternatives on `gradientTo` alone is 2 universes; two on `gradient` *and* two
   on `gradientTo` is 4.

### `design-core/src/parity.test.ts` (or `templates.test.ts`)

10. **`"a document that paints nothing new compiles to the same program"`** — for
    every template: `compile(scene).program` is byte-identical before and after
    this change. The `three-d-spec.md` §0 acceptance pattern, and it is the
    assertion that "no `compile.ts` change" is true rather than merely intended.

### `design-core/src/export.test.ts`

11. **`"a gradient reaches the file over the fill, with both names kept"`** — a
    rect with `fill: ref(brand)`, `gradient: <linear down>`, `gradientFrom: ref(accent)`.
    The node's rule contains, in this order: `background-color: var(--brand);`,
    `background-image: linear-gradient(180deg, var(--gfrom, #ffffff), var(--gto, #94a3b8));`,
    `--gfrom: var(--accent);`. And the file contains both `@property` blocks with
    `inherits: false`.
12. **`"a state that repaints the fill does not erase the gradient"`** — the
    §4.1 regression, driven end to end: a machine whose hover state sets only
    `fill` on a part that carries a gradient. The state rule contains
    `background-color:` and contains neither `background-image` nor a bare
    `background:`.
13. **`"a gradient's direction is not tweened, and the file says so"`** — a
    transition across a state that changes `gradient`: the `transition`
    declaration does not name `background-image`, and `lost` contains the §5.2
    sentence.
14. **`"a gradient's colours are tweened, because they are registered"`** — a
    keyframe track on `gradientFrom` produces `@keyframes` stops containing
    `--gfrom: …`, and the transition list for a state that changes it names
    `--gfrom`.
15. **`"blur is a length like any other, so no EMU escapes"`** — extend the
    existing "EMU stays inside" document with `blur: "0.25in"` and
    `backdropBlur: single(writeLength(...))`: the output contains
    `filter: blur(24px)` and `backdrop-filter: blur(…px)` and contains neither
    `emu` nor `in` nor a raw EMU integer.
16. **`"a negative blur is clamped where it is read"`** — unit, on the table:
    `PAINT.blur!("-4px")` is `{ filter: "blur(0px)" }`; `PAINT.blur!("var(--x)")`
    is `{ filter: "blur(var(--x))" }`; `PAINT.blur!("")` writes the key `filter`.
17. **`"the document isolates itself"`** — `.design` contains `isolation: isolate`,
    and the SVG root carries it too.
18. **`"an SVG flattens a gradient rather than losing the shape"`** — an SVG export
    of a rect with a gradient and *no fill*: the `<rect>` carries
    `fill: <gradientFrom colour>` and the file contains no `linear-gradient`, no
    `filter:` and no `backdrop-filter:`. The point of the assertion is the first
    half — the guard against a black rectangle.
19. **`"an SVG keeps a mix mode"`** — `mix-blend-mode: multiply` appears on the
    element.
20. **`"the SVG target says what it dropped"`** — `EXPORT_TARGETS.svg.loses`
    contains a sentence naming gradients and one naming blur, and
    `EXPORT_TARGETS.html.loses` gained nothing.
21. **`"a style can own the whole sheen"`** — two rects wearing a style whose
    variant sets `gradient`, `gradientFrom` and `blur`: all four declarations
    (`background-image`, `--gfrom`, `--gto` if set, `filter`) hoist into the single
    `:where(.cls)` rule, and appear once in the file.
22. **`"the round trip still holds"`** — the existing tokens-on/tokens-off
    inlining test, run over a document that uses all six properties. This is what
    catches the SVG flattening in §6.2 if somebody later dresses it up as a
    `var()`.

### `design-core/src/measure.test.ts` and `tree.test.ts`

23. **`"a blur changes no box"`** — a hugging container over a blurred child:
    `lask/3` and every `frame/3` are identical, atom for atom, to the same
    document with the blur removed.
24. **`"a blur does not widen what you can click"`** — `hitTestTree` at a point
    two pixels outside a heavily blurred node's frame returns `undefined`, and at
    a point inside returns the node.

### `app`

25. Inspector: a rect shows a `<select>` at `[data-prop="mix"]` and a
    `LengthInput` at `[data-prop="blur"]`; `[data-prop="gradientFrom"]` is
    **absent** until a gradient is chosen and present afterwards; choosing `None`
    afterwards leaves it present.
26. e2e: the existing single Playwright journey gains one assertion — a node with
    a gradient reaches the DOM with a computed `background-image` that is not
    `none`. It is the only way to check that React writes `--gfrom` out of a style
    object and that `@property` reached the page, and neither is testable headless.

---

## 12. Rejected, with reasons

**12.1 A `gradient` ValueType whose literal is a complete CSS gradient, on the
`shadow` model.** The shortest path and a dead end. A shadow ladder works because
a shadow is colourless; a gradient is nothing but colour, and a frozen roster
would be somebody else's palette, unable to name a token, branch, follow a style
or be repainted by a state. §1.

**12.2 Draggable stops.** Not a bigger property, a different *shape*: a field on
`SceneNode`, a sub-editor, an emission, a `#show`, a reader, and its own form in
`Style`, `MachineState` and `Track`. It is the §9.2 bill for a feature two stops
already covers. §1.

**12.3 A fourth `gradientAngle` property, so the angle could name an `angle`
token.** This is the best thing left out, and it was close. `linear-gradient(var(--gangle), …)`
works, `@property --gangle { syntax: "<angle>" }` makes it animatable, and an
`angle` token driving every gradient in a design is genuinely in the spirit of the
tool. It is out because the row would be **live and inert for two thirds of the
menu**: a radial gradient and a conic gradient do not read an angle the way a
linear one does, and the inspector has no mechanism for a row that greys out based
on another row's *value* (`needs` tests presence, not content). A control that
does nothing depending on a different control is worse than a roster of seven
directions. Revisit when there is a reason to grow conditional rows; the cost then
is one `PROPS` entry, one registration, and shrinking `GRADIENTS` to Linear,
Radial and Conic.

**12.4 Storing `softLight` and translating it in `PAINT` the way `fit` translates
`stretch`.** Would buy the four hyphenated blend modes. Rejected because it trades
them for the rule that an enumerated value *is* the CSS it paints with — the rule
that makes an enumerated type cost the renderer nothing and makes a value written
before the menu existed still paint. `fit` is the exception because `fill` was
already taken in this vocabulary by the colour a box is painted; there is no such
collision here, only a hyphen. §2.4.

**12.5 A `filter` property taking arbitrary CSS filter functions.** Brightness,
contrast, saturate, drop-shadow and hue-rotate for free. Rejected: it is a text
field the designer has to remember the syntax of, which the file already calls
"not editing, it is remembering"; it is unconstrainable (a string, not a length);
and it collides with `blur` writing the same declaration. Blur is 90% of the use
and is a length, which is worth more than the other 10% as prose.

**12.6 `background-blend-mode`, so the fill and the gradient blend with each
other.** One more property, one more menu, and it is genuinely the cheap half of
multi-fill. Left out because it is only meaningful when both a fill and a gradient
are set, which is a second `needs`-shaped condition on a *pair*, and because
nobody has asked. It is the cheapest future addition in this document: one `PROPS`
entry, one `PAINT` entry, one roster reused from `MIXES`.

**12.7 Extending the hit area or the measured box to cover a blur's halo.** §8.

**12.8 Building the SVG `<linearGradient>` def.** Feasible — roughly thirty lines
and a table mapping each recipe to an angle and two stops. Rejected for now
because that table is a second description of the same gradient, and the two would
drift the day somebody adds a recipe and forgets the twin. If it is built, it
should be built the other way round: the recipe becomes a small structured record
that *generates* both the CSS string and the SVG def, so there is one source. That
is a good follow-up and it is not this change.

**12.9 Giving `group` the four properties.** §10.3.

**12.10 Making the canvas tween a property track instead of stepping it.**
`Artboard.tsx` holds a property at its keyframe: *"A property steps. A word is a
word; a colour would need a colour space this file has no business knowing
about."* That divergence from the export's smooth `@keyframes` already exists for
`size`, `radius` and `strokeWidth`, and `blur` joins it. Pre-existing, unchanged,
and out of scope — but worth knowing that a blur animation looks smoother in the
exported file than on the canvas, and that the fix is one colour-space-aware mixer
for the whole property family rather than anything about blur.

---

## 13. What this leaves undone

Named so the next person does not have to rediscover it:

- **Three-stop gradients.** Would be a third colour property plus a `gradientMid`
  position; the recipes would have to name it, and every existing recipe would
  need a two-stop and a three-stop form. Cheaper than it sounds and still not
  worth it until a design needs it.
- **Image fills.** A picture as a box's background rather than as an `image` node.
  `background-image` is spoken for by the gradient, so this wants either the
  comma-separated list or the `paints` field of §9.2.
- **Inner shadow.** `box-shadow` takes an `inset` keyword, so it is a roster
  extension to `SHADOWS` and nothing else — genuinely five lines, and the reason
  it is not in here is only that it is not paint in the sense this document means.
- **`background-blend-mode`** — §12.6.
- **The SVG gradient def** — §12.8, done right.
