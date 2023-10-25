"use client";

import type { FormEventHandler } from "react";
import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import Trans from "@inteligir/ui/trans";
import TextField from "@inteligir/ui/text-field";
import Button from "@inteligir/ui/button";
import Alert from "@inteligir/ui/alert";
import { If } from "@/components/if";
import useSignInWithOtp from "@/features/auth/use-sign-in-with-otp";
import { configuration } from "@/lib/configuration";

const EmailLinkAuth: React.FC<{
  inviteCode?: string;
}> = ({ inviteCode }) => {
  const { t } = useTranslation();
  const signInWithOtpMutation = useSignInWithOtp();

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();

      const target = event.currentTarget;
      const data = new FormData(target);
      const email = data.get("email") as string;

      const origin = window.location.origin;
      const queryParams = inviteCode ? `?inviteCode=${inviteCode}` : "";

      const redirectUrl = [
        origin,
        configuration.paths.authCallback,
        queryParams,
      ].join("");

      const promise = signInWithOtpMutation.trigger({
        email,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      await toast.promise(promise, {
        loading: t("auth:sendingEmailLink"),
        success: t(`auth:sendLinkSuccessToast`),
        error: t(`auth:errors.link`),
      });
    },
    [signInWithOtpMutation, inviteCode, t],
  );

  if (signInWithOtpMutation.data) {
    return (
      <Alert type="success">
        We sent you a link to your email! Follow the link to sign in.
      </Alert>
    );
  }

  return (
    <form className="w-full" onSubmit={onSubmit}>
      <div className="flex flex-col space-y-4">
        <TextField>
          <TextField.Label>
            Email Address
            <TextField.Input
              data-cy="email-input"
              name="email"
              placeholder="your@email.com"
              required
              type="email"
            />
          </TextField.Label>
        </TextField>

        <Button loading={signInWithOtpMutation.isMutating}>
          <If
            condition={signInWithOtpMutation.isMutating}
            fallback="Send Email Link"
          >
            Sending Email Link...
          </If>
        </Button>
      </div>
      <If condition={signInWithOtpMutation.error}>
        <Alert type="error">
          Sorry, we encountered an error while sending your link. Please try
          again.
        </Alert>
      </If>
    </form>
  );
};

export default EmailLinkAuth;
