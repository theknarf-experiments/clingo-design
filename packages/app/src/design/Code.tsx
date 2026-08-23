import { Fragment, useMemo } from "react";
import { lex } from "@clingo-design/design-core";

import styles from "./Code.module.css";

/**
 * Clingo source, coloured.
 *
 * Hand-lexed rather than tree-sitter: the grammar's *tokens* are regular, so a
 * scanner gets the same colours as a parse tree would, without a second wasm
 * module, a query file and a build step to produce them. It also keeps working
 * on the half-written rule that a grammar would refuse.
 *
 * The lexer returns ranges over the very string it was handed, and the gaps
 * between them are emitted verbatim. So the output is character-for-character
 * the input — which is what lets the rules panel lay this behind a transparent
 * textarea and have the caret land where the glyphs are.
 */
export function Code({ text }: { text: string }) {
	const parts = useMemo(() => {
		const out = [];
		let at = 0;
		for (const { kind, start, end } of lex(text)) {
			out.push(
				<Fragment key={start}>
					{text.slice(at, start)}
					<span className={styles[kind]}>{text.slice(start, end)}</span>
				</Fragment>,
			);
			at = end;
		}
		// The trailing newline is unconditional: `white-space: pre` gives a
		// final empty line no width, so an overlay is never *too* tall, but one
		// line short of the textarea shows up as drift on the last line.
		out.push(<Fragment key="tail">{`${text.slice(at)}\n`}</Fragment>);
		return out;
	}, [text]);

	return <>{parts}</>;
}
