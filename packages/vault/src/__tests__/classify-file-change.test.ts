import { describe, expect, it } from "vitest";

import { classifyFileChange, SelfSaveRegistry } from "../classify-file-change";

describe("classifyFileChange", () => {
  it("returns none when the file is missing/unreadable (vanish handled elsewhere)", () => {
    expect(classifyFileChange({ lastKnown: "1:2", current: null })).toBe("none");
    expect(classifyFileChange({ lastKnown: null, current: null })).toBe("none");
  });

  it("returns none when there is no baseline to diff against", () => {
    expect(classifyFileChange({ lastKnown: null, current: "1:2" })).toBe("none");
  });

  it("returns match when the disk fingerprint is unchanged (own write / dup event)", () => {
    expect(classifyFileChange({ lastKnown: "9:9", current: "9:9" })).toBe("match");
  });

  it("returns reload when the disk genuinely changed", () => {
    expect(classifyFileChange({ lastKnown: "1:2", current: "3:4" })).toBe("reload");
  });
});

describe("SelfSaveRegistry", () => {
  // Fingerprints are the full `mtimeMs:size:ino` stat triple — keying on
  // mtime alone swallows an external edit that collides on the same mtime.
  it("matches a recorded write at the same fingerprint and rejects a different one", () => {
    const reg = new SelfSaveRegistry(() => 1000);
    reg.record("a.md", "500:10:7");
    expect(reg.isSelfSave("a.md", "500:10:7")).toBe(true);
    // A genuine external edit lands a different fingerprint.
    expect(reg.isSelfSave("a.md", "501:10:7")).toBe(false);
    // An unrecorded path is never a self-save.
    expect(reg.isSelfSave("b.md", "500:10:7")).toBe(false);
  });

  it("an external edit with a COLLIDING mtime but different size is NOT a self-save", () => {
    const reg = new SelfSaveRegistry(() => 1000);
    reg.record("a.md", "500:10:7");
    // Same-second external write: identical mtimeMs, different byte count.
    // Under the old mtime-only key this was swallowed as a self-save.
    expect(reg.isSelfSave("a.md", "500:11:7")).toBe(false);
  });

  it("an external edit with a COLLIDING mtime and size but different ino is NOT a self-save", () => {
    const reg = new SelfSaveRegistry(() => 1000);
    reg.record("a.md", "500:10:7");
    // An mtime-preserving tool replacing the file (new inode, same length).
    expect(reg.isSelfSave("a.md", "500:10:8")).toBe(false);
  });

  it("a genuine self-save (matching full fingerprint) is still filtered", () => {
    const reg = new SelfSaveRegistry(() => 1000);
    reg.record("a.md", "500:10:7");
    expect(reg.isSelfSave("a.md", "500:10:7")).toBe(true);
  });

  it("matches repeatedly (a write can fire several watch events)", () => {
    const reg = new SelfSaveRegistry(() => 1000);
    reg.record("a.md", "500:10:7");
    expect(reg.isSelfSave("a.md", "500:10:7")).toBe(true);
    expect(reg.isSelfSave("a.md", "500:10:7")).toBe(true);
  });

  it("expires records by age so a later external edit is not masked", () => {
    let clock = 1000;
    const reg = new SelfSaveRegistry(() => clock);
    reg.record("a.md", "500:10:7");
    clock = 1000 + 5_000 + 1; // past the TTL
    expect(reg.isSelfSave("a.md", "500:10:7")).toBe(false);
  });

  it("forget() drops a path's record", () => {
    const reg = new SelfSaveRegistry(() => 1000);
    reg.record("a.md", "500:10:7");
    reg.forget("a.md");
    expect(reg.isSelfSave("a.md", "500:10:7")).toBe(false);
  });

  it("re-recording refreshes the fingerprint and expiry", () => {
    let clock = 1000;
    const reg = new SelfSaveRegistry(() => clock);
    reg.record("a.md", "500:10:7");
    clock = 3000;
    reg.record("a.md", "700:12:7");
    expect(reg.isSelfSave("a.md", "500:10:7")).toBe(false);
    expect(reg.isSelfSave("a.md", "700:12:7")).toBe(true);
  });
});
