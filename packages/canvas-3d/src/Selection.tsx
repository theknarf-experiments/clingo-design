/**
 * The outline around a selected object.
 *
 * A **box** rather than a silhouette, and that is a decision worth defending
 * because the silhouette is the prettier answer. drei's `<Outline>` renders the
 * selected meshes to an offscreen buffer, edge-detects it and composites it back
 * — one more full-screen pass and a post-processing stack, per viewport, in a
 * studio that may be showing twenty of them. A wireframe box costs twelve lines
 * and no pass at all.
 *
 * It also says the truer thing. What the layer list selects, what the inspector
 * edits, what a geometric rule aligns and what a state moves is the node's
 * **box** — six numbers in EMU — and the silhouette of a sphere inside that box
 * is not the thing any of them are about. A selection that draws the box is a
 * selection that draws what you are about to type into.
 *
 * Mounted as a sibling of the node's geometry inside its **centred** group, so
 * it turns with the node, which is what makes a rotated selection read as
 * rotated rather than as an axis-aligned rectangle that has lost its object.
 */
import { useEffect, useMemo } from "react";
import { BoxGeometry, EdgesGeometry } from "three";

export interface SelectionProps {
	/** The node's box in renderer units — `worldBox(...).size`. */
	size: readonly [number, number, number];
	/**
	 * Which mark this is: the one on the selection, or the one under the pointer.
	 *
	 * The same geometry for both, and that is the decision rather than an
	 * economy. A hover mark that were a *different shape* from the selection mark
	 * would be telling a designer that clicking is about to select something other
	 * than what is outlined, which is the one thing a hover must never imply. So
	 * it is the same box, drawn thinner and dimmer, and the promise it makes —
	 * "this is the box you are about to be editing" — is the promise the selection
	 * then keeps.
	 *
	 * A hovered node that is *also* selected draws only the selection: the caller
	 * decides, and `SceneTree` does, because two coincident line loops z-fight
	 * even with the depth test off.
	 */
	tone?: "selected" | "hovered";
}

export function Selection({ size, tone = "selected" }: SelectionProps) {
	// A hair on a degenerate axis, for `Solid`'s reason plus one of its own: a
	// zero-extent `EdgesGeometry` collapses two of its twelve edges onto the other
	// ten and the outline reads as a cross rather than as a rectangle.
	//
	// Memoised on the three **numbers** rather than on the array, because `size`
	// comes out of `worldBox` and is a fresh array on every render: depending on
	// it would rebuild the geometry sixty times a second while the pointer moves.
	// And disposed on the way out, because a `BufferGeometry` is a GPU buffer and
	// React dropping the last reference to one frees nothing at all — the leak
	// this pair prevents is the classic three.js one, and it only shows up after
	// somebody has been dragging a selection around for a minute.
	const [w, h, d] = size;
	const edges = useMemo(() => {
		const box = new BoxGeometry(w || HAIR, h || HAIR, d || HAIR);
		const it = new EdgesGeometry(box);
		box.dispose();
		return it;
	}, [w, h, d]);
	useEffect(() => () => edges.dispose(), [edges]);
	return (
		// `raycast` emptied, `depthTest` off. The outline is an editor's mark
		// rather than an object in the scene: it must not answer a pick, and it
		// must be visible through the thing it is marking, or selecting a cube
		// behind another cube would show nothing at all.
		<lineSegments geometry={edges} raycast={() => undefined} renderOrder={ON_TOP}>
			<lineBasicMaterial
				color={ACCENT}
				depthTest={false}
				transparent
				opacity={tone === "hovered" ? HOVER_OPACITY : 1}
			/>
		</lineSegments>
	);
}

const HAIR = 0.1;
/** After everything, so the depth-test-free pass is not itself overdrawn. */
const ON_TOP = 999;
/**
 * The selection colour, stated here rather than themed.
 *
 * Everything else in this package takes its colours from the answer set, and
 * this one cannot: a selection is editor state, it is not in the document, and
 * there is nothing in a `ModelScene` to read it from. A `--dc-*` custom property
 * is not reachable either — this is a WebGL clear-and-draw, not a CSS box. So it
 * is a constant, chosen to read against both the dark default `viewport` fill
 * (`#0b1020`) and a light one.
 */
const ACCENT = "#3b82f6";

/**
 * How faint the hover mark is beside the selection.
 *
 * A third rather than a second colour, because a second colour is a second
 * meaning and hover does not have one — it is the same relationship to the same
 * box, one gesture earlier. `lineWidth` would have been the other knob and is
 * not available: WebGL on every platform that matters draws every line one pixel
 * wide whatever `LineBasicMaterial.linewidth` says, which is a limitation worth
 * knowing about before reaching for it.
 */
const HOVER_OPACITY = 0.35;
