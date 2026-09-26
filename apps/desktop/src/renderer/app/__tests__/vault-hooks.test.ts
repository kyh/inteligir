import { readFileSync } from "node:fs";
import path from "node:path";
import { ORPCError } from "@orpc/client";
import { DEFAULT_DOC_EXTENSION } from "@repo/notes/knowledge/doc-file";
import { vaultStatusResponseSchema } from "@repo/api/local/vault/vault-schema";
import type {
  ExternalSync,
  VaultEntry,
  VaultStatusResponse,
  VaultTreeResponse,
} from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import {
  filePathsLowercased,
  renameVaultEntry,
  syncNeedsAttention,
  syncStateDotClass,
  syncStateLabel,
  syncStateNote,
  untitledNotePath,
  vaultFolders,
  visibleEntries,
} from "../vault-hooks";
import type { RenameVaultApi } from "../vault-hooks";
import { rendererSources } from "./renderer-sources";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../../..");

const tree = (...paths: string[]): VaultTreeResponse => ({
  entries: paths.map((entry) =>
    entry.endsWith("/")
      ? { kind: "dir" as const, path: entry.slice(0, -1) }
      : { kind: "file" as const, path: entry },
  ),
  name: "vault",
  root: "/home/kyh/vault",
});

const EXTENSION = DEFAULT_DOC_EXTENSION.slice(1);
const PRIVATE_DOC_RULES: readonly RegExp[] = [
  new RegExp(`endsWith\\(["']\\.${EXTENSION}["']\\)`, "u"),
  new RegExp(`\\\\\\.${EXTENSION}\\$`, "u"),
];

describe("what the client calls a doc, and what it calls it by", () => {
  const files = rendererSources(path.join(REPO_ROOT, "apps/desktop/src/renderer"));

  it("finds the renderer at all", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(PRIVATE_DOC_RULES.map((rule) => [rule.source, rule] as const))(
    "no module spells its own %s",
    (_source, rule) => {
      const offenders = files
        .filter((file) => rule.test(readFileSync(file, "utf-8")))
        .map((file) => file.slice(REPO_ROOT.length + 1));
      expect(
        offenders,
        "@repo/notes/knowledge/doc-file answers this — isDocPath / docStem",
      ).toEqual([]);
    },
  );
});

const renameApi = (answer: () => { path: string; rewritten: string[] }): RenameVaultApi => ({
  vault: { rename: async () => answer() },
});

describe("renaming a vault entry", () => {
  it("carries the server's refusal, verbatim", async () => {
    const api = renameApi(() => {
      throw new ORPCError("CONFLICT", { message: "Target already exists: notes/plans.md" });
    });
    const outcome = await renameVaultEntry(api, "notes/ideas.md", "notes/plans.md");
    expect(outcome).toEqual({ error: "Target already exists: notes/plans.md", ok: false });
  });

  it("falls back only when the failure carries no sentence of its own", async () => {
    const api = renameApi(() => {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "" });
    });
    const outcome = await renameVaultEntry(api, "notes/ideas.md", "notes/plans.md");
    expect(outcome).toEqual({ error: "Could not rename notes/ideas.md.", ok: false });
  });

  it("reports a rename that landed", async () => {
    const api = renameApi(() => ({ path: "b.md", rewritten: [] }));
    await expect(renameVaultEntry(api, "a.md", "b.md")).resolves.toEqual({ ok: true });
  });
});

const SYNC_FIELDS = { conflicts: [], device: "This Mac", lastError: null, lastSyncAt: null };
const REMOTE = {
  remote: "git@example.com:vault.git",
  remoteSource: "explicit" as const,
  ...SYNC_FIELDS,
};

const EVERY_STATUS: readonly VaultStatusResponse[] = [
  { externalSync: null, state: "no-remote", ...SYNC_FIELDS },
  { state: "clean", ...REMOTE },
  { state: "dirty", ...REMOTE },
  { state: "syncing", ...REMOTE },
  { state: "held", ...REMOTE },
  { state: "offline", ...REMOTE },
  { state: "unauthorized", ...REMOTE },
  { state: "unauthorized", ...REMOTE, remoteSource: "account" },
  { state: "rejected", ...REMOTE },
  { state: "too-large", ...REMOTE },
  { state: "too-large", ...REMOTE, remoteSource: "account" },
  { state: "account-mismatch", ...REMOTE },
  { state: "detached", ...REMOTE },
  { state: "broken", ...REMOTE },
];

describe("naming a sync state", () => {
  it("covers every state the contract can answer", () => {
    expect(new Set(EVERY_STATUS.map((status) => status.state)).size).toBe(
      vaultStatusResponseSchema.options.length,
    );
    for (const status of EVERY_STATUS) {
      expect(syncStateLabel(status).length).toBeGreaterThan(0);
    }
  });

  it.each(["app/sidebar/sidebar.tsx", "app/settings/settings-page.tsx"])(
    "%s writes none of the sentences itself",
    (relative) => {
      const source = readFileSync(
        path.join(REPO_ROOT, "apps/desktop/src/renderer", relative),
        "utf-8",
      );
      for (const status of EVERY_STATUS) {
        expect(source).not.toContain(syncStateLabel(status));
      }
    },
  );

  it("keeps that sweep honest — the sentences are in vault-hooks", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "apps/desktop/src/renderer/app/vault-hooks.ts"),
      "utf-8",
    );
    for (const status of EVERY_STATUS) {
      expect(source).toContain(syncStateLabel(status));
    }
  });
});

