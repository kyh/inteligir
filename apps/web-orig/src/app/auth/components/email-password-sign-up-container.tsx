"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Trans from "ui/components/trans";
import If from "ui/components/if";
import Alert from "ui/components/alert";
import useSignUpWithEmailAndPasswordMutation from "@/features/auth/use-sign-up-with-email-password";
import AuthErrorMessage from "./auth-error-message";
import EmailPasswordSignUpForm from "@/app/auth/components/email-password-sign-up-form";
import configuration from "@/configuration";

const requireEmailConfirmation = configuration.auth.requireEmailConfirmation;

const EmailPasswordSignUpContainer: React.FCC<{
  onSignUp: (userId?: string) => unknown;
  onError?: (error?: unknown) => unknown;
}> = ({ onSignUp, onError }) => {
  const signUpMutation = useSignUpWithEmailAndPasswordMutation();
  const redirecting = useRef(false);
  const loading = signUpMutation.isMutating || redirecting.current;
  const [showVerifyEmailAlert, setShowVerifyEmailAlert] = useState(false);

  const callOnErrorCallback = useCallback(() => {
    if (signUpMutation.error && onError) {
      onError(signUpMutation.error);
    }
  }, [signUpMutation.error, onError]);

  useEffect(() => {
    callOnErrorCallback();
  }, [callOnErrorCallback]);

  const onSignupRequested = useCallback(
    async (params: { email: string; password: string }) => {
      if (loading) {
        return;
      }

      try {
        const data = await signUpMutation.trigger(params);

        // If the user is required to confirm their email, we display a message
        if (requireEmailConfirmation) {
          setShowVerifyEmailAlert(true);
        }

        onSignUp(data.user?.id);
      } catch (error) {
        if (onError) {
          onError(error);
        }
      }
    },
    [loading, onError, onSignUp, signUpMutation],
  );

  return (
    <>
      <If condition={showVerifyEmailAlert}>
        <Alert type="success">
          <Alert.Heading>
            <Trans i18nKey="auth:emailConfirmationAlertHeading" />
          </Alert.Heading>

          <p data-cy="email-confirmation-alert">
            <Trans i18nKey="auth:emailConfirmationAlertBody" />
          </p>
        </Alert>
      </If>

      <If condition={!showVerifyEmailAlert}>
        <AuthErrorMessage error={signUpMutation.error} />

        <EmailPasswordSignUpForm
          loading={loading}
          onSubmit={onSignupRequested}
        />
      </If>
    </>
  );
};

export default EmailPasswordSignUpContainer;
