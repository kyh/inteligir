"use client";

import { useCallback, type FormEventHandler } from "react";
import toast from "react-hot-toast";
import configuration from "~/configuration";
import useSignInWithOtp from "~/core/hooks/use-sign-in-with-otp";
import Alert from "~/components/Alert";
import Button from "~/components/Button";
import If from "~/components/If";
import TextField from "~/components/TextField";

const EmailLinkAuth: React.FC = () => {
  const signInWithOtpMutation = useSignInWithOtp();

  const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();

      const target = event.currentTarget;
      const data = new FormData(target);
      const email = data.get("email") as string;

      const origin = window.location.origin;
      const redirectUrl = [origin, configuration.paths.signInFromLink].join("");

      const promise = signInWithOtpMutation.trigger({
        email,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      await toast.promise(promise, {
        loading: "Sending Email Link...",
        success: "Email Link Sent!",
        error:
          "An error occurred while sending the email link. Please try again.",
      });
    },
    [signInWithOtpMutation]
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
              required
              type="email"
              placeholder="your@email.com"
              name="email"
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
