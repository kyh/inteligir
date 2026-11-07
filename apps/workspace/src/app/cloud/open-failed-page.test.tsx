// @vitest-environment jsdom

import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { V1_RPC_PATH, v1Contract } from "@repo/contract/cloud/v1";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { APP_COMMANDS } from "../../shell/ipc-contract";
import type { KeptCredential, ShellConfig } from "../../shell/shell-config";
import { ShellError } from "../../shell/shell-error";
import { clearShell, mockShell, reply } from "../../shell/test-support/mock-shell";
import { OpenFailedPage } from "./open-failed-page";
import { createShellLeaveGuard, openShellLibrary } from "./shell-library";
import { createPageQueryClient } from "./v1";

afterEach(() => {
  cleanup();
  clearShell();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CONFIG: ShellConfig = {
  cloudOrigin: "http://localhost:5174",
  deviceName: "Studio Mac",
  filesOrigin: "inteligir-files://localhost",
  version: "0.6.0",
};
const KEPT: KeptCredential = {
  credential: `igd_${"d".repeat(64)}`,
  email: "owner@example.com",
  userId: "user-1",
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
const openedOverARefusingKeychain = async (
  forget: () => Promise<KeptCredential | null> | KeptCredential | null,
) => {
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

// the cloud's sign-out over a real RPCHandler, naming the bearer that asked, as the Mac's fetch
// reaches it
const cloudAnswering = (signedOut: (bearer: string | null) => void) => {
  const os = implement(v1Contract).$context<{ readonly authorization: string | null }>();
  const cloud = new RPCHandler({
    account: {
      signOut: os.account.signOut.handler(({ context }) => {
        signedOut(context.authorization);
        return { revoked: true };
      }),
    },
  });
  vi.stubGlobal("fetch", async (request: Request) => {
    const { response } = await cloud.handle(request, {
      context: { authorization: request.headers.get("authorization") },
      prefix: V1_RPC_PATH,
    });
    return response ?? new Response(null, { status: 404 });
  });
};

describe("signing out of a library that would not open", () => {
  it("gives the device back once the shell let the credential go, so its slot is free", async () => {
    const order: string[] = [];
    cloudAnswering((bearer) => {
      order.push(`revoked ${String(bearer)}`);
    });
    const reload = await openedOverARefusingKeychain(() => {
      order.push("forgotten");
      return KEPT;
    });
    reload.mockImplementation(() => {
      order.push("reloaded");
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(order).toStrictEqual(["forgotten", `revoked Bearer ${KEPT.credential}`, "reloaded"]);
  });

  it("asks the cloud nothing when the shell held no credential to give back", async () => {
    const revoked = vi.fn<() => void>();
    cloudAnswering(revoked);
    const reload = await openedOverARefusingKeychain(() => null);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
    expect(revoked).not.toHaveBeenCalled();
  });

  it("opens on the sign-in all the same with no connection", async () => {
    vi.stubGlobal("fetch", async () => await Promise.reject(new TypeError("the Mac is offline")));
    const reload = await openedOverARefusingKeychain(() => KEPT);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
  });

  it("waits only a moment on a cloud that never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let asked = false;
    vi.stubGlobal(
      "fetch",
      async (request: Request) =>
        // oxlint-disable-next-line promise/avoid-new -- a call that ends only when it is called off, which only a promise's reject can say
        await new Promise<Response>((_resolve, reject) => {
          asked = true;
          request.signal.addEventListener("abort", () => {
            reject(new DOMException("called off", "AbortError"));
          });
        }),
    );
    const reload = await openedOverARefusingKeychain(() => KEPT);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await vi.waitFor(() => {
      expect(asked).toBe(true);
    });
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => {
      expect(reload).toHaveBeenCalledOnce();
    });
  });
});
