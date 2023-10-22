import { cache } from "react";
import { getUserMembershipByOrganization } from "@/features/memberships/queries";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { getOrganizationByUid } from "@/features/organizations/queries";

export const getCurrentOrganization = async (params: {
  organizationUid: string;
  userId: string;
}) => {
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
};

const fetchOrganization = cache((uid: string) => {
  const client = getSupabaseServerClient();

  return getOrganizationByUid(client, uid);
});

const fetchUserRole = cache(async (organizationUid: string, userId: string) => {
  const client = getSupabaseServerClient();

  const data = await getUserMembershipByOrganization(client, {
    organizationUid,
    userId,
  });

  return data.role;
});
