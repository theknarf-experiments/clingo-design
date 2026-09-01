# A link is a field on a node, and a presentation is one design walked page to page

**Status: a design step. No source file was changed for it.** It is written
against the tree at `0f11338`, after multi-page (`c2b3833`) and after components
became documents (`e8c9be8..414c5e9`). Everything it quotes was read in that
tree.

It answers a gap the two of those left in the open: pages exist, components are
shared between them, and **nothing links one page to another, so a prototype
cannot be used.** There is a Preview toggle that runs the machines on the canvas
you are editing, and there is an export that writes one page as one file, and
between those two there is no artefact you can hand somebody.

---

## 0. The thesis, in four sentences

1. A **link** is an optional field on a node naming a page **path**, exactly as
   `instanceOf`, `image.src` and `mesh.src` name things, and a dangling one is
   legal for the same reason a dangling `instanceOf` is.
2. It fires on a **`Trigger`** — the same eight-word vocabulary the machines
   already speak — restricted to the three that can mean "go somewhere", with a
   default that costs the document no field.
3. It reaches ASP as `link/2` and `goes/1`, and `goes/1` is the sentence this
   tool can say that no other design tool can: *in which of my universes does
   this page lead to checkout.*
4. **Present mode is a route**, `p/:id/present/:page`, rendering the artboard
   read-only with the machines live, carrying one design across pages as a pin
   set in the query string — which is also what makes the browser's back button
   work without a line of code.

---

## 1. The link

### 1.1 The type

In `scene.ts`, beside `Trigger` and `TRIGGERS`:

```ts
/**
 * Where a node leads, and what makes it lead there.
 *
 * An object rather than two optional fields on {@link SceneNode}, because `on`
 * is meaningless without `to` and a pair of loose fields is a document that can
 * say so — a node with a trigger and no target, which every reader would then
 * have to decide what to do about. One field, present or absent, has no such
 * state. It is the shape {@link MeshRef} and {@link ImageRef} already have and
 * for the same reason: a reference plus what to do with it is one fact.
 */
export interface NodeLink {
	/**
	 * The page it leads to, as a path in the project's tree —
	 * `/pages/About us.scene`.
	 *
	 * A **path**, which is the third time this codebase has answered this
	 * question the same way, and the reasons have not changed. A page is a
	 * document and the tree is the list of them, so a path is the one name a
	 * page has that nothing else has to agree with; `pathsOfType(SCENE_TYPE)`
	 * is already the page list and a second identifier beside it would be a
	 * second answer that could disagree. It is what `instanceOf` holds when it
	 * names a component document, what `MeshRef.src` and `ImageRef.src` hold,
	 * and what a clone writes to disk.
	 *
	 * **A path that no document lives at is legal and stays legal**, in exactly
	 * the terms `composeLibrary` uses about a definition: "a path an instance
	 * names and the library does not hold is left exactly as it was: a dangling
	 * `instanceOf` derives nothing, which is what deleting a component out from
	 * under its uses has always left behind, and is a great deal better than
	 * refusing to open the page." A dangling link leads nowhere, and leading
	 * nowhere is a thing a document is allowed to say. Repairing it on the way
	 * in would make opening a file an edit that syncs; refusing it would mean
	 * deleting a page could make another page unopenable, which is a far larger
	 * consequence than the deletion anybody asked for.
	 */
	to: string;
	/**
	 * What makes it fire. Absent is {@link DEFAULT_LINK_TRIGGER}, which is
	 * `click`.
	 *
	 * A {@link Trigger} and not a word of its own — see §2. Absent rather than
	 * written out, so the overwhelmingly common link is one field in the
	 * document and the reader supplies the default, the way `hidden` and
	 * `component` are absent rather than `false`.
	 */
	on?: Trigger;
}
```

and on `SceneNode`, immediately after `hidden`, which is the field it most
resembles — an optional, purely additive statement about a node that changes
nothing about what the node *is*:

```ts
	/**
	 * Where this node leads when a prototype is being walked — see
	 * {@link NodeLink}.
	 *
	 * On **every kind**, not a kind of its own. A hotspot tool that drew a
	 * special invisible link rectangle was the obvious alternative and it is a
	 * worse document: it makes "which things can be clicked" a question about
	 * node kinds rather than about the design, so a card that is a frame cannot
	 * be a link without something drawn on top of it, and the thing on top is
	 * then a second object in the layer list that has to be kept aligned with
	 * the first by hand. A link on the frame is the frame leading somewhere,
	 * which is what a designer means and what an `<a>` around a box means in
	 * the file it exports to.
	 *
	 * **Not a {@link Value}, and that is the sharpest decision in this field.**
	 * A `Value` would let a node lead to one page in one universe and another
	 * in another, which sounds exactly like what this document model is for —
	 * and it is not, because it would make every link a `pick`, an `alt/2`
	 * table and a branch of the space, paid for by every link in every document
	 * so that the rare one can vary. The things that are `Value`s are what a
	 * design is *made of*: geometry and properties. The things that are bare
	 * references — `instanceOf`, `style`, `camera`, and now this — are
	 * relations to other objects, and none of them is a `Value`. And the
	 * varying case is not lost: `link/2` is `#defined` in the program, so a
	 * rule can assert one, and "this card leads to A in the compact designs and
	 * to B in the wide ones" is a rule over `pick/2` — which is where a
	 * decision that depends on the design has always belonged.
	 */
	link?: NodeLink;
