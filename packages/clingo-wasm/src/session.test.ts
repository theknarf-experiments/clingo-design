import assert from "node:assert/strict";
import { test } from "node:test";

import { ClingoError } from "./runtime.ts";
import { Session, sessionCount } from "./session.ts";

const PROGRAM = `
color(blue). color(rose). color(amber).
radius(sharp). radius(soft).
1 { bind(accent,C) : color(C) } 1.
1 { bind(corner,R) : radius(R) } 1.
#show bind/2.
`;

async function withSession<T>(
	program: string,
	fn: (s: Session) => Promise<T>,
): Promise<T> {
	const session = await Session.open(program);
	try {
		return await fn(session);
	} finally {
		await session.close();
	}
}

const sorted = (models: string[][]) =>
	models.map((m) => [...m].sort().join(" ")).sort();

test("a session grounds once and solves repeatedly", async () => {
	await withSession(PROGRAM, async (s) => {
		const all = await s.solve({ models: 0 });
		assert.equal(all.result, "SATISFIABLE");
		assert.equal(all.models.length, 6);
		assert.equal(all.exhausted, true);

		// Same grounding, different question.
		const one = await s.solve({ models: 1 });
		assert.equal(one.models.length, 1);
	});
});

test("positive assumptions narrow the space without re-grounding", async () => {
	await withSession(PROGRAM, async (s) => {
		const blue = await s.solve({
			models: 0,
			assumptions: [{ atom: "bind(accent,blue)" }],
		});
		assert.equal(blue.models.length, 2);
		assert.ok(blue.models.every((m) => m.includes("bind(accent,blue)")));

		// The session is unchanged: the full space is still there.
		const all = await s.solve({ models: 0 });
		assert.equal(all.models.length, 6);
	});
});

test("negative assumptions exclude values", async () => {
	await withSession(PROGRAM, async (s) => {
		const out = await s.solve({
			models: 0,
			assumptions: [
				{ atom: "bind(accent,blue)", sign: false },
				{ atom: "bind(accent,rose)", sign: false },
			],
		});
		assert.equal(out.models.length, 2);
		assert.ok(out.models.every((m) => m.includes("bind(accent,amber)")));
	});
});

test("pins and exclusions combine", async () => {
	await withSession(PROGRAM, async (s) => {
		const out = await s.solve({
			models: 0,
			assumptions: [
				{ atom: "bind(accent,blue)" },
				{ atom: "bind(corner,sharp)", sign: false },
			],
		});
		assert.deepEqual(sorted(out.models), [
			"bind(accent,blue) bind(corner,soft)",
		]);
	});
});

test("enumeration mode switches on the same grounding", async () => {
	await withSession(PROGRAM, async (s) => {
		const brave = await s.solve({
			models: 0,
			mode: "brave",
			assumptions: [{ atom: "bind(corner,soft)" }],
		});
		const cautious = await s.solve({
			models: 0,
			mode: "cautious",
			assumptions: [{ atom: "bind(corner,soft)" }],
		});

		// Brave: everything possible. Cautious: everything certain.
		assert.deepEqual([...(brave.models.at(-1) ?? [])].sort(), [
			"bind(accent,amber)",
			"bind(accent,blue)",
			"bind(accent,rose)",
			"bind(corner,soft)",
		]);
		assert.deepEqual(cautious.models.at(-1), ["bind(corner,soft)"]);
	});
});

test("an unsatisfiable solve returns a core in the caller's own terms", async () => {
	await withSession(PROGRAM, async (s) => {
		const out = await s.solve({
			models: 0,
			assumptions: [
				{ atom: "bind(accent,blue)" },
				{ atom: "bind(accent,rose)" },
				// Innocent bystander: must not appear in the core.
				{ atom: "bind(corner,soft)" },
			],
		});
		assert.equal(out.result, "UNSATISFIABLE");
		assert.deepEqual(
			[...out.core].sort(),
			["+bind(accent,blue)", "+bind(accent,rose)"],
		);
	});
});

