// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FolderFacts } from "@repo/contract/local/vault/vault-folder";
import type { ExternalSync } from "@repo/contract/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FirstRunChoice, PickParentAnswer } from "../shell/first-run-state";
import { FIRST_RUN_COMMANDS } from "../shell/ipc-contract";
import type { DoneAnswer } from "../shell/shell-answer";
import { clearShell, mockShell, reply } from "../shell/test-support/mock-shell";
import { VaultStep } from "./vault-step";

afterEach(() => {
  cleanup();
  clearShell();
});

const HOME = "/Users/me";
const FOLDER = "/Users/me/Documents/Notes";

const facts = (overrides: Partial<FolderFacts> = {}): FolderFacts => ({
  externalSync: null,
  noteCount: { capped: false, count: 42 },
  ownSync: null,
  ...overrides,
});

const PARENT_CANCELLED: PickParentAnswer = { kind: "cancelled" };

const renderStep = (picked: FolderFacts = facts(), parent: PickParentAnswer = PARENT_CANCELLED) => {
  const finish = vi.fn<(choice: FirstRunChoice) => DoneAnswer>(() => ({
    ok: false,
    reason: "the shell said no",
  }));
  mockShell(
    reply(FIRST_RUN_COMMANDS.finish)(({ choice }) => finish(choice)),
    reply(FIRST_RUN_COMMANDS.pickFolder)(() => ({ facts: picked, kind: "picked", path: FOLDER })),
    reply(FIRST_RUN_COMMANDS.pickParent)(() => parent),
  );
  render(<VaultStep proposal={{ name: "Inteligir", parent: HOME }} />);
  return { finish };
};

const button = (name: string): HTMLElement => screen.getByRole("button", { name });

// Base UI checks a radio on focus as well as on press, so the press alone settles it here
const openAFolder = async (): Promise<void> => {
  fireEvent.click(screen.getByRole("radio", { name: "Open a folder" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose a folder…" }));
  await screen.findByText(FOLDER);
};

describe("creating a new vault", () => {
  it("proposes the default name and place, and hands both back as given", async () => {
    const { finish } = renderStep();
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Inteligir");
    expect(screen.getByText(HOME)).toBeDefined();
    fireEvent.click(button("Create library"));
    expect(await screen.findByText("the shell said no")).toBeDefined();
    expect(finish).toHaveBeenCalledWith({ kind: "create", name: "Inteligir", parent: HOME });
  });

  it("warns when the place picked for it is one another service syncs", async () => {
    const DROPBOX = "/Users/me/Library/CloudStorage/Dropbox";
    const { finish } = renderStep(undefined, {
      externalSync: { kind: "dropbox" },
      kind: "picked",
      path: DROPBOX,
    });
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(button("Change…"));
    await screen.findByText(DROPBOX);
    const warning = screen.getByRole("note");
    expect(warning.textContent).toContain("Dropbox keeps syncing this folder.");
    expect(warning.textContent).toContain("your phone won't see it");
    fireEvent.click(button("Create library"));
    expect(await screen.findByText("the shell said no")).toBeDefined();
    expect(finish).toHaveBeenCalledWith({ kind: "create", name: "Inteligir", parent: DROPBOX });
  });

  it("says nothing of a place no service syncs", async () => {
    const DOCUMENTS = "/Users/me/Documents";
    renderStep(undefined, { externalSync: null, kind: "picked", path: DOCUMENTS });
    fireEvent.click(button("Change…"));
    await screen.findByText(DOCUMENTS);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it.each([
    ["an empty name", "  ", "Give the library a name."],
    ["a name that is a path", "Notes/Work", "A name can't contain / or :."],
    ["a hidden name", ".notes", "A name can't start with a dot."],
  ])("holds Create for %s and says why", (_label, name, problem) => {
    const { finish } = renderStep();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
    expect(button("Create library").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(problem)).toBeDefined();
    fireEvent.submit(button("Create library"));
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("opening a folder", () => {
  it("shows how many notes it holds, and opens the folder the shell picked", async () => {
    const { finish } = renderStep();
    await openAFolder();
    expect(screen.getByText("42 items")).toBeDefined();
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(button("Open folder"));
    expect(await screen.findByText("the shell said no")).toBeDefined();
    expect(finish).toHaveBeenCalledWith({ kind: "open", path: FOLDER });
  });

  it.each<[ExternalSync, string]>([
    [{ kind: "icloud-drive" }, "iCloud Drive"],
    [{ kind: "icloud-desktop-documents" }, "iCloud Drive"],
    [{ kind: "dropbox" }, "Dropbox"],
    [{ kind: "google-drive" }, "Google Drive"],
    [{ kind: "onedrive" }, "OneDrive"],
    [{ kind: "cloud-storage", provider: "Box" }, "Box"],
    [{ kind: "obsidian-sync" }, "Obsidian Sync"],
  ])("warns that %j keeps syncing a folder %s syncs", async (externalSync, service) => {
    renderStep(facts({ externalSync }));
    await openAFolder();
    const warning = screen.getByRole("note");
    expect(warning.textContent).toContain(`${service} keeps syncing this folder.`);
    expect(warning.textContent).toContain("your phone won't see it");
  });

  it("names the host a folder already syncs with, in one quiet line", async () => {
    renderStep(facts({ ownSync: { host: "github.com", kind: "host" } }));
    await openAFolder();
    expect(
      screen.getByText("This folder already syncs with github.com, and keeps doing so."),
    ).toBeDefined();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("counts a walk that stopped at its bound as a floor", async () => {
    renderStep(facts({ noteCount: { capped: true, count: 20_000 } }));
    await openAFolder();
    expect(screen.getByText(`More than ${(20_000).toLocaleString()} items`)).toBeDefined();
  });
});

describe("the page's words", () => {
  it("never say what the engine is", async () => {
    renderStep(
      facts({ externalSync: { kind: "dropbox" }, ownSync: { host: "x.test", kind: "host" } }),
    );
    await openAFolder();
    expect(document.body.textContent ?? "").not.toMatch(
      /\b(?:git|commit|remote|repo|terminal|CLI|PATH|MCP)\b/iu,
    );
  });
});
