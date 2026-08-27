/**
 * Measures the document's text, because design-core cannot.
 *
 * pretext splits the work in two: `prepare` walks the string, segments it and
 * measures every run against a real canvas; `layout` is then pure arithmetic
 * over that result. Only the first half depends on the text and the font, so
 * only the first half is cached — re-preparing on every keystroke is exactly
 * the cost the split exists to avoid.
 *
 * The numbers reach the compiler as `lask` facts, so the solver hugs the words
 * rather than the box they were typed in — which means everything this file
 * hands out is EMU, and everything pretext is handed is float CSS pixels,
 * because a font engine has no other unit.
 *
 * The seam between the two is drawn *inside* {@link measureText} rather than
 * around it. Every argument it takes and the size it returns are the model's,
 * so nothing outside has to remember which of them is which; the pixels exist
 * only between the first line of that function and its last, bounded by
 * `cssPxFromEmu` going in and `sizeFromCssPx` coming out. Drawing it the other
 * way round — a `lineHeightPx` at the call site — worked, and put a float pixel
 * count in a signature two files away from anything that could explain why it
 * was not EMU like its neighbours.
 */
import {
	layout,
	measureNaturalWidth,
	prepareWithSegments,
	type PreparedTextWithSegments,
} from "@chenglou/pretext";
import {
	PROPS,
	type Emu,
	type Measured,
	type Measurements,
	type PropName,
	type Scene,
	type Size,
	capAxes,
	cssPxFromEmu,
	fontString,
	lineHeightEmu,
	measureAxes,
	propValueOf,
	propValues,
	propVar,
	resolveValue,
	rowCount,
	rowPicks,
	sizeFromCssPx,
	stateMeasures,
	toMeasure,
} from "@clingo-design/design-core";

/**
 * What a text node inherits when its own font is unset. Mirrors the
 * `.artboard` rule in Artboard.module.css — measuring against a different
 * stack than the one that paints would be off by whole characters.
 */
const ARTBOARD_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * Prepared strings, keyed by the two things they depend on.
 *
 * Bounded because a long editing session otherwise keeps every intermediate
 * string anyone ever typed. Least recently used goes first, which a Map gives
 * for free: it iterates in insertion order, and a hit is re-inserted.
 */
const CACHE_LIMIT = 512;
const prepared = new Map<string, PreparedTextWithSegments>();

function prepareCached(text: string, font: string): PreparedTextWithSegments {
	// A separator no font string and no typed character can contain, written as
	// the escape rather than as the byte: a raw NUL makes git and grep classify
	// the whole file as binary, and grep then reports no matches rather than
	// saying it skipped anything. See 219bcd1, which found two of these.
	const key = `${font}\x00${text}`;
	const hit = prepared.get(key);
	if (hit) {
		prepared.delete(key);
		prepared.set(key, hit);
		return hit;
	}
	// The renderer draws with `white-space: pre-wrap`, so the measurement has
	// to honour the same runs of spaces and the same hard breaks.
	const made = prepareWithSegments(text, font, { whiteSpace: "pre-wrap" });
	if (prepared.size >= CACHE_LIMIT) {
		const oldest = prepared.keys().next().value;
		if (oldest !== undefined) prepared.delete(oldest);
	}
	prepared.set(key, made);
	return made;
}

/**
 * The space `text` needs: as wide as its longest line, up to `available`, and
 * as tall as the lines that then result.
 *
 * EMU in and EMU out. `leading` is how tall one line is and `available` how
 * wide the box may get, and both are lengths in the design — a leading may have
 * been written `1.5`, `18px` or `0.25in`, and a width the layout imposes is
 * whatever the solver said. They become pixels on the two lines below because
 * pretext measures in pixels, and they stop being pixels again on the way out.
 * `Number.POSITIVE_INFINITY` survives the division, so the default still means
 * "as wide as it likes".
 *
 * Rounded up, and only up, before it crosses back. Glyph advances are
 * fractional and the model could now hold the fraction — a whole pixel is 9525
 * EMU — but a box half a pixel narrower than its content is a box the browser
 * wraps a line inside, so the slack is deliberate rather than a limit of the
 * unit. Rounding up here and not in `sizeFromCssPx` is that distinction: the
 * conversion is exact, the padding is a decision about wrapping.
 */
export function measureText(
	text: string,
	font: string,
	leading: Emu,
	available: Emu = Number.POSITIVE_INFINITY,
): Size {
	const prep = prepareCached(text, font);
	const leadingPx = cssPxFromEmu(leading);
	// A zero width would leave the line walker with nowhere to put a
	// character; one pixel is the narrowest honest answer.
	const width = Math.max(
		1,
		Math.min(measureNaturalWidth(prep), cssPxFromEmu(available)),
	);
	return sizeFromCssPx({
		width: Math.ceil(width),
		height: Math.ceil(layout(prep, width, leadingPx).height),
	});
}

