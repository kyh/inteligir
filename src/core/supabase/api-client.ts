import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "~/database.types";
import invariant from "tiny-invariant";

/**
 * Get a Supabase client for use in the legacy API routes
 * @param req
 * @param res
 * @param params
 */
function getSupabaseAPIClient(
  req: NextApiRequest,
  res: NextApiResponse,
  params = {
    admin: false,
  }
) {
  const env = process.env;

  invariant(env.NEXT_PUBLIC_SUPABASE_URL, `Supabase URL not provided`);
  invariant(
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    `Supabase Anon Key not provided`
  );

  if (params.admin) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    invariant(serviceRoleKey, `Supabase Service Role Key not provided`);

    return createServerSupabaseClient<Database>(
      { req, res },
      {
        supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
        supabaseKey: serviceRoleKey,
      }
    );
  }

  return createServerSupabaseClient<Database>(
    { req, res },
    {
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    }
  );
}

export default getSupabaseAPIClient;
