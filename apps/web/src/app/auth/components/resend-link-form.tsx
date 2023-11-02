"use client";

import useMutation from "swr/mutation";
import { Alert, Button, TextFieldInput, TextFieldLabel } from "@inteligir/ui";
import useSupabase from "~/core/hooks/use-supabase";

export const ResendLinkForm = () => {
  const resendLink = useResendLink();

  if (resendLink.data && !resendLink.isMutating) {
    return (
      <Alert type="success">
        <Trans defaults="Success!" i18nKey="auth:resendLinkSuccess" />
      </Alert>
    );
  }

  return (
    <form
      className="flex flex-col space-y-2"
      onSubmit={(data) => {
        data.preventDefault();

        const email = new FormData(data.currentTarget).get("email") as string;

        resendLink.trigger(email);
      }}
    >
      <TextFieldLabel>
        <Trans i18nKey="common:emailAddress" />
        <TextFieldInput name="email" placeholder="" required />
      </TextFieldLabel>

      <Button loading={resendLink.isMutating}>
        <Trans defaults="Resend Link" i18nKey="auth:resendLink" />
      </Button>
    </form>
  );
};

const useResendLink = () => {
  const supabase = useSupabase();

  return useMutation(
    ["resend-link"],
    async (
      _,
      data: {
        arg: string;
      },
    ) => {
      const response = await supabase.auth.resend({
        email: data.arg,
        type: "signup",
      });

      if (response.error) {
        throw response.error;
      }

      return response.data;
    },
  );
};
