'use client';

import { useEffect } from 'react';

import type { Nullable } from '@/lib/Nullable';
import type { AuthUser } from '@/server/auth/getAuthUser';
import type { AuthSession } from '@/server/auth/lucia';

import { createAtomStore } from 'jotai-x';

export type AuthStore = {
  session: AuthSession | null;
  user: AuthUser | null;
};

const initialState: Nullable<AuthStore> = {
  session: null,
  user: null,
};

function SentryUserManager() {
  const user = useAuthValue('user');

  useEffect(() => {
    // setSentryUser(user);
  }, [user]);

  return null;
}

export const { AuthProvider, useAuthStore, useAuthValue } = createAtomStore(
  initialState as AuthStore,
  {
    effect: SentryUserManager,
    name: 'auth',
  }
);

export const AuthProviderClient = AuthProvider;
