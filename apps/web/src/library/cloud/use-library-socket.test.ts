// @vitest-environment jsdom

import { createLibrarySocket } from "@repo/client/library-cache";
import { fakeSockets } from "@repo/client/test-support/fake-sockets";
import { onlineManager } from "@tanstack/react-query";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakePageLibrary } from "../test-support/fake-page-library";
import { useLibrarySocket } from "./use-library-socket";
import { createPageQueryClient } from "./v1";

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("the account's socket while the page shows the library", () => {
  it("dials nothing while the browser is offline, and at once when it is back", async () => {
    const { sockets, WebSocket } = fakeSockets();
    const page = fakePageLibrary();
    const socket = createLibrarySocket({
      client: page.library.wire.client,
      origin: "https://library.test",
      queries: page.library.wire.orpc,
      queryClient: createPageQueryClient(),
      WebSocket,
    });
    onlineManager.setOnline(false);
    const shown = renderHook(() => {
      useLibrarySocket(socket);
    });
    expect(page.calls).toStrictEqual([]);

    onlineManager.setOnline(true);
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    sockets[0]?.open();
    onlineManager.setOnline(false);
    expect(sockets[0]?.closed).toBe(true);

    onlineManager.setOnline(true);
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(2);
    });
    shown.unmount();
    expect(sockets[1]?.closed).toBe(true);
  });
});
