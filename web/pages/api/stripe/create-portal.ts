import { createAuthApiHandler } from "@server/handler";
import { stripe, getCustomerId } from "@server/stripe";
import { APP_URL } from "@server/config";

const handler = createAuthApiHandler();

handler.post(async (req, res) => {
  const userId = req.session?.userId!;

  const customerId = await getCustomerId(userId);

  const { url } = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/profile`,
  });

  return res.status(200).json({ url });
});

export default handler;
