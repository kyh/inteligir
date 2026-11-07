import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, test } from "vitest";

import { OUTCOME_REASONS } from "../../messages";
import type { ExtensionRequest, Outcome, OutcomeReason } from "../../messages";
import { outcomeLine } from "../../outcome-copy";
import { Welcome } from "../welcome/app";
import { Popup } from "./app";

afterEach(cleanup);

const CONNECT_URL = "https://inteligir.com/connect/extension";
const LIBRARY_URL = "https://inteligir.com/library";
const WELCOME_URL = "chrome-extension://an-id/welcome.html";

const saved = (created: boolean): Outcome => ({ created, kind: "saved", title: "File over app" });
const refused = (reason: OutcomeReason): Outcome => ({ kind: "refused", reason });
const connected: Outcome = {
  connectUrl: CONNECT_URL,
  connection: { email: "reader@example.test", libraryUrl: LIBRARY_URL, manageUrl: WELCOME_URL },
  kind: "status",
};
const notConnected: Outcome = { connectUrl: CONNECT_URL, connection: null, kind: "status" };

// a worker that answers a save from the script and a status as the case says, and records what it
// was asked
const worker = (status: Outcome, ...answers: Outcome[]) => {
  const asked: ExtensionRequest[] = [];
  const ask = async (request: ExtensionRequest): Promise<Outcome> => {
    asked.push(request);
    return request.type === "save" ? (answers.shift() ?? refused("failed")) : status;
  };
  return { ask, asked };
};

const tabSeven = async (): Promise<number | null> => 7;

describe("the popup", () => {
  it("saves the tab it opened over, says it landed in Unsorted with its title, and links the library", async () => {
    const { ask, asked } = worker(connected, saved(true));
    render(<Popup activeTabId={tabSeven} ask={ask} />);
    await expect(screen.findByText("Saved to Unsorted")).resolves.toBeTruthy();
    expect(screen.getByText("File over app")).toBeTruthy();
    expect(screen.getByText("Open your library").closest("a")?.getAttribute("href")).toBe(
      LIBRARY_URL,
    );
    expect(asked).toStrictEqual([{ tabId: 7, type: "save" }, { type: "status" }]);
  });

  it("links the page whose Disconnect lets this browser go, while it is connected", async () => {
    render(<Popup activeTabId={tabSeven} ask={worker(connected, saved(true)).ask} />);
    const link = await screen.findByText("Manage connection");
    expect(link.closest("a")?.getAttribute("href")).toBe(WELCOME_URL);
    cleanup();
    render(
      <Popup activeTabId={tabSeven} ask={worker(notConnected, refused("not-connected")).ask} />,
    );
    await screen.findByText(outcomeLine(refused("not-connected")).text);
    expect(screen.queryByText("Manage connection")).toBeNull();
  });

  // the page mounts under StrictMode, which runs an effect twice in a development build: a second
  // save of the tab would answer that it is already in the library
  it("saves once under StrictMode, as the page mounts", async () => {
    const { ask, asked } = worker(connected, saved(true), saved(false));
    render(
      <StrictMode>
        <Popup activeTabId={tabSeven} ask={ask} />
      </StrictMode>,
    );
    await expect(screen.findByText("Saved to Unsorted")).resolves.toBeTruthy();
    expect(asked.filter((request) => request.type === "save")).toStrictEqual([
      { tabId: 7, type: "save" },
    ]);
  });

  it("says a page already saved is already in the library, and one that waits when it goes", async () => {
    render(<Popup activeTabId={tabSeven} ask={worker(connected, saved(false)).ask} />);
    await expect(screen.findByText("Already in your library")).resolves.toBeTruthy();
    cleanup();
    render(<Popup activeTabId={tabSeven} ask={worker(connected, { kind: "queued" }).ask} />);
    await expect(screen.findByText("Saved when you're back online")).resolves.toBeTruthy();
  });

  it("says every refusal in its own sentence, and links the connect page where connecting helps", async () => {
    for (const reason of OUTCOME_REASONS) {
      render(<Popup activeTabId={tabSeven} ask={worker(notConnected, refused(reason)).ask} />);
      const line = outcomeLine(refused(reason));
      const shown = await screen.findByText(line.text);
      // a line that links the connect page is that link; any other is an alert
      expect(
        line.connect ? shown.closest("a")?.getAttribute("href") : shown.getAttribute("role"),
        reason,
      ).toBe(line.connect ? CONNECT_URL : "alert");
      expect(screen.queryByText("Open your library")).toBeNull();
      cleanup();
    }
  });

  it("says what to do about a full library", async () => {
    render(
      <Popup activeTabId={tabSeven} ask={worker(notConnected, refused("library-full")).ask} />,
    );
    await expect(
      screen.findByText("Your library is full. Free some room to save"),
    ).resolves.toBeDefined();
  });

  it("says a tab it cannot save is not one it saves", async () => {
    const { ask, asked } = worker(connected);
    render(<Popup activeTabId={async () => null} ask={ask} />);
    await expect(
      screen.findByText(outcomeLine(refused("unsupported-page")).text),
    ).resolves.toBeTruthy();
    expect(asked).toStrictEqual([{ type: "status" }]);
  });
});

describe("the welcome page", () => {
  it("links the connect page while the browser holds no connection", async () => {
    render(<Welcome ask={worker(notConnected).ask} />);
    const link = await screen.findByText("Connect your library");
    expect(link.closest("a")?.getAttribute("href")).toBe(CONNECT_URL);
  });

  it("says whose library it saves to, and lets the connection go", async () => {
    const { ask, asked } = worker(connected);
    render(<Welcome ask={ask} />);
    await expect(
      screen.findByText("Saving to reader@example.test's library"),
    ).resolves.toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => {
      expect(asked.at(-1)).toStrictEqual({ type: "disconnect" });
    });
  });

  it("says a connection it could not read in its own words, never a save's", async () => {
    render(<Welcome ask={worker(refused("failed")).ask} />);
    const line = await screen.findByRole("alert");
    expect(line.textContent).not.toBe(outcomeLine(refused("failed")).text);
  });
});

// a component the compiler memoizes wrongly passes every other test and fails only in the browser.
// Welcome draws static parts, which the compiler caches behind its sentinel; the popup's mark is
// the memo cache it opens
test("holds the React Compiler's output for the extension's pages", () => {
  const plugin =
    "the extension vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/";
  expect(Welcome.toString(), plugin).toContain("react.memo_cache_sentinel");
  expect(Popup.toString(), plugin).toContain("const $ = ");
});
