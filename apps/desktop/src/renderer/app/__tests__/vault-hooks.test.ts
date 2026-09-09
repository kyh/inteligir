import { readFileSync } from "node:fs";
import path from "node:path";
import { ORPCError } from "@orpc/client";
import { DEFAULT_DOC_EXTENSION } from "@repo/notes/knowledge/doc-file";
import { vaultStatusResponseSchema } from "@repo/api/local/vault/vault-schema";
import type { VaultStatusResponse, VaultTreeResponse } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import {
  filePathsLowercased,
  renameVaultEntry,
  syncStateLabel,
  untitledNotePath,
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
    expect(outcome).toEqual({
      message: "Target already exists: notes/plans.md",
      ok: false,
    });
  });

  it("falls back only when the failure carries no sentence of its own", async () => {
    const api = renameApi(() => {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "" });
    });
    const outcome = await renameVaultEntry(api, "notes/ideas.md", "notes/plans.md");
    expect(outcome).toEqual({ message: "Could not rename notes/ideas.md.", ok: false });
  });

  it("reports a rename that landed", async () => {
    const api = renameApi(() => ({ path: "b.md", rewritten: [] }));
    await expect(renameVaultEntry(api, "a.md", "b.md")).resolves.toEqual({ ok: true });
  });
});

const SYNC_FIELDS = { lastError: null, lastSyncAt: null };
const REMOTE = {
  remote: "git@example.com:vault.git",
  remoteSource: "explicit" as const,
  ...SYNC_FIELDS,
};

const EVERY_STATUS: readonly VaultStatusResponse[] = [
  { state: "no-remote", ...SYNC_FIELDS },
  { state: "clean", ...REMOTE },
  { state: "dirty", ...REMOTE },
  { state: "syncing", ...REMOTE },
  { state: "held", ...REMOTE },
  { state: "offline", ...REMOTE },
  { state: "unauthorized", ...REMOTE },
  { state: "account-mismatch", ...REMOTE },
  {
    conflict: { files: ["a.md", "b.md"], ours: { commits: 1 }, theirs: { commits: 1 } },
    state: "conflict",
    ...REMOTE,
  },
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
        // the conflict label carries an interpolated count; match the part before it.
        const sentence = syncStateLabel(status).split(" (")[0] ?? "";
        expect(source).not.toContain(sentence);
      }
    },
  );

  it("keeps that sweep honest — the sentences are in vault-hooks", () => {
    const source = readFileSync(
      path.join(REPO_ROOT, "apps/desktop/src/renderer/app/vault-hooks.ts"),
      "utf-8",
    );
    for (const status of EVERY_STATUS) {
      expect(source).toContain(syncStateLabel(status).split(" (")[0] ?? "");
    }
  });
});

describe("naming a new note", () => {
  it("counts up until the folder has no such file", () => {
    const existing = filePathsLowercased(tree("Untitled.md", "notes/Untitled 2.md"));
    expect(untitledNotePath("", existing)).toBe("Untitled 2.md");
    expect(untitledNotePath("notes", existing)).toBe("notes/Untitled.md");
  });
});