```

### 1.2 Where the path functions live

`pagePath` and `pageName` are today in `app/src/projects/store.ts`. The compiler
now needs to turn a page path into an ASP constant, and `design-core` may not
import from the app. So a new module:

**`packages/design-core/src/pages.ts`** — "Pages, the links between them, and
how a tree path becomes a legal ASP constant."

```ts
export const PAGE_DIR = "/pages/";
export const pagePath = (name: string): string => `${PAGE_DIR}${name}.scene`;
export const pageName = (path: string): string =>
	path.replace(/^\/pages\//, "").replace(/\.scene$/, "");

/**
 * A tree path, as a constant a program can hold.
 *
 * Lifted out of {@link componentIdOf} unchanged rather than written a second
 * time, and the arithmetic is byte-for-byte what that function already did —
 * `componentIdOf` becomes a one-line call and its output does not move. Two
 * copies of a hash is the thing this codebase rejects everywhere else: it is a
 * second implementation that can disagree with the first, and the disagreement
 * here would be two documents sharing an id, which is one document with the
 * other's references silently pointing at it.
 *
 * The two properties it has to have are the ones `componentIdOf` states.
 * Legal, because it reaches the program as `page(<id>)` and `link(N,<id>)`.
 * Injective, because sanitising is not — `my page` and `my-page` flatten
 * alike — and two pages under one id would be one page.
 *
 * The prefix is what keeps the families apart structurally rather than by
 * hoping the hashes miss: `cmp_` and `pg_` cannot collide however the stems
 * land.
 */
export function aspConstant(prefix: string, stem: string, from: string): string {
	const cleaned = stem
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	let hash = 5381;
	for (let i = 0; i < from.length; i++)
		hash = ((hash << 5) + hash + from.charCodeAt(i)) >>> 0;
	return `${prefix}_${cleaned || "c"}_${hash.toString(36)}`;
}

/** The constant a page's path takes in a program: `pg_about_us_1k3z9`. */
export const pageIdOf = (path: string): string =>
	aspConstant("pg", pageName(path), path);

/** The inverse, over a project's page list — the answer set cannot carry it. */
export const pageIndexOf = (
	paths: readonly string[],
): Record<string, string> =>
	Object.fromEntries(paths.map((p) => [pageIdOf(p), p]));
```

`components.ts` then reads:

```ts
export const componentIdOf = (path: string): string =>
	aspConstant("cmp", componentName(path), path);
```

with its existing essay kept in place and one added sentence saying the
arithmetic moved and why.

`store.ts` re-exports `pagePath`, `pageName` and `PAGE_DIR` from
`@clingo-design/design-core` so the four existing call sites do not churn, with
a one-line note that the definitions moved because the compiler needs them.
`MAIN_PAGE` and `SCENE_TYPE` stay in `store.ts` — the first is a policy about
where a new project's first page goes and the second is a vfs datatype tag;
neither is a pure string function about paths.

### 1.3 Rename repoints; delete dangles

This is the one place where a link is *not* like an `instanceOf`, and the
difference is a fact about the two verbs rather than a preference.

`renamePage` is documented as identity-preserving: "The document itself does not
move — `renamePath` re-keys the directory and leaves the scene alone — so a
page's whole undo history survives being renamed." The page a link points at
still exists and is still the same document; only its address changed. A
reference that keeps pointing at it is *correct*, and leaving it pointing at the
old address makes it wrong for no reason anybody chose. The store already agrees
with this about the other kind of address it holds — `Pages.tsx` navigates the
url on rename, because "leaving the old name in the address bar would be an
address that no longer resolves."

So **`renamePage` rewrites `link.to` in every page document that names the old
path.** It runs inside the store, over `p.pathsOfType(SCENE_TYPE)`, through each
page's own handle, and it is a no-op on every page that holds no such link:

```ts
// After `p.renamePath(...)`, before the cache eviction.
//
// A rename keeps the document, so a link to it is still a link to it and only
// its address moved. Doing nothing here would break every link into a page
// because somebody fixed a typo in its name, which is not an edit anybody
// asked for. This is a write to other pages' documents and therefore an entry
// in their undo histories, which is the honest cost and is the right one: the
// alternative is a repair on read, and a repair on read makes *looking* at a
// project an edit that syncs.
for (const path of p.pathsOfType(SCENE_TYPE)) {
	const handle = p.docAt<SceneDoc>(path);
	handle?.change((draft) => repointLinks(draft.scene, from, to));
}
```

with `repointLinks` a pure walk in `design-core/src/pages.ts` operating on the
Automerge draft in place, in `reconcile`'s style — assign only where it differs,
so a page with no such link produces no change at all and no `updatedAt` bump.

**`deletePage` does nothing of the sort.** There is no document to point at any
more, so a link into it is a link that leads nowhere, and saying so is the
honest state. This is `deleteComponent`'s stance verbatim: "The uses are left
alone, dangling, and that is deliberate ... Silently deleting somebody's
instances because they deleted a definition would be a much larger edit than the
one they asked for." Here the larger edit would be silently un-linking nodes
across the project because one page went away.

The consequence is visible and checkable rather than silent — §3.4 makes
`viol(dead_link)` a rule a designer can turn on, and §9 puts a "Missing page" row
in the Inspector and a marker in the layer list.

### 1.4 What `composeLibrary` must not touch

`composeLibrary`/`decomposeLibrary` rewrite `instanceOf` and splice definitions.
They must not see `link` at all — a link is a page relation, not a component
one — and today they would not, because both use `mapTree` and copy the node
with `{ ...node, instanceOf: id }`. The round-trip test gains one assertion so
that stays true by construction rather than by accident (§10, test 5).

---

## 2. What triggers a link

### 2.1 It reuses `Trigger`, and it is a field rather than a machine

`Trigger` is documented as being the *input* rather than a name of the
designer's own: "a trigger has to mean something to a browser at the far end, or
the export is a picture with a data attribute nobody sets." A link fires on a DOM
event and the export writes an element a browser navigates. Same requirement,
same table, and `TRIGGERS[g].event` is already the exact event name a listener
needs — which is why the studio's preview and the exported runtime cannot
disagree about what a hover is, and why a link should inherit that agreement
instead of restating it.

**A link is not a little machine, and this was seriously considered.** A machine
is a set of states with transitions between them, and a transition's effect is
"the parts look like this" — a `Machine` holds `states`, `layers`, `inputs`,
`timelines`, and every one of its health checks (`munreached`, `mdeadend`,
`mnondet`, `mstopgap`, `mtwosource`) is a claim about *states*. A navigation has
no state to arrive in: it leaves the document. Modelling it as a machine means a
transition whose `to` is not a state, which is an exception in the type, an
exception in `stepMachine`, an exception in `runtime.ts`'s interpreter, and an
exception in each of eleven health rules — for a thing that has one trigger, one
target and no duration. A field with a trigger on it is what it actually is.

It also buys the component case for free, which the machine framing would not
have: §3.3's one-line copy rule makes a link inside a component definition
follow to every instance of it, so a nav bar is a component rather than a thing
pasted onto nine pages.

### 2.2 Three of the eight

```ts
/**
 * The triggers a *link* may fire on.
 *
 * Three of {@link TRIGGER_NAMES}, and the five that are absent are absent for
 * reasons, because a menu with a wrong answer in it is worse than a short menu.
 *
 *   - `pointerup` — `click` is what a person means and what an anchor does
 *     natively; offering both is two rows that differ only in whether a drag
 *     off the button still navigates, which nobody is choosing between.
 *   - `pointerleave` and `blur` — "when you stop touching this, go somewhere
 *     else" is a trap rather than a design, and a prototype built from them
 *     cannot be walked backwards.
 *   - `focus` — the canvas has no focus to give. `Editor.tsx` says so in as
 *     many words about the machines: "an instance is a div in an artboard
 *     rather than a control, nothing is tabbable". A focus link would work in
 *     neither the studio nor the exported file, which is the definition of a
 *     row that should not be offered.
 *   - `load` — a page that navigates the moment it renders is a redirect, and
 *     two pages redirecting at each other is an infinite navigation with no
 *     human act in the loop to stop it. `Studio.tsx` already records that "no
 *     health check catches a load cycle" for machines, where the cost is a
 *     preview that spins; here the cost is a browser that cannot be stopped.
 *     Refused at the vocabulary rather than guarded at the runtime.
 *
 * `pointerenter` stays, and it is the one worth defending: a link on hover is
 * a real thing designers prototype — a menu that opens as you pass it, a
 * gallery that changes as you sweep across thumbnails — and it is exactly the
 * kind of thing that is easy in this tool and impossible to hand to somebody
 * without a prototype mode.
 */
export const LINK_TRIGGERS = ["click", "pointerdown", "pointerenter"] as const;

/** What an absent {@link NodeLink.on} means, in the one place that decides it. */
export const DEFAULT_LINK_TRIGGER: Trigger = "click";
```

`LINK_TRIGGERS` is typed `readonly Trigger[]` by construction; the implementer
should add `satisfies readonly Trigger[]` so a typo is a type error rather than a
menu row nothing fires.

### 2.3 Preview does not follow links; Present does

`SceneNode.state` and playback are already split between "an edit" and "a look",
and this is the same line one step further out.

**Preview stays where it is.** Its whole safety property is that it costs
nothing: "watching a machine run costs no edit, no undo entry and no solve at
all." A navigation is the one thing it has never done, and a designer who is
previewing a hover state and gets thrown onto another page has lost the thing
they were looking at. So while `previewing`, a linked node gets a hover outline
and the status line names its target — you can see the link is wired without
being taken away.

**Present follows them**, because being taken away is what it is for. That
difference is the clearest statement of why the two modes both exist, and it
goes in the Present button's title attribute.

---

## 3. ASP

### 3.1 What is emitted

In `compile()`, inside the `for (const node of flatten(scene.nodes))` loop,
immediately after the `hidden` line, which is the field it sits beside in the
document:

```ts
// Where the node leads. Two facts rather than one with a default written into
// a rule: the program has no opinion about what a link with no trigger means,
// and the two readers that draw one — `model.ts` and the presenter — share
// `DEFAULT_LINK_TRIGGER`. A default rule here would be that constant written
// twice, in two languages, with nothing to notice when they drift.
if (node.link !== undefined) {
	nodeLines.push(atom("link", node.id, pageIdOf(node.link.to)));
	nodeLines.push(atom("linkon", node.id, node.link.on ?? DEFAULT_LINK_TRIGGER));
}
```

And, from `CompileOptions`, the project's page list:

```ts
export interface CompileOptions {
	measurements?: Measurements;
	/**
	 * Which pages this project has, and which one is being compiled — as tree
	 * paths.
	 *
	 * Handed in rather than read, for the reason `ExportOptions.images` is:
	 * the pages are documents in a tree, reaching one is I/O, and this package
	 * does not do I/O. It is the same shape `composeLibrary` takes — a fact
	 * about the project supplied at the edge, so nothing downstream learns that
	 * a project has more than one document in it.
	 *
	 * Absent emits no `page/1` and no `here/1`. `link/2`, `linkon/2` and
	 * `goes/1` are the document's own and are unaffected, so a test that hands
	 * this function a bare scene still gets the whole link story.
	 */
	flow?: { here?: string; pages?: readonly string[] };
}
```

emitting, in a `section("pages", …)` placed beside the node facts:

```
here(pg_home_9wq2).
page(pg_home_9wq2).
page(pg_about_1k3z9).
```

**No `pagename/2`.** It was drafted and cut: nothing reads it, a rule that wants
to talk about a page writes its id whether or not a string sits beside it, and a
quoted name per page is bytes for nobody. The Rules panel can offer
`pg_about_1k3z9 — About us` because it computes *both* sides from the page list
it already has; it does not need the program to tell it a name it supplied.

### 3.2 The rules

A new `LINK_RULES`, emitted as `section("links", …)` after the components
section, because two of its four lines read `instance/2` and `cpart/2`:

```
% ---- links ----
#defined link/2.
#defined linkon/2.
#defined page/1.

% An instance's copy of a definition part leads where the definition part
% leads. The same shape as `kind(inst(I,N),K)` twenty lines above, and it is
% what makes a navigation bar a component instead of a thing pasted onto nine
% pages: one definition, one link in it, and every page that places an instance
% gains the edge. Nothing else had to be built for this, which is the argument
% for a link being a field on a node rather than a mechanism of its own.
link(inst(I,N),P) :- instance(I,R), cpart(R,N), link(N,P).
linkon(inst(I,N),G) :- instance(I,R), cpart(R,N), linkon(N,G).

% Where this design actually leads.
%
% Behind visible/1, and that is the whole reason this is a derived atom and not
% just the fact. A link on a node a rule hid, on a node that only exists in some
% universes, or on a part that the state its instance is drawn in hides —
% `hidden(inst(I,N)) :- mhidden(I,S,N), shown(I,S)` — is a link *this design*
% does not have. So `goes/1` is the answer to "can you get to checkout from
% here", asked of one universe, and the answer may legitimately differ between
% two universes of one document. That is a question no other design tool can
% ask, and it costs one rule.
goes(P) :- link(N,P), visible(N).
```

### 3.3 What is shown, and what is projected

In the output section:

```
"#show goes/1.",
"#show link(N,P) : link(N,P), scenery.",
"#show linkon(N,G) : linkon(N,G), scenery.",
"#project goes/1.",
```

`goes/1` is shown **unconditionally**, beside `#show pick/2.` and
`#show visible/1.`, because it is a decision rather than a picture: it is at
most one atom per page of the project, an exploration wants it on the cheap
solves it fires by the hundred, and a reachability answer that only existed when
somebody asked for scenery would be an answer the multiverse view could not
report.

`link/2` and `linkon/2` are behind `scenery` with the rest of the picture,
because that is what they are — the presenter redraws from them. **They are
shown at all because a rule may assert them**: `#defined link/2.` means a
document with forty cards can have one rule linking each to its detail page, and
the presenter must hit-test the answer set rather than the document or that rule
does nothing. This is `derived.ts`'s stance about nodes, applied to edges, and it
is the reason the app must never read `node.link` for navigation.

**`#project goes/1.` is free and it is correct.** Free, because `goes/1` is
functionally determined by `visible/1` — which is already projected — and by
static `link/2` facts, so it splits nothing on any document whose links are
fields. Correct, because on a document where a *rule* chooses the links, two
designs that lead to different pages genuinely are two designs, and the
projection says so. §10's test 2f asserts the first half by counting universes
before and after a link is added, which is the invariant the whole repository is
arranged around.

Do **not** add `#show page/1.`, `#show here/1.` or `#show linkstated/1.`. The
app knows the page list from the tree, and a `#show` of something nothing reads
is bytes across the worker boundary on every solve. The rule this repository
learned the hard way is the other direction — a *missing* `#show` cost it
`asset/2` and a whole feature (546eb02) — and the three atoms above are shown
precisely because three readers named below consume them.

### 3.4 What a designer can now write

The point of any of this reaching the program:

```prolog
% A design that leads somewhere that is not in this project.
viol(dead_link) :- goes(P), not page(P).

% Checkout must be reachable from the home page, in every design.
:- here(pg_home_9wq2), not goes(pg_checkout_4b1x).

% The pricing link is only offered in the designs that have the wide nav.
link(cta, pg_pricing_7ttk) :- pick(prop(nav,size), 1).
```

The first is what makes §1.3's decision to leave dangling links alone
*checkable* rather than merely tolerated: the document may say it, and the
document may also be told to complain about saying it, which is the split this
tool draws everywhere else between a fact and an opinion about it.

### 3.5 The cost, stated

A document with no links emits nothing, states no `page/1` unless a caller
passes a page list, and grounds `goes/1` over an empty `link/2` — which is
`#defined` and therefore zero atoms. The same sparseness `spatial` claims, for
the same reason and by the same construction.

A document with L links and P pages emits `2L + P + 1` facts and grounds
`goes/1` over L. The two instance-copy rules ground over
`instance × cpart × link`, which is bounded by the number of links inside
definitions times the number of instances — the same order the `kind`, `order`
and `child` copy rules beside them already pay. On the largest thing in the
repository this is single digits.

The one genuine coupling: passing `flow.pages` means adding or renaming a page
changes every other page's program and re-grounds it. That is correct — the
`page/1` facts really did change — and it is the same coupling `composeLibrary`
accepted for components, one degree weaker, because a page list is a handful of
constants where a spliced definition is a subtree.

### 3.6 The contract comment

`compile.ts`'s `%`-block contract (the one that documents `hidden(N)` as
"assert to remove a node") gains a section after **Components**:

