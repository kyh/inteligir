import { URL } from "node:url";
import type { Stripe } from "stripe";
import { getStripe } from "@/features/subscriptions/get-stripe";

type CreateCheckoutParams = {
  returnUrl: string;
  organizationUid: string;
  priceId: string;
  customerId?: string;
  trialPeriodDays?: Maybe<number>;
  customerEmail?: string;
};

/**
 * Creates a Stripe Checkout session, and returns an Object
 * containing the session, which you can use to redirect the user to the
 * checkout page
 */
export const createCheckout = async (params: CreateCheckoutParams) => {
  const successUrl = getUrlWithParams(params.returnUrl, {
    success: "true",
  });

  const cancelUrl = getUrlWithParams(params.returnUrl, {
    cancel: "true",
  });

  // in MakerKit, a subscription belongs to an organization,
  // rather than to a user
  // if you wish to change it, use the current user ID instead
  const clientReferenceId = params.organizationUid;

  // we pass an optional customer ID, so we do not duplicate the Stripe
  // customers if an organization subscribes multiple times
  const customer = params.customerId || undefined;

  // if it's a one-time payment
  // you should change this to "payment"
  // docs: https://stripe.com/docs/billing/subscriptions/build-subscription
  const mode: Stripe.Checkout.SessionCreateParams.Mode = "subscription";

  // get stripe instance
  const stripe = await getStripe();

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
    quantity: 1,
    price: params.priceId,
  };

  const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData =
    {
      trial_period_days: params.trialPeriodDays,
    };

  return stripe.checkout.sessions.create({
    mode,
    customer,
    line_items: [lineItem],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clientReferenceId.toString(),
    subscription_data: subscriptionData,
    customer_email: params.customerEmail,
  });
};

const getUrlWithParams = (origin: string, params: StringObject) => {
  const url = new URL(origin);
  const returnUrl = cleanParams(url);

  for (const param in params) {
    returnUrl.searchParams.set(param, params[param]);
  }

  return returnUrl.toString();
};

const cleanParams = (returnUrl: URL) => {
  returnUrl.searchParams.delete("cancel");
  returnUrl.searchParams.delete("success");
  returnUrl.searchParams.delete("error");

  return returnUrl;
};
