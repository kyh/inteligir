import { stripe } from "@/lib/stripe";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { priceId, teamId } = await request.json();

  const baseUrl = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";

  const supabase = createRouteHandlerClient({ cookies });

  // get user

  const { data } = await supabase.from("teams").select("*").eq("id", teamId);

  if (!data) {
    return new Response("Team not found", {
      status: 404,
    });
  }

  const team = data[0];

  if (!team) {
    return new Response("Team not found", {
      status: 404,
    });
  }

  let stripe_customer_id: string;

  stripe_customer_id = team.stripe_customer_id;

  if (!stripe_customer_id) {
    // create a new customer in Stripe

    const customer = await stripe.customers.create({
      name: team.name,
      metadata: {
        teamId: team.id,
      },
    });

    // update team record in supabase teams table

    const { error } = await supabase
      .from("teams")
      .update({ stripe_customer_id: customer.id })
      .match({ id: team.id })
      .single();

    if (error) {
      return new Response(error.message, {
        status: 500,
      });
    }

    stripe_customer_id = customer.id;
  }

  try {
    // Create Checkout Sessions from body params.
    const session = await stripe.checkout.sessions.create({
      customer: stripe_customer_id,
      line_items: [
        {
          // Provide the exact Price ID (for example, pr_1234) of the product you want to sell
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `${baseUrl}/${teamId}/settings/billing?success=true`,
      cancel_url: `${baseUrl}/${teamId}/settings/billing?canceled=true`,
    });

    const redirectUrl = session.url ?? "";

    return new Response(JSON.stringify({ redirectUrl }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return new Response((err as Error).message, {
      status: 500,
    });
  }
}
