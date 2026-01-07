"use client";

import { authClient } from "@/auth/auth-client";

export function useSession() {
  const { data: session } = authClient.useSession();
  return session ?? null;
}

export const useIsAuth = () => !!useSession();
