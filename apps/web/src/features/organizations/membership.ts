import type { MembershipRole } from "./membership-role";

export type Membership = {
  id: number;
  invitedEmail?: string;
  code?: string;
  role: MembershipRole;
  organizationId: number;
  userId: string;
};
