import { ORPCError } from "@orpc/client";
import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { COVER_DEADLINE_MS, COVER_TRIES } from "./capture-tab";
import { CALL_DEADLINE_MS } from "./cloud";
import { keepConnection, readConnection } from "./connection";
import { keepSave, markWaiting, queuedSaves, SEND_ALARM, sendQueued } from "./save-queue";
import type { QueuedSave } from "./save-queue";
import type { SignIn } from "./sign-in";
import {
  fakeCloud,
  OTHER_SESSION,
  SESSION,
  SIGNED_IN,
  SIGNED_OUT,
} from "./test-support/fake-cloud";

beforeEach(async () => {
  fakeBrowser.reset();
  await keepConnection({ email: SESSION.email, origin: SESSION.origin });
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

const depsWith = (cloud: ReturnType<typeof fakeCloud>, signIn: SignIn | null = SIGNED_IN) => ({
  cloud: () => cloud.cloud,
  now: () => NOW,
  signIn: async () => signIn,
});

describe("a save that waits", () => {
  it("keeps the address and the title, and holds the alarm while it waits", async () => {
    await markWaiting(waiting({ firstTry: true }));
    await expect(queuedSaves()).resolves.toStrictEqual([waiting()]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toMatchObject({ periodInMinutes: 0.5 });
  });

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

  it("waits again, the later ones behind it, while the cloud does not answer", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ opId: SECOND, savedAt: NOW - 900 }));
    const cloud = fakeCloud({
      saveLink: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await sendQueued(depsWith(cloud));
    expect(cloud.links).toHaveLength(1);
    await expect(queuedSaves()).resolves.toHaveLength(2);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
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

  it("waits through a build the cloud calls too old, for the update the browser makes", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ opId: SECOND, savedAt: NOW - 900 }));
    const outdated = fakeCloud({
      saveLink: async () => {
        throw new ORPCError("CLIENT_OUTDATED");
      },
    });
    await sendQueued(depsWith(outdated));
    expect(outdated.links).toHaveLength(1);
    await expect(queuedSaves()).resolves.toStrictEqual([
      waiting(),
      waiting({ opId: SECOND, savedAt: NOW - 900 }),
    ]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
    // the updated extension's worker sends both
    const updated = fakeCloud({});
    await sendQueued(depsWith(updated));
    expect(updated.links).toHaveLength(2);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("is sent only under its own account's session, and lets go one no resend can land", async () => {
    await keepSave(waiting({ email: OTHER_SESSION.email }));
    await keepSave(waiting({ opId: THIRD }));
    const cloud = fakeCloud({
      saveLink: async () => {
        throw new ORPCError("QUOTA");
      },
    });
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
    let asked = 0;
    await sendQueued({
      cloud: () => fakeCloud({}).cloud,
      now: () => NOW,
      signIn: async () => {
        asked += 1;
        return SIGNED_IN;
      },
    });
    expect(asked).toBe(0);
  });

  it("waits for its account to sign in again once the cloud says the session ended", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ opId: SECOND, savedAt: NOW - 900 }));
    const ended = fakeCloud({
      saveLink: async () => {
        throw new ORPCError("UNAUTHORIZED");
      },
    });
    await sendQueued(depsWith(ended));
    expect(ended.links).toHaveLength(1);
    await expect(queuedSaves()).resolves.toHaveLength(2);
    await expect(readConnection()).resolves.toStrictEqual({
      email: SESSION.email,
      origin: SESSION.origin,
    });
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
    // signed in again, both go
    const again = fakeCloud({});
    await sendQueued(depsWith(again));
    expect(again.links).toHaveLength(2);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("lets go what waited for an account the cloud deleted, and the account with it", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ opId: SECOND, savedAt: NOW - 900 }));
    await keepSave(waiting({ email: OTHER_SESSION.email, opId: THIRD }));
    const cloud = fakeCloud({
      saveLink: async () => {
        throw new ORPCError("GONE");
      },
    });
    await sendQueued(depsWith(cloud));
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
        throw new ORPCError("GONE");
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
