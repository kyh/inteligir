// the phone's verbs over items against a booted Worker, through the code its screens run: a
// thought saved from the Library's field, a new note retitled, a photo added as an image item of
// its own (its bytes staged, then uploaded), one moved to Deleted and restored; another device
// pulls each, the photo's bytes drawn from the cloud by its own file cache.

import path from "node:path";
import { randomBytes } from "node:crypto";
import { createPhoneSaves } from "@repo/mobile/items/phone-saves";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { drained, libraryOf, signedInPhone, untilItem } from "../harness/phone-runtime";
import type { Scenario } from "../harness/scenario";

// a JPEG's start of image and end of image around bytes of its own: what the phone added is what
// another device draws
const PHOTO = Uint8Array.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  ...Array.from({ length: 512 }, (_, i) => i % 251),
  0xff,
  0xd9,
]);

export const phoneFileOpsHosted: Scenario = {
  description:
    "the phone saves a thought, makes and retitles a note, adds a photo as an image item and moves an item to Deleted and back, all through its own runtime against a booted Worker; another device pulls each, and draws the photo's bytes as the phone sent them",
  name: "phone-file-ops-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    const phone = await signedInPhone(worker.origin, path.join(ctx.scratchDir, "phone"));
    const mac = await signedInPhone(worker.origin, path.join(ctx.scratchDir, "mac"), "E2E Mac");
    const { replica } = libraryOf(phone);
    const saves = createPhoneSaves({
      newBlockId: () => randomBytes(12).toString("hex"),
      replica,
    });

    ctx.log("the phone saves a thought, and makes a note it titles");
    const thought = await saves.saveText("Call the printer\n\nabout the proofs", {
      folderId: null,
    });
    expect(thought.kind === "saved", "the thought was saved");
    const note = await saves.newNote({ folderId: null });
    const held = await replica.item(note.id);
    expectEq(
      await replica.write(note.id, {
        ops: [{ base: held?.fields.title ?? "", field: "title", op: "set", value: "Trip" }],
      }),
      { kind: "queued" },
      "the note's title",
    );

    ctx.log("the phone adds a photo as an image item, its bytes staged until they are sent");
    const photo = await replica.createFile({
      file: { bytes: new Uint8Array(PHOTO), mime: "image/jpeg" },
      folderId: null,
      name: "Photo 2026-11-05 10.00.00.jpg",
      tags: [],
    });
    await drained(phone, "the phone's verbs");

    ctx.log("the Mac pulls every one, and draws the photo from the cloud");
    await untilItem(
      mac,
      note.id,
      (item) => item?.fields.title === "Trip",
      "the Mac pulls the note",
    );
    const thoughtOnMac = await untilItem(
      mac,
      thought.kind === "saved" ? thought.made.id : "",
      (item) => item?.bodyHeld === true,
      "the Mac pulls the thought",
    );
    expectEq(thoughtOnMac?.fields.title, "Call the printer", "the thought's title");
    const photoOnMac = await untilItem(
      mac,
      photo.id,
      (item) => item?.fields.originalSha === photo.sha,
      "the Mac pulls the photo",
    );
    expectEq(photoOnMac?.fields.kind, "image", "the photo is an image item");
    expect((await libraryOf(mac).files.fileUri(photo.sha)) !== null, "the Mac draws the photo");

    ctx.log("the phone moves the note to Deleted and back");
    await replica.deleteItems([note.id]);
    await drained(phone, "the deletion");
    await untilItem(
      mac,
      note.id,
      (item) => item?.fields.deletedAt !== null,
      "the Mac sees it deleted",
    );
    await replica.restoreItems([note.id]);
    await drained(phone, "the restore");
    await untilItem(
      mac,
      note.id,
      (item) => item?.fields.deletedAt === null,
      "the Mac sees it back",
    );
  },
};
