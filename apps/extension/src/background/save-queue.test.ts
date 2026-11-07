import { ORPCError } from "@orpc/client";
import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { COVER_DEADLINE_MS, COVER_TRIES } from "./capture-tab";
import { CALL_DEADLINE_MS } from "./cloud";
import { readConnection } from "./connection";
import type { Connection } from "./connection";
import {
  ensureSendAlarm,
  keepSave,
  markWaiting,
  queuedSaves,
  SEND_ALARM,
  sendQueued,
} from "./save-queue";
import type { QueuedSave } from "./save-queue";
import { CONNECTION, fakeCloud, handOver, MINTED, NEXT } from "./test-support/fake-cloud";

beforeEach(() => {
  fakeBrowser.reset();
});

const NOW = Date.UTC(2026, 10, 5, 12);

const waiting = (overrides: Partial<QueuedSave> = {}): QueuedSave => ({
  deviceId: CONNECTION.deviceId,
  id: "01900000-0000-7000-8000-000000000001",
  opId: "01900000-0000-7000-8000-0000000000a1",
  savedAt: NOW - 1000,
  selection: "a passage",
  title: "File over app",
  url: "https://example.test/file-over-app",
  waitingSince: NOW - 500,
  ...overrides,
});

const depsWith = (
  cloud: ReturnType<typeof fakeCloud>,
  connection: Connection | null = CONNECTION,
) => ({
  deps: {
    cloud: () => cloud.cloud,
    connection: async () => connection,
    now: () => NOW,
  },
});

describe("a save that waits", () => {
  it("keeps the address, the title and the passage, and holds the alarm while it waits", async () => {
    await markWaiting(waiting({ waitingSince: null }), NOW);
    await expect(queuedSaves()).resolves.toStrictEqual([waiting({ waitingSince: NOW })]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toMatchObject({ periodInMinutes: 0.5 });
  });

  it("is sent as its link, the passage with it, and goes, and the alarm with the last of them", async () => {
    await keepSave(waiting());
    await ensureSendAlarm();
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud).deps);
    expect(cloud.links).toStrictEqual([
      {
        id: waiting().id,
        opId: waiting().opId,
        savedAt: waiting().savedAt,
        selection: "a passage",
        title: "File over app",
        url: "https://example.test/file-over-app",
      },
    ]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeUndefined();
  });

  it("waits again, the later ones behind it, while the cloud does not answer", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ opId: "01900000-0000-7000-8000-0000000000a2", savedAt: NOW - 900 }));
    const cloud = fakeCloud({
      saveLink: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await sendQueued(depsWith(cloud).deps);
    expect(cloud.links).toHaveLength(1);
    await expect(queuedSaves()).resolves.toHaveLength(2);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
  });

  it("leaves a first try still under way alone for as long as that try can run", async () => {
    // every cover candidate fetched to its deadline, then the cover's put and the save to theirs
    const longestTry = COVER_TRIES * COVER_DEADLINE_MS + 2 * CALL_DEADLINE_MS;
    const cloud = fakeCloud({});
    for (const age of [5000, 61_000, longestTry]) {
      await keepSave(waiting({ savedAt: NOW - age, waitingSince: null }));
      await sendQueued(depsWith(cloud).deps);
      expect(cloud.links, `a first try ${String(age)} ms in`).toStrictEqual([]);
    }
    await expect(queuedSaves()).resolves.toHaveLength(1);
    // its worker was stopped mid-call: nothing will say how it went, so it goes again
    await keepSave(waiting({ savedAt: NOW - 10 * 60_000, waitingSince: null }));
    await sendQueued(depsWith(cloud).deps);
    expect(cloud.links).toHaveLength(1);
  });

  it("waits through a build the cloud calls too old, for the update the browser makes", async () => {
    await keepSave(waiting());
    await keepSave(waiting({ opId: "01900000-0000-7000-8000-0000000000a2", savedAt: NOW - 900 }));
    const outdated = fakeCloud({
      saveLink: async () => {
        throw new ORPCError("CLIENT_OUTDATED");
      },
    });
    await sendQueued(depsWith(outdated).deps);
    expect(outdated.links).toHaveLength(1);
    await expect(queuedSaves()).resolves.toStrictEqual([
      waiting({ waitingSince: NOW }),
      waiting({ opId: "01900000-0000-7000-8000-0000000000a2", savedAt: NOW - 900 }),
    ]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
    // the updated extension's worker sends both
    const updated = fakeCloud({});
    await sendQueued(depsWith(updated).deps);
    expect(updated.links).toHaveLength(2);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("is never sent under another device's credential, and lets go one no resend can land", async () => {
    await keepSave(waiting({ deviceId: "another-sign-in" }));
    await keepSave(waiting({ opId: "01900000-0000-7000-8000-0000000000a3" }));
    const cloud = fakeCloud({
      saveLink: async () => {
        throw new ORPCError("QUOTA");
      },
    });
    await sendQueued(depsWith(cloud).deps);
    expect(cloud.links.map((link) => link.opId)).toStrictEqual([
      "01900000-0000-7000-8000-0000000000a3",
    ]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("ends the connection, and what waited under it, once the cloud says the credential is gone", async () => {
    await handOver(MINTED);
    await keepSave(waiting());
    await keepSave(waiting({ opId: "01900000-0000-7000-8000-0000000000a2", savedAt: NOW - 900 }));
    const cloud = fakeCloud({
      saveLink: async () => {
        throw new ORPCError("UNAUTHORIZED");
      },
    });
    await sendQueued({ ...depsWith(cloud).deps, connection: readConnection });
    await expect(readConnection()).resolves.toBeNull();
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeUndefined();
  });

  it("keeps the connection a connect handed over while a call under the old one was on its way", async () => {
    await handOver(MINTED);
    await keepSave(waiting());
    await keepSave(waiting({ opId: "01900000-0000-7000-8000-0000000000a2", savedAt: NOW - 900 }));
    const cloud = fakeCloud({
      saveLink: async () => {
        await handOver(NEXT);
        await keepSave(
          waiting({
            deviceId: NEXT.deviceId,
            opId: "01900000-0000-7000-8000-0000000000a3",
            savedAt: NOW - 800,
          }),
        );
        throw new ORPCError("UNAUTHORIZED");
      },
    });
    await sendQueued({ ...depsWith(cloud).deps, connection: readConnection });
    await expect(readConnection()).resolves.toMatchObject({ deviceId: NEXT.deviceId });
    await expect(queuedSaves()).resolves.toHaveLength(3);
    await expect(browser.alarms.get(SEND_ALARM)).resolves.toBeDefined();
    // the next pass lets the old credential's saves go, and sends what the new one made
    const answering = fakeCloud({});
    await sendQueued({ ...depsWith(answering).deps, connection: readConnection });
    expect(answering.links.map((link) => link.opId)).toStrictEqual([
      "01900000-0000-7000-8000-0000000000a3",
    ]);
    await expect(queuedSaves()).resolves.toStrictEqual([]);
  });

  it("drops a record that does not parse, rather than sending it", async () => {
    await browser.storage.local.set({ "save:broken": { url: 7 } });
    await expect(queuedSaves()).resolves.toStrictEqual([]);
    // the store holds nothing under the key (WXT's fake answers it undefined, Chrome leaves it out)
    const held = await browser.storage.local.get("save:broken");
    expect(held["save:broken"]).toBeUndefined();
  });
});
