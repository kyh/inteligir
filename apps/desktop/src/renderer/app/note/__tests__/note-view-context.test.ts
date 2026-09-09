import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { readNoteViewContext } from "../note-view-context";
import type { OpenNoteView } from "../note-view-context";

const openNote = (disk: { content: string }, buffer: string) => {
  const calls: string[] = [];
  const view: OpenNoteView = {
    // oxlint-disable-next-line require-await -- the view's save is an async port; this fake answers from memory
    flush: async () => {
      calls.push("flush");
      disk.content = buffer;
    },
    read: () => {
      calls.push("read");
      return { content: buffer };
    },
  };
  return { calls, view };
};

describe("readNoteViewContext", () => {
  it("flushes the dirty buffer first, so the revision is what is then on disk", async () => {
    const disk = { content: "# Plans\n" };
    const buffer = "# Plans\n\nAnd a paragraph the user just typed.\n";
    const { view, calls } = openNote(disk, buffer);

    const context = await readNoteViewContext("Notes/Plans.md", view);

    expect(calls).toEqual(["flush", "read"]);
    expect(disk.content).toBe(buffer);
    expect(context).toEqual({
      resource: "Notes/Plans.md",
      revision: await contentHashHex(disk.content),
      surface: "doc",
    });
    expect(context.revision).not.toBe(await contentHashHex("# Plans\n"));
  });

  it("still answers when the save failed — the buffer is what the user sees", async () => {
    const buffer = "unsaved";
    const view: OpenNoteView = {
      // oxlint-disable-next-line require-await -- the view's save is an async port; this fake refuses from memory
      flush: async () => {
        throw new Error("the note could not be saved");
      },
      read: () => ({ content: buffer }),
    };

    const context = await readNoteViewContext("Notes/Plans.md", view);

    expect(context.revision).toBe(await contentHashHex(buffer));
  });
});
