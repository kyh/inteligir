import type { SupabaseClient } from "@/lib/supabase/client";
import type { UserData } from "@/features/users/user-data";
import type { Membership } from "@/features/organizations/membership";
import type { MembershipRole } from "@/features/organizations/membership-role";
import type { Organization } from "@/features/organizations/organization";
import type { OrganizationSubscription } from "@/features/organizations/organization-subscription";

/**
 * Query to fetch the organization data from the Database
 * Returns the organization data and the subscription data
 * {@link UserOrganizationData.organization}
 */
const FETCH_ORGANIZATION_QUERY = `
  id,
  uuid,
  name,
  logoURL: logo_url,
  subscription: organizations_subscriptions (
    customerId: customer_id,
    data: subscription_id (
      status,
      currency,
      interval,
      cancelAtPeriodEnd: cancel_at_period_end,
      intervalCount: interval_count,
      priceId: price_id,
      createdAt: created_at,
      periodStartsAt: period_starts_at,
      periodEndsAt: period_ends_at,
      trialStartsAt: trial_starts_at,
      trialEndsAt: trial_ends_at
    )
  )
`;

export type UserOrganizationData = {
  role: MembershipRole;
  organization: Organization & {
    subscription?: {
      customerId: Maybe<string>;
      data: OrganizationSubscription;
    };
  };
};

export const getOrganizationsByUserId = (
  client: SupabaseClient,
  userId: string,
) =>
  client
    .from("memberships")
    .select<
      string,
      {
        role: MembershipRole;
        organization: UserOrganizationData["organization"];
        userId: string;
      }
    >(
      `
        role,
        userId: user_id,
        organization:organization_id (${FETCH_ORGANIZATION_QUERY})`,
    )
    .eq("user_id", userId)
    .throwOnError();

export const getOrganizationInvitedMembers = async (
  client: SupabaseClient,
  organizationId: number,
) =>
  client
    .from("memberships")
    .select<string, Membership>(
      `
      id,
      role,
      invitedEmail: invited_email
    `,
    )
    .eq("organization_id", organizationId)
    .not("code", "is", null)
    .throwOnError();

export const getOrganizationMembers = (
  client: SupabaseClient,
  organizationId: number,
) =>
  client
    .from("memberships")
    .select<
      string,
      {
        membershipId: number;
        role: MembershipRole;
        data: UserData;
      }
    >(
      `
        membershipId: id,
        role,
        data: user_id (
          id,
          photoUrl: photo_url,
          displayName: display_name
        )
       `,
    )
    .eq("organization_id", organizationId)
    .is("code", null);

export const getOrganizationByUid = (client: SupabaseClient, uid: string) =>
  client
    .from("organizations")
    .select<string, UserOrganizationData["organization"]>(
      FETCH_ORGANIZATION_QUERY,
    )
    .eq("uuid", uid)
    .throwOnError()
    .maybeSingle();

export const getOrganizationById = (
  client: SupabaseClient,
  organizationId: number,
) =>
  client
    .from("organizations")
    .select<string, UserOrganizationData["organization"]>(
      FETCH_ORGANIZATION_QUERY,
    )
    .eq("id", organizationId)
    .throwOnError()
    .single();

export const getOrganizationByCustomerId = async (
  client: SupabaseClient,
  customerId: string,
) =>
  client
    .from("organizations")
    .select(
      `
      id,
      name,
      logoURL: logo_url,
      uuid,
      subscription: organizations_subscriptions !inner (
        customerId: customer_id
      )
      `,
    )
    .eq("organizations_subscriptions.customer_id", customerId)
    .throwOnError()
    .single();

export const getMembersAuthMetadata = async (
  client: SupabaseClient,
  userIds: string[],
) => {
  const users = await Promise.all(
    userIds.map((userId) => {
      return client.auth.admin
        .getUserById(userId)
        .then((r) => r.data.user)
        .catch(console.error);
    }),
  );

  return users.filter(Boolean);
};
