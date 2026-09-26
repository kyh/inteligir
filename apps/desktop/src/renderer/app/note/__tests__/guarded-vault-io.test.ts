import { readFile } from "node:fs/promises";
import path from "node:path";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import type { VaultWriteRequest } from "@repo/api/local/vault/vault-schema";
import { createGuardedVaultIo } from "@repo/editor/guarded-vault-io";
import { createNoteRuntime } from "@repo/editor/note/note-runtime";
import { bootTestApp } from "inteligir/server/testing";
import type { BootedTestApp } from "inteligir/server/testing";
import { describe, expect, it, vi } from "vitest";
import { createGuardedVaultPort } from "../guarded-vault-io";
import type { GuardedVaultApi } from "../guarded-vault-io";

// the editor's write policy over this adapter, against a real server's CAS: the policy's own
// suite runs over a fake store (packages/editor/src/__tests__/guarded-vault-io.test.ts).
const recordingWrites = (client: BootedTestApp["client"]) => {
  const sent: VaultWriteRequest[] = [];
  const api: GuardedVaultApi = {
    vault: {
      read: client.vault.read,
      remove: client.vault.remove,
      write: async (input, ...rest) => {
        sent.push(input);
        return await client.vault.write(input, ...rest);
      },
    },
  };
  return { io: createGuardedVaultIo(createGuardedVaultPort(api)), sent };
};

const NOTE = "notes/plans.md";
const BASE = "# Plans\n\nintro\n\nfooter\n";
const EXTERNAL = `${BASE}external-appended-line\n`;

describe("the guarded vault port over the local server", () => {
  it("creates under the absent guard with no base, and answers exists where a file already is", async () => {
    const { client, vaultDir } = await bootTestApp();
    const { io, sent } = recordingWrites(client);

    expect(await io.create(NOTE, "# Plans\n")).toStrictEqual({ kind: "created" });
    expect(sent).toStrictEqual([{ content: "# Plans\n", guard: { kind: "absent" }, path: NOTE }]);
    expect(await readFile(path.join(vaultDir, NOTE), "utf-8")).toBe("# Plans\n");

    expect(await io.create(NOTE, "clobber")).toStrictEqual({ kind: "exists" });
    expect(await readFile(path.join(vaultDir, NOTE), "utf-8")).toBe("# Plans\n");
  });

  it("writes with the hash of the base it read, then of what it wrote", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: "v1", guard: { kind: "overwrite" }, path: NOTE });
    const { io, sent } = recordingWrites(client);

    expect(await io.read(NOTE)).toBe("v1");
    expect(await io.write(NOTE, "v2")).toStrictEqual({
      conflicted: false,
      content: "v2",
      kind: "landed",
    });
    expect(await io.write(NOTE, "v3")).toStrictEqual({
      conflicted: false,
      content: "v3",
      kind: "landed",
    });
    expect(sent).toStrictEqual([
      { content: "v2", guard: { hash: await contentHashHex("v1"), kind: "expected" }, path: NOTE },
      { content: "v3", guard: { hash: await contentHashHex("v2"), kind: "expected" }, path: NOTE },
    ]);
    expect(await readFile(path.join(vaultDir, NOTE), "utf-8")).toBe("v3");
  });

  it("merges a CAS refusal's current bytes with diff3 and retries against them", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: BASE, guard: { kind: "overwrite" }, path: NOTE });
    const { io, sent } = recordingWrites(client);
    await io.read(NOTE);

    await client.vault.write({ content: EXTERNAL, guard: { kind: "overwrite" }, path: NOTE });

    const landed = await io.write(NOTE, "# Plans\n\nintro rewritten\n\nfooter\n");

    expect(sent.map((request) => request.guard)).toStrictEqual([
      { hash: await contentHashHex(BASE), kind: "expected" },
      { hash: await contentHashHex(EXTERNAL), kind: "expected" },
    ]);
    const onDisk = await readFile(path.join(vaultDir, NOTE), "utf-8");
    expect(landed).toStrictEqual({ conflicted: false, content: onDisk, kind: "landed" });
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    expect(onDisk).not.toContain("\nintro\n");
  });

  it("carries a keystroke typed during a rename to the new path, keeping the alias the move wrote", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: BASE, guard: { kind: "overwrite" }, path: NOTE });
    const runtime = createNoteRuntime(NOTE, recordingWrites(client).io, {
      onVanished: () => {},
    });
    await vi.waitFor(() => {
      expect(runtime.controller.getState()).toMatchObject({ path: NOTE });
    });
    const moved = "notes/roadmap.md";

    runtime.suspend();
    await client.vault.rename({ from: NOTE, to: moved });
    runtime.edit(`${BASE}typed during the move\n`);
    await runtime.resume(moved);

    const onDisk = await readFile(path.join(vaultDir, moved), "utf-8");
    expect(onDisk).toContain("typed during the move");
    expect(onDisk).toContain("aliases:");
    expect(runtime.controller.getState()).toMatchObject({
      content: onDisk,
      dirty: false,
      path: moved,
      saveError: null,
    });
    runtime.dispose();
  });

  it("names a write to a note deleted since it was read as vanished, and never recreates it", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: "v1", guard: { kind: "overwrite" }, path: NOTE });
    const { io } = recordingWrites(client);
    await io.read(NOTE);
    await client.vault.remove({ path: NOTE });

    expect(await io.write(NOTE, "v2")).toStrictEqual({ kind: "vanished" });
    await expect(readFile(path.join(vaultDir, NOTE), "utf-8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("counts a remove of a note already gone as done", async () => {
    const { client } = await bootTestApp();
    const { io } = recordingWrites(client);

    await expect(io.remove(NOTE)).resolves.toBeUndefined();
  });
});
