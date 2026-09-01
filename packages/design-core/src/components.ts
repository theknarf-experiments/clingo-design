/**
 * Components, as design spaces.
 *
 * A component in a conventional design tool is a stored copy: one master, N
 * clones, and a propagation mechanism to keep them in step. None of that is
 * needed here, and saying it that way would waste the one thing this document
 * model has that the others do not.
 *
 * **A component IS a design space. Its variants ARE universes. An instance is a
 * node whose picks are partly held.**
 *
 * Concretely:
 *
 *   - A *definition* is an ordinary subtree of the document with
 *     {@link SceneNode.component} set. Nothing about it is special to draw or
 *     to edit; it sits on the canvas and you change it the way you change
 *     anything. The variables it owns are the property variables of its
 *     subtree — see {@link componentVariables}.
 *   - An *instance* is a node of kind `instance` naming that root. Its contents
 *     are not copied into the document: the compiler's component rules *derive*
 *     them, so there is exactly one place the truth lives and nothing to
 *     propagate. Editing the definition changes every instance because the
 *     instances were never a copy of it in the first place.
 *   - The definition's variables are re-minted once per instance — the compiler
 *     does that generically, in ASP — so `prop(inst(i1,label),text)` is a
 *     variable of its own with the same alternatives. That is the whole of what
 *     makes two instances able to differ: each is its own point in the same
 *     space.
 *   - An *override* is a held pick: {@link SceneNode.holds} maps a
 *     definition-space variable to an alternative index, and reaches the solver
 *     as an assumption, exactly like the pins a user sets while browsing. So an
 *     instance can only differ where the definition wrote more than one
 *     alternative, and cannot differ at all where the definition wrote one.
 *     That is not a rule enforced anywhere: it is what the shape makes possible.
 *   - A *variant* is a point in the definition's own space — one alternative
 *     per open variable. Variants are **emergent**, not named: they are
 *     whatever combinations the definition admits. See {@link variantsOf} for
 *     why that is the honest choice here and not merely the cheap one.
 *
 * Everything in this file is a pure reading of the document. What the answer
 * set says about an instance is read the same way any derived node is read; see
 * `derived.ts`.
 */
import { parseAtom } from "./atoms.ts";
import {
	KINDS,
	PROPS,
	type PropName,
	type Scene,
	type SceneNode,
} from "./scene.ts";
import { findInTree, flatten, mapTree, nodeNames, propValues } from "./tree.ts";
import {
	type Picks,
	type ResolveContext,
	type Value,
	propVar,
	resolveValue,
	single,
	termLabel,
} from "./values.ts";

/** True when this subtree is a component definition. */
export const isDefinition = (node: SceneNode): boolean =>
	node.component === true;

/** True when this node is a use of a definition. */
export const isInstance = (node: SceneNode): boolean =>
	node.kind === "instance";

/**
 * How an instance's copy of a definition node is named in the answer set.
 *
 * `inst(i1,label)` — a term, not a string, so it parses back out with
 * {@link parseAtom} like every other derived node id and so the same id can
 * never collide with a document one.
 */
export const instancePart = (instanceId: string, nodeId: string): string =>
	`inst(${instanceId},${nodeId})`;

/** The inverse of {@link instancePart}, for anything showing one to a human. */
export function parseInstancePart(
	id: string,
): { instance: string; node: string } | null {
	const atom = parseAtom(id);
	if (!atom || atom.name !== "inst" || atom.args.length !== 2) return null;
	return { instance: atom.args[0], node: atom.args[1] };
}

/**
 * The same variable, as the instance's own.
 *
 * Definition-space `prop(label,text)` becomes `prop(inst(i1,label),text)`,
 * which is the key the compiler mints and the key `pick/2` carries. Anything
 * that is not a property variable of a definition part is returned unchanged,
 * because nothing else is re-minted — see {@link componentVariables}.
 */
export const instanceVariable = (
	instanceId: string,
	nodeId: string,
	prop: string,
): string => propVar(instancePart(instanceId, nodeId), prop);

