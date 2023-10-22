"use client";

import { ArrowRightIcon } from "@heroicons/react/24/outline";
import Button from "@inteligir/ui/button";
import useCsrfToken from "@/core/hooks/use-csrf-token";
import { createBillingPortalSessionAction } from "@/lib/stripe/actions";

const BillingPortalRedirectButton: React.FCC<{
  customerId: string;
  className?: string;
}> = ({ children, customerId, className }) => {
  return (
    <form action={createBillingPortalSessionAction}>
      <input name="customerId" type="hidden" value={customerId} />

      <CsrfTokenInput />

      <Button
        className={className}
        data-cy="manage-billing-redirect-button"
        variant="secondary"
      >
        <span className="flex items-center space-x-2">
          <span>{children}</span>

          <ArrowRightIcon className="h-5" />
        </span>
      </Button>
    </form>
  );
};

const CsrfTokenInput = () => {
  const csrfToken = useCsrfToken();

  return <input defaultValue={csrfToken} name="csrfToken" type="hidden" />;
};

export default BillingPortalRedirectButton;