```
% Pages and links. A page is a document of the project; the program grounds one
% of them and is told which, and which others exist.
%
%   here(P)                     the page this program is
%   page(P)                     a page this project has
%   link(N, P)                  N leads to page P. Derivable: one rule can link
%                               forty cards to forty detail pages
%   linkon(N, Trigger)          ...on which of click | pointerdown |
%                               pointerenter. A link with none reads as click,
%                               and the default is on the TypeScript side
%                               because two readers draw one and only one of
%                               them is a rule
%   goes(P)                     derived: link(N,P), visible(N) — where this
%                               *design* leads, which is not the same question
%                               as where the document links. Projected.
%
% Which is what lets a document hold an opinion about its own flow:
%
%   viol(dead_link) :- goes(P), not page(P).
%   :- here(pg_home_9wq2), not goes(pg_checkout_4b1x).
```

---

## 4. The model reader

`asset/2` is the exact precedent and it is worth following line for line,
because it is the one that shows what a missing reader costs.

`model.ts`:

```ts
// on ModelNode, beside `asset`
/**
 * Where it leads and on what — `link/2` and `linkon/2`.
 *
 * On the node as well as in {@link ModelScene.links}, for the reason `asset`
 * gives: a presenter walking the tree has the node and wants its edge, and
 * anything auditing a project wants the whole map without walking.
 *
 * `to` is the page's **id**, not its path. An atom's argument has to be a legal
 * constant and a path is not one; the inverse is `pageIndexOf` over the page
 * list, which the app has and the answer set cannot.
 */
link?: { to: string; on: Trigger };
```