/** A definition, with everything read off it that anyone asks for. */
export interface ComponentDef {
	/** The subtree's root, which is also the definition's id. */
	root: SceneNode;
	/** What it is called: the root's layer name. */
	name: string;
	/** The root and every node beneath it, in document order. */
	parts: SceneNode[];
}

/** Every component definition in the document, in document order. */
export function componentDefs(scene: Scene): ComponentDef[] {
	return flatten(scene.nodes)
		.filter(isDefinition)
		.map((root) => ({ root, name: root.name, parts: flatten([root]) }));
}

/** The definition with this root id, if the document holds one. */
export function componentDef(
	scene: Scene,
	rootId: string | undefined,
): ComponentDef | undefined {
	if (rootId === undefined) return undefined;
	return componentDefs(scene).find((d) => d.root.id === rootId);
}

/** The definition an instance node uses, if it still exists. */
export const definitionOf = (
	scene: Scene,
	instance: SceneNode,
): ComponentDef | undefined => componentDef(scene, instance.instanceOf);

/** Every instance node in the document, in document order. */
export function instanceNodes(scene: Scene): SceneNode[] {
	return flatten(scene.nodes).filter(isInstance);
}

/**
 * One variable a component owns.
 *
 * Property variables and nothing else. A definition's *geometry* and its
 * layout settings are the shape of the component rather than a choice an
 * instance gets to make differently — two instances of a button are the same
 * button, placed twice — so those stay the definition's, shared by every
 * instance. Appearance and content are what an instance varies, and those are
 * exactly the properties.
 */
export interface ComponentVar {
	/** The key in the *definition's* space: `prop(label,text)`. */
	variable: string;
	/** The definition part it belongs to. */
	node: SceneNode;
	prop: PropName;
	/** What the definition wrote there. */
	value: Value;
	/** True when it holds more than one alternative, so an instance may choose. */
	open: boolean;
}

/**
 * Every variable the definition owns, roots first.
 *
 * Includes the settled ones: a panel that wants to say "this row is the
 * definition's decision, not yours" needs to know they exist. Callers after
 * the choices filter on {@link ComponentVar.open}.
 */
export function componentVariables(def: ComponentDef): ComponentVar[] {
	const out: ComponentVar[] = [];
	for (const node of def.parts) {
		for (const prop of KINDS[node.kind].props) {
			const value = node.props[prop];
			if (!value || value.length === 0) continue;
			out.push({
				variable: propVar(node.id, prop),
				node,
				prop,
				value,
				open: value.length > 1,
			});
		}
	}
	return out;
}

/** Just the ones an instance may decide for itself. */
export const openVariables = (def: ComponentDef): ComponentVar[] =>
	componentVariables(def).filter((v) => v.open);

/**
 * A point in the definition's own space: one alternative per open variable.
 *
 * This is what a "variant" is here, and it is worth being explicit that the
 * alternative was considered and rejected. A conventional tool has the designer
 * *declare* a variant property — `type = primary | secondary` — and then attach
 * property values to each of its values. That is a second, parallel way to say
 * "either of these", on top of the one this document model already has, and it
 * would need its own storage, its own editor and its own compilation.
 *
 * Emergent variants need none of that, and the labels come out readable for
 * free: a button whose fill is `[accent, muted]` has variants literally called
 * "accent" and "muted", because the alternatives a designer writes in this
 * model are already the design vocabulary. Where a name really is wanted, it is
 * the token's name — which is an edit to one place rather than to a variant
 * table.
 *
 * Deduplicated by what the variants *render*, for the same reason the program
 * projects on `rendered/3`: two spellings of one colour are one design.
 */
export interface Variant {
	/** Definition-space variable -> alternative index. */
	picks: Record<string, number>;
	/** What distinguishes it, from the alternatives' own labels. */
	label: string;
}

/** More variants than this and a strip of them stops being readable. */
const VARIANT_LIMIT = 16;

