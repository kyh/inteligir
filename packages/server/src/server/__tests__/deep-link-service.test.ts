import { describe, expect, it } from "vitest";

import { createDeepLinkService } from "../capture/deep-link-service";
import type { CaptureKind, DeepLinkNavEvent } from "@repo/bridge/deep-link";

function harness(startMs = 0) {
  let now = startMs;
  const captures: Array<{ kind: CaptureKind; text: string }> = [];
  const navs: DeepLinkNavEvent[] = [];
  const sessions: Array<{ code: string; state: string }> = [];
  let focusCalls = 0;
  const service = createDeepLinkService({
    enqueueCapture: (kind, text) => captures.push({ kind, text }),
    emitNav: (event) => navs.push(event),
    completeSession: (code, state) => sessions.push({ code, state }),
    now: () => now,
  });
  service.setFocusHandler(() => {
    focusCalls++;
  });
  return {
    service,
    captures,
    navs,
    sessions,
    focus: () => focusCalls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("dispatch", () => {
  it("routes captures to the inbox without focusing", () => {
    const h = harness();
    h.service.deliver("inteligir://append?text=hello");
    h.service.deliver("inteligir://task?text=do%20it");
    expect(h.captures).toEqual([
      { kind: "append", text: "hello" },
      { kind: "task", text: "do it" },
    ]);
    expect(h.navs).toEqual([]);
    expect(h.focus()).toBe(0);
  });

  it("broadcasts + parks + focuses on nav verbs", () => {
    const h = harness();
    h.service.deliver("inteligir://today");
    expect(h.navs).toEqual([{ id: "nav-1", nav: { kind: "today" } }]);
    expect(h.focus()).toBe(1);
    expect(h.service.takePendingNav()).toEqual({ id: "nav-1", nav: { kind: "today" } });
    // Pull-and-clear: a second pull finds nothing.
    expect(h.service.takePendingNav()).toBeNull();
  });

  it("drops URLs outside the grammar", () => {
    const h = harness();
    h.service.deliver("inteligir://exec?cmd=rm%20-rf");
    h.service.deliver("https://example.com");
    expect(h.captures).toEqual([]);
    expect(h.navs).toEqual([]);
  });

  it("routes the session verb to completeSession and focuses", () => {
    const h = harness();
    const code = "c".repeat(43);
    const state = "s".repeat(22);
    h.service.deliver(`inteligir://session?code=${code}&state=${state}`);
    expect(h.sessions).toEqual([{ code, state }]);
    // The user is returning from the browser — surface the window…
    expect(h.focus()).toBe(1);
    // …but a session is neither a capture nor a nav (nothing parks).
    expect(h.captures).toEqual([]);
    expect(h.navs).toEqual([]);
    expect(h.service.takePendingNav()).toBeNull();
  });

  it("drops session URLs outside the opaque grammar", () => {
    const h = harness();
    h.service.deliver("inteligir://session?code=short&state=xx");
    h.service.deliver(`inteligir://session?code=${"c".repeat(43)}`);
    h.service.deliver("inteligir://session");
    expect(h.sessions).toEqual([]);
    expect(h.focus()).toBe(0);
  });

  it("a newer nav replaces the parked one", () => {
    const h = harness();
    h.service.deliver("inteligir://today");
    h.service.deliver("inteligir://search?q=x");
    expect(h.service.takePendingNav()).toEqual({
      id: "nav-2",
      nav: { kind: "search", query: "x" },
    });
  });
});

describe("rate limit (burst 10, refill 1 per 2s)", () => {
  it("drops everything past the burst", () => {
    const h = harness();
    for (let i = 0; i < 20; i++) h.service.deliver(`inteligir://append?text=n${i}`);
    expect(h.captures).toHaveLength(10);
  });

  it("refills one token per interval", () => {
    const h = harness();
    for (let i = 0; i < 12; i++) h.service.deliver(`inteligir://append?text=n${i}`);
    expect(h.captures).toHaveLength(10);
    h.advance(2_000);
    h.service.deliver("inteligir://append?text=after-one-interval");
    h.service.deliver("inteligir://append?text=still-dry");
    expect(h.captures).toHaveLength(11);
    h.advance(6_000);
    h.service.deliver("inteligir://append?text=a");
    h.service.deliver("inteligir://append?text=b");
    h.service.deliver("inteligir://append?text=c");
    h.service.deliver("inteligir://append?text=d");
    expect(h.captures).toHaveLength(14); // 3 tokens refilled, 4th dropped
  });

  it("never refills past capacity", () => {
    const h = harness();
    h.advance(1_000_000);
    for (let i = 0; i < 12; i++) h.service.deliver(`inteligir://append?text=n${i}`);
    expect(h.captures).toHaveLength(10);
  });
});

describe("pending-nav TTL", () => {
  it("a stale parked nav is not replayed to a late-mounting renderer", () => {
    const h = harness();
    h.service.deliver("inteligir://today");
    h.advance(61_000);
    expect(h.service.takePendingNav()).toBeNull();
  });

  it("a fresh parked nav survives a normal boot window", () => {
    const h = harness();
    h.service.deliver("inteligir://today");
    h.advance(5_000);
    expect(h.service.takePendingNav()).not.toBeNull();
  });
});
