"use client";

import type { FormEventHandler } from "react";
import { useCallback } from "react";
import { If } from "@/components/if";
import TextField from "@inteligir/ui/text-field";
import Button from "@inteligir/ui/button";
import Trans from "@inteligir/ui/trans";

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
    (<form className="w-full" onSubmit={onLinkPhoneNumberSubmit}>
      <div className="flex flex-col space-y-2">
        <TextField.Label>
          Phone Number
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

          </If>

          <If condition={action === "signIn"}>
            Sign in with Phone Number
          </If>
        </Button>
      </div>
    </form>)
  );
};

export default PhoneNumberCredentialForm;
