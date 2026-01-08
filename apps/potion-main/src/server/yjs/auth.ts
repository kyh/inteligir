import type { IncomingHttpHeaders } from 'node:http';

import { CookieNames } from '@/lib/storage/cookies';
import { type AuthSession, auth } from '@/server/auth/auth';
import { type AuthUser, getAuthUser } from '@/server/auth/getAuthUser';

type ParsedCookies = Record<string, string>;

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const parseCookies = (header?: string): ParsedCookies => {
  if (!header) return {};

  return header.split(';').reduce<ParsedCookies>((acc, cookie) => {
    const [nameRaw, ...valueParts] = cookie.split('=');

    if (!nameRaw) return acc;

    const name = nameRaw.trim();

    if (!name) return acc;

    const value = valueParts.join('=').trim();
    acc[name] = decode(value);

    return acc;
  }, {});
};

export const authenticateFromHeaders = async (
  headers: IncomingHttpHeaders
): Promise<{
  session: AuthSession | null;
  user: AuthUser | null;
}> => {
  const cookies = parseCookies(headers.cookie);
  const devUser = cookies[CookieNames.devUser];

  // Convert IncomingHttpHeaders to Headers for better-auth
  const fetchHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      fetchHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
  }

  const sessionData = await auth.api.getSession({
    headers: fetchHeaders,
  });

  if (!sessionData) {
    return { session: null, user: null };
  }

  return {
    session: sessionData.session,
    user: getAuthUser(sessionData.user, devUser),
  };
};
