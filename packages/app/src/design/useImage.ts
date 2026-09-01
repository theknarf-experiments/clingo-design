import { useEffect, useState } from "react";

import { resolveAsset } from "../projects/store";

/**
 * The bytes at a path in the project's tree, as a url an `<img>` can load.
 *
 * An object url rather than a data url, and the difference is not stylistic: a
 * data url is base64, which is a third larger than the bytes and has to be
 * built as one enormous string every time the component mounts. An object url
 * is a handle to the blob the browser already has. For a four-megabyte
 * photograph that is the difference between a re-render nobody notices and one
 * that stalls the frame.
 *
 * Which is also why it is revoked on the way out. An object url pins its blob
 * in memory until released, so a canvas that panned past fifty images and let
 * fifty urls fall out of scope would hold every one of them for the life of the
 * page.
 *
 * `undefined` covers loading, missing and unreadable alike, because the caller
 * draws the same placeholder for all three: the node has a place and a size
 * whether or not its file has arrived. Which of the three it is is a question
 * about a *project* — "this document references a file the store has never
 * held" — and it is answered where somebody can act on it, not per frame.
 */
export function useImage(path: string | undefined): string | undefined {
	const [url, setUrl] = useState<string | undefined>();

	useEffect(() => {
		if (!path) {
			setUrl(undefined);
			return;
		}
		let alive = true;
		let made: string | undefined;
		void resolveAsset(path)
			.then((bytes) => {
				if (!alive || !bytes) return;
				// Copied into a fresh ArrayBuffer rather than handed the view: the
				// bytes come out of Automerge, and a Blob over a view into memory the
				// document may reuse is a picture that can change under the browser.
				made = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer]));
				setUrl(made);
			})
			.catch(() => {
				// A payload that will not read is a payload that is missing, as far as
				// the picture is concerned. It costs this node its image and nothing
				// else — not the artboard, and not the images beside it.
			});
		return () => {
			alive = false;
			if (made) URL.revokeObjectURL(made);
			setUrl(undefined);
		};
	}, [path]);

	return url;
}
