import { useState } from "react";
import {
	ClingoError,
	answerSets,
	solve,
} from "@clingo-design/clingo-wasm";

const EXAMPLE = `% Colour a 4-cycle so no two adjacent nodes share a colour.
node(1..4).
edge(1,2). edge(2,3). edge(3,4). edge(4,1).
colour(r; g; b).

1 { assign(N,C) : colour(C) } 1 :- node(N).
:- edge(N,M), assign(N,C), assign(M,C).

#show assign/2.
`;

export function Solver() {
	const [program, setProgram] = useState(EXAMPLE);
	const [models, setModels] = useState<string[][]>([]);
	const [status, setStatus] = useState<string>();
	const [error, setError] = useState<string>();
	const [running, setRunning] = useState(false);

	async function onSolve() {
		setRunning(true);
		setError(undefined);
		try {
			const result = await solve(program, { models: 0 });
			setStatus(result.Result);
			setModels(answerSets(result));
		} catch (err) {
			setModels([]);
			setStatus(undefined);
			setError(
				err instanceof ClingoError ? err.message : String(err),
			);
		} finally {
			setRunning(false);
		}
	}

	return (
		<section>
			<h1>Solver</h1>
			<p>clingo, compiled to WebAssembly, running in this tab.</p>

			<textarea
				value={program}
				onChange={(e) => setProgram(e.target.value)}
				spellCheck={false}
				rows={14}
				className="editor"
			/>

			<p>
				<button type="button" onClick={onSolve} disabled={running}>
					{running ? "Solving…" : "Solve"}
				</button>
				{status ? <span className="status"> {status}</span> : null}
			</p>

			{error ? <pre className="error">{error}</pre> : null}

			{models.length > 0 ? (
				<ol className="models">
					{models.map((atoms, i) => (
						// Answer sets have no stable id; order is the identity here.
						<li key={i}>{atoms.join(" ") || "(empty)"}</li>
					))}
				</ol>
			) : null}
		</section>
	);
}
