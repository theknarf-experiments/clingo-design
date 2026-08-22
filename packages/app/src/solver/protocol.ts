/** Messages exchanged with the solver worker. */
import type { SolveOutcome, SolveRequest } from "@clingo-design/design-core";

export type SolverRequest =
	| { id: number; op: "open"; program: string; options?: string }
	| { id: number; op: "solve"; session: number; request: SolveRequest }
	| { id: number; op: "close"; session: number };

export type SolverResponse =
	| { id: number; ok: true; value: number | SolveOutcome | null }
	| { id: number; ok: false; error: string };

/**
 * `Omit` over a union collapses to the keys they share, so it has to be
 * distributed across the members to keep the discriminant usable.
 */
export type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
