/**
 * The two entry points, and the one thing they now do differently.
 *
 * `emit` used to choose an emitter with `options.target === "svg" ? svgExport :
 * htmlExport`, which meant this file imported both targets and every target had
 * to be in this package. It takes a {@link ExportPlugin} instead, so the driver
 * knows what an export *is* — the losses every artefact has, the sentence a
 * class costs, the filename — and nothing at all about what any target *emits*.
 *
 * Everything else about these functions is what it was.
 */
import { type Scene, parseVariable } from "@clingo-design/design-core";

import type { ExportPlugin } from "./contract.ts";
import { type Collapse, collapseSpace } from "./collapse.ts";
import { type DocIndex, type Layer, indexDocument, slug } from "./document.ts";
import { ALWAYS_LOST, GRID_LOST, isRuled } from "./losses.ts";
import type { ExportOptions, ExportResult, ExportUniverse } from "./options.ts";

async function emit(
	index: DocIndex,
	layers: readonly Layer[],
	plugin: ExportPlugin,
	options: ExportOptions,
	note: string,
	/** The variable the layers switch between, where they switch one. */
	varying?: string,
): Promise<ExportResult> {
	const spec = plugin.spec;
	// The emitter is not loaded for a document with nothing in it. That is not an
	// optimisation — an empty design is the state a new project is in, and a
	// panel open on one should not fetch a target's code to be told there is
	// nothing to write.
	const out =
		layers.length === 0
			? { text: "", classes: [], lost: [] }
			: (await plugin.load())(index, layers, options);
	const lost = [...ALWAYS_LOST, ...spec.loses, ...out.lost];
	if (isRuled(index.scene)) lost.push(GRID_LOST);
	if (options.tokens === false) {
		lost.push("Token names: every value is inlined as the literal it resolved to.");
	}
	if (layers.length > 1) {
		// The collapsed export keeps the varying variable; everything else about
		// the space is still gone.
		lost[0] =
			"The rest of the space. This artefact holds the one variable that separates these designs; any other design in the document is not in it.";
	}
	// A style is the one thing here that does *not* flatten: it comes out as the
	// class it already was, so what a class loses is not the treatment but the
	// *choice* — which variant. Unless the variant is exactly what the layers
	// switch, in which case both of them are in the file and the loss would be a
	// lie.
	if (out.classes.length > 0) {
		const names = out.classes.map((c) => `.${c.name}`).join(", ");
		const switched =
			varying !== undefined && parseVariable(varying)?.kind === "style";
		lost.push(
			switched
				? `Every variant but two. ${names} came out as ${out.classes.length === 1 ? "a class" : "classes"} and the layers switch between the two treatments these designs picked; a third variant would not be in the file.`
				: `Which treatment. ${names} came out as ${out.classes.length === 1 ? "a class" : "classes"} — one place to edit, and every wearer follows — but a class holds one variant, and the style's others are not in the file.`,
		);
		// A wearer only the answer set names shares the class, and that is the
		// point of reading it back — but it brings no *name* with it, because the
		// document has no value of its own to have named one.
		const derived = out.classes.filter((c) => c.derived.length > 0);
		if (derived.length > 0) {
			lost.push(
				`Token names under ${derived.map((c) => `.${c.name}`).join(", ")}. A node an instance or a rule dressed wears the class like any other, but a property no wearer the document holds takes from the style reaches it as a literal rather than as the token it linked to.`,
			);
		}
	}
	// Named after the page, unless the target has a reason of its own — see
	// `ExportPlugin.filename`, which exactly one of the three has.
	const base = slug(options.title ?? "design");
	return {
		target: plugin.id,
		filename: `${plugin.filename?.(base) ?? base}.${spec.extension}`,
		text: out.text,
		lost,
		note,
	};
}

/** One design, as a file. */
export function exportUniverse(
	scene: Scene,
	universe: ExportUniverse,
	plugin: ExportPlugin,
	options: ExportOptions,
): Promise<ExportResult> {
	return emit(
		indexDocument(scene),
		[{ universe, media: null, under: null, label: "The design" }],
		plugin,
		options,
		"One universe, as it stands.",
	);
}

/**
 * The whole space as one artefact, where that is sound — and one universe with
 * the reason where it is not.
 *
 * Which targets those are is the plugin's answer now rather than this file's.
 * It used to read `options.target !== "html"`, which was true, and was a fact
 * about HTML asserted here by naming it — so a fourth target that grew media
 * queries would have had to be added to a condition in a package that should
 * never have heard of it.
 */
export function exportSpace(
	scene: Scene,
	universes: readonly ExportUniverse[],
	plugin: ExportPlugin,
	options: ExportOptions,
): Promise<ExportResult> {
	const index = indexDocument(scene);
	if (universes.length === 0) {
		return emit(index, [], plugin, options, "There is no design to export.");
	}
	const collapsed: Collapse | { reason: string } = collapseSpace(scene, universes);
	if ("reason" in collapsed || !plugin.collapses) {
		const reason =
			"reason" in collapsed
				? collapsed.reason
				: (plugin.single ??
					`${plugin.spec.label} holds one design, so the space did not collapse into it.`);
		return emit(
			index,
			[{ universe: universes[0], media: null, under: null, label: "The design" }],
			plugin,
			options,
			reason,
		);
	}
	return emit(index, collapsed.layers, plugin, options, collapsed.note, collapsed.variable);
}
