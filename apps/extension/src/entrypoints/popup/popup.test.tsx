import { deferred } from "@repo/contract/deferred";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, test } from "vitest";

import { OUTCOME_REASONS } from "../../messages";
import type {
  ExtensionRequest,
  HeldSaves,
  Outcome,
  OutcomeReason,
  RefusedSave,
  Status,
  WorkerAsks,
} from "../../messages";
import { outcomeLine } from "../../outcome-copy";
import { Welcome } from "../welcome/app";
import { Popup, saveOpenedTab } from "./app";

afterEach(cleanup);

const SIGN_IN_URL = "https://www.inteligir.com/app/sign-in";
const LIBRARY_URL = "https://www.inteligir.com/library";
const FULL = "Your library is full.";

const saved = (created: boolean) =>
  ({ created, kind: "saved", title: "File over app" }) satisfies Outcome;

const refused = (reason: OutcomeReason) => ({ kind: "refused", reason }) satisfies Outcome;

const signedIn: Status = {
  account: { email: "reader@example.test", libraryUrl: LIBRARY_URL },
  signInUrl: SIGN_IN_URL,
};

const signedOut: Status = { account: null, signInUrl: SIGN_IN_URL };

const LATER: RefusedSave = { message: FULL, name: "Read it later", opId: "later" };
const OVER: RefusedSave = { message: FULL, name: "File over app", opId: "over" };

type Retried = "lands" | "refused" | "unanswered";

const worker = (
  status: Status | null,
  answers: Outcome[] = [],
  kept: { refused?: readonly RefusedSave[]; waiting?: number; retried?: Retried } = {},
) => {
  const asked: ExtensionRequest[] = [];
  let held: HeldSaves = { refused: kept.refused ?? [], waiting: kept.waiting ?? 0 };
  const without = (opId: string) => held.refused.filter((save) => save.opId !== opId);

  const ask: WorkerAsks = {
    discard: async (opId) => {
      asked.push({ opId, type: "discard" });
      held = { ...held, refused: without(opId) };

      return held;
    },
    retry: async (opId) => {
      asked.push({ opId, type: "retry" });

      const retried = kept.retried ?? "lands";

      switch (retried) {
        case "lands": {
          held = { ...held, refused: without(opId) };
          break;
        }

        case "unanswered": {
          held = { refused: without(opId), waiting: held.waiting + 1 };
          break;
        }

        case "refused": {
          break;
        }

        default: {
          throw new Error(`unexpected ${String(retried satisfies never)}`);
        }
      }

      return held;
    },
    save: async (tabId) => {
      asked.push({ tabId, type: "save" });

      return answers.shift() ?? refused("failed");
    },
    saves: async () => {
      asked.push({ type: "saves" });

      return held;
    },
    status: async () => {
      asked.push({ type: "status" });

      return status;
    },
  };

  return { ask, asked };
};

const tabSeven = async () => 7;

const openPopup = async (ask: WorkerAsks, activeTabId: () => Promise<number | null> = tabSeven) => {
  const opened = saveOpenedTab(activeTabId, ask);
  await act(async () => {
    render(<Popup ask={ask} opened={opened} />);
  });
};

const press = async (name: string, row: HTMLElement) => {
  await act(async () => {
    fireEvent.click(within(row).getByRole("button", { name }));
  });
};

describe("the popup", () => {
  it("saves the tab it opened over, says it landed in Unsorted with its title, and links the library", async () => {
    const { ask, asked } = worker(signedIn, [saved(true)]);
    await openPopup(ask);
    await expect(screen.findByText("Saved to Unsorted")).resolves.toBeTruthy();
    expect(screen.getByText("File over app")).toBeTruthy();
    expect(screen.getByText("Open your library").closest("a")?.getAttribute("href")).toBe(
      LIBRARY_URL,
    );
    expect(asked).toStrictEqual([
      { tabId: 7, type: "save" },
      { type: "status" },
      { type: "saves" },
    ]);
  });

  it("says who the browser is signed in as, and offers no sign-out of its own", async () => {
    await openPopup(worker(signedIn, [saved(true)]).ask);
    await expect(screen.findByText("Signed in as reader@example.test")).resolves.toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    await openPopup(worker(signedOut, [refused("not-connected")]).ask);
    await screen.findByText(outcomeLine(refused("not-connected")).text);
    expect(screen.queryByText(/Signed in as/u)).toBeNull();
  });

  it("says it is saving until the worker answers", async () => {
    const held = deferred();
    const { ask } = worker(signedIn, [saved(true)]);
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
    await openPopup(worker(signedIn, [saved(false)]).ask);
    await expect(screen.findByText("Already in your library")).resolves.toBeTruthy();
    cleanup();
    await openPopup(worker(signedIn, [{ kind: "queued", waitsFor: "connection" }]).ask);
    await expect(screen.findByText("Saved when you're back online")).resolves.toBeTruthy();
    cleanup();
    await openPopup(worker(signedIn, [{ kind: "queued", waitsFor: "update" }]).ask);
    const update = await screen.findByText("Saved once this extension updates");
    expect(update.getAttribute("role")).toBe("status");
  });

  it("says a save made signed out waits for the sign-in, and links where to sign in", async () => {
    await openPopup(worker(signedOut, [{ kind: "queued", waitsFor: "sign-in" }]).ask);
    const line = await screen.findByText("Saved once you sign in to Inteligir again");
    expect(line.closest("a")?.getAttribute("href")).toBe(SIGN_IN_URL);
  });

  it("says every refusal of its own in its own sentence, and links the sign-in page where signing in helps", async () => {
    for (const reason of OUTCOME_REASONS) {
      await openPopup(worker(signedOut, [refused(reason)]).ask);
      const line = outcomeLine(refused(reason));
      const shown = await screen.findByText(line.text);
      expect(
        line.signIn ? shown.closest("a")?.getAttribute("href") : shown.getAttribute("role"),
        reason,
      ).toBe(line.signIn ? SIGN_IN_URL : "alert");
      expect(screen.queryByText("Open your library")).toBeNull();
      cleanup();
    }
  });

  it("says a tab it cannot save is not one it saves", async () => {
    const { ask, asked } = worker(signedIn);
    await openPopup(ask, async () => null);
    await expect(
      screen.findByText(outcomeLine(refused("unsupported-page")).text),
    ).resolves.toBeTruthy();
    expect(asked).toStrictEqual([{ type: "status" }, { type: "saves" }]);
  });
});

