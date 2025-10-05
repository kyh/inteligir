import { UserRole } from '@prisma/client';

export const isAdmin = (role?: UserRole) => {
  return isSuperAdmin(role) || role === UserRole.ADMIN;
};

export const isSuperAdmin = (role?: UserRole) => {
  return role === UserRole.SUPERADMIN;
};