```ts
// on ModelScene
/** node id -> where it leads — `link/2` with `linkon/2` folded in. */
links: Record<string, { to: string; on: Trigger }>;
/**
 * Page ids this design reaches — `goes/1`, sorted.
 *
 * The whole of §3.2's argument, as one array: it is what *this universe*
 * leads to, which on a document with a rule that hides things is not what the
 * document links to. Sorted so two readings of one answer set are the same
 * reading, like {@link states}.
 */
goes: string[];
```

Three cases in the atom switch, beside `"asset/2"`:

```ts
case "link/2": { facts.links.set(a, b); break; }
case "linkon/2": { facts.linkOn.set(a, b as Trigger); break; }
case "goes/1": { facts.goes.add(a); break; }
```

and in the node build, beside `...(facts.assets.has(id) ? { asset: … } : {})`:

```ts
...(facts.links.has(id)
	? {
			link: {
				to: facts.links.get(id) as string,
				// The one default, here and in the presenter, from one constant.
				on: facts.linkOn.get(id) ?? DEFAULT_LINK_TRIGGER,
			},
		}
	: {}),
```

### 4.1 Hit-testing, once

`Editor.tsx` has `instanceUnder`, with a good essay about why it is deliberately
not `hitTestTree`. Present mode needs the same answer and must not have a second
implementation of it — that is `runtime.ts`'s argument about the machine
interpreter, one level down. So:

- **Move `instanceUnder` into `design-core/src/tree.ts`** as
  `instanceAt(nodes, point, solved, context): SceneNode | undefined`, essay and
  all, and have `Editor.tsx` call it. No behaviour changes; the function is
  already pure.
- **Add `linkAt` to `pages.ts`**, over the *model* rather than the document:

```ts
export interface LinkHit {
	/** The node the link is on — a document id, or an `inst(I,N)` part. */
	id: string;
	/** The page id it leads to. */
	to: string;
	on: Trigger;
}

/**
 * The link a point is inside, or nothing.
 *
 * Over {@link ModelScene} and not over the document tree, and both halves of
 * that matter. The answer set is where a rule-asserted link exists at all, and
 * it is the only place `inst(I,N)` — a component's linked part — has a box: a
 * navigation bar placed as an instance has its link on a derived part, which
 * `scene.nodes` does not contain.
 *
 * **It walks outward, which is what makes it a link and not a hotspot.** The
 * innermost node containing the point is found first; if it has no link, its
 * ancestors are asked in order. That is exactly what a browser does with a
 * `<span>` inside an `<a>`, it is what a designer means by "the whole card is
 * clickable", and it is why a label lying across a linked frame does not put a
 * hole in it. Paint order settles two *linked* nodes that overlap, backwards,
 * which is the arbiter `hitTestTree` and `instanceAt` already use.
 */
export function linkAt(model: ModelScene, point: Point): LinkHit | undefined;
```

---

## 5. The export

### 5.1 The markup

`htmlBody`'s `render` builds `const open = \`${pad}<div class="${names}"
data-node="…" data-kind="…">\`` and closes with `</div>`. The change is the
element:

```ts
// A link is an anchor, because a link that is not an <a> is not a link: it is
// not in the tab order, middle-click does not open it in a tab, and a screen
// reader does not announce it as one. Everything else about the box is
// untouched — same class, same data attributes, same rule in the stylesheet —
// so this swaps one tag and adds one attribute rather than growing a second
// way for a node to be emitted.
const link = node.link;
const to = link === undefined ? undefined : pages[link.to];
const tag = to === undefined ? "div" : "a";
const href = to === undefined ? "" : ` href="${escapeAttr(`${slug(to)}.html`)}"`;
// Only where the browser will not do it on its own — see LINK_RUNTIME.
const fires =
	to !== undefined && link !== undefined && link.on !== DEFAULT_LINK_TRIGGER
		? ` data-link-on="${escapeAttr(link.on)}"`
		: "";
const open = `${pad}<${tag} class="${names}" data-node="…" data-kind="…"${href}${fires}>`;
```

`ExportOptions` gains:

```ts
/**
 * The project's pages, as page id -> that page's **name**.
 *
 * A name and not a filename, so the two cannot disagree: the href is
 * `${slug(name)}.html`, computed by the same `slug` that computes
 * {@link ExportResult.filename}, so a page exported under its own name and a
 * link to that page produce the same string by construction rather than by the
 * caller remembering to match them.
 *
 * A link whose target is not in here — a page deleted out from under it —
 * exports as an ordinary box rather than as an anchor to a file that is not
 * going to exist, and says so in `lost`. An `<a href>` that 404s is worse than
 * a box, because the box is honest about leading nowhere.
 */
pages?: Readonly<Record<string, string>>;
```

**A link that a rule asserted exports too**, because `render` reads
`node.link` off the `ModelNode`, which came from the answer set. Nothing extra is
needed for that and it is worth a sentence in the code so nobody "simplifies" it
to read the document.

### 5.2 The CSS

One block, appended to `BASE_CSS`, unconditionally:

```css
/* A link is an anchor, so the user agent has opinions about it — a colour, an
   underline and a tap highlight the design did not ask for. Neutralised once
   here rather than folded into each linked node's own rule, so putting a link
   on something never repaints it. Keyed on [data-node] so it says what it
   means: the design's own boxes, not an anchor a rule put inside a text node. */
.design a[data-node] {
	color: inherit;
	text-decoration: none;
	-webkit-tap-highlight-color: transparent;
}
```

Unconditional because it is three declarations on a selector that matches
nothing in a document with no links, and because `BASE_CSS` is a constant — a
conditional here would be a second code path for four lines.

### 5.3 The one script, and when there is none

`click` needs nothing: an anchor navigates on click, which is the whole reason
for choosing an anchor. `pointerdown` and `pointerenter` do, and it is six lines
in `runtime.ts` beside `MACHINE_RUNTIME`, under the same constraints that file
states — ES5, a factory taking a root so it can be driven from Node, and no
timers of any kind:

```ts
/**
 * Links that fire on something other than a click.
 *
 * A second and much smaller script beside {@link MACHINE_RUNTIME}, and it is
 * separate for the reason that one is a table interpreter: this has no table.
 * It is `addEventListener` on whatever the attribute says, which is
 * `TRIGGERS[g].event` for the three of {@link LINK_TRIGGERS} — and it is
 * written as the attribute rather than as a generated `if` per link for the
 * same reason the machine runtime is generic: generated code is a second
 * implementation of the design that can disagree with the first.
 *
 * `pointerenter` does not bubble, which is why this is a listener per element
 * rather than one delegated listener on the root. That is the whole of what
 * would otherwise have been clever here.
 *
 * Emitted only where some link's trigger is not `click`, so the common
 * document — every link a click — gets no `<script>` tag at all. The test
 * asserts that absence, exactly as `runtime.test.ts` asserts `setTimeout`'s.
 */
export const LINK_RUNTIME = `var a = root.querySelectorAll("a[data-link-on]");
for (var i = 0; i < a.length; i++) {
	(function (el) {
		el.addEventListener(el.getAttribute("data-link-on"), function () {
			window.location.href = el.getAttribute("href");
		});
	})(a[i]);
}`;
```

