import { deferred } from "@repo/contract/deferred";
import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { Outcome, OutcomeReason } from "../messages";
import type { Saved } from "./cloud";
import { keepConnection, readConnection } from "./connection";
import { saveTab } from "./save-page";
import { keepSave, queuedSaves, refusedSaves, SEND_ALARM, sendQueued } from "./save-queue";
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
const FIRST = "01900000-0000-7000-8000-0000000000a1";
const SECOND = "01900000-0000-7000-8000-0000000000a2";
const THIRD = "01900000-0000-7000-8000-0000000000a3";

// a save as the queue keeps it, each op id a moment after the one before it
const waiting = ({
  email = SESSION.email,
  opId = FIRST,
  refused = null,
  title = "File over app",
}: {
  email?: string;
  opId?: string;
  refused?: string | null;
  title?: string;
} = {}): QueuedSave => ({
  id: "01900000-0000-7000-8000-000000000001",
  opId,
  payload: { email, title, url: "https://example.test/file-over-app" },
  refused,
  savedAt: NOW - 1000 + [FIRST, SECOND, THIRD].indexOf(opId) * 100,
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
  // how the save is kept after the try: to be sent again, parked with the library's words, or not
  readonly kept: { readonly refused: string | null } | null;
  readonly accountKept: boolean;
  readonly passGoesOn: boolean;
}

const waitingFor = (waitsFor: "connection" | "sign-in" | "update") =>
  ({ kind: "queued", waitsFor }) as const;
const refusedFor = (reason: OutcomeReason) => ({ kind: "refused", reason }) as const;
const refusedByLibrary = (message: string) =>
  ({ kind: "refused", message, reason: "library" }) as const;

const WAITS = { refused: null };
const CHANGE_REFUSED = "Your library couldn't take this change.";

const ROWS: readonly Row[] = [
  {
    accountKept: true,
    answer: async () => savedAs("File over app"),
    kept: null,
    met: "landed",
    outcome: { created: true, kind: "saved", title: "File over app" },
    passGoesOn: true,
  },
  {
    accountKept: true,
    answer: refusal("UNAUTHORIZED"),
    kept: WAITS,
    met: "a session the cloud ended",
    outcome: waitingFor("sign-in"),
    passGoesOn: false,
  },
  {
    accountKept: true,
    answer: refusal("CLIENT_OUTDATED"),
    kept: WAITS,
    met: "a build the cloud calls too old",
    outcome: waitingFor("update"),
    passGoesOn: false,
  },
  {
    accountKept: true,
    answer: refusal("TOO_MANY_REQUESTS"),
    kept: WAITS,
    met: "the cloud's budget for a minute",
    outcome: waitingFor("connection"),
    passGoesOn: false,
  },
  {
    accountKept: true,
    answer: async () => {
      throw new TypeError("Failed to fetch");
    },
    kept: WAITS,
    met: "no connection",
    outcome: waitingFor("connection"),
    passGoesOn: false,
  },
  {
    accountKept: true,
    answer: async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    },
    kept: WAITS,
    met: "the call's deadline",
    outcome: waitingFor("connection"),
    passGoesOn: false,
  },
  {
    accountKept: true,
    answer: refusal("INTERNAL_SERVER_ERROR", false),
    kept: WAITS,
    met: "a fault of the cloud's own",
    outcome: waitingFor("connection"),
    passGoesOn: false,
  },
  {
    accountKept: false,
    answer: refusal("GONE"),
    kept: null,
    met: "the account deleted",
    outcome: refusedFor("not-connected"),
    passGoesOn: false,
  },
  {
    accountKept: true,
    answer: refusal("QUOTA"),
    kept: { refused: "QUOTA" },
    met: "a full library",
    outcome: refusedByLibrary("QUOTA"),
    passGoesOn: true,
  },
  {
    accountKept: true,
    answer: refusal("BAD_REQUEST", false),
    kept: { refused: CHANGE_REFUSED },
    met: "input the cloud refused",
    outcome: refusedByLibrary(CHANGE_REFUSED),
    passGoesOn: true,
  },
];

