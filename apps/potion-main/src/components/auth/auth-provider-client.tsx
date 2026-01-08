'use client';

import { createAtomStore } from 'jotai-x';
import { useEffect } from 'react';

import type { Nullable } from '@/lib/Nullable';
import type { AuthSession } from '@/server/auth/auth';
import type { AuthUser } from '@/server/auth/getAuthUser';

export type AuthStore = {
  session: {
    session: AuthSession;
    user: AuthUser;
  } | null;
};

const initialState: Nullable<AuthStore> = {
  session: null,
};

function SentryUserManager() {
  const session = useAuthStore().useSessionValue();

  useEffect(() => {
    // setSentryUser(session?.user);
  }, [session]);

  return null;
}

export const { AuthProvider, useAuthStore } = createAtomStore(
  initialState as AuthStore,
  {
    effect: SentryUserManager,
    name: 'auth',
  }
);

export const AuthProviderClient = AuthProvider;
