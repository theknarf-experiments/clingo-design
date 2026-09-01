// What a path says about its contents: which files are bytes, what MIME type
// they carry, how to show one.
//
// Its own module so it can be imported — and tested — without the Automerge
// runtime that `index.ts` initialises at import. Nothing here has a dependency.

export const MIME: Record<string, string> = {
  js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  css: 'text/css', html: 'text/html', svg: 'image/svg+xml',
  md: 'text/markdown', mdx: 'text/markdown',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
}

/** Extensions held as bytes. SVG is deliberately absent: it is text, and the
 *  editor should open it as such. */
const BINARY = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf'])

export const extOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** Whether a path holds bytes rather than text. Asked of the *path*, so an
 *  empty file created by the tree gets the right kind before it has content. */
export const isBinaryPath = (path: string) => BINARY.has(extOf(path))

/** The MIME type for a path, for previewing and for data URLs. */
export const mimeOf = (path: string) => MIME[extOf(path)] ?? 'application/octet-stream'

/** Bytes as a data URL, for showing a file the browser can render. A data URL
 *  rather than a blob URL because there is nothing to revoke and nothing to
 *  leak — the string lives exactly as long as whatever is holding it. */
export function dataUrl(path: string, bytes: Uint8Array): string {
  let s = ''
  // Chunked: `String.fromCharCode(...bytes)` blows the argument limit somewhere
  // north of a hundred kilobytes, which is a perfectly ordinary photograph.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${mimeOf(path)};base64,${btoa(s)}`
}
