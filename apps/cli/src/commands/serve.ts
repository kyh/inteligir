// `inteligir serve` — the one verb that is not a client.
//
// Every other command dials a running server; this one IS the server, in the
// process that ran the command. That is the whole of the two-mode shape: one
// binary, one contract, and no third package to hold the two halves apart.
//
// The flags exist because this is also the zero-install path — `npx inteligir
// serve --open` is how someone lands in the product without a checkout — and
// they resolve to the SAME `INTELIGIR_*` variables the app's own config layer
// reads, so a flag can never mean something the environment cannot.

import { isAbsolute, resolve } from "node:path";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { readCliVersion } from "../paths";
import { parsePortValue } from "../server/config";
import type { ServeOverrides } from "../server/serve";
import { out, writeOut } from "../output";

/**
 * A path flag as the app's config layer wants it: absolute, or `~`-relative for
 * it to expand itself. A relative one is resolved HERE, against the invoking
 * cwd, because the app refuses a relative path outright — it would otherwise
 * anchor to whatever directory the server happened to start in — and "must be
 * absolute" is a poor answer to a path the user can see from where they stand.
 * `~` is left alone: expanding it twice is how a literal `~` directory gets
 * created.
 */
function resolvePathFlag(value: string, cwd: string): string {
  if (value === "~" || value.startsWith("~/")) {
    return value;
  }
  return isAbsolute(value) ? value : resolve(cwd, value);
}

/** The env variable's own predicate, re-raised as a USAGE error: the flag
 *  resolves to `INTELIGIR_PORT`, so it must accept exactly what that accepts —
 *  but a bad flag is a bad command line, not a bad environment. */
function parsePort(raw: string): number {
  try {
    return parsePortValue("--port", raw);
  } catch {
    throw invalidUsage(`--port must be a valid TCP port (got "${raw}")`);
  }
}

export function serveCommand() {
  return defineCommand({
    meta: {
      name: "serve",
      description: "Run the local server: the vault, the index, the agent and the API",
    },
    args: {
      port: { type: "string", description: "TCP port for the local server (default 4664)" },
      "data-dir": {
        type: "string",
        description: "Where the database and settings live (default ~/.inteligir)",
      },
      vault: {
        type: "string",
        description: "The vault: your markdown files (default ~/Inteligir)",
      },
      open: {
        type: "boolean",
        description: "Open the workspace in a browser once it is listening",
      },
    },
    run: async ({ args }) => {
      const cwd = process.cwd();
      // An overlay, never a write to `process.env`: the config layer reads an
      // environment it is HANDED, and a global write would be inherited by
      // every child this server spawns. An option left unset contributes no
      // key, so the app's own layering still decides.
      const overrides: ServeOverrides = {};
      if (args.port !== undefined) overrides.INTELIGIR_PORT = String(parsePort(args.port));
      if (args["data-dir"] !== undefined) {
        overrides.INTELIGIR_DATA_DIR = resolvePathFlag(args["data-dir"], cwd);
      }
      if (args.vault !== undefined) {
        overrides.INTELIGIR_VAULT_DIR = resolvePathFlag(args.vault, cwd);
      }

      // IMPORTED HERE, not at the top: this is the only verb that needs the
      // server, and a static import would make every CLIENT verb evaluate
      // hono, drizzle, the vault runtime and the agent runtime before it read
      // argv — ~60ms on every `inteligir …` an agent types.
      const { runServe } = await import("../server/serve");
      const { serverUrl, uiUrl } = await runServe(readCliVersion(), overrides);
      writeOut(`\n  inteligir is running — ${uiUrl ?? serverUrl}\n\n`);
      if (args.open !== true) {
        return;
      }
      if (uiUrl === null) {
        out.warn("This install ships no workspace UI, so there is nothing to open.");
        return;
      }
      // Best-effort, and deliberately not fatal: a machine with no browser must
      // not take the server down with it — the URL is already printed.
      const { systemOpenExternalUrl } = await import("../server/cloud/browser-opener");
      await systemOpenExternalUrl(uiUrl);
    },
  });
}