### 5.4 The losses

Three sentences, each conditional on the document actually having the case, in
`ALWAYS_LOST`'s neighbourhood but not in it — "a list of losses that pads itself
is one nobody finishes reading":

```ts
/** Where a document links out and the export is one file. */
const LINKED_LOST =
	"Other pages. A link leads to the file its page exports as — “about-us.html” beside this one — and this is one file. Export every page under its own name into one folder and the links work; until then they lead to a file that is not there.";

/** Where a link's page is gone. */
const DEAD_LINK_LOST = (n: number) =>
	`${n} link${n === 1 ? "" : "s"} point at a page this project no longer has. They come out as ordinary boxes rather than as anchors to a file that is never going to exist.`;

/** The SVG target's, unconditional like its neighbours there. */
const SVG_LINK_LOST =
	"Links. An SVG is a picture: a node that leads to another page is drawn and does not lead anywhere.";
```

`SVG_LINK_LOST` goes in `EXPORT_TARGETS.svg.loses` unconditionally, beside
"Behaviour" and "Inputs, guards and timelines", which is the asymmetry that
table already argues for: HTML *can* carry a link and names the ones it could
not, SVG carries none and says so once about the format.

### 5.5 One behaviour change in the panel

`ExportPanel` receives `title={projectName}` today, so a five-page project
exports five files all called `card.html`. That was already wrong and §5.1 makes
it load-bearing: the href is `${slug(pageName)}.html`, so the page has to export
under its own name for the links to line up. Studio passes
`title={activePage ?? projectName}` and `pages={pageNamesById}`, and the panel's
filename field defaults to the page. Worth calling out in the commit body — it
is a visible change to what a button produces.

---

## 6. Present mode is a route

### 6.1 Beating the ViewSwitcher's argument, or not needing to

`ViewSwitcherProps.options` says: "Exactly two: a toggle with three states is a
menu ... a view is what the *whole canvas* shows, and there are two of those —
the one design you are editing, and the space it came from," and records that
"the pressure to widen a two-way switch arrives from somewhere else every time."

It arrives here too, and it should be turned away, for two reasons that are
*stronger* than the one it turned away last time. That argument said a state
strip is not a view because it is an annotation on the design in front of you.
This one is the opposite failure:

1. **Present mode changes which document is on screen.** Both of the switcher's
   options show the same page; that is what makes them two views of one thing. A
   presentation walks from `/pages/Home.scene` to `/pages/About.scene`. A control
   whose third position navigates between documents is not a view control.
2. **A presentation has to be a link you can send.** The whole point of a
   prototype is being handed to somebody who is not editing, and editor state
   cannot be handed to anybody. This is `App.tsx`'s own argument for a page being
   in the url — "A link to a page opens that page — for a collaborator, for a bug
   report, for a browser's back button" — and it is decisive here rather than
   merely nice, because §7's back button is built entirely out of it.

There is also nothing left of the canvas in present mode: no camera, no rulers,
no layer list, no panels, no toolbar, no selection. A "view" that removes the
thing it is a view of is a screen.

### 6.2 The route

```tsx
{/*
  * A presentation is a *place*, not a state of the editor, and it names the
  * page it is presenting for the reason the two routes above name theirs: it
  * has to be a link somebody can be sent, and the back button has to be able
  * to land on it.
  *
  * Three segments, exactly as a component's address is, and the reasoning
  * there transfers unchanged: only the three-segment form is a presentation,
  * so a page called "present" is still `/p/:id/present` and no page name
  * becomes unreachable. The consequence worth stating is that "present the
  * first page" has no address of its own — the button that enters resolves a
  * page name first and navigates to the full form.
  */}
<Route path="p/:id/present/:page" element={<Present />} />
```

`react-router` ranks static segments over dynamic ones and these have different
lengths, so ordering among the four routes is immaterial.

### 6.3 What renders it: the artboard, live

**The artboard read-only with the machines live**, not the HTML export in a
frame. Both were considered against what each gets right.

The export-in-an-iframe gets one thing right and it is a real thing: what you
show is the artefact you ship. Everything else about it is wrong here.

- **It is one universe, flattened.** `ALWAYS_LOST` opens with "The space. An
  export is one point in it; the other universes are not in this file." Flipping
  designs mid-presentation — §7 — would mean re-exporting, which means
  re-solving and re-emitting on every press of an arrow key.
- **Every navigation is an export.** Walking to another page means solving that
  page, measuring its text, resolving its images to data URIs and emitting a
  file, before anything is on screen. The artboard path has already solved it.
- **The app cannot see inside a frame.** Links inside a same-origin blob iframe
  navigate the frame, and present mode's chrome, its universe control and its
  history integration would all have to be a `postMessage` protocol into
  generated script — a second runtime, for a feature whose entire value is that
  it is the same picture.
- **It would make the export grow a feature only the presenter uses**, which is
  the inversion of §5: there, links reach the export because a link is part of
  the design and a design that does not survive its own file is not carried.

The artboard gets the important things right by already being right. It draws
`universe.model` — "a rule that moves a node or repaints it shows up on the
canvas without the renderer knowing such a rule exists". `useMachinePlayback`
reads the same `MachineTable` the exported `<script>` ships, and
`runtime.test.ts` runs that exact text against `stepMachine` over every
`(state, trigger)` pair — so the machines in a presentation behave the way the
file will. Universes are one object away. Nothing has to be built.

What it gets wrong, said out loud: fonts, text wrapping and the pacing of a
transition come from the studio's stylesheet rather than the export's, so a
presentation is the design and not a preview of the file. That is the right
trade — the artefact has its own way of being looked at, which is opening it —
and §12 names the thing that would close the gap if anybody ever wants it.

### 6.4 `app/src/routes/Present.tsx`

```tsx
export function Present() {
	const { id, page: named } = useParams();
	const navigate = useNavigate();
	const [params, setParams] = useSearchParams();
	const names = usePages(id);

	// Resolved against the tree and rewritten with `replace`, exactly as
	// `Project` does it and for the same reason: a url naming a page that has
	// been renamed or deleted should land somewhere rather than report the
	// project as gone, and `replace` keeps the broken address out of the back
	// stack.
	const known = named !== undefined && names.includes(named);
	const active = known ? named : names[0];
	const page = useProject(id, active === undefined ? undefined : pagePath(active));

	const scene = page?.scene;
	const measurements = useMemo(() => (scene ? measureScene(scene) : {}), [scene]);
	// The design carried in from wherever we came from, narrowed to what this
	// page can actually hold — see §7.2. A pin naming a variable this document
	// does not have is an assumption on an atom that was never grounded, which
	// is UNSAT for a reason nobody can see.
	const pins = useMemo(
		() => (scene ? holdable(scene, decodeDesign(params.get("d"))) : {}),
		[scene, params],
	);
	const { exploration } = useExploration(scene ?? EMPTY, LIMIT, 1, pins, measurements);
	const universes = exploration?.universes ?? [];
	const at = Math.min(Number(params.get("u") ?? 0) || 0, Math.max(universes.length - 1, 0));
	const universe = universes[at];
	…
}
```

It renders, in one `<main data-role="present">`:

