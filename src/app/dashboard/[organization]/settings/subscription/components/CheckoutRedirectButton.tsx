"use client";

import React from "react";
import { ArrowRightIcon } from "lucide-react";
import isBrowser from "~/core/generic/is-browser";
import useCsrfToken from "~/core/hooks/use-csrf-token";
import { createCheckoutAction } from "~/lib/stripe/actions";
import { cn } from "~/lib/utils";
import { Button } from "~/components/Button";

const CheckoutRedirectButton: React.FCC<{
  disabled?: boolean;
  stripePriceId?: string;
  recommended?: boolean;
  organizationUid: string;
  customerId: Maybe<string>;
}> = ({ children, ...props }) => {
  return (
    <form data-cy="checkout-form" action={createCheckoutAction}>
      <CheckoutFormData
        customerId={props.customerId}
        organizationUid={props.organizationUid}
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

const CheckoutFormData = (
  props: React.PropsWithChildren<{
    organizationUid: string;
    priceId: Maybe<string>;
    customerId: Maybe<string>;
  }>
) => {
  const csrfToken = useCsrfToken();

  return (
    <>
      <input
        type="hidden"
        name="organizationUid"
        defaultValue={props.organizationUid}
      />
      <input type="hidden" name="csrf_token" defaultValue={csrfToken} />
      <input type="hidden" name="returnUrl" defaultValue={getReturnUrl()} />
      <input type="hidden" name="priceId" defaultValue={props.priceId} />
      <input type="hidden" name="customerId" defaultValue={props.customerId} />
    </>
  );
};

const getReturnUrl = () => {
  return isBrowser()
    ? [window.location.origin, window.location.pathname].join("")
    : undefined;
};
