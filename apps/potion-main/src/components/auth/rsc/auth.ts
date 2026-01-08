import { cache } from 'react';
import { type AuthSession, getSession } from '@/server/auth/auth';
import type { AuthUser } from '@/server/auth/getAuthUser';

export const auth = cache(
  async (): Promise<{
    session: AuthSession | null;
    user: AuthUser | null;
  }> => {
    const response = await getSession();

    return {
      session: response?.session ?? null,
      user: response?.user ?? null,
    };
  }
);

export const isAuth = async () => {
  const { session } = await auth();

  return !!session;
};

export const isNotAuth = async () => {
  const { session } = await auth();

  return !session;
};

export const authOnly = async <T extends (...args: any) => any>(
  callback: T
) => {
  if (await isAuth()) {
    return callback();
  }
};
