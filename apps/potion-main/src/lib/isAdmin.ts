import { UserRole } from 'generated/prisma/enums';

export const isAdmin = (role?: UserRole) =>
  isSuperAdmin(role) || role === UserRole.ADMIN;

export const isSuperAdmin = (role?: UserRole) => role === UserRole.SUPERADMIN;
