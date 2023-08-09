import { nanoid } from "nanoid";
import type { DatabaseClient } from "~/core/db";
import type Membership from "~/lib/organizations/types/membership";

export const acceptInviteToOrganization = (
  client: DatabaseClient,
  params: {
    code: string;
    userId: string;
  },
) => {
  return client
    .rpc("accept_invite_to_organization", {
      invite_user_id: params.userId,
      invite_code: params.code,
    })
    .single();
};

export const createOrganizationMembership = (
  client: DatabaseClient,
  membership: Partial<Membership>,
) => {
  const code = nanoid(16);

  return client
    .from("memberships")
    .insert({
      role: membership.role!,
      organization_id: membership.organizationId!,
      invited_email: membership.invitedEmail,
      code,
    })
    .select("id, code")
    .throwOnError()
    .single();
};

export const updateMembershipById = (
  client: DatabaseClient,
  membership: Partial<Membership> & { id: number },
) => {
  const { id, ...params } = membership;

  return client.from("memberships").update(params).match({ id }).throwOnError();
};

export const deleteMembershipById = (
  client: DatabaseClient,
  membershipId: number,
) => {
  return client
    .from("memberships")
    .delete()
    .eq("id", membershipId)
    .throwOnError();
};

export const transferOwnership = (
  client: DatabaseClient,
  params: {
    organizationId: number;
    targetUserMembershipId: number;
  },
) => {
  return client.rpc("transfer_organization", {
    org_id: params.organizationId,
    target_user_membership_id: params.targetUserMembershipId,
  });
};
