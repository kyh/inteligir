import type { DatabaseClient } from "~/lib/db";
import type Membership from "~/lib/organizations/types/membership";

export async function getMembershipByInviteCode<Response>(
  client: DatabaseClient,
  params: {
    code: string;
    query?: string;
  }
) {
  return client
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
      `
    )
    .eq("code", params.code)
    .throwOnError()
    .single();
}

export async function getUserMembershipByOrganization(
  client: DatabaseClient,
  params: {
    userId: string;
    organizationUid: string;
  }
) {
  const { data, error } = await client
    .from("memberships")
    .select<string, Membership>(
      `
      *,
      organization: organization_id !inner (
        uuid
      )
     `
    )
    .eq("user_id", params.userId)
    .eq("organization.uuid", params.organizationUid)
    .single()
    .throwOnError();

  if (error) {
    throw error;
  }

  return data;
}

export async function getUserRoleByMembershipId(
  client: DatabaseClient,
  membershipId: number
) {
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
}

export async function getMembershipByEmail(
  client: DatabaseClient,
  params: {
    email: string;
    organizationId: number;
  }
) {
  return client
    .from("memberships")
    .select(
      `
      id,
      role,
      code,
      invitedEmail: invited_email,
      organizationId: organization_id,
      userId: user_id
  `
    )
    .eq("invited_email", params.email)
    .eq("organization_id", params.organizationId)
    .single();
}
