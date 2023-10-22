"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import If from "@inteligir/ui/if";
import Alert from "@inteligir/ui/alert";
import Button from "@inteligir/ui/button";
import ErrorBoundary from "@inteligir/ui/error-boundary";
import PricingTable from "@/components/pricing-table";
import IfHasPermissions from "@/components/if-has-permissions";
import CheckoutRedirectButton from "./checkout-redirect-button";
import BillingPortalRedirectButton from "./billing-redirect-button";
import type Organization from "@/lib/organizations/types/organization";
import { canChangeBilling } from "@/lib/organizations/permissions";

const EmbeddedStripeCheckout = dynamic(
  () => import("./EmbeddedStripeCheckout"),
  {
    ssr: false,
  },
);

const PlanSelectionForm: React.FCC<{
  organization: WithId<Organization>;
  customerId: Maybe<string>;
}> = ({ organization, customerId }) => {
  const [clientSecret, setClientSecret] = useState<string>();
  const [retry, setRetry] = useState(0);

  return (
    <div className="flex flex-col space-y-6">
      <IfHasPermissions
        condition={canChangeBilling}
        fallback={<NoPermissionsAlert />}
      >
        <If condition={clientSecret}>
          <EmbeddedStripeCheckout clientSecret={clientSecret!} />
        </If>

        <div className="flex w-full flex-col space-y-8">
          <PricingTable
            CheckoutButton={(props) => {
              return (
                <ErrorBoundary
                  fallback={
                    <CheckoutErrorMessage
                      onRetry={() => {
                        setRetry((retry) => retry + 1);
                      }}
                    />
                  }
                  key={retry}
                >
                  <CheckoutRedirectButton
                    onCheckoutCreated={setClientSecret}
                    organizationUid={organization.uuid}
                    recommended={props.recommended}
                    stripePriceId={props.stripePriceId}
                  >
                    Checkout
                  </CheckoutRedirectButton>
                </ErrorBoundary>
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

const NoPermissionsAlert = () => (
  <Alert type="warn">
    <Alert.Heading>
      You don't have permissions to change the billing
    </Alert.Heading>
    Please contact your organization owner to change the billing settings for
    your organization.
  </Alert>
);

const CheckoutErrorMessage = ({ onRetry }: { onRetry: () => void }) => (
  <div className="flex flex-col space-y-2">
    <span className="text-sm font-medium text-red-500">
      Sorry, something went wrong
    </span>

    <Button onClick={onRetry} variant="ghost">
      Retry
    </Button>
  </div>
);
