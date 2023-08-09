import { useMemo } from "react";
import { siteConfig } from "~/config/site";
import { CheckCircleIcon, XCircleIcon } from "lucide-react";
import type { OrganizationSubscription } from "~/lib/organizations/types/organization-subscription";
import { If } from "~/components/If";
import PricingTable from "~/components/PricingTable";
import { Text } from "~/components/Text";
import SubscriptionStatusBadge from "~/app/dashboard/[organization]/components/organizations/SubscriptionStatusBadge";
import SubscriptionStatusAlert from "~/app/dashboard/[organization]/settings/subscription/components/SubscriptionStatusAlert";

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
    <div className="flex flex-col space-y-6" data-cy="subscription-card">
      <div className="flex flex-col space-y-2">
        <div className="flex items-center space-x-4">
          <Text>
            <span data-cy="subscription-name">{details.product.name}</span>
          </Text>
          <SubscriptionStatusBadge subscription={subscription} />
        </div>
        <Text className="text-zinc-400">{details.product.description}</Text>
      </div>

      <div>
        <span className="flex items-end">
          <PricingTable.Price>{details.plan.price}</PricingTable.Price>
          <span className="lowercase text-zinc-500 dark:text-zinc-400">
            /{details.plan.name}
          </span>
        </span>
      </div>

      <SubscriptionStatusAlert subscription={subscription} values={dates} />

      <If condition={isActive}>
        <RenewStatusDescription
          dates={dates}
          cancelAtPeriodEnd={cancelAtPeriodEnd}
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
) => {
  return (
    <span className="flex items-center space-x-1.5 text-sm">
      <If condition={props.cancelAtPeriodEnd}>
        <XCircleIcon className="h-5 text-yellow-700" />

        <span>
          Your subscription is scheduled to be canceled on {props.dates.endDate}
          .
        </span>
      </If>

      <If condition={!props.cancelAtPeriodEnd}>
        <CheckCircleIcon className="h-5 text-green-700" />

        <span>
          Your subscription is scheduled to be renewed on {props.dates.endDate}
        </span>
      </If>
    </span>
  );
};

const getProducts = () => {
  if (!siteConfig.production) {
    /**
     * This is read-only, so we also include the testing plans
     * so we can test them.
     *
     * In production, of course, they should never show up
     */
    return [...siteConfig.stripe.products, ...getTestingProducts()];
  }

  return siteConfig.stripe.products;
};

const getTestingProducts = () => {
  return [
    {
      name: "Testing Plan",
      description: "Description of your Testing plan",
      features: [],
      plans: [
        {
          price: "$999/year",
          name: "Yearly",
          stripePriceId: "price_1LFibmKr5l4rxPx3wWcSO8UY",
        },
      ],
    },
  ];
};

const useSubscriptionDetails = (priceId: string) => {
  const products = useMemo(() => getProducts(), []);

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
