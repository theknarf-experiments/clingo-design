import assert from "node:assert/strict";
import { test } from "node:test";

import { lex, type LexemeKind } from "./highlight.ts";

/** `[kind, text]` pairs — the ranges only mean anything against the source. */
function marks(source: string): Array<[LexemeKind, string]> {
	return lex(source).map((l) => [l.kind, source.slice(l.start, l.end)]);
}

test("a rule lexes into its heads, bodies and separators", () => {
	assert.deepEqual(marks("hidden(N) :- node(N), tall(N)."), [
		["operator", "("],
		["variable", "N"],
		["operator", ")"],
		["operator", ":-"],
		["operator", "("],
		["variable", "N"],
		["operator", ")"],
		["operator", ","],
		["operator", "("],
		["variable", "N"],
		["operator", ")"],
		["operator", "."],
	]);
});

test("identifiers get no colour of their own", () => {
	assert.deepEqual(marks("card badge fill"), []);
});

test("case tells a variable from a constant, underscores notwithstanding", () => {
	assert.deepEqual(marks("__lpx _Var _ x0 X0"), [
		["variable", "_Var"],
		["variable", "_"],
		["variable", "X0"],
	]);
});

test("not is a keyword; nothing spelled like it is", () => {
	assert.deepEqual(marks("not notch cannot"), [["keyword", "not"]]);
});

test("sigils carry directives and theory atoms", () => {
	assert.deepEqual(marks("#show p/1. &sum{ x } >= 16."), [
		["directive", "#show"],
		["operator", "/"],
		["number", "1"],
		["operator", "."],
		["theory", "&sum"],
		["operator", "{"],
		["operator", "}"],
		["operator", ">="],
		["number", "16"],
		["operator", "."],
	]);
});

test("a lone ampersand is arithmetic, not a theory atom", () => {
	assert.deepEqual(marks("a & b"), [["operator", "&"]]);
});

test("comments run to the end of the line, block comments to their close", () => {
	assert.deepEqual(marks("a. % why\nb."), [
		["operator", "."],
		["comment", "% why"],
		["operator", "."],
	]);
	assert.deepEqual(marks("%* a.\n b. *% c."), [
		["comment", "%* a.\n b. *%"],
		["operator", "."],
	]);
});

test("an unclosed comment swallows the rest rather than losing its colour", () => {
	assert.deepEqual(marks("%* a."), [["comment", "%* a."]]);
});

test("a string is one lexeme, escapes and all", () => {
	assert.deepEqual(marks('literal(1,"a \\" b").'), [
		["operator", "("],
		["number", "1"],
		["operator", ","],
		["string", '"a \\" b"'],
		["operator", ")"],
		["operator", "."],
	]);
});

test("an unterminated string stops at the line, so the next line still lexes", () => {
	assert.deepEqual(marks('p("oops\nq(1).'), [
		["operator", "("],
		["string", '"oops'],
		["operator", "("],
		["number", "1"],
		["operator", ")"],
		["operator", "."],
	]);
});

test("longer operators win over their prefixes", () => {
	assert.deepEqual(marks("1..3 :~ a != b"), [
		["number", "1"],
		["operator", ".."],
		["number", "3"],
		["operator", ":~"],
		["operator", "!="],
	]);
});

// The rules panel paints a copy of the text behind a transparent textarea, so
// anything the lexer drops or duplicates shows up as drift under the caret.
test("the ranges tile the source exactly", () => {
	const source = [
		"% pick a fill",
		'1 { pick(tok(accent),I) : I = 0..2 } 1.',
		':- resolved(prop(card,fill), C), literal(C, "#fff").',
		"&sum{ lv(card,x); -lv(page,x) } >= 16.",
		"#show pick/2.",
	].join("\n");
	let at = 0;
	let rebuilt = "";
	for (const l of lex(source)) {
		assert.ok(l.start >= at, `overlap at ${l.start}`);
		assert.ok(l.end > l.start, "empty lexeme");
		rebuilt += source.slice(at, l.start) + source.slice(l.start, l.end);
		at = l.end;
	}
	assert.equal(rebuilt + source.slice(at), source);
});