describe("the popup's refused saves", () => {
  it("says a save the library refused in the library's words, and lists it with every other it holds", async () => {
    const { ask } = worker(signedIn, [{ kind: "refused", message: FULL, reason: "library" }], {
      refused: [LATER, OVER],
    });

    await openPopup(ask);
    const headline = await screen.findByRole("alert");
    expect(headline.textContent).toBe(FULL);
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toStrictEqual([
      `Read it later${FULL}Try againLet it go`,
      `File over app${FULL}Try againLet it go`,
    ]);
  });

  it("lists nothing while the library refused nothing", async () => {
    await openPopup(worker(signedIn, [saved(true)]).ask);
    await screen.findByText("Saved to Unsorted");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("sends one again as Try again is pressed, and shows what the library still refuses", async () => {
    const landing = worker(signedIn, [saved(true)], { refused: [LATER, OVER] });
    await openPopup(landing.ask);
    const [later] = await screen.findAllByRole("listitem");

    if (later === undefined) {
      throw new Error("the popup listed no refused save");
    }

    await press("Try again", later);
    expect(landing.asked.at(-1)).toStrictEqual({ opId: "later", type: "retry" });
    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toStrictEqual([
      `File over app${FULL}Try againLet it go`,
    ]);

    cleanup();
    const refusing = worker(signedIn, [saved(true)], { refused: [LATER], retried: "refused" });
    await openPopup(refusing.ask);
    await press("Try again", await screen.findByRole("listitem"));
    expect(screen.getByRole("listitem").textContent).toContain("Read it later");
  });

  it("says a save tried again that the cloud does not answer waits, and keeps saying so", async () => {
    const { ask } = worker(signedIn, [saved(true)], { refused: [LATER], retried: "unanswered" });
    await openPopup(ask);
    expect(screen.queryByText("1 save waiting")).toBeNull();
    await press("Try again", await screen.findByRole("listitem"));
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("1 save waiting");
  });

  it("counts the saves that wait beside those the library refused", async () => {
    await openPopup(worker(signedIn, [saved(true)], { refused: [LATER], waiting: 2 }).ask);
    await screen.findByRole("listitem");
    expect(screen.getByText("2 saves waiting")).toBeTruthy();
    cleanup();
    await openPopup(worker(signedIn, [saved(true)], { waiting: 1 }).ask);
    await screen.findByText("1 save waiting");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("lets one go as Let it go is pressed", async () => {
    const { ask, asked } = worker(signedIn, [saved(true)], { refused: [LATER] });
    await openPopup(ask);
    await press("Let it go", await screen.findByRole("listitem"));
    expect(asked.at(-1)).toStrictEqual({ opId: "later", type: "discard" });
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("keeps the list as shown when the worker's answer could not be read", async () => {
    const { ask } = worker(signedIn, [saved(true)], { refused: [LATER] });
    await openPopup({ ...ask, discard: async () => null });
    await press("Let it go", await screen.findByRole("listitem"));
    expect(screen.getByRole("listitem").textContent).toContain("Read it later");
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

test("holds the React Compiler's output for the extension's pages", () => {
  const plugin =
    "the extension vitest project must run the React Compiler's Babel preset (reactCompilerPreset) over src/";

  expect(Welcome.toString(), plugin).toContain("react.memo_cache_sentinel");
  expect(Popup.toString(), plugin).toContain("const $ = ");
});
