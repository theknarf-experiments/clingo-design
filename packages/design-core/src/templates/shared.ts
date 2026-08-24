/**
 * Building blocks shared by the templates.
 *
 * Thin wrappers over {@link makeNode}, so a template can state a node as one
 * line of literal data and still get the per-kind construction rules.
 *
 * Child coordinates are relative to the enclosing frame, so a frame can be
 * moved on the canvas without touching anything inside it.
 */
import { makeNode } from "../edits.ts";
import type { Dimension, SceneNode } from "../scene.ts";
import { type Token, type Value, single } from "../values.ts";

export type Box = [x: number, y: number, width: number, height: number];

export const at = ([x, y, width, height]: Box) => ({ x, y, width, height });

/**
 * Templates go through {@link makeNode} like any other node, so per-kind
 * construction rules live in exactly one place; `props` overrides rather than
 * adds to the kind's defaults, since a template states its whole appearance.
 */
export function frame(
	id: string,
	name: string,
	box: Box,
	props: SceneNode["props"],
	children: SceneNode[],
): SceneNode {
	return { ...makeNode("frame", at(box), { id, name }), props, children };
}

export function rect(
	id: string,
	name: string,
	box: Box,
	props: SceneNode["props"],
): SceneNode {
	return { ...makeNode("rect", at(box), { id, name }), props };
}

export function text(
	id: string,
	name: string,
	box: Box,
	// A whole {@link Value} as well as a bare string, because a wording with
	// alternatives is the ordinary case and not a special one: a template that
	// wants nine of them should not have to reach past this helper to say so.
	content: string | Value,
	props: SceneNode["props"],
): SceneNode {
	// Content joins the other properties rather than sitting beside them, so a
	// template can give a headline two wordings the way it gives it two colours.
	return {
		...makeNode("text", at(box), { id, name }),
		props: {
			text: typeof content === "string" ? single(content) : content,
			...props,
		},
	};
}

/**
 * A node with one of its dimensions given several alternatives.
 *
 * Geometry arrives here as a plain box, because that is what almost every node
 * wants; this is how a template says "and this one sits in two places", without
 * every helper above growing a second way to spell a frame.
 */
export function spread(
	node: SceneNode,
	dim: Dimension,
	values: Value,
): SceneNode {
	return { ...node, frame: { ...node.frame, [dim]: values } };
}

/** Replace one starter token's value. */
export function withToken(tokens: Token[], id: string, value: Value): Token[] {
	return tokens.map((t) => (t.id === id ? { ...t, value } : t));
}

