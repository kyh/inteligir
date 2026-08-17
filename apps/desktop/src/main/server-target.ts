// Where the shell's window points, and who owns the process behind it.
//
// The port is FIXED rather than derived, because the origin is the pin: a port
// that moved between launches would move the origin the window is locked to,
// and with it everything the browser keys per-origin. 4664 is the app's own
// production default, so the shell and `npx inteligir` land on the same place
// on purpose — which is why the shell probes before it spawns.

import { isHttpUrl } from "./origin-pin";

/** The app's production default (apps/app/src/node/config.ts). */
export const DEFAULT_SERVER_PORT = 4664;

/** Loopback, never `localhost`: the name resolves to ::1 or 127.0.0.1
 *  depending on the machine, and the two are different ORIGINS to the pin. */
export function serverOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function healthUrl(origin: string): string {
  return `${origin}/api/v1/health`;
}

/**
 * A port from the environment, or the default. Refuses anything that is not a
 * TCP port rather than falling back silently — a typo that quietly lands on
 * 4664 is a user pointing at a server they did not mean.
 */
export function resolvePort(raw: string | undefined): number | { error: string } {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_SERVER_PORT;
  }
  const trimmed = raw.trim();
  const port = Number(trimmed);
  if (String(port) !== trimmed || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return { error: `INTELIGIR_PORT must be a valid TCP port (got "${raw}")` };
  }
  return port;
}

/**
 * What to do about the server, given whether one already answered on the
 * origin.
 *
 * "adopt" is not a fallback, it is the right answer: a user with
 * `npx inteligir` already running who opens the app should get a window on the
 * vault they are already using, not a second process fighting for the port.
 * The distinction is also what teardown depends on — the shell kills only the
 * child it started, and quitting must never stop a server it merely borrowed.
 */
export type ServerPlan = "adopt" | "spawn";

export function planServerStart(healthAnswered: boolean): ServerPlan {
  return healthAnswered ? "adopt" : "spawn";
}

/** The window's URL. Kept beside the origin so nothing else concatenates a
 *  path onto the pinned origin by hand. */
export function windowUrl(origin: string): string {
  if (!isHttpUrl(origin)) {
    throw new Error(`the shell's origin must be an http(s) URL (got "${origin}")`);
  }
  return `${origin}/`;
}
