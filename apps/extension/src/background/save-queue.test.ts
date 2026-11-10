import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { Outcome } from "../messages";
import { COVER_DEADLINE_MS, COVER_TRIES } from "./capture-tab";
import { CALL_DEADLINE_MS } from "./cloud";
import type { Saved } from "./cloud";
import { keepConnection, readConnection } from "./connection";
import { saveTab } from "./save-page";
import { keepSave, queuedSaves, SEND_ALARM, sendQueued } from "./save-queue";
import type { QueuedSave, SendDeps } from "./save-queue";
import type { SignIn } from "./sign-in";
import {
  fakeCloud,
  OTHER_SESSION,
  refusal,
  savedAs,
  SESSION,
  SIGNED_IN,
  SIGNED_OUT,
} from "./test-support/fake-cloud";

const KEPT = { email: SESSION.email, origin: SESSION.origin };

beforeEach(async () => {
  fakeBrowser.reset();
  await keepConnection(KEPT);
});

const NOW = Date.UTC(2026, 10, 5, 12);
const SECOND = "01900000-0000-7000-8000-0000000000a2";
const THIRD = "01900000-0000-7000-8000-0000000000a3";

const waiting = (overrides: Partial<QueuedSave> = {}): QueuedSave => ({
  email: SESSION.email,
  firstTry: false,
  id: "01900000-0000-7000-8000-000000000001",
  opId: "01900000-0000-7000-8000-0000000000a1",
  savedAt: NOW - 1000,
  title: "File over app",
  url: "https://example.test/file-over-app",
  ...overrides,
});

const depsWith = (
  cloud: ReturnType<typeof fakeCloud>,
  signIn: SignIn | null = SIGNED_IN,
): SendDeps & { readonly asked: () => number } => {
  let asked = 0;
  return {
    asked: () => asked,
    cloud: () => cloud.cloud,
    now: () => NOW,
    signIn: async () => {
      asked += 1;
      return signIn;
    },
  };
};

// a tab saved as its link, the page unread, so its first try is the very call a resend makes
const saveTabAsLink = async (cloud: ReturnType<typeof fakeCloud>): Promise<Outcome> =>
  await saveTab(
    {
      capture: async () => null,
      cloud: () => cloud.cloud,
      fetchCover: async () => null,
      newBlockId: () => "block",
      now: () => NOW,
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
      signIn: async () => SIGNED_IN,
    },
    { tab: { id: 7, title: "File over app", url: "https://example.test/file-over-app" } },
  );

interface Row {
  readonly met: string;
  readonly answer: () => Promise<Saved>;
  // what the popup says of the first try
  readonly outcome: Outcome;
  // the save is kept to be sent again, and the account with it, and a pass goes on to the next
  readonly waits: boolean;
  readonly accountKept: boolean;
  readonly passGoesOn: boolean;
}

const waitingFor = (waitsFor: "connection" | "sign-in" | "update") =>
  ({ kind: "queued", waitsFor }) as const;
const refusedFor = (reason: Extract<Outcome, { kind: "refused" }>["reason"]) =>
  ({ kind: "refused", reason }) as const;

const ROWS: readonly Row[] = [
  {
    accountKept: true,
    answer: async () => savedAs("File over app"),
    met: "landed",
    outcome: { created: true, kind: "saved", title: "File over app" },
    passGoesOn: true,
    waits: false,
  },
  {
    accountKept: true,
    answer: refusal("UNAUTHORIZED"),
    met: "a session the cloud ended",
    outcome: waitingFor("sign-in"),
    passGoesOn: false,
    waits: true,
  },
  {
    // a first try met this way was let go, where a resend waited for the browser's update
    accountKept: true,
    answer: refusal("CLIENT_OUTDATED"),
    met: "a build the cloud calls too old",
    outcome: waitingFor("update"),
    passGoesOn: false,
    waits: true,
  },
  {
    accountKept: true,
    answer: refusal("TOO_MANY_REQUESTS"),
    met: "the cloud's budget for a minute",
    outcome: waitingFor("connection"),
    passGoesOn: false,
    waits: true,
  },
  {
    accountKept: true,
    answer: async () => {
      throw new TypeError("Failed to fetch");
    },
    met: "no connection",
    outcome: waitingFor("connection"),
    passGoesOn: false,
    waits: true,
  },
  {
    accountKept: true,
    answer: async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    },
    met: "the call's deadline",
    outcome: waitingFor("connection"),
    passGoesOn: false,
    waits: true,
  },
  {
    accountKept: true,
    answer: refusal("INTERNAL_SERVER_ERROR", false),
    met: "a fault of the cloud's own",
    outcome: waitingFor("connection"),
    passGoesOn: false,
    waits: true,
  },
  {
    accountKept: false,
    answer: refusal("GONE"),
    met: "the account deleted",
    outcome: refusedFor("not-connected"),
    passGoesOn: false,
    waits: false,
  },
  {
    accountKept: true,
    answer: refusal("QUOTA"),
    met: "a full library",
    outcome: refusedFor("library-full"),
    passGoesOn: true,
    waits: false,
  },
  {
    accountKept: true,
    answer: refusal("PAYLOAD_TOO_LARGE"),
    met: "a save past its cap",
    outcome: refusedFor("too-large"),
    passGoesOn: true,
    waits: false,
  },
  {
    accountKept: true,
    answer: refusal("BAD_REQUEST", false),
    met: "input the cloud refused",
    outcome: refusedFor("failed"),
    passGoesOn: true,
    waits: false,
  },
  {
    accountKept: true,
    answer: refusal("CONFLICT"),
    met: "another refusal of the call's own",
    outcome: refusedFor("failed"),
    passGoesOn: true,
    waits: false,
  },
];

