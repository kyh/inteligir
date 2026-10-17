// a phone's saves and edits against real Macs' fills, end to end across the lanes: the phone (M)
// saves a stub through the hosted library, a Mac's own fill queue (S1) reads it within the phone's
// minute rather than the fifteen another Mac's stub waits, and the phone's card shows the site and
// the cover. Two Macs filling one stub at once, and a Refresh on a Mac racing a phone's tag, each
// settle on one text everywhere with no conflict copy (M's verdict in S2's merge and the phone's
// queue). A phone's delete of an image item takes its original with it on the hosted head (S2's
// attachmentsFreedBy under M's delete). The pages are served on this machine's own network address,
// so a machine with none the guard reads from skips at the start.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { gitIn } from "../harness/exec";
import { conflictCopies, hostedVaultEnv, signInOwner, syncUntil } from "../harness/hosted-vault";
import type { AppInstance } from "../harness/instance";
import { startLanFixture } from "../harness/lan-fixture";
import type { LanFixture, LanRoute } from "../harness/lan-fixture";
import {
  cardAt,
  drained,
  phoneRuntime,
  readPhoneNote,
  untilMirrored,
} from "../harness/phone-runtime";
import { solidPng } from "../harness/png-pixels";
import { pollUntil } from "../harness/poll";
import type { Scenario, ScenarioContext } from "../harness/scenario";

const TITLE = "File over app";
const ITEM = `Unsorted/${TITLE}.md`;
const RACE_TITLE = "Two Macs read this page";
const RACE_ITEM = `Unsorted/${RACE_TITLE}.md`;
const SITE = "Steph Ango";
const FIRST_DESCRIPTION = "Files you can control in formats that are easy to read.";
const REFRESHED_DESCRIPTION = "Files last and apps do not.";
const PICTURE_NAME = "pier.png";
const TAG = "read";
// a phone stub waits up to a minute, and the sweep that finds it looks every ten seconds
const PHONE_FILL_DEADLINE_MS = 100_000;
const SETTLE_DEADLINE_MS = 60_000;

const pageOf = (title: string, description: string): string =>
  [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta name="description" content="${description}">`,
    '<meta property="og:image" content="/cover.png">',
    "</head><body><article>",
    `<h1>${title}</h1>`,
    "<p>If you want to create digital artifacts that last, they must be files you can control.</p>",
    "<p>Apps are ephemeral, and the files they write outlast every one of them.</p>",
    "</article></body></html>",
  ].join("\n");

// mutable on purpose: the fixture reads its routes per request, so a page can change between fills
const ROUTES = {
  "/cover.png": { body: solidPng(640, 400, [40, 90, 160, 255]), type: "image/png" },
  "/file-over-app": { body: pageOf(TITLE, FIRST_DESCRIPTION) },
  "/two-macs": { body: pageOf(RACE_TITLE, FIRST_DESCRIPTION) },
} satisfies Record<string, LanRoute>;

const keysOf = (text: string): string[] =>
  (/^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(text)?.groups?.["yaml"] ?? "").split("\n");

const fetchedOf = (text: string): string | null =>
  keysOf(text)
    .find((line) => line.startsWith("fetched: "))
    ?.slice("fetched: ".length) ?? null;

const onMac = async (mac: AppInstance, vaultPath: string): Promise<string | null> => {
  const absolute = path.join(mac.vaultDir, vaultPath);
  return existsSync(absolute) ? await readFile(absolute, "utf-8") : null;
};

// every device holding one text for `item`, and the Macs one tree, with no copy anywhere
const untilSettled = async (
  macs: readonly (readonly [AppInstance, string])[],
  phone: AppRuntime,
  item: string,
  holds: (text: string) => boolean,
  what: string,
): Promise<string> => {
  const settled = await pollUntil(
    async () => {
      for (const [mac, label] of macs) {
        await syncUntil(mac.api, `${label} while ${what}`, "clean");
      }
      await phone.notes.refresh();
      const texts = await Promise.all(macs.map(async ([mac]) => await onMac(mac, item)));
      return { phone: await readPhoneNote(phone, item), texts };
    },
    (seen) => seen.texts.every((text) => text === seen.phone) && holds(seen.phone),
    {
      deadlineMs: SETTLE_DEADLINE_MS,
      describe: (seen) =>
        `${what}: the devices never settled on one text; the phone holds\n${seen.phone}\nthe Macs hold\n${seen.texts.join("\n----\n")}`,
      intervalMs: 1000,
    },
  );
  const [first] = macs;
  for (const [mac, label] of macs) {
    expectEq(await conflictCopies(mac), "", `${label}'s conflict copies after ${what}`);
    const status = await mac.api.vault.status();
    expectEq(status.conflicts.length, 0, `${label}'s reported conflicts after ${what}`);
    if (first !== undefined) {
      expectEq(
        await gitIn(mac.vaultDir, ["rev-parse", "HEAD^{tree}"]),
        await gitIn(first[0].vaultDir, ["rev-parse", "HEAD^{tree}"]),
        `${label}'s tree against ${first[1]}'s after ${what}`,
      );
    }
  }
  expectEq(
    phone.notes.outbox.status.get().conflicts.length,
    0,
    `the phone's conflicts after ${what}`,
  );
  return settled.phone;
};