export function variantsOf(
	scene: Scene,
	def: ComponentDef,
	limit = VARIANT_LIMIT,
): { variants: Variant[]; truncated: boolean } {
	const open = openVariables(def);
	if (open.length === 0) return { variants: [], truncated: false };

	const names = nodeNames(scene.nodes);
	const props = propValues(scene.nodes);
	const seen = new Set<string>();
	const variants: Variant[] = [];
	let truncated = false;

	// The cross product, depth-first so the first open variable varies slowest
	// and the strip reads in a stable order.
	const walk = (at: number, picks: Record<string, number>): void => {
		if (variants.length >= limit) {
			truncated = true;
			return;
		}
		if (at === open.length) {
			const context: ResolveContext = { tokens: scene.tokens, picks, props };
			// What this combination actually draws. Two combinations that render
			// alike are one variant, exactly as they would be one universe.
			//
			// Joined on NUL because a resolved literal may hold anything a designer
			// can type, commas included, and two lists must not key alike by
			// accident. Written as the escape rather than as the byte itself: a raw
			// NUL makes grep treat the whole file as binary and report *no matches*
			// rather than skipping it loudly, which hid this file from every search
			// run across the source.
			const key = componentVariables(def)
				.map((v) => resolveValue(context, v.value, v.variable) ?? "")
				.join("\u0000");
			if (seen.has(key)) return;
			seen.add(key);
			variants.push({
				picks: { ...picks },
				label: open
					.map((v) => termLabel(scene.tokens, v.value[picks[v.variable]], names))
					.join(" · "),
			});
			return;
		}
		const v = open[at];
		for (let i = 0; i < v.value.length; i++) {
			walk(at + 1, { ...picks, [v.variable]: i });
		}
	};
	walk(0, {});
	return { variants, truncated };
}

/**
 * The variant an instance is showing, as a position in {@link variantsOf}'s
 * list, or -1.
 *
 * Read out of the universe on screen rather than out of the document: an
 * instance that holds nothing is still showing *something*, and which something
 * is the solver's answer.
 */
export function shownVariant(
	variants: readonly Variant[],
	def: ComponentDef,
	instanceId: string,
	picks: Picks,
): number {
	const open = openVariables(def);
	if (open.length === 0) return -1;
	const at = new Map<string, number>();
	for (const v of open) {
		const index = picks[instanceVariable(instanceId, v.node.id, v.prop)];
		if (index === undefined) return -1;
		at.set(v.variable, index);
	}
	return variants.findIndex((variant) =>
		open.every((v) => variant.picks[v.variable] === at.get(v.variable)),
	);
}

/**
 * Whether an instance holds every open variable, so the definition has nothing
 * left to decide about it.
 */
export function isFullyHeld(def: ComponentDef, instance: SceneNode): boolean {
	const open = openVariables(def);
	return open.length > 0 && open.every((v) => instance.holds?.[v.variable] !== undefined);
}

/**
 * Every instance's held picks, as the assumptions a solve makes.
 *
 * This is the whole implementation of an override: a pin the document
 * remembers. The pins a user sets while browsing already reach the solver this
 * way, so an override inherits the reachability greying, the unsat cores and
 * the cost model — one solve rather than a re-grounding — without any of it
 * being written twice.
 *
 * A hold naming a variable the definition no longer has, or an alternative it
 * no longer offers, is dropped rather than assumed: a definition edited down to
 * one fill should leave its instances legal, not unsatisfiable.
 *
 * A *definition* may hold its own variables too, and for the same reason an
 * instance may hold its copies of them: the subtree is a design as well as a
 * space, it sits on the canvas being one of its variants, and which one is a
 * decision the document can remember. That is what lets `collapseToPicks` write
 * down a whole universe without shortening the very lists its instances index
 * into — see the note there. The keys are the definition's own, because for a
 * definition part definition space *is* document space.
 */