/**
 * Measures every node in the document that sizes itself to its content, once
 * per combination of the picks that change what it comes to.
 *
 * Not once per node, and no longer once per wording either. A style is one
 * variable whose alternatives are whole records, and the record it picks decides
 * the font size, the weight, the family and the line height — every input to the
 * measurement. So a headline with three wordings under a two-variant style is
 * **six** boxes, and which of the six applies is the solver's business, not
 * something that can be decided here: this pass runs before the solve it feeds.
 * `measureAxes` works out what those picks are and `rowPicks` enumerates them;
 * the resulting table is read back by `askedSize` and reaches the program as
 * `lrow/4` with an `lrowif/4` per axis.
 *
 * `capAxes` is the honest cap. Over the budget an axis is dropped rather than
 * the table truncated, so every universe still gets a definite box — measured
 * with the dropped variable at its first alternative — and the drop is reported
 * rather than absorbed.
 *
 * Nothing constrains the width. An auto-sized text node decides its own, the
 * way Figma's auto-width does; a node whose layout stretches it will wrap at
 * whatever it is stretched to, and its measured height is then only what it
 * asked for.
 */
export function measureScene(scene: Scene): Measurements {
	const base = {
		tokens: scene.tokens,
		picks: {},
		props: propValues(scene.nodes),
	};
	const out: Record<string, Measured> = {};
	for (const node of toMeasure(scene.nodes)) {
		const { axes, dropped } = capAxes(measureAxes(scene, node));
		const sizes: Size[] = [];
		for (let row = 0; row < rowCount(axes); row++) {
			const picks = rowPicks(axes, row);
			const context = { ...base, picks };
			// Through `propValueOf`, not `node.props`: a node wearing a text style
			// takes its font from the style, and measuring it against the fallback
			// would hug the wrong words in every universe. Same precedence the
			// generated program applies, at this row's variant.
			const prop = (name: PropName): string | undefined =>
				resolveValue(
					context,
					propValueOf(scene, node, name, picks),
					propVar(node.id, name),
				);
			const font = fontString({
				family: prop("fontFamily") ?? ARTBOARD_FONT,
				size: prop("size") ?? PROPS.size.fallback,
				weight: prop("weight") ?? PROPS.weight.fallback,
			});
			sizes.push(
				measureText(
					prop("text") ?? "",
					font,
					lineHeightEmu(prop("size"), prop("lineHeight")),
				),
			);
		}
		out[node.id] = dropped.length > 0 ? { axes, sizes, dropped } : { axes, sizes };
	}
	measureStates(scene, out);
	return out;
}

/**
 * The same pass, for the copies a machine's states make of a part that hugs its
 * words.
 *
 * A state that changes the wording, the size, the weight or the family gives its
 * copy a box of its own, and the base was measured in the *definition's*
 * typography — so without this a hover that doubles the label grows the text and
 * leaves the box it sits in exactly where it was. The tables land in the same
 * `Measurements` beside the document's own, keyed by the copy's term, and the
 * compiler writes them out as `lask/3` under that term.
 *
 * All the deciding happened in `stateMeasures`: which copies exist, which axes
 * key their rows, and what strings each row is once the delta, the part's own
 * value and its style have been read in the right order. That is deliberate and
 * it is why this function is short — the precedence rules belong beside the
 * program that has to agree with them, not in the one host that happens to own a
 * canvas. What is left here is the half design-core genuinely cannot do, which
 * is to ask a font engine how wide some words are.
 *
 * No `capAxes` call, unlike the loop above. `stateMeasures` has already capped
 * them against a share of the budget worked out from how many copies of the part
 * there are to measure — a machine does not make one table bigger, it makes more
 * tables — so capping again here would drop a second axis for no reason and
 * report it twice.
 */
function measureStates(scene: Scene, out: Record<string, Measured>): void {
	for (const measure of stateMeasures(scene)) {
		const sizes = measure.rows.map((row) =>
			measureText(
				row.text,
				fontString({
					family: row.family ?? ARTBOARD_FONT,
					size: row.size ?? PROPS.size.fallback,
					weight: row.weight ?? PROPS.weight.fallback,
				}),
				lineHeightEmu(row.size, row.lineHeight),
			),
		);
		out[measure.id] =
			measure.dropped.length > 0
				? { axes: measure.axes, sizes, dropped: measure.dropped }
				: { axes: measure.axes, sizes };
	}
}
