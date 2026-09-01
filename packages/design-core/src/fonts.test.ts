/**
 * A font is a file the document declares, and the compiler never hears about it.
 *
 * Two groups, and the second is the one that must not be allowed to rot. The
 * first is the ordinary reading of a roster — what a family is, what a stack
 * says, what the strip takes out of one. The second is the whole architectural
 * claim of this feature written as three assertions: **adding a font changes no
 * program, mints no alternative and adds no universe.** That claim is not held
 * up by a rule somebody wrote to hold it; it is true because `Scene.fonts` is a
 * declaration no part of `compile.ts` opens. Which is exactly why it is asserted
 * here rather than believed — the day somebody adds a `famof/2` bridge, one of
 * these three fails and says why.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { compile } from "./compile.ts";
import { directSolver } from "./directSolver.ts";
import { addFont, removeFont } from "./edits.ts";
import { explore } from "./explore.ts";
import {
	familiesOf,
	familyLabel,
	familyOf,
	fontFamilies,
	fontPaths,
	fontStack,
	fontTotalBytes,
	missingFonts,
	paintedStack,
	quoteFamily,
	usedFamilies,
} from "./fonts.ts";
import { normalizeScene } from "./project.ts";
import type { FontFile, Scene } from "./scene.ts";
import { card } from "./templates/card.ts";
import { typography } from "./templates/typography.ts";

/** One variable face, the shape a `.woff2` upload lands in. */
const inter: FontFile = {
	src: "/assets/InterVariable.woff2",
	family: "Inter Var",
	weight: "100 900",
	style: "normal",
	bytes: 253_000,
	name: "InterVariable.woff2",
};

/** A second family, so "which of them" is a question with an answer. */
const fraunces: FontFile = {
	src: "/assets/Fraunces.ttf",
	family: "Fraunces",
	weight: "100 900",
	style: "normal",
	bytes: 612_000,
	name: "Fraunces.ttf",
	axes: [{ tag: "wght", min: 100, max: 900, def: 400 }],
};

/** Two static files that are one typeface — the case a path could not name. */
const mono: FontFile[] = [
	{
		src: "/assets/Mono-Regular.woff2",
		family: "Studio Mono",
		weight: "400",
		style: "normal",
		bytes: 40_000,
		name: "Mono-Regular.woff2",
	},
	{
		src: "/assets/Mono-Bold.woff2",
		family: "Studio Mono",
		weight: "700",
		style: "normal",
		bytes: 41_000,
		name: "Mono-Bold.woff2",
	},
];

const withFonts = (scene: Scene, fonts: FontFile[]): Scene => ({ ...scene, fonts });

/* ------------------------------------------------------------------ */
/* What a roster says                                                  */
/* ------------------------------------------------------------------ */

test("a declared font is a family and a file, and the file is a path", () => {
	const scene = withFonts(card(), [inter]);
	assert.deepEqual(fontPaths(scene), ["/assets/InterVariable.woff2"]);
	assert.equal(fontTotalBytes(scene), 253_000);
	// The family is what a value names; the path is where the bytes are. Two
	// different questions, and the roster is the only place they meet.
	assert.deepEqual([...fontFamilies(scene).keys()], ["Inter Var"]);
});

test("two files agreeing on a family are one family with two faces", () => {
	const scene = withFonts(card(), mono);
	const families = fontFamilies(scene);
	assert.equal(families.size, 1);
	assert.deepEqual(
		families.get("Studio Mono")?.map((f) => f.weight),
		["400", "700"],
	);
	// And the total is per file, because two faces are two downloads.
	assert.equal(fontTotalBytes(scene), 81_000);
});

test("a stack's first family is what a menu calls it", () => {
	assert.equal(familyOf('"Inter Var", system-ui'), "Inter Var");
	assert.equal(familyOf("Georgia, serif"), "Georgia");
	assert.equal(familyOf('"Fira Code", monospace'), "Fira Code");
	assert.equal(familyOf(""), undefined);
	// A comma inside quotes is part of the name and not a separator, which is the
	// whole reason this is a parse rather than a split.
	assert.deepEqual(familiesOf('"Goudy, Old Style", serif'), [
		"Goudy, Old Style",
		"serif",
	]);
	// And a value on no list still reads as something a person recognises.
	assert.equal(familyLabel('"Inter Var", system-ui, sans-serif'), "Inter Var");
	assert.equal(familyLabel(""), "");
});