test("assuming an atom that does not exist is unsatisfiable, not a crash", async () => {
	await withSession(PROGRAM, async (s) => {
		const out = await s.solve({
			models: 0,
			assumptions: [{ atom: "bind(accent,chartreuse)" }],
		});
		assert.equal(out.result, "UNSATISFIABLE");
		assert.deepEqual(out.core, ["+bind(accent,chartreuse)"]);
	});
});

test("forbidding a non-existent atom is free", async () => {
	await withSession(PROGRAM, async (s) => {
		const out = await s.solve({
			models: 0,
			assumptions: [{ atom: "bind(accent,chartreuse)", sign: false }],
		});
		assert.equal(out.models.length, 6);
	});
});

test("countOnly sizes a space without materialising it", async () => {
	await withSession(PROGRAM, async (s) => {
		const out = await s.solve({ models: 0, countOnly: true });
		assert.equal(out.count, 6);
		assert.deepEqual(out.models, []);
	});
});

test("a capped solve reports that it did not exhaust the space", async () => {
	await withSession(PROGRAM, async (s) => {
		const out = await s.solve({ models: 2 });
		assert.equal(out.models.length, 2);
		assert.equal(out.exhausted, false);
	});
});

test("optN enumerates only proven optima", async () => {
	await withSession(
		`${PROGRAM}\n:~ bind(accent,rose). [1@1]\n`,
		async (s) => {
			const out = await s.solve({ models: 0, mode: "optN" });
			assert.equal(out.optimal, true);
			assert.deepEqual(out.costs, [0]);
			// Every optimum avoids the penalised value; there are 4 of them.
			assert.equal(out.models.length, 4);
			assert.ok(out.models.every((m) => !m.includes("bind(accent,rose)")));
		},
	);
});

test("plain mode walks improving models and ends on the optimum", async () => {
	await withSession(
		`${PROGRAM}\n:~ bind(accent,rose). [1@1]\n`,
		async (s) => {
			const out = await s.solve({ models: 0 });
			assert.deepEqual(out.costs, [0]);
			assert.equal(out.models.length, 1);
			assert.ok(!out.models.at(-1)?.includes("bind(accent,rose)"));
		},
	);
});

test("opt mode does not leak between solves on one session", async () => {
	await withSession(
		`${PROGRAM}\n:~ bind(accent,rose). [1@1]\n`,
		async (s) => {
			// optN enumerates every optimum; plain opt stops at one. Alternating
			// proves the configuration is reset each time rather than sticking.
			assert.equal((await s.solve({ models: 0, mode: "optN" })).models.length, 4);
			assert.equal((await s.solve({ models: 0 })).models.length, 1);
			assert.equal((await s.solve({ models: 0, mode: "optN" })).models.length, 4);
		},
	);
});

test("a program that does not ground throws", async () => {
	await assert.rejects(
		() => Session.open("this is not valid asp ###"),
		(err: unknown) => {
			assert.ok(err instanceof ClingoError);
			assert.match(err.message, /syntax error/i);
			return true;
		},
	);
});

test("sessions are released and a closed one cannot be reused", async () => {
	const before = await sessionCount();
	const s = await Session.open(PROGRAM);
	assert.equal(await sessionCount(), before + 1);
	await s.close();
	assert.equal(await sessionCount(), before);
	assert.equal(s.closed, true);
	await assert.rejects(() => s.solve(), /closed/);
	// Closing twice is a no-op rather than an error.
	await s.close();
});

test("independent sessions do not interfere", async () => {
	const a = await Session.open("1 { p(1..2) } 1. #show p/1.");
	const b = await Session.open("1 { q(1..3) } 1. #show q/1.");
	try {
		assert.equal((await a.solve({ models: 0 })).models.length, 2);
		assert.equal((await b.solve({ models: 0 })).models.length, 3);
		assert.equal((await a.solve({ models: 0 })).models.length, 2);
	} finally {
		await a.close();
		await b.close();
	}
});

