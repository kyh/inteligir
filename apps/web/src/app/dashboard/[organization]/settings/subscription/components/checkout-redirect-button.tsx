"use client";

import React from "react";
import { ChevronRightMini } from "@inteligir/icons";
import classNames from "clsx";
import Button from "ui/components/button";
import { useCsrfToken } from "@/lib/csrf/use-csrf-token";
import { createCheckoutAction } from "@/features/subscriptions/actions";
import isBrowser from "@/lib/utils/is-browser";

const CheckoutRedirectButton: React.FCC<{
  disabled?: boolean;
  stripePriceId?: string;
  recommended?: boolean;
  organizationUid: string;
  customerId: Maybe<string>;
}> = ({ children, ...props }) => {
  return (
    <form action={createCheckoutAction} data-cy="checkout-form">
      <CheckoutFormData
        customerId={props.customerId}
        organizationUid={props.organizationUid}
        priceId={props.stripePriceId}
      />

      <Button
        block
        className={classNames({
          "text-foreground bg-background dark:bg-white dark:text-gray-900":
            props.recommended,
        })}
        disabled={props.disabled}
        variant={props.recommended ? "custom" : "secondary"}
      >
        <span className="flex items-center space-x-2">
          <span>{children}</span>

          <ChevronRightMini className="h-4" />
        </span>
      </Button>
    </form>
  );
};

export default CheckoutRedirectButton;

const CheckoutFormData = (
  props: React.PropsWithChildren<{
    organizationUid: Maybe<string>;
    priceId: Maybe<string>;
    customerId: Maybe<string>;
  }>,
) => {
  const csrfToken = useCsrfToken();

  return (
    <>
      <input
        defaultValue={props.organizationUid}
        name="organizationUid"
        type="hidden"
      />

      <input defaultValue={csrfToken} name="csrfToken" type="hidden" />
      <input defaultValue={getReturnUrl()} name="returnUrl" type="hidden" />
      <input defaultValue={props.priceId} name="priceId" type="hidden" />

      <input defaultValue={props.customerId} name="customerId" type="hidden" />
    </>
  );
};

const getReturnUrl = () =>
  isBrowser()
    ? [window.location.origin, window.location.pathname].join("")
    : undefined;
