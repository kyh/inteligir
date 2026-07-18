// ---------------------------------------------------------------------------
// Account-boundary guard (#459): the Better Auth account gates ONLY cloud
// saves. This test walks the repo's source and asserts every reference to the
// account layer — the SyncAccount client, its session file, the sign-in/out
// Bridge channels, and the `signedIn` state — lives inside the sync layer or
// the Account/Sync settings sections. Any other feature reaching for the
// account (AI, editor, delegation, vault, …) fails here BEFORE it can ship a
// gate the product forbids. The import-direction half of the decouple is also
// pinned: the provider layer never imports sync, and sync never imports the
// provider layer — so provider disconnect and account sign-out CANNOT touch
// each other's storage.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

/** Source trees the guard sweeps (product code on every platform). */
const SCANNED_DIRS = [
  "packages/features/src",
  "packages/core/src",
  "packages/ui/src",
  "apps/desktop/src",
  "apps/desktop/dev",
  "apps/mobile/src",
  "apps/web/src",
];

const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".cache", ".output", ".expo", "coverage"]);

/** Account-layer tokens: the client class, its singleton, the session file,
 * the auth Bridge channels, and the signed-in flag. Deliberately NOT the
 * whole sync vocabulary — sync lifecycle wiring (getSyncCoordinator in the
 * composition root) is fine; consuming the ACCOUNT is what's fenced. */
const ACCOUNT_TOKENS =
  /\bSyncAccount\b|\bgetSyncAccount\b|sync-auth|\bsyncSignIn\b|\bsyncSignUp\b|\bsyncSignOut\b|\bsyncSocialSignIn\b|\bgetAccountCapabilities\b|\bsignedIn\b/;

/** The ONLY places allowed to speak the account vocabulary. */
const ALLOWED = [
  // The account+sync layer itself (client, coordinator, their tests).
  "packages/features/src/server/sync/",
  // The Bridge surface: wire contract, channel table, host handlers.
  "packages/features/src/sync.ts",
  "packages/features/src/ipc-registry.ts",
  "packages/features/src/server/handlers/sync-handlers.ts",
  // The two settings surfaces: Account owns the session, Sync consumes it.
  "apps/desktop/src/renderer/settings/sections/account-section.tsx",
  "apps/desktop/src/renderer/settings/sections/sync-section.tsx",
  // The dev-harness Bridge must implement every channel by contract.
  "apps/desktop/dev/fixture-bridge.ts",
  // This guard names the tokens it hunts.
  "packages/features/src/server/__tests__/account-boundary.test.ts",
];

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR_NAMES.has(entry.name)) walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function sourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  return files;
}

function rel(file: string): string {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

describe("account boundary (#459)", () => {
  it("only the sync layer and the Account/Sync settings sections reference the account", () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const relative = rel(file);
      if (ALLOWED.some((allowed) => relative.startsWith(allowed))) continue;
      const content = fs.readFileSync(file, "utf8");
      const match = ACCOUNT_TOKENS.exec(content);
      if (match) violations.push(`${relative} → "${match[0]}"`);
    }
    expect(
      violations,
      `Account references outside the sync layer — the account may gate ONLY cloud saves:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("provider layer and sync layer never import each other (teardown decouple)", () => {
    const providerDir = path.join(REPO_ROOT, "packages/features/src/server/provider");
    const syncDir = path.join(REPO_ROOT, "packages/features/src/server/sync");
    const agentAuth = path.join(REPO_ROOT, "packages/features/src/server/agent/auth.ts");

    const providerFiles: string[] = [];
    walk(providerDir, providerFiles);
    providerFiles.push(agentAuth);
    for (const file of providerFiles) {
      expect(fs.readFileSync(file, "utf8"), `${rel(file)} must not import sync`).not.toMatch(
        /from "[^"]*\/sync\//,
      );
    }

    const syncFiles: string[] = [];
    walk(syncDir, syncFiles);
    for (const file of syncFiles) {
      expect(
        fs.readFileSync(file, "utf8"),
        `${rel(file)} must not import the provider/agent-auth layer`,
      ).not.toMatch(/from "[^"]*\/(provider|agent)\//);
    }
  });
});
