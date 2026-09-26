import type { VaultConflictReason } from "@repo/api/cloud/vault/vault-commit-schema";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { commitChanges } from "../vault/commit-changes";
import type { CommitChangesResult, VaultChange, VaultConflict } from "../vault/commit-changes";
import { blobObject } from "../vault/git-objects";
import { vaultRegistry, vaultRepoName } from "../vault/git-remote";
import { pushVaultPack } from "../vault/receive-pack";
import type { VaultPackPush } from "../vault/receive-pack";
import { encodeGitPath } from "../vault/tree-walk";
import { loginDevice, signUpUser, userIdOf } from "./cloud-helpers";
import { pushVaultFiles, ZERO_OID } from "./git-pack";
import type { PushFile } from "./git-pack";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const AUTHORED_AT = 1_750_000_000_000;
const NOW = 1_750_000_060_000;

const oidOf = async (text: string): Promise<string> => {
  const blob = await blobObject(encoder.encode(text));
  return blob.oid;
};

const put = (path: string, base: string | null, text: string): VaultChange => ({
  base,
  bytes: encoder.encode(text),
  op: "put",
  path,
});

// bytes, not .text(): the runtime warns on reading a pack result as text
const reportOf = async (response: Response): Promise<string> =>
  decoder.decode(await response.arrayBuffer());

interface Vault {
  readonly credential: string;
  readonly deviceId: string;
  readonly userId: string;
  readonly repo: string;
  readonly initial: string;
}

let accounts = 0;

const openVault = async (files: readonly PushFile[]): Promise<Vault> => {
  accounts += 1;
  const { bearer } = await signUpUser(`commit-changes-${String(accounts)}@example.test`);
  const { credential, deviceId } = await loginDevice(bearer, "Phone");
  const pushed = await pushVaultFiles(credential, "vault: initialize", files, ZERO_OID);
  expect(await reportOf(pushed.response)).toContain("unpack ok");
  const userId = await userIdOf(bearer);
  return { credential, deviceId, initial: pushed.commit, repo: vaultRepoName(userId), userId };
};

const cellOf = (vault: Vault) => env.REPO.getByName(vault.repo);

interface CommitOptions {
  readonly deviceName?: string;
  // runs before each push reaches the cell, numbered from 1
  readonly raceWith?: (attempt: number) => Promise<void>;
}

const commit = async (
  vault: Vault,
  changes: readonly VaultChange[],
  { deviceName = "Phone", raceWith }: CommitOptions = {},
): Promise<{ result: CommitChangesResult; pushes: number }> => {
  const ctx = createExecutionContext();
  const door = {
    ctx,
    deviceId: vault.deviceId,
    env,
    registry: vaultRegistry(env),
    repo: vault.repo,
    userId: vault.userId,
  };
  let pushes = 0;
  const send = async (push: VaultPackPush) => {
    pushes += 1;
    await raceWith?.(pushes);
    return await pushVaultPack(door, push);
  };
  const result = await commitChanges({
    author: { deviceId: vault.deviceId, deviceName },
    authoredAt: AUTHORED_AT,
    changes,
    now: NOW,
    send,
    stub: cellOf(vault),
  });
  await waitOnExecutionContext(ctx);
  return { pushes, result };
};

const committed = (result: CommitChangesResult): string => {
  if (result.kind !== "committed") {
    throw new Error(`expected a commit, got ${JSON.stringify(result)}`);
  }
  return result.commit;
};

const commitOrFail = async (
  vault: Vault,
  changes: readonly VaultChange[],
  options?: CommitOptions,
): Promise<string> => {
  const { result } = await commit(vault, changes, options);
  return committed(result);
};

const conflictsOf = (result: CommitChangesResult): [string, VaultConflictReason][] => {
  if (result.kind !== "conflict") {
    throw new Error(`expected a conflict, got ${JSON.stringify(result)}`);
  }
  return result.conflicts.map((conflict: VaultConflict) => [conflict.path, conflict.reason]);
};

const headOf = async (vault: Vault): Promise<string> => {
  const head = await cellOf(vault).readCommit();
  if (head === null) {
    throw new Error("the vault has no head");
  }
  return head.oid;
};

