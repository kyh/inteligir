import React, { useMemo } from "react";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import Heading from "@inteligir/ui/heading";
import If from "@inteligir/ui/if";
import Trans from "@inteligir/ui/trans";
import PricingTable from "@/components/pricing-table";
import SubscriptionStatusBadge from "@/app/dashboard/components/subscription-status-badge";
import SubscriptionStatusAlert from "@/app/dashboard/[organization]/settings/subscription/components/subscription-status-alert";
import type { OrganizationSubscription } from "@/lib/organizations/types/organization-subscription";
import { configuration } from "@/lib/configuration";

const SubscriptionCard: React.FC<{
  subscription: OrganizationSubscription;
}> = ({ subscription }) => {
  const details = useSubscriptionDetails(subscription.priceId);
  const cancelAtPeriodEnd = subscription.cancelAtPeriodEnd;
  const isActive = subscription.status === "active";

  const dates = useMemo(() => {
    return {
      endDate: new Date(subscription.periodEndsAt).toDateString(),
      trialEndDate: subscription.trialEndsAt
        ? new Date(subscription.trialEndsAt).toDateString()
        : null,
    };
  }, [subscription]);

  if (!details) {
    return null;
  }

  return (
    <div
      className="flex flex-col space-y-6"
      data-cy="subscription-card"
      data-cy-status={subscription.status}
    >
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-4">
          <Heading type={3}>
            <span data-cy="subscription-name">{details.product.name}</span>
          </Heading>

          <SubscriptionStatusBadge subscription={subscription} />
        </div>

        <Heading type={6}>
          <span className="text-gray-500 dark:text-gray-400">
            {details.product.description}
          </span>
        </Heading>
      </div>

      <div>
        <span className="flex items-end">
          <PricingTable.Price>{details.plan.price}</PricingTable.Price>

          <span className="lowercase text-gray-500 dark:text-gray-400">
            /{details.plan.name}
          </span>
        </span>
      </div>

      <SubscriptionStatusAlert subscription={subscription} values={dates} />

      <If condition={isActive}>
        <RenewStatusDescription
          cancelAtPeriodEnd={cancelAtPeriodEnd}
          dates={dates}
        />
      </If>
    </div>
  );
};

const RenewStatusDescription = (
  props: React.PropsWithChildren<{
    cancelAtPeriodEnd: boolean;
    dates: {
      endDate: string;
      trialEndDate: string | null;
    };
  }>,
) => (
  <span className="flex items-center space-x-1.5 text-sm">
    <If condition={props.cancelAtPeriodEnd}>
      <XCircleIcon className="h-5 text-yellow-700" />

      <span>
        Your subscription is scheduled to be canceled on {{ endDate }}.
      </span>
    </If>

    <If condition={!props.cancelAtPeriodEnd}>
      <CheckCircleIcon className="h-5 text-green-700" />

      <span>Your subscription is scheduled to be renewed on {{ endDate }}</span>
    </If>
  </span>
);

const useSubscriptionDetails = (priceId: string) => {
  const products = configuration.stripe.products;

  return useMemo(() => {
    for (const product of products) {
      for (const plan of product.plans) {
        if (plan.stripePriceId === priceId) {
          return { plan, product };
        }
      }
    }
  }, [products, priceId]);
};

export default SubscriptionCard;
