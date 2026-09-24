import { describe, expect, it } from "vitest";

import { VaultEditorController } from "@repo/editor/vault-editor";
import { FakeVault } from "./fake-vault";

const tick = async (): Promise<void> => {
  // oxlint-disable-next-line promise/avoid-new -- setTimeout has no promise-native form here
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

describe("VaultEditorController", () => {
  it("opens a file and tracks edits/saves", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "hello");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    expect(c.getState()).toMatchObject({ content: "hello", dirty: false, path: "a.md" });

    c.edit("hello world");
    expect(c.getState()).toMatchObject({ content: "hello world", dirty: true });
    await c.flush();
    expect(c.getState().dirty).toBe(false);
    expect(io.files.get("a.md")).toBe("hello world");
  });

  it("keeps dirty when edited during an in-flight save, and saves the newer text", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    io.manualWrite = true;
    const c = new VaultEditorController(io);
    await c.open("a.md");
    c.edit("v1");
    const flush1 = c.flush();
    await tick();
    c.edit("v2");
    io.pendingWrites[0]?.resolve();
    await flush1;
    expect(c.getState().dirty).toBe(true);
    expect(c.getState().content).toBe("v2");
    io.manualWrite = false;
    await c.flush();
    expect(io.files.get("a.md")).toBe("v2");
    expect(c.getState().dirty).toBe(false);
  });

  it("adopts the bytes a write landed when the host merged a concurrent change in", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "one\ntwo\nthree\n");
    io.landAs = (sent) => `${sent}external\n`;
    const c = new VaultEditorController(io);
    await c.open("a.md");
    c.edit("one typed\ntwo\nthree\n");
    await c.flush();
    expect(c.getState()).toMatchObject({
      content: "one typed\ntwo\nthree\nexternal\n",
      dirty: false,
      saveError: null,
    });
  });

  it("rebases an edit made mid-write onto the bytes that landed, and keeps it dirty", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "one\ntwo\nthree\n");
    io.manualWrite = true;
    io.landAs = (sent) => `${sent}external\n`;
    const c = new VaultEditorController(io);
    await c.open("a.md");
    c.edit("one typed\ntwo\nthree\n");
    const flushed = c.flush();
    await tick();
    c.edit("one typed more\ntwo\nthree\n");
    io.pendingWrites[0]?.resolve();
    await flushed;
    expect(c.getState()).toMatchObject({
      content: "one typed more\ntwo\nthree\nexternal\n",
      dirty: true,
    });

    io.manualWrite = false;
    io.landAs = null;
    await c.flush();
    expect(io.files.get("a.md")).toBe("one typed more\ntwo\nthree\nexternal\n");
    expect(c.getState().dirty).toBe(false);
  });

  it("drains a keystroke the surface still holds before adopting merged bytes", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "one\ntwo\nthree\n");
    io.manualWrite = true;
    io.landAs = (sent) => `${sent}external\n`;
    let held: string | null = null;
    const c = new VaultEditorController(io, () => {
      if (held !== null) {
        c.edit(held);
        held = null;
      }
    });
    await c.open("a.md");
    c.edit("one typed\ntwo\nthree\n");
    const flushed = c.flush();
    await tick();
    held = "one typed more\ntwo\nthree\n";
    io.pendingWrites[0]?.resolve();
    await flushed;
    expect(held).toBe(null);
    expect(c.getState()).toMatchObject({
      content: "one typed more\ntwo\nthree\nexternal\n",
      dirty: true,
    });
  });

  it("drains a held keystroke before an external reload and leaves it to the save", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "one\ntwo\nthree\n");
    let held: string | null = "one typed\ntwo\nthree\n";
    const c = new VaultEditorController(io, () => {
      if (held !== null) {
        c.edit(held);
        held = null;
      }
    });
    await c.open("a.md");
    io.files.set("a.md", "one\ntwo\nthree\nexternal\n");
    c.externalChange();
    await tick();
    expect(c.getState()).toMatchObject({ content: "one typed\ntwo\nthree\n", dirty: true });
  });

  it.each([
    ["held by the surface", true],
    ["typed straight into the buffer", false],
  ])(
    "rebases a keystroke %s during a reload's read onto the bytes read",
    async (_label, viaSurface) => {
      const io = new FakeVault();
      io.files.set("a.md", "one\ntwo\nthree\n");
      let held: string | null = null;
      const c = new VaultEditorController(io, () => {
        if (held !== null) {
          c.edit(held);
          held = null;
        }
      });
      await c.open("a.md");
      io.manualRead = true;
      c.externalChange();
      if (viaSurface) {
        held = "one typed\ntwo\nthree\n";
      } else {
        c.edit("one typed\ntwo\nthree\n");
      }
      io.pendingReads[0]?.resolve("one\ntwo\nthree\nexternal\n");
      await tick();
      expect(c.getState()).toMatchObject({
        content: "one typed\ntwo\nthree\nexternal\n",
        dirty: true,
      });
    },
  );

  it("a slow open does not apply after a newer open", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "A");
    io.files.set("b.md", "B");
    io.manualRead = true;
    const c = new VaultEditorController(io);
    const openA = c.open("a.md");
    await tick();
    const openB = c.open("b.md");
    await tick();
    io.pendingReads[1]?.resolve("B");
    io.pendingReads[0]?.resolve("A");
    await Promise.all([openA, openB]);
    expect(c.getState().path).toBe("b.md");
    expect(c.getState().content).toBe("B");
  });

  it("a live reload does not clobber unsaved edits", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "disk");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    c.edit("typed");
    io.files.set("a.md", "external");
    c.externalChange();
    await tick();
    expect(c.getState().content).toBe("typed");
    expect(c.getState().dirty).toBe(true);
  });

  it("a live reload refreshes the buffer when clean", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    io.files.set("a.md", "v1-external");
    c.externalChange();
    await tick();
    expect(c.getState().content).toBe("v1-external");
  });

  it("delete waits for an in-flight save then clears", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    io.manualWrite = true;
    const c = new VaultEditorController(io);
    await c.open("a.md");
    c.edit("v1");
    const flush = c.flush();
    await tick();
    const removed = c.remove();
    io.pendingWrites[0]?.resolve();
    await Promise.all([flush, removed]);
    expect(c.getState().path).toBe(null);
    expect(io.files.has("a.md")).toBe(false);
  });

  it("keeps the note open when the delete itself fails", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "A");
    io.remove = async () => await Promise.reject(new Error("offline"));
    const c = new VaultEditorController(io);
    await c.open("a.md");
    expect(await c.remove()).toBe(null);
    expect(c.getState()).toMatchObject({ content: "A", path: "a.md" });
  });

  it("does not switch files when the pending save fails", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    io.files.set("b.md", "B");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    c.edit("v1");
    io.write = async () => await Promise.reject(new Error("disk full"));
    const opened = await c.open("b.md");
    expect(opened).toBe(false);
    expect(c.getState()).toMatchObject({ content: "v1", dirty: true, path: "a.md" });
  });

  it("holds a refused write's reason until a write lands", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    const { write } = io;
    io.write = async () => await Promise.reject(new Error("disk full"));
    c.edit("v1");
    await c.flush();
    expect(c.getState()).toMatchObject({
      dirty: true,
      saveError: { kind: "refused", message: "disk full" },
    });

    io.write = write;
    await c.flush();
    expect(c.getState()).toMatchObject({ dirty: false, saveError: null });
  });

  it("names a write refused because the file is gone, and re-creates it from the buffer", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    io.files.delete("a.md");
    c.edit("v1");
    await c.flush();
    expect(c.getState()).toMatchObject({ dirty: true, saveError: { kind: "vanished" } });

    expect(await c.recreate()).toBe(true);
    expect(io.files.get("a.md")).toBe("v1");
    expect(c.getState()).toMatchObject({ content: "v1", dirty: false, saveError: null });
  });

  it("refuses to re-create over a file that landed at the path since", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    io.files.delete("a.md");
    c.edit("v1");
    await c.flush();
    io.files.set("a.md", "someone else's");

    expect(await c.recreate()).toBe(false);
    expect(io.files.get("a.md")).toBe("someone else's");
    expect(c.getState()).toMatchObject({ dirty: true, saveError: { kind: "vanished" } });
  });

  it("a failed open clears instead of reviving a deleted path", async () => {
    const io = new FakeVault();
    const c = new VaultEditorController(io);
    await c.open("gone.md");
    expect(c.getState().path).toBe(null);
    expect(c.getState().content).toBe("");
  });

  it("drops the selection when the open file is deleted elsewhere", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "A");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    io.files.delete("a.md");
    c.externalChange();
    await tick();
    expect(c.getState().path).toBe(null);
  });
});

