/**
 * Google Workspace extension — proxies to the bundled `gws` CLI binary.
 *
 * setup() downloads the binary into ctx.binDir and seeds the OAuth
 * client_secret from ctx.bundledResourcesDir. The generic installer in
 * @repo/agent-runtime swallows install failures so onboarding still
 * succeeds offline; the agent's bash tool will surface "gws: command not
 * found" later.
 *
 * Bundle is non-critical — a failed install logs and continues. The tool
 * itself reports ENOENT on first invocation if the binary is missing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import { installCliFromGithubRelease } from "@repo/agent-runtime/install";
import { runCli } from "@repo/agent-runtime/run-cli";
import { seedFile } from "@repo/agent-runtime/seed";

import type { PiExtensionBundle } from "@/agent/extension";

const GWS_VERSION = "0.22.5";
const GWS_TIMEOUT_MS = 60_000;
const GWS_MAX_BUFFER = 10 * 1024 * 1024;

// gws expects its OAuth client_secret at this fixed path — it's the CLI's
// own convention, not Inteligir's. Don't move it under ~/.inteligir.
const GWS_CONFIG_DIR = path.join(os.homedir(), ".config", "gws");

const GwsRunSchema = Type.Object({
  args: Type.Array(Type.String(), {
    description:
      "Arguments to pass to gws, e.g. ['drive', 'files', 'list', '--params', '{\"pageSize\":10}']. Run with ['--help'] or [<service>, '--help'] to discover commands.",
  }),
  stdin: Type.Optional(Type.String({ description: "Optional stdin to pipe to gws." })),
});

const gwsExtension: PiExtensionBundle = {
  name: "gws",
  setup: async ({ binDir, bundledResourcesDir }) => {
    await installCliFromGithubRelease({
      owner: "googleworkspace",
      repo: "cli",
      version: GWS_VERSION,
      binName: "gws",
      binDir,
      artifactName: gwsArtifactName,
    });
    seedClientSecret(bundledResourcesDir);
  },
  register: ({ binDir }) => {
    const gwsPath = path.join(binDir, "gws");

    return (pi) => {
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
            const { stdout, stderr, code } = await runCli(gwsPath, params.args, {
              timeoutMs: GWS_TIMEOUT_MS,
              maxBuffer: GWS_MAX_BUFFER,
              stdin: params.stdin,
              notFoundMessage: "gws binary not installed",
            });
            const parts: string[] = [];
            if (stdout) parts.push(stdout);
            if (stderr) parts.push(`[stderr]\n${stderr}`);
            if (code !== 0) parts.push(`[exit ${code}]`);
            return text(parts.join("\n\n") || "(no output)");
          } catch (err) {
            return text(`gws error: ${err instanceof Error ? err.message : String(err)}`);
          }
        },
      });
    };
  },
};

export default gwsExtension;

function gwsArtifactName(): string | null {
  if (process.platform !== "darwin") return null;
  switch (process.arch) {
    case "arm64":
      return "google-workspace-cli-aarch64-apple-darwin.tar.gz";
    case "x64":
      return "google-workspace-cli-x86_64-apple-darwin.tar.gz";
    default:
      return null;
  }
}

function seedClientSecret(bundledResourcesDir: string): void {
  const src = path.join(bundledResourcesDir, "client_secret.json");
  if (!fs.existsSync(src)) {
    console.warn("[gws] client_secret.json not found in bundled resources — OAuth will not work");
    return;
  }
  const dest = path.join(GWS_CONFIG_DIR, "client_secret.json");
  if (seedFile(src, dest)) {
    console.log(`[gws] seeded client_secret.json → ${dest}`);
  }
}
