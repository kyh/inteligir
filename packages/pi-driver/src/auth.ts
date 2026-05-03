import { AuthStorage } from "@mariozechner/pi-coding-agent";

export type LoginCallbacks = {
  /** Called with the auth URL the user must open to complete OAuth. */
  onAuth: (info: { url: string }) => void;
};

/**
 * Construct an `AuthStorage` rooted at `authPath`. The pi-coding-agent SDK
 * persists OAuth credentials to that file.
 */
export function createAuthStorage(authPath: string): AuthStorage {
  return AuthStorage.create(authPath);
}

export function hasAuth(authStorage: AuthStorage, provider: string): boolean {
  return authStorage.hasAuth(provider);
}

/**
 * Run the OAuth login flow for `provider`, calling `callbacks.onAuth` with
 * the URL the user must visit. Resolves once the OAuth round-trip completes
 * and credentials are persisted in `authStorage`.
 *
 * The interactive prompt callback is rejected — we only support the non-
 * interactive OAuth path that provider-CLI tools expose.
 */
export async function loginWithProvider(
  authStorage: AuthStorage,
  provider: string,
  callbacks: LoginCallbacks,
): Promise<void> {
  await authStorage.login(provider, {
    onAuth: callbacks.onAuth,
    onPrompt: () => Promise.reject(new Error("Interactive prompt not supported")),
  });
}
