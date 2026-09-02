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
 * imported `model`'s vertices are not in the answer set. What *is* there is the
 * path of the file in the project's tree (`asset/2`, on `ModelNode.asset`) and
 * which part of it the node draws (`meshpart/3`, on `ModelNode.part`) — so this
 * exporter takes {@link GltfExportOptions.files}, the project's payloads keyed
 * by path, exactly as `design-core`'s `ExportOptions.images` is keyed. One rule
 * for both kinds of payload, in both exporters, which is the shape §5.3 asked
 * for and could not have until a model referenced a file.
 *
 * A model whose file the caller did not hand over exports as its bounding box
 * with a sentence in `lost` — the same answer `Model.tsx` draws on screen, which
 * is deliberate. Two readers that disagreed about what a model with no payload
 * is would be two documents.
 *
 * The geometry itself comes from `meshPart`, the one normalisation, which is
 * also what the renderer draws and what the importer measured the node's box
 * from. This module reads no accessor of its own for a model any more: it used
 * to walk *every* primitive of *every* mesh in a payload, which was right when a
 * payload was one primitive and would export an entire chair for one of its ten
 * parts now that the payload is the file.
 *
 * ## Where the loss list comes from
 *
 * Not from here, and the hand-off this paragraph used to describe as
 * outstanding has landed. What is here writes only the sentences about *this
 * document* — a payload that could not be found, a primitive that could not be
 * read. The sentences about the *format* live in `@clingo-design/export-gltf`'s
 * `TargetSpec.loses`, and the five that every export loses whatever the target
 * live in `@clingo-design/export-core`, and the driver prepends both.
 *
 * That is the same division `export-html` and `export-svg` have, and glTF gets
 * it for the same reason they do: it is an ordinary target now rather than a
 * writer the panel special-cased. `gltfTarget()` used to read
 * `EXPORT_TARGETS.gltf` through a widened record and fall back to its own copy,
 * because `ExportTarget` was `"html" | "svg"` and the key did not typecheck.
 * There is no union to be missing from any more.
 */
import {
	type ModelNode,
	type ModelScene,
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
	type MeshPart,
	type Triangles,
	fitScale,
	gltfWriter,
	meshPart,
	metresFromEmu,
	parseGltfFile,
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



/* ------------------------------------------------------------------ */
/* The API                                                             */
/* ------------------------------------------------------------------ */

export interface GltfExportOptions {
	/** Which viewport to export. Absent is the first one in the model. */
	viewport?: string;
	/** Names the scene in the file. */
	title?: string;
	/**
	 * The project's payload files, by **tree path** — `/assets/chair.glb`.
	 *
	 * `design-core`'s `ExportOptions.images` in the other exporter is the same
	 * record keyed the same way, and that is the point of the shape: a payload is
	 * a file in the project's tree whichever exporter is writing it out, and a
	 * caller collecting bytes for one collects them for the other with one walk.
	 *
	 * This replaced a resolver keyed by *node id*, which existed only because a
	 * `ModelScene` could not say which payload a model drew. It can now:
	 * `asset/2` puts the path on the node and `meshpart/3` puts the part beside
	 * it, so the by-node-id workaround has nothing left to work around.
	 *
	 * A plain record rather than a function, and unlike the resolver the renderer
	 * takes: an export is synchronous all the way up through the panel, the whole
	 * set is small (one entry per file, however many nodes draw it), and the
	 * caller has to have fetched them anyway. Absent, or missing an entry, is a
	 * bounding box and a sentence — never a failure.
	 */
	files?: Record<string, Uint8Array>;
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
	// Only what *this document* lost. The format's own sentences are the
	// plugin's, and the driver prepends them — see the module header.
	const lost: string[] = [];
	const view = findViewport(model.roots, options.viewport);
	const state: Emit = {
		writer,
		lost,
		files: options.files,
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
	files: Record<string, Uint8Array> | undefined;
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
 * An imported `model`: the part of its file where the caller handed the file
 * over, and its bounding box where it did not.
 *
 * The box is not a placeholder graphic and is not an apology. A `model` is a
 * node with a real box that the solver placed, that a rule can align and that a
 * pivot turns, and every one of those is true of the box whether or not the
 * chair inside it was handed over. `Model.tsx` draws exactly this, and
 * `docs/three-d-spec.md` §5.3 specifies exactly this sentence for it.
 *
 * Where there *is* a file, **one part of it** goes in — `node.part`, the two
 * indices the answer set carries — normalised by `meshPart` and scaled by
 * `fitScale` so its bounds fill the node's box. Both of those are the functions
 * the renderer calls on the same numbers, which is what makes "the file is the
 * picture" true of a downloaded chair and not only of a drawn one. The material
 * is the **node's**, never the file's: `gltfimport.ts` puts an imported material
 * on the node as ordinary props precisely so a designer can change it, and
 * reading it back out of the file would export the colour the chair arrived in
 * rather than the one the document says it is.
 */
function modelNode(
	state: Emit,
	node: ModelNode,
	size: readonly [number, number, number],
	material: Material,
): number {
	const spec = state.writer.material(materialSpec(material));
	const part = modelPart(state, node);
	if (!part) {
		return state.writer.node({
			name: node.id,
			scale: [size[0] || 1, size[1] || 1, size[2] || 1],
			mesh: state.writer.mesh(tessellate("box"), spec, node.id),
		});
	}
	// The part's own bounds decide the scale, so a box the designer resized
	// resizes the geometry with it — which is what the six numbers in the
	// inspector mean and what the renderer shows, through this same function.
	return state.writer.node({
		name: node.id,
		scale: fitScale(part.bounds, size),
		mesh: state.writer.mesh(part.triangles, spec, node.id),
	});
}

/**
 * The one part a `model` draws, or nothing with the reason said out loud.
 *
 * Four ways to have nothing and they are one sentence with four endings, because
 * what a reader of a loss list wants is which chair and what happened to it:
 * the answer set named no file, the caller handed no bytes for that file, the
 * bytes are not a glTF, or the file no longer holds the part the document
 * addresses — which is the stale-reference case §2.1 describes, where somebody
 * replaced `/assets/chair.glb` with a structurally different chair.
 *
 * A model with a path and **no part** is deliberately in the first case rather
 * than defaulted to `{node: 0, primitive: 0}`. A default would export whatever
 * primitive happened to be first, which is a chair nobody asked for and looks
 * right often enough to ship; and the missing atom it would paper over is
 * `meshpart/3` failing to reach the answer set, which is the exact failure
 * `f2b6316` paid for once.
 */
function modelPart(state: Emit, node: ModelNode): MeshPart | undefined {
	const missing = (because: string): undefined => {
		say(state, `Model “${node.id}” is in the file as ${because}`);
		return undefined;
	};
	if (node.asset === undefined || node.part === undefined) {
		return missing(
			"its bounding box: its geometry lives outside the document, and this export was not handed it.",
		);
	}
	const bytes = state.files?.[node.asset];
	if (!bytes) {
		return missing(
			`its bounding box: its geometry is in “${node.asset}”, and this export was not handed that file.`,
		);
	}
	let file;
	try {
		file = parseGltfFile(bytes);
	} catch {
		return missing("its bounding box: its payload could not be read.");
	}
	const part = meshPart(file, node.part);
	if ("refused" in part) {
		return missing(`its bounding box, because ${part.refused}.`);
	}
	return part;
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
