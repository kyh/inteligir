import type { SupabaseClient } from "@/lib/supabase/client";
import type { Membership } from "@/features/organizations/membership";

export const getMembershipByInviteCode = async <Response>(
  client: SupabaseClient,
  params: {
    code: string;
    query?: string;
  },
) =>
  client
    .from("memberships")
    .select<string, Response>(
      params.query ??
        `
      id,
      role,
      code,
      invitedEmail: invited_email,
      organizationId: organization_id,
      userId: user_id,
      `,
    )
    .eq("code", params.code)
    .throwOnError()
    .single();

export const getUserMembershipByOrganization = async (
  client: SupabaseClient,
  params: {
    userId: string;
    organizationUid: string;
  },
) => {
  const { data, error } = await client
    .from("memberships")
    .select<string, Membership>(
      `
      *,
      organization: organization_id !inner (
        uuid
      )
     `,
    )
    .eq("user_id", params.userId)
    .eq("organization.uuid", params.organizationUid)
    .single()
    .throwOnError();

  if (error) {
    throw error;
  }

  return data;
};

export const getUserRoleByMembershipId = async (
  client: SupabaseClient,
  membershipId: number,
) => {
  const { data, error } = await client
    .from("memberships")
    .select<string, Pick<Membership, "role">>(`role`)
    .eq("id", membershipId)
    .throwOnError()
    .single();

  if (error) {
    throw error;
  }

  return data.role;
};

export const getMembershipByEmail = async (
  client: SupabaseClient,
  params: {
    email: string;
    organizationId: number;
  },
) =>
  client
    .from("memberships")
    .select(
      `
      id,
      role,
      code,
      invitedEmail: invited_email,
      organizationId: organization_id,
      userId: user_id
  `,
    )
    .eq("invited_email", params.email)
    .eq("organization_id", params.organizationId)
    .single();
