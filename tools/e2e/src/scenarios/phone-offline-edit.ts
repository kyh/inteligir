import path from "node:path";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import {
  drained,
  libraryOf,
  phoneRuntime,
  signedInPhone,
  untilItem,
} from "../harness/phone-runtime";
import type { Phone } from "../harness/phone-runtime";
import type { Scenario } from "../harness/scenario";

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

// three paragraphs of one note, so the first and the last are far apart
const PLAN = ["first", "second", "third"];

const textOf = (block: LibraryBlock | undefined): string =>
  block?.children.map((child) => ("text" in child ? child.text : "")).join("") ?? "";

const textsOf = async (phone: Phone, id: string): Promise<string[]> => {
  const item = await libraryOf(phone).replica.item(id);
  return item?.blocks.map(({ block }) => textOf(block)) ?? [];
};

// one paragraph rewritten over the block the device holds now
const rewrite = async (phone: Phone, id: string, blockId: string, text: string) => {
  const { replica } = libraryOf(phone);
  const item = await replica.item(id);
  const held = item?.blocks.find(({ block }) => block.id === blockId);
  expect(held !== undefined, `the device holds ${blockId}`);
  return await replica.write(id, {
    ops: [{ baseHash: held.hash, block: paragraph(blockId, text), op: "put" }],
  });
};

export const phoneOfflineEdit: Scenario = {
  description:
    "the phone's own runtime (`composeRuntime` under node, over node's sqlite) against a booted Worker: offline it edits a note's first paragraph while another device edits its last; reconnected, both land in the cell, merged by block; a relaunch offline reads what the phone holds; both rewrite one paragraph, and the editor page's merge keeps the phone's lines and says the overlap",
  name: "phone-offline-edit",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const worker = await ctx.cloudWorker();
    await signUp(worker.origin);

    ctx.log("the Mac writes a note of three paragraphs; the phone signs in and pulls it");
    const mac = await signedInPhone(worker.origin, path.join(ctx.scratchDir, "mac"), "E2E Mac");
    const made = await libraryOf(mac).replica.createNote({
      blocks: PLAN.map((text, index) => ({
        block: paragraph(`p${String(index + 1)}`, text),
        ord: `a${String(index)}`,
        section: "note",
      })),
      folderId: null,
      tags: [],
      title: "Plan",
    });
    await drained(mac, "the Mac's note");
    const phone = await signedInPhone(worker.origin, path.join(ctx.scratchDir, "phone"));
    await untilItem(phone, made.id, (item) => item?.bodyHeld === true, "the phone pulls the note");
    expectEq(await textsOf(phone, made.id), PLAN, "the phone's note");

    ctx.log("offline, the phone edits the first paragraph while the Mac edits the last");
    phone.network.online = false;
    expectEq(
      await rewrite(phone, made.id, "p1", "the phone's first"),
      { kind: "queued" },
      "the phone's offline edit",
    );
    expectEq(libraryOf(phone).replica.status().unsent, 1, "the phone holds its edit");
    await rewrite(mac, made.id, "p3", "the Mac's third");
    await drained(mac, "the Mac's far edit");

    ctx.log("a relaunch offline opens the note as the phone left it");
    await libraryOf(phone).replica.close();
    const relaunched = await phoneRuntime(worker.origin, phone.dir, {
      kept: phone.kept(),
      network: phone.network,
    });
    expectEq(
      await textsOf(relaunched, made.id),
      ["the phone's first", "second", "third"],
      "the relaunched phone's note, offline",
    );
    expectEq(libraryOf(relaunched).replica.status().unsent, 1, "its edit still queued");

    ctx.log("reconnected, the phone sends its edit, and both devices hold both");
    relaunched.network.online = true;
    await drained(relaunched, "the phone's far edit");
    const both = ["the phone's first", "second", "the Mac's third"];
    expectEq(await textsOf(relaunched, made.id), both, "the phone's merged note");
    await untilItem(
      mac,
      made.id,
      (item) => textOf(item?.blocks[0]?.block) === "the phone's first",
      "the Mac pulls the phone's edit",
    );
    expectEq(await textsOf(mac, made.id), both, "the Mac's merged note");

    ctx.log("offline again, both rewrite the second paragraph: the phone's lines are kept");
    relaunched.network.online = false;
    await rewrite(relaunched, made.id, "p2", "the phone's second");
    await rewrite(mac, made.id, "p2", "the Mac's second");
    await drained(mac, "the Mac's same-block edit");
    const overlapped: string[] = [];
    libraryOf(relaunched).replica.onChange((change) => {
      overlapped.push(...change.overlapped);
    });
    relaunched.network.online = true;
    await drained(relaunched, "the phone's same-block edit");
    expectEq(overlapped, [made.id], "the merge said it kept the phone's lines");
    const kept = ["the phone's first", "the phone's second", "the Mac's third"];
    expectEq(await textsOf(relaunched, made.id), kept, "the phone's note after the overlap");
    await untilItem(
      mac,
      made.id,
      (item) => textOf(item?.blocks[1]?.block) === "the phone's second",
      "the Mac pulls the phone's kept lines",
    );
    expectEq(await textsOf(mac, made.id), kept, "the Mac's note after the overlap");
  },
};
