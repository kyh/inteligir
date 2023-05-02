"use client";

import React from "react";

import type Organization from "~/lib/organizations/types/organization";
import { canChangeBilling } from "~/lib/organizations/permissions";

import If from "~/core/ui/If";

import Alert from "~/core/ui/Alert";

import PricingTable from "~/components/PricingTable";
import IfHasPermissions from "~/app/(dashboard)/components/IfHasPermissions";
import CheckoutRedirectButton from "~/app/(dashboard)/settings/subscription/components/CheckoutRedirectButton";
import BillingPortalRedirectButton from "~/app/(dashboard)/settings/subscription/components/BillingRedirectButton";

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
                  organizationId={organization.id}
                  customerId={customerId}
                  stripePriceId={props.stripePriceId}
                  recommended={props.recommended}
                >
                  Checkout
                </CheckoutRedirectButton>
              );
            }}
          />

          <If condition={customerId}>
            <div className="flex flex-col space-y-2">
              <BillingPortalRedirectButton customerId={customerId as string}>
                Go to Customer Portal
              </BillingPortalRedirectButton>

              <span className="text-xs text-gray-500 dark:text-gray-400">
                Visit your Customer Portal to manage your subscription and
                billing.
              </span>
            </div>
          </If>
        </div>
      </IfHasPermissions>
    </div>
  );
};

export default PlanSelectionForm;

function NoPermissionsAlert() {
  return (
    <Alert type="warn">
      <Alert.Heading>
        You don't have permissions to change the billing
      </Alert.Heading>
      Please contact your organization owner to change the billing settings for
      your organization.
    </Alert>
  );
}
