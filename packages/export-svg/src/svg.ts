/**
 * SVG.
 *
 * The flat target, moved out of `design-core/export.ts` whole. It shares the
 * core's document index, layers and units with the HTML target and none of its
 * machinery: no classes, no states, no keyframes, no depth — which is what the
 * loss list in this package's plugin says, in a designer's words.
 */
import type {
	Declarations,
	Frame,
	ModelNode,
	NodeKind,
	PropName,
} from "@clingo-design/design-core";

import type {
	DocIndex,
	Emitted,
	ExportOptions,
	Layer,
} from "@clingo-design/export-core";
import {
	customProperties,
	dataUrl,
	docNode,
	drawnStateValue,
	escapeAttr,
	escapeText,
	framePx,
	modelBounds,
	round,
	stopsHere,
	tokenNamed,
	valueNamed,
} from "@clingo-design/export-core";



import {
	KINDS,
	PAINT,
	arrowHead,
	cssPx,
	cssText,
	cssValue,
	diagonalRun,
	drawsWords,
	frameOf,
	isDiagonal,
	isPlotted,
	lineHeightEmu,
	pathData,
	propVar,
	scalePoints,
} from "@clingo-design/design-core";

/* ------------------------------------------------------------------ */
/* SVG                                                                 */
/* ------------------------------------------------------------------ */

/** Where a text anchor sits for each alignment the document offers. */
const ANCHOR: Record<string, "start" | "middle" | "end"> = {
	left: "start",
	center: "middle",
	right: "end",
};

/**
 * How each property reaches SVG.
 *
 * The second paint table, and the reason there are two: SVG colours a shape
 * with `fill` and text with the same `fill`, has no box to put a background or
 * a border on, and expresses a corner radius as a geometric property of the
 * rectangle. Same shape as {@link PAINT}, keyed the same way, so a new property
 * is one entry here and one there.
 */
const SVG_PAINT: Partial<Record<PropName, (value: string) => Declarations>> = {
	fill: (value) => ({ fill: value }),
	radius: (value) => ({ rx: value, ry: value }),
	stroke: (value) => ({ stroke: value }),
	strokeWidth: (value) => ({ strokeWidth: value }),
	opacity: (value) => ({ opacity: value }),
	ink: (value) => ({ fill: value }),
	fontFamily: (value) => ({ fontFamily: value }),
	size: (value) => ({ fontSize: value }),
	weight: (value) => ({ fontWeight: value }),
	align: (value) => ({ textAnchor: ANCHOR[value] ?? "start" }),
	// SVG has compositing: `mix-blend-mode` is a CSS Compositing property that
	// applies to SVG elements and that the rasterisers this target is written for
	// implement, unlike the CSS filter functions. Carried rather than dropped,
	// because dropping something that works would be the same lie in the other
	// direction, and it is why the svg.loses list has no sentence about mixing.
	mix: (value) => ({ mixBlendMode: value }),
	// shadow: an SVG shadow is a filter, and a filter is not the declaration
	// anyone wrote. Named in EXPORT_TARGETS.svg.loses rather than approximated.
	//
	// blur and backdropBlur: absent for the same reason and a sharper one. A CSS
	// `filter: blur()` is not an SVG filter, so a browser opening this file would
	// blur and a rasteriser reading the same attribute would not — one file, two
	// pictures, decided by who opened it. A backdrop has no SVG reading at all.
	//
	// gradient, gradientFrom, gradientTo: absent from the table and handled after
	// the loop in {@link svgPaint}, because dropping them outright is the one
	// omission in this target that would produce a *wrong* picture rather than a
	// simpler one.
};

/** A shape's own attributes, before anything is painted on it. */
const SVG_SHAPES: Partial<Record<NodeKind, (frame: Frame) => string>> = {
	frame: (f) => `<rect width="${round(f.width)}" height="${round(f.height)}"/>`,
	rect: (f) => `<rect width="${round(f.width)}" height="${round(f.height)}"/>`,
	// A 3D view is a rectangle here and nothing else, which is the same answer
	// the HTML target gives and for the same reason — see `stopsHere`. It is in
	// this table rather than special-cased in `svgNode` because that is what the
	// table is for: a kind whose whole appearance is its own box gets a row.
	viewport: (f) => `<rect width="${round(f.width)}" height="${round(f.height)}"/>`,
	ellipse: (f) =>
		`<ellipse cx="${round(f.width / 2)}" cy="${round(f.height / 2)}" rx="${round(f.width / 2)}" ry="${round(f.height / 2)}"/>`,
};