describe("a save's try settles it one way, the first and every resend alike", () => {
  it.each(ROWS)("$met", async (row) => {
    const first = fakeCloud({ saveLink: row.answer });
    await expect(saveTabAsLink(first)).resolves.toStrictEqual(row.outcome);
    const afterFirst = await queuedSaves();
    expect(afterFirst.map((save) => save.firstTry)).toStrictEqual(row.waits ? [false] : []);
    await expect(readConnection()).resolves.toStrictEqual(row.accountKept ? KEPT : null);

    fakeBrowser.reset();
    await keepConnection(KEPT);
    await keepSave(waiting());
    await keepSave(waiting({ opId: SECOND, savedAt: NOW - 900 }));
    const resent = fakeCloud({ saveLink: row.answer });
    await sendQueued(depsWith(resent));
    expect(resent.links).toHaveLength(row.passGoesOn ? 2 : 1);
    await expect(queuedSaves()).resolves.toStrictEqual(
      row.waits ? [waiting(), waiting({ opId: SECOND, savedAt: NOW - 900 })] : [],
    );
    await expect(readConnection()).resolves.toStrictEqual(row.accountKept ? KEPT : null);
    const alarm = await browser.alarms.get(SEND_ALARM);
    expect(alarm !== undefined).toBe(row.waits);
  });
});

describe("a save that waits", () => {
  it("holds the alarm from the moment it is kept, so a first try whose worker stopped is sent", async () => {
    await keepSave(waiting({ firstTry: true }));
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toMatchObject({ periodInMinutes: 0.5 });
  });

  it("is sent as its link and goes, and the alarm with the last of them", async () => {
    await keepSave(waiting());
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud));
    expect(cloud.links).toStrictEqual([
      {
        id: waiting().id,
        opId: waiting().opId,
        savedAt: waiting().savedAt,
        title: "File over app",
        url: "https://example.test/file-over-app",
      },
    ]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeUndefined();
  });

  it("leaves a first try still under way alone for as long as that try can run", async () => {
    // every cover candidate fetched to its deadline, then the cover's put and the save to theirs
    const longestTry = COVER_TRIES * COVER_DEADLINE_MS + 2 * CALL_DEADLINE_MS;
    const cloud = fakeCloud({});
    for (const age of [5000, 61_000, longestTry]) {
      await keepSave(waiting({ firstTry: true, savedAt: NOW - age }));
      await sendQueued(depsWith(cloud));
      expect(cloud.links, `a first try ${String(age)} ms in`).toStrictEqual([]);
    }
    await expect(queuedSaves()).resolves.toHaveLength(1);
    // its worker was stopped mid-call: nothing will say how it went, so it goes again
    await keepSave(waiting({ firstTry: true, savedAt: NOW - 10 * 60_000 }));
    await sendQueued(depsWith(cloud));
    expect(cloud.links).toHaveLength(1);
  });

  it("is sent only under its own account's session", async () => {
    await keepSave(waiting({ email: OTHER_SESSION.email }));
    await keepSave(waiting({ opId: THIRD }));
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud));
    expect(cloud.links.map((link) => link.opId)).toStrictEqual([THIRD]);
    // the other account's save waits for that account to sign in here again
    await expect(queuedSaves()).resolves.toStrictEqual([waiting({ email: OTHER_SESSION.email })]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
    const other = fakeCloud({});
    await sendQueued(depsWith(other, { kind: "signed-in", session: OTHER_SESSION }));
    expect(other.links.map((link) => link.opId)).toStrictEqual([waiting().opId]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("is kept, unsent, while the browser is signed out or the cloud did not say who it is", async () => {
    await keepSave(waiting());
    const none: SignIn = { kind: "none" };
    for (const signIn of [SIGNED_OUT, none, null]) {
      const cloud = fakeCloud({});
      await sendQueued(depsWith(cloud, signIn));
      expect(cloud.links).toStrictEqual([]);
    }
    await expect(queuedSaves()).resolves.toStrictEqual([waiting()]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
  });

  it("asks nobody who is signed in while nothing waits", async () => {
    const deps = depsWith(fakeCloud({}));
    await sendQueued(deps);
    expect(deps.asked()).toBe(0);
  });

  it("lets go only what waited for the account the cloud deleted", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ email: OTHER_SESSION.email, opId: THIRD }));
    await sendQueued(depsWith(fakeCloud({ saveLink: refusal("GONE") })));
    await expect(readConnection()).resolves.toBeNull();
    await expect(queuedSaves()).resolves.toStrictEqual([
      waiting({ email: OTHER_SESSION.email, opId: THIRD }),
    ]);
  });

  it("keeps the account a sign-in as another replaced while the call was on its way", async () => {
    await keepSave(waiting());
    const replaced = { email: OTHER_SESSION.email, origin: OTHER_SESSION.origin };
    const cloud = fakeCloud({
      saveLink: async () => {
        await keepConnection(replaced);
        return await refusal("GONE")();
      },
    });
    await sendQueued(depsWith(cloud));
    await expect(readConnection()).resolves.toStrictEqual(replaced);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeUndefined();
  });

  it("drops a record that does not parse, rather than sending it", async () => {
    await browser.storage.local.set({ "save:broken": { url: 7 } });
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    // the store holds nothing under the key (WXT's fake answers it undefined, Chrome leaves it out)
    const held = await browser.storage.local.get("save:broken");
    expect(held["save:broken"]).toBeUndefined();
  });
});
