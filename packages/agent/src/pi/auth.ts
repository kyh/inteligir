import { ModelRuntime, readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { AuthPrompt } from "@earendil-works/pi-ai";

export type LoginCallbacks = {
  /** Called with the auth URL the user must open to complete OAuth. */
  onAuth: (info: { url: string }) => void;
};

/**
 * Construct pi's `ModelRuntime` with its credential store rooted at
 * `authPath` (the pi SDK persists OAuth credentials to that file).
 * `allowModelNetwork: false` keeps construction offline — otherwise the
 * runtime fetches a remote model catalog at create, and nothing here needs
 * one.
 */
export function createModelRuntime(authPath: string): Promise<ModelRuntime> {
  return ModelRuntime.create({ authPath, allowModelNetwork: false });
}

/** Whether auth.json at `authPath` holds a credential for `provider`.
 * Synchronous one-off read (pi's readStoredCredential) so host status
 * surfaces (Settings, delegation gating) stay sync. */
export function hasStoredAuth(authPath: string, provider: string): boolean {
  return readStoredCredential(provider, authPath) !== undefined;
}

/** Remove `provider`'s stored credential (pi persists the removal). */
export async function removeAuth(runtime: ModelRuntime, provider: string): Promise<void> {
  await runtime.logout(provider);
}

/**
 * Run the OAuth login flow for `provider`, calling `callbacks.onAuth` with
 * the URL the user must visit. Resolves once the OAuth round-trip completes
 * and credentials are persisted by the runtime's credential store.
 *
 * Interactive prompts are not answered — we only support the non-interactive
 * OAuth path that provider-CLI tools expose. A prompt raced against pi's
 * callback server stays pending until pi aborts it (the callback won); a
 * prompt with no abort signal can never settle that way, so it rejects
 * immediately.
 */
export async function loginWithProvider(
  runtime: ModelRuntime,
  provider: string,
  callbacks: LoginCallbacks,
): Promise<void> {
  await runtime.login(provider, "oauth", {
    notify: (event) => {
      if (event.type === "auth_url") callbacks.onAuth({ url: event.url });
    },
    prompt: (prompt: AuthPrompt) =>
      new Promise<string>((_resolve, reject) => {
        const signal = prompt.signal;
        if (!signal) {
          reject(new Error("Interactive prompt not supported"));
          return;
        }
        if (signal.aborted) {
          reject(new Error("Prompt aborted"));
          return;
        }
        signal.addEventListener("abort", () => reject(new Error("Prompt aborted")), {
          once: true,
        });
      }),
  });
}
