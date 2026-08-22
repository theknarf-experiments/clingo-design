/**
 * Document edits.
 *
 * Every operation is a pure `Scene -> Scene` function, so the editor's
 * behaviour is testable without a DOM and undo is just a stack of previous
 * documents.
 *
 * Frames are relative to their parent, so an operation on a node needs to say
 * nothing about its descendants: they come along on their own.
 */
import { type Frame, normaliseFrame } from "./geometry.ts";
import {
	KINDS,
	type NodeKind,
	type PropName,
	type Scene,
	type SceneNode,
	uniqueName,
	wrapsChildren,
} from "./scene.ts";
import {
	FALLBACK,
	type Token,
	type Value,
	type ValueType,
	lit,
	propVar,
	resolveValue,
	tokenVar,
	wouldCycle,
} from "./values.ts";
import {
	findInTree,
	flatten,
	groupFrame,
	locate,
	mapTree,
	refreshGroups,
	worldOrigin,
} from "./tree.ts";

let counter = 0;

/** Ids only need to be unique within a document. */
export function newNodeId(): string {
	counter += 1;
	const random = globalThis.crypto?.randomUUID?.().slice(0, 8);
	return random ? `n_${random}` : `n_${counter}`;
}

/** A fresh node of `kind` occupying `frame`. */
export function makeNode(
	kind: NodeKind,
	frame: Frame,
	options: { id?: string; name?: string; text?: string } = {},
): SceneNode {
	const spec = KINDS[kind];
	return {
		id: options.id ?? newNodeId(),
		kind,
		name: options.name ?? spec.label,
		frame: normaliseFrame(frame),
		...(kind === "text" ? { text: options.text ?? "Text" } : {}),
		props: { ...spec.defaults },
		...(spec.container ? { children: [] } : {}),
	};
}

/**
 * Adds a node inside `parentId`, or at the top level when it is null.
 *
 * `frame` arrives in canvas coordinates — that is what the pointer produces —
 * and is rebased into the parent's space here, so callers never have to think
 * about the conversion.
 */
export function addNodeTo(
	scene: Scene,
	parentId: string | null,
	node: SceneNode,
): Scene {
	if (!parentId) return addNode(scene, node);
	const origin = worldOrigin(scene.nodes, parentId);
	const parent = findInTree(scene.nodes, parentId);
	if (!parent) return addNode(scene, node);

	const local: SceneNode = {
		...node,
		frame: {
			...node.frame,
			x: node.frame.x - (origin.x + parent.frame.x),
			y: node.frame.y - (origin.y + parent.frame.y),
		},
	};
	return {
		...scene,
		nodes: mapTree(scene.nodes, (n) =>
			n.id === parentId ? { ...n, children: [...(n.children ?? []), local] } : n,
		),
	};
}

export function addNode(scene: Scene, node: SceneNode): Scene {
	return { ...scene, nodes: [...scene.nodes, node] };
}

/** Removes the named nodes and everything beneath them. */
export function deleteNodes(scene: Scene, ids: readonly string[]): Scene {
	const drop = new Set(ids);
	return {
		...scene,
		nodes: refreshGroups(
			mapTree(scene.nodes, (node) => (drop.has(node.id) ? null : node)),
		),
	};
}

/**
 * Translates the named nodes.
 *
 * Children are relative to their parent, so they come along without being
 * touched — moving a frame moves everything in it for free.
 */
export function moveNodes(
	scene: Scene,
	ids: readonly string[],
	dx: number,
	dy: number,
): Scene {
	const touch = new Set(ids);
	return {
		...scene,
		nodes: refreshGroups(
			mapTree(scene.nodes, (node) =>
				touch.has(node.id)
					? {
							...node,
							frame: normaliseFrame({
								...node.frame,
								x: node.frame.x + dx,
								y: node.frame.y + dy,
							}),
						}
					: node,
			),
		),
	};
}

/** Replaces frames wholesale — what a drag or resize commits. */
export function setFrames(
	scene: Scene,
	frames: ReadonlyMap<string, Frame>,
): Scene {
	return {
		...scene,
		nodes: refreshGroups(
			mapTree(scene.nodes, (node) => {
				const next = frames.get(node.id);
				return next ? { ...node, frame: normaliseFrame(next) } : node;
			}),
		),
	};
}

export function setFrame(scene: Scene, id: string, frame: Frame): Scene {
	return setFrames(scene, new Map([[id, frame]]));
}

/**
 * Resizing a node scales what is inside it, so the contents keep their
 * relative layout instead of drifting out of the frame.
 */
export function resizeSubtree(
	scene: Scene,
	id: string,
	next: Frame,
): Scene {
	const node = findInTree(scene.nodes, id);
	if (!node) return scene;
	if (!node.children || node.children.length === 0) {
		return setFrame(scene, id, next);
	}

	const from = node.frame;
	const target = normaliseFrame(next);
	const sx = from.width === 0 ? 1 : target.width / from.width;
	const sy = from.height === 0 ? 1 : target.height / from.height;

	// Children are already relative to this node, so scaling is a plain
	// multiply — no origin to subtract.
	const frames = new Map<string, Frame>([[id, target]]);
	for (const child of flatten(node.children ?? [])) {
		frames.set(child.id, {
			x: child.frame.x * sx,
			y: child.frame.y * sy,
			width: child.frame.width * sx,
			height: child.frame.height * sy,
		});
	}
	return setFrames(scene, frames);
}