test("a family name is quoted exactly when CSS needs it to be", () => {
	assert.equal(quoteFamily("Georgia"), "Georgia");
	assert.equal(quoteFamily("Inter Var"), '"Inter Var"');
	// A leading digit is not an identifier, and an unquoted one is a declaration
	// the browser drops without a word.
	assert.equal(quoteFamily("2Tone"), '"2Tone"');
	assert.equal(fontStack("Inter Var", "system-ui, sans-serif"), '"Inter Var", system-ui, sans-serif');
});

test("a family the host has not loaded is taken out of the stack, wherever it sits", () => {
	const unloaded = new Set(["Inter Var", "Fraunces"]);
	// Leading.
	assert.equal(
		paintedStack('"Inter Var", system-ui, sans-serif', unloaded),
		"system-ui, sans-serif",
	);
	// In the middle, which is the occurrence a leading-only strip would miss —
	// and missing it is a hole in the invariant, because the same stack before
	// and after the face lands would key identically.
	assert.equal(
		paintedStack('"Inter", Georgia, "Fraunces", serif', unloaded),
		'Inter, Georgia, serif',
	);
	// Trailing.
	assert.equal(paintedStack('Georgia, "Fraunces"', unloaded), "Georgia");
	// Nothing declared, nothing to strip: the stack is returned as it was
	// written, byte for byte, so a document with no fonts keys as it always did.
	assert.equal(
		paintedStack('"Inter Var", system-ui', new Set()),
		'"Inter Var", system-ui',
	);
});

test("a stack the strip empties still names a font the engine can parse", () => {
	// The one guess in the module, and it is asserted so nobody quietly makes it
	// `""`: a canvas handed an unparseable `font` shorthand keeps whatever it had,
	// which for a fresh context is `10px sans-serif` — a box wrong by a factor
	// rather than by a face, and wrong silently.
	assert.equal(paintedStack('"Inter Var"', new Set(["Inter Var"])), "serif");
});

test("a system family is never taken out, loaded or not", () => {
	// `Georgia` is in no `Scene.fonts`, so it is in no `unloaded` set — whether the
	// reader's machine has it is not knowable and never was, and this does not
	// pretend to improve on that.
	const unloaded = new Set(["Inter Var"]);
	assert.equal(paintedStack("Georgia, Cambria, serif", unloaded), "Georgia, Cambria, serif");
});

test("a font whose file the project does not hold is named by its path", () => {
	const scene = withFonts(card(), [fraunces, inter]);
	assert.deepEqual(
		missingFonts(scene, ["/assets/InterVariable.woff2"]).map((f) => f.src),
		["/assets/Fraunces.ttf"],
	);
	// Sorted, so a panel listing them twice lists them in the same order twice.
	assert.deepEqual(missingFonts(scene, []).map((f) => f.src), [
		"/assets/Fraunces.ttf",
		"/assets/InterVariable.woff2",
	]);
	assert.deepEqual(missingFonts(card(), []), []);
});

test("adding a font is idempotent on the path, and removing one leaves the file", () => {
	const one = addFont(card(), inter);
	// The same path twice is one declaration, or the panel's descriptor fields
	// would double the roster every time somebody corrected a weight.
	const again = addFont(one, { ...inter, weight: "400" });
	assert.equal(again.fonts?.length, 1);
	assert.equal(again.fonts?.[0].weight, "400");
	// And "no fonts" keeps one spelling on the way back out.
	assert.equal(removeFont(again, inter.src).fonts, undefined);
	// A path the roster does not hold changes nothing, identity included.
	const untouched = removeFont(again, "/assets/nothing.woff2");
	assert.equal(untouched, again);
});

test("a roster survives being written and read back, and a broken row does not take the rest with it", () => {
	const scene = withFonts(card(), [inter, fraunces]);
	const round = normalizeScene(JSON.parse(JSON.stringify(scene)));
	assert.deepEqual(round.fonts, [inter, fraunces]);
	// A row with no `src` names no bytes and a row with no `family` names nothing
	// a value could point at; both drop, and the good one stays.
	const damaged = normalizeScene({
		...JSON.parse(JSON.stringify(scene)),
		fonts: [{ family: "Nameless" }, { src: "/assets/x.woff2" }, inter],
	});
	assert.deepEqual(damaged.fonts?.map((f) => f.src), [inter.src]);
	// And a descriptor CSS can default is defaulted rather than dropped.
	const bare = normalizeScene({
		...JSON.parse(JSON.stringify(card())),
		fonts: [{ src: "/assets/x.woff2", family: "X" }],
	});
	assert.deepEqual(bare.fonts, [
		{ src: "/assets/x.woff2", family: "X", weight: "400", style: "normal", bytes: 0, name: "/assets/x.woff2" },
	]);
	// A document written before the field existed still writes no key.
	assert.equal(normalizeScene(JSON.parse(JSON.stringify(card()))).fonts, undefined);
});

