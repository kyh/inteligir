// Points the codex adapter at the fake app-server, so runtime and manager
// tests exercise the REAL adapter, process manager, JSON-RPC framing and
// event translation against a deterministic child process.

import { fileURLToPath } from "node:url";
import { createCodexProviderAdapter } from "../codex/adapter";
import type { ProviderAdapterFactory } from "../runtime-provider-process";

export type FakeCodexMode = "happy" | "approval" | "approval-once" | "auth-once" | "hang";

export interface FakeCodexAdapterOptions {
  /** auth-once: the cross-process marker whose absence fails the first turn. */
  markerPath?: string;
}

function fakeCodexAppServerPath(): string {
  return fileURLToPath(new URL("fake-codex-app-server.mjs", import.meta.url));
}

export function createFakeCodexAdapterFactory(
  mode: FakeCodexMode = "happy",
  options?: FakeCodexAdapterOptions,
): ProviderAdapterFactory {
  return (providerId) => {
    if (providerId !== "codex") {
      throw new Error(`The fake codex factory only builds codex (got "${providerId}")`);
    }
    return createCodexProviderAdapter({
      processCommand: process.execPath,
      processArgs: [
        fakeCodexAppServerPath(),
        mode,
        ...(options?.markerPath !== undefined ? [options.markerPath] : []),
      ],
    });
  };
}
