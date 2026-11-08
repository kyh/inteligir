// the phone's own runtime against a booted Worker, from the account it makes to the sign-in it
// loses: each share made with no connection is kept on the phone before it is sent, waits there, is
// still waiting after a relaunch, and lands exactly once when the phone can reach its library
// again, where another device reads it. That device then ends the phone's sign-in, which the
// phone's next call hears, and signs itself out, which ends its session in the cloud.

import { SIGNED_OUT_ELSEWHERE } from "@repo/mobile/lib/compose-runtime";
import { expect, expectEq } from "../harness/assert";
import { OWNER } from "../harness/cloud-account";
import { E2E_INVITE_CODE, WORKER_SCENARIO_TIMEOUT_MS } from "../harness/cloud-worker";
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
const SIGNED_OUT_DEADLINE_MS = 10_000;

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

// until the phone has left its library, as the cloud's end of its sign-in leaves it
const untilSignedOut = async (phone: Phone, describe: string) =>
  await pollUntil(
    async () => await Promise.resolve(phone.runtime.session.get()),
    (session) => session.kind === "signed-out",
    { deadlineMs: SIGNED_OUT_DEADLINE_MS, describe: (session) => `${describe}: ${session.kind}` },
  );

export const phoneOfflineShare: Scenario = {
  description:
    "the phone's own runtime (`composeRuntime` under node) against a booted Worker: it makes the account with an invite code and a wrong password is refused; offline, a shared link and shared text are kept on the phone and wait; a relaunch still offline still holds both; back online, each lands exactly once and another device lists them; that device lists the phone and ends its sign-in, which the phone's next call hears, clearing what it held; and a sign-out ends the signed-out device's session in the cloud",
  name: "phone-offline-share",
  timeoutMs: WORKER_SCENARIO_TIMEOUT_MS,
  async run(ctx) {
    const site = await startPageFixture({ "/later": { body: page("Read later") } });
    try {
      const worker = await ctx.cloudWorker({ pages: site.pages });

      ctx.log("the phone makes the account with its invite code; a wrong password is refused");
      const phone = await phoneRuntime(worker.origin);
      await phone.runtime.login.signUp({
        ...OWNER,
        inviteCode: E2E_INVITE_CODE,
        name: "E2E Owner",
      });
      expectEq(phone.runtime.login.get(), { kind: "idle" }, "the phone's sign-up");
      const mac = await phoneRuntime(worker.origin);
      await mac.runtime.login.login({ email: OWNER.email, password: "not-the-password" });
      expectEq(
        mac.runtime.login.get(),
        { kind: "failed", message: "Check your email and password." },
        "a wrong password",
      );
      expectEq(mac.keychain.cookie, null, "a refused sign-in keeps no session");
      await mac.runtime.login.login(OWNER);
      expectEq(mac.runtime.login.get(), { kind: "idle" }, "another device's sign-in");
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
        keychain: phone.keychain,
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

      ctx.log("the Mac lists the phone and ends its sign-in; the phone's next call hears it");
      const { devices } = await libraryOf(mac).client.account.devices.list();
      const others = devices.filter(({ current }) => !current);
      expectEq(
        others.map(({ name }) => name),
        ["iPhone"],
        "the phone, as the Mac lists it",
      );
      await libraryOf(mac).client.account.devices.revoke({ id: others[0]?.id ?? "" });
      let answered = true;
      try {
        await libraryOf(relaunched).client.library.listing.titles();
      } catch {
        answered = false;
      }
      expect(!answered, "the phone's call after its sign-in ended is refused");
      expectEq(
        await untilSignedOut(relaunched, "the phone leaves its library"),
        { kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE },
        "the phone, once its sign-in ended",
      );
      expectEq(relaunched.keychain.cookie, null, "the phone keeps no session");
      expectEq([...relaunched.storage.held.keys()], [], "the phone keeps nothing of the library");

      ctx.log("the phone signs in again, and the Mac signs out, which ends its session");
      const again = await signedInPhone(worker.origin);
      const macSession = mac.keychain.cookie;
      expectEq(await mac.runtime.logout(), { kind: "signed-out" }, "the Mac's sign-out");
      expectEq(mac.keychain.cookie, null, "the Mac keeps no session");
      await pollUntil(
        async () => await libraryOf(again).client.account.devices.list(),
        ({ devices: left }) => left.length === 1,
        {
          deadlineMs: SIGNED_OUT_DEADLINE_MS,
          describe: ({ devices: left }) => `the account's devices: ${JSON.stringify(left)}`,
        },
      );
      const stale = await phoneRuntime(worker.origin, { keychain: { cookie: macSession } });
      expectEq(
        await untilSignedOut(stale, "a relaunch over the Mac's old session"),
        { kind: "signed-out", notice: SIGNED_OUT_ELSEWHERE },
        "the Mac's old session, which opens nothing",
      );
    } finally {
      await site.close();
    }
  },
};
