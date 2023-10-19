"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import useSupabase from "@/lib/supabase/use-supabase";
import configuration from "@/configuration";

const AuthLinkRedirect = () => {
  const params = useSearchParams();

  const redirectPath = params.get("redirectPath") || "/dashboard";

  useRedirectOnSignIn(redirectPath);

  return null;
};

export default AuthLinkRedirect;

const useRedirectOnSignIn = (redirectPath: string) => {
  const supabase = useSupabase();
  const router = useRouter();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_, session) => {
      if (session) {
        router.push(redirectPath);
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [supabase, router, redirectPath]);
};
