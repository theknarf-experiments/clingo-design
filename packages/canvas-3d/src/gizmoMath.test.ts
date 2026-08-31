/**
 * The gizmo's arithmetic, checked with no browser in the room.
 *
 * These are the assertions a screenshot cannot make. A gizmo that drags
 * backwards, a ring that jumps a whole turn at its west point, a handle that
 * tracks perfectly at the centre of the screen and drifts at the edge — every
 * one of those typechecks and every one of them is a number here.
 *
 * The cases are built from rays whose answer can be written down by hand, so
 * that a failure names an arithmetic mistake rather than a disagreement between
 * two pieces of the same code. Where a case is "obviously" symmetric it is still
 * written out in both directions, because the sign flips in this package — y and
 * z, twice over, once for points and once for rotations — are exactly the kind
 * of thing that is right in one direction and wrong in the other.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type Ray,
	type Vec3,
	angleDelta,
	angleInPlane,
	closestOnAxis,
	cross,
	intersectPlane,
	normalise,
	pixelSize,
	snapTo,
} from "./gizmoMath.ts";

const close = (a: number, b: number, why = "") =>
	assert.ok(Math.abs(a - b) < 1e-9, `${why} expected ${b}, got ${a}`);

const ray = (origin: Vec3, through: Vec3): Ray => {
	const direction = normalise([
		through[0] - origin[0],
		through[1] - origin[1],
		through[2] - origin[2],
	]);
	assert.ok(direction, "a ray needs a direction");
	return { origin, direction };
};

/* ------------------------------------------------------------------ */
/* Translating along an axis                                           */
/* ------------------------------------------------------------------ */

test("an axis reads the parameter of the point nearest the ray", () => {
	// The x axis through the origin, and a ray straight down the −z direction
	// aimed at (7, 0, 0). The nearest point is the one it passes through.
	const t = closestOnAxis(ray([7, 0, 10], [7, 0, 0]), [0, 0, 0], [1, 0, 0]);
	assert.ok(t !== undefined);
	close(t, 7, "on the axis");

	// Skew: the same ray offset in y never meets the axis at all, and the answer
	// is still 7 — which is the whole point of asking for the *nearest* point
	// rather than for an intersection.
	const skew = closestOnAxis(ray([7, 4, 10], [7, 4, 0]), [0, 0, 0], [1, 0, 0]);
	assert.ok(skew !== undefined);
	close(skew, 7, "skew");
});

test("an axis is measured from its own origin and in its own direction", () => {
	// An axis that starts at (0, 0, 0) but points the other way answers with the
	// negated parameter, which is what makes the direction table in
	// `TransformGizmo` — document y is three's −Y — a sign and not a special case.
	const forward = closestOnAxis(ray([3, 0, 10], [3, 0, 0]), [0, 0, 0], [1, 0, 0]);
	const backward = closestOnAxis(ray([3, 0, 10], [3, 0, 0]), [0, 0, 0], [-1, 0, 0]);
	assert.ok(forward !== undefined && backward !== undefined);
	close(forward, 3);
	close(backward, -3);

	// And it is measured from the axis's origin, not from the world's: an axis
	// anchored at the node's centre reports travel relative to that centre, which
	// is what makes a drag a delta.
	const moved = closestOnAxis(ray([3, 0, 10], [3, 0, 0]), [10, 0, 0], [1, 0, 0]);
	assert.ok(moved !== undefined);
	close(moved, -7);
});

test("an axis pointing at the eye has no answer, and says so", () => {
	// Exactly end-on. The two lines are parallel, the determinant is zero, and a
	// number here would be an infinity — on screen, a handle that teleports.
	assert.equal(closestOnAxis(ray([0, 0, 10], [0, 0, 0]), [0, 0, 0], [0, 0, 1]), undefined);
	// A hair off end-on is still refused: the threshold is on the determinant,
	// which is about 0.6° of separation.
	const nearly = normalise([0, 0.005, 1]);
	assert.ok(nearly);
	assert.equal(closestOnAxis(ray([0, 0, 10], [0, 0, 0]), [0, 0, 0], nearly), undefined);
	// A degree and a half off is fine, and the answer is finite.
	const off = normalise([0, 0.03, 1]);
	assert.ok(off);
	const t = closestOnAxis(ray([0, 0, 10], [0, 0, 0]), [0, 0, 0], off);
	assert.ok(t !== undefined && Number.isFinite(t));
});

/* ------------------------------------------------------------------ */
/* Turning in a plane                                                  */
/* ------------------------------------------------------------------ */

test("a ray meets a plane in front of it and not behind it", () => {
	const hit = intersectPlane(ray([1, 2, 10], [1, 2, 0]), [0, 0, 0], [0, 0, 1]);
	assert.ok(hit);
	close(hit[0], 1);
	close(hit[1], 2);
	close(hit[2], 0);

	// Aimed away: the plane is behind the eye. One answer for both refusals —
	// parallel and behind — because both mean "no reading this frame".
	assert.equal(intersectPlane(ray([1, 2, 10], [1, 2, 20]), [0, 0, 0], [0, 0, 1]), undefined);
	// Parallel.
	assert.equal(intersectPlane(ray([1, 2, 10], [5, 2, 10]), [0, 0, 0], [0, 0, 1]), undefined);
});

