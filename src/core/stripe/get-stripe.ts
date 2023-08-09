const STRIPE_API_VERSION = "2022-11-15";

const getStripeInstance = () => {
  if (isCypressEnv()) {
    console.warn(`Stripe is running in Testing mode`);

    return getStripeEmulatorInstance();
  }

  return getStripeProductionInstance();
};

export default getStripeInstance;

const getStripeProductionInstance = async () => {
  const Stripe = await loadStripe();
  const key = getStripeKey();

  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
  });
};

const isCypressEnv = () => {
  return process.env.IS_CI === `true`;
};

const getStripeEmulatorInstance = async () => {
  const Stripe = await loadStripe();

  return new Stripe(`sk_test_12345`, {
    host: `localhost`,
    port: 12111,
    apiVersion: STRIPE_API_VERSION,
    protocol: `http`,
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

const loadStripe = async () => {
  const { default: Stripe } = await import("stripe");

  return Stripe;
};
