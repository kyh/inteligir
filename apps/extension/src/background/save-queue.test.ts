import { deferred } from "@repo/contract/deferred";
import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { Outcome } from "../messages";
import type { Saved } from "./cloud";
import { keepConnection, readConnection } from "./connection";
import { saveTab } from "./save-page";
import { keepSave, queuedSaves, SEND_ALARM, sendQueued } from "./save-queue";
import type { QueuedSave, SendDeps } from "./save-queue";
import type { SignIn } from "./sign-in";
import {
  fakeCloud,
  KEPT,
  keptAs,
  OTHER_SESSION,
  refusal,
  savedAs,
  SESSION,
  SIGNED_IN,
  SIGNED_OUT,
} from "./test-support/fake-cloud";

beforeEach(async () => {
  fakeBrowser.reset();
  await keepConnection(KEPT);
});

const alarmStands = async (): Promise<boolean> => {
  const alarm = await browser.alarms.get(SEND_ALARM);
  return alarm !== undefined;
};

const NOW = Date.UTC(2026, 10, 5, 12);
const SECOND = "01900000-0000-7000-8000-0000000000a2";
const THIRD = "01900000-0000-7000-8000-0000000000a3";

const waiting = (overrides: Partial<QueuedSave> = {}): QueuedSave => ({
  email: SESSION.email,
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
    await expect(queuedSaves()).resolves.toHaveLength(row.waits ? 1 : 0);
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
    // the alarm stands for a call the cloud did not answer, never for a person a save waits on
    await expect(alarmStands()).resolves.toBe(
      row.outcome.kind === "queued" && row.outcome.waitsFor === "connection",
    );
  });
});

