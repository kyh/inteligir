import { existsSync } from "node:fs";
import nodePath from "node:path";
import { annotationsStorePath } from "@repo/notes/annotations/store-schema";
import { describe, expect, it } from "vitest";
import { bootIndexedVault, makeVaultDirs } from "../../knowledge/__tests__/indexed-vault";
import { removeEntry } from "../remove-entry";

const NOTE_ID = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";
const STORE = annotationsStorePath(NOTE_ID);
const NOTE = `---\nid: ${NOTE_ID}\n---\n%%i:c1:start%%x%%i:c1:end%%\n`;
const STORE_BYTES = '{\n  "c1": { "text": "kept", "createdAt": 1, "updatedAt": 1 }\n}\n';

const boot = () => {
  const { knowledge, root, service } = bootIndexedVault(makeVaultDirs("inteligir-remove-entry-"));
  const storeOnDisk = (): boolean => existsSync(nodePath.join(root, STORE));
  return { knowledge, service, storeOnDisk };
};

describe("a delete takes a note's annotation store only when no other note carries its id", () => {
  it("keeps the store a byte copy shares, and removes it with the last note carrying the id", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("Plan.md", NOTE);
    await service.write("Plan copy.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    await removeEntry(service, "Plan copy.md", knowledge);
    const kept = await service.read(STORE);
    expect(kept.content).toBe(STORE_BYTES);

    await removeEntry(service, "Plan.md", knowledge);
    expect(storeOnDisk()).toBe(false);
  });

  it("removes the store with a folder holding every note that carries the id", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("box/Plan.md", NOTE);
    await service.write("box/deeper/Plan copy.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    await removeEntry(service, "box", knowledge);
    expect(storeOnDisk()).toBe(false);
  });

  it("keeps the store when the note carrying the id lives outside the removed folder", async () => {
    const { knowledge, service, storeOnDisk } = boot();
    await service.write("box/Plan copy.md", NOTE);
    await service.write("Plan.md", NOTE);
    await service.write(STORE, STORE_BYTES);

    await removeEntry(service, "box", knowledge);
    expect(storeOnDisk()).toBe(true);
  });
});

describe("a delete takes the files only it links", () => {
  it("takes an item's original and cover, and keeps a cover another item shares", async () => {
    const { knowledge, service } = boot();
    await service.write("assets/scan.pdf", "%PDF-1.4\n");
    await service.write("assets/covers/3f9a0c2b1d4e5f60.jpg", "jpeg");
    await service.write(
      "Unsorted/Scan.md",
      "---\nkind: pdf\n---\n![](assets/covers/3f9a0c2b1d4e5f60.jpg)\n\n![](assets/scan.pdf)\n",
    );
    await service.write("Unsorted/Other.md", "![](assets/covers/3f9a0c2b1d4e5f60.jpg)\n");

    const removed = await removeEntry(service, "Unsorted/Scan.md", knowledge);
    expect(removed).toEqual(["Unsorted/Scan.md", "assets/scan.pdf"]);
    expect(await service.statEntry("assets/scan.pdf")).toBeNull();
    expect(await service.statEntry("assets/covers/3f9a0c2b1d4e5f60.jpg")).toBe("file");

    const last = await removeEntry(service, "Unsorted/Other.md", knowledge);
    expect(last).toEqual(["Unsorted/Other.md", "assets/covers/3f9a0c2b1d4e5f60.jpg"]);
  });

  it("takes the files a removed folder's items link from outside it, and none a kept note links", async () => {
    const { knowledge, service } = boot();
    await service.write("assets/a.png", "a");
    await service.write("assets/b.png", "b");
    await service.write("Reading/A.md", "---\nkind: image\n---\n![](assets/a.png)\n");
    await service.write("Reading/B.md", "---\nkind: image\n---\n![[b.png]]\n");
    await service.write("Notes.md", "See [the picture](assets/b.png).\n");

    const removed = await removeEntry(service, "Reading", knowledge);
    expect(removed).toEqual(["Reading", "assets/a.png"]);
    expect(await service.statEntry("assets/b.png")).toBe("file");
  });

  it("takes no file when the entry removed is a file itself", async () => {
    const { knowledge, service } = boot();
    await service.write("assets/a.png", "a");
    await service.write("A.md", "![](assets/a.png)\n");

    expect(await removeEntry(service, "assets/a.png", knowledge)).toEqual(["assets/a.png"]);
    expect(await service.statEntry("A.md")).toBe("file");
  });
});
