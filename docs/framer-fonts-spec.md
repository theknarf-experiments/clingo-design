# A font is a file in the tree, and a family is what the document calls it

**Status: a design step. No code was written for it.** It is the typographic
half of what `f2b6316` ("An image is a node, and the picture it draws is a file
in the tree") and `docs/model-files.md` did for pictures and geometry, and it is
written against the tree as those left it: `/pages/<name>.scene` documents beside
`/assets/<name>` files, both syncing, both cloning to disk.

It overturns one comment, and the comment is worth quoting in full because
everything below is an argument with it:

```ts
/**
 * No webfonts are available offline, so the roster is system stacks — a small
 * curated set rather than a free text field nobody can spell correctly.
 */
const FONTS: ValueOption[] = [ … ];
```

Half of that sentence stays true and is the reason §8 recommends upload over a
Google Fonts fetcher: **no webfonts are available offline.** What is false is
the inference. A webfont is not the only kind of font that is not on the
machine; a font *file in the project* is neither a webfont nor a system stack,
it is the third thing, and the tree has been able to hold one since the day it
could hold a chair. `vfs/src/files.ts` already knows what `woff2` is:

```ts
woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
```

So the roster stays curated — the second half of the comment is right, and a
free text field for a font stack is still not editing, it is remembering — and
it grows a second source: the fonts this project holds. The comment should be
rewritten rather than deleted, and §4.1 gives the replacement text.

---

## 0. The thesis, and the two things it costs

**A font the designer uploaded is a file in the project's tree, the page
declares what to call it, and a `fontFamily` value is still the CSS list it has
always been — with that name at the front of it.**

Nothing about the *value system* changes. No new `ValueType`, no new `PropName`,
no new literal bridge, no new ASP. What is added is bytes, a loader, a roster
that is partly the project's, and an `@font-face` writer in the exporter.

Two costs, both stated up front because they are the reason this is a design
step:

> **1. Text measurement can be wrong in a way that is not cosmetic.**
> `measure.ts` feeds `lask/3`, which feeds the layout equations, which can go
> unsat. A box measured in a font that has not loaded is wrong geometry, not an
> ugly frame. And it is *cached*: `prepareCached` in `measureText.ts` keys on
> `(fontString, text)`, and so does pretext's own `segmentMetricCaches`, which
> the package exports no way to clear. A width measured in the fallback under
> the real font's key survives for the life of the page. §5 is the answer, and
> it is the only part of this feature that is difficult.

> **2. An exported HTML file carries every font it uses, at 4/3 of the file's
> size, with no cache to amortise it.** A variable `.ttf` from Google Fonts is
> often 700–900 kB, so an export can gain a megabyte from one family. §7 states
> it in `EXPORT_TARGETS` and names the numbers per document.

---

## 1. What is there now — checked, not assumed

Read, not remembered:

- **`values.ts`.** `type ValueType` has `"font"`. `VALUE_TYPES.font = { label:
  "Font", fallback: FONTS[0].value, options: FONTS }`. `ValueTypeSpec.options`
  is documented as *"the stored value is still the literal CSS the renderer
  wants — a label is only what the menu calls it. So an enumerated type costs
  the renderer nothing: there is no name-to-declaration table on the other side,
  and a value typed before the list existed still paints."* `optionLabel(type,
  value)` is `options?.find(o => o.value === value)?.label ?? value`.
- **`scene.ts`.** `PROPS.fontFamily = { label: "Font", type: "font", fallback:
  VALUE_TYPES.font.fallback, styleable: true, inherited: true }`. `size` is a
  `length`, `weight` is type `weight` (quantity `ratio`, fallback `"400"`, no
  menu), `lineHeight` is a `number`. `Scene.assets?: Record<string, AssetInfo>`
  is keyed by path and is an index *of what the nodes reference*.
- **`paint.ts`.** `PAINT.fontFamily = (value) => ({ fontFamily: value })` — a
  pass-through, with no scene in scope. `DOCUMENT_BASE.fontFamily` is the
  artboard's stack, hard-coded, and the comment beside it says why: *"measuring
  against one list while painting with another would be off by whole
  characters."*
- **`measure.ts`.** Measures nothing. `FontSpec { family; size; weight }` and
  `fontString(spec)` produce `"400 16px <family list>"` — the one string a
  canvas 2D context understands. `MEASURED_PROPS = ["text","fontFamily","size",
  "weight","lineHeight"]`. `stateMeasures` produces `TextRow { text, family?,
  size?, weight?, lineHeight? }` per state copy. Nowhere does any of this ask
  whether a family exists.
- **`measureText.ts`** (the app, the only place with a canvas). `measureScene`
  builds `fontString({ family: prop("fontFamily") ?? ARTBOARD_FONT, … })` and
  calls `measureText(text, font, leading)`, which calls `prepareCached(text,
  font)` → `prepareWithSegments`. The cache is a 512-entry LRU keyed
  `` `${font}\x00${text}` ``.
- **`Studio.tsx:484`.** `const measurements = useMemo(() => measureScene(scene),
  [scene]);` — synchronous, on every scene change, feeding `useExploration`.
- **`export.ts`.** `EXPORT_TARGETS` with `loses: string[]` per target;
  `ALWAYS_LOST`; the conditional `GRID_LOST`; `missingImages()`, which names a
  picture whose bytes the caller did not hand over. `dataUrl(images, path)` does
  base64 via `btoa` in 0x8000-byte chunks and picks a MIME from `IMAGE_TYPES`.
  `const css: string[] = [BASE_CSS]` is the HTML target's stylesheet, joined
  into one `<style>` in the head. `DocIndex` carries `scene`.
- **`store.ts`.** `putNamedAsset(name, bytes)` writes `/assets/<stem><ext>`,
  suffixing `-2` on a collision, and answers the path that was actually taken.
  `resolveAsset(path)` reads bytes back out of the project on screen. Neither
  knows or cares what kind of file it is holding.
- **`compile.ts`.** `asset(N,P)` is stated for `node.image` and `node.mesh`, and
  `#show asset(N,P) : asset(N,P), scenery.` ships beside it, with a comment
  recording what a missing `#show` cost the last time. Six literal bridges:
  `numeral`, `tally`, `word`, `millis`, `mdeg`, `permille`.

### 1.1 Three findings from that reading that decide the design

1. **A `fontFamily` value already reaches the program and the renderers
   correctly, as itself.** `resolved(prop(N,fontFamily), L)` → `rendered/3`,
   which is `#show`n at compile.ts:4956, and `ModelNode.rendered.fontFamily` is
   what both exporters and the canvas paint from. Fonts need **no new ASP at
   all** (§6).
2. **pretext caches segment widths per font string, in a module-level Map, with
   no exported clear.** `measurement.js`: `const segmentMetricCaches = new
   Map(); export function getSegmentMetricCache(font) {…}` — and the package's
   `exports` map only publishes `.` (`layout.js`) and `./rich-inline`. So cache
   invalidation is not available to us. §5.3 makes it unnecessary instead.
3. **pretext's measuring context is `new OffscreenCanvas(1,1).getContext('2d')`
   created at module scope on the main thread.** An `OffscreenCanvas` created in
   a Window context takes its font source from that document, so
   `document.fonts.add()` reaches it. That is load-bearing and is not obvious
   from the code, so §11 asserts it rather than assuming it.

---

## 2. What the document holds

A new optional field on `Scene`, beside `tokens`, `styles` and `machines`.

