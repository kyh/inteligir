import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ORPCError } from "@orpc/client";
import {
  vaultStatusResponseSchema,
  type VaultStatusResponse,
  type VaultTreeResponse,
} from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import {
  filePathsLowercased,
  firstRootDoc,
  renameVaultEntry,
  syncStateLabel,
  untitledNotePath,
  type RenameVaultApi,
} from "../vault-hooks";

const tree = (...paths: string[]): VaultTreeResponse => ({
  root: "/home/kyh/vault",
  name: "vault",
  entries: paths.map((path) =>
    path.endsWith("/")
      ? { kind: "dir" as const, path: path.slice(0, -1) }
      : { kind: "file" as const, path },
  ),
});

describe("the note a virgin boot opens", () => {
  // The whole bug: the server indexes and lists .txt/.markdown/.mdx as docs,
  // so a root holding only one of them has a note to open — a client that
  // knows only `.md` boots the vault to an empty pane.
  it("opens any doc the server would index, not just .md", () => {
    expect(firstRootDoc(tree("README.txt"))).toBe("README.txt");
    expect(firstRootDoc(tree("spec.markdown"))).toBe("spec.markdown");
    expect(firstRootDoc(tree("page.mdx"))).toBe("page.mdx");
  });

  it("skips folders, nested files and non-docs", () => {
    expect(firstRootDoc(tree("notes/", "notes/deep.md", "logo.png", "Welcome.md"))).toBe(
      "Welcome.md",
    );
    expect(firstRootDoc(tree("logo.png"))).toBeNull();
  });

  it("answers null while the listing has not arrived", () => {
    expect(firstRootDoc(undefined)).toBeNull();
  });
});

/** The port `renameVaultEntry` declares — one procedure, so a stub is a
 *  function rather than a mocked client. */
function renameApi(answer: () => Promise<{ path: string; rewritten: string[] }>): RenameVaultApi {
  return { vault: { rename: answer } };
}

describe("renaming a vault entry", () => {
  // A surface that words the refusal itself ("that name is already taken")
  // drops the half the user needs — WHICH target — and nothing the server
  // ever adds to that sentence reaches them.
  it("carries the server's refusal, verbatim", async () => {
    const api = renameApi(() =>
      Promise.reject(
        new ORPCError("CONFLICT", { message: "Target already exists: notes/plans.md" }),
      ),
    );
    const outcome = await renameVaultEntry(api, "notes/ideas.md", "notes/plans.md");
    expect(outcome).toEqual({
      ok: false,
      message: "Target already exists: notes/plans.md",
    });
  });

  it("falls back only when the failure carries no sentence of its own", async () => {
    const api = renameApi(() => Promise.reject(new Error("")));
    const outcome = await renameVaultEntry(api, "notes/ideas.md", "notes/plans.md");
    expect(outcome).toEqual({ ok: false, message: "Could not rename notes/ideas.md." });
  });

  it("reports a rename that landed", async () => {
    const api = renameApi(() => Promise.resolve({ path: "b.md", rewritten: [] }));
    await expect(renameVaultEntry(api, "a.md", "b.md")).resolves.toEqual({ ok: true });
  });
});

const SYNC_FIELDS = { lastSyncAt: null, lastError: null };
const REMOTE = { remote: "git@example.com:vault.git", ...SYNC_FIELDS };

const EVERY_STATUS: readonly VaultStatusResponse[] = [
  { state: "no-remote", ...SYNC_FIELDS },
  { state: "clean", ...REMOTE },
  { state: "dirty", ...REMOTE },
  { state: "syncing", ...REMOTE },
  { state: "held", ...REMOTE },
  { state: "offline", ...REMOTE },
  {
    state: "conflict",
    conflict: { files: ["a.md", "b.md"], ours: { commits: 1 }, theirs: { commits: 1 } },
    ...REMOTE,
  },
  { state: "broken", ...REMOTE },
];

const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");

describe("naming a sync state", () => {
  it("covers every state the contract can answer", () => {
    // Derived from the union rather than counted by hand, so a ninth state
    // fails here instead of rendering as nothing.
    expect(new Set(EVERY_STATUS.map((status) => status.state)).size).toBe(
      vaultStatusResponseSchema.options.length,
    );
    for (const status of EVERY_STATUS) {
      expect(syncStateLabel(status).length).toBeGreaterThan(0);
    }
  });

  // Two tables over eight states drift, and the drift is invisible until one
  // vault answers two sentences in two pieces of the same window — which a
  // reader cannot tell from two different states.
  it.each(["src/app/sidebar/sidebar.tsx", "src/app/settings/settings-page.tsx"])(
    "%s writes none of the sentences itself",
    (relative) => {
      const source = readFileSync(join(REPO_ROOT, "apps/app", relative), "utf8");
      for (const status of EVERY_STATUS) {
        // Before the interpolated count, so the conflict label is matched by
        // the part that is not a number.
        const sentence = syncStateLabel(status).split(" (")[0] ?? "";
        expect(source).not.toContain(sentence);
      }
    },
  );

  it("keeps that sweep honest — the sentences are in vault-hooks", () => {
    const source = readFileSync(join(REPO_ROOT, "apps/app/src/app/vault-hooks.ts"), "utf8");
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
