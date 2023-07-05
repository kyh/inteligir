"use client";

import React from "react";
import { ReadonlyURLSearchParams, useSearchParams } from "next/navigation";
import { Alert } from "~/components/Alert";
import If from "~/components/If";

enum SubscriptionStatusQueryParams {
  Success = "success",
  Cancel = "cancel",
  Error = "error",
}

function PlansStatusAlertContainer() {
  const status = useSubscriptionStatus();

  return (
    <If condition={status !== undefined}>
      <PlansStatusAlert status={status as SubscriptionStatusQueryParams} />
    </If>
  );
}

export default PlansStatusAlertContainer;

function PlansStatusAlert({
  status,
}: {
  status: SubscriptionStatusQueryParams;
}) {
  switch (status) {
    case SubscriptionStatusQueryParams.Cancel:
      return (
        <Alert type="warn" heading="The checkout was canceled" showClose>
          <p>
            The checkout was canceled. Please contact us if you&apos;re
            experiencing any issues.
          </p>
        </Alert>
      );

    case SubscriptionStatusQueryParams.Error:
      return (
        <Alert type="error" heading="Sorry, something went wrong" showClose>
          <p>
            We encountered an unknown error while processing your payment.
            Please try again or contact support.
          </p>
        </Alert>
      );

    case SubscriptionStatusQueryParams.Success:
      return (
        <Alert
          type="success"
          heading="Checkout successfully completed"
          showClose
        >
          <p>Yay, your payment went through!</p>
        </Alert>
      );
  }
}

function useSubscriptionStatus() {
  const params = useSearchParams();

  return getStatus(params);
}

function getStatus(params: ReadonlyURLSearchParams | null) {
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
}
