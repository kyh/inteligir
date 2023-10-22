"use client";

import {
  experimental_useFormState as useFormState,
  experimental_useFormStatus as useFormStatus,
} from "react-dom";
import { useEffect } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";
import { clx } from "@inteligir/ui";
import Button from "@inteligir/ui/button";
import isBrowser from "@/core/generic/is-browser";
import useCsrfToken from "@/core/hooks/use-csrf-token";
import { createCheckoutAction } from "@/lib/stripe/actions";

const CheckoutRedirectButton: React.FCC<{
  disabled?: boolean;
  stripePriceId?: string;
  recommended?: boolean;
  organizationUid: string;
  onCheckoutCreated?: (clientSecret: string) => void;
}> = ({ children, onCheckoutCreated, ...props }) => {
  const [state, formAction] = useFormState(createCheckoutAction, {
    clientSecret: "",
  });

  useEffect(() => {
    if (state.clientSecret && onCheckoutCreated) {
      onCheckoutCreated(state.clientSecret);
    }
  }, [state.clientSecret, onCheckoutCreated]);

  return (
    <form action={formAction} data-cy="checkout-form">
      <CheckoutFormData
        organizationUid={props.organizationUid}
        priceId={props.stripePriceId}
      />

      <SubmitCheckoutButton
        disabled={props.disabled}
        recommended={props.recommended}
      >
        {children}
      </SubmitCheckoutButton>
    </form>
  );
};

export default CheckoutRedirectButton;

const SubmitCheckoutButton = (
  props: React.PropsWithChildren<{
    recommended?: boolean;
    disabled?: boolean;
  }>,
) => {
  const { pending } = useFormStatus();

  return (
    <Button
      block
      className={clx({
        "text-primary-foreground bg-primary dark:bg-white dark:text-gray-900":
          props.recommended,
      })}
      disabled={props.disabled}
      loading={pending}
      variant={props.recommended ? "custom" : "outline"}
    >
      <span className="flex items-center space-x-2">
        <span>{props.children}</span>

        <ChevronRightIcon className="h-4" />
      </span>
    </Button>
  );
};

const CheckoutFormData = (
  props: React.PropsWithChildren<{
    organizationUid: Maybe<string>;
    priceId: Maybe<string>;
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
    </>
  );
};

const getReturnUrl = () =>
  isBrowser()
    ? [window.location.origin, window.location.pathname].join("")
    : undefined;
