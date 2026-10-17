import { BROWSER_WIRE_VERSION } from "@repo/contract/browser/browser-wire";
import type { BrowserHostReply, BrowserHostRequest } from "@repo/contract/browser/browser-wire";
import { DEV_NATIVE_HOST_NAME } from "@repo/contract/browser/extension-identity";
import { describe, expect, it } from "vitest";
import { answerOfDisconnect, askHost } from "../ask-host";
import type { AskHostDeps, HostPort } from "../ask-host";

interface FakeHost {
  deps: AskHostDeps;
  connected: string[];
  posted: BrowserHostRequest[];
  closed: () => number;
}

const ignoreReply = (_reply: BrowserHostReply | null): void => undefined;
const ignoreClose = (): void => undefined;

// a port that answers what the case scripts: replies, or a close with Chrome's lastError
const fakeHost = (script: {
  replies?: (BrowserHostReply | null)[];
  closeWith?: string;
  connectThrows?: string;
}): FakeHost => {
  const connected: string[] = [];
  const posted: BrowserHostRequest[] = [];
  let closes = 0;
  let lastError: string | undefined;
  const connect = (hostName: string): HostPort => {
    if (script.connectThrows !== undefined) {
      throw new Error(script.connectThrows);
    }
    connected.push(hostName);
    let onReply = ignoreReply;
    let onClose = ignoreClose;
    return {
      close: () => {
        closes += 1;
      },
      onClose: (listener) => {
        onClose = listener;
      },
      onReply: (listener) => {
        onReply = listener;
      },
      post: (request) => {
        posted.push(request);
        queueMicrotask(() => {
          for (const reply of script.replies ?? []) {
            onReply(reply);
          }
          lastError = script.closeWith;
          onClose();
        });
      },
    };
  };
  return {
    closed: () => closes,
    connected,
    deps: { connect, lastError: () => lastError },
    posted,
  };
};

const hello: BrowserHostRequest = { type: "hello", v: BROWSER_WIRE_VERSION };
const saved: BrowserHostReply = {
  created: true,
  path: "Unsorted/A.md",
  title: "A",
  type: "saved",
  v: BROWSER_WIRE_VERSION,
};

describe("asking the Mac's host", () => {
  it("dials the build's host, posts once, takes the first reply and closes the port", async () => {
    const host = fakeHost({ replies: [saved, { type: "opened", v: 1 }] });
    expect(await askHost(hello, host.deps)).toEqual({ kind: "reply", reply: saved });
    expect(host.connected).toEqual([DEV_NATIVE_HOST_NAME]);
    expect(host.posted).toEqual([hello]);
    expect(host.closed()).toBe(1);
  });

  it("reads Chrome's sentences as no app, a door for another extension, or a crash", async () => {
    expect(
      await askHost(
        hello,
        fakeHost({ closeWith: "Specified native messaging host not found." }).deps,
      ),
    ).toEqual({ kind: "absent" });
    expect(
      await askHost(
        hello,
        fakeHost({ closeWith: "Access to the specified native messaging host is forbidden." }).deps,
      ),
    ).toEqual({ kind: "forbidden" });
    expect(await askHost(hello, fakeHost({ closeWith: "Native host has exited." }).deps)).toEqual({
      detail: "Native host has exited.",
      kind: "crashed",
    });
    expect(answerOfDisconnect()).toMatchObject({ kind: "crashed" });
  });

  it("reads a reply that is not one, or a dial that throws, as a crash", async () => {
    expect(await askHost(hello, fakeHost({ replies: [null] }).deps)).toMatchObject({
      kind: "crashed",
    });
    expect(await askHost(hello, fakeHost({ connectThrows: "no permission" }).deps)).toEqual({
      detail: "no permission",
      kind: "crashed",
    });
  });
});
