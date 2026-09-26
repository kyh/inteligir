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
});

const noViewContext = async () => null;

const noteColumn = { current: document.body };

const ACP: AgentStatus = { detail: null, mode: "auto", runtime: "acp" };
const SCRIPTED: AgentStatus = { detail: null, mode: "scripted", runtime: "scripted" };
const AUTH_URL = "https://claude.test/oauth/authorize?code=true";
// longer than the vendors take to answer the agents' status
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
  it("draws no field before the statuses answer, so the sign-in never takes one away", async () => {
    await bootAgent(ACP, "signed-out");
    mountComposer("Tidy the intro");

    expect(screen.queryByRole("combobox", { name: "Ask the agent" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Sign in with Claude" })).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "Ask the agent" })).toBeNull();
  });

  it("puts focus in the field it held until the statuses answered", async () => {
    await bootAgent(ACP, "signed-in");
    mountComposer("Tidy the intro");

    expect(screen.queryByRole("combobox", { name: "Ask the agent" })).toBeNull();
    const field = await screen.findByRole("combobox", { name: "Ask the agent" });
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
    expect(field).toHaveProperty("selectionStart", "Tidy the intro".length);
  });

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
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
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
    // a vendor's answer lands after the runtime's, so the sign-in is given the time it would take.
    await expect(
      screen.findByRole("button", { name: "Sign in with Claude" }, { timeout: SETTLE_MS }),
    ).rejects.toThrow();
    expect(screen.getByRole("combobox", { name: "Ask the agent" })).toBeDefined();
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
    fireEvent.change(await screen.findByLabelText("Ask the agent"), {
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
    fireEvent.click(await screen.findByRole("button", { name: "Send" }));
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

    const field = await screen.findByRole("combobox", { name: "Ask the agent" });
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
