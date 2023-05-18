"use client";

import React from "react";
import { canChangeBilling } from "~/lib/organizations/permissions";
import type Organization from "~/lib/organizations/types/organization";
import Alert from "~/components/Alert";
import If from "~/components/If";
import PricingTable from "~/components/PricingTable";
import IfHasPermissions from "~/app/(dashboard)/components/IfHasPermissions";
import BillingPortalRedirectButton from "~/app/(dashboard)/settings/subscription/components/BillingRedirectButton";
import CheckoutRedirectButton from "~/app/(dashboard)/settings/subscription/components/CheckoutRedirectButton";

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

              <span className="text-xs text-zinc-500 dark:text-zinc-400">
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
