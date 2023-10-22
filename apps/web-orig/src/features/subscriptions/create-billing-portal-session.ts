import { getStripe } from "@/features/subscriptions/get-stripe";

export const createBillingPortalSession = async (params: {
  customerId: string;
  returnUrl: string;
}) => {
  const stripe = await getStripe();

  return stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
};
