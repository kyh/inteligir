export const ROLE_MEMBER = "Member";
export const ROLE_ADMIN = "Admin";

export type Role = typeof ROLE_MEMBER | typeof ROLE_ADMIN;

export const ROLES: Role[] = [ROLE_MEMBER, ROLE_ADMIN];
