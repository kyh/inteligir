import { useMemo } from "react";
import getSupabaseBrowserClient from "~/core/supabase/browser-client";

const useSupabase = () => {
  return useMemo(getSupabaseBrowserClient, []);
};

export default useSupabase;