const phoneFillsWithinTheMinute = async (
  a: AppInstance,
  phone: AppRuntime,
  url: string,
): Promise<string> => {
  const saved = await phone.items.saveLink({ note: null, title: TITLE, url });
  expectEq(saved, { kind: "saved", path: ITEM }, "the phone's save");
  await drained(phone, "after the phone's save");
  await syncUntil(a.api, "A pulling the phone's stub", "clean");

  // A fills it on its own, and its fill commits and pushes; the phone sees it on a refresh. The
  // deadline is the phone's minute and the sweep's ten seconds: another Mac's stub would wait
  // fifteen minutes
  const card = await pollUntil(
    async () => {
      await phone.notes.refresh();
      return cardAt(phone, ITEM);
    },
    (seen) => seen?.pending === false && seen.cover !== null,
    {
      deadlineMs: PHONE_FILL_DEADLINE_MS,
      describe: (seen) => `the phone's card is still ${JSON.stringify(seen)}`,
      intervalMs: 1000,
    },
  );
  expectEq(card?.site, SITE, "the site on the phone's card");
  const cover = card?.cover ?? "";
  expect(
    /^assets\/covers\/[0-9a-f]{16}\.[a-z]+$/u.test(cover),
    `the phone's card shows a cover the fill wrote: ${cover}`,
  );
  const held = await phone.notes.attachmentFile(cover);
  expect(held.ok, `the phone holds the cover: ${held.ok ? "" : held.message}`);
  const filled = await readPhoneNote(phone, ITEM);
  expectEq(await onMac(a, ITEM), filled, "the filled item on A and on the hosted head");
  expect(
    keysOf(filled).includes(`description: ${FIRST_DESCRIPTION}`),
    `the fill wrote the page's description:\n${filled}`,
  );
  return filled;
};

const twoMacsRace = async (
  ctx: ScenarioContext,
  lan: LanFixture,
  a: AppInstance,
  b: AppInstance,
  phone: AppRuntime,
): Promise<void> => {
  ctx.log("the phone saves a second link, and both Macs pull its stub");
  const saved = await phone.items.saveLink({
    note: null,
    title: RACE_TITLE,
    url: lan.url("/two-macs?utm_source=share"),
  });
  expectEq(saved, { kind: "saved", path: RACE_ITEM }, "the phone's second save");
  await drained(phone, "after the phone's second save");
  await syncUntil(a.api, "A pulling the second stub", "clean");
  await syncUntil(b.api, "B pulling the second stub", "clean");

  ctx.log("both Macs fill it at once: the page answers neither until both have asked");
  lan.gate("/two-macs", 2);
  const [onA, onB] = await Promise.all([
    a.api.items.refresh({ path: RACE_ITEM, wait: true }),
    b.api.items.refresh({ path: RACE_ITEM, wait: true }),
  ]);
  expectEq([onA.fill, onB.fill], [{ state: "filled" }, { state: "filled" }], "the two fills");

  ctx.log("the two fills settle on one text on both Macs and the phone, with no copy");
  const settled = await untilSettled(
    [
      [a, "A"],
      [b, "B"],
    ],
    phone,
    RACE_ITEM,
    (text) => fetchedOf(text) !== null && keysOf(text).includes(`site: ${SITE}`),
    "two Macs filled one stub",
  );
  expect(
    settled.includes("Apps are ephemeral, and the files they write outlast every one of them."),
    `the settled item holds the page's text once:\n${settled}`,
  );
  expectEq(
    settled.split("Apps are ephemeral").length - 1,
    1,
    "how many times the settled item holds the article",
  );
};

const refreshRacesATag = async (
  ctx: ScenarioContext,
  a: AppInstance,
  b: AppInstance,
  phone: AppRuntime,
  network: { online: boolean },
  filled: string,
): Promise<void> => {
  ctx.log("offline, the phone tags the filled item");
  network.online = false;
  const tagged = filled.replace("\n---\n", `\ntags:\n  - ${TAG}\n---\n`);
  const written = await phone.notes.write(ITEM, tagged, { base: filled, kind: "expected" });
  expectEq(written, { kind: "written" }, "the phone's offline tag");

  ctx.log("meanwhile A reads the page again, which has changed, and pushes it");
  ROUTES["/file-over-app"] = { body: pageOf(TITLE, REFRESHED_DESCRIPTION) };
  const refreshed = await a.api.items.refresh({ path: ITEM, wait: true });
  expectEq(refreshed.fill, { state: "filled" }, "A's refresh");
  const onA = (await onMac(a, ITEM)) ?? "";
  expect(
    keysOf(onA).includes(`description: ${REFRESHED_DESCRIPTION}`),
    `A's refresh wrote the page as it is now:\n${onA}`,
  );
  await syncUntil(a.api, "A pushing its refresh", "clean");

  ctx.log("the phone reconnects: its tag and A's refresh both stay");
  network.online = true;
  await drained(phone, "after reconnecting");
  const settled = await untilSettled(
    [
      [a, "A"],
      [b, "B"],
    ],
    phone,
    ITEM,
    (text) =>
      keysOf(text).includes(`description: ${REFRESHED_DESCRIPTION}`) &&
      text.includes(`tags:\n  - ${TAG}\n`),
    "a refresh raced the phone's tag",
  );
  expect(
    fetchedOf(settled) !== null && fetchedOf(settled) === fetchedOf(onA),
    `the settled item carries A's refresh:\n${settled}`,
  );
};

