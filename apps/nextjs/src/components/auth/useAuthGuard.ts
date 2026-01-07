"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { useAuthUser } from "@/components/auth/useAuthUser";
import { useIsIframe } from "@/hooks/use-navigation";

export const useAuthGuard = () => {
  const user = useAuthUser();
  const router = useRouter();
  const isIframe = useIsIframe();

  return useCallback(
    (callback?: () => Promise<void> | void) => {
      if (!user?.id) {
        if (isIframe) {
          window.open("/auth/login", "_blank");
          return true;
        }
        router.push("/auth/login");
        return true;
      }

      return callback ? void callback() : false;
    },
    [isIframe, user?.id, router]
  );
};
