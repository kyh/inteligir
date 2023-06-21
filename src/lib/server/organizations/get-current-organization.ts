import "server-only";
import { cache } from "react";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getUserMembershipByOrganization } from "~/lib/memberships/queries";
import { getOrganizationByUid } from "~/lib/organizations/database/queries";

export default async function getCurrentOrganization(params: {
  organizationUid: string;
  userId: string;
}) {
  const { userId, organizationUid } = params;
  const { data, error } = await fetchOrganization(organizationUid);

  if (error) {
    throw error;
  }

  const organization = data || undefined;
  const role = await fetchUserRole(organizationUid, userId);

  return {
    organization,
    role,
  };
}

const fetchOrganization = cache(async (uid: string) => {
  const client = getSupabaseServerClient();

  return getOrganizationByUid(client, uid);
});

const fetchUserRole = cache(async (organizationUid: string, userId: string) => {
  const client = getSupabaseServerClient();

  const data = await getUserMembershipByOrganization(client, {
    organizationUid,
    userId,
  });

  return data?.role;
});