- a `<div>` scaled to fit: `documentBounds(scene, context)` in EMU converted to
  pixels and `transform: scale(min(vw/w, vh/h))` about the centre, with the
  `Artboard` inside at the document's own coordinates.

  **Whatever is on the page, all of it.** A page with three artboards presents as
  three artboards, because the document does not say which one is "the screen"
  and picking the first would make a presentation depend on paint order in a way
  nobody chose. One screen per page is what the pages are for.

  No cap on the scale. A presentation is a presentation; a card blown up to fill
  a display is what was asked for, and it is vector DOM rather than pixels.
- a transparent overlay taking the pointer events, converting client coordinates
  to document coordinates with the same inverse the Editor uses, and calling
  `instanceAt` for the machine triggers and `linkAt` for the links. Ordering
  within one event is: the machine trigger first, then the link — a `pointerdown`
  that both presses a button and follows it should press it, because the press
  is what the design says happens and the navigation is what happens next.
- `data-role="present-chrome"`, §7.3.

It renders **no `Editor`**. That component is seventeen hundred lines about
selection, marquees, snapping and drop targets, every one of which is off under
`previewing`; instantiating it to get two pointer handlers would be taking the
whole editor along to not use it. The two handlers it does need are the two pure
functions §4.1 lifted out of it, so there is still one implementation of "what is
the pointer over".

---

## 7. Which universe a presentation shows

### 7.1 The question

"The document is a design space and a presentation is one design" is exactly
right, and the concrete difficulty is that **universes are per page**. Each page
is its own document and its own program; "universe 3 of Home" is not a thing
About has ever heard of. So the thing that crosses a page boundary cannot be a
universe.

It is `Picks` — `Readonly<Record<string, number>>`, variable key to alternative
index — and it crosses because a variable key is built from document ids that
pages share: `tok(accent)`, `prop(n3,fill)`. Tokens created by `emptyScene()`
have stable ids across every page of every project (`accent`, `surface`, `muted`,
`ink`, `subtle`, `radius`), which is what makes "present this in the dark one and
keep it dark" work at all in practice.

And there is already a mechanism for "hold these alternatives while I look
around, without editing the document": **pins.** They "reach the solver as an
assumption, so it costs a solve rather than a re-grounding, leaves undo alone,
and is undone by forgetting it." A presentation is a long look around. So present
mode's carrier is a pin set, with the same drop rule the studio already has, and
no new concept at all.

### 7.2 Concretely

- Present mode holds two things in the **query string**, because §6.1 says a
  presentation must be a link and §7.4 needs both restored by the back button:
  - `d` — the pins, encoded `key~index` joined by `;`. `~` because a variable key
    holds `(`, `)`, `,` and `:` and never a tilde; a key that somehow contains one
    is dropped rather than mis-parsed, and the decoder says so.
  - `u` — which universe of *this* page is on screen, as an index.
- On arriving at a page, `d` is decoded, narrowed by `holdable(scene, picks)` —
  keep only variables `variableCounts(scene)` offers, at an index inside range —
  and handed to `useExploration` as `pins`. That is the studio's own stale-pin
  rule, moved into a pure function so both can call it: "A pin on a variable that
  no longer exists — or on an alternative that has since been deleted — would
  make every solve unsatisfiable for a reason the user cannot see." In a
  presentation there is no panel to see it in, so it must not be possible.
- `◀ ▶` walk `u` within the page and are written with `replace: true`. **Flipping
  a design is not a navigation**, and if it pushed history the back button would
  walk universes instead of pages — which would take the feature §7.4 is built on
  and spend it on the feature §7.3 already has two arrow keys for.
- **Following a link pushes**, and it writes the accumulated design forward:

```ts
const follow = (to: string) => {
	// The design goes with you, and it accumulates. Only the variables this page
	// actually left a choice about are added — `varyingVars` is the solver's
	// reading, which is the right one here: a variable the rules settled needs no
	// pin, and a pin per variable would make the address unreadable and pointless.
	// Merged over what came in rather than replacing it, so a choice made on the
	// first page survives a second page that has never heard of it.
	const carried = { ...pins, ...pick(universe.pick, varyingVars(exploration)) };
	const target = pageName(to);
	navigate(
		`/p/${enc(id)}/present/${enc(target)}?d=${enc(encodeDesign(carried))}`,
		// A link to the page you are already on replaces rather than pushes: a
		// history entry that looks identical to the one before it is a back button
		// that appears not to work, and a presenter pressing it four times is the
		// failure that produces.
		{ replace: target === active },
	);
};
```

- A **dangling** link — a `to` no page resolves — does nothing at all. No
  navigation, no message. That is the same silence `composeLibrary` chose, and
  present mode is not where a broken document is diagnosed: §9 puts that in the
  Inspector, the layer list and the Pages panel, and §3.4 lets a rule refuse to
  ship it. A presenter is showing the thing, not debugging it.

### 7.3 Flipping, as an interaction

`data-role="present-chrome"` — a bar pinned to the bottom, dimmed to 0.15 opacity
after two idle seconds and restored on any pointer move, holding:

- the page's name;
- `◀ Design 3 of 12 ▶`, absent entirely when there is one universe, because a
  control that always reads "1 of 1" teaches people to ignore it;
- `Exit`.

Keys: `[` and `]` step the design, `Escape` exits. The arrow keys are left to the
browser and the OS — a presentation is a thing people hand to somebody, and
stealing ← → is stealing the gesture they will reach for to go back.

An index is only meaningful against one document and one seed, which is exactly
what a presentation is; the seed is fixed at 1 and nothing in present mode edits.
Say so where `u` is read, so nobody tries to make the address survive an edit.

### 7.4 The back button

It works, and it works because everything above is a url.

- Following a link is `navigate(push)`, so **back retraces the walk**, page by
  page, restoring each page's `d` — and therefore each page's design — because
  the pins were in the address rather than in a ref. This is the single strongest
  argument for §7.2's query string and it is why the design is not editor state.
- Flipping a design is `replace`, so back never steps sideways through universes.
- **Entering** present mode pushes, so back from the first presented page leaves
  the presentation and lands in the studio — which is what a person who pressed
  Present once and then back once means.
- **Exit** is a push to `/p/:id/:page` for the page currently on screen, not
  `navigate(-1)`. Somebody five pages into a walk who presses Exit wants the
  editor, on the page they were looking at, in one act — `-1` would put them back
  one page of the presentation. It leaves the presentation in the history, so
  back re-enters it, which is right.
- A url naming a deleted page is rewritten with `replace` to the first page,
  which is `Project.tsx`'s rule and its reason: "so the back button does not land
  on the broken address again."

---

## 8. Page transitions

**"Push" is rejected. A cross-fade is scoped, and it is not a document feature.**

### 8.1 Why push is not worth it

- **A push has a direction, and a direction is a fact the document does not
  hold.** It would be a field on the link (`transition: "pushLeft"`), and then
  every pressure this codebase already knows applies: it would want to be a
  `Value`, because a designer will immediately want the wide design to push and
  the compact one to fade; it would want to reach ASP, because everything that
  can vary does; it would want to be in the export, and the export cannot carry
  it. That is four rungs of a ladder for decoration.
- **It would be a second transition vocabulary.** `Transition` already means
  something precise here: an edge of a machine, paced by `duration`, `delay`,
  `easing` and `stagger`, all of them `Value`s a token can drive, all of them
  emitted as a CSS `transition:` declaration the compositor plays. A page
  transition shares none of that and would share the word.
- **The export cannot do it.** A cross-document push needs the View Transitions
  API, whose availability is a per-browser story, and driving one from a script
  is "a second animator arguing with the compositor" — which is the exact
  sentence `runtime.ts` uses to refuse a queue. A prototype feature that works in
  the studio and not in the file is the disagreement this whole architecture is
  arranged to prevent.

