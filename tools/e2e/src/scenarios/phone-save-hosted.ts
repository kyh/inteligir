import { readFile } from "node:fs/promises";
import path from "node:path";
import { libraryCards } from "@repo/mobile/library/library-view";
import type { LibraryCard } from "@repo/mobile/library/library-view";
import type { AppRuntime } from "@repo/mobile/lib/compose-runtime";
import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { gitIn } from "../harness/exec";
import { hostedVaultEnv, signInOwner, syncUntil } from "../harness/hosted-vault";
import { drained, phoneRuntime, readPhoneNote, untilMirrored } from "../harness/phone-runtime";
import { pollUntil } from "../harness/poll";
import { reserveFreePorts } from "../harness/ports";
import type { Scenario } from "../harness/scenario";

const TITLE = "File over app";
const ITEM = `Unsorted/${TITLE}.md`;
const COVER_NAME = "3f9a0c2b1d4e5f60.jpg";
const COVER = `assets/covers/${COVER_NAME}`;
const ARTICLE =
  "If you want to create digital artifacts that last, they must be files you can control.";
const CARD_DEADLINE_MS = 20_000;

// a JPEG's own start and end around a cover's worth of bytes: what crosses is what lands
const coverBytes = (): Uint8Array =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...Array.from({ length: 4096 }, (_, i) => i % 251),
    0xff,
    0xd9,
  ]);

const cardAt = (phone: AppRuntime, wanted: string): LibraryCard | undefined =>
  libraryCards(phone.notes.heldFiles(), {
    kinds: new Set(),
    query: "",
    scope: { kind: "all" },
  }).find((card) => card.path === wanted);

// the stub's frontmatter, key by key, as the phone wrote it: one plain value per line
const keysOf = (text: string): Map<string, string> => {
  const block = /^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(text)?.groups?.["yaml"] ?? "";
  return new Map(
    block.split("\n").flatMap((line): [string, string][] => {
      const at = line.indexOf(": ");
      return at === -1 ? [] : [[line.slice(0, at), line.slice(at + 2)]];
    }),
  );
};

// the bytes a Mac's first fill of the stub writes: its facts in their places, the cover, then
// the article
const fillOf = (stub: string): string => {
  const lines = stub.split("\n");
  const after = (key: string, added: readonly string[]): void => {
    const at = lines.findIndex((line) => line.startsWith(`${key}: `));
    expect(at !== -1, `the stub holds ${key}: ${stub}`);
    lines.splice(at + 1, 0, ...added);
  };
  after("url", ["site: Steph Ango"]);
  after("saved", [
    "fetched: 2026-10-17T09:12:33Z",
    "description: Files you can control, in formats that are easy to retrieve and read.",
  ]);
  return `${lines.join("\n")}\n![](${COVER})\n\n${ARTICLE}\n`;
};

export const phoneSaveHosted: Scenario = {
  description:
    "an offline phone save of a link is a pending card with one outbox row, lands as a stub on the hosted head once online, shows the Mac's fill with its site and cover, and a second save answers already saved",
  name: "phone-save-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    // a port nothing listens on, which the guarded fetch refuses before it dials: the scenario
    // writes each Mac's fill itself, so whatever a Mac's own fill of the phone's stub makes of
    // it, no page is read and the run is the same on every machine (§0.2.9)
    const [closed = 0] = await reserveFreePorts(1);
    const pageUrl = (at: string): string => `http://127.0.0.1:${String(closed)}${at}`;
    const worker = await ctx.cloudWorker();

    ctx.log("creating the account; A signs in and pushes its library");
    await signUp(worker.origin);
    const a = await ctx.boot({ extraEnv: hostedVaultEnv(worker.origin), name: "a" });
    await signInOwner(a, "A", "E2E Device A");
    await syncUntil(a.api, "A's first sync", "clean");

    ctx.log("the phone mirrors the library, then saves a link while offline");
    const network = { online: true };
    const phone = await phoneRuntime(worker.origin, path.join(ctx.scratchDir, "phone"), network);
    await phone.start();
    await untilMirrored(phone, []);
    network.online = false;
    const shared = pageUrl("/file-over-app?utm_source=share&utm_medium=ios");
    const saved = await phone.items.saveLink({ note: null, title: TITLE, url: shared });
    expectEq(saved, { kind: "saved", path: ITEM }, "the phone's offline save");
    expectEq(phone.notes.outbox.status.get().unsent, 1, "the phone's unsent changes offline");
    const pending = cardAt(phone, ITEM);
    expect(
      pending?.pending === true && pending.kind === "link" && pending.cover === null,
      `the phone's card before any Mac read the page: ${JSON.stringify(pending)}`,
    );

    ctx.log("online, the stub lands on the hosted head, and A pulls it");
    network.online = true;
    await drained(phone, "after the phone's save");
    await syncUntil(a.api, "A pulling the phone's save", "clean");
    const stub = await readFile(path.join(a.vaultDir, ITEM), "utf-8");
    expectEq(await readPhoneNote(phone, ITEM), stub, "the stub's bytes, phone and hosted head");
    const keys = keysOf(stub);
    expectEq(
      [...keys.keys()],
      ["id", "kind", "url", "saved"],
      `the stub's keys, in the order every writer puts them: ${stub}`,
    );
    expect(
      keys.get("kind") === "link" &&
        keys.get("url") === pageUrl("/file-over-app") &&
        stub.endsWith("---\n"),
      `the stub on A, its tracking cut and no body: ${stub}`,
    );
    const tracked = await gitIn(a.vaultDir, ["ls-files", "Unsorted"]);
    expect(tracked.includes(`${TITLE}.md`), "A tracks the stub under its shared title in Unsorted");

    ctx.log("A writes what its fill writes: the cover, the facts and the article");
    const cover = await a.api.vault.assetWrite({
      baseName: COVER_NAME,
      dir: "assets/covers",
      file: new Blob([coverBytes()]),
    });
    expectEq(cover.path, COVER, "the cover's content-addressed path");
    await a.api.vault.write({ content: fillOf(stub), guard: { kind: "overwrite" }, path: ITEM });
    await syncUntil(a.api, "A after its fill", "clean");

    ctx.log("the phone's card shows the site and the cover, which it can open");
    const card = await pollUntil(
      async () => {
        await phone.notes.refresh();
        return cardAt(phone, ITEM);
      },
      (seen) => seen?.pending === false,
      {
        deadlineMs: CARD_DEADLINE_MS,
        describe: (seen) => `the phone's card is still ${JSON.stringify(seen)}`,
      },
    );
    expectEq(
      { cover: card?.cover, site: card?.site },
      { cover: COVER, site: "Steph Ango" },
      "the phone's filled card",
    );
    const held = await phone.notes.attachmentFile(COVER);
    expect(held.ok, `the phone holds the cover: ${held.ok ? "" : held.message}`);

    ctx.log("saving the same link again answers where it already is");
    expectEq(
      await phone.items.saveLink({
        note: null,
        title: "Again",
        url: pageUrl("/file-over-app?fbclid=again#top"),
      }),
      { kind: "already", path: ITEM },
      "the second save",
    );
    expectEq(phone.notes.outbox.status.get().unsent, 0, "the phone queued nothing for it");
  },
};
