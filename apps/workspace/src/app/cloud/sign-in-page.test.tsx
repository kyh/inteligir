// @vitest-environment jsdom

import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { DEVICE_NAME_MAX_LENGTH } from "@repo/contract/cloud/device/device-schema";
import type { DeviceLoginRequest } from "@repo/contract/cloud/device/device-schema";
import { V1_RPC_PATH, v1Contract } from "@repo/contract/cloud/v1";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APP_COMMANDS } from "../../shell/ipc-contract";
import type { KeptCredential, ShellConfig } from "../../shell/shell-config";
import { clearShell, mockShell, reply } from "../../shell/test-support/mock-shell";
import { SignInPage } from "./sign-in-page";
import { createPageQueryClient } from "./v1";

// a Mac whose host name is longer than the cloud keeps
const LONG_NAME = "m".repeat(100);
const CONFIG: ShellConfig = {
  cloudOrigin: "http://localhost:5174",
  deviceName: LONG_NAME,
  filesOrigin: "inteligir-files://localhost",
  version: "0.6.0",
};
const ANSWER: KeptCredential = {
  credential: `igd_${"c".repeat(64)}`,
  deviceId: "device-7",
  email: "owner@example.com",
  userId: "user-1",
};
const KEYCHAIN_SENTENCE =
  "Your Mac's Keychain didn't let Inteligir in. Unlock it, or choose Allow when your Mac asks, then try again.";

// what the cloud was asked, by procedure
interface Asked {
  readonly signIn: DeviceLoginRequest[];
  readonly signOut: (string | null)[];
}

let asked: Asked = { signIn: [], signOut: [] };

// the cloud's account procedures over a real RPCHandler, answering the Mac's fetches: a sign-in
// answers this device's credential, and a sign-out names the bearer that asked
const os = implement(v1Contract).$context<{ readonly authorization: string | null }>();
const cloud = new RPCHandler({
  account: {
    signIn: os.account.signIn.handler(({ input }) => {
      asked.signIn.push(input);
      return ANSWER;
    }),
    signOut: os.account.signOut.handler(({ context }) => {
      asked.signOut.push(context.authorization);
      return { revoked: true };
    }),
    signUp: os.account.signUp.handler(() => ANSWER),
  },
});

beforeEach(() => {
  asked = { signIn: [], signOut: [] };
  vi.stubGlobal("fetch", async (request: Request) => {
    const { response } = await cloud.handle(request, {
      context: { authorization: request.headers.get("authorization") },
      prefix: V1_RPC_PATH,
    });
    return response ?? new Response(null, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  clearShell();
  vi.unstubAllGlobals();
});

const drawn = () => {
  const signedIn = vi.fn<() => void>();
  render(
    <SignInPage config={CONFIG} queryClient={createPageQueryClient()} onSignedIn={signedIn} />,
  );
  return signedIn;
};

const typeSignIn = (): void => {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: ANSWER.email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
};

describe("the Mac's sign-in", () => {
  it("keeps the credential the cloud answered, naming this Mac within the cloud's limit", async () => {
    const kept: KeptCredential[] = [];
    mockShell(
      reply(APP_COMMANDS.credential.keep)(({ credential }) => {
        kept.push(credential);
        return null;
      }),
    );
    const signedIn = drawn();
    typeSignIn();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => {
      expect(signedIn).toHaveBeenCalledOnce();
    });
    expect(kept).toEqual([ANSWER]);
    expect(asked.signIn.map((request) => request.deviceName)).toEqual([
      LONG_NAME.slice(0, DEVICE_NAME_MAX_LENGTH),
    ]);
    expect(asked.signOut).toEqual([]);
  });

  it("gives the device's slot back when the Keychain will not keep its credential", async () => {
    mockShell(
      reply(APP_COMMANDS.credential.keep)(
        async () =>
          // oxlint-disable-next-line prefer-promise-reject-errors -- the shell rejects with its serialized error, a plain object, which is what this stands in for
          await Promise.reject({ kind: "keychain", message: "The Keychain refused: locked" }),
      ),
    );
    const signedIn = drawn();
    typeSignIn();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(KEYCHAIN_SENTENCE)).toBeDefined();
    // the new credential signs itself out, so no device is left holding a slot of the cap
    expect(asked.signOut).toEqual([`Bearer ${ANSWER.credential}`]);
    expect(signedIn).not.toHaveBeenCalled();
  });

  it("creates an account only once a name and an invite code are typed", () => {
    mockShell();
    drawn();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    typeSignIn();
    const create = screen.getByRole("button", { name: "Create account" });
    expect(create).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Owner" } });
    expect(create).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Invite code"), { target: { value: "invite-1" } });
    expect(create).toHaveProperty("disabled", false);
  });
});