const countingConflicts = (io: FakeVault) => {
  const conflicts = { count: 0 };
  const c = new VaultEditorController(io, undefined, () => {
    conflicts.count += 1;
  });
  return { c, conflicts };
};

describe("a merge that kept the buffer's lines over a concurrent change", () => {
  it("is told when the host's merge overlapped", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "one\n");
    io.landAs = (sent) => `${sent}external\n`;
    io.landsConflicted = true;
    const { c, conflicts } = countingConflicts(io);
    await c.open("a.md");
    c.edit("one typed\n");
    await c.flush();
    expect(conflicts.count).toBe(1);
  });

  it("is told when an edit typed during a reload's read overlaps the bytes read", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "one\ntwo\n");
    const { c, conflicts } = countingConflicts(io);
    await c.open("a.md");
    io.manualRead = true;
    c.externalChange();
    c.edit("one mine\ntwo\n");
    io.pendingReads[0]?.resolve("one theirs\ntwo\n");
    await tick();
    expect(c.getState()).toMatchObject({ content: "one mine\ntwo\n", dirty: true });
    expect(conflicts.count).toBe(1);
  });

  it("is not told when the merge kept both sides", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "one\ntwo\nthree\n");
    io.manualWrite = true;
    io.landAs = (sent) => `${sent}external\n`;
    const { c, conflicts } = countingConflicts(io);
    await c.open("a.md");
    c.edit("one typed\ntwo\nthree\n");
    const flushed = c.flush();
    await tick();
    c.edit("one typed more\ntwo\nthree\n");
    io.pendingWrites[0]?.resolve();
    await flushed;
    expect(c.getState().content).toBe("one typed more\ntwo\nthree\nexternal\n");
    expect(conflicts.count).toBe(0);
  });
});
