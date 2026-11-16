import { deferred } from "@repo/contract/deferred";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, test } from "vitest";

import { OUTCOME_REASONS } from "../../messages";
import type { ExtensionRequest, Outcome, OutcomeReason, Status, WorkerAsks } from "../../messages";
import { outcomeLine } from "../../outcome-copy";
import { Welcome } from "../welcome/app";
import { Popup, saveOpenedTab } from "./app";

afterEach(cleanup);

const SIGN_IN_URL = "https://inteligir.com/app/sign-in";
const LIBRARY_URL = "https://inteligir.com/library";

const saved = (created: boolean): Outcome => ({ created, kind: "saved", title: "File over app" });
const refused = (reason: OutcomeReason): Outcome => ({ kind: "refused", reason });
const signedIn: Status = {
  account: { email: "reader@example.test", libraryUrl: LIBRARY_URL },
  signInUrl: SIGN_IN_URL,
};
const signedOut: Status = { account: null, signInUrl: SIGN_IN_URL };

// a worker that answers a save from the script and a status as the case says, null being none it
// could read, and records what it was asked
const worker = (status: Status | null, ...answers: Outcome[]) => {
  const asked: ExtensionRequest[] = [];
  const ask: WorkerAsks = {
    save: async (tabId) => {
      asked.push({ tabId, type: "save" });
      return answers.shift() ?? refused("failed");
    },
    status: async () => {
      asked.push({ type: "status" });
      return status;
    },
  };
  return { ask, asked };
};

const tabSeven = async (): Promise<number | null> => 7;

// the popup as its page opens it: over the one save its opening makes, which it suspends on as it
// mounts, so React asks that the mount be awaited
const openPopup = async (
  ask: WorkerAsks,
  activeTabId: () => Promise<number | null> = tabSeven,
): Promise<void> => {
  const opened = saveOpenedTab(activeTabId, ask);
  await act(async () => {
    render(<Popup opened={opened} />);
  });
};

describe("the popup", () => {
  it("saves the tab it opened over, says it landed in Unsorted with its title, and links the library", async () => {
    const { ask, asked } = worker(signedIn, saved(true));
    await openPopup(ask);
    await expect(screen.findByText("Saved to Unsorted")).resolves.toBeTruthy();
    expect(screen.getByText("File over app")).toBeTruthy();
    expect(screen.getByText("Open your library").closest("a")?.getAttribute("href")).toBe(
      LIBRARY_URL,
    );
    expect(asked).toStrictEqual([{ tabId: 7, type: "save" }, { type: "status" }]);
  });

  it("says who the browser is signed in as, and offers no sign-out of its own", async () => {
    await openPopup(worker(signedIn, saved(true)).ask);
    await expect(screen.findByText("Signed in as reader@example.test")).resolves.toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    await openPopup(worker(signedOut, refused("not-connected")).ask);
    await screen.findByText(outcomeLine(refused("not-connected")).text);
    expect(screen.queryByText(/Signed in as/u)).toBeNull();
  });

  it("says it is saving until the worker answers", async () => {
    const held = deferred();
    const { ask } = worker(signedIn, saved(true));
    await openPopup({
      ...ask,
      save: async (tabId) => {
        await held.promise;
        return await ask.save(tabId);
      },
    });
    await expect(screen.findByText("Saving…")).resolves.toBeTruthy();
    held.resolve();
    await expect(screen.findByText("Saved to Unsorted")).resolves.toBeTruthy();
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("says a page already saved is already in the library, and one that waits when it goes", async () => {
    await openPopup(worker(signedIn, saved(false)).ask);
    await expect(screen.findByText("Already in your library")).resolves.toBeTruthy();
    cleanup();
    await openPopup(worker(signedIn, { kind: "queued", waitsFor: "connection" }).ask);
    await expect(screen.findByText("Saved when you're back online")).resolves.toBeTruthy();
    cleanup();
    await openPopup(worker(signedIn, { kind: "queued", waitsFor: "update" }).ask);
    const update = await screen.findByText("Saved once this extension updates");
    expect(update.getAttribute("role")).toBe("status");
  });

  it("says a save made signed out waits for the sign-in, and links where to sign in", async () => {
    await openPopup(worker(signedOut, { kind: "queued", waitsFor: "sign-in" }).ask);
    const line = await screen.findByText("Saved once you sign in to Inteligir again");
    expect(line.closest("a")?.getAttribute("href")).toBe(SIGN_IN_URL);
  });

  it("says every refusal in its own sentence, and links the sign-in page where signing in helps", async () => {
    for (const reason of OUTCOME_REASONS) {
      await openPopup(worker(signedOut, refused(reason)).ask);
      const line = outcomeLine(refused(reason));
      const shown = await screen.findByText(line.text);
      // a line that links the sign-in page is that link; any other is an alert
      expect(
        line.signIn ? shown.closest("a")?.getAttribute("href") : shown.getAttribute("role"),
        reason,
      ).toBe(line.signIn ? SIGN_IN_URL : "alert");
      expect(screen.queryByText("Open your library")).toBeNull();
      cleanup();
    }
  });

  it("says what to do about a full library", async () => {
    await openPopup(worker(signedOut, refused("library-full")).ask);
    await expect(
      screen.findByText("Your library is full. Free some room to save"),
    ).resolves.toBeDefined();
  });

  it("says a tab it cannot save is not one it saves", async () => {
    const { ask, asked } = worker(signedIn);
    await openPopup(ask, async () => null);
    await expect(
      screen.findByText(outcomeLine(refused("unsupported-page")).text),
    ).resolves.toBeTruthy();
    expect(asked).toStrictEqual([{ type: "status" }]);
  });
});

describe("the welcome page", () => {
  it("links the site's sign-in while the browser is signed out of it", async () => {
    render(<Welcome ask={worker(signedOut).ask} />);
    const link = await screen.findByText("Sign in to Inteligir");
    expect(link.closest("a")?.getAttribute("href")).toBe(SIGN_IN_URL);
  });

  it("says whose library it saves to and links it, and that the site's sign-out signs it out", async () => {
    render(<Welcome ask={worker(signedIn).ask} />);
    await expect(
      screen.findByText("Saving to reader@example.test's library"),
    ).resolves.toBeTruthy();
    expect(screen.getByText("Open your library").closest("a")?.getAttribute("href")).toBe(
      LIBRARY_URL,
    );
    expect(
      screen.getByText("Signing out of Inteligir in this browser signs this extension out too."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says a status it could not read in its own words, never a save's", async () => {
    render(<Welcome ask={worker(null).ask} />);
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
