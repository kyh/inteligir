import { UserRole } from '@prisma/client';

import { env } from '@/env';
import {
  generateFromUsername,
  generateUsername,
} from '@/lib/generateFromUsername';
import { nid } from '@/lib/nid';
import { prisma } from '@/server/db';

export const findOrCreateUser = async ({
  // bio,
  email,
  firstName,
  lastName,
  // location,
  name,
  profileImageUrl,
  providerId,
  providerUserId,
  username,
  // x,
}: {
  email: string;
  providerId: 'github' | 'google';
  providerUserId: string;
  bio?: string;
  firstName?: string;
  github?: string;
  lastName?: string;
  location?: string;
  name?: string;
  profileImageUrl?: string;
  username?: string;
  x?: string;
}) => {
  const existingUser = await prisma.user.findFirst({
    select: {
      id: true,
      oauthAccounts: {
        where: {
          providerId,
          providerUserId,
        },
      },
    },
    where: {
      email,
    },
  });

  // existing user with that email (could be another oauth account)
  if (existingUser) {
    if (existingUser.oauthAccounts.length === 0) {
      // link oauth account
      await prisma.oauthAccount.create({
        data: {
          id: nid(),
          providerId,
          providerUserId,
          userId: existingUser.id,
        },
      });
    }

    return {
      id: existingUser.id,
    };
  }

  const invalidUsername =
    !username || (await prisma.user.count({ where: { username } })) > 0;

  // new user, check for available username
  if (invalidUsername) {
    let usernameIdSize = 3;

    let retry = 10;

    while (retry > 0) {
      retry -= 1;
      usernameIdSize += 1;

      username = generateFromUsername(
        name ?? generateUsername(),
        usernameIdSize
      );

      const existingRandomUsername = await prisma.user.count({
        where: { username },
      });

      if (!existingRandomUsername) {
        break;
      }
    }
  }

  // await resend.emails.send({
  //   from:
  //     process.env.NODE_ENV === 'development'
  //       ? 'Potion <onboarding@resend.dev>'
  //       : 'Potion <ziad.beyens@gmail.com>',
  //   to:
  //     process.env.NODE_ENV === 'development'
  //       ? 'delivered@resend.dev'
  //       : email,
  //   subject: 'Welcome to Potion!',
  //   react: WelcomeEmail({
  //     name: googleUser.given_name as string,
  //   }),
  //   // Set this to prevent Gmail from threading emails.
  //   // More info: https://resend.com/changelog/custom-email-headers
  //   headers: {
  //     'X-Entity-Ref-ID': Date.now() + '',
  //   },
  // });

  const user = await prisma.user.create({
    data: {
      id: nid(),
      // bio,
      email,
      firstName,
      lastName,
      // location,
      name,
      oauthAccounts: {
        create: {
          id: nid(),
          providerId,
          providerUserId,
        },
      },
      profileImageUrl: profileImageUrl,
      role: env.SUPERADMIN === email ? UserRole.SUPERADMIN : UserRole.USER,
      username: username!,
      // x,
    },
    select: {
      id: true,
    },
  });

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

  return user;
};