describe("a save's try settles it one way, the first and every resend alike", () => {
  it.each(ROWS)("$met", async (row) => {
    const first = fakeCloud({ saveLink: row.answer });
    await expect(saveTabAsLink(first)).resolves.toStrictEqual(row.outcome);
    await expect(queuedSaves()).resolves.toMatchObject(row.kept === null ? [] : [row.kept]);
    await expect(readConnection()).resolves.toStrictEqual(row.accountKept ? KEPT : null);

    fakeBrowser.reset();
    await keepConnection(KEPT);
    await keepSave(waiting());
    await keepSave(waiting({ opId: SECOND }));
    const resent = fakeCloud({ saveLink: row.answer });
    await sendQueued(depsWith(resent));
    expect(resent.links).toHaveLength(row.passGoesOn ? 2 : 1);
    await expect(queuedSaves()).resolves.toStrictEqual(
      row.kept === null ? [] : [waiting(row.kept), waiting({ ...row.kept, opId: SECOND })],
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

  it("is sent with the empty title of a tab that gave none, a link with no name yet", async () => {
    await keepSave(waiting({ title: "" }));
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud));
    expect(cloud.links).toMatchObject([{ title: "", url: "https://example.test/file-over-app" }]);
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

  it("is kept in `storage.local` under one key, as the text the queue reads", async () => {
    await keepSave(waiting());
    const stored = await browser.storage.local.get(`save:${FIRST}`);
    expect(JSON.parse(String(stored[`save:${FIRST}`]))).toStrictEqual(waiting());
  });
});

describe("a save the library refused", () => {
  const FULL = "Your library is full.";
  const full = async (): Promise<never> => await refusal("QUOTA", true, FULL)();

  it("waits with the library's words for its own account's popup, and no pass sends it again", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ email: OTHER_SESSION.email, opId: SECOND }));
    await sendQueued(depsWith(fakeCloud({ saveLink: full })));
    await sendQueued(
      depsWith(fakeCloud({ saveLink: full }), { kind: "signed-in", session: OTHER_SESSION }),
    );

    await expect(refusedSaves(SESSION.email)).resolves.toStrictEqual([
      { message: FULL, name: "File over app", opId: FIRST },
    ]);
    const later = fakeCloud({});
    await sendQueued(depsWith(later));
    expect(later.links).toStrictEqual([]);
    // it waits on a person, so no alarm wakes the worker for it
    await expect(alarmStands()).resolves.toBe(false);
  });

  it("is named by its address where no title was read", async () => {
    const untitled = waiting();
    await keepSave({ ...untitled, payload: { ...untitled.payload, title: "" } });
    await sendQueued(depsWith(fakeCloud({ saveLink: full })));
    await expect(refusedSaves(SESSION.email)).resolves.toMatchObject([
      { name: "https://example.test/file-over-app" },
    ]);
  });
});

describe("the queue's passes", () => {
  it("run one at a time, so four asks at once send each save once, and one more pass sends a save kept meanwhile", async () => {
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
    await keepSave(waiting({ opId: SECOND }));
    const laterAsks = [sendQueued(deps), sendQueued(deps), sendQueued(deps)];
    held.resolve();
    await Promise.all([firstAsk, ...laterAsks]);
    expect(cloud.links.map((link) => link.opId)).toStrictEqual([FIRST, SECOND]);
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

  it.each([
    ["left unanswered", new TypeError("Failed to fetch"), waitingFor("connection")],
    ["refused", refusal("QUOTA"), refusedByLibrary("QUOTA")],
  ] as const)(
    "never bring back a save its account's deletion let go while its first try ran, a try %s",
    async (_met, answer, outcome) => {
      await keepSave(waiting());
      const held = deferred();
      const firstTry = fakeCloud({
        saveLink: async () => {
          await held.promise;
          if (answer instanceof Error) {
            throw answer;
          }
          return await answer();
        },
      });
      const saving = saveTabAsLink(firstTry);
      await expect.poll(() => firstTry.links.length).toBe(1);
      await sendQueued(depsWith(fakeCloud({ saveLink: refusal("GONE") })));
      held.resolve();
      await expect(saving).resolves.toStrictEqual(outcome);
      await expect(queuedSaves()).resolves.toStrictEqual([]);
    },
  );

  it("send a save whose worker stopped mid-try, which holds nothing of the try", async () => {
    // what a stopped worker leaves: the save as it was kept before its first call
    await keepSave(waiting());
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud));
    expect(cloud.links.map((link) => link.opId)).toStrictEqual([waiting().opId]);
  });
});