test("externals narrow a token without re-grounding", async () => {
	// `option/2` is external, so which values a token may take is a literal
	// flip on an already-grounded program rather than a rebuild.
	const program = `
color(blue). color(rose). color(amber).
token(accent,color).
#external option(T,V) : token(T,S), scale_value(S,V).
scale_value(color,C) :- color(C).
1 { bind(T,V) : option(T,V) } 1 :- token(T,_).
#show bind/2.
`;
	await withSession(program, async (s) => {
		// Nothing assigned yet: every external defaults to false, so no value
		// is available and the program is unsatisfiable.
		assert.equal((await s.solve({ models: 0 })).result, "UNSATISFIABLE");

		await s.setExternals([
			{ atom: "option(accent,blue)", sign: true },
			{ atom: "option(accent,rose)", sign: true },
			{ atom: "option(accent,amber)", sign: false },
		]);
		const two = await s.solve({ models: 0 });
		assert.equal(two.models.length, 2);

		// Pinning is the same mechanism with a single option left.
		await s.setExternals([{ atom: "option(accent,rose)", sign: false }]);
		const one = await s.solve({ models: 0 });
		assert.deepEqual(one.models, [["bind(accent,blue)"]]);

		// And it is reversible.
		await s.setExternals([{ atom: "option(accent,amber)", sign: true }]);
		assert.equal((await s.solve({ models: 0 })).models.length, 2);
	});
});

test("a large program grounds and solves without overflowing the stack", async () => {
	// Regression: the default 64 KB Emscripten stack overflowed on clingo's
	// recursive parser at roughly 2,500 lines, faulting with "memory access
	// out of bounds" rather than reporting an error.
	const lines: string[] = ["#show bind/2."];
	for (let i = 0; i < 900; i++) {
		lines.push(`token(t${i}).`);
		lines.push(`1 { bind(t${i},V) : V = 1..3 } 1.`);
		lines.push(`node(n${i}). prop(n${i},fill,t${i}).`);
	}
	const program = lines.join("\n");
	assert.ok(program.split("\n").length > 2500, "program must exceed the old limit");

	await withSession(program, async (s) => {
		const out = await s.solve({ models: 3 });
		assert.equal(out.result, "SATISFIABLE");
		assert.equal(out.models.length, 3);
	});
});

/* ------------------------------------------------------------------ */
/* clingo-lpx: linear arithmetic over rationals                        */
/* ------------------------------------------------------------------ */

/** Theory variable values, as `name=value`, from one model's symbols. */
function values(atoms: readonly string[]): string[] {
	return atoms
		.map((a) => /^__lpx\((.+),"(.*)"\)$/.exec(a))
		.filter((m): m is RegExpExecArray => m !== null)
		.map((m) => `${m[1]}=${m[2]}`)
		.sort();
}

/** The `&minimize`/`&maximize` optimum of one model, if the program has one. */
function objective(atoms: readonly string[]): string | undefined {
	return atoms.find((a) => a.startsWith("__lpx_objective("));
}

test("registering the theory leaves ordinary programs alone", async () => {
	await withSession("a. b :- a. #show a/0. #show b/0.", async (session) => {
		const out = await session.solve({ models: 0 });
		assert.equal(out.result, "SATISFIABLE");
		assert.deepEqual(out.models, [["a", "b"]]);
	});
});

test("a linear constraint is solved and its values come back with the model", async () => {
	await withSession(
		`&sum{ x; -y } >= 16.
		 &sum{ x } <= 100.
		 &sum{ y } >= 0.`,
		async (session) => {
			const out = await session.solve({ models: 0 });
			assert.equal(out.result, "SATISFIABLE");
			const [x, y] = [values(out.models[0])[0], values(out.models[0])[1]];
			assert.match(x, /^x=/);
			assert.match(y, /^y=/);
			const [nx, ny] = [Number(x.slice(2)), Number(y.slice(2))];
			assert.ok(nx - ny >= 16 && nx <= 100 && ny >= 0, `got ${x} ${y}`);
		},
	);
});

test("three variables in one constraint — beyond difference logic", async () => {
	// Centring when the width is itself a variable is a *linear* constraint,
	// not a difference constraint: it relates three unknowns at once.
	await withSession(
		`&sum{ l } = 0.
		 &sum{ r } = 300.
		 &sum{ 2*c; -l; -r } = 0.`,
		async (session) => {
			const out = await session.solve({ models: 0 });
			assert.equal(out.result, "SATISFIABLE");
			assert.deepEqual(values(out.models[0]), ["c=150", "l=0", "r=300"]);
		},
	);
});

