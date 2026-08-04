import { describe, expect, it } from "vitest";

import { saveNote, type NoteIo } from "../note-save";

const STAMP = "2026-07-05T12-34-56-000Z";

function fakeIo(
  files: Record<string, string>,
  unreadable: readonly string[] = [],
): NoteIo & { files: Record<string, string> } {
  return {
    files,
    read: (path) => (unreadable.includes(path) ? null : (files[path] ?? null)),
    exists: (path) => unreadable.includes(path) || path in files,
    write: (path, text) => {
      files[path] = text;
    },
  };
}

function save(io: NoteIo, openedText: string, draft: string, path = "notes/todo.md") {
  return saveNote({ io, path, openedText, draft, stamp: () => STAMP });
}

describe("saveNote", () => {
  it("writes the draft when the file is untouched since it opened", () => {
    const io = fakeIo({ "notes/todo.md": "one\n" });
    const outcome = save(io, "one\n", "one\ntwo\n");
    expect(outcome).toEqual({ kind: "written", text: "one\ntwo\n" });
    expect(io.files["notes/todo.md"]).toBe("one\ntwo\n");
  });

  it("recreates a file that vanished while it was open", () => {
    const io = fakeIo({});
    expect(save(io, "one\n", "one\ntwo\n").kind).toBe("written");
    expect(io.files["notes/todo.md"]).toBe("one\ntwo\n");
  });

  it("keeps a concurrently pulled remote edit when the draft touched another line", () => {
    // The remote (a sync pass) appended a line while the draft edited the top.
    const io = fakeIo({ "notes/todo.md": "one\ntwo\nthree\n" });
    const outcome = save(io, "one\ntwo\n", "ONE\ntwo\n");

    expect(outcome).toEqual({ kind: "merged", text: "ONE\ntwo\nthree\n" });
    expect(io.files["notes/todo.md"]).toBe("ONE\ntwo\nthree\n");
  });

  it("unions both tails when the two sides appended to the same note", () => {
    const io = fakeIo({ "notes/todo.md": "base\nfrom desktop\n" });
    const outcome = save(io, "base\n", "base\nfrom phone\n");

    expect(outcome.kind).toBe("merged");
    expect(io.files["notes/todo.md"]).toContain("from desktop");
    expect(io.files["notes/todo.md"]).toContain("from phone");
  });

  it("preserves BOTH sides as a conflict copy when the ladder refuses", () => {
    // Same line rewritten differently on both sides — no rung can fold that.
    const io = fakeIo({ "notes/todo.md": "the remote line\n" });
    const outcome = save(io, "the base line\n", "the draft line\n");

    expect(outcome).toEqual({
      kind: "forked",
      text: "the remote line\n",
      copyPath: `notes/todo (conflict ${STAMP}).md`,
      cause: "unmergeable",
    });
    expect(io.files["notes/todo.md"]).toBe("the remote line\n");
    expect(io.files[`notes/todo (conflict ${STAMP}).md`]).toBe("the draft line\n");
  });

  it("leaves a present-but-unreadable note alone and preserves the draft beside it", () => {
    const io = fakeIo({ "notes/todo.md": "unreadable bytes\n" }, ["notes/todo.md"]);
    const outcome = save(io, "one\n", "one\ntwo\n");

    expect(outcome).toEqual({
      kind: "forked",
      text: "one\n",
      copyPath: `notes/todo (conflict ${STAMP}).md`,
      cause: "unreadable",
    });
    expect(io.files["notes/todo.md"]).toBe("unreadable bytes\n");
    expect(io.files[`notes/todo (conflict ${STAMP}).md`]).toBe("one\ntwo\n");
  });

  it("never drops the remote edit, whichever way the save lands", () => {
    const io = fakeIo({ "notes/todo.md": "remote only\n" });
    save(io, "opened\n", "draft only\n");
    const everything = Object.values(io.files).join("\n");
    expect(everything).toContain("remote only");
    expect(everything).toContain("draft only");
  });
});
