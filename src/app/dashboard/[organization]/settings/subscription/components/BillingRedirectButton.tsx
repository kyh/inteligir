"use client";

import { ArrowRightIcon } from "lucide-react";
import useCsrfToken from "~/core/hooks/use-csrf-token";
import { createBillingPortalSessionAction } from "~/lib/stripe/actions";
import { Button } from "~/components/Button";

const BillingPortalRedirectButton: React.FCC<{
  customerId: string;
  className?: string;
}> = ({ children, customerId, className }) => {
  return (
    <form action={createBillingPortalSessionAction}>
      <input type="hidden" name="customerId" value={customerId} />

      <CsrfTokenInput />

      <Button className={className}>
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

  return <input type="hidden" name="csrf_token" defaultValue={csrfToken} />;
};

export default BillingPortalRedirectButton;
