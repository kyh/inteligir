"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import configuration from "~/configuration";
import useSupabase from "~/core/hooks/use-supabase";

function AuthLinkRedirect() {
  const params = useSearchParams();

  const redirectPath = params?.get("redirectPath") || "/dashboard";

  useRedirectOnSignIn(redirectPath);

  return null;
}

export default AuthLinkRedirect;

function useRedirectOnSignIn(redirectPath: string) {
  const supabase = useSupabase();
  const router = useRouter();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) {
        router.push(redirectPath);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [supabase, router, redirectPath]);
}
