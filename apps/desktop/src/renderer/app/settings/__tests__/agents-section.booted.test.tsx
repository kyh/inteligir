import path from "node:path";
import type { VendorAccount } from "@repo/api/local/agents/agents-schema";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import { ConfirmDialogHost } from "@repo/ui/components/confirm-dialog";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { bootTestApp, fakeAgentAccounts, makeTempDir } from "inteligir/server/testing";
import type { BootTestAppOptions } from "inteligir/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "../../__tests__/inert-socket";
import { routeRendererFetch } from "../../actions/__tests__/booted-fetch";
import { WorkspaceProvider } from "../../workspace-context";
import { AgentsSection } from "../agents-section";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// the words a knowledge worker never meets in this section, whatever state it is in
const DEVELOPER_WORDS = /CLI|PATH|terminal|harness|adapter|command|run:/u;

const CLAUDE_MAX: VendorAccount = {
  email: "ada@example.com",
  label: "Claude Max",
  state: "signed-in",
};

const boot = async (options: BootTestAppOptions) => {
  const booted = await bootTestApp(options);
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(booted);
  render(
    <WorkspaceProvider>
      <AgentsSection />
      <ConfirmDialogHost />
    </WorkspaceProvider>,
  );
  return booted;
};

const pageText = (): string => document.body.textContent;

const follows = (before: HTMLElement | undefined, after: HTMLElement | undefined): boolean => {
  const paragraphs = [...document.querySelectorAll<HTMLElement>("p")];
  return (
    before !== undefined &&
    after !== undefined &&
    paragraphs.indexOf(before) < paragraphs.indexOf(after)
  );
};

describe("Settings › Agent", () => {
  it("shows Claude first and ChatGPT under Other", async () => {
    await boot({
      accounts: fakeAgentAccounts({ claude: CLAUDE_MAX, codex: { state: "signed-out" } }),
    });

    expect(await screen.findByText("Signed in · Claude Max · ada@example.com")).toBeDefined();
    const [claude, other, chatGpt] = ["Claude", "Other", "ChatGPT"].map((name) =>
      screen.getByText(name),
    );
    expect(follows(claude, other)).toBe(true);
    expect(follows(other, chatGpt)).toBe(true);
    expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeDefined();
  });

  it("offers Use for new actions only on a signed-in card that is not already used", async () => {
    const booted = await boot({ accounts: fakeAgentAccounts({ codex: { state: "signed-out" } }) });

    await screen.findByRole("button", { name: "Sign out of Claude" });
    expect(screen.queryByRole("button", { name: "Use for new actions" })).toBeNull();
    cleanup();

    await booted.client.agents.setDefault({ id: "codex" });
    render(
      <WorkspaceProvider>
        <AgentsSection />
      </WorkspaceProvider>,
    );
    expect(await screen.findByRole("button", { name: "Use for new actions" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Use for new actions" }));
    await waitFor(async () => {
      const status = await booted.client.agents.status();
      expect(status.defaultId).toBe("claude");
    });
  });

  it("confirms a sign-out by saying the vendor's own app signs out with it", async () => {
    const booted = await boot({ accounts: fakeAgentAccounts({ claude: CLAUDE_MAX }) });

    expect(await screen.findByText("Signed in · Claude Max · ada@example.com")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Sign out of Claude" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("This also signs Claude Code out on this Mac");
    fireEvent.click(screen.getByRole("button", { name: "Sign out of Claude" }));

    expect(await screen.findByRole("button", { name: "Sign in with Claude" })).toBeDefined();
    const status = await booted.client.agents.status();
    const claude = status.harnesses.find((harness) => harness.id === "claude");
    expect(claude?.runtime === "bundled" && claude.account.state).toBe("signed-out");
  });

  it.each<[string, AgentStatus]>([
    ["ready", { detail: null, mode: "auto", runtime: "acp" }],
    ["off", { detail: "The agent is disabled (INTELIGIR_AGENT=off)", mode: "off", runtime: "off" }],
    ["scripted", { detail: null, mode: "scripted", runtime: "scripted" }],
    [
      "unavailable",
      {
        detail: "This copy of inteligir is missing its ChatGPT runtime — reinstall it",
        mode: "auto",
        runtime: "unavailable",
      },
    ],
  ])("says nothing a developer would, with the agent %s", async (_state, agent) => {
    vi.stubEnv("CODEX_PATH", path.join(makeTempDir("agents-section-missing-"), "codex"));
    await boot({
      accounts: fakeAgentAccounts({ claude: { detail: "timed out", state: "unknown" } }),
      agent,
    });

    expect(await screen.findByText(/missing it\. Reinstall the app/u)).toBeDefined();
    expect(screen.getByText("Couldn't tell whether it's signed in.")).toBeDefined();
    expect(pageText()).not.toMatch(DEVELOPER_WORDS);
  });
});
