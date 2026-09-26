import { afterEach, describe, expect, it, vi } from "vitest";

import { connectPageBridge, REQUEST_TIMEOUT_MS, windowTransport } from "../bridge/page-bridge";
import type { NativeEvent } from "../bridge/page-bridge";
import { nativeFrameScript, PAGE_RECEIVER } from "../bridge/protocol";
import type { NativeFrame } from "../bridge/protocol";
import { createFakePhone, PHONE_NONCE } from "./fake-phone";

const connected = async () => {
  const phone = createFakePhone();
  const connecting = connectPageBridge(phone.transport);
  phone.init();
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

const answered = (id: number | undefined, content: string): NativeFrame => ({
  id: id ?? -1,
  nonce: PHONE_NONCE,
  ok: true,
  result: { content },
  type: "response",
});

const changed = {
  event: { kind: "content", path: "Note.md" },
  nonce: PHONE_NONCE,
  type: "vaultChanged",
} satisfies NativeFrame;

afterEach(() => {
  vi.useRealTimers();
});

describe("connecting", () => {
  it("says it is ready before it knows a nonce, and connects on the first init", async () => {
    const phone = createFakePhone();
    const connecting = connectPageBridge(phone.transport);
    expect(phone.sent).toEqual([{ type: "ready" }]);

    phone.init({ path: "Plans/Week.md" });
    const { init } = await connecting;
    expect(init).toMatchObject({ nonce: PHONE_NONCE, path: "Plans/Week.md" });
  });

  it("keeps the first load's nonce when a second init arrives", async () => {
    const { bridge, phone } = await connected();
    phone.init({ nonce: "another-load-nonce-000" });

    bridge.emit({ path: "Note.md", type: "navigate" });
    expect(phone.events("navigate")).toEqual([
      { nonce: PHONE_NONCE, path: "Note.md", type: "navigate" },
    ]);
  });
});

describe("a request", () => {
  it("resolves by its own id, whatever order the answers arrive in", async () => {
    const { bridge, phone } = await connected();
    phone.answer = () => null;

    const first = bridge.request("read", { path: "A.md" });
    const second = bridge.request("read", { path: "B.md" });
    const [a, b] = phone.requests("read");
    phone.deliver(answered(b?.id, "b"));
    phone.deliver(answered(a?.id, "a"));

    await expect(first).resolves.toEqual({ content: "a" });
    await expect(second).resolves.toEqual({ content: "b" });
  });

  it("rejects with the phone's own words when it refuses", async () => {
    const { bridge } = await connected();
    await expect(bridge.request("read", { path: "Gone.md" })).rejects.toThrow("no Gone.md");
  });

  it("rejects an answer that is not the shape its kind promises", async () => {
    const { bridge, phone } = await connected();
    phone.answer = () => ({ ok: true, result: { kind: "written" } });
    await expect(bridge.request("read", { path: "A.md" })).rejects.toThrow();
  });

  it("gives up after its timeout, and a late answer changes nothing", async () => {
    vi.useFakeTimers();
    const { bridge, phone } = await connected();
    phone.answer = () => null;

    const asked = bridge.request("read", { path: "A.md" });
    const settled = expect(asked).rejects.toThrow(/did not answer read/u);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await settled;

    const [frame] = phone.requests("read");
    expect(() => {
      phone.deliver(answered(frame?.id, "late"));
    }).not.toThrow();
  });

  it("waits on the photo picker for as long as the user browses", async () => {
    vi.useFakeTimers();
    const { bridge, phone } = await connected();
    phone.answer = () => null;

    const picking = bridge.request("pickImage", {});
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 10);
    const [frame] = phone.requests("pickImage");
    phone.deliver({
      id: frame?.id ?? -1,
      nonce: PHONE_NONCE,
      ok: true,
      result: { kind: "cancelled" },
      type: "response",
    });

    await expect(picking).resolves.toEqual({ kind: "cancelled" });
  });

  it("refuses a malformed ask before it reaches the phone", async () => {
    const { bridge, phone } = await connected();
    await expect(bridge.request("read", { path: "../outside.md" })).rejects.toThrow();
    expect(phone.requests("read")).toEqual([]);
  });
});

describe("what the page drops", () => {
  it("a frame with no nonce, or another load's", async () => {
    const { heard, phone } = await listening();
    phone.deliverText(JSON.stringify({ event: changed.event, type: "vaultChanged" }));
    phone.deliver({ ...changed, nonce: "another-load-nonce-000" });
    expect(heard).toEqual([]);

    phone.deliver(changed);
    expect(heard).toEqual([changed]);
  });

  it("a response with no nonce, which settles nothing", async () => {
    const { bridge, phone } = await listening();
    phone.answer = () => null;
    const asked = bridge.request("read", { path: "A.md" });
    const [frame] = phone.requests("read");

    phone.deliverText(
      JSON.stringify({ id: frame?.id, ok: true, result: { content: "forged" }, type: "response" }),
    );
    phone.deliver(answered(frame?.id, "real"));

    await expect(asked).resolves.toEqual({ content: "real" });
  });

  it("anything that is not a frame", async () => {
    const { heard, phone } = await listening();
    for (const garbage of [
      "",
      "not json",
      "null",
      "42",
      '"vaultChanged"',
      JSON.stringify({ type: "vaultChanged" }),
      JSON.stringify({ nonce: PHONE_NONCE, theme: "sepia", type: "theme" }),
      JSON.stringify({ ...changed, extra: true }),
    ]) {
      phone.deliverText(garbage);
    }
    expect(heard).toEqual([]);
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
    expect(posted.map((text) => JSON.parse(text))).toEqual([{ type: "ready" }]);

    const door = window[PAGE_RECEIVER];
    expect(() => {
      window[PAGE_RECEIVER] = () => {};
    }).toThrow(TypeError);
    expect(window[PAGE_RECEIVER]).toBe(door);

    // the script the native end injects calls the door with one string literal, the frame's JSON
    const script = nativeFrameScript({
      focus: "body",
      nonce: PHONE_NONCE,
      path: "Note.md",
      theme: "dark",
      type: "init",
    });
    const call = /^window\.(?<door>\w+)\((?<literal>".*")\);true;$/su.exec(script);
    expect(call?.groups?.door).toBe(PAGE_RECEIVER);
    door?.(JSON.parse(call?.groups?.literal ?? '""'));
    const { bridge, init } = await connecting;
    expect(init.focus).toBe("body");

    bridge.emit({ path: "Other.md", type: "navigate" });
    expect(JSON.parse(posted.at(-1) ?? "null")).toEqual({
      nonce: PHONE_NONCE,
      path: "Other.md",
      type: "navigate",
    });
  });
});
