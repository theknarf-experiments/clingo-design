# @clingo-design/clingo-wasm

[clingo](https://potassco.org/clingo/) — the Potassco ASP grounder and solver —
compiled to WebAssembly and wrapped in a typed Promise API.

## How the build works

Clingo ships an official Emscripten target (`CLINGO_BUILD_WEB`, source in
`app/web/main.cc`) that exports one C function:

```c
int run(char const *program, char const *options);
```

It feeds `program` to clingo over a redirected stdin, splits `options` on
whitespace into `argv`, and returns clingo's exit code. Output arrives through
the Emscripten runtime's `print` / `printErr` callbacks.

The `wasm:build` mise task drives the whole thing:

1. `wasm:fetch` shallow-clones the pinned clingo tag (`CLINGO_VERSION` in
   `mise.toml`) with its `clasp` submodule into `vendor/`.
2. `emcmake cmake` configures the `web` target — Python, Lua and threads off,
   `-Os`, ES6 module output.
3. `cmake --build` produces `.build/bin/clingo.js` + `clingo.wasm`.
4. Artifacts are copied to `wasm/` as `clingo.mjs` / `clingo.wasm`, plus
   `clingo.d.mts` (from `types/`) so TypeScript can resolve the glue module.

`vendor/`, `.build/` and `wasm/` are all generated and gitignored. The task
declares `sources`/`outputs`, so mise skips the work when nothing changed.

```sh
mise run wasm:build      # compile (fetches the source on first run)
mise run wasm:clean      # drop .build/ and wasm/
mise run wasm:distclean  # also drop vendor/
```

The toolchain (`emsdk`, `cmake`, `ninja`) is pinned in the repo-root
`mise.toml`; `mise install` gets it.

## Usage

```ts
import { solve, answerSets } from "@clingo-design/clingo-wasm";

const result = await solve("1 { p(1..3) } 1. #show p/1.", { models: 0 });

result.Result;            // "SATISFIABLE"
answerSets(result);       // [["p(1)"], ["p(2)"], ["p(3)"]]
```

`solve()` adds `--outf=2` and parses clingo's JSON output. For anything else,
`run()` returns the raw exit code and streams:

```ts
import { run, ExitCode } from "@clingo-design/clingo-wasm";

const { code, stdout, stderr } = await run("a. b.", ["--models=0"]);
code === (ExitCode.SATISFIABLE | ExitCode.EXHAUSTED); // true
```

Errors from clingo (syntax errors, bad options) are thrown as `ClingoError`,
which carries `code`, `stdout` and `stderr`.

### Notes

- The WebAssembly instance is instantiated once and reused; `reset()` drops it
  and `init()` warms it up ahead of time.
- Calls are serialised internally — the instance is single-threaded and output
  is captured through shared buffers, so overlapping runs would interleave.
- Built for `web`, `worker` and `node`. The Node support is a guarded dynamic
  `import("node:module")`; bundlers report it as externalised, but it never
  executes in a browser.
- Threads are disabled, so clingo's parallel solving options are unavailable.
