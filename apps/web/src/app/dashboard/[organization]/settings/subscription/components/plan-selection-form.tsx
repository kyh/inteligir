"use client";

import React from "react";
import { canChangeBilling } from "@/features/organizations/permissions";
import type Organization from "@/lib/organizations/types/organization";
import If from "ui/components/if";
import Trans from "ui/components/trans";
import Alert from "ui/components/alert";
import PricingTable from "@/components/pricing-table";
import IfHasPermissions from "@/components/if-has-permissions";
import CheckoutRedirectButton from "@/app/dashboard/[organization]/settings/subscription/components/checkout-redirect-button";
import BillingPortalRedirectButton from "@/app/dashboard/[organization]/settings/subscription/components/billing-redirect-button";

const PlanSelectionForm: React.FCC<{
  organization: WithId<Organization>;
  customerId: Maybe<string>;
}> = ({ organization, customerId }) => {
  return (
    <div className="flex flex-col space-y-6">
      <IfHasPermissions
        condition={canChangeBilling}
        fallback={<NoPermissionsAlert />}
      >
        <div className="flex w-full flex-col space-y-8">
          <PricingTable
            CheckoutButton={(props) => {
              return (
                <CheckoutRedirectButton
                  customerId={customerId}
                  organizationUid={organization.uuid}
                  recommended={props.recommended}
                  stripePriceId={props.stripePriceId}
                >
                  <Trans defaults="Checkout" i18nKey="subscription:checkout" />
                </CheckoutRedirectButton>
              );
            }}
          />

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
        </div>
      </IfHasPermissions>
    </div>
  );
};

export default PlanSelectionForm;

const NoPermissionsAlert = () => {
  return (
    <Alert type="warn">
      <Alert.Heading>
        <Trans i18nKey="subscription:noPermissionsAlertHeading" />
      </Alert.Heading>

      <Trans i18nKey="subscription:noPermissionsAlertBody" />
    </Alert>
  );
};
