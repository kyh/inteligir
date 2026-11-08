// the phone's share sheet with no connection, against a booted Worker: each share is kept on the
// phone before it is sent, waits there, is still waiting after a relaunch, and lands exactly once
// when the phone can reach its library again, where another device reads it.

import { expectEq } from "../harness/assert";
import { signUp } from "../harness/cloud-account";
import { WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
import { startPageFixture } from "../harness/page-fixture";
import {
  libraryOf,
  phoneRuntime,
  shareFromPhone,
  signedInPhone,
  untilItem,
} from "../harness/phone-runtime";
import type { Phone } from "../harness/phone-runtime";
import { pollUntil } from "../harness/poll";
import type { Scenario } from "../harness/scenario";

const LANDED_DEADLINE_MS = 20_000;

const page = (title: string): string =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Saved from the phone's share sheet while it had no connection.</p></article></body></html>`;

// every item the account holds, as another device lists it
const listed = async (device: Phone) => {
  const { items } = await libraryOf(device).client.library.listing.page({
    limit: 100,
    query: { deleted: false, sort: "saved" },
  });
  return items;
};

export const phoneOfflineShare: Scenario = {
  description:
    "the phone's own runtime (`composeRuntime` under node) against a booted Worker: offline, a shared link and shared text are kept on the phone and wait; a relaunch still offline still holds both; back online, each lands exactly once and another device lists them",
  name: "phone-offline-share",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const site = await startPageFixture({ "/later": { body: page("Read later") } });
    try {
      const worker = await ctx.cloudWorker({ pages: site.pages });
      await signUp(worker.origin);
      const phone = await signedInPhone(worker.origin);
      const mac = await signedInPhone(worker.origin, "E2E Mac");
      const url = site.publicUrl("/later");

      ctx.log("offline, a shared link and shared text are kept and wait");
      phone.network.online = false;
      expectEq(
        await shareFromPhone(phone, { kind: "link", note: "For Tuesday.", title: null, url }),
        { kind: "waiting" },
        "the offline link share",
      );
      expectEq(
        await shareFromPhone(phone, { kind: "text", text: "Call the printer\n\nabout the proofs" }),
        { kind: "waiting" },
        "the offline text share",
      );
      expectEq(libraryOf(phone).shares.waiting.get().length, 2, "two saves waiting");
      expectEq(await listed(mac), [], "nothing reached the library");

      ctx.log("a relaunch, still offline, still holds both");
      const relaunched = await phoneRuntime(worker.origin, {
        kept: phone.kept(),
        network: phone.network,
        storage: phone.storage,
      });
      const { shares } = libraryOf(relaunched);
      expectEq(
        shares.waiting
          .get()
          .map(({ save }) => save.kind)
          .toSorted(),
        ["link", "text"],
        "the relaunched phone's saves waiting",
      );

      ctx.log("back online, each share lands once, and the Mac lists both");
      relaunched.network.online = true;
      relaunched.runtime.resume();
      await pollUntil(
        async () => await Promise.resolve(shares.waiting.get()),
        (waiting) => waiting.length === 0,
        {
          deadlineMs: LANDED_DEADLINE_MS,
          describe: (waiting) => `the saves still waiting: ${JSON.stringify(waiting)}`,
        },
      );
      await shares.flush();
      const items = await listed(mac);
      expectEq(
        items.map(({ fields }) => fields.url ?? fields.title).toSorted(),
        ["Call the printer", url],
        "each share landed once",
      );
      const link = items.find((item) => item.fields.url === url);
      const read = await untilItem(
        mac,
        link?.id ?? "",
        (item) => item?.fields.fetchState === "filled",
        "the cloud reads the shared page",
      );
      expectEq(read?.fields.title, "Read later", "the shared page names it");
    } finally {
      await site.close();
    }
  },
};
