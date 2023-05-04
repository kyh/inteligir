import "server-only";
import { cache } from "react";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getUserMembershipByOrganization } from "~/lib/memberships/queries";
import {
  getFirstOrganizationByUserId,
  getOrganizationById,
} from "~/lib/organizations/database/queries";
import { parseOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";
import requireSession from "~/lib/user/require-session";

/**
 * @description
 * 1. Given a user ID, this function will return either:
 * 2. The organizationId passed as first parameter, if passed
 * 3. Or, in case of errors, the first organization found the user belongs to as fallback
 * @param params
 */
export default async function getCurrentOrganization(
  params: {
    userId?: string;
    organizationId?: Maybe<number>;
  } = {}
) {
  const userId = params.userId || (await fetchUserIdFromSession());

  const organizationId =
    params.organizationId ?? (await getOrganizationIdFromCookies());

  return getOrganizationByIdOrFirst({
    userId,
    organizationId,
  });
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
async function getOrganizationByIdOrFirst(params: {
  userId: string;
  organizationId?: Maybe<number>;
}) {
  const { userId, organizationId } = params;

  // if the organization ID was passed from the cookie, we try read that
  if (organizationId) {
    try {
      const { data: organization, error } = await fetchOrganization(
        organizationId
      );

      if (error) {
        return getFirstOrganization(userId);
      }

      const role = await fetchUserRole(organizationId, userId);

      return {
        organization,
        role,
      };
    } catch (e) {
      // in case of errors we fallback to the first organization
      return getFirstOrganization(userId);
    }
  }

  // if the organization ID was not passed
  // or if somehow the user lacked the permissions
  // we simply return the first organization they belong to
  return getFirstOrganization(userId);
}

/**
 * @name getFirstOrganization
 * @description Get the first organization in the user's record.
 *
 * This function is cached on a per-request basis. This allows you to call the
 * same function multiple times in the same request without hitting the
 * database multiple times.
 */
const getFirstOrganization = cache(async (userId: string) => {
  try {
    const client = getSupabaseServerClient();
    const { data, error } = await getFirstOrganizationByUserId(client, userId);

    return error ? null : data;
  } catch (e) {
    return null;
  }
});

/**
 * @name fetchUserIdFromSession
 * @description Fetch the user ID from the session.
 * @throws NEXT_REDIRECT If the user is not logged in.
 */
async function fetchUserIdFromSession() {
  const client = getSupabaseServerClient();
  const session = await requireSession(client);

  return session.user.id;
}

/**
 * @name getOrganizationIdFromCookies
 * @description Get the organization ID from the cookies.
 */
async function getOrganizationIdFromCookies() {
  const { cookies } = await import("next/headers");
  const cookie = await parseOrganizationIdCookie(cookies());

  return cookie ? Number(cookie) : undefined;
}

/**
 * @name fetchOrganization
 * @description Fetch an organization by its ID.
 */
const fetchOrganization = cache(async (organizationId: number) => {
  const client = getSupabaseServerClient();

  return getOrganizationById(client, organizationId);
});

/**
 * @name fetchUserRole
 * @description Fetch the role of a user in an organization.
 */
const fetchUserRole = cache(async (organizationId: number, userId: string) => {
  const client = getSupabaseServerClient();

  const { role } = await getUserMembershipByOrganization(client, {
    organizationId,
    userId,
  });

  return role;
});
