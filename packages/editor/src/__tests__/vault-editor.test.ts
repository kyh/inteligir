import { describe, expect, it } from "vitest";

import { VaultEditorController } from "@repo/editor/vault-editor";
import { FakeVault } from "./fake-vault";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("VaultEditorController", () => {
  it("opens a file and tracks edits/saves", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "hello");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    expect(c.getState()).toMatchObject({ path: "a.md", content: "hello", dirty: false });

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
    c.externalChange(""); // same (empty) root → not a switch
    await tick();
    expect(c.getState().content).toBe("typed");
    expect(c.getState().dirty).toBe(true);
  });

  it("a live reload refreshes the buffer when clean", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    const c = new VaultEditorController(io);
    c.setRoot("/vault");
    await c.open("a.md");
    io.files.set("a.md", "v1-external");
    c.externalChange("/vault");
    await tick();
    expect(c.getState().content).toBe("v1-external");
  });

  it("treats a different non-empty root as a switch and drops the open file", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "A");
    const c = new VaultEditorController(io);
    c.setRoot("/vault-1");
    await c.open("a.md");
    c.externalChange("/vault-2");
    expect(c.getState()).toMatchObject({ root: "/vault-2", path: null, content: "" });
  });

  it("does not treat the first event (empty root) as a switch", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "A");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    c.edit("unsaved");
    c.externalChange("/vault");
    await tick();
    expect(c.getState()).toMatchObject({
      root: "/vault",
      path: "a.md",
      content: "unsaved",
      dirty: true,
    });
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

  it("keeps the note open when the host holds the delete", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "A");
    io.removeOutcome = {
      outcome: "held",
      held: { deletions: 40, liveCount: 100, limit: 25, windowMs: 600_000, sample: ["a.md"] },
    };
    const c = new VaultEditorController(io);
    await c.open("a.md");
    const outcome = await c.remove();
    expect(outcome).toMatchObject({ outcome: "held" });
    expect(c.getState()).toMatchObject({ path: "a.md", content: "A" });
    expect(io.files.has("a.md")).toBe(true);
  });

  it("keeps the note open when the delete itself fails", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "A");
    io.remove = () => Promise.reject(new Error("offline"));
    const c = new VaultEditorController(io);
    await c.open("a.md");
    expect(await c.remove()).toBe(null);
    expect(c.getState()).toMatchObject({ path: "a.md", content: "A" });
  });

  it("does not switch files when the pending save fails", async () => {
    const io = new FakeVault();
    io.files.set("a.md", "v0");
    io.files.set("b.md", "B");
    const c = new VaultEditorController(io);
    await c.open("a.md");
    c.edit("v1");
    io.write = () => Promise.reject(new Error("disk full"));
    const opened = await c.open("b.md");
    expect(opened).toBe(false);
    expect(c.getState()).toMatchObject({ path: "a.md", content: "v1", dirty: true });
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
    c.setRoot("/vault");
    await c.open("a.md");
    io.files.delete("a.md");
    c.externalChange("/vault");
    await tick();
    expect(c.getState().path).toBe(null);
  });
});