describe("a save that waits", () => {
  it("is sent as its link and goes, and the alarm with the last of them", async () => {
    await keepSave(waiting());
    await browser.alarms.create(SEND_ALARM, { periodInMinutes: 0.5 });
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
    await expect(alarmStands()).resolves.toBe(false);
  });

  it("is sent only under its own account's session", async () => {
    await keepSave(waiting({ email: OTHER_SESSION.email }));
    await keepSave(waiting({ opId: THIRD }));
    await browser.alarms.create(SEND_ALARM, { periodInMinutes: 0.5 });
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud));
    expect(cloud.links.map((link) => link.opId)).toStrictEqual([THIRD]);
    // the other account's save waits for that account to sign in here again, which no timer brings
    await expect(queuedSaves()).resolves.toStrictEqual([waiting({ email: OTHER_SESSION.email })]);
    await expect(alarmStands()).resolves.toBe(false);
    const other = fakeCloud({});
    await sendQueued(depsWith(other, { kind: "signed-in", session: OTHER_SESSION }));
    expect(other.links.map((link) => link.opId)).toStrictEqual([waiting().opId]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("is kept, unsent, while the browser is signed out or the cloud did not say who it is, which alone the alarm asks again", async () => {
    await keepSave(waiting());
    const none: SignIn = { kind: "none" };
    for (const [signIn, asksAgain] of [
      [null, true],
      [SIGNED_OUT, false],
      [none, false],
    ] as const) {
      const cloud = fakeCloud({});
      await sendQueued(depsWith(cloud, signIn));
      expect(cloud.links).toStrictEqual([]);
      await expect(alarmStands(), signIn?.kind).resolves.toBe(asksAgain);
    }
    await expect(queuedSaves()).resolves.toStrictEqual([waiting()]);
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
    const replaced = keptAs(OTHER_SESSION.email, OTHER_SESSION.bearer);
    const cloud = fakeCloud({
      saveLink: async () => {
        await keepConnection(replaced);
        return await refusal("GONE")();
      },
    });
    await sendQueued(depsWith(cloud));
    await expect(readConnection()).resolves.toStrictEqual(replaced);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    await expect(alarmStands()).resolves.toBe(false);
  });

  it("drops a record that does not parse, rather than sending it", async () => {
    await browser.storage.local.set({ "save:broken": { url: 7 } });
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    // the store holds nothing under the key (WXT's fake answers it undefined, Chrome leaves it out)
    const held = await browser.storage.local.get("save:broken");
    expect(held["save:broken"]).toBeUndefined();
  });
});

describe("the queue's passes", () => {
  it("run one at a time, so four asks at once send each save once", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ opId: SECOND, savedAt: NOW - 900 }));
    const held = deferred();
    const cloud = fakeCloud({
      saveLink: async () => {
        await held.promise;
        return savedAs("File over app");
      },
    });
    const deps = depsWith(cloud);
    const asks = [sendQueued(deps), sendQueued(deps), sendQueued(deps), sendQueued(deps)];
    held.resolve();
    await Promise.all(asks);
    expect(cloud.links.map((link) => link.opId)).toStrictEqual([waiting().opId, SECOND]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("run exactly one more pass for every ask made while one ran, which sends a save kept meanwhile", async () => {
    await keepSave(waiting());
    const held = deferred();
    const cloud = fakeCloud({
      saveLink: async () => {
        await held.promise;
        return savedAs("File over app");
      },
    });
    const deps = depsWith(cloud);
    const firstAsk = sendQueued(deps);
    await expect.poll(() => cloud.links.length).toBe(1);
    await keepSave(waiting({ opId: SECOND, savedAt: NOW - 900 }));
    const laterAsks = [sendQueued(deps), sendQueued(deps)];
    held.resolve();
    await Promise.all([firstAsk, ...laterAsks]);
    expect(cloud.links.map((link) => link.opId)).toStrictEqual([waiting().opId, SECOND]);
    expect(deps.asked()).toBe(2);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("leave a save to its first try while that try runs, however long, and send it once the try went unanswered", async () => {
    const held = deferred();
    const firstTry = fakeCloud({
      saveLink: async () => {
        await held.promise;
        throw new TypeError("Failed to fetch");
      },
    });
    const saving = saveTabAsLink(firstTry);
    await expect.poll(() => firstTry.links.length).toBe(1);
    const resent = fakeCloud({});
    await sendQueued(depsWith(resent));
    expect(resent.links).toStrictEqual([]);
    await expect(queuedSaves()).resolves.toHaveLength(1);
    // the worker may stop before the try answers, so the alarm stays through the pass
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toMatchObject({ periodInMinutes: 0.5 });
    held.resolve();
    await expect(saving).resolves.toStrictEqual(waitingFor("connection"));
    await sendQueued(depsWith(resent));
    expect(resent.links.map((link) => link.opId)).toStrictEqual(
      firstTry.links.map((link) => link.opId),
    );
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    await expect(alarmStands()).resolves.toBe(false);
  });

  it("keep the alarm for a first try the cloud left unanswered while a pass ran, which that pass never read", async () => {
    await keepSave(waiting());
    const held = deferred();
    const answering = fakeCloud({
      saveLink: async () => {
        await held.promise;
        return savedAs("File over app");
      },
    });
    const passing = sendQueued(depsWith(answering));
    await expect.poll(() => answering.links.length).toBe(1);
    const unanswering = fakeCloud({
      saveLink: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(saveTabAsLink(unanswering)).resolves.toStrictEqual(waitingFor("connection"));
    held.resolve();
    await passing;
    await expect(queuedSaves()).resolves.toHaveLength(1);
    await expect(alarmStands()).resolves.toBe(true);
  });

  it("never bring back a save its account's deletion let go while its first try ran", async () => {
    await keepSave(waiting());
    const held = deferred();
    const firstTry = fakeCloud({
      saveLink: async () => {
        await held.promise;
        throw new TypeError("Failed to fetch");
      },
    });
    const saving = saveTabAsLink(firstTry);
    await expect.poll(() => firstTry.links.length).toBe(1);
    await sendQueued(depsWith(fakeCloud({ saveLink: refusal("GONE") })));
    held.resolve();
    await expect(saving).resolves.toStrictEqual(waitingFor("connection"));
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("send a save whose worker stopped mid-try, which holds nothing of the try", async () => {
    // what a stopped worker leaves: the save as it was kept before its first call
    await keepSave(waiting());
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud));
    expect(cloud.links.map((link) => link.opId)).toStrictEqual([waiting().opId]);
  });
});
