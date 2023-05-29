import "server-only";
import { cookies, headers } from "next/headers";
import { createServerComponentSupabaseClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "~/database.types";
import invariant from "tiny-invariant";

/**
 * @name getSupabaseServerClient
 * @description Get a Supabase client for use in the Server Routes
 * @param params
 */
function getSupabaseServerClient(
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

    return createServerComponentSupabaseClient<Database>({
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseKey: serviceRoleKey,
      headers,
      cookies,
    });
  }

  return createServerComponentSupabaseClient<Database>({
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    headers,
    cookies,
  });
}

export default getSupabaseServerClient;
