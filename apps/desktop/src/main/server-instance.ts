// WHICH INSTANCE this shell serves, where its server actually answers, and how
// a stranger on the port is told from it.
//
// The shell does NOT decide which instance itself: it asks the server's own
// resolver (`inteligir/server/config`, the same module the CLI's discovery
// reuses), because a second, partial copy of that layering is how a window
// ends up on a dead port. `resolveAppConfig` layers env →
// `<dataDir>/config.json` → default, and a shell that read only
// `INTELIGIR_PORT` would hand its child 4664 while the app's own resolution
// said otherwise — two servers, one vault.
//
// The origin is a PIN once the server has answered, and a spawned child is
// told the exact port (and data/vault dirs) this resolution produced, so
// nothing downstream can land somewhere else.
//
// AND WHAT ANSWERS THERE STILL HAS TO PROVE ITSELF. A loopback port is
// first-come-first-served and unauthenticated, so "something answered /health"
// identifies nothing. Adoption is a deliberate capability — a user with
// `inteligir serve` already running should get a window on the vault they are
// already using rather than a second process fighting for the port — and that
// is exactly why the responder has to EARN it.
//
// BOTH HALVES ARE REQUIRED, and `<dataDir>/server.json` carries them together.
// Reading the file proves THIS process can read the data dir; presenting its
// token back and being answered proves the RESPONDER is what wrote it. Either
// half alone is not enough: a squatter on the port has no token, and a file
// this shell cannot read names nothing it may adopt. The responder must also
// still name the data dir this resolution derived — a real inteligir server
// for a DIFFERENT vault is exactly the wrong window.

import { createHash } from "node:crypto";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { LocalContract } from "@repo/api/local";
import { RPC_PREFIX } from "@repo/api/local/routes";
import type { SystemStatusResponse } from "@repo/api/local/system/system-schema";
import {
  resolveAppConfig,
  resolveCheckoutRoot,
  type ResolveAppConfigArgs,
} from "inteligir/server/config";
import { authorizationHeader, readServerFile } from "inteligir/server/server-file";

/** Loopback, never `localhost`: the name resolves to ::1 or 127.0.0.1
 *  depending on the machine, and the two are different ORIGINS to the pin. */
export function serverOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** One resolution, carried whole: the three facts a spawned child is handed so
 *  it cannot resolve them again and disagree. The ORIGIN is not among them —
 *  it is what the server that answered says it is (`verifyServer`), because an
 *  adopted one may sit on a port this resolution never named. */
export interface ServerTarget {
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
  env: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function resolveServerTarget(args: ResolveServerTargetArgs): ServerTargetResult {
  try {
    const configArgs: ResolveAppConfigArgs = {
      // The dev derivation hashes THE CHECKOUT, walked up to from wherever
      // this process started — which is what lets `pnpm dev` (started in
      // apps/desktop) and `pnpm cli …` (started wherever the developer stands)
      // name the same instance. A packaged resolution derives nothing from it.
      checkoutPath: resolveCheckoutRoot(),
      // `app.isPackaged` decides the mode, never the ambient NODE_ENV: a
      // packaged install IS the production one and a checkout is not, and
      // neither is something the launching environment may reinterpret. A
      // shell that ran as production from a checkout would drive the
      // developer's own ~/.inteligir and ~/Inteligir.
      env: { ...args.env, NODE_ENV: args.isPackaged ? "production" : "development" },
    };
    if (args.homeDir !== undefined) {
      configArgs.homeDir = args.homeDir;
    }
    const config = resolveAppConfig(configArgs);
    return {
      kind: "resolved",
      target: {
        port: config.port,
        dataDir: config.dataDir,
        vaultDir: config.vaultDir,
      },
    };
  } catch (error) {
    return { kind: "refused", error: error instanceof Error ? error.message : String(error) };
  }
}

/** The server that is actually listening for this data dir. `origin` is built
 *  from the BOUND port the file names, never from the configured one — a dev
 *  instance may have probed upward, and a window pinned to the derived value
 *  would be pinned to nothing. */
export interface LiveServer {
  origin: string;
  port: number;
  token: string;
}

export type ServerVerdict =
  | { kind: "verified"; live: LiveServer }
  /** No server has published itself for this data dir. */
  | { kind: "no-server" }
  /** A row exists but nothing usable answered on it. */
  | { kind: "unreachable"; origin: string }
  /** Something answered, holding the token, but serving somewhere else. */
  | { kind: "wrong-data-dir"; origin: string; claimed: string };

const PROBE_TIMEOUT_MS = 2_000;

/** Asks one responder what it is serving, or null when it did not answer or
 *  refused the token. Injected so the verdicts below are drivable without a
 *  process on a port. */
export type ProbeStatus = (server: LiveServer) => Promise<SystemStatusResponse | null>;

const probeStatusOverRpc: ProbeStatus = async (server) => {
  const link = new RPCLink({
    url: `${server.origin}${RPC_PREFIX}`,
    headers: () => ({ authorization: authorizationHeader(server.token) }),
    fetch: (request) => fetch(request, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }),
  });
  const client: ContractRouterClient<LocalContract> = createORPCClient(link);
  try {
    return await client.system.status();
  } catch {
    return null;
  }
};

