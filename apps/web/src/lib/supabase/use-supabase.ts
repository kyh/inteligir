import { useMemo } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser-client";

export const useSupabase = () => useMemo(getSupabaseBrowserClient, []);
