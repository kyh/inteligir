/**
 * Peekaboo extension — proxies to the bundled `peekaboo` CLI for native macOS
 * GUI control (screenshot, click, type, window/app/menu inspection).
 *
 * setup() downloads the universal macOS binary from openclaw/Peekaboo. The
 * generic installer in @repo/agent-runtime swallows install failures so
 * onboarding still succeeds offline; the tool below surfaces ENOENT on
 * first use if the binary is missing.
 *
 * Bundle is non-critical. macOS 15 (Sequoia) only; peekaboo prompts the
 * user for Accessibility + Screen Recording permissions on first invocation.
 */

import { execFile } from "node:child_process";
import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import { installCliFromGithubRelease } from "@repo/agent-runtime/install";

import type { PiExtensionBundle } from "@/agent/extension";

const PEEKABOO_VERSION = "3.0.0";
const PEEKABOO_TIMEOUT_MS = 60_000;
// Peekaboo's `see` command can dump large accessibility trees; 50MB is the
// observed ceiling for full-window dumps on dense apps.
const PEEKABOO_MAX_BUFFER = 50 * 1024 * 1024;

// Tarball nests the binary under a same-named directory.
const PEEKABOO_ASSET_DIR = "peekaboo-macos-universal";
const PEEKABOO_ARTIFACT = `${PEEKABOO_ASSET_DIR}.tar.gz`;

const PeekabooRunSchema = Type.Object({
  args: Type.Array(Type.String(), {
    description: "Arguments to pass to peekaboo, e.g. ['see'], ['click', '@e2'], ['type', 'hello'].",
  }),
  stdin: Type.Optional(Type.String({ description: "Optional stdin to pipe to peekaboo." })),
});

const peekabooExtension: PiExtensionBundle = {
  name: "peekaboo",
  setup: async ({ binDir }) => {
    await installCliFromGithubRelease({
      owner: "openclaw",
      repo: "Peekaboo",
      version: PEEKABOO_VERSION,
      binName: "peekaboo",
      binDir,
      artifactName: () => (process.platform === "darwin" ? PEEKABOO_ARTIFACT : null),
      archiveBinPath: `${PEEKABOO_ASSET_DIR}/peekaboo`,
      verify: "checksums-txt",
    });
  },
  register: ({ binDir }) => {
    const peekabooPath = path.join(binDir, "peekaboo");

    return (pi) => {
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
            const { stdout, stderr, code } = await runPeekaboo(peekabooPath, params.args, params.stdin);
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
    };
  },
};

export default peekabooExtension;

function runPeekaboo(
  peekabooPath: string,
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      peekabooPath,
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
