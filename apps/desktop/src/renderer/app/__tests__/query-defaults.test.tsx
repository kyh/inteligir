// @vitest-environment jsdom
// react-query's own refetch triggers are a full vault walk and a `git status` per window focus.

import { QueryClientProvider, focusManager, useQuery } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceQueryClient } from "../workspace-context";

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
});

const settle = (): Promise<void> => act(async () => {});

function mountCounted(options: { staleTime?: number } = {}) {
  const client = createWorkspaceQueryClient();
  let fetches = 0;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const useCounted = () =>
    useQuery({
      queryKey: ["counted"],
      queryFn: () => {
        fetches += 1;
        return Promise.resolve(fetches);
      },
      ...options,
    });
  return { wrapper, useCounted, fetches: () => fetches };
}

describe("the workspace query client", () => {
  it("does not re-fetch a bus-driven query on focus, reconnect or remount", async () => {
    const { wrapper, useCounted, fetches } = mountCounted();
    const first = renderHook(useCounted, { wrapper });
    await settle();
    expect(fetches()).toBe(1);

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await settle();
    expect(fetches()).toBe(1);

    const second = renderHook(useCounted, { wrapper });
    await settle();
    expect(fetches()).toBe(1);

    first.unmount();
    second.unmount();
    renderHook(useCounted, { wrapper });
    await settle();
    expect(fetches()).toBe(1);
  });

  it("lets a query the bus does NOT cover opt back in per call", async () => {
    const { wrapper, useCounted, fetches } = mountCounted({ staleTime: 0 });
    const first = renderHook(useCounted, { wrapper });
    await settle();
    expect(fetches()).toBe(1);

    first.unmount();
    renderHook(useCounted, { wrapper });
    await settle();
    expect(fetches()).toBe(2);
  });
});
