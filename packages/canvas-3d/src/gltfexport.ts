/**
 * One viewport's subtree, back out as glTF 2.0 — **from the answer set**.
 *
 * ## What "from the answer set" buys, and it is the whole design
 *
 * This takes a {@link ModelScene} and never a `Scene`, which is the same
 * contract `SceneTree.tsx` keeps and for the same reason: every number in the
 * file is one the solver decided. A mesh whose width came out of an automatic
 * layout is exported at the width the layout worked out; a `solid` token holding
 * `[box, sphere]` exports as whichever one *this universe* picked; a rule that
 * aligned a chair to a wall has already moved the chair. **The file is the
 * picture, not the document** — and an exporter that read the document instead
 * would write a scene nobody had ever seen, with the mesh where it was last
 * stored rather than where the rules put it.
 *
 * The cost is stated in §5.3 of `docs/three-d-spec.md` and it is real: an
 * imported `model`'s vertices are not in the answer set. `tris/2` is, `asset/2`
 * is emitted by `compile.ts` — and `readModel` does not collect it, so a
 * `ModelScene` cannot say which payload a model draws. **That is a gap upstream,
 * reported rather than papered over**: this exporter takes a
 * {@link GltfExportOptions.geometry} resolver keyed by *node id*, because a node
 * id is the one identifier the answer set actually carries, and a model it
 * cannot resolve exports as its bounding box with a sentence in `lost` — the
 * same answer `Model.tsx` draws on screen, which is deliberate. Two readers that
 * disagreed about what a model with no payload is would be two documents.
 *
 * ## Where the loss list comes from
 *
 * Not from here. `docs/merged-plan.md` M12 puts a `gltf` entry in
 * `EXPORT_TARGETS` with the sentences `docs/three-d-spec.md` §10.3 froze, and
 * that step has not landed. So {@link gltfTarget} **reads `EXPORT_TARGETS.gltf`
 * and falls back to those frozen sentences** — the day M12 lands, the fallback
 * stops being reached and design-core is the single source, with nothing here to
 * edit. The five sentences every export loses whatever the target
 * (`export.ts`'s `ALWAYS_LOST`) are *not* repeated here, because repeating a
 * private constant is exactly the second loss list this must not become: they
 * are `exportUniverse`'s to prepend once `gltf` is one of its targets. Until
 * then a caller showing this list shows those beside it. **Outstanding
 * hand-off.**
 */
import {
	type ModelNode,
	type ModelScene,
	type TargetSpec,
	EXPORT_TARGETS,
	boxOf3,
} from "@clingo-design/design-core";
import {
	BoxGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	Euler,
	PlaneGeometry,
	Quaternion,
	SphereGeometry,
	TorusGeometry,
	type BufferGeometry,
} from "three";

import {
	type GltfLight,
	type GltfNode,
	type GltfWriter,
	type MaterialSpec,
	type Triangles,
	boundsOf,
	gltfWriter,
	metresFromEmu,
	parseGltfFile,
	readTriangles,
} from "./gltf.ts";
// **Type-only, and it has to stay that way.** `Solid.tsx` is JSX, and Node's
// type stripping — which is what runs `gltfexport.test.ts` — cannot load a
// `.tsx`. A type import is erased before Node ever sees the specifier, so the
// union stays single-sourced upstream and this module still runs headless. The
// *guard* is therefore {@link SOLID_ARGS} below rather than `isSolidKind`: a
// table that must hold all six keys is a better guard than a second list of
// them, which is what a third copy of the six words would have been.
import type { SolidKind } from "./Solid.tsx";
import { type Material, lampOf, lensOf, materialOf } from "./readings.ts";
import { emuFromWorld, worldEuler } from "./units3.ts";

/* ------------------------------------------------------------------ */
/* The target                                                          */
/* ------------------------------------------------------------------ */

