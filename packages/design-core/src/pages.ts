/**
 * Pages, the links between them, and how a tree path becomes a legal ASP
 * constant.
 *
 * A project is a tree of documents and a page is one of them, so "which pages
 * are there" has always been `pathsOfType(SCENE_TYPE)` and never an index. What
 * is new here is that a *link* names a page, which makes a page something the
 * compiler has to be able to say — and a tree path is not a thing a grounder
 * will take. Hence {@link pageIdOf}, and hence this module existing at all:
 * `pagePath` and `pageName` used to live in the app's store, and `design-core`
 * may not import from the app.
 *
 * Nothing in here does I/O and nothing in here knows what a project is. It is
 * string arithmetic over paths, one pure walk over a document, and one
 * hit-test over an answer set.
 */
import { type Frame, type Point, frameContains } from "./geometry.ts";
import type { ModelNode, ModelScene } from "./model.ts";
import { DEFAULT_LINK_TRIGGER, type Scene, type SceneNode, type Trigger } from "./scene.ts";
import { mapTree } from "./tree.ts";

/** Where pages live in a project's tree. */
export const PAGE_DIR = "/pages/";

/**
 * A page's name is its filename, and its path is where it lives.
 *
 * Two functions rather than one field, because the tree is the list. There is no
 * page index anywhere and there deliberately is not: `pathsOfType` already
 * answers "which pages are there", so an index would be a second answer that
 * could disagree with the documents — and the failure mode of a stale index is a
 * page that exists and cannot be reached.
 *
 * The name is what a person types and reads; the path is what the vfs keys on
 * and what a clone writes to disk. A page called "About us" is `/pages/About
 * us.scene`, spaces and all, because a filename is allowed them and inventing a
 * slug would mean the tree disagreeing with the tab.
 */
export const pagePath = (name: string): string => `${PAGE_DIR}${name}.scene`;

