/**
 * The arithmetic a transform gizmo runs on, written as plain tuples so that it
 * can be checked with `node --test` and no browser in the room.
 *
 * ## Why this is a file and not four expressions inside the component
 *
 * A gizmo is three lines of geometry and a great many chances to get a sign
 * wrong, and every one of those chances is invisible in a screenshot: an axis
 * that drags backwards, a ring that turns the wrong way past ±90°, a handle that
 * tracks the pointer perfectly at the centre of the screen and drifts at the
 * edge. None of that shows up in a typecheck and all of it shows up in a test
 * that says "this ray, this axis, this answer". So the closest-point solve, the
 * ray/plane intersection and the angle-in-a-plane reading live here, take and
 * return numbers, and know nothing about three.js, React, EMU or the document.
 *
 * The component's job is then narrow and reviewable: read a world matrix, hand
 * these functions vectors, and cross the answer into EMU exactly once.
 *
 * ## What space everything here is in
 *
 * **three.js world space, in renderer units** — after `renderPoint`'s crossing,
 * never before it. There is no EMU in this file and no angle in thousandths of a
 * degree; angles are radians, because they come out of `atan2`. `units3.ts` is
 * the only module allowed to convert and the gizmo calls it at the very end,
 * once per drag increment, which is the same discipline the renderer keeps.
 *
 * ## The one convention worth stating twice
 *
 * Every direction handed in is expected to be **unit length**, and nothing here
 * normalises defensively. That is deliberate: a caller that passes an
 * unnormalised axis gets an answer scaled by its length, which is a bug that
 * shows up immediately as a handle moving at the wrong rate, rather than a
 * silent normalise that hides a matrix with a scale in it. The gizmo's own
 * matrices are rotation-only — `SceneTree` mounts groups with a position and a
 * rotation and never a scale — so the normalisation is a fact about the chain
 * rather than a hope, and `basisOf` in the component is where it is enforced.
 */

/** A vector or a point in three.js world space, in renderer units. */
export type Vec3 = readonly [number, number, number];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0],
];

export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/**
 * A direction as a unit vector, or `undefined` for one with no direction at all.
 *
 * `undefined` rather than a zero vector or a throw, because the only way to get
 * one here is a degenerate matrix, and every caller below already has an
 * "ignore this drag" branch for a ray that cannot answer.
 */
export function normalise(a: Vec3): Vec3 | undefined {
	const n = length(a);
	if (!Number.isFinite(n) || n < 1e-12) return undefined;
	return [a[0] / n, a[1] / n, a[2] / n];
}

/** A ray in world space: where the eye is, and which way the pointer looks. */
export interface Ray {
	origin: Vec3;
	/** Unit length. */
	direction: Vec3;
}

/**
 * How far along an axis the pointer is: the parameter `t` of the point on the
 * line `origin + t · direction` that comes nearest the ray.
 *
 * This is what a translate handle *is*. A pointer is a ray and an axis is a
 * line, the two almost never meet, and the honest reading of "where on this axis
 * is the mouse" is the point on the axis closest to the ray — which is also the
 * reading every other 3D tool uses, so a designer's hand already knows it.
 *
 * The textbook solve for the closest points of two skew lines, with one
 * simplification taken because both directions are unit: `A = C = 1`, so the
 * determinant is `1 − B²` where `B` is the cosine of the angle between the axis
 * and the view ray. That cosine is also the whole failure mode, and it is why
 * this returns `undefined` rather than a number: **an axis seen end-on has no
 * answer.** As `B` approaches ±1 the two lines become parallel, the determinant
 * goes to zero, and `t` runs off to infinity — which on screen is a handle that
 * teleports the moment you orbit until an arrow points at your eye. Refusing is
 * the behaviour that reads as correct; a clamp would read as a glitch.
 *
 * The threshold is on the determinant rather than on the angle because that is
 * the quantity that is actually about to be divided by. `1 − B² < 1e-4` is about
 * 0.6° of separation, which is far tighter than any axis a designer can point at
 * deliberately and far looser than where `float64` starts to hurt.
 */
export function closestOnAxis(
	ray: Ray,
	axisOrigin: Vec3,
	/** Unit length. */
	axisDirection: Vec3,
): number | undefined {
	const w = sub(axisOrigin, ray.origin);
	const b = dot(axisDirection, ray.direction);
	const determinant = 1 - b * b;
	if (determinant < 1e-4) return undefined;
	const d = dot(axisDirection, w);
	const e = dot(ray.direction, w);
	return (b * e - d) / determinant;
}

/**
 * Where a ray meets a plane, or nothing when it does not.
 *
 * "Does not" covers two cases and they are deliberately one answer. A ray
 * parallel to the plane never meets it; a ray that meets it *behind the eye*
 * meets a plane the viewer cannot see, which for a rotation handle means the
 * pointer has crossed the horizon of the ring's own plane and the angle there is
 * a reflection of the angle here. Both are "no reading this frame", and a gizmo
 * that holds its last angle for a frame is invisible where one that jumps by
 * half a turn is not.
 *
 * `normal` need not be unit length for the intersection itself — the two dot
 * products scale together — but it is required unit anyway, because the caller
 * derives the in-plane basis from the same matrix column and a normal that is
 * not unit means a basis that is not orthonormal, which `angleInPlane` does
 * quietly wrong rather than loudly.
 */
