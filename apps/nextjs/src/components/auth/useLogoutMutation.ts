"use client";

import { useMutation } from "@tanstack/react-query";

import { authClient } from "@/auth/auth-client";

export const useLogoutMutation = () =>
  useMutation({
    mutationFn: async () => {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = "/";
          },
        },
      });
    },
    onError: (error) => {
      console.error("Logout error:", error);
    },
  });