So: **no `transition` field on `NodeLink`, at all.**

### 8.2 What is scoped instead, and why it is not a transition

The real defect a "transition" would be papering over is a *blank*: following a
link opens another document, which must be read and then solved, and the honest
duration of that is tens of milliseconds during which there is nothing to draw.
A hard cut into white is what people call "no transition"; it is actually a
flash.

So present mode holds the outgoing page on screen until the incoming one has an
answer set, and cross-fades between them over 120ms. Two consequences worth
stating:

- It is **editor state and never the document's** — the third member of the
  family the zero point, the guides toggle and the preview mode belong to. It
  reaches no solve, no export and no undo entry, it is the same for every link,
  and two people presenting the same document see the same thing because there is
  nothing about it to disagree over.
- It respects `prefers-reduced-motion: reduce` by becoming a cut, in the app's
  own stylesheet, where that media query belongs.

That is one CSS rule and one piece of state (`previous`, held until the next
universe arrives). It is 90% of what a transition was wanted for, and it costs
the document nothing.

---

## 9. The studio surface

### 9.1 Inspector — a `Link` section

After the existing `<h3>Component</h3>` block and before `Appearance`, on every
node kind, with three rows:

- **Goes to** — a `<select>` over the project's page names plus a "Nothing"
  option, writing `pagePath(name)`. Inspector gains one prop, `pages?: readonly
  string[]`, passed from Studio's `usePages(projectUrl)`.
- **A dangling target is shown, not hidden.** The select carries a disabled
  option holding the stored path with the word *Missing*, and choosing a real
  page repairs it. The Inspector already does exactly this one screen up: `An
  instance of “{node.instanceOf}”, which is no longer a component`. Same
  sentence, same place, same repair.
- **On** — a `<select>` over `LINK_TRIGGERS`, labelled from `TRIGGERS[g].label`,
  defaulting to Clicked and writing nothing to the document when it is Clicked,
  so the common link stays one field.
- **Open** — a button calling `onOpenPage(pageName(link.to))`, disabled when
  dangling. A name you cannot follow is a name you have to hunt for in a list,
  which is the argument the component section's `onSelectionChange` already
  makes.

The edit is one function in `edits.ts`, in `setSizing`'s shape:

```ts
/**
 * Point a selection at a page, or at nothing.
 *
 * Deletes the field rather than storing a sentinel, the way `setSizing` drops
 * `sizing` for the automatic case: absent is the answer for "does not lead
 * anywhere", and a document holding `{ to: "" }` would be a second spelling of
 * it that every reader would have to know about.
 */
export function setLink(
	scene: Scene,
	ids: readonly string[],
	link: NodeLink | undefined,
): Scene;
```

### 9.2 Layer list

A node with a link gets a small `→` badge; a dangling one gets it in the warning
colour with a title naming the missing path. `LayerList` gains `linked?:
ReadonlySet<string>` and `dangling?: ReadonlySet<string>`, computed in Studio
from the document and the page list — read from the **document** here, not from
the answer set, because the layer list is a view of what you wrote and a
rule-asserted link is not something you can select or repoint.

### 9.3 Pages panel

Each page's row gains a count of the pages linking *to* it, and a page nothing
links to gets a marker with the title "No page links here." That needs a new
hook:

```ts
/**
 * Which pages link to which, read from the documents.
 *
 * From the tree and not from any answer set, and the split is deliberate. There
 * are two reachability questions and they have two homes. "Which pages does this
 * *design* lead to" is `goes/1`, per universe, in the program of the page you
 * have open — because whether a link is live depends on whether its node is, and
 * only the solver knows that. "Which pages does this *project* link between" is a
 * question about the documents, and answering it in ASP would mean grounding
 * every page's program to find out, which is a solve per page to draw a marker
 * in a list.
 *
 * So this reads the scenes and never solves. The cost is that it reports a link
 * on a node a rule hides as a link, which is right for this question: the
 * document does link there, and whether some design uses it is the other
 * question, asked elsewhere.
 */
export function usePageLinks(url: string | undefined): Record<string, string[]>;
```

A full flow graph — boxes and arrows, drag to rearrange — is **not worth it**;
§12 says what it would cost and what the marker buys instead.

### 9.4 The Present button

Beside Preview in the toolbar, always offered (there is always something to
show, unlike a machine to run), with a title that states the difference the two
buttons exist to draw:

> Preview: run the machines here — hover and click the design, nothing is
> written down.
> Present: leave the editor and walk the prototype, following links between
> pages.

Studio gains `onPresent?: () => void`; `Project.tsx` implements it as
`navigate(\`/p/${enc(id)}/present/${enc(active)}\`)`, resolving the page name
first because §6.2 gave the bare form no address.

---

## 10. Test plan

`node --test` + `node:assert`, colocated `*.test.ts`, through the real solver
wherever the claim is about the program.

**`design-core/src/pages.test.ts`**

1. `pageIdOf("/pages/About us.scene")` matches `/^pg_[a-z0-9_]*_[0-9a-z]+$/` and
   does not start with a digit; the same for `/pages/2024.scene` and for a page
   whose name sanitises to nothing.
2. `pageIdOf("/pages/my page.scene") !== pageIdOf("/pages/my-page.scene")` —
   injectivity where sanitising is not.
3. No `pageIdOf` output equals any `componentIdOf` output, by prefix, over a
   fixture list of a dozen paths.
4. `componentIdOf("/components/Button.component")` equals a frozen literal —
   the factoring in §1.2 changed nothing about an id that already reaches
   generated programs.
5. `repointLinks` rewrites a link naming the old path, leaves a link naming
   anything else untouched, and returns the same scene object where nothing
   matched.
6. `linkAt` returns: the frame, for a point in a linked frame; **the parent**,
   for a point in an unlinked child of a linked frame; the nearest linked
   ancestor, for a point over an unlinked label drawn across a linked card; and
   `undefined` where no ancestor links. Two overlapping linked nodes settle on
   the later one in paint order.

**`design-core/src/linkprogram.test.ts`** — the real solver.

1. A document with one link yields `link(n1,pg_about_…)` and `goes(pg_about_…)`
   in the answer set.
2. A rule asserting `hidden(n1).` leaves `link/2` present and `goes/1` **absent**.
3. A link on a component definition part yields `link(inst(i1,btn),pg_…)` on the
   page that places the instance, and `goes/1` with it — the copy rule.
4. A machine state that hides the linked part, with the instance drawn in that
   state, yields no `goes/1` — the `visible/1` guard through
   `hidden(inst(I,N)) :- mhidden(I,S,N), shown(I,S)`.
5. `linkon/2` carries the document's trigger, and a link with no `on` field
   carries `click`.
6. **Universe counts.** A scene with one token holding two colours has exactly N
   universes. Adding a `link` to a node leaves it at N. Adding a second link to a
   second page leaves it at N. Adding a link inside a component definition placed
   as two instances leaves it at N. This is the `#project goes/1.` claim and the
   repository's standing invariant, asserted together.
7. A dangling link — `to` naming a path no page has — compiles, yields `link/2`
   and `goes/1` under the derived id, and leaves the universe count at N.
8. `viol(dead_link) :- goes(P), not page(P).` fires for a dangling link and not
   for a live one, with `flow.pages` supplied.
9. `:- here(pg_home_…), not goes(pg_checkout_…).` is UNSAT on a home page with
   no path to checkout and SAT once the link is added.
10. `compile(scene)` with **no** `flow` emits no `page/1` and no `here/1`, and
    still emits `link/2`, `linkon/2` and derives `goes/1`.

**`design-core/src/model.test.ts`** (additions)

