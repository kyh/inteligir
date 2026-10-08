import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "../../__tests__/inert-socket";
import { WorkspaceProvider } from "../../workspace-context";
import { ActionComposer } from "../action-composer";
import { routeRendererFetch } from "./booted-fetch";
import { bootThreadHarness } from "inteligir/server/testing";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const centreColumn = { current: document.body };

const mountComposer = (): void => {
  render(
    <WorkspaceProvider>
      <ActionComposer open onOpenChange={() => {}} onLaunched={() => {}} container={centreColumn} />
    </WorkspaceProvider>,
  );
};

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const mountUnder = async (userAgent: string): Promise<void> => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  const harness = await bootThreadHarness({ mode: "manual" });
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(harness);
  mountComposer();
  await screen.findByLabelText("Ask the agent");
};

describe("the composer's field", () => {
  it("takes focus as it opens", async () => {
    await mountUnder(MAC_UA);
    const field = screen.getByLabelText("Ask the agent");
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
  });
});

describe("the composer's dictation hint", () => {
  it("tells a Mac that fn twice dictates", async () => {
    await mountUnder(MAC_UA);
    expect(screen.getByText("fn fn to dictate")).toBeDefined();
  });

  it("says nothing off a Mac, which has no fn twice", async () => {
    await mountUnder(WINDOWS_UA);
    expect(screen.queryByText("fn fn to dictate")).toBeNull();
  });
});

describe("the composer under a refused first send", () => {
  it("keeps the prompt and retries into the already-created thread", async () => {
    const harness = await bootThreadHarness({ mode: "manual" });
    vi.stubGlobal("WebSocket", InertSocket);
    routeRendererFetch(harness);
    harness.driver.failNextStart = new Error("the provider fell over");

    const onOpenChange = vi.fn<(open: boolean) => void>();
    const onLaunched = vi.fn<(threadId: string) => void>();
    render(
      <WorkspaceProvider>
        <ActionComposer
          open
          onOpenChange={onOpenChange}
          onLaunched={onLaunched}
          container={centreColumn}
        />
      </WorkspaceProvider>,
    );

    const field = await screen.findByLabelText("Ask the agent");
    fireEvent.change(field, { target: { value: "Tidy the intro" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(async () => {
      const listed = await harness.client.threads.list({});
      expect(listed.threads).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
    });
    expect(screen.getByLabelText("Ask the agent")).toHaveProperty("value", "Tidy the intro");
    expect(onLaunched).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(onLaunched).toHaveBeenCalledTimes(1);
    });

    const { threads } = await harness.client.threads.list({});
    expect(threads).toHaveLength(1);
    expect(onLaunched).toHaveBeenCalledWith(threads[0]?.id);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(harness.driver.startedTurns.map((turn) => turn.threadId)).toEqual([threads[0]?.id]);
  });
});
