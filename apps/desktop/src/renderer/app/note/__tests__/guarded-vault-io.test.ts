import { readFile } from "node:fs/promises";
import path from "node:path";
import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import type { VaultWriteRequest } from "@repo/api/local/vault/vault-schema";
import { createNoteRuntime } from "@repo/editor/note/note-runtime";
import { VaultEditorController } from "@repo/editor/vault-editor";
import { bootTestApp } from "inteligir/server/testing";
import type { BootedTestApp } from "inteligir/server/testing";
import { describe, expect, it, vi } from "vitest";
import { createGuardedVaultIo } from "../guarded-vault-io";
import type { GuardedVaultApi } from "../guarded-vault-io";

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
  return { api, sent };
};

// a read waits at the gate while one is held, so a test can act between a reload's request and its answer.
const gatedReads = (client: BootedTestApp["client"]) => {
  let gate: PromiseWithResolvers<void> | null = null;
  const api: GuardedVaultApi = {
    vault: {
      read: async (input, ...rest) => {
        await gate?.promise;
        return await client.vault.read(input, ...rest);
      },
      remove: client.vault.remove,
      write: client.vault.write,
    },
  };
  const hold = (): PromiseWithResolvers<void> => {
    gate = Promise.withResolvers();
    return gate;
  };
  return { api, hold };
};

const NOTE = "notes/plans.md";
const BASE = "# Plans\n\nintro\n\nfooter\n";
const EXTERNAL = `${BASE}external-appended-line\n`;

// the surface stands in for the rich editor: what it types waits in its serialize debounce
// until the runtime drains it.
const openRuntime = async (api: GuardedVaultApi) => {
  const runtime = createNoteRuntime(NOTE, createGuardedVaultIo(api), {
    onVanished: () => {},
  });
  let held: string | null = null;
  runtime.registerPreFlush(() => {
    if (held !== null) {
      runtime.edit(held);
      held = null;
    }
  });
  await vi.waitFor(() => {
    expect(runtime.controller.getState()).toMatchObject({ path: NOTE });
  });
  const surface = {
    type: (next: string): void => {
      held = next;
    },
  };
  return { runtime, surface };
};

describe("the guarded vault io", () => {
  it("creates under the absent guard with no base, and answers exists where a file already is", async () => {
    const { client, vaultDir } = await bootTestApp();
    const { api, sent } = recordingWrites(client);
    const io = createGuardedVaultIo(api);

    expect(await io.create(NOTE, "# Plans\n")).toStrictEqual({ kind: "created" });
    expect(sent).toStrictEqual([{ content: "# Plans\n", guard: { kind: "absent" }, path: NOTE }]);
    expect(await readFile(path.join(vaultDir, NOTE), "utf-8")).toBe("# Plans\n");

    expect(await io.create(NOTE, "clobber")).toStrictEqual({ kind: "exists" });
    expect(await readFile(path.join(vaultDir, NOTE), "utf-8")).toBe("# Plans\n");
  });

  it("writes with the hash of the base it read, then of what it wrote", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: "v1", guard: { kind: "overwrite" }, path: NOTE });
    const { api, sent } = recordingWrites(client);
    const io = createGuardedVaultIo(api);

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
    const { api, sent } = recordingWrites(client);
    const io = createGuardedVaultIo(api);
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

  it("says a merge kept the buffer's line over the external change to the same one", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: BASE, guard: { kind: "overwrite" }, path: NOTE });
    const io = createGuardedVaultIo(recordingWrites(client).api);
    await io.read(NOTE);

    await client.vault.write({
      content: "# Plans\n\nintro by the agent\n\nfooter\n",
      guard: { kind: "overwrite" },
      path: NOTE,
    });

    const mine = "# Plans\n\nintro rewritten\n\nfooter\n";
    expect(await io.write(NOTE, mine)).toStrictEqual({
      conflicted: true,
      content: mine,
      kind: "landed",
    });
    expect(await readFile(path.join(vaultDir, NOTE), "utf-8")).toBe(mine);
  });

  it("keeps a merged-in external edit through the controller's next save", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: BASE, guard: { kind: "overwrite" }, path: NOTE });
    const controller = new VaultEditorController(createGuardedVaultIo(recordingWrites(client).api));
    await controller.open(NOTE);
    await client.vault.write({ content: EXTERNAL, guard: { kind: "overwrite" }, path: NOTE });

    controller.edit("# Plans\n\nintro rewritten\n\nfooter\n");
    await controller.flush();
    const merged = await readFile(path.join(vaultDir, NOTE), "utf-8");
    expect(controller.getState()).toMatchObject({ content: merged, dirty: false });

    controller.edit(`${merged}more\n`);
    await controller.flush();
    const onDisk = await readFile(path.join(vaultDir, NOTE), "utf-8");
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    expect(onDisk).toContain("more");
  });

  it("merges a keystroke held in the serialize debounce when an external write arrives", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: BASE, guard: { kind: "overwrite" }, path: NOTE });
    const { runtime, surface } = await openRuntime(recordingWrites(client).api);
    await client.vault.write({ content: EXTERNAL, guard: { kind: "overwrite" }, path: NOTE });

    surface.type("# Plans\n\nintro rewritten\n\nfooter\n");
    runtime.controller.externalChange();
    expect(runtime.controller.getState()).toMatchObject({ dirty: true });

    expect(await runtime.flush()).toBe(true);
    const onDisk = await readFile(path.join(vaultDir, NOTE), "utf-8");
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    expect(runtime.controller.getState()).toMatchObject({ content: onDisk });
    runtime.dispose();
  });

  it("merges a keystroke typed while an external reload's read is in flight", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: BASE, guard: { kind: "overwrite" }, path: NOTE });
    const reads = gatedReads(client);
    const { runtime, surface } = await openRuntime(reads.api);
    await client.vault.write({ content: EXTERNAL, guard: { kind: "overwrite" }, path: NOTE });

    const gate = reads.hold();
    runtime.controller.externalChange();
    surface.type("# Plans\n\nintro rewritten\n\nfooter\n");
    gate.resolve();
    await vi.waitFor(() => {
      expect(runtime.controller.getState()).toMatchObject({
        content: expect.stringContaining("external-appended-line"),
      });
    });

    expect(await runtime.flush()).toBe(true);
    const onDisk = await readFile(path.join(vaultDir, NOTE), "utf-8");
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    runtime.dispose();
  });

  it("carries a keystroke typed during a rename to the new path, keeping the alias the move wrote", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ content: BASE, guard: { kind: "overwrite" }, path: NOTE });
    const { runtime } = await openRuntime(recordingWrites(client).api);
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
    const io = createGuardedVaultIo(recordingWrites(client).api);
    await io.read(NOTE);
    await client.vault.remove({ path: NOTE });

    expect(await io.write(NOTE, "v2")).toStrictEqual({ kind: "vanished" });
    await expect(readFile(path.join(vaultDir, NOTE), "utf-8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses a write for a path it never read rather than guessing a base", async () => {
    const { client } = await bootTestApp();
    const { api, sent } = recordingWrites(client);
    const io = createGuardedVaultIo(api);

    await expect(io.write(NOTE, "x")).rejects.toThrow(/no base was read/u);
    expect(sent).toStrictEqual([]);
  });
});
