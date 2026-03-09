"use client";

import * as React from "react";

import { LoginForm } from "@/components/auth/login-form";
import { useSession } from "@/components/auth/useSession";
import { SrOnly } from "@/components/ui/sr-only";
import { DialogContent, DialogTitle } from "@/registry/ui/dialog";

export function LoginModal() {
  const session = useSession();

  if (session) return null;

  return (
    <DialogContent size="md">
      <DialogTitle>
        <SrOnly>Login</SrOnly>
      </DialogTitle>
      <LoginForm />
    </DialogContent>
  );
}
