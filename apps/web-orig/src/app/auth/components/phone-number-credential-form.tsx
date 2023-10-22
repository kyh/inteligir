"use client";

import type { FormEventHandler } from "react";
import { useCallback } from "react";
import If from "ui/components/if";
import TextField from "ui/components/text-field";
import Button from "ui/components/button";
import Trans from "ui/components/trans";

type ActionTypes = `link` | `signIn`;

const PhoneNumberCredentialForm: React.FC<{
  onSubmit: (phoneNumber: string) => void;
  action: ActionTypes;
  loading?: boolean;
}> = ({ onSubmit, action, loading }) => {
  const onLinkPhoneNumberSubmit: FormEventHandler<HTMLFormElement> =
    useCallback(
      (event) => {
        event.preventDefault();

        const data = new FormData(event.currentTarget);
        const phoneNumber = data.get("phoneNumber") as string;

        onSubmit(phoneNumber);
      },
      [onSubmit],
    );

  return (
    <form className="w-full" onSubmit={onLinkPhoneNumberSubmit}>
      <div className="flex flex-col space-y-2">
        <TextField.Label>
          <Trans i18nKey="profile:phoneNumberLabel" />

          <TextField.Input
            disabled={loading}
            name="phoneNumber"
            pattern={"^\\+?[1-9]\\d{1,14}$"}
            placeholder="Ex. +919367788755"
            required
            type="tel"
          />
        </TextField.Label>

        <Button block loading={loading} type="submit">
          <If condition={action === "link"}>
            <Trans i18nKey="profile:verifyPhoneNumberSubmitLabel" />
          </If>

          <If condition={action === "signIn"}>
            <Trans i18nKey="auth:signInWithPhoneNumber" />
          </If>
        </Button>
      </div>
    </form>
  );
};

export default PhoneNumberCredentialForm;
