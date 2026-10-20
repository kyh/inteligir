import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppInstance } from "../harness/instance";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { gitIn } from "../harness/exec";
import { conflictCopies, hostedVaultEnv, signInOwner, syncUntil } from "../harness/hosted-vault";
import { drained, phoneRuntime, readPhoneNote, untilMirrored } from "../harness/phone-runtime";
import { reserveFreePorts } from "../harness/ports";
import type { Scenario } from "../harness/scenario";

const TITLE = "File over app";
const ITEM = `Unsorted/${TITLE}.md`;
const ARTICLE =
  "If you want to create digital artifacts that last, they must be files you can control.";
const NOTE = "For Tuesday.";

// a JPEG's own start and end around bytes of its own, so each Mac's cover is a file of its own
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

// the bytes one Mac's fill of the stub writes: its facts in their places, its cover, the article
const fillOf = (stub: string, fetched: string, cover: string): string => {
  const lines = stub.split("\n");
  const after = (key: string, added: readonly string[]): void => {
    const at = lines.findIndex((line) => line.startsWith(`${key}: `));
    expect(at !== -1, `the stub holds ${key}: ${stub}`);
    lines.splice(at + 1, 0, ...added);
  };
  after("url", ["site: Steph Ango"]);
  after("saved", [`fetched: ${fetched}`]);
  return `${lines.join("\n")}\n![](${cover})\n\n${ARTICLE}\n`;
};

// what a Mac's fill writes: the cover first, then the item over the stub it read
const fillOn = async (mac: AppInstance, stub: string, fetched: string, seed: number) => {
  const cover = await mac.api.vault.assetWrite({
    baseName: `cover-${String(seed)}.jpg`,
    dir: "assets/covers",
    file: new Blob([coverBytes(seed)]),
  });
  const filled = fillOf(stub, fetched, cover.path);
  await mac.api.vault.write({ content: filled, guard: { kind: "overwrite" }, path: ITEM });
  return { cover: cover.path, filled };
};

export const phoneFillRaceHosted: Scenario = {
  description:
    "two Macs filling one phone stub end byte-identical with the hosted head and no conflict copy, carrying a phone's offline tag and note",
  name: "phone-fill-race-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    // a port nothing listens on, which the guarded fetch refuses before it dials: the scenario
    // writes each Mac's fill itself, so whatever a Mac's own fill of the phone's stub makes of
    // it, no page is read and the run is the same on every machine (§0.2.9)
    const [closed = 0] = await reserveFreePorts(1);
    const pageUrl = (at: string): string => `http://127.0.0.1:${String(closed)}${at}`;
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

    ctx.log("the phone saves a link, and both Macs pull the stub");
    const network = { online: true };
    const phone = await phoneRuntime(worker.origin, path.join(ctx.scratchDir, "phone"), network);
    await phone.start();
    await untilMirrored(phone, []);
    const saved = await phone.items.saveLink({
      note: null,
      title: TITLE,
      url: pageUrl("/file-over-app?utm_source=share"),
    });
    expectEq(saved, { kind: "saved", path: ITEM }, "the phone's save");
    await drained(phone, "after the phone's save");
    const stub = await readPhoneNote(phone, ITEM);
    for (const [mac, label] of [
      [a, "A"],
      [b, "B"],
    ] as const) {
      await syncUntil(mac.api, `${label} pulling the stub`, "clean");
      expectEq(
        await readFile(path.join(mac.vaultDir, ITEM), "utf-8"),
        stub,
        `the stub on ${label}`,
      );
    }

    ctx.log("offline, the phone tags the stub and writes a note on it");
    network.online = false;
    const edited = `${stub.replace("\n---\n", "\ntags:\n  - read\n---\n\n")}${NOTE}\n`;
    const written = await phone.notes.write(ITEM, edited, { base: stub, kind: "expected" });
    expectEq(written, { kind: "written" }, "the phone's offline edit");

    ctx.log("both Macs fill the stub, A a few seconds before B, and A pushes first");
    const early = await fillOn(a, stub, "2026-10-17T09:12:33Z", 3);
    const late = await fillOn(b, stub, "2026-10-17T09:12:41Z", 7);
    expect(early.cover !== late.cover, "each Mac wrote a cover of its own");
    await syncUntil(a.api, "A pushing its fill", "clean");
    await syncUntil(b.api, "B meeting A's fill", "clean");
    await syncUntil(a.api, "A taking B's merge", "clean");
    const settledFill = await readFile(path.join(b.vaultDir, ITEM), "utf-8");
    expectEq(settledFill, early.filled, "the earlier fill wins on B, as on every device");

    ctx.log("the phone reconnects; its edit meets the fill and keeps both");
    network.online = true;
    await drained(phone, "after reconnecting");
    for (const [mac, label] of [
      [a, "A"],
      [b, "B"],
    ] as const) {
      await syncUntil(mac.api, `${label} pulling the phone's edit`, "clean");
    }
    const onPhone = await readPhoneNote(phone, ITEM);
    const onA = await readFile(path.join(a.vaultDir, ITEM), "utf-8");
    const onB = await readFile(path.join(b.vaultDir, ITEM), "utf-8");
    expectEq(onA, onPhone, "A and the hosted head");
    expectEq(onB, onPhone, "B and the hosted head");
    expect(
      onPhone.includes("fetched: 2026-10-17T09:12:33Z\n") &&
        onPhone.includes(`![](${early.cover})`) &&
        onPhone.includes("tags:\n  - read\n") &&
        onPhone.includes(`![](${early.cover})\n\n${NOTE}\n\n${ARTICLE}\n`),
      `the settled item carries the earlier fill, the phone's tag, and its note after the cover: ${onPhone}`,
    );
    expectEq(
      await gitIn(a.vaultDir, ["rev-parse", "HEAD^{tree}"]),
      await gitIn(b.vaultDir, ["rev-parse", "HEAD^{tree}"]),
      "A's tree and B's",
    );
    for (const [mac, label] of [
      [a, "A"],
      [b, "B"],
    ] as const) {
      expectEq(await conflictCopies(mac), "", `${label}'s conflict copies`);
      const status = await mac.api.vault.status();
      expectEq(status.conflicts.length, 0, `${label}'s reported conflicts`);
    }
    expectEq(phone.notes.outbox.status.get().conflicts.length, 0, "the phone's conflicts");
    await gitIn(a.vaultDir, ["fsck", "--strict"]);
  },
};
