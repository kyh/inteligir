import type { FormEventHandler } from "react";
import React, { useCallback, useState } from "react";
import Button from "@inteligir/ui/button";
import Alert from "@inteligir/ui/alert";
import Trans from "@inteligir/ui/trans";
import { If } from "@/components/if";
import useSignInWithOtp from "@/features/auth/use-sign-in-with-otp";
import useVerifyOtp from "@/features/auth/use-verify-otp";
import { configuration } from "@/lib/configuration";
import PhoneNumberCredentialForm from "@/app/auth/components/phone-number-credential-form";
import VerificationCodeInput from "@/app/auth/components/verification-code-input";

enum Step {
  Phone,
  Otp,
}

const PhoneNumberSignInContainer: React.FC<{
  onSuccess: () => unknown;
  mode: "signIn" | "signUp";
}> = ({ onSuccess, mode }) => {
  const [step, setStep] = useState<Step>(Step.Phone);
  const [verificationCode, setVerificationCode] = useState("");
  const [phone, setPhone] = useState("");

  const signInWithOtp = useSignInWithOtp();
  const verifyOtp = useVerifyOtp();

  const onPhoneNumberSubmit = useCallback(
    async (phone: string) => {
      await signInWithOtp.trigger({
        phone,
        options: {
          shouldCreateUser: mode === "signUp",
          channel: "sms",
        },
      });

      setStep(Step.Otp);
      setPhone(phone);
    },
    [mode, signInWithOtp],
  );

  const onOTPSubmit: FormEventHandler = useCallback(
    async (e) => {
      e.preventDefault();

      const redirectTo = `${window.location.origin}${"/dashboard"}`;

      await verifyOtp.trigger({
        token: verificationCode,
        phone,
        type: "sms",
        options: {
          redirectTo,
        },
      });

      if (onSuccess) {
        onSuccess();
      }
    },
    [onSuccess, verificationCode, phone, verifyOtp],
  );

  if (step === Step.Otp) {
    return (
      <form className="w-full" onSubmit={onOTPSubmit}>
        <div className="flex flex-col space-y-4">
          <If condition={verifyOtp.error}>
            <Alert type="error">
              <Alert.Heading>
                Sorry, we were unable to log you in.
              </Alert.Heading>
              We were unable to verify your phone number. Please try again
              later.
            </Alert>
          </If>

          <VerificationCodeInput
            onInvalid={() => {
              setVerificationCode("");
            }}
            onValid={setVerificationCode}
          />

          <Button
            disabled={!verificationCode}
            loading={verifyOtp.isMutating}
            type="submit"
          >
            Sign In
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex w-full flex-col space-y-4">
      <If condition={signInWithOtp.error}>
        <Alert type="error">
          <Alert.Heading>Sorry, something went wrong.</Alert.Heading>
          We were unable to send you an OTP. Please try again later.
        </Alert>
      </If>

      <PhoneNumberCredentialForm
        action="signIn"
        loading={signInWithOtp.isMutating}
        onSubmit={onPhoneNumberSubmit}
      />
    </div>
  );
};

export default PhoneNumberSignInContainer;
