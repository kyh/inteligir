import { afterEach, describe, expect, it, vi } from "vitest";

import { connectPageBridge, REQUEST_TIMEOUT_MS, windowTransport } from "./page-bridge";
import type { NativeEvent } from "./page-bridge";
import { nativeFrameScript, PAGE_RECEIVER } from "@repo/editor-bridge/protocol";
import type { NativeFrame } from "@repo/editor-bridge/protocol";
import { createFakePhone, PHONE_NONCE } from "../test-support/fake-phone";

const ITEM = "0190a000-0000-7000-8000-000000000001";
const OTHER = "0190a000-0000-7000-8000-000000000002";

const connected = async () => {
  const phone = createFakePhone();
  const connecting = connectPageBridge(phone.transport);
  phone.init({ itemId: ITEM });
  const { bridge, init } = await connecting;
  return { bridge, init, phone };
};

const listening = async () => {
  const { bridge, phone } = await connected();
  const heard: NativeEvent[] = [];
  bridge.onNative((event) => {
    heard.push(event);
  });
  return { bridge, heard, phone };
};

// an answer to `linkTargets`, naming one item by `title`
const targetsTitled = (title: string) => ({ targets: [{ id: ITEM, title }] });

const answered = (id: number | undefined, title: string): NativeFrame => ({
  id: id ?? -1,
  nonce: PHONE_NONCE,
  ok: true,
  result: targetsTitled(title),
  type: "response",
});

const changed = {
  ids: [ITEM],
  nonce: PHONE_NONCE,
  reset: false,
  type: "itemChanged",
} satisfies NativeFrame;

afterEach(() => {
  vi.useRealTimers();
});

describe("connecting", () => {
  it("says it is ready before it knows a nonce, and connects on the first init", async () => {
    const phone = createFakePhone();
    const connecting = connectPageBridge(phone.transport);
    expect(phone.sent).toStrictEqual([{ type: "ready" }]);

    phone.init({ itemId: OTHER });
    const { init } = await connecting;
    expect(init).toMatchObject({ itemId: OTHER, nonce: PHONE_NONCE });
  });

  it("keeps the first load's nonce when a second init arrives", async () => {
    const { bridge, phone } = await connected();
    phone.init({ itemId: OTHER, nonce: "another-load-nonce-000" });

    bridge.emit({ itemId: OTHER, type: "openItem" });
    expect(phone.events("openItem")).toStrictEqual([
      { itemId: OTHER, nonce: PHONE_NONCE, type: "openItem" },
    ]);
  });
});

describe("a request", () => {
  it("resolves by its own id, whatever order the answers arrive in", async () => {
    const { bridge, phone } = await connected();
    phone.answer = () => null;

    const first = bridge.request("linkTargets", {});
    const second = bridge.request("linkTargets", {});
    const [a, b] = phone.requests("linkTargets");
    phone.deliver(answered(b?.id, "b"));
    phone.deliver(answered(a?.id, "a"));

    await expect(first).resolves.toStrictEqual(targetsTitled("a"));
    await expect(second).resolves.toStrictEqual(targetsTitled("b"));
  });

  it("rejects with the phone's own words when it refuses", async () => {
    const { bridge, phone } = await connected();
    phone.answer = () => ({ error: "the library is closed", ok: false });
    await expect(bridge.request("item", { itemId: ITEM })).rejects.toThrow("the library is closed");
  });

  it("rejects an answer that is not the shape its kind promises", async () => {
    const { bridge, phone } = await connected();
    phone.answer = () => ({ ok: true, result: { targets: [] } });
    await expect(bridge.request("item", { itemId: ITEM })).rejects.toThrow(
      "expected object, received undefined",
    );
  });

  it("gives up after its timeout, and a late answer changes nothing", async () => {
    vi.useFakeTimers();
    const { bridge, phone } = await connected();
    phone.answer = () => null;

    // the refusal is asked for before the clock moves, so the rejection always has its handler
    await Promise.all([
      expect(bridge.request("linkTargets", {})).rejects.toThrow(/did not answer linkTargets/u),
      vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS),
    ]);

    const [frame] = phone.requests("linkTargets");
    expect(() => {
      phone.deliver(answered(frame?.id, "late"));
    }).not.toThrow();
  });

  // a file still downloading reported failed would have the editor say a picture is missing
  it("waits on a slow file past the deadline, since the phone fetches it however long it takes", async () => {
    vi.useFakeTimers();
    const { bridge, phone } = await connected();
    phone.answer = () => null;

    const sha = "a".repeat(64);
    const reading = bridge.request("readFile", { sha });
    let settled = false;
    void reading.finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2);
    expect(settled).toBe(false);

    const [frame] = phone.requests("readFile");
    const file = { base64: "AA==", mediaType: "image/png" };
    phone.deliver({
      id: frame?.id ?? -1,
      nonce: PHONE_NONCE,
      ok: true,
      result: { file },
      type: "response",
    });
    await expect(reading).resolves.toStrictEqual({ file });
  });

  it("refuses a malformed ask before it reaches the phone", async () => {
    const { bridge, phone } = await connected();
    await expect(bridge.request("item", { itemId: "" })).rejects.toThrow(
      "expected string to have >=1 characters",
    );
    expect(phone.requests("item")).toStrictEqual([]);
  });
});

