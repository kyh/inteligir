import { stripe } from "~/lib/stripe";
import { headers } from "next/headers";
import Stripe from "stripe";
import { Database } from "~/lib/types";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = headers();
  const signature = headersList.get("stripe-signature") as string;
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, signingSecret);
  } catch (error) {
    return new Response(`Webhook Error: ${(error as Error).message}`, {
      status: 400,
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (event.type === "customer.subscription.updated") {
    // Get subscription id

    const subscriptionId = session.id as string;

    // Retrieve the subscription details from Stripe.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Get subscription status

    const subscriptionStatus = subscription.status as string;

    // Customer subscription status

    let subscribed = false;

    if (subscriptionStatus === "active") {
      subscribed = true;
    }

    // Get stripe customer id

    const stripe_customer_id = subscription.customer as string;

    // Get team from supabase from customer id

    const { data, error } = await supabase
      .from("teams")
      .select("*")
      .eq("stripe_customer_id", stripe_customer_id);

    if (error) {
      return new Response(error.message, {
        status: 500,
      });
    }

    const team = data![0];

    // Update team's subscribed status

    const { error: updateError } = await supabase
      .from("teams")
      .update({ subscribed })
      .match({ id: team.id })
      .single();

    if (updateError) {
      return new Response(updateError.message, {
        status: 500,
      });
    }
  }

  return new Response("Success", {
    status: 200,
  });
}