function svgPaint(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
	useTokens: boolean,
	used: Set<string>,
): Declarations {
	const box: Declarations = {};
	if (KINDS[node.kind].surface) box.fill = "#ffffff";
	for (const prop of KINDS[node.kind].props) {
		const value = node.rendered[prop];
		if (value === undefined) continue;
		const paint = SVG_PAINT[prop];
		if (!paint) continue;
		// The same two front doors {@link declarationsFor} has, and for the same
		// reason — see {@link drawnStateValue}. This twin was left reading the
		// definition's stored value when that hole was closed on the HTML side, so
		// an instance drawn in a state that *repaints* a property named one token in
		// the file and drew a different colour in the picture: `var(--muted)` beside
		// a `#f43f5e` the answer set had already decided. The round-trip test is
		// what catches it, because inlining the var is what makes the two readings
		// comparable at all — and it needed a template whose drawn state repaints
		// something before there was a document to catch it on.
		const said = useTokens
			? drawnStateValue(index, layer.universe.model, node.id, prop)
			: undefined;
		const token = !useTokens
			? undefined
			: said !== undefined
				? valueNamed(index, layer.universe.pick, said.value, said.variable)
				: tokenNamed(index, layer.universe.pick, propVar(node.id, prop));
		if (token) used.add(token.id);
		Object.assign(
			box,
			paint(token ? `var(--${index.custom.get(token.id)})` : cssValue(prop, value)),
		);
	}
	// A gradient flattens to the colour it starts from.
	//
	// An SVG shape has no background, so the CSS `background-image` a gradient
	// becomes says nothing here. Carrying it properly would mean a
	// `<linearGradient>` def per node, built by reading the recipe the designer
	// chose back into an angle and two stops — a second description of the same
	// picture, in a file whose whole promise is that the file *is* the picture,
	// and two descriptions drift the day somebody adds a recipe and forgets the
	// twin.
	//
	// Flattened rather than dropped, and the difference is not tidiness: a node
	// whose fill was cleared and whose paint is entirely a gradient would leave
	// this element with no `fill` at all, and an SVG shape with no fill is
	// **black**. A recognisably wrong colour is a worse answer than a
	// recognisably simpler one, and the loss list says which happened.
	//
	// After the loop, so it beats the node's own fill — the gradient is what you
	// see — and guarded on the recipe, so a node carrying gradient colours with
	// its direction set back to `none` paints its flat fill, which is what the
	// canvas shows.
	//
	// Written as the colour rather than as the `var()` the document named, and it
	// is the one value in this target that is: this is a *flattening* rather than
	// a translation, and naming the token here would claim the file carries a
	// gradient the picture has not got.
	//
	// Guarded on the *kind* as well as on the recipe, which the property loop
	// above gets for free and this does not: `rendered/3` is whatever the answer
	// set says, and a rule or a style variant may put a `gradient` on a text node
	// that has no such row. The loop skips it because it walks
	// `KINDS[kind].props`; here the same list has to be asked, or a paragraph
	// would flatten its ink to a colour it never painted with.
	const recipe = node.rendered.gradient;
	if (
		recipe !== undefined &&
		recipe !== "none" &&
		KINDS[node.kind].props.includes("gradient")
	) {
		const from = node.rendered.gradientFrom;
		if (from !== undefined) box.fill = cssValue("gradientFrom", from);
	}
	return box;
}

/**
 * The number a line height reads as, for the em maths a tspan needs.
 *
 * A ratio, so it is read as itself and never as a length: `1.35` here means
 * 1.35 of the font size, exactly as CSS reads a unitless line-height. A
 * document that stated its leading as a *length* falls back to the default
 * rather than being converted, which is a hole this predates and does not
 * widen — see {@link lineHeightEmu} for the reader that handles both.
 */
