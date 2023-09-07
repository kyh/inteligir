import { useEffect } from "react";
import React from "react";

const StripePricingTable = ({
  pricingTableId,
  publishableKey,
}: {
  pricingTableId: string;
  publishableKey: string;
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

  return React.createElement(
    "stripe-pricing-table",
    {
      "pricing-table-id": pricingTableId,
      "publishable-key": publishableKey,
    },
    null
  );
};

export default StripePricingTable;