export function intersectPlane(
	ray: Ray,
	planePoint: Vec3,
	/** Unit length. */
	normal: Vec3,
): Vec3 | undefined {
	const facing = dot(ray.direction, normal);
	if (Math.abs(facing) < 1e-6) return undefined;
	const t = dot(sub(planePoint, ray.origin), normal) / facing;
	if (!(t > 0)) return undefined;
	return add(ray.origin, scale(ray.direction, t));
}

/**
 * The angle of a point around a centre, read in a plane's own basis: radians,
 * in `(−π, π]`, measured from `u` toward `v`.
 *
 * `u` and `v` must be orthonormal, and the rotation this angle describes is the
 * right-handed one about `u × v`. That cross product is the whole contract
 * between this function and the component: the component picks `u` and `v` so
 * that `u × v` is the axis the document's angle turns about, *after* the
 * crossing into three.js — see `TransformGizmo.tsx`'s table, which is where the
 * two sign flips `worldEuler` describes are cashed in.
 *
 * A point exactly at the centre gives `atan2(0, 0)`, which is `0` rather than
 * `NaN` in every JavaScript engine, and a drag that starts and stays there
 * therefore reads as no rotation at all. That is the right answer and it is
 * worth not "fixing": the centre of a ring is the one place on it where no angle
 * exists, and returning zero means the handle simply does not move until the
 * pointer leaves it.
 */
export function angleInPlane(point: Vec3, centre: Vec3, u: Vec3, v: Vec3): number {
	const d = sub(point, centre);
	return Math.atan2(dot(d, v), dot(d, u));
}

/**
 * A signed angular difference, taken the short way round.
 *
 * A rotation drag reads an absolute angle every frame and wants the change since
 * the last frame. Subtracting two `atan2` readings gives a number that is right
 * except when the pointer crosses the branch cut at ±π, where it is wrong by a
 * whole turn — which on screen is an object that spins 360° backwards the moment
 * the pointer passes the ring's west point. Wrapping into `(−π, π]` fixes it,
 * and is correct as long as no single frame turns the handle more than half a
 * turn. At sixty frames a second that is a pointer moving faster than a screen
 * is wide, so the assumption is safe; and where it is not, the failure is one
 * frame of the wrong direction rather than a permanent offset.
 */
export function angleDelta(to: number, from: number): number {
	let d = (to - from) % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d <= -Math.PI) d += Math.PI * 2;
	return d;
}

/**
 * How big to draw the gizmo so that it covers a constant number of screen
 * pixels: the world size one pixel spans, at a given distance, through a given
 * lens.
 *
 * A gizmo drawn in world units is unusable in this system for a reason that is
 * specific to it rather than general: a document's lengths are EMU and a
 * viewport can be a 40px thumbnail or a 4000px hero, so a handle sized to look
 * right on one is a speck or a wall on the other. Sizing it in *pixels* makes it
 * the same object to the hand everywhere, which is what a tool handle has to be.
 *
 * The arithmetic is the perspective camera's own: the visible height at distance
 * `d` is `2 · d · tan(fov / 2)`, so one pixel of a `viewHeight`-pixel canvas is
 * that divided by `viewHeight`. Multiply by however many pixels the gizmo should
 * be and that is the scale its group takes.
 *
 * **Perspective only, deliberately.** Every camera this package mounts is a
 * `PerspectiveCamera` — the document's `camera` kind has `fov`, the framing
 * fallback has one and so does the review camera — so there is no orthographic
 * case to get wrong. The day one exists, its answer is `(top − bottom) / zoom /
 * viewHeight` with no distance in it at all, and it belongs here beside this.
 */
export function pixelSize(
	/** Distance from the eye to the gizmo, in renderer units. */
	distance: number,
	/** Vertical field of view, in **degrees**, as three.js and `Lens` hold it. */
	fov: number,
	/** The canvas's height in CSS pixels. */
	viewHeight: number,
): number {
	const half = (Math.max(fov, 1e-3) * Math.PI) / 360;
	return (2 * Math.max(distance, 1e-6) * Math.tan(half)) / Math.max(viewHeight, 1);
}

/**
 * A value snapped to the nearest multiple of a step, or left exactly as it is
 * when the step is zero.
 *
 * Zero means "do not snap" rather than being a division by zero waiting to
 * happen, because that is how the caller uses it: the snap step is `0` unless
 * Shift is held, and a branch at the call site would put the modifier key in two
 * places. Ties go away from zero, matching `writeLength` and `writeAngle`, so a
 * snapped drag and a typed number land on the same lattice.
 */
export function snapTo(value: number, step: number): number {
	if (!(step > 0)) return value;
	const n = value / step;
	return (n < 0 ? -Math.round(-n) : Math.round(n)) * step;
}
