import { ORPCError } from "@orpc/client";
import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

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
import { CONNECTION, fakeCloud } from "./test-support/fake-cloud";

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
) => {
  let signedOut = 0;
  return {
    deps: {
      cloud: () => cloud.cloud,
      connection: async () => connection,
      now: () => NOW,
      signedOut: async () => {
        signedOut += 1;
      },
    },
    signedOut: () => signedOut,
  };
};

describe("a save that waits", () => {
  it("keeps the address, the title and the passage, and holds the alarm while it waits", async () => {
    await markWaiting(waiting({ waitingSince: null }), NOW);
    expect(await queuedSaves()).toEqual([waiting({ waitingSince: NOW })]);
    expect(await browser.alarms.get(SEND_ALARM)).toMatchObject({ periodInMinutes: 0.5 });
  });

  it("is sent as its link, the passage with it, and goes, and the alarm with the last of them", async () => {
    await keepSave(waiting());
    await ensureSendAlarm();
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud).deps);
    expect(cloud.links).toEqual([
      {
        id: waiting().id,
        opId: waiting().opId,
        savedAt: waiting().savedAt,
        selection: "a passage",
        title: "File over app",
        url: "https://example.test/file-over-app",
      },
    ]);
    expect(await queuedSaves()).toEqual([]);
    expect(await browser.alarms.get(SEND_ALARM)).toBeUndefined();
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
    expect(await queuedSaves()).toHaveLength(2);
    expect(await browser.alarms.get(SEND_ALARM)).toBeDefined();
  });

  it("leaves a first try still under way alone until it has met its deadline", async () => {
    await keepSave(waiting({ savedAt: NOW - 5000, waitingSince: null }));
    const cloud = fakeCloud({});
    await sendQueued(depsWith(cloud).deps);
    expect(cloud.links).toEqual([]);
    expect(await queuedSaves()).toHaveLength(1);
    await keepSave(waiting({ savedAt: NOW - 120_000, waitingSince: null }));
    await sendQueued(depsWith(cloud).deps);
    expect(cloud.links).toHaveLength(1);
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
    expect(cloud.links.map((link) => link.opId)).toEqual(["01900000-0000-7000-8000-0000000000a3"]);
    expect(await queuedSaves()).toEqual([]);
  });

  it("ends the connection, and what waited under it, once the cloud says the credential is gone", async () => {
    await keepSave(waiting());
    const cloud = fakeCloud({
      saveLink: async () => {
        throw new ORPCError("UNAUTHORIZED");
      },
    });
    const run = depsWith(cloud);
    await sendQueued(run.deps);
    expect(run.signedOut()).toBe(1);
  });

  it("drops a record that does not parse, rather than sending it", async () => {
    await browser.storage.local.set({ "save:broken": { url: 7 } });
    expect(await queuedSaves()).toEqual([]);
    expect(await browser.storage.local.get("save:broken")).toEqual({});
  });
});
