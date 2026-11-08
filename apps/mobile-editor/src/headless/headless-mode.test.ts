// the headless page over the bridge: a block's three sides in, the editor's merge out, under the
// load's nonce and the job's id.

import { describe, expect, it } from "vitest";

import type { LibraryBlock } from "@repo/notes/library/library-nodes";

import { connectPageBridge } from "../bridge/page-bridge";
import { createFakePhone, PHONE_NONCE } from "../test-support/fake-phone";
import { mergeSides, serveHeadless } from "./headless-mode";

const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

describe("the headless page's merge", () => {
  it("keeps both devices' lines of one paragraph, under the cell's block's id", () => {
    const merged = mergeSides({
      base: paragraph("p1", "one\ntwo\nthree"),
      mine: paragraph("p1", "one, mine\ntwo\nthree"),
      theirs: paragraph("p1", "one\ntwo\nthree, theirs"),
    });
    expect(merged?.overlapped).toBe(false);
    expect(merged?.block).toMatchObject({ children: [{ text: "one, mine\ntwo\nthree, theirs" }] });
  });
});

describe("the headless page over the bridge", () => {
  it("answers each job by its id under the load's nonce", async () => {
    const phone = createFakePhone();
    const connecting = connectPageBridge(phone.transport);
    phone.deliver({ mode: "headless", nonce: PHONE_NONCE, type: "init" });
    const { bridge, init } = await connecting;
    expect(init.mode).toBe("headless");
    serveHeadless(bridge);
    phone.deliver({
      id: 8,
      nonce: PHONE_NONCE,
      sides: {
        base: paragraph("p1", "a"),
        mine: paragraph("p1", "a, mine"),
        theirs: paragraph("p1", "a"),
      },
      type: "mergeJob",
    });
    const [merged] = phone.events("mergeAnswer");
    expect(merged).toMatchObject({
      id: 8,
      merged: { block: { children: [{ text: "a, mine" }] }, overlapped: false },
      nonce: PHONE_NONCE,
    });
  });
});