const commitAt = async (vault: Vault, oid: string) => await cellOf(vault).readCommit(oid);

const textAt = async (vault: Vault, path: string): Promise<string | null> => {
  const blob = await cellOf(vault).readBlob(undefined, encodeGitPath(path));
  return blob === null ? null : decoder.decode(blob.data);
};

const listing = async (vault: Vault, folder = "") => {
  const tree = await cellOf(vault).listTree(undefined, encodeGitPath(folder));
  return tree?.entries ?? [];
};

describe("commitChanges against a real repo cell", () => {
  it("lands a put on its base as one commit on the head it read, the device as author and committer", async () => {
    const vault = await openVault([{ content: "one\n", path: "a.md" }]);
    const { pushes, result } = await commit(vault, [put("a.md", await oidOf("one\n"), "two\n")]);

    const oid = committed(result);
    expect(pushes).toBe(1);
    expect(result).toEqual({
      commit: oid,
      kind: "committed",
      results: [{ oid: await oidOf("two\n"), path: "a.md" }],
    });
    expect(await headOf(vault)).toBe(oid);
    expect(await textAt(vault, "a.md")).toBe("two\n");
    const landed = await commitAt(vault, oid);
    expect(landed?.parents).toEqual([vault.initial]);
    expect(landed?.subject).toBe("vault: update a.md");
    expect(landed?.author).toEqual({
      email: `device-${vault.deviceId}@inteligir.local`,
      name: "Phone",
      time: AUTHORED_AT / 1000,
      tz: "+0000",
    });
    expect(landed?.committer).toEqual({
      email: "cloud@inteligir.local",
      name: "Phone",
      time: NOW / 1000,
      tz: "+0000",
    });
  });

  it("creates on a null base, making every folder the path needs", async () => {
    const vault = await openVault([{ content: "# a\n", path: "a.md" }]);
    await commitOrFail(vault, [put("notes/2026/today.md", null, "# today\n")]);

    expect(await textAt(vault, "notes/2026/today.md")).toBe("# today\n");
    const root = await listing(vault);
    expect(root.map((entry) => [entry.name, entry.type])).toEqual([
      ["a.md", "blob"],
      ["notes", "tree"],
    ]);
  });

  it("prunes every folder a delete empties", async () => {
    const vault = await openVault([
      { content: "keep\n", path: "keep.md" },
      { content: "only\n", path: "old/deep/only.md" },
    ]);
    await commitOrFail(vault, [
      { base: await oidOf("only\n"), op: "delete", path: "old/deep/only.md" },
    ]);

    const root = await listing(vault);
    expect(root.map((entry) => entry.name)).toEqual(["keep.md"]);
  });

  it("keeps an updated file's mode and every untouched folder's oid", async () => {
    const vault = await openVault([
      { content: "echo\n", mode: "100755", path: "tool.sh" },
      { content: "# x\n", path: "archive/x.md" },
      { content: "# y\n", path: "archive/deep/y.md" },
    ]);
    const before = await listing(vault);
    await commitOrFail(vault, [
      put("tool.sh", await oidOf("echo\n"), "echo two\n"),
      put("notes/new.md", null, "# new\n"),
    ]);

    const after = await listing(vault);
    expect(after.find((entry) => entry.name === "tool.sh")?.mode).toBe("100755");
    expect(after.find((entry) => entry.name === "archive")?.oid).toBe(
      before.find((entry) => entry.name === "archive")?.oid,
    );
  });

  it("moves the bytes and the mode, and a rename that changes only case is not a collision", async () => {
    const vault = await openVault([
      { content: "run\n", mode: "100755", path: "script.sh" },
      { content: "# note\n", path: "Note.md" },
    ]);
    const oid = await commitOrFail(vault, [
      { base: await oidOf("run\n"), from: "script.sh", op: "move", to: "bin/run.sh" },
      { base: await oidOf("# note\n"), from: "Note.md", op: "move", to: "note.md" },
    ]);

    const landed = await commitAt(vault, oid);
    expect(landed?.subject).toBe("vault: update 4 files");
    const root = await listing(vault);
    expect(root.map((entry) => entry.name)).toEqual(["bin", "note.md"]);
    const bin = await listing(vault, "bin");
    expect(bin.map((entry) => [entry.name, entry.mode])).toEqual([["run.sh", "100755"]]);
  });

  it("answers a replayed set with the head that already holds it, pushing nothing", async () => {
    const vault = await openVault([
      { content: "one\n", path: "a.md" },
      { content: "gone\n", path: "b.md" },
      { content: "moving\n", path: "c.md" },
    ]);
    const changes: VaultChange[] = [
      put("a.md", await oidOf("one\n"), "two\n"),
      { base: await oidOf("gone\n"), op: "delete", path: "b.md" },
      { base: await oidOf("moving\n"), from: "c.md", op: "move", to: "d/c.md" },
    ];
    const first = await commit(vault, changes);
    const replay = await commit(vault, changes);

    expect(replay.pushes).toBe(0);
    expect(replay.result).toEqual(first.result);
    expect(await headOf(vault)).toBe(committed(first.result));
  });

  it("commits nothing when one change conflicts, and answers that note's bytes and device", async () => {
    const vault = await openVault([
      { content: "one\n", path: "a.md" },
      { content: "bee\n", path: "b.md" },
    ]);
    const { pushes, result } = await commit(vault, [
      put("a.md", await oidOf("one\n"), "two\n"),
      put("b.md", await oidOf("stale\n"), "mine\n"),
    ]);

    expect(pushes).toBe(0);
    expect(result).toEqual({
      conflicts: [
        {
          current: { content: "bee\n", oid: await oidOf("bee\n") },
          device: "Test",
          path: "b.md",
          reason: "changed",
        },
      ],
      head: vault.initial,
      kind: "conflict",
    });
    expect(await headOf(vault)).toBe(vault.initial);
  });

  it("names each refusal, and commits none of them", async () => {
    const vault = await openVault([
      { content: "one\n", path: "a.md" },
      { content: "# in\n", path: "folder/inside.md" },
      { content: "a.md", mode: "120000", path: "link.md" },
      { content: "# readme\n", path: "Readme.md" },
      { content: "# café\n", path: "café.md" },
    ]);
    const one = await oidOf("one\n");
    const cases: readonly (readonly [readonly VaultChange[], string, VaultConflictReason])[] = [
      [[put("a.md", null, "other\n")], "a.md", "exists"],
      [[put("gone.md", one, "x\n")], "gone.md", "missing"],
      [[{ base: await oidOf("stale\n"), op: "delete", path: "a.md" }], "a.md", "changed"],
      [[{ base: one, from: "gone.md", op: "move", to: "x.md" }], "gone.md", "missing"],
      [[{ base: one, from: "a.md", op: "move", to: "Readme.md" }], "Readme.md", "exists"],
      [[put("folder", null, "x\n")], "folder", "blocked"],
      [[put("a.md/x.md", null, "x\n")], "a.md/x.md", "blocked"],
      [[put("new", null, "x\n"), put("new/x.md", null, "y\n")], "new/x.md", "blocked"],
      [[put("link.md", await oidOf("a.md"), "x\n")], "link.md", "unwritable"],
      [[put(".git/config", null, "x\n")], ".git/config", "unwritable"],
      [[put(".inteligir-tmp-x.md", null, "x\n")], ".inteligir-tmp-x.md", "unwritable"],
      [[put("readme.md", null, "x\n")], "readme.md", "case-collision"],
      [[put("café.md", null, "x\n")], "café.md", "case-collision"],
      [[put("FOLDER/new.md", null, "x\n")], "FOLDER/new.md", "case-collision"],
      [[put("Doc.md", null, "x\n"), put("doc.md", null, "y\n")], "doc.md", "case-collision"],
    ];
    for (const [changes, path, reason] of cases) {
      const { pushes, result } = await commit(vault, changes);
      expect(pushes, path).toBe(0);
      expect(conflictsOf(result), path).toContainEqual([path, reason]);
    }
    expect(await headOf(vault)).toBe(vault.initial);
  });

  it("builds on a push that lands first on another path, keeping both files", async () => {
    const vault = await openVault([{ content: "one\n", path: "a.md" }]);
    let desktop = "";
    const { pushes, result } = await commit(vault, [put("a.md", await oidOf("one\n"), "phone\n")], {
      raceWith: async (attempt) => {
        if (attempt !== 1) {
          return;
        }
        const pushed = await pushVaultFiles(
          vault.credential,
          "vault: update desktop.md",
          [
            { content: "one\n", path: "a.md" },
            { content: "desk\n", path: "desktop.md" },
          ],
          vault.initial,
          { parent: vault.initial },
        );
        expect(await reportOf(pushed.response)).toContain("unpack ok");
        desktop = pushed.commit;
      },
    });

    expect(pushes).toBe(2);
    const landed = await commitAt(vault, committed(result));
    expect(landed?.parents).toEqual([desktop]);
    expect(await textAt(vault, "a.md")).toBe("phone\n");
    expect(await textAt(vault, "desktop.md")).toBe("desk\n");
  });

  it("turns a put into a conflict naming the device whose push took its path first", async () => {
    const vault = await openVault([{ content: "one\n", path: "a.md" }]);
    const base = await oidOf("one\n");
    const { pushes, result } = await commit(vault, [put("a.md", base, "phone\n")], {
      raceWith: async (attempt) => {
        if (attempt === 1) {
          await commitOrFail(vault, [put("a.md", base, "laptop\n")], { deviceName: "Laptop" });
        }
      },
    });

    expect(pushes).toBe(1);
    expect(result).toEqual({
      conflicts: [
        {
          current: { content: "laptop\n", oid: await oidOf("laptop\n") },
          device: "Laptop",
          path: "a.md",
          reason: "changed",
        },
      ],
      head: await headOf(vault),
      kind: "conflict",
    });
  });

  it("refuses to rebuild a folder whose names the cell cannot list byte for byte", async () => {
    const vault = await openVault([
      { content: "# a\n", path: "odd/a.md" },
      {
        content: "# b\n",
        segments: [encoder.encode("odd"), Uint8Array.of(0x62, 0xff, 0x2e, 0x6d, 0x64)],
      },
      { content: "# clean\n", path: "clean.md" },
    ]);
    const before = await listing(vault);

    const refused = await commit(vault, [put("odd/a.md", await oidOf("# a\n"), "# edited\n")]);
    expect(conflictsOf(refused.result)).toEqual([["odd/a.md", "unwritable"]]);

    await commitOrFail(vault, [put("clean.md", await oidOf("# clean\n"), "# edited\n")]);
    const after = await listing(vault);
    expect(after.find((entry) => entry.name === "odd")?.oid).toBe(
      before.find((entry) => entry.name === "odd")?.oid,
    );
  });

  it("gives up once the head has moved under three attempts", async () => {
    const vault = await openVault([{ content: "one\n", path: "a.md" }]);
    let files: PushFile[] = [{ content: "one\n", path: "a.md" }];
    const { pushes, result } = await commit(vault, [put("a.md", await oidOf("one\n"), "phone\n")], {
      raceWith: async (attempt) => {
        const head = await headOf(vault);
        files = [...files, { content: `${String(attempt)}\n`, path: `desk-${String(attempt)}.md` }];
        const pushed = await pushVaultFiles(vault.credential, "vault: update", files, head, {
          parent: head,
        });
        expect(await reportOf(pushed.response)).toContain("unpack ok");
      },
    });

    expect(pushes).toBe(3);
    expect(result).toEqual({ kind: "exhausted" });
  });

  it("answers no-head for a cell that holds no commit, and refuses a set naming a path twice", async () => {
    const args = {
      author: { deviceId: "device", deviceName: "Phone" },
      authoredAt: AUTHORED_AT,
      now: NOW,
      send: async () => {
        throw new Error("nothing to push onto");
      },
      stub: env.REPO.getByName("vault-commit-changes-never-pushed"),
    };
    expect(await commitChanges({ ...args, changes: [put("a.md", null, "x\n")] })).toEqual({
      kind: "no-head",
    });
    await expect(
      commitChanges({
        ...args,
        changes: [put("a.md", null, "x\n"), { base: "0".repeat(40), op: "delete", path: "a.md" }],
      }),
    ).rejects.toThrow("names a path twice");
  });
});
