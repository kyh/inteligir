const STRIPE_API_VERSION = "2023-10-16";

export const getStripe = async () => {
  const { default: Stripe } = await import("stripe");
  const key = getStripeKey();

  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
  });
};

const getStripeKey = () => {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

  if (!STRIPE_SECRET_KEY) {
    throw new Error(
      `'STRIPE_SECRET_KEY' environment variable was not provided`,
    );
  }

  return STRIPE_SECRET_KEY;
};
