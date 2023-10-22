import { nanoid } from "nanoid";
import type { SupabaseClient } from "@/lib/supabase/client";
import type { Membership } from "@/features/organizations/membership";

export const acceptInviteToOrganization = async (
  client: SupabaseClient,
  params: {
    code: string;
    userId: string;
  },
) =>
  client
    .rpc("accept_invite_to_organization", {
      invite_user_id: params.userId,
      invite_code: params.code,
    })
    .single();

export const createOrganizationMembership = async (
  client: SupabaseClient,
  membership: Partial<Membership>,
) => {
  const code = nanoid(16);

  return getMembershipsTable(client)
    .insert({
      role: membership.role,
      organization_id: membership.organizationId,
      invited_email: membership.invitedEmail,
      code,
    })
    .select("id, code")
    .throwOnError()
    .single();
};

export const updateMembershipById = async (
  client: SupabaseClient,
  membership: Partial<Membership> & { id: number },
) => {
  const { id, ...params } = membership;

  return getMembershipsTable(client)
    .update(params)
    .match({ id })
    .throwOnError();
};

export const deleteMembershipById = async (
  client: SupabaseClient,
  membershipId: number,
) => getMembershipsTable(client).delete().eq("id", membershipId).throwOnError();

export const transferOwnership = async (
  client: SupabaseClient,
  params: {
    organizationId: number;
    targetUserMembershipId: number;
  },
) =>
  client.rpc("transfer_organization", {
    org_id: params.organizationId,
    target_user_membership_id: params.targetUserMembershipId,
  });

const getMembershipsTable = (client: SupabaseClient) =>
  client.from("memberships");
