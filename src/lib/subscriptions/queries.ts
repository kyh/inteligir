import type { DatabaseClient } from "~/lib/db";

export async function getOrganizationSubscription(
  client: DatabaseClient,
  organizationId: number
) {
  return client
    .from("subscriptions")
    .select(
      `
        id,
        status,
        updatePaymentMethodUrl: update_payment_method_url,
        billingAnchor: billing_anchor,
        variantId: variant_id,
        createdAt: created_at,
        endsAt: ends_at,
        renewsAt: renews_at,
        trialStartsAt: trial_starts_at,
        trialEndsAt: trial_ends_at,
        organizations_subscriptions!inner (
          organization_id
        )
      `
    )
    .eq("organizations_subscriptions.organization_id", organizationId)
    .throwOnError()
    .maybeSingle();
}

export async function getOrganizationSubscriptionActive(
  client: DatabaseClient,
  organizationId: number
) {
  const { data: subscription } = await getOrganizationSubscription(
    client,
    organizationId
  );

  const status = subscription?.status;

  if (!status) {
    return false;
  }

  return status === "active" || status === "trialing";
}
