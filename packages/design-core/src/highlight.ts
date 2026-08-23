/**
 * A scanner over clingo's surface syntax, for syntax highlighting.
 *
 * A lexer rather than a parser: clingo's grammar is context-free but its
 * *tokens* are regular, and colour only ever depends on the token. That also
 * makes half-typed text a non-event — a rule with no body yet still lexes,
 * where a grammar would reject it and leave the panel unpainted.
 *
 * Ranges are returned instead of substrings, and only for the lexemes that get
 * a colour: whatever falls between two of them is a plain identifier or
 * whitespace, so a renderer can slice the source and be sure the pieces
 * reassemble into exactly what it was given. That exactness is what lets the
 * rules panel put the painted copy behind a transparent textarea.
 *
 * `Lexeme` rather than `Token`: a design token is already a thing here.
 */

export type LexemeKind =
	| "comment"
	| "string"
	| "number"
	| "variable"
	| "directive"
	| "theory"
	| "keyword"
	| "operator";

export interface Lexeme {
	kind: LexemeKind;
	/** Index into the source, half-open. */
	start: number;
	end: number;
}

/**
 * `not` is the only word clingo reserves that is not spelled with a `#` or a
 * `&`; the rest — `#show`, `&sum` — are caught by their sigil.
 */
const KEYWORDS = new Set(["not"]);

/**
 * Longest match first, so `:-` never lexes as `:` followed by `-` and `..`
 * never as two term separators.
 */
const OPERATORS = [
	":-",
	":~",
	"..",
	"!=",
	"<=",
	">=",
	"==",
	"**",
	":",
	";",
	",",
	".",
	"=",
	"<",
	">",
	"+",
	"-",
	"*",
	"/",
	"\\",
	"^",
	"|",
	"&",
	"~",
	"(",
	")",
	"{",
	"}",
	"[",
	"]",
];

/** Both identifiers and variables may be prefixed with underscores — `__lpx`. */
const WORD = /_*[A-Za-z][A-Za-z0-9_']*/y;
const DIGITS = /[0-9]+/y;
const HOLE = /_+/y;
const SIGIL = /[#&]_*[A-Za-z][A-Za-z0-9_']*/y;

function at(re: RegExp, source: string, from: number): string | null {
	re.lastIndex = from;
	return re.exec(source)?.[0] ?? null;
}

/** Index just past the closing quote, or the end of the line if there is none. */
function endOfString(source: string, from: number): number {
	let i = from + 1;
	while (i < source.length) {
		const c = source[i];
		if (c === "\n") return i;
		if (c === "\\") {
			i += 2;
			continue;
		}
		i += 1;
		if (c === '"') return i;
	}
	return source.length;
}

export function lex(source: string): Lexeme[] {
	const out: Lexeme[] = [];
	let i = 0;
	const push = (kind: LexemeKind, end: number) => {
		out.push({ kind, start: i, end });
		i = end;
	};

	while (i < source.length) {
		const c = source[i];

		if (c === "%") {
			if (source[i + 1] === "*") {
				const close = source.indexOf("*%", i + 2);
				push("comment", close === -1 ? source.length : close + 2);
			} else {
				const line = source.indexOf("\n", i);
				push("comment", line === -1 ? source.length : line);
			}
			continue;
		}

		if (c === '"') {
			push("string", endOfString(source, i));
			continue;
		}

		const sigil = at(SIGIL, source, i);
		if (sigil !== null) {
			push(c === "#" ? "directive" : "theory", i + sigil.length);
			continue;
		}

		const digits = at(DIGITS, source, i);
		if (digits !== null) {
			push("number", i + digits.length);
			continue;
		}

		const word = at(WORD, source, i);
		if (word !== null) {
			const head = word.replace(/^_+/, "")[0];
			if (head >= "A" && head <= "Z") push("variable", i + word.length);
			else if (KEYWORDS.has(word)) push("keyword", i + word.length);
			else i += word.length;
			continue;
		}

		// A bare `_` is the anonymous variable; a run of them is still one.
		const hole = at(HOLE, source, i);
		if (hole !== null) {
			push("variable", i + hole.length);
			continue;
		}

		const op = OPERATORS.find((o) => source.startsWith(o, i));
		if (op !== undefined) {
			push("operator", i + op.length);
			continue;
		}

		i += 1;
	}

	return out;
}
