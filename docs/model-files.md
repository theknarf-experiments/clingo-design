# A model is a node, and the geometry it draws is a file in the tree

**Status: a design step. No code was written for it.** It is the glTF half of
what `f2b6316` ("An image is a node, and the picture it draws is a file in the
tree") did for photographs, and it is written against the tree as that commit
left it: `/pages/<name>.scene` documents beside `/assets/<name>` files, both
syncing, both cloning to disk, `asset/2` in the answer set carrying a path for
every kind that draws a payload.

It supersedes `docs/three-d-spec.md` §5.2 and §5.3 — the hash-keyed `AssetStore`
and its `assets?: (id) => Uint8Array` resolver — on the one point they were
written before the tree existed. Everything else there stands.

---

## 0. The thesis, and the thing it costs

**An imported glTF is stored in the project's tree as the file that was
imported, under the name the person who imported it chose, and a `model` node
references that file and one part of it.** `/assets/chair.glb` is what the tree
shows, what a clone writes to disk, what a colleague receives, and what the node
points at — so replacing that file replaces the chairs everywhere they are used,
because the reference is to *the file* and not to bytes that happened to be
there. That sentence is already true of `ImageRef`; this makes it true of the
other kind, and then `asset/2` means one thing rather than one-and-a-half.

What it costs is stated up front, because it is the whole reason this is a
design step rather than a rename:

> The importer currently **bakes a normalisation into the bytes it stores**. If
> the tree holds the original file instead, the loader must reproduce that
> normalisation exactly, or the geometry will not sit in the box the solver
> placed — and the two halves that must agree are in different packages, run at
> different times, and are exercised by different tests.

§3 is the answer: **one function, called by both.** Two would be a chair that
sits in its box in the editor and not in the export, which is the drift this
package argues about everywhere.

---

## 1. What is there now — checked, not assumed

`packages/canvas-3d/src/gltfimport.ts` walks the file's default scene and, for
each primitive of each mesh, writes a **standalone single-primitive glTF**: one
mesh, one primitive, no material, centred on its own origin. It hashes those
bytes (SHA-256, `crypto.subtle`, which is the only reason `importGltf` is
`async`) and the node's `MeshRef.asset` is that hash. `Studio.tsx` writes each
payload with `putAsset(id, bytes)` → `/assets/<hash>`, and `compile.ts` states
`asset(N,"/assets/<hash>")`. `useAsset.ts` fetches by that path and `geometryOf`
reads `meshes[0].primitives[0]`.

Three corrections to the brief this step was given, from reading the code:

1. **The importer does not apply each glTF node's world transform to the
   vertices.** It applies only the **accumulated scale** — `parentScale ×
   local.scale`, threaded down `convert()` and handed to `meshParts()`, which
   calls `scaleTriangles`. The translation and the rotation stay on the document
   nodes: a glTF node becomes a zero-sized `pivot` carrying `T` and `R`, and a
   collapsed leaf carries `place + R·centre` and `turnOf(rotation)`. Baking the
   full world transform would be a second, incompatible normalisation. **What
   the loader must reproduce is the scale chain and the centring, and nothing
   else.**
2. `scaleTriangles` **drops normals under a non-uniform scale** and keeps them
   under a uniform one. That is part of the normalisation and must be reproduced
   too, or a stretched part lights differently in the editor and in the export.
3. `MeshRef.bounds` is the *centred* box of the scaled triangles, in EMU, and
   the node's `frame`/`spatial.depth` are the same three magnitudes. Both are
   computed from the output of the same normalisation.

### 1.1 A bug this reading turned up, which §3 removes by construction

`Model.tsx` scales the loaded geometry by the node's box in render units:

```tsx
const scale = [size[0] || 1, size[1] || 1, size[2] || 1];   // render units (CSS px)
<group scale={scale}><mesh geometry={geometry} …/></group>
```

The payload's positions are in **metres**, not in a unit box. The stand-in in
the same file is `<boxGeometry args={[1,1,1]}/>`, which *is* a unit box, so the
two branches disagree: a part whose extent is `E` metres is drawn `E` times too
large, and the comment's claim that box and geometry "occupy the same space by
construction" is true only when `E = 1`. A four-metre chair is drawn sixteen
metres wide; a mug is drawn half size. `gltfexport.ts` has this right —
`fit(size, extent) = size / extent` — which is exactly the shape of drift this
document exists to end: **the editor and the export already disagree about where
a chair sits.**

This is invisible to every headless test in the repo and must be looked at in a
browser (§12). §3's `fitScale` is the one function both call.

---

## 2. The new `MeshRef`

```ts
export interface MeshRef {
	/** Absolute path in the project's tree — `/assets/chair.glb`. */
	src: string;
	format: "gltf" | "glb";
	/**
	 * Which part of that file. Two indices into the file's own arrays, and
	 * nothing derived from the bytes.
	 */
	part: {
		/** The **glTF** node index — not a document node id. */
		node: number;
		/** Which primitive of that node's mesh. */
		primitive: number;
	};
	/** The box the vertices occupy, in the model's own space, in EMU. Centred. */
	bounds: Frame & Record<Spatial, number>;
	/** For the layer list, the budget rule and the status line. */
	triangles: number;
}
```

`asset: string` and `source?: string` are gone. `format`, `bounds` and
`triangles` are unchanged.

**Why `src` and not a hash.** The same paragraph `ImageRef` already carries: a
file in the tree is a file in every sense the rest of the world uses the word.
The hash bought one thing — a store that "can never hold the wrong bytes under a
name" — and it bought it by making the reference untouchable: replacing a chair
meant re-importing every node that drew one. Addressing by path trades a
guarantee nobody asked for against the operation everybody asks for.

**Why the glTF node index and not the mesh index.** The mesh is
`file.json.nodes[part.node].mesh` — storing it too would be a second address for
one thing, and it would spell `node.mesh.mesh`, which is the tell. The *node*
index is what has to be stored, because it is what the scale chain is computed
from: one mesh instanced by two nodes at two scales is two different pieces of
geometry, and a mesh index alone could not tell them apart. `primitive` is the
second index because a mesh drawn in three materials became three document
nodes, and each of them owns one primitive.

**Why indices and not names.** glTF names are optional, non-unique and routinely
absent from an optimised export. An index survives a byte-identical re-import
exactly, which is the case that matters: dropping the same file in twice must
address the same geometry.

**Why no content hash of the file on the ref.** It would make staleness exactly
detectable and would defeat the feature: a ref that refuses when the bytes
change is a hash reference wearing a path. The document deliberately does not
know whether the file is the one it was imported from.

**Why `bounds` stays on the node.** The same reason `ImageRef` keeps `width` and
`height`: it is needed **before the payload arrives** — to place the node at the
size the geometry really is, and to keep a real box while the bytes are loading,
missing, or on the far end of a sync. A `model` with no file is still a node the
solver places, a rule aligns and a pivot turns; that is `assets.ts`'s "a missing
asset is a sentence, never a failure", unchanged.

### 2.1 When the file changes under a node that references it

Three cases, three different answers, and only one of them is a repair:

- **Same file, re-saved (a re-export, a texture change, a re-tessellation).**
  Every node that references it draws the new geometry. This is the feature.
  The node's `bounds` are now the *old* extents; because the geometry is fitted
  to the node's box (§3.3) the designer sees the new chair in the old box,
  possibly at the wrong proportions. The fix is an ordinary edit, not a
  migration: **`refitModel(scene, nodeId, bounds)`** in `edits.ts` — rewrite
  `MeshRef.bounds`, `frame.width/height` and `spatial.depth` from bounds the
  caller measured. It takes measured bounds rather than bytes because
  `design-core` stays pure; `canvas-3d` measures with `meshPart` and the studio
  offers it as "Resize to the file" on a stale model.
- **Structurally different file at the same path** (fewer nodes, reordered
  primitives). `meshPart` refuses when `part.node`/`part.primitive` is out of
  range; the node draws its stand-in box and is reported. Where the indices are
  merely *wrong* rather than absent, the cheap witness is the one number already
  on the ref: `MeshRef.triangles` against the primitive's own count. A mismatch
  is a **sentence** in the studio's relink list — never a refusal to draw, since
  a re-tessellated chair is still the chair.
- **File deleted or not yet synced.** `resolveAsset` answers nothing, the
  stand-in box is drawn, `missingAssets` lists the path. Unchanged from today.

---

## 3. The one normalisation: `packages/canvas-3d/src/meshpart.ts`

A new module, and it is the centre of this design.

```ts
export interface PartRef { node: number; primitive: number }

export interface MeshPart {
	/** Scaled by the chain, centred on its own origin, in glTF metres and axes. */
	triangles: Triangles;
	/** The box those triangles occupy — centred, so min = −max. */
	bounds: MetreBounds;
	/** The name the importer would give the node. */
	name: string;
	/** The file's material index for this primitive, for the importer's props. */
	material?: number;
	/** The accumulated scale, so a caller can report the shear the importer names. */
	scale: readonly [number, number, number];
}

/** One part, normalised — or a refusal in `readTriangles`'s own manner. */
export function meshPart(file: GltfFile, ref: PartRef): MeshPart | { refused: string };

/** Every part the walk would produce, in the importer's order. */
export function meshParts(file: GltfFile, node: number): { ref: PartRef; part: MeshPart }[];

/** How much to scale a payload's box to fill a node's box, per axis. */
export function fitScale(
	bounds: MetreBounds,
	size: readonly [number, number, number],
): [number, number, number];
```

`meshPart` is exactly three steps, in this order, and the order is the contract:

1. `readTriangles(file, file.json.meshes[nodes[ref.node].mesh].primitives[ref.primitive])`;
2. `scaleTriangles(triangles, chainScale(file, ref.node))` — the product of
   `scale`/`matrix` decompositions from the default scene's root down to
   `ref.node` **inclusive**, with `scaleTriangles`'s existing normal rule;
3. `centreTriangles(...)`, then `boundsOf(...)`.

**Where it lives, and why not `design-core`.** `design-core` has no DOM in its
`lib` and no business parsing binary formats; `gltf.ts` — which has *no imports
at all*, not even three.js — is the codec, and this is a policy over it. So a
sibling of `gltf.ts` in `canvas-3d`, three-free, so it is cheap to test under
`node --test` and cheap to import from the exporter, which must stay headless.

**Who calls it, which is the whole point:**

| Caller | Why |
| --- | --- |
| `gltfimport.ts` | to compute `MeshRef.bounds`, the node's frame and depth, and the material props, at import |
| `useAsset.ts` | to build the `BufferGeometry` the canvas draws |
| `gltfexport.ts` | to write the triangles into the exported file |

Three callers, one implementation, and the property that makes the design work:
the importer must **stop** applying `scaleTriangles` itself. `convert()` keeps
threading `parentScale`, because it still needs it to place children and to name
the shear — but the *geometry* comes back from `meshPart`, so "what the box was
measured from" and "what the renderer draws" are the same array by construction
rather than by agreement. The chain must therefore be derivable from the file
alone: build a parent index once (`children` inverted; a glTF node hierarchy is
a strict tree, first parent wins, visited set against a malformed cycle), and
assert in a test that the derived chain equals the threaded one.

### 3.3 Fitting, and the rejected alternative

`meshPart` returns metres, not a unit box. Both consumers scale by
`fitScale(bounds, size)` — which is `gltfexport.ts`'s existing `fit`, moved and
shared, including its rule that a zero extent or a zero box scales by `1` rather
than by `0` or `Infinity`.

*Rejected: normalising the geometry into a unit box inside `meshPart`.* It would
make `Model.tsx`'s current line correct as written and delete `fit` — but it
bakes a division into the vertices, so the export would write a chair whose
coordinates are nothing the file ever contained, and the day somebody wants the
file's own numbers back there is nowhere to get them. The division belongs in
the drawing, which is where the box is.

---

## 4. What `importGltf` returns

```ts
export function importGltf(file: GltfFile, options: GltfImportOptions): GltfImport;

export interface GltfImportOptions {
	/** Where the file was written in the tree — stamped on every `MeshRef.src`. */
	src: string;
	name?: string;
	id?: () => string;
}

export interface GltfImport {
	nodes: SceneNode[];
	triangles: number;
	lost: string[];
}
```

Three changes, each of which is a deletion:

- **`assets: ImportedAsset[]` is gone**, and with it `ImportedAsset`, the
  `gltfWriter` calls in `modelNode`, the `payloads`/`attach` mutation in `Walk`,
  and `sha256`. Nothing is written and nothing is hashed, so **`importGltf`
  becomes synchronous** — the `async` existed for `crypto.subtle.digest` and for
  nothing else.
- **It takes a parsed `GltfFile`, not bytes.** This is not tidiness: it makes
  the ordering structural. `parseGltfFile` is the only thing that throws on a
  file that is not a glTF, so the caller parses first, writes the file second,
  imports third — and a person who drops a PDF on the viewport gets an error
  with **nothing left in their tree**. It is the same shape as the image flow,
  where `createImageBitmap` validates before `putNamedAsset` writes. As a
  consequence `importGltf` itself no longer throws at all; every remaining
  failure is a `lost` sentence.
- **The original bytes are not returned.** The brief asked for them; they are
  the caller's own argument, and re-handing back a fifty-megabyte buffer is a
  second reference to it in a closure the studio holds until the import
  finishes. More decisively, the caller **cannot** call this until it has
  already written the file, because `src` is not knowable in advance:
  `putNamedAsset` resolves collisions (`chair-2.glb`), and only it knows which
  name the file actually got.

`Studio.importModel` becomes, in order: read the file → `parseGltfFile` (throws
→ the loss panel, nothing written) → `putNamedAsset(file.name, bytes)` → `src` →
`importGltf(parsed, { src, name })` → `addImport(prev, viewport, nodes, info)`.
The comment about payloads-before-document keeps its argument and changes its
subject: the *file* goes in before the nodes, for the reason images already do.

---

## 5. `ImportedAsset`, `putAsset`, `/assets/<hash>`

- **`ImportedAsset`** — deleted, along with its export from `index.ts`.
- **`putAsset(id, bytes)`** and `MESH_DIR` in `packages/app/src/projects/store.ts`
  — deleted. `putNamedAsset` becomes the single writer for both kinds, and its
  doc comment loses the paragraph about payloads "no person named": there are no
  such payloads any more. The section header's argument gets *shorter*, which is
  the tell that this is the right shape: "a project's payloads are files in its
  tree, addressed by path" now has no exception to explain.
- **`/assets/<hash>`** — no longer written. Existing files at those paths are
  still read, because §10's migration points legacy refs at them.
- **`AssetStore` / `memoryAssetStore`** in `design-core/src/assets.ts` — the
  hash-keyed store interface has no implementation in the tree and now no
  prospective one. `AssetResolver` stays exactly as it is: its parameter has
  been a path since `f2b6316` and only its parameter *name* says `id`. Removing
  `AssetStore` is a tidy-up this step may do or leave; if it stays, its header
  must stop claiming the app implements it over IndexedDB, which is no longer
  true.

---

## 6. The document's index: `Scene.assets`

Today: `Record<contentHash, AssetInfo>`. Tomorrow: `Record<treePath, AssetInfo>`,
one entry per **file** rather than one per primitive.

`AssetInfo` keeps its four fields and two of them change meaning for the better:
`bytes` is now the size of the file the person imported — which is the number a
project overview actually wants and which was never representable before — and
`triangles` is the file's total. The **per-part** count stays where it always
was, on `MeshRef.triangles`, which is what `tris/2` emits.

- `assetRefs(scene)` keys on `node.mesh.src`. Ten chairs from one file are one
  entry with ten node ids, which is now literally true of the download too.
- `missingAssets(scene, held)` compares against the *tree's* paths.
- `assetTotalBytes` is unchanged in code and becomes correct in fact.
- `pruneAssets` keys on paths. **It still does not touch `node.image.src`**, and
  that is deliberate rather than an oversight: an image's intrinsic size lives on
  its own ref and no panel totals photographs. Widening the index to both kinds
  is a separate change with its own argument to make.

---

## 7. The compiler

**`asset/2` needs nothing but a different source for its path** — the brief's
guess, checked and confirmed. `compile.ts` currently writes
`atom("asset", node.id, quote("/assets/" + node.mesh.asset))`; it writes
`quote(node.mesh.src)` instead, one expression, and the image branch beside it is
untouched. `#defined asset/2.`, the `#show`, `ModelScene.assets`,
`ModelNode.asset` and `export.ts`'s `images[path]` lookup are all unchanged.

**One new predicate is required**, and the brief's guess does not cover it: the
renderer must know *which part* of the file to draw, and `Model.tsx`'s rule is
that everything it draws comes off the answer set and never off the document —
so that a rule which mints a model gets its geometry drawn exactly as a rule
which mints a rect gets its fill.

```
#defined meshpart/3.
#show meshpart(N,I,P) : meshpart(N,I,P), scenery.
```

`meshpart(N, GltfNodeIndex, PrimitiveIndex)`, stated only for a `model` node
carrying a `MeshRef`, two plain integers. Named `meshpart` because `cpart`,
`mpart`, `spart` and `mkpart` are taken and all four mean a *definition* part.

*Rejected: a fragment on the path* — `"/assets/chair.glb#node=3&primitive=0"`.
It is one atom instead of two, and it is why `f2b6316` was worth doing in
reverse: `asset/2` would stop being a path, `resolveAsset` would need a strip,
and a rule asking which files a design uses would get a string that is not one.

`model.ts` reads it into `facts.parts` and puts `part?: { node: number;
primitive: number }` on `ModelNode`, beside `asset`. **Not** a second map on
`ModelScene`: the map form of `asset/2` exists so a project can be audited
without walking the tree, and a primitive index answers no question anybody asks
of a project.

**And ship the `#show` in the same change as the reader.** This is the mistake
`f2b6316` found and paid for: `ModelScene.assets` read `asset/2` from the day the
3D work landed and no directive ever emitted it, so every model in every document
fell back to its stand-in box for want of one line — which looks exactly like a
missing asset and so went unnoticed. A reader without a `#show` is the failure
mode of this file.

---

## 8. The renderer

`useAsset(path, part, resolve)` and `geometryOf(bytes, part)`: fetch the file,
`parseGltfFile`, `meshPart(file, part)`, and build the `BufferGeometry` from
`part.triangles` as it does today. `Model.tsx` passes `node.part` down beside
`asset`, and its `scale` becomes `size × fitScale(part.bounds, size)` — which is
§1.1's fix and the reason it can be trusted: the number comes from the same
function the exporter uses on the same normalised bounds.

**The cost, which is real and is the one thing that gets worse.** A payload used
to be one primitive's worth of bytes fetched by one node. A file is the whole
chair — every primitive, every texture, every animation the importer refused —
and a document with ten parts of one chair now fetches and parses it ten times.

The mitigation, in the order it should be reached for:

1. **Dedupe in flight.** A module-level `Map<path, Promise<GltfFile>>` in
   `useAsset.ts`, so ten nodes mounting in one frame share one fetch and one
   parse. This is nearly all of the win and it has no staleness: the entry is
   dropped when the promise settles and its last consumer unmounts.
2. **A short-lived parsed cache**, only if the profile asks for it — and then
   with the trap named: a cache keyed by path serves the old bytes forever after
   the file is replaced, which would silently defeat §0's whole point. It must be
   invalidated from the vfs subscription that already tells the studio the tree
   changed.

`GltfFile` holds its buffers as subarrays of the file bytes, so a cached parse
pins the whole file in memory. That is a browser-visible fact and a browser-check
item, not something a unit test will find.

---

## 9. The export

`exportViewportGltf` changes in three places:

- **`GltfExportOptions.geometry?: (nodeId) => Uint8Array` becomes
  `files?: Record<string, Uint8Array>`** — keyed by tree path, exactly like
  `ExportOptions.images` in `design-core/src/export.ts`. The by-node-id
  workaround existed because "a `ModelScene` does not carry the hash"; it carries
  the path in `ModelNode.asset` and now the part in `ModelNode.part`, so the
  signature can go back to the shape §5.3 asked for. One rule for both kinds of
  payload, in both exporters.
- **`payloadParts` is deleted.** It reads *every* primitive of *every* mesh in
  the payload, which was right when a payload was one primitive and is a bug the
  moment the payload is the whole file: a chair's node would export the entire
  file's geometry. One call to `meshPart(file, node.part)` replaces it.
- **`fit` moves to `meshpart.ts` as `fitScale`** and is called here unchanged.
  The existing per-axis behaviour and the `Model “X” is in the file as its
  bounding box` sentence both stay; a part index the file no longer holds joins
  the payload-could-not-be-read case, with its own reason in the sentence.

**And a thing that is already broken and should not be shipped past.**
`ExportPanel.tsx` calls `writer.export(universe.model, { viewport, title })` and
passes **no** geometry resolver at all, so every glTF this app has ever exported
writes bounding boxes for its models — the code path that reads a payload has
never run outside `gltfexport.test.ts`. With both kinds addressed by path this is
cheap to fix: `useImageBytes` generalises to `useAssetBytes(scene)` collecting
`node.image.src` **and** `node.mesh.src`, and the panel passes `files`. Whether
this step does it or names it, it must not leave the file claiming an export
capability the app does not have.

---

## 10. Documents that already exist

Invariant 4 is not a hope here; the migration is exact, and that is a property of
what the old payloads were.

An old `MeshRef` is `{ asset: "<hash>", format, bounds, triangles, source? }` and
its bytes are at `/assets/<hash>`: a standalone glTF holding **one node, one
mesh, one primitive**, already scaled, already centred. So in
`project.ts`'s `pruneNodes` normalisation:

```
{ asset: h, … }  →  { src: "/assets/" + h, part: { node: 0, primitive: 0 }, … }
```

and `Scene.assets` rekeys `h → "/assets/" + h` in the same pass.

Run `meshPart` on such a file with `{node: 0, primitive: 0}` and every step is
the identity: the chain scale is `[1,1,1]` (the writer emits no scale), and
`centreTriangles` returns its input unchanged because `boundsOf` is already
centred — it has an explicit early return for exactly that. **The migrated node
draws the same vertices it drew before, through the new code path, with no legacy
branch anywhere in the loader.** That is the assertion §11 owns.

`isMeshRef` in `project.ts` gains `src` (non-empty string) and `part` (two finite
integers) and drops `asset`; a ref missing either is dropped, which is the
existing judgement — half a reference is a model that would draw at no size from
no file. Its comment's "the hash is the only way back to the bytes" becomes "the
path is".

---

## 11. Which tests must change, and why

**`packages/canvas-3d/src/gltfimport.test.ts`**

- Every call becomes `importGltf(parseGltfFile(bytes), { src: "/assets/chair.gltf" })`,
  synchronous.
- *"the payload is per node, holds geometry alone, and is addressed by its hash"*
  → **"the node references the file that was imported, and one part of it"**. The
  hash assertions, the `parseGltfFile(asset.payload)` round trip and the
  no-materials-in-the-payload assertion have no subject any more; what replaces
  them is `mesh.src`, `mesh.part`, `mesh.triangles`, and the material still being
  props on the node (which was the real claim under the payload assertion).
- *"a file's name follows it, and a source is kept for a relink"* → the relink
  handle **is** `src`; assert the path, not `source`.
- *"a mesh drawn in two materials becomes two nodes"* — `assets.length === 2`
  becomes: the two nodes share `src` and `part.node` and differ only in
  `part.primitive` (0 and 1). That is a strictly stronger assertion than counting
  payloads was.
- **New, and the one that makes §3 checkable:** for every node the importer
  produced, `meshPart(file, node.mesh.part)` reproduces the exact positions the
  bounds were measured from, and `boundsOf` of them, in EMU, equals
  `MeshRef.bounds`. Run it on the scaled fixture (`scale: [2,2,2]`), which is the
  case where a loader that forgot the chain is off by two.
- **New:** the legacy proof — a single-primitive centred payload written by
  `gltfWriter` normalises to itself under `{node: 0, primitive: 0}`.
- The transform proof (`the imported node stands exactly where the file put the
  geometry`) is untouched, and it must stay untouched: if it moves, the change
  altered where a node stands, which it must not.

**`packages/canvas-3d/src/useAsset.test.ts`** — every test round-trips through
`importGltf` and then reads `result.assets[0].payload`, which no longer exists.
They round-trip through the *file* instead: `geometryOf(bytes, {node, primitive})`.
The assertions survive verbatim — four vertices, six indices, *"two metres wide,
still"*, normals and UVs carried, normals computed when absent, and the four
"nothing a caller can be handed makes this throw" cases. Add a fifth: a part
index the file does not hold is `undefined`, not a throw, because a stale ref
reaches this function in the wild.

**`packages/design-core/src/spatialprogram.test.ts`**, *"an imported mesh is a
node and its vertices are not"* — the inline ref becomes
`{ src: "/assets/bust.glb", format: "glb", part: { node: 0, primitive: 0 }, … }`,
`asset(bust,"/assets/9f2c")` becomes `asset(bust,"/assets/bust.glb")`, and a new
`meshpart(bust,0,0)` assertion lands beside it — with the comment naming why:
the reader and its `#show` ship together or the atom is invisible.

**`packages/design-core/src/spatialprogram.goldens.json`** — **checked: nothing
should move.** No template holds a `model` node (`kind: "model"` appears only in
`project.test.ts`), and the goldens digest node sets, frames, `rendered`, and the
html and svg exports of each universe — none of which reads `asset/2` or
`meshpart/3` on a document with no models. If a golden moves, the new predicate
has leaked into a flat document, which is the failure this whole track promised
could not happen. Add `meshpart` to the list of predicates *"no template's atoms
hold one word of the third axis"* grounds to zero of.

**`packages/design-core/src/assets.test.ts`** — hashes become paths throughout;
the `memoryAssetStore` tests go if `AssetStore` goes. **New:** two nodes drawing
two parts of one file are **one** entry in `assetRefs` with two node ids, and one
`assetTotalBytes` contribution — the property the per-primitive split could not
express and the reason the index is keyed by file.

**`packages/design-core/src/edits.test.ts`** (the `ref3d` literal, and
`addImport`/`addModel` indexing by path), **`project.test.ts`** (`isMeshRef` for
the new shape, **plus a new test for the §10 migration**, which is where invariant
4 is actually discharged), **`gltfexport.test.ts`** (the resolver becomes `files`
keyed by path; the "payload handed over" test hands over a file and a part; add a
test that a *multi*-primitive file exports only the referenced part, which is the
regression `payloadParts` would otherwise reintroduce).

---

## 12. What a browser has to be shown

A green build is not a running app, and three of the things this change touches
are invisible to every headless check here:

1. **A model is drawn at the size of its box.** §1.1 says it is not today. Import
   a file whose part is clearly not one metre across, and look at whether the
   chair fills the box the inspector reports. This is the acceptance test for the
   whole design.
2. **Ten parts of one file do not fetch it ten times.** Import a multi-part
   model and watch the network/IndexedDB reads and the frame time on mount.
3. **Replacing the file replaces the picture.** Write different bytes to
   `/assets/chair.glb` and confirm every node that references it redraws — and,
   if §8's cache landed, that it redraws *at all*.
4. **A file that is not a glTF leaves nothing in the tree** (§4's ordering), and
   an import that succeeds shows the file in the tree under its own name.
5. **A glTF export of a view contains the geometry**, not twelve-triangle boxes
   (§9) — the code path that has never run outside a unit test.

---

## 13. Files this step owns

| File | Change |
| --- | --- |
| `packages/canvas-3d/src/meshpart.ts` | **new** — §3, the one normalisation |
| `packages/canvas-3d/src/gltfimport.ts` | §4 — synchronous, takes a `GltfFile`, writes no payloads, calls `meshPart` |
| `packages/canvas-3d/src/useAsset.ts` | §8 — part-addressed, deduped |
| `packages/canvas-3d/src/Model.tsx` | §8 — passes `part`, fits the geometry to the box |
| `packages/canvas-3d/src/SceneTree.tsx` | threads `part` where it threads `asset` |
| `packages/canvas-3d/src/gltfexport.ts` | §9 — `files` by path, one part per node |
| `packages/canvas-3d/src/index.ts` | drops `ImportedAsset`, exports `meshPart`, `fitScale` |
| `packages/design-core/src/scene.ts` | §2 — the new `MeshRef` |
| `packages/design-core/src/compile.ts` | §7 — `asset/2`'s source, `meshpart/3` and its `#show` |
| `packages/design-core/src/model.ts` | §7 — `ModelNode.part` |
| `packages/design-core/src/project.ts` | §10 — `isMeshRef` and the migration |
| `packages/design-core/src/assets.ts` | §6 — keyed by path |
| `packages/design-core/src/edits.ts` | §6 — `addModel`/`addImport`/`pruneAssets`; §2.1 — `refitModel` |
| `packages/app/src/projects/store.ts` | §5 — `putAsset` and `MESH_DIR` deleted |
| `packages/app/src/design/Studio.tsx` | §4 — the new import order |
| `packages/app/src/design/ExportPanel.tsx` | §9 — pass the files |
| the tests in §11 | |