/**
 * What a glTF cannot carry, in `EXPORT_TARGETS`'s own shape.
 *
 * Typed as a {@link TargetSpec} rather than as a bag of strings so that the day
 * M12 adds `gltf` to `ExportTarget` this constant is a drop-in for the entry it
 * writes, and so that a sentence changed upstream and not here is a diff rather
 * than a discovery. The three below are `docs/three-d-spec.md` §10.3's, word for
 * word.
 */
export const GLTF_TARGET: TargetSpec = {
	label: "glTF (3D)",
	extension: "gltf",
	mime: "model/gltf+json",
	// `TargetSpec.language` is `"html" | "svg"` — a syntax name for the export
	// panel's highlighter, and there is no JSON in it. `"svg"` is the honest
	// stand-in of the two: it is the XML-ish one, the panel highlights strings
	// and numbers with it, and widening the union is `export.ts`'s to do.
	language: "svg",
	loses: [
		"Everything outside the 3D view. A glTF is a scene, not a page: the artboard around this viewport, its text, its rectangles and the rest of the document are not in the file.",
		"Behaviour. A glTF has no states: what is here is the one state each instance is drawn in, and the transitions, the triggers and the other states are not in the file.",
		"Materials are approximated. A fill, a roughness and a metalness become one glTF metallic-roughness material; a shadow, a stroke and a corner radius have no meaning on a solid and are dropped.",
	],
};

/**
 * The target spec design-core holds, or this file's copy until it holds one.
 *
 * The lookup is deliberately by string against a widened record: `ExportTarget`
 * does not include `"gltf"` yet, so `EXPORT_TARGETS.gltf` does not typecheck as
 * a property access, and asserting the key exists would be asserting the thing
 * that is not true. This asks.
 */
export function gltfTarget(): TargetSpec {
	const shipped = (EXPORT_TARGETS as Record<string, TargetSpec | undefined>).gltf;
	return shipped ?? GLTF_TARGET;
}

/* ------------------------------------------------------------------ */
/* The API                                                             */
/* ------------------------------------------------------------------ */

export interface GltfExportOptions {
	/** Which viewport to export. Absent is the first one in the model. */
	viewport?: string;
	/** Names the scene in the file. */
	title?: string;
	/**
	 * An imported `model`'s payload, by **node id**.
	 *
	 * By node id rather than by asset hash, and that is a workaround with a
	 * reason: §5.3 specifies `assets?: (id: string) => Uint8Array | undefined`
	 * keyed by the content hash, and a `ModelScene` does not carry the hash —
	 * `readModel` collects `tris/2` and not `asset/2`. The node id is what an
	 * answer set has, the caller holds the document and the store and can join
	 * the two, and the signature goes back to §5.3's the day `ModelScene` grows
	 * an `assets` map.
	 *
	 * Synchronous, for §5.3's reason: an export is synchronous all the way up
	 * through the panel, and the studio prefetches.
	 */
	geometry?: (nodeId: string) => Uint8Array | undefined;
}

export interface GltfExport {
	/** The file: glTF 2.0 JSON with one embedded base64 buffer. */
	text: string;
	/** What this artefact does not carry — see the module header. */
	lost: string[];
	/** Which viewport this is, or nothing where the model held none. */
	viewport: string | undefined;
}

/**
 * The subtree of one viewport, as a glTF file.
 *
 * A model with no viewport in it comes back as an empty scene rather than as an
 * exception, with a `lost` entry saying so. That is `availableTargets`' job to
 * prevent — the panel should not offer a glTF of a flat document — and an
 * exporter that threw would turn a wrong menu into a crash.
 */