test("an axis comes back out as three numbers, whatever the file on disk said", () => {
	// A normalizer that only *tested* the bounds would let `min: "100"` through by
	// reference into a field typed `number`, and the lie would print correctly in
	// the panel right up until somebody did arithmetic on it. A row whose tag is
	// missing is not an axis at all and goes, without taking the good one with it.
	const round = normalizeScene({
		...JSON.parse(JSON.stringify(card())),
		fonts: [
			{
				...fraunces,
				axes: [
					{ tag: "wght", min: "100", max: "900", def: "400" },
					{ min: 75, max: 125, def: 100 },
				],
			},
		],
	});
	assert.deepEqual(round.fonts?.[0].axes, [
		{ tag: "wght", min: 100, max: 900, def: 400 },
	]);
	// `deepEqual` is not enough on its own here: `"100"` and `100` are not deeply
	// equal, but it is the *type* that the rest of the system is entitled to.
	const axis = round.fonts?.[0].axes?.[0];
	assert.equal(typeof axis?.min, "number");
	assert.equal(typeof axis?.max, "number");
	assert.equal(typeof axis?.def, "number");
	// And a roster whose every axis row is rubbish declares no axes rather than an
	// empty list — the same rule the field itself keeps.
	const none = normalizeScene({
		...JSON.parse(JSON.stringify(card())),
		fonts: [{ ...fraunces, axes: [{ tag: "wght", min: "wide" }] }],
	});
	assert.equal(none.fonts?.[0].axes, undefined);
});

/* ------------------------------------------------------------------ */
/* The invariant group                                                 */
/* ------------------------------------------------------------------ */

test("the generated program is byte-identical with and without a font roster", () => {
	// Every template, not one, because the claim is about the compiler and not
	// about a document: `Scene.fonts` is a field no rule in `compile.ts` reads,
	// and a program that moved would mean somebody had taught one to.
	for (const scene of [card(), typography()]) {
		const bare = compile(scene);
		const dressed = compile(withFonts(scene, [inter, fraunces, ...mono]));
		assert.equal(dressed.generated, bare.generated);
		assert.equal(dressed.program, bare.program);
		assert.deepEqual(dressed.variables, bare.variables);
	}
});

test("a font declaration mints no alt/2 and no pick/2", () => {
	const bare = compile(typography()).program;
	const dressed = compile(withFonts(typography(), [inter, fraunces])).program;
	const count = (text: string, needle: string) => text.split(needle).length - 1;
	assert.equal(count(dressed, "alt("), count(bare, "alt("));
	assert.equal(count(dressed, "pick("), count(bare, "pick("));
	assert.equal(count(dressed, "#show"), count(bare, "#show"));
	// And the family name itself is nowhere in the program: it is a fact about
	// the project's tree, not about the design space.
	assert.doesNotMatch(dressed, /Inter Var/);
});

test("declaring three fonts adds no universes", async () => {
	const scene = typography();
	const bare = await explore(scene, directSolver, { limit: 32 });
	const dressed = await explore(
		withFonts(scene, [inter, fraunces, ...mono]),
		directSolver,
		{ limit: 32 },
	);
	assert.equal(dressed.universes.length, bare.universes.length);
	assert.ok(bare.universes.length > 0);
});

/* ------------------------------------------------------------------ */
/* What a universe came out wearing                                    */
/* ------------------------------------------------------------------ */

test("the families a design sets text in are read off the answer set", async () => {
	const scene = withFonts(typography(), [inter]);
	// A family the document does not use is not "used" merely by being declared —
	// which is the whole reason the exporter asks this question of the model
	// rather than of the roster.
	const bare = await explore(scene, directSolver, { limit: 1 });
	assert.equal(usedFamilies(bare.universes[0].model).has("Inter Var"), false);

	const dressed = {
		...scene,
		nodes: scene.nodes.map((node) => ({
			...node,
			children: (node.children ?? []).map((child, i) =>
				i === 0
					? {
							...child,
							props: {
								...child.props,
								fontFamily: [
									{
										kind: "literal" as const,
										value: fontStack("Inter Var", "system-ui, sans-serif"),
									},
								],
							},
						}
					: child,
			),
		})),
	};
	const after = await explore(dressed, directSolver, { limit: 1 });
	const families = usedFamilies(after.universes[0].model);
	assert.ok(families.has("Inter Var"));
	// Every family in the stack, not only the leading one: a designer who writes
	// their own fallback in front of the system tail means it.
	assert.ok(families.has("system-ui"));
});
