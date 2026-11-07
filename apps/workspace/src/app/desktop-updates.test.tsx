// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearShell, mockShell } from "../shell/test-support/mock-shell";
import type { UpdateState } from "../shell/update-state";
import { createUpdatesStore } from "./desktop-updates";

afterEach(() => {
  cleanup();
  clearShell();
});

const idle: UpdateState = { checkedAt: null, currentVersion: "1.0.0", status: "idle" };
const checking: UpdateState = { checkedAt: null, currentVersion: "1.0.0", status: "checking" };

const fakeStore = () => {
  const firstRead = Promise.withResolvers<UpdateState>();
  const read = vi.fn<() => Promise<UpdateState>>(async () => await firstRead.promise);
  const pushes: ((state: UpdateState) => void)[] = [];
  const store = createUpdatesStore({
    getState: read,
    onState: (adopt) => {
      pushes.push(adopt);
      return () => {};
    },
  });
  const push = (state: UpdateState): void => {
    for (const adopt of pushes) {
      adopt(state);
    }
  };
  return { answerRead: firstRead.resolve, push, read, store };
};

describe("the updates store", () => {
  it("adopts its first read", async () => {
    mockShell();
    const { answerRead, store } = fakeStore();
    const { result } = renderHook(store.use);
    expect(result.current).toStrictEqual({ kind: "loading" });
    await act(async () => {
      answerRead(idle);
    });
    expect(result.current).toStrictEqual({ kind: "state", state: idle });
  });

  it("keeps a pushed state over a first read that answers after it", async () => {
    mockShell();
    const { answerRead, push, store } = fakeStore();
    const { result } = renderHook(store.use);
    act(() => {
      push(checking);
    });
    await act(async () => {
      answerRead(idle);
    });
    expect(result.current).toStrictEqual({ kind: "state", state: checking });
  });

  it("says there is no shell outside it, and asks nothing", () => {
    const { read, store } = fakeStore();
    const { result } = renderHook(store.use);
    expect(result.current).toStrictEqual({ kind: "no-bridge" });
    expect(read).not.toHaveBeenCalled();
  });
});
