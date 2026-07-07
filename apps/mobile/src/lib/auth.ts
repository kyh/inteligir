import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";

import { getCoordinatorUrl } from "./base-url";

// ---------------------------------------------------------------------------
// Better Auth client — email + password against the coordinator's `/api/auth/*`.
// The expo plugin persists the session in the secure store and owns the
// `inteligir://` deep-link callback (its `scheme` MUST match app.config's
// `scheme`).
//
// The coordinator runs the bearer() plugin, so sign-in/up (and refreshes) return
// the session token in the `set-auth-token` response header. We capture it into
// the secure store here so the sync client can send
// `Authorization: Bearer <token>` on the `/v1/vault/*` routes (the SyncPort uses
// raw `fetch`, not this client).
// ---------------------------------------------------------------------------

const BEARER_TOKEN_KEY = "inteligir.bearerToken";

export const authClient = createAuthClient({
  baseURL: getCoordinatorUrl(),
  fetchOptions: {
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token !== null && token !== "") SecureStore.setItem(BEARER_TOKEN_KEY, token);
    },
  },
  plugins: [
    expoClient({
      scheme: "inteligir",
      storagePrefix: "inteligir",
      storage: SecureStore,
    }),
  ],
});

/** The captured bearer token for the sync client, or `null` when signed out. */
export function getBearerToken(): string | null {
  return SecureStore.getItem(BEARER_TOKEN_KEY);
}

/** Drop the cached bearer token — call on sign-out. */
export function clearBearerToken(): void {
  void SecureStore.deleteItemAsync(BEARER_TOKEN_KEY);
}
