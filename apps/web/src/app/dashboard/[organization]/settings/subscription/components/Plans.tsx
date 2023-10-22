"use client";

import If from "@inteligir/ui/if";
import Trans from "@inteligir/ui/trans";
import PlanSelectionForm from "@/app/dashboard/[organization]/settings/subscription/components/plan-selection-form";
import IfHasPermissions from "@/components/if-has-permissions";
import BillingPortalRedirectButton from "@/app/dashboard/[organization]/settings/subscription/components/billing-redirect-button";
import SubscriptionCard from "./subscription-card";
import useCurrentOrganization from "@/lib/organizations/hooks/use-current-organization";
import { canChangeBilling } from "@/lib/organizations/permissions";

const Plans: React.FC = () => {
  const organization = useCurrentOrganization();

  if (!organization) {
    return null;
  }

  const customerId = organization.subscription?.customerId;
  const subscription = organization.subscription?.data;

  if (!subscription) {
    return (
      <PlanSelectionForm customerId={customerId} organization={organization} />
    );
  }

  return (
    (<div className="flex flex-col space-y-4">
      <SubscriptionCard subscription={subscription} />
      <IfHasPermissions condition={canChangeBilling}>
        <If condition={customerId}>
          <div className="flex flex-col space-y-2">
            <BillingPortalRedirectButton customerId={customerId as string}>
              Go to Customer Portal
            </BillingPortalRedirectButton>

            <span className="text-xs text-gray-500 dark:text-gray-400">
              Visit your Customer Portal to manage your subscription and billing.
            </span>
          </div>
        </If>
      </IfHasPermissions>
    </div>)
  );
};

export default Plans;
