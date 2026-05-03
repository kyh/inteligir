/**
 * Google Workspace tool — proxies to the bundled `gws` CLI binary.
 *
 * `gws` is installed to ~/.inteligir/bin/gws by the agent-runtime bootstrap.
 * This extension lets users toggle Google Workspace access on/off from the
 * extensions panel; the agent could also reach gws via bash, but exposing a
 * dedicated tool gives a clearer affordance.
 */

import { execFile } from "node:child_process";
import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionAPI } from "@repo/pi-driver";

import { inteligirPath } from "@/main/lib/json-store";

const GWS_PATH = path.join(inteligirPath("bin"), "gws");
const GWS_TIMEOUT_MS = 60_000;
const GWS_MAX_BUFFER = 10 * 1024 * 1024;

const GwsRunSchema = Type.Object({
  args: Type.Array(Type.String(), {
    description:
      "Arguments to pass to gws, e.g. ['drive', 'files', 'list', '--params', '{\"pageSize\":10}']. Run with ['--help'] or [<service>, '--help'] to discover commands.",
  }),
  stdin: Type.Optional(
    Type.String({ description: "Optional stdin to pipe to gws." }),
  ),
});

export function registerGwsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "gws",
    label: "gws",
    description:
      "Google Workspace CLI — Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts, Chat, Meet, Admin. " +
      "Usage: gws <service> <resource> [sub-resource] <method> [flags]. " +
      "Run ['auth', 'status'] first; if not authenticated, ['auth', 'login']. " +
      "Run [<service>, '--help'] to discover commands.",
    parameters: GwsRunSchema,
    execute: async (_toolCallId, params: Static<typeof GwsRunSchema>) => {
      const text = (s: string) => ({
        content: [{ type: "text" as const, text: s }],
        details: {},
      });

      try {
        const { stdout, stderr, code } = await runGws(params.args, params.stdin);
        const parts: string[] = [];
        if (stdout) parts.push(stdout);
        if (stderr) parts.push(`[stderr]\n${stderr}`);
        if (code !== 0) parts.push(`[exit ${code}]`);
        return text(parts.join("\n\n") || "(no output)");
      } catch (err) {
        return text(
          `gws error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  });
}

function runGws(
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      GWS_PATH,
      args,
      { timeout: GWS_TIMEOUT_MS, maxBuffer: GWS_MAX_BUFFER },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("gws binary not installed"));
          return;
        }
        const code =
          (err as { code?: number } | null)?.code ??
          (err ? 1 : 0);
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}