```ts
/**
 * One font file the project holds, and everything CSS has to be told about it.
 *
 * A file, not a family: a family is a *set* of these that agree on
 * {@link FontFile.family}, which is what makes Regular and Bold one typeface
 * that `weight` selects within rather than two entries in a menu. A variable
 * face is the degenerate and now-usual case — one file whose `weight`
 * descriptor is a range, and the family has one member.
 *
 * The descriptors are stored **verbatim as CSS writes them** — `"100 900"`,
 * `"oblique -10deg 0deg"` — for the reason {@link ValueTypeSpec.options} gives
 * about a shadow and a font stack: what the renderer wants is the declaration,
 * and a structured `{min,max}` here would be a second spelling that `@font-face`
 * would have to be taught to flatten and a panel would have to be taught to
 * edit. One string, one box, one thing that can be wrong and one place to
 * correct it.
 */
export interface FontFile {
	/** Absolute path in the project's tree — `/assets/InterVariable.woff2`. */
	src: string;
	/**
	 * What this document calls the face — the name in the `@font-face` rule, the
	 * name a `fontFamily` value puts at the front of its stack, and the name the
	 * studio hands `new FontFace(family, bytes)`.
	 *
	 * **Ours, not the file's.** `FontFace` takes the name as an argument; the
	 * `name` table inside the file is a suggestion for a label and nothing more.
	 * That is what makes §9's decision not to decompress a woff2 cost nothing
	 * that matters: a family whose label reads wrong is one field in a panel,
	 * never a design that does not paint.
	 *
	 * Two files with the same `family` are two faces of one family, and the
	 * browser chooses between them by `font-weight` and `font-style` — which is
	 * how a static Regular and a static Bold become a typeface the `weight`
	 * property can actually move.
	 */
	family: string;
	/**
	 * The `font-weight` descriptor, verbatim: `"400"` for a static face,
	 * `"100 900"` for a variable one.
	 *
	 * **This field is the whole of §9.** Declared as a single number, a variable
	 * face is clamped by the browser to its default instance and a `weight` of
	 * 700 comes out as a synthesised faux bold. Declared as a range, a static
	 * face claims weights it does not have and 700 renders as Regular with no
	 * synthesis at all. Both failures are silent and they are in opposite
	 * directions, which is why the Fonts panel shows this field beside a preview
	 * strip at 100/400/700/900 (§10.2): the one thing that can be wrong is the
	 * one thing that is visibly wrong in five seconds.
	 */
	weight: string;
	/** The `font-style` descriptor, verbatim: `"normal"`, `"italic"`. */
	style: string;
	/**
	 * The `font-stretch` descriptor, verbatim — `"75% 125%"`. Absent where the
	 * file has no width axis, which is nearly always, and absent rather than
	 * `"100%"` so that "this file has no width axis" has one spelling.
	 */
	stretch?: string;
	/**
	 * Payload length in bytes, so the studio and the export can total the weight
	 * of a design without loading a face. Exactly {@link AssetInfo.bytes}, for
	 * exactly its reason.
	 */
	bytes: number;
	/** The filename the person chose, for the panel and for a relink. */
	name: string;
	/**
	 * The variation axes the file declares, where they could be read.
	 *
	 * **Nothing reads this but the panel**, and that is the honest scope of
	 * variable-font support here: it prints `wght 100–900` beside the family so
	 * a designer knows what numbers the `weight` property will do something
	 * with. It is populated for `.ttf`/`.otf` and absent for `.woff2` (§9.3),
	 * and its absence is not a degradation — the `weight` descriptor above is
	 * what makes the axis work, and that is stored whether or not the axis was
	 * read.
	 */
	axes?: FontAxis[];
}

/** One variation axis, as the file's `fvar` table spells it. */
export interface FontAxis {
	/** The four-character tag, verbatim — `wght`, `wdth`, `opsz`, `slnt`. */
	tag: string;
	min: number;
	max: number;
	/** The default instance's value on this axis. */
	def: number;
}
```

And on `Scene`:

```ts
	/**
	 * The font files this page may set text in — see {@link FontFile}.
	 *
	 * Beside {@link Scene.tokens} rather than among {@link Scene.assets}, and the
	 * difference is what each of the two *is*. `assets` is an **index of what the
	 * nodes reference**: it is derived, `pruneAssets` sweeps an entry no node
	 * points at, and an entry with no node is an orphan. This is a
	 * **declaration**: a designer adds a font and then uses it, in that order, so
	 * an entry nothing references yet is the normal state of a font somebody just
	 * uploaded and not a leak. **There is deliberately no `pruneFonts`** — see
	 * §2.3.
	 *
	 * Absent rather than `[]` on a document that declares none, which is the same
	 * rule {@link SceneNode.lines} and {@link Scene.assets} keep.
	 */
	fonts?: FontFile[];
```

### 2.1 How a `fontFamily` value names one — and why it is not a path

An uploaded font is used by writing a value whose stack begins with the family
name:

```ts
props.fontFamily = single('"Inter Var", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif')
```

The reference from the value to the file is therefore **by family name**, and
the reference from the family name to the bytes is `FontFile.src`, **by path**,
exactly as `ImageRef.src`, `MeshRef.src` and a path-valued `instanceOf` are.
There is one kind of address for bytes in this project and it appears exactly
once, in the declaration.

*Rejected: putting the path in the value* — `fontFamily: single("/assets/InterVariable.woff2")`,
with the CSS family derived from the path by a pure injective function the way
`componentIdOf` derives a node id from `/components/button.component`. It is the
tempting spelling, because it is literally what `instanceOf` does, and it is
wrong here for three reasons that compound:

1. **A `fontFamily` value is CSS that four things write straight through.**
   `PAINT.fontFamily` is `(value) => ({ fontFamily: value })`, and it is called
   by `Artboard.tsx`, by `htmlExport`, by `svgPaint` and by `fontString`.
   `paint.ts` has no scene and must not gain one — it is the one table shared by
   everything that paints, and its whole value is that a renderer does not have
   to look anything up. A path in the value makes every one of those four learn
   a project-dependent lookup, and the one that cannot learn it is `fontString`,
   which lives in `design-core` and must stay pure.
2. **It breaks the property `ValueTypeSpec.options` is documented for**: *"a
   value typed before the list existed still paints"*. A document opened without
   its `fonts` — an older document, a paste into another project, a scene handed
   to a headless test — would paint nothing at all, where today it paints the
   stack it holds.
3. **A path names a file and a `fontFamily` names a family.** They are not the
   same arity. Regular and Bold are two files and one thing a designer chose, and
   the `weight` property is what moves between them. A path-valued `fontFamily`
   makes that unspellable and pushes every static family into the faux-bold
   failure §9 exists to avoid.

The consistency with `instanceOf` is kept where it is real — one address for
bytes, a path, in the declaration — and abandoned where the analogy stops:
`instanceOf` names a *document*, and a document has one identity. A font value
names a *typeface*, which is a set.

*Rejected: keying `Scene.fonts` as `Record<family, …>`.* A family is a set of
files, so the key would have to hold a list, and the common case — one variable
file — would be a one-element list at every read. A flat list of files with a
shared `family` string says the same thing with no nesting, and the "which files
make this family" question is one `filter` where it is asked (twice: the
`@font-face` writer and the panel).

### 2.2 Where the bytes go, and what already works

`putNamedAsset(file.name, bytes)` → `/assets/InterVariable.woff2`, unchanged,
suffixing a collision, answering the path that was taken. `resolveAsset(path)`
reads them back. `vfs`'s `BINARY` set and `MIME` table already list all four
font extensions. **No change to `store.ts` and no change to `vfs`.** That is
worth stating: the tree has been able to hold a font since before this document,
and what was missing was a document that could say so.