function lineHeightOf(node: ModelNode): number {
	const n = Number(node.rendered.lineHeight);
	return Number.isFinite(n) && n > 0 ? n : 1.35;
}

/** `frame` is the node's box in CSS pixels — see {@link svgNode}. */
function svgText(node: ModelNode, frame: Frame, style: string): string {
	const align = node.rendered.align ?? "left";
	const x = align === "center" ? frame.width / 2 : align === "right" ? frame.width : 0;
	const lh = lineHeightOf(node);
	// The first baseline sits half the leading below the top, plus the ascent.
	// In em, so a font size that is itself a custom property still works out.
	const first = (lh - 1) / 2 + 0.8;
	const lines = (node.rendered.text ?? "").split("\n");
	const spans = lines
		.map(
			(line, i) =>
				`<tspan x="${round(x)}" dy="${round(i === 0 ? first : lh)}em">${escapeText(line)}</tspan>`,
		)
		.join("");
	return `<text${style}>${spans}</text>`;
}

function svgNode(
	index: DocIndex,
	layer: Layer,
	node: ModelNode,
	useTokens: boolean,
	used: Set<string>,
	depth: number,
	images: Readonly<Record<string, Uint8Array>>,
	clips: string[],
): string {
	const pad = "\t".repeat(depth + 1);
	// The whole of this function is CSS pixels: an SVG user unit is one, given
	// the viewBox `svgExport` writes. Converted here, once, rather than at the
	// eight attributes below.
	const frame = framePx(node.frame);
	const declarations = svgPaint(index, layer, node, useTokens, used);
	const style =
		Object.keys(declarations).length === 0
			? ""
			: ` style="${escapeAttr(cssText(declarations).replace(/\n/g, " "))}"`;

	let own = "";
	const doc = docNode(index, node.id);
	if (node.kind === "image") {
		// `preserveAspectRatio` is SVG's spelling of `object-fit`: slice crops to
		// fill, meet letterboxes inside, and `none` stretches. The mapping is
		// exact, so the two targets show the same picture rather than nearly.
		const url = node.asset === undefined ? undefined : dataUrl(images, node.asset);
		const fit = node.rendered.fit ?? "cover";
		const ratio =
			fit === "stretch"
				? "none"
				: fit === "contain"
					? "xMidYMid meet"
					: "xMidYMid slice";
		own =
			url === undefined
				? ""
				: `<image x="0" y="0" width="${round(frame.width)}" height="${round(frame.height)}" preserveAspectRatio="${ratio}" href="${escapeAttr(url)}"${style}/>`;
	} else if (drawsWords(node)) {
		own = svgText(node, frame, style);
	} else if (isDiagonal(node)) {
		const { y1, y2 } = diagonalRun(frame, doc?.diagonal);
		const head =
			node.kind === "arrow"
				? `<polyline points="${escapeAttr(arrowHead(0, y1, frame.width, y2))}" fill="none" stroke-linecap="round" stroke-linejoin="round"${style}/>`
				: "";
		own = `<line x1="0" y1="${round(y1)}" x2="${round(frame.width)}" y2="${round(y2)}" fill="none" stroke-linecap="round"${style}/>${head}`;
	} else if (isPlotted(node)) {
		const context = { tokens: index.scene.tokens, picks: layer.universe.pick };
		// Scaled straight into pixels, for the reason `htmlContent` gives.
		const d = doc
			? pathData(scalePoints(doc.points ?? [], frameOf(doc, context), frame), doc.closed)
			: "";
		if (d) {
			const closed = doc?.closed ? "" : ' fill="none"';
			own = `<path d="${escapeAttr(d)}"${closed} stroke-linecap="round" stroke-linejoin="round"${style}/>`;
		}
	} else {
		const shape = SVG_SHAPES[node.kind];
		if (shape) own = shape(frame).replace("/>", `${style}/>`);
	}

	// A surface clips what hangs over its edge, exactly as the canvas does —
	// including the rounding, which is why the corner radius comes along and
	// nothing else does.
	let clip = "";
	if (KINDS[node.kind].surface && node.children.length > 0) {
		const id = `clip${clips.length}`;
		const corners: Declarations = {};
		if (declarations.rx !== undefined) {
			corners.rx = declarations.rx;
			corners.ry = declarations.ry ?? declarations.rx;
		}
		const rounded =
			Object.keys(corners).length === 0
				? ""
				: ` style="${escapeAttr(cssText(corners).replace(/\n/g, " "))}"`;
		clips.push(
			`<clipPath id="${id}"><rect width="${round(frame.width)}" height="${round(frame.height)}"${rounded}/></clipPath>`,
		);
		clip = ` clip-path="url(#${id})"`;
	}

	// The same stop the HTML target makes, in the flat target that has even less
	// to say about a scene than a page does.
	const inside = (stopsHere(node.kind) ? [] : node.children).map((child) =>
		svgNode(index, layer, child, useTokens, used, depth + 1, images, clips),
	);
	const kids =
		inside.length === 0 ? "" : `\n${pad}\t<g${clip}>\n${inside.join("\n")}\n${pad}\t</g>`;
	return `${pad}<g transform="translate(${round(frame.x)},${round(frame.y)})" data-node="${escapeAttr(node.id)}" data-kind="${node.kind}">${own}${kids}\n${pad}</g>`;
}

