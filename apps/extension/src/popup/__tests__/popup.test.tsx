import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PRODUCTION_CLOUD_ORIGIN } from "@repo/contract/cloud/origin";
import { afterEach, describe, expect, it } from "vitest";
import { OUTCOME_REASONS } from "../../messages";
import type { ExtensionRequest, Outcome, OutcomeReason } from "../../messages";
import { refusalCopy } from "../../outcome-copy";
import { Welcome } from "../../welcome/welcome";
import { Popup } from "../popup";

afterEach(cleanup);

const saved = (created: boolean): Outcome => ({
  created,
  kind: "saved",
  path: "Unsorted/File over app.md",
  title: "File over app",
});

const refused = (reason: OutcomeReason): Outcome => ({ detail: "", kind: "refused", reason });

// a worker that answers each request in turn from the script, and records what it was asked
const worker = (...answers: Outcome[]) => {
  const asked: ExtensionRequest[] = [];
  const ask = async (request: ExtensionRequest): Promise<Outcome> => {
    asked.push(request);
    return answers.shift() ?? refused("failed");
  };
  return { ask, asked };
};

const tabSeven = async (): Promise<number | null> => 7;

describe("the popup", () => {
  it("saves the tab it opened over and says it landed in Unsorted, with the title", async () => {
    const { ask, asked } = worker(saved(true));
    render(<Popup activeTabId={tabSeven} ask={ask} />);
    expect(await screen.findByText("Saved to Unsorted")).toBeTruthy();
    expect(screen.getByText("File over app")).toBeTruthy();
    expect(asked).toEqual([{ tabId: 7, type: "save" }]);
  });

  it("says a page already saved is already in the library", async () => {
    const { ask } = worker(saved(false));
    render(<Popup activeTabId={tabSeven} ask={ask} />);
    expect(await screen.findByText("Already in your library")).toBeTruthy();
  });

  it("keeps a copy of the page once, by saving the tab again with it", async () => {
    const { ask, asked } = worker(saved(true), saved(false));
    render(<Popup activeTabId={tabSeven} ask={ask} />);
    const toggle = await screen.findByRole("switch", { name: "Keep a copy of the page" });
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(asked).toEqual([
        { tabId: 7, type: "save" },
        { keepCopy: true, tabId: 7, type: "save" },
      ]);
    });
    expect(screen.getByText("Saved to Unsorted")).toBeTruthy();
  });

  it("opens the app", async () => {
    const { ask, asked } = worker(saved(true), { kind: "opened" });
    render(<Popup activeTabId={tabSeven} ask={ask} />);
    await screen.findByText("Saved to Unsorted");
    fireEvent.click(screen.getByRole("button", { name: "Open Inteligir" }));
    await waitFor(() => {
      expect(asked.at(-1)).toEqual({ type: "open-app" });
    });
  });

  it("says every refusal in its own sentence, and links the download when no app answers", async () => {
    for (const reason of OUTCOME_REASONS) {
      const { ask } = worker(refused(reason));
      render(<Popup activeTabId={tabSeven} ask={ask} />);
      const line = await screen.findByText(refusalCopy(reason).text);
      if (reason === "absent") {
        expect(line.closest("a")?.getAttribute("href")).toBe(PRODUCTION_CLOUD_ORIGIN);
      } else {
        expect(line.getAttribute("role")).toBe("alert");
      }
      expect(screen.queryByRole("switch")).toBeNull();
      cleanup();
    }
  });

  it("says a tab it cannot save is not one it saves", async () => {
    const { ask, asked } = worker();
    render(<Popup activeTabId={async () => null} ask={ask} />);
    expect(await screen.findByText(refusalCopy("unsupported-page").text)).toBeTruthy();
    expect(asked).toEqual([]);
  });
});

describe("the welcome page", () => {
  it("says which library it reached", async () => {
    const { ask, asked } = worker({ appVersion: "1.0.0", kind: "hello", library: "Inteligir" });
    render(<Welcome ask={ask} />);
    expect(await screen.findByText("Connected to Inteligir")).toBeTruthy();
    expect(asked).toEqual([{ type: "hello" }]);
  });

  it("links the download when no app answers", async () => {
    const { ask } = worker(refused("absent"));
    render(<Welcome ask={ask} />);
    const link = await screen.findByText("Get Inteligir for Mac");
    expect(link.closest("a")?.getAttribute("href")).toBe(PRODUCTION_CLOUD_ORIGIN);
  });
});

// a component the compiler memoizes wrongly passes every other test and fails only in the browser.
// Welcome draws static parts, which the compiler caches behind its sentinel; the popup has none,
// so its mark is the memo cache it opens
it("holds the React Compiler's output for the extension's pages", () => {
  const plugin =
    "the extension vitest project must run @vitejs/plugin-react with the compiler over src/";
  expect(Welcome.toString(), plugin).toContain("react.memo_cache_sentinel");
  expect(Popup.toString(), plugin).toContain("const $ = ");
});