function mapSelected(
	scene: Scene,
	ids: readonly string[],
	fn: (node: SceneNode) => SceneNode,
): Scene {
	const touch = new Set(ids);
	return {
		...scene,
		nodes: mapTree(scene.nodes, (node) => (touch.has(node.id) ? fn(node) : node)),
	};
}

export function setProp(
	scene: Scene,
	ids: readonly string[],
	prop: PropName,
	value: Value | undefined,
): Scene {
	return mapSelected(scene, ids, (node) => {
		const props = { ...node.props };
		if (value === undefined) delete props[prop];
		else props[prop] = value;
		return { ...node, props };
	});
}

export function setText(scene: Scene, id: string, text: string): Scene {
	return mapSelected(scene, [id], (node) => ({ ...node, text }));
}

export function renameNode(scene: Scene, id: string, name: string): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return mapSelected(scene, [id], (node) => ({ ...node, name: trimmed }));
}

export type ReorderTo = "front" | "back" | "forward" | "backward";

/** Reorders within the node's own sibling list; z-order is scoped to a parent. */
export function reorderNodes(
	scene: Scene,
	ids: readonly string[],
	to: ReorderTo,
): Scene {
	const move = new Set(ids);

	const reorder = (list: readonly SceneNode[]): SceneNode[] => {
		const nodes = list.map((n) =>
			n.children ? { ...n, children: reorder(n.children) } : n,
		);
		if (!nodes.some((n) => move.has(n.id))) return nodes;

		const moving = nodes.filter((n) => move.has(n.id));
		const rest = nodes.filter((n) => !move.has(n.id));
		if (to === "front") return [...rest, ...moving];
		if (to === "back") return [...moving, ...rest];

		const indices = nodes
			.map((n, i) => (move.has(n.id) ? i : -1))
			.filter((i) => i >= 0);
		const order = to === "forward" ? [...indices].reverse() : indices;
		for (const index of order) {
			const swap = to === "forward" ? index + 1 : index - 1;
			if (swap < 0 || swap >= nodes.length) continue;
			if (move.has(nodes[swap].id)) continue;
			[nodes[index], nodes[swap]] = [nodes[swap], nodes[index]];
		}
		return nodes;
	};

	return { ...scene, nodes: reorder(scene.nodes) };
}

function deepCopy(node: SceneNode, offset: number): SceneNode {
	return {
		...node,
		id: newNodeId(),
		props: { ...node.props },
		frame: {
			...node.frame,
			x: node.frame.x + offset,
			y: node.frame.y + offset,
		},
		...(node.children
			? { children: node.children.map((c) => deepCopy(c, offset)) }
			: {}),
	};
}

/** Copies subtrees, offset so the copies are visible, and reports their ids. */
export function duplicateNodes(
	scene: Scene,
	ids: readonly string[],
	offset = 16,
): { scene: Scene; ids: string[] } {
	const copy = new Set(ids);
	const created: string[] = [];

	const walk = (list: readonly SceneNode[]): SceneNode[] => {
		const out: SceneNode[] = [];
		for (const node of list) {
			out.push(node.children ? { ...node, children: walk(node.children) } : node);
			if (copy.has(node.id)) {
				const clone = deepCopy(node, offset);
				created.push(clone.id);
				out.push(clone);
			}
		}
		return out;
	};

	return { scene: { ...scene, nodes: walk(scene.nodes) }, ids: created };
}

/* ------------------------------------------------------------------ */
/* Grouping                                                            */
/* ------------------------------------------------------------------ */

/**
 * Wraps the selection in a new group.
 *
 * Only siblings can be grouped — a selection spanning different parents has no
 * single place to put the result — so the nodes sharing the frontmost node's
 * parent are taken and the rest are left alone. The group lands at the
 * frontmost member's position so grouping does not change what is on top.
 */
export function groupNodes(
	scene: Scene,
	ids: readonly string[],
	name = "Group",
): { scene: Scene; id: string | null } {
	const wanted = new Set(ids);
	if (wanted.size < 1) return { scene, id: null };

	// Pick the sibling list containing the frontmost selected node.
	let host: readonly SceneNode[] | null = null;
	let hostIndex = -1;
	for (const id of wanted) {
		const found = locate(scene.nodes, id);
		if (!found) continue;
		if (!host || found.index > hostIndex) {
			host = found.siblings;
			hostIndex = found.index;
		}
	}
	if (!host) return { scene, id: null };

	const members = host.filter((n) => wanted.has(n.id));
	if (members.length === 0) return { scene, id: null };

	const bounds = groupFrame(members);
	const group: SceneNode = {
		id: newNodeId(),
		kind: "group",
		name,
		frame: bounds,
		props: {},
		// Members become relative to the group's origin.
		children: members.map((m) => ({
			...m,
			frame: { ...m.frame, x: m.frame.x - bounds.x, y: m.frame.y - bounds.y },
		})),
	};

	const rebuild = (list: readonly SceneNode[]): SceneNode[] => {
		if (list === host) {
			const out: SceneNode[] = [];
			for (const node of list) {
				if (wanted.has(node.id)) continue;
				out.push(node.children ? { ...node, children: rebuild(node.children) } : node);
			}
			// Insert where the frontmost member was, counting only survivors.
			const before = list
				.slice(0, hostIndex)
				.filter((n) => !wanted.has(n.id)).length;
			out.splice(before, 0, group);
			return out;
		}
		return list.map((n) =>
			n.children ? { ...n, children: rebuild(n.children) } : n,
		);
	};

	return { scene: { ...scene, nodes: rebuild(scene.nodes) }, id: group.id };
}

