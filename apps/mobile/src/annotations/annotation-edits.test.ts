import { createFakeCell } from "@repo/library-replica/test-support/fake-cell";
import { openDevice, paragraph } from "@repo/library-replica/test-support/replica-harness";
import { describe, expect, it } from "vitest";
import { createAnnotationEdits, threadsOf } from "./annotation-edits";

const NOW = 1_700_000_400_000;

describe("the annotations sheet's writes", () => {
  it("adds a highlight's note, a reply and takes it away, each through the outbox", async () => {
    const cell = createFakeCell();
    const phone = await openDevice(cell, "phone");
    const made = await phone.replica.createNote({
      blocks: [{ block: paragraph("p1", "a passage"), ord: "a0", section: "note" }],
      folderId: null,
      tags: [],
      title: "Plans",
    });
    await phone.replica.write(made.id, {
      annotations: [
        {
          createdAt: 1,
          id: "h1",
          occurrence: null,
          op: "add",
          parentId: null,
          quote: "a passage",
          text: "",
        },
      ],
      ops: [],
    });
    let byte = 0;
    const edits = createAnnotationEdits({
      itemId: made.id,
      now: () => NOW,
      randomBytes: (length) => Uint8Array.from({ length }, () => (byte += 1) % 256),
      replica: phone.replica,
    });

    expect(await edits.note("h1", "why?")).toBe(true);
    expect(await edits.reply("h1", "because")).toBe(true);
    const item = await phone.replica.item(made.id);
    const store = await phone.replica.annotations(made.id);
    const [thread] = item === null ? [] : threadsOf(store, item);
    expect(thread?.root).toMatchObject({ quote: "a passage", text: "why?" });
    expect(thread?.replies.map((reply) => reply.entry.text)).toEqual(["because"]);
    // the passage holds no markers, so the sheet says it is not placed
    expect(thread?.anchored).toBe(false);

    expect(await edits.remove("h1")).toBe(true);
    await phone.replica.sync();
    expect(cell.annotation("h1")?.deletedAt).not.toBeNull();
    expect(await edits.note("h9", "nothing there")).toBe(false);
  });
});