export function exportViewportGltf(
	model: ModelScene,
	options: GltfExportOptions = {},
): GltfExport {
	const writer = gltfWriter({ generator: "clingo-design" });
	const lost = [...gltfTarget().loses];
	const view = findViewport(model.roots, options.viewport);
	const state: Emit = {
		writer,
		lost,
		geometry: options.geometry,
		looks: view ? model.looks[view.id] : undefined,
	};
	if (!view) {
		say(
			state,
			"There is no 3D view in this design, so this file holds an empty scene.",
		);
		writer.roots([], options.title);
		return { text: writer.text(), lost, viewport: undefined };
	}
	// A machine anywhere in the document reaches the file, because a state copy
	// is what one instance looks like in one state and only one of them is drawn.
	// Asked of the whole model rather than of this subtree: the honest test is
	// whether the picture had a choice made in it, and a state copy's `part` is a
	// definition part id that this tree does not contain by construction.
	if (Object.keys(model.states).length > 0) {
		say(
			state,
			"Behaviour. What is in the file is the state each instance is drawn in; the other states, the transitions and the triggers are not.",
		);
	}
	writer.roots(
		view.children.map((child) => emit(state, child)).filter(isNumber),
		options.title ?? view.id,
	);
	return { text: writer.text(), lost, viewport: view.id };
}

const isNumber = (value: number | undefined): value is number => value !== undefined;

/** Everything the walk needs, so that no function below takes six arguments. */
interface Emit {
	writer: GltfWriter;
	lost: string[];
	geometry: ((nodeId: string) => Uint8Array | undefined) | undefined;
	/** The id `looks/2` named for this view, so the camera can be marked. */
	looks: string | undefined;
}

/** One sentence, once — `ExportResult.lost`'s own rule. */
function say(state: Emit, sentence: string): void {
	if (!state.lost.includes(sentence)) state.lost.push(sentence);
}

/** The viewport asked for, the first one otherwise, or nothing. */
function findViewport(
	nodes: readonly ModelNode[],
	wanted: string | undefined,
): ModelNode | undefined {
	for (const node of nodes) {
		if (node.kind === "viewport" && (wanted === undefined || node.id === wanted)) {
			return node;
		}
		const found = findViewport(node.children, wanted);
		if (found) return found;
	}
	return undefined;
}

/* ------------------------------------------------------------------ */
/* The walk                                                            */
/* ------------------------------------------------------------------ */

/**
 * One node, as a glTF node — the same two-group chain `SceneTree.tsx` mounts.
 *
 * `spatial.ts` gives every node two matrices and this writes them as two nested
 * glTF nodes, for exactly the reason the renderer mounts two groups:
 *
 *   - the outer node is `T(centre) · R`, the node's **centred** space, which is
 *     the space glTF positions a node in and the space the document's rotation
 *     is about;
 *   - the inner one is the extra `T(−half)` to the node's **origin**, the
 *     near-top-left-near corner, which is what a child's frame is relative to.
 *
 * The geometry hangs off the outer node on a third node of its own, carrying the
 * box as a `scale`, because a scale on the outer node would scale the children
 * too. Three nodes where a renderer mounts two groups and a mesh, and the shapes
 * correspond one for one — which is the property that makes "the file is the
 * picture" checkable rather than aspirational.
 *
 * Returns nothing for a node with nothing under it and nothing of its own: an
 * empty glTF node is a node a viewer draws in its outliner, and a document's
 * rectangles have no business appearing in one.
 */
