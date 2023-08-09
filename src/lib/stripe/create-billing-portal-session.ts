import getStripeInstance from "~/core/stripe/get-stripe";

const createBillingPortalSession = async (params: {
  customerId: string;
  returnUrl: string;
}) => {
  const stripe = await getStripeInstance();

  return stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
};

export default createBillingPortalSession;
