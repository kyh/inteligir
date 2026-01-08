'use client';

import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/components/auth/useSession';
import { useTRPC } from '@/trpc/react';

export const useCurrentUser = () => {
  const session = useSession();
  const { data, ...rest } = useQuery({
    ...useTRPC().layout.app.queryOptions(),
    enabled: !!session,
  });

  return { ...data?.currentUser, ...rest };
};
