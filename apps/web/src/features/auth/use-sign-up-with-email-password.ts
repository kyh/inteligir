import useSWRMutation from "swr/mutation";
import { useSupabase } from "@/lib/supabase/use-supabase";

type Credentials = {
  email: string;
  password: string;
};

export const useSignUpWithEmailAndPassword = () => {
  const client = useSupabase();
  const key = ["auth", "sign-up-with-email-password"];

  return useSWRMutation(
    key,
    (_, { arg: credentials }: { arg: Credentials }) => {
      const emailRedirectTo = [window.location.origin, "/auth/callback"].join(
        "",
      );

      return client.auth
        .signUp({
          ...credentials,
          options: {
            emailRedirectTo,
          },
        })
        .then((response) => {
          if (response.error) {
            throw response.error;
          }

          const user = response.data.user;
          const identities = user?.identities ?? [];

          // if the user has no identities, it means that the email is taken
          if (identities.length === 0) {
            throw new Error("User already registered");
          }

          return response.data;
        });
    },
  );
};
