"use client";

import { useQuery } from "@tanstack/react-query";

import { authClient } from "@/auth/auth-client";
import { useTRPC } from "@/trpc/react";

export const useCurrentUser = () => {
  const { data: session } = authClient.useSession();
  const trpc = useTRPC();

  const { data, ...rest } = useQuery({
    ...trpc.layout.app.queryOptions(),
    enabled: !!session,
  });

  return { ...data?.currentUser, ...rest };
};
