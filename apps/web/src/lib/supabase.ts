import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { Database } from "./types";
import { cookies } from "next/headers";

export const getSupabaseServerClient = () => {
  return createServerComponentClient<Database>({ cookies });
};