### 2.3 Why there is no `pruneFonts`

`pruneAssets` exists because `Scene.assets` is a cache of node references and a
stale entry is a lie. `Scene.fonts` is not a cache: a designer uploads a font
before setting anything in it, and sweeping an unused entry on the next edit
would delete a font between the upload and the first use of it. Removal is
explicit, in the Fonts panel, and it does **not** delete the file from the tree —
another page may declare the same file, and `putNamedAsset` has no counterpart
that removes.

### 2.4 The roster is per page, and that is a limitation, not a design

`Scene.fonts` is on the scene, so it is per page, exactly as `tokens` and
`styles` are. A font added on `main` is not in the menu on `about`.

This is the same limitation tokens already have and it is left for the same
reason: fixing it means a project-level document and a splice pass at the edge,
which is what `composeLibrary` is for components and which is a bigger change
than fonts. What is named here is (a) the shape of the fix — a `/fonts.index`
document spliced by the same kind of edge function — and (b) the mitigation that
costs nothing and is in scope:

**The Fonts panel lists the font files in the project's tree, not only the ones
this page declares.** The bytes are shared already; adding a font to a second
page is "Add to this page" against a file that is there, not a second upload that
`putNamedAsset` would suffix into `InterVariable-2.woff2`. This is the first
thing in the studio that lists `/assets` at all — `Inspector.tsx` says so, at
length, where it explains why there is no relink button — and it is deliberately
scoped to fonts rather than becoming the file browser that comment asks for.

---

## 3. The pure module: `design-core/src/fonts.ts`

A new file beside `assets.ts`, and it takes that file's opening claim verbatim:
**nothing here does any I/O.** Every function is a pure reading of a `Scene`,
which is what keeps it in a package whose tsconfig `lib` has no "dom", and what
makes the interesting questions testable headlessly.

```ts
/** Every family this page declares, by name. */
export function fontFamilies(scene: Scene): Map<string, FontFile[]>

/**
 * The first family a CSS font stack names, unquoted — `"Inter Var", serif` is
 * `Inter Var`.
 *
 * A parse rather than a split on commas, because a family name may contain one
 * inside quotes. Nothing for a stack that is empty or unreadable, so a caller
 * falls back rather than treating `""` as a family. This is the *whole* of the
 * CSS this file parses, and it is deliberate: a `fontFamily` value is a
 * declaration the renderers write through, and anything here that understood
 * more of it would be a second CSS engine to keep in step with the browser's.
 */
export function familyOf(stack: string): string | undefined

/** What a menu calls a stack that is on no list: its first family, or itself. */
export const familyLabel = (stack: string): string => familyOf(stack) ?? stack;

/**
 * The stack a designer's chosen family becomes when it is put in a value.
 *
 * The tail is a real CSS fallback and is chosen in the panel from the four
 * system stacks, because it is what gets painted while the face loads, what
 * gets painted if the file never arrives, and what an SVG export paints always
 * (§7.3). A stack with nothing behind the uploaded name would make all three of
 * those the browser's default serif.
 */
export const fontStack = (family: string, fallback: string): string =>
	`${quoteFamily(family)}, ${fallback}`;

/**
 * The same stack with every family this document declares and the host has not
 * loaded taken out of it.
 *
 * **This is the measurement fix, and §5 is why it is a string transform rather
 * than a flag.** The browser already skips a family that is not in
 * `document.fonts`, so this changes no pixel the canvas draws and no width the
 * engine reports. What it changes is the *key* those widths are cached under —
 * ours in `prepareCached` and pretext's in `segmentMetricCaches`, which we
 * cannot clear — so a width measured before a face landed can never be served
 * after it lands. The font string is made a function of the font set, which is
 * what it always should have been.
 *
 * Only families in `scene.fonts` are eligible to be dropped. `Georgia` stays
 * whether or not it is installed, because whether it is installed is not
 * knowable and never was — that is the pre-existing situation and this does not
 * pretend to improve it.
 *
 * Every occurrence, not just a leading one: `"Inter", Georgia, "Fraunces",
 * serif` with Fraunces unloaded has to key differently from the same stack with
 * Fraunces loaded, or the middle of a stack is a hole in the invariant.
 */
export function paintedStack(stack: string, unloaded: ReadonlySet<string>): string

/**
 * Families this page declares whose file `held` does not have — the relink
 * list, and {@link missingAssets}'s twin down to the sorted return.
 */
export function missingFonts(scene: Scene, held: Iterable<string>): FontFile[]

/** What this page's declared fonts weigh, without loading a byte. */
export function fontTotalBytes(scene: Scene): number

/**
 * The families a *rendered* scene actually sets text in.
 *
 * Off `ModelNode.rendered.fontFamily` and therefore off the answer set, which
 * is the rule this repo keeps for everything drawn: a rule that mints a text
 * node and gives it a family is a design that uses that family, and a walk of
 * the document would miss it. The exporter's `@font-face` set is exactly this,
 * unioned over the layers an artefact carries.
 */
export function usedFamilies(model: ModelScene): Set<string>
```

`quoteFamily` puts a name in double quotes unless it is a single CSS identifier;
it is not exported, because the only two places that need it are `fontStack` and
the `@font-face` writer, and both are here or in `export.ts`.

---

## 4. The roster, and a value the menu has never seen

### 4.1 Where the merge happens

`ValueTypeSpec.options` is a static list in a pure module and stays one.
`design-core` does not read a project and does not learn to. The merge is in the
**app**, at the one component that renders a menu.

`values.ts`, two changes:

```ts
/**
 * The fonts every document has, whoever opened it: the machine's own families.
 *
 * A curated set rather than a free text field, because typing a font stack by
 * hand is not editing, it is remembering. It used to be the *whole* roster, on
 * the grounds that no webfonts are available offline — which is still true of
 * webfonts and was never true of a font file in the project. A page that
 * declares its own fonts offers those as well, merged in the inspector by
 * `fontOptions`; this list is what is offered when it declares none, and what is
 * always offered underneath, because a system stack is the fallback tail every
 * uploaded family is written in front of.
 */
export const SYSTEM_FONTS: readonly ValueOption[] = FONTS;
```

```ts
/**
 * What a menu calls a stored value, or the value itself if it is not on one.
 *
 * `extra` is a roster the *caller* knows about and this module cannot: a page's
 * uploaded fonts are neither static nor pure, so they arrive as an argument
 * rather than as a row in `VALUE_TYPES`. Searched first, so a project that names
 * a family the built-in list also names gets its own label.
 */
export function optionLabel(
	type: ValueType,
	value: string,
	extra?: readonly ValueOption[],
): string {
	return (
		extra?.find((o) => o.value === value)?.label ??
		VALUE_TYPES[type].options?.find((o) => o.value === value)?.label ??
		value
	);
}
```

An optional third parameter, so all six existing call sites are untouched.

`ValueEditor.tsx` gains one prop:

```ts
	/**
	 * The menu for this row, where the caller knows a longer one than the value
	 * table does. Today that is exactly the `font` type, whose roster is partly a
	 * fact about the open project. Undefined means the type's own list.
	 */
	options?: readonly ValueOption[];
```

and inside, two lines change: `const options = extraOptions ?? VALUE_TYPES[type].options;`
and `const shown = (text) => isLength ? shownLength(text, unit) : optionLabel(type, text, extraOptions);`

Everything else in that component already works. The branch that keeps an
unknown value selectable is already written, and its comment already covers this
case:

```tsx
{/* Anything written before the list existed — an older
    document, a hand-edited value — stays selectable
    rather than silently becoming the first option. */}
```

### 4.2 The five callers