// what a failed pass leaves in `lastError`: git's own stderr, naming its machinery
const GIT_STDERR =
  "fatal: unable to access 'https://example.com/vault.git/': error: failed to push some refs to origin (HEAD detached)";
const ENGINE_WORDS = /\b(?:git|remote|push|pull|rebase|HEAD|branch|commit|sha|detached|origin)\b/iu;

describe("what the rail and a toast say about sync", () => {
  it("never speaks git, and never repeats the engine's own error", () => {
    for (const status of EVERY_STATUS) {
      const failed: VaultStatusResponse = { ...status, lastError: GIT_STDERR };
      for (const said of [syncStateLabel(failed), syncStateNote(failed)?.message ?? ""]) {
        expect(said, failed.state).not.toMatch(ENGINE_WORDS);
        expect(said, failed.state).not.toContain(GIT_STDERR);
      }
    }
  });

  it("offers the details exactly where the dot says something is wrong", () => {
    for (const status of EVERY_STATUS) {
      expect(syncNeedsAttention(status), status.state).toBe(
        syncStateDotClass(status) === "bg-destructive",
      );
    }
  });

  it("leaves the engine's last error to Settings › Advanced alone", () => {
    const rendererDir = path.join(REPO_ROOT, "apps/desktop/src/renderer");
    const readers = rendererSources(rendererDir)
      .filter((file) => /\.lastError\b/u.test(readFileSync(file, "utf-8")))
      .map((file) => path.relative(rendererDir, file));
    expect(
      readers,
      "a sync's last error is the engine's own words, raw: only settings/advanced-section.tsx shows it",
    ).toEqual(["app/settings/advanced-section.tsx"]);
  });
});

describe("a folder another service syncs", () => {
  const SERVICES: readonly (readonly [ExternalSync, string])[] = [
    [{ kind: "icloud-drive" }, "Synced by iCloud Drive"],
    [{ kind: "icloud-desktop-documents" }, "Synced by iCloud Drive"],
    [{ kind: "dropbox" }, "Synced by Dropbox"],
    [{ kind: "google-drive" }, "Synced by Google Drive"],
    [{ kind: "onedrive" }, "Synced by OneDrive"],
    [{ kind: "cloud-storage", provider: "Box" }, "Synced by Box"],
    [{ kind: "obsidian-sync" }, "Synced by Obsidian Sync"],
  ];

  it.each(SERVICES)("names %o where a vault alone says Only on this Mac", (externalSync, label) => {
    const status: VaultStatusResponse = {
      conflicts: [],
      device: "This Mac",
      externalSync,
      lastError: GIT_STDERR,
      lastSyncAt: null,
      state: "no-remote",
    };
    expect(syncStateLabel(status)).toBe(label);
    const note = syncStateNote(status);
    expect(note?.tone).toBe("info");
    for (const said of [syncStateLabel(status), note?.message ?? ""]) {
      expect(said).not.toMatch(ENGINE_WORDS);
      expect(said).not.toContain(GIT_STDERR);
    }
    // sync is the service's here, so there is nothing to sign in to and nothing wrong
    expect(note?.message).not.toMatch(/sign in/iu);
    expect(syncNeedsAttention(status)).toBe(false);
  });
});

describe("naming a new note", () => {
  it("counts up until the folder has no such file", () => {
    const existing = filePathsLowercased(tree("Untitled.md", "notes/Untitled 2.md"));
    expect(untitledNotePath("", existing)).toBe("Untitled 2.md");
    expect(untitledNotePath("notes", existing)).toBe("notes/Untitled.md");
  });
});

const LISTING: VaultEntry[] = [
  { kind: "dir", path: ".obsidian" },
  { kind: "file", path: ".obsidian/app.json" },
  { kind: "dir", path: "notes" },
  { kind: "dir", path: "notes/daily" },
  { kind: "file", path: "notes/daily/2026-08-16.md" },
  { kind: "file", path: "notes/ideas.md" },
  { kind: "file", path: "notes/ideas.md.comments.json" },
  { kind: "file", path: "Welcome.md" },
];

describe("what a listing shows", () => {
  it("hides what the user did not write, and shows everything else", () => {
    expect(visibleEntries(LISTING).map((entry) => entry.path)).toEqual([
      "notes",
      "notes/daily",
      "notes/daily/2026-08-16.md",
      "notes/ideas.md",
      "Welcome.md",
    ]);
  });

  it("offers the folders it shows, and no dot-dir", () => {
    expect(vaultFolders(LISTING)).toEqual(["notes", "notes/daily"]);
  });
});
