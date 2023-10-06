import type { Database } from "database";
import { createClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

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
  const res = await request.json();

  const { record } = res;

  const { id, name } = record;

  // create a new customer in Stripe
  const customer = await stripe.customers.create({
    name,
    metadata: {
      teamId: id,
    },
  });

  // update user record in supabase profiles table
  const { error } = await supabase
    .from("teams")
    .update({ stripe_customer_id: customer.id })
    .match({ id })
    .single();

  if (error) {
    return new Response(error.message, {
      status: 500,
    });
  }

  return new Response("Success", {
    status: 200,
  });
}
