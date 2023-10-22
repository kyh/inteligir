"use client";

import { ArrowRightMini } from "@inteligir/icons";
import Button from "ui/components/button";
import { useCsrfToken } from "@/lib/csrf/use-csrf-token";
import { createBillingPortalSessionAction } from "@/features/subscriptions/actions";

const BillingPortalRedirectButton: React.FCC<{
  customerId: string;
  className?: string;
}> = ({ children, customerId, className }) => {
  return (
    <form action={createBillingPortalSessionAction}>
      <input name="customerId" type="hidden" value={customerId} />

      <CsrfTokenInput />

      <Button className={className} variant="secondary">
        <span className="flex items-center space-x-2">
          <span>{children}</span>

          <ArrowRightMini className="h-5" />
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
