/**
 * Reading clingo's output: atom parsing and diagnostic rewriting. Pure string
 * handling, with no dependency on how the solver is reached.
 */

export interface Atom {
	name: string;
	args: string[];
}

/**
 * Parses `name(a,b)` / `name`. Arguments are split on top-level commas so
 * nested terms survive — `__lpx(lv(n,x),"12")` is two arguments, not three.
 *
 * Quoted arguments are left quoted but are not split inside: `literal/2` now
 * crosses back from the solver, and a headline reading "Fast, quiet" is one
 * argument however many commas it holds. See {@link unquote}.
 */
export function parseAtom(text: string): Atom | null {
	const open = text.indexOf("(");
	if (open === -1) {
		const bare = text.trim();
		return bare ? { name: bare, args: [] } : null;
	}
	if (!text.endsWith(")")) return null;

	const name = text.slice(0, open).trim();
	const inner = text.slice(open + 1, -1);

	const args: string[] = [];
	let depth = 0;
	let start = 0;
	let quoted = false;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (quoted) {
			// A backslash escapes whatever follows, the closing quote included.
			if (ch === "\\") i++;
			else if (ch === '"') quoted = false;
			continue;
		}
		if (ch === '"') quoted = true;
		else if (ch === "(") depth++;
		else if (ch === ")") depth--;
		else if (ch === "," && depth === 0) {
			args.push(inner.slice(start, i).trim());
			start = i + 1;
		}
	}
	args.push(inner.slice(start).trim());
	return { name, args: args.filter((a) => a.length > 0) };
}

/**
 * The text an ASP string argument stands for: quotes off, escapes undone.
 *
 * Anything unquoted is returned as it came, since a constant is already its
 * own text.
 *
 * `\n` is a line break rather than the letter n — a clingo string cannot hold
 * a raw newline, so a paragraph of body copy reaches the program escaped and
 * has to come back the same way. Every other escape is the character it
 * shields, which is what the quote and the backslash need.
 */
export function unquote(argument: string): string {
	if (argument.length < 2 || !argument.startsWith('"') || !argument.endsWith('"')) {
		return argument;
	}
	return argument
		.slice(1, -1)
		.replace(/\\(.)/g, (_whole, ch: string) => (ch === "n" ? "\n" : ch));
}

/**
 * Rewrites clingo's source prefixes so a mistake in the rules panel is reported
 * against the line the user typed, not its offset in the full program.
 *
 * The prefix differs by entry point, and all three are in use: the one-shot
 * binary reads stdin and says `-:12:3`, a grounding error from a named block
 * says `<block>:12:3`, and the AST parser a session grounds through says
 * `<string>:12:3`. Missing that third one is how a warning would arrive with a
 * line number counted from the top of the generated program — technically true
 * and useless to anyone reading the panel.
 */
/**
 * How many things clingo actually remarked on.
 *
 * Not the line count: a remark is a header line and then the atom it is about,
 * so counting lines reports one mistake as two. The severity word is what
 * begins a new one — every message carries exactly one — and anything without
 * it is a continuation of the message above.
 */
export function countDiagnostics(diagnostics: string): number {
	if (diagnostics.trim().length === 0) return 0;
	const headers = diagnostics
		.split("\n")
		.filter((line) => /\b(?:info|warning|error):/.test(line)).length;
	// Something was said, even if it did not look like clingo. Better to
	// under-describe it than to report nothing while the band shows text.
	return headers > 0 ? headers : 1;
}

export function formatDiagnostics(stderr: string, userRulesLine = 0): string {
	return stderr
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("*** Info"))
		.map((line) =>
			line.replace(
				/^(?:-|<block>|<string>):(\d+):(\d+(?:-\d+)?):/,
				(_match, lineNo: string, col: string) => {
					const n = Number(lineNo);
					return n >= userRulesLine && userRulesLine > 0
						? `your rules, line ${n - userRulesLine + 1}:${col}:`
						: `generated, line ${n}:${col}:`;
				},
			),
		)
		.join("\n");
}
