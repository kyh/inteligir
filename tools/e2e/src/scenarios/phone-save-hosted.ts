// the phone's share sheet against a booted Worker: a shared link is saved as its link at once, and
// the Worker's fill reads the page, its facts, its article and its cover, which another device
// reads; a second share of the same page answers the item that holds it. A share made offline is
// `./phone-offline-share.ts`'s. The pages are served under the public name the fill reads
// (`../harness/page-fixture.ts`), so the run is the same on every machine.

import { expect, expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { startPageFixture } from "../harness/page-fixture";
import { libraryOf, shareFromPhone, signedInPhone, untilItem } from "../harness/phone-runtime";
import type { Scenario } from "../harness/scenario";

const TITLE = "File over app";
const SITE = "Steph Ango";
const DESCRIPTION = "Files you can control, in formats that are easy to retrieve and read.";
const ARTICLE =
  "If you want to create digital artifacts that last, they must be files you can control.";

// a JPEG's own start, a frame header naming 640 × 400 pixels (the fill keeps no picture whose
// header names no size) and its end, around a cover's worth of bytes: what the fill fetched is what
// lands
const coverBytes = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    0x01,
    0x90,
    0x02,
    0x80,
    0x03,
    ...Array.from({ length: 4096 }, (_, i) => i % 251),
    0xff,
    0xd9,
  ]);

const pageTitled = (title: string): string =>
  [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${title}</title>`,
    `<meta property="og:site_name" content="${SITE}">`,
    `<meta name="description" content="${DESCRIPTION}">`,
    '<meta property="og:image" content="/cover.jpg">',
    "</head><body><article>",
    `<h1>${title}</h1>`,
    `<p>${ARTICLE}</p>`,
    "<p>Apps are ephemeral, and the files they write outlast every one of them.</p>",
    "</article></body></html>",
  ].join("\n");

const landedOf = (shared: Awaited<ReturnType<typeof shareFromPhone>>): string => {
  expect(shared.kind === "landed", `the share landed: ${JSON.stringify(shared)}`);
  return shared.itemId;
};

export const phoneSaveHosted: Scenario = {
  description:
    "the phone's share sheet against a booted Worker: a shared link is saved as its link, and the Worker's fill reads it, facts, article and cover, which another device reads; a second share of the same page answers its item",
  name: "phone-save-hosted",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const site = await startPageFixture({
      "/cover.jpg": { body: coverBytes(), type: "image/jpeg" },
      "/file-over-app": { body: pageTitled(TITLE) },
    });
    try {
      const worker = await ctx.cloudWorker({ pages: site.pages });
      await signUp(worker.origin);
      const phone = await signedInPhone(worker.origin);
      const mac = await signedInPhone(worker.origin);

      ctx.log("a shared page is saved unread, and the cloud reads it");
      const shared = landedOf(
        await shareFromPhone(phone, {
          kind: "link",
          note: null,
          title: null,
          url: site.publicUrl("/file-over-app"),
        }),
      );

      ctx.log("the Mac reads the item as the cloud read it, its cover with it");
      const item = await untilItem(
        mac,
        shared,
        (held) => held?.fields.fetchState === "filled",
        "the Mac reads the read page",
      );
      expectEq(item?.fields.title, TITLE, "the page's title");
      expectEq(item?.fields.site, SITE, "the page's site");
      expectEq(item?.fields.description, DESCRIPTION, "the page's description");
      expect(
        item?.blocks.some(
          ({ block, section }) => section === "article" && JSON.stringify(block).includes(ARTICLE),
        ) === true,
        "the article landed in the article section",
      );
      const cover = item.fields.coverSha ?? null;
      expect(cover !== null, "the page's cover landed with it");
      const uri = await libraryOf(mac).files.fileUri(cover);
      expect(uri !== null, "the Mac draws the cover from the cloud");

      ctx.log("sharing the same page again answers the item that holds it");
      const again = landedOf(
        await shareFromPhone(phone, {
          kind: "link",
          note: null,
          title: "Again",
          url: site.publicUrl("/file-over-app?fbclid=again#top"),
        }),
      );
      expectEq(again, shared, "the second share");
      const { targets } = await libraryOf(mac).client.library.listing.titles();
      expectEq(
        targets.filter((target) => target.title === TITLE).length,
        1,
        "one item for the page",
      );
    } finally {
      await site.close();
    }
  },
};
