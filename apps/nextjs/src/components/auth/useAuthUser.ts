"use client";

import { useSession } from "@/components/auth/useSession";

export const useAuthUser = () => {
  const session = useSession();
  return session?.user ?? null;
};
