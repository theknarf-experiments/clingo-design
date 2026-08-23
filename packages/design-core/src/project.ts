/**
 * Projects: a named {@link Scene} plus metadata, and the pure operations the
 * overview page needs. Storage is the caller's problem — everything here is
 * plain data in, plain data out, so it can be tested without a browser.
 *
 * A project used to be an entry in one JSON blob, which is why the reader for
 * that blob still lives at the bottom of this file.
 */
import {
	ALIGNMENTS,
	type AutoLayout,
	JUSTIFICATIONS,
	CONSTRAINT_KINDS,
	type Constraint,
	DEFAULT_FRAME,
	KINDS,
	PROPS,
	RULES_HEADER,
	type Scene,
	type SceneNode,
	emptyScene,
	starterTokens,
	uniqueName,
} from "./scene.ts";

/**
 * An alias rather than an interface: only aliases get an implicit index
 * signature, and stores that take `Record<string, unknown>` want one.
 */
export type Project = {
	id: string;
	name: string;
	scene: Scene;
	createdAt: number;
	updatedAt: number;
};

function newId(): string {
	// Available in browsers and Node >= 19.
	return globalThis.crypto?.randomUUID?.() ?? `p-${Date.now().toString(36)}`;
}

export interface CreateProjectOptions {
	name?: string;
	id?: string;
	now?: number;
	scene?: Scene;
}

export function createProject(options: CreateProjectOptions = {}): Project {
	const now = options.now ?? Date.now();
	return {
		id: options.id ?? newId(),
		name: options.name?.trim() || "Untitled",
		scene: options.scene ?? emptyScene(),
		createdAt: now,
		updatedAt: now,
	};
}

/** "Untitled", then "Untitled 2", "Untitled 3", … */
export function uniqueProjectName(
	existing: readonly Project[],
	base = "Untitled",
): string {
	return uniqueName(
		existing.map((p) => p.name),
		base,
	);
}

/** Most recently touched first — the order the overview lists them in. */
export function sortProjects(list: readonly Project[]): Project[] {
	return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findProject(
	list: readonly Project[],
	id: string | undefined,
): Project | undefined {
	if (!id) return undefined;
	return list.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ */
/* The localStorage format, kept only to read it one last time         */
/* ------------------------------------------------------------------ */

/** The version {@link parseLegacyProjects} accepts; nothing writes it now. */
export const LEGACY_PROJECTS_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fills in anything a stored scene is missing.
 *
 * Saved projects outlive the code that wrote them, so every field falls back
 * to a default rather than reaching the renderer as undefined. Documents from
 * before frames were nodes carry a global `artboard`; their contents are
 * wrapped in a frame of that size so nothing is orphaned on the canvas.
 */
export function normalizeScene(input: unknown): Scene {
	const base = emptyScene();
	if (!isRecord(input)) return base;

	return {
		tokens:
			Array.isArray(input.tokens) && input.tokens.every(isToken)
				? (input.tokens as Scene["tokens"])
				: starterTokens(),
		// Nodes from a document written before absolute geometry existed have
		// no frame, and would render at 0x0. Dropping them is better than
		// showing an invisible layer list.
		nodes: migrateNodes(input),
		// Documents written before constraints existed simply have none.
		constraints: Array.isArray(input.constraints)
			? input.constraints.filter(isConstraint)
			: [],
		rules: typeof input.rules === "string" ? input.rules : RULES_HEADER,
	};
}

function isConstraint(value: unknown): value is Constraint {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || !value.id) return false;
	if (typeof value.kind !== "string" || !(value.kind in CONSTRAINT_KINDS)) {
		return false;
	}
	if (typeof value.prop !== "string" || !(value.prop in PROPS)) return false;
	if (!Array.isArray(value.nodes)) return false;
	return value.nodes.every((n) => typeof n === "string");
}

/** Reads nodes, wrapping a legacy artboard's contents in a real frame. */
function migrateNodes(input: Record<string, unknown>): SceneNode[] {
	const nodes = Array.isArray(input.nodes) ? pruneNodes(input.nodes) : [];
	const legacy = isRecord(input.artboard) ? input.artboard : null;
	if (!legacy) return nodes.length > 0 ? nodes : emptyScene().nodes;

	const size = (value: unknown, fallback: number) => {
		const n = Number(value);
		return Number.isFinite(n) && n > 0 ? n : fallback;
	};
	return [
		{
			id: "frame1",
			kind: "frame",
			name: "Frame 1",
			frame: {
				x: 0,
				y: 0,
				width: size(legacy.width, DEFAULT_FRAME.width),
				height: size(legacy.height, DEFAULT_FRAME.height),
			},
			props: {},
			children: nodes,
		},
	];
}

/**
 * A token needs a name, a type and at least one alternative. The value model
 * changed shape, so a document written against the old one is rejected here
 * and replaced with the starter set rather than half-loaded.
 */
function isToken(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || typeof value.name !== "string") return false;
	if (!Array.isArray(value.value) || value.value.length === 0) return false;
	return value.value.every(
		(term) =>
			isRecord(term) &&
			((term.kind === "literal" && typeof term.value === "string") ||
				(term.kind === "token" && typeof term.token === "string")),
	);
}

