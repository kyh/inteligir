import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bootTestApp, fakeAgentAccounts } from "inteligir/server/testing";
import type { BootedTestApp } from "inteligir/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InertSocket } from "../../__tests__/inert-socket";
import { routeRendererFetch } from "../../actions/__tests__/booted-fetch";
import { WorkspaceProvider } from "../../workspace-context";
import { AgentSignIn } from "../agent-sign-in";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AUTH_URL = "https://claude.test/oauth/authorize?code=true";
const PAGE_CODE = "page-code#page-state";

const bootSignedOut = async (signIn: { authUrl?: string; refusal?: string } = {}) => {
  const booted = await bootTestApp({
    accounts: fakeAgentAccounts(
      { claude: { state: "signed-out" }, codex: { state: "signed-out" } },
      signIn,
    ),
  });
  vi.stubGlobal("WebSocket", InertSocket);
  routeRendererFetch(booted);
  return booted;
};

const claudeState = async (booted: BootedTestApp) => {
  const status = await booted.client.agents.status();
  const claude = status.harnesses.find((harness) => harness.id === "claude");
  return claude?.runtime === "bundled" ? claude.account.state : null;
};

const mount = (): void => {
  render(
    <WorkspaceProvider>
      <AgentSignIn />
    </WorkspaceProvider>,
  );
};

describe("the sign-in offer", () => {
  it("leads with Claude and keeps ChatGPT under Other", async () => {
    await bootSignedOut();
    mount();

    expect(await screen.findByRole("button", { name: "Sign in with Claude" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in with ChatGPT" })).toBeNull();

    const other = screen.getByRole("button", { name: "Other" });
    expect(other.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(other);
    expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeDefined();
  });

  it("leads with the agent new actions start on", async () => {
    const booted = await bootSignedOut();
    await booted.client.agents.setDefault({ id: "codex" });
    mount();

    expect(await screen.findByRole("button", { name: "Sign in with ChatGPT" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in with Claude" })).toBeNull();
  });
});

describe("a sign-in in the browser", () => {
  it("waits, offers the page and its code, and finishes with the pasted code", async () => {
    const booted = await bootSignedOut({ authUrl: AUTH_URL });
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Claude" }));
    expect(await screen.findByText("Finish signing in in your browser.")).toBeDefined();
    const page = await screen.findByRole("link", { name: "Open the sign-in page" });
    expect(page.getAttribute("href")).toBe(AUTH_URL);

    fireEvent.click(screen.getByRole("button", { name: "Paste the code" }));
    fireEvent.change(screen.getByLabelText("Code from the sign-in page"), {
      target: { value: ` ${PAGE_CODE} ` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    // signed in, Claude is offered no more: ChatGPT, still signed out, leads the offer
    expect(await screen.findByRole("button", { name: "Sign in with ChatGPT" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Sign in with Claude" })).toBeNull();
    expect(await claudeState(booted)).toBe("signed-in");
  });

  it("says a code is not whole, and keeps waiting for the rest", async () => {
    const booted = await bootSignedOut({ authUrl: AUTH_URL });
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Claude" }));
    fireEvent.click(await screen.findByRole("button", { name: "Paste the code" }));
    fireEvent.change(screen.getByLabelText("Code from the sign-in page"), {
      target: { value: "page-code" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("That isn't the whole code. Copy all of it from the sign-in page."),
    ).toBeDefined();
    expect(screen.getByText("Finish signing in in your browser.")).toBeDefined();
    expect(await claudeState(booted)).toBe("signed-out");
  });

  it("cancels, and offers the sign-in again", async () => {
    const booted = await bootSignedOut();
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Claude" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("button", { name: "Sign in with Claude" })).toBeDefined();
    const status = await booted.client.agents.status();
    expect(status.signingIn).toBeNull();
  });

  it("says why a sign-in failed, and offers it again", async () => {
    await bootSignedOut({ refusal: "Claude could not finish signing in: Login failed" });
    mount();

    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Claude" }));

    expect(
      await screen.findByText("Claude could not finish signing in: Login failed"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});
