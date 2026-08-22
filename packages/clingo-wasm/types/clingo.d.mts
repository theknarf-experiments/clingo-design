/**
 * Hand-written types for the Emscripten glue built from native/CMakeLists.txt
 * (`-sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createClingo`).
 *
 * The `wasm:build` mise task copies this file to `wasm/clingo.d.mts` so that
 * TypeScript resolves it as the sibling declaration for `wasm/clingo.mjs`.
 */

export interface ClingoModuleOptions {
	/** Receives each line clingo writes to stdout. */
	print?: (line: string) => void;
	/** Receives each line clingo writes to stderr. */
	printErr?: (line: string) => void;
	/** Overrides how `clingo.wasm` is resolved. */
	locateFile?: (path: string, scriptDirectory: string) => string;
}

export type CType = "number" | "string" | null;

export interface ClingoModule {
	/**
	 * Calls an exported C function. The wasm exports:
	 *   int  run(char const *program, char const *options)
	 *   int  cd_open(char const *program, char const *options)
	 *   int  cd_solve(int id, char const *mode, int models, char const *asms)
	 *   void cd_close(int id)
	 *   int  cd_session_count()
	 */
	ccall(
		ident: string,
		returnType: CType,
		argTypes: readonly CType[],
		args: readonly (string | number)[],
	): number;
}

declare const createClingo: (
	options?: ClingoModuleOptions,
) => Promise<ClingoModule>;

export default createClingo;
