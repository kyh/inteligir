import type MembershipRole from "./membership-role";

type Membership = {
  id: number;
  invitedEmail?: string;
  code?: string;
  role: MembershipRole;
  organizationId: number;
  userId: string;
};

export default Membership;
