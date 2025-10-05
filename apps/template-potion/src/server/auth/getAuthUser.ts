import type { SessionUser } from '@/server/auth/lucia';
import type { UserRole } from '@prisma/client';

import { env } from '@/env';
import { isAdmin, isSuperAdmin } from '@/lib/isAdmin';

import { getDevUser } from './getDevUser';

export type AuthUser = {
  id: string;
  email: string | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  role: UserRole;
  username: string;
};

export const getAuthUser = (
  user: SessionUser | null,
  devUser?: string
): AuthUser | null => {
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    isAdmin: isAdmin(user.role),
    isSuperAdmin:
      isSuperAdmin(user.role) || env.SUPERADMIN.includes(user.email!),
    role: user.role,
    username: user.username,
    ...getDevUser(devUser),
  };
};