/** A node is usable only if it carries a numeric frame. Recurses into groups. */
function isPlacedNode(value: unknown): value is SceneNode {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || !value.id) return false;
	if (typeof value.kind !== "string" || !(value.kind in KINDS)) return false;
	const frame = value.frame;
	if (!isRecord(frame)) return false;
	if (
		!(["x", "y", "width", "height"] as const).every((k) =>
			Number.isFinite(Number(frame[k])),
		)
	) {
		return false;
	}
	if (value.children !== undefined && !Array.isArray(value.children)) return false;
	if (value.layout !== undefined && !isLayout(value.layout)) return false;
	// A path whose vertices did not survive would render as nothing at all, so
	// it is dropped rather than left as an invisible layer.
	if (value.points !== undefined && !isPoints(value.points)) return false;
	return true;
}

function isPoints(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every(
			(p) =>
				isRecord(p) &&
				Number.isFinite(Number(p.x)) &&
				Number.isFinite(Number(p.y)),
		)
	);
}

function isLayout(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (value.direction !== "row" && value.direction !== "column") return false;
	if (!ALIGNMENTS.has(String(value.align))) return false;
	return Number.isFinite(Number(value.gap)) && Number.isFinite(Number(value.padding));
}

/**
 * A layout stored before a field existed takes the default for it — hugging,
 * and slack at the end — so an older document reads back looking the same.
 */
function normalizeLayout(value: unknown): AutoLayout {
	const raw = value as AutoLayout;
	return {
		...raw,
		sizing: raw.sizing === "fixed" ? "fixed" : "hug",
		justify: raw.justify in JUSTIFICATIONS ? raw.justify : "start",
	};
}

/** Keeps only placeable nodes, at every depth. */
function pruneNodes(list: readonly unknown[]): SceneNode[] {
	const out: SceneNode[] = [];
	for (const raw of list) {
		if (!isPlacedNode(raw)) continue;
		const node = raw as SceneNode;
		const fixed = node.layout
			? { ...node, layout: normalizeLayout(node.layout) }
			: node;
		out.push(
			fixed.children ? { ...fixed, children: pruneNodes(fixed.children) } : fixed,
		);
	}
	return out;
}

function normalizeProject(input: unknown, index: number): Project | null {
	if (!isRecord(input)) return null;
	const id = typeof input.id === "string" && input.id ? input.id : null;
	if (!id) return null;

	const created = Number(input.createdAt);
	const updated = Number(input.updatedAt);
	return {
		id,
		name:
			typeof input.name === "string" && input.name.trim()
				? input.name.trim()
				: `Untitled ${index + 1}`,
		scene: normalizeScene(input.scene),
		createdAt: Number.isFinite(created) ? created : 0,
		updatedAt: Number.isFinite(updated) ? updated : 0,
	};
}

/**
 * Reads the single JSON blob the studio used to keep every project in, so it
 * can be imported once and never read again. Corrupt or foreign data yields
 * an empty list rather than throwing — losing the list is bad, but a studio
 * that will not load at all is worse.
 */
export function parseLegacyProjects(text: string | null | undefined): Project[] {
	if (!text) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return [];
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.projects)) return [];
	if (Number(parsed.version) !== LEGACY_PROJECTS_VERSION) return [];

	const out: Project[] = [];
	parsed.projects.forEach((raw, i) => {
		const project = normalizeProject(raw, i);
		if (project) out.push(project);
	});
	// Duplicate ids would make routing ambiguous.
	const seen = new Set<string>();
	return out.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}