const phoneDeletesAPicture = async (
  ctx: ScenarioContext,
  a: AppInstance,
  b: AppInstance,
  phone: AppRuntime,
): Promise<void> => {
  ctx.log("A saves a picture, and the phone mirrors its item and its original");
  const saved = await a.api.items.saveFile({
    file: new Blob([solidPng(48, 32, [20, 200, 40, 255])]),
    name: PICTURE_NAME,
  });
  const wrapper = saved.path;
  const embed = /!\[\]\((?<target>[^)\s]+)\)/u.exec((await onMac(a, wrapper)) ?? "")?.groups?.[
    "target"
  ];
  expect(embed !== undefined, `${wrapper} embeds its original`);
  const original = embed;
  await syncUntil(a.api, "A pushing the picture", "clean");
  await pollUntil(
    async () => {
      await phone.notes.refresh();
      return phone.notes.tree.get();
    },
    (tree) =>
      tree.state === "ready" &&
      tree.progress === null &&
      [wrapper, original].every((wanted) => tree.entries.some((entry) => entry.path === wanted)),
    {
      deadlineMs: SETTLE_DEADLINE_MS,
      describe: (tree) => `the phone never listed ${wrapper} and ${original}: ${tree.state}`,
      intervalMs: 1000,
    },
  );
  await untilMirrored(phone, [wrapper, original]);

  ctx.log("the phone deletes the picture's item: its original leaves with it");
  await phone.fileOps.remove(wrapper);
  await drained(phone, "after the phone's delete");
  for (const [mac, label] of [
    [a, "A"],
    [b, "B"],
  ] as const) {
    await syncUntil(mac.api, `${label} pulling the phone's delete`, "clean");
    for (const gone of [wrapper, original]) {
      expect(!existsSync(path.join(mac.vaultDir, gone)), `${gone} is still on ${label}`);
    }
    const tracked = await gitIn(mac.vaultDir, ["ls-files", "--", wrapper, original]);
    expectEq(tracked, "", `what ${label}'s tree still tracks of the picture`);
  }
  expectEq(
    await gitIn(a.vaultDir, ["rev-parse", "HEAD^{tree}"]),
    await gitIn(b.vaultDir, ["rev-parse", "HEAD^{tree}"]),
    "A's tree and B's, each the hosted head's",
  );
};

export const phoneFillIntegrated: Scenario = {
  description:
    "a phone stub of a LAN-fixture page is filled by a real Mac within the phone's minute and its card shows site and cover; two Macs filling one stub converge; a refresh racing a phone tag keeps both; a phone delete of an image item removes its original",
  name: "phone-fill-integrated",
  async run(ctx) {
    const lan = await startLanFixture(ROUTES);
    try {
      const worker = await ctx.cloudWorker();
      const boot = async (name: string): Promise<AppInstance> =>
        await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name });

      ctx.log("creating the account; A signs in, and the phone mirrors the library");
      await signUp(worker.origin);
      const a = await boot("a");
      await signInOwner(a, "A", "E2E Device A");
      await syncUntil(a.api, "A's first sync", "clean");
      const network = { online: true };
      const phone = await phoneRuntime(worker.origin, path.join(ctx.scratchDir, "phone"), network);
      await phone.start();
      await untilMirrored(phone, []);

      ctx.log("the phone saves a link, and A fills it on its own within the phone's minute");
      const filled = await phoneFillsWithinTheMinute(
        a,
        phone,
        lan.url("/file-over-app?utm_source=share"),
      );

      ctx.log("B signs in to the same library");
      const b = await boot("b");
      await signInOwner(b, "B", "E2E Device B");
      await syncUntil(b.api, "B's first sync", "clean");
      expectEq(await onMac(b, ITEM), filled, "the filled item on B");

      await twoMacsRace(ctx, lan, a, b, phone);
      await refreshRacesATag(ctx, a, b, phone, network, filled);
      await phoneDeletesAPicture(ctx, a, b, phone);
      await gitIn(a.vaultDir, ["fsck", "--strict"]);
    } finally {
      await lan.close();
    }
  },
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS + PHONE_FILL_DEADLINE_MS,
};