describe("what the page drops", () => {
  it("a frame with no nonce, or another load's", async () => {
    const { heard, phone } = await listening();
    phone.deliverText(JSON.stringify({ ids: [ITEM], reset: false, type: "itemChanged" }));
    phone.deliver({ ...changed, nonce: "another-load-nonce-000" });
    expect(heard).toStrictEqual([]);

    phone.deliver(changed);
    expect(heard).toStrictEqual([changed]);
  });

  it("a response with no nonce, which settles nothing", async () => {
    const { bridge, phone } = await listening();
    phone.answer = () => null;
    const asked = bridge.request("linkTargets", {});
    const [frame] = phone.requests("linkTargets");

    phone.deliverText(
      JSON.stringify({
        id: frame?.id,
        ok: true,
        result: targetsTitled("forged"),
        type: "response",
      }),
    );
    phone.deliver(answered(frame?.id, "real"));

    await expect(asked).resolves.toStrictEqual(targetsTitled("real"));
  });

  it("anything that is not a frame", async () => {
    const { heard, phone } = await listening();
    for (const garbage of [
      "",
      "not json",
      "null",
      "42",
      '"itemChanged"',
      JSON.stringify({ type: "itemChanged" }),
      JSON.stringify({ nonce: PHONE_NONCE, type: "format" }),
      JSON.stringify({ ...changed, extra: true }),
    ]) {
      phone.deliverText(garbage);
    }
    expect(heard).toStrictEqual([]);
  });
});

describe("the window transport", () => {
  it("receives only through the door it installs, which no script can replace", async () => {
    const posted: string[] = [];
    window.ReactNativeWebView = {
      postMessage: (message) => {
        posted.push(message);
      },
    };
    const connecting = connectPageBridge(windowTransport(window));
    expect(posted.map((text) => JSON.parse(text))).toStrictEqual([{ type: "ready" }]);

    const door = window[PAGE_RECEIVER];
    expect(() => {
      window[PAGE_RECEIVER] = () => {};
    }).toThrow(TypeError);
    expect(window[PAGE_RECEIVER]).toBe(door);

    // the script the native end injects calls the door with one string literal, the frame's JSON
    const script = nativeFrameScript({ itemId: ITEM, nonce: PHONE_NONCE, type: "init" });
    const call = /^window\.(?<door>\w+)\((?<literal>".*")\);true;$/su.exec(script);
    expect(call?.groups?.door).toBe(PAGE_RECEIVER);
    door?.(JSON.parse(call?.groups?.literal ?? '""'));
    const { bridge, init } = await connecting;
    expect(init).toStrictEqual({ itemId: ITEM, nonce: PHONE_NONCE, type: "init" });

    bridge.emit({ itemId: OTHER, type: "openItem" });
    expect(JSON.parse(posted.at(-1) ?? "null")).toStrictEqual({
      itemId: OTHER,
      nonce: PHONE_NONCE,
      type: "openItem",
    });
  });
});