test("rational answers are exact rather than rounded", async () => {
	await withSession("&sum{ 3*x } = 1.", async (session) => {
		const out = await session.solve({ models: 0 });
		assert.deepEqual(values(out.models[0]), ["x=1/3"]);
	});
});

test("an unsatisfiable system is unsatisfiable", async () => {
	await withSession("&sum{ x } >= 10. &sum{ x } <= 5.", async (session) => {
		assert.equal((await session.solve()).result, "UNSATISFIABLE");
	});
});

test("a choice drives the arithmetic, and values do not leak between models", async () => {
	// Two answer sets, each with its own solution to the equations. The values
	// are read from the propagator per model rather than accumulated onto it,
	// which is the whole reason this assertion can be exact.
	await withSession(
		`gap(8). gap(24).
		 1 { chosen(G) : gap(G) } 1.
		 &sum{ a } = 0.
		 &sum{ b; -a } = G :- chosen(G).
		 #show chosen/1.`,
		async (session) => {
			const out = await session.solve({ models: 0 });
			assert.equal(out.models.length, 2);
			const byGap = Object.fromEntries(
				out.models.map((m) => [
					m.find((a) => a.startsWith("chosen")),
					values(m),
				]),
			);
			assert.deepEqual(byGap["chosen(8)"], ["a=0", "b=8"]);
			assert.deepEqual(byGap["chosen(24)"], ["a=0", "b=24"]);
		},
	);
});

test("theory constraints respond to assumptions like anything else", async () => {
	await withSession(
		`{ tight }.
		 &sum{ w } >= 100.
		 &sum{ w } <= 400.
		 &sum{ w } <= 120 :- tight.
		 #show tight/0.`,
		async (session) => {
			const loose = await session.solve({
				models: 1,
				assumptions: [{ atom: "tight", sign: false }],
			});
			assert.equal(loose.result, "SATISFIABLE");
			const relaxed = Number(values(loose.models[0])[0].slice(2));
			assert.ok(relaxed >= 100 && relaxed <= 400);

			const tight = await session.solve({
				models: 1,
				assumptions: [{ atom: "tight" }],
			});
			assert.equal(tight.result, "SATISFIABLE");
			const bounded = Number(values(tight.models[0])[0].slice(2));
			assert.ok(bounded >= 100 && bounded <= 120, `got w=${bounded}`);
		},
	);
});

test("an lpx objective reports its optimum per model", async () => {
	// The objective is the one theory value with no variable of its own, so it
	// is also the one that would be most obviously wrong if the extension table
	// leaked between models: both answer sets here optimise the same variable.
	await withSession(
		`cap(8). cap(24).
		 1 { chosen(C) : cap(C) } 1.
		 &sum{ x } >= 0.
		 &sum{ x } <= C :- chosen(C).
		 &maximize{ x }.
		 #show chosen/1.`,
		async (session) => {
			const out = await session.solve({ models: 0 });
			assert.equal(out.models.length, 2);
			const byCap = Object.fromEntries(
				out.models.map((m) => [
					m.find((a) => a.startsWith("chosen")),
					objective(m),
				]),
			);
			assert.deepEqual(byCap, {
				"chosen(8)": '__lpx_objective("8",1)',
				"chosen(24)": '__lpx_objective("24",1)',
			});
		},
	);
});

test("an unbounded objective says so rather than reporting a value", async () => {
	await withSession("&sum{ x } >= 0. &maximize{ x }.", async (session) => {
		const out = await session.solve({ models: 1 });
		assert.equal(out.result, "SATISFIABLE");
		assert.match(objective(out.models[0]) ?? "", /,0\)$/);
	});
});

test("a program without an objective reports none", async () => {
	await withSession("&sum{ x } = 3.", async (session) => {
		const out = await session.solve({ models: 1 });
		assert.equal(objective(out.models[0]), undefined);
	});
});
