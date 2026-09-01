/**
 * Where the lane's dev server lives.
 *
 * A module rather than a literal in two places, because the config and the spec
 * have to agree about the origin down to the last character and the reason is
 * not tidiness. The browser keys IndexedDB and localStorage by *origin*, and
 * `http://localhost:5173` and `http://127.0.0.1:5173` are two origins. A test
 * whose second pass reached the app under the other spelling would open a fresh,
 * empty store and quietly stop being the returning-browser test it claims to be
 * — passing, and testing nothing. So both halves import this.
 *
 * The port is not 5173 on purpose. That is the port `vite.config.ts` pins for
 * `pnpm dev`, and a developer with the app open is the normal state of things;
 * borrowing their port would either fail to bind or, worse, silently run the
 * suite against whatever build they happen to be running. This lane brings its
 * own server on its own port.
 */
export const PORT = 5174;

export const BASE_URL = `http://127.0.0.1:${PORT}`;
