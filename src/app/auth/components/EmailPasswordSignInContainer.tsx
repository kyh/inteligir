"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import useSignInWithEmailPassword from "~/core/hooks/use-sign-in-with-email-password";
import EmailPasswordSignInForm from "~/app/auth/components/EmailPasswordSignInForm";

const EmailPasswordSignInContainer: React.FCC<{
  onSignIn: (userId?: string) => unknown;
}> = ({ onSignIn }) => {
  const signInMutation = useSignInWithEmailPassword();
  const isLoading = signInMutation.isMutating;

  const onSubmit = useCallback(
    async (credentials: { email: string; password: string }) => {
      try {
        const data = await signInMutation.trigger(credentials);
        const userId = data?.user?.id;

        onSignIn(userId);
      } catch (e) {
        toast.error("Sorry, we could not authenticate you");
      }
    },
    [onSignIn, signInMutation]
  );

  return <EmailPasswordSignInForm onSubmit={onSubmit} loading={isLoading} />;
};

export default EmailPasswordSignInContainer;
