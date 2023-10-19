"use client";

import If from "ui/components/if";
import Trans from "ui/components/trans";
import { canChangeBilling } from "@/features/organizations/permissions";
import SubscriptionCard from "./subscription-card";
import useCurrentOrganization from "@/lib/organizations/hooks/use-current-organization";
import PlanSelectionForm from "@/app/dashboard/[organization]/settings/subscription/components/plan-selection-form";
import IfHasPermissions from "@/components/if-has-permissions";
import BillingPortalRedirectButton from "@/app/dashboard/[organization]/settings/subscription/components/billing-redirect-button";

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
    <div className="flex flex-col space-y-4">
      <SubscriptionCard subscription={subscription} />

      <IfHasPermissions condition={canChangeBilling}>
        <If condition={customerId}>
          <div className="flex flex-col space-y-2">
            <BillingPortalRedirectButton customerId={customerId as string}>
              <Trans i18nKey="subscription:manageBilling" />
            </BillingPortalRedirectButton>

            <span className="text-xs text-gray-500 dark:text-gray-400">
              <Trans i18nKey="subscription:manageBillingDescription" />
            </span>
          </div>
        </If>
      </IfHasPermissions>
    </div>
  );
};

export default Plans;
