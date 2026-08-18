// The ordering is the whole test. `revision` names the bytes the agent will
// read, so a context taken BEFORE the flush names a version of the file that
// only ever existed in this browser — and every assertion about the path and
// the selection would still pass while the claim underneath them was false.

import { contentHashHex } from "@repo/server-contract/vault";
import { describe, expect, it } from "vitest";
import { readNoteViewContext, type OpenNoteView } from "../note-view-context";

/** A buffer over a fake disk: `flush` is the only thing that moves the bytes
 *  across, exactly as the controller's does. */
function openNote(disk: { content: string }, buffer: string, from = 0, to = 0) {
  const calls: string[] = [];
  const view: OpenNoteView = {
    flush: async () => {
      calls.push("flush");
      disk.content = buffer;
    },
    read: () => {
      calls.push("read");
      return { content: buffer, from, to };
    },
  };
  return { view, calls };
}

describe("readNoteViewContext", () => {
  it("flushes the dirty buffer first, so the revision is what is then on disk", async () => {
    const disk = { content: "# Plans\n" };
    const buffer = "# Plans\n\nAnd a paragraph the user just typed.\n";
    const { view, calls } = openNote(disk, buffer);

    const context = await readNoteViewContext("Notes/Plans.md", view);

    expect(calls).toEqual(["flush", "read"]);
    expect(disk.content).toBe(buffer);
    expect(context.revision).toBe(await contentHashHex(disk.content));
    // The pre-flush bytes must not be what was named.
    expect(context.revision).not.toBe(await contentHashHex("# Plans\n"));
  });

  it("carries the selection with the offsets it was taken at", async () => {
    const buffer = "alpha beta gamma";
    const { view } = openNote({ content: buffer }, buffer, 6, 10);

    const context = await readNoteViewContext("Notes/Plans.md", view);

    expect(context).toEqual({
      surface: "doc",
      resource: "Notes/Plans.md",
      revision: await contentHashHex(buffer),
      selection: { from: 6, to: 10, text: "beta" },
    });
  });

  it("omits the selection for a bare caret", async () => {
    const buffer = "alpha";
    const { view } = openNote({ content: buffer }, buffer, 3, 3);

    expect(await readNoteViewContext("Notes/Plans.md", view)).toEqual({
      surface: "doc",
      resource: "Notes/Plans.md",
      revision: await contentHashHex(buffer),
    });
  });

  it("still answers when the save failed — the excerpt is true either way", async () => {
    const buffer = "unsaved";
    const view: OpenNoteView = {
      flush: () => Promise.reject(new Error("the note could not be saved")),
      read: () => ({ content: buffer, from: 0, to: 7 }),
    };

    const context = await readNoteViewContext("Notes/Plans.md", view);

    // The revision names the BUFFER, which is what the user is looking at; a
    // disk that no longer matches it is what carrying a revision reveals.
    expect(context.revision).toBe(await contentHashHex(buffer));
    expect(context.selection?.text).toBe("unsaved");
  });
});
