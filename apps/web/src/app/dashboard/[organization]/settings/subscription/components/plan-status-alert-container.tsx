"use client";

import React from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { useSearchParams } from "next/navigation";
import If from "@inteligir/ui/if";
import Alert from "@inteligir/ui/alert";
import Trans from "@inteligir/ui/trans";

enum SubscriptionStatusQueryParams {
  Success = "success",
  Cancel = "cancel",
  Error = "error",
}

const PlansStatusAlertContainer = () => {
  const status = useSubscriptionStatus();

  return (
    <If condition={status !== undefined}>
      <PlansStatusAlert status={status!} />
    </If>
  );
};

export default PlansStatusAlertContainer;

const PlansStatusAlert = ({
  status,
}: {
  status: SubscriptionStatusQueryParams;
}) => {
  switch (status) {
    case SubscriptionStatusQueryParams.Cancel:
      return (
        (<Alert type="warn" useCloseButton>
          <Alert.Heading>
            The checkout was canceled
          </Alert.Heading>
          <p>
            The checkout was canceled. Please contact us if you're experiencing any issues.
          </p>
        </Alert>)
      );

    case SubscriptionStatusQueryParams.Error:
      return (
        (<Alert type="error" useCloseButton>
          <Alert.Heading>
            Sorry, something went wrong
          </Alert.Heading>
          <p>
            We encountered an unknown error while processing your payment. Please try again or contact support.
          </p>
        </Alert>)
      );

    case SubscriptionStatusQueryParams.Success:
      return (
        (<Alert type="success" useCloseButton>
          <Alert.Heading>
            Checkout successfully completed
          </Alert.Heading>
          <p>
            Yay, your payment went through!
          </p>
        </Alert>)
      );
  }
};

const useSubscriptionStatus = () => {
  const params = useSearchParams();

  return getStatus(params);
};

const getStatus = (params: ReadonlyURLSearchParams | null) => {
  if (!params) {
    return;
  }

  const error = params.has(SubscriptionStatusQueryParams.Error);
  const canceled = params.has(SubscriptionStatusQueryParams.Cancel);
  const success = params.has(SubscriptionStatusQueryParams.Success);

  if (canceled) {
    return SubscriptionStatusQueryParams.Cancel;
  } else if (success) {
    return SubscriptionStatusQueryParams.Success;
  } else if (error) {
    return SubscriptionStatusQueryParams.Error;
  }
};