test("an angle is measured from u toward v, right-handed about u cross v", () => {
	const u: Vec3 = [1, 0, 0];
	const v: Vec3 = [0, 1, 0];
	// u x v is +z, so this is the ordinary xy plane seen from +z.
	assert.deepEqual(cross(u, v), [0, 0, 1]);
	close(angleInPlane([1, 0, 0], [0, 0, 0], u, v), 0, "at u");
	close(angleInPlane([0, 1, 0], [0, 0, 0], u, v), Math.PI / 2, "at v");
	close(angleInPlane([-1, 0, 0], [0, 0, 0], u, v), Math.PI, "opposite u");
	close(angleInPlane([0, -1, 0], [0, 0, 0], u, v), -Math.PI / 2, "opposite v");
	// Off the origin, so a ring centred on a node reads the same angles.
	close(angleInPlane([11, 10, 0], [10, 10, 0], u, v), 0, "shifted");
});

test("swapping u and v flips the axis and therefore the sign of every movement", () => {
	// This is the property `TransformGizmo`'s ring table depends on: the two
	// columns it picks are chosen so that `u x v` is the *crossed* document axis,
	// which is what makes the measured movement the document's own delta with no
	// sign applied afterwards. If swapping did not flip, the table would be
	// arbitrary.
	//
	// It is the **delta** that flips and not the reading. Swapping the basis is a
	// reflection, so `atan2(x, y)` is `pi/2 - atan2(y, x)`: the absolute angles
	// are mirrored about 45 degrees rather than negated, and only their rate of
	// change is negated. Since a drag reads deltas and never an absolute angle,
	// that is exactly the property it needs — and writing it out this way is why
	// this test exists rather than the tidier-looking one about a single point.
	const u: Vec3 = [1, 0, 0];
	const v: Vec3 = [0, 1, 0];
	assert.deepEqual(cross(u, v), [0, 0, 1]);
	assert.deepEqual(cross(v, u), [0, 0, -1]);
	const at = (deg: number): Vec3 => [
		Math.cos((deg * Math.PI) / 180),
		Math.sin((deg * Math.PI) / 180),
		0,
	];
	const centre: Vec3 = [0, 0, 0];
	const forward = angleDelta(
		angleInPlane(at(50), centre, u, v),
		angleInPlane(at(30), centre, u, v),
	);
	const backward = angleDelta(
		angleInPlane(at(50), centre, v, u),
		angleInPlane(at(30), centre, v, u),
	);
	close(forward, (20 * Math.PI) / 180, "u toward v");
	close(backward, (-20 * Math.PI) / 180, "v toward u");
});

test("an angle delta takes the short way round, across the branch cut", () => {
	// The failure this prevents: a pointer crossing the ring's west point reads
	// +pi one frame and -pi the next, and a plain subtraction is a whole turn
	// backwards.
	close(angleDelta(-Math.PI + 0.1, Math.PI - 0.1), 0.2, "westward");
	close(angleDelta(Math.PI - 0.1, -Math.PI + 0.1), -0.2, "eastward");
	close(angleDelta(0.3, 0.1), 0.2, "ordinary");
	close(angleDelta(0.1, 0.3), -0.2, "ordinary, back");
	// Exactly half a turn resolves one way rather than oscillating: the interval
	// is (-pi, pi], so +pi is +pi and never -pi.
	close(angleDelta(Math.PI, 0), Math.PI);
	close(angleDelta(0, Math.PI), Math.PI);
});

test("accumulating deltas unwraps past a whole turn", () => {
	// A ring dragged twice round has to report two turns, not zero. That is the
	// reason the drag keeps a running total rather than subtracting the current
	// angle from the starting one — and `turnWritten` never wraps it either, so
	// 720deg stays 720deg in the document.
	let last = 0;
	let turned = 0;
	for (let i = 1; i <= 40; i++) {
		const now = ((i * Math.PI) / 10 + Math.PI) % (2 * Math.PI) - Math.PI;
		turned += angleDelta(now, last);
		last = now;
	}
	close(turned, 4 * Math.PI, "two whole turns");
});

/* ------------------------------------------------------------------ */
/* Sizing and snapping                                                 */
/* ------------------------------------------------------------------ */

test("one pixel spans more world the further away it is, in proportion", () => {
	const near = pixelSize(100, 50, 600);
	const far = pixelSize(200, 50, 600);
	close(far, near * 2, "twice as far is twice as big");
	// The geometry itself: the visible height at distance d is 2 d tan(fov/2).
	close(pixelSize(100, 90, 600), (2 * 100 * Math.tan(Math.PI / 4)) / 600);
	// A degenerate canvas does not divide by zero, and a camera exactly on the
	// gizmo does not return zero — both would be a gizmo that vanishes.
	assert.ok(Number.isFinite(pixelSize(0, 50, 0)));
	assert.ok(pixelSize(0, 50, 600) > 0);
});

test("snapping is off at zero and ties go away from zero", () => {
	close(snapTo(3.7, 0), 3.7, "no step");
	close(snapTo(-3.7, 0), -3.7, "no step");
	close(snapTo(11, 8), 8);
	close(snapTo(13, 8), 16);
	close(snapTo(-11, 8), -8);
	close(snapTo(-13, 8), -16);
	// The tie, in both directions — the rule `writeLength` and `writeAngle` keep.
	close(snapTo(12, 8), 16);
	close(snapTo(-12, 8), -16);
});

test("a direction with no length is refused rather than normalised to nothing", () => {
	assert.equal(normalise([0, 0, 0]), undefined);
	assert.equal(normalise([Number.NaN, 0, 0]), undefined);
	const unit = normalise([0, 3, 4]);
	assert.ok(unit);
	close(unit[1], 0.6);
	close(unit[2], 0.8);
});
