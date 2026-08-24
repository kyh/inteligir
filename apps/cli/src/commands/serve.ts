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
import { systemOpenExternalUrl } from "../server/cloud/browser-opener";
import { runServe } from "../server/serve";
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

function parsePort(raw: string): number {
  const port = Number(raw);
  if (String(port) !== raw || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw invalidUsage(`--port must be a valid TCP port (got "${raw}")`);
  }
  return port;
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
      // Assigned BEFORE the boot: the config layer reads the environment as it
      // resolves, so a value set afterwards would be read by nothing. An option
      // left unset contributes no key, so the app's own layering still decides.
      if (args.port !== undefined) process.env.INTELIGIR_PORT = String(parsePort(args.port));
      if (args["data-dir"] !== undefined) {
        process.env.INTELIGIR_DATA_DIR = resolvePathFlag(args["data-dir"], cwd);
      }
      if (args.vault !== undefined) {
        process.env.INTELIGIR_VAULT_DIR = resolvePathFlag(args.vault, cwd);
      }

      const { serverUrl, uiUrl } = await runServe(readCliVersion());
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
      await systemOpenExternalUrl(uiUrl);
    },
  });
}
