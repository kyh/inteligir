// the phone's verbs over items against a booted Worker, through the code its screens run: a
// thought saved from the Library's field, a new note retitled, a photo added as an image item of
// its own (its bytes sent up, then the item), one moved to Deleted and restored; another device
// reads each, the photo's bytes drawn from the cloud by its own file cache.

import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { libraryOf, signedInPhone, untilItem } from "../harness/phone-runtime";
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
    "the phone saves a thought, makes and retitles a note, adds a photo as an image item and moves an item to Deleted and back, all through its own runtime against a booted Worker; another device reads each, and draws the photo's bytes as the phone sent them",
  name: "phone-file-ops-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);
    const phone = await signedInPhone(worker.origin);
    const mac = await signedInPhone(worker.origin, "E2E Mac");
    const { client, newId, saves } = libraryOf(phone);

    ctx.log("the phone saves a thought, and makes a note it titles");
    const thought = await saves.saveText("Call the printer\n\nabout the proofs", {
      folderId: null,
    });
    expect(thought.kind === "saved", `the thought was saved: ${JSON.stringify(thought)}`);
    const note = await saves.newNote({ folderId: null });
    expect(note.kind === "saved", `the note was made: ${JSON.stringify(note)}`);
    const held = await client.library.items.get({ id: note.id });
    await client.library.write({
      itemId: note.id,
      opId: newId(),
      ops: [{ base: held.fields.title, field: "title", op: "set", value: "Trip" }],
    });

    ctx.log("the phone adds a photo as an image item, its bytes sent before the item");
    const photo = await saves.addFile(
      { bytes: new Uint8Array(PHOTO), mime: "image/jpeg", name: "Photo 2026-11-05 10.00.00.jpg" },
      { folderId: null },
    );
    expect(photo.kind === "saved", `the photo was saved: ${JSON.stringify(photo)}`);

    ctx.log("the Mac reads every one, and draws the photo from the cloud");
    await untilItem(
      mac,
      note.id,
      (item) => item?.fields.title === "Trip",
      "the Mac reads the note",
    );
    const thoughtOnMac = await untilItem(
      mac,
      thought.id,
      (item) => item !== null,
      "the Mac reads the thought",
    );
    expectEq(thoughtOnMac?.fields.title, "Call the printer", "the thought's title");
    const photoOnMac = await untilItem(
      mac,
      photo.id,
      (item) => item !== null,
      "the Mac reads the photo",
    );
    expectEq(photoOnMac?.fields.kind, "image", "the photo is an image item");
    const sha = photoOnMac?.fields.originalSha ?? null;
    expect(sha !== null, "the photo names its bytes");
    expect((await libraryOf(mac).files.fileUri(sha)) !== null, "the Mac draws the photo");
    expectEq(
      await libraryOf(mac).files.heldFile(sha),
      { bytes: new Uint8Array(PHOTO), mime: "image/jpeg" },
      "the photo's bytes as the phone sent them",
    );

    ctx.log("the phone moves the note to Deleted and back");
    await client.library.items.delete({ ids: [note.id], opId: newId() });
    await untilItem(
      mac,
      note.id,
      (item) => item?.fields.deletedAt !== null,
      "the Mac sees it deleted",
    );
    await client.library.items.restore({ ids: [note.id], opId: newId() });
    await untilItem(
      mac,
      note.id,
      (item) => item?.fields.deletedAt === null,
      "the Mac sees it back",
    );
  },
};
