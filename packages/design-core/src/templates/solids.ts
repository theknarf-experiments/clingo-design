import { deep, frame, marker, mesh, rect, text, view, withToken } from "./shared.ts";
import { RULES_HEADER, type Scene, type SceneNode, starterTokens } from "../scene.ts";
import { lit, ref, single } from "../values.ts";

/** The four accents, in the order the Variables panel lists them. */
const ACCENTS = ["#3b82f6", "#f97316", "#10b981", "#a855f7"] as const;

/**
 * A row of solids in a 3D view — and **exactly as many designs as the same page
 * with the view cut out of it**.
 *
 * That clause is this template's whole argument, and it is deliberately the same
 * shape as the one `machine` makes about states. Every other tool that grows a
 * third dimension grows a second document beside the first: a scene graph with
 * its own node type, its own selection, its own transform inspector and its own
 * file format, sitting next to the page and sharing nothing with it. Then the
 * question a designer actually asks — "is the cube still lined up with the
 * headline?" — becomes unaskable, because the cube and the headline are in two
 * different documents and nothing can relate them.
 *
 * Here a mesh is a `node/1` with a `kind/2`, a `child/2`, an `order/2`, a
 * `visible/1` and a `frame/3`. Which is to say: the layer list already knew what
 * to do with it, hit testing already knew, the undo stack already knew, and the
 * rules panel already knew. Nothing below was written for three dimensions —
 * what was written is a third axis for the things that already existed.
 *
 * The four claims, in the order the document makes them:
 *
 *   - **A solid is in the layer list and in the tree.** `cube`, `ball` and
 *     `post` are children of `stage` the way `swatch` is a child of `page`.
 *     Select one, hide it, drag it up the list, put it inside the pivot: every
 *     one of those is the gesture it already was.
 *
 *   - **A rule may name one.** `row` is an ordinary `align` over three meshes on
 *     `centerY`, with a name, a switch, a strength and a place in an unsat core.
 *     `gap1` and `gap2` hold the run 8px apart through a `spacing` token, which
 *     is `rail`'s design table one axis over. Nothing about these three rules
 *     knows it is looking at geometry rather than at rectangles.
 *
 *   - **A solid is in the multiverse.** The meshes paint from `accent`, which
 *     holds four colours — so does the swatch on the right, so all five things
 *     repaint together and the document is four designs. The view *joins* the
 *     design space rather than multiplying it, which is what `solids.test.ts`
 *     asserts by deleting the whole view and counting again.
 *
 *   - **What the third axis cannot do, it refuses out loud.** `ring` is turned
 *     70 degrees about X. Its centre and its width are still exact — a rotation
 *     is about the node's own centre, which is what keeps every centre and every
 *     span an honest linear quantity — but its *faces* are nowhere a linear
 *     solver can put them, so `gnoedge/2` refuses an `align` on its left edge
 *     rather than satisfying it with a box the document does not contain. The
 *     Inspector says so under "Rules that say nothing". That is why the row is
 *     aligned on `centerY` and why `ring` is in no rule at all.
 *
 * The two lamps and the eye are the same kind of node again, and the asymmetry
 * between them is worth knowing: hiding the light puts the scene out, because
 * `visible/1` governs a lamp; hiding the camera stops the editor drawing its
 * marker and does **not** stop the view looking through it, because `vcam/2`
 * never asks. "Hidden" means "not drawn", and what a camera contributes to the
 * picture was never pixels.
 */
