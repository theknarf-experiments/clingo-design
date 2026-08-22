/**
 * Hand-written types for the Emscripten glue that clingo's `web` target emits
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

export interface ClingoModule {
	/**
	 * Calls the exported `int run(char const *program, char const *options)`.
	 * Returns clingo's exit code; output arrives via `print`/`printErr`.
	 */
	ccall(
		ident: "run",
		returnType: "number",
		argTypes: ["string", "string"],
		args: [program: string, options: string],
	): number;
}

declare const createClingo: (
	options?: ClingoModuleOptions,
) => Promise<ClingoModule>;

export default createClingo;
