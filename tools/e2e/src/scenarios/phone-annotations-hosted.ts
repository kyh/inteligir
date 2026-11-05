// the phone's highlights against a booted Worker, through the code its screens run: the editor
// page's highlight request (the item page's ports), then the annotations sheet's note, reply and
// delete, online and offline; another device pulls each as the phone wrote it.

import { randomBytes } from "node:crypto";
import path from "node:path";
import { createAnnotationEdits } from "@repo/mobile/annotations/annotation-edits";
import { createItemPorts } from "@repo/mobile/editor/item-ports";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { drained, libraryOf, signedInPhone, untilItem } from "../harness/phone-runtime";
import type { Phone } from "../harness/phone-runtime";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const PASSAGE = "Apps are ephemeral, and the files they write outlast every one of them.";

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

// the item's highlights as a device holds them, by id
const highlightsOn = async (phone: Phone, itemId: string) =>
  await libraryOf(phone).replica.annotations(itemId);

export const phoneAnnotationsHosted: Scenario = {
  description:
    "the phone highlights a passage through its item page's ports and notes it, replies offline and deletes through its annotations sheet, against a booted Worker; another device pulls each highlight, note and reply as the phone wrote it, and the deletion",
  name: "phone-annotations-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);

    ctx.log("the Mac writes a note; the phone pulls it");
    const mac = await signedInPhone(worker.origin, path.join(ctx.scratchDir, "mac"), "E2E Mac");
    const made = await libraryOf(mac).replica.createNote({
      blocks: [{ block: paragraph("p1", PASSAGE), ord: "a0", section: "note" }],
      folderId: null,
      tags: [],
      title: "Files",
    });
    await drained(mac, "the Mac's note");
    const phone = await signedInPhone(worker.origin, path.join(ctx.scratchDir, "phone"));
    await untilItem(phone, made.id, (item) => item?.bodyHeld === true, "the phone pulls the note");

    ctx.log("the phone highlights the passage and notes it");
    const ports = createItemPorts({ now: () => Date.now(), replica: libraryOf(phone).replica });
    const edits = createAnnotationEdits({
      itemId: made.id,
      now: () => Date.now(),
      randomBytes: (length) => randomBytes(length),
      replica: libraryOf(phone).replica,
    });
    expectEq(
      await ports.addHighlight({ id: "hl-phone-1", itemId: made.id, quote: "files they write" }),
      { queued: true },
      "the highlight",
    );
    expectEq(await edits.note("hl-phone-1", "why files win"), true, "the highlight's note");
    await drained(phone, "the highlight");
    const pulled = await pollUntil(
      async () => {
        await libraryOf(mac).replica.sync();
        return await highlightsOn(mac, made.id);
      },
      (store) => store["hl-phone-1"]?.text === "why files win",
      { deadlineMs: 20_000, describe: () => "the Mac pulls the phone's highlight and its note" },
    );
    expectEq(pulled["hl-phone-1"]?.quote, "files they write", "the highlight's quote");

    ctx.log("offline, the phone replies; back online the reply lands");
    phone.network.online = false;
    expectEq(await edits.reply("hl-phone-1", "and outlast the apps"), true, "the offline reply");
    expectEq(libraryOf(phone).replica.status().unsent, 1, "the reply waits on the phone");
    phone.network.online = true;
    await drained(phone, "the reply");
    const replied = await pollUntil(
      async () => {
        await libraryOf(mac).replica.sync();
        return await highlightsOn(mac, made.id);
      },
      (store) => Object.values(store).some((entry) => entry.parentId === "hl-phone-1"),
      { deadlineMs: 20_000, describe: () => "the Mac pulls the phone's reply" },
    );
    expect(
      Object.values(replied).some((entry) => entry.text === "and outlast the apps"),
      "the reply's words",
    );

    ctx.log("the phone deletes the highlight, and the Mac's copy goes too");
    expectEq(await edits.remove("hl-phone-1"), true, "the deletion");
    await drained(phone, "the deletion");
    await pollUntil(
      async () => {
        await libraryOf(mac).replica.sync();
        return await highlightsOn(mac, made.id);
      },
      (store) => store["hl-phone-1"] === undefined,
      { deadlineMs: 20_000, describe: () => "the Mac lets the highlight go" },
    );
  },
};
