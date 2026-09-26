import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "../../__tests__/inert-socket";
import { WorkspaceProvider } from "../../workspace-context";
import { ActionComposer } from "../action-composer";
import { routeRendererFetch } from "./booted-fetch";
import { bootThreadHarness, fakeAgentAccounts } from "inteligir/server/testing";
import type { AgentStatus } from "@repo/api/local/system/system-schema";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const noViewContext = async () => null;

const noteColumn = { current: document.body };

const ACP: AgentStatus = { detail: null, mode: "auto", runtime: "acp" };
const SCRIPTED: AgentStatus = { detail: null, mode: "scripted", runtime: "scripted" };
const AUTH_URL = "https://claude.test/oauth/authorize?code=true";
// longer than a signed-out agent's sign-in takes to replace the field
const SETTLE_MS = 2000;

const bootAgent = async (agent: AgentStatus, claude: "signed-in" | "signed-out") => {
  const harness = await bootThreadHarness(
    { mode: "manual" },
    {
      accounts: fakeAgentAccounts(
        claude === "signed-out" ? { claude: { state: "signed-out" } } : {},
        { authUrl: AUTH_URL },
      ),
      agent,
    },
  );
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(harness);
  return harness;
};

const mountComposer = (seed: string | null = null): void => {
  render(
    <WorkspaceProvider>
      <ActionComposer
        open
        onOpenChange={() => {}}
        seed={seed}
        docPath={null}
        readViewContext={noViewContext}
        onLaunched={() => {}}
        container={noteColumn}
      />
    </WorkspaceProvider>,
  );
};

describe("the composer over the default agent's sign-in", () => {
  it("offers the sign-in in place of the field while the agent is signed out", async () => {
    const harness = await bootAgent(ACP, "signed-out");
    mountComposer("Tidy the intro");

    expect(await screen.findByRole("button", { name: "Sign in with Claude" })).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Ask the agent" })).toBeNull();
    const { threads } = await harness.client.threads.list({});
    expect(threads).toEqual([]);
  });

  it("shows the field, keeping what was seeded, once the sign-in finishes", async () => {
    await bootAgent(ACP, "signed-out");
    mountComposer("Tidy the intro");

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Claude" }));
    fireEvent.click(await screen.findByRole("button", { name: "Paste the code" }));
    fireEvent.change(screen.getByLabelText("Code from the sign-in page"), {
      target: { value: "page-code#page-state" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const field = await screen.findByRole("combobox", { name: "Ask the agent" });
    expect(field).toHaveProperty("value", "Tidy the intro");
  });

  it("shows the field while the agent is signed in", async () => {
    await bootAgent(ACP, "signed-in");
    mountComposer();

    expect(await screen.findByRole("combobox", { name: "Ask the agent" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in with Claude" })).toBeNull();
  });

  it("shows the field to a scripted agent, which needs no sign-in", async () => {
    await bootAgent(SCRIPTED, "signed-out");
    mountComposer();

    expect(await screen.findByRole("combobox", { name: "Ask the agent" })).toBeDefined();
    // the field shows while the statuses load, so the sign-in is given the time it takes to arrive.
    await expect(
      screen.findByRole("button", { name: "Sign in with Claude" }, { timeout: SETTLE_MS }),
    ).rejects.toThrow();
    expect(screen.getByRole("combobox", { name: "Ask the agent" })).toBeDefined();
  });
});

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const mountUnder = async (userAgent: string): Promise<void> => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  await bootAgent(SCRIPTED, "signed-in");
  mountComposer();
  await screen.findByRole("combobox", { name: "Ask the agent" });
};

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
          seed={null}
          docPath={null}
          readViewContext={noViewContext}
          onLaunched={onLaunched}
          container={noteColumn}
        />
      </WorkspaceProvider>,
    );

    const field = screen.getByLabelText("Ask the agent");
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

  it("mints a fresh thread when the retry is over another note", async () => {
    const harness = await bootThreadHarness({ mode: "manual" });
    vi.stubGlobal("WebSocket", InertSocket);
    routeRendererFetch(harness);
    harness.driver.failNextStart = new Error("the provider fell over");

    const onLaunched = vi.fn<(threadId: string) => void>();
    const composerOver = (docPath: string, open = true) => (
      <WorkspaceProvider>
        <ActionComposer
          open={open}
          onOpenChange={() => {}}
          seed={null}
          docPath={docPath}
          readViewContext={noViewContext}
          onLaunched={onLaunched}
          container={noteColumn}
        />
      </WorkspaceProvider>
    );
    const view = render(composerOver("a.md"));
    fireEvent.change(screen.getByLabelText("Ask the agent"), {
      target: { value: "Tidy the intro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(async () => {
      const listed = await harness.client.threads.list({});
      expect(listed.threads).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
    });

    view.rerender(composerOver("a.md", false));
    view.rerender(composerOver("b.md"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(onLaunched).toHaveBeenCalledTimes(1);
    });

    const { threads } = await harness.client.threads.list({});
    expect(threads).toHaveLength(2);
    const started = harness.driver.startedTurns.map((turn) => turn.threadId);
    expect(started).toHaveLength(1);
    expect(threads.find((thread) => thread.id === started[0])?.originDocPath).toBe("b.md");
  });
});

describe("the composer's @-mentions", () => {
  it("ride the send beside the typed text, never inside it", async () => {
    const harness = await bootThreadHarness({ mode: "manual" });
    vi.stubGlobal("WebSocket", InertSocket);
    routeRendererFetch(harness);
    await harness.client.vault.write({
      content: "# Plans\n",
      guard: { kind: "overwrite" },
      path: "Plans.md",
    });

    render(
      <WorkspaceProvider>
        <ActionComposer
          open
          onOpenChange={() => {}}
          seed={null}
          docPath={null}
          readViewContext={noViewContext}
          onLaunched={() => {}}
          container={noteColumn}
        />
      </WorkspaceProvider>,
    );

    const field = screen.getByRole("combobox", { name: "Ask the agent" });
    expect(field.getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(field, { target: { value: "@Pla" } });
    const option = await screen.findByRole("option", { name: /Plans/u });
    const list = screen.getByRole("listbox", { name: "Mention a note" });
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(field.getAttribute("aria-controls")).toBe(list.id);
    expect(field.getAttribute("aria-activedescendant")).toBe(option.id);
    expect(option.tabIndex).toBe(-1);

    fireEvent.mouseDown(option);
    fireEvent.change(field, { target: { value: "compare with the goals" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(harness.driver.startedTurns).toHaveLength(1);
    });
    expect(harness.driver.startedTurns[0]?.text).toBe("compare with the goals");
    expect(harness.driver.startedTurns[0]?.contextPaths).toEqual(["Plans.md"]);
    const { threads } = await harness.client.threads.list({});
    const [thread] = threads;
    expect(thread?.title).toBe("compare with the goals");
    const timeline = await harness.client.threads.timeline({ threadId: thread?.id ?? "" });
    const stored = timeline.kind === "full" ? timeline.timeline.rows[0] : undefined;
    expect(stored?.kind === "conversation" && stored.text).toBe("compare with the goals");
    expect(stored?.kind === "conversation" && stored.contextPaths).toEqual(["Plans.md"]);
  });
});