`fontOptions(scene)` is a pure function in the app's design folder, not in
design-core, because it is a *presentation* merge:

```ts
export const fontOptions = (scene: Scene): ValueOption[] => [
	...[...fontFamilies(scene).keys()].sort().map((family) => ({
		value: fontStack(family, /* the page's own tail for it */),
		label: family,
	})),
	...SYSTEM_FONTS,
];
```

The page's fonts come **first**, because a designer who uploaded a font did it to
use it. Passed to `ValueEditor` from the five places that render a `font`-typed
row: `Inspector.tsx` (the appearance row and its styled/overridden twins),
`Styles.tsx`, `Machines.tsx` (a state's delta), `Timeline.tsx` (a keyframe) and
`Variables.tsx` (a `font` token's own definition). All five already have the
scene.

*Rejected: threading the roster into `VALUE_TYPES` at open time*, by making
`VALUE_TYPES` a function of a scene. It is imported by `compile.ts`, `scene.ts`,
`edits.ts` and four components as a constant, `LAYOUT_OPTIONS` writes it into the
generated program at module scope, and a table that varies per project is a table
every one of those has to be handed. The merge is a menu, and a menu is a
presentation concern.

### 4.3 A value the menu has never seen

Three ways to get one, and the same answer serves all three:

- a page that declares `"Inter Var", …` whose `fonts` entry was removed;
- a node pasted from another page, or a component instanced from a document
  whose page declared the font and this one does not;
- a hand-edited value, which the `ValueEditor` has always allowed.

`optionLabel` falls through to the value, which for a font stack is a
forty-character string in a menu. So the fallback is sharpened, in the app's
`fontOptions` caller rather than in `optionLabel`:

**`ValueEditor` labels an unknown `font` value by its first family name.**
`familyLabel('"Inter Var", system-ui, …')` is `Inter Var`. That is what a
designer called it, it is what the panel would have called it, and it is what
the *export* will name in its missing-font sentence. The four system stacks are
on the list and keep their curated labels ("Sans", "Serif"), so nothing regresses.

Concretely, `ValueEditor` is not taught about fonts; `fontOptions` returns
`[...page fonts, ...SYSTEM_FONTS]` and the row's `shown` falls through
`optionLabel` to the raw value — so the sharpening is one line in `ValueEditor`
guarded by the type:

```ts
const shown = (text: string) =>
	isLength ? shownLength(text, unit)
	: type === "font" ? optionLabel(type, text, extraOptions) === text
		? familyLabel(text)
		: optionLabel(type, text, extraOptions)
	: optionLabel(type, text, extraOptions);
```

which is ugly enough to be worth spelling as a helper; the shape that survives
review is `optionLabel(type, text, extraOptions, familyLabel)` — a final
`fallback?: (value: string) => string`. Either is fine; what must be true is that
**no menu anywhere shows a raw font stack.**

---

## 5. The hard one: measurement

### 5.1 What actually breaks

`measureScene` runs synchronously in a `useMemo` on every scene change and its
numbers reach `lask/3`. Ask a canvas for `400 16px "Inter Var", system-ui,
sans-serif` when `Inter Var` is not in `document.fonts` and it silently measures
`system-ui`. Inter is about 4% wider than the macOS system face at the same size
and much wider than it at the same *optical* size; a 900-pixel headline can be
thirty pixels out. Thirty pixels is the difference between a `gap` constraint
holding and a document going unsat, and between two columns fitting and one
wrapping.

That is bad. What is worse is that it is sticky, in two caches:

```ts
const key = `${font}\x00${text}`;              // measureText.ts, 512-entry LRU
const segmentMetricCaches = new Map();          // pretext measurement.js, unbounded
```

pretext's is not clearable — `getSegmentMetricCache` is not on the package's
export surface — so a width measured in the fallback under the real font's key
is there for the life of the page. Re-running `measureScene` after the font
lands would return the *same wrong numbers*, and would look like it worked.

### 5.2 The protocol, in order

Four steps, and the order is the whole of the correctness argument. It is the
same shape `importModel` and `importImage` already have, and `Studio.tsx` names
the principle: *"the ordering is structural rather than remembered."*

1. **Validate.** `const face = new FontFace(family, bytes.buffer); await
   face.load();` A `FontFace` constructed over an ArrayBuffer parses on `load()`
   with no network, and **rejects on a file that is not a font**. That is this
   flow's `parseGltfFile` and its `createImageBitmap`: the check that has to
   happen anyway, done before anything is written, so someone who drops a PDF on
   the panel gets a sentence and a tree that never heard of it.
2. **Write the bytes.** `const src = await putNamedAsset(file.name, bytes)`.
   Before the document, so a refused write cannot leave a `FontFile` pointing at
   a path nothing holds. The reverse — a file with no declaration — is inert.
3. **Register.** `document.fonts.add(face)`. **After the load resolves and never
   before**, which is the single most important line in this document. A
   `FontFace` added while still loading is in the set and not yet usable for
   rendering, so a measurement taken in that window measures the fallback under
   the real name. Adding only loaded faces removes the window entirely: a family
   in `document.fonts` is a family that measures as itself.
4. **Declare.** `onSceneChange(prev => addFont(prev, { src, family, weight, … }))`.
   Last, so the first render in which any value can name the family is a render
   in which the face is already registered.

For the uploader, in the tab they uploaded in, there is now **no gap at all**.

### 5.3 The gap that remains, and what closes it

A collaborator opens the synced project. The uploader reloads the page. A
template ships with a font. In all three the document already declares
`Inter Var`, the bytes are in the tree, and nothing is loaded.

A hook, `useDocumentFonts(scene)`, in `packages/app/src/design/`:

- for each `scene.fonts` entry not already registered, `resolveAsset(src)` →
  `new FontFace(family, bytes)` → `await face.load()` → `document.fonts.add`;
- it returns **`ready: ReadonlySet<string>`**, the families that are loaded in
  *this* document right now;
- an entry whose file is missing or whose bytes will not parse simply never
  joins `ready`, and is not retried on every render.

`Studio.tsx` then:

```ts
const ready = useDocumentFonts(scene);
const readyKey = useMemo(() => [...ready].sort().join("\n"), [ready]);
const measurements = useMemo(() => measureScene(scene, ready), [scene, readyKey]);
```

and `measureScene` gains one parameter, threaded to the two places a font string
is built:

```ts
export function measureScene(
	scene: Scene,
	/**
	 * The families the browser has actually loaded — the host's fact, like the
	 * canvas itself. Every stack is put through `paintedStack` against its
	 * complement, so the engine is asked for a font string that is true of the
	 * font set that answers it. See `docs/framer-fonts-spec.md` §5.
	 */
	ready: ReadonlySet<string> = new Set(),
): Measurements
```

The complement is computed once per pass:
`const unloaded = new Set([...fontFamilies(scene).keys()].filter(f => !ready.has(f)))`,
and both `fontString({ family: paintedStack(prop("fontFamily") ?? ARTBOARD_FONT, unloaded), … })`
call sites use it — the document's own loop and `measureStates`.

`stateMeasures` in `design-core` is **not touched**. It hands back `TextRow`s
with a `family?: string`, documented as *"the fallbacks are the host's to supply
and not this side's to guess"* — and which faces a browser has loaded is exactly
such a fallback. The strip belongs at the boundary where the host builds the
string, and putting it there keeps the analysis pure and keeps the diff to two
lines in one file.

### 5.4 What the document does in the gap — the claim that matters

**The design is never measured in a font it is not being painted in.**

That is a stronger and simpler statement than "there is a brief window of wrong
geometry", and it is what §5.3 buys. During the gap:

- the browser paints the fallback, because the family is not registered;
- the canvas measures the fallback, because `paintedStack` removed the name;
- the solver places boxes fitted to the fallback, which is what is on screen;
- so the picture, the measurement and the answer set all agree.

The design is *different* from the finished one, in exactly the way it would be
different if a designer had not chosen the font yet. When the face lands,
`ready` changes, `readyKey` changes, `measureScene` re-runs with a **different
font string** — so neither cache can serve the old widths — the exploration
re-solves, and the design settles. That is a re-layout, not a repair.

An unsat during the gap is therefore a *true* statement about the design as
currently painted, not a false alarm, and it clears the same way the geometry
does. So nothing suppresses it, and nothing needs to.

*Rejected: measuring in the real family anyway and re-measuring on load.* This
is what a naive implementation does and it is the poisoning case in §5.1: the
second pass has the same key and gets the same cached wrong widths, so it looks
correct and is not.

*Rejected: blocking the solve until every declared font is ready.* A font whose
file never arrives would block forever, and the repo's rule is the opposite one —
*"a missing asset is a sentence, never a failure"*. A design must open, place,
constrain and export without its files.

*Rejected: clearing `prepared` when a face loads.* It is half the fix — pretext's
own per-font cache is not reachable — and half a cache fix is worse than none,
because it makes the remaining half harder to find. `paintedStack` makes both
caches correct by construction, which is why it is a string transform and not a
`clear()`.

*Rejected: a `pending` flag on `Measured`, beside `dropped`.* `dropped` is an
approximation with an axis to name; this has nothing to drop and the box is not
approximate — it is the right box for the font that is painting. The precedent
for "an approximation with nothing to drop" is `measurementNotes`, and §5.5 uses
it for the case that really is one.

### 5.5 The permanent gap: a file that never arrives

A family whose file is not in the project — never synced, deleted, a page
imported without its assets — never joins `ready`, so it is stripped from every
measurement forever and the design is permanently set in the fallback tail. That
is the right behaviour and it must not be silent.

`measure.ts` gains a sibling to `measurementNotes`, worded the same way and for
the same reason — *"the only place the condition exists at all is [outside the
document]"*, and it *"shares the panel's band and its count with the ones clingo
writes"*:

```ts
/**
 * Families this page sets text in whose file the project does not hold.
 *
 * The typographic twin of {@link measurementNotes}, and the same kind of
 * approximation: nothing was dropped and no axis was given up, the boxes are
 * simply hugging a different face than the document names. Unlike that one it is
 * answerable from the document plus the tree, so it needs no answer set.
 *
 * Reported per **family and file**, never per node, because the path is the
 * thing a person can go and find — the same call {@link missingAssets} makes,
 * and the reason a path is better than a hash was better said there.
 *
 * Takes the paths the project holds rather than the loaded set, deliberately: a
 * face that is merely still loading resolves in a frame, and a note that
 * flickers once per page open is noise. What is worth a sentence is a file that
 * is not coming.
 */
export function fontNotes(scene: Scene, held: Iterable<string>): string[]
```

producing, for each:

> `info: this page sets text in “Inter Var”, whose file “/assets/InterVariable.woff2” is not in this project — so those boxes hug the fallback in the stack rather than the face. A page opened without its assets, or still syncing them, reads this way.`

### 5.6 One thing to verify rather than assume

pretext's measuring context is `new OffscreenCanvas(1,1).getContext('2d')`, built
at module scope. An `OffscreenCanvas` created in a Window context takes its font
source from the associated document, so `document.fonts.add` reaches it — but
that is a specification detail two layers away from any code in this repo, and if
it were false in some engine the whole of §5 would be silently wrong in exactly
the way §5.1 describes. §11 asserts it directly in the browser rather than
reasoning about it.

---

## 6. What reaches the program: nothing new, and why that is the finding

**No new ASP term. No new `#show`. No new literal bridge. No new ASP constant.**

A `fontFamily` is already a `Value`, so it already reaches the program the way
every value does — `alt_literal/3` → `resolved(prop(N,fontFamily), L)` →
`rendered(N,fontFamily,L)` — and `rendered/3` is already shown, at
compile.ts:4956:

```
"#show rendered(N,P,L) : rendered(N,P,L), scenery.",
```

`ModelNode.rendered.fontFamily` is therefore already the family a node is drawn
in *in this universe, including where a rule decided it*, which is what both the
canvas and both exporters read today. The exporter's `@font-face` set is a fold
over that (§3, `usedFamilies`), joined to `scene.fonts` by family name in
TypeScript, where the join belongs.

The load-bearing consequence, and the one the test plan pins:

> **`compile(scene).generated` is byte-identical with and without a font
> roster.** Adding a font adds no atom, no `alt/2`, no `pick/2` and **zero
> universes** — not by a rule that was written to hold it, but because a
> declaration that no part of the compiler reads cannot change a program. A
> `font` *token* holding two families is two universes, and it was two universes
> before this document existed; that is the value system working, and it is the
> only way fonts branch the space.

### 6.1 The one predicate that was considered, priced, and left out

`wearsfont(N,F)` — which family each node came out in, as a term — would let a
designer write the classic rule:

```
viol(too_many_faces) :- #count{ F : wearsfont(_,F) } > 3.
```

That is a real design constraint and exactly the kind this tool exists for. It
costs: a `famof(L,"Inter Var")` fact per literal that names a declared family
(one line in the literal loop, guarded on `scene.fonts`), one derivation rule,
one `#show`, one `ModelScene` field and one reader.

It is **out** for two reasons. The first is that it would be the seventh entry in
a family whose defining comment reads *"a literal has no type and the reader is
chosen by what the value **is** rather than by who is asking"* — and `famof/2`
cannot be that, because "is this text a font stack" is not decidable from the
text. It would be the first bridge that consults the document, and that is a
change to what a bridge means, made for a rule nobody has asked for.

The second is `asset/2`'s lesson, applied in the other direction. That predicate
was read for months and shown for none of them, and the commit that fixed it
argues that a `#show` ships with its reader. The converse discipline is the same
discipline: **a `#show` without a reader is dead weight in the one part of the
system where dead weight is invisible.** When somebody wants the rule, the
predicate and its reader arrive in one commit, the way `meshpart/3` did.

The 90% that costs nothing: the Fonts panel prints how many families this page
declares and how many the shown universe uses. That answers "am I using four
typefaces" for a human, today, with no atoms.

---

## 7. Export

### 7.1 HTML: the face is in the file

`ExportOptions` gains a field beside `images`, and the doc comment reuses that
field's argument because it is the same argument:

```ts
	/**
	 * The bytes behind every font the design sets text in, by the tree path
	 * {@link FontFile.src} names.
	 *
	 * A second map beside {@link ExportOptions.images} rather than one merged
	 * one, for the reason `assetPaths(scene, kind)` takes a kind: the panel knows
	 * which target is selected and therefore which payloads that target can
	 * possibly use, and the SVG target wants the pictures and none of the faces
	 * (§7.3). One map would make choosing the light target fetch a megabyte of
	 * type.
	 *
	 * A family whose bytes are absent is a design that comes out in its fallback
	 * stack, named in `lost` rather than left to be discovered by a reader whose
	 * headline does not fit.
	 */
	fonts?: Readonly<Record<string, Uint8Array>>;
```

The stylesheet gains a block, **unshifted before `BASE_CSS`** so a face is
declared before `.design` sets `font-family` on it:

```ts
const css: string[] = [...fontFaces(index, layers, options.fonts ?? {}), BASE_CSS];
```

and each rule is exactly:

```css
@font-face {
	font-family: "Inter Var";
	src: url(data:font/woff2;base64,d09GMgABAAAAA…) format("woff2");
	font-weight: 100 900;
	font-style: normal;
	font-display: block;
}
```

Five descriptors, and four of them are decisions:

- **`src` with `format()`.** The `format()` hint is what browsers actually
  dispatch on, and it is why a wrong MIME in a `data:` URI is survivable. Written
  from the extension: `woff2`→`woff2`, `woff`→`woff`, `ttf`→`truetype`,
  `otf`→`opentype`. An extension not in that table gets the data URI with
  `application/octet-stream` and **no** `format()` clause, so the browser sniffs
  rather than being told something false.
- **`font-weight` and `font-style` verbatim from `FontFile`.** §2 and §9.
- **`font-stretch`** emitted only where the entry has one.
- **`font-display: block`, not `swap`.** This is the one non-obvious choice and
  it follows from what an export *is*. The geometry in an exported file is
  literal pixels — `ALWAYS_LOST` says so — measured in the real face. `swap`
  paints the fallback into boxes fitted to Inter, which overflows them, and then
  reflows; `block` shows nothing for a moment and then shows the design. Since
  the face is a data URI in the same file, "a moment" is a parse, not a network
  round trip. An export is not a page with a Largest Contentful Paint budget; it
  is a picture of a design, and a picture that is briefly blank beats one that is
  briefly wrong.

Only the families the artefact actually uses are written —
`usedFamilies(layer.universe.model)` unioned over every layer the artefact
carries, so a `collapseSpace` export that holds three universes carries the
faces all three need and no more. A roster entry the design does not set anything
in is not in the file.

`dataUrl` already does chunked `btoa`; its `IMAGE_TYPES` lookup becomes
`MEDIA_TYPES` with the four font extensions added, and its `?? "image/png"`
fallback becomes a parameter, because "an unknown extension is a PNG" is a
reasonable guess about a picture and a nonsense one about a face.

*Rejected: a second `fontDataUrl` beside `dataUrl`.* Two functions that turn a
path and some bytes into a data URI is two answers to "what is at this path",
which is the exact duplication `store.ts` congratulates itself on removing.

### 7.2 The size cost, said twice on purpose

Once as a fact about the **format**, in `EXPORT_TARGETS`, because it is true of
every HTML export of every design that uses an uploaded font; and once as a fact
about the **document**, in `lost`, with the real numbers. That asymmetry is
already the file's own — `EXPORT_TARGETS.svg.loses` carries the unconditional
sentences and `GRID_LOST`/`missingImages` carry the conditional ones, and the
comment beside the SVG machine loss explains the split: *"One sentence about the
format beats N about the documents it cannot hold."* Here both halves have
something different to say, so both are said.

`EXPORT_TARGETS.html.loses`, amended and extended. The existing entry is now
half wrong and must change:

```ts
		loses: [
			// Was: "…and will re-wrap if a font is missing." That is no longer true
			// of a font this project holds — it is in the file — and it is still
			// true of a family the design only names. The sentence is split along
			// exactly that line, because "which of my fonts travel" is the question
			// a designer opening this panel is actually asking.
			"Text is placed in a fixed box: it wraps the way the canvas measured it. A font you imported travels in this file, so it wraps the same everywhere; a system family — Georgia, system-ui — is whatever the reader's machine has, and text set in one re-wraps where it differs.",
			"A font you imported is written into this file as base64, which is a third larger than the file itself: a 250 kB woff2 adds about 330 kB, and a variable .ttf of 800 kB adds about 1.1 MB. Once per family, however many nodes wear it, and nothing is fetched — the file needs no network at all.",
		],
```

and the conditional per-document sentence, built beside `missingImages` and
pushed into the same list:

> The fonts are in this file. “Inter Var” (247 kB) and “Fraunces” (612 kB) are
> inlined as base64, which is about 1.1 MB of this file's 1.3 MB.

and, for a family whose bytes the caller did not hand over, `missingFonts`
mirroring `missingImages` word for word:

> This design sets text in “Inter Var”, and those bytes were not available when
> this file was written — so the words come out in the rest of their stack, in a
> box that was measured for the face. A project still syncing its assets, or
> opened without them, exports this way.

The second clause of that sentence is the one that earns it: for an image, a
missing payload is an empty box at the right size; for a font it is text at the
*wrong* size in a box that does not fit it, which is a worse artefact and a
harder one to diagnose.

### 7.3 SVG carries no faces, and says so

**The SVG target does not inline fonts.** One sentence is added to
`EXPORT_TARGETS.svg.loses`, unconditional like its neighbours:

```ts
			"A font you imported is not in this file. An SVG names the family and leaves the face to whatever opens it, so text set in a font of yours is drawn in the rest of its stack — and because the geometry here was measured in the real face, the words will not fill the box they were fitted to. Export HTML if the typography is the point, or outline the text in a vector editor.",
```

Two reasons, and the second is the real one:

1. **It would not be an SVG any more.** This target exists to be a picture
   somebody pastes into a deck, a README or an issue. A third of a megabyte of
   base64 per family, in a format whose selling point is that it is small and
   text, is not a trade this target should make silently. It is already the
   deliberately unfaithful target: it inlines every treatment instead of using
   classes, drops shadows, does not wrap text, computes baselines from the font
   size, and carries no behaviour at all. One more honest sentence fits; a
   megabyte does not.
2. **It would only sometimes work.** An SVG loaded as a document or inlined into
   HTML honours `@font-face` in a `<style>`; an SVG used as `<img src>` or as a
   CSS `background-image` is in a resource-restricted mode whose treatment of
   `data:` font sources differs between engines. A feature that works in the
   paste and not in the `<img>` is worse than one that is absent, because the
   absent one is documented.

*Rejected: converting text to outlines in the SVG target*, which is the answer a
designer actually wants and which would make the target faithful. It needs a
shaping engine — glyph outlines, the `cmap`, kerning, `GSUB` — inside
`design-core`, and that package's whole discipline is that it takes no such
dependency: `export.ts` already declines to render a 3D scene for exactly this
reason and takes a `posters` option instead. The honest sentence points at the
vector editor that already does it.

---

## 8. Upload, and no fetcher

**Upload. Plainly, and with nothing promised for later.**

There is no Google Fonts fetcher in this design and none is planned. A designer
who wants Inter downloads it — Google Fonts serves the files from its own site,
and every foundry does — and uploads it, exactly as they upload a photograph and
a chair.

Four reasons, in the order they matter:

1. **The design would depend on a network the document does not control.** This
   tool is local-first. A fetched family is a family a collaborator on a train
   does not have, so the *same document* would have different geometry for two
   people — and because §5 makes measurement follow what is loaded, it would
   genuinely be two different designs, with two different answer sets. Every
   other payload in this project is a file in the tree for precisely this reason.
2. **An export would stop being self-contained.** The HTML target's whole
   claim is that it is one file that needs no network; a fetched font would make
   it a file with a `@import` in it, or would inline bytes we downloaded on the
   designer's behalf, which is worse than either.
3. **The document model has no way to spell "fetch this later".** `ImageRef`,
   `MeshRef` and `instanceOf` all name a path in the tree. A URL would be the
   first reference in this document that is not one, and it would need its own
   cache, its own staleness story and its own missing-asset sentence.
4. **Bundling a font into an exported file is a redistribution.** Most webfont
   licences permit it and some do not, and it is the designer's call. Uploading a
   file is that call being made; fetching one on their behalf and then inlining
   it into an artefact they hand to a client is the tool making it for them.

What upload does *not* solve is discovery — there is no browsable catalogue —
and that is the honest cost. The mitigation is the panel's own sentence (§10.2)
and the fact that a font file is the one asset type a designer already has on
disk.

---

## 9. Variable axes: what is in, and what is not

### 9.1 What is in, and it is almost free

The `weight` property already exists, is `styleable`, is `inherited`, is in
`MEASURED_PROPS`, and paints as `fontWeight`. A variable face with a `wght` axis
responds to `font-weight: 437` with no code anywhere — **provided the
`@font-face` rule declares the range.** That is the entire feature, and it is one
descriptor written from one stored string.

So what is in scope is exactly:

- `FontFile.weight` holding the descriptor verbatim (`"100 900"`);
- the `@font-face` writer emitting it;
- `FontFile.axes` populated where it can be read, printed by the panel so a
  designer knows the range;
- the Fonts panel's editable weight field with a live preview strip.

And one sentence that is the reason any of it matters here rather than in a
normal design tool:

> **`weight: ["300","700"]` is two universes, and with a variable face they are
> two real weights rather than one real one and one the browser faked.** The
> design space has always been able to hold "light or bold"; a variable font is
> what makes both points of it a thing the type designer drew.

### 9.2 What is out, and why

**Arbitrary axes via `font-variation-settings` — out.** It would need a new
`PropName` whose value is a whole declaration (`"wght" 437, "opsz" 14`), which is
a string a designer edits by hand — the exact objection `ValueTypeSpec.options`
raises about font stacks and shadows. And a per-axis property list is not
statically knowable: `PROPS` is a fixed `Record<PropName, PropSpec>` read by
`compile.ts`, `measure.ts`, `export.ts`, `paint.ts`, the machine deltas and the
keyframes, and making it vary per project is a change to the deepest table in the
document model. That is a much larger feature than fonts, for the sake of
`opsz` — which browsers already drive from `font-size` automatically — and
`GRAD`, `slnt` and whatever a foundry invented.

**A slider on the weight row bounded by the family's axis range — out.** It
needs the row to know which family *this node* resolved to *in this universe*,
which is a cross-property, per-universe dependency that a `ValueEditor` row
deliberately does not have: a row is about one variable. The 90% at nothing: the
Fonts panel prints `wght 100–900` beside the family, and the weight field already
takes any number.

**Italic as a property — out of this spec, and priced.** A second file with the
same `family` and `style: "italic"` is already expressible in §2 and already gets
its `@font-face`; what is missing is anything in `PROPS` that can select it. A
`fontStyle` property would be one row in `PROPS`, one line in `PAINT`, one in
`DOCUMENT_BASE` — and one in `MEASURED_PROPS`, which is the part that makes it
not free: italic changes advance widths, so it becomes a measurement axis, which
touches the budget arithmetic in `capAxes`/`stateBudget` and every test that
counts rows. It adds no universes (a single-alternative value is no axis), so the
invariant holds; it is out because `MEASURED_PROPS` growing is the one thing that
touches the part of this feature that is actually hard, and it should not
piggyback on it.

### 9.3 Reading the file, and the decision not to try very hard

The descriptors are stored, editable, and defaulted. Defaulting them:

- **`.ttf` / `.otf`** are raw SFNT. Walking the table directory to `fvar` (axis
  tags and ranges), `OS/2` (`usWeightClass`, the italic bit) and `name`
  (nameID 16 then 1, for a label) is about 120 lines with no dependency, and
  Google Fonts' variable downloads are `.ttf` — so this is the common case for
  someone uploading a variable font.
- **`.woff`** is per-table zlib. `DecompressionStream('deflate')` exists, so it is
  reachable, asynchronously, for another thirty lines.
- **`.woff2`** is Brotli, and no web API decompresses Brotli. Reading its tables
  needs a Brotli decoder in the bundle.

**Decision: parse SFNT, do not carry a Brotli decoder, and do not ask a modal.**
A `.woff2` gets its family label from the filename stem, its weight from a
filename heuristic (`[wght]`, `Variable`, `VF` → `"100 900"`, a trailing
`Bold`/`Light`/`Medium` → the matching number, otherwise `"400"`), its style from
a trailing `Italic`, and lands in the panel with those fields editable and a
preview strip beside them.

The reason this costs nothing that matters is the one stated on
`FontFile.family`: **the family name is ours.** `new FontFace(name, bytes)` names
the face whatever we say, so a misread `name` table cannot produce a design that
does not paint — only a label a designer corrects. The one field where being
wrong has a consequence is `weight`, and that is exactly the field the preview
strip is under.

*Rejected: a modal on upload that asks for the family and the range.* It is a
form in front of a drag-and-drop, it asks a question most people cannot answer
about a `.woff2` they downloaded, and the answer is visible in the panel a second
later anyway.

---

## 10. The UI surface

### 10.1 Where fonts live: a fifth panel

`PANELS` in `Studio.tsx` gains `{ id: "fonts", label: "Fonts" }` after
`variables`, and `Fonts.tsx`/`Fonts.module.css` join the design folder.

*Rejected: a section inside the Variables panel.* A `font` token and a font file
are different things — one is a variable that may hold two families, the other is
a face the project holds — and putting them in one panel would make "add a font"
and "add a font variable" adjacent buttons that do unrelated things.

### 10.2 What the panel shows

Three groups, and the middle one is the thing §2.4 bought:

1. **This page's fonts.** One row per `FontFile`: the family, the filename, the
   size, the weight descriptor and style in editable fields, the axes if they
   were read (`wght 100–900 · opsz 14–32`), and a **preview strip** — the family
   name set at 100 / 400 / 700 / 900 — which is how a wrong `weight` descriptor
   is caught in five seconds rather than in an export. A row whose file is
   missing carries the `fontNotes` sentence and the path. "Remove from page"
   removes the declaration and leaves the file.
2. **In this project.** The font files in the tree that this page does not
   declare, from the project snapshot filtered by extension, each with "Add to
   this page". This is the studio's first listing of `/assets` — deliberately
   scoped to fonts, and deliberately not the file browser `Inspector.tsx` says
   the app has yet to grow.
3. **Add a font.** A file input with `accept=".woff2,.woff,.ttf,.otf,font/woff2,
   font/woff,font/ttf,font/otf"`, and one sentence under it that says the thing
   §8 decided out loud: *"Fonts are files you add to this project — they sync
   with it, they work offline, and they travel inside an exported HTML file.
   There is no font catalogue here: download the family you want from its
   foundry or from Google Fonts and add the file."* Plus the size note: *"A
   `.woff2` is several times smaller than the `.ttf` of the same face, and an
   export carries whichever you add."*

Failure reports through `setImported` — the existing "what the last import could
not bring across" channel — because from where the designer is standing "this
did not come in" is the same question whether it was a chair or a typeface.

### 10.3 Everywhere else

- Every `font`-typed `ValueEditor` row gets `options={fontOptions(scene)}`
  (§4.2). No other change; the menu, the alternatives, the token link, the pin
  and the why-probe all already work, because a font value is a value.
- The status line shows `fontNotes` beside `measurementNotes`, in the same band
  and the same `info:` voice, counted by the same `countDiagnostics`.
- The export panel fetches font bytes for the HTML target and not for SVG,
  through `fontPaths(scene)` and the existing `usePathBytes`.

---

## 11. The test plan

Colocated `*.test.ts`, `node --test` + `node:assert`, through the real solver
where the claim is about the program.

**`design-core/src/fonts.test.ts`** — new file:

- `"a declared font is a family and a file, and the file is a path"`
- `"a stack's first family is what a menu calls it"` — `familyOf` over
  `'"Inter Var", system-ui'`, `"Georgia, serif"`, `'"Fira Code", monospace'`,
  `""`, and a name with a comma inside quotes.
- `"two files agreeing on a family are one family with two faces"` —
  `fontFamilies` returns one key with two entries.
- `"a family the host has not loaded is taken out of the stack, wherever it sits"`
  — `paintedStack` on a leading, a middle and a trailing occurrence.
- `"a system family is never taken out, loaded or not"` — `Georgia` survives
  because it is in no `Scene.fonts`.
- `"a font whose file the project does not hold is named by its path"` —
  `missingFonts`, sorted.

**`design-core/src/fonts.test.ts`, the invariant group** — these are the ones
that must not be allowed to rot:

- `"the generated program is byte-identical with and without a font roster"` —
  `compile(scene).generated === compile({...scene, fonts: [threeFiles]}).generated`.
- `"declaring three fonts adds no universes"` — solve both, assert the model
  count is equal, in the shape `measure.test.ts` already uses for its
  `async` solver tests.
- `"a font declaration mints no alt/2 and no pick/2"` — assert the generated
  text gains no `alt(` and no new `#show`.

**`design-core/src/measure.test.ts`** — additions:

- `"the font shorthand is built from the stack the host can actually paint"` —
  `fontString({ family: paintedStack(stack, unloaded), … })` omits the unloaded
  name. Headless, on the string, which is the whole point: the bug this prevents
  is a cache key, and a cache key is a string.
- `"the same words in the same design get two different font strings before and
  after a face lands"` — the direct assertion that neither cache can serve a
  stale width.
- `"a state copy's row goes through the same strip"` — a `TextRow` whose family
  is an unloaded declared family, through `measureStates`' path.
- `"a font that is not in the project is one note, whatever wears it"` —
  `fontNotes` groups by family and file, not by node.

**`design-core/src/export.test.ts`** — additions:

- `"a design that sets text in an imported font carries the face"` — the HTML
  output contains `@font-face`, `font-family: "Inter Var"`,
  `src: url(data:font/woff2;base64,`, `format("woff2")`, `font-weight: 100 900`
  and `font-display: block`.
- `"a family the design declares and does not use is not in the file"`.
- `"a family used only in the second collapsed universe is still in the file"` —
  the union over layers.
- `"a face whose bytes the caller did not hand over is named, not silently
  absent"` — the `missingFonts` sentence in `lost`, and no `@font-face` for it.
- `"the size note names the families and the kilobytes"`.
- `"an SVG names the family and carries no face"` — no `@font-face` anywhere in
  the SVG output, `font-family` present on the text, and the new loss sentence
  in `lost`.
- `"a document with no imported fonts exports exactly what it exported before"` —
  the regression that keeps the four system stacks unchanged.

**`app/src/design/measureText.test.ts`** — new file, headless over the pure
parts only (there is no canvas in `node --test`):

- `"the prepared cache key is a function of the font set"` — assert the key
  string differs for the same node before and after a face is in `ready`.

**`app/e2e/studio.spec.ts`** — one scenario, and it is the only place §5.6 can be
answered:

- `"a font added to a page changes the box the solver fits"` — `setInputFiles`
  a fixture font, wait for the Fonts panel row, assert the selected text node's
  rendered width changes and the artboard re-solves.
- **A fixture is required and it must be chosen, not grabbed.** It has to be a
  font whose metrics differ *visibly* from `system-ui` on the CI browser, or the
  assertion passes vacuously whether or not `document.fonts.add` ever reached
  pretext's `OffscreenCanvas`. A condensed or a monospace face at a large size is
  the right shape; a small subset of one keeps the repo light. The assertion to
  write is a width **inequality against a threshold**, not a snapshot.

---

## 12. Every decision, and what it cost

| Decision | Rejected alternative | Reason |
| --- | --- | --- |
| A `fontFamily` value stays a CSS stack | The value holds a path, like `instanceOf` | Four renderers write it through, one of them in a pure package; and a family is a *set* of files, which a path cannot name |
| `Scene.fonts: FontFile[]`, a declaration | `Record<family, …>`; folding into `Scene.assets` | A family is a set of files; and `assets` is a swept index of node references, which a declaration is not |
| No `pruneFonts` | Sweeping unreferenced entries | Would delete a font between the upload and the first use of it |
| Per page, like tokens | A project-level `/fonts.index` spliced at the edge | Real limitation, named; the mitigation (list the project's font files in the panel) costs nothing and is in scope |
| Descriptors stored verbatim as CSS | `{min,max}` structures | One string, one field, one thing that can be wrong; the same call `SHADOWS` makes |
| `document.fonts.add` only after `load()` resolves | Add then load | Removes the window in which a family is named and not yet usable, which is the poisoning window |
| `paintedStack` strips unloaded families from the measured string | Clearing `prepared` on load; a `pending` flag; blocking the solve | pretext's cache is unreachable, so the fix has to be the key; and a design must open without its files |
| No new ASP | `wearsfont/2` + a `famof/2` bridge | A bridge that consults the document is a different thing; and a `#show` without a reader is invisible dead weight — `asset/2`'s lesson, run the other way |
| `font-display: block` | `swap` | The geometry is baked for the real face, so `swap` paints the fallback into boxes it does not fit |
| Only used families are inlined | Every declared family | A roster entry the design does not use is a third of a megabyte of nothing |
| SVG carries no faces | Inlining them; outlining the text | It would stop being a small pastable picture, and it works in some SVG contexts and not others; outlining needs a shaping engine in `design-core` |
| Upload | A Google Fonts fetcher | Local-first: a fetched family is two different designs for two collaborators, and a non-self-contained export |
| Parse SFNT only | A Brotli decoder for `.woff2`; a modal that asks | The family name is ours, so a misread label is a field to fix, not a design that does not paint |
| `weight` descriptor + axes shown | `font-variation-settings` as a property | It needs `PROPS` to vary per project, which is a change to the deepest table in the model, for `opsz` |
| Italic left out | `fontStyle` in `PROPS` | It is cheap except for `MEASURED_PROPS`, which is the one part that touches the hard problem; it should not ride along |

---

## 13. The order of work

Each step leaves the repo green.

1. `FontFile`, `FontAxis`, `Scene.fonts`, `normalizeScene` tolerating absence,
   `addFont`/`removeFont` in `edits.ts`. **The invariant tests from §11 land
   here**, before anything can read the field, so "a font adds no universes" is
   asserted against a compiler that has not been touched.
2. `design-core/src/fonts.ts` and its tests. Still nothing reads it.
3. `SYSTEM_FONTS`, `optionLabel`'s third parameter, `ValueEditor`'s `options`
   prop, `fontOptions` and the five call sites. A page can now *name* a family it
   has no bytes for, which paints as its fallback — correct, and the state a
   collaborator without the assets is in permanently.
4. The Fonts panel, `useDocumentFonts`, the upload flow in the §5.2 order, the
   SFNT reader. A font now loads and paints.
5. `measureScene(scene, ready)` and `paintedStack` at the two `fontString` call
   sites; `fontNotes` in the status line. A font now *measures*, and §11's e2e
   scenario becomes writable — **and it is the step that must be looked at in a
   browser**, because §5.6 cannot be answered headlessly.
6. `@font-face` in the HTML target, `ExportOptions.fonts`, `MEDIA_TYPES`,
   `missingFonts`, the size note, the `EXPORT_TARGETS` amendments for both
   targets.

Step 5 before step 6 deliberately: an export that carries a face measured in the
wrong one is a file that is wrong in a way nobody can see until they open it.
