import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "database";
import { cookies } from "next/headers";

export const getSupabaseServerClient = () => {
  return createServerComponentClient<Database>({ cookies });
};
