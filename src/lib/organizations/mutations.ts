import type { Database } from "~/core/database.types";
import type { DatabaseClient } from "~/core/db";
import { getOrganizationByUid } from "~/lib/organizations/queries";
import type Organization from "~/lib/organizations/types/organization";

type OrganizationRow = Database["public"]["Tables"]["organizations"]["Row"];

export async function updateOrganization(
  client: DatabaseClient,
  params: {
    id: number;
    data: Partial<Organization>;
  },
) {
  const payload: Omit<Partial<OrganizationRow>, "id"> = {
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
}

export async function setOrganizationSubscriptionData(
  client: DatabaseClient,
  props: {
    organizationUid: string;
    customerId: string;
    subscriptionId: string;
  },
) {
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
        onConflict: "customer_id",
      },
    )
    .match({ customer_id: customerId })
    .throwOnError();
}