/**
 * SVG, with everything on the element.
 *
 * **A style stays inlined here, and it is not an oversight.** SVG has the
 * cascade — a `<style>` element and a `class` attribute both work in a browser —
 * but an SVG file is read by more than browsers, and the moment one of them
 * (an editor, a rasteriser, a paste into another document) applies the
 * presentation attributes and skips the stylesheet, a class is the difference
 * between a picture and a wireframe. This target's promise is that the file
 * *is* the picture, which is why a shadow is dropped rather than approximated
 * with a filter; a class that might not be applied is the same bargain the
 * other way round. So a style's properties are written onto every element that
 * wears it, the correlation is in the picture and not in the file, and
 * {@link EXPORT_TARGETS} says so out loud.
 */
export function svgExport(
	index: DocIndex,
	layers: readonly Layer[],
	options: ExportOptions,
): Emitted {
	const useTokens = options.tokens !== false;
	const base = layers[0];
	const bounds = modelBounds(base.universe.model);
	const used = new Set<string>();
	const clips: string[] = [];
	const body = base.universe.model.roots
		.map((root) =>
			svgNode(
				index,
				base,
				{ ...root, frame: { ...root.frame, x: root.frame.x - bounds.x, y: root.frame.y - bounds.y } },
				useTokens,
				used,
				0,
				options.images ?? {},
				clips,
			),
		)
		.join("\n");

	const custom = customProperties(index, base.universe.pick, used);
	// `svg` rather than `:root`, so the definitions hold both in a standalone
	// file and when this markup is pasted into an HTML page.
	const definitions =
		Object.keys(custom).length === 0 ? "" : `svg {\n${cssText(custom, "\t")}\n}\n`;
	const style = `\n<style>\n${definitions}text { white-space: pre; }\n</style>`;
	const defs = clips.length === 0 ? "" : `\n<defs>\n\t${clips.join("\n\t")}\n</defs>`;
	const title = options.title ? `\n<title>${escapeText(options.title)}</title>` : "";

	// The viewBox is what makes a user unit a CSS pixel for everything inside.
	const w = cssPx(bounds.width);
	const h = cssPx(bounds.height);
	return {
		classes: [],
		// Nothing conditional: what this target loses about a machine it loses about
		// every machine, so it is one unconditional sentence in `EXPORT_TARGETS`
		// rather than a list assembled per document.
		lost: [],
		// `isolation: isolate` unconditionally, and on the root for the reason
		// `.design` carries it: a multiply near the top of the picture must blend
		// against the design and not against whatever this file was pasted over.
		// Unconditional because a document with no mix mode in it is isolated from
		// a page it composites identically with either way, and a rule that
		// appeared only sometimes would be a file whose shape depended on a
		// property nobody can see in it.
		text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif" fill="#0f172a" style="isolation: isolate">${title}${style}${defs}
${body}
</svg>
`,
	};
}

