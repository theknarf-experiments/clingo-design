import { type RefObject, useEffect } from "react";

/**
 * Closes a floating layer on an outside press or Escape.
 *
 * The press listener is on the capture phase because these layers float over a
 * canvas that starts a pan on pointerdown: without it, dismissing the menu
 * would also drag the document out from under the pointer.
 */
export function useDismiss(
	ref: RefObject<HTMLElement | null>,
	onDismiss: () => void,
	active = true,
): void {
	useEffect(() => {
		if (!active) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!ref.current?.contains(event.target as globalThis.Node)) onDismiss();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onDismiss();
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKey);
		};
	}, [ref, onDismiss, active]);
}
