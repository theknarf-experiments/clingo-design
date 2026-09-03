/**
 * Hand-written types for the Emscripten glue at
 * `@salusoft89/planegcs/dist/planegcs_dist/planegcs.js`.
 *
 * The published tarball ships that file with no `planegcs.d.ts` beside it, and
 * every tsconfig here sets `skipLibCheck`, so the package's own
 * `dist/index.d.ts` re-exports `init_planegcs_module` as a silent `any`: calling
 * it with a misspelled option, or reading a property off the module that does
 * not exist, typechecks. Written out here for `packages/clingo-wasm/types/clingo.d.mts`'s
 * reason — a wasm boundary is exactly where a hand-written declaration earns its
 * keep — and narrowed to the two things this package touches, the module options
 * and the `GcsSystem` constructor the module carries.
 *
 * Everything else about the library is genuinely typed upstream, so
 * `GcsSystemConstructor` is imported rather than restated. The declaration is
 * applied at the one import in `src/index.ts` rather than by augmenting the
 * package, because an augmentation cannot replace an export that already exists.
 */

import type { GcsSystemConstructor } from "@salusoft89/planegcs"

export interface PlanegcsModuleOptions {
	/**
	 * Overrides how `planegcs.wasm` is resolved, called with the bare file name.
	 *
	 * Absent, the glue falls back to `new URL("planegcs.wasm", import.meta.url)`,
	 * which finds the file under Node through `fs` and does not find it in a
	 * browser once Vite has pre-bundled the dependency — see {@link SketchOptions}.
	 */
	locateFile?: (path: string, scriptDirectory: string) => string
}

/**
 * The instantiated module. Emscripten hangs a great deal more off it; this is
 * the one member the wrapper needs, and naming only it is the point.
 */
export interface PlanegcsModule {
	GcsSystem: GcsSystemConstructor
}

export type InitPlanegcsModule = (
	options?: PlanegcsModuleOptions,
) => Promise<PlanegcsModule>