export function heldPicks(scene: Scene): Record<string, number> {
	const out: Record<string, number> = {};
	// One pass for the definitions rather than a tree walk per instance: a page
	// of a hundred instances is an ordinary document, and this runs on every
	// solve.
	const defs = new Map(componentDefs(scene).map((d) => [d.root.id, d] as const));
	for (const def of defs.values()) {
		if (!def.root.holds) continue;
		for (const v of openVariables(def)) {
			const index = def.root.holds[v.variable];
			if (index === undefined || index < 0 || index >= v.value.length) continue;
			out[v.variable] = index;
		}
	}
	for (const instance of instanceNodes(scene)) {
		const def = defs.get(instance.instanceOf ?? "");
		if (!def || !instance.holds) continue;
		for (const v of openVariables(def)) {
			const index = instance.holds[v.variable];
			if (index === undefined || index < 0 || index >= v.value.length) continue;
			out[instanceVariable(instance.id, v.node.id, v.prop)] = index;
		}
	}
	return out;
}

/**
 * True when a derived node is one of `instanceId`'s parts.
 *
 * What the canvas needs to know to stop a click landing inside a component. An
 * instance's copy is painted over the instance itself, so paint order — the
 * arbiter everywhere else — would hand every click to the read-only copy and
 * leave the one thing that *can* be dragged unselectable. The parts are still
 * reachable from the layer list, which is the right split: on the canvas an
 * instance is one object, and in the tree it is what it is made of.
 */
export const isPartOf = (derivedId: string, instanceId: string): boolean =>
	parseInstancePart(derivedId)?.instance === instanceId;

/**
 * A short, human name for one of an instance's derived parts.
 *
 * `inst(i1,label)` is honest and unreadable. The layers panel and the inspector
 * both want "Label — in Button", which needs the document that produced it.
 */
export function partLabel(scene: Scene, id: string): string | undefined {
	const parsed = parseInstancePart(id);
	if (!parsed) return undefined;
	const names = nodeNames(scene.nodes);
	const part = names[parsed.node] ?? parsed.node;
	const instance = names[parsed.instance] ?? parsed.instance;
	return `${part} — ${instance}`;
}

/**
 * True when the document still holds what an `inst(I,N)` term names — the
 * question `pruneConstraints` has to ask of a member that is an instance part.
 *
 * The third member of the family `holdsDatum` and `holdsStateCopy` are in, and
 * it was the first of the three to be needed and the last to be written. An
 * instance's copy of a definition part is not a document node — `alive` is built
 * from `flatten(scene.nodes)` and `inst(i1,label)` is nowhere in that tree — so
 * a rule naming one used to be stripped of that member, and then deleted for
 * falling below `minNodes`, the next time anybody deleted an unrelated
 * rectangle. It went unnoticed only because nothing offered such a member: the
 * canvas selects instances, not their parts.
 *
 * State machines are what made it reachable. `materializedParts` reduces
 * `inst(i1,label)` to a definition part on purpose — the three spellings of "hand
 * this part to simplex" are the part, the instance's copy and one state's copy —
 * so a rule that pins an instance part is now an ordinary thing to write beside
 * a cross-state rule, and one of them surviving a delete while the other did not
 * would be a difference with no explanation.
 *
 * Blunt in the same way its two siblings are: held when the instance exists and
 * its definition still has a part by that name, which is a question about the
 * *document* rather than about any answer set. Whether the instance currently
 * draws that part is the program's business and changes with a rule.
 */
export function holdsInstancePart(scene: Scene, term: string): boolean {
	const parsed = parseInstancePart(term);
	if (!parsed) return false;
	const instance = findInTree(scene.nodes, parsed.instance);
	if (!instance || !isInstance(instance)) return false;
	const def = definitionOf(scene, instance);
	return def !== undefined && def.parts.some((part) => part.id === parsed.node);
}

/** What a property row on a definition part is called, for the override list. */
export const varLabel = (v: ComponentVar): string =>
	`${v.node.name} · ${PROPS[v.prop].label}`;

/* ------------------------------------------------------------------ */
/* Definitions that live in their own documents                        */
/* ------------------------------------------------------------------ */