export function solids(): Scene {
	/**
	 * The scene, in the viewport's own space.
	 *
	 * Coordinates are parent-relative here exactly as they are on the page —
	 * `x` and `y` are the planar two, and `z` and `depth` are the third axis
	 * through {@link deep}. Sparse: `floor` says nothing about `z`, so it is on
	 * the origin plane, and it holds no `spatial` key for it rather than holding
	 * a zero.
	 */
	const stage: SceneNode[] = [
		// Where the view looks from: back along the negative axis by the height of
		// the frame, on the middle of the origin plane. A field on the viewport
		// rather than a value, because which eye a view uses is structure.
		deep(marker("camera", "eye", "Camera", [200, 128], { fov: single("45deg") }), {
			z: -256,
		}),
		// Two lamps, because one is a silhouette and none is a black rectangle
		// that reads as a broken renderer. The key light is turned, which is what
		// gives a directional lamp a direction at all.
		deep(
			marker("light", "key", "Key light", [96, 40], {
				lamp: single("directional"),
				ink: single("#ffffff"),
				intensity: single("2"),
			}),
			{ z: -160 },
			{ rotateX: 35, rotateY: -25 },
		),
		// Its colour is `ink` — "the colour the thing itself is" — so a brand
		// palette lights the scene with nothing wired up. This one names a token.
		marker("light", "wash", "Fill light", [304, 40], {
			lamp: single("ambient"),
			ink: [ref("muted")],
			intensity: single("0.6"),
		}),
		// A plane stood on its edge is a wall; turned a quarter turn about X it is
		// the ground the row stands on. The rotation is the whole difference, and
		// it is one number on an ordinary node.
		deep(
			mesh("floor", "Floor", [40, 150, 320, 96], {
				solid: single("plane"),
				fill: [ref("muted")],
				roughness: single("0.9"),
			}),
			{ z: 46, depth: 4 },
			{ rotateX: 90 },
		),
		...[
			["cube", "Cube", 54, "box"],
			["ball", "Ball", 154, "sphere"],
			["post", "Post", 254, "cylinder"],
		].map(([id, name, x, solid]) =>
			// Drawn at the answer the rules give, so the document reads the same as
			// the universe it opens on — `rail`'s convention, and the solver owns
			// these coordinates either way.
			deep(
				mesh(id as string, name as string, [x as number, 92, 92, 92], {
					solid: single(solid as string),
					fill: [ref("accent")],
					roughness: single("0.35"),
					metalness: single("0.1"),
				}),
				{ depth: 92 },
			),
		),
		// The turned one, and the reason it is in no rule: see the note above.
		deep(
			mesh("ring", "Ring", [154, 16, 92, 60], {
				solid: single("torus"),
				fill: [ref("subtle")],
				roughness: single("0.25"),
				metalness: single("0.6"),
			}),
			{ z: -40, depth: 60 },
			{ rotateX: 70 },
		),
	];

	return {
		// Four accents rather than one, so there is a design space for the view to
		// join rather than to create. Every mesh in the row and the flat swatch
		// beside them read this one token, which is what makes "the solids repaint
		// with the page" a fact about the document rather than a coincidence.
		tokens: [
			...withToken(starterTokens(), "accent", ACCENTS.map(lit)),
			// One value: a parameter need not vary to be one. Give it three and the
			// row spreads at all three, which is `rail` with solids in it.
			{ id: "spacing", name: "spacing", type: "length", value: single("8px") },
		],
		styles: [],
		machines: [],
		nodes: [
			frame("page", "Page", [0, 0, 720, 420], { fill: [ref("surface")] }, [
				text("title", "Title", [40, 32, 640, 28], "Three dimensions, one document", {
					ink: [ref("ink")],
					size: single("20px"),
					weight: single("700"),
				}),
				text(
					"caption",
					"Caption",
					[40, 64, 400, 48],
					"A solid is a node. It is in the layer list, a rule can name it, and it repaints with the page — because there is no second document for it to live in.",
					{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
				),
				view(
					"stage",
					"3D view",
					[40, 124, 400, 256],
					"eye",
					{ fill: single("#0b1020"), radius: [ref("radius")] },
					stage,
				),
				// The flat half of the argument. It paints from the same token the
				// meshes do, so deleting the view leaves the design space exactly
				// where it was — which is the assertion in `solids.test.ts`.
				rect("swatch", "Swatch", [472, 124, 208, 150], {
					fill: [ref("accent")],
					radius: [ref("radius")],
				}),
				text(
					"note",
					"Note",
					[472, 290, 208, 90],
					"The swatch and the three solids read one variable. Four colours, four designs — the same four the page had before the view existed.",
					{ ink: [ref("subtle")], size: single("12px"), weight: single("400") },
				),
			]),
		],
		constraints: [
			{
				// A centre, not a face — and on a row of unturned solids either would
				// have worked. The choice is stated because the moment somebody turns
				// one of these, only this one goes on meaning something.
				id: "row",
				kind: "align",
				prop: "fill",
				nodes: ["cube", "ball", "post"],
				edge: "centerY",
				enabled: true,
			},
			{
				id: "gap1",
				kind: "gap",
				prop: "fill",
				nodes: ["cube", "ball"],
				edge: "x",
				value: [ref("spacing")],
				enabled: true,
			},
			{
				id: "gap2",
				kind: "gap",
				prop: "fill",
				nodes: ["ball", "post"],
				edge: "x",
				value: [ref("spacing")],
				enabled: true,
			},
		],
		rules: `${RULES_HEADER}
% A mesh, a camera and a light are ordinary scene nodes, so everything below is
% the vocabulary that was already here. Nothing needs adding; these are the
% things worth trying.
%
%   - Give the "accent" token a fifth colour in the Variables panel. Five
%     designs, and the solids repaint with the swatch. Then delete the whole 3D
%     view and count again: still five. A view joins the design space; it does
%     not multiply it.
%
%   - Give "Ball" a second Solid word in the Inspector. *Now* the count doubles,
%     because that really is a design decision — a 3D object is in the multiverse
%     on exactly the same terms as a fill.
%
%   - Hide "Fill light" in the layer list. The scene goes dim, because a lamp is
%     governed by visible/1 like everything else. Hide "Camera" and the view
%     keeps looking: vcam/2 never asks about hidden/1, because what a camera
%     contributes to the picture was never pixels.
%
%   - Add an Align on "left" over Cube and Ring. Nothing happens, and the
%     Inspector says why: Ring is turned, so its faces are nowhere a linear
%     solver can put them and gnoedge/2 refuses the edge rather than satisfying
%     it with a box this document does not contain. Set Ring's "Turn about X"
%     back to 0deg and the same rule bites immediately.
%
% The third axis is one narrow gate. Every rule for it is generated always, and
% grounds to nothing at all unless some node states a z, a depth or a turn:
%
%   - s3(N).            N is in the third axis, so it has six numbers, not four.
%   - zstated(N).       the document said where N is on the third axis.
%   - grotated(N).      N is turned, so its faces are refused and its centre is not.
%   - gnoedge(N,E).     N has no quantity E, so a rule naming it is inert.
%
% Try it: :- s3(N), not visible(N).  — "nothing in the scene may be hidden".
% Or reach across the seam, which is exact about model space and silent about
% pixels, and which the panel warns about for that reason:
%   &sum{ wv(cube,centerX); -wv(swatch,centerX) } = 0.
%
% Both sides of a theory comparison are one theory atom, not two: the sum goes
% in the braces and the right-hand side is a plain term. Writing it as
% "&sum{..} = &sum{..}" is a syntax error and the document stops solving
% altogether, which is why the difference is spelled out here rather than left
% for a paste to discover.
`,
	};
}
