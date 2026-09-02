/**
 * A style, as a class.
 *
 * HTML's alone, and the SVG target's loss list says why in its own words: an
 * SVG is read by things that apply the presentation attributes and skip the
 * stylesheet, so every wearer carries the treatment inlined. The `StyleClass`
 * type itself is in the core, because the driver has a sentence to write about
 * what a class loses.
 */
import type {
	Declarations,
	PropName,
} from "@clingo-design/design-core";
import {
	cssValue,
	flatten,
	paintFor,
	propVar,
	styleProps,
	wornProps,
} from "@clingo-design/design-core";

import type {
	DocIndex,
	ExportResult,
	Layer,
	StyleClass,
} from "@clingo-design/export-core";
import {
	slug,
	tokenNamed,
} from "@clingo-design/export-core";


/**
 * The document's styles, as the classes the output shares between wearers.
 *
 * A style *is* a class: a named bundle of declarations several elements point
 * at. So the translation is an identity rather than an approximation, and the
 * only real work is deciding which of the style's properties may go in the
 * shared block. Three filters, and each rules out a way the class could paint
 * something the answer set did not:
 *
 *   - **every wearer draws it, the same way.** A text style that also holds a
 *     fill, worn by a text node, must not put a background on the text: the
 *     canvas paints only what `KINDS[kind].props` lists. A property two wearers
 *     of different kinds take to *different* declarations — a stroke is a
 *     border on a box and a `stroke` on a line — is out for the same reason.
 *   - **every wearer draws it in this universe.** A field one variant fills in
 *     and another leaves out is still one of the style's properties, and in the
 *     universe that picked the silent variant there is nothing to say.
 *   - **the wearers that take it agree about what it says.** They always do —
 *     one pick, one variant, one literal — but a hand-written rule may derive
 *     `resolved(prop(N,P))` for one node and not another, and then the shared
 *     block would be a claim about both.
 *
 * A wearer that states its own value for a property is *not* excluded: it keeps
 * that one declaration in its own rule, and its own rule beats the class —
 * see the `:where()` in `readLayer`. That is exactly what an override is, and
 * writing it as the cascade rather than as an absence is what makes the output
 * editable: change `.prose` and everything that did not override follows.
 *
 * Wearing comes from both places it can come from. The document is one, and
 * the answer set is the other: `ModelScene.wears` is the wearing no
 * `sty_doc/3` states — an instance's copy of a definition that wears a style,
 * and a node a hand-written rule dressed — and a wearer is a wearer however the
 * program came to know it. Reading only the document was a smaller output that
 * was also a wrong one: every instance of a styled component repeated the
 * treatment inline, and the class the definition's own part carried was a class
 * with one user.
 *
 * What a derived wearer does not bring is the token a value *named*: the
 * document has no account of it, so the class holds `var(--lg)` only when a
 * document wearer put it there — which is why the document's wearers are first
 * in the list {@link classRule} reads from. Named in {@link ExportResult.lost}.
 */
export function styleClasses(index: DocIndex, base: Layer): StyleClass[] {
	const model = base.universe.model;
	const out: StyleClass[] = [];
	for (const style of index.scene.styles ?? []) {
		const worn = new Map<string, Set<PropName>>();
		const wearers: string[] = [];
		for (const node of flatten(index.scene.nodes)) {
			if (node.style !== style.id || !model.byId[node.id]) continue;
			wearers.push(node.id);
			worn.set(node.id, new Set(wornProps(index.scene, node)));
		}
		// Then the wearers only this universe knows about. A property the node
		// draws for itself is not in the atom, so `wornProps`' precedence has
		// already been applied by the join that derived it.
		const derived: string[] = [];
		for (const wearer of model.wears[style.id] ?? []) {
			if (!model.byId[wearer.node] || worn.has(wearer.node)) continue;
			wearers.push(wearer.node);
			derived.push(wearer.node);
			worn.set(wearer.node, new Set(wearer.props));
		}
		if (wearers.length === 0) continue;
		const props = styleProps(style).filter((prop) => {
			const paints = new Set(wearers.map((id) => paintFor(model.byId[id].kind, prop)));
			if (paints.size !== 1 || paints.has(undefined)) return false;
			if (wearers.some((id) => model.byId[id].rendered[prop] === undefined)) return false;
			const said = new Set(
				wearers
					.filter((id) => worn.get(id)?.has(prop))
					.map((id) => model.byId[id].rendered[prop]),
			);
			return said.size === 1;
		});
		if (props.length === 0) continue;
		out.push({
			name: index.styleClass.get(style.id) ?? slug(style.id),
			props,
			wearers,
			worn,
			derived,
		});
	}
	return out;
}

/** One class's declarations in one layer, and which keys each property wrote. */
interface ClassRule {
	declarations: Declarations;
	keys: Map<PropName, string[]>;
}

/**
 * What a class says in one layer.
 *
 * The value comes from a wearer that actually *takes* the property from the
 * style, and through the same `tokenNamed` walk a node's own declaration takes
 * — so a variant that says `size: ref("lg")` reaches the class as
 * `var(--lg)`, and the class is a design system rather than a pile of numbers.
 *
 * The property set is decided once, on the base layer, and every layer answers
 * for exactly that set. A layer that hoisted a different set would emit
 * `unset` on a wearer's own rule *after* the class it was meant to defer to,
 * and the cascade would then drop a declaration the picture needs.
 */
export function classRule(
	index: DocIndex,
	layer: Layer,
	cls: StyleClass,
	useTokens: boolean,
	used: Set<string>,
): ClassRule {
	const declarations: Declarations = {};
	const keys = new Map<PropName, string[]>();
	for (const prop of cls.props) {
		const from = cls.wearers.find((id) => cls.worn.get(id)?.has(prop));
		const node = from === undefined ? undefined : layer.universe.model.byId[from];
		const value = node?.rendered[prop];
		if (node === undefined || value === undefined) continue;
		const paint = paintFor(node.kind, prop);
		if (!paint) continue;
		const token = useTokens
			? tokenNamed(index, layer.universe.pick, propVar(node.id, prop))
			: undefined;
		if (token) used.add(token.id);
		const said = paint(
			token ? `var(--${index.custom.get(token.id)})` : cssValue(prop, value),
		);
		Object.assign(declarations, said);
		keys.set(prop, Object.keys(said));
	}
	return { declarations, keys };
}

