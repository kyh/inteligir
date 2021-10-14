import { createAuthApiHandler } from "@server/createApiHandler";
import { stripe, getCustomerId } from "@server/stripe";
import { NEXTAUTH_URL } from "@server/config";

const handler = createAuthApiHandler();

handler.post(async (req, res) => {
  const userId = req.session?.userId!;

  const customerId = await getCustomerId(userId);

  const { url } = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${NEXTAUTH_URL}/account`,
  });

  return res.status(200).json({ url });
});

export default handler;
