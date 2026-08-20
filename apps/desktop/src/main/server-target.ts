// Where the shell's window points, WHICH SERVER it is willing to point at, and
// how the two are told apart.
//
// The shell does NOT decide WHICH instance itself: it asks the app's own
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
//
// AND WHAT ANSWERS THERE STILL HAS TO PROVE ITSELF. A loopback port is
// first-come-first-served and unauthenticated, so "something answered /health"
// identifies nothing. Adoption is a deliberate capability — a user with `npx
// inteligir` already running should get a window on the vault they are already
// using rather than a second process fighting for the port — and that is
// exactly why the responder has to EARN it. The shell adopts only a server
// that proves it can read the data dir this resolution named
// (@repo/app/node/instance-identity says what that proof is worth). A squatter
// that cannot produce the proof wins nothing.

import { resolveAppConfig, type ResolveAppConfigArgs } from "@repo/app/node/config";
import {
  newIdentityChallenge,
  readInstanceSecret,
  verifyIdentityProof,
} from "@repo/app/node/instance-identity";
import { apiPath, apiRoutes, type SystemIdentityResponse } from "@repo/server-contract/routes";
import { isHttpUrl } from "./origin-pin";

/** Loopback, never `localhost`: the name resolves to ::1 or 127.0.0.1
 *  depending on the machine, and the two are different ORIGINS to the pin. */
export function serverOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function identityUrl(origin: string, challenge: string): string {
  const path = apiPath(apiRoutes.system.identity);
  return `${origin}${path}?challenge=${encodeURIComponent(challenge)}`;
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
    const configArgs: ResolveAppConfigArgs = {
      checkoutPath: args.appCheckoutDir,
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
 * What a responder has to satisfy before the shell will point a window at it.
 *
 * Both halves are required, and neither is sufficient. The PROOF says the
 * responder can read the secret in the data dir this shell means — a squatter
 * cannot. The dataDir MATCH says it is serving that vault rather than some
 * other one it also has access to. A responder that proves the secret but
 * names a different data dir is a real inteligir server for a different vault,
 * and adopting it would silently point the window at the wrong notes.
 */
export type IdentityVerdict =
  | { kind: "verified" }
  | { kind: "no-secret" }
  | { kind: "unreachable" }
  | { kind: "wrong-data-dir"; claimed: string }
  | { kind: "bad-proof" };

export interface VerifyIdentityArgs {
  /** The data dir this shell is configured for. */
  dataDir: string;
  challenge: string;
  /** What the responder answered, PARSED against the contract's own row, or
   *  null when it answered nothing usable. The shape is the contract's rather
   *  than a local narrowing of two string fields: this is the one message a
   *  squatter gets to compose, so the schema's own bounds (a 64-hex proof, no
   *  extra keys) are exactly what should be applied to it. */
  answer: SystemIdentityResponse | null;
  /** Reads the secret the local data dir holds; injected for the tests. */
  readSecret?: (dataDir: string) => string | null;
}

export function verifyServerIdentity(args: VerifyIdentityArgs): IdentityVerdict {
  const readSecret = args.readSecret ?? readInstanceSecret;
  const secret = readSecret(args.dataDir);
  if (secret === null) {
    // Nothing has ever booted against this data dir (or this process may not
    // read it). Fails CLOSED: with no secret there is no question to ask, so
    // there is no responder that can be trusted.
    return { kind: "no-secret" };
  }
  if (args.answer === null) {
    return { kind: "unreachable" };
  }
  if (args.answer.dataDir !== args.dataDir) {
    return { kind: "wrong-data-dir", claimed: args.answer.dataDir };
  }
  return verifyIdentityProof(secret, args.challenge, args.answer.proof)
    ? { kind: "verified" }
    : { kind: "bad-proof" };
}

/** One sentence per verdict, for the log line and the dialog. A refusal the
 *  user cannot read is a refusal they will work around. */
export function describeIdentityVerdict(verdict: IdentityVerdict, origin: string): string {
  switch (verdict.kind) {
    case "verified":
      return `${origin} proved it serves this data directory`;
    case "no-secret":
      return `no inteligir instance secret in the configured data directory yet`;
    case "unreachable":
      return `${origin} did not answer the identity challenge`;
    case "wrong-data-dir":
      return `${origin} serves a different data directory (${verdict.claimed})`;
    case "bad-proof":
      return `${origin} could not prove it owns this data directory — refusing to adopt it`;
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

/** The window's URL. Kept beside the origin so nothing else concatenates a
 *  path onto the pinned origin by hand. */
export function windowUrl(origin: string): string {
  if (!isHttpUrl(origin)) {
    throw new Error(`the shell's origin must be an http(s) URL (got "${origin}")`);
  }
  return `${origin}/`;
}

export { newIdentityChallenge };
