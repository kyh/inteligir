// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createBridgeStore } from "../bridge-store";

afterEach(cleanup);

const fakeBridge = () => {
  const firstRead = Promise.withResolvers<number>();
  const pushes: ((state: number) => void)[] = [];
  const store = createBridgeStore<object, number>({
    bridge: () => ({}),
    label: "test",
    read: async () => await firstRead.promise,
    subscribe: (_bridge, adopt) => {
      pushes.push(adopt);
    },
  });
  const push = (state: number): void => {
    for (const adopt of pushes) {
      adopt(state);
    }
  };
  return { answerRead: firstRead.resolve, push, store };
};

describe("a bridge store", () => {
  it("adopts its first read", async () => {
    const { answerRead, store } = fakeBridge();
    const { result } = renderHook(store.use);
    expect(result.current).toEqual({ kind: "loading" });
    await act(async () => {
      answerRead(1);
    });
    expect(result.current).toEqual({ kind: "state", state: 1 });
  });

  it("keeps a pushed state over a first read that answers after it", async () => {
    const { answerRead, push, store } = fakeBridge();
    const { result } = renderHook(store.use);
    act(() => {
      push(2);
    });
    await act(async () => {
      answerRead(1);
    });
    expect(result.current).toEqual({ kind: "state", state: 2 });
  });
});