/** Dissolves wrappers, splicing their children into the wrapper's place. */
export function ungroupNodes(
	scene: Scene,
	ids: readonly string[],
): { scene: Scene; ids: string[] } {
	const wanted = new Set(ids);
	const freed: string[] = [];

	const walk = (list: readonly SceneNode[]): SceneNode[] => {
		const out: SceneNode[] = [];
		for (const node of list) {
			const children = node.children ? walk(node.children) : undefined;
			if (wrapsChildren(node) && wanted.has(node.id) && children) {
				// Lift the children back into the wrapper's own coordinate space.
				for (const child of children) {
					out.push({
						...child,
						frame: {
							...child.frame,
							x: child.frame.x + node.frame.x,
							y: child.frame.y + node.frame.y,
						},
					});
					freed.push(child.id);
				}
				continue;
			}
			out.push(children ? { ...node, children } : node);
		}
		return out;
	};

	const nodes = refreshGroups(walk(scene.nodes));
	return { scene: { ...scene, nodes }, ids: freed };
}

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

export function addToken(scene: Scene, type: ValueType, value?: Value): {
	scene: Scene;
	id: string;
} {
	const token: Token = {
		id: newNodeId().replace("n_", "t_"),
		// Names must be unique within the document, so references stay readable.
		name: uniqueName(scene.tokens.map((t) => t.name), type, "-"),
		type,
		value: value ?? [lit(FALLBACK[type])],
	};
	return { scene: { ...scene, tokens: [...scene.tokens, token] }, id: token.id };
}

export function renameToken(scene: Scene, id: string, name: string): Scene {
	const trimmed = name.trim();
	if (!trimmed) return scene;
	return {
		...scene,
		tokens: scene.tokens.map((t) => (t.id === id ? { ...t, name: trimmed } : t)),
	};
}

/**
 * Replaces a token's value.
 *
 * A value that would make the token reference itself is rejected, so a cycle
 * can never be stored — resolution would silently yield nothing.
 */
export function setTokenValue(scene: Scene, id: string, value: Value): Scene {
	if (value.length === 0) return scene;
	if (wouldCycle(scene.tokens, id, value)) return scene;
	return {
		...scene,
		tokens: scene.tokens.map((t) => (t.id === id ? { ...t, value } : t)),
	};
}

/**
 * Deletes a token and repairs anything that referenced it, substituting the
 * literal it currently resolves to so the design does not visibly change.
 */
export function deleteToken(scene: Scene, id: string): Scene {
	const token = scene.tokens.find((t) => t.id === id);
	if (!token) return scene;
	const frozen = resolveValue({ tokens: scene.tokens, picks: {} }, token.value, tokenVar(id));

	const repair = (value: Value): Value =>
		value.map((term) =>
			term.kind === "token" && term.token === id
				? lit(frozen ?? FALLBACK[token.type])
				: term,
		);

	return {
		...scene,
		tokens: scene.tokens
			.filter((t) => t.id !== id)
			.map((t) => ({ ...t, value: repair(t.value) })),
		nodes: mapTree(scene.nodes, (node) => {
			const props: SceneNode["props"] = {};
			for (const [prop, value] of Object.entries(node.props)) {
				if (value) props[prop as PropName] = repair(value);
			}
			return { ...node, props };
		}),
	};
}

/** Reduces every varying assignment to the alternative this universe chose. */
export function collapseToPicks(
	scene: Scene,
	picks: Readonly<Record<string, number>>,
): Scene {
	// Deliberately *not* `activeTerm`: that falls back to the first alternative
	// when there is no pick, which is right for rendering but would silently
	// rewrite the document here. A missing pick leaves the assignment alone.
	const pickOne = (value: Value, variable: string): Value => {
		if (value.length <= 1) return value;
		const index = picks[variable];
		return index !== undefined && index < value.length ? [value[index]] : value;
	};

	return {
		...scene,
		tokens: scene.tokens.map((t) => ({
			...t,
			value: pickOne(t.value, tokenVar(t.id)),
		})),
		nodes: mapTree(scene.nodes, (node) => {
			const props: SceneNode["props"] = {};
			for (const [prop, value] of Object.entries(node.props)) {
				if (value) props[prop as PropName] = pickOne(value, propVar(node.id, prop));
			}
			return { ...node, props };
		}),
	};
}