/**
 * A component whose definition is its own document in the project's tree.
 *
 * The reason is the one multi-page raised and could not answer: a definition
 * that is a subtree of a page can only be used on that page, because
 * `instanceOf` names a node and a node belongs to one scene. A definition in its
 * own document at `/components/button.component` is named by a **path**, the
 * same way an image and a mesh are, so any page can point at it — and there is
 * one of it, so editing it changes every use on every page, which is what a
 * component was always supposed to mean.
 *
 * ## The composition, and why the compiler knows nothing about any of this
 *
 * A path cannot be a node id: `node/1` takes a bare term and
 * `/components/button.component` is not one. And the whole machinery downstream
 * — `componentDefs`, the instance rules, the machines, the edits — is written
 * against definitions that are *nodes in the scene*.
 *
 * So the definitions are spliced in before anything sees them.
 * {@link composeLibrary} takes the documents a project holds and returns a scene
 * with each definition present as an ordinary `component: true` node under an
 * ASP-safe id, and every path-valued `instanceOf` rewritten to that id. Nothing
 * downstream changed, and nothing downstream can tell the difference — which is
 * the point, and is why this is a function at the edge rather than a concept
 * threaded through the compiler.
 *
 * The spliced roots are {@link SceneNode.hidden}, because a definition kept in
 * its own document is drawn on its own canvas and must not appear on every page
 * that uses it. Hidden is exactly right rather than a trick: the node is
 * entirely present — it has an id, a kind, parts, and a rule may name it — and
 * only the picture leaves it out.
 *
 * **In-scene definitions still work.** This is additive: a `component: true`
 * subtree drawn on a page is what three templates ship and what the feature was
 * built as, and it still resolves by node id exactly as before. A project can
 * hold both.
 */

/** The datatype a component document declares. */
export const COMPONENT_TYPE = "clingo-design:component";

/** Where components live in a project's tree. */
export const COMPONENT_DIR = "/components/";

/** A component document's path, from the name a person typed. */
export const componentPath = (name: string): string =>
	`${COMPONENT_DIR}${name}.component`;

/** And back, for a list somebody reads. */
export const componentName = (path: string): string =>
	path.slice(COMPONENT_DIR.length).replace(/\.component$/, "");

/** True where an `instanceOf` names a document rather than a node in this scene. */
export const isComponentPath = (ref: string): boolean => ref.startsWith("/");

/**
 * The node id a component document's definition takes once spliced.
 *
 * Derived from the path and never stored, so there is one source of truth for
 * which document a definition came from and it is the path. Two properties it
 * has to have: it must be a legal ASP constant, because it reaches the program
 * as `node(<id>)`; and it must be injective, because two definitions sharing an
 * id would be one definition and the instances of the second would silently
 * draw the first.
 *
 * The readable part is for a person reading a generated program or an unsat
 * core — `cmp_button_3f9a` says which component far better than a bare hash —
 * and the suffix is what makes it injective, because sanitising is not: `my
 * button` and `my-button` both flatten to `my_button`.
 */
export function componentIdOf(path: string): string {
	const stem = componentName(path)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	// djb2, which is small, deterministic and has no dependency. A collision here
	// would need two paths agreeing in 32 bits *and* sanitising alike, and the
	// consequence is caught by the uniqueness assertion in `composeLibrary`.
	let hash = 5381;
	for (let i = 0; i < path.length; i++) hash = ((hash << 5) + hash + path.charCodeAt(i)) >>> 0;
	return `cmp_${stem || "c"}_${hash.toString(36)}`;
}

/**
 * A scene with the project's component documents spliced into it.
 *
 * `library` is path -> that document's definition subtree. A path an instance
 * names and the library does not hold is left exactly as it was: a dangling
 * `instanceOf` derives nothing, which is what deleting a component out from
 * under its uses has always left behind, and is a great deal better than
 * refusing to open the page.
 *
 * Returns the scene it was given when the project has no component documents
 * and no instance names one, so a document that has never heard of this pays
 * nothing and compares equal by identity.
 */
