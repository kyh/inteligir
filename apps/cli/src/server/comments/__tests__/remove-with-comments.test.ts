import { existsSync } from "node:fs";
import nodePath from "node:path";
import { commentsStorePath } from "@repo/notes/comments/sidecar-schema";
import { describe, expect, it } from "vitest";
import { bootIndexedVault, makeVaultDirs } from "../../knowledge/__tests__/indexed-vault";
import { removeEntryWithComments } from "../remove-with-comments";

const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const STORE = commentsStorePath(NOTE_ID);
const NOTE = `---\nid: ${NOTE_ID}\n---\n%%i:c1:start%%x%%i:c1:end%%\n`;
const STORE_BYTES = '{\n  "c1": { "text": "kept", "createdAt": 1, "updatedAt": 1 }\n}\n';

const boot = () => {
  const { knowledge, root, service } = bootIndexedVault(
    makeVaultDirs("inteligir-remove-with-comments-"),
  );
  const storeOnDisk = (): boolean => existsSync(nodePath.join(root, STORE));
  return { knowledge, service, storeOnDisk };
};

describe("a delete takes a note's comment store only when no other note carries its id", () => {
  it("keeps the store a byte copy shares, and removes it with the last note carrying the id", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("Plan.md", NOTE);
    await service.write("Plan copy.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    await removeEntryWithComments(service, "Plan copy.md", knowledge);
    const kept = await service.read(STORE);
    expect(kept.content).toBe(STORE_BYTES);

    await removeEntryWithComments(service, "Plan.md", knowledge);
    expect(storeOnDisk()).toBe(false);
  });

  it("removes the store with a folder holding every note that carries the id", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("box/Plan.md", NOTE);
    await service.write("box/deeper/Plan copy.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    await removeEntryWithComments(service, "box", knowledge);
    expect(storeOnDisk()).toBe(false);
  });

  it("keeps the store when the note carrying the id lives outside the removed folder", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("box/Plan copy.md", NOTE);
    await service.write("Plan.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    await removeEntryWithComments(service, "box", knowledge);
    expect(storeOnDisk()).toBe(true);
  });
});
