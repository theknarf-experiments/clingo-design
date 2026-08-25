/**
 * Why a rule cannot hold, read off the document rather than out of a core.
 *
 * An unsat core names *which* switches cannot hold together, and `relax.ts`
 * turns that into ways out. Both are answers about the program. Neither can say
 * the one thing a designer actually wants to hear in the commonest impossible
 * document there is:
 *
 *     two headings wear one style, and a rule says their sizes must differ.
 *
 * The solver's account of that is "this rule cannot hold as things stand", and
 * its only way out is "switch the rule off" — which is true, is the only way
 * out, and is the worst available advice. Nothing is wrong with the rule. What
 * is wrong is that the two nodes share a treatment, so their size is *one*
 * variable with *one* value, and no search over any number of designs will ever
 * produce two. Measured: `findWays` returns exactly one way out for that
 * document and it is "delete your rule".
 *
 * So the explanation has to come from the document, where the shared source is
 * plainly visible, and it has to be a claim strong enough to state: if this
 * file says two members cannot be told apart, the document really is
 * unsatisfiable, and the tests prove it by solving.
 *
 * The rule is deliberately structural and deliberately incomplete. It reports a
 * tie the *document* makes — one style, one token, one stated value — and never
 * a tie that only holds because of what the values happen to resolve to. A node
 * linked to a token whose only alternative equals another node's literal is
 * stuck too, and this says nothing about it: under-reporting leaves the generic
 * message standing, which is merely unhelpful, while over-reporting would put a
 * confident wrong sentence in the panel.
 */
import {
	CONSTRAINT_KINDS,
	type Constraint,
	PROPS,
	type PropName,
	type Scene,
	type SceneNode,
	findStyle,
	wornProps,
} from "./scene.ts";
import { findInTree, nodeNames } from "./tree.ts";
import { findToken } from "./values.ts";

/**
 * What the document ties a node's property to, when it ties it to exactly one
 * thing.
 *
 * `same` is the identity two members have to share to be stuck together, and it
 * is a string so that "the same style", "the same token" and "the same term"
 * are one comparison rather than three. `said` is how that reads in the panel,
 * and it is the middle of the sentence `deadlock` builds around the two names.
 */
interface Source {
	same: string;
	said: string;
}

function sourceOf(
	scene: Scene,
	node: SceneNode,
	prop: PropName,
): Source | undefined {
	// A style first, and by the same precedence the compiler applies: a node that
	// states its own value wins, and `wornProps` is where that is decided.
	if (node.style !== undefined && wornProps(scene, node).includes(prop)) {
		const style = findStyle(scene.styles, node.style);
		const label = style?.name ?? node.style;
		return {
			same: `style:${node.style}`,
			said: `both take their ${PROPS[prop].label.toLowerCase()} from ${label}`,
		};
	}
	const own = node.props[prop];
	// More than one alternative and the node can move; none at all and the
	// property is not in the program to be constrained.
	if (own?.length !== 1) return undefined;
	const term = own[0];
	if (term.kind === "token") {
		const token = findToken(scene.tokens, term.token);
		const label = token?.name ?? term.token;
		return {
			same: `token:${term.token}`,
			said: `both take their ${PROPS[prop].label.toLowerCase()} from ${label}`,
		};
	}
	if (term.kind === "derived") {
		return {
			same: `derived:${term.via}:${term.from}`,
			said: `both compute their ${PROPS[prop].label.toLowerCase()} the same way, from the same place`,
		};
	}
	return {
		same: `literal:${term.value}`,
		said: `are both ${term.value}, and neither offers an alternative`,
	};
}

/** Two members of an all-different rule that the document cannot tell apart. */
export interface Deadlock {
	/** The pair, in the order the rule named them. */
	nodes: [string, string];
	/** What they cannot disagree about. */
	prop: PropName;
	/** The whole of it, in words, for the panel. */
	said: string;
}

/**
 * The first pair of members an all-different rule can never separate, if there
 * is one.
 *
 * Undefined is the ordinary answer and means only "nothing structural says this
 * is hopeless" — not that the document is satisfiable. A rule over a group is
 * always undefined: its members come from the answer set, and there is nothing
 * on this side to walk.
 */
export function deadlock(
	scene: Scene,
	constraint: Constraint,
): Deadlock | undefined {
	if (!constraint.enabled) return undefined;
	if (!CONSTRAINT_KINDS[constraint.kind].distinct) return undefined;
	if (constraint.group !== undefined) return undefined;
	const prop = constraint.prop;
	const seen = new Map<string, string>();
	for (const id of constraint.nodes) {
		const node = findInTree(scene.nodes, id);
		if (!node) continue;
		const source = sourceOf(scene, node, prop);
		if (!source) continue;
		const first = seen.get(source.same);
		if (first === undefined) {
			seen.set(source.same, id);
			continue;
		}
		const names = nodeNames(scene.nodes);
		const pair: [string, string] = [first, id];
		const [a, b] = pair.map((n) => names[n] ?? n);
		return {
			nodes: pair,
			prop,
			said: `${a} and ${b} ${source.said}, so this rule can never hold.`,
		};
	}
	return undefined;
}