export function composeLibrary(
	scene: Scene,
	library: Readonly<Record<string, SceneNode>>,
): Scene {
	const used = new Set<string>();
	for (const node of flatten(scene.nodes)) {
		const ref = node.instanceOf;
		if (ref !== undefined && isComponentPath(ref) && library[ref]) used.add(ref);
	}
	if (used.size === 0) return scene;

	const ids = new Map<string, string>();
	for (const path of [...used].sort()) {
		const id = componentIdOf(path);
		// Injective by construction, and asserted rather than assumed: two
		// definitions under one id would be one definition, and the instances of
		// the second would quietly draw the first.
		if ([...ids.values()].includes(id)) continue;
		ids.set(path, id);
	}

	const definitions = [...ids].map(([path, id]) => ({
		...library[path],
		id,
		component: true as const,
		// Present for its instances, drawn on nobody's page. See the note above.
		hidden: true as const,
	}));

	return {
		...scene,
		nodes: [
			...definitions,
			...mapTree(scene.nodes, (node) => {
				const ref = node.instanceOf;
				if (ref === undefined || !isComponentPath(ref)) return node;
				const id = ids.get(ref);
				return id === undefined ? node : { ...node, instanceOf: id };
			}),
		],
	};
}

/**
 * The inverse of {@link composeLibrary}: a scene as its *page document* holds
 * it.
 *
 * Composition is a read and every read in the studio is followed by writes — the
 * editor is handed a scene and hands back a new one on every keystroke. Without
 * this, saving would write the spliced definitions into the page: a component
 * would be copied into every page that used it, the copies would drift, and the
 * document that was supposed to be the one source of it would become one of
 * several.
 *
 * So the pair is compose-on-read and decompose-on-write, and the round trip is
 * asserted rather than assumed — see the test, which is the only thing standing
 * between this and that failure, because nothing about a scene carrying an extra
 * hidden definition *looks* wrong.
 *
 * Definitions are recognised by the id {@link componentIdOf} derives, so a
 * `component: true` node the page genuinely owns — the three templates that ship
 * one, and any component drawn on a page — is left exactly where it is. This
 * removes what it added and nothing else.
 */
export function decomposeLibrary(
	scene: Scene,
	library: Readonly<Record<string, SceneNode>>,
): Scene {
	const paths = new Map<string, string>();
	for (const path of Object.keys(library)) paths.set(componentIdOf(path), path);
	if (paths.size === 0) return scene;

	const spliced = scene.nodes.filter(
		(node) => node.component === true && paths.has(node.id),
	);
	const instances = flatten(scene.nodes).some(
		(node) => node.instanceOf !== undefined && paths.has(node.instanceOf),
	);
	if (spliced.length === 0 && !instances) return scene;

	return {
		...scene,
		nodes: mapTree(
			scene.nodes.filter((node) => !spliced.includes(node)),
			(node) => {
				const path = node.instanceOf === undefined ? undefined : paths.get(node.instanceOf);
				return path === undefined ? node : { ...node, instanceOf: path };
			},
		),
	};
}

/**
 * A node, as the root of a component document.
 *
 * A component is a thing you go on to edit, and editing means putting things
 * inside it — so its root has to be able to hold children. Most nodes cannot: a
 * rect, a piece of text and an image are leaves, and `children` is documented as
 * present on the container kinds only.
 *
 * So a leaf is wrapped in a frame of its own size, with the leaf at the origin
 * inside it. That is what every design tool does when you make a component of a
 * rectangle, and here it is load-bearing rather than conventional: without it,
 * drawing in the component editor has nowhere legal to go. Confining new nodes
 * to a leaf root silently swallows them — they are added to a `children` the
 * renderer and the layer list do not read — and *not* confining them makes
 * second roots that `libraryOf` ignores. Wrapping removes both cases instead of
 * choosing between them.
 *
 * A node that can already contain is returned as it is, so making a component of
 * a frame does not add a frame around a frame.
 */
export function asDefinition(node: SceneNode): SceneNode {
	if (KINDS[node.kind].container || KINDS[node.kind].surface) {
		return { ...node, component: true };
	}
	return {
		...node,
		id: `${node.id}_of`,
		kind: "frame",
		name: node.name,
		component: true,
		// The frame takes the node's box and the node sits at its origin inside,
		// so the component occupies exactly the space the thing did and an instance
		// arrives the same size.
		children: [{ ...node, frame: { ...node.frame, x: single("0"), y: single("0") } }],
		// The wrapper is scaffolding, not a design decision: it paints nothing, so
		// what the component looks like is still entirely what was in it.
		props: {},
	};
}
