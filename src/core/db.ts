import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "~/core/database.types";

export type DatabaseClient = SupabaseClient<Database>;