/**
 * Ask the data dir who is serving it, then make that answer prove itself.
 *
 * `system.status` is the probe because it is behind the token AND names the
 * data dir: one round trip settles "can this responder read what I read" and
 * "is it serving what I mean". A responder that never answers and one that
 * refuses the token are indistinguishable from here, and both are `not-ours`
 * in the only sense that matters — the shell will not adopt either.
 */
export async function verifyServer(
  dataDir: string,
  probeStatus: ProbeStatus = probeStatusOverRpc,
): Promise<ServerVerdict> {
  const file = readServerFile(dataDir);
  if (file === null) {
    return { kind: "no-server" };
  }
  const live: LiveServer = { origin: serverOrigin(file.port), port: file.port, token: file.token };
  const status = await probeStatus(live);
  if (status === null) {
    return { kind: "unreachable", origin: live.origin };
  }
  if (status.dataDir !== dataDir) {
    return { kind: "wrong-data-dir", origin: live.origin, claimed: status.dataDir };
  }
  return { kind: "verified", live };
}

/** One sentence per verdict, for the log line and the dialog. A refusal the
 *  user cannot read is a refusal they will work around. */
export function describeServerVerdict(verdict: ServerVerdict, dataDir: string): string {
  switch (verdict.kind) {
    case "verified":
      return `${verdict.live.origin} serves ${dataDir}`;
    case "no-server":
      return `no inteligir server has published itself for ${dataDir}`;
    case "unreachable":
      return `${verdict.origin} did not answer this instance's token — the row in ${dataDir} is stale, or something else holds the port`;
    case "wrong-data-dir":
      return `${verdict.origin} serves a different data directory (${verdict.claimed})`;
  }
}

/**
 * What to do about the server, given whether a VERIFIED one already answered.
 *
 * The distinction is also what teardown depends on: the shell kills only the
 * child it started, and quitting must never stop a server it merely borrowed.
 */
export type ServerPlan = "adopt" | "spawn";

export function planServerStart(verified: boolean): ServerPlan {
  return verified ? "adopt" : "spawn";
}

/** The environment a spawned child is handed: this resolution, whole. */
export function serverProcessEnv(target: ServerTarget) {
  return {
    INTELIGIR_DATA_DIR: target.dataDir,
    INTELIGIR_PORT: String(target.port),
    INTELIGIR_VAULT_DIR: target.vaultDir,
  };
}

/**
 * The CLI package to fork, derived from Electron's `app.getAppPath()`.
 *
 * ONE derivation serves both layouts. In a checkout, `node_modules/inteligir`
 * is pnpm's link to `apps/cli`; in a packaged app the same relative path lives
 * inside the asar — and an asar is not a filesystem a process can be forked
 * from, so `asarUnpack` puts node_modules beside it and the path is rewritten
 * to the unpacked twin. The negative lookahead makes the rewrite idempotent: an
 * appPath that already names the unpacked tree is left alone rather than turned
 * into `app.asar.unpacked.unpacked`.
 */
export function serverPackageDir(appPath: string): string {
  const unpacked = appPath.replace(/app\.asar(?!\.unpacked)/u, "app.asar.unpacked");
  return join(unpacked, "node_modules", "inteligir");
}

/**
 * The BUNDLE, in both layouts, and never the TypeScript source: Electron's
 * `utilityProcess` gives its child no module-customization loader thread, so
 * `--import tsx` registers nothing there and the first extensionless relative
 * import fails. `@repo/desktop#dev` therefore depends on `inteligir#build`, so
 * a checkout's bundle is current whenever the shell starts one — and a server
 * iterated on save is `pnpm cli serve` in its own terminal, which this shell
 * ADOPTS rather than fights.
 */
export function serverEntryPath(appPath: string): string {
  return join(serverPackageDir(appPath), "dist", "index.js");
}

/**
 * The window's storage partition, keyed by the DATA DIR it serves.
 *
 * Never the default session, for two reasons. Electron's default session is
 * shared with anything else this process ever loads, and — the one that
 * matters — the shell's own scheme is ONE origin whatever vault is behind it:
 * two different vaults would otherwise read each other's localStorage,
 * IndexedDB and cookies. Keying the partition to the data dir makes the storage
 * follow the vault, which is what a user means by "my notes".
 *
 * `persist:` so it survives a restart; a per-boot partition would throw away
 * the workspace's own UI state on every launch.
 */
export function sessionPartition(dataDir: string): string {
  const digest = createHash("sha256").update(dataDir).digest("hex").slice(0, 16);
  return `persist:inteligir-${digest}`;
}
