// a phone's save of a link against a real Worker and a real Mac: offline it is a pending card with
// one outbox row and its fill waiting; back online the phone reads the page itself (its own fetch,
// its page's reader over linkedom) and the stub, its fill and its cover land as ONE change on the
// hosted head, which the Mac pulls as it is. A Mac never touches a phone's stub, not even one whose
// page the phone could not read yet. The page is served on loopback, which only the phone's
// runtime reads (it has no address guard), so the run is the same on every machine (§0.2.9).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { gitIn } from "../harness/exec";
import { hostedVaultEnv, signInOwner, syncUntil } from "../harness/hosted-vault";
import type { AppInstance } from "../harness/instance";
import { startLoopbackFixture } from "../harness/lan-fixture";
import type { LanFixture } from "../harness/lan-fixture";
import { macPendingFills } from "../harness/mac-fills";
import {
  cardAt,
  drained,
  phoneRuntime,
  readPhoneNote,
  untilMirrored,
} from "../harness/phone-runtime";
import { reserveFreePorts } from "../harness/ports";
import type { Scenario, ScenarioContext } from "../harness/scenario";

const TITLE = "File over app";
const ITEM = `Unsorted/${TITLE}.md`;
const LATER_TITLE = "A page that is down";
const LATER_ITEM = `Unsorted/${LATER_TITLE}.md`;
const SITE = "Steph Ango";
const DESCRIPTION = "Files you can control, in formats that are easy to retrieve and read.";
const ARTICLE =
  "If you want to create digital artifacts that last, they must be files you can control.";
// longer than the sweep a Mac once ran every ten seconds for other devices' stubs
const UNTOUCHED_MS = 12_000;

// a JPEG's own start and end around a cover's worth of bytes: what the phone fetched is what lands
const coverBytes = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...Array.from({ length: 4096 }, (_, i) => i % 251),
    0xff,
    0xd9,
  ]);

const PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8">',
  `<title>${TITLE}</title>`,
  `<meta property="og:site_name" content="${SITE}">`,
  `<meta name="description" content="${DESCRIPTION}">`,
  '<meta property="og:image" content="/cover.jpg">',
  "</head><body><article>",
  `<h1>${TITLE}</h1>`,
  `<p>${ARTICLE}</p>`,
  "<p>Apps are ephemeral, and the files they write outlast every one of them.</p>",
  "</article></body></html>",
].join("\n");

const keysOf = (text: string): string[] =>
  (/^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(text)?.groups?.["yaml"] ?? "").split("\n");

const idOf = (text: string): string => {
  const id = keysOf(text)
    .find((line) => line.startsWith("id: "))
    ?.slice("id: ".length);
  expect(id !== undefined, `the stub carries its id: ${text}`);
  return id;
};

const fillRows = async (phone: AppRuntime) => {
  const rows = await phone.notes.pendingFills.list();
  return rows.map((row) => ({ attempts: row.attempts, path: row.path, url: row.url }));
};

const savesOffline = async (
  ctx: ScenarioContext,
  phone: AppRuntime,
  network: { online: boolean },
  site: LanFixture,
): Promise<void> => {
  ctx.log("offline, the phone saves a link: a pending card with its fill waiting");
  network.online = false;
  const shared = site.url("/file-over-app?utm_source=share&utm_medium=ios");
  const saved = await phone.items.saveLink({ note: null, title: TITLE, url: shared });
  expectEq(saved, { kind: "saved", path: ITEM }, "the phone's offline save");
  expectEq(phone.notes.outbox.status.get().unsent, 1, "the phone's unsent changes offline");
  expectEq(
    await fillRows(phone),
    [{ attempts: 0, path: ITEM, url: site.url("/file-over-app") }],
    "the fill the phone queued with its save",
  );
  const pending = cardAt(phone, ITEM);
  expect(
    pending?.pending === true && pending.kind === "link" && pending.cover === null,
    `the phone's card before its page was read: ${JSON.stringify(pending)}`,
  );
  expectEq(site.requests(), [], "what the phone fetched offline");
};

// the phone's item once it read the page: its tracking cut, its facts, its cover and its article
const readsOnline = async (
  ctx: ScenarioContext,
  phone: AppRuntime,
  network: { online: boolean },
  site: LanFixture,
): Promise<{ filled: string; cover: string }> => {
  ctx.log("online, the phone reads the page, and its save lands read");
  network.online = true;
  await phone.fills.settled();
  await drained(phone, "after the phone's fill");
  expectEq(await fillRows(phone), [], "the phone's fills once read");
  expectEq(
    site.requests().map((request) => request.path),
    ["/file-over-app", "/cover.jpg"],
    "what the phone fetched: the page, then its cover",
  );
  const card = cardAt(phone, ITEM);
  const cover = card?.cover ?? "";
  expect(
    card?.pending === false &&
      card.site === SITE &&
      /^assets\/covers\/[0-9a-f]{16}\.jpg$/u.test(cover),
    `the phone's card once it read the page: ${JSON.stringify(card)}`,
  );
  const held = await phone.notes.attachmentFile(cover);
  expect(held.ok, `the phone holds the cover: ${held.ok ? "" : held.message}`);
  const filled = await readPhoneNote(phone, ITEM);
  const keys = keysOf(filled);
  expect(
    keys.includes(`url: ${site.url("/file-over-app")}`) &&
      keys.includes(`site: ${SITE}`) &&
      keys.includes(`description: ${DESCRIPTION}`) &&
      keys.some((line) => line.startsWith("fetched: ")) &&
      keys.some((line) => line.startsWith("saved: ")) &&
      filled.includes(`![](${cover})`) &&
      filled.includes(ARTICLE),
    `the item the phone wrote:\n${filled}`,
  );
  return { cover, filled };
};

