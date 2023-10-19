import type { Stripe } from "stripe";
import { useCurrentOrganization } from "@/features/organizations/use-current-organization";

const ACTIVE_STATUSES: Stripe.Subscription.Status[] = ["active", "trialing"];

export const useIsSubscriptionActive = () => {
  const organization = useCurrentOrganization();
  const status = organization?.subscription?.data.status;

  if (!status) {
    return false;
  }

  return ACTIVE_STATUSES.includes(status);
};
