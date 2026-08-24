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
import { flatten, nodeNames, propValues } from "./tree.ts";
import {
	type Picks,
	type ResolveContext,
	type Value,
	propVar,
	resolveValue,
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
			const key = componentVariables(def)
				.map((v) => resolveValue(context, v.value, v.variable) ?? "")
				.join(" ");
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
 */
export function heldPicks(scene: Scene): Record<string, number> {
	const out: Record<string, number> = {};
	// One pass for the definitions rather than a tree walk per instance: a page
	// of a hundred instances is an ordinary document, and this runs on every
	// solve.
	const defs = new Map(componentDefs(scene).map((d) => [d.root.id, d] as const));
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

/** What a property row on a definition part is called, for the override list. */
export const varLabel = (v: ComponentVar): string =>
	`${v.node.name} · ${PROPS[v.prop].label}`;
