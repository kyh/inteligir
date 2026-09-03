import { describeCloudFailure, type CloudEndpoint } from "@repo/api/cloud/client";
import { loginDevice, type DeviceCredentialStore } from "@repo/api/cloud/device/login-flow";
import { createExternalStore, type ReadableStore } from "../lib/external-store";

export type LoginState =
  | { kind: "idle" }
  | { kind: "signing-in" }
  | { kind: "failed"; message: string };

export interface LoginRequest {
  email: string;
  password: string;
  deviceName: string;
}

export interface LoginStoreArgs {
  client: CloudEndpoint;
  store: DeviceCredentialStore;
}

export interface LoginStore extends ReadableStore<LoginState> {
  login(request: LoginRequest): Promise<void>;
}

// the one store the screen reads: a refusal on the wire and a store that cannot write both
// land here, so each is shown rather than dropped
export function createLoginStore(args: LoginStoreArgs): LoginStore {
  const state = createExternalStore<LoginState>({ kind: "idle" });

  async function login(request: LoginRequest): Promise<void> {
    // a second tap while the first is in flight is the same sign-in
    if (state.get().kind === "signing-in") return;
    state.set({ kind: "signing-in" });
    try {
      const outcome = await loginDevice({ client: args.client, store: args.store, ...request });
      state.set(
        outcome.kind === "logged-in"
          ? { kind: "idle" }
          : { kind: "failed", message: describeCloudFailure(outcome.failure) },
      );
    } catch (error) {
      state.set({
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { subscribe: state.subscribe, get: state.get, login };
}
