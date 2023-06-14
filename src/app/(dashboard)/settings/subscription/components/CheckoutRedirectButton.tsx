"use client";

import React from "react";
import ArrowRightIcon from "@heroicons/react/24/outline/ArrowRightIcon";
import configuration from "~/configuration";
import isBrowser from "~/core/generic/is-browser";
import useCsrfToken from "~/core/hooks/use-csrf-token";
import { cn } from "~/lib/utils/cn";
import { Button } from "~/components/Button";

const CheckoutRedirectButton: React.FCC<{
  disabled?: boolean;
  stripePriceId?: string;
  recommended?: boolean;
  organizationId: Maybe<number>;
  customerId: Maybe<string>;
}> = ({ children, ...props }) => {
  return (
    <form data-cy="checkout-form" action="/api/stripe/checkout" method="POST">
      <CheckoutFormData
        customerId={props.customerId}
        organizationId={props.organizationId}
        priceId={props.stripePriceId}
      />
      <Button
        className={cn({
          "bg-emerald-contrast text-zinc-800": props.recommended,
        })}
        color={props.recommended ? "custom" : "secondary"}
        disabled={props.disabled}
        endIcon={<ArrowRightIcon className="h-5" />}
      >
        {children}
      </Button>
    </form>
  );
};

export default CheckoutRedirectButton;

function CheckoutFormData(
  props: React.PropsWithChildren<{
    organizationId: Maybe<number>;
    priceId: Maybe<string>;
    customerId: Maybe<string>;
  }>
) {
  const csrfToken = useCsrfToken();

  return (
    <>
      <input
        type="hidden"
        name="organizationId"
        defaultValue={props.organizationId}
      />

      <input type="hidden" name="csrf_token" defaultValue={csrfToken} />
      <input type="hidden" name="returnUrl" defaultValue={getReturnUrl()} />
      <input type="hidden" name="priceId" defaultValue={props.priceId} />

      <input type="hidden" name="customerId" defaultValue={props.customerId} />
    </>
  );
}

function getReturnUrl() {
  return isBrowser()
    ? [window.location.origin, window.location.pathname].join("")
    : undefined;
}
