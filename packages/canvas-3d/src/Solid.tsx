/**
 * The six primitives, each drawn as itself inside a box the document decided.
 *
 * Every geometry here is built at **unit size and centred on its own origin**,
 * and the box is applied as a `scale`. That is one decision and it pays for
 * three things:
 *
 *   - a `mesh` is `width × height × depth` in EMU like every other node, so the
 *     inspector's six numbers, a geometric rule's `width` and the silhouette on
 *     screen are the same three numbers rather than three conventions;
 *   - a sphere in a non-cubic box is an ellipsoid and a cylinder in one is an
 *     elliptic cylinder, which is what a designer who typed three different
 *     numbers meant;
 *   - the geometries themselves are shared. Six `useMemo`-free constant
 *     geometries would be six buffers for a hundred meshes, and R3F's
 *     `<boxGeometry />` element already reuses one per element instance — what
 *     the unit sizing adds is that a *hundred* meshes of the same kind can share
 *     one, which the {@link GEOMETRY} table below is.
 *
 * **Where the primitive's own axis and the document's disagree**, three.js wins
 * and the mapping is stated rather than corrected. A three.js cylinder and cone
 * stand along **y**, and `worldEuler`'s crossing has already flipped y, so a
 * cone drawn from a document with no rotation in it points *up the screen*.
 * That is the answer a designer expects from a cone and it is the answer glTF's
 * own convention gives, so nothing here rotates it into the document's
 * y-is-down; a `rotateX` in the document turns it exactly as it would turn a
 * box, which is the property that actually has to hold.
 */
import type { ThreeElements } from "@react-three/fiber";
import type { JSX, ReactNode } from "react";

/**
 * The six words `VALUE_TYPES.solid` offers, as a type this file can switch on.
 *
 * Duplicated from the value table rather than imported as a type, because the
 * table is a `ValueOption[]` of strings and there is no union type upstream to
 * import. {@link isSolidKind} is the guard that keeps the two honest: an option
 * added upstream and not here draws as a box and does not typecheck as one.
 */
export type SolidKind = "box" | "sphere" | "cylinder" | "cone" | "plane" | "torus";

export const SOLID_KINDS: readonly SolidKind[] = [
	"box",
	"sphere",
	"cylinder",
	"cone",
	"plane",
	"torus",
];

export const isSolidKind = (word: string | undefined): word is SolidKind =>
	word !== undefined && (SOLID_KINDS as readonly string[]).includes(word);

/**
 * The tessellation each word gets, at unit size, centred.
 *
 * The segment counts are the one arbitrary thing in this file, so here is the
 * rule they follow: enough that a solid at the size a viewport is usually shown
 * at has no visible facets, and not so many that twenty of them in a studio full
 * of universes costs a frame. A sphere at 32×16 is 512 triangles; a torus at
 * 48×16 is 1536, which is the most expensive of the six and is still a rounding
 * error beside an imported model.
 *
 * `Fragment`-free: each entry is a single element, so the caller can put it
 * inside a `<mesh>` beside a material with no wrapper.
 */
const GEOMETRY: Record<SolidKind, () => JSX.Element> = {
	// A unit cube. The one primitive whose three.js axes are the document's.
	box: () => <boxGeometry args={[1, 1, 1]} />,
	// Radius ½ so the diameter is 1 and the scale is the box, not twice it.
	sphere: () => <sphereGeometry args={[0.5, 32, 16]} />,
	// Top and bottom radius ½, height 1, along y.
	cylinder: () => <cylinderGeometry args={[0.5, 0.5, 1, 32]} />,
	// Base radius ½, height 1, apex at +y — up the screen, see the header.
	cone: () => <coneGeometry args={[0.5, 1, 32]} />,
	// A single quad in the xy plane, facing the camera at rest. It has no depth,
	// so its box's `depth` scales nothing — which is honest rather than a bug: a
	// plane is the one primitive that is two-dimensional, and giving it a
	// thickness would have made it a very thin box under another name.
	plane: () => <planeGeometry args={[1, 1]} />,
	// Ring radius ⅜ and tube radius ⅛, so the outer diameter is exactly 1 and a
	// torus fills its box the way the other five do. In the xy plane, like the
	// plane, which is the orientation a ring is drawn in when it is a decoration
	// on a flat surface — the common case for one in a layout tool.
	torus: () => <torusGeometry args={[0.375, 0.125, 16, 48]} />,
};

export interface SolidProps {
	/** Which primitive, already read off `rendered.solid`. */
	kind: SolidKind;
	/** Width, height and depth in renderer units — a {@link WorldBox}'s `size`. */
	size: readonly [number, number, number];
	/** The node id this mesh answers a raycast with — see `ViewportCanvas`. */
	nodeId: string;
	children?: ReactNode;
	/** Passed through so a caller can add `onPointerDown` and the rest. */
	meshProps?: Omit<ThreeElements["mesh"], "ref" | "scale" | "userData" | "children">;
}

/**
 * One primitive, scaled into its box, carrying the id a pick reports back.
 *
 * `userData.nodeId` is the *model's* id, which for an instance's part is the
 * term `inst(I,label)` and not a document node id at all — the same string the
 * layer list shows, the same string `onSelectionChange` takes, and the same
 * string a geometric rule names. One id, one selection set; that is the whole
 * point of `docs/three-d-spec.md` §9.1 and it costs one prop.
 *
 * A degenerate axis is scaled to a hair rather than to zero. A `mesh` with no
 * `depth` is extremely common — it is what a mesh dragged out of the inspector
 * with only two numbers typed into it looks like — and `scale: 0` on an axis
 * makes the normal matrix singular, which three.js renders as an unlit black
 * shape. A hair is visible, unmistakably flat, and shades correctly.
 */
export function Solid({ kind, size, nodeId, children, meshProps }: SolidProps) {
	const scale: [number, number, number] = [
		size[0] || HAIR,
		size[1] || HAIR,
		size[2] || HAIR,
	];
	return (
		<mesh {...meshProps} scale={scale} userData={{ nodeId }}>
			{GEOMETRY[kind]()}
			{children}
		</mesh>
	);
}

/**
 * A tenth of a renderer unit — a tenth of a CSS pixel.
 *
 * Small enough that nothing is ever visibly thicker than the document said, big
 * enough that a `float32` normal matrix stays well conditioned. Not zero, for
 * the reason above.
 */
const HAIR = 0.1;
