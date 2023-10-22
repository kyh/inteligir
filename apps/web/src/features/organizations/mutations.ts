import type { SupabaseClient } from "@/lib/supabase/client";
import type { Organization } from "@/features/organizations/organization";
import { getOrganizationByUid } from "@/features/organizations/queries";

export const updateOrganization = async (
  client: SupabaseClient,
  params: {
    id: number;
    data: Partial<Organization>;
  },
) => {
  const payload: Omit<Partial<Organization>, "id"> = {
    name: params.data.name,
  };

  if ("logoURL" in params.data) {
    payload.logo_url = params.data.logoURL;
  }

  const { data } = await client
    .from("organizations")
    .update(payload)
    .match({ id: params.id })
    .throwOnError()
    .select<string, Organization>("*")
    .throwOnError()
    .single();

  return data;
};

export const setOrganizationSubscriptionData = async (
  client: SupabaseClient,
  props: {
    organizationUid: string;
    customerId: string;
    subscriptionId: string;
  },
) => {
  const { customerId, organizationUid, subscriptionId } = props;

  const { data: organization, error } = await getOrganizationByUid(
    client,
    organizationUid,
  );

  if (error || !organization) {
    throw error;
  }

  const organizationId = organization.id;

  return client
    .from("organizations_subscriptions")
    .upsert(
      {
        customer_id: customerId,
        subscription_id: subscriptionId,
        organization_id: organizationId,
      },
      {
        onConflict: "organization_id",
      },
    )
    .match({ organization_id: organizationId })
    .throwOnError();
};
