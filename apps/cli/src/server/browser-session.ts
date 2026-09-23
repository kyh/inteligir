// a browser cannot attach an Authorization header to a navigation, an <img> or a WebSocket, so
// it carries a cookie. a cookie reaches every 127.0.0.1 port the browser visits ("site" ignores
// the port), so it holds a per-boot secret of its own, never the data-dir bearer, and it is set
// only by trading a single-use handoff that a holder of the bearer minted. SameSite=Strict does
// not close cross-port either; browser-request.ts checks the origin of cookie-authed requests.

import { randomBytes } from "node:crypto";
import { constantTimeEqual } from "@repo/api/cloud/bytes";

export const BROWSER_SESSION_COOKIE = "inteligir_session";

const SECRET_BYTES = 32;

// long enough to click the link `serve` prints, short enough that a copy left in a log or a
// terminal's scrollback is dead by the time anyone reads it.
export const BROWSER_HANDOFF_TTL_MS = 5 * 60_000;

const mintSecret = (): string => randomBytes(SECRET_BYTES).toString("base64url");

// not Secure: some browsers drop a Secure cookie on plain-http loopback rather than ignoring the attribute.
const sessionCookie = (secret: string): string =>
  `${BROWSER_SESSION_COOKIE}=${secret}; HttpOnly; SameSite=Strict; Path=/`;

export interface BrowserSession {
  mintHandoff: () => string;
  // the Set-Cookie value for a live nonce, else null; either way the nonce is spent.
  redeemHandoff: (nonce: string) => string | null;
  cookieAccepted: (presented: string) => boolean;
}

export const createBrowserSession = (now: () => number = Date.now): BrowserSession => {
  const secret = mintSecret();
  const handoffs = new Map<string, number>();
  const dropExpired = (at: number): void => {
    for (const [nonce, expiresAt] of handoffs) {
      if (expiresAt <= at) {
        handoffs.delete(nonce);
      }
    }
  };
  return {
    cookieAccepted: (presented) => constantTimeEqual(secret, presented),
    mintHandoff: () => {
      const at = now();
      dropExpired(at);
      const nonce = mintSecret();
      handoffs.set(nonce, at + BROWSER_HANDOFF_TTL_MS);
      return nonce;
    },
    redeemHandoff: (nonce) => {
      const expiresAt = handoffs.get(nonce);
      handoffs.delete(nonce);
      return expiresAt !== undefined && now() < expiresAt ? sessionCookie(secret) : null;
    },
  };
};
