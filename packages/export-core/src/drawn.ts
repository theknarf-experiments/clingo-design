/**
 * What the answer set drew, as both targets have to ask it.
 *
 * Which state each layer of an instance is in, and what a machine last said
 * about one property of one node. Neither is a fact about a file format: an SVG
 * draws the one state each instance is in and needs to know which that is
 * exactly as much as a stylesheet that draws all of them does.
 *
 * They were in the HTML emitter because the HTML emitter was written first.
 * Splitting the targets into packages is what turned that into a compile error
 * rather than a thing nobody had reason to notice.
 */
import type {
	Machine,
	ModelScene,
	PropName,
	SceneNode,
	Value,
} from "@clingo-design/design-core";
import {
	findState,
	layerOf,
	machineForNode,
	machineLayers,
	parseInstancePart,
	shownState,
	shownStates,
	statePropVar,
} from "@clingo-design/design-core";

import type { DocIndex } from "./document.ts";

/**
 * Which state each layer of one instance is drawn in.
 *
 * Three sources, and the order is the whole of what makes a layered document and
 * a document that has never heard of layers both come out right.
 * `ModelScene.shownByLayer` is the answer set's own per-layer record and wins
 * outright where it is there — it is what `mslayer/3` and `shown/2` came to
 * together, and it is the only one of the three that can report a machine whose
 * layers a *rule* moved. Where it is not — a caller holding a model it wrote out
 * by hand, or one read before layers existed — the document's own
 * {@link shownStates} stands in, with `ModelScene.shown` laid over the first
 * layer because that is the field every reader written before layers is asking
 * about and the one the alias rules actually folded into the picture.
 *
 * Deliberately not a merge of all three: a `shown` that disagreed with a
 * `shownByLayer` would be one answer set contradicting itself, and picking
 * through it here would hide that rather than let a reader see it.
 */
export function drawnStates(
	model: ModelScene,
	machine: Machine,
	node: SceneNode,
	first: string,
): Record<string, string> {
	const byLayer = model.shownByLayer?.[node.id];
	if (byLayer !== undefined && Object.keys(byLayer).length > 0) return byLayer;
	const drawn = shownStates(machine, node);
	const shown = model.shown[node.id] ?? shownState(machine, node);
	return { ...drawn, [first]: shown };
}

/**
 * The delta the *drawn* state states for one property of an instance's part, and
 * the variable it is stored under.
 *
 * A hole this file had before layers and which layers walk straight into. A
 * property's token name is read back out of the document, because the program
 * interns literals — and the reading went to the definition's own stored value,
 * which is the right answer exactly while the instance is drawn in a state that
 * says nothing about that property. Where the drawn state *repaints* it, the
 * answer set renders the state's colour and the document's value names a
 * different token, so the file wrote `var(--accent)` beside a picture the solver
 * said was green. Rare before — it needs a `SceneNode.state` pointing at a
 * non-initial state — and ordinary now, because a layered instance is drawn in
 * one state per layer and any of them may repaint.
 *
 * The **last** layer that states a value wins, walked in layer order, which is
 * `mwriter/4`'s own rule and the same order {@link composeStates} composes in.
 * Deliberately not `composeStates` itself: that answers with a merged
 * {@link StatePart} and this needs to know *which state* stated it, because the
 * variable key a value's alternatives are picked under is `sprop(I,S,N,P)` and a
 * merged record has no S in it.
 */
export function drawnStateValue(
	index: DocIndex,
	model: ModelScene,
	nodeId: string,
	prop: PropName,
): { value: Value; variable: string } | undefined {
	const part = parseInstancePart(nodeId);
	if (!part) return undefined;
	const use = index.byId.get(part.instance);
	if (!use) return undefined;
	const machine = machineForNode(index.scene, use);
	if (!machine) return undefined;
	const stack = machineLayers(machine);
	const drawn = drawnStates(model, machine, use, stack[0].id);
	let found: { value: Value; variable: string } | undefined;
	for (const stratum of stack) {
		const state = findState(machine, drawn[stratum.id]);
		// A state has to be a state of *this* layer, for `composeStates`' reason: a
		// record naming layer two's state under layer one would compose one layer's
		// pose twice.
		if (!state || layerOf(machine, state) !== stratum.id) continue;
		const value = state.parts[part.node]?.props?.[prop];
		if ((value?.length ?? 0) > 0) {
			found = {
				value: value as Value,
				variable: statePropVar(use.id, state.id, part.node, prop),
			};
		}
	}
	return found;
}