function emit(state: Emit, node: ModelNode): number | undefined {
	const box = boxOf3(node);
	const size: [number, number, number] = [
		Math.abs(metresFromEmu(box.width)),
		Math.abs(metresFromEmu(box.height)),
		Math.abs(metresFromEmu(box.depth)),
	];
	const children: number[] = [];

	// What the node *is*. The switch is the same one `SceneTree.tsx` makes and is
	// silent about the same kinds, for the same reason: there is no honest answer
	// to what a paragraph of text is in three dimensions, and a quad with the
	// words on it would be inventing one.
	switch (node.kind) {
		case "mesh": {
			const material = materialOf(node.rendered);
			warnColour(state, node, material);
			children.push(
				state.writer.node({
					name: node.id,
					scale: size,
					mesh: state.writer.mesh(
						tessellate(solidKind(node.rendered.solid)),
						state.writer.material(materialSpec(material)),
						node.id,
					),
				}),
			);
			break;
		}
		case "model": {
			const material = materialOf(node.rendered);
			warnColour(state, node, material);
			children.push(modelNode(state, node, size, material));
			break;
		}
		default:
			break;
	}

	// The children, in their own node, one translation further out — and only
	// when there are any, so a leaf is two nodes rather than three.
	const inside = node.children.map((child) => emit(state, child)).filter(isNumber);
	if (inside.length > 0) {
		children.push(
			state.writer.node({
				name: `${node.id} contents`,
				// `F · (−w/2, −h/2, −d/2)` is `(−w/2, +h/2, +d/2)`. Written out rather
				// than routed through a point-crossing function for `units3.ts`'s
				// reason: an offset vector and a point cross by different rules and
				// only happen to agree here.
				translation: [-size[0] / 2, size[1] / 2, size[2] / 2],
				children: inside,
			}),
		);
	}

	const own: GltfNode = {
		name: node.id,
		translation: crossPoint(
			box.x + box.width / 2,
			box.y + box.height / 2,
			box.z + box.depth / 2,
		),
		...rotation(node),
		...(children.length > 0 ? { children } : {}),
	};
	if (node.kind === "camera") {
		const written = camera(state, node);
		if (written === undefined) return undefined;
		own.camera = written;
	}
	if (node.kind === "light") {
		const written = light(state, node);
		if (written === undefined) return undefined;
		own.extensions = { KHR_lights_punctual: { light: written } };
	}
	if (children.length === 0 && own.camera === undefined && own.extensions === undefined) {
		return undefined;
	}
	return state.writer.node(own);
}

/**
 * A document point as a glTF one: **metres, y up, z toward the viewer**.
 *
 * The one crossing on the way out, and it is `renderPoint`'s — `F = diag(1, −1,
 * −1)` — because glTF's coordinate system and three.js's are the same one. What
 * is *not* shared is the unit: the renderer works in CSS pixels for float
 * precision, and a file works in metres because that is glTF's convention and
 * because {@link metresFromEmu} is exact. So this converts from EMU directly and
 * never through a pixel, which would have rounded twice.
 */
const crossPoint = (x: number, y: number, z: number): [number, number, number] => [
	metresFromEmu(x),
	metresFromEmu(-y),
	metresFromEmu(-z),
];

/**
 * A node's turn, as a glTF quaternion.
 *
 * Through {@link worldEuler}, which is this package's one statement about how a
 * document rotation crosses into three.js's frame — conjugation by `F`, which
 * negates the y and z Euler angles — and then through three.js's own
 * `setFromEuler` in `XYZ` order, which is the order `spatial.ts`'s
 * `rotationMatrix` is held equal to. Two libraries and no hand-written
 * trigonometry: the crossing is stated once in `units3.ts` and the quaternion
 * algebra belongs to three.js.
 *
 * Absent rather than an identity quaternion where a node is not turned, because
 * a glTF node with no `rotation` is a node with no rotation and writing four
 * numbers to say so makes every flat export bigger and no clearer.
 */