const macPulls = async (
  ctx: ScenarioContext,
  a: AppInstance,
  read: { filled: string; cover: string },
): Promise<void> => {
  ctx.log("A pulls the item as the phone wrote it, in one change with its cover");
  await syncUntil(a.api, "A pulling the phone's save", "clean");
  expectEq(
    await readFile(path.join(a.vaultDir, ITEM), "utf-8"),
    read.filled,
    "the item's bytes, phone and A",
  );
  expectEq(
    await readFile(path.join(a.vaultDir, read.cover)),
    Buffer.from(coverBytes()),
    "the cover's bytes, fetched by the phone",
  );
  const log = await gitIn(a.vaultDir, ["log", "--format=%H", "--", ITEM]);
  const commits = log.split("\n");
  expectEq(commits.length, 1, "the changes that wrote the item");
  const wrote = await gitIn(a.vaultDir, ["show", "--name-only", "--format=", commits[0] ?? ""]);
  expectEq(
    wrote.split("\n").toSorted(),
    [read.cover, ITEM].toSorted(),
    "what the phone's one change wrote",
  );
};

const macLeavesPhoneStub = async (
  ctx: ScenarioContext,
  a: AppInstance,
  phone: AppRuntime,
  closedPort: number,
): Promise<void> => {
  ctx.log("a link whose page is down stays the phone's stub: A never reads it");
  const later = await phone.items.saveLink({
    note: null,
    title: LATER_TITLE,
    url: `http://127.0.0.1:${String(closedPort)}/down`,
  });
  expectEq(later, { kind: "saved", path: LATER_ITEM }, "the phone's second save");
  await phone.fills.settled();
  await drained(phone, "after the second save");
  const stub = await readPhoneNote(phone, LATER_ITEM);
  expect(
    !keysOf(stub).some((line) => line.startsWith("fetched: ")),
    `a page the phone could not reach waits for a later try: ${stub}`,
  );
  const rows = await fillRows(phone);
  expectEq(
    rows.map((row) => row.attempts),
    [1],
    "the phone's tries of the page that is down",
  );
  expect(cardAt(phone, LATER_ITEM)?.pending === true, "the phone's card still waits");
  await syncUntil(a.api, "A pulling the second stub", "clean");
  await delay(UNTOUCHED_MS);
  await syncUntil(a.api, "A after a while", "clean");
  expectEq(
    await readFile(path.join(a.vaultDir, LATER_ITEM), "utf-8"),
    stub,
    "the phone's stub on A, untouched",
  );
  expectEq(
    macPendingFills(a).filter((row) => row.itemId === idOf(stub)),
    [],
    "A's queued fills for the phone's stub",
  );
  const log = await gitIn(a.vaultDir, ["log", "--format=%H", "--", LATER_ITEM]);
  expectEq(log.split("\n").length, 1, "the changes that wrote the phone's stub");
};

export const phoneSaveHosted: Scenario = {
  description:
    "an offline phone save of a link is a pending card with its fill waiting; online the phone reads the page and the stub, its fill and its cover land as one change the Mac pulls; a Mac never touches a phone's stub; a second save answers already saved",
  name: "phone-save-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS + UNTOUCHED_MS,
  async run(ctx) {
    const site = await startLoopbackFixture({
      "/cover.jpg": { body: coverBytes(), type: "image/jpeg" },
      "/file-over-app": { body: PAGE },
    });
    // a port nothing listens on: a page the phone cannot read yet
    const [closed = 0] = await reserveFreePorts(1);
    try {
      const worker = await ctx.cloudWorker();

      ctx.log("creating the account; A signs in and pushes its library");
      await signUp(worker.origin);
      const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
      await signInOwner(a, "A", "E2E Device A");
      await syncUntil(a.api, "A's first sync", "clean");

      ctx.log("the phone mirrors the library");
      const network = { online: true };
      const phone = await phoneRuntime(worker.origin, path.join(ctx.scratchDir, "phone"), network);
      await phone.start();
      await untilMirrored(phone, []);

      await savesOffline(ctx, phone, network, site);
      const read = await readsOnline(ctx, phone, network, site);
      await macPulls(ctx, a, read);
      await macLeavesPhoneStub(ctx, a, phone, closed);

      ctx.log("saving the same link again answers where it already is");
      expectEq(
        await phone.items.saveLink({
          note: null,
          title: "Again",
          url: site.url("/file-over-app?fbclid=again#top"),
        }),
        { kind: "already", path: ITEM },
        "the second save",
      );
      expectEq(phone.notes.outbox.status.get().unsent, 0, "the phone queued nothing for it");
    } finally {
      await site.close();
    }
  },
};
