// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ExternalSync } from "@repo/api/local/vault/vault-schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FirstRunAnswer,
  FirstRunChoice,
  FolderFacts,
  PickFolderAnswer,
} from "../../../first-run-state";
import type { FirstRunBridge } from "../../../types";
import { VaultStep } from "../vault-step";

afterEach(cleanup);

const HOME = "/Users/me";
const FOLDER = "/Users/me/Documents/Notes";

const facts = (overrides: Partial<FolderFacts> = {}): FolderFacts => ({
  externalSync: null,
  noteCount: { capped: false, count: 42 },
  ownSync: null,
  ...overrides,
});

const fakeBridge = (picked: FolderFacts = facts()) => {
  const finish = vi.fn<(choice: FirstRunChoice) => Promise<FirstRunAnswer>>(
    async () => await Promise.resolve({ ok: false, reason: "main said no" }),
  );
  const bridge: FirstRunBridge = {
    finish,
    getState: async () => await Promise.resolve({ newVault: { name: "Inteligir", parent: HOME } }),
    pickFolder: async (): Promise<PickFolderAnswer> =>
      await Promise.resolve({ facts: picked, kind: "picked", path: FOLDER }),
    pickParent: async () => await Promise.resolve({ kind: "cancelled" }),
  };
  return { bridge, finish };
};

const renderStep = (picked?: FolderFacts) => {
  const { bridge, finish } = fakeBridge(picked);
  render(<VaultStep bridge={bridge} proposal={{ name: "Inteligir", parent: HOME }} />);
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
    fireEvent.click(button("Create vault"));
    expect(await screen.findByText("main said no")).toBeDefined();
    expect(finish).toHaveBeenCalledWith({ kind: "create", name: "Inteligir", parent: HOME });
  });

  it.each([
    ["an empty name", "  ", "Give the vault a name."],
    ["a name that is a path", "Notes/Work", "A name can't contain / or :."],
    ["a hidden name", ".notes", "A name can't start with a dot."],
  ])("holds Create for %s and says why", (_label, name, problem) => {
    const { finish } = renderStep();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
    expect(button("Create vault").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(problem)).toBeDefined();
    fireEvent.submit(button("Create vault"));
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("opening a folder", () => {
  it("shows how many notes it holds, and opens the folder main picked", async () => {
    const { finish } = renderStep();
    await openAFolder();
    expect(screen.getByText("42 notes")).toBeDefined();
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(button("Open folder"));
    expect(await screen.findByText("main said no")).toBeDefined();
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
    expect(warning.textContent).toContain("your phone won't see them");
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
    expect(screen.getByText(`More than ${(20_000).toLocaleString()} notes`)).toBeDefined();
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