function rotation(node: ModelNode): { rotation?: number[] } {
	if (!node.turn) return {};
	const [x, y, z] = worldEuler(node.turn);
	if (x === 0 && y === 0 && z === 0) return {};
	const q = new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ"));
	return { rotation: [q.x, q.y, q.z, q.w] };
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/**
 * The six primitives, tessellated by **the same constructors and the same
 * segment counts `Solid.tsx` draws with**.
 *
 * Not a coincidence and not a copy that hopes: `gltfexport.test.ts` calls
 * `Solid` as a plain function, reads the `args` off the geometry element it
 * returns, and asserts they are the numbers below. A sphere in the file has the
 * silhouette the sphere in the viewport had, or the test fails — which is the
 * only way "the file is the picture" survives somebody tuning a segment count.
 *
 * Unit sized and centred, exactly as `Solid.tsx` builds them, with the box
 * applied as the node's `scale`. That is what makes a sphere in a non-cubic
 * frame an ellipsoid in the file as well as on screen.
 */
export const SOLID_ARGS: Record<SolidKind, readonly number[]> = {
	box: [1, 1, 1],
	sphere: [0.5, 32, 16],
	cylinder: [0.5, 0.5, 1, 32],
	cone: [0.5, 1, 32],
	plane: [1, 1],
	torus: [0.375, 0.125, 16, 48],
};

/**
 * Which constructor each word names, separately from the numbers it is given.
 *
 * The split is what lets `gltfexport.test.ts` compare {@link SOLID_ARGS} against
 * the `args` written in `Solid.tsx` as *numbers* rather than as behaviour — a
 * segment count retuned in one place and not the other is then a failed
 * assertion with both lists printed, rather than a silhouette somebody notices
 * in a download three weeks later.
 */
const GEOMETRY: Record<SolidKind, (args: readonly number[]) => BufferGeometry> = {
	box: (a) => new BoxGeometry(a[0], a[1], a[2]),
	sphere: (a) => new SphereGeometry(a[0], a[1], a[2]),
	cylinder: (a) => new CylinderGeometry(a[0], a[1], a[2], a[3]),
	cone: (a) => new ConeGeometry(a[0], a[1], a[2]),
	plane: (a) => new PlaneGeometry(a[0], a[1]),
	torus: (a) => new TorusGeometry(a[0], a[1], a[2], a[3]),
};

/**
 * The word one universe resolved `solid` to, or `box` where it is not one of the
 * six.
 *
 * `VALUE_TYPES.solid`'s own fallback, which is what `SceneTree.tsx` falls back
 * to and what `edits.ts` says about an unrecognised solid: *"an unknown word is
 * kept rather than repaired"*. A `solid` can resolve through a token to
 * anything, so this is a document with a typo in it and not a document that
 * cannot be exported.
 */
const solidKind = (word: string | undefined): SolidKind =>
	word !== undefined && Object.hasOwn(SOLID_ARGS, word) ? (word as SolidKind) : "box";

/** One primitive as a triangle soup, built once per export and thrown away. */
export function tessellate(kind: SolidKind): Triangles {
	const geometry = GEOMETRY[kind](SOLID_ARGS[kind]);
	const triangles = fromBufferGeometry(geometry);
	// three.js geometries own GPU-side buffers even when nothing rendered them,
	// and an exporter that made a hundred of them and kept none would leak a
	// hundred. Disposing here is free and is the library's own contract.
	geometry.dispose();
	return triangles;
}

function fromBufferGeometry(geometry: BufferGeometry): Triangles {
	const position = geometry.getAttribute("position");
	const normal = geometry.getAttribute("normal");
	const uv = geometry.getAttribute("uv");
	const index = geometry.getIndex();
	const positions = Float32Array.from(position.array);
	return {
		positions,
		...(normal ? { normals: Float32Array.from(normal.array) } : {}),
		...(uv ? { uvs: Float32Array.from(uv.array) } : {}),
		indices: index
			? Uint32Array.from(index.array)
			: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i),
	};
}

/**
 * An imported `model`: its payload where the caller could resolve one, and its
 * bounding box where it could not.
 *
 * The box is not a placeholder graphic and is not an apology. A `model` is a
 * node with a real box that the solver placed, that a rule can align and that a
 * pivot turns, and every one of those is true of the box whether or not the
 * chair inside it was handed over. `Model.tsx` draws exactly this, and
 * `docs/three-d-spec.md` §5.3 specifies exactly this sentence for it.
 *
 * Where there *is* a payload, its geometry is scaled so its bounds fill the
 * node's box — the same rule the stand-in follows, and the rule a loader has to
 * follow for the picture and the file to agree. The material is the **node's**,
 * never the payload's: `gltfimport.ts` puts an imported material on the node as
 * ordinary props precisely so a designer can change it, and reading it back off
 * the payload would export the colour the chair arrived in rather than the one
 * the document says it is.
 */
