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
 * (the lens, and being looked through), and the framing fallback for a view that
 * names no camera.
 *
 * **Not drawn: a `model`'s imported geometry.** It renders as its bounding box.
 * `design-core/src/assets.ts` and the `AssetStore` it defines do not exist in
 * the tree, so there is nothing to load a payload through and `useAsset.ts` is
 * deliberately unwritten rather than stubbed. `Model.tsx` is the whole story.
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
// unreachable until recently and it was never a question of wiring: an import
// has to *put the vertices somewhere*, and until `design-core/src/assets.ts`
// defined what a store is there was nowhere to put them — an importer would have
// minted `model` nodes carrying a content hash nothing could load, which is a
// feature that appears to work and produces nothing. That piece exists now: the
// app implements the store over IndexedDB, `Studio` puts the payloads before it
// touches the document, and `useAsset` resolves them back into geometry for
// `Model.tsx`, which draws its stand-in box only when the bytes are genuinely
// absent — a relink rather than a failure.
export {
	METRE_IN_EMU,
	type GltfFile,
	type GltfJson,
	type GltfWriter,
	type MaterialSpec,
	type MetreBounds,
	type Triangles,
	boundsOf,
	centreTriangles,
	emuFromMetres,
	gltfWriter,
	metresFromEmu,
	parseGltfFile,
	readTriangles,
	triangleCount,
} from "./gltf.ts";
export {
	type GltfImport,
	type GltfImportOptions,
	type ImportedAsset,
	importGltf,
} from "./gltfimport.ts";
export {
	GLTF_TARGET,
	SOLID_ARGS,
	type GltfExport,
	type GltfExportOptions,
	exportViewportGltf,
	gltfTarget,
	tessellate,
} from "./gltfexport.ts";
