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