function modelNode(
	state: Emit,
	node: ModelNode,
	size: readonly [number, number, number],
	material: Material,
): number {
	const spec = state.writer.material(materialSpec(material));
	const bytes = state.geometry?.(node.id);
	const parts = bytes ? payloadParts(state, node, bytes) : undefined;
	if (!parts || parts.length === 0) {
		say(
			state,
			`Model “${node.id}” is in the file as its bounding box: its geometry lives outside the document, and this export was not handed it.`,
		);
		return state.writer.node({
			name: node.id,
			scale: [size[0] || 1, size[1] || 1, size[2] || 1],
			mesh: state.writer.mesh(tessellate("box"), spec, node.id),
		});
	}
	// The payload's own bounds decide the scale, so a box the designer resized
	// resizes the geometry with it — which is what the six numbers in the
	// inspector mean and what the renderer shows.
	const bounds = parts.map((part) => boundsOf(part));
	const extent = (axis: 0 | 1 | 2): number =>
		Math.max(...bounds.map((b) => b.max[axis] - b.min[axis]), 0);
	const scale: [number, number, number] = [
		fit(size[0], extent(0)),
		fit(size[1], extent(1)),
		fit(size[2], extent(2)),
	];
	return state.writer.node({
		name: node.id,
		scale,
		mesh: state.writer.meshOf(
			parts.map((triangles) => ({ triangles, material: spec })),
			node.id,
		),
	});
}

/**
 * How much to scale one axis of a payload to fill one axis of a box.
 *
 * `1` where either is zero, which covers the two real cases: a flat payload — a
 * plane has no thickness and no scale makes it thick — and a node whose depth
 * the document never stated. Dividing anyway would give `0` or `Infinity`, and
 * both of them are a mesh nobody can see.
 */
const fit = (want: number, have: number): number =>
	want === 0 || have === 0 ? 1 : want / have;

/** Every triangle soup in a payload, or nothing where it could not be read. */
function payloadParts(state: Emit, node: ModelNode, bytes: Uint8Array): Triangles[] {
	let file;
	try {
		file = parseGltfFile(bytes);
	} catch {
		say(
			state,
			`Model “${node.id}” is in the file as its bounding box: its payload could not be read.`,
		);
		return [];
	}
	const parts: Triangles[] = [];
	for (const mesh of file.json.meshes ?? []) {
		for (const primitive of mesh.primitives) {
			const read = readTriangles(file, primitive);
			if ("triangles" in read) parts.push(read.triangles);
		}
	}
	return parts;
}

/* ------------------------------------------------------------------ */
/* Materials, lenses and lamps                                         */
/* ------------------------------------------------------------------ */

/**
 * A {@link Material} as glTF's metallic-roughness numbers.
 *
 * The colour crosses from CSS sRGB to glTF's **linear** RGB, and three.js's
 * `Color` does it rather than this file: `ColorManagement` has been on by
 * default since r152, `setStyle` converts on the way in and `toArray` hands back
 * the working-space values, which are the linear ones glTF's `baseColorFactor`
 * is defined in. A hand-rolled `pow(c, 2.4)` here would be a second colour
 * pipeline one import away from the first.
 *
 * Nothing is clamped here. `readings.ts` clamped every one of these once, which
 * is `docs/merged-plan.md` §6.5's rule — two clamp sites is two answers — and
 * this is downstream of it.
 */
function materialSpec(material: Material): MaterialSpec {
	const colour = material.colour
		? new Color(material.colour).toArray()
		: undefined;
	return {
		...(colour
			? { baseColour: [colour[0] ?? 1, colour[1] ?? 1, colour[2] ?? 1] }
			: {}),
		opacity: material.opacity,
		metallic: material.metalness,
		roughness: material.roughness,
	};
}

/**
 * A fill that is not a colour is a fill a material cannot carry — said once per
 * document rather than once per node.
 *
 * A gradient is a real thing to paint a rectangle with and is not a thing a
 * metallic-roughness material has. `looksLikeColour` already refused it inside
 * `materialOf`, which is why `material.colour` is `undefined` here; without this
 * sentence the only trace would be a solid that came out the file's default
 * white.
 */
