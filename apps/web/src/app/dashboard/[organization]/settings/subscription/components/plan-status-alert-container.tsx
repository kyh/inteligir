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
        <Alert type="warn" useCloseButton>
          <Alert.Heading>
            <Trans i18nKey="subscription:checkOutCanceledAlertHeading" />
          </Alert.Heading>

          <p>
            <Trans i18nKey="subscription:checkOutCanceledAlert" />
          </p>
        </Alert>
      );

    case SubscriptionStatusQueryParams.Error:
      return (
        <Alert type="error" useCloseButton>
          <Alert.Heading>
            <Trans i18nKey="subscription:unknownErrorAlertHeading" />
          </Alert.Heading>

          <p>
            <Trans i18nKey="subscription:unknownErrorAlert" />
          </p>
        </Alert>
      );

    case SubscriptionStatusQueryParams.Success:
      return (
        <Alert type="success" useCloseButton>
          <Alert.Heading>
            <Trans i18nKey="subscription:checkOutCompletedAlertHeading" />
          </Alert.Heading>

          <p>
            <Trans i18nKey="subscription:checkOutCompletedAlert" />
          </p>
        </Alert>
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
