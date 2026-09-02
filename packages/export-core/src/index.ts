/**
 * The export contract, and everything an export needs that is not a target.
 *
 * A target is a package — `@clingo-design/export-html`, `-svg`, `-gltf` — and
 * this is what they have in common: what a plugin is, what a caller hands one,
 * the document index and layers every emitter reads, the collapse that decides
 * whether several designs are one artefact, and the driver that turns an
 * emitter's text into a result with the losses named.
 *
 * Nothing here knows the name of any target.
 */
export * from "./contract.ts";
export * from "./options.ts";
export * from "./losses.ts";
export * from "./document.ts";
export * from "./text.ts";
export * from "./drawn.ts";
export * from "./collapse.ts";
export * from "./emit.ts";
