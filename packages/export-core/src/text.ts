/**
 * Escaping, data URIs, and reading a value the answer set drew.
 *
 * These sat in the HTML emitter while the HTML emitter was the only place that
 * had them, and the split found out that they were never HTML's: an SVG escapes
 * the same five characters, inlines the same pictures and asks the same question
 * about which layer of which machine last stated a value. Three of the four
 * `Cannot find name` errors that came out of moving SVG into its own package
 * were these — which is the useful thing a package boundary does, and the reason
 * to draw one.
 */

export function escapeText(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const escapeAttr = (text: string): string => escapeText(text).replace(/"/g, "&quot;");


/** Everything a node paints, with token links kept as `var(--name)`. */

/**
 * A payload as a `data:` url, or nothing where the caller did not supply it.
 *
 * Base64 through `btoa`, which both a browser and Node have as a global — this
 * package has no DOM in its `lib` and must not gain one for an encoder. Built
 * in chunks because `String.fromCharCode(...bytes)` spreads the whole array
 * into an argument list, and a four-megabyte photograph is four million
 * arguments and a stack overflow.
 *
 * The media type comes from the extension rather than from the document,
 * because what the exporter has is a path. A type it does not recognise is left
 * to the browser to sniff, which is what `application/octet-stream` would
 * prevent.
 */
export function dataUrl(
	payloads: Readonly<Record<string, Uint8Array>>,
	path: string,
	unknown = "image/png",
): string | undefined {
	const bytes = payloads[path];
	if (!bytes || bytes.length === 0) return undefined;
	let binary = "";
	const CHUNK = 0x8000;
	for (let at = 0; at < bytes.length; at += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
	}
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	const type = MEDIA_TYPES[ext];
	return `data:${type ?? unknown};base64,${btoa(binary)}`;
}

/**
 * What an extension means, for the handful a design tool actually places.
 *
 * The four font types are here rather than in a table of their own, and a second
 * `fontDataUrl` beside `dataUrl` was rejected for the reason `store.ts`
 * congratulates itself on: two functions that turn a path and some bytes into a
 * data URI are two answers to "what is at this path". What is *not* shared is
 * the guess for an extension neither table knows — "an unknown extension is a
 * PNG" is a reasonable thing to assume about a picture and a nonsense one about
 * a face — which is why the fallback became a parameter above.
 */
export const MEDIA_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
	woff2: "font/woff2",
	woff: "font/woff",
	ttf: "font/ttf",
	otf: "font/otf",
};
