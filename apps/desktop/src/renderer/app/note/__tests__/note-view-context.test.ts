// The ordering is the whole test. `revision` names the bytes the agent will
// read, so a context taken BEFORE the flush names a version of the file that
// only ever existed in this browser — and every assertion about the path
// would still pass while the claim underneath it was false.

import { contentHashHex } from "@repo/api/local/vault/vault-schema";
import { describe, expect, it } from "vitest";
import { readNoteViewContext, type OpenNoteView } from "../note-view-context";

/** A buffer over a fake disk: `flush` is the only thing that moves the bytes
 *  across, exactly as the controller's does. */
function openNote(disk: { content: string }, buffer: string) {
  const calls: string[] = [];
  const view: OpenNoteView = {
    flush: async () => {
      calls.push("flush");
      disk.content = buffer;
    },
    read: () => {
      calls.push("read");
      return { content: buffer };
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
    expect(context).toEqual({
      surface: "doc",
      resource: "Notes/Plans.md",
      revision: await contentHashHex(disk.content),
    });
    // The pre-flush bytes must not be what was named.
    expect(context.revision).not.toBe(await contentHashHex("# Plans\n"));
  });

  it("still answers when the save failed — the buffer is what the user sees", async () => {
    const buffer = "unsaved";
    const view: OpenNoteView = {
      flush: () => Promise.reject(new Error("the note could not be saved")),
      read: () => ({ content: buffer }),
    };

    const context = await readNoteViewContext("Notes/Plans.md", view);

    // The revision names the BUFFER, which is what the user is looking at; a
    // disk that no longer matches it is what carrying a revision reveals.
    expect(context.revision).toBe(await contentHashHex(buffer));
  });
});
