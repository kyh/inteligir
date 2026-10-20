// a phone's own fill racing a Mac's Refresh of the same link, and a tag the phone wrote while its
// fill waited on the page: every device ends on one text, byte-identical with the hosted head,
// with no conflict copy (the url-item verdict in the phone's queue and in the Macs' merge). The
// page is served on loopback, which only the phone reads; A's Refresh is written by the scenario
// itself, as the bytes a Mac's fill writes, so the run is the same on every machine (§0.2.9).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { gitIn } from "../harness/exec";
import { conflictCopies, hostedVaultEnv, signInOwner, syncUntil } from "../harness/hosted-vault";
import type { AppInstance } from "../harness/instance";
import { startLoopbackFixture } from "../harness/lan-fixture";
import { macPendingFills } from "../harness/mac-fills";
import { drained, phoneRuntime, readPhoneNote, untilMirrored } from "../harness/phone-runtime";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const TITLE = "File over app";
const ITEM = `Unsorted/${TITLE}.md`;
const ARTICLE =
  "If you want to create digital artifacts that last, they must be files you can control.";
const A_FETCHED = "2026-10-17T09:12:33Z";
const SETTLE_DEADLINE_MS = 30_000;

// a JPEG's own start and end around bytes of its own, so each device's cover is a file of its own
const coverBytes = (seed: number): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...Array.from({ length: 2048 }, (_, i) => (i * seed) % 251),
    0xff,
    0xd9,
  ]);

const PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${TITLE}</title>`,
  '<meta property="og:site_name" content="Steph Ango">',
  '<meta property="og:image" content="/cover.jpg">',
  "</head><body><article>",
  `<h1>${TITLE}</h1>`,
  `<p>${ARTICLE}</p>`,
  "</article></body></html>",
].join("\n");

// the bytes a Mac's Refresh of the stub writes: its facts in their places, its cover, the article
const fillOf = (stub: string, cover: string): string => {
  const lines = stub.split("\n");
  const after = (key: string, added: readonly string[]): void => {
    const at = lines.findIndex((line) => line.startsWith(`${key}: `));
    expect(at !== -1, `the stub holds ${key}: ${stub}`);
    lines.splice(at + 1, 0, ...added);
  };
  after("url", ["site: Steph Ango"]);
  after("saved", [`fetched: ${A_FETCHED}`]);
  return `${lines.join("\n")}\n![](${cover})\n\n${ARTICLE}\n`;
};

// what A's Refresh writes: the cover first, then the item over the stub it read
const refreshOn = async (mac: AppInstance, stub: string): Promise<{ cover: string }> => {
  const cover = await mac.api.vault.assetWrite({
    baseName: "cover-a.jpg",
    dir: "assets/covers",
    file: new Blob([coverBytes(3)]),
  });
  await mac.api.vault.write({
    content: fillOf(stub, cover.path),
    guard: { kind: "overwrite" },
    path: ITEM,
  });
  return { cover: cover.path };
};

const idOf = (text: string): string => {
  const id = /^id: (?<id>.+)$/mu.exec(text)?.groups?.["id"];
  expect(id !== undefined, `the stub carries its id: ${text}`);
  return id;
};

const MACS = (a: AppInstance, b: AppInstance) =>
  [
    [a, "A"],
    [b, "B"],
  ] as const;

export const phoneFillRaceHosted: Scenario = {
  description:
    "a phone's own fill racing a Mac's Refresh of the same link, with a tag the phone wrote while its fill waited, ends byte-identical everywhere with no conflict copy",
  name: "phone-fill-race-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const site = await startLoopbackFixture({
      "/cover.jpg": { body: coverBytes(7), type: "image/jpeg" },
      "/file-over-app": { body: PAGE },
    });
    try {
      const worker = await ctx.cloudWorker();
      const boot = async (name: string): Promise<AppInstance> =>
        await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name });

      ctx.log("creating the account; two Macs sign in to it");
      await signUp(worker.origin);
      const a = await boot("a");
      await signInOwner(a, "A", "E2E Device A");
      await syncUntil(a.api, "A's first sync", "clean");
      const b = await boot("b");
      await signInOwner(b, "B", "E2E Device B");
      await syncUntil(b.api, "B's first sync", "clean");

      ctx.log("the phone saves a link; its fill waits on the page while both Macs pull the stub");
      const network = { online: true };
      const phone = await phoneRuntime(worker.origin, path.join(ctx.scratchDir, "phone"), network);
      await phone.start();
      await untilMirrored(phone, []);
      const release = site.hold("/file-over-app");
      const saved = await phone.items.saveLink({
        note: null,
        title: TITLE,
        url: site.url("/file-over-app?utm_source=share"),
      });
      expectEq(saved, { kind: "saved", path: ITEM }, "the phone's save");
      await drained(phone, "after the phone's save");
      const stub = await readPhoneNote(phone, ITEM);
      for (const [mac, label] of MACS(a, b)) {
        await syncUntil(mac.api, `${label} pulling the stub`, "clean");
        expectEq(
          await readFile(path.join(mac.vaultDir, ITEM), "utf-8"),
          stub,
          `the stub on ${label}`,
        );
        expectEq(
          macPendingFills(mac).filter((row) => row.itemId === idOf(stub)),
          [],
          `${label}'s queued fills for the phone's stub`,
        );
      }

      ctx.log("the phone tags the stub, and A's Refresh lands over the stub it held");
      const tagged = stub.replace("\n---\n", "\ntags:\n  - read\n---\n");
      const written = await phone.notes.write(ITEM, tagged, { base: stub, kind: "expected" });
      expectEq(written, { kind: "written" }, "the phone's tag");
      await drained(phone, "after the phone's tag");
      const refreshed = await refreshOn(a, stub);
      await syncUntil(a.api, "A meeting the phone's tag", "clean");
      await syncUntil(b.api, "B pulling A's merge", "clean");

      ctx.log("the page answers: the phone's own fill lands over the tag and meets A's Refresh");
      release();
      await phone.fills.settled();
      await drained(phone, "after the phone's fill");
      expectEq(
        site.requests().map((request) => request.path),
        ["/file-over-app", "/cover.jpg"],
        "what the phone fetched",
      );
      const settled = await pollUntil(
        async () => {
          for (const [mac, label] of MACS(a, b)) {
            await syncUntil(mac.api, `${label} pulling the phone's fill`, "clean");
          }
          await phone.notes.refresh();
          const texts = await Promise.all(
            [a, b].map(async (mac) => await readFile(path.join(mac.vaultDir, ITEM), "utf-8")),
          );
          return { phone: await readPhoneNote(phone, ITEM), texts };
        },
        (seen) => seen.texts.every((text) => text === seen.phone),
        {
          deadlineMs: SETTLE_DEADLINE_MS,
          describe: (seen) =>
            `the devices never settled on one text; the phone holds\n${seen.phone}\nthe Macs hold\n${seen.texts.join("\n----\n")}`,
          intervalMs: 1000,
        },
      );
      expect(
        settled.phone.includes(`fetched: ${A_FETCHED}\n`) &&
          settled.phone.includes(`![](${refreshed.cover})`) &&
          settled.phone.includes("tags:\n  - read\n") &&
          settled.phone.split(ARTICLE).length === 2,
        `the settled item carries the earlier read (A's), the phone's tag, and the article once: ${settled.phone}`,
      );
      expectEq(
        await gitIn(a.vaultDir, ["rev-parse", "HEAD^{tree}"]),
        await gitIn(b.vaultDir, ["rev-parse", "HEAD^{tree}"]),
        "A's tree and B's",
      );
      for (const [mac, label] of MACS(a, b)) {
        expectEq(await conflictCopies(mac), "", `${label}'s conflict copies`);
        const status = await mac.api.vault.status();
        expectEq(status.conflicts.length, 0, `${label}'s reported conflicts`);
      }
      expectEq(phone.notes.outbox.status.get().conflicts.length, 0, "the phone's conflicts");
      await gitIn(a.vaultDir, ["fsck", "--strict"]);
    } finally {
      await site.close();
    }
  },
};
