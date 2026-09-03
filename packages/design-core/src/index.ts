export * from "./units.ts";
export * from "./ruler.ts";
export * from "./values.ts";
export * from "./scene.ts";
export * from "./components.ts";
export * from "./pages.ts";
export * from "./machines.ts";
export * from "./machinecheck.ts";
export * from "./geometry.ts";
export * from "./spatial.ts";
export * from "./assets.ts";
export * from "./fonts.ts";
export * from "./measure.ts";
export * from "./tree.ts";
export * from "./lines.ts";
export * from "./edits.ts";
export * from "./annotate.ts";
export * from "./compile.ts";
export * from "./highlight.ts";
export * from "./project.ts";
export * from "./reconcile.ts";
export * from "./templates/index.ts";
export * from "./solver.ts";
export * from "./directSolver.ts";
export * from "./atoms.ts";
export * from "./sketch.ts";
export * from "./model.ts";
export * from "./derived.ts";
export * from "./sampling.ts";
export * from "./freedom.ts";
export * from "./relax.ts";
export * from "./stuck.ts";
export * from "./why.ts";
export * from "./explore.ts";
export * from "./paint.ts";
export * from "./runtime.ts";

/**
 * The sketch solver's vocabulary, forwarded so that one import names a whole
 * thought.
 *
 * `SketchPass`, `SketchReport` and `Universe.sketch` are this package's own, but
 * they are spelled in these — a pass takes a `SketchRequest` and answers a
 * `SketchOutcome` — so a caller that holds one and wants to say what it returns
 * would otherwise need a second import of a package it never mentions again.
 *
 * Types only, and that is load-bearing rather than tidy. `openSketcher` reaches
 * for the wasm, and `verbatimModuleSyntax` means `export type` leaves nothing
 * behind in the emitted barrel — so design-core stays a package that a headless
 * `node --test` can import without a binary anywhere near it, exactly as it was
 * before the sketch layer existed. The app opens its sketcher from
 * `@clingo-design/planegcs` directly, which is the only place a value crosses.
 */
export type {
	SketchOptions,
	SketchOutcome,
	SketchRequest,
	SketchRule,
	Sketcher,
} from "@clingo-design/planegcs";
