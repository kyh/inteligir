import { toast } from "@repo/ui/components/sonner";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp, FAKE_ACCOUNT, FakeCloud } from "../../server/__tests__/boot-app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "@repo/workspace/test-support/inert-socket";
import { routePageFetch } from "./booted-fetch";
import { WorkspaceProvider } from "@repo/workspace/app/workspace-context";
import { AdvancedSection } from "@repo/workspace/app/settings/advanced-section";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Settings › Advanced's thread sync", () => {
  it("runs a sync when Sync threads now is pressed", async () => {
    const cloud = new FakeCloud();
    const booted = await bootTestApp({
      cloudTransport: { fetch: cloud.fetch, pollIntervalMs: null },
    });
    await booted.client.cloud.login(FAKE_ACCOUNT);
    vi.stubGlobal("WebSocket", InertSocket);
    routePageFetch(booted);
    const syncNow = vi.spyOn(booted.composed.context.cloud, "syncNow");
    const refused = vi.spyOn(toast, "error");
    render(
      <WorkspaceProvider>
        <AdvancedSection />
      </WorkspaceProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Sync threads now" }));

    await waitFor(() => {
      expect(syncNow).toHaveBeenCalledOnce();
    });
    expect(refused).not.toHaveBeenCalled();
  });
});
