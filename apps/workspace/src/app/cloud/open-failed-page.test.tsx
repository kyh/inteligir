// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_COMMANDS } from "../../shell/ipc-contract";
import type { ShellConfig } from "../../shell/shell-config";
import { ShellError } from "../../shell/shell-error";
import { clearShell, mockShell, reply } from "../../shell/test-support/mock-shell";
import { OpenFailedPage } from "./open-failed-page";
import { createShellLeaveGuard, openShellLibrary } from "./shell-library";
import { createPageQueryClient } from "./v1";

afterEach(() => {
  cleanup();
  clearShell();
});

const CONFIG: ShellConfig = {
  cloudOrigin: "http://localhost:5174",
  deviceName: "Studio Mac",
  filesOrigin: "inteligir-files://localhost",
  version: "0.6.0",
};

// what the shell rejects with when it cannot do what it was asked (src-tauri/src/error.rs)
const shellRefuses = async (kind: string, message: string): Promise<never> =>
  // oxlint-disable-next-line prefer-promise-reject-errors -- the shell rejects with its serialized error, a plain object, which is what this stands in for
  await Promise.reject({ kind, message });

const KEYCHAIN_SENTENCE =
  "Your Mac's Keychain didn't let Inteligir in. Unlock it, or choose Allow when your Mac asks, then try again.";

// the shell's refusal the opening rejected with
const openingRefused = async (): Promise<ShellError> => {
  try {
    await openShellLibrary(createShellLeaveGuard(), () => {});
  } catch (error) {
    if (error instanceof ShellError) {
      return error;
    }
    throw error;
  }
  throw new Error("the library opened over a Keychain that refused");
};

// the library as the window opens it with a Keychain that said no, drawn as the window draws it
const openedOverARefusingKeychain = async (forget: () => Promise<null> | null) => {
  mockShell(
    reply(APP_COMMANDS.config)(() => CONFIG),
    reply(APP_COMMANDS.credential.restore)(
      async () => await shellRefuses("keychain", "The Keychain refused: User interaction denied"),
    ),
    reply(APP_COMMANDS.credential.forget)(forget),
  );
  const cause = await openingRefused();
  expect(cause.kind).toBe("keychain");
  const reload = vi.fn<() => void>();
  render(<OpenFailedPage cause={cause} queryClient={createPageQueryClient()} reload={reload} />);
  return reload;
};

describe("a library the shell could not open", () => {
  it("says the Keychain refused in the person's words, and Try again opens it again", async () => {
    const reload = await openedOverARefusingKeychain(() => null);
    expect(screen.getByText(KEYCHAIN_SENTENCE)).toBeDefined();
    expect(screen.queryByText(/User interaction denied/u)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("signs this Mac out, then opens on the sign-in", async () => {
    const forget = vi.fn<() => null>(() => null);
    const reload = await openedOverARefusingKeychain(forget);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(forget).toHaveBeenCalledOnce();
  });

  it("stays, and says so, when the sign-out could not finish either", async () => {
    const reload = await openedOverARefusingKeychain(
      async () => await shellRefuses("keychain", "The Keychain refused: locked"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    // the opening's trouble, and the sign-out's under it
    await vi.waitFor(() => {
      expect(screen.getAllByText(KEYCHAIN_SENTENCE)).toHaveLength(2);
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it("says the sign-out failed, not the opening, when the shell could not clear this Mac's copy", async () => {
    const reload = await openedOverARefusingKeychain(
      async () => await shellRefuses("io", "Permission denied (os error 13)"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => {
      expect(screen.getByText("This Mac couldn't sign out. Try again.")).toBeDefined();
    });
    expect(
      screen.queryByText("The copy of your library on this Mac couldn't be opened."),
    ).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
