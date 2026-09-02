/**
 * The HTML + CSS target.
 *
 * The one that carries everything: the geometry, the paint, the fonts as
 * base64, the styles as classes, the states as selectors, the timelines as
 * `@keyframes`, and the whole space as one artefact where the space collapses.
 * It is the largest of the three packages for that reason and not by accident —
 * `states.ts` and `timeline.ts` are sixteen hundred lines that no other target
 * has any reading of.
 *
 * The loss list moved here from `EXPORT_TARGETS.html` in `design-core`,
 * unchanged.
 */
import type { ExportPlugin } from "@clingo-design/export-core";

/** What an HTML export cannot carry, over and above what every export loses. */
const LOSES = [
		// Was one sentence ending "…and will re-wrap if a font is missing." That
		// is no longer true of a font this project holds — it is *in* the file —
		// and it is still true of a family the design only names. The sentence is
		// split along exactly that line, because "which of my fonts travel" is
		// the question a designer opening this panel is actually asking.
		"Text is placed in a fixed box: it wraps the way the canvas measured it. A font you imported travels in this file, so it wraps the same everywhere; a system family — Georgia, system-ui — is whatever the reader's machine has, and text set in one re-wraps where it differs.",
		"A font you imported is written into this file as base64, which is a third larger than the file itself: a 250 kB woff2 adds about 330 kB, and a variable .ttf of 800 kB adds about 1.1 MB. Once per family, however many nodes wear it, and nothing is fetched — the file needs no network at all.",
		// Appended by the easing step. Conditional would have been better and is
		// not available: this list is a property of the *target*, read by the
		// panel before a document is chosen, while whether a spring is in the file
		// is a property of a universe. So it is written as a sentence that is true
		// either way — it says what a browser without `linear()` gets, which for a
		// document with no spring in it is "nothing to get".
		"A spring is a sampled curve, and a browser too old to parse `linear()` gets the nearest `cubic-bezier` instead — the same speed and direction, without the overshoot. That is a fallback rather than a loss: the file defines both and the browser picks, so the state still tweens over the duration you set. Nothing else about the pacing changes.",
		// Appended by the trigger step, in the sentence above's shape and for its
		// reason: whether a document holds a scroll clock is a property of a
		// universe and this list is a property of the target. Unlike the spring
		// one, this really is a loss rather than a fallback, and it says which —
		// a still element rather than an animation at the wrong moment, which is
		// the choice §2.5.2 of the motion spec argues at length.
		"A timeline driven by the scroll needs `animation-timeline`, which Chrome and Edge have from 115 and Firefox from 144. A browser without it plays nothing at all and shows the state's own pose — a still design rather than a wrong one, because an animation that fires once on load, before the element is anywhere near the viewport, reads to a person as a bug.",
];

export const htmlTarget: ExportPlugin = {
	id: "html",
	// The only target that collapses, and now the only place that says so. It
	// used to be `options.target !== "html"` inside the driver.
	collapses: true,
	needs: ["image", "font"],
	usesTokens: true,
	spec: {
		label: "HTML + CSS",
		extension: "html",
		mime: "text/html",
		language: "html",
		loses: LOSES,
	},
	load: async () => (await import("./html.ts")).htmlExport,
};
