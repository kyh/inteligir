import type { UserRole } from 'generated/prisma/enums';

import { env } from '@/env';
import { isAdmin, isSuperAdmin } from '@/lib/isAdmin';

export type AuthUser = {
  id: string;
  email: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  role: UserRole;
  username: string;
};

type User = {
  id: string;
  email: string;
  role: string;
  username: string;
};

export const getAuthUser = (user: User, devUser?: string): AuthUser => {
  const role = user.role as UserRole;

  return {
    id: user.id,
    email: user.email,
    isAdmin: isAdmin(role),
    isSuperAdmin: isSuperAdmin(role) || env.SUPERADMIN.includes(user.email),
    role,
    username: user.username,
    ...getDevUser(devUser),
  };
};

const getDevUser = (devUserStr?: string) => {
  if (process.env.NODE_ENV === 'production' || !devUserStr) return null;

  const devUser = JSON.parse(devUserStr);

  const res: {
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
  } = {};

  if (devUser.role && devUser.role !== 'default') {
    res.isAdmin = devUser.role === 'ADMIN';
    res.isSuperAdmin = devUser.role === 'SUPERADMIN';
  }

  return res;
};
