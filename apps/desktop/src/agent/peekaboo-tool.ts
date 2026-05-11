/**
 * Peekaboo tool — proxies to the bundled `peekaboo` CLI binary for native
 * macOS GUI control (screenshots, click, type, window/app/menu inspection).
 *
 * `peekaboo` is installed to ~/.inteligir/bin/peekaboo by the agent-runtime
 * bootstrap. macOS-only; macOS 15 (Sequoia) or newer. Requires Screen
 * Recording and Accessibility permissions (peekaboo prompts on first use).
 *
 * The browser tool stays in charge of the web — peekaboo is for native apps
 * the user has open. The model is told this in AGENTS.md.
 */

import { execFile } from "node:child_process";
import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type { ExtensionAPI } from "@repo/pi-driver";

import { inteligirPath } from "@/main/lib/json-store";

const PEEKABOO_PATH = path.join(inteligirPath("bin"), "peekaboo");
const PEEKABOO_TIMEOUT_MS = 60_000;
const PEEKABOO_MAX_BUFFER = 50 * 1024 * 1024;

const PeekabooRunSchema = Type.Object({
  args: Type.Array(Type.String(), {
    description: "Arguments to pass to peekaboo, e.g. ['see'], ['click', '@e2'], ['type', 'hello'].",
  }),
  stdin: Type.Optional(Type.String({ description: "Optional stdin to pipe to peekaboo." })),
});

export function registerPeekabooExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "peekaboo",
    label: "peekaboo",
    description:
      "Native macOS GUI control via the peekaboo CLI — screenshot, click, type, " +
      "window/app/menu inspection. Use for native apps (Finder, Mail, Notes, Slack, " +
      "system settings); use the `browser` tool for the web. " +
      "Usage: peekaboo <command> [flags]. Start with ['see'] to inspect the current " +
      "window and discover element refs, then act with ['click'|'type'|'set-value'|...]. " +
      "Run [<command>, '--help'] to discover flags. Requires Screen Recording + " +
      "Accessibility permissions on first use.",
    parameters: PeekabooRunSchema,
    execute: async (_toolCallId, params: Static<typeof PeekabooRunSchema>) => {
      const text = (s: string) => ({
        content: [{ type: "text" as const, text: s }],
        details: {},
      });

      try {
        const { stdout, stderr, code } = await runPeekaboo(params.args, params.stdin);
        const parts: string[] = [];
        if (stdout) parts.push(stdout);
        if (stderr) parts.push(`[stderr]\n${stderr}`);
        if (code !== 0) parts.push(`[exit ${code}]`);
        return text(parts.join("\n\n") || "(no output)");
      } catch (err) {
        return text(`peekaboo error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}

function runPeekaboo(
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      PEEKABOO_PATH,
      args,
      { timeout: PEEKABOO_TIMEOUT_MS, maxBuffer: PEEKABOO_MAX_BUFFER },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("peekaboo binary not installed"));
          return;
        }
        // err.code is a number for normal non-zero exits, but a string for
        // system errors like "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" — only trust
        // numeric values; anything else means the child didn't run cleanly.
        const rawCode = (err as { code?: unknown } | null)?.code;
        const code = typeof rawCode === "number" ? rawCode : err ? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}
