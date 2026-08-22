import { useCallback, useState } from "react";

/**
 * Undo/redo over immutable documents.
 *
 * Every edit is a whole new {@link Scene}, so history is just a stack of past
 * values. Continuous gestures pass `coalesce` with a stable key so a drag
 * leaves one entry rather than one per pointermove.
 */
export interface History<T> {
	present: T;
	canUndo: boolean;
	canRedo: boolean;
	set: (next: T | ((prev: T) => T), coalesce?: string) => void;
	undo: () => void;
	redo: () => void;
	/** Replace without touching history — for loading a different document. */
	reset: (value: T) => void;
}

const LIMIT = 200;

/**
 * The whole stack is one piece of state rather than a present plus a pair of
 * refs: the past and future are derived from the same transitions as the
 * present, and a `setState` updater has to be pure — React is free to call it
 * twice, which would push a duplicate entry onto a mutable stack.
 */
interface Stack<T> {
	present: T;
	past: T[];
	future: T[];
	/** Key of the run of edits currently being collapsed, if any. */
	coalesce: string | null;
}

export function useHistory<T>(initial: T): History<T> {
	const [stack, setStack] = useState<Stack<T>>({
		present: initial,
		past: [],
		future: [],
		coalesce: null,
	});

	const set = useCallback(
		(next: T | ((prev: T) => T), coalesce?: string) => {
			setStack((s) => {
				const value =
					typeof next === "function"
						? (next as (p: T) => T)(s.present)
						: next;
				if (value === s.present) return s;

				// A run of edits sharing a key collapses into the first one.
				const continuing = coalesce !== undefined && coalesce === s.coalesce;
				return {
					present: value,
					past: continuing ? s.past : [...s.past, s.present].slice(-LIMIT),
					future: [],
					coalesce: coalesce ?? null,
				};
			});
		},
		[],
	);

	const undo = useCallback(() => {
		setStack((s) => {
			if (s.past.length === 0) return s;
			return {
				present: s.past[s.past.length - 1],
				past: s.past.slice(0, -1),
				future: [...s.future, s.present],
				coalesce: null,
			};
		});
	}, []);

	const redo = useCallback(() => {
		setStack((s) => {
			if (s.future.length === 0) return s;
			return {
				present: s.future[s.future.length - 1],
				past: [...s.past, s.present],
				future: s.future.slice(0, -1),
				coalesce: null,
			};
		});
	}, []);

	const reset = useCallback((value: T) => {
		setStack({ present: value, past: [], future: [], coalesce: null });
	}, []);

	return {
		present: stack.present,
		canUndo: stack.past.length > 0,
		canRedo: stack.future.length > 0,
		set,
		undo,
		redo,
		reset,
	};
}
