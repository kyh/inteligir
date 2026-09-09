import path from "node:path";
import { defineCommand } from "citty";
import { invalidUsage } from "../cli-error";
import { readCliVersion } from "../paths";
import { parsePortValue } from "../server/config";
import type { ServeOverrides } from "../server/serve";
import { out, writeOut } from "../output";

// relative paths resolve against the invoking cwd because the config layer refuses them outright;
// `~` is left to that layer, since expanding it twice creates a literal `~` directory.
const resolvePathFlag = (value: string, cwd: string): string => {
  if (value === "~" || value.startsWith("~/")) {
    return value;
  }
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
};

// must accept what INTELIGIR_PORT accepts, but a bad flag is a usage error rather than a bad environment.
const parsePort = (raw: string): number => {
  try {
    return parsePortValue("--port", raw);
  } catch {
    throw invalidUsage(`--port must be a valid TCP port (got "${raw}")`);
  }
};

export const serveCommand = () =>
  defineCommand({
    args: {
      "data-dir": {
        description: "Where the database and settings live (default ~/.inteligir)",
        type: "string",
      },
      open: {
        description: "Open the workspace in a browser once it is listening",
        type: "boolean",
      },
      port: { description: "TCP port for the local server (default 4664)", type: "string" },
      vault: {
        description: "The vault: your markdown files (default ~/Inteligir)",
        type: "string",
      },
    },
    meta: {
      description: "Run the local server: the vault, the index, the agent and the API",
      name: "serve",
    },
    run: async ({ args }) => {
      const cwd = process.cwd();
      // an overlay, never a `process.env` write: a global write is inherited by every child this server spawns.
      const overrides: ServeOverrides = {};
      if (args.port !== undefined) {
        overrides.INTELIGIR_PORT = String(parsePort(args.port));
      }
      if (args["data-dir"] !== undefined) {
        overrides.INTELIGIR_DATA_DIR = resolvePathFlag(args["data-dir"], cwd);
      }
      if (args.vault !== undefined) {
        overrides.INTELIGIR_VAULT_DIR = resolvePathFlag(args.vault, cwd);
      }

      // dynamic import: a static one makes every client verb load hono, drizzle and the runtimes before reading argv (~60ms each).
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
      // not fatal: a machine with no browser must not take the server down, and the URL is already printed.
      const { systemOpenExternalUrl } = await import("../server/cloud/browser-opener");
      await systemOpenExternalUrl(uiUrl);
    },
  });
