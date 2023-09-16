import { useEffect, createElement } from "react";

const StripePricingTable = ({
  pricingTableId,
  publishableKey,
  clientId,
  customerEmail,
}: {
  pricingTableId: string;
  publishableKey: string;
  clientId: string;
  customerEmail: string;
}) => {
  useEffect(() => {
    // Ensure window object is available
    if (typeof window !== "undefined") {
      const script = document.createElement("script");
      script.src = "https://js.stripe.com/v3/pricing-table.js";
      script.async = true;

      const cleanup = () => {
        document.body.removeChild(script);
      };

      document.body.appendChild(script);
      script.onload = () => {
        // This code will be executed once the script is loaded
        // If the script provides a callback function you can call it here
      };

      return cleanup;
    }
  }, []); // Empty dependency array means this effect runs once on mount and unmount

  return createElement(
    "stripe-pricing-table",
    {
      "pricing-table-id": pricingTableId,
      "publishable-key": publishableKey,
      "client-reference-id": clientId,
      "customer-email": customerEmail,
    },
    null,
  );
};

export default StripePricingTable;
