/**
 * `@clingo-design/canvas-3d` — the 3D renderer, beside `@clingo-design/canvas`.
 *
 * ## Why it is a package and not a folder in the app
 *
 * **A package boundary is a boundary the typechecker enforces.** `three` and
 * `@react-three/fiber` are dependencies of *this* workspace and of nothing else,
 * so nothing in `packages/app` can `import { Mesh } from "three"` — three is not
 * in the app's dependency graph, and an accidental import is a resolution error
 * rather than a code review. `packages/app/package.json` gains exactly one
 * entry, `"@clingo-design/canvas-3d": "workspace:*"`, and no `three` and no
 * `@react-three/*`.
 *
 * `design-core` was never a candidate: it is pure, headless, tested with
 * `node --test`, and has no rendering dependency of any kind. That is
 * invariant 3, and it is why the arithmetic this package needs — EMU to pixels,
 * thousandths of a degree to radians, a document point to a renderer point —
 * lives *there*, in `spatial.ts`, where a headless test can check it, and is
 * re-exported from `units3.ts` here rather than restated.
 *
 * Like `canvas` and `canvas-core`, there is **no build step**: `"exports": {
 * ".": "./src/index.ts" }`, consumed from source, typechecked by `tsc --noEmit`.
 *
 * ## What it reads
 *
 * A `ModelScene` — one universe of the answer set — and nothing else. It never
 * sees a `Scene`, a token or a pick. See `ViewportCanvas.tsx`, which says what
 * that cost and what it bought.
 *
 * ## What is here and what is not
 *
 * Drawn from the answer set today: `mesh` (all six primitives, materials, the
 * transform chain and the rotation), `pivot`, `light` (all four lamps), `camera`
 * (the lens, and being looked through), the framing fallback for a view that
 * names no camera — and a `model`'s imported geometry.
 *
 * **A `model` is drawn from the answer set too, and that is worth saying because
 * it is the one kind whose picture is not entirely in there.** `asset/2` states
 * the path of a file in the project's tree and `meshpart/3` states which glTF
 * node and which primitive of it this node is; both come off the answer set like
 * a fill or a frame, so a *rule* that mints a model gets its chair drawn. Only
 * the vertices are elsewhere, because a chair is two megabytes and a document is
 * a thing that gets diffed, undone and synced. `useAsset.ts` fetches them
 * through the `AssetResolver` the host supplies — this package never learns
 * whether the tree is IndexedDB, memory or a network — and `gltf.ts`'s
 * `meshPart` is what turns the file plus the two indices into the one array the
 * importer measured the box from and the exporter writes out.
 *
 * This section used to say the opposite — not drawn, no store, `useAsset.ts`
 * deliberately unwritten — and what made that false was not this package. It was
 * that
 * the payload finally had somewhere to live — the project's own file tree,
 * rather than the content-addressed `AssetStore` that never had an
 * implementation and has since been deleted. The way in and the way out below
 * tell that story where it belongs; it is not repeated here.
 *
 * **The bounding box did not go away, and is not a fallback graphic.** A model
 * whose file the tree does not hold — a project copied without its assets, a
 * store that was cleared, a file not yet synced — is still a node with a place
 * and a size the solver decided, and its box is the honest picture of it. Which
 * of the two is showing is not an error state and is not reported from a frame
 * of rendering; `missingAssets` answers that where a person can act on it.
 * `Model.tsx` is the whole story.
 */
export {
	ViewportCanvas,
	type ViewportCanvasProps,
	type ViewportHandle,
	viewportSize,
} from "./ViewportCanvas.tsx";
export { ViewportStill, type ViewportStillProps } from "./ViewportStill.tsx";

// Picking and manipulation. The gizmo emits a `SpatialEdit` and nothing else;
// `applySpatialEdit` is the pure function that turns one into a document, built
// out of `edits.ts`'s own operations. The two are exported separately on purpose
// — a caller that already has an edit pipeline wants the first and not the
// second, and nothing that renders ever imports the second. See `edits3.ts`.
export {
	type GizmoMode,
	type TransformGizmoProps,
	TransformGizmo,
} from "./TransformGizmo.tsx";
export {
	type EditPhase,
	type SpatialEdit,
	applySpatialEdit,
	applySpatialEdits,
	editableNode,
	gizmoRefusal,
	isEmptyEdit,
	turnWritten,
} from "./edits3.ts";

