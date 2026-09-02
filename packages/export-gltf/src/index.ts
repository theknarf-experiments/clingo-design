/**
 * The glTF target — the one this whole refactor is named after.
 *
 * There were three targets before there was a plugin contract, and this was the
 * third: a writer that needs three.js's geometry constructors to tessellate a
 * sphere, so it could not live in `design-core`, so it lived in the export panel
 * as `type PanelTarget = ExportTarget | "gltf"` plus a dynamic import, a branch
 * that built a different result shape, a rule of its own about which universe it
 * was allowed, and a label lookup with a fallback. Five special cases, each of
 * them saying "this is a target too" in a way the type could not.
 *
 * It is thirty lines now, and every one of those five is gone.
 *
 * **A thin package on purpose.** The writer itself stays in `canvas-3d`, where
 * its dependencies are: it reads `Solid.tsx`'s kinds, `readings.ts`' materials
 * and `units3.ts`' world transform, and dragging those across a package boundary
 * to satisfy a diagram would be moving three files to avoid one import. What is
 * here is the adaptation — a spec, the two facts the driver needs, and the
 * function that turns a `(index, layers, options)` call into the `(model,
 * options)` one `exportViewportGltf` already had.
 *
 * **Nothing here pulls three.js until somebody picks glTF.** Importing this
 * module gets a spec and a closure; the `import()` inside `load()` is what
 * reaches `canvas-3d`, and it is the reason `ExportPlugin.load` is a promise for
 * every target rather than only for this one — see the essay on `ExportPlugin`.
 */
import type { ExportPlugin } from "@clingo-design/export-core";

/** What a glTF cannot carry, over and above what every export loses. */
const LOSES = [
	"Everything outside the 3D view. A glTF is a scene, not a page: the artboard around this viewport, its text, its rectangles and the rest of the document are not in the file.",
	"Behaviour. A glTF has no states: what is here is the one state each instance is drawn in, and the transitions, the triggers and the other states are not in the file.",
	"Materials are approximated. A fill, a roughness and a metalness become one glTF metallic-roughness material; a shadow, a stroke and a corner radius have no meaning on a solid and are dropped.",
];

export interface GltfTargetOptions {
	/** Which viewport to write. Absent is the first one in the model. */
	viewport?: string;
}

/** `chair view` -> `chair-view`, so a bound viewport can name a file. */
const slugPart = (name: string): string =>
	name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The plugin, bound to a viewport.
 *
 * A factory rather than a constant, and that is the answer to the one question
 * this target asks that the others do not: *which* viewport. The alternatives
 * were a `viewport?: string` on `ExportOptions` — a field on the shared type
 * that exactly one target reads, which is the sort of thing this refactor exists
 * to remove — or a bag of untyped extras. Binding it at composition time is
 * neither: the caller already knows which view is selected, and a plugin is an
 * ordinary value it can build.
 */
export function gltfTarget(options: GltfTargetOptions = {}): ExportPlugin {
	return {
		id: "gltf",
		// A glTF holds one arrangement of one set of objects, and has no
		// equivalent of a media query or a custom property to hold a second.
		collapses: false,
		single:
			"A glTF holds one arrangement of one set of objects, so the whole space cannot collapse into it the way a stylesheet can.",
		// A glTF is a scene, so two viewports are two files: the page's name alone
		// would put one name on both. The old panel spelled this
		// `${projectName}-${viewport}.gltf` in a branch of its own.
		filename: (base) => (options.viewport ? `${base}-${slugPart(options.viewport)}` : base),
		needs: ["mesh"],
		// A glTF has no custom properties and no cascade.
		usesTokens: false,
		spec: {
			label: "glTF (3D)",
			extension: "gltf",
			mime: "model/gltf+json",
			// `"json"`, which it always was. It said `"svg"` before, with a comment
			// calling it "the honest stand-in of the two" and noting that widening
			// the union was `export.ts`'s to do. The contract widened; the
			// workaround went.
			language: "json",
			loses: LOSES,
		},
		load: async () => {
			const { exportViewportGltf } = await import("@clingo-design/canvas-3d");
			return (_index, layers, opts) => {
				const out = exportViewportGltf(layers[0].universe.model, {
					viewport: options.viewport,
					title: opts.title,
					// The same record, keyed the same way: a payload is a file in the
					// project's tree whichever exporter is writing it out, which is why
					// `ExportOptions.images` and `GltfExportOptions.files` were already
					// the same shape before either knew about the other.
					files: opts.images,
				});
				// No classes, and not because they were dropped: a glTF has no
				// stylesheet for a style to be shared in, so the driver's sentence
				// about what a class costs has nothing to attach to.
				return { text: out.text, classes: [], lost: out.lost };
			};
		},
	};
}
