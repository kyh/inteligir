import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { cookies, headers } from 'next/headers';

import { env } from '@/env';
import {
  generateFromUsername,
  generateUsername,
} from '@/lib/generateFromUsername';
import { nid } from '@/lib/nid';
import { CookieNames } from '@/lib/storage/cookies';
import { type AuthUser, getAuthUser } from '@/server/auth/getAuthUser';
import { prisma } from '@/server/db';

export const auth = betterAuth({
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['github'],
    },
  },
  baseURL: env.NEXT_PUBLIC_SITE_URL,
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: false,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            role:
              user.email && env.SUPERADMIN.includes(user.email)
                ? 'SUPERADMIN'
                : 'USER',
          },
        }),
        after: async (user) => {
          await prisma.document.createMany({
            data: [
              {
                id: nid(),
                icon: '🔗',
                templateId: 'link',
                title: 'Link',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '👤',
                templateId: 'mention',
                title: 'Mention',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '🌳',
                templateId: 'playground',
                title: 'Playground',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '🧠',
                templateId: 'ai',
                title: 'AI',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '🤖',
                templateId: 'copilot',
                title: 'Copilot',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '📢',
                templateId: 'callout',
                title: 'Callout',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '🧮',
                templateId: 'equation',
                title: 'Equation',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '📤',
                templateId: 'upload',
                title: 'Upload',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '/',
                templateId: 'slash-menu',
                title: 'Slash Menu',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '📋',
                templateId: 'context-menu',
                title: 'Context Menu',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '🧰',
                templateId: 'floating-toolbar',
                title: 'Floating Toolbar',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '🎮',
                templateId: 'media-toolbar',
                title: 'Media Toolbar',
                userId: user.id,
              },
              {
                id: nid(),
                icon: '📚',
                templateId: 'table-of-contents',
                title: 'Table of Contents',
                userId: user.id,
              },
            ],
          });
        },
      },
    },
  },

  socialProviders: {
    github: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      mapProfileToUser: async (profile) => ({
        username: await mapUsername({
          name: profile.name,
          username: profile.login,
        }),
      }),
    },
  },

  user: {
    additionalFields: {
      role: {
        defaultValue: 'USER',
        input: false,
        required: true,
        type: 'string',
      },
      username: {
        input: false,
        required: true,
        type: 'string',
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24 * 15, // 15 days
  },

  advanced: {
    cookiePrefix: '',
    cookies: {
      sessionToken: {
        name: 'session',
        attributes: {
          httpOnly: true,
          sameSite:
            env.NEXT_PUBLIC_ENVIRONMENT === 'development' ? 'lax' : 'none',
          secure: env.NEXT_PUBLIC_ENVIRONMENT === 'production',
        },
      },
    },
    database: {
      generateId: nid,
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;

export const getSession = async (
  heads?: Headers
): Promise<{ session: AuthSession; user: AuthUser } | null> => {
  const response = await auth.api.getSession({
    headers: heads ?? (await headers()),
  });

  if (!response) return null;

  return {
    session: response.session,
    user: getAuthUser(
      response.user,
      process.env.NODE_ENV === 'development'
        ? (await cookies()).get(CookieNames.devUser)?.value
        : undefined
    ),
  };
};

export const isAuth = async () => !!(await getSession());
export const isNotAuth = async () => !(await getSession());

const mapUsername = async (user: { name?: string; username?: string }) => {
  let username =
    user.username || generateFromUsername(user.name || generateUsername());
  let usernameIdSize = 3;
  let retry = 10;

  while (retry > 0) {
    const existingUser = await prisma.user.findUnique({ where: { username } });

    if (!existingUser) break;

    retry -= 1;
    usernameIdSize += 1;
    username = generateFromUsername(
      user.name || generateUsername(),
      usernameIdSize
    );
  }

  return username;
};