// The pieces, for a caller composing its own canvas — an export preview, a
// thumbnail renderer, or the day the studio wants two views of one scene.
export {
	type GizmoSpec,
	type PointerHandlers,
	SceneTree,
	type SceneTreeProps,
	boundsHint,
	findsCamera,
} from "./SceneTree.tsx";
export { Camera, FramingCamera, ReviewCamera, type CameraProps } from "./Cameras.tsx";
export { Lights, type LightsProps } from "./Lights.tsx";
export { Model, type ModelProps } from "./Model.tsx";
export { Selection, type SelectionProps } from "./Selection.tsx";
export {
	SOLID_KINDS,
	Solid,
	type SolidKind,
	type SolidProps,
	isSolidKind,
} from "./Solid.tsx";

// The readings, exported because the inspector and the status line want the same
// answers the renderer draws with — and because when these move upstream into
// `spatial.ts`, where `docs/merged-plan.md` §6.5 says they belong, this is the
// list of names that has to keep resolving. See `readings.ts`.
export {
	type Lamp,
	type LampKind,
	type Lens,
	type Material,
	type Rendered,
	defaultLens,
	lampOf,
	lensOf,
	materialOf,
} from "./readings.ts";

// The crossing. Exported so that a caller outside this package converts through
// the same one function this package does, rather than reaching for
// `EMU_PER_PX` and getting a second answer.
export {
	type WorldBox,
	degreesOf,
	emuFromWorld,
	looksLikeColour,
	radFromMdeg,
	ratioOf,
	worldBox,
	worldEuler,
	worldFromEmu,
	worldLength,
	worldOriginOffset,
} from "./units3.ts";

export {
	type OrbitFocus,
	type OrbitPose,
	type UseOrbit,
	type UseOrbitOptions,
	orbitPosition,
	useOrbit,
} from "./useOrbit.ts";

// The gizmo's arithmetic, exported because it is the part of this package that
// can be checked headless and `gizmoMath.test.ts` is where that happens.
export {
	type Ray,
	type Vec3,
	angleDelta,
	angleInPlane,
	closestOnAxis,
	intersectPlane,
	pixelSize,
	snapTo,
} from "./gizmoMath.ts";

// The way in and the way out. Both are pure TypeScript and neither imports a
// `.tsx`, which is not an accident: `gltf.test.ts`, `gltfimport.test.ts` and
// `gltfexport.test.ts` run under `node --test` with no DOM and no WebGL, and
// Node's type stripping cannot load JSX. The exporter therefore takes
// `SolidKind` as a *type-only* import from `Solid.tsx` and guards with its own
// argument table — see `gltfexport.ts`.
//
// Both ways are wired. `exportViewportGltf` is a third format in the studio's
// export panel on any document holding a view — the panel imports this package
// dynamically, exactly as the canvas does, so a flat document still downloads
// none of it — and `export.ts`'s viewport loss sentence names it, which is what
// makes that sentence true.
//
// `importGltf` is the "Import…" button on a viewport's add row. It was
// unreachable for a long time and it was never a question of wiring: an import
// has to *put the vertices somewhere*, and there was nowhere to put them — an
// importer would have minted `model` nodes carrying a content hash nothing could
// load, which is a feature that appears to work and produces nothing.
//
// The answer turned out not to be the content-addressed store that paragraph
// used to promise. It is the project's own **file tree**, which was already
// there for images: `Studio` writes the file with `putNamedAsset`, then imports
// the parsed file at the path the write actually landed on — the ordering
// matters, because a collision suffixes and only the write knows the final name
// — and `useAsset` reads it back through the same `AssetResolver` an image goes
// through. `Model.tsx` draws its stand-in box only when the file is genuinely
// absent, which is a relink rather than a failure. See `docs/model-files.md`.
export {
	METRE_IN_EMU,
	type GltfFile,
	type GltfJson,
	type GltfWriter,
	type MaterialSpec,
	type MeshPart,
	type MeshPartEntry,
	type MetreBounds,
	type PartRef,
	type Triangles,
	boundsOf,
	centreTriangles,
	emuFromMetres,
	fitScale,
	gltfWriter,
	// The normaliser, exported because it is the one answer to "what does this
	// reference draw" and three packages must not each have their own. The
	// importer measures a node's box from it, `useAsset` builds the geometry from
	// it, and the exporter writes triangles from it — one array by construction,
	// which is what stops the editor and the export from disagreeing about where
	// a chair sits.
	meshPart,
	meshParts,
	metresFromEmu,
	parseGltfFile,
	partScale,
	readTriangles,
	triangleCount,
} from "./gltf.ts";
export { type GltfImport, type GltfImportOptions, importGltf } from "./gltfimport.ts";
export {
	GLTF_TARGET,
	SOLID_ARGS,
	type GltfExport,
	type GltfExportOptions,
	exportViewportGltf,
	gltfTarget,
	tessellate,
} from "./gltfexport.ts";
