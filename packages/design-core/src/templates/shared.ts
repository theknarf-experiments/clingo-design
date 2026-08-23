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
import type { SceneNode } from "../scene.ts";
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
	content: string,
	props: SceneNode["props"],
): SceneNode {
	// Content joins the other properties rather than sitting beside them, so a
	// template can give a headline two wordings the way it gives it two colours.
	return {
		...makeNode("text", at(box), { id, name }),
		props: { text: single(content), ...props },
	};
}

/** Replace one starter token's value. */
export function withToken(tokens: Token[], id: string, value: Value): Token[] {
	return tokens.map((t) => (t.id === id ? { ...t, value } : t));
}

