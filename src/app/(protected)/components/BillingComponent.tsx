"use client";
import StripePricingTable from "./StripePricingTable";

const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!;
const STRIPE_PRICING_TABLE_ID =
  process.env.NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID!;

export default function BillingComponent() {
  return (
    <StripePricingTable
      pricingTableId={STRIPE_PRICING_TABLE_ID}
      publishableKey={STRIPE_PUBLISHABLE_KEY}
    />
  );
}
