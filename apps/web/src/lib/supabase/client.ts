import type { SupabaseClient as SC } from "@supabase/supabase-js";
import type { Database } from "database";

export type SupabaseClient = SC<Database>;
