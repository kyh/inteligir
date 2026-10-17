// the primitives the capture, the file save and the import write through, over a booted server.

import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";
import { COVERS_DIR } from "@repo/notes/items/item-kind";
import { describe, expect, it } from "vitest";

import { bootTestApp } from "../../__tests__/boot-app";
import type { FolderNamer } from "../item-core";
import { ItemsError } from "../items-error";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const bootCore = async () => {
  const harness = await bootTestApp();
  return { core: harness.composed.context.items.core, harness };
};

describe("the item core", () => {
  it("stores bytes by their hash once, and reuses the file for the same bytes", async () => {
    const { core, harness } = await bootCore();
    const first = await core.writeContentAddressed(COVERS_DIR, "png", PNG);
    expect(first.wrote).toBe(true);
    expect(first.path).toMatch(/^assets\/covers\/[0-9a-f]{16}\.png$/u);
    expect(readFileSync(nodePath.join(harness.vaultDir, first.path))).toEqual(Buffer.from(PNG));
    expect(await core.writeContentAddressed(COVERS_DIR, "png", PNG)).toEqual({
      path: first.path,
      wrote: false,
    });
  });

  it("hands out names from one listing, never the same twice", async () => {
    const { core, harness } = await bootCore();
    await harness.vault.service.write("Unsorted/Talk.md", "taken\n");
    const name: FolderNamer = await core.folderNamer("Unsorted");
    expect([name("Talk"), name("Talk"), name("Other")]).toEqual([
      "Unsorted/Talk 2.md",
      "Unsorted/Talk 3.md",
      "Unsorted/Other.md",
    ]);
    // a namer is the import's per-batch listing: createDoc takes its names in place of a fresh one
    const named = await core.createDoc({
      content: "named\n",
      folder: "Unsorted",
      name,
      stem: "Talk",
    });
    expect(named.path).toBe("Unsorted/Talk 4.md");
    expect(await core.freePath("", "Talk")).toBe("Talk.md");
  });

  it("refuses a folder a file stands in, by its own refusal", async () => {
    const { core, harness } = await bootCore();
    await harness.vault.service.write("Inbox", "a file\n");
    await expect(core.freePath("Inbox", "x")).rejects.toBeInstanceOf(ItemsError);
  });

  it("answers a stub it created before the index has read it, and the indexed item after", async () => {
    const { core } = await bootCore();
    const content = [
      "---",
      "id: 7d1e0c52-55a8-4a4e-9d0b-2b8f7a8e1c3f",
      "kind: link",
      "url: https://example.com/talk",
      "saved: 2026-10-17T09:12:30Z",
      "---",
      "",
    ].join("\n");
    const { path } = await core.createDoc({ content, folder: "Unsorted", stem: "Talk" });
    expect(await core.existing("https://example.com/talk", { settle: false })).toEqual({
      fill: { state: "pending" },
      path,
    });
    expect(await core.existing("http://www.example.com/talk/")).toEqual({
      fill: { state: "pending" },
      path,
    });
    expect(await core.existing("https://example.com/other")).toBeNull();
  });

  it("forgets a stub it wrote once a settle has read it, so one deleted since is not saved", async () => {
    const { core, harness } = await bootCore();
    const content = [
      "---",
      "id: 0b6f3c2e-8d41-4f7a-9c55-3e2a1d7b9f60",
      "kind: link",
      "url: https://example.com/gone",
      "saved: 2026-10-17T09:12:30Z",
      "---",
      "",
    ].join("\n");
    // the import's way: a settle of its own, then every lookup with none
    const { path } = await core.createDoc({ content, folder: "Unsorted", stem: "Gone" });
    await core.settle();
    expect(await core.existing("https://example.com/gone", { settle: false })).toEqual({
      fill: { state: "pending" },
      path,
    });
    await harness.vault.service.remove(path);
    await core.settle();
    expect(await core.existing("https://example.com/gone", { settle: false })).toBeNull();
  });

  it("rewrites under the hash it was given, and says when the file moved or went", async () => {
    const { core, harness } = await bootCore();
    await harness.vault.service.write("a.md", "one\n");
    const read = await core.read("a.md");
    expect(read?.content).toBe("one\n");
    const hash = read?.hash ?? "";
    expect(await core.write("a.md", "two\n", hash)).toBe("written");
    expect(await core.write("a.md", "three\n", hash)).toBe("changed");
    await core.remove("a.md");
    await core.remove("a.md");
    expect(await core.read("a.md")).toBeNull();
    expect(await core.write("a.md", "four\n", hash)).toBe("gone");
    expect(existsSync(nodePath.join(harness.vaultDir, "a.md"))).toBe(false);
  });

  it("puts an original where a paste beside its wrapper would land", async () => {
    const { core } = await bootCore();
    expect(await core.writeOriginal("Reading/Talk.md", "Talk slides.pdf", PNG)).toEqual({
      path: "assets/Talk slides.pdf",
    });
  });

  it("moves a stub with its links rewritten and no alias kept", async () => {
    const { core, harness } = await bootCore();
    await harness.vault.service.write("Unsorted/example.com - talk.md", "stub\n");
    await harness.vault.service.write("a.md", "See [[example.com - talk]].\n");
    expect(await core.rename("Unsorted/example.com - talk.md", "Unsorted/Talk.md")).toMatchObject({
      path: "Unsorted/Talk.md",
      rewritten: ["a.md"],
    });
    expect(readFileSync(nodePath.join(harness.vaultDir, "Unsorted", "Talk.md"), "utf-8")).toBe(
      "stub\n",
    );
  });

  it("reads git as untracked before a commit adds the path, and as this device's after", async () => {
    const { core, harness } = await bootCore();
    await harness.vault.service.write("Unsorted/Talk.md", "stub\n");
    expect(await core.isTracked("Unsorted/Talk.md")).toBe(false);
    expect(await core.creatorOf("Unsorted/Talk.md")).toBeNull();
    await core.commitPaths(["Unsorted/Talk.md"]);
    await core.commitPaths([]);
    expect(await core.isTracked("Unsorted/Talk.md")).toBe(true);
    expect(await core.creatorOf("Unsorted/Talk.md")).toBe("device");
    await core.syncNow();
  });
});
