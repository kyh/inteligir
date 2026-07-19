/**
 * Peekaboo extension — proxies to the bundled `peekaboo` CLI for native macOS
 * GUI control (screenshot, click, type, window/app/menu inspection).
 *
 * setup() downloads the universal macOS binary from openclaw/Peekaboo. The
 * generic installer in agent-runtime/install.ts swallows install failures so
 * onboarding still succeeds offline; the tool below surfaces ENOENT on
 * first use if the binary is missing.
 *
 * Bundle is non-critical. macOS 15 (Sequoia) only; peekaboo prompts the
 * user for Accessibility + Screen Recording permissions on first invocation.
 */

import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import { toErrorMessage } from "@repo/features/wire-helpers";
import { installCliFromGithubRelease } from "@repo/features/server/agent-runtime/install";
import { runCli } from "@repo/features/server/agent-runtime/run-cli";

import { inteligirPath } from "../paths";
import type { PiExtensionBundle } from "../extension";
import { formatCliOutput, textResult } from "../extension-helpers";

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
    description:
      "Arguments to pass to peekaboo, e.g. ['see'], ['click', '@e2'], ['type', 'hello'].",
  }),
  stdin: Type.Optional(Type.String({ description: "Optional stdin to pipe to peekaboo." })),
});

const peekabooExtension: PiExtensionBundle = {
  name: "peekaboo",
  cli: { name: "peekaboo", version: PEEKABOO_VERSION, binPath: inteligirPath("bin", "peekaboo") },
  setup: async ({ binDir, force }) => {
    await installCliFromGithubRelease({
      owner: "openclaw",
      repo: "Peekaboo",
      version: PEEKABOO_VERSION,
      binName: "peekaboo",
      binDir,
      artifactName: () => (process.platform === "darwin" ? PEEKABOO_ARTIFACT : null),
      archiveBinPath: `${PEEKABOO_ASSET_DIR}/peekaboo`,
      verify: "checksums-txt",
      force,
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
          try {
            const result = await runCli(peekabooPath, params.args, {
              timeoutMs: PEEKABOO_TIMEOUT_MS,
              maxBuffer: PEEKABOO_MAX_BUFFER,
              stdin: params.stdin,
              notFoundMessage: "peekaboo binary not installed",
            });
            return textResult(formatCliOutput(result));
          } catch (err) {
            return textResult(`peekaboo error: ${toErrorMessage(err)}`);
          }
        },
      });
    };
  },
};

export default peekabooExtension;