11. `link/2` + `linkon/2` reach `ModelNode.link` and `ModelScene.links`;
    `goes/1` reaches `ModelScene.goes`, sorted.
12. A `link/2` with no `linkon/2` — a rule-asserted link — reads as `click`.

**`design-core/src/linkexport.test.ts`**

13. A linked node emits `<a … href="about-us.html">…</a>`; an unlinked sibling is
    still a `<div>`; the anchor carries the same `class` and `data-node` the div
    would have.
14. `.design a[data-node]` appears in the stylesheet exactly once.
15. A `pointerenter` link emits `data-link-on="pointerenter"` **and** the link
    script; a document whose links are all clicks emits neither — assert the
    absence of `data-link-on` and of `addEventListener` in the output, the way
    `runtime.test.ts` asserts the absence of `setTimeout`.
16. A link whose page is not in `options.pages` emits a `<div>`, and `lost` holds
    `DEAD_LINK_LOST(1)`.
17. `lost` holds `LINKED_LOST` exactly once for a document with four links.
18. The SVG target emits no `<a>` and carries the format-level link sentence.

**`design-core/src/components.test.ts`** (addition)

19. A page whose node holds a `link` survives `composeLibrary` →
    `decomposeLibrary` deep-equal. The round trip is "the only thing standing
    between this design and that failure" and a new field is exactly the kind of
    thing that falls out of it silently.

**`app/src/routes/design-param.test.ts`**

20. `decodeDesign(encodeDesign(p))` round-trips for keys holding commas and
    parentheses — `prop(inst(i1,label),text)` is the realistic worst case.
21. A malformed pair is dropped and the rest survive; nothing throws.
22. A key containing `~` is dropped rather than split.
23. `holdable(scene, picks)` drops a variable the scene does not have and an
    index past the end of a list it does.

**`app/src/projects/store.test.ts`**

24. `renamePage` rewrites a link on page B that named page A's old path; a link
    naming an unrelated page is untouched; a project with no links produces no
    change at all.
25. `deletePage` leaves the link dangling and page B still opens and still holds
    the old path.

**e2e — extend the one walk, do not add a second.**

`studio.spec.ts` is deliberately a single test ("The lane is deliberately a
single test, so it had to be the single most expensive path in the app to get
wrong"). This feature cannot fail in a way the first half of that walk does not
already have to succeed for, and a second file would pay the wasm, IndexedDB and
solve costs again to prove it. So the existing walk gains a tail:

- add a page; link the Card template's badge to it through the Inspector;
- press Present; assert the url is `/p/…/present/…` and
  `[data-role="present-chrome"]` names page one;
- click the badge; assert the chrome names page two and the url changed;
- press browser back; assert the chrome names page one again — which is the
  whole of §7.4 in one assertion;
- assert no console errors, as the rest of the walk does.

---

## 11. Order of work

1. `pages.ts`, `aspConstant`, `componentIdOf` refactor, `repointLinks`, and
   tests 1–5. Nothing else can be typed until `pageIdOf` exists.
2. `NodeLink`, `SceneNode.link`, `LINK_TRIGGERS`, `setLink`, and the
   compose/decompose assertion (test 19).
3. `compile.ts`: facts, `CompileOptions.flow`, `LINK_RULES`, the shows, the
   contract comment; tests 1–10. **This is the step that has to be finished
   before anything reads an answer set** — §3.3's `#show` list is the invariant
   this repository has already paid for once.
4. `model.ts`; tests 11–12.
5. `linkAt`, `instanceAt`'s move out of `Editor.tsx`; test 6.
6. The studio surface: Inspector section, layer badges, `usePageLinks`, the
   Pages panel marker, the Present button. Driven in a browser, not asserted —
   three of the last four features found their real bugs that way and none of
   them was visible from a test.
7. `Present.tsx`, the route, `encodeDesign`/`decodeDesign`/`holdable`, the
   chrome, the cross-fade; tests 20–23.
8. The export: markup, CSS, `LINK_RUNTIME`, losses, `ExportOptions.pages`, the
   panel's title change; tests 13–18.
9. The e2e tail.

Steps 3 and 8 are the two that can be wrong silently. Step 3's failure mode is a
missing `#show`; step 8's is an anchor that repaints the design, which is why
test 14 exists.

---

## 12. Rejected, with the reason

- **A `Value`-typed link**, so a node leads to different pages in different
  universes. §1.1: it would make every link a branch of the space, paid for by
  every document, and the varying case is already expressible as a rule over
  `pick/2`, which is where a decision that depends on the design belongs.
- **A link as a little machine.** §2.1: eleven health rules and an interpreter
  are all written about *states*, and a navigation has no state to arrive in.
- **`load`, `pointerup`, `focus`, `blur` and `pointerleave` as link triggers.**
  §2.2, one reason each. `load` is the one that would have been a real bug: a
  redirect with no human act in the loop.
- **A hotspot kind or tool.** §1.1: it makes "what can be clicked" a question
  about node kinds, and puts a second object in the layer list that has to be
  kept aligned with the first by hand.
- **Present mode as a third `ViewSwitcher` option.** §6.1: it changes which
  document is on screen and it must be a link somebody can be sent, and neither
  is a thing a view toggle can be.
- **The HTML export in an iframe as the presenter.** §6.3: one universe, an
  export per navigation, and a `postMessage` protocol to get the chrome back.
- **A `transition` field on a link, and push/slide transitions.** §8.1: a
  direction is a fact the document does not hold, it would want to be a `Value`,
  and the export cannot carry it without a second animator.
- **"Back" and "overlay" as link targets**, the way Framer and Figma have them.
  A target that is not a page path would be a second kind of target and a second
  branch in `linkAt`, `compile`, `model`, the export and the presenter — and back
  is the browser's button, which §7.4 makes work for free. An overlay is a state
  of the page it is on, which is a machine, which this document model already
  has.
- **`pagename/2` in the program.** §3.1: nothing reads it, and the panel that
  wants to show "About us" computes both halves from the page list it already
  holds.
- **Project-wide reachability in ASP** — `reaches/2`, "is every page reachable".
  §9.3: one page's program grounds one page and knows only its own outgoing
  edges, so answering it in the program means either putting every page's link
  graph into every page's program (every page re-grounding when any page's links
  change) or solving all of them to draw a marker in a list. The per-universe half
  — which is the half only this tool can do — is `goes/1` and is answered where
  the solver already is; the project half is a walk of the documents and is
  answered where the documents already are. **Two questions, two mechanisms, each
  where its data is.**
- **A flow-graph panel**, boxes and arrows for the whole project. It is a second
  canvas — a layout, a camera, drag-to-arrange, an ordering somebody has to
  store, which is the same field the Pages panel already refused to invent for
  tab order. The 90% is §9.3's marker: "no page links here" is the only sentence
  a flow graph gets asked to say, and it costs a hook and a dot.
- **Multi-file / folder export of a whole prototype.** Genuinely valuable and
  genuinely a different artefact: the panel writes one file to the clipboard or a
  download, and a folder is a zip, a directory picker, or a build step. The 90%
  is that §5.1's `href="about-us.html"` is *already the right string* for that
  folder — so the day somebody writes the loop, nothing about the emitter
  changes, and until then the loss line tells a person exactly how to do it by
  hand.
- **Generated JavaScript per link.** §5.3: generated code is a second
  implementation of the design that can disagree with the first, which is the
  argument `runtime.ts` opens with. Six generic lines reading an attribute
  instead.
- **Storing a page's document url rather than its path.** It would survive a
  rename without §1.3's rewrite, and it would make a link unreadable in a
  document, unresolvable without opening the project, and a second identity for a
  page beside the one the tree already gives it — "an index would be a second
  answer that could disagree with the documents."
