import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { contentHashHex, type VaultWriteRequest } from "@repo/api/local/vault/vault-schema";
import { bootTestApp, type BootedTestApp } from "inteligir/server/testing";
import { describe, expect, it } from "vitest";
import { createGuardedVaultIo, type GuardedVaultApi } from "../guarded-vault-io";

function recordingWrites(client: BootedTestApp["client"]) {
  const sent: VaultWriteRequest[] = [];
  const api: GuardedVaultApi = {
    vault: {
      read: client.vault.read,
      trash: client.vault.trash,
      remove: client.vault.remove,
      write: (input, ...rest) => {
        sent.push(input);
        return client.vault.write(input, ...rest);
      },
    },
  };
  return { api, sent };
}

const NOTE = "notes/plans.md";

describe("the guarded vault io", () => {
  it("creates with ifAbsent and no base, and refuses where a file already is", async () => {
    const { client, vaultDir } = await bootTestApp();
    const { api, sent } = recordingWrites(client);
    const io = createGuardedVaultIo(api);

    await io.create(NOTE, "# Plans\n");
    expect(sent).toStrictEqual([{ path: NOTE, content: "# Plans\n", ifAbsent: true }]);
    expect(await readFile(join(vaultDir, NOTE), "utf8")).toBe("# Plans\n");

    await expect(io.create(NOTE, "clobber")).rejects.toMatchObject({
      name: "ORPCError",
      code: "ALREADY_EXISTS",
    });
    expect(await readFile(join(vaultDir, NOTE), "utf8")).toBe("# Plans\n");
  });

  it("writes with the hash of the base it read, then of what it wrote", async () => {
    const { client, vaultDir } = await bootTestApp();
    await client.vault.write({ path: NOTE, content: "v1" });
    const { api, sent } = recordingWrites(client);
    const io = createGuardedVaultIo(api);

    expect(await io.read(NOTE)).toBe("v1");
    await io.write(NOTE, "v2");
    await io.write(NOTE, "v3");
    expect(sent).toStrictEqual([
      { path: NOTE, content: "v2", expectedHash: await contentHashHex("v1") },
      { path: NOTE, content: "v3", expectedHash: await contentHashHex("v2") },
    ]);
    expect(await readFile(join(vaultDir, NOTE), "utf8")).toBe("v3");
  });

  it("merges a CAS refusal's current bytes with diff3 and retries against them", async () => {
    const { client, vaultDir } = await bootTestApp();
    const base = "# Plans\n\nintro\n\nfooter\n";
    await client.vault.write({ path: NOTE, content: base });
    const { api, sent } = recordingWrites(client);
    const io = createGuardedVaultIo(api);
    await io.read(NOTE);

    const external = `${base}external-appended-line\n`;
    await client.vault.write({ path: NOTE, content: external });

    await io.write(NOTE, "# Plans\n\nintro rewritten\n\nfooter\n");

    expect(sent.map((request) => request.expectedHash)).toStrictEqual([
      await contentHashHex(base),
      await contentHashHex(external),
    ]);
    const onDisk = await readFile(join(vaultDir, NOTE), "utf8");
    expect(onDisk).toContain("intro rewritten");
    expect(onDisk).toContain("external-appended-line");
    expect(onDisk).not.toContain("\nintro\n");
  });

  it("refuses a write for a path it never read rather than guessing a base", async () => {
    const { client } = await bootTestApp();
    const { api, sent } = recordingWrites(client);
    const io = createGuardedVaultIo(api);

    await expect(io.write(NOTE, "x")).rejects.toThrow(/no base was read/u);
    expect(sent).toStrictEqual([]);
  });
});
