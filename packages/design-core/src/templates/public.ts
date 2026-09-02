/**
 * The document builders, for anything outside this package that writes a scene.
 *
 * `shared.ts` and the templates were internal while every caller was in here.
 * The export refactor moved the target tests into `@clingo-design/export-html`
 * and `-svg`, and a test that builds a page out of `frame(...)` and `rect(...)`
 * is a caller outside this package — so these needed a door.
 *
 * A subpath rather than the main barrel, and that is the whole reason it is a
 * separate file: `frame`, `rect`, `text` and `at` are the right names for
 * building a scene and exactly the wrong names to put into a namespace that also
 * holds `Frame`, `TEXT_PROPS` and `atomsOf`. Importing them is asking for them.
 */
export * from "./shared.ts";
export { blank } from "./blank.ts";
export { buttons } from "./buttons.ts";
export { card } from "./card.ts";
export { component } from "./component.ts";
export { deck } from "./deck.ts";
export { machine } from "./machine.ts";
export { map } from "./map.ts";
export { pair } from "./pair.ts";
export { palette } from "./palette.ts";
export { places } from "./places.ts";
export { rail } from "./rail.ts";
export { ranked } from "./ranked.ts";
export { solids } from "./solids.ts";
export { sudoku } from "./sudoku.ts";
export { typography } from "./typography.ts";
