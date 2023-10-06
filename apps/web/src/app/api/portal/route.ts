import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { teamId } = (await request.json()) as { teamId: string };

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

  const { stripe_customer_id } = team;

  try {
    // Create Portal Session from body params.
    const session = await stripe.billingPortal.sessions.create({
      customer: stripe_customer_id,
      return_url: `${baseUrl}/${teamId}/settings/billing`,
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
