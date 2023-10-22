"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import If from "@inteligir/ui/if";
import Trans from "@inteligir/ui/trans";
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
                    <Trans
                      defaults="Checkout"
                      i18nKey="subscription:checkout"
                    />
                  </CheckoutRedirectButton>
                </ErrorBoundary>
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

const NoPermissionsAlert = () => (
  <Alert type="warn">
    <Alert.Heading>
      <Trans i18nKey="subscription:noPermissionsAlertHeading" />
    </Alert.Heading>

    <Trans i18nKey="subscription:noPermissionsAlertBody" />
  </Alert>
);

const CheckoutErrorMessage = ({ onRetry }: { onRetry: () => void }) => (
  <div className="flex flex-col space-y-2">
    <span className="text-sm font-medium text-red-500">
      <Trans i18nKey="subscription:unknownErrorAlertHeading" />
    </span>

    <Button onClick={onRetry} variant="ghost">
      <Trans i18nKey="common:retry" />
    </Button>
  </div>
);
