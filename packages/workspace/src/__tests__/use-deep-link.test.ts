// The deep-link nav connection protocol — subscribe-before-take + id dedupe.
// The cold-launch race this pins: a nav that lands BETWEEN the pending pull
// being issued and its resolution must not be dropped (subscribe-first
// catches it) and must not run twice when the pull returns the same event.

import { describe, expect, it } from "vitest";

import type { DeepLinkNav, DeepLinkNavEvent } from "@repo/bridge/deep-link";

import { connectDeepLinkNav } from "@repo/workspace/workspace/use-deep-link";

type Deferred = {
  promise: Promise<DeepLinkNavEvent | null>;
  resolve: (value: DeepLinkNavEvent | null) => void;
};

function deferred(): Deferred {
  const holder: { resolve: (value: DeepLinkNavEvent | null) => void } = {
    resolve: () => {},
  };
  const promise = new Promise<DeepLinkNavEvent | null>((resolve) => {
    holder.resolve = resolve;
  });
  return { promise, resolve: (value) => holder.resolve(value) };
}

function harness(pending: Deferred) {
  const listeners = new Set<(event: DeepLinkNavEvent) => void>();
  const dispatched: DeepLinkNav[] = [];
  let subscribed = 0;
  const dispose = connectDeepLinkNav({
    subscribe: (listener) => {
      subscribed++;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    takePending: () => pending.promise,
    dispatch: (nav) => dispatched.push(nav),
  });
  return {
    dispose,
    dispatched,
    subscribedCount: () => subscribed,
    emit: (event: DeepLinkNavEvent) => {
      for (const listener of listeners) listener(event);
    },
    hasListener: () => listeners.size > 0,
  };
}

const microtask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("connectDeepLinkNav", () => {
  it("subscribes BEFORE pulling, so a nav landing in the gap is caught", async () => {
    const pending = deferred();
    const h = harness(pending);
    // The subscription exists synchronously, before the pull resolved.
    expect(h.subscribedCount()).toBe(1);
    expect(h.hasListener()).toBe(true);
    // A nav lands while the pull is still in flight — the push catches it.
    h.emit({ id: "nav-2", nav: { kind: "today" } });
    pending.resolve(null);
    await microtask();
    expect(h.dispatched).toEqual([{ kind: "today" }]);
  });

  it("dedupes the pull/push overlap by id — the same nav runs once", async () => {
    const pending = deferred();
    const h = harness(pending);
    const event: DeepLinkNavEvent = { id: "nav-1", nav: { kind: "search", query: "x" } };
    // Pushed while subscribed AND still parked when the pull resolves.
    h.emit(event);
    pending.resolve(event);
    await microtask();
    expect(h.dispatched).toEqual([{ kind: "search", query: "x" }]);
  });

  it("dispatches a cold-launch parked nav delivered only via the pull", async () => {
    const pending = deferred();
    const h = harness(pending);
    pending.resolve({ id: "nav-7", nav: { kind: "note", target: "notes/x.md" } });
    await microtask();
    expect(h.dispatched).toEqual([{ kind: "note", target: "notes/x.md" }]);
  });

  it("nothing parked, nothing pushed — nothing dispatched", async () => {
    const pending = deferred();
    const h = harness(pending);
    pending.resolve(null);
    await microtask();
    expect(h.dispatched).toEqual([]);
  });

  it("dispose stops both channels", async () => {
    const pending = deferred();
    const h = harness(pending);
    h.dispose();
    expect(h.hasListener()).toBe(false);
    pending.resolve({ id: "nav-9", nav: { kind: "today" } });
    await microtask();
    expect(h.dispatched).toEqual([]);
  });

  it("distinct ids all dispatch, in order", async () => {
    const pending = deferred();
    const h = harness(pending);
    pending.resolve(null);
    h.emit({ id: "nav-1", nav: { kind: "today" } });
    h.emit({ id: "nav-2", nav: { kind: "search", query: "a" } });
    h.emit({ id: "nav-2", nav: { kind: "search", query: "a" } }); // duplicate push
    await microtask();
    expect(h.dispatched).toEqual([{ kind: "today" }, { kind: "search", query: "a" }]);
  });
});
