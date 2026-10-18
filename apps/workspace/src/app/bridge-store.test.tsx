// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearShell, mockShell } from "../shell/test-support/mock-shell";
import { createBridgeStore } from "./bridge-store";

afterEach(() => {
  cleanup();
  clearShell();
});

const fakeStore = () => {
  const firstRead = Promise.withResolvers<number>();
  const read = vi.fn<() => Promise<number>>(async () => await firstRead.promise);
  const pushes: ((state: number) => void)[] = [];
  const store = createBridgeStore<number>({
    label: "test",
    read,
    subscribe: (adopt) => {
      pushes.push(adopt);
    },
  });
  const push = (state: number): void => {
    for (const adopt of pushes) {
      adopt(state);
    }
  };
  return { answerRead: firstRead.resolve, push, read, store };
};

describe("a bridge store", () => {
  it("adopts its first read", async () => {
    mockShell();
    const { answerRead, store } = fakeStore();
    const { result } = renderHook(store.use);
    expect(result.current).toEqual({ kind: "loading" });
    await act(async () => {
      answerRead(1);
    });
    expect(result.current).toEqual({ kind: "state", state: 1 });
  });

  it("keeps a pushed state over a first read that answers after it", async () => {
    mockShell();
    const { answerRead, push, store } = fakeStore();
    const { result } = renderHook(store.use);
    act(() => {
      push(2);
    });
    await act(async () => {
      answerRead(1);
    });
    expect(result.current).toEqual({ kind: "state", state: 2 });
  });

  it("says there is no shell outside it, and asks nothing", () => {
    const { read, store } = fakeStore();
    const { result } = renderHook(store.use);
    expect(result.current).toEqual({ kind: "no-bridge" });
    expect(read).not.toHaveBeenCalled();
  });
});
