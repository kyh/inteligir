// Where the shell's window points, and who owns the process behind it.
//
// The shell does NOT decide any of that itself: it asks the app's own
// resolver (`@repo/app/node/config`, the same module apps/cli's discovery
// reuses), because a second, partial copy of that resolution is how a window
// ends up on a dead port. `resolveAppConfig` layers env → `<dataDir>/config.json`
// → default, and a shell that read only `INTELIGIR_PORT` would probe 4664,
// find nothing, and spawn a child that binds the CONFIGURED port instead —
// leaving the window pinned to an origin no server listens on while a second
// server runs against the same vault.
//
// The origin is still a PIN: it is fixed for the whole launch, and the child
// is told the exact port (and data/vault dirs) this resolution produced, so
// nothing downstream can land somewhere else.

import { resolveAppConfig } from "@repo/app/node/config";
import { isHttpUrl } from "./origin-pin";

/** Loopback, never `localhost`: the name resolves to ::1 or 127.0.0.1
 *  depending on the machine, and the two are different ORIGINS to the pin. */
export function serverOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function healthUrl(origin: string): string {
  return `${origin}/api/v1/health`;
}

/** One resolution, carried whole: the origin the window is pinned to and the
 *  three facts a spawned child is handed so it cannot resolve them again and
 *  disagree. */
export interface ServerTarget {
  origin: string;
  port: number;
  dataDir: string;
  vaultDir: string;
}

export type ServerTargetResult =
  | { kind: "resolved"; target: ServerTarget }
  /** A configuration the app itself refuses (a bad port, nested dirs); shown
   *  rather than silently replaced by a default the user did not ask for. */
  | { kind: "refused"; error: string };

export interface ResolveServerTargetArgs {
  isPackaged: boolean;
  /** The apps/app checkout, whose path the dev instance derivation hashes.
   *  A packaged resolution derives nothing from it. */
  appCheckoutDir: string;
  env: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function resolveServerTarget(args: ResolveServerTargetArgs): ServerTargetResult {
  try {
    const config = resolveAppConfig({
      checkoutPath: args.appCheckoutDir,
      // `app.isPackaged` decides the mode, never the ambient NODE_ENV: a
      // packaged install IS the production one and a checkout is not, and
      // neither is something the launching environment may reinterpret. A
      // shell that ran as production from a checkout would drive the
      // developer's own ~/.inteligir and ~/Inteligir.
      env: { ...args.env, NODE_ENV: args.isPackaged ? "production" : "development" },
      ...(args.homeDir !== undefined ? { homeDir: args.homeDir } : {}),
    });
    return {
      kind: "resolved",
      target: {
        origin: serverOrigin(config.port),
        port: config.port,
        dataDir: config.dataDir,
        vaultDir: config.vaultDir,
      },
    };
  } catch (error) {
    return { kind: "refused", error: error instanceof Error ? error.message : String(error) };
  }
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