function warnColour(state: Emit, node: ModelNode, material: Material): void {
	if (material.colour === undefined && node.rendered.fill !== undefined) {
		say(
			state,
			"A fill that is not a flat colour — a gradient, or a token holding one — is not a material a glTF has. Those surfaces are in the file with no colour of their own.",
		);
	}
}

/**
 * A `camera` node's lens, as a glTF perspective camera.
 *
 * Through `lensOf`, so the file's lens is the same one the viewport draws with,
 * refusals and all — `far` behind `near` is repaired there, once. The
 * consequence is that the clip planes come back in **renderer units** and have
 * to go back to EMU to become metres, which is one quantization more than a
 * direct read would cost. Taken deliberately: a second lens reader in this
 * package would be a second answer to what `PROPS.far` means, and a millimetre
 * on a clip plane is not a thing anybody can see.
 *
 * `yfov` is in radians, which is glTF's convention and three.js's `fov` in
 * degrees is not — the one unit that differs between them, converted here.
 */
function camera(state: Emit, node: ModelNode): number | undefined {
	const lens = lensOf(node.rendered);
	if (state.looks !== undefined && state.looks !== node.id) {
		say(
			state,
			"A glTF names no default camera. Every camera in the view is in the file; which one a viewer opens with is the viewer's decision, not the document's.",
		);
	}
	return state.writer.camera({
		type: "perspective",
		name: node.id,
		perspective: {
			yfov: (lens.fov * Math.PI) / 180,
			znear: Math.max(metresFromEmu(emuFromWorld(lens.near)), 1e-6),
			zfar: metresFromEmu(emuFromWorld(lens.far)),
		},
	});
}

/**
 * A `light` node as a `KHR_lights_punctual` lamp.
 *
 * Three of the document's four kinds are glTF's three. The fourth — `ambient` —
 * has **no punctual equivalent at all**: glTF's extension is directional, point
 * and spot, and an ambient term is a property of an environment rather than of a
 * lamp. §10.3 fixes the answer: a very low-intensity directional light, and a
 * sentence. Not silence, because a scene that was lit ambiently and arrives
 * unlit reads as a broken export; not a bright directional, because a lamp that
 * cast shadows where the document cast none would be a different picture.
 *
 * The intensity crosses as itself, unconverted, for the reason `gltfimport.ts`
 * gives in the other direction: glTF's is photometric — lux for a directional
 * lamp, candela for the other two — and the document's is a bare multiplier that
 * `Lights.tsx` applies with `decay: 0`. There is no conversion between them
 * without a scene scale the document has not got, and a magic constant would be
 * worse than a stated difference.
 */
function light(state: Emit, node: ModelNode): number | undefined {
	const lamp = lampOf(node.rendered);
	const colour = new Color(lamp.colour).toArray();
	const spec: GltfLight = {
		type: lamp.kind === "ambient" ? "directional" : lamp.kind,
		name: node.id,
		color: [colour[0] ?? 1, colour[1] ?? 1, colour[2] ?? 1],
		intensity: lamp.kind === "ambient" ? lamp.intensity * AMBIENT_STANDIN : lamp.intensity,
	};
	if (lamp.kind === "ambient") {
		say(
			state,
			`Ambient light. A glTF has no ambient lamp, so “${node.id}” is in the file as a very dim directional one: the scene will be lit from a direction it was not lit from, and darker on the far side than the viewport showed it.`,
		);
	}
	say(
		state,
		"A lamp's brightness is not the same number in a glTF. The document's is a plain multiplier applied with no distance falloff; a glTF's is lux or candela, and a viewer that reads it physically will want it set again.",
	);
	return state.writer.light(spec);
}

/**
 * How much of an ambient lamp's brightness survives as a directional one.
 *
 * A tenth, which is the only number in this file chosen by taste rather than by
 * derivation, so here is the taste: an ambient term lifts every surface equally
 * and a directional one lifts the surfaces facing it, so matching the brightness
 * would make the lit side much brighter than the viewport showed. A tenth keeps
 * the scene from going black without pretending the stand-in is the thing.
 */
const AMBIENT_STANDIN = 0.1;
