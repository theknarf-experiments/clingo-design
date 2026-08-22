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
 * nested terms survive, though the generated program does not use them.
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
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "(") depth++;
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
 * Rewrites clingo's source prefixes so a mistake in the rules panel is reported
 * against the line the user typed, not its offset in the full program.
 *
 * The prefix differs by entry point: the one-shot binary reads stdin and says
 * `-:12:3`, while a session adds a named block and says `<block>:12:3`.
 */
export function formatDiagnostics(stderr: string, userRulesLine = 0): string {
	return stderr
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("*** Info"))
		.map((line) =>
			line.replace(
				/^(?:-|<block>):(\d+):(\d+(?:-\d+)?):/,
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