export const pageName = (path: string): string =>
	path.replace(/^\/pages\//, "").replace(/\.scene$/, "");

/**
 * A tree path, as a constant a program can hold.
 *
 * Lifted out of `componentIdOf` unchanged rather than written a second time, and
 * the arithmetic is byte-for-byte what that function already did — it becomes a
 * one-line call and its output does not move. Two copies of a hash is the thing
 * this codebase rejects everywhere else: it is a second implementation that can
 * disagree with the first, and the disagreement here would be two documents
 * sharing an id, which is one document with the other's references silently
 * pointing at it.
 *
 * The two properties it has to have are the ones `componentIdOf` states. Legal,
 * because it reaches the program as `page(<id>)` and `link(N,<id>)`. Injective,
 * because sanitising is not — `my page` and `my-page` flatten alike — and two
 * pages under one id would be one page.
 *
 * The prefix is what keeps the families apart structurally rather than by hoping
 * the hashes miss: `cmp_` and `pg_` cannot collide however the stems land. And
 * it is what makes a leading digit structurally impossible, which is the other
 * half of "legal": `/pages/2024.scene` becomes `pg_2024_…`, and a stem that
 * sanitises to nothing becomes `c`.
 *
 * `stem` and `from` are two parameters rather than one because they answer two
 * questions. The stem is for a person reading a generated program or an unsat
 * core — `pg_about_us_1k3z9` says which page far better than a bare hash — and
 * the hash is over the *whole path*, which is what makes it injective.
 */
export function aspConstant(prefix: string, stem: string, from: string): string {
	const cleaned = stem
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	// djb2, which is small, deterministic and has no dependency. A collision here
	// would need two paths agreeing in 32 bits *and* sanitising alike.
	let hash = 5381;
	for (let i = 0; i < from.length; i++) hash = ((hash << 5) + hash + from.charCodeAt(i)) >>> 0;
	return `${prefix}_${cleaned || "c"}_${hash.toString(36)}`;
}

/** The constant a page's path takes in a program: `pg_about_us_1k3z9`. */
export const pageIdOf = (path: string): string =>
	aspConstant("pg", pageName(path), path);

/**
 * The inverse, over a project's page list — the answer set cannot carry it.
 *
 * `pageIdOf` is a hash and hashes do not run backwards, so the only way from
 * `goes(pg_about_us_1k3z9)` back to a document is to compute the ids of the
 * pages you have and look the answer up. That is cheap — a project has a handful
 * of pages — and it is why the program states no `pagename/2`: the app supplied
 * the list, so asking the program to hand the names back would be paying bytes
 * on every solve for something the caller already holds.
 */
export const pageIndexOf = (
	paths: readonly string[],
): Record<string, string> =>
	Object.fromEntries(paths.map((p) => [pageIdOf(p), p]));

/**
 * Every link in a scene repointed from one page path to another, in place.
 *
 * Written for an Automerge draft and therefore mutating, in `reconcile`'s style:
 * assign only where it differs, so a page holding no such link produces no
 * change at all, no `updatedAt` bump and no entry in anybody's undo history.
 * Returns whether anything moved — not to gate the write, which has already
 * happened inside the draft by the time there is an answer, but to gate what
 * follows one, which is the shape `reconcile` established and `saveScene` reads.
 *
 * **A rename repoints and a delete dangles**, and the difference is a fact about
 * the two verbs rather than a preference. A rename keeps the document — the vfs
 * re-keys the directory and leaves the scene alone — so a link to it is still a
 * link to it and only its address moved; doing nothing would break every link
 * into a page because somebody fixed a typo in its name. A deletion has no
 * document left to point at, so a link into it leads nowhere, and saying so is
 * the honest state. That is `deleteComponent`'s stance verbatim, and the
 * consequence is checkable rather than silent: `viol(dead_link) :- goes(P), not
 * page(P).` is a rule a designer can turn on.
 *
 * The alternative to writing other pages' documents here is a repair on read,
 * and a repair on read makes *looking* at a project an edit that syncs.
 */
export function repointLinks(
	scene: { nodes?: Array<{ link?: { to: string } }> } | undefined,
	from: string,
	to: string,
): boolean {
	let moved = false;
	const walk = (nodes: Array<{ link?: { to: string }; children?: unknown }>): void => {
		for (const node of nodes) {
			if (node.link !== undefined && node.link.to === from) {
				node.link.to = to;
				moved = true;
			}
			const children = node.children;
			if (Array.isArray(children)) {
				walk(children as Array<{ link?: { to: string }; children?: unknown }>);
			}
		}
	};
	if (Array.isArray(scene?.nodes)) walk(scene.nodes);
	return moved;
}

/**
 * The same rewrite over a plain `Scene`, returning the scene it was given where
 * nothing matched.
 *
 * The immutable twin of {@link repointLinks}, for callers that hold a document
 * rather than a draft — a test, and anything that wants to see the change before
 * committing it. Identity where nothing matched, so a caller can compare by
 * reference the way {@link composeLibrary} lets one.
 */
export function repointedLinks(scene: Scene, from: string, to: string): Scene {
	let moved = false;
	const nodes = mapTree(scene.nodes, (node) => {
		if (node.link?.to !== from) return node;
		moved = true;
		return { ...node, link: { ...node.link, to } };
	});
	return moved ? { ...scene, nodes } : scene;
}

/** Where a point landed, when it landed on something that leads somewhere. */
export interface LinkHit {
	/** The node the link is on — a document id, or an `inst(I,N)` part. */
	id: string;
	/** The page id it leads to. */
	to: string;
	on: Trigger;
	/**
	 * The absolute box of the node the link is on, in EMU.
	 *
	 * Handed back rather than looked up again, because the caller cannot: a
	 * `ModelNode.frame` is parent-relative and the walk that added the offsets up
	 * is right here. Both callers draw something over it — an outline in the
	 * studio, nothing at all in a presentation, which is why it is one field
	 * rather than a second function.
	 */
	world: Frame;
}

/** One model node with its absolute box, for the two walks below. */
interface PlacedModel {
	node: ModelNode;
	world: { x: number; y: number; width: number; height: number };
	/** Ancestors, outermost first — what {@link linkAt} climbs. */
	trail: ModelNode[];
}

/**
 * Every node of a model with its absolute frame, in paint order.
 *
 * A `ModelNode.frame` is parent-relative, exactly as a `SceneNode.frame` is and
 * for the same reason — nested absolutely-positioned boxes need no coordinate
 * maths to draw — so anything hit-testing has to add the offsets up. The twin of
 * `placedNodes`, one medium over.
 */
function placedModel(model: ModelScene): PlacedModel[] {
	const out: PlacedModel[] = [];
	const walk = (node: ModelNode, ox: number, oy: number, trail: ModelNode[]): void => {
		const world = {
			x: ox + node.frame.x,
			y: oy + node.frame.y,
			width: node.frame.width,
			height: node.frame.height,
		};
		out.push({ node, world, trail });
		for (const child of node.children) {
			walk(child, world.x, world.y, [...trail, node]);
		}
	};
	for (const root of model.roots) walk(root, 0, 0, []);
	return out;
}

/**
 * The link a point is inside, or nothing.
 *
 * Over a {@link ModelScene} and not over the document tree, and both halves of
 * that matter. The answer set is where a rule-asserted link exists at all, and
 * it is the only place `inst(I,N)` — a component's linked part — has a box: a
 * navigation bar placed as an instance has its link on a derived part, which
 * `scene.nodes` does not contain.
 *
 * **It walks outward, which is what makes it a link and not a hotspot.** The
 * innermost node containing the point is found first; if it has no link, its
 * ancestors are asked in order. That is exactly what a browser does with a
 * `<span>` inside an `<a>`, it is what a designer means by "the whole card is
 * clickable", and it is why a label lying across a linked frame does not put a
 * hole in it. Paint order settles two *linked* nodes that overlap, backwards,
 * which is the arbiter `hitTestTree` and {@link instanceAt} already use.
 */
export function linkAt(model: ModelScene, point: Point): LinkHit | undefined {
	const placed = placedModel(model);
	for (let i = placed.length - 1; i >= 0; i--) {
		const at = placed[i];
		if (!frameContains(at.world, point)) continue;
		// Innermost first, then outward: the node itself, then its ancestors from
		// the nearest one up.
		const chain = [at.node, ...[...at.trail].reverse()];
		for (const node of chain) {
			const link = node.link;
			if (link !== undefined) {
				// The box of the node the *link* is on, which for an inner node is an
				// ancestor's — an outline on the label rather than on the card would
				// be an outline around the wrong thing.
				const box = node === at.node
					? at.world
					: (placed.find((p) => p.node === node)?.world ?? at.world);
				return {
					id: node.id,
					to: link.to,
					on: link.on ?? DEFAULT_LINK_TRIGGER,
					world: box,
				};
			}
		}
	}
	return undefined;
}

/**
 * Every node of a document that leads somewhere, by id.
 *
 * Read from the **document** and never from an answer set, and the split is
 * deliberate: the layer list and the Inspector are views of what you *wrote*,
 * and a rule-asserted link is not something you can select or repoint. The other
 * question — where does this *design* lead — is `goes/1`, per universe, and is
 * asked of the model.
 */
export function documentLinks(scene: Scene): Map<string, string> {
	const out = new Map<string, string>();
	const walk = (nodes: readonly SceneNode[]): void => {
		for (const node of nodes) {
			if (node.link !== undefined) out.set(node.id, node.link.to);
			if (node.children) walk(node.children);
		}
	};
	walk(scene.nodes);
	return out;
}
