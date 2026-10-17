import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "@repo/workspace/test-support/inert-socket";
import { WorkspaceProvider } from "@repo/workspace/app/workspace-context";
import { ActionComposer } from "@repo/workspace/app/actions/action-composer";
import type { ComposerSelection } from "@repo/workspace/app/actions/action-composer";
import type { ActionPreset } from "@repo/domain/action-preset";
import { routePageFetch } from "./booted-fetch";
import { bootThreadHarness, fakeAgentAccounts } from "../../server/__tests__/boot-app";
import type { AgentStatus } from "@repo/contract/local/system/system-schema";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const noViewContext = async () => null;

const noteColumn = { current: document.body };

const ACP: AgentStatus = { mode: "acp", runtime: "ready" };
const SCRIPTED: AgentStatus = { mode: "scripted" };
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
  routePageFetch(harness);
  return harness;
};

const mountComposer = (seed: string | null = null): void => {
  render(
    <WorkspaceProvider>
      <ActionComposer
        open
        onOpenChange={() => {}}
        seed={seed}
        preset={null}
        selection={null}
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
    routePageFetch(harness);
    harness.driver.failNextStart = new Error("the provider fell over");

    const onOpenChange = vi.fn<(open: boolean) => void>();
    const onLaunched = vi.fn<(threadId: string) => void>();
    render(
      <WorkspaceProvider>
        <ActionComposer
          open
          onOpenChange={onOpenChange}
          seed={null}
          preset={null}
          selection={null}
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
    routePageFetch(harness);
    harness.driver.failNextStart = new Error("the provider fell over");

    const onLaunched = vi.fn<(threadId: string) => void>();
    const composerOver = (docPath: string, open = true) => (
      <WorkspaceProvider>
        <ActionComposer
          open={open}
          onOpenChange={() => {}}
          seed={null}
          preset={null}
          selection={null}
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
    routePageFetch(harness);
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
          preset={null}
          selection={null}
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
    const list = screen.getByRole("listbox", { name: "Mention an item" });
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

const LIBRARY_CONTEXT = {
  paths: ["Unsorted/a.md", "Unsorted/b.md"],
  scope: { kind: "unsorted" },
  selected: 2,
  surface: "library",
} as const;

const composerOverLibrary = (
  selection: ComposerSelection | null,
  preset: ActionPreset | null = null,
  onLaunched: (threadId: string) => void = () => {},
) => (
  <WorkspaceProvider>
    <ActionComposer
      open
      onOpenChange={() => {}}
      seed={null}
      preset={preset}
      docPath={null}
      selection={selection}
      readViewContext={async () =>
        await Promise.resolve({ ...LIBRARY_CONTEXT, paths: [...LIBRARY_CONTEXT.paths] })
      }
      onLaunched={onLaunched}
      container={noteColumn}
    />
  </WorkspaceProvider>
);

const bootManual = async () => {
  const harness = await bootThreadHarness({ mode: "manual" });
  vi.stubGlobal("WebSocket", InertSocket);
  routePageFetch(harness);
  return harness;
};

describe("the composer over the library", () => {
  it("names the selection in one chip and sends the library's view with the message", async () => {
    const harness = await bootManual();
    render(
      composerOverLibrary({
        all: false,
        paths: ["Unsorted/a.md", "Unsorted/b.md"],
        scope: { kind: "unsorted" },
        total: 2,
      }),
    );

    expect(await screen.findByText("2 items")).toBeDefined();
    const field = screen.getByRole("combobox", { name: "Ask the agent" });
    expect(field.getAttribute("placeholder")).toBe("Ask the agent… @ mentions an item");
    fireEvent.change(field, { target: { value: "Which of these are recipes?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(harness.driver.startedTurns).toHaveLength(1);
    });
    expect(harness.driver.startedTurns[0]?.viewContext).toEqual(LIBRARY_CONTEXT);
  });

  it("names the scope while nothing is selected, and every item of it under ⌘A", async () => {
    await bootManual();
    const view = render(
      composerOverLibrary({ all: false, paths: [], scope: { kind: "unsorted" }, total: 0 }),
    );
    expect(await screen.findByText("Unsorted")).toBeDefined();

    view.rerender(
      composerOverLibrary({ all: true, paths: [], scope: { kind: "unsorted" }, total: 40 }),
    );
    expect(await screen.findByText("All in Unsorted")).toBeDefined();
  });

  it("says that only the first 200 go along when more are selected", async () => {
    await bootManual();
    render(
      composerOverLibrary({
        all: true,
        paths: [],
        scope: { kind: "all" },
        total: 8512,
      }),
    );
    expect(
      await screen.findByText(
        "The first 200 selected items go with your message, along with the view you're in",
      ),
    ).toBeDefined();
  });

  it("sends no view once the chip is detached", async () => {
    const harness = await bootManual();
    render(composerOverLibrary({ all: false, paths: ["a.md"], scope: { kind: "all" }, total: 1 }));
    fireEvent.click(await screen.findByRole("button", { name: "Detach the library" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Ask the agent" }), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(harness.driver.startedTurns).toHaveLength(1);
    });
    expect(harness.driver.startedTurns[0]?.viewContext).toBeUndefined();
  });
});

describe("the composer opened on Tidy my library", () => {
  it("sends the preset with nothing typed, from Unsorted, and stores the label as the text", async () => {
    const harness = await bootManual();
    const onLaunched = vi.fn<(threadId: string) => void>();
    render(
      composerOverLibrary(
        { all: false, paths: [], scope: { kind: "all" }, total: 0 },
        "tidy-library",
        onLaunched,
      ),
    );

    expect(await screen.findByText("Tidy my library")).toBeDefined();
    const field = screen.getByRole("combobox", { name: "Ask the agent" });
    expect(field.getAttribute("placeholder")).toBe("Anything the rules don't say…");
    expect(screen.queryByText("All items")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(onLaunched).toHaveBeenCalledTimes(1);
    });
    const [turn] = harness.driver.startedTurns;
    expect(turn?.preset).toBe("tidy-library");
    expect(turn?.text).toBe("Tidy my library");
    expect(turn?.viewContext).toEqual({
      paths: [],
      scope: { kind: "unsorted" },
      selected: 0,
      surface: "library",
    });
  });

  it("becomes an ordinary ask once its chip is removed", async () => {
    await bootManual();
    render(
      composerOverLibrary(
        { all: false, paths: [], scope: { kind: "all" }, total: 0 },
        "tidy-library",
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Remove Tidy my library" }));
    expect(
      screen.getByRole("combobox", { name: "Ask the agent" }).getAttribute("placeholder"),
    ).toBe("Ask the agent… @ mentions an item");
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  });
});
