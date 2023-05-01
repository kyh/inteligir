import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getFirstOrganizationByUserId,
  getOrganizationById,
} from "~/lib/organizations/database/queries";

import { getUserMembershipByOrganization } from "~/lib/memberships/queries";

/**
 * @name getCurrentOrganization
 * @description Fetch the selected organization (or the first one in the list)
 */
export default async function getCurrentOrganization(
  client: SupabaseClient,
  params: {
    userId: string;
    organizationId?: Maybe<number>;
  }
) {
  return getOrganizationByIdOrFirst(client, params);
}

/**
 * @name getOrganizationByIdOrFirst
 * @description Given a user ID {@link userId}, this function will return
 * either:
 *
 * 1. The organizationId passed as first parameter, if passed
 * 2. Or, in case of errors, the first organization found the user belongs to as
 * fallback
 *
 * */
async function getOrganizationByIdOrFirst(
  client: SupabaseClient,
  params: {
    userId: string;
    organizationId?: Maybe<number>;
  }
) {
  const { userId, organizationId } = params;

  // if the organization ID was passed from the cookie, we try read that
  if (organizationId) {
    try {
      const { data: organization, error } = await getOrganizationById(
        client,
        organizationId
      );

      if (error) {
        return getFirstOrganization(client, userId);
      }

      const { role } = await getUserMembershipByOrganization(client, {
        organizationId,
        userId,
      });

      return {
        organization,
        role,
      };
    } catch (e) {
      // in case of errors we fallback to the first organization
      return getFirstOrganization(client, userId);
    }
  }

  // if the organization ID was not passed
  // or if somehow the user lacked the permissions
  // we simply return the first organization they belong to
  return getFirstOrganization(client, userId);
}

/**
 * @name getFirstOrganization
 * @description Get the first organization in the user's record
 */
async function getFirstOrganization(client: SupabaseClient, userId: string) {
  try {
    const { data, error } = await getFirstOrganizationByUserId(client, userId);

    return error ? null : data;
  } catch (e) {
    console.log(e);
    return null;
  }
}
